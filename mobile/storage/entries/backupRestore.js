// Backup restore / import pipeline (issue #1060 split of backupImport.js).
//
// The read-in side of the backup engine: validateBackup is the import gate that
// composes the validator primitives from backupValidation.js, and importBackup
// is the transactional restore that runs it before any write. replaceBackup's
// two contracts (LOCAL vs CLOUD, see IMPORT_MODES) and the cloud block restore
// keep their exact ordering: validate-then-write, blocks-before-memberships,
// local-storage-before-dirty-queue, replace-by-omission tombstones, and
// post-restore cache handling. backupImport.js re-exports importBackup and
// IMPORT_MODES so this split is invisible to callers.
import { secureStorage as AsyncStorage } from '../secureStorage';
import {
  WEIGHT_KEY,
  WEIGHT_GOAL_KEY,
  WORKOUT_NOTES_KEY,
  WORKOUT_DELOAD_HISTORY_KEY,
  CURRENT_WORKOUT_ID_KEY,
} from './keys';
import { writeList } from './jsonStorage';
import { resetPhase, SYNC_PHASE } from '../syncRecovery';
import { stripDerivedSectionsFromList } from './derivedCache';
import { movementGroupsNoteError, withExplicitMovementGroups } from './movementGroupValidation';
import { loadWorkoutNotesRaw, replaceWorkoutNotesRaw, withWorkoutNotebookLock } from './workoutNotes';
import { loadWeightEntriesRaw, replaceWeightEntriesRaw } from './weightEntries';
import {
  SYNC_TABLES,
  getClientId,
  stampWrite,
  stampTombstone,
  isTombstone,
  enqueueDirty,
} from '../syncQueue';
import { saveUserProfile, noteIntentWrite } from './profileStorage';
import { withLocalWriteLock } from '../sync/localWriteLock';
import {
  saveFatigueMultiplierUnlocked,
  saveWeightDateEditEnabledUnlocked,
  saveDeloadDateEditEnabledUnlocked,
  saveFatigueTrackingEnabledUnlocked,
  saveDeloadModeEnabledUnlocked,
  loadTrackedLifts,
  saveTrackedLifts,
  saveTrackedLiftActivations,
  readTrackedLiftRaw,
  restoreTrackedLiftRaw,
  normalizeTrackedLiftActivations,
  pruneTrackedLiftActivations,
  saveWorkoutCollapsedUnlocked,
} from './settings';
import { saveDeloadNote } from './deloadStorage';
import {
  loadRecoveryBlocksRaw,
  replaceRecoveryBlocksRaw,
  loadRecoveryBlockWeeksRaw,
  replaceRecoveryBlockWeeksRaw,
} from './recoveryStorage';
import { normalizeRecoveryReason } from '../../lib/data/recoveryBlocks';
import {
  SUPPORTED_VERSIONS,
  NOTEBOOK_VERSIONS,
  DELOAD_HISTORY_VERSIONS,
  RECOVERY_VERSIONS,
  MAX_IMPORT_ARRAY_LENGTH,
  MAX_IMPORT_RAW_TEXT_LENGTH,
  PROFILE_STRING_FIELDS,
  validateWeightEntries,
  validateDeloadHistory,
  validateRecoveryBlocks,
  validateRecoveryWeeks,
  validateRecoveryInvariants,
  validateFatigueMultiplier,
  validateCloudBlock,
} from './backupValidation';
import {
  projectFields,
  RECOVERY_BLOCK_FIELDS,
  RECOVERY_WEEK_FIELDS,
} from './backupExport';

// The complete set of user_profile fields the app reads or writes. An imported
// profile is rebuilt from this list, so an unknown key in a backup file cannot
// reach local storage.
const PROFILE_ALLOWLIST = [...PROFILE_STRING_FIELDS, 'height_cm'];

// #872. A backup file is NOT a trusted producer of canonical text. It can be
// hand-edited, and a value like "knee\n  surgery" clears validation — it is a
// non-blank string inside the length bound — while still violating the one-line
// form every in-app write path produces. Normalizing on the way in makes import
// a peer of creation, editing, and cross-device merge rather than the single
// door that admits a shape the domain never stores.
//
// Normalizing rather than rejecting is deliberate: a slightly-off reason in an
// otherwise valid file is a formatting difference, and failing a whole restore
// over one stray newline would cost the user their data to make a point about
// whitespace. That extends to a blank — an empty or whitespace-only value is
// "no reason", so it canonicalizes to `null` here rather than failing the
// import. Only what normalization CANNOT fix is rejected by
// `validateRecoveryBlocks`: a non-string, and a value past the domain cap.
//
// An absent `reason` stays absent: silence in a legacy file is not an
// instruction to write a null.
function normalizeImportedRecoveryBlock(block) {
  if (!Object.prototype.hasOwnProperty.call(block, 'reason')) return block;
  return { ...block, reason: normalizeRecoveryReason(block.reason) };
}

function validateBackup(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return { ok: false, error: 'Invalid backup: not an object' };
  if (!SUPPORTED_VERSIONS.has(payload.version))
    return { ok: false, error: `Unsupported backup version: ${payload.version}` };

  const weightCheck = validateWeightEntries(payload.weight_entries);
  if (!weightCheck.ok) return weightCheck;

  // Collected while the notes are validated, so the recovery pass below can
  // resolve every live membership's `note_id` without a second scan. Stays empty
  // for a version that carries no notes — which is also a version that carries
  // no recovery data, so nothing ever resolves against an empty set.
  const liveWorkoutNoteIds = new Set();

  if (NOTEBOOK_VERSIONS.has(payload.version)) {
    if (!Array.isArray(payload.workout_notes))
      return { ok: false, error: 'Invalid backup: workout_notes must be an array' };
    if (payload.workout_notes.length > MAX_IMPORT_ARRAY_LENGTH)
      return { ok: false, error: `Invalid backup: workout_notes too large (${payload.workout_notes.length}; limit ${MAX_IMPORT_ARRAY_LENGTH})` };
    const workoutNoteIds = new Set();
    for (const n of payload.workout_notes) {
      if (!n || typeof n !== 'object' || Array.isArray(n))
        return { ok: false, error: 'Invalid backup: workout note is not an object' };
      if (typeof n.id !== 'string')
        return { ok: false, error: 'Invalid backup: workout note missing id' };
      // Same rule the two recovery collections already enforce, and needed here
      // for the same reason plus one more. Two rows claiming one id collapse to
      // a single record on write while the payload claims two, so the restore
      // silently loses one — and WHICH one it loses differs by mode: the local
      // path writes the array verbatim and readers keep the live row, while the
      // cloud path's dirty queue is keyed by id and keeps the LAST row. A live
      // note followed by a tombstone therefore resolves both ways at once, which
      // would let a membership pass the live-note check below and still reach an
      // account whose note is deleted — the dangling link this validation exists
      // to prevent, reintroduced through the back door.
      if (workoutNoteIds.has(n.id))
        return { ok: false, error: `Invalid backup: duplicate workout note id ${n.id}` };
      workoutNoteIds.add(n.id);
      if (typeof n.title !== 'string')
        return { ok: false, error: 'Invalid backup: workout note missing title' };
      if (typeof n.raw_text !== 'string')
        return { ok: false, error: 'Invalid backup: workout note missing raw_text' };
      if (n.raw_text.length > MAX_IMPORT_RAW_TEXT_LENGTH)
        return { ok: false, error: `Invalid backup: workout note raw_text too large (${n.raw_text.length}; limit ${MAX_IMPORT_RAW_TEXT_LENGTH})` };
      const groupsError = movementGroupsNoteError(n); if (groupsError) return { ok: false, error: groupsError };
      // A tombstoned note is not a link target: readers filter it out, so a
      // membership pointing at one is dangling the moment it is restored.
      if (n.deleted_at == null && n.id.length > 0) liveWorkoutNoteIds.add(n.id);
    }
    if (payload.current_workout_id !== null && typeof payload.current_workout_id !== 'string')
      return { ok: false, error: 'Invalid backup: current_workout_id must be a string or null' };
    if ('weight_goal' in payload && payload.weight_goal !== null) {
      const g = payload.weight_goal;
      if (!g || typeof g !== 'object' || Array.isArray(g))
        return { ok: false, error: 'Invalid backup: weight_goal must be an object or null' };
      if (typeof g.target_weight !== 'number')
        return { ok: false, error: 'Invalid backup: weight_goal missing target_weight' };
      if (typeof g.target_date !== 'string')
        return { ok: false, error: 'Invalid backup: weight_goal missing target_date' };
    }
    if (DELOAD_HISTORY_VERSIONS.has(payload.version) && 'deload_history' in payload) {
      const deloadCheck = validateDeloadHistory(payload.deload_history);
      if (!deloadCheck.ok) return deloadCheck;
    }
    if ('fatigue_multiplier' in payload && payload.fatigue_multiplier != null) {
      const fatigueCheck = validateFatigueMultiplier(payload.fatigue_multiplier);
      if (!fatigueCheck.ok) return fatigueCheck;
    }
  }

  // Blocks are validated first so the membership pass can resolve every
  // `block_id` against them — the same dependency order the restore itself uses.
  // The notes were validated further up for the same reason, which is why a
  // membership's `note_id` can be resolved here too.
  //
  // The two keys stand or fall TOGETHER. Either the payload carries both — an
  // exporting device always emits both, as empty lists when the feature was
  // never used — or it carries neither and says nothing about recovery data at
  // all, which a legacy backup does and which never deletes anything.
  //
  // Half a payload is rejected because either half alone is unrestorable.
  // Memberships without blocks have `block_id` references that cannot be checked
  // against a collection the payload never supplied. Blocks without memberships
  // is the subtler one: replace would tombstone a block by omission while the
  // device's live memberships still point at it, leaving each of their workout
  // notes bound to a block that no longer exists and unable to join another. The
  // client's cascade covers a local delete and a PULLED tombstone, not a
  // tombstone a half-payload restore minted locally.
  if (RECOVERY_VERSIONS.has(payload.version)) {
    const hasBlocks = 'recovery_blocks' in payload;
    const hasWeeks = 'recovery_block_weeks' in payload;

    if (hasBlocks !== hasWeeks) {
      return {
        ok: false,
        error: `Invalid backup: ${hasBlocks ? 'recovery_blocks' : 'recovery_block_weeks'} present without ${hasBlocks ? 'recovery_block_weeks' : 'recovery_blocks'}; a recovery backup carries both collections or neither`,
      };
    }

    if (hasBlocks) {
      const blockCheck = validateRecoveryBlocks(payload.recovery_blocks);
      if (!blockCheck.ok) return blockCheck;
      const weekCheck = validateRecoveryWeeks(
        payload.recovery_block_weeks,
        blockCheck.blockIds,
        liveWorkoutNoteIds,
      );
      if (!weekCheck.ok) return weekCheck;
      // Last, because it is the only check that needs both collections whole.
      const invariantCheck = validateRecoveryInvariants(
        payload.recovery_blocks,
        payload.recovery_block_weeks,
      );
      if (!invariantCheck.ok) return invariantCheck;
    }
  }

  if ('cloud' in payload && payload.cloud != null) {
    const cloudCheck = validateCloudBlock(payload.cloud);
    if (!cloudCheck.ok) return cloudCheck;
  }

  return { ok: true };
}

// ── import modes (issue #526) ────────────────────────────────────────────────
//
// Import has TWO contracts, and the caller states which one it wants. Before
// #526 there was only the local one, and it ran in cloud mode too: the importer
// wrote domain keys straight into AsyncStorage, queued nothing, tombstoned
// nothing, and returned `{ ok: true }`. A cloud user's "replace" therefore left
// the device holding the imported data while the account still held the old
// data, with the UI reporting a successful restore (confirmed as #522 claim 5).
//
//   LOCAL — the device is the only copy. Replace overwrites the domain keys and
//     that is the whole story. Byte-for-byte the pre-#526 behavior.
//
//   CLOUD — the account is the shared copy and the device is one replica. A
//     replace is a batch of ordinary cloud writes: every imported row is stamped
//     and enqueued, and every collection row the backup OMITS becomes a
//     tombstone, because "replace" means those records are gone and a plain
//     local deletion would simply be re-pulled from the server.
//
// The values are deliberately the STORAGE_MODES values, so the app seam can pass
// `getStorageMode()` straight through instead of restating the mapping.
export const IMPORT_MODES = Object.freeze({ LOCAL: 'local', CLOUD: 'cloud' });

// Replace one dirty-queue-tracked collection table under the CLOUD contract.
//
// Deliberately mirrors cloudDomainMethods' write/delete pair rather than
// inventing a second mechanism: the same stamping primitives, the same
// retained-tombstone convention (readers filter `deleted_at`, so the row stays
// in the list until a synced cleanup removes it), and the same dirty queue. By
// the time sync() sees these rows they are indistinguishable from rows written
// by ordinary in-app edits and deletes, so last-write-wins, tombstone ordering,
// and cursor advancement stay on one code path.
//
// Ordering is durability-critical: local storage is written BEFORE the queue.
// A crash in between leaves the imported state on disk with no queue entries,
// which is exactly the shape #525's reconcileLocalWrites recovers — it diffs
// local state against the last-synced baseline on the next pass and re-derives
// both the writes and the omission tombstones. The reverse order would leave the
// queue promising rows the device does not have.
//
// Incoming `updated_at`/`client_id` are dropped rather than trusted: they
// describe the EXPORTING device's history (possibly another device, another
// account, or a hand-edited file) and would otherwise compete in LWW as if this
// device had made the write then. `deleted_at` is not dropped — a backup taken
// from raw storage legitimately carries tombstones, and resurrecting deleted
// records on import would be its own data bug.
//
// O(prior + imported) via a single keyed index; no nested scan.
async function replaceCollectionForCloud({ table, readRaw, writeRaw, imported, clientId }) {
  const prior = (await readRaw()) || [];
  const priorById = new Map();
  for (const rec of prior) {
    if (rec && rec.id != null) priorById.set(rec.id, rec);
  }

  const nextList = [];
  const dirty = [];
  const importedIds = new Set();

  for (const row of imported || []) {
    if (!row || row.id == null) continue;
    importedIds.add(row.id);
    // eslint-disable-next-line no-unused-vars
    const { updated_at: _updatedAt, client_id: _clientId, ...content } = row;
    // Build the record from the validated backup row ALONE (no merge with the
    // prior local row): "replace" means the backup is authoritative, so a field
    // it omits is CLEARED, not carried over and re-uploaded (#526, P2).
    const next = table === SYNC_TABLES.WORKOUT_NOTES ? withExplicitMovementGroups(content) : { ...content };
    const stamped = isTombstone(row)
      ? stampTombstone(next, clientId)
      : stampWrite(next, clientId);
    nextList.push(stamped);
    dirty.push(stamped);
  }

  for (const [id, base] of priorById) {
    if (importedIds.has(id)) continue;
    if (isTombstone(base)) {
      // Already a tombstone. The delete has been recorded once; restating it
      // would only move `updated_at` forward for no reason.
      nextList.push(base);
      continue;
    }
    // Present locally, absent from the backup. Under replace semantics the
    // record is gone — but the account still has it, so only a tombstone can
    // express that. Dropping the row instead would let the next pull resurrect
    // it, which is the silent divergence #526 exists to fix.
    const tombstone = stampTombstone({ ...base }, clientId);
    nextList.push(tombstone);
    dirty.push(tombstone);
  }

  await writeRaw(nextList);
  for (const record of dirty) {
    // eslint-disable-next-line no-await-in-loop
    await enqueueDirty(table, record);
  }
  return dirty.length;
}

// #893: flags and records are restored as ONE authoritative pair. Restore
// replaces the flag map and the note history outright, so the device's existing
// records are not kept: a boolean-only backup restores an EMPTY record map and
// gets the documented legacy full-history behavior. Records are taken through
// the local loader's normalizer, then pruned to the restored flags. A failed
// second write puts the first back (#1398 raw snapshot), so an incomplete pair
// is never left durable for a hook or sync pass to adopt.
async function restoreTrackedPair(cloud, store) {
  const snapshot = await readTrackedLiftRaw(store);
  try {
    if (cloud.tracked_lifts != null) {
      const tracked = {};
      for (const [lift, value] of Object.entries(cloud.tracked_lifts)) {
        if (typeof value === 'boolean') tracked[lift] = value;
      }
      await saveTrackedLifts(tracked, store);
      await saveTrackedLiftActivations(
        pruneTrackedLiftActivations(tracked, normalizeTrackedLiftActivations(cloud.tracked_lift_activations ?? {})),
        store,
      );
    } else if (cloud.tracked_lift_activations != null) {
      // Records without flags: pruned against whatever this device already has.
      await saveTrackedLiftActivations(
        pruneTrackedLiftActivations(await loadTrackedLifts(store), normalizeTrackedLiftActivations(cloud.tracked_lift_activations)),
        store,
      );
    }
  } catch (e) {
    await restoreTrackedLiftRaw(snapshot, store).catch(() => {});
    throw e;
  }
}

async function restoreCloudSettings(cloud, store) {
  await restoreTrackedPair(cloud, store);
  if (cloud.ui_state != null && typeof cloud.ui_state.log_current_collapsed === 'boolean') {
    await saveWorkoutCollapsedUnlocked(cloud.ui_state.log_current_collapsed, store);
  }
  const toggles = cloud.feature_toggles;
  if (toggles != null) {
    if (typeof toggles.weight_date_edit_enabled === 'boolean')
      await saveWeightDateEditEnabledUnlocked(toggles.weight_date_edit_enabled, store);
    if (typeof toggles.deload_date_edit_enabled === 'boolean')
      await saveDeloadDateEditEnabledUnlocked(toggles.deload_date_edit_enabled, store);
    if (typeof toggles.fatigue_tracking_enabled === 'boolean')
      await saveFatigueTrackingEnabledUnlocked(toggles.fatigue_tracking_enabled, store);
    if (typeof toggles.deload_mode_enabled === 'boolean')
      await saveDeloadModeEnabledUnlocked(toggles.deload_mode_enabled, store);
  }
}

// Restores the account/profile state that lives only in the cloud block.
//
// buildCloudExport is the only export shape carrying user_profile (which holds
// the device-local date_of_birth, sex, height_cm, activity_level — no cloud
// table has these), tracked_lifts, and feature_toggles. Before #488 the importer
// dropped all of it on the floor, so a reinstall lost them permanently.
//
// Fields are restored explicitly, never by wildcard copy (#471/#475).
async function restoreCloudBlock(cloud, store) {
  if (cloud.user_profile != null) {
    // Build the row explicitly rather than forwarding the imported object.
    // saveUserProfile spreads what it is given, so passing the payload through
    // would persist any key an attacker put in the file — the same wildcard
    // failure that put date_of_birth and sex into profile_json (#471/#474/#475),
    // inverted: uncontrolled ingress instead of uncontrolled egress.
    const p = cloud.user_profile;
    const profile = {};
    for (const key of PROFILE_ALLOWLIST) {
      if (p[key] != null) profile[key] = p[key];
    }
    if (Object.keys(profile).length > 0) await saveUserProfile(profile, store);
  }

  // #1400: every diff-synced local write of the block is ONE local-write-lock
  // section (the lock is not re-entrant, so the `...Unlocked` twins), so a toggle
  // or sync write-back lands wholly before or after it. The Track hook claims a
  // generation bump only while it holds this lock, which is what stops a restore
  // write from being taken for its own. Profile and deload note take the lock
  // themselves, so they stay outside the section.
  await withLocalWriteLock(() => restoreCloudSettings(cloud, store));

  if (cloud.current_deload_note != null && typeof cloud.current_deload_note.raw_text === 'string') {
    // #989: carry the frozen generation-time working_context through the restore
    // so a lossless export/import keeps it; an older backup without the field
    // passes undefined, which saveDeloadNote treats as "leave as-is".
    await saveDeloadNote(cloud.current_deload_note.raw_text, cloud.current_deload_note.working_context, store);
  }
}

// Restores a backup. strategy 'replace' overwrites all local data atomically.
// Returns { ok: true, mode, queued } or { ok: false, error: string }.
// Validation runs before any write; storage is not mutated on failure.
// v1 backups restore weight entries only; workout notes state is left untouched.
//
// `mode` selects the contract described at IMPORT_MODES. It defaults to LOCAL,
// which is the historical behavior and the correct one for a device with no
// account; the cloud contract is opted into explicitly by the app seam, which is
// the layer that knows the active storage mode.
//
// Everything outside the two collection tables is DIFF-TRACKED (weight goal,
// deload history, profile, health profile, toggles): sync detects local change
// by diffing live state against a persisted snapshot whatever writer produced
// it, and their `allowDelete` configs turn a cleared value into a cloud
// tombstone. That is the confirmed alternative to import-time queueing.
//
// `archived_weight_goals` is a collection table that the backup FORMAT does not
// carry at all. A replace therefore leaves it untouched: the payload contains no
// evidence that those records were dropped, and tombstoning them on that
// non-evidence would destroy data the user never asked to remove.
//
// The two recovery collections (#694) follow the same evidence rule: v4 carries
// them and replaces them under the full cloud contract (omission tombstones);
// a v1/v2/v3 file says nothing about them and leaves them exactly where they are.
//
// #1186: with the device key lost, a validated replace is the recovery path. It
// writes into a PRIVATE reset-device overlay (the `store` threaded below; the
// shared store stays latched for every other caller) and replaces the orphaned
// data only once the restored copy is staged and verified under a fresh key.
//
// Recovery always takes the LOCAL contract. It rebuilds this device, owned by no
// account, exactly as reset-then-restore would; it cannot honor a cloud replace,
// whose omission tombstones need the prior rows it cannot read. The session
// leaves cloud mode and the bootstrap/sync phases reset, so the ownership flow
// re-decides the account relationship (it prompts for an unclaimed device), and
// a later ordinary cloud restore replaces the account.
export async function importBackup(payload, strategy = 'replace', { mode = IMPORT_MODES.LOCAL } = {}) {
  const check = validateBackup(payload);
  if (!check.ok) return check;
  if (AsyncStorage.isKeyUnavailable?.()) {
    if (strategy !== 'replace') return { ok: false, error: 'Only a full backup restore can recover this device.' };
    const recovered = await AsyncStorage.recoverDeviceData((store) => restoreValidatedBackup(payload, strategy, IMPORT_MODES.LOCAL, store));
    if (recovered?.ok) {
      // Lazy: storageMode -> localAdapter -> entries -> this module is a cycle.
      // eslint-disable-next-line global-require
      const { setStorageMode, STORAGE_MODES } = require('./storageMode');
      setStorageMode(STORAGE_MODES.LOCAL);
      resetPhase(SYNC_PHASE.BOOTSTRAP);
      resetPhase(SYNC_PHASE.SYNC);
    }
    return recovered;
  }
  return restoreValidatedBackup(payload, strategy, mode);
}

// #1400: every replace runs under the notebook lock, so a pending normalization
// apply intent is settled (rolled forward or back) before the restore writes
// anything, for every variant including a v1 restore carrying a cloud block, and
// no note writer interleaves. Lock order: notebook -> local-write, as everywhere.
function restoreValidatedBackup(payload, strategy, mode, store) {
  const run = () => restoreUnderLock(payload, strategy, mode, store);
  return strategy === 'replace' ? withWorkoutNotebookLock(run) : run();
}

async function restoreNotebookState(payload, target, store) {
  await (payload.current_workout_id != null
    ? target.setItem(CURRENT_WORKOUT_ID_KEY, JSON.stringify(payload.current_workout_id))
    : target.removeItem(CURRENT_WORKOUT_ID_KEY));
  // #1421: a landed write or removal is local intent even when the bytes match.
  noteIntentWrite(CURRENT_WORKOUT_ID_KEY);
  if ('weight_goal' in payload) {
    if (payload.weight_goal != null) {
      await target.setItem(WEIGHT_GOAL_KEY, JSON.stringify(payload.weight_goal));
    } else {
      await target.removeItem(WEIGHT_GOAL_KEY);
    }
  }
  if ('fatigue_multiplier' in payload && payload.fatigue_multiplier != null) {
    await saveFatigueMultiplierUnlocked(payload.fatigue_multiplier, store);
  }
  if (DELOAD_HISTORY_VERSIONS.has(payload.version) && 'deload_history' in payload) {
    await writeList(WORKOUT_DELOAD_HISTORY_KEY, payload.deload_history, store);
  }
}

async function restoreUnderLock(payload, strategy, mode, store) {
  const target = store || AsyncStorage;
  const cloudMode = mode === IMPORT_MODES.CLOUD;
  const resolvedMode = cloudMode ? IMPORT_MODES.CLOUD : IMPORT_MODES.LOCAL;
  let queued = 0;

  if (strategy === 'replace') {
    const isNotebookVersion = NOTEBOOK_VERSIONS.has(payload.version);
    // Recovery data is restored only from a recovery-aware backup that carries
    // it. Validation has already rejected a payload holding one collection
    // without the other, so this single flag governs both.
    const hasRecovery = RECOVERY_VERSIONS.has(payload.version) && 'recovery_blocks' in payload;

    if (cloudMode) {
      const clientId = await getClientId();
      queued += await replaceCollectionForCloud({
        table: SYNC_TABLES.WEIGHT_ENTRIES,
        readRaw: loadWeightEntriesRaw,
        writeRaw: replaceWeightEntriesRaw,
        imported: payload.weight_entries,
        clientId,
      });
      // v1 predates the notebook model, so it says nothing about workout notes.
      // Silence is not an instruction to delete them.
      if (isNotebookVersion) {
        queued += await replaceCollectionForCloud({
          table: SYNC_TABLES.WORKOUT_NOTES,
          readRaw: loadWorkoutNotesRaw,
          writeRaw: replaceWorkoutNotesRaw,
          imported: payload.workout_notes,
          clientId,
        });
      }
      // Blocks BEFORE memberships, always. kilo.recovery_block_weeks carries a
      // real foreign key to kilo.recovery_blocks, and the push walks the dirty
      // queue in enqueue order, so a membership queued ahead of its block is
      // rejected by the database. The same order also means a crash between the
      // two leaves blocks-without-memberships (recoverable, and what #525's
      // reconcileLocalWrites re-derives) rather than memberships pointing at
      // blocks that are not there.
      if (hasRecovery) {
        queued += await replaceCollectionForCloud({
          table: SYNC_TABLES.RECOVERY_BLOCKS,
          readRaw: loadRecoveryBlocksRaw,
          writeRaw: replaceRecoveryBlocksRaw,
          imported: payload.recovery_blocks.map((b) => normalizeImportedRecoveryBlock(projectFields(b, RECOVERY_BLOCK_FIELDS))),
          clientId,
        });
      }
      if (hasRecovery) {
        queued += await replaceCollectionForCloud({
          table: SYNC_TABLES.RECOVERY_BLOCK_WEEKS,
          readRaw: loadRecoveryBlockWeeksRaw,
          writeRaw: replaceRecoveryBlockWeeksRaw,
          imported: payload.recovery_block_weeks.map((w) => projectFields(w, RECOVERY_WEEK_FIELDS)),
          clientId,
        });
      }
    } else {
      // WORKOUT_KEY (legacy sessions) is not part of the backup scope and is not touched.
      const pairs = [[WEIGHT_KEY, JSON.stringify(payload.weight_entries)]];
      if (isNotebookVersion) {
        // A backup taken by an older build can carry the parser cache; it never
        // re-enters storage (issue #813).
        pairs.push([WORKOUT_NOTES_KEY, JSON.stringify(stripDerivedSectionsFromList(payload.workout_notes))]);
      }
      await target.multiSet(pairs);
      // Same dependency order on the local side, for the same reason a reader
      // would hit: a membership is only interpretable once its block exists.
      if (hasRecovery) {
        await replaceRecoveryBlocksRaw(
          payload.recovery_blocks.map((b) => normalizeImportedRecoveryBlock(projectFields(b, RECOVERY_BLOCK_FIELDS))),
          store,
        );
      }
      if (hasRecovery) {
        await replaceRecoveryBlockWeeksRaw(
          payload.recovery_block_weeks.map((w) => projectFields(w, RECOVERY_WEEK_FIELDS)),
          store,
        );
      }
    }

    // The direct writes of diff-synced state (current id, goal, fatigue, deload
    // history) are one local-write section, like the cloud block's (#1400).
    if (isNotebookVersion) await withLocalWriteLock(() => restoreNotebookState(payload, target, store));

    if ('cloud' in payload && payload.cloud != null) {
      await restoreCloudBlock(payload.cloud, store);
    }
  }

  return { ok: true, mode: resolvedMode, queued };
}

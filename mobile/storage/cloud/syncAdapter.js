import * as Storage from '../entries';
import {
  loadArchivedWeightGoalsRaw,
  replaceArchivedWeightGoalsRaw,
  replaceWeightGoalRaw,
} from '../entries/weightGoal';
import { mergeUserProfile } from '../entries/profileStorage';
import {
  loadDeloadNote,
  clearDeloadNote,
  applyDeloadNoteFromSync,
} from '../entries/deloadStorage';
import { WORKOUT_DELOAD_HISTORY_KEY } from '../entries/keys';
import { writeList } from '../entries/jsonStorage';
import {
  SYNC_TABLES,
  SINGLETON_SYNC_ID,
  syncTable,
  syncDiffTable,
  isTombstone,
  stampTombstone,
  stableStringify,
  getClientId,
  enqueueDirty,
  clearCursor,
  clearSyncSnapshot,
  reconcileLocalWrites,
} from '../syncQueue';
import {
  WEIGHT_GOAL_SYNC_FIELDS,
  DELOAD_RECORD_JSON_FIELDS,
  buildDeloadRecordJson,
  deriveFatigueCheckinRows,
} from './bootstrapPlan';
import { getTransport, getRecomputeDerived } from './transport';

// Legacy-note bootstrap provenance. A row is legacy-provenance when EITHER:
//   * it carries source_snapshot.async_storage_key === 'kilo_workout_note'
//     (the marker buildBootstrapPlan stamps on the kilo_workout_note import), OR
//   * its id is in the `wn_legacy_<userId>` namespace that ONLY bootstrap mints
//     for that import (see bootstrapPlan.js). User-authored notes and the local
//     `migrateToNotebook` entry use `wn_<date>_<ts>` ids, never this prefix.
//
// The id check exists because of issue #501: the ownership-confirmation upload
// path could re-upload a legacy row through bootstrap with its source_snapshot
// stripped to null, producing a live cloud row that the source_snapshot-only
// check no longer recognized. The id namespace is the durable provenance signal
// that survives that round trip, so a row already resurrected that way (including
// one already sitting in an account from the buggy build) is still cleaned.
function isLegacyProvenanceNote(note) {
  if (
    note.source_snapshot != null &&
    note.source_snapshot.async_storage_key === 'kilo_workout_note'
  ) {
    return true;
  }
  return typeof note.id === 'string' && note.id.startsWith('wn_legacy_');
}

// Returns true for a LIVE legacy-provenance row. Both phantom guards gate on
// hasNonPhantom, so a legacy-only user whose sole note is this row is preserved.
function isLegacyPhantomNote(note) {
  return !isTombstone(note) && isLegacyProvenanceNote(note);
}

async function clearTombstonedCurrentNote(tombstones) {
  if (tombstones.length === 0) return;
  const currentId = await Storage.loadCurrentWorkoutId();
  if (tombstones.some((note) => note.id === currentId)) {
    await Storage.clearCurrentWorkoutId();
  }
}

// Tombstone any live phantom legacy notes already in local storage when non-phantom
// notes co-exist. Running before the sync loop ensures the tombstone participates
// in the LWW merge and that merged.get(id) returns the tombstone in syncTable
// step 3, so the correct tombstone row is pushed to cloud in the same pass.
// (Scenario A: phantom was written into local storage by a prior sync pull.)
async function tombstoneLocalPhantoms() {
  const list = await Storage.loadWorkoutNotesRaw();
  const hasNonPhantom = list.some((n) => !isTombstone(n) && !isLegacyPhantomNote(n));
  if (!hasNonPhantom) return;

  const clientId = await getClientId();
  const toEnqueue = [];
  const processed = list.map((n) => {
    if (!isLegacyPhantomNote(n)) return n;
    const ts = stampTombstone(n, clientId);
    toEnqueue.push(ts);
    return ts;
  });
  if (toEnqueue.length === 0) return;

  await Storage.replaceWorkoutNotesRaw(processed);
  await clearTombstonedCurrentNote(toEnqueue);
  for (const ts of toEnqueue) {
    // eslint-disable-next-line no-await-in-loop
    await enqueueDirty(SYNC_TABLES.WORKOUT_NOTES, ts);
  }
}

function createTableIo(deferWorkoutNoteTombstone) {
  return {
  [SYNC_TABLES.WEIGHT_ENTRIES]: {
    read: () => Storage.loadWeightEntriesRaw(),
    write: (list) => Storage.replaceWeightEntriesRaw(list),
  },
  [SYNC_TABLES.WORKOUT_NOTES]: {
    read: () => Storage.loadWorkoutNotesRaw(),
    // Tombstone any live phantom legacy notes that survived the LWW merge when
    // non-phantom notes exist. This handles Scenario B: phantom arrived via cloud
    // pull (not yet in local), so tombstoneLocalPhantoms could not act on it
    // before the merge. The tombstone is written locally (so loadWorkoutNotes
    // never surfaces the phantom) and enqueued dirty so the cursor advances past
    // the phantom's timestamp on this sync pass, stopping re-pulls.
    write: async (list) => {
      const hasNonPhantom = list.some((n) => !isTombstone(n) && !isLegacyPhantomNote(n));
      if (!hasNonPhantom) {
        await Storage.replaceWorkoutNotesRaw(list);
        return;
      }
      const clientId = await getClientId();
      const tombstoned = [];
      const processed = list.map((n) => {
        if (!isLegacyPhantomNote(n)) return n;
        const ts = stampTombstone(n, clientId);
        tombstoned.push(ts);
        return ts;
      });
      await Storage.replaceWorkoutNotesRaw(processed);
      await clearTombstonedCurrentNote(tombstoned);
      // syncTable snapshots and clears its dirty batch around writeLocal. Defer
      // rows created during this write until the pass completes so they cannot
      // be cleared before upload.
      tombstoned.forEach(deferWorkoutNoteTombstone);
    },
  },
  [SYNC_TABLES.ARCHIVED_WEIGHT_GOALS]: {
    read: () => loadArchivedWeightGoalsRaw(),
    write: (list) => replaceArchivedWeightGoalsRaw(list),
  },
  };
}

// The tables whose local changes are tracked by the dirty queue at write time.
// Every other synced table is diff-tracked (see DIFF_TABLES below), which
// detects local change by comparing live state against a snapshot instead.
const COLLECTION_SYNC_TABLES = Object.freeze([
  SYNC_TABLES.WEIGHT_ENTRIES,
  SYNC_TABLES.WORKOUT_NOTES,
  SYNC_TABLES.ARCHIVED_WEIGHT_GOALS,
]);

// Reconcile writes made while signed out (issue #525).
//
// Only the CLOUD adapter enqueues dirty records at write time, so anything the
// user created, edited, or deleted while signed out is invisible to the sync
// loop: the pass pushes nothing and still reports success. This diffs each
// collection table against the baseline syncTable persists and enqueues whatever
// diverged, so the ordinary loop below uploads it.
//
// Runs at the START of every sync pass rather than only on the sign-in
// transition. Sync is the single funnel every path goes through — automatic
// sign-in sync, "Sync Now", and the #538 post-purge rebuild — so putting the
// reconciliation here means no caller can reach a successful SYNC phase without
// it, and a reconciliation that fails throws out of the phase runner instead of
// letting the UI show "Fully synced" over unreconciled local data. On a device
// with nothing to reconcile it is a keyed O(rows) comparison that enqueues
// nothing, so repeated passes stay idempotent.
//
// This is the STEADY-STATE half only. A table with no baseline yet returns
// `deferred: true` and enqueues nothing here, because local state alone cannot
// distinguish a signed-out write from an untouched row — syncTable handles that
// table against a full pull instead (see reconcileAgainstRemote). Both halves
// run inside the same sync phase, so neither can be skipped on the way to a
// successful SYNC.
export async function reconcileSignedOutWrites() {
  const tableIo = createTableIo(() => {});
  const results = [];
  for (const table of COLLECTION_SYNC_TABLES) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await reconcileLocalWrites({ table, readLocal: tableIo[table].read }));
  }
  return results;
}

async function syncOne(table, tableIo) {
  const io = tableIo[table];
  return syncTable({
    table,
    transport: getTransport(),
    readLocal: io.read,
    writeLocal: io.write,
    recomputeDerived: getRecomputeDerived(),
    // These three are the tables whose signed-out writes the dirty queue misses,
    // so they opt into the unbaselined (upgrade-window) reconciliation described
    // in syncQueue: on the one pass where no baseline exists yet, reconcile
    // against a full pull instead of against local state (#525).
    reconcileUnbaselined: true,
  });
}

// ── diff-tracked tables (issue #489) ─────────────────────────────────────────
//
// `user_profile`, `feature_toggles`, `weight_goal`, and `deload_history` used to
// be pushed exactly once, by bootstrap, and never again — so a routine change, a
// tracked-lift change, a toggle, the unit system, the fatigue multiplier, the
// active goal, and deload history all stopped at the device they were made on,
// and the cloud copy stayed frozen at first sign-in.
//
// They now run through `syncDiffTable`, which reuses the same LWW engine as the
// three original tables (`stampWrite`/`stampTombstone`/`pickWinner`/dirty queue/
// cursor). The one difference is dirty detection: these tables are assembled from
// a spread of AsyncStorage keys written by many setters across modules outside
// this issue's scope, so instead of hooking every setter we diff live local state
// against a persisted last-synced snapshot. See syncQueue.js for the convergence
// rule this implies (last write to REACH THE SERVER wins, ties by client_id).
//
// `buildLocal` projects local storage onto the cloud row shape; `applyMerged`
// writes LWW winners back into local storage. Every `applyMerged` MERGES into the
// existing local record rather than replacing it, so fields the cloud does not
// carry (profile demographics, unknown deload keys) are never clobbered on a
// device that already has data.

const SINGLETON_TABLES = new Set([
  SYNC_TABLES.USER_PROFILE,
  SYNC_TABLES.USER_HEALTH_PROFILE,
  SYNC_TABLES.FEATURE_TOGGLES,
  SYNC_TABLES.WEIGHT_GOAL,
]);

// Singleton rows have no `id` column, but the merge machinery is keyed by id.
// Give every pulled singleton row the same synthetic id so local and remote
// versions of the one logical row resolve against each other. The upsert column
// whitelist drops `id` again on the way out (see transport.js).
function withSingletonIds(transport) {
  return {
    async pull(table, cursor) {
      const rows = (await transport.pull(table, cursor)) || [];
      if (!SINGLETON_TABLES.has(table)) return rows;
      return rows.map((row) =>
        row && row.id == null ? { ...row, id: SINGLETON_SYNC_ID } : row
      );
    },
    push: (table, records) => transport.push(table, records),
  };
}

// Bounds for a synced fatigue multiplier, mirroring the backup-import validator.
// A remote value outside them is ignored rather than written into fatigue calc.
function isValidFatigueMultiplier(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n <= 10;
}

function singletonRow(mergedList) {
  return mergedList.find((rec) => rec && rec.id === SINGLETON_SYNC_ID) || null;
}

// user_profile / user_health_profile ------------------------------------------
//
// One logical "profile" on the device, two cloud rows since #487: account
// settings in user_profile, and the three Art. 9 health values
// (current_workout_note_id, fatigue_multiplier, tracked_lifts) in the
// consent-gated user_health_profile.
//
// The split is not cosmetic. Left on user_profile, those three would keep syncing
// through an ungated table, and the contract migration that drops the columns
// would break settings sync along with them. Splitting also means a user who
// refuses health consent still syncs their display name and unit system: the gate
// blocks the health row, not their account.
//
// The active generated deload (issue #498) rides the same consent-gated health
// singleton via current_deload_note_raw_text / _saved_at / _updated_at, so a
// deload generated on device A becomes the active deload on device B. Its pulled
// winner is applied through applyDeloadNoteFromSync (timestamps written verbatim,
// no re-stamp) so it does not ping-pong.

const USER_PROFILE_FIELDS = Object.freeze([
  'display_name',
  'unit_system',
  'ui_state',
]);

const USER_HEALTH_PROFILE_FIELDS = Object.freeze([
  'current_workout_note_id',
  'fatigue_multiplier',
  'tracked_lifts',
  // Active in-progress deload (issue #498). Health data, so gated with the row.
  'current_deload_note_raw_text',
  'current_deload_note_saved_at',
  'current_deload_note_updated_at',
]);

// The multiplier a device reports when the user has never touched it.
const DEFAULT_FATIGUE_MULTIPLIER = 1.07;

// True when the local row carries nothing the user actually authored. A singleton
// always exists locally (its storage keys fall back to defaults), so on the FIRST
// sync pass this is the only way to tell a clean install apart from a user who
// deliberately cleared every field. Without it, a clean install would stamp its
// empty defaults at `now` and overwrite the row another device authored.
// `ui_state` is not consulted: a collapsed panel is not user content.
function isEmptyUserProfile(record) {
  return record.display_name == null && record.unit_system == null;
}

function isEmptyUserHealthProfile(record) {
  const noTrackedLifts =
    !record.tracked_lifts || Object.keys(record.tracked_lifts).length === 0;
  const defaultMultiplier =
    record.fatigue_multiplier == null ||
    Number(record.fatigue_multiplier) === DEFAULT_FATIGUE_MULTIPLIER;
  // A device with an active deload note has real health content, so it must not be
  // treated as an empty clean-install row (which would adopt the cloud row and drop
  // the local deload on the seeded first pass).
  const noDeloadNote = record.current_deload_note_raw_text == null;
  return (
    record.current_workout_note_id == null &&
    noTrackedLifts &&
    defaultMultiplier &&
    noDeloadNote
  );
}

// Same first-pass rule for toggles: all four at their shipped defaults means the
// user has never set one, so a clean install adopts the account's toggles rather
// than resetting them for every other device.
function isDefaultFeatureToggles(record) {
  return (
    record.weight_date_edit_enabled === false &&
    record.deload_date_edit_enabled === false &&
    record.fatigue_tracking_enabled === true &&
    record.deload_mode_enabled === true
  );
}

async function buildUserProfileRecords() {
  const [profile, collapsed] = await Promise.all([
    Storage.loadUserProfile(),
    Storage.loadWorkoutCollapsed(),
  ]);
  return [
    {
      id: SINGLETON_SYNC_ID,
      display_name: profile?.display_name ?? null,
      unit_system: profile?.unit_system ?? null,
      ui_state: { log_current_collapsed: !!collapsed },
    },
  ];
}

async function applyUserProfile(mergedList) {
  const row = singletonRow(mergedList);
  if (!row || isTombstone(row)) return;

  if (row.ui_state && typeof row.ui_state === 'object') {
    const next = !!row.ui_state.log_current_collapsed;
    const local = !!(await Storage.loadWorkoutCollapsed());
    if (local !== next) await Storage.saveWorkoutCollapsed(next);
  }

  // MERGE, never replace: the local profile record also holds the device-local
  // demographics (date_of_birth/sex/height_cm/activity_level) that are
  // deliberately not synced (issue #476). saveUserProfile would drop them.
  const profile = await Storage.loadUserProfile();
  const nextName = row.display_name ?? null;
  const nextUnit = row.unit_system ?? null;
  if (
    (profile?.display_name ?? null) !== nextName ||
    (profile?.unit_system ?? null) !== nextUnit
  ) {
    await mergeUserProfile({ display_name: nextName, unit_system: nextUnit });
  }
}

// user_health_profile --------------------------------------------------------

async function buildUserHealthProfileRecords() {
  const [currentWorkoutId, fatigueMultiplier, trackedLifts, deloadNote] =
    await Promise.all([
      Storage.loadCurrentWorkoutId(),
      Storage.loadFatigueMultiplier(),
      Storage.loadTrackedLifts(),
      loadDeloadNote(),
    ]);
  const note = deloadNote || {};
  return [
    {
      id: SINGLETON_SYNC_ID,
      current_workout_note_id: currentWorkoutId ?? null,
      fatigue_multiplier: fatigueMultiplier ?? null,
      tracked_lifts: trackedLifts ?? {},
      current_deload_note_raw_text: note.raw_text ?? null,
      current_deload_note_saved_at: note.saved_at ?? null,
      current_deload_note_updated_at: note.updated_at ?? null,
    },
  ];
}

async function applyUserHealthProfile(mergedList) {
  const row = singletonRow(mergedList);
  if (!row || isTombstone(row)) return;

  const nextCurrent = row.current_workout_note_id ?? null;
  const localCurrent = (await Storage.loadCurrentWorkoutId()) ?? null;
  if (localCurrent !== nextCurrent) {
    if (nextCurrent == null) await Storage.clearCurrentWorkoutId();
    else await Storage.saveCurrentWorkoutId(nextCurrent);
  }

  if (row.fatigue_multiplier != null && isValidFatigueMultiplier(row.fatigue_multiplier)) {
    const next = Number(row.fatigue_multiplier);
    const local = Number(await Storage.loadFatigueMultiplier());
    if (local !== next) await Storage.saveFatigueMultiplier(next);
  }

  if (
    row.tracked_lifts &&
    typeof row.tracked_lifts === 'object' &&
    !Array.isArray(row.tracked_lifts)
  ) {
    const local = await Storage.loadTrackedLifts();
    if (stableStringify(local) !== stableStringify(row.tracked_lifts)) {
      await Storage.saveTrackedLifts(row.tracked_lifts);
    }
  }

  // Active deload (issue #498). A null raw_text is a cleared deload; removing the
  // local note is what stops the next diff from re-pushing it (no resurrection).
  // Otherwise write the winner's timestamps VERBATIM via applyDeloadNoteFromSync,
  // never saveDeloadNote — re-stamping updated_at here would ping-pong the row
  // between devices. Compare on normalized timestamps so a Postgres +00:00/Z
  // round-trip is not mistaken for a change.
  const nextDeloadRaw = row.current_deload_note_raw_text ?? null;
  const nextDeloadSaved = row.current_deload_note_saved_at ?? null;
  const nextDeloadUpdated = row.current_deload_note_updated_at ?? null;
  const localDeload = await loadDeloadNote();
  if (nextDeloadRaw == null) {
    if (localDeload) await clearDeloadNote();
  } else {
    const sameTs = (a, b) => {
      const ta = a == null ? null : Date.parse(a);
      const tb = b == null ? null : Date.parse(b);
      return ta === tb;
    };
    const changed =
      (localDeload?.raw_text ?? null) !== nextDeloadRaw ||
      !sameTs(localDeload?.saved_at ?? null, nextDeloadSaved) ||
      !sameTs(localDeload?.updated_at ?? null, nextDeloadUpdated);
    if (changed) {
      await applyDeloadNoteFromSync({
        raw_text: nextDeloadRaw,
        saved_at: nextDeloadSaved,
        updated_at: nextDeloadUpdated,
      });
    }
  }
}

// feature_toggles ------------------------------------------------------------

const FEATURE_TOGGLE_FIELDS = Object.freeze([
  'weight_date_edit_enabled',
  'deload_date_edit_enabled',
  'fatigue_tracking_enabled',
  'deload_mode_enabled',
]);

async function buildFeatureToggleRecords() {
  const [weightDateEdit, deloadDateEdit, fatigueTracking, deloadMode] = await Promise.all([
    Storage.loadWeightDateEditEnabled(),
    Storage.loadDeloadDateEditEnabled(),
    Storage.loadFatigueTrackingEnabled(),
    Storage.loadDeloadModeEnabled(),
  ]);
  return [
    {
      id: SINGLETON_SYNC_ID,
      weight_date_edit_enabled: !!weightDateEdit,
      deload_date_edit_enabled: !!deloadDateEdit,
      fatigue_tracking_enabled: fatigueTracking !== false,
      deload_mode_enabled: deloadMode !== false,
    },
  ];
}

async function applyFeatureToggles(mergedList) {
  const row = singletonRow(mergedList);
  if (!row || isTombstone(row)) return;

  const setters = [
    ['weight_date_edit_enabled', Storage.loadWeightDateEditEnabled, Storage.saveWeightDateEditEnabled],
    ['deload_date_edit_enabled', Storage.loadDeloadDateEditEnabled, Storage.saveDeloadDateEditEnabled],
    ['fatigue_tracking_enabled', Storage.loadFatigueTrackingEnabled, Storage.saveFatigueTrackingEnabled],
    ['deload_mode_enabled', Storage.loadDeloadModeEnabled, Storage.saveDeloadModeEnabled],
  ];
  for (const [field, load, save] of setters) {
    if (typeof row[field] !== 'boolean') continue;
    // eslint-disable-next-line no-await-in-loop
    const local = !!(await load());
    // eslint-disable-next-line no-await-in-loop
    if (local !== row[field]) await save(row[field]);
  }
}

// weight_goal ----------------------------------------------------------------

async function buildWeightGoalRecords() {
  const goal = await Storage.loadWeightGoal();
  if (!goal) return [];
  const record = { id: SINGLETON_SYNC_ID };
  for (const field of WEIGHT_GOAL_SYNC_FIELDS) {
    record[field] = goal[field] ?? null;
  }
  return [record];
}

async function applyWeightGoal(mergedList) {
  const row = singletonRow(mergedList);
  const existing = await Storage.loadWeightGoal();

  // A tombstoned (or absent) goal means the goal was cleared. Removing it locally
  // is what stops the next pass from re-pushing it — no resurrection.
  if (!row || isTombstone(row)) {
    if (existing) await Storage.clearWeightGoal();
    return;
  }

  // Merge so any local-only key on the goal object survives the round trip.
  const next = { ...(existing || {}) };
  for (const field of WEIGHT_GOAL_SYNC_FIELDS) {
    next[field] = row[field] ?? null;
  }
  if (stableStringify(next) !== stableStringify(existing)) {
    await replaceWeightGoalRaw(next);
  }
}

// deload_history -------------------------------------------------------------

const DELOAD_HISTORY_FIELDS = Object.freeze(['date', 'raw_text', 'record_json', 'saved_at']);

async function buildDeloadHistoryRecords() {
  const list = (await Storage.loadDeloadHistory()) || [];
  return list
    .filter((record) => record && record.id != null)
    .map((record) => ({
      id: record.id,
      date: record.date ?? null,
      raw_text: record.raw_text ?? null,
      record_json: buildDeloadRecordJson(record),
      saved_at: record.saved_at ?? null,
    }));
}

// Project a merged cloud row back onto the flat local deload-record shape,
// preserving any local key the cloud does not carry.
function toLocalDeloadRecord(existing, row) {
  const record = {
    ...(existing || {}),
    id: row.id,
    date: row.date ?? null,
    raw_text: row.raw_text ?? null,
    saved_at: row.saved_at ?? null,
  };
  const json =
    row.record_json && typeof row.record_json === 'object' ? row.record_json : {};
  for (const key of DELOAD_RECORD_JSON_FIELDS) {
    if (json[key] !== undefined) record[key] = json[key];
  }
  return record;
}

async function applyDeloadHistory(mergedList) {
  const existing = (await Storage.loadDeloadHistory()) || [];
  const mergedById = new Map();
  for (const row of mergedList) {
    if (row && row.id != null) mergedById.set(row.id, row);
  }

  // Keep the existing local order, drop tombstoned records, then append records
  // that only exist remotely. O(local + merged), no nested scan.
  const next = [];
  const seen = new Set();
  for (const record of existing) {
    if (!record || record.id == null) continue;
    const row = mergedById.get(record.id);
    seen.add(record.id);
    if (!row) {
      next.push(record);
      continue;
    }
    if (isTombstone(row)) continue;
    next.push(toLocalDeloadRecord(record, row));
  }
  for (const row of mergedList) {
    if (!row || row.id == null || seen.has(row.id) || isTombstone(row)) continue;
    next.push(toLocalDeloadRecord(null, row));
  }

  if (stableStringify(next) !== stableStringify(existing)) {
    await writeList(WORKOUT_DELOAD_HISTORY_KEY, next);
  }
}

// fatigue_checkins (derived projection, issue #498) ---------------------------
//
// Canonical is workout_notes.session_checkins. These rows are DERIVED from the
// converged workout-note state (buildLocal reads the same raw notebook the
// workout_notes pass just merged), so every device produces the identical
// projection and repeated passes are idempotent. The projection is
// one-directional: applyFatigueCheckins is a deliberate no-op — a pulled remote
// fatigue row is NEVER written back into a note, so it can never become a second
// source of truth or mutate session_checkins. The syncDiffTable snapshot handles
// create/update/tombstone deterministically: a check-in that stops being derived
// (removed, or its source note deleted/tombstoned) drops out of buildLocal and is
// tombstoned against the snapshot without resurrection.

const FATIGUE_CHECKIN_FIELDS = Object.freeze([
  'workout_note_id',
  'session_date',
  'status',
  'reasons',
  'source_json',
]);

async function buildFatigueCheckinRecords() {
  const notes = await Storage.loadWorkoutNotesRaw();
  return deriveFatigueCheckinRows(notes);
}

// Intentionally does nothing: the canonical session_checkins on each note is the
// only source of truth, and syncDiffTable already persists the reconciled snapshot
// this table needs. Writing merged rows anywhere else would create a second copy.
async function applyFatigueCheckins() {}

// Sync order note: workout_notes runs before user_health_profile, so a routine
// pulled in the same pass already exists locally by the time
// current_workout_note_id points at it.
const DIFF_TABLES = Object.freeze([
  {
    // Derived from the converged workout_notes just synced above. Runs first among
    // the diff tables so it reflects the notebook's settled state this pass.
    table: SYNC_TABLES.FATIGUE_CHECKINS,
    buildLocal: buildFatigueCheckinRecords,
    applyMerged: applyFatigueCheckins,
    payloadFields: FATIGUE_CHECKIN_FIELDS,
    fieldKinds: {},
    // A removed check-in or a deleted source note must tombstone the derived row.
    allowDelete: true,
  },
  {
    table: SYNC_TABLES.DELOAD_HISTORY,
    buildLocal: buildDeloadHistoryRecords,
    applyMerged: applyDeloadHistory,
    payloadFields: DELOAD_HISTORY_FIELDS,
    fieldKinds: { saved_at: 'timestamp' },
    allowDelete: true,
  },
  {
    table: SYNC_TABLES.WEIGHT_GOAL,
    buildLocal: buildWeightGoalRecords,
    applyMerged: applyWeightGoal,
    payloadFields: WEIGHT_GOAL_SYNC_FIELDS,
    fieldKinds: {
      target_weight: 'number',
      start_weight: 'number',
      saved_at: 'timestamp',
    },
    // The active goal can be cleared, so a locally-missing goal is a real delete.
    allowDelete: true,
  },
  {
    table: SYNC_TABLES.FEATURE_TOGGLES,
    buildLocal: buildFeatureToggleRecords,
    applyMerged: applyFeatureToggles,
    payloadFields: FEATURE_TOGGLE_FIELDS,
    fieldKinds: {},
    // Toggles always exist (they fall back to defaults); there is nothing to delete.
    allowDelete: false,
    isEmptyLocal: isDefaultFeatureToggles,
  },
  {
    table: SYNC_TABLES.USER_PROFILE,
    buildLocal: buildUserProfileRecords,
    applyMerged: applyUserProfile,
    payloadFields: USER_PROFILE_FIELDS,
    fieldKinds: {},
    allowDelete: false,
    isEmptyLocal: isEmptyUserProfile,
  },
  {
    // Consent-gated (#487). A user without an active grant is denied this table by
    // RLS while their account settings above keep syncing normally.
    table: SYNC_TABLES.USER_HEALTH_PROFILE,
    buildLocal: buildUserHealthProfileRecords,
    applyMerged: applyUserHealthProfile,
    payloadFields: USER_HEALTH_PROFILE_FIELDS,
    fieldKinds: {
      fatigue_multiplier: 'number',
      current_deload_note_saved_at: 'timestamp',
      current_deload_note_updated_at: 'timestamp',
    },
    allowDelete: false,
    isEmptyLocal: isEmptyUserHealthProfile,
  },
]);

// Consent (#487) is deliberately NOT checked here. This module is transport-
// agnostic by contract — the transport is injected, and the tests drive it with no
// Supabase client at all — so an authorization call in this loop would be both out
// of place and unenforceable. The gate lives at the app seam
// (hooks/entries/syncRecoveryHooks.js), which is where a denial becomes a screen
// the user can act on, and the real boundary is the server's RLS, which refuses
// these reads and writes whether or not any client ever asks.
export async function sync() {
  const pendingWorkoutNoteTombstones = [];
  const tableIo = createTableIo((tombstone) => pendingWorkoutNoteTombstones.push(tombstone));
  // Before anything else: adopt writes made while signed out (#525). A failure
  // here propagates, so the SYNC phase fails and the user sees a retryable state
  // rather than a success that silently left local data behind.
  await reconcileSignedOutWrites();
  await tombstoneLocalPhantoms();
  const results = [];
  for (const table of COLLECTION_SYNC_TABLES) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await syncOne(table, tableIo));
  }
  if (pendingWorkoutNoteTombstones.length > 0) {
    const tombstones = pendingWorkoutNoteTombstones.splice(0);
    for (const tombstone of tombstones) {
      // eslint-disable-next-line no-await-in-loop
      await enqueueDirty(SYNC_TABLES.WORKOUT_NOTES, tombstone);
    }
    results.push(await syncOne(SYNC_TABLES.WORKOUT_NOTES, tableIo));
  }

  // The tables bootstrap used to push once and abandon (issue #489). Run them
  // after the workout-note passes above (including the phantom-tombstone rerun,
  // which can clear the current routine) so user_health_profile uploads the
  // settled current_workout_note_id rather than one this pass is about to drop.
  const singletonAware = withSingletonIds(getTransport());
  for (const config of DIFF_TABLES) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await syncDiffTable({ ...config, transport: singletonAware }));
  }
  return results;
}

// ── reconsent cloud rebuild (issue #538) ─────────────────────────────────────
//
// A completed withdrawal purge empties every gated table server-side. If the
// SAME device later re-grants, its dirty queue is already empty (everything it
// held was acknowledged before withdrawal) and every diff-tracked table's
// last-synced snapshot already agrees with what is now an intentionally empty
// cloud copy — so ordinary sync() above has nothing to detect and pushes
// nothing. The server tells the client this explicitly via a monotonic
// consent_state.cloud_rebuild_generation (storage/cloud/consent.js); when the
// server's generation is ahead of the one THIS device last rebuilt for
// (storage/entries/localDataOwner.js), the app runs rebuildCloudCopy() instead
// of an ordinary sync pass (see hooks/entries/syncRecoveryHooks.js).
//
// The rebuild reuses the SAME engine ordinary sync() uses for every one of the
// seven gated tables, rather than a separate one-off upload path: it only
// rearms each table's local bookkeeping so the next sync() pass treats every
// local record — live rows AND tombstones, since a tombstone is itself a row
// the purge deleted and omitting it would leave row-count parity wrong even
// though it stays invisible — as unpushed, then lets the ordinary
// pull/push/merge loop do the actual work. That keeps tombstone handling, LWW,
// and cursor advancement identical to every other sync pass instead of a
// second, differently-tested code path, and it naturally never pulls the
// (intentionally empty) post-purge cloud snapshot over local state first: the
// merge step unions local-only records straight into the push set exactly as
// it does for any other unsynced local write.
// The same three dirty-queue-tracked collections defined above; every one of
// them is consent-gated and therefore emptied by a withdrawal purge.
const REBUILD_COLLECTION_TABLES = COLLECTION_SYNC_TABLES;

// The diff-tracked tables among the seven gated ones. FEATURE_TOGGLES and
// USER_PROFILE are diff-tracked too but are NOT gated/purged — a withdrawal
// never touches them — so they are deliberately excluded: there is nothing on
// them to rebuild.
const REBUILD_DIFF_TABLES = Object.freeze([
  SYNC_TABLES.USER_HEALTH_PROFILE,
  SYNC_TABLES.WEIGHT_GOAL,
  SYNC_TABLES.DELOAD_HISTORY,
  SYNC_TABLES.FATIGUE_CHECKINS,
]);

// Re-enqueue every local record (including tombstones) of a dirty-queue
// tracked collection table, so the next syncTable pass pushes the complete
// local set instead of only whatever a write-time hook already queued.
// Idempotent: re-enqueuing an id already in the dirty queue just overwrites
// its snapshot with the same value, and clearing an already-clear cursor is a
// no-op — so re-running this after a partial or retried rebuild is safe.
async function reseedCollectionTable(table, readLocal) {
  const list = (await readLocal()) || [];
  for (const record of list) {
    if (!record || record.id == null) continue;
    // eslint-disable-next-line no-await-in-loop
    await enqueueDirty(table, record);
  }
  await clearCursor(table);
}

// Rearm every consent-gated table for a full reupload.
export async function rearmGatedTablesForRebuild() {
  const tableIo = createTableIo(() => {});
  for (const table of REBUILD_COLLECTION_TABLES) {
    // eslint-disable-next-line no-await-in-loop
    await reseedCollectionTable(table, tableIo[table].read);
  }
  for (const table of REBUILD_DIFF_TABLES) {
    // eslint-disable-next-line no-await-in-loop
    await clearSyncSnapshot(table);
    // eslint-disable-next-line no-await-in-loop
    await clearCursor(table);
  }
}

// The full post-purge cloud rebuild: rearm every gated table, push everything
// through the ordinary sync loop, then run one more ordinary sync pass as the
// reconciliation the acceptance criteria require — proving the rebuild
// converged and picking up anything another device pushed concurrently.
//
// Recording that this device has caught up to the server's rebuild generation
// is the CALLER's job (syncRecoveryHooks.js), done only after this resolves
// successfully: keeping the per-device generation write next to the phase
// runner is what makes "the rebuild finished" and "we recorded that it
// finished" a single retryable unit. A failure at any step propagates,
// mirroring sync()'s own contract so the existing runPhase failure handling
// applies unchanged: local data is never touched by a failure here, this
// device's persisted generation is not advanced, and the next launch simply
// sees the server generation still ahead and rebuilds again. Every retry — a
// fresh rearm, a re-push of already-acknowledged rows — is idempotent: it can
// duplicate network traffic but never duplicate rows or lose data.
export async function rebuildCloudCopy() {
  await rearmGatedTablesForRebuild();
  const rebuildResults = await sync();
  const reconciliationResults = await sync();
  return { ok: true, results: [...rebuildResults, ...reconciliationResults] };
}

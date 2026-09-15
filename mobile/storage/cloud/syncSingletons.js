import * as Storage from '../entries';
import { mergeUserProfile } from '../entries/profileStorage';
import {
  loadDeloadNote,
  clearDeloadNote,
  applyDeloadNoteFromSync,
} from '../entries/deloadStorage';
import { WORKOUT_DELOAD_HISTORY_KEY } from '../entries/keys';
import { writeList } from '../entries/jsonStorage';
import { replaceWeightGoalRaw } from '../entries/weightGoal';
import {
  SYNC_TABLES,
  SINGLETON_SYNC_ID,
  isTombstone,
  stableStringify,
} from '../syncQueue';
import {
  WEIGHT_GOAL_SYNC_FIELDS,
  DELOAD_RECORD_JSON_FIELDS,
  buildDeloadRecordJson,
  deriveFatigueCheckinRows,
} from './bootstrapPlan';

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
export function withSingletonIds(transport) {
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
  // Tracked-span activation records (#893). They ride the SAME row as the flags
  // they belong to, so the two can never desynchronize: whole-row LWW resolves a
  // conflict for both at once, exactly as it did for the flags alone.
  'tracked_lift_activations',
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
    record.fatigue_tracking_enabled === false &&
    record.deload_mode_enabled === false
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
  const [currentWorkoutId, fatigueMultiplier, trackedLifts, trackedLiftActivations, deloadNote] =
    await Promise.all([
      Storage.loadCurrentWorkoutId(),
      Storage.loadFatigueMultiplier(),
      Storage.loadTrackedLifts(),
      Storage.loadTrackedLiftActivations(),
      loadDeloadNote(),
    ]);
  const note = deloadNote || {};
  return [
    {
      id: SINGLETON_SYNC_ID,
      current_workout_note_id: currentWorkoutId ?? null,
      fatigue_multiplier: fatigueMultiplier ?? null,
      tracked_lifts: trackedLifts ?? {},
      tracked_lift_activations: trackedLiftActivations ?? {},
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

  // #893. Applied independently of the flags above rather than nested under
  // them: a server predating the column serves the pulled winner with no such
  // field, so `undefined` here means "this row cannot speak to the records" and
  // must leave the local ones alone — not clear them. A present-but-empty object
  // IS a real value (every activation retired or untracked) and is applied.
  // Normalized on the way in, because this crossed a trust boundary.
  //
  // The prune below then runs UNCONDITIONALLY, against whatever flags this
  // device now holds. That is the half an older build cannot do for itself: its
  // upsert names `tracked_lifts` and not this column, so Postgres PRESERVES the
  // stored records across its untrack and the pulled row comes back carrying a
  // record for a key that is no longer tracked. Dropping it here is what stops a
  // later retrack from resuming the abandoned span with every gap session inside
  // it. A watermark-aware writer never trips this: it deletes flag and record
  // together, so there is nothing orphaned to drop.
  if (
    row.tracked_lift_activations &&
    typeof row.tracked_lift_activations === 'object' &&
    !Array.isArray(row.tracked_lift_activations)
  ) {
    const next = Storage.normalizeTrackedLiftActivations(row.tracked_lift_activations);
    const local = await Storage.loadTrackedLiftActivations();
    if (stableStringify(local) !== stableStringify(next)) {
      await Storage.saveTrackedLiftActivations(next);
    }
  }

  const flags = await Storage.loadTrackedLifts();
  const records = await Storage.loadTrackedLiftActivations();
  const pruned = Storage.pruneTrackedLiftActivations(flags, records);
  if (stableStringify(pruned) !== stableStringify(records)) {
    await Storage.saveTrackedLiftActivations(pruned);
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
      fatigue_tracking_enabled: !!fatigueTracking,
      deload_mode_enabled: !!deloadMode,
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
export const DIFF_TABLES = Object.freeze([
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

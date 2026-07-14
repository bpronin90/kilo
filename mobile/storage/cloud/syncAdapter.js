import * as Storage from '../entries';
import {
  loadArchivedWeightGoalsRaw,
  replaceArchivedWeightGoalsRaw,
  replaceWeightGoalRaw,
} from '../entries/weightGoal';
import { mergeUserProfile } from '../entries/profileStorage';
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
} from '../syncQueue';
import {
  WEIGHT_GOAL_SYNC_FIELDS,
  DELOAD_RECORD_JSON_FIELDS,
  buildDeloadRecordJson,
} from './bootstrapPlan';
import { getTransport, getRecomputeDerived } from './transport';

// Returns true for a workout-note row created by the legacy-note bootstrap path
// (buildBootstrapPlan's kilo_workout_note import when workoutNotes was empty).
// Only those bootstrap-generated rows carry source_snapshot.async_storage_key;
// user-created notes (including any the user names "Routine 1") never have it.
function isLegacyPhantomNote(note) {
  return (
    !isTombstone(note) &&
    note.source_snapshot != null &&
    note.source_snapshot.async_storage_key === 'kilo_workout_note'
  );
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

async function syncOne(table, tableIo) {
  const io = tableIo[table];
  return syncTable({
    table,
    transport: getTransport(),
    readLocal: io.read,
    writeLocal: io.write,
    recomputeDerived: getRecomputeDerived(),
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

// user_profile ---------------------------------------------------------------

const USER_PROFILE_FIELDS = Object.freeze([
  'display_name',
  'unit_system',
  'current_workout_note_id',
  'fatigue_multiplier',
  'tracked_lifts',
  'ui_state',
]);

// The multiplier a device reports when the user has never touched it.
const DEFAULT_FATIGUE_MULTIPLIER = 1.07;

// True when the local profile carries nothing the user actually authored. A
// singleton row always exists locally (its storage keys fall back to defaults),
// so on the FIRST sync pass this is the only way to tell a clean install apart
// from a user who deliberately cleared every field. Without it, a clean install
// would stamp its empty defaults at `now` and overwrite the cloud profile that
// another device authored. `ui_state` is not consulted: a collapsed panel is not
// user content.
function isEmptyUserProfile(record) {
  const noTrackedLifts =
    !record.tracked_lifts || Object.keys(record.tracked_lifts).length === 0;
  const defaultMultiplier =
    record.fatigue_multiplier == null ||
    Number(record.fatigue_multiplier) === DEFAULT_FATIGUE_MULTIPLIER;
  return (
    record.current_workout_note_id == null &&
    noTrackedLifts &&
    record.display_name == null &&
    record.unit_system == null &&
    defaultMultiplier
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
  const [profile, currentWorkoutId, fatigueMultiplier, trackedLifts, collapsed] =
    await Promise.all([
      Storage.loadUserProfile(),
      Storage.loadCurrentWorkoutId(),
      Storage.loadFatigueMultiplier(),
      Storage.loadTrackedLifts(),
      Storage.loadWorkoutCollapsed(),
    ]);
  return [
    {
      id: SINGLETON_SYNC_ID,
      display_name: profile?.display_name ?? null,
      unit_system: profile?.unit_system ?? null,
      current_workout_note_id: currentWorkoutId ?? null,
      fatigue_multiplier: fatigueMultiplier ?? null,
      tracked_lifts: trackedLifts ?? {},
      ui_state: { log_current_collapsed: !!collapsed },
    },
  ];
}

async function applyUserProfile(mergedList) {
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

// Sync order note: workout_notes runs before user_profile, so a routine pulled in
// the same pass already exists locally by the time current_workout_note_id points
// at it.
const DIFF_TABLES = Object.freeze([
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
    fieldKinds: { fatigue_multiplier: 'number' },
    allowDelete: false,
    isEmptyLocal: isEmptyUserProfile,
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
  await tombstoneLocalPhantoms();
  const results = [];
  for (const table of [
    SYNC_TABLES.WEIGHT_ENTRIES,
    SYNC_TABLES.WORKOUT_NOTES,
    SYNC_TABLES.ARCHIVED_WEIGHT_GOALS,
  ]) {
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

  // The four tables bootstrap used to push once and abandon (issue #489). Run
  // them after the workout-note passes above (including the phantom-tombstone
  // rerun, which can clear the current routine) so user_profile uploads the
  // settled current_workout_note_id rather than one this pass is about to drop.
  const singletonAware = withSingletonIds(getTransport());
  for (const config of DIFF_TABLES) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await syncDiffTable({ ...config, transport: singletonAware }));
  }
  return results;
}

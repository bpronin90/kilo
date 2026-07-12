import * as Storage from '../entries';
import { loadArchivedWeightGoalsRaw, replaceArchivedWeightGoalsRaw } from '../entries/weightGoal';
import {
  SYNC_TABLES,
  syncTable,
  isTombstone,
  stampTombstone,
  getClientId,
  enqueueDirty,
} from '../syncQueue';
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
  for (const ts of toEnqueue) {
    // eslint-disable-next-line no-await-in-loop
    await enqueueDirty(SYNC_TABLES.WORKOUT_NOTES, ts);
  }
}

const TABLE_IO = {
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
      for (const ts of tombstoned) {
        // eslint-disable-next-line no-await-in-loop
        await enqueueDirty(SYNC_TABLES.WORKOUT_NOTES, ts);
      }
    },
  },
  [SYNC_TABLES.ARCHIVED_WEIGHT_GOALS]: {
    read: () => loadArchivedWeightGoalsRaw(),
    write: (list) => replaceArchivedWeightGoalsRaw(list),
  },
};

async function syncOne(table) {
  const io = TABLE_IO[table];
  return syncTable({
    table,
    transport: getTransport(),
    readLocal: io.read,
    writeLocal: io.write,
    recomputeDerived: getRecomputeDerived(),
  });
}

export async function sync() {
  await tombstoneLocalPhantoms();
  const results = [];
  for (const table of [
    SYNC_TABLES.WEIGHT_ENTRIES,
    SYNC_TABLES.WORKOUT_NOTES,
    SYNC_TABLES.ARCHIVED_WEIGHT_GOALS,
  ]) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await syncOne(table));
  }
  return results;
}

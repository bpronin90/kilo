import * as Storage from '../entries';
import { loadArchivedWeightGoalsRaw, replaceArchivedWeightGoalsRaw } from '../entries/weightGoal';
import { SYNC_TABLES, syncTable } from '../syncQueue';
import { getTransport, getRecomputeDerived } from './transport';

const TABLE_IO = {
  [SYNC_TABLES.WEIGHT_ENTRIES]: {
    read: () => Storage.loadWeightEntriesRaw(),
    write: (list) => Storage.replaceWeightEntriesRaw(list),
  },
  [SYNC_TABLES.WORKOUT_NOTES]: {
    read: () => Storage.loadWorkoutNotesRaw(),
    write: (list) => Storage.replaceWorkoutNotesRaw(list),
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

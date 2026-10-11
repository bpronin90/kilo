// Movement-group overrides (#1306): persistence, restore, sync and the write
// path. Drives the real storage layer (in-memory AsyncStorage) and the real sync
// engine against an in-memory transport; asserts the stored / read-back value,
// not just the absence of an error.

import AsyncStorage from '@react-native-async-storage/async-storage';

import * as Storage from '../storage/entries';
import { setCloudTransport } from '../storage/cloudAdapter';
import { sync } from '../storage/cloud/syncAdapter';
import { exportBackup, importBackup, IMPORT_MODES } from '../storage/entries/backupImport';
import { updateWorkoutNoteItem } from '../storage/entries/workoutNotes';
import { setMovementGroupCore } from '../hooks/entries/movementGroupHooks';
import { buildBootstrapPlan } from '../storage/cloudAdapter';
import { createSupabaseTransport, resetValidatedUserCacheForTests } from '../storage/cloud/transport';
import {
  SYNC_TABLES, getDirtyRecords, isTombstone, resetClientIdCacheForTests, resetStampClockForTests, DERIVED_NOTE_FIELDS,
} from '../storage/syncQueue';
import { __resetSyncQueue } from '../storage/syncRecovery';

jest.mock('../hooks/entries/workoutNoteHooks', () => ({
  notifyWorkoutNotes: jest.fn(),
  reloadWorkoutNotes: jest.fn(),
}));

const MAP = { version: 1, overrides: { deadlift: 'legs' } };
const storage = {
  loadNotes: () => Storage.loadWorkoutNotes(),
  updateNote: (id, patch) => updateWorkoutNoteItem(id, patch),
};
const note = (extra = {}) => ({ id: 'wn-1', title: 'Routine', raw_text: 'Deadlift 100x5', saved_at: '2026-07-01T08:00:00.000Z', ...extra });
const stored = async (id = 'wn-1') => (await Storage.loadWorkoutNotes()).find(n => n.id === id);

beforeEach(async () => {
  await AsyncStorage.clear();
  resetClientIdCacheForTests();
  resetStampClockForTests();
  __resetSyncQueue();
  Storage.setStorageMode(Storage.STORAGE_MODES.LOCAL);
});

describe('local write path', () => {
  test('set, change and reset persist and read back after a fresh read (restart)', async () => {
    await Storage.saveWorkoutNoteItem(note());
    expect(await setMovementGroupCore(storage, { noteId: 'wn-1', key: 'Deadlift', group: 'legs' })).toMatchObject({ ok: true, map: MAP });
    expect((await stored()).exercise_movement_groups).toEqual(MAP);

    await setMovementGroupCore(storage, { noteId: 'wn-1', key: 'deadlift', group: 'other' });
    expect((await stored()).exercise_movement_groups).toEqual({ version: 1, overrides: { deadlift: 'other' } });

    await setMovementGroupCore(storage, { noteId: 'wn-1', key: 'deadlift', group: null });
    // Reset removes the key; the emptied map stays a map so the cleared state syncs.
    expect((await stored()).exercise_movement_groups).toEqual({ version: 1, overrides: {} });
  });

  test('an unchanged choice does not write again', async () => {
    await Storage.saveWorkoutNoteItem(note({ exercise_movement_groups: MAP }));
    const before = (await stored()).updated_at;
    expect(await setMovementGroupCore(storage, { noteId: 'wn-1', key: 'deadlift', group: 'legs' })).toMatchObject({ ok: true, unchanged: true });
    expect((await stored()).updated_at).toBe(before);
  });

  test('missing or deleted baseline note: reported, nothing written', async () => {
    expect(await setMovementGroupCore(storage, { noteId: 'nope', key: 'deadlift', group: 'legs' })).toMatchObject({ ok: false, error: expect.stringMatching(/no longer available/) });
    await Storage.saveWorkoutNoteItem(note({ deleted_at: '2026-07-02T00:00:00.000Z' }));
    expect(await setMovementGroupCore(storage, { noteId: 'wn-1', key: 'deadlift', group: 'legs' })).toMatchObject({ ok: false });
  });

  test('an invalid stored map is refused, not overwritten', async () => {
    const bad = { version: 7, overrides: { deadlift: 'hinge' } };
    await Storage.saveWorkoutNoteItem(note({ exercise_movement_groups: bad }));
    expect(await setMovementGroupCore(storage, { noteId: 'wn-1', key: 'squat', group: 'legs' })).toMatchObject({ ok: false });
    expect((await stored()).exercise_movement_groups).toEqual(bad);
  });

  test('a failed write is reported and leaves the stored value untouched', async () => {
    await Storage.saveWorkoutNoteItem(note({ exercise_movement_groups: MAP }));
    const failing = { ...storage, updateNote: async () => { throw new Error('disk full'); } };
    const result = await setMovementGroupCore(failing, { noteId: 'wn-1', key: 'squat', group: 'push' });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('disk full') });
    expect((await stored()).exercise_movement_groups).toEqual(MAP);
  });

  test('a write whose read-back differs is not reported as saved', async () => {
    await Storage.saveWorkoutNoteItem(note());
    const lying = { ...storage, updateNote: async (id) => ({ ...(await stored(id)) }) };
    expect(await setMovementGroupCore(lying, { noteId: 'wn-1', key: 'squat', group: 'push' })).toMatchObject({ ok: false });
  });

  test('concurrent override writes (and an ordinary save) all land', async () => {
    await Storage.saveWorkoutNoteItem(note());
    await Promise.all([
      setMovementGroupCore(storage, { noteId: 'wn-1', key: 'deadlift', group: 'legs' }),
      setMovementGroupCore(storage, { noteId: 'wn-1', key: 'squat', group: 'hinge' }),
      updateWorkoutNoteItem('wn-1', { exercise_classifications: { deadlift: 'progressing' } }),
      setMovementGroupCore(storage, { noteId: 'wn-1', key: 'bench press', group: 'other' }),
    ]);
    const n = await stored();
    expect(n.exercise_movement_groups).toEqual({ version: 1, overrides: { deadlift: 'legs', squat: 'hinge', 'bench press': 'other' } });
    expect(n.exercise_classifications).toEqual({ deadlift: 'progressing' });
  });

  test('ordinary save / classification recomputation preserves overrides; classifications stay string states', async () => {
    await Storage.saveWorkoutNoteItem(note({ exercise_movement_groups: MAP, exercise_classifications: { deadlift: 'stalled' } }));
    // The shape currentRoutineSave writes: a classifications-only patch.
    await updateWorkoutNoteItem('wn-1', { exercise_classifications: { deadlift: 'progressing', squat: 'initial' } });
    const n = await stored();
    expect(n.exercise_movement_groups).toEqual(MAP);
    expect(Object.values(n.exercise_classifications).every(v => typeof v === 'string')).toBe(true);
    // Override choices are not stored in (or derived into) the classifications map.
    expect(n.exercise_classifications.deadlift).toBe('progressing');
  });

  test('the overrides are authored content, not a derived cache field', () => {
    expect(DERIVED_NOTE_FIELDS).toContain('exercise_classifications');
    expect(DERIVED_NOTE_FIELDS).not.toContain('exercise_movement_groups');
  });
});

describe('backup export and restore', () => {
  test('export -> restore round-trips overrides exactly; omitted stays omitted', async () => {
    await Storage.saveWorkoutNoteItem(note({ exercise_movement_groups: MAP }));
    await Storage.saveWorkoutNoteItem(note({ id: 'wn-legacy', title: 'Old' }));
    const backup = JSON.parse(JSON.stringify(await exportBackup()));
    expect(backup.workout_notes.find(n => n.id === 'wn-1').exercise_movement_groups).toEqual(MAP);

    await AsyncStorage.clear();
    expect((await importBackup(backup, 'replace')).ok).toBe(true);
    expect((await stored()).exercise_movement_groups).toEqual(MAP);
    expect(Object.prototype.hasOwnProperty.call(await stored('wn-legacy'), 'exercise_movement_groups')).toBe(false);
  });

  test('an old backup without the field restores without inventing overrides', async () => {
    const legacy = { version: '3', exported_at: '2026-07-10T00:00:00.000Z', weight_entries: [], workout_notes: [note()], current_workout_id: 'wn-1', weight_goal: null, deload_history: [] };
    expect((await importBackup(legacy, 'replace')).ok).toBe(true);
    expect((await stored()).exercise_movement_groups).toBeUndefined();
  });

  test.each([
    ['unknown group id', { version: 1, overrides: { squat: 'quads' } }],
    ['multi-group array', { version: 1, overrides: { squat: ['legs', 'hinge'] } }],
    ['unsupported version', { version: 2, overrides: {} }],
    ['extra field', { version: 1, overrides: {}, extra: true }],
  ])('a backup carrying %s is rejected and nothing is restored', async (_l, bad) => {
    await Storage.saveWorkoutNoteItem(note({ id: 'wn-existing' }));
    const backup = { version: '3', exported_at: '2026-07-10T00:00:00.000Z', weight_entries: [], workout_notes: [note({ exercise_movement_groups: bad })], current_workout_id: null, weight_goal: null, deload_history: [] };
    const result = await importBackup(backup, 'replace');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/exercise_movement_groups/);
    expect((await Storage.loadWorkoutNotes()).map(n => n.id)).toEqual(['wn-existing']);
  });
});

// ── cloud: bootstrap, upload, pull, LWW ──────────────────────────────────────

function makeFakeCloud() {
  const tables = {};
  for (const table of Object.values(SYNC_TABLES)) tables[table] = new Map();
  let ms = Date.now();
  const transport = {
    async pull(table, cursor) {
      const rows = [...tables[table].values()].filter(r => !cursor || (r.updated_at || '') >= cursor);
      // eslint-disable-next-line no-unused-vars
      return rows.sort((a, b) => a.updated_at.localeCompare(b.updated_at)).map(({ client_id: _c, ...r }) => r);
    },
    async push(table, records) {
      return records.map((rec) => {
        // eslint-disable-next-line no-unused-vars
        const { client_id: _c, ...row } = rec;
        ms += 1000;
        const stored = { ...row, updated_at: new Date(ms).toISOString() };
        tables[table].set(rec.id, stored);
        return stored;
      });
    },
  };
  return { transport, remote: (table, id) => tables[table].get(id), seed: (table, row) => tables[table].set(row.id, row) };
}

describe('cloud sync', () => {
  let cloud;
  beforeEach(() => {
    cloud = makeFakeCloud();
    setCloudTransport(cloud.transport);
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
  });
  afterEach(() => {
    setCloudTransport(null);
    Storage.setStorageMode(Storage.STORAGE_MODES.LOCAL);
    __resetSyncQueue();
  });

  test('an override-only edit is a real edit: it queues, uploads, and is not discarded as cache-only', async () => {
    const adapter = Storage.getStorageAdapter();
    await adapter.saveWorkoutNoteItem(note());
    await sync();
    expect(cloud.remote(SYNC_TABLES.WORKOUT_NOTES, 'wn-1').exercise_movement_groups).toBeUndefined();

    const cloudStorage = {
      loadNotes: () => adapter.loadWorkoutNotes(),
      updateNote: (id, patch) => adapter.updateWorkoutNoteItem(id, patch),
    };
    expect((await setMovementGroupCore(cloudStorage, { noteId: 'wn-1', key: 'deadlift', group: 'legs' })).ok).toBe(true);
    const dirty = (await getDirtyRecords(SYNC_TABLES.WORKOUT_NOTES)).find(r => r.id === 'wn-1');
    expect(dirty.exercise_movement_groups).toEqual(MAP);

    await sync();
    expect(cloud.remote(SYNC_TABLES.WORKOUT_NOTES, 'wn-1').exercise_movement_groups).toEqual(MAP);
  });

  test('a second device pulls the override; a legacy remote row (column absent) invents none', async () => {
    cloud.seed(SYNC_TABLES.WORKOUT_NOTES, { id: 'wn-a', title: 'A', raw_text: 'x', updated_at: '2026-07-01T00:00:00.000Z', exercise_movement_groups: MAP });
    cloud.seed(SYNC_TABLES.WORKOUT_NOTES, { id: 'wn-b', title: 'B', raw_text: 'y', updated_at: '2026-07-01T00:00:00.000Z' });
    await sync();
    const notes = await Storage.getStorageAdapter().loadWorkoutNotes();
    expect(notes.find(n => n.id === 'wn-a').exercise_movement_groups).toEqual(MAP);
    expect(notes.find(n => n.id === 'wn-b').exercise_movement_groups).toBeUndefined();
  });

  test('row-level LWW: the later override edit wins over an earlier remote override', async () => {
    const adapter = Storage.getStorageAdapter();
    await adapter.saveWorkoutNoteItem(note({ exercise_movement_groups: { version: 1, overrides: { deadlift: 'other' } } }));
    await sync();
    await adapter.updateWorkoutNoteItem('wn-1', { exercise_movement_groups: MAP });
    await sync();
    const remote = cloud.remote(SYNC_TABLES.WORKOUT_NOTES, 'wn-1');
    expect(remote.exercise_movement_groups).toEqual(MAP);
    const local = (await adapter.loadWorkoutNotes()).find(n => n.id === 'wn-1');
    expect(local.exercise_movement_groups).toEqual(MAP);
    expect(isTombstone(local)).toBe(false);
  });

  test('bootstrap carries overrides, and a legacy note row is unchanged (no new key)', () => {
    const plan = buildBootstrapPlan({
      workoutNotes: [note({ exercise_movement_groups: MAP }), note({ id: 'wn-legacy' })],
      currentWorkoutId: null,
    }, '11111111-1111-1111-1111-111111111111');
    const rows = plan.workout_notes || plan[SYNC_TABLES.WORKOUT_NOTES];
    expect(rows.find(r => r.id === 'wn-1').exercise_movement_groups).toEqual(MAP);
    expect(Object.prototype.hasOwnProperty.call(rows.find(r => r.id === 'wn-legacy'), 'exercise_movement_groups')).toBe(false);
  });
});

describe('mixed-shape upserts and replace restore', () => {
  beforeEach(() => resetValidatedUserCacheForTests());

  test('a note omitting the column is never sent in a request that names it', async () => {
    const calls = [];
    const client = {
      auth: { async getUser() { return { data: { user: { id: 'u1' } }, error: null }; } },
      schema() {
        return { from(table) { return { upsert(rows) { calls.push({ table, rows }); return { async select() { return { data: rows, error: null }; } }; } }; } };
      },
    };
    const transport = createSupabaseTransport(() => client);
    const out = await transport.push(SYNC_TABLES.WORKOUT_NOTES, [
      { id: 'a', raw_text: 'x', exercise_movement_groups: MAP },
      { id: 'b', raw_text: 'y' },
      { id: 'c', raw_text: 'z', exercise_movement_groups: null },
    ]);
    expect(calls).toHaveLength(2);
    const withKey = calls.filter(c => 'exercise_movement_groups' in c.rows[0]);
    expect(withKey.flatMap(c => c.rows.map(r => r.id)).sort()).toEqual(['a', 'c']);
    for (const c of calls) {
      expect(new Set(c.rows.map(r => 'exercise_movement_groups' in r)).size).toBe(1);
    }
    expect(calls.find(c => c.rows[0].id === 'b').rows).toEqual([{ user_id: 'u1', id: 'b', raw_text: 'y' }]);
    expect(out.map(r => r.id).sort()).toEqual(['a', 'b', 'c']);
  });

  test('cloud replace restore from a legacy backup uploads an explicit null and clears the old override', async () => {
    const cloud = makeFakeCloud();
    setCloudTransport(cloud.transport);
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    try {
      const adapter = Storage.getStorageAdapter();
      await adapter.saveWorkoutNoteItem(note({ exercise_movement_groups: MAP }));
      await sync();
      expect(cloud.remote(SYNC_TABLES.WORKOUT_NOTES, 'wn-1').exercise_movement_groups).toEqual(MAP);

      const legacy = { version: '3', exported_at: '2026-07-10T00:00:00.000Z', weight_entries: [], workout_notes: [note({ raw_text: 'Deadlift 110x5' })], current_workout_id: 'wn-1', weight_goal: null, deload_history: [] };
      expect((await importBackup(legacy, 'replace', { mode: IMPORT_MODES.CLOUD })).ok).toBe(true);
      const dirty = (await getDirtyRecords(SYNC_TABLES.WORKOUT_NOTES)).find(r => r.id === 'wn-1');
      expect(dirty.exercise_movement_groups).toBeNull();
      await sync();
      expect(cloud.remote(SYNC_TABLES.WORKOUT_NOTES, 'wn-1').exercise_movement_groups).toBeNull();
      const local = (await adapter.loadWorkoutNotes()).find(n => n.id === 'wn-1');
      expect(local.exercise_movement_groups ?? null).toBeNull();
    } finally {
      setCloudTransport(null);
      Storage.setStorageMode(Storage.STORAGE_MODES.LOCAL);
      __resetSyncQueue();
    }
  });
});

describe('upload whitelist', () => {
  beforeEach(() => resetValidatedUserCacheForTests());

  test('the upsert row includes the override column when present and omits it when absent', async () => {
    const calls = [];
    const client = {
      auth: { async getUser() { return { data: { user: { id: 'u1' } }, error: null }; } },
      schema() {
        return { from(table) { return { upsert(rows) { calls.push({ table, rows }); return { async select() { return { data: rows, error: null }; } }; } }; } };
      },
    };
    const transport = createSupabaseTransport(() => client);
    await transport.push(SYNC_TABLES.WORKOUT_NOTES, [
      { id: 'a', raw_text: 'x', exercise_movement_groups: MAP, bogus: 1 },
      { id: 'b', raw_text: 'y' },
    ]);
    expect(calls[0].rows).toEqual([{ user_id: 'u1', id: 'a', raw_text: 'x', exercise_movement_groups: MAP }]);
    expect(calls[1].rows).toEqual([{ user_id: 'u1', id: 'b', raw_text: 'y' }]);
  });
});

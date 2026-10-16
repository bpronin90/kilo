// #1172: every workout-notes read-modify-write shares one notebook lock.
// Each race fixture is deterministic: the first operation is paused right
// after it reads the notebook, the second is started, then the first resumes.
// Without the lock the second commits inside the gap and one change is lost.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { secureStorage } from '../storage/secureStorage';
import * as Storage from '../storage/entries';
import * as LocalNotes from '../storage/entries/workoutNotes';
import * as CloudNotes from '../storage/cloud/cloudDomainMethods';
import {
  NORMALIZATION_APPLY_INTENT_KEY,
  TRACKED_LIFTS_KEY,
  TRACKED_LIFT_ACTIVATIONS_KEY,
  WORKOUT_NOTES_KEY,
} from '../storage/entries/keys';
import { buildTrackedLiftActivation } from '../lib/data/workoutAnalytics';
import { parseWorkoutNote } from '../lib/parser';
import { migrateToNotebook } from '../storage/entries/migrations';
import { purgePersistedDerivedSections } from '../storage/entries/derivedCachePurge';
import { importBackup, IMPORT_MODES } from '../storage/entries/backupRestore';
import { createPassCache } from '../storage/cloud/syncTableIo';
import { cloudAdapter } from '../storage/cloudAdapter';
import { localAdapter } from '../storage/localAdapter';
import { getDirtyRecords, SYNC_TABLES } from '../storage/syncQueue';

jest.mock('../lib/supabaseClient', () => ({ getSupabaseClient: jest.fn() }));

const AUTH = { id: 'a', title: 'Auth', raw_text: 'Monday\n-Bench Press 3x5' };
const NOTE = { id: 'n1', title: 'Upper', raw_text: 'Monday\n-bench 3x5' };
const T2 = { id: 'n2', title: 'Upper', raw_text: 'Friday\n-bb bench 3x5' };
const NEXT = 'Monday\n-Bench Press 3x5';
const T2_NEXT = 'Friday\n-Bench Press 3x5';
const request = () => ({
  authority: { id: 'a', expected_raw_text: AUTH.raw_text, accepted_raw_texts: [] },
  items: [
    { id: 'n1', expected_raw_text: NOTE.raw_text, next_raw_text: NEXT },
    { id: 'n2', expected_raw_text: T2.raw_text, next_raw_text: T2_NEXT },
  ],
});

beforeEach(async () => { await AsyncStorage.clear(); });

const notes = async () => Storage.loadWorkoutNotesRaw();
const byId = async id => (await notes()).find(n => n.id === id);
const tick = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };

// Pause the next notebook read until released.
function gateNextNotebookRead() {
  const original = secureStorage.getItem.bind(secureStorage);
  let release;
  let reached;
  const gate = new Promise(r => { release = r; });
  const hit = new Promise(r => { reached = r; });
  const spy = jest.spyOn(secureStorage, 'getItem').mockImplementation(async key => {
    const value = await original(key);
    if (key === WORKOUT_NOTES_KEY) { spy.mockRestore(); reached(); await gate; }
    return value;
  });
  return { hit, release };
}

async function interleave(first, second) {
  const gate = gateNextNotebookRead();
  const a = first();
  await gate.hit;
  const b = second();
  await tick();
  gate.release();
  return Promise.all([a, b]);
}

const seed = async (api, list = [AUTH, NOTE, T2]) => { for (const n of list) await api.saveWorkoutNoteItem(n); };

describe.each([
  ['local', LocalNotes],
  ['cloud', CloudNotes],
])('%s note writers vs batch/CAS', (_mode, api) => {
  test('batch writes every selected target; authority recheck rejects all when it changed', async () => {
    await seed(api);
    const ok = await api.applyWorkoutNoteTextBatchIfUnchanged(request());
    expect(ok.saved.map(r => r.id).sort()).toEqual(['n1', 'n2']);
    await AsyncStorage.clear();
    await seed(api);
    const [, stale] = await interleave(() => api.updateWorkoutNoteItem('a', { raw_text: 'Monday\n-Barbell Bench 3x5' }), () => api.applyWorkoutNoteTextBatchIfUnchanged(request()));
    expect(stale.authority).toBe('stale');
    expect((await byId('n1')).raw_text).toBe(NOTE.raw_text);
  });

  test('a target edited under the gap is skipped; siblings proceed', async () => {
    await seed(api);
    const [, result] = await interleave(() => api.saveWorkoutNoteItem({ ...T2, raw_text: 'Friday\n-newer' }), () => api.applyWorkoutNoteTextBatchIfUnchanged(request()));
    expect(result.skipped).toEqual([expect.objectContaining({ id: 'n2', status: 'stale' })]);
    expect((await byId('n2')).raw_text).toBe('Friday\n-newer');
    expect((await byId('n1')).raw_text).toBe(NEXT);
  });

  test('editor update read before a CAS keeps both changes', async () => {
    await seed(api);
    const [, status] = await interleave(() => api.updateWorkoutNoteItem('n1', { activeWeek: 1 }), () => api.compareAndSetWorkoutNoteText('n1', NOTE.raw_text, NEXT));
    expect(status).toBe('saved');
    expect(await byId('n1')).toEqual(expect.objectContaining({ raw_text: NEXT, activeWeek: 1 }));
  });

  test('setCurrentWorkoutNote read before a batch keeps both changes', async () => {
    await seed(api);
    await interleave(() => Storage.setCurrentWorkoutNote('n2'), () => api.applyWorkoutNoteTextBatchIfUnchanged(request()));
    expect((await byId('n2')).isCurrent).toBe(true);
    expect((await byId('n1')).raw_text).toBe(NEXT);
  });

  test('setCurrentWorkoutNote read before a CAS keeps both changes', async () => {
    await seed(api);
    await interleave(() => Storage.setCurrentWorkoutNote('n2'), () => api.compareAndSetWorkoutNoteText('n1', NOTE.raw_text, NEXT));
    expect((await byId('n2')).isCurrent).toBe(true);
    expect((await byId('n1')).raw_text).toBe(NEXT);
  });

  test('migration normalization read before a batch keeps both changes', async () => {
    await seed(api);
    await interleave(() => migrateToNotebook(), () => api.applyWorkoutNoteTextBatchIfUnchanged(request()));
    const n1 = await byId('n1');
    expect(n1.raw_text).toBe(NEXT);
    expect('isCurrent' in n1).toBe(true);
  });

  test('a lock step that rejects does not wedge later writers', async () => {
    await expect(LocalNotes.withWorkoutNotebookLock(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await seed(api);
    expect(await api.compareAndSetWorkoutNoteText('n1', NOTE.raw_text, NEXT)).toBe('saved');
  });
});

describe('cloud-only writers vs batch', () => {
  test('ensureWorkoutNoteLive replay read before a batch keeps both', async () => {
    await seed(CloudNotes);
    const seedRow = { id: 'r1', title: 'Replayed', raw_text: 'Sunday', updated_at: '2026-01-01T00:00:00.000Z' };
    await interleave(() => CloudNotes.ensureWorkoutNoteLive(seedRow), () => CloudNotes.applyWorkoutNoteTextBatchIfUnchanged(request()));
    expect((await byId('r1')).raw_text).toBe('Sunday');
    expect((await byId('n1')).raw_text).toBe(NEXT);
  });

  test('ensureWorkoutNoteDeleted replay read before a batch keeps both', async () => {
    await seed(CloudNotes, [AUTH, NOTE, T2, { id: 'gone', title: 'x', raw_text: 'x' }]);
    await interleave(() => CloudNotes.ensureWorkoutNoteDeleted('gone'), () => CloudNotes.applyWorkoutNoteTextBatchIfUnchanged(request()));
    expect((await byId('gone')).deleted_at).toBeTruthy();
    expect((await byId('n1')).raw_text).toBe(NEXT);
  });

  test('cloud backup restore read before a batch: batch sees the restored notebook', async () => {
    await seed(CloudNotes);
    const backup = { version: '3', exported_at: '2026-07-10T00:00:00.000Z', weight_entries: [], workout_notes: [{ ...AUTH }, { id: 'n1', title: 'Upper', raw_text: 'Restored' }], current_workout_id: 'a', weight_goal: null, fatigue_multiplier: 1, deload_history: [] };
    const [, result] = await interleave(() => importBackup(backup, 'replace', { mode: IMPORT_MODES.CLOUD }), () => CloudNotes.applyWorkoutNoteTextBatchIfUnchanged(request()));
    expect(result.skipped.map(s => s.id).sort()).toEqual(['n1', 'n2']);
    expect((await byId('n1')).raw_text).toBe('Restored');
  });

  test('sync pass reload read before a batch keeps both the pulled row and the batch', async () => {
    await seed(CloudNotes);
    const cache = createPassCache();
    const base = await cache.read(SYNC_TABLES.WORKOUT_NOTES, Storage.loadWorkoutNotesRaw);
    const pulled = [...base, { id: 'remote', title: 'Pulled', raw_text: 'Friday' }];
    await interleave(() => cache.write(SYNC_TABLES.WORKOUT_NOTES, pulled, Storage.replaceWorkoutNotesRaw, Storage.loadWorkoutNotesRaw), () => CloudNotes.applyWorkoutNoteTextBatchIfUnchanged(request()));
    expect((await byId('remote')).raw_text).toBe('Friday');
    expect((await byId('n1')).raw_text).toBe(NEXT);
  });

  test('a failed enqueue reports landed, not pending_sync; Retry re-queues the landed text', async () => {
    await seed(CloudNotes);
    // eslint-disable-next-line global-require
    const queue = require('../storage/syncQueue');
    const spy = jest.spyOn(queue, 'enqueueDirty').mockRejectedValueOnce(new Error('queue down'));
    const first = await CloudNotes.applyWorkoutNoteTextBatchIfUnchanged(request());
    spy.mockRestore();
    expect(first.failed).toEqual([expect.objectContaining({ id: 'n1', landed: true, pending_sync: false })]);
    expect((await byId('n1')).raw_text).toBe(NEXT);
    const retry = await CloudNotes.applyWorkoutNoteTextBatchIfUnchanged({ ...request(), items: [request().items[0]] });
    expect(retry.saved).toEqual([expect.objectContaining({ id: 'n1', pending_sync: true })]);
    expect(JSON.stringify(await getDirtyRecords(SYNC_TABLES.WORKOUT_NOTES))).toContain('"id":"n1"');
  });
});

describe('replace-only writers vs a batch that already read', () => {
  test('local backup restore waits for the batch and then wins intact', async () => {
    await seed(LocalNotes);
    const backup = { version: '3', exported_at: '2026-07-10T00:00:00.000Z', weight_entries: [], workout_notes: [{ id: 'n1', title: 'Upper', raw_text: 'Restored' }], current_workout_id: 'n1', weight_goal: null, fatigue_multiplier: 1, deload_history: [] };
    const [result] = await interleave(() => LocalNotes.applyWorkoutNoteTextBatchIfUnchanged(request()), () => importBackup(backup, 'replace', { mode: IMPORT_MODES.LOCAL }));
    expect(result.saved.length).toBe(2);
    expect((await notes()).map(n => [n.id, n.raw_text])).toEqual([['n1', 'Restored']]);
  });

  test('derived-cache purge waits for the batch and keeps its write', async () => {
    await seed(LocalNotes);
    await interleave(() => LocalNotes.applyWorkoutNoteTextBatchIfUnchanged(request()), () => purgePersistedDerivedSections());
    expect((await byId('n1')).raw_text).toBe(NEXT);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #1395: the batch carries Track to the renamed key in ONE recoverable commit
// ─────────────────────────────────────────────────────────────────────────────

const RA = { id: 'ra', title: 'Auth', raw_text: 'Monday\n-DB Bench Press 3x6-8\n60 8' };
const RT = { id: 'rt', title: 'Upper', raw_text: 'Monday\n-DB Bench Press 3x6-8, step up\n60 8\n60 8' };
const RT_NEXT = 'Monday\n-DB Bench Press 3x6-8\n60 8\n60 8\n-- step up';
const SRC = 'db bench press 3x6-8, step up';
const DST = 'db bench press';
const AT = '2026-09-01T00:00:00.000Z';
const ROW_RECORD = { anchor: 0, at: AT, witness: null };
const renameRequest = () => ({
  authority: { id: 'ra', expected_raw_text: RA.raw_text, accepted_raw_texts: [] },
  items: [{ id: 'rt', expected_raw_text: RT.raw_text, next_raw_text: RT_NEXT }],
});
const sourceRecord = () => buildTrackedLiftActivation(parseWorkoutNote(`${RA.raw_text}\n---\n${RT.raw_text}`).sections, 'DB Bench Press 3x6-8, step up', new Date(AT));

async function seedRename(api) {
  await seed(api, [RA, RT]);
  await Storage.saveTrackedLifts({ [SRC]: true, row: true });
  await Storage.saveTrackedLiftActivations({ [SRC]: sourceRecord(), row: ROW_RECORD });
}

// The whole durable tuple a rename commits: note text, flags, records, intent.
async function tuple() {
  return {
    text: (await byId('rt')).raw_text,
    lifts: await Storage.loadTrackedLifts(),
    activations: await Storage.loadTrackedLiftActivations(),
    intent: await AsyncStorage.getItem(NORMALIZATION_APPLY_INTENT_KEY),
  };
}
const BEFORE = () => ({ text: RT.raw_text, lifts: { [SRC]: true, row: true }, activations: { [SRC]: sourceRecord(), row: ROW_RECORD }, intent: null });
// The authority holds one destination session, then the two moved ones; both
// moved sessions were excluded, so the translated boundary is 3.
const AFTER = () => ({
  text: RT_NEXT,
  lifts: { row: true, [DST]: true },
  activations: { row: ROW_RECORD, [DST]: { anchor: 3, at: AT, witness: { headings: ['Monday'], sessions: expect.any(String) } } },
  intent: null,
});

// Fail chosen device-store writes. AsyncStorage is the package's jest mock, so
// swap implementations and put the originals back rather than spying.
function failStore(shouldFail) {
  const realSet = AsyncStorage.setItem.getMockImplementation();
  const realRemove = AsyncStorage.removeItem.getMockImplementation();
  AsyncStorage.setItem.mockImplementation((key, value) => (shouldFail('set', key) ? Promise.reject(new Error(`disk full at ${key}`)) : realSet(key, value)));
  AsyncStorage.removeItem.mockImplementation(key => (shouldFail('remove', key) ? Promise.reject(new Error(`disk full at ${key}`)) : realRemove(key)));
  return () => {
    AsyncStorage.setItem.mockImplementation(realSet);
    AsyncStorage.removeItem.mockImplementation(realRemove);
  };
}
const once = (kind, key) => {
  let fired = false;
  return (k, target) => {
    if (fired || k !== kind || target !== key) return false;
    fired = true;
    return true;
  };
};
const FAULTS = [
  ['intent write', 'set', NORMALIZATION_APPLY_INTENT_KEY],
  ['note write', 'set', WORKOUT_NOTES_KEY],
  ['flag write', 'set', TRACKED_LIFTS_KEY],
  ['activation write', 'set', TRACKED_LIFT_ACTIVATIONS_KEY],
  ['intent clear', 'remove', NORMALIZATION_APPLY_INTENT_KEY],
];

describe.each([
  ['local', LocalNotes],
  ['cloud', CloudNotes],
])('%s rename batch carries Track (#1395)', (mode, api) => {
  test('commits note text, flags and translated activation together; a retry translates nothing twice', async () => {
    await seedRename(api);
    const result = await api.applyWorkoutNoteTextBatchIfUnchanged(renameRequest());
    expect(result.saved).toEqual([{ id: 'rt', pending_sync: mode === 'cloud' }]);
    expect(result.tracking.lifts).toEqual({ row: true, [DST]: true });
    expect(await tuple()).toEqual(AFTER());
    if (mode === 'cloud') expect((await getDirtyRecords(SYNC_TABLES.WORKOUT_NOTES)).some(r => r.id === 'rt' && r.raw_text === RT_NEXT)).toBe(true);
    const retry = await api.applyWorkoutNoteTextBatchIfUnchanged(renameRequest());
    expect(retry.saved.map(r => r.id)).toEqual(['rt']);
    expect(retry.tracking).toBeUndefined();
    expect(await tuple()).toEqual(AFTER());
  });

  test.each(FAULTS)('a failed %s rolls the whole tuple back and reports failure, not success', async (_name, kind, key) => {
    await seedRename(api);
    const restore = failStore(once(kind, key));
    const result = await api.applyWorkoutNoteTextBatchIfUnchanged(renameRequest());
    restore();
    expect(result.saved).toEqual([]);
    expect(result.failed).toEqual([expect.objectContaining({ id: 'rt', pending_sync: false })]);
    expect(result.failed[0].landed).toBeUndefined();
    expect(await tuple()).toEqual(BEFORE());
    // Nothing is left behind: the next apply commits the full tuple.
    expect((await api.applyWorkoutNoteTextBatchIfUnchanged(renameRequest())).saved.map(r => r.id)).toEqual(['rt']);
    expect(await tuple()).toEqual(AFTER());
  });

  test('when rollback also fails the item is landed and the recorded commit finishes later, once', async () => {
    await seedRename(api);
    const restore = failStore((kind, key) => kind === 'set' && key === TRACKED_LIFT_ACTIVATIONS_KEY);
    const result = await api.applyWorkoutNoteTextBatchIfUnchanged(renameRequest());
    expect(result.failed).toEqual([expect.objectContaining({ id: 'rt', landed: true, pending_sync: false })]);
    expect(await AsyncStorage.getItem(NORMALIZATION_APPLY_INTENT_KEY)).not.toBeNull();
    // Still failing: the record is kept, never treated as done.
    await expect(api.finishNormalizationApplyIntent()).rejects.toThrow('disk full');
    restore();
    expect((await api.finishNormalizationApplyIntent()).lifts).toEqual({ row: true, [DST]: true });
    expect(await tuple()).toEqual(AFTER());
    const retry = await api.applyWorkoutNoteTextBatchIfUnchanged(renameRequest());
    expect(retry.saved.map(r => r.id)).toEqual(['rt']);
    expect(await tuple()).toEqual(AFTER());
  });

  test('unreadable Track state is unknown, not absent: nothing is written', async () => {
    await seedRename(api);
    await AsyncStorage.setItem(TRACKED_LIFTS_KEY, '{not json');
    const result = await api.applyWorkoutNoteTextBatchIfUnchanged(renameRequest());
    expect(result.failed).toEqual([expect.objectContaining({ id: 'rt' })]);
    expect((await byId('rt')).raw_text).toBe(RT.raw_text);
    expect(await AsyncStorage.getItem(TRACKED_LIFTS_KEY)).toBe('{not json');
  });

  test('a stale target or a stale authority transfers nothing', async () => {
    await seedRename(api);
    await api.saveWorkoutNoteItem({ ...RT, raw_text: `${RT.raw_text}\n60 8` });
    const stale = await api.applyWorkoutNoteTextBatchIfUnchanged(renameRequest());
    expect(stale.skipped).toEqual([expect.objectContaining({ id: 'rt', status: 'stale' })]);
    expect((await tuple()).lifts).toEqual({ [SRC]: true, row: true });
    await AsyncStorage.clear();
    await seedRename(api);
    await api.saveWorkoutNoteItem({ ...RA, raw_text: `${RA.raw_text}\n-Row` });
    expect((await api.applyWorkoutNoteTextBatchIfUnchanged(renameRequest())).authority).toBe('stale');
    expect(await tuple()).toEqual(BEFORE());
  });
});

test('cloud: a failed enqueue lands the note WITH its Track transition; Retry re-queues without moving anything again', async () => {
  await seedRename(CloudNotes);
  // eslint-disable-next-line global-require
  const queue = require('../storage/syncQueue');
  const spy = jest.spyOn(queue, 'enqueueDirty').mockRejectedValueOnce(new Error('queue down'));
  const first = await CloudNotes.applyWorkoutNoteTextBatchIfUnchanged(renameRequest());
  spy.mockRestore();
  expect(first.failed).toEqual([expect.objectContaining({ id: 'rt', landed: true, pending_sync: false })]);
  expect(await tuple()).toEqual(AFTER());
  const retry = await CloudNotes.applyWorkoutNoteTextBatchIfUnchanged(renameRequest());
  expect(retry.saved).toEqual([{ id: 'rt', pending_sync: true }]);
  expect(await tuple()).toEqual(AFTER());
});

// A crash: the process dies with one commit write still pending, then the app
// restarts (a fresh module registry over the same device store) and loads the
// tracked-lift hook, which finishes the recorded commit before it seeds.
describe('an interrupted commit is finished on restart (#1395)', () => {
  test.each([
    ['after the intent write', WORKOUT_NOTES_KEY],
    ['after the note write', TRACKED_LIFTS_KEY],
    ['after the flag write', TRACKED_LIFT_ACTIVATIONS_KEY],
  ])('%s', async (_name, hangAt) => {
    await seedRename(LocalNotes);
    const realSet = AsyncStorage.setItem.getMockImplementation();
    let reached;
    const hit = new Promise((r) => { reached = r; });
    let die;
    AsyncStorage.setItem.mockImplementation((key, value) => {
      if (key !== hangAt) return realSet(key, value);
      reached();
      return new Promise((_, reject) => { die = reject; });
    });
    const crashed = LocalNotes.applyWorkoutNoteTextBatchIfUnchanged(renameRequest());
    await hit;
    AsyncStorage.setItem.mockImplementation(realSet);
    expect(await AsyncStorage.getItem(NORMALIZATION_APPLY_INTENT_KEY)).not.toBeNull();

    let fresh;
    jest.isolateModules(() => {
      jest.doMock('@react-native-async-storage/async-storage', () => AsyncStorage);
      // eslint-disable-next-line global-require
      require('../hooks/entries/trackedLiftHooks');
      // eslint-disable-next-line global-require
      fresh = require('../storage/entries');
    });
    for (let i = 0; i < 50 && (await AsyncStorage.getItem(NORMALIZATION_APPLY_INTENT_KEY)) !== null; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise(r => setImmediate(r));
    }
    expect(await AsyncStorage.getItem(NORMALIZATION_APPLY_INTENT_KEY)).toBeNull();
    expect((await fresh.loadWorkoutNotesRaw()).find(n => n.id === 'rt').raw_text).toBe(RT_NEXT);
    expect(await fresh.loadTrackedLifts()).toEqual({ row: true, [DST]: true });
    expect((await fresh.loadTrackedLiftActivations())[DST].anchor).toBe(3);

    // Let the dead process's pending write fail so this registry's locks unwind.
    die(new Error('process gone'));
    await crashed.catch(() => {});
  });
});

// The user edits a target note after the crash and before the replay: the
// recorded Track maps describe a rename that can no longer complete, so the
// replay must not write them (no mixed note/flag/activation tuple) and must
// retire the record so sync is not blocked forever.
test('replay with a changed target note retires the intent and leaves Track untouched (#1395)', async () => {
  await seedRename(LocalNotes);
  const realSet = AsyncStorage.setItem.getMockImplementation();
  let reached;
  const hit = new Promise((r) => { reached = r; });
  let die;
  AsyncStorage.setItem.mockImplementation((key, value) => {
    if (key !== WORKOUT_NOTES_KEY) return realSet(key, value);
    reached();
    return new Promise((_, reject) => { die = reject; });
  });
  const crashed = LocalNotes.applyWorkoutNoteTextBatchIfUnchanged(renameRequest());
  await hit;
  AsyncStorage.setItem.mockImplementation(realSet);
  expect(await AsyncStorage.getItem(NORMALIZATION_APPLY_INTENT_KEY)).not.toBeNull();

  const EDITED = `${RT.raw_text}\n60 9`;
  let fresh;
  let finish;
  jest.isolateModules(() => {
    jest.doMock('@react-native-async-storage/async-storage', () => AsyncStorage);
    // eslint-disable-next-line global-require
    fresh = require('../storage/entries');
    // eslint-disable-next-line global-require
    ({ finishNormalizationApplyIntent: finish } = require('../storage/entries/workoutNotes'));
  });
  await fresh.saveWorkoutNoteItem({ ...RT, raw_text: EDITED });
  await finish();

  expect(await AsyncStorage.getItem(NORMALIZATION_APPLY_INTENT_KEY)).toBeNull();
  expect((await fresh.loadWorkoutNotesRaw()).find(n => n.id === 'rt').raw_text).toBe(EDITED);
  expect(await fresh.loadTrackedLifts()).toEqual({ [SRC]: true, row: true });
  expect(await fresh.loadTrackedLiftActivations()).toEqual({ [SRC]: sourceRecord(), row: ROW_RECORD });

  die(new Error('process gone'));
  await crashed.catch(() => {});
});

test('both adapters expose the batch and CAS', () => {
  for (const adapter of [localAdapter, cloudAdapter]) {
    expect(typeof adapter.applyWorkoutNoteTextBatchIfUnchanged).toBe('function');
    expect(typeof adapter.compareAndSetWorkoutNoteText).toBe('function');
    expect(typeof adapter.updateWorkoutNoteItem).toBe('function');
  }
});

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

// The user edits a target note after the crash and before the replay. Durable
// write order is notebook -> flags -> activations, so the crash boundary decides
// what already landed: replay must classify the real Track state, never assume
// it is all old, and never leave or push a mixed note/flag/activation tuple.
describe('replay with a changed target note (#1395)', () => {
  // Every locked writer now settles the intent first, so a post-crash edit that
  // reaches replay unsettled has to be simulated on the unlocked primitive
  // (a row merge, as an editor save would make).
  const editRt = async (fresh, text) => fresh.replaceWorkoutNotesRaw(
    (await fresh.loadWorkoutNotesRaw()).map(n => (n.id === 'rt' ? { ...n, raw_text: text } : n)),
  );

  async function crashAt(hangAt) {
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
    let fresh;
    let finish;
    const mods = {};
    jest.isolateModules(() => {
      jest.doMock('@react-native-async-storage/async-storage', () => AsyncStorage);
      // eslint-disable-next-line global-require
      fresh = require('../storage/entries');
      // eslint-disable-next-line global-require
      ({ finishNormalizationApplyIntent: finish, withWorkoutNotebookLock: fresh.withWorkoutNotebookLock } = require('../storage/entries/workoutNotes'));
      /* eslint-disable global-require */
      mods.secure = require('../storage/secureStorage').secureStorage;
      mods.queue = require('../storage/syncQueue');
      mods.cloud = require('../storage/cloud/cloudDomainMethods');
      require('../hooks/entries/storageMode');
      /* eslint-enable global-require */
    });
    return { fresh, finish, mods, end: async () => { die(new Error('process gone')); await crashed.catch(() => {}); } };
  }

  // The notebook rows carry the apply id from the same setItem as the text, so
  // landing is known even when no Track key has moved and every note is edited.
  // `toggle`: an unrelated Track key changed after the crash must survive.
  test.each([
    ['intent written, notebook not', WORKOUT_NOTES_KEY, RT.raw_text, false],
    ['notebook written, flags not', TRACKED_LIFTS_KEY, RT_NEXT, true],
    ['notebook and flags written, activations not', TRACKED_LIFT_ACTIVATIONS_KEY, RT_NEXT, true],
  ].flatMap(row => [[`${row[0]}`, ...row.slice(1), false], [`${row[0]} + later toggle`, ...row.slice(1), true]]))('%s', async (_name, hangAt, base, applied, toggle) => {
    const { fresh, finish, end } = await crashAt(hangAt);
    const EDITED = `${base}\n60 9`;
    await editRt(fresh, EDITED);
    if (toggle) await fresh.saveTrackedLifts({ ...(await fresh.loadTrackedLifts()), extra: true });
    const extra = toggle ? { extra: true } : {};
    await finish();
    expect(await AsyncStorage.getItem(NORMALIZATION_APPLY_INTENT_KEY)).toBeNull();
    expect((await fresh.loadWorkoutNotesRaw()).find(n => n.id === 'rt').raw_text).toBe(EDITED);
    if (applied) {
      expect(await fresh.loadTrackedLifts()).toEqual({ ...AFTER().lifts, ...extra });
      expect(await fresh.loadTrackedLiftActivations()).toEqual(AFTER().activations);
    } else {
      expect(await fresh.loadTrackedLifts()).toEqual({ [SRC]: true, row: true, ...extra });
      expect(await fresh.loadTrackedLiftActivations()).toEqual({ [SRC]: sourceRecord(), row: ROW_RECORD });
    }
    await end();
  });

  test('the apply id is never uploaded and does not outlive its intent (export)', async () => {
    await seedRename(LocalNotes);
    await LocalNotes.applyWorkoutNoteTextBatchIfUnchanged(renameRequest());
    // What backup export reads: the stored notebook, with no stamp left.
    expect((await LocalNotes.loadWorkoutNotesRaw()).some(n => 'normalization_apply_id' in n)).toBe(false);
    // The wire row copies only the per-table column whitelist.
    // eslint-disable-next-line global-require
    expect(require('fs').readFileSync(require('path').join(__dirname, '../storage/cloud/transport.js'), 'utf8')).not.toContain('normalization_apply_id');
  });

  // Backup restore replaces the notebook under the notebook lock with rows that
  // never carried the stamp. The lock settles the intent first, so Track follows
  // the landed rename instead of being stranded on the source key.
  test.each([
    ['crash after the notebook write', TRACKED_LIFTS_KEY],
    ['crash after the flag write', TRACKED_LIFT_ACTIVATIONS_KEY],
  ])('a notebook replace settles the pending rename first: %s', async (_name, hangAt) => {
    const { fresh, end } = await crashAt(hangAt);
    const backup = [RA, { ...RT, raw_text: `${RT_NEXT}\n60 9` }];
    await fresh.withWorkoutNotebookLock(() => fresh.replaceWorkoutNotesRaw(backup));
    expect(await AsyncStorage.getItem(NORMALIZATION_APPLY_INTENT_KEY)).toBeNull();
    expect(await fresh.loadTrackedLifts()).toEqual(AFTER().lifts);
    expect(await fresh.loadTrackedLiftActivations()).toEqual(AFTER().activations);
    expect((await fresh.loadWorkoutNotesRaw()).find(n => n.id === 'rt').raw_text).toBe(`${RT_NEXT}\n60 9`);
    await end();
  });

  test('a notebook replace is refused when the pending rename cannot be reconciled', async () => {
    const { fresh, end } = await crashAt(TRACKED_LIFT_ACTIVATIONS_KEY);
    await editRt(fresh, `${RT_NEXT}\n60 9`);
    await fresh.saveTrackedLiftActivations({ ...AFTER().activations, [SRC]: { ...sourceRecord(), at: '2026-09-02T00:00:00.000Z' } });
    const replace = fresh.withWorkoutNotebookLock(() => fresh.replaceWorkoutNotesRaw([RA]));
    await expect(replace).rejects.toThrow();
    expect((await fresh.loadWorkoutNotesRaw()).map(n => n.id)).toEqual(['ra', 'rt']);
    expect(await AsyncStorage.getItem(NORMALIZATION_APPLY_INTENT_KEY)).not.toBeNull();
    await end();
  });

  // The restarted process has driven no apply, so the adapter comes from the
  // storage mode at settle time, not from whichever one last ran an apply.
  test('a cloud-mode note write after restart settles through the cloud adapter (stamped, enqueued)', async () => {
    const { fresh, mods, end } = await crashAt(WORKOUT_NOTES_KEY);
    fresh.setStorageMode(fresh.STORAGE_MODES.CLOUD);
    await mods.cloud.updateWorkoutNoteItem('ra', { title: 'edited after restart' });
    expect(await AsyncStorage.getItem(NORMALIZATION_APPLY_INTENT_KEY)).toBeNull();
    expect(await fresh.loadTrackedLifts()).toEqual(AFTER().lifts);
    const dirty = await mods.queue.getDirtyRecords(SYNC_TABLES.WORKOUT_NOTES);
    expect(dirty.find(r => r.id === 'rt')).toEqual(expect.objectContaining({ raw_text: RT_NEXT, client_id: expect.any(String) }));
    fresh.setStorageMode(fresh.STORAGE_MODES.LOCAL);
    await end();
  });

  // Device-key recovery (#1186) restores into a private overlay while the shared
  // store is latched; an orphaned, unreadable intent must not block it.
  test('while the device key is latched the notebook lock does not settle, so recovery can run', async () => {
    const { fresh, mods, end } = await crashAt(TRACKED_LIFT_ACTIVATIONS_KEY);
    await editRt(fresh, `${RT_NEXT}\n60 9`);
    await fresh.saveTrackedLiftActivations({ ...AFTER().activations, [SRC]: { ...sourceRecord(), at: '2026-09-02T00:00:00.000Z' } });
    const latch = jest.spyOn(mods.secure, 'isKeyUnavailable').mockReturnValue(true);
    await expect(fresh.withWorkoutNotebookLock(async () => 'restored into overlay')).resolves.toBe('restored into overlay');
    latch.mockRestore();
    expect(await AsyncStorage.getItem(NORMALIZATION_APPLY_INTENT_KEY)).not.toBeNull();
    await expect(fresh.withWorkoutNotebookLock(async () => 'ran')).rejects.toThrow();
    await end();
  });

  test('a Track key that matches neither the recorded before nor after keeps the intent', async () => {
    const { fresh, finish, end } = await crashAt(TRACKED_LIFT_ACTIVATIONS_KEY);
    await editRt(fresh, `${RT_NEXT}\n60 9`);
    await fresh.saveTrackedLiftActivations({ ...AFTER().activations, [SRC]: { ...sourceRecord(), at: '2026-09-02T00:00:00.000Z' } });
    await expect(finish()).rejects.toThrow();
    expect(await AsyncStorage.getItem(NORMALIZATION_APPLY_INTENT_KEY)).not.toBeNull();
    await end();
  });
});

test('both adapters expose the batch and CAS', () => {
  for (const adapter of [localAdapter, cloudAdapter]) {
    expect(typeof adapter.applyWorkoutNoteTextBatchIfUnchanged).toBe('function');
    expect(typeof adapter.compareAndSetWorkoutNoteText).toBe('function');
    expect(typeof adapter.updateWorkoutNoteItem).toBe('function');
  }
});

// #1411: settling a pending apply intent writes the Track pair, so it runs under
// the shared local-write lock (nested in the notebook lock) like every other
// Track writer. A holder of that lock must see no Track write, and no write
// generation bump, from the notebook-lock preamble until it releases.
describe('settling a pending apply intent honours the local-write lock (#1411)', () => {
  // eslint-disable-next-line global-require
  const { withLocalWriteLock, __resetLocalWriteLockForTests } = require('../storage/sync/localWriteLock');
  // A failed assertion must not leave its holder blocking the next test.
  afterEach(() => { __resetLocalWriteLockForTests(); });
  // eslint-disable-next-line global-require
  const { getTrackedLiftWriteGeneration } = require('../storage/entries/settings');
  const flush = async () => { for (let i = 0; i < 10; i += 1) await new Promise(r => setImmediate(r)); };
  const raw = async () => [await AsyncStorage.getItem(TRACKED_LIFTS_KEY), await AsyncStorage.getItem(TRACKED_LIFT_ACTIVATIONS_KEY)];
  const BACKUP = (version, extra = {}) => ({ version, exported_at: '2026-07-10T00:00:00.000Z', weight_entries: [], current_workout_id: null, weight_goal: null, fatigue_multiplier: 1, deload_history: [], ...extra });
  const NB = [{ ...RA }, { ...RT, raw_text: `${RT_NEXT}\n60 9` }];

  // A durable pending intent: the note and flags landed, the activation write
  // failed, and so did the rollback's.
  async function pend() {
    await seedRename(LocalNotes);
    const restore = failStore((kind, key) => kind === 'set' && key === TRACKED_LIFT_ACTIVATIONS_KEY);
    await LocalNotes.applyWorkoutNoteTextBatchIfUnchanged(renameRequest());
    restore();
    expect(await AsyncStorage.getItem(NORMALIZATION_APPLY_INTENT_KEY)).not.toBeNull();
  }

  async function holdWhile(start, { diverge = false } = {}) {
    await pend();
    if (diverge) {
      await LocalNotes.replaceWorkoutNotesRaw((await LocalNotes.loadWorkoutNotesRaw()).map(n => (n.id === 'rt' ? { ...n, raw_text: `${RT_NEXT}\n60 9` } : n)));
    }
    let release;
    let held;
    const holder = withLocalWriteLock(() => new Promise((r) => { held = true; release = r; }));
    await flush();
    expect(held).toBe(true);
    const generation = getTrackedLiftWriteGeneration();
    const before = await raw();
    const op = start();
    await flush();
    expect(getTrackedLiftWriteGeneration()).toBe(generation);
    expect(await raw()).toEqual(before);
    release();
    await holder;
    await op;
    expect(getTrackedLiftWriteGeneration()).toBeGreaterThan(generation);
    expect(await AsyncStorage.getItem(NORMALIZATION_APPLY_INTENT_KEY)).toBeNull();
    expect(await Storage.loadTrackedLifts()).toEqual(AFTER().lifts);
    expect(await Storage.loadTrackedLiftActivations()).toEqual(AFTER().activations);
  }

  const ordinary = () => LocalNotes.saveWorkoutNoteItem({ id: 'extra', title: 'Extra', raw_text: 'Friday' });
  const local = () => importBackup(BACKUP('3', { workout_notes: NB }), 'replace', { mode: IMPORT_MODES.LOCAL });
  const cloudNb = () => importBackup(BACKUP('3', { workout_notes: NB }), 'replace', { mode: IMPORT_MODES.CLOUD });
  const WRITERS = [
    ['an ordinary note write', ordinary],
    ['a v2 local restore', local],
    ['a v2 cloud restore', cloudNb],
  ];

  test.each(WRITERS)('%s', async (_name, start) => { await holdWhile(start); });

  test.each(WRITERS)('diverged reconciliation: %s', async (_name, start) => { await holdWhile(start, { diverge: true }); });

  // Every replace restore, v1 included, settles the intent first (#1400), and
  // none of it touches the Track pair under the holder.
  test('a v1 cloud restore never writes Track under the holder', async () => {
    await pend();
    let release;
    const holder = withLocalWriteLock(() => new Promise((r) => { release = r; }));
    await flush();
    const generation = getTrackedLiftWriteGeneration();
    const before = await raw();
    const op = importBackup(BACKUP('1'), 'replace', { mode: IMPORT_MODES.CLOUD });
    await flush();
    expect(getTrackedLiftWriteGeneration()).toBe(generation);
    expect(await raw()).toEqual(before);
    release();
    await holder;
    expect((await op).ok).toBe(true);
    expect(await AsyncStorage.getItem(NORMALIZATION_APPLY_INTENT_KEY)).toBeNull();
  });

  test('a rejected holder does not wedge the settle, and nothing deadlocks', async () => {
    await pend();
    let fail;
    const holder = withLocalWriteLock(() => new Promise((_, reject) => { fail = reject; }));
    await flush();
    const op = ordinary();
    await flush();
    fail(new Error('holder failed'));
    await expect(holder).rejects.toThrow('holder failed');
    await op;
    expect(await tuple()).toEqual({ ...AFTER(), text: RT_NEXT });
    expect((await byId('extra')).raw_text).toBe('Friday');
  });
});

// #1172: every workout-notes read-modify-write shares one notebook lock.
// Each race fixture is deterministic: the first operation is paused right
// after it reads the notebook, the second is started, then the first resumes.
// Without the lock the second commits inside the gap and one change is lost.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { secureStorage } from '../storage/secureStorage';
import * as Storage from '../storage/entries';
import * as LocalNotes from '../storage/entries/workoutNotes';
import * as CloudNotes from '../storage/cloud/cloudDomainMethods';
import { WORKOUT_NOTES_KEY } from '../storage/entries/keys';
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

test('both adapters expose the batch and CAS', () => {
  for (const adapter of [localAdapter, cloudAdapter]) {
    expect(typeof adapter.applyWorkoutNoteTextBatchIfUnchanged).toBe('function');
    expect(typeof adapter.compareAndSetWorkoutNoteText).toBe('function');
    expect(typeof adapter.updateWorkoutNoteItem).toBe('function');
  }
});

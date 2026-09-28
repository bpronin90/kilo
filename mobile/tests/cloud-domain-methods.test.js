// #1172: note writers share one notebook lock, so compare-and-set cannot be
// split from its write by a concurrent writer, in local or cloud mode.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Storage from '../storage/entries';
import * as LocalNotes from '../storage/entries/workoutNotes';
import * as CloudNotes from '../storage/cloud/cloudDomainMethods';
import { cloudAdapter } from '../storage/cloudAdapter';
import { localAdapter } from '../storage/localAdapter';
import { getDirtyRecords, SYNC_TABLES } from '../storage/syncQueue';

jest.mock('../lib/supabaseClient', () => ({ getSupabaseClient: jest.fn() }));

const NOTE = { id: 'n1', title: 'Upper', raw_text: 'Monday\n-bench 3x5' };
const NEXT = 'Monday\n-Bench Press 3x5';

beforeEach(async () => { await AsyncStorage.clear(); });

const text = async () => (await Storage.loadWorkoutNotesRaw()).find(n => n.id === 'n1')?.raw_text;

describe.each([
  ['local', LocalNotes],
  ['cloud', CloudNotes],
])('%s compareAndSetWorkoutNoteText', (_mode, api) => {
  test('a writer landing between compare and write is never overwritten', async () => {
    await api.saveWorkoutNoteItem(NOTE);
    const racingEdit = api.saveWorkoutNoteItem({ ...NOTE, raw_text: 'newer edit' });
    const cas = api.compareAndSetWorkoutNoteText('n1', NOTE.raw_text, NEXT);
    await racingEdit;
    expect(await cas).toBe('stale');
    expect(await text()).toBe('newer edit');
  });

  test('saves when unchanged, is idempotent on retry, and reports missing', async () => {
    await api.saveWorkoutNoteItem({ ...NOTE, recovery_block_id: 'blk' });
    expect(await api.compareAndSetWorkoutNoteText('n1', NOTE.raw_text, NEXT)).toBe('saved');
    expect(await api.compareAndSetWorkoutNoteText('n1', NOTE.raw_text, NEXT)).toBe('saved');
    const saved = (await Storage.loadWorkoutNotesRaw()).find(n => n.id === 'n1');
    expect(saved.raw_text).toBe(NEXT);
    expect(saved.recovery_block_id).toBe('blk');
    expect(await api.compareAndSetWorkoutNoteText('none', 'a', 'b')).toBe('missing');
  });

  test('an editor patch merges into the note as it is at write time', async () => {
    await api.saveWorkoutNoteItem(NOTE);
    const cas = api.compareAndSetWorkoutNoteText('n1', NOTE.raw_text, NEXT);
    const patched = api.updateWorkoutNoteItem('n1', { activeWeek: 1 });
    expect(await cas).toBe('saved');
    expect(await patched).toEqual(expect.objectContaining({ raw_text: NEXT, activeWeek: 1 }));
    expect(await text()).toBe(NEXT);
    expect(await api.updateWorkoutNoteItem('none', {})).toBe(false);
  });

  test('a rejected step does not wedge the lock', async () => {
    await expect(LocalNotes.withWorkoutNotebookLock(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await api.saveWorkoutNoteItem(NOTE);
    expect(await api.compareAndSetWorkoutNoteText('n1', NOTE.raw_text, NEXT)).toBe('saved');
  });
});

test('cloud compare-and-set enqueues the stamped record and never revives a tombstone', async () => {
  await CloudNotes.saveWorkoutNoteItem(NOTE);
  expect(await CloudNotes.compareAndSetWorkoutNoteText('n1', NOTE.raw_text, NEXT)).toBe('saved');
  const dirty = await getDirtyRecords(SYNC_TABLES.WORKOUT_NOTES);
  expect(JSON.stringify(dirty)).toContain('Bench Press');
  await CloudNotes.deleteWorkoutNoteItem('n1');
  expect(await CloudNotes.compareAndSetWorkoutNoteText('n1', NEXT, 'x')).toBe('missing');
});

test('both adapters expose compare-and-set', () => {
  expect(typeof localAdapter.compareAndSetWorkoutNoteText).toBe('function');
  expect(typeof cloudAdapter.compareAndSetWorkoutNoteText).toBe('function');
});

test('a sync pass persist cannot land between compare and write', async () => {
  // eslint-disable-next-line global-require
  const { createPassCache } = require('../storage/cloud/syncTableIo');
  await CloudNotes.saveWorkoutNoteItem(NOTE);
  const cache = createPassCache();
  const base = await cache.read(SYNC_TABLES.WORKOUT_NOTES, Storage.loadWorkoutNotesRaw);
  const pulled = [...base, { id: 'remote', title: 'Pulled', raw_text: 'Friday' }];
  const cas = CloudNotes.compareAndSetWorkoutNoteText('n1', NOTE.raw_text, NEXT);
  const syncWrite = cache.write(SYNC_TABLES.WORKOUT_NOTES, pulled, Storage.replaceWorkoutNotesRaw, Storage.loadWorkoutNotesRaw);
  expect(await cas).toBe('saved');
  await syncWrite;
  const ids = (await Storage.loadWorkoutNotesRaw()).map(n => n.id).sort();
  expect(ids).toEqual(['n1', 'remote']);
  expect(await text()).toBe(NEXT);
});

describe.each([
  ['local', LocalNotes],
  ['cloud', CloudNotes],
])('%s applyWorkoutNoteTextBatchIfUnchanged', (_mode, api) => {
  const AUTH = { id: 'a', title: 'Auth', raw_text: 'Monday\n-Bench Press 3x5' };
  const T2 = { id: 'n2', title: 'Upper', raw_text: 'Friday\n-bb bench 3x5' };
  const request = (extra = {}) => ({
    authority: { id: 'a', expected_raw_text: AUTH.raw_text, accepted_raw_texts: [] },
    items: [
      { id: 'n1', expected_raw_text: NOTE.raw_text, next_raw_text: NEXT },
      { id: 'n2', expected_raw_text: T2.raw_text, next_raw_text: 'Friday\n-Bench Press 3x5' },
    ],
    ...extra,
  });
  const seed = async () => { for (const n of [AUTH, NOTE, T2]) await api.saveWorkoutNoteItem(n); };

  test('writes every selected target in one locked batch', async () => {
    await seed();
    const result = await api.applyWorkoutNoteTextBatchIfUnchanged(request());
    expect(result.authority).toBe('unchanged');
    expect(result.saved.map(r => r.id).sort()).toEqual(['n1', 'n2']);
    expect(await text()).toBe(NEXT);
  });

  test('an authority edit queued before the batch rejects the whole batch', async () => {
    await seed();
    const edit = api.updateWorkoutNoteItem('a', { raw_text: 'Monday\n-Barbell Bench 3x5' });
    const result = await api.applyWorkoutNoteTextBatchIfUnchanged(request());
    await edit;
    expect(result.authority).toBe('stale');
    expect(await text()).toBe(NOTE.raw_text);
  });

  test('a stale target is skipped while valid siblings proceed', async () => {
    await seed();
    const edit = api.saveWorkoutNoteItem({ ...T2, raw_text: 'Friday\n-newer' });
    const result = await api.applyWorkoutNoteTextBatchIfUnchanged(request());
    await edit;
    expect(result.skipped).toEqual([expect.objectContaining({ id: 'n2', status: 'stale' })]);
    expect(result.saved.map(r => r.id)).toEqual(['n1']);
    expect((await Storage.loadWorkoutNotesRaw()).find(n => n.id === 'n2').raw_text).toBe('Friday\n-newer');
  });

  test('current-routine selection racing the batch loses neither write', async () => {
    await seed();
    const select = Storage.setCurrentWorkoutNote('n2');
    const result = api.applyWorkoutNoteTextBatchIfUnchanged(request());
    await select;
    await result;
    const notes = await Storage.loadWorkoutNotesRaw();
    expect(notes.find(n => n.id === 'n2').isCurrent).toBe(true);
    expect(notes.find(n => n.id === 'n1').raw_text).toBe(NEXT);
  });
});

describe('cloud batch enqueue failure and recovery replay', () => {
  const AUTH = { id: 'a', title: 'Auth', raw_text: 'Monday\n-Bench Press 3x5' };
  const req = { authority: { id: 'a', expected_raw_text: AUTH.raw_text, accepted_raw_texts: [] }, items: [{ id: 'n1', expected_raw_text: NOTE.raw_text, next_raw_text: NEXT }] };

  test('a failed enqueue reports pending_sync failure and Retry re-queues the landed text', async () => {
    await CloudNotes.saveWorkoutNoteItem(AUTH);
    await CloudNotes.saveWorkoutNoteItem(NOTE);
    // eslint-disable-next-line global-require
    const queue = require('../storage/syncQueue');
    const spy = jest.spyOn(queue, 'enqueueDirty').mockRejectedValueOnce(new Error('queue down'));
    const first = await CloudNotes.applyWorkoutNoteTextBatchIfUnchanged(req);
    expect(first.failed).toEqual([expect.objectContaining({ id: 'n1', pending_sync: true })]);
    expect(await text()).toBe(NEXT);
    spy.mockRestore();
    const retry = await CloudNotes.applyWorkoutNoteTextBatchIfUnchanged(req);
    expect(retry.saved).toEqual([expect.objectContaining({ id: 'n1', pending_sync: true })]);
    expect(JSON.stringify(await getDirtyRecords(SYNC_TABLES.WORKOUT_NOTES))).toContain('Bench Press');
  });

  test('recovery replay (ensureWorkoutNoteLive/Deleted) cannot restore stale text over a CAS', async () => {
    await CloudNotes.saveWorkoutNoteItem(NOTE);
    const replay = CloudNotes.ensureWorkoutNoteLive({ ...NOTE, updated_at: new Date().toISOString() });
    const cas = CloudNotes.compareAndSetWorkoutNoteText('n1', NOTE.raw_text, NEXT);
    const other = CloudNotes.ensureWorkoutNoteDeleted('other');
    await Promise.all([replay, other]);
    expect(await cas).toBe('saved');
    expect(await text()).toBe(NEXT);
  });
});

test('backup restore and derived-cache purge serialize with note writers', async () => {
  // eslint-disable-next-line global-require
  const { purgePersistedDerivedSections } = require('../storage/entries/derivedCachePurge');
  await LocalNotes.saveWorkoutNoteItem(NOTE);
  const purge = purgePersistedDerivedSections();
  const cas = LocalNotes.compareAndSetWorkoutNoteText('n1', NOTE.raw_text, NEXT);
  await purge;
  expect(await cas).toBe('saved');
  expect(await text()).toBe(NEXT);
});

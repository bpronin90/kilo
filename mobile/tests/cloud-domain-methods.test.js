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

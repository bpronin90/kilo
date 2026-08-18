// Regression coverage for issue #813: the sync merge's recomputed parser output
// (`derived_sections`) is never persisted again, existing copies are purged, and
// nothing about it can make an unchanged note look edited.
//
// Background: the default recompute seam used to attach `parseWorkoutNote()`'s
// full output to a merged note whenever local and remote agreed on raw_text.
// Because kilo.pull_sync_changes serves a device its own pushed rows on the very
// next pull, every note a device had ever uploaded ended up carrying a cache
// roughly one hundred times the size of its text - in the notebook, in the sync
// baseline, in the pending queue, and in every backup - for a field nothing
// read. On a phone every one of those bytes is decrypted and re-encrypted in
// pure JS on the UI thread.

import AsyncStorage from '@react-native-async-storage/async-storage';

import * as Storage from '../storage/entries';
import { WORKOUT_NOTES_KEY } from '../storage/entries/keys';
import {
  DERIVED_SECTIONS_FIELD,
  hasDerivedSections,
  stripDerivedSections,
  stripDerivedSectionsFromList,
} from '../storage/entries/derivedCache';
import {
  DERIVED_CACHE_PURGE_KEY,
  purgePersistedDerivedSections,
} from '../storage/entries/derivedCachePurge';
import { exportBackup, importBackup, IMPORT_MODES } from '../storage/entries/backupImport';
import { cloudAdapter, setCloudTransport, setRecomputeDerived } from '../storage/cloudAdapter';
import { getRecomputeDerived } from '../storage/cloud/transport';
import {
  SYNC_TABLES,
  enqueueDirty,
  getDirtyRecords,
  getSyncSnapshot,
  purgeDerivedSectionsFromWorkoutNoteSyncState,
  reconcileAgainstBaseline,
  resetClientIdCacheForTests,
  resetStampClockForTests,
  setSyncSnapshot,
} from '../storage/syncQueue';
import { __resetSyncQueue } from '../storage/syncRecovery';
import { makeXidFakeCloud } from './mocks/xidFakeCloud';

const NOTES_SNAPSHOT_KEY = 'kilo_sync_snapshot_workout_notes';
const NOTES_DIRTY_KEY = 'kilo_sync_dirty_workout_notes';

function note(id, raw_text, extra = {}) {
  return {
    id,
    title: `Routine ${id}`,
    raw_text,
    saved_at: '2026-08-01T10:00:00.000Z',
    updated_at: '2026-08-01T10:00:00.000Z',
    tracked_exercises: [],
    one_k_exercises: null,
    isCurrent: false,
    ...extra,
  };
}

// A stand-in for the parser output an older build persisted; the real thing is
// ~100x raw_text, which is the point, but the tests only need the field.
const OLD_CACHE = [{ heading: 'Monday', exercises: [{ name: 'Squat', sets: [{ set_index: 1 }] }] }];

async function rawNotebook() {
  return JSON.parse(await AsyncStorage.getItem(WORKOUT_NOTES_KEY));
}

let cloud;
beforeEach(async () => {
  await AsyncStorage.clear();
  __resetSyncQueue();
  resetClientIdCacheForTests();
  resetStampClockForTests();
  cloud = makeXidFakeCloud();
  setCloudTransport(cloud.transport);
  setRecomputeDerived(null);
  Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
});

afterEach(() => {
  setCloudTransport(null);
  setRecomputeDerived(null);
  Storage.setStorageMode(Storage.STORAGE_MODES.LOCAL);
});

describe('derivedCache helpers', () => {
  it('strip helpers return their input by identity when there is nothing to strip', () => {
    const clean = note('a', '-Squat\n225 5,5,5');
    expect(stripDerivedSections(clean)).toBe(clean);
    const list = [clean, note('b', '-Bench\n135 5,5,5')];
    expect(stripDerivedSectionsFromList(list)).toBe(list);
    expect(hasDerivedSections(clean)).toBe(false);
    expect(hasDerivedSections(null)).toBe(false);
  });

  it('strips only the cache field and leaves every other field intact', () => {
    const bloated = note('a', '-Squat\n225 5,5,5', { [DERIVED_SECTIONS_FIELD]: OLD_CACHE, deleted_at: null });
    const stripped = stripDerivedSections(bloated);
    expect(stripped).not.toBe(bloated);
    expect(stripped).toEqual(note('a', '-Squat\n225 5,5,5', { deleted_at: null }));
    expect(bloated[DERIVED_SECTIONS_FIELD]).toBe(OLD_CACHE); // input untouched
  });
});

describe('sync engine never persists derived_sections', () => {
  it('has no default derived recompute any more, and null restores the default', () => {
    expect(getRecomputeDerived()).toBeNull();
    const injected = () => ({ tracked_exercises: ['x'] });
    setRecomputeDerived(injected);
    expect(getRecomputeDerived()).toBe(injected);
    setRecomputeDerived(null);
    expect(getRecomputeDerived()).toBeNull();
  });

  it('a push followed by the next pull leaves the notebook, its baseline, and the queue cache-free and the same size', async () => {
    await Storage.replaceWorkoutNotesRaw([
      note('n1', 'Monday\n+Lifting\n-Squat\n225 5,5,5\n230 5,5,4'),
      note('n2', 'Tuesday\n+Lifting\n-Bench\n135 5,5,5'),
    ]);

    await cloudAdapter.sync({ ownedDevice: false }); // first upload
    const sizeAfterUpload = (await AsyncStorage.getItem(WORKOUT_NOTES_KEY)).length;
    await cloudAdapter.sync({ ownedDevice: true }); // the pull that used to attach the cache
    await cloudAdapter.sync({ ownedDevice: true }); // and the pass that used to persist it into the baseline again

    const notebook = await rawNotebook();
    expect(notebook).toHaveLength(2);
    expect(notebook.some(hasDerivedSections)).toBe(false);
    expect((await getSyncSnapshot(SYNC_TABLES.WORKOUT_NOTES)).some(hasDerivedSections)).toBe(false);
    expect((await getDirtyRecords(SYNC_TABLES.WORKOUT_NOTES)).some(hasDerivedSections)).toBe(false);
    // The round trip only replaces device-stamped metadata with server stamps;
    // the notebook must not grow by anything resembling a parser cache.
    const sizeAfterRoundTrip = (await AsyncStorage.getItem(WORKOUT_NOTES_KEY)).length;
    expect(sizeAfterRoundTrip).toBeLessThan(sizeAfterUpload + 200);
    // And the merged rows still made it to the cloud unchanged.
    expect(cloud.tables[SYNC_TABLES.WORKOUT_NOTES].get('n1').raw_text).toContain('230 5,5,4');
  });

  it('an injected recompute still runs on the unchanged-raw_text merge (the seam is intact)', async () => {
    setRecomputeDerived((raw) => ({ tracked_exercises: [`recomputed:${raw.length}`] }));
    await Storage.replaceWorkoutNotesRaw([note('n1', '-Squat\n225 5,5,5')]);
    await cloudAdapter.sync({ ownedDevice: false });
    await cloudAdapter.sync({ ownedDevice: true });
    const [merged] = await Storage.loadWorkoutNotesRaw();
    expect(merged.tracked_exercises).toEqual([`recomputed:${'-Squat\n225 5,5,5'.length}`]);
  });

  it('enqueueDirty stores a workout note without its cache, and other tables verbatim', async () => {
    await enqueueDirty(SYNC_TABLES.WORKOUT_NOTES, note('n1', 'x', { [DERIVED_SECTIONS_FIELD]: OLD_CACHE }));
    const [queued] = await getDirtyRecords(SYNC_TABLES.WORKOUT_NOTES);
    expect(hasDerivedSections(queued)).toBe(false);
    expect(queued.raw_text).toBe('x');

    const entry = { id: 'w1', weight_value: 180, [DERIVED_SECTIONS_FIELD]: 'not a note, left alone' };
    await enqueueDirty(SYNC_TABLES.WEIGHT_ENTRIES, entry);
    expect((await getDirtyRecords(SYNC_TABLES.WEIGHT_ENTRIES))[0]).toEqual(entry);
  });

  it('a note that differs from its baseline only by the cache is not a local edit, in either direction', () => {
    const clean = note('n1', '-Squat\n225 5,5,5', { updated_at: '2026-08-01T10:00:00.000Z' });
    const bloated = { ...clean, [DERIVED_SECTIONS_FIELD]: OLD_CACHE };
    expect(reconcileAgainstBaseline({ current: [clean], baseline: [bloated], clientId: 'c' }).dirty).toEqual([]);
    expect(reconcileAgainstBaseline({ current: [bloated], baseline: [clean], clientId: 'c' }).dirty).toEqual([]);
    // A genuine edit is still detected.
    const edited = { ...clean, raw_text: '-Squat\n230 5,5,5' };
    expect(reconcileAgainstBaseline({ current: [edited], baseline: [bloated], clientId: 'c' }).dirty).toHaveLength(1);
  });
});

describe('notebook storage strips the cache on every path', () => {
  beforeEach(() => Storage.setStorageMode(Storage.STORAGE_MODES.LOCAL));

  it('replaceWorkoutNotesRaw, saveWorkoutNoteItem, and setCurrentWorkoutNote never persist it', async () => {
    await Storage.replaceWorkoutNotesRaw([note('a', 'x', { [DERIVED_SECTIONS_FIELD]: OLD_CACHE })]);
    expect((await rawNotebook()).some(hasDerivedSections)).toBe(false);

    await Storage.saveWorkoutNoteItem(note('b', 'y', { [DERIVED_SECTIONS_FIELD]: OLD_CACHE }));
    expect((await rawNotebook()).map((n) => n.id)).toEqual(['a', 'b']);
    expect((await rawNotebook()).some(hasDerivedSections)).toBe(false);

    // Seed a notebook exactly as an older build left it, then exercise a write
    // path that rewrites every note.
    await AsyncStorage.setItem(WORKOUT_NOTES_KEY, JSON.stringify([
      note('a', 'x', { [DERIVED_SECTIONS_FIELD]: OLD_CACHE }),
      note('b', 'y', { [DERIVED_SECTIONS_FIELD]: OLD_CACHE }),
    ]));
    await Storage.setCurrentWorkoutNote('b');
    const after = await rawNotebook();
    expect(after.some(hasDerivedSections)).toBe(false);
    expect(after.find((n) => n.id === 'b').isCurrent).toBe(true);
  });

  it('reads of an older build\'s notebook are lean in memory even before the purge runs', async () => {
    await AsyncStorage.setItem(WORKOUT_NOTES_KEY, JSON.stringify([
      note('a', 'x', { [DERIVED_SECTIONS_FIELD]: OLD_CACHE }),
    ]));
    expect((await Storage.loadWorkoutNotesRaw()).some(hasDerivedSections)).toBe(false);
    expect((await Storage.loadWorkoutNotes()).some(hasDerivedSections)).toBe(false);
    // Reading alone does not rewrite storage; that is the purge's job.
    expect((await rawNotebook())[0][DERIVED_SECTIONS_FIELD]).toEqual(OLD_CACHE);
  });
});

describe('one-time purge of persisted caches (purgePersistedDerivedSections)', () => {
  beforeEach(() => Storage.setStorageMode(Storage.STORAGE_MODES.LOCAL));

  async function seedOldBuildState() {
    await AsyncStorage.setItem(WORKOUT_NOTES_KEY, JSON.stringify([
      note('a', 'x', { [DERIVED_SECTIONS_FIELD]: OLD_CACHE }),
      note('b', 'y'),
    ]));
    await setSyncSnapshot(SYNC_TABLES.WORKOUT_NOTES, [
      note('a', 'x', { [DERIVED_SECTIONS_FIELD]: OLD_CACHE }),
      note('b', 'y'),
    ]);
    await AsyncStorage.setItem(NOTES_DIRTY_KEY, JSON.stringify({
      a: note('a', 'x', { [DERIVED_SECTIONS_FIELD]: OLD_CACHE }),
    }));
  }

  it('strips the notebook, the baseline snapshot, and the pending queue, then records completion', async () => {
    await seedOldBuildState();
    await expect(purgePersistedDerivedSections()).resolves.toEqual({
      skipped: false, notebook: true, snapshot: true, dirty: true,
    });
    expect((await rawNotebook()).some(hasDerivedSections)).toBe(false);
    expect((await rawNotebook()).map((n) => n.id)).toEqual(['a', 'b']);
    expect(JSON.parse(await AsyncStorage.getItem(NOTES_SNAPSHOT_KEY)).some(hasDerivedSections)).toBe(false);
    expect(hasDerivedSections(JSON.parse(await AsyncStorage.getItem(NOTES_DIRTY_KEY)).a)).toBe(false);
    expect(await AsyncStorage.getItem(DERIVED_CACHE_PURGE_KEY)).toBe('1');
    // Baseline and notebook still agree, so the next reconciliation finds no
    // phantom local edit.
    const { dirty } = reconcileAgainstBaseline({
      current: await Storage.loadWorkoutNotesRaw(),
      baseline: await getSyncSnapshot(SYNC_TABLES.WORKOUT_NOTES),
      clientId: 'c',
    });
    expect(dirty).toEqual([]);
  });

  it('is a single marker read on every later launch', async () => {
    await seedOldBuildState();
    await purgePersistedDerivedSections();
    // The AsyncStorage jest mock's methods are jest.fn()s already.
    AsyncStorage.getItem.mockClear();
    await expect(purgePersistedDerivedSections()).resolves.toEqual({
      skipped: true, notebook: false, snapshot: false, dirty: false,
    });
    expect(AsyncStorage.getItem.mock.calls.map(([key]) => key)).toEqual([DERIVED_CACHE_PURGE_KEY]);
  });

  it('touches nothing when there is nothing to strip, but still records completion', async () => {
    await Storage.replaceWorkoutNotesRaw([note('a', 'x')]);
    const before = await AsyncStorage.getItem(WORKOUT_NOTES_KEY);
    await expect(purgePersistedDerivedSections()).resolves.toEqual({
      skipped: false, notebook: false, snapshot: false, dirty: false,
    });
    expect(await AsyncStorage.getItem(WORKOUT_NOTES_KEY)).toBe(before);
    expect(await AsyncStorage.getItem(DERIVED_CACHE_PURGE_KEY)).toBe('1');
  });

  it('leaves an unreadable notebook exactly as it is and never turns it into an empty one', async () => {
    await AsyncStorage.setItem(WORKOUT_NOTES_KEY, '{not json');
    await purgePersistedDerivedSections();
    expect(await AsyncStorage.getItem(WORKOUT_NOTES_KEY)).toBe('{not json');
  });

  it('propagates a storage failure without recording completion, so the next launch retries', async () => {
    await seedOldBuildState();
    const original = AsyncStorage.getItem.getMockImplementation();
    AsyncStorage.getItem.mockImplementation(async (key, ...rest) => {
      if (key === WORKOUT_NOTES_KEY) throw new Error('storage unavailable');
      return original(key, ...rest);
    });
    try {
      await expect(purgePersistedDerivedSections()).rejects.toThrow('storage unavailable');
    } finally {
      AsyncStorage.getItem.mockImplementation(original);
    }
    expect(await AsyncStorage.getItem(DERIVED_CACHE_PURGE_KEY)).toBeNull();
    // Recoverable: the retry completes and cleans everything.
    await expect(purgePersistedDerivedSections()).resolves.toMatchObject({ skipped: false, notebook: true });
    expect((await rawNotebook()).some(hasDerivedSections)).toBe(false);
  });

  it('cannot lose a domain write that lands while it runs', async () => {
    await seedOldBuildState();
    const purge = purgePersistedDerivedSections();
    const write = Storage.saveWorkoutNoteItem(note('c', 'z'));
    await Promise.all([purge, write]);
    const after = await rawNotebook();
    expect(after.map((n) => n.id).sort()).toEqual(['a', 'b', 'c']);
    expect(after.some(hasDerivedSections)).toBe(false);
  });

  it('a queue writer that read before the rewrite and writes after it cannot restore the cache', async () => {
    // enqueueDirtyMany is a separate read and write of the whole queue map. The
    // storage lock is FIFO, and the purge queues its snapshot rewrite first, so
    // ordering the calls this way pins exactly the interleaving to defend
    // against: [snapshot rewrite][enqueue READ][dirty-queue rewrite][enqueue
    // WRITE]. The enqueue's write is built from a map read BEFORE the queue was
    // cleaned; it must not carry the old cache back into storage.
    await seedOldBuildState();
    const purge = purgeDerivedSectionsFromWorkoutNoteSyncState();
    const enqueue = enqueueDirty(SYNC_TABLES.WORKOUT_NOTES, note('b', 'y'));
    await expect(Promise.all([purge, enqueue])).resolves.toBeDefined();
    const queued = JSON.parse(await AsyncStorage.getItem(NOTES_DIRTY_KEY));
    expect(Object.keys(queued).sort()).toEqual(['a', 'b']);
    expect(Object.values(queued).some(hasDerivedSections)).toBe(false);
  });
});

describe('backups', () => {
  beforeEach(() => Storage.setStorageMode(Storage.STORAGE_MODES.LOCAL));

  it('exportBackup omits the cache and importBackup never restores it', async () => {
    await AsyncStorage.setItem(WORKOUT_NOTES_KEY, JSON.stringify([
      note('a', '-Squat\n225 5,5,5', { [DERIVED_SECTIONS_FIELD]: OLD_CACHE }),
    ]));
    const backup = await exportBackup();
    expect(backup.workout_notes).toHaveLength(1);
    expect(backup.workout_notes.some(hasDerivedSections)).toBe(false);

    // A backup written by an older build can still carry it.
    const oldBackup = {
      ...backup,
      workout_notes: [{ ...backup.workout_notes[0], [DERIVED_SECTIONS_FIELD]: OLD_CACHE }],
    };
    await AsyncStorage.clear();
    const result = await importBackup(oldBackup, 'replace', { mode: IMPORT_MODES.LOCAL });
    expect(result.ok).toBe(true);
    const restored = await rawNotebook();
    expect(restored.map((n) => n.id)).toEqual(['a']);
    expect(restored.some(hasDerivedSections)).toBe(false);
  });
});

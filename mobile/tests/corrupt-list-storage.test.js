import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  readList,
  writeList,
  CorruptStorageError,
  isCorruptStorageError,
} from '../storage/entries/jsonStorage';
import {
  loadWeightEntries,
  loadWeightEntriesRaw,
  saveWeightEntry,
  deleteWeightEntry,
  updateWeightEntry,
} from '../storage/entries/weightEntries';
import {
  loadWorkoutNotes,
  loadWorkoutNotesRaw,
  saveWorkoutNoteItem,
  deleteWorkoutNoteItem,
} from '../storage/entries/workoutNotes';
import { WEIGHT_KEY, WORKOUT_NOTES_KEY } from '../storage/entries/keys';

// #607: corrupt persisted list JSON must fail closed instead of masquerading as
// an empty dataset. Missing → documented []; malformed/wrong-shape → a
// distinguishable load failure; and because every mutation reads before it
// writes, a corrupt store can never be silently overwritten as though empty.

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('readList fail-closed contract', () => {
  test('absent key returns the documented empty default', async () => {
    await expect(readList(WEIGHT_KEY)).resolves.toEqual([]);
  });

  test('present empty-string payload fails closed, not []', async () => {
    // An empty string is a present-but-unreadable payload (JSON.parse rejects
    // it), not an absent key, so it must throw rather than masquerade as empty.
    // The in-memory jest mock coerces a stored '' to null via `value || null`,
    // so simulate the real device getItem contract returning a present '' to
    // exercise the production branch faithfully.
    AsyncStorage.getItem.mockResolvedValueOnce('');
    const err = await readList(WEIGHT_KEY).catch((e) => e);
    expect(isCorruptStorageError(err)).toBe(true);
    expect(err.key).toBe(WEIGHT_KEY);
  });

  test('valid array payload is returned unchanged', async () => {
    const list = [{ id: 'a' }, { id: 'b' }];
    await writeList(WEIGHT_KEY, list);
    await expect(readList(WEIGHT_KEY)).resolves.toEqual(list);
  });

  test('malformed JSON throws a distinguishable CorruptStorageError, not []', async () => {
    await AsyncStorage.setItem(WEIGHT_KEY, '[{"id":"a"');
    await expect(readList(WEIGHT_KEY)).rejects.toThrow(CorruptStorageError);
    await expect(readList(WEIGHT_KEY)).rejects.toMatchObject({ key: WEIGHT_KEY });
  });

  test.each([
    ['object', JSON.stringify({ id: 'a' })],
    ['number', JSON.stringify(42)],
    ['string', JSON.stringify('not-a-list')],
    ['null', JSON.stringify(null)],
    ['boolean', JSON.stringify(true)],
  ])('non-array payload (%s) throws CorruptStorageError, not []', async (_label, raw) => {
    await AsyncStorage.setItem(WEIGHT_KEY, raw);
    const err = await readList(WEIGHT_KEY).catch((e) => e);
    expect(isCorruptStorageError(err)).toBe(true);
    expect(err.key).toBe(WEIGHT_KEY);
  });

  test('raw storage read failure propagates instead of being swallowed as []', async () => {
    // The async-storage jest mock's methods are already jest.fn()s, so a
    // one-shot implementation reverts to the in-memory default on the next call
    // without leaking into later tests.
    AsyncStorage.getItem.mockImplementationOnce(() =>
      Promise.reject(new Error('backing store unavailable'))
    );
    await expect(readList(WEIGHT_KEY)).rejects.toThrow('backing store unavailable');
    // Default behavior is restored automatically after the one-shot.
    await expect(readList(WEIGHT_KEY)).resolves.toEqual([]);
  });
});

describe('mutations cannot overwrite corrupt data as empty', () => {
  const CORRUPT = '[{"id":"keep-me"';

  test('saveWeightEntry rejects and leaves corrupt bytes intact', async () => {
    await AsyncStorage.setItem(WEIGHT_KEY, CORRUPT);
    await expect(saveWeightEntry({ id: 'new' })).rejects.toThrow(CorruptStorageError);
    // The corrupt bytes are preserved for later recovery — not clobbered.
    expect(await AsyncStorage.getItem(WEIGHT_KEY)).toBe(CORRUPT);
  });

  test('deleteWeightEntry rejects and leaves corrupt bytes intact', async () => {
    await AsyncStorage.setItem(WEIGHT_KEY, CORRUPT);
    await expect(deleteWeightEntry('x')).rejects.toThrow(CorruptStorageError);
    expect(await AsyncStorage.getItem(WEIGHT_KEY)).toBe(CORRUPT);
  });

  test('updateWeightEntry rejects and leaves corrupt bytes intact', async () => {
    await AsyncStorage.setItem(WEIGHT_KEY, CORRUPT);
    await expect(updateWeightEntry('x', 100, null, null)).rejects.toThrow(CorruptStorageError);
    expect(await AsyncStorage.getItem(WEIGHT_KEY)).toBe(CORRUPT);
  });

  test('saveWorkoutNoteItem rejects and leaves corrupt notebook intact', async () => {
    await AsyncStorage.setItem(WORKOUT_NOTES_KEY, CORRUPT);
    await expect(
      saveWorkoutNoteItem({ id: 'wn_new', title: 'X', raw_text: '' })
    ).rejects.toThrow(CorruptStorageError);
    expect(await AsyncStorage.getItem(WORKOUT_NOTES_KEY)).toBe(CORRUPT);
  });

  test('deleteWorkoutNoteItem rejects and leaves corrupt notebook intact', async () => {
    await AsyncStorage.setItem(WORKOUT_NOTES_KEY, CORRUPT);
    await expect(deleteWorkoutNoteItem('wn_x')).rejects.toThrow(CorruptStorageError);
    expect(await AsyncStorage.getItem(WORKOUT_NOTES_KEY)).toBe(CORRUPT);
  });

  test('saveWeightEntry rejects on a present empty-string payload without writing', async () => {
    // Simulate the device returning a present '' (see readList note above). The
    // read-before-write throws, so writeList never runs and the bytes cannot be
    // overwritten as though storage were empty.
    AsyncStorage.getItem.mockResolvedValueOnce('');
    AsyncStorage.setItem.mockClear();
    await expect(saveWeightEntry({ id: 'new' })).rejects.toThrow(CorruptStorageError);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });
});

describe('domain load paths surface corruption', () => {
  test('loadWeightEntries fails closed on corrupt data', async () => {
    await AsyncStorage.setItem(WEIGHT_KEY, '{not json');
    await expect(loadWeightEntries()).rejects.toThrow(CorruptStorageError);
  });

  test('loadWeightEntries still returns [] when absent', async () => {
    await expect(loadWeightEntries()).resolves.toEqual([]);
  });

  test('loadWorkoutNotes fails closed on a non-array payload', async () => {
    await AsyncStorage.setItem(WORKOUT_NOTES_KEY, JSON.stringify({ id: 'x' }));
    await expect(loadWorkoutNotes()).rejects.toThrow(CorruptStorageError);
  });
});

describe('cloud-mode raw load paths surface corruption', () => {
  // The cloud sync engine reads the unfiltered backing lists through the Raw
  // loaders; a corrupt local cache must throw so the sync pass fails closed and
  // never overwrites salvageable rows during merge/push.
  test('loadWeightEntriesRaw fails closed on corrupt data', async () => {
    await AsyncStorage.setItem(WEIGHT_KEY, 'not-json-at-all');
    await expect(loadWeightEntriesRaw()).rejects.toThrow(CorruptStorageError);
  });

  test('loadWorkoutNotesRaw fails closed on a non-array payload', async () => {
    await AsyncStorage.setItem(WORKOUT_NOTES_KEY, JSON.stringify(7));
    await expect(loadWorkoutNotesRaw()).rejects.toThrow(CorruptStorageError);
  });

  test('raw loaders still return [] when absent', async () => {
    await expect(loadWeightEntriesRaw()).resolves.toEqual([]);
    await expect(loadWorkoutNotesRaw()).resolves.toEqual([]);
  });
});

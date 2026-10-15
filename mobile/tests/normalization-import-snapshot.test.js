import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearNormalizationImportSnapshot,
  loadNormalizationImportSnapshot,
  normalizeNormalizationImportSnapshot,
  saveNormalizationImportSnapshot,
} from '../storage/entries/normalizationImportSnapshot';
import { NORMALIZATION_IMPORT_SNAPSHOT_KEY } from '../storage/entries/keys';
import { NORMALIZATION_PROTOCOL, buildHeaderCatalog, toStoredCatalog } from '../lib/interoperability/normalizationHeaderCatalog';

const AUTHORITY = { id: 'authority', title: 'Upper', raw_text: 'Monday\n-Bench Press' };
const TARGET = { id: 'target', title: 'Upper 2', raw_text: 'Monday\n-Bench press 3x5, paused\n- 999 5\n-- sentinel comment' };
const SNAPSHOT = {
  version: 1,
  protocol: NORMALIZATION_PROTOCOL,
  authority: AUTHORITY,
  targets: [TARGET],
  catalog: toStoredCatalog(buildHeaderCatalog(AUTHORITY, [TARGET])),
};
// A prompt saved before #1386: whole routines, no protocol discriminator.
const LEGACY = { version: 4, authority: AUTHORITY, targets: [TARGET] };

describe('normalization import snapshot', () => {
  beforeEach(async () => { await AsyncStorage.clear(); });

  test('survives a fresh read after the prompt screen is remounted, with its protocol marker and ref catalog', async () => {
    await saveNormalizationImportSnapshot(SNAPSHOT);
    const loaded = await loadNormalizationImportSnapshot();
    expect(loaded).toEqual(SNAPSHOT);
    expect(loaded.protocol).toBe('compact-exercise-v1');
    expect(loaded.catalog.headers).toEqual([{ ref: 'H1', raw: '-Bench press 3x5, paused', occurrences: [{ noteId: 'target', line: 1 }] }]);
    expect(loaded.catalog.names).toEqual(['Bench Press']);
  });

  test('the capture counter is not the protocol marker: a counter alone never makes a snapshot compact', () => {
    expect(normalizeNormalizationImportSnapshot({ ...LEGACY, version: 99 })).toEqual({ version: 99, legacy: true, authority: AUTHORITY, targets: [TARGET] });
    expect(normalizeNormalizationImportSnapshot({ ...SNAPSHOT, version: 99 }).protocol).toBe(NORMALIZATION_PROTOCOL);
  });

  test('a saved legacy full-note snapshot loads flagged, is never erased, and is never written back', async () => {
    await AsyncStorage.setItem(NORMALIZATION_IMPORT_SNAPSHOT_KEY, JSON.stringify(LEGACY));
    const loaded = await loadNormalizationImportSnapshot();
    expect(loaded).toEqual({ version: 4, legacy: true, authority: AUTHORITY, targets: [TARGET] });
    expect(loaded.protocol).toBeUndefined();
    expect(loaded.catalog).toBeUndefined();
    await expect(saveNormalizationImportSnapshot(loaded)).rejects.toThrow('Invalid normalization import snapshot.');
    expect(JSON.parse(await AsyncStorage.getItem(NORMALIZATION_IMPORT_SNAPSHOT_KEY))).toEqual(LEGACY);
    // A different protocol string is just as unsupported.
    expect(normalizeNormalizationImportSnapshot({ ...SNAPSHOT, protocol: 'compact-exercise-v2' }).legacy).toBe(true);
  });

  test('a new successful capture replaces a legacy snapshot', async () => {
    await AsyncStorage.setItem(NORMALIZATION_IMPORT_SNAPSHOT_KEY, JSON.stringify(LEGACY));
    await saveNormalizationImportSnapshot({ ...SNAPSHOT, version: 5 });
    expect(await loadNormalizationImportSnapshot()).toEqual({ ...SNAPSHOT, version: 5 });
  });

  test('a corrupt compact catalog is not trusted but is not erased either', async () => {
    const corrupt = [
      { ...SNAPSHOT, catalog: undefined },
      { ...SNAPSHOT, catalog: { names: ['Bench Press'], headers: [{ ref: 'H1', raw: 'x', occurrences: [] }] } },
      { ...SNAPSHOT, catalog: { names: ['Bench Press'], headers: [{ ref: 'H01', raw: 'x', occurrences: [{ noteId: 'target', line: 1 }] }] } },
      { ...SNAPSHOT, catalog: { names: ['Bench Press'], headers: [{ ref: 'H1', raw: 'x', occurrences: [{ noteId: 'ghost', line: 1 }] }] } },
      { ...SNAPSHOT, catalog: { names: ['Bench Press'], headers: [{ ref: 'H1', raw: 'x', occurrences: [{ noteId: 'target', line: -1 }] }] } },
      { ...SNAPSHOT, catalog: { names: [1], headers: [] } },
      { ...SNAPSHOT, catalog: { names: [], headers: [SNAPSHOT.catalog.headers[0], SNAPSHOT.catalog.headers[0]] } },
    ];
    for (const value of corrupt) expect(normalizeNormalizationImportSnapshot(value)).toBeNull();
    await AsyncStorage.setItem(NORMALIZATION_IMPORT_SNAPSHOT_KEY, JSON.stringify(corrupt[1]));
    expect(await loadNormalizationImportSnapshot()).toBeNull();
    expect(await AsyncStorage.getItem(NORMALIZATION_IMPORT_SNAPSHOT_KEY)).not.toBeNull();
    await expect(saveNormalizationImportSnapshot(corrupt[1])).rejects.toThrow('Invalid normalization import snapshot.');
  });

  test('discard removes the saved snapshot', async () => {
    await saveNormalizationImportSnapshot(SNAPSHOT);
    await clearNormalizationImportSnapshot();
    await expect(loadNormalizationImportSnapshot()).resolves.toBeNull();
  });

  test('keeps a saved snapshot when durable discard fails', async () => {
    await saveNormalizationImportSnapshot(SNAPSHOT);
    const remove = jest.spyOn(AsyncStorage, 'removeItem').mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(clearNormalizationImportSnapshot()).rejects.toThrow('storage unavailable');
    remove.mockRestore();
    await expect(loadNormalizationImportSnapshot()).resolves.toEqual(SNAPSHOT);
  });
});

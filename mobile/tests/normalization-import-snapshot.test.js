import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearNormalizationImportSnapshot,
  loadNormalizationImportSnapshot,
  saveNormalizationImportSnapshot,
} from '../storage/entries/normalizationImportSnapshot';

const SNAPSHOT = {
  version: 1,
  authority: { id: 'authority', title: 'Upper', raw_text: 'Monday\n-Bench Press' },
  targets: [{ id: 'target', title: 'Upper 2', raw_text: 'Monday\n-Bench press' }],
};

describe('normalization import snapshot', () => {
  beforeEach(async () => { await AsyncStorage.clear(); });

  test('survives a fresh read after the prompt screen is remounted', async () => {
    await saveNormalizationImportSnapshot(SNAPSHOT);
    await expect(loadNormalizationImportSnapshot()).resolves.toEqual(SNAPSHOT);
  });

  test('keeps a saved snapshot when durable discard fails', async () => {
    await saveNormalizationImportSnapshot(SNAPSHOT);
    const remove = jest.spyOn(AsyncStorage, 'removeItem').mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(clearNormalizationImportSnapshot()).rejects.toThrow('storage unavailable');
    remove.mockRestore();
    await expect(loadNormalizationImportSnapshot()).resolves.toEqual(SNAPSHOT);
  });
});

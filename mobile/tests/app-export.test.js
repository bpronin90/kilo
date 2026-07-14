// Direct unit tests for buildExportPayload (issue #479).
//
// handleExport in App.js delegates to buildExportPayload(exportBackup).
// These tests exercise buildExportPayload directly via an injected exportFn so
// the failure path in App.js is covered without rendering the full App component.
// Share.share() throw coverage lives in backup-screen.test.js.

import { buildExportPayload } from '../App';

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('expo-updates', () => ({
  useUpdates: () => ({ isUpdateAvailable: false, isUpdatePending: false }),
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
  reloadAsync: jest.fn(),
}));
jest.mock('../hooks/useAuthSession', () => ({
  useAuthSession: () => ({ session: null, loading: false }),
}));
jest.mock('../hooks/useEntries', () => ({
  useWeightEntries: () => ({ entries: [], loading: false, refresh: jest.fn() }),
  useWorkoutNotes: () => ({
    notes: [],
    currentNote: null,
    currentId: null,
    loading: false,
    add: jest.fn(),
    update: jest.fn(),
    selectCurrent: jest.fn(),
    refresh: jest.fn(),
  }),
  useAutoSync: () => {},
  reloadWeightEntries: jest.fn(),
  reloadWorkoutNotes: jest.fn(),
}));
jest.mock('../storage/entries', () => ({
  exportBackup: jest.fn(),
  importBackup: jest.fn(),
  loadFatigueMultiplier: jest.fn().mockResolvedValue(1.07),
  saveFatigueMultiplier: jest.fn(),
  loadWorkoutCollapsed: jest.fn().mockResolvedValue(false),
  saveWorkoutCollapsed: jest.fn(),
  loadWeightDateEditEnabled: jest.fn().mockResolvedValue(false),
  saveWeightDateEditEnabled: jest.fn(),
  loadDeloadDateEditEnabled: jest.fn().mockResolvedValue(false),
  saveDeloadDateEditEnabled: jest.fn(),
}));
jest.mock('../lib/parser', () => ({ parseWeightEntry: jest.fn() }));
jest.mock('../lib/data', () => ({ makeWeightEntry: jest.fn() }));

describe('buildExportPayload', () => {
  test('returns { ok: true, json } when exportFn resolves', async () => {
    const backup = { version: '3', weight_entries: [], workout_notes: [] };
    const result = await buildExportPayload(() => Promise.resolve(backup));
    expect(result.ok).toBe(true);
    expect(typeof result.json).toBe('string');
    expect(JSON.parse(result.json)).toEqual(backup);
  });

  test('returns { ok: false, error } preserving the exception message when exportFn throws', async () => {
    const result = await buildExportPayload(() => {
      throw new Error('AsyncStorage unavailable');
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Export failed: AsyncStorage unavailable');
  });

  test('falls back to generic message when thrown value has no message', async () => {
    const result = await buildExportPayload(() => {
      // eslint-disable-next-line no-throw-literal
      throw null;
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Export failed.');
  });
});

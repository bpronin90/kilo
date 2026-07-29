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
  buildCloudExport: jest.fn(),
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

  // #488: the v3 payload omits user_profile, so a v3 export cannot carry
  // date_of_birth / sex / height_cm / activity_level — device-local fields no
  // cloud table holds. Defaulting to buildCloudExport is what makes a reinstall
  // survivable; a regression back to exportBackup silently loses them.
  test('defaults to buildCloudExport, not exportBackup', async () => {
    const entries = require('../storage/entries');
    entries.buildCloudExport.mockResolvedValue({ version: '3', cloud: { user_profile: {} } });

    const result = await buildExportPayload();

    expect(entries.buildCloudExport).toHaveBeenCalled();
    expect(entries.exportBackup).not.toHaveBeenCalled();
    expect(JSON.parse(result.json).cloud).toBeDefined();
  });

  // #694: the recovery collections are health data, so the artifact the user
  // shares out of the app has to actually contain them — the round trip is
  // covered against real storage in backup-import.test.js, and what is pinned
  // here is that App's export seam does not drop or reshape them on the way to
  // the JSON the user receives.
  test('carries the recovery collections through to the exported JSON', async () => {
    const entries = require('../storage/entries');
    const payload = {
      version: '4',
      recovery_blocks: [
        {
          id: 'rb-1',
          baseline_note_id: 'wn-1',
          baseline: { version: 1, exercises: [{ key: 'bench', name: 'Bench', exercise_class: 'weighted', top_weight: 185 }] },
          include_in_normal_analytics: false,
        },
      ],
      recovery_block_weeks: [{ id: 'rw-1', block_id: 'rb-1', note_id: 'wn-2', week_number: 1 }],
      cloud: { user_profile: {} },
    };
    entries.buildCloudExport.mockResolvedValue(payload);

    const result = await buildExportPayload();

    expect(JSON.parse(result.json)).toEqual(payload);
  });
});

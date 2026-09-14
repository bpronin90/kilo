// Export-surface parity for the App shell refactor (#1047).
//
// App.js was split into three shell modules: app/navigation.js (the pure typed
// navigation vocabulary plus the fire-and-forget product-measurement emit),
// app/export.js (buildExportPayload), and app/AppShell.js (the useAppShell
// orchestration hook). App.js keeps the default App component, wires the hook
// into the presentational shell, and re-exports the helpers so every existing
// consumer and test mock seam that imports from '../App' keeps working.
//
// This suite pins that contract: the default export is still the App component,
// '../App' exposes exactly the documented named surface, each re-exported helper
// is the very same reference the extracted module defines (so a mock of the
// extracted module and a call through '../App' hit one function), and the pure
// helpers still behave. It deliberately does not render App — behavior under
// render is covered by app-navigation / app-shell-back / app-shell-render-
// isolation / app-startup / app-update-banner / app-workout-hydration.

import App, {
  buildExportPayload,
  emitMeasurement,
  analyticsSectionVariant,
  CLOUD_SYNC_NAV_TARGET,
  normalizeNavTarget,
} from '../App';
import * as AppModule from '../App';
import * as navigation from '../app/navigation';
import * as exportModule from '../app/export';

// Mirror the lightweight mocks the sibling app-export suite uses so importing
// '../App' pulls the shell graph without touching native/storage modules. The
// suite never renders App, so the mocks only need to keep module load clean.
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('expo-updates', () => ({
  useUpdates: () => ({ isUpdateAvailable: false, isUpdatePending: false }),
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
  buildCloudExport: jest.fn(),
  importBackup: jest.fn(),
  loadFatigueMultiplier: jest.fn().mockResolvedValue(1.07),
  saveFatigueMultiplier: jest.fn(),
  loadWorkoutCollapsed: jest.fn().mockResolvedValue(false),
  saveWorkoutCollapsed: jest.fn(),
}));
jest.mock('../lib/parser', () => ({ parseWeightEntry: jest.fn() }));
jest.mock('../lib/data', () => ({ makeWeightEntry: jest.fn() }));

describe('App shell refactor export surface (#1047)', () => {
  test('the default export is the App component', () => {
    expect(typeof App).toBe('function');
    expect(AppModule.default).toBe(App);
  });

  test('exposes exactly the documented named surface', () => {
    const named = Object.keys(AppModule).filter((k) => k !== 'default').sort();
    expect(named).toEqual([
      'CLOUD_SYNC_NAV_TARGET',
      'analyticsSectionVariant',
      'buildExportPayload',
      'emitMeasurement',
      'normalizeNavTarget',
    ]);
  });

  test('named exports have their expected shapes', () => {
    expect(typeof buildExportPayload).toBe('function');
    expect(typeof emitMeasurement).toBe('function');
    expect(typeof analyticsSectionVariant).toBe('function');
    expect(typeof normalizeNavTarget).toBe('function');
    expect(typeof CLOUD_SYNC_NAV_TARGET).toBe('object');
  });

  test('helpers are re-exported from the extracted modules by identity', () => {
    // Same reference, not a copy: this is what preserves the mock seams — a test
    // that mocks '../app/navigation' or '../app/export' and a caller that imports
    // from '../App' resolve to one function.
    expect(emitMeasurement).toBe(navigation.emitMeasurement);
    expect(analyticsSectionVariant).toBe(navigation.analyticsSectionVariant);
    expect(normalizeNavTarget).toBe(navigation.normalizeNavTarget);
    expect(CLOUD_SYNC_NAV_TARGET).toBe(navigation.CLOUD_SYNC_NAV_TARGET);
    expect(buildExportPayload).toBe(exportModule.buildExportPayload);
  });

  test('CLOUD_SYNC_NAV_TARGET keeps its typed subview shape (#737)', () => {
    expect(CLOUD_SYNC_NAV_TARGET).toEqual({
      kind: 'subview',
      view: 'backup',
      anchor: 'cloud-sync',
    });
  });

  test('normalizeNavTarget spot check: legacy string, bad section, wrong tab, subview', () => {
    expect(normalizeNavTarget('Analytics', 'weight')).toEqual({ kind: 'section', id: 'weight' });
    expect(normalizeNavTarget('Analytics', 'bogus')).toBeNull();
    expect(normalizeNavTarget('Log', 'weight')).toBeNull();
    expect(normalizeNavTarget('More', CLOUD_SYNC_NAV_TARGET)).toEqual({
      kind: 'subview',
      view: 'backup',
      anchor: 'cloud-sync',
    });
  });

  test('analyticsSectionVariant spot check maps to the bounded variant list', () => {
    expect(analyticsSectionVariant(null)).toBe('overview');
    expect(analyticsSectionVariant('strength')).toBe('strength');
    expect(analyticsSectionVariant('progressive-overload')).toBe('strength');
    expect(analyticsSectionVariant('recovery')).toBe('other');
  });

  test('buildExportPayload wraps the injected export fn (ok + error envelopes)', async () => {
    const ok = await buildExportPayload(() => Promise.resolve({ version: '4' }));
    expect(ok).toEqual({ ok: true, json: JSON.stringify({ version: '4' }, null, 2) });

    const bad = await buildExportPayload(() => {
      throw new Error('boom');
    });
    expect(bad).toEqual({ ok: false, error: 'Export failed: boom' });
  });
});

// Feature-toggle save failures must be visible and consistent (#1487).
// Drives the real hook + Settings screen against a deferred-promise storage mock.

let React;
let renderer;
let act;

jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: () => null }), { virtual: true });
jest.mock('@react-native-community/datetimepicker', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  return function MockDateTimePicker(props) { return ReactLocal.createElement(View, props); };
});
jest.mock('../components/ReminderSettingsCard', () => ({ ReminderSettingsCard: () => null }));
jest.mock('../lib/platformAlert', () => ({ Alert: { alert: jest.fn() } }));

const mockStore = { fatigue: false, deload: false };
const mockSaves = [];
let mockLoadFatigue;

jest.mock('../storage/entries', () => {
  const actual = jest.requireActual('../storage/entries');
  const save = (field) => (enabled) => new Promise((resolve, reject) => {
    mockSaves.push({ field, enabled, resolve: () => { mockStore[field] = enabled; resolve(); }, reject: (e) => reject(e || new Error('disk full')) });
  });
  return {
    ...actual,
    loadFatigueTrackingEnabled: () => mockLoadFatigue(),
    loadDeloadModeEnabled: async () => mockStore.deload,
    saveFatigueTrackingEnabled: save('fatigue'),
    saveDeloadModeEnabled: save('deload'),
  };
});

let hooks;
let Settings;
// The hook keeps module state, so every test needs fresh modules (including a
// single matching React / renderer pair).
function loadFresh() {
  jest.resetModules();
  React = require('react');
  renderer = require('react-test-renderer');
  ({ act } = renderer);
  hooks = require('../hooks/entries/featureToggleHooks');
  Settings = require('../components/SettingsScreen').SettingsScreen;
}
beforeEach(() => {
  mockStore.fatigue = false;
  mockStore.deload = false;
  mockSaves.length = 0;
  mockLoadFatigue = async () => mockStore.fatigue;
  loadFresh();
});

const flush = () => act(async () => { await new Promise((r) => setImmediate(r)); });

function mountHook() {
  const ref = { current: null };
  function Probe() { ref.current = hooks.useFeatureToggles(); return null; }
  let tree;
  act(() => { tree = renderer.create(<Probe />); });
  return { ref, tree };
}

describe('feature toggle save failures', () => {
  test.each([
    ['fatigueTrackingEnabled', 'setFatigueTrackingEnabled', 'fatigue'],
    ['deloadModeEnabled', 'setDeloadModeEnabled', 'deload'],
  ])('%s: rejection converges every consumer to the durable value and resolves', async (key, setter, field) => {
    const a = mountHook();
    const b = mountHook();
    await flush();
    let result;
    await act(async () => { result = a.ref.current[setter](true); });
    expect(a.ref.current[key]).toBe(true);
    expect(b.ref.current[key]).toBe(true);
    await flush();
    expect(mockSaves).toHaveLength(1);
    await act(async () => { mockSaves[0].reject(); });
    await expect(result).resolves.toBe(false);
    expect(a.ref.current[key]).toBe(false);
    expect(b.ref.current[key]).toBe(false);
    expect(a.ref.current.saveFailures[key]).toEqual({ attempted: true });
    expect(b.ref.current.saveFailures[key]).toEqual({ attempted: true });
    expect(mockStore[field]).toBe(false);
  });

  test('retry re-attempts the failed value and clears the report on success', async () => {
    const a = mountHook();
    await flush();
    await act(async () => { a.ref.current.setFatigueTrackingEnabled(true); });
    await flush();
    await act(async () => { mockSaves[0].reject(); });
    await act(async () => { a.ref.current.retryToggleSave('fatigueTrackingEnabled'); });
    expect(a.ref.current.fatigueTrackingEnabled).toBe(true);
    expect(a.ref.current.saveFailures.fatigueTrackingEnabled).toBeNull();
    await flush();
    await act(async () => { mockSaves[1].resolve(); });
    expect(mockSaves[1].enabled).toBe(true);
    expect(a.ref.current.fatigueTrackingEnabled).toBe(true);
    expect(mockStore.fatigue).toBe(true);
  });

  test('overlapping writes are serialized and a stale rejection does not undo the newer value', async () => {
    const a = mountHook();
    await flush();
    await act(async () => {
      a.ref.current.setFatigueTrackingEnabled(true);
      a.ref.current.setFatigueTrackingEnabled(false);
      a.ref.current.setFatigueTrackingEnabled(true);
    });
    await flush();
    expect(mockSaves).toHaveLength(1); // second save waits for the first
    await act(async () => { mockSaves[0].reject(); });
    expect(a.ref.current.fatigueTrackingEnabled).toBe(true);
    expect(a.ref.current.saveFailures.fatigueTrackingEnabled).toBeNull();
    await flush();
    await act(async () => { mockSaves[1].resolve(); });
    await flush();
    await act(async () => { mockSaves[2].resolve(); });
    expect(a.ref.current.fatigueTrackingEnabled).toBe(true);
    expect(mockStore.fatigue).toBe(true);
  });

  test('a newer failure reverts to the last durable value, not the stale attempt', async () => {
    const a = mountHook();
    await flush();
    await act(async () => { a.ref.current.setFatigueTrackingEnabled(true); });
    await flush();
    await act(async () => { a.ref.current.setFatigueTrackingEnabled(false); });
    await act(async () => { mockSaves[0].resolve(); });
    await flush();
    await act(async () => { mockSaves[1].reject(); });
    expect(a.ref.current.fatigueTrackingEnabled).toBe(true);
    expect(a.ref.current.saveFailures.fatigueTrackingEnabled).toEqual({ attempted: false });
  });

  test('an external refresh changing the winner is not undone by an earlier rejection', async () => {
    const a = mountHook();
    await flush();
    await act(async () => { a.ref.current.setFatigueTrackingEnabled(true); });
    await flush();
    mockStore.fatigue = true; // external writer (e.g. sync) lands the value
    await act(async () => { hooks.refreshFeatureToggles(); });
    await act(async () => { mockSaves[0].reject(); });
    await flush();
    expect(a.ref.current.fatigueTrackingEnabled).toBe(true);
    expect(a.ref.current.saveFailures.fatigueTrackingEnabled).toBeNull();
  });

  test('refresh-only notifications never write storage', async () => {
    const a = mountHook();
    await flush();
    await act(async () => { await hooks.refreshFeatureToggles(); });
    await flush();
    expect(mockSaves).toHaveLength(0);
    expect(a.ref.current.fatigueTrackingEnabled).toBe(false);
  });

  test('a toggle before the baseline loads is not clobbered by the late load', async () => {
    let release;
    mockLoadFatigue = () => new Promise((r) => { release = () => r(false); });
    loadFresh();
    const a = mountHook();
    await act(async () => { a.ref.current.setFatigueTrackingEnabled(true); });
    await act(async () => { release(); });
    await flush();
    expect(a.ref.current.fatigueTrackingEnabled).toBe(true);
    expect(mockSaves).toHaveLength(1);
  });

  test('a slow initial load cannot overwrite a newer refresh', async () => {
    const releases = [];
    mockLoadFatigue = () => new Promise((r) => { const v = mockStore.fatigue; releases.push(() => r(v)); });
    loadFresh();
    const a = mountHook();
    // initial read captured false and stays pending
    mockStore.fatigue = true;
    let refreshed;
    await act(async () => { refreshed = hooks.refreshFeatureToggles(); });
    await flush();
    await act(async () => { releases[1](); await refreshed; });
    expect(a.ref.current.fatigueTrackingEnabled).toBe(true);
    await act(async () => { releases[0](); });
    await flush();
    expect(a.ref.current.fatigueTrackingEnabled).toBe(true);
  });

  test('unmounting before the rejection settles is harmless and the mirror still reverts', async () => {
    const a = mountHook();
    const b = mountHook();
    await flush();
    await act(async () => { a.ref.current.setDeloadModeEnabled(true); });
    await flush();
    act(() => { a.tree.unmount(); });
    await act(async () => { mockSaves[0].reject(); });
    expect(b.ref.current.deloadModeEnabled).toBe(false);
  });

  test('successful save keeps the new value and reports nothing', async () => {
    const a = mountHook();
    await flush();
    await act(async () => { a.ref.current.setDeloadModeEnabled(true); });
    await flush();
    await act(async () => { mockSaves[0].resolve(); });
    expect(a.ref.current.deloadModeEnabled).toBe(true);
    expect(a.ref.current.saveFailures.deloadModeEnabled).toBeNull();
  });
});

describe('Settings screen reporting', () => {
  const texts = (root) => root.findAllByType('Text').map((t) => [].concat(t.props.children).join(''));
  const byLabel = (root, label) => root.findAll((n) => n.props?.accessibilityLabel === label && typeof n.props?.onPress === 'function')[0];

  test.each([
    ['Fatigue tracking', "Couldn't save Fatigue tracking"],
    ['Deload mode', "Couldn't save Deload mode"],
  ])('%s: rejection shows an in-place report with a working Retry and no success claim', async (label, prefix) => {
    let tree;
    await act(async () => { tree = renderer.create(<Settings onBack={() => {}} multiplier={1.07} onUpdate={() => {}} />); });
    await flush();
    const sw = tree.root.findAll((n) => n.props?.accessibilityLabel === label && n.props?.accessibilityRole === 'switch')[0];
    await act(async () => { sw.props.onValueChange(true); });
    await flush();
    await act(async () => { mockSaves[0].reject(); });
    const msg = texts(tree.root).find((t) => t.startsWith(prefix));
    expect(msg).toContain('still off');
    const swAfter = tree.root.findAll((n) => n.props?.accessibilityLabel === label && n.props?.accessibilityRole === 'switch')[0];
    expect(swAfter.props.value).toBe(false);
    await act(async () => { byLabel(tree.root, 'Retry').props.onPress(); });
    expect(texts(tree.root).find((t) => t.startsWith(prefix))).toBeUndefined();
    await flush();
    expect(mockSaves).toHaveLength(2);
    expect(mockSaves[1].enabled).toBe(true);
  });
});

import { installRendererCleanup } from './helpers/log-screen';
import render from 'react-test-renderer';
import { LogActiveRoutineCard } from '../components/LogActiveRoutineCard';
import * as useEntries from '../hooks/useEntries';
import { parseWorkoutNote } from '../lib/parser';
import { ControlledLogScreen } from './helpers/log-screen';

installRendererCleanup();

// Suite-local mocks: each behavior suite runs in its own Jest environment.
jest.mock('expo-updates', () => ({
  useUpdates: () => ({ currentlyRunning: { isEmbeddedLaunch: true } }),
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
  reloadAsync: jest.fn(),
}));

// A real in-memory store rather than bare jest.fn()s: the durable recovery
// operation journal (#696) reads back what it wrote, so a mock that forgets
// every write would make every journaled operation look unverifiable.
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map();
  return {
    __store: store,
    getItem: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    setItem: jest.fn(async (key, value) => { store.set(key, value); }),
    removeItem: jest.fn(async (key) => { store.delete(key); }),
    clear: jest.fn(async () => { store.clear(); }),
  };
});

jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  const { View } = require('react-native');
  return function MockDateTimePicker(props) {
    return React.createElement(View, { testID: 'mock-datetimepicker', ...props });
  };
});

jest.mock('../components/LogEmptyState', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    LogEmptyState: function MockLogEmptyState() {
      return React.createElement(View);
    }
  };
});

jest.mock('../components/SessionCheckInModal', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    SessionCheckInModal: function MockSessionCheckInModal() {
      return React.createElement(View);
    }
  };
});

jest.mock('../components/ScreenShell', () => {
  const React = require('react');
  const { View } = require('react-native');
  const ScreenShell = React.forwardRef(({ children, headerRight }, ref) => {
    return React.createElement(View, { testID: 'screen-shell' }, headerRight, children);
  });
  return {
    ScreenShell,
    ScrollContext: React.createContext({ onScroll: () => {} }),
  };
});

jest.mock('../hooks/useEntries');

// ── #960: explainable progression-suggestion cards on the Log current routine ──
describe('LogScreen — progression-suggestion wiring for the current routine (#960)', () => {
  const settingsStore = require('../storage/entries/settings');
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  const { deriveProgressionSuggestion } = require('../lib/data/progressionSuggestions');

  const NOTE = ['-Bench Press: 3x8-10', '135 10,10,10', '135 10,10,10'].join('\n');
  let updateSpy;
  let addSpy;

  function mockHooks(note) {
    jest.clearAllMocks();
    updateSpy = jest.fn();
    addSpy = jest.fn();
    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [note], currentId: note.id, currentNote: note, deloadNotes: [],
      loading: false, error: null, refresh: jest.fn(), selectCurrent: jest.fn(),
      update: updateSpy, add: addSpy, remove: jest.fn(),
    });
    useEntries.useTrackedLifts.mockReturnValue({
      trackedLifts: { 'bench press': true }, activations: {}, toggle: jest.fn(), reconcileActivations: jest.fn(),
    });
    useEntries.useDeloadNote.mockReturnValue({ note: null, loading: false, save: jest.fn(), clear: jest.fn() });
    useEntries.useDeloadHistory.mockReturnValue({
      history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(),
      deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
    });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: false });
    useEntries.useUserProfile.mockReturnValue({ profile: null, save: jest.fn(), loading: false, clear: jest.fn() });
  }

  async function seed(enabled, mutedKeys = []) {
    AsyncStorage.__store.clear();
    settingsStore.__resetProgressionSuggestionSettingsForTests();
    if (enabled) await settingsStore.saveProgressionSuggestionsEnabled(true);
    if (mutedKeys.length) await settingsStore.saveProgressionSuggestionMutes(mutedKeys);
    await settingsStore.hydrateProgressionSuggestionSettings({ force: true });
  }

  afterEach(() => {
    settingsStore.__resetProgressionSuggestionSettingsForTests();
    AsyncStorage.__store.clear();
  });

  async function renderScreen(note) {
    let component;
    await render.act(async () => {
      component = render.create(<ControlledLogScreen initialText={note.raw_text} workoutNoteText={note.raw_text} />);
    });
    return component;
  }

  const cardOf = (component) => component.root.findByType(LogActiveRoutineCard);

  test('with the setting off, the card receives no suggestions', async () => {
    const note = { id: 'wn_cur', title: 'Routine', raw_text: NOTE };
    await seed(false);
    mockHooks(note);
    const component = await renderScreen(note);
    expect(cardOf(component).props.progressionSuggestions).toEqual([]);
    expect(cardOf(component).props.mutedProgressionRows).toEqual([]);
    render.act(() => component.unmount());
  });

  test('with the setting on, the card receives one eligible suggestion that matches the pure derivation', async () => {
    const note = { id: 'wn_cur', title: 'Routine', raw_text: NOTE };
    await seed(true);
    mockHooks(note);
    const component = await renderScreen(note);
    const list = cardOf(component).props.progressionSuggestions;
    expect(list).toHaveLength(1);
    expect(list[0].record.name).toBe('Bench Press');
    expect(list[0].record.suggested).toBe(true);

    const pure = deriveProgressionSuggestion(parseWorkoutNote(NOTE).sections, 'Bench Press');
    expect(list[0].record.explanation).toBe(pure.explanation);
    expect(list[0].record.heuristic).toEqual(pure.heuristic);
    expect(list[0].record.evidence).toEqual(pure.evidence);
    render.act(() => component.unmount());
  });

  test('a muted exercise yields no card but an unmute row, and no note seam is touched', async () => {
    const note = { id: 'wn_cur', title: 'Routine', raw_text: NOTE };
    await seed(true, ['bench press']);
    mockHooks(note);
    const component = await renderScreen(note);
    expect(cardOf(component).props.progressionSuggestions).toEqual([]);
    expect(cardOf(component).props.mutedProgressionRows).toEqual([{ name: 'Bench Press', key: 'bench press' }]);

    await render.act(async () => { cardOf(component).props.onUnmuteProgression('bench press'); });
    expect(await settingsStore.loadProgressionSuggestionMutes()).toEqual([]);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(addSpy).not.toHaveBeenCalled();
    render.act(() => component.unmount());
  });

  test('dismissal is transient and surface-local: it drops the instance without persisting anything', async () => {
    const note = { id: 'wn_cur', title: 'Routine', raw_text: NOTE };
    await seed(true);
    mockHooks(note);
    const component = await renderScreen(note);
    const instanceId = cardOf(component).props.progressionSuggestions[0].instanceId;

    await render.act(async () => { cardOf(component).props.onDismissProgression(instanceId); });
    expect(cardOf(component).props.progressionSuggestions).toEqual([]);
    expect(await settingsStore.loadProgressionSuggestionMutes()).toEqual([]);
    expect(await settingsStore.loadProgressionSuggestionsEnabled()).toBe(true);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(addSpy).not.toHaveBeenCalled();
    render.act(() => component.unmount());
  });

  test('muting through the card handler persists the normalized key', async () => {
    const note = { id: 'wn_cur', title: 'Routine', raw_text: NOTE };
    await seed(true);
    mockHooks(note);
    const component = await renderScreen(note);
    const { key } = cardOf(component).props.progressionSuggestions[0];
    await render.act(async () => { cardOf(component).props.onMuteProgression(key); });
    expect(await settingsStore.loadProgressionSuggestionMutes()).toEqual(['bench press']);
    expect(updateSpy).not.toHaveBeenCalled();
    render.act(() => component.unmount());
  });

  test('holds all suggestions back until the Recovery analytics boundary is verified', async () => {
    const note = { id: 'wn_cur', title: 'Routine', raw_text: NOTE };
    await seed(true);
    mockHooks(note);
    useEntries.useRecoveryBlockState.mockReturnValue({ blocks: [], weeks: [], loading: true, ready: false });
    const component = await renderScreen(note);
    expect(cardOf(component).props.progressionSuggestions).toEqual([]);
    expect(cardOf(component).props.mutedProgressionRows).toEqual([]);
    render.act(() => component.unmount());
  });

  test('drops a recovery-week note that its completed block opted out of ordinary analytics', async () => {
    // The current routine plus a separate note that also logs Bench Press.
    // Without the recovery exclusion that extra note would be part of the
    // last-two-session comparison; opted out, it must not be.
    const RECOVERY_NOTE = ['-Bench Press: 3x8-10', '95 8,8,8'].join('\n');
    const note = { id: 'wn_cur', title: 'Routine', raw_text: NOTE };
    const recoveryNote = { id: 'wn_rec', title: 'Recovery W1', raw_text: RECOVERY_NOTE };
    await seed(true);
    jest.clearAllMocks();
    updateSpy = jest.fn(); addSpy = jest.fn();
    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [note, recoveryNote], currentId: note.id, currentNote: note, deloadNotes: [],
      loading: false, error: null, refresh: jest.fn(), selectCurrent: jest.fn(),
      update: updateSpy, add: addSpy, remove: jest.fn(),
    });
    useEntries.useTrackedLifts.mockReturnValue({
      trackedLifts: { 'bench press': true }, activations: {}, toggle: jest.fn(), reconcileActivations: jest.fn(),
    });
    useEntries.useDeloadNote.mockReturnValue({ note: null, loading: false, save: jest.fn(), clear: jest.fn() });
    useEntries.useDeloadHistory.mockReturnValue({
      history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
    });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: false });
    useEntries.useUserProfile.mockReturnValue({ profile: null, save: jest.fn(), loading: false, clear: jest.fn() });
    useEntries.useRecoveryBlockState.mockReturnValue({
      ready: true,
      blocks: [{ id: 'rb1', status: 'completed', include_in_normal_analytics: false, deleted_at: null }],
      weeks: [{ id: 'rw1', block_id: 'rb1', note_id: 'wn_rec', deleted_at: null }],
    });

    const component = await renderScreen(note);
    const list = cardOf(component).props.progressionSuggestions;
    // The still-eligible current-routine suggestion is unchanged: excluding the
    // opted-out recovery note leaves exactly the two current-routine sessions.
    expect(list).toHaveLength(1);
    const pure = deriveProgressionSuggestion(parseWorkoutNote(NOTE).sections, 'Bench Press');
    expect(list[0].record.explanation).toBe(pure.explanation);
    expect(list[0].record.evidence).toEqual(pure.evidence);
    render.act(() => component.unmount());
  });

  test('excludes an opted-out recovery note even when it is the current routine', async () => {
    // Recovery membership is exact and independent of the current selection, so
    // an opted-out note is dropped from the derivation population even as the
    // current routine — matching Analytics, which filters it from signalSections.
    const RECOVERY_BODY = NOTE;
    const note = { id: 'wn_rec', title: 'Recovery W1', raw_text: RECOVERY_BODY };
    await seed(true);
    jest.clearAllMocks();
    updateSpy = jest.fn(); addSpy = jest.fn();
    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [note], currentId: note.id, currentNote: note, deloadNotes: [],
      loading: false, error: null, refresh: jest.fn(), selectCurrent: jest.fn(),
      update: updateSpy, add: addSpy, remove: jest.fn(),
    });
    useEntries.useTrackedLifts.mockReturnValue({
      trackedLifts: { 'bench press': true }, activations: {}, toggle: jest.fn(), reconcileActivations: jest.fn(),
    });
    useEntries.useDeloadNote.mockReturnValue({ note: null, loading: false, save: jest.fn(), clear: jest.fn() });
    useEntries.useDeloadHistory.mockReturnValue({
      history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
    });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: false });
    useEntries.useUserProfile.mockReturnValue({ profile: null, save: jest.fn(), loading: false, clear: jest.fn() });
    useEntries.useRecoveryBlockState.mockReturnValue({
      ready: true,
      blocks: [{ id: 'rb1', status: 'completed', include_in_normal_analytics: false, deleted_at: null }],
      weeks: [{ id: 'rw1', block_id: 'rb1', note_id: 'wn_rec', deleted_at: null }],
    });

    const component = await renderScreen(note);
    expect(cardOf(component).props.progressionSuggestions).toEqual([]);
    expect(cardOf(component).props.mutedProgressionRows).toEqual([]);
    render.act(() => component.unmount());
  });

  // #1391: the Track anchor counts the whole notebook; Log's suggestion history
  // excludes opted-out recovery weeks, so the anchor must be translated into
  // that history, not clamped against it.
  test('a Track anchor minted during an excluded recovery block keeps the post-activation sessions', async () => {
    const old = { id: 'wn_old', title: 'Old', raw_text: ['-Bench Press: 3x8-10', '185 10,10,10'].join('\n') };
    const recs = [1, 2].map(w => ({ id: `wn_rec${w}`, title: `Recovery W${w}`, raw_text: ['-Bench Press: 3x8-10', '95 8,8,8'].join('\n') }));
    const note = { id: 'wn_cur', title: 'Routine', raw_text: NOTE };
    await seed(true);
    mockHooks(note);
    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [old, ...recs, note], currentId: note.id, currentNote: note, deloadNotes: [],
      loading: false, error: null, refresh: jest.fn(), selectCurrent: jest.fn(),
      update: updateSpy, add: addSpy, remove: jest.fn(),
    });
    // Minted over old + both recovery weeks, before the current routine's sessions.
    useEntries.useTrackedLifts.mockReturnValue({
      trackedLifts: { 'bench press': true },
      activations: { 'bench press': { anchor: 3, at: '2026-08-26T12:00:00.000Z', witness: null } },
      toggle: jest.fn(), reconcileActivations: jest.fn(),
    });
    useEntries.useRecoveryBlockState.mockReturnValue({
      ready: true,
      blocks: [{ id: 'rb1', status: 'completed', include_in_normal_analytics: false, deleted_at: null }],
      weeks: recs.map((r, i) => ({ id: `rw${i + 1}`, block_id: 'rb1', note_id: r.id, deleted_at: null })),
    });

    const component = await renderScreen(note);
    const list = cardOf(component).props.progressionSuggestions;
    // Clamped (3 of 3 included units) this was empty; translated (1) it is the
    // two current-routine sessions, and the heavier pre-activation one never joins.
    expect(list).toHaveLength(1);
    const pure = deriveProgressionSuggestion(parseWorkoutNote(NOTE).sections, 'Bench Press');
    expect(list[0].record.explanation).toBe(pure.explanation);
    expect(list[0].record.evidence).toEqual(pure.evidence);
    render.act(() => component.unmount());
  });
});

// ── #1010: Apply progression suggestion to note — Log production path ──
describe('LogScreen — progression-suggestion Apply-to-note wiring (#1010)', () => {
  const { deriveProgressionSuggestion } = require('../lib/data/progressionSuggestions');
  const settingsStore = require('../storage/entries/settings');
  const AsyncStorage = require('@react-native-async-storage/async-storage');

  const READY = ['-Bench Press: 3x8-10', '135 10,10,10', '135 10,10,10'].join('\n');
  const weightedRecord = () =>
    deriveProgressionSuggestion(parseWorkoutNote(READY).sections, 'Bench Press');

  const baseCardProps = (overrides = {}) => ({
    workoutNoteTitle: 'My Routine',
    hasABWeeks: false,
    effectiveActiveWeek: 'A',
    handleToggleWeek: jest.fn(),
    enterCurrentEditor: jest.fn(),
    handleNoteBodyPress: jest.fn(),
    handleSkipWeek: jest.fn(),
    handleUnskipWeek: jest.fn(),
    canUnskipWeek: false,
    toggleCollapsed: jest.fn(),
    isCollapsed: false,
    dayGroups: [],
    trackedLifts: {},
    handleToggleTrack: jest.fn(),
    roughNoteId: 'n1',
    currentId: 'n1',
    roughFlaggedNames: new Set(),
    activeEditText: '',
    ...overrides,
  });

  const mountCard = (overrides) => {
    let component;
    render.act(() => {
      component = render.create(<LogActiveRoutineCard {...baseCardProps(overrides)} />);
    });
    return component;
  };

  const applyButton = (root) =>
    root.findAll(
      (n) =>
        typeof n.props.onPress === 'function' &&
        n.props.accessibilityLabel === 'Apply the progression suggestion for Bench Press to your note'
    )[0];

  const statusOf = (root) => {
    const nodes = root.findAll((n) => n.props.testID === 'log-progression-apply-status');
    return nodes.length ? nodes[0].props.children : null;
  };

  const entry = (record) => ({ record, key: 'bench press', instanceId: 'bench press|x' });

  test('no onApplyProgression prop → no Apply control on the card', () => {
    const component = mountCard({ progressionSuggestions: [entry(weightedRecord())] });
    expect(applyButton(component.root)).toBeUndefined();
    render.act(() => component.unmount());
  });

  test('a bodyweight suggestion with no concrete target exposes no Apply control', () => {
    const record = deriveProgressionSuggestion(
      parseWorkoutNote(['-Pull-ups: 3x8-12', '12,12,12', '12,12,12'].join('\n')).sections,
      'Pull-ups'
    );
    const component = mountCard({
      progressionSuggestions: [{ record, key: 'pull-ups', instanceId: 'pull-ups|x' }],
      onApplyProgression: jest.fn(),
    });
    const anyApply = component.root.findAll(
      (n) =>
        typeof n.props.accessibilityLabel === 'string' &&
        /^Apply the progression suggestion/.test(n.props.accessibilityLabel)
    );
    expect(anyApply).toHaveLength(0);
    render.act(() => component.unmount());
  });

  test('passes the exact rendered record to the helper and confirms a persisted apply', async () => {
    const record = weightedRecord();
    const onApplyProgression = jest.fn().mockResolvedValue({ applied: true, reason: 'inserted' });
    const component = mountCard({ progressionSuggestions: [entry(record)], onApplyProgression });
    await render.act(async () => {
      applyButton(component.root).props.onPress({ stopPropagation: jest.fn() });
    });
    expect(onApplyProgression).toHaveBeenCalledTimes(1);
    expect(onApplyProgression.mock.calls[0][0]).toBe(record);
    expect(statusOf(component.root)).toBe('Applied. The suggested target was added to your note.');
    render.act(() => component.unmount());
  });

  test('a stale / non-applicable result explains that nothing was added', async () => {
    const onApplyProgression = jest.fn().mockResolvedValue({ applied: false, reason: 'no-change' });
    const component = mountCard({ progressionSuggestions: [entry(weightedRecord())], onApplyProgression });
    await render.act(async () => {
      applyButton(component.root).props.onPress({ stopPropagation: jest.fn() });
    });
    expect(statusOf(component.root)).toBe(
      'This suggestion no longer applies, so nothing was added to your note.'
    );
    render.act(() => component.unmount());
  });

  test('a save-in-flight result asks the user to wait for the current save', async () => {
    const onApplyProgression = jest
      .fn()
      .mockResolvedValue({ applied: false, reason: 'save-in-flight' });
    const component = mountCard({ progressionSuggestions: [entry(weightedRecord())], onApplyProgression });
    await render.act(async () => {
      applyButton(component.root).props.onPress({ stopPropagation: jest.fn() });
    });
    expect(statusOf(component.root)).toBe(
      'Wait for the current save to finish, then try Apply again. Nothing was added.'
    );
    render.act(() => component.unmount());
  });

  test('a save-failed result reports the target could not be saved', async () => {
    const onApplyProgression = jest
      .fn()
      .mockResolvedValue({ applied: false, reason: 'save-failed' });
    const component = mountCard({ progressionSuggestions: [entry(weightedRecord())], onApplyProgression });
    await render.act(async () => {
      applyButton(component.root).props.onPress({ stopPropagation: jest.fn() });
    });
    expect(statusOf(component.root)).toBe(
      'Couldn’t save the change, so the target was not added to your note.'
    );
    render.act(() => component.unmount());
  });

  test('a thrown helper error reports a generic failure without claiming success', async () => {
    const onApplyProgression = jest.fn().mockRejectedValue(new Error('boom'));
    const component = mountCard({ progressionSuggestions: [entry(weightedRecord())], onApplyProgression });
    await render.act(async () => {
      applyButton(component.root).props.onPress({ stopPropagation: jest.fn() });
    });
    expect(statusOf(component.root)).toBe(
      'Couldn’t apply the suggestion. Nothing was added to your note.'
    );
    render.act(() => component.unmount());
  });

  test('Apply neither mutes nor dismisses; dismiss and mute keep their own handlers', async () => {
    const onApplyProgression = jest.fn().mockResolvedValue({ applied: true });
    const onMuteProgression = jest.fn();
    const onDismissProgression = jest.fn();
    const component = mountCard({
      progressionSuggestions: [entry(weightedRecord())],
      onApplyProgression,
      onMuteProgression,
      onDismissProgression,
    });
    await render.act(async () => {
      applyButton(component.root).props.onPress({ stopPropagation: jest.fn() });
    });
    expect(onMuteProgression).not.toHaveBeenCalled();
    expect(onDismissProgression).not.toHaveBeenCalled();

    const byLabel = (label) =>
      component.root.findAll(
        (n) => typeof n.props.onPress === 'function' && n.props.accessibilityLabel === label
      )[0];
    render.act(() => {
      byLabel('Mute progression suggestions for Bench Press').props.onPress({ stopPropagation: jest.fn() });
    });
    render.act(() => {
      byLabel('Dismiss the progression suggestion for Bench Press').props.onPress({ stopPropagation: jest.fn() });
    });
    expect(onMuteProgression).toHaveBeenCalledTimes(1);
    expect(onDismissProgression).toHaveBeenCalledTimes(1);
    render.act(() => component.unmount());
  });

  test('Apply press isolates propagation from the routine-card body gesture', async () => {
    const onApplyProgression = jest.fn().mockResolvedValue({ applied: true });
    const handleNoteBodyPress = jest.fn();
    const component = mountCard({
      progressionSuggestions: [entry(weightedRecord())],
      onApplyProgression,
      handleNoteBodyPress,
    });
    const evt = { stopPropagation: jest.fn() };
    await render.act(async () => {
      applyButton(component.root).props.onPress(evt);
    });
    expect(evt.stopPropagation).toHaveBeenCalled();
    expect(handleNoteBodyPress).not.toHaveBeenCalled();
    render.act(() => component.unmount());
  });

  test('a second press while the first apply is still running shows the helper retry-later result', async () => {
    // Faithful to production: the real helper answers a press made while its own
    // save is in flight with `{ applied: false, reason: 'save-in-flight' }`. The
    // card must reach the helper on every press and surface that result, not
    // swallow the second press.
    let resolveFirst;
    let call = 0;
    const onApplyProgression = jest.fn(() => {
      call += 1;
      return call === 1
        ? new Promise((r) => { resolveFirst = r; })
        : Promise.resolve({ applied: false, reason: 'save-in-flight' });
    });
    const component = mountCard({ progressionSuggestions: [entry(weightedRecord())], onApplyProgression });
    await render.act(async () => {
      applyButton(component.root).props.onPress({ stopPropagation: jest.fn() });
      applyButton(component.root).props.onPress({ stopPropagation: jest.fn() });
    });
    expect(onApplyProgression).toHaveBeenCalledTimes(2);
    expect(statusOf(component.root)).toBe(
      'Wait for the current save to finish, then try Apply again. Nothing was added.'
    );
    await render.act(async () => { resolveFirst({ applied: true }); });
    expect(statusOf(component.root)).toBe('Applied. The suggested target was added to your note.');
    render.act(() => component.unmount());
  });

  describe('full LogScreen → LogActiveRoutineCard → ProgressionSuggestionCard path', () => {
    afterEach(() => {
      settingsStore.__resetProgressionSuggestionSettingsForTests();
      AsyncStorage.__store.clear();
    });

    test('pressing Apply on the rendered card threads the real helper and persists the note', async () => {
      const note = { id: 'wn_cur', title: 'Routine', raw_text: READY };
      AsyncStorage.__store.clear();
      settingsStore.__resetProgressionSuggestionSettingsForTests();
      await settingsStore.saveProgressionSuggestionsEnabled(true);
      await settingsStore.hydrateProgressionSuggestionSettings({ force: true });

      jest.clearAllMocks();
      const updateSpy = jest.fn((id, patch) =>
        Promise.resolve({ id, title: patch.title, raw_text: patch.raw_text, updated_at: '2026-01-01' })
      );
      useEntries.useWorkoutNotes.mockReturnValue({
        notes: [note], currentId: note.id, currentNote: note, deloadNotes: [],
        loading: false, error: null, refresh: jest.fn(), selectCurrent: jest.fn(),
        update: updateSpy, add: jest.fn(), remove: jest.fn(),
      });
      useEntries.useTrackedLifts.mockReturnValue({
        trackedLifts: { 'bench press': true }, activations: {}, toggle: jest.fn(),
        reconcileActivations: jest.fn().mockResolvedValue(undefined),
      });
      useEntries.useDeloadNote.mockReturnValue({ note: null, loading: false, save: jest.fn(), clear: jest.fn() });
      useEntries.useDeloadHistory.mockReturnValue({
        history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
      });
      useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: false });
      useEntries.useUserProfile.mockReturnValue({ profile: null, save: jest.fn(), loading: false, clear: jest.fn() });

      let component;
      await render.act(async () => {
        component = render.create(
          <ControlledLogScreen initialText={note.raw_text} workoutNoteText={note.raw_text} />
        );
      });

      const card = component.root.findByType(LogActiveRoutineCard);
      expect(typeof card.props.onApplyProgression).toBe('function');
      expect(card.props.progressionSuggestions).toHaveLength(1);

      const applyBtn = component.root.findAll(
        (n) =>
          typeof n.props.onPress === 'function' &&
          typeof n.props.accessibilityLabel === 'string' &&
          /^Apply the progression suggestion for Bench Press/.test(n.props.accessibilityLabel)
      )[0];
      expect(applyBtn).toBeTruthy();

      await render.act(async () => {
        applyBtn.props.onPress({ stopPropagation: jest.fn() });
      });

      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy.mock.calls[0][1].raw_text).toContain('140 8,8,8');

      const status = component.root.findAll((n) => n.props.testID === 'log-progression-apply-status');
      expect(status[0].props.children).toBe('Applied. The suggested target was added to your note.');
      render.act(() => component.unmount());
    });
  });
});

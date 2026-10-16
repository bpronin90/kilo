import { installRendererCleanup } from './helpers/log-screen';
import React from 'react';
import render from 'react-test-renderer';
import * as useEntries from '../hooks/useEntries';
import { expandManageRecovery, ControlledLogScreen } from './helpers/log-screen';

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

// ── Recovery inclusion preference (#699) ────────────────────────────────────
//
// The per-block "Include recovery notes in normal analytics" control. Its whole
// job is to write ONE field on ONE block, so these tests assert against what is
// actually persisted, not against optimistic UI state.

describe('Recovery inclusion preference', () => {
  const recoveryStorageModule = require('../storage/entries/recoveryStorage');
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  const journalModule = require('../storage/entries/recoveryOperationJournal');
  const { RECOVERY_BLOCKS_KEY, RECOVERY_BLOCK_WEEKS_KEY, RECOVERY_OPERATION_JOURNAL_KEY } =
    require('../storage/entries/keys');

  const baselineNote = { id: 'baseline1', title: 'Push Day', raw_text: 'Push\n-Bench\n100 5,5,5', updated_at: '2026-01-01T00:00:00.000Z' };
  const weekNote = { id: 'week1note', title: 'Recovery Week 1 Note', raw_text: 'Push\n-Bench\n60 5,5,5', updated_at: '2026-01-08T00:00:00.000Z' };

  const activeBlock = {
    id: 'rbActive',
    baseline_note_id: baselineNote.id,
    baseline_note_title: 'Push Day',
    baseline: { version: 1, exercises: [] },
    include_in_normal_analytics: false,
    started_at: '2026-05-01T00:00:00.000Z',
    completed_at: null,
    deleted_at: null,
    saved_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
  };
  const completedBlockOn = {
    ...activeBlock,
    id: 'rbDoneOn',
    baseline_note_title: 'Old Legs Day',
    include_in_normal_analytics: true,
    started_at: '2026-01-01T00:00:00.000Z',
    completed_at: '2026-02-01T00:00:00.000Z',
  };
  const completedBlockOff = {
    ...activeBlock,
    id: 'rbDoneOff',
    baseline_note_title: 'Older Push Day',
    include_in_normal_analytics: false,
    started_at: '2025-11-01T00:00:00.000Z',
    completed_at: '2025-12-01T00:00:00.000Z',
  };

  const weeks = [{ id: 'rw1', block_id: 'rbActive', note_id: weekNote.id, week_number: 1, completed_at: null, deleted_at: null }];

  const setup = async ({ blocks = [activeBlock], pendingRecovery = [] } = {}) => {
    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [baselineNote, weekNote], currentId: baselineNote.id, currentNote: baselineNote,
      deloadNotes: [], loading: false, error: null, refresh: jest.fn(),
      selectCurrent: jest.fn(), update: jest.fn(), add: jest.fn(), remove: jest.fn(),
    });
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: [], toggle: jest.fn() });
    useEntries.useDeloadNote.mockReturnValue({ note: null, loading: false, save: jest.fn(), clear: jest.fn() });
    useEntries.useDeloadHistory.mockReturnValue({
      history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
    });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: false });
    useEntries.useRecoveryBlockState.mockReturnValue({
      activeBlock: blocks.find(b => !b.completed_at) || null,
      blocks,
      weeks,
      recoveryWeekNumberByNoteId: { [weekNote.id]: 1 },
      loading: false,
      error: null,
      refresh: jest.fn(),
      pendingRecovery,
      recoveryPendingError: null,
      retryRecovery: jest.fn(),
    });
    useEntries.useStartRecoveryBlock.mockReturnValue({ startBlock: jest.fn() });

    await AsyncStorage.setItem(RECOVERY_BLOCKS_KEY, JSON.stringify(blocks));
    await AsyncStorage.setItem(RECOVERY_BLOCK_WEEKS_KEY, JSON.stringify(weeks));
    await AsyncStorage.setItem(RECOVERY_OPERATION_JOURNAL_KEY, JSON.stringify([]));
  };

  // `Counting in normal analytics` IS the Log-surface inclusion control now
  // (#843 review): a tap on the row itself writes the field directly — there
  // is no separate `RecoveryInclusionToggle` Switch nested under it. Log
  // only ever shows one row (the one active block), so a live lookup by role
  // is enough; it is re-run after every `act()` rather than cached, since
  // the row's own accessibilityLabel/state changes with the value.
  const inclusionRow = (root) => root.findAll(
    n => n.props && n.props.accessibilityRole === 'switch' && typeof n.props.onPress === 'function'
  )[0];

  const renderScreen = async () => {
    let component;
    await render.act(async () => { component = render.create(<ControlledLogScreen />); });
    // The inclusion control is still on Log and still the only way to set this
    // preference while a block is active, but it is no longer in the default
    // view: it lives inside `Manage recovery block` (#789), as the
    // `Counting in normal analytics` row itself (#843). Every assertion in
    // this suite is about the control's behavior, so open the disclosure
    // once here rather than restating the interaction in each test.
    expandManageRecovery(component.root);
    return component;
  };

  const persistedBlocks = async () => JSON.parse((await AsyncStorage.getItem(RECOVERY_BLOCKS_KEY)) || '[]');

  beforeEach(() => {
    jest.clearAllMocks();
    AsyncStorage.__store.clear();
    journalModule.__resetRecoveryOperationJournal();
  });

  test('the active block exposes the control with the exact label, switch role, and unchecked state', async () => {
    await setup();
    const component = await renderScreen();
    const control = inclusionRow(component.root);

    expect(control).toBeTruthy();
    expect(control.props.accessibilityRole).toBe('switch');
    // Default off (#692): the control must report the authored preference.
    expect(control.props.accessibilityLabel).toBe('Counting in normal analytics: Off');
    expect(control.props.accessibilityState).toEqual({ checked: false, disabled: false, busy: false });
  });

  test('toggling it on persists exactly that field and nothing else', async () => {
    await setup();
    const component = await renderScreen();

    await render.act(async () => { await inclusionRow(component.root).props.onPress(); });

    const [stored] = await persistedBlocks();
    expect(stored.include_in_normal_analytics).toBe(true);
    // The frozen baseline and lifecycle state are untouched by the patch.
    expect(stored.baseline).toEqual(activeBlock.baseline);
    expect(stored.started_at).toBe(activeBlock.started_at);
    expect(stored.completed_at).toBeNull();
  });

  test('the change reaches mounted analytics subscribers live, without a remount', async () => {
    const { useRecoveryAnalyticsFilter, _resetRecoveryAnalyticsFilterCache } =
      require('../hooks/entries/recoveryBlockHooks');
    _resetRecoveryAnalyticsFilterCache();
    await setup();

    // A stand-in for Home/Analytics: it subscribes to the same boundary those
    // screens read, and must repopulate off the toggle alone.
    const seen = [];
    function FilterProbe() {
      seen.push(useRecoveryAnalyticsFilter());
      return null;
    }
    const Harness = () => (
      <React.Fragment>
        <FilterProbe />
        <ControlledLogScreen />
      </React.Fragment>
    );

    let component;
    await render.act(async () => { component = render.create(<Harness />); });

    // Default off: the linked note is out of ordinary analytics.
    expect(seen[seen.length - 1].isNoteExcluded(weekNote.id)).toBe(true);

    expandManageRecovery(component.root);
    await render.act(async () => { await inclusionRow(component.root).props.onPress(); });

    // Same mounted subscriber, no remount: the note is back in.
    expect(seen[seen.length - 1].isNoteExcluded(weekNote.id)).toBe(false);

    // The row toggles relative to the CURRENT value, so — since this test's
    // `useRecoveryBlockState` mock is static — reflect the write that just
    // landed before pressing again, via `component.update` (reconciliation
    // against the SAME mounted tree, not a fresh mount/unmount).
    useEntries.useRecoveryBlockState.mockReturnValue({
      activeBlock: { ...activeBlock, include_in_normal_analytics: true },
      blocks: [{ ...activeBlock, include_in_normal_analytics: true }],
      weeks,
      recoveryWeekNumberByNoteId: { [weekNote.id]: 1 },
      loading: false, error: null, refresh: jest.fn(),
      pendingRecovery: [], recoveryPendingError: null, retryRecovery: jest.fn(),
    });
    await render.act(async () => { component.update(<Harness />); });

    await render.act(async () => { await inclusionRow(component.root).props.onPress(); });
    expect(seen[seen.length - 1].isNoteExcluded(weekNote.id)).toBe(true);

    await render.act(async () => { component.unmount(); });
    _resetRecoveryAnalyticsFilterCache();
  });

  test('toggling it back off restores exclusion, and the persisted note records are never rewritten', async () => {
    await setup({ blocks: [{ ...activeBlock, include_in_normal_analytics: true }] });
    const component = await renderScreen();
    const control = inclusionRow(component.root);
    expect(control.props.accessibilityState.checked).toBe(true);

    const weeksBefore = await AsyncStorage.getItem(RECOVERY_BLOCK_WEEKS_KEY);
    await render.act(async () => { await control.props.onPress(); });

    const [stored] = await persistedBlocks();
    expect(stored.include_in_normal_analytics).toBe(false);
    expect(await AsyncStorage.getItem(RECOVERY_BLOCK_WEEKS_KEY)).toBe(weeksBefore);
  });

  test('the active block\'s own stored preference is exposed even with completed blocks in storage', async () => {
    // Log exposes only the active block's inclusion control; completed-block
    // controls live on Analytics (#728). Both completed blocks are in
    // storage but must not produce a second row here.
    await setup({ blocks: [activeBlock, completedBlockOn, completedBlockOff] });
    const component = await renderScreen();
    const controls = component.root.findAll(
      n => n.props && n.props.accessibilityRole === 'switch' && typeof n.props.onPress === 'function'
    );

    expect(controls).toHaveLength(1);
    expect(controls[0].props.accessibilityState.checked).toBe(false);
  });

  test('an in-flight write disables the control, and re-enables once it settles', async () => {
    await setup({ blocks: [activeBlock] });
    let resolveWrite;
    const updateSpy = jest.spyOn(recoveryStorageModule, 'updateRecoveryBlock')
      .mockImplementation(() => new Promise((resolve) => { resolveWrite = resolve; }));

    const component = await renderScreen();
    expect(inclusionRow(component.root).props.accessibilityState.disabled).toBe(false);

    // Start the write and leave it in flight: the guarded action reaches
    // storage after a few microtasks, and the mock never settles.
    await render.act(async () => { inclusionRow(component.root).props.onPress(); });

    expect(inclusionRow(component.root).props.disabled).toBe(true);
    expect(inclusionRow(component.root).props.accessibilityState.disabled).toBe(true);

    await render.act(async () => {
      resolveWrite({ ...activeBlock, include_in_normal_analytics: true });
    });

    // Interactive again once the write settles.
    expect(inclusionRow(component.root).props.accessibilityState.disabled).toBe(false);
    updateSpy.mockRestore();
  });

  test('a pending recovery operation disables the control rather than letting it race', async () => {
    await setup({
      pendingRecovery: [{ operation_id: 1, block_id: 'rbActive', error: 'A recovery change is still being applied on this device.' }],
    });
    const component = await renderScreen();
    const control = inclusionRow(component.root);

    expect(control.props.disabled).toBe(true);
    expect(control.props.accessibilityState.disabled).toBe(true);
    expect(control.props.accessibilityState.checked).toBe(false);
  });

  test('a rejected write surfaces an honest error and leaves the stored preference alone', async () => {
    await setup();
    const updateSpy = jest.spyOn(recoveryStorageModule, 'updateRecoveryBlock')
      .mockRejectedValue(Object.assign(new Error('Recovery block rbActive is deleted.'), { code: 'BLOCK_NOT_FOUND' }));
    const component = await renderScreen();

    await render.act(async () => { await inclusionRow(component.root).props.onPress(); });

    const texts = component.root.findAllByType('Text').map(t => {
      const c = t.props.children;
      return Array.isArray(c) ? c.join('') : String(c ?? '');
    });
    expect(texts).toContain('Recovery block rbActive is deleted.');
    const [stored] = await persistedBlocks();
    expect(stored.include_in_normal_analytics).toBe(false);
    // The control still reports the PERSISTED value, not the attempted one.
    expect(inclusionRow(component.root).props.accessibilityState.checked).toBe(false);

    updateSpy.mockRestore();
  });
});

// ── Save-time classification and the recovery boundary (#699) ───────────────
//
// `exercise_classifications` is a cross-note aggregate cached onto the saved
// note, and Home renders the stored value back as its session-status rows. If
// the save path used a different population from the render path, an excluded
// recovery week would leak into Home through this cache. These tests drive the
// real editor hook against real persisted recovery records.

describe('save-time exercise classifications respect the recovery boundary', () => {
  const { useLogCurrentRoutineEditor } = require('../screens/log/useLogCurrentRoutineEditor');
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  const recoveryStorageModule = require('../storage/entries/recoveryStorage');
  const { RECOVERY_BLOCKS_KEY, RECOVERY_BLOCK_WEEKS_KEY } = require('../storage/entries/keys');

  // Two logged sessions of the same lift. The ordinary note progresses; the
  // recovery week is far lighter, which flips the classification the moment it
  // is admitted.
  const CURRENT_RAW = 'Monday\n+Lifting\n-Squat\n- 315 5,5\n- 320 5,5';
  const RECOVERY_RAW = 'Monday\n+Lifting\n-Squat\n- 45 5,5';

  const currentNote = { id: 'note1', title: 'Push Day', raw_text: CURRENT_RAW };
  const recoveryNote = { id: 'recoverynote', title: 'Recovery Week 1', raw_text: RECOVERY_RAW };

  const block = (include) => ({
    id: 'rb1',
    baseline_note_id: 'note1',
    baseline_note_title: 'Push Day',
    baseline: { version: 1, exercises: [] },
    include_in_normal_analytics: include,
    started_at: '2026-05-01T00:00:00.000Z',
    completed_at: null,
    deleted_at: null,
    saved_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
  });
  const weeks = [{
    id: 'rw1', block_id: 'rb1', note_id: 'recoverynote', week_number: 1,
    completed_at: null, deleted_at: null,
    saved_at: '2026-05-01T00:00:00.000Z', updated_at: '2026-05-01T00:00:00.000Z',
  }];

  const mounted = [];
  afterEach(() => {
    render.act(() => { mounted.forEach(c => c.unmount()); });
    mounted.length = 0;
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    AsyncStorage.__store.clear();
  });

  async function saveOnce() {
    const update = jest.fn(async (_id, patch) => ({ id: 'note1', title: patch.title || 'Push Day', raw_text: CURRENT_RAW }));
    let latest = null;
    function Harness() {
      const [text, setText] = React.useState(CURRENT_RAW);
      const [title, setTitle] = React.useState('Push Day');
      latest = useLogCurrentRoutineEditor({
        workoutNoteText: text, setWorkoutNoteText: setText,
        workoutNoteTitle: title, setWorkoutNoteTitle: setTitle,
        currentId: 'note1', currentNote, notes: [currentNote, recoveryNote],
        trackedLifts: [], update, add: jest.fn(), selectCurrent: jest.fn(),
        fatigueTrackingEnabled: false, onCheckInPrompt: jest.fn(), isActive: true,
        editorScrollRef: { current: { scrollTo: jest.fn() } },
        readScrollRef: { current: { scrollTo: jest.fn() } },
      });
      return null;
    }
    await render.act(async () => { mounted.push(render.create(<Harness />)); });
    await render.act(async () => { await latest.handleSave({}); });
    return update;
  }

  test('an excluded recovery week never enters the classifications written to the note', async () => {
    await AsyncStorage.setItem(RECOVERY_BLOCKS_KEY, JSON.stringify([block(false)]));
    await AsyncStorage.setItem(RECOVERY_BLOCK_WEEKS_KEY, JSON.stringify(weeks));

    const update = await saveOnce();
    const excludedPatch = update.mock.calls[0][1];

    await AsyncStorage.setItem(RECOVERY_BLOCKS_KEY, JSON.stringify([block(true)]));
    const includedUpdate = await saveOnce();
    const includedPatch = includedUpdate.mock.calls[0][1];

    // Both saves wrote a classification map — the boundary decides its content,
    // not whether it exists.
    expect(excludedPatch.exercise_classifications).toBeTruthy();
    expect(includedPatch.exercise_classifications).toBeTruthy();
    // Admitting the light rehab session changes what the lift is classified as,
    // which is exactly the leak this boundary prevents when the preference is off.
    expect(excludedPatch.exercise_classifications.squat).toBe('progressing');
    expect(includedPatch.exercise_classifications.squat).toBe('regressing');
  });

  test('a recovery read failure saves the text but writes no classification at all', async () => {
    jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks')
      .mockRejectedValue(new Error('storage unavailable'));

    const update = await saveOnce();
    const patch = update.mock.calls[0][1];

    // The user's writing is never lost to an analytics read.
    expect(patch.raw_text).toBe(CURRENT_RAW);
    expect(patch.title).toBe('Push Day');
    // But no aggregate is written, so a possibly-leaky value cannot replace the
    // stored one. The next successful save repairs it.
    expect('exercise_classifications' in patch).toBe(false);
  });
});

// ── #699 review: the boundary subscriber's freshness and failure behavior ────

describe('useRecoveryAnalyticsFilter freshness and fail-closed reads', () => {
  const hooks = require('../hooks/entries/recoveryBlockHooks');
  const recoveryStorageModule = require('../storage/entries/recoveryStorage');
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  const { RECOVERY_BLOCKS_KEY, RECOVERY_BLOCK_WEEKS_KEY } = require('../storage/entries/keys');

  const block = {
    id: 'rb1', baseline_note_id: 'baseline', baseline_note_title: 'Push Day',
    baseline: { version: 1, exercises: [] }, include_in_normal_analytics: false,
    started_at: '2026-05-01T00:00:00.000Z', completed_at: null, deleted_at: null,
    saved_at: '2026-05-01T00:00:00.000Z', updated_at: '2026-05-01T00:00:00.000Z',
  };
  const week = {
    id: 'rw1', block_id: 'rb1', note_id: 'recoverynote', week_number: 1,
    completed_at: null, deleted_at: null,
    saved_at: '2026-05-01T00:00:00.000Z', updated_at: '2026-05-01T00:00:00.000Z',
  };

  const mounted = [];
  const seen = [];

  function Probe() {
    seen.push(hooks.useRecoveryAnalyticsFilter());
    return null;
  }
  const latest = () => seen[seen.length - 1];

  const mountProbe = async () => {
    await render.act(async () => { mounted.push(render.create(<Probe />)); });
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    AsyncStorage.__store.clear();
    seen.length = 0;
    hooks._resetRecoveryAnalyticsFilterCache();
  });

  afterEach(async () => {
    await render.act(async () => { mounted.forEach(c => c.unmount()); });
    mounted.length = 0;
    jest.restoreAllMocks();
    hooks._resetRecoveryAnalyticsFilterCache();
  });

  test('a restored local backup refreshes every mounted subscriber', async () => {
    await AsyncStorage.setItem(RECOVERY_BLOCKS_KEY, JSON.stringify([]));
    await AsyncStorage.setItem(RECOVERY_BLOCK_WEEKS_KEY, JSON.stringify([]));
    await mountProbe();
    expect(latest().ready).toBe(true);
    expect(latest().isNoteExcluded('recoverynote')).toBe(false);

    // Stand-in for importBackup's `replace` path: it rewrites both collections
    // directly, with no lifecycle action and no sync to announce it.
    await AsyncStorage.setItem(RECOVERY_BLOCKS_KEY, JSON.stringify([block]));
    await AsyncStorage.setItem(RECOVERY_BLOCK_WEEKS_KEY, JSON.stringify([week]));
    // Mounted screens are still serving the pre-import boundary until told.
    expect(latest().isNoteExcluded('recoverynote')).toBe(false);

    await render.act(async () => { hooks.reloadRecoveryBlocks(); });

    expect(latest().isNoteExcluded('recoverynote')).toBe(true);
  });

  test('a cold-start read failure reports an UNVERIFIED boundary instead of "nothing excluded"', async () => {
    jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks')
      .mockRejectedValue(new Error('storage unavailable'));

    await mountProbe();

    // The empty snapshot is a placeholder, not evidence. Consumers see this and
    // hold their loading state rather than publishing ordinary analytics.
    expect(latest().ready).toBe(false);
    // And it still hides nothing, so a bad read can never remove an unrelated
    // ordinary note from the population.
    const notes = [{ id: 'ordinary' }, { id: 'recoverynote' }];
    expect(latest().filterNotes(notes)).toBe(notes);
  });

  test('a failed cold-start read retries on its own and publishes once storage recovers', async () => {
    const spy = jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks')
      .mockRejectedValue(new Error('storage unavailable'));
    await AsyncStorage.setItem(RECOVERY_BLOCKS_KEY, JSON.stringify([block]));
    await AsyncStorage.setItem(RECOVERY_BLOCK_WEEKS_KEY, JSON.stringify([week]));

    await mountProbe();
    expect(latest().ready).toBe(false);

    // Storage comes back. Nothing else in the app needs to notice: the hook's
    // own bounded retry is what clears the loading state for a local-only user
    // who may never produce a recovery mutation or a sync.
    spy.mockRestore();
    await render.act(async () => { await new Promise(r => setTimeout(r, 600)); });

    expect(latest().ready).toBe(true);
    expect(latest().isNoteExcluded('recoverynote')).toBe(true);
  });

  test('a later read failure keeps the last verified boundary rather than reverting to unfiltered', async () => {
    await AsyncStorage.setItem(RECOVERY_BLOCKS_KEY, JSON.stringify([block]));
    await AsyncStorage.setItem(RECOVERY_BLOCK_WEEKS_KEY, JSON.stringify([week]));
    await mountProbe();
    expect(latest().isNoteExcluded('recoverynote')).toBe(true);

    jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks')
      .mockRejectedValue(new Error('storage unavailable'));
    await render.act(async () => { hooks.reloadRecoveryBlocks(); });

    expect(latest().ready).toBe(true);
    expect(latest().isNoteExcluded('recoverynote')).toBe(true);
  });
});

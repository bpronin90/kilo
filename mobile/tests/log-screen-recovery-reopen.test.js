import { installRendererCleanup } from './helpers/log-screen';
import render from 'react-test-renderer';
import * as useEntries from '../hooks/useEntries';
import { Alert } from 'react-native';
import { openRecoveryManagement, findPressableByText, ControlledLogScreen } from './helpers/log-screen';

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

const pressByTestId = (root, id) => {
  const node = root.findAll(n => n.props.testID === id && n.props.onPress)[0];
  expect(node).toBeTruthy();
  render.act(() => { node.props.onPress(); });
};

// #1423: Reopen is a Manage-card action on the inactive management screen.
const pressReopen = (root, blockId = 'rb-done') => {
  openRecoveryManagement(root);
  pressByTestId(root, `recovery-manage-trigger-${blockId}`);
  pressByTestId(root, `recovery-reopen-${blockId}`);
};

// #843 review: the summary must state a first-to-last date RANGE, not just a
// single "started" date, and must preselect the stored inclusion value.
describe('RecoveryBlockEndModal', () => {
  const { RecoveryBlockEndModal } = require('../components/RecoveryBlockEndModal');

  const BLOCK = {
    id: 'rb1', baseline_note_title: 'Push Day',
    started_at: '2026-01-01T00:00:00.000Z', include_in_normal_analytics: false,
  };
  const weeks = [
    { id: 'rw1', block_id: 'rb1', week_number: 1, saved_at: '2026-01-01T00:00:00.000Z' },
    { id: 'rw2', block_id: 'rb1', week_number: 2, saved_at: '2026-01-15T00:00:00.000Z' },
  ];

  test('the summary states a first-to-last date range, and Off is preselected as the current setting', () => {
    let component;
    render.act(() => {
      component = render.create(
        <RecoveryBlockEndModal
          visible
          block={BLOCK}
          weeks={weeks}
          onSetInclusion={jest.fn()}
          onConfirmComplete={jest.fn()}
          onClose={jest.fn()}
        />
      );
    });
    const root = component.root;
    const allText = () => root.findAll(n => n.type === 'Text').map(n => {
      const c = n.props.children;
      return Array.isArray(c) ? c.join('') : String(c ?? '');
    });

    const first = new Date(weeks[0].saved_at).toLocaleDateString();
    const last = new Date(weeks[1].saved_at).toLocaleDateString();
    expect(allText().some(t => t.includes(`Push Day · 2 weeks · ${first} to ${last}`))).toBe(true);

    const off = root.findAll(n => n.props && n.props.accessibilityLabel === 'Keep them out of normal analytics')[0];
    const on = root.findAll(n => n.props && n.props.accessibilityLabel === 'Count them with everything else')[0];
    expect(off.props.accessibilityState).toEqual({ checked: true });
    expect(on.props.accessibilityState).toEqual({ checked: false });
    expect(allText().filter(t => t === 'Your current setting')).toHaveLength(1);
  });
});

// ── Reopen the newest completed recovery block (#839) ──────────────────────

describe('Recovery Block reopen flow', () => {
  const recoveryStorageModule = require('../storage/entries/recoveryStorage');
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  const {
    RECOVERY_BLOCKS_KEY,
    RECOVERY_BLOCK_WEEKS_KEY,
    RECOVERY_OPERATION_JOURNAL_KEY,
  } = require('../storage/entries/keys');
  const journalModule = require('../storage/entries/recoveryOperationJournal');

  const baselineNote = { id: 'baseline1', title: 'Push Day', raw_text: 'Push\n-Bench\n100 5,5,5', updated_at: '2026-01-01T00:00:00.000Z' };
  // A SECOND, unused routine: `baselineNote` is already `completedBlockFixture`'s
  // frozen baseline (via `baseline_note_id`), so it is not itself eligible to
  // start a NEW block (isEligibleBaselineNote excludes any note already tied to
  // a block, live or completed). Coexistence tests need a genuinely eligible
  // baseline for Start alongside Reopen.
  const otherBaselineNote = { id: 'baseline2', title: 'Pull Day', raw_text: 'Pull\n-Row\n80 5,5,5', updated_at: '2026-01-02T00:00:00.000Z' };

  const completedBlockFixture = {
    id: 'rb-done',
    baseline_note_id: baselineNote.id,
    baseline_note_title: 'Push Day',
    started_at: '2026-01-01T00:00:00.000Z',
    completed_at: '2026-02-01T00:00:00.000Z',
    deleted_at: null,
  };
  const completedWeekFixture = {
    id: 'rw-done-1', block_id: 'rb-done', note_id: 'week1note', week_number: 1,
    completed_at: '2026-01-08T00:00:00.000Z', deleted_at: null,
  };

  let refresh, alertSpy, uncompleteBlockSpy;
  let recoveryState;

  const readPersistedBlocks = async () => JSON.parse((await AsyncStorage.getItem(RECOVERY_BLOCKS_KEY)) || '[]');

  // A stateful mock (unlike the static fixtures the Week-2+ suite above uses)
  // is needed here specifically to prove row disappearance after success: the
  // rendered "Start"/"Reopen" rows both derive from `activeBlock`/`blocks`
  // read straight from `useRecoveryBlockState`, so proving they vanish once a
  // block becomes active requires that mock to actually reflect the write —
  // not just a persisted-storage assertion.
  const setup = ({ notes, blocks = [completedBlockFixture], weeks = [completedWeekFixture], activeBlock = null } = {}) => {
    refresh = jest.fn();
    recoveryState = { activeBlock, blocks, weeks };

    useEntries.useWorkoutNotes.mockReturnValue({
      notes, currentId: baselineNote.id, currentNote: baselineNote, deloadNotes: [],
      loading: false, error: null, refresh: jest.fn(),
      selectCurrent: jest.fn(), update: jest.fn(), add: jest.fn(), remove: jest.fn(),
    });
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: [], toggle: jest.fn() });
    useEntries.useDeloadNote.mockReturnValue({ note: null, loading: false, save: jest.fn(), clear: jest.fn() });
    useEntries.useDeloadHistory.mockReturnValue({
      history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
    });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: false });
    useEntries.useRecoveryBlockState.mockImplementation(() => ({
      activeBlock: recoveryState.activeBlock,
      blocks: recoveryState.blocks,
      weeks: recoveryState.weeks,
      recoveryWeekNumberByNoteId: {},
      loading: false,
      error: null,
      refresh,
    }));
    useEntries.useStartRecoveryBlock.mockReturnValue({ startBlock: jest.fn() });
    useEntries.isEligibleBaselineNote.mockImplementation(jest.requireActual('../hooks/entries/recoveryBlockHooks').isEligibleBaselineNote);
    useEntries.isEligibleRecoveryWeekNote.mockImplementation(jest.requireActual('../hooks/entries/recoveryBlockHooks').isEligibleRecoveryWeekNote);

    return Promise.all([
      AsyncStorage.setItem(RECOVERY_BLOCKS_KEY, JSON.stringify(blocks || [])),
      AsyncStorage.setItem(RECOVERY_BLOCK_WEEKS_KEY, JSON.stringify(weeks || [])),
      AsyncStorage.setItem(RECOVERY_OPERATION_JOURNAL_KEY, JSON.stringify([])),
    ]);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    uncompleteBlockSpy = jest.spyOn(recoveryStorageModule, 'uncompleteRecoveryBlock');
    AsyncStorage.__store.clear();
    journalModule.__resetRecoveryOperationJournal();
  });

  afterEach(() => {
    alertSpy.mockRestore();
    uncompleteBlockSpy.mockRestore();
    journalModule.__resetRecoveryOperationJournal();
  });

  test('Start and Reopen are independent: both are on the management screen, not the Routine tab', async () => {
    await setup({ notes: [baselineNote, otherBaselineNote] });
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    // Routine tab: only the compact entry, no Start/Reopen slab.
    expect(findPressableByText(root, 'Start recovery block')).toBeNull();
    expect(root.findAll(n => n.type === 'Text' && typeof n.props.children === 'string' && n.props.children.startsWith('Reopen recovery block')).length).toBe(0);
    openRecoveryManagement(root);
    expect(findPressableByText(root, 'Start recovery block')).toBeTruthy();
    pressByTestId(root, 'recovery-manage-trigger-rb-done');
    expect(root.findAll(n => n.props.testID === 'recovery-reopen-rb-done').length).toBeGreaterThan(0);
  });

  test('Reopen is absent with no eligible completed block, even though Start renders', async () => {
    await setup({ notes: [baselineNote], blocks: [], weeks: [] });
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    openRecoveryManagement(root);
    expect(findPressableByText(root, 'Start recovery block')).toBeTruthy();
    expect(root.findAll(n => typeof n.props.testID === 'string' && n.props.testID.startsWith('recovery-reopen-')).length).toBe(0);
  });

  test('Reopen is absent while a block is already active, even though a completed block exists', async () => {
    const activeBlockFixture = {
      id: 'rb-active', baseline_note_id: 'other', baseline_note_title: 'Other Split',
      started_at: '2026-02-01T00:00:00.000Z', completed_at: null, deleted_at: null,
    };
    await setup({ notes: [baselineNote], activeBlock: activeBlockFixture, blocks: [activeBlockFixture, completedBlockFixture] });
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    expect(findPressableByText(root, 'Start recovery block')).toBeNull();
    expect(root.findAll(n => n.type === 'Text' && typeof n.props.children === 'string' && n.props.children.startsWith('Reopen recovery block')).length).toBe(0);
  });

  test('tapping Reopen shows the #839 confirmation copy naming the baseline, with Cancel and Reopen block actions', async () => {
    await setup({ notes: [baselineNote] });
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    pressReopen(root);

    expect(alertSpy).toHaveBeenCalledWith(
      'Reopen this recovery block?',
      expect.stringContaining('Push Day'),
      expect.arrayContaining([
        expect.objectContaining({ text: 'Cancel' }),
        expect.objectContaining({ text: 'Reopen block' }),
      ])
    );
    const [, message] = alertSpy.mock.calls[0];
    expect(message).toContain('Every week\'s status stays exactly as it is');
    expect(message).toContain('only reopen your most recently completed block');
  });

  test('confirming Reopen reactivates the block, leaves week completion untouched, refreshes, and switches to the Recovery tab', async () => {
    await setup({ notes: [baselineNote] });
    uncompleteBlockSpy.mockResolvedValue({ ...completedBlockFixture, completed_at: null, updated_at: '2026-03-01T00:00:00.000Z' });
    // The refresh callback stands in for the real re-read: it flips the shared
    // mock state to what storage now holds, which is what proves both rows
    // disappear once a block is active (#839's "both entry rows disappear").
    refresh = jest.fn(() => {
      recoveryState = {
        activeBlock: { ...completedBlockFixture, completed_at: null },
        blocks: [{ ...completedBlockFixture, completed_at: null }],
        weeks: [completedWeekFixture],
      };
    });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    pressReopen(root);
    const buttons = alertSpy.mock.calls[0][2];
    await render.act(async () => { await buttons.find(b => b.text === 'Reopen block').onPress(); });

    expect(uncompleteBlockSpy).toHaveBeenCalledWith('rb-done');
    expect(refresh).toHaveBeenCalled();
    // Week completion state is exactly as it was — reopening the block never
    // reopens its latest week (#836 stays independent of #839).
    expect(completedWeekFixture.completed_at).toBe('2026-01-08T00:00:00.000Z');

    expect(findPressableByText(root, 'Start recovery block')).toBeNull();
    expect(root.findAll(n => n.type === 'Text' && typeof n.props.children === 'string' && n.props.children.startsWith('Reopen recovery block')).length).toBe(0);
  });

  test('a rejected reopen surfaces a truthful error and makes no mutation', async () => {
    await setup({ notes: [baselineNote] });
    uncompleteBlockSpy.mockRejectedValue(Object.assign(new Error('Only the most recently completed recovery block can be reopened.'), { code: 'BLOCK_NOT_NEWEST_COMPLETED' }));

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    pressReopen(root);
    const buttons = alertSpy.mock.calls[0][2];
    await render.act(async () => { await buttons.find(b => b.text === 'Reopen block').onPress(); });

    expect(alertSpy).toHaveBeenCalledWith(
      'Could not reopen this recovery block',
      'Only the most recently completed recovery block can be reopened.'
    );
    expect((await readPersistedBlocks()).find(b => b.id === 'rb-done').completed_at).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  test('a busy reopen prevents a double action: a second confirm press is rejected, not a second storage write', async () => {
    await setup({ notes: [baselineNote] });
    let releaseReopen;
    uncompleteBlockSpy.mockImplementation(() => new Promise(resolve => { releaseReopen = resolve; }));

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;

    pressReopen(root);
    const confirmOnPress = alertSpy.mock.calls[0][2].find(b => b.text === 'Reopen block').onPress;
    let firstPromise;
    render.act(() => { firstPromise = confirmOnPress(); });
    // A second confirm press while the first is still in flight — the same
    // shape as double-tapping a slow-to-dismiss native alert.
    await render.act(async () => { await confirmOnPress(); });

    expect(uncompleteBlockSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith(
      'Could not reopen this recovery block',
      'Another recovery action is already in progress.'
    );

    await render.act(async () => {
      releaseReopen({ ...completedBlockFixture, completed_at: null });
      await firstPromise;
    });
    expect(uncompleteBlockSpy).toHaveBeenCalledTimes(1);
  });
});

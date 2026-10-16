import { installRendererCleanup } from './helpers/log-screen';
import render from 'react-test-renderer';
import * as useEntries from '../hooks/useEntries';
import { findPressableByText, expandRoutineManagement, ControlledPreviousRoutines, ControlledLogScreen } from './helpers/log-screen';

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

// ── #905: Log-tab interaction targets and editor-header text scaling ─────────
//
// Track/Tracked is deliberately absent from this block. The owner reviewed the
// control on device and declined the size change (its 23dp box is unchanged),
// so #905's Track acceptance is knowingly unmet rather than silently skipped.
//
// The target is asserted the way #904's interaction-target-a11y.test.js asserts
// it -- the flattened minHeight/minWidth plus any hitSlop -- so a later style
// edit that drops the minimum fails here instead of shipping a 29dp tap area.
describe('Log interaction targets and header scaling (#905)', () => {
  const { StyleSheet } = require('react-native');
  const MIN_TARGET = 44;

  const AB_TEXT = 'MONDAY\n+Lifting\n-Squat 3x5\n---\nMONDAY\n+Lifting\n-Deadlift 3x5\n';

  beforeEach(() => {
    useEntries.useTrackedLifts.mockReturnValue({
      trackedLifts: [], activations: {}, toggle: jest.fn(), reconcileActivations: jest.fn(),
    });
    useEntries.useDeloadNote.mockReturnValue({ note: null, loading: false, save: jest.fn(), clear: jest.fn() });
    useEntries.useDeloadHistory.mockReturnValue({
      history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(),
      deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
    });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: false });
    useEntries.useUserProfile.mockReturnValue({
      profile: { sex: 'male', height_cm: 180, activity_level: 'active' },
      save: jest.fn(), loading: false, clear: jest.fn(),
    });
  });

  function targetHeight(node) {
    const style = StyleSheet.flatten(node.props.style) || {};
    const slop = typeof node.props.hitSlop === 'number'
      ? { top: node.props.hitSlop, bottom: node.props.hitSlop }
      : { top: 0, bottom: 0, ...(node.props.hitSlop || {}) };
    return (style.minHeight || style.height || 0) + slop.top + slop.bottom;
  }

  const pressablesByLabel = (root, label) => root.findAll(
    n => n.props?.accessibilityLabel === label && typeof n.props?.onPress === 'function'
  );

  // `Switch to Week B` and `Done` each label two live controls: the editor
  // header chip, and a card control that #711 relocated into the routine body.
  // Both are mounted at once (the read shell stays in the tree under
  // `display: none`), so every lookup has to say which one it means.
  // #711 also gave the active card's `actionStrip` `flexWrap: 'wrap'`, so the
  // width cap -- unique to the editor header -- is what identifies the row.
  const isEditorHeaderRow = (node) => {
    const style = StyleSheet.flatten(node.props?.style) || {};
    return style.flexWrap === 'wrap' && style.maxWidth !== undefined;
  };

  const inEditorHeader = (node) => {
    for (let n = node.parent; n; n = n.parent) {
      if (isEditorHeaderRow(n)) return true;
    }
    return false;
  };

  const headerChip = (root, label) => pressablesByLabel(root, label).find(inEditorHeader);

  // Drives the real screen into the other-routine editor on an A/B note, which
  // is the only state that mounts all three header chips at once.
  function renderABEditor() {
    const other = { id: 'note2', title: 'Untitled Routine', raw_text: AB_TEXT, saved_at: '2026-06-02T12:00:00.000Z' };
    const current = { id: 'note1', title: 'Routine A', raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5', saved_at: '2026-06-01T12:00:00.000Z' };
    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [current, other],
      currentId: 'note1',
      currentNote: current,
      deloadNotes: [],
      loading: false,
      error: null,
      refresh: jest.fn(),
      selectCurrent: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      add: jest.fn(),
      remove: jest.fn(),
    });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;
    expandRoutineManagement(root);
    render.act(() => { findPressableByText(root, 'Untitled Routine').props.onPress(); });
    render.act(() => { findPressableByText(root, 'Edit routine').props.onPress(); });
    return root;
  }

  test('New routine presents a 44dp target and announces its role and name', () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledPreviousRoutines
          otherNotes={[]}
          handleViewOtherNote={jest.fn()}
          viewingNoteDayGroups={[]}
          handleSwitchCurrent={jest.fn()}
          handleEditViewedNote={jest.fn()}
          handleDeleteRoutine={jest.fn()}
          handleCreateRoutine={jest.fn()}
        />
      );
    });
    const root = component.root;
    expandRoutineManagement(root);

    const button = root.findAll(
      n => n.props?.accessibilityLabel === 'New routine' && typeof n.props?.onPress === 'function'
    )[0];
    expect(button).toBeTruthy();
    expect(button.props.accessibilityRole).toBe('button');
    // A hitSlop would be clipped at topRow's bounds, which this button's own
    // height defines, so the target has to be the box.
    expect(button.props.hitSlop).toBeUndefined();
    expect(targetHeight(button)).toBeGreaterThanOrEqual(MIN_TARGET);
  });

  test('the read-view Done announces its role and name at a 44dp target', () => {
    const current = { id: 'note1', title: 'Routine A', raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5', saved_at: '2026-06-01T12:00:00.000Z' };
    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [current], currentId: 'note1', currentNote: current, deloadNotes: [],
      loading: false, error: null, refresh: jest.fn(), selectCurrent: jest.fn(),
      update: jest.fn().mockResolvedValue({}), add: jest.fn(), remove: jest.fn(),
    });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;
    // #1021: Edit routine lives behind the current-routine card's three-dot menu.
    render.act(() => { pressablesByLabel(root, 'Routine actions')[0].props.onPress({ stopPropagation: jest.fn() }); });
    render.act(() => { pressablesByLabel(root, 'Edit routine')[0].props.onPress({ stopPropagation: jest.fn() }); });

    // The read shell stays mounted under `display: none` while the editor is
    // open, so its own Done is the one outside the editor header row.
    const done = pressablesByLabel(root, 'Done').find(n => !inEditorHeader(n));
    expect(done).toBeTruthy();
    // The read-view control shipped without either prop; the editor's three
    // already had them.
    expect(done.props.accessibilityRole).toBe('button');
    expect(targetHeight(done)).toBeGreaterThanOrEqual(MIN_TARGET);
  });

  test.each(['Switch to Week B', 'Merge Week A and Week B into one routine', 'Done'])(
    'the editor header control %s presses through a real 44dp box',
    (label) => {
      const root = renderABEditor();
      const control = headerChip(root, label);
      expect(control).toBeTruthy();
      expect(control.props.accessibilityRole).toBe('button');
      expect(control.props.hitSlop).toBeUndefined();
      expect(targetHeight(control)).toBeGreaterThanOrEqual(MIN_TARGET);
    }
  );

  test('the editor header row wraps rather than clipping, and wrapped lines end flush right', () => {
    const root = renderABEditor();
    const done = headerChip(root, 'Done');

    let row = done.parent;
    while (row && !isEditorHeaderRow(row)) row = row.parent;
    expect(row).toBeTruthy();

    const style = StyleSheet.flatten(row.props.style);
    expect(style.flexDirection).toBe('row');
    expect(style.flexWrap).toBe('wrap');
    // ScreenShell's title group is flex:1 (basis 0), so this row is never asked
    // to give width back; without a cap flexWrap can never engage and a chip
    // runs off the right edge instead.
    expect(parseFloat(style.maxWidth)).toBeLessThanOrEqual(75);
    // Spacing lives on the row, not as a trailing margin on each chip: a
    // marginRight would leave a wrapped line ending short of the row's edge.
    expect(style.columnGap).toBe(style.rowGap);
    expect(style.justifyContent).toBe('flex-end');
    ['Switch to Week B', 'Merge Week A and Week B into one routine', 'Done'].forEach((label) => {
      const chipStyle = StyleSheet.flatten(headerChip(root, label).props.style) || {};
      expect(chipStyle.marginRight || 0).toBe(0);
    });
  });

  test('the editor header labels stay scalable, so the wrap is what absorbs large text', () => {
    const root = renderABEditor();
    ['Week B', 'Merge weeks', 'Done'].forEach((text) => {
      const label = root.findAll(
        n => n.type === 'Text'
          && String(Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children ?? '').includes(text)
      )[0];
      expect(label).toBeTruthy();
      // Pinning the type would keep the row on one line by making the control
      // unreadable at the user's chosen size; the row wraps instead.
      expect(label.props.allowFontScaling).not.toBe(false);
    });
  });
});

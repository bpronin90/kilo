import { installRendererCleanup } from './helpers/log-screen';
import render from 'react-test-renderer';
import { LogScreenEditorCard } from '../components/LogScreenEditorCard';

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

// ── #863: quiet on-demand problem list in the Log editor ─────────────────────

describe('LogScreenEditorCard quiet on-demand problem list (#863)', () => {
  const { LightColors } = require('../theme/colors');

  const mockHandlers = {
    handleSaveDeload: jest.fn(),
    handleCurrentTextChange: jest.fn(),
    handleSaveOtherNote: jest.fn(),
    handleSave: jest.fn(),
    handleSwitchCurrent: jest.fn(),
    handleDeleteDeloadNoteFromEditor: jest.fn(),
    handleDeleteRoutine: jest.fn(),
    setDeloadEditText: jest.fn(),
    setEditingTitle: jest.fn(),
    setWorkoutNoteTitle: jest.fn(),
    setDeloadEditDate: jest.fn(),
    setShowDeloadDatePicker: jest.fn(),
    setDeloadEditOrdinal: jest.fn(),
    setEditingText: jest.fn(),
  };

  // Selecting a problem sets a one-shot forced selection (the same
  // mechanism the seed-example insert uses), which schedules a same-tick
  // cleanup timer. Unmounting after each test lets that timer fire against a
  // still-live tree instead of leaking past this test into a later one.
  const mounted = [];
  afterEach(() => {
    render.act(() => { mounted.forEach(c => c.unmount()); });
    mounted.length = 0;
  });

  function buildElement(overrides = {}) {
    return (
      <LogScreenEditorCard
        deloadMode="read"
        deloadEditText=""
        isSaving={false}
        saveSuccess={false}
        editingNoteId={null}
        isEditingDeloadNote={false}
        workoutNoteTitle="Test"
        editingTitle=""
        editingDeloadHasLinkedRecord={false}
        deloadEditDate=""
        deloadEditOrdinal=""
        showDeloadDatePicker={false}
        editingNote={null}
        editingText=""
        activeEditText=""
        currentId={null}
        currentMode="edit"
        editingEffectiveWeek={null}
        {...mockHandlers}
        {...overrides}
      />
    );
  }

  function renderEditor(overrides = {}) {
    let component;
    render.act(() => {
      component = render.create(buildElement(overrides));
    });
    mounted.push(component);
    return component;
  }

  function findByTestID(root, testID) {
    return root.findAll(n => n.props?.testID === testID)[0];
  }

  function findFlatStyle(node) {
    return [].concat(node.props.style).filter(Boolean).reduce((acc, s) => ({ ...acc, ...s }), {});
  }

  function rowLabels(root) {
    return findByTestID(root, 'editor-validation-list')
      .findAllByType('Text')
      .map(n => n.props.children);
  }

  function findFirstListRow(root) {
    return findByTestID(root, 'editor-validation-list')
      .findAll(n => typeof n.props?.onPress === 'function')[0];
  }

  function findListRowByPrefix(root, prefix) {
    return findByTestID(root, 'editor-validation-list')
      .findAll(n => typeof n.props?.onPress === 'function' && n.props?.accessibilityLabel?.startsWith(prefix))[0];
  }

  // Advances the debounced recompute past VALIDATION_DEBOUNCE_MS so a prop
  // update (a simulated edit) is reflected in the problem list.
  function settleDebounce() {
    render.act(() => { jest.runAllTimers(); });
  }

  test('a clean note shows no badge and no bar', () => {
    const component = renderEditor({ activeEditText: 'Monday\n-Bench\n135 5,5,5' });
    expect(findByTestID(component.root, 'editor-validation-badge')).toBeFalsy();
    expect(findByTestID(component.root, 'editor-validation-bar')).toBeFalsy();
  });

  test('badge renders an outlined "!" and the total count, colored by the severity mix', () => {
    const errorOnly = renderEditor({ activeEditText: 'Monday\n-Bench\n135 8,,8' });
    let badge = findByTestID(errorOnly.root, 'editor-validation-badge');
    expect(badge).toBeTruthy();
    expect(badge.props.accessibilityLabel).toMatch(/^1 problem\./);
    const glyph = badge.findAllByType('Text')[0];
    expect(glyph.props.children).toBe('!');
    expect(findFlatStyle(glyph).color).toBe(LightColors.error);
    const count = badge.findAllByType('Text')[1];
    expect(count.props.children).toBe(1);
    expect(findFlatStyle(count).color).toBe(LightColors.error);

    const warningOnly = renderEditor({
      activeEditText: 'Monday\n-Bench\n- 135 5,5\n- 140 5,5\n-Deadlift\n- 225 5',
      sessionAlignmentIssue: {
        code: 'uneven_session_entries',
        message: 'placeholder',
        affectedExercises: [
          { name: 'Bench', entryCount: 2, sectionIndex: 0, sectionLabel: 'Monday', missingSessionIndexes: [] },
          { name: 'Deadlift', entryCount: 1, sectionIndex: 0, sectionLabel: 'Monday', missingSessionIndexes: [2] },
        ],
      },
    });
    badge = findByTestID(warningOnly.root, 'editor-validation-badge');
    expect(findFlatStyle(badge.findAllByType('Text')[0]).color).toBe(LightColors.caution);

    const mixed = renderEditor({
      activeEditText: 'Monday\n-Bench\n135 8,,8\n- 140 5,5\n-Deadlift\n- 225 5',
      sessionAlignmentIssue: {
        code: 'uneven_session_entries',
        message: 'placeholder',
        affectedExercises: [
          { name: 'Deadlift', entryCount: 1, sectionIndex: 0, sectionLabel: 'Monday', missingSessionIndexes: [2] },
        ],
      },
    });
    badge = findByTestID(mixed.root, 'editor-validation-badge');
    expect(findFlatStyle(badge.findAllByType('Text')[0]).color).toBe(LightColors.error);
  });

  test('tapping the badge opens the list; tapping it again closes it', () => {
    const component = renderEditor({ activeEditText: 'Monday\n-Bench\n135 8,,8' });
    const root = component.root;
    expect(findByTestID(root, 'editor-validation-list')).toBeFalsy();

    render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });
    expect(findByTestID(root, 'editor-validation-list')).toBeTruthy();

    render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });
    expect(findByTestID(root, 'editor-validation-list')).toBeFalsy();
  });

  test('a syntax jump releases without an iOS acknowledgment, so badge toggles cannot reapply it (#865)', () => {
    jest.useFakeTimers();
    try {
      const text = ['Monday', '-Bench', '135 8,,8'].join('\n');
      const component = renderEditor({ activeEditText: text });
      const root = component.root;
      render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });
      render.act(() => { findFirstListRow(root).props.onPress(); });

      let noteInput = root.findAllByType('TextInput').find(ti => ti.props.multiline && ti.props.value === text);
      const expected = {
        start: 'Monday\n-Bench\n'.length,
        end: 'Monday\n-Bench\n135 8,,8'.length,
      };
      expect(noteInput.props.selection).toEqual(expected);
      expect(noteInput.props.selectionColor).toBe(LightColors.accent);

      // React Native 0.81.5 iOS applies this JS-driven range without emitting
      // onSelectionChange. The one-shot fallback must still release control.
      render.act(() => { jest.runOnlyPendingTimers(); });
      noteInput = root.findAllByType('TextInput').find(ti => ti.props.multiline && ti.props.value === text);
      expect(noteInput.props.selection).toBeUndefined();

      render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });
      render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });
      noteInput = root.findAllByType('TextInput').find(ti => ti.props.multiline && ti.props.value === text);
      expect(noteInput.props.selection).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  test('an unacknowledged jump yields to a different native selection before selecting another problem (#865)', () => {
    const text = ['Monday', '-Bench', '135 8,,8', '-Squat', '225 5-8'].join('\n');
    const component = renderEditor({ activeEditText: text });
    const root = component.root;
    render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });
    render.act(() => { findListRowByPrefix(root, 'Bench:').props.onPress(); });
    let noteInput = root.findAllByType('TextInput').find(ti => ti.props.multiline && ti.props.value === text);
    const firstSelection = noteInput.props.selection;
    render.act(() => {
      noteInput.props.onSelectionChange({ nativeEvent: { selection: { start: 0, end: 0 } } });
    });
    noteInput = root.findAllByType('TextInput').find(ti => ti.props.multiline && ti.props.value === text);
    expect(noteInput.props.selection).toBeUndefined();

    render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });
    render.act(() => { findListRowByPrefix(root, 'Squat:').props.onPress(); });
    noteInput = root.findAllByType('TextInput').find(ti => ti.props.multiline && ti.props.value === text);
    expect(noteInput.props.selection).toEqual({ start: text.indexOf('225 5-8'), end: text.length });
    expect(noteInput.props.selection).not.toEqual(firstSelection);
  });

  test('list rows use human-readable context, never a visible line number', () => {
    const text = ['Monday', '-Bench', '135 8,,8'].join('\n');
    const component = renderEditor({ activeEditText: text });
    render.act(() => { findByTestID(component.root, 'editor-validation-badge').props.onPress(); });
    const labels = rowLabels(component.root);
    expect(labels.length).toBeGreaterThan(0);
    labels.forEach(label => expect(label).not.toMatch(/\bLine \d/));
    expect(labels[0]).toMatch(/^Bench:/);
  });

  test('session alignment: only exercises with a missing position appear, one row per position', () => {
    const text = ['Monday', '-Bench', '- 135 5', '- 135 5', '- 135 5', '-Deadlift', '- 225 5'].join('\n');
    const component = renderEditor({
      activeEditText: text,
      sessionAlignmentIssue: {
        code: 'uneven_session_entries',
        message: 'placeholder',
        affectedExercises: [
          { name: 'Bench', entryCount: 3, sectionIndex: 0, sectionLabel: 'Monday', missingSessionIndexes: [] },
          { name: 'Deadlift', entryCount: 1, sectionIndex: 0, sectionLabel: 'Monday', missingSessionIndexes: [2, 3] },
        ],
      },
    });
    render.act(() => { findByTestID(component.root, 'editor-validation-badge').props.onPress(); });
    const labels = rowLabels(component.root);
    expect(labels).toEqual([
      'Monday · Deadlift: session 2 has no entry',
      'Monday · Deadlift: session 3 has no entry',
    ]);
  });

  test('selecting a syntax row closes the list, selects the malformed line, and shows the bar below the input', () => {
    const text = ['Monday', '-Bench', '135 8,,8'].join('\n');
    const component = renderEditor({ activeEditText: text });
    const root = component.root;
    render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });

    const row = findFirstListRow(root);
    render.act(() => { row.props.onPress(); });

    expect(findByTestID(root, 'editor-validation-list')).toBeFalsy();
    const noteInput = root.findAllByType('TextInput').find(ti => ti.props.multiline && ti.props.value === text);
    const expectedStart = 'Monday\n-Bench\n'.length;
    expect(noteInput.props.selection).toEqual({ start: expectedStart, end: expectedStart + '135 8,,8'.length });
    expect(mockHandlers.handleCurrentTextChange).not.toHaveBeenCalled();

    const bar = findByTestID(root, 'editor-validation-bar');
    expect(bar).toBeTruthy();
    expect(bar.findAllByType('Text')[0].props.children).toMatch(/^Bench:/);
  });

  test('a missing-session caret releases before later badge toggles (#865)', () => {
    jest.useFakeTimers();
    try {
      const text = ['Monday', '-Bench', '- 135 5,5', '- 140 5,5', '-Deadlift', '- 225 5'].join('\n');
      const component = renderEditor({
        activeEditText: text,
        sessionAlignmentIssue: {
          code: 'uneven_session_entries',
          message: 'placeholder',
          affectedExercises: [
            { name: 'Deadlift', entryCount: 1, sectionIndex: 0, sectionLabel: 'Monday', missingSessionIndexes: [2] },
          ],
        },
      });
      const root = component.root;
      render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });
      const row = findFirstListRow(root);
      render.act(() => { row.props.onPress(); });

      let noteInput = root.findAllByType('TextInput').find(ti => ti.props.multiline && ti.props.value === text);
      // Deadlift is the last exercise with no trailing lines after it, so the
      // insertion point (mirroring the "Skip week" marker) lands at the very
      // end of the text.
      expect(noteInput.props.selection).toEqual({ start: text.length, end: text.length });

      render.act(() => { jest.runOnlyPendingTimers(); });
      noteInput = root.findAllByType('TextInput').find(ti => ti.props.multiline && ti.props.value === text);
      expect(noteInput.props.selection).toBeUndefined();

      render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });
      render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });
      noteInput = root.findAllByType('TextInput').find(ti => ti.props.multiline && ti.props.value === text);
      expect(noteInput.props.selection).toBeUndefined();

      const bar = findByTestID(root, 'editor-validation-bar');
      expect(bar.findAllByType('Text')[0].props.children).toBe('Monday · Deadlift: session 2 has no entry');
    } finally {
      jest.useRealTimers();
    }
  });

  test('fixing the selected problem clears the bar on its own', () => {
    jest.useFakeTimers();
    try {
      const broken = ['Monday', '-Bench', '135 8,,8'].join('\n');
      const fixed = ['Monday', '-Bench', '135 8,8'].join('\n');
      const component = renderEditor({ activeEditText: broken });
      const root = component.root;
      render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });
      const row = findFirstListRow(root);
      render.act(() => { row.props.onPress(); });
      expect(findByTestID(root, 'editor-validation-bar')).toBeTruthy();

      render.act(() => { component.update(buildElement({ activeEditText: fixed })); });
      settleDebounce();

      expect(findByTestID(root, 'editor-validation-bar')).toBeFalsy();
      expect(findByTestID(root, 'editor-validation-badge')).toBeFalsy();
    } finally {
      jest.useRealTimers();
    }
  });

  test('the bar stays attached to the same logical problem when lines shift above it, and other problems remain listed', () => {
    jest.useFakeTimers();
    try {
      const original = ['Monday', '-Bench', '135 8,,8', '-Squat', '225 5-8'].join('\n');
      const shifted = ['Monday', '-Row', '135 5,5', '-Bench', '135 8,,8', '-Squat', '225 5-8'].join('\n');
      const component = renderEditor({ activeEditText: original });
      const root = component.root;
      render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });
      const benchRow = findListRowByPrefix(root, 'Bench:');
      render.act(() => { benchRow.props.onPress(); });
      const barBefore = findByTestID(root, 'editor-validation-bar').findAllByType('Text')[0].props.children;

      render.act(() => { component.update(buildElement({ activeEditText: shifted })); });
      settleDebounce();

      const barAfter = findByTestID(root, 'editor-validation-bar').findAllByType('Text')[0].props.children;
      expect(barAfter).toBe(barBefore);

      // The other, unfixed problem (Squat) is still reachable in the list.
      render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });
      const labels = rowLabels(root);
      expect(labels.some(l => l.startsWith('Squat:'))).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test('the bar stays attached when a line shifts WITHIN the same exercise, above the selected row (#863 review)', () => {
    // Distinct from the previous test: here the inserted line is inside the
    // very exercise the selected problem belongs to, not above the whole
    // exercise block. An identity based on offset-from-the-exercise-header
    // would change here and wrongly clear the bar; a diff-based identity
    // that follows the row's own unchanged text must not.
    jest.useFakeTimers();
    try {
      const original = ['Monday', '-Bench', '135 8,,8'].join('\n');
      const shifted = ['Monday', '-Bench', '135 5,5', '135 8,,8'].join('\n');
      const component = renderEditor({ activeEditText: original });
      const root = component.root;
      render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });
      render.act(() => { findFirstListRow(root).props.onPress(); });
      const barBefore = findByTestID(root, 'editor-validation-bar').findAllByType('Text')[0].props.children;

      render.act(() => { component.update(buildElement({ activeEditText: shifted })); });
      settleDebounce();

      const bar = findByTestID(root, 'editor-validation-bar');
      expect(bar).toBeTruthy();
      expect(bar.findAllByType('Text')[0].props.children).toBe(barBefore);
    } finally {
      jest.useRealTimers();
    }
  });

  test('the FIRST edit after mount still debounces into an updated problem list (no skipped-debounce regression)', () => {
    jest.useFakeTimers();
    try {
      const clean = 'Monday\n-Bench\n135 5,5,5';
      const broken = 'Monday\n-Bench\n135 8,,8';
      const component = renderEditor({ activeEditText: clean });
      expect(findByTestID(component.root, 'editor-validation-badge')).toBeFalsy();

      // A single edit — the first (and only) prop change since mount.
      render.act(() => {
        component.update(buildElement({ activeEditText: broken }));
      });
      settleDebounce();

      expect(findByTestID(component.root, 'editor-validation-badge')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  test('leaving the editor (currentMode) clears the selected problem and closes the list', () => {
    const text = ['Monday', '-Bench', '135 8,,8'].join('\n');
    const component = renderEditor({ activeEditText: text, currentMode: 'edit' });
    const root = component.root;
    render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });
    const row = findFirstListRow(root);
    render.act(() => { row.props.onPress(); });
    expect(findByTestID(root, 'editor-validation-bar')).toBeTruthy();

    render.act(() => { component.update(buildElement({ activeEditText: text, currentMode: 'read' })); });

    expect(findByTestID(root, 'editor-validation-bar')).toBeFalsy();
  });

  test('switching A/B week (editingEffectiveWeek) clears the selected problem and closes the list', () => {
    const text = ['Monday', '-Bench', '135 8,,8'].join('\n');
    const component = renderEditor({
      editingNoteId: 'other-1',
      editingText: text,
      editingEffectiveWeek: 'A',
    });
    const root = component.root;
    render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });
    expect(findByTestID(root, 'editor-validation-list')).toBeTruthy();

    render.act(() => {
      component.update(buildElement({ editingNoteId: 'other-1', editingText: text, editingEffectiveWeek: 'B' }));
    });

    expect(findByTestID(root, 'editor-validation-list')).toBeFalsy();
  });

  test('dismissing the bar clears the selected problem without closing anything else', () => {
    const text = ['Monday', '-Bench', '135 8,,8'].join('\n');
    const component = renderEditor({ activeEditText: text });
    const root = component.root;
    render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });
    const row = findFirstListRow(root);
    render.act(() => { row.props.onPress(); });
    const bar = findByTestID(root, 'editor-validation-bar');

    const dismiss = bar.findAll(n => n.props?.accessibilityLabel === 'Dismiss problem message')[0];
    render.act(() => { dismiss.props.onPress(); });

    expect(findByTestID(root, 'editor-validation-bar')).toBeFalsy();
  });

  test('the inline problem list persists taps while the keyboard is open (#863 review)', () => {
    const component = renderEditor({ activeEditText: 'Monday\n-Bench\n135 8,,8' });
    render.act(() => { findByTestID(component.root, 'editor-validation-badge').props.onPress(); });
    const list = findByTestID(component.root, 'editor-validation-list');
    expect(list.props.keyboardShouldPersistTaps).toBe('handled');
  });

  test('missing-session caret lands before a directly-following dash-header exercise, not inside it (#863 review)', () => {
    // Bench (the affected exercise) is immediately followed by "-Squat" with
    // no blank line between them — the inserted "-" marker line and "-Squat"
    // share a leading "-", which previously fooled a char-by-char scan into
    // landing the caret one character into "-Squat" instead of before it.
    const text = ['Monday', '-Bench', '- 135 5,5', '-Squat', '- 225 5,5', '- 230 5,5'].join('\n');
    const component = renderEditor({
      activeEditText: text,
      sessionAlignmentIssue: {
        code: 'uneven_session_entries',
        message: 'placeholder',
        affectedExercises: [
          { name: 'Bench', entryCount: 1, sectionIndex: 0, sectionLabel: 'Monday', missingSessionIndexes: [2] },
        ],
      },
    });
    const root = component.root;
    render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });
    render.act(() => { findFirstListRow(root).props.onPress(); });

    const noteInput = root.findAllByType('TextInput').find(ti => ti.props.multiline && ti.props.value === text);
    const expectedOffset = text.indexOf('-Squat');
    expect(noteInput.props.selection).toEqual({ start: expectedOffset, end: expectedOffset });
  });

  test('two rows with an identical diagnostic get distinct ids, and fixing one clears only its own selection (#863 review)', () => {
    jest.useFakeTimers();
    try {
      const text = ['Monday', '-Bench', '135 8,,8', '135 8,,8'].join('\n');
      const fixedSecond = ['Monday', '-Bench', '135 8,,8', '135 8,8'].join('\n');
      const component = renderEditor({ activeEditText: text });
      const root = component.root;
      render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });
      const rows = findByTestID(root, 'editor-validation-list').findAll(n => typeof n.props?.onPress === 'function');
      expect(rows.length).toBe(2);

      // Select the SECOND occurrence — the one that's about to be fixed.
      render.act(() => { rows[1].props.onPress(); });
      expect(findByTestID(root, 'editor-validation-bar')).toBeTruthy();

      render.act(() => { component.update(buildElement({ activeEditText: fixedSecond })); });
      settleDebounce();

      // Its own bar clears, and the still-broken first occurrence remains
      // listed as exactly one problem (not silently reattached to it).
      expect(findByTestID(root, 'editor-validation-bar')).toBeFalsy();
      render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });
      expect(rowLabels(root).length).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test('fixing the FIRST of two identical duplicates also clears its own selection, without reattaching to the second (#863 review)', () => {
    jest.useFakeTimers();
    try {
      const text = ['Monday', '-Bench', '135 8,,8', '135 8,,8'].join('\n');
      const fixedFirst = ['Monday', '-Bench', '135 8,8', '135 8,,8'].join('\n');
      const component = renderEditor({ activeEditText: text });
      const root = component.root;
      render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });
      const rows = findByTestID(root, 'editor-validation-list').findAll(n => typeof n.props?.onPress === 'function');
      expect(rows.length).toBe(2);

      // Select the FIRST occurrence — the one that's about to be fixed. A
      // rank-based id would reassign the surviving second occurrence onto
      // this exact selection once the first is gone, so the bar would
      // wrongly stay up; an offset-from-the-exercise-header id must not.
      render.act(() => { rows[0].props.onPress(); });
      expect(findByTestID(root, 'editor-validation-bar')).toBeTruthy();

      render.act(() => { component.update(buildElement({ activeEditText: fixedFirst })); });
      settleDebounce();

      expect(findByTestID(root, 'editor-validation-bar')).toBeFalsy();
      render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });
      expect(rowLabels(root).length).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  // #867. Every test above observes the one-render `selection` PROP, which is
  // only the fallback path and proves nothing about what a device applied:
  // RN 0.81's `useTextInputStateSynchronization` forwards a controlled
  // selection to native ONLY when the requested range differs from the last
  // range it pushed or native reported, so a passing prop assertion is
  // compatible with native receiving no command at all. That is how two
  // selection-lifecycle implementations passed CI and changed nothing on the
  // device (#865/#866). These tests assert on the native commands instead.
  describe('native selection commands and a non-displacing problem list (#867)', () => {
    // RN 0.81's TextInput instance exposes `focus()` and
    // `setSelection(start, end)`; the latter dispatches `setTextAndSelection`
    // straight to native with a null text, unconditionally. React Native's own
    // jest mock ships the first and omits the second, so these tests install
    // the missing command and record both.
    const nativeCalls = [];
    let restoreTextInput = () => {};
    beforeEach(() => {
      const proto = require('react-native').TextInput.prototype;
      const originalFocus = proto.focus;
      const hadSetSelection = Object.prototype.hasOwnProperty.call(proto, 'setSelection');
      const originalSetSelection = proto.setSelection;
      nativeCalls.length = 0;
      proto.focus = function () { nativeCalls.push(['focus']); };
      proto.setSelection = function (start, end) { nativeCalls.push(['setSelection', start, end]); };
      restoreTextInput = () => {
        proto.focus = originalFocus;
        if (hadSetSelection) proto.setSelection = originalSetSelection;
        else delete proto.setSelection;
      };
    });
    afterEach(() => { restoreTextInput(); });

    function findNoteInput(root, text) {
      return root.findAllByType('TextInput').find(ti => ti.props.multiline && ti.props.value === text);
    }

    function toggleList(root) {
      render.act(() => { findByTestID(root, 'editor-validation-badge').props.onPress(); });
    }

    function layOutToolRow(root, height) {
      render.act(() => {
        findByTestID(root, 'editor-tool-row').props.onLayout({ nativeEvent: { layout: { height } } });
      });
    }

    // The innermost node carrying the testID — the host view whose children
    // are the tool row, the note, and (when open) the overlay.
    function findStack(root) {
      const matches = root.findAll(n => n.props?.testID === 'editor-stack');
      return matches[matches.length - 1];
    }

    // The IN-FLOW children of that container. Anything absolutely positioned
    // is excluded, because it cannot displace the note.
    function inFlowStackChildStyles(root) {
      return findStack(root).children
        .filter(child => typeof child !== 'string')
        .map(child => findFlatStyle(child))
        .filter(style => style.position !== 'absolute');
    }

    test('selecting a syntax problem hands the whole malformed line to native, after focus, and leaves no controlled selection behind', () => {
      jest.useFakeTimers();
      try {
        const text = ['Monday', '-Bench', '135 8,,8'].join('\n');
        const component = renderEditor({ activeEditText: text });
        const root = component.root;
        toggleList(root);
        render.act(() => { findFirstListRow(root).props.onPress(); });

        const start = 'Monday\n-Bench\n'.length;
        const end = start + '135 8,,8'.length;
        // Focus precedes the range: Android paints a selection highlight only
        // while the input holds focus, and taking focus can move the caret on
        // its own, so a range applied first would be thrown away.
        expect(nativeCalls).toEqual([['focus'], ['setSelection', start, end]]);

        // Durable rather than transient: no controlled `selection` was handed
        // to the input at all, so no later render can release, re-push, or
        // fight the range native is now holding.
        expect(findNoteInput(root, text).props.selection).toBeUndefined();
        render.act(() => { jest.runOnlyPendingTimers(); });
        expect(findNoteInput(root, text).props.selection).toBeUndefined();
        expect(nativeCalls).toHaveLength(2);
      } finally {
        jest.useRealTimers();
      }
    });

    test('re-selecting the same problem reissues the identical range, which the controlled prop would have deduplicated away', () => {
      const text = ['Monday', '-Bench', '135 8,,8'].join('\n');
      const component = renderEditor({ activeEditText: text });
      const root = component.root;
      const start = 'Monday\n-Bench\n'.length;
      const end = start + '135 8,,8'.length;

      toggleList(root);
      render.act(() => { findFirstListRow(root).props.onPress(); });
      toggleList(root);
      render.act(() => { findFirstListRow(root).props.onPress(); });

      expect(nativeCalls).toEqual([
        ['focus'], ['setSelection', start, end],
        ['focus'], ['setSelection', start, end],
      ]);
    });

    test('a jump native never acknowledges still cannot be reapplied by a later render', () => {
      jest.useFakeTimers();
      try {
        const text = ['Monday', '-Bench', '135 8,,8', '-Squat', '225 5-8'].join('\n');
        const component = renderEditor({ activeEditText: text });
        const root = component.root;
        toggleList(root);
        render.act(() => { findListRowByPrefix(root, 'Bench:').props.onPress(); });
        expect(nativeCalls).toHaveLength(2);

        // iOS applies a JS-driven range without emitting onSelectionChange, so
        // nothing ever reports it back. Timers and re-renders must still leave
        // native's selection exactly where it is.
        render.act(() => { jest.runAllTimers(); });
        toggleList(root);
        toggleList(root);
        render.act(() => { jest.runAllTimers(); });

        expect(nativeCalls).toHaveLength(2);
        expect(findNoteInput(root, text).props.selection).toBeUndefined();
      } finally {
        jest.useRealTimers();
      }
    });

    test('a caret the user moves after a jump is never pulled back', () => {
      const text = ['Monday', '-Bench', '135 8,,8', '-Squat', '225 5-8'].join('\n');
      const component = renderEditor({ activeEditText: text });
      const root = component.root;
      toggleList(root);
      render.act(() => { findListRowByPrefix(root, 'Bench:').props.onPress(); });

      render.act(() => {
        findNoteInput(root, text).props.onSelectionChange({ nativeEvent: { selection: { start: 0, end: 0 } } });
      });

      expect(nativeCalls).toHaveLength(2);
      expect(findNoteInput(root, text).props.selection).toBeUndefined();
    });

    test('selecting another problem navigates to that row, carrying no range from the earlier one', () => {
      const text = ['Monday', '-Bench', '135 8,,8', '-Squat', '225 5-8'].join('\n');
      const component = renderEditor({ activeEditText: text });
      const root = component.root;
      toggleList(root);
      render.act(() => { findListRowByPrefix(root, 'Bench:').props.onPress(); });
      toggleList(root);
      render.act(() => { findListRowByPrefix(root, 'Squat:').props.onPress(); });

      const benchStart = 'Monday\n-Bench\n'.length;
      expect(nativeCalls).toEqual([
        ['focus'], ['setSelection', benchStart, benchStart + '135 8,,8'.length],
        ['focus'], ['setSelection', text.indexOf('225 5-8'), text.length],
      ]);
    });

    test('a missing-session problem makes exactly one collapsed caret jump to its insertion point', () => {
      jest.useFakeTimers();
      try {
        const text = ['Monday', '-Bench', '- 135 5,5', '- 140 5,5', '-Deadlift', '- 225 5'].join('\n');
        const component = renderEditor({
          activeEditText: text,
          sessionAlignmentIssue: {
            code: 'uneven_session_entries',
            message: 'placeholder',
            affectedExercises: [
              { name: 'Deadlift', entryCount: 1, sectionIndex: 0, sectionLabel: 'Monday', missingSessionIndexes: [2] },
            ],
          },
        });
        const root = component.root;
        toggleList(root);
        render.act(() => { findFirstListRow(root).props.onPress(); });

        expect(nativeCalls).toEqual([['focus'], ['setSelection', text.length, text.length]]);

        // One intentional jump, and nothing left behind to pin what comes next.
        render.act(() => { jest.runAllTimers(); });
        toggleList(root);
        toggleList(root);
        expect(nativeCalls).toHaveLength(2);
        expect(findNoteInput(root, text).props.selection).toBeUndefined();
      } finally {
        jest.useRealTimers();
      }
    });

    test('repeatedly toggling the badge after a jump — and after the user has moved on — issues no focus, selection, or caret command at all', () => {
      jest.useFakeTimers();
      try {
        const text = ['Monday', '-Bench', '135 8,,8', '-Squat', '225 5-8'].join('\n');
        const component = renderEditor({ activeEditText: text });
        const root = component.root;
        layOutToolRow(root, 44);
        toggleList(root);
        render.act(() => { findListRowByPrefix(root, 'Squat:').props.onPress(); });
        render.act(() => { jest.runAllTimers(); });

        // Stands in for the user scrolling away and tapping elsewhere in the
        // note: native reports a caret of its own, unrelated to the jump.
        render.act(() => {
          findNoteInput(root, text).props.onSelectionChange({ nativeEvent: { selection: { start: 3, end: 3 } } });
        });
        nativeCalls.length = 0;
        const settledFlow = inFlowStackChildStyles(root);

        for (let i = 0; i < 6; i++) {
          toggleList(root);
          render.act(() => { jest.runAllTimers(); });
          // The note keeps its exact box on every one of those toggles. As an
          // in-flow row the list moved it by its own height each time — which
          // both shifted the page and, on Android, made the platform drag the
          // caret back on screen.
          expect(inFlowStackChildStyles(root)).toEqual(settledFlow);
        }

        expect(nativeCalls).toEqual([]);
        expect(findNoteInput(root, text).props.selection).toBeUndefined();
      } finally {
        jest.useRealTimers();
      }
    });

    test('the problem list overlays the note instead of displacing it, so opening or closing it changes no layout', () => {
      const text = ['Monday', '-Bench', '135 8,,8'].join('\n');
      const component = renderEditor({ activeEditText: text });
      const root = component.root;
      layOutToolRow(root, 44);

      const closedFlow = inFlowStackChildStyles(root);
      const closedChildCount = findStack(root).children.length;
      expect(closedFlow).toHaveLength(2);

      toggleList(root);

      // The list really is inside the same container as the note…
      expect(findStack(root).children.length).toBe(closedChildCount + 1);
      // …but adds nothing to its flow, so the note's box and the page's
      // content height are identical whether it is open or closed.
      expect(inFlowStackChildStyles(root)).toEqual(closedFlow);

      const listStyle = findFlatStyle(findByTestID(root, 'editor-validation-list'));
      expect(listStyle.position).toBe('absolute');
      expect(listStyle.top).toBe(44 + 8);
      // Opaque, because it now covers the note rather than pushing it down.
      expect(listStyle.backgroundColor).toBe(LightColors.card);

      toggleList(root);
      expect(inFlowStackChildStyles(root)).toEqual(closedFlow);
      expect(findStack(root).children.length).toBe(closedChildCount);
    });

    test('the overlay follows the tool row when it wraps at large text, and always ends inside its container', () => {
      // On Android a child drawn outside its parent's bounds receives no
      // touches, so the overlay's bottom has to stay inside the tool row +
      // note stack however tall the tool row grows.
      const text = ['Monday', '-Bench', '135 8,,8'].join('\n');
      const component = renderEditor({ activeEditText: text });
      const root = component.root;
      layOutToolRow(root, 96);
      toggleList(root);

      const listStyle = findFlatStyle(findByTestID(root, 'editor-validation-list'));
      expect(listStyle.position).toBe('absolute');
      expect(listStyle.top).toBe(96 + 8);
      const noteStyle = findFlatStyle(findNoteInput(root, text));
      expect(listStyle.top + listStyle.maxHeight).toBeLessThanOrEqual(96 + 10 + noteStyle.minHeight);
    });
  });
});

import { installRendererCleanup } from './helpers/log-screen';
import React from 'react';
import render from 'react-test-renderer';
import * as useEntries from '../hooks/useEntries';
import { parseWorkoutNote } from '../lib/parser';
import { Alert } from 'react-native';
import { findPressableByText, openCurrentRoutineMenu, ControlledLogScreen } from './helpers/log-screen';

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

// Walk up from a matching Text node to its Nth Pressable (onPress) ancestor,
// nearest first. `depth` defaults to the nearest one; pass 2 to reach the
// enclosing container Pressable when the matched text sits inside its own
// button (e.g. the skip control inside the active card's body).
function pressableAround(root, predicate, depth = 1) {
  const matches = root.findAll(
    n => n.type === 'Text' && predicate(
      Array.isArray(n.props.children) ? n.props.children.join('') : String(n.props.children ?? '')
    )
  );
  for (const match of matches) {
    let node = match.parent;
    let seen = 0;
    while (node) {
      if (node.props && typeof node.props.onPress === 'function') {
        seen += 1;
        if (seen === depth) return node;
      }
      node = node.parent;
    }
  }
  return null;
}

// ── typed note navigation intents (#718) ──────────────────────────────────────

describe('typed note navigation intents (#718)', () => {
  const CURRENT = {
    id: 'note1',
    title: 'Routine A',
    raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5',
    saved_at: '2026-06-01T12:00:00.000Z',
  };
  const OTHER = {
    id: 'r1',
    title: 'Routine B',
    raw_text: 'Tuesday\n+Lifting\n-Squat\n225 5,5,5',
    saved_at: '2026-05-01T12:00:00.000Z',
  };

  // A past-deload note. It lives in `notes` (so the intent can resolve it) but
  // is rendered ONLY by LogDeloadSection: LogPreviousRoutines filters the
  // 'Deload · ' prefix out of otherNotes.
  const DELOAD = {
    id: 'd1',
    title: 'Deload · Week 1',
    raw_text: 'Monday\n+Lifting\n-Bench\n95 5,5,5',
    saved_at: '2026-04-01T12:00:00.000Z',
  };

  let alertSpy;

  function mockNotes({ notes = [CURRENT, OTHER], loading = false, error = null, deloadNotes = [] } = {}) {
    useEntries.useWorkoutNotes.mockReturnValue({
      notes,
      currentId: 'note1',
      currentNote: CURRENT,
      deloadNotes,
      loading,
      error,
      refresh: jest.fn(),
      selectCurrent: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      add: jest.fn(),
      remove: jest.fn(),
    });
  }

  // Routine and Deload are mutually exclusive: only the active one is mounted.
  const hasText = (component, needle) =>
    component.root.findAll(
      n => n.type === 'Text'
        && String(Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children ?? '')
          .includes(needle)
    ).length > 0;
  // Rendered only by LogDeloadSection (with no generated deload week).
  const onDeloadView = (component) => hasText(component, 'No deload week generated yet.');
  // Rendered only by LogPreviousRoutines, which lives in the routine view.
  const onRoutineView = (component) => hasText(component, 'More Routines');

  // Switch the screen to the Deload view the way a user does, so tabView holds
  // 'deload' when the navigation intent arrives.
  function showDeloadView(component) {
    const toggle = pressableAround(component.root, t => t === 'Deload');
    render.act(() => { toggle.props.onPress(); });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockNotes();
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: [], toggle: jest.fn() });
    useEntries.useDeloadNote.mockReturnValue({ note: { raw_text: '' }, loading: false, save: jest.fn(), clear: jest.fn() });
    useEntries.useDeloadHistory.mockReturnValue({
      history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
    });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: false });
    // `jest.clearAllMocks()` clears call history but NOT a previously
    // configured `mockReturnValue` — a prior describe block's active-block
    // fixture would otherwise leak in here. Explicit no-active-block default
    // (#823: the screen now lands on the Recovery tab whenever a block is
    // active, which these tests never intend to exercise).
    useEntries.useRecoveryBlockState.mockReturnValue({
      activeBlock: null, blocks: [], weeks: [], recoveryWeekNumberByNoteId: {},
      refresh: jest.fn(), pendingRecovery: [], recoveryPendingError: null,
      ready: true, loading: false, refreshing: false, stale: false, error: null,
      mutationsAllowed: true, retryRecovery: jest.fn(),
    });
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  // Screen-level signal that a note is actually being shown. A viewed
  // non-current ROUTINE renders its lifecycle actions (`Set as current routine`)
  // in the expanded routine-management body, while a viewed past-DELOAD note
  // renders `Edit deload record` in LogDeloadSection (the `Double-tap to edit`
  // hint is retired in both). Either proves the resolved note is mounted.
  const isShowingViewedNote = (component) =>
    hasText(component, 'Set as current routine') || hasText(component, 'Edit deload record');

  function mount(props) {
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen {...props} />); });
    return component;
  }

  test('an absent target opens nothing and leaves the screen untouched', () => {
    const component = mount({ navNoteId: null, navNoteKey: 0 });
    expect(isShowingViewedNote(component)).toBe(false);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test('a note target shows the requested non-current note', () => {
    const component = mount({ navNoteId: 'r1', navNoteKey: 1 });
    expect(isShowingViewedNote(component)).toBe(true);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test('a target for the current routine is a no-op: it is already the active card', () => {
    // The previous-routines viewer only ever lists NON-current notes, so opening
    // the current note there would be wrong; it is already on screen above.
    const component = mount({ navNoteId: 'note1', navNoteKey: 1 });
    expect(isShowingViewedNote(component)).toBe(false);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test('a missing target is refused out loud and opens nothing else', () => {
    const component = mount({ navNoteId: 'deleted-note', navNoteKey: 1 });

    expect(isShowingViewedNote(component)).toBe(false);
    expect(alertSpy).toHaveBeenCalledWith(
      'Note not found',
      expect.stringContaining('deleted')
    );
  });

  test('a note target that arrives while notes are loading is applied once loading resolves', () => {
    mockNotes({ notes: [], loading: true });
    const component = mount({ navNoteId: 'r1', navNoteKey: 1 });
    expect(isShowingViewedNote(component)).toBe(false);
    // Deferred, not refused: the note is not "missing", it is not loaded yet.
    expect(alertSpy).not.toHaveBeenCalled();

    mockNotes({ notes: [CURRENT, OTHER], loading: false });
    render.act(() => { component.update(<ControlledLogScreen navNoteId="r1" navNoteKey={1} />); });

    expect(isShowingViewedNote(component)).toBe(true);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test('a repeated render under the same key does not re-apply a consumed intent', () => {
    const component = mount({ navNoteId: 'r1', navNoteKey: 1 });
    expect(isShowingViewedNote(component)).toBe(true);

    // The user collapses the note themselves, then an unrelated re-render
    // arrives carrying the same already-consumed key.
    const header = pressableAround(component.root, t => t.includes('Routine B'));
    render.act(() => { header.props.onPress(); });
    expect(isShowingViewedNote(component)).toBe(false);

    render.act(() => { component.update(<ControlledLogScreen navNoteId="r1" navNoteKey={1} />); });

    expect(isShowingViewedNote(component)).toBe(false);
  });

  test('a later key for the same note re-applies the intent', () => {
    const component = mount({ navNoteId: 'r1', navNoteKey: 1 });
    const header = pressableAround(component.root, t => t.includes('Routine B'));
    render.act(() => { header.props.onPress(); });
    expect(isShowingViewedNote(component)).toBe(false);

    render.act(() => { component.update(<ControlledLogScreen navNoteId="r1" navNoteKey={2} />); });

    expect(isShowingViewedNote(component)).toBe(true);
  });

  // #1021: LogPreviousRoutines no longer has a collection-level disclosure to
  // reopen — non-current cards are always listed — so a later key for the
  // same already-selected note has nothing to "re-expand". It still keeps
  // that note visible.
  test('a later key for the same note keeps that note visible', () => {
    const component = mount({ navNoteId: 'r1', navNoteKey: 1 });
    expect(isShowingViewedNote(component)).toBe(true);

    render.act(() => { component.update(<ControlledLogScreen navNoteId="r1" navNoteKey={2} />); });
    expect(isShowingViewedNote(component)).toBe(true);
  });

  test('a note target is refused while an editor is open, and leaves the editor alone', () => {
    const component = mount({ navNoteId: null, navNoteKey: 0 });
    // #1021: Edit lives behind the current-routine card's three-dot menu.
    openCurrentRoutineMenu(component.root);
    render.act(() => {
      findPressableByText(component.root, 'Edit').props.onPress({ stopPropagation: jest.fn() });
    });
    // The read view's current-routine card (and its menu) unmounts in edit mode.
    expect(findPressableByText(component.root, 'Edit')).toBeNull();

    render.act(() => { component.update(<ControlledLogScreen navNoteId="r1" navNoteKey={1} />); });

    expect(alertSpy).toHaveBeenCalledWith(
      'Finish your edit first',
      // §12: the copy names the editor's real "Done" control.
      expect.stringContaining('Tap Done')
    );
    expect(isShowingViewedNote(component)).toBe(false);
    // Still in the current-routine editor: the intent touched no editor state.
    expect(findPressableByText(component.root, 'Edit')).toBeNull();
  });

  test('a refusal is terminal for its key and is not replayed once the editor closes', () => {
    const component = mount({ navNoteId: null, navNoteKey: 0 });
    // #1021: Edit lives behind the current-routine card's three-dot menu.
    openCurrentRoutineMenu(component.root);
    render.act(() => {
      findPressableByText(component.root, 'Edit').props.onPress({ stopPropagation: jest.fn() });
    });
    render.act(() => { component.update(<ControlledLogScreen navNoteId="r1" navNoteKey={1} />); });
    expect(alertSpy).toHaveBeenCalledTimes(1);

    // Leaving the editor must not silently perform the navigation the user was
    // already told did not happen.
    render.act(() => {
      findPressableByText(component.root, 'Done').props.onPress({ stopPropagation: jest.fn() });
    });

    expect(isShowingViewedNote(component)).toBe(false);
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });

  // ── the intent selects the view that owns the note (#718 review finding 1) ──
  //
  // Routine and Deload are mutually exclusive and render disjoint sets of notes
  // off the SAME viewingNoteId, so setting viewingNoteId without aligning
  // tabView would leave a correctly resolved note mounted nowhere.

  describe('view alignment with the note that owns the content', () => {
    function withDeloadMode() {
      useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: true });
      mockNotes({ notes: [CURRENT, OTHER, DELOAD], deloadNotes: [DELOAD] });
    }

    test('a routine-note target while the screen is on Deload switches to Routine and shows the note', () => {
      withDeloadMode();
      const component = mount({ navNoteId: null, navNoteKey: 0 });
      showDeloadView(component);
      expect(onDeloadView(component)).toBe(true);

      render.act(() => { component.update(<ControlledLogScreen navNoteId="r1" navNoteKey={1} />); });

      expect(onRoutineView(component)).toBe(true);
      expect(onDeloadView(component)).toBe(false);
      expect(isShowingViewedNote(component)).toBe(true);
    });

    test('a deload-note target while the screen is on Routine switches to Deload and shows the note', () => {
      withDeloadMode();
      const component = mount({ navNoteId: null, navNoteKey: 0 });
      expect(onRoutineView(component)).toBe(true);

      render.act(() => { component.update(<ControlledLogScreen navNoteId="d1" navNoteKey={1} />); });

      expect(onDeloadView(component)).toBe(true);
      expect(onRoutineView(component)).toBe(false);
      // Rendered by LogDeloadSection's past-deloads list, which is the only
      // place a 'Deload · ' note ever appears.
      expect(isShowingViewedNote(component)).toBe(true);
    });

    test('targeting the current routine while on Deload still switches back to Routine', () => {
      // The no-op-for-viewingNoteId path: the current routine is its own card,
      // not a viewer entry, but it is just as hidden behind the Deload view.
      withDeloadMode();
      const component = mount({ navNoteId: null, navNoteKey: 0 });
      showDeloadView(component);
      expect(onDeloadView(component)).toBe(true);

      render.act(() => { component.update(<ControlledLogScreen navNoteId="note1" navNoteKey={1} />); });

      expect(onRoutineView(component)).toBe(true);
      expect(onDeloadView(component)).toBe(false);
      // Still a no-op for the viewer itself: the current note is never opened
      // in the previous-routines list.
      expect(isShowingViewedNote(component)).toBe(false);
      expect(alertSpy).not.toHaveBeenCalled();
    });
  });

  // ── a failed read is not a deletion (#718 review finding 2) ──

  test('a failed notes read keeps the intent pending instead of reporting a deletion', () => {
    mockNotes({ notes: [], error: new Error('read failed') });
    const component = mount({ navNoteId: 'r1', navNoteKey: 1 });

    // The note is absent, but only because the read failed — absence is not
    // authoritative here, so nothing may be announced or consumed.
    expect(alertSpy).not.toHaveBeenCalled();
    expect(isShowingViewedNote(component)).toBe(false);

    // The existing ErrorBanner Retry lands a clean read. The SAME key must now
    // resolve, without the caller reissuing a new one.
    mockNotes({ notes: [CURRENT, OTHER] });
    render.act(() => { component.update(<ControlledLogScreen navNoteId="r1" navNoteKey={1} />); });

    expect(isShowingViewedNote(component)).toBe(true);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test('a genuinely deleted note is still reported once the read succeeds', () => {
    // The counterpart to the test above: the "not found" refusal must survive,
    // it simply may not fire off a failed read.
    const component = mount({ navNoteId: 'deleted-note', navNoteKey: 1 });

    expect(alertSpy).toHaveBeenCalledWith(
      'Note not found',
      expect.stringContaining('deleted')
    );
    expect(isShowingViewedNote(component)).toBe(false);
  });
});

// #869/#874 review: the plain `note` intent above always forces Routine/
// Deload and opens the previous-routines viewer, which is the WRONG surface
// for a recovery-linked note — it belongs to `recoveryViewer`, under the
// Recovery tab. This is the `recovery-note` intent's own contract.
describe('typed recovery-view navigation intents (#869/#874)', () => {
  const CURRENT = {
    id: 'note1',
    title: 'Routine A',
    raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5',
    saved_at: '2026-06-01T12:00:00.000Z',
  };
  const RECOVERY_NOTE = {
    id: 'rn1',
    title: 'Recovery week 1',
    raw_text: 'Monday\n+Lifting\n-Bench\n95 5,5,5',
    saved_at: '2026-06-08T12:00:00.000Z',
  };

  let alertSpy;

  function mockNotes({ notes = [CURRENT, RECOVERY_NOTE], loading = false, error = null } = {}) {
    useEntries.useWorkoutNotes.mockReturnValue({
      notes,
      currentId: 'note1',
      currentNote: CURRENT,
      deloadNotes: [],
      loading,
      error,
      refresh: jest.fn(),
      selectCurrent: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      add: jest.fn(),
      remove: jest.fn(),
    });
  }

  const hasText = (component, needle) => component.root.findAll(
    n => n.type === 'Text'
      && String(Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children ?? '').includes(needle)
  ).length > 0;
  // The Recovery view's own state headline (LogRecoverySection) — proof the
  // screen actually landed there, not just that SOME view rendered.
  const onRecoveryView = (component) => hasText(component, 'Week 1 in progress');
  const onRoutineView = (component) => hasText(component, 'More Routines');

  function mount(props) {
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen {...props} />); });
    return component;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockNotes();
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: [], toggle: jest.fn() });
    useEntries.useDeloadNote.mockReturnValue({ note: { raw_text: '' }, loading: false, save: jest.fn(), clear: jest.fn() });
    useEntries.useDeloadHistory.mockReturnValue({
      history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
    });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: false });
    useEntries.useRecoveryBlockState.mockReturnValue({
      activeBlock: { id: 'rb1', baseline_note_id: 'note1', include_in_normal_analytics: false, completed_at: null, deleted_at: null },
      blocks: [{ id: 'rb1', baseline_note_id: 'note1', include_in_normal_analytics: false, completed_at: null, deleted_at: null }],
      weeks: [{ id: 'rw1', block_id: 'rb1', note_id: 'rn1', week_number: 1, completed_at: null, deleted_at: null }],
      recoveryWeekNumberByNoteId: { rn1: 1 },
      refresh: jest.fn(),
      pendingRecovery: [],
      recoveryPendingError: null,
      ready: true,
      loading: false,
      refreshing: false,
      stale: false,
      error: null,
      mutationsAllowed: true,
      retryRecovery: jest.fn(),
    });
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  test('a bare recovery-view target lands on Recovery, not the Routine/Deload viewer', () => {
    const component = mount({ navRecoveryNoteId: null, navRecoveryKey: 1 });
    expect(onRecoveryView(component)).toBe(true);
    expect(onRoutineView(component)).toBe(false);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test('a resolvable recovery-note id lands on Recovery with that note focused, never the Routine viewer', () => {
    const component = mount({ navRecoveryNoteId: 'rn1', navRecoveryKey: 1 });
    expect(onRecoveryView(component)).toBe(true);
    // The recovery-linked note's own inline body, not the previous-routines
    // "Double-tap to edit" hint the plain `note` intent would have opened.
    expect(hasText(component, 'Recovery week 1')).toBe(true);
    expect(onRoutineView(component)).toBe(false);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test('an unresolvable recovery-note id still lands on Recovery, silently — no "Note not found" alert', () => {
    const component = mount({ navRecoveryNoteId: 'gone', navRecoveryKey: 1 });
    expect(onRecoveryView(component)).toBe(true);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test('repeating the same recovery-view request re-applies under a later key', () => {
    const component = mount({ navRecoveryNoteId: null, navRecoveryKey: 1 });
    expect(onRecoveryView(component)).toBe(true);

    // Manually leave Recovery, the way a user would.
    const routineToggle = pressableAround(component.root, t => t === 'Routine');
    render.act(() => { routineToggle.props.onPress(); });
    expect(onRoutineView(component)).toBe(true);

    render.act(() => { component.update(<ControlledLogScreen navRecoveryNoteId={null} navRecoveryKey={2} />); });
    expect(onRecoveryView(component)).toBe(true);
  });

  test('a recovery-view request while mid-edit is refused out loud, like the note intent', () => {
    const component = mount({ navRecoveryNoteId: null, navRecoveryKey: 0 });

    // The screen defaults onto Recovery on first resolution; switch to
    // Routine and open its editor, the way a user would before this request
    // arrives.
    const routineToggle = pressableAround(component.root, t => t === 'Routine');
    render.act(() => { routineToggle.props.onPress(); });
    // #1021: Edit lives behind the current-routine card's three-dot menu.
    openCurrentRoutineMenu(component.root);
    render.act(() => {
      findPressableByText(component.root, 'Edit').props.onPress({ stopPropagation: jest.fn() });
    });

    render.act(() => { component.update(<ControlledLogScreen navRecoveryNoteId={null} navRecoveryKey={1} />); });
    expect(alertSpy).toHaveBeenCalledWith(
      'Finish your edit first',
      expect.stringContaining('Tap Done')
    );
    expect(onRecoveryView(component)).toBe(false);
  });
});

// ── #886: where a source jump lands the current-routine editor ─────────────
//
// The regression: entering the editor from a double-tapped exercise reused
// the READ view's scroll offset (#150's Edit-button behavior). The rendered
// note and the raw text are different layouts, so that offset is wrong by a
// margin that grows the further down the note the tapped exercise sits — and
// because the editor scroll view is only hidden between sessions, never
// unmounted, a second jump inherited wherever the previous one ended up.

describe('current-routine source jump landing (#886)', () => {
  const { useLogCurrentRoutineEditor } = require('../screens/log/useLogCurrentRoutineEditor');
  const { buildExerciseSourceAnchor } = require('../lib/parser');

  const LONG_NOTE = (() => {
    const lines = ['Monday'];
    for (let i = 0; i < 30; i += 1) {
      lines.push(`-Exercise ${i}`);
      lines.push('135 5,5,5');
    }
    return lines.join('\n');
  })();

  // #888: how far below the top edge a landed exercise header is parked.
  // Stated here rather than imported, so a change to the product constant has
  // to be a deliberate change to what these tests assert. Roughly one raw row
  // — enough not to sit flush against the edge, and no more; 96 put the
  // header a whole exercise block down the screen.
  const TOP_GAP = 24;

  const mounted = [];
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => {
    render.act(() => { mounted.forEach(component => component.unmount()); });
    mounted.length = 0;
    jest.useRealTimers();
  });

  // The hook opens the editor and then positions it on the next frame.
  const flushFrames = () => { render.act(() => { jest.runOnlyPendingTimers(); }); };

  function mountEditor({ raw = LONG_NOTE } = {}) {
    const note = { id: 'current', title: 'Routine', raw_text: raw, activeWeek: null };
    const editorScrollTo = jest.fn();
    const readScrollTo = jest.fn();
    let latest = null;
    function Harness() {
      const [text, setText] = React.useState(raw);
      const [title, setTitle] = React.useState(note.title);
      latest = useLogCurrentRoutineEditor({
        workoutNoteText: text,
        setWorkoutNoteText: setText,
        workoutNoteTitle: title,
        setWorkoutNoteTitle: setTitle,
        currentId: note.id,
        currentNote: note,
        notes: [note],
        trackedLifts: [],
        update: jest.fn(async (id, patch) => ({ ...note, id, ...patch })),
        add: jest.fn(),
        selectCurrent: jest.fn(),
        fatigueTrackingEnabled: false,
        notesLoading: false,
        notesError: null,
        otherModalOwnsScreen: false,
        editorScrollRef: { current: { scrollTo: editorScrollTo } },
        readScrollRef: { current: { scrollTo: readScrollTo } },
      });
      return null;
    }
    render.act(() => { mounted.push(render.create(<Harness />)); });
    return { getHook: () => latest, editorScrollTo, readScrollTo };
  }

  // Builds the anchor the rendered note would hand back for one exercise, so
  // these drive the same entry point a double-tap does.
  function anchorFor(raw, exerciseName) {
    const parsed = parseWorkoutNote(raw);
    for (let s = 0; s < parsed.sections.length; s += 1) {
      const ordinal = parsed.sections[s].exercises.findIndex(e => e.name === exerciseName);
      if (ordinal >= 0) {
        return buildExerciseSourceAnchor({
          noteId: 'current',
          weekIndex: 0,
          sliceText: raw,
          sectionIndex: s,
          exerciseOrdinal: ordinal,
          exercise: parsed.sections[s].exercises[ordinal],
        });
      }
    }
    throw new Error(`no exercise ${exerciseName}`);
  }

  const scrollToRead = (getHook, y) => {
    render.act(() => { getHook().handleReadScroll({ nativeEvent: { contentOffset: { y } } }); });
  };

  test('the ordinary Edit button still restores the read view offset it always has', () => {
    const { getHook, editorScrollTo } = mountEditor();
    scrollToRead(getHook, 1840);
    render.act(() => { getHook().enterCurrentEditor(); });
    flushFrames();
    expect(getHook().mode).toBe('edit');
    expect(editorScrollTo).toHaveBeenCalledWith({ y: 1840, animated: false });
  });

  test('a source jump never carries the read view offset into the raw-text editor', () => {
    const { getHook, editorScrollTo } = mountEditor();
    // The user scrolled a long way down the RENDERED note to reach the
    // exercise they double-tapped — the offset that used to be reused.
    scrollToRead(getHook, 1840);
    render.act(() => { getHook().handleExerciseSourceJump(anchorFor(LONG_NOTE, 'Exercise 25')); });
    flushFrames();

    expect(getHook().mode).toBe('edit');
    expect(getHook().pendingSourceJump).toMatchObject({ currentMode: 'edit' });
    expect(editorScrollTo).not.toHaveBeenCalledWith({ y: 1840, animated: false });
    // Deterministic baseline until the editor reports where the line is.
    expect(editorScrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
  });

  test('the editor is scrolled to the measured target line once the surface reports it', () => {
    const { getHook, editorScrollTo } = mountEditor();
    scrollToRead(getHook, 1840);
    render.act(() => { getHook().handleExerciseSourceJump(anchorFor(LONG_NOTE, 'Exercise 25')); });
    flushFrames();
    editorScrollTo.mockClear();

    render.act(() => { getHook().clearPendingSourceJump({ y: 1600 }); });
    // Parked just below the top edge, so the header reads as placed rather
    // than clipped against it — and not a whole block further down (#888).
    expect(editorScrollTo).toHaveBeenCalledWith({ y: 1600 - TOP_GAP, animated: false });
    expect(getHook().pendingSourceJump).toBeNull();
  });

  test('a target near the top of the note is clamped, never scrolled to a negative offset', () => {
    const { getHook, editorScrollTo } = mountEditor();
    render.act(() => { getHook().handleExerciseSourceJump(anchorFor(LONG_NOTE, 'Exercise 0')); });
    flushFrames();
    editorScrollTo.mockClear();

    render.act(() => { getHook().clearPendingSourceJump({ y: TOP_GAP / 2 }); });
    expect(editorScrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
  });

  test('an unmeasurable landing keeps the top-of-note baseline instead of guessing', () => {
    const { getHook, editorScrollTo } = mountEditor();
    scrollToRead(getHook, 1840);
    render.act(() => { getHook().handleExerciseSourceJump(anchorFor(LONG_NOTE, 'Exercise 25')); });
    flushFrames();
    editorScrollTo.mockClear();

    render.act(() => { getHook().clearPendingSourceJump(); });
    expect(editorScrollTo).not.toHaveBeenCalled();
    expect(getHook().pendingSourceJump).toBeNull();
  });

  test('after leaving the editor, a repeat jump to the SAME exercise lands again', async () => {
    const { getHook, editorScrollTo } = mountEditor();
    scrollToRead(getHook, 1840);
    render.act(() => { getHook().handleExerciseSourceJump(anchorFor(LONG_NOTE, 'Exercise 25')); });
    flushFrames();
    render.act(() => { getHook().clearPendingSourceJump({ y: 1600 }); });
    await render.act(async () => { await getHook().handleDoneCurrent(); });
    expect(getHook().mode).toBe('read');
    editorScrollTo.mockClear();

    // The editor scroll view is still mounted at the first jump's offset.
    scrollToRead(getHook, 640);
    render.act(() => { getHook().handleExerciseSourceJump(anchorFor(LONG_NOTE, 'Exercise 25')); });
    flushFrames();
    expect(editorScrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
    expect(editorScrollTo).not.toHaveBeenCalledWith({ y: 640, animated: false });

    render.act(() => { getHook().clearPendingSourceJump({ y: 1600 }); });
    expect(editorScrollTo).toHaveBeenLastCalledWith({ y: 1600 - TOP_GAP, animated: false });
  });

  test('after leaving the editor, a jump to a DIFFERENT exercise lands on that one', async () => {
    const { getHook, editorScrollTo } = mountEditor();
    render.act(() => { getHook().handleExerciseSourceJump(anchorFor(LONG_NOTE, 'Exercise 25')); });
    flushFrames();
    render.act(() => { getHook().clearPendingSourceJump({ y: 1600 }); });
    await render.act(async () => { await getHook().handleDoneCurrent(); });

    const second = anchorFor(LONG_NOTE, 'Exercise 5');
    render.act(() => { getHook().handleExerciseSourceJump(second); });
    flushFrames();
    // Its own resolved target, not the previous jump's.
    expect(getHook().pendingSourceJump.start).toBe(
      LONG_NOTE.indexOf('-Exercise 5') + '-Exercise 5'.length
    );
    editorScrollTo.mockClear();
    render.act(() => { getHook().clearPendingSourceJump({ y: 360 }); });
    expect(editorScrollTo).toHaveBeenCalledWith({ y: 360 - TOP_GAP, animated: false });
  });

  test('a jump taken while already editing does not re-park the editor at the top', () => {
    const { getHook, editorScrollTo } = mountEditor();
    scrollToRead(getHook, 1840);
    render.act(() => { getHook().enterCurrentEditor(); });
    flushFrames();
    editorScrollTo.mockClear();

    render.act(() => { getHook().handleExerciseSourceJump(anchorFor(LONG_NOTE, 'Exercise 12')); });
    flushFrames();
    expect(editorScrollTo).not.toHaveBeenCalled();

    render.act(() => { getHook().clearPendingSourceJump({ y: 900 }); });
    expect(editorScrollTo).toHaveBeenCalledWith({ y: 900 - TOP_GAP, animated: false });
  });
});

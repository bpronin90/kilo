import { installRendererCleanup } from './helpers/log-screen';
import render from 'react-test-renderer';
import { findPressableByText, expandRoutineManagement, ControlledPreviousRoutines } from './helpers/log-screen';

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

// #756: New Note and set-current-routine stop being gated behind expansion.
// The header's `+ New routine` action gains a compact header-level twin that
// is present whether the disclosure is collapsed or expanded, and every
// collapsed (unopened) non-current row gains its own compact `Set as current
// routine` action, so switching never requires opening a row and scrolling to
// its expand-on-tap body. Existing safeguards are untouched: both quick
// actions call straight through to the same handlers (`handleCreateRoutine`,
// `handleSwitchCurrent`) that already own confirmation/eligibility.
describe('LogPreviousRoutines: compact New Note and set-current actions (#756)', () => {

  const notes = [
    { id: 'r1', title: 'Routine One', updated_at: '2026-01-01T00:00:00.000Z' },
    { id: 'r2', title: 'Routine Two', updated_at: '2026-01-02T00:00:00.000Z' },
  ];

  const baseProps = {
    otherNotes: notes,
    handleViewOtherNote: jest.fn(),
    viewingNoteId: null,
    viewingNote: null,
    viewingNoteDayGroups: [],
    viewingHasABWeeks: false,
    viewingEffectiveWeek: null,
    handleToggleViewingWeek: jest.fn(),
    handleEditViewedNote: jest.fn(),
    handleDeleteRoutine: jest.fn(),
  };

  const renderList = (overrides = {}) => {
    const props = { ...baseProps, handleSwitchCurrent: jest.fn(), handleCreateRoutine: jest.fn(), ...overrides };
    let component;
    render.act(() => { component = render.create(<ControlledPreviousRoutines {...props} />); });
    return { root: component.root, props };
  };

  test('the header New Note affordance calls handleCreateRoutine and does not disturb the always-listed routines', () => {
    const { root, props } = renderList();
    const headerButton = root.findAll(
      n => n.props && n.props.accessibilityLabel === 'New routine' && typeof n.props.onPress === 'function'
    )[0];
    expect(headerButton).toBeTruthy();

    render.act(() => { headerButton.props.onPress({ stopPropagation: jest.fn() }); });
    expect(props.handleCreateRoutine).toHaveBeenCalledTimes(1);
    // #1021: no disclosure left to disturb — both routines are still listed.
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Routine One').length).toBe(1);
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Routine Two').length).toBe(1);
  });

  // The icon-only per-row quick action is gone (#843): `Set as current
  // routine` is reachable only from a row's own expanded body now, alongside
  // Edit routine and Delete routine.
  test('a collapsed row exposes no icon-only set-current action', () => {
    const { root } = renderList();
    expandRoutineManagement(root);

    expect(root.findAll(
      n => n.props && typeof n.props.accessibilityLabel === 'string'
        && n.props.accessibilityLabel.startsWith('Set as current routine:')
    ).length).toBe(0);
  });

  test('opening a row reveals `Set as current routine` in its expanded body', () => {
    const note = notes[0];
    const { root, props } = renderList({ viewingNoteId: note.id, viewingNote: note });
    expandRoutineManagement(root);

    const setCurrent = pressableAround(root, t => t === 'Set as current routine');
    expect(setCurrent).toBeTruthy();
    render.act(() => { setCurrent.props.onPress(); });
    expect(props.handleSwitchCurrent).toHaveBeenCalledWith('r1');
  });

  // PR #760 review: a nested Pressable is grouped into its accessible ancestor
  // by VoiceOver, making it unreachable as its own action. `New routine` must
  // be a sibling of the toggle it sits beside, not a child of it.
  test('the New routine control is not nested inside another accessible Pressable', () => {
    const { root } = renderList();
    expandRoutineManagement(root);

    const isOwnAncestorButton = (node, ownLabel) => {
      let ancestor = node.parent;
      while (ancestor) {
        if (
          ancestor.props
          && ancestor.props.accessibilityRole === 'button'
          && typeof ancestor.props.onPress === 'function'
          && ancestor.props.accessibilityLabel !== ownLabel
        ) {
          return true;
        }
        ancestor = ancestor.parent;
      }
      return false;
    };

    const headerButton = root.findAll(
      n => n.props && n.props.accessibilityLabel === 'New routine' && typeof n.props.onPress === 'function'
    )[0];
    expect(isOwnAncestorButton(headerButton, 'New routine')).toBe(false);
  });
});

// Regression #5: the extracted viewed-note body handler was stubbed to a no-op,
// killing double-tap-to-edit on saved routines. This pins the restored 300ms
// double-tap that opens the routine in the editor.
describe('LogPreviousRoutines: double-tap viewed routine opens editor', () => {

  test('two quick taps on the viewed body call handleEditViewedNote; one tap does not', () => {
    const handleEditViewedNote = jest.fn();
    let component;
    render.act(() => {
      component = render.create(
        <ControlledPreviousRoutines
          otherNotes={[{ id: 'r1', title: 'Routine 1', raw_text: 'x' }]}
          handleViewOtherNote={jest.fn()}
          viewingNoteId="r1"
          viewingNote={{ id: 'r1', title: 'Routine 1', raw_text: 'x' }}
          viewingNoteDayGroups={[]}
          handleSwitchCurrent={jest.fn()}
          handleEditViewedNote={handleEditViewedNote}
          handleDeleteRoutine={jest.fn()}
          handleCreateRoutine={jest.fn()}
        />
      );
    });
    const root = component.root;
    expandRoutineManagement(root);
    // The visible "Double-tap to edit" hint is gone (#724); the body Pressable
    // is now located by its empty-content text, and the gesture still works.
    const body = pressableAround(root, t => t.includes('No exercises to display'));
    expect(body).toBeTruthy();

    render.act(() => { body.props.onPress(); });
    expect(handleEditViewedNote).not.toHaveBeenCalled(); // single tap is a no-op

    render.act(() => { body.props.onPress(); }); // second tap within 300ms
    expect(handleEditViewedNote).toHaveBeenCalledTimes(1);
  });
});

// #724 Contain and Connect: routine management is a collapsed-by-default
// disclosure (count + latest summary + chevron), and the single Start recovery
// block entry point lives inside its expanded body. Jest's renderer cannot
// measure Yoga layout, so these pin the render/props contract; the multi-width
// and light/dark visual checks in the acceptance criteria require manual review.
describe('LogPreviousRoutines: collapsed routine management (#724)', () => {

  const baseProps = {
    handleViewOtherNote: jest.fn(),
    viewingNoteId: null,
    viewingNote: null,
    viewingNoteDayGroups: [],
    viewingHasABWeeks: false,
    viewingEffectiveWeek: null,
    handleToggleViewingWeek: jest.fn(),
    handleSwitchCurrent: jest.fn(),
    handleEditViewedNote: jest.fn(),
    handleDeleteRoutine: jest.fn(),
    handleCreateRoutine: jest.fn(),
  };

  const renderList = (overrides = {}) => {
    let component;
    render.act(() => { component = render.create(<ControlledPreviousRoutines {...baseProps} {...overrides} />); });
    return component.root;
  };

  // The count is `More Routines · {count}` (#843) — the section title itself
  // — always visible outside the panel, expanded or collapsed.
  const countText = (root) =>
    root.findAll(n => n.type === 'Text' && typeof n.props.children === 'string' && /^More Routines · \d+$/.test(n.props.children))
      .map(n => n.props.children);

  const latestLineCount = (root) =>
    root.findAll(
      n => n.type === 'Text' && Array.isArray(n.props.children) && n.props.children[0] === 'Latest: '
    ).length;

  test('zero non-current routines: a plural-zero count, no latest line, and the New routine control always reachable (#836, #843)', () => {
    const root = renderList({ otherNotes: [] });
    expect(countText(root)).toEqual(['More Routines · 0']);
    expect(latestLineCount(root)).toBe(0);
    // The section's one create-routine affordance is present collapsed too
    // (#836) — it no longer requires expanding the disclosure first.
    expect(findPressableByText(root, 'New routine')).toBeTruthy();
  });

  test('one non-current routine: the count still reads "More Routines · 1" with no latest line (#836, #843)', () => {
    const root = renderList({ otherNotes: [{ id: 'r1', title: 'Only One', updated_at: '2026-01-01T00:00:00.000Z' }] });
    expect(countText(root)).toEqual(['More Routines · 1']);
    expect(latestLineCount(root)).toBe(0);
  });

  test('many routines: the count reflects the list regardless of order, with no latest line (#836, #843)', () => {
    const root = renderList({ otherNotes: [
      { id: 'r1', title: 'Older', saved_at: '2026-01-01T00:00:00.000Z' },
      { id: 'r2', title: 'Newest', saved_at: '2026-03-01T00:00:00.000Z' },
      { id: 'r3', title: 'Middle', saved_at: '2026-02-01T00:00:00.000Z' },
    ] });
    expect(countText(root)).toEqual(['More Routines · 3']);
    expect(latestLineCount(root)).toBe(0);
  });

  // #1021: no collection-level disclosure left — the routine and the New
  // routine control are simply always there, with the count staying accurate.
  test('a non-current routine and the New routine control are always listed, with an accurate count (#836, #843, #1021)', () => {
    const root = renderList({ otherNotes: [{ id: 'r1', title: 'One', updated_at: '2026-01-01T00:00:00.000Z' }] });
    expect(countText(root)).toEqual(['More Routines · 1']);
    expect(findPressableByText(root, 'New routine')).toBeTruthy();
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'One').length).toBe(1);
  });
});

// ── R2b: one date with one meaning, and disclosures that survive (#775) ───────

describe('More Routines: the row date is the routine\'s creation day (#775)', () => {
  const baseProps = {
    handleViewOtherNote: jest.fn(),
    viewingNoteId: null,
    viewingNote: null,
    viewingNoteDayGroups: [],
    viewingHasABWeeks: false,
    viewingEffectiveWeek: null,
    handleToggleViewingWeek: jest.fn(),
    handleSwitchCurrent: jest.fn(),
    handleEditViewedNote: jest.fn(),
    handleDeleteRoutine: jest.fn(),
    handleCreateRoutine: jest.fn(),
  };

  const renderList = (overrides = {}) => {
    let component;
    render.act(() => {
      component = render.create(<ControlledPreviousRoutines {...baseProps} {...overrides} />);
    });
    return component.root;
  };

  // The row header's own accessible name — never the disclosure's.
  const rowLabels = (root) => root.findAll(
    n => typeof n.type === 'string'
      && n.props
      && typeof n.props.accessibilityLabel === 'string'
      && /^(Expand|Collapse) /.test(n.props.accessibilityLabel)
      && !/routine management$/.test(n.props.accessibilityLabel)
  ).map(n => n.props.accessibilityLabel);

  const subLines = (root) => root.findAll(
    n => n.type === 'Text' && typeof n.props.children === 'string' && /^(Week [AB] · )?Created /.test(n.props.children)
  ).map(n => n.props.children);

  const expectedDate = (iso) => new Date(
    Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))
  ).toLocaleDateString();

  test('the date comes from saved_at, and an edit-stamped updated_at is never read', () => {
    // The exact regression: `updated_at` is the sync conflict cursor, so an
    // edit, a Week A/B tap, a sync, or a restored backup rewrites it. Only
    // saved_at answers "when did I make this routine?".
    const root = renderList({ otherNotes: [{
      id: 'wn_2025-11-02_1', title: 'Push', saved_at: '2026-01-05T00:00:00.000Z',
      updated_at: '2026-08-09T00:00:00.000Z',
    }] });
    expandRoutineManagement(root);

    expect(subLines(root)).toEqual([`Created ${expectedDate('2026-01-05')}`]);
    expect(rowLabels(root)).toEqual([`Expand Push, Created ${expectedDate('2026-01-05')}`]);
  });

  test('with no saved_at the creation day encoded in the note id stands in', () => {
    const root = renderList({ otherNotes: [{
      id: 'wn_2025-11-02_1762000000000', title: 'Legacy', updated_at: '2026-08-09T00:00:00.000Z',
    }] });
    expandRoutineManagement(root);

    expect(subLines(root)).toEqual([`Created ${expectedDate('2025-11-02')}`]);
    expect(rowLabels(root)).toEqual([`Expand Legacy, Created ${expectedDate('2025-11-02')}`]);
  });

  test('with neither, no date is shown or announced — the title still identifies the row', () => {
    const root = renderList({ otherNotes: [{
      id: 'imported-1', title: 'Imported', updated_at: '2026-08-09T00:00:00.000Z',
    }] });
    expandRoutineManagement(root);

    expect(subLines(root)).toEqual([]);
    expect(rowLabels(root)).toEqual(['Expand Imported']);
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Imported').length).toBeGreaterThan(0);
  });

  test('the viewed row keeps its Week A/B prefix in front of the creation date', () => {
    const note = { id: 'r1', title: 'AB', raw_text: 'MONDAY\n-Squat\n---\nMONDAY\n-Bench\n', saved_at: '2026-01-05T00:00:00.000Z' };
    const root = renderList({
      otherNotes: [note],
      viewingNoteId: 'r1',
      viewingNote: note,
      viewingHasABWeeks: true,
      viewingEffectiveWeek: 'B',
    });
    expandRoutineManagement(root);

    expect(subLines(root)).toEqual([`Week B · Created ${expectedDate('2026-01-05')}`]);
    expect(rowLabels(root)).toEqual([`Collapse AB, Week B · Created ${expectedDate('2026-01-05')}`]);
  });

  test('the expanded list orders newest created first, undated last in notebook order', () => {
    const otherNotes = [
      { id: 'a', title: 'Undated First', updated_at: '2026-08-09T00:00:00.000Z' },
      { id: 'b', title: 'Oldest', saved_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-08-10T00:00:00.000Z' },
      { id: 'wn_2026-05-05_1', title: 'Id Dated' },
      { id: 'c', title: 'Undated Second' },
      { id: 'd', title: 'Newest', saved_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z' },
    ];
    const root = renderList({ otherNotes });
    expandRoutineManagement(root);
    // #1329: past the newest three, the rest are one Show all away.
    render.act(() => { findPressableByText(root, 'Show all 5 routines').props.onPress(); });
    expect(rowLabels(root).map(l => l.replace(/^Expand /, '').split(',')[0])).toEqual([
      'Newest', 'Id Dated', 'Oldest', 'Undated First', 'Undated Second',
    ]);
  });
});

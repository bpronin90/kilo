import { installRendererCleanup } from './helpers/log-screen';
import render from 'react-test-renderer';
import { LightColors } from '../theme/colors';
import { finishSheetDismiss, openCurrentRoutineMenu, expandRoutineManagement, ControlledPreviousRoutines } from './helpers/log-screen';

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

// #1606: the collapse target holds only the title; it is found by its label.
function collapseHeader(root) {
  return root.findAll(n => n.props && typeof n.props.onPress === 'function'
    && /^(Collapse|Expand) /.test(n.props.accessibilityLabel || ''))[0] || null;
}

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

// Regression #6: on main the active-card HEADER toggled collapse while the BODY
// handled double-tap-to-edit. The refactor briefly wired both to the body handler
// (and collapsed on every single tap), so entering the editor left the card
// collapsed on return. These pin the two handlers to distinct callbacks.
describe('LogActiveRoutineCard: header collapses, body edits (separate handlers)', () => {
  const { LogActiveRoutineCard } = require('../components/LogActiveRoutineCard');

  const renderCard = (overrides = {}) => {
    const props = {
      workoutNoteTitle: 'My Routine',
      hasABWeeks: false,
      effectiveActiveWeek: 'A',
      handleToggleWeek: jest.fn(),
      enterCurrentEditor: jest.fn(),
      handleNoteBodyPress: jest.fn(),
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
    };
    let component;
    render.act(() => { component = render.create(<LogActiveRoutineCard {...props} />); });
    return { root: component.root, props };
  };

  test('tapping the header calls toggleCollapsed, not the body handler', () => {
    const { root, props } = renderCard();
    const header = collapseHeader(root);
    render.act(() => { header.props.onPress(); });
    expect(props.toggleCollapsed).toHaveBeenCalledTimes(1);
    expect(props.handleNoteBodyPress).not.toHaveBeenCalled();
  });

  // #711 removed the advertised "Double-tap to edit" hint in favour of an
  // explicit Edit control, but deliberately kept handleNoteBodyPress wired so
  // the gesture still works for users who know it. The body is located by its
  // own handler (Skip week, which used to sit in it, is a menu item now).
  test('tapping the body calls the body handler, not toggleCollapsed', () => {
    const { root, props } = renderCard({ handleSkipWeek: jest.fn() });
    const body = root.findAll(n => n.props && n.props.onPress === props.handleNoteBodyPress)[0];
    render.act(() => { body.props.onPress(); });
    expect(props.handleNoteBodyPress).toHaveBeenCalledTimes(1);
    expect(props.toggleCollapsed).not.toHaveBeenCalled();
  });

  // #1021: Edit lives inside the card's consolidated three-dot menu now.
  test('the Edit menu item behind the three-dot menu enters the editor', () => {
    const { root, props } = renderCard();
    const menuTrigger = root.findAll(n => n.props && n.props.accessibilityLabel === 'Routine actions')[0];
    render.act(() => { menuTrigger.props.onPress({ stopPropagation: jest.fn() }); });
    const editBtn = pressableAround(root, t => t === 'Edit');
    expect(editBtn.props.accessibilityRole).toBe('menuitem');
    expect(editBtn.props.accessibilityLabel).toBe('Edit routine');
    render.act(() => { editBtn.props.onPress({ stopPropagation: jest.fn() }); });
    expect(props.enterCurrentEditor).toHaveBeenCalledTimes(1);
    expect(props.toggleCollapsed).not.toHaveBeenCalled();
    expect(props.handleNoteBodyPress).not.toHaveBeenCalled();
  });
});

// #710 established the header containment contract: a `flex: 1` title column
// next to an action container that could not shrink, so the title absorbed the
// full width deficit and collapsed to zero width. #711 removes the cause rather
// than only containing it — the routine-card headers now hold identity only, so
// there is no sibling action row left to fight the title for width. These pin
// both halves of that: the headers render zero controls, the title still
// truncates rather than collapsing, and the containment props (`flexWrap`,
// `flexShrink`, a real 44dp touch target) followed the controls into the active
// card's action strip and the non-current card's expanded body — the two rows
// that now have to hold more than one control. Jest's renderer cannot measure
// actual Yoga layout or on-screen touch-target overlap, so this asserts the
// style/props contract that produces that layout; the acceptance criteria's
// multi-width visual checks require manual verification.
describe('Routine-card header/action containment (#710, #711)', () => {
  const { LogActiveRoutineCard } = require('../components/LogActiveRoutineCard');

  const LONG_TITLE = 'Return (ease the back) rehab';

  function findTitleText(root, title) {
    return root.find(n => n.type === 'Text' && n.props.children === title);
  }

  function flatStyle(node) {
    return Array.isArray(node.props.style) ? Object.assign({}, ...node.props.style) : node.props.style;
  }

  // Host nodes only: a Pressable renders a host View carrying the same style,
  // so an unfiltered walk counts every styled element twice.
  function findStyled(root, predicate) {
    return root.findAll(
      n => typeof n.type === 'string' && n.props && n.props.style && predicate(flatStyle(n))
    );
  }

  // The header Pressable is the collapse/expand target itself, so "no controls
  // in the header" means: no *nested* onPress anywhere beneath it.
  function nestedPressablesUnder(headerNode) {
    return headerNode.findAll(n => n !== headerNode && n.props && typeof n.props.onPress === 'function');
  }

  test('LogActiveRoutineCard: the header holds identity only; the action strip carries the controls', () => {
    let component;
    render.act(() => {
      component = render.create(
        <LogActiveRoutineCard
          workoutNoteTitle={LONG_TITLE}
          hasABWeeks={true}
          effectiveActiveWeek="A"
          handleToggleWeek={jest.fn()}
          enterCurrentEditor={jest.fn()}
          handleNoteBodyPress={jest.fn()}
          handleSkipWeek={jest.fn()}
          handleUnskipWeek={jest.fn()}
          canUnskipWeek={false}
          toggleCollapsed={jest.fn()}
          isCollapsed={false}
          dayGroups={[]}
          trackedLifts={{}}
          handleToggleTrack={jest.fn()}
          roughNoteId="n1"
          currentId="n1"
          roughFlaggedNames={new Set()}
          activeEditText=""
          recoveryWeekNumber={2}
        />
      );
    });
    const root = component.root;

    const title = findTitleText(root, LONG_TITLE);
    expect(title.props.numberOfLines).toBe(2);
    expect(title.props.ellipsizeMode).toBe('tail');

    // Identity only: title, subtitle, badge — and not one nested control.
    const header = collapseHeader(root);
    expect(nestedPressablesUnder(header).length).toBe(0);
    // #1244/#1606: the Routine actions trigger is the collapse target's sibling
    // (standalone mount), never nested in it; identity + badge sit beneath.
    expect(header.findAll(n => n.props && n.props.accessibilityLabel === 'Routine actions').length).toBe(0);
    expect(root.findAll(n => n.props && n.props.accessibilityLabel === 'Routine actions').length).toBeGreaterThan(0);
    expect(header.props.accessibilityLabel).toContain('Recovery Week 2');
    expect(root.findAll(n => n.type === 'Text' && String(n.props.children).includes('Current routine')).length)
      .toBeGreaterThan(0);

    const infoColumn = findStyled(root, s => s.flex === 1 && 'minWidth' in s);
    expect(infoColumn.length).toBeGreaterThan(0);
    expect(flatStyle(infoColumn[0]).minWidth).toBeGreaterThan(0);

    // The wrap/shrink containment now lives on the action strip.
    const wrapRows = findStyled(root, s => s.flexWrap === 'wrap');
    expect(wrapRows.length).toBeGreaterThan(0);

    // #1021: Edit, Share, Copy, and Share as Image consolidated into the
    // three-dot menu; both skip actions live there too, leaving Week A/B as the
    // only shrinkable 44dp pill in the strip.
    // #1606: Week A/B is a two-option radio group; each option keeps a 44dp target.
    const weekRadios = root.findAll(n => typeof n.type === 'string' && n.props.accessibilityRole === 'radio');
    expect(weekRadios.map(n => n.props.accessibilityLabel)).toEqual(['Week A', 'Week B']);
    for (const radio of weekRadios) {
      const style = flatStyle(radio);
      expect(style.minHeight).toBe(44);
      expect(style.justifyContent).toBe('center');
    }

    // The consolidated menu trigger is icon-only, 44dp, and not an oversized
    // visible pill — no visible text, no fill/border chrome to compete with
    // the Week A/B switch beside it.
    const menuTrigger = root.findAll(n => n.props && n.props.accessibilityLabel === 'Routine actions')[0];
    expect(menuTrigger).toBeTruthy();
    expect(flatStyle(menuTrigger).minHeight).toBe(44);
    expect(flatStyle(menuTrigger).minWidth).toBe(44);
    expect(menuTrigger.props.accessibilityState).toEqual({ expanded: false });

    // Edit, Copy, Share, and Share as Image only render once the menu opens —
    // Copy and Share stay distinct actions inside it, never merged.
    expect(root.findAll(n => n.props && n.props.accessibilityRole === 'menuitem').length).toBe(0);
    render.act(() => { menuTrigger.props.onPress({ stopPropagation: jest.fn() }); });
    // A Pressable's props (including accessibilityRole/Label) land on both the
    // component and the host node(s) it renders, so dedupe before comparing.
    const menuItemLabels = [...new Set(
      root
        .findAll(n => n.props && n.props.accessibilityRole === 'menuitem')
        .map(n => n.props.accessibilityLabel)
    )];
    expect(menuItemLabels).toEqual([
      'Edit routine',
      'Skip week',
      'Plate calculator',
      `Copy routine ${LONG_TITLE}`,
      'Share routine',
      'Share routine as image',
    ]);
  });

  // #1244: the open menu is a compact Modal sheet, so the card's own layout is
  // untouched (no content shift); items keep 44dp targets; Remove skip is a
  // menu item only when a skip exists; toggling and choosing both close it.
  test('the Routine actions menu is a compact sheet that toggles, closes, and gates Remove skip', () => {
    const { Modal } = require('react-native');
    const renderIt = (canUnskipWeek, handleUnskipWeek = jest.fn()) => {
      let component;
      render.act(() => {
        component = render.create(
          <LogActiveRoutineCard
            workoutNoteTitle={LONG_TITLE}
            hasABWeeks={true}
            effectiveActiveWeek="A"
            handleToggleWeek={jest.fn()}
            enterCurrentEditor={jest.fn()}
            handleNoteBodyPress={jest.fn()}
            handleSkipWeek={jest.fn()}
            handleUnskipWeek={handleUnskipWeek}
            canUnskipWeek={canUnskipWeek}
            toggleCollapsed={jest.fn()}
            isCollapsed={false}
            dayGroups={[]}
            trackedLifts={{}}
            handleToggleTrack={jest.fn()}
            roughNoteId="n1"
            currentId="n1"
            roughFlaggedNames={new Set()}
            activeEditText=""
            recoveryWeekNumber={2}
          />
        );
      });
      return component;
    };
    const component = renderIt(false);
    const root = component.root;
    const trigger = () => root.findAll(n => n.props && n.props.accessibilityLabel === 'Routine actions')[0];
    const menu = () => root.findAll(n => n.props && n.props.testID === 'log-current-routine-menu')[0];
    render.act(() => { trigger().props.onPress({ stopPropagation: jest.fn() }); });
    expect(trigger().props.accessibilityState).toEqual({ expanded: true });
    // The menu renders inside a Modal, never in the card's in-flow layout.
    expect(menu()).toBeTruthy();
    let p = menu().parent; while (p && p.type !== Modal) p = p.parent;
    expect(p).toBeTruthy();
    expect(p.props.visible).toBe(true);
    const items = root.findAll(n => n.props && n.props.accessibilityRole === 'menuitem' && n.props.onPress);
    expect(items.map(i => i.props.accessibilityLabel)).toEqual([
      'Edit routine', 'Skip week', 'Plate calculator', `Copy routine ${LONG_TITLE}`, 'Share routine', 'Share routine as image',
    ]);
    items.forEach(i => expect(flatStyle(i).minHeight).toBeGreaterThanOrEqual(44));
    render.act(() => { trigger().props.onPress({ stopPropagation: jest.fn() }); });
    expect(menu()).toBeUndefined();
    render.act(() => { trigger().props.onPress({ stopPropagation: jest.fn() }); });
    const edit = root.findAll(n => n.props && n.props.accessibilityLabel === 'Edit routine' && n.props.onPress)[0];
    render.act(() => { edit.props.onPress({ stopPropagation: jest.fn() }); });
    expect(menu()).toBeUndefined();
    expect(trigger().props.accessibilityState).toEqual({ expanded: false });

    const unskip = jest.fn();
    const skipped = renderIt(true, unskip).root;
    const t2 = skipped.findAll(n => n.props && n.props.accessibilityLabel === 'Routine actions')[0];
    render.act(() => { t2.props.onPress({ stopPropagation: jest.fn() }); });
    const remove = skipped.findAll(n => n.props && n.props.accessibilityRole === 'menuitem' && n.props.accessibilityLabel === 'Remove skip' && n.props.onPress)[0];
    expect(flatStyle(remove).minHeight).toBeGreaterThanOrEqual(44);
    render.act(() => { remove.props.onPress({ stopPropagation: jest.fn() }); });
    expect(unskip).toHaveBeenCalledTimes(1);
  });

  test('LogPreviousRoutines: the header holds identity only; the expanded body carries the controls', () => {
    const note = { id: 'r1', title: LONG_TITLE, raw_text: 'MONDAY\n-Squat 3x5\n---\nMONDAY\n-Deadlift 3x5\n', updated_at: '2026-01-01T00:00:00.000Z' };
    let component;
    render.act(() => {
      component = render.create(
        <ControlledPreviousRoutines
          otherNotes={[note]}
          handleViewOtherNote={jest.fn()}
          viewingNoteId="r1"
          viewingNote={note}
          viewingNoteDayGroups={[]}
          viewingHasABWeeks={true}
          viewingEffectiveWeek="A"
          handleToggleViewingWeek={jest.fn()}
          handleSwitchCurrent={jest.fn()}
          handleEditViewedNote={jest.fn()}
          handleDeleteRoutine={jest.fn()}
          handleCreateRoutine={jest.fn()}
          recoveryWeekNumberByNoteId={{ r1: 2 }}
        />
      );
    });
    const root = component.root;
    expandRoutineManagement(root);

    const title = findTitleText(root, LONG_TITLE);
    expect(title.props.numberOfLines).toBe(2);
    expect(title.props.ellipsizeMode).toBe('tail');

    const header = pressableAround(root, t => t.includes(LONG_TITLE));
    expect(nestedPressablesUnder(header).length).toBe(0);
    expect(header.findAll(n => n.type === 'Text' && String(n.props.children).includes('Recovery week')).length)
      .toBeGreaterThan(0);

    const infoColumn = findStyled(root, s => s.flex === 1 && 'minWidth' in s);
    expect(infoColumn.length).toBeGreaterThan(0);
    expect(flatStyle(infoColumn[0]).minWidth).toBeGreaterThan(0);

    // The one relocated pill (Week A/B) keeps its wrapping row and touch target.
    const wrapRows = findStyled(root, s => s.flexWrap === 'wrap');
    expect(wrapRows.length).toBeGreaterThan(0);

    // Scope to the pill's 44dp target: the disclosure header now also carries a
    // 44dp min height (#724 review), but only the pill also shrinks.
    const pills = findStyled(root, s => s.minHeight === 44 && s.flexShrink === 1);
    expect(pills.length).toBe(1);
    const pillStyle = flatStyle(pills[0]);
    expect(pillStyle.justifyContent).toBe('center');
    expect(pillStyle.flexShrink).toBe(1);
    expect(pressableAround(root, t => t === 'Week B').props.hitSlop)
      .toEqual({ top: 4, bottom: 4, left: 4, right: 4 });
  });

  test('Recovery and More Routines headings share the same section-title treatment (#771)', () => {
    const { LogRecoverySection } = require('../components/LogRecoverySection');
    let recoveryComponent;
    render.act(() => {
      recoveryComponent = render.create(
        <LogRecoverySection blocks={[]} weeks={[]} notes={[]} stateStale />
      );
    });
    const recoveryTitle = findTitleText(recoveryComponent.root, 'Recovery');
    expect(recoveryTitle).toBeTruthy();

    let routinesComponent;
    render.act(() => {
      routinesComponent = render.create(
        <ControlledPreviousRoutines
          otherNotes={[]}
          handleViewOtherNote={jest.fn()}
          viewingNoteId={null}
          viewingNote={null}
          viewingNoteDayGroups={[]}
          viewingHasABWeeks={false}
          viewingEffectiveWeek={null}
          handleToggleViewingWeek={jest.fn()}
          handleSwitchCurrent={jest.fn()}
          handleEditViewedNote={jest.fn()}
          handleDeleteRoutine={jest.fn()}
          handleCreateRoutine={jest.fn()}
        />
      );
    });
    const routinesTitle = findTitleText(routinesComponent.root, 'More Routines · 0');
    expect(routinesTitle).toBeTruthy();

    const recoveryStyle = flatStyle(recoveryTitle);
    const routinesStyle = flatStyle(routinesTitle);
    for (const prop of ['fontSize', 'fontWeight', 'color', 'textTransform', 'letterSpacing']) {
      expect(recoveryStyle[prop]).toBe(routinesStyle[prop]);
    }
  });

  // #1021: the collection-level disclosure this pinned is gone — every
  // non-current card is always listed, alongside the always-visible count
  // and `New routine` affordance.
  test('LogPreviousRoutines: the list renders its cards and a New Note affordance with no collection-level toggle (#756, #1021)', () => {
    const notes = [
      { id: 'r1', title: 'Routine One', raw_text: 'MONDAY\n-Squat 3x5\n', saved_at: '2026-01-01T00:00:00.000Z' },
      { id: 'r2', title: 'Routine Two', raw_text: 'MONDAY\n-Bench 3x5\n', saved_at: '2026-01-02T00:00:00.000Z' },
    ];
    const handleCreateRoutine = jest.fn();
    let component;
    render.act(() => {
      component = render.create(
        <ControlledPreviousRoutines
          otherNotes={notes}
          handleViewOtherNote={jest.fn()}
          viewingNoteId={null}
          viewingNote={null}
          viewingNoteDayGroups={[]}
          viewingHasABWeeks={false}
          viewingEffectiveWeek={null}
          handleToggleViewingWeek={jest.fn()}
          handleSwitchCurrent={jest.fn()}
          handleEditViewedNote={jest.fn()}
          handleDeleteRoutine={jest.fn()}
          handleCreateRoutine={handleCreateRoutine}
        />
      );
    });
    const root = component.root;

    // No collection-level disclosure toggle exists any more.
    expect(root.findAll(
      n => n.props && (n.props.accessibilityLabel === 'Show routines' || n.props.accessibilityLabel === 'Hide routines')
    ).length).toBe(0);

    const newRoutine = root.findAll(
      n => n.props && n.props.accessibilityLabel === 'New routine' && typeof n.props.onPress === 'function'
    )[0];
    expect(newRoutine).toBeTruthy();
    render.act(() => { newRoutine.props.onPress({ stopPropagation: jest.fn() }); });
    expect(handleCreateRoutine).toHaveBeenCalledTimes(1);

    // Both non-current cards are always listed, collapsed to their own
    // per-card body (no "Latest:" naming one routine over the others).
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Routine One').length).toBe(1);
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Routine Two').length).toBe(1);
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'More Routines · 2').length).toBe(1);
    expect(root.findAll(
      n => n.type === 'Text' && Array.isArray(n.props.children) && n.props.children[0] === 'Latest: '
    ).length).toBe(0);
  });
});

// -- More Routines: quiet individual note cards, no enclosing panel (#847) --
describe('LogPreviousRoutines: quiet note-card containment (#847)', () => {
  const notes = [
    { id: 'r1', title: 'Routine One', raw_text: 'MONDAY\n-Squat 3x5\n', saved_at: '2026-01-01T00:00:00.000Z' },
    { id: 'r2', title: 'Routine Two', raw_text: 'MONDAY\n-Bench 3x5\n', saved_at: '2026-01-02T00:00:00.000Z' },
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
    handleSwitchCurrent: jest.fn(),
    handleEditViewedNote: jest.fn(),
    handleDeleteRoutine: jest.fn(),
    handleCreateRoutine: jest.fn(),
  };
  const render_ = () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledPreviousRoutines {...baseProps} />
      );
    });
    return component.root;
  };
  const flat = (n) => Object.assign({}, ...(Array.isArray(n.props.style) ? n.props.style : [n.props.style]).filter(Boolean));

  // #1021: no collection-level disclosure any more — every non-current
  // routine is always listed, with no enclosing panel-style surface.
  test('every routine renders as its own bordered, rounded card — not one shared panel', () => {
    const root = render_();
    // Two separate rounded, bordered surfaces, one per routine — not a single
    // enclosing panel wrapping a flat divided list.
    const cards = root.findAll(n => typeof n.type === 'string' && n.props && n.props.style && flat(n).borderRadius === 16 && flat(n).overflow === 'hidden');
    expect(cards.length).toBe(2);
    for (const card of cards) {
      const style = flat(card);
      expect(style.backgroundColor).toBe(LightColors.card);
      expect(style.borderWidth).toBe(1);
      expect(style.borderColor).toBe(LightColors.cardBorder);
    }

    // No shared row-divider chrome (colors.divider) links the cards together.
    const dividedRows = root.findAll(n => typeof n.type === 'string' && n.props && n.props.style && flat(n).borderBottomColor === LightColors.divider);
    expect(dividedRows.length).toBe(0);

    // The cards are separated by ordinary shell spacing (a `gap` container),
    // not nested inside one tinted collection bar.
    expect(root.findAll(n => n.props && n.props.style && flat(n).backgroundColor === LightColors.subtleBg).length).toBe(0);
  });

  // #1021: the collection disclosure this pinned is gone outright — every
  // non-current card is always listed, with no toggle to test.
  test('the routines render with no collection-level toggle or panel header', () => {
    const root = render_();
    expect(root.findAll(
      n => n.props && (n.props.accessibilityLabel === 'Show routines' || n.props.accessibilityLabel === 'Hide routines')
    ).length).toBe(0);
  });
});

// #711: the two behavior changes, and the relocation contract for the
// non-current card. Everything else in this issue moves controls without
// changing what they do.
describe('Log action hierarchy (#711)', () => {
  const { LogActiveRoutineCard } = require('../components/LogActiveRoutineCard');

  const renderActiveCard = (overrides = {}) => {
    const props = {
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
    };
    let component;
    render.act(() => { component = render.create(<LogActiveRoutineCard {...props} />); });
    return { root: component.root, props };
  };

  const textNodes = (root, exact) =>
    root.findAll(n => n.type === 'Text' && n.props.children === exact);

  // Behavior change 1. Both controls used to render unconditionally, with
  // `canUnskipWeek` only dimming "Remove skip" to opacity 0.4 over already-muted
  // text — two contradictory-looking controls, and a disabled state carried by
  // opacity alone. The state now decides which single control exists.
  describe('mutually exclusive skip control', () => {
    // Both skip actions live together in the Routine actions menu, right after
    // Edit: Skip week always (skips stack), Remove skip only with a trailing skip.
    test.each([[true], [false]])('hasABWeeks=%s: no skip control in the strip; Skip week is a menu item', (hasABWeeks) => {
      const { root, props } = renderActiveCard({ canUnskipWeek: false, hasABWeeks });
      expect(textNodes(root, 'Skip week').length).toBe(0);
      openCurrentRoutineMenu(root);
      expect(textNodes(root, 'Skip week').length).toBe(1);
      expect(textNodes(root, 'Remove skip').length).toBe(0);
      const skipBtn = pressableAround(root, t => t === 'Skip week');
      expect(skipBtn.props.accessibilityRole).toBe('menuitem');
      render.act(() => { skipBtn.props.onPress({ stopPropagation: jest.fn() }); });
      expect(props.handleSkipWeek).toHaveBeenCalledTimes(1);
      expect(props.handleUnskipWeek).not.toHaveBeenCalled();
    });

    test('with a trailing skip present, the menu offers Skip week and Remove skip together', () => {
      const { root, props } = renderActiveCard({ canUnskipWeek: true });
      expect(textNodes(root, 'Remove skip').length).toBe(0);
      openCurrentRoutineMenu(root);
      expect(textNodes(root, 'Skip week').length).toBe(1);
      expect(textNodes(root, 'Remove skip').length).toBe(1);

      const unskipBtn = pressableAround(root, t => t === 'Remove skip');
      // No opacity-only disabled state left to carry: the control is either
      // present and live, or absent.
      const style = Array.isArray(unskipBtn.props.style)
        ? Object.assign({}, ...unskipBtn.props.style)
        : (unskipBtn.props.style || {});
      expect(style.opacity).toBeUndefined();
      expect(unskipBtn.props.disabled).toBeFalsy();
      render.act(() => { unskipBtn.props.onPress({ stopPropagation: jest.fn() }); });
      expect(props.handleUnskipWeek).toHaveBeenCalledTimes(1);
      expect(props.handleSkipWeek).not.toHaveBeenCalled();
    });

    test('from a collapsed card, Skip week opens the card so its result line is visible', () => {
      const collapsed = renderActiveCard({ isCollapsed: true });
      openCurrentRoutineMenu(collapsed.root);
      render.act(() => { pressableAround(collapsed.root, t => t === 'Skip week').props.onPress({ stopPropagation: jest.fn() }); });
      expect(collapsed.props.toggleCollapsed).toHaveBeenCalledTimes(1);
      expect(collapsed.props.handleSkipWeek).toHaveBeenCalledTimes(1);

      const open = renderActiveCard({ isCollapsed: false });
      openCurrentRoutineMenu(open.root);
      render.act(() => { pressableAround(open.root, t => t === 'Skip week').props.onPress({ stopPropagation: jest.fn() }); });
      expect(open.props.toggleCollapsed).not.toHaveBeenCalled();
      expect(open.props.handleSkipWeek).toHaveBeenCalledTimes(1);
    });

    test('a single-week routine renders no action strip at all', () => {
      const { StyleSheet } = require('react-native');
      const { root } = renderActiveCard({ hasABWeeks: false });
      const strips = root.findAll(n => typeof n.type === 'string' && n.props.style
        && StyleSheet.flatten(n.props.style).justifyContent === 'space-between'
        && StyleSheet.flatten(n.props.style).flexWrap === 'wrap');
      expect(strips).toHaveLength(0);
    });

    test('neither control renders when the screen supplies no skip handlers', () => {
      const { root } = renderActiveCard({ handleSkipWeek: undefined, handleUnskipWeek: undefined, canUnskipWeek: true });
      openCurrentRoutineMenu(root);
      expect(textNodes(root, 'Skip week').length).toBe(0);
      expect(textNodes(root, 'Remove skip').length).toBe(0);
    });
  });

  describe('active card action strip', () => {
    test('the Week A/B switch moved out of the header into the strip and still toggles', () => {
      const { root, props } = renderActiveCard({ hasABWeeks: true, effectiveActiveWeek: 'A' });
      const header = collapseHeader(root);
      expect(header.findAll(n => n !== header && n.props && typeof n.props.onPress === 'function').length).toBe(0);

      const weekBtn = pressableAround(root, t => t === 'Week B');
      expect(weekBtn.props.accessibilityLabel).toBe('Week B');
      expect(weekBtn.props.accessibilityRole).toBe('radio');
      expect(weekBtn.props.accessibilityState).toEqual({ checked: false, selected: false });
      render.act(() => { weekBtn.props.onPress({ stopPropagation: jest.fn() }); });
      expect(props.handleToggleWeek).toHaveBeenCalledTimes(1);
      // Re-selecting the already active week is a no-op.
      const weekA = pressableAround(root, t => t === 'Week A');
      render.act(() => { weekA.props.onPress({ stopPropagation: jest.fn() }); });
      expect(props.handleToggleWeek).toHaveBeenCalledTimes(1);
      expect(props.toggleCollapsed).not.toHaveBeenCalled();
    });

    test('a routine with no A/B weeks shows no week switch', () => {
      const { root } = renderActiveCard({ hasABWeeks: false });
      expect(pressableAround(root, t => t === 'Week B')).toBeNull();
      expect(pressableAround(root, t => t === 'Week A')).toBeNull();
    });

    test('the retired "Double-tap to edit" hint is gone but the gesture is still wired', () => {
      const { root, props } = renderActiveCard();
      expect(root.findAll(n => n.type === 'Text' && String(n.props.children).includes('Double-tap')).length).toBe(0);
      const body = root.findAll(n => n.props && n.props.onPress === props.handleNoteBodyPress)[0];
      render.act(() => { body.props.onPress(); });
      expect(props.handleNoteBodyPress).toHaveBeenCalledTimes(1);
    });

    test('the strip is hidden with the body when the card is collapsed', () => {
      const { root, props } = renderActiveCard({ isCollapsed: true, hasABWeeks: true });
      const body = root.findAll(n => n.props && n.props.onPress === props.handleNoteBodyPress)[0];
      const style = Array.isArray(body.props.style)
        ? Object.assign({}, ...body.props.style.filter(Boolean))
        : body.props.style;
      expect(style.display).toBe('none');
    });
  });

  describe('non-current card: secondary actions live in the expanded body', () => {
    const note = { id: 'r1', title: 'Routine 1', raw_text: 'MONDAY\n-Squat 3x5\n---\nMONDAY\n-Deadlift 3x5\n', updated_at: '2026-01-01T00:00:00.000Z' };

    const renderList = (overrides = {}) => {
      const props = {
        otherNotes: [note],
        handleViewOtherNote: jest.fn(),
        viewingNoteId: 'r1',
        viewingNote: note,
        viewingNoteDayGroups: [],
        viewingHasABWeeks: true,
        viewingEffectiveWeek: 'A',
        handleToggleViewingWeek: jest.fn(),
        handleSwitchCurrent: jest.fn(),
        handleEditViewedNote: jest.fn(),
        handleDeleteRoutine: jest.fn(),
        handleCreateRoutine: jest.fn(),
        ...overrides,
      };
      let component;
      render.act(() => { component = render.create(<ControlledPreviousRoutines {...props} />); });
      const root = component.root;
      // Routine management is collapsed by default (#724); open it so the card
      // and its expanded-body controls are mounted.
      expandRoutineManagement(root);
      return { root, props };
    };

    test('every relocated action is reachable once the card is expanded, and calls its own handler', () => {
      const { root, props } = renderList();

      const setCurrent = pressableAround(root, t => t === 'Set as current routine');
      expect(setCurrent).toBeTruthy();
      render.act(() => { setCurrent.props.onPress(); });
      expect(props.handleSwitchCurrent).toHaveBeenCalledWith('r1');

      const weekBtn = pressableAround(root, t => t === 'Week B');
      expect(weekBtn.props.accessibilityLabel).toBe('Switch to Week B');
      expect(weekBtn.props.accessibilityState).toEqual({ selected: false });
      render.act(() => { weekBtn.props.onPress(); });
      expect(props.handleToggleViewingWeek).toHaveBeenCalledTimes(1);

      render.act(() => { pressableAround(root, t => t === 'Edit routine').props.onPress(); });
      expect(props.handleEditViewedNote).toHaveBeenCalledTimes(1);

      // #1329: Delete routine lives in the expanded body's More actions sheet.
      expect(pressableAround(root, t => t === 'Delete routine')).toBeNull();
      const more = root.findAll(n => n.props && n.props.accessibilityLabel === 'More actions for Routine 1' && typeof n.props.onPress === 'function')[0];
      render.act(() => { more.props.onPress(); });
      render.act(() => { pressableAround(root, t => t === 'Delete routine').props.onPress(); });
      finishSheetDismiss(root);
      expect(props.handleDeleteRoutine).toHaveBeenCalledWith('r1', 'Routine 1', false);
    });

    test('a collapsed card exposes none of them', () => {
      const { root } = renderList({ viewingNoteId: null, viewingNote: null });
      for (const label of ['Set as current routine', 'Week B', 'Edit routine', 'Delete routine']) {
        expect(pressableAround(root, t => t === label)).toBeNull();
      }
    });

    test('an expanded routine with no A/B weeks shows no week switch among its actions', () => {
      const { root } = renderList({ viewingHasABWeeks: false, viewingEffectiveWeek: null });
      expect(pressableAround(root, t => t === 'Week B')).toBeNull();
      expect(pressableAround(root, t => t === 'Set as current routine')).toBeTruthy();
    });
  });
});

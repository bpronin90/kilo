import { installRendererCleanup } from './helpers/log-screen';
import render from 'react-test-renderer';
import { RECOVERY_INCLUSION_HELP } from '../components/RecoveryInclusionToggle';

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

// -- Calm active Recovery card (#789) ---------------------------------------
//
// R4b changes only hierarchy: which fact the card states first, how many
// lifecycle actions are visible at once, and which section owns each control.
// No handler, confirm copy, gate, or calculation moves. These tests drive
// LogRecoverySection directly so the assertions are about the card's own
// structure rather than about LogScreen's wiring.
describe('LogRecoverySection: calm active Recovery hierarchy (#789)', () => {
  const { LogRecoverySection } = require('../components/LogRecoverySection');
  const { RECOVERY_STALE_MESSAGE } = require('../hooks/entries/recoveryBlockHooks');

  const BLOCK = {
    id: 'rb789', baseline_note_id: 'baseline', baseline_note_title: 'Push/Pull/Legs',
    started_at: '2026-05-01T00:00:00.000Z', completed_at: null, deleted_at: null,
  };
  const WEEK_NOTE = {
    id: 'weeknote', title: 'Recovery Week Note',
    raw_text: 'Monday\n+Lifting\n-Overhead Press\n65 5,5,5',
  };
  const week = (overrides = {}) => ({
    id: 'rw3', block_id: 'rb789', note_id: 'weeknote', week_number: 3,
    completed_at: null, deleted_at: null, ...overrides,
  });

  const renderSection = (props = {}) => {
    let component;
    render.act(() => {
      component = render.create(
        <LogRecoverySection blocks={[BLOCK]} weeks={[week()]} notes={[WEEK_NOTE]} {...props} />
      );
    });
    return component.root;
  };

  const allText = (root) => root.findAll(n => n.type === 'Text').map(n => {
    const c = n.props.children;
    return Array.isArray(c) ? c.join('') : String(c ?? '');
  });
  const byLabel = (root, label) => root.findAll(n => n.props && n.props.accessibilityLabel === label)[0];
  const trigger = (root) => root.findAll(
    n => n.props && typeof n.props.accessibilityLabel === 'string'
      && n.props.accessibilityLabel.startsWith('Manage recovery block')
      && typeof n.props.onPress === 'function'
  )[0];
  // `Counting in normal analytics` IS the Log-surface inclusion control
  // (#843 review) — a tap on the row writes the field directly. There is no
  // separate `RecoveryInclusionToggle` Switch nested under it.
  const inclusionRow = (root) => root.findAll(
    n => n.props && n.props.accessibilityRole === 'switch' && typeof n.props.onPress === 'function'
  )[0];

  test('an open week leads with the state fact and offers exactly one lifecycle action', () => {
    const root = renderSection({ onCompleteWeek: jest.fn(), onOpenAddWeek: jest.fn() });
    const texts = allText(root);

    // The headline is the single fact that matters while logging, and the
    // baseline survives as one de-emphasized caption rather than two rows.
    expect(texts).toContain('Week 3 in progress');
    expect(texts).toContain('Baseline: Push/Pull/Legs');
    expect(texts).not.toContain('Baseline routine');

    // Exactly one lifecycle action is visible by default.
    expect(byLabel(root, 'Complete Week 3')).toBeTruthy();
    expect(byLabel(root, 'Add next recovery week')).toBeUndefined();
    // End recovery is visible in the active card without opening Manage block (#1424).
    expect(byLabel(root, 'End recovery block')).toBeTruthy();
    expect(byLabel(root, 'Unlink Week 3')).toBeUndefined();
    expect(inclusionRow(root)).toBeUndefined();
  });

  test('a just-completed week says so and swaps the one primary action to Add week', () => {
    const root = renderSection({
      weeks: [week({ completed_at: '2026-05-22T00:00:00.000Z' })],
      onOpenAddWeek: jest.fn(),
    });

    expect(allText(root)).toContain('Week 3 complete — add the next week');
    expect(byLabel(root, 'Add next recovery week')).toBeTruthy();
    expect(byLabel(root, 'Complete Week 3')).toBeUndefined();
  });

  test('a block whose weeks are all unlinked still states an honest headline', () => {
    const root = renderSection({ weeks: [], onOpenAddWeek: jest.fn() });
    expect(allText(root)).toContain('No recovery week yet — add a week');
    expect(byLabel(root, 'Add next recovery week')).toBeTruthy();
  });

  test('Unlink has exactly one owner: the disclosure, never the week row', () => {
    const root = renderSection({ onUnlinkWeek: jest.fn() });

    // The row-level Unlink is gone outright -- not merely relocated alongside a
    // second copy. The row itself still reads its note.
    expect(byLabel(root, 'Unlink Week 3')).toBeUndefined();
    expect(byLabel(root, 'View Recovery Week Note, Recovery Week 3')).toBeTruthy();

    render.act(() => { trigger(root).props.onPress(); });
    const unlinks = root.findAll(n => n.props
      && typeof n.props.accessibilityLabel === 'string'
      && n.props.accessibilityLabel.startsWith('Unlink Week')
      && typeof n.props.onPress === 'function');
    expect(unlinks).toHaveLength(1);
    expect(unlinks[0].props.accessibilityLabel).toBe('Unlink Week 3');
  });

  test('the disclosure trigger announces expanded state and reveals all three rare controls', () => {
    const root = renderSection({ onUnlinkWeek: jest.fn(), onCompleteBlock: jest.fn() });
    const control = trigger(root);

    // Named after what it discloses, including the block it belongs to.
    expect(control.props.accessibilityLabel).toBe('Manage recovery block: Push/Pull/Legs');
    expect(control.props.accessibilityRole).toBe('button');
    expect(control.props.accessibilityState).toEqual({ expanded: false });

    render.act(() => { control.props.onPress(); });
    expect(trigger(root).props.accessibilityState).toEqual({ expanded: true });
    expect(byLabel(root, 'Unlink Week 3')).toBeTruthy();
    expect(byLabel(root, 'End recovery block')).toBeTruthy();
    expect(inclusionRow(root)).toBeTruthy();

    // And it collapses again.
    render.act(() => { trigger(root).props.onPress(); });
    expect(trigger(root).props.accessibilityState).toEqual({ expanded: false });
    // Collapsed content stays mounted but hidden from assistive tech (#1315).
    const body = root.findAll(n => typeof n.type === 'string' && /^recovery-manage-body-/.test(n.props.testID || ''))[0];
    expect(body.props.accessibilityElementsHidden).toBe(true);
    expect(body.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  // #843 review: `Counting in normal analytics` IS the Log-surface
  // inclusion control — its live On/Off state is stated on the row itself,
  // with no nested `RecoveryInclusionToggle` Switch. The write path this
  // row's tap drives is covered end to end against real storage by the
  // "Recovery inclusion preference" describe block above.
  test('the Counting in normal analytics row states the live value with no nested switch', () => {
    const root = renderSection({ onUnlinkWeek: jest.fn(), onCompleteBlock: jest.fn() });
    render.act(() => { trigger(root).props.onPress(); });

    const row = byLabel(root, 'Counting in normal analytics: Off');
    expect(row).toBeTruthy();
    expect(row.props.accessibilityRole).toBe('switch');
    expect(row.props.accessibilityState).toEqual({ checked: false, disabled: false, busy: false });
    // No separate Switch control is nested under the row.
    expect(root.findAll(n => n.props && typeof n.props.onValueChange === 'function')).toHaveLength(0);

    // #843 review: the on-demand help toggle must be a SIBLING of the switch
    // Pressable, not nested inside it — a nested Pressable is grouped into
    // its accessible ancestor by VoiceOver, making it unreachable as its own
    // action.
    const helpToggle = root.findAll(
      n => n.props && n.props.accessibilityRole === 'button'
        && typeof n.props.accessibilityLabel === 'string'
        && n.props.accessibilityLabel === 'What Counting in normal analytics means'
    )[0];
    expect(helpToggle).toBeTruthy();
    // #1356: shared 44dp info icon, beside the setting; help hidden until tapped.
    expect(helpToggle.props.accessibilityState).toEqual({ expanded: false });
    expect(root.findAll(n => n.type === 'Text' && String(n.props.children) === RECOVERY_INCLUSION_HELP)).toHaveLength(0);
    render.act(() => { helpToggle.props.onPress(); });
    expect(root.findAll(n => n.type === 'Text' && String(n.props.children) === RECOVERY_INCLUSION_HELP)).toHaveLength(1);
    let ancestor = helpToggle.parent;
    let foundSwitchAncestor = false;
    while (ancestor) {
      if (ancestor.props && ancestor.props.accessibilityRole === 'switch') foundSwitchAncestor = true;
      ancestor = ancestor.parent;
    }
    expect(foundSwitchAncestor).toBe(false);
  });

  test('locked mutations disable each control individually and never the disclosure itself', () => {
    // The corrected #780 blocked-mutation contract: disabling the trigger would
    // strand every disclosed control behind a container that cannot be opened.
    const root = renderSection({
      mutationsAllowed: false,
      onCompleteWeek: jest.fn(),
      onUnlinkWeek: jest.fn(),
      onCompleteBlock: jest.fn(),
    });

    const control = trigger(root);
    expect(control.props.disabled).toBeFalsy();
    expect(control.props.accessibilityState.disabled).toBeUndefined();

    expect(byLabel(root, 'Complete Week 3').props.accessibilityState.disabled).toBe(true);

    render.act(() => { control.props.onPress(); });
    expect(trigger(root).props.accessibilityState).toEqual({ expanded: true });
    expect(byLabel(root, 'Unlink Week 3').props.accessibilityState.disabled).toBe(true);
    expect(byLabel(root, 'End recovery block').props.accessibilityState.disabled).toBe(true);
    expect(inclusionRow(root).props.accessibilityState.disabled).toBe(true);
  });

  test('banners stay outside the disclosure so they are announced without expanding anything', () => {
    const root = renderSection({ stateStale: true, onRetryRecovery: jest.fn() });

    expect(allText(root)).toContain(RECOVERY_STALE_MESSAGE);
    expect(byLabel(root, 'Retry recovery')).toBeTruthy();
    // Still collapsed: reading the notice never required opening it.
    expect(trigger(root).props.accessibilityState).toEqual({ expanded: false });
  });

  // #792 review (P2): this component stays mounted for a block's whole
  // lifetime, and completing a block only makes it render no active card — it
  // does not unmount. A boolean `expanded` would survive that gap and hand the
  // NEXT block a disclosure that is already open, exposing Unlink, block
  // completion, and the inclusion switch by default. The state is keyed by
  // block id so any block change reads as collapsed.
  test('a new active block starts collapsed even if the previous one was left expanded', () => {
    const NEXT_BLOCK = {
      ...BLOCK, id: 'rb789next', baseline_note_title: 'Upper/Lower',
      started_at: '2026-09-01T00:00:00.000Z',
    };
    const nextWeek = { ...week(), id: 'rw1next', block_id: NEXT_BLOCK.id, week_number: 1 };

    let component;
    render.act(() => {
      component = render.create(
        <LogRecoverySection
          blocks={[BLOCK]} weeks={[week()]} notes={[WEEK_NOTE]}
          onUnlinkWeek={jest.fn()} onCompleteBlock={jest.fn()}
        />
      );
    });
    const root = component.root;

    render.act(() => { trigger(root).props.onPress(); });
    expect(trigger(root).props.accessibilityState).toEqual({ expanded: true });
    expect(byLabel(root, 'Unlink Week 3')).toBeTruthy();

    // The block is completed: the same mounted component now has no active
    // card at all. Then a second block is started without leaving the tab.
    render.act(() => {
      component.update(
        <LogRecoverySection
          blocks={[{ ...BLOCK, completed_at: '2026-08-01T00:00:00.000Z' }]} weeks={[week()]} notes={[WEEK_NOTE]}
          onUnlinkWeek={jest.fn()} onCompleteBlock={jest.fn()}
        />
      );
    });
    expect(component.toJSON()).toBeNull();

    render.act(() => {
      component.update(
        <LogRecoverySection
          blocks={[{ ...BLOCK, completed_at: '2026-08-01T00:00:00.000Z' }, NEXT_BLOCK]}
          weeks={[nextWeek]} notes={[WEEK_NOTE]}
          onUnlinkWeek={jest.fn()} onCompleteBlock={jest.fn()}
        />
      );
    });

    // The new block owns its own disclosure state, and it is closed.
    expect(allText(root)).toContain('Week 1 in progress');
    expect(trigger(root).props.accessibilityLabel).toBe('Manage recovery block: Upper/Lower');
    expect(trigger(root).props.accessibilityState).toEqual({ expanded: false });
    expect(byLabel(root, 'Unlink Week 1')).toBeUndefined();
    expect(byLabel(root, 'End recovery block')).toBeTruthy();
    expect(inclusionRow(root)).toBeUndefined();

    // And it still opens normally, now scoped to the new block.
    render.act(() => { trigger(root).props.onPress(); });
    expect(byLabel(root, 'Unlink Week 1')).toBeTruthy();
  });
});

// -- Simplified active Recovery panel (#804) --------------------------------
//
// R4b (#789/#792) established WHICH facts and controls the card holds. #804
// only settles how they are presented: the week row stops restating the
// headline's state, the one expected next action becomes the card's only
// accent-filled control, the rare destructive one demotes to a secondary chip,
// and the disclosure adopts the standard MaterialIcons chevron. No handler,
// gate, confirm, or calculation moves — the assertions below therefore pin the
// preserved behavior alongside the new hierarchy.
describe('LogRecoverySection: simplified active Recovery panel (#804)', () => {
  const { LogRecoverySection } = require('../components/LogRecoverySection');
  const { RECOVERY_STALE_MESSAGE } = require('../hooks/entries/recoveryBlockHooks');
  const { LightColors } = require('../theme/colors');
  const { buildDayGroups } = require('../screens/log/logScreenHelpers');
  const { parseWorkoutNote: parse } = require('../lib/parser');

  const BLOCK = {
    id: 'rb804', baseline_note_id: 'baseline', baseline_note_title: 'Push/Pull/Legs',
    started_at: '2026-05-01T00:00:00.000Z', completed_at: null, deleted_at: null,
  };
  const WEEK_NOTE = {
    id: 'weeknote', title: 'Recovery Week Note',
    raw_text: 'Monday\n+Lifting\n-Overhead Press\n65 5,5,5',
  };
  const week = (overrides = {}) => ({
    id: 'rw3', block_id: 'rb804', note_id: 'weeknote', week_number: 3,
    completed_at: null, deleted_at: null, ...overrides,
  });

  const renderSection = (props = {}) => {
    let component;
    render.act(() => {
      component = render.create(
        <LogRecoverySection blocks={[BLOCK]} weeks={[week()]} notes={[WEEK_NOTE]} {...props} />
      );
    });
    return component.root;
  };

  const flat = (node) => (Array.isArray(node.props.style)
    ? Object.assign({}, ...node.props.style.filter(Boolean))
    : node.props.style) || {};
  const allText = (root) => root.findAll(n => n.type === 'Text').map(n => {
    const c = n.props.children;
    return Array.isArray(c) ? c.join('') : String(c ?? '');
  });
  const byLabel = (root, label) => root.findAll(n => n.props && n.props.accessibilityLabel === label)[0];
  const trigger = (root) => root.findAll(
    n => n.props && typeof n.props.accessibilityLabel === 'string'
      && n.props.accessibilityLabel.startsWith('Manage recovery block')
      && typeof n.props.onPress === 'function'
  )[0];
  const expand = (root) => { render.act(() => { trigger(root).props.onPress(); }); };
  // `Counting in normal analytics` IS the Log-surface inclusion control
  // (#843 review) — no separate `RecoveryInclusionToggle` Switch nested
  // under it.
  const inclusionRow = (root) => root.findAll(
    n => n.props && n.props.accessibilityRole === 'switch' && typeof n.props.onPress === 'function'
  )[0];
  const accentFilled = (root) => root.findAll(
    n => n.props && typeof n.props.onPress === 'function'
      && flat(n).backgroundColor === LightColors.accent
  );

  test('the week row carries the note and its own status, alongside the headline (#836)', () => {
    const root = renderSection();
    const texts = allText(root);

    // #836 corrected #789's original design: the headline only ever
    // describes the CURRENT week, but now every live week — completed
    // history included — renders as its own row. #843 moves status off a
    // repeated text label onto the row's status dot alone; the headline
    // still owns the current-week state fact, and the row's own week label
    // and note title are additional, not a duplicate of it.
    expect(texts).toContain('Week 3 in progress');
    expect(texts).toContain('Week 3');
    expect(texts).toContain('Recovery Week Note');
  });

  test('the week row still reads its note inline, with its accessible name intact', () => {
    const onViewNote = jest.fn();
    const root = renderSection({ onViewNote });

    // A screen-reader user reaches this control out of context, so the label
    // keeps the week number and the read verb even though the visible row no
    // longer repeats them.
    const row = byLabel(root, 'View Recovery Week Note, Recovery Week 3');
    expect(row).toBeTruthy();
    expect(row.props.accessibilityRole).toBe('button');
    expect(flat(row).minHeight).toBeGreaterThanOrEqual(44);

    render.act(() => { row.props.onPress(); });
    expect(onViewNote).toHaveBeenCalledWith(WEEK_NOTE);

    // And the owner's viewer state renders in this card, with the A/B switch.
    const viewing = renderSection({
      viewingNoteId: 'weeknote',
      viewingNote: WEEK_NOTE,
      viewingNoteDayGroups: buildDayGroups(parse(WEEK_NOTE.raw_text).sections),
      viewingHasABWeeks: true,
      viewingEffectiveWeek: 'A',
      onToggleViewingWeek: jest.fn(),
    });
    expect(byLabel(viewing, 'Switch to Week B')).toBeTruthy();
  });

  // #843 review: the compact reading mode must not silently drop a
  // user-entered `*mark`, and must not repeat the note's own day heading
  // (already shown once by the inset surface's own kicker).
  test('compact rendering preserves a marked set and does not duplicate the day heading', () => {
    const markedNote = {
      id: 'weeknote', title: 'Recovery Week Note',
      raw_text: 'Monday\n+Lifting\n-Overhead Press\n65 5,5,5 *PR',
    };
    const onViewNote = jest.fn();
    const root = renderSection({
      weeks: [week({ note_id: 'weeknote' })],
      notes: [markedNote],
      onViewNote,
      viewingNoteId: 'weeknote',
      viewingNote: markedNote,
      viewingNoteDayGroups: buildDayGroups(parse(markedNote.raw_text).sections),
    });

    expect(allText(root)).toContain('★ PR');
    // "Monday" is this note's one day heading; it must render exactly once
    // (via the inset surface's own uppercase kicker), not a second time from
    // WorkoutContentRenderer's own WorkoutHeading.
    const mondayCount = root.findAll(n => n.type === 'Text'
      && String(Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children ?? '')
        .toUpperCase() === 'MONDAY').length;
    expect(mondayCount).toBe(1);
  });

  test('compact Recovery reading labels every parsed weekday in authored order', () => {
    const multiDayNote = {
      id: 'weeknote', title: 'Recovery Week Note',
      raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5\nWednesday\n+Lifting\n-Row\n95 8,8,8',
    };
    const root = renderSection({
      weeks: [week({ note_id: 'weeknote' })],
      notes: [multiDayNote],
      viewingNoteId: 'weeknote',
      viewingNote: multiDayNote,
      viewingNoteDayGroups: buildDayGroups(parse(multiDayNote.raw_text).sections),
    });
    const text = allText(root).map(value => value.toUpperCase());
    const mondayIndex = text.indexOf('MONDAY');
    const wednesdayIndex = text.indexOf('WEDNESDAY · LIFTING');

    expect(mondayIndex).toBeGreaterThanOrEqual(0);
    expect(wednesdayIndex).toBeGreaterThan(mondayIndex);
    expect(text).toContain('BENCH');
    expect(text).toContain('ROW');
  });

  test('a week with no readable note offers no read affordance at all', () => {
    const root = renderSection({ weeks: [week({ note_id: null })], onViewNote: jest.fn() });

    const row = byLabel(root, 'Recovery Week 3, note unavailable');
    expect(row).toBeTruthy();
    expect(row.props.onPress).toBeUndefined();
    expect(row.props.accessibilityRole).toBeUndefined();
    expect(allText(root)).toContain('Note unavailable');
    // No chevron either: it would advertise a read that cannot happen.
    expect(row.findAll(n => n.props && n.props.name === 'chevron-right')).toHaveLength(0);
  });

  test('the one expected next action is the card\'s only accent-filled control', () => {
    const open = renderSection({ onCompleteWeek: jest.fn() });
    const filled = accentFilled(open);
    expect(filled).toHaveLength(1);
    expect(filled[0].props.accessibilityLabel).toBe('Complete Week 3');

    // It swaps rather than multiplying once the week completes.
    const done = renderSection({
      weeks: [week({ completed_at: '2026-05-22T00:00:00.000Z' })],
      onOpenAddWeek: jest.fn(),
    });
    const swapped = accentFilled(done);
    expect(swapped).toHaveLength(1);
    expect(swapped[0].props.accessibilityLabel).toBe('Add next recovery week');
  });

  test('the rare destructive controls stay secondary and keep a 44dp target', () => {
    const root = renderSection({ onUnlinkWeek: jest.fn(), onCompleteBlock: jest.fn() });
    expand(root);

    // Completing a block is irreversible and happens once per block: an accent
    // fill here would make it the loudest button on the card.
    for (const label of ['Unlink Week 3', 'End recovery block']) {
      const control = byLabel(root, label);
      expect(flat(control).backgroundColor).not.toBe(LightColors.accent);
      expect(flat(control).minHeight).toBeGreaterThanOrEqual(44);
    }
    // Still exactly one accent fill on the card, even with the disclosure open.
    expect(accentFilled(root)).toHaveLength(1);
  });

  test('the disclosure uses the standard chevron, not a text arrow', () => {
    const root = renderSection();
    // The icon renders as a component wrapping its own glyph node, so the name
    // is asserted as the set of disclosure glyphs present, not as a node count.
    const chevrons = (r) => [...new Set(r.findAll(
      n => n.props && /^expand-(more|less)$/.test(n.props.name || '')
    ).map(n => n.props.name))];

    expect(allText(root).join(' ')).not.toMatch(/[▸▾▲▼]/);
    // Every linked week row also uses expand-more/-less now (#843: "never
    // chevron-right for inline expansion"), so with both the trigger and the
    // (unviewed) week row collapsed, the glyph SET is still just 'expand-more'.
    expect(chevrons(root)).toEqual(['expand-more']);
    expect(flat(trigger(root)).minHeight).toBeGreaterThanOrEqual(44);

    expand(root);
    // The trigger is now expanded (expand-less); the week row's own glyph is
    // independent and still collapsed (expand-more).
    expect(chevrons(root)).toEqual(expect.arrayContaining(['expand-less', 'expand-more']));
    expect(trigger(root).props.accessibilityState).toEqual({ expanded: true });
  });

  test('a pending recovery operation still locks every action and stays readable while collapsed', () => {
    const root = renderSection({
      pendingRecovery: [{ id: 'op1' }],
      onCompleteWeek: jest.fn(),
      onUnlinkWeek: jest.fn(),
      onCompleteBlock: jest.fn(),
      onRetryRecovery: jest.fn(),
    });

    expect(allText(root)).toContain('A recovery change is still being applied on this device.');
    expect(byLabel(root, 'Retry recovery')).toBeTruthy();
    expect(byLabel(root, 'Complete Week 3').props.accessibilityState.disabled).toBe(true);

    // The disclosure itself is never disabled, and its contents stay locked.
    expect(trigger(root).props.disabled).toBeFalsy();
    expand(root);
    expect(byLabel(root, 'Unlink Week 3').props.accessibilityState.disabled).toBe(true);
    expect(byLabel(root, 'End recovery block').props.accessibilityState.disabled).toBe(true);
    expect(inclusionRow(root).props.accessibilityState.disabled).toBe(true);
  });

  test('a terminal error explains itself, locks nothing, and offers no retry', () => {
    const root = renderSection({
      pendingRecovery: [],
      pendingRecoveryError: 'That recovery change was cancelled.',
      onCompleteWeek: jest.fn(),
    });

    expect(allText(root)).toContain('That recovery change was cancelled.');
    expect(byLabel(root, 'Retry recovery')).toBeUndefined();
    expect(byLabel(root, 'Complete Week 3').props.accessibilityState.disabled).toBe(false);
  });

  test('a stale snapshot keeps its notice and last-known-good card outside the disclosure', () => {
    const root = renderSection({ stateStale: true, onRetryRecovery: jest.fn() });
    expect(allText(root)).toContain(RECOVERY_STALE_MESSAGE);
    expect(allText(root)).toContain('Week 3 in progress');
    expect(byLabel(root, 'Retry recovery')).toBeTruthy();
    expect(trigger(root).props.accessibilityState).toEqual({ expanded: false });
  });

  test('an unverified first read renders the unknown state and its retry, and a cold load renders nothing', () => {
    let component;
    render.act(() => {
      component = render.create(
        <LogRecoverySection blocks={[]} weeks={[]} notes={[]} stateReady={false} stateLoading />
      );
    });
    expect(component.toJSON()).toBeNull();

    let failed;
    render.act(() => {
      failed = render.create(
        <LogRecoverySection
          blocks={[]} weeks={[]} notes={[]}
          stateReady={false} stateError={new Error('read failed')} onRetryRecovery={jest.fn()}
        />
      );
    });
    expect(byLabel(failed.root, 'Retry recovery')).toBeTruthy();
  });
});

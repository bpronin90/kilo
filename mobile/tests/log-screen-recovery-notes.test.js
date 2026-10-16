import { installRendererCleanup } from './helpers/log-screen';
import React from 'react';
import render from 'react-test-renderer';
import * as useEntries from '../hooks/useEntries';
import { Alert } from 'react-native';
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

describe('Recovery weeks read their own notes (#775)', () => {
  const { LogRecoverySection } = require('../components/LogRecoverySection');
  const { buildDayGroups } = require('../screens/log/logScreenHelpers');
  const { parseWorkoutNote: parse } = require('../lib/parser');

  const BLOCK = {
    id: 'rb775', baseline_note_id: 'baseline', baseline_note_title: 'Push Day',
    started_at: '2026-05-01T00:00:00.000Z', completed_at: null, deleted_at: null,
  };
  const week = (overrides = {}) => ({
    id: 'rw1', block_id: 'rb775', note_id: 'weeknote', week_number: 1,
    completed_at: null, deleted_at: null, ...overrides,
  });
  const WEEK_NOTE = { id: 'weeknote', title: 'Recovery Week Note', raw_text: 'Monday\n+Lifting\n-Overhead Press\n65 5,5,5' };

  const renderSection = (props = {}) => {
    let component;
    render.act(() => {
      component = render.create(
        <LogRecoverySection blocks={[BLOCK]} weeks={[week()]} notes={[WEEK_NOTE]} {...props} />
      );
    });
    return component.root;
  };

  const rowMain = (root, label) => root.findAll(n => n.props && n.props.accessibilityLabel === label)[0];
  const hasExercise = (root, name) => root.findAll(
    n => n.type === 'Text' && String(n.props.children ?? '').includes(name)
  ).length > 0;

  test('a tapped week renders its note inline, in the row the user tapped', () => {
    const onViewNote = jest.fn();
    const root = renderSection({ onViewNote });

    const row = rowMain(root, 'View Recovery Week Note, Recovery Week 1');
    expect(typeof row.props.onPress).toBe('function');
    expect(hasExercise(root, 'Overhead Press')).toBe(false);
    render.act(() => { row.props.onPress(); });
    expect(onViewNote).toHaveBeenCalledWith(WEEK_NOTE);

    // The owner echoes the selection back through the shared viewer state.
    const viewing = renderSection({
      viewingNoteId: 'weeknote',
      viewingNote: WEEK_NOTE,
      viewingNoteDayGroups: buildDayGroups(parse(WEEK_NOTE.raw_text).sections),
    });
    expect(hasExercise(viewing, 'Overhead Press')).toBe(true);
  });

  // #775 review: `viewingNoteDayGroups` is the SELECTED half of an A/B note, so
  // an inline viewer without the Week switch strands the other week — a
  // regression against the More Routines handoff this replaced.
  test('an A/B recovery-week note keeps its Week switch inline, with the pill contract it has in More Routines', () => {
    const AB_NOTE = {
      id: 'weeknote', title: 'AB Week',
      raw_text: 'Monday\n+Lifting\n-Overhead Press\n65 5,5,5\n---\nTuesday\n+Lifting\n-Chin Up\n0 5,5,5',
    };
    const onToggleViewingWeek = jest.fn();
    const viewingWeek = (week) => renderSection({
      notes: [AB_NOTE],
      viewingNoteId: 'weeknote',
      viewingNote: AB_NOTE,
      viewingHasABWeeks: true,
      viewingEffectiveWeek: week,
      viewingNoteDayGroups: buildDayGroups(
        parse(week === 'B' ? AB_NOTE.raw_text.split('\n---\n')[1] : AB_NOTE.raw_text.split('\n---\n')[0]).sections
      ),
      onToggleViewingWeek,
    });

    const onA = viewingWeek('A');
    expect(hasExercise(onA, 'Overhead Press')).toBe(true);
    expect(hasExercise(onA, 'Chin Up')).toBe(false);
    const pill = onA.findAll(
      n => n.props && n.props.accessibilityLabel === 'Switch to Week B' && typeof n.props.onPress === 'function'
    )[0];
    expect(pill).toBeTruthy();
    expect(pill.props.accessibilityRole).toBe('button');
    expect(pill.props.accessibilityState).toEqual({ selected: false });
    render.act(() => { pill.props.onPress(); });
    expect(onToggleViewingWeek).toHaveBeenCalledTimes(1);

    // The owner flips the selection; the other half is now readable here.
    const onB = viewingWeek('B');
    expect(hasExercise(onB, 'Chin Up')).toBe(true);
    expect(hasExercise(onB, 'Overhead Press')).toBe(false);
    const back = onB.findAll(
      n => n.props && n.props.accessibilityLabel === 'Switch to Week A' && typeof n.props.onPress === 'function'
    )[0];
    expect(back).toBeTruthy();
    expect(back.props.accessibilityState).toEqual({ selected: true });
  });

  test('a single-week recovery note shows no Week switch', () => {
    const root = renderSection({
      viewingNoteId: 'weeknote',
      viewingNote: WEEK_NOTE,
      viewingNoteDayGroups: buildDayGroups(parse(WEEK_NOTE.raw_text).sections),
    });
    expect(root.findAll(
      n => n.props && /^Switch to Week [AB]$/.test(n.props.accessibilityLabel || '')
    ).length).toBe(0);
  });

  test('an untitled note that exists is still named Untitled Routine and still readable', () => {
    const untitled = { id: 'weeknote', title: '', raw_text: 'Monday\n+Lifting\n-Row\n95 5,5,5' };
    const root = renderSection({ notes: [untitled] });

    const row = rowMain(root, 'View Untitled Routine, Recovery Week 1');
    expect(row).toBeTruthy();
    expect(row.props.accessibilityRole).toBe('button');
    expect(typeof row.props.onPress).toBe('function');
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Note unavailable').length).toBe(0);
  });

  for (const [shape, weekOverrides, notes] of [
    ['a note_id naming a note that is gone', { note_id: 'gone' }, []],
    ['a null note_id', { note_id: null }, [WEEK_NOTE]],
  ]) {
    test(`${shape}: the row says Note unavailable and offers no read action`, () => {
      const onViewNote = jest.fn();
      const onUnlinkWeek = jest.fn();
      const root = renderSection({ weeks: [week(weekOverrides)], notes, onViewNote, onUnlinkWeek });

      const row = rowMain(root, 'Recovery Week 1, note unavailable');
      expect(row).toBeTruthy();
      expect(row.props.onPress).toBeUndefined();
      expect(row.props.accessibilityRole).toBeUndefined();
      expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Note unavailable').length).toBe(1);
      // 'Untitled Routine' stays reserved for notes that exist.
      expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Untitled Routine').length).toBe(0);
      // Nothing is repaired, rewritten, or unlinked just by rendering the row.
      expect(onViewNote).not.toHaveBeenCalled();
      expect(onUnlinkWeek).not.toHaveBeenCalled();
    });

    test(`${shape}: Unlink survives and its confirmation claims nothing about a missing note`, async () => {
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      const onUnlinkWeek = jest.fn().mockResolvedValue({ ok: true });
      const root = renderSection({ weeks: [week(weekOverrides)], notes, onUnlinkWeek });

      expandManageRecovery(root);
      const unlink = root.findAll(
        n => n.props && n.props.accessibilityLabel === 'Unlink Week 1' && typeof n.props.onPress === 'function'
      )[0];
      expect(unlink).toBeTruthy();
      render.act(() => { unlink.props.onPress(); });

      const [title, message, buttons] = alertSpy.mock.calls[0];
      expect(title).toBe('Unlink Week 1?');
      expect(message).toBe('Week 1 will be removed from this recovery block.');
      expect(message).not.toContain('Untitled Routine');
      expect(message).not.toContain('stays editable');

      await render.act(async () => { await buttons.find(b => b.text === 'Unlink').onPress(); });
      expect(onUnlinkWeek).toHaveBeenCalledWith({ blockId: 'rb775', weekId: 'rw1' });
      alertSpy.mockRestore();
    });
  }

  test('a linked note that exists keeps the full unlink confirmation', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const root = renderSection({ onUnlinkWeek: jest.fn() });
    expandManageRecovery(root);
    const unlink = root.findAll(
      n => n.props && n.props.accessibilityLabel === 'Unlink Week 1' && typeof n.props.onPress === 'function'
    )[0];
    render.act(() => { unlink.props.onPress(); });

    expect(alertSpy.mock.calls[0][1]).toBe(
      '"Recovery Week Note" will be removed from this recovery block. The note itself is kept and stays editable.'
    );
    alertSpy.mockRestore();
  });
});

// -- Inline recovery-note editing (#841) -------------------------------------
//
// Both entry points — the explicit `Edit` action and double-tapping the
// expanded note body — must open the SAME inline editor inside this block,
// seeded from the same note and currently viewed A/B week, and must never
// drive the shared full-screen Routine editor (LogScreen owns that gate via
// `editingSource === 'recovery'`; these tests only exercise what
// LogRecoverySection itself renders for a given prop shape). A small
// controlled wrapper stands in for that LogScreen wiring, mirroring
// `ControlledPreviousRoutines` above.
describe('LogRecoverySection: inline recovery-note editing (#841)', () => {
  const { LogRecoverySection } = require('../components/LogRecoverySection');
  const { buildDayGroups } = require('../screens/log/logScreenHelpers');
  const { parseWorkoutNote: parse } = require('../lib/parser');

  const BLOCK = {
    id: 'rb841', baseline_note_id: 'baseline', baseline_note_title: 'Push Day',
    started_at: '2026-05-01T00:00:00.000Z', completed_at: null, deleted_at: null,
  };
  const week = (overrides = {}) => ({
    id: 'rw1', block_id: 'rb841', note_id: 'weeknote', week_number: 1,
    completed_at: null, deleted_at: null, ...overrides,
  });
  const AB_NOTE = {
    id: 'weeknote', title: 'AB Week',
    raw_text: 'Monday\n+Lifting\n-Overhead Press\n65 5,5,5\n---\nTuesday\n+Lifting\n-Chin Up\n0 5,5,5',
  };
  const weekAText = AB_NOTE.raw_text.split('\n---\n')[0];
  const weekBText = AB_NOTE.raw_text.split('\n---\n')[1];

  // Stands in for LogScreen: seeds the inline editor from whichever A/B week
  // is currently viewed, exactly as `handleEditRecoveryViewedNote` does, and
  // routes Save/Cancel through the caller's spies before closing.
  function ControlledInlineEdit({ note, onSaveEdit, onCancelEdit, ...props }) {
    const [editingNoteId, setEditingNoteId] = React.useState(null);
    const [editingTitle, setEditingTitle] = React.useState('');
    const [editingText, setEditingText] = React.useState('');
    const [editingWeek, setEditingWeek] = React.useState(null);
    const handleEditNote = () => {
      setEditingNoteId(note.id);
      setEditingTitle(note.title || '');
      setEditingText(props.viewingHasABWeeks ? (
        props.viewingEffectiveWeek === 'B' ? weekBText : weekAText
      ) : note.raw_text);
      setEditingWeek(props.viewingHasABWeeks ? props.viewingEffectiveWeek : null);
    };
    return (
      <LogRecoverySection
        {...props}
        onEditNote={handleEditNote}
        editingNoteId={editingNoteId}
        editingTitle={editingTitle}
        onChangeEditingTitle={setEditingTitle}
        editingText={editingText}
        onChangeEditingText={setEditingText}
        editingHasABWeeks={props.viewingHasABWeeks}
        editingEffectiveWeek={editingWeek}
        onToggleEditingWeek={() => setEditingWeek(w => (w === 'B' ? 'A' : 'B'))}
        onSaveEdit={() => { onSaveEdit?.(); setEditingNoteId(null); }}
        onCancelEdit={() => { onCancelEdit?.(); setEditingNoteId(null); }}
      />
    );
  }

  const renderInline = (overrides = {}) => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledInlineEdit
          note={AB_NOTE}
          blocks={[BLOCK]}
          weeks={[week()]}
          notes={[AB_NOTE]}
          viewingNoteId="weeknote"
          viewingNote={AB_NOTE}
          viewingHasABWeeks
          viewingEffectiveWeek="B"
          viewingNoteDayGroups={buildDayGroups(parse(weekBText).sections)}
          {...overrides}
        />
      );
    });
    return component.root;
  };

  const byLabel = (root, label) => root.findAll(
    n => n.props && n.props.accessibilityLabel === label && typeof n.props.onPress === 'function'
  )[0];
  const titleInput = (root) => root.findAll(
    n => n.props && n.props.accessibilityLabel === 'Recovery note title'
  )[0];
  const textInput = (root) => root.findAll(
    n => n.props && n.props.accessibilityLabel === 'Recovery note text'
  )[0];

  test('the explicit Edit action opens the inline editor seeded from the viewed note and its current A/B week', () => {
    const root = renderInline();
    expect(titleInput(root)).toBeUndefined();

    render.act(() => { byLabel(root, 'Edit').props.onPress(); });

    const title = titleInput(root);
    const text = textInput(root);
    expect(title.props.value).toBe('AB Week');
    expect(text.props.value).toBe(weekBText);
    // Still viewing/editing Week B: the pill offers the switch TO A.
    expect(byLabel(root, 'Switch to Week A')).toBeTruthy();
    expect(byLabel(root, 'Switch to Week B')).toBeUndefined();
  });

  test('double-tapping the expanded note body opens the same inline editor as Edit', () => {
    const root = renderInline();
    // Locate the Pressable wrapping the rendered note body by walking up
    // from a rendered exercise name to its nearest onPress ancestor.
    const anyExerciseText = root.findAll(n => n.type === 'Text' && n.props.children === 'Chin Up')[0];
    let node = anyExerciseText.parent;
    while (node && !(node.props && typeof node.props.onPress === 'function')) node = node.parent;
    expect(node).toBeTruthy();

    render.act(() => { node.props.onPress(); });
    render.act(() => { node.props.onPress(); });

    expect(titleInput(root).props.value).toBe('AB Week');
    expect(textInput(root).props.value).toBe(weekBText);
  });

  // #843 gives the two controls distinct treatments — an outlined `Edit note`
  // control and a 32dp A/B segment — rather than matching pill styling, so
  // this pins each control's own documented metric instead of symmetry
  // between them. #921 raised both to the 44dp interaction floor without
  // changing either treatment: `Edit note` grew its own box, and the segment
  // kept its 32dp visual inside a real 44dp target box. Neither declares a
  // fixed `height` any more, so both grow with the user's text scale; the
  // per-control target contract itself lives in
  // `interaction-target-a11y.test.js`.
  test('Edit note is an outlined 44dp control and the A/B segment keeps a 32dp visual in a 44dp box', () => {
    const root = renderInline();
    const editBtn = byLabel(root, 'Edit');
    const weekPill = byLabel(root, 'Switch to Week A');
    const flat = (n) => Object.assign({}, ...(Array.isArray(n.props.style) ? n.props.style : [n.props.style]).filter(Boolean));
    expect(flat(editBtn).height).toBeUndefined();
    expect(flat(editBtn).minHeight).toBe(44);
    expect(flat(editBtn).borderWidth).toBe(1);
    expect(flat(weekPill).height).toBeUndefined();
    expect(flat(weekPill).minHeight).toBe(44);
    const visual = weekPill.findAll(n => typeof n.type === 'string' && flat(n).minHeight === 32)[0];
    expect(visual).toBeTruthy();
    expect(flat(visual).height).toBeUndefined();
  });

  test('Save calls through to the owner and returns the block to read mode without collapsing the week', () => {
    const onSaveEdit = jest.fn();
    const root = renderInline({ onSaveEdit });
    render.act(() => { byLabel(root, 'Edit').props.onPress(); });
    expect(titleInput(root)).toBeTruthy();

    render.act(() => { byLabel(root, 'Save recovery note').props.onPress(); });
    expect(onSaveEdit).toHaveBeenCalledTimes(1);
    expect(titleInput(root)).toBeUndefined();
    // Still viewing the same week — the row stayed expanded, not collapsed.
    expect(root.findAll(n => n.props && n.props.accessibilityLabel === 'View AB Week, Recovery Week 1')[0]
      .props.accessibilityState.expanded).toBe(true);
  });

  test('Cancel delegates the close decision and never invokes Save directly', () => {
    const onSaveEdit = jest.fn();
    const onCancelEdit = jest.fn();
    const root = renderInline({ onSaveEdit, onCancelEdit });
    render.act(() => { byLabel(root, 'Edit').props.onPress(); });

    render.act(() => { byLabel(root, 'Cancel editing recovery note').props.onPress(); });
    expect(onCancelEdit).toHaveBeenCalledTimes(1);
    expect(onSaveEdit).not.toHaveBeenCalled();
    expect(titleInput(root)).toBeUndefined();
  });

  test('a save failure keeps the inline editor open with the error visible in the block', () => {
    const root = renderInline({ editingSaveError: 'Save failed' });
    render.act(() => { byLabel(root, 'Edit').props.onPress(); });
    expect(titleInput(root)).toBeTruthy();
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Save failed').length).toBe(1);
  });

  // Since viewingNoteId (which week is expanded) and editingNoteId (which
  // note is mid-edit) are independent props, switching to ANOTHER week must
  // remain blocked. The edited row itself is the exception: its expand-less
  // affordance must ask the owner to close through unsaved-change protection.
  test('other week rows freeze while the edited row routes collapse through its close handler', () => {
    const otherWeek = { id: 'rw2', block_id: 'rb841', note_id: 'other', week_number: 2, completed_at: null, deleted_at: null };
    const OTHER_NOTE = { id: 'other', title: 'Other Week', raw_text: 'Monday\n+Lifting\n-Row\n95 5,5,5' };
    const onCancelEdit = jest.fn();
    const root = renderInline({ weeks: [week(), otherWeek], notes: [AB_NOTE, OTHER_NOTE], onCancelEdit });

    render.act(() => { byLabel(root, 'Edit').props.onPress(); });
    expect(titleInput(root)).toBeTruthy();

    const editedRow = root.findAll(n => n.props
      && n.props.accessibilityLabel === 'Close editor for AB Week, Recovery Week 1')[0];
    expect(editedRow).toBeTruthy();
    expect(editedRow.props.accessibilityState.disabled).toBe(false);
    render.act(() => { editedRow.props.onPress(); });
    expect(onCancelEdit).toHaveBeenCalledTimes(1);
    expect(titleInput(root)).toBeUndefined();

    // Reopen to verify another row cannot unmount this editor underneath it.
    render.act(() => { byLabel(root, 'Edit').props.onPress(); });
    const otherRow = root.findAll(n => n.props
      && n.props.accessibilityLabel === 'View Other Week, Recovery Week 2')[0];
    expect(otherRow).toBeTruthy();
    expect(otherRow.props.onPress).toBeUndefined();
    expect(otherRow.props.accessibilityState.disabled).toBe(true);
  });

  test('recovery block and week fields stay unchanged while editing', () => {
    const flatText = (root) => root.findAll(n => n.type === 'Text').map(n => {
      const c = n.props.children;
      return Array.isArray(c) ? c.join('') : String(c ?? '');
    });
    const root = renderInline();
    expect(flatText(root)).toContain('Baseline: Push Day');
    expect(flatText(root)).toContain('Week 1 in progress');
    render.act(() => { byLabel(root, 'Edit').props.onPress(); });
    expect(flatText(root)).toContain('Baseline: Push Day');
    expect(flatText(root)).toContain('Week 1 in progress');
  });

  // Automated review finding: `Complete recovery block` unmounts this whole
  // active-block card, and `Unlink Week` removes a week's row outright —
  // either could otherwise fire while a note is mid-edit and take the
  // inline editor's only Save/Cancel down with it. Every lifecycle control
  // locks, not just the two that can unmount something, so the one
  // `actionsLocked` flag keeps a single meaning throughout the card.
  test('every recovery lifecycle action locks while a note is edited inline', () => {
    const root = renderInline({
      onCompleteWeek: jest.fn(),
      onOpenAddWeek: jest.fn(),
      onUnlinkWeek: jest.fn(),
      onCompleteBlock: jest.fn(),
    });
    expect(byLabel(root, 'Complete Week 1').props.accessibilityState.disabled).toBeFalsy();

    render.act(() => { byLabel(root, 'Edit').props.onPress(); });
    expect(byLabel(root, 'Complete Week 1').props.accessibilityState.disabled).toBe(true);

    const manageTrigger = root.findAll(
      n => n.props && typeof n.props.accessibilityLabel === 'string'
        && n.props.accessibilityLabel.startsWith('Manage recovery block')
        && typeof n.props.onPress === 'function'
    )[0];
    // The disclosure trigger itself never disables (#780/#789 contract) — a
    // locked user must still be able to open it and see why its contents
    // are unavailable.
    expect(manageTrigger.props.disabled).toBeFalsy();
    render.act(() => { manageTrigger.props.onPress(); });

    expect(byLabel(root, 'Unlink Week 1').props.accessibilityState.disabled).toBe(true);
    expect(byLabel(root, 'End recovery block').props.accessibilityState.disabled).toBe(true);
  });
});

describe('Log disclosures and Recovery reads at the screen level (#775)', () => {
  const CURRENT = {
    id: 'note1', title: 'Routine A',
    raw_text: 'Monday\n+Lifting\n-Overhead Press\n95 5,5,5',
    saved_at: '2026-06-01T12:00:00.000Z',
  };
  const OTHER = {
    id: 'r1', title: 'Routine B',
    raw_text: 'Tuesday\n+Lifting\n-Squat\n225 5,5,5',
    saved_at: '2026-05-01T12:00:00.000Z',
  };
  const DELOAD = {
    id: 'd1', title: 'Deload · Week 1',
    raw_text: 'Monday\n+Lifting\n-Chin Up\n0 5,5,5',
    saved_at: '2026-04-01T12:00:00.000Z',
  };
  const BLOCK = {
    id: 'rb775s', baseline_note_id: 'note1', baseline_note_title: 'Routine A',
    started_at: '2026-05-01T00:00:00.000Z', completed_at: null, deleted_at: null,
  };

  const setup = ({ weekNoteId = null, deloadMode = true } = {}) => {
    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [CURRENT, OTHER, DELOAD], currentId: 'note1', currentNote: CURRENT,
      deloadNotes: [DELOAD], loading: false, error: null,
      refresh: jest.fn(), selectCurrent: jest.fn(),
      update: jest.fn().mockResolvedValue({}), add: jest.fn(), remove: jest.fn(),
    });
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: [], toggle: jest.fn() });
    useEntries.useDeloadNote.mockReturnValue({
      note: { raw_text: 'Monday\n+Lifting\n-Bench\n95 5,5,5', saved_at: '2026-07-01T00:00:00.000Z' },
      loading: false, save: jest.fn(), clear: jest.fn(),
    });
    useEntries.useDeloadHistory.mockReturnValue({
      history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
    });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: deloadMode });
    const weeks = weekNoteId
      ? [{ id: 'rw1', block_id: BLOCK.id, note_id: weekNoteId, week_number: 1, completed_at: null, deleted_at: null }]
      : [];
    useEntries.useRecoveryBlockState.mockReturnValue({
      activeBlock: weekNoteId ? BLOCK : null,
      blocks: weekNoteId ? [BLOCK] : [],
      weeks,
      recoveryWeekNumberByNoteId: weekNoteId ? { [weekNoteId]: 1 } : {},
      refresh: jest.fn(), pendingRecovery: [], recoveryPendingError: null,
      ready: true, loading: false, refreshing: false, stale: false, error: null,
      mutationsAllowed: true,
    });
    useEntries.useStartRecoveryBlock.mockReturnValue({ startBlock: jest.fn() });
  };

  const mount = (props = {}) => {
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen {...props} />); });
    return component;
  };

  const hasText = (component, needle) => component.root.findAll(
    n => n.type === 'Text'
      && String(Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children ?? '').includes(needle)
  ).length > 0;

  const switchTo = (component, tab) => {
    const toggle = pressableAround(component.root, t => t === tab);
    render.act(() => { toggle.props.onPress(); });
  };

  // #1021: LogPreviousRoutines has no collection-level disclosure any more —
  // non-current routine cards are always listed. "Is Routine B's card in the
  // tree" replaces the old expanded/collapsed check.
  const otherRoutineVisible = (component, title = 'Routine B') => hasText(component, title);

  const deloadToggle = (component) => component.root.findAll(
    n => n.props
      && /^(Expand|Collapse) deload week$/.test(n.props.accessibilityLabel || '')
      && typeof n.props.onPress === 'function'
  )[0];
  const deloadExpanded = (component) => deloadToggle(component).props.accessibilityState.expanded;

  beforeEach(() => {
    jest.clearAllMocks();
    setup();
  });

  test('tapping a Recovery week renders that note in the Recovery card, leaving More Routines alone', () => {
    setup({ weekNoteId: 'r1' });
    // An active block lands on the Recovery tab by default (#823).
    const component = mount();
    expect(hasText(component, 'Squat')).toBe(false);

    const row = component.root.findAll(
      n => n.props && n.props.accessibilityLabel === 'View Routine B, Recovery Week 1' && typeof n.props.onPress === 'function'
    )[0];
    render.act(() => { row.props.onPress(); });

    expect(hasText(component, 'Squat')).toBe(true);
    // The read happened where the tap did: More Routines is unaffected. It
    // only mounts on the Routine tab (#823), so switch there to check it.
    switchTo(component, 'Routine');
    expect(otherRoutineVisible(component)).toBe(true);
  });

  test('an A/B recovery week can be read week by week without leaving the Recovery card', () => {
    // The whole note is never rendered at once — the viewer projects one half —
    // so the inline read is only complete if its Week switch works here (#775
    // review).
    const AB = {
      id: 'ab1', title: 'AB Routine',
      raw_text: 'Monday\n+Lifting\n-Squat\n225 5,5,5\n---\nTuesday\n+Lifting\n-Chin Up\n0 5,5,5',
      saved_at: '2026-05-02T12:00:00.000Z',
    };
    setup({ weekNoteId: 'ab1' });
    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [CURRENT, AB, DELOAD], currentId: 'note1', currentNote: CURRENT,
      deloadNotes: [DELOAD], loading: false, error: null,
      refresh: jest.fn(), selectCurrent: jest.fn(),
      update: jest.fn().mockResolvedValue({ ...AB, activeWeek: 'B' }), add: jest.fn(), remove: jest.fn(),
    });
    const component = mount();

    const row = component.root.findAll(
      n => n.props && n.props.accessibilityLabel === 'View AB Routine, Recovery Week 1' && typeof n.props.onPress === 'function'
    )[0];
    render.act(() => { row.props.onPress(); });
    expect(hasText(component, 'Squat')).toBe(true);
    expect(hasText(component, 'Chin Up')).toBe(false);

    const pill = component.root.findAll(
      n => n.props && n.props.accessibilityLabel === 'Switch to Week B' && typeof n.props.onPress === 'function'
    )[0];
    expect(pill).toBeTruthy();
    render.act(() => { pill.props.onPress(); });

    expect(hasText(component, 'Chin Up')).toBe(true);
    expect(hasText(component, 'Squat')).toBe(false);
    // Still read in place: More Routines is unaffected.
    switchTo(component, 'Routine');
    expect(otherRoutineVisible(component, 'AB Routine')).toBe(true);
  });

  test('a recovery week linked to the CURRENT routine is readable too, not an inert press', () => {
    setup({ weekNoteId: 'note1' });
    const component = mount();
    // The active card renders the editor's text, not this note's body.
    expect(hasText(component, 'Overhead Press')).toBe(false);

    const row = component.root.findAll(
      n => n.props && n.props.accessibilityLabel === 'View Routine A, Recovery Week 1' && typeof n.props.onPress === 'function'
    )[0];
    expect(row).toBeTruthy();
    render.act(() => { row.props.onPress(); });

    expect(hasText(component, 'Overhead Press')).toBe(true);
    switchTo(component, 'Routine');
    expect(otherRoutineVisible(component)).toBe(true);
  });

  // #1021: no collection-level disclosure left to keep state for — More
  // Routines simply keeps listing its non-current cards across a
  // Routine→Deload→Routine remount.
  test('More Routines keeps listing its non-current routines across Routine→Deload→Routine', () => {
    const component = mount();
    expect(otherRoutineVisible(component)).toBe(true);

    switchTo(component, 'Deload');
    switchTo(component, 'Routine');
    expect(otherRoutineVisible(component)).toBe(true);
  });

  // #1021: a navigation handoff to a non-current note needs no "reveal" step
  // any more — LogPreviousRoutines always lists it — so the note it targets
  // just stays viewed across an unrelated Routine↔Deload remount.
  test('a note handoff stays viewed across the remount a view switch causes', () => {
    const component = mount({ navNoteId: 'r1', navNoteKey: 1 });
    expect(otherRoutineVisible(component)).toBe(true);

    switchTo(component, 'Deload');
    switchTo(component, 'Routine');
    expect(otherRoutineVisible(component)).toBe(true);
  });

  test('the Deload Week card keeps its disclosure state across Deload→Routine→Deload', () => {
    const component = mount();
    switchTo(component, 'Deload');
    expect(deloadExpanded(component)).toBe(true);

    render.act(() => { deloadToggle(component).props.onPress(); });
    expect(deloadExpanded(component)).toBe(false);

    switchTo(component, 'Routine');
    switchTo(component, 'Deload');
    expect(deloadExpanded(component)).toBe(false);
  });

  test('a deload-note handoff does not disturb More Routines, which owns none of its notes', () => {
    const component = mount({ navNoteId: 'd1', navNoteKey: 1 });
    // The intent switched the screen to the view that owns the note.
    expect(hasText(component, 'More Routines')).toBe(false);

    switchTo(component, 'Routine');
    // #1021: More Routines always lists its non-current cards regardless.
    expect(otherRoutineVisible(component)).toBe(true);
  });
});

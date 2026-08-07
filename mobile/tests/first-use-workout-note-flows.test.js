// First-use workout-note flows (#748; design contract in #745 Parts 3–6).
//
// The verification set is Part 3 §7 plus Part 4's and Part 6's additions. The
// adoption paths P1–P6 in Part 6's table are covered one test each: the
// guarantee under test is that ADOPTION is atomic — `currentId` changes only
// inside `doSwitch` — NOT that "nothing is written". Note-content writes from
// the debounced autosave or from `Save & Switch` may legitimately land during
// an abandoned attempt and are retained, never reverted.

import React from 'react';
import render from 'react-test-renderer';
import { Alert } from '../lib/platformAlert';
import { LogScreen } from '../screens/LogScreen';
import { LogEmptyState } from '../components/LogEmptyState';
import {
  WORKOUT_SYNTAX_EXAMPLE_TEXT,
  WORKOUT_SYNTAX_ROW_EXPLANATIONS,
} from '../components/WorkoutSyntaxReference';
import { parseWorkoutNote } from '../lib/parser';
import * as useEntries from '../hooks/useEntries';
import {
  FIRST_USE_UNKNOWN,
  FIRST_USE_S0,
  FIRST_USE_S1,
  FIRST_USE_S2,
  FIRST_USE_S3,
  applySessionAutofill,
  buildSessionAutofillPlan,
  buildSessionAutofillSuggestion,
  composeScaffoldText,
  deriveFirstUseState,
  formatSetsAsRow,
  listAutofillDayGroups,
  pickAdoptableRoutine,
  pickDefaultDayGroup,
  selectRoutineNotes,
  verifyScaffold,
} from '../lib/guidedEntry';

jest.mock('expo-updates', () => ({
  useUpdates: () => ({ currentlyRunning: { isEmbeddedLaunch: true } }),
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
  reloadAsync: jest.fn(),
}));

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map();
  return {
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

// ── Rendering helpers ──────────────────────────────────────────────────────

const findPressableByText = (root, text) => {
  const matches = root.findAll(n => {
    if (n.type !== 'Text') return false;
    const children = n.props.children;
    const flat = Array.isArray(children) ? children.join('') : String(children ?? '');
    return flat.includes(text);
  });
  for (const match of matches) {
    let node = match.parent;
    while (node) {
      if (node.props && typeof node.props.onPress === 'function') return node;
      node = node.parent;
    }
  }
  return null;
};

const hasText = (root, text) => root.findAll(n => {
  if (n.type !== 'Text') return false;
  const children = n.props.children;
  const flat = Array.isArray(children) ? children.join('') : String(children ?? '');
  return flat.includes(text);
}).length > 0;

const expandRoutineManagement = (root) => {
  const header = root.findAll(
    n => n.props
      && (n.props.accessibilityLabel === 'Expand routine management'
        || n.props.accessibilityLabel === 'Collapse routine management')
      && typeof n.props.onPress === 'function'
  )[0];
  if (!header) return;
  if (header.props.accessibilityState && header.props.accessibilityState.expanded) return;
  render.act(() => { header.props.onPress(); });
};

const titleInput = (root) =>
  root.findAll(n => n.props && n.props.placeholder === 'Routine Name (e.g. Push Day)')[0];
const bodyInput = (root) =>
  root.findAll(n => n.props && n.props.multiline === true && typeof n.props.onChangeText === 'function')[0];

function Harness(props) {
  const [text, setText] = React.useState(props.initialText ?? '');
  const [title, setTitle] = React.useState(props.initialTitle ?? '');
  return (
    <LogScreen
      workoutNoteText={text}
      setWorkoutNoteText={setText}
      workoutNoteTitle={title}
      setWorkoutNoteTitle={setTitle}
      isCollapsed={false}
      toggleCollapsed={jest.fn()}
      onSaveWorkout={jest.fn()}
      deloadDateEditEnabled={false}
      onCheckInPrompt={jest.fn()}
      isActive
      {...props}
    />
  );
}

// A stateful notes mock. `selectCurrent` is the ONLY thing that may move
// `currentId`, so every adoption assertion below can simply count its calls.
function mockWorkoutNotes({
  initialNotes = [],
  initialCurrentId = null,
  loading = false,
  error = null,
  selectCurrentImpl,
} = {}) {
  const calls = { add: [], update: [], selectCurrent: [], remove: [], control: { failUpdate: false } };
  let seq = 0;
  useEntries.useWorkoutNotes.mockImplementation(() => {
    const [notes, setNotes] = React.useState(initialNotes);
    const [currentId, setCurrentId] = React.useState(initialCurrentId);
    const add = React.useCallback(async (title, raw_text = '') => {
      seq += 1;
      const note = { id: `added${seq}`, title, raw_text, saved_at: `2026-08-0${seq}T12:00:00.000Z` };
      calls.add.push({ title, raw_text, id: note.id });
      setNotes(prev => [...prev, note]);
      return note;
    }, []);
    const update = React.useCallback(async (id, patch) => {
      calls.update.push({ id, patch });
      if (calls.control.failUpdate) return false;
      let updated = null;
      setNotes(prev => prev.map(n => {
        if (n.id !== id) return n;
        updated = { ...n, ...patch };
        return updated;
      }));
      const found = notes.find(n => n.id === id);
      return found ? { ...found, ...patch } : false;
    }, [notes]);
    const selectCurrent = React.useCallback(async (id) => {
      calls.selectCurrent.push(id);
      if (selectCurrentImpl) await selectCurrentImpl(id);
      setCurrentId(id);
    }, []);
    const remove = React.useCallback(async (id) => {
      calls.remove.push(id);
      setNotes(prev => prev.filter(n => n.id !== id));
    }, []);
    return {
      notes,
      currentId,
      currentNote: notes.find(n => n.id === currentId) || null,
      deloadNotes: [],
      loading,
      error,
      refresh: jest.fn(),
      selectCurrent,
      update,
      add,
      remove,
    };
  });
  return calls;
}

function mockSupportingHooks() {
  useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: [], toggle: jest.fn() });
  useEntries.useDeloadNote.mockReturnValue({ note: null, loading: false, save: jest.fn(), clear: jest.fn() });
  useEntries.useDeloadHistory.mockReturnValue({
    history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
  });
  useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: false });
}

const promptCount = (root) =>
  root.findAll(n => n.props && n.props.testID === 'routine-adoption-prompt').length;

// Drives the editor to a saved brand-new routine, which is the only thing that
// raises the post-save adoption prompt. Both create-routine entry points open
// the guided scaffold sheet; its mandatory plain-text escape lands in the
// ordinary `editingNoteId === 'new'` editor.
const openNewRoutineEditor = (root) => {
  expandRoutineManagement(root);
  const entry = findPressableByText(root, '+ New routine') || findPressableByText(root, 'New Routine');
  render.act(() => { entry.props.onPress(); });
  render.act(() => { findPressableByText(root, 'Write it as text instead').props.onPress(); });
};

const saveNewRoutine = async (root, { title, text }) => {
  render.act(() => { titleInput(root).props.onChangeText(title); });
  render.act(() => { bodyInput(root).props.onChangeText(text); });
  await render.act(async () => { await findPressableByText(root, 'Save').props.onPress(); });
};

// ── State machine (Part 3 §1) ──────────────────────────────────────────────

describe('first-use state derivation (#745 Part 3 §1)', () => {
  const base = { notes: [], currentId: null, notesLoading: false, notesError: null, activeSessionCount: 0 };

  test('an unresolved or failed read is UNKNOWN, never S0 — emptiness is only emptiness after a successful read', () => {
    expect(deriveFirstUseState({ ...base, notesLoading: true })).toBe(FIRST_USE_UNKNOWN);
    expect(deriveFirstUseState({ ...base, notesError: new Error('nope') })).toBe(FIRST_USE_UNKNOWN);
    // Same failed read, with stale notes still in hand: still UNKNOWN.
    expect(deriveFirstUseState({
      ...base, notesError: new Error('nope'), notes: [{ id: 'a', title: 'A' }], currentId: 'a', activeSessionCount: 4,
    })).toBe(FIRST_USE_UNKNOWN);
  });

  test('S0 is no routines at all', () => {
    expect(deriveFirstUseState(base)).toBe(FIRST_USE_S0);
  });

  test('deload records are not routines, so a deload note alone is still S0', () => {
    const notes = [{ id: 'd1', title: 'Deload · 2026-08-01' }];
    expect(selectRoutineNotes(notes)).toEqual([]);
    expect(deriveFirstUseState({ ...base, notes })).toBe(FIRST_USE_S0);
  });

  test('S1 is a routine that is not current — the state F1 dumps every new tester into', () => {
    expect(deriveFirstUseState({ ...base, notes: [{ id: 'a', title: 'A' }] })).toBe(FIRST_USE_S1);
  });

  test('S1 also covers a current routine with no logged session (finding F7)', () => {
    expect(deriveFirstUseState({
      ...base, notes: [{ id: 'a', title: 'A' }], currentId: 'a', activeSessionCount: 0,
    })).toBe(FIRST_USE_S1);
  });

  test('S2 is exactly one session, S3 is two or more', () => {
    const withCurrent = { ...base, notes: [{ id: 'a', title: 'A' }], currentId: 'a' };
    expect(deriveFirstUseState({ ...withCurrent, activeSessionCount: 1 })).toBe(FIRST_USE_S2);
    expect(deriveFirstUseState({ ...withCurrent, activeSessionCount: 2 })).toBe(FIRST_USE_S3);
    expect(deriveFirstUseState({ ...withCurrent, activeSessionCount: 9 })).toBe(FIRST_USE_S3);
  });

  test('the state degrades backwards when data is deleted — it is a pure function of data, not a stored flag', () => {
    const populated = {
      ...base, notes: [{ id: 'a', title: 'A' }], currentId: 'a', activeSessionCount: 5,
    };
    expect(deriveFirstUseState(populated)).toBe(FIRST_USE_S3);
    expect(deriveFirstUseState({ ...populated, notes: [], currentId: null, activeSessionCount: 0 })).toBe(FIRST_USE_S0);
  });

  test('the S1 card offers the most recently saved non-current routine', () => {
    const notes = [
      { id: 'old', title: 'Old', saved_at: '2026-01-01T00:00:00.000Z' },
      { id: 'new', title: 'New', saved_at: '2026-08-01T00:00:00.000Z' },
      { id: 'deload', title: 'Deload · 2026-08-02', saved_at: '2026-08-02T00:00:00.000Z' },
    ];
    expect(pickAdoptableRoutine(notes, null).id).toBe('new');
    expect(pickAdoptableRoutine(notes, 'new').id).toBe('old');
    expect(pickAdoptableRoutine([], null)).toBeNull();
  });
});

// ── Scaffold autofill (Part 3 §3.1 as amended by Part 4) ───────────────────

describe('guided routine scaffold (#745 Part 3 §3.1)', () => {
  test('composes a day line plus one dash header per exercise, and NO set rows', () => {
    const text = composeScaffoldText({ dayLabel: 'Monday', exerciseNames: ['Bench Press', 'Squat'] });
    expect(text).toBe('Monday\n-Bench Press\n-Squat');
    // The app has no basis for a weight or a rep count, so it invents neither.
    expect(text).not.toMatch(/\d/);
  });

  test('round-trips through the real parser: names-only is a valid note with zero sessions', () => {
    const v = verifyScaffold({ dayLabel: 'Monday', exerciseNames: ['Bench Press', 'Squat'] });
    expect(v.ok).toBe(true);
    const parsed = parseWorkoutNote(v.text);
    expect(parsed.ok).toBe(true);
    const exercises = parsed.sections.flatMap(s => s.exercises);
    expect(exercises.map(e => e.name)).toEqual(['Bench Press', 'Squat']);
    expect(exercises.every(e => e.unparsed_rows.length === 0)).toBe(true);
    expect(exercises.every(e => e.session_entries.length === 0)).toBe(true);
  });

  test('day-less composition omits the heading line entirely', () => {
    expect(composeScaffoldText({ dayLabel: '', exerciseNames: ['Squat'] })).toBe('-Squat');
    expect(verifyScaffold({ dayLabel: '   ', exerciseNames: ['Squat'] }).ok).toBe(true);
  });

  test('names are inserted verbatim — duplicates, unicode, and very long names all survive', () => {
    const long = 'Incline Dumbbell Bench Press With A Very Long Descriptive Name Indeed';
    const v = verifyScaffold({ dayLabel: '', exerciseNames: ['Squat', 'Squat', 'Übungen für Rücken', long] });
    expect(v.ok).toBe(true);
    expect(v.text).toBe(`-Squat\n-Squat\n-Übungen für Rücken\n-${long}`);
    const names = parseWorkoutNote(v.text).sections.flatMap(s => s.exercises).map(e => e.name);
    expect(names).toEqual(['Squat', 'Squat', 'Übungen für Rücken', long]);
  });

  test('empty and whitespace-only names are dropped, and at least one is required', () => {
    expect(verifyScaffold({ dayLabel: 'Monday', exerciseNames: ['', '   '] }).ok).toBe(false);
    expect(verifyScaffold({ dayLabel: 'Monday', exerciseNames: [] }).reason).toMatch(/at least one/i);
    const v = verifyScaffold({ dayLabel: '', exerciseNames: ['', 'Squat', '  '] });
    expect(v.ok).toBe(true);
    expect(v.text).toBe('-Squat');
  });

  test('a name the parser cannot read back as an exercise blocks Save and names the offending row', () => {
    // "-230 5" is a missing-space SET row to the parser, not a header — with no
    // exercise to attach it to the note is rejected outright.
    const v = verifyScaffold({ dayLabel: '', exerciseNames: ['230 5'] });
    expect(v.ok).toBe(false);
    expect(v.reason).toBeTruthy();
    expect(v.nameErrors[0]).toBe(v.reason);
  });

  test('a day label the parser reads as an exercise is caught by the count check', () => {
    // "1. Warmup" is a numbered EXERCISE header to the parser, so the composed
    // note would hold two exercises for one entered name. Save stays disabled
    // rather than storing a note that does not mean what the sheet showed.
    const v = verifyScaffold({ dayLabel: '1. Warmup', exerciseNames: ['Squat'] });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/read back/i);
  });
});

// ── Session autofill (Part 3 §3.2) ─────────────────────────────────────────

describe('session autofill composition (#745 Part 3 §3.2)', () => {
  const NOTE = [
    'Monday',
    '+Lifting',
    '-Bench',
    '135 5,5,5',
    '140 5,5 *PR - RPE 9',
    '-Squat',
    '225 5,5,5',
    '230 5,5',
    'Tuesday',
    '-Row',
    '100 8,8',
  ].join('\n');

  test('day headings are listed, and a single group needs no picker', () => {
    expect(listAutofillDayGroups(NOTE).map(g => g.label)).toEqual(['Monday', 'Tuesday']);
    const single = listAutofillDayGroups('-Bench\n135 5,5');
    expect(single).toHaveLength(1);
    expect(pickDefaultDayGroup(single)).toBe(0);
  });

  test('today pre-selects a matching heading, and nothing is pre-selected when none matches', () => {
    const groups = listAutofillDayGroups(NOTE);
    // 2026-08-03 is a Monday.
    expect(pickDefaultDayGroup(groups, new Date(2026, 7, 3))).toBe(0);
    expect(pickDefaultDayGroup(groups, new Date(2026, 7, 4))).toBe(1); // Tuesday
    // Wednesday matches neither heading: the app never guesses the day.
    expect(pickDefaultDayGroup(groups, new Date(2026, 7, 5))).toBeNull();
  });

  test('marks and inline prose tails are never carried forward', () => {
    const plan = buildSessionAutofillPlan({ activeText: NOTE, dayGroupIndex: 0 });
    expect(plan.ok).toBe(true);
    const bench = plan.included.find(i => i.name === 'Bench');
    // Source row was `140 5,5 *PR - RPE 9`; re-emitted canonically from sets.
    expect(bench.line).toBe('140 5,5');
    expect(bench.line).not.toContain('*');
    expect(bench.line).not.toContain('RPE');
  });

  test('only the selected day group is touched; the rest of the note is preserved byte for byte', () => {
    const s = buildSessionAutofillSuggestion({ activeText: NOTE, dayGroupIndex: 0, excludedNames: [] });
    expect(s.ok).toBe(true);
    expect(s.nextText).toBe([
      'Monday', '+Lifting', '-Bench', '135 5,5,5', '140 5,5 *PR - RPE 9', '140 5,5',
      '-Squat', '225 5,5,5', '230 5,5', '230 5,5',
      'Tuesday', '-Row', '100 8,8',
    ].join('\n'));
    // Tuesday's block is unchanged.
    expect(s.nextText.split('Tuesday')[1]).toBe('\n-Row\n100 8,8');
  });

  test('an exercise behind the day-group max is excluded and says why', () => {
    const text = '-Pullup\n12,12\n10,10\n-Dip\n15,15';
    const plan = buildSessionAutofillPlan({ activeText: text, dayGroupIndex: 0 });
    expect(plan.included.map(i => i.name)).toEqual(['Pullup']);
    expect(plan.excluded).toEqual([{ name: 'Dip', reason: 'Behind by 1 session — not included' }]);
    // The reason is text, not a color.
    expect(plan.excluded[0].reason).toMatch(/not included/);
  });

  test('bodyweight rows re-emit as a reps-only group', () => {
    expect(formatSetsAsRow(parseWorkoutNote('-Pullup\n12,12').sections[0].exercises[0].session_entries[0].sets))
      .toBe('12,12');
  });

  test('a skipped set inside an otherwise valid row is carried as logged', () => {
    const text = '-Bench\n80 4,-';
    const plan = buildSessionAutofillPlan({ activeText: text, dayGroupIndex: 0 });
    expect(plan.included[0].line).toBe('80 4,-');
  });

  test('an exercise whose last entry is a skip falls back to nothing and is excluded with its reason', () => {
    const text = '-Bench\n-\n-Squat\n225 5,5';
    const plan = buildSessionAutofillPlan({ activeText: text, dayGroupIndex: 0 });
    expect(plan.included.map(i => i.name)).toEqual(['Squat']);
    expect(plan.excluded[0].name).toBe('Bench');
    expect(plan.excluded[0].reason).toMatch(/skipped or could not be read/);
  });

  test('a day group with no logged sessions makes autofill unavailable', () => {
    const plan = buildSessionAutofillPlan({ activeText: 'Monday\n-Bench\n-Squat', dayGroupIndex: 0 });
    expect(plan.ok).toBe(false);
    expect(plan.reason).toMatch(/no logged sessions/i);
  });

  test('excluding every candidate withholds the suggestion rather than writing nothing silently', () => {
    const s = buildSessionAutofillSuggestion({ activeText: NOTE, dayGroupIndex: 0, excludedNames: ['Bench', 'Squat'] });
    expect(s.ok).toBe(false);
    expect(s.reason).toMatch(/select at least one/i);
  });

  test('the composed text is re-parsed and verified: every included exercise gains exactly one entry', () => {
    const before = parseWorkoutNote(NOTE).sections.flatMap(s => s.exercises);
    const s = buildSessionAutofillSuggestion({ activeText: NOTE, dayGroupIndex: 0, excludedNames: ['Squat'] });
    const after = parseWorkoutNote(s.nextText).sections.flatMap(e => e.exercises);
    expect(after.map(e => e.name)).toEqual(before.map(e => e.name));
    const deltas = after.map((e, i) => e.session_entries.length - before[i].session_entries.length);
    expect(deltas).toEqual([1, 0, 0]); // Bench only
    expect(after.every(e => e.unparsed_rows.length === 0)).toBe(true);
  });

  test('applySessionAutofill preserves blank lines and inserts after the exercise block, not at its end', () => {
    const text = '-Bench\n135 5,5\n\n-Squat\n225 5,5\n';
    const next = applySessionAutofill(text, [{ occurrence: 0, line: '140 5,5' }]);
    expect(next).toBe('-Bench\n135 5,5\n140 5,5\n\n-Squat\n225 5,5\n');
  });

  test('an A/B note is handled a slice at a time — the separator is a hard boundary', () => {
    const groups = listAutofillDayGroups('Monday\n-Bench\n135 5,5');
    expect(groups).toHaveLength(1);
    // The caller passes only the active slice, so the other week is never seen.
    const s = buildSessionAutofillSuggestion({ activeText: 'Monday\n-Bench\n135 5,5', dayGroupIndex: 0, excludedNames: [] });
    expect(s.nextText).toBe('Monday\n-Bench\n135 5,5\n135 5,5');
  });
});

// ── Adoption: the F1/F2/F3 chain ───────────────────────────────────────────

describe('post-save adoption prompt (#745 Part 4 §A1)', () => {
  let alertSpy;
  beforeEach(() => {
    jest.clearAllMocks();
    mockSupportingHooks();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });
  afterEach(() => alertSpy.mockRestore());

  test('saving a routine writes only the note — it never adopts, and the prompt offers the choice', async () => {
    const calls = mockWorkoutNotes({ initialNotes: [], initialCurrentId: null });
    let component;
    render.act(() => { component = render.create(<Harness />); });
    const root = component.root;
    openNewRoutineEditor(root);
    await saveNewRoutine(root, { title: 'Push Day', text: 'Monday\n-Bench' });

    expect(calls.add).toHaveLength(1);
    expect(calls.add[0]).toMatchObject({ title: 'Push Day', raw_text: 'Monday\n-Bench' });
    // The decisive assertion: saving did NOT change which routine is current.
    expect(calls.selectCurrent).toHaveLength(0);
    expect(promptCount(root)).toBeGreaterThan(0);
    expect(hasText(root, 'Routine saved.')).toBe(true);
    expect(findPressableByText(root, 'Use as current')).toBeTruthy();
    expect(findPressableByText(root, 'Not now')).toBeTruthy();
  });

  test('the prompt is announced politely and both actions carry unique 44dp targets naming the routine', async () => {
    mockWorkoutNotes({ initialNotes: [], initialCurrentId: null });
    let component;
    render.act(() => { component = render.create(<Harness />); });
    const root = component.root;
    openNewRoutineEditor(root);
    await saveNewRoutine(root, { title: 'Push Day', text: 'Monday\n-Bench' });

    const prompt = root.findAll(n => n.props && n.props.testID === 'routine-adoption-prompt')[0];
    expect(prompt.props.accessibilityLiveRegion).toBe('polite');
    const labels = root.findAll(n => n.props && n.props.accessibilityRole === 'button' && n.props.accessibilityLabel)
      .map(n => n.props.accessibilityLabel);
    expect(labels).toContain('Use Push Day as your current routine');
    expect(labels).toContain('Not now — keep Push Day saved without making it current');
    const primary = findPressableByText(root, 'Use as current');
    const flat = [].concat(primary.props.style).filter(Boolean);
    expect(flat.some(s => s && s.minHeight === 44)).toBe(true);
  });

  test('with no current routine, Use as current adopts directly — no false analytics warning', async () => {
    const calls = mockWorkoutNotes({ initialNotes: [], initialCurrentId: null });
    let component;
    render.act(() => { component = render.create(<Harness />); });
    const root = component.root;
    openNewRoutineEditor(root);
    await saveNewRoutine(root, { title: 'Push Day', text: 'Monday\n-Bench' });

    await render.act(async () => { await findPressableByText(root, 'Use as current').props.onPress(); });

    expect(calls.selectCurrent).toEqual(['added1']);
    // F2: none of the switch-warning copy fires when there is nothing to switch
    // from, no logged session, and no analytics.
    expect(alertSpy).not.toHaveBeenCalled();
    expect(promptCount(root)).toBe(0);
  });

  test('Not now writes nothing at all and leaves the routine adoptable from the S1 card', async () => {
    const calls = mockWorkoutNotes({ initialNotes: [], initialCurrentId: null });
    let component;
    render.act(() => { component = render.create(<Harness />); });
    const root = component.root;
    openNewRoutineEditor(root);
    await saveNewRoutine(root, { title: 'Push Day', text: 'Monday\n-Bench' });

    const updatesBefore = calls.update.length;
    render.act(() => { findPressableByText(root, 'Not now').props.onPress(); });

    expect(calls.selectCurrent).toHaveLength(0);
    expect(calls.update).toHaveLength(updatesBefore); // no dismissal flag, no cleanup write
    expect(calls.add).toHaveLength(1);
    expect(promptCount(root)).toBe(0);

    // C1: `Not now` lands exactly in F1's state, so the S1 card must be there.
    render.act(() => { findPressableByText(root, 'Done').props.onPress(); });
    expect(hasText(root, 'Start logging this routine')).toBe(true);
    expect(findPressableByText(root, 'Use this routine')).toBeTruthy();
  });

  test('a failed selectCurrent keeps the saved note, states the failure, and retries the switch only', async () => {
    let fail = true;
    const calls = mockWorkoutNotes({
      initialNotes: [], initialCurrentId: null,
      selectCurrentImpl: async () => { if (fail) { fail = false; throw new Error('offline'); } },
    });
    let component;
    render.act(() => { component = render.create(<Harness />); });
    const root = component.root;
    openNewRoutineEditor(root);
    await saveNewRoutine(root, { title: 'Push Day', text: 'Monday\n-Bench' });

    await render.act(async () => { await findPressableByText(root, 'Use as current').props.onPress(); });

    expect(calls.remove).toHaveLength(0); // the note is never deleted to tidy state
    expect(hasText(root, 'Could not make this your current routine')).toBe(true);
    expect(promptCount(root)).toBeGreaterThan(0);

    await render.act(async () => { await findPressableByText(root, 'Try again').props.onPress(); });
    expect(calls.selectCurrent).toEqual(['added1', 'added1']);
    expect(calls.add).toHaveLength(1); // the retry calls selectCurrent only
  });

  test('no inert Set as current routine control is shown for an unsaved routine (F3)', async () => {
    mockWorkoutNotes({ initialNotes: [], initialCurrentId: null });
    let component;
    render.act(() => { component = render.create(<Harness />); });
    const root = component.root;
    openNewRoutineEditor(root);
    render.act(() => { titleInput(root).props.onChangeText('Push Day'); });

    expect(findPressableByText(root, 'Set as current routine')).toBeNull();

    // It returns once the routine actually exists to switch to.
    await saveNewRoutine(root, { title: 'Push Day', text: 'Monday\n-Bench' });
    expect(findPressableByText(root, 'Set as current routine')).toBeTruthy();
  });

  test('an adoption attempt for a routine that is not saved is never a silent no-op', () => {
    mockWorkoutNotes({ initialNotes: [{ id: 'r1', title: 'R1', raw_text: '-Bench\n135 5,5' }], initialCurrentId: 'r1' });
    let component;
    render.act(() => { component = render.create(<Harness />); });
    let hook;
    // Reach the handler the way LogPreviousRoutines does, with an id that has
    // no note behind it.
    const card = component.root.findAll(n => typeof n.props?.handleSwitchCurrent === 'function')[0];
    hook = card.props.handleSwitchCurrent;
    render.act(() => { hook('new'); });
    expect(alertSpy).toHaveBeenCalledWith('Could not set current routine', expect.stringContaining('not saved yet'));
  });
});

// ── Adoption over an existing current routine: Part 6's P1–P6 ──────────────

describe('adoption while another routine is current — P1–P6 (#745 Part 6 §A1.1)', () => {
  let alertSpy;
  const CURRENT = { id: 'cur1', title: 'Current', raw_text: 'Monday\n-Bench\n135 5,5,5', saved_at: '2026-01-01T00:00:00.000Z' };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupportingHooks();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });
  afterEach(() => alertSpy.mockRestore());

  // Saves a new routine whose exercise name MATCHES the current routine's, so
  // `confirmSwitch` opens the `Keep current progress?` rollover alert and a
  // post-confirmation cancel window actually exists.
  const setup = async ({ matching = true } = {}) => {
    const calls = mockWorkoutNotes({ initialNotes: [CURRENT], initialCurrentId: 'cur1' });
    let component;
    render.act(() => { component = render.create(<Harness initialText={CURRENT.raw_text} initialTitle="Current" />); });
    const root = component.root;
    openNewRoutineEditor(root);
    await saveNewRoutine(root, {
      title: 'Backlog',
      text: matching ? 'Monday\n-Bench\n185 3,3' : 'Monday\n-Deadlift\n315 3,3',
    });
    return { calls, root };
  };

  const promptShown = (root) => promptCount(root) > 0;
  const buttonsOf = (call) => call[2] || [];

  test('the prompt names the replacement explicitly when a current routine already exists', async () => {
    const { root } = await setup();
    expect(hasText(root, 'instead of the one you have now')).toBe(true);
  });

  test('P1 — no unsaved edits, Cancel: no write of any kind, prompt remains and is re-pressable', async () => {
    const { calls, root } = await setup();
    const updatesBefore = calls.update.length;
    const addsBefore = calls.add.length;

    render.act(() => { findPressableByText(root, 'Use as current').props.onPress(); });
    const call = alertSpy.mock.calls.at(-1);
    expect(call[0]).toBe('Set as current routine');
    expect(call[1]).toMatch(/will affect your analytics/);
    const cancel = buttonsOf(call).find(b => b.text === 'Cancel');
    expect(cancel.onPress).toBeUndefined(); // cancelling is literally a no-op

    expect(calls.selectCurrent).toHaveLength(0);
    expect(calls.update).toHaveLength(updatesBefore);
    expect(calls.add).toHaveLength(addsBefore);
    expect(promptShown(root)).toBe(true);

    // Cancelling declines THIS attempt, not the offer.
    render.act(() => { findPressableByText(root, 'Use as current').props.onPress(); });
    expect(alertSpy.mock.calls.at(-1)[0]).toBe('Set as current routine');
  });

  test('P2 — no unsaved edits, confirm, then the rollover alert is dismissed: no adoption, no rollover', async () => {
    const { calls, root } = await setup();
    const updatesBefore = calls.update.length;

    render.act(() => { findPressableByText(root, 'Use as current').props.onPress(); });
    const confirm = buttonsOf(alertSpy.mock.calls.at(-1)).find(b => b.text === 'Set as current routine');
    render.act(() => { confirm.onPress(); });

    // The rollover alert is open; dismissing it means answering neither button.
    const rollover = alertSpy.mock.calls.at(-1);
    expect(rollover[0]).toBe('Keep current progress?');
    expect(buttonsOf(rollover).map(b => b.text)).toEqual(['No', 'Yes']);

    expect(calls.selectCurrent).toHaveLength(0);
    expect(calls.update).toHaveLength(updatesBefore); // no 1K rollover write
    expect(promptShown(root)).toBe(true);
  });

  test('P3 — unsaved edits, Cancel: currentId unchanged and no rollover, whatever autosave did', async () => {
    const { calls, root } = await setup();
    render.act(() => { bodyInput(root).props.onChangeText('Monday\n-Bench\n185 3,3\n190 3,3'); });

    render.act(() => { findPressableByText(root, 'Use as current').props.onPress(); });
    const call = alertSpy.mock.calls.at(-1);
    expect(call[1]).toMatch(/unsaved changes/);
    const cancel = buttonsOf(call).find(b => b.text === 'Cancel');
    expect(cancel.onPress).toBeUndefined();

    expect(calls.selectCurrent).toHaveLength(0);
    expect(calls.update.some(u => u.patch && u.patch.one_k_exercises)).toBe(false);
    expect(promptShown(root)).toBe(true);
  });

  test('P4 — unsaved edits, Switch Anyway, rollover dismissed: no adoption, draft still in the editor', async () => {
    const { calls, root } = await setup();
    render.act(() => { bodyInput(root).props.onChangeText('Monday\n-Bench\n185 3,3\n190 3,3'); });

    render.act(() => { findPressableByText(root, 'Use as current').props.onPress(); });
    const anyway = buttonsOf(alertSpy.mock.calls.at(-1)).find(b => b.text === 'Switch Anyway');
    render.act(() => { anyway.onPress(); });

    expect(alertSpy.mock.calls.at(-1)[0]).toBe('Keep current progress?');
    expect(calls.selectCurrent).toHaveLength(0);
    expect(calls.update.some(u => u.patch && u.patch.one_k_exercises)).toBe(false);
    expect(promptShown(root)).toBe(true);
    expect(bodyInput(root).props.value).toBe('Monday\n-Bench\n185 3,3\n190 3,3');
  });

  test('P5 — Save & Switch succeeds, rollover dismissed: the edits are RETAINED, never reverted, and no adoption happens', async () => {
    const { calls, root } = await setup();
    const edited = 'Monday\n-Bench\n185 3,3\n190 3,3';
    render.act(() => { bodyInput(root).props.onChangeText(edited); });

    render.act(() => { findPressableByText(root, 'Use as current').props.onPress(); });
    const saveAndSwitch = buttonsOf(alertSpy.mock.calls.at(-1)).find(b => b.text === 'Save & Switch');
    await render.act(async () => { await saveAndSwitch.onPress(); });

    // The explicit note-content write the user asked for landed and stays.
    const contentWrites = calls.update.filter(u => u.id === 'added1' && u.patch && u.patch.raw_text);
    expect(contentWrites.at(-1).patch.raw_text).toBe(edited);
    expect(calls.update.some(u => u.patch && u.patch.raw_text === 'Monday\n-Bench\n185 3,3')).toBe(false); // never reverted

    // The switch half did not complete.
    expect(alertSpy.mock.calls.at(-1)[0]).toBe('Keep current progress?');
    expect(calls.selectCurrent).toHaveLength(0);
    expect(calls.update.some(u => u.patch && u.patch.one_k_exercises)).toBe(false);
    expect(promptShown(root)).toBe(true);

    // Pressing it again re-attempts only the switch, and completing it adopts.
    render.act(() => { findPressableByText(root, 'Use as current').props.onPress(); });
    const again = alertSpy.mock.calls.at(-1);
    const confirmAgain = buttonsOf(again).find(b => b.text === 'Set as current routine' || b.text === 'Switch Anyway');
    render.act(() => { confirmAgain.onPress(); });
    const rollover2 = buttonsOf(alertSpy.mock.calls.at(-1)).find(b => b.text === 'No');
    await render.act(async () => { await rollover2.onPress(); });
    expect(calls.selectCurrent).toEqual(['added1']);
  });

  test('P6 — Save & Switch where the save fails: no switch attempted, and the failure is a save error, not a cancellation', async () => {
    const { calls, root } = await setup();
    render.act(() => { bodyInput(root).props.onChangeText('Monday\n-Bench\n185 3,3\n190 3,3'); });

    render.act(() => { findPressableByText(root, 'Use as current').props.onPress(); });
    const buttons = buttonsOf(alertSpy.mock.calls.at(-1));
    expect(buttons.map(b => b.text)).toEqual(['Cancel', 'Switch Anyway', 'Save & Switch']);

    // The pre-switch save now fails, so `confirmSwitch` never runs.
    calls.control.failUpdate = true;
    const alertsBefore = alertSpy.mock.calls.length;
    const saveAndSwitch = buttons.find(b => b.text === 'Save & Switch');
    await render.act(async () => { await saveAndSwitch.onPress(); });

    expect(alertSpy.mock.calls.length).toBe(alertsBefore); // no rollover alert
    expect(calls.selectCurrent).toHaveLength(0);
    expect(promptShown(root)).toBe(true);
    // A save failure is the app's failure, not the user's decision, and reads
    // as one.
    expect(hasText(root, 'Save failed')).toBe(true);
  });

  test('non-matching exercise names complete adoption with no second alert, so no post-save cancel window exists', async () => {
    const { calls, root } = await setup({ matching: false });
    render.act(() => { findPressableByText(root, 'Use as current').props.onPress(); });
    const confirm = buttonsOf(alertSpy.mock.calls.at(-1)).find(b => b.text === 'Set as current routine');
    await render.act(async () => { await confirm.onPress(); });

    expect(alertSpy.mock.calls.at(-1)[0]).toBe('Set as current routine'); // no rollover alert followed
    expect(calls.selectCurrent).toEqual(['added1']);
    expect(promptShown(root)).toBe(false);
  });
});

// ── S1 / S2 rendering from verified reads ──────────────────────────────────

describe('S1 and S2 surfaces render only from a verified read', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSupportingHooks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  test('S1 names the routine and adopts it in one press, with no switch-warning copy', async () => {
    const calls = mockWorkoutNotes({
      initialNotes: [{ id: 'r1', title: 'Push Day', raw_text: 'Monday\n-Bench', saved_at: '2026-08-01T00:00:00.000Z' }],
      initialCurrentId: null,
    });
    let component;
    render.act(() => { component = render.create(<Harness />); });
    const root = component.root;

    expect(hasText(root, 'Start logging this routine')).toBe(true);
    expect(hasText(root, 'Push Day')).toBe(true);
    await render.act(async () => { await findPressableByText(root, 'Use this routine').props.onPress(); });
    expect(calls.selectCurrent).toEqual(['r1']);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  test('a failed notes read shows neither the S1 card nor any guided surface (#737 gate)', () => {
    mockWorkoutNotes({
      initialNotes: [{ id: 'r1', title: 'Push Day', raw_text: 'Monday\n-Bench' }],
      initialCurrentId: null,
      error: new Error('offline'),
    });
    let component;
    render.act(() => { component = render.create(<Harness />); });
    expect(hasText(component.root, 'Start logging this routine')).toBe(false);
    expect(hasText(component.root, 'Could not load workout notes.')).toBe(true);
  });

  test('S2 teaches the session rule and the real Track control name, once', () => {
    const note = { id: 'r1', title: 'Push Day', raw_text: 'Monday\n-Bench\n135 5,5,5' };
    mockWorkoutNotes({ initialNotes: [note], initialCurrentId: 'r1' });
    let component;
    render.act(() => { component = render.create(<Harness initialText={note.raw_text} initialTitle="Push Day" />); });
    expect(hasText(component.root, 'One session logged')).toBe(true);
    expect(hasText(component.root, 'Each new line under an exercise is a new session')).toBe(true);
    expect(hasText(component.root, 'tap Track on that exercise')).toBe(true);
  });

  test('S3 shows no repeated guidance', () => {
    const note = { id: 'r1', title: 'Push Day', raw_text: 'Monday\n-Bench\n135 5,5,5\n140 5,5' };
    mockWorkoutNotes({ initialNotes: [note], initialCurrentId: 'r1' });
    let component;
    render.act(() => { component = render.create(<Harness initialText={note.raw_text} initialTitle="Push Day" />); });
    expect(hasText(component.root, 'One session logged')).toBe(false);
    expect(hasText(component.root, 'Start logging this routine')).toBe(false);
  });
});

// ── Teaching copy (F4/F5/F8) ───────────────────────────────────────────────

describe('truthful teaching copy', () => {
  test('the Log empty state renders the SHARED example and the full shared explanation set', () => {
    let component;
    render.act(() => { component = render.create(<LogEmptyState onCreateRoutine={jest.fn()} />); });
    const root = component.root;
    for (const line of WORKOUT_SYNTAX_EXAMPLE_TEXT.split('\n')) {
      expect(hasText(root, line)).toBe(true);
    }
    for (const row of WORKOUT_SYNTAX_ROW_EXPLANATIONS) {
      expect(hasText(root, row.desc)).toBe(true);
    }
    // The two rows the empty state used to drop (finding F4).
    expect(hasText(root, 'each new line is a new session')).toBe(true);
    expect(hasText(root, 'bodyweight exercises')).toBe(true);
  });

  test('the shared example still round-trips through the real parser', () => {
    const parsed = parseWorkoutNote(WORKOUT_SYNTAX_EXAMPLE_TEXT);
    expect(parsed.ok).toBe(true);
    const exercises = parsed.sections.flatMap(s => s.exercises);
    expect(exercises).toHaveLength(1);
    expect(exercises[0].name).toBe('Bench');
    expect(exercises[0].session_entries).toHaveLength(4);
  });
});

import { installRendererCleanup } from './helpers/log-screen';
import React from 'react';
import render from 'react-test-renderer';
import * as useEntries from '../hooks/useEntries';
import { LightColors } from '../theme/colors';
import { parseWorkoutNote } from '../lib/parser';
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

// ── A/B week support: behavioral tests (#295) ────────────────────────────────

describe('A/B week: parser splits sections by --- separator (#295)', () => {
  const AB_RAW = 'MONDAY — Push\n-DB Bench Press 3x8\n---\nMONDAY — Home\n-DB Floor Press 3x8\n';

  test('parseWorkoutNote detects --- and returns non-null weekBStartIndex', () => {
    const { weekBStartIndex } = parseWorkoutNote(AB_RAW);
    expect(weekBStartIndex).not.toBeNull();
    expect(weekBStartIndex).toBeGreaterThan(0);
  });

  test('week A raw text parses to only week A exercises', () => {
    const lines = AB_RAW.split('\n');
    const sepIdx = lines.findIndex(l => l.trim() === '---');
    const weekAText = lines.slice(0, sepIdx).join('\n');
    const { sections } = parseWorkoutNote(weekAText);
    const names = sections.flatMap(s => s.exercises.map(e => e.name));
    expect(names).toContain('DB Bench Press');
    expect(names).not.toContain('DB Floor Press');
  });

  test('week B raw text parses to only week B exercises', () => {
    const lines = AB_RAW.split('\n');
    const sepIdx = lines.findIndex(l => l.trim() === '---');
    const weekBText = lines.slice(sepIdx + 1).join('\n');
    const { sections } = parseWorkoutNote(weekBText);
    const names = sections.flatMap(s => s.exercises.map(e => e.name));
    expect(names).toContain('DB Floor Press');
    expect(names).not.toContain('DB Bench Press');
  });

  test('note without --- has null weekBStartIndex', () => {
    const { weekBStartIndex } = parseWorkoutNote('MONDAY\n-Squat 3x5\n');
    expect(weekBStartIndex).toBeNull();
  });
});

describe('A/B week: current editor preserves Week B through stale refreshes', () => {
  const AB_RAW = 'MONDAY — Push\n-DB Bench Press 3x8\n---\nMONDAY — Home\n-DB Floor Press 3x8\n';

  test('editing after B is acknowledged and a stale A payload arrives keeps Week B selected and saves into the Week B body', async () => {
    const { useLogCurrentRoutineEditor } = require('../screens/log/useLogCurrentRoutineEditor');
    const update = jest.fn().mockImplementation(async (_id, patch) => ({
      id: 'note1',
      title: patch.title || 'Routine A',
      raw_text: patch.raw_text || AB_RAW,
      activeWeek: patch.activeWeek,
    }));
    const add = jest.fn();
    const selectCurrent = jest.fn();
    let latest = null;

    function Harness({ currentNote, notes }) {
      const [text, setText] = React.useState(AB_RAW);
      const [title, setTitle] = React.useState('Routine A');
      const hook = useLogCurrentRoutineEditor({
        workoutNoteText: text,
        setWorkoutNoteText: setText,
        workoutNoteTitle: title,
        setWorkoutNoteTitle: setTitle,
        currentId: 'note1',
        currentNote,
        notes,
        trackedLifts: [],
        update,
        add,
        selectCurrent,
        fatigueTrackingEnabled: false,
        onCheckInPrompt: jest.fn(),
        isActive: true,
        editorScrollRef: { current: { scrollTo: jest.fn() } },
        readScrollRef: { current: { scrollTo: jest.fn() } },
      });
      latest = {
        hook,
        getText: () => text,
      };
      return null;
    }

    const initialNote = { id: 'note1', title: 'Routine A', raw_text: AB_RAW, activeWeek: 'A' };
    let component;
    render.act(() => {
      component = render.create(<Harness currentNote={initialNote} notes={[initialNote]} />);
    });

    expect(latest.hook.effectiveActiveWeek).toBe('A');

    await render.act(async () => {
      await latest.hook.handleToggleWeek();
    });

    expect(latest.hook.effectiveActiveWeek).toBe('B');
    expect(latest.hook.activeEditText).toContain('DB Floor Press 3x8');
    expect(latest.hook.activeEditText).not.toContain('DB Bench Press 3x8');

    const acknowledgedWeekBNote = { id: 'note1', title: 'Routine A', raw_text: AB_RAW, activeWeek: 'B' };
    render.act(() => {
      component.update(<Harness currentNote={acknowledgedWeekBNote} notes={[acknowledgedWeekBNote]} />);
    });

    expect(latest.hook.effectiveActiveWeek).toBe('B');

    const staleRefreshedNote = { id: 'note1', title: 'Routine A', raw_text: AB_RAW, activeWeek: 'A' };
    render.act(() => {
      component.update(<Harness currentNote={staleRefreshedNote} notes={[staleRefreshedNote]} />);
    });

    expect(latest.hook.effectiveActiveWeek).toBe('B');
    expect(latest.hook.activeEditText).toContain('DB Floor Press 3x8');
    expect(latest.hook.activeEditText).not.toContain('DB Bench Press 3x8');

    render.act(() => {
      latest.hook.handleCurrentTextChange('MONDAY — Home\n-DB Floor Press 4x8\n');
    });

    expect(latest.getText()).toBe(
      'MONDAY — Push\n-DB Bench Press 3x8\n---\nMONDAY — Home\n-DB Floor Press 4x8\n'
    );

    await render.act(async () => {
      await latest.hook.handleSave({ autosave: true });
    });

    expect(update).toHaveBeenLastCalledWith(
      'note1',
      expect.objectContaining({
        raw_text: 'MONDAY — Push\n-DB Bench Press 3x8\n---\nMONDAY — Home\n-DB Floor Press 4x8\n',
        activeWeek: 'B',
      })
    );
  });

  test('editing and saving while remaining on Week A keeps changes in the Week A body', async () => {
    const { useLogCurrentRoutineEditor } = require('../screens/log/useLogCurrentRoutineEditor');
    const update = jest.fn().mockImplementation(async (_id, patch) => ({
      id: 'note1',
      title: patch.title || 'Routine A',
      raw_text: patch.raw_text || AB_RAW,
      activeWeek: patch.activeWeek,
    }));
    let latest = null;

    function Harness({ currentNote, notes }) {
      const [text, setText] = React.useState(AB_RAW);
      const [title, setTitle] = React.useState('Routine A');
      const hook = useLogCurrentRoutineEditor({
        workoutNoteText: text,
        setWorkoutNoteText: setText,
        workoutNoteTitle: title,
        setWorkoutNoteTitle: setTitle,
        currentId: 'note1',
        currentNote,
        notes,
        trackedLifts: [],
        update,
        add: jest.fn(),
        selectCurrent: jest.fn(),
        fatigueTrackingEnabled: false,
        onCheckInPrompt: jest.fn(),
        isActive: true,
        editorScrollRef: { current: { scrollTo: jest.fn() } },
        readScrollRef: { current: { scrollTo: jest.fn() } },
      });
      latest = {
        hook,
        getText: () => text,
      };
      return null;
    }

    const currentNote = { id: 'note1', title: 'Routine A', raw_text: AB_RAW, activeWeek: 'A' };
    render.act(() => {
      render.create(<Harness currentNote={currentNote} notes={[currentNote]} />);
    });

    expect(latest.hook.effectiveActiveWeek).toBe('A');
    expect(latest.hook.activeEditText).toContain('DB Bench Press 3x8');
    expect(latest.hook.activeEditText).not.toContain('DB Floor Press 3x8');

    render.act(() => {
      latest.hook.handleCurrentTextChange('MONDAY — Push\n-DB Bench Press 4x8');
    });

    expect(latest.getText()).toBe(
      'MONDAY — Push\n-DB Bench Press 4x8\n---\nMONDAY — Home\n-DB Floor Press 3x8\n'
    );

    await render.act(async () => {
      await latest.hook.handleSave({ autosave: true });
    });

    expect(update).toHaveBeenLastCalledWith(
      'note1',
      expect.objectContaining({
        raw_text: 'MONDAY — Push\n-DB Bench Press 4x8\n---\nMONDAY — Home\n-DB Floor Press 3x8\n',
        activeWeek: 'A',
      })
    );
  });
});

describe('A/B week for non-current routines: viewing projection and per-note persistence (#687)', () => {
  const { useLogOtherRoutineEditor } = require('../screens/log/useLogOtherRoutineEditor');
  const AB_RAW = 'MONDAY — Push\n-DB Bench Press 3x8\n---\nMONDAY — Home\n-DB Floor Press 3x8\n';
  const PLAIN_RAW = 'MONDAY\n-Squat 3x5\n';

  function makeHarness() {
    let latest = null;
    function Harness({ notes, update, add }) {
      const hook = useLogOtherRoutineEditor({
        notes,
        currentId: 'current1',
        currentNote: { id: 'current1', raw_text: 'x' },
        deloadHistory: [],
        update,
        add: add || jest.fn(),
        remove: jest.fn(),
        selectCurrent: jest.fn(),
        updateDeload: jest.fn(),
        deleteDeloadNote: jest.fn(),
        autosaveCurrentTimerRef: { current: null },
        handleSave: jest.fn(),
        currentEditorMode: 'read',
        hasUnsavedCurrent: false,
        editorScrollRef: { current: { scrollTo: jest.fn() } },
      });
      latest = { hook };
      return null;
    }
    return { Harness, get: () => latest };
  }

  test('a non-current note with a standalone --- is detected as having A/B weeks', () => {
    const { Harness, get } = makeHarness();
    const note = { id: 'r1', title: 'R', raw_text: AB_RAW };
    render.act(() => { render.create(<Harness notes={[note]} update={jest.fn()} />); });
    render.act(() => { get().hook.handleViewOtherNote(note); });
    expect(get().hook.viewingHasABWeeks).toBe(true);
  });

  test('a legacy A/B note with no valid activeWeek defaults to Week A projection', () => {
    const { Harness, get } = makeHarness();
    const note = { id: 'r1', title: 'R', raw_text: AB_RAW }; // no activeWeek field at all
    render.act(() => { render.create(<Harness notes={[note]} update={jest.fn()} />); });
    render.act(() => { get().hook.handleViewOtherNote(note); });
    expect(get().hook.viewingEffectiveWeek).toBe('A');
    const names = get().hook.viewingNoteDayGroups.flatMap(g => g.sections.flatMap(s => s.exercises.map(e => e.name)));
    expect(names).toContain('DB Bench Press');
    expect(names).not.toContain('DB Floor Press');
  });

  test('an invalid persisted activeWeek value also defaults to Week A', () => {
    const { Harness, get } = makeHarness();
    const note = { id: 'r1', title: 'R', raw_text: AB_RAW, activeWeek: 'nonsense' };
    render.act(() => { render.create(<Harness notes={[note]} update={jest.fn()} />); });
    render.act(() => { get().hook.handleViewOtherNote(note); });
    expect(get().hook.viewingEffectiveWeek).toBe('A');
  });

  test('a note with a persisted Week B selection projects only Week B exercises', () => {
    const { Harness, get } = makeHarness();
    const note = { id: 'r1', title: 'R', raw_text: AB_RAW, activeWeek: 'B' };
    render.act(() => { render.create(<Harness notes={[note]} update={jest.fn()} />); });
    render.act(() => { get().hook.handleViewOtherNote(note); });
    expect(get().hook.viewingEffectiveWeek).toBe('B');
    const names = get().hook.viewingNoteDayGroups.flatMap(g => g.sections.flatMap(s => s.exercises.map(e => e.name)));
    expect(names).toContain('DB Floor Press');
    expect(names).not.toContain('DB Bench Press');
  });

  test('toggling the viewed week persists that note\'s activeWeek through update() and never calls selectCurrent', async () => {
    const note = { id: 'r1', title: 'R', raw_text: AB_RAW, activeWeek: 'A' };
    const update = jest.fn().mockImplementation(async (id, patch) => ({ ...note, ...patch }));
    const selectCurrent = jest.fn();
    let latest = null;
    function Harness({ notes }) {
      const hook = useLogOtherRoutineEditor({
        notes,
        currentId: 'current1',
        currentNote: { id: 'current1', raw_text: 'x' },
        deloadHistory: [],
        update,
        add: jest.fn(),
        remove: jest.fn(),
        selectCurrent,
        updateDeload: jest.fn(),
        deleteDeloadNote: jest.fn(),
        autosaveCurrentTimerRef: { current: null },
        handleSave: jest.fn(),
        currentEditorMode: 'read',
        hasUnsavedCurrent: false,
        editorScrollRef: { current: { scrollTo: jest.fn() } },
      });
      latest = { hook };
      return null;
    }
    render.act(() => { render.create(<Harness notes={[note]} />); });
    render.act(() => { latest.hook.handleViewOtherNote(note); });
    expect(latest.hook.viewingEffectiveWeek).toBe('A');

    await render.act(async () => { await latest.hook.handleToggleViewingWeek(); });

    expect(latest.hook.viewingEffectiveWeek).toBe('B');
    expect(update).toHaveBeenCalledWith('r1', { activeWeek: 'B' });
    expect(update).toHaveBeenCalledTimes(1);
    expect(selectCurrent).not.toHaveBeenCalled();
  });

  test('each expanded routine remembers its own selected week independently', () => {
    const noteA = { id: 'r1', title: 'R1', raw_text: AB_RAW, activeWeek: 'B' };
    const noteB = { id: 'r2', title: 'R2', raw_text: AB_RAW, activeWeek: 'A' };
    const { Harness, get } = makeHarness();
    render.act(() => { render.create(<Harness notes={[noteA, noteB]} update={jest.fn()} />); });

    render.act(() => { get().hook.handleViewOtherNote(noteA); });
    expect(get().hook.viewingEffectiveWeek).toBe('B');

    render.act(() => { get().hook.handleViewOtherNote(noteA); }); // collapse
    render.act(() => { get().hook.handleViewOtherNote(noteB); }); // expand the other routine
    expect(get().hook.viewingEffectiveWeek).toBe('A');
  });

  test('a plain note without --- has no A/B week toggle and behaves as before', () => {
    const { Harness, get } = makeHarness();
    const note = { id: 'r1', title: 'R', raw_text: PLAIN_RAW };
    render.act(() => { render.create(<Harness notes={[note]} update={jest.fn()} />); });
    render.act(() => { get().hook.handleViewOtherNote(note); });
    expect(get().hook.viewingHasABWeeks).toBe(false);
    expect(get().hook.viewingEffectiveWeek).toBe(null);
    const names = get().hook.viewingNoteDayGroups.flatMap(g => g.sections.flatMap(s => s.exercises.map(e => e.name)));
    expect(names).toContain('Squat');
  });

  test('editing a non-current A/B note edits only the selected week; saving preserves the other week and the separator', async () => {
    const note = { id: 'r1', title: 'R', raw_text: AB_RAW, activeWeek: 'B' };
    const update = jest.fn().mockImplementation(async (id, patch) => ({ ...note, ...patch }));
    const { Harness, get } = makeHarness();
    render.act(() => { render.create(<Harness notes={[note]} update={update} />); });

    render.act(() => { get().hook.handleViewOtherNote(note); });
    render.act(() => { get().hook.handleEditViewedNote(); });

    // Entering the editor from an expanded Week-B routine edits only Week B.
    expect(get().hook.editingText).toContain('DB Floor Press 3x8');
    expect(get().hook.editingText).not.toContain('DB Bench Press 3x8');

    render.act(() => { get().hook.setEditingText('MONDAY — Home\n-DB Floor Press 5x8\n'); });

    await render.act(async () => { await get().hook.handleSaveOtherNote(); });

    expect(update).toHaveBeenLastCalledWith(
      'r1',
      expect.objectContaining({
        raw_text: 'MONDAY — Push\n-DB Bench Press 3x8\n---\nMONDAY — Home\n-DB Floor Press 5x8\n',
        activeWeek: 'B',
      })
    );
  });

  test('editing while on Week A keeps changes in the Week A body and preserves Week B untouched', async () => {
    const note = { id: 'r1', title: 'R', raw_text: AB_RAW, activeWeek: 'A' };
    const update = jest.fn().mockImplementation(async (id, patch) => ({ ...note, ...patch }));
    const { Harness, get } = makeHarness();
    render.act(() => { render.create(<Harness notes={[note]} update={update} />); });

    render.act(() => { get().hook.handleViewOtherNote(note); });
    render.act(() => { get().hook.handleEditViewedNote(); });

    render.act(() => { get().hook.setEditingText('MONDAY — Push\n-DB Bench Press 4x8'); });

    await render.act(async () => { await get().hook.handleSaveOtherNote(); });

    expect(update).toHaveBeenLastCalledWith(
      'r1',
      expect.objectContaining({
        raw_text: 'MONDAY — Push\n-DB Bench Press 4x8\n---\nMONDAY — Home\n-DB Floor Press 3x8\n',
        activeWeek: 'A',
      })
    );
  });

  test('creating a --- boundary while editing, switching to Week B and authoring it, preserves both bodies', () => {
    const { Harness, get } = makeHarness();
    const note = { id: 'r1', title: 'R', raw_text: PLAIN_RAW };
    render.act(() => { render.create(<Harness notes={[note]} update={jest.fn()} />); });
    render.act(() => { get().hook.handleOpenOtherNote(note); });
    expect(get().hook.editingHasABWeeks).toBe(false);

    // Creating the boundary: typing '---' turns the plain note into an A/B note.
    render.act(() => {
      get().hook.setEditingText('MONDAY\n-Squat 3x5\n---\nMONDAY\n-Deadlift 3x5');
    });
    expect(get().hook.editingHasABWeeks).toBe(true);
    expect(get().hook.editingEffectiveWeek).toBe('A');
    expect(get().hook.editingText).toContain('Squat');
    expect(get().hook.editingText).not.toContain('Deadlift');

    // The editing-week toggle (handleToggleEditingWeek) must now be usable: switch
    // to Week B and author it.
    render.act(() => { get().hook.handleToggleEditingWeek(); });
    expect(get().hook.editingEffectiveWeek).toBe('B');
    expect(get().hook.editingText).toContain('Deadlift');
    expect(get().hook.editingText).not.toContain('Squat');

    render.act(() => { get().hook.setEditingText('MONDAY\n-Deadlift 5x5'); });

    // Switching back to Week A must show the original, untouched Week A body —
    // neither side lost any text across the create/switch/author cycle.
    render.act(() => { get().hook.handleToggleEditingWeek(); });
    expect(get().hook.editingEffectiveWeek).toBe('A');
    expect(get().hook.editingText).toBe('MONDAY\n-Squat 3x5');

    render.act(() => { get().hook.handleToggleEditingWeek(); });
    expect(get().hook.editingText).toBe('MONDAY\n-Deadlift 5x5');
  });

  test('reopening a note whose --- boundary has been removed reconciles the controls without losing text', () => {
    const { Harness, get } = makeHarness();
    const abNote = { id: 'r1', title: 'R', raw_text: AB_RAW, activeWeek: 'B' };
    render.act(() => { render.create(<Harness notes={[abNote]} update={jest.fn()} />); });
    render.act(() => { get().hook.handleOpenOtherNote(abNote); });
    expect(get().hook.editingHasABWeeks).toBe(true);
    expect(get().hook.editingEffectiveWeek).toBe('B');

    // The boundary is gone by the time the note is reopened (e.g. removed through
    // some other save path). Reconciliation must show the full remaining text with
    // no toggle and no data loss, not crash or silently drop content.
    const mergedNoBoundary = { id: 'r1', title: 'R', raw_text: 'MONDAY — Push\n-DB Bench Press 3x8\nMONDAY — Home\n-DB Floor Press 3x8\n' };
    render.act(() => { get().hook.handleOpenOtherNote(mergedNoBoundary); });

    expect(get().hook.editingHasABWeeks).toBe(false);
    expect(get().hook.editingEffectiveWeek).toBe(null);
    expect(get().hook.editingText).toBe(mergedNoBoundary.raw_text);
  });

  test('handleMergeEditingWeeks removes the boundary while editing: both authored bodies survive, the toggle disappears, and the persisted activeWeek is cleared', async () => {
    const abNote = { id: 'r1', title: 'R', raw_text: AB_RAW, activeWeek: 'B' };
    const update = jest.fn().mockImplementation(async (id, patch) => ({ ...abNote, ...patch }));
    const { Harness, get } = makeHarness();
    render.act(() => { render.create(<Harness notes={[abNote]} update={update} />); });

    // Open the A/B note in the editor and author both weeks first.
    render.act(() => { get().hook.handleOpenOtherNote(abNote); });
    expect(get().hook.editingHasABWeeks).toBe(true);
    expect(get().hook.editingEffectiveWeek).toBe('B');

    render.act(() => { get().hook.setEditingText('MONDAY — Home\n-DB Floor Press 4x8'); });
    render.act(() => { get().hook.handleToggleEditingWeek(); });
    expect(get().hook.editingEffectiveWeek).toBe('A');
    render.act(() => { get().hook.setEditingText('MONDAY — Push\n-DB Bench Press 5x8'); });

    // Invoke the real editor removal action.
    render.act(() => { get().hook.handleMergeEditingWeeks(); });

    // The note is now a plain single-week note: no boundary, no toggle state,
    // and both authored bodies present in the merged text.
    expect(get().hook.editingHasABWeeks).toBe(false);
    expect(get().hook.editingEffectiveWeek).toBe(null);
    expect(get().hook.editingText).toBe('MONDAY — Push\n-DB Bench Press 5x8\n\nMONDAY — Home\n-DB Floor Press 4x8');
    expect(get().hook.editingText).not.toContain('---');

    // Saving persists the merge and reconciles (clears) the stale activeWeek.
    await render.act(async () => { await get().hook.handleSaveOtherNote(); });
    expect(update).toHaveBeenLastCalledWith(
      'r1',
      expect.objectContaining({
        raw_text: 'MONDAY — Push\n-DB Bench Press 5x8\n\nMONDAY — Home\n-DB Floor Press 4x8',
        activeWeek: null,
      })
    );
  });

  test('a brand-new A/B routine persists its selected Week B on first save, and reopening it stays on Week B; currentId is never touched', async () => {
    // add() (useWorkoutNotes) always creates a note with activeWeek: null —
    // the new-note save path must follow up with an explicit update() to
    // persist whichever week was selected before the first save, or the
    // routine would silently reopen on Week A regardless of the author's
    // choice.
    let storedNote = null;
    const add = jest.fn().mockImplementation(async (title, raw_text) => {
      storedNote = { id: 'new1', title, raw_text, activeWeek: null };
      return storedNote;
    });
    const update = jest.fn().mockImplementation(async (id, patch) => {
      storedNote = { ...storedNote, ...patch };
      return storedNote;
    });
    const selectCurrent = jest.fn();

    let latest = null;
    function Harness({ notes }) {
      const hook = useLogOtherRoutineEditor({
        notes,
        currentId: 'current1',
        currentNote: { id: 'current1', raw_text: 'x' },
        deloadHistory: [],
        update,
        add,
        remove: jest.fn(),
        selectCurrent,
        updateDeload: jest.fn(),
        deleteDeloadNote: jest.fn(),
        autosaveCurrentTimerRef: { current: null },
        handleSave: jest.fn(),
        currentEditorMode: 'read',
        hasUnsavedCurrent: false,
        editorScrollRef: { current: { scrollTo: jest.fn() } },
      });
      latest = { hook };
      return null;
    }

    render.act(() => { render.create(<Harness notes={[]} />); });

    render.act(() => { latest.hook.handleCreateRoutine(); });
    render.act(() => {
      latest.hook.setEditingText('MONDAY — Push\n-DB Bench Press 3x8\n---\nMONDAY — Home\n-DB Floor Press 3x8');
    });
    expect(latest.hook.editingEffectiveWeek).toBe('A');

    // Select Week B before the very first save.
    render.act(() => { latest.hook.handleToggleEditingWeek(); });
    expect(latest.hook.editingEffectiveWeek).toBe('B');

    await render.act(async () => { await latest.hook.handleSaveOtherNote(); });

    expect(add).toHaveBeenCalledWith(
      'Untitled Routine',
      'MONDAY — Push\n-DB Bench Press 3x8\n---\nMONDAY — Home\n-DB Floor Press 3x8',
      // The durable creation-attempt token every new-note create now carries (#997).
      { attemptToken: expect.any(String) }
    );
    // The follow-up persistence call, and never a currentId change.
    expect(update).toHaveBeenCalledWith('new1', { activeWeek: 'B' });
    expect(selectCurrent).not.toHaveBeenCalled();
    expect(storedNote.activeWeek).toBe('B');

    // Reopening the note as freshly loaded from the store must still select
    // Week B, not silently reset to the Week A default.
    render.act(() => { latest.hook.handleOpenOtherNote(storedNote); });
    expect(latest.hook.editingHasABWeeks).toBe(true);
    expect(latest.hook.editingEffectiveWeek).toBe('B');
    expect(latest.hook.editingText).toContain('DB Floor Press');
    expect(latest.hook.editingText).not.toContain('DB Bench Press');
  });

  test('a brand-new plain routine (no ---) still saves with activeWeek: null and never calls update() for a week', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'new2', title: 'Plain', raw_text: 'MONDAY\n-Squat 3x5', activeWeek: null });
    const update = jest.fn();
    let latest = null;
    function Harness({ notes }) {
      const hook = useLogOtherRoutineEditor({
        notes,
        currentId: 'current1',
        currentNote: { id: 'current1', raw_text: 'x' },
        deloadHistory: [],
        update,
        add,
        remove: jest.fn(),
        selectCurrent: jest.fn(),
        updateDeload: jest.fn(),
        deleteDeloadNote: jest.fn(),
        autosaveCurrentTimerRef: { current: null },
        handleSave: jest.fn(),
        currentEditorMode: 'read',
        hasUnsavedCurrent: false,
        editorScrollRef: { current: { scrollTo: jest.fn() } },
      });
      latest = { hook };
      return null;
    }

    render.act(() => { render.create(<Harness notes={[]} />); });
    render.act(() => { latest.hook.handleCreateRoutine(); });
    render.act(() => { latest.hook.setEditingTitle('Plain'); });
    render.act(() => { latest.hook.setEditingText('MONDAY\n-Squat 3x5'); });

    await render.act(async () => { await latest.hook.handleSaveOtherNote(); });

    expect(add).toHaveBeenCalledWith('Plain', 'MONDAY\n-Squat 3x5', {
      attemptToken: expect.any(String),
    });
    expect(update).not.toHaveBeenCalled();
  });
});

describe('LogScreen editor header: editing-week toggle for non-current A/B notes (#687 review feedback)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const getInput = (root) =>
    root.findAll(n => n.props && n.props.multiline === true && typeof n.props.onChangeText === 'function')[0];

  test('typing a --- boundary into a new routine reveals an accessible Week toggle; switching weeks preserves both bodies', () => {
    const currentNote = { id: 'current1', title: 'Current', raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5' };
    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [currentNote],
      currentId: 'current1',
      currentNote,
      deloadNotes: [],
      loading: false,
      error: null,
      refresh: jest.fn(),
      selectCurrent: jest.fn(),
      update: jest.fn(),
      add: jest.fn().mockResolvedValue({ id: 'new1' }),
      remove: jest.fn(),
    });
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: [], toggle: jest.fn() });
    useEntries.useDeloadNote.mockReturnValue({ note: null, loading: false, save: jest.fn(), clear: jest.fn() });
    useEntries.useDeloadHistory.mockReturnValue({
      history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
    });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: false });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;
    expandRoutineManagement(root);

    // No toggle before there is any A/B routine open in the editor.
    expect(findPressableByText(root, 'Week B')).toBeNull();

    // `New routine` opens the ordinary `editingNoteId === 'new'` editor
    // directly (#786/R6b-3; the header affordance is the section's only
    // create-routine control since #836), the same editor this test has
    // always exercised.
    render.act(() => { findPressableByText(root, 'New routine').props.onPress(); });

    render.act(() => {
      getInput(root).props.onChangeText('MONDAY — Push\n-DB Bench Press 3x8\n---\nMONDAY — Home\n-DB Floor Press 3x8');
    });

    // The boundary now exists: the editing-week toggle must appear, accessibly.
    const toggleToB = findPressableByText(root, 'Week B');
    expect(toggleToB).toBeTruthy();
    expect(toggleToB.props.accessibilityRole).toBe('button');
    expect(toggleToB.props.accessibilityLabel).toBe('Switch to Week B');
    expect(toggleToB.props.accessibilityState).toEqual({ selected: false });
    expect(getInput(root).props.value).toBe('MONDAY — Push\n-DB Bench Press 3x8');

    render.act(() => { toggleToB.props.onPress(); });
    expect(getInput(root).props.value).toBe('MONDAY — Home\n-DB Floor Press 3x8');

    render.act(() => { getInput(root).props.onChangeText('MONDAY — Home\n-DB Floor Press 4x8'); });

    // Switch back to Week A: its body must be exactly as authored, untouched by
    // the Week-B edit — neither side lost any text.
    const toggleToA = findPressableByText(root, 'Week A');
    expect(toggleToA.props.accessibilityState).toEqual({ selected: true });
    render.act(() => { toggleToA.props.onPress(); });
    expect(getInput(root).props.value).toBe('MONDAY — Push\n-DB Bench Press 3x8');
  });

  test('the Merge weeks control removes the boundary while editing and then disappears (truthful control)', () => {
    const otherNote = { id: 'other1', title: 'Other', raw_text: 'MONDAY — Push\n-DB Bench Press 3x8\n---\nMONDAY — Home\n-DB Floor Press 3x8', activeWeek: 'A' };
    const currentNote = { id: 'current1', title: 'Current', raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5' };
    const update = jest.fn().mockImplementation(async (id, patch) => ({ ...otherNote, ...patch }));

    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [currentNote, otherNote],
      currentId: 'current1',
      currentNote,
      deloadNotes: [],
      loading: false,
      error: null,
      refresh: jest.fn(),
      selectCurrent: jest.fn(),
      update,
      add: jest.fn(),
      remove: jest.fn(),
    });
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: [], toggle: jest.fn() });
    useEntries.useDeloadNote.mockReturnValue({ note: null, loading: false, save: jest.fn(), clear: jest.fn() });
    useEntries.useDeloadHistory.mockReturnValue({
      history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
    });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: false });

    let component;
    render.act(() => {
      // No current-routine content (workoutNoteText: '') so the current-routine
      // card is not rendered, and the double-tap below unambiguously targets the
      // non-current routine card's body.
      component = render.create(<ControlledLogScreen workoutNoteText="" setWorkoutNoteText={jest.fn()} />);
    });
    const root = component.root;
    expandRoutineManagement(root);

    // Expand the non-current routine, then open it in the editor via double-tap.
    // The visible "Double-tap to edit" hint is gone (#724); the body Pressable is
    // located by its rendered exercise content instead, and the gesture persists.
    render.act(() => { findPressableByText(root, 'Other').props.onPress(); });
    const body = pressableAround(root, t => t.includes('DB Bench Press'));
    render.act(() => { body.props.onPress(); });
    render.act(() => { body.props.onPress(); });

    // A/B controls are present for this note, including the truthful Merge weeks
    // control — it must not render for a plain note (covered by the toggle test
    // above finding no "Week B" control at all before any A/B note is open).
    const mergeButton = findPressableByText(root, 'Merge weeks');
    expect(mergeButton).toBeTruthy();
    expect(mergeButton.props.accessibilityRole).toBe('button');
    expect(mergeButton.props.accessibilityLabel).toBe('Merge Week A and Week B into one routine');
    expect(findPressableByText(root, 'Week B')).toBeTruthy();

    render.act(() => { mergeButton.props.onPress(); });

    // The boundary is gone: both authored bodies remain in the single input,
    // and the editor's Merge control disappears (truthful — there is nothing
    // left to merge). Note: the still-mounted (but hidden) non-current
    // viewing card's own Week toggle can remain until this edit is actually
    // saved, since it reflects the persisted note, not the in-progress edit.
    expect(getInput(root).props.value).toBe('MONDAY — Push\n-DB Bench Press 3x8\n\nMONDAY — Home\n-DB Floor Press 3x8');
    expect(findPressableByText(root, 'Merge weeks')).toBeNull();
  });
});

describe('A/B week: empty active card rendering', () => {
  test('renders B-week alternative text in small inline body text instead of emptyText style', () => {
    const { LogActiveRoutineCard } = require('../components/LogActiveRoutineCard');

    let component;
    render.act(() => {
      component = render.create(
        <LogActiveRoutineCard
          workoutNoteTitle="My Routine"
          hasABWeeks={true}
          effectiveActiveWeek="B"
          handleToggleWeek={jest.fn()}
          enterCurrentEditor={jest.fn()}
          handleNoteBodyPress={jest.fn()}
          isCollapsed={false}
          dayGroups={[]}
          trackedLifts={{}}
          handleToggleTrack={jest.fn()}
          roughNoteId="note1"
          currentId="note1"
          roughFlaggedNames={new Set()}
          activeEditText="Raw B-week routine text"
        />
      );
    });

    const root = component.root;
    // Find the text node that renders "Raw B-week routine text"
    const textNode = root.find(n => n.type === 'Text' && n.props.children === 'Raw B-week routine text');
    expect(textNode).toBeTruthy();
    
    // Check that it does NOT have emptyText styling (which has textAlign: 'center'), and has unparsedRowMuted styling (color: LightColors.text)
    expect(textNode.props.style.textAlign).toBeUndefined();
    expect(textNode.props.style.color).toBe(LightColors.text);
  });
});

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

describe('LogPreviousRoutines: Week A/B control on an expanded non-current routine (#687)', () => {

  test('an expanded non-current A/B routine shows a Week toggle with an accessible label and role', () => {
    const handleToggleViewingWeek = jest.fn();
    let component;
    render.act(() => {
      component = render.create(
        <ControlledPreviousRoutines
          otherNotes={[{ id: 'r1', title: 'Routine 1', raw_text: 'MONDAY\n-Squat 3x5\n---\nMONDAY\n-Deadlift 3x5\n' }]}
          handleViewOtherNote={jest.fn()}
          viewingNoteId="r1"
          viewingNote={{ id: 'r1', title: 'Routine 1', raw_text: 'MONDAY\n-Squat 3x5\n---\nMONDAY\n-Deadlift 3x5\n' }}
          viewingNoteDayGroups={[]}
          viewingHasABWeeks={true}
          viewingEffectiveWeek="A"
          handleToggleViewingWeek={handleToggleViewingWeek}
          handleSwitchCurrent={jest.fn()}
          handleEditViewedNote={jest.fn()}
          handleDeleteRoutine={jest.fn()}
          handleCreateRoutine={jest.fn()}
        />
      );
    });

    const root = component.root;
    expandRoutineManagement(root);
    const toggle = pressableAround(root, t => t.includes('Week B'));
    expect(toggle).toBeTruthy();
    expect(toggle.props.accessibilityRole).toBe('button');
    expect(toggle.props.accessibilityLabel).toBe('Switch to Week B');
    expect(toggle.props.accessibilityState).toEqual({ selected: false });

    render.act(() => { toggle.props.onPress({ stopPropagation: jest.fn() }); });
    expect(handleToggleViewingWeek).toHaveBeenCalledTimes(1);
  });

  test('a non-current routine without a standalone --- shows no Week toggle', () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledPreviousRoutines
          otherNotes={[{ id: 'r1', title: 'Routine 1', raw_text: 'MONDAY\n-Squat 3x5\n' }]}
          handleViewOtherNote={jest.fn()}
          viewingNoteId="r1"
          viewingNote={{ id: 'r1', title: 'Routine 1', raw_text: 'MONDAY\n-Squat 3x5\n' }}
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

    const root = component.root;
    expandRoutineManagement(root);
    const weekTexts = root.findAll(
      n => n.type === 'Text' && Array.isArray(n.props.children) && n.props.children[0] === 'Week '
    );
    expect(weekTexts.length).toBe(0);
  });
});

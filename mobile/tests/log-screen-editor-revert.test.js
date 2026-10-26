import { installRendererCleanup } from './helpers/log-screen';
import render from 'react-test-renderer';
import { MoreScreen } from '../screens/MoreScreen';
import * as useEntries from '../hooks/useEntries';
import { Alert } from 'react-native';
import { findPressableByText, openCurrentRoutineMenu, expandRoutineManagement, ControlledLogScreen } from './helpers/log-screen';

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

// ── deload ordinal prompt: prefill and editability contract (#284) ────────────
// These legacy source-level assertions check the prefill formula, editable
// input, and forwarding to completeDeload. Rendered screen coverage uses the
// ControlledLogScreen harness below.

const fs = require('fs');

const path = require('path');

function readLogScreenSource() {
  const main = fs.readFileSync(path.join(__dirname, '../screens/LogScreen.js'), 'utf8');
  const deload = fs.readFileSync(path.join(__dirname, '../components/LogDeloadSection.js'), 'utf8');
  const editor = fs.readFileSync(path.join(__dirname, '../components/LogScreenEditorCard.js'), 'utf8');
  const active = fs.readFileSync(path.join(__dirname, '../components/LogActiveRoutineCard.js'), 'utf8');
  const previous = fs.readFileSync(path.join(__dirname, '../components/LogPreviousRoutines.js'), 'utf8');
  const helpers = fs.readFileSync(path.join(__dirname, '../lib/LogScreenHelpers.js'), 'utf8');
  const currentEditorHook = fs.readFileSync(path.join(__dirname, '../screens/log/useLogCurrentRoutineEditor.js'), 'utf8');
  const otherEditorHook = fs.readFileSync(path.join(__dirname, '../screens/log/useLogOtherRoutineEditor.js'), 'utf8');
  const deloadEditorHook = fs.readFileSync(path.join(__dirname, '../screens/log/useLogDeloadEditor.js'), 'utf8');
  const logHelpersLocal = fs.readFileSync(path.join(__dirname, '../screens/log/logScreenHelpers.js'), 'utf8');
  return main + '\n' + deload + '\n' + editor + '\n' + active + '\n' + previous + '\n' + helpers + '\n' + currentEditorHook + '\n' + otherEditorHook + '\n' + deloadEditorHook + '\n' + logHelpersLocal;
}

// ── Recovery close/revert choice vs in-flight autosave (#851) ──
describe('Recovery Cancel offers safe Done and confirmed persisted revert (#851)', () => {
  const { useLogOtherRoutineEditor } = require('../screens/log/useLogOtherRoutineEditor');

  let harnessRenderer;
  let alertSpy;
  beforeEach(() => {
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });
  afterEach(() => {
    if (harnessRenderer) {
      render.act(() => { harnessRenderer.unmount(); });
      harnessRenderer = null;
    }
    alertSpy.mockRestore();
  });

  const mountHarness = ({ notes, update }) => {
    let latest = null;
    function Harness({ notes: n }) {
      const hook = useLogOtherRoutineEditor({
        notes: n,
        currentId: 'other',
        currentNote: { id: 'other' },
        deloadHistory: [],
        update,
        add: jest.fn(),
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
    render.act(() => { harnessRenderer = render.create(<Harness notes={notes} />); });
    return () => latest.hook;
  };

  test('Cancel waits for the in-flight autosave before issuing its revert write', async () => {
    const note = { id: 'weeknote', title: 'Recovery Week Note', raw_text: 'ORIGINAL' };
    let releaseAutosave;
    const autosaveGate = new Promise((resolve) => { releaseAutosave = resolve; });
    const update = jest.fn().mockImplementation(async (id, patch) => {
      if (update.mock.calls.length === 1) await autosaveGate;
      return { id, title: patch.title, raw_text: patch.raw_text };
    });
    const getHook = mountHarness({ notes: [note], update });

    // Seed the recovery viewer, then open the inline editor off it exactly as
    // LogRecoverySection's Edit action does.
    render.act(() => { getHook().setRecoveryViewingNoteId(note.id); });
    render.act(() => { getHook().handleEditRecoveryViewedNote(); });
    expect(getHook().editingNoteId).toBe(note.id);

    // Type, and let the debounced autosave start (simulated directly, as the
    // #528 tests above do — the real debounce timer is not under test here).
    render.act(() => { getHook().setEditingText('UNWANTED AUTOSAVED EDIT'); });
    let autosavePromise;
    render.act(() => { autosavePromise = getHook().handleSaveOtherNote({ autosave: true }); });
    expect(update).toHaveBeenCalledTimes(1);

    // Cancel itself only opens explicit choices; the destructive choice then
    // waits for the in-flight autosave before restoring the entry snapshot.
    render.act(() => { getHook().handleCancelRecoveryEdit(); });
    const buttons = alertSpy.mock.calls[0][2];
    expect(buttons.map(button => button.text)).toEqual(['Keep editing', 'Done', 'Revert this edit']);
    expect(buttons.find(button => button.text === 'Revert this edit').style).toBe('destructive');
    let revertPromise;
    render.act(() => { revertPromise = buttons.find(button => button.text === 'Revert this edit').onPress(); });
    expect(update).toHaveBeenCalledTimes(1);

    await render.act(async () => {
      releaseAutosave();
      await autosavePromise;
      await revertPromise;
    });

    // The revert write is issued only after the autosave settles, so it is
    // always the LAST word — the note ends up back at its original content,
    // never left on the unwanted autosaved text.
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith('weeknote', expect.objectContaining({ raw_text: 'ORIGINAL' }));
    expect(getHook().editingNoteId).toBe(null);
  });

  test('Done saves the latest recovery edit and closes without restoring the entry snapshot', async () => {
    const note = { id: 'weeknote', title: 'Recovery Week Note', raw_text: 'ORIGINAL' };
    const update = jest.fn().mockImplementation(async (id, patch) => ({ id, ...patch }));
    const getHook = mountHarness({ notes: [note], update });

    render.act(() => { getHook().setRecoveryViewingNoteId(note.id); });
    render.act(() => { getHook().handleEditRecoveryViewedNote(); });
    render.act(() => { getHook().setEditingText('KEPT EDIT'); });
    render.act(() => { getHook().handleCancelRecoveryEdit(); });

    const done = alertSpy.mock.calls[0][2].find(button => button.text === 'Done');
    await render.act(async () => { await done.onPress(); });

    expect(update).toHaveBeenLastCalledWith('weeknote', expect.objectContaining({ raw_text: 'KEPT EDIT' }));
    expect(getHook().editingNoteId).toBe(null);
  });

  test('Keep editing leaves an unchanged recovery draft open without writing', () => {
    const note = { id: 'weeknote', title: 'Recovery Week Note', raw_text: 'ORIGINAL' };
    const update = jest.fn();
    const getHook = mountHarness({ notes: [note], update });

    render.act(() => { getHook().setRecoveryViewingNoteId(note.id); });
    render.act(() => { getHook().handleEditRecoveryViewedNote(); });
    render.act(() => { getHook().handleCancelRecoveryEdit(); });

    const keepEditing = alertSpy.mock.calls[0][2].find(button => button.text === 'Keep editing');
    render.act(() => { keepEditing.onPress?.(); });
    expect(update).not.toHaveBeenCalled();
    expect(getHook().editingNoteId).toBe(note.id);
    expect(getHook().editingText).toBe('ORIGINAL');
  });

  test('a failed confirmed revert keeps the inline editor open', async () => {
    const note = { id: 'weeknote', title: 'Recovery Week Note', raw_text: 'ORIGINAL' };
    const update = jest.fn().mockRejectedValue(new Error('write failed'));
    const getHook = mountHarness({ notes: [note], update });

    render.act(() => { getHook().setRecoveryViewingNoteId(note.id); });
    render.act(() => { getHook().handleEditRecoveryViewedNote(); });
    render.act(() => { getHook().setEditingText('edited'); });

    render.act(() => { getHook().handleCancelRecoveryEdit(); });
    const revert = alertSpy.mock.calls[0][2].find(button => button.text === 'Revert this edit');
    await render.act(async () => { await revert.onPress(); });

    // The revert write failed, so Cancel must not have closed the session —
    // otherwise the edited-but-unreverted text would be stranded with no
    // visible way back to Save or retry Cancel.
    expect(getHook().editingNoteId).toBe(note.id);
    expect(alertSpy).toHaveBeenCalled();
  });
});

// ── Undo escape hatch: source-level assertions ─────────────────────
describe('explicit editor rollback: source-level assertions (#851)', () => {
  let src;
  beforeAll(() => {
    src = readLogScreenSource();
  });

  test('declares originalNoteState hooks', () => {
    expect(src).toMatch(/const\s*\[originalNoteState,\s*setOriginalNoteState\]\s*=\s*useState/);
  });

  test('defines undo handlers for current, other, and deload templates', () => {
    expect(src).toMatch(/const\s+handleUndoCurrent\s*=\s*/);
    expect(src).toMatch(/const\s+handleUndoOther\s*=\s*/);
    expect(src).toMatch(/const\s+handleUndoDeload\s*=\s*/);
  });

  test('rollback is removed from the crowded header and rendered with explicit body copy', () => {
    expect(src).not.toMatch(/accessibilityLabel="Undo"/);
    expect(src).toMatch(/title=\{\(editingNoteId === 'new'[\s\S]{0,180}'Revert this edit'\}/);
    expect(src).toMatch(/handleRevertEdit=\{[\s\S]{0,220}handleUndoCurrent/);
  });

  test('handleAndroidBack invokes done handlers for swipe-to-save behavior', () => {
    expect(src).toMatch(/handleDoneDeload\(\)/);
    expect(src).toMatch(/handleDoneOther\(\)/);
    expect(src).toMatch(/handleDoneCurrent\(\)/);
  });
});

describe('explicit editor rollback: integration tests (#851)', () => {
  let mockUpdateNote;
  let mockUpdateDeload;
  let mockSelectCurrent;
  let currentNotesList;
  let rollbackAlertSpy;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    rollbackAlertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    currentNotesList = [
      { id: 'note1', title: 'Routine A', raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5', saved_at: '2026-06-01T12:00:00.000Z' }
    ];

    mockUpdateNote = jest.fn().mockImplementation(async (id, patch) => {
      currentNotesList = currentNotesList.map(n =>
        n.id === id ? { ...n, ...patch } : n
      );
    });

    mockSelectCurrent = jest.fn();
    mockUpdateDeload = jest.fn();

    useEntries.useWorkoutNotes.mockReturnValue({
      notes: currentNotesList,
      currentId: 'note1',
      currentNote: currentNotesList[0],
      deloadNotes: [],
      loading: false,
      error: null,
      refresh: jest.fn(),
      selectCurrent: mockSelectCurrent,
      update: mockUpdateNote,
      add: jest.fn(),
      remove: jest.fn(),
    });

    useEntries.useTrackedLifts.mockReturnValue({
      trackedLifts: [],
      toggle: jest.fn(),
    });

    useEntries.useDeloadNote.mockReturnValue({
      note: { raw_text: 'deload note text' },
      loading: false,
      save: jest.fn(),
      clear: jest.fn(),
    });

    useEntries.useDeloadHistory.mockReturnValue({
      history: [],
      completeDeload: jest.fn(),
      deleteDeload: jest.fn(),
      deleteDeloadNote: jest.fn(),
      updateDeload: mockUpdateDeload,
    });

    useEntries.useFeatureToggles.mockReturnValue({
      fatigueTrackingEnabled: false,
      deloadModeEnabled: false,
    });

    useEntries.useUserProfile.mockReturnValue({
      profile: { sex: 'male', height_cm: 180, activity_level: 'active' },
      save: jest.fn(),
      loading: false,
      clear: jest.fn(),
    });
  });

  afterEach(() => {
    rollbackAlertSpy.mockRestore();
    jest.useRealTimers();
  });

  const confirmRevert = async () => {
    const prompt = rollbackAlertSpy.mock.calls.find(call => call[0] === 'Revert this edit?');
    expect(prompt).toBeTruthy();
    const revert = prompt[2].find(button => button.text === 'Revert this edit');
    expect(revert).toEqual(expect.objectContaining({ style: 'destructive' }));
    await revert.onPress();
  };

  test('App Guide (HelpScreen) in MoreScreen renders the correct example syntax', () => {
    let component;
    render.act(() => {
      component = render.create(
        <MoreScreen
          onNavigate={jest.fn()}
          onExport={jest.fn()}
          onImport={jest.fn()}
          fatigueMultiplier={1}
          onUpdateFatigueMultiplier={jest.fn()}
         
          onUpdateWeightDateEditEnabled={jest.fn()}
          onUpdateDeloadDateEditEnabled={jest.fn()}
        />
      );
    });

    const root = component.root;

    // Navigate to App Guide (HelpScreen)
    const guideItem = findPressableByText(root, 'App Guide');
    expect(guideItem).toBeTruthy();
    render.act(() => {
      guideItem.props.onPress();
    });

    render.act(() => {
      root.findByProps({ accessibilityLabel: 'Logging workouts' }).props.onPress();
    });

    // Now HelpScreen should be active. Verify it displays the example text.
    const allTexts = root.findAllByType('Text');
    const flatTexts = allTexts.map(t => {
      const child = t.props.children;
      return Array.isArray(child) ? child.join('') : String(child ?? '');
    });

    // Assert that the displayed guide copy includes '-Barbell Bench Press' and '135 5,5,5'
    const hasBench = flatTexts.some(txt => txt.includes('-Barbell Bench Press'));
    const hasSets = flatTexts.some(txt => txt.includes('135 5,5,5'));

    expect(hasBench).toBe(true);
    expect(hasSets).toBe(true);
  });

  test('LogScreen TextInput placeholder contains the guide syntax (-Barbell Bench Press and 135 5,5,5)', () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledLogScreen />
      );
    });
    const textInputs = component.root.findAll(n => n.type === 'TextInput');
    const editorInput = textInputs.find(ti => ti.props.placeholder && ti.props.placeholder.includes('-Barbell Bench Press'));
    expect(editorInput).toBeTruthy();
    expect(editorInput.props.placeholder).toContain('-Barbell Bench Press');
    expect(editorInput.props.placeholder).toContain('135 5,5,5');
  });

  test('editing current note requires confirmation before reverting UI and DB', async () => {
    const setWorkoutNoteText = jest.fn();
    const setWorkoutNoteTitle = jest.fn();

    let component;
    render.act(() => {
      component = render.create(
        <ControlledLogScreen
          workoutNoteText="Original Text"
          setWorkoutNoteText={setWorkoutNoteText}
          workoutNoteTitle="Original Title"
          setWorkoutNoteTitle={setWorkoutNoteTitle}
        />
      );
    });

    const root = component.root;

    // #1021: Edit now lives behind the current-routine card's three-dot menu.
    openCurrentRoutineMenu(root);
    const editButton = findPressableByText(root, 'Edit');
    expect(editButton).toBeTruthy();
    render.act(() => {
      editButton.props.onPress({ stopPropagation: jest.fn() });
    });

    const revertButton = findPressableByText(root, 'Revert this edit');
    expect(revertButton).toBeTruthy();

    await render.act(async () => {
      revertButton.props.onPress();
      expect(mockUpdateNote).not.toHaveBeenCalled();
      await confirmRevert();
    });

    expect(mockUpdateNote).toHaveBeenCalledWith('note1', {
      title: 'Original Title',
      raw_text: 'Original Text',
      activeWeek: null,
    });

    expect(setWorkoutNoteText).toHaveBeenCalledWith('Original Text');
    expect(setWorkoutNoteTitle).toHaveBeenCalledWith('Original Title');
  });

  test('editing other note requires confirmation before reverting UI and DB', async () => {
    const otherNote = { id: 'note2', title: 'Routine B', raw_text: 'Original Other Text', saved_at: '2026-06-02T12:00:00.000Z' };

    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [
        { id: 'note1', title: 'Routine A', raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5', saved_at: '2026-06-01T12:00:00.000Z' },
        otherNote
      ],
      currentId: 'note1',
      currentNote: { id: 'note1', title: 'Routine A', raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5', saved_at: '2026-06-01T12:00:00.000Z' },
      deloadNotes: [],
      loading: false,
      error: null,
      refresh: jest.fn(),
      selectCurrent: mockSelectCurrent,
      update: mockUpdateNote,
      add: jest.fn(),
      remove: jest.fn(),
    });

    let component;
    render.act(() => {
      component = render.create(<ControlledLogScreen />);
    });

    const root = component.root;
    expandRoutineManagement(root);

    // Tap the other note to view it
    const targetPressable = findPressableByText(root, 'Routine B');
    expect(targetPressable).toBeTruthy();
    render.act(() => {
      targetPressable.props.onPress();
    });

    // Tap "Edit routine" button
    const editBtn = findPressableByText(root, 'Edit routine');
    expect(editBtn).toBeTruthy();
    render.act(() => {
      editBtn.props.onPress();
    });

    // Now in edit mode for other note. Verify text input value.
    const textInputs = root.findAllByType('TextInput');
    const textInput = textInputs.find(ti => ti.props.multiline);
    expect(textInput.props.value).toBe('Original Other Text');

    // Simulate typing
    render.act(() => {
      textInput.props.onChangeText('Changed Other Text');
    });

    const revertButton = findPressableByText(root, 'Revert this edit');
    expect(revertButton).toBeTruthy();
    await render.act(async () => {
      revertButton.props.onPress();
      expect(mockUpdateNote).not.toHaveBeenCalled();
      await confirmRevert();
    });

    expect(mockUpdateNote).toHaveBeenCalledWith('note2', {
      title: 'Routine B',
      raw_text: 'Original Other Text',
      activeWeek: null,
    });

    expect(textInput.props.value).toBe('Original Other Text');
  });

  test('a failed confirmed current-note revert leaves UI state intact and alerts', async () => {
    const setWorkoutNoteText = jest.fn();
    const setWorkoutNoteTitle = jest.fn();
    
    mockUpdateNote.mockRejectedValueOnce(new Error('DB error'));

    let component;
    render.act(() => {
      component = render.create(
        <ControlledLogScreen
          workoutNoteText="Original Text"
          setWorkoutNoteText={setWorkoutNoteText}
          workoutNoteTitle="Original Title"
          setWorkoutNoteTitle={setWorkoutNoteTitle}
        />
      );
    });

    const root = component.root;

    // #1021: Edit now lives behind the current-routine card's three-dot menu.
    openCurrentRoutineMenu(root);
    const editButton = findPressableByText(root, 'Edit');
    expect(editButton).toBeTruthy();
    render.act(() => {
      editButton.props.onPress({ stopPropagation: jest.fn() });
    });

    const revertButton = findPressableByText(root, 'Revert this edit');
    expect(revertButton).toBeTruthy();

    await render.act(async () => {
      revertButton.props.onPress();
      await confirmRevert();
    });

    expect(setWorkoutNoteText).not.toHaveBeenCalled();
    expect(setWorkoutNoteTitle).not.toHaveBeenCalled();
  });

  test('confirmed other-deload revert compensates history if note update fails', async () => {
    const deloadNoteId = 'note3';
    const deloadNote = {
      id: deloadNoteId,
      title: 'Deload · 2026-06-01',
      raw_text: 'Original Deload Text',
      saved_at: '2026-06-01T12:00:00.000Z',
    };
    const histRecord = {
      id: 'hist3',
      note_id: deloadNoteId,
      completed_at: '2026-06-01T12:00:00.000Z',
      deload_session_ordinal: 5,
    };

    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [
        { id: 'note1', title: 'Routine A', raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5', saved_at: '2026-06-01T12:00:00.000Z' },
        deloadNote
      ],
      currentId: 'note1',
      currentNote: { id: 'note1', title: 'Routine A', raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5', saved_at: '2026-06-01T12:00:00.000Z' },
      deloadNotes: [deloadNote],
      loading: false,
      error: null,
      refresh: jest.fn(),
      selectCurrent: mockSelectCurrent,
      update: mockUpdateNote,
      add: jest.fn(),
      remove: jest.fn(),
    });

    useEntries.useDeloadHistory.mockReturnValue({
      history: [histRecord],
      completeDeload: jest.fn(),
      deleteDeload: jest.fn(),
      deleteDeloadNote: jest.fn(),
      updateDeload: mockUpdateDeload,
    });

    useEntries.useFeatureToggles.mockReturnValue({
      fatigueTrackingEnabled: false,
      deloadModeEnabled: true,
    });

    // Force note update to fail, but let history update succeed
    mockUpdateNote.mockRejectedValueOnce(new Error('Note update failed'));
    mockUpdateDeload.mockResolvedValue(true);

    let component;
    render.act(() => {
      component = render.create(<ControlledLogScreen />);
    });

    const root = component.root;

    // Switch to Deload tab
    const deloadTabToggle = findPressableByText(root, 'Deload');
    expect(deloadTabToggle).toBeTruthy();
    render.act(() => {
      deloadTabToggle.props.onPress();
    });

    // Find and tap the deload note card in the list
    const deloadNoteCard = findPressableByText(root, 'Deload · 2026-06-01');
    expect(deloadNoteCard).toBeTruthy();
    render.act(() => {
      deloadNoteCard.props.onPress();
    });

    // Tap "Edit deload record" button
    const editBtn = findPressableByText(root, 'Edit deload record');
    expect(editBtn).toBeTruthy();
    render.act(() => {
      editBtn.props.onPress();
    });

    // Reveal the compact "Date · <value>" secondary row (#764) so the Session #
    // field (shown alongside the date once revealed) is on screen.
    const dateToggle = findPressableByText(root, 'Date ·');
    expect(dateToggle).toBeTruthy();
    render.act(() => {
      dateToggle.props.onPress();
    });

    // Find the session number input and change its value to 10
    const textInputs = root.findAllByType('TextInput');
    const ordinalInput = textInputs.find(ti => ti.props.placeholder === 'Session number');
    expect(ordinalInput).toBeTruthy();
    render.act(() => {
      ordinalInput.props.onChangeText('10');
    });

    const revertButton = findPressableByText(root, 'Revert this edit');
    expect(revertButton).toBeTruthy();
    await render.act(async () => {
      revertButton.props.onPress();
      await confirmRevert();
    });

    expect(mockUpdateDeload).toHaveBeenLastCalledWith('hist3', {
      completed_at: '2026-06-01T12:00:00.000Z',
      deload_session_ordinal: 10,
    });
  });

  test('confirmed other-deload revert compensates a cleared ordinal with null if note update fails', async () => {
    const deloadNoteId = 'note4';
    const deloadNote = {
      id: deloadNoteId,
      title: 'Deload · 2026-06-01',
      raw_text: 'Original Deload Text',
      saved_at: '2026-06-01T12:00:00.000Z',
    };
    const histRecord = {
      id: 'hist4',
      note_id: deloadNoteId,
      completed_at: '2026-06-01T12:00:00.000Z',
      deload_session_ordinal: 5,
    };

    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [
        { id: 'note1', title: 'Routine A', raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5', saved_at: '2026-06-01T12:00:00.000Z' },
        deloadNote
      ],
      currentId: 'note1',
      currentNote: { id: 'note1', title: 'Routine A', raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5', saved_at: '2026-06-01T12:00:00.000Z' },
      deloadNotes: [deloadNote],
      loading: false,
      error: null,
      refresh: jest.fn(),
      selectCurrent: mockSelectCurrent,
      update: mockUpdateNote,
      add: jest.fn(),
      remove: jest.fn(),
    });

    useEntries.useDeloadHistory.mockReturnValue({
      history: [histRecord],
      completeDeload: jest.fn(),
      deleteDeload: jest.fn(),
      deleteDeloadNote: jest.fn(),
      updateDeload: mockUpdateDeload,
    });

    useEntries.useFeatureToggles.mockReturnValue({
      fatigueTrackingEnabled: false,
      deloadModeEnabled: true,
    });

    mockUpdateNote.mockRejectedValueOnce(new Error('Note update failed'));
    mockUpdateDeload.mockResolvedValue(true);

    let component;
    render.act(() => {
      component = render.create(<ControlledLogScreen />);
    });

    const root = component.root;

    // Switch to Deload tab
    const deloadTabToggle = findPressableByText(root, 'Deload');
    expect(deloadTabToggle).toBeTruthy();
    render.act(() => {
      deloadTabToggle.props.onPress();
    });

    // Find and tap the deload note card
    const deloadNoteCard = findPressableByText(root, 'Deload · 2026-06-01');
    expect(deloadNoteCard).toBeTruthy();
    render.act(() => {
      deloadNoteCard.props.onPress();
    });

    // Tap "Edit deload record"
    const editBtn = findPressableByText(root, 'Edit deload record');
    expect(editBtn).toBeTruthy();
    render.act(() => {
      editBtn.props.onPress();
    });

    // Reveal the compact "Date · <value>" secondary row (#764) so the Session #
    // field (shown alongside the date once revealed) is on screen.
    const dateToggle = findPressableByText(root, 'Date ·');
    expect(dateToggle).toBeTruthy();
    render.act(() => {
      dateToggle.props.onPress();
    });

    // Find session number input and clear it
    const textInputs = root.findAllByType('TextInput');
    const ordinalInput = textInputs.find(ti => ti.props.placeholder === 'Session number');
    expect(ordinalInput).toBeTruthy();
    render.act(() => {
      ordinalInput.props.onChangeText('');
    });

    const revertButton = findPressableByText(root, 'Revert this edit');
    expect(revertButton).toBeTruthy();
    await render.act(async () => {
      revertButton.props.onPress();
      await confirmRevert();
    });

    // Check that updateDeload compensating rollback was called with deload_session_ordinal: null
    expect(mockUpdateDeload).toHaveBeenLastCalledWith('hist4', {
      completed_at: '2026-06-01T12:00:00.000Z',
      deload_session_ordinal: null,
    });
  });
});

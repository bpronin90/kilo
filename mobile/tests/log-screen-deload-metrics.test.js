import { installRendererCleanup } from './helpers/log-screen';
import React from 'react';
import render from 'react-test-renderer';
import * as useEntries from '../hooks/useEntries';
import { parseWorkoutNote, weeksSinceLastDeload, sessionsSinceLastDeload } from '../lib/parser';
import { deriveRoutineStatus } from '../lib/data';
import { Alert } from 'react-native';
import { LogDeloadSection } from '../components/LogDeloadSection';
import { finishSheetDismiss, findPressableByText, ControlledLogScreen } from './helpers/log-screen';

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

// ── deload date edit: two-metric model ───────────────────────────────────────

const MOCK_NOW_MS_LOG = new Date('2026-06-06T12:00:00.000Z').getTime();

describe('deload date edit: sessions and weeks are independent metrics', () => {
  beforeEach(() => { jest.spyOn(Date, 'now').mockReturnValue(MOCK_NOW_MS_LOG); });
  afterEach(() => { jest.restoreAllMocks(); });

  test('editing completed_at changes weeksSinceLastDeload but leaves session_count untouched', () => {
    const totalSessions = 14;
    // Deload originally completed May 9 (4 weeks ago); user corrects to May 16 (3 weeks ago)
    const originalRecord = { id: 'dl_1', completed_at: '2026-05-09T12:00:00.000Z', session_count: 11 };
    const editedRecord   = { id: 'dl_1', completed_at: '2026-05-16T12:00:00.000Z', session_count: 11 };

    expect(sessionsSinceLastDeload(totalSessions, [originalRecord])).toBe(3);
    expect(sessionsSinceLastDeload(totalSessions, [editedRecord])).toBe(3); // unchanged

    expect(weeksSinceLastDeload([originalRecord])).toBe(4);
    expect(weeksSinceLastDeload([editedRecord])).toBe(3);   // updated
  });

  test('sessions since deload only depends on session_count, not completed_at', () => {
    const totalSessions = 20;
    const history = [{ id: 'dl_1', completed_at: '2026-01-01T12:00:00.000Z', session_count: 15 }];
    expect(sessionsSinceLastDeload(totalSessions, history)).toBe(5);
  });

  test('weeks since deload only depends on completed_at, not session_count', () => {
    // 14 days = 2 full weeks
    const history = [{ id: 'dl_1', completed_at: '2026-05-23T12:00:00.000Z', session_count: 99 }];
    expect(weeksSinceLastDeload(history)).toBe(2);
  });

  test('legacy records without note_id work for both metrics', () => {
    const history = [{ id: 'dl_legacy', completed_at: '2026-05-23T12:00:00.000Z', session_count: 5 }];
    expect(sessionsSinceLastDeload(10, history)).toBe(5);
    expect(weeksSinceLastDeload(history)).toBe(2);
  });

  test('date edit with no linked history record must not change the analytics anchor (desync guard)', () => {
    // Simulate the save-path contract: if histRecord is not found, saved_at should NOT
    // be applied. The session and weeks metrics must remain based on the original record.
    const totalSessions = 8;
    const legacyRecord = { id: 'dl_legacy', completed_at: '2026-05-23T12:00:00.000Z', session_count: 5 };
    // After attempted date change (no histRecord found, save blocked):
    expect(sessionsSinceLastDeload(totalSessions, [legacyRecord])).toBe(3);
    expect(weeksSinceLastDeload([legacyRecord])).toBe(2);
    // The record is unchanged — same values before and after.
    expect(legacyRecord.completed_at).toBe('2026-05-23T12:00:00.000Z');
  });
});

// ── deload_session_ordinal: session-ordinal anchor (#284) ─────────────────────
// Ordinal logic lives in deriveRoutineStatus (data.js); test via that entry point.

function rawWithSessions(n) {
  return ['Monday', '+ lifting', '1. Squat', ...Array(n).fill('- 225x5')].join('\n');
}

function sectionsWithSessions(n) {
  return parseWorkoutNote(rawWithSessions(n)).sections;
}

describe('deload_session_ordinal: ordinal-based sessions-since-deload (#284)', () => {
  const NOTE = { saved_at: '2026-04-06T00:00:00.000Z' };

  test('ordinal takes precedence over stale session_count', () => {
    // New-format record: session_count=99 is stale; ordinal=4 (pre-deload count, deload_ordinal_is_count=true) wins.
    const history = [{ id: 'dl', completed_at: '2026-04-20T12:00:00.000Z', session_count: 99, deload_session_ordinal: 4, deload_ordinal_is_count: true }];
    expect(deriveRoutineStatus(sectionsWithSessions(5), NOTE, history).sessionsSinceDeload).toBe(1);
    expect(deriveRoutineStatus(sectionsWithSessions(4), NOTE, history).sessionsSinceDeload).toBe(0);
    expect(deriveRoutineStatus(sectionsWithSessions(7), NOTE, history).sessionsSinceDeload).toBe(3);
  });

  test('freshly completed deload (no new sessions yet) reads 0', () => {
    // 4 sessions in note, ordinal=4 (pre-deload count) → max(0, 4-4)=0.
    const history = [{ id: 'dl', completed_at: '2026-05-01T00:00:00.000Z', session_count: 4, deload_session_ordinal: 4 }];
    expect(deriveRoutineStatus(sectionsWithSessions(4), NOTE, history).sessionsSinceDeload).toBe(0);
  });

  test('first post-deload session reads 1', () => {
    const history = [{ id: 'dl', completed_at: '2026-05-01T00:00:00.000Z', session_count: 4, deload_session_ordinal: 4 }];
    expect(deriveRoutineStatus(sectionsWithSessions(5), NOTE, history).sessionsSinceDeload).toBe(1);
  });

  test('legacy records without deload_session_ordinal fall through to session_count', () => {
    const history = [{ id: 'dl', completed_at: '2026-05-01T00:00:00.000Z', session_count: 10 }];
    expect(deriveRoutineStatus(sectionsWithSessions(14), NOTE, history).sessionsSinceDeload).toBe(4);
  });

  test('user-corrected ordinal counts correctly for partial-import scenario', () => {
    // App note has 2 sessions (imported last 2 of a real 14-session routine).
    // Default prefill would be 2; user corrects to 14 (real pre-deload count, deload_ordinal_is_count=true).
    const history = [{ id: 'dl', completed_at: '2026-05-01T00:00:00.000Z', session_count: 2, deload_session_ordinal: 14, deload_ordinal_is_count: true }];
    // Before the note accumulates enough sessions past anchor 14, still 0.
    expect(deriveRoutineStatus(sectionsWithSessions(2), NOTE, history).sessionsSinceDeload).toBe(0);
    // Once note reaches session 15 (one beyond ordinal 14), first post-deload session = 1.
    expect(deriveRoutineStatus(sectionsWithSessions(15), NOTE, history).sessionsSinceDeload).toBe(1);
    expect(deriveRoutineStatus(sectionsWithSessions(17), NOTE, history).sessionsSinceDeload).toBe(3);
  });
});

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

describe('deload ordinal prompt: prefill and editability contract (#284)', () => {
  let src;
  beforeAll(() => {
    src = readLogScreenSource();
  });

  test('prompt is prefilled with logSessionCount (pre-deload session count)', () => {
    expect(src).toMatch(/setDeloadOrdinalInput\(String\(logSessionCount\)\)/);
  });

  test('prompt input is editable: onChangeText wired to setDeloadOrdinalInput', () => {
    expect(src).toMatch(/onChangeText\s*=\s*\{setDeloadOrdinalInput\}/);
  });

  test('confirm handler parses user input as integer', () => {
    expect(src).toMatch(/parseInt\(deloadOrdinalInput,\s*10\)/);
  });

  test('confirm handler forwards parsed ordinal to completeDeload', () => {
    expect(src).toMatch(/deloadSessionOrdinal\s*:\s*ordinal/);
  });
});

// ── deload date edit: save-flow stuck-state prevention ───────────────────────
// These source-level assertions prove that the save path cannot remain stuck in
// a pending state when the user presses Done while an autosave is in flight.
// The component cannot be rendered in this env, so we assert the code structure.

describe('deload date edit: save flow does not get stuck in pending state', () => {
  let src;
  beforeAll(() => {
    src = readLogScreenSource();
  });

  test('handleSaveOtherNote uses an in-flight ref guard, not a bare noteIsSaving return', () => {
    // The old guard `if (noteIsSaving) return;` returned undefined, causing
    // handleDoneOther to treat the in-flight autosave as a failure. The fix
    // replaces it with an in-flight promise ref so callers can chain on the
    // running save rather than receiving undefined.
    expect(src).toMatch(/saveOtherNoteInFlightRef\.current/);
    expect(src).not.toMatch(/if\s*\(\s*noteIsSaving\s*\)\s*return\s*;/);
  });

  test('in-flight ref is returned when a concurrent save is already running', () => {
    // When saveOtherNoteInFlightRef.current is non-null, the function must return
    // it so the caller awaits the real result rather than undefined.
    expect(src).toMatch(/if\s*\(\s*saveOtherNoteInFlightRef\.current\s*\)\s*return\s+saveOtherNoteInFlightRef\.current/);
  });

  test('in-flight ref is cleared in the finally block so it never leaks', () => {
    // Leak would leave saveOtherNoteInFlightRef.current non-null after the save,
    // preventing any future save from starting.
    expect(src).toMatch(/finally[\s\S]{0,200}saveOtherNoteInFlightRef\.current\s*=\s*null/);
  });

  test('setNoteIsSaving(false) is in a finally block in the deload save path', () => {
    // Guarantees noteIsSaving is always reset regardless of success or failure,
    // preventing the save-spinner state from getting permanently stuck.
    expect(src).toMatch(/finally[\s\S]{0,200}setNoteIsSaving\s*\(\s*false\s*\)/);
  });

  test('deload date save path calls updateDeload before update on date change', () => {
    // Both the history record and the note record must be updated. If updateDeload
    // is absent the history anchor drifts from the note saved_at date.
    expect(src).toMatch(/await\s+updateDeload\s*\([\s\S]{0,700}await\s+update\s*\(\s*editingNoteId/);
  });

  test('deload save path writes deload_session_ordinal into the deloadPatch', () => {
    // The ordinal field must flow through the consolidated deloadPatch so that
    // a single updateDeload call carries both date and ordinal changes.
    expect(src).toMatch(/deload_session_ordinal/);
    expect(src).toMatch(/deloadPatch\.deload_session_ordinal/);
  });

  test('deload ordinal input strips non-numeric characters', () => {
    // The TextInput onChangeText handler must sanitize to digits only so the
    // parseInt call downstream always receives a clean integer string.
    expect(src).toMatch(/replace\s*\(\s*\/\[.*\^.*0-9.*\].*\/.*,\s*''\s*\)/);
  });

  test('deload date picker uses onChange callback prop', () => {
    // Assert that the deload DateTimePicker uses onChange prop rather than onValueChange
    expect(src).toMatch(/<DateTimePicker[\s\S]*?onChange\s*=\s*\{/);
    expect(src).not.toMatch(/<DateTimePicker[\s\S]*?onValueChange\s*=\s*\{/);
  });
});

// ── Web deload-date fallback: web-compatible date editing path (#314) ─────────
// The native @react-native-community/datetimepicker has no usable web rendering,
// so the Log deload-date editor must render a real DOM <input type="date"> on
// web while keeping the native Android Pressable + DateTimePicker modal path.
describe('Log deload date web fallback renders a DOM date input (#314)', () => {
  const fsLocal = require('fs');
  const pathLocal = require('path');
  let editorSrc;
  beforeAll(() => {
    editorSrc = fsLocal.readFileSync(
      pathLocal.join(__dirname, '../components/LogScreenEditorCard.js'),
      'utf8'
    );
  });

  test('branches the deload date control on Platform.OS === "web"', () => {
    // The web/native branch renders only once the linked-record safety
    // boundary (editingDeloadHasLinkedRecord) has already gated the reveal
    // (#764: the compact "Date · <value>" row).
    expect(editorSrc).toMatch(/editingDeloadHasLinkedRecord\s*&&\s*dateFieldOpen[\s\S]{0,400}Platform\.OS\s*===\s*'web'/);
  });

  test('web path renders a real <input type="date"> via WebDateInput', () => {
    expect(editorSrc).toMatch(/function\s+WebDateInput/);
    expect(editorSrc).toMatch(/createElement\(\s*'input'/);
    expect(editorSrc).toMatch(/type:\s*'date'/);
  });

  test('web date input is capped at today via max', () => {
    expect(editorSrc).toMatch(/max:\s*localDateToday\(\)/);
  });

  test('web date input writes the new date back through the existing setters', () => {
    expect(editorSrc).toMatch(/onChangeDate=\{\(newDateStr\)\s*=>\s*\{[\s\S]*?setDeloadEditDate\(newDateStr\)/);
    expect(editorSrc).toMatch(/setEditingTitle\(DELOAD_NOTE_PREFIX\s*\+\s*newDateStr\)/);
  });

  test('native Android path keeps the Pressable + DateTimePicker modal', () => {
    expect(editorSrc).toMatch(/onPress=\{\(\)\s*=>\s*setShowDeloadDatePicker\(true\)/);
    expect(editorSrc).toMatch(/<DateTimePicker[\s\S]*?onChange\s*=\s*\{/);
  });
});

describe('active deload deletion (#560)', () => {
  let alertSpy;
  let clearDeloadNote;
  let setActiveDeload;

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    clearDeloadNote = jest.fn(() => setActiveDeload(null));

    const currentNote = {
      id: 'note1',
      title: 'Routine A',
      raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5',
      saved_at: '2026-06-01T12:00:00.000Z',
    };
    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [currentNote],
      currentId: 'note1',
      currentNote,
      deloadNotes: [],
      loading: false,
      error: null,
      refresh: jest.fn(),
      selectCurrent: jest.fn(),
      update: jest.fn(),
      add: jest.fn(),
      remove: jest.fn(),
    });
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: [], toggle: jest.fn() });
    useEntries.useDeloadNote.mockImplementation(() => {
      const [note, setNote] = React.useState({
        raw_text: 'deload note text',
        saved_at: '2026-06-01T12:00:00.000Z',
      });
      setActiveDeload = setNote;
      return { note, loading: false, save: jest.fn(), clear: clearDeloadNote };
    });
    useEntries.useDeloadHistory.mockReturnValue({
      history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
    });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: true });
  });

  afterEach(() => alertSpy.mockRestore());

  const openDeloadTab = (root) => {
    render.act(() => { findPressableByText(root, 'Deload').props.onPress(); });
  };
  // #1329: Delete active deload lives in the card's More deload actions sheet.
  const openDeloadMenu = (root) => {
    const trigger = root.findAll(n => n.props && n.props.accessibilityLabel === 'More deload actions' && typeof n.props.onPress === 'function')[0];
    render.act(() => { trigger.props.onPress(); });
  };

  test('cancel leaves the active deload unchanged', () => {
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;
    openDeloadTab(root);
    openDeloadMenu(root);

    render.act(() => { findPressableByText(root, 'Delete active deload').props.onPress(); });
    finishSheetDismiss(root);
    expect(alertSpy).toHaveBeenCalledWith(
      'Delete active deload?',
      'This will remove the active deload and cannot be undone.',
      expect.any(Array),
    );
    const cancel = alertSpy.mock.calls[0][2].find(button => button.text === 'Cancel');
    expect(cancel.onPress).toBeUndefined();
    expect(clearDeloadNote).not.toHaveBeenCalled();
    openDeloadMenu(root);
    expect(findPressableByText(root, 'Delete active deload')).toBeTruthy();
  });

  test('confirm clears the active deload and returns to Generate deload', async () => {
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;
    openDeloadTab(root);
    openDeloadMenu(root);
    render.act(() => { findPressableByText(root, 'Delete active deload').props.onPress(); });
    finishSheetDismiss(root);

    const remove = alertSpy.mock.calls[0][2].find(button => button.text === 'Delete');
    await render.act(async () => { await remove.onPress(); });

    expect(clearDeloadNote).toHaveBeenCalledTimes(1);
    expect(findPressableByText(root, 'Generate deload')).toBeTruthy();
    expect(findPressableByText(root, 'Delete active deload')).toBeNull();
  });

  test('delete is unavailable while editing the active deload', () => {
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;
    openDeloadTab(root);
    render.act(() => { findPressableByText(root, 'Edit').props.onPress({ stopPropagation: jest.fn() }); });

    expect(findPressableByText(root, 'Delete active deload')).toBeNull();
  });
});

describe('LogDeloadSection deload ordinal input has autocorrect disabled', () => {
  test('deload ordinal modal TextInput has autoCorrect={false}, autoCapitalize="none", spellCheck={false}', () => {
    let component;
    const completeDeloadMock = jest.fn();

    render.act(() => {
      component = render.create(
        <LogDeloadSection
          deloadNote={{ raw_text: 'test deload' }}
          deloadLoading={false}
          deloadDayGroups={[]}
          enterDeloadEditor={jest.fn()}
          handleDeloadBodyPress={jest.fn()}
          deloadMode="read"
          completeDeload={completeDeloadMock}
          clearDeloadNote={jest.fn()}
          handleGenerateDeload={jest.fn()}
          isGenerating={false}
          workoutNoteText="test"
          saveError={null}
          deloadNotes={[]}
          deloadHistory={[]}
          deleteDeloadNote={jest.fn()}
          deleteDeload={jest.fn()}
          viewingNoteId={null}
          handleViewOtherNote={jest.fn()}
          viewingNote={null}
          viewingNoteDayGroups={[]}
          handleOpenOtherNote={jest.fn()}
          logSessionCount={5}
        />
      );
    });

    const root = component.root;

    // Find and click the "Deload complete" button to trigger the ordinal modal
    const deloadCompleteButton = root.findByProps({ title: 'Deload complete' });
    expect(deloadCompleteButton).toBeTruthy();

    render.act(() => {
      deloadCompleteButton.props.onPress();
    });

    // Find the ordinal TextInput in the modal (number-pad keyboard, ordinal input)
    const textInputs = root.findAllByType('TextInput');
    const ordinalInput = textInputs.find(ti =>
      ti.props.keyboardType === 'number-pad' && ti.props.selectTextOnFocus
    );

    expect(ordinalInput).toBeTruthy();
    expect(ordinalInput.props.autoCorrect).toBe(false);
    expect(ordinalInput.props.autoCapitalize).toBe('none');
    expect(ordinalInput.props.spellCheck).toBe(false);
  });
});

// ── #989: deload generation freezes working context; completion witnesses it ──
//
// Generating a deload calls captureDeloadWorkingContext against the current
// routine's parsed sections + stable id and stores the frozen snapshot beside
// the active deload. Completing it calls buildDeloadReentryRecord so the new
// history record carries pre_deload_context; a missing snapshot degrades to the
// legacy record shape.
describe('deload re-entry context capture and completion (#989)', () => {
  const { useLogDeloadEditor } = require('../screens/log/useLogDeloadEditor');
  const RealStorage = jest.requireActual('../storage/entries');
  const { useDeloadHistory: realUseDeloadHistory } = jest.requireActual('../hooks/entries/deloadHooks');

  const ROUTINE_AT_DELOAD = [
    'Monday',
    '+LIFTING EXERCISE',
    '-Bench 3x5',
    '185 5,5,5',
    '185 5,5,5',
    '185 5,5,5',
  ].join('\n');
  const ROUTINE_FIRST_BACK = ROUTINE_AT_DELOAD + '\n185 5,5,5';

  let renderer;
  afterEach(() => {
    if (renderer) { render.act(() => renderer.unmount()); renderer = null; }
  });

  async function clearStore() {
    await require('@react-native-async-storage/async-storage').clear();
  }

  test('generating a deload passes a v1 working-context snapshot keyed to the current routine id', async () => {
    await clearStore();
    const save = jest.fn().mockResolvedValue({});
    let api = null;
    function Harness() {
      api = useLogDeloadEditor({
        deloadNote: null,
        saveDeloadNote: save,
        workoutNoteText: ROUTINE_AT_DELOAD,
        editorScrollRef: { current: { scrollTo: jest.fn() } },
        currentId: 'wn_src',
      });
      return null;
    }
    render.act(() => { renderer = render.create(<Harness />); });
    await render.act(async () => { await api.handleGenerateDeload(); });

    expect(save).toHaveBeenCalledTimes(1);
    const [text, ctx] = save.mock.calls[0];
    expect(typeof text).toBe('string');
    expect(ctx).toMatchObject({ version: 1, source_note_id: 'wn_src' });
    expect(ctx.exercises.bench).toMatchObject({ working_weight_lb: 185 });
  });

  test('completing a deload writes pre_deload_context witnessed against the current source routine', async () => {
    await clearStore();
    const { captureDeloadWorkingContext } = jest.requireActual('../lib/parser/deloadHistory');
    const { parseWorkoutNote } = jest.requireActual('../lib/parser');

    const frozen = captureDeloadWorkingContext(parseWorkoutNote(ROUTINE_AT_DELOAD).sections, 'wn_src');
    await RealStorage.saveDeloadNote('Deload week text', frozen);
    await RealStorage.saveCurrentWorkoutId('wn_src');
    await RealStorage.saveWorkoutNoteItem({
      id: 'wn_src', title: 'Routine', raw_text: ROUTINE_AT_DELOAD,
      saved_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-06-01T00:00:00.000Z',
      tracked_exercises: [], one_k_exercises: null,
    });

    let hook = null;
    function Harness() { hook = realUseDeloadHistory(); return null; }
    render.act(() => { renderer = render.create(<Harness />); });

    let record;
    await render.act(async () => {
      record = await hook.completeDeload({ sessionCount: 3, deloadSessionOrdinal: 1 });
    });

    expect(record.pre_deload_context).toMatchObject({ version: 1, source_note_id: 'wn_src' });
    expect(record.pre_deload_context.exercises.bench).toMatchObject({ working_weight_lb: 185 });

    const persisted = await RealStorage.loadDeloadHistory();
    expect(persisted.find(r => r.id === record.id).pre_deload_context.version).toBe(1);
  });

  test('completing with no frozen snapshot degrades to the legacy record shape', async () => {
    await clearStore();
    await RealStorage.saveDeloadNote('Deload week text'); // no working_context
    await RealStorage.saveCurrentWorkoutId('wn_src');
    await RealStorage.saveWorkoutNoteItem({
      id: 'wn_src', title: 'Routine', raw_text: ROUTINE_AT_DELOAD,
      saved_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-06-01T00:00:00.000Z',
      tracked_exercises: [], one_k_exercises: null,
    });

    let hook = null;
    function Harness() { hook = realUseDeloadHistory(); return null; }
    render.act(() => { renderer = render.create(<Harness />); });

    let record;
    await render.act(async () => {
      record = await hook.completeDeload({ sessionCount: 3, deloadSessionOrdinal: 1 });
    });
    expect(record).not.toHaveProperty('pre_deload_context');
    expect(record.session_count).toBe(3);
  });

  test('witnesses against the routine the deload was generated from, not the current routine', async () => {
    await clearStore();
    const { captureDeloadWorkingContext } = jest.requireActual('../lib/parser/deloadHistory');
    const { parseWorkoutNote } = jest.requireActual('../lib/parser');

    // Generated from wn_A (has Bench). The user then switched the current
    // routine to wn_B (Squat only, no Bench).
    const frozen = captureDeloadWorkingContext(parseWorkoutNote(ROUTINE_AT_DELOAD).sections, 'wn_A');
    await RealStorage.saveDeloadNote('Deload week text', frozen);
    await RealStorage.saveWorkoutNoteItem({
      id: 'wn_A', title: 'A', raw_text: ROUTINE_AT_DELOAD,
      saved_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-06-01T00:00:00.000Z',
      tracked_exercises: [], one_k_exercises: null,
    });
    await RealStorage.saveWorkoutNoteItem({
      id: 'wn_B', title: 'B', raw_text: 'Monday\n+LIFTING EXERCISE\n-Squat 3x5\n315 5,5,5',
      saved_at: '2026-06-02T00:00:00.000Z', updated_at: '2026-06-02T00:00:00.000Z',
      tracked_exercises: [], one_k_exercises: null,
    });
    await RealStorage.saveCurrentWorkoutId('wn_B');

    let hook = null;
    function Harness() { hook = realUseDeloadHistory(); return null; }
    render.act(() => { renderer = render.create(<Harness />); });

    let record;
    await render.act(async () => {
      record = await hook.completeDeload({ sessionCount: 3, deloadSessionOrdinal: 1 });
    });

    expect(record.pre_deload_context.source_note_id).toBe('wn_A');
    // The boundary came from wn_A's Bench, not wn_B (which has no Bench).
    expect(record.pre_deload_context.exercises.bench).toMatchObject({ working_weight_lb: 185 });
    expect(record.pre_deload_context.exercises).not.toHaveProperty('squat');
  });

  test('degrades to the legacy shape when the snapshot source routine no longer exists', async () => {
    await clearStore();
    const { captureDeloadWorkingContext } = jest.requireActual('../lib/parser/deloadHistory');
    const { parseWorkoutNote } = jest.requireActual('../lib/parser');
    const frozen = captureDeloadWorkingContext(parseWorkoutNote(ROUTINE_AT_DELOAD).sections, 'wn_gone');
    await RealStorage.saveDeloadNote('Deload week text', frozen);
    await RealStorage.saveCurrentWorkoutId('wn_other');
    await RealStorage.saveWorkoutNoteItem({
      id: 'wn_other', title: 'Other', raw_text: ROUTINE_AT_DELOAD,
      saved_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-06-01T00:00:00.000Z',
      tracked_exercises: [], one_k_exercises: null,
    });

    let hook = null;
    function Harness() { hook = realUseDeloadHistory(); return null; }
    render.act(() => { renderer = render.create(<Harness />); });

    let record;
    await render.act(async () => {
      record = await hook.completeDeload({ sessionCount: 3, deloadSessionOrdinal: 1 });
    });
    expect(record).not.toHaveProperty('pre_deload_context');
  });
});

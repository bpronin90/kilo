import { installRendererCleanup } from './helpers/log-screen';
import render from 'react-test-renderer';
import { LogActiveRoutineCard } from '../components/LogActiveRoutineCard';
import * as useEntries from '../hooks/useEntries';
import { deriveWorkoutAnalytics, normalizeExerciseKey } from '../lib/parser';
import { loggedSessionUnits } from '../lib/parser/analytics';
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
  // #1606: the card is composed in LogRoutineReadView and its Routine actions
  // items live in LogRoutineActionSheet.
  const readView = fs.readFileSync(path.join(__dirname, '../screens/log/LogRoutineReadView.js'), 'utf8');
  const actionSheet = fs.readFileSync(path.join(__dirname, '../components/log/LogRoutineActionSheet.js'), 'utf8');
  return readView + '\n' + actionSheet + '\n' + main + '\n' + deload + '\n' + editor + '\n' + active + '\n' + previous + '\n' + helpers + '\n' + currentEditorHook + '\n' + otherEditorHook + '\n' + deloadEditorHook + '\n' + logHelpersLocal;
}

describe('Log web edit path: explicit edit control is wired (#314)', () => {
  let src;
  beforeAll(() => {
    src = readLogScreenSource();
  });

  test('enterCurrentEditor performs a single-press editor entry (no double-tap gate)', () => {
    // The explicit handler enters through the normal draft-restoring path,
    // unlike handleNoteBodyPress which is gated behind a double-tap window.
    expect(src).toMatch(/const\s+enterCurrentEditor\s*=\s*\(\)\s*=>\s*openCurrentEditor\(\{\s*restoreDraft:\s*true\s*\}\)/);
  });

  test('LogScreen forwards enterCurrentEditor to the active routine card', () => {
    // #1606: LogRoutineReadView builds the card props object for LogScreen.
    expect(src).toMatch(/enterCurrentEditor(?:=\{|: )(?:currentEditor\.|ce\.)?enterCurrentEditor\b/);
  });

  test('active routine card renders an explicit Edit control bound to enterCurrentEditor', () => {
    // LogActiveRoutineCard exposes a single-press "Edit" button (web-usable path)
    // separate from the double-tap body handler.
    // #1244: the Edit item is a data-driven Routine actions menu entry.
    expect(src).toMatch(/label: 'Edit', icon: 'edit', a11y: 'Edit routine', run: enterCurrentEditor/);
  });
});

describe('current routine share wiring (#969)', () => {
  test.each(['A', 'B'])('the rendered card receives the full stored body while Week %s is active', (activeWeek) => {
    jest.clearAllMocks();
    const raw = 'Monday\n-Bench Press\n135 5,5,5\n---\nTuesday\n-Squat\n225 5,5,5\n';
    const note = { id: 'ab-routine', title: 'A/B Routine', raw_text: raw, activeWeek };
    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [note], currentId: note.id, currentNote: note, deloadNotes: [],
      loading: false, error: null, refresh: jest.fn(), selectCurrent: jest.fn(),
      update: jest.fn(), add: jest.fn(), remove: jest.fn(),
    });
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: {}, activations: {}, toggle: jest.fn() });
    useEntries.useDeloadNote.mockReturnValue({ note: null, loading: false, save: jest.fn(), clear: jest.fn() });
    useEntries.useDeloadHistory.mockReturnValue({
      history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(),
      deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
    });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: false });
    useEntries.useUserProfile.mockReturnValue({ profile: null, save: jest.fn(), loading: false, clear: jest.fn() });

    let component;
    render.act(() => { component = render.create(<ControlledLogScreen initialText={note.raw_text} />); });
    try {
      const card = component.root.findByType(LogActiveRoutineCard);
      expect(card.props.hasABWeeks).toBe(true);
      expect(card.props.effectiveActiveWeek).toBe(activeWeek);
      expect(card.props.activeEditText).not.toContain('---');
      expect(card.props.activeEditText).toContain(activeWeek === 'A' ? 'Bench Press' : 'Squat');
      expect(card.props.routineRawText).toBe(note.raw_text);
    } finally {
      render.act(() => { component.unmount(); });
    }
  });
});

// ── Track activation population (#893, PR #895 review finding 1) ─────────────
//
// The anchor is counted over the routines the user actually has. A brand-new
// routine has no id and no entry in `notes` yet its Track action is live, so if
// its text is not appended explicitly the population comes out empty, the anchor
// is 0, and every session already typed into that routine stays inside the "new"
// trend — the exact comparison the watermark exists to prevent.
describe('the population a Track activation is anchored in (#893)', () => {
  let toggle;

  function setup({ notes, currentId, currentNote }) {
    jest.clearAllMocks();
    toggle = jest.fn().mockResolvedValue({});
    useEntries.useWorkoutNotes.mockReturnValue({
      notes,
      currentId,
      currentNote,
      deloadNotes: [],
      loading: false,
      error: null,
      refresh: jest.fn(),
      selectCurrent: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      add: jest.fn(),
      remove: jest.fn(),
    });
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: {}, activations: {}, toggle, reconcileActivations: jest.fn() });
    useEntries.useDeloadNote.mockReturnValue({ note: null, loading: false, save: jest.fn() });
    useEntries.useDeloadHistory.mockReturnValue({ history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn() });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: false });
    useEntries.useUserProfile.mockReturnValue({ profile: null, save: jest.fn(), loading: false, clear: jest.fn() });
  }

  // The handler LogScreen hands the renderer, reached through the rendered tree
  // rather than reconstructed, so this exercises the real wiring.
  function pressTrack(component, exerciseName) {
    const handler = component.root
      .findAll((n) => typeof n.props?.onToggleTrack === 'function')
      .map((n) => n.props.onToggleTrack)[0];
    expect(handler).toBeTruthy();
    render.act(() => { handler(exerciseName); });
  }

  function loggedSessionCount(sections, name) {
    const { exercises } = deriveWorkoutAnalytics(sections);
    const key = normalizeExerciseKey(name);
    const ex = exercises.find((e) => normalizeExerciseKey(e.name) === key);
    return ex ? loggedSessionUnits(ex.occurrences).length : 0;
  }

  test('a saved routine anchors on the sessions already in it', () => {
    const raw = 'Monday\n-Bench\n225 5\n235 5\n245 5';
    const note = { id: 'note1', title: 'Routine A', raw_text: raw, saved_at: '2026-06-01T12:00:00.000Z' };
    setup({ notes: [note], currentId: 'note1', currentNote: note });

    let component;
    render.act(() => {
      component = render.create(<ControlledLogScreen workoutNoteText={raw} initialText={raw} />);
    });
    pressTrack(component, 'Bench');

    expect(toggle).toHaveBeenCalledTimes(1);
    const [key, sections] = toggle.mock.calls[0];
    expect(key).toBe('bench');
    expect(loggedSessionCount(sections, 'Bench')).toBe(3);
  });

  test('a routine with no current id anchors on its live text, not on nothing', () => {
    const raw = 'Monday\n-Bench\n225 5\n235 5\n245 5';
    // `currentId` is null and no item in `notes` carries this text, yet the
    // read-mode active-routine card still offers Track.
    const other = { id: 'other', title: 'Old Routine', raw_text: 'Friday\n-Curl\n30 10', saved_at: '2026-05-01T12:00:00.000Z' };
    setup({ notes: [other], currentId: null, currentNote: null });

    let component;
    render.act(() => {
      component = render.create(<ControlledLogScreen workoutNoteText={raw} initialText={raw} />);
    });
    pressTrack(component, 'Bench');

    expect(toggle).toHaveBeenCalledTimes(1);
    const [, sections] = toggle.mock.calls[0];
    // Before the fix this was 0: the live text matched no note, so the anchor
    // excluded nothing and all three sessions stayed inside the new trend.
    expect(loggedSessionCount(sections, 'Bench')).toBe(3);
    // The other routine in the notebook is still part of the population.
    expect(loggedSessionCount(sections, 'Curl')).toBe(1);
  });

  test('the live text is counted once, not twice, when the routine IS saved', () => {
    // The current note's text is already substituted in the notes pass, so
    // appending it again would double every session and over-anchor the span.
    const raw = 'Monday\n-Bench\n225 5\n235 5';
    const note = { id: 'note1', title: 'Routine A', raw_text: raw, saved_at: '2026-06-01T12:00:00.000Z' };
    setup({ notes: [note], currentId: 'note1', currentNote: note });

    let component;
    render.act(() => {
      component = render.create(<ControlledLogScreen workoutNoteText={raw} initialText={raw} />);
    });
    pressTrack(component, 'Bench');

    const [, sections] = toggle.mock.calls[0];
    expect(loggedSessionCount(sections, 'Bench')).toBe(2);
  });
});

// ── Android Back ownership (#527): the shell holds one back-consumer slot;
// LogScreen must claim it through registerBackConsumer (not BackHandler
// directly) and only while it is the active tab, so a hidden Log editor
// cannot outrace the visible tab after a tab switch.
describe('Android Back routes through registerBackConsumer, gated by isActive (#527)', () => {
  let mockUpdateNote;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateNote = jest.fn().mockResolvedValue({});
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
      update: mockUpdateNote,
      add: jest.fn(),
      remove: jest.fn(),
    });
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: [], toggle: jest.fn() });
    useEntries.useDeloadNote.mockReturnValue({ note: { raw_text: '' }, loading: false, save: jest.fn(), clear: jest.fn() });
    useEntries.useDeloadHistory.mockReturnValue({
      history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
    });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: false });
  });

  test('registers a back consumer while the Log tab is active and unregisters when it becomes inactive', () => {
    let unregister;
    const registerBackConsumer = jest.fn(() => {
      unregister = jest.fn();
      return unregister;
    });

    let component;
    render.act(() => {
      component = render.create(
        <ControlledLogScreen isActive={true} registerBackConsumer={registerBackConsumer} />
      );
    });
    expect(registerBackConsumer).toHaveBeenCalledTimes(1);

    render.act(() => {
      component.update(
        <ControlledLogScreen isActive={false} registerBackConsumer={registerBackConsumer} />
      );
    });
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  test('does not register a back consumer while the Log tab is inactive', () => {
    const registerBackConsumer = jest.fn(() => jest.fn());
    render.act(() => {
      render.create(
        <ControlledLogScreen isActive={false} registerBackConsumer={registerBackConsumer} />
      );
    });
    expect(registerBackConsumer).not.toHaveBeenCalled();
  });

  test('the registered consumer finishes the current-routine editor through its Done path and consumes Back', async () => {
    let capturedConsumer;
    const registerBackConsumer = jest.fn((consumer) => {
      capturedConsumer = consumer;
      return jest.fn();
    });

    let component;
    render.act(() => {
      component = render.create(
        <ControlledLogScreen isActive={true} registerBackConsumer={registerBackConsumer} />
      );
    });
    const root = component.root;

    // #1021: Edit lives behind the current-routine card's three-dot menu.
    openCurrentRoutineMenu(root);
    render.act(() => { findPressableByText(root, 'Edit').props.onPress({ stopPropagation: jest.fn() }); });
    // The editor's ScreenShell mounts unconditionally (toggled via display:none), so
    // its own "Done" control stays in the tree; the read view's current-routine
    // menu trigger is the one that is conditionally rendered on mode (the whole
    // card unmounts with it), so its absence/return is the reliable edit/read-mode
    // signal here.
    const menuTrigger = () => root.findAll(
      n => n.props && n.props.accessibilityLabel === 'Routine actions'
    )[0];
    expect(menuTrigger()).toBeUndefined();

    let handled;
    await render.act(async () => { handled = capturedConsumer(); });

    expect(handled).toBe(true);
    expect(menuTrigger()).toBeTruthy();
  });

  test('the registered consumer returns false with no active editor state, letting the shell fall back to Home', () => {
    let capturedConsumer;
    const registerBackConsumer = jest.fn((consumer) => {
      capturedConsumer = consumer;
      return jest.fn();
    });

    render.act(() => {
      render.create(
        <ControlledLogScreen isActive={true} registerBackConsumer={registerBackConsumer} />
      );
    });

    expect(capturedConsumer()).toBe(false);
  });
});

// #1006: the idle rest-timer affordance is a compact stopwatch inside the
// current-routine editor, not a full-width row floating above the tab bar.
// Pin the wiring so it cannot regress back to a bottom banner that reserves
// navigation clearance.
describe('Log rest-timer control is the compact editor stopwatch (#1006)', () => {
  let src;
  beforeAll(() => {
    src = readLogScreenSource();
  });

  test('the editor rest-timer instance is rendered with the compact prop', () => {
    expect(src).toMatch(/<RestTimerBanner[^>]*\n(?:[^<]*\n)*?\s*compact\n/);
  });

  // #1607 (redesign v3 AC4): the control docks first in the editor card's tool
  // row instead of the page header; it still never sits in the header cluster
  // and is only handed to the card, not laid out in LogScreen's own body.
  test('it docks in the editor tool row, not the page header', () => {
    const editorShellIdx = src.indexOf("'Edit routine'");
    const headerRightIdx = src.indexOf('headerRight={', editorShellIdx);
    const headerCloseIdx = src.indexOf('keyboardShouldPersistTaps', headerRightIdx);
    expect(headerRightIdx).toBeGreaterThan(-1);
    expect(src.slice(headerRightIdx, headerCloseIdx)).not.toMatch(/RestTimerBanner|\{banner\}/);
    expect(src).toMatch(/<LogScreenEditorCard[\s\S]*?toolbarTimer=\{restTimerDocked \? <View ref=\{dockRef\} onLayout=\{measureDock\}>\{banner\}<\/View> : null\}/);
  });

  test('the rest-timer element itself reserves no bottom-tab clearance', () => {
    const el = src.slice(
      src.indexOf('<RestTimerBanner'),
      src.indexOf('/>', src.indexOf('<RestTimerBanner')) + 2
    );
    expect(el).toContain('compact');
    expect(el).not.toContain('bottomBannerClearance');
    expect(el).not.toContain('marginBottom');
    expect(el).not.toContain('startOnly');
  });

  test('the running countdown is still the single app-shell instance (not re-added here)', () => {
    const matches = src.match(/<RestTimerBanner/g) || [];
    expect(matches).toHaveLength(1);
  });
});

// #1021: the New Routine editor's secondary Import routine action opens the
// existing RoutineImportScreen preview in place, wired to the same note-add
// write every other import entry point (MoreScreen) uses.
describe('New Routine editor: Import routine action (#1021)', () => {
  let mockAdd;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAdd = jest.fn().mockResolvedValue({ id: 'imported1' });
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
      update: jest.fn().mockResolvedValue({}),
      add: mockAdd,
      remove: jest.fn(),
    });
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: [], toggle: jest.fn() });
    useEntries.useDeloadNote.mockReturnValue({ note: { raw_text: '' }, loading: false, save: jest.fn(), clear: jest.fn() });
    useEntries.useDeloadHistory.mockReturnValue({
      history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
    });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: false });
  });

  const enterNewRoutineEditor = (root) => {
    const newRoutineButton = root.findAll(
      n => n.props && n.props.accessibilityLabel === 'New routine' && typeof n.props.onPress === 'function'
    )[0];
    render.act(() => { newRoutineButton.props.onPress(); });
  };

  test('the New Routine editor offers a secondary Import routine action that opens the import preview', () => {
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;
    enterNewRoutineEditor(root);

    const importButton = findPressableByText(root, 'Import routine');
    expect(importButton).toBeTruthy();
    expect(importButton.props.accessibilityRole).toBe('button');

    render.act(() => { importButton.props.onPress(); });

    // The existing preview screen is now showing: its paste input, and the
    // preview copy no editor screen carries (ScreenShell itself — title
    // included — is mocked away in this file's harness, so this file's
    // tests always identify a screen by its own content, not its shell).
    // Host node only — the composite TextInput carries the same testID.
    expect(root.findAll(n => typeof n.type === 'string' && n.props.testID === 'routine-import-paste').length).toBe(1);
    expect(root.findAll(
      n => n.type === 'Text' && n.props.children === 'Pasted text'
    ).length).toBe(1);
  });

  test('creating a routine from the import preview writes through the same note-add path as everywhere else', async () => {
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;
    enterNewRoutineEditor(root);
    render.act(() => { findPressableByText(root, 'Import routine').props.onPress(); });

    const paste = root.findAll(n => typeof n.type === 'string' && n.props.testID === 'routine-import-paste')[0];
    const pastedText = 'Monday\n+Lifting\n-Bench Press\n135 5,5,5';
    render.act(() => { paste.props.onChangeText(pastedText); });

    // The Button composite also carries an `onPress` prop (the undisabled
    // handler) alongside the actual react-native Pressable it renders, which
    // additionally carries the computed `accessibilityState`; take the one
    // that has it.
    const createButton = root.findAll(
      n => n.props && n.props.accessibilityLabel === 'Create new routine from pasted text'
        && typeof n.props.onPress === 'function'
        && n.props.accessibilityState
    )[0];
    expect(createButton).toBeTruthy();
    expect(createButton.props.accessibilityState.disabled).toBe(false);
    await render.act(async () => { await createButton.props.onPress(); });

    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockAdd.mock.calls[0][1]).toBe(pastedText);
  });

  // ScreenShell is mocked in this file to a plain wrapper that drops `title`/
  // `onBack` entirely (see the top-of-file mock), so there is no real "←
  // Back" button to press here. The RoutineImportScreen composite still
  // receives LogScreen's real `onBack` handler as a prop, so this drives
  // that handler directly — the same wiring a tap on the real ScreenShell
  // Back button would invoke in the app.
  test('Back from the import preview returns to the New Routine editor', () => {
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;
    enterNewRoutineEditor(root);
    render.act(() => { findPressableByText(root, 'Import routine').props.onPress(); });
    const pasteInput = () => root.findAll(n => typeof n.type === 'string' && n.props.testID === 'routine-import-paste');
    expect(pasteInput().length).toBe(1);

    const importScreen = root.findAll(n => typeof n.type === 'function' && n.type.name === 'RoutineImportScreen')[0];
    expect(importScreen).toBeTruthy();
    render.act(() => { importScreen.props.onBack(); });

    expect(pasteInput().length).toBe(0);
    expect(findPressableByText(root, 'Import routine')).toBeTruthy();
  });

  // Review finding: `handleAndroidBack` used to check `otherEditor.editingNoteId`
  // before `importRoutineOpen`, so Back while the import preview was open would
  // save/close the underlying New Routine draft instead of just dismissing the
  // preview, losing the draft's unsaved state. The import preview must now win
  // the race and dismiss first, leaving the draft exactly as the user left it.
  test('Android Back dismisses the import preview first, preserving the New Routine draft (#1021 review)', () => {
    let capturedConsumer;
    const registerBackConsumer = jest.fn((consumer) => {
      capturedConsumer = consumer;
      return jest.fn();
    });

    let component;
    render.act(() => {
      component = render.create(
        <ControlledLogScreen isActive registerBackConsumer={registerBackConsumer} />
      );
    });
    const root = component.root;
    enterNewRoutineEditor(root);

    const getDraftInput = () =>
      root.findAll(n => n.props && n.props.multiline === true && typeof n.props.onChangeText === 'function')[0];
    const draftText = 'Monday\n+Lifting\n-Overhead Press\n95 5,5,5';
    render.act(() => { getDraftInput().props.onChangeText(draftText); });
    expect(getDraftInput().props.value).toBe(draftText);

    render.act(() => { findPressableByText(root, 'Import routine').props.onPress(); });
    const pasteInput = () => root.findAll(n => typeof n.type === 'string' && n.props.testID === 'routine-import-paste');
    expect(pasteInput().length).toBe(1);

    let handled;
    render.act(() => { handled = capturedConsumer(); });

    // The event was consumed by dismissing the preview, not by closing/saving
    // the underlying draft.
    expect(handled).toBe(true);
    expect(pasteInput().length).toBe(0);
    expect(findPressableByText(root, 'Import routine')).toBeTruthy();
    expect(mockAdd).not.toHaveBeenCalled();

    // The draft text is exactly as it was before Import routine was opened —
    // neither saved nor discarded.
    expect(getDraftInput().props.value).toBe(draftText);
  });
});

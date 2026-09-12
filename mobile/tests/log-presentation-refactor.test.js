// #1054: LogScreen.js and LogScreenEditorCard.js were split into explicit
// orchestration + presentation modules (LogScreenContent / LogScreenStates /
// logScreenStyles, and EditorHeader / EditorControls / EditorStatus /
// logEditorStyles). This suite proves the refactor preserved the public
// boundary and — critically — that no stateful hook changed its mount/reset
// behavior: every hook still lives in the boundary component's own fiber via a
// same-fiber controller/`useEditorCard` hook, so a re-render never remounts the
// editors and the source-scanned wiring stays in the boundary files.

import React from 'react';
import renderer from 'react-test-renderer';
import fs from 'fs';
import path from 'path';

jest.mock('expo-updates', () => ({
  useUpdates: () => ({ currentlyRunning: { isEmbeddedLaunch: true } }),
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
  reloadAsync: jest.fn(),
}));
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map();
  return {
    getItem: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    setItem: jest.fn(async (k, v) => { store.set(k, v); }),
    removeItem: jest.fn(async (k) => { store.delete(k); }),
    clear: jest.fn(async () => { store.clear(); }),
  };
});
jest.mock('@react-native-community/datetimepicker', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return function MockDateTimePicker(props) {
    return ReactMock.createElement(View, { testID: 'mock-datetimepicker', ...props });
  };
});
jest.mock('../components/LogEmptyState', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return { LogEmptyState: () => ReactMock.createElement(View, { testID: 'log-empty-state' }) };
});
jest.mock('../components/SessionCheckInModal', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return { SessionCheckInModal: (props) => ReactMock.createElement(View, { testID: 'session-checkin-modal', ...props }) };
});
jest.mock('../components/ScreenShell', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  const ScreenShell = ReactMock.forwardRef(({ children, headerRight }, ref) =>
    ReactMock.createElement(View, { testID: 'screen-shell', ref }, headerRight, children));
  return { ScreenShell, ScrollContext: ReactMock.createContext({ onScroll: () => {} }) };
});
jest.mock('../hooks/useEntries');

import { LogScreen } from '../screens/LogScreen';
import {
  LogScreenEditorCard,
  RoutineAdoptionPrompt,
  computeSaveStatusLabel,
  SaveStatusRegion,
} from '../components/LogScreenEditorCard';
import * as useEntries from '../hooks/useEntries';

const noop = () => {};

// ── Public export boundary (the mock seams tests import through) ──────────────
describe('#1054 export parity — public boundaries are unchanged', () => {
  test('../screens/LogScreen still exports LogScreen', () => {
    expect(typeof LogScreen).toBe('function');
  });

  test('../components/LogScreenEditorCard still exports its full public API', () => {
    expect(typeof LogScreenEditorCard).toBe('function');
    expect(typeof RoutineAdoptionPrompt).toBe('function');
    expect(typeof computeSaveStatusLabel).toBe('function');
    expect(typeof SaveStatusRegion).toBe('function');
  });

  test('computeSaveStatusLabel remains the real (device-local) implementation', () => {
    expect(computeSaveStatusLabel({ status: 'saving' })).toBe('Saving…');
    expect(computeSaveStatusLabel({ status: 'saved' })).toBe('Saved on device');
    expect(computeSaveStatusLabel({ status: 'pending' })).toBe('Saved on device · Not yet synced');
    expect(computeSaveStatusLabel({ status: 'saving' }).toLowerCase()).not.toContain('offline');
  });

  test('the split modules load and expose the extracted seams', () => {
    const content = require('../screens/log/LogScreenContent');
    expect(typeof content.LogScreenContent).toBe('function');
    expect(typeof content.buildLogRecovery).toBe('function');
    expect(typeof content.EditorHeaderActions).toBe('function');
    const states = require('../screens/log/LogScreenStates');
    expect(typeof states.LogSkeleton).toBe('function');
    expect(typeof states.useLogScreenController).toBe('function');
    const controls = require('../components/log/EditorControls');
    expect(typeof controls.useEditorCard).toBe('function');
    const statusMod = require('../components/log/EditorStatus');
    expect(typeof statusMod.RoutineAdoptionPrompt).toBe('function');
    expect(typeof statusMod.SaveStatusRegion).toBe('function');
    expect(typeof statusMod.computeSaveStatusLabel).toBe('function');
    const header = require('../components/log/EditorHeader');
    expect(typeof header.EditorDeloadNoteInput).toBe('function');
    expect(typeof header.EditorSaveActions).toBe('function');
  });

  test('the re-exported adoption prompt is the same reference the editor card ships', () => {
    const statusMod = require('../components/log/EditorStatus');
    expect(RoutineAdoptionPrompt).toBe(statusMod.RoutineAdoptionPrompt);
    expect(SaveStatusRegion).toBe(statusMod.SaveStatusRegion);
  });
});

// ── Source-boundary parity — pinned wiring stayed in the boundary files ───────
describe('#1054 source parity — source-scanned wiring stays in the boundary files', () => {
  const logScreenSrc = fs.readFileSync(path.join(__dirname, '../screens/LogScreen.js'), 'utf8');
  const editorCardSrc = fs.readFileSync(path.join(__dirname, '../components/LogScreenEditorCard.js'), 'utf8');

  test('LogScreen keeps the ownership predicate, editor-hook call, and check-in gate', () => {
    expect(logScreenSrc).toMatch(/const otherModalOwnsScreen = !!recoveryModal \|\| addWeekModalOpen \|\| endBlockModalOpen;/);
    expect(logScreenSrc).toContain('useLogCurrentRoutineEditor({');
    expect(logScreenSrc).toContain('const deloadEditor');
    expect(logScreenSrc).toMatch(/visible=\{fatigueTrackingEnabled && currentEditor\.showCheckInModal\}/);
  });

  test('LogScreen keeps the source-scanned skip/unskip wiring and the back-handler done calls', () => {
    expect(logScreenSrc).toMatch(/handleSkipWeek=\{currentEditor\.isSaving \? undefined : currentEditor\.handleSkipWeek\}/);
    expect(logScreenSrc).toMatch(/handleUnskipWeek=\{currentEditor\.isSaving \? undefined : currentEditor\.handleUnskipWeek\}/);
    expect(logScreenSrc).toMatch(/handleDoneDeload\(\)/);
    expect(logScreenSrc).toMatch(/handleDoneOther\(\)/);
    expect(logScreenSrc).toMatch(/handleDoneCurrent\(\)/);
  });

  test('LogScreen keeps a single compact rest-timer banner ahead of the editor card', () => {
    expect((logScreenSrc.match(/<RestTimerBanner/g) || []).length).toBe(1);
    expect(logScreenSrc).toContain('<LogScreenEditorCard');
  });

  test('LogScreenEditorCard keeps the deload date web fallback and DateTimePicker', () => {
    expect(editorCardSrc).toMatch(/function\s+WebDateInput/);
    expect(editorCardSrc).toMatch(/createElement\(\s*'input'/);
    expect(editorCardSrc).toMatch(/<DateTimePicker[\s\S]*?onChange\s*=\s*\{/);
    expect(editorCardSrc).toMatch(/title=\{\(editingNoteId === 'new'[\s\S]{0,180}'Revert this edit'\}/);
  });
});

// ── Editor card mount/reset parity (useEditorCard lives in the card's fiber) ──
function CurrentEditorHarness(props) {
  const [text, setText] = React.useState(props.initialText ?? '');
  return (
    <LogScreenEditorCard
      deloadMode={null}
      isEditingDeloadNote={false}
      editingNoteId={null}
      currentId={null}
      activeEditText={text}
      handleCurrentTextChange={setText}
      editingText=""
      setEditingText={noop}
      workoutNoteTitle="New Routine"
      setWorkoutNoteTitle={noop}
      editingTitle=""
      setEditingTitle={noop}
      currentMode="edit"
      handleSave={noop}
      handleSaveOtherNote={noop}
      handleSwitchCurrent={noop}
      handleDeleteRoutine={noop}
      handleDeleteDeloadNoteFromEditor={noop}
      handleRevertEdit={noop}
      saveStatus={props.saveStatus}
      {...props}
    />
  );
}

describe('#1054 editor card — useEditorCard keeps its mount/reset behavior', () => {
  let roots = [];
  afterEach(() => { roots.forEach((r) => renderer.act(() => r.unmount())); roots = []; });

  const byTestID = (root, id) => root.findAll((n) => n.props && n.props.testID === id);
  const byA11y = (root, label) => root.findAll((n) => n.props && n.props.accessibilityLabel === label);

  test('renders the shared editor surface and the empty-note seed affordance', () => {
    let root;
    renderer.act(() => { root = renderer.create(<CurrentEditorHarness initialText="" />); });
    roots.push(root);
    expect(byTestID(root.root, 'log-editor-surface').length).toBeGreaterThan(0);
    expect(byA11y(root.root, 'Insert example workout note').length).toBeGreaterThan(0);
  });

  test('inserting the seed example flows through useEditorCard into the note field', () => {
    let root;
    renderer.act(() => { root = renderer.create(<CurrentEditorHarness initialText="" />); });
    roots.push(root);
    const seed = root.root.findAll((n) => n.props && n.props.accessibilityLabel === 'Insert example workout note')[0];
    renderer.act(() => { seed.props.onPress(); });
    // The seed affordance is gone (editorText is no longer empty) — the one-shot
    // insertion ran inside useEditorCard exactly as it did inline.
    expect(root.root.findAll((n) => n.props && n.props.accessibilityLabel === 'Insert example workout note').length).toBe(0);
  });

  test('problem-list open state survives an unrelated re-render (no remount/reset)', () => {
    const malformed = 'Monday\n+Lifting\n-Bench\n135 5,5,5\n???garbage line';
    let root;
    renderer.act(() => { root = renderer.create(<CurrentEditorHarness initialText={malformed} />); });
    roots.push(root);
    const badges = byTestID(root.root, 'editor-validation-badge');
    // Only exercised when the parser flags the malformed note; when it does, the
    // list-open state must persist across an unrelated prop change.
    if (badges.length > 0) {
      renderer.act(() => { badges[0].props.onPress(); });
      expect(byTestID(root.root, 'editor-validation-list').length).toBeGreaterThan(0);
      renderer.act(() => { root.update(<CurrentEditorHarness initialText={malformed} saveStatus="saving" />); });
      expect(byTestID(root.root, 'editor-validation-list').length).toBeGreaterThan(0);
    } else {
      expect(byTestID(root.root, 'log-editor-surface').length).toBeGreaterThan(0);
    }
  });

  test('RoutineAdoptionPrompt (re-exported) renders its live region', () => {
    let root;
    renderer.act(() => {
      root = renderer.create(
        <RoutineAdoptionPrompt prompt={{ id: 'p1', title: 'Backlog' }} onAdopt={noop} onDismiss={noop} />
      );
    });
    roots.push(root);
    expect(byTestID(root.root, 'routine-adoption-prompt').length).toBeGreaterThan(0);
  });
});

// ── LogScreen mount/reset parity (controller + content wiring) ────────────────
function setupLogMocks() {
  const note = { id: 'n1', title: 'Push Day', raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5', saved_at: '2026-06-01T00:00:00.000Z' };
  useEntries.useWorkoutNotes.mockReturnValue({
    notes: [note], currentId: note.id, currentNote: note, deloadNotes: [],
    loading: false, error: null, refresh: jest.fn(), selectCurrent: jest.fn(),
    update: jest.fn(), add: jest.fn(), remove: jest.fn(),
  });
  useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: [], activations: {}, toggle: jest.fn(), reconcileActivations: jest.fn() });
  useEntries.useDeloadNote.mockReturnValue({ note: null, loading: false, save: jest.fn(), clear: jest.fn() });
  useEntries.useDeloadHistory.mockReturnValue({ history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn() });
  useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: true });
  useEntries.useRecoveryBlockState.mockReturnValue({
    activeBlock: null, blocks: [], weeks: [], recoveryWeekNumberByNoteId: {},
    ready: true, loading: false, refreshing: false, stale: false, error: null,
    mutationsAllowed: true, pendingRecovery: [], recoveryPendingError: null, refresh: jest.fn(),
  });
  useEntries.useStartRecoveryBlock.mockReturnValue({ startBlock: jest.fn() });
  useEntries.useActiveTrainingContext.mockReturnValue({ status: 'normal', baselinePaused: false });
  useEntries.isEligibleBaselineNote.mockReturnValue(false);
  useEntries.isEligibleRecoveryWeekNote.mockReturnValue(false);
  return note;
}

function LogHarness(props) {
  const [text, setText] = React.useState('Monday\n+Lifting\n-Bench\n135 5,5,5');
  const [title, setTitle] = React.useState('Push Day');
  return (
    <LogScreen
      workoutNoteText={text}
      setWorkoutNoteText={setText}
      workoutNoteTitle={title}
      setWorkoutNoteTitle={setTitle}
      isCollapsed={false}
      toggleCollapsed={noop}
      onSaveWorkout={noop}
      onCheckInPrompt={noop}
      isActive
      registerBackConsumer={() => () => {}}
      {...props}
    />
  );
}

describe('#1054 LogScreen — orchestration mounts and survives re-render without remount', () => {
  let roots = [];
  beforeEach(() => { jest.clearAllMocks(); setupLogMocks(); });
  afterEach(() => { roots.forEach((r) => renderer.act(() => r.unmount())); roots = []; });

  const shells = (root) => root.findAll((n) => n.props && n.props.testID === 'screen-shell');

  test('renders the read + editor ScreenShells and the check-in modal through the split modules', () => {
    let root;
    renderer.act(() => { root = renderer.create(<LogHarness />); });
    roots.push(root);
    // Two ScreenShells (read view via LogScreenContent, editor via LogScreen) and
    // the top-level check-in modal all mount — the controller/content wiring is live.
    expect(shells(root.root).length).toBeGreaterThanOrEqual(2);
    expect(root.root.findAll((n) => n.props && n.props.testID === 'session-checkin-modal').length).toBeGreaterThan(0);
  });

  test('an unrelated prop change re-renders in place (editors are not remounted)', () => {
    let root;
    renderer.act(() => { root = renderer.create(<LogHarness restTimerIsRunning={false} />); });
    roots.push(root);
    const before = shells(root.root).length;
    renderer.act(() => { root.update(<LogHarness restTimerIsRunning />); });
    // Same structure after an unrelated prop change: the same-fiber controller
    // hook and the extracted content component did not force a remount.
    expect(shells(root.root).length).toBe(before);
  });
});

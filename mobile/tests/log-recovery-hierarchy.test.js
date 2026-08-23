// #870: focused coverage for the Log-tab Recovery hierarchy changes —
// "Current training" labelling on the open week, "Baseline routine · paused"
// on the frozen baseline card, and suppressing Deload as a peer live-training
// mode while a baseline is paused. These are additive labelling/visibility
// changes over the existing #843/#868/#869 Recovery Log surfaces; the
// underlying lifecycle, eligibility, and navigation-intent behavior already
// covered in log-screen.test.js is untouched.
import React from 'react';
import render from 'react-test-renderer';
import { LogScreen } from '../screens/LogScreen';
import * as useEntries from '../hooks/useEntries';

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

jest.mock('../components/LogEmptyState', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { LogEmptyState: function MockLogEmptyState() { return React.createElement(View); } };
});

jest.mock('../components/SessionCheckInModal', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { SessionCheckInModal: function MockSessionCheckInModal() { return React.createElement(View); } };
});

jest.mock('../components/ScreenShell', () => {
  const React = require('react');
  const { View } = require('react-native');
  const ScreenShell = React.forwardRef(({ children, headerRight }, ref) => {
    return React.createElement(View, { testID: 'screen-shell' }, headerRight, children);
  });
  return { ScreenShell, ScrollContext: React.createContext({ onScroll: () => {} }) };
});

jest.mock('../hooks/useEntries');

function ControlledLogScreen(props) {
  const [text, setText] = React.useState(props.initialText || 'Monday\n+Lifting\n-Bench\n135 5,5,5');
  const [title, setTitle] = React.useState(props.initialTitle || 'Routine A');
  return (
    <LogScreen
      workoutNoteText={props.workoutNoteText !== undefined ? props.workoutNoteText : text}
      setWorkoutNoteText={props.setWorkoutNoteText || setText}
      workoutNoteTitle={props.workoutNoteTitle !== undefined ? props.workoutNoteTitle : title}
      setWorkoutNoteTitle={props.setWorkoutNoteTitle || setTitle}
      isCollapsed={false}
      toggleCollapsed={jest.fn()}
      onSaveWorkout={jest.fn()}
      onCheckInPrompt={jest.fn()}
      {...props}
    />
  );
}

const baselineNote = {
  id: 'baseline1',
  title: 'Push Day',
  raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5',
  saved_at: '2026-06-01T12:00:00.000Z',
};
const week1Note = {
  id: 'week1note',
  title: 'Recovery Week 1',
  raw_text: 'Monday\n+Lifting\n-Bench\n95 5,5,5',
  saved_at: '2026-06-02T12:00:00.000Z',
};
const otherRoutineNote = {
  id: 'other-routine',
  title: 'Pull Day',
  raw_text: 'Tuesday\n+Lifting\n-Row\n95 5,5,5',
  saved_at: '2026-06-03T12:00:00.000Z',
};

function setupMocks({
  activeBlock = null,
  blocks = [],
  weeks = [],
  deloadModeEnabled = true,
  activeTrainingContext = null,
  currentId = baselineNote.id,
  currentNote = baselineNote,
  extraNotes = [],
} = {}) {
  useEntries.useWorkoutNotes.mockReturnValue({
    notes: [baselineNote, week1Note, ...extraNotes],
    currentId,
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
  useEntries.useDeloadNote.mockReturnValue({ note: null, loading: false, save: jest.fn(), clear: jest.fn() });
  useEntries.useDeloadHistory.mockReturnValue({
    history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
  });
  useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled });
  useEntries.useRecoveryBlockState.mockReturnValue({
    activeBlock,
    blocks,
    weeks,
    recoveryWeekNumberByNoteId: weeks.reduce((acc, w) => {
      if (!activeBlock || w.block_id === activeBlock.id) acc[w.note_id] = w.week_number;
      return acc;
    }, {}),
    ready: true,
    loading: false,
    refreshing: false,
    stale: false,
    error: null,
    mutationsAllowed: true,
    pendingRecovery: [],
    recoveryPendingError: null,
    refresh: jest.fn(),
  });
  useEntries.useStartRecoveryBlock.mockReturnValue({ startBlock: jest.fn() });
  useEntries.useActiveTrainingContext.mockReturnValue(activeTrainingContext || {
    status: 'normal',
    activeNoteId: baselineNote.id,
    baselineNoteId: baselineNote.id,
    baselinePaused: false,
    recoveryWeekNumber: null,
    activeNote: baselineNote,
    baselineNote,
  });
  useEntries.isEligibleBaselineNote.mockImplementation(
    jest.requireActual('../hooks/entries/recoveryBlockHooks').isEligibleBaselineNote
  );
  useEntries.isEligibleRecoveryWeekNote.mockImplementation(
    jest.requireActual('../hooks/entries/recoveryBlockHooks').isEligibleRecoveryWeekNote
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('#870 Recovery Log hierarchy', () => {
  const activeBlockFixture = {
    id: 'rb1',
    baseline_note_id: baselineNote.id,
    baseline_note_title: 'Push Day',
    started_at: '2026-06-01T00:00:00.000Z',
    completed_at: null,
    deleted_at: null,
  };
  const openWeekFixture = { id: 'rw1', block_id: 'rb1', note_id: week1Note.id, week_number: 1, deleted_at: null, completed_at: null };

  test('the open recovery week is labelled "Current training"', () => {
    setupMocks({
      activeBlock: activeBlockFixture,
      blocks: [activeBlockFixture],
      weeks: [openWeekFixture],
      activeTrainingContext: {
        status: 'recovery_open_week',
        activeNoteId: week1Note.id,
        baselineNoteId: baselineNote.id,
        baselinePaused: true,
        recoveryWeekNumber: 1,
        activeNote: week1Note,
        baselineNote,
      },
    });
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'CURRENT TRAINING').length).toBeGreaterThan(0);
  });

  test('between weeks (no open week) keeps the neutral "RECOVERY BLOCK" kicker, not "Current training"', () => {
    const completedWeek = { ...openWeekFixture, completed_at: '2026-06-08T00:00:00.000Z' };
    setupMocks({
      activeBlock: activeBlockFixture,
      blocks: [activeBlockFixture],
      weeks: [completedWeek],
      activeTrainingContext: {
        status: 'recovery_between_weeks',
        activeNoteId: null,
        baselineNoteId: baselineNote.id,
        baselinePaused: true,
        recoveryWeekNumber: 1,
        activeNote: null,
        baselineNote,
      },
    });
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'CURRENT TRAINING').length).toBe(0);
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'RECOVERY BLOCK').length).toBeGreaterThan(0);
    // Leads with Add week, never presents the paused baseline as current work.
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Add week').length).toBeGreaterThan(0);
  });

  test('Deload is suppressed as a peer tab while the baseline is paused by an active recovery block', () => {
    setupMocks({
      activeBlock: activeBlockFixture,
      blocks: [activeBlockFixture],
      weeks: [openWeekFixture],
      deloadModeEnabled: true,
      activeTrainingContext: {
        status: 'recovery_open_week',
        activeNoteId: week1Note.id,
        baselineNoteId: baselineNote.id,
        baselinePaused: true,
        recoveryWeekNumber: 1,
        activeNote: week1Note,
        baselineNote,
      },
    });
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Deload').length).toBe(0);
  });

  test('Deload remains a peer tab when deload mode is on and no recovery block is active', () => {
    setupMocks({ activeBlock: null, blocks: [], weeks: [], deloadModeEnabled: true });
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Deload').length).toBeGreaterThan(0);
  });

  test('the current-routine card labels the paused baseline as "Baseline routine · paused", not "Current routine"', () => {
    setupMocks({
      activeBlock: activeBlockFixture,
      blocks: [activeBlockFixture],
      weeks: [openWeekFixture],
      activeTrainingContext: {
        status: 'recovery_open_week',
        activeNoteId: week1Note.id,
        baselineNoteId: baselineNote.id,
        baselinePaused: true,
        recoveryWeekNumber: 1,
        activeNote: week1Note,
        baselineNote,
      },
    });
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;
    // Switch to the Routine tab, where the baseline card lives.
    const routineTabBtn = root.findAll(n =>
      n.type === 'Text' && n.props.children === 'Routine'
    )[0];
    expect(routineTabBtn).toBeTruthy();
    // Walk up to the Pressable ancestor and press it.
    let node = routineTabBtn.parent;
    while (node && typeof node.props.onPress !== 'function') node = node.parent;
    render.act(() => { node.props.onPress(); });

    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Baseline routine · paused').length).toBeGreaterThan(0);
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Current routine').length).toBe(0);
  });

  // #870 review fix: `baselinePaused` is a block-global flag — it stays true
  // even when `currentId` no longer names the note the block actually
  // paused (the block was started from a different saved routine, or the
  // user switched current routines mid-block). The Routine-tab card always
  // renders `currentId`, so it must keep the ordinary "Current routine"
  // label for an unrelated current routine and must NOT claim it is the
  // paused baseline.
  test('the current-routine card does not label an unrelated current routine as the paused baseline', () => {
    setupMocks({
      activeBlock: activeBlockFixture,
      blocks: [activeBlockFixture],
      weeks: [openWeekFixture],
      currentId: otherRoutineNote.id,
      currentNote: otherRoutineNote,
      extraNotes: [otherRoutineNote],
      activeTrainingContext: {
        status: 'recovery_open_week',
        activeNoteId: week1Note.id,
        baselineNoteId: baselineNote.id,
        baselinePaused: true,
        recoveryWeekNumber: 1,
        activeNote: week1Note,
        baselineNote,
      },
    });
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;
    // Switch to the Routine tab, where the current-routine card lives.
    const routineTabBtn = root.findAll(n =>
      n.type === 'Text' && n.props.children === 'Routine'
    )[0];
    expect(routineTabBtn).toBeTruthy();
    let node = routineTabBtn.parent;
    while (node && typeof node.props.onPress !== 'function') node = node.parent;
    render.act(() => { node.props.onPress(); });

    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Current routine').length).toBeGreaterThan(0);
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Baseline routine · paused').length).toBe(0);
  });

  test('direct Log-tab entry auto-focuses the same open-week note a Home handoff would focus', () => {
    setupMocks({
      activeBlock: activeBlockFixture,
      blocks: [activeBlockFixture],
      weeks: [openWeekFixture],
      activeTrainingContext: {
        status: 'recovery_open_week',
        activeNoteId: week1Note.id,
        baselineNoteId: baselineNote.id,
        baselinePaused: true,
        recoveryWeekNumber: 1,
        activeNote: week1Note,
        baselineNote,
      },
    });
    let component;
    // No navRecoveryKey/navRecoveryNoteId — a plain direct Log-tab visit.
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    const root = component.root;
    // The open week's note title renders as the expanded note's day heading
    // fallback / edit affordance, confirming the row auto-expanded rather
    // than staying collapsed in the week list.
    expect(root.findAll(n => n.type === 'Text' && n.props.children === 'Edit note').length).toBeGreaterThan(0);
  });
});

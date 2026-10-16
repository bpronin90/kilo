import { installRendererCleanup } from './helpers/log-screen';
import render from 'react-test-renderer';
import * as useEntries from '../hooks/useEntries';
import { parseWorkoutNote } from '../lib/parser';
import { findMatchingExerciseNames, rolloverOneKExercises } from '../lib/data';
import { Alert, Platform } from 'react-native';
import { WebAlertHost } from '../components/WebAlertHost';
import { findPressableByText, expandRoutineManagement, ControlledLogScreen } from './helpers/log-screen';

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

describe('routine switch: rollover helper behavior (#295)', () => {
  const OLD_RAW = 'MONDAY — Push\n-DB Bench Press 3x8\n-Squat 3x6\n';
  const NEW_RAW = 'MONDAY — Push\n-DB Bench Press 4x6\n-Deadlift 3x4\n';

  test('findMatchingExerciseNames returns exercises present in both notes', () => {
    const oldSections = parseWorkoutNote(OLD_RAW).sections;
    const newSections = parseWorkoutNote(NEW_RAW).sections;
    const matched = findMatchingExerciseNames(oldSections, newSections);
    expect(matched).toContain('DB Bench Press');
    expect(matched).not.toContain('Squat');
    expect(matched).not.toContain('Deadlift');
  });

  test('findMatchingExerciseNames returns empty array when no overlap', () => {
    const oldSections = parseWorkoutNote('MONDAY\n-Squat 3x5\n').sections;
    const newSections = parseWorkoutNote('MONDAY\n-Deadlift 3x5\n').sections;
    expect(findMatchingExerciseNames(oldSections, newSections)).toHaveLength(0);
  });

  test('rolloverOneKExercises carries matched 1K slots and resets unmatched', () => {
    const oldOneK = { bench: 'DB Bench Press', squat: 'Squat', deadlift: 'Deadlift' };
    const matchedKeys = new Set(['db bench press']);
    const result = rolloverOneKExercises(oldOneK, matchedKeys);
    expect(result.bench).toBe('DB Bench Press');
    expect(result.squat).toBeUndefined();
    expect(result.deadlift).toBeUndefined();
  });

  test('rolloverOneKExercises returns null when no matched slots survive', () => {
    const oldOneK = { bench: 'DB Bench Press', squat: 'Squat', deadlift: 'Deadlift' };
    const matchedKeys = new Set(['cable fly']);
    expect(rolloverOneKExercises(oldOneK, matchedKeys)).toBeNull();
  });
});

describe('routine switch: screen-level rollover prompt (#295)', () => {
  let alertSpy;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const sharedRaw = 'MONDAY — Push\n-DB Bench Press 3x8\n';
    const note1 = { id: 'note1', title: 'Gym Routine', raw_text: sharedRaw, saved_at: '2026-06-01T12:00:00.000Z' };
    const note2 = { id: 'note2', title: 'Home Routine', raw_text: sharedRaw, saved_at: '2026-06-02T12:00:00.000Z' };

    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [note1, note2],
      currentId: 'note1',
      currentNote: note1,
      deloadNotes: [],
      loading: false,
      error: null,
      refresh: jest.fn(),
      selectCurrent: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      add: jest.fn(),
      remove: jest.fn(),
    });
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: {}, toggle: jest.fn() });
    useEntries.useDeloadNote.mockReturnValue({ note: null, loading: false, save: jest.fn() });
    useEntries.useDeloadHistory.mockReturnValue({ history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn() });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: false });
    useEntries.useUserProfile.mockReturnValue({ profile: null, save: jest.fn(), loading: false, clear: jest.fn() });
  });

  afterEach(() => {
    jest.useRealTimers();
    alertSpy.mockRestore();
  });

  test('switching to a note with matching exercises shows the rollover prompt', async () => {
    let component;
    render.act(() => {
      component = render.create(<ControlledLogScreen workoutNoteText="MONDAY — Push\n-DB Bench Press 3x8\n" />);
    });

    const root = component.root;
    expandRoutineManagement(root);
    const homeRoutineCard = findPressableByText(root, 'Home Routine');
    expect(homeRoutineCard).toBeTruthy();
    render.act(() => { homeRoutineCard.props.onPress(); });

    const switchBtn = findPressableByText(root, 'Set as current routine');
    expect(switchBtn).toBeTruthy();
    render.act(() => { switchBtn.props.onPress({ stopPropagation: () => {} }); });

    // First alert: "Set as current routine" confirmation
    expect(alertSpy).toHaveBeenCalledWith(
      'Set as current routine',
      expect.any(String),
      expect.any(Array)
    );

    // Simulate pressing the confirm button ("Set as current routine") in the first alert
    const firstAlertButtons = alertSpy.mock.calls[0][2];
    const confirmBtn = firstAlertButtons.find(b => b.text === 'Set as current routine');
    expect(confirmBtn).toBeTruthy();
    await render.act(async () => {
      confirmBtn.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Second alert: rollover prompt because notes share exercises
    expect(alertSpy).toHaveBeenCalledWith(
      'Keep current progress?',
      expect.any(String),
      expect.any(Array)
    );

    await render.act(async () => {
      component.unmount();
    });
  });

  test('switching to a note with no matching exercises skips the rollover prompt', async () => {
    const disjointNote = { id: 'note3', title: 'Cardio Routine', raw_text: 'MONDAY\n-Treadmill 30 min\n', saved_at: '2026-06-03T12:00:00.000Z' };
    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [
        { id: 'note1', title: 'Gym Routine', raw_text: 'MONDAY\n-DB Bench Press 3x8\n', saved_at: '2026-06-01T12:00:00.000Z' },
        disjointNote,
      ],
      currentId: 'note1',
      currentNote: { id: 'note1', title: 'Gym Routine', raw_text: 'MONDAY\n-DB Bench Press 3x8\n', saved_at: '2026-06-01T12:00:00.000Z' },
      deloadNotes: [], loading: false, error: null, refresh: jest.fn(),
      selectCurrent: jest.fn(), update: jest.fn().mockResolvedValue({}), add: jest.fn(), remove: jest.fn(),
    });

    let component;
    render.act(() => {
      component = render.create(<ControlledLogScreen workoutNoteText="MONDAY\n-DB Bench Press 3x8\n" />);
    });

    const root = component.root;
    expandRoutineManagement(root);
    render.act(() => { findPressableByText(root, 'Cardio Routine').props.onPress(); });
    render.act(() => { findPressableByText(root, 'Set as current routine').props.onPress({ stopPropagation: () => {} }); });

    // First alert: confirmation only
    const firstAlertButtons = alertSpy.mock.calls[0][2];
    const confirmBtn = firstAlertButtons.find(b => b.text === 'Set as current routine');
    await render.act(async () => {
      confirmBtn.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Rollover alert must NOT appear
    const rolloverCall = alertSpy.mock.calls.find(c => c[0] === 'Keep current progress?');
    expect(rolloverCall).toBeUndefined();

    await render.act(async () => {
      component.unmount();
    });
  });

  // #737: switching the current routine re-bases every aggregate on this
  // screen, on Home, and in Analytics, so it is a destructive action in the
  // sense that matters — it silently changes what the user's numbers mean.
  // The press itself must therefore reach no storage function at all, and a
  // cancelled confirmation must leave the switch un-run.
  test('Set as current routine writes nothing until the confirmation is accepted', async () => {
    const selectCurrent = jest.fn().mockResolvedValue(undefined);
    const update = jest.fn().mockResolvedValue({});
    const currentNote = { id: 'note1', title: 'Gym Routine', raw_text: 'MONDAY\n-DB Bench Press 3x8\n', saved_at: '2026-06-01T12:00:00.000Z' };
    const otherNote = { id: 'note3', title: 'Cardio Routine', raw_text: 'MONDAY\n-Treadmill 30 min\n', saved_at: '2026-06-03T12:00:00.000Z' };
    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [currentNote, otherNote],
      currentId: 'note1',
      currentNote,
      deloadNotes: [], loading: false, error: null, refresh: jest.fn(),
      selectCurrent, update, add: jest.fn(), remove: jest.fn(),
    });

    let component;
    render.act(() => {
      component = render.create(<ControlledLogScreen workoutNoteText="MONDAY\n-DB Bench Press 3x8\n" />);
    });

    const root = component.root;
    expandRoutineManagement(root);
    render.act(() => { findPressableByText(root, 'Cardio Routine').props.onPress(); });
    render.act(() => { findPressableByText(root, 'Set as current routine').props.onPress({ stopPropagation: () => {} }); });

    // The press raises a confirmation and nothing else.
    expect(alertSpy).toHaveBeenCalledWith('Set as current routine', expect.any(String), expect.any(Array));
    expect(selectCurrent).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();

    // Cancelling is a real cancel: still no write.
    const buttons = alertSpy.mock.calls[0][2];
    const cancelBtn = buttons.find(b => b.text === 'Cancel');
    expect(cancelBtn).toBeTruthy();
    expect(cancelBtn.style).toBe('cancel');
    await render.act(async () => {
      cancelBtn.onPress?.();
      await Promise.resolve();
    });
    expect(selectCurrent).not.toHaveBeenCalled();

    // Only the explicit confirm performs the switch.
    const confirmBtn = buttons.find(b => b.text === 'Set as current routine');
    await render.act(async () => {
      confirmBtn.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(selectCurrent).toHaveBeenCalledWith('note3');

    await render.act(async () => {
      component.unmount();
    });
  });

  test('web dialog cancel leaves the routine unchanged and confirm completes the switch (#721)', async () => {
    const originalOS = Platform.OS;
    const selectCurrent = jest.fn().mockResolvedValue(undefined);
    const currentNote = {
      id: 'note1',
      title: 'Gym Routine',
      raw_text: 'MONDAY\n-DB Bench Press 3x8\n',
      saved_at: '2026-06-01T12:00:00.000Z',
    };
    const disjointNote = {
      id: 'note3',
      title: 'Cardio Routine',
      raw_text: 'MONDAY\n-Treadmill 30 min\n',
      saved_at: '2026-06-03T12:00:00.000Z',
    };
    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [currentNote, disjointNote],
      currentId: currentNote.id,
      currentNote,
      deloadNotes: [],
      loading: false,
      error: null,
      refresh: jest.fn(),
      selectCurrent,
      update: jest.fn().mockResolvedValue({}),
      add: jest.fn(),
      remove: jest.fn(),
    });

    let component;
    try {
      Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
      await render.act(async () => {
        component = render.create(
          <>
            <WebAlertHost />
            <ControlledLogScreen workoutNoteText={currentNote.raw_text} />
          </>
        );
      });

      const root = component.root;
      expandRoutineManagement(root);
      render.act(() => { findPressableByText(root, 'Cardio Routine').props.onPress(); });
      render.act(() => {
        findPressableByText(root, 'Set as current routine').props.onPress({ stopPropagation: () => {} });
      });

      expect(alertSpy).not.toHaveBeenCalled();
      const cancel = root.findAll(
        n => n.props?.accessibilityLabel === 'Cancel' && typeof n.props?.onPress === 'function'
      ).at(-1);
      render.act(() => { cancel.props.onPress(); });
      expect(selectCurrent).not.toHaveBeenCalled();

      render.act(() => {
        findPressableByText(root, 'Set as current routine').props.onPress({ stopPropagation: () => {} });
      });
      const confirm = root.findAll(
        n => n.props?.accessibilityLabel === 'Set as current routine'
          && typeof n.props?.onPress === 'function'
      ).at(-1);
      await render.act(async () => {
        confirm.props.onPress();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(selectCurrent).toHaveBeenCalledTimes(1);
      expect(selectCurrent).toHaveBeenCalledWith(disjointNote.id);
      await render.act(async () => {
        jest.runOnlyPendingTimers();
        await Promise.resolve();
      });
    } finally {
      if (component) await render.act(async () => { component.unmount(); });
      Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS });
    }
  });

  test('web dialog preserves the chained progress-rollover choice (#721)', async () => {
    const originalOS = Platform.OS;
    const selectCurrent = jest.fn().mockResolvedValue(undefined);
    const sharedRaw = 'MONDAY — Push\n-DB Bench Press 3x8\n';
    const note1 = {
      id: 'note1', title: 'Gym Routine', raw_text: sharedRaw,
      saved_at: '2026-06-01T12:00:00.000Z',
    };
    const note2 = {
      id: 'note2', title: 'Home Routine', raw_text: sharedRaw,
      saved_at: '2026-06-02T12:00:00.000Z',
    };
    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [note1, note2],
      currentId: note1.id,
      currentNote: note1,
      deloadNotes: [],
      loading: false,
      error: null,
      refresh: jest.fn(),
      selectCurrent,
      update: jest.fn().mockResolvedValue({}),
      add: jest.fn(),
      remove: jest.fn(),
    });

    let component;
    try {
      Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
      await render.act(async () => {
        component = render.create(
          <>
            <WebAlertHost />
            <ControlledLogScreen workoutNoteText={sharedRaw} />
          </>
        );
      });

      const root = component.root;
      expandRoutineManagement(root);
      render.act(() => { findPressableByText(root, 'Home Routine').props.onPress(); });
      render.act(() => {
        findPressableByText(root, 'Set as current routine').props.onPress({ stopPropagation: () => {} });
      });
      const confirm = root.findAll(
        n => n.props?.accessibilityLabel === 'Set as current routine'
          && typeof n.props?.onPress === 'function'
      ).at(-1);
      render.act(() => { confirm.props.onPress(); });

      const noRollover = root.findAll(
        n => n.props?.accessibilityLabel === 'No' && typeof n.props?.onPress === 'function'
      ).at(-1);
      expect(noRollover).toBeTruthy();
      expect(selectCurrent).not.toHaveBeenCalled();
      await render.act(async () => {
        noRollover.props.onPress();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(selectCurrent).toHaveBeenCalledTimes(1);
      expect(selectCurrent).toHaveBeenCalledWith(note2.id);
      await render.act(async () => {
        jest.runOnlyPendingTimers();
        await Promise.resolve();
      });
    } finally {
      if (component) await render.act(async () => { component.unmount(); });
      Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS });
    }
  });
});

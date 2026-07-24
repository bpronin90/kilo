// Editor hydration authority (#614, follow-up to #572 claim 30): App.js used to
// infer "unhydrated" from `!workoutNoteText`, which is indistinguishable from a
// deliberate clear-to-empty edit. These tests mount the real App shell (LogScreen
// stubbed to expose the text/title it was handed) and drive noteHook.currentId /
// currentNote transitions directly to prove:
//   - initial async hydration still loads stored text/title
//   - an actual routine switch still loads the new note's text/title
//   - a deliberate clear stays empty across an unrelated currentNote object refresh
//     (same id, new object identity/content — e.g. a remote/background reload)

import React from 'react';
import renderer from 'react-test-renderer';
import App from '../App';
import * as useEntries from '../hooks/useEntries';

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

jest.mock('expo-updates', () => ({
  useUpdates: jest.fn(() => ({ isUpdatePending: false })),
  reloadAsync: jest.fn(),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(null),
  removeItem: jest.fn().mockResolvedValue(null),
}));

// Neutralize App's unawaited startup async work so it cannot resolve after the
// Jest environment is torn down. On mount App fires installForegroundHandler()
// and reconcileWorkoutReminder() (both from lib/reminderScheduler), which each
// perform a lazy require('expo-notifications') inside their async bodies. The
// synchronous act() transitions this suite drives complete before those
// promises settle, so the deferred lazy require (and any trailing setState) ran
// after teardown — surfacing as "You are trying to `import` a file after the
// Jest environment has been torn down" plus an uncaught <App> error. Mocking
// them to resolved no-ops removes that post-teardown work at the source without
// touching product code or any assertion.
jest.mock('../lib/reminderScheduler', () => ({
  installForegroundHandler: jest.fn().mockResolvedValue(undefined),
  reconcileWorkoutReminder: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../screens/HomeScreen', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { HomeScreen: () => React.createElement(View) };
});
jest.mock('../screens/AnalyticsScreen', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { AnalyticsScreen: () => React.createElement(View) };
});
jest.mock('../screens/MoreScreen', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { MoreScreen: () => React.createElement(View) };
});
jest.mock('../screens/WeightScreen', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { WeightScreen: () => React.createElement(View) };
});

let latestLogProps = null;
jest.mock('../screens/LogScreen', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    LogScreen: (props) => {
      latestLogProps = props;
      return React.createElement(View, { testID: 'log-screen-stub' });
    },
  };
});

jest.mock('../components/TabBar', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { TabBar: () => React.createElement(View, { testID: 'tab-bar' }) };
});

jest.mock('../hooks/entries/weightHooks', () => ({
  useArchivedWeightGoals: () => ({ archivedGoals: [], loading: false, refresh: jest.fn() }),
  useWeightGoal: jest.fn(),
  useWeightEntries: jest.fn(),
  reloadWeightEntries: jest.fn(),
}));

jest.mock('../hooks/useEntries');

jest.mock('../components/ScreenShell', () => {
  const React = require('react');
  const { View } = require('react-native');
  const ScreenShell = React.forwardRef(({ children, headerRight }, ref) => (
    React.createElement(View, null, headerRight, children)
  ));
  return {
    ScreenShell,
    ScrollContext: React.createContext({ onScroll: () => {} }),
  };
});

const NOTE_A = {
  id: 'note-a',
  title: 'Routine A',
  raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5',
  saved_at: '2026-06-01T12:00:00.000Z',
};

const NOTE_B = {
  id: 'note-b',
  title: 'Routine B',
  raw_text: 'Tuesday\n+Lifting\n-Squat\n185 5,5,5',
  saved_at: '2026-06-02T12:00:00.000Z',
};

const WEIGHT_ENTRY = {
  id: 'e1',
  date: '2026-05-24',
  logged_at: '2026-05-24T08:00:00Z',
  weight_value: 185,
  weight_unit: 'lb',
  note: '',
};

function baseNoteHookMock(overrides) {
  return {
    notes: [],
    currentId: null,
    currentNote: null,
    deloadNotes: [],
    loading: false,
    error: null,
    refresh: jest.fn(),
    selectCurrent: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
    add: jest.fn(),
    remove: jest.fn(),
    ...overrides,
  };
}

describe('App workout-editor hydration authority (#614)', () => {
  let component;

  beforeEach(() => {
    latestLogProps = null;

    useEntries.useWeightEntries.mockReturnValue({
      entries: [{ ...WEIGHT_ENTRY }],
      loading: false,
      refresh: jest.fn(),
      remove: jest.fn(),
      update: jest.fn(),
    });
    useEntries.useWeightGoal.mockReturnValue({
      goal: null,
      save: jest.fn(),
      clear: jest.fn(),
      archiveGoal: jest.fn(),
    });
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: [], toggle: jest.fn() });
    useEntries.useDeloadNote.mockReturnValue({ note: { raw_text: '' }, loading: false, save: jest.fn(), clear: jest.fn() });
    useEntries.useDeloadHistory.mockReturnValue({
      history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
    });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: false });
    useEntries.useUserProfile.mockReturnValue(null);
    useEntries.useAutoSync.mockReturnValue({});
  });

  afterEach(async () => {
    // Tear the tree down deterministically: unmount inside act so cleanup
    // effects run, then flush any remaining microtasks (e.g. the mocked
    // startup promises / loadFatigueMultiplier-style .then(setState) chains
    // reading mocked AsyncStorage) while the environment is still alive. This
    // guarantees no App-scheduled async work settles after Jest tears down.
    if (component) {
      renderer.act(() => {
        component.unmount();
      });
    }
    await renderer.act(async () => {
      await Promise.resolve();
    });
    component = null;
    latestLogProps = null;
  });

  test('initial async hydration loads stored text/title once currentNote arrives for the still-current id', () => {
    useEntries.useWorkoutNotes.mockReturnValue(baseNoteHookMock({ currentId: 'note-a', currentNote: null }));
    renderer.act(() => {
      component = renderer.create(<App />);
    });
    expect(latestLogProps.workoutNoteText).toBe('');
    expect(latestLogProps.workoutNoteTitle).toBe('');

    // The note list finishes loading asynchronously; currentId is unchanged but
    // currentNote now resolves for the first time.
    useEntries.useWorkoutNotes.mockReturnValue(baseNoteHookMock({
      notes: [NOTE_A], currentId: 'note-a', currentNote: NOTE_A,
    }));
    renderer.act(() => {
      component.update(<App />);
    });

    expect(latestLogProps.workoutNoteText).toBe(NOTE_A.raw_text);
    expect(latestLogProps.workoutNoteTitle).toBe(NOTE_A.title);
  });

  test('an actual routine switch (currentId change) still loads the new note text/title', () => {
    useEntries.useWorkoutNotes.mockReturnValue(baseNoteHookMock({
      notes: [NOTE_A, NOTE_B], currentId: 'note-a', currentNote: NOTE_A,
    }));
    renderer.act(() => {
      component = renderer.create(<App />);
    });
    expect(latestLogProps.workoutNoteText).toBe(NOTE_A.raw_text);

    useEntries.useWorkoutNotes.mockReturnValue(baseNoteHookMock({
      notes: [NOTE_A, NOTE_B], currentId: 'note-b', currentNote: NOTE_B,
    }));
    renderer.act(() => {
      component.update(<App />);
    });

    expect(latestLogProps.workoutNoteText).toBe(NOTE_B.raw_text);
    expect(latestLogProps.workoutNoteTitle).toBe(NOTE_B.title);
  });

  test('a routine switch where currentId updates a render before its currentNote resolves still hydrates once the note arrives (#644 review)', () => {
    useEntries.useWorkoutNotes.mockReturnValue(baseNoteHookMock({
      notes: [NOTE_A], currentId: 'note-a', currentNote: NOTE_A,
    }));
    renderer.act(() => {
      component = renderer.create(<App />);
    });
    expect(latestLogProps.workoutNoteText).toBe(NOTE_A.raw_text);

    // currentId flips to the new routine, but noteHook.currentNote has not
    // resolved yet (id and note resolution are not atomic) — the editor
    // clears in the interim.
    useEntries.useWorkoutNotes.mockReturnValue(baseNoteHookMock({
      notes: [NOTE_A], currentId: 'note-b', currentNote: null,
    }));
    renderer.act(() => {
      component.update(<App />);
    });
    expect(latestLogProps.workoutNoteText).toBe('');
    expect(latestLogProps.workoutNoteTitle).toBe('');

    // The matching note object resolves on a later render with the same id.
    useEntries.useWorkoutNotes.mockReturnValue(baseNoteHookMock({
      notes: [NOTE_A, NOTE_B], currentId: 'note-b', currentNote: NOTE_B,
    }));
    renderer.act(() => {
      component.update(<App />);
    });
    expect(latestLogProps.workoutNoteText).toBe(NOTE_B.raw_text);
    expect(latestLogProps.workoutNoteTitle).toBe(NOTE_B.title);

    // Once resolved, a deliberate clear on note-b is still respected across an
    // unrelated refresh of the same id.
    renderer.act(() => {
      latestLogProps.setWorkoutNoteText('');
      latestLogProps.setWorkoutNoteTitle('');
    });
    const refreshedNoteB = { ...NOTE_B, saved_at: '2026-06-04T00:00:00.000Z' };
    useEntries.useWorkoutNotes.mockReturnValue(baseNoteHookMock({
      notes: [NOTE_A, refreshedNoteB], currentId: 'note-b', currentNote: refreshedNoteB,
    }));
    renderer.act(() => {
      component.update(<App />);
    });
    expect(latestLogProps.workoutNoteText).toBe('');
    expect(latestLogProps.workoutNoteTitle).toBe('');
  });

  test('a deliberate clear stays empty across an unrelated currentNote object refresh for the same id', () => {
    useEntries.useWorkoutNotes.mockReturnValue(baseNoteHookMock({
      notes: [NOTE_A], currentId: 'note-a', currentNote: NOTE_A,
    }));
    renderer.act(() => {
      component = renderer.create(<App />);
    });
    expect(latestLogProps.workoutNoteText).toBe(NOTE_A.raw_text);

    // The user deliberately clears the editor.
    renderer.act(() => {
      latestLogProps.setWorkoutNoteText('');
      latestLogProps.setWorkoutNoteTitle('');
    });
    expect(latestLogProps.workoutNoteText).toBe('');

    // A remote/background reload refreshes the notes list: same id, but a brand
    // new currentNote object (and, notably, still non-empty raw_text) — this must
    // not refill the deliberately-cleared editor.
    const refreshedNoteA = { ...NOTE_A, saved_at: '2026-06-03T00:00:00.000Z' };
    useEntries.useWorkoutNotes.mockReturnValue(baseNoteHookMock({
      notes: [refreshedNoteA], currentId: 'note-a', currentNote: refreshedNoteA,
    }));
    renderer.act(() => {
      component.update(<App />);
    });

    expect(latestLogProps.workoutNoteText).toBe('');
    expect(latestLogProps.workoutNoteTitle).toBe('');
  });

  test('switching to a genuinely different routine after a clear still hydrates the new note', () => {
    useEntries.useWorkoutNotes.mockReturnValue(baseNoteHookMock({
      notes: [NOTE_A, NOTE_B], currentId: 'note-a', currentNote: NOTE_A,
    }));
    renderer.act(() => {
      component = renderer.create(<App />);
    });

    renderer.act(() => {
      latestLogProps.setWorkoutNoteText('');
      latestLogProps.setWorkoutNoteTitle('');
    });

    useEntries.useWorkoutNotes.mockReturnValue(baseNoteHookMock({
      notes: [NOTE_A, NOTE_B], currentId: 'note-b', currentNote: NOTE_B,
    }));
    renderer.act(() => {
      component.update(<App />);
    });

    expect(latestLogProps.workoutNoteText).toBe(NOTE_B.raw_text);
    expect(latestLogProps.workoutNoteTitle).toBe(NOTE_B.title);
  });
});

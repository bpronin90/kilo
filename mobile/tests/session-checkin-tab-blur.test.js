import React from 'react';
import { act } from 'react';
import render from 'react-test-renderer';

jest.useFakeTimers();

jest.mock('../lib/data', () => ({
  ...jest.requireActual('../lib/data'),
  deriveSessionCheckIn: jest.fn(() => ({
    isRough: true,
    sessionIndex: 0,
    flagged: [{ name: 'Bench', normName: 'bench', reasons: ['volume_drop'] }],
    detectors: ['volume_drop'],
    metrics: { exercises_skipped: 0, volume_decline_pct: 30 },
  })),
  normalizeLiftName: jest.fn(n => n.toLowerCase()),
  listTrackedLifts: jest.fn(() => []),
  getDefaultTrackedNames: jest.fn(() => ['Bench Press']),
  deriveWorkoutNoteAnalytics: jest.fn(() => ({ classifications: {} })),
  deriveSkipData: jest.fn(() => ({ exercise_skips: [], day_skips: [], attendance_flags: [] })),
}));

jest.mock('../lib/parser', () => ({
  parseWorkoutNote: jest.fn(() => ({ sections: [], weekBStartIndex: null })),
  countWorkoutSessionsFromSections: jest.fn(() => 2),
}));

jest.mock('react-native/Libraries/Alert/Alert', () => ({ alert: jest.fn() }));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  multiGet: jest.fn(() => []),
  multiSet: jest.fn(),
}));

import { useLogCurrentRoutineEditor } from '../screens/log/useLogCurrentRoutineEditor';

const { View, Text } = require('react-native');

function Probe({ isActive }) {
  const editor = useLogCurrentRoutineEditor({
    workoutNoteText: 'Monday\n+Bench\n135 2,2,2\n\nMonday\n+Bench\n135 5,5,5',
    setWorkoutNoteText: jest.fn(),
    workoutNoteTitle: 'Test',
    setWorkoutNoteTitle: jest.fn(),
    currentId: 'note-1',
    currentNote: { id: 'note-1', session_checkins: {} },
    notes: [],
    trackedLifts: [],
    update: jest.fn().mockResolvedValue(true),
    add: jest.fn(),
    selectCurrent: jest.fn(),
    fatigueTrackingEnabled: true,
    isActive,
    editorScrollRef: { current: null },
    readScrollRef: { current: null },
  });
  return React.createElement(View, null,
    React.createElement(Text, { testID: 'mode' }, editor.mode),
    React.createElement(Text, { testID: 'showModal' }, String(editor.showCheckInModal)),
    React.createElement(Text, { testID: 'enterEdit', onPress: editor.enterCurrentEditor }, 'edit'),
  );
}

function text(instance, id) {
  return instance.root.findByProps({ testID: id }).props.children;
}

describe('tab-blur fires check-in detection in edit mode', () => {
  beforeEach(() => {
    global.requestAnimationFrame = cb => { cb(); return 0; };
  });
  afterEach(() => {
    jest.clearAllTimers();
  });

  it('isActive false while in read mode does NOT show modal', async () => {
    let instance;
    await act(async () => {
      instance = render.create(React.createElement(Probe, { isActive: true }));
    });
    expect(text(instance, 'mode')).toBe('read');

    await act(async () => {
      instance.update(React.createElement(Probe, { isActive: false }));
    });

    expect(text(instance, 'showModal')).toBe('false');
  });

  it('isActive false while in edit mode shows modal (detection fires)', async () => {
    let instance;
    await act(async () => {
      instance = render.create(React.createElement(Probe, { isActive: true }));
    });

    // Enter edit mode.
    await act(async () => {
      instance.root.findByProps({ testID: 'enterEdit' }).props.onPress();
    });
    expect(text(instance, 'mode')).toBe('edit');
    expect(text(instance, 'showModal')).toBe('false');

    // Simulate tab switch away.
    await act(async () => {
      instance.update(React.createElement(Probe, { isActive: false }));
    });

    expect(text(instance, 'showModal')).toBe('true');
  });
});

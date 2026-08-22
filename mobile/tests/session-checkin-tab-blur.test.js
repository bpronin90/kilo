import React from 'react';
import { act } from 'react';
import render from 'react-test-renderer';

// Fake timers are installed per-test (see beforeEach), not at module scope: a
// module-scope jest.useFakeTimers() contaminates React/react-test-renderer
// scheduler state during import-graph evaluation, which then leaks across Jest's
// shared worker into the next test file (#679).

// deriveSessionCheckIn is stubbed to ALWAYS report a rough session, so these
// tests isolate the trigger site: any prompt that appears here appeared because
// something raised it, not because the detectors were borderline.
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

let update;

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
    update,
    add: jest.fn(),
    selectCurrent: jest.fn(),
    fatigueTrackingEnabled: true,
    // Still accepted by the screen for its own purposes; the editor no longer
    // reads it, and this prop is what the removed blur trigger keyed on.
    isActive,
    editorScrollRef: { current: null },
    readScrollRef: { current: null },
  });
  return React.createElement(View, null,
    React.createElement(Text, { testID: 'mode' }, editor.mode),
    React.createElement(Text, { testID: 'showModal' }, String(editor.showCheckInModal)),
    React.createElement(Text, { testID: 'flagged' }, String(editor.roughFlaggedNames.size)),
    React.createElement(Text, { testID: 'enterEdit', onPress: editor.enterCurrentEditor }, 'edit'),
    React.createElement(Text, { testID: 'done', onPress: editor.handleDoneCurrent }, 'done'),
  );
}

function text(instance, id) {
  return instance.root.findByProps({ testID: id }).props.children;
}

// Leaving the Log tab is an interruption, not a completion. It was also the one
// path that could ask about text the store had not accepted yet, because it
// read the live draft without waiting for the 800 ms autosave. The check-in is
// a closing question, so `Done` after a verified save is the only place it is
// asked.
describe('leaving the Log tab never raises a check-in', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    update = jest.fn().mockResolvedValue({ id: 'note-1', title: 'Test', raw_text: 'x' });
    global.requestAnimationFrame = cb => { cb(); return 0; };
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('losing focus while in read mode shows nothing', async () => {
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

  it('losing focus mid-edit shows nothing and writes nothing, even with a rough session pending', async () => {
    let instance;
    await act(async () => {
      instance = render.create(React.createElement(Probe, { isActive: true }));
    });

    await act(async () => {
      instance.root.findByProps({ testID: 'enterEdit' }).props.onPress();
    });
    expect(text(instance, 'mode')).toBe('edit');

    // Switch away, exactly as the removed trigger did.
    await act(async () => {
      instance.update(React.createElement(Probe, { isActive: false }));
    });

    expect(text(instance, 'showModal')).toBe('false');
    expect(text(instance, 'flagged')).toBe('0');
    expect(update).not.toHaveBeenCalled();
  });

  it('the session left behind on blur is still eligible at the next Done', async () => {
    let instance;
    await act(async () => {
      instance = render.create(React.createElement(Probe, { isActive: true }));
    });
    await act(async () => {
      instance.root.findByProps({ testID: 'enterEdit' }).props.onPress();
    });
    await act(async () => {
      instance.update(React.createElement(Probe, { isActive: false }));
    });
    expect(text(instance, 'showModal')).toBe('false');

    // Nothing was written on blur, so the same session can still be asked
    // about once the user actually finishes it.
    await act(async () => {
      instance.update(React.createElement(Probe, { isActive: true }));
    });
    await act(async () => {
      await instance.root.findByProps({ testID: 'done' }).props.onPress();
    });

    expect(text(instance, 'showModal')).toBe('true');
  });
});

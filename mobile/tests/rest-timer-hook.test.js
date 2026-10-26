import React from 'react';
import render from 'react-test-renderer';
import { useRestTimer } from '../hooks/useRestTimer';

const mockReconcileRestTimer = jest.fn();
const mockStartRestTimer = jest.fn();
const mockCancelRestTimer = jest.fn(async () => {});

jest.mock('../lib/restTimerScheduler', () => ({
  startRestTimer: (...args) => mockStartRestTimer(...args),
  cancelRestTimer: (...args) => mockCancelRestTimer(...args),
  reconcileRestTimer: (...args) => mockReconcileRestTimer(...args),
  remindersSupported: () => true,
}));

const mockPlaySound = jest.fn(async () => ({ played: true }));
jest.mock('../lib/restTimerSound', () => ({
  playRestTimerCompletionSound: (...args) => mockPlaySound(...args),
}));

jest.mock('../lib/reminderScheduler', () => ({
  setNotificationHandlerAppActive: jest.fn(),
}));

const mounted = [];
afterEach(() => {
  render.act(() => { mounted.forEach((c) => c.unmount()); });
  mounted.length = 0;
  jest.clearAllMocks();
});

function mountHook() {
  let latest = null;
  function Probe() {
    latest = useRestTimer();
    return null;
  }
  let tree;
  render.act(() => {
    tree = render.create(<Probe />);
  });
  mounted.push(tree);
  return { get: () => latest };
}

// #577 review (Codex, post-freeze): reconcileRestTimer returns the elapsed
// record purely informationally even when it has already cleared storage
// and decided (justElapsed: false) NOT to surface a banner — e.g. the
// process was away and the OS notification already owned that alert, or
// the record was stale (elapsed long ago). Storing that record into hook
// state must never happen, or the foreground-tick effect immediately
// recomputes 0ms remaining and flips justElapsed to true itself, showing a
// duplicate/replayed completion banner on top of (or instead of) the real
// one.
describe('useRestTimer — elapsed records never re-enter state (#577 review)', () => {
  test('a record that elapsed while the process was away (justElapsed: false) never starts the tick or flips justElapsed', async () => {
    const elapsedRecord = {
      version: 1,
      timerId: 't1',
      startedAtMs: Date.now() - 120000,
      durationSec: 60,
      endsAtMs: Date.now() - 60000,
      exerciseLabel: null,
      notificationId: null,
      notificationScheduled: true,
    };
    mockReconcileRestTimer.mockResolvedValue({ record: elapsedRecord, justElapsed: false });

    const h = mountHook();
    await render.act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(h.get().record).toBeNull();
    expect(h.get().isRunning).toBe(false);
    expect(h.get().justElapsed).toBe(false);
    expect(h.get().remainingMs).toBe(0);
  });

  test('a still-running record (not elapsed) does enter state normally', async () => {
    const runningRecord = {
      version: 1,
      timerId: 't2',
      startedAtMs: Date.now(),
      durationSec: 6000,
      endsAtMs: Date.now() + 6000000,
      exerciseLabel: null,
      notificationId: null,
      notificationScheduled: true,
    };
    mockReconcileRestTimer.mockResolvedValue({ record: runningRecord, justElapsed: false });

    const h = mountHook();
    await render.act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(h.get().record).toEqual(runningRecord);
    expect(h.get().isRunning).toBe(true);
  });

  test('a genuinely just-elapsed-while-active record still surfaces justElapsed without entering record state', async () => {
    const elapsedRecord = {
      version: 1,
      timerId: 't3',
      startedAtMs: Date.now() - 60000,
      durationSec: 60,
      endsAtMs: Date.now() - 100,
      exerciseLabel: null,
      notificationId: null,
      notificationScheduled: true,
    };
    mockReconcileRestTimer.mockResolvedValue({ record: elapsedRecord, justElapsed: true });

    const h = mountHook();
    await render.act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(h.get().record).toBeNull();
    expect(h.get().isRunning).toBe(false);
    expect(h.get().justElapsed).toBe(true); // the banner itself is still allowed to show once
  });
});

// User-reported item 1: "Notification scheduling failure hiding a
// persisted timer." Confirmed defect: restTimerScheduler.startRestTimer
// used to let a rejected scheduleNotificationAsync call propagate out of
// startRestTimer entirely — the record was already durably persisted to
// storage first, but useRestTimer.js's start() never reached its own
// setRecord(r) call, so the countdown UI showed nothing despite a real
// timer running in storage. Fixed in restTimerScheduler.js: every failure
// after the initial persist now resolves with the persisted record instead
// of rejecting. This test proves the hook layer correctly surfaces that
// record once the scheduler stops rejecting.
describe('useRestTimer.start() surfaces a persisted timer even when scheduling fails (user item 1)', () => {
  test('start() still sets record when startRestTimer resolves (not rejects) after a scheduling failure', async () => {
    const persistedButUnscheduled = {
      version: 1,
      timerId: 't4',
      startedAtMs: Date.now(),
      durationSec: 90,
      endsAtMs: Date.now() + 90000,
      exerciseLabel: null,
      notificationId: null,
      notificationScheduled: false, // scheduling failed, but the record is real
    };
    mockReconcileRestTimer.mockResolvedValue({ record: null, justElapsed: false });
    mockStartRestTimer.mockResolvedValue(persistedButUnscheduled);

    const h = mountHook();
    await render.act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await render.act(async () => { await h.get().start(90); });

    expect(h.get().record).toEqual(persistedButUnscheduled);
    expect(h.get().isRunning).toBe(true);
    expect(h.get().backgroundAlertAvailable).toBe(false);
  });
});

// #1651: the foreground completion cue is owned by the timer lifecycle.
describe('useRestTimer — completion sound (#1651)', () => {
  function runningRecord(timerId, endsInMs) {
    return {
      version: 1,
      timerId,
      startedAtMs: Date.now(),
      durationSec: 1,
      endsAtMs: Date.now() + endsInMs,
      exerciseLabel: null,
      notificationId: null,
      notificationScheduled: true,
    };
  }

  const { AppState: RNAppState } = require('react-native');
  const originalState = RNAppState.currentState;
  beforeEach(() => {
    jest.useFakeTimers();
    RNAppState.currentState = 'active';
  });
  afterEach(() => { RNAppState.currentState = originalState; jest.useRealTimers(); });

  test('plays exactly once when an active timer completes in the foreground', async () => {
    mockReconcileRestTimer.mockResolvedValue({ record: runningRecord('s1', 1000), justElapsed: false });
    const h = mountHook();
    await render.act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await render.act(async () => { jest.advanceTimersByTime(3000); });

    expect(mockPlaySound).toHaveBeenCalledTimes(1);
    expect(mockPlaySound).toHaveBeenCalledWith('s1');
    expect(h.get().justElapsed).toBe(true);
    expect(h.get().record).toBeNull();
  });

  test('a rejecting sound call never blocks completion UI or leaks a rejection', async () => {
    mockPlaySound.mockRejectedValueOnce(new Error('boom'));
    mockReconcileRestTimer.mockResolvedValue({ record: runningRecord('s2', 500), justElapsed: false });
    const h = mountHook();
    await render.act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await render.act(async () => { jest.advanceTimersByTime(2000); });

    expect(h.get().justElapsed).toBe(true);
  });

  test('cancelling before the end never plays', async () => {
    mockReconcileRestTimer.mockResolvedValue({ record: runningRecord('s3', 5000), justElapsed: false });
    const h = mountHook();
    await render.act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await render.act(async () => { await h.get().cancel(); });
    await render.act(async () => { jest.advanceTimersByTime(10000); });

    expect(mockPlaySound).not.toHaveBeenCalled();
  });

  test('a cold-start elapsed record never plays', async () => {
    mockReconcileRestTimer.mockResolvedValue({ record: runningRecord('s4', -60000), justElapsed: false });
    mountHook();
    await render.act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await render.act(async () => { jest.advanceTimersByTime(2000); });

    expect(mockPlaySound).not.toHaveBeenCalled();
  });

  test('a timer that ended while the app was away does not replay on return', async () => {
    const { AppState } = require('react-native');
    let change;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_e, cb) => {
      change = cb;
      return { remove: () => {} };
    });
    const record = runningRecord('s5', 2000);
    mockReconcileRestTimer.mockResolvedValue({ record, justElapsed: false });
    const h = mountHook();
    await render.act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(h.get().record).toEqual(record);

    await render.act(async () => { change('background'); });
    jest.setSystemTime(Date.now() + 10000); // ended while away; OS alert owned it
    await render.act(async () => { change('active'); });
    await render.act(async () => { jest.advanceTimersByTime(1000); });

    expect(mockPlaySound).not.toHaveBeenCalled();
    AppState.addEventListener.mockRestore();
  });
});

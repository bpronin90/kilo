import { REMINDER_KIND } from '../lib/reminders';

const mockNotifications = {
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => {}),
  getPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: false })),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  scheduleNotificationAsync: jest.fn(async () => 'id'),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  AndroidImportance: { DEFAULT: 3 },
};

jest.mock('expo-notifications', () => mockNotifications);

jest.mock('../storage/entries', () => ({
  loadWorkoutReminder: jest.fn(),
  loadWorkoutNotes: jest.fn(),
  loadCurrentWorkoutId: jest.fn(),
}));

const Storage = require('../storage/entries');

const {
  requestReminderPermission,
  cancelReminders,
  applyWeighInReminder,
  applyWorkoutReminder,
  reconcileWorkoutReminder,
  __resetWorkoutReminderReconciliationForTests,
  installForegroundHandler,
} = require('../lib/reminderScheduler');

function setActiveNote(note) {
  Storage.loadWorkoutNotes.mockResolvedValue(note ? [note] : []);
  Storage.loadCurrentWorkoutId.mockResolvedValue(note?.id ?? null);
}

// Resolves an explicit {resolve, reject} pair rather than a fixed value/delay,
// so tests can pin down exactly when a mocked native call completes and
// assert on the state in between — deterministic ordering instead of
// incidental microtask-count timing.
function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// setImmediate only runs once the microtask queue is fully drained, which
// reliably lets an in-flight await chain (Storage reads, then cancel, then a
// sequential per-weekday schedule loop) settle up to its next real suspension
// point, regardless of how many microtask hops deep that chain is.
async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNotifications.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
  mockNotifications.requestPermissionsAsync.mockResolvedValue({ granted: false });
  mockNotifications.getAllScheduledNotificationsAsync.mockResolvedValue([]);
  mockNotifications.scheduleNotificationAsync.mockResolvedValue('id');
  __resetWorkoutReminderReconciliationForTests();
  Storage.loadWorkoutReminder.mockResolvedValue({ enabled: false, hour: 17, minute: 0, fallbackWeekdays: [] });
  setActiveNote(null);
});

describe('requestReminderPermission', () => {
  test('asks the OS only when not already granted, and reports denial', async () => {
    await expect(requestReminderPermission()).resolves.toBe(false);
    expect(mockNotifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  test('returns true without re-prompting when already granted', async () => {
    mockNotifications.getPermissionsAsync.mockResolvedValue({ granted: true });
    await expect(requestReminderPermission()).resolves.toBe(true);
    expect(mockNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  test('does not re-prompt when the OS says it cannot ask again', async () => {
    mockNotifications.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
    await expect(requestReminderPermission()).resolves.toBe(false);
    expect(mockNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe('cancel-on-disable', () => {
  test('disabling the weigh-in toggle cancels only weigh-in notifications and schedules nothing', async () => {
    mockNotifications.getAllScheduledNotificationsAsync.mockResolvedValue([
      { identifier: 'w1', content: { data: { kind: REMINDER_KIND.WEIGH_IN } } },
      { identifier: 'g1', content: { data: { kind: REMINDER_KIND.WORKOUT } } },
    ]);

    await applyWeighInReminder({ enabled: false, hour: 8, minute: 0 });

    expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
    expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('w1');
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  test('disabling the workout toggle cancels its weekly notifications', async () => {
    mockNotifications.getAllScheduledNotificationsAsync.mockResolvedValue([
      { identifier: 'g1', content: { data: { kind: REMINDER_KIND.WORKOUT } } },
      { identifier: 'g2', content: { data: { kind: REMINDER_KIND.WORKOUT } } },
    ]);

    await applyWorkoutReminder({ enabled: false, hour: 17, minute: 0 }, [2, 4]);

    expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(2);
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

describe('enable scheduling', () => {
  test('enabling the weigh-in reminder reschedules a single daily notification', async () => {
    mockNotifications.getAllScheduledNotificationsAsync.mockResolvedValue([
      { identifier: 'old', content: { data: { kind: REMINDER_KIND.WEIGH_IN } } },
    ]);

    await applyWeighInReminder({ enabled: true, hour: 7, minute: 30 });

    expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('old');
    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const call = mockNotifications.scheduleNotificationAsync.mock.calls[0][0];
    expect(call.trigger).toMatchObject({ type: 'daily', hour: 7, minute: 30 });
    expect(call.content.data).toEqual({ kind: REMINDER_KIND.WEIGH_IN });
  });

  test('enabling the workout nudge schedules one weekly notification per weekday', async () => {
    await applyWorkoutReminder({ enabled: true, hour: 18, minute: 0 }, [2, 6]);

    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
    const weekdays = mockNotifications.scheduleNotificationAsync.mock.calls.map((c) => c[0].trigger.weekday);
    expect(weekdays).toEqual([2, 6]);
  });

  test('cancelReminders is a no-op when nothing matching is scheduled', async () => {
    await cancelReminders(REMINDER_KIND.WEIGH_IN);
    expect(mockNotifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });
});

describe('installForegroundHandler', () => {
  test('is exported and callable', async () => {
    expect(typeof installForegroundHandler).toBe('function');
  });

  test('does not throw when called', async () => {
    // Function should complete without error, whether or not handler
    // is re-installed (prepared flag may already be true from other tests)
    await expect(installForegroundHandler()).resolves.toBeUndefined();
  });
});

// reconcileWorkoutReminder (#590): a full reconciliation-state-machine pass.
// Numbered comments below map 1:1 to the ten-item verification matrix from
// the PR #649 review.
describe('reconcileWorkoutReminder (#590)', () => {
  const MONDAY_NOTE = {
    id: 'note-1',
    isCurrent: true,
    raw_text: ['Monday', '-Bench press', '185 5x5'].join('\n'),
  };
  const MONDAY_WEDNESDAY_NOTE = {
    id: 'note-1',
    isCurrent: true,
    raw_text: ['Monday', '-Bench press', '185 5x5', '', 'Wednesday', '-Squat', '225 5x5'].join('\n'),
  };
  const OTHER_ROUTINE_FRIDAY_NOTE = {
    id: 'note-2',
    isCurrent: true,
    raw_text: ['Friday', '-Deadlift', '315 3x5'].join('\n'),
  };
  const PUSH_DAY_NOTE = {
    id: 'note-3',
    isCurrent: true,
    raw_text: ['Push day', '-Bench press', '185 5x5'].join('\n'),
  };
  const ENABLED_INFERRED_WORKOUT = { enabled: true, hour: 17, minute: 0, fallbackWeekdays: [] };

  // 1. Sequential identical calls are idempotent.
  test('1. is idempotent: a repeated sequential call with the same routine reschedules once, not again', async () => {
    setActiveNote(MONDAY_NOTE);
    Storage.loadWorkoutReminder.mockResolvedValue(ENABLED_INFERRED_WORKOUT);

    await reconcileWorkoutReminder();
    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    jest.clearAllMocks();
    mockNotifications.getAllScheduledNotificationsAsync.mockResolvedValue([]);

    await reconcileWorkoutReminder();
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(mockNotifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });

  test('reschedules an enabled inferred-weekday reminder after the routine text changes', async () => {
    setActiveNote(MONDAY_NOTE);
    Storage.loadWorkoutReminder.mockResolvedValue(ENABLED_INFERRED_WORKOUT);

    const first = await reconcileWorkoutReminder();
    expect(first.inferredWeekdays).toEqual([2]);
    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();
    mockNotifications.getAllScheduledNotificationsAsync.mockResolvedValue([]);
    setActiveNote(MONDAY_WEDNESDAY_NOTE);
    Storage.loadWorkoutReminder.mockResolvedValue(ENABLED_INFERRED_WORKOUT);

    const second = await reconcileWorkoutReminder();
    expect(second.inferredWeekdays).toEqual([2, 4]);
    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
    const weekdays = mockNotifications.scheduleNotificationAsync.mock.calls.map((c) => c[0].trigger.weekday);
    expect(weekdays).toEqual([2, 4]);
    expect(mockNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  test('reschedules an enabled inferred-weekday reminder after the active routine switches', async () => {
    setActiveNote(MONDAY_NOTE);
    Storage.loadWorkoutReminder.mockResolvedValue(ENABLED_INFERRED_WORKOUT);
    await reconcileWorkoutReminder();
    jest.clearAllMocks();
    mockNotifications.getAllScheduledNotificationsAsync.mockResolvedValue([]);

    setActiveNote(OTHER_ROUTINE_FRIDAY_NOTE);
    Storage.loadWorkoutReminder.mockResolvedValue(ENABLED_INFERRED_WORKOUT);
    const result = await reconcileWorkoutReminder();

    expect(result.inferredWeekdays).toEqual([6]);
    const weekdays = mockNotifications.scheduleNotificationAsync.mock.calls.map((c) => c[0].trigger.weekday);
    expect(weekdays).toEqual([6]);
    expect(mockNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  // 8. Explicit fallback weekdays authoritative when inference empty.
  test('8. keeps explicit fallback weekdays authoritative when the routine has no inferred days', async () => {
    const FALLBACK_WORKOUT = { enabled: true, hour: 17, minute: 0, fallbackWeekdays: [2] };
    setActiveNote(PUSH_DAY_NOTE);
    Storage.loadWorkoutReminder.mockResolvedValue(FALLBACK_WORKOUT);

    const result = await reconcileWorkoutReminder();

    expect(result.inferredWeekdays).toEqual([]);
    const weekdays = mockNotifications.scheduleNotificationAsync.mock.calls.map((c) => c[0].trigger.weekday);
    expect(weekdays).toEqual([2]);
  });

  test('leaves a disabled workout reminder unscheduled even when the routine changes', async () => {
    setActiveNote(MONDAY_NOTE);
    Storage.loadWorkoutReminder.mockResolvedValue({ enabled: false, hour: 17, minute: 0, fallbackWeekdays: [] });

    await reconcileWorkoutReminder();
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    jest.clearAllMocks();
    mockNotifications.getAllScheduledNotificationsAsync.mockResolvedValue([]);

    setActiveNote(MONDAY_WEDNESDAY_NOTE);
    const result = await reconcileWorkoutReminder();

    expect(result.inferredWeekdays).toEqual([2, 4]);
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(mockNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  // 7. Disabled startup reconciliation cancels stale persisted notifications.
  test('7. reconciling a disabled workout reminder still cancels a stale persisted notification', async () => {
    // A workout notification left scheduled from a previous enabled state —
    // e.g. the app is restarted after the reminder was disabled elsewhere, or
    // Storage was mutated directly without going through applyWorkoutReminder.
    mockNotifications.getAllScheduledNotificationsAsync.mockResolvedValue([
      { identifier: 'stale-workout-1', content: { data: { kind: REMINDER_KIND.WORKOUT } } },
      { identifier: 'stale-workout-2', content: { data: { kind: REMINDER_KIND.WORKOUT } } },
    ]);
    setActiveNote(MONDAY_NOTE);
    Storage.loadWorkoutReminder.mockResolvedValue({ enabled: false, hour: 17, minute: 0, fallbackWeekdays: [] });

    const result = await reconcileWorkoutReminder();

    expect(result.inferredWeekdays).toEqual([2]);
    expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(2);
    expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('stale-workout-1');
    expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('stale-workout-2');
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(mockNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  // 10. Cold startup reconciles without a permission prompt.
  test('10. a cold, first-ever call reconciles without requesting notification permission', async () => {
    setActiveNote(MONDAY_NOTE);
    Storage.loadWorkoutReminder.mockResolvedValue(ENABLED_INFERRED_WORKOUT);

    const result = await reconcileWorkoutReminder();

    expect(result.inferredWeekdays).toEqual([2]);
    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(mockNotifications.getPermissionsAsync).not.toHaveBeenCalled();
    expect(mockNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  // 5. A failed apply permits an identical retry.
  test('5. a failed apply does not poison the dedup cache; an identical retry attempts apply again', async () => {
    setActiveNote(MONDAY_NOTE);
    Storage.loadWorkoutReminder.mockResolvedValue(ENABLED_INFERRED_WORKOUT);
    mockNotifications.scheduleNotificationAsync.mockRejectedValueOnce(new Error('transient schedule failure'));

    await expect(reconcileWorkoutReminder()).rejects.toThrow('transient schedule failure');
    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);

    // Same routine, same settings — nothing about the schedule actually
    // changed. If the cache had been written before the failed apply, this
    // identical retry would be silently skipped forever.
    const result = await reconcileWorkoutReminder();

    expect(result.inferredWeekdays).toEqual([2]);
    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
  });

  // 2. Concurrent identical calls coalesce to one apply.
  test('2. coalesces concurrent identical calls for the same resolved key onto a single apply', async () => {
    // Mirrors the production race: the always-on workoutNoteHooks.js
    // subscriber and a mounted ReminderSettingsCard's own display refresh
    // both reacting to the same notifyWorkoutNotes() broadcast, both calling
    // reconcileWorkoutReminder() around the same time for the same routine.
    setActiveNote(MONDAY_NOTE);
    Storage.loadWorkoutReminder.mockResolvedValue(ENABLED_INFERRED_WORKOUT);

    const [first, second] = await Promise.all([
      reconcileWorkoutReminder(),
      reconcileWorkoutReminder(),
    ]);

    expect(first.inferredWeekdays).toEqual([2]);
    expect(second.inferredWeekdays).toEqual([2]);
    // Two concurrent callers for the identical resolved state must coalesce
    // onto one apply, not race duplicate cancel/reschedule calls against
    // each other.
    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(mockNotifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();

    // A third, later call for the same unchanged state is still a pure
    // dedup no-op — coalescing must not have left anything scheduled twice
    // or bypassed the ordinary lastReconciledKey short-circuit.
    jest.clearAllMocks();
    mockNotifications.getAllScheduledNotificationsAsync.mockResolvedValue([]);
    await reconcileWorkoutReminder();
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(mockNotifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });

  test('a rejected running apply does not leave a concurrent queued caller stuck; it retries and can succeed', async () => {
    setActiveNote(MONDAY_NOTE);
    Storage.loadWorkoutReminder.mockResolvedValue(ENABLED_INFERRED_WORKOUT);
    // Only the FIRST underlying schedule call fails. The queued caller's own
    // retry is a fresh apply attempt, not a re-observation of the same
    // rejection, so it hits the default (successful) mock implementation.
    mockNotifications.scheduleNotificationAsync.mockRejectedValueOnce(new Error('concurrent transient failure'));

    const [aResult, bResult] = await Promise.allSettled([
      reconcileWorkoutReminder(),
      reconcileWorkoutReminder(),
    ]);

    // The first (running) apply fails...
    expect(aResult.status).toBe('rejected');
    // ...but the second, queued caller is not stranded by that failure —
    // the queue clears and it retries with its own fresh apply, succeeding.
    expect(bResult.status).toBe('fulfilled');
    expect(bResult.value.inferredWeekdays).toEqual([2]);
    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);

    // The successful retry committed the key: a further later call for the
    // identical resolved state is now a pure dedup no-op.
    jest.clearAllMocks();
    mockNotifications.getAllScheduledNotificationsAsync.mockResolvedValue([]);
    await reconcileWorkoutReminder();
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  // 3. Concurrent different-key calls cannot complete out of order and
  // restore older state. Uses a deferred promise to force the FIRST apply's
  // native schedule call to hang, deterministically proving the second
  // (newer-key) call cannot start its own apply while the first is still in
  // flight — the old per-key-only guard would have let both run concurrently
  // here, and a slow older apply resolving last would have won.
  test('3. concurrent different-key calls cannot complete out of order and restore older state', async () => {
    setActiveNote(MONDAY_NOTE); // inferred [2]
    Storage.loadWorkoutReminder.mockResolvedValue(ENABLED_INFERRED_WORKOUT);

    const deferredA = createDeferred();
    mockNotifications.scheduleNotificationAsync.mockImplementationOnce(() => deferredA.promise);

    const callA = reconcileWorkoutReminder();
    await flush(); // let A reach its stuck schedule call for weekday 2

    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);

    // The routine changes to a different (newer) key while A's apply is
    // still stuck mid-flight.
    setActiveNote(MONDAY_WEDNESDAY_NOTE); // inferred [2, 4]
    const callB = reconcileWorkoutReminder();
    await flush();

    // Under the old per-key guard, a different key would not have coalesced
    // and B would already be racing its own applyWorkoutReminder call right
    // now. Under the serialized queue, B must still only be queued — no
    // second apply has started.
    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);

    // Let A's stuck schedule call finish.
    deferredA.resolve('id-a');
    await callA;

    // B's queued reconciliation only starts now, re-reading storage fresh —
    // it sees the routine that was current when it actually ran, not
    // whatever was current when it was first called.
    await callB;

    const weekdaysScheduled = mockNotifications.scheduleNotificationAsync.mock.calls.map((c) => c[0].trigger.weekday);
    expect(weekdaysScheduled[0]).toBe(2); // A's single Monday weekday, applied first
    expect(weekdaysScheduled.slice(1)).toEqual([2, 4]); // B's fresh re-application, applied after

    // Final state matches the newest routine, not the stale one A saw.
    jest.clearAllMocks();
    mockNotifications.getAllScheduledNotificationsAsync.mockResolvedValue([]);
    await reconcileWorkoutReminder();
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  // 4. Persisted state changing while an apply runs → newest state applied
  // last, even with only a single caller in flight (no second concurrent
  // call): a later, separate call must still see the change, since the
  // in-flight run only ever captures the state it read at its own start.
  test('4. persisted state changing while a solo apply is in flight is still picked up by the next call', async () => {
    setActiveNote(MONDAY_NOTE);
    Storage.loadWorkoutReminder.mockResolvedValue(ENABLED_INFERRED_WORKOUT);

    const deferredA = createDeferred();
    mockNotifications.scheduleNotificationAsync.mockImplementationOnce(() => deferredA.promise);

    const callA = reconcileWorkoutReminder();
    await flush();

    // The persisted routine changes while A's apply (for the old
    // Monday-only state) is still in flight, but nothing calls
    // reconcileWorkoutReminder() again yet.
    setActiveNote(MONDAY_WEDNESDAY_NOTE);

    deferredA.resolve('id-a');
    await callA;

    // A committed the OLD key (Monday-only) since it captured state at its
    // own start — a fresh call afterward must not treat the new state as
    // already reconciled.
    jest.clearAllMocks();
    mockNotifications.getAllScheduledNotificationsAsync.mockResolvedValue([]);
    const result = await reconcileWorkoutReminder();

    expect(result.inferredWeekdays).toEqual([2, 4]);
    const weekdays = mockNotifications.scheduleNotificationAsync.mock.calls.map((c) => c[0].trigger.weekday);
    expect(weekdays).toEqual([2, 4]);
  });

  // 6. A failed queued/superseded apply does not strand the queue.
  test('6. a failed running apply does not strand a call queued behind it', async () => {
    setActiveNote(MONDAY_NOTE);
    Storage.loadWorkoutReminder.mockResolvedValue(ENABLED_INFERRED_WORKOUT);

    const deferredA = createDeferred();
    mockNotifications.scheduleNotificationAsync.mockImplementationOnce(() => deferredA.promise);

    const callA = reconcileWorkoutReminder();
    await flush();

    setActiveNote(OTHER_ROUTINE_FRIDAY_NOTE);
    const callB = reconcileWorkoutReminder();
    await flush();

    // A's stuck schedule call fails.
    deferredA.reject(new Error('stuck apply failed'));
    await expect(callA).rejects.toThrow('stuck apply failed');

    // B — queued behind A — must still run: the queue is not stranded by
    // A's failure.
    await flush();
    const result = await callB;

    expect(result.inferredWeekdays).toEqual([6]);
    const weekdays = mockNotifications.scheduleNotificationAsync.mock.calls
      .map((c) => c[0].trigger.weekday)
      .filter((weekday) => weekday != null);
    expect(weekdays).toContain(6);
  });
});

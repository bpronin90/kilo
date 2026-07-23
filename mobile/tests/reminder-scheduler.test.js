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
} = require('../lib/reminderScheduler');

function setActiveNote(note) {
  Storage.loadWorkoutNotes.mockResolvedValue(note ? [note] : []);
  Storage.loadCurrentWorkoutId.mockResolvedValue(note?.id ?? null);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNotifications.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
  mockNotifications.requestPermissionsAsync.mockResolvedValue({ granted: false });
  mockNotifications.getAllScheduledNotificationsAsync.mockResolvedValue([]);
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

  test('reschedules an enabled inferred-weekday reminder after the routine text changes', async () => {
    setActiveNote(MONDAY_NOTE);
    Storage.loadWorkoutReminder.mockResolvedValue(ENABLED_INFERRED_WORKOUT);

    const first = await reconcileWorkoutReminder();
    expect(first.inferredWeekdays).toEqual([2]);
    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();
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

    setActiveNote(OTHER_ROUTINE_FRIDAY_NOTE);
    Storage.loadWorkoutReminder.mockResolvedValue(ENABLED_INFERRED_WORKOUT);
    const result = await reconcileWorkoutReminder();

    expect(result.inferredWeekdays).toEqual([6]);
    const weekdays = mockNotifications.scheduleNotificationAsync.mock.calls.map((c) => c[0].trigger.weekday);
    expect(weekdays).toEqual([6]);
    expect(mockNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  test('keeps explicit fallback weekdays authoritative when the routine has no inferred days', async () => {
    const FALLBACK_WORKOUT = { enabled: true, hour: 17, minute: 0, fallbackWeekdays: [2] };
    setActiveNote(PUSH_DAY_NOTE);
    Storage.loadWorkoutReminder.mockResolvedValue(FALLBACK_WORKOUT);

    const result = await reconcileWorkoutReminder();

    expect(result.inferredWeekdays).toEqual([]);
    const weekdays = mockNotifications.scheduleNotificationAsync.mock.calls.map((c) => c[0].trigger.weekday);
    expect(weekdays).toEqual([2]);
  });

  test('is idempotent: a repeated call with the same routine reschedules once, not again', async () => {
    setActiveNote(MONDAY_NOTE);
    Storage.loadWorkoutReminder.mockResolvedValue(ENABLED_INFERRED_WORKOUT);

    await reconcileWorkoutReminder();
    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    jest.clearAllMocks();

    await reconcileWorkoutReminder();
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(mockNotifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
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

  test('reconciling a disabled workout reminder still cancels a stale persisted notification (review finding #2)', async () => {
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

  test('a failed apply does not poison the dedup cache; an identical retry attempts apply again (review finding #1)', async () => {
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
});

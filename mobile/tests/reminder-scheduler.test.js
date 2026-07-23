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

const {
  requestReminderPermission,
  cancelReminders,
  applyWeighInReminder,
  applyWorkoutReminder,
  installForegroundHandler,
} = require('../lib/reminderScheduler');

beforeEach(() => {
  jest.clearAllMocks();
  mockNotifications.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
  mockNotifications.requestPermissionsAsync.mockResolvedValue({ granted: false });
  mockNotifications.getAllScheduledNotificationsAsync.mockResolvedValue([]);
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

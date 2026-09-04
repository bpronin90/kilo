const mockNotifications = {
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => {}),
  getPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  scheduleNotificationAsync: jest.fn(async () => 'native-id'),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  AndroidImportance: { DEFAULT: 3 },
};
jest.mock('expo-notifications', () => mockNotifications);

let mockStore = null;
jest.mock('../storage/entries', () => ({
  loadRestTimerState: jest.fn(() => Promise.resolve(mockStore)),
  saveRestTimerState: jest.fn((record) => {
    mockStore = record;
    return Promise.resolve();
  }),
}));

const Storage = require('../storage/entries');
const { startRestTimer, cancelRestTimer, reconcileRestTimer } = require('../lib/restTimerScheduler');
const { REST_TIMER_KIND } = require('../lib/reminderScheduler');

beforeEach(() => {
  jest.clearAllMocks();
  mockStore = null;
  mockNotifications.getPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
  mockNotifications.requestPermissionsAsync.mockResolvedValue({ granted: true });
  mockNotifications.getAllScheduledNotificationsAsync.mockResolvedValue([]);
});

describe('startRestTimer', () => {
  test('persists a record and schedules exactly one wall-clock-date-triggered notification', async () => {
    const record = await startRestTimer({ durationSec: 90, exerciseLabel: 'Bench' });
    expect(record.durationSec).toBe(90);
    expect(Storage.saveRestTimerState).toHaveBeenCalledWith(expect.objectContaining({ timerId: record.timerId }));
    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const [call] = mockNotifications.scheduleNotificationAsync.mock.calls;
    expect(call[0].content.data).toEqual({ kind: REST_TIMER_KIND, timerId: record.timerId });
    expect(call[0].trigger.type).toBe('date');
  });

  test('starting a new timer cancels the previous one (replace, never stack)', async () => {
    mockNotifications.getAllScheduledNotificationsAsync.mockResolvedValue([
      { identifier: 'old-id', content: { data: { kind: REST_TIMER_KIND } } },
    ]);
    await startRestTimer({ durationSec: 60 });
    expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('old-id');
  });

  test('denied permission still returns a record but does not schedule a notification', async () => {
    mockNotifications.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
    const record = await startRestTimer({ durationSec: 60 });
    expect(record).toBeTruthy();
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  // #950 review (P2): notificationScheduled must reflect the ACTUAL
  // permission/scheduling outcome, not merely platform support, so
  // RestTimerBanner's "Background alert unavailable" warning is accurate.
  test('denied permission is reflected as notificationScheduled: false on the returned/persisted record', async () => {
    mockNotifications.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
    const record = await startRestTimer({ durationSec: 60 });
    expect(record.notificationScheduled).toBe(false);
    expect(mockStore.notificationScheduled).toBe(false);
  });

  test('granted permission and a successful schedule call set notificationScheduled: true', async () => {
    const record = await startRestTimer({ durationSec: 60 });
    expect(record.notificationScheduled).toBe(true);
    expect(mockStore.notificationScheduled).toBe(true);
  });

  test('a rejected native schedule call resolves with the persisted record (notificationScheduled: false) rather than rejecting', async () => {
    // #577 review (Codex, post-freeze): startRestTimer must never reject —
    // the record is already durably persisted before scheduling is
    // attempted, and useRestTimer.js's start() only calls setRecord(r)
    // after awaiting this promise, so a rejection here previously hid an
    // already-persisted, already-running timer from the UI entirely.
    mockNotifications.scheduleNotificationAsync.mockRejectedValueOnce(new Error('native schedule failed'));
    const record = await startRestTimer({ durationSec: 60 });
    expect(record).toBeTruthy();
    expect(record.notificationScheduled).toBe(false);
    expect(mockStore).toBeTruthy();
    expect(mockStore.notificationScheduled).toBe(false);
  });

  test('a rejected cancelReminders or requestReminderPermission call also resolves with the persisted record rather than rejecting', async () => {
    mockNotifications.getAllScheduledNotificationsAsync.mockRejectedValueOnce(new Error('cancel read failed'));
    const record = await startRestTimer({ durationSec: 60 });
    expect(record).toBeTruthy();
    expect(record.notificationScheduled).toBe(false);
  });
});

describe('cancelRestTimer', () => {
  test('clears persisted state and any scheduled rest-timer notification', async () => {
    await startRestTimer({ durationSec: 60 });
    await cancelRestTimer();
    expect(mockStore).toBeNull();
  });
});

describe('reconcileRestTimer', () => {
  test('a still-running timer is returned unchanged, not cleared', async () => {
    const started = await startRestTimer({ durationSec: 6000 }); // far future
    const { record, justElapsed } = await reconcileRestTimer();
    expect(record.timerId).toBe(started.timerId);
    expect(justElapsed).toBe(false);
  });

  test('a record elapsed long before this launch (e.g. an ancient timestamp) is treated as invalid/stale and cleared', async () => {
    mockStore = { version: 1, timerId: 't1', startedAtMs: 0, durationSec: 1, endsAtMs: 1000, exerciseLabel: null, notificationId: null };
    const { record, justElapsed } = await reconcileRestTimer({ wasActiveWhenElapsed: false });
    expect(record).toBeNull(); // implausibly far in the past — normalizeRestTimerRecord rejects it outright
    expect(justElapsed).toBe(false);
    expect(mockStore).toBeNull();
  });

  test('an elapsed timer found at cold start (recently, but process was away) clears state without replaying an in-app banner', async () => {
    const nowMs = Date.now();
    mockStore = { version: 1, timerId: 't1', startedAtMs: nowMs - 2000, durationSec: 1, endsAtMs: nowMs - 1000, exerciseLabel: null, notificationId: null };
    const { record, justElapsed } = await reconcileRestTimer({ wasActiveWhenElapsed: false });
    expect(record).toBeTruthy();
    expect(justElapsed).toBe(false); // OS notification was the background owner — no in-app replay
    expect(mockStore).toBeNull();
  });

  test('an elapsed timer suppressed while active surfaces exactly one in-app banner', async () => {
    const nowMs = Date.now();
    mockStore = { version: 1, timerId: 't1', startedAtMs: nowMs - 2000, durationSec: 1, endsAtMs: nowMs - 1000, exerciseLabel: null, notificationId: null };
    const { justElapsed } = await reconcileRestTimer({ wasActiveWhenElapsed: true });
    expect(justElapsed).toBe(true);
    expect(mockStore).toBeNull();
  });

  test('a malformed/invalid persisted record is cleared and treated as no timer', async () => {
    mockStore = { garbage: true };
    const { record, justElapsed } = await reconcileRestTimer();
    expect(record).toBeNull();
    expect(justElapsed).toBe(false);
    expect(mockStore).toBeNull();
  });
});

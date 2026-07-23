// Proves the P2 finding on PR #649 is fixed (#590): reconciling the workout
// reminder against the active routine must not depend on the Settings screen
// (and therefore ReminderSettingsCard) being mounted. This file deliberately
// never imports ReminderSettingsCard or any screen component — it exercises
// only the always-on broadcast layer (hooks/entries/workoutNoteHooks.js,
// registered once at module load) plus the app-startup call, to demonstrate
// reconciliation fires for routine edits/switches made from any screen and
// after an app restart.

const mockNotifications = {
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => {}),
  getPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
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
  loadWorkoutNoteItem: jest.fn(),
  saveWorkoutNoteItem: jest.fn(async () => {}),
  deleteWorkoutNoteItem: jest.fn(async () => {}),
  clearCurrentWorkoutId: jest.fn(async () => {}),
  setCurrentWorkoutNote: jest.fn(async () => {}),
  getStorageMode: jest.fn(() => 'local'),
  getStorageAdapter: jest.fn(() => ({})),
}));

const Storage = require('../storage/entries');
const { __resetWorkoutReminderReconciliationForTests } = require('../lib/reminderScheduler');
// Importing workoutNoteHooks registers its permanent, module-level
// reconciliation subscriber as a side effect of module load — before any
// component (Settings or otherwise) ever renders.
const { notifyWorkoutNotes } = require('../hooks/entries/workoutNoteHooks');

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
const ENABLED_INFERRED_WORKOUT = { enabled: true, hour: 17, minute: 0, fallbackWeekdays: [] };

function setActiveNote(note) {
  Storage.loadWorkoutNotes.mockResolvedValue(note ? [note] : []);
  Storage.loadCurrentWorkoutId.mockResolvedValue(note?.id ?? null);
}

// The reconciliation chain triggered by notifyWorkoutNotes() is fire-and-
// forget (the broadcast itself is synchronous) and several awaits deep
// (Storage reads, then cancelReminders, then a sequential per-weekday
// schedule loop), so draining a fixed number of microtask ticks is fragile.
// setImmediate only runs once Node's microtask queue is fully drained,
// which reliably lets the whole chain settle first.
async function flushMicrotasks() {
  await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNotifications.getAllScheduledNotificationsAsync.mockResolvedValue([]);
  __resetWorkoutReminderReconciliationForTests();
  Storage.loadWorkoutReminder.mockResolvedValue(ENABLED_INFERRED_WORKOUT);
  setActiveNote(MONDAY_NOTE);
});

describe('workout reminder reconciliation without the Settings screen mounted (#590)', () => {
  test('a routine text edit reschedules via the always-on broadcast alone', async () => {
    // No React tree exists anywhere in this test — nothing resembling
    // ReminderSettingsCard/SettingsScreen has been imported or rendered.
    setActiveNote(MONDAY_WEDNESDAY_NOTE);
    notifyWorkoutNotes();
    await flushMicrotasks();

    const weekdays = mockNotifications.scheduleNotificationAsync.mock.calls.map((c) => c[0].trigger.weekday);
    expect(weekdays).toEqual([2, 4]);
    expect(mockNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  test('an active-routine switch (identity change) reschedules via the always-on broadcast alone', async () => {
    setActiveNote(OTHER_ROUTINE_FRIDAY_NOTE);
    notifyWorkoutNotes();
    await flushMicrotasks();

    const weekdays = mockNotifications.scheduleNotificationAsync.mock.calls.map((c) => c[0].trigger.weekday);
    expect(weekdays).toEqual([6]);
  });

  test('a disabled workout reminder stays unscheduled even when the routine changes', async () => {
    Storage.loadWorkoutReminder.mockResolvedValue({ enabled: false, hour: 17, minute: 0, fallbackWeekdays: [] });
    setActiveNote(MONDAY_WEDNESDAY_NOTE);
    notifyWorkoutNotes();
    await flushMicrotasks();

    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(mockNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });
});

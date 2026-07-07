// Pure scheduling-decision logic for the optional local reminders (issue #440).
// No expo-notifications imports here: everything in this module is plain data
// in / data out so it can be unit-tested without native modules. The side-effect
// layer that talks to expo-notifications lives in lib/reminderScheduler.js.

// Weekday numbering follows expo-notifications weekly calendar triggers:
// 1 = Sunday … 7 = Saturday.
export const WEEKDAYS = [
  { value: 1, short: 'S', label: 'Sunday' },
  { value: 2, short: 'M', label: 'Monday' },
  { value: 3, short: 'T', label: 'Tuesday' },
  { value: 4, short: 'W', label: 'Wednesday' },
  { value: 5, short: 'T', label: 'Thursday' },
  { value: 6, short: 'F', label: 'Friday' },
  { value: 7, short: 'S', label: 'Saturday' },
];

const DAY_NAME_TO_WEEKDAY = {
  sunday: 1,
  monday: 2,
  tuesday: 3,
  wednesday: 4,
  thursday: 5,
  friday: 6,
  saturday: 7,
};

// Tags stored in notification content.data so scheduled requests can be
// cancelled per-toggle. Identification only — no analytics payload.
export const REMINDER_KIND = {
  WEIGH_IN: 'weigh-in-reminder',
  WORKOUT: 'workout-reminder',
};

export const DEFAULT_WEIGH_IN_REMINDER = Object.freeze({
  enabled: false,
  hour: 8,
  minute: 0,
});

export const DEFAULT_WORKOUT_REMINDER = Object.freeze({
  enabled: false,
  hour: 17,
  minute: 0,
  fallbackWeekdays: Object.freeze([]),
});

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}

export function sanitizeWeekdays(list) {
  if (!Array.isArray(list)) return [];
  const unique = new Set();
  for (const item of list) {
    const n = Number(item);
    if (Number.isInteger(n) && n >= 1 && n <= 7) unique.add(n);
  }
  return [...unique].sort((a, b) => a - b);
}

export function normalizeWeighInReminder(raw) {
  const base = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: base.enabled === true,
    hour: clampInt(base.hour, 0, 23, DEFAULT_WEIGH_IN_REMINDER.hour),
    minute: clampInt(base.minute, 0, 59, DEFAULT_WEIGH_IN_REMINDER.minute),
  };
}

export function normalizeWorkoutReminder(raw) {
  const base = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: base.enabled === true,
    hour: clampInt(base.hour, 0, 23, DEFAULT_WORKOUT_REMINDER.hour),
    minute: clampInt(base.minute, 0, 59, DEFAULT_WORKOUT_REMINDER.minute),
    fallbackWeekdays: sanitizeWeekdays(base.fallbackWeekdays),
  };
}

// Infer the workout weekdays implied by a parsed routine note's day sections
// (parseWorkoutNote sections; each section's `heading` is the day line, e.g.
// "Monday" or "Monday - Push"). Returns sorted unique weekday numbers (1–7).
// Returns [] when inference is ambiguous: no sections, or no heading that
// starts with a recognizable weekday name.
export function inferWorkoutWeekdays(sections) {
  if (!Array.isArray(sections)) return [];
  const found = new Set();
  for (const section of sections) {
    const heading = typeof section?.heading === 'string' ? section.heading : '';
    const match = heading.trim().toLowerCase().match(/^(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/);
    if (match) found.add(DAY_NAME_TO_WEEKDAY[match[1]]);
  }
  return [...found].sort((a, b) => a - b);
}

// Decide which weekdays the workout nudge fires on: days inferred from the
// active routine note win; when inference is ambiguous (empty), fall back to
// the user-selected weekdays.
export function resolveWorkoutWeekdays(inferredWeekdays, fallbackWeekdays) {
  const inferred = sanitizeWeekdays(inferredWeekdays);
  if (inferred.length > 0) return inferred;
  return sanitizeWeekdays(fallbackWeekdays);
}

// Trigger `type` strings match expo-notifications SchedulableTriggerInputTypes
// ('daily' / 'weekly') so these plain objects can be passed straight through.
export function buildWeighInNotificationRequests(settings) {
  const { enabled, hour, minute } = normalizeWeighInReminder(settings);
  if (!enabled) return [];
  return [
    {
      content: {
        title: 'Weigh-in reminder',
        body: 'Time to log today’s weight in Kilo.',
        data: { kind: REMINDER_KIND.WEIGH_IN },
      },
      trigger: { type: 'daily', hour, minute },
    },
  ];
}

export function buildWorkoutNotificationRequests(settings, weekdays) {
  const { enabled, hour, minute } = normalizeWorkoutReminder(settings);
  if (!enabled) return [];
  return sanitizeWeekdays(weekdays).map((weekday) => ({
    content: {
      title: 'Workout day',
      body: 'Today is a training day — open Kilo to log your session.',
      data: { kind: REMINDER_KIND.WORKOUT },
    },
    trigger: { type: 'weekly', weekday, hour, minute },
  }));
}

// Given the list returned by getAllScheduledNotificationsAsync, pick the
// identifiers belonging to one reminder kind so disabling a toggle cancels
// only its own notifications.
export function selectReminderIdsToCancel(scheduled, kind) {
  if (!Array.isArray(scheduled)) return [];
  return scheduled
    .filter((item) => item?.content?.data?.kind === kind)
    .map((item) => item.identifier)
    .filter((id) => id != null);
}

export function formatReminderTime(hour, minute) {
  const h = clampInt(hour, 0, 23, 0);
  const m = clampInt(minute, 0, 59, 0);
  const period = h < 12 ? 'AM' : 'PM';
  const displayHour = h % 12 === 0 ? 12 : h % 12;
  return `${displayHour}:${String(m).padStart(2, '0')} ${period}`;
}

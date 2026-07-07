import {
  REMINDER_KIND,
  WEEKDAYS,
  normalizeWeighInReminder,
  normalizeWorkoutReminder,
  sanitizeWeekdays,
  inferWorkoutWeekdays,
  resolveWorkoutWeekdays,
  buildWeighInNotificationRequests,
  buildWorkoutNotificationRequests,
  selectReminderIdsToCancel,
  formatReminderTime,
} from '../lib/reminders';
import { parseWorkoutNote } from '../lib/parser';
import { loadWeighInReminder, saveWeighInReminder, loadWorkoutReminder, saveWorkoutReminder } from '../storage/entries';

describe('reminder defaults and normalization', () => {
  test('both reminders default OFF', () => {
    expect(normalizeWeighInReminder(null).enabled).toBe(false);
    expect(normalizeWorkoutReminder(undefined).enabled).toBe(false);
  });

  test('normalizeWeighInReminder clamps bad time values to defaults', () => {
    expect(normalizeWeighInReminder({ enabled: true, hour: 99, minute: -5 })).toEqual({
      enabled: true,
      hour: 8,
      minute: 0,
    });
    expect(normalizeWeighInReminder({ enabled: 'yes', hour: 6, minute: 30 })).toEqual({
      enabled: false,
      hour: 6,
      minute: 30,
    });
  });

  test('normalizeWorkoutReminder sanitizes fallback weekdays', () => {
    const result = normalizeWorkoutReminder({ enabled: true, fallbackWeekdays: [7, 2, 2, 0, 9, 'x'] });
    expect(result.fallbackWeekdays).toEqual([2, 7]);
    expect(result.hour).toBe(17);
    expect(result.minute).toBe(0);
  });

  test('sanitizeWeekdays handles non-arrays and dedupes/sorts', () => {
    expect(sanitizeWeekdays(null)).toEqual([]);
    expect(sanitizeWeekdays([5, 1, 5, 3])).toEqual([1, 3, 5]);
  });

  test('WEEKDAYS covers Sunday(1) through Saturday(7)', () => {
    expect(WEEKDAYS.map((d) => d.value)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('inferWorkoutWeekdays', () => {
  test('infers weekdays from routine day-section headings', () => {
    const note = [
      'Monday',
      '-Bench press',
      '185 5x5',
      '',
      'Wednesday - Pull',
      '-Deadlift',
      '315 3x5',
      '',
      'Friday',
      '-Squat',
      '225 5x5',
    ].join('\n');
    const { sections } = parseWorkoutNote(note);
    expect(inferWorkoutWeekdays(sections)).toEqual([2, 4, 6]);
  });

  test('dedupes days repeated across week A and week B', () => {
    const note = [
      'Monday',
      '-Bench press',
      '185 5x5',
      '---',
      'Monday',
      '-Overhead press',
      '95 5x5',
      'Thursday',
      '-Squat',
      '225 5x5',
    ].join('\n');
    const { sections } = parseWorkoutNote(note);
    expect(inferWorkoutWeekdays(sections)).toEqual([2, 5]);
  });

  test('returns [] (ambiguous) when no headings name a weekday', () => {
    const note = ['Push day', '-Bench press', '185 5x5'].join('\n');
    const { sections } = parseWorkoutNote(note);
    expect(inferWorkoutWeekdays(sections)).toEqual([]);
  });

  test('returns [] for empty or invalid input', () => {
    expect(inferWorkoutWeekdays([])).toEqual([]);
    expect(inferWorkoutWeekdays(null)).toEqual([]);
    expect(inferWorkoutWeekdays([{ heading: null }])).toEqual([]);
  });
});

describe('resolveWorkoutWeekdays', () => {
  test('inferred days win over the fallback selection', () => {
    expect(resolveWorkoutWeekdays([2, 4], [1, 7])).toEqual([2, 4]);
  });

  test('falls back to user-selected weekdays when inference is ambiguous', () => {
    expect(resolveWorkoutWeekdays([], [7, 1])).toEqual([1, 7]);
  });

  test('returns [] when both are empty', () => {
    expect(resolveWorkoutWeekdays([], [])).toEqual([]);
  });
});

describe('notification request builders', () => {
  test('weigh-in builder returns one daily trigger at the chosen time', () => {
    const requests = buildWeighInNotificationRequests({ enabled: true, hour: 7, minute: 15 });
    expect(requests).toHaveLength(1);
    expect(requests[0].trigger).toEqual({ type: 'daily', hour: 7, minute: 15 });
    expect(requests[0].content.data).toEqual({ kind: REMINDER_KIND.WEIGH_IN });
  });

  test('weigh-in builder returns nothing when disabled (cancel-on-disable)', () => {
    expect(buildWeighInNotificationRequests({ enabled: false, hour: 7, minute: 15 })).toEqual([]);
  });

  test('workout builder returns one weekly trigger per resolved weekday', () => {
    const requests = buildWorkoutNotificationRequests({ enabled: true, hour: 18, minute: 30 }, [2, 4, 6]);
    expect(requests.map((r) => r.trigger)).toEqual([
      { type: 'weekly', weekday: 2, hour: 18, minute: 30 },
      { type: 'weekly', weekday: 4, hour: 18, minute: 30 },
      { type: 'weekly', weekday: 6, hour: 18, minute: 30 },
    ]);
    expect(requests.every((r) => r.content.data.kind === REMINDER_KIND.WORKOUT)).toBe(true);
  });

  test('workout builder returns nothing when disabled or no weekdays resolve', () => {
    expect(buildWorkoutNotificationRequests({ enabled: false, hour: 18, minute: 0 }, [2])).toEqual([]);
    expect(buildWorkoutNotificationRequests({ enabled: true, hour: 18, minute: 0 }, [])).toEqual([]);
  });
});

describe('selectReminderIdsToCancel', () => {
  const scheduled = [
    { identifier: 'a', content: { data: { kind: REMINDER_KIND.WEIGH_IN } } },
    { identifier: 'b', content: { data: { kind: REMINDER_KIND.WORKOUT } } },
    { identifier: 'c', content: { data: { kind: REMINDER_KIND.WORKOUT } } },
    { identifier: 'd', content: { data: {} } },
    { identifier: 'e', content: null },
  ];

  test('selects only the ids belonging to the given reminder kind', () => {
    expect(selectReminderIdsToCancel(scheduled, REMINDER_KIND.WEIGH_IN)).toEqual(['a']);
    expect(selectReminderIdsToCancel(scheduled, REMINDER_KIND.WORKOUT)).toEqual(['b', 'c']);
  });

  test('handles invalid input', () => {
    expect(selectReminderIdsToCancel(null, REMINDER_KIND.WEIGH_IN)).toEqual([]);
    expect(selectReminderIdsToCancel([], REMINDER_KIND.WEIGH_IN)).toEqual([]);
  });
});

describe('formatReminderTime', () => {
  test('formats 12-hour times with AM/PM', () => {
    expect(formatReminderTime(0, 0)).toBe('12:00 AM');
    expect(formatReminderTime(8, 5)).toBe('8:05 AM');
    expect(formatReminderTime(12, 0)).toBe('12:00 PM');
    expect(formatReminderTime(17, 30)).toBe('5:30 PM');
  });
});

describe('reminder settings persistence', () => {
  test('loads default-OFF settings when nothing is stored', async () => {
    expect(await loadWeighInReminder()).toEqual({ enabled: false, hour: 8, minute: 0 });
    expect(await loadWorkoutReminder()).toEqual({ enabled: false, hour: 17, minute: 0, fallbackWeekdays: [] });
  });

  test('round-trips saved settings so toggles survive restart', async () => {
    await saveWeighInReminder({ enabled: true, hour: 6, minute: 45 });
    expect(await loadWeighInReminder()).toEqual({ enabled: true, hour: 6, minute: 45 });

    await saveWorkoutReminder({ enabled: true, hour: 19, minute: 0, fallbackWeekdays: [6, 2] });
    expect(await loadWorkoutReminder()).toEqual({ enabled: true, hour: 19, minute: 0, fallbackWeekdays: [2, 6] });
  });
});

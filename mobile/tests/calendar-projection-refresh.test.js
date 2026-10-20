import React from 'react';
import render from 'react-test-renderer';
import { AppState } from 'react-native';
import { useLocalCalendarDay, localDayToDate } from '../hooks/useLocalCalendarDay';
import { deriveWeightGoalAnalytics } from '../lib/data';
import { deriveHomeDashboardData } from '../screens/home/homeDashboardData';

jest.mock('react-native-svg', () => ({}), { virtual: true });

let days;
let renders;
function Probe() {
  const d = useLocalCalendarDay();
  renders.push(d);
  days.push(d);
  return null;
}

describe('useLocalCalendarDay (#1484)', () => {
  let listeners;
  let removed;
  beforeEach(() => {
    jest.useFakeTimers();
    days = [];
    renders = [];
    listeners = [];
    removed = 0;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((type, fn) => {
      listeners.push(fn);
      return { remove: () => { removed += 1; } };
    });
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('advances across local midnight without remount and cleans up', () => {
    jest.setSystemTime(new Date(2025, 5, 10, 23, 59, 0));
    let tree;
    render.act(() => { tree = render.create(<Probe />); });
    expect(days[days.length - 1]).toBe('2025-06-10');
    render.act(() => { jest.advanceTimersByTime(70 * 1000); });
    expect(days[days.length - 1]).toBe('2025-06-11');
    expect(listeners).toHaveLength(1);
    const before = renders.length;
    render.act(() => { jest.advanceTimersByTime(60 * 1000); });
    expect(renders.length).toBe(before); // no render loop on same-day ticks
    render.act(() => { tree.unmount(); });
    expect(removed).toBe(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('re-syncs on foreground after the day changed while backgrounded', () => {
    jest.setSystemTime(new Date(2025, 5, 10, 22, 0, 0));
    render.act(() => { render.create(<Probe />); });
    expect(days[days.length - 1]).toBe('2025-06-10');
    // Simulate suspended timers: clock jumps without timers firing.
    jest.setSystemTime(new Date(2025, 5, 12, 8, 0, 0));
    render.act(() => { listeners[0]('active'); });
    expect(days[days.length - 1]).toBe('2025-06-12');
  });

  it('uses local-calendar arithmetic across DST transitions', () => {
    // US spring-forward 2025-03-09: the 23-hour day must still roll to 03-10.
    jest.setSystemTime(new Date(2025, 2, 9, 23, 30, 0));
    render.act(() => { render.create(<Probe />); });
    expect(days[days.length - 1]).toBe('2025-03-09');
    render.act(() => { jest.advanceTimersByTime(31 * 60 * 1000); });
    expect(days[days.length - 1]).toBe('2025-03-10');
    // fall-back 2025-11-02 (25-hour day)
    jest.setSystemTime(new Date(2025, 10, 2, 23, 30, 0));
    render.act(() => { listeners[0]('active'); });
    expect(days[days.length - 1]).toBe('2025-11-02');
    render.act(() => { jest.advanceTimersByTime(31 * 60 * 1000); });
    expect(days[days.length - 1]).toBe('2025-11-03');
  });

  it('a timer armed before a DST transition night still rolls the day correctly', () => {
    // Armed 23:30 on 2025-03-08 (evening before spring-forward night); the next
    // midnight is 24.5h away on the wall clock. Ticking through the offset
    // change must neither fire early nor skip a day.
    jest.setSystemTime(new Date(2025, 2, 8, 23, 30, 0));
    render.act(() => { render.create(<Probe />); });
    expect(days[days.length - 1]).toBe('2025-03-08');
    render.act(() => { jest.advanceTimersByTime(31 * 60 * 1000); });
    expect(days[days.length - 1]).toBe('2025-03-09');
    // Re-armed at 2025-03-09 00:00:05 local; the following midnight spans the
    // offset change itself (23h day) and lands on 03-10.
    render.act(() => { jest.advanceTimersByTime(22 * 3600 * 1000); });
    expect(days[days.length - 1]).toBe('2025-03-09');
    render.act(() => { jest.advanceTimersByTime(3600 * 1000 + 10 * 1000); });
    expect(days[days.length - 1]).toBe('2025-03-10');
  });

  it('localDayToDate yields local midnight', () => {
    const d = localDayToDate('2025-03-09');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2025, 2, 9, 0]);
  });
});

describe('projections use the supplied reference day', () => {
  const entries = [
    { id: 'b', date: '2025-06-10', weight_value: 195 },
    { id: 'a', date: '2025-06-01', weight_value: 200 },
  ];
  const goal = { target_weight: 180, target_date: '2025-09-01', start_weight: 200 };

  it('rolling windows and goal status move with the reference day, entries unchanged', () => {
    const d1 = deriveWeightGoalAnalytics(entries, goal, {}, new Date(2025, 5, 10));
    const d2 = deriveWeightGoalAnalytics(entries, goal, {}, new Date(2025, 6, 20));
    expect(d2.goalInfo.weeks_remaining).toBeLessThan(d1.goalInfo.weeks_remaining);
    expect(d1.trendSummary.avg7).toBe(195);
    expect(d2.trendSummary.avg7).toBeNull();
    expect(d2.trendSummary.avg30).toBeNull();
  });

  it('Home dashboard derivation takes the reference day', () => {
    const base = { weightEntries: entries, workoutNote: null, weightGoal: goal, allSections: [], noteSectionsList: [], trackedLifts: [], trackedLiftActivations: [], deloadHistory: [], recoveryBlocks: [] };
    const a = deriveHomeDashboardData({ ...base, referenceDate: new Date(2025, 5, 10) });
    const b = deriveHomeDashboardData({ ...base, referenceDate: new Date(2025, 6, 20) });
    expect(JSON.stringify(a.goalInfo ?? a)).not.toBe(JSON.stringify(b.goalInfo ?? b));
  });
});

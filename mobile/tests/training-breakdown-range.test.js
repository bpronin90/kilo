import { deriveTrainingBreakdown, deriveTrainingBreakdownForRange } from '../lib/data/trainingBreakdown';
import { noteLocalDayOrdinal, selectRangePopulation } from '../lib/data/trainingBreakdownRange';
import { deriveParsedSections } from '../screens/analytics/analyticsDerivations';

const note = (id, date, raw_text, extra = {}) => ({ id, title: id, date, raw_text, ...extra });
const bench = (sets) => `Monday\n-Barbell Bench Press: 3x5\n135 ${Array(sets).fill(5).join(',')}`;
const parsed = (notes, excluded = null) => deriveParsedSections(notes, notes[0], excluded);
const sets = (notes, range, now, excluded) => deriveTrainingBreakdownForRange(parsed(notes, excluded), range, { now }).totals.completedSets;
// Local noon on 2026-10-22, built inside each test so it uses the test TZ.
let NOON;
beforeEach(() => { NOON = new Date(2026, 9, 22, 12, 0, 0); });

// Jest's sandboxed process.env does not reset the libc timezone, so the calendar
// suite runs in a child Jest process started with TZ=America/New_York. The child
// is the run that executes these assertions; the parent only checks it passed.
const IN_TZ_CHILD = process.env.KILO_RANGE_TZ_CHILD === '1';
const describeInTz = IN_TZ_CHILD ? describe : describe.skip;

if (!IN_TZ_CHILD) {
  test('calendar semantics pass in a non-UTC timezone (child run)', () => {
    const { spawnSync } = require('child_process');
    const run = spawnSync(process.execPath, [require.resolve('jest/bin/jest'), '--runInBand', 'tests/training-breakdown-range.test.js'], {
      cwd: require('path').resolve(__dirname, '..'),
      env: { ...process.env, TZ: 'America/New_York', KILO_RANGE_TZ_CHILD: '1' },
      encoding: 'utf8',
      timeout: 120000,
    });
    if (run.status !== 0) throw new Error(`${run.stdout}\n${run.stderr}`);
    expect(run.stderr).toMatch(/Tests:\s+\d+ passed/);
  }, 130000);
}

describeInTz('range calendar semantics (#1589)', () => {
  test('timezone is non-UTC for these tests', () => {
    expect(new Date(2026, 9, 22).getTimezoneOffset()).not.toBe(0);
  });

  test('date-only values are local calendar dates, not UTC-shifted', () => {
    expect(noteLocalDayOrdinal('2026-10-22') - noteLocalDayOrdinal('2026-10-21')).toBe(1);
    // Just after local midnight on the 22nd is still the 22nd even though UTC is 04:00.
    const notes = [note('a', '2026-10-22', bench(1))];
    expect(sets(notes, '30D', new Date(2026, 9, 22, 0, 0, 1))).toBe(1);
    expect(sets(notes, '30D', new Date(2026, 9, 21, 23, 59, 59))).toBe(0); // future then
  });

  test.each([['30D', 30], ['90D', 90]])('%s covers today through today-(N-1) inclusive', (range, n) => {
    const day = (k) => { const d = new Date(2026, 9, 22 - k); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const notes = [
      note('today', day(0), bench(1)),
      note('n-1', day(n - 1), bench(2)),
      note('n', day(n), bench(4)),
      note('n+1', day(n + 1), bench(8)),
      note('future', day(-1), bench(16)),
    ];
    expect(sets(notes, range, NOON)).toBe(3);
    expect(sets(notes, 'All', NOON)).toBe(31);
  });

  test('calendar boundaries cross months/DST without elapsed-hour math', () => {
    // 2026-11-01 is a DST fall-back day in New York (25 hours).
    const notes = [note('a', '2026-10-03', bench(1)), note('b', '2026-10-02', bench(2))];
    expect(sets(notes, '30D', new Date(2026, 10, 1, 23, 30))).toBe(1);
  });

  test('injected now on opposite sides of local midnight re-derives membership', () => {
    const notes = [note('old', '2026-09-23', bench(2)), note('new', '2026-10-22', bench(3))];
    expect(sets(notes, '30D', new Date(2026, 9, 22, 23, 59, 59))).toBe(5);
    expect(sets(notes, '30D', new Date(2026, 9, 23, 0, 0, 1))).toBe(3);
  });

  test('missing and unparseable dates appear only in All', () => {
    const notes = [note('a', undefined, bench(1)), note('b', 'yesterday', bench(2)), note('c', '2026-02-30', bench(4)), note('d', '2026-10-20', bench(8))];
    expect(sets(notes, '30D', NOON)).toBe(8);
    expect(sets(notes, 'All', NOON)).toBe(15);
  });

  test('unknown range is rejected', () => {
    expect(() => deriveTrainingBreakdownForRange(parsed([]), '7D', { now: NOON })).toThrow();
  });
});

describe('population boundary (#1589)', () => {
  test('All projects exactly to the legacy breakdown', () => {
    const notes = [note('a', '2026-10-20', bench(3)), note('b', undefined, 'Monday\n-Pull-Up: 3x8\n8,8\n-Plank: 3x30s\n30')];
    const ps = parsed(notes);
    const { muscles: { regions, ...muscles }, movement: { comparisons, ...movement }, ...rest } = deriveTrainingBreakdownForRange(ps, 'All', { now: NOON });
    expect({ ...rest, muscles, movement }).toEqual(deriveTrainingBreakdown(ps));
    expect(regions).toHaveLength(6);
    expect(comparisons).toHaveLength(2);
  });

  test('All keeps the legacy allSections fallback; bounded ranges do not fall back', () => {
    const { allSections } = parsed([note('a', '2026-10-20', bench(2))]);
    expect(deriveTrainingBreakdownForRange({ allSections }, 'All', { now: NOON }).totals.completedSets).toBe(2);
    expect(deriveTrainingBreakdownForRange({ allSections }, '30D', { now: NOON })).toBeNull();
    const ps = parsed([note('a', '2026-10-20', bench(2))]);
    expect(deriveTrainingBreakdownForRange({ ...ps, normalNotes: [] }, '90D', { now: NOON })).toBeNull();
    expect(deriveTrainingBreakdownForRange(ps, '30D', { now: new Date('bad') })).toBeNull();
  });

  test('unverified Recovery membership never becomes an empty exclusion set', () => {
    const ps = parsed([note('a', '2026-10-20', bench(2))]);
    for (const range of ['30D', '90D', 'All']) {
      expect(deriveTrainingBreakdownForRange(ps, range, { now: NOON, populationVerified: false })).toBeNull();
    }
  });

  test('Recovery-excluded notes stay out of every range; deload notes stay in', () => {
    const notes = [note('rec', '2026-10-21', bench(4)), note('dl', '2026-10-20', bench(2), { is_deload: true }), note('a', '2026-10-19', bench(1))];
    for (const range of ['30D', '90D', 'All']) expect(sets(notes, range, NOON, new Set(['rec']))).toBe(3);
  });

  test('note/section pairing survives filtering so overrides resolve on their own note', () => {
    const curl = 'Monday\n-Barbell Biceps Curl: 3x10\n25 10,10';
    const notes = [
      note('old', '2026-01-01', curl, { exercise_movement_groups: { version: 1, overrides: { 'barbell biceps curl': 'pull' } } }),
      note('new', '2026-10-20', curl),
    ];
    const b = deriveTrainingBreakdownForRange(parsed(notes), '30D', { now: NOON });
    expect(b.movement.overriddenSets).toBe(0);
    expect(b.movement.groups.map((g) => g.id)).toEqual(['elbow_flexion']);
    const all = deriveTrainingBreakdownForRange(parsed(notes), 'All', { now: NOON });
    expect(all.movement.overriddenSets).toBe(2);
  });

  test('inputs are not mutated and calls are independent', () => {
    const ps = parsed([note('a', '2026-10-20', bench(2))]);
    const before = JSON.stringify(ps);
    const first = deriveTrainingBreakdownForRange(ps, '30D', { now: NOON });
    first.totals.completedSets = 99;
    expect(deriveTrainingBreakdownForRange(ps, '30D', { now: NOON }).totals.completedSets).toBe(2);
    expect(JSON.stringify(ps)).toBe(before);
    expect(selectRangePopulation(ps, 'All', NOON)).toEqual({ all: true });
  });
});

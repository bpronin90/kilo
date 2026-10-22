import { deriveTrainingBreakdown, deriveTrainingBreakdownForRange } from '../lib/data/trainingBreakdown';
import { TRAINING_BREAKDOWN_WINDOWS, resolveWindow } from '../lib/data/trainingBreakdownRange';
import { makeWorkoutNoteItem } from '../lib/data/exerciseCatalog';
import { getNoteSections } from '../hooks/useEntries';
import { deriveParsedSections } from '../screens/analytics/analyticsDerivations';

// #1597: every primary fixture is a REAL-shaped workout note — built by
// makeWorkoutNoteItem (id, title, raw_text, saved_at/updated_at, ...), parsed
// from raw_text by the real getNoteSections -> deriveParsedSections path, and
// carrying NO `date` field. The #1589 fixtures invented `note.date` and so hid
// that 30D/90D were always empty in production.
const note = (raw_text, extra = {}) => ({ ...makeWorkoutNoteItem({ title: 'Routine', raw_text }), ...extra });
const parsed = (notes, excluded = null) => deriveParsedSections(notes, notes[0], excluded);
const derive = (ps, w) => deriveTrainingBreakdownForRange(ps, w, { populationVerified: true });
const sets = (notes, w, excluded) => derive(parsed(notes, excluded), w).totals.completedSets;
const entries = (notes, w) => derive(parsed(notes), w).totals.activityEntries;
const benchSets = (b) => b.movement.groups.flatMap((g) => g.exercises).filter((e) => e.key === 'barbell bench press').reduce((n, e) => n + e.sets, 0);

// One exercise logged once per week for `n` weeks in a single growing note.
// Row i (0-based) has (i % 3) + 1 sets, so session set counts are unequal.
const growing = (n, name = 'Barbell Bench Press') => {
  const rows = Array.from({ length: n }, (_, i) => `135 ${Array((i % 3) + 1).fill(5).join(',')}`);
  return `Monday\n-${name}: 3x5\n${rows.join('\n')}`;
};
const setsOfLastRows = (n, k) => Array.from({ length: n }, (_, i) => (i % 3) + 1).slice(-k).reduce((a, b) => a + b, 0);

describe('fixtures are real-shaped (#1597)', () => {
  test('notes come from makeWorkoutNoteItem and have no date field', () => {
    const n = note(growing(2));
    expect(Object.prototype.hasOwnProperty.call(n, 'date')).toBe(false);
    expect(n).toEqual(expect.objectContaining({ id: expect.any(String), title: 'Routine', raw_text: expect.any(String), saved_at: expect.any(String), updated_at: expect.any(String) }));
    const ps = parsed([n]);
    expect(ps.normalNotes[0]).toBe(n);
    expect(ps.noteSectionsList[0]).toEqual(getNoteSections(n));
    // The growing note parses into one session entry per logged row.
    expect(ps.noteSectionsList[0][0].exercises[0].session_entries).toHaveLength(2);
  });
});

describe('session windows (#1597)', () => {
  test('the regression: a date-free real note yields nonempty Last 12 and Last 4', () => {
    const notes = [note(growing(3))];
    expect(notes.every((n) => !('date' in n))).toBe(true);
    expect(sets(notes, 'last12')).toBe(6);
    expect(sets(notes, 'last4')).toBe(6);
    expect(sets(notes, 'All')).toBe(6);
    expect(derive(parsed(notes), 'last12').isEmpty).toBe(false);
  });

  test('a long growing note: Last 4 < Last 12 < All, chosen by session not by set', () => {
    const notes = [note(growing(20))];
    const l4 = sets(notes, 'last4'); const l12 = sets(notes, 'last12'); const all = sets(notes, 'All');
    expect(l4).toBe(setsOfLastRows(20, 4));
    expect(l12).toBe(setsOfLastRows(20, 12));
    expect(all).toBe(setsOfLastRows(20, 20));
    expect(l4).toBeGreaterThan(0);
    expect(l4).toBeLessThan(l12);
    expect(l12).toBeLessThan(all);
    // Not 4 sets, not a scaled All.
    expect(l4).not.toBe(4);
  });

  test.each([[3, 'short history keeps everything'], [4, 'exactly N'], [5, 'N+1 drops the oldest']])('Last 4 boundary with %i sessions (%s)', (n) => {
    const notes = [note(growing(n))];
    expect(sets(notes, 'last4')).toBe(setsOfLastRows(n, 4));
  });

  test.each([[12], [13]])('Last 12 boundary with %i sessions', (n) => {
    expect(sets([note(growing(n))], 'last12')).toBe(setsOfLastRows(n, 12));
  });

  test('streams run across notes in notebook order with no per-note reset', () => {
    // Older note: 3 sessions of 1, 2, 3 sets; newer note: 2 sessions of 1 set.
    const older = note('Monday\n-Barbell Bench Press: 3x5\n135 5\n135 5,5\n135 5,5,5', { saved_at: '2030-01-01T00:00:00Z', updated_at: '2030-01-01T00:00:00Z' });
    const newer = note('Thursday\n-Barbell Bench Press: 3x5\n135 5\n135 5', { saved_at: '2020-01-01T00:00:00Z', updated_at: '2020-01-01T00:00:00Z' });
    // Array order is history order: older first. Misleading timestamps must not reorder it.
    const notes = [older, newer];
    // Last 4 = newer's 2 + older's last 2 (2 + 3 sets) = 7, crossing into the older note.
    expect(sets(notes, 'last4')).toBe(7);
    expect(sets(notes, 'All')).toBe(8);
    // Reversing the array reverses which sessions are newest.
    expect(sets([newer, older], 'last4')).toBe(1 + 2 + 3 + 1);
  });

  test('distinct original names are distinct streams (no alias merging)', () => {
    const notes = [note('Monday\n-RDL: 3x8\n185 8\n185 8\n185 8\n185 8\n185 8\n-Romanian Deadlift: 3x8\n185 8,8')];
    const b = derive(parsed(notes), 'last4');
    expect(b.totals.completedSets).toBe(4 + 2);
    expect(b.totals.exerciseCount).toBe(2);
  });

  test('same name across weekday sections joins one stream', () => {
    const notes = [note('Monday\n-Barbell Bench Press: 3x5\n135 5\n135 5\n135 5\nThursday\n-Barbell Bench Press: 3x5\n135 5,5\n135 5,5')];
    // Parsed order: Monday's 3 then Thursday's 2; Last 4 keeps Monday's last 2 and Thursday's 2.
    expect(sets(notes, 'last4')).toBe(1 + 1 + 2 + 2);
  });

  test('note-scoped overrides resolve on the retained unit\'s own note', () => {
    const curl = (rows) => `Monday\n-Barbell Biceps Curl: 3x10\n${rows}`;
    const old = note(curl('25 10,10'), { exercise_movement_groups: { version: 1, overrides: { 'barbell biceps curl': 'pull' } } });
    const mid = note(curl('25 10\n25 10'), { exercise_movement_groups: { version: 1, overrides: { 'barbell biceps curl': 'push' } } });
    const recent = note(curl('25 10\n25 10'), { exercise_movement_groups: 'not json {' });
    const ps = parsed([old, mid, recent]);
    const b4 = derive(ps, 'last4');
    expect(b4.totals.completedSets).toBe(4);
    expect(b4.movement.overriddenSets).toBe(2);
    expect(b4.movement.groups.find((g) => g.id === 'legacy:push').sets).toBe(2);
    expect(b4.movement.groups.find((g) => g.id === 'legacy:pull')).toBeUndefined();
    expect(b4.movement.unreadableOverrideNotes).toBe(1);
    const all = derive(ps, 'All');
    expect(all.movement.groups.find((g) => g.id === 'legacy:pull').sets).toBe(2);
  });

  test('Recovery-excluded notes neither count nor consume window depth; deload counts', () => {
    const older = note(growing(4));
    const deload = note('Monday\n-Barbell Bench Press: 3x5\n95 5', { is_deload: true });
    const rec = note('Monday\n-Barbell Bench Press: 3x5\n135 5,5,5,5,5\n135 5,5,5,5,5\n135 5,5,5,5,5\n135 5,5,5,5,5');
    const notes = [older, deload, rec];
    // Without rec: stream = 1,2,3,1 (older) + 1 (deload); Last 4 = 2+3+1+1.
    expect(sets(notes, 'last4', new Set([rec.id]))).toBe(7);
    expect(sets(notes, 'All', new Set([rec.id]))).toBe(8);
  });

  test('warm-ups, skipped entries/sets, strength-unparsed rows and empty prescriptions take no slot', () => {
    const text = [
      'Monday', '-Barbell Bench Press: 3x5', '135 5', '135 5', '135 5', '135 5', '135 5',
      '135 5,5', '-', '135 -,-', 'not a set ???', '135 5', '135 5', '135 5,5,5', '-Back Squat: 3x5',
      'Tuesday', '+Warmup', '-Barbell Bench Press', '45 10', '45 10', '45 10', '45 10',
    ].join('\n');
    const ps = parsed([note(text)]);
    // Eligible stream: 1,1,1,1,1,2,1,1,3. The newer warm-up rows, the skipped entry,
    // the all-skipped row and the unparsed row must not displace performed sessions.
    expect(benchSets(derive(ps, 'last4'))).toBe(2 + 1 + 1 + 3);
    expect(benchSets(derive(ps, 'All'))).toBe(12);
    expect(derive(ps, 'All').totals.exerciseCount).toBe(1);
  });

  test('timed sessions window by session and keep the timed tally', () => {
    const notes = [note(`Monday\n-Plank: 3x30s\n${Array(6).fill('30').join('\n')}`)];
    expect(entries(notes, 'All')).toBe(6);
    expect(entries(notes, 'last4')).toBe(4);
    // The row grammar writes one timed hold per row; a multi-set timed session
    // (supplementary fixture: a second hold added to the parsed newest entry)
    // still occupies one slot and keeps both holds in the tally.
    const ps = parsed(notes);
    const ex = ps.noteSectionsList[0][0].exercises[0];
    const last = ex.session_entries[ex.session_entries.length - 1];
    const multi = { ...ps, noteSectionsList: [[{ ...ps.noteSectionsList[0][0], exercises: [{ ...ex, session_entries: [...ex.session_entries.slice(0, -1), { ...last, sets: [...last.sets, { ...last.sets[0], set_index: 2 }] }] }] }]] };
    expect(derive(multi, 'last4').totals.activityEntries).toBe(5);
    expect(derive(multi, 'All').totals.activityEntries).toBe(7);
  });

  test('cardio: unparsed entries and bare rows are activity units in one stream; comments are not', () => {
    // '- 5 min' / '- 6 min' are unparsed session entries, '20 min 9' / '22 min 10'
    // are bare unparsed_positions, '10 5' is a parsed entry, '-- felt fine' a comment.
    const rows = ['- 5 min', '20 min 9', '-- felt fine', '22 min 10', '10 5', '- 6 min'];
    const ps = parsed([note(`Monday\n-Treadmill\n${rows.join('\n')}`)]);
    expect(derive(ps, 'All').totals.activityEntries).toBe(5);
    expect(derive(ps, 'last4').totals.activityEntries).toBe(4);
    expect(derive(ps, 'last12').totals.activityEntries).toBe(5);
    // Activity-only histories stay visible in every window.
    for (const w of TRAINING_BREAKDOWN_WINDOWS) {
      expect(derive(ps, w).isEmpty).toBe(false);
      expect(derive(ps, w).totals.completedSets).toBe(0);
    }
  });

  test('cardio streams cross notes like strength streams', () => {
    const older = note('Monday\n-Bike\n- 5 min\n- 5 min\n- 5 min');
    const newer = note('Thursday\n-Bike\n5 min 9\n5 min 9');
    expect(derive(parsed([older, newer]), 'last4').totals.activityEntries).toBe(4);
    expect(derive(parsed([older, newer]), 'All').totals.activityEntries).toBe(5);
  });
});

describe('population boundary (#1597)', () => {
  test('All projects exactly to the legacy breakdown', () => {
    const notes = [note(growing(15)), note('Monday\n-Pull-Up: 3x8\n8,8\n-Plank: 3x30s\n30\n-Bike 5 min\n- 5 min')];
    const ps = parsed(notes);
    const { muscles: { regions, ...muscles }, movement: { comparisons, ...movement }, ...rest } = derive(ps, 'All');
    expect({ ...rest, muscles, movement }).toEqual(deriveTrainingBreakdown(ps));
    expect(regions).toHaveLength(6);
    expect(comparisons).toHaveLength(2);
  });

  test('All keeps the legacy allSections fallback; bounded windows do not fall back', () => {
    const ps = parsed([note(growing(2))]);
    const { allSections } = ps;
    expect(derive({ allSections }, 'All').totals.completedSets).toBe(3);
    expect(derive({ allSections }, 'last12')).toBeNull();
    expect(derive({ ...ps, normalNotes: [] }, 'last4')).toBeNull();
    for (const w of ['last4', 'last12']) {
      expect(derive({ normalNotes: [note('')], noteSectionsList: [null] }, w)).toBeNull();
      expect(derive({ normalNotes: [null], noteSectionsList: [[]] }, w)).toBeNull();
    }
    expect(derive({ normalNotes: [note('')], noteSectionsList: [[]] }, 'last12').isEmpty).toBe(true);
    expect(derive(parsed([]), 'last12').isEmpty).toBe(true);
  });

  test('unknown windows throw; the old calendar ids are gone', () => {
    const ps = parsed([note(growing(2))]);
    for (const w of ['30D', '90D', '7D']) expect(() => derive(ps, w)).toThrow();
    expect(TRAINING_BREAKDOWN_WINDOWS).toEqual(['last4', 'last12', 'All']);
    expect(resolveWindow(ps, 'All')).toEqual({ all: true });
  });

  test('unverified Recovery membership is null for every window', () => {
    const ps = parsed([note(growing(2))]);
    for (const w of TRAINING_BREAKDOWN_WINDOWS) {
      expect(deriveTrainingBreakdownForRange(ps, w, { populationVerified: false })).toBeNull();
    }
  });

  test('no clock dependency: an unused `now` changes nothing', () => {
    const ps = parsed([note(growing(14))]);
    for (const w of TRAINING_BREAKDOWN_WINDOWS) {
      expect(deriveTrainingBreakdownForRange(ps, w, { now: new Date('bad') })).toEqual(derive(ps, w));
      expect(deriveTrainingBreakdownForRange(ps, w, { now: new Date(1990, 0, 1) })).toEqual(derive(ps, w));
    }
  });

  test('inputs are not mutated and calls are independent', () => {
    const ps = parsed([note(growing(14))]);
    const before = JSON.stringify(ps);
    const first = derive(ps, 'last4');
    first.totals.completedSets = 99;
    expect(derive(ps, 'last4').totals.completedSets).toBe(setsOfLastRows(14, 4));
    derive(ps, 'last12'); derive(ps, 'All');
    expect(JSON.stringify(ps)).toBe(before);
  });
});

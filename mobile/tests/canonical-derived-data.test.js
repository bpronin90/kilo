// Cross-consumer contract: Home and Analytics read ONE canonical derivation per
// metric. Each test feeds the same raw notes/weight data through both screens'
// real derivation entry points (Home: deriveHomeDashboardData; Analytics:
// deriveParsedSections → deriveAnalytics → deriveOverviewRows; Weight:
// deriveWeightGoalAnalytics) and asserts the canonical values are identical.

import { getNoteSections } from '../hooks/useEntries';
import { deriveHomeDashboardData, resolveHomeOneKSelections } from '../screens/home/homeDashboardData';
import {
  deriveAnalytics,
  deriveParsedSections,
  deriveOverviewRows,
} from '../screens/analytics/analyticsDerivations';
import {
  DEFAULT_1K_EXERCISES,
  deriveRoutineStatus,
  deriveWeightGoalAnalytics,
  resolveOneKSelections,
} from '../lib/data';
import { buildRecoveryAnalyticsFilter } from '../lib/data/recoveryAnalyticsFilter';
import { summarizeExerciseProgress, deriveProgressionSections } from '../lib/data/exerciseProgress';

const DELOAD = 'Deload · ';

function homePipeline({ notes, currentNote, trackedLifts = {}, activations = {}, filter = null, deloadHistory = [], weightEntries = [], weightGoal = null }) {
  const normalNotes = filter ? filter.filterNotes(notes) : notes;
  const noteSectionsList = normalNotes.map(n => getNoteSections(n));
  return deriveHomeDashboardData({
    weightEntries,
    workoutNote: currentNote,
    weightGoal,
    allSections: noteSectionsList.flat(),
    noteSectionsList,
    normalNotes,
    trackedLifts,
    trackedLiftActivations: activations,
    deloadHistory,
    sourceNoteId: currentNote?.id ?? null,
    recoveryBlocks: [],
  });
}

function analyticsPipeline({ notes, currentNote, trackedLifts = {}, activations = {}, filter = null, deloadHistory = [] }) {
  const parsed = deriveParsedSections(notes, currentNote, filter ? filter.excludedNoteIds : null);
  const selections = resolveOneKSelections(currentNote);
  const analytics = deriveAnalytics(parsed, trackedLifts, selections, 1.0, activations, {
    deloadHistory, sourceNoteId: currentNote?.id ?? null, recoveryBlocks: [],
  });
  const routineStatus = deriveRoutineStatus(parsed.currentSections, currentNote, deloadHistory);
  const rows = deriveOverviewRows({ exerciseProgress: analytics.exerciseProgress, sessionsSinceDeload: routineStatus.sessionsSinceDeload });
  return { parsed, selections, analytics, routineStatus, progressRow: rows.find(r => r.key === 'progress') };
}

function expectProgressAgrees(home, analytics) {
  expect(home.exerciseProgress).toEqual(analytics.analytics.exerciseProgress);
  expect(home.weeklySummary.classifications).toEqual({
    progressing: analytics.analytics.exerciseProgress.progressing,
    stalled: analytics.analytics.exerciseProgress.stalled,
    regressing: analytics.analytics.exerciseProgress.regressing,
  });
  expect(home.weeklySummary.newlyTrackedCount).toBe(analytics.analytics.exerciseProgress.newlyTracked);
  expect(home.weeklySummary.hasInheritedTracking).toBe(analytics.analytics.exerciseProgress.hasInheritedTracking);
  const p = home.exerciseProgress;
  expect(analytics.progressRow.counts).toEqual({ up: p.progressing, flat: p.stalled, down: p.regressing });
  expect(analytics.progressRow.value).toBe(p.classified > 0 ? p.progressing : null);
}

const note = (id, raw_text, extra = {}) => ({ id, title: `R-${id}`, raw_text, one_k_exercises: null, saved_at: '2026-01-05T00:00:00Z', ...extra });

// Bench is trained on two days: Monday climbs, Thursday drops.
const MULTI_DAY = [
  'Monday',
  '-Bench Press',
  '135 5',
  '145 5',
  '155 5',
  '-Squat',
  '225 5',
  '235 5',
  'Thursday',
  '-Bench Press',
  '155 5',
  '145 5',
  '135 5',
].join('\n');

describe('Exercise Progress — one population, one summary', () => {
  test('a multi-day tracked exercise is one exercise on both screens', () => {
    const current = note('cur', MULTI_DAY);
    const input = { notes: [current], currentNote: current, trackedLifts: { 'bench press': true, squat: true } };
    const home = homePipeline(input);
    const analytics = analyticsPipeline(input);
    expectProgressAgrees(home, analytics);
    // Bench climbs Monday and drops Thursday, but it is ONE exercise with one
    // overall trend. (Home used to count per-day rows: 2 up / 1 down from 3
    // rows, while Analytics said 1 up of 2.)
    expect(home.exerciseProgress).toMatchObject({ progressing: 1, stalled: 0, regressing: 1, classified: 2 });
    expect(analytics.progressRow).toMatchObject({ value: 1, valueSuffix: 'of 2 up' });
  });

  test('post-deload history: deload sessions are excluded from progression on both screens', () => {
    const before = note('a', '-Squat\n225 5\n245 5', { saved_at: '2026-01-05T00:00:00Z' });
    const deload = note('d', '-Squat\n135 5', { title: `${DELOAD}R-a`, saved_at: '2026-02-01T00:00:00Z' });
    const current = note('cur', '-Squat\n245 5', { saved_at: '2026-02-08T00:00:00Z' });
    const notes = [before, deload, current];
    const input = { notes, currentNote: current, trackedLifts: { squat: true } };
    const home = homePipeline(input);
    const analytics = analyticsPipeline(input);
    expectProgressAgrees(home, analytics);
    expect(home.reentry).toEqual(analytics.analytics.reentry);
    // 245 back to 245 is steady; counting the light deload pass would have
    // read it as progress.
    expect(home.exerciseProgress).toMatchObject({ progressing: 0, stalled: 1, classified: 1 });
    // The canonical population is literally the deload-free one.
    const sectionsList = notes.map(n => getNoteSections(n));
    expect(analytics.parsed.signalSections).toEqual(deriveProgressionSections(notes, sectionsList));
    expect(analytics.parsed.signalSections).toEqual([...sectionsList[0], ...sectionsList[2]]);
  });

  test('Recovery exclusions drop the same notes from both screens', () => {
    const base = note('a', '-Squat\n245 5');
    const recovery = note('r', '-Squat\n95 5');
    const current = note('cur', '-Squat\n245 5');
    const blocks = [{ id: 'b1', include_in_normal_analytics: false }];
    const weeks = [{ id: 'w1', block_id: 'b1', note_id: 'r', week_number: 1 }];
    const filter = buildRecoveryAnalyticsFilter(blocks, weeks);
    expect(filter.excludedNoteIds.has('r')).toBe(true);
    const input = { notes: [base, recovery, current], currentNote: current, trackedLifts: { squat: true }, filter };
    const home = homePipeline(input);
    const analytics = analyticsPipeline(input);
    expectProgressAgrees(home, analytics);
    expect(home.oneK).toEqual(analytics.analytics.oneK);
    // Excluding vs. including the recovery note is a real difference, and both
    // screens move together with it.
    const homeIncluded = homePipeline({ ...input, filter: null });
    const analyticsIncluded = analyticsPipeline({ ...input, filter: null });
    expectProgressAgrees(homeIncluded, analyticsIncluded);
    expect(home.exerciseProgress).toMatchObject({ progressing: 0, stalled: 1 });
    expect(homeIncluded.exerciseProgress).toMatchObject({ progressing: 1, stalled: 0 });
  });

  test('activation state (newly tracked / inherited) agrees', () => {
    const current = note('cur', '-Bench Press\n135 5\n-Squat\n225 5\n235 5');
    const activations = { 'bench press': { anchor: 0, at: '2026-05-01T00:00:00Z', witness: { headings: [], sessions: '' } } };
    const input = { notes: [current], currentNote: current, trackedLifts: { 'bench press': true, squat: true }, activations };
    const home = homePipeline(input);
    const analytics = analyticsPipeline(input);
    expectProgressAgrees(home, analytics);
    expect(home.exerciseProgress.hasInheritedTracking).toBe(true);
  });

  test('the summary counts each exercise once from its overall trend', () => {
    const summary = summarizeExerciseProgress({
      signals: [
        { name: 'Bench Press', overload_trend: 'up' },
        { name: 'bench press', overload_trend: 'down' },
        { name: 'Squat', overload_trend: 'flat' },
        { name: 'Row', overload_trend: null },
      ],
    });
    expect(summary).toMatchObject({ progressing: 1, stalled: 1, regressing: 0, classified: 2 });
  });
});

describe('Big 3 selection — one resolver', () => {
  const MALFORMED = [
    null,
    'bench',
    ['Squat'],
    { deadlift: true },
    { bench: '   ', squat: 42 },
    { squat: 'Front Squat', bogus: 'Curl' },
  ];

  test.each(MALFORMED.map(v => [JSON.stringify(v), v]))('malformed/restored picks %s resolve identically on Home and Analytics', (_label, picks) => {
    const current = note('cur', '-DB Bench Press\n135 5\n-Squat\n225 5\n-Front Squat\n185 5\n-Deadlift\n315 5', { one_k_exercises: picks });
    const home = homePipeline({ notes: [current], currentNote: current });
    const analytics = analyticsPipeline({ notes: [current], currentNote: current });
    expect(home.oneKSelections).toEqual(analytics.selections);
    expect(resolveHomeOneKSelections(current)).toEqual(analytics.selections);
    expect(Object.keys(analytics.selections).sort()).toEqual(['bench', 'deadlift', 'squat']);
    for (const slot of ['bench', 'squat', 'deadlift']) {
      expect(typeof analytics.selections[slot]).toBe('string');
    }
    expect(home.oneK).toEqual(analytics.analytics.oneK);
  });

  test('valid picks override only their own slot', () => {
    expect(resolveOneKSelections({ one_k_exercises: { squat: 'Front Squat', bogus: 'Curl', deadlift: true } }))
      .toEqual({ ...DEFAULT_1K_EXERCISES, squat: 'Front Squat' });
  });
});

describe('Weight goal state — one normalization', () => {
  const entries = [
    { date: '2026-10-10', weight_value: 200 },
    { date: '2026-10-03', weight_value: 202 },
  ];

  function weightScreenGoalInfo(goal) {
    return deriveWeightGoalAnalytics(entries, goal, { goalEditing: false }, new Date(), null).goalInfo;
  }

  test.each([
    ['at target date', 0],
    ['after target date', -14],
  ])('a goal %s is overdue with no pace on Home and Weight', (_label, offsetDays) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const pad = n => String(n).padStart(2, '0');
    const target_date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const goal = { target_weight: 190, target_date, start_weight: 205 };
    const home = homePipeline({ notes: [], currentNote: null, weightEntries: entries, weightGoal: goal }).goalInfo;
    const weight = weightScreenGoalInfo(goal);
    expect(home).toEqual(weight);
    expect(home).toMatchObject({ isOverdue: true, weeks_remaining: 0, required_weekly_pace: null });
  });

  test('a future goal keeps a finite pace on both', () => {
    const goal = { target_weight: 190, target_date: '2099-01-01', start_weight: 205 };
    const home = homePipeline({ notes: [], currentNote: null, weightEntries: entries, weightGoal: goal }).goalInfo;
    expect(home).toEqual(weightScreenGoalInfo(goal));
    expect(home.isOverdue).toBe(false);
    expect(Number.isFinite(home.required_weekly_pace)).toBe(true);
    expect(home.weeks_remaining).toBeGreaterThan(0);
  });
});

describe('Routine Health — deriveRoutineStatus is the only interpretation', () => {
  test('Home reads the same routine status object Analytics does', () => {
    const current = note('cur', MULTI_DAY);
    const deloadHistory = [{ completed_at: '2026-02-01T00:00:00Z', deload_session_ordinal: 1, deload_ordinal_is_count: true, raw_text: '-Squat\n135 5' }];
    const home = homePipeline({ notes: [current], currentNote: current, deloadHistory });
    const analytics = analyticsPipeline({ notes: [current], currentNote: current, deloadHistory });
    expect(home.routineStatus).toEqual(analytics.routineStatus);
    expect(home.weeksIn).toBe(analytics.routineStatus.weeksIn);
    expect(home.weeksIn).toBe(3);
    expect(home.routineStatus.sessionsSinceDeload).toBeGreaterThanOrEqual(0);
  });

  test('no routine: depth is unknown, not zero — on both screens', () => {
    const home = homePipeline({ notes: [], currentNote: null });
    const analytics = analyticsPipeline({ notes: [], currentNote: null });
    // Home supplies null sections, Analytics supplies [] (getNoteSections(null)).
    expect(analytics.parsed.currentSections).toEqual([]);
    expect(home.routineStatus).toEqual(analytics.routineStatus);
    expect(home.weeksIn).toBeNull();
    expect(analytics.routineStatus.weeksIn).toBeNull();
  });

  test.each([
    ['blank note', ''],
    ['headers only, nothing logged', 'Monday\nThursday'],
  ])('existing empty routine (%s): depth is 0 on both screens', (_label, raw) => {
    const current = note('empty', raw);
    const home = homePipeline({ notes: [current], currentNote: current });
    const analytics = analyticsPipeline({ notes: [current], currentNote: current });
    expect(home.routineStatus).toEqual(analytics.routineStatus);
    expect(home.weeksIn).toBe(0);
    expect(analytics.routineStatus.weeksIn).toBe(0);
    expect(analytics.routineStatus.sessionsLogged).toBe(0);
  });

  test('populated routine without deloads: identical on both screens', () => {
    const current = note('cur', MULTI_DAY);
    const home = homePipeline({ notes: [current], currentNote: current });
    const analytics = analyticsPipeline({ notes: [current], currentNote: current });
    expect(home.routineStatus).toEqual(analytics.routineStatus);
    expect(home.weeksIn).toBe(3);
  });
});

// Cross-consumer contract: Home and Analytics read ONE canonical derivation per
// metric. Each test feeds the same raw notes/weight data through both screens'
// real derivation entry points (Home: deriveHomeDashboardData; Analytics:
// deriveParsedSections → deriveAnalytics; Weight:
// deriveWeightGoalAnalytics) and asserts the canonical values are identical.

import { getNoteSections } from '../hooks/useEntries';
import { deriveHomeDashboardData, resolveHomeOneKSelections } from '../screens/home/homeDashboardData';
import {
  deriveAnalytics,
  deriveParsedSections,
} from '../screens/analytics/analyticsDerivations';
import {
  DEFAULT_1K_EXERCISES,
  deriveRoutineStatus,
  deriveWeightGoalAnalytics,
  resolveOneKSelections,
} from '../lib/data';
import { buildRecoveryAnalyticsFilter } from '../lib/data/recoveryAnalyticsFilter';
import { summarizeExerciseProgress, deriveProgressionSections, establishingBaselineMessage } from '../lib/data/exerciseProgress';
import { buildTrackedLiftActivation } from '../lib/data/workoutAnalyticsActivations';

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
    notes,
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
  return { parsed, selections, analytics, routineStatus };
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
    // rows, while Analytics counted one per exercise.)
    expect(home.exerciseProgress).toMatchObject({ progressing: 1, stalled: 0, regressing: 1, classified: 2 });
    expect(analytics.analytics.exerciseProgress).toMatchObject({ progressing: 1, stalled: 0, regressing: 1, classified: 2 });
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

// #1456: Home's `Week N` is the current routine's calendar week, not the
// session-depth count (`weeksIn`) that six logged sessions would inflate.
describe('Home routine week is routine-scoped (#1456)', () => {
  const SIX = Array.from({ length: 6 }, (_, i) => `Day ${i + 1}\n+Lifting\n-Squat\n225 5`).join('\n');
  const SIX_SESSIONS = '-Squat\n225 5\n230 5\n235 5\n240 5\n245 5\n250 5';

  test('a routine started this week is Week 1 even with six sessions logged', () => {
    const current = note('cur', SIX_SESSIONS, { saved_at: new Date().toISOString() });
    const home = homePipeline({ notes: [current], currentNote: current });
    expect(home.weeksIn).toBe(6);
    expect(home.routineWeek).toBe(1);
  });

  test('older routines and deload archives do not move the current routine week', () => {
    const old = note('old', SIX_SESSIONS, { saved_at: '2025-01-05T00:00:00Z' });
    const current = note('cur', '-Squat\n225 5', { saved_at: new Date().toISOString() });
    const deloadHistory = [{ completed_at: '2025-02-01T00:00:00Z', deload_session_ordinal: 1, deload_ordinal_is_count: true, raw_text: '-Squat\n135 5' }];
    const home = homePipeline({ notes: [old, current], currentNote: current, deloadHistory });
    expect(home.routineWeek).toBe(1);
  });

  test('a routine begun three Mondays ago reads Week 4, recomputed per current note', () => {
    const threeWeeksAgo = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString();
    const a = note('a', '-Squat\n225 5', { saved_at: threeWeeksAgo });
    const b = note('b', '-Squat\n225 5', { saved_at: new Date().toISOString() });
    expect(homePipeline({ notes: [a, b], currentNote: a }).routineWeek).toBe(4);
    expect(homePipeline({ notes: [a, b], currentNote: b }).routineWeek).toBe(1);
  });

  test('no routine, no start date, or a future start omits the week', () => {
    expect(homePipeline({ notes: [], currentNote: null }).routineWeek).toBeNull();
    const undated = note('u', '-Squat\n225 5', { saved_at: undefined });
    expect(homePipeline({ notes: [undated], currentNote: undated }).routineWeek).toBeNull();
    const future = note('f', '-Squat\n225 5', { saved_at: '2999-01-01T00:00:00Z' });
    expect(homePipeline({ notes: [future], currentNote: future }).routineWeek).toBeNull();
  });
});

// #1391: Track anchors are minted over the whole notebook and translated into
// the filtered progression population on both screens.
describe('Exercise Progress — activation anchors across filtered populations', () => {
  const blockWeeks = (n) => Array.from({ length: n }, (_, i) => ({ id: `wk${i + 1}`, block_id: 'b1', note_id: `w${i + 1}`, week_number: i + 1 }));
  const history = [
    note('s', 'Monday\n-Squat\n225 5\n235 5\n245 5\n255 5\n-Lateral Raise\n20 12\n25 12'),
    note('d', 'Monday\n-Squat\n135 5', { title: `${DELOAD}R-s` }),
    note('b', 'Monday\n-Squat\n255 5\n265 5\n405 5\n-Lateral Raise\n25 12'),
    ...[1, 2, 3, 4, 5, 6].map(w => note(`w${w}`, `Monday\n-Squat\n${100 + w * 10} 8\n-Lateral Raise\n10 15`)),
  ];
  const current = note('p', 'Monday\n-Squat\n275 5\n285 5\n-Lateral Raise\n25 12');
  const mint = (name) => buildTrackedLiftActivation(history.flatMap(n => getNoteSections(n)), name, new Date('2026-08-26T12:00:00Z'));
  const activations = { squat: mint('Squat'), 'lateral raise': mint('Lateral Raise') };
  const trackedLifts = { squat: true, 'lateral raise': true };
  const run = (status, include = false) => {
    const filter = buildRecoveryAnalyticsFilter([{ id: 'b1', status, include_in_normal_analytics: include }], blockWeeks(6));
    const input = { notes: [...history, current], currentNote: current, trackedLifts, activations, filter };
    return { home: homePipeline(input), analytics: analyticsPipeline(input) };
  };

  test.each(['active', 'completed'])('Squat reads Progressing beside a one-session lift (%s block)', (status) => {
    const { home, analytics } = run(status);
    expectProgressAgrees(home, analytics);
    expect(home.exerciseProgress).toMatchObject({ progressing: 1, stalled: 0, regressing: 0, classified: 1, newlyTracked: 1 });
    expect(establishingBaselineMessage(home.exerciseProgress)).toBeNull();
    const squat = analytics.analytics.signals.find(s => s.name.toLowerCase() === 'squat');
    expect(squat.overload_trend).toBe('up');
  });

  test('an included block is part of the population, so its sessions stay pre-activation', () => {
    const { home, analytics } = run('completed', true);
    expectProgressAgrees(home, analytics);
    // Still Progressing; the light recovery sessions never join the comparison.
    expect(home.exerciseProgress).toMatchObject({ progressing: 1, classified: 1, newlyTracked: 1 });
  });

  test('first-session-only tracked population reads as establishing a baseline', () => {
    const onlyOne = note('p', 'Monday\n-Squat\n275 5\n-Lateral Raise\n25 12');
    const filter = buildRecoveryAnalyticsFilter([{ id: 'b1', status: 'completed', include_in_normal_analytics: false }], blockWeeks(6));
    const input = { notes: [...history, onlyOne], currentNote: onlyOne, trackedLifts, activations, filter };
    const home = homePipeline(input);
    const analytics = analyticsPipeline(input);
    expectProgressAgrees(home, analytics);
    expect(home.exerciseProgress).toMatchObject({ classified: 0, newlyTracked: 2 });
    expect(establishingBaselineMessage(home.exerciseProgress))
      .toBe('2 exercises are establishing a baseline. Log another session to see trends.');
  });
});

describe('establishingBaselineMessage', () => {
  test('only for an all-first-session population, with singular/plural copy', () => {
    expect(establishingBaselineMessage({ classified: 0, newlyTracked: 1 }))
      .toBe('1 exercise is establishing a baseline. Log another session to see its trend.');
    expect(establishingBaselineMessage({ classified: 0, newlyTracked: 13 }))
      .toBe('13 exercises are establishing a baseline. Log another session to see trends.');
    expect(establishingBaselineMessage({ classified: 1, newlyTracked: 12 })).toBeNull();
    expect(establishingBaselineMessage({ classified: 0, newlyTracked: 0 })).toBeNull();
    expect(establishingBaselineMessage(null)).toBeNull();
  });
});

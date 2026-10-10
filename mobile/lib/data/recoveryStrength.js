// Strength relative to the frozen baseline (#1305): per-lift score, a
// consistent-cohort trend, a per-lift ladder, best-case pace, and "not retested".
//
// A lift's score for a week is 100 * (best valid Epley set in that week's note)
// / (the frozen best-set Epley). The week's best set is taken across every
// session/day in the linked note, never summed. Sets and identities come from
// `collectRecoveryWeekSets`, the exact pipeline the return-to-baseline comparison
// reads, so exercise naming, warmup/skip handling and name matches agree.
//
// Time is RECOVERY WEEK ORDINALS only (`week_number`), never calendar dates.
// Everything is read-only and as-of a selected week: no later week can change
// what a historical selection shows. Nothing here is a medical judgment or ends
// a block.

import { parseWorkoutNote } from '../parser.js';
import { RECOVERY_BASELINE_SUPPORTED_VERSIONS, orderedLiveWeeks } from './recoveryBlocks.js';
import { collectRecoveryWeekSets } from './recoveryAnalytics.js';
import { baselineStrengthPair, bestEpleySet, baselineLacksStrengthData } from './recoveryStrengthBaseline.js';

export const STRENGTH_STATUS = Object.freeze({
  OK: 'ok',
  BASELINE_UNAVAILABLE: 'baseline_unavailable',
  BASELINE_UNSUPPORTED: 'baseline_unsupported',
  PAIR_UNAVAILABLE: 'pair_unavailable',
  NO_WEEKS: 'no_weeks',
});

export const LIFT_STATE = Object.freeze({
  SCORED: 'scored',
  NOT_LOGGED: 'not_logged',
  UNSCOREABLE: 'unscoreable',
  UNKNOWN: 'unknown',
});

// Why a lift (or one week of it) has no strength score. Visible copy.
export const UNSCOREABLE_REASON = Object.freeze({
  time_based: 'Timed work has no load and reps to score',
  reps_only: 'Bodyweight reps have no load to score',
  pair_missing: 'Baseline best-set data unavailable',
  no_baseline_set: 'Baseline has no set with load and reps to score',
  loaded_duration: 'Loaded timed work has no reps to score',
  class_changed: 'Logged without load this week',
  assisted: 'Assisted sets are not scored as load',
  no_scoreable_set: 'No completed set with load and reps',
});

export const NOT_RETESTED = Object.freeze({
  ABSENT_THIS_WEEK: 'absent_this_week',
  NEVER_LOGGED: 'never_logged',
  UNKNOWN: 'unknown',
});

export const PACE_STATUS = Object.freeze({
  ESTIMATE: 'estimate',
  INSUFFICIENT: 'insufficient',
  NO_GAIN: 'no_gain',
  REACHED: 'reached',
  NO_CURRENT: 'no_current',
  SUPPRESSED: 'suppressed',
});

export const PACE_TARGETS = Object.freeze([90, 100]);
export const PACE_WINDOW = 4;
export const PACE_MIN_POINTS = 3;

// Display a percent without ever rounding a below-target value up: 99.6 -> 99.
export function displayPercent(value) {
  return Math.floor(value + 1e-9);
}

function _weekSets(week, notesById, declarationAware) {
  const note = notesById.get(week.note_id);
  if (!note || note.deleted_at || typeof note.raw_text !== 'string') return null;
  const parsed = parseWorkoutNote(note.raw_text);
  if (parsed.ok === false) return null;
  return collectRecoveryWeekSets(parsed.sections || [], { declarationAware });
}

// One lift in one readable week.
function _scoreLiftWeek(pair, entry) {
  if (!entry) return { state: LIFT_STATE.NOT_LOGGED };
  if (entry.exercise_class !== 'weighted') return { state: LIFT_STATE.UNSCOREABLE, reason: 'class_changed' };
  if (entry.timed_header) return { state: LIFT_STATE.UNSCOREABLE, reason: 'loaded_duration' };
  const best = bestEpleySet(entry.completed);
  if (!best) {
    const assisted = entry.completed.some(s => s.assistance_value != null && s.assistance_value !== 0);
    return { state: LIFT_STATE.UNSCOREABLE, reason: assisted ? 'assisted' : 'no_scoreable_set' };
  }
  const percent = (100 * best.e1rm) / pair.e1rm;
  if (!Number.isFinite(percent)) return { state: LIFT_STATE.UNSCOREABLE, reason: 'no_scoreable_set' };
  return { state: LIFT_STATE.SCORED, percent, best };
}

// Best-case pace for one lift as of the selected week. `points` are this lift's
// scored weeks through the selection, ascending by week ordinal.
export function deriveLiftPace(points, selectedWeekNumber) {
  const last = points[points.length - 1];
  if (!last || last.week_number !== selectedWeekNumber) return { status: PACE_STATUS.NO_CURRENT };
  const window = points.slice(-PACE_WINDOW);
  const current = last.percent;
  const targets = PACE_TARGETS.map(target => ({ target, reached: current >= target, weeks: null }));
  if (window.length < PACE_MIN_POINTS) return { status: PACE_STATUS.INSUFFICIENT, current, targets };
  const gains = [];
  for (let i = 1; i < window.length; i++) {
    gains.push((window[i].percent - window[i - 1].percent) / (window[i].week_number - window[i - 1].week_number));
  }
  const gain = gains.reduce((a, b) => a + b, 0) / gains.length;
  const from = window[0].week_number;
  const base = { current, gain, from_week: from, to_week: last.week_number };
  if (targets.every(t => t.reached)) return { status: PACE_STATUS.REACHED, ...base, targets };
  if (!(gain > 0) || !Number.isFinite(gain)) return { status: PACE_STATUS.NO_GAIN, ...base, targets };
  return {
    status: PACE_STATUS.ESTIMATE,
    ...base,
    targets: targets.map(t => (t.reached ? t : { ...t, weeks: Math.ceil(Math.max(0, t.target - current) / gain) })),
  };
}

function _mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// Derive everything the strength view shows for one block, as of one week.
// `selectedWeekId` defaults to the latest live week. `stale` suppresses pace and
// any trend-change conclusion (never computed off an unverified read).
export function deriveRecoveryStrength({ block, weeks = [], notes = [], selectedWeekId = null, stale = false } = {}) {
  const baseline = block && block.baseline;
  const head = (status) => ({ status, weeks: [], lifts: [], cohort: [], headline: null, not_retested: [], not_scored: [] });
  if (!baseline) return head(STRENGTH_STATUS.BASELINE_UNAVAILABLE);
  if (!RECOVERY_BASELINE_SUPPORTED_VERSIONS.includes(baseline.version)) return head(STRENGTH_STATUS.BASELINE_UNSUPPORTED);
  if (!Array.isArray(baseline.exercises)) return head(STRENGTH_STATUS.BASELINE_UNAVAILABLE);

  const roster = baseline.exercises;
  const upgraded = !baselineLacksStrengthData(baseline);
  // Baseline rows that can never be scored, with their reason (shown once).
  const not_scored = [];
  const scoreable = [];
  for (const row of roster) {
    const pair = baselineStrengthPair(row);
    if (pair) scoreable.push({ row, pair });
    else {
      const reason = row.exercise_class !== 'weighted' ? row.exercise_class : upgraded ? 'no_baseline_set' : 'pair_missing';
      not_scored.push({ key: row.key, name: row.name || row.key, reason });
    }
  }
  if (scoreable.length === 0 && baselineLacksStrengthData(baseline)) {
    return { ...head(STRENGTH_STATUS.PAIR_UNAVAILABLE), roster_size: roster.length };
  }

  const notesById = new Map((notes || []).filter(n => n && n.id).map(n => [n.id, n]));
  const live = orderedLiveWeeks(weeks, block.id);
  if (live.length === 0) return { ...head(STRENGTH_STATUS.NO_WEEKS), roster_size: roster.length, not_scored };
  const found = selectedWeekId ? live.findIndex(w => w.id === selectedWeekId) : -1;
  const through = live.slice(0, (found < 0 ? live.length - 1 : found) + 1);
  const selected = through[through.length - 1];

  // Per week: readable? and each scoreable lift's result.
  const declarationAware = baseline.version >= 2;
  const perWeek = through.map(w => {
    const sets = _weekSets(w, notesById, declarationAware);
    if (!sets) return { week: w, readable: false, results: null };
    const results = new Map(scoreable.map(({ row, pair }) => [row.key, _scoreLiftWeek(pair, sets.get(row.key) || null)]));
    return { week: w, readable: true, results };
  });
  const readable = perWeek.filter(p => p.readable);

  // The ONE cohort: lifts scored in every readable week through the selection.
  const inEvery = (upto) => scoreable.filter(({ row }) => upto.length > 0
    && upto.every(p => p.results.get(row.key).state === LIFT_STATE.SCORED));
  const cohortRows = inEvery(readable);
  const cohortKeys = new Set(cohortRows.map(({ row }) => row.key));
  // Coverage change vs the cohort as of the previous readable week (disclosed).
  const prevCohort = readable.length > 1 ? inEvery(readable.slice(0, -1)) : null;
  const cohort_dropped = prevCohort ? prevCohort.filter(({ row }) => !cohortKeys.has(row.key)).map(({ row }) => row.name || row.key) : [];

  const trend = perWeek.map(p => ({
    week_id: p.week.id,
    week_number: p.week.week_number,
    readable: p.readable,
    mean: p.readable && cohortRows.length > 0 ? _mean(cohortRows.map(({ row }) => p.results.get(row.key).percent)) : null,
  }));
  const selectedTrend = trend[trend.length - 1];

  // Per-lift ladder for the selected week plus pace, in routine order.
  const lifts = scoreable.map(({ row, pair }) => {
    const points = readable
      .filter(p => p.results.get(row.key).state === LIFT_STATE.SCORED)
      .map(p => ({ week_number: p.week.week_number, percent: p.results.get(row.key).percent }));
    const sel = perWeek[perWeek.length - 1];
    const result = sel.readable ? sel.results.get(row.key) : { state: LIFT_STATE.UNKNOWN };
    return {
      key: row.key,
      name: row.name || row.key,
      baseline: { weight: pair.weight, reps: pair.reps },
      state: result.state,
      reason: result.reason || null,
      percent: result.percent ?? null,
      best: result.best ? { weight: result.best.weight, reps: result.best.reps } : null,
      in_cohort: cohortKeys.has(row.key),
      pace: stale ? { status: PACE_STATUS.SUPPRESSED } : deriveLiftPace(points, selected.week_number),
    };
  });

  // Not retested: scoreable lifts with no completed entry in the selected week.
  const unreadableSeen = perWeek.some(p => !p.readable);
  const not_retested = lifts.filter(l => l.state === LIFT_STATE.NOT_LOGGED || l.state === LIFT_STATE.UNKNOWN).map(l => {
    const loggedBefore = readable.some(p => p.results.get(l.key).state !== LIFT_STATE.NOT_LOGGED);
    const kind = loggedBefore ? NOT_RETESTED.ABSENT_THIS_WEEK
      : unreadableSeen ? NOT_RETESTED.UNKNOWN : NOT_RETESTED.NEVER_LOGGED;
    return { key: l.key, name: l.name, kind };
  });

  return {
    status: STRENGTH_STATUS.OK,
    roster_size: roster.length,
    scoreable_size: scoreable.length,
    selected: { week_id: selected.id, week_number: selected.week_number, readable: perWeek[perWeek.length - 1].readable },
    weeks: trend,
    excluded_weeks: perWeek.filter(p => !p.readable).map(p => p.week.week_number),
    cohort: cohortRows.map(({ row }) => ({ key: row.key, name: row.name || row.key })),
    cohort_dropped: stale ? [] : cohort_dropped,
    headline: selectedTrend.mean,
    empty_reason: readable.length === 0 ? 'no_readable_weeks'
      : cohortRows.length === 0 ? 'no_common_lifts'
        : !selectedTrend.readable ? 'selected_unreadable' : null,
    lifts,
    not_retested,
    not_scored,
  };
}

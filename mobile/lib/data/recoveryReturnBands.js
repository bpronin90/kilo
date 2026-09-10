// Recovery return bands and weekly movement (#1029).
//
// A pure consumer of `deriveRecoveryComparison`'s (#697) existing per-exercise
// output. No field of that contract changes here and `RECOVERY_ANALYTICS_VERSION`
// is not bumped: this module only re-groups rows that contract already produces
// into the band/movement shapes the Recovery surfaces render.
//
// Nothing here computes a mean across dimensions or families, and nothing here
// produces a single composite percentage for a week or a block (#697 Out of
// Scope, restated by #1029).

import {
  RECOVERY_COMPARISON_STATES,
  RECOVERY_UNAVAILABLE_REASONS,
  RECOVERY_WEEK_STATUS,
} from './recoveryAnalytics';

// The design's only authored thresholds (#1023 v2 §2, Amendment A).
export const RETURN_BAND_CLOSE = 0.90;
export const RETURN_BAND_REBUILDING = 0.50;

// Ordered band identifiers and their labels. `not_trained_yet` is still an
// emitted bucket (the six buckets sum to the roster every week) but every
// surface renders it as a denominator caption, never a bucket row/bar — see
// `AnalyticsRecoverySection.js` and `homeDashboardData.js`.
export const RETURN_BANDS = Object.freeze([
  { id: 'at_or_above', label: 'At or above' },
  { id: 'close', label: 'Close' },
  { id: 'rebuilding', label: 'Rebuilding' },
  { id: 'early', label: 'Early' },
  { id: 'cannot_compare', label: "Can't compare" },
  { id: 'not_trained_yet', label: 'Not trained yet' },
]);

// Duplicated from #697's private `_metricRow` epsilon rather than imported:
// `recoveryAnalytics.js` is deliberately excluded from this issue's Allowed
// Files and does not export it. Same value, same purpose — a float sum whose
// term order differs between baseline and week can land a few ULPs short of
// an exact tie, and that must read as a tie here too.
const MOVEMENT_EPSILON = 1e-9;

// Display labels for `most_common_gap`, matching the labels already shown in
// `AnalyticsRecoverySection.js`'s per-dimension detail rows (Load, Total work,
// Reps, Time). Kept local: the dimension *order* for a given exercise still
// comes from `row.metrics` (which `_compareExercise` already emits in
// `METRICS_BY_CLASS` order) — this is only the display string.
const GAP_LABELS = Object.freeze({
  top_load: 'Load',
  volume: 'Total work',
  total_reps: 'Reps',
  total_seconds: 'Time',
});

function _emptyBuckets() {
  return {
    at_or_above: 0,
    close: 0,
    rebuilding: 0,
    early: 0,
    not_trained_yet: 0,
    cannot_compare: 0,
  };
}

// `roster (B)` = baseline rows minus rows whose `unavailable_reason` is
// `baseline_value_unusable` (#1029 contract). That decision is a property of
// the frozen snapshot, not of any one week, but it is only visible on a row
// once a week's comparison has been run against it — so it is read off each
// week's own `exercises` list.
function _isRosterRow(row) {
  return !(
    row.state === RECOVERY_COMPARISON_STATES.NOT_COMPARABLE &&
    row.unavailable_reason === RECOVERY_UNAVAILABLE_REASONS.BASELINE_VALUE_UNUSABLE
  );
}

// `exercise_return = min(ratio)` over the exercise's applicable dimensions —
// a selection, never a mean, never across families (#1029 contract, #1023 v2
// §5). Only meaningful for rows that carry ratios (baseline_met/rebuilding);
// callers only use this for rebuilding rows, where the band split is decided.
function _exerciseReturn(row) {
  const ratios = (row.metrics || [])
    .map(m => m.ratio)
    .filter(r => typeof r === 'number' && Number.isFinite(r));
  if (ratios.length === 0) return null;
  return Math.min(...ratios);
}

// Amendment A: the top band is defined by the row's own SOURCE STATE
// (`baseline_met`), never by its own `exercise_return >= 1` — so a lift that
// is epsilon-short of 1.0 but already flagged `met` by #697 still bands
// `at_or_above`, agreeing with its own detail row (adversarial fixture 18).
function _bandForRow(row) {
  if (row.state === RECOVERY_COMPARISON_STATES.BASELINE_MET) return 'at_or_above';
  if (row.state === RECOVERY_COMPARISON_STATES.NOT_REINTRODUCED) return 'not_trained_yet';
  if (row.state === RECOVERY_COMPARISON_STATES.NOT_COMPARABLE) return 'cannot_compare';
  if (row.state === RECOVERY_COMPARISON_STATES.REBUILDING) {
    const ret = _exerciseReturn(row);
    if (ret !== null && ret >= RETURN_BAND_CLOSE) return 'close';
    if (ret !== null && ret >= RETURN_BAND_REBUILDING) return 'rebuilding';
    return 'early';
  }
  // ADDED_DURING_RECOVERY rows are never roster rows, so this is unreachable
  // for any row this module is handed — kept defensive rather than throwing.
  return null;
}

function _assertBucketsSumToRoster(buckets, roster_size) {
  const sum = Object.values(buckets).reduce((a, b) => a + b, 0);
  if (sum !== roster_size) {
    throw new Error(
      `recoveryReturnBands: buckets summed to ${sum}, expected roster_size ${roster_size}`
    );
  }
}

// `most_common_gap` = the single strictly-most-common unmet dimension among
// this week's `rebuilding` rows; `null` on any tie and when nothing is unmet.
// "most lifts" is forbidden copy — callers must render the label, never that
// phrase (#1023 v2 §8).
function _mostCommonGap(rosterRows) {
  const counts = new Map();
  for (const row of rosterRows) {
    if (row.state !== RECOVERY_COMPARISON_STATES.REBUILDING) continue;
    for (const dim of row.unmet || []) {
      counts.set(dim, (counts.get(dim) || 0) + 1);
    }
  }
  if (counts.size === 0) return null;
  let best = null;
  let bestCount = 0;
  let tie = false;
  for (const [dim, count] of counts) {
    if (count > bestCount) {
      best = dim;
      bestCount = count;
      tie = false;
    } else if (count === bestCount) {
      tie = true;
    }
  }
  if (tie || !best) return null;
  return GAP_LABELS[best] || best;
}

// One live week's six-bucket derivation against the roster, plus the trained
// total every bucket row is sized against (#1029).
//
// `week` is one entry of `deriveRecoveryComparison(...).weeks` — i.e. it
// carries `status` (`RECOVERY_WEEK_STATUS`) and, when readable, `exercises`.
// A week whose note is missing or unreadable has no roster evidence at all:
// `buckets` comes back `null` and `reason` names why, matching how
// `deriveRecoveryBandSeries` renders that week as a gap, never a zero.
export function deriveRecoveryWeekBands(week) {
  if (!week || week.status !== RECOVERY_WEEK_STATUS.OK) {
    return {
      roster_size: 0,
      buckets: null,
      trained: 0,
      most_common_gap: null,
      reason: week ? week.status : 'note_missing',
    };
  }

  const rosterRows = (week.exercises || []).filter(_isRosterRow);
  const buckets = _emptyBuckets();
  for (const row of rosterRows) {
    const band = _bandForRow(row);
    if (band && buckets[band] !== undefined) buckets[band]++;
  }

  const roster_size = rosterRows.length;
  _assertBucketsSumToRoster(buckets, roster_size);

  const trained = roster_size - buckets.not_trained_yet;

  return {
    roster_size,
    buckets,
    trained,
    most_common_gap: _mostCommonGap(rosterRows),
    reason: null,
  };
}

// The exact roster population the sparse-sentence fallback (below four
// trained lifts) may name, and the exact population `trained` above is sized
// against: roster rows (`_isRosterRow` — excludes `baseline_value_unusable`)
// minus `not_trained_yet` rows. Exported so `AnalyticsRecoverySection.js` and
// `homeDashboardData.js` derive the sparse sentence from this single source
// of truth rather than re-filtering `week.exercises` with parallel logic that
// can drift from the bucket/denominator derivation above (#1029 review
// finding: a `baseline_value_unusable` row must never be named here, matching
// adversarial fixture 6's exclusion of it from the roster entirely; an
// `added_during_recovery` row is never in `week.exercises` to begin with —
// it lives in `week.added` — so it is already excluded by construction).
export function deriveRecoveryTrainedRows(week) {
  if (!week || week.status !== RECOVERY_WEEK_STATUS.OK) return [];
  return (week.exercises || [])
    .filter(_isRosterRow)
    .filter(row => row.state !== RECOVERY_COMPARISON_STATES.NOT_REINTRODUCED);
}

// A week qualifies as a movement anchor (or as "current") only when it is
// itself readable AND its comparable population — rows eligible to be
// matched — is non-empty. A `note_missing`/`note_unreadable`/no-comparable-
// work week is skipped when searching for an anchor, never treated as zero
// (#1023 v2 §4).
function _comparablePopulation(week) {
  if (!week || week.status !== RECOVERY_WEEK_STATUS.OK) return [];
  return (week.exercises || []).filter(
    row =>
      row.state === RECOVERY_COMPARISON_STATES.BASELINE_MET ||
      row.state === RECOVERY_COMPARISON_STATES.REBUILDING
  );
}

function _qualifies(week) {
  return _comparablePopulation(week).length > 0;
}

function _dimensionComparison(curRatio, anchorRatio) {
  const diff = curRatio - anchorRatio;
  if (diff > MOVEMENT_EPSILON) return 1;
  if (diff < -MOVEMENT_EPSILON) return -1;
  return 0;
}

// Per-exercise Pareto movement direction between the anchor and current rows
// of one matched exercise, on exact `ratio` with epsilon ties — never on
// floored percents (#1029 contract; adversarial fixture 11).
function _paretoDirection(anchorRow, currentRow) {
  const cmps = [];
  for (const curMetric of currentRow.metrics || []) {
    const anchorMetric = (anchorRow.metrics || []).find(m => m.metric === curMetric.metric);
    if (!anchorMetric || typeof curMetric.ratio !== 'number' || typeof anchorMetric.ratio !== 'number') {
      continue;
    }
    cmps.push(_dimensionComparison(curMetric.ratio, anchorMetric.ratio));
  }
  if (cmps.length === 0) return 'steady';
  const everyImprovedOrSame = cmps.every(c => c >= 0);
  const everyWorseOrSame = cmps.every(c => c <= 0);
  if (everyImprovedOrSame && cmps.some(c => c > 0)) return 'improved';
  if (everyWorseOrSame && cmps.some(c => c < 0)) return 'fell_back';
  return 'steady';
}

// Movement since the most recent earlier QUALIFYING week, per-exercise Pareto
// on the matched (comparable-in-both-weeks) population (#1023 v2 §4, #1029
// contract). Returns `null` — never zero counts — whenever the evidence bar
// for printing movement at all is unmet:
//   1. fewer than two qualifying live weeks exist;
//   2. matched.length < 3 (unless the roster itself has fewer than 3 rows,
//      in which case matched must equal the whole roster);
//   3. no qualifying anchor exists before `currentWeekId`.
// (The fourth requirement — recovery state must be `ready`, never derived off
// an unverified/stale snapshot — is enforced by the caller before this
// function is ever invoked, since readiness is not part of `weeks`.)
export function deriveRecoveryMovement(weeks, { currentWeekId } = {}) {
  const ordered = weeks || [];
  const currentIndex = ordered.findIndex(w => w.week_id === currentWeekId);
  if (currentIndex === -1) return null;
  const currentWeek = ordered[currentIndex];
  if (!_qualifies(currentWeek)) return null;

  const qualifyingWeeks = ordered.filter(_qualifies);
  if (qualifyingWeeks.length < 2) return null;

  let anchorWeek = null;
  for (let i = currentIndex - 1; i >= 0; i--) {
    if (_qualifies(ordered[i])) {
      anchorWeek = ordered[i];
      break;
    }
  }
  if (!anchorWeek) return null;

  const currentPopulation = _comparablePopulation(currentWeek);
  const anchorByKey = new Map(_comparablePopulation(anchorWeek).map(row => [row.key, row]));

  const matched = [];
  for (const row of currentPopulation) {
    const anchorRow = anchorByKey.get(row.key);
    if (anchorRow) matched.push({ anchorRow, currentRow: row });
  }

  const rosterSize = (currentWeek.exercises || []).filter(_isRosterRow).length;
  const minimumMatched = rosterSize < 3 ? rosterSize : 3;
  if (matched.length < minimumMatched || matched.length === 0) return null;

  const counts = { improved: 0, steady: 0, fell_back: 0 };
  for (const { anchorRow, currentRow } of matched) {
    counts[_paretoDirection(anchorRow, currentRow)]++;
  }

  return {
    improved: counts.improved,
    steady: counts.steady,
    fell_back: counts.fell_back,
    matched_size: matched.length,
    anchor_week_number: anchorWeek.week_number,
  };
}

// One band-strip entry per live week, in week order, for the Analytics-only
// "across weeks" element (#1023 v2 §3/§10c). Each readable week's buckets sum
// to the roster; an unreadable week has `buckets: null` so the strip renders
// a gap there, never a zero-height bar.
export function deriveRecoveryBandSeries(comparison) {
  const weeks = (comparison && comparison.weeks) || [];
  return weeks.map(week => {
    const bands = deriveRecoveryWeekBands(week);
    return {
      week_id: week.week_id,
      week_number: week.week_number,
      buckets: week.status === RECOVERY_WEEK_STATUS.OK ? bands.buckets : null,
    };
  });
}

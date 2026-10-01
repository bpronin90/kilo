import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { displayWeight, formatLiftWeightValue } from '../../lib/units';
import { formatDuration } from '../../lib/format';
import { RECOVERY_COMPARISON_STATES, RECOVERY_WEEK_STATUS } from '../../lib/data/recoveryAnalytics';
import { deriveRecoveryWeekBands } from '../../lib/data/recoveryReturnBands';
import { createStyles } from './analyticsRecoveryStyles';
import { createVisualStyles } from './recoveryVisualStyles';
import { bandColor } from './RecoveryVisuals';

// "Total work" replaces the unexplained "Volume" (#758): the number is a sum of
// load × reps, and the label now says so rather than borrowing a training term
// the app never defines.
const METRIC_LABELS = Object.freeze({
  top_load: 'Load',
  volume: 'Total work',
  total_reps: 'Reps',
  total_seconds: 'Time',
});

// Two forms of the same fact (#821). The short form is what a sighted reader
// scans; the long form is still spoken, because a screen-reader user cannot
// glance at the surrounding rows to infer what "No comparable metric" meant.
const UNAVAILABLE_REASON_TEXT = Object.freeze({
  exercise_class_changed: 'Logged as a different kind of exercise than the baseline.',
  no_comparable_metric: "This week's entry has no usable Load, Total work, Reps, or Time value.",
  baseline_value_unusable: 'The frozen baseline value for this exercise is unusable.',
});

const UNAVAILABLE_REASON_SHORT = Object.freeze({
  exercise_class_changed: 'Different exercise type',
  no_comparable_metric: 'No comparable metric',
  baseline_value_unusable: 'Baseline unusable',
});

// Rows are ordered by state instead of sitting under counted headings (#1219):
// every row now carries its own band mark and status word, so a heading would
// only repeat it. Baseline-met leads (it answers "which exercises are back"),
// then rebuilding, not reintroduced, not comparable, then added work last.
const DETAIL_GROUP_ORDER = Object.freeze([
  RECOVERY_COMPARISON_STATES.BASELINE_MET,
  RECOVERY_COMPARISON_STATES.REBUILDING,
  RECOVERY_COMPARISON_STATES.NOT_REINTRODUCED,
  RECOVERY_COMPARISON_STATES.NOT_COMPARABLE,
  RECOVERY_COMPARISON_STATES.ADDED_DURING_RECOVERY,
]);

// Plain-word status shown beside the band-colored mark (#1219) — never color
// alone, no abbreviations. Words follow the card's own band legend.
const BAND_STATUS_WORD = Object.freeze({
  at_or_above: 'At or above baseline',
  close: 'Close to baseline',
  rebuilding: 'Rebuilding',
  early: 'Early',
  cannot_compare: "Can't compare",
  not_trained_yet: 'Not trained yet',
});

// The row's band comes from the existing return-band derivation run on this one
// row (never a second threshold implementation). Added work has no band and
// takes the neutral accent mark.
export function rowBandId(row) {
  if (row.state === RECOVERY_COMPARISON_STATES.ADDED_DURING_RECOVERY) return null;
  const { buckets } = deriveRecoveryWeekBands({ status: RECOVERY_WEEK_STATUS.OK, exercises: [row] });
  return Object.keys(buckets).find(id => buckets[id] > 0) || 'cannot_compare';
}

// ONE mapping feeds both the visible status word and the spoken label, so a
// screen reader hears exactly the status a sighted user sees (#1219).
export function rowStatusWord(row) {
  const bandId = rowBandId(row);
  return bandId ? BAND_STATUS_WORD[bandId] : 'Added during recovery';
}

function _formatMetricNumber(metricKey, value, unit) {
  if (value === null || value === undefined) return '—';
  if (metricKey === 'top_load') return `${formatLiftWeightValue(value, unit)} ${unit}`;
  if (metricKey === 'volume') return `${Math.round(displayWeight(value, unit))} ${unit}`;
  if (metricKey === 'total_reps') return `${value} reps`;
  if (metricKey === 'total_seconds') return formatDuration(value);
  return String(value);
}

// Full accessible description of one exercise row, for VoiceOver/TalkBack.
// The row collapses its children into a single accessible element (below), so
// the status word alone is not enough — the Load/Volume/Reps/Time evidence and any
// unavailable/not-reintroduced explanation must be spoken too, since that
// evidence is the entire point of this surface (#698 review).
function _absentNote(row, weekNumber, elsewhere) {
  const weeks = elsewhere?.weeks.get(row.key);
  const here = weekNumber == null ? 'this week' : `Week ${weekNumber}`;
  // A stale snapshot may have lost or gained other weeks' work, so it makes no
  // cross-week claim in either direction.
  if (elsewhere?.stale) return `Not in ${here}`;
  return weeks && weeks.length > 0
    ? `Not in ${here} · trained in ${weeks.map(n => `Week ${n}`).join(', ')}`
    : elsewhere?.unreadable ? 'Not trained in any readable linked week' : 'Not trained in any linked week';
}

// #1202: display-only explanation; state and counts stay exact-key.
function _mismatchNote(row) {
  if (row.likely_logged_name) {
    return `Logged as "${row.likely_logged_name}" this week — names differ, so no direct comparison was made.`;
  }
  if (row.likely_baseline_name) {
    return `Baseline has "${row.likely_baseline_name}" — names differ, so no direct comparison was made.`;
  }
  return null;
}

function _rowAccessibilityLabel(row, unit, weekNumber, elsewhere) {
  const parts = [`${row.name}, ${rowStatusWord(row)}`];

  if (
    row.state === RECOVERY_COMPARISON_STATES.BASELINE_MET ||
    row.state === RECOVERY_COMPARISON_STATES.REBUILDING
  ) {
    for (const m of row.metrics) {
      parts.push(
        `${METRIC_LABELS[m.metric] || m.metric} ${m.percent}%, ${_formatMetricNumber(m.metric, m.current, unit)} of ${_formatMetricNumber(m.metric, m.baseline, unit)} baseline`
      );
    }
  } else if (row.state === RECOVERY_COMPARISON_STATES.ADDED_DURING_RECOVERY) {
    for (const m of row.metrics) {
      parts.push(`${METRIC_LABELS[m.metric] || m.metric} ${_formatMetricNumber(m.metric, m.current, unit)}`);
    }
  } else if (row.state === RECOVERY_COMPARISON_STATES.NOT_COMPARABLE) {
    parts.push(UNAVAILABLE_REASON_TEXT[row.unavailable_reason] || 'This exercise could not be compared.');
  } else if (row.state === RECOVERY_COMPARISON_STATES.NOT_REINTRODUCED) {
    parts.push(_absentNote(row, weekNumber, elsewhere));
    parts.push(
      `Baseline ${row.metrics.map(m => `${METRIC_LABELS[m.metric]} ${_formatMetricNumber(m.metric, m.baseline, unit)}`).join(', ')}`
    );
  }

  const mismatch = _mismatchNote(row);
  if (mismatch) parts.push(mismatch);

  return parts.join('. ');
}

// One bar per row: the limiting dimension (lowest ratio), the same selection
// the band itself is decided on — a choice among existing metrics, not a mean.
function _barMetric(row) {
  const metrics = row.metrics || [];
  if (metrics.length === 0) return null;
  const score = m => (typeof m.ratio === 'number' ? m.ratio : (m.percent ?? 0) / 100);
  return metrics.reduce((lo, m) => (score(m) < score(lo) ? m : lo), metrics[0]);
}

function _numbers(row, unit) {
  const metrics = row.metrics || [];
  const label = m => METRIC_LABELS[m.metric] || m.metric;
  if (row.state === RECOVERY_COMPARISON_STATES.BASELINE_MET || row.state === RECOVERY_COMPARISON_STATES.REBUILDING) {
    return metrics.map(m => `${label(m)} ${_formatMetricNumber(m.metric, m.current, unit)} / ${_formatMetricNumber(m.metric, m.baseline, unit)}`);
  }
  if (row.state === RECOVERY_COMPARISON_STATES.ADDED_DURING_RECOVERY) {
    return metrics.map(m => `${label(m)} ${_formatMetricNumber(m.metric, m.current, unit)}`);
  }
  if (row.state === RECOVERY_COMPARISON_STATES.NOT_REINTRODUCED) {
    return metrics.map(m => `Baseline ${label(m)} ${_formatMetricNumber(m.metric, m.baseline, unit)}`);
  }
  return [];
}

function ExerciseRow({ row, unit, weekNumber, elsewhere }) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createVisualStyles(colors, kua), [colors, kua]);
  const bandId = rowBandId(row);
  const markColor = bandId ? bandColor(bandId, colors, kua) : (kua ? kua.primary : colors.accentText);
  const status = rowStatusWord(row);
  const compared =
    row.state === RECOVERY_COMPARISON_STATES.BASELINE_MET ||
    row.state === RECOVERY_COMPARISON_STATES.REBUILDING;
  const barMetric = compared ? _barMetric(row) : null;
  // Fill is capped at 100% so a lifter who came back stronger doesn't overflow
  // the bar; the percent text is never capped (#698).
  const fillPct = barMetric ? Math.max(0, Math.min(barMetric.percent ?? 0, 100)) : 0;
  const numbers = _numbers(row, unit);
  const note = row.state === RECOVERY_COMPARISON_STATES.NOT_COMPARABLE
    ? (UNAVAILABLE_REASON_SHORT[row.unavailable_reason] || 'Could not be compared')
    : null;
  // Names only, never the full "— names differ, so no direct comparison was
  // made" sentence (it stays in the accessible label).
  const nameNote = row.likely_logged_name
    ? `Logged as “${row.likely_logged_name}”`
    : row.likely_baseline_name ? `Baseline has “${row.likely_baseline_name}”` : null;

  return (
    <View
      testID="recovery-exercise-row"
      style={styles.exRow}
      accessible
      accessibilityLabel={_rowAccessibilityLabel(row, unit, weekNumber, elsewhere)}
    >
      <View style={styles.exHeader}>
        <Text style={styles.exName}>{row.name}</Text>
        <View style={styles.exStatus}>
          <View testID="recovery-exercise-mark" style={[styles.exStatusDot, { backgroundColor: markColor }]} />
          <Text style={styles.exStatusText}>{status}</Text>
        </View>
      </View>

      {barMetric && (
        <View style={styles.exBarRow}>
          <View testID="recovery-exercise-bar" style={styles.exBarTrack}>
            <View style={[styles.exBarFill, { width: `${fillPct}%`, backgroundColor: markColor }]} />
          </View>
          <Text style={styles.exPercent}>{`${barMetric.percent}%`}</Text>
        </View>
      )}

      {numbers.length > 0 && (
        <View style={styles.exNumbers}>
          {numbers.map(n => <Text key={n} style={styles.exNumberText}>{n}</Text>)}
        </View>
      )}

      {!!note && <Text style={styles.exNote}>{note}</Text>}
      {!!nameNote && <Text style={styles.exNote}>{nameNote}</Text>}
    </View>
  );
}

// A week whose linked note is gone or unreadable says so above the details
// disclosure, never inside it: a collapsed panel must not be the reason a lifter
// cannot see that this week has no readable evidence at all (#758).
export function WeekUnavailableNotice({ week }) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStyles(colors, kua), [colors, kua]);
  if (!week) return null;

  if (week.status === RECOVERY_WEEK_STATUS.NOTE_MISSING) {
    return (
      <Text style={styles.unavailablePanelText}>
        {`Week ${week.week_number} — This week's note is no longer available.`}
      </Text>
    );
  }
  if (week.status === RECOVERY_WEEK_STATUS.NOTE_UNREADABLE) {
    return (
      <Text style={styles.unavailablePanelText}>
        {`Week ${week.week_number} — This week's note couldn't be read.`}
      </Text>
    );
  }
  return null;
}

export function WeekEvidence({ rows, unit, weekNumber, elsewhere }) {
  const ordered = DETAIL_GROUP_ORDER.flatMap(state => rows.filter(row => row.state === state));
  return (
    <View testID="recovery-exercise-list">
      {ordered.map(row => (
        <ExerciseRow key={row.key} row={row} unit={unit} weekNumber={weekNumber} elsewhere={elsewhere} />
      ))}
    </View>
  );
}

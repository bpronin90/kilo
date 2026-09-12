import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';
import { displayWeight, formatLiftWeightValue } from '../../lib/units';
import { formatDuration } from '../../lib/format';
import { RECOVERY_COMPARISON_STATES, RECOVERY_WEEK_STATUS } from '../../lib/data/recoveryAnalytics';
import { createStyles } from './analyticsRecoveryStyles';

// "Total work" replaces the unexplained "Volume" (#758): the number is a sum of
// load × reps, and the label now says so rather than borrowing a training term
// the app never defines.
const METRIC_LABELS = Object.freeze({
  top_load: 'Load',
  volume: 'Total work',
  total_reps: 'Reps',
  total_seconds: 'Time',
});

// Shown with the details, so the two weighted dimensions are never read as an
// all-time max or an estimated 1RM (#758). Both describe exactly what #697
// computes: the heaviest completed working set, and load × reps summed over the
// completed working sets of that week.
const METRIC_EXPLANATIONS = Object.freeze({
  top_load: 'Load — the heaviest completed working set that week. Not an all-time max or an estimated 1RM.',
  volume: 'Total work — load × reps across that week\'s completed working sets.',
});

const STATE_META = Object.freeze({
  [RECOVERY_COMPARISON_STATES.BASELINE_MET]: { label: 'Baseline met', dot: 'success' },
  [RECOVERY_COMPARISON_STATES.REBUILDING]: { label: 'Rebuilding', dot: 'caution' },
  [RECOVERY_COMPARISON_STATES.NOT_REINTRODUCED]: { label: 'Not reintroduced', dot: 'muted' },
  [RECOVERY_COMPARISON_STATES.NOT_COMPARABLE]: { label: 'Not comparable', dot: 'error' },
  [RECOVERY_COMPARISON_STATES.ADDED_DURING_RECOVERY]: { label: 'Added during recovery', dot: 'accent' },
});

// Two forms of the same fact (#821). The panel was carrying a full sentence on
// every un-comparable row, which is what made a dense evidence surface read as
// a wall of prose. The short form is what a sighted reader scans; the long form
// is unchanged and still spoken, because a screen-reader user cannot glance at
// the surrounding table to infer what "No comparable metric" meant.
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

// Replaces the removed status-filter chips (#793/R5b): every row is always
// shown, grouped under a counted, screen-reader-navigable heading instead of
// hidden behind a mode the user has to enter and exit. Baseline-met leads
// (it answers "which exercises are back"), then the R3a clause order
// (rebuilding, not reintroduced, not comparable) that already governs the
// merged summary line, then added-during-recovery work last.
const DETAIL_GROUP_ORDER = Object.freeze([
  RECOVERY_COMPARISON_STATES.BASELINE_MET,
  RECOVERY_COMPARISON_STATES.REBUILDING,
  RECOVERY_COMPARISON_STATES.NOT_REINTRODUCED,
  RECOVERY_COMPARISON_STATES.NOT_COMPARABLE,
  RECOVERY_COMPARISON_STATES.ADDED_DURING_RECOVERY,
]);

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
// the state chip alone is not enough — the Load/Volume/Reps/Time evidence and
// any unavailable/not-reintroduced explanation must be spoken too, since that
// evidence is the entire point of this surface (#698 review).
function _rowAccessibilityLabel(row, unit) {
  const meta = STATE_META[row.state] || STATE_META[RECOVERY_COMPARISON_STATES.NOT_REINTRODUCED];
  const parts = [`${row.name}, ${meta.label}`];

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
    parts.push(
      `Baseline ${row.metrics.map(m => `${METRIC_LABELS[m.metric]} ${_formatMetricNumber(m.metric, m.baseline, unit)}`).join(', ')}`
    );
  }

  return parts.join('. ');
}

function MetricCell({ metric, unit }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  // Visual fill is capped at 100% (`cappedPct`) so a lifter who came back
  // stronger doesn't overflow the bar, but the exact percent text is never
  // capped — a value above baseline stays numerically visible (#698).
  const cappedPct = Math.max(0, Math.min(metric.percent ?? 0, 100));
  return (
    <View style={styles.metricCell}>
      <View style={styles.metricHeaderRow}>
        <Text style={styles.metricLabel}>{METRIC_LABELS[metric.metric] || metric.metric}</Text>
        <Text style={[styles.metricPercent, metric.met ? styles.metricPercentMet : null]}>
          {metric.percent}%
        </Text>
      </View>
      <View style={styles.meterTrack}>
        <View
          style={[
            styles.meterFill,
            { width: `${cappedPct}%`, backgroundColor: metric.met ? colors.success : colors.caution },
          ]}
        />
      </View>
      <Text style={styles.metricNumbers}>
        {_formatMetricNumber(metric.metric, metric.current, unit)} / {_formatMetricNumber(metric.metric, metric.baseline, unit)}
      </Text>
    </View>
  );
}

function ExerciseRow({ row, unit }) {
  const styles = useThemedStyles(createStyles);
  const meta = STATE_META[row.state] || STATE_META[RECOVERY_COMPARISON_STATES.NOT_REINTRODUCED];
  const showComparedMetrics =
    row.state === RECOVERY_COMPARISON_STATES.BASELINE_MET ||
    row.state === RECOVERY_COMPARISON_STATES.REBUILDING;
  const showAddedMetrics = row.state === RECOVERY_COMPARISON_STATES.ADDED_DURING_RECOVERY;

  return (
    <View
      style={styles.exerciseRow}
      accessible
      accessibilityLabel={_rowAccessibilityLabel(row, unit)}
    >
      <View style={styles.exerciseRowHeader}>
        <Text style={styles.exerciseRowName} numberOfLines={1}>{row.name}</Text>
        <View style={styles.stateChip}>
          <View style={[styles.stateDot, styles[`stateDot_${meta.dot}`]]} />
          <Text style={styles.stateChipText}>{meta.label}</Text>
        </View>
      </View>

      {showComparedMetrics && (
        <View style={styles.metricsRow}>
          {row.metrics.map(m => <MetricCell key={m.metric} metric={m} unit={unit} />)}
        </View>
      )}

      {showAddedMetrics && (
        <View style={styles.metricsRow}>
          {row.metrics.map(m => (
            <View key={m.metric} style={styles.metricCell}>
              <Text style={styles.metricLabel}>{METRIC_LABELS[m.metric] || m.metric}</Text>
              <Text style={styles.addedMetricValue}>{_formatMetricNumber(m.metric, m.current, unit)}</Text>
            </View>
          ))}
        </View>
      )}

      {row.state === RECOVERY_COMPARISON_STATES.NOT_COMPARABLE && (
        <Text style={styles.unavailableText}>
          {UNAVAILABLE_REASON_SHORT[row.unavailable_reason] || 'Could not be compared'}
        </Text>
      )}

      {row.state === RECOVERY_COMPARISON_STATES.NOT_REINTRODUCED && (
        <Text style={styles.unavailableText}>
          {`Baseline · ${row.metrics.map(m => `${METRIC_LABELS[m.metric]} ${_formatMetricNumber(m.metric, m.baseline, unit)}`).join(' · ')}`}
        </Text>
      )}
    </View>
  );
}

// A week whose linked note is gone or unreadable says so above the details
// disclosure, never inside it: a collapsed panel must not be the reason a lifter
// cannot see that this week has no readable evidence at all (#758).
export function WeekUnavailableNotice({ week }) {
  const styles = useThemedStyles(createStyles);
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

// Only the dimensions actually on screen are explained. A week of reps-only and
// timed work has nothing to disambiguate, so it gets no legend — and neither
// does a not-comparable row, which prints its reason instead of any metric.
export function MetricLegend({ rows }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  // Behind a disclosure rather than printed above every expansion (#821). The
  // definitions still matter — they are why "Total work" replaced the
  // undefined "Volume" in #758 — but they are read once and then known, and
  // permanent prose at the head of a data panel is what made this surface feel
  // like reading rather than looking. Same affordance the 1K card already uses
  // for "How is this calculated?".
  const [expanded, setExpanded] = useState(false);

  const shown = new Set();
  for (const row of rows) {
    if (row.state === RECOVERY_COMPARISON_STATES.NOT_COMPARABLE) continue;
    for (const metric of row.metrics || []) shown.add(metric.metric);
  }
  const lines = ['top_load', 'volume'].filter(m => shown.has(m)).map(m => METRIC_EXPLANATIONS[m]);
  if (lines.length === 0) return null;

  return (
    <View style={styles.legend}>
      <Pressable
        onPress={() => setExpanded(e => !e)}
        style={styles.legendToggle}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={expanded ? 'Hide what these measurements mean' : 'What do these measurements mean?'}
      >
        <Text style={styles.legendToggleText}>What do these mean?</Text>
        <MaterialIcons
          name={expanded ? 'expand-less' : 'expand-more'}
          size={16}
          color={colors.textMuted}
          accessible={false}
        />
      </Pressable>
      {expanded && lines.map(line => <Text key={line} style={styles.legendText}>{line}</Text>)}
    </View>
  );
}

// One state's rows under a counted, screen-reader-navigable heading — the
// replacement for what the removed status-filter chips did for sighted users
// (#793/R5b). Renders nothing when this block's focused week has no rows in
// this state, so an empty group never takes a slot.
function StateGroup({ state, rows, unit }) {
  const styles = useThemedStyles(createStyles);
  if (!rows || rows.length === 0) return null;
  const meta = STATE_META[state] || STATE_META[RECOVERY_COMPARISON_STATES.NOT_REINTRODUCED];
  return (
    <View style={styles.detailGroup}>
      <Text style={styles.detailGroupLabel} accessibilityRole="header">
        {`${meta.label} (${rows.length})`}
      </Text>
      <View style={styles.rowList}>
        {rows.map(row => <ExerciseRow key={row.key} row={row} unit={unit} />)}
      </View>
    </View>
  );
}

export function WeekEvidence({ rows, unit }) {
  const styles = useThemedStyles(createStyles);
  const groups = new Map();
  for (const row of rows) {
    const list = groups.get(row.state);
    if (list) list.push(row);
    else groups.set(row.state, [row]);
  }

  return (
    <View style={styles.evidenceGroup}>
      {DETAIL_GROUP_ORDER.map(state => (
        <StateGroup key={state} state={state} rows={groups.get(state)} unit={unit} />
      ))}
    </View>
  );
}

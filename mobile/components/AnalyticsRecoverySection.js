// Analytics Recovery section (#698): renders the #697 return-to-baseline
// comparison contract for the active recovery block and, on request, any
// completed block from history. Read-only evidence display — no control here
// mutates a block or week, and nothing claims medical recovery. The hero is a
// factual exercise count ("X of Y baseline exercises met"), never a composite
// percentage or a completion gate.

import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Card, HeroMetric, SectionTitle } from './UI';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';
import { useWeightUnit } from '../lib/unitPreference';
import { displayWeight, formatLiftWeightValue } from '../lib/units';
import { formatDate, formatDuration } from '../lib/format';
import { findActiveBlock, isLiveRecord } from '../lib/data/recoveryBlocks';
import { parseWorkoutNote } from '../lib/parser/workoutNote';
import {
  RECOVERY_LOADING_MESSAGE,
  RECOVERY_STALE_MESSAGE,
  RECOVERY_UNVERIFIED_MESSAGE,
  useRecoveryBlockLifecycle,
} from '../hooks/entries/recoveryBlockHooks';
import {
  deriveRecoveryComparison,
  RECOVERY_COMPARISON_STATUS,
  RECOVERY_WEEK_STATUS,
  RECOVERY_COMPARISON_STATES,
} from '../lib/data/recoveryAnalytics';
import { RecoveryInclusionToggle } from './RecoveryInclusionToggle';

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
  top_load: 'Load is the heaviest completed working set that week — not an all-time max or an estimated 1RM.',
  volume: 'Total work is load × reps added up across every completed working set that week.',
});

const STATE_META = Object.freeze({
  [RECOVERY_COMPARISON_STATES.BASELINE_MET]: { label: 'Baseline met', dot: 'success' },
  [RECOVERY_COMPARISON_STATES.REBUILDING]: { label: 'Rebuilding', dot: 'caution' },
  [RECOVERY_COMPARISON_STATES.NOT_REINTRODUCED]: { label: 'Not reintroduced', dot: 'muted' },
  [RECOVERY_COMPARISON_STATES.NOT_COMPARABLE]: { label: 'Not comparable', dot: 'error' },
  [RECOVERY_COMPARISON_STATES.ADDED_DURING_RECOVERY]: { label: 'Added during recovery', dot: 'accent' },
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

const UNAVAILABLE_REASON_TEXT = Object.freeze({
  exercise_class_changed: 'Logged as a different kind of exercise than the baseline.',
  no_comparable_metric: "This week's entry has no usable Load, Total work, Reps, or Time value.",
  baseline_value_unusable: 'The frozen baseline value for this exercise is unusable.',
});

function _formatMetricNumber(metricKey, value, unit) {
  if (value === null || value === undefined) return '—';
  if (metricKey === 'top_load') return `${formatLiftWeightValue(value, unit)} ${unit}`;
  if (metricKey === 'volume') return `${Math.round(displayWeight(value, unit))} ${unit}`;
  if (metricKey === 'total_reps') return `${value} reps`;
  if (metricKey === 'total_seconds') return formatDuration(value);
  return String(value);
}

function _noteTitle(notesById, noteId) {
  const note = notesById.get(noteId);
  return note?.title || 'Untitled Routine';
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

function _weekNoteStatus(week, notesById) {
  const note = notesById.get(week.note_id);
  if (!note) return { kind: 'missing', title: null };
  const { ok } = parseWorkoutNote(note.raw_text || '');
  if (!ok) return { kind: 'unreadable', title: note.title || 'Untitled Routine' };
  return { kind: 'ok', title: note.title || 'Untitled Routine' };
}

function WeekIndexRow({ block, week, notesById, onNavigate }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { kind, title } = _weekNoteStatus(week, notesById);
  const isAvailable = kind === 'ok';

  const noteTitle = title;
  const stateText = !isAvailable
    ? 'Unavailable'
    : week.completed_at
      ? formatDate(week.completed_at)
      : 'In progress';

  const a11yLabel = [
    block.baseline_note_title || 'Untitled Routine',
    `Recovery Week ${week.week_number}`,
    noteTitle || 'Unavailable',
  ].join(', ');

  const rowContent = (
    <>
      <View style={styles.weekIndexRowHeader}>
        <Text style={[styles.weekIndexWeekLabel, !isAvailable && styles.weekIndexMuted]}>
          {`Week ${week.week_number}`}
        </Text>
        {isAvailable && (
          <MaterialIcons name="chevron-right" size={16} color={colors.accent} accessible={false} />
        )}
      </View>
      {noteTitle != null && (
        <Text style={styles.weekIndexNoteTitle} numberOfLines={1}>{noteTitle}</Text>
      )}
      <Text style={styles.weekIndexStateText}>{stateText}</Text>
    </>
  );

  if (isAvailable) {
    return (
      <Pressable
        onPress={() => onNavigate?.('Log', { kind: 'note', noteId: week.note_id })}
        style={styles.weekIndexRow}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
      >
        {rowContent}
      </Pressable>
    );
  }

  return (
    <View style={styles.weekIndexRow} accessible accessibilityLabel={a11yLabel}>
      {rowContent}
    </View>
  );
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
          {UNAVAILABLE_REASON_TEXT[row.unavailable_reason] || 'This exercise could not be compared.'}
        </Text>
      )}

      {row.state === RECOVERY_COMPARISON_STATES.NOT_REINTRODUCED && (
        <Text style={styles.unavailableText}>
          {`Baseline: ${row.metrics.map(m => `${METRIC_LABELS[m.metric]} ${_formatMetricNumber(m.metric, m.baseline, unit)}`).join(' · ')}`}
        </Text>
      )}
    </View>
  );
}

// A week whose linked note is gone or unreadable says so above the details
// disclosure, never inside it: a collapsed panel must not be the reason a lifter
// cannot see that this week has no readable evidence at all (#758).
function WeekUnavailableNotice({ week }) {
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
function MetricLegend({ rows }) {
  const styles = useThemedStyles(createStyles);
  const shown = new Set();
  for (const row of rows) {
    if (row.state === RECOVERY_COMPARISON_STATES.NOT_COMPARABLE) continue;
    for (const metric of row.metrics || []) shown.add(metric.metric);
  }
  const lines = ['top_load', 'volume'].filter(m => shown.has(m)).map(m => METRIC_EXPLANATIONS[m]);
  if (lines.length === 0) return null;

  return (
    <View style={styles.legend}>
      {lines.map(line => <Text key={line} style={styles.legendText}>{line}</Text>)}
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

function WeekEvidence({ rows, unit }) {
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

// The one-line week-aware summary under the hero count. It states the week the
// count belongs to and the remaining states in plain words, dropping any state
// with nothing in it — a lifter reading "Week 3 · 2 rebuilding" should not also
// have to read three zeroes. `Baseline met` is deliberately absent: it is the
// hero, and repeating it here would read as a second, different number.
function _summaryLine(weekLabel, summary) {
  if (!weekLabel) return null;
  const parts = [weekLabel];
  const add = (count, noun) => { if (count > 0) parts.push(`${count} ${noun}`); };
  add(summary?.rebuilding, 'rebuilding');
  add(summary?.not_reintroduced, 'not reintroduced');
  add(summary?.not_comparable, 'not comparable');
  add(summary?.added_during_recovery, 'added during recovery');
  return parts.join(' · ');
}

// Every piece of state below — selected week, disclosure — is a view onto ONE
// block, so the caller mounts this keyed by `block.id`. Reusing the instance
// across a history switch would carry the previous block's open disclosure and
// selected week onto a block that never had them.
function BlockEvidence({ block, weeks, notes, unit }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [selectedWeekId, setSelectedWeekId] = useState(null);
  // Details start collapsed (#758). The question this surface answers — how
  // close am I to my normal training — is answered by the summary above; the
  // per-exercise diagnostic panel is the follow-up, not the opening statement.
  const [detailsExpanded, setDetailsExpanded] = useState(false);

  const comparison = useMemo(
    () => deriveRecoveryComparison({ block, weeks, notes }),
    [block, weeks, notes]
  );

  const weekResults = comparison.weeks || [];
  const latestWeek = weekResults.length > 0 ? weekResults[weekResults.length - 1] : null;
  const selectedWeek = (selectedWeekId && weekResults.find(w => w.week_id === selectedWeekId)) || latestWeek;
  const isActive = !block.completed_at;
  const routineTitle = block.baseline_note_title || 'Untitled Routine';

  const totalBaselineExercises = selectedWeek ? (selectedWeek.exercises || []).length : 0;
  const metCount = selectedWeek ? (selectedWeek.summary?.baseline_met || 0) : 0;
  const addedCount = selectedWeek ? (selectedWeek.added || []).length : 0;
  const totalRows = totalBaselineExercises + addedCount;
  const weekLabel = selectedWeek ? `Week ${selectedWeek.week_number}` : null;
  const summaryLine = _summaryLine(weekLabel, selectedWeek?.summary);
  const heroLabel = `${weekLabel ? `${weekLabel}, ` : ''}${metCount} of ${totalBaselineExercises} baseline exercises met`;
  // One-line identity caption, replacing the old "Baseline routine" label +
  // title pair (#793/R5b cut list). The selected week is always named here so
  // the hero below is never ambiguous about which week it describes (§5).
  const identityCaption = weekLabel ? `${weekLabel} · ${routineTitle}` : `Baseline: ${routineTitle}`;
  const provenance = isActive
    ? `Started ${formatDate(block.started_at)}`
    : `${formatDate(block.started_at)} – ${formatDate(block.completed_at)}`;
  const weekRows = selectedWeek ? [...(selectedWeek.exercises || []), ...(selectedWeek.added || [])] : [];
  // Even a baseline-empty week still has something to say if it carries
  // recovery-only work: the merged clause line names it, with no hero above it.
  const showSummaryLine = selectedWeek && (totalBaselineExercises > 0 || addedCount > 0);

  return (
    <Card style={styles.card}>
      <Text style={styles.identityCaption}>{identityCaption}</Text>

      {comparison.status === RECOVERY_COMPARISON_STATUS.BASELINE_UNAVAILABLE && (
        <Text style={styles.unavailablePanelText}>
          The frozen baseline for this recovery block is unavailable.
        </Text>
      )}
      {comparison.status === RECOVERY_COMPARISON_STATUS.BASELINE_UNSUPPORTED && (
        <Text style={styles.unavailablePanelText}>
          This recovery block's baseline was captured in a format this version can't read.
        </Text>
      )}
      {comparison.status === RECOVERY_COMPARISON_STATUS.BASELINE_EMPTY && (
        <Text style={styles.unavailablePanelText}>
          No baseline exercises were captured for this block.
        </Text>
      )}

      {(comparison.status === RECOVERY_COMPARISON_STATUS.OK || comparison.status === RECOVERY_COMPARISON_STATUS.BASELINE_EMPTY) && (
        <>
          {weekResults.length === 0 && (
            <Text style={styles.unavailablePanelText}>Baseline captured. No week logged yet.</Text>
          )}

          {showSummaryLine && (
            <View style={styles.summaryBlock}>
              {totalBaselineExercises > 0 && (
                <View
                  style={styles.heroBlock}
                  accessible
                  accessibilityLabel={heroLabel}
                  accessibilityLiveRegion="polite"
                >
                  <Text style={[HeroMetric.statPrimary, { color: colors.accent }]}>
                    {`${metCount} of ${totalBaselineExercises}`}
                  </Text>
                  <Text style={styles.heroCaption}>baseline exercises met</Text>
                </View>
              )}
              {!!summaryLine && <Text style={styles.summaryLine}>{summaryLine}</Text>}
            </View>
          )}

          {weekResults.length > 1 && (
            <View style={styles.chipRow}>
              {weekResults.map((w) => {
                const selected = selectedWeek && w.week_id === selectedWeek.week_id;
                return (
                  <Pressable
                    key={w.week_id}
                    onPress={() => setSelectedWeekId(w.week_id)}
                    style={[styles.chip, selected ? styles.chipSelected : null]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Week ${w.week_number}${w.completed_at ? ', completed' : ''}`}
                  >
                    <Text style={[styles.chipText, selected ? styles.chipTextSelected : null]}>
                      {`Week ${w.week_number}`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          <WeekUnavailableNotice week={selectedWeek} />

          {selectedWeek?.status === RECOVERY_WEEK_STATUS.OK && totalRows === 0 && (
            <Text style={styles.unavailablePanelText}>No exercise evidence for this week.</Text>
          )}

          {selectedWeek?.status === RECOVERY_WEEK_STATUS.OK && totalRows > 0 && (
            <View style={styles.detailsPanel}>
              <Pressable
                onPress={() => setDetailsExpanded(expanded => !expanded)}
                style={styles.detailsHeader}
                accessibilityRole="button"
                accessibilityLabel={detailsExpanded ? 'Collapse exercise details' : 'Expand exercise details'}
                accessibilityState={{ expanded: detailsExpanded }}
              >
                <View style={styles.detailsHeaderContent}>
                  <Text style={styles.detailsHeaderTitle}>Exercise details</Text>
                  {!detailsExpanded && (
                    <Text style={styles.detailsHeaderCount}>
                      {`${totalRows} exercise${totalRows === 1 ? '' : 's'}`}
                    </Text>
                  )}
                </View>
                <MaterialIcons
                  name={detailsExpanded ? 'expand-less' : 'expand-more'}
                  size={18}
                  color={colors.textMuted}
                  accessible={false}
                />
              </Pressable>

              {detailsExpanded && (
                <View style={styles.detailsBody}>
                  <MetricLegend rows={weekRows} />
                  <WeekEvidence rows={weekRows} unit={unit} />
                </View>
              )}
            </View>
          )}
        </>
      )}

      <Text style={styles.provenanceText}>{provenance}</Text>
    </Card>
  );
}

export function AnalyticsRecoverySection({
  blocks = [],
  weeks = [],
  notes = [],
  // Authoritative Recovery read state (#716), from the same shared store the Log
  // screen renders. Defaults describe a verified, current snapshot so a caller
  // that does not supply them is unchanged.
  stateReady = true,
  stateLoading = false,
  stateRefreshing = false,
  stateStale = false,
  stateError = null,
  // Writes are open only when the shared state has verified eligibility. False
  // covers terminal-repair-error, journal-corrupt, and every other gate the
  // authoritative hook enforces (#728).
  mutationsAllowed = true,
  pendingRecovery = [],
  onRetry,
  onNavigate,
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const unit = useWeightUnit();
  // Completed-block history starts collapsed for the same reason the details do
  // (#758): its collapsed header already states how many blocks there are and
  // names the latest, which is the whole answer for most visits.
  const [historyCollapsed, setHistoryCollapsed] = useState(true);
  const [focusedBlockId, setFocusedBlockId] = useState(null);
  const { setIncludeInNormalAnalytics } = useRecoveryBlockLifecycle();
  const [inclusionBusyBlockId, setInclusionBusyBlockId] = useState(null);
  const [inclusionError, setInclusionError] = useState(null);

  const activeBlock = findActiveBlock(blocks);
  const completedBlocks = blocks
    .filter(b => isLiveRecord(b) && b.completed_at)
    .sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)));

  const handleToggleInclusion = async (block, include) => {
    if (inclusionBusyBlockId) return;
    setInclusionError(null);
    setInclusionBusyBlockId(block.id);
    try {
      const result = await setIncludeInNormalAnalytics({ blockId: block.id, include });
      if (!result || result.ok === false) {
        setInclusionError({
          blockId: block.id,
          message: (result && result.error) || 'That setting could not be saved.',
        });
      }
    } finally {
      setInclusionBusyBlockId(null);
    }
  };

  const inclusionErrorFor = (blockId) =>
    (inclusionError && inclusionError.blockId === blockId) ? inclusionError.message : null;

  const hasPendingRecovery = (pendingRecovery?.length || 0) > 0;
  // EVERY inclusion switch is disabled while ANY write is in flight (#728),
  // not just the one being written — presenting an enabled switch that would
  // silently discard the interaction is worse than disabling all of them.
  // Also disabled while reconciliation is pending: the hook rejects those
  // writes via ensureVerifiedRecoveryState anyway, so the UI must not
  // advertise an action that can only fail.
  const inclusionLocked = !mutationsAllowed || hasPendingRecovery || !!inclusionBusyBlockId;

  // Unverified state is not "this user has never recovered" (#716). Rendering
  // nothing here would silently retract an entire evidence surface on a failed
  // read, so an unverified snapshot states its own condition instead.
  if (!stateReady) {
    const isInitialLoad = !stateError && (stateLoading || stateRefreshing);
    const message = isInitialLoad ? RECOVERY_LOADING_MESSAGE : RECOVERY_UNVERIFIED_MESSAGE;
    return (
      <View style={styles.container}>
        <SectionTitle>Recovery</SectionTitle>
        <View
          style={styles.stateBanner}
          accessible
          accessibilityRole={isInitialLoad ? 'text' : 'alert'}
          accessibilityLabel={message}
        >
          <Text style={styles.stateBannerText}>{message}</Text>
          {!isInitialLoad && !!onRetry && (
            <Pressable
              onPress={() => onRetry()}
              style={styles.stateRetryButton}
              accessibilityRole="button"
              accessibilityLabel="Retry recovery"
            >
              <Text style={styles.stateRetryText}>Retry recovery</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  const staleBanner = stateStale ? (
    <View
      style={styles.stateBanner}
      accessible
      accessibilityRole="alert"
      accessibilityLabel={RECOVERY_STALE_MESSAGE}
    >
      <Text style={styles.stateBannerText}>{RECOVERY_STALE_MESSAGE}</Text>
      {!!onRetry && (
        <Pressable
          onPress={() => onRetry()}
          disabled={stateRefreshing}
          style={styles.stateRetryButton}
          accessibilityRole="button"
          accessibilityLabel="Retry recovery"
          accessibilityState={{ disabled: stateRefreshing }}
        >
          <Text style={styles.stateRetryText}>Retry recovery</Text>
        </Pressable>
      )}
    </View>
  ) : null;

  // A stale snapshot with no blocks in it still has something to say: the last
  // good read is what is on screen and it may be out of date. Hiding the section
  // would hide the retry path with it.
  if (!activeBlock && completedBlocks.length === 0) {
    if (!stateStale) return null;
    return (
      <View style={styles.container}>
        <SectionTitle>Recovery</SectionTitle>
        {staleBanner}
      </View>
    );
  }

  const focusedBlock =
    (focusedBlockId && [activeBlock, ...completedBlocks].find(b => b && b.id === focusedBlockId)) ||
    activeBlock ||
    completedBlocks[0];

  const notesById = new Map(notes.map(n => [n.id, n]));

  return (
    <View style={styles.container}>
      <SectionTitle>Recovery</SectionTitle>

      {staleBanner}

      {activeBlock && focusedBlock.id !== activeBlock.id && (
        <Pressable
          onPress={() => setFocusedBlockId(activeBlock.id)}
          style={styles.backToActive}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="View active recovery block"
        >
          <MaterialIcons name="chevron-left" size={16} color={colors.accent} accessible={false} />
          <Text style={styles.backToActiveText}>Back to active block</Text>
        </Pressable>
      )}

      <BlockEvidence key={focusedBlock.id} block={focusedBlock} weeks={weeks} notes={notes} unit={unit} />

      {completedBlocks.length > 0 && (
        <View style={styles.historyPanel}>
          <Pressable
            onPress={() => setHistoryCollapsed(c => !c)}
            style={[styles.historyHeader, !historyCollapsed && styles.historyHeaderBordered]}
            accessibilityRole="button"
            accessibilityLabel={historyCollapsed ? 'Expand recovery history' : 'Collapse recovery history'}
            accessibilityState={{ expanded: !historyCollapsed }}
          >
            <View style={styles.historyHeaderContent}>
              <Text style={styles.historySummaryCount}>
                {`${completedBlocks.length} completed ${completedBlocks.length === 1 ? 'block' : 'blocks'}`}
              </Text>
              {historyCollapsed && (
                <Text style={styles.historySummaryLatest} numberOfLines={1}>
                  {'Latest: '}
                  <Text style={styles.historySummaryEmphasis}>
                    {completedBlocks[0].baseline_note_title || 'Untitled Routine'}
                  </Text>
                </Text>
              )}
            </View>
            <MaterialIcons
              name={historyCollapsed ? 'expand-more' : 'expand-less'}
              size={18}
              color={colors.textMuted}
              accessible={false}
            />
          </Pressable>

          {!historyCollapsed && completedBlocks.map((block, index) => {
            const isLast = index === completedBlocks.length - 1;
            const selected = focusedBlock.id === block.id;
            const blockWeeks = weeks
              .filter(w => isLiveRecord(w) && w.block_id === block.id)
              .sort((a, b) => a.week_number - b.week_number);
            return (
              <View key={block.id} style={[styles.historyBlockGroup, !isLast && styles.historyBlockGroupBorder]}>
                <Pressable
                  onPress={() => setFocusedBlockId(block.id)}
                  style={[styles.historyRow, selected && styles.historyRowSelected]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`View recovery evidence for ${block.baseline_note_title || 'Untitled Routine'}, completed ${formatDate(block.completed_at)}`}
                >
                  <Text style={styles.historyBaselineTitle}>{block.baseline_note_title || 'Untitled Routine'}</Text>
                  <Text style={styles.historyDates}>
                    {formatDate(block.started_at)} – {formatDate(block.completed_at)}
                  </Text>
                </Pressable>
                {blockWeeks.map(w => (
                  <WeekIndexRow
                    key={w.id}
                    block={block}
                    week={w}
                    notesById={notesById}
                    onNavigate={onNavigate}
                  />
                ))}
                <View style={styles.historyInclusionWrapper}>
                  <RecoveryInclusionToggle
                    block={block}
                    disabled={inclusionLocked}
                    busy={inclusionBusyBlockId === block.id}
                    error={inclusionErrorFor(block.id)}
                    onToggle={handleToggleInclusion}
                  />
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  container: {
    gap: 16,
  },
  // Same tokens as LogRecoverySection's pending/stale banner, so the identical
  // condition reads identically on both tabs (docs/design-system-map.md).
  stateBanner: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.subtleBg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    gap: 8,
  },
  stateBannerText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  stateRetryButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.chipBackground,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  stateRetryText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.accent,
  },
  card: {
    gap: 12,
  },
  identityCaption: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
  },
  provenanceText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  backToActive: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    minHeight: 44,
  },
  backToActiveText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.accent,
  },
  unavailablePanelText: {
    fontSize: 14,
    color: colors.textMuted,
  },
  summaryBlock: {
    gap: 4,
  },
  heroBlock: {
    alignItems: 'flex-start',
    gap: 2,
  },
  heroCaption: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summaryLine: {
    fontSize: 13,
    color: colors.textMuted,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.subtleBg,
    minHeight: 44,
    justifyContent: 'center',
  },
  chipSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
  },
  chipTextSelected: {
    color: colors.onAccent,
  },
  detailsPanel: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  detailsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    minHeight: 44,
    paddingTop: 12,
  },
  detailsHeaderContent: {
    flex: 1,
  },
  detailsHeaderTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  detailsHeaderCount: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    marginTop: 2,
  },
  detailsBody: {
    gap: 12,
    paddingTop: 12,
  },
  legend: {
    gap: 4,
  },
  legendText: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.textMuted,
  },
  evidenceGroup: {
    gap: 16,
  },
  rowList: {
    gap: 12,
  },
  exerciseRow: {
    gap: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  exerciseRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  exerciseRowName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
  },
  stateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stateDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  stateDot_success: {
    backgroundColor: colors.success,
  },
  stateDot_caution: {
    backgroundColor: colors.caution,
  },
  stateDot_error: {
    backgroundColor: colors.error,
  },
  stateDot_muted: {
    backgroundColor: colors.textMuted,
  },
  stateDot_accent: {
    backgroundColor: colors.accent,
  },
  stateChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 16,
  },
  metricCell: {
    flex: 1,
    gap: 4,
  },
  metricHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  metricPercent: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.caution,
  },
  metricPercentMet: {
    color: colors.success,
  },
  meterTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.subtleBg,
    overflow: 'hidden',
  },
  meterFill: {
    height: '100%',
    borderRadius: 3,
  },
  metricNumbers: {
    fontSize: 12,
    color: colors.textMuted,
  },
  addedMetricValue: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  detailGroup: {
    gap: 12,
  },
  detailGroupLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  unavailableText: {
    fontSize: 12,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  historyPanel: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    overflow: 'hidden',
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 44,
    backgroundColor: colors.subtleBg,
  },
  historyHeaderBordered: {
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  historyHeaderContent: {
    flex: 1,
  },
  historySummaryCount: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
  },
  historySummaryLatest: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  historySummaryEmphasis: {
    fontWeight: '700',
    color: colors.text,
  },
  historyBlockGroup: {
  },
  historyBlockGroupBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  historyRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 4,
  },
  historyRowSelected: {
    backgroundColor: colors.subtleBg,
  },
  historyBaselineTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  historyDates: {
    fontSize: 12,
    color: colors.textMuted,
  },
  historyInclusionWrapper: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  weekIndexRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    gap: 2,
  },
  weekIndexRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  weekIndexWeekLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  weekIndexNoteTitle: {
    fontSize: 13,
    color: colors.text,
  },
  weekIndexStateText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  weekIndexMuted: {
    color: colors.textMuted,
  },
});

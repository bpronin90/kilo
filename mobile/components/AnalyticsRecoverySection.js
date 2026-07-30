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
import {
  deriveRecoveryComparison,
  RECOVERY_COMPARISON_STATUS,
  RECOVERY_WEEK_STATUS,
  RECOVERY_COMPARISON_STATES,
} from '../lib/data/recoveryAnalytics';

const METRIC_LABELS = Object.freeze({
  top_load: 'Load',
  volume: 'Volume',
  total_reps: 'Reps',
  total_seconds: 'Time',
});

const STATE_META = Object.freeze({
  [RECOVERY_COMPARISON_STATES.BASELINE_MET]: { label: 'Baseline met', dot: 'success' },
  [RECOVERY_COMPARISON_STATES.REBUILDING]: { label: 'Rebuilding', dot: 'caution' },
  [RECOVERY_COMPARISON_STATES.NOT_REINTRODUCED]: { label: 'Not reintroduced', dot: 'muted' },
  [RECOVERY_COMPARISON_STATES.NOT_COMPARABLE]: { label: 'Not comparable', dot: 'error' },
  [RECOVERY_COMPARISON_STATES.ADDED_DURING_RECOVERY]: { label: 'Added during recovery', dot: 'accent' },
});

const UNAVAILABLE_REASON_TEXT = Object.freeze({
  exercise_class_changed: 'Logged as a different kind of exercise than the baseline.',
  no_comparable_metric: "This week's entry has no usable Load, Volume, Reps, or Time value.",
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

function WeekEvidence({ week, unit }) {
  const styles = useThemedStyles(createStyles);
  if (!week) return null;

  if (week.status === RECOVERY_WEEK_STATUS.NOTE_MISSING) {
    return (
      <Text style={styles.unavailablePanelText}>
        The workout note linked to this week is no longer available.
      </Text>
    );
  }
  if (week.status === RECOVERY_WEEK_STATUS.NOTE_UNREADABLE) {
    return (
      <Text style={styles.unavailablePanelText}>
        {week.note_error || 'This week\'s linked note could not be parsed.'}
      </Text>
    );
  }

  const baselineRows = week.exercises || [];
  const addedRows = week.added || [];

  if (baselineRows.length === 0 && addedRows.length === 0) {
    return <Text style={styles.unavailablePanelText}>No exercise evidence for this week.</Text>;
  }

  return (
    <View style={styles.evidenceGroup}>
      {baselineRows.length > 0 && (
        <View style={styles.rowList}>
          {baselineRows.map(row => <ExerciseRow key={row.key} row={row} unit={unit} />)}
        </View>
      )}
      {addedRows.length > 0 && (
        <View style={styles.addedGroup}>
          <Text style={styles.addedGroupLabel}>Added during recovery</Text>
          <View style={styles.rowList}>
            {addedRows.map(row => <ExerciseRow key={row.key} row={row} unit={unit} />)}
          </View>
        </View>
      )}
    </View>
  );
}

function BlockEvidence({ block, weeks, notes, unit }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [selectedWeekId, setSelectedWeekId] = useState(null);

  const comparison = useMemo(
    () => deriveRecoveryComparison({ block, weeks, notes }),
    [block, weeks, notes]
  );

  const weekResults = comparison.weeks || [];
  const latestWeek = weekResults.length > 0 ? weekResults[weekResults.length - 1] : null;
  const selectedWeek = (selectedWeekId && weekResults.find(w => w.week_id === selectedWeekId)) || latestWeek;
  const isActive = !block.completed_at;

  const totalBaselineExercises = selectedWeek ? (selectedWeek.exercises || []).length : 0;
  const metCount = selectedWeek ? (selectedWeek.summary?.baseline_met || 0) : 0;

  return (
    <Card style={styles.card}>
      <Text style={styles.baselineLabel}>Baseline routine</Text>
      <Text style={styles.baselineTitle}>{block.baseline_note_title || 'Untitled Routine'}</Text>
      <Text style={styles.blockMeta}>
        {isActive ? 'Active' : 'Completed'}
        {selectedWeek ? ` · Week ${selectedWeek.week_number}` : ''}
        {weekResults.length > 0 ? ` · ${weekResults.length} week${weekResults.length === 1 ? '' : 's'} logged` : ''}
        {` · Started ${formatDate(block.started_at)}`}
        {block.completed_at ? ` · Completed ${formatDate(block.completed_at)}` : ''}
      </Text>

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
          The frozen baseline recorded no comparable exercise.
        </Text>
      )}

      {(comparison.status === RECOVERY_COMPARISON_STATUS.OK || comparison.status === RECOVERY_COMPARISON_STATUS.BASELINE_EMPTY) && (
        <>
          {selectedWeek && totalBaselineExercises > 0 && (
            <View style={styles.heroBlock} accessible accessibilityLabel={`${metCount} of ${totalBaselineExercises} baseline exercises met`}>
              <Text style={[HeroMetric.statPrimary, { color: colors.accent }]}>
                {`${metCount} of ${totalBaselineExercises}`}
              </Text>
              <Text style={styles.heroCaption}>baseline exercises met</Text>
            </View>
          )}

          {weekResults.length > 1 && (
            <View style={styles.weekChipRow}>
              {weekResults.map((w) => {
                const selected = selectedWeek && w.week_id === selectedWeek.week_id;
                return (
                  <Pressable
                    key={w.week_id}
                    onPress={() => setSelectedWeekId(w.week_id)}
                    style={[styles.weekChip, selected ? styles.weekChipSelected : null]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Week ${w.week_number}${w.completed_at ? ', completed' : ''}`}
                  >
                    <Text style={[styles.weekChipText, selected ? styles.weekChipTextSelected : null]}>
                      {`Week ${w.week_number}`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          <WeekEvidence week={selectedWeek} unit={unit} />
        </>
      )}
    </Card>
  );
}

export function AnalyticsRecoverySection({ blocks = [], weeks = [], notes = [] }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const unit = useWeightUnit();
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [focusedBlockId, setFocusedBlockId] = useState(null);

  const activeBlock = findActiveBlock(blocks);
  const completedBlocks = blocks
    .filter(b => isLiveRecord(b) && b.completed_at)
    .sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)));

  if (!activeBlock && completedBlocks.length === 0) return null;

  const focusedBlock =
    (focusedBlockId && [activeBlock, ...completedBlocks].find(b => b && b.id === focusedBlockId)) ||
    activeBlock ||
    completedBlocks[0];

  const notesById = new Map(notes.map(n => [n.id, n]));

  return (
    <View style={styles.container}>
      <SectionTitle>Recovery</SectionTitle>

      {activeBlock && focusedBlock.id !== activeBlock.id && (
        <Pressable
          onPress={() => setFocusedBlockId(activeBlock.id)}
          style={styles.backToActive}
          accessibilityRole="button"
          accessibilityLabel="View active recovery block"
        >
          <MaterialIcons name="chevron-left" size={16} color={colors.accent} />
          <Text style={styles.backToActiveText}>Back to active block</Text>
        </Pressable>
      )}

      <BlockEvidence block={focusedBlock} weeks={weeks} notes={notes} unit={unit} />

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
            return (
              <Pressable
                key={block.id}
                onPress={() => setFocusedBlockId(block.id)}
                style={[styles.historyRow, isLast && styles.historyRowLast, selected && styles.historyRowSelected]}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`View recovery evidence for ${block.baseline_note_title || 'Untitled Routine'}, completed ${formatDate(block.completed_at)}`}
              >
                <Text style={styles.historyBaselineTitle}>{block.baseline_note_title || 'Untitled Routine'}</Text>
                <Text style={styles.historyDates}>
                  {formatDate(block.started_at)} – {formatDate(block.completed_at)}
                </Text>
              </Pressable>
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
  card: {
    gap: 12,
  },
  baselineLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: colors.textMuted,
  },
  baselineTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  blockMeta: {
    fontSize: 12,
    color: colors.textMuted,
  },
  backToActive: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
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
  weekChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  weekChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.subtleBg,
  },
  weekChipSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  weekChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
  },
  weekChipTextSelected: {
    color: colors.onAccent,
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
  addedGroup: {
    gap: 12,
  },
  addedGroupLabel: {
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
  historyRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
    gap: 4,
  },
  historyRowLast: {
    borderBottomWidth: 0,
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
});

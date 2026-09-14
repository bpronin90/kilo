import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { ArtisanalPanel } from '../../components/UI';
import { normalizeLiftName } from '../../lib/data';
import { normalizeExerciseKey } from '../../lib/parser';
import { formatDuration } from '../../lib/format';
import { formatLiftWeightValue } from '../../lib/units';
import { CrossDayComparison, formatOverload } from '../../components/AnalyticsCrossDayComparison';

// #894: a Progressive Overload row's trend can look "stuck" for two very
// different reasons the icon alone can't tell apart — a movement inherited as
// tracked with no activation record (#893 legacy/catalog state, full history)
// versus a movement whose tracked span just opened (an activation record
// exists, but the span itself holds no comparison yet). Only these two states
// get a caption; a fully classified row (up/flat/down) needs no explanation,
// and a row with no capability data at all is already self-explanatory via
// the dash. `hasActivation` alone can't distinguish "just tracked" from
// "tracked a while ago, still building history" — `rowTrend === 'first_session'`
// (or the non-weighted 'dash' arrow) is what actually means "no comparison in
// this span yet", so the two conditions are checked together.
export function describePoRowState({ hasActivation, isFirstSpanSession, hasCapabilityData }) {
  if (!hasCapabilityData) return null;
  if (isFirstSpanSession) {
    return hasActivation
      ? 'New tracked span — Est./Kilo/Best above stay historical'
      : 'First session';
  }
  if (!hasActivation) return 'Inherited tracking — full history';
  return null;
}

// One exercise's Progressive Overload row: its captioned tracking state, its
// weighted or non-weighted metric grid, and (for a multi-day exercise) either
// the full cross-day comparison or the plain "Also on ..." fallback line.
// Moved verbatim out of AnalyticsScreen.js (card #1051) — no presentation
// change, only the module boundary.
function renderExerciseRow(sig, { analytics, trackedLiftActivations, unit, styles, colors }) {
  const normName = normalizeLiftName(sig.name);
  const dayRow = sig.isMultiDay && sig.daySignals ? sig.daySignals[sig.currentDayHeading] : null;
  const rowPr = dayRow ? dayRow.latest_pr : sig.latest_pr;
  const rowTopWeight = dayRow ? dayRow.latest_top_weight : sig.latest_top_weight;
  const rowTrend = dayRow?.overload_trend ?? sig.overload_trend;
  const rowIsBodyweight = dayRow ? dayRow.is_bodyweight : sig.is_bodyweight;
  const nw = analytics.nonWeightedMetrics?.[normName];

  // #894: `trackedLiftActivations` is keyed by the same canonical key
  // WorkoutContentRenderer's Track control writes to (#893) — presence of a
  // record is what makes this an EXPLICIT tracked span, not inherited state.
  const hasActivation = !!(trackedLiftActivations || {})[normalizeExerciseKey(sig.name)];
  const nwArrow = nw ? (nw.exercise_class === 'reps_only' ? nw.reps_arrow : nw.hold_arrow) : null;
  const hasCapabilityData = nw
    ? (nw.exercise_class === 'reps_only' ? nw.avg_reps != null : nw.avg_hold != null)
    : (rowPr != null || sig.kilo_max != null || rowTopWeight != null);
  const isFirstSpanSession = nw ? nwArrow === 'dash' : rowTrend === 'first_session';
  const poCaption = describePoRowState({ hasActivation, isFirstSpanSession, hasCapabilityData });

  return (
    <View key={normName + sig.currentDayHeading} style={[styles.signalRow, styles.signalRowBorder]}>
      <View style={styles.signalNameRow}>
        <Text style={styles.signalName}>{analytics.nameDisplayMap?.get(normName) || sig.name}</Text>
      </View>
      {poCaption && (
        <Text style={styles.trackingCaption}>{poCaption}</Text>
      )}

      {nw ? (
        <View style={styles.signalMetricsGrid}>
          <View style={styles.metricCol}>
            <Text style={styles.signalValue}>
              {nw.exercise_class === 'reps_only'
                ? (nw.avg_reps ?? '—')
                : formatDuration(nw.avg_hold)}
            </Text>
            <Text style={styles.nwMetricLabel}>AVG</Text>
          </View>
          <View style={styles.metricCol}>
            <Text style={styles.signalValue}>
              {nw.exercise_class === 'reps_only'
                ? (nw.best_set_reps ?? '—')
                : formatDuration(nw.best_hold)}
            </Text>
            <Text style={styles.nwMetricLabel}>BEST</Text>
          </View>
          <View style={styles.metricCol} />
          <View style={styles.metricCol}>
            {formatOverload(nw.exercise_class === 'reps_only' ? nw.reps_arrow : nw.hold_arrow, colors)}
          </View>
        </View>
      ) : (
        <View style={styles.signalMetricsGrid}>
          <View style={styles.metricCol}>
            <Text style={styles.signalValue}>
              {rowPr ? formatLiftWeightValue(Math.round(rowPr), unit) : '—'}
              {rowPr ? <Text style={styles.unitSuffix}>{unit}</Text> : null}
            </Text>
          </View>
          <View style={styles.metricCol}>
            <Text style={styles.signalValue}>
              {sig.kilo_max != null ? formatLiftWeightValue(sig.kilo_max, unit) : '—'}
              {sig.kilo_max != null ? <Text style={styles.unitSuffix}>{unit}</Text> : null}
            </Text>
          </View>
          <View style={styles.metricCol}>
            <Text style={styles.signalValue}>
              {rowTopWeight ? (rowIsBodyweight ? rowTopWeight : formatLiftWeightValue(rowTopWeight, unit)) : '—'}
              {rowTopWeight ? <Text style={styles.unitSuffix}>{rowIsBodyweight ? 'reps' : unit}</Text> : null}
            </Text>
          </View>
          <View style={styles.metricCol}>
            {formatOverload(rowTrend, colors)}
          </View>
        </View>
      )}

      {sig.isMultiDay && (
        sig.daySignals
          ? <CrossDayComparison daySignals={sig.daySignals} currentDay={sig.currentDayHeading} otherDays={sig.otherDays} />
          : sig.otherDays.length > 0 && <Text style={styles.multiDaySummary}>Also on {sig.otherDays.join(', ')}</Text>
      )}
    </View>
  );
}

// The Progressive Overload list's own loading / populated / empty-search /
// empty-tracked states (#821, #737) — the content of the measurable
// `overload-list` box AnalyticsProgression.js anchors. Moved verbatim out of
// AnalyticsScreen.js (card #1051): same conditions, same testIDs, same copy.
export function renderOverloadListContent({
  isNotesLoading,
  isTrackedLoading,
  groupedSignals,
  collapsedGroups,
  toggleGroup,
  analytics,
  trackedLiftActivations,
  unit,
  colors,
  styles,
  searchQuery,
  onNavigate,
}) {
  if (isNotesLoading || isTrackedLoading) {
    return (
      <View key="loading" style={{ height: 100, justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (groupedSignals.length > 0) {
    return (
      <ArtisanalPanel key="po-container" style={styles.poContainer}>
        {groupedSignals.map((group, groupIdx) => {
          const isCollapsed = collapsedGroups.has(group.name);
          return (
            <View key={group.name} style={[styles.groupSection, groupIdx > 0 && styles.groupSectionBorder]}>
              <Pressable
                testID={`po-group-header-${group.name}`}
                onPress={() => toggleGroup(group.name)}
                style={styles.groupHeader}
              >
                <Text style={styles.groupName}>{group.name}</Text>
                <MaterialIcons
                  name={isCollapsed ? "expand-more" : "expand-less"}
                  size={20}
                  color={colors.textMuted}
                />
              </Pressable>

              {!isCollapsed && (
                <View style={styles.exerciseList}>
                  {group.exercises.map((sig) => renderExerciseRow(sig, { analytics, trackedLiftActivations, unit, styles, colors }))}
                </View>
              )}
            </View>
          );
        })}
      </ArtisanalPanel>
    );
  }

  if (searchQuery) {
    return (
      <View key="empty-search" style={styles.emptySearch}>
        <Text style={styles.emptyText}>No matches for "{searchQuery}"</Text>
      </View>
    );
  }

  return (
    <View key="empty-tracked" style={styles.emptyTracked}>
      <Text style={styles.emptyText}>
        Tap Track on any exercise in your note to track it here. Logging alone doesn't track it — Track / Tracked is the only control that does.
      </Text>
      <Pressable
        testID="analytics-empty-log-link"
        onPress={() => onNavigate?.('Log')}
        style={styles.emptyTrackedLink}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Go to Log"
        accessibilityHint="Opens the Log tab so you can write a workout note"
      >
        <Text style={styles.emptyTrackedLinkText}>Go to Log</Text>
      </Pressable>
    </View>
  );
}

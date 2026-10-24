import React from 'react';
import { Pressable, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { normalizeLiftName } from '../../lib/data';
import { formatDuration } from '../../lib/format';
import { formatLiftWeightValue } from '../../lib/units';
import { CrossDayComparison } from '../../components/AnalyticsCrossDayComparison';

// Progressive Overload rows (redesign v3, #1604): one pressable row per tracked
// exercise and day, a 1RM / Kilo / Best column header and per-day groups. The
// values are the ones the screen already derives (signals, per-day signals,
// non-weighted metrics); nothing here computes a metric.

const TREND_STATUS = { up: 'progressing', flat: 'stalled', down: 'regressing' };
const STATUS_LABEL = { progressing: 'Progressing', stalled: 'Steady', regressing: 'Regressing' };

// #894: a row whose tracked span holds no comparison yet — a just-opened span
// (activation record, `first_session`/non-weighted 'dash') or a single logged
// session — says so in plain words. How tracked spans and inherited
// (pre-activation) history behave is methodology: it lives behind the
// Progressive Overload section's info disclosure, not inline on every row.
export function describePoRowState({ isFirstSpanSession, hasCapabilityData }) {
  if (!hasCapabilityData) return null;
  return isFirstSpanSession ? 'First session' : null;
}

export const overloadRowKey = sig => `${normalizeLiftName(sig.name)}|${sig.currentDayHeading}`;

// Everything one row (and its detail sheet) shows, from the existing signal
// for the day the row sits under. `status` is the Exercise Progress bucket of
// the trend the row displays; first-session and baseline rows have none.
export function overloadRowModel(sig, analytics, unit) {
  const normName = normalizeLiftName(sig.name);
  const dayRow = sig.isMultiDay && sig.daySignals ? sig.daySignals[sig.currentDayHeading] : null;
  const rowPr = dayRow ? dayRow.latest_pr : sig.latest_pr;
  const rowTopWeight = dayRow ? dayRow.latest_top_weight : sig.latest_top_weight;
  const rowIsBodyweight = dayRow ? dayRow.is_bodyweight : sig.is_bodyweight;
  const nw = analytics.nonWeightedMetrics?.[normName];
  const weightedTrend = dayRow?.overload_trend ?? sig.overload_trend;
  const nwArrow = nw ? (nw.exercise_class === 'reps_only' ? nw.reps_arrow : nw.hold_arrow) : null;
  const trend = nw ? nwArrow : weightedTrend;
  const hasCapabilityData = nw
    ? (nw.exercise_class === 'reps_only' ? nw.avg_reps != null : nw.avg_hold != null)
    : (rowPr != null || sig.kilo_max != null || rowTopWeight != null);
  const weight = v => ({ text: formatLiftWeightValue(v, unit), suffix: unit });
  const na = { text: 'N/A', suffix: null };
  let columns;
  if (nw) {
    const reps = nw.exercise_class === 'reps_only';
    columns = [
      { text: String(reps ? (nw.avg_reps ?? 'N/A') : formatDuration(nw.avg_hold)), suffix: null, caption: 'AVG' },
      null,
      { text: String(reps ? (nw.best_set_reps ?? 'N/A') : formatDuration(nw.best_hold)), suffix: null, caption: 'BEST' },
    ];
  } else {
    columns = [
      rowPr ? weight(Math.round(rowPr)) : na,
      sig.kilo_max != null ? weight(sig.kilo_max) : na,
      rowTopWeight ? (rowIsBodyweight ? { text: String(rowTopWeight), suffix: 'reps' } : weight(rowTopWeight)) : na,
    ];
  }
  return {
    key: overloadRowKey(sig),
    name: analytics.nameDisplayMap?.get(normName) || sig.name,
    trend,
    status: TREND_STATUS[trend] ?? null,
    columns,
    caption: describePoRowState({ isFirstSpanSession: nw ? nwArrow === 'dash' : weightedTrend === 'first_session', hasCapabilityData }),
  };
}

// Narrows the day groups to rows whose displayed status matches the chip; a
// group with no match drops out of the list (its collapse state is kept by the
// screen). `all` returns the groups untouched.
export function filterGroupsByStatus(groups, filter, analytics, unit) {
  if (!filter || filter === 'all') return groups;
  return groups
    .map(group => ({
      ...group,
      exercises: group.exercises.filter(sig => overloadRowModel(sig, analytics, unit).status === filter),
    }))
    .filter(group => group.exercises.length > 0);
}

function trendTone(status, colors, kua) {
  if (status === 'progressing') return kua ? kua.completion : colors.success;
  if (status === 'regressing') return kua ? kua.errorText : colors.error;
  return kua ? kua.warning : colors.caution;
}

export function TrendPill({ status, styles, colors, kua = null, testID }) {
  if (!status) return null;
  const tone = trendTone(status, colors, kua);
  const icon = status === 'progressing' ? 'arrow-upward' : status === 'regressing' ? 'arrow-downward' : 'arrow-forward';
  return (
    <View testID={testID} style={[styles.trendPill, { backgroundColor: `${tone}26` }]} accessible accessibilityLabel={STATUS_LABEL[status]}>
      <MaterialIcons name={icon} size={14} color={tone} accessible={false} />
      <Text style={[styles.trendPillText, { color: tone }]} accessible={false}>{STATUS_LABEL[status]}</Text>
    </View>
  );
}

// Values aligned under the header: three fixed-width right-aligned columns.
export function MetricColumns({ columns, styles }) {
  return (
    <View style={styles.poMetrics}>
      {columns.map((col, i) => (
        <View key={i} style={styles.poMetricCol}>
          {col ? (
            <>
              <Text style={styles.signalValue} numberOfLines={1}>
                {col.text}
                {col.suffix ? <Text style={styles.unitSuffix}>{col.suffix}</Text> : null}
              </Text>
              {col.caption ? <Text style={styles.nwMetricLabel}>{col.caption}</Text> : null}
            </>
          ) : null}
        </View>
      ))}
    </View>
  );
}

export function OverloadColumnHeader({ styles }) {
  return (
    <View testID="po-column-header" style={styles.poColumnHeader} accessible={false}>
      <Text style={[styles.poColLabel, styles.poColumnName]}>Exercise</Text>
      <View style={styles.poMetrics}>
        {['1RM', 'Kilo', 'Best'].map(label => (
          <View key={label} style={styles.poMetricCol}><Text style={styles.poColLabel}>{label}</Text></View>
        ))}
      </View>
    </View>
  );
}

export function OverloadRow({ sig, analytics, unit, styles, colors, kua = null, onOpen, rowRef }) {
  const model = overloadRowModel(sig, analytics, unit);
  const spoken = model.columns
    .map((col, i) => (col ? `${col.caption || ['1RM', 'Kilo', 'Best'][i]} ${col.text}${col.suffix ? ` ${col.suffix}` : ''}` : null))
    .filter(Boolean)
    .join(', ');
  const label = [model.name, model.status ? STATUS_LABEL[model.status] : model.caption, spoken].filter(Boolean).join(', ');
  return (
    <Pressable
      ref={rowRef}
      testID={`po-row-${model.key}`}
      onPress={() => onOpen(sig)}
      style={({ pressed }) => [styles.poRow, pressed ? styles.poRowPressed : null]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens exercise details"
    >
      <View style={styles.poRowTop}>
        <Text style={styles.signalName} numberOfLines={2}>{model.name}</Text>
        <TrendPill status={model.status} styles={styles} colors={colors} kua={kua} />
      </View>
      <View style={styles.poRowBottom}>
        <View style={styles.poRowCaption}>
          {model.caption ? <Text style={styles.trackingCaption}>{model.caption}</Text> : null}
        </View>
        <MetricColumns columns={model.columns} styles={styles} />
      </View>
      {sig.isMultiDay && (
        sig.daySignals
          ? <CrossDayComparison daySignals={sig.daySignals} currentDay={sig.currentDayHeading} otherDays={sig.otherDays} />
          : sig.otherDays.length > 0 && <Text style={styles.multiDaySummary}>Also on {sig.otherDays.join(', ')}</Text>
      )}
    </Pressable>
  );
}

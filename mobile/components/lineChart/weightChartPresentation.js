import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { TYPOGRAPHY } from '../../theme/typography';
import { formatDate } from '../../lib/format';
import { displayChartSeries } from '../../lib/units';

// Presentation helpers for the opt-in Bodyweight plot (Redesign v3, #1603).
// LineChart draws it when it receives a `weightPlot`; everything here is pure
// shaping of values the screen already derived (entries, rolling series, goal).
// Nothing here calculates a weight metric.

// Local noon of a 'YYYY-MM-DD' date: the same instant the rolling-average
// derivation uses for that date, so the x position is the recorded date.
export function entryTime(date) {
  const [y, m, d] = String(date).slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12).getTime();
}

const fixed = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

// Every usable weigh-in, ascending by recorded date (the newest weigh-in of a
// date last), each carrying its own identity (`id`), recorded date, note and
// the rolling average of the active window on that date. `series` is the
// existing rolling series in display space (one point per weigh-in DATE, oldest
// first); it is paired with the distinct dates only when the counts agree, so
// an average is never attached to the wrong day.
export function buildWeighInPoints({ entries, series, windowDays, unit }) {
  const usable = (entries || [])
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e && e.date && Number.isFinite(e.weight_value))
    .sort((a, b) => (a.e.date < b.e.date ? -1 : a.e.date > b.e.date ? 1 : b.i - a.i));
  const dates = [...new Set(usable.map(({ e }) => e.date))];
  const dated = series && series.length === dates.length;
  const avgByDate = {};
  if (dated) series.forEach((p, i) => { avgByDate[dates[i]] = p.value; });
  const points = usable.map(({ e, i }) => {
    const value = displayChartSeries([{ value: e.weight_value, unit: 'lb' }], unit)[0].value;
    const avg = avgByDate[e.date] ?? null;
    const note = typeof e.note === 'string' ? e.note.trim() : '';
    const label = formatDate(e.date);
    const avgText = avg != null ? `${windowDays}-day avg ${avg.toFixed(1)}` : null;
    return {
      id: e.id != null ? String(e.id) : `${e.date}#${i}`,
      date: e.date,
      t: entryTime(e.date),
      value,
      unit,
      label,
      note,
      avg,
      avgText,
      announce: `Selected weigh-in, ${label}, ${fixed(value)} ${unit}`
        + `${avgText ? `, ${avgText.replace('avg', 'average')}` : ''}${note ? `, note: ${note}` : ''}`,
    };
  });
  const line = dated ? series.map((p, i) => ({ value: p.value, t: entryTime(dates[i]) })) : [];
  return { points, line };
}

// The plotted domain: every weigh-in, the rolling line and (when drawn) the
// goal target, so nothing the chart claims can fall outside it.
export function weightBounds(plot) {
  const ts = [...plot.points.map((p) => p.t), ...plot.line.map((p) => p.t)];
  const values = [...plot.points.map((p) => p.value), ...plot.line.map((p) => p.value)];
  if (plot.goal && Number.isFinite(plot.goal.value)) values.push(plot.goal.value);
  return { t0: Math.min(...ts), t1: Math.max(...ts), values };
}

// 0..1 along the recorded-date axis (0 when every point shares one date).
export function timeFraction(bounds, t) {
  const span = bounds.t1 - bounds.t0;
  return span > 0 ? (t - bounds.t0) / span : 0;
}

// The weigh-in nearest a touch, or -1 when there is none. Weigh-ins on one date
// share an x, so when the touch height (and a y mapper) is known the distance is
// two-dimensional and each of them stays reachable; otherwise x alone decides.
// Points that coincide exactly (same date, same value) cannot be told apart by
// position, so repeated taps cycle through them, starting after `currentIndex`.
export function nearestPointIndex(plot, bounds, locationX, padX, innerWidth, locationY = null, yOf = null, currentIndex = null) {
  const useY = Number.isFinite(locationY) && typeof yOf === 'function';
  const dists = plot.points.map((p) => {
    const dx = padX + timeFraction(bounds, p.t) * innerWidth - locationX;
    const dy = useY ? yOf(p.value) - locationY : 0;
    return dx * dx + dy * dy;
  });
  if (dists.length === 0) return -1;
  const best = Math.min(...dists);
  const tied = dists.map((d, i) => (d - best < 1e-6 ? i : -1)).filter((i) => i >= 0);
  if (tied.length > 1 && tied.includes(currentIndex)) return tied[(tied.indexOf(currentIndex) + 1) % tied.length];
  return tied[0];
}

// Text equivalent of the plot for assistive technology: count, the recorded
// dates, the rolling line, the latest-weigh-in ring and the goal line.
export function describeWeightPlot(plot, seriesLabel) {
  const { points, goal } = plot;
  const first = points[0];
  const last = points[points.length - 1];
  const vals = points.map((p) => p.value);
  const unit = last.unit ? ` ${last.unit}` : '';
  return `${seriesLabel ? `${seriesLabel}. ` : ''}Chart of ${points.length} weigh-ins at their recorded dates, `
    + `${first.label} to ${last.label}, with a ${plot.windowLabel || 'rolling average'} line. `
    + `Ranges from ${fixed(Math.min(...vals))}${unit} to ${fixed(Math.max(...vals))}${unit}. `
    + `Latest weigh-in ${fixed(last.value)}${unit} on ${last.label}, marked with a ring.`
    + `${goal ? ` Goal target ${goal.text}${unit}, drawn as a dashed line.` : ''}`;
}

// Evenly spaced recorded-date ticks (MM-DD) along the axis, without repeats.
export function dateTicks(bounds, count = 4) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < count; i += 1) {
    const frac = count === 1 ? 0 : i / (count - 1);
    const d = new Date(bounds.t0 + frac * (bounds.t1 - bounds.t0));
    const text = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!seen.has(text)) { seen.add(text); out.push({ frac, text }); }
  }
  return out;
}

const createStyles = (colors, kua) => StyleSheet.create({
  callout: {
    position: 'absolute',
    top: 0,
    maxWidth: 210,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
    backgroundColor: kua ? kua.surfaceCard : colors.card,
  },
  calloutHead: {
    fontSize: TYPOGRAPHY['label-md'].fontSize,
    fontWeight: '800',
    color: kua ? kua.onSurface : colors.text,
  },
  calloutLine: {
    fontSize: TYPOGRAPHY['label-sm'].fontSize,
    fontWeight: '600',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  goalLabel: {
    position: 'absolute',
    left: 6,
    fontSize: TYPOGRAPHY['label-sm'].fontSize,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: kua ? kua.success : colors.success,
  },
  axis: {
    height: 18,
    marginTop: 2,
  },
  axisLabel: {
    position: 'absolute',
    top: 0,
    fontSize: TYPOGRAPHY['label-sm'].fontSize,
    fontWeight: '600',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
});

function useStyles() {
  const { colors, kuaPalette: kua } = useTheme();
  return useMemo(() => createStyles(colors, kua), [colors, kua]);
}

// The selected weigh-in's callout: value, recorded date, N-day average and
// note. A polite live region, so a keyboard or touch selection is announced.
// Anchored to the side of the point with more room; never intercepts touches.
export function WeightPointCallout({ point, x, plotWidth }) {
  const styles = useStyles();
  const side = x > plotWidth / 2 ? { right: Math.max(plotWidth - x, 0) } : { left: Math.max(x, 0) };
  return (
    <View
      testID="weight-point-callout"
      style={[styles.callout, side]}
      pointerEvents="none"
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={point.announce}
    >
      <Text style={styles.calloutHead}>{`${fixed(point.value)} ${point.unit} · ${point.label}`}</Text>
      {point.avgText ? <Text style={styles.calloutLine}>{point.avgText}</Text> : null}
      {point.note ? <Text style={styles.calloutLine} numberOfLines={2}>{point.note}</Text> : null}
    </View>
  );
}

// "GOAL 183" in the success ink, sitting just above the dashed target line.
export function GoalLabel({ y, text }) {
  const styles = useStyles();
  return <Text testID="weight-goal-label" style={[styles.goalLabel, { top: Math.max(y - 18, 0) }]} pointerEvents="none" accessible={false}>{`Goal ${text}`}</Text>;
}

// Recorded-date ticks under the plot, aligned to the drawn plot width.
export function WeightDateAxis({ bounds, plotWidth, padX }) {
  const styles = useStyles();
  const inner = plotWidth - 2 * padX;
  return (
    <View testID="weight-date-axis" style={[styles.axis, { width: plotWidth }]} pointerEvents="none" accessible={false}>
      {dateTicks(bounds).map((tick, i, all) => {
        const x = padX + tick.frac * inner;
        const last = i === all.length - 1;
        return <Text key={tick.text} style={[styles.axisLabel, last ? { right: Math.max(plotWidth - x, 0) } : { left: x }]}>{tick.text}</Text>;
      })}
    </View>
  );
}

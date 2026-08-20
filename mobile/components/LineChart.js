import React, { useState } from 'react';
import { StyleSheet, View, Text, Pressable, PixelRatio } from 'react-native';
import Svg, { Polyline, Circle, Rect, G, Line } from 'react-native-svg';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';

// Base width for the showScale gutter at the OS default text size (#828). A
// fixed pixel width doesn't track React Native's accessibility font scaling
// — a label like "184.6" set at 200% text can render wider than a static 34
// while the plot still assumes 34, overflowing into the line. The gutter is
// scaled by PixelRatio.getFontScale() below so it grows with the same factor
// that grows the label text; numberOfLines/adjustsFontSizeToFit on the label
// itself is the backstop for any residual mismatch.
const SCALE_GUTTER_WIDTH = 34;

export function LineChart({
  data = [],
  height = 80,
  paddingVertical = 10,
  paddingHorizontal = 10,
  strokeWidth = 3,
  color,
  hideHeader = false,
  onSelect,
  // Opt-in "measured" mode (#821). Defaults to today's behavior so the Home
  // sparkline — the other caller — renders exactly as it did.
  //
  // showScale prints the plotted domain's top and bottom values against the
  // chart, so a line has a readable scale instead of shape alone. The domain
  // is always the data's own min..max (#828) — there is no floor to widen it,
  // so whatever the labels claim is exactly what the data spans, and what the
  // accessibilityLabel below says too.
  showScale = false,
  emptyMessage = 'Not enough data',
  seriesLabel,
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  // Resolved here, not as a parameter default: parameter initializers evaluate
  // before the function body, so `colors.accent` in the signature would hit the
  // body-scoped `colors` binding in its temporal dead zone and throw for every
  // caller that omits `color` (#689).
  const strokeColor = color || colors.accent;
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [chartWidth, setChartWidth] = useState(0);

  if (!data || data.length < 2) {
    return (
      <View style={[styles.container, { height }]}>
        <Text style={styles.noData}>{emptyMessage}</Text>
      </View>
    );
  }

  const onLayout = (event) => {
    const { width } = event.nativeEvent.layout;
    setChartWidth(width);
  };

  const values = data.map(d => d.value);
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const minVal = dataMin;
  const maxVal = dataMax;
  const range = maxVal - minVal;

  // One decimal only when the data actually carries one, so whole-number
  // series (1K totals, rep counts) do not gain a fake ".0" of precision.
  const hasFraction = values.some(v => !Number.isInteger(v));
  const formatScale = (v) => (hasFraction ? v.toFixed(1) : String(Math.round(v)));

  // Text alternative for a chart that is otherwise invisible to a screen
  // reader (#821). Always built — it has no visual effect, so the Home
  // sparkline gains a description without its rendering changing.
  const unitSuffix = data[data.length - 1]?.unit ? ` ${data[data.length - 1].unit}` : '';
  const chartDescription =
    `${seriesLabel ? `${seriesLabel}. ` : ''}Line chart, ${data.length} points. ` +
    `Ranges from ${formatScale(dataMin)}${unitSuffix} to ${formatScale(dataMax)}${unitSuffix}. ` +
    `Starts at ${formatScale(values[0])}${unitSuffix}, ends at ${formatScale(values[values.length - 1])}${unitSuffix}.`;

  // Keep the stroke and point markers inside the SVG bounds. The selected marker
  // is r=5 with a 2px stroke (outer extent ~6px); without this floor, extreme
  // data points drawn at the very edge get clipped — e.g. callers passing
  // paddingVertical={0} for a compact sparkline.
  const MARKER_INSET = 6;
  const effPaddingVertical = Math.max(paddingVertical, MARKER_INSET);
  const effPaddingHorizontal = Math.max(paddingHorizontal, MARKER_INSET);

  // Reserve a gutter for the scale labels (#828) so they sit beside the plot
  // instead of painted over it. The Svg is narrowed by this amount; when
  // showScale is off the gutter is 0 and layout is byte-identical to before.
  // Scaled by the OS text-size setting so large-text labels still fit.
  const scaleGutter = showScale ? Math.ceil(SCALE_GUTTER_WIDTH * PixelRatio.getFontScale()) : 0;
  const plotWidth = Math.max(chartWidth - scaleGutter, 0);

  const getX = (index) => effPaddingHorizontal + (index * (plotWidth - 2 * effPaddingHorizontal) / (data.length - 1));
  // A perfectly flat series (range === 0) has no scale to plot against — every
  // point is both the min and the max. Center it in the plot instead of
  // falling back to a divisor that would pin the whole line to the bottom
  // edge (every `value - minVal` is 0, not NaN, so nothing here throws).
  const getY = (value) =>
    range === 0
      ? height / 2
      : height - effPaddingVertical - ((value - minVal) / range * (height - 2 * effPaddingVertical));

  const points = data.map((d, i) => `${getX(i)},${getY(d.value)}`).join(' ');

  const handlePress = (evt) => {
    if (!plotWidth) return;
    const { locationX } = evt.nativeEvent;
    const index = Math.round((locationX - effPaddingHorizontal) / (plotWidth - 2 * effPaddingHorizontal) * (data.length - 1));
    if (index >= 0 && index < data.length) {
      const next = index === selectedIndex ? null : index;
      setSelectedIndex(next);
      onSelect?.(next !== null ? data[next] : null);
    }
  };

  const displayIndex = selectedIndex !== null ? selectedIndex : data.length - 1;
  const displayPoint = data[displayIndex];

  return (
    <View style={styles.container} onLayout={onLayout}>
      {!hideHeader && (
        <View style={styles.header}>
          <Text style={styles.latestLabel}>
            {selectedIndex !== null ? 'Selected' : 'Latest'}
          </Text>
          <Text style={styles.latestValue}>
            {displayPoint.value}
            <Text style={styles.unit}>{displayPoint.unit || ''}</Text>
          </Text>
        </View>
      )}

      <Pressable
        onPress={handlePress}
        accessibilityRole="image"
        accessibilityLabel={chartDescription}
        style={styles.plotRow}
      >
        <Svg testID="line-chart-svg" width={plotWidth || '100%'} height={height}>
          {plotWidth > 0 && (
            <>
              <Polyline
                points={points}
                fill="none"
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {data.map((d, i) => (
                <Circle
                  key={i}
                  cx={getX(i)}
                  cy={getY(d.value)}
                  r={i === displayIndex ? 5 : 3}
                  fill={i === displayIndex ? strokeColor : colors.card}
                  stroke={strokeColor}
                  strokeWidth={2}
                />
              ))}
              {data.map((d, i) =>
                d.isRoutineStart ? (
                  <Line
                    key={`rs-${i}`}
                    x1={getX(i)}
                    y1={0}
                    x2={getX(i)}
                    y2={height}
                    stroke={colors.textMuted}
                    strokeWidth={1}
                    strokeDasharray="2,3"
                    opacity={0.5}
                  />
                ) : null
              )}
              {selectedIndex !== null && (
                <G>
                   <Rect
                    x={getX(selectedIndex) - 1}
                    y={0}
                    width={2}
                    height={height}
                    fill={strokeColor}
                    opacity={0.2}
                  />
                </G>
              )}
            </>
          )}
        </Svg>
        {showScale && (
          // Sits beside the plot in the reserved gutter, aligned with the
          // top/bottom of the *plot area* (inset by effPaddingVertical) so it
          // lines up with where maxVal/minVal actually draw, not the
          // container's raw edges (#828). Not absolutely positioned, so it
          // can never paint over the line or a point marker. Width tracks the
          // same font-scaled gutter reserved from the plot above.
          <View style={[styles.scaleColumn, { height, width: scaleGutter, paddingVertical: effPaddingVertical }]} pointerEvents="none">
            {/* numberOfLines + adjustsFontSizeToFit is a backstop, not the
                primary fit: the gutter above is already sized for the current
                font scale, but this guarantees a wrapped second line — which
                would silently grow past the column and back into the plot —
                can never happen. */}
            <Text
              testID="line-chart-scale-max"
              style={styles.scaleLabel}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.5}
            >
              {formatScale(maxVal)}
            </Text>
            <Text
              testID="line-chart-scale-min"
              style={styles.scaleLabel}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.5}
            >
              {formatScale(minVal)}
            </Text>
          </View>
        )}
      </Pressable>

      {(selectedIndex !== null && hideHeader) ? (
        <Text style={styles.selectionLabel}>
          {displayPoint.label ? `${displayPoint.label} · ` : ''}
          <Text style={styles.selectionValue}>{displayPoint.value}{displayPoint.unit || ''}</Text>
        </Text>
      ) : displayPoint.label ? (
        <Text style={styles.dateLabel}>{displayPoint.label}</Text>
      ) : null}
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  container: {
    marginVertical: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 8,
  },
  latestLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  latestValue: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
  },
  unit: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
    marginLeft: 2,
  },
  noData: {
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: 14,
    marginTop: 20,
  },
  plotRow: {
    flexDirection: 'row',
  },
  // A reserved column beside the Svg (#828), not an overlay: the plot is
  // narrowed to make room for it, so it can never sit on top of the line, a
  // point marker, or the selection band. Width is set inline per-render (it
  // tracks the OS font scale), not here. Children stretch to that width
  // (default alignItems) rather than shrink-wrapping to content, so each
  // label actually has a width to measure against for numberOfLines/
  // adjustsFontSizeToFit — the backstop only works if the Text knows its box.
  scaleColumn: {
    justifyContent: 'space-between',
  },
  scaleLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
    textAlign: 'right',
  },
  dateLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 4,
  },
  selectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 4,
  },
  selectionValue: {
    fontWeight: '800',
    color: colors.text,
  },
});

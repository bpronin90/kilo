import React, { useState } from 'react';
import { StyleSheet, View, Text, Pressable } from 'react-native';
import Svg, { Polyline, Circle, Rect, G, Line } from 'react-native-svg';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';

export function LineChart({
  data = [],
  height = 80,
  paddingVertical = 10,
  paddingHorizontal = 10,
  strokeWidth = 3,
  color,
  hideHeader = false,
  onSelect,
  // Opt-in "measured" mode (#821). Both default to today's behavior so the
  // Home sparkline — the other caller — renders exactly as it did.
  //
  // showScale prints the plotted domain's top and bottom values against the
  // chart, so a line has a readable scale instead of shape alone.
  //
  // minRange floors the plotted domain. Without it the y-axis is always the
  // data's own min..max, so a 0.4 lb wobble in a 30-day rolling average draws
  // the same full-height drama as a 20 lb swing. A floor makes noise look like
  // noise. It is expressed in the same units as `data[].value`, so callers in
  // display space must convert it themselves.
  minRange = 0,
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

  // Widen the domain symmetrically around the data when it is flatter than
  // `minRange`, so a nearly-flat series renders as a nearly-flat line.
  let minVal = dataMin;
  let maxVal = dataMax;
  if (minRange > 0 && dataMax - dataMin < minRange) {
    const mid = (dataMax + dataMin) / 2;
    minVal = mid - minRange / 2;
    maxVal = mid + minRange / 2;
  }
  const range = maxVal - minVal || 1;

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

  const getX = (index) => effPaddingHorizontal + (index * (chartWidth - 2 * effPaddingHorizontal) / (data.length - 1));
  const getY = (value) => height - effPaddingVertical - ((value - minVal) / range * (height - 2 * effPaddingVertical));

  const points = data.map((d, i) => `${getX(i)},${getY(d.value)}`).join(' ');

  const handlePress = (evt) => {
    if (!chartWidth) return;
    const { locationX } = evt.nativeEvent;
    const index = Math.round((locationX - effPaddingHorizontal) / (chartWidth - 2 * effPaddingHorizontal) * (data.length - 1));
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
      >
        {showScale && (
          <View style={styles.scaleColumn} pointerEvents="none">
            <Text style={styles.scaleLabel}>{formatScale(maxVal)}</Text>
            <Text style={styles.scaleLabel}>{formatScale(minVal)}</Text>
          </View>
        )}
        <Svg width={chartWidth || '100%'} height={height}>
          {chartWidth > 0 && (
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
  // Overlays the plot rather than reserving a gutter, so turning the scale on
  // does not reflow a chart's width or height. `colors.card` matches the
  // surface both Analytics charts sit on in either palette.
  scaleColumn: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    zIndex: 1,
  },
  scaleLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
    backgroundColor: colors.card,
    paddingHorizontal: 3,
    borderRadius: 3,
    overflow: 'hidden',
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

import React, { useState } from 'react';
import { StyleSheet, View, Text, Pressable } from 'react-native';
import Svg, { Polyline, Circle, Rect, G } from 'react-native-svg';
import { Colors } from '../theme/colors';

export function LineChart({ 
  data = [], 
  height = 80, 
  paddingVertical = 10, 
  paddingHorizontal = 10,
  strokeWidth = 3,
  color = Colors.accent,
}) {
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [chartWidth, setChartWidth] = useState(0);

  if (!data || data.length < 2) {
    return (
      <View style={[styles.container, { height }]}>
        <Text style={styles.noData}>Not enough data</Text>
      </View>
    );
  }

  const onLayout = (event) => {
    const { width } = event.nativeEvent.layout;
    setChartWidth(width);
  };

  const values = data.map(d => d.value);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;

  const getX = (index) => paddingHorizontal + (index * (chartWidth - 2 * paddingHorizontal) / (data.length - 1));
  const getY = (value) => height - paddingVertical - ((value - minVal) / range * (height - 2 * paddingVertical));

  const points = data.map((d, i) => `${getX(i)},${getY(d.value)}`).join(' ');

  const handlePress = (evt) => {
    if (!chartWidth) return;
    const { locationX } = evt.nativeEvent;
    const index = Math.round((locationX - paddingHorizontal) / (chartWidth - 2 * paddingHorizontal) * (data.length - 1));
    if (index >= 0 && index < data.length) {
      setSelectedIndex(index === selectedIndex ? null : index);
    }
  };

  const displayIndex = selectedIndex !== null ? selectedIndex : data.length - 1;
  const displayPoint = data[displayIndex];

  return (
    <View style={styles.container} onLayout={onLayout}>
      <View style={styles.header}>
        <Text style={styles.latestLabel}>
          {selectedIndex !== null ? 'Selected' : 'Latest'}
        </Text>
        <Text style={styles.latestValue}>
          {displayPoint.value}
          <Text style={styles.unit}>{displayPoint.unit || ''}</Text>
        </Text>
      </View>

      <Pressable onPress={handlePress}>
        <Svg width={chartWidth || '100%'} height={height}>
          {chartWidth > 0 && (
            <>
              <Polyline
                points={points}
                fill="none"
                stroke={color}
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
                  fill={i === displayIndex ? color : Colors.card}
                  stroke={color}
                  strokeWidth={2}
                />
              ))}
              {selectedIndex !== null && (
                <G>
                   <Rect
                    x={getX(selectedIndex) - 1}
                    y={0}
                    width={2}
                    height={height}
                    fill={color}
                    opacity={0.2}
                  />
                </G>
              )}
            </>
          )}
        </Svg>
      </Pressable>
      
      {displayPoint.label && (
        <Text style={styles.dateLabel}>{displayPoint.label}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
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
    color: Colors.textMuted,
    textTransform: 'uppercase',
  },
  latestValue: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.text,
  },
  unit: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textMuted,
    marginLeft: 2,
  },
  noData: {
    textAlign: 'center',
    color: Colors.textMuted,
    fontSize: 14,
    marginTop: 20,
  },
  dateLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: 4,
  }
});

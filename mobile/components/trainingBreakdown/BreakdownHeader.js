import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { TRAINING_BREAKDOWN_WINDOWS } from '../../lib/data/trainingBreakdownRange';

// Session-window selector (#1597), compact metrics header, and view tabs (#1588).

export const VIEWS = [
  { key: 'movement', label: 'Movement' },
  { key: 'muscles', label: 'Muscles' },
  { key: 'equipment', label: 'Equipment' },
];

export const WINDOW_LABELS = {
  last4: { text: 'Last 4', a11y: 'Last 4 sessions per exercise' },
  last12: { text: 'Last 12', a11y: 'Last 12 sessions per exercise' },
  All: { text: 'All', a11y: 'All eligible sessions' },
};

export function RangeSelector({ styles, range, onChange }) {
  return (
    <View style={styles.range} accessibilityRole="radiogroup" accessibilityLabel="Training breakdown session window">
      {TRAINING_BREAKDOWN_WINDOWS.map((r) => {
        const on = r === range;
        return (
          <Pressable
            key={r}
            testID={`training-breakdown-range-${r}`}
            onPress={() => onChange(r)}
            style={[styles.rangeOption, on && styles.rangeOptionOn]}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={WINDOW_LABELS[r].a11y}
          >
            <Text style={[styles.rangeText, on && styles.rangeTextOn]} accessible={false}>{WINDOW_LABELS[r].text}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function MetricsHeader({ styles, totals, timed, onTimed }) {
  const timedCount = totals.activityEntries;
  return (
    <View style={styles.hero}>
      <View style={styles.heroMain}>
        <Text testID="training-breakdown-completed-sets" style={styles.heroValue}>{totals.completedSets}</Text>
        <Text style={styles.heroLabel}>completed sets</Text>
      </View>
      <View style={styles.stats}>
        <View style={styles.stat} accessible accessibilityLabel={`${totals.exerciseCount} exercises`}>
          <Text style={styles.statValue}>{totals.exerciseCount}</Text>
          <Text style={styles.statLabel}>exercises</Text>
        </View>
        <Pressable
          testID="training-breakdown-timed-stat"
          style={styles.stat}
          disabled={!timed}
          onPress={onTimed}
          accessibilityRole="button"
          accessibilityState={{ disabled: !timed }}
          accessibilityLabel={`${timedCount} timed or cardio entries${timed ? ', show details' : ''}`}
        >
          <Text style={styles.statValue}>{timedCount}</Text>
          <Text style={styles.statLabel}>timed/cardio{timed ? <Text style={styles.chevron}> ›</Text> : null}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function ViewTabs({ styles, view, onChange, onInfo }) {
  return (
    <View style={styles.tabs}>
      <View style={{ flexDirection: 'row', columnGap: 18, flexShrink: 1, flexWrap: 'wrap' }} accessibilityRole="tablist">
        {VIEWS.map((v) => {
          const on = v.key === view;
          return (
            <Pressable
              key={v.key}
              testID={`training-breakdown-view-${v.key}`}
              onPress={() => onChange(v.key)}
              style={[styles.tab, on && styles.tabOn]}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${v.label} view`}
            >
              <Text style={[styles.tabText, on && styles.tabTextOn]} accessible={false}>{v.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable testID="training-breakdown-info" style={styles.info} onPress={onInfo} accessibilityRole="button" accessibilityLabel="How this is counted">
        <View style={styles.infoRing}><Text style={styles.infoText} accessible={false}>i</Text></View>
      </Pressable>
    </View>
  );
}

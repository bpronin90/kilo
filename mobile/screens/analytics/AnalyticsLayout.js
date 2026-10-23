import React from 'react';
import { Pressable, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

export { AnalyticsRoutineHealth } from './AnalyticsRoutineHealthPanel';

// Analytics is the evidence surface: Home owns the summary, so the tab opens
// straight into analysis rather than an overview of the same signals. Redesign
// v3 (#1602) groups it into numbered chapters on one continuous scroll:
//
// Normal training:   01 Progress   (Strength → Progressive Overload)
//                    02 Training   (Training breakdown → Routine Health)
//                    03 Bodyweight (Weight Trends)
//                    04 Recovery   (Recovery history / management entry)
// Active Recovery:   01 Recovery   (Recovery section → Manage + history entry)
//                    02 Bodyweight (Weight Trends)
//                    03 Baseline training, paused: the collapsed-by-default
//                       disclosure (#871); expanded, Strength → Progressive
//                       Overload → Training breakdown → Routine Health render
//                       below it inside `pausedBody`.
//
// Pure ordering: every argument is an already-built element (or null), so the
// two hierarchies cannot drift in what they render — only where.
// `chapterHeader(id)` and `pausedBody(children)` are optional so a caller (or a
// test) can order the sections alone.
export function orderAnalyticsSections({
  isActiveRecovery,
  baselineExpanded,
  banners = [],
  chapterHeader = () => null,
  pausedBody = (children) => children,
  strength,
  trainingBreakdown = null,
  progressiveOverload,
  weight,
  routineHealth,
  recovery,
  disclosure,
}) {
  if (!isActiveRecovery) {
    return [
      ...banners,
      chapterHeader('progress'), strength, progressiveOverload,
      chapterHeader('training'), trainingBreakdown, routineHealth,
      chapterHeader('bodyweight'), weight,
      chapterHeader('recovery'), recovery,
    ];
  }
  const paused = [strength, progressiveOverload, trainingBreakdown, routineHealth];
  return [
    ...banners,
    chapterHeader('recovery'), recovery,
    chapterHeader('bodyweight'), weight,
    chapterHeader('baseline'), disclosure,
    ...(baselineExpanded ? [].concat(pausedBody(paused)) : []),
  ];
}

// Baseline-training disclosure (#871, Zero Friction F9). Strength, Progressive
// Overload, Training breakdown and Routine Health are derived from baseline
// sessions, which stop accumulating during an active Recovery block. Redesign
// v3 (#1602) draws it as the Paused chapter's dashed toggle row.
export function BaselineDisclosureToggle({ collapsed, onToggle, styles, colors, kua }) {
  const muted = kua ? kua.onSurfaceVariant : colors.textMuted;
  return (
    <Pressable
      testID="baseline-disclosure-toggle"
      onPress={onToggle}
      style={styles.baselineDisclosureToggle}
      accessibilityRole="button"
      accessibilityState={{ expanded: !collapsed }}
      aria-expanded={!collapsed}
      accessibilityLabel="Baseline training, paused during Recovery"
      accessibilityHint={collapsed ? 'Shows strength and routine history from before Recovery' : 'Hides strength and routine history from before Recovery'}
    >
      <MaterialIcons name="pause" size={20} color={muted} accessible={false} />
      <Text style={styles.baselineDisclosureLabel}>
        {collapsed ? 'Progress and Training · paused during Recovery' : 'Hide paused Progress and Training'}
      </Text>
      <MaterialIcons name={collapsed ? 'expand-more' : 'expand-less'} size={22} color={muted} accessible={false} />
    </Pressable>
  );
}

// The expanded baseline content (#1602): one column behind a dashed left rule,
// measured as a whole so the sections inside can report offsets relative to it.
export function PausedBaselineBody({ children, styles, onLayout }) {
  return (
    <View key="baseline-paused-body" testID="baseline-paused-body" style={styles.pausedBody} onLayout={onLayout}>
      {children}
    </View>
  );
}

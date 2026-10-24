import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { Panel } from '../../components/ui/RedesignPrimitives';
import { Icon } from '../../components/Icon';
import { useTheme } from '../../theme/ThemeContext';
import { displayChartSeries, formatBodyweightValue, formatGoalWeightValue } from '../../lib/units';
import { createStyles } from './homeStyles';
import { useKuaTypography } from '../../theme/typography';

// The goal state that needs the user, in the Weight goal card's own words.
// Maintenance never gets a pace warning there, so it never gets one here.
export function goalAttentionText(goalInfo) {
  if (!goalInfo) return null;
  if (goalInfo.isOverdue) return 'Goal ended. Archive it or set a new one in Weight.';
  if (goalInfo.direction !== 'loss' && goalInfo.direction !== 'gain') return null;
  const warnings = goalInfo.warnings || [];
  if (warnings.includes('unrealistic')) return 'Pace is unrealistic - consider a longer timeline.';
  if (warnings.includes('unhealthy')) return 'Pace is aggressive - a slower target is safer.';
  return null;
}

// MM-DD from a series label (formatDate's MM-DD-YYYY, or the raw MM/DD fallback).
function shortLabel(label) {
  return String(label ?? '').replace(/-\d{4}$/, '');
}

// Compact trend for Home: the existing rolling series (no axes), the neutral
// series colour (not primary), the latest point marked, and a dashed goal line
// only while a goal is active. Its text equivalent is the body's label.
function WeightSparkline({ points, goal, color, goalColor, cardColor, width = 120, height = 44 }) {
  const values = points.map(p => p.value);
  const all = goal != null ? values.concat(goal) : values;
  const min = Math.floor(Math.min(...all) - 0.5);
  const max = Math.ceil(Math.max(...all) + 0.5);
  const pad = 5;
  const x = i => pad + (i / (points.length - 1)) * (width - pad * 2);
  const y = v => pad + (1 - (v - min) / (max - min || 1)) * (height - pad * 2);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const last = values.length - 1;
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} accessible={false}>
      {goal != null ? (
        <Line testID="home-weight-goal-line" x1={pad} x2={width - pad} y1={y(goal)} y2={y(goal)} stroke={goalColor} strokeWidth={1.25} strokeDasharray="4 4" />
      ) : null}
      <Path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <Circle cx={x(last)} cy={y(values[last])} r={4} fill={color} stroke={cardColor} strokeWidth={2} />
    </Svg>
  );
}

// Body weight and its goal, one card (#1333, #1339, #1341). Redesign v3
// (#1605): the title opens Weight; the body (latest weigh-in, goal context and
// the compact sparkline) opens Analytics' existing `weight` section. The two
// are siblings, never nested, so one press is one navigation. Goal context and
// the goal line need a goal; an ended one keeps `Goal ended` and Review goal.
export function HomeWeightCard({ dashboardData, weightGoal, onNavigate, unit }) {
  const { colors, kuaPalette: kua } = useTheme();
  const typography = useKuaTypography();
  const styles = useMemo(() => createStyles(colors, kua, typography), [colors, kua, typography]);
  const onSurface = kua ? kua.onSurface : colors.text;

  const gi = dashboardData.goalInfo;
  const modeLabel = gi?.direction === 'loss' ? 'Cutting' : gi?.direction === 'gain' ? 'Bulking' : 'Maintaining';
  const goalActive = !!gi && !gi.isOverdue;
  const targetText = weightGoal?.target_weight != null
    ? `${formatGoalWeightValue(weightGoal.target_weight, unit)} ${unit}`
    : null;
  const attention = goalAttentionText(gi);
  // A trend needs two points (production's LineChart rule).
  const series = Array.isArray(dashboardData.weightSeries) && dashboardData.weightSeries.length >= 2
    ? displayChartSeries(dashboardData.weightSeries, unit) : null;
  const range = series ? `${shortLabel(series[0].label)} – ${shortLabel(series[series.length - 1].label)}` : null;
  const goalLine = goalActive && weightGoal?.target_weight != null
    ? Number(formatGoalWeightValue(weightGoal.target_weight, unit)) : null;
  const latestText = dashboardData.latestWeight ? `${formatBodyweightValue(dashboardData.latestWeight, unit)} ${unit}` : null;
  const weeksLeft = gi && !gi.isOverdue ? Math.round(gi.weeks_remaining) : null;
  const goalSpoken = gi ? [modeLabel, targetText, gi.isOverdue ? 'Goal ended' : `${weeksLeft} weeks left`].filter(Boolean).join(', ') : null;
  const bodyLabel = [
    latestText ? `Latest ${latestText}` : 'No weigh-in yet',
    goalSpoken,
    series ? `Trend from ${range}` : null,
  ].filter(Boolean).join('. ');

  const body = (
    <>
      <View style={styles.weightValueBlock}>
        {latestText ? (
          <Text style={styles.heroWeightValueRow} numberOfLines={1}>
            <Text style={styles.heroWeightValue}>{formatBodyweightValue(dashboardData.latestWeight, unit)}</Text>
            <Text style={styles.heroWeightUnit}> {unit}</Text>
          </Text>
        ) : (
          <Text style={styles.heroWeightPlaceholder}>No weigh-in yet</Text>
        )}
        {/* A non-breaking space keeps `Goal ended` whole when the line wraps beside the sparkline. */}
        {gi ? (
          <Text testID="home-goal" style={styles.goalDirectionText}>
            <Text>{modeLabel}</Text>
            {`${targetText ? ` · ${targetText}` : ''} · `}
            {gi.isOverdue ? (
              <Text style={styles.goalEndedText}>{'Goal\u00A0ended'}</Text>
            ) : (
              <Text style={{ color: onSurface }}>{`${weeksLeft} weeks left`}</Text>
            )}
          </Text>
        ) : null}
      </View>
      {series ? (
        <View testID="home-weight-trend" style={styles.weightSparkline}>
          <WeightSparkline
            points={series}
            goal={goalLine}
            color={kua ? kua.chartSeries1 : colors.textMuted}
            goalColor={kua ? kua.completion : colors.success}
            cardColor={kua ? kua.surfaceCard : colors.card}
          />
        </View>
      ) : null}
    </>
  );

  return (
    <View testID="home-weight-card">
      <Panel>
        <View style={styles.panelHeader}>
          <Pressable
            testID="home-weight-link"
            hitSlop={4}
            onPress={() => onNavigate('Weight')}
            style={styles.panelTitleLink}
            accessibilityRole="button"
            accessibilityLabel="Body weight"
            accessibilityHint="Opens the Weight tab"
          >
            <Text style={styles.panelTitle} numberOfLines={1}>Body weight</Text>
            <Icon name="chevron-right" size={18} color={onSurface} />
          </Pressable>
          {range ? <Text testID="home-weight-range" style={styles.panelCaption} numberOfLines={1}>{range}</Text> : null}
        </View>
        {latestText ? (
          <Pressable
            testID="home-weight-analytics-link"
            onPress={() => onNavigate('Analytics', 'weight')}
            style={styles.weightBody}
            accessibilityRole="button"
            accessibilityLabel={bodyLabel}
            accessibilityHint="Opens the weight section of the Analytics tab"
          >
            {body}
          </Pressable>
        ) : (
          <View style={styles.weightBody}>{body}</View>
        )}
        {attention ? (
          <View testID="home-goal-attention" style={styles.goalAttention}>
            <Text style={styles.goalAttentionText}>{attention}</Text>
            <Pressable
              testID="home-goal-attention-action"
              onPress={() => onNavigate('Weight')}
              style={styles.recoveryAction}
              accessibilityRole="button"
              accessibilityLabel="Review goal"
              accessibilityHint="Opens the Weight tab, where the goal can be edited"
            >
              <Text style={styles.recoveryActionText}>Review goal</Text>
            </Pressable>
          </View>
        ) : null}
      </Panel>
    </View>
  );
}

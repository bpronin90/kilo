import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Line, Pattern, Rect } from 'react-native-svg';
import { useTheme } from '../../theme/ThemeContext';
import { TYPOGRAPHY, useKuaTypography } from '../../theme/typography';
import { Panel } from '../../components/ui/RedesignPrimitives';
import { Icon } from '../../components/Icon';

// Redesign v3 (#1605): Home's 1K Progress panel. Home-local on purpose — the
// shared OneKProgressSummary stays Analytics' unit (R5). Presentation only:
// HomeDashboard passes display-space values from the existing 1K derivation
// (lib/data/oneK via homeDashboardData); nothing here derives a lift or total.
// No graph (#1458): the total, a stacked bar of the logged lifts toward the
// target, and the Squat / Bench / Deadlift split.
const SERIES = ['chartSeries1', 'chartSeries2', 'chartSeries3'];

function formatTarget(target) {
  return Math.round(target).toLocaleString('en-US');
}

export function oneKRemainingText(total, target, unit) {
  if (total == null) return null;
  const remaining = Math.round(target - total);
  return remaining > 0 ? `${remaining.toLocaleString('en-US')} ${unit} to ${formatTarget(target)}` : `${formatTarget(target)} ${unit} reached`;
}

function Hatch({ color }) {
  return (
    <Svg width="100%" height="100%" accessible={false}>
      <Defs>
        <Pattern id="home-one-k-hatch" width="7" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <Line x1="1.5" y1="0" x2="1.5" y2="8" stroke={color} strokeWidth="3" />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#home-one-k-hatch)" />
    </Svg>
  );
}

export function HomeOneKPanel({ total, target, unit, lifts, emptyText, onTitlePress, titleHint }) {
  const { colors, kuaPalette: kua } = useTheme();
  const typography = useKuaTypography();
  const styles = useMemo(() => createOneKStyles(colors, kua, typography), [colors, kua, typography]);
  const muted = kua ? kua.onSurfaceVariant : colors.textMuted;
  const seriesColor = (key) => {
    const i = ['squat', 'bench', 'deadlift'].indexOf(key);
    return kua ? kua[SERIES[i]] : [colors.accent, colors.caution, colors.success][i];
  };
  const hasTotal = total != null;
  const remainingText = oneKRemainingText(total, target, unit);
  const filled = hasTotal ? Math.min(total, target) : 0;
  const barLabel = hasTotal
    ? `${lifts.map(l => `${l.label} ${Math.round(l.value)}`).join(', ')}. ${remainingText}.`
    : null;

  return (
    <Panel testID="home-one-k-card">
      <View style={styles.header}>
        <Pressable
          testID="home-one-k-link"
          hitSlop={4}
          onPress={onTitlePress}
          style={styles.titleLink}
          accessibilityRole="button"
          accessibilityLabel="1K Progress"
          accessibilityHint={titleHint}
        >
          <Text style={styles.title} numberOfLines={1}>1K Progress</Text>
          <Icon name="chevron-right" size={18} color={kua ? kua.onSurface : colors.text} />
        </Pressable>
        {remainingText ? <Text testID="home-one-k-remaining" style={styles.caption} numberOfLines={1}>{remainingText}</Text> : null}
      </View>
      <View style={styles.body}>
        {hasTotal ? (
          <>
            <Text testID="home-one-k-total" style={styles.metric}>
              {total.toFixed(0)}<Text style={styles.unit}> {unit}</Text>
            </Text>
            <View testID="home-one-k-progress-track" style={styles.bar} accessible accessibilityRole="image" accessibilityLabel={barLabel}>
              <View testID="home-one-k-progress-fill" style={[styles.barFill, { flex: filled }]}>
                {lifts.map(l => (
                  <View key={l.key} testID={`home-one-k-bar-${l.key}`} style={{ flex: l.value, backgroundColor: seriesColor(l.key) }} />
                ))}
              </View>
              {target - filled > 0 ? (
                <View testID="home-one-k-progress-rest" style={{ flex: target - filled }}>
                  <Hatch color={kua ? kua.surfaceBorder : colors.cardBorder} />
                </View>
              ) : null}
            </View>
          </>
        ) : emptyText ? (
          // The total needs one complete cycle of all three lifts (lib/data/oneK.js).
          <Text testID="home-one-k-setup" style={styles.empty}>{emptyText}</Text>
        ) : null}
      </View>
      {lifts.length > 0 ? (
        <View testID="home-one-k-big3" style={styles.split}>
          {lifts.map((l, i) => (
            <View
              key={l.key}
              testID={`home-one-k-lift-${l.key}`}
              style={[styles.cell, i > 0 ? styles.cellDivider : null]}
              accessible
              accessibilityLabel={`${l.label} ${l.value.toFixed(0)} ${unit}`}
            >
              <View style={styles.cellKey}>
                <View style={[styles.swatch, { backgroundColor: seriesColor(l.key) }]} />
                <Text style={styles.cellLabel} numberOfLines={1}>{l.label}</Text>
              </View>
              <Text numberOfLines={1}>
                <Text testID={`home-one-k-lift-${l.key}-value`} style={styles.cellValue}>{l.value.toFixed(0)}</Text>
                <Text style={[styles.unit, { color: muted }]}> {unit}</Text>
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Panel>
  );
}

const createOneKStyles = (colors, kua = null, typography = TYPOGRAPHY) => {
  const on = kua ? kua.onSurface : colors.text;
  const muted = kua ? kua.onSurfaceVariant : colors.textMuted;
  const border = kua ? kua.surfaceBorder : colors.cardBorder;
  const bold = { fontFamily: typography['metric-display-mobile'].fontFamily, fontWeight: typography['metric-display-mobile'].fontWeight, fontVariant: ['tabular-nums'] };
  return StyleSheet.create({
    header: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      paddingLeft: 16,
      paddingRight: 16,
    },
    titleLink: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      flexShrink: 1,
    },
    title: {
      ...typography['label-lg'],
      fontSize: 12,
      lineHeight: 16,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      color: on,
    },
    caption: {
      ...typography['body-sm'],
      color: muted,
      flexShrink: 1,
    },
    body: {
      paddingHorizontal: 16,
      paddingBottom: 12,
      gap: 10,
    },
    metric: {
      ...typography['metric-display-mobile'],
      color: on,
    },
    unit: {
      ...typography['label-lg'],
      color: muted,
      letterSpacing: 0,
    },
    bar: {
      height: 8,
      flexDirection: 'row',
      gap: 2,
      borderRadius: 2,
      overflow: 'hidden',
    },
    barFill: {
      flexDirection: 'row',
      gap: 2,
    },
    empty: {
      ...typography['body-md'],
      color: muted,
    },
    split: {
      flexDirection: 'row',
      borderTopWidth: 1,
      borderTopColor: border,
    },
    cell: {
      flex: 1,
      minWidth: 0,
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 4,
    },
    cellDivider: {
      borderLeftWidth: 1,
      borderLeftColor: border,
    },
    cellKey: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    swatch: {
      width: 10,
      height: 10,
      borderRadius: 2,
    },
    cellLabel: {
      ...typography['label-md'],
      textTransform: 'uppercase',
      color: muted,
      flexShrink: 1,
    },
    cellValue: {
      ...bold,
      fontSize: 18,
      lineHeight: 22,
      color: on,
    },
  });
};

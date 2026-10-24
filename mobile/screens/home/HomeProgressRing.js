import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useTheme } from '../../theme/ThemeContext';
import { TYPOGRAPHY, useKuaTypography } from '../../theme/typography';

// Redesign v3 (#1605): Home's Exercise Progress ring and its legend. Purely
// presentational — the three counts are the canonical Exercise Progress
// summary (lib/data/exerciseProgress, via homeDashboardData) and the centre
// number is that summary's own `classified` count. Nothing here classifies.
const RING_SIZE = 96;
const STROKE = 10;
const SEGMENT_GAP = 3;

export function progressColors(colors, kua) {
  return {
    progressing: kua ? kua.completion : colors.success,
    steady: kua ? kua.warning : colors.caution,
    regressing: kua ? kua.errorText : colors.error,
    zero: kua ? kua.onSurfaceVariant : colors.textMuted,
    track: kua ? kua.surfaceSection : colors.subtleBg,
  };
}

// The ring's text equivalent, also the hero row's spoken summary.
export function progressSummaryText({ progressing, steady, regressing }) {
  return `${progressing} progressing, ${steady} steady, ${regressing} regressing`;
}

export function HomeProgressRing({ progressing = 0, steady = 0, regressing = 0, classified, size = RING_SIZE }) {
  const { colors, kuaPalette: kua } = useTheme();
  const typography = useKuaTypography();
  const styles = useMemo(() => createRingStyles(colors, kua, typography), [colors, kua, typography]);
  const tone = progressColors(colors, kua);
  const total = classified ?? progressing + steady + regressing;
  const r = size / 2 - STROKE / 2 - 1;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  const segments = [
    ['progressing', progressing, tone.progressing],
    ['steady', steady, tone.steady],
    ['regressing', regressing, tone.regressing],
  ].filter(([, v]) => v > 0).map(([key, v, color]) => {
    const len = total > 0 ? (v / total) * circumference : 0;
    // A lone segment is a full ring; otherwise each leaves a small gap.
    const dash = v === total ? len : Math.max(0, len - SEGMENT_GAP);
    const node = (
      <Circle
        key={key}
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={STROKE}
        strokeDasharray={`${dash} ${circumference}`}
        strokeDashoffset={-offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    );
    offset += len;
    return node;
  });

  return (
    <View testID="home-progress-ring" style={[styles.ring, { width: size, height: size }]} accessible={false} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone.track} strokeWidth={STROKE} />
        {segments}
      </Svg>
      <View style={styles.center} pointerEvents="none">
        <Text testID="home-progress-ring-total" style={styles.total}>{total}</Text>
        <Text style={styles.caption}>Exercises</Text>
      </View>
    </View>
  );
}

// Progressing / Steady / Regressing, one per line; a zero regressing count is
// muted rather than alarming.
export function HomeProgressLegend({ progressing = 0, steady = 0, regressing = 0 }) {
  const { colors, kuaPalette: kua } = useTheme();
  const typography = useKuaTypography();
  const styles = useMemo(() => createRingStyles(colors, kua, typography), [colors, kua, typography]);
  const tone = progressColors(colors, kua);
  const rows = [
    { key: 'progressing', label: 'Progressing', count: progressing, color: tone.progressing },
    { key: 'steady', label: 'Steady', count: steady, color: tone.steady },
    { key: 'regressing', label: 'Regressing', count: regressing, color: regressing ? tone.regressing : tone.zero },
  ];
  return (
    <View testID="home-progress-legend" style={styles.legend}>
      {rows.map(row => (
        <View key={row.key} testID={`home-progress-${row.key}`} style={styles.legendRow}>
          <Text style={[styles.legendCount, { color: row.color }]}>{row.count}</Text>
          <Text style={styles.legendLabel} numberOfLines={1}>{row.label}</Text>
        </View>
      ))}
    </View>
  );
}

const createRingStyles = (colors, kua = null, typography = TYPOGRAPHY) => StyleSheet.create({
  ring: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  total: {
    fontFamily: typography['metric-display-mobile'].fontFamily,
    fontWeight: typography['metric-display-mobile'].fontWeight,
    fontSize: 26,
    lineHeight: 30,
    fontVariant: ['tabular-nums'],
    color: kua ? kua.onSurface : colors.text,
  },
  // Chart-label exception to the 12px floor, as tab labels and chart axes (11px).
  caption: {
    ...typography['label-sm'],
    letterSpacing: 0,
    textTransform: 'uppercase',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  legend: {
    gap: 4,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    columnGap: 6,
  },
  legendLabel: {
    ...typography['body-md'],
    flexShrink: 1,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  legendCount: {
    fontFamily: typography['metric-display-mobile'].fontFamily,
    fontWeight: typography['metric-display-mobile'].fontWeight,
    fontSize: 15,
    lineHeight: 20,
  },
});

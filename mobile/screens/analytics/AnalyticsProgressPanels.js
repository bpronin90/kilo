import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { TYPOGRAPHY, useKuaTypography } from '../../theme/typography';
import { GEOMETRY } from '../../theme/spacing';

// Analytics Progress panels (redesign v3, #1604). Presentation only: callers
// pass display-space numbers from the existing 1K derivation and own every
// calculation. The 1K body is OneKProgressSummary's opt-in `variant="panel"`;
// Home keeps the default presentation.
const SERIES = ['chartSeries1', 'chartSeries2', 'chartSeries3'];
const LIFT_ORDER = ['squat', 'bench', 'deadlift'];

const groupDigits = n => Math.round(n).toLocaleString('en-US');

// "N to go" is the displayed target minus the displayed total (both already in
// the user's unit), never a recomputed 1K value.
export function oneKToGoText(total, target) {
  const remaining = Math.round(target - total);
  return remaining > 0 ? `${groupDigits(remaining)} to go` : 'Reached';
}

export function OneKPanelBody({
  total, target, unit, lifts, totalColor, emptyText, titleAccessory, belowTitle, children, id,
}) {
  const { colors, kuaPalette: kua } = useTheme();
  const typography = useKuaTypography();
  const styles = useMemo(() => createStyles(colors, kua, typography), [colors, kua, typography]);
  const seriesColor = (key) => {
    const i = Math.max(0, LIFT_ORDER.indexOf(key));
    return kua ? kua[SERIES[i]] : [colors.accent, colors.caution, colors.success][i];
  };
  const hasTotal = total != null;
  const segments = lifts.filter(l => l.value != null && l.value > 0);

  return (
    <View style={styles.body}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>1K Progress</Text>
        {titleAccessory}
      </View>
      {belowTitle ? <View style={styles.pad}>{belowTitle}</View> : null}
      {hasTotal ? (
        <View style={[styles.pad, styles.totalBlock]}>
          <View style={styles.totalRow}>
            <Text testID={id('total')} style={[styles.total, totalColor ? { color: totalColor } : null]}>
              {total.toFixed(0)}
              <Text style={styles.unit}> / {groupDigits(target)} {unit}</Text>
            </Text>
            <Text testID={id('to-go')} style={styles.toGo}>{oneKToGoText(total, target)}</Text>
          </View>
          <View testID={id('progress-track')} style={styles.track}>
            <View testID={id('progress-fill')} style={[styles.fill, { width: `${Math.min(100, (total / target) * 100)}%` }]}>
              {segments.map(l => (
                <View key={l.key} testID={id(`bar-${l.key}`)} style={{ flex: l.value, backgroundColor: seriesColor(l.key) }} />
              ))}
            </View>
          </View>
        </View>
      ) : emptyText ? (
        // The total needs one complete cycle of all three lifts (lib/data/oneK.js).
        <Text testID={id('setup')} style={[styles.pad, styles.empty]}>{emptyText}</Text>
      ) : null}
      {lifts.length > 0 ? (
        <View testID={id('big3')} style={styles.cells}>
          {lifts.map((item, i) => {
            const hasValue = item.value != null;
            const inner = (
              <>
                <View style={styles.cellKey}>
                  <View style={[styles.swatch, { backgroundColor: seriesColor(item.key) }]} />
                  <Text style={styles.cellLabel}>{item.label}</Text>
                </View>
                {/* Literal leading space in the nested unit, not a margin: a nested
                    Text is an inline run on native RN (#763). */}
                <Text>
                  <Text testID={id(`lift-${item.key}-value`)} style={styles.cellValue}>{hasValue ? item.value.toFixed(0) : 'N/A'}</Text>
                  {hasValue ? <Text style={styles.cellUnit}> {unit}</Text> : null}
                </Text>
              </>
            );
            const cellStyle = [styles.cell, i > 0 ? styles.cellDivider : null];
            return item.onPress && hasValue ? (
              <Pressable
                key={item.key}
                testID={id(`lift-${item.key}`)}
                style={cellStyle}
                onPress={item.onPress}
                accessibilityRole="button"
                accessibilityLabel={item.accessibilityLabel}
              >
                {inner}
              </Pressable>
            ) : (
              <View
                key={item.key}
                testID={id(`lift-${item.key}`)}
                style={cellStyle}
                accessible
                accessibilityLabel={hasValue ? `${item.label} ${item.value.toFixed(0)} ${unit}` : `${item.label} not available`}
              >
                {inner}
              </View>
            );
          })}
        </View>
      ) : null}
      {children}
    </View>
  );
}

const createStyles = (colors, kua = null, typography = TYPOGRAPHY) => {
  const on = kua ? kua.onSurface : colors.text;
  const muted = kua ? kua.onSurfaceVariant : colors.textMuted;
  const border = kua ? kua.surfaceBorder : colors.cardBorder;
  return StyleSheet.create({
    body: { alignSelf: 'stretch' },
    pad: { paddingHorizontal: 16 },
    header: {
      minHeight: 48,
      paddingLeft: 16,
      paddingRight: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      columnGap: 4,
    },
    title: {
      ...typography['label-lg'],
      fontSize: 12,
      lineHeight: 16,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      color: muted,
      flexShrink: 1,
    },
    totalBlock: { gap: 10, paddingBottom: 14 },
    totalRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      columnGap: 8,
    },
    total: {
      ...(kua ? { ...typography['metric-display-mobile'], fontSize: 36, lineHeight: 40 } : { fontSize: 36, lineHeight: 40, fontWeight: '800' }),
      color: on,
      flexShrink: 1,
    },
    unit: {
      ...typography['label-lg'],
      color: muted,
    },
    toGo: {
      ...typography['body-sm'],
      color: muted,
      flexShrink: 0,
    },
    track: {
      height: 8,
      flexDirection: 'row',
      overflow: 'hidden',
      borderRadius: GEOMETRY['radius-sm'],
      backgroundColor: border,
    },
    fill: {
      height: '100%',
      flexDirection: 'row',
      gap: 2,
    },
    empty: {
      ...typography['body-md'],
      color: muted,
      paddingBottom: 14,
    },
    // Wraps rather than ellipsizing at large text sizes; each lift is its own
    // >=44dp cell, ruled from its neighbour like the Home panel's split.
    cells: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      width: '100%',
      justifyContent: 'space-between',
      borderTopWidth: 1,
      borderTopColor: border,
    },
    cell: {
      flexGrow: 1,
      flexBasis: 0,
      minWidth: 88,
      minHeight: 44,
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 4,
    },
    cellDivider: { borderLeftWidth: 1, borderLeftColor: border },
    cellKey: { flexDirection: 'row', alignItems: 'center', columnGap: 6 },
    swatch: { width: 10, height: 10, borderRadius: 2 },
    cellLabel: {
      ...typography['label-md'],
      color: muted,
      textTransform: 'uppercase',
    },
    cellValue: {
      ...(kua ? typography['metric-display-mobile'] : { fontWeight: '700' }),
      fontSize: 22,
      lineHeight: 28,
      color: on,
    },
    cellUnit: {
      ...typography['label-md'],
      color: muted,
    },
  });
};

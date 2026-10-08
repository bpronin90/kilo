import { TYPOGRAPHY } from '../theme/typography';
import React, { useMemo } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../theme/ThemeContext';
import { useWeightUnit } from '../lib/unitPreference';
import { formatLiftWeightValue } from '../lib/units';

// Pure render helper, not a component: it is called inline from AnalyticsScreen
// rows rather than mounted, so it cannot hold a hook. The caller passes its own
// active palette (#689).
export function formatOverload(trend, colors, kua = null) {
  switch (trend) {
    case 'up':   return <MaterialIcons name="arrow-upward"    size={16} color={kua ? kua.completion : colors.success} />;
    case 'flat': return <Text style={{ color: kua ? kua.warning : colors.caution, fontSize: TYPOGRAPHY['body-md'].fontSize }}>↔</Text>;
    case 'dash': return <Text style={{ color: kua ? kua.warning : colors.caution, fontSize: TYPOGRAPHY['headline-sm'].fontSize, fontWeight: '900', lineHeight: 22 }}>—</Text>;
    case 'down': return <MaterialIcons name="arrow-downward"  size={16} color={kua ? kua.error : colors.error}   />;
    case 'baseline':
    case 'first_session': return <MaterialIcons name="fiber-manual-record" size={8} color={kua ? kua.onSurfaceVariant : colors.textMuted} style={{ opacity: 0.4 }} />;
    default:     return <Text style={{ color: kua ? kua.onSurfaceVariant : colors.textMuted, fontSize: TYPOGRAPHY['body-md'].fontSize }}>—</Text>;
  }
}

export function CrossDayComparison({ daySignals, currentDay, otherDays }) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStyles(colors, kua), [colors, kua]);
  const unit = useWeightUnit();
  const allDays = currentDay ? [currentDay, ...otherDays] : otherDays;
  return (
    <View style={styles.crossDayRow}>
      {allDays.map((day, i) => {
        const d = daySignals[day];
        const trendColor = d?.overload_trend === 'up' ? (kua ? kua.completion : colors.success)
          : d?.overload_trend === 'down' ? (kua ? kua.error : colors.error)
          : (kua ? kua.warning : colors.caution);
        const trendChar = d?.overload_trend === 'up' ? '↑'
          : d?.overload_trend === 'down' ? '↓'
          : d?.overload_trend === 'flat' ? '↔' : null;
        return (
          <React.Fragment key={day}>
            {i > 0 && <Text style={styles.crossDaySep}>·</Text>}
            <View style={styles.crossDayChip}>
              <Text style={[styles.crossDayChipLabel, day === currentDay && styles.crossDayChipLabelCurrent]}>
                {day ? day.slice(0, 3).toUpperCase() : '—'}
              </Text>
              <Text style={styles.crossDayChipValue}>
                {d?.latest_top_weight != null ? (d.is_bodyweight ? `${d.latest_top_weight}` : formatLiftWeightValue(d.latest_top_weight, unit)) : '—'}
                {d?.latest_top_weight != null && <Text style={styles.crossDayUnit}>{d.is_bodyweight ? 'reps' : unit}</Text>}
              </Text>
              {trendChar && <Text style={[styles.crossDayTrend, { color: trendColor }]}>{trendChar}</Text>}
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
}

const createStyles = (colors, kua = null) => StyleSheet.create({
  crossDayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    flexWrap: 'wrap',
    gap: 4,
  },
  crossDaySep: {
    fontSize: TYPOGRAPHY['label-sm'].fontSize,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    marginHorizontal: 2,
  },
  crossDayChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  crossDayChipLabel: {
    fontSize: TYPOGRAPHY['label-sm'].fontSize,
    fontWeight: '800',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    letterSpacing: 0.5,
  },
  crossDayChipLabelCurrent: {
    color: kua ? kua.onSurface : colors.text,
  },
  crossDayChipValue: {
    ...(kua
      ? TYPOGRAPHY['label-md']
      : { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }), fontWeight: '700', fontSize: TYPOGRAPHY['label-md'].fontSize }),
    color: kua ? kua.onSurface : colors.text,
  },
  crossDayUnit: {
    ...(kua ? TYPOGRAPHY['label-sm'] : { fontSize: TYPOGRAPHY['label-sm'].fontSize }),
    opacity: 0.5,
  },
  crossDayTrend: {
    ...(kua ? TYPOGRAPHY['label-sm'] : { fontSize: TYPOGRAPHY['label-sm'].fontSize, fontWeight: '700' }),
  },
});

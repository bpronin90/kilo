import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { useWeightUnit } from '../lib/unitPreference';
import { formatLiftWeightValue } from '../lib/units';

export function formatOverload(trend) {
  switch (trend) {
    case 'up':   return <MaterialIcons name="arrow-upward"    size={16} color={Colors.success} />;
    case 'flat': return <Text style={{ color: Colors.caution, fontSize: 14 }}>↔</Text>;
    case 'dash': return <Text style={{ color: Colors.caution, fontSize: 18, fontWeight: '900', lineHeight: 22 }}>—</Text>;
    case 'down': return <MaterialIcons name="arrow-downward"  size={16} color={Colors.error}   />;
    case 'baseline':
    case 'first_session': return <MaterialIcons name="fiber-manual-record" size={8} color={Colors.textMuted} style={{ opacity: 0.4 }} />;
    default:     return <Text style={{ color: Colors.textMuted, fontSize: 14 }}>—</Text>;
  }
}

export function CrossDayComparison({ daySignals, currentDay, otherDays }) {
  const unit = useWeightUnit();
  const allDays = currentDay ? [currentDay, ...otherDays] : otherDays;
  return (
    <View style={styles.crossDayRow}>
      {allDays.map((day, i) => {
        const d = daySignals[day];
        const trendColor = d?.overload_trend === 'up' ? Colors.success
          : d?.overload_trend === 'down' ? Colors.error
          : Colors.caution;
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

const styles = StyleSheet.create({
  crossDayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    flexWrap: 'wrap',
    gap: 4,
  },
  crossDaySep: {
    fontSize: 11,
    color: Colors.textMuted,
    marginHorizontal: 2,
  },
  crossDayChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  crossDayChipLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: Colors.textMuted,
    letterSpacing: 0.5,
  },
  crossDayChipLabelCurrent: {
    color: Colors.text,
  },
  crossDayChipValue: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.text,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },
  crossDayUnit: {
    fontSize: 11,
    opacity: 0.5,
  },
  crossDayTrend: {
    fontSize: 11,
    fontWeight: '700',
  },
});

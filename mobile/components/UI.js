import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors } from '../theme/colors';

export const SET_ROW_FONT_SIZE = 14;

export const HeroMetric = {
  hero:          { fontSize: 48, fontWeight: '900', lineHeight: 52 },
  statPrimary:   { fontSize: 32, fontWeight: '900' },
  statSecondary: { fontSize: 24, fontWeight: '900' },
  statTertiary:  { fontSize: 20, fontWeight: '900' },
};

export { LineChart } from './LineChart';

export function Card({ children, style, tone = 'default', onPress }) {
  const Container = onPress ? Pressable : View;
  
  const baseStyles = [
    styles.card,
    tone === 'accent' ? styles.cardAccent : null,
    tone === 'success' ? styles.cardSuccess : null,
    tone === 'error' ? styles.cardError : null,
    tone === 'warn' ? styles.cardWarn : null,
    style
  ];

  if (!onPress) {
    return <View style={baseStyles}>{children}</View>;
  }

  return (
    <Pressable 
      onPress={onPress}
      style={({ pressed }) => [
        ...baseStyles,
        pressed ? { opacity: 0.7 } : null
      ]}
    >
      {children}
    </Pressable>
  );
}

export function SectionTitle({ children }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function Button({ onPress, title, style, textStyle, disabled = false }) {
  return (
    <Pressable
      onPress={disabled ? null : onPress}
      style={[styles.button, disabled ? styles.buttonDisabled : null, style]}
    >
      <Text style={[styles.buttonText, textStyle]}>{disabled ? 'Saving…' : title}</Text>
    </Pressable>
  );
}

export function getSessionTone(count) {
  if (count >= 10) return 'error';
  if (count >= 7) return 'warn';
  if (count >= 1) return 'success';
  return 'default';
}

// Deload-risk caption for a session-depth count. Zone boundaries (1 / 7 / 10)
// mirror getSessionTone. The 10+ caption is fixed per the issue contract.
export function getSessionZoneCaption(count) {
  if (count >= 10) return 'Consider a deload week';
  if (count >= 7) return 'Approaching deload';
  if (count >= 1) return 'Building volume';
  return 'No sessions logged';
}

const _SESSION_GAUGE_TONE_COLORS = {
  success: Colors.success,
  warn: Colors.caution,
  error: Colors.error,
  default: Colors.textMuted,
};

// Deload-risk meter: a three-zone scale (Building / Approaching / Deload) with a
// knob marking the current session depth — the UV-index / AQI pattern. Zone widths
// are proportional to their session ranges (1–6 / 7–9 / 10+) and the boundaries
// (6, 9) mirror getSessionTone. The knob is positioned on a 0–11 unit scale so
// session counts map linearly onto the zone segments.
export function SessionGauge({ count, total }) {
  const tone = getSessionTone(count);
  const toneColor = _SESSION_GAUGE_TONE_COLORS[tone] || Colors.textMuted;
  const caption = getSessionZoneCaption(count);
  const markerPct = (Math.min(count, 11) / 11) * 100;
  const label = total != null ? 'Since deload' : 'Sessions logged';

  return (
    <Card style={styles.sessionGauge}>
      <View style={styles.sessionGaugeHeader}>
        <Text style={styles.sessionGaugeLabel}>{label}</Text>
        <View style={styles.sessionGaugeCountRow}>
          {total != null && (
            <Text style={styles.sessionGaugeTotalStat}>{total} total</Text>
          )}
          <Text style={[styles.sessionGaugeCount, { color: toneColor }]}>{count}</Text>
        </View>
      </View>

      <View style={styles.gaugeMeterWrap}>
        <View style={styles.gaugeBar}>
          <View style={[styles.gaugeSeg, styles.gaugeSegLeft, { flex: 6, backgroundColor: Colors.success }]} />
          <View style={[styles.gaugeSeg, { flex: 3, backgroundColor: Colors.caution }]} />
          <View style={[styles.gaugeSeg, styles.gaugeSegRight, { flex: 2, backgroundColor: Colors.error }]} />
        </View>
        <View style={[styles.gaugeMarker, { left: `${markerPct}%`, borderColor: toneColor }]} />
      </View>

      <View style={styles.gaugeZoneLabels}>
        <Text style={[styles.gaugeZoneLabel, { flex: 6 }]}>Building</Text>
        <Text style={[styles.gaugeZoneLabel, styles.gaugeZoneLabelCenter, { flex: 3 }]}>Approaching</Text>
        <Text style={[styles.gaugeZoneLabel, styles.gaugeZoneLabelRight, { flex: 2 }]}>Deload</Text>
      </View>

      <Text style={[styles.sessionGaugeCaption, { color: toneColor }]}>{caption}</Text>
    </Card>
  );
}

export function StatCard({ label, value, tone = 'default' }) {
  const isDarkTone = ['accent', 'success', 'error', 'warn'].includes(tone);
  return (
    <Card tone={tone} style={styles.statCard}>
      <Text style={[styles.statLabel, isDarkTone ? styles.textLight : null]}>{label}</Text>
      <Text style={[styles.statValue, isDarkTone ? styles.textLight : null]}>{value}</Text>
    </Card>
  );
}

export function Badge({ children, status = 'default' }) {
  const isDarkStatus = ['improved', 'regressed', 'held'].includes(status);
  return (
    <View style={[styles.badge, styles[`badge_${status}`]]}>
      <Text style={[styles.badgeText, isDarkStatus ? styles.textLight : null]}>
        {children}
      </Text>
    </View>
  );
}

export function Chip({ children }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{children}</Text>
    </View>
  );
}

export function WorkoutHeading({ children, style, selectable }) {
  return <Text selectable={selectable} style={[styles.workoutHeading, style]}>{children}</Text>;
}

export function WorkoutSubheading({ children, selectable }) {
  return (
    <View style={styles.subheadingContainer}>
      <Text selectable={selectable} style={styles.workoutSubheading}>{children}</Text>
      <View style={styles.subheadingLine} />
    </View>
  );
}

export function ExerciseBlock({ name, children, isTracked, onToggleTrack, disabledTrack, selectable }) {
  const TrackContainer = (disabledTrack || !onToggleTrack) ? View : Pressable;

  return (
    <View style={styles.exerciseBlock}>
      <View style={styles.exerciseHeader}>
        <Text selectable={selectable} style={styles.exerciseName}>{name}</Text>
        {(onToggleTrack || disabledTrack) && (
          <TrackContainer 
            onPress={disabledTrack ? null : onToggleTrack}
            disabled={disabledTrack}
            accessibilityState={disabledTrack ? { disabled: true } : undefined}
            style={[
              styles.trackToggle,
              isTracked ? styles.trackToggleActive : null,
              disabledTrack ? styles.trackToggleDisabled : null
            ]}
          >
            <Text selectable={selectable} style={[
              styles.trackToggleText,
              isTracked ? styles.trackToggleTextActive : null,
              disabledTrack ? styles.trackToggleTextDisabled : null
            ]}>
              {isTracked ? 'Tracked' : 'Track'}
            </Text>
          </TrackContainer>
        )}
      </View>
      <View style={styles.exerciseContent}>
        {children}
      </View>
    </View>
  );
}

export function SetLine({ sets, selectable }) {
  if (!sets || sets.length === 0) return null;
  
  const groups = [];
  let currentGroup = null;

  for (const set of sets) {
    if (!currentGroup || currentGroup.weight !== set.weight_value) {
      currentGroup = { weight: set.weight_value, reps: [] };
      groups.push(currentGroup);
    }
    currentGroup.reps.push(set.rep_count);
  }
  
  return (
    <View style={styles.setLine}>
      {groups.map((group, i) => (
        <View key={i} style={styles.setGroup}>
          <Text selectable={selectable} style={styles.setWeight}>{group.weight ? `${group.weight} lb` : 'BW'}</Text>
          <Text selectable={selectable} style={styles.setReps}>{group.reps.join(', ')}</Text>
        </View>
      ))}
    </View>
  );
}

export function ArtisanalPanel({ children, style }) {
  return <View style={[styles.artisanalPanel, style]}>{children}</View>;
}

export function ErrorBanner({ message, onRetry }) {
  return (
    <View style={styles.errorBanner}>
      <Text style={styles.errorBannerText}>{message || 'Failed to load data.'}</Text>
      {onRetry && (
        <Pressable onPress={onRetry} style={styles.errorBannerRetry}>
          <Text style={styles.errorBannerRetryText}>Retry</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  errorBanner: {
    backgroundColor: '#fff0f0',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.error,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  errorBannerText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.error,
  },
  errorBannerRetry: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: Colors.error,
  },
  errorBannerRetryText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  card: {
    backgroundColor: Colors.card,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    gap: 10,
  },
  artisanalPanel: {
    backgroundColor: Colors.panelBackground,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.divider,
    shadowColor: Colors.text,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 2,
    overflow: 'hidden',
  },
  cardAccent: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  cardSuccess: {
    backgroundColor: Colors.success,
    borderColor: Colors.success,
  },
  cardError: {
    backgroundColor: Colors.error,
    borderColor: Colors.error,
  },
  cardWarn: {
    backgroundColor: Colors.caution,
    borderColor: Colors.caution,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginTop: 6,
  },
  button: {
    backgroundColor: Colors.text,
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonText: {
    color: Colors.textLight,
    fontSize: 16,
    fontWeight: '700',
  },
  statCard: {
    flex: 1,
    minWidth: '45%',
  },
  sessionGauge: {
    flex: 1,
    gap: 10,
  },
  sessionGaugeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  sessionGaugeLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sessionGaugeCount: {
    fontSize: 28,
    fontWeight: '900',
  },
  sessionGaugeCountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  sessionGaugeTotalStat: {
    fontSize: 13,
    color: Colors.textMuted,
    fontWeight: '600',
  },
  gaugeMeterWrap: {
    width: '100%',
    height: 16,
    justifyContent: 'center',
  },
  gaugeBar: {
    flexDirection: 'row',
    width: '100%',
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
  },
  gaugeSeg: {
    height: '100%',
  },
  gaugeSegLeft: {
    borderTopLeftRadius: 5,
    borderBottomLeftRadius: 5,
  },
  gaugeSegRight: {
    borderTopRightRadius: 5,
    borderBottomRightRadius: 5,
  },
  gaugeMarker: {
    position: 'absolute',
    top: 0,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Colors.card,
    borderWidth: 3,
    transform: [{ translateX: -8 }],
  },
  gaugeZoneLabels: {
    flexDirection: 'row',
    width: '100%',
    marginTop: 4,
  },
  gaugeZoneLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  gaugeZoneLabelCenter: {
    textAlign: 'center',
  },
  gaugeZoneLabelRight: {
    textAlign: 'right',
  },
  sessionGaugeCaption: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 2,
  },
  statLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textMuted,
  },
  statValue: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.text,
  },
  textLight: {
    color: Colors.textLight,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: Colors.chipBackground,
  },
  badge_improved: {
    backgroundColor: Colors.success,
  },
  badge_regressed: {
    backgroundColor: Colors.error,
  },
  badge_held: {
    backgroundColor: Colors.accent,
  },
  badge_first_session: {
    backgroundColor: Colors.chipBackground,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: Colors.chipText,
    textTransform: 'uppercase',
  },
  chip: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.chipBackground,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.chipText,
  },
  workoutHeading: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.text,
    marginTop: 24,
    marginBottom: 8,
    textTransform: 'capitalize',
  },
  subheadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 16,
    marginBottom: 12,
  },
  workoutSubheading: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  subheadingLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.cardBorder,
    opacity: 0.5,
  },
  exerciseBlock: {
    marginBottom: 20,
    gap: 6,
  },
  exerciseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  exerciseName: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text,
    flex: 1,
  },
  trackToggle: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    backgroundColor: 'transparent',
  },
  trackToggleActive: {
    backgroundColor: Colors.chipBackground,
    borderColor: Colors.chipBackground,
  },
  trackToggleDisabled: {
    opacity: 0.4,
    borderColor: Colors.cardBorder,
  },
  trackToggleText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textMuted,
  },
  trackToggleTextActive: {
    color: Colors.chipText,
  },
  trackToggleTextDisabled: {
    color: Colors.textMuted,
  },
  exerciseContent: {
    paddingLeft: 4,
    gap: 4,
  },
  setLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  setGroup: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  setWeight: {
    fontSize: SET_ROW_FONT_SIZE,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  setReps: {
    fontSize: SET_ROW_FONT_SIZE,
    fontWeight: '400',
    color: Colors.text,
  },
});

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors } from '../theme/colors';

export const SET_ROW_FONT_SIZE = 14;

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

export function WorkoutHeading({ children }) {
  return <Text style={styles.workoutHeading}>{children}</Text>;
}

export function WorkoutSubheading({ children }) {
  return (
    <View style={styles.subheadingContainer}>
      <Text style={styles.workoutSubheading}>{children}</Text>
      <View style={styles.subheadingLine} />
    </View>
  );
}

export function ExerciseBlock({ name, children, isTracked, onToggleTrack, disabledTrack }) {
  const TrackContainer = (disabledTrack || !onToggleTrack) ? View : Pressable;

  return (
    <View style={styles.exerciseBlock}>
      <View style={styles.exerciseHeader}>
        <Text style={styles.exerciseName}>{name}</Text>
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
            <Text style={[
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

export function SetLine({ sets }) {
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
          <Text style={styles.setWeight}>{group.weight ? `${group.weight} lb` : 'BW'}</Text>
          <Text style={styles.setReps}>{group.reps.join(', ')}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    gap: 10,
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
    backgroundColor: Colors.accent, // Using accent as a warning color for now
    borderColor: Colors.accent,
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
    fontSize: 24,
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

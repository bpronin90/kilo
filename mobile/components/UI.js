import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors } from '../theme/colors';

export function Card({ children, style, tone = 'default' }) {
  return (
    <View style={[
      styles.card, 
      tone === 'accent' ? styles.cardAccent : null,
      style
    ]}>
      {children}
    </View>
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
  return (
    <Card tone={tone} style={styles.statCard}>
      <Text style={[styles.statLabel, tone === 'accent' ? styles.textLight : null]}>{label}</Text>
      <Text style={[styles.statValue, tone === 'accent' ? styles.textLight : null]}>{value}</Text>
    </Card>
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

export function ExerciseBlock({ name, children }) {
  return (
    <View style={styles.exerciseBlock}>
      <Text style={styles.exerciseName}>{name}</Text>
      <View style={styles.exerciseContent}>
        {children}
      </View>
    </View>
  );
}

export function SetLine({ sets }) {
  if (!sets || sets.length === 0) return null;
  
  // Group sets by weight for cleaner display: "135 x 5, 5, 5"
  const weight = sets[0].weight_value;
  const reps = sets.map(s => s.rep_count).join(', ');
  
  return (
    <View style={styles.setLine}>
      <Text style={styles.setWeight}>{weight ? `${weight} lb` : 'Bodyweight'}</Text>
      <Text style={styles.setReps}>{reps}</Text>
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
  exerciseName: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text,
  },
  exerciseContent: {
    paddingLeft: 4,
    gap: 4,
  },
  setLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  setWeight: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textMuted,
    width: 65,
  },
  setReps: {
    fontSize: 16,
    fontWeight: '400',
    color: Colors.text,
  },
});

import React, { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ScreenShell } from './ScreenShell';
import { Card, SectionTitle } from './UI';
import { useThemedStyles } from '../theme/ThemeContext';
import { useWeightUnit } from '../lib/unitPreference';
import { formatLiftWeightValue } from '../lib/units';
import { WorkoutSyntaxReference } from './WorkoutSyntaxReference';

const TOPICS = [
  ['start', 'Start here'],
  ['logging', 'Log workouts'],
  ['weight', 'Weight'],
  ['analytics', 'Analytics'],
  ['backup', 'Backup & import'],
  ['account', 'Account & sync'],
  ['settings', 'Privacy & settings'],
  ['terms', 'Terms & definitions'],
];

export function HelpScreen({ onBack }) {
  const styles = useThemedStyles(createStyles);
  const unit = useWeightUnit();
  const scrollRef = useRef(null);
  const sectionY = useRef({});
  const oneKTotalLabel = unit === 'kg' ? `${formatLiftWeightValue(1000, 'kg')} kg` : '1,000 lb';

  const jumpTo = (id) => {
    scrollRef.current?.scrollTo({
      y: Math.max(0, (sectionY.current[id] || 0) - 12),
      animated: true,
    });
  };

  const renderSection = (id, title, children) => (
    <View
      key={id}
      onLayout={(event) => {
        sectionY.current[id] = event.nativeEvent.layout.y;
      }}
    >
      <SectionTitle>{title}</SectionTitle>
      <Card>{children}</Card>
    </View>
  );

  return (
    <ScreenShell
      ref={scrollRef}
      title="App Guide"
      subtitle="A quick reference for using Kilo."
      onBack={onBack}
    >
      <Card>
        <Text style={styles.helpHeading} accessibilityRole="header">
          How Kilo works
        </Text>
        <Text style={styles.helpText}>
          Kilo is an offline-first training log. Jump directly to a topic section:
        </Text>
        <View accessibilityRole="list" style={styles.tocGrid}>
          {TOPICS.map(([id, title]) => (
            <Pressable
              key={id}
              accessibilityRole="button"
              accessibilityLabel={`Read ${title}`}
              onPress={() => jumpTo(id)}
              style={styles.tocChip}
            >
              <Text style={styles.tocChipText}>{title}</Text>
            </Pressable>
          ))}
        </View>
      </Card>

      <View style={styles.sections}>
        {renderSection(
          'start',
          'Start here',
          <>
            <Text style={styles.subheading}>Main Navigation</Text>
            <Text style={styles.helpText}>
              • Home: View your weekly overview and progress snapshot.{'\n'}
              • Log: Record workout notes, view past routines, or plan deloads.{'\n'}
              • Weight: Track daily body weight, moving averages, and goal pace.{'\n'}
              • Analytics: Review long-term strength trends, fatigue, and Recovery.{'\n'}
              • More: Access settings, profile, backup/sync, and this guide.
            </Text>
          </>
        )}

        {renderSection(
          'logging',
          'Log workouts',
          <>
            <Text style={styles.subheading}>Syntax Reference</Text>
            <Text style={styles.helpText}>
              • Write a routine as plain text; Kilo parses headings, exercises, sets, reps, and weight.
            </Text>
            <View style={styles.syntaxContainer}>
              <WorkoutSyntaxReference />
            </View>
            <Text style={[styles.subheading, styles.sectionSubheading]}>Tracking & Progression</Text>
            <Text style={styles.helpText}>
              • Logging does not track an exercise. Tap Track beside a parsed exercise to include it in Progressive Overload.{'\n'}
              • Every explicit Track opens a fresh progression span. First session appears while it builds; Est. Max, Kilo Max, and best set keep showing full history.{'\n'}
              • Some exercises may already be tracked from a catalog default or an earlier app version. Deload mode can generate a planned lower-volume week from Log.
            </Text>
          </>
        )}

        {renderSection(
          'weight',
          'Weight',
          <>
            <Text style={styles.subheading}>Weigh-in & Trends</Text>
            <Text style={styles.helpText}>
              • Enter daily body weight in the Weight tab.{'\n'}
              • Kilo calculates 7-day moving averages to smooth out day-to-day fluctuations.{'\n'}
              • Pace flag warns if body weight changes faster than ~1.5% per week.{'\n'}
              • All values update automatically according to your preferred weight unit (kg/lb).
            </Text>
          </>
        )}

        {renderSection(
          'analytics',
          'Analytics',
          <>
            <Text style={styles.subheading}>Performance & Recovery</Text>
            <Text style={styles.helpText}>
              • Weight trend charts display 7-day and 30-day moving averages.{'\n'}
              • Combined Big 3 progress covers mapped squat, bench, and deadlift lifts when enough complete logged cycles exist.{'\n'}
              • Progressive Overload shows Est. Max, Kilo Max, best set, and progress trend for tracked exercises.{'\n'}
              • When fatigue tracking is enabled, check-ins add volume-decline context. Recovery compares a planned block with its baseline; it is training information, not medical advice.
            </Text>
          </>
        )}

        {renderSection(
          'backup',
          'Backup & import',
          <>
            <Text style={styles.subheading}>Data Management</Text>
            <Text style={styles.helpText}>
              • Data & Backup exports a local backup file to save or transfer to another device.{'\n'}
              • Preserves core workout notes, body weight logs, goals, fatigue ratings, and deload/recovery records.{'\n'}
              • Omits profile settings, reminders, unit preferences, and tracked-lift enrollment spans.{'\n'}
              • CSV export is for external tools and omits additional app state. Always review the confirmation dialog before overwriting local data.
            </Text>
          </>
        )}

        {renderSection(
          'account',
          'Account & sync',
          <>
            <Text style={styles.subheading}>Offline & Cloud</Text>
            <Text style={styles.helpText}>
              • Offline-first: Kilo works without an account and stores working data on this device.{'\n'}
              • Optional Cloud Sync reconciles data across multiple devices.{'\n'}
              • First-time setup: Sign in, choose "Upload local history" once, then tap "Sync now" for future updates.{'\n'}
              • Account deletion: Deleting your cloud account removes remote backups while leaving local device history intact.
            </Text>
          </>
        )}

        {renderSection(
          'settings',
          'Privacy & settings',
          <>
            <Text style={styles.subheading}>App Control & Privacy</Text>
            <Text style={styles.helpText}>
              • Settings controls appearance, units, reminders, deload, and optional fatigue/progression features.{'\n'}
              • Kilo works fully offline; read the Privacy Policy from More → About.{'\n'}
              • Local backup files remain on-device, and CSV export files are stored unencrypted.
            </Text>
          </>
        )}

        {renderSection(
          'terms',
          'Terms & definitions',
          <>
            <Text style={styles.subheading}>Key Terminology</Text>
            <Text style={styles.helpText}>
              • Est. Max: Estimated one-rep max derived from set performance.{'\n'}
              • Kilo Max: Est. Max adjusted for fatigue check-in context.{'\n'}
              • 1K Progress: Combined estimated squat, bench, and deadlift total; the goal is {oneKTotalLabel}.{'\n'}
              • Track: Enrolls an exercise into Progressive Overload tracking.{'\n'}
              • Pace Flag: Alert displayed when weight changes faster than the target threshold.{'\n'}
              • Recovery: A planned lower-load block compared against your training baseline.
            </Text>
          </>
        )}
      </View>
    </ScreenShell>
  );
}

const createStyles = (colors) =>
  StyleSheet.create({
    helpHeading: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 4 },
    subheading: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 6 },
    sectionSubheading: { marginTop: 12 },
    helpText: { fontSize: 15, lineHeight: 22, color: colors.textMuted },
    tocGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 12,
    },
    tocChip: {
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: 8,
      backgroundColor: colors.cardBorder,
      borderWidth: 1,
      borderColor: colors.cardBorder,
    },
    tocChipText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.text,
    },
    sections: { gap: 16, marginTop: 16 },
    syntaxContainer: { marginVertical: 8 },
  });



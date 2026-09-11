import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { ScreenShell } from './ScreenShell';
import { useThemedStyles } from '../theme/ThemeContext';
import { useTheme } from '../theme/ThemeContext';
import { useWeightUnit } from '../lib/unitPreference';
import { formatLiftWeightValue } from '../lib/units';
import { WorkoutSyntaxReference } from './WorkoutSyntaxReference';

// Help is a six-row inline accordion (#1019). Each topic row uses the same
// list-row language as the More menu (title, muted one-line summary, trailing
// chevron) and reveals its help content directly beneath the row. Exactly one
// topic is open at a time; expanding is local state only, so it never creates
// a navigation entry or consumes Android/system Back. Detail is rendered only
// while its topic is open — there is deliberately no always-visible manual and
// no in-page anchor navigation.

function Body({ styles, children }) {
  return <View style={styles.body}>{children}</View>;
}

function Chunk({ styles, label, children }) {
  return (
    <View style={styles.chunk}>
      {label ? (
        <Text style={styles.chunkLabel} accessibilityRole="header">
          {label}
        </Text>
      ) : null}
      <Text style={styles.bodyText}>{children}</Text>
    </View>
  );
}

export function HelpScreen({ onBack }) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const unit = useWeightUnit();
  const [openId, setOpenId] = useState(null);
  const oneKTotalLabel = unit === 'kg' ? `${formatLiftWeightValue(1000, 'kg')} kg` : '1,000 lb';

  const TOPICS = [
    {
      id: 'logging',
      title: 'Logging workouts',
      summary: 'Routines, syntax, tracking & progression',
      content: (
        <Body styles={styles}>
          <Chunk styles={styles} label="Writing a routine">
            Write a workout as plain text — Kilo parses headings, exercises, sets, reps, and weight
            as you type.
          </Chunk>
          <View style={styles.syntaxContainer}>
            <WorkoutSyntaxReference />
          </View>
          <Chunk styles={styles} label="Track & Tracked">
            Logging does not track an exercise. Tap Track beside an exercise to add it to
            Progressive Overload; it then reads Tracked.
          </Chunk>
          <Chunk styles={styles} label="Progression spans">
            Every explicit Track opens a fresh progression span. First session shows while it
            builds, while Est. Max, Kilo Max, and best set keep showing full history. Some exercises
            are already Tracked from a catalog default or an earlier app version.
          </Chunk>
        </Body>
      ),
    },
    {
      id: 'recovery',
      title: 'Recovery & deloads',
      summary: 'Recovery blocks, deloads, and when each appears',
      content: (
        <Body styles={styles}>
          <Chunk styles={styles} label="Recovery">
            A Recovery block is a planned lighter-load stretch measured against your training
            baseline. Start and review it from the Log tab.
          </Chunk>
          <Chunk styles={styles} label="Deload">
            A deload turns your current routine into a single lower-volume week. Enable deload mode
            in Settings → Features; the Deload tab then appears in Log.
          </Chunk>
          <Chunk styles={styles} label="Not medical advice">
            Recovery information is training information, not medical advice.
          </Chunk>
        </Body>
      ),
    },
    {
      id: 'progress',
      title: 'Progress & analytics',
      summary: 'Est. Max, Kilo Max, Progressive Overload, charts',
      content: (
        <Body styles={styles}>
          <Chunk styles={styles} label="Progressive Overload">
            Progressive Overload shows Est. Max, Kilo Max, best set, and progress trend for
            exercises you Track.
          </Chunk>
          <Chunk styles={styles} label="Est. Max & Kilo Max">
            Est. Max is your estimated one-rep max from recent sets. Kilo Max averages Epley
            estimates from eligible historical sets, then applies the fatigue multiplier you set in
            Settings.
          </Chunk>
          <Chunk styles={styles} label="Charts & Big 3">
            Weight trend charts show 7-day and 30-day moving averages. Combined Big 3 covers mapped
            squat, bench, and deadlift lifts once enough complete logged cycles exist; the 1K goal
            is a combined estimated total of {oneKTotalLabel}.
          </Chunk>
          <Chunk styles={styles}>
            When fatigue tracking is enabled, check-ins add volume-decline context.
          </Chunk>
        </Body>
      ),
    },
    {
      id: 'weight',
      title: 'Weight tracking',
      summary: 'Entries, trends, goals, and pace',
      content: (
        <Body styles={styles}>
          <Chunk styles={styles} label="Weigh-ins">
            Enter body weight in the Weight tab; values follow your chosen unit.
          </Chunk>
          <Chunk styles={styles} label="Trends">
            A 7-day moving average smooths day-to-day swings so the trend reflects real change.
          </Chunk>
          <Chunk styles={styles} label="Goals & pace">
            Set a goal to see projected pace. A pace flag warns when weight changes faster than
            about 1.5% per week.
          </Chunk>
        </Body>
      ),
    },
    {
      id: 'backup',
      title: 'Backup, sync & moving phones',
      summary: 'Local backup, Cloud Sync, CSV, routine import',
      content: (
        <Body styles={styles}>
          <Chunk styles={styles} label="Works offline">
            Kilo works offline and without an account; your data lives on this device.
          </Chunk>
          <Chunk styles={styles} label="Local backup">
            Data & Backup exports a local backup file with your workout notes, weight logs, current
            weight goal, deload and recovery history, profile and unit settings, tracked-lift
            enrollment, feature toggles, and the current deload note. Account email is excluded.
          </Chunk>
          <Chunk styles={styles} label="Cloud Sync & new phones">
            Optional Cloud Sync keeps data current across devices. On a clean new phone, sign in and
            choose Download My Account's Data to restore your cloud history.
          </Chunk>
          <Chunk styles={styles} label="CSV & routine import">
            CSV export is for other tools, not a full backup. Import Routine (in More) creates a new
            routine from pasted text.
          </Chunk>
        </Body>
      ),
    },
    {
      id: 'settings',
      title: 'Settings & privacy',
      summary: 'Units, appearance, reminders, optional features, local/cloud data',
      content: (
        <Body styles={styles}>
          <Chunk styles={styles} label="Preferences">
            Settings controls appearance, units, reminders, and optional deload, fatigue, and
            progression features.
          </Chunk>
          <Chunk styles={styles} label="Your data">
            Your data stays on this device unless you enable Cloud Sync, which syncs your training
            data to your account. Exported backup and CSV files are unencrypted and leave the device
            only when you share or save them.
          </Chunk>
          <Chunk styles={styles} label="Privacy Policy">
            Read the Privacy Policy from More → About Kilo.
          </Chunk>
        </Body>
      ),
    },
  ];

  return (
    <ScreenShell title="Help" subtitle="Quick answers for using Kilo." onBack={onBack}>
      <View style={styles.list}>
        {TOPICS.map(({ id, title, summary, content }) => {
          const isOpen = openId === id;
          return (
            <View key={id} style={styles.topic}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={title}
                accessibilityState={{ expanded: isOpen }}
                onPress={() => setOpenId(isOpen ? null : id)}
                style={styles.row}
              >
                <View style={styles.rowCopy}>
                  <Text style={styles.rowTitle}>{title}</Text>
                  <Text style={styles.rowSummary}>{summary}</Text>
                </View>
                <MaterialIcons
                  name={isOpen ? 'expand-less' : 'expand-more'}
                  size={22}
                  color={colors.textMuted}
                  accessible={false}
                />
              </Pressable>
              {isOpen ? content : null}
            </View>
          );
        })}
      </View>
    </ScreenShell>
  );
}

const createStyles = (colors) =>
  StyleSheet.create({
    list: { gap: 12 },
    topic: {
      backgroundColor: colors.card,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      minHeight: 44,
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 20,
      gap: 12,
    },
    rowCopy: { flex: 1, gap: 4 },
    rowTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
    rowSummary: { fontSize: 13, color: colors.textMuted },
    body: {
      paddingHorizontal: 20,
      paddingBottom: 20,
      paddingTop: 4,
      gap: 14,
    },
    chunk: { gap: 4 },
    chunkLabel: { fontSize: 14, fontWeight: '700', color: colors.text },
    bodyText: { fontSize: 15, lineHeight: 22, color: colors.textMuted },
    syntaxContainer: { marginVertical: 2 },
  });

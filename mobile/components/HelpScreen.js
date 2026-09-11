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
            Write a workout as plain text. Kilo parses headings, exercises, sets, reps, and weight
            as you type — no forms to fill in.
          </Chunk>
          <View style={styles.syntaxContainer}>
            <WorkoutSyntaxReference />
          </View>
          <Chunk styles={styles} label="Track & Tracked">
            Logging does not track an exercise. Tap Track beside a parsed exercise to include it in
            Progressive Overload; it then reads Tracked.
          </Chunk>
          <Chunk styles={styles} label="Progression spans">
            Every explicit Track opens a fresh progression span. First session appears while it
            builds, and Est. Max, Kilo Max, and best set keep showing full history.
          </Chunk>
          <Chunk styles={styles}>
            Some exercises may already be tracked from a catalog default or an earlier app version,
            rather than an explicit choice of yours.
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
            A Recovery block is a planned lower-load stretch compared against your training
            baseline. Start and review it from the Log tab; its status also surfaces in Analytics.
          </Chunk>
          <Chunk styles={styles} label="Deload">
            A deload generates a planned lower-volume week from your current routine. Turn deload
            mode on from Log when you want that lighter week.
          </Chunk>
          <Chunk styles={styles} label="The difference">
            A deload is a single lighter week derived from a routine; a Recovery block is a tracked
            span measured against your baseline. Recovery information is training information, not
            medical advice.
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
            Progressive Overload shows Est. Max, Kilo Max, best set, and progress trend for tracked
            exercises. An exercise appears here only after you Track it.
          </Chunk>
          <Chunk styles={styles} label="Est. Max & Kilo Max">
            Est. Max is the estimated one-rep max derived from your set performance. Kilo Max is
            that estimate adjusted for fatigue check-in context.
          </Chunk>
          <Chunk styles={styles} label="Trends & Big 3">
            Weight trend charts display 7-day and 30-day moving averages. Combined Big 3 progress
            covers mapped squat, bench, and deadlift lifts when enough complete logged cycles exist;
            the 1K goal is a combined estimated total of {oneKTotalLabel}.
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
            Enter body weight in the Weight tab. Values follow your preferred unit (kg or lb).
          </Chunk>
          <Chunk styles={styles} label="Trends">
            Kilo shows a 7-day moving average to smooth out day-to-day swings, so the trend line
            reflects real change rather than a single heavy or light morning.
          </Chunk>
          <Chunk styles={styles} label="Goals & pace">
            Set a weight goal to see projected pace. A pace flag warns when body weight is changing
            faster than about 1.5% per week.
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
          <Chunk styles={styles} label="Offline first">
            Kilo works without an account and keeps your working data on this device.
          </Chunk>
          <Chunk styles={styles} label="Local backup">
            Data & Backup exports a local backup file. It preserves core workout notes, body weight
            logs, goals, fatigue ratings, and deload/recovery records. It omits profile settings,
            reminders, unit preferences, and tracked-lift enrollment spans.
          </Chunk>
          <Chunk styles={styles} label="Cloud Sync & new phones">
            Optional Cloud Sync reconciles data across devices. On a new phone, sign in and choose
            Upload local history once, then Sync now for later updates.
          </Chunk>
          <Chunk styles={styles} label="CSV & routine import">
            CSV export is for external tools, not a complete backup. Import Routine (in More) creates
            a new routine from pasted text and leaves the routine you are running untouched.
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
            Settings controls appearance, units, reminders, deload, and optional fatigue/progression
            features. Turn optional features on only if you want them.
          </Chunk>
          <Chunk styles={styles} label="Your data">
            Working data and local backup files stay on this device unless you enable Cloud Sync.
            CSV export files are stored unencrypted.
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

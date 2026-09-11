import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ScreenShell } from './ScreenShell';
import { Card, SectionTitle } from './UI';
import { useThemedStyles } from '../theme/ThemeContext';
import { useWeightUnit } from '../lib/unitPreference';
import { formatLiftWeightValue } from '../lib/units';
import { WorkoutSyntaxReference } from './WorkoutSyntaxReference';

const TOPICS = [
  ['start', 'Start here', 'The quick overview of Kilo and its tabs.'],
  ['logging', 'Log workouts', 'Routine notes, syntax, tracking, and deloads.'],
  ['weight', 'Weight', 'Daily weigh-ins, goals, trends, and pace flags.'],
  ['analytics', 'Analytics', 'Progress, fatigue, and Recovery views.'],
  ['backup', 'Backup & import', 'Local backups, CSV export, and restore.'],
  ['account', 'Account & sync', 'Optional cloud sync and ownership.'],
  ['settings', 'Privacy & settings', 'Preferences, privacy, and offline use.'],
  ['terms', 'Terms', 'The numbers and labels used throughout Kilo.'],
];

export function HelpScreen({ onBack }) {
  const styles = useThemedStyles(createStyles);
  const unit = useWeightUnit();
  const [selectedTopic, setSelectedTopic] = useState(null);
  const topic = TOPICS.find(([id]) => id === selectedTopic);
  const oneKTotalLabel = unit === 'kg' ? `${formatLiftWeightValue(1000, 'kg')} kg` : '1,000 lb';

  return <ScreenShell title="App Guide" subtitle="A quick reference for using Kilo." onBack={onBack}>
    {!topic ? <>
      <Card><Text style={styles.helpHeading} accessibilityRole="header">How Kilo works</Text><Text style={styles.helpText}>Kilo is an offline-first training log. Choose a topic below for the short version, then open the app surface named in the instructions.</Text></Card>
      <SectionTitle>Topics</SectionTitle>
      <View accessibilityRole="list" style={styles.topicList}>{TOPICS.map(([id, title, summary]) => <Pressable key={id} accessibilityRole="button" accessibilityLabel={`Read ${title}`} onPress={() => setSelectedTopic(id)} style={({ pressed }) => [styles.topicRow, pressed && styles.topicPressed]}><View style={styles.topicCopy}><Text style={styles.topicTitle} accessibilityRole="header">{title}</Text><Text style={styles.topicSummary}>{summary}</Text></View><Text style={styles.topicArrow} accessible={false}>›</Text></Pressable>)}</View>
    </> : <>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to guide topics" onPress={() => setSelectedTopic(null)} style={styles.backToTopics}><Text style={styles.backToTopicsText}>‹ All topics</Text></Pressable>
      <Text style={styles.detailHeading} accessibilityRole="header">{topic[1]}</Text>
      {renderTopic(selectedTopic, styles, oneKTotalLabel)}
    </>}
  </ScreenShell>;
}

function renderTopic(topic, styles, oneKTotalLabel) {
  switch (topic) {
    case 'start': return <Card><Text style={styles.helpText}>Use Home for your week and progress snapshot. Log is where you write workouts. Weight records body weight. Analytics explains trends. More contains settings, your profile, Data & Backup, Account, and this guide.</Text></Card>;
    case 'logging': return <><Card><WorkoutSyntaxReference /></Card><Card><Text style={styles.helpText}>Write a routine as plain text; Kilo parses headings, exercises, sets, reps, and weight. Logging does not track an exercise: tap Track beside a parsed exercise to include it in Progressive Overload. Every explicit Track opens a fresh progression span; First session appears while the new span builds, while Est. Max, Kilo Max, and best set keep showing your full history. Exercises may already be tracked from a catalog default or an earlier version of the app. Deload mode can generate a planned lower-volume week from Log.</Text></Card></>;
    case 'weight': return <Card><Text style={styles.helpText}>Enter daily body weight in the Weight tab. Kilo shows your 7-day trend and goal pace, and flags changes faster than about 1.5% per week. Your selected unit is used for display.</Text></Card>;
    case 'analytics': return <Card><Text style={styles.helpText}>Analytics shows Weight trend charts (7- and 30-day averages), a combined Big 3 progress view for mapped squat, bench, and deadlift lifts when enough complete logged cycles exist, and Progressive Overload metrics (Est. Max, Kilo Max, best set, and progress trend) for tracked exercises. When fatigue tracking is enabled, check-ins add volume-decline context. Recovery compares a planned recovery block with its baseline routine; it is training information, not medical advice.</Text></Card>;
    case 'backup': return <Card><Text style={styles.helpText}>More → Data & Backup can export a local backup and load it later on this device or another device. It preserves core workout, weight, goal, fatigue, and deload/recovery records, but does not include profile, reminders, preferences, tracked-lift enrollment/spans, or other local configuration. CSV export is for other tools and omits still more app state; review the confirmation before replacing local data.</Text></Card>;
    case 'account': return <Card><Text style={styles.helpText}>Kilo works without an account and keeps your working copy on this device. An optional Account and Cloud Sync can reconcile that copy with your cloud data so you can continue on another phone. Sign in first, then use Upload local history for the initial setup and Sync now for later changes. Deleting the account removes the cloud copy, not local history.</Text></Card>;
    case 'settings': return <Card><Text style={styles.helpText}>More → Settings controls appearance, units, reminders, deload and optional fatigue/progression features. Kilo is designed to work offline. Read the Privacy Policy from More → About; exports are created on-device, and CSV files are unencrypted.</Text></Card>;
    case 'terms': return <Card><View style={styles.termList}><Text style={styles.term}><Text style={styles.termLabel}>Est. Max</Text> — estimated one-rep max from your best logged set.</Text><Text style={styles.term}><Text style={styles.termLabel}>Kilo Max</Text> — Est. Max adjusted for fatigue.</Text><Text style={styles.term}><Text style={styles.termLabel}>1K Progress</Text> — combined estimated squat, bench, and deadlift total; the goal is {oneKTotalLabel}.</Text><Text style={styles.term}><Text style={styles.termLabel}>Track</Text> — explicitly includes an exercise in Progressive Overload.</Text><Text style={styles.term}><Text style={styles.termLabel}>Pace Flag</Text> — weight is changing faster than the healthy-range threshold.</Text><Text style={styles.term}><Text style={styles.termLabel}>Recovery</Text> — a planned lower-load block used to compare return to baseline.</Text></View></Card>;
    default: return null;
  }
}

const createStyles = (colors) => StyleSheet.create({
  helpHeading: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 4 },
  helpText: { fontSize: 15, lineHeight: 22, color: colors.textMuted },
  topicList: { gap: 10 },
  topicRow: { minHeight: 64, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.card, flexDirection: 'row', alignItems: 'center' },
  topicCopy: { flex: 1, minWidth: 0 },
  topicTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 3 }, topicSummary: { fontSize: 14, lineHeight: 19, color: colors.textMuted }, topicArrow: { fontSize: 28, color: colors.accentText, marginLeft: 10 },
  backToTopics: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 4 }, backToTopicsText: { fontSize: 15, fontWeight: '700', color: colors.accentText },
  detailHeading: { fontSize: 26, lineHeight: 32, fontWeight: '700', color: colors.text }, termList: { gap: 12 }, term: { fontSize: 15, lineHeight: 22, color: colors.textMuted }, termLabel: { fontWeight: '700', color: colors.accentText },
});

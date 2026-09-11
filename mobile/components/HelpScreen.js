import React, { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ScreenShell } from './ScreenShell';
import { Card, SectionTitle } from './UI';
import { useThemedStyles } from '../theme/ThemeContext';
import { useWeightUnit } from '../lib/unitPreference';
import { formatLiftWeightValue } from '../lib/units';
import { WorkoutSyntaxReference } from './WorkoutSyntaxReference';

const TOPICS = [
  ['start', 'Start here', 'Kilo and its tabs.'], ['logging', 'Log workouts', 'Syntax, tracking, and deloads.'],
  ['weight', 'Weight', 'Weigh-ins, goals, and trends.'], ['analytics', 'Analytics', 'Progress, fatigue, and Recovery.'],
  ['backup', 'Backup & import', 'Local backup and CSV export.'], ['account', 'Account & sync', 'Optional cloud sync.'],
  ['settings', 'Privacy & settings', 'Preferences and privacy.'], ['terms', 'Terms', 'Kilo’s numbers and labels.'],
];

export function HelpScreen({ onBack }) {
  const styles = useThemedStyles(createStyles);
  const unit = useWeightUnit();
  const scrollRef = useRef(null);
  const sectionY = useRef({});
  const oneKTotalLabel = unit === 'kg' ? `${formatLiftWeightValue(1000, 'kg')} kg` : '1,000 lb';
  const jumpTo = (id) => scrollRef.current?.scrollTo({ y: Math.max(0, (sectionY.current[id] || 0) - 12), animated: true });
  const backToTopics = () => scrollRef.current?.scrollTo({ y: 0, animated: true });
  const section = (id, title, children) => <View onLayout={(event) => { sectionY.current[id] = event.nativeEvent.layout.y; }}><SectionTitle>{title}</SectionTitle><Card>{children}</Card><Pressable accessibilityRole="button" accessibilityLabel={`Back to guide topics from ${title}`} onPress={backToTopics} style={styles.backToTopics}><Text style={styles.backToTopicsText}>↑ Back to topics</Text></Pressable></View>;

  return <ScreenShell ref={scrollRef} title="App Guide" subtitle="A quick reference for using Kilo." onBack={onBack}>
    <Card><Text style={styles.helpHeading} accessibilityRole="header">How Kilo works</Text><Text style={styles.helpText}>Kilo is an offline-first training log. Choose a topic to jump to its section below.</Text></Card>
    <SectionTitle>Topics</SectionTitle>
    <View accessibilityRole="list" style={styles.topicList}>{TOPICS.map(([id, title, summary]) => <Pressable key={id} accessibilityRole="button" accessibilityLabel={`Read ${title}`} onPress={() => jumpTo(id)} style={styles.topicRow}><View style={styles.topicCopy}><Text style={styles.topicTitle}>{title}</Text><Text style={styles.topicSummary}>{summary}</Text></View><Text style={styles.topicArrow} accessible={false}>›</Text></Pressable>)}</View>
    <View style={styles.sections}>
      {section('start', 'Start here', <Text style={styles.helpText}>Home shows your week and progress snapshot. Log is for workouts. Weight records body weight. Analytics explains trends. More contains settings, your profile, Data & Backup, Account, and this guide.</Text>)}
      {section('logging', 'Log workouts', <><WorkoutSyntaxReference /><Text style={[styles.helpText, styles.sectionCopy]}>• Write a routine as plain text; Kilo parses headings, exercises, sets, reps, and weight.{"\n"}• Logging does not track an exercise. Tap Track beside a parsed exercise to include it in Progressive Overload.{"\n"}• Every explicit Track opens a fresh progression span. First session appears while it builds; Est. Max, Kilo Max, and best set keep showing full history.{"\n"}• Some exercises may already be tracked from a catalog default or an earlier app version. Deload mode can generate a planned lower-volume week from Log.</Text></>)}
      {section('weight', 'Weight', <Text style={styles.helpText}>Enter daily body weight in Weight. Kilo shows 7-day trends and goal pace, and flags changes faster than about 1.5% per week. Your selected unit is used for display.</Text>)}
      {section('analytics', 'Analytics', <Text style={styles.helpText}>• Weight trend charts use 7- and 30-day averages.{"\n"}• Combined Big 3 progress covers mapped squat, bench, and deadlift lifts when enough complete logged cycles exist.{"\n"}• Progressive Overload shows Est. Max, Kilo Max, best set, and progress trend for tracked exercises.{"\n"}• When fatigue tracking is enabled, check-ins add volume-decline context. Recovery compares a planned block with its baseline; it is training information, not medical advice.</Text>)}
      {section('backup', 'Backup & import', <Text style={styles.helpText}>Data & Backup exports a local backup and can load it on this or another device. It preserves core workout, weight, goal, fatigue, and deload/recovery records, but not profile, reminders, preferences, tracked-lift enrollment/spans, or other local configuration. CSV is for other tools and omits still more app state; review confirmation before replacing local data.</Text>)}
      {section('account', 'Account & sync', <Text style={styles.helpText}>Kilo works without an account and keeps your working copy on this device. Optional Account and Cloud Sync reconcile with cloud data for another phone. Sign in, use Upload local history once, then Sync now for later changes. Deleting the account removes the cloud copy, not local history.</Text>)}
      {section('settings', 'Privacy & settings', <Text style={styles.helpText}>Settings controls appearance, units, reminders, deload, and optional fatigue/progression features. Kilo works offline. Read Privacy Policy from More → About. Exports are created on-device, and CSV files are unencrypted.</Text>)}
      {section('terms', 'Terms', <Text style={styles.helpText}>Est. Max: estimated one-rep max. Kilo Max: Est. Max adjusted for fatigue. 1K Progress: combined estimated squat, bench, and deadlift total; the goal is {oneKTotalLabel}. Track: includes an exercise in Progressive Overload. Pace Flag: weight is changing faster than the healthy-range threshold. Recovery: a planned lower-load block compared with baseline.</Text>)}
    </View>
  </ScreenShell>;
}

const createStyles = (colors) => StyleSheet.create({
  helpHeading: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 4 }, helpText: { fontSize: 15, lineHeight: 22, color: colors.textMuted },
  topicList: { gap: 10 }, topicRow: { minHeight: 60, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.card, flexDirection: 'row', alignItems: 'center' }, topicCopy: { flex: 1, minWidth: 0 }, topicTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 3 }, topicSummary: { fontSize: 14, lineHeight: 19, color: colors.textMuted }, topicArrow: { fontSize: 28, color: colors.accentText, marginLeft: 10 },
  sections: { gap: 0 }, sectionCopy: { marginTop: 14 }, backToTopics: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 4 }, backToTopicsText: { fontSize: 15, fontWeight: '700', color: colors.accentText },
});

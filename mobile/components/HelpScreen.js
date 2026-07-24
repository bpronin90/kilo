import React from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import { ScreenShell } from './ScreenShell';
import { Card, SectionTitle } from './UI';
import { Colors } from '../theme/colors';
import { useWeightUnit } from '../lib/unitPreference';
import { formatLiftWeightValue } from '../lib/units';

const LOGO = require('../assets/brand/logo.png');

export function HelpScreen({ onBack }) {
  const unit = useWeightUnit();
  // The 1,000 lb club is lb-defined; show its display-space equivalent when kg
  // is selected (#441). The lb copy keeps its original "1,000 lb" formatting.
  const oneKTotalLabel = unit === 'kg' ? `${formatLiftWeightValue(1000, 'kg')} kg` : '1,000 lb';
  return (
    <ScreenShell title="App Guide" subtitle="What Kilo is and how to use it." onBack={onBack}>

      <View style={styles.logoContainer}>
        <Image source={LOGO} style={styles.logo} />
      </View>

      <Card>
        <Text style={styles.helpHeading}>What is Kilo?</Text>
        <Text style={styles.helpText}>
          Kilo is a minimalist training log built for speed. Write your workout in plain text — Kilo parses it into structured data, tracks your progress, and surfaces analytics without extra steps.
        </Text>
      </Card>

      <SectionTitle>Your Tabs</SectionTitle>

      <Card>
        <View style={styles.tabRow}>
          <Text style={styles.tabName}>Home</Text>
          <Text style={styles.tabDesc}>Your training dashboard. Shows current week number, latest body weight, a 7-day rolling weight average, and a breakdown of your tracked exercises by progress status (Progressing, Steady, Regressing). Also displays your active weight goal and 1K milestone progress.</Text>
        </View>
        <View style={styles.tabRow}>
          <Text style={styles.tabName}>Log</Text>
          <Text style={styles.tabDesc}>Write your workouts as free-form text notes. Kilo parses exercises, sets, reps, and weight automatically. Tap any parsed exercise to see details or mark it as tracked. Also contains Deload: when deload mode is enabled in Settings, you can log and review planned deload weeks from within the Log tab.</Text>
        </View>
        <View style={styles.tabRow}>
          <Text style={styles.tabName}>Weight</Text>
          <Text style={styles.tabDesc}>Log your daily body weight. Kilo tracks your trend over time, computes a rolling average, and flags if your rate of change is outside a healthy range. Supports an optional weight goal with target and weekly pace tracking.</Text>
        </View>
        <View style={styles.tabRow}>
          <Text style={styles.tabName}>Analytics</Text>
          <Text style={styles.tabDesc}>Weight trend charts (7-day and 30-day rolling averages) and a combined Big 3 progress total for mapped squat, bench, and deadlift exercises with enough complete logged cycles. Progressive Overload metric rows for tracked exercises show current Est. Max, Kilo Max, best set, and progress trend. Optional fatigue check-in data is included when fatigue tracking is enabled.</Text>
        </View>
        <View style={[styles.tabRow, { marginBottom: 0 }]}>
          <Text style={styles.tabName}>More</Text>
          <Text style={styles.tabDesc}>App settings, your user profile (used for calorie estimation), local data backup and restore, your optional cloud Account, and this guide.</Text>
        </View>
      </Card>

      <SectionTitle>Account & Cloud Backup</SectionTitle>

      <Card>
        <Text style={styles.helpText}>
          Kilo works fully offline. Everything you log — workouts, body weight, tracked exercises, and settings — is stored on this device, and you never need an account to use the app.
        </Text>
        <Text style={[styles.helpText, { marginTop: 12 }]}>
          An optional Account (in the More tab) keeps your data synced to the cloud, so you can pick up on a new phone or after reinstalling. Your device holds the offline working copy you use day to day; your account holds a cloud copy that stays in step with it. When you sync, the two are reconciled — if the same item was changed in both places, the most recent change wins.
        </Text>
        <View style={{ marginTop: 12, gap: 10 }}>
          <View style={styles.termRow}>
            <Text style={styles.termLabel}>On this device</Text>
            <Text style={styles.termDesc}>Your offline working copy of the full training history. Always available, with or without an account.</Text>
          </View>
          <View style={styles.termRow}>
            <Text style={styles.termLabel}>In your account</Text>
            <Text style={styles.termDesc}>A cloud copy that stays in sync with your device once you sign in and sync. Used to restore or continue your data on another device.</Text>
          </View>
          <View style={styles.termRow}>
            <Text style={styles.termLabel}>Upload local history</Text>
            <Text style={styles.termDesc}>The first-time setup. Run it once after signing in to send the history already on your device up to your account.</Text>
          </View>
          <View style={styles.termRow}>
            <Text style={styles.termLabel}>Sync now</Text>
            <Text style={styles.termDesc}>The ongoing sync. Sends your newer changes up and pulls newer changes down so your device and account match. Run it after logging new workouts or when switching devices.</Text>
          </View>
          <View style={[styles.termRow, { marginBottom: 0 }]}>
            <Text style={styles.termLabel}>Deleting your account</Text>
            <Text style={styles.termDesc}>Removes the cloud copy only. The training history on your device is kept and the app keeps working offline.</Text>
          </View>
        </View>
      </Card>

      <SectionTitle>Logging Workouts</SectionTitle>

      <Card>
        <Text style={styles.helpText}>
          Each workout note is plain text. Declare an exercise with a dash (<Text style={{ fontWeight: 'bold' }}>-</Text>), then write your sets (weight followed by reps) on the lines below it.
        </Text>

        <View style={styles.codeBlock}>
          <Text style={styles.codeText}>Monday</Text>
          <Text style={styles.codeText}>+Lifting</Text>
          <Text style={styles.codeText}>-Bench</Text>
          <Text style={styles.codeText}>135 5,5,5</Text>
          <Text style={styles.codeText}>140 5,5</Text>
          <Text style={styles.codeText}>-</Text>
          <Text style={styles.codeText}>145 5</Text>
        </View>

        <Text style={[styles.helpText, { marginTop: 12 }]}>
          How it works:
        </Text>
        <View style={{ marginTop: 6, gap: 6 }}>
          <View style={styles.formatRow}>
            <Text style={styles.codeText}>-Bench</Text>
            <Text style={styles.formatDesc}>Declares the exercise name (starts with a dash)</Text>
          </View>
          <View style={styles.formatRow}>
            <Text style={styles.codeText}>135 5,5,5</Text>
            <Text style={styles.formatDesc}>Logs 3 sets at 135 lbs for 5 reps (separated by commas)</Text>
          </View>
          <View style={styles.formatRow}>
            <Text style={styles.codeText}>140 5,5</Text>
            <Text style={styles.formatDesc}>Logs 2 sets at 140 lbs for 5 reps (each new line is a new session)</Text>
          </View>
          <View style={styles.formatRow}>
            <Text style={styles.codeText}>-</Text>
            <Text style={styles.formatDesc}>A single dash on a set line marks that session as skipped</Text>
          </View>
          <View style={styles.formatRow}>
            <Text style={styles.codeText}>12,12</Text>
            <Text style={styles.formatDesc}>Logs bodyweight exercises (reps only, no weight prefix)</Text>
          </View>
        </View>

         <Text style={[styles.helpText, { marginTop: 12 }]}>
          Day names (e.g., <Text style={{ fontWeight: 'bold', color: Colors.text }}>Monday</Text>) group exercises by training day. Block headers starting with a plus (e.g., <Text style={{ fontWeight: 'bold', color: Colors.text }}>+Lifting</Text>) group exercises within that day. If you omit day names, exercises are parsed normally but will not have day/session grouping headings in the log view.{"\n\n"}
          To track an exercise in Analytics: tap it in your parsed log and tap "Track" to monitor its progress.
        </Text>
      </Card>

      <SectionTitle>Terminology</SectionTitle>

      <Card>
        <View style={styles.termRow}>
          <Text style={styles.termLabel}>Est. Max</Text>
          <Text style={styles.termDesc}>Estimated 1-Rep Max. Calculated from your best logged sets using the Epley formula.</Text>
        </View>
        <View style={styles.termRow}>
          <Text style={styles.termLabel}>Kilo Max</Text>
          <Text style={styles.termDesc}>Est. Max adjusted by the fatigue multiplier. Reflects real-world performance while accounting for accumulated fatigue.</Text>
        </View>
        <View style={styles.termRow}>
          <Text style={styles.termLabel}>1K Progress</Text>
          <Text style={styles.termDesc}>Your combined estimated 1RM across Squat, Bench, and Deadlift. The goal is to reach a {oneKTotalLabel} total. Shown on the Home screen.</Text>
        </View>
        <View style={styles.termRow}>
          <Text style={styles.termLabel}>Tracked</Text>
          <Text style={styles.termDesc}>An exercise you've marked for Analytics monitoring. Tracked exercises appear in the Progressive Overload section showing current Est. Max, Kilo Max, best set, and progress trend.</Text>
        </View>
        <View style={styles.termRow}>
          <Text style={styles.termLabel}>Fatigue</Text>
          <Text style={styles.termDesc}>An optional session check-in that records how tired or recovered you feel. When fatigue tracking is enabled in Settings, Analytics includes volume decline data to correlate training load with performance.</Text>
        </View>
        <View style={styles.termRow}>
          <Text style={styles.termLabel}>Pace Flag</Text>
          <Text style={styles.termDesc}>A warning when body weight is changing faster than ~1.5% per week, which may indicate an unsustainable rate of gain or loss.</Text>
        </View>
        <View style={styles.termRow}>
          <Text style={styles.termLabel}>Sets</Text>
          <Text style={styles.termDesc}>The number of work sets logged for an exercise in a session.</Text>
        </View>
        <View style={[styles.termRow, { marginBottom: 0 }]}>
          <Text style={styles.termLabel}>Deload</Text>
          <Text style={styles.termDesc}>A planned period of reduced training volume and intensity used to recover from accumulated fatigue. Generated automatically from your routine when deload mode is enabled.</Text>
        </View>
      </Card>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  logoContainer: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  logo: {
    width: 64,
    height: 64,
    resizeMode: 'contain',
  },
  helpHeading: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 4,
  },
  helpText: {
    fontSize: 15,
    lineHeight: 22,
    color: Colors.textMuted,
  },
  codeBlock: {
    backgroundColor: Colors.inputBackground,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    padding: 10,
    marginTop: 8,
    gap: 2,
  },
  codeText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    color: Colors.text,
  },
  formatRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  formatDesc: {
    flex: 1,
    fontSize: 13,
    color: Colors.textMuted,
    lineHeight: 18,
  },
  tabRow: {
    marginBottom: 16,
  },
  tabName: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 3,
  },
  tabDesc: {
    fontSize: 14,
    color: Colors.textMuted,
    lineHeight: 20,
  },
  termRow: {
    marginBottom: 12,
  },
  termLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.accent,
    marginBottom: 2,
  },
  termDesc: {
    fontSize: 14,
    color: Colors.textMuted,
    lineHeight: 20,
  },
});

import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ScreenShell } from '../components/ScreenShell';
import { Card, SectionTitle, Chip, StatCard, Button } from '../components/UI';
import { formatTimestamp } from '../lib/format';
import { Colors } from '../theme/colors';
import pkg from '../package.json';

export function HomeScreen({ entries, weightEntries, workoutSessions, successMessage }) {
  const dashboardData = useMemo(() => {
    // 1. Training Volume (sets per session for last 7 sessions)
    const volumeData = workoutSessions
      .slice(0, 7)
      .reverse()
      .map(s => s.items.reduce((sum, item) => sum + (item.sets?.length || 0), 0));
    
    // 2. Weight Trend (last 7 entries)
    const weightTrend = weightEntries
      .slice(0, 7)
      .reverse()
      .map(e => e.weight_value);

    // Latest stats for quick overview
    const latestWeight = weightEntries[0]?.weight_value;
    const totalWorkouts = workoutSessions.length;

    return { volumeData, weightTrend, latestWeight, totalWorkouts };
  }, [weightEntries, workoutSessions]);

  return (
    <ScreenShell
      subtitle="Your training dashboard and recent logs."
    >
      {successMessage ? (
        <Card style={styles.successCard}>
          <Text style={styles.successText}>{successMessage}</Text>
        </Card>
      ) : null}

      <View style={styles.grid}>
        <StatCard label="Latest Weight" value={dashboardData.latestWeight ? `${dashboardData.latestWeight} lb` : '—'} tone="accent" />
        <StatCard label="Total Workouts" value={String(dashboardData.totalWorkouts)} />
      </View>

      <SectionTitle>Training Volume</SectionTitle>
      <Card style={styles.graphCard}>
        <Text style={styles.graphLabel}>Sets per session (Last 7)</Text>
        <View style={styles.graphContainer}>
          {dashboardData.volumeData.length > 0 ? (
            dashboardData.volumeData.map((val, i) => (
              <View key={i} style={styles.barContainer}>
                <View 
                  style={[
                    styles.bar, 
                    { height: Math.max(4, (val / Math.max(...dashboardData.volumeData, 1)) * 100) }
                  ]} 
                />
              </View>
            ))
          ) : (
            <Text style={styles.emptyGraphText}>Log workouts to see volume trend.</Text>
          )}
        </View>
      </Card>

      <SectionTitle>Weight Trend</SectionTitle>
      <Card style={styles.graphCard}>
        <Text style={styles.graphLabel}>Last 7 weigh-ins</Text>
        <View style={styles.graphContainer}>
          {dashboardData.weightTrend.length > 0 ? (
            dashboardData.weightTrend.map((val, i) => {
              const min = Math.min(...dashboardData.weightTrend);
              const max = Math.max(...dashboardData.weightTrend);
              const range = max - min || 1;
              const height = ((val - min) / range) * 80 + 20; // 20-100% height
              return (
                <View key={i} style={styles.barContainer}>
                  <View style={[styles.bar, styles.weightBar, { height }]} />
                </View>
              );
            })
          ) : (
            <Text style={styles.emptyGraphText}>Log weight to see trend.</Text>
          )}
        </View>
      </Card>

      <SectionTitle>Recent activity</SectionTitle>
      {entries.slice(0, 5).map((entry) => (
        <Card key={entry.id}>
          <View style={styles.rowBetween}>
            <Text style={styles.entryTitle}>
              {entry.type === 'weight' ? `${entry.value} ${entry.unit}` : entry.title}
            </Text>
            <Text style={styles.entryMeta}>{formatTimestamp(entry.createdAt)}</Text>
          </View>
          <Chip>{entry.type === 'weight' ? 'Weight log' : 'Workout log'}</Chip>
          <Text style={styles.entryBody}>
            {entry.type === 'weight' ? entry.note : entry.detail}
          </Text>
        </Card>
      ))}
    </ScreenShell>
  );
}

export function MoreScreen({ onNavigate }) {
  const [activeView, setActiveView] = useState('menu');

  if (activeView === 'help') {
    return <HelpScreen onBack={() => setActiveView('menu')} />;
  }

  if (activeView === 'about') {
    return <AboutScreen onBack={() => setActiveView('menu')} />;
  }

  return (
    <ScreenShell title="More" subtitle="Help, about, and application info.">
      <View style={styles.list}>
        <Pressable style={styles.menuItem} onPress={() => setActiveView('help')}>
          <Text style={styles.menuItemText}>Help & Terminology</Text>
          <Text style={styles.menuItemChevron}>→</Text>
        </Pressable>
        <Pressable style={styles.menuItem} onPress={() => setActiveView('about')}>
          <Text style={styles.menuItemText}>About Kilo</Text>
          <Text style={styles.menuItemChevron}>→</Text>
        </Pressable>
      </View>

      <SectionTitle>Quick Actions</SectionTitle>
      <View style={styles.grid}>
        <Button title="Log Workout" onPress={() => onNavigate('Log')} style={{ flex: 1 }} />
        <Button title="Log Weight" onPress={() => onNavigate('Weight')} style={{ flex: 1 }} />
      </View>
    </ScreenShell>
  );
}

function HelpScreen({ onBack }) {
  return (
    <ScreenShell title="Help" subtitle="Terminology and usage guide.">
      <Button title="← Back" onPress={onBack} style={styles.backButton} textStyle={styles.backButtonText} />
      
      <Card>
        <Text style={styles.helpHeading}>What is Kilo?</Text>
        <Text style={styles.helpText}>
          Kilo is a minimalist training log designed for speed. It interprets your natural workout notes into structured data and analytics.
        </Text>
      </Card>

      <Card>
        <Text style={styles.helpHeading}>Workout Notes</Text>
        <Text style={styles.helpText}>
          Enter your exercises followed by weight, reps, and sets.{"\n\n"}
          Example: "Squat 225x5x5" or "Bench 185x8, 185x7, 185x6".
        </Text>
      </Card>

      <Card>
        <Text style={styles.helpHeading}>What is "Tracked"?</Text>
        <Text style={styles.helpText}>
          Tapping "Track" on an exercise in your log tells Kilo to monitor it for progress. These exercises appear in your Analytics tab with progression markers.
        </Text>
      </Card>

      <Card>
        <Text style={styles.helpHeading}>Terminology</Text>
        <View style={styles.termRow}>
          <Text style={styles.termLabel}>Est. Max</Text>
          <Text style={styles.termDesc}>Estimated 1-Rep Max. A calculation of your maximum strength based on your best sets.</Text>
        </View>
        <View style={styles.termRow}>
          <Text style={styles.termLabel}>Sets</Text>
          <Text style={styles.termDesc}>The total number of work sets performed for a specific exercise in a session.</Text>
        </View>
        <View style={styles.termRow}>
          <Text style={styles.termLabel}>Pace Flag</Text>
          <Text style={styles.termDesc}>A warning if your body weight is changing too rapidly (over 1.5% per week).</Text>
        </View>
      </Card>
    </ScreenShell>
  );
}

function AboutScreen({ onBack }) {
  return (
    <ScreenShell title="About" subtitle="App information and attribution.">
      <Button title="← Back" onPress={onBack} style={styles.backButton} textStyle={styles.backButtonText} />
      
      <Card style={styles.aboutCard}>
        <Text style={styles.aboutLabel}>Created by</Text>
        <Text style={styles.aboutValue}>Benjamin Pronin</Text>
        
        <Text style={styles.aboutLabel}>Version</Text>
        <Text style={styles.aboutValue}>{`alpha-${pkg.version}`}</Text>
        
        <Text style={styles.aboutFooter}>
          Copyright © Benjamin Pronin. All rights reserved.
        </Text>
      </Card>

      <Card>
        <Text style={styles.helpText}>
          Kilo is built to be the fastest way to log your training without the friction of traditional tracking apps.
        </Text>
      </Card>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  successCard: {
    backgroundColor: Colors.success,
    borderColor: Colors.success,
    marginBottom: 12,
  },
  successText: {
    color: Colors.textLight,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  grid: {
    flexDirection: 'row',
    gap: 12,
  },
  graphCard: {
    padding: 16,
    gap: 16,
  },
  graphLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
  },
  graphContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 100,
    gap: 8,
    paddingBottom: 4,
  },
  barContainer: {
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
  },
  bar: {
    backgroundColor: Colors.accent,
    borderRadius: 4,
    width: '100%',
  },
  weightBar: {
    backgroundColor: Colors.success,
    opacity: 0.7,
  },
  emptyGraphText: {
    flex: 1,
    textAlign: 'center',
    color: Colors.textMuted,
    fontSize: 14,
    fontStyle: 'italic',
    alignSelf: 'center',
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  entryTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  entryMeta: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  entryBody: {
    fontSize: 15,
    lineHeight: 22,
    color: Colors.textMuted,
  },
  list: {
    gap: 12,
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.card,
    padding: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  menuItemText: {
    fontSize: 17,
    fontWeight: '600',
    color: Colors.text,
  },
  menuItemChevron: {
    fontSize: 18,
    color: Colors.textMuted,
    fontWeight: '700',
  },
  backButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginBottom: 8,
  },
  backButtonText: {
    color: Colors.text,
    fontSize: 14,
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
  aboutCard: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  aboutLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    marginTop: 16,
    marginBottom: 4,
  },
  aboutValue: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.text,
  },
  aboutFooter: {
    marginTop: 32,
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: 'center',
  },
});

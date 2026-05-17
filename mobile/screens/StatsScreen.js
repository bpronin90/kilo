import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ScreenShell } from '../components/ScreenShell';
import { StatCard, Card, SectionTitle, Badge } from '../components/UI';
import { computeWeightTrends, derive1kTotal } from '../lib/data';
import { useWorkoutNote, useWeightEntries, useWorkoutSessions } from '../hooks/useEntries';
import { parseWorkoutNote, deriveProgressionSignals } from '../lib/parser';
import { Colors } from '../theme/colors';

export function StatsScreen() {
  const { note } = useWorkoutNote();
  const { entries: weightEntries } = useWeightEntries();
  const { sessions: workoutSessions } = useWorkoutSessions();

  const weightSummary = useMemo(() => {
    const trends = computeWeightTrends(weightEntries);
    const latest = weightEntries[0];
    
    return {
      latestWeight: latest ? `${latest.weight_value} ${latest.weight_unit || 'lb'}` : '—',
      weightCount: String(weightEntries.length),
      avg7:  trends.avg7  !== null ? `${trends.avg7.toFixed(1)} lb`  : '—',
      avg30: trends.avg30 !== null ? `${trends.avg30.toFixed(1)} lb` : '—',
      paceFlag: trends.paceFlag,
    };
  }, [weightEntries]);

  const analytics = useMemo(() => {
    if (!note?.raw_text) return null;
    const { sections } = parseWorkoutNote(note.raw_text);
    const trackedNames = note.tracked_exercises || [];
    
    const { exercises: signals } = deriveProgressionSignals(sections, trackedNames);
    
    // Attempt 1k total with common names as fallback for "user-selected"
    const oneK = derive1kTotal(sections, {
      bench: 'Bench Press',
      squat: 'Squat',
      deadlift: 'Deadlift'
    });

    return { signals, oneK, sectionsCount: sections.length };
  }, [note]);

  const workoutCount = useMemo(() => {
    // Show count of sections (sessions) in the note as the primary metric
    return String(analytics?.sectionsCount || workoutSessions.length);
  }, [analytics, workoutSessions]);

  return (
    <ScreenShell
      title="Analytics"
      subtitle="Insights derived from your logs."
    >
      <SectionTitle>Weight Trends</SectionTitle>
      <View style={styles.grid}>
        <StatCard label="Latest weight" value={weightSummary.latestWeight} tone="accent" />
        <StatCard label="7-day avg" value={weightSummary.avg7} />
        <StatCard label="30-day avg" value={weightSummary.avg30} />
        {weightSummary.paceFlag ? (
          <StatCard
            label="Pace flag"
            value={weightSummary.paceFlag === 'gain' ? '↑ Gaining fast' : '↓ Losing fast'}
            tone={weightSummary.paceFlag === 'gain' ? 'error' : 'success'}
          />
        ) : null}
      </View>

      <SectionTitle>Strength</SectionTitle>
      {analytics?.oneK?.total ? (
        <Card style={styles.oneKCard}>
          <Text style={styles.oneKLabel}>1,000 lb Club Progress</Text>
          <Text style={styles.oneKValue}>{analytics.oneK.total.toFixed(0)} lb</Text>
          <View style={styles.oneKBreakdown}>
            <View style={styles.oneKItem}>
              <Text style={styles.oneKItemValue}>{analytics.oneK.squat?.toFixed(0) || '—'}</Text>
              <Text style={styles.oneKItemLabel}>Squat</Text>
            </View>
            <View style={styles.oneKItem}>
              <Text style={styles.oneKItemValue}>{analytics.oneK.bench?.toFixed(0) || '—'}</Text>
              <Text style={styles.oneKItemLabel}>Bench</Text>
            </View>
            <View style={styles.oneKItem}>
              <Text style={styles.oneKItemValue}>{analytics.oneK.deadlift?.toFixed(0) || '—'}</Text>
              <Text style={styles.oneKItemLabel}>Deadlift</Text>
            </View>
          </View>
        </Card>
      ) : (
        <Card style={styles.infoCard}>
          <Text style={styles.infoText}>
            Track "Squat", "Bench Press", and "Deadlift" in your note to see 1k progress.
          </Text>
        </Card>
      )}

      <SectionTitle>Tracked Lifts</SectionTitle>
      <View style={styles.list}>
        {analytics?.signals?.length > 0 ? (
          analytics.signals.map((sig, i) => (
            <Card key={i} style={styles.signalCard}>
              <View style={styles.signalHeader}>
                <Text style={styles.signalName}>{sig.name}</Text>
                <Badge status={sig.progression_status}>
                  {formatStatus(sig.progression_status)}
                </Badge>
              </View>
              <View style={styles.signalMeta}>
                <View>
                  <Text style={styles.signalLabel}>Est. PR</Text>
                  <Text style={styles.signalValue}>
                    {sig.latest_pr ? `${sig.latest_pr.toFixed(0)} lb` : '—'}
                  </Text>
                </View>
                {sig.repeatability_score > 1 && (
                  <View>
                    <Text style={styles.signalLabel}>Repeatability</Text>
                    <Text style={styles.signalValue}>{sig.repeatability_score} sets</Text>
                  </View>
                )}
              </View>
            </Card>
          ))
        ) : (
          <Text style={styles.emptyText}>No exercises tracked for analytics yet.</Text>
        )}
      </View>

      <SectionTitle>Totals</SectionTitle>
      <View style={styles.grid}>
        <StatCard label="Weight entries" value={weightSummary.weightCount} />
        <StatCard label="Workout sessions" value={workoutCount} />
      </View>
    </ScreenShell>
  );
}

function formatStatus(status) {
  switch (status) {
    case 'improved': return 'Improved';
    case 'held': return 'Held';
    case 'regressed': return 'Regressed';
    case 'first_session': return 'First';
    default: return '—';
  }
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  list: {
    gap: 12,
  },
  oneKCard: {
    padding: 24,
    alignItems: 'center',
    gap: 12,
  },
  oneKLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
  },
  oneKValue: {
    fontSize: 48,
    fontWeight: '900',
    color: Colors.accent,
  },
  oneKBreakdown: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-around',
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.cardBorder,
    paddingTop: 16,
  },
  oneKItem: {
    alignItems: 'center',
    gap: 2,
  },
  oneKItemValue: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  oneKItemLabel: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  infoCard: {
    backgroundColor: 'transparent',
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    padding: 20,
  },
  infoText: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  signalCard: {
    gap: 12,
  },
  signalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  signalName: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    flex: 1,
  },
  signalMeta: {
    flexDirection: 'row',
    gap: 32,
  },
  signalLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
    marginBottom: 2,
  },
  signalValue: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
  },
  emptyText: {
    textAlign: 'center',
    color: Colors.textMuted,
    marginTop: 20,
    fontSize: 15,
  },
});

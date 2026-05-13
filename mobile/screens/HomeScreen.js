import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ScreenShell } from '../components/ScreenShell';
import { Card, SectionTitle, Chip } from '../components/UI';
import { formatTimestamp } from '../lib/format';
import { Colors } from '../theme/colors';

export function HomeScreen({ entries }) {
  return (
    <ScreenShell
      title="Kilo"
      subtitle="Native MVP. Recent activity and quick overview."
    >
      <Card>
        <Text style={styles.callout}>
          Your training data is now in a native shell. Parser and storage integration coming soon.
        </Text>
      </Card>

      <SectionTitle>Recent activity</SectionTitle>
      {entries.map((entry) => (
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

const styles = StyleSheet.create({
  callout: {
    fontSize: 16,
    lineHeight: 24,
    color: Colors.text,
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
});

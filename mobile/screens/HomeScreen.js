import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ScreenShell } from '../components/ScreenShell';
import { Card, SectionTitle, Chip } from '../components/UI';
import { formatTimestamp } from '../lib/format';
import { Colors } from '../theme/colors';

export function HomeScreen({ entries, successMessage }) {
  return (
    <ScreenShell
      title="Kilo"
      subtitle="Native MVP. Recent activity and quick overview."
    >
      {successMessage ? (
        <Card style={styles.successCard}>
          <Text style={styles.successText}>{successMessage}</Text>
        </Card>
      ) : null}
      <Card>
        <Text style={styles.callout}>
          Your training data is synced to local storage. Use the Log and Weight tabs to add new entries.
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

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors } from '../theme/colors';
import { formatDate, formatDelta } from '../lib/format';

export function WeightHistoryList({
  entries,
  editingId,
  handleEditEntry,
  handleDelete,
  getWeightDeltaSeverity,
  goalInfo,
}) {
  return (
    <View style={styles.historyList}>
      {entries.map((entry, index) => {
        const nextEntry = entries[index + 1];
        const delta = nextEntry ? entry.weight_value - nextEntry.weight_value : null;
        let severity = getWeightDeltaSeverity(delta);
        if (goalInfo && goalInfo.direction) {
          if (goalInfo.direction === 'loss' && delta < 0) {
            severity = 'normal';
          } else if (goalInfo.direction === 'gain' && delta > 0) {
            severity = 'normal';
          }
        }
        const isLast = index === entries.length - 1;
        const isActive = editingId === entry.id;

        return (
          <View 
            key={entry.id} 
            style={[
              styles.historyRowContainer,
              isActive && styles.activeEntryRow,
              isLast && styles.lastHistoryRow
            ]}
          >
            <Pressable 
              onPress={() => handleEditEntry(entry)}
              style={({ pressed }) => [
                styles.rowMain,
                pressed && styles.historyRowPressed
              ]}
            >
              <View style={styles.rowTop}>
                <View style={styles.rowWeightGroup}>
                  <Text style={styles.rowWeight}>
                    {entry.weight_value} {entry.weight_unit || 'lb'}
                  </Text>
                  {delta !== null && (
                    <Text style={[
                      styles.rowDelta,
                      severity === 'notable' && styles.deltaNotable,
                      severity === 'spike' && styles.deltaSpike,
                      severity === 'outlier' && styles.deltaOutlier,
                    ]}>
                      {formatDelta(delta)}
                    </Text>
                  )}
                </View>
                <Text style={styles.rowDate}>{formatDate(entry.logged_at)}</Text>
              </View>
              {entry.note && (
                <Text style={styles.rowNote} numberOfLines={1}>
                  {entry.note}
                </Text>
              )}
            </Pressable>
            <Pressable
              onPress={() => handleDelete(entry.id)}
              style={({ pressed }) => [
                styles.deleteAffordance,
                pressed && styles.deleteAffordancePressed
              ]}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Delete weight entry"
            >
              <Text style={styles.deleteAffordanceText} accessible={false}>✕</Text>
            </Pressable>
          </View>
        );
      })}
      {entries.length === 0 && (
        <Text style={styles.emptyText}>No weight entries yet.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  historyList: {
    backgroundColor: Colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },
  historyRowContainer: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
  },
  historyRowPressed: {
    backgroundColor: Colors.chipBackground,
    opacity: 0.8,
  },
  activeEntryRow: {
    backgroundColor: Colors.chipBackground,
  },
  lastHistoryRow: {
    borderBottomWidth: 0,
  },
  rowMain: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowWeightGroup: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  rowWeight: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text,
  },
  rowDelta: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textMuted,
  },
  deltaNotable: {
    color: Colors.caution,
  },
  deltaSpike: {
    color: Colors.error,
  },
  deltaOutlier: {
    color: Colors.error,
    fontWeight: '900',
  },
  rowDate: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  rowNote: {
    fontSize: 13,
    color: Colors.textMuted,
    marginTop: 1,
  },
  deleteAffordance: {
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteAffordancePressed: {
    backgroundColor: Colors.chipBackground,
    opacity: 0.8,
  },
  deleteAffordanceText: {
    fontSize: 18,
    color: Colors.textMuted,
    opacity: 0.5,
  },
  emptyText: {
    textAlign: 'center',
    color: Colors.textMuted,
    paddingVertical: 32,
    fontSize: 15,
  },
});

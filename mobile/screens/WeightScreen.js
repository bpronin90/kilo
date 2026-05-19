import React, { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ScreenShell } from '../components/ScreenShell';
import { Card, Button, SectionTitle } from '../components/UI';
import { Colors } from '../theme/colors';
import { useWeightEntries } from '../hooks/useEntries';
import { formatTimestamp, formatDelta, getWeightDeltaSeverity } from '../lib/format';
import { parseWeightEntry } from '../lib/parser';
import { computeWeightTrends } from '../lib/data';

export function WeightScreen({ weightValue, setWeightValue, weightNote, setWeightNote, onSaveWeight, errorMessage, saving }) {
  const { entries, remove, update } = useWeightEntries();
  const [editingId, setEditingId] = useState(null);
  const [localError, setLocalError] = useState('');
  const trends = useMemo(() => computeWeightTrends(entries), [entries]);

  const handleEditEntry = (entry) => {
    setLocalError('');
    setEditingId(entry.id);
    setWeightValue(String(entry.weight_value));
    setWeightNote(entry.note || '');
  };

  const cancelEdit = () => {
    setLocalError('');
    setEditingId(null);
    setWeightValue('');
    setWeightNote('');
  };

  const handleDelete = (id) => {
    Alert.alert(
      'Delete Entry',
      'Are you sure you want to delete this weight entry?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive', 
          onPress: async () => {
            await remove(id);
            if (id === editingId) cancelEdit();
          } 
        },
      ]
    );
  };

  const handleSubmit = async () => {
    setLocalError('');
    if (editingId) {
      const parsed = parseWeightEntry(weightValue);
      if (!parsed.ok) {
        setLocalError(parsed.error);
        return;
      }
      await update(editingId, parsed.weight_value, weightNote.trim() || undefined);
      cancelEdit();
    } else {
      onSaveWeight();
    }
  };

  const displayError = localError || errorMessage;

  return (
    <ScreenShell
      title="Weight log"
      subtitle="Track your body weight over time."
      keyboardShouldPersistTaps="handled"
    >
      <Card style={editingId ? styles.editingCard : null}>
        {editingId ? (
          <View style={styles.editingHeader}>
            <Text style={styles.editingTitle}>Editing entry</Text>
            <Pressable onPress={cancelEdit}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        ) : null}
        {displayError ? (
          <Text style={styles.errorText}>{displayError}</Text>
        ) : null}
        <Text style={styles.inputLabel}>Weight (lb)</Text>
        <TextInput
          value={weightValue}
          onChangeText={setWeightValue}
          placeholder="185.0"
          placeholderTextColor={Colors.textMuted}
          keyboardType="decimal-pad"
          style={styles.input}
        />
        <Text style={styles.inputLabel}>Note</Text>
        <TextInput
          value={weightNote}
          onChangeText={setWeightNote}
          placeholder="Morning, fasted"
          placeholderTextColor={Colors.textMuted}
          style={styles.input}
        />
        <Button 
          onPress={handleSubmit} 
          title={editingId ? "Update entry" : "Save weigh-in"} 
          disabled={saving} 
        />
      </Card>

      {(trends.avg7 !== null || trends.avg30 !== null) ? (
        <Card style={styles.trendsCard}>
          <Text style={styles.trendsTitle}>Trends</Text>
          <View style={styles.trendsRow}>
            {trends.avg7 !== null ? (
              <View style={styles.trendItem}>
                <Text style={styles.trendValue}>{trends.avg7.toFixed(1)} lb</Text>
                <Text style={styles.trendLabel}>7-day avg</Text>
              </View>
            ) : null}
            {trends.avg30 !== null ? (
              <View style={styles.trendItem}>
                <Text style={styles.trendValue}>{trends.avg30.toFixed(1)} lb</Text>
                <Text style={styles.trendLabel}>30-day avg</Text>
              </View>
            ) : null}
            {trends.paceFlag ? (
              <View style={styles.trendItem}>
                <Text style={[styles.trendValue, trends.paceFlag === 'gain' ? styles.paceGain : styles.paceLoss]}>
                  {trends.paceFlag === 'gain' ? '↑ Gaining fast' : '↓ Losing fast'}
                </Text>
                <Text style={styles.trendLabel}>pace flag</Text>
              </View>
            ) : null}
          </View>
        </Card>
      ) : null}

      <SectionTitle>History</SectionTitle>
      <View style={styles.historyList}>
        {entries.map((entry, index) => {
          const nextEntry = entries[index + 1];
          const delta = nextEntry ? entry.weight_value - nextEntry.weight_value : null;
          const severity = getWeightDeltaSeverity(delta);

          return (
            <View 
              key={entry.id} 
              style={[
                styles.historyRowContainer,
                editingId === entry.id && styles.activeEntryRow,
                index === entries.length - 1 && styles.lastHistoryRow
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
                  <Text style={styles.rowDate}>{formatTimestamp(new Date(entry.logged_at).getTime())}</Text>
                </View>
                {entry.note ? (
                  <Text style={styles.rowNote} numberOfLines={1}>
                    {entry.note}
                  </Text>
                ) : null}
              </Pressable>
              <Pressable 
                onPress={() => handleDelete(entry.id)} 
                style={({ pressed }) => [
                  styles.deleteAffordance,
                  pressed && styles.deleteAffordancePressed
                ]}
                hitSlop={12}
              >
                <Text style={styles.deleteAffordanceText}>✕</Text>
              </Pressable>
            </View>
          );
        })}
        {entries.length === 0 ? (
          <Text style={styles.emptyText}>No weight entries yet.</Text>
        ) : null}
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  errorText: {
    color: Colors.error,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textMuted,
  },
  input: {
    backgroundColor: Colors.inputBackground,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: Colors.text,
  },
  editingCard: {
    borderColor: Colors.accent,
    borderWidth: 2,
  },
  editingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  editingTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.accent,
    textTransform: 'uppercase',
  },
  cancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textMuted,
    padding: 4,
  },
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
    color: Colors.accent,
  },
  deltaSpike: {
    color: Colors.error,
  },
  deltaOutlier: {
    color: Colors.error,
    fontWeight: '900',
    textDecorationLine: 'underline',
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
  trendsCard: {
    gap: 10,
  },
  trendsTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
  },
  trendsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 20,
  },
  trendItem: {
    gap: 2,
  },
  trendValue: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text,
  },
  trendLabel: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  paceGain: {
    color: Colors.error,
  },
  paceLoss: {
    color: Colors.accent,
  },
});

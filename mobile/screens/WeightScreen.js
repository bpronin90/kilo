import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Card, Button, SectionTitle } from '../components/UI';
import { Colors } from '../theme/colors';
import { useWeightEntries } from '../hooks/useEntries';
import { formatTimestamp } from '../lib/format';
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

  const handleDelete = () => {
    if (!editingId) return;
    Alert.alert(
      'Delete Entry',
      'Are you sure you want to delete this weight entry?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive', 
          onPress: async () => {
            await remove(editingId);
            cancelEdit();
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
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Text style={styles.title}>Weight log</Text>
        <Text style={styles.subtitle}>Track your body weight over time.</Text>
      </View>
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
        {editingId ? (
          <Button 
            onPress={handleDelete} 
            title="Delete entry" 
            style={styles.deleteButton}
            textStyle={styles.deleteButtonText}
          />
        ) : null}
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
        {entries.map((entry) => (
          <Pressable key={entry.id} onPress={() => handleEditEntry(entry)}>
            <Card style={editingId === entry.id ? styles.activeEntryCard : null}>
              <View style={styles.rowBetween}>
                <Text style={styles.entryTitle}>
                  {entry.weight_value} {entry.weight_unit || 'lb'}
                </Text>
                <Text style={styles.entryMeta}>{formatTimestamp(new Date(entry.logged_at).getTime())}</Text>
              </View>
              <Text style={styles.entryBody}>
                {entry.note || 'No note'}
              </Text>
            </Card>
          </Pressable>
        ))}
        {entries.length === 0 ? (
          <Text style={styles.emptyText}>No weight entries yet.</Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    paddingBottom: 120,
    gap: 16,
  },
  header: {
    paddingTop: 16,
    paddingBottom: 8,
    gap: 8,
  },
  title: {
    fontSize: 34,
    fontWeight: '700',
    color: Colors.text,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: Colors.textMuted,
  },
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
  deleteButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.error,
    marginTop: 8,
  },
  deleteButtonText: {
    color: Colors.error,
  },
  historyList: {
    gap: 12,
  },
  activeEntryCard: {
    borderColor: Colors.accent,
    backgroundColor: Colors.chipBackground,
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
  emptyText: {
    textAlign: 'center',
    color: Colors.textMuted,
    marginTop: 20,
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

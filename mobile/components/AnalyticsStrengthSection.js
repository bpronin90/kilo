import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, HeroMetric, SectionTitle, LineChart, ArtisanalPanel } from './UI';
import { Colors } from '../theme/colors';
import { lerpColor } from '../lib/AnalyticsScreenHelpers';

export function AnalyticsStrengthSection({
  handleStrengthLayout,
  isNotesLoading,
  oneK,
  oneKChartData,
  activeSlot,
  handleSlotTap,
  SLOT_LABELS,
  oneKSelections,
  noteExerciseNames,
  handleSelectExercise,
}) {
  const [big3Collapsed, setBig3Collapsed] = useState(false);
  const [selectedSeriesPoint, setSelectedSeriesPoint] = useState(null);

  const displayOneK = selectedSeriesPoint
    ? { total: selectedSeriesPoint.value, bench: selectedSeriesPoint.bench, squat: selectedSeriesPoint.squat, deadlift: selectedSeriesPoint.deadlift }
    : oneK;

  return (
    <View onLayout={handleStrengthLayout} style={styles.strengthSection}>
      <SectionTitle>Strength</SectionTitle>
      {(isNotesLoading || oneK?.total) ? (
        <ArtisanalPanel style={[styles.oneKCard, isNotesLoading && { opacity: 0.5, minHeight: 160, justifyContent: 'center' }]}>
          {isNotesLoading ? (
            <ActivityIndicator size="large" color={Colors.accent} />
          ) : (
            <>
              <Text style={styles.oneKLabel}>1K Progress</Text>
              <Text style={[styles.oneKValue, { color: lerpColor('#d98d42', '#4a7c44', Math.min(1, (displayOneK.total || 0) / 1000)) }]}>
                {displayOneK.total.toFixed(0)}<Text style={styles.oneKUnit}>lb</Text>
              </Text>

              <View style={styles.oneKProgressBarContainer}>
                <View style={[styles.oneKProgressBar, { width: `${Math.min(100, (displayOneK.total / 1000) * 100)}%` }]} />
              </View>

              <View style={styles.oneKBreakdown}>
                <View style={styles.oneKItem}>
                  <Text style={styles.oneKItemValue}>{displayOneK.squat?.toFixed(0) || '—'}</Text>
                  <Text style={styles.oneKItemLabel}>Squats</Text>
                </View>
                <View style={styles.oneKItem}>
                  <Text style={styles.oneKItemValue}>{displayOneK.bench?.toFixed(0) || '—'}</Text>
                  <Text style={styles.oneKItemLabel}>Bench</Text>
                </View>
                <View style={styles.oneKItem}>
                  <Text style={styles.oneKItemValue}>{displayOneK.deadlift?.toFixed(0) || '—'}</Text>
                  <Text style={styles.oneKItemLabel}>Deadlifts</Text>
                </View>
              </View>

              {oneKChartData.length > 1 && (
                <View style={styles.oneKChartBlock}>
                  <Text style={styles.oneKChartLabel}>1K total over sessions</Text>
                  <LineChart data={oneKChartData} height={120} hideHeader onSelect={p => setSelectedSeriesPoint(p)} />
                </View>
              )}
            </>
          )}
        </ArtisanalPanel>
      ) : (
        <Card style={styles.infoCard}>
          <Text style={styles.infoText}>
            Choose your squat, bench, and deadlift exercises below to track 1k progress.
          </Text>
        </Card>
      )}

      <Card style={styles.slotCard}>
        <Pressable
          style={styles.slotCardHeader}
          onPress={() => setBig3Collapsed(c => !c)}
          accessibilityRole="button"
          accessibilityLabel={big3Collapsed ? 'Expand Big 3 mapping' : 'Collapse Big 3 mapping'}
        >
          <Text style={styles.slotCardTitle}>Big 3 Mapping</Text>
          <Text style={styles.slotCardChevron} accessible={false}>{big3Collapsed ? '▼' : '▲'}</Text>
        </Pressable>
        {!big3Collapsed && (['bench', 'squat', 'deadlift']).map(slot => (
          <View key={slot}>
            <Pressable
              style={styles.slotRow}
              onPress={() => handleSlotTap(slot)}
              accessibilityRole="button"
              accessibilityLabel={`${SLOT_LABELS[slot]}, ${oneKSelections[slot]}, ${activeSlot === slot ? 'collapse' : 'expand'}`}
            >
              <Text style={styles.slotLabel}>{SLOT_LABELS[slot]}</Text>
              <View style={styles.slotValueRow}>
                <Text style={styles.slotValue}>{oneKSelections[slot]}</Text>
                <Text style={styles.slotChevron} accessible={false}>{activeSlot === slot ? '▲' : '▼'}</Text>
              </View>
            </Pressable>
            {activeSlot === slot && noteExerciseNames.length > 0 && (
              <View style={styles.slotPicker}>
                {noteExerciseNames.map(name => (
                  <Pressable
                    key={name}
                    style={[styles.slotOption, oneKSelections[slot] === name && styles.slotOptionSelected]}
                    onPress={() => handleSelectExercise(slot, name)}
                  >
                    <Text style={[styles.slotOptionText, oneKSelections[slot] === name && styles.slotOptionTextSelected]}>
                      {name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
            {activeSlot === slot && noteExerciseNames.length === 0 && (
              <Text style={styles.slotEmpty}>Add exercises to your note first.</Text>
            )}
          </View>
        ))}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  strengthSection: {
    gap: 16,
  },
  oneKCard: {
    padding: 24,
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.panelBackground,
  },
  oneKLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  oneKValue: {
    ...HeroMetric.hero,
    color: Colors.text,
  },
  oneKUnit: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textMuted,
    marginLeft: 4,
  },
  oneKProgressBarContainer: {
    width: '100%',
    height: 8,
    backgroundColor: Colors.divider,
    borderRadius: 4,
    marginVertical: 12,
    overflow: 'hidden',
  },
  oneKProgressBar: {
    height: '100%',
    backgroundColor: Colors.accent,
    borderRadius: 4,
  },
  oneKBreakdown: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  oneKChartBlock: {
    width: '100%',
    marginTop: 16,
  },
  oneKChartLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    textAlign: 'center',
  },
  oneKItem: {
    alignItems: 'center',
    gap: 2,
    flex: 1,
  },
  oneKItemValue: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  oneKItemLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textMuted,
    textTransform: 'uppercase',
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
  slotCard: {
    gap: 4,
    padding: 16,
  },
  slotCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  slotCardChevron: {
    fontSize: 12,
    color: Colors.textMuted,
    fontWeight: '700',
  },
  slotCardTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 0,
  },
  slotRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.cardBorder,
  },
  slotLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textMuted,
    width: 72,
  },
  slotValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    justifyContent: 'flex-end',
  },
  slotValue: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
    textAlign: 'right',
  },
  slotChevron: {
    fontSize: 10,
    color: Colors.textMuted,
  },
  slotPicker: {
    backgroundColor: Colors.inputBackground,
    borderRadius: 10,
    marginBottom: 4,
    overflow: 'hidden',
  },
  slotOption: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
  },
  slotOptionSelected: {
    backgroundColor: Colors.chipBackground,
  },
  slotOptionText: {
    fontSize: 14,
    color: Colors.text,
  },
  slotOptionTextSelected: {
    fontWeight: '700',
    color: Colors.accent,
  },
  slotEmpty: {
    fontSize: 13,
    color: Colors.textMuted,
    fontStyle: 'italic',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
});

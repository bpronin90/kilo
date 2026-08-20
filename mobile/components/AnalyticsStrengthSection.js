import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, HeroMetric, SectionTitle, LineChart, ArtisanalPanel } from './UI';
import { PlateCalculatorModal } from './PlateCalculatorModal';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';
import { lerpColor } from '../lib/AnalyticsScreenHelpers';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useWeightUnit } from '../lib/unitPreference';
import { displayWeight } from '../lib/units';

export function AnalyticsStrengthSection({
  handleStrengthLayout,
  isNotesLoading,
  oneK,
  oneKChartData,
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [selectedSeriesPoint, setSelectedSeriesPoint] = useState(null);
  const [oneKInfoExpanded, setOneKInfoExpanded] = useState(false);
  const [plateWeight, setPlateWeight] = useState(null);

  // oneK and oneKChartData arrive already converted into display space by
  // AnalyticsScreen. The 1,000 lb club threshold stays lb-defined; only its
  // display-space equivalent is used for the progress ratio here.
  const unit = useWeightUnit();
  const oneKTarget = displayWeight(1000, unit);

  const displayOneK = selectedSeriesPoint
    ? { total: selectedSeriesPoint.value, bench: selectedSeriesPoint.bench, squat: selectedSeriesPoint.squat, deadlift: selectedSeriesPoint.deadlift }
    : oneK;

  return (
    <View onLayout={handleStrengthLayout} style={styles.strengthSection}>
      <SectionTitle>Strength</SectionTitle>
      {(isNotesLoading || oneK?.total) ? (
        <ArtisanalPanel style={[styles.oneKCard, isNotesLoading && { opacity: 0.5, minHeight: 160, justifyContent: 'center' }]}>
          {isNotesLoading ? (
            <ActivityIndicator size="large" color={colors.accent} />
          ) : (
            <>
              <Text style={styles.oneKLabel}>1K Progress</Text>
              <Text style={[styles.oneKValue, { color: lerpColor(colors.accent, colors.success, Math.min(1, (displayOneK.total || 0) / oneKTarget)) }]}>
                {displayOneK.total.toFixed(0)}<Text style={styles.oneKUnit}> {unit}</Text>
              </Text>

              <View style={styles.oneKProgressBarContainer}>
                <View style={[styles.oneKProgressBar, { width: `${Math.min(100, (displayOneK.total / oneKTarget) * 100)}%` }]} />
              </View>

              <View style={styles.oneKBreakdown}>
                {[
                  { key: 'squat', label: 'Squats', value: displayOneK.squat },
                  { key: 'bench', label: 'Bench', value: displayOneK.bench },
                  { key: 'deadlift', label: 'Deadlifts', value: displayOneK.deadlift },
                ].map(item => (
                  <Pressable
                    key={item.key}
                    style={styles.oneKItem}
                    onPress={item.value ? () => setPlateWeight(Math.round(item.value)) : null}
                    accessibilityRole={item.value ? 'button' : undefined}
                    accessibilityLabel={item.value ? `Show plate loading for ${item.label} at ${item.value.toFixed(0)} pounds` : undefined}
                  >
                    <Text style={styles.oneKItemValue}>{item.value?.toFixed(0) || '—'}</Text>
                    <Text style={styles.oneKItemLabel}>{item.label}</Text>
                  </Pressable>
                ))}
              </View>

              {oneKChartData.length > 1 && (
                <View style={styles.oneKChartBlock}>
                  <Text style={styles.oneKChartLabel}>1K total over sessions</Text>
                  {/* showScale, but no minRange: the 1K genuinely moves in
                      meaningful steps, so flooring its domain would flatten real
                      progress. The weight charts need the floor; this one only
                      needed a readable scale. */}
                  <LineChart
                    data={oneKChartData}
                    height={120}
                    hideHeader
                    showScale
                    seriesLabel="1K total by session"
                    onSelect={p => setSelectedSeriesPoint(p)}
                  />
                </View>
              )}

              <View style={styles.oneKInfoBlock}>
                <Pressable
                  style={styles.oneKInfoToggle}
                  onPress={() => setOneKInfoExpanded(e => !e)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: oneKInfoExpanded }}
                  accessibilityLabel={oneKInfoExpanded ? 'Hide how the 1K is calculated' : 'How is the 1K calculated?'}
                  testID="onek-info-toggle"
                >
                  <MaterialIcons name="info-outline" size={14} color={colors.textMuted} accessible={false} />
                  <Text style={styles.oneKInfoToggleText}>How is this calculated?</Text>
                  <MaterialIcons
                    name={oneKInfoExpanded ? 'expand-less' : 'expand-more'}
                    size={16}
                    color={colors.textMuted}
                    accessible={false}
                  />
                </Pressable>
                {oneKInfoExpanded && (
                  <View style={styles.oneKInfoBody} testID="onek-info-body">
                    <Text style={styles.oneKInfoText}>
                      Your 1K sums the estimated 1-rep maxes from your most recent complete cycle of all three Big 3 lifts.
                    </Text>
                    <Text style={styles.oneKInfoText}>
                      If you train one lift more often than the others within a routine, it can read one session behind until the others catch up. This evens out as you log them and resets when you start a new routine.
                    </Text>
                    <Text style={styles.oneKInfoText}>
                      Deload sessions don't count toward strength stats like Kilo Max, but they still appear as their own point on the graph.
                    </Text>
                  </View>
                )}
              </View>
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

      <PlateCalculatorModal
        visible={plateWeight != null}
        weight={plateWeight}
        onClose={() => setPlateWeight(null)}
      />
    </View>
  );
}

// Split out of AnalyticsStrengthSection (#821). Strength and Progressive
// Overload are now one section — the 1K total, then every lift that feeds it —
// and this is configuration rather than analysis, so it sits at the foot of the
// section instead of between the total and its contributors.
export function AnalyticsBig3MappingCard({
  activeSlot,
  handleSlotTap,
  SLOT_LABELS,
  oneKSelections,
  noteExerciseNames,
  handleSelectExercise,
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  // Expanded by default, per ui-design-rules §6. Moving the card to the foot of
  // the section changes where it sits, not whether it opens closed.
  const [big3Collapsed, setBig3Collapsed] = useState(false);

  return (
      <Card style={styles.slotCard}>
        <Pressable
          style={styles.slotCardHeader}
          onPress={() => setBig3Collapsed(c => !c)}
          accessibilityRole="button"
          accessibilityState={{ expanded: !big3Collapsed }}
          accessibilityLabel={big3Collapsed ? 'Expand Big 3 mapping' : 'Collapse Big 3 mapping'}
        >
          <Text style={styles.slotCardTitle}>Big 3 Mapping</Text>
          <MaterialIcons
            name={big3Collapsed ? 'expand-more' : 'expand-less'}
            size={16}
            color={colors.textMuted}
            accessible={false}
          />
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
                <MaterialIcons
                  name={activeSlot === slot ? 'expand-less' : 'expand-more'}
                  size={14}
                  color={colors.textMuted}
                  accessible={false}
                />
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
  );
}

const createStyles = (colors) => StyleSheet.create({
  strengthSection: {
    gap: 16,
  },
  oneKCard: {
    padding: 24,
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.panelBackground,
  },
  oneKLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  oneKValue: {
    ...HeroMetric.hero,
    color: colors.text,
  },
  // Literal leading space, not marginLeft — this Text is nested inside the
  // value Text, and native RN treats a nested Text as an inline attributed
  // run rather than a Yoga box, so marginLeft is not guaranteed to render
  // (#763 review; matches Home's oneKHeroUnit).
  oneKUnit: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textMuted,
  },
  oneKProgressBarContainer: {
    width: '100%',
    height: 8,
    backgroundColor: colors.divider,
    borderRadius: 4,
    marginVertical: 12,
    overflow: 'hidden',
  },
  oneKProgressBar: {
    height: '100%',
    backgroundColor: colors.accent,
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
    color: colors.textMuted,
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
    color: colors.text,
  },
  oneKItemLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  oneKInfoBlock: {
    width: '100%',
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  oneKInfoToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  oneKInfoToggleText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  oneKInfoBody: {
    marginTop: 12,
    gap: 8,
  },
  oneKInfoText: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 19,
    textAlign: 'left',
  },
  infoCard: {
    backgroundColor: 'transparent',
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 20,
  },
  infoText: {
    fontSize: 14,
    color: colors.textMuted,
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
  slotCardTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 0,
  },
  slotRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  slotLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
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
    color: colors.text,
    textAlign: 'right',
  },
  slotPicker: {
    backgroundColor: colors.inputBackground,
    borderRadius: 10,
    marginBottom: 4,
    overflow: 'hidden',
  },
  slotOption: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  slotOptionSelected: {
    backgroundColor: colors.chipBackground,
  },
  slotOptionText: {
    fontSize: 14,
    color: colors.text,
  },
  slotOptionTextSelected: {
    fontWeight: '700',
    color: colors.accent,
  },
  slotEmpty: {
    fontSize: 13,
    color: colors.textMuted,
    fontStyle: 'italic',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
});

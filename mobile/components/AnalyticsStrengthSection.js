import { GEOMETRY } from '../theme/spacing';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, SectionTitle, LineChart, ArtisanalPanel } from './UI';
import { OneKProgressSummary, createOneKSummaryStyles } from './OneKProgressSummary';
import { PlateCalculatorModal } from './PlateCalculatorModal';
import { useTheme } from '../theme/ThemeContext';
import { TYPOGRAPHY } from '../theme/typography';
import { lerpColor } from '../lib/AnalyticsScreenHelpers';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useWeightUnit } from '../lib/unitPreference';
import { displayWeight } from '../lib/units';
import { InfoButton, InfoNote, useInfoExplainer } from './InfoExplainer';

export function AnalyticsStrengthSection({
  handleStrengthLayout,
  isNotesLoading,
  oneK,
  oneKCanonical,
  oneKChartData,
  // #1246: Big 3 Mapping slots in under the 1K panel — configuration, so it
  // follows the analysis and starts collapsed.
  big3Mapping = null,
}) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStyles(colors, kua), [colors, kua]);
  const [selectedSeriesPoint, setSelectedSeriesPoint] = useState(null);
  const [oneKInfoExpanded, toggleOneKInfo] = useInfoExplainer();
  const [plateWeightLb, setPlateWeightLb] = useState(null);

  // oneK and oneKChartData arrive already converted into display space by
  // AnalyticsScreen. The 1,000 lb club threshold stays lb-defined; only its
  // display-space equivalent is used for the progress ratio here.
  const unit = useWeightUnit();
  const oneKTarget = displayWeight(1000, unit);

  const displayOneK = selectedSeriesPoint
    ? { total: selectedSeriesPoint.value, bench: selectedSeriesPoint.bench, squat: selectedSeriesPoint.squat, deadlift: selectedSeriesPoint.deadlift }
    : oneK;

  // #577: the plate calculator needs the CANONICAL lb figure, never the
  // display-converted `displayOneK` value above — back-converting an
  // already-rounded kg display number reintroduces a precision/unit bug.
  // `oneKCanonical` (steady state) and each chart point's `*Lb` fields
  // (selected-point state) are threaded in by AnalyticsScreen for exactly
  // this purpose.
  const canonicalOneK = selectedSeriesPoint
    ? {
      total: selectedSeriesPoint.valueLb,
      bench: selectedSeriesPoint.benchLb,
      squat: selectedSeriesPoint.squatLb,
      deadlift: selectedSeriesPoint.deadliftLb,
    }
    : oneKCanonical;

  return (
    <View onLayout={handleStrengthLayout} style={styles.strengthSection}>
      <SectionTitle>Strength</SectionTitle>
      {(isNotesLoading || oneK?.total) ? (
        <ArtisanalPanel style={[styles.oneKCard, isNotesLoading && { opacity: 0.5, minHeight: 160, justifyContent: 'center' }]}>
          {isNotesLoading ? (
            <ActivityIndicator size="large" color={kua ? kua.primary : colors.accent} />
          ) : (
            <>
              <OneKProgressSummary
                total={displayOneK.total}
                target={oneKTarget}
                unit={unit}
                totalColor={lerpColor(kua ? kua.primary : colors.accentText, kua ? kua.success : colors.success, Math.min(1, (displayOneK.total || 0) / oneKTarget))}
                // #1245: the explainer sits behind the shared info icon beside its heading.
                titleAccessory={(
                  <InfoButton
                    testID="onek-info-toggle"
                    expanded={oneKInfoExpanded}
                    onPress={toggleOneKInfo}
                    label="What is 1K Progress?"
                  />
                )}
                belowTitle={(
                  <InfoNote shown={oneKInfoExpanded} testID="onek-info-body" style={styles.oneKInfoBody}>
                    <Text style={styles.oneKInfoText}>
                      1K is your estimated Squat + Bench + Deadlift one-rep max total, using the lifts in your Big 3 mapping.
                    </Text>
                    <Text style={styles.oneKInfoText}>
                      It totals your most recent complete Big 3 cycle, so a lift you trained more recently can read one session behind until the others catch up.
                    </Text>
                    <Text style={styles.oneKInfoText}>
                      Deload sessions appear on the graph as their own marked point, kept off the trend line.
                    </Text>
                  </InfoNote>
                )}
                lifts={[
                  { key: 'squat', label: 'Squat', value: displayOneK.squat, weightLb: canonicalOneK?.squat },
                  { key: 'bench', label: 'Bench', value: displayOneK.bench, weightLb: canonicalOneK?.bench },
                  { key: 'deadlift', label: 'Deadlift', value: displayOneK.deadlift, weightLb: canonicalOneK?.deadlift },
                ].map(item => ({
                  ...item,
                  onPress: item.value && item.weightLb ? () => setPlateWeightLb(item.weightLb) : null,
                  // #577 review: `item.value` is display-space (it can be kg under a
                  // metric preference) — never announce it as pounds.
                  accessibilityLabel: item.value ? `Show plate loading for ${item.label} at ${item.value.toFixed(0)} ${unit === 'kg' ? 'kilograms' : 'pounds'}` : undefined,
                }))}
              >
              {oneKChartData.length > 1 && (
                <View style={styles.oneKChartBlock}>
                  <Text style={styles.oneKChartLabel}>1K total over sessions</Text>
                  <LineChart
                    data={oneKChartData}
                    height={120}
                    hideHeader
                    showScale
                    color={kua ? kua.primary : undefined}
                    seriesLabel="1K total by session"
                    onSelect={p => setSelectedSeriesPoint(p)}
                  />
                </View>
              )}
              </OneKProgressSummary>
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

      {big3Mapping}

      <PlateCalculatorModal
        visible={plateWeightLb != null}
        weightLb={plateWeightLb}
        onClose={() => setPlateWeightLb(null)}
      />
    </View>
  );
}

// Split out of AnalyticsStrengthSection (#821). It sits under the 1K panel
// (#1246), since it picks the lifts that feed the total.
export function AnalyticsBig3MappingCard({
  activeSlot,
  handleSlotTap,
  SLOT_LABELS,
  oneKSelections,
  noteExerciseNames,
  handleSelectExercise,
}) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStyles(colors, kua), [colors, kua]);
  // Collapsed by default: mapping is setup, not analysis — the 1K evidence
  // above it should lead the Strength section.
  const [big3Collapsed, setBig3Collapsed] = useState(true);

  return (
      <Card style={styles.slotCard}>
        <Pressable
          style={styles.slotCardHeader}
          onPress={() => setBig3Collapsed(c => !c)}
          accessibilityRole="button"
          accessibilityState={{ expanded: !big3Collapsed }}
          accessibilityLabel={big3Collapsed ? 'Expand Big 3 mapping' : 'Collapse Big 3 mapping'}
        >
          <View style={styles.slotCardTitleBlock}>
            <Text style={styles.slotCardTitle}>Big 3 Mapping</Text>
            {/* ui-design-rules §6: a collapsed panel keeps a one-line summary. */}
            {big3Collapsed && (
              <Text testID="big3-mapping-summary" style={styles.slotCardSummary} numberOfLines={1}>
                {['squat', 'bench', 'deadlift'].map(slot => oneKSelections[slot]).join(' · ')}
              </Text>
            )}
          </View>
          <MaterialIcons
            name={big3Collapsed ? 'expand-more' : 'expand-less'}
            size={16}
            color={kua ? kua.onSurfaceVariant : colors.textMuted}
            accessible={false}
          />
        </Pressable>
        {!big3Collapsed && (['bench', 'squat', 'deadlift']).map(slot => (
          <View key={slot}>
            <Pressable
              style={styles.slotRow}
              onPress={() => handleSlotTap(slot)}
              accessibilityRole="button"
              accessibilityState={{ expanded: activeSlot === slot }}
              accessibilityLabel={`${SLOT_LABELS[slot]}, ${oneKSelections[slot]}, ${activeSlot === slot ? 'collapse' : 'expand'}`}
            >
              <Text style={styles.slotLabel}>{SLOT_LABELS[slot]}</Text>
              <View style={styles.slotValueRow}>
                <Text style={styles.slotValue}>{oneKSelections[slot]}</Text>
                <MaterialIcons
                  name={activeSlot === slot ? 'expand-less' : 'expand-more'}
                  size={14}
                  color={kua ? kua.onSurfaceVariant : colors.textMuted}
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
                    accessibilityRole="button"
                    accessibilityState={{ selected: oneKSelections[slot] === name }}
                    accessibilityLabel={`Use ${name} for ${SLOT_LABELS[slot]}`}
                  >
                    <Text
                      style={[styles.slotOptionText, oneKSelections[slot] === name && styles.slotOptionTextSelected]}
                      accessible={false}
                    >
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

export const createStyles = (colors, kua = null) => {
  const summaryStyles = createOneKSummaryStyles(colors, kua);
  return StyleSheet.create({
  strengthSection: {
    gap: 12,
  },
  oneKCard: {
    padding: 24,
    alignItems: 'center',
    gap: 8,
    backgroundColor: kua ? kua.surfaceCard : colors.panelBackground,
  },
  // The 1K heading/total/bar/breakdown styles live with the shared
  // OneKProgressSummary (#1458); these are the same style objects, kept under
  // their historical names for the theme fixtures.
  oneKValue: summaryStyles.oneKValue,
  oneKProgressBar: summaryStyles.oneKProgressBar,
  oneKChartBlock: {
    width: '100%',
    marginTop: 16,
  },
  oneKChartLabel: {
    fontSize: TYPOGRAPHY['label-sm'].fontSize,
    fontWeight: '800',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    textAlign: 'center',
  },
  oneKInfoBody: {
    width: '100%',
    marginBottom: 12,
    gap: 8,
  },
  oneKInfoText: {
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    lineHeight: 19,
    textAlign: 'left',
  },
  infoCard: {
    backgroundColor: 'transparent',
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
    padding: 20,
  },
  infoText: {
    fontSize: TYPOGRAPHY['body-md'].fontSize,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
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
    minHeight: 44,
  },
  slotCardTitleBlock: {
    flex: 1,
    gap: 2,
  },
  slotCardSummary: {
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
    color: kua ? kua.onSurface : colors.text,
  },
  slotCardTitle: {
    fontSize: TYPOGRAPHY['label-md'].fontSize,
    fontWeight: '700',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 0,
  },
  // The slot row and each picker option carry the 44dp minimum in the box: they
  // stack directly against their neighbours (and the row is the picker's own
  // disclosure trigger), so a hitSlop would overlap (#904).
  slotRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: kua ? kua.surfaceBorder : colors.cardBorder,
    minHeight: 44,
  },
  slotLabel: {
    fontSize: TYPOGRAPHY['body-md'].fontSize,
    fontWeight: '600',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
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
    ...(kua ? TYPOGRAPHY['label-lg'] : { fontSize: TYPOGRAPHY['label-lg'].fontSize, fontWeight: '600' }),
    color: kua ? kua.onSurface : colors.text,
    textAlign: 'right',
  },
  slotPicker: {
    backgroundColor: kua ? kua.surfaceSection : colors.inputBackground,
    borderRadius: GEOMETRY['radius-lg'],
    marginBottom: 4,
    overflow: 'hidden',
  },
  slotOption: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: kua ? kua.surfaceBorder : colors.cardBorder,
    minHeight: 44,
    justifyContent: 'center',
  },
  slotOptionSelected: {
    backgroundColor: kua ? kua.primaryContainer : colors.chipBackground,
  },
  slotOptionText: {
    fontSize: TYPOGRAPHY['body-md'].fontSize,
    color: kua ? kua.onSurface : colors.text,
  },
  slotOptionTextSelected: {
    fontWeight: '700',
    color: kua ? kua.primaryOnContainer : colors.chipAccentText,
  },
  slotEmpty: {
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    fontStyle: 'italic',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  });
};

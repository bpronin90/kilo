import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SectionTitle, SessionGauge } from '../../components/UI';
import { AnalyticsFatigueCard } from '../../components/AnalyticsFatigueCard';
import { AnalyticsStrengthSection, AnalyticsBig3MappingCard } from '../../components/AnalyticsStrengthSection';
import { renderOverloadListContent } from './AnalyticsStates';

// The baseline-training presentation for Analytics (#821, #871): the
// Recovery-collapsible disclosure, Fatigue, the merged Strength/Progressive
// Overload section (1K total, sticky search/collapse-all header, the
// tracked-exercise rows, and Big 3 Mapping at the foot). Moved verbatim out
// of AnalyticsScreen.js (card #1051) — same conditions, keys, testIDs and
// child-component props as before, only the module boundary changed.
//
// Returns a flat array of elements — NOT a single wrapped component — so
// that spreading it into AnalyticsScreen's `screenContent` array preserves
// the exact top-level sibling order the sticky-header index calculation (and
// ScrollView's own sticky-header behavior) depends on: the sticky header and
// the overload-list anchor must stay adjacent, flat siblings just as they
// were before this split.
export function AnalyticsProgression({
  isActiveRecovery,
  baselineCollapsed,
  setBaselineCollapsed,
  styles,
  colors,
  sinceDeload,
  sessionCount,
  deloadModeEnabled,
  fatigueTrackingEnabled,
  checkInHistory,
  fatigueExpanded,
  setFatigueExpanded,
  handleCheckInEdit,
  handleStrengthLayout,
  isNotesLoading,
  isTrackedLoading,
  oneK,
  oneKCanonical,
  oneKChartData,
  progressionSuggestionView,
  onMuteProgression,
  onUnmuteProgression,
  onDismissProgression,
  handleProgressiveOverloadHeaderLayout,
  groupedSignals,
  toggleAllGroups,
  allGroupsCollapsed,
  searchQuery,
  setSearchQuery,
  handleProgressiveOverloadListLayout,
  analytics,
  trackedLiftActivations,
  unit,
  onNavigate,
  collapsedGroups,
  toggleGroup,
  activeSlot,
  handleSlotTap,
  SLOT_LABELS,
  oneKSelections,
  noteExerciseNames,
  handleSelectExercise,
}) {
  const baselineExpanded = !isActiveRecovery || !baselineCollapsed;

  return [
    // Baseline-training disclosure (#871, Zero Friction F9). Fatigue,
    // Strength/Progressive Overload, and Big 3 Mapping are all derived from
    // baseline sessions, which have stopped accumulating for the duration of
    // an active Recovery block — they group under one collapsible "paused"
    // disclosure instead of leading the tab, and expand back to the plain,
    // always-visible normal hierarchy the moment Recovery ends.
    isActiveRecovery ? (
      <Pressable
        key="baseline-disclosure-toggle"
        testID="baseline-disclosure-toggle"
        onPress={() => setBaselineCollapsed(v => !v)}
        style={styles.baselineDisclosureToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: !baselineCollapsed }}
        accessibilityLabel="Baseline training, paused during Recovery"
        accessibilityHint={baselineCollapsed ? 'Shows fatigue and strength history from before Recovery' : 'Hides fatigue and strength history from before Recovery'}
      >
        <Text style={styles.baselineDisclosureLabel}>Baseline training · paused during Recovery</Text>
        <MaterialIcons
          name={baselineCollapsed ? 'expand-more' : 'expand-less'}
          size={20}
          color={colors.textMuted}
          accessible={false}
        />
      </Pressable>
    ) : null,

    baselineExpanded ? (
      <View key="combined-section-title">
        <SectionTitle>Fatigue</SectionTitle>
      </View>
    ) : null,
    baselineExpanded ? (
      // Suppressed advisory (#871): the deload gauge assumes baseline sessions
      // are actively accumulating, which is untrue for the duration of an
      // active Recovery block. The count itself still renders (as paused
      // history), only the "you should deload soon" advisory is withheld.
      <SessionGauge key="session-gauge" count={sinceDeload} total={sessionCount} showDeload={deloadModeEnabled && !isActiveRecovery} />
    ) : null,

    baselineExpanded && fatigueTrackingEnabled ? (
      <AnalyticsFatigueCard
        key="fatigue-card"
        checkInHistory={checkInHistory}
        fatigueExpanded={fatigueExpanded}
        setFatigueExpanded={setFatigueExpanded}
        handleCheckInEdit={handleCheckInEdit}
      />
    ) : null,

    // Strength and Progressive Overload are one section (#821): the 1K
    // total, then every lift that feeds it. Only the 1K panel carries the
    // section title now — the sticky header below is a heading inside this
    // section, not a second top-level one — and Big 3 Mapping moves to the
    // foot, because it is configuration rather than analysis and was sitting
    // between the total and its contributors.
    baselineExpanded ? (
      <AnalyticsStrengthSection
        key="strength-section"
        handleStrengthLayout={handleStrengthLayout}
        isNotesLoading={isNotesLoading}
        oneK={oneK}
        oneKCanonical={oneKCanonical}
        oneKChartData={oneKChartData}
        progressionSuggestions={progressionSuggestionView.visible}
        mutedProgressionRows={progressionSuggestionView.muted}
        onMuteProgression={onMuteProgression}
        onUnmuteProgression={onUnmuteProgression}
        onDismissProgression={onDismissProgression}
      />
    ) : null,

    baselineExpanded ? (
      <View
        key="sticky-header"
        style={styles.signalStickyHeader}
        testID="sticky-header"
        onLayout={handleProgressiveOverloadHeaderLayout}
      >
        <View style={styles.signalHeaderRow}>
          {/* A heading inside the Strength section, not a section title of its
              own (#821) — hence the smaller sub-header style rather than
              SectionTitle, which now appears once per section as intended. */}
          <Text style={styles.signalSubTitle} accessibilityRole="header">Progressive Overload</Text>
          {groupedSignals.length > 0 && (
            <Pressable
              testID="po-collapse-all"
              onPress={toggleAllGroups}
              style={styles.collapseAllButton}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityState={{ expanded: !allGroupsCollapsed }}
              accessibilityLabel={
                allGroupsCollapsed ? 'Expand all exercise groups' : 'Collapse all exercise groups'
              }
            >
              <Text style={styles.collapseAllText}>
                {allGroupsCollapsed ? 'Expand all' : 'Collapse all'}
              </Text>
              {/* `unfold-less`/`unfold-more` rather than the single-panel
                  `expand-less`/`expand-more` chevron of ui-design-rules §6: this
                  acts on every group at once, and reusing the per-panel glyph
                  would read as the sticky header collapsing itself. */}
              <MaterialIcons
                name={allGroupsCollapsed ? 'unfold-more' : 'unfold-less'}
                size={16}
                color={colors.textMuted}
                accessible={false}
              />
            </Pressable>
          )}
        </View>
        <View style={styles.searchContainer}>
          <TextInput
            testID="po-search"
            style={styles.searchInput}
            placeholder="Search tracked exercises..."
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            clearButtonMode="while-editing"
          />
        </View>
        <View style={styles.signalColumnHeader}>
          <View style={styles.signalColumnMetrics}>
            <Text style={styles.signalColumnLabel}>1RM</Text>
            <Text style={styles.signalColumnLabel}>Kilo</Text>
            <Text style={styles.signalColumnLabel}>Best</Text>
            <Text style={styles.signalColumnLabel}>Trend</Text>
          </View>
        </View>
      </View>
    ) : null,

    // Progressive Overload's measurable box (#770): the sticky header above
    // cannot report its own content offset, so this list — an ordinary child
    // with an ordinary one — carries the anchor. Every branch renders content,
    // so the wrapper is never an empty box in the shell's column.
    baselineExpanded ? (
      <View
        key="overload-list"
        testID="overload-list-anchor"
        onLayout={handleProgressiveOverloadListLayout}
      >
        {renderOverloadListContent({
          isNotesLoading,
          isTrackedLoading,
          groupedSignals,
          collapsedGroups,
          toggleGroup,
          analytics,
          trackedLiftActivations,
          unit,
          colors,
          styles,
          searchQuery,
          onNavigate,
        })}
      </View>
    ) : null,

    // Foot of the merged Strength section.
    baselineExpanded ? (
      <AnalyticsBig3MappingCard
        key="big3-mapping"
        activeSlot={activeSlot}
        handleSlotTap={handleSlotTap}
        SLOT_LABELS={SLOT_LABELS}
        oneKSelections={oneKSelections}
        noteExerciseNames={noteExerciseNames}
        handleSelectExercise={handleSelectExercise}
      />
    ) : null,
  ];
}

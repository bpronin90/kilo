import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SectionTitle } from '../../components/UI';
import { FieldLabel } from '../../components/FieldLabel';
import { InfoButton, InfoNote, useInfoExplainer } from '../../components/InfoExplainer';
import { ProgressionSuggestionCard, MutedProgressionRow } from '../../components/ProgressionSuggestionCard';
import { renderOverloadListContent } from './AnalyticsStates';

// Progressive Overload, its own top-level Analytics section: the canonical
// Exercise Progress summary, progression suggestions (moved here from
// Strength — they concern per-exercise progression, not the 1K), the
// search/collapse controls, and the tracked-exercise table. The whole section
// is one measurable box, so the `progressive-overload` handoff lands on it.
//
// It computes nothing: the counts are `analytics.exerciseProgress` (the same
// object Home renders) and suggestions arrive pre-filtered by AnalyticsScreen.
export function AnalyticsProgressiveOverloadSection({
  styles,
  colors,
  kua,
  onLayout,
  isNotesLoading,
  isTrackedLoading,
  analytics,
  progressionSuggestionView,
  onMuteProgression,
  onUnmuteProgression,
  onDismissProgression,
  groupedSignals,
  toggleAllGroups,
  allGroupsCollapsed,
  collapsedGroups,
  toggleGroup,
  searchQuery,
  setSearchQuery,
  unit,
  onNavigate,
}) {
  const [infoShown, toggleInfo] = useInfoExplainer();
  // #1246: with no rows to search or label, the search box and 1RM/Kilo/Best/
  // Trend headers are empty chrome. An active query stays (it must be clearable).
  const showTableChrome = groupedSignals.length > 0 || Boolean(searchQuery);
  const progress = analytics?.exerciseProgress;
  // Shown whenever tracked exercises exist — a routine where every exercise is
  // on its first tracked session still reads 0 / 0 / 0, not nothing.
  const hasTrackedExercises = Boolean(progress) && (
    progress.classified > 0
    || progress.newlyTracked > 0
    || (analytics?.signals?.length ?? 0) > 0
    || Object.keys(analytics?.nonWeightedMetrics || {}).length > 0
  );
  const showSummary = !isNotesLoading && !isTrackedLoading && hasTrackedExercises;
  const suggestions = progressionSuggestionView?.visible || [];
  const muted = progressionSuggestionView?.muted || [];

  return (
    <View testID="progressive-overload-section" onLayout={onLayout} style={styles.poSection}>
      <View style={styles.signalHeaderRow}>
        <View style={styles.poTitleRow}>
          <SectionTitle>Progressive Overload</SectionTitle>
          <InfoButton
            testID="po-info-toggle"
            expanded={infoShown}
            onPress={toggleInfo}
            label="How Progressive Overload is measured"
          />
        </View>
        {groupedSignals.length > 0 && (
          <Pressable
            testID="po-collapse-all"
            onPress={toggleAllGroups}
            style={styles.collapseAllButton}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityState={{ expanded: !allGroupsCollapsed }}
            accessibilityLabel={allGroupsCollapsed ? 'Expand all exercise groups' : 'Collapse all exercise groups'}
          >
            <Text style={styles.collapseAllText}>{allGroupsCollapsed ? 'Expand all' : 'Collapse all'}</Text>
            {/* `unfold-*` rather than the single-panel chevron (ui-design-rules
                §6): this acts on every group at once. */}
            <MaterialIcons
              name={allGroupsCollapsed ? 'unfold-more' : 'unfold-less'}
              size={16}
              color={kua ? kua.onSurfaceVariant : colors.textMuted}
              accessible={false}
            />
          </Pressable>
        )}
      </View>

      <InfoNote shown={infoShown} testID="po-info-body" style={styles.poInfoBody}>
        <Text style={styles.poInfoText}>1RM is your estimated one-rep max from recent sets. Kilo averages Epley estimates from eligible historical sets, then applies the fatigue multiplier from Settings. Best is your latest top set. Trend shows whether the exercise is progressing, steady, or regressing.</Text>
        <Text style={styles.poInfoText}>Tapping Track starts a new tracked span: Trend builds from that session, while 1RM, Kilo and Best stay historical.</Text>
        <Text style={styles.poInfoText}>An exercise tracked without a Track tap inherits its full history.</Text>
        <Text style={styles.poInfoText}>Deload sessions don't count toward progression.</Text>
      </InfoNote>

      {showSummary && (
        <View testID="po-progress-summary" style={styles.poSummaryRow}>
          {[
            { key: 'progressing', label: 'Progressing', count: progress.progressing, color: kua ? kua.success : colors.success },
            { key: 'stalled', label: 'Steady', count: progress.stalled, color: kua ? kua.warning : colors.caution },
            { key: 'regressing', label: 'Regressing', count: progress.regressing, color: kua ? kua.errorText : colors.error },
          ].map(item => (
            <View key={item.key} style={styles.poSummaryCol} testID={`po-progress-${item.key}`}>
              <Text style={[styles.poSummaryCount, { color: item.color }]}>{item.count}</Text>
              <Text style={styles.poSummaryLabel}>{item.label}</Text>
            </View>
          ))}
        </View>
      )}

      {(suggestions.length > 0 || muted.length > 0) && (
        <View style={styles.poSuggestions} testID="analytics-progression-suggestions">
          {suggestions.map(({ record, key, instanceId }) => (
            <ProgressionSuggestionCard
              key={instanceId}
              suggestion={record}
              surface="analytics"
              onMute={() => onMuteProgression && onMuteProgression(key)}
              onDismiss={() => onDismissProgression && onDismissProgression(instanceId)}
            />
          ))}
          {muted.map(row => (
            <MutedProgressionRow
              key={row.key}
              name={row.name}
              surface="analytics"
              onUnmute={() => onUnmuteProgression && onUnmuteProgression(row.key)}
            />
          ))}
        </View>
      )}

      {showTableChrome && (
        <View testID="po-header">
          <View style={styles.searchContainer}>
            <FieldLabel>Search exercises</FieldLabel>
            <TextInput
              testID="po-search"
              style={styles.searchInput}
              placeholder="Search tracked exercises..."
              placeholderTextColor={kua ? kua.onSurfaceVariant : colors.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              clearButtonMode="while-editing"
              accessibilityLabel="Search tracked exercises"
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
      )}

      {renderOverloadListContent({
        isNotesLoading,
        isTrackedLoading,
        groupedSignals,
        collapsedGroups,
        toggleGroup,
        analytics,
        unit,
        colors,
        kua,
        styles,
        searchQuery,
        onNavigate,
      })}
    </View>
  );
}

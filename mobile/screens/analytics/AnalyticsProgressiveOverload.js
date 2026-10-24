import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SectionTitle } from '../../components/UI';
import { Panel, MonoLabel } from '../../components/ui/RedesignPrimitives';
import { InfoButton, InfoNote, useInfoExplainer } from '../../components/InfoExplainer';
import { ProgressionSuggestionCard, MutedProgressionRow } from '../../components/ProgressionSuggestionCard';
import { renderOverloadListContent } from './AnalyticsStates';
import { establishingBaselineMessage } from '../../lib/data/exerciseProgress';
import { OverloadFilterChips, OverloadStatusBar, overloadCounts } from './OverloadFilterChips';
import { OverloadExerciseSheet } from './OverloadExerciseSheet';
import { overloadRowModel, overloadRowKey } from './OverloadRows';

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
  // Redesign v3 (#1604): the status chip lives with the screen, so Collapse all
  // and the group list read the same filtered view; the sheet's selection is
  // local, keyed by routine so a different routine never reopens it.
  statusFilter = 'all',
  onStatusFilterChange,
  currentNoteId = null,
  currentSections = [],
}) {
  // Two scoped explainers (#1356): one for the Exercise Progress states, one
  // for the table's metric columns. Neither documents the whole section.
  const [progressInfoShown, toggleProgressInfo] = useInfoExplainer();
  const [metricsInfoShown, toggleMetricsInfo] = useInfoExplainer();
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
  // #1391: all tracked exercises on their first tracked session read as a
  // baseline being established, not as 0 / 0 / 0.
  const baselineMessage = establishingBaselineMessage(progress);
  const suggestions = progressionSuggestionView?.visible || [];
  const muted = progressionSuggestionView?.muted || [];

  const counts = overloadCounts(progress);
  const [selected, setSelected] = useState(null);
  const rowRefs = useRef(new Map());
  const registerRow = sig => node => {
    const key = overloadRowKey(sig);
    if (node) rowRefs.current.set(key, node);
    else rowRefs.current.delete(key);
  };
  // The selection is a routine + row identity, re-resolved against the rows on
  // screen: a routine or dataset change that drops the row closes the sheet.
  const selectedSig = selected && selected.noteId === currentNoteId
    ? groupedSignals.flatMap(group => group.exercises).find(sig => overloadRowKey(sig) === selected.key) || null
    : null;
  // A selection whose row is gone (routine or dataset change) is dropped, not
  // just hidden, so returning to the old routine never reopens the sheet.
  useEffect(() => { if (selected && !selectedSig) setSelected(null); }, [selected, selectedSig]);
  const selectedModel = selectedSig ? overloadRowModel(selectedSig, analytics, unit) : null;
  const openExercise = sig => setSelected({ noteId: currentNoteId, key: overloadRowKey(sig) });
  const closeSheet = () => {
    const key = selected?.key;
    setSelected(null);
    // Focus goes back to the row that opened it (web; a no-op where the host
    // view has no focus()).
    setTimeout(() => { rowRefs.current.get(key)?.focus?.(); }, 0);
  };
  const viewInLog = currentNoteId && onNavigate
    ? () => { setSelected(null); onNavigate('Log', { kind: 'note', noteId: currentNoteId }); }
    : null;
  const ruled = [styles.poPanelSection, styles.poPanelSectionRuled];

  return (
    <View testID="progressive-overload-section" onLayout={onLayout} style={styles.poSection}>
      <View style={styles.signalHeaderRow}>
        <SectionTitle>Progressive Overload</SectionTitle>
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

      <Panel testID="po-panel">
        {showSummary && (
          <View testID="po-progress-block" style={styles.poPanelSection}>
            <View>
              <View style={styles.poTitleRow}>
                <MonoLabel numberOfLines={1}>Exercise Progress</MonoLabel>
                <InfoButton
                  testID="po-progress-info-toggle"
                  expanded={progressInfoShown}
                  onPress={toggleProgressInfo}
                  label="What Progressing, Steady, and Regressing mean"
                />
              </View>
              <InfoNote shown={progressInfoShown} testID="po-progress-info-body" style={styles.poInfoBody}>
                <Text style={styles.poInfoText}>Progressing, Steady, and Regressing show whether each tracked exercise's strength is going up, holding, or going down across its tracked sessions.</Text>
                <Text style={styles.poInfoText}>An exercise in its first tracked session needs another logged session before it gets a trend.</Text>
                <Text style={styles.poInfoText}>Tapping Track starts tracking from that session, so its trend builds from there. An exercise tracked without a Track tap uses its earlier history.</Text>
                <Text style={styles.poInfoText}>Deload sessions don't count toward progression.</Text>
              </InfoNote>
            </View>
            {baselineMessage ? (
              <View testID="po-progress-baseline" style={styles.poSummaryRow}>
                <Text style={styles.poInfoText}>{baselineMessage}</Text>
              </View>
            ) : (
              <View testID="po-progress-summary" style={styles.poPanelSummary}>
                <OverloadStatusBar counts={counts} />
                <OverloadFilterChips counts={counts} value={statusFilter} onChange={onStatusFilterChange || (() => {})} />
              </View>
            )}
          </View>
        )}

        {(suggestions.length > 0 || muted.length > 0) && (
          <View style={[...ruled, styles.poSuggestions]} testID="analytics-progression-suggestions">
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
          <View testID="po-header" style={ruled}>
            <View style={styles.searchContainer}>
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
            <View>
              <View style={styles.poTitleRow}>
                <MonoLabel>Metrics</MonoLabel>
                <InfoButton
                  testID="po-metrics-info-toggle"
                  expanded={metricsInfoShown}
                  onPress={toggleMetricsInfo}
                  label="What 1RM, Kilo, Best, and Trend mean"
                />
              </View>
              <InfoNote shown={metricsInfoShown} testID="po-metrics-info-body" style={styles.poInfoBody}>
                <Text style={styles.poInfoText}>1RM: your estimated one-rep max.</Text>
                <Text style={styles.poInfoText}>Kilo: Kilo's estimate of your strength from your logged history.</Text>
                <Text style={styles.poInfoText}>Best: your latest top set.</Text>
                <Text style={styles.poInfoText}>Trend: the Exercise Progress state shown above.</Text>
              </InfoNote>
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
          statusFilterActive: statusFilter !== 'all' && showSummary && !baselineMessage,
          onNavigate,
          onOpenExercise: openExercise,
          registerRow,
        })}
      </Panel>

      <OverloadExerciseSheet
        visible={Boolean(selectedSig)}
        model={selectedModel}
        sig={selectedSig}
        currentSections={currentSections}
        unit={unit}
        styles={styles}
        colors={colors}
        kua={kua}
        onClose={closeSheet}
        onViewInLog={viewInLog}
      />
    </View>
  );
}

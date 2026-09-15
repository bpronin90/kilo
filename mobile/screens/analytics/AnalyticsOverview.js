import React from 'react';
import { View } from 'react-native';
import { ErrorBanner } from '../../components/UI';
import { AnalyticsWeightTrendsCard } from '../../components/AnalyticsWeightTrendsCard';
import { AnalyticsOverviewCard } from '../../components/AnalyticsOverviewCard';

// The top-of-tab presentation for Analytics (#821, #737): load-failure
// banners (one per failed source, each retrying only its own read), the
// Overview card itself, the Weight Trends card, and the Recovery section
// (wrapped in its own measurable anchor only while it has something to
// render — see AnalyticsScreen.js's `hasRecoverySection`).
//
// Returns a flat array of elements — NOT a single wrapped component — so
// that spreading it into AnalyticsScreen's `screenContent` array preserves
// the exact top-level sibling order and keys the sticky-header index
// calculation (and ScrollView's own sticky-header behavior) depends on.
export function AnalyticsOverview({
  notesError,
  refreshNotes,
  weightError,
  refreshWeightEntries,
  overviewRows,
  overviewLoading,
  overviewAsOf,
  onSelectSection,
  handleWeightLayout,
  weightSummary,
  rolling7,
  rolling30,
  isWeightLoading,
  onNavigate,
  hasRecoverySection,
  handleRecoveryLayout,
  recoverySection,
}) {
  return [
    notesError ? (
      <ErrorBanner
        key="notes-error-banner"
        message="Could not load workout notes. Training analytics are incomplete."
        onRetry={refreshNotes}
      />
    ) : null,

    weightError ? (
      <ErrorBanner
        key="weight-error-banner"
        message="Could not load weight entries. Weight trends are incomplete."
        onRetry={refreshWeightEntries}
      />
    ) : null,

    // The overview leads the tab (#821). `overview` has always meant "scroll
    // offset 0"; putting this block first is what makes that id resolve to an
    // actual overview instead of to whichever section happened to be on top.
    // Nothing else was reordered — Progressive Overload stays at the bottom,
    // where its length belongs.
    <AnalyticsOverviewCard
      key="overview-card"
      rows={overviewRows}
      loading={overviewLoading}
      asOf={overviewAsOf}
      onSelectSection={onSelectSection}
    />,

    <AnalyticsWeightTrendsCard
      key="weight-trends-card"
      handleWeightLayout={handleWeightLayout}
      weightSummary={weightSummary}
      rolling7={rolling7}
      rolling30={rolling30}
      isWeightLoading={isWeightLoading}
      onNavigate={onNavigate}
    />,

    // Recovery sits above Fatigue (R5b, #793): it is the only time-boxed,
    // situational section on the tab, and the two adjacent "should I be
    // training normally right now?" answers read together — Fatigue's own
    // gauge is what makes a given baseline count interpretable. Anchor for the
    // `recovery` handoff (#770): AnalyticsRecoverySection owns its own
    // presentation and takes no layout prop, so the wrapper carries the anchor
    // — and only while the section has something to render. An empty wrapper
    // would still take a slot in the shell's 16px column gap and open a hole
    // between Weight and Fatigue, so the silent case renders exactly what it
    // rendered before: the section alone, which resolves to nothing.
    hasRecoverySection ? (
      <View key="recovery-section" testID="recovery-section-anchor" onLayout={handleRecoveryLayout}>
        {recoverySection}
      </View>
    ) : recoverySection,
  ];
}

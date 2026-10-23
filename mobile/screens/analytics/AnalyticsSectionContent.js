import React from 'react';
import { View } from 'react-native';
import { ErrorBanner } from '../../components/UI';
import { AnalyticsWeightTrendsCard } from '../../components/AnalyticsWeightTrendsCard';
import { AnalyticsStrengthSection, AnalyticsBig3MappingCard } from '../../components/AnalyticsStrengthSection';
import { AnalyticsTrainingBreakdown } from '../../components/AnalyticsTrainingBreakdown';
import { AnalyticsProgressiveOverloadSection } from './AnalyticsProgressiveOverload';
import { AnalyticsRoutineHealth } from './AnalyticsRoutineHealthPanel';
import { orderAnalyticsSections, BaselineDisclosureToggle, PausedBaselineBody } from './AnalyticsLayout';
import { ChapterHeader, RecoveryChapterEntries } from './AnalyticsChapters';

const SLOT_LABELS = { bench: 'Bench', squat: 'Squat', deadlift: 'Deadlift' };

// Analytics scroll content (#1602): assembles every already-derived value into
// the chapter hierarchy. This is the downstream integration seam — Bodyweight
// (R4) and Progress (R5) restyles swap their section element here without
// touching derivation, storage or navigation in AnalyticsScreen. Returns the
// scroll column's children (flat, so section offsets stay scroll-content
// coordinates; only the paused baseline body nests, see the navigation hook).
export function buildAnalyticsContent(p) {
  const { styles, colors, kua, nav } = p;
  const chapterById = new Map(p.chapters.map((c) => [c.id, c]));
  const chapterHeader = (id) => {
    const chapter = chapterById.get(id);
    return chapter ? <ChapterHeader key={`chapter-${id}`} chapter={chapter} onLayout={nav.handleChapterLayout(id)} /> : null;
  };

  const banners = [
    p.notesError ? (
      <ErrorBanner key="notes-error-banner" message="Could not load workout notes. Training analytics are incomplete." onRetry={p.refreshNotes} />
    ) : null,
    p.weightError ? (
      <ErrorBanner key="weight-error-banner" message="Could not load weight entries. Weight trends are incomplete." onRetry={p.refreshWeightEntries} />
    ) : null,
  ];
  const strength = (
    <AnalyticsStrengthSection
      key="strength-section"
      handleStrengthLayout={nav.layoutFor('strength')}
      isNotesLoading={p.isNotesLoading}
      oneK={p.displayOneK}
      oneKCanonical={p.analytics.oneK}
      oneKChartData={p.oneKChartData}
      big3Mapping={(
        <AnalyticsBig3MappingCard
          activeSlot={p.activeSlot}
          handleSlotTap={p.handleSlotTap}
          SLOT_LABELS={SLOT_LABELS}
          oneKSelections={p.oneKSelections}
          noteExerciseNames={p.noteExerciseNames}
          handleSelectExercise={p.handleSelectExercise}
        />
      )}
    />
  );
  // #1580: held back like the other ordinary aggregates until the Recovery
  // boundary is verified, so an unknown membership is never read as "nothing excluded".
  const trainingBreakdown = (
    <AnalyticsTrainingBreakdown
      key="training-breakdown-section"
      parsedSections={p.parsedSections}
      populationVerified={p.recoveryFilterReady}
      isLoading={p.isNotesLoading}
      hasError={!!p.notesError && p.notes.length === 0}
      paused={p.isActiveRecovery}
    />
  );
  const progressiveOverload = (
    <AnalyticsProgressiveOverloadSection
      key="progressive-overload-section"
      styles={styles} colors={colors} kua={kua}
      onLayout={nav.layoutFor('progressive-overload')}
      {...p.overloadProps}
      onNavigate={p.onNavigate}
    />
  );
  const weight = (
    <AnalyticsWeightTrendsCard
      key="weight-trends-card"
      handleWeightLayout={nav.layoutFor('weight')}
      weightSummary={p.weightSummary}
      rolling7={p.rolling7}
      rolling30={p.rolling30}
      isWeightLoading={p.isWeightLoading}
      onNavigate={p.onNavigate}
    />
  );
  const routineHealth = (
    <AnalyticsRoutineHealth key="routine-health" styles={styles} isActiveRecovery={p.isActiveRecovery} {...p.routineHealthProps} />
  );
  // The Recovery chapter always has its navigation entries, so the `recovery`
  // anchor (#770) is never an empty slot; the section (built by the screen)
  // renders inside it only when it has something to say (#716).
  const recovery = (
    <View key="recovery-section" testID="recovery-section-anchor" style={styles.recoveryChapterBody} onLayout={nav.layoutFor('recovery')}>
      {p.recoverySection}
      <RecoveryChapterEntries
        activeBlockId={p.isActiveRecovery ? p.activeRecoveryBlockId : null}
        completedCount={p.recovery.completedCount}
        ready={p.recovery.ready && !p.recovery.stale}
        onNavigate={p.onNavigate}
      />
    </View>
  );

  return orderAnalyticsSections({
    isActiveRecovery: p.isActiveRecovery,
    baselineExpanded: !p.baselineCollapsed,
    banners,
    chapterHeader,
    pausedBody: (children) => (
      <PausedBaselineBody key="baseline-paused-body" styles={styles} onLayout={nav.handlePausedBodyLayout}>
        {children}
      </PausedBaselineBody>
    ),
    strength,
    trainingBreakdown,
    progressiveOverload,
    weight,
    routineHealth,
    recovery,
    disclosure: (
      <BaselineDisclosureToggle
        key="baseline-disclosure-toggle"
        collapsed={p.baselineCollapsed}
        onToggle={p.toggleBaseline}
        styles={styles} colors={colors} kua={kua}
      />
    ),
  }).filter(Boolean);
}

import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Card } from '../../components/UI';
import { useTheme } from '../../theme/ThemeContext';
import { createStyles } from './homeStyles';
import { useKuaTypography } from '../../theme/typography';
import { DELOAD_NOTE_PREFIX } from '../../lib/LogScreenHelpers';
import { Chevron, HomeActionStrip } from './HomeActionStrip';
import { establishingBaselineMessage } from '../../lib/data/exerciseProgress';

// `Exercise Progress` is the same Analytics handoff in every hero state (#1333):
// the trio below it is the summary, Progressive Overload is the detail.
function ExerciseProgressLink({ linkId, onNavigate, styles, color }) {
  return (
    <Pressable
      testID={linkId}
      onPress={() => onNavigate('Analytics', 'progressive-overload')}
      style={[styles.sectionHeaderAction, styles.sectionHeaderActionStart]}
      hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
      accessibilityRole="button"
      accessibilityLabel="Exercise Progress"
      accessibilityHint="Opens the Progressive Overload section of the Analytics tab"
    >
      <Text style={[styles.classifSectionLabel, styles.sectionHeaderLabel]}>Exercise Progress</Text>
      <View style={styles.sectionHeaderChevron}>
        <Chevron color={color} />
      </View>
    </Pressable>
  );
}

// Tier 1 training hero, extracted from HomeScreen (#1049). Presentation only:
// every value it renders is computed by HomeScreen and passed in.
//
// #1333: the hero answers three questions and nothing else — what is being
// trained (week + routine), how it is going (Exercise Progress), and what to do
// next (the two daily-loop actions). Body weight lives in its own card below.
// #1341: normal training only. In Recovery the Recovery card replaces this hero
// (HomeScreen), so there is never an empty `Recovery` hero above it.
export function HomeHeader({
  dashboardData,
  onNavigate,
  workoutNote,
  notes,
  handleLogWorkoutPress,
  heroPrimaryActionLabel,
  heroPrimaryActionHint,
}) {
  const { colors, kuaPalette: kua } = useTheme();
  const typography = useKuaTypography();
  const styles = useMemo(() => createStyles(colors, kua, typography), [colors, kua, typography]);

  // No current routine, or one with nothing written in it yet, is not a
  // training week: no `Week N/A`, no 0·0·0 trio, just the way back in (#1333).
  const hasRoutineContent = !!workoutNote?.raw_text?.trim();
  // Deload notes never appear in Log's routine list, so they are not a routine
  // the user can choose (same predicate as LogScreenStates' otherNotes).
  const hasSavedRoutines = (notes || []).some(n => n && !n.title?.startsWith(DELOAD_NOTE_PREFIX));
  const routineState = !workoutNote ? 'none'
    : !hasRoutineContent ? 'empty'
    : 'active';
  // Muted-state label only: an active routine leads with Exercise Progress and
  // carries its week beside the title instead (#1456).
  const headerLabel = routineState === 'none' ? 'No current routine' : 'Current routine';
  // Calendar week of THIS routine (routineStatus.elapsedWeeks, from the note's
  // own start), not session depth: other routines' history and Recovery blocks
  // never move it. Omitted when the routine has no usable start (#1456).
  const routineWeek = dashboardData.routineWeek ?? null;
  const routineTitle = routineState === 'active' || routineState === 'empty'
    ? (workoutNote.title || '').trim() || null
    : null;
  const routineMessage = routineState === 'none'
    ? (hasSavedRoutines ? 'Pick a saved routine or write a new one in Log.' : 'Write a routine in Log to track your weeks.')
    : routineState === 'empty'
      ? 'Add exercises to this routine in Log to track progress.'
      : null;
  const primaryLabel = routineState === 'none'
    ? (hasSavedRoutines ? 'Choose routine' : 'Write routine')
    : heroPrimaryActionLabel;
  const primaryHint = routineState === 'none'
    ? 'Opens the Log tab to pick or write a routine'
    : heroPrimaryActionHint;

  const mutedStroke = kua ? kua.onSurfaceVariant : colors.textMuted;

  const newlyTrackedCount = dashboardData.weeklySummary.newlyTrackedCount;
  const counts = dashboardData.weeklySummary.classifications;
  // #1391: every tracked exercise on its first tracked session replaces the
  // 0 · 0 · 0 trio with what is actually happening.
  const baselineMessage = establishingBaselineMessage({
    newlyTracked: newlyTrackedCount,
    classified: (counts?.progressing ?? 0) + (counts?.stalled ?? 0) + (counts?.regressing ?? 0),
  });
  const classifBody = baselineMessage ? (
    <Text testID="home-progress-baseline" style={styles.heroRoutineMessage}>{baselineMessage}</Text>
  ) : (
    <View style={styles.classifRow}>
      {[
        { label: 'Progressing', count: counts?.progressing ?? 0, color: kua ? kua.success : colors.success },
        { label: 'Steady', count: counts?.stalled ?? 0, color: kua ? kua.warning : colors.caution },
        { label: 'Regressing', count: counts?.regressing ?? 0, color: kua ? kua.errorText : colors.error },
      ].map((item, idx) => (
        <View key={idx} style={styles.classifCol}>
          <Text style={[styles.classifCount, kua ? { color: item.color } : null]}>{item.count}</Text>
          <Text style={styles.classifLabel}>{item.label}</Text>
        </View>
      ))}
    </View>
  );

  return (
    <Card style={[styles.weeklyHero, styles.progressCard]}>
      {routineState === 'active' ? (
        /* #1456: Exercise Progress leads, like the sibling card headers. */
        <View style={styles.classifHeaderRow}>
          <ExerciseProgressLink linkId="home-exercise-progress-link" onNavigate={onNavigate} styles={styles} color={mutedStroke} />
        </View>
      ) : (
        <View style={styles.heroHeaderRow}>
          <View style={styles.heroAccentBar} />
          <Text testID="home-hero-label" style={styles.heroSectionLabel} numberOfLines={1}>{headerLabel}</Text>
        </View>
      )}

      {/* What is being trained: the routine, with its week opposite. */}
      {routineTitle || (routineState === 'active' && routineWeek !== null) ? (
        <View style={styles.heroTitleRow}>
          {routineTitle ? (
            <Text testID="home-routine-title" style={styles.heroTitleText}>{routineTitle}</Text>
          ) : <View style={styles.heroTitleText} />}
          {routineState === 'active' && routineWeek !== null ? (
            <Text testID="home-routine-week" style={styles.heroWeekText}>{`Week ${routineWeek}`}</Text>
          ) : null}
        </View>
      ) : null}

      {/* How it is going. */}
      {routineMessage ? (
        <Text testID="home-no-routine" style={styles.heroRoutineMessage}>{routineMessage}</Text>
      ) : (
        <View style={styles.classifSection}>
          {classifBody}
        </View>
      )}

      {/* What to do next: the two daily-loop actions, in one stable row. */}
      <HomeActionStrip primaryLabel={primaryLabel} primaryHint={primaryHint} onPrimary={handleLogWorkoutPress} onNavigate={onNavigate} />
    </Card>
  );
}

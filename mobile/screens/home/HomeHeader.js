import React, { useContext, useMemo } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { centeredColumnInsets } from '../../components/adaptiveLayout';
import { KiloWordmark } from '../../components/KiloWordmark';
import { useCloudSyncSummary } from '../../hooks/useEntries';
import { useTheme } from '../../theme/ThemeContext';
import { createStyles } from './homeStyles';
import { useKuaTypography } from '../../theme/typography';
import { DELOAD_NOTE_PREFIX } from '../../lib/LogScreenHelpers';
import { HomeActionStrip } from './HomeActionStrip';
import { HomeProgressLegend, HomeProgressRing, progressSummaryText } from './HomeProgressRing';
import { MonoLabel, Panel } from '../../components/ui/RedesignPrimitives';
import { Icon } from '../../components/Icon';
import { establishingBaselineMessage } from '../../lib/data/exerciseProgress';

// The Cloud Sync glyph for the shell's existing summary (hooks/useEntries
// summarizeCloudSync): same precedence as its `statusLabel`.
export function syncIconName(summary) {
  if (!summary) return 'cloud-queue';
  if (summary.isRunning) return 'cloud-sync';
  if (summary.hasFailed) return 'cloud-off';
  if (summary.hasDirty) return 'cloud-upload';
  return summary.hasLastSuccess ? 'cloud-done' : 'cloud-queue';
}

// Redesign v3 root header for Home (#1605): the wordmark and the Cloud Sync
// status icon over a full-width hairline, fixed above the scroll via
// ScreenShell's `header`. The icon reads the ONE shell-owned summary (#737)
// and opens Cloud Sync; outside the shell (no summary) it is not drawn.
export function HomeTopBar() {
  const { colors, kuaPalette: kua } = useTheme();
  const typography = useKuaTypography();
  const styles = useMemo(() => createStyles(colors, kua, typography), [colors, kua, typography]);
  const cloudSync = useCloudSyncSummary();
  const { left: leftInset = 0, right: rightInset = 0 } = useContext(SafeAreaInsetsContext) || {};
  const { width } = useWindowDimensions();
  const column = centeredColumnInsets(width, { left: leftInset, right: rightInset });
  const summary = cloudSync?.summary || null;
  // #1640: signed-out users get an obvious Sign in entry instead of a cloud
  // glyph that opens Cloud Sync; while the session restores nothing is drawn so
  // a persisted session is never mislabelled.
  const accountEntry = cloudSync?.accountEntry;
  const failed = !!summary?.hasFailed && !summary?.isRunning;
  const iconColor = failed ? (kua ? kua.errorText : colors.error) : (kua ? kua.onSurfaceVariant : colors.textMuted);
  return (
    <View testID="home-top-bar" style={[styles.topBar, { paddingLeft: column.left, paddingRight: column.right - 8 }]}>
      <View style={styles.topBarMark} accessible accessibilityRole="header" accessibilityLabel="Kilo">
        <KiloWordmark width={72} height={26} />
      </View>
      {cloudSync && accountEntry === 'loading' ? null : cloudSync && accountEntry === 'signed-out' ? (
        <Pressable
          testID="home-sign-in"
          onPress={() => cloudSync.openAccount?.()}
          style={styles.topBarSignIn}
          accessibilityRole="button"
          accessibilityLabel="Sign in"
          accessibilityHint="Opens Account to sign in or create an account. Kilo works without one."
        >
          <Icon name="account-circle" size={20} color={iconColor} />
          <Text style={styles.topBarSignInText}>Sign in</Text>
        </Pressable>
      ) : cloudSync ? (
        <Pressable
          testID="home-sync-status"
          onPress={() => cloudSync.openCloudSync?.()}
          style={styles.topBarAction}
          accessibilityRole="button"
          accessibilityLabel={`Cloud Sync: ${summary?.statusLabel || 'status unknown'}`}
          accessibilityHint="Opens the Cloud Sync panel in More"
        >
          <Icon name={syncIconName(summary)} size={24} color={iconColor} />
        </Pressable>
      ) : null}
    </View>
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
// Redesign v3 (#1605): the screen's one active panel — label, routine title,
// the Exercise Progress ring + legend (the Analytics Progress handoff), then
// the two actions.
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
  // Muted-state label only; an active routine reads `Current routine · Week N`.
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
  const progress = {
    progressing: counts?.progressing ?? 0,
    steady: counts?.stalled ?? 0,
    regressing: counts?.regressing ?? 0,
  };
  // The canonical summary's own classified count; never re-derived here.
  const classified = dashboardData.exerciseProgress?.classified
    ?? progress.progressing + progress.steady + progress.regressing;
  // #1391: every tracked exercise on its first tracked session replaces the
  // 0 · 0 · 0 trio with what is actually happening.
  const baselineMessage = establishingBaselineMessage({ newlyTracked: newlyTrackedCount, classified });

  return (
    <Panel active testID="home-hero">
      <View style={styles.heroPad}>
        {routineState === 'active' ? (
          // `Current routine · Week N`: the week is omitted when the routine has no usable start (#1456).
          <MonoLabel testID="home-routine-label" numberOfLines={1}>
            {routineWeek !== null ? 'Current routine · ' : 'Current routine'}
            {routineWeek !== null ? <Text testID="home-routine-week">{`Week ${routineWeek}`}</Text> : null}
          </MonoLabel>
        ) : (
          <MonoLabel testID="home-hero-label" numberOfLines={1}>{headerLabel}</MonoLabel>
        )}

        {routineTitle ? (
          <Text testID="home-routine-title" style={styles.heroTitleText} accessibilityRole="header">{routineTitle}</Text>
        ) : null}

        {routineMessage ? (
          <Text testID="home-no-routine" style={styles.heroRoutineMessage}>{routineMessage}</Text>
        ) : (
          // How it is going: the ring and legend are the Analytics Progress handoff (#1333).
          <Pressable
            testID="home-exercise-progress-link"
            onPress={() => onNavigate('Analytics', 'progressive-overload')}
            style={styles.heroProgressRow}
            accessibilityRole="button"
            accessibilityLabel={baselineMessage ? `Exercise Progress. ${baselineMessage}` : `Exercise Progress: ${progressSummaryText(progress)}`}
            accessibilityHint="Opens the Progressive Overload section of the Analytics tab"
          >
            {baselineMessage ? null : <HomeProgressRing {...progress} classified={classified} />}
            <View style={styles.heroProgressText}>
              <MonoLabel style={styles.heroProgressLabel}>Exercise Progress</MonoLabel>
              {baselineMessage ? (
                <Text testID="home-progress-baseline" style={styles.heroBaselineText}>{baselineMessage}</Text>
              ) : (
                <HomeProgressLegend {...progress} />
              )}
            </View>
            <Icon name="chevron-right" size={22} color={mutedStroke} />
          </Pressable>
        )}

        {/* What to do next: the two daily-loop actions, in one stable row. */}
        <HomeActionStrip primaryLabel={primaryLabel} primaryHint={primaryHint} onPrimary={handleLogWorkoutPress} onNavigate={onNavigate} primaryIcon={routineState === 'none' ? null : 'add'} />
      </View>
    </Panel>
  );
}

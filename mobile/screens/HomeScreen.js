import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { ScreenShell } from '../components/ScreenShell';
import { Card, Button, ErrorBanner, getSessionTone } from '../components/UI';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';
import { CLOUD_SYNC_NOTICE, useWeightGoal, useTrackedLifts, getNoteSections, useCloudSyncSummary, useActiveTrainingContext, useDeloadHistory, useRecoveryBlockState } from '../hooks/useEntries';
import { deriveHomeDashboardData, useHomeNormalNotes, useHomeRecoverySummary } from './home/homeDashboardData';
import { ACTIVE_TRAINING_STATUS } from '../lib/data/activeTrainingContext';
import { markStartupPhase, markStartupStorageReads } from '../storage/entries/startupTiming';
import { createStyles } from './home/homeStyles';
import { HomeHeader } from './home/HomeHeader';
import { HomeDashboard } from './home/HomeDashboard';

// The exact example the welcome card teaches (issue #517). Exported so tests
// can round-trip it through the real parser — the copy must never drift back
// to a shape parseWorkoutNote silently rejects.
export const WELCOME_EXAMPLE_EXERCISE_LINE = '-Squat';
export const WELCOME_EXAMPLE_SETS_LINE = '315 5,5';

function lerpColor(a, b, t) {
  const p = h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
  const [ar,ag,ab] = p(a), [br,bg,bb] = p(b);
  return `rgb(${Math.round(ar+(br-ar)*t)},${Math.round(ag+(bg-ag)*t)},${Math.round(ab+(bb-ab)*t)})`;
}

// Home title wordmark. Source artwork: src/assets/brand/home-title.svg
// The letterforms follow the palette `text` so the mark reads in both modes,
// but the two #FF5C00 accents are the fixed Kilo brand orange and are
// intentionally NOT themed — they are the only hardcoded colors left in the
// migrated production surfaces (#689).
function KiloWordmark({ width = 140, height = 48 }) {
  const { colors } = useTheme();
  return (
    <View style={{ width, height, justifyContent: 'center', marginLeft: -8 }}>
      <Svg width="100%" height="100%" viewBox="0 0 303 106">
        {/* K */}
        <Rect x="8" y="9" width="7" height="88" rx="3.5" ry="3.5" fill={colors.text} />
        <Path d="M 21 52 L 43 52 L 78 12 M 43 52 L 78 92" fill="none" stroke={colors.text} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
        {/* I */}
        <Rect x="102" y="30" width="7" height="66" rx="3.5" ry="3.5" fill={colors.text} />
        <Rect x="102" y="10" width="7" height="15" rx="3.5" ry="3.5" fill="#FF5C00" />
        {/* L */}
        <Path d="M 136.5 12.5 V 80.5 A 12 12 0 0 0 148.5 92.5 H 178.5" fill="none" stroke={colors.text} strokeWidth="7" strokeLinecap="round" />
        {/* O (dot) */}
        <Rect x="187" y="89.5" width="16" height="7" rx="3.5" ry="3.5" fill="#FF5C00" />
        {/* O (circle) */}
        <Path d="M 251.5 11.5 C 282.7 11.5 290.5 19.7 290.5 52.5 C 290.5 85.3 282.7 93.5 251.5 93.5 C 220.3 93.5 212.5 85.3 212.5 52.5 C 212.5 19.7 220.3 11.5 251.5 11.5 Z" fill="none" stroke={colors.text} strokeWidth="7" strokeLinejoin="round" />
      </Svg>
    </View>
  );
}

function BarbellIcon({ color, size = 22 }) {
  const { colors } = useTheme();
  const stroke = color || colors.accent;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <Path d="M18 4v16M6 4v16M2 8v8M22 8v8M6 12h12" />
    </Svg>
  );
}

function ScaleIcon({ color, size = 22 }) {
  const { colors } = useTheme();
  const stroke = color || colors.accent;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <Path d="M3 6h18M12 6v14M12 20H9m3 0h3M5 6l3 8h8l3-8" />
    </Svg>
  );
}

// Queued-work / failed-sync notice (#737). Reads the ONE shell-owned summary
// through CloudSyncContext and never subscribes itself, so this stays free
// whether Home is the visible tab or one of the four mounted-but-hidden ones.
//
// Outside the shell (standalone renders, focused tests) the context is null and
// this renders nothing: no summary was published, so there is nothing honest to
// say about sync.
export function CloudSyncNotice() {
  const styles = useThemedStyles(createStyles);
  const cloudSync = useCloudSyncSummary();
  const [retryError, setRetryError] = useState('');
  const [retrying, setRetrying] = useState(false);

  const summary = cloudSync?.summary || null;
  const kind = summary?.noticeKind ?? null;

  // Drop a stale retry failure as soon as the underlying state moves on, so the
  // message can never outlive the notice it belongs to.
  useEffect(() => {
    setRetryError('');
  }, [kind]);

  if (!kind) return null;

  const isFailure = kind === CLOUD_SYNC_NOTICE.FAILED;

  const handleRetry = async () => {
    if (retrying) return;
    setRetrying(true);
    setRetryError('');
    try {
      const result = await cloudSync?.retrySync?.();
      if (result && result.ok === false) setRetryError(result.error || 'Could not sync.');
    } catch {
      setRetryError('Could not sync. Open Cloud Sync for details.');
    } finally {
      setRetrying(false);
    }
  };

  return (
    // Wrapped rather than testID'd directly: Card takes only children/style/
    // tone/onPress and would swallow the prop.
    <View testID="home-cloud-sync-notice">
    <Card style={isFailure ? styles.syncNoticeCardFailed : styles.syncNoticeCard}>
      {/* One live region over title + body: two separate regions announce as two
          unrelated interruptions. */}
      <View
        accessible
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${summary.noticeTitle}. ${summary.noticeMessage}`}
      >
        <Text style={isFailure ? styles.syncNoticeTitleFailed : styles.syncNoticeTitle}>
          {summary.noticeTitle}
        </Text>
        <Text style={styles.syncNoticeBody}>{summary.noticeMessage}</Text>
      </View>
      {retryError ? (
        <Text style={styles.syncNoticeRetryError} accessibilityLiveRegion="polite">
          {retryError}
        </Text>
      ) : null}
      <View style={styles.syncNoticeActions}>
        {/* Retry belongs to the failure only. Offering it on a plain queued
            state would imply the queue is stuck, which the app has no evidence
            for — pending work is simply work that has not been sent yet. */}
        {isFailure ? (
          <Pressable
            testID="home-cloud-sync-retry"
            onPress={handleRetry}
            disabled={retrying}
            style={styles.syncNoticeAction}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Retry sync"
            accessibilityState={{ disabled: retrying }}
          >
            <Text style={styles.syncNoticeActionText}>{retrying ? 'Syncing…' : 'Retry sync'}</Text>
          </Pressable>
        ) : null}
        <Pressable
          testID="home-cloud-sync-link"
          onPress={() => cloudSync?.openCloudSync?.()}
          style={styles.syncNoticeAction}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Open Cloud Sync"
          accessibilityHint="Opens the Cloud Sync panel in More"
        >
          <Text style={styles.syncNoticeActionText}>Open Cloud Sync</Text>
        </Pressable>
      </View>
    </Card>
    </View>
  );
}

// First-paint placeholder (#737). Home gates its whole body on every data source
// it renders, so before this the loading branch painted `null` — an empty tab
// under a populated header, indistinguishable from a broken screen. The bars
// mirror the real tier order (hero, goal, 1K) so nothing jumps when data lands.
//
// Deliberately static: an animated shimmer is motion the user did not ask for,
// and this placeholder is usually on screen for a few frames.
function HomeSkeleton() {
  const styles = useThemedStyles(createStyles);
  return (
    <View
      testID="home-skeleton"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading your dashboard"
    >
      <Card style={styles.skeletonCard}>
        <View style={[styles.skeletonBar, styles.skeletonBarShort]} />
        <View style={[styles.skeletonBar, styles.skeletonBarHero]} />
        <View style={[styles.skeletonBar, styles.skeletonBarFull]} />
        <View style={[styles.skeletonBar, styles.skeletonBarWide]} />
      </Card>
      <Card style={styles.skeletonCard}>
        <View style={[styles.skeletonBar, styles.skeletonBarShort]} />
        <View style={[styles.skeletonBar, styles.skeletonBarWide]} />
      </Card>
      <Card style={styles.skeletonCard}>
        <View style={[styles.skeletonBar, styles.skeletonBarShort]} />
        <View style={[styles.skeletonBar, styles.skeletonBarFull]} />
      </Card>
    </View>
  );
}

export function HomeScreen({ weightEntries, workoutNote, currentId = null, notes, successMessage, onNavigate, loading, loadError = false, onRetryLoad }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { goal: weightGoal, loading: goalLoading, error: goalError, refresh: refreshGoal } = useWeightGoal();
  const { trackedLifts, activations: trackedLiftActivations, loading: trackedLiftsLoading, error: trackedLiftsError, refresh: refreshTrackedLifts } = useTrackedLifts();

  // The shell owns the weight/note reads and reports their failure through
  // `loadError`, but Home owns two more of its own — the weight goal and the
  // tracked-lift map — and both feed tiers on this screen (#737 review). A
  // failed goal read silently removed the Goal tier and a failed tracked-lift
  // read zeroed the strength counts, in both cases looking exactly like a user
  // who has set nothing up. All four sources are one honest failure state here,
  // with one retry that re-runs everything Home renders from.
  const hasLoadError = !!loadError || !!goalError || !!trackedLiftsError;
  const handleRetryLoad = () => {
    onRetryLoad?.();
    refreshGoal?.();
    refreshTrackedLifts?.();
  };

  // Ordinary-analytics boundary (#699). Home's aggregated populations (1K,
  // overload signals, tracked-lift visibility) drop recovery-linked notes whose
  // block keeps `include_in_normal_analytics` off. `workoutNote` — the routine
  // the current-routine card is about — is deliberately untouched: an excluded
  // recovery week stays visible and editable.
  const { normalNotes, recoveryBoundaryReady } = useHomeNormalNotes(notes);

  // Recovery STATUS is a separate question from the analytics boundary above
  // (#757). It is deliberately not folded into `isLoading`: the authoritative
  // read can fail terminally while the boundary read succeeded, and holding the
  // whole dashboard on it would leave Home permanently blank over a condition
  // this card can state honestly on its own.
  const recoverySummary = useHomeRecoverySummary(notes);

  // Product-wide "what am I training now?" context (#868), shared verbatim
  // with Log and Analytics — same authoritative Recovery snapshot as
  // `recoverySummary` above, plus the STORED current-routine id (not
  // `workoutNote?.id`: a restored profile whose `current_workout_id`
  // references a missing/tombstoned note leaves `workoutNote` null while
  // `currentId` is still set, and this context must resolve the same
  // activeNoteId Log does — review finding, PR #873).
  const activeTrainingContext = useActiveTrainingContext({ currentId, notes });
  // #989: post-deload re-entry inputs for the dashboard analytics pass, keyed
  // to the same stable current-routine id Analytics and Log use. The live
  // Recovery blocks come from the same authoritative store Analytics reads
  // (Home already subscribes via useHomeRecoverySummary), passed raw the way
  // Analytics passes them so the re-entry label's active-Recovery exclusion
  // matches across both surfaces.
  const { history: deloadHistory } = useDeloadHistory();
  const { blocks: recoveryBlocks = [] } = useRecoveryBlockState() || {};

  // Home's own active-Recovery branch (#869). Only these two derived
  // statuses ever set `baselinePaused` (see activeTrainingContext.js) — every
  // other status (normal, loading, unverified, stale, pending) keeps Home's
  // existing hierarchy exactly as it already renders, because none of them is
  // a confirmed "baseline training is paused" answer.
  const isRecoveryOpenWeek = activeTrainingContext.status === ACTIVE_TRAINING_STATUS.RECOVERY_OPEN_WEEK;
  const isRecoveryBetweenWeeks = activeTrainingContext.status === ACTIVE_TRAINING_STATUS.RECOVERY_BETWEEN_WEEKS;
  const baselinePaused = !!activeTrainingContext.baselinePaused;

  // `Log workout` targets the exact active Recovery note (#869 acceptance),
  // including when it is not `currentId` — never the frozen baseline note.
  // The `recovery-note` intent (not the plain `note` kind normal Home uses)
  // lands Log on its Recovery view instead of the Routine/Deload viewer a
  // plain note target opens (#874 review finding 1), and is gated on the
  // RESOLVED note, not just `activeNoteId`: a linked note that has been
  // deleted still leaves `activeNoteId` set but `activeNote` null, and
  // sending a noteId Log cannot resolve would surface "Note not found"
  // instead of the Recovery view that actually reports the broken link
  // (#874 review finding 2). Between weeks there is no active note at all,
  // so the same intent is sent with no noteId — landing on Recovery without
  // pretending a note exists. Normal state is untouched: it never reaches
  // either branch, so it keeps its existing plain `onNavigate('Log')`.
  const handleLogWorkoutPress = () => {
    if (isRecoveryOpenWeek) {
      onNavigate('Log', {
        kind: 'recovery-note',
        noteId: activeTrainingContext.activeNote ? activeTrainingContext.activeNoteId : null,
      });
    } else if (isRecoveryBetweenWeeks) {
      onNavigate('Log', { kind: 'recovery-note', noteId: null });
    } else {
      onNavigate('Log');
    }
  };

  const heroPrimaryActionLabel = isRecoveryBetweenWeeks ? 'Add week or end Recovery' : 'Log workout';
  const heroPrimaryActionHint = isRecoveryOpenWeek
    ? 'Opens the Log tab for the active Recovery week'
    : isRecoveryBetweenWeeks
      ? 'Opens the Log tab to add the next Recovery week or end Recovery'
      : 'Opens the Log tab for your current routine';

  const noteSectionsList = useMemo(
    () => normalNotes.map(n => getNoteSections(n)),
    [normalNotes]
  );

  const allSections = useMemo(
    () => noteSectionsList.flat(),
    [noteSectionsList]
  );

  const dashboardData = useMemo(
    () => deriveHomeDashboardData({ weightEntries, workoutNote, weightGoal, allSections, noteSectionsList, trackedLifts, trackedLiftActivations, deloadHistory, sourceNoteId: currentId ?? null, recoveryBlocks }),
    [weightEntries, workoutNote, weightGoal, allSections, noteSectionsList, trackedLifts, trackedLiftActivations, deloadHistory, currentId, recoveryBlocks]
  );

  const weekTone = getSessionTone(dashboardData.sessionCount);
  const weekToneColor = weekTone === 'error' ? colors.error
    : weekTone === 'warn' ? colors.cautionText
    : weekTone === 'success' ? colors.success
    : null;

  // Whether there is any rolling-average series to plot at all.
  const hasWeightSeries = Array.isArray(dashboardData.weightSeries)
    && dashboardData.weightSeries.length > 0;
  // 1K hero color, precomputed here (was inline in the 1K card JSX before the
  // #1049 split) so lerpColor stays in the screen that owns startup composition.
  const oneKHeroColor = lerpColor(colors.accentText, colors.success, Math.min(1, (dashboardData.oneK?.total || 0) / 1000));

  // Gate the whole first paint on every data source Home renders, not just
  // weight/notes: weight goal and tracked lifts feed the dashboard too, so
  // including their loading prevents those sections from popping in after
  // first paint.
  // `!recoveryBoundaryReady` belongs here for the same reason the others do: the
  // dashboard's aggregates are derived from a note population that is not yet
  // known to be correct, so painting them would show numbers that can include
  // work the user chose to exclude (#699).
  const isLoading = loading || goalLoading || trackedLiftsLoading || !recoveryBoundaryReady;

  // Marks the moment the skeleton is replaced by real content (#809), so a
  // device timing run can compare this against the encrypted-storage/reload
  // phase marks above it without recording anything about what actually
  // loaded. The read counts alongside it (#818) report how many device reads
  // the launch paid for and how many were served by an in-flight read of the
  // same key — counts only, no key names and no values.
  useEffect(() => {
    if (!isLoading) {
      markStartupPhase('home:first-paint');
      markStartupStorageReads();
    }
  }, [isLoading]);

  // Whether Home holds anything real to draw, regardless of why it might not.
  // Used to keep a failed read from being dressed up as a populated dashboard:
  // with nothing loaded, the tiers would render Week —, no weigh-in, and zeroed
  // classification counts, which reads as "you did nothing" rather than "this
  // did not load".
  const hasLoadedData = useMemo(() => {
    const hasTrackedLifts = trackedLifts && Object.values(trackedLifts).some(Boolean);
    return (weightEntries?.length || 0) > 0
      || (notes?.length || 0) > 0
      || !!workoutNote?.raw_text?.trim()
      || !!weightGoal
      || !!hasTrackedLifts;
  }, [weightEntries, notes, workoutNote, weightGoal, trackedLifts]);

  const isEmptyState = useMemo(() => {
    if (isLoading) return false;
    // A failed read leaves every collection empty, which is byte-identical to a
    // brand-new account (#737). Presenting the welcome/onboarding card there
    // would tell a user with months of history that they have never logged
    // anything. Empty is only "empty" once the reads actually succeeded.
    if (hasLoadError) return false;
    const hasTrackedLifts = trackedLifts && Object.values(trackedLifts).some(Boolean);
    return (!weightEntries || weightEntries.length === 0) &&
           (!notes || notes.length === 0) &&
           (!workoutNote?.raw_text || !workoutNote.raw_text.trim()) &&
           !weightGoal &&
           !hasTrackedLifts;
  }, [isLoading, hasLoadError, weightEntries, notes, workoutNote, weightGoal, trackedLifts]);

  return (
    <ScreenShell
      title={<KiloWordmark />}
      subtitle="Current routine progress."
    >
      {hasLoadError ? (
        <ErrorBanner
          message="Could not load your training data."
          onRetry={handleRetryLoad}
        />
      ) : null}
      <CloudSyncNotice />
      {/* Three distinct outcomes, never collapsed into one another: still
          loading (skeleton), failed with nothing to fall back on (the banner
          above and nothing else — no fabricated zeroes), and a verified read
          (welcome or dashboard). A failed read that still has cached data keeps
          rendering it under the banner, which is stale but true. */}
      {isLoading ? <HomeSkeleton /> : (hasLoadError && !hasLoadedData) ? null : isEmptyState ? (
        <Card style={styles.welcomeCard}>
          <View style={styles.welcomeHeader}>
            <Text style={styles.welcomeTitle}>Welcome to Kilo</Text>
            <Text style={styles.welcomeSubtitle}>
              Your strength journal and body weight tracker. Let's get started with your routine.
            </Text>
          </View>

          <View style={styles.welcomeDivider} />

          <View style={styles.welcomeStep}>
            <View style={styles.welcomeStepHeader}>
              <View style={styles.welcomeIconContainer}>
                <BarbellIcon />
              </View>
              <View style={styles.welcomeStepTextContainer}>
                {/* Unnumbered (#748; #745 finding F8). The two daily loops are
                    independent siblings — numbering implied a prerequisite that
                    does not exist and pushed the easier, more habit-forming
                    weigh-in loop behind the harder one. */}
                <Text style={styles.welcomeStepTitle}>Log a Workout</Text>
                <Text style={styles.welcomeStepDesc}>
                  Write workouts in plain text: an exercise line like "{WELCOME_EXAMPLE_EXERCISE_LINE}", then its sets like "{WELCOME_EXAMPLE_SETS_LINE}". Kilo parses that and totals your volume automatically. Per-lift strength charts need one more step: tap Track on an exercise in your routine to follow it in Analytics.
                </Text>
              </View>
            </View>
            <Button
              title="Log Workout"
              onPress={() => onNavigate('Log')}
              style={styles.welcomeButton}
            />
          </View>

          <View style={styles.welcomeStep}>
            <View style={styles.welcomeStepHeader}>
              <View style={styles.welcomeIconContainer}>
                <ScaleIcon />
              </View>
              <View style={styles.welcomeStepTextContainer}>
                <Text style={styles.welcomeStepTitle}>Track Weight & Goals</Text>
                <Text style={styles.welcomeStepDesc}>
                  Set a target weight and log entries to visualize your 7-day average trend and weekly pace.
                </Text>
              </View>
            </View>
            <Button
              title="Log Weight"
              onPress={() => onNavigate('Weight')}
              style={styles.welcomeButton}
            />
          </View>
        </Card>
      ) : (
        <>
          <HomeHeader
            dashboardData={dashboardData}
            onNavigate={onNavigate}
            isRecoveryOpenWeek={isRecoveryOpenWeek}
            isRecoveryBetweenWeeks={isRecoveryBetweenWeeks}
            activeTrainingContext={activeTrainingContext}
            weekToneColor={weekToneColor}
            hasWeightSeries={hasWeightSeries}
            baselinePaused={baselinePaused}
            handleLogWorkoutPress={handleLogWorkoutPress}
            heroPrimaryActionLabel={heroPrimaryActionLabel}
            heroPrimaryActionHint={heroPrimaryActionHint}
          />
          <HomeDashboard
            recoverySummary={recoverySummary}
            onNavigate={onNavigate}
            dashboardData={dashboardData}
            weightGoal={weightGoal}
            baselinePaused={baselinePaused}
            oneKHeroColor={oneKHeroColor}
          />
        </>
      )}
    </ScreenShell>
  );
}

export { HomeRecoverySummary } from './home/HomeRecoverySummary';

import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ScreenShell } from '../components/ScreenShell';
import { Card, Button, ErrorBanner } from '../components/UI';
import { useTheme } from '../theme/ThemeContext';
import { CLOUD_SYNC_NOTICE, useWeightGoal, useTrackedLifts, getNoteSections, useCloudSyncSummary, useActiveTrainingContext, useDeloadHistory, useRecoveryBlockState } from '../hooks/useEntries';
import { useWeightUnit } from '../lib/unitPreference';
import { deriveHomeDashboardData, HOME_RECOVERY_STATUS, useHomeNormalNotes, useHomeRecoverySummary } from './home/homeDashboardData';
import { HomeRecoverySummary } from './home/HomeRecoverySummary';
import { ACTIVE_TRAINING_STATUS } from '../lib/data/activeTrainingContext';
import { markStartupPhase, markStartupStorageReads, claimAppLocalReady } from '../storage/entries/startupTiming';
import { DEVICE_KEY_RECOVERY_MESSAGE, isDeviceKeyUnavailable, secureStorage } from '../storage/secureStorage';
import { createStyles } from './home/homeStyles';
import { useKuaTypography } from '../theme/typography';
import { HomeHeader } from './home/HomeHeader';
import { HomeDashboard } from './home/HomeDashboard';
import { HomeWeightCard } from './home/HomeWeightCard';
import { KiloWordmark } from '../components/KiloWordmark';
import { AppLocalReadyContext } from '../components/AppStartupOverlay';
function lerpColor(a, b, t) {
  const p = h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
  const [ar,ag,ab] = p(a), [br,bg,bb] = p(b);
  return `rgb(${Math.round(ar+(br-ar)*t)},${Math.round(ag+(bg-ag)*t)},${Math.round(ab+(bb-ab)*t)})`;
}

// Names the same `Retry recovery` control as every other Recovery message.
export const RECOVERY_PENDING_HOLD_MESSAGE =
  'A recovery change is still finishing, so recovery status is not confirmed yet. Tap Retry recovery.';

// Queued-work / failed-sync notice (#737). Reads the ONE shell-owned summary
// through CloudSyncContext and never subscribes itself, so this stays free
// whether Home is the visible tab or one of the four mounted-but-hidden ones.
//
// Outside the shell (standalone renders, focused tests) the context is null and
// this renders nothing: no summary was published, so there is nothing honest to
// say about sync.
export function CloudSyncNotice() {
  const { colors, kuaPalette: kua } = useTheme();
  const typography = useKuaTypography();
  const styles = useMemo(() => createStyles(colors, kua, typography), [colors, kua, typography]);
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
// Never the cold-start view (#1372): inside the shell the startup overlay covers
// Home until local-ready, so this only paints if Home re-enters loading after
// that latch, or where no shell overlay exists (standalone renders).
function HomeSkeleton() {
  const { colors, kuaPalette: kua } = useTheme();
  const typography = useKuaTypography();
  const styles = useMemo(() => createStyles(colors, kua, typography), [colors, kua, typography]);
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
  const { colors, kuaPalette: kua } = useTheme();
  const typography = useKuaTypography();
  const styles = useMemo(() => createStyles(colors, kua, typography), [colors, kua, typography]);
  const { goal: weightGoal, loading: goalLoading, error: goalError, refresh: refreshGoal } = useWeightGoal();
  const { trackedLifts, activations: trackedLiftActivations, loading: trackedLiftsLoading, error: trackedLiftsError, refresh: refreshTrackedLifts } = useTrackedLifts();

  // The shell owns the weight/note reads and reports their failure through
  // `loadError`, but Home owns two more of its own — the weight goal and the
  // tracked-lift map — and both feed tiers on this screen (#737 review). A
  // failed goal read silently removed the Goal tier and a failed tracked-lift
  // read zeroed the strength counts, in both cases looking exactly like a user
  // who has set nothing up. All four sources are one honest failure state here,
  // with one retry that re-runs everything Home renders from.
  // A lost device key (#1177) is surfaced on its own: orphaned envelopes can sit
  // under keys Home never reads, so no Home read would ever report it.
  const [probedKeyLoss, setProbedKeyLoss] = useState(false);
  useEffect(() => {
    let live = true;
    secureStorage.probeDeviceKey().then(() => { if (live) setProbedKeyLoss(isDeviceKeyUnavailable()); }, () => {});
    const unsubscribe = secureStorage.subscribeKeyUnavailable?.((lost) => { if (live) setProbedKeyLoss(lost); });
    return () => { live = false; unsubscribe?.(); };
  }, []);
  const keyLost = probedKeyLoss || isDeviceKeyUnavailable();
  const hasLoadError = !!loadError || !!goalError || !!trackedLiftsError || keyLost;
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
  // (#757). It decides which hero paints; see `recoveryModeUnknown` below for
  // what renders while it has no answer (#1241, #1366).
  const recoverySummary = useHomeRecoverySummary(notes, workoutNote);

  // Product-wide "what am I training now?" context (#868), shared verbatim
  // with Log and Analytics — same authoritative Recovery snapshot as
  // `recoverySummary` above, plus the STORED current-routine id (not
  // `workoutNote?.id`: a restored profile whose `current_workout_id`
  // references a missing/tombstoned note leaves `workoutNote` null while
  // `currentId` is still set, and this context must resolve the same
  // activeNoteId Log does — review finding, PR #873).
  // `allowProvisional` (#1366): until the first reconciliation runs, the
  // persisted blocks/weeks answer the mode for display only.
  const activeTrainingContext = useActiveTrainingContext({ currentId, notes, allowProvisional: true });
  // #989: post-deload re-entry inputs for the dashboard analytics pass, keyed
  // to the same stable current-routine id Analytics and Log use. The live
  // Recovery blocks come from the same authoritative store Analytics reads
  // (Home already subscribes via useHomeRecoverySummary), passed raw the way
  // Analytics passes them so the re-entry label's active-Recovery exclusion
  // matches across both surfaces.
  const { history: deloadHistory } = useDeloadHistory();
  const recoveryState = useRecoveryBlockState() || {};
  const recoveryBlocks = (recoveryState.ready ? recoveryState.blocks : recoveryState.provisional?.blocks) || [];
  // Subscribe at startup so unit hydration is concurrent with all other reads
  // rather than deferred behind the loading gate (#1049 feedback).
  const unit = useWeightUnit();

  // Home's own active-Recovery branch (#869). Only these two derived
  // statuses ever set `baselinePaused` (see activeTrainingContext.js) — every
  // other status (normal, loading, unverified, stale, pending) keeps Home's
  // existing hierarchy exactly as it already renders, because none of them is
  // a confirmed "baseline training is paused" answer.
  const isRecoveryOpenWeek = activeTrainingContext.status === ACTIVE_TRAINING_STATUS.RECOVERY_OPEN_WEEK;
  const isRecoveryBetweenWeeks = activeTrainingContext.status === ACTIVE_TRAINING_STATUS.RECOVERY_BETWEEN_WEEKS;
  const baselinePaused = !!activeTrainingContext.baselinePaused;
  const isRecovery = isRecoveryOpenWeek || isRecoveryBetweenWeeks;

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

  const heroPrimaryActionLabel = 'Log workout';
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
    () => deriveHomeDashboardData({ weightEntries, workoutNote, weightGoal, allSections, noteSectionsList, normalNotes, notes, trackedLifts, trackedLiftActivations, deloadHistory, sourceNoteId: currentId ?? null, recoveryBlocks }),
    [weightEntries, workoutNote, weightGoal, allSections, noteSectionsList, normalNotes, notes, trackedLifts, trackedLiftActivations, deloadHistory, currentId, recoveryBlocks]
  );

  // 1K hero color, precomputed here (was inline in the 1K card JSX before the
  // #1049 split) so lerpColor stays in the screen that owns startup composition.
  const oneKHeroColor = kua
    ? lerpColor(kua.primary, kua.completion, Math.min(1, (dashboardData.oneK?.total || 0) / 1000))
    : lerpColor(colors.accentText, colors.success, Math.min(1, (dashboardData.oneK?.total || 0) / 1000));

  // First usable paint waits only on bounded LOCAL reads (#1366): the shell's
  // weight/note reads, the goal and tracked lifts, and either the persisted
  // Recovery read (LOADING until it lands) or a reconciled one. Journal replay
  // is not a term — it is held until this paint (startupTiming.js).
  // Recovery-boundary aggregates (#699) still need a known boundary, but only
  // when they would render: an unknown mode renders none of them.
  // `recoveryModeUnknown` (#1241): an unverified read, an inconsistent
  // persisted one, or an unresolved pending change is not an answer to "is a
  // Recovery block active?", so neither hero paints — just the Recovery card's
  // own message (with `Retry recovery` once it is a failure) and the weight
  // card, which depends on nothing Recovery decides. STALE and provisional
  // answers paint normally; an active block with a pending change paints
  // Recovery mode.
  const recoveryStatus = activeTrainingContext.status;
  const recoveryModeUnknown = recoveryStatus === ACTIVE_TRAINING_STATUS.UNVERIFIED
    || recoveryStatus === ACTIVE_TRAINING_STATUS.PENDING;
  const isLoading = loading || goalLoading || trackedLiftsLoading
    || recoveryStatus === ACTIVE_TRAINING_STATUS.LOADING
    || (!recoveryModeUnknown && !recoveryBoundaryReady);
  const recoveryHoldSummary = recoveryStatus === ACTIVE_TRAINING_STATUS.PENDING
    ? { ...recoverySummary, status: HOME_RECOVERY_STATUS.UNVERIFIED, message: RECOVERY_PENDING_HOLD_MESSAGE }
    : recoveryModeUnknown ? recoverySummary : null;

  // `app:local-ready` (#809, #1372): the moment Home's bounded local reads have
  // settled, so a device timing run can compare it against the encrypted-
  // storage/reload phase marks without recording anything about what loaded.
  // The read counts alongside it (#818) are counts only — no key names or values.
  // Home owns the shell's startup hold (#1366): claimed while rendering, so a
  // slow hydration never times out into replay or sync; released at local-ready
  // (or by unmounting, which is NOT readiness), so deferred background work
  // starts after it. The same commit lifts the shell's startup overlay (#1372).
  const signalLocalReady = useContext(AppLocalReadyContext);
  const [releaseStartupHold] = useState(claimAppLocalReady);
  useEffect(() => releaseStartupHold, [releaseStartupHold]);
  useEffect(() => {
    if (!isLoading) {
      markStartupPhase('app:local-ready');
      markStartupStorageReads();
      releaseStartupHold();
      signalLocalReady?.();
    }
  }, [isLoading, releaseStartupHold, signalLocalReady]);

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

  // #1341: one neutral subtitle in every state. The lead card already names the
  // routine week or `Recovery · Week N`; a state-specific subtitle repeated it.
  const homeSubtitle = 'Training and body weight at a glance.';

  return (
    <ScreenShell
      title={<KiloWordmark />}
      subtitle={homeSubtitle}
    >
      {hasLoadError ? (
        <ErrorBanner
          message={keyLost ? DEVICE_KEY_RECOVERY_MESSAGE : 'Could not load your training data.'}
          onRetry={handleRetryLoad}
        />
      ) : null}
      <CloudSyncNotice />
      {/* Three distinct outcomes, never collapsed into one another: still
          loading (skeleton), failed with nothing to fall back on (the banner
          above and nothing else — no fabricated zeroes), and a verified read
          (welcome or dashboard). A failed read that still has cached data keeps
          rendering it under the banner, which is stale but true. */}
      {isLoading ? (
        <HomeSkeleton />
      ) :(hasLoadError && !hasLoadedData) ? null : recoveryHoldSummary ? (
        <>
          <HomeRecoverySummary summary={recoveryHoldSummary} onNavigate={onNavigate} />
          <HomeWeightCard dashboardData={dashboardData} weightGoal={weightGoal} onNavigate={onNavigate} unit={unit} />
        </>
      ) : isEmptyState ? (
        // First use (#1333): two ways in, nothing to study. Syntax and tracking
        // are taught inside Log and Weight, where they are used.
        <Card style={styles.welcomeCard}>
          <Text style={styles.welcomeTitle}>Welcome to Kilo</Text>
          <Text style={styles.welcomeSubtitle}>Log a workout or a weigh-in to start your dashboard.</Text>
          <View style={styles.welcomeActions}>
            <Button title="Log Workout" onPress={() => onNavigate('Log')} style={styles.welcomeButton} />
            <Button title="Log Weight" onPress={() => onNavigate('Weight')} style={styles.welcomeButton} />
          </View>
        </Card>
      ) : (
        <>
          {/* #1341: in Recovery the Recovery card is the training surface and
              carries the action strip; there is no separate Recovery hero. */}
          {isRecovery ? null : (
            <HomeHeader
              dashboardData={dashboardData}
              onNavigate={onNavigate}
              workoutNote={workoutNote}
              notes={notes}
              handleLogWorkoutPress={handleLogWorkoutPress}
              heroPrimaryActionLabel={heroPrimaryActionLabel}
              heroPrimaryActionHint={heroPrimaryActionHint}
            />
          )}
          <HomeDashboard
            recoverySummary={recoverySummary}
            recoveryActions={isRecovery ? { primaryLabel: heroPrimaryActionLabel, primaryHint: heroPrimaryActionHint, onPrimary: handleLogWorkoutPress } : null}
            onNavigate={onNavigate}
            dashboardData={dashboardData}
            weightGoal={weightGoal}
            baselinePaused={baselinePaused}
            oneKHeroColor={oneKHeroColor}
            unit={unit}
          />
        </>
      )}
    </ScreenShell>
  );
}

export { HomeRecoverySummary } from './home/HomeRecoverySummary';

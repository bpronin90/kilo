import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { ScreenShell } from '../components/ScreenShell';
import { Card, HeroMetric, LineChart, getSessionTone, Button, ErrorBanner } from '../components/UI';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';
import { CLOUD_SYNC_NOTICE, useWeightGoal, useTrackedLifts, getNoteSections, useCloudSyncSummary, useActiveTrainingContext } from '../hooks/useEntries';
import { deriveHomeDashboardData, useHomeNormalNotes, useHomeRecoverySummary, HOME_RECOVERY_STATUS, RECOVERY_COMPARISON_STATUS, RECOVERY_WEEK_STATUS } from './home/homeDashboardData';
import { useWeightUnit } from '../lib/unitPreference';
import { displayWeight, formatBodyweightValue, displayChartSeries } from '../lib/units';
import { markStartupPhase, markStartupStorageReads } from '../storage/entries/startupTiming';

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

// Active-recovery status on Home (#757).
//
// Home's aggregates already change meaning when a recovery block is running —
// the classification counts and the 1K total are derived from a population that
// may be withholding that block's sessions — but the screen said nothing about
// it, so the user had to open Analytics to find out why the numbers moved.
//
// Three renderings, one per status, and the difference between them is the
// whole point (see `useHomeRecoverySummary`):
//
//   - verified with an active block → the compact summary and the handoff;
//   - verified with none            → NOTHING. Silence is a claim, and here it
//                                     is a claim a verified read supports;
//   - loading / unverified          → the state contract's own message, plus
//                                     `Retry recovery` for the failure. Never
//                                     silence: an unread snapshot is empty for
//                                     the same reason a recovery-free account
//                                     is, and only one of those means "no
//                                     recovery".
//
// The handoff is `onNavigate('Analytics', 'recovery')` — the Recovery section
// itself, not just the tab that contains it (#770). A control whose label reads
// `Recovery` has to land on Recovery; leaving it unsectioned made it inherit
// whatever position Analytics was last left at, which could be any other
// section entirely.
export function HomeRecoverySummary({ summary, onNavigate }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  if (!summary) return null;
  const {
    status, stale, message, active,
    comparisonStatus, weekNumber, weekNoteStatus, metCount, totalBaselineExercises,
    categoryCounts,
  } = summary;

  // Verified, nothing is running, and the answer is CURRENT. This is the one
  // state where rendering nothing is true. `!stale` is load-bearing: a stale
  // snapshot that happened to cache no active block is still a snapshot whose
  // newest refresh failed, and silently dropping the card there would present
  // a last-known-good "nothing is recovering" as a fresh verified one — and
  // take the retry that resolves it down with the message.
  if (status === HOME_RECOVERY_STATUS.READY && !active && !stale) return null;

  const isLoadingStatus = status === HOME_RECOVERY_STATUS.LOADING;
  // Retry belongs to the two conditions whose message names it, and to neither
  // a clean read nor a load still in flight.
  const canRetry = !!summary.retry && !!message && !isLoadingStatus;

  // The result region (#803). Exactly one of two shapes, never both: the
  // met/total figure when a week was genuinely compared, or a single plain-
  // language status when it was not. Baseline availability is checked first
  // because it is a property of the block, not of any one week; a
  // missing/unreadable note is only meaningful once a week has actually been
  // compared. Nothing here invents a number for an unknown: a fallback prints
  // no count at all rather than `0 of 0`.
  const fallbackStatus = comparisonStatus === RECOVERY_COMPARISON_STATUS.BASELINE_UNAVAILABLE
    || comparisonStatus === RECOVERY_COMPARISON_STATUS.BASELINE_UNSUPPORTED
    ? "Baseline data for this block isn't available."
    : weekNumber === null
      ? 'Baseline captured. No week logged yet.'
      : weekNoteStatus === RECOVERY_WEEK_STATUS.NOTE_MISSING
        ? "This week's note is no longer available."
        : weekNoteStatus === RECOVERY_WEEK_STATUS.NOTE_UNREADABLE
          ? "This week's note couldn't be read."
          : comparisonStatus === RECOVERY_COMPARISON_STATUS.BASELINE_EMPTY
            ? 'No baseline exercises were captured for this block.'
            : null;

  // Week identity is its own scannable line rather than a clause folded into a
  // sentence — but only when a week exists. `Baseline captured. No week logged
  // yet.` has no week to name, and printing `Week null` or inventing `Week 1`
  // would both be false.
  const weekLabel = weekNumber === null ? null : `Week ${weekNumber}`;
  const heroValue = fallbackStatus === null
    ? `${metCount} of ${totalBaselineExercises}`
    : null;

  // Supporting analytics: one tile per nonzero category, value over label, in
  // the contract's order. A zero category is absent, not a `0` tile — the card
  // stays compact and every tile on screen is a fact worth reading.
  const stats = [];
  const addStat = (count, label) => { if (count > 0) stats.push({ count, label }); };
  addStat(categoryCounts.rebuilding, 'Rebuilding');
  addStat(categoryCounts.not_reintroduced, 'Not reintroduced');
  addStat(categoryCounts.not_comparable, 'Not comparable');
  addStat(categoryCounts.added_during_recovery, 'Added during recovery');

  // One announcement for the whole summary, assembled in reading order. The
  // visual hierarchy is a layout device; the spoken version has to carry the
  // same facts as complete sentences. The inclusion clause (#820: dropped
  // from Home's visible/spoken content — it stays stated on the Analytics
  // Recovery section, which already reports inclusion per block) is no
  // longer part of this summary.
  const accessibleContent = [
    weekLabel,
    heroValue ? `${heroValue} baseline exercises met` : fallbackStatus,
    ...stats.map(s => `${s.count} ${s.label.toLowerCase()}`),
  ].filter(Boolean)
    .map(part => (/[.!?]$/.test(part) ? part : `${part}.`))
    .join(' ');

  return (
    // Wrapped rather than testID'd directly: Card takes only children/style/
    // tone/onPress and would swallow the prop.
    <View testID="home-recovery-summary">
      <Card style={styles.recoveryCard}>
        {active ? (
          <>
            {/* Header row is the handoff (#820 revert): kept consistent with
                Exercise Progress and every Analytics card in the same family
                rather than the one-off footer link tried earlier. The dead
                space that pattern originally cost is solved by tightening the
                card's own top padding and gap, not by shrinking the 44dp
                target every Home handoff is held to. */}
            <Pressable
              testID="home-recovery-link"
              onPress={() => onNavigate('Analytics', 'recovery')}
              style={[styles.sectionHeaderAction, styles.sectionHeaderActionStart]}
              hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
              accessibilityRole="button"
              accessibilityLabel="Recovery"
              accessibilityHint="Opens the Recovery section of the Analytics tab"
            >
              <Text style={[styles.recoveryLabel, styles.sectionHeaderLabel]}>Recovery</Text>
              <View style={styles.sectionHeaderChevron}>
                <Svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={colors.textMuted} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" accessible={false}><Path d="M9 5l7 7-7 7" /></Svg>
              </View>
            </Pressable>
            {/* One announcement for the whole summary: separate nodes read as
                unrelated fragments. */}
            <View
              testID="home-recovery-analytics"
              accessible
              accessibilityLabel={accessibleContent}
            >
              {weekLabel ? (
                <Text style={styles.recoveryWeekLabel}>{weekLabel}</Text>
              ) : null}
              {heroValue ? (
                <View style={styles.recoveryHero}>
                  <Text style={[HeroMetric.statSecondary, styles.recoveryHeroValue]}>{heroValue}</Text>
                  <Text style={styles.recoveryHeroCaption}>baseline exercises met</Text>
                </View>
              ) : (
                <Text style={styles.recoveryFallbackLine}>{fallbackStatus}</Text>
              )}
              {stats.length > 0 ? (
                <View testID="home-recovery-stats" style={styles.recoveryStatsDivider}>
                  <View style={styles.recoveryStatCols}>
                    {stats.map(stat => (
                      <View key={stat.label} style={styles.recoveryStatCol}>
                        <View style={styles.recoveryStatDot} />
                        <Text style={styles.recoveryStatValue}>{stat.count}</Text>
                        <Text style={styles.recoveryStatLabel}>{stat.label}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}
            </View>
          </>
        ) : (
          <View
            accessible
            accessibilityRole={isLoadingStatus ? 'progressbar' : 'alert'}
            accessibilityLabel={`Recovery. ${message}`}
          >
            <Text style={styles.recoveryLabel}>Recovery</Text>
            <Text style={styles.recoveryStatusLine}>{message}</Text>
          </View>
        )}
        {/* The stale case keeps the last-known-good summary above and adds the
            reason it may be behind, rather than replacing it. */}
        {active && message ? (
          <Text style={styles.recoveryStatusLine} accessibilityLiveRegion="polite">{message}</Text>
        ) : null}
        {canRetry ? (
          <Pressable
            testID="home-recovery-retry"
            onPress={() => summary.retry()}
            style={styles.recoveryAction}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Retry recovery"
          >
            {/* Exactly the name every recovery message tells the user to tap
                (ui-design-rules §12). */}
            <Text style={styles.recoveryActionText}>Retry recovery</Text>
          </Pressable>
        ) : null}
      </Card>
    </View>
  );
}

export function HomeScreen({ weightEntries, workoutNote, currentId = null, notes, successMessage, onNavigate, loading, loadError = false, onRetryLoad }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { goal: weightGoal, loading: goalLoading, error: goalError, refresh: refreshGoal } = useWeightGoal();
  const { trackedLifts, loading: trackedLiftsLoading, error: trackedLiftsError, refresh: refreshTrackedLifts } = useTrackedLifts();
  const unit = useWeightUnit();

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
  // activeNoteId Log does — review finding, PR #873). Not yet threaded into
  // Home's own rendering (that stays exactly as it already behaves); this is
  // the shared derivation Home now resolves at its existing Recovery-state
  // boundary, alongside the other two screens.
  const activeTrainingContext = useActiveTrainingContext({ currentId, notes });

  const noteSectionsList = useMemo(
    () => normalNotes.map(n => getNoteSections(n)),
    [normalNotes]
  );

  const allSections = useMemo(
    () => noteSectionsList.flat(),
    [noteSectionsList]
  );

  const dashboardData = useMemo(
    () => deriveHomeDashboardData({ weightEntries, workoutNote, weightGoal, allSections, noteSectionsList, trackedLifts }),
    [weightEntries, workoutNote, weightGoal, allSections, noteSectionsList, trackedLifts]
  );

  const weekTone = getSessionTone(dashboardData.sessionCount);
  const weekToneColor = weekTone === 'error' ? colors.error
    : weekTone === 'warn' ? colors.caution
    : weekTone === 'success' ? colors.success
    : null;

  // Whether there is any rolling-average series to plot at all.
  const hasWeightSeries = Array.isArray(dashboardData.weightSeries)
    && dashboardData.weightSeries.length > 0;

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
          {/* ══ TIER 1: Weekly Summary ══ */}
          <Card style={styles.weeklyHero}>
            {/* #2 inline week label. The two primary daily-loop actions live in
                one stable row below the hero state instead of being scattered
                beside the values they act on (#717 review). */}
            <View style={styles.heroWeekRow}>
              <Text style={[styles.heroWeekLabel, weekToneColor ? { color: weekToneColor } : null]}>
                {dashboardData.weeksIn !== null ? `Week ${dashboardData.weeksIn}` : 'Week —'}
              </Text>
            </View>

            {/* The hero metric stays a plain, non-pressable value (§8). With no
                weigh-in yet the slot reads as a short muted sentence instead of
                a bare dash over dead space. */}
            <View style={styles.heroWeightRow}>
              {dashboardData.latestWeight ? (
                <Text style={styles.heroWeightValue}>
                  {formatBodyweightValue(dashboardData.latestWeight, unit)}
                  <Text style={styles.heroWeightUnit}> {unit}</Text>
                </Text>
              ) : (
                <Text style={styles.heroWeightPlaceholder}>No weigh-in yet</Text>
              )}
            </View>

            <View style={styles.heroPrimaryActions}>
              <Pressable
                testID="home-current-routine-link"
                onPress={() => onNavigate('Log')}
                style={styles.heroPrimaryAction}
                hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
                accessibilityRole="button"
                accessibilityLabel="Log workout"
                accessibilityHint="Opens the Log tab for your current routine"
              >
                <Text style={styles.heroPrimaryActionText}>Log workout</Text>
                <Svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={colors.textMuted} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" accessible={false}><Path d="M9 5l7 7-7 7" /></Svg>
              </Pressable>

              <View style={styles.heroPrimaryActionDivider} />

              <Pressable
                testID="home-weight-action"
                onPress={() => onNavigate('Weight')}
                style={styles.heroPrimaryAction}
                hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
                accessibilityRole="button"
                accessibilityLabel="Log weight"
                accessibilityHint="Opens the Weight tab to log a weigh-in"
              >
                <Text style={styles.heroPrimaryActionText}>Log weight</Text>
                <Svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={colors.textMuted} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" accessible={false}><Path d="M9 5l7 7-7 7" /></Svg>
              </Pressable>
            </View>

            {/* #4 sparkline strip below weight. LineChart owns its own Pressable
                for point selection, so the Analytics-weight handoff is a separate
                explicit control beneath the chart — one press owner per region,
                no nested responders. The chart caption stays a plain caption; the
                handoff reads as an action ("See weight trends") so it is not
                mistaken for chart furniture (#717 review). */}
            <View style={styles.heroSparklineStrip}>
              {/* With no weigh-ins there is no trend to draw, so the caption and
                  the chart's own "Not enough data" placeholder are suppressed
                  rather than left as dead space in the primary card. The handoff
                  itself stays available. */}
              {hasWeightSeries ? (
                <>
                  <Text style={styles.heroSparklineSublabel}>7-day rolling avg</Text>
                  <LineChart
                    data={displayChartSeries(dashboardData.weightSeries, unit)}
                    color={colors.textMuted}
                    height={44}
                    paddingHorizontal={0}
                    hideHeader
                  />
                </>
              ) : null}
              <Pressable
                testID="home-weight-trend-link"
                onPress={() => onNavigate('Analytics', 'weight')}
                style={styles.heroInlineAction}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="See weight trends"
                accessibilityHint="Opens the weight section of the Analytics tab"
              >
                <Text style={styles.heroInlineActionText}>See weight trends</Text>
                <Svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={colors.textMuted} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" accessible={false}><Path d="M9 5l7 7-7 7" /></Svg>
              </Pressable>
            </View>

            {/* Classification band — handoff to Analytics' Progressive Overload
                table (#717, retargeted in #770). The counts under this header
                ARE the per-exercise progressing/steady/regressing classification,
                and that table is where they are itemized, so `strength` (the 1K
                block, higher up the tab) was landing short of what the label
                promises. Only the header row is the press target: the counts
                beneath are data, not a control, so making the whole band
                tappable was too much clickable area. The affordance is the plain
                chevron already used by `Full history and insights` on this same
                screen — no fill, no border. */}
            <View style={styles.classifSection}>
              <Pressable
                testID="home-strength-summary-link"
                onPress={() => onNavigate('Analytics', 'progressive-overload')}
                style={[styles.sectionHeaderAction, styles.sectionHeaderActionStart]}
                hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
                accessibilityRole="button"
                accessibilityLabel="Exercise Progress"
                accessibilityHint="Opens the Progressive Overload section of the Analytics tab"
              >
                <Text style={[styles.classifSectionLabel, styles.sectionHeaderLabel]}>Exercise Progress</Text>
                <View style={styles.sectionHeaderChevron}>
                  <Svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={colors.textMuted} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" accessible={false}><Path d="M9 5l7 7-7 7" /></Svg>
                </View>
              </Pressable>
              <View style={styles.classifRow}>
                {[
                  { label: 'Progressing', count: dashboardData.weeklySummary.classifications?.progressing ?? 0, color: colors.success },
                  { label: 'Steady', count: dashboardData.weeklySummary.classifications?.stalled ?? 0, color: colors.caution },
                  { label: 'Regressing', count: dashboardData.weeklySummary.classifications?.regressing ?? 0, color: colors.error },
                ].map((item, idx) => (
                  <View key={idx} style={styles.classifCol}>
                    <View style={[styles.classifDot, { backgroundColor: item.color }]} />
                    <Text style={styles.classifCount}>{item.count}</Text>
                    <Text style={styles.classifLabel}>{item.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* #7 quiet CTA. Targets `overview` rather than a bare tab press
                (#770): "full history and insights" promises the whole tab from
                the top, and an unsectioned press would instead resume the last
                Analytics scroll position — which for a returning user is
                whatever single section they were reading last. */}
            <View style={styles.heroFooter}>
              <Pressable
                testID="home-insights-link"
                onPress={() => onNavigate('Analytics', 'overview')}
                style={styles.insightsLink}
                accessibilityRole="button"
                accessibilityLabel="Full history and insights"
                accessibilityHint="Opens the Analytics tab at the top"
              >
                <Text style={styles.insightsLinkText}>Full history and insights</Text>
                <Svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={colors.textMuted} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" accessible={false}><Path d="M9 5l7 7-7 7" /></Svg>
              </Pressable>
            </View>
          </Card>

          {/* ══ TIER 1b: Recovery status ══ */}
          {/* Directly under the hero because it is what the hero's week label
              and classification counts mean right now, not a separate topic. */}
          <HomeRecoverySummary summary={recoverySummary} onNavigate={onNavigate} />

          {/* ══ TIER 2: Weight Goal ══ */}
          {dashboardData.goalInfo ? (() => {
            const gi = dashboardData.goalInfo;
            const warnings = gi.warnings || [];
            const paceColor = warnings.includes('unrealistic') ? colors.error
              : warnings.includes('unhealthy') ? colors.caution
              : colors.success;
            const modeLabel = gi.direction === 'loss' ? 'Cutting' : gi.direction === 'gain' ? 'Bulking' : 'Maintaining';
            return (
              <Card style={styles.goalCard}>
                <View style={styles.goalModeRow}>
                  <Text style={styles.goalDirectionText}>
                    Goal: <Text style={styles.goalModeAccent}>{modeLabel}</Text>
                  </Text>
                  <Text style={styles.goalWeeksText}>
                    {gi.isOverdue ? 'Goal ended' : `${Math.round(gi.weeks_remaining)} weeks left`}
                  </Text>
                </View>
                <View style={styles.goalStatsGrid}>
                  <View style={styles.goalStatCol}>
                    <Text style={styles.goalStatLabel}>Target</Text>
                    <View style={styles.goalStatValueRow}>
                      <Text style={styles.goalStatValueLarge}>{weightGoal?.target_weight != null ? formatBodyweightValue(weightGoal.target_weight, unit) : weightGoal?.target_weight}</Text>
                      <Text style={styles.goalStatUnitLabel}>{unit}</Text>
                    </View>
                  </View>
                  <View
                    style={styles.goalStatCol}
                    accessible
                    accessibilityLabel={`Pace: ${
                      gi.required_weekly_pace !== null
                        ? `${gi.required_weekly_pace > 0 ? '+' : ''}${displayWeight(gi.required_weekly_pace, unit).toFixed(1)} ${unit} per week`
                        : 'not available'
                    }. ${
                      warnings.includes('unrealistic') ? 'Unrealistic pace.'
                        : warnings.includes('unhealthy') ? 'Unhealthy pace.'
                        : 'Healthy pace.'
                    }`}
                  >
                    <Text style={styles.goalStatLabel}>Pace</Text>
                    <View style={styles.goalStatValueRow}>
                      <Text style={[styles.goalStatValueLarge, { color: paceColor }]}>
                        {gi.required_weekly_pace !== null ? (
                          `${gi.required_weekly_pace > 0 ? '+' : ''}${displayWeight(gi.required_weekly_pace, unit).toFixed(1)}`
                        ) : (
                          '—'
                        )}
                      </Text>
                      <Text style={[styles.goalStatUnitLabel, { color: paceColor }]}>{unit}/wk</Text>
                    </View>
                  </View>
                </View>
              </Card>
            );
          })() : null}

          {/* ══ TIER 3: 1k Club Progress ══ */}
          {/* Handoff to the Analytics strength section, which is where the 1K
              detail lives (owner scope override on #717). Header row is the
              handoff (#820 revert), same family as Exercise Progress; the
              dead space that pattern cost originally is solved by tightening
              the card's own top padding and gap, not the 44dp target. */}
          <Card style={styles.oneKCard}>
            <Pressable
              testID="home-one-k-link"
              onPress={() => onNavigate('Analytics', 'strength')}
              style={[styles.sectionHeaderAction, styles.sectionHeaderActionCenter]}
              hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
              accessibilityRole="button"
              accessibilityLabel="1K Progress"
              accessibilityHint="Opens the strength section of the Analytics tab"
            >
              <Text style={[styles.oneKLabel, styles.sectionHeaderLabel]}>1K Progress</Text>
              <View style={styles.sectionHeaderChevron}>
                <Svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={colors.textMuted} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" accessible={false}><Path d="M9 5l7 7-7 7" /></Svg>
              </View>
            </Pressable>
            <Text style={[styles.oneKHeroValue, { color: lerpColor(colors.accent, colors.success, Math.min(1, (dashboardData.oneK?.total || 0) / 1000)) }]}>
              {dashboardData.oneK?.total ? `${displayWeight(dashboardData.oneK.total, unit).toFixed(0)}` : '—'}
              <Text style={styles.oneKHeroUnit}> {unit}</Text>
            </Text>
            <View style={styles.progressBarLarge}>
              <View
                style={[
                  styles.progressFillLarge,
                  { width: `${Math.min(100, ((dashboardData.oneK?.total || 0) / 1000) * 100)}%` }
                ]}
              />
            </View>
            <View style={styles.oneKGrid}>
              <View style={styles.oneKGridItem}>
                <Text style={styles.oneKGridValue}>{dashboardData.oneK?.squat != null ? displayWeight(dashboardData.oneK.squat, unit).toFixed(0) : '—'}</Text>
                <Text style={styles.oneKGridLabel}>Squats</Text>
              </View>
              <View style={[styles.oneKGridItem, styles.oneKGridItemBorder]}>
                <Text style={styles.oneKGridValue}>{dashboardData.oneK?.bench != null ? displayWeight(dashboardData.oneK.bench, unit).toFixed(0) : '—'}</Text>
                <Text style={styles.oneKGridLabel}>Bench</Text>
              </View>
              <View style={styles.oneKGridItem}>
                <Text style={styles.oneKGridValue}>{dashboardData.oneK?.deadlift != null ? displayWeight(dashboardData.oneK.deadlift, unit).toFixed(0) : '—'}</Text>
                <Text style={styles.oneKGridLabel}>Deadlifts</Text>
              </View>
            </View>
          </Card>
        </>
      )}
    </ScreenShell>
  );
}
const createStyles = (colors) => StyleSheet.create({
  // Cloud sync notice. The queued state is informational, so it uses the same
  // quiet chip tone as the shell's update banner; only a real failure takes the
  // error surface.
  syncNoticeCard: {
    padding: 16,
    marginTop: 12,
    gap: 8,
    backgroundColor: colors.chipBackground,
    borderColor: colors.cardBorder,
  },
  syncNoticeCardFailed: {
    padding: 16,
    marginTop: 12,
    gap: 8,
    backgroundColor: colors.errorSurface,
    borderColor: colors.error,
  },
  syncNoticeTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  syncNoticeTitleFailed: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.error,
  },
  syncNoticeBody: {
    fontSize: 13,
    color: colors.textMuted,
    // No fixed lineHeight: enlarged text must grow its own line box.
    marginTop: 2,
  },
  syncNoticeRetryError: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.error,
  },
  syncNoticeActions: {
    flexDirection: 'row',
    alignItems: 'center',
    // Wraps at 320dp with enlarged text instead of squeezing both actions
    // below the 44dp target.
    flexWrap: 'wrap',
    columnGap: 16,
    rowGap: 4,
  },
  syncNoticeAction: {
    minHeight: 44,
    justifyContent: 'center',
  },
  syncNoticeActionText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.accent,
  },
  // Static first-paint placeholder bars.
  skeletonCard: {
    padding: 24,
    marginTop: 12,
    gap: 12,
  },
  skeletonBar: {
    backgroundColor: colors.cardBorder,
    borderRadius: 6,
    opacity: 0.6,
  },
  skeletonBarShort: {
    height: 12,
    width: '35%',
  },
  skeletonBarHero: {
    height: 36,
    width: '60%',
  },
  skeletonBarFull: {
    height: 12,
    width: '100%',
  },
  skeletonBarWide: {
    height: 12,
    width: '75%',
  },
  weeklyHero: {
    padding: 24,
    gap: 0,
    marginTop: 12,
  },
  heroWeekRow: {
    marginBottom: 4,
  },
  heroWeekLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    flexShrink: 1,
  },
  heroWeightRow: {
    minWidth: 0,
  },
  // The two highest-frequency actions share one stable strip at every width,
  // keeping them visually distinct from the surrounding summary and Analytics
  // handoffs while preserving the single hero metric.
  heroPrimaryActions: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: colors.subtleBg,
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 8,
    marginBottom: 8,
  },
  heroPrimaryAction: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  heroPrimaryActionText: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    textAlign: 'center',
  },
  heroPrimaryActionDivider: {
    width: 1,
    marginVertical: 8,
    backgroundColor: colors.cardBorder,
  },
  // Quiet Analytics handoff attached to the sparkline. 44pt minimum target per
  // the mobile touch-target rule, kept visually quiet so the hero metric remains
  // the only dominant element (§8).
  heroInlineAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 44,
    paddingHorizontal: 4,
  },
  heroInlineActionText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  heroWeightValue: {
    ...HeroMetric.hero,
    color: colors.accent,
    // Allow the value to give up width inside the row so an enlarged metric on a
    // 320dp screen stays inside the card instead of painting past its edge.
    flexShrink: 1,
    minWidth: 0,
  },
  // The no-data hero is a short muted sentence, not a hero-sized dash: at hero
  // scale a lone glyph left a visible hole in the card's dominant slot.
  heroWeightPlaceholder: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.textMuted,
  },
  heroWeightUnit: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textMuted,
  },
  heroSparklineStrip: {
    marginTop: 4,
    marginBottom: 12,
  },
  heroSparklineSublabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 2,
  },
  classifSection: {
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
    paddingTop: 16,
    marginBottom: 16,
  },
  // Shared affordance for the two strength destinations (Exercise Progress and
  // 1K Progress): the section label plus the same plain chevron that
  // `Full history and insights` already uses on this screen. No fill and no
  // border — a filled pill read as noisy, and no chevron at all read as not
  // pressable. The row itself is the press target, so the metrics beneath stay
  // untappable.
  sectionHeaderAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 44,
    // No wrap and no space-between: as independent flex children on a wrapping
    // full-width row, the chevron orphaned onto its own line at 320px with
    // enlarged text. Kept adjacent like `Full history and insights ›`, the row
    // hugs its content and the label absorbs narrow widths by wrapping itself.
    maxWidth: '100%',
  },
  sectionHeaderActionStart: {
    alignSelf: 'flex-start',
  },
  sectionHeaderActionCenter: {
    alignSelf: 'center',
  },
  sectionHeaderLabel: {
    flexShrink: 1,
  },
  sectionHeaderChevron: {
    flexShrink: 0,
  },
  classifSectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  classifRow: {
    flexDirection: 'row',
    // At 320dp with an enlarged text setting, `Progressing` / `Regressing` are
    // single words wider than a one-third column, so fixed thirds made the three
    // labels collide. Wrapping lets a column drop to the next line instead
    // (verified by rendered capture at 320/375/448dp, #717 review round 2).
    flexWrap: 'wrap',
    rowGap: 12,
    // Content-sized columns with no gap could exactly fill the row, so at 375px
    // with enlarged text the three labels touched and read as one continuous
    // string. A real horizontal gap both separates them when they fit and forces
    // the wrap one column earlier when they no longer do.
    columnGap: 16,
  },
  classifCol: {
    // Content-sized rather than fixed thirds. A static basis cannot tell default
    // text from enlarged text: sized for the large case it wrapped at default
    // 375dp, sized for the default case the enlarged label overran its column.
    // Sizing to content keeps all three on one row whenever they fit and wraps
    // only when they genuinely do not (verified by rendered capture).
    flexGrow: 1,
    flexShrink: 0,
    flexBasis: 'auto',
    alignItems: 'center',
    gap: 5,
  },
  classifDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  classifCount: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  classifLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    textAlign: 'center',
    // No fixed lineHeight: a scaled-up label must grow its own line box rather
    // than overflow a 14px one.
  },
  heroFooter: {
    alignItems: 'center',
    marginTop: 12,
  },
  insightsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  insightsLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  // Recovery status card (#757). Same padding as the other tiers; the label
  // reuses the uppercase section treatment already used by the Exercise
  // Progress and 1K headers, so the handoff reads as one of that family.
  // Top padding and gap trimmed from the 24/8 default (#820): the header row
  // is still a full 44dp target, so the fix for the dead space it left above
  // the week eyebrow is tightening the space around it, not the target itself.
  recoveryCard: {
    padding: 24,
    paddingTop: 14,
    gap: 4,
  },
  recoveryLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  // #803: the card is read as analytics, not as prose — a week eyebrow, one
  // hero result, then supporting count tiles. Sizes follow the analytics
  // hierarchy already established for cards (ui-design-rules §8): one hero,
  // supporting values at 18/700 over an 11/600 uppercase muted label.
  recoveryWeekLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  recoveryHero: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    columnGap: 6,
    marginTop: 2,
  },
  recoveryHeroValue: {
    color: colors.accent,
  },
  recoveryHeroCaption: {
    fontSize: 13,
    color: colors.textMuted,
  },
  // The fallbacks are sentences, not figures: they take the hero's slot at
  // reading weight rather than being dressed up as a metric.
  recoveryFallbackLine: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginTop: 2,
  },
  // Category breakdown (#820): reuses the Exercise Progress band's own
  // dot/count/label column grammar instead of a bespoke tile system, so the
  // two summary rows in this hero card read as one visual language.
  recoveryStatsDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
    paddingTop: 14,
    marginTop: 12,
  },
  recoveryStatCols: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 12,
    columnGap: 16,
  },
  // Unlike classifCol's short fixed labels (Progressing/Steady/Regressing),
  // a category label here can run to "Added during recovery" — long enough
  // that even alone on its own wrapped row it can exceed the card's width at
  // enlarged accessibility text sizes. flexShrink lets the column compress
  // below its own content width so the label wraps instead of overflowing.
  recoveryStatCol: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
    minWidth: 0,
    alignItems: 'center',
    gap: 5,
  },
  recoveryStatDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
    opacity: 0.55,
  },
  recoveryStatValue: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  recoveryStatLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  recoveryStatusLine: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  recoveryAction: {
    minHeight: 44,
    justifyContent: 'center',
  },
  recoveryActionText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.accent,
  },
  goalCard: {
    padding: 24,
  },
  goalModeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  goalDirectionText: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  goalModeAccent: {
    color: colors.accent,
  },
  goalWeeksText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
  },
  goalStatsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  goalStatCol: {
    flex: 1,
    gap: 4,
  },
  goalStatLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
  },
  goalStatValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  goalStatValueLarge: {
    fontSize: 30,
    fontWeight: '800',
    color: colors.text,
  },
  goalStatUnitLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textMuted,
  },
  // Top padding and gap trimmed from the 24/10 default (#820): the header
  // row is still a full 44dp target, so the fix for the dead space it left
  // above the hero total is tightening the space around it, not the target.
  oneKCard: {
    padding: 24,
    paddingTop: 14,
    gap: 6,
    alignItems: 'center',
  },
  oneKLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    flexShrink: 1,
  },
  oneKHero: {
    alignItems: 'center',
    marginBottom: 16,
  },
  // Restored to the accepted pre-regression scale (#771): the #763 compact-
  // summary override read as a visual demotion of the 1K total, so this
  // spreads HeroMetric.hero (48/900) the same as the Analytics owner card.
  oneKHeroValue: {
    ...HeroMetric.hero,
    color: colors.text,
  },
  oneKHeroUnit: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textMuted,
  },
  // Track color, radius, and vertical rhythm match the Analytics 1K progress
  // bar (#763) — the bar reads as the same control on both surfaces, and since
  // #771 so does the hero value itself (see design-system-map.md).
  progressBarLarge: {
    height: 8,
    backgroundColor: colors.divider,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 16,
    alignSelf: 'stretch',
  },
  progressFillLarge: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: 4,
  },
  oneKGrid: {
    flexDirection: 'row',
    alignSelf: 'stretch',
  },
  oneKGridItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  oneKGridItemBorder: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.cardBorder,
  },
  // Weight and case match the Analytics breakdown item (#763); fontSize
  // stays smaller here because Home is the compact summary, not the owner.
  oneKGridValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  oneKGridLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  placeholderText: {
    fontSize: 48,
    color: colors.textMuted,
    fontWeight: '400',
  },
  emptyText: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    fontStyle: 'italic',
  },
  welcomeCard: {
    padding: 24,
    marginTop: 12,
  },
  welcomeHeader: {
    marginBottom: 8,
  },
  welcomeTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
  },
  welcomeSubtitle: {
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 20,
    marginTop: 6,
  },
  welcomeDivider: {
    height: 1,
    backgroundColor: colors.cardBorder,
    marginVertical: 16,
  },
  welcomeStep: {
    marginBottom: 20,
  },
  welcomeStepHeader: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  welcomeIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.8,
  },
  welcomeStepTextContainer: {
    flex: 1,
  },
  welcomeStepTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  welcomeStepDesc: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
    marginTop: 4,
  },
  welcomeButton: {
    borderRadius: 14,
    paddingVertical: 12,
  },
});

import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Card } from '../../components/UI';
import { useTheme } from '../../theme/ThemeContext';
import {
  HOME_BIG3_NOT_IN_BASELINE, HOME_BIG3_NOT_RETESTED, HOME_BIG3_NOT_SCORED, HOME_BIG3_SCORED, HOME_BIG3_UNKNOWN,
  HOME_RECOVERY_STATUS, RECOVERY_COMPARISON_STATUS, RECOVERY_WEEK_STATUS,
} from './homeDashboardData';
import { createStyles } from './homeStyles';
import { useKuaTypography } from '../../theme/typography';

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
// itself, not just the tab that contains it (#770).
//
// #1335 (corrects #1333): the Big 3 ARE the card. Squat, Bench and Deadlift lead,
// each with the snapshot's own per-lift value; the total is one secondary line
// beneath them. What Home leaves to Analytics is the prose around them — the
// headline caption, roster counts, week-scope explainer and `Latest week:` wording.
// Each Big 3 row's right-hand value: plain words, and a percentage only where the
// snapshot produced a real per-lift score (#1171).
function liftValue(lift) {
  if (lift.state === HOME_BIG3_NOT_IN_BASELINE) return 'Not in baseline';
  if (lift.state === HOME_BIG3_NOT_RETESTED) return 'Not retested';
  if (lift.state === HOME_BIG3_NOT_SCORED) return 'Not scored';
  if (lift.state === HOME_BIG3_UNKNOWN) return 'Unknown';
  return `${lift.percent}%`;
}

export function HomeRecoverySummary({ summary, onNavigate }) {
  const { colors, kuaPalette: kua } = useTheme();
  const typography = useKuaTypography();
  const styles = useMemo(() => createStyles(colors, kua, typography), [colors, kua, typography]);

  if (!summary) return null;
  const {
    status, stale, message, active,
    comparisonStatus, headline = null, weekNumber, weekNoteStatus, weekNoteTitle = null, big3 = [],
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

  // A block or week that cannot be compared says so plainly (#803). Baseline
  // availability is checked first because it is a property of the block, not of
  // any one week. Nothing here invents a number for an unknown.
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

  // Carried strength scores stay visible under a note-status fallback (#1318).
  const lifts = big3;
  const headlineScored = !!headline && headline.state === 'score';
  // No total and no Big 3 to read instead: say why, in the snapshot's own words.
  // With Big 3 rows, each lift's own status already answers it.
  const headlineReason = !!headline && headline.state !== 'score' && fallbackStatus === null && lifts.length === 0
    ? headline.message : null;
  // Compact week tag beside the header. With no week logged there is nothing to
  // name, and inventing `Week 1` would be false. Staleness is the message below.
  const weekName = weekNoteTitle || (weekNumber === null ? null : `Week ${weekNumber}`);

  // One announcement for the whole summary, assembled in reading order.
  const accessibleContent = [
    weekName,
    fallbackStatus,
    lifts.length > 0 ? 'Big 3' : null,
    ...lifts.map(lift => lift.spoken || `${lift.label} ${liftValue(lift).toLowerCase()}`),
    headlineScored ? headline.headline : null,
    headlineReason,
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
            <View style={styles.recoveryHeaderRow}>
              {/* Header row is the handoff (#820), the same family as Exercise
                  Progress and 1K Progress. */}
              <Pressable
                testID="home-recovery-link"
                onPress={() => onNavigate('Analytics', 'recovery')}
                style={[styles.sectionHeaderAction, styles.recoveryHeaderLink]}
                hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
                accessibilityRole="button"
                accessibilityLabel="1K recovery"
                accessibilityHint="Opens the Recovery section of the Analytics tab"
              >
                <Text style={[styles.recoveryLabel, styles.sectionHeaderLabel]}>1K recovery</Text>
                <View style={styles.sectionHeaderChevron}>
                  <Svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={kua ? kua.onSurfaceVariant : colors.textMuted} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" accessible={false}><Path d="M9 5l7 7-7 7" /></Svg>
                </View>
              </Pressable>
              {/* Hidden from screen readers: the announcement below names the week. */}
              {weekName ? (
                <Text testID="home-recovery-week" style={[styles.recoveryWeekLabel, styles.recoveryWeekTag]} accessibilityElementsHidden importantForAccessibility="no">{weekName}</Text>
              ) : null}
            </View>
            <View
              testID="home-recovery-analytics"
              accessible
              accessibilityLabel={accessibleContent}
            >
              {fallbackStatus ? (
                <Text style={styles.recoveryFallbackLine}>{fallbackStatus}</Text>
              ) : null}
              {lifts.length > 0 ? (
                <View testID="home-recovery-big3" style={styles.recoveryLiftList}>
                  {lifts.map(lift => {
                    const scored = lift.state === HOME_BIG3_SCORED;
                    const done = scored && lift.percent >= 100;
                    // Only a real score fills the bar; unscored lifts stay an empty track.
                    const fill = scored ? Math.max(0, Math.min(lift.percent, 100)) : 0;
                    return (
                      <View key={lift.slot} testID={`home-recovery-lift-${lift.slot}`}>
                        <View style={styles.recoveryLiftHead}>
                          <Text style={styles.recoveryLiftName}>{lift.label}</Text>
                          <View style={styles.recoveryLiftValueRow}>
                            {/* A score carried from an earlier week names that week. */}
                            {lift.lastTestedWeek ? (
                              <Text testID={`home-recovery-lift-${lift.slot}-age`} style={styles.recoveryLiftAge}>{`Week ${lift.lastTestedWeek}`}</Text>
                            ) : null}
                            <Text testID={`home-recovery-lift-${lift.slot}-value`} style={[styles.recoveryLiftValue, scored && styles.recoveryLiftScored, done && styles.recoveryLiftDone]}>{liftValue(lift)}</Text>
                          </View>
                        </View>
                        <View style={styles.recoveryLiftTrack}>
                          {fill > 0 ? <View style={[styles.recoveryLiftFill, done && styles.recoveryLiftFillDone, { width: `${fill}%` }]} /> : null}
                        </View>
                      </View>
                    );
                  })}
                </View>
              ) : null}
              {/* #1315: the shared snapshot total, secondary to the Big 3. */}
              {headlineScored ? (
                <View testID="home-recovery-headline">
                  <Text testID="home-recovery-headline-value" style={styles.recoveryTotal}>{headline.headline}</Text>
                </View>
              ) : null}
              {headlineReason ? (
                <Text testID="home-recovery-headline-reason" style={styles.recoveryFallbackLine}>{headlineReason}</Text>
              ) : null}
            </View>
          </>
        ) : (
          <View
            accessible
            accessibilityRole={isLoadingStatus ? 'progressbar' : 'alert'}
            accessibilityLabel={`1K recovery. ${message}`}
          >
            <Text style={styles.recoveryLabel}>1K recovery</Text>
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

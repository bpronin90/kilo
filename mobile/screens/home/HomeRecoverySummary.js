import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { MonoLabel, Panel } from '../../components/ui/RedesignPrimitives';
import { Icon } from '../../components/Icon';
import { useTheme } from '../../theme/ThemeContext';
import { HOME_RECOVERY_STATUS, RECOVERY_COMPARISON_STATUS, RECOVERY_WEEK_STATUS } from './homeDashboardData';
import { recoveryBig3Rows, recoveryBig3Value } from '../../lib/data/recoveryBig3';
import { createStyles } from './homeStyles';
import { useKuaTypography } from '../../theme/typography';
import { Big3Bars } from '../../components/Big3Bars';

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
// #1341: in Recovery this card IS Home's training surface — `Recovery · Week N`,
// the snapshot's total as the hero number, the Big 3 as bars, then the action
// strip (passed in as `actions`). It replaces the normal hero and 1K card, so no
// other card repeats the week. What Home leaves to Analytics is the prose — the
// headline caption, roster counts, week-scope explainer and `Latest week:` wording.
export function HomeRecoverySummary({ summary, onNavigate, actions = null }) {
  const { colors, kuaPalette: kua } = useTheme();
  const typography = useKuaTypography();
  const styles = useMemo(() => createStyles(colors, kua, typography), [colors, kua, typography]);

  if (!summary) return null;
  const {
    status, stale, message, active,
    comparisonStatus, headline = null, weekNumber, weekNoteStatus, big3 = [],
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
  // With no week logged there is nothing to name, and inventing `Week 1` would
  // be false. Staleness is the message below.
  const weekName = weekNumber === null ? null : `Week ${weekNumber}`;

  // One announcement for the whole summary, assembled in reading order.
  const accessibleContent = [
    weekName,
    headlineScored ? headline.headline : null,
    fallbackStatus,
    lifts.length > 0 ? 'Big 3' : null,
    ...lifts.map(lift => lift.spoken || `${lift.label} ${recoveryBig3Value(lift).toLowerCase()}`),
    headlineReason,
  ].filter(Boolean)
    .map(part => (/[.!?]$/.test(part) ? part : `${part}.`))
    .join(' ');

  const liftRows = recoveryBig3Rows(lifts);
  const totalDone = headlineScored && headline.percent >= 100;

  if (!active) {
    return (
      <View testID="home-recovery-summary">
        <Panel>
          <View style={styles.heroPad}>
            <View
              accessible
              accessibilityRole={isLoadingStatus ? 'progressbar' : 'alert'}
              accessibilityLabel={`1K recovery. ${message}`}
              style={styles.recoveryStatusBlock}
            >
              <MonoLabel style={styles.recoveryLabel}>1K recovery</MonoLabel>
              <Text style={styles.recoveryStatusLine}>{message}</Text>
            </View>
            {canRetry ? <RetryRecovery summary={summary} styles={styles} /> : null}
            {actions}
          </View>
        </Panel>
      </View>
    );
  }

  // Redesign v3 (#1605): the active Recovery panel replaces the hero — label
  // and Evidence handoff, the total as the hero number, the Big 3 bars, then
  // the actions.
  return (
    <View testID="home-recovery-summary">
      <Panel active>
        <View style={styles.heroPad}>
          {/* The header is the handoff (#820) to the Recovery section itself (#770). */}
          <Pressable
            testID="home-recovery-link"
            onPress={() => onNavigate('Analytics', 'recovery')}
            style={styles.recoveryHeaderLink}
            accessibilityRole="button"
            accessibilityLabel="Recovery"
            accessibilityHint="Opens the Recovery section of the Analytics tab"
          >
            <MonoLabel style={styles.recoveryHeaderLabel} numberOfLines={1}>
              {weekName ? 'Recovery · ' : 'Recovery'}
              {/* Hidden from screen readers: the announcement below names the week. */}
              {weekName ? <Text testID="home-recovery-week" accessibilityElementsHidden importantForAccessibility="no">{weekName}</Text> : null}
            </MonoLabel>
            <Text style={styles.recoveryEvidence}>Evidence</Text>
            <Icon name="chevron-right" size={18} color={kua ? kua.primaryOnContainer : colors.chipText} />
          </Pressable>
          <View
            testID="home-recovery-analytics"
            accessible
            accessibilityLabel={accessibleContent}
            style={styles.recoveryBody}
          >
            {/* #1341: the snapshot's total is the card's one hero number. */}
            {headlineScored ? (
              <View testID="home-recovery-headline" style={styles.recoveryTotalRow}>
                <Text testID="home-recovery-headline-value" style={[styles.recoveryTotalValue, totalDone && styles.liftValueDone]}>{`${headline.percent}%`}</Text>
                <Text style={styles.recoveryTotalLabel}>total recovery</Text>
              </View>
            ) : null}
            {fallbackStatus ? (
              <Text style={styles.recoveryFallbackLine}>{fallbackStatus}</Text>
            ) : null}
            {liftRows.length > 0 ? (
              <Big3Bars rows={liftRows} idPrefix="home-recovery-lift" testID="home-recovery-big3" />
            ) : null}
            {headlineReason ? (
              <Text testID="home-recovery-headline-reason" style={styles.recoveryFallbackLine}>{headlineReason}</Text>
            ) : null}
          </View>
          {/* The stale case keeps the last-known-good summary above and adds the
              reason it may be behind, rather than replacing it. */}
          {message ? (
            <Text style={styles.recoveryStatusLine} accessibilityLiveRegion="polite">{message}</Text>
          ) : null}
          {canRetry ? <RetryRecovery summary={summary} styles={styles} /> : null}
          {actions}
        </View>
      </Panel>
    </View>
  );
}

// Exactly the name every recovery message tells the user to tap (ui-design-rules §12).
function RetryRecovery({ summary, styles }) {
  return (
    <Pressable
      testID="home-recovery-retry"
      onPress={() => summary.retry()}
      style={styles.recoveryAction}
      accessibilityRole="button"
      accessibilityLabel="Retry recovery"
    >
      <Text style={styles.recoveryActionText}>Retry recovery</Text>
    </Pressable>
  );
}

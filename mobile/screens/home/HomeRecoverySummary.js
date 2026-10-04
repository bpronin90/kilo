import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Card } from '../../components/UI';
import { useTheme } from '../../theme/ThemeContext';
import { InfoButton, InfoNote, useInfoExplainer } from '../../components/InfoExplainer';
import { HOME_BIG3_NOT_IN_BASELINE, HOME_RECOVERY_STATUS, RECOVERY_COMPARISON_STATES, RECOVERY_COMPARISON_STATUS, RECOVERY_WEEK_STATUS } from './homeDashboardData';
import { createStyles } from './homeStyles';
import { formatRecoveryCountLine } from '../../lib/data/derivedAnalytics';
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
// itself, not just the tab that contains it (#770). A control whose label reads
// `Recovery` has to land on Recovery; leaving it unsectioned made it inherit
// whatever position Analytics was last left at, which could be any other
// section entirely.
// #1171: each Big 3 row's right-hand value. Plain words only — no return-band
// names — and a percentage only where #697 produced a real per-lift ratio.
function liftValue(lift) {
  if (lift.state === HOME_BIG3_NOT_IN_BASELINE) return 'Not in baseline';
  if (lift.state === RECOVERY_COMPARISON_STATES.BASELINE_MET) return 'Recovered';
  if (lift.state === RECOVERY_COMPARISON_STATES.NOT_REINTRODUCED) return 'Not started';
  if (lift.state === RECOVERY_COMPARISON_STATES.NOT_COMPARABLE) return "Can't compare";
  return lift.percent === null ? 'In progress' : `${lift.percent}%`;
}

// Label and its info icon on one line, adjacent by gap (never edge-floated).
const WEEK_LABEL_ROW = { flexDirection: 'row', alignItems: 'center', columnGap: 2 };
// Shrinks and wraps within the card so a long stale label never overflows.
const WEEK_LABEL_TEXT = { flexShrink: 1, minWidth: 0 };

export function HomeRecoverySummary({ summary, onNavigate }) {
  const { colors, kuaPalette: kua } = useTheme();
  const typography = useKuaTypography();
  const styles = useMemo(() => createStyles(colors, kua, typography), [colors, kua, typography]);
  const [scopeShown, toggleScope] = useInfoExplainer();

  if (!summary) return null;
  const {
    status, stale, message, active,
    comparisonStatus, weekNumber, weekNoteStatus, big3 = [], counts,
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
  // Big 3 rows when a week was genuinely compared, or a single plain-
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
  const weekLabel = weekNumber === null ? null : `${stale ? 'Last loaded linked week' : 'Latest linked week'}: Week ${weekNumber}`;
  // #1193: the values below describe this one week, never the whole block.
  const weekScope = weekNumber !== null && fallbackStatus === null
    ? `Values describe ${stale ? 'the last loaded' : 'the latest'} linked week (Week ${weekNumber}) only, not the whole block.`
    : null;

  // #1171: the user's Big 3 lead, each against its own baseline. #1242: the
  // count line is the shared roster summary, worded exactly as Analytics and
  // the Recovery detail word it. Nothing prints while a fallback owns the slot.
  const lifts = fallbackStatus === null ? big3 : [];
  const remainingText = fallbackStatus === null ? formatRecoveryCountLine(counts) : null;

  // One announcement for the whole summary, assembled in reading order. The
  // visual hierarchy is a layout device; the spoken version has to carry the
  // same facts as complete sentences.
  const accessibleContent = [
    weekNumber === null ? null : `Week ${weekNumber}`,
    fallbackStatus,
    lifts.length > 0 ? 'Your Big 3 lifts' : null,
    ...lifts.map(lift => {
      const value = liftValue(lift);
      return `${lift.label} ${value.endsWith('%') ? `${value} of baseline` : value.toLowerCase()}`;
    }),
    remainingText ? remainingText.replace(/ · /g, ', ') : null,
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
                <Svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={kua ? kua.onSurfaceVariant : colors.textMuted} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" accessible={false}><Path d="M9 5l7 7-7 7" /></Svg>
              </View>
            </Pressable>
            {/* #1245: the week-scope explainer sits behind the shared info icon
                beside the week label. The label is hidden from screen readers
                because the summary announcement below already names the week. */}
            {weekLabel ? (
              <View style={WEEK_LABEL_ROW}>
                <Text style={[styles.recoveryWeekLabel, WEEK_LABEL_TEXT]} accessibilityElementsHidden importantForAccessibility="no">{weekLabel}</Text>
                {weekScope ? (
                  <InfoButton
                    testID="home-recovery-week-scope-info"
                    expanded={scopeShown}
                    onPress={toggleScope}
                    label="About this week's values"
                  />
                ) : null}
              </View>
            ) : null}
            {weekScope ? (
              <InfoNote shown={scopeShown} testID="home-recovery-week-scope-note">
                <Text testID="home-recovery-week-scope" style={styles.recoveryStatusLine}>{weekScope}</Text>
              </InfoNote>
            ) : null}
            {/* One announcement for the whole summary: separate nodes read as
                unrelated fragments. */}
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
                  <Text style={styles.recoveryWeekLabel}>Your Big 3 lifts</Text>
                  {lifts.map(lift => {
                    const done = lift.state === RECOVERY_COMPARISON_STATES.BASELINE_MET;
                    // Only a real ratio fills the bar; unknowns stay an empty track.
                    const fill = done ? 100 : lift.state === RECOVERY_COMPARISON_STATES.REBUILDING && lift.percent !== null
                      ? Math.max(0, Math.min(lift.percent, 100)) : 0;
                    return (
                      <View key={lift.slot} testID={`home-recovery-lift-${lift.slot}`}>
                        <View style={styles.recoveryLiftHead}>
                          <Text style={styles.recoveryLiftName}>{lift.label}</Text>
                          <Text style={[styles.recoveryLiftValue, done && styles.recoveryLiftDone]}>{liftValue(lift)}</Text>
                        </View>
                        <View style={styles.recoveryLiftTrack}>
                          {fill > 0 ? <View style={[styles.recoveryLiftFill, done && styles.recoveryLiftFillDone, { width: `${fill}%` }]} /> : null}
                        </View>
                      </View>
                    );
                  })}
                </View>
              ) : null}
              {remainingText ? (
                <Text testID="home-recovery-remaining" style={styles.recoveryRemaining}>{remainingText}</Text>
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

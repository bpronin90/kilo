import React from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Card } from '../../components/UI';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';
import { RETURN_BANDS } from '../../lib/data/recoveryReturnBands';
import { HOME_RECOVERY_STATUS, RECOVERY_COMPARISON_STATUS, RECOVERY_WEEK_STATUS } from './homeDashboardData';
import { createStyles } from './homeStyles';

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
// #697 state words used only for the sparse below-4-trained-lifts sentence
// (#1029) — permitted vocabulary (#1023 v2 §8), unchanged from what
// `AnalyticsRecoverySection.js` already shows on each exercise's detail row.
const STATE_LABEL = Object.freeze({
  baseline_met: 'at or above baseline',
  rebuilding: 'rebuilding',
  not_comparable: "can't compare",
  added_during_recovery: 'added during recovery',
});

export function HomeRecoverySummary({ summary, onNavigate }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  if (!summary) return null;
  const {
    status, stale, message, active,
    comparisonStatus, weekNumber, weekNoteStatus,
    bands, trained, rosterSize, trainedExercises, movement,
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

  // #1029: the met-count headline is replaced by per-bucket return-band rows
  // sized against the TRAINED total (never the roster) plus, once available,
  // weekly movement — bands lead in Week 1 without reserving space for
  // movement, and movement gets equal real estate as soon as it exists.
  const hasBands = fallbackStatus === null && !!bands;
  // Below four trained lifts, no bucket bars: one plain sentence naming the
  // lift(s) and their state, with the denominator in the sentence itself.
  const sparse = hasBands && trained > 0 && trained < 4;
  const bandRows = hasBands && !sparse
    ? RETURN_BANDS
        .filter(b => b.id !== 'not_trained_yet')
        .map(b => ({ id: b.id, label: b.label, count: bands[b.id] || 0 }))
        .filter(row => row.count > 0)
    : [];
  const trainedDenominatorCaption = hasBands
    ? `${trained} of ${rosterSize} roster exercises trained`
    : null;
  const sparseSentence = sparse
    ? `${trainedExercises.map(row => `${row.name} (${STATE_LABEL[row.state] || row.state})`).join(', ')} — ${trained} of ${rosterSize} roster exercises trained.`
    : null;

  // #1029 review finding 2: movement is never computed while stale (upstream,
  // in useHomeRecoverySummary), but the "not enough matched lifts" copy must
  // not fall through here either — that would falsely attribute the missing
  // figure to insufficient evidence when the real cause is an unverified/
  // stale snapshot. Nothing is claimed for stale state; the stale message
  // already shown for this card carries the true reason.
  const movementSentence = movement
    ? `Since Week ${movement.anchor_week_number}, on ${movement.matched_size} lifts trained both weeks: ${movement.improved} improved, ${movement.steady} steady, ${movement.fell_back} fell back.`
    : (!stale && hasBands && !fallbackStatus && weekNumber !== null && weekNumber > 1
        ? 'Not enough matched lifts to compare weeks yet.'
        : null);

  // One announcement for the whole summary, assembled in reading order. The
  // visual hierarchy is a layout device; the spoken version has to carry the
  // same facts as complete sentences. The inclusion clause (#820: dropped
  // from Home's visible/spoken content — it stays stated on the Analytics
  // Recovery section, which already reports inclusion per block) is no
  // longer part of this summary.
  const accessibleContent = [
    weekLabel,
    hasBands
      ? (sparse ? sparseSentence : `${trainedDenominatorCaption}. ${bandRows.map(r => `${r.label} ${r.count}`).join(', ')}`)
      : fallbackStatus,
    movementSentence,
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
              {!hasBands ? (
                <Text style={styles.recoveryFallbackLine}>{fallbackStatus}</Text>
              ) : sparse ? (
                // Sparse visual floor (#1029): below four trained lifts, no
                // bucket bars — one plain sentence names the lift(s), their
                // state, and the roster denominator.
                <Text testID="home-recovery-sparse" style={styles.recoveryFallbackLine}>
                  {sparseSentence}
                </Text>
              ) : (
                <View testID="home-recovery-bands" style={styles.recoveryStatsDivider}>
                  {/* `Not trained yet` is a same-tier denominator caption, not
                      a bucket row (#1029 acceptance criterion 1/12). */}
                  <Text style={styles.recoveryHeroCaption}>{trainedDenominatorCaption}</Text>
                  {bandRows.map(row => (
                    <View key={row.id} style={styles.recoveryBandRow}>
                      <Text style={styles.recoveryBandLabel}>{row.label}</Text>
                      <Text style={styles.recoveryBandCount}>{row.count}</Text>
                    </View>
                  ))}
                </View>
              )}
              {/* Movement gets EQUAL real estate to bands once it exists —
                  never dead space reserved for it in Week 1 (#1029). */}
              {movementSentence ? (
                <Text testID="home-recovery-movement" style={styles.recoveryFallbackLine}>
                  {movementSentence}
                </Text>
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

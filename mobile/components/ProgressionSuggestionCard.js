// The explainable progression-suggestion card (#960, stage 3 of #580).
//
// This component RENDERS a suggestion record and nothing more. Every threshold,
// every number, and the whole `explanation` sentence are produced by the pure
// derivation in `lib/data/progressionSuggestions.js` (wired through
// `deriveWorkoutNoteAnalytics`); this file never recomputes any of them. It
// formats the fields it is handed, shows the derivation's own explanation text
// verbatim, and exposes the three user actions the issue allows at this stage:
// dismiss (transient, surface-local), mute (persisted, per exercise), and — for
// a currently muted exercise — unmute.
//
// Applying a suggestion is #961 and deliberately has no control here: nothing
// in this card edits, prefills, or rewrites canonical workout-note text.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from './UI';
import { useThemedStyles } from '../theme/ThemeContext';

// A rendered suggestion instance is its normalized exercise identity plus the
// exact evidence and recommendation the derivation supplied. Transient
// dismissal is keyed on this string, so when the underlying evidence or
// recommendation changes the id changes too and a stale dismissal can no
// longer hide the new suggestion.
export function progressionSuggestionInstanceId(suggestion, exerciseKey) {
  if (!suggestion) return null;
  const key = exerciseKey || suggestion.name || '';
  return [
    key,
    JSON.stringify(suggestion.evidence ?? null),
    JSON.stringify(suggestion.heuristic ?? null),
  ].join('|');
}

// Only a positive, weighted/bodyweight suggestion earns a card. Every other
// record — `kind: 'none'`, the post-deload `re_entry` relabel, a malformed or
// missing record, insufficient history, an active Recovery block — degrades to
// no card at all.
export function isRenderableProgressionSuggestion(suggestion) {
  if (!suggestion || typeof suggestion !== 'object') return false;
  if (suggestion.suggested !== true) return false;
  if (suggestion.kind !== 'double_progression' && suggestion.kind !== 'bodyweight_ceiling') return false;
  if (typeof suggestion.explanation !== 'string' || !suggestion.explanation.trim()) return false;
  return true;
}

function _formatWeight(value) {
  if (value == null || Number.isNaN(value)) return null;
  return Number.isInteger(value) ? String(value) : String(Number(Number(value).toFixed(2)));
}

// Recommendation line built ONLY from `heuristic` numbers the derivation
// already computed. The weighted case has a concrete next target; the
// bodyweight case intentionally proposes no weight, so its guidance is left to
// the derivation's own explanation text below.
function _recommendationText(suggestion) {
  const h = suggestion.heuristic;
  if (!h) return null;
  if (h.action === 'increase_weight' && h.suggested_weight != null) {
    const unit = h.unit || 'lb';
    const sets = h.suggested_sets ?? null;
    const reps = h.suggested_reps ?? null;
    const target = sets != null && reps != null
      ? `${sets}×${reps}`
      : reps != null
        ? `${reps} reps`
        : null;
    return target
      ? `Try ${_formatWeight(h.suggested_weight)} ${unit} for ${target} next time.`
      : `Try ${_formatWeight(h.suggested_weight)} ${unit} next time.`;
  }
  return null;
}

// Evidence chips are pure formatting of values already on `evidence`. No
// comparison, no threshold, no invented range — every number here was decided
// by the derivation.
function _evidenceChips(evidence) {
  if (!evidence || typeof evidence !== 'object') return [];
  const chips = [];
  if (evidence.rep_range && evidence.rep_range.lo != null && evidence.rep_range.hi != null) {
    const sets = evidence.rep_range.sets != null ? `${evidence.rep_range.sets}×` : '';
    chips.push(`Target ${sets}${evidence.rep_range.lo}–${evidence.rep_range.hi}`);
  }
  if (evidence.sessions_compared) {
    chips.push(`Compared ${evidence.sessions_compared} logged sessions`);
  }
  if (evidence.top_weight != null) {
    chips.push(`At ${_formatWeight(evidence.top_weight)} lb`);
  }
  if (Array.isArray(evidence.latest_reps) && evidence.latest_reps.length > 0) {
    chips.push(`Last: ${evidence.latest_reps.join(', ')} reps`);
  }
  if (evidence.is_bodyweight && evidence.latest_best_reps != null) {
    chips.push(`Best set ${evidence.latest_best_reps} reps`);
  }
  if (evidence.kg_entry && evidence.kg_entry.kg_value != null) {
    chips.push(
      evidence.kg_entry.side === 'prior'
        ? `Entered as ${evidence.kg_entry.kg_value} kg last time`
        : `Entered as ${evidence.kg_entry.kg_value} kg`
    );
  }
  if (evidence.skipped_sessions > 0) {
    chips.push('Skipped weeks not counted');
  }
  return chips;
}

export function ProgressionSuggestionCard({
  suggestion,
  surface = 'log',
  muted = false,
  onMute,
  onUnmute,
  onDismiss,
}) {
  const styles = useThemedStyles(createStyles);
  if (!isRenderableProgressionSuggestion(suggestion) && !muted) return null;
  // A muted exercise renders nothing on the consuming surface — the mute
  // control itself lives elsewhere (the card is simply gone). This guard keeps
  // the component honest if a caller ever passes `muted` without filtering.
  if (muted) return null;

  const name = suggestion.name || 'This exercise';
  const recommendation = _recommendationText(suggestion);
  const chips = _evidenceChips(suggestion.evidence);
  const heuristicNote = 'Heuristic suggestion — a conditional prompt from what you logged, not a guaranteed prescription.';

  const a11ySummary = [
    `Progression suggestion for ${name}.`,
    heuristicNote,
    suggestion.explanation,
    recommendation,
  ].filter(Boolean).join(' ');

  return (
    <Card
      style={styles.card}
      // The whole card is one accessible group so a screen reader announces the
      // exercise, the heuristic caveat, the evidence and the recommendation
      // together rather than as loose fragments.
      accessible
      accessibilityLabel={a11ySummary}
      testID={`progression-suggestion-${surface}`}
    >
      <View style={styles.headerRow}>
        <Text style={styles.exerciseName} numberOfLines={2}>{name}</Text>
        <View style={styles.heuristicBadge} accessible accessibilityLabel="Heuristic suggestion, not guaranteed">
          <Text style={styles.heuristicBadgeText}>HEURISTIC</Text>
        </View>
      </View>

      <Text style={styles.heuristicNote}>{heuristicNote}</Text>

      {chips.length > 0 && (
        <View style={styles.chipRow}>
          {chips.map((label) => (
            <View key={label} style={styles.chip}>
              <Text style={styles.chipText}>{label}</Text>
            </View>
          ))}
        </View>
      )}

      <Text style={styles.explanation}>{suggestion.explanation}</Text>

      {recommendation ? (
        <Text style={styles.recommendation}>{recommendation}</Text>
      ) : null}

      <View style={styles.actionRow}>
        <Pressable
          onPress={onDismiss}
          style={styles.actionButton}
          accessibilityRole="button"
          accessibilityLabel={`Dismiss the progression suggestion for ${name}`}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.actionButtonText}>Dismiss</Text>
        </Pressable>
        <Pressable
          onPress={onMute}
          style={styles.actionButton}
          accessibilityRole="button"
          accessibilityState={{ selected: false }}
          accessibilityLabel={`Mute progression suggestions for ${name}`}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.actionButtonText}>Mute this exercise</Text>
        </Pressable>
      </View>
    </Card>
  );
}

// A compact, always-available control to bring a muted exercise back. It is
// rendered by the consuming surface next to (or below) its suggestion list so
// "unmute restores an otherwise-eligible suggestion" has a visible path.
export function MutedProgressionRow({ name, onUnmute }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.mutedRow} testID="progression-suggestion-muted-row">
      <Text style={styles.mutedText} numberOfLines={2}>
        Progression suggestions muted for {name || 'this exercise'}
      </Text>
      <Pressable
        onPress={onUnmute}
        style={styles.actionButton}
        accessibilityRole="button"
        accessibilityState={{ selected: true }}
        accessibilityLabel={`Unmute progression suggestions for ${name || 'this exercise'}`}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.actionButtonText}>Unmute</Text>
      </Pressable>
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  card: {
    gap: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  exerciseName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  heuristicBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: colors.chipBackground,
  },
  heuristicBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: colors.chipText,
  },
  heuristicNote: {
    fontSize: 12,
    fontStyle: 'italic',
    color: colors.textMuted,
    lineHeight: 17,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
  },
  explanation: {
    fontSize: 13,
    color: colors.text,
    lineHeight: 19,
  },
  recommendation: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    lineHeight: 19,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 4,
  },
  actionButton: {
    minHeight: 44,
    justifyContent: 'center',
    flexShrink: 1,
  },
  actionButtonText: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: colors.textMuted,
  },
  mutedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 4,
  },
  mutedText: {
    flex: 1,
    fontSize: 12,
    color: colors.textMuted,
  },
});

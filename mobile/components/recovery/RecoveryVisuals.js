import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { createVisualStyles } from './recoveryVisualStyles';

// THREE visible graded states (#1219): At or above, Rebuilding, Early. The
// merge is PRESENTATION ONLY: `deriveRecoveryWeekBands` still emits its six
// buckets (`close` stays a derived bucket and every other consumer is
// unchanged); every Analytics Recovery surface folds `close` into Rebuilding at
// render time through `gradedCounts`, so a Rebuilding count is always the sum
// and Close is never named or colored.
export const GRADED_BANDS = Object.freeze([
  Object.freeze({ id: 'at_or_above', label: 'At or above' }),
  Object.freeze({ id: 'rebuilding', label: 'Rebuilding' }),
  Object.freeze({ id: 'early', label: 'Early' }),
]);

// Not-graded statuses are plain facts, not judgments. They keep their words,
// share ONE neutral mark (`onSurfaceVariant`) and never enter a colored segment.
export const QUIET_STATUS_LABELS = Object.freeze({
  cannot_compare: "Can't compare",
  not_trained_yet: 'Not trained yet',
  added: 'Added during recovery',
});

// Map any derived band id (six buckets) to its visible id: close -> rebuilding.
import { foldBandId } from '../../lib/data/recoverySnapshot';
export const displayBandId = foldBandId;

// The three graded counts from the six derived buckets; Rebuilding = close +
// rebuilding.
export function gradedCounts(buckets) {
  const b = buckets || {};
  return {
    at_or_above: b.at_or_above || 0,
    rebuilding: (b.close || 0) + (b.rebuilding || 0),
    early: b.early || 0,
  };
}

// Every band color is a MARK paired with visible full-name text, never a hue on
// its own. Under a KUA court palette each graded state resolves through its own
// named per-court/per-mode token (`theme/colors.js` RECOVERY_BAND_TOKENS); the
// not-graded statuses use the existing `onSurfaceVariant` neutral.
const GRADED_KUA_TOKEN = Object.freeze({
  at_or_above: 'recoveryBandAtOrAbove',
  rebuilding: 'recoveryBandRebuilding',
  early: 'recoveryBandEarly',
});

// Legacy (non-KUA) palette fallback, used only when no court palette is
// resolved (isolated renders): *Text variants, not raw `accent`/`caution`.
const GRADED_LEGACY_TOKEN = Object.freeze({
  at_or_above: 'success',
  rebuilding: 'cautionText',
  early: 'error',
});

export function quietColor(colors, kua) {
  return kua ? kua.onSurfaceVariant : colors.textMuted;
}

export function bandColor(bandId, colors, kua) {
  const id = displayBandId(bandId);
  if (!GRADED_KUA_TOKEN[id]) return quietColor(colors, kua);
  return kua ? kua[GRADED_KUA_TOKEN[id]] : colors[GRADED_LEGACY_TOKEN[id]];
}

// One plain-word list of every state count, zeros included: the three graded
// states (Close folded into Rebuilding), then the quiet ones. Shared by the hero
// bar, the roster summary and the weeks strip so the labels cannot drift. `added`
// is optional because the historical series carries no added count; when a
// caller has one (hero bar, summary) it is always named.
function stateCountSentence({ graded, notTrained, cannotCompare, added }) {
  return [
    ...GRADED_BANDS.map(b => `${b.label} ${graded[b.id]}`),
    `${QUIET_STATUS_LABELS.not_trained_yet} ${notTrained}`,
    `${QUIET_STATUS_LABELS.cannot_compare} ${cannotCompare}`,
    ...(added == null ? [] : [`${QUIET_STATUS_LABELS.added} ${added}`]),
  ].join(', ');
}

function useVisual() {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createVisualStyles(colors, kua), [colors, kua]);
  return { colors, kua, styles };
}

// The routine anchors the hero label (#1219): "at or above <routine> baseline".
// The visible name is cut at a sensible length so the label stays on a phone
// line; the complete name always rides on the accessible label.
export const ROUTINE_LABEL_MAX = 24;
// Length and cut are counted in Unicode CODE POINTS (Array.from), never UTF-16
// units, so a surrogate pair (an emoji) is never split into a replacement glyph.
// A cut may still fall inside a multi-code-point grapheme cluster (ZWJ emoji,
// combining accents): Intl.Segmenter is not available on every Hermes build, so
// that is accepted and documented — the full title is in the accessible label.
export function routineLabel(title) {
  const full = (title || '').trim() || 'Untitled Routine';
  const points = Array.from(full);
  const visible = points.length > ROUTINE_LABEL_MAX
    ? `${points.slice(0, ROUTINE_LABEL_MAX - 1).join('').trimEnd()}…`
    : full;
  return { full, visible };
}

// Count tokens (#1219 owner phone review): each count is its own UNSPLITTABLE
// token view ("7 trained", "20 not yet", "5 added"): it does not shrink and its
// text does not wrap, so a count can never break mid-token or overflow on any
// device or font scale. The tokens sit in a plain wrapping row with consistent
// column/row gaps, so they stay on one line when they fit (the owner's 390dp
// data) and flow whole-token onto further lines when they cannot. There are no
// glyph separators — a separator could start or end a wrapped row, and React
// Native gives no per-row information to avoid that — so spacing alone divides
// the tokens. An orphaned last token is therefore possible at narrow widths and
// is deliberately accepted: the layout guarantees "never split, never overflow",
// not "never alone" (an estimate-based balancer could not guarantee either).
function CountTokens({ stats, styles }) {
  return (
    <View testID="recovery-count-tokens" style={styles.rosterTokens}>
      {stats.map(st => (
        <View key={st.text} testID="recovery-count-token" style={styles.rosterStat}>
          <Text style={st.quiet ? styles.rosterNumQuiet : styles.rosterNum}>{st.n}</Text>
          <Text style={styles.rosterLabel}>{st.text}</Text>
        </View>
      ))}
    </View>
  );
}

// The ONE details summary (#1219): a TEXT-LED evidence line — "7 trained · 20 not
// yet · 5 added" — with no bar. The hero above already draws the week's graded
// bar; repeating it here read as a second progress control and added nothing, so
// the collapsed row now carries only what the hero cannot: how the exercise ROWS
// below divide (trained / not yet / can't compare / added). The panel renders
// this single element right under the header whether Exercise details is
// collapsed or expanded, so the two states cannot drift. Short words on screen;
// the full wording, every state with zeros and the most common gap ride on the
// accessible label. Same 13sp tier as the exercise rows.
export function RecoveryRosterSummary({ summary, bands, gap }) {
  const { styles } = useVisual();
  if (!summary || !(summary.total > 0)) return null;
  const c = summary.counts;
  // "trained" / "not yet" / the roster denominator come from the SAME
  // `deriveRecoveryWeekBands` values the hero uses, so hero and summary cannot
  // disagree and an unusable baseline row stays out of the roster. "can't
  // compare" and "added" are separate additive tokens counted from ALL visible
  // rows (see `summarizeDetailRows`); they never feed trained / not yet.
  const rosterSize = bands?.roster_size || 0;
  const trained = bands?.trained || 0;
  const notYet = Math.max(0, rosterSize - trained);
  const buckets = bands?.buckets || null;
  const stats = [
    ...(rosterSize > 0 ? [{ n: String(trained), text: 'trained' }] : []),
    ...(notYet > 0 ? [{ n: String(notYet), text: 'not yet', quiet: true }] : []),
    ...(c.cannot_compare > 0 ? [{ n: String(c.cannot_compare), text: QUIET_STATUS_LABELS.cannot_compare.toLowerCase(), quiet: true }] : []),
    ...(c.added > 0 ? [{ n: String(c.added), text: 'added', quiet: true }] : []),
  ];
  if (stats.length === 0) stats.push({ n: String(summary.total), text: summary.total === 1 ? 'exercise' : 'exercises' });
  const sentences = [];
  if (rosterSize > 0) {
    sentences.push(`Trained this week: ${trained} of ${rosterSize} roster exercises${notYet > 0 ? `, ${notYet} not trained yet` : ''}.`);
  }
  // Every state is announced exactly once, zeros included, in the same order and
  // words as the hero label: the three graded states come from the hero's
  // buckets with Close folded into Rebuilding (the sum); "Not trained yet" is the
  // hero's roster-minus-trained; "Can't compare" and "Added during recovery" come
  // from the all-rows count (can't-compare covers unusable-baseline rows the
  // roster excludes).
  const graded = gradedCounts(buckets);
  sentences.push(`By status: ${stateCountSentence({
    graded, notTrained: notYet, cannotCompare: c.cannot_compare, added: c.added,
  })}.`);
  if (gap) sentences.push(`Most common gap: ${gap}.`);
  const label = sentences.join(' ');
  return (
    <View testID="recovery-roster-summary" style={styles.rosterBlock} accessible accessibilityLabel={label}>
      <CountTokens stats={stats} styles={styles} />
    </View>
  );
}

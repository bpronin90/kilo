import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
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
export function displayBandId(bandId) {
  return bandId === 'close' ? 'rebuilding' : bandId;
}

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

// One plain-word list of every state count, graded first then the quiet ones,
// shared by the hero bar and the weeks strip labels so they cannot drift.
function stateCountSentence(buckets) {
  const g = gradedCounts(buckets);
  return [
    ...GRADED_BANDS.map(b => `${b.label} ${g[b.id]}`),
    `${QUIET_STATUS_LABELS.not_trained_yet} ${buckets.not_trained_yet || 0}`,
    `${QUIET_STATUS_LABELS.cannot_compare} ${buckets.cannot_compare || 0}`,
  ].join(', ');
}

function useVisual() {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createVisualStyles(colors, kua), [colors, kua]);
  return { colors, kua, styles };
}

// Colored segments are the three GRADED states only (merged Rebuilding); a quiet
// status never becomes a segment.
function Segments({ buckets, colors, kua, style }) {
  const counts = gradedCounts(buckets);
  return (
    <View style={style}>
      {GRADED_BANDS.filter(b => counts[b.id] > 0).map(b => (
        <View
          key={b.id}
          testID={`recovery-segment-${b.id}`}
          style={{ flex: counts[b.id], backgroundColor: bandColor(b.id, colors, kua) }}
        />
      ))}
    </View>
  );
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

// Hero: the one dominant element. A big factual number and one plain label;
// the full sentence rides on the accessible label so nothing is lost to
// screen readers. `trained === 0` has no number to show, only the plain fact.
export function RecoveryHero({ weekLabel, atOrAbove, trained, routineTitle }) {
  const { styles } = useVisual();
  const empty = trained === 0;
  const { full, visible } = routineLabel(routineTitle);
  const label = empty
    ? `${weekLabel}: no roster exercises trained yet against ${full} baseline`
    : `${weekLabel}: ${atOrAbove} of ${trained} trained exercises at or above ${full} baseline`;
  return (
    <View testID="recovery-hero" style={styles.hero} accessible accessibilityLabel={label}>
      <Text style={styles.heroWeek}>{weekLabel}</Text>
      {empty ? (
        <>
          <Text style={styles.heroEmpty}>Nothing trained yet</Text>
          <Text style={styles.heroLabel} numberOfLines={2}>{`against ${visible} baseline`}</Text>
        </>
      ) : (
        <>
          <Text style={styles.heroNumber}>{`${atOrAbove} of ${trained}`}</Text>
          <Text style={styles.heroLabel} numberOfLines={2}>{`at or above ${visible} baseline`}</Text>
        </>
      )}
    </View>
  );
}

// Legend items: the graded states present (colored dot) and any quiet status
// present (the shared neutral dot). Names are the same plain words every
// Recovery surface uses.
function BandLegend({ items, colors, kua, styles }) {
  if (items.length === 0) return null;
  return (
    <View style={styles.legend}>
      {items.map(b => (
        <View key={b.id} style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: bandColor(b.id, colors, kua) }]} />
          <Text style={styles.legendText}>{b.label}</Text>
        </View>
      ))}
    </View>
  );
}

const CANNOT_COMPARE_ITEM = Object.freeze({ id: 'cannot_compare', label: QUIET_STATUS_LABELS.cannot_compare });

// Current-week segmented bar: one thin bar sized by the three graded counts
// (Close folded into Rebuilding), with a legend naming only the states present
// ("Can't compare" with the neutral dot, never a segment). The accessible label
// names every state count, zeros included.
export function RecoveryBandBar({ buckets, trained, weekLabel }) {
  const { colors, kua, styles } = useVisual();
  const graded = gradedCounts(buckets);
  const items = [
    ...GRADED_BANDS.filter(b => graded[b.id] > 0),
    ...((buckets.cannot_compare || 0) > 0 ? [CANNOT_COMPARE_ITEM] : []),
  ];
  const label = `${weekLabel} return bands across ${trained} trained exercises: ${stateCountSentence(buckets)}`;
  return (
    <View testID="recovery-bands-rows" style={styles.barBlock} accessible accessibilityLabel={label}>
      <Segments buckets={buckets} colors={colors} kua={kua} style={styles.segmentBar} />
      <BandLegend items={items} colors={colors} kua={kua} styles={styles} />
    </View>
  );
}

// The ONE details summary (#1219): a thin band mini-bar (same buckets, colors
// and order as the hero bar) over "N trained  M not yet". The panel renders this
// single element right under the header whether Exercise details is collapsed
// or expanded, so the two states cannot drift. The visible Gap stat was
// removed (owner could not read it); the full sentence incl. the most common
// gap rides on the accessible label. Same 13sp tier as the exercise rows (800
// number, 600 label).
export function RecoveryRosterSummary({ summary, bands, gap }) {
  const { colors, kua, styles } = useVisual();
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
    ...(notYet > 0 ? [{ n: String(notYet), text: QUIET_STATUS_LABELS.not_trained_yet.toLowerCase(), quiet: true }] : []),
    ...(c.cannot_compare > 0 ? [{ n: String(c.cannot_compare), text: QUIET_STATUS_LABELS.cannot_compare.toLowerCase(), quiet: true }] : []),
    ...(c.added > 0 ? [{ n: String(c.added), text: QUIET_STATUS_LABELS.added.toLowerCase(), quiet: true }] : []),
  ];
  if (stats.length === 0) stats.push({ n: String(summary.total), text: summary.total === 1 ? 'exercise' : 'exercises' });
  const sentences = [];
  if (rosterSize > 0) {
    sentences.push(`Trained this week: ${trained} of ${rosterSize} roster exercises${notYet > 0 ? `, ${notYet} not trained yet` : ''}.`);
  }
  // Each status is announced exactly once: the three graded states come from
  // the hero's buckets with Close folded into Rebuilding (the sum), "Can't
  // compare" from the all-rows count (it covers unusable-baseline rows the
  // roster excludes).
  const graded = gradedCounts(buckets);
  const byStatus = [
    ...(buckets ? GRADED_BANDS.filter(b => graded[b.id] > 0).map(b => `${b.label} ${graded[b.id]}`) : []),
    ...(c.cannot_compare > 0 ? [`Can't compare ${c.cannot_compare}`] : []),
  ];
  if (byStatus.length > 0) sentences.push(`By status: ${byStatus.join(', ')}.`);
  if (gap) sentences.push(`Most common gap: ${gap}.`);
  if (c.added > 0) sentences.push(`${c.added} added during recovery.`);
  if (sentences.length === 0) sentences.push(`${summary.total} exercise${summary.total === 1 ? '' : 's'}.`);
  const label = sentences.join(' ');
  return (
    <View testID="recovery-roster-summary" style={styles.rosterBlock} accessible accessibilityLabel={label}>
      {buckets && trained > 0 && (
        <View testID="recovery-roster-bar">
          <Segments buckets={buckets} colors={colors} kua={kua} style={styles.miniBar} />
        </View>
      )}
      <View style={styles.exNumbers}>
        {stats.map(st => (
          <View key={st.text} style={styles.rosterStat}>
            {st.quiet && <View testID="recovery-quiet-mark" style={[styles.quietDot, { backgroundColor: quietColor(colors, kua) }]} />}
            {st.n != null && <Text style={styles.rosterNum}>{st.n}</Text>}
            <Text style={styles.exStatusText}>{st.text}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// Compact Improved / Steady / Fell back row for a comparable earlier week:
// icon + count + visible label each. No prose; the full sentence is the
// accessible label.
export function RecoveryChangeVisual({ movement }) {
  const { colors, kua, styles } = useVisual();
  const all = [
    { label: 'Improved', icon: 'arrow-upward', count: movement.improved, color: kua ? kua.completion : colors.success },
    { label: 'Steady', icon: 'trending-flat', count: movement.steady, color: kua ? kua.onSurfaceVariant : colors.textMuted },
    { label: 'Fell back', icon: 'arrow-downward', count: movement.fell_back, color: kua ? kua.error : colors.error },
  ];
  // Zero counts are noise: omit them visually (the accessible label still
  // reads every count).
  const cells = all.filter(c => c.count > 0);
  return (
    <View
      testID="recovery-movement"
      style={styles.changeRow}
      accessible
      accessibilityLabel={`Since Week ${movement.anchor_week_number}, on ${movement.matched_size} exercises trained both weeks: ${movement.improved} improved, ${movement.steady} steady, ${movement.fell_back} fell back.`}
    >
      {cells.map(c => (
        <View key={c.label} style={styles.changeCell}>
          <MaterialIcons name={c.icon} size={18} color={c.color} accessible={false} />
          <Text style={styles.changeCount}>{c.count}</Text>
          <Text style={styles.changeLabel}>{c.label}</Text>
        </View>
      ))}
    </View>
  );
}

// Across weeks: one thin horizontal segmented bar per live week, labelled by
// week number. An unreadable week is a dashed, glyphed "No data" bar, distinct
// from a readable week that trained nothing. One shared legend sits directly
// under the bars and names only the bands that appear in them.
export function RecoveryWeeksStrip({ series }) {
  const { colors, kua, styles } = useVisual();
  const live = series.filter(e => e.buckets);
  const items = [
    ...GRADED_BANDS.filter(b => live.some(e => gradedCounts(e.buckets)[b.id] > 0)),
    ...(live.some(e => (e.buckets.cannot_compare || 0) > 0) ? [CANNOT_COMPARE_ITEM] : []),
  ];
  return (
    <View testID="recovery-band-strip" style={styles.weeksStrip}>
      {series.map(entry => {
        const g = entry.buckets ? gradedCounts(entry.buckets) : null;
        const gradedTotal = g ? g.at_or_above + g.rebuilding + g.early : 0;
        const cannot = entry.buckets ? entry.buckets.cannot_compare || 0 : 0;
        const a11yLabel = entry.buckets
          ? `Week ${entry.week_number}: ${stateCountSentence(entry.buckets)}`
          : `Week ${entry.week_number}: no readable evidence`;
        return (
          <View key={entry.week_id} testID={`recovery-band-strip-week-${entry.week_number}`} style={styles.weekRow} accessible accessibilityLabel={a11yLabel}>
            <Text style={styles.weekRowLabel}>{`Week ${entry.week_number}`}</Text>
            {entry.buckets && gradedTotal > 0 ? (
              <Segments buckets={entry.buckets} colors={colors} kua={kua} style={styles.weekBar} />
            ) : entry.buckets && cannot > 0 ? (
              <View style={styles.weekGap}>
                <View style={[styles.legendDot, { backgroundColor: quietColor(colors, kua) }]} />
                <Text style={styles.weekNoteText}>{`${cannot} ${QUIET_STATUS_LABELS.cannot_compare.toLowerCase()}`}</Text>
              </View>
            ) : entry.buckets ? (
              <Text style={styles.weekNoteText}>0 trained</Text>
            ) : (
              <View style={styles.weekGap}>
                <View style={styles.weekGapBar} />
                <MaterialIcons name="help-outline" size={14} color={kua ? kua.onSurfaceVariant : colors.textMuted} accessible={false} />
                <Text style={styles.weekNoteText}>No data</Text>
              </View>
            )}
          </View>
        );
      })}
      <BandLegend items={items} colors={colors} kua={kua} styles={styles} />
    </View>
  );
}

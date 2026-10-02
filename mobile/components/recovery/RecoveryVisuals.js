import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../../theme/ThemeContext';
import { RETURN_BANDS } from '../../lib/data/recoveryReturnBands';
import { createVisualStyles } from './recoveryVisualStyles';

// Trained bands only; `Not trained yet` is a roster fact, not a performance
// band, and lives in the exercise drill-down (#1209).
const TRAINED_BANDS = RETURN_BANDS.filter(b => b.id !== 'not_trained_yet');

// Each band color is a mark color paired with visible full-name text, never a
// hue on its own. *Text variants are used, not raw `accent`/`caution`
// (docs/design-system-map.md "Text vs. mark").
const BAND_COLOR_TOKEN = Object.freeze({
  at_or_above: 'success',
  close: 'accentText',
  rebuilding: 'cautionText',
  early: 'error',
  cannot_compare: 'textMuted',
  not_trained_yet: 'textMuted',
});

// `cautionText` has no KUA equivalent in any palette; the rest map directly.
export function bandColor(bandId, colors, kua) {
  const token = BAND_COLOR_TOKEN[bandId];
  if (!kua) return colors[token];
  switch (token) {
    case 'success':    return kua.completion;
    case 'accentText': return kua.primary;
    case 'error':      return kua.error;
    case 'textMuted':  return kua.onSurfaceVariant;
    default:           return colors[token];
  }
}

function useVisual() {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createVisualStyles(colors, kua), [colors, kua]);
  return { colors, kua, styles };
}

function Segments({ buckets, colors, kua, style }) {
  return (
    <View style={style}>
      {TRAINED_BANDS.filter(b => (buckets[b.id] || 0) > 0).map(b => (
        <View
          key={b.id}
          testID={`recovery-segment-${b.id}`}
          style={{ flex: buckets[b.id], backgroundColor: bandColor(b.id, colors, kua) }}
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

function BandLegend({ bands, colors, kua, styles }) {
  if (bands.length === 0) return null;
  return (
    <View style={styles.legend}>
      {bands.map(b => (
        <View key={b.id} style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: bandColor(b.id, colors, kua) }]} />
          <Text style={styles.legendText}>{b.label}</Text>
        </View>
      ))}
    </View>
  );
}

// Current-week segmented bar: one thin bar sized by trained count, with a
// legend naming only the bands present. The accessible label names all five
// bands (zeros included) so screen readers get the complete picture.
export function RecoveryBandBar({ buckets, trained, weekLabel }) {
  const { colors, kua, styles } = useVisual();
  const populated = TRAINED_BANDS.filter(b => (buckets[b.id] || 0) > 0);
  const label = `${weekLabel} return bands across ${trained} trained exercises: ${TRAINED_BANDS.map(b => `${b.label} ${buckets[b.id] || 0}`).join(', ')}`;
  return (
    <View testID="recovery-bands-rows" style={styles.barBlock} accessible accessibilityLabel={label}>
      <Segments buckets={buckets} colors={colors} kua={kua} style={styles.segmentBar} />
      <BandLegend bands={populated} colors={colors} kua={kua} styles={styles} />
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
    ...(notYet > 0 ? [{ n: String(notYet), text: 'not yet' }] : []),
    ...(c.cannot_compare > 0 ? [{ n: String(c.cannot_compare), text: "can't compare" }] : []),
    ...(c.added > 0 ? [{ n: String(c.added), text: 'added' }] : []),
  ];
  if (stats.length === 0) stats.push({ n: String(summary.total), text: summary.total === 1 ? 'exercise' : 'exercises' });
  const sentences = [];
  if (rosterSize > 0) {
    sentences.push(`Trained this week: ${trained} of ${rosterSize} roster exercises${notYet > 0 ? `, ${notYet} not trained yet` : ''}.`);
  }
  const byStatus = buckets ? TRAINED_BANDS.filter(b => buckets[b.id] > 0).map(b => `${b.label} ${buckets[b.id]}`) : [];
  if (byStatus.length > 0) sentences.push(`By status: ${byStatus.join(', ')}.`);
  if (gap) sentences.push(`Most common gap: ${gap}.`);
  if (c.cannot_compare > 0) sentences.push(`${c.cannot_compare} can't compare.`);
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
  const present = TRAINED_BANDS.filter(b => series.some(e => e.buckets && (e.buckets[b.id] || 0) > 0));
  return (
    <View testID="recovery-band-strip" style={styles.weeksStrip}>
      {series.map(entry => {
        const total = entry.buckets ? TRAINED_BANDS.reduce((n, b) => n + (entry.buckets[b.id] || 0), 0) : 0;
        const a11yLabel = entry.buckets
          ? `Week ${entry.week_number}: ${TRAINED_BANDS.map(b => `${b.label} ${entry.buckets[b.id] || 0}`).join(', ')}`
          : `Week ${entry.week_number}: no readable evidence`;
        return (
          <View key={entry.week_id} testID={`recovery-band-strip-week-${entry.week_number}`} style={styles.weekRow} accessible accessibilityLabel={a11yLabel}>
            <Text style={styles.weekRowLabel}>{`Week ${entry.week_number}`}</Text>
            {entry.buckets && total > 0 ? (
              <Segments buckets={entry.buckets} colors={colors} kua={kua} style={styles.weekBar} />
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
      <BandLegend bands={present} colors={colors} kua={kua} styles={styles} />
    </View>
  );
}

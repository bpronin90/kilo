import React, { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
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

// Current-week segmented bar: bands are sized by trained count, colored, and
// each named in full in the legend below. The accessible label names all five
// bands (zeros included) so screen readers get the complete picture.
export function RecoveryBandBar({ buckets, trained, weekLabel }) {
  const { colors, kua, styles } = useVisual();
  const populated = TRAINED_BANDS.filter(b => (buckets[b.id] || 0) > 0);
  const label = `${weekLabel} return bands across ${trained} trained exercises: ${TRAINED_BANDS.map(b => `${b.label} ${buckets[b.id] || 0}`).join(', ')}`;
  return (
    <View testID="recovery-bands-rows" style={styles.visualBlock} accessible accessibilityLabel={label}>
      <Text style={styles.visualCaption}>{`${trained} trained ${trained === 1 ? 'exercise' : 'exercises'}`}</Text>
      <Segments buckets={buckets} colors={colors} kua={kua} style={styles.segmentBar} />
      <View style={styles.legend}>
        {populated.map(b => (
          <View key={b.id} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: bandColor(b.id, colors, kua) }]} />
            <Text style={styles.legendText}>{`${b.label} ${buckets[b.id]}`}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// Three-part Improved / Steady / Fell back visual for a comparable earlier week.
export function RecoveryChangeVisual({ movement }) {
  const { colors, kua, styles } = useVisual();
  const cells = [
    { label: 'Improved', count: movement.improved, color: kua ? kua.completion : colors.success },
    { label: 'Steady', count: movement.steady, color: kua ? kua.onSurfaceVariant : colors.textMuted },
    { label: 'Fell back', count: movement.fell_back, color: kua ? kua.error : colors.error },
  ];
  return (
    <View
      testID="recovery-movement"
      style={styles.visualBlock}
      accessible
      accessibilityLabel={`Since Week ${movement.anchor_week_number}, on ${movement.matched_size} exercises trained both weeks: ${movement.improved} improved, ${movement.steady} steady, ${movement.fell_back} fell back.`}
    >
      <Text style={styles.visualCaption}>{`Since Week ${movement.anchor_week_number} · ${movement.matched_size} exercises trained both weeks`}</Text>
      <View style={styles.changeRow}>
        {cells.map(c => (
          <View key={c.label} style={styles.changeCell}>
            <View style={[styles.changeMark, { backgroundColor: c.color }]} />
            <Text style={styles.changeCount}>{c.count}</Text>
            <Text style={styles.changeLabel}>{c.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// Across-weeks stacked mini-bars: one column per live week, 100%-stacked by
// band, with one shared named legend. An unreadable week is a dashed, glyphed
// "No data" cell — distinct from a readable week that trained nothing.
export function RecoveryWeeksStrip({ series }) {
  const { colors, kua, styles } = useVisual();
  const present = TRAINED_BANDS.filter(b => series.some(e => e.buckets && (e.buckets[b.id] || 0) > 0));
  return (
    <View style={styles.visualBlock}>
      <Text style={styles.visualCaption}>Across weeks</Text>
      <ScrollView testID="recovery-band-strip" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.weeksStrip}>
        {series.map(entry => {
          const total = entry.buckets ? TRAINED_BANDS.reduce((n, b) => n + (entry.buckets[b.id] || 0), 0) : 0;
          const a11yLabel = entry.buckets
            ? `Week ${entry.week_number}: ${TRAINED_BANDS.map(b => `${b.label} ${entry.buckets[b.id] || 0}`).join(', ')}`
            : `Week ${entry.week_number}: no readable evidence`;
          return (
            <View key={entry.week_id} testID={`recovery-band-strip-week-${entry.week_number}`} style={styles.weekCell} accessible accessibilityLabel={a11yLabel}>
              {entry.buckets && total > 0 ? (
                <Segments buckets={entry.buckets} colors={colors} kua={kua} style={styles.weekStack} />
              ) : entry.buckets ? (
                <View style={styles.weekNote}><Text style={styles.weekNoteText}>0 trained</Text></View>
              ) : (
                <View style={[styles.weekNote, styles.weekNoteGap]}>
                  <MaterialIcons name="help-outline" size={16} color={kua ? kua.onSurfaceVariant : colors.textMuted} accessible={false} />
                  <Text style={styles.weekNoteText}>No data</Text>
                </View>
              )}
              <Text style={styles.weekCellLabel}>{`Week ${entry.week_number}`}</Text>
            </View>
          );
        })}
      </ScrollView>
      <View style={styles.legend}>
        {present.map(b => (
          <View key={b.id} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: bandColor(b.id, colors, kua) }]} />
            <Text style={styles.legendText}>{b.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

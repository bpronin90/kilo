import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { createStyles } from './analyticsRecoveryStyles';

// Week picker sizing (#1219). Chips are sized from the width the picker
// actually has, so up to six weeks sit on ONE row at ordinary phone widths
// instead of wrapping to an orphan row. Every chip stays >= 44dp.
export const WEEK_CHIP_MIN = 44;
export const WEEK_CHIP_MAX = 72;
export const WEEK_CHIP_GAP = 4;
export const WEEK_PICKER_MAX_GRID = 12;
export const WEEK_PICKER_SINGLE_ROW_MAX = 6;
// Beyond this font scale a wrapped grid of chips stops being legible.
export const WEEK_PICKER_LARGE_FONT_SCALE = 1.3;
// Card padding (18 x 2) + screen gutters, used only until the picker measures
// its real width.
const FALLBACK_CHROME = 68;

// Pure layout decision, exported for tests. Order matters:
//   1. scroll - forced for 13+ weeks, a large font scale, or a width too narrow
//               for three chips: a horizontally scrollable strip of fixed chips.
//   2. single - ONE row whenever every chip fits at the 44dp minimum (any
//               count up to 12), sized to the width (cap WEEK_CHIP_MAX).
//   3. scroll - 1-6 weeks that do not fit one row never wrap: strip.
//   4. grid   - 7-12 weeks that do not fit one row: balanced rows whose sizes
//               differ by at most one (never a lone orphan chip).
export function computeWeekPickerLayout({ count, width, fontScale = 1 }) {
  const safeWidth = Math.max(0, Math.floor(width || 0));
  const perRowMax = Math.max(1, Math.floor((safeWidth + WEEK_CHIP_GAP) / (WEEK_CHIP_MIN + WEEK_CHIP_GAP)));
  const scroll = { mode: 'scroll', perRow: count, rows: 1, rowSizes: [count], chipWidth: WEEK_CHIP_MIN + 4 };
  if (count > WEEK_PICKER_MAX_GRID || fontScale >= WEEK_PICKER_LARGE_FONT_SCALE || perRowMax < 3) return scroll;
  if (count <= perRowMax) {
    return { mode: 'single', perRow: count, rows: 1, rowSizes: [count], chipWidth: _chipWidth(safeWidth, count) };
  }
  // Up to six weeks never wrap: no room for one row means the strip.
  if (count <= WEEK_PICKER_SINGLE_ROW_MAX) return scroll;
  const rows = Math.ceil(count / perRowMax);
  const base = Math.floor(count / rows);
  const extra = count % rows;
  const rowSizes = Array.from({ length: rows }, (_, i) => base + (i < extra ? 1 : 0));
  return { mode: 'grid', perRow: rowSizes[0], rows, rowSizes, chipWidth: _chipWidth(safeWidth, rowSizes[0]) };
}

function _chipWidth(width, perRow) {
  const fit = Math.floor((width - WEEK_CHIP_GAP * (perRow - 1)) / perRow);
  return Math.max(WEEK_CHIP_MIN, Math.min(WEEK_CHIP_MAX, fit));
}

function _chunkBySizes(items, sizes) {
  const out = [];
  let i = 0;
  for (const size of sizes) { out.push(items.slice(i, i + size)); i += size; }
  return out;
}

export function WeekPicker({ weeks, selectedWeekId, onSelect }) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStyles(colors, kua), [colors, kua]);
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const [measured, setMeasured] = useState(null);
  const width = measured != null ? measured : Math.max(0, windowWidth - FALLBACK_CHROME);
  const layout = computeWeekPickerLayout({ count: weeks.length, width, fontScale });
  // In strip mode keep the selected chip in view (initial selection is the
  // newest week, which sits at the far end).
  const scrollRef = useRef(null);
  const selectedIndex = weeks.findIndex(w => w.week_id === selectedWeekId);
  useEffect(() => {
    if (layout.mode !== 'scroll' || selectedIndex < 0 || !scrollRef.current || !scrollRef.current.scrollTo) return;
    const pitch = layout.chipWidth + WEEK_CHIP_GAP;
    const x = Math.max(0, selectedIndex * pitch - Math.max(0, (width - layout.chipWidth) / 2));
    scrollRef.current.scrollTo({ x, animated: false });
  }, [layout.mode, layout.chipWidth, selectedIndex, width]);

  const renderChip = (w) => {
    const selected = w.week_id === selectedWeekId;
    return (
      <Pressable
        key={w.week_id}
        testID={`recovery-week-chip-${w.week_number}`}
        onPress={() => onSelect(w.week_id)}
        style={[styles.chip, { width: layout.chipWidth }, selected ? styles.chipSelected : null]}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={`Week ${w.week_number}${w.completed_at ? ', completed' : ''}`}
      >
        <Text style={[styles.chipText, selected ? styles.chipTextSelected : null]}>
          {w.week_number}
        </Text>
      </Pressable>
    );
  };

  return (
    <View
      testID="recovery-week-picker"
      style={styles.chipBlock}
      onLayout={e => {
        const next = Math.floor(e.nativeEvent.layout.width);
        if (next > 0 && next !== measured) setMeasured(next);
      }}
    >
      <Text style={styles.chipRowLabel}>Week</Text>
      {layout.mode === 'scroll' ? (
        <ScrollView
          ref={scrollRef}
          testID="recovery-week-picker-scroll"
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {weeks.map(renderChip)}
        </ScrollView>
      ) : (
        _chunkBySizes(weeks, layout.rowSizes).map((row, i) => (
          <View key={i} testID={`recovery-week-picker-row-${i}`} style={styles.chipRow}>
            {row.map(renderChip)}
          </View>
        ))
      )}
    </View>
  );
}

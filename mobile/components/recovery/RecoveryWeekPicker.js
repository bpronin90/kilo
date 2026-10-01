import React, { useMemo, useState } from 'react';
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
// Beyond this font scale a wrapped grid of chips stops being legible.
export const WEEK_PICKER_LARGE_FONT_SCALE = 1.3;
// Card padding (18 x 2) + screen gutters, used only until the picker measures
// its real width.
const FALLBACK_CHROME = 68;

// Pure layout decision, exported for tests.
//   single  - every chip on one row, sized to fill the width (cap WEEK_CHIP_MAX)
//   grid    - 7..12 weeks as balanced rows (no orphan row), same chip size
//   scroll  - 12+ weeks, large font scale, or a constrained width: a
//             horizontally scrollable strip of fixed-size chips
export function computeWeekPickerLayout({ count, width, fontScale = 1 }) {
  const safeWidth = Math.max(0, Math.floor(width || 0));
  const perRowMax = Math.max(1, Math.floor((safeWidth + WEEK_CHIP_GAP) / (WEEK_CHIP_MIN + WEEK_CHIP_GAP)));
  const constrained = perRowMax < 3;
  const largeFont = fontScale >= WEEK_PICKER_LARGE_FONT_SCALE;
  if (count <= perRowMax && !constrained) {
    return { mode: 'single', perRow: count, rows: 1, chipWidth: _chipWidth(safeWidth, count) };
  }
  if (count > WEEK_PICKER_MAX_GRID || constrained || largeFont) {
    return { mode: 'scroll', perRow: count, rows: 1, chipWidth: WEEK_CHIP_MIN + 4 };
  }
  const rows = Math.ceil(count / perRowMax);
  const perRow = Math.ceil(count / rows);
  return { mode: 'grid', perRow, rows, chipWidth: _chipWidth(safeWidth, perRow) };
}

function _chipWidth(width, perRow) {
  const fit = Math.floor((width - WEEK_CHIP_GAP * (perRow - 1)) / perRow);
  return Math.max(WEEK_CHIP_MIN, Math.min(WEEK_CHIP_MAX, fit));
}

function _chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function WeekPicker({ weeks, selectedWeekId, onSelect }) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStyles(colors, kua), [colors, kua]);
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const [measured, setMeasured] = useState(null);
  const width = measured != null ? measured : Math.max(0, windowWidth - FALLBACK_CHROME);
  const layout = computeWeekPickerLayout({ count: weeks.length, width, fontScale });

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
          testID="recovery-week-picker-scroll"
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {weeks.map(renderChip)}
        </ScrollView>
      ) : (
        _chunk(weeks, layout.perRow).map((row, i) => (
          <View key={i} testID={`recovery-week-picker-row-${i}`} style={styles.chipRow}>
            {row.map(renderChip)}
          </View>
        ))
      )}
    </View>
  );
}

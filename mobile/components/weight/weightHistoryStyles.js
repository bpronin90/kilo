import { StyleSheet } from 'react-native';

// ── Shared history-panel visual system (#411) ─────────────────────────────────
// Goal History (screens/weight/GoalHistoryPanel.js) and Weight History (this
// panel) render as ONE uniform system. Every value below is kept numerically
// identical to the block of the same name in screens/weight/weightStyles.js so
// the two panels' equivalent elements (header row, 3-column [value·value·date]
// grid, trailing control cell, values, dates, labels, and collapsed summary)
// match exactly. The only intended differences between panels are the literal
// label text and semantic outcome colors (End Weight / Success-Missed). These
// constants are duplicated (not imported) because both panels must stay inside
// their Allowed Files.
const HISTORY_COL1_FLEX = 1.35; // primary value, left aligned
const HISTORY_COL2_FLEX = 1.25; // secondary value, center aligned
const HISTORY_COL3_FLEX = 1.5; // date, right aligned
const HISTORY_CONTROL_WIDTH = 56; // trailing control cell (chevron / filter / delete)
const HISTORY_ROW_PAD_V = 12;
const HISTORY_ROW_PAD_H = 16;
const HISTORY_VALUE_SIZE = 20;
const HISTORY_VALUE_WEIGHT = '700';
const HISTORY_DATE_SIZE = 15;
const HISTORY_DATE_WEIGHT = '600';
const HISTORY_LABEL_SIZE = 11;
const HISTORY_LABEL_WEIGHT = '700';
const HISTORY_SUMMARY_SIZE = 15;
const HISTORY_SUMMARY_WEIGHT = '600';
const HISTORY_SUMMARY_EMPHASIS_WEIGHT = '900';
const HISTORY_SUMMARY_COUNT_SIZE = 12;
const HISTORY_SUMMARY_COUNT_WEIGHT = '600';

export const createHistoryPanel = (colors) => StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: HISTORY_ROW_PAD_H,
    paddingRight: 0,
    paddingVertical: 10,
    minHeight: 44,
    backgroundColor: colors.subtleBg,
  },
  headerRowBordered: {
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  headerContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  controlCell: {
    width: HISTORY_CONTROL_WIDTH,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingRight: 12,
    gap: 8,
  },
  controlIconBtn: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlCellRow: {
    width: HISTORY_CONTROL_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  columnLabel: {
    fontSize: HISTORY_LABEL_SIZE,
    fontWeight: HISTORY_LABEL_WEIGHT,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  col1: {
    flex: HISTORY_COL1_FLEX,
    alignItems: 'flex-start',
  },
  col2: {
    flex: HISTORY_COL2_FLEX,
    alignItems: 'center',
  },
  col3: {
    flex: HISTORY_COL3_FLEX,
    alignItems: 'flex-end',
  },
  rowContainer: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  activeRow: {
    backgroundColor: colors.chipBackground,
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  rowMain: {
    flex: 1,
    paddingLeft: HISTORY_ROW_PAD_H,
    paddingRight: 0,
    paddingVertical: HISTORY_ROW_PAD_V,
  },
  rowCells: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  value: {
    fontSize: HISTORY_VALUE_SIZE,
    fontWeight: HISTORY_VALUE_WEIGHT,
    color: colors.text,
  },
  dateValue: {
    fontSize: HISTORY_DATE_SIZE,
    fontWeight: HISTORY_DATE_WEIGHT,
    color: colors.textMuted,
    textAlign: 'right',
  },
  summaryText: {
    flex: 1,
    fontSize: HISTORY_SUMMARY_SIZE,
    fontWeight: HISTORY_SUMMARY_WEIGHT,
    color: colors.textMuted,
  },
  summaryEmphasis: {
    fontWeight: HISTORY_SUMMARY_EMPHASIS_WEIGHT,
    color: colors.text,
  },
  summaryStack: {
    flex: 1,
    flexDirection: 'column',
    justifyContent: 'center',
    gap: 2,
  },
  summaryCount: {
    fontSize: HISTORY_SUMMARY_COUNT_SIZE,
    fontWeight: HISTORY_SUMMARY_COUNT_WEIGHT,
    color: colors.textMuted,
  },
  summaryLatest: {
    fontSize: HISTORY_SUMMARY_SIZE,
    fontWeight: HISTORY_SUMMARY_WEIGHT,
    color: colors.textMuted,
  },
  columnLabelCenter: {
    textAlign: 'center',
  },
  columnLabelRight: {
    textAlign: 'right',
  },
  dateHeaderGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  dateHeaderFilterBtn: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

// Non-shared styles for row interactions, deltas, and the date-range filter
// controls (used by both WeightHistoryList.js and WeightHistoryFilters.js).
export const createStyles = (colors) => StyleSheet.create({
  // The `chipBackground` fill is the whole press feedback. A `View` opacity
  // here would fade the row's own text along with it — at 0.8 the `notable`
  // delta composited to 3.49:1, under AA, even though the unfaded ink clears
  // it at 5.34:1 (#915 review).
  historyRowPressed: {
    backgroundColor: colors.chipBackground,
  },
  dateFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.subtleBg,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  // Keep a selected boundary and its clear affordance together. The filter row
  // may wrap these compact groups at 320dp or with large text, rather than
  // letting a trailing clear target clip inside the card's overflow boundary.
  dateBoundary: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 4,
  },
  dateChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: colors.chipBackground,
  },
  dateChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.chipText,
  },
  dateChipPlaceholder: {
    color: colors.textMuted,
    fontWeight: '600',
  },
  dateRangeSep: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
  },
  dateBoundaryClearBtn: {
    minHeight: 28,
    minWidth: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: colors.chipBackground,
  },
  dateBoundaryClearText: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '700',
  },
  rowDelta: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    textAlign: 'center',
  },
  rowDeltaEmpty: {
    fontSize: 12,
    color: colors.textMuted,
    opacity: 0.4,
    textAlign: 'center',
  },
  deltaNotable: {
    color: colors.cautionText,
  },
  deltaSpike: {
    color: colors.error,
  },
  deltaOutlier: {
    color: colors.error,
    fontWeight: '900',
  },
  rowNote: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  deleteAffordanceText: {
    fontSize: 16,
    color: colors.textMuted,
    opacity: 0.5,
  },
  emptyText: {
    textAlign: 'center',
    color: colors.textMuted,
    paddingVertical: 32,
    fontSize: 15,
  },
  loadMoreRow: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  // Same as `historyRowPressed`: the fill alone carries the press, so the
  // label is not faded below AA (3.40:1 light / 2.86:1 dark at 0.8).
  loadMorePressed: {
    backgroundColor: colors.chipBackground,
  },
  // The press swaps the row to `chipBackground`, so the label takes the chip's
  // accent ink (#923) — `accentText` reads 3.54:1 on that fill in dark mode.
  loadMoreText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.chipAccentText,
  },
});

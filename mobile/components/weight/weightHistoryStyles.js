import { GEOMETRY } from '../../theme/spacing';
import { TYPOGRAPHY, TYPOGRAPHY_FALLBACK } from '../../theme/typography';
import { StyleSheet } from 'react-native';

// Full JetBrains Mono role (family, tracking, tabular-nums); weight is encoded in the family.
const monoRole = (typo, role) => (typo || TYPOGRAPHY_FALLBACK)[role];
// Real bold JetBrains Mono asset for emphasis (no synthetic weight on a SemiBold family).
const monoBold = (typo) => {
  const { fontFamily, fontWeight } = monoRole(typo, 'metric-display');
  return { fontFamily, fontWeight };
};

const muted = (colors, kua) => (kua ? kua.onSurfaceVariant : colors.textMuted);
const hairline = (colors, kua) => (kua ? kua.surfaceBorder : colors.cardBorder);

// Column geometry (Redesign v3, #1601; h.css .hcols/.hrow): a flexible Weight
// column, then fixed Change and Date columns and a 44dp delete control. Kept
// numerically identical to HISTORY_COLUMNS in screens/weight/weightStyles.js so
// Goal History lines up; duplicated because both files stay in their own scope.
const HISTORY_COLUMNS = { col2: 76, col3: 104, control: 44 };

export const createHistoryPanel = (colors, kua = null, typo = null) => StyleSheet.create({
  headerRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingLeft: 16,
    paddingRight: 4,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: GEOMETRY['radius-lg'],
  },
  columnsRow: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 16,
    backgroundColor: kua ? kua.surfaceCardHeader : colors.subtleBg,
    borderTopWidth: 1,
    borderTopColor: hairline(colors, kua),
  },
  columnLabel: {
    ...monoRole(typo, 'label-md'),
    textTransform: 'uppercase',
    color: muted(colors, kua),
  },
  col1: {
    flex: 1,
    minWidth: 0,
  },
  col2: {
    width: HISTORY_COLUMNS.col2,
    alignItems: 'flex-end',
    textAlign: 'right',
  },
  col3: {
    width: HISTORY_COLUMNS.col3,
    alignItems: 'flex-end',
    textAlign: 'right',
  },
  controlCell: {
    width: HISTORY_COLUMNS.control,
  },
  rowContainer: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'stretch',
    borderTopWidth: 1,
    borderTopColor: hairline(colors, kua),
  },
  activeRow: {
    backgroundColor: kua ? kua.primaryContainer : colors.chipBackground,
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 16,
    paddingVertical: 8,
  },
  controlCellRow: {
    width: HISTORY_COLUMNS.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    ...monoRole(typo, 'label-lg'),
    ...monoBold(typo),
    fontSize: 15,
    color: kua ? kua.onSurface : colors.text,
  },
  dateValue: {
    ...monoRole(typo, 'label-md'),
    fontSize: 15,
    lineHeight: 20,
    color: muted(colors, kua),
    textAlign: 'right',
  },
});

// Non-shared styles for row interactions, deltas, and the date-range filter
// controls (used by both WeightHistoryList.js and WeightHistoryFilters.js).
export const createStyles = (colors, kua = null, typo = null) => StyleSheet.create({
  // The `chipBackground` fill is the whole press feedback. A `View` opacity
  // here would fade the row's own text along with it — at 0.8 the `notable`
  // delta composited to 3.49:1, under AA, even though the unfaded ink clears
  // it at 5.34:1 (#915 review).
  historyRowPressed: {
    backgroundColor: kua ? kua.primaryContainer : colors.chipBackground,
  },
  dateFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 12,
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
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: GEOMETRY['radius-lg'],
    borderWidth: 1,
    borderColor: hairline(colors, kua),
  },
  dateChipText: {
    ...monoRole(typo, 'label-lg'),
    fontSize: 13,
    color: kua ? kua.onSurface : colors.text,
  },
  dateChipPlaceholder: {
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    ...(kua ? {} : { fontWeight: '600' }),
  },
  dateRangeSep: {
    ...monoRole(typo, 'label-md'),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  dateBoundaryClearBtn: {
    minHeight: 28,
    minWidth: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: GEOMETRY['radius-xl'],
    backgroundColor: kua ? kua.primaryContainer : colors.chipBackground,
  },
  dateBoundaryClearText: {
    fontSize: TYPOGRAPHY['label-md'].fontSize,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    fontWeight: '700',
  },
  rowDelta: {
    ...monoRole(typo, 'label-md'),
    fontSize: 15,
    lineHeight: 20,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    textAlign: 'right',
  },
  rowDeltaEmpty: {
    ...monoRole(typo, 'label-md'),
    fontSize: 15,
    lineHeight: 20,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    opacity: 0.4,
    textAlign: 'right',
  },
  deltaNotable: {
    color: kua ? kua.warning : colors.cautionText,
  },
  deltaSpike: {
    color: kua ? kua.errorText : colors.error,
  },
  deltaOutlier: {
    color: kua ? kua.errorText : colors.error,
    // Kinetic uses the real bold face; the literal weight would synthesize on the Medium role.
    ...(kua ? monoBold(typo) : { fontWeight: '900' }),
  },
  rowNote: {
    ...(typo || TYPOGRAPHY_FALLBACK)['body-sm'],
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    marginTop: 2,
  },
  deleteAffordanceText: {
    fontSize: TYPOGRAPHY['body-lg'].fontSize,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    opacity: 0.5,
  },
  emptyText: {
    textAlign: 'center',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    paddingVertical: 32,
    fontSize: TYPOGRAPHY['body-md'].fontSize,
    fontWeight: '400',
  },
  loadMoreRow: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: hairline(colors, kua),
  },
  // Same as `historyRowPressed`: the fill alone carries the press, so the
  // label is not faded below AA (3.40:1 light / 2.86:1 dark at 0.8).
  loadMorePressed: {
    backgroundColor: kua ? kua.primaryContainer : colors.chipBackground,
  },
  // The press swaps the row to `primaryContainer`, so the label takes the chip's
  // accent ink (#923) — `primaryOnContainer` reads correctly on that fill.
  loadMoreText: {
    ...monoRole(typo, 'label-lg'),
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.05 * 12,
    color: kua ? kua.primaryOnContainer : colors.chipAccentText,
  },
});

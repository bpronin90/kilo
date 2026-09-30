import { StyleSheet } from 'react-native';

// Styles for the Recovery card's visual summaries (#1209/#1215): hero, thin
// segmented band bar, Improved/Steady/Fell back row, and thin per-week bars. Kept in
// their own module so analyticsRecoveryStyles.js stays under the line cap.
export const createVisualStyles = (colors, kua = null) => {
  const ink = kua ? kua.onSurface : colors.text;
  const inkMuted = kua ? kua.onSurfaceVariant : colors.textMuted;
  const track = kua ? kua.surfaceSection : colors.subtleBg;
  const border = kua ? kua.surfaceBorder : colors.cardBorder;
  return StyleSheet.create({
    hero: { gap: 2 },
    heroWeek: { fontSize: 13, fontWeight: '700', color: inkMuted },
    heroNumber: { fontSize: 40, lineHeight: 46, fontWeight: '800', color: ink },
    heroLabel: { fontSize: 15, fontWeight: '600', color: inkMuted },
    heroEmpty: { fontSize: 20, fontWeight: '800', color: ink },
    barBlock: { gap: 8 },
    segmentBar: {
      flexDirection: 'row',
      height: 10,
      borderRadius: 5,
      overflow: 'hidden',
      backgroundColor: track,
      gap: 2,
    },
    legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 6 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    legendDot: { width: 10, height: 10, borderRadius: 5 },
    legendText: { fontSize: 13, fontWeight: '600', color: ink },
    changeRow: { flexDirection: 'row', columnGap: 12, alignItems: 'center' },
    changeCell: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    changeCount: { fontSize: 15, fontWeight: '800', color: ink },
    changeLabel: { fontSize: 12, fontWeight: '600', color: inkMuted },
    weeksStrip: { gap: 10 },
    weekRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    weekRowLabel: { width: 56, fontSize: 12, fontWeight: '600', color: inkMuted },
    weekBar: {
      flex: 1,
      flexDirection: 'row',
      height: 6,
      borderRadius: 3,
      overflow: 'hidden',
      backgroundColor: track,
      gap: 1,
    },
    weekGap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
    weekGapBar: {
      flex: 1,
      height: 6,
      borderRadius: 3,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: border,
    },
    weekNoteText: { fontSize: 12, fontWeight: '600', color: inkMuted },
  });
};

import { StyleSheet } from 'react-native';

// Styles for the Recovery card's visual summaries (#1209): segmented band bar,
// Improved/Steady/Fell back visual, and across-weeks stacked mini-bars. Kept in
// their own module so analyticsRecoveryStyles.js stays under the line cap.
export const createVisualStyles = (colors, kua = null) => {
  const ink = kua ? kua.onSurface : colors.text;
  const inkMuted = kua ? kua.onSurfaceVariant : colors.textMuted;
  const track = kua ? kua.surfaceSection : colors.subtleBg;
  const border = kua ? kua.surfaceBorder : colors.cardBorder;
  return StyleSheet.create({
    visualBlock: { gap: 8 },
    visualCaption: { fontSize: 13, fontWeight: '700', color: inkMuted },
    segmentBar: {
      flexDirection: 'row',
      height: 16,
      borderRadius: 8,
      overflow: 'hidden',
      backgroundColor: track,
      gap: 2,
    },
    legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 6 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    legendDot: { width: 10, height: 10, borderRadius: 5 },
    legendText: { fontSize: 13, fontWeight: '600', color: ink },
    changeRow: { flexDirection: 'row', gap: 8 },
    changeCell: {
      flex: 1,
      minWidth: 0,
      gap: 2,
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderRadius: 10,
      backgroundColor: track,
      borderWidth: 1,
      borderColor: border,
    },
    changeMark: { height: 4, borderRadius: 2, marginBottom: 4 },
    changeCount: { fontSize: 20, fontWeight: '800', color: ink },
    changeLabel: { fontSize: 12, fontWeight: '700', color: inkMuted },
    weeksStrip: { flexDirection: 'row', gap: 10, paddingRight: 4 },
    weekCell: {
      width: 64,
      gap: 6,
      alignItems: 'center',
      paddingHorizontal: 6,
      paddingVertical: 8,
      borderRadius: 10,
      backgroundColor: track,
      borderWidth: 1,
      borderColor: border,
    },
    weekCellLabel: { fontSize: 12, fontWeight: '700', color: ink },
    weekStack: {
      width: 26,
      height: 64,
      borderRadius: 6,
      overflow: 'hidden',
      flexDirection: 'column-reverse',
      gap: 1,
    },
    weekNote: {
      height: 64,
      width: 40,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
    },
    weekNoteGap: {
      borderRadius: 6,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: border,
    },
    weekNoteText: { fontSize: 11, fontWeight: '600', color: inkMuted, textAlign: 'center' },
  });
};

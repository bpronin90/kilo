import { StyleSheet } from 'react-native';
import { TYPOGRAPHY } from '../../theme/typography';

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
    // #1219: the hero matches the sibling Analytics hero (Weight Trends
    // `weightValueLarge`: KUA metric-display 32/36 on-surface, legacy 36/800
    // accentText); week/label are 13sp supporting captions.
    heroWeek: { fontSize: 13, fontWeight: '600', color: inkMuted },
    heroNumber: kua
      ? { ...TYPOGRAPHY['metric-display-mobile'], fontSize: 32, lineHeight: 36, color: kua.onSurface }
      : { fontSize: 36, fontWeight: '800', color: colors.accentText },
    heroLabel: { fontSize: 13, fontWeight: '600', color: inkMuted },
    heroEmpty: { fontSize: 18, fontWeight: '700', color: ink },
    barBlock: { gap: 8 },
    segmentBar: {
      flexDirection: 'row',
      height: 10,
      borderRadius: 5,
      overflow: 'hidden',
      backgroundColor: track,
      gap: 2,
    },
    // Collapsed Exercise details mini-bar (#1219): thinner than the hero bar.
    miniBar: {
      flexDirection: 'row',
      height: 6,
      borderRadius: 3,
      overflow: 'hidden',
      backgroundColor: track,
      gap: 1,
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
    weekRowLabel: { width: 64, fontSize: 12, fontWeight: '600', color: inkMuted },
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
    // Exercise-details rows (#1219): name + status mark/word, one thin
    // current-vs-baseline bar with its percent, and one numbers line. Same thin
    // bar, band colors and calm weights as the card's summary above.
    exRow: {
      gap: 6,
      paddingVertical: 10,
      borderTopWidth: 1,
      borderTopColor: border,
    },
    // The header wraps (#1219): at large font scales a long name plus the longest
    // status word cannot share a line, so the status drops under the name
    // (dot + word stay together) instead of clipping or crowding the name.
    exHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 2 },
    exName: { flexGrow: 1, flexShrink: 1, fontSize: 15, fontWeight: '700', color: ink },
    exStatus: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
    exStatusDot: { width: 8, height: 8, borderRadius: 4 },
    exStatusText: { fontSize: 13, fontWeight: '600', color: inkMuted },
    exBarRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    exBarTrack: {
      flex: 1,
      minWidth: 48,
      height: 6,
      borderRadius: 3,
      overflow: 'hidden',
      backgroundColor: track,
    },
    exBarFill: { height: '100%', borderRadius: 3 },
    // Names its measure ("Total work 133%"). A shared minimum width keeps every
    // row's bar the same length at ordinary scales (so bars compare at a
    // glance); it still grows with the text at large font scales, and the track
    // keeps a floor width so it can never be squeezed away.
    exPercent: { flexShrink: 0, minWidth: 124, textAlign: 'right', fontSize: 13, fontWeight: '800', color: ink },
    exNumbers: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 2 },
    exNumberText: { fontSize: 13, color: inkMuted },
    rosterBlock: { gap: 6, paddingTop: 2, paddingBottom: 4 },
    rosterStat: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
    rosterNum: { fontSize: 13, fontWeight: '800', color: ink },
    exNote: { fontSize: 13, color: inkMuted },
    weekNoteText: { fontSize: 12, fontWeight: '600', color: inkMuted },
  });
};

import { GEOMETRY } from '../../theme/spacing';
import { StyleSheet } from 'react-native';
import { TYPOGRAPHY } from '../../theme/typography';

// Styles for the Recovery card's exercise-detail rows and roster summary
// (#1209/#1219). The strength view's styles live in recoveryStrengthStyles.js
// (#1305). Kept in their own module so analyticsRecoveryStyles.js stays under the cap.
export const createVisualStyles = (colors, kua = null) => {
  const ink = kua ? kua.onSurface : colors.text;
  const inkMuted = kua ? kua.onSurfaceVariant : colors.textMuted;
  const track = kua ? kua.surfaceSection : colors.subtleBg;
  const border = kua ? kua.surfaceBorder : colors.cardBorder;
  return StyleSheet.create({
    // Exercise-details rows (#1219): name + status mark/word, one thin
    // current-vs-baseline bar with its percent, and one numbers line. Same thin
    // bar, band colors and calm weights as the card's summary above.
    exRow: {
      gap: 4,
      // 44dp floor (ui-design-rules: disclosure rows); text scale still grows it.
      minHeight: 44,
      justifyContent: 'center',
      paddingVertical: 10,
      borderTopWidth: 1,
      borderTopColor: border,
    },
    // The header wraps (#1219): at large font scales a long name plus the longest
    // status word cannot share a line, so the status drops under the name
    // (dot + word stay together) instead of clipping or crowding the name.
    exHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 2 },
    exName: { flexGrow: 1, flexShrink: 1, fontSize: TYPOGRAPHY['body-md'].fontSize, fontWeight: '700', color: ink },
    exStatus: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
    exStatusDot: { width: 8, height: 8, borderRadius: GEOMETRY['radius-full'] },
    exStatusText: { fontSize: TYPOGRAPHY['body-sm'].fontSize, fontWeight: '600', color: inkMuted },
    // The bar line WRAPS (#1219): at large text or a narrow card the measure label
    // ("Total work 1133%") drops under the bar instead of overflowing or being
    // clipped; the track keeps a sane minimum (96) and grows to fill the line.
    exBarRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 4 },
    exBarTrack: {
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 96,
      minWidth: 96,
      height: 6,
      borderRadius: GEOMETRY['radius-xs'],
      overflow: 'hidden',
      backgroundColor: track,
    },
    exBarFill: { height: '100%', borderRadius: GEOMETRY['radius-xs'] },
    // Names its measure ("Total work 133%"). A shared minimum width keeps every
    // row's bar the same length at ordinary scales (so bars compare at a
    // glance); it grows with the text at large font scales, wraps onto its own
    // line when it cannot sit beside the 96dp track, and `maxWidth: '100%'` lets a
    // very long label wrap inside the card rather than overflow it. The number is
    // never truncated (no numberOfLines).
    exPercent: { flexShrink: 0, minWidth: 124, maxWidth: '100%', textAlign: 'right', ...(kua ? TYPOGRAPHY['label-md'] : { fontSize: TYPOGRAPHY['label-md'].fontSize }), color: ink },
    exNumbers: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 2 },
    exNumberText: { ...(kua ? TYPOGRAPHY['label-md'] : { fontSize: TYPOGRAPHY['label-md'].fontSize }), color: inkMuted },
    // Collapsed/expanded evidence line (#1219): text only. The trained count
    // carries the ink; the not-graded counts take the shared neutral so the line
    // has one quiet hierarchy.
    rosterBlock: { paddingBottom: 4 },
    // A plain wrapping row of unsplittable tokens (no glyph separators, so none can
    // start or end a wrapped row): consistent column/row gaps divide the counts.
    rosterTokens: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 2 },
    // A token keeps its whole text and never shrinks while it fits; only a token
    // wider than the card ITSELF may shrink (maxWidth 100% bounds it) so its label
    // wraps as a last resort instead of overflowing.
    rosterStat: { flexDirection: 'row', alignItems: 'baseline', gap: 4, flexShrink: 1, maxWidth: '100%' },
    rosterNum: { flexShrink: 0, ...(kua ? TYPOGRAPHY['label-md'] : { fontSize: TYPOGRAPHY['label-md'].fontSize }), color: ink },
    rosterNumQuiet: { flexShrink: 0, ...(kua ? TYPOGRAPHY['label-md'] : { fontSize: TYPOGRAPHY['label-md'].fontSize }), color: inkMuted },
    rosterLabel: { flexShrink: 1, fontSize: TYPOGRAPHY['body-sm'].fontSize, fontWeight: '600', color: inkMuted },
    exSummary: { flexShrink: 1, maxWidth: '100%', ...TYPOGRAPHY['label-md'], color: inkMuted },
    exDetail: { gap: 6, paddingTop: 4 },
    exLegend: { fontSize: TYPOGRAPHY['body-sm'].fontSize, color: inkMuted, paddingBottom: 8 },
    exNote: { fontSize: TYPOGRAPHY['body-sm'].fontSize, color: inkMuted },
  });
};

import { StyleSheet } from 'react-native';
import { GEOMETRY } from '../../theme/spacing';
import { TYPOGRAPHY } from '../../theme/typography';

// Styles for the strength-relative Recovery view (#1305): summary, the weekly
// trend and the per-lift ladder share one percent scale with a 100% reference
// mark. Bars use the court primary on the section track; the reference uses the
// on-surface ink so it reads in every court and mode. No warning/amber ink.
export const createStrengthStyles = (colors, kua = null) => {
  const ink = kua ? kua.onSurface : colors.text;
  const inkMuted = kua ? kua.onSurfaceVariant : colors.textMuted;
  const track = kua ? kua.surfaceSection : colors.subtleBg;
  const border = kua ? kua.surfaceBorder : colors.cardBorder;
  const fill = kua ? kua.primary : colors.accent;
  const caption = { fontSize: TYPOGRAPHY['body-sm'].fontSize, color: inkMuted };
  const label = { ...(kua ? TYPOGRAPHY['label-md'] : { fontSize: TYPOGRAPHY['label-md'].fontSize }), color: ink };
  return StyleSheet.create({
    summary: { gap: 2 },
    summaryRow: { flexDirection: 'row', alignItems: 'flex-start', columnGap: 2 },
    summaryMain: { flexGrow: 1, flexShrink: 1 },
    week: { fontSize: TYPOGRAPHY['body-sm'].fontSize, fontWeight: '600', color: inkMuted },
    // Same hero tier as the sibling Analytics hero (Weight Trends KUA metric).
    number: kua
      // display exception per #1283 foundation
      ? { ...TYPOGRAPHY['metric-display-mobile'], fontSize: 32, lineHeight: 36, color: kua.onSurface }
      : { fontSize: TYPOGRAPHY['metric-display'].fontSize, fontWeight: '800', color: colors.accentText },
    numberLabel: { fontSize: TYPOGRAPHY['body-sm'].fontSize, fontWeight: '600', color: inkMuted },
    empty: { fontSize: TYPOGRAPHY['headline-sm'].fontSize, fontWeight: '700', color: ink },
    caption,
    section: { gap: 8 },
    sectionTitle: { fontSize: TYPOGRAPHY['body-sm'].fontSize, fontWeight: '700', color: ink },
    scaleNote: caption,
    titleRow: { flexDirection: 'row', alignItems: 'center', columnGap: 2 },
    row: { gap: 4, minHeight: 44, justifyContent: 'center', paddingVertical: 6 },
    rowBordered: { borderTopWidth: 1, borderTopColor: border },
    rowHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 8, rowGap: 2 },
    rowName: { flexGrow: 1, flexShrink: 1, fontSize: TYPOGRAPHY['body-md'].fontSize, fontWeight: '700', color: ink },
    rowValue: { flexShrink: 0, ...label },
    weekRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 4, minHeight: 28 },
    // Selector row (#1307): a >=44dp press target; selection is a surface fill AND
    // bold label, never color alone.
    weekRowPress: { minHeight: 44, paddingHorizontal: 8, borderRadius: GEOMETRY['radius-lg'] },
    weekRowSelected: { backgroundColor: track },
    weekLabelSelected: { fontWeight: '800', color: ink },
    weekLabel: { width: 64, ...label, color: inkMuted },
    weekValue: { flexShrink: 0, minWidth: 48, textAlign: 'right', ...label },
    track: {
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 96,
      minWidth: 96,
      height: 8,
      borderRadius: GEOMETRY['radius-xs'],
      backgroundColor: track,
      overflow: 'hidden',
    },
    fill: { height: '100%', backgroundColor: fill, borderRadius: GEOMETRY['radius-xs'] },
    reference: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: ink },
    gapTrack: {
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 96,
      minWidth: 96,
      height: 8,
      borderRadius: GEOMETRY['radius-xs'],
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: border,
    },
    // The shared track grows along a ROW; a column parent would turn its
    // flexBasis into height (PR #1308 review), so ladder bars sit in this line.
    barLine: { flexDirection: 'row', alignItems: 'center' },
    detail: caption,
    liftSummary: { gap: 4, paddingTop: 2 },
    list: { gap: 4 },
    // One disclosure pattern for every per-exercise list (#1315): a >=44dp
    // header row (title + counted caption + chevron), collapsed by default.
    disc: { borderTopWidth: 1, borderTopColor: border },
    discFirst: { borderTopWidth: 0 },
    discHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 44, paddingVertical: 6 },
    discText: { flexShrink: 1, gap: 2 },
    discTitle: { fontSize: TYPOGRAPHY['body-md'].fontSize, fontWeight: '700', color: ink },
    discBody: { gap: 8, paddingBottom: 8 },
    infoLine: caption,
    // Reason-grouped exercise lists (#1537): a quiet heading, then one indented
    // line per exercise; the lines never truncate and the card grows with them.
    reasonGroup: { gap: 2, paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: border },
    reasonHeading: { fontSize: TYPOGRAPHY['body-sm'].fontSize, fontWeight: '700', color: inkMuted },
    reasonItem: { fontSize: TYPOGRAPHY['body-md'].fontSize, color: ink, paddingVertical: 2 },
  });
};

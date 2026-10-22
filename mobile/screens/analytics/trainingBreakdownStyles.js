import { StyleSheet } from 'react-native';
import { GEOMETRY } from '../../theme/spacing';
import { TYPOGRAPHY } from '../../theme/typography';

// Training breakdown (#1580). Reuses the Analytics card geometry (Weight Trends:
// padding 20, gap 16, Card surface) and the 44dp segmented option the weight
// window toggle uses, so the section reads as one more existing card.
export const createTrainingBreakdownStyles = (colors, kua = null) => {
  const muted = kua ? kua.onSurfaceVariant : colors.textMuted;
  const strong = kua ? kua.onSurface : colors.text;
  return StyleSheet.create({
    section: { gap: 16 },
    card: { padding: 20, gap: 12, backgroundColor: kua ? kua.surfaceCard : colors.panelBackground },
    scope: { fontSize: TYPOGRAPHY['label-sm'].fontSize, fontWeight: '800', color: muted, textTransform: 'uppercase', letterSpacing: 1 },
    paused: { fontSize: TYPOGRAPHY['body-sm'].fontSize, fontWeight: '700', color: muted },
    viewToggle: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
    viewOption: { minHeight: 44, minWidth: 44, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center', borderRadius: GEOMETRY['radius-lg'] },
    viewOptionSelected: { backgroundColor: kua ? kua.surfaceSection : colors.subtleBg },
    viewOptionText: { fontSize: TYPOGRAPHY['body-sm'].fontSize, fontWeight: '700', color: muted },
    viewOptionTextSelected: { color: kua ? kua.primary : colors.accentText },
    listTitle: { fontSize: TYPOGRAPHY['label-sm'].fontSize, fontWeight: '800', color: muted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 },
    row: { gap: 2, paddingVertical: 8 },
    rowBorder: { borderTopWidth: 1, borderTopColor: kua ? kua.surfaceBorder : colors.divider },
    rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', columnGap: 12 },
    rowLabel: { flex: 1, flexShrink: 1, fontSize: TYPOGRAPHY['body-md'].fontSize, fontWeight: '700', color: strong },
    rowLabelMuted: { color: muted },
    rowCount: { fontSize: TYPOGRAPHY['body-md'].fontSize, fontWeight: '800', color: strong },
    rowNames: { fontSize: TYPOGRAPHY['body-sm'].fontSize, color: muted, lineHeight: 18 },
    note: { fontSize: TYPOGRAPHY['body-sm'].fontSize, color: muted, lineHeight: 19 },
    coverage: { fontSize: TYPOGRAPHY['body-sm'].fontSize, fontWeight: '700', color: muted },
    showAll: { minHeight: 44, justifyContent: 'center' },
    showAllText: { fontSize: TYPOGRAPHY['body-sm'].fontSize, fontWeight: '700', color: kua ? kua.primary : colors.accentText },
    placeholder: { minHeight: 96, justifyContent: 'center', alignItems: 'center', gap: 6 },
    placeholderText: { fontSize: TYPOGRAPHY['body-sm'].fontSize, color: muted, textAlign: 'center' },
  });
};

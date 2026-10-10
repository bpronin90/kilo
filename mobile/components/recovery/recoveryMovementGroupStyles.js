import { StyleSheet } from 'react-native';
import { TYPOGRAPHY } from '../../theme/typography';
import { GEOMETRY } from '../../theme/spacing';

// Movement-group breakdown + per-exercise group editor (#1306). Flat rows on the
// card surface, divided by hairlines; no nested cards, no second hero. Every
// control keeps a >=44dp box. Selected state is the radio glyph plus bold text,
// never color alone. Court tokens only (kuaPalette or the classic palette).
export const createMovementGroupStyles = (colors, kua = null) => {
  const ink = kua ? kua.onSurface : colors.text;
  const inkMuted = kua ? kua.onSurfaceVariant : colors.textMuted;
  const border = kua ? kua.surfaceBorder : colors.cardBorder;
  const accent = kua ? kua.primary : colors.accentText;
  const caption = { fontSize: TYPOGRAPHY['body-sm'].fontSize, color: inkMuted };
  const label = { fontSize: TYPOGRAPHY['label-md'].fontSize, fontWeight: '700', color: ink };
  return StyleSheet.create({
    panel: { gap: 4 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 44 },
    headerText: { flexShrink: 1, gap: 2 },
    title: { fontSize: TYPOGRAPHY['body-sm'].fontSize, fontWeight: '700', color: ink },
    caption,
    notice: { ...caption, paddingBottom: 4 },
    groupRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingVertical: 6, borderTopWidth: 1, borderTopColor: border },
    groupMain: { flexShrink: 1, gap: 2 },
    groupName: { fontSize: TYPOGRAPHY['body-md'].fontSize, fontWeight: '700', color: ink },
    groupValue: { flexShrink: 0, ...label },
    groupValueEmpty: { flexShrink: 0, ...caption },
    exerciseList: { paddingLeft: 12, gap: 2, paddingBottom: 6 },
    exercise: { gap: 2, paddingVertical: 4 },
    exerciseHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 2, minHeight: 28 },
    exerciseName: { flexGrow: 1, flexShrink: 1, fontSize: TYPOGRAPHY['body-md'].fontSize, color: ink },
    exerciseMeta: caption,
    // ── editor (separate control surface; relocatable) ──────────────────────
    changeButton: { minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: 8 },
    changeButtonText: { fontSize: TYPOGRAPHY['body-sm'].fontSize, fontWeight: '700', color: accent },
    disabledText: { opacity: 0.5 },
    editor: { gap: 2, paddingVertical: 4, borderTopWidth: 1, borderTopColor: border },
    scope: caption,
    option: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
    optionText: { flexShrink: 1, fontSize: TYPOGRAPHY['body-md'].fontSize, color: ink },
    optionTextSelected: { fontWeight: '700' },
    resetText: { fontSize: TYPOGRAPHY['body-md'].fontSize, fontWeight: '700', color: accent, flexShrink: 1 },
    errorText: { fontSize: TYPOGRAPHY['label-md'].fontSize, color: kua ? kua.error : colors.error },
    radius: { borderRadius: GEOMETRY['radius-xs'] },
  });
};

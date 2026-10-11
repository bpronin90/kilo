import { StyleSheet } from 'react-native';
import { TYPOGRAPHY } from '../../theme/typography';

// Analytics `Manage block` panel chrome (#1307): a sibling card (not nested in
// the evidence card) mirroring Log's Manage block trigger and list. Rows are flat
// and divided by hairlines; every trigger keeps a >=44dp box. Court tokens only.
export const createManageBlockStyles = (colors, kua = null) => {
  const ink = kua ? kua.onSurface : colors.text;
  const inkMuted = kua ? kua.onSurfaceVariant : colors.textMuted;
  const border = kua ? kua.surfaceBorder : colors.cardBorder;
  return StyleSheet.create({
    card: { padding: 0, overflow: 'hidden', gap: 0 },
    trigger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, paddingHorizontal: 18, paddingVertical: 12 },
    triggerText: { fontSize: TYPOGRAPHY['body-lg'].fontSize, fontWeight: '800', color: ink },
    list: { borderTopWidth: 1, borderTopColor: border },
    row: { paddingHorizontal: 18, paddingVertical: 8, gap: 4 },
    rowDivider: { borderTopWidth: 1, borderTopColor: border },
    lockedNote: { paddingHorizontal: 18, paddingVertical: 10, fontSize: TYPOGRAPHY['body-sm'].fontSize, color: inkMuted },
    groupsTrigger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 44 },
    groupsTitle: { flexShrink: 1, fontSize: TYPOGRAPHY['body-md'].fontSize, fontWeight: '700', color: ink },
    groupsCaption: { fontSize: TYPOGRAPHY['body-sm'].fontSize, color: inkMuted },
  });
};

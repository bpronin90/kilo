import { StyleSheet } from 'react-native';
import { GEOMETRY } from '../../theme/spacing';
import { TYPOGRAPHY } from '../../theme/typography';

// Log Manage block extras (#1315): the maintenance rows relocated from Analytics
// (flat rows divided by hairlines inside the one Manage card), the locked/stale
// note, and the Recovery History selector. Every target keeps a >=44dp box.
export const createLogManageStyles = (colors, kua = null) => {
  const ink = kua ? kua.onSurface : colors.text;
  const inkMuted = kua ? kua.onSurfaceVariant : colors.textMuted;
  const border = kua ? kua.surfaceBorder : colors.cardBorder;
  return StyleSheet.create({
    row: { paddingHorizontal: 18, paddingVertical: 8, gap: 4 },
    rowDivider: { borderBottomWidth: 1, borderBottomColor: border },
    lockedNote: { paddingHorizontal: 18, paddingVertical: 10, fontSize: TYPOGRAPHY['body-sm'].fontSize, color: inkMuted },
    groupsTrigger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 44 },
    groupsTitle: { flexShrink: 1, fontSize: TYPOGRAPHY['body-md'].fontSize, fontWeight: '700', color: ink },
    groupsCaption: { fontSize: TYPOGRAPHY['body-sm'].fontSize, color: inkMuted },
    hidden: { display: 'none' },
    unavailable: { padding: 12, borderRadius: GEOMETRY['radius-lg'], borderWidth: 1, borderColor: border },
    unavailableText: { fontSize: TYPOGRAPHY['body-sm'].fontSize, fontWeight: '600', color: ink },
    historyPanel: { borderRadius: GEOMETRY['radius-2xl'], borderWidth: 1, borderColor: border, overflow: 'hidden' },
    historyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 48, paddingHorizontal: 18, paddingVertical: 10 },
    historyTitle: { fontSize: TYPOGRAPHY['body-md'].fontSize, fontWeight: '700', color: ink },
    historyCaption: { fontSize: TYPOGRAPHY['body-sm'].fontSize, color: inkMuted },
    historyRow: { minHeight: 48, paddingHorizontal: 18, paddingVertical: 8, gap: 2, borderTopWidth: 1, borderTopColor: border },
    historyRowSelected: { backgroundColor: kua ? kua.surfaceSection : colors.subtleBg },
    historyRowTitle: { fontSize: TYPOGRAPHY['body-md'].fontSize, fontWeight: '700', color: ink },
    historyRowMeta: { fontSize: TYPOGRAPHY['body-sm'].fontSize, color: inkMuted },
  });
};

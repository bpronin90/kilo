import { GEOMETRY } from '../../theme/spacing';
import { TYPOGRAPHY, TYPOGRAPHY_FALLBACK } from '../../theme/typography';
import { StyleSheet } from 'react-native';

// Full JetBrains Mono role (family, tracking, tabular-nums); weight is encoded in the family.
const monoRole = (typo, role) => (typo || TYPOGRAPHY_FALLBACK)[role];
// Space Grotesk role (family, size, line height) from the same typography source.
const sgRole = (typo, role) => (typo || TYPOGRAPHY_FALLBACK)[role];
// Real bold JetBrains Mono asset for emphasis (no synthetic weight on a SemiBold family).
const monoBold = (typo) => {
  const { fontFamily, fontWeight } = monoRole(typo, 'metric-display');
  return { fontFamily, fontWeight };
};

const muted = (colors, kua) => (kua ? kua.onSurfaceVariant : colors.textMuted);
const ink = (colors, kua) => (kua ? kua.onSurface : colors.text);
const hairline = (colors, kua) => (kua ? kua.surfaceBorder : colors.cardBorder);

// Shared column geometry for the Weight History and Goal History tables
// (Redesign v3, #1601): [value · value · date] plus a 44dp trailing control.
// Duplicated in components/weight/weightHistoryStyles.js (both panels must stay
// in their own Allowed Files), so keep the two blocks numerically identical.
export const HISTORY_COLUMNS = { col2: 76, col3: 104, control: 44 };

// Base styles for the Weight screen (Redesign v3, #1601): the Log weigh-in
// panel, the Latest panel, banners, the first-paint skeleton and the Goal
// history disclosure. Values follow docs/design/app-redesign-v3 (h.css .qe,
// .wnow, .avgs): 52dp entry controls, a 44px hero, 17px mono averages.
export const createStyles = (colors, kua = null, typo = null) => StyleSheet.create({
  stack: {
    gap: 16,
  },
  skeletonCard: {
    backgroundColor: kua ? kua.surfaceCard : colors.card,
    borderRadius: GEOMETRY['radius-2xl'],
    borderWidth: 1,
    borderColor: hairline(colors, kua),
    padding: 18,
    gap: 12,
  },
  skeletonBar: {
    backgroundColor: hairline(colors, kua),
    borderRadius: GEOMETRY['radius-md'],
    opacity: 0.6,
    height: 12,
  },
  skeletonBarShort: {
    width: '35%',
  },
  skeletonBarFull: {
    width: '100%',
  },
  skeletonBarWide: {
    width: '75%',
  },
  errorText: {
    color: kua ? kua.errorText : colors.error,
    ...sgRole(typo, 'body-md'),
    paddingHorizontal: 16,
  },
  // ── Log weigh-in panel ──
  panelHeader: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 16,
    paddingRight: 8,
    gap: 8,
  },
  editingTitle: {
    ...monoRole(typo, 'label-md'),
    color: kua ? kua.primary : colors.accentText,
    textTransform: 'uppercase',
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
  entryInputBox: {
    flex: 1,
    minWidth: 0,
    height: 52,
    borderWidth: 1,
    borderColor: hairline(colors, kua),
    borderRadius: GEOMETRY['radius-lg'],
    backgroundColor: kua ? kua.background : colors.inputBackground,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 4,
  },
  entryInput: {
    flex: 1,
    minWidth: 0,
    height: 50,
    ...monoRole(typo, 'metric-display-mobile'),
    fontSize: 22,
    lineHeight: 26,
    letterSpacing: 0,
    color: ink(colors, kua),
    paddingVertical: 0,
  },
  unitText: {
    ...monoRole(typo, 'label-lg'),
    color: muted(colors, kua),
  },
  dateButton: {
    height: 52,
    minWidth: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: hairline(colors, kua),
    borderRadius: GEOMETRY['radius-lg'],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  dateButtonText: {
    ...monoRole(typo, 'label-lg'),
    color: ink(colors, kua),
  },
  saveButton: {
    height: 48,
    minWidth: 44,
    paddingHorizontal: 16,
    borderRadius: GEOMETRY['radius-lg'],
    backgroundColor: kua ? kua.primary : colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonDisabled: {
    backgroundColor: kua ? kua.surfaceCardHeader : colors.subtleBg,
  },
  saveButtonText: {
    ...monoRole(typo, 'label-lg'),
    textTransform: 'uppercase',
    letterSpacing: 0.06 * 14,
    color: kua ? kua.onPrimary : colors.textLight,
  },
  saveButtonTextDisabled: {
    color: muted(colors, kua),
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
  noteInput: {
    flex: 1,
    minHeight: 44,
    ...monoRole(typo, 'label-md'),
    fontSize: 13,
    color: ink(colors, kua),
    paddingVertical: 0,
  },
  // ── Latest panel ──
  latestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  latestMain: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  heroValue: {
    ...monoRole(typo, 'metric-display'),
    fontSize: 44,
    lineHeight: 48,
    letterSpacing: -0.03 * 44,
    color: ink(colors, kua),
  },
  heroUnit: {
    ...monoRole(typo, 'label-lg'),
    color: muted(colors, kua),
    marginLeft: 3,
  },
  deltaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  delta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
  },
  deltaText: {
    ...monoRole(typo, 'label-md'),
    fontSize: 13,
    lineHeight: 18,
    color: ink(colors, kua),
  },
  caption: {
    ...sgRole(typo, 'body-sm'),
    color: muted(colors, kua),
  },
  avgs: {
    gap: 8,
    paddingLeft: 14,
    borderLeftWidth: 1,
    borderLeftColor: hairline(colors, kua),
  },
  avgItem: {
    gap: 1,
  },
  avgLabel: {
    ...monoRole(typo, 'label-md'),
    textTransform: 'uppercase',
    color: muted(colors, kua),
  },
  avgValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  avgValue: {
    ...monoRole(typo, 'label-lg'),
    fontSize: 17,
    lineHeight: 22,
    color: ink(colors, kua),
  },
  // ── Banners ──
  errorBanner: {
    backgroundColor: kua ? kua.surfaceCard : colors.errorSurface,
    borderRadius: GEOMETRY['radius-xl'],
    borderWidth: 1,
    borderColor: kua ? kua.error : colors.error,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  errorBannerText: {
    flex: 1,
    fontSize: TYPOGRAPHY['body-md'].fontSize,
    fontWeight: '600',
    color: kua ? kua.error : colors.error,
  },
  errorBannerRetry: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: GEOMETRY['radius-lg'],
    backgroundColor: kua ? kua.error : colors.cardErrorBg,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBannerRetryText: {
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
    fontWeight: '700',
    color: colors.textLight,
  },
  // ── Goal history disclosure ──
  // Semantic End Weight / latest-outcome colors.
  archivedValueMet: {
    color: kua ? kua.success : colors.success,
  },
  archivedValueMissed: {
    color: kua ? kua.errorText : colors.error,
  },
  disclosureRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 16,
    paddingRight: 12,
    paddingVertical: 10,
  },
  disclosurePressed: {
    backgroundColor: kua ? kua.surfaceCardHeader : colors.chipBackground,
  },
  disclosureText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  disclosureTitle: {
    ...sgRole(typo, 'body-md'),
    color: muted(colors, kua),
  },
  disclosureSummary: {
    ...monoRole(typo, 'label-lg'),
    color: muted(colors, kua),
  },
  disclosureEmphasis: {
    ...monoBold(typo),
    color: ink(colors, kua),
  },
});

// Goal History table (#411 lineage): the same column grid as Weight History.
export const createHistoryPanel = (colors, kua = null, typo = null) => StyleSheet.create({
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
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 16,
    borderTopWidth: 1,
    borderTopColor: hairline(colors, kua),
  },
  col1: {
    flex: 1,
    minWidth: 0,
  },
  col2: {
    width: HISTORY_COLUMNS.col2,
    textAlign: 'right',
  },
  col3: {
    width: HISTORY_COLUMNS.col3,
    textAlign: 'right',
  },
  control: {
    width: HISTORY_COLUMNS.control,
  },
  // Value and date typography match Weight History's (weightHistoryStyles
  // createHistoryPanel) so both tables read as one system.
  value: {
    ...monoRole(typo, 'label-lg'),
    ...monoBold(typo),
    fontSize: 15,
    color: ink(colors, kua),
  },
  dateValue: {
    ...monoRole(typo, 'label-md'),
    fontSize: 15,
    lineHeight: 20,
    color: muted(colors, kua),
  },
});

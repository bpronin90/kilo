import { StyleSheet } from 'react-native';
import { GEOMETRY, SPACING } from '../../theme/spacing';
import { TYPOGRAPHY } from '../../theme/typography';
import { resolveBreakdownPalette } from '../../components/trainingBreakdown/breakdownPalette';

// Training breakdown dashboard (#1588). Colours resolve through the selected
// court's KUA palette (`kua`), falling back to the legacy palette, via
// components/trainingBreakdown/breakdownPalette. Geometry follows the Analytics
// cards (radius-2xl surfaces, 12–16 gaps); every interactive control keeps a 44dp
// minimum target. Values are always printed, so colour never carries meaning alone.
const T = TYPOGRAPHY;
export const createTrainingBreakdownStyles = (colors, kua = null, mode = 'light') => {
  const p = resolveBreakdownPalette(colors, kua, mode);
  return StyleSheet.create({
  section: { gap: SPACING['space-md'] },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', columnGap: 12, rowGap: 8 },
  paused: { ...T['body-sm'], fontWeight: '700', color: p.muted },
  // Range selector
  range: { flexDirection: 'row', marginLeft: 'auto', backgroundColor: p.section, borderWidth: 1, borderColor: p.border, borderRadius: GEOMETRY['radius-xl'], padding: 1 },
  rangeOption: { minHeight: 44, minWidth: 44, paddingHorizontal: 6, justifyContent: 'center', alignItems: 'center', borderRadius: GEOMETRY['radius-lg'] },
  rangeOptionOn: { backgroundColor: p.container, borderWidth: 1, borderColor: p.containerBorder },
  rangeText: { ...T['label-md'], color: p.muted },
  rangeTextOn: { color: p.onContainer },
  // Metrics header
  hero: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 },
  heroMain: { flexShrink: 1 },
  heroValue: { ...T['metric-display'], fontSize: 44, lineHeight: 48, color: p.ink },
  heroLabel: { ...T['body-sm'], color: p.muted, marginTop: 2 },
  stats: { flexDirection: 'row', gap: 8, flexShrink: 1 },
  stat: { minHeight: 56, minWidth: 76, paddingHorizontal: 10, paddingVertical: 8, justifyContent: 'center', borderRadius: GEOMETRY['radius-xl'], borderWidth: 1, borderColor: p.border, backgroundColor: p.card },
  statValue: { ...T['label-lg'], fontSize: 17, lineHeight: 22, color: p.ink },
  statLabel: { ...T['body-sm'], fontSize: 12, lineHeight: 16, color: p.muted },
  chevron: { color: p.onContainer },
  // Tabs
  tabs: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: p.border, columnGap: 18 },
  tab: { minHeight: 44, justifyContent: 'center', borderBottomWidth: 3, borderBottomColor: 'transparent', marginBottom: -1 },
  tabOn: { borderBottomColor: p.primary },
  tabText: { ...T['body-md'], fontSize: 15, fontWeight: '600', color: p.muted },
  tabTextOn: { color: p.ink },
  info: { marginLeft: 'auto', width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  infoRing: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: p.border, alignItems: 'center', justifyContent: 'center' },
  infoText: { ...T['label-md'], color: p.muted },
  // Cards
  card: { padding: 14, gap: 10, backgroundColor: p.card, borderColor: p.border },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', columnGap: 8, rowGap: 4 },
  cardTitle: { ...T['body-md'], fontWeight: '700', color: p.ink },
  cardHint: { ...T['body-sm'], fontSize: 12, color: p.muted },
  // Comparison
  cmp: { gap: 5 },
  cmpLabels: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  cmpLabel: { ...T['body-sm'], color: p.muted, flexShrink: 1 },
  cmpCount: { ...T['label-lg'], color: p.ink },
  cmpTrack: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2, backgroundColor: p.section },
  cmpPct: { ...T['label-sm'], color: p.muted },
  // Movement tiles
  tileRow: { flexDirection: 'row', gap: 6 },
  tile: { flex: 1, minHeight: 66, borderRadius: GEOMETRY['radius-xl'], padding: 10, justifyContent: 'space-between', gap: 6 },
  tileLabel: { ...T['body-sm'], fontSize: 12.5, lineHeight: 16, fontWeight: '700' },
  tileValueRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 4 },
  tileValue: { ...T['metric-display-mobile'], fontSize: 22, lineHeight: 26 },
  tilePct: { ...T['label-sm'], opacity: 0.8 },
  more: { minHeight: 44, borderRadius: GEOMETRY['radius-xl'], borderWidth: 1, borderStyle: 'dashed', borderColor: p.containerBorder, backgroundColor: p.section, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', columnGap: 8, paddingHorizontal: 10, paddingVertical: 8 },
  moreText: { ...T['body-sm'], color: p.muted },
  link: { ...T['body-sm'], fontWeight: '700', color: p.onContainer },
  foot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', columnGap: 8, rowGap: 4 },
  footText: { ...T['body-sm'], fontSize: 12, color: p.muted, flexShrink: 1 },
  footStrong: { color: p.ink, fontWeight: '700' },
  footButton: { minHeight: 44, justifyContent: 'center', flexShrink: 1 },
  // Muscles
  regions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  region: { flexBasis: '48%', flexGrow: 1, minHeight: 84, borderRadius: GEOMETRY['radius-xl'], paddingHorizontal: 11, paddingVertical: 10, gap: 6 },
  regionTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 },
  regionLabel: { ...T['body-md'], fontWeight: '700', flexShrink: 1 },
  regionTopMuscle: { ...T['body-sm'], fontSize: 12, lineHeight: 16, opacity: 0.85 },
  cells: { flexDirection: 'row', gap: 3, marginTop: 'auto' },
  cell: { flex: 1, height: 6, borderRadius: 2 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendSteps: { flex: 1, flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden' },
  pill: { borderRadius: 99, borderWidth: 1, borderColor: p.containerBorder, backgroundColor: p.container, paddingHorizontal: 10, paddingVertical: 3 },
  pillText: { ...T['body-sm'], fontSize: 12, fontWeight: '700', color: p.onContainer },
  // Ranked rows (equipment and sheets)
  row: { minHeight: 44, paddingVertical: 8, gap: 6, justifyContent: 'center' },
  rowBorder: { borderTopWidth: 1, borderTopColor: p.border },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 },
  rowLabelWrap: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, flexShrink: 1, flex: 1 },
  rowLabel: { ...T['body-md'], fontWeight: '700', color: p.ink, flexShrink: 1 },
  rowLabelPlain: { fontWeight: '400' },
  rowMuted: { color: p.muted },
  rowValue: { ...T['label-lg'], color: p.ink },
  rowPct: { ...T['label-sm'], color: p.muted },
  bar: { height: 7, borderRadius: 4, backgroundColor: p.section, overflow: 'hidden', flexDirection: 'row' },
  hatch: { flexDirection: 'row', height: '100%', overflow: 'hidden', gap: 3 },
  tag: { borderRadius: 99, borderWidth: 1, borderColor: p.containerBorder, backgroundColor: p.container, paddingHorizontal: 6 },
  tagText: { ...T['label-sm'], color: p.onContainer },
  allButton: { minHeight: 44, borderRadius: GEOMETRY['radius-lg'], borderWidth: 1, borderStyle: 'dashed', borderColor: p.border, alignItems: 'center', justifyContent: 'center' },
  // States
  placeholder: { minHeight: 96, justifyContent: 'center', alignItems: 'center', gap: 6 },
  placeholderText: { ...T['body-sm'], color: p.muted, textAlign: 'center' },
  // Bottom sheet
  scrim: { flex: 1, backgroundColor: p.scrim, justifyContent: 'flex-end' },
  sheet: { width: '100%', maxWidth: 640, alignSelf: 'center', maxHeight: '82%', backgroundColor: p.sheet, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: p.containerBorder, paddingTop: 10 },
  sheetBody: { paddingHorizontal: 18, paddingBottom: 28 },
  grab: { width: 40, height: 4, borderRadius: 2, backgroundColor: p.border, alignSelf: 'center', marginBottom: 6 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12 },
  sheetTitle: { ...T['headline-sm'], color: p.ink, flex: 1, flexShrink: 1 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  iconRing: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: p.border, alignItems: 'center', justifyContent: 'center' },
  iconText: { ...T['body-md'], fontWeight: '700', color: p.onContainer },
  meta: { ...T['body-sm'], color: p.muted, marginTop: 2, marginBottom: 8 },
  keys: { flexDirection: 'row', gap: 14, marginBottom: 2, marginTop: 6, alignItems: 'center' },
  keyItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  keySwatch: { width: 10, height: 6, borderRadius: 2 },
  keyText: { ...T['body-sm'], fontSize: 12, color: p.muted },
  method: { gap: 10 },
  methodText: { ...T['body-sm'], lineHeight: 20, color: p.muted },
  methodStrong: { color: p.ink, fontWeight: '700' },
});
};

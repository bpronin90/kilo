import { GEOMETRY } from '../../theme/spacing';
import { Platform, StyleSheet } from 'react-native';
import { TYPOGRAPHY } from '../../theme/typography';

export const createStyles = (colors, kua = null) => StyleSheet.create({
  // Baseline-training disclosure (#871), redesigned as the Paused chapter's
  // dashed toggle row (#1602): a quiet dashed panel, never a filled control —
  // the emphasis while Recovery is active belongs to the Recovery chapter.
  baselineDisclosureToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    paddingVertical: 10,
    paddingLeft: 16,
    paddingRight: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
    borderRadius: GEOMETRY['radius-2xl'],
    backgroundColor: kua ? kua.surfaceCard : colors.card,
  },
  baselineDisclosureLabel: {
    flex: 1,
    ...TYPOGRAPHY['body-md'],
    fontSize: 15,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  // Expanded paused content (#1602): below the toggle, behind a dashed left
  // rule — not inside a card.
  pausedBody: {
    gap: 16,
    paddingLeft: 12,
    borderLeftWidth: 2,
    borderStyle: 'dashed',
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
  },
  routineHealthSection: {
    gap: 12,
  },
  recoveryChapterBody: {
    gap: 16,
  },
  routineHealthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  routineHealthValue: {
    fontWeight: '600',
    color: kua ? kua.onSurface : colors.text,
  },
  routineHealthDivider: {
    borderTopWidth: 1,
    borderTopColor: kua ? kua.surfaceBorder : colors.cardBorder,
  },
  poSection: {
    gap: 12,
  },
  // A padded section inside the one flat Progressive Overload panel (#1604).
  poPanelSection: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  poPanelSectionRuled: {
    borderTopWidth: 1,
    borderTopColor: kua ? kua.surfaceBorder : colors.cardBorder,
  },
  poTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 4,
    flexShrink: 1,
  },
  // Label an explainer anchors to (#1356): Exercise Progress, Metrics.
  poSubLabel: {
    fontSize: TYPOGRAPHY['label-sm'].fontSize,
    fontWeight: '800',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  poInfoBody: {
    gap: 8,
    marginBottom: 4,
  },
  poInfoText: {
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    lineHeight: 19,
  },
  // Exercise Progress counts — same three-up shape as Home's summary.
  // Compact: count and label sit side by side, so the trio is one short row
  // (wrapping on narrow/large-text) instead of a stacked three-up block.
  poSummaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 16,
    rowGap: 4,
    paddingVertical: 2,
  },
  poSummaryCol: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  poSummaryCount: {
    ...(kua ? TYPOGRAPHY['headline-sm'] : { fontSize: 18, fontWeight: '800' }),
  },
  poSummaryLabel: {
    fontSize: TYPOGRAPHY['label-sm'].fontSize,
    fontWeight: '700',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  poPanelSummary: {
    gap: 12,
  },
  poSuggestions: {
    gap: 12,
  },
  signalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  collapseAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 44,
    paddingHorizontal: 4,
  },
  collapseAllText: {
    fontSize: TYPOGRAPHY['label-md'].fontSize,
    fontWeight: '700',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  searchContainer: {},
  searchInput: {
    backgroundColor: kua ? kua.surfaceCard : colors.inputBackground,
    borderRadius: GEOMETRY['radius-xl'],
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.inputBorder,
    paddingHorizontal: 14,
    minHeight: 48,
    paddingVertical: 10,
    fontSize: TYPOGRAPHY['body-lg'].fontSize,
    color: kua ? kua.onSurface : colors.text,
  },
  signalColumnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  signalColumnLabel: {
    flex: 1,
    fontSize: TYPOGRAPHY['label-sm'].fontSize,
    fontWeight: '800',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  signalColumnMetrics: {
    flex: 1,
    flexDirection: 'row',
  },
  poContainer: {
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  groupSection: {},
  groupSectionBorder: {
    borderTopWidth: 1,
    borderTopColor: kua ? kua.surfaceBorder : colors.divider,
  },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: kua ? kua.surfaceBorder : colors.divider,
    backgroundColor: kua ? (kua.surfaceSection ?? kua.surfaceCard) : colors.subtleBg,
  },
  groupName: {
    ...TYPOGRAPHY['label-lg'],
    color: kua ? kua.onSurfaceVariant : colors.text,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  groupCount: {
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  // Rows (#1604): >=60dp pressable, name + trend pill over the caption and the
  // three metric columns, which share fixed widths with the column header so
  // values sit right-aligned under 1RM / Kilo / Best.
  poRow: {
    minHeight: 60,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: kua ? kua.surfaceBorder : colors.divider,
  },
  poRowPressed: {
    backgroundColor: kua ? kua.surfaceCardHeader : colors.chipBackground,
  },
  poRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: 8,
  },
  poRowBottom: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    columnGap: 8,
  },
  poRowCaption: {
    flex: 1,
    minWidth: 0,
  },
  poMetrics: {
    flexDirection: 'row',
  },
  poMetricCol: {
    width: 76,
    alignItems: 'flex-end',
  },
  poColumnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    minHeight: 40,
    backgroundColor: kua ? kua.surfaceCardHeader : colors.subtleBg,
    borderTopWidth: 1,
    borderTopColor: kua ? kua.surfaceBorder : colors.divider,
  },
  poColumnName: {
    flex: 1,
    textAlign: 'left',
  },
  poColLabel: {
    ...TYPOGRAPHY['label-md'],
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  trendPill: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: GEOMETRY['radius-md'],
  },
  trendPillText: {
    ...TYPOGRAPHY['label-md'],
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  exerciseList: {
    paddingHorizontal: 16,
  },
  signalRow: {
    paddingVertical: 16,
  },
  signalRowBorder: {
    borderTopWidth: 1,
    borderTopColor: kua ? kua.surfaceBorder : colors.divider,
  },
  signalNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  signalName: {
    fontSize: TYPOGRAPHY['body-lg'].fontSize,
    fontWeight: '700',
    color: kua ? kua.onSurface : colors.text,
    flex: 1,
    minWidth: 0,
  },
  signalMetricsGrid: {
    flexDirection: 'row',
  },
  metricCol: {
    flex: 1,
    alignItems: 'center',
  },
  signalValue: {
    ...(kua
      ? TYPOGRAPHY['label-lg']
      : { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }), fontWeight: '700', fontSize: TYPOGRAPHY['label-lg'].fontSize }),
    color: kua ? kua.onSurface : colors.text,
  },
  unitSuffix: {
    ...(kua ? TYPOGRAPHY['label-sm'] : { fontSize: TYPOGRAPHY['label-sm'].fontSize }),
    opacity: 0.4,
    marginLeft: 2,
  },
  nwMetricLabel: {
    ...(kua
      ? TYPOGRAPHY['label-sm']
      : { fontWeight: '800', fontSize: TYPOGRAPHY['label-sm'].fontSize, letterSpacing: 0.5 }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    marginTop: 2,
  },
  multiDaySummary: {
    fontSize: TYPOGRAPHY['label-md'].fontSize,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    marginTop: 6,
    fontStyle: 'italic',
  },
  trackingCaption: {
    fontSize: TYPOGRAPHY['label-md'].fontSize,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    fontStyle: 'italic',
  },
  emptySearch: {
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    textAlign: 'center',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    marginTop: 20,
    fontSize: TYPOGRAPHY['body-md'].fontSize,
  },
  emptyTracked: {
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  emptyTrackedLink: {
    marginTop: 12,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  emptyTrackedLinkText: {
    fontSize: TYPOGRAPHY['body-md'].fontSize,
    fontWeight: '600',
    color: kua ? kua.primary : colors.accentText,
  },
});

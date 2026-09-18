import { Platform, StyleSheet } from 'react-native';

const jbmFont = (typo, role, fallback) => {
  if (!typo) return { fontFamily: fallback };
  const { fontFamily, fontWeight } = typo[role];
  return fontWeight !== undefined ? { fontFamily, fontWeight } : { fontFamily };
};

export const createStyles = (colors, kua = null, typo = null) => StyleSheet.create({
  // Baseline-training disclosure header (#871). Reads as the same quiet
  // section-header family used elsewhere in Analytics/Home (label + chevron),
  // not a filled control — the emphasis on this tab right now belongs to the
  // Recovery-live content above it.
  baselineDisclosureToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  baselineDisclosureLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  signalStickyHeader: {
    backgroundColor: kua ? kua.background : colors.background,
    paddingTop: 8,
    paddingBottom: 8,
  },
  signalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  signalSubTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: kua ? kua.onSurface : colors.text,
    flexShrink: 1,
  },
  collapseAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 44,
    paddingHorizontal: 4,
  },
  collapseAllText: {
    fontSize: 12,
    fontWeight: '700',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  searchContainer: {
    marginTop: 12,
    marginBottom: 12,
  },
  searchInput: {
    backgroundColor: kua ? kua.surfaceCard : colors.inputBackground,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.inputBorder,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: kua ? kua.onSurface : colors.text,
  },
  signalColumnHeader: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  signalColumnLabel: {
    flex: 1,
    fontSize: 11,
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
  groupSection: {
    paddingBottom: 4,
  },
  groupSectionBorder: {
    borderTopWidth: 1,
    borderTopColor: kua ? kua.surfaceBorder : colors.divider,
  },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: kua ? (kua.surfaceSection ?? kua.surfaceCard) : colors.subtleBg,
  },
  groupName: {
    fontSize: 14,
    fontWeight: '800',
    color: kua ? kua.onSurface : colors.text,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
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
    fontSize: 16,
    fontWeight: '700',
    color: kua ? kua.onSurface : colors.text,
    flex: 1,
  },
  signalMetricsGrid: {
    flexDirection: 'row',
  },
  metricCol: {
    flex: 1,
    alignItems: 'center',
  },
  signalValue: {
    ...(typo
      ? jbmFont(typo, 'label-lg', Platform.select({ ios: 'Menlo', android: 'monospace' }))
      : { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }), fontWeight: '700' }),
    fontSize: typo ? undefined : 14,
    color: kua ? kua.onSurface : colors.text,
  },
  unitSuffix: {
    fontSize: 11,
    opacity: 0.4,
    marginLeft: 2,
  },
  nwMetricLabel: {
    ...(typo ? jbmFont(typo, 'label-sm', Platform.select({ ios: 'Menlo', android: 'monospace' })) : { fontWeight: '800' }),
    fontSize: typo ? undefined : 11,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    marginTop: 2,
    letterSpacing: typo ? undefined : 0.5,
  },
  multiDaySummary: {
    fontSize: 12,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    marginTop: 6,
    fontStyle: 'italic',
  },
  trackingCaption: {
    fontSize: 12,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    marginBottom: 8,
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
    fontSize: 15,
  },
  emptyTracked: {
    alignItems: 'center',
  },
  emptyTrackedLink: {
    marginTop: 12,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  emptyTrackedLinkText: {
    fontSize: 14,
    fontWeight: '600',
    color: kua ? kua.primary : colors.accentText,
  },
});

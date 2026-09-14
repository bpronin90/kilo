import { Platform, StyleSheet } from 'react-native';

// Styles for the Analytics screen's baseline-training disclosure, the
// Progressive Overload sticky header/search/column labels, and the
// exercise-row/group presentation beneath it. Extracted verbatim from
// AnalyticsScreen.js (card #1051) — no visual change.
export const createStyles = (colors) => StyleSheet.create({
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
    color: colors.textMuted,
  },
  signalStickyHeader: {
    backgroundColor: colors.background,
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
    color: colors.text,
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
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  searchContainer: {
    marginTop: 12,
    marginBottom: 12,
  },
  searchInput: {
    backgroundColor: colors.inputBackground,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.text,
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
    color: colors.textMuted,
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
    borderTopColor: colors.divider,
  },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: colors.subtleBg,
  },
  groupName: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
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
    borderTopColor: colors.divider,
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
    color: colors.text,
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
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },
  unitSuffix: {
    fontSize: 11,
    opacity: 0.4,
    marginLeft: 2,
  },
  nwMetricLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textMuted,
    marginTop: 2,
    letterSpacing: 0.5,
  },
  multiDaySummary: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 6,
    fontStyle: 'italic',
  },
  trackingCaption: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 8,
    fontStyle: 'italic',
  },
  emptySearch: {
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    textAlign: 'center',
    color: colors.textMuted,
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
    color: colors.accentText,
  },
});

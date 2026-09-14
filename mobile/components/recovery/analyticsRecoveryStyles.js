import { StyleSheet } from 'react-native';
import { createInputStyle } from '../UI';

export const createStyles = (colors) => StyleSheet.create({
  container: {
    gap: 16,
  },
  // Same tokens as LogRecoverySection's pending/stale banner, so the identical
  // condition reads identically on both tabs (docs/design-system-map.md).
  stateBanner: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.subtleBg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    gap: 8,
  },
  stateBannerText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  stateRetryButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.chipBackground,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  // Always on `stateRetryButton`'s `chipBackground` fill, so it takes the
  // chip's accent ink (#923).
  stateRetryText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.chipAccentText,
  },
  card: {
    gap: 12,
  },
  identityCaption: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
  },
  // Deliberately lighter than `identityCaption` (#872): the reason is context
  // for the comparison above it, not a second heading competing with the
  // block's identity.
  reasonCaption: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textMuted,
  },
  reasonCaptionDisabled: {
    opacity: 0.5,
  },
  // The inline editor (#872), matching Log's `Manage block` treatment: the field
  // is one short line, and a modal for it would cost more attention than the
  // edit is worth.
  reasonEditor: {
    gap: 8,
    paddingVertical: 4,
  },
  reasonInput: {
    ...createInputStyle(colors),
  },
  reasonErrorText: {
    fontSize: 12,
    color: colors.error,
  },
  reasonEditorActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  reasonEditorButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  reasonEditorCancelText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textMuted,
  },
  reasonEditorSaveText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.accentText,
  },
  provenanceText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  nonMedicalText: {
    fontSize: 12,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  // #1029 amendment: the across-weeks strip is a finished design-system
  // surface — token color/spacing/type throughout, a `ScrollView` (never a
  // fixed-width row) so it stays legible rather than crushing columns at a
  // large accessibility text scale, and letter-coded chips so `Rebuilding`
  // and `Early` never depend on hue discrimination alone.
  bandStripLegendHint: {
    fontSize: 11,
    color: colors.textMuted,
    marginBottom: 6,
  },
  bandStrip: {
    flexDirection: 'row',
    gap: 10,
    paddingRight: 4,
  },
  bandStripCell: {
    minWidth: 76,
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.subtleBg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  bandStripWeekLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
  },
  bandStripRows: {
    gap: 4,
  },
  bandStripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  // Letter-coded chip (#1029 amendment): identity comes from the character,
  // not the fill color, so two adjacent warm-family bands stay distinguishable
  // even where the colors themselves read close together.
  bandStripChip: {
    minWidth: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    backgroundColor: colors.card,
  },
  bandStripChipText: {
    fontSize: 11,
    fontWeight: '800',
  },
  bandStripCount: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
  },
  bandStripZero: {
    paddingVertical: 2,
  },
  bandStripZeroText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  // Unreadable-note gap: dashed stroke plus its own glyph and text — never a
  // bare empty box, so it cannot be mistaken for the solid zero-count cell.
  bandStripGap: {
    alignItems: 'center',
    gap: 3,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.cardBorder,
  },
  bandStripGapText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
  },
  // Reopen (#839): low-emphasis, non-destructive outline button — matching
  // the Log tab's own secondary styling for the same action — never the
  // filled/accent treatment a primary action would use.
  reopenWrapper: {
    gap: 6,
  },
  reopenButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    minHeight: 44,
    justifyContent: 'center',
  },
  reopenButtonDisabled: {
    opacity: 0.5,
  },
  reopenButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  reopenErrorText: {
    fontSize: 12,
    color: colors.error,
  },
  backToActive: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    minHeight: 44,
  },
  backToActiveText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.accentText,
  },
  unavailablePanelText: {
    fontSize: 14,
    color: colors.textMuted,
  },
  // Wraps whichever of {summary, unavailable notice, no-evidence text} the
  // selected week resolves to (#794 review) — a stable node so the live
  // region survives switching between them.
  weekStatusRegion: {
    gap: 12,
  },
  summaryBlock: {
    gap: 4,
  },
  // #1029: the denominator caption sits at the SAME weight tier as each
  // bucket row below it — a fact of equal standing, never a subordinate
  // footnote (acceptance criterion 1/12).
  bandDenominatorCaption: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
  },
  bandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 3,
  },
  bandRowTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.subtleBg,
    overflow: 'hidden',
  },
  bandRowFill: {
    height: '100%',
    borderRadius: 4,
  },
  bandRowLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    minWidth: 90,
  },
  bandRowCount: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    minWidth: 20,
    textAlign: 'right',
  },
  summaryLine: {
    fontSize: 13,
    color: colors.textMuted,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.subtleBg,
    minHeight: 44,
    justifyContent: 'center',
  },
  chipSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
  },
  chipTextSelected: {
    color: colors.onAccent,
  },
  detailsPanel: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  detailsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    minHeight: 44,
    paddingTop: 12,
  },
  detailsHeaderContent: {
    flex: 1,
  },
  detailsHeaderTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  detailsHeaderCount: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    marginTop: 2,
  },
  detailsBody: {
    gap: 12,
    paddingTop: 12,
  },
  legend: {
    gap: 4,
  },
  legendToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 44,
  },
  legendToggleText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  legendText: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.textMuted,
  },
  evidenceGroup: {
    gap: 16,
  },
  rowList: {
    gap: 12,
  },
  exerciseRow: {
    gap: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  exerciseRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  exerciseRowName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
  },
  stateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stateDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  stateDot_success: {
    backgroundColor: colors.success,
  },
  stateDot_caution: {
    backgroundColor: colors.caution,
  },
  stateDot_error: {
    backgroundColor: colors.error,
  },
  stateDot_muted: {
    backgroundColor: colors.textMuted,
  },
  stateDot_accent: {
    backgroundColor: colors.accent,
  },
  stateChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  // Wraps instead of crushing (#821). Up to four metric cells could sit in one
  // fixed row, so at a large font scale the label, percent and "current /
  // baseline" line inside each one had nowhere to go. `flexWrap` plus a
  // `minWidth` floor lets a cell drop to the next line rather than compress
  // below the point where its numbers are readable — the same failure the
  // Recovery category columns already had to be fixed for.
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  metricCell: {
    flex: 1,
    minWidth: 128,
    gap: 4,
  },
  metricHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  metricPercent: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.cautionText,
  },
  metricPercentMet: {
    color: colors.success,
  },
  meterTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.subtleBg,
    overflow: 'hidden',
  },
  meterFill: {
    height: '100%',
    borderRadius: 3,
  },
  metricNumbers: {
    fontSize: 12,
    color: colors.textMuted,
  },
  addedMetricValue: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  detailGroup: {
    gap: 12,
  },
  detailGroupLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  unavailableText: {
    fontSize: 12,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  historyPanel: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    overflow: 'hidden',
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 44,
    backgroundColor: colors.subtleBg,
  },
  historyHeaderBordered: {
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  historyHeaderContent: {
    flex: 1,
  },
  historySummaryCount: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
  },
  historySummaryLatest: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  historySummaryEmphasis: {
    fontWeight: '700',
    color: colors.text,
  },
  historyBlockGroup: {
  },
  historyBlockGroupBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  historyRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 4,
  },
  historyRowSelected: {
    backgroundColor: colors.subtleBg,
  },
  historyBaselineTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  historyDates: {
    fontSize: 12,
    color: colors.textMuted,
  },
  historyInclusionWrapper: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  weekIndexRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    gap: 2,
  },
  weekIndexRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  weekIndexWeekLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  weekIndexNoteTitle: {
    fontSize: 13,
    color: colors.text,
  },
  weekIndexStateText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  weekIndexMuted: {
    color: colors.textMuted,
  },
});

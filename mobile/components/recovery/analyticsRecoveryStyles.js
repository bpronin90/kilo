import { StyleSheet } from 'react-native';
import { createInputStyle } from '../UI';

export const createStyles = (colors, kua = null) => StyleSheet.create({
  container: {
    gap: 16,
  },
  // Same tokens as LogRecoverySection's pending/stale banner, so the identical
  // condition reads identically on both tabs (docs/design-system-map.md).
  stateBanner: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: kua ? kua.surfaceSection : colors.subtleBg,
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
    gap: 8,
  },
  stateBannerText: {
    fontSize: 13,
    fontWeight: '600',
    color: kua ? kua.onSurface : colors.text,
  },
  stateRetryButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: kua ? kua.primaryContainer : colors.chipBackground,
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
  },
  // Always on `stateRetryButton`'s `chipBackground` fill, so it takes the
  // chip's accent ink (#923).
  stateRetryText: {
    fontSize: 13,
    fontWeight: '700',
    color: kua ? kua.primaryOnContainer : colors.chipAccentText,
  },
  // Bottom-of-card context (#872/#1219): the reason is quiet context for the
  // comparison above it. minHeight makes the whole row a real >=44dp target.
  reasonCaption: {
    fontSize: 13,
    lineHeight: 18,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  reasonPressable: {
    minHeight: 44,
    justifyContent: 'center',
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
    ...createInputStyle(colors, kua),
  },
  reasonErrorText: {
    fontSize: 12,
    color: kua ? kua.error : colors.error,
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
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  reasonEditorSaveText: {
    fontSize: 14,
    fontWeight: '700',
    color: kua ? kua.primary : colors.accentText,
  },
  provenanceText: {
    fontSize: 13,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  nonMedicalText: {
    fontSize: 13,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    fontStyle: 'italic',
  },
  // #1029 amendment: the across-weeks strip is a finished design-system
  // surface — token color/spacing/type throughout, a `ScrollView` (never a
  // fixed-width row) so it stays legible rather than crushing columns at a
  // large accessibility text scale, and letter-coded chips so `Rebuilding`
  // and `Early` never depend on hue discrimination alone.
  // Color dot (#1209); the adjacent full-label text carries the meaning.
  // Unreadable-note gap: dashed stroke plus its own glyph and text — never a
  // bare empty box, so it cannot be mistaken for the solid zero-count cell.
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
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
    minHeight: 44,
    justifyContent: 'center',
  },
  reopenButtonDisabled: {
    opacity: 0.5,
  },
  reopenButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  reopenErrorText: {
    fontSize: 12,
    color: kua ? kua.error : colors.error,
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
    color: kua ? kua.primary : colors.accentText,
  },
  unavailablePanelText: {
    fontSize: 14,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  // Wraps whichever of {summary, unavailable notice, no-evidence text} the
  // selected week resolves to (#794 review) — a stable node so the live
  // region survives switching between them.
  weekStatusRegion: {
    gap: 12,
  },
  summaryBlock: {
    gap: 14,
  },
  // #1029: the denominator caption sits at the SAME weight tier as each
  // bucket row below it — a fact of equal standing, never a subordinate
  // footnote (acceptance criterion 1/12).
  summaryLine: {
    fontSize: 13,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  // Week picker (#1219): rows never wrap on their own — RecoveryWeekPicker sizes
  // each chip from the measured width and decides the row split.
  chipBlock: {
    gap: 6,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 4,
  },
  chipRowLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  chip: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
    backgroundColor: kua ? kua.surfaceSection : colors.subtleBg,
  },
  chipSelected: {
    backgroundColor: kua ? kua.primary : colors.accent,
    borderColor: kua ? kua.primary : colors.accent,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '700',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  chipTextSelected: {
    color: kua ? kua.onPrimary : colors.onAccent,
  },
  detailsPanel: {
    borderTopWidth: 1,
    borderTopColor: kua ? kua.surfaceBorder : colors.divider,
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
    color: kua ? kua.onSurface : colors.text,
  },
  // One quiet footer row (#1219): provenance, reason and the info button.
  footerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 6,
  },
  // Bounded, shrinkable single line: a long routine title or date range
  // ellipsizes (full value on its label) instead of squeezing out the reason or
  // the info button; if the row cannot fit, it wraps rather than clip a control.
  footerProvenance: {
    flexShrink: 1,
    maxWidth: '100%',
  },
  footerReason: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 96,
  },
  footerSeparator: {
    fontSize: 13,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  infoButton: {
    minWidth: 44,
    minHeight: 44,
    marginLeft: 'auto',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailsBody: {
    gap: 12,
    paddingTop: 12,
  },
  evidenceGroup: {
    gap: 16,
  },
  historyPanel: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
    overflow: 'hidden',
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 44,
    backgroundColor: kua ? kua.surfaceSection : colors.subtleBg,
  },
  historyHeaderBordered: {
    borderBottomWidth: 1,
    borderBottomColor: kua ? kua.surfaceBorder : colors.cardBorder,
  },
  historyHeaderContent: {
    flex: 1,
  },
  historySummaryCount: {
    fontSize: 12,
    fontWeight: '600',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  historySummaryLatest: {
    fontSize: 13,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    marginTop: 2,
  },
  historySummaryEmphasis: {
    fontWeight: '700',
    color: kua ? kua.onSurface : colors.text,
  },
  historyBlockGroup: {
  },
  historyBlockGroupBorder: {
    borderBottomWidth: 1,
    borderBottomColor: kua ? kua.surfaceBorder : colors.cardBorder,
  },
  historyRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 4,
  },
  historyRowSelected: {
    backgroundColor: kua ? kua.surfaceSection : colors.subtleBg,
  },
  historyBaselineTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: kua ? kua.onSurface : colors.text,
  },
  historyDates: {
    fontSize: 12,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  historyInclusionWrapper: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  weekIndexRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: kua ? kua.surfaceBorder : colors.divider,
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
    color: kua ? kua.onSurface : colors.text,
  },
  weekIndexNoteTitle: {
    fontSize: 13,
    color: kua ? kua.onSurface : colors.text,
  },
  weekIndexStateText: {
    fontSize: 12,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  weekIndexMuted: {
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
});

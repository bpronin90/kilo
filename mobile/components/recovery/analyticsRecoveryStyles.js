import { GEOMETRY } from '../../theme/spacing';
import { TYPOGRAPHY } from '../../theme/typography';
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
    borderRadius: GEOMETRY['radius-lg'],
    backgroundColor: kua ? kua.surfaceSection : colors.subtleBg,
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
    gap: 8,
  },
  stateBannerText: {
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
    fontWeight: '600',
    color: kua ? kua.onSurface : colors.text,
  },
  stateRetryButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: GEOMETRY['radius-lg'],
    backgroundColor: kua ? kua.primaryContainer : colors.chipBackground,
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
  },
  // Always on `stateRetryButton`'s `chipBackground` fill, so it takes the
  // chip's accent ink (#923).
  stateRetryText: {
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
    fontWeight: '700',
    color: kua ? kua.primaryOnContainer : colors.chipAccentText,
  },
  // Bottom-of-card context (#872/#1219): the reason is quiet context for the
  // comparison above it. minHeight makes the whole row a real >=44dp target.
  reasonCaption: {
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
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
    fontSize: TYPOGRAPHY['label-md'].fontSize,
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
    fontSize: TYPOGRAPHY['body-md'].fontSize,
    fontWeight: '700',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  reasonEditorSaveText: {
    fontSize: TYPOGRAPHY['body-md'].fontSize,
    fontWeight: '700',
    color: kua ? kua.primary : colors.accentText,
  },
  // Revealed under the date row it belongs to (the info button sits beside it).
  nonMedicalText: {
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    fontStyle: 'italic',
    paddingBottom: 8,
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
    borderRadius: GEOMETRY['radius-xl'],
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
    minHeight: 44,
    justifyContent: 'center',
  },
  reopenButtonDisabled: {
    opacity: 0.5,
  },
  reopenButtonText: {
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
    fontWeight: '600',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  reopenErrorText: {
    fontSize: TYPOGRAPHY['label-md'].fontSize,
    color: kua ? kua.error : colors.error,
  },
  backToActive: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    minHeight: 44,
  },
  backToActiveText: {
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
    fontWeight: '700',
    color: kua ? kua.primary : colors.accentText,
  },
  unavailablePanelText: {
    fontSize: TYPOGRAPHY['body-md'].fontSize,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  // Wraps whichever of {summary, unavailable notice, no-evidence text} the
  // selected week resolves to (#794 review) — a stable node so the live
  // region survives switching between them.
  weekStatusRegion: {
    gap: 12,
  },
  summaryBlock: {
    gap: 12,
  },
  // #1029: the denominator caption sits at the SAME weight tier as each
  // bucket row below it — a fact of equal standing, never a subordinate
  // footnote (acceptance criterion 1/12).
  summaryLine: {
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
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
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
    fontWeight: '700',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  chip: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: GEOMETRY['radius-xl'],
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
    backgroundColor: kua ? kua.surfaceSection : colors.subtleBg,
  },
  chipSelected: {
    backgroundColor: kua ? kua.primary : colors.accent,
    borderColor: kua ? kua.primary : colors.accent,
  },
  chipText: {
    fontSize: TYPOGRAPHY['label-md'].fontSize,
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
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
    fontWeight: '700',
    color: kua ? kua.onSurface : colors.text,
  },
  // Block context (#1219): a quiet "label  value" list under one divider. Rows
  // are full-width >=44dp lines so nothing floats and no gap is dead; the info
  // button sits directly after the date it accompanies.
  contextBlock: {
    borderTopWidth: 1,
    borderTopColor: kua ? kua.surfaceBorder : colors.divider,
  },
  contextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    columnGap: 8,
  },
  contextLabel: {
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
    fontWeight: '600',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    // Labels share one column start so the values line up.
    minWidth: 68,
    flexShrink: 0,
  },
  contextValue: {
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
    lineHeight: 18,
    color: kua ? kua.onSurface : colors.text,
  },
  // Bounded and shrinkable: a long routine title or reason ellipsizes (the full
  // text rides on the accessible label) instead of pushing the controls out.
  contextValueShrink: {
    flexShrink: 1,
  },
  // The date row wraps (never squeezes a date mid-digit): if label + date + info
  // cannot share a line the info button drops under, and each date stays whole.
  contextRowWrap: {
    flexWrap: 'wrap',
  },
  contextDateText: {
    flexShrink: 0,
  },
  contextDates: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 4,
  },
  contextPlaceholder: {
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  // The whole reason row is the tap target; a long reason gets two lines.
  reasonRow: {
    paddingVertical: 4,
  },
  reasonEditIcon: {
    flexShrink: 0,
  },
  // Directly after the date text (ordinary row gap, never margin-pushed to the
  // card edge); the 18dp glyph sits in a real 44x44 target that reserves its
  // whole box — no negative margins, so it can never overlap the date or start
  // outside the row. When label + date + button cannot share a line the WHOLE
  // button wraps to the next line, left-aligned at the row edge.
  infoButton: {
    minWidth: 44,
    minHeight: 44,
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
    borderRadius: GEOMETRY['radius-2xl'],
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
    fontSize: TYPOGRAPHY['label-md'].fontSize,
    fontWeight: '600',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  historySummaryLatest: {
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
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
    fontSize: TYPOGRAPHY['body-md'].fontSize,
    fontWeight: '800',
    color: kua ? kua.onSurface : colors.text,
  },
  historyDates: {
    fontSize: TYPOGRAPHY['label-md'].fontSize,
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
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
    fontWeight: '700',
    color: kua ? kua.onSurface : colors.text,
  },
  weekIndexNoteTitle: {
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
    color: kua ? kua.onSurface : colors.text,
  },
  weekIndexStateText: {
    fontSize: TYPOGRAPHY['label-md'].fontSize,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  weekIndexMuted: {
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
});

// Recovery Block card styles (#843, split out of LogRecoverySection.js for the
// #1056 file-size refactor). Behavior-only extraction: every rule below is the
// approved #843/#918/#921 redesign, unchanged. The card, week-table, and
// action-zone visuals are the owner-authorized Log-tab style-lock exception
// scoped to this surface; see LogRecoverySection.js for the full rationale.
import { StyleSheet } from 'react-native';
import { createInputStyle } from '../UI';

export const createStyles = (colors) => StyleSheet.create({
  container: {
    gap: 16,
  },
  activeGroup: {
    gap: 12,
  },
  // Clipped card chrome (#843): padding:0 so the three internal zones each
  // own their own padding, with the existing 24px radius/border doing the
  // clipping.
  card: {
    padding: 0,
    overflow: 'hidden',
    gap: 0,
  },
  stateZone: {
    backgroundColor: colors.subtleBg,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
    gap: 6,
  },
  stateKicker: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: colors.textMuted,
  },
  headline: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
  },
  baselineCaption: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
  },
  errorBanner: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.cardErrorBg,
    borderWidth: 1,
    borderColor: colors.cardErrorBg,
    marginTop: 4,
  },
  errorBannerText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textLight,
  },
  weekTable: {},
  weekItem: {},
  weekItemDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  weekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 56,
    paddingHorizontal: 18,
  },
  // Left padding compensated from 18 to 15 to absorb the 3px accent rail on
  // the current-week wrapper, so the row's content still lands on the same
  // 18px rhythm as every other row (#843).
  weekRowCurrent: {
    paddingLeft: 15,
  },
  statusDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekLabel: {
    width: 56,
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
  },
  weekNoteTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  weekNoteContent: {
    paddingHorizontal: 18,
    paddingBottom: 16,
    gap: 10,
  },
  weekNoteContentCurrent: {
    paddingLeft: 15,
  },
  // The expanded note's own inset, card-colored bordered surface (#843) — a
  // 14px-radius surface distinct from the week row it belongs to.
  noteSurface: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 14,
    gap: 10,
  },
  noteSurfaceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  noteSurfaceKicker: {
    flex: 1,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: colors.accentText,
  },
  weekNoteBody: {},
  // The inline recovery-note editor (#841): a compact title + text pair, no
  // outer Card — it already lives inside this week's own content area, so a
  // second nested bordered surface would only add chrome the note viewer
  // above it never had.
  inlineEditor: {
    gap: 8,
  },
  inlineEditorTitleInput: {
    backgroundColor: colors.inputBackground,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  inlineEditorTextInput: {
    backgroundColor: colors.inputBackground,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.text,
    minHeight: 160,
    textAlignVertical: 'top',
  },
  weekNoteActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
  },
  inlineSwitchButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: colors.chipBackground,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    minHeight: 44,
    justifyContent: 'center',
    flexShrink: 1,
  },
  inlineSwitchButtonDisabled: {
    opacity: 0.45,
  },
  inlineSwitchButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.chipAccentText,
  },
  // The one expanded-note action (#843), at the 44dp floor since #921: the
  // box grows, the 13px label / 1px outline / 10px radius do not. `minHeight`
  // rather than `height`, so the control still grows with the user's text
  // scale (`ui-design-rules.md` §15).
  editNoteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    justifyContent: 'center',
  },
  editNoteButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.accentText,
  },
  // The A/B segment's real target (#921): the visual keeps its 32dp height,
  // so the press box is a separate 44×44dp wrapper around it — §15's
  // "wrap it in a real target box rather than reaching for `hitSlop`", the
  // same shape `ReminderSettingsCard`'s weekday chips use.
  abSegmentTarget: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The Recovery A/B segment's visual (#843): 32dp tall, unchanged. `minHeight`
  // rather than `height` since #921, so it grows with the user's text scale
  // instead of clipping the letters at large sizes.
  abSegment: {
    flexDirection: 'row',
    minHeight: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.chipBackground,
    overflow: 'hidden',
  },
  abSegmentItem: {
    width: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  abSegmentItemActive: {
    backgroundColor: colors.accent,
  },
  abSegmentText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.chipAccentText,
  },
  abSegmentTextActive: {
    color: colors.onAccent,
  },
  actionZone: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 18,
    gap: 8,
  },
  // The card's single primary action carries the only accent fill (#843),
  // full-width and 48px, with `onAccent` ink — the pairing already recorded
  // for accent surfaces in `docs/design-system-map.md`.
  primaryButton: {
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.accent,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.onAccent,
  },
  actionCaption: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.textMuted,
  },
  // `Undo completion` (#843): muted, not error, ink — reopening the latest
  // week is a routine correction, not a destructive action.
  undoButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 6,
  },
  undoButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
  },
  manageCard: {
    padding: 0,
    overflow: 'hidden',
    gap: 0,
  },
  manageTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  manageTriggerText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  manageList: {
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  manageRow: {},
  manageRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  manageRowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 56,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  manageRowDisabled: {
    opacity: 0.5,
  },
  // The switch Pressable's own hit area within the plain `manageRowMain`
  // wrapper (#843 review) — everything but the trailing help/chevron glyphs,
  // which are its siblings, not its children.
  inclusionSwitchArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  manageRowInfo: {
    flex: 1,
    gap: 2,
  },
  manageRowTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  manageRowTitleError: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.error,
  },
  manageRowSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textMuted,
  },
  manageRowInlineError: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: colors.error,
  },
  manageRowState: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
  },
  // The inline reason editor (#872). It replaces the row's own contents rather
  // than opening a modal: the field is one short line, and a sheet for it would
  // cost more attention than the edit is worth.
  reasonEditor: {
    flex: 1,
    gap: 8,
  },
  reasonInput: {
    ...createInputStyle(colors),
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
  // On-demand inclusion help toggle (#843 review), matching
  // `RecoveryInclusionToggle`'s own info-button box: a real 44dp target, not
  // a `hitSlop`, which React Native clips at the parent's bounds.
  inclusionHelpToggle: {
    flexShrink: 0,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingBanner: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.subtleBg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    gap: 8,
    marginTop: 4,
  },
  pendingBannerText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  pendingRetryButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.chipBackground,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  pendingRetryText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.chipAccentText,
  },
});

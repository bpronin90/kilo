// LOG TAB STYLE LOCK — DO NOT TOUCH.
// The fonts, font sizes, colors, spacing, and overall visual style of the Log
// tab are intentionally fixed. Do NOT change any styling here, in the `styles`
// block below, or in the Log-tab typography of `components/UI.js`
// (`WorkoutHeading` / `WorkoutSubheading`). No "creative" or opportunistic
// visual tweaks. Change Log-tab styling ONLY when the repo owner explicitly
// asks for that specific change.
//
// Authorized exceptions (#710), scoped to the routine-card headers in
// `components/LogActiveRoutineCard.js` and `components/LogPreviousRoutines.js`:
// `otherNoteHeader.alignItems` `'center'` -> `'flex-start'`; the action
// container's gap `8` -> `12`; layout-only containment props (`minWidth: 0`,
// `flexShrink: 1`, `flexWrap: 'wrap'`, `justifyContent: 'flex-end'`);
// `minHeight: 44` / `justifyContent: 'center'` on `inlineSwitchButton`; and
// `numberOfLines={2}` / `ellipsizeMode="tail"` on the title `Text`.
//
// Authorized exceptions (#711), which relocates controls without restyling
// them: the header action containers are deleted outright; the active card's
// former `editHintRow` becomes `actionStrip` and gains `flexWrap: 'wrap'` +
// `gap: 12`, with a `gap: 12` `actionStripPrimary` row inside it; the
// non-current card's expanded body gains a `gap: 12` `viewActions` row for the
// relocated Week A/B pill.
//
// Authorized exception (#843), the owner-authorized Recovery and More Routines
// redesign: `styles.tabToggle` and its item styles below are restyled to a
// neutral navigation strip; `LogRecoverySection.js`, `RecoveryBlockEndModal.js`
// (new), and `LogPreviousRoutines.js` carry their own approved redesign. The
// Current routine card remains locked.
//
// Authorized exception (#918), the owner-authorized accessibility fix, scoped
// to text `color` values ONLY: every string the user reads moves off the
// `colors.accent` mark value, which measures 2.03:1-2.68:1 as light-mode ink
// against an AA floor of 4.5:1. Strings clear of a chip fill take
// `colors.accentText`; the seven that can land on `chipBackground` in any state
// take `colors.chipAccentText`, added by that issue. This covers the `styles`
// block here, `WorkoutSubheading` in `components/UI.js`, and the Log-tab
// components `LogActiveRoutineCard.js`, `LogPreviousRoutines.js`,
// `LogDeloadSection.js`, `LogRecoverySection.js`, and
// `RecoveryBlockEndModal.js`. It reaches `currentNoteTitle` on the Current
// routine card, which #843 otherwise locks — the title's ink, and nothing else
// about that card. No size, weight, spacing, layout, fill, or border value
// changes, and every mark use of `accent` (fills, borders, dots, rails, icon
// glyphs) is untouched. Ratios are recorded in `docs/design-system-map.md` and
// asserted in `mobile/tests/theme-rendering.test.js`.
//
// Authorized exception (#1021), scoped as follows: `LogPreviousRoutines.js`
// loses its collection-level Show/Hide Routines disclosure — non-current
// cards are now always listed, each keeping its own independent per-card
// collapse/expand exactly as before. `LogActiveRoutineCard.js`'s action
// strip consolidates Edit, Copy, Share, and Share as Image into one 44dp
// three-dot menu, leaving the compact Week A/B pill as the header's only
// always-visible control. `LogScreenEditorCard.js`'s New Routine spacing is
// tightened and gains a secondary Import routine action near Save. No other
// styling changes.
//
// No other styling exception is authorized.

import { StyleSheet } from 'react-native';

export const createStyles = (colors) => StyleSheet.create({
  skeletonCard: {
    backgroundColor: colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 20,
    marginBottom: 12,
    gap: 12,
  },
  skeletonBar: {
    backgroundColor: colors.cardBorder,
    borderRadius: 6,
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
  // #905, owner-authorized: the chip reaches the 44dp target by reserving
  // height, not by restyling. Padding, radius, fill, and type are untouched;
  // `justifyContent` keeps the 14px label optically centered in the taller box,
  // and the chip's width is unchanged, so the editor header still lays out on
  // one row. `hitSlop` cannot do this job here — React Native clips a slop at
  // the parent's bounds and `editorHeaderActions` is only as tall as the chip
  // itself, so the slop would claim a target the control never had
  // (ui-design-rules §15, the finding that shaped #904).
  modeToggle: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: colors.chipBackground,
    minHeight: 44,
    justifyContent: 'center',
  },
  // Extracted verbatim from the two inline objects the Week and Merge chips
  // carried (#905). Same values; their former `marginRight: 8` moves to the
  // row's `columnGap` so a wrapped line still ends flush with the row's right
  // edge instead of 8dp short of it.
  modeToggleOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  // #905: the editor header holds up to three chips beside a 34px title.
  // `ScreenShell`'s title group is `flex: 1` (basis 0), so this row is never
  // asked to give width back and would otherwise run off the right edge once
  // the chips outgrow the row — at 320dp, or at a large text scale on any
  // phone. The cap is what lets `flexWrap` engage at all. It is deliberately
  // loose: at 384dp the cluster measures ~251dp against a ~264dp cap, so the
  // common case still renders on one row exactly as before, and the wrap is a
  // safety valve against clipping rather than a layout the user meets daily.
  // The title truncating to a stem is accepted here — the editor renders the
  // routine's full name in the card's name field directly below.
  editorHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    maxWidth: '75%',
    columnGap: 8,
    rowGap: 8,
  },
  modeToggleText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.chipAccentText,
  },
  // Neutral navigation strip (#843), restyled from the former accent-filled
  // toggle: a subtle background and card border rather than a chip surface,
  // with the active item picked out by the card color and a small shadow —
  // the same emphasis language ordinary cards already use, not a second
  // accent fill competing with Recovery's own primary action. The former
  // 12px bottom margin is dropped; spacing to the content below now comes
  // from the surrounding sections' own gaps.
  tabToggle: {
    flexDirection: 'row',
    borderRadius: 12,
    backgroundColor: colors.subtleBg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 3,
  },
  tabToggleItem: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 9,
    alignItems: 'center',
  },
  tabToggleItemActive: {
    backgroundColor: colors.card,
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 1,
  },
  tabToggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
  },
  tabToggleTextActive: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  // Persistent `Start recovery block` entry point (#823): a low-emphasis
  // outline row, subordinate to Edit on the current routine card above it,
  // and never nested in a menu — see the render site for why it moved here.
  recoveryStartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    minHeight: 44,
  },
  recoveryStartRowText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.accentText,
  },
  // Secondary `Reopen recovery block: {baseline title}` entry point (#839):
  // same outline-row shape as Start, but `textMuted` ink keeps it visibly
  // lower-emphasis and non-destructive next to Start's `accent` primary.
  recoveryReopenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    minHeight: 44,
    marginTop: 8,
  },
  recoveryReopenRowText: {
    flex: 1,
    marginRight: 8,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
  },
  // First-use guidance cards (S1/S2). Ordinary `Card` chrome and ordinary
  // text/textMuted ink — no new filled surface + label pairing, so no new
  // contrast entry is required (#ui-design-rules §13). No fixed heights, so
  // every line wraps rather than truncating at large text.
  firstUseCard: {
    gap: 8,
  },
  firstUseTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  firstUseBody: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
  },
  firstUseError: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: colors.error,
  },
  firstUseAction: {
    minHeight: 44,
    justifyContent: 'center',
  },
});

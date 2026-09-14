import { Platform, StyleSheet } from 'react-native';

// #886: the raw-text editor input's own vertical padding, shared with the
// `input` style below so the source-jump measurement and the rendered box can
// never drift apart.
export const EDITOR_INPUT_VERTICAL_PADDING = 14;

// #886: and the horizontal inset of the same box — border included — so the
// measuring mirror below wraps at exactly the width the input wraps at. Both
// are applied to `styles.input` itself (#888), so the mirror's width math and
// the box it describes cannot drift apart.
export const EDITOR_INPUT_HORIZONTAL_PADDING = 14;
export const EDITOR_INPUT_BORDER_WIDTH = 1;
export const EDITOR_INPUT_TEXT_INSET = (EDITOR_INPUT_HORIZONTAL_PADDING + EDITOR_INPUT_BORDER_WIDTH) * 2;

// #867: how far apart the tool row and the note sit inside `editorStack`.
// Mirrors the surrounding Card's own `gap`, so pulling those two controls into
// their own positioning context changes no spacing.
export const EDITOR_STACK_GAP = 10;

export const createStyles = (colors) => StyleSheet.create({
  // #1021: tightened from 16 — the New Routine editor's top-level rows sat
  // further apart than the content inside any one of them needed.
  editContainer: {
    gap: 12,
  },
  input: {
    backgroundColor: colors.inputBackground,
    borderRadius: 16,
    borderWidth: EDITOR_INPUT_BORDER_WIDTH,
    borderColor: colors.inputBorder,
    paddingHorizontal: EDITOR_INPUT_HORIZONTAL_PADDING,
    paddingVertical: EDITOR_INPUT_VERTICAL_PADDING,
    fontSize: 16,
    color: colors.text,
  },
  titleInput: {
    marginBottom: 8,
    fontWeight: '700',
  },
  editorInput: {
    minHeight: 250,
    textAlignVertical: 'top',
  },
  // #886 measuring mirror. Out of flow and invisible; `left: -10000` keeps it
  // off screen even on a platform that still paints a zero-opacity subtree.
  sourceJumpMirror: {
    position: 'absolute',
    left: -10000,
    top: 0,
    opacity: 0,
  },
  // Matches `input`'s text metrics — anything that changes where the editor
  // wraps has to change here too, or the measured split stops agreeing with
  // the box it is describing. `includeFontPadding: false` (Android) keeps each
  // half's height a clean multiple of its rows, so the ratio between them is
  // the row ratio and nothing else.
  sourceJumpMirrorText: {
    fontSize: 16,
    includeFontPadding: false,
  },
  saveButton: {
    marginTop: 8,
  },
  // #1021: the secondary Import routine action, near/below Save — a quiet
  // text-only affordance so Save stays the one prominent control for a
  // brand-new routine.
  importRoutineButton: {
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  importRoutineButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.accentText,
  },
  // Empty-note seed example (#785). A tinted block matching the syntax-help
  // code block styling (§4: no nested Card), tappable at minHeight 44.
  seedBlock: {
    marginTop: 8,
    backgroundColor: colors.inputBackground,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 10,
    minHeight: 44,
    justifyContent: 'center',
    gap: 2,
  },
  seedHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 4,
  },
  seedLineText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    color: colors.text,
  },
  // #867: the tool row + note pair, and the positioning context the problem
  // list overlays them from. `gap` mirrors the surrounding Card's own gap, so
  // pulling these two controls into their own container changes no spacing.
  editorStack: {
    gap: EDITOR_STACK_GAP,
  },
  // #863: help control and badge share one row, space-between so they sit
  // at opposite edges, and a common minHeight (below) so their baselines
  // align at every supported text size.
  editorToolRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  syntaxHelpButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
  syntaxHelpButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accentText,
  },
  // Outlined circled "!" + count (#863), replacing the standing bordered
  // warning block and the always-visible active-problem message with a
  // single quiet, on-demand affordance. Outline only, no filled surface
  // behind the glyph — a filled badge would be a new contrast pairing
  // (§13) and read as loud, the thing this replaces.
  validationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
    gap: 6,
  },
  validationBadgeCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  validationBadgeGlyph: {
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 13,
  },
  validationBadgeCount: {
    fontSize: 13,
    fontWeight: '700',
  },
  // Height-limited, internally scrollable problem list (#863), expanded by
  // tapping the badge. Each row is one problem, in source order, labeled with
  // human-readable context rather than a line number.
  //
  // #867: an overlay, not an in-flow row. `top` is supplied at the call site
  // from the tool row's measured height, and the opaque `card` fill (the same
  // surface it already sat on) is what lets it cover the note rather than
  // displace it. Nothing about the note's geometry or the page's content
  // height changes when it opens or closes.
  validationList: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 2,
    maxHeight: 220,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 12,
    backgroundColor: colors.card,
  },
  validationListRow: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  validationListRowDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  validationListRowText: {
    fontSize: 13,
    lineHeight: 18,
  },
  validationListRowTextError: {
    color: colors.error,
  },
  validationListRowTextWarning: {
    color: colors.cautionText,
  },
  // The single dismissible bar (#863) for whichever one problem is
  // selected. Renders below the TextInput, not above it, so jumping to a
  // problem deep in a long note never scrolls the message off screen.
  validationBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 8,
  },
  validationBarText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  validationBarTextError: {
    color: colors.error,
  },
  validationBarTextWarning: {
    color: colors.cautionText,
  },
  validationBarDismiss: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  validationBarDismissText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  switchButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  switchButtonText: {
    color: colors.accentText,
  },
  // Irreversible-action container (#823, ui-design-rules.md §14): groups
  // Delete apart from the routine-management Buttons above it, matching
  // BackupScreen's "Wipe Device Data" reference implementation.
  dangerZone: {
    backgroundColor: colors.errorSurface,
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: 24,
    padding: 16,
    gap: 10,
  },
  dangerZoneHeading: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dangerZoneHeadingText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.error,
  },
  autosaveIndicator: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'right',
    marginTop: 8,
  },
  // Fixed height regardless of whether a label is showing (#880 revised
  // body, non-interference): 12px font + 8px marginTop from
  // autosaveIndicator above, rounded up — so the region's own height never
  // changes as its text appears, changes, or clears, and nothing below it in
  // the card ever reflows.
  saveStatusRegion: {
    minHeight: 28,
    justifyContent: 'center',
  },
  saveErrorText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: colors.error,
    marginTop: 8,
  },
  // A tinted block, not a nested Card (§4): ordinary `text`/`textMuted` ink on
  // the shared subtle surface, so it introduces no new filled surface + label
  // pairing and needs no new contrast entry (§13).
  adoptionPrompt: {
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.subtleBg,
    gap: 6,
  },
  adoptionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  adoptionBody: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
  },
  adoptionError: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: colors.error,
  },
  // Stacks vertically at large text rather than squeezing two pills onto one
  // line; no fixed heights, so every label wraps instead of truncating.
  adoptionActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  adoptionPrimary: {
    flexGrow: 1,
    flexBasis: 160,
    minHeight: 44,
    justifyContent: 'center',
  },
  adoptionSecondary: {
    flexGrow: 1,
    flexBasis: 120,
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  adoptionSecondaryText: {
    color: colors.textMuted,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 6,
    marginTop: 4,
  },
  dateInput: {
    justifyContent: 'center',
    marginBottom: 12,
  },
  dateInputWebWrap: {
    marginBottom: 12,
  },
  dateInputText: {
    fontSize: 16,
    color: colors.text,
  },
  // Compact secondary "Date · <value>" disclosure row (#764), replacing the
  // removed Settings "Edit deload dates" toggle. minHeight 44 for the touch
  // target; disabled styling communicates the linked-record safety boundary
  // without removing the row (accessibilityState carries the same fact for
  // screen readers).
  dateDisclosureRow: {
    minHeight: 44,
    justifyContent: 'center',
    marginBottom: 4,
  },
  dateDisclosureText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  dateDisclosureDoneText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accentText,
    marginBottom: 8,
  },
});

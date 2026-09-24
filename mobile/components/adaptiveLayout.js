// Adaptive layout contract for large screens, landscape, and resizable windows
// (#1126). Kilo no longer locks MainActivity to portrait, so Android 16+ can
// run it on tablets, unfolded foldables, split-screen, and freeform windows.
// Phone portrait windows are narrower than every threshold here, so these
// helpers return the pre-#1126 values there and phone portrait is unchanged.

// Single readable column for screen content on wide windows, gutters included
// (the same 640 cap desktop web already used). Phone-oriented controls are
// centered at this width instead of stretching across a tablet.
export const CONTENT_MAX_WIDTH = 640;

// Centered dialogs and bottom sheets cap at this width on wide windows.
export const DIALOG_MAX_WIDTH = 560;

// The shell's standard horizontal gutter (ui-design-rules §1).
export const SHELL_GUTTER = 16;

// React Native's iOS Modal defaults to portrait-only; with the app unlocked a
// modal opened in landscape would otherwise force a rotation. Android ignores
// this prop and follows the activity.
export const MODAL_SUPPORTED_ORIENTATIONS = [
  'portrait',
  'portrait-upside-down',
  'landscape',
  'landscape-left',
  'landscape-right',
];

// Horizontal offsets for a column centered in `windowWidth`. Each side keeps at
// least the shell gutter plus that side's safe-area inset (a landscape display
// cutout or side navigation bar), and grows symmetrically once the window is
// wider than the capped column. The content between the offsets never exceeds
// `maxWidth` minus both gutters.
export function centeredColumnInsets(windowWidth, { left = 0, right = 0 } = {}, maxWidth = CONTENT_MAX_WIDTH) {
  const minLeft = SHELL_GUTTER + left;
  const minRight = SHELL_GUTTER + right;
  const slack = Math.max(0, windowWidth - minLeft - minRight - (maxWidth - 2 * SHELL_GUTTER));
  return { left: minLeft + slack / 2, right: minRight + slack / 2 };
}

// Width cap for a dialog or sheet; spreads into an existing sheet style.
export const dialogWidthStyle = { width: '100%', maxWidth: DIALOG_MAX_WIDTH, alignSelf: 'center' };

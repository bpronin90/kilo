// Spacing and geometry tokens for the Kinetic Utilitarian Athletic design system.
// Source: docs/design/kinetic-utilitarian-athletic/foundation.md
// Values are immutable; consumers must not mutate these objects.

// ---------------------------------------------------------------------------
// Spacing
// ---------------------------------------------------------------------------

export const SPACING = Object.freeze({
  'space-xs': 4,
  'space-sm': 8,
  gutter: 12,
  'space-md': 12,
  margin: 16,
  'space-lg': 20,
  'gutter-desktop': 20,
  'space-xl': 32,
  'margin-desktop': 32,
});

// ---------------------------------------------------------------------------
// Geometry (border radius)
// ---------------------------------------------------------------------------

// radius-full uses '50%' as specified in foundation.md. React Native 0.81+
// accepts percentage strings for borderRadius on views where width equals height.
export const GEOMETRY = Object.freeze({
  'radius-xs': 2,
  'radius-sm': 4,
  'radius-md': 6,
  'radius-lg': 8,
  'radius-xl': 12,
  'radius-2xl': 16,
  'radius-full': '50%',
});

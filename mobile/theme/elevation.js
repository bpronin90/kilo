// Border and elevation tokens for the Kinetic Utilitarian Athletic design system.
// Source: docs/design/kinetic-utilitarian-athletic/foundation.md
//
// The system uses structural line work, not ambient shadows. Shadow styles are
// used only on primary cards (level 3) and overlays (level 4) as a subtle depth
// signal — never as the primary visual separator. Border colors are theme-specific
// and must be applied by the consumer from the color token set; only borderWidth
// is encoded here.
//
// Values are immutable; consumers must not mutate these objects.

export const BORDERS = Object.freeze({
  // Level 0 — Canvas: app background, flat surface, no border.
  canvas: Object.freeze({}),
  // Level 1 — Card: content containers, 1px structural border.
  card: Object.freeze({ borderWidth: 1 }),
  // Level 2 — Active card: primary routine card / focused state, 2px border.
  // Border color must be the theme primary color, applied by the consumer.
  activeCard: Object.freeze({ borderWidth: 2 }),
  // Level 3 — Elevated card: dark-mode primary cards, 2px primary border + shadow.
  // Border color must be the theme primary color, applied by the consumer.
  elevatedCard: Object.freeze({ borderWidth: 2 }),
  // Level 4 — Overlays: modals and bottom sheets, 1px border + shadow.
  overlay: Object.freeze({ borderWidth: 1 }),
});

// Elevation level map. foundation.md §Borders and elevation defines five named
// levels (0–4); these are the roles the spec approves. Concrete shadow recipes
// (shadowColor, shadowOffset, shadowOpacity, shadowRadius) are not specified in
// foundation.md and must not be invented here. The integer values are valid as
// the Android `elevation` style prop and as ordering/comparison tokens.
export const ELEVATION = Object.freeze({
  canvas: 0,
  card: 1,
  activeCard: 2,
  elevatedCard: 3,
  overlay: 4,
});

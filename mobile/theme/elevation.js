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

// Shadow style objects keyed by level. Level 0–2 carry no shadow.
// iOS uses shadowColor/shadowOffset/shadowOpacity/shadowRadius.
// Android uses elevation. Both are included so consumers can spread directly.
export const ELEVATION = Object.freeze({
  0: Object.freeze({}),
  1: Object.freeze({}),
  2: Object.freeze({}),
  3: Object.freeze({
    shadowColor: '#000000',
    shadowOffset: Object.freeze({ width: 0, height: 2 }),
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 3,
  }),
  4: Object.freeze({
    shadowColor: '#000000',
    shadowOffset: Object.freeze({ width: 0, height: 4 }),
    shadowOpacity: 0.16,
    shadowRadius: 8,
    elevation: 6,
  }),
});

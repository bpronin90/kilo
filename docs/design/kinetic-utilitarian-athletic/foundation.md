# Kinetic Utilitarian Athletic — Shared Foundation

This document covers the elements shared across all three themes and six designs. Theme-specific color tokens are in `tokens.md`.

---

## Typography

Two typefaces with strict division of labor. Both must be locally bundled in the app distribution; no runtime download dependency is permitted.

### Space Grotesk

Role: all linguistic content — screen titles, exercise names, navigation labels, body copy, UI commands, section headers.

License: SIL Open Font License 1.1. Permissive; no attribution required in product UI.

| Role token | Size | Weight | Line height | Tracking |
|---|---|---|---|---|
| `headline-xl` | 40px | 700 | 44px | −0.03em |
| `headline-xl-mobile` | 32px | 700 | 36px | −0.02em |
| `headline-lg` | 28px | 600 | 32px | −0.02em |
| `headline-md` | 22px | 600 | 28px | −0.01em |
| `headline-sm` | 18px | 600 | 24px | 0 |
| `body-lg` | 16px | 400 | 24px | 0 |
| `body-md` | 14px | 400 | 20px | 0 |
| `body-sm` | 13px | 400 | 18px | 0 |

Screen titles use `headline-sm` (18px/600) in uppercase with tight tracking. Navigation labels use `label-sm` (see below).

### JetBrains Mono

Role: all quantitative and temporal values — kilos, reps, RPE ratings, set numbers, plate breakdowns, stopwatch digits, session metrics.

License: SIL Open Font License 1.1. Permissive.

| Role token | Size | Weight | Line height | Tracking |
|---|---|---|---|---|
| `metric-display` | 36px | 700 | 40px | −0.02em |
| `metric-display-mobile` | 28px | 700 | 32px | −0.01em |
| `label-lg` | 14px | 600 | 20px | +0.02em |
| `label-md` | 12px | 500 | 16px | +0.04em |
| `label-sm` | 11px | 500 | 14px | +0.06em |

All numeric metric indicators (`label-sm`, `label-md`) use uppercase tracking for rapid scan-readability. Use `tabular-nums` / `font-variant-numeric: tabular-nums` on all metric values to prevent layout shifting during live logging.

### Font loading and fallback

Fonts must be pre-bundled in the app distribution (Expo asset bundling). Do not load from Google Fonts or any CDN at runtime. Fallback stack: `Space Grotesk → system-ui → sans-serif`; `JetBrains Mono → Menlo → Courier New → monospace`.

Dynamic type: Scale with the device text-size preference using Expo's `useWindowDimensions` + `PixelRatio.getFontScale()`. Do not cap or override the system font scale; React Native text already follows the system scale natively. Dense data tables and exercise rows must reflow or scroll at larger text sizes rather than imposing an artificial scaling ceiling. This preserves the existing app behavior.

---

## Spacing

| Token | Value |
|---|---|
| `space-xs` | 4px (0.25rem) |
| `space-sm` | 8px (0.5rem) |
| `gutter` | 12px (0.75rem) |
| `space-md` | 12px (0.75rem) |
| `margin` | 16px (1rem) |
| `space-lg` | 20px (1.25rem) |
| `gutter-desktop` | 20px (1.25rem) |
| `space-xl` | 32px (2rem) |
| `margin-desktop` | 32px (2rem) |

Screen-edge gutters are `margin` (16px) on phone. Component internal padding favors compact vertical breathing space (`space-xs`–`space-sm`) with generous horizontal hit regions (`space-md`–`space-lg`) for thumb input under physical strain.

---

## Geometry (border radius)

| Token | Value | Use |
|---|---|---|
| `radius-xs` | 2px | Inline badges, tight indicators |
| `radius-sm` | 4px | Buttons, small chips, TRACK button |
| `radius-md` | 6px | Standard card internal sections |
| `radius-lg` | 8px | Segmented control pills |
| `radius-xl` | 12px | Pill chips, completion states |
| `radius-2xl` | 16px | Primary routine card, main surface cards |
| `radius-full` | 50% | Avatar circles, status dots |

Primary routine cards use `radius-2xl` (16px). Buttons and TRACK elements use `radius-sm` (4px). Completion/tracked states may use `radius-xl` (12px) pill shape. Arbitrary and decorative radii are not used — every value must map to a token.

---

## Borders and elevation

The system uses structural line work, not ambient shadows. Shadows are used only on primary cards and then only as a subtle depth signal, never as the primary visual separator.

| Level | Description | Treatment |
|---|---|---|
| 0 — Canvas | App background | Flat colored surface (theme-specific) |
| 1 — Card | Content containers | 1px border, `radius-2xl` or `radius-lg` |
| 2 — Active card | Primary routine card, focused state | 2px border in theme primary color |
| 3 — Elevated card | Dark-mode primary cards | 2px primary border + subtle shadow |
| 4 — Overlays | Modals, bottom sheets | Solid surface + 1px border + `elevation-4` shadow |

Section dividers within cards use 1px horizontal rules in the surface-border token. Tab-bar border: 1px top in surface-border token.

---

## Icons

Material Symbols Outlined is the icon set used in the templates. For Kilo's React Native implementation:

- Use `@expo/vector-icons` (MaterialCommunityIcons or MaterialIcons) or a locally bundled icon font. Do not depend on a CDN-loaded icon font at runtime.
- Icon size: 20–24dp for action icons; 16dp for inline/label icons; 22–24dp for tab bar.
- Tab bar icons: `home`, `exercise`/`fitness_center` (Log), `monitor_weight` (Weight), `bar_chart` (Analytics), `more_horiz` (More). Active tab icon uses theme primary color; inactive tabs use `on-surface-variant` token.
- Touch target: 44×44dp minimum for all tappable icons (existing production rule).

---

## Motion

- Default transition: 150ms ease-in-out for color/opacity changes (button press, tab selection).
- Card state transitions: 200ms ease-out.
- TRACK button completion: instantaneous fill (< 100ms) to communicate immediacy.
- Reduced motion: All transitions and animations must respect `prefers-reduced-motion`. In React Native, use `AccessibilityInfo.isReduceMotionEnabled()` to gate animated state changes. When reduced motion is active, show final states immediately with no transition.
- No parallax, no spring physics for navigation (Kilo's existing navigation behavior is preserved).

---

## Accessibility

- WCAG 2.1 AA minimum for all text on all surfaces in all six theme/mode designs. See `tokens.md` for measured contrast values.
- Meaning is never conveyed by color alone. Success (✓ Tracked), error, and warning states must have a non-color indicator (checkmark, icon, label text). Chart data series must be distinguishable without color (pattern, label, or shape).
- Tab bar active state: color change + bold label (not color alone).
- Touch targets: 44×44dp per current production standard; Track-toggle exception remains.
- Safe-area insets: honored on all surfaces via `SafeAreaView` and `useSafeAreaInsets()`.

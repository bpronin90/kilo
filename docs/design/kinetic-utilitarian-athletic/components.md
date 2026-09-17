# Component Rules

Rules for all shared components. Token names refer to the per-theme palette defined in `tokens.md`. "Primary" means the theme-specific primary token.

---

## Buttons

### Primary action button

- Background: `primary`
- Text: `on-primary`, `label-md` (JetBrains Mono, uppercase)
- Border: none
- Radius: `radius-sm` (4px)
- Min height: 44dp (touch target)
- Pressed state: darken background by 10%; scale 0.97 with 150ms ease-out (reduced motion: skip scale)

### Secondary / ghost button

- Background: transparent
- Text: `primary`, `label-md`
- Border: 1px `primary`
- Radius: `radius-sm`
- Min height: 44dp
- Pressed state: fill background with `primary-container`

### TRACK button (exercise row action)

The TRACK button is the primary per-exercise action and is owner-approved to be smaller than the 44dp standard because each exercise row contains multiple elements and the row itself absorbs the hit area.

- **Untracked state:**
  - Background: `primary-container`
  - Text: `primary-on-container`, `label-sm` (JetBrains Mono, uppercase)
  - Border: 1px `primary-container-border`
  - Radius: `radius-sm`
  - Padding: 4px 10px
- **Tracked / completion state:**
  - Background: `primary` or `completion` (theme-dependent; see surface mappings)
  - Text: `on-primary`
  - Radius: `radius-sm` (or `radius-xl` pill in some themes)
  - Indicator: ✓ prefix before "Tracked" label — not color alone

### Danger button

- Background: `error` (`#BA1A1A` shared across all themes)
- Text: `#FFFFFF`
- Reserved for destructive actions (delete, clear, reset)

---

## Inputs

- Height: 44dp
- Background: `surface-card`
- Border: 1px `surface-border`
- Radius: `radius-sm`
- Text: `on-surface`, `body-md`
- Placeholder: `on-surface-variant`
- Focus: border becomes 2px `primary`; no glow spread
- Font: JetBrains Mono for numeric/metric inputs; Space Grotesk for text inputs
- Numeric inputs: `tabular-nums`, centered, `label-lg`

---

## Cards

### Primary routine card

The main workout card on the Log screen. This is the visual anchor of the exercise session.

- Background: `surface-card`
- Border: 2px `primary`
- Radius: `radius-2xl` (16px)
- Internal card header: `surface-card-header` background with 1px `surface-border` bottom
- Section header rows: `surface-section` background with 1px `surface-border` top/bottom
- Exercise rows: `surface-card` background, 1px `surface-border` divider between rows
- Shadow: theme-dependent (see tokens.md dark variants for elevated shadow values)

### Standard content card

- Background: `surface-card`
- Border: 1px `surface-border`
- Radius: `radius-lg` or `radius-2xl` depending on context
- No shadow in light mode; subtle shadow in dark mode

---

## Segmented control (Recovery / Routine)

- Container background: `surface-low` or `surface-seg` (theme-specific)
- Container border: 1px `surface-border`
- Container radius: `radius-lg` (8px) or `radius-xl` (10px) — pill shape on Clay/Grass
- Active segment: `primary` fill, `on-primary` text, `radius-md`–`radius-lg`
- Inactive segment: transparent, `on-surface-variant` text
- Typography: `label-md`, uppercase, tracked
- Active dot indicator: small `on-primary`/`primary-container-border` filled circle before "Routine" label

---

## Section header rows (within cards)

- Background: `surface-section` or `surface-subtle`
- Border: 1px `surface-border` top and bottom
- Accent bar: 3px × 14dp rounded rectangle in `primary`, left-aligned
- Title: `on-surface`, `headline-sm`, uppercase
- Right tag (e.g., "Warmup", "Working Sets"): `on-surface-variant` or `primary-light` (dark mode), `label-sm`

---

## Tab bar

- Background: `tab-bar-bg`
- Border: 1px `surface-border` top
- Items: icon + label, stacked vertically, centered per tab
- Active item: `primary` icon and label
- Inactive items: `on-surface-variant` icon and label
- Label typography: `label-sm`, uppercase
- Icon size: 22–24dp
- Five tabs (left to right): Home, Log, Weight, Analytics, More
- No badge counts visible on the tab bar in this design iteration
- Touch target: each tab covers its full flex-1 width; minimum 44dp height

---

## Page header

- Background: `header-bg` with slight transparency/blur for scroll contexts
- Border: 1px `surface-border` bottom
- Screen title: `headline-sm`, uppercase, `on-surface`
- Screen subtitle: `body-sm`, `on-surface-variant`
- Avatar button: 32dp circle in `primary` (light) or `surface-card-header` with `primary`/`primary-light` icon (dark)

---

## Charts

Charts use a theme-neutral data palette — the theme primary color is not used for data series. This ensures chart meaning is consistent across theme switches.

### Line / area charts (Weight screen)

- Line series: theme-neutral color set (`chart-series-1` teal `#0C7489` light / `#22D3EE` dark; `chart-series-2` orange `#C2410C` light / `#F59E0B` dark; `chart-series-3` violet `#7C3AED` light / `#A78BFA` dark). Never use the theme primary for a data series.
- Grid lines: `surface-border`
- Axis labels: `on-surface-variant`, `label-sm`
- Background: `surface` / `surface-card`
- Tooltip/callout: `surface-card-header` background, `on-surface` text, 1px `surface-border`
- PR highlight: `completion` color with ✓ marker — not primary, not a data series color

### Bar charts (Analytics screen)

Same neutral color set for series. Completion/goal attainment overlays use `completion`.

### Accessible chart requirements

- Every data series has a label or a tooltip accessible via screen reader, not only a color fill.
- No two adjacent series may differ only in hue without also differing in pattern or label proximity.
- `accessibilityLabel` is set on all chart elements in React Native.

---

## Overlays and modals

- Background: `surface-card`
- Border: 1px `surface-border`
- Radius: `radius-2xl`
- Scrim: `rgba(0,0,0,0.5)` in light mode; `rgba(0,0,0,0.7)` in dark mode
- Dismiss: tap outside scrim, or explicit close button — no swipe-down-to-dismiss unless Kilo already implements it
- Reduced motion: skip entry animation; overlay appears immediately

---

## Status dots and indicators

- Active/live indicator: small filled circle in `primary` (light) or `primary-neon` with glow (dark; respect reduced motion — remove glow and animate-pulse when reduce-motion is active)
- Paused: `on-surface-variant` dot
- Error: `error` dot

---

## Native controls

Kilo uses React Native's native appearance system (`ThemeContext.applyNativeAppearance()`). The following controls defer to native rendering:

- `Switch` (toggle)
- `DateTimePicker`
- `ActionSheetIOS` / Android bottom sheet

For these controls, the KUA design does not override their default native rendering. Adjacent labels and container backgrounds should use KUA tokens so surrounding UI is consistent even when the control itself is native-styled.

The no-overflow-menu rule is preserved: Kilo does not use three-dot overflow menus for primary navigation or common actions. The template `more_vert` icon in card headers is template-only; in Kilo it maps to explicit action buttons.

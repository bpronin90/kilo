# Kilo Surface Mappings and Template Adaptations

This document maps the KUA design system to each Kilo product surface and documents where templates are adopted, adapted, or rejected.

---

## Surface overview

| Screen | Tab | Template coverage | Adaptation needed |
|---|---|---|---|
| Log (Workout Notes) | Log | Full — all six screen.png files show this screen | Routine card, exercise rows, TRACK buttons, segmented control, tab bar |
| Home | Home | Partial — no dedicated Home template | Derive from foundation tokens + current production layout |
| Weight | Weight | None | Derive from foundation tokens + existing chart treatment |
| Analytics | Analytics | None | Derive from foundation tokens + existing chart treatment |
| More | More | None | Derive from foundation tokens |
| Settings | More → Settings | None | Derive from foundation tokens |
| Account | More → Account | None | Derive from foundation tokens |
| Backup | More → Backup | None | Derive from foundation tokens |

---

## Log screen (Workout Notes)

The template fully specifies this screen in all six designs. Implementation must match the approved visual direction.

### Structure

```
Page header
  - "WORKOUT NOTES" title (headline-sm, uppercase)
  - Subtitle: "Your active training routine. Update it as you go." (body-sm, on-surface-variant)
  - Avatar button (32dp circle, primary bg)

Segmented control
  - [Recovery] [● Routine]
  - Active: primary fill, on-primary text
  - Inactive: on-surface-variant text

Primary routine card (surface-card, 2px primary border, radius-2xl)
  Card header
    - Routine name (headline-md, primary color)
    - Active badge (primary-container bg, primary-on-container text)
    - Week / status line (body-sm, on-surface-variant)
    - Action chips: [Week B] [Remove skip]

  Section header row (surface-section bg, primary accent bar)
    - Day label (headline-sm, uppercase)
    - Phase tag (label-sm, on-surface-variant)

  Exercise rows (surface-card bg, 1px surface-border top)
    - Exercise name (body-lg or headline-sm, on-surface)
    - Session data — vertical stack of JetBrains Mono numbers (label-md, on-surface-variant)
    - TRACK button (aligned right, primary-container or primary fill when tracked)

Tab bar (tab-bar-bg, 1px surface-border top)
  - Home | Log (active) | Weight | Analytics | More
```

### Template adaptations

| Template element | Kilo treatment | Reason |
|---|---|---|
| Tournament branding ("Arthur Ashe Court", "Roland Garros", "Wimbledon") | Removed entirely | Template-only flavor; not a Kilo product concept |
| Material Symbols CDN icon font | Locally bundled icon equivalent | No runtime CDN dependency |
| `animate-pulse` on status dots | Respects `AccessibilityInfo.isReduceMotionEnabled()` | Reduced-motion support |
| `more_vert` overflow icon in card header | Not carried — Kilo uses explicit action buttons | No-overflow-menu rule |
| Hero context ribbon ("Session Ready · Arthur Ashe") | Not carried | Template-only decoration |
| Tailwind, CDN dependencies, Google Fonts loading | Not carried | Template is not production code |
| Hard Court dark: `#10B981` green for "WARMUP" section tag | Use `on-surface-variant` or `primary-light` | Hard Court section tags should use the theme's own accent palette, not an external green |

---

## Home screen

The Home screen has no dedicated template. Apply KUA tokens and current product layout.

- Background: `background`
- Cards: standard content card treatment (`surface-card`, 1px `surface-border`, `radius-2xl`)
- Section headings: `headline-sm`, uppercase, `on-surface`
- Metric values: JetBrains Mono (`metric-display-mobile` or `label-lg`), `on-surface`
- Secondary labels: `body-sm`, `on-surface-variant`
- Empty states: centered body-md in `on-surface-variant`
- Behavior: unchanged — current Home screen content and navigation are preserved

---

## Weight screen

No template coverage. Apply KUA tokens to the existing weight-entry, goal, and history surfaces.

- Screen background: `background`
- Weight entry section: `surface-card` bg, `on-surface` label, JetBrains Mono numeric input
- Goal section: standard content card treatment
- Weight history list: `surface-card` bg, `surface-border` dividers, `on-surface-variant` metadata
- Empty states: centered `body-md` in `on-surface-variant`
- Behavior: current weight entry, goal, unit logic, and history are unchanged

> **Note:** The weight-trend `LineChart` callers (`AnalyticsWeightTrendsCard` 7-day and 30-day rolling averages) live on the Analytics screen, not WeightScreen. Chart token treatment is documented under Analytics below.

---

## Analytics screen

Charts and metric tiles; no template coverage. Apply KUA tokens.

- Screen background: `background`
- Tile cards: standard content card treatment
- **Weight trends charts** (`AnalyticsWeightTrendsCard` — 7-day and 30-day rolling averages):
  - Data line: theme-neutral teal (`#0C7489` light; `#22D3EE` dark) — not the theme primary
  - PR markers: `completion` color + ✓ icon
  - Callout/tooltip: `surface-card` bg, `on-surface` text
  - Period selector: segmented control treatment without dot indicator
  - Chart grid lines: `surface-border`; axis labels: `on-surface-variant`, `label-sm`
- **Strength chart** (`AnalyticsStrengthSection` — 1K total over sessions): same teal series treatment
- Bar chart series (other): theme-neutral orange (`#C2410C` light; `#F59E0B` dark) for primary series; additional series use violet, teal
- Metric tiles: `metric-display-mobile` (JetBrains Mono 700), `on-surface`; label `label-sm`, `on-surface-variant`
- Section headings: same as Home
- Behavior: current analytics calculations, data access, and navigation are unchanged

---

## More screen

Navigation list; no template coverage.

- Background: `background`
- List items: `surface-card` bg, `on-surface` label, `on-surface-variant` secondary label
- Dividers: `surface-border`
- Navigation arrows/chevrons: `on-surface-variant`
- Destructive actions (if any): `error` text, standard list row treatment
- Behavior: unchanged

---

## Settings, Account, Backup screens

These screens share the same treatment as More. No template coverage. Apply KUA tokens.

- Background: `background`
- Section headers: `on-surface-variant`, `label-sm`, uppercase — above groups of related settings
- Input rows: `surface-card` bg, `on-surface` label
- Toggle inputs: native Switch control (no KUA override)
- Behavior: all settings logic, account management, and backup/restore flows are unchanged

---

## Responsive behavior

Kilo is a phone-first app. On tablet:

- Max content width: 600dp centered on canvas
- Tab bar: standard bottom tab bar (no sidebar)
- Card widths: constrained to max content width
- Typography: same scale as phone (no upscaling at tablet width)
- Layout: single-column stack maintained

Existing React Native layout behavior is not changed by this design system. No multi-pane layout is introduced (the DESIGN.md tablet spec is template-only and does not apply to Kilo's current architecture).

---

## Theme/mode persistence

The existing `themePreference` mechanism (`mobile/lib/themePreference.js`) accepts only `light`, `dark`, and `system` — it stores the appearance mode, not the palette theme. Theme selection (Hard Court / Clay Court / Grass Court) requires a **separate** persisted preference key alongside the existing appearance key.

The Phase 3 D5 theme-preview and selection-plumbing card must establish this
state before Phase 4 screen migration begins. The Phase 5 production picker
reuses it rather than introducing a second preference. D5 must:
- Add a `kilo.theme_selection` key (or equivalent) to AsyncStorage, independent of `kilo.appearance_preference`.
- Accept `hard-court`, `clay-court`, or `grass-court`; default to `hard-court`.
- Keep `ThemeContext` logic: the appearance preference continues to resolve `light`/`dark`/`system`; the theme selection picks which of the three palettes to apply for that mode.
- System appearance synchronization via `ThemeContext.applyNativeAppearance()` is preserved.
- The `kilo.appearance_preference` key, its normalization, and the `setAppearancePreference` / `useAppearancePreference` API are unchanged.

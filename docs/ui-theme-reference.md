# Theme Runtime and Compatibility Reference

For UI maintainers tracing court/mode selection and legacy semantic-color compatibility. The approved court values belong to the [KUA token specification](design/kinetic-utilitarian-athletic/tokens.md).

`ThemeContext.js` publishes both legacy `colors` and the selected `kuaPalette`.
`KuaStyleGate` supplies the court palette to production styles; isolated renders
can use the legacy fallback. The orange/indigo tables below describe that fallback,
not the six production court palettes. Their contrast evidence is retained for
compatibility and does not authorize replacing the active KUA design.

## Appearance Modes

Source: `mobile/theme/colors.js`, `mobile/theme/ThemeContext.js`,
`mobile/lib/themePreference.js`

The compatibility path retains **Light** and **Dark (indigo)** palettes sharing the
brand-orange accent `#d98d42`. There is no static `Colors` export and no mutable
global palette: components read the active palette from `useTheme()` and build
their sheets with `useThemedStyles(createStyles)`, so a preference or OS scheme
change repaints every mounted surface without a reload.

- Preference values: `light`, `dark`, `system`. Missing or invalid resolves to
  `system`.
- Persisted at AsyncStorage key `kilo.appearance_preference` (dot-namespaced so
  the `kilo_` account-switch purge does not wipe a device display setting).
- `system` resolves through React Native `useColorScheme()`, defaulting to light
  when the platform reports no scheme.
- `ThemeProvider` is mounted in `App.js` **above** `AppShell`, so the outermost
  container, safe area, status bar, tab bar, screens, and modals all share one
  resolved palette.
- Chosen from **More → Settings → Appearance** via a three-way segmented
  control that follows the existing `unitToggle` visual convention.

## Court Theme Picker

Source: `mobile/components/ThemeSelectionControl.js`, `mobile/lib/themePreference.js`

The production court theme picker lives in **More → Settings → Appearance**, directly
above the Light/Dark/System appearance control. It is shown in all builds; the
development-only `ThemePreviewControl` and DEV PREVIEW Settings section have been
removed (#1136).

- Theme values: `hard-court`, `clay-court`, `grass-court`. Missing or invalid normalizes
  to `hard-court`.
- Persisted at AsyncStorage key `kilo.theme_selection` (dot-namespaced, same account-switch
  exclusion as `kilo.appearance_preference`).
- Rendered by `ThemeSelectionControl`: a three-option segmented row labelled **Court**, each
  option showing its full name (Hard Court, Clay Court, Grass Court) with a 44×44dp touch
  target. The selected option is distinguished by both fill color and font weight (satisfying
  the "without color alone" accessibility requirement).
- The selection and the Light/Dark/System appearance choice are fully independent: changing
  one never alters the other.

## Color Palette

Source: `mobile/theme/colors.js`

| Token | Light | Dark | Role |
|---|---|---|---|
| `background` | `#f7f2ea` | `#100f1a` | Global scroll background |
| `card` | `#ffffff` | `#1e1c2c` | Card fill (dark keeps a deliberate elevation jump from `background`) |
| `cardBorder` | `rgba(34,28,23,0.1)` | `rgba(217,141,66,0.28)` | Card stroke, dividers, separators. Uniform 1px on every ordinary card; accent-tinted in dark |
| `accent` | `#d98d42` | `#d98d42` | Primary brand orange — fills, strokes, marks, chart lines, active states. **Not for text**; use `accentText` (#908) |
| `text` | `#221c17` | `#f2f0f7` | Primary text |
| `textMuted` | `#6b6259` | `#a29fb3` | Secondary/support text |
| `textLight` | `#faf6f0` | `#f2f0f7` | Text on filled tone surfaces |
| `tabBarBackground` | `#201914` | `#1e1c2c` | Bottom tab bar |
| `tabInactive` | `#8a8177` | `#6a6780` | Inactive tab icons |
| `inputBackground` | `#fbf8f3` | `#242235` | Text input fill |
| `inputBorder` | `rgba(34,28,23,0.16)` | `rgba(217,141,66,0.28)` | Text input stroke |
| `chipBackground` | `#f3ddc0` | `rgba(217,141,66,0.32)` | Chip/badge/highlight fill |
| `chipText` | `#96571c` | `#ffc98a` | Chip/badge text |
| `success` | `#4a7c44` | `#7ed968` | Green — direct status marks and text |
| `error` | `#b03a2e` | `#f2705c` | Red — direct status marks and text |
| `caution` | `#c98f1a` | `#f2b94a` | Yellow — direct status marks, dots, meter segments. **Not for text**; use `cautionText` (#908) |
| `divider` | `rgba(31,26,23,0.05)` | `rgba(255,255,255,0.08)` | Subtle separator overlay |
| `subtleBg` | `rgba(34,28,23,0.04)` | `rgba(255,255,255,0.06)` | Very subtle tinted background — history/column header rows |
| `panelBackground` | `#ffffff` | `#1e1c2c` | Panel/section background |

### Derived semantic tokens

These carry the pairings that would otherwise be unreadable in one of the two
modes. Every ratio below is asserted automatically in
`mobile/tests/theme-rendering.test.js`.

| Token | Light | Dark | Role and measured contrast |
|---|---|---|---|
| `cardAccentBg` | `#96571c` | `#7a4a14` | Filled accent tone card/badge, label `textLight` — 5.30:1 / 6.60:1 |
| `cardSuccessBg` | `#3a6035` | `#2f5a28` | Filled success tone, label `textLight` — 6.72:1 / 7.11:1 |
| `cardCautionBg` | `#7f6310` | `#6b5210` | Filled caution tone, label `textLight` — 5.28:1 / 6.54:1 |
| `cardErrorBg` | `#b03a2e` | `#8a2f24` | Filled error tone, label `textLight` — 5.59:1 / 7.40:1 |
| `buttonLabel` | `#faf6f0` | `#100f1a` | Label on the shared Button (background is `text`) — 15.65:1 / 16.81:1 |
| `onAccent` | `#221c17` | `#100f1a` | Label on small accent-filled controls (segmented tabs, confirm, checkmarks) — 6.29:1 / 7.09:1 |
| `accentText` | `#8a4e15` | `#d98d42` | Accent-colored **copy** on `card` / `background` / `subtleBg` — 6.60:1, 5.92:1, 6.11:1 / 6.23:1, 7.09:1, 5.24:1. Never on a chip fill: use `chipAccentText` |
| `cautionText` | `#6f5510` | `#f2b94a` | Caution-colored **copy** on `card` / `background` / `subtleBg` / `chipBackground` — 7.04:1, 6.32:1, 6.51:1, 5.34:1 / 9.39:1, 10.69:1, 7.89:1, 5.33:1 |
| `chipAccentText` | `#8a4e15` | `#ffc98a` | Accent-colored **copy** that can land on a `chipBackground` fill in any state (#918, #923) — `card` / `background` / `subtleBg` / `chipBackground` / `errorSurface` — 6.60:1, 5.92:1, 6.11:1, 5.00:1, 5.78:1 / 11.11:1, 12.64:1, 9.33:1, 6.31:1, 10.03:1 |
| `errorSurface` | `#fdeceb` | `#3a1f1c` | Tinted error surface, label `error` — 5.26:1 / 5.20:1 |
| `cautionSurface` | `#f7ecd2` | `#2e2717` | Tinted caution surface (fatigue alert) — see `cautionSurfaceText` |
| `cautionSurfaceText` | `#7f6310` | `#f2b94a` | Ink on `cautionSurface` — 4.84:1 / 8.33:1 |
| `roughBackground` | `#fbeee0` | `#2a2338` | "Rough session" tier surface, label `chipText` — 5.01:1 / 10.01:1 |
| `roughBorder` | `#e5c49c` | `rgba(217,141,66,0.32)` | Rough tier stroke |
| `overlay` | `rgba(31,26,23,0.55)` | `rgba(0,0,0,0.65)` | Modal scrim |
| `shadowColor` | `#000000` | `#000000` | Tab bar / panel shadow ink |

The `card*Bg` tokens are used only for *filled* tone surfaces (UI.js
Card/StatCard tone variants, trend badges, pace badges, error banners). The
direct `success`/`caution`/`error`/`accent` values are for status marks, dots,
meter segments, strokes, and chart lines — dark mode intentionally uses the
brighter supplied values there, which is exactly why they cannot back a
`textLight` label.

**Text vs. mark (#908).** `accent` and `caution` are *mark* colors and must not
be used as a text `color`: in light mode they measure 2.68:1 and 2.83:1 against
`card`, well under AA. Anything the user reads uses `accentText` /
`cautionText` instead. The split is by role, not by component — the same screen
may draw an `accent` dot beside an `accentText` label. `success` and `error`
need no equivalent: both already clear AA as light-mode copy.

Both inks are darker than the obvious `chipText` / `cautionSurfaceText` reuse
because accent and caution copy also lands on `chipBackground`: the Settings
stepper, the Big 3 slot picker's selected row, Recovery's retry button, Home's
sync notice, and the weight history list's pressed rows. A new pairing must be
measured against every surface the string can sit on, pressed states included.
Those five accent strings now carry `chipAccentText` rather than `accentText`
(#923); the rule that produced the darker inks still governs `cautionText`.

Two call sites keep the mark value on purpose and are not text for this rule:
the trend glyphs in `AnalyticsCrossDayComparison.js` (`↔` / `—` / `↑` / `↓`,
which are icon substitutes sitting beside `MaterialIcons` arrows) and the
outlined `!` + count validation badge in `LogScreenEditorCard.js`, whose glyph
matches its own ring stroke.

**`chipAccentText` is the ink for accent copy on a chip fill.** Not just for new
work: as of #923 no shipping surface pairs `accentText` with `chipBackground` in
any state, so the former "dark `accentText` on `chipBackground` 3.54:1" gap is
retired rather than tolerated. `chipAccentText` clears AA on that fill in both
modes (5.00:1 / 6.31:1) and on every other text surface too, so a string that
sits on a chip in only *some* state carries it in all of them. It invents no
color: light is `accentText`'s light value, dark is `chipText`'s dark value.

The 3.54:1 measurement is still pinned in `mobile/tests/theme-rendering.test.js`,
repurposed — it now records why `accentText` is unfit for that fill rather than a
gap the app ships. The five surfaces migrated in #923 are `SettingsScreen.js`
`stepperText`, `AnalyticsStrengthSection.js` `slotOptionTextSelected` (selected),
`AnalyticsRecoverySection.js` `stateRetryText`, `WeightHistoryList.js`
`loadMoreText` (pressed), and `HomeScreen.js` `syncNoticeActionText`.

That last one is the only dual-fill site: the sync notice paints
`chipBackground` while a sync is pending and `errorSurface` once it fails, with
the same action label on both. `chipAccentText` was measured against both rather
than assumed — 5.78:1 light / 10.03:1 dark on `errorSurface` — so one ink covers
both states. The notice's *title* still switches to `error` on failure; only the
action label is shared.

**Known gap:** `chipText` on `chipBackground` in light mode measures 4.33:1,
just under AA for normal text. Both values are contractually fixed by the #689
approved palette, so this is recorded rather than adjusted; dark mode is fine at
11.11:1.

### Hardcoded Color Leaks (not in colors.js)

| File | Reference | Value | Used For |
|---|---|---|---|
| `components/KiloWordmark.js` | KiloWordmark SVG (Home title and startup overlay) | `#FF5C00` | KiloWordmark SVG accents (brand mark, intentionally fixed in both modes) |

This is now the complete list: every other visual color in the migrated
production surfaces resolves through a palette token.

---

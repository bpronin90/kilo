# Design System Map

Audit of every style token across all screens, organized by role. Use this to find exactly where to change any visual property.

Last updated: 2026-07-27
Source branch: `issue/689-appearance-modes`

Reconciled after the #383→#413 UI cleanup (tab-spacing polish, unified
Weight/Goal history panel system, standardized collapse convention, analytics
hierarchy fixes), then after the #689 appearance-mode rollout (two palettes,
`useTheme()`/`useThemedStyles()` migration, derived semantic tokens). For the
*rules* derived from these patterns see `docs/ui-design-rules.md`; this map
records the *current values*.

`colors.<token>` below means the active palette read from `useTheme()` — there
is no static `Colors` object any more. Every token resolves to a Light and a
Dark value; see the Color Palette table.

Line numbers below are accurate for the sections touched by that cleanup
(tokens, ScreenShell, the history-panel system, Weight Screen, Analytics
collapse/PO). Home and Log sections predate the cleanup and were not in scope;
treat their line numbers as approximate. The #689 migration moved each
stylesheet into a `createStyles(colors)` factory, shifting line numbers within
every migrated file.

---

## Appearance Modes (#689)

Source: `mobile/theme/colors.js`, `mobile/theme/ThemeContext.js`,
`mobile/lib/themePreference.js`

Kilo ships two complete palettes — **Light** and **Dark (indigo)** — sharing the
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

## Color Palette

Source: `mobile/theme/colors.js`

| Token | Light | Dark | Role |
|---|---|---|---|
| `background` | `#f7f2ea` | `#100f1a` | Global scroll background |
| `card` | `#ffffff` | `#1e1c2c` | Card fill (dark keeps a deliberate elevation jump from `background`) |
| `cardBorder` | `rgba(34,28,23,0.1)` | `rgba(217,141,66,0.28)` | Card stroke, dividers, separators. Uniform 1px on every ordinary card; accent-tinted in dark |
| `accent` | `#d98d42` | `#d98d42` | Primary brand orange — hero metrics, CTAs, active states |
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
| `caution` | `#c98f1a` | `#f2b94a` | Yellow — direct status marks and text |
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
| `onAccent` | `#ffffff` | `#100f1a` | Label on small accent-filled controls (segmented tabs, confirm, checkmarks) — 2.68:1 / 7.09:1 |
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
meter segments, and colored text — dark mode intentionally uses the brighter
supplied values there, which is exactly why they cannot back a `textLight`
label.

**Known gap:** `chipText` on `chipBackground` in light mode measures 4.33:1,
just under AA for normal text. Both values are contractually fixed by the #689
approved palette, so this is recorded rather than adjusted; dark mode is fine at
11.11:1.

### Hardcoded Color Leaks (not in colors.js)

| File | Line | Value | Used For |
|---|---|---|---|
| `HomeScreen.js` | `35, 39` | `#FF5C00` | KiloWordmark SVG accents (brand mark, intentionally fixed in both modes) |

This is now the complete list: every other visual color in the migrated
production surfaces resolves through a palette token.

---

## Shared Components

Source: `mobile/components/UI.js`

### Card

| Property | Value | Line |
|---|---|---|
| backgroundColor | `colors.card` | `158` |
| borderRadius | `24` | `159` |
| padding | `18` | `160` |
| borderWidth | `1` | `161` |
| borderColor | `colors.cardBorder` | `162` |
| gap (between children) | `10` | `163` |

Every ordinary card uses this 1px `cardBorder` in both modes — no card is
special-cased. The single documented exception is the current-routine card in
`LogActiveRoutineCard.js`, which keeps a 4px `colors.accent` border on all
sides so the active note is identifiable at a glance.

Tone variants (accent/success/error/warn) override bg and border to the tone color. Lines `165-180`.

### SectionTitle

| Property | Value | Line |
|---|---|---|
| fontSize | `18` | `182` |
| fontWeight | `700` | `183` |
| color | `colors.text` | `184` |
| marginTop | `6` | `185` |

### Button

| Property | Value | Line |
|---|---|---|
| backgroundColor | `colors.text` | `188` |
| borderRadius | `18` | `189` |
| paddingVertical | `16` | `190` |
| text fontSize | `16` | `199` |
| text fontWeight | `700` | `200` |
| text color | `colors.buttonLabel` | `198` |

The pill/label pairing inverts by mode: light renders a dark pill with a light
label, dark renders a light pill with a dark label. Both clear AA (see the
derived-token table above).

### StatCard

| Property | Value | Line |
|---|---|---|
| label fontSize | `13` | `207` |
| label fontWeight | `700` | `208` |
| label color | `colors.textMuted` | `209` |
| value fontSize | `28` | `212` |
| value fontWeight | `800` | `213` |

### Badge

| Property | Value | Line |
|---|---|---|
| fontSize | `11` | `238` |
| fontWeight | `800` | `239` |
| textTransform | `uppercase` | `241` |
| borderRadius | `8` | `222` |

### Chip

| Property | Value | Line |
|---|---|---|
| fontSize | `12` | `250` |
| fontWeight | `600` | `251` |
| borderRadius | `999` (pill) | `248` |

---

## ScreenShell

Source: `mobile/components/ScreenShell.js`

| Property | Value | Line |
|---|---|---|
| Content horizontal padding | `16` | `63` |
| Content bottom padding | `measured TabBar height + 24 + bottom safe-area inset` (tab bar clearance) | `51-52` |
| Gap between top-level children | `16` | `65` |
| Header paddingTop | `8` | `71` |
| Header paddingBottom | `8` | `72` |
| Header internal gap | `8` | `73` |
| Screen title fontSize | `34` | `87` |
| Screen title fontWeight | `700` | `88` |
| Screen title color | `colors.text` | `89` |
| Subtitle fontSize | `15` | `96` |
| Subtitle lineHeight | `22` | `97` |
| Subtitle color | `colors.textMuted` | `98` |

Current values live in `styles` at the bottom of `ScreenShell.js`
(`container` gap/padding ~123-127, `header` ~131-135, `title` ~152-156). The
sticky back-header (`onBack`) uses `paddingHorizontal: 16`, `paddingVertical: 12`
with a 1px `cardBorder` bottom.

The absolute `TabBar` keeps 16px horizontal insets and a 24px visual bottom
gap (`TAB_BAR_VISUAL_GAP` in `mobile/components/TabBarLayout.js`), then adds
the runtime bottom safe-area inset from `react-native-safe-area-context`. The
bar's own rendered height is never added to that offset. `TabBar` reports its
rendered height through `onLayout`; `mobile/App.js` owns that measurement in
state and provides it to every `ScreenShell` via `TabBarLayoutContext`, which
adds it to the shared 24px gap and the bottom inset for scroll clearance.
`SafeAreaProvider` is owned by `mobile/App.js`; `ScreenShell` consumes only
the bottom inset so existing top spacing is unchanged.

---

## Shared History-Panel System (#411)

The single visual system used by **Weight History**
(`mobile/components/WeightHistoryList.js`) and **Goal History**
(`mobile/screens/WeightScreen.js`). Both render as one uniform panel: a header
row that doubles as the column-header (expanded) or summary (collapsed) row, a
3-column value·value·date grid, and a trailing control cell.

The constants are **duplicated, not imported**, in both files so each panel stays
inside its own `Allowed Files`. WeightHistoryList defines them as
`HISTORY_*` constants + `historyPanel` StyleSheet (`WeightHistoryList.js`
`17-171`); WeightScreen mirrors them in local StyleSheet `hp`
(`WeightScreen.js` `567+`). **Known exception:** these two must be kept
numerically identical by hand.

| Element | Property | Value |
|---|---|---|
| Panel card | bg / radius / border | `colors.card` / `24` / 1px `cardBorder`, `overflow: hidden` |
| Header row | bg | `colors.subtleBg`, `paddingVertical: 10`, left pad 16 / right pad 0 |
| Header row (expanded) | border | 1px `cardBorder` bottom (`headerRowBordered`) |
| Column label | fontSize / weight | `11` / `700`, uppercase, `letterSpacing: 0.5`, `textMuted` |
| Column flex | col1 / col2 / col3 | `1.35` (left) / `1.25` (center) / `1.5` (right) |
| Control cell | width | `56` (trailing chevron / filter / delete) |
| Row | padding | `paddingVertical: 12`, left 16 / right 0 |
| Row value | fontSize / weight | `20` / `700`, `colors.text` |
| Row date | fontSize / weight | `15` / `600`, `colors.textMuted`, right-aligned |
| Collapsed summary count | fontSize / weight | `12` / `600`, `textMuted` |
| Collapsed summary "Latest:" | fontSize / weight | `15` / `600`; emphasized value `900` `text` |
| Collapse chevron | icon / size | `MaterialIcons` `expand-less`/`expand-more`, `18`, `textMuted` |

Panel-specific outcome colors (the only intended difference between panels):
- Weight History col2 = **Change** (delta), colored by severity
  (`textMuted` → `caution` → `error`).
- Goal History col2 = **End Weight**, colored `success` (met) / `error` (missed)
  via `computeIsGoalMet`; col3 = **Target Date**.

### Collapse convention (standardized #389, #410)

App-wide: collapse toggles are `MaterialIcons` `expand-more` (collapsed) /
`expand-less` (expanded), size 16–18, `colors.textMuted`, with the whole header
row as the press target. This replaced the earlier text `▲`/`▼` glyphs. Used by
both history panels, the Analytics Big 3 Mapping header, and the 1K "How is this
calculated?" toggle.

### Date-range filter (Weight History)

Client-side filter over already-loaded entries (`filterByDateRange`,
`WeightHistoryList.js` `204-212`) — no new data model. A `date-range`
`MaterialIcons` icon in the Date header cell (turns `accent` when a range is
active/open) reveals a From/To row (`dateFilterRow`, `subtleBg`) below the
header. Web uses text inputs; native uses `DateTimePicker`. Tapping the icon
while collapsed expands the panel and opens the filter row.

---

## Home Screen

Source: `mobile/screens/HomeScreen.js`

### Weekly Summary Hero Card

| Element | Property | Value | Line |
|---|---|---|---|
| Card wrapper | borderRadius | `24` | `857` |
| | padding | `0` (custom, overrides Card default) | `855` |
| | marginTop | `12` | `861` |
| Floating badge | fontSize | `10` | `876` |
| | fontWeight | `700` | `877` |
| | color | `colors.textMuted` | `878` |
| | textTransform | `uppercase` | `879` |
| | letterSpacing | `1` | `880` |
| | borderRadius | `20` | `871` |
| | position | `absolute`, top: `-12` | `863-864` |
| Badge week number | color | `colors.text` | `883` |
| Hero content | padding | `24` all, `32` top (badge clearance) | `886-887` |
| **Weight value** | fontSize | **`48`** | `899` |
| | fontWeight | `800` | `900` |
| | color | **`colors.accent`** | `901` |
| Weight placeholder | fontSize | `48` | `905` |
| | color | `colors.textMuted` | `907` |
| Weight unit "lb" | fontSize | `20` | `911` |
| | color | `colors.textMuted` | `913` |
| Sublabels ("current weight", "7-day trend") | fontSize | `11` | `916` |
| | fontWeight | `600` | `917` |
| | textTransform | `uppercase` | `920` |
| | letterSpacing | `0.3` | `921` |
| Weight+sparkline row | gap | `16` | `893` |
| | marginBottom | `24` | `892` |
| Sparkline | color | `colors.accent` | `115` |
| | height | `40` | `116` |
| Classification dot | width/height | `8` | `936-937` |
| Classification count | fontSize | `16` | `942` |
| | fontWeight | `800` | `943` |
| Classification label | fontSize | `10` | `946` |
| | fontWeight | `600` | `947` |
| | color | `colors.textMuted` | `948` |
| Classification row | marginBottom | `24` | `928` |
| Hero divider | height | `1` | `953` |
| | color | `colors.cardBorder` | `954` |
| | margin | `marginHorizontal: -24` (full-bleed) | `955` |
| Insights link text | fontSize | `13` | `968` |
| | fontWeight | `700` | `969` |
| | color | `colors.accent` | `970` |
| Insights chevron SVG | stroke | `colors.accent` | `147` |

### Weight Goal Card

| Element | Property | Value | Line |
|---|---|---|---|
| Card padding | `24` | | `972` |
| Card borderRadius | `24` | | `973` |
| Direction text ("Cutting"/"Bulking") | fontSize | `18` | `983` |
| | fontWeight | `700` | `984` |
| | color | dynamic: `colors.success` (gain), `colors.accent` (loss), `colors.textMuted` (maintain) | `159-163` |
| Weeks text | fontSize | `14` | `992` |
| | fontWeight | `700` | `993` |
| | color | `colors.text` | `994` |
| Weeks chevron SVG | stroke | `colors.cardBorder` | `168` |
| Stat label ("Target"/"Pace") | fontSize | `12` | `1004` |
| | fontWeight | `600` | `1005` |
| | color | `colors.textMuted` | `1006` |
| Stat value (number) | fontSize | `32` | `1014` |
| | fontWeight | `800` | `1015` |
| | color | `colors.text` | `1016` |
| Stat unit ("lb", "lb/wk") | fontSize | `16` | `1019` |
| | color | `colors.textMuted` | `1021` |
| Stats grid | gap | `40` | `998` |

### 1K Club Card

| Element | Property | Value | Line |
|---|---|---|---|
| Card padding | `24` | | `1024` |
| Card borderRadius | `24` | | `1025` |
| Hero total value | fontSize | `32` | `1032` |
| | fontWeight | `800` | `1033` |
| | color | `colors.accent` | `1034` |
| Hero unit "lb" | fontSize | `14` | `1037` |
| | color | `colors.textMuted` | `1038` |
| Progress bar | height | `8` | `1041` |
| | background | `colors.cardBorder` | `1042` |
| | fill | `colors.accent` | `1049` |
| | borderRadius | `6` | `1043` |
| | marginBottom | `28` | `1045` |
| Breakdown value | fontSize | `16` | `1066` |
| | fontWeight | `800` | `1067` |
| | color | `colors.text` | `1068` |
| Breakdown label | fontSize | `12` | `1071` |
| | fontWeight | `600` | `1072` |
| | color | `colors.textMuted` | `1073` |
| Breakdown dividers | borderWidth | `1` | `1061-1062` |
| | color | `colors.cardBorder` | `1063` |

---

## Analytics Screen

Source: `mobile/screens/AnalyticsScreen.js`

### Weight Trends Card

| Element | Property | Value | Line |
|---|---|---|---|
| Card padding | `20` | `356` |
| "Latest weigh-in" label | fontSize | `12` | `365` |
| | fontWeight | `700` | `366` |
| | textTransform | `uppercase` | `367` |
| Weight value | fontSize | `32` | `372` |
| | fontWeight | `900` | `373` |
| | color | `colors.accent` | `374` |
| Chart | height | `100` | `166` |
| Pace badge | borderRadius | `12` | `379` |
| | text fontSize | `12` | `387` |
| | text fontWeight | `800` | `388` |
| Footer stat value (7d/30d avg) | fontSize | `18` | `403` |
| | fontWeight | `700` | `404` |
| Footer stat label | fontSize | `11` | `408` |
| | fontWeight | `600` | `409` |
| | textTransform | `uppercase` | `410` |
| Footer divider | borderTopWidth `1` / `colors.cardBorder` | | `394-395` |

### 1K Progress Card

| Element | Property | Value | Line |
|---|---|---|---|
| Card padding | `24` | `413` |
| "1K PROGRESS" label | fontSize | `14` | `419` |
| | fontWeight | `700` | `420` |
| | textTransform | `uppercase` | `421` |
| | color | `colors.textMuted` | `421` |
| Total value | fontSize | `48` | `424` |
| | fontWeight | `900` | `425` |
| | color | `colors.accent` | `426` |
| Breakdown divider | borderTopWidth `1` / `colors.cardBorder`, paddingTop `16` | | `433-436` |
| Breakdown value | fontSize | `18` | `443` |
| | fontWeight | `700` | `444` |
| | color | `colors.text` | `445` |
| Breakdown label | fontSize | `12` | `447` |
| | color | `colors.textMuted` | `448` |

### Strength Section (`AnalyticsStrengthSection.js`)

| Element | Property | Value | Line |
|---|---|---|---|
| Section wrapper | gap | `16` (`strengthSection`) | `171-173` |
| 1K card | padding / bg | `24` / `panelBackground` (ArtisanalPanel) | `174-179` |
| 1K label | fontSize / weight | `12` / `800`, uppercase, `letterSpacing: 1` | `180-186` |
| 1K value | style | `HeroMetric.hero` (single hero metric) | `187-190` |
| Big 3 Mapping card | header | collapsible `Pressable`, default expanded | `111-125` |
| Big 3 title | fontSize / weight | `12` / `700`, uppercase, `textMuted` | `297-303` |
| Big 3 / info collapse | icon | `MaterialIcons` `expand-more`/`expand-less`, `14-16`, `textMuted` | `119-124`, `79-84` |
| "How is this calculated?" | toggle | collapsible, default collapsed | `68-99` |

### Progressive Overload Table (`AnalyticsScreen.js`)

| Element | Property | Value | Line |
|---|---|---|---|
| Sticky header | paddingTop / paddingBottom | `8` / `8` (`signalStickyHeader`) | `384-388` |
| Sticky header | pinned via | `stickyHeaderIndices` on ScreenShell | `356`, `366` |
| Column header row | paddingHorizontal / paddingBottom | `16` / `4` | `403-407` |
| Column label | fontSize / weight | `11` / `800`, uppercase, `letterSpacing: 0.5`, center | `408-416` |
| Group section | paddingBottom / border | `4` / 1px `divider` top (between groups) | `426+` |

Grouping (`analyticsDerivations.js` `deriveGroupedSignals`): sections are merged
by a **normalized leading-day key** (`MONDAY — Push` and `MONDAY — Push / Chest`
→ one `MONDAY` group), with exercise dedup on merge, so a note with gym+home
weeks no longer shows a day twice (#383/#385).

---

## Weight Screen

Sources: `mobile/screens/WeightScreen.js`, `mobile/components/UI.js`,
`mobile/components/WeightTrendSection.js`, and
`mobile/components/WeightGoalCard.js`.

### Input Card

| Element | Property | Value | Line |
|---|---|---|---|
| Input label | fontSize | `13` | `WeightScreen.js:480` |
| | fontWeight | `700` | `WeightScreen.js:481` |
| | color | `colors.textMuted` | `WeightScreen.js:482` |
| Input field | fontSize | `16` | `WeightScreen.js:491` |
| | borderRadius | `16` | `WeightScreen.js:486` |
| | bg | `colors.inputBackground` | `WeightScreen.js:485` |
| | border | `colors.inputBorder` | `WeightScreen.js:488` |
| Save button | bg | `colors.text` | `UI.js:339` |
| | paddingVertical | `16` | `UI.js:341` |

### Trends Card

| Element | Property | Value | Line |
|---|---|---|---|
| Card padding | `0` (merged sections) | `WeightScreen.js:521-525` |
| Section title | fontSize | `12` | `WeightTrendSection.js:72` |
| | fontWeight | `700` | `WeightTrendSection.js:73` |
| | textTransform | `uppercase` | `WeightTrendSection.js:75` |
| | letterSpacing | `0.5` | `WeightTrendSection.js:76` |
| Trend value | fontSize | `20` | `UI.js:11` |
| | fontWeight | `900` | `UI.js:11` |
| | color | `colors.text` | `WeightTrendSection.js:96` |
| Trend label | fontSize | `11` | `WeightTrendSection.js:99` |
| | fontWeight | `700` | `WeightTrendSection.js:101` |
| | textTransform | `uppercase` | `WeightTrendSection.js:102` |
| | letterSpacing | `0.5` | `WeightTrendSection.js:103` |
| Section divider | borderBottomWidth `1` / `colors.cardBorder` | | `WeightTrendSection.js:67-69` |

### Goal Display

| Element | Property | Value | Line |
|---|---|---|---|
| Goal value (target weight) | fontSize | `28` | `WeightGoalCard.js:352` |
| | fontWeight | `900` | `WeightGoalCard.js:353` |
| | color | `colors.accent` | `WeightGoalCard.js:354` |
| Goal value (target date) | fontSize | `28` | `WeightGoalCard.js:357` |
| | fontWeight | `900` | `WeightGoalCard.js:358` |
| | color | `colors.text` | `WeightGoalCard.js:359` |
| Goal label | fontSize | `12` | `WeightGoalCard.js:362` |
| | fontWeight | `700` | `WeightGoalCard.js:364` |
| | textTransform | `uppercase` | `WeightGoalCard.js:365` |
| | letterSpacing | `0.5` | `WeightGoalCard.js:366` |
| Derived row label | fontSize | `12` | `WeightGoalCard.js:405` |
| | fontWeight | `700` | `WeightGoalCard.js:407` |
| Derived row value | fontSize | `16` | `WeightGoalCard.js:412` |
| | fontWeight | `700` | `WeightGoalCard.js:413` |

### History List / Goal History

Both now use the **Shared History-Panel System** (see that section above) —
`WeightHistoryList.js` for Weight History, `hp` StyleSheet in `WeightScreen.js`
for Goal History. Values (radius 24, `subtleBg` header, 3-column grid, value 20,
date 15, collapse chevron, summary count/latest) are documented there. The old
stacked row layout (weight 17 / date 12 / stacked note) was replaced during
#411/#412.

Weight History extras: date-range filter, collapse, empty-range message ("No
entries in this range."), and a delete `✕` affordance in the trailing control
cell. Goal History extras: End Weight outcome coloring, Target Date column.

---

## Log Screen (STYLE LOCKED)

Source: `mobile/screens/LogScreen.js`, and the extracted
`mobile/components/LogActiveRoutineCard.js`, `LogPreviousRoutines.js`, and
`LogScreenEditorCard.js`. The Log style lock spans all of these, not
`LogScreen.js` alone.

Style lock header at lines 1-7 (`mobile/screens/LogScreen.js`): do not change
Log styling unless the repo owner explicitly asks.

| Element | Property | Value | Line |
|---|---|---|---|
| Current note title | fontSize | `24` | `LogActiveRoutineCard.js:183` |
| | fontWeight | `800` | `LogActiveRoutineCard.js:184` |
| | color | `colors.accent` | `LogActiveRoutineCard.js:185` |
| Current routine card | borderWidth | `4` | `LogActiveRoutineCard.js:161` |
| | padding | `0` | `LogActiveRoutineCard.js:159` |
| Other note title | fontSize | `20` | `LogPreviousRoutines.js:195` |
| | fontWeight | `800` | `LogPreviousRoutines.js:196` |
| Other note subtitle | fontSize | `12` | `LogPreviousRoutines.js:200` |
| | color | `colors.textMuted` | `LogPreviousRoutines.js:201` |
| WorkoutHeading (UI.js) | fontSize | `22` | UI.js:640 |
| | fontWeight | `800` | UI.js:641 |
| | textTransform | `capitalize` | UI.js:645 |
| WorkoutSubheading (UI.js) | fontSize | `14` | UI.js:655 |
| | fontWeight | `700` | UI.js:656 |
| | color | `colors.accent` | UI.js:657 |
| | textTransform | `uppercase` | UI.js:658 |
| Exercise name (UI.js) | fontSize | `17` | UI.js:678 |
| | fontWeight | `700` | UI.js:679 |
| Set row font size (UI.js) | fontSize | `14` (`SET_ROW_FONT_SIZE`) | UI.js:8 |
| Mode toggle ("Done") | fontSize | `14` | `LogScreen.js:733` |
| | fontWeight | `700` | `LogScreen.js:734` |
| | color | `colors.accent` | `LogScreen.js:735` |
| | bg | `colors.chipBackground` | `LogScreen.js:730` |
| | borderRadius | `12` | `LogScreen.js:729` |
| Input field | fontSize | `16` | `LogScreenEditorCard.js:270` |
| | borderRadius | `16` | `LogScreenEditorCard.js:265` |

---

## Cross-Screen Inconsistencies

**Reconciled after #383→#413.** These were resolved:
- Weight History and Goal History are now one shared panel system (identical
  header/grid/summary/collapse), replacing the two divergent stacked layouts.
- Collapse toggles are unified on the `MaterialIcons` chevron convention across
  history panels and analytics (was: mixed text arrows / SVGs).
- Title-to-panel and panel-to-panel spacing is normalized to the 16px shell gap
  (was: flush titles and per-screen drift — the reopened #383 defect).
- The duplicate-day Progressive Overload group is fixed via normalized day-key
  grouping.

The items below are **remaining/known** cross-screen differences (Home and Log
were out of the cleanup's scope) and still document real divergence.

### Hero Metric Sizes

| Screen | Element | fontSize | fontWeight | color |
|---|---|---|---|---|
| Home | Weight value | `48` | `800` | `accent` |
| Home | 1K total | `32` | `800` | `accent` |
| Analytics | Weight value | `32` | `900` | `accent` |
| Analytics | 1K total | `48` | `900` | `accent` |
| Weight | Goal value | `24` | `900` | `accent` |
| Weight | Trend value | `20` | `900` | `text` |

Home uses `800` for bold metrics. Analytics and Weight use `900`. No clear system.

### 1K Card: Home vs Analytics

| Property | Home | Analytics |
|---|---|---|
| Total fontSize | `32` | `48` |
| Total fontWeight | `800` | `900` |
| Breakdown value fontSize | `16` | `18` |
| Breakdown label fontSize | `12` | `12` |
| Breakdown divider | vertical `borderLeft/Right` between items | horizontal `borderTop` above row |

Home treats 1K as tertiary (smaller). Analytics treats it as a hero (larger). The structural difference (vertical vs horizontal dividers, centered vs grid) means the "same card" doesn't actually feel the same.

### Support Label Patterns

| Pattern | fontSize | Weight | Case | Screens |
|---|---|---|---|---|
| Uppercase micro-label | `10` | `700` | `uppercase` | Analytics (column headers, trend labels), Weight (trend labels) |
| Uppercase small label | `11` | `600` | `uppercase` | Home (hero sublabels), Analytics (footer stat labels) |
| Uppercase label | `12` | `700` | `uppercase` | Home (goal stat label), Analytics (weight label, 1K label, slot title), Weight (section titles, goal labels) |
| Section title label | `14` | `700` | `uppercase` | Analytics (1K progress label) |

Four different sizes for the same role (metadata label above a value). The `10px` labels on Home classifications and Analytics column headers are the smallest text in the app.

### Card Padding

| Screen | Card | Padding |
|---|---|---|
| Shared default | Card component | `18` |
| Home | Weekly hero | `0` (custom) + `24` inner |
| Home | Goal card | `24` |
| Home | 1K card | `24` |
| Analytics | Weight card | `20` |
| Analytics | 1K card | `24` |
| Analytics | Slot card | `16` |
| Weight | Trends card | `0` (merged sections, `16` per section) |

### Divider Patterns

| Type | Used Where |
|---|---|
| Full-bleed `marginHorizontal: -24` | Home hero divider |
| `borderTop 1px` | Analytics weight footer, Analytics 1K breakdown, Weight trend sections |
| `borderBottom 1px` | Weight history rows, Analytics signal rows |
| `borderLeft/Right 1px` | Home 1K breakdown items |
| `opacity: 0.5` divider | Weight goal divider |

### Orange Usage (colors.accent)

| Screen | Elements using accent |
|---|---|
| Home | Weight value, sparkline, CTA text, CTA chevron, 1K total, wordmark SVG |
| Analytics | Weight value, 1K total, pace badge bg, loading spinners |
| Weight | Goal display values, save button bg, edit title, delta notable |
| Log | Current note title, subheadings, mode toggle, switch/create buttons |

Home has the highest orange density — 6 distinct elements. The wordmark is fixed (brand), but the remaining 5 compete for attention inside a single scroll view.

### SectionTitle Usage

| Screen | Between-card SectionTitles |
|---|---|
| Home | none — Home does not import `SectionTitle` |
| Analytics | "Weight Trends", "Fatigue", "Strength", "Progressive Overload" |
| Weight | "Goal", "Trends", "Goal History", "History" |
| Log | "More Routines" |

On Analytics/Weight, SectionTitles separate genuinely different content areas with many items each. Home relies on card content alone to communicate section purpose.

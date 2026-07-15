# Design System Map

Audit of every style token across all screens, organized by role. Use this to find exactly where to change any visual property.

Last updated: 2026-07-01
Source branch: `issue/386-ui-design-rules`

Reconciled after the #383→#413 UI cleanup (tab-spacing polish, unified
Weight/Goal history panel system, standardized collapse convention, analytics
hierarchy fixes). For the *rules* derived from these patterns see
`docs/ui-design-rules.md`; this map records the *current values*.

Line numbers below are accurate for the sections touched by that cleanup
(tokens, ScreenShell, the history-panel system, Weight Screen, Analytics
collapse/PO). Home and Log sections predate the cleanup and were not in scope;
treat their line numbers as approximate.

---

## Color Palette

Source: `mobile/theme/colors.js`

| Token | Hex | Role |
|---|---|---|
| `background` | `#f4efe5` | Global scroll background (warm cream) |
| `card` | `#fffaf2` | Card fill |
| `cardBorder` | `#e3d7c5` | Card stroke, dividers, separators |
| `accent` | `#d98d42` | Primary brand orange — hero metrics, CTAs, active states |
| `text` | `#1f1a17` | Primary text (near-black) |
| `textMuted` | `#5d564f` | Secondary/support text |
| `textLight` | `#f7f1e8` | Text on dark backgrounds (buttons, dark badges) |
| `tabBarBackground` | `#201914` | Bottom tab bar |
| `tabInactive` | `#cbb9a5` | Inactive tab icons |
| `inputBackground` | `#ffffff` | Text input fill |
| `inputBorder` | `#d9cdbf` | Text input stroke |
| `chipBackground` | `#f0d8bb` | Chip/badge/highlight fill |
| `divider` | `rgba(31, 26, 23, 0.05)` | Subtle separator overlay |
| `subtleBg` | `rgba(31, 26, 23, 0.02)` | Very subtle tinted background — history/column header rows |
| `panelBackground` | `#ffffff` | Panel/section background (same value as `inputBackground`) |
| `chipText` | `#96571c` | Chip/badge text |
| `success` | `#4a7c44` | Green (progressing, bulking, goal met) |
| `error` | `#b03a2e` | Red (regressing, delete, warnings, goal missed) |
| `caution` | `#d4a017` | Yellow (steady/stalled classifications) |
| `cardAccentBg` | `#96571c` | Filled accent tone card/badge bg (WCAG AA with `textLight`) |
| `cardSuccessBg` | `#3a6035` | Filled success tone card/badge bg (WCAG AA with `textLight`) |
| `cardCautionBg` | `#7f6310` | Filled caution tone card/badge bg (WCAG AA with `textLight`) |
| `roughBackground` | `#fff0e8` | ArtisanalPanel fill |
| `roughBorder` | `#e8c4a0` | ArtisanalPanel stroke |

The `cardAccentBg` / `cardSuccessBg` / `cardCautionBg` tokens are darkened tone
backgrounds used only for *filled* tone surfaces (UI.js Card/StatCard tone
variants, trend badges) so `textLight` meets WCAG AA 4.5:1. Direct users of the
lighter `accent`/`success`/`caution` palette tones (e.g. SessionGauge segments)
are intentionally unchanged.

### Hardcoded Color Leaks (not in colors.js)

| File | Line | Value | Used For |
|---|---|---|---|
| `LogScreen.js` | `749` | `#fff0f0` | Error card background tint |
| `HomeScreen.js` | `33, 37` | `#FF5C00` | KiloWordmark SVG (brand mark, intentional) |

---

## Shared Components

Source: `mobile/components/UI.js`

### Card

| Property | Value | Line |
|---|---|---|
| backgroundColor | `Colors.card` | `158` |
| borderRadius | `24` | `159` |
| padding | `18` | `160` |
| borderWidth | `1` | `161` |
| borderColor | `Colors.cardBorder` | `162` |
| gap (between children) | `10` | `163` |

Tone variants (accent/success/error/warn) override bg and border to the tone color. Lines `165-180`.

### SectionTitle

| Property | Value | Line |
|---|---|---|
| fontSize | `18` | `182` |
| fontWeight | `700` | `183` |
| color | `Colors.text` | `184` |
| marginTop | `6` | `185` |

### Button

| Property | Value | Line |
|---|---|---|
| backgroundColor | `Colors.text` (dark) | `188` |
| borderRadius | `18` | `189` |
| paddingVertical | `16` | `190` |
| text fontSize | `16` | `199` |
| text fontWeight | `700` | `200` |
| text color | `Colors.textLight` | `198` |

### StatCard

| Property | Value | Line |
|---|---|---|
| label fontSize | `13` | `207` |
| label fontWeight | `700` | `208` |
| label color | `Colors.textMuted` | `209` |
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
| Content bottom padding | `120 + bottom safe-area inset` (tab bar clearance) | `51`, `128-131` |
| Gap between top-level children | `16` | `65` |
| Header paddingTop | `8` | `71` |
| Header paddingBottom | `8` | `72` |
| Header internal gap | `8` | `73` |
| Screen title fontSize | `34` | `87` |
| Screen title fontWeight | `700` | `88` |
| Screen title color | `Colors.text` | `89` |
| Subtitle fontSize | `15` | `96` |
| Subtitle lineHeight | `22` | `97` |
| Subtitle color | `Colors.textMuted` | `98` |

Current values live in `styles` at the bottom of `ScreenShell.js`
(`container` gap/padding ~123-127, `header` ~131-135, `title` ~152-156). The
sticky back-header (`onBack`) uses `paddingHorizontal: 16`, `paddingVertical: 12`
with a 1px `cardBorder` bottom.

The absolute `TabBar` keeps 16px horizontal insets and a 24px visual bottom
gap, then adds the runtime bottom safe-area inset from
`react-native-safe-area-context`. `SafeAreaProvider` is owned by
`mobile/App.js`; `ScreenShell` consumes only the bottom inset so existing top
spacing is unchanged.

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
| Panel card | bg / radius / border | `Colors.card` / `24` / 1px `cardBorder`, `overflow: hidden` |
| Header row | bg | `Colors.subtleBg`, `paddingVertical: 10`, left pad 16 / right pad 0 |
| Header row (expanded) | border | 1px `cardBorder` bottom (`headerRowBordered`) |
| Column label | fontSize / weight | `11` / `700`, uppercase, `letterSpacing: 0.5`, `textMuted` |
| Column flex | col1 / col2 / col3 | `1.35` (left) / `1.25` (center) / `1.5` (right) |
| Control cell | width | `56` (trailing chevron / filter / delete) |
| Row | padding | `paddingVertical: 12`, left 16 / right 0 |
| Row value | fontSize / weight | `20` / `700`, `Colors.text` |
| Row date | fontSize / weight | `15` / `600`, `Colors.textMuted`, right-aligned |
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
`expand-less` (expanded), size 16–18, `Colors.textMuted`, with the whole header
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
| | color | `Colors.textMuted` | `878` |
| | textTransform | `uppercase` | `879` |
| | letterSpacing | `1` | `880` |
| | borderRadius | `20` | `871` |
| | position | `absolute`, top: `-12` | `863-864` |
| Badge week number | color | `Colors.text` | `883` |
| Hero content | padding | `24` all, `32` top (badge clearance) | `886-887` |
| **Weight value** | fontSize | **`48`** | `899` |
| | fontWeight | `800` | `900` |
| | color | **`Colors.accent`** | `901` |
| Weight placeholder | fontSize | `48` | `905` |
| | color | `Colors.textMuted` | `907` |
| Weight unit "lb" | fontSize | `20` | `911` |
| | color | `Colors.textMuted` | `913` |
| Sublabels ("current weight", "7-day trend") | fontSize | `11` | `916` |
| | fontWeight | `600` | `917` |
| | textTransform | `uppercase` | `920` |
| | letterSpacing | `0.3` | `921` |
| Weight+sparkline row | gap | `16` | `893` |
| | marginBottom | `24` | `892` |
| Sparkline | color | `Colors.accent` | `115` |
| | height | `40` | `116` |
| Classification dot | width/height | `8` | `936-937` |
| Classification count | fontSize | `16` | `942` |
| | fontWeight | `800` | `943` |
| Classification label | fontSize | `10` | `946` |
| | fontWeight | `600` | `947` |
| | color | `Colors.textMuted` | `948` |
| Classification row | marginBottom | `24` | `928` |
| Hero divider | height | `1` | `953` |
| | color | `Colors.cardBorder` | `954` |
| | margin | `marginHorizontal: -24` (full-bleed) | `955` |
| Insights link text | fontSize | `13` | `968` |
| | fontWeight | `700` | `969` |
| | color | `Colors.accent` | `970` |
| Insights chevron SVG | stroke | `Colors.accent` | `147` |

### Weight Goal Card

| Element | Property | Value | Line |
|---|---|---|---|
| Card padding | `24` | | `972` |
| Card borderRadius | `24` | | `973` |
| Direction text ("Cutting"/"Bulking") | fontSize | `18` | `983` |
| | fontWeight | `700` | `984` |
| | color | dynamic: `Colors.success` (gain), `Colors.accent` (loss), `Colors.textMuted` (maintain) | `159-163` |
| Weeks text | fontSize | `14` | `992` |
| | fontWeight | `700` | `993` |
| | color | `Colors.text` | `994` |
| Weeks chevron SVG | stroke | `Colors.cardBorder` | `168` |
| Stat label ("Target"/"Pace") | fontSize | `12` | `1004` |
| | fontWeight | `600` | `1005` |
| | color | `Colors.textMuted` | `1006` |
| Stat value (number) | fontSize | `32` | `1014` |
| | fontWeight | `800` | `1015` |
| | color | `Colors.text` | `1016` |
| Stat unit ("lb", "lb/wk") | fontSize | `16` | `1019` |
| | color | `Colors.textMuted` | `1021` |
| Stats grid | gap | `40` | `998` |

### 1K Club Card

| Element | Property | Value | Line |
|---|---|---|---|
| Card padding | `24` | | `1024` |
| Card borderRadius | `24` | | `1025` |
| Hero total value | fontSize | `32` | `1032` |
| | fontWeight | `800` | `1033` |
| | color | `Colors.accent` | `1034` |
| Hero unit "lb" | fontSize | `14` | `1037` |
| | color | `Colors.textMuted` | `1038` |
| Progress bar | height | `8` | `1041` |
| | background | `Colors.cardBorder` | `1042` |
| | fill | `Colors.accent` | `1049` |
| | borderRadius | `6` | `1043` |
| | marginBottom | `28` | `1045` |
| Breakdown value | fontSize | `16` | `1066` |
| | fontWeight | `800` | `1067` |
| | color | `Colors.text` | `1068` |
| Breakdown label | fontSize | `12` | `1071` |
| | fontWeight | `600` | `1072` |
| | color | `Colors.textMuted` | `1073` |
| Breakdown dividers | borderWidth | `1` | `1061-1062` |
| | color | `Colors.cardBorder` | `1063` |

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
| | color | `Colors.accent` | `374` |
| Chart | height | `100` | `166` |
| Pace badge | borderRadius | `12` | `379` |
| | text fontSize | `12` | `387` |
| | text fontWeight | `800` | `388` |
| Footer stat value (7d/30d avg) | fontSize | `18` | `403` |
| | fontWeight | `700` | `404` |
| Footer stat label | fontSize | `11` | `408` |
| | fontWeight | `600` | `409` |
| | textTransform | `uppercase` | `410` |
| Footer divider | borderTopWidth `1` / `Colors.cardBorder` | | `394-395` |

### 1K Progress Card

| Element | Property | Value | Line |
|---|---|---|---|
| Card padding | `24` | `413` |
| "1K PROGRESS" label | fontSize | `14` | `419` |
| | fontWeight | `700` | `420` |
| | textTransform | `uppercase` | `421` |
| | color | `Colors.textMuted` | `421` |
| Total value | fontSize | `48` | `424` |
| | fontWeight | `900` | `425` |
| | color | `Colors.accent` | `426` |
| Breakdown divider | borderTopWidth `1` / `Colors.cardBorder`, paddingTop `16` | | `433-436` |
| Breakdown value | fontSize | `18` | `443` |
| | fontWeight | `700` | `444` |
| | color | `Colors.text` | `445` |
| Breakdown label | fontSize | `12` | `447` |
| | color | `Colors.textMuted` | `448` |

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
| | color | `Colors.textMuted` | `WeightScreen.js:482` |
| Input field | fontSize | `16` | `WeightScreen.js:491` |
| | borderRadius | `16` | `WeightScreen.js:486` |
| | bg | `Colors.inputBackground` | `WeightScreen.js:485` |
| | border | `Colors.inputBorder` | `WeightScreen.js:488` |
| Save button | bg | `Colors.text` | `UI.js:339` |
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
| | color | `Colors.text` | `WeightTrendSection.js:96` |
| Trend label | fontSize | `11` | `WeightTrendSection.js:99` |
| | fontWeight | `700` | `WeightTrendSection.js:101` |
| | textTransform | `uppercase` | `WeightTrendSection.js:102` |
| | letterSpacing | `0.5` | `WeightTrendSection.js:103` |
| Section divider | borderBottomWidth `1` / `Colors.cardBorder` | | `WeightTrendSection.js:67-69` |

### Goal Display

| Element | Property | Value | Line |
|---|---|---|---|
| Goal value (target weight) | fontSize | `28` | `WeightGoalCard.js:352` |
| | fontWeight | `900` | `WeightGoalCard.js:353` |
| | color | `Colors.accent` | `WeightGoalCard.js:354` |
| Goal value (target date) | fontSize | `28` | `WeightGoalCard.js:357` |
| | fontWeight | `900` | `WeightGoalCard.js:358` |
| | color | `Colors.text` | `WeightGoalCard.js:359` |
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

Source: `mobile/screens/LogScreen.js`

Style lock header at lines 1-14: do not change Log styling unless the repo owner explicitly asks.

| Element | Property | Value | Line |
|---|---|---|---|
| Current note title | fontSize | `24` | `857` |
| | fontWeight | `800` | `858` |
| | color | `Colors.accent` | `859` |
| Current routine card | borderWidth | `4` | `781` |
| | padding | `0` | `779` |
| Other note title | fontSize | `20` | `852` |
| | fontWeight | `800` | `853` |
| Other note subtitle | fontSize | `12` | `862` |
| | color | `Colors.textMuted` | `863` |
| WorkoutHeading (UI.js) | fontSize | `22` | UI.js:256 |
| | fontWeight | `800` | UI.js:257 |
| | textTransform | `capitalize` | UI.js:260 |
| WorkoutSubheading (UI.js) | fontSize | `14` | UI.js:271 |
| | fontWeight | `700` | UI.js:272 |
| | color | `Colors.accent` | UI.js:273 |
| | textTransform | `uppercase` | UI.js:274 |
| Exercise name (UI.js) | fontSize | `17` | UI.js:294 |
| | fontWeight | `700` | UI.js:295 |
| Set row font size (UI.js) | fontSize | `14` (`SET_ROW_FONT_SIZE`) | UI.js:5 |
| Mode toggle ("Done") | fontSize | `14` | `739` |
| | fontWeight | `700` | `740` |
| | color | `Colors.accent` | `741` |
| | bg | `Colors.chipBackground` | `736` |
| | borderRadius | `12` | `735` |
| Input field | fontSize | `16` | `761` |
| | borderRadius | `16` | `756` |

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

### Orange Usage (Colors.accent)

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

# Design System Map

Audit of every style token across all screens, organized by role. Use this to find exactly where to change any visual property.

Last updated: 2026-05-27
Source branch: `issue/196-refine-home-ux`

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
| `subtleBg` | `rgba(31, 26, 23, 0.02)` | Very subtle tinted background |
| `panelBackground` | `#ffffff` | Panel/section background (same value as `inputBackground`) |
| `chipText` | `#96571c` | Chip/badge text |
| `success` | `#4a7c44` | Green (progressing, bulking) |
| `error` | `#b03a2e` | Red (regressing, delete, warnings) |
| `caution` | `#d4a017` | Yellow (steady/stalled classifications) |

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
| Content bottom padding | `120` (tab bar clearance) | `64` |
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

### Progressive Overload Table

| Element | Property | Value | Line |
|---|---|---|---|
| Column header bg | `Colors.card` | `544` |
| Column header borderRadius | `16` top corners | `545-546` |
| Column label | fontSize | `10` | `554` |
| | fontWeight | `700` | `555` |
| | textTransform | `uppercase` | `556` |
| | letterSpacing | `0.3` | `557` |
| Signal list bg | `Colors.card` | `570` |
| Signal list borderRadius | `24` bottom corners | `571-572` |
| Exercise name | fontSize | `14` | `600` |
| | fontWeight | `700` | `601` |
| Classification badge | fontSize | `10` | `605` |
| | textTransform | `uppercase` | `606` |
| Signal value | fontSize | `13` | `616` |
| | fontWeight | `700` | `617` |

---

## Weight Screen

Source: `mobile/screens/WeightScreen.js`

### Input Card

| Element | Property | Value | Line |
|---|---|---|---|
| Input label | fontSize | `13` | `528` |
| | fontWeight | `700` | `529` |
| | color | `Colors.textMuted` | `530` |
| Input field | fontSize | `16` | `539` |
| | borderRadius | `16` | `533` |
| | bg | `Colors.inputBackground` | `532` |
| | border | `Colors.inputBorder` | `535` |
| Save button | bg | `Colors.accent` | `809` |
| | paddingVertical | `12` | `810` |

### Trends Card

| Element | Property | Value | Line |
|---|---|---|---|
| Card padding | `0` (merged sections) | `653-655` |
| Section title | fontSize | `12` | `667` |
| | fontWeight | `700` | `668` |
| | textTransform | `uppercase` | `669` |
| | letterSpacing | `0.5` | `670` |
| Trend value | fontSize | `20` | `682` |
| | fontWeight | `900` | `683` |
| | color | `Colors.text` | `684` |
| Trend label | fontSize | `10` | `688` |
| | fontWeight | `700` | `689` |
| | textTransform | `uppercase` | `690` |
| | letterSpacing | `0.5` | `691` |
| Section divider | borderBottomWidth `1` / `Colors.cardBorder` | | `662-663` |

### Goal Display

| Element | Property | Value | Line |
|---|---|---|---|
| Goal title | fontSize | `12` | `709` |
| | fontWeight | `700` | `710` |
| | textTransform | `uppercase` | `711` |
| Goal value (target weight, date) | fontSize | `24` | `748` |
| | fontWeight | `900` | `749` |
| | color | `Colors.accent` | `750` |
| Goal label | fontSize | `12` | `753` |
| | fontWeight | `700` | `754` |
| | textTransform | `uppercase` | `755` |
| | letterSpacing | `0.5` | `756` |
| Derived row label | fontSize | `15` | `775` |
| | fontWeight | `600` | `776` |
| Derived row value | fontSize | `16` | `779` |
| | fontWeight | `700` | `780` |

### History List

| Element | Property | Value | Line |
|---|---|---|---|
| Container borderRadius | `24` | `568` |
| Container bg | `Colors.card` | `566` |
| Row weight | fontSize | `17` | `604` |
| | fontWeight | `700` | `605` |
| Row date | fontSize | `12` | `625` |
| | color | `Colors.textMuted` | `626` |
| Row note | fontSize | `13` | `629` |
| | color | `Colors.textMuted` | `630` |
| Row divider | borderBottomWidth `1` / `Colors.cardBorder` | | `574-575` |

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
| Analytics | "Weight Trends", "Strength", "Progressive Overload" |
| Weight | "Goals", "Trends", "History" |
| Log | "More Routines" |

On Analytics/Weight, SectionTitles separate genuinely different content areas with many items each. Home relies on card content alone to communicate section purpose.

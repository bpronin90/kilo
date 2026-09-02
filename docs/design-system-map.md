# Design System Map

Status: current implementation map. Use this document to locate visual tokens,
shared components, and established screen treatments. The active code is
authoritative for exact values.

For the design rules derived from these patterns, see
`docs/ui-design-rules.md`. This document records implementation; it does not own
product history or issue chronology.

`colors.<token>` below means the active palette read from `useTheme()` — there
is no static `Colors` object any more. Every token resolves to a Light and a
Dark value; see the Color Palette table.

Paths and component names are preferred over line-number references so this map
survives ordinary code movement.

---

## Appearance Modes

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
| `HomeScreen.js` | KiloWordmark SVG | `#FF5C00` | KiloWordmark SVG accents (brand mark, intentionally fixed in both modes) |

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

`tone="danger"` (#822): transparent `backgroundColor`, `borderWidth: 1.5`
`colors.error` border, `colors.error` text — for irreversible actions, paired
with the Danger Zone container pattern (`ui-design-rules.md` #14). Default
tone is unchanged.

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

## More Screen

Source: `mobile/screens/MoreScreen.js`, `mobile/components/SettingsScreen.js`,
`mobile/components/ProfileScreen.js`, `mobile/components/AboutScreen.js`,
`mobile/components/BackupScreen.js`, `mobile/components/HelpScreen.js`, and
`mobile/screens/more/`.

More is a menu of quiet, individually actionable rows. The rows are grouped by
`SectionTitle` into **Preferences** (User Profile, Settings), **Account & Data**
(Account, Data & Backup), and **Help & Support** (App Guide, About Kilo). Rows
with supporting copy put a 13px `colors.textMuted` help line below the label;
all rows end with a 20px muted `MaterialIcons` `chevron-right` disclosure.

| Element | Property | Value |
|---|---|---|
| Menu list | gap | `12` |
| Menu row | background / border / radius | `colors.card` / 1px `colors.cardBorder` / `24` |
| Menu row | padding / minimum height | `20` / `44` |
| Main label | fontSize / fontWeight / color | `17` / `600` / `colors.text` |
| Help line | fontSize / color | `13` / `colors.textMuted` |
| Disclosure | icon / size / color | `chevron-right` / `20` / `colors.textMuted` |

Each destination is a back-header subscreen in `ScreenShell`, passing
`onBack={() => showView('menu')}`: Settings, Profile, About, Backup, Help,
Account, and the Account children Account Lifecycle, Cloud Sync Recovery, Health
Data Consent, Legal Links, and Set New Password. The nested Account children
remain part of the Account flow rather than adding rows to the top-level menu.

Settings' Appearance and Units controls, and Profile's height unit control, use
the shared `unitTab` segmented convention: inline 44dp targets with 12px
horizontal and 6px vertical padding, 12px/700 labels, muted inactive ink, and
the active accent treatment. Settings' fatigue multiplier is a 44dp stepper
(`borderRadius: 12`) with decrement/value/increment controls. Irreversible
Account and Backup actions stay in the error-tinted, bordered 24px-radius
**Danger Zone** containers owned by those screens, as required by
`docs/ui-design-rules.md` §14.

## Modal System

Sources: `PlateCalculatorModal.js`, `WorkoutSyntaxModal.js`,
`RecoveryBlockStartModal.js`, `RecoveryBlockWeekModal.js`,
`RecoveryBlockEndModal.js`, `SessionCheckInModal.js`, and `WebAlertHost.js`.

The six sheet modals share a local implementation of this shell (duplicated in
each file, not yet a shared component):

| Element | Value |
|---|---|
| Scrim | `colors.overlay` |
| Sheet | `colors.card`, `borderRadius: 20` |
| Header | row, `paddingHorizontal: 20`, 1px `colors.cardBorder` bottom |
| Title | `fontSize: 17` |
| Close control | `✕`, `fontSize: 16`, `colors.textMuted`, `padding: 4`, `hitSlop={12}` |
| Error banner | `colors.cardErrorBg`, `borderRadius: 10` |
| Field fill | `colors.background` |
| Option row | `borderRadius: 14`, section `padding: 20` |

`WebAlertHost.js` is intentionally the alert exception rather than a sheet:
it uses a `borderRadius: 16` card with `padding: 20` inside a `padding: 24`
overlay and has no header row. The sheet close control reaches the 44dp
effective target through `hitSlop={12}` inside the padded header; the 20px row
padding keeps that slop unclipped. This is a deliberate local compliance choice
to the §15 target rule, not a general replacement for a real 44dp control box.
Accessible names are specific where useful: `Close plate calculator` and
`Close workout syntax help`; the four recovery/check-in sheet close controls
use the concise name `Close` (Session Check-In also exposes a separate `Back`).

---

## Shared History-Panel System

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

### Cloud Sync Notice (#737)

Rendered above every other tier, only when the shell-published summary carries a
notice. Queued work is informational and reuses the chip tone the shell's update
banner already uses; only a real failure takes the error surface.

| Element | Property | Value |
|---|---|---|
| Notice card (pending) | backgroundColor | `colors.chipBackground` |
| | borderColor | `colors.cardBorder` |
| Notice card (failed) | backgroundColor | `colors.errorSurface` |
| | borderColor | `colors.error` |
| Card wrapper (both) | padding / marginTop / gap | `16` / `12` / `8` |
| Title | fontSize / fontWeight | `14` / `700` |
| | color | `colors.text`, or `colors.error` when failed |
| Body | fontSize / color | `13` / `colors.textMuted` (no fixed `lineHeight`) |
| Action row | flexDirection / flexWrap | `row` / `wrap` |
| | columnGap / rowGap | `16` / `4` |
| Action (`Retry sync`, `Open Cloud Sync`) | minHeight | `44` (no fixed `height`) |
| Action label | fontSize / fontWeight / color | `13` / `700` / `colors.accentText` |

`Retry sync` renders only for the failed notice. Both actions are ≥44dp and the
row wraps, so an enlarged label at 320dp drops to a second line rather than
shrinking the target.

### Loading Placeholders (#737)

Home, Log, and Weight each render a local, **static** placeholder while a first
read is unresolved — no shimmer, no animation. There is no shared primitive;
each screen shapes its bars to the tiers it is about to paint.

| Element | Property | Value |
|---|---|---|
| Placeholder card | padding | `24` (Home) / `20` (Log, Weight) |
| | borderRadius | `24` (matches `Card`) |
| | gap | `12` |
| Bar | backgroundColor | `colors.cardBorder` |
| | borderRadius / opacity | `6` / `0.6` |
| | height | `12`, or `36` for Home's hero bar |
| | width | `'35%'` / `'75%'` / `'100%'` — always relative, never fixed px |

Each placeholder is one `accessibilityRole="progressbar"` node with a screen-
specific label (`Loading your dashboard`, `Loading your workout notes`,
`Loading your weight history`), so a screen reader announces a load in progress
rather than reading a stack of empty containers.

### Recovery Status Card (#757)

Sits directly under the Weekly Summary hero, inside the populated-dashboard
branch only — it explains what that hero's week label and classification counts
currently mean, so it belongs to them rather than to a topic of its own.

Rendering is decided by the AUTHORITATIVE recovery state
(`useRecoveryBlockState`, via `useHomeRecoverySummary`), not by the
ordinary-analytics boundary Home already gates its body on. The two are
different reads and only the first can say whether a block is active:

| Recovery state | Home renders |
|---|---|
| Verified, active block | The return-to-baseline summary (#779/#782, below) and the `Recovery` handoff |
| Verified and current, no active block | **Nothing.** Silence is a claim, and here a verified *current* read supports it |
| Verified but stale | `RECOVERY_STALE_MESSAGE` and `Retry recovery` — over the last-known-good summary when one was cached, and on its own when none was. A stale snapshot that happened to cache no active block is still one whose newest refresh failed |
| First read in flight | `RECOVERY_LOADING_MESSAGE`, and **no** retry — nothing has failed |
| First read failed | `RECOVERY_UNVERIFIED_MESSAGE` and `Retry recovery` — never silence |

Copy for the three non-ready conditions is the recovery state contract's own
(`hooks/entries/recoveryBlockHooks.js`), so Home, Log, and Analytics cannot
describe the same condition differently, and `Retry recovery` is the exact
control name that copy tells the user to tap (ui-design-rules §12).

**Active-block content (#779/#782, redesigned #803, condensed #820).** The
active branch derives the latest live week through the same
`deriveRecoveryComparison` engine Analytics uses (`AnalyticsRecoverySection`) —
no second calculation, no invented percentage or pace. The facts are the ones
#779 approved; #803 stopped presenting them as prose and made each one
independently scannable; #820 dropped the card to Goal/1K-card density and gave
its category breakdown the same grammar the hero card's own Exercise Progress
band uses, instead of a bespoke tile system. Identity label, then one analytics
region (`home-recovery-analytics`, a single `accessible` node), in this order:

- **`Recovery` header** — the identity label and the `Recovery` handoff in one
  row (ui-design-rules.md §13), same family as Exercise Progress and the 1K
  card. A footer-link split was tried and reverted: it broke the shared
  header-is-the-handoff pattern for one card without applying it to the
  others. The dead space that pattern originally left above the week eyebrow
  is solved by trimming the card's own top padding and gap instead.
- **Week eyebrow** — `Week N`, the micro-label treatment. Omitted when no week
  exists (`Baseline captured. No week logged yet.`): there is nothing to name,
  and `Week 1` would be invented.
- **Result** — the one hero figure, `X of Y` in `HeroMetric.statSecondary` /
  `colors.accentText`, with a `baseline exercises met` caption beside it. Exactly
  one of the result or a fallback occupies this slot, never both, and a
  fallback prints no count at all rather than `0 of 0`. Baseline
  unavailable/unsupported takes precedence over a missing/unreadable note,
  since it is a property of the block, not of any one week.
- **Category columns** (`home-recovery-stats`) — one dot/count/label column per
  **nonzero** `rebuilding` / `not reintroduced` / `not comparable` /
  `added during recovery` count, in that order, wrapping rather than clipping.
  A zero category is absent, not a `0` column. Reuses the visual grammar (dot,
  bold count, uppercase muted label) the hero card's Exercise Progress band
  already established, behind a `cardBorder` divider — but `flexShrink: 1`
  where `classifCol` uses `0`: the classification labels are short enough to
  always fit their wrapped column, while a category label can run to "Added
  during recovery," long enough to still overflow a full-width column at
  enlarged accessibility text, so this column has to compress and let the
  label itself wrap.
- **Stale message** — the existing `RECOVERY_STALE_MESSAGE`, only when stale.

**Dropped from Home (#820):** the exclusion clause (`Not counted in your
normal analytics.`) no longer renders here or in the composed
`accessibilityLabel` — inclusion state stays visible on the Analytics Recovery
section, which already states it per block, so Home shows the result and the
breakdown without duplicating analytics-scope detail (same compact-summary/
detail-owner split the 1K card already uses for its chart and mapping).

The region carries one composed `accessibilityLabel` assembling the remaining
facts as complete sentences in reading order (`Week 1. 1 of 2 baseline
exercises met. 1 rebuilding.`), so the layout is a visual device only —
separate value/label nodes would otherwise read as unrelated fragments.

No `on track`, percentage, prediction, or medical claim; a lift that
regresses after being met is `rebuilding` again, not a new state.

| Element | Property | Value |
|---|---|---|
| Card | padding / paddingTop / gap | `24` / `14` / `4` |
| `Recovery` header (`home-recovery-link`) | minHeight | `44` (no fixed `height`) |
| | label fontSize / fontWeight | `12` / `700` |
| | textTransform / letterSpacing | `uppercase` / `0.5` |
| | color | `colors.text` |
| Week eyebrow | fontSize / fontWeight / color | `11` / `700` / `colors.textMuted` |
| | textTransform / letterSpacing | `uppercase` / `0.5` |
| Result figure | style / color | `HeroMetric.statSecondary` (24/900) / `colors.accentText` |
| Result caption | fontSize / color | `13` / `colors.textMuted` |
| Fallback status | fontSize / fontWeight / color | `16` / `700` / `colors.text` |
| Category divider | borderTopWidth / color / paddingTop / marginTop | `1` / `colors.cardBorder` / `14` / `12` |
| Category columns | flexWrap / columnGap / rowGap | `wrap` / `16` / `12` |
| Category dot | size / color | `8x8` circle / `colors.accent` at `0.55` opacity |
| Category count | fontSize / fontWeight / color | `18` / `700` / `colors.text` |
| Category label | fontSize / fontWeight / color | `11` / `600` / `colors.textMuted` |
| | textTransform / letterSpacing | `uppercase` / `0.5` |
| Status line | fontSize / color | `13` / `colors.textMuted` (no fixed `lineHeight`) |
| `Retry recovery` | minHeight | `44` (no fixed `height`) |
| | label fontSize / fontWeight / color | `13` / `700` / `colors.accentText` |

No element in the card declares a fixed `height` or `lineHeight`, so every line
grows with the user's text size; the `Recovery` handoff remains the card's only
navigation press target and keeps its `minHeight: 44`.

The header handoff (`home-recovery-link`) reuses the shared `sectionHeaderAction`
treatment (label plus the plain SVG chevron) already used by `Exercise Progress`
and `1K Progress`, and targets the `recovery` section of the Analytics tab
(`onNavigate('Analytics', 'recovery')`) — the Recovery section itself, not just
the tab that contains it, the same section-id vocabulary `weight` and `strength`
already use and that is owned by `App.js`.

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
| | color | **`colors.accentText`** | `901` |
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
| | color | `colors.accentText` | `970` |
| Insights chevron SVG | stroke | `colors.accent` | `147` |

### Weight Goal Card

| Element | Property | Value | Line |
|---|---|---|---|
| Card padding | `24` | | `972` |
| Card borderRadius | `24` | | `973` |
| Direction text ("Cutting"/"Bulking") | fontSize | `18` | `983` |
| | fontWeight | `700` | `984` |
| | color | dynamic: `colors.success` (gain), `colors.accentText` (loss), `colors.textMuted` (maintain) | `159-163` |
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

### 1K Club Card (Home)

Home is the **compact-summary** treatment (#763): the breakdown is plain data
(no chart, mapping, or explanation — those stay Analytics-owned). Progress
bar, unit suffix, and per-lift value/label typography are normalized against
the Analytics owner card below. The hero total itself spreads `HeroMetric.hero`
just like Analytics' — #763 gave it a smaller `32`/`800` override to signal
the compact-vs-owner distinction, but that read as a visual demotion of a
primary progress summary, so #771 restored the shared hero scale; the
compact-summary role is now carried by scope (no chart/mapping/explanation),
not a shrunken total.

**Header stays the handoff (#820).** The 44dp header tap-target box, stacked
on top of the card's `24` padding, left ~78px of empty space before the hero
number the card exists to show. A footer-link split (moving the handoff below
the grid) was tried and reverted — it broke the header-is-the-handoff pattern
shared with Exercise Progress and Analytics for one card without applying it
to the others. The fix is instead a trimmed card top padding (`24` → `14`) and
`gap` (`10` → `6`) around the still-44dp header, so the space shrinks without
touching the touch target every Home handoff is held to. The Recovery card
got the identical treatment for the same reason.

| Element | Property | Value | Line |
|---|---|---|---|
| Card padding / paddingTop / gap | `24` / `14` / `6` | | `1289` |
| Card borderRadius | `24` | | `1289` |
| Header (`home-one-k-link`) | minHeight | `44` (no fixed `height`) | |
| | label fontSize / fontWeight | `12` / `800`, uppercase | |
| | color | `colors.textMuted` | |
| Hero total value | fontSize | `48` (`HeroMetric.hero`) | `1153` |
| | fontWeight | `900` (`HeroMetric.hero`) | `1153` |
| | color | `colors.accentText` lerped toward `colors.success` as progress nears 1000 (inline override, always applied — `oneKHeroValue`'s own `colors.text` is never seen, `729`) | `1153` |
| Hero unit | fontSize | `16` | `1157` |
| | color | `colors.textMuted` | `1157` |
| Progress bar | height | `8` | `1165` |
| | background | `colors.divider` | `1165` |
| | fill | `colors.accent` | `1173` |
| | borderRadius | `4` | `1165` |
| | marginBottom | `16` | `1165` |
| Breakdown value | fontSize | `16` | `1194` |
| | fontWeight | `700` | `1194` |
| | color | `colors.text` | `1194` |
| Breakdown label | fontSize | `11`, uppercase | `1199` |
| | fontWeight | `600` | `1199` |
| | color | `colors.textMuted` | `1199` |
| Breakdown dividers | borderWidth | `1` | `1187` |
| | color | `colors.cardBorder` | `1187` |

The vertical `borderLeft/Right` breakdown dividers (vs. Analytics' single
`borderTop` above the whole row) stay an intentional structural deviation —
Home's three-column grid reads at a glance, Analytics' row sits under its own
divider ahead of the chart and info disclosure beneath it.

---

## Analytics Screen

Source: `mobile/screens/AnalyticsScreen.js`

Section order (#821): **Overview → Weight Trends → Recovery → Fatigue →
Strength**, with Progressive Overload and Big 3 Mapping inside Strength.
Progressive Overload deliberately stays last on the tab: it is the longest
surface and the overview summarises it at the top, so it does not need to be
scrolled past to reach anything else.

### Overview Card (`AnalyticsOverviewCard.js`, #821)

The tab's first block and the destination for the `overview` navigation id.
Reads only display-space series the other sections already plot
(`oneKChartData`, `rolling7`); `deriveOverviewRows` performs no conversion.

| Element | Property | Value |
|---|---|---|
| Panel | `ArtisanalPanel`, `padding: 0` | |
| "Overview" label | fontSize / weight | `11` / `800` uppercase, `letterSpacing: 1` |
| As-of caption | fontSize | `11`, `textMuted` |
| Row | paddingHorizontal / Vertical | `16` / `12`, `minHeight: 44` |
| | divider | `borderTopWidth: 1` / `colors.divider` |
| Row label | fontSize / weight | `14` / `600` |
| Row value | fontSize / weight | `17` / `700`, monospace |
| Row value unit / suffix | fontSize | `11`, `600`, `textMuted` |
| Delta | fontSize / weight | `12` / `700`, monospace |
| | color | `colors.success` up, `colors.error` down |
| Caption | fontSize | `12`, `textMuted` |

Three distinct no-value states: `unavailable` (failed read), loading, and an
ordinary empty state carrying its own next action. See `ui-design-rules.md` §8.

### Weight Trends Card

| Element | Property | Value | Line |
|---|---|---|---|
| Card padding | `20` | `356` |
| "Latest weigh-in" label | fontSize | `12` | `365` |
| | fontWeight | `700` | `366` |
| | textTransform | `uppercase` | `367` |
| Weight value | fontSize | `32` | `372` |
| | fontWeight | `900` | `373` |
| | color | `colors.accentText` | `374` |
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
| | color | `colors.accentText` | `426` |
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

### Recovery Section (`AnalyticsRecoverySection.js`)

Section order on the Analytics tab (R5a/R5b, #790/#793): **Weight → Recovery →
Fatigue → Strength → Progressive Overload**. Recovery sits directly above
Fatigue — the two are the tab's "should I be training normally right now?"
sections — but stay visually distinct: separate `SectionTitle`s, no shared
measure, no cross-reference. Recovery keeps `HeroMetric` + per-exercise
meters; Fatigue keeps `SessionGauge` + its check-in card.

Progressive disclosure (#758, R5b): the section answers "how close am I to my
normal training?" before it shows any evidence. Reading order inside the block
card is **identity caption → hero/summary → week selector → details
disclosure → provenance**, and both disclosures start collapsed.

| Element | Property | Value |
|---|---|---|
| Identity caption | fontSize / weight | `13` / `700`, `textMuted` — `Week N · {routine}`, or `Baseline: {routine}` before any week is logged |
| Hero count | style | `HeroMetric.statPrimary`, `colors.accentText` — `X of Y`, never a composite score |
| Hero caption | fontSize / weight | `13` / `600`, uppercase, `letterSpacing: 0.5`, `textMuted` |
| Hero/summary group | accessibility | `accessible` + `accessibilityLabel` + `accessibilityLiveRegion="polite"` so a week change is announced without scrolling |
| Summary line | fontSize | `13`, `textMuted` — `Week N · <non-zero states>` |
| Week chips | shared `chip` styles | radius `14`, 1px `cardBorder`, `subtleBg`, `minHeight: 44`; selected = `accent` fill / `onAccent` text; shown only when the focused block has more than one week |
| Details header | title / count | `13` / `700` `text`; collapsed count `12` / `600` `textMuted` |
| Details collapse | icon | `MaterialIcons` `expand-more`/`expand-less`, `18`, `textMuted` (app-wide convention) |
| Metric legend | fontSize / lineHeight | `12` / `17`, `textMuted` |
| **State group header** | fontSize / weight | `11` / `800`, uppercase, `letterSpacing: 0.5`, `textMuted`, `accessibilityRole="header"` — `{State} (N)` |
| Provenance line | fontSize | `12`, `textMuted` — card's last line: `Started {date}` (active) or `{start} – {end}` (completed) |
| Completed-block history | default | collapsed, summary header states the count and the latest block |

**State group header** (R5b, #793) is the pattern that replaced the removed
status-filter chip row: every exercise row is always shown, grouped under a
counted, `accessibilityRole="header"` heading instead of hidden behind a
filter mode. Groups render in order `Baseline met`, `Rebuilding`,
`Not reintroduced`, `Not comparable`, `Added during recovery`, and an empty
group renders nothing.

Wording is part of the contract, not decoration:

- The hero is the count of baseline exercises met. No composite recovery score
  exists on this surface.
- `Total work` replaces `Volume`, and the legend defines it as load × reps
  across completed working sets.
- `Load` is defined as the heaviest completed working set that week — explicitly
  not an all-time max or an estimated 1RM.
- No-week, note-missing, and note-unreadable copy matches Home's R3a wording
  exactly: `Baseline captured. No week logged yet.`; `Week N — This week's
  note is no longer available.`; `Week N — This week's note couldn't be
  read.`
- A week whose linked note is missing or unreadable states that **above** the
  disclosure, which is not rendered at all — a collapsed panel is never the
  reason evidence is absent. Loading, stale, retry, and unverified copy is
  unchanged and still comes from the recovery state contract.

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
| | color | `colors.accentText` | `WeightGoalCard.js:354` |
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

### Editor Actions (#919)

The Weight tab's text-only editor actions each own a **44×44dp target from
their own box**, never a `hitSlop` — `ui-design-rules.md` §15 (React Native
clips a slop at a one-line row's bounds). Type, weight, color, and the input
card's 16px rhythm are unchanged; only the tap box grew.

| Control | Property | Value | Source |
|---|---|---|---|
| Editing-header `Cancel`, note/date `Done` (×4) | minHeight / minWidth | `44` / `44` (`justifyContent` + `alignItems` `center`) | `WeightScreen.js` `editorActionTarget`; label 14 / 600 stays on `cancelText` |
| | accessibilityRole / Label | `button` / `"Cancel"` (header), `"Done …"` (each disclosure) | header `Cancel` gained both in #919 |
| Goal `Edit` / `Archive` / `Clear` chip (5 sites) | minHeight / minWidth | `44` / `44` (`center` / `center`) | `WeightGoalCard.js` `goalActionChip`; 13 / 700 label, 12 / 6 padding unchanged |
| | accessibilityRole / Label | `button` / visible label | added in #919 |
| Goal-editor `Cancel` | minHeight / minWidth | `44` / `44` (`center` / `center`) | `WeightGoalCard.js` `goalCancelTarget`; 14 / 600 label stays on `goalActionText` |
| | accessibilityRole / Label | `button` / `"Cancel"` | added in #919 |
| Every one of the above | label `Text` | `accessible={false} importantForAccessibility="no"` | §15: the named parent announces once, not twice with its child |

Guarded by the `Weight entry controls` and `Weight goal editor actions` blocks
in `mobile/tests/interaction-target-a11y.test.js`, which assert the flattened
target plus the parent role/name **and** `accessible === false` on the label.

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

## Log Screen

Source: `mobile/screens/LogScreen.js`, and the extracted
`mobile/components/LogActiveRoutineCard.js`, `LogPreviousRoutines.js`, and
`LogScreenEditorCard.js`. The Log style lock spans all of these, not
`LogScreen.js` alone.

Style lock header at lines 1-46 (`mobile/screens/LogScreen.js`): do not change
Log styling unless the repo owner explicitly asks. The authorized layout
exceptions for #710 and #711 are enumerated in that same header block. #843
is a further owner-authorized exception (the Recovery/Routine redesign
below), scoped to `styles.tabToggle` in `LogScreen.js` plus
`LogRecoverySection.js`, `RecoveryBlockEndModal.js` (new), and
`LogPreviousRoutines.js`. #847 is a further owner-authorized exception,
scoped to `LogPreviousRoutines.js` alone, that removes #843's enclosing More
Routines panel and restores individually rounded non-current routine cards
(see Consequences below). #918 is a further owner-authorized exception,
scoped to text `color` values ONLY, that moves every string the user reads off
the `accent` mark value onto `accentText` / `chipAccentText` across the Log
tab, `RecoveryBlockEndModal.js`, and `WorkoutSubheading` in `UI.js`. #921 is a
further owner-authorized exception, scoped to the effective target geometry of
exactly two controls in `LogRecoverySection.js` — `Edit note` and the A/B
segment — and to nothing else: no color, type, spacing, rail, or row-height
value in the Recovery card changes with it.

The Current routine card remains locked. #843 and #847 do not authorize
touching it at all; #918 reaches exactly one property on it —
`currentNoteTitle`'s ink — and nothing else about that card. No exception to
date changes any size, weight, spacing, layout, fill, or border value on it.

### Action hierarchy (#711)

Routine-card headers carry identity only (`ui-design-rules.md` §14). Every
action is placed by how often it is used:

| Tier | Actions | Location |
|---|---|---|
| Primary — every session | `Track` a lift, `Edit`, `Week A/B`, skip week | Active card body, plus the one action strip under its header (`LogActiveRoutineCard.js` `actionStrip`) |
| Secondary — occasional | `Edit routine`, `Delete routine`, viewed-card `Week A/B`, full `Set as current routine` | Non-current row's expand-on-tap body (`LogPreviousRoutines.js` `inlineActions`), inside expanded routine management |
| Quick access — reachable without opening (#756, #836; the per-row quick action retired #843) | `New routine` (icon + visible label, the section's ONE create-routine affordance) | A sibling row of the section title, OUTSIDE the collection disclosure entirely (#843, #847) — present and identical whether the collection is collapsed or expanded (`LogPreviousRoutines.js` `topRow`) |
| Rare — once per training block | `Start recovery block` | A persistent, low-emphasis outline row directly under the current routine card (`LogScreen.js` `recoveryStartRow`), never nested in a menu or disclosure; absent whenever a block cannot be started (#823, superseding #724's routine-management placement) |
| Rare — reopening the most recently completed block, offered only with no block active (#839) | `Reopen recovery block: {baseline title}` | A second, lower-emphasis outline row (`LogScreen.js` `recoveryReopenRow`) directly below `Start recovery block` — same shape, `textMuted` ink instead of `accent`, so `Start` stays visually primary; computes its own visibility independently and can render alongside `Start`. The Analytics evidence card (`AnalyticsRecoverySection.js`) offers the same action, secondary-styled, only on the newest completed block's own card |
| Recovery — expected next step | `Complete Week {N}` **or** `Add week` (never both), each behind its own confirmation | The active card's action zone, visible by default, full-width/48px, and the card's only accent-filled control, with a muted explanatory caption beneath it (`LogRecoverySection.js`, #789/#804/#836/#843) |
| Recovery — reversal, offered only for the just-completed latest week | `Undo completion` | Beside the primary action, muted (not `error`) ink — a routine correction, not a destructive action (#843; was an `error`-labeled chip) (`LogRecoverySection.js`, #836) |
| Recovery — correction or once-per-block | `Counting in normal analytics`, `Unlink Week {N}'s note`, `End recovery block` | `Manage block`, a sibling card next to the active card (#843, no longer a disclosure INSIDE it), holding three divided list rows; `End recovery block` opens `RecoveryBlockEndModal` instead of `Alert.alert` |
| Routine/Recovery editor — safe exit | `Done` (and Android Back) | Keeps the latest edit, flushing any pending or in-flight autosave before the editor closes (#851) |
| Editor — whole-edit rollback | `Revert this edit` | A danger-zone body action, never an ambiguous header `Undo`; confirmation names the editor-entry snapshot and includes already-autosaved changes. Recovery's scoped inline `Cancel` opens a choice between Keep editing, Done, and the same confirmed rollback (#851) |

Consequences to preserve:

- **More Routines has no enclosing panel (#847, superseding #843's
  card-equivalent panel with a flat, divided row list).** Each non-current
  routine renders as its own quiet, individually rounded `Card` (`radius 24`,
  1px `cardBorder`, standard card background), separated from its siblings by
  ordinary shell spacing (`LogPreviousRoutines.js` `cardList`, `gap: 12`) —
  not a shared outer surface, a flat divided list, or a tinted collection bar.
  This restores the pre-#843 (`096bf89^`) hierarchy: individual pills,
  restrained borders, the active routine dramatically more prominent by
  comparison. No accent rails, filled accent headers, or "current" badges are
  added to these cards.
- **The count and `New routine` live OUTSIDE the collection disclosure
  entirely (#843, #847, superseding #756/#836's in-header placement).**
  `More Routines · {count}` IS the section's `SectionTitle` now — always
  visible, expanded or collapsed, never repeated or hidden by the
  disclosure's own state — and a sibling 44dp outlined `New routine` control
  (icon + visible label, this section's ONE create-routine affordance) sits
  beside it in the same header row.
- **More Routines is a collapsed-by-default disclosure (#724), and since #847
  the disclosure trigger is a lightweight text-plus-glyph control, not a
  bordered panel header.** It is modeled on Analytics → Progressive
  Overload's bulk expand/collapse control (`AnalyticsScreen.js`
  `collapseAllButton`): compact `Show routines`/`Hide routines` text (muted
  ink, uppercase, letter-spaced) plus a `MaterialIcons` `unfold-more`/
  `unfold-less` glyph (16, `textMuted`), a 44dp touch target, explicit
  `accessibilityRole="button"`, and `accessibilityState={{ expanded }}`. It
  carries no border, background tint, or card radius of its own — unlike
  #843's bordered/tinted panel header, and unlike Progressive Overload's own
  chevron (`unfold-less`/`unfold-more` is reused here deliberately: this
  control also acts on a whole collection at once, not a single panel).
  Collapsed, the routine cards render nowhere. An external request to reveal
  a non-current routine — a typed navigation intent (#718) naming a
  non-current, non-deload routine, and nothing else since #775 — auto-expands
  the disclosure via a monotonic reveal nonce keyed on the REQUEST, not on
  `viewingNoteId`, so a repeat request for the already-selected note reopens
  it while an unchanged nonce respects a user's collapse. A Recovery tap
  reveals nothing: it reads its note in the Recovery card instead (see below).
- **The per-row icon-only `Set as current routine` quick action is retired
  (#843, superseding #756).** Switching the current routine is reachable only
  from a row's own expanded body now, alongside `Edit routine` and `Delete
  routine`; a collapsed row shows only title and an inline `Created {date} ·
  Recovery week {n}` metadata caption (folding the former standalone recovery
  badge into that one line) plus the expand glyph.
- **The disclosure state is owned by `LogScreen`, not by the sections (#775).**
  Routine and Deload are mutually exclusive branches, so `LogPreviousRoutines`
  and `LogDeloadSection` unmount on every view switch; `expanded`,
  `deloadCollapsed`, and the consumed-reveal marker therefore live in
  `LogScreen` and arrive as props. A user's collapse choice survives
  Routine↔Deload↔Routine, and a consumed reveal request is never replayed by the
  remount.
- **A routine row's date is its creation day (#775).** The sub-line and the
  row's `accessibilityLabel` read `Created <date>` from `saved_at`, falling back
  to the creation day encoded in the note id (`wn_YYYY-MM-DD_…`) and then to no
  date at all. `updated_at` is never displayed: it is the sync conflict cursor
  (`docs/backend-schema.md`), so editing, tapping `Week A/B`, syncing, or
  restoring a backup all moved it. The expanded list sorts by that same
  displayed field, newest first, undated last in notebook order. The viewed
  row keeps its `Week <X> · ` prefix in front of the date.
- **The collapsed header has no `Latest:` line (#836, retiring #775's
  collapsed-summary naming).** Naming one routine out of several implied a
  hierarchy among prior routines that does not exist. Collapsed, the header
  shows only a `{N} more routine(s)` count, at a weight legible as a
  section heading (`15`/`700`, `colors.text`) rather than a small caption;
  expanded, the count is not repeated at all, since the list below it already
  shows every routine.
- The active card's strip renders `Skip week` **or** `Remove skip`, never both.
  There is no opacity-dimmed disabled variant.
- The `Double-tap to edit` hint is retired in both the active card and the
  non-current card body (#711, #724); the double-tap gesture itself still works.
- **Recovery is its own tab, present only while `LogRecoverySection` has
  something to show (#823).** `recoveryTabVisible` (`LogScreen.js`) mirrors
  that component's own early-return contract exactly — not just an active
  block, but also a pending/in-flight recovery operation, a stale snapshot
  with no active block, or a terminal initial-load failure
  (`!recoveryReady && recoveryStateError`, as opposed to still-loading), all
  of which the component already renders a banner/retry for. The
  Routine/Deload pill becomes a three-way
  Routine/Deload/Recovery toggle whenever `deloadModeEnabled` or
  `recoveryTabVisible` is true; Recovery renders first (leftmost) whenever
  it's present, and the tab disappears the instant nothing is left to show —
  `effectiveTabView` falls back to `routine` the same way it already did for
  a since-disabled Deload tab. Recovery is also the DEFAULT landing tab
  whenever it's present: it rendered unconditionally at the top of the
  Routine tab before this redesign, so a one-shot effect
  (`recoveryDefaultAppliedRef`, `LogScreen.js`) selects it the first time
  verified Recovery state resolves with something to show, preserving that
  same effective visibility without fighting a later manual switch to
  Routine/Deload. Confirming `RecoveryBlockStartModal` also navigates there
  (`setTabView('recovery')` in `handleConfirmRecoveryBlock`), so the block
  just created is where the user lands. `LogRecoverySection` itself renders
  unchanged — only which tab hosts it, and when, moved.
- The primary Recovery entry point (`Start recovery block`) is a persistent
  row under the current routine card, not inside routine management or the
  Recovery tab (#823, superseding #724's routine-management placement). It is
  **absent** — not merely disabled — whenever a block cannot be started: it
  renders only when a baseline note is eligible, no block is active, the
  shared Recovery read is verified and not stale, and no Recovery action is
  pending/in-flight with `mutationsAllowed` true. When shown it is always
  live, and opens `RecoveryBlockStartModal` with
  `{ mode: 'routine', note: null }` so the modal's own baseline/Week 1 pickers
  choose the subject; `startRecoveryBlock` rechecks the authoritative
  precondition at confirm.
- **A second, secondary entry point reopens the newest completed block
  (#839).** `Reopen recovery block: {baseline title}` renders directly below
  `Start recovery block` — same row shape, `textMuted` ink rather than
  `accent` so `Start` stays visually primary — whenever no block is active
  and the newest completed block (by `completed_at`) is live. It computes its
  visibility independently of `Start`'s and the two render together whenever
  both qualify; neither gates the other, and both disappear once either
  succeeds and a block becomes active. Tapping it confirms
  (`Reopen this recovery block?`, naming the baseline, stating that every
  week's status is unchanged and that only the most recent completed block
  can be reopened while no other is active) before calling
  `useRecoveryBlockLifecycle().reopenBlock`, which clears only the block's
  `completed_at` — no week's completion state moves. The Analytics evidence
  card (`AnalyticsRecoverySection.js`) offers the identical action, low
  -emphasis and non-destructive, on the newest completed block's own card
  only — never on every collapsed history row, and never on an older
  completed block. `Start` and `reopenBlock`'s writes now run behind the same
  process-wide recovery-operation lock (`runGuardedRecoveryAction`), so the
  two can never both observe "no active block" and create conflicting state.
- **A Recovery week row reads its own note (#775).** Tapping a live week renders
  that note inline in the Recovery card, off the same
  `viewingNoteId`/`viewingNote`/`viewingNoteDayGroups` state the routine and
  deload viewers use; More Routines is not revealed and does not change state,
  and a week linked to the *current* routine is readable like any other rather
  than being an inert press. Because that viewer state projects one half of an
  A/B note, the inline read also carries the non-current card's `Week A/B` pill
  in its existing treatment and with the same role, label, and `selected` state
  — otherwise an A/B recovery week's other week would be unreachable here. The
  inline read also carries an `Edit` button in the same `inlineSwitchButton`
  treatment (#823), opening the shared editor via `handleEditViewedNote`
  (not `handleOpenOtherNote`, deliberately: it reads the currently-selected
  A/B week off shared viewing state, so Edit opens the same half the user was
  just reading) — every other note viewer in this tab (deload record, prior
  routines) already had one; a recovery week's note previously had no path
  back into editing. A week whose `note_id` is null, or names a note
  absent from the notebook, shows `Note unavailable` in place of a title,
  announces `Recovery Week N, note unavailable`, and carries no `onPress`, no
  `chevron-right`, and no
  `accessibilityRole="button"` — the row remains, its `Unlink` remains
  (in the disclosure, see below), and that unlink confirmation drops both the
  quoted title and the "note itself is kept" clause. `Untitled Routine` is
  reserved for notes that exist.
- **The active Recovery card is one grouped, three-zone card (#789, restyled
  #843).** `padding: 0`, clipped at the existing 24px radius/border, holding a
  state zone, a week table, and an action zone, followed by a SIBLING `Manage
  block` card (see below) — the disclosure that used to live inside the
  active card moved out. The state zone (`colors.subtleBg`) leads with a
  `RECOVERY BLOCK` kicker, then a state-derived headline — `Week {N} in
  progress` or `Week {N} complete — add the next week` — then the baseline as
  one de-emphasized `Baseline: <routine>` caption; the headline still
  describes only the CURRENT week. The action zone holds exactly one
  full-width 48px primary action (`Complete Week {N}` while the week is open,
  `Add week` once it completes — mutually exclusive by construction) with a
  muted explanatory caption beneath it; once the current week is complete, a
  muted-ink (not `error`) `Undo completion` control sits beside it (#836) —
  offered only for that just-completed latest week. `Complete Week {N}`
  confirms its consequence before committing (`Complete Week {N}?`, stating
  that it completes the current week, preserves its note, and does not create
  or submit the next week's note, via `Alert.alert`, unchanged); `Undo
  completion` confirms too (`Reopen Week {N}?`).
- **Every live week is its own labeled, distinguishable row (#836, restyled
  #843).** Each row (`minHeight: 56`, 18px horizontal padding, divider lines)
  holds a 26px status dot (a success-at-12%-alpha filled circle with a 16px
  check for completed; an accent-bordered ring for in-progress — no more
  repeated `In progress`/`Completed` text), a fixed 56px `Week {N}` label, a
  one-line note title, and an `expand-more`/`expand-less` glyph — never
  `chevron-right` — for every linked-note row, completed weeks included. The
  current week's row and expanded body share an accent-at-6%-alpha background
  and a 3px accent left rail (padding compensated 18→15). A second tap on an
  already-expanded row collapses it; Back also collapses it. Accessible names
  are unchanged (`View <title>, Recovery Week N` / `Recovery Week N, note
  unavailable`; a completed row's name gains `, completed`). The expanded body
  is inset in a card-colored, 14px-radius bordered surface with an uppercase
  accent kicker on the left and the Recovery `A`/`B` segment (replacing the
  former `Week A/B` pill; a 32px visual centered in a real 44×44dp target box,
  so the header row is 44dp tall — **not** a sub-44dp exception, and **not** a
  `hitSlop`, which #921 removed because `noteSurfaceHeader` clipped it)
  above the content it governs. Note content renders via
  `WorkoutContentRenderer`'s `compact` prop (exercise 14/700; sets
  13/muted/600) — Routine rendering elsewhere stays full-scale. The one
  expanded-note action is a single outlined `Edit note` control
  (`accessibilityLabel="Edit"`, unchanged) at `minHeight: 44` since #921, with
  its 13px label, 1px outline, and 10px radius unchanged, opening the shared
  inline editor (#841) on the exact note and A/B half being viewed. Neither
  this control nor the A/B segment declares a fixed `height`, so both grow
  with the user's text scale (`ui-design-rules.md` §15, which holds the single
  authoritative sub-44dp exception list — this map records none of its own).
- **`Manage block` is a sibling card, not a disclosure inside the active card
  (#843, superseding #789's in-card placement).** Its trigger is **never**
  disabled — a locked user can still open it and see why each row is
  unavailable — and it renders four divided list rows with trailing
  chevrons: `Reason for this block` (#872 — the optional free text, showing
  the stored reason or `Not set. Add why this recovery started.`; tapping it
  swaps the row in place for an inline `TextInput` with `Cancel`/`Save`
  rather than opening a modal, seeded from the stored value so `Cancel` is a
  true discard, and saving empty text clears the field. Collapsing `Manage
  block` closes the editor with it — and note that this is not the only place
  the field is editable: the Analytics evidence card carries the same inline
  editor on its reason caption, which is the ONLY way to reach a block once it
  is completed, since `Manage block` exists only for the active one),
  `Counting in normal analytics` (the row itself IS the
  Log-surface inclusion control now, `accessibilityRole="switch"` — tapping
  it writes `include_in_normal_analytics` directly, live `On`/`Off` stated
  on the row; a trailing `info-outline` help toggle swaps the subtitle for
  the same `RECOVERY_INCLUSION_HELP` copy on demand. The switch Pressable
  and the help Pressable are TRUE siblings under a plain, non-accessible
  wrapper View — not nested inside one another — so VoiceOver never groups
  the help button into the switch's own accessible tree (#843 review).
  `RecoveryInclusionToggle`'s own Switch presentation is unchanged but no
  longer used here — it still hosts Analytics/Home's per-completed-block
  rows), `Unlink Week {N}'s note` (always naming the concrete current week —
  there is no row-level `Unlink`), and error-colored `End recovery block`,
  which opens `RecoveryBlockEndModal` instead of `Alert.alert`.
- **Recovery's expanded-note viewer is a separate state slot from Routine's
  (#836).** `useLogOtherRoutineEditor.js` instantiates its shared
  `viewingNoteId`/`viewingNote`/`viewingNoteDayGroups`/`Week A/B` machinery
  twice — once for the Routine tab (`LogPreviousRoutines`, unchanged prop
  names), once for Recovery (`recoveryViewingNoteId` etc., consumed by
  `LogRecoverySection`) — so an expanded note on one tab can never appear on,
  or be inherited by, the other. Recovery's own note tap
  (`handleViewRecoveryNote`) is now toggling, matching the Routine tab's
  `handleViewOtherNote`, rather than the previous set-only handler.
- `LogRecoverySection` renders only when Recovery affects the current workout
  (active/pending/terminal-error/stale). Completed history and its inclusion
  controls live in Analytics (#727-729), so completed-only users see no Recovery
  section on Log. A cold first read stays neutral (renders nothing) so a
  non-adopter never sees a Recovery card flash; a terminal first-read failure
  still shows the unknown state with `Retry recovery`.
- `RecoveryInclusionToggle` (#843: no longer hosted on Log — see the
  `Manage block` bullet above — now hosted only by every completed-block row
  on Analytics/Home) states `Include recovery notes in normal analytics` and
  nothing else by default. The explanation moved behind an
  `info-outline` info button beside the label (#757): a 16dp glyph centered in
  a real `44 x 44` Pressable box — **not** a `hitSlop`, which React Native
  clips at the parent's bounds and which would therefore claim a target this
  one-text-line-tall row never had — plus `accessibilityState={{ expanded }}`
  and an accessible name that names the block so one row's button is distinguishable
  from the next. The disclosed paragraph describes what turning the switch ON
  does, names every surface it changes, and closes the two questions the
  always-visible copy existed to answer (the notes stay in Recovery Analytics,
  and stay editable). Disclosure state is per mounted control and is not
  persisted. Switch behavior, accessible names, and the error banner are
  unchanged.
- Relocated controls keep their existing style objects — the pill
  (`inlineSwitchButton`, `minHeight: 44`) and the shared `Button` variants
  (`switchButton` / `deleteButton`) are unchanged.

| Element | Property | Value | Line |
|---|---|---|---|
| Current note title | fontSize | `24` | `LogActiveRoutineCard.js` |
| | fontWeight | `800` | `LogActiveRoutineCard.js` |
| | color | `colors.accentText` (#918) | `LogActiveRoutineCard.js` |
| Current routine card | borderWidth | `4`, `colors.accent` on all sides | `LogActiveRoutineCard.js` |
| | padding | `0` | `LogActiveRoutineCard.js` |
| Other note title | fontSize | `17` | `LogPreviousRoutines.js:337` |
| | fontWeight | `700` | `LogPreviousRoutines.js:338` |
| Other note subtitle | fontSize | `12` | `LogPreviousRoutines.js:342` |
| | color | `colors.textMuted` | `LogPreviousRoutines.js:343` |
| WorkoutHeading (UI.js) | fontSize | `22` | UI.js:640 |
| | fontWeight | `800` | UI.js:641 |
| | textTransform | `capitalize` | UI.js:645 |
| WorkoutSubheading (UI.js) | fontSize | `14` | UI.js:655 |
| | fontWeight | `700` | UI.js:656 |
| | color | `colors.accentText` (#918) | UI.js:657 |
| | textTransform | `uppercase` | UI.js:658 |
| Exercise name (UI.js) | fontSize | `17` | UI.js:678 |
| | fontWeight | `700` | UI.js:679 |
| Set row font size (UI.js) | fontSize | `14` (`SET_ROW_FONT_SIZE`) | UI.js:8 |
| Mode toggle ("Done") | fontSize | `14` | `LogScreen.js:744` |
| | fontWeight | `700` | `LogScreen.js:745` |
| | color | `colors.chipAccentText` (#918 — sits on the chip fill) | `LogScreen.js:746` |
| | bg | `colors.chipBackground` | `LogScreen.js:741` |
| | borderRadius | `12` | `LogScreen.js:740` |
| Input field | fontSize | `16` | `LogScreenEditorCard.js:626` |
| | borderRadius | `16` | `LogScreenEditorCard.js:621` |

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
| Home | 1K total | `48` | `900` (`HeroMetric.hero`) | lerped `accent`→`success` |
| Analytics | Weight value | `32` | `900` | `accent` |
| Analytics | 1K total | `48` | `900` | `accent` |
| Weight | Goal value | `24` | `900` | `accent` |
| Weight | Trend value | `20` | `900` | `text` |

Home uses `800` for bold metrics; Weight uses `900` with no shared system between
those two screens. The Home/Analytics 1K pair shares the same `HeroMetric.hero`
scale — see below.

### 1K Card: Home vs Analytics (#763, restored #771)

Home is the compact-summary treatment; Analytics is the detail owner (chart,
Big 3 mapping, calculation explanation, plate calculator). #763 gave Home's
hero total its own smaller `32`/`800` override to signal that hierarchy, but
that read as a visual demotion of a primary progress summary — #771 restored
the pre-#763 scale so the total spreads `HeroMetric.hero` (`48`/`900`) exactly
like Analytics' owner card. A plain, quiet chevron in the card's header still
marks Home as a handoff rather than the destination, so the compact-vs-owner
distinction lives in scope and ownership, not typographic scale. Everything
that plays a supporting role — progress track, unit suffix,
and per-lift breakdown typography — stays normalized so the two surfaces read
as one family.

| Property | Home | Analytics | Status |
|---|---|---|---|
| Total fontSize | `48` (`HeroMetric.hero`) | `48` (`HeroMetric.hero`) | normalized (#771; was a `32`/`800` explicit override on Home, #763) |
| Total fontWeight | `900` (`HeroMetric.hero`) | `900` (`HeroMetric.hero`) | normalized (#771) |
| Card padding | `24` | `24` | normalized |
| Progress bar background | `colors.divider` | `colors.divider` | normalized (#763; was `cardBorder` on Home) |
| Progress bar borderRadius | `4` | `4` | normalized (#763; was `6` on Home) |
| Unit suffix | literal leading space (`" {unit}"`) | literal leading space (`" {unit}"`) | normalized (#763 review) — both are a `Text` nested inside the value `Text`, where native RN treats the child as an inline attributed run, not a Yoga box, so `marginLeft` on the nested `Text` did not reliably create spacing on either surface; both now use a literal leading space to guarantee "1000 lb" renders correctly on iOS/Android |
| Breakdown value fontWeight | `700` | `700` | normalized (#763; was `800` on Home) |
| Breakdown value fontSize | `16` | `18` | intentional (scales with hero size) |
| Breakdown label | `11`, uppercase | `11`, uppercase | normalized (#763; Home was `12`, sentence case) |
| Breakdown divider | vertical `borderLeft/Right` between items | horizontal `borderTop` above row | intentional (Home's 3-column grid vs Analytics' row-then-chart layout) |

The remaining differences (breakdown fontSize, divider orientation) are the
owner-vs-compact-summary hierarchy working as intended, not unresolved drift.

### Support Label Patterns

| Pattern | fontSize | Weight | Case | Screens |
|---|---|---|---|---|
| Uppercase micro-label | `10` | `700` | `uppercase` | Analytics (column headers, trend labels), Weight (trend labels) |
| Uppercase small label | `11` | `600` | `uppercase` | Home (hero sublabels, 1K breakdown labels — #763), Analytics (footer stat labels, 1K breakdown labels) |
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
| Log | Current routine card border, the primary-action fill, A/B active segment, dots and glyphs. Its **copy** — current note title, subheadings, mode toggle, switch/create buttons — moved to `accentText` / `chipAccentText` in #918 |

Home has the highest orange density — 6 distinct elements. The wordmark is fixed (brand), but the remaining 5 compete for attention inside a single scroll view.

### SectionTitle Usage

| Screen | Between-card SectionTitles |
|---|---|
| Home | none — Home does not import `SectionTitle` |
| Analytics | "Weight Trends", "Fatigue", "Strength", "Progressive Overload" |
| Weight | "Goal", "Trends", "Goal History", "History" |
| Log | "Recovery", "More Routines" |

On Analytics/Weight, SectionTitles separate genuinely different content areas with many items each. Home relies on card content alone to communicate section purpose. `LogRecoverySection` and `LogPreviousRoutines` both render their heading through the shared `SectionTitle` component (`UI.js`), so `Recovery` and `More Routines` already match in size, weight, color, casing, and spacing (#771) — no separate token or override exists for either.

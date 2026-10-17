# Shared UI Implementation

For UI maintainers locating shared primitives, shell geometry, modal treatment, and history panels. [UI Design Rules](ui-design-rules.md) owns normative interaction/layout rules; [Theme Runtime](ui-theme-reference.md) owns palette compatibility.

## Shared Components

Source: `mobile/components/UI.js`

### Card

| Property | Value | Line |
|---|---|---|
| backgroundColor | `colors.card` | `158` |
| borderRadius | `16` (`GEOMETRY['radius-2xl']`) | `159` |
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
[derived-token table](ui-theme-reference.md#derived-semantic-tokens)).

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

### Shared Form Controls (#1440)

Source: `mobile/components/FormControls.js` (fields) and
`mobile/components/ui/controls.js` (inline actions), all exported from
`components/UI`. Standard controls compose these; feature styles only lay
them out ([UI Design Rules §17](ui-design-rules.md#17-standard-controls-use-shared-primitives)).

| Primitive | Contract |
|---|---|
| `TextField` | `FieldLabel` above a `TextInput`; the input's accessible name defaults to the label; `numeric` selects the decimal keypad; mode-matched keyboard and placeholder ink |
| `DateField` | `FieldLabel` above the date value. Web: DOM `<input type="date">` (`aria-label`). Native: `button`-role field opening the platform picker. `range` `past` / `future` bounds both paths to today; `onChangeDate` receives `YYYY-MM-DD`; optional `placeholder`, `formatValue`, controlled `pickerVisible` |
| `ActionChip` | compact card-header action, own 44×44dp box, tones `default` / `positive` / `danger`, label silenced under the named button |
| `TextAction` | unfilled secondary action (`Cancel`), own 44×44dp box |

Field skin (`createFormFieldStyles`): the `createInputStyle` palette roles,
`radius-2xl`, 14 padding, `minHeight` 48, full mono `label-lg` value role.
`createWebDateInputStyle` is the DOM equivalent for the web date input.
Primary and destructive actions stay on `Button` (default / `tone="danger"`),
ordinary surfaces on `Card`, and field labels on `FieldLabel`.

---

### InfoExplainer (`components/InfoExplainer.js`, #1245)

The one explainer pattern outside More: `InfoButton` (`info-outline`, glyph
`18`, `onSurfaceVariant`/`textMuted`, real `44x44`, `flexShrink: 0`, no auto or
negative margins, `accessibilityState.expanded`) anchored beside the label or
heading it explains, plus `InfoNote` (always mounted, polite live region) that
holds the explanation, hidden until tapped. `useInfoExplainer()` owns the
toggle. Used by Home `Exercise Progress` (only when a count needs explaining:
first tracked session or inherited history), 1K Progress, Progressive Overload's
`Exercise Progress` (beside the Progressing/Steady/Regressing trio) and
`Metrics` (beside the 1RM/Kilo/Best/Trend header) labels, progression-suggestion
cards (beside `HEURISTIC`), Log's `Counting in normal analytics` row, and
Recovery `Started`/`Dates`. Each explains only the thing beside it (#1356): no
multi-topic notes, and no inline explainer paragraphs on these surfaces.

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

The absolute `TabBar` keeps 16px horizontal insets and a 4px visual bottom
gap (`TAB_BAR_VISUAL_GAP` in `mobile/components/TabBarLayout.js`), then adds
the runtime bottom safe-area inset from `react-native-safe-area-context`. The
bar's own rendered height is never added to that offset. `TabBar` reports its
rendered height through `onLayout`; `mobile/App.js` owns that measurement in
state and provides it to every `ScreenShell` via `TabBarLayoutContext`, which
adds it to the shared 4px gap and the bottom inset for scroll clearance.
`SafeAreaProvider` is owned by `mobile/App.js`; `ScreenShell` consumes only
the bottom inset so existing top spacing is unchanged.

The compact `TabBar` auto-hides on user-driven scroll (`useTabBarAutoHide` and
`nextTabBarScrollState` in `mobile/components/TabBarLayout.js`): a downward
drag past `TAB_BAR_SCROLL_THRESHOLD` (8dp) slides it off with a translateY
only, never a fade, and it stays opaque whenever shown. It is shown again on
scroll up, on tab change, and at both scroll boundaries (#1231). The top
boundary is `y <= 0`. The bottom boundary is `y` within the fixed
`TAB_BAR_BOTTOM_EPSILON` (1dp, logical points, deliberately not scaled by
viewport or content height) of `maxY = max(0, contentHeight - layoutHeight)`,
including any iOS rubber-band offset beyond it. Content that cannot scroll
(`maxY <= 0`) always shows the bar, and `maxY` is recomputed from every scroll
event so a window/orientation change re-evaluates the boundary. Reaching the
bottom resets the scroll baseline to exactly `maxY`; that is the hysteresis:
bounce and settle events at the end can neither hide nor flicker the bar, and
it can hide again only after the user moves off the bottom and drags down
more than 8dp from that new baseline. Programmatic scrolls (`userDriven` false,
for example `scrollToEnd`) re-baseline and reveal at either boundary but never
hide. A hidden bar keeps `pointerEvents="none"` and no-hide-descendants
accessibility semantics, and scroll clearance above is unchanged by hidden
state.

---

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
| Field fill | `colors.inputBackground` (via `createInputStyle(colors)`) |
| Option row | `borderRadius: 12`, section `padding: 20` |

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
| Panel card | bg / radius / border | `colors.card` / `16` / 1px `cardBorder`, `overflow: hidden` |
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

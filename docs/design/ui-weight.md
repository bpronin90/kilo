# Weight UI Contract

For maintainers changing weight entry, goal, and history controls. Shared panels
are owned by [Shared UI](ui-shared-components.md).

## Weight Screen

Sources: `mobile/screens/WeightScreen.js`, `mobile/components/UI.js`,
`mobile/components/WeightTrendSection.js`, and
`mobile/components/WeightGoalCard.js`.

### Input Card

The weigh-in and Goal forms carry no Weight-specific control skin (#1440).
Every field is the shared `TextField` / `DateField` and every inline action the
shared `ActionChip` / `TextAction`, documented in
[Shared Form Controls](ui-shared-components.md#shared-form-controls-1440).
Weight styles only position these controls and mark the editing state
(`weightStyles.js` `editingCard`: 2px `primary` / `accent` border).

| Field | Control | Notes |
|---|---|---|
| `Weight (lb|kg)`, Goal `Current weight`, `Target` | `TextField numeric` | decimal keypad, unit in the label |
| `Date` (weigh-in / edit) | `DateField` (range `past`) | value shown as `YYYY-MM-DD`; name `Weigh-in date` / `Entry date` |
| Goal `Target Date` | `DateField` (range `future`) | `formatDate` value, `Select date` placeholder; name `Goal target date` |
| `Note` | `TextField` | `Morning, fasted` example placeholder |
| Save / Update / Save goal | `Button` | default tone |

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
| Editing-header `Cancel`, note/date `Done` (×4) | minHeight / minWidth | `44` / `44` (`justifyContent` + `alignItems` `center`) | header `Cancel` is the shared `TextAction`; the `Done`s keep `WeightScreen.js` targets |
| | accessibilityRole / Label | `button` / `"Cancel"` (header), `"Done …"` (each disclosure) | header `Cancel` gained both in #919 |
| Goal `Edit` / `Archive` / `Clear` chip (5 sites) | minHeight / minWidth | `44` / `44` (`center` / `center`) | shared `ActionChip` (`Archive` tone `positive`, `Clear` tone `danger`) |
| | accessibilityRole / Label | `button` / visible label | added in #919 |
| Goal-editor `Cancel` | minHeight / minWidth | `44` / `44` (`center` / `center`) | shared `TextAction` |
| | accessibilityRole / Label | `button` / `"Cancel"` | added in #919 |
| Every one of the above | label `Text` | `accessible={false} importantForAccessibility="no"` | §15: the named parent announces once, not twice with its child |

Guarded by the `Weight entry controls` and `Weight goal editor actions` blocks
in `mobile/tests/interaction-target-a11y.test.js`, which assert the flattened
target plus the parent role/name **and** `accessible === false` on the label.

### History List / Goal History

Both now use the [Shared History-Panel System](ui-shared-components.md#shared-history-panel-system) —
`WeightHistoryList.js` for Weight History, `hp` StyleSheet in `WeightScreen.js`
for Goal History. Values (radius 16, `subtleBg` header, 3-column grid, value 20,
date 15, collapse chevron, summary count/latest) are documented there. The old
stacked row layout (weight 17 / date 12 / stacked note) was replaced during
#411/#412.

Weight History extras: date-range filter, collapse, empty-range message ("No
entries in this range."), and a delete `✕` affordance in the trailing control
cell. Goal History extras: End Weight outcome coloring, Target Date column.

---

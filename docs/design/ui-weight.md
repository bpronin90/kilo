# Weight UI Contract

For maintainers changing weight entry, goal, and history controls. Shared panels
are owned by [Shared UI](ui-shared-components.md).

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

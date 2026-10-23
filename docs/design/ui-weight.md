# Weight UI Contract

For maintainers changing weight entry, goal, and history controls. Shared panels
are owned by [Shared UI](ui-shared-components.md).

## Weight Screen

Sources: `mobile/screens/WeightScreen.js`, `mobile/screens/weight/`
(`WeightEntryForm`, `WeightLatestPanel`, `WeightScreenPanels`,
`GoalHistoryPanel`, `weightStyles`), `mobile/components/WeightGoalCard.js`, and
`mobile/components/WeightHistoryList.js`. Approved reference: Redesign v3
([spec](app-redesign-v3/README.md), section "Weight";
`app-redesign-v3/shots/hybrid-v3/weight-*.png`), implemented in #1601.

### Layout (#1601)

`RootHeader` "Weight" with a context line (`43 weigh-ins · Cutting → 183 lb`),
shown only once the weigh-in read is verified. Below it, one 16px-gap stack of
`Panel`s, top to bottom:

1. **Log weigh-in** (the one `active` panel).
2. **Latest**: date, hero, change, 7/30-day averages, Analytics link.
3. **Goal**: active goal, compact no-goal, or the inline goal form.
4. **History**: count header, filter, column table, Show more.
5. **Goal history** disclosure (only when archived goals exist).

Read failures show one banner per failed source above the stack, each with its
own `Retry` (#737); the first read paints `weight-skeleton`. There is **no trend
chart or trend table on Weight**: `WeightTrendSection` is not rendered here; the
full trend lives in Analytics › Bodyweight.

### Input Card

The Log weigh-in panel.

| Element | Value |
|---|---|
| Header | `MonoLabel` "Log weigh-in"; editing: "Editing entry" (`primary`) + `TextAction` `Cancel` |
| Weight input | 52dp outlined box, 22px mono, unit suffix; placeholder `185.0` / `84.0`; name `Weight (lb|kg)` |
| Date button | 52dp, reads "Today" or `MM-DD-YYYY`; native opens the picker, web overlays `<input type="date">`; max today; name `Weigh-in date` / `Entry date` |
| Save | 48dp `primary` fill, visible "Save" / "Update", name `Save weigh-in` / `Update entry`; disabled while saving |
| Note | always-visible borderless "Add note" input (name `Note`, min 44dp) |

### Latest

| Element | Value |
|---|---|
| Label | `LATEST · MM-DD-YYYY` (newest entry date) |
| Hero | `currentWeight`, 44px mono + unit |
| Change | `recentDateWeight` vs `priorDateWeight` (#947), arrow + signed value + "vs previous"; one weigh-in day: "Weigh in on two different days to see this trend." |
| Averages | right column behind a hairline: `7-DAY AVG` / `30-DAY AVG`, 17px mono + change vs the prior window |
| Tone | production's goal-aware `weightTrendTone` (#1242): toward a loss/gain goal `success`, away `errorText`, pace anomalies keep severity, no goal keeps a directional cue, stable neutral |
| Link | 48dp `HairlineRow` "Full trend in Analytics" → `onNavigate('Analytics', 'weight')` |

### Trends Card

Removed from Weight in #1601: the Latest panel above carries the newest
weigh-in and rolling averages, and the full trend lives in Analytics ›
Bodyweight.

### Goal Display

Goal card states (#1443, #1601).

| State | Presentation |
|---|---|
| No goal | compact panel: "No goal set." + `Set a goal`, which opens the existing form; no progress, pace or deficit |
| Active goal | `GOAL · <mode>` (Cutting / Bulking / Maintaining); "N lb to go · N weeks left"; progress bar **only when `start_weight` is stored** (never inferred); Target / Target date and Target pace / Suggested split rows; `Edit` + `Clear` |
| On Track | header status when the weight threshold is met before `target_date` (#549) |
| Met | `Goal Met!`, `success` border; `Edit` + `Archive` |
| Ended (overdue) | `Goal ended`; no pace/deficit; `Edit` + `Archive` + `Clear` |
| Create / edit | header "Set a goal" / "Goal" + `Cancel`; shared `TextField` / `DateField` (`Goal target date`, range `future`), derived preview, `Save goal`; Cancel discards the draft |
| Save failure | draft stays open with `Could not save your goal. Try again.`; no success state |
| Read failure | page-level `Could not load your weight goal.` banner; never shown as no goal |

Goal math and lifecycle are unchanged (`deriveWeightGoalAnalytics`,
`useWeightGoalForm`).

### History List / Goal History

Both tables share one grid: a flexible first column, fixed `76` / `104` columns
(right-aligned) and a `44` control slot (`HISTORY_COLUMNS`, duplicated in
`weightStyles.js` and `weightHistoryStyles.js`; keep them identical). Column
labels are uppercase `label-md` on the `surfaceCardHeader` band; values are 15px
bold mono, dates 15px medium mono, muted.

- **History**: `HISTORY · N` header with the filter (`Filter by date range`) and
  expand (`Expand history` / `Collapse history`) icon buttons. Collapsed it
  previews the newest 6 rows; expanded it windows 50 at a time. Rows show
  `<value> <unit>`, the production severity-colored change, the full date, and a
  44dp delete control; tapping a row edits it. "Show more weight entries" sits
  under the rows.
- **Goal history**: one disclosure row "Goal history · N" with "Latest:
  Success / Missed" (bold, outcome colored); open, it shows Target / End Weight
  / Target Date with End Weight in `success` / `errorText` by `isGoalMet`.

### Editor Actions (#919)

The Weight tab's text-only editor actions each own a **44×44dp target from
their own box**, never a `hitSlop` — `ui-design-rules.md` §15 (React Native
clips a slop at a one-line row's bounds).

| Control | Property | Value | Source |
|---|---|---|---|
| Editing-header `Cancel` | minHeight / minWidth | `44` / `44` (`justifyContent` + `alignItems` `center`) | shared `TextAction` |
| | accessibilityRole / Label | `button` / `"Cancel"` | added in #919 |
| Goal `Edit` / `Archive` / `Clear` / `Set a goal` | minHeight / minWidth | `44` / `44` (`center` / `center`), static style, no `hitSlop` | `WeightGoalCard.js` `GoalAction` (outlined; `Clear` in `errorText`) since #1601 |
| | accessibilityRole / Label | `button` / visible label | added in #919 |
| Goal-editor `Cancel` | minHeight / minWidth | `44` / `44` (`center` / `center`) | shared `TextAction` |
| | accessibilityRole / Label | `button` / `"Cancel"` | added in #919 |
| Every one of the above | label `Text` | `accessible={false} importantForAccessibility="no"` | §15: the named parent announces once, not twice with its child |

Guarded by the `Weight entry controls` and `Weight goal editor actions` blocks
in `mobile/tests/interaction-target-a11y.test.js`, which assert the flattened
target plus the parent role/name **and** `accessible === false` on the label.

---

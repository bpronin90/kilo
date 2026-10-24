# Analytics UI Contract

For maintainers changing evidence ordering, strength, weight, and progression displays. Recovery evidence has its own [UI contract](ui-recovery.md).

## Analytics Screen

Source: `mobile/screens/AnalyticsScreen.js`

Analytics is the evidence surface; Home owns the summary, so there is no
Overview card. The legacy `overview` navigation id still means scroll offset 0.
Redesign v3 (#1602) groups the one continuous scroll into numbered chapters.
Ordering lives in `screens/analytics/AnalyticsLayout.js`
(`orderAnalyticsSections`, pure); `AnalyticsSectionContent.js` builds the
section elements and `AnalyticsChapters.js` draws the index, chapter headers and
Recovery chapter entries:

- **Normal training:** 01 Progress (Strength → Progressive Overload) →
  02 Training (Training breakdown → Routine Health) → 03 Bodyweight (the
  Bodyweight panel) → 04 Recovery (the Recovery section when it has something to render,
  then the Recovery history entry).
- **Active Recovery:** 01 Recovery `ACTIVE` (Recovery section → `Manage
  recovery in Log` → Recovery history entry) → 02 Bodyweight → 03 Baseline
  training `PAUSED`: a dashed `Progress and Training · paused during Recovery`
  toggle (collapsed by default, #871) that opens Strength → Progressive
  Overload → Training breakdown → Routine Health behind a dashed left rule.
  Ending Recovery restores the normal order.

The root header reads `Analytics` over the current routine title and
`Week N` (omitted during Recovery, whose week note names its own week). Below it
sits the fixed chapter index (`PROGRESS / TRAINING / BODYWEIGHT / RECOVERY`, or
`RECOVERY / BODYWEIGHT / PAUSED`): equal-width items that always fit, the current
one underlined with `selected`/`aria-current`. A tap scrolls to the chapter
header (no animation under reduce motion); a scroll-spy keeps the index on the
chapter whose header has reached the top, and on the last chapter at the end of
the scroll. Chapter headers are a mono number, a 22px title, a hairline and an
optional state tag; there is no intro copy.

Deep-link section ids are unchanged (`overview`, `strength`,
`progressive-overload`, `weight`, `recovery`) plus `bodyweight`, an alias that
lands on the `weight` anchor. Targets inside the paused baseline open it first
and resolve their offset through the paused body (useAnalyticsChapterNavigation).
The `recovery` anchor always exists, because the history entry always renders.
The Recovery history entry opens Log's Recovery view (`recovery-note` intent);
its count is the verified snapshot's completed blocks only, otherwise it names
the destination without a number.

Strength owns the 1K/Big 3 evidence; Big 3 Mapping sits in the 1K panel,
collapsed by default with a one-line summary of the mapped lifts. Progressive
Overload (`AnalyticsProgressiveOverload.js`) is its own top-level section: the
canonical Exercise Progress counts (`analytics.exerciseProgress`) as status
chips, progression suggestions, search/collapse controls and the table;
tracked-span/inherited and column methodology sits behind its `ⓘ`. Routine Health
(`AnalyticsRoutineHealthPanel.js`) is one panel: `SessionGauge` uncontained
(`contained={false}`) over `deriveRoutineStatus()`, a `Deload mode · On` row when
deload mode is on outside Recovery, and the uncontained Session Check-ins block
(with a strip of the last ten check-ins) when fatigue tracking is on.

Under the production KUA gate, `SessionGauge` resolves labels/zone captions
(`onSurfaceVariant`), counts (`onSurface`), marker fill (`surfaceCard`) and
status marks through the court palette's semantic tokens (`success`, `warning`,
`errorText`), matching the sibling cards; outside the gate it keeps the legacy
palette. Calculations, zone thresholds, deload gating and paused Recovery copy
are unchanged. Visual checks on device are not recorded; light/dark token
resolution is covered by `tests/session-gauge.test.js`.

### Bodyweight Panel (Redesign v3, #1603)

Sources: `components/AnalyticsWeightTrendsCard.js` (state, styles),
`components/analyticsWeight/BodyweightPanel.js`, `BodyweightStats.js`,
`components/LineChart.js` (opt-in `weightPlot`) and `components/lineChart/*`.
One flat `Panel` under the `03 Bodyweight` chapter header (no second "Weight
Trends" title), in normal and active Recovery chapters alike.

| Element | Value |
|---|---|
| Header, left | Fixed `LATEST WEIGH-IN` mono label; value `36`/`40` mono (`metric-display`) plus unit. Never replaced by a selected point |
| Header, right | `7D AVG` / `30D AVG` radio group, options `>=44dp`; swaps only the rolling line (and the callout average), never the weigh-ins or the date range |
| Meta row | Measurement date, arrow and signed change vs the previous weigh-in (Weight tab's recent/prior local-date pair, goal-aware tone), then the existing spike/notable pace badge |
| Chart | Height `150`. Every usable weigh-in is a dot at its recorded date (x is time, not index); the rolling line is the existing `rolling7` / `rolling30` derivation over the whole history; `chartSeries1` stroke; hollow ring on the latest recorded weigh-in, kept while another point is selected; date axis (4 `MM-DD` ticks) |
| Selection | Touch, arrow keys, rotor actions and Escape as before; held by entry `id`, so it follows its entry and clears when it is removed, the dataset shrinks below a chart or the window changes. Callout: value, recorded date, N-day average, note (polite live region) |
| Goal line | Dashed, labelled `GOAL <target>`, only for a verified active goal (read without error, derivable, not past its target date); otherwise no goal line, mode, target, to-go or pace |
| Caption | `N weigh-ins at recorded dates · Line: <window> · Ring: latest weigh-in` |
| Split cells | `7-DAY AVG` / `30-DAY AVG` with signed goal-aware change; with an active goal also `GOAL · CUTTING/BULKING/MAINTAINING` (target, to-go) and `TARGET PACE` |
| Handoff | `Log or manage weight` opens Weight |
| Empty / loading | Fewer than two weigh-in dates: the existing insufficient-data copy and `Log a weigh-in` action; loading shows one spinner; read failure keeps the screen's retry banner |

The Home sparkline and the 1K session chart do not pass `weightPlot` and render
as before. `rolling7` / `rolling30` are computed in `AnalyticsScreen` with the
existing `computeWeightRollingAverageSeries` over every weigh-in date.

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

### Strength Section (Redesign v3, #1604)

Sources: `components/AnalyticsStrengthSection.js`, `components/OneKProgressSummary.js`
(opt-in `variant="panel"`; the default variant is unchanged) and
`screens/analytics/AnalyticsProgressPanels.js`. One flat `Panel` holds the 1K
summary, then the chart and the Big 3 mapping as hairline disclosure rows; no
panel inside the panel. Presentation only: every number is the existing 1K
derivation in display units.

| Element | Value |
|---|---|
| Heading | `1K PROGRESS` mono label (12px, tracked) with the shared `InfoButton` (`What is 1K Progress?`); copy in an `InfoNote`, hidden by default |
| Total | `36`/`40` mono total in the existing lerp colour, then `/ 1,000 lb` (the displayed, unit-aware target) and a right-aligned `N to go` (displayed target minus displayed total; `Reached` at or above it) |
| Bar | One 8dp track toward the target. The fill (`width = total / target`) is split into Squat / Bench / Deadlift segments (flex = each lift's value) in `chartSeries1-3`; no per-lift targets |
| Lift cells | Three ruled cells (`>=44dp`, `minWidth 88`, wrap rather than truncate): swatch + uppercase name over `value unit`; a lift with a value opens the plate-loading sheet |
| 1K total over sessions | `Disclosure` row, collapsed by default (exposes `expanded`); the unchanged `LineChart` (selection, routine/deload markers) opens below. Closing it clears a selected session, restoring the latest total |
| Big 3 Mapping | Disclosure row in the same panel with the mapped-lift summary; slots, picker and save behaviour unchanged. With no total yet, the setup card shows and the mapping sits in its own panel |

### Progressive Overload (Redesign v3, #1604; `AnalyticsProgressiveOverload.js`)

Sources: `OverloadFilterChips.js`, `OverloadRows.js`, `OverloadExerciseSheet.js`,
`AnalyticsStates.js` (list states) and `analyticsStyles.js`. One flat `Panel`
under the section title and `Collapse all`; sections inside it are ruled by
hairlines.

| Element | Value |
|---|---|
| Exercise Progress | `EXERCISE PROGRESS` mono label with its own `ⓘ`; a stacked status bar (text equivalent: the three counts) and `All` / `Progressing` / `Steady` / `Regressing` chips (`radiogroup`/`radio`, `>=44dp`, wrap). Counts are `analytics.exerciseProgress` verbatim (`All` = classified + newly tracked). In the establishing-baseline state the existing message replaces bar and chips |
| Filtering | A chip keeps rows whose displayed trend maps to its status (up / flat / down); first-session and baseline rows show only under `All`. It composes with search on the same day groups, so `Collapse all`, group counts and `Expand all` act on what is shown, and a filtered-away group keeps its collapse state. The chip is in memory, tied to the routine it was chosen on, and ignored while the chips are not on screen |
| Suggestions | The existing cards and muted rows, unchanged, as a section of the panel |
| Search, Metrics | Existing search box; `Metrics` label with its own `ⓘ` and explainer |
| Column header | `EXERCISE  1RM  KILO  BEST` (mono, uppercase); the three value columns are fixed `76` wide and right-aligned, shared with every row |
| Day group | Header `>=48dp`, `DAY · count`, exposes `expanded`; unchanged grouping and collapse state |
| Row | Pressable `>=60dp`: name (wraps) and trend pill (`PROGRESSING` / `STEADY` / `REGRESSING`, icon + word) over the first-session caption and the metric columns, then the cross-day comparison. Non-weighted rows keep `AVG` under the first column and `BEST` under the last |
| Detail sheet | Bottom sheet (`Modal`, `accessibilityViewIsModal`, close `44dp`, back/backdrop dismiss, focus returns to the row on web): name, day and logged-session count, the same 1RM / Kilo / Best values, trend pill, and the parsed sets of that exercise under that day (`session_entries`, newest first, `formatWorkoutSets`). `View in Log` opens `{ kind: 'note', noteId }` for the current routine, and is absent while Recovery is active or without a routine. No chart, no new metric, no broadened note scope |
| Selection | `{ noteId, row key }` in memory; re-resolved against the rows on screen, so a routine or dataset change that drops the row closes the sheet |

Grouping (`analyticsDerivations.js` `deriveGroupedSignals`): sections are merged
by a **normalized leading-day key** (`MONDAY — Push` and `MONDAY — Push / Chest`
→ one `MONDAY` group), with exercise dedup on merge, so a note with gym+home
weeks no longer shows a day twice (#383/#385).

---

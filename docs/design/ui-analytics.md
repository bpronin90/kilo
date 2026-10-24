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

Strength owns the 1K/Big 3 evidence; Big 3 Mapping sits under the 1K panel,
collapsed by default with a one-line summary of the mapped lifts. Progressive
Overload (`AnalyticsProgressiveOverload.js`) is its own top-level section: the
canonical Exercise Progress counts (`analytics.exerciseProgress`), progression
suggestions, search/collapse controls and the table; tracked-span/inherited and
column methodology sits behind its `ⓘ`. Routine Health
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

### Strength Section (`AnalyticsStrengthSection.js`)

| Element | Property | Value | Line |
|---|---|---|---|
| Section wrapper | gap | `16` (`strengthSection`) | `171-173` |
| 1K card | padding / bg | `24` / `panelBackground` (ArtisanalPanel) | `174-179` |
| 1K heading / total / bar / Big 3 values (#1458) | shared `OneKProgressSummary` | `headline-sm` heading, 36px total, 8px bar toward 1000 lb, value-over-name Big 3 columns; also rendered by Home | `components/OneKProgressSummary.js` |
| 1K graph, explainer, plate taps | Analytics-only layers | passed to the shared unit as `belowTitle`/`titleAccessory`/`lifts[].onPress`/children | `AnalyticsStrengthSection.js` |
| Big 3 Mapping card | header | collapsible `Pressable`, default collapsed with mapped-lift summary | `111-125` |
| Big 3 title | fontSize / weight | `12` / `700`, uppercase, `textMuted` | `297-303` |
| Big 3 / info collapse | icon | `MaterialIcons` `expand-more`/`expand-less`, `14-16`, `textMuted` | `119-124`, `79-84` |
| 1K explainer (#1245) | shared `InfoButton` | icon beside the `1K Progress` label (`What is 1K Progress?`); copy in an `InfoNote`, default hidden | `AnalyticsStrengthSection.js` |

### Progressive Overload Table (`AnalyticsProgressiveOverload.js`)

| Element | Property | Value | Line |
|---|---|---|---|
| Section | gap | `8` (`poSection`); not sticky — it no longer ends the tab | |
| Exercise Progress counts | three columns | `poSummaryCount` metric display over uppercase `label-sm` | |
| Column header row | paddingHorizontal / paddingBottom | `16` / `4` | `403-407` |
| Column label | fontSize / weight | `11` / `800`, uppercase, `letterSpacing: 0.5`, center | `408-416` |
| Group section | paddingBottom / border | `4` / 1px `divider` top (between groups) | `426+` |

Grouping (`analyticsDerivations.js` `deriveGroupedSignals`): sections are merged
by a **normalized leading-day key** (`MONDAY — Push` and `MONDAY — Push / Chest`
→ one `MONDAY` group), with exercise dedup on merge, so a note with gym+home
weeks no longer shows a day twice (#383/#385).

---

# R4 (#1603) evidence: Analytics Bodyweight chart and latest weigh-in panel

Rendered from the **real app** (Expo web export), not prototype HTML.

- **Rendered commit:** `229a48fbc20bebd3a01d1acb49f23eac99160e0c` (all 66 PNGs; the manifest records it per capture). Later commits
  on this branch are evidence/docs only, except the review-round touch hit-test change (distance now
  uses touch height too so same-date weigh-ins are each selectable). That change runs only on a tap,
  draws nothing and alters no layout, so every PNG here still applies.
- **Viewport:** 390x844 CSS px, DPR 2 (780x1688 px), UTC, fixed clock `2026-10-23T12:00:00Z`.
- **Themes:** every state in `HD` hard-dark and `CL` clay-light; the Analytics first screen
  and the Bodyweight chapter also in `GL` grass-light and `CD` clay-dark.
- **Theme check:** 66 captures, 0 theme mismatches (court canvas colour verified per shot).

## References

Approved hybrid-v3 (tracked copy, [`reference-index.md`](../../../design/app-redesign-v3/reference-index.md)):
[`analytics-bodyweight-hard-dark`](../../../design/app-redesign-v3/shots/hybrid-v3/analytics-bodyweight-hard-dark.png),
[`analytics-bodyweight-clay-light`](../../../design/app-redesign-v3/shots/hybrid-v3/analytics-bodyweight-clay-light.png),
[`analytics-bodyweight-point-hard-dark`](../../../design/app-redesign-v3/shots/hybrid-v3/analytics-bodyweight-point-hard-dark.png),
[`analytics-bodyweight-30d-hard-dark`](../../../design/app-redesign-v3/shots/hybrid-v3/analytics-bodyweight-30d-hard-dark.png),
[`analytics-active-recovery-bodyweight-hard-dark`](../../../design/app-redesign-v3/shots/hybrid-v3/analytics-active-recovery-bodyweight-hard-dark.png).
Original problem (before): the R3 render
[`chapter-bodyweight-hard-dark`](../r3/after/chapter-bodyweight-hard-dark.png): a "Weight Trends" title over a
card whose header became "Selected" on any point, a last-7-dates line, no goal line.

## Layout checklist (written before coding, from the references)

| Item | Target | Result |
|---|---|---|
| Panel | One flat panel under the `03 Bodyweight` chapter header, no "Weight Trends" title, no second card | pass |
| Header left | `LATEST WEIGH-IN` 12px mono label, value 36px mono (`metric-display`) + unit; fixed | pass |
| Header right | `7D AVG` / `30D AVG` radio group in a hairline frame, options >=44dp | pass |
| Meta row | Date, arrow + signed change vs previous weigh-in, goal-aware tone; pace badge kept here | pass |
| Chart | Full panel width, weigh-ins as small dots at their recorded date, 2px line, ring on latest, dashed `GOAL n` line, 4 date ticks, scale labels not truncated | pass (scale gutter widened for one-decimal mono labels) |
| Caption | `N weigh-ins at recorded dates · Line: <window> · Ring: latest weigh-in` | pass |
| Splits | 2x2 hairline grid: 7-DAY AVG / 30-DAY AVG, GOAL · mode / TARGET PACE; no goal -> first row only | pass |
| Handoff | `Log or manage weight` hairline row with chevron | pass |
| Unchanged | Chapter header, index, tab bar, other chapters, Home sparkline, 1K chart | pass (see compatibility) |

## Comparison against the references (pass/fail)

- **Pass:** structure, order, type scale, spacing, the ring, GOAL line and label, caption, splits
  and handoff match `analytics-bodyweight-*` in hard-dark and clay-light. The line uses the
  `chartSeries1` teal in both. Point selection shows the callout (value, date, N-day average, note)
  and keeps the latest ring and the Latest header (`point-selected-*`). 30D swaps only the line
  (`bodyweight-30d-*`: same dots, same date range).
- **Deliberate differences from the prototype:**
  1. The prototype's illustrative numbers are not production data; the harness fixture renders its own
     values (187.8 lb, 43 weigh-ins, Cutting to 183).
  2. The "Tap a point to select" hint row above the chart is kept: it is production's visible cue that
     the chart is operable (#906) and the prototype did not model it.
  3. The R3 `← Home` back button above the screen title belongs to the shell and is not part of this issue.
  4. The callout is a polite live region and an overlay on the plot, so it can cover part of the line
     while a point is selected; the point's text is also the chart's accessible value.
  5. The first-screen sticky index leaves the panel top at the index edge after the chapter tap
     (scrolled 40px further so the whole panel is in view).

## Reproduce

```sh
cd mobile && EXPO_PUBLIC_SUPABASE_URL=https://mockproj.supabase.co EXPO_PUBLIC_SUPABASE_ANON_KEY=local-anon-key \
  npx expo export --platform web --output-dir <dist>
cd .. && KILO_RENDERED_COMMIT=229a48fbc20bebd3a01d1acb49f23eac99160e0c \
  node docs/evidence/app-redesign-v3/r4/capture.cjs <dist> <dir containing playwright> [workDir]
```

The runner uses the shared harness unchanged (`../capture.cjs`, `../fixtures.cjs`). Fixture setup:
the shared `populated`, `no-goal`, `goal-no-start`, `goal-ended`, `goal-unreadable`, `weigh-in-empty`,
`weigh-in-one` and `recovery-active` scenarios, plus overlays in [`fixtures.cjs`](fixtures.cjs):
`metric` (kg display), `spike` / `notable` (latest weigh-in 2.6 / 1.8 lb above the previous day),
`zeroChange` (last 14 days all 188 lb), `bulking` / `maintain` (goal changed), `oneDate` (two
weigh-ins on one date) and `longHistory` (400 daily weigh-ins). Raw-Playwright steps in the runner
(shared harness has no equivalent): keyboard traversal of the chart (`ArrowLeft`), a storage read
fault (`Storage.prototype.getItem` for `kilo_weight_entries` rejects or never settles, no product
change), and the app's own `onNavigate` prop for the chapter jump while a read is pending. Deleting an
entry in `selection-removed-*` uses the Weight tab's own delete control.

## Coverage (state x theme)

`HD` hard-dark, `CL` clay-light, `GL` grass-light, `CD` clay-dark. Link is the hard-dark (or first) PNG.

| State | Scenario (+ overlay) | Themes | What it shows |
|---|---|---|---|
| [`first-analytics`](after/first-analytics-hard-dark.png) | populated | HD CL GL CD | Analytics first screen (Progress chapter), unchanged by this issue |
| [`bodyweight-first`](after/bodyweight-first-hard-dark.png) | populated | HD CL GL CD | Bodyweight chapter, normal training: Latest weigh-in, 7D AVG, ring, GOAL line, split cells |
| [`bodyweight`](after/bodyweight-hard-dark.png) | populated | HD CL | Normal training Bodyweight: fixed Latest, 7D AVG line over every weigh-in, latest ring, GOAL line, active cutting goal |
| [`bodyweight-30d`](after/bodyweight-30d-hard-dark.png) | populated | HD CL | 30D AVG selected: same weigh-ins and date range, 30-day line |
| [`point-selected`](after/point-selected-hard-dark.png) | populated | HD CL | Earlier weigh-in selected by keyboard: callout with value, date, 7-day average and note; Latest header and ring unchanged |
| [`point-selected-30d`](after/point-selected-30d-hard-dark.png) | populated | HD CL | Earlier weigh-in selected in the 30D view: callout reads the 30-day average |
| [`window-clears-selection`](after/window-clears-selection-hard-dark.png) | populated | HD CL | Selection made, then 30D chosen: selection cleared, callout gone, Latest unchanged |
| [`goal-no-start`](after/goal-no-start-hard-dark.png) | goal-no-start | HD CL | Active goal without a stored start weight: goal line, mode, target, to-go and pace still shown |
| [`goal-none`](after/goal-none-hard-dark.png) | no-goal | HD CL | No goal: no GOAL line, goal split or target pace |
| [`goal-ended`](after/goal-ended-hard-dark.png) | goal-ended | HD CL | Ended goal (target date passed): no goal decorations |
| [`goal-unreadable`](after/goal-unreadable-hard-dark.png) | goal-unreadable | HD CL | Goal record unreadable: unverified, no goal decorations |
| [`goal-bulking`](after/goal-bulking-hard-dark.png) | populated + bulking | HD CL | Bulking goal: falling weights are away from the goal (negative tone) |
| [`goal-maintain`](after/goal-maintain-hard-dark.png) | populated + maintain | HD CL | Maintain goal: Goal MAINTAINING, Target pace Maintain |
| [`change-zero`](after/change-zero-hard-dark.png) | populated + zeroChange | HD CL | Zero change over the last 14 days: neutral 0.0, no arrow |
| [`pace-spike`](after/pace-spike-hard-dark.png) | populated + spike | HD CL | Spike pace badge kept in the header |
| [`pace-notable`](after/pace-notable-hard-dark.png) | populated + notable | HD CL | Notable pace badge kept in the header |
| [`unit-kg`](after/unit-kg-hard-dark.png) | populated + metric | HD CL | Metric display: kg values, one decimal, GOAL in kg |
| [`unit-lb`](after/unit-lb-hard-dark.png) | populated | HD CL | Imperial display (default): lb values |
| [`long-history`](after/long-history-hard-dark.png) | populated + longHistory | HD CL | 400 daily weigh-ins: every one plotted at its date, one line |
| [`empty`](after/empty-hard-dark.png) | weigh-in-empty | HD CL | No weigh-ins: N/A Latest, insufficient-data copy with Log a weigh-in, no goal decorations |
| [`one-entry`](after/one-entry-hard-dark.png) | weigh-in-one | HD CL | One weigh-in: Latest header, no chart, insufficient-data copy |
| [`one-date`](after/one-date-hard-dark.png) | populated + oneDate | HD CL | Two weigh-ins on one date: one date is not a chart, insufficient-data copy |
| [`active-recovery`](after/active-recovery-hard-dark.png) | recovery-active | HD CL | Active Recovery: the same Bodyweight panel, no duplicate chart |
| [`log-or-manage`](after/log-or-manage-hard-dark.png) | populated | HD CL | Log or manage weight tapped: the Weight tab opens |
| [`selection-removed`](after/selection-removed-hard-dark.png) | populated | HD CL | Selected entry deleted on Weight: stale selection cleared (callout before: 1), latest ring kept |
| [`loading`](after/loading-hard-dark.png) | populated | HD CL | Entries read pending: spinner in place of the chart, Latest N/A |
| [`read-error`](after/read-error-hard-dark.png) | populated | HD CL | Entries read rejected: error banner with Retry above the chapters |
| [`read-error-bodyweight`](after/read-error-bodyweight-hard-dark.png) | populated | HD CL | Entries read rejected: Bodyweight shows N/A and the insufficient-data copy, no chart |
| [`read-error-retried`](after/read-error-retried-hard-dark.png) | populated | HD CL | Retry after the read recovers: banner gone, Bodyweight chart and Latest restored |
| [`compat-home-sparkline`](after/compat-home-sparkline-hard-dark.png) | populated | HD CL | Home weight sparkline (no weightPlot): unchanged |
| [`compat-1k-chart`](after/compat-1k-chart-hard-dark.png) | populated | HD CL | Progress chapter 1K session chart (no weightPlot): unchanged |

## Compatibility: charts that do not opt in

`compat-home-sparkline-*` and `compat-1k-chart-*` were also rendered from the pre-change `origin/main`
export (`eeeeabc1620e1dd3a9bcd9a831aeb332ff837d2e`) with the same fixture and steps. The PNGs are byte-identical to the
ones in `after/` (sha256 prefixes: sparkline HD `c6f29784bf3d`, CL `0446f2637a57`; 1K chart HD `98b7bd1f7d31`,
CL `91673300c558`): the Home sparkline and the 1K session chart are unchanged.

## Preserved capabilities and degradation

- Empty (`empty-*`), one weigh-in (`one-entry-*`), one date (`one-date-*`), loading (`loading-*`) and
  read failure with Retry (`read-error-*`, `read-error-bodyweight-*`, `read-error-retried-*`) keep their
  copy and actions; none draws a goal line, ring or goal split.
- No goal, an ended goal and an unreadable goal draw no goal line, mode, target, to-go or Target pace
  (`goal-none-*`, `goal-ended-*`, `goal-unreadable-*`); a goal without a stored start weight still does
  (`goal-no-start-*`), because the line, to-go and pace need only the current weight.
- Spike and notable pace badges stay in the header (`pace-spike-*`, `pace-notable-*`); units lb/kg
  (`unit-lb-*`, `unit-kg-*`); the same panel in active Recovery (`active-recovery-*`) with no duplicate
  chart; `Log or manage weight` opens Weight (`log-or-manage-*`).
- A selection is cleared when its entry is deleted (`selection-removed-*`) and when the window changes
  (`window-clears-selection-*`); the stale-selection guards are covered by `tests/redesign-bodyweight.test.js`.
- Not rendered here (covered by unit tests, no rendering difference): keyboard Escape and rotor actions,
  large-font-scale layout, and the dataset shrinking below two dates.

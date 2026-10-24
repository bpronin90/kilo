# R5 (#1604) evidence: Analytics Progress panels and exercise detail sheet

Rendered from the **real app** (Expo web export), not prototype HTML.

- **Rendered commit:** `cc666448d9e37fd8cf55bf27d76ba8c8c751daa7` (all 76 PNGs; the capture runner records it per shot).
  Later commits on this branch are evidence/docs only unless a review round says otherwise.
- **Viewport:** 390x844 CSS px, DPR 2 (780x1688 px), UTC, fixed clock `2026-10-23T12:00:00Z`.
- **Themes:** every state in `HD` hard-dark and `CL` clay-light; the Analytics first screen also in `GL` grass-light and `CD` clay-dark.
- **Theme check:** 76 captures, 0 theme mismatches (court canvas colour verified per shot).

## References

Approved hybrid-v2/hybrid (tracked copy, [`reference-index.md`](../../../design/app-redesign-v3/reference-index.md)):
[`state-analytics-progress-hard-dark`](../../../design/app-redesign-v3/shots/hybrid-v2/state-analytics-progress-hard-dark.png),
[`state-analytics-strength-plates-hard-dark`](../../../design/app-redesign-v3/shots/hybrid/state-analytics-strength-plates-hard-dark.png),
[`state-analytics-overload-hard-dark`](../../../design/app-redesign-v3/shots/hybrid/state-analytics-overload-hard-dark.png),
[`state-analytics-overload-rows-hard-dark`](../../../design/app-redesign-v3/shots/hybrid/state-analytics-overload-rows-hard-dark.png),
[`state-analytics-overload-sheet-hard-dark`](../../../design/app-redesign-v3/shots/hybrid/state-analytics-overload-sheet-hard-dark.png).
Original problem (before): the R4 render [`first-analytics-hard-dark`](../r4/after/first-analytics-hard-dark.png): a centred 1K card with the chart always open and a separate Big 3 card, a Progressive Overload section with counts as plain numbers, a free-floating table and per-row metric grids that did not align under the header.

## Layout checklist (written before coding, from the references)

| Item | Target | Result |
|---|---|---|
| 1K panel | One flat panel: `1K PROGRESS` mono label + info; `36px` total, `/ 1,000 lb`, right-aligned `N to go`; 8dp bar split by lift; three ruled cells with swatch, name, value + unit | pass |
| 1K disclosures | `1K total over sessions` and `Big 3 Mapping` as hairline rows inside the same panel, collapsed | pass |
| Overload header | Section title + `Collapse all`; panel with `EXERCISE PROGRESS` label + info, status bar, chips | pass (chips wrap to a second line instead of scrolling sideways) |
| Search | Full-width box in the panel, own hairline section | pass |
| Column header | `EXERCISE 1RM KILO BEST` mono, values below right-aligned to the same fixed columns | pass |
| Day group | `MONDAY · 3` strip with chevron, >=48dp | pass |
| Row | >=60dp (measured in the rendered DOM on every shot that shows rows: smallest row 70 CSS px), name + trend pill top, values below | pass |
| Sheet | Grabber, name, day + logged sessions, close, 1RM / Kilo / Best cells, sets table, `View in Log` | pass (see differences) |
| Unchanged | Root header, chapter index, tab bar, Training/Bodyweight/Recovery chapters, plate sheet, explainer copy | pass |

## Comparison against the references (pass/fail)

- **Pass:** structure, order, type scale and spacing of the 1K panel, status chips, column header, day groups, rows and sheet match
  the references in hard-dark and clay-light; court palettes resolve in all four themes (`first-progress-*`).
  Chip selection, search composition, collapse state, suggestion, explainers, cross-day comparison, empty, baseline, loading,
  error and paused states each have a capture below.
- **Deliberate differences from the prototype:**
  1. Prototype numbers are illustrative; the fixture renders its own (e.g. 899 / 1,000 lb with the Big 3 mapped to the routine's lifts).
  2. The sheet has **no top-set chart** and its table has no separate Load/Reps columns: production has no per-session series or
     per-row top-set derivation to draw, and the issue forbids new metrics. It lists the parsed set rows (`formatWorkoutSets`).
  3. The prototype's `10 sessions` row subtitle is not shown on rows (no existing per-row session count); the sheet reports the
     logged-session count from the parsed entries.
  4. A fixture-seeded suggestion renders two cards for the same exercise (`suggestion-*`); the suggestion list is the unchanged
     `analytics.progressionSuggestions` and this issue does not touch its derivation.
  5. **Mapping failure:** production has no error UI for a rejected mapping save; with the write rejected (`onek-mapping-failure-*`)
     the picker stays open and the mapped lift is unchanged. Preserved, not redesigned.
  6. Cross-day `THU N/A` in `overload-cross-day-*` is the unchanged `CrossDayComparison` output for the seeded Thursday sessions.

## Reproduce

```sh
cd mobile && EXPO_PUBLIC_SUPABASE_URL=https://mockproj.supabase.co EXPO_PUBLIC_SUPABASE_ANON_KEY=local-anon-key \
  npx expo export --platform web --output-dir <dist>
cd .. && KILO_RENDERED_COMMIT=cc666448d9e37fd8cf55bf27d76ba8c8c751daa7 \
  node docs/evidence/app-redesign-v3/r5/capture.cjs <dist> <dir containing playwright> [workDir]
```

The runner uses the shared harness unchanged (`../capture.cjs`). Overlays in [`fixtures.cjs`](fixtures.cjs) change only production
storage keys: `bigThree` (mapping), `crossDay`, `suggestion` / `muted`, `regressing`, `untracked`, `baseline`. Raw-Playwright steps
(shared harness has no equivalent): keyboard traversal of the chart, a storage read fault (`getItem` rejects or never settles) and
a storage write fault (`setItem` throws) for `kilo_workout_notes`, no product change.

## Coverage (state x theme)

`HD` hard-dark, `CL` clay-light, `GL` grass-light, `CD` clay-dark. Link is the hard-dark (or first) PNG.

| State | Scenario (+ overlay) | Themes | What it shows |
|---|---|---|---|
| [`first-progress`](after/first-progress-hard-dark.png) | populated + bigThree | HD CL GL CD | Analytics first screen: Strength 1K panel, Big 3 mapping and the start of Progressive Overload |
| [`first-progress-unmapped`](after/first-progress-unmapped-hard-dark.png) | populated | HD CL GL CD | Analytics first screen with the Big 3 not mapped to routine lifts: setup copy and the mapping disclosure |
| [`onek-summary`](after/onek-summary-hard-dark.png) | populated + bigThree | HD CL | 1K Progress panel: total / 1,000 lb, to go, per-lift stacked bar, Squat / Bench / Deadlift values, chart and mapping disclosures collapsed |
| [`onek-info`](after/onek-info-hard-dark.png) | populated + bigThree | HD CL | What is 1K Progress? info open under the heading |
| [`onek-chart-open`](after/onek-chart-open-hard-dark.png) | populated + bigThree | HD CL | 1K total over sessions disclosure open: the unchanged session chart |
| [`onek-chart-selected`](after/onek-chart-selected-hard-dark.png) | populated + bigThree | HD CL | Earlier session selected on the chart: headline total and the three lifts show that session; deload/routine markers unchanged |
| [`onek-plates`](after/onek-plates-hard-dark.png) | populated + bigThree | HD CL | Tapping a lift opens the existing plate-loading sheet |
| [`onek-mapping-open`](after/onek-mapping-open-hard-dark.png) | populated + bigThree | HD CL | Big 3 mapping disclosure open: Bench / Squat / Deadlift rows with current mapped lifts |
| [`onek-mapping-change`](after/onek-mapping-change-hard-dark.png) | populated + bigThree | HD CL | A slot opened: the picker lists the routine lifts, the mapped one selected |
| [`onek-mapping-changed`](after/onek-mapping-changed-hard-dark.png) | populated + bigThree | HD CL | Squat remapped to Back Squat then Deadlift remapped: saved selection reflected in the summary line and the 1K values |
| [`onek-mapping-failure`](after/onek-mapping-failure-hard-dark.png) | populated + bigThree | HD CL | Saving the mapping fails (note write rejected): the picker and the existing mapping stay as they were |
| [`overload-all`](after/overload-all-hard-dark.png) | populated + bigThree | HD CL | Progressive Overload: Exercise Progress with status bar and All / Progressing / Steady / Regressing chips, search, column header, per-day groups |
| [`overload-rows`](after/overload-rows-hard-dark.png) | populated + bigThree | HD CL | Rows: name + trend pill over right-aligned 1RM / Kilo / Best values under the header, >=60dp, non-weighted AVG / BEST kept |
| [`overload-filter-progressing`](after/overload-filter-progressing-hard-dark.png) | populated + bigThree | HD CL | Progressing chip selected: only Progressing rows; the counts stay canonical |
| [`overload-filter-steady`](after/overload-filter-steady-hard-dark.png) | populated + bigThree | HD CL | Steady chip selected: only Steady rows |
| [`overload-filter-regressing`](after/overload-filter-regressing-hard-dark.png) | populated + regressing | HD CL | Regressing chip selected (Leg Press loses load): only Regressing rows |
| [`overload-filter-regressing-none`](after/overload-filter-regressing-none-hard-dark.png) | populated + bigThree | HD CL | Regressing chip with no regressing exercise: "No exercises match this filter", chips stay so it can be cleared |
| [`overload-search`](after/overload-search-hard-dark.png) | populated + bigThree | HD CL | Search "press" composed with the Progressing chip |
| [`overload-no-match`](after/overload-no-match-hard-dark.png) | populated + bigThree | HD CL | Search with no match: No matches message, the search box stays to clear |
| [`overload-collapse-day`](after/overload-collapse-day-hard-dark.png) | populated + bigThree | HD CL | One day group collapsed on its own: header stays with its count, rows hidden |
| [`overload-collapse-all`](after/overload-collapse-all-hard-dark.png) | populated + bigThree | HD CL | Collapse all: every group collapsed, the control reads Expand all |
| [`overload-suggestion`](after/overload-suggestion-hard-dark.png) | populated + suggestion | HD CL | Progression suggestion inside the panel (Incline Dumbbell Press 3x8-10) with Open in Log / dismiss / mute |
| [`overload-muted`](after/overload-muted-hard-dark.png) | populated + muted | HD CL | Muted exercise keeps its muted row with Unmute |
| [`overload-explainer-progress`](after/overload-explainer-progress-hard-dark.png) | populated + bigThree | HD CL | Exercise Progress explainer open: only its own topic |
| [`overload-explainer-metrics`](after/overload-explainer-metrics-hard-dark.png) | populated + bigThree | HD CL | Metrics explainer open: only the 1RM / Kilo / Best / Trend topic |
| [`overload-cross-day`](after/overload-cross-day-hard-dark.png) | populated + crossDay | HD CL | Bench Press on two days: the cross-day comparison (and the Also on line) sit in its row |
| [`overload-sheet`](after/overload-sheet-hard-dark.png) | populated + bigThree | HD CL | Row tapped: detail sheet with 1RM / Kilo / Best, trend pill and the parsed logged sets, newest first |
| [`overload-sheet-nonweighted`](after/overload-sheet-nonweighted-hard-dark.png) | populated + bigThree | HD CL | Detail sheet for a non-weighted exercise (Pull Up): AVG / BEST and its parsed sets |
| [`overload-sheet-closed`](after/overload-sheet-closed-hard-dark.png) | populated + bigThree | HD CL | Sheet closed again: the list and the filter/scroll state are as they were |
| [`overload-empty`](after/overload-empty-hard-dark.png) | populated + untracked | HD CL | No tracked exercises: the existing empty state with Go to Log |
| [`overload-baseline`](after/overload-baseline-hard-dark.png) | populated + baseline | HD CL | Every tracked exercise on its first session: the establishing-baseline message replaces the counts, no chips |
| [`overload-loading`](after/overload-loading-hard-dark.png) | populated | HD CL | Notes read pending: spinner in place of the list, no counts, no chips |
| [`overload-error`](after/overload-error-hard-dark.png) | populated | HD CL | Notes read rejected: banner with Retry, no fabricated rows |
| [`overload-error-list`](after/overload-error-list-hard-dark.png) | populated | HD CL | Notes read rejected: Progressive Overload shows its empty state, not zero-filled data |
| [`paused-collapsed`](after/paused-collapsed-hard-dark.png) | recovery-active | HD CL | Active Recovery: baseline Progress collapsed under the Paused chapter |
| [`paused-progress`](after/paused-progress-hard-dark.png) | recovery-active | HD CL | Active Recovery with the baseline disclosure open: identical Progressive Overload content |

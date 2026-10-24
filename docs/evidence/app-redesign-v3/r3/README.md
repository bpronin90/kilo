# R3 (#1602) evidence: Analytics chapters and navigation

Rendered commit: `7622a318f8702ab55615a62f8657d4727072a5e2` (web export; all 90 PNGs re-captured from it in this round). The only later product change moves
construction of the identical `<AnalyticsRecoverySection … title={null} />` element (same props)
from `AnalyticsSectionContent.js` into `AnalyticsScreen.js` so the screen visibly wires
`oneKSelections` (#1351 source contract); the rendered tree is unchanged, so these captures still apply.
Viewport: 390x844 CSS px, DPR 2 (PHONE), UTC, fixed clock `2026-10-23T12:00:00Z`.
Themes: every state in `hard-dark` + `clay-light`; first screen also `grass-light` + `clay-dark`.

References (approved hybrid-v2): [`analytics-hard-dark`](../../../design/app-redesign-v3/shots/hybrid-v2/analytics-hard-dark.png),
[`analytics-clay-light`](../../../design/app-redesign-v3/shots/hybrid-v2/analytics-clay-light.png),
[`state-analytics-progress`](../../../design/app-redesign-v3/shots/hybrid-v2/state-analytics-progress-hard-dark.png),
[`state-analytics-training`](../../../design/app-redesign-v3/shots/hybrid-v2/state-analytics-training-hard-dark.png),
[`state-analytics-recovery`](../../../design/app-redesign-v3/shots/hybrid-v2/state-analytics-recovery-hard-dark.png),
[`state-analytics-active-recovery`](../../../design/app-redesign-v3/shots/hybrid-v2/state-analytics-active-recovery-hard-dark.png),
[`state-analytics-active-recovery-baseline-open`](../../../design/app-redesign-v3/shots/hybrid-v2/state-analytics-active-recovery-baseline-open-hard-dark.png),
[`state-analytics-overload-deeplink`](../../../design/app-redesign-v3/shots/hybrid-v2/state-analytics-overload-deeplink-hard-dark.png).

## Reproduce

```sh
cd mobile && EXPO_PUBLIC_SUPABASE_URL=https://mockproj.supabase.co EXPO_PUBLIC_SUPABASE_ANON_KEY=local-anon-key \
  npx expo export --platform web --output-dir <dist>
cd .. && node docs/evidence/app-redesign-v3/r3/capture.cjs <dist> <dir containing playwright> [workDir]
```

The runner uses the shared harness unchanged. Fixtures: shared `populated` and
`recovery-active` scenarios plus overlays in [`fixtures.cjs`](fixtures.cjs):
`routineHealthOn` (deload mode + Session Check-ins on, ten answered check-ins on the
current routine, two flagged), `completedRecovery` (one completed block in history),
`recoveryBetweenWeeks` (open block, its only week complete), `recoveryUnreadable`
(corrupt `kilo_recovery_blocks`). Each capture records the index item carrying
`aria-current`; the run reported 90 captures, 0 theme mismatches, and the shared
smoke (12 scenarios, hard-dark) 0 failed. `newBlockStorage` (completes the open block
and adds a fresh `Travel` block) drives the new-block reset.

Techniques for states with no tappable entry point (runner-only, no product change):

- **Deep links / section ids** are driven through the real navigation path: the runner
  finds the `AnalyticsScreen` props carrying `onNavigate` + `sectionNonce` in the React
  fiber tree and calls `onNavigate('Analytics', <id>)` — the same `handleTabPress`
  every in-app link uses. Needed because during Recovery Home offers no Strength /
  Exercise Progress link.
- **Refreshing / retrying** hold the Recovery storage reads: `Storage.getItem` for
  `kilo_recovery_blocks` / `kilo_recovery_block_weeks` returns a pending promise until
  released (manifest records `held_reads`).
- **Initial loading**: holds start from boot. In production the app startup overlay
  covers every tab until Home's load (which includes Recovery) settles, so
  `state-loading-overlay` is what the user sees; `state-loading` hides that overlay
  with a style tag to show the Analytics render underneath.

## Layout checklist and result

| # | Checklist item (from the references) | Result | After |
|---|---|---|---|
| 1 | Root header: `Analytics` display title over mono `routine · Week N`, hairline | Pass | [first hard-dark](after/first-analytics-hard-dark.png), [clay-light](after/first-analytics-clay-light.png), [grass-light](after/first-analytics-grass-light.png), [clay-dark](after/first-analytics-clay-dark.png) |
| 2 | Chapter index under the header: 4 equal-width mono uppercase items, never scrolls away, current item bright with 2px primary underline | Pass | same |
| 3 | Chapter header: mono number in primary, 22px title, hairline rule to the right, no intro copy | Pass | [training](after/chapter-training-hard-dark.png) |
| 4 | Index tap scrolls to the chapter header and marks it current | Pass (all 4, both themes) | [training](after/chapter-training-clay-light.png), [bodyweight](after/chapter-bodyweight-hard-dark.png), [recovery](after/chapter-recovery-hard-dark.png), [progress](after/chapter-progress-hard-dark.png) |
| 5 | Scroll-spy follows user scrolling; last chapter at the end | Pass | [mid-scroll, still PROGRESS](after/spy-midscroll-hard-dark.png), [crossed, TRAINING](after/spy-crossed-clay-light.png), [end, RECOVERY](after/spy-end-hard-dark.png) |
| 6 | Training chapter: Training breakdown (internals untouched) then Routine Health | Pass | [chapter-training](after/chapter-training-hard-dark.png) |
| 7 | Routine Health is ONE panel: gauge, `Deload mode · On` divider row, check-ins block with strip | Pass | [on hard-dark](after/routine-health-on-hard-dark.png), [on clay-light](after/routine-health-on-clay-light.png) |
| 8 | Deload + check-ins off: no deload row, no check-ins | Pass (production gauge shows Total only) | [off](after/routine-health-off-clay-light.png) |
| 9 | Recovery chapter: `Recovery history` row with count, opens Recovery management | Pass | [history](after/recovery-history-hard-dark.png) |
| 10 | Active Recovery index `RECOVERY / BODYWEIGHT / PAUSED`; 01 Recovery with `ACTIVE` tag first | Pass | [hard-dark](after/active-recovery-hard-dark.png), [clay-light](after/active-recovery-clay-light.png) |
| 11 | 03 Baseline training `PAUSED` tag, dashed toggle row, collapsed by default | Pass | [paused](after/active-recovery-paused-hard-dark.png) |
| 12 | Toggle open: `Hide paused Progress and Training`, paused sections behind a dashed left rule | Pass | [open hard-dark](after/active-recovery-baseline-open-hard-dark.png), [open clay-light](after/active-recovery-baseline-open-clay-light.png) |
| 13 | Between weeks / unreadable Recovery: state stated, no fabricated count | Pass | [between weeks](after/active-recovery-between-weeks-hard-dark.png), [unreadable](after/recovery-unreadable-hard-dark.png) |
| 14 | Deep links land: Weight `See full trends` → weight, Home `Exercise Progress` → progressive-overload, Home Recovery link → recovery | Pass | [weight](after/deeplink-weight-hard-dark.png), [overload](after/deeplink-overload-hard-dark.png), [recovery](after/deeplink-recovery-hard-dark.png) (+ clay-light) |
| 15 | Unchanged: tab bar, Strength / Weight / Progressive Overload / Recovery evidence internals | Pass | all |
| 16 | Deep link to `strength` / `progressive-overload` during Recovery auto-expands the collapsed baseline and lands on the section; index marks PAUSED | Pass | [strength hard-dark](after/deeplink-strength-auto-expand-hard-dark.png), [overload hard-dark](after/deeplink-progressive-overload-auto-expand-hard-dark.png), [strength clay-light](after/deeplink-strength-auto-expand-clay-light.png), [overload clay-light](after/deeplink-progressive-overload-auto-expand-clay-light.png) |
| 17 | Old section ids land on their chapter: `weight`, repeated `weight` (from top), `bodyweight` alias, `strength`, `recovery`, `overview` | Pass (both themes) | [weight](after/ids-weight-hard-dark.png), [repeat](after/ids-weight-repeat-clay-light.png), [alias](after/ids-bodyweight-alias-clay-light.png), [strength](after/ids-strength-clay-light.png), [recovery](after/ids-recovery-hard-dark.png), [overview](after/ids-overview-clay-light.png) |
| 18 | Check-ins enabled: details expand inside the panel; edit opens the Session check-in sheet with saved answer | Pass | [expanded](after/checkins-expanded-clay-light.png), [edit](after/checkins-edit-clay-light.png) (+ hard-dark) |
| 19 | New Recovery block resets the baseline disclosure to collapsed | Pass | [open before](after/newblock-before-open-clay-light.png), [after new block](after/newblock-reset-clay-light.png), [new block card](after/newblock-recovery-clay-light.png) (+ hard-dark) |
| 20 | Stale: banner + `Retry recovery`; retry in flight shows the verified evidence without the banner; success keeps it cleared | Pass | [stale](after/state-stale-clay-light.png), [retrying](after/state-stale-retrying-hard-dark.png), [retried](after/state-stale-retried-hard-dark.png) (+ other theme) |
| 21 | Refreshing over verified data: unchanged render (no flash) | Pass (production design) | [refreshing](after/state-refreshing-hard-dark.png) |
| 22 | Error: unknown-status banner + retry; retry in flight keeps the error message until a read succeeds; success shows real state | Pass | [error](after/state-error-hard-dark.png), [retrying](after/state-error-retrying-clay-light.png), [retried](after/state-error-retried-clay-light.png) (+ other theme) |
| 23 | Initial loading: `Loading recovery data…`, history row without a count; settles to the real state | Pass | [overlay](after/state-loading-overlay-hard-dark.png), [loading](after/state-loading-clay-light.png), [done](after/state-loading-done-clay-light.png) (+ other theme) |
| 24 | Missing data: empty account (no Strength/PO data, no header context), no weigh-ins | Pass | [empty](after/missing-empty-clay-light.png), [no weigh-ins](after/missing-weighins-clay-light.png) (+ hard-dark) |

## Deviations (with reasons)

- **Section internals are production, not the reference restyle.** 1K/Strength,
  Progressive Overload and Weight Trends keep their own titles and cards; their
  redesign is R4/R5 scope. Training breakdown internals are untouched by contract.
- **Deep links land on the section anchor, below the chapter header** (the #770
  section semantics are kept), so e.g. the overload deep link shows `Progressive
  Overload` at the top rather than the reference's exercise sheet (R5 scope).
- **Header context during Recovery** shows the Recovery week note's title without
  a second `Week N`; the reference shows the baseline routine. The current note is
  the Recovery week, and doubling the week read `Recovery — Week 1 · Week 2`.
- **Active Recovery card**: no 2px primary border, no `Week N · vs baseline`
  sub-heading and `Manage recovery in Log` sits in its own panel below the card
  rather than inside it — the card is `RecoveryEvidence.js`, outside Allowed Files.
- **Routine Health total** stays in the gauge header (no split row); with deload
  off the gauge shows Total only, as production does.
- **Refreshing over verified data** renders unchanged and **retry from error** keeps the
  error message until a read succeeds — both production `recoveryReadState` behaviour
  (Recovery data, outside Allowed Files), shown as rendered.
- The `← Home` web back bar above the header is R1's existing shell.
- The dashed single-side rule of the paused body may render solid on native iOS;
  verified on web only.

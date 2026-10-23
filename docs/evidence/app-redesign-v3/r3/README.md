# R3 (#1602) evidence: Analytics chapters and navigation

Rendered commit: `7622a318f8702ab55615a62f8657d4727072a5e2` (product code is identical at the PR head; later commits add this README only).
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
`aria-current`; the run reported 40 captures, 0 theme mismatches, and the shared
smoke (12 scenarios, hard-dark) 0 failed.

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
- **Auto-expand deep link** (a link into Strength/Progressive Overload while
  Recovery is active) is not captured: no Home surface offers one during Recovery
  (the hero drops Exercise Progress and the 1K card). It is covered by
  `tests/analytics-chapter-navigation.test.js` (expand + nested offset).
- The `← Home` web back bar above the header is R1's existing shell.
- The dashed single-side rule of the paused body may render solid on native iOS;
  verified on web only.

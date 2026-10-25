# R1 (#1600) evidence: docked tab bar and shell foundation

> **Historical images:** completed captures have been removed from the current tree.
> [Browse the preserved image snapshot](https://github.com/bpronin90/kilo/tree/f7cf024e488471136e11e76834570093b140eaec/docs/evidence/app-redesign-v3/r1/) at
> `f7cf024e488471136e11e76834570093b140eaec`; image filenames, counts and sizes below describe that snapshot.
> Capture scripts, fixtures and the verification record remain here.

Real-app renders for the redesign v3 foundation (tracker #1609).

- **Rendered commit:** `88ed6fa5985cb71c2cd92e4e8e1ec21a9a31bb50`. It is the
  only commit on the branch that changes `mobile/`. Later commits touch only
  `docs/`, so they cannot change these renders.
- **Viewport:** 390×844 CSS px at DPR 2 (PNGs are 780×1688), except the wide
  and safe-area items noted below.
- **Clock and data:** `FIXED_NOW` 2026-10-23T12:00Z, `populated` fixture unless
  noted. See the [harness README](../README.md).
- **Size:** 54 PNGs (40 captures, 12 smoke shots and 2 review-repro shots), 5,376,394 bytes.

## Reference and original problem

- **Reference:** the "Global shell" section of the
  [redesign spec](../../../design/app-redesign-v3/README.md#global-shell-all-tabs).
  The docked bar is drawn in every curated shot, for example
  [`weight-hard-dark`](../../../design/app-redesign-v3/shots/hybrid-v3/weight-hard-dark.png),
  [`home-clay-light`](../../../design/app-redesign-v3/shots/hybrid/home-clay-light.png),
  [`log-hard-dark`](../../../design/app-redesign-v3/shots/hybrid/log-hard-dark.png)
  and [`state-home-timer-running-hard-dark`](../../../design/app-redesign-v3/shots/hybrid/state-home-timer-running-hard-dark.png).
- **Before:** production 1.21.2 has a floating, rounded, bordered tab bar 4dp
  above the inset and 16dp in from each side. The active tab is a filled pill
  rather than an indicator, and labels are mixed case. The
  before renders are local only
  (`.visual-evidence/app-wide-redesign-exploration/baseline/shots/`, per the
  [reference index](../../../design/app-redesign-v3/reference-index.md#production-baselines)).

## Layout checklist (from the reference)

1. Docked: no gap under the bar, no radius, no shadow. The background band and
   1px top hairline span the full window and fill the bottom inset.
2. Five tabs, each with a 24dp icon over an 11px uppercase mono label. Tab
   height is at least 60dp.
3. The active tab has a primary-tinted icon and label plus a 2dp indicator on
   its top edge. Inactive tabs are muted.
4. #1209 behaviour is unchanged: hidden on a user down-scroll (translate only,
   untouchable), revealed on up-scroll, at the bottom and on tab change.
5. Content and the rest timer clear the bar (measured height + 4 + inset).
6. Wide window: the tabs share the centred content column, and the band spans
   the window.
7. Unchanged: screen content, the Back bars and the tab order.

## Commands

```sh
# from mobile/ at the rendered commit
EXPO_PUBLIC_SUPABASE_URL=https://mockproj.supabase.co EXPO_PUBLIC_SUPABASE_ANON_KEY=local-anon-key \
  npx expo export --platform web --output-dir <scratch>/dist
# from the repo root
node docs/evidence/app-redesign-v3/r1/capture.cjs <scratch>/dist <dir-with-playwright>/node_modules <scratch>/r1-work
```

The run writes PNGs only to `after/`, including `smoke-*.png` (all 12 scenarios
in `hard-dark` at their marker tab). `manifest.json` (with `verifyTheme()` and
`tabBar()` per shot) and `smoke-manifest.json` go to the optional third
argument, a work directory outside the repo. The tables below quote them. The
result was 40 captures with
0 theme mismatches, and 14 smoke captures (12 marker shots plus the review
repro) with 0 failures.

**Fixture setup:** `populated`, `timer-running` and `empty` come from the shared
fixtures. [`fixtures.cjs`](fixtures.cjs) adds one overlay, `timerOnEmpty`,
which puts a running rest timer on the empty account.

## Results

All PNGs below were opened and compared against the reference and the checklist.

| Item | Captures (`after/`) | Result |
|---|---|---|
| Five first screens × 4 themes | `first-{home,log,weight,analytics,more}-{hard-dark,clay-light,grass-light,clay-dark}.png` (20) | **Pass.** Docked band with hairline and uppercase mono labels, indicator over the active tab, court tint per theme. Bar box top 783, bottom 844, height 61, visible |
| Dock at top | the 20 first screens | **Pass.** Shown at scroll top on every tab |
| Down-scroll hides | `bar-hidden-downscroll-log-{hard-dark,clay-light}.png` | **Pass.** The bar is fully off screen (top 846 > 844, including the indicator) and `visible: false` (pointer-events none). No sliver of the band remains |
| Up-scroll reveals | `bar-reveal-upscroll-log-*.png` | **Pass** |
| Bottom reveals | `bar-reveal-bottom-log-*.png` | **Pass.** Shown at the end, and the last card ("Strength 5×5") sits clear above the hairline |
| Tab switch | `bar-tab-switch-analytics-*.png` | **Pass.** Analytics opens at the top with the bar shown and the indicator on Analytics |
| Root vs sub-screen Back | `back-root-more-*.png`, `back-subscreen-settings-*.png` | **Pass.** Unchanged: the root shows the existing web "← Home" bar, and More › Settings shows "← Back". The bar stays docked on both |
| Timer clearance | `timer-clearance-{home,weight,empty}-*.png` | **Pass.** The rest-timer pill floats above the hairline with a visible gap on Home, on Weight and on a non-scrolling empty account |
| Wide window | `wide-1024-home-hard-dark.png` (1024×768) | **Pass.** The band and hairline span the window, and the five tabs sit in the centred column, aligned with the cards |
| Safe area | `safe-area-34-weight-hard-dark.png` (insets top 47, bottom 34) | **Pass.** The bar sits on the 34dp inset (box 749–810) and the band fills the inset to the screen edge |
| Smoke | `smoke-<scenario>--<tab>--hard-dark.png` (12) | **Pass.** 12/12 scenarios reach their theme and marker, and the selected tab matches |
| Review repro: reused session, Log then Home | `smoke-repro-no-goal--{log,home}--hard-dark.png` | **Pass.** `selected_tab` is Log then Home. The two PNGs differ (sha1 `a5573494…` vs `3fd83603…`) and show Workout Notes and the Home dashboard. The Home-only marker (no "Cutting") is checked only on Home |

## Deviations from the reference

Each one is forced by an existing contract this issue may not change.

1. **Active colour on light courts.** The active tab uses `primaryOnContainer`,
   not the prototype's `primary`. `theme-rendering.test.js` requires this
   token for the 4.5:1 text contrast floor. On dark courts the two look the
   same; on light courts the active tint is slightly deeper.
2. **Active label weight.** The label is 700 in JetBrains Mono Bold, because
   `theme-rendering.test.js` asserts `fontWeight: '700'`. On web this can look
   heavier than the prototype's 600.
3. **Tab inset.** The tabs keep 16/16 column offsets on a phone, while the
   prototype spreads them edge to edge. `adaptive-layout.test.js` (#1126)
   pins the bar to `centeredColumnInsets()`. The band and hairline are full
   width, so the bar still reads as docked.
4. **RootHeader context case.** The context line is uppercase by default (issue
   acceptance criterion 6), while some reference shots show mixed case.
   `uppercaseContext={false}` is available. No tab adopts `RootHeader` in R1,
   so nothing in these renders shows it. Its behaviour is covered by
   `redesign-primitives.test.js`.
5. **Root back bar.** The web-only "← Home" back bar on root tabs is existing
   behaviour and outside R1. Root-tab headers come with each tab's redesign
   issue.

## Review feedback: smoke tab selection

The first review of `667f0a70` found that `smoke()` skipped selecting Home in
a reused session. So `--scenarios no-goal --tabs Log,Home` saved the Log screen
as "home" and passed the Home marker. The fix is in the shared harness:

- `smoke()` now selects every requested tab, including Home.
- `Session.tab()` checks the tab bar's selection afterwards and throws on a
  mismatch.
- `selectedTab()` reads the selection from the active indicator, because the
  web build emits no `aria-selected`.
- Each smoke result records `selected_tab`, and there is no shot or marker
  check unless it matches.

The repro now runs inside the r1 runner (rows above).

The full matrix was also run outside the repo: `--scenarios all --themes
hard-dark,clay-light` on all five tabs, 120 combinations.

- 112 captured. Every `selected_tab` matched and every theme was reached.
- 24 marker checks ran (one per scenario and theme), with none false.
- No two tab shots in any scenario and theme were identical.
- 8 combinations failed as expected: the `first-use` non-Home tabs, which the
  walkthrough blocks. They fail with an error rather than a wrong shot.

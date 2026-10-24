# R2 (#1601) evidence: Weight entry, Latest, goal and history

Real-app renders of the redesigned Weight screen (tracker #1609).

- **Rendered commit:** `ae6775977747d832bae497f10e17f722543a026d` (the only
  commit on the branch that changes `mobile/`; later commits touch only this
  folder's README, capture script and PNGs, so they cannot change the renders).
  The 8 storage-fault / date-path PNGs were rendered from a fresh export of
  that same `mobile/` tree.
  A later review fix (no-goal setup Cancel discards the draft; a closed setup's
  draft no longer feeds goal direction) changes only the state after Cancel,
  which no capture shows: `no-goal-*` has an empty draft before and after the
  fix, and `no-goal-form-open-*` keeps the live draft. So those PNGs still
  apply; the sequence is pinned by `redesign-weight.test.js`.
- **Viewport:** 390×844 CSS px at DPR 2 (PNGs are 780×1688), except
  `full-weight-*` (390×2600, so the whole vertical order is one image).
- **Clock and data:** `FIXED_NOW` 2026-10-23T12:00Z; shared scenarios from the
  [harness](../README.md). `withGoalHistory` in [`fixtures.cjs`](fixtures.cjs)
  adds two archived goals (one met, one missed) for the Goal history states.
- **Size:** 46 PNGs, 4,090,911 bytes. Theme checks: 46/46 matched (38 + the 8
  storage-fault / date-path captures added for the #1601 review).

## Reproduce

```sh
cd mobile
EXPO_PUBLIC_SUPABASE_URL=https://mockproj.supabase.co EXPO_PUBLIC_SUPABASE_ANON_KEY=local-anon-key \
  npx expo export --platform web --output-dir <dist>
cd ..
node docs/evidence/app-redesign-v3/r2/capture.cjs <dist> <dir containing playwright> [workDir] [storage]
```

The optional fourth argument `storage` runs only the storage-fault and
date-path states (sections 10-12 of `capture.cjs`).

**How the storage faults are made (no product change).** On web,
AsyncStorage's `getItem(key)` is `new Promise((resolve) =>
resolve(localStorage.getItem(key)))`. `capture.cjs` adds a Playwright init
script that patches `Storage.prototype.getItem` for `kilo_weight_entries` only,
then reloads (the harness seeds once per tab, so the fixture stays):

- **reject:** the patched read throws, so the entries read rejects at launch.
  Nothing was ever loaded, so there are no cached entries; the goal key is
  untouched, so the goal read succeeds.
- **pending:** the patched read returns a thenable that never settles, so the
  promise adopts it and the entries read stays pending.

`manifest.json` (file, scenario, theme, viewport, state, theme check) is written
to `workDir`, not to this folder.

## Reference and original problem

- **Reference:** the "Weight" section of the
  [redesign spec](../../../design/app-redesign-v3/README.md) and
  [`weight-hard-dark`](../../../design/app-redesign-v3/shots/hybrid-v3/weight-hard-dark.png),
  [`weight-clay-light`](../../../design/app-redesign-v3/shots/hybrid-v3/weight-clay-light.png),
  [`full-weight-hard-dark`](../../../design/app-redesign-v3/shots/hybrid-v3/full-weight-hard-dark.png).
- **Before:** production 1.21.2 Weight is a stacked form (Weight / Date / Note
  fields, full-width Save), a "Goal" section, a Trends table and collapsed
  history summaries; see
  [`r1/after/first-weight-hard-dark.png`](../r1/after/first-weight-hard-dark.png).

## Layout checklist (from the reference)

1. RootHeader "Weight" + mono context `N weigh-ins · <mode> → <target> lb`.
2. Order: Log weigh-in (only active border) > Latest > Goal > History > Goal
   history; 16px gaps; no trend chart.
3. Log weigh-in: one row of weight box (unit suffix) / "Today" date button /
   filled SAVE, then "+ Add note".
4. Latest: `LATEST · date`, 44px hero + unit, toned arrow change "vs previous";
   hairline then 7-DAY / 30-DAY AVG (17px mono + toned change); bottom row
   "Full trend in Analytics ›".
5. Goal: `GOAL · <MODE>` (mode in primary); "N lb to go · N weeks left"; progress
   bar with START / % / TARGET only for a stored start; Target / Target date and
   Target pace / Suggested deficit split rows; outlined EDIT / (ARCHIVE) / CLEAR.
6. History: `HISTORY · N` + filter icon; WEIGHT / CHANGE / DATE header band;
   rows with note under the value and an ✕ control; SHOW MORE WEIGHT ENTRIES.
7. Goal history: one disclosure row "Goal history · N".

## Captures

| File (`after/`) | State | Result |
|---|---|---|
| `first-weight-{hard-dark,clay-light,grass-light,clay-dark}` | first screen | Pass: items 1–5 match `weight-hard-dark` (hero, avgs, split rows, progress 49%) |
| `full-weight-{hard-dark,clay-light}` | full vertical order | Pass: order and grid match `full-weight-hard-dark` |
| `goal-active-*` | active goal, stored start | Pass: progress, splits, EDIT / CLEAR |
| `goal-edit-form-*` | Goal Edit | Pass: existing inline form + Cancel |
| `goal-no-start-*` | goal without `start_weight` | Pass: no progress bar |
| `goal-ended-*` | target date passed | Pass: "Goal ended", EDIT / ARCHIVE / CLEAR, no pace |
| `no-goal-*`, `no-goal-form-open-*` | no goal, then Set a goal | Pass: compact panel; form opens on tap |
| `weigh-in-empty-*`, `weigh-in-one-*` | 0 / 1 weigh-ins | Pass: production copy, restyled |
| `entry-note-*` | weight + note typed | Pass |
| `history-*`, `history-filter-open-*`, `history-show-more-*` | History default / filter / expanded | Pass |
| `history-row-edit-*` | row tapped | Pass: "Editing entry" + Cancel, UPDATE, note loaded |
| `goal-history-open-*` | disclosure open | Pass: Target / End Weight / Target Date, outcome colors; END WEIGHT fits 76dp |
| `goal-unreadable-*` | corrupt goal record | Pass: named banner + Retry, derived panels withheld |
| `analytics-deeplink-*` | after "Full trend in Analytics" | Pass: Analytics tab at Weight Trends (pre-R3 Analytics) |
| `entries-error-*` | entries read rejects, no cached entries, goal read OK | Pass: "Could not load weight entries." banner with Retry above Log weigh-in; header context, Latest, Goal, History and Goal history withheld |
| `entries-loading-overlay-*` | initial entries read pending, as a user sees it | Pass: the app startup overlay ("Loading your training...") covers the app; see the note below |
| `entries-loading-*` | initial entries read pending, startup overlay hidden by capture CSS | Pass: header without context, Log weigh-in, then the two skeleton cards; no Latest / Goal / History |
| `entry-date-picked-*` | date control used, 10-20-2026 chosen, weight typed | Pass: the date button reads `10-20-2026` instead of Today; the row still fits (weight box narrows, `186.4 lb` readable) |

**Loading state note.** All five tabs mount at launch and share one coalesced
entries read (one `getItem` for the key at startup). The app startup overlay
(#1372) stays up until Home's reads settle, so while the initial entries read is
pending the user-visible screen is the overlay (`entries-loading-overlay-*`), on
every tab. To show the Weight tree rendered in that same pending state,
`entries-loading-*` injects one CSS rule hiding `[data-testid="app-startup-overlay"]`
and then selects Weight; nothing else on the page is changed.

**Date path note.** On web the date button is a transparent native
`<input type="date">`; clicking it calls `showPicker()`, and the browser's picker
popup is not part of the page, so no page screenshot can contain it. The capture
clicks the control, closes the popup with Escape, sets the input to
`2026-10-20` (the same `change` the picker fires), and captures after the
selection.

## Deviations from the reference (intentional)

- **On Track** appears only in production's `aheadOfSchedule` state (weight
  reached before the target date, #549); it is not shown for every active goal.
- **Archive** follows production availability (met or ended goals only); the
  reference draws it on an active goal.
- **History rows** keep the unit (`187.8 lb`), the full `MM-DD-YYYY` date and
  production's goal-aware severity colors for Change (a loss toward a loss goal
  stays muted). Pinned by `unit-display-ui` and the goal-aware highlighting
  tests.
- **History expand chevron** next to the filter: the panel previews the newest 6
  rows; the chevron (`Expand history`) is the existing control that
  `weight-refactor-contract` / `unit-display-ui` exercise.
- **Suggested deficit** keeps production's "Estimate" note when the calorie
  value is not TDEE-based, and the pace/calorie values are production's
  (`0.48 lb/wk`, `240 cal/day` for this fixture).
- **Goal ended** has no mode label: production's goal analytics give no
  direction once the target date has passed, so the header reads `Goal → 183 lb`.
- The **"← Home" web back bar** above the header is the existing web shell
  control (R1); it is not part of the Weight screen.

## Not captured

- **Browser date-picker popup:** browser-owned, outside the page (see the date
  path note); the state after selection is captured.
- **Delete confirmation:** the ✕ control is visible in every history capture;
  the confirm prompt is a platform dialog, covered by `weight-screen.test.js`.
- **"Show more (N remaining)"** needs more than 50 weigh-ins; the fixture has 43.

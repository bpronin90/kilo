# Changelog

## 0.49.6 - 2026-05-29

- Issue #232: Realigned `mobile/package.json` and `mobile/app.json` to the
  canonical root app version, changed the About version display to `vX.Y.Z`,
  and added a sync script plus CI/closeout guard so future version bumps keep
  the mobile version surfaces aligned.

## 0.49.5 - 2026-05-29

- Issue #225: Moved superseded roadmap docs (`mvp-roadmap.md` through
  `mvp-v4-roadmap.md`) into `docs/archive/`, updated `docs/current-state.md`
  to reflect MVP-Refine as the last completed planning pass with no active
  follow-up, and corrected `docs/repo-structure.md` so the `docs/` inventory
  matches the live repo state.

## 0.49.4 - 2026-05-29

- Issue #224: Removed the dead singular `useWorkoutNote()` hook from
  `mobile/hooks/useEntries.js` and corrected `docs/architecture.md` so it no
  longer documents that unused hook as a live load/migrate path. Preserved the
  storage-layer legacy single-note migration behavior.

## 0.49.3 - 2026-05-29

- Issue #221: Integrated the Analytics workout-session count into the screen
  layout by adding an `Activity` section heading above the existing
  tone-colored `Workout sessions` StatCard. Preserved the shared
  `getSessionTone` thresholds and left session-count computation unchanged.

## 0.49.2 - 2026-05-29

- Issue #220: Replaced `exercises.find` linear scans with keyed `Map` lookups
  in `classifyExerciseSessions`, `deriveRepDropOffFlags`, and
  `deriveNonWeightedTrackedExerciseMetrics`. Pure Big-O cleanup, no behavior
  change.

## 0.49.1 - 2026-05-29

- Issue #219: Migrated screen files to `normalizeExerciseKey`. Replaced all
  manual `normalizeLiftName(canonicalizeName(...))` chains in HomeScreen and
  StatsScreen with the unified `normalizeExerciseKey` helper. Fixed a bug in
  StatsScreen where `canonicalizeName(...).toLowerCase()` was missing whitespace
  collapse, causing potential key mismatches for multi-word exercise names.
  Removed the now-unused `canonicalizeName` public export from parser.js.

## 0.49.0 - 2026-05-29

- Issue #92: Session-count signifier colors on Analytics and Home. The
  workout session count now turns green (1–6), yellow (7–9), or red (≥ 10)
  as a deload-approach cue. Home colors the "Week N" label; Analytics adds
  a "Workout sessions" StatCard with the corresponding tone. Shared
  `getSessionTone` helper in UI.js, `cardWarn` style switched from accent
  orange to caution yellow, both screens use `countWorkoutSessionsFromSections`
  for metric consistency.

## 0.48.0 - 2026-05-29

- Issue #166: Render non-weighted tracked-exercise cards in the Progressive
  Overload section with avg/best metrics, inline labels, and progression
  arrows (↔ steady, ↑/↓ improving/declining, — no trend). Reps-only
  exercises show average and best reps per set; time-based exercises show
  average and best hold duration. Includes `formatDuration` helper for
  time formatting.

## 0.47.0 - 2026-05-28

- Issue #165: Added per-session derivation for non-weighted tracked exercises
  covering reps-only (total_reps + arrow) and time-based (longest_hold + arrow)
  exercise classes, with loaded-bodyweight exclusion routing to the existing
  weighted path.

## 0.46.15 - 2026-05-28

- Issue #200: Switched the Weight save CTA to the primary dark button
  treatment and converted goal Edit/Clear actions from bare text to
  chip-style treatment for visual consistency with the established UI system.

## 0.46.14 - 2026-05-28

- Issue #217: Unified exercise name normalization into a single
  `normalizeExerciseKey` function and migrated all call sites in parser.js
  and data.js, fixing key mismatches for aliased exercises in analytics
  and per-day signal lookups.

## 0.46.13 - 2026-05-28

- Issue #216: Replaced hardcoded `stickyHeaderIndices={[4]}` in StatsScreen
  with a dynamic index calculation so the sticky header stays correct if
  sections are added or reordered.

## 0.46.12 - 2026-05-28

- Issue #215: Wrapped all useEntries pub/sub listener calls in try-catch so
  one failing listener no longer silently drops notifications to subsequent
  listeners.

## 0.46.11 - 2026-05-28

- Issue #214: Added an explicit Edit button to the current routine card
  header on the Log tab so users can enter edit mode without discovering the
  double-tap gesture.

## 0.46.10 - 2026-05-28

- Issue #212: Extracted the per-note `parseWorkoutNote` flatMap from the
  `dashboardData` useMemo into a dedicated memo gated only on `notes`, so
  weight entry and tracked lift changes no longer trigger a full notebook
  reparse on HomeScreen.

## 0.46.9 - 2026-05-28

- Issue #209: Removed stale `KILO_TODAY` references from
  `docs/current-state.md` and marked legacy roadmap files as historical,
  directing readers to `docs/roadmap-mvp-refine.md` as the active roadmap.

## 0.46.8 - 2026-05-28

- Issue #204: Fixed intermittent tab-switch flicker by replacing conditional
  screen rendering with a persistent keep-alive pattern in `App.js`. All main
  screens are now mounted once and visibility is toggled via `display` style,
  eliminating remount cycles during tab navigation.

## 0.46.7 - 2026-05-28

- Issue #213: Archived the frozen browser prototype (`Kilo.html`, `src/`,
  `tests/`) to `docs/archive/browser-prototype/`. Removed the Capacitor Android
  shell (`android/`, `capacitor.config.json`), vitest config, and all
  browser-specific dependencies and scripts from `package.json`. The mobile Expo
  app under `mobile/` is now the only active app path.

## 0.46.6 - 2026-05-28

- Issue #211: Deduplicated progression signal logic by extracting
  `_buildComparable` and `_deriveSignalForComparables` helpers from
  `deriveProgressionSignals` and `derivePerDaySignals`, eliminating ~80 lines
  of near-identical code that previously caused the #207 regression when the
  two copies diverged.

## 0.46.5 - 2026-05-28

- Issue #210: Extracted MoreScreen and its five sub-screens (ProfileScreen,
  BackupScreen, SettingsScreen, HelpScreen, AboutScreen) from HomeScreen.js
  into a dedicated MoreScreen.js file, reducing HomeScreen from 1401 to 420
  lines and eliminating cross-concern coupling between the Home dashboard and
  More tab surfaces.

## 0.46.4 - 2026-05-28

- Issue #208: Fixed vitest config to exclude `mobile/**` by spreading
  `defaultExclude` from `vitest/config` and appending the mobile glob, so the
  root `npm test` no longer picks up mobile Jest test files or drops vitest's
  built-in exclusions.

## 0.46.3 - 2026-05-28

- Issue #207: Fixed the native Analytics Progressive Overload regression by
  restoring visible row-level trend arrows, canonicalizing alias lookups,
  using per-day `latest_pr` / `latest_top_weight` / `overload_trend` values
  for multi-day exercise rows, and treating plain note rows as separate
  comparable sessions so repeated same-note logging no longer stalls at
  `first_session`. Reviewer closeout aligned the Home weekly-summary
  classification band to the live overload-count source of truth and extended
  parser/data/StatsScreen regression coverage for the per-day key contract.

## 0.46.2 - 2026-05-27

- Issue #206: Rounded the native Home weight-goal `weeks left` display to the
  nearest whole number at the `HomeScreen` render site so goal timelines no
  longer expose raw fractional week values.

## 0.46.1 - 2026-05-27

- Issue #205: Fixed the per-day multi-day comparison regression for
  rep-only/bodyweight exercises after the original merge. `derivePerDaySignals`
  now mirrors the global rep-based fallback semantics for day-level analytics,
  carries `is_bodyweight` through the per-day payload, and the Analytics
  `CrossDayComparison` row now renders `reps` instead of hardcoded `lb` for
  bodyweight day chips. Added targeted regression coverage for parser, data,
  and StatsScreen bodyweight multi-day cases.

## 0.46.0 - 2026-05-27

- Issue #205: Implemented per-day signal plumbing for multi-day exercise
  comparison. Added `derivePerDaySignals` to `parser.js` which groups
  occurrences by routine-day heading and computes `latest_top_weight`,
  `latest_pr`, and `overload_trend` independently per day. Threaded
  `perDaySignals` through `deriveWorkoutNoteAnalytics`. Analytics Progressive
  Overload section now renders a `CrossDayComparison` row (`MON 185lb ↑ ·
  FRI 175lb →`) for multi-day exercises instead of the static "Also on X"
  text. Global signal contract from #159 unchanged; single-day exercises
  unaffected.

## 0.45.0 - 2026-05-27

- Issue #198: Redesigned the Analytics Progressive Overload section with
  routine-day grouping, collapsible group headers, search filtering, and a
  tabular two-line row layout (exercise name + 4-column metric grid). Multi-day
  exercises appear in each relevant group with an inline cross-day summary.
  Trend arrows now use MaterialIcons with semantic color mapping. Redesigned
  the 1K Progress card with hero total, progress bar, and full breakdown
  labels (Squats/Bench/Deadlifts) in an artisanal-panel container.
  Standardized color tokens (`Colors.divider`, `Colors.subtleBg`,
  `Colors.panelBackground`) and eliminated hardcoded color leaks within scope.
  Added `ArtisanalPanel` shared component to `UI.js`. Per-day signal
  breakdown for multi-day exercises deferred to #205.

## 0.44.0 - 2026-05-27

- Issue #196: Redesigned the Home dashboard to an approved information
  hierarchy. Weekly Summary is now a unified hero card with inline week label,
  dominant 48px weight value, full-width sparkline strip, and semantic
  classification band. Weight Goal card is conditional and visually subordinate.
  1K Club card is tertiary with centered total and canonical breakdown. Removed
  floating badge, section title labels between cards, hero divider, and
  nonfunctional goal chevron. Restricted orange to the weight value and
  wordmark. Added `Colors.caution` token for steady-state classifications.
  Added `docs/design-system-map.md` cross-screen style audit.

## 0.43.3 - 2026-05-27

- Issue #201: Added a small muted `Double-tap to edit` helper line at the top
  of the current Log routine card so the current-note edit gesture is more
  discoverable without changing the established card treatment.

## 0.43.2 - 2026-05-26

- Issue #203: Fixed the native Home weight sparkline render path so the
  7-day rolling-average chart now mounts inside a measured explicit-height
  container with the redundant in-chart header suppressed, matching the
  working Analytics layout contract and preventing blank charts when weight
  history is present.

## 0.43.1 - 2026-05-26

- Issue #197: Wired the stored weight goal into the native Home dashboard data
  pipeline so `deriveWeightGoalAnalytics()` now returns `goalInfo` there for
  the upcoming dashboard goal-status UI work, without changing current Home
  rendering.

## 0.43.0 - 2026-05-26

- Issue #195: Added a native `User Profile` flow under More so users can
  locally save optional height, date of birth, biological sex, and activity
  level inputs for the TDEE-based calorie model, including unit conversion,
  clear-state controls, and save feedback. Reviewer closeout updated
  `docs/current-state.md` to match and bumped the app version.

## 0.42.3 - 2026-05-26

- Issue #169: Produced Progressive Overload redesign brief merging structural
  organization from #147 (routine-day grouping, collapsible sections, search,
  multi-day handling) with visual treatment from #170 (tabular two-line row
  layout, four-column metric grid, artisanal-panel container). Created
  implementation card #198 for agent:gemini.

## 0.42.2 - 2026-05-26

- Issue #188: Approved Home dashboard information hierarchy — consolidated
  weekly signals (week badge, classifications, latest weight, 7-day sparkline)
  into a single hero panel, added conditional weight goal panel, demoted 1k Club
  to last position, and removed unreachable success toast. Spun off #197
  (data wiring) and #196 (UI implementation) as follow-ups.
- Issue #187: Standardized the native app shell safe-area and screen-container
  rules by moving stable top/bottom safe-area ownership into `mobile/App.js`,
  migrating Analytics onto the shared `ScreenShell` layout contract, and
  aligning current-state documentation during reviewer closeout.

## 0.42.1 - 2026-05-26

- Issue #186: Added native canonical data-contract coverage for the stabilized
  workout and weight derivation layers, pinning `deriveWorkoutNoteAnalytics()`
  and `deriveWeightGoalAnalytics()` against their underlying helpers, adding
  representative cross-consumer consistency checks, and locking trust-critical
  `computeWeeksIn()` depth cases against regression.

## 0.42.0 - 2026-05-26

- Issue #194: Replaced the native Weight goal card's flat 3500 cal/lb helper
  with a TDEE-anchored daily calorie target when a complete stored user
  profile is available, using Mifflin-St Jeor BMR plus activity multipliers
  with a legacy estimated deficit/surplus fallback when profile data is
  incomplete. Added local user-profile AsyncStorage support plus a shared
  `useUserProfile()` hook, extended data/storage tests to pin the new
  calorie-model contract, and aligned current-state, testing, and
  architecture docs during reviewer closeout.

## 0.41.7 - 2026-05-26

- Issue #185: Finished the native weight-consumer migration by removing the
  last `StatsScreen` screen-local weight reshaping path so Weight, Home, and
  Analytics all render from the shared `deriveWeightGoalAnalytics()` contract,
  added targeted rendered-screen regression coverage for the Analytics weight
  summary path, and aligned the architecture, testing, calculations-reference,
  and MVP4.5 roadmap docs during reviewer closeout.

## 0.41.6 - 2026-05-26

- Issue #171: Published the human-readable calculations reference with verified
  descriptions of all workout analytics (classifications, skip markers,
  attendance flags, rep drop-off, 1k total, Kilo Max, weekly summary), weight
  analytics (trends, pace, rolling averages), goal guidance (direction, pace,
  calorie estimate, weight resolution), and user configuration (tracked lifts,
  1k selections). Includes FAQ and data lifecycle summary.

## 0.41.5 - 2026-05-26

- Issue #193: Repaired workout-data trust regressions by fixing `Weeks In`
  depth for mixed plain-row and `session_entries` history including skipped
  sessions, restoring alias-aware Progressive Overload signal matching,
  switching Analytics rep-drop-off badges to live canonical derivation instead
  of stale persisted badge state, and extending the native Jest suite to pin
  the skipped-session, alias-resolution, and live `hit_wall` regression cases.

## 0.41.4 - 2026-05-25

- Issue #184: Added `deriveWeightGoalAnalytics()` as the canonical native
  weight/goal derivation layer, migrated Home, Weight, and Analytics to the
  shared contract for latest weight, trends, pace, rolling averages, and goal
  guidance, and extended the native data-suite coverage to pin the shared
  output shape.

## 0.41.3 - 2026-05-25

- Issue #183: Finished the workout-consumer migration by routing Analytics
  signal rows and display-name casing through the canonical
  `deriveWorkoutNoteAnalytics()` layer, removing the remaining screen-local
  signal derivation path, and adding contract tests that pin canonical signal
  outputs against `deriveSignals()` for the same inputs.

## 0.41.2 - 2026-05-25

- Issue #181: Fixed Weeks In on Home to use the canonical
  `deriveWorkoutNoteAnalytics` derivation layer instead of calling
  `computeWeeksIn` directly, and added a null-sections guard so
  Home does not crash when no routine is loaded.

## 0.41.1 - 2026-05-25

- Issue #182: Simplified the Home weekly summary by removing `big_3_deltas`
  from the active contract. The Home dashboard no longer renders the Big 3
  Strength Delta panel; `computeWeeklySummary` now returns only
  classification counts and session status rows backed by the canonical
  workout derivation layer.

## 0.41.0 - 2026-05-25

- Issue #180: Built the canonical workout analytics derivation layer
  (`deriveWorkoutNoteAnalytics`) as the single shared entry point for
  workout analytics consumers, migrated LogScreen to use the canonical
  layer for cross-note classifications and rep-drop-off flags, and migrated
  `deriveSkipData` from a 30-day calendar window to a session-depth window
  so repeated weekday skip detection no longer requires calendar dates.

## 0.40.2 - 2026-05-25

- Issue #179: Created the human-readable calculations reference framework at
  `docs/calculations-reference.md`. Organized by calculation type (weight,
  goals, workouts) with "where you see it" surface tags and a FAQ table,
  ready to be filled as MVP4.5 stabilization completes.

## 0.40.1 - 2026-05-25

- Issue #192: Made native weight/goal calculation ownership explicit by moving
  weight-pace threshold ownership into `mobile/lib/data.js`, centralizing
  goal-guidance current-weight resolution for latest-entry and no-entry
  fallback paths, adding a shared weight trend-summary helper for prior-window
  comparisons, and extending native data-suite coverage to lock the contract.

## 0.40.0 - 2026-05-25

- Issue #163: Added the native Home weekly summary panel beneath the existing
  summary cards. The panel now renders from persisted workout-note inputs,
  showing classification counts for stored tracked-exercise classifications,
  opportunistic stored Big 3 deltas, and a session-based empty state when the
  current routine has no logged sessions. Reviewer closeout also aligned the
  Home empty-state copy and restored the parser's single-occurrence semantics
  for plain inline workout rows so the native Jest suite passes cleanly.

## 0.39.0 - 2026-05-25

- Issue #174: Rebuilt the native Home weekly summary around persisted workout
  note analytics instead of live recomputation, corrected the underlying
  session-classification and Big 3 alignment rules from the #171 audit, fixed
  Log save-path producer completeness plus ephemeral inline `hit_wall` nudge
  dismissal behavior, and aligned the docs/testing notes with the new
  canonical-input contract and removal of persisted nudge-dismiss storage.

## 0.38.2 - 2026-05-25

- Issue #173: Added shared native workout temporal helpers for Sunday-based
  current-week gating and inclusive rolling attendance windows, documented the
  distinct `computeWeeksIn()` routine-depth contract, updated skip-attendance
  logic to use the shared rolling-window helper, and added regression coverage
  for plain-row vs `session_entries` semantics plus DST-adjacent date handling.

## 0.38.1 - 2026-05-24

- Issue #172: Defined canonical ownership contract for native workout analytics
  calculations in `docs/architecture.md`, including field-by-field ownership
  matrix, producer/consumer map, recomputation rules, and acceptance contract
  for downstream issues. Identified Home classification dual-source violation
  and `big_3_deltas` ownership gap as HIGH-priority follow-ups. Updated
  `docs/current-state.md` classification semantics and `docs/testing-and-qa.md`
  test gap documentation.

## 0.38.0 - 2026-05-24

- Issue #162: Added native Big 3 cross-lift asymmetry detection so Home now
  surfaces a dismissible informational note when one of squat, bench, or
  deadlift is progressing while another is stalled or regressing for 2+
  weeks, with dismissal persistence that suppresses re-fire until the pair
  shares a classification and the asymmetry later re-emerges. Reviewer
  closeout updated `docs/current-state.md` and `docs/testing-and-qa.md` to
  match and bumped the app version.

## 0.37.0 - 2026-05-24

- Issue #160: Added persisted intra-session rep drop-off flags for tracked
  exercises in the native workout-note save path, surfaced the latest
  `hit_wall` / `in_reserve` state in Log and Analytics, and moved nudge
  dismissals to a global AsyncStorage key so they survive routine switches.
  Reviewer closeout updated `docs/current-state.md`,
  `docs/testing-and-qa.md`, and `docs/architecture.md` to match and bumped the
  app version.

## 0.36.1 - 2026-05-24

- Issue #161: Added persisted workout skip markers and attendance flags to the
  native workout-note save path, including exercise-level skip tracking,
  fully-skipped day detection, 30-day repeated-weekday attendance flags, and
  cross-section consecutive-skip detection that preserves catalog rename
  continuity. Reviewer closeout updated `docs/current-state.md` and
  `docs/architecture.md` to match and bumped the app version.

## 0.36.0 - 2026-05-24

- Issue #159: Added persisted per-exercise session classifications to native
  workout analytics, widened parser/analytics handling so tracked exercise
  histories resolve more reliably across session-entry, plain-row, alias, and
  bodyweight cases, and rebuilt the `Progressive Overload` surface around a
  sticky column header plus compact trend indicators. Reviewer closeout updated
  `docs/current-state.md` and `docs/testing-and-qa.md` to match and bumped the
  app version.

## 0.35.28 - 2026-05-24

- Issue #156: Reworked the native Weight tab into the approved top-to-bottom
  `Goals`, `Trends`, and `History` hierarchy beneath the existing weigh-in
  entry area, merged the Trends presentation into a cleaner sectioned card
  covering `Pace`, `7-day rolling`, and `30-day rolling`, clarified the
  day-level `date` vs recorded `logged_at` contract in the screen code, and
  added rendered-screen regression coverage for merged Trends behavior plus the
  Weight history timestamp split. Reviewer closeout updated
  `docs/current-state.md`, `docs/testing-and-qa.md`, and
  `docs/mvp-v4-roadmap.md` to match and bumped the app version.

## 0.35.27 - 2026-05-24

- Issue #154: Reworked the native Weight goal card around `Target` and
  `By Date` as the primary anchors, rewrote the derived guidance into the
  approved concise `Target pace` / `Suggested deficit|surplus` hierarchy while
  preserving maintain and no-estimate states, and added rendered-screen
  regression coverage for loss, gain, maintain, no-estimate, and pace-warning
  variants. Reviewer closeout updated `docs/current-state.md`,
  `docs/testing-and-qa.md`, and `docs/mvp-v4-roadmap.md` to match.

## 0.35.26 - 2026-05-24

- Issue #151: Tightened native Log workout-row normalization so recurring
  mixed-load shorthand, simple leading flags, and parseable set segments split
  by inline note tails now recover into the existing structured set path
  instead of degrading to raw fallback rows. Unparsed fallback rows keep the
  shared set-row typography treatment, render unresolved lifting rows in error
  red, and leave warmup/non-lifting fallback rows in normal text. Reviewer
  closeout updated `docs/current-state.md` and `docs/mvp-v4-roadmap.md` to
  match and bumped the app version.

## 0.35.25 - 2026-05-24

- Issue #150: Updated the native Log current-routine read view so the expanded
  rendered note body is scroll-first and partially selectable, single taps stay
  inert, double tap enters raw edit, and the editor now preserves the rendered
  note's approximate scroll position on read-to-edit transition. Reviewer
  closeout also replaced the initial scroll-tracking state with a ref to avoid
  unnecessary re-renders in the long-note scroll path, and updated
  `docs/current-state.md` to match.

## 0.35.24 - 2026-05-24

- Issue #146: Finalized the native Log current-routine editor exit behavior on
  the accepted fallback: leaving the raw current-note editor via `Done` or
  Android back now returns consistently to the top of the rendered current
  note instead of landing at stale or random scroll positions. Reviewer
  closeout also removed the dead App-level current-note scroll state plumbing
  and reverted an unrelated tab-persistence widen so the fix stays scoped to
  the Log flow. Updated `docs/current-state.md` to match.

## 0.35.23 - 2026-05-22

- Issue #168: Aligned the native Help screen back arrow with the standard
  in-content back-button treatment already used by the other More sub-screens,
  preserving the existing return-to-More behavior while removing the now-unused
  `headerLeft` prop/render path from `mobile/components/ScreenShell.js`.

## 0.35.22 - 2026-05-22

- Issue #167: Reworked the native bottom tab bar into a content-aware overlay.
  `mobile/components/ScreenShell.js` now reports shared scroll activity up to
  `App.js`, `mobile/components/TabBar.js` fades the bar toward transparency
  during scrolling, restores the solid treatment during direct interaction, and
  returns to its resting overlay state after a short timeout. Reviewer closeout
  also removed the unused `mobile/context/ScrollContext.js` artifact and stale
  imports left behind during implementation. Updated `docs/current-state.md`,
  `docs/architecture.md`, and `docs/mvp-v4-roadmap.md` to match.

## 0.35.21 - 2026-05-22

- Issue #157: Finalized the MVP4 tracked-exercise analytics spec as a
  comment on the issue, locking the per-card metric model to e1RM and
  Kilo max as co-primary alongside two session-to-session arrows (PO and
  Kilo PO) with an explicit baseline state on the first logged session,
  applying uniformly to all tracked weighted exercises with no settings
  toggles. Spun off six Phase 6 implementation cards (#159 per-exercise
  classification, #160 intra-session rep drop-off flag, #161 skip
  detection, #162 Big 3 asymmetry detection, #163 weekly assessment
  summary panel, #164 asterisk opt-out) and recorded them in the MVP4
  Phase 6 off-shoot list in `docs/mvp-v4-roadmap.md`.

## 0.35.20 - 2026-05-22

- Issue #153: Finalized the MVP4 Weight trends design brief in
  `docs/mvp-v4-roadmap.md` by locking the Weight tab into stacked `Goals`,
  `Trends`, and `History` sections beneath the existing weight-entry area,
  defining Trends as three stacked panels (`Pace`, `7-day rolling`,
  `30-day rolling`) with a fixed internal information order, and recording the
  implementation spin-off issue #156 in the MVP4 Phase 6 off-shoot list.

## 0.35.19 - 2026-05-22

- Issue #148: Finalized the MVP4 rendered-workout-note interaction spec in
  `docs/mvp-v4-roadmap.md`. The roadmap now resolves expanded-note behavior to
  body text that remains selectable for normal highlight/copy, single-tap body
  content that stays inert, and double tap anywhere in the expanded rendered
  note body as the only in-body path into raw edit mode while preserving the
  existing title-row expand/collapse behavior. Spun off implementation issue
  #150 and recorded it in the MVP4 Phase 6 off-shoot list.

## 0.35.18 - 2026-05-22

- Issue #128: Rebuilt the Home `Weeks In` counter around routine progression
  depth instead of a calendar-date approximation. `computeWeeksIn` in
  `mobile/lib/data.js` now takes parsed `sections` and returns the longest
  `session_entries` chain across all exercises and days (`null` when no routine
  is loaded, `0` when a routine has no logged entries); `HomeScreen.js` parses
  `sections` once and feeds them to the new signature. As follow-up cleanup,
  the now-orphaned `currentSince` field — read only by the old `computeWeeksIn`
  — was removed from the `makeWorkoutNoteItem` model and from all
  `mobile/storage/entries.js` writes, normalization, and migration paths. Added
  10 `computeWeeksIn` tests and removed 7 stale `currentSince` tests. Updated
  `docs/current-state.md` to match.

## 0.35.17 - 2026-05-22

- Issue #127: Sharpened the Home header and made the summary panels static.
  Replaced the low-resolution wordmark PNG with a resolution-independent inline
  `react-native-svg` `KiloWordmark` component in `HomeScreen.js`, sourced from
  `src/assets/brand/home-title.svg` (renamed from `kilo-wordmark-clean.svg` for
  clarity). Removed navigation from the `1k Club Progress` and `Weight Trend`
  panels, which are now non-interactive dashboard elements, and dropped the
  now-dead `wordmark` style and the `0.8` opacity on the footer logo. Updated
  `docs/current-state.md` to match the new Home header and static panels.

## 0.35.16 - 2026-05-22

- Issue #126: Repaired the baseline strength Analytics presentation in
  `StatsScreen`. Restored uniform spacing between strength panels, replaced the
  Kilo-max tap-toggle with both `1 Rep Max` and `Kilo Max` shown together in
  every Progressive Overload row, and reworked the tracked-lift cards into a
  compact bordered list matching the weight-history style. Labels were polished
  (`Tracked Lifts` -> `Progressive Overload`, `Big Three 1RM Total` ->
  `1K Progress`, `Slot assignments` -> `Big 3 Mapping`) and exercise names now
  render with their original user-typed casing. The now-dead `kilo_max_raw`
  field was removed from `computeKiloMax` and `deriveSignals` along with its
  test assertions. Updated `docs/current-state.md` to match the new strength
  surface.

## 0.35.15 - 2026-05-21

- Issue #125: Restored the Analytics weight-trend chart, which had stopped
  rendering. `StatsScreen` was overriding its raw weight entries with the
  display-adapted `entries` prop from `App.js` (string `value`, no `date` or
  `weight_value`), so the trend filter stripped every entry and the chart drew
  nothing. `StatsScreen` now derives weight data exclusively from its own
  `useWeightEntries()` hook, and the now-dead `entries` prop and its adapter
  memo in `App.js` were removed. Same-day duplicate-weight behavior and weight
  history are unchanged. Updated `docs/current-state.md` to drop the stale
  entry-adapter description.

## 0.35.14 - 2026-05-21

- Issue #124: Fixed the empty Log state so a fresh install no longer auto-opens
  the note editor or keyboard. Log now renders a dedicated `LogEmptyState`
  component (`mobile/components/LogEmptyState.js`) with explanatory copy, a
  `New Routine` primary action, and an example-format card, gated on the
  workout-note load so existing users never see it flash before their routine
  appears. Removed `autoFocus` from the note editor. Updated
  `docs/current-state.md` and `docs/repo-structure.md` to match.

## 0.35.13 - 2026-05-21

- Issue #123: Made the current routine a title-first collapsible card on the
  Log tab — the header row toggles a collapsed/expanded state persisted under
  `kilo_log_current_collapsed` and held in `App.js` so it survives tab
  navigation and app restarts. Removed the top header `Edit` button (edit mode
  is now entered through the in-card `Edit note` action), renamed the Log
  surfaces to `Workout Notes` / `More Routines` / `Set Current`, and added a
  `LOG TAB STYLE LOCK` notice so Log-tab typography and styling are not changed
  without an explicit owner request. Updated `docs/current-state.md` to match.

## 0.35.12 - 2026-05-21

- Issue #122: Fixed workout-note save semantics so `Save` is the explicit save
  action, the editor stays open with a transient `Saved!` confirmation, and
  `Done` / Android back no longer save implicitly — leaving with unsaved
  changes now prompts to discard a never-saved note or save/discard an existing
  note. Removed implicit creation of a never-saved note, fixed a stale
  `BackHandler` closure that could drop the discard prompt, and replaced the
  implicit save-on-switch with an explicit save-and-switch / switch-anyway
  choice. Updated `docs/current-state.md` to match the shipped behavior.

## 0.35.11 - 2026-05-21

- Issue #144: Restored native Weight goal pace and calorie guidance by
  computing saved-goal estimates without waiting for form-state hydration,
  adding a current-weight fallback for no-entry goal setup, and clearing that
  fallback state on edit cancel/clear so stale values are not silently reused.

## 0.35.10 - 2026-05-21

- Issue #143: Renamed the native Analytics `first_session` label from `First`
  to the approved `Initial` wording in both progression-status and overload
  contexts.

## 0.35.9 - 2026-05-21

- Issue #145: Fixed tracked-lift Analytics progression status and overload
  trend so exercises logged as multiple session-entry lines under one block no
  longer stick on `first_session`, and mixed inline/session-entry history now
  compares against the latest prior comparable session correctly.

## 0.35.8 - 2026-05-21

- Issue #141: Normalized native Log-tab set-row typography by routing both
  parsed `SetLine` rows and fallback unparsed/skip rows through one shared
  font-size token, removing the stray italics and inconsistent sizing from the
  read view. Updated `docs/current-state.md` and `docs/mvp-v3.5-roadmap.md`
  to match the shipped UI.

## 0.35.7 - 2026-05-21

- Issue #140: Raised the native Weight screen Goal section to the top of the
  screen, enlarged goal target/date typography, promoted weekly pace and
  calorie guidance into high-hierarchy suggestion boxes, preserved semantic
  maintain-goal messaging, and updated `docs/current-state.md` plus
  `docs/mvp-v3.5-roadmap.md` to match the shipped UI.

## 0.35.6 - 2026-05-21

- Issue #139: Replaced the native Weight goal target-date text field with a
  native date picker, kept stored goal dates in ISO while rendering visible
  target dates as `MM-DD-YYYY`, and updated `docs/current-state.md` plus
  `docs/mvp-v3.5-roadmap.md` to match the shipped behavior. Follow-up bug
  #144 tracks the separate missing goal-estimate display issue found during
  closeout verification.

## 0.35.5 - 2026-05-21

- Issue #138: Reformatted visible native Weight history dates to
  `MM-DD-YYYY` through a display-only formatter while leaving stored ISO
  timestamps unchanged, added formatter regression coverage, and updated
  `docs/current-state.md` plus `docs/mvp-v3.5-roadmap.md` to reflect the
  shipped behavior.

## 0.35.4 - 2026-05-21

- Issue #137: Right-sized and recolored the native Weight log weigh-in save
  button so it matches the app's primary-action sizing more closely and uses
  the shared accent palette instead of raw black. Updated
  `docs/mvp-v3.5-roadmap.md` to mark the polish task shipped.

## 0.35.3 - 2026-05-20

- Issue #136: Shifted native app content upward at the shared shell by moving
  top-spacing responsibility into `mobile/components/ScreenShell.js`,
  wrapping the shared header in `SafeAreaView`, keeping one Android
  status-bar-aware offset there, and removing the old global top container
  padding so all tabs sit higher without notch or status-bar clipping.
  Updated `docs/current-state.md` and `docs/mvp-v3.5-roadmap.md` to match the
  shipped behavior.

## 0.35.2 - 2026-05-20

- Issue #135: Softened the native bottom tab bar by switching it from the
  heavy dark floating treatment to the lighter shared card/chip palette,
  keeping touch targets intact while making the active state remain easy to
  identify. Updated `docs/current-state.md` and `docs/mvp-v3.5-roadmap.md` to
  match the shipped UI and roadmap status.

## 0.35.1 - 2026-05-20

- Issue #134: Fixed native Analytics tab entry flicker by stabilizing the
  initial `StatsScreen` layout and loading state, scoped section placeholders
  to their own data dependencies, filtered incomplete weight rows before the
  rolling-average helpers, and updated `docs/current-state.md` plus
  `docs/mvp-roadmap.md` to match the shipped behavior.

## 0.35.0 - 2026-05-20

- Issue #133: Updated the native Log read view so warmup and lifting work for
  the same calendar day render under one weekday heading while preserving
  distinct sub-sections, added parser coverage for the same-day heading
  contract, and updated `docs/current-state.md` plus `docs/mvp-roadmap.md` to
  match the shipped behavior.

## 0.34.0 - 2026-05-20

- Issue #132: Added a neutral native Home `Weeks In` tile derived from the
  current routine's `currentSince` date, kept it 1-indexed from the
  designation day, preserved a neutral unknown state for migrated legacy
  routines without a known start date, and updated `docs/current-state.md`
  plus `docs/mvp-roadmap.md` to match the shipped Home behavior.

## 0.33.2 - 2026-05-20

- Issue #131: Updated the native Home header to use the bundled Kilo
  wordmark, changed the supporting copy to `Current Routine Progress`,
  renamed the strength card to `1k Club Progress`, removed the old `Total
  Weeks` tile, and updated `docs/current-state.md` plus
  `docs/mvp-roadmap.md` to match the shipped Home behavior.

## 0.33.1 - 2026-05-20

- Issue #130: Tightened the native Home dashboard navigation so only the
  intended `1,000 lb Club` total and `7-day rolling average` regions
  navigate, routed both targets to the matching Analytics section, removed the
  misleading extra line from the 1k bubble, and updated
  `docs/current-state.md` and `docs/mvp-roadmap.md` to match the shipped
  behavior.

## 0.33.0 - 2026-05-20

- Issue #129: Shipped routine-aware tracked-lift Analytics cards on the native
  app by wiring Log and Analytics to the same reactive global tracked-lift
  store, filtering visible cards to lifts present in the current routine while
  preserving full per-lift history across routines, and keeping Big Three 1RM
  totals plus workout counts scoped to the current routine. Updated
  `docs/current-state.md`, `docs/architecture.md`, and
  `docs/mvp-v3.5-roadmap.md` to match the shipped behavior.

## 0.32.0 - 2026-05-20

- Issue #121: Re-enabled the native Log-screen `Track` control with persistent
  global tracked-lift storage keyed by normalized exercise names, fixed the
  rapid-toggle race so consecutive Track updates cannot overwrite each other,
  and updated `docs/current-state.md`, `docs/architecture.md`, and
  `docs/mvp-v3.5-roadmap.md` to match the shipped behavior.

## 0.31.0 - 2026-05-20

- Issue #120: Added native Log-tab `Set current` actions for non-current
  routines, requiring confirmation before routine switches, preserving pending
  edits before the switch, and recording a real `currentSince` timestamp when
  a different routine becomes current. Updated `docs/current-state.md` and
  `docs/mvp-v3.5-roadmap.md` to match the shipped behavior.

## 0.30.0 - 2026-05-20

- Issue #119: Added native Log-tab routine CRUD controls so users can create,
  rename, and delete routine notes from the notebook UI, with confirmation on
  deletes and persisted current-routine cleanup when the active routine is
  removed. Updated `docs/current-state.md` and `docs/mvp-roadmap.md` to match
  the shipped behavior.

## 0.29.0 - 2026-05-20

- Issue #118: Updated the native Log tab so the selected current routine stays
  in the full parsed-workout view while every non-current routine now appears
  as a collapsed title-only row in the bottom `Routines` list that opens its
  raw editor on tap. Updated `docs/current-state.md` and
  `docs/mvp-roadmap.md` to match the shipped behavior.

## 0.28.1 - 2026-05-20

- Issue #117: Migrated native workout-note storage from the legacy single-note
  shape into the multi-routine notebook model, including one-time backfill of
  a `Routine 1` current entry for old local data, normalization of older
  notebook rows so they carry `isCurrent` and `currentSince`, and regression
  coverage for migration, persistence, and current-routine metadata. Updated
  `docs/current-state.md`, `docs/architecture.md`, and `docs/mvp-roadmap.md`
  to match the shipped storage behavior.

## 0.28.0 - 2026-05-20

- Issue #116: Added a low-prominence fatigue-multiplier setting to the More
  tab in both the native app and the browser prototype, persisted the value
  through the existing local storage paths and backup/export contract, and
  wired Analytics to recompute tracked-lift Kilo max values immediately after
  multiplier changes. Updated `docs/current-state.md` and
  `docs/architecture.md` to match the shipped behavior.

## 0.27.6 - 2026-05-20

- Issue #115: Fixed native Analytics Kilo max so tracked lifts no longer reuse
  estimated 1RM. The tracked-lift cards now compute Kilo max from the average
  Epley value across non-warmup sets with the default `1.07` fatigue
  multiplier, store both adjusted and raw values, and let the user tap to
  inspect the raw value on the Analytics screen. Updated `docs/current-state.md`
  to match the shipped behavior.

## 0.27.5 - 2026-05-20

- Issue #114: Fixed the shared native weight pace classifier so tiny daily
  changes no longer trigger false fast-gain/fast-loss warnings, centralized
  the threshold logic in one helper used by both Weight and Analytics, and
  restored distinct yellow (`>= 1.5 lb`) versus red (`>= 2.3 lb`) warning
  bands across both screens. Updated `docs/current-state.md` to match the
  shipped behavior.

## 0.27.4 - 2026-05-20

- Issue #113: Disabled the native Log-screen `Track` control until the
  persistence pipeline lands, removed the silent tap-with-no-result behavior,
  and updated `docs/current-state.md` to match the shipped read-view state.

## 0.27.3 - 2026-05-20

- Issue #112: Fixed native Android hardware-back behavior so non-Home tabs
  route back toward Home instead of exiting immediately, the More and Log
  flows pop their own in-screen subviews before falling through, and the Home
  root now shows an exit confirmation instead of closing the app outright.
  Updated `docs/current-state.md` to match the shipped mobile navigation
  behavior.

## 0.27.2 - 2026-05-20

- Issue #111: Fixed the native Log raw-note Save flow so current-note edits
  persist through the workout-note store, successful saves return to read mode
  for visible confirmation, first-save creation still blocks empty notes, and
  existing notes can still be cleared to an empty string. Added storage
  regression coverage for both the raw-text update round-trip and the
  existing-note clear path, and updated `docs/current-state.md` to match the
  shipped Log behavior.

## 0.27.1 - 2026-05-20

- Issue #110: Fixed the native Home screen `1,000 lb Club` bubble so it
  navigates to the shipped `Analytics` tab instead of a blank screen, and
  added a legacy `Stats` route fallback in `mobile/App.js` so stale
  navigation targets still resolve cleanly.
- Added `docs/mvp-v3.5-roadmap.md` to capture the next post-MVP cleanup and
  capability plan, and shipped the mobile Android bundle dependency fix that
  updates the declared `expo-updates` version plus `mobile/package-lock.json`
  so the native install path stays buildable.

## 0.27.0 - 2026-05-19

- Issue #109: Redesigned the native Analytics strength section by renaming the
  old `1,000 lb Club` panel to a Big Three 1RM total, filtering 1k slot
  selection down to strength lifts, and expanding tracked-lift cards to show
  estimated 1RM, all-time Kilo max, latest top weight, and overload trend.
  Added parser coverage for the new analytics outputs and updated
  `docs/current-state.md` to match the shipped behavior.

## 0.26.0 - 2026-05-19

- Issue #108: Compacted the native Analytics weight section into a single
  summary card with latest weigh-in, corrected shared pace warning, embedded
  7-day rolling-average chart, and 7-day/30-day averages while removing the
  low-value totals layout. Updated `docs/current-state.md` to match the
  shipped Analytics behavior.

## 0.25.0 - 2026-05-19

- Issue #107: Replaced the native Home mini-analytics cards by removing the
  old sets-per-session panel, adding a current-workout `1,000 lb Club`
  progress card derived from the latest tracked lift results, and switching
  the weight surface to a compact 7-day rolling-average line chart with the
  shared tap-to-inspect value display. Updated `docs/current-state.md` and
  `docs/mvp-roadmap.md` to match the shipped Home behavior.

## 0.24.0 - 2026-05-19

- Issue #106: Added a reusable compact native line-chart primitive for the
  shared mobile UI layer, with latest-value display and tap-to-inspect point
  selection while removing hard-coded screen-width assumptions so future Home
  and Analytics chart surfaces can embed it in different layout contexts.

## 0.23.0 - 2026-05-19

- Issue #105: Added a lightweight advisory calorie-estimate helper for native
  weight goals. The Weight screen now shows a direction-aware daily
  surplus/deficit estimate derived from the saved goal's required weekly pace,
  suppresses contradictory output for maintain goals, and includes regression
  coverage for the maintain-direction edge case.

## 0.22.0 - 2026-05-19

- Issue #104: Added a lightweight native Weight-goal flow with persistent
  target weight and target date storage, derived gain/loss/maintain direction,
  required weekly pace, and advisory unrealistic/unhealthy warnings that do
  not block save. The local v2 backup/import path now includes the persisted
  weight goal with pre-write validation and malformed-payload rejection
  coverage, and the current-state, architecture, testing, and roadmap docs
  now reflect the shipped native behavior.

## 0.21.2 - 2026-05-19

- Issue #103: Redesigned the native Weight history rows for long-history use
  by tightening row spacing, adding per-entry delta formatting plus visual
  severity cues for notable (`> 1.5 lb`), spike (`> 2.3 lb`), and outlier
  (`> 3.5 lb`) changes, and keeping the existing row edit/delete behavior
  intact. Updated `docs/current-state.md` to match the shipped Weight-screen
  behavior.

## 0.21.1 - 2026-05-19

- Issue #102: Fixed the shared native weight pace calculation so backdated
  entries are classified by their actual `date` instead of insertion order,
  keeping Weight and Analytics aligned on the same gain/loss pace result and
  adding regression coverage for gain, loss, and neutral cases.

## 0.21.0 - 2026-05-19

- Issue #101: Fixed current-workout session counting so warmup and lifting
  blocks under the same day heading count as one session, changed Home `Total
  Weeks` to use the highest per-day session count from the selected workout
  note through a stable parser helper, and added regression coverage for the
  corrected combined-day counting rules.

## 0.20.0 - 2026-05-19

- Issue #100: Extended the native Log routine workflow so any non-current
  workout note can be opened in a dedicated raw-note editor from the always-
  visible `Previous Routines` list, current-note saves are guarded against
  duplicate in-flight taps, and promoting another routine to the current
  workout now requires confirmation and preserves unsaved edits by saving them
  first or surfacing a failure without switching. Updated
  `docs/current-state.md` to match the shipped Log behavior.

## 0.19.0 - 2026-05-19

- Issue #99: Rebuilt the native Log tab around the selected current workout.
  `mobile/screens/LogScreen.js` now shows the active routine in the structured
  read view while rendering non-current routines as compact `Previous
  Routines` panels that switch the current selection, and `mobile/App.js` now
  refreshes the editor text when the current routine changes. Updated
  `docs/current-state.md` to match the shipped Log-tab behavior.

## 0.18.2 - 2026-05-19

- Issue #98: Replaced the native single workout-note store with a local-only
  multi-note current-workout model. `mobile/storage/entries.js` now persists
  multiple titled workout notes plus an explicit current-workout selection,
  `mobile/hooks/useEntries.js` exposes the new current-note hook surface for
  later UI work, `mobile/App.js` now saves through the selected workout note,
  and the local backup/import path now exports the v2 multi-note format while
  still accepting legacy v1 backups to restore weight history without wiping
  the newer workout-note state. Updated the current-state, architecture, and
  roadmap docs to match the shipped storage contract.

## 0.18.1 - 2026-05-19

- Issue #97: Polished the native Help flow inside the More tab by extending
  `mobile/components/ScreenShell.js` with a title-row `headerLeft` slot,
  keeping More-screen quick actions unchanged, and moving Help-only branding
  to a centered in-content logo above the Help and Terminology panel with an
  accessible header back control.

## 0.18.0 - 2026-05-19

- Issue #96: Made the native Home dashboard more actionable by turning the
  `Latest Weight` and `Total Weeks` summary cards into tab shortcuts to Weight
  and Log, removing the low-value `Recent activity` section, and extending the
  shared native `Card` primitive with an `onPress` path that preserves the
  non-pressable card rendering behavior.

## 0.17.7 - 2026-05-19

- Issue #95: Simplified the native Home dashboard copy and top summary
  presentation in `mobile/screens/HomeScreen.js` by changing the subtitle to
  `Your training dashboard.`, renaming the second summary card from
  `Total Workouts` to `Total Weeks`, and balancing the two summary cards with
  local Home-only styling instead of broad shared-component changes.

## 0.17.6 - 2026-05-19

- Issue #94: Simplified the native shared header treatment in
  `mobile/components/ScreenShell.js` by removing the shared logo/wordmark
  header assets, reducing the version display to a low-emphasis `vX.Y.Z`
  label, and standardizing the displayed version naming away from the old
  `alpha-` prefix. Updated `docs/current-state.md` so the documented native
  header behavior matches the shipped app.

## 0.17.5 - 2026-05-19

- Issue #93: Normalized the native app's top safe-area spacing across Home,
  Log, Weight, Analytics, and More/Help by moving Log and Weight onto the
  shared `ScreenShell`, adding Android status-bar-aware top spacing there, and
  preserving first-tap form actions via `keyboardShouldPersistTaps="handled"`
  on the form-based screens. Bottom tab bar behavior unchanged.

## 0.17.4 - 2026-05-19

- Issue #88: Fixed a regression from #79 that broke the workout read view.
  `buildSessionsFromNote` had been wired into `LogScreen`, `HomeScreen`, and
  `StatsScreen`, so the real freeform log format (bare `weight reps` history
  lines, bare `-` skip markers) rendered as "Session N" blocks full of
  "— skipped" while actual parsed history was hidden, and workout counts
  collapsed to skip-slot artifacts. Removed `buildSessionsFromNote` from all
  product screens: the read view now always renders the formatted note mirror
  (day → `+` subheading → `-` exercise → history rows) faithful to the raw
  text with inline `—` skip markers. Added `countWorkoutSessions` (max parsed
  history-row count across exercises) as the source for Home "Total Workouts"
  / "Sets per session" and Analytics "Workout sessions". `buildSessionsFromNote`
  and its tests are retained for legacy-migration-format validation only. No
  migration-format, analytics-formula, or persistence change.

## 0.17.3 - 2026-05-18

- Issue #86: Wired the OTA signing key into the mobile publish scripts. Both
  `publish:android` and `publish:android:preview` now pass
  `--private-key-path "${EXPO_OTA_PRIVATE_KEY_PATH:?...}"`, so signed preview
  and production updates no longer require hand-appending the key path and a
  missing env var fails fast with a clear message instead of a cryptic
  `eas` signing error. Documented the env var contract and both signed-publish
  flows in `mobile/certs/KEYS.md`. No signing certificate, channel, or
  platform change.

## 0.17.2 - 2026-05-18

- Issue #85: Replaced the opaque-background brand assets with true RGBA
  transparent PNGs (`logo.png`/`wordmark.png` in both `mobile/assets/brand/`
  and `src/assets/brand/`) and switched `ScreenShell` `require()` paths off
  the `.jpg` files. Re-cropped the wordmark from a 512×512 square canvas to
  its true 303×106 text bounding box and set the `ScreenShell` wordmark
  display size to `91×32` with `resizeMode="contain"`, fixing the squashed
  wordmark and the white box on the cream native background. Legacy `.jpg`
  files left in place; no code references them.
- Issue #33: UX scoping pass on Kilo theme and color. Captured concrete
  contrast/readability findings against shipped screens (KiloHeader filter
  hack, `ink4` AA failure, faint `accentDim`, marginal small-size labels)
  and a tighter follow-up implementation scope. Scoping only; no product
  code change. Spawned issue #85.

## 0.17.1 - 2026-05-18

- Issue #83: Synced `mobile/package-lock.json` with the declared
  `expo-updates@~29.0.17` dependency so EAS `npm ci` no longer fails in the
  Install dependencies phase. No version-pin change.
- Issue #84: Renamed `mobile/assets/brand/logo.png` and `wordmark.png` to
  `.jpg` (the files were JPEG data with a `.png` extension) and updated the
  `ScreenShell` `require()` paths, fixing the AAPT2
  `:app:mergeReleaseResources` failure on the Android preview build. No
  visual or transcoding change.

## 0.17.0 - 2026-05-18

- Issue #82: Fixed Android preview OTA update visibility. Switched
  `runtimeVersion.policy` from `fingerprint` to `appVersion` so valid
  JS/asset OTA updates apply to installed builds sharing the app version,
  and added an OTA Diagnostics panel to the About screen (channel, runtime
  version, embedded-vs-applied bundle, update-available/pending state, and a
  manual update check). Documented the exact cases requiring a fresh Android
  build — including the one-time rebuild needed to migrate off legacy
  `fingerprint` APKs — in `docs/phone-runbook.md` and `docs/current-state.md`.

## 0.16.0 - 2026-05-18

- Issue #80: Added a local-only mobile export/import and recovery flow for user
  data. Introduced a versioned v1 backup format plus `exportBackup`,
  `validateBackup`, and `importBackup` in the native storage layer, with
  validation before any write, a batched atomic-as-possible replace restore,
  and a Data & Backup surface in the More tab for export/share and paste-to-
  import with clear success/error handling. Restore leaves the legacy
  workout-session key untouched and no remote sync is introduced. Aligned the
  architecture and current-state living docs with the new recovery path.

## 0.15.0 - 2026-05-18

- Issue #81: Extracted the shared workout parsing and derived-analytics domain
  layer across the web and native app paths, migrated the browser consumers to
  the canonical row/note parser plus shared Epley-based analytics helpers, and
  aligned the living docs with the now-shared analytics behavior.

## 0.14.8 - 2026-05-18

- Issue #79: Unified the native app around the canonical workout-note
  persistence model, removed downstream dependence on the legacy structured
  workout-session path for current Home/Log/Analytics behavior, and added a
  contract-driven migration flow plus test coverage so legacy installs retain
  session counts, weighted history, non-weight history, and mixed-entry note
  metadata when their older session data is folded into the workout note.

## 0.14.7 - 2026-05-18

- Issue #75: Hardened the legacy `Kilo.html` runtime CDN dependencies with
  verified SRI hashes and `crossorigin="anonymous"` attributes, switched React
  and ReactDOM to production-minified CDN assets, and updated the architecture
  and current-state docs to document the browser and Capacitor shell
  supply-chain protection posture.

## 0.14.6 - 2026-05-18

- Issue #78: Made the Android Capacitor shell's backup behavior explicit by
  wiring manifest backup rules that preserve WebView `localStorage` workout and
  weight history across backup/restore flows while excluding SharedPreferences,
  and documented that packaged-Android persistence policy in
  `docs/current-state.md`.

## 0.14.5 - 2026-05-18

- Issue #77: Added a GitHub Actions dependency-audit gate for both the root
  and `mobile/` package trees, added matching local `npm audit` scripts, and
  documented the new high-severity vulnerability check in
  `docs/testing-and-qa.md`.

## 0.14.4 - 2026-05-18

- Issue #76: Enabled Expo OTA update code signing for the native app by adding
  the client-side certificate and manifest-signing configuration, documenting
  private-key handling and signed publish requirements, and clarifying that
  on-device enforcement begins only after installing a native build produced
  with the embedded certificate.

## 0.14.3 - 2026-05-18

- Issue #74: Updated `docs/repo-structure.md` so the tracked repo inventory
  includes `docs/mvp-v2-roadmap.md`, `docs/phone-runbook.md`, and
  `tests/log-ui.test.jsx`, and clarified that `android/` is intentionally
  tracked Capacitor shell source while generated artifacts remain excluded by
  `android/.gitignore`.

## 0.14.2 - 2026-05-18

- Issue #73: Added a root `.gitignore` covering generated and local-only
  artifacts, made the `.claude/` runtime boundary explicit at the repo root,
  and removed the previously tracked `.claude/napkin.md` and
  `.claude/settings.json` files from version control.

## 0.14.1 - 2026-05-18

- Issue #69: Added a Mermaid current-state architecture diagram to
  `docs/architecture.md` and refreshed stale native-app routing references so
  the architecture doc matches the current Expo app surface.

## 0.14.0 - 2026-05-18

- Issue #68: Made native strength analytics resilient to conservative
  deterministic exercise-name variants, added explicit persisted 1k exercise
  slot selection on the Analytics screen, and updated analytics copy so 1k and
  tracked-lift behavior no longer depends on rigid hardcoded lift names.

## 0.13.3 - 2026-05-18

- Issue #67: Fixed the native Weight flow so saving a weigh-in keeps the user on
  Weight history, replaced the oversized bubble-card history treatment with a
  denser scannable row layout, and added inline per-row deletion without
  interfering with tap-to-edit behavior.

## 0.13.2 - 2026-05-17

- Issue #66: Fixed the native workout-note editor polish so the bottom Log
  read-view action now shows visible `Edit note` text and saving a note keeps
  the user in the editor near the same cursor and scroll context instead of
  jumping them back to a different read-view position.

## 0.13.1 - 2026-05-17

- Issue #65: Fixed long-note workout session alignment in the native app so
  positional `- ...` exercise entries now build shared sessions across warmup
  and lifting blocks, bare `-` skip slots preserve cross-exercise alignment,
  uneven entry counts surface a visible warning, and the Log read view exposes
  one editable block per detected session instead of reporting sessions that
  were not separately surfaced.

## 0.13.0 - 2026-05-17

- Issue #62: Enabled Android EAS OTA updates for the native Expo app by
  configuring `expo-updates`, explicit Android update channels, channel-based
  publish scripts, and a fingerprint-based runtime boundary so JS and asset
  changes can ship without a rebuild while native-affecting changes still
  require a new build.

## 0.12.0 - 2026-05-17

- Issue #64: Replaced the native Home tab with a dashboard that shows recent
  activity plus workout-volume and bodyweight trend graphs, renamed the native
  Stats tab to Analytics with clearer tracked-lift terminology, added distinct
  Help and About surfaces under More, shipped native logo/wordmark header
  branding with an alpha version badge sourced from `mobile/package.json`, and
  aligned the repo docs with the updated native UI surface.

## 0.11.3 - 2026-05-17

- Issue #61: Added the first documented iOS EAS build path for the real
  `mobile/` Expo app, including checked-in simulator and internal-device
  profiles, the required iOS bundle identifier, explicit iPhone/iPad install
  and update steps, and the remaining Apple account, UDID, Developer Mode, and
  simulator-platform blockers.

## 0.11.2 - 2026-05-17

- Issue #60: Reconciled the top-level README with the living current-state
  doc so repo-facing docs consistently describe `mobile/` as the active app
  path, the browser prototype as the legacy reference path, and Expo EAS
  Android packaging as the documented native build flow.

## 0.11.1 - 2026-05-17

- Issue #59: Replaced the native Expo app's default placeholder launcher,
  adaptive-icon, splash, and favicon assets with shipped Kilo-branded PNG
  assets, and aligned the Android adaptive-icon and splash background colors to
  the branded native identity.

## 0.11.0 - 2026-05-17

- Issue #55: Replaced the native Stats summary grid with a minimal analytics
  surface that combines tracked-lift estimated PRs, 1k progress,
  progression/repeatability signals, weight-trend cards, and shared
  workout-session refresh behavior in the Expo app.

## 0.10.0 - 2026-05-16

- Issue #54: Added local native progression-over-time and repeatability
  signals for tracked exercises, comparing the latest comparable weighted
  result against the prior comparable result while preserving separate
  estimated-PR math and covering mixed weighted or rep-only history cases in
  the parser suite.

## 0.9.0 - 2026-05-16

- Issue #57: Added local native 1k-total derivation from the user-selected
  bench, squat, and deadlift estimated PRs, including immediate recompute
  behavior when note content or tracked-lift selection changes and focused
  parser-suite coverage for mixed-weight and multi-day note cases.

## 0.8.0 - 2026-05-16

- Issue #52: Added native 7-day and 30-day derived weight averages plus fast
  gain/loss pace flags on the Weight and Stats screens, and covered the local
  calendar-date boundary behavior for those trend calculations in mobile
  storage tests.

## 0.7.1 - 2026-05-16

- Issue #58: Added the minimum Expo EAS Android build configuration for the
  real `mobile/` app, documented the standalone APK build/install flow, and
  clarified the one-time project-linking step needed to commit the EAS
  `projectId` for reproducible builds.

## 0.7.0 - 2026-05-16

- Issue #56: Added parsed-exercise tracking controls to the native workout-note
  read view, persisted tracked exercise selections on the canonical note
  document, and expanded native storage coverage for tracked-exercise
  persistence.

## 0.6.0 - 2026-05-16

- Issue #50: Added a formatted read/edit workout-note flow in the native Log
  screen, including a faithful rendered mirror of the canonical note,
  mixed-weight row display, and attempt-scoped save handling that only exits
  edit mode after a successful workout-note save.

## 0.5.0 - 2026-05-16

- Issue #51: Added native weight-entry correction flows so saved weigh-ins can
  be reopened from history, edited or deleted in place, validated inline, and
  reflected immediately across shared native weight views.

## 0.4.0 - 2026-05-16

- Issue #49: Replaced the native Log screen's rigid workout title and session
  detail form with a single freeform workout-note editor, and rewired the app
  shell to save the workout tab through canonical workout-note persistence
  instead of structured workout sessions.

## 0.3.3 - 2026-05-16

- Issue #53: Added a native tracked-exercise estimated-PR engine that computes
  Epley values per parseable set, surfaces the best current estimate per
  tracked exercise, and deduplicates default and caller-supplied tracked names
  before emitting analytics rows.

## 0.3.2 - 2026-05-16

- Issue #48: Added a native derived workout analytics contract on top of
  parsed workout notes, including per-exercise rollups, grouped-row
  preservation, stable occurrence linkage for set-level PR inputs, and
  retention of non-weight `unparsed_rows` for later note-based UI and
  analytics work.

## 0.3.1 - 2026-05-16

- Issue #47: Added tolerant native parsing for sample-style workout-note
  shorthand, including day and section headings, mixed-weight set rows, deload
  summaries, and graceful degradation for ambiguous or non-weight note
  fragments without failing the canonical note parse.

## 0.3.0 - 2026-05-15

- Issue #46: Added native AsyncStorage support for one canonical workout
  routine note, including save/load/overwrite/clear behavior, a one-time
  migration bridge from legacy structured workout sessions, and expanded mobile
  storage coverage for the workout-note path.

## 0.2.7 - 2026-05-15

- Issue #17: Closed the legacy MVP acceptance review after the repo-readiness
  stack was completed and the final launch hold was cleared by user-confirmed
  on-phone verification. Updated current-state readiness status to reflect the
  completed review.

## 0.2.6 - 2026-05-15

- Issue #45: Added automated Log screen UI coverage for the duplicate-session continuity banner and the save-success state actions, without changing duplicate logging behavior.

## 0.2.5 - 2026-05-15

- Issue #44: Removed the Home screen's recent-history delete affordances for workout and weight rows so Home stays a display-only summary surface while Stats continues to own history deletion.

## 0.2.4 - 2026-05-15

- Issue #43: Fixed the native Expo app's first-tap reliability by making weight and workout saves register with the keyboard open, preventing duplicate in-flight saves, and keeping the tab bar reachable above the iOS keyboard without changing completed-tap semantics.

## 0.2.3 - 2026-05-14

- Issue #40: Replaced native browser confirm, prompt, and alert flows on Home, Stats, and Weight with app-native inline delete confirmation and inline weight editing errors while preserving the underlying correction actions.

## 0.2.2 - 2026-05-14

- Issue #41: Added a duplicate-session informational banner on the Log screen when today's split was already logged, and expanded the save-success state to offer both `View Stats` and `Back to Home`.

## 0.2.1 - 2026-05-14

- Issue #39: Moved the Log screen's primary save control into the header so it stays reachable without footer scrolling, while keeping footer summary stats in place and rendering generic save failures near the header action.

## 0.1.3 - 2026-05-10

- Issue #35: Declared `mobile/` the active native-app path, documented the migration boundary versus the legacy prototype-wrapper path, defined the first native MVP milestone, and split first implementation ownership between UI migration and parser/storage migration.

## 0.2.0 - 2026-05-13

- Issue #36: Ported the MVP UI shell into the real native Expo app path under `mobile/`, adding native Home, Log, Weight, and Stats screens plus shared native components, and updated the living docs to reflect the active native UI path and remaining parser/storage gap.

## 0.1.2 - 2026-05-10

- Issue #30: Added `cap:run` and `preview` npm scripts for a repeatable device sync and relaunch loop. Documented the full rebuild → sync → run workflow in `docs/testing-and-qa.md`.
- Issue #32: Replaced the browser-centric manual smoke flow with a concise physical-phone checklist for the installable preview, including a concrete on-device update/redeploy step alongside install, update/relaunch, loading behavior, and basic touch interaction.

## 0.1.1 - 2026-05-10

- Issue #28: Replaced the plain `Kilo` text treatment with the approved Direction 3 brand lockup in the app header and More screen footer, and added shipped brand assets for the prototype UI.
- Issue #31: Added `npm run build` script that stages `Kilo.html` and `src/` into `www/` for Capacitor packaging. Added `.gitignore` to exclude `www/` and `node_modules/`.
- Issue #29: Initialized Capacitor with Android as the single native target. Added `capacitor.config.json` (appId `com.benpronin.kilo`, webDir `www`), generated `android/` project directory, and added `cap:sync` and `cap:open` npm scripts.

## 0.1.0 - 2026-05-10

- Issue #25: Established the initial documented MVP baseline, added canonical repo versioning in `package.json`, and defined lightweight pre-1.0 versioning and changelog rules in `AGENTS.md`.
- Issue #26: Refactored the More screen footer to render the app version from a new runtime global seeded in `src/data.jsx`.

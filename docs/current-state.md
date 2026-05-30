# Current State

This document is the single source of truth for what Kilo currently is, what is
implemented for MVP, what remains uncertain, and what manual validation status
has been reached for the current launch-review path.

---

## What Kilo Is Right Now

Kilo is a single-path native app:

- `mobile/` is the active Expo/React Native app with local-only persistence via
  AsyncStorage-backed modules under `mobile/storage/`.
- The legacy browser prototype (`Kilo.html`, `src/`, `tests/`) is archived under
  `docs/archive/browser-prototype/`. The Capacitor Android shell and vitest
  config have been removed (issue #213).

There is still no server, no backend, and no Supabase connection.

Roadmap status:

- MVP4.0 through MVP4.5 are complete roadmap passes. Their roadmap documents
  are archived under `docs/archive/`.
- The MVP-Refine pass (`docs/mvp-refine-roadmap.md`) ran after MVP4.5 and is
  also complete. There is no currently active follow-up planning pass.
- `docs/mvp-v4.5-roadmap.md` tracks the cumulative state of the app through
  the end of the MVP4.5 pass and remains as a reference document.

The prototype is a seeded fitness-logging app with approximately 221 synthetic
workout sessions and bodyweight entries used as history scaffolding. User-created
entries are layered on top of this seed through the app's local persistence
path.

The native Expo app exposes five tabs: Home, Log, Weight, Analytics, and More.

For physical-device packaging:
   - `cd mobile`
   - `eas build --platform android --profile preview`
   - Install the resulting APK on the phone
   - After a compatible Android build is installed, publish OTA-safe JS and
     asset updates with `npm --prefix mobile run publish:android:preview --
     --message "describe the change"`
   - The runtime boundary is enforced via `runtimeVersion.policy: "appVersion"`
     (runtime version = `version` in `app.json`). OTA updates apply to any
     installed build with the same version. A new Android build is required
     when: a native module changes, a native `app.json` field changes, the
     `version` is bumped, or any APK built under the old `"fingerprint"` policy
     is still installed (those builds carry a fingerprint hash runtime version
     and will never receive `appVersion`-keyed OTA updates — install a fresh
     APK first).

The shipped prototype branding now uses the approved Direction 3 Kilo mark and
wordmark treatment in the main Home header and the More screen footer instead of
plain text-only product naming. The native Expo path now uses a quieter shared
header treatment: no-title screens render a plain `Kilo` text title with a
low-emphasis `vX.Y.Z` version label derived from `mobile/package.json`, rather
than shared logo/wordmark header branding or an alpha badge.

The native app path is not yet a feature-complete port. It now proves that Kilo
can run as a real React Native app with native screens, native parser/data
modules, and local persistence instead of a WebView wrapper. The two app paths
still differ in surface area, but their active parsing and derived-analytics
rules now come from the same shared domain logic.

---

## Native Migration Contract

Issue #35 establishes the migration boundary from prototype-wrapper to native
app:

- `mobile/` is the only path that should receive forward-looking app
  architecture work.
- The former repo-root browser prototype has been archived under
  `docs/archive/browser-prototype/` and is no longer part of the active app
  runtime or test path.
- No new product behavior should depend on embedding the prototype inside the
  native app.
- The first implementation split is:
  - UI migration in issue #36
  - Parser and local data-model migration in issue #37

The current `mobile/` scaffold is intentionally narrow. It is a branch-off base
for implementation agents, not a claim that the native MVP is already complete.

## First Native MVP Milestone

The first native MVP milestone is reached when all of the following are true in
`mobile/`:

1. The app has real native Home, Log, Weight, Analytics, and More surfaces.
2. Weight entries can be created locally, stored locally, and shown again in a
   recent-history view.
3. Workout entries can be created locally, stored locally, and shown again in a
   recent-history view.
4. Parser and storage code used by the MVP loop live in `mobile/`, not in the
   legacy browser-runtime path.
5. The native UI consumes parser/storage behavior through explicit local module
   boundaries instead of screen-local ad hoc state.

This milestone does not require Supabase, sync, account work, or deletion of the
legacy prototype path.

---

## MVP Surface — What Is Implemented

### Native UI shell (`mobile/`)

The real native app path now has a modular React Native shell:

- `mobile/App.js` owns tab state, routes weight saves through the canonical
  parser path, routes workout saves through the current-workout path in the
  multi-note workout store, now keeps Android hardware-back inside the app by returning
  non-Home tabs to Home and gating root exit behind confirmation, keeps the
  Kilo fatigue multiplier in app state for deterministic Analytics
  recomputation, and exposes a separate More tab for Help, About, local Data &
  Backup export/import/recovery, and a low-prominence Settings & Algorithm
  sub-screen
- `mobile/screens/HomeScreen.js` renders a native dashboard with a resolution-
  independent Kilo wordmark header drawn as an inline `react-native-svg`
  component (`KiloWordmark`, sourced from `src/assets/brand/home-title.svg`)
  and sentence-case `Current routine progress.` subtitle. The screen uses a
  three-panel hierarchy: a Weekly Summary hero card, a conditional Weight Goal
  card, and a 1K Club Progress card. The hero card contains an inline week
  label, a dominant 48px latest-weight value (the only accent-colored text
  element on the screen besides the wordmark), a full-width 7-day sparkline
  strip, a three-column classification band with semantic color dots
  (green/yellow/red) for live `Progressing`, `Steady`, and `Regressing`
  overload counts mirrored from the current Analytics row contract, and a
  quiet `Full history and insights` link into Analytics. The Weight Goal card
  renders only when a goal is set
  (`dashboardData.goalInfo !== null`) and shows direction, weeks remaining,
  target weight, and required pace. The 1K Club card uses a centered total,
  progress bar, and three-column breakdown with full exercise names
  (Squats/Bench/Deadlifts) matching the canonical structure on Analytics. All
  dashboard data comes from existing shared derivation functions; no Home-only
  calculations exist. The success toast is removed from the render
- `mobile/screens/LogScreen.js` renders a native workout-note authoring flow
  centered on the selected current routine, with read/edit modes, a formatted
  mirror of the canonical note that always renders day/section/exercise blocks
  faithful to the raw text while collapsing same-day warmup and lifting
  sections under one weekday heading, parsed exercise tracking toggles in read
  mode that now persist a global tracked-lift map keyed by normalized
  exercise name, inline `—` skip markers for bare `-` lines, the current
  routine rendered as a title-first card whose header row toggles a persisted
  collapsed/expanded state (`kilo_log_current_collapsed`, surviving tab
  navigation and app restarts) with a small muted `Double-tap to edit` helper
  line at the top of the expanded current-note body, an explicit `Edit`
  button in the current routine card header row (using the same
  `inlineSwitchButton` style as the `Set Current` button on other routine
  cards), and a double-tap on the rendered note body as an alternative
  edit affordance, where
  the rendered body remains scroll-first and supports partial text selection,
  and where entering raw edit from a scrolled rendered note keeps the editor
  aligned to that same approximate scroll position. Explicit `Save` actions
  persist raw-note edits
  directly through the current workout-note store, keep the editor open, and
  show a transient `Saved!` button confirmation, exit prompts so leaving an
  editor with unsaved changes via `Done` or Android back asks to discard a
  never-saved note or to save/discard an existing note, and for the current
  routine specifically exiting raw edit now returns consistently to the top of
  the rendered note as the accepted fallback behavior, a bottom `More Routines`
  list that keeps each non-current routine collapsed to a compact row that can
  either reopen its raw-note editor or mark that routine current through an
  inline action, plus routine create/rename/delete controls with confirmation
  and current-selection cleanup guardrails; switching the current workout now
  requires explicit confirmation, and offers a save-and-switch or
  switch-anyway choice when there are unsaved edits. The read view now also
  routes parsed `SetLine` rows plus fallback unparsed/skip rows through one
  shared set-row typography token so Log-tab rows render at a uniform size
  without the earlier stray italics, while unresolved lifting fallbacks render
  in error red and warmup/non-lifting fallbacks stay standard text. The same
  save path now also persists workout-note `skip_markers`
  (`exercise_skips` plus `day_skips`) and derived `attendance_flags`, so
  downstream analytics consumers read stored skip/attendance state instead of
  recomputing it during render. That same save path now also persists
  per-session `rep_drop_off_flags` for tracked exercises, while the read view
  surfaces the latest `hit_wall` nudge inline and treats dismissals as
  ephemeral local UI state, so the nudge disappears for the current render but
  can re-fire on a later save when the persisted flag still exists; Android
  back now exits edit subviews before falling through to tab-level navigation.
  A fresh install with no
  logged routines now renders a dedicated `LogEmptyState` surface — short
  explanatory copy, a `New Routine` primary action, and an example-format card
  — instead of auto-opening the editor or keyboard, and that empty state is
  gated on the workout-note load so existing users do not see it flash before
  their routine appears
- `mobile/screens/WeightScreen.js` renders native weight/note inputs plus
  direct history edit/delete controls for saved weight entries, including a
  denser history row treatment with per-entry delta badges for notable
  (`> 1.5 lb`), spike (`> 2.3 lb`), and outlier (`> 3.5 lb`) changes, MM-DD-YYYY
  display dates for visible weight-history rows while stored timestamps remain
  ISO, and a prominent top-level goal card with a native target-date picker,
  MM-DD-YYYY visible goal-date formatting, `Target` and `By Date` as the
  primary anchors, and row-based derived guidance for `Target pace` plus
  advisory calorie guidance alongside warnings; when a complete stored user
  profile exists (`height_cm`, `date_of_birth`, `sex`, `activity_level`), the
  calorie row now shows an approximate TDEE-anchored daily target using the
  Mifflin-St Jeor BMR formula and activity multipliers, including maintenance
  targets. Without a complete profile, it falls back to the legacy estimated
  deficit/surplus helper. Maintain-goal fallback cases still render semantic
  maintenance guidance instead of gain/loss math, the no-estimate state keeps
  the panel hierarchy visible with neutral fallback messaging, and when no
  saved weight entries exist the goal form still requires a current-weight
  fallback so the pace and calorie guidance can render from the saved goal
  state. The Weight tab now reads top-to-bottom as
  weight entry, `Goals`, `Trends`, and `History`, with `Goals` / `Trends`
  using the shared section-heading treatment and a merged Trends card that
  now consumes the same canonical `deriveWeightGoalAnalytics()` output used by
  Home and Analytics for trend summary, pace severity, goal guidance, and
  calorie guidance, and
  surfaces `Pace`, `7-day rolling`, and `30-day rolling` rows with
  current-or-average value, prior-window comparison, and trend cue summaries
  derived from the day-level `date` key while History continues to display the
  recorded `logged_at` timestamp
- `mobile/screens/MoreScreen.js` now owns the native More menu plus the
  `User Profile`, `Data & Backup`, `Settings & Algorithm`, `Help`, and
  `About` sub-screens extracted out of `HomeScreen.js`. Those More subviews
  intercept Android back presses and return to the More menu before falling
  through to tab-level navigation, and the Settings & Algorithm screen
  exposes a persisted fatigue-multiplier stepper plus reset control. The
  `User Profile` sub-screen lets users optionally save or later clear the
  four TDEE-profile inputs stored by the shared user-profile contract:
  height with ft/in or cm entry mapped to persisted `height_cm`, date of
  birth, biological sex, and one of five activity-level choices with helper
  descriptions. The flow stays local-only, allows partial profiles, and
  surfaces explicit save feedback plus clear-state controls rather than
  forcing onboarding or a fully populated profile
- `mobile/screens/AnalyticsScreen.js` now renders a native analytics surface with
  a compact weight-trends card that highlights the latest weigh-in, corrected
  pace warning, embedded 7-day rolling-average chart, and 7-day/30-day
  summary averages, alongside a redesigned `1K Progress` card (hero total,
  progress bar, full breakdown labels: Squats/Bench/Deadlifts) in an
  artisanal-panel container, strength-only 1k slot selection, and a
  `Progressive Overload` section with routine-day grouping, collapsible
  group headers, search filtering, and a tabular two-line row layout
  (exercise name + 4-column metric grid: `1RM`, `Kilo`, `Best`, `Trend`).
  Non-weighted exercises (reps-only or time-based) render with a minimal
  sub-layout showing `Avg` and `Best` metrics (average reps/hold per set
  and highest single-set value) with inline labels, plus a PO arrow
  trending on average progression (`↔` steady, `↑`/`↓` improving/declining,
  `—` when fewer than two sessions are logged).
  Multi-day exercises appear in each relevant group and now render their row
  metrics from the matching per-day signal payload for that weekday slot
  (`latest_pr`, `latest_top_weight`, `overload_trend`, `is_bodyweight`) while
  the inline cross-day comparison chips summarize the other day-specific
  values. Trend arrows use MaterialIcons for up/down plus a text `↔` steady
  marker with semantic color mapping (`Colors.success`, `Colors.caution`,
  `Colors.error`), alias variants resolve through canonical exercise-name
  mapping, and plain note rows now count as separate comparable sessions for
  progression derivation. It now
  uses the shared `ScreenShell` component for a consistent layout and
  safe-area handling across all analytics sections. A dedicated `Activity`
  section now groups the tone-colored `Workout sessions` StatCard between
  Weight Trends and Strength so the session-count signal reads as a first-class
  Analytics section instead of a floating standalone card. Its
  weight summary card now reads the displayed latest weigh-in, pace flag, and
  rolling-series chart data from the same canonical
  `deriveWeightGoalAnalytics()` path used by Home and Weight, so backdated or
  out-of-order weight entries resolve consistently across all three native
  consumers.
  The list now keeps per-exercise session classifications persisted on note
  save (`Initial`, `Progressing`, `Stalled`, `Inconsistent`, `Regressing`),
  parses workout-note sections once per render path, routes visible lift
  signals plus exercise display casing through the shared
  `deriveWorkoutNoteAnalytics()` layer used by the broader workout analytics
  contract, surfaces estimated 1RM and Kilo max together,
  shows either latest top weight in pounds or best-set reps for bodyweight
  exercises, renders the trend column as `↑`, `↔`, `↓`, or `—` based on the
  latest comparable session pair, and now adds a subtle `⚠ Hit wall` /
  `↑ Reserve` badge when the latest live intra-session rep drop-off flag
  derived from the canonical workout sections exists for that tracked
  exercise, rather than trusting a potentially stale persisted badge value.
  Its mount-time entry state is now stabilized so Analytics no longer visibly
  flashes on entry, section loading placeholders stay scoped to the data each
  section actually needs, and incomplete weight rows are filtered before they
  reach the rolling-average path
- `mobile/components/` contains shared shell, tab bar, and UI primitives; the
  shared bottom tab bar now uses the lighter card/chip palette instead of the
  older heavy dark floating treatment so it reads as lower-emphasis chrome
  while keeping the active tab easy to distinguish, and it now behaves like a
  content-aware overlay by fading toward transparency during shared-shell
  scrolling, restoring a solid treatment during direct interaction, and then
  settling back after a short timeout
- `mobile/assets/brand/` contains the bundled native logo and wordmark assets
- `mobile/theme/colors.js` centralizes the native color system
- `mobile/lib/parser.js` ports the MVP canonical parser path into native ES
  modules and now also includes tolerant workout-note parsing for the archived
  sample-style shorthand logs used by the v2 note-based workflow plus a
  derived analytics contract for later note-based UI and analytics work,
  including tracked-exercise estimated-PR derivation from parsed sets,
  positional session-alignment derivation for long-note imports, stable
  same-day section headings so warmup and lifting blocks can render under one
  calendar-day heading in the Log view, and normalization for the recurring
  mixed-load shorthand, leading flag prefixes, and parseable inline-tail row
  segments evidenced in the archived workout-note samples. Progression and
  per-day signal derivation now share one comparable-building helper, and the
  module also exports `normalizeExerciseKey()` so alias resolution and
  lowercased key matching follow the same canonical chain everywhere
- `mobile/lib/data.js` defines the native exercise catalog and entry factories,
  including the default 1k exercise-slot selection used by analytics, a
  factory for titled workout-note items in the multi-note model, and
  per-session derivation for non-weighted tracked exercises covering
  reps-only (`total_reps` + arrow) and time-based (`longest_hold` + arrow)
  exercise classes with loaded-bodyweight exclusion
- `mobile/hooks/useEntries.js` exposes the native read/write APIs used by the
  UI, including multi-note current-workout reads/writes, cross-consumer
  refresh fanout, and persisted weight-goal reads/writes
- `mobile/storage/entries.js` persists weight entries plus a local-only
  multi-note workout model via AsyncStorage: `kilo_workout_notes` stores
  multiple titled workout notes, `kilo_current_workout_id` stores the explicit
  current selection, and persisted note items now carry an `isCurrent` flag
  alongside the retained `tracked_exercises`, `one_k_exercises`,
  `skip_markers`, `attendance_flags`, `exercise_classifications`,
  and per-session `rep_drop_off_flags` fields. It also
  persists a lightweight
  weight-goal record under `kilo_weight_goal` with `target_weight`,
  `target_date`, optional `start_weight`, and `saved_at`, plus a persisted
  Kilo fatigue multiplier under `kilo_fatigue_multiplier`, a global
  tracked-lift map under `kilo_tracked_lifts`, and the Log-tab
  current-routine collapsed state under `kilo_log_current_collapsed`. The
  legacy structured
  workout-session key is retained only as a one-time migration source, and the
  older
  single-note key is now also migrated forward into the notebook model by
  synthesizing a `Routine 1` current entry. The local Data & Backup recovery
  path now exports a versioned v2 snapshot (weight entries, workout notes,
  current workout id, optional weight goal, and optional fatigue multiplier),
  validates that payload before
  any write, restores the full multi-note model plus weight goal and fatigue
  multiplier on v2 import, and still accepts older v1 backups to restore
  weight history without wiping the newer workout-note state

This path is no longer UI-only. Weight saves run through `parseWeightEntry()`
before persistence, and the native Log flow now saves through the current item
in a local multi-note workout store instead of requiring a structured
title-and-detail workout entry form. Saved native weight entries, workout note
items, and the selected current workout all reload across app restarts through
the native hook/storage layer. The native app shell now owns the stable
top/bottom safe-area boundaries in `mobile/App.js`, with an Android-aware top
cap for the status bar/notch and an absolute bottom safe-area wrapper for the
tab bar, while `ScreenShell` standardizes the in-screen content padding and
header layout used across Home, Log, Weight, Analytics, and More/Help. Its
no-title header state now uses a plain text `Kilo` title plus a quiet
`vX.Y.Z` version label instead of the heavier logo/wordmark-and-badge
treatment. The
native Log and Weight flows now keep save actions responsive on the first tap
even with the keyboard visible, guard against duplicate in-flight saves, and
keep the bottom tab bar reachable above the iOS keyboard. Successful native
weight saves now keep the user on the Weight screen instead of bouncing them
back to Home. Android hardware-back now stays inside the native app flow:
non-Home tabs return to Home first, the More and Log screens pop their own
subviews before yielding, and the Home root shows an exit confirmation.
The native Weight screen now also lets the user reopen saved entries from a
denser scannable history list, correct them in place, delete mistakes from
inline row affordances, and immediately refresh the shared weight views after
AsyncStorage updates. Each saved row also surfaces the change versus the next
older weigh-in with visual severity cues for notable, spike, and outlier
movement. The native Log flow now also supports creating additional routine
notes, renaming existing routines, and deleting routines with confirmation
while clearing the persisted current-routine pointer when the active routine is
removed. It also now derives 7-day and 30-day rolling averages plus fast
gain/loss pace flags from saved entries, and shows that trend feedback on
both the Weight and Analytics screens with shared threshold bands: sub-`1.5 lb`
daily deltas stay unflagged, `1.5-2.2 lb` changes render as notable
yellow/amber warnings, and `>= 2.3 lb` changes render as red spike warnings.
The native Weight screen now also supports
a lightweight saved goal with target weight and target date, derives gain,
loss, or maintain direction plus required weekly pace from the latest saved
weight entry, surfaces unrealistic or unhealthy pace warnings as advisory-only
feedback rather than hard validation, and now stores an optional local user
profile for calorie guidance. When that profile is complete, the screen uses a
TDEE-anchored daily target; otherwise it falls back to the legacy estimated
deficit/surplus helper without introducing nutrition tracking or onboarding.
The v2 parser groundwork for one long workout note now exists alongside the
raw-note editor, a formatted read-mode mirror that preserves headings,
exercise blocks, mixed-weight rows, and unparsed history lines, and a stable
derived analytics input model so later PR, 1k, and repeatability work can
consume parsed note output without rebuilding the parser contract. It now also
includes a tracked-exercise estimated-PR engine that computes Epley values per
parseable set, keeps each tracked exercise's best current estimate, and
deduplicates tracked names before emitting analytics rows. It now also derives
the tracked 1k total locally from the user-selected bench, squat, and
deadlift exercises, persists those three slot choices on the canonical workout
note document, and resolves a conservative set of deterministic exercise-name
aliases so obvious note variants such as `DB Bench` still count toward the
intended lift without fuzzy matching. Progression-over-time and repeatability
signals compare the latest comparable weighted result against the prior
comparable result without changing the formal estimated-PR formula. The native
Home and Analytics tabs now derive workout activity consistently from the
currently selected workout note in the same multi-note store used by the Log
screen, and the Log flow now keeps the selected current routine in the full
parsed-workout view while rendering every non-current routine as a compact row
in the bottom `More Routines` list, where it can be reopened in a dedicated
raw-note editor or promoted directly to the current workout through an
explicit confirmation step that also preserves any pending draft before
switching. The local backup/import path
also now preserves multiple
titled workout notes plus the current-workout selection, and remains backward
compatible with older weight-only v1 backups. The native Home tab is
now a dashboard rather than a static blurb, with a responsive Kilo wordmark
header, `Current Routine Progress` subtitle copy, a single non-navigating
latest-weight summary card, a compact current-workout `1k Club Progress` card
whose total links into the Analytics Strength section, and a shared line-chart
view of the 7-day rolling-average weight trend whose scoped tap target links
into the Analytics Weight Trends section as the default landing view. The native Log read
view now also lets the user explicitly mark parsed exercises as tracked or not
tracked without editing note syntax, and that selection now persists globally
by normalized lift name so `Bench Press`, `bench press`, and ` Bench  Press `
map to the same tracked lift across app reloads. The read view always renders
the formatted note mirror (day heading, `+` subheading, `-` exercise block,
history rows) faithful to the raw text, with bare `-` lines shown as
unobtrusive inline skip markers; Home and Analytics derive the
workout/session count from the highest per-day session count in the current
workout note, so warmup and lifting sections under the same day heading count
as one session rather than splitting the day across separate section blocks.
The session count drives a color signifier on both screens: green (1–6
sessions), yellow/caution (7–9, approaching deload window), and red (≥ 10,
  at or past deload window), derived through a shared `getSessionTone` helper
  in UI.js. On Home the color applies to the "Week N" label text; on Analytics
  a dedicated `Activity` section contains the "Workout sessions" StatCard with
  the corresponding tone.
The native Analytics tab now consumes those
derived analytics directly, combining weight trends with tracked-lift
estimated-max values, Big Three 1RM progress, progression status, Kilo max,
latest top weight, and overload trend in one minimal analytics view while
keeping totals in sync with canonical workout-note refreshes. Those
tracked-lift cards now use the same reactive global tracked-lift state as the
Log screen, update immediately when Track is toggled while Analytics remains
mounted, stay visible only for tracked lifts that appear in the current
routine, and still aggregate each lift's full history across all saved
routines. A separate native
More tab now exposes Help and
About surfaces while keeping the parent More quick actions intact; the Help
surface now uses the shared top-safe-area header treatment, a local accessible
header back control, and a centered Kilo logo placed above the Help and
Terminology content only. About continues to surface attribution, displayed
version, copyright notice, and an OTA Diagnostics panel covering the EAS
channel, runtime version, current bundle (embedded vs. applied update),
update-available/pending state, and a manual update check.

### Parser (`mobile/lib/parser.js`)

The MVP canonical parse path is fully implemented and tested.

- `parseWeightEntry(raw)` — accepts `\d+(\.\d+)?` only; rejects unit suffixes,
  signs, commas, prose, zero, and negative values; defaults `weight_unit` to
  `'lb'`; supplies `logged_at` from context.
- `parseWorkoutRow(raw)` — accepts `-`, comma-separated rep-groups, and
  `load rep-group` pairs; rejects standalone integers, timed formats, prose, and
  slash notation; normalizes spaces around commas.
- `parseWorkoutEntry(items, workout_date)` — calls `parseWorkoutRow` per row;
  collects per-row errors; returns a canonical workout entry or a structural
  violation when no valid items remain.
- `parseWorkoutNote(noteText)` — parses multi-day shorthand workout notes into
  stable sections and exercise blocks, preserves parseable set rows plus
  positional session-entry slots for downstream analytics, and degrades
  ambiguous or non-weight note fragments into `unparsed_rows` instead of
  rejecting the note.
- `buildSessionsFromNote(noteText)` — aligns the `N`th positional `- ...`
  entry for each exercise into session `N`, ignores day and warmup/lifting
  boundaries for session construction, preserves bare `-` skips, and emits a
  warning when exercises have uneven positional entry counts. Retained for
  legacy-migration-format validation only; no product screen reads workout
  presentation or counts through it.
- `countWorkoutSessions(noteText)` — returns the workout/session count as the
  highest session count among day headings in the note, treating same-day
  warmup and lifting sections as one session bucket and returning `0` when no
  exercise has any parsed or explicit session history. Source of the Home and
  Analytics session counts.
- `deriveWorkoutAnalytics(sections)` — converts parsed note sections into a
  per-exercise analytics input contract with flattened sets, grouped rows,
  per-occurrence context, preserved `unparsed_rows`, per-set Epley estimates,
  and a best-set `estimated_pr` summary.
- `deriveTrackedPRs(sections, trackedNames)` — filters derived analytics down
  to one row per unique tracked exercise name, preserving caller order while
  surfacing each exercise's best current `estimated_pr` or `null` when absent.
- `derive1kTotal(sections, selections)` — sums the estimated PR values for the
  selected bench, squat, and deadlift exercises and returns `total: null`
  until all three tracked lifts are present in the note.
- `deriveProgressionSignals(sections, trackedNames)` — walks backward through
  tracked exercise occurrences to compare the latest comparable weighted result
  to the prior comparable result, returning improved, held, regressed, or
  first-session progression status plus latest-session estimated 1RM, all-time
  Kilo max, latest top weight, overload trend, and same-session top-weight
  `repeatability_score`. Exercises with no weighted sets fall back to a
  bodyweight path that compares session-level total reps and surfaces the best
  set reps in place of top weight.

A legacy freeform path (`parseKiloInput`, `formatParsed`, legacy helpers)
exists in the archived browser prototype for seeded-history compatibility. It is
not used on any active save path.

---

## What Issue #17 Validated

Issue #17 completed the legacy prototype MVP acceptance review and the final
launch hold was cleared by user-confirmed on-phone validation. This closeout
should not be mistaken for native-app readiness. The native migration contract
established in issue #35 creates a separate path of work before any native-app
launch claim would be credible.

Required readiness artifacts and their current status:

| Artifact | Status |
|---|---|
| `README.md` | Complete |
| `docs/current-state.md` | Complete |
| `docs/architecture.md` | Complete |
| `docs/testing-and-qa.md` | Complete |
| `docs/repo-structure.md` | Complete |

---

## Known Gaps That Affect Launch Confidence

### Native app path still has partial UI parity only

The `mobile/` Expo app now covers the native MVP create/store/retrieve loop for
weight and workout entries, but it still exposes a narrower UI than the
archived browser prototype. The native app has five tabs, its own note-first
Log flow rather than the prototype exercise-row form, and it still lacks full
parity for seeded history presentation and the prototype's live per-row parse
preview treatment.

### No automated tests for native app shell, workout logging, or correction flows

The following MVP behaviors have no automated test coverage:

- `mobile/App.js` five-tab shell routing, persistent tab mounting, and
  hardware-back behavior
- `mobile/screens/LogScreen.js` end-to-end save/error UI, raw-edit
  transitions, and the rendered parse-preview/logging loop
- `mobile/screens/WeightScreen.js` delete and edit correction flows
- `mobile/screens/HomeScreen.js` rendered weekly-summary contract from a saved
  workout note
- full Expo device/emulator runtime behavior and layout validation across the
  mounted tab set

These gaps mean the automated suite passing does not confirm that the workout
logging loop or correction flows work correctly. Manual smoke testing (per
`docs/testing-and-qa.md`) is required to cover these paths.

### No Supabase or backend

All persistence is local device storage via AsyncStorage in the native Expo
app. There is no Supabase connection, no authentication, no server, and no
network persistence. This is a known native-app constraint, not a regression.
The MVP roadmap (Phase 2) defines the Supabase schema and write-boundary
contract, but those have not been implemented or wired up.

Launch validation must treat AsyncStorage as the persistence layer. Any
evaluation of the app against the Supabase-based data model described in
`docs/mvp-roadmap.md` Phase 2 is premature.

### Legacy Capacitor shell removed

The Capacitor Android shell (`android/`, `capacitor.config.json`) and the
browser prototype build pipeline have been removed (issue #213). The native Expo
app under `mobile/` is the only device-packaging path.

### OTA update code signing is configured (not yet active on installed builds)

`mobile/app.json` is now configured for Expo OTA code signing via
`updates.codeSigningCertificate` and `updates.codeSigningMetadata`. The public
X.509 certificate is committed at `mobile/certs/certificate.crt`. The matching
private key is not in the repo; see `mobile/certs/KEYS.md` for storage
guidance and the signed-publish command.

**On-device enforcement requires a new native build.** The certificate is
embedded in the app binary at build time. Builds produced before this config
change do not contain the certificate and will not verify OTA signatures.
Once a binary built after this change is installed, `expo-updates` will reject
any OTA update whose manifest signature does not verify against the embedded
certificate. Published OTA updates must be signed via `--private-key-path`
passed to `eas update`.

### Native Expo app has standalone Android and iOS build paths

The `mobile/` Expo app now has checked-in EAS build profiles for both Android
and iOS output, plus the required platform identifiers (`android.package` and
`ios.bundleIdentifier` are both `com.benpronin.kilo`). That gives the native app
installable paths that do not depend on the developer machine staying on or
serving a local Expo session.

Android: the `preview` profile produces a plain `.apk` for sideloading.

iOS: two profiles are available:
- `ios-simulator` — builds a Simulator `.app` bundle; no Apple Developer account
  required.
- `ios-device` — builds an internal-distribution `.ipa` for direct real-device
  install via ad hoc provisioning; requires an Apple Developer Program membership
  and the target device UDID registered in the Apple Developer portal.

The one-time Expo account linking step still must write a real
`extra.eas.projectId` into `mobile/app.json`, and the repo documents that
contributors should commit that linked project ID once it exists.

The shipped native Android launcher, adaptive icon, splash icon, and web
favicon assets now use Kilo-branded PNG files instead of the default Expo
placeholder artwork.

**iOS device build blockers:** the `ios-device` profile uses internal
(ad hoc) distribution, which requires an Apple Developer account and the target
device UDID registered in the Apple Developer portal before the build starts. The
`ios-simulator` profile has no such requirement. See `docs/phone-runbook.md` for
the full iOS build command path and known blockers.

### Native UI runtime is not yet validated end-to-end

Issue #36 review approved the native UI structure, but the approval was based on
static inspection of the `mobile/**` diff. The Expo app has not yet been
validated end-to-end on a device or emulator as part of the issue closeout.

## Launch Prerequisite Checklist

These were the prerequisites for manual launch validation on issue #17.

**Docs**
- [x] `README.md` explains where the app lives, how to start it, and which docs
      matter for launch review
- [x] `docs/current-state.md` exists and is internally consistent with the other
      docs (this document)
- [x] `docs/architecture.md` is current and accurate
- [x] `docs/testing-and-qa.md` is current and accurate
- [x] `docs/repo-structure.md` exists and maps MVP-relevant repo areas

**Automated tests**
- [x] `npm --prefix mobile test` passes with zero failures

**Manual smoke test**
- [x] Final launch-signoff validation was completed for issue #17 with
      user-confirmed on-phone verification before closeout

**Known non-blockers for launch** (acceptable prototype limitations)
- PT checklist items are toggle-only; not persisted across reloads
- Stats screen is read-only and has no correction flows
- Seeded entries cannot be corrected via the product UI
- Home quick-log is not manually reachable in the seeded prototype state (covered
  by automated tests)
- Supabase is not wired up; AsyncStorage is the persistence layer for MVP validation

## Ownership Split For Native Migration

Issue #35 fixes the first implementation ownership split as follows:

- Issue #36 (`agent:gemini`): native screen structure, navigation, reusable UI
  components, and MVP surface composition in `mobile/`
- Issue #37 (`agent:claude`): completed parser port, entry model, local
  persistence, recent-history retrieval, and native-side data access boundaries
  in `mobile/`

Codex stays responsible for contract definition, sequencing, and review rather
than owning the implementation slices directly.

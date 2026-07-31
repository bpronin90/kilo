# Testing And QA

## Native Expo Workflow

Start the Expo app:

```sh
npm run mobile:start
```

Open the QR code in Expo Go, or launch Android directly:

```sh
npm run mobile:android
```

For a standalone installable Android APK that does not depend on a running dev
machine, use the EAS build flow documented in `docs/phone-runbook.md`.
For Play Store closed-testing participants, use `docs/tester-guide.md`; it is
the plain-language quick start for joining, installing, testing, and reporting
feedback during the required 14-day window.
Play production readiness is tracked in `docs/play-store-readiness.md`.

For release-style update verification after a compatible build is installed,
publish to the configured EAS Update channels from `mobile/`:

```sh
npm --prefix mobile run update:android:preview
npm --prefix mobile run update:ios:preview
npm --prefix mobile run build:android:production
npm --prefix mobile run update:android:production
```

iOS preview builds (`ios-simulator`, `ios-device`) are bound to the same
`preview` channel. Live on-device iOS delivery is not yet verified end to end
(deferred pending an iOS build, issue #63).

Use OTA publish only for JavaScript and asset changes. Any native-affecting
change still requires a fresh Android build. Preview builds use a stable manual
runtime string (`preview-4`) in `mobile/app.config.js`; app version bumps alone
do not force a rebuild. Bump `PREVIEW_RUNTIME` in the same PR as any new or
updated native module, Expo SDK/native dependency, or native config/plugin
change; older preview binaries must then be replaced with a fresh APK.

Production Android builds use the EAS `production` profile and create a Play
Store AAB. Before Play upload, verify that an actual production build exists in
EAS; as of issue #431 checks on 2026-07-06, no Android production build exists
yet even though the profile resolves.

Issue #434 adds native-runtime-affecting Sentry crash/error reporting for
production builds. Before the production AAB intended for Play closed testing
is built, set these env vars in the build environment:

- `EXPO_PUBLIC_SENTRY_DSN`: public client DSN used at runtime to send crash and serious JS error events.
- `SENTRY_ORG`: Sentry organization slug for the Expo build plugin.
- `SENTRY_PROJECT`: Sentry project slug for the Expo build plugin.
- `SENTRY_AUTH_TOKEN`: sensitive build-time token for source-map upload.

The Expo Sentry config plugin is enabled only when all four values are present.
This avoids partial native-build changes when the source-map upload credential is
missing.

The integration is intentionally narrow: no replay, tracing, logs, or default
PII capture are enabled, and app code should not attach workout note contents,
weight entries, auth tokens, or other sensitive payloads to events.

Current limitation:

- Native parser and storage modules now have Jest coverage under `mobile/tests/`,
  including tracked-exercise persistence on the canonical workout note, a
  focused note-first Log workflow suite pinning raw note save, edit-through-
  upsert persistence, and parser-derived display from stored raw text, and a
  fixture-driven migration contract suite for legacy structured workout
  history, plus weight-goal persistence/derivation coverage, explicit
  weight-pace threshold boundary coverage, canonical goal current-weight
  resolution coverage (latest-entry ordering plus no-entry fallback paths),
  shared weight trend-summary helper coverage, direct
  `deriveWeightGoalAnalytics()` canonical contract coverage for empty/null
  entries, saved-goal/edit-state paths, rolling-series limits, and maintain
  handling, per-session rep-drop-off flag derivation coverage, standard 45 lb
  barbell plate-loading coverage for exact loads, unloadable remainders,
  sub-bar weights, decimals, custom bar values, invalid inputs, and display
  formatting,
  fatigue session check-in detection coverage (`deriveSessionCheckIn` detectors
  plus `deriveCheckInHistory` list/summary shaping), within-row skipped-set
  parser coverage, `session_checkins` storage round-trip coverage,
  weekly-summary stored-input shaping coverage (session presence and persisted
  classification counts), plain-row progression comparables for note-based
  sessions, lowercase canonical `perDaySignals` key coverage, and malformed
  backup rejection coverage for the optional `weight_goal` v2
  import field, plus unit-display helper coverage for lb/kg round trips,
  display rounding boundaries, bodyweight entry conversion back to canonical lb,
  and profile-backed unit-preference hydration.
- Native rendered-screen coverage is still narrow, but `mobile/tests/` now
  includes a `log-screen.test.js` parser-and-render-logic suite covering
  skip-marker interleaving and bare-unparsed-row chronological positioning for
  the workout-note clean view, week-level `Skip week` dash insertion for only
  exercises with existing session entries including untracked accessory
  exercises, repeated skip stacking, guarded removal of universal versus
  manual trailing skips, atomic fatigue-check-in cleanup, universal-skip
  counter lifecycle and failed-clamp retry behavior, and the save-success gate
  before fatigue check-in detection, plus source-contract coverage that pins the
  Log autosave regression boundary by asserting both debounce timers pass
  `{ autosave: true }` and both save handlers guard the visible `Saved!`
  notice behind `!autosave`, plus the past-deload save-path regression boundary
  by asserting the non-current note editor reuses one in-flight save promise
  during `Done` flushes and clears that pending state in `finally`, plus a
  behavioral boundary that drives the real editor hook to prove `Done` flushes
  the latest editor text, and linked-deload date/Session # metadata, when it
  races an in-flight autosave so no field is lost, and retains the editor when
  that flush save fails (#528), plus a
  `react-test-renderer` suite for the Weight goal card's loss,
  gain, maintain, no-estimate, and pace-warning states, plus merged Trends
  rendering checks that lock the day-level `date` trend bucketing contract
  while confirming Weight history still displays `logged_at`, plus a
  `AnalyticsScreen` consumer-drift regression that spies on
  `deriveWeightGoalAnalytics()` to prove the rendered latest weight and
  7-day/30-day averages come from the shared layer instead of screen-local
  reshaping, targeted Analytics feature-toggle gating coverage that hides the
  Fatigue and Session Health sections when their settings are off, targeted
  two-metric Session Health coverage for explicit `sessions since deload` and
  `weeks since deload` labels plus legacy deload-history rendering, regression
  coverage proving deload dates do not move the Analytics session-count anchor,
  plus a source-contract regression asserting the past-deload
  `DateTimePicker` uses the native `onChange` callback instead of the
  non-functional `onValueChange` prop,
  targeted
  `AnalyticsScreen` Fatigue-section interaction coverage for the
  collapsed-by-default summary, the expand/collapse toggle cycle, the
  post-expansion rough-row and ok/pending chip edit affordances, and the
  unanswered-check-in alert badge, plus focused `SessionCheckInModal`
  rendered-handler coverage proving backdrop taps and Android `onRequestClose`
  defer without storage writes while the explicit close control writes a
  `session_checkins` entry, and targeted `WeightScreen` interaction
  coverage for history-row scroll-to-editor behavior, edit/date threading
  through the existing update seam, delete confirmation/refresh behavior, the
  saved-goal target/guidance split, and the active weigh-in/goal
  `DateTimePicker` `onChange` callback wiring, plus the unified Goal
  History/Weight History panel header, collapsed-summary, column-style, and
  date-filter reveal contracts, plus web fallback coverage for
  Weight DOM date inputs, plus targeted account lifecycle UI coverage for
  server-owned export/delete calls, local session clearing after successful
  deletion, function error surfacing, and absence of service-role keys in
  client fetch headers, plus Account/cloud-sync status coverage for clean,
  dirty, failed, and signed-out local-only states with the last-successful-sync
  timestamp and dirty-queue indicator. The same `log-screen.test.js` suite now also
  includes `react-test-renderer` coverage for the rendered App Guide workout
  example, the aligned Log editor placeholder, current-note Undo, saved-note
  Undo, and failure-path handling around note-scoped Undo for editable deload
  records, plus source-contract coverage for the explicit single-press Log edit
  path and Log deload-date web fallback. `mobile/App.js` app-shell coverage now
  covers initial tab visibility, tab switching through the shared `TabBar`
  contract, Android hardware-back behavior from Home and non-Home tabs, and the
  web-only Home back affordance. Reminder coverage now pins local scheduling
  decisions, weekday inference/fallback behavior, permission-denial handling,
  cancel-on-disable reconciliation, settings persistence, and the ambiguous
  routine fallback UI path for selecting weekdays before enabling a workout-day
  nudge. Full transactional undo guarantees across
  linked records are still deferred until a DB-backed persistence layer exists.
- Unit-display rendered coverage now verifies kg rendering for shared set rows,
  Weight History values/deltas, Settings selector persistence/disabled loading
  behavior, and Analytics selected kg chart-point one-decimal formatting.
- No automated native test covers an Expo device/emulator pass yet, so local
  notification receipt and cancellation still need a physical-device or
  emulator check for release validation.
- Android GitHub OAuth has rendered regression coverage for button visibility,
  browser success/cancellation/provider errors, PKCE code exchange, missing
  callback data, and session-exchange failures. The custom
  `kilo://auth/callback` return and restart persistence still require an
  installed development/preview build; Expo Go is not sufficient. Because the
  OAuth implementation adds `expo-web-browser` and a native URL scheme, the
  first release containing it requires a fresh APK/AAB rather than OTA-only
  delivery.
- Password recovery has hook and rendered regression coverage for explicit base
  redirects, `PASSWORD_RECOVERY` sessions, native cold/warm callbacks, web
  pending/error discrimination, automatic More > Account routing, password
  update/validation failures, and unchanged sign-in/signup/GitHub actions. A
  real-device email-link round trip remains a release-validation requirement.
- No automated native test yet verifies the rendered Home `Weekly Summary`
  surface end to end from a saved workout note. The current suite covers the
  underlying helper behavior and persisted field shaping, but not the rendered
  Home panel contract.
- The current native workout form is narrower than the archived browser
  prototype UI even though the native save/reload loop now persists canonical
  entries locally.

---

## Running Automated Tests

Install dependencies (first time only):

```sh
npm install
npm --prefix mobile install
```

Run the active native test suite:

```sh
npm --prefix mobile test
```

GitHub Actions runs this same mobile Jest suite with Node 24 and a reproducible
`npm ci` install on every pull request and every push to `main` via
`.github/workflows/test.yml`. The required job also exports and serves the Expo
web build as a production-style bundle smoke check.

Every PR additionally requires the `review disposition accepted` status for
its exact current head SHA. The trusted evaluator in
`scripts/review-disposition.mjs` reads current-head implementation metadata and
the newest valid independent review or owner-override record. Missing
current-head implementation metadata, or the absence of any exact-head review,
fails the check with an actionable status rather than leaving it pending
indefinitely.

As a narrow exception, an ordinary exact-head approval is carried forward
across a verified closeout refresh. When the current head is a two-parent merge
of a previously approved head and the current base, and the refresh is
object-identical to the reviewed change — namespace-disjoint paths, an unchanged
raw object delta, and a tree equal to the reproducible conflict-free Git merge —
the evaluator preserves the prior approval, so an already-approved, disjoint PR
does not need re-review solely because another PR merged first. The carried
approval is bound to the same implementation execution as the reviewed head;
chained refreshes, changed deltas, path overlap, manufactured trees, or a
missing ordinary approval all fail closed. Exact-head review, owner override,
self-review rejection, and branch-protection enforcement are unaffected.

Review disposition is independent from CI: an
override cannot satisfy a pending or failed test, audit, version, or migration
check. Dependabot PRs derive their implementation execution from the bot and
current head, but still require an accepted review disposition before their
guarded auto-merge can complete. The evaluator's deterministic parser and
refresh-verification tests run with:

```sh
node --test scripts/review-disposition.test.mjs
```

GitHub Actions also runs the migration drift check via
`.github/workflows/migration-drift.yml`, and it is a **required pre-merge
status check on `main`** (job `merged migrations are applied to the live
project`): it runs credentialed on every push to `main` and on every pull
request from this same repository, not only after merge. #490 reached
production because the only credentialed run used to happen after merge; the
pre-merge run is the fix. The check uses the least-privilege
`SUPABASE_MIGRATION_CHECK_URL` repository secret to compare migrations in
`supabase/migrations/` with the live `supabase_migrations.schema_migrations`
ledger. A live row must prove Kilo identity through an exact `(version, name)`
pair or prove ownership through same-name SQL qualified to Kilo's owned `kilo`
schema. Bare name membership is insufficient, so a same-name co-tenant row
cannot hide a missing Kilo migration.

Fork pull requests cannot receive that secret (GitHub withholds repository
secrets from a `pull_request` run whose head repo differs from this one), so a
separate, non-required job (`migration-drift-fork`) runs the same script with
no credentials and reports the honest result: exit 2, "unable to check" — never
exit 0, "no drift". A maintainer applies the credentialed check to a fork PR's
changes locally, or relies on the required push-to-main run, before it reaches
production. The post-merge push-to-main run remains as defense in depth, not
the first detection point.

Run the same check locally with either:

```sh
# explicit export — always takes precedence over a local .env file
SUPABASE_MIGRATION_CHECK_URL=postgresql://... npm run check:migrations

# or create a .env file (gitignored) in the repo root:
#   SUPABASE_MIGRATION_CHECK_URL=postgresql://...
npm run check:migrations
```

The URL must use the session pooler and the read-only `migration_check` role.
Missing repo migrations fail the check; extra live migrations are allowed
because the Supabase project is shared with another app. Missing credentials or
database connection failures also fail rather than reporting a false pass.

`scripts/check-migration-drift.mjs` has a deterministic self-test harness that
exercises env-loading precedence, ownership-aware exact-collision/unrelated-
extra/missing/complete ledger fixtures, and the exit-code contract (0/1/2)
against a stubbed `psql` and disposable temp-dir fixtures only — it never
connects to a real database or touches a real secret:

```sh
npm run check:migrations:selftest
```

For the crash reporter specifically, the narrow bootstrap verification is:

```sh
npm --prefix mobile test -- --runInBand tests/error-reporting.test.js
```

Production-like verification for issue #434:

1. Build a preview or production native binary after the Sentry env vars are set.
2. Install the binary, launch it once, and trigger a test error with a temporary `Sentry.captureException(new Error(...))` or equivalent release-only smoke hook.
3. Confirm the event appears in Sentry with app/update tags and the expected release build context.
4. Remove the temporary smoke trigger before shipping.

The repo root no longer hosts an active browser/Vitest suite. After the
browser prototype archival in issue `#213`, the root `package.json` only
retains non-test commands such as `npm run audit`.

### Cross-file test isolation: fake timers

Jest reuses a worker process across test files. The module registry is reset
between files, but React and `react-test-renderer` scheduler state established
during import-graph evaluation is not. A module-scope `jest.useFakeTimers()`
therefore contaminates the next file that runs on the same worker, which caused
an intermittent required-`test`-job failure in `session-checkin-modal.test.js`
(issue `#679`).

Suites that render components must install fake timers per test, never at module
scope:

```js
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(MOCK_NOW);
});
afterEach(() => {
  jest.useRealTimers();
});
```

When reproducing a suspected isolation flake, always pass `--no-cache`; Jest's
on-disk transform cache masks the failure roughly half the time:

```sh
npm --prefix mobile test -- --no-cache --maxWorkers=2
```

### Cross-file test isolation: unmount renderers that schedule real timers

If a rendered component schedules a real (non-fake) `setTimeout`/`setInterval` as
a side effect (for example, clearing a transient "saved" flag a couple of
seconds after a successful save), the test must unmount the `react-test-renderer`
instance so the component's effect cleanup clears that timer before the test
file ends:

```js
let harnessRenderer;
afterEach(() => {
  if (harnessRenderer) {
    render.act(() => { harnessRenderer.unmount(); });
    harnessRenderer = null;
  }
});
// ...
render.act(() => { harnessRenderer = render.create(<Harness />); });
```

An un-unmounted renderer leaves the real timer live past the test file's
completion. If it fires later in the same process, the resulting `console.error`
(for example, a React "not wrapped in act(...)" warning) lands on Jest's
post-teardown console guard, which sets a non-zero exit code with no failing
suite or test to point at. This reproduced as `cd mobile && npx jest --runInBand`
exiting 1 with a fully green summary and no visible diagnostic (issue `#683`);
`--runInBand` runs the whole suite in one process, so the leaked timer has time
to fire before the process exits. The default parallel `npm test` job splits
work across worker processes and did not reproduce the same exit-code flip,
but the underlying leak is still worth fixing wherever it's found.

---

## Automated Coverage Inventory

### `mobile/tests/plate-math.test.js`

- covers `computePlateLoad` for exact standard-bar loads, unloadable per-side
  remainders, sub-bar weights, decimal weights, custom bar weights, invalid
  inputs, and exported standard lb constants
- covers `formatPlateWeight` display formatting for whole-number, fractional,
  and invalid values

### `mobile/tests/parser.test.js`

- parser parity coverage for `mobile/lib/parser.js`
- validates canonical native `parseWeightEntry`, `parseWorkoutRow`, and
  `parseWorkoutEntry` behavior against the same constrained MVP forms preserved
  from the archived browser prototype
- covers within-row skipped sets in `parseWorkoutRow` (the fatigue parser token),
  asserting a `-` rep token keeps its weight and emits a `rep_count: 0,
  skipped: true` set for trailing (`80 4,-`), leading (`80 -,8`), lone
  (`80 -`), spaced-comma, and mixed weight-pair (`80 4,- 70 8,-`) forms instead of
  degrading to `unparsed_rows`
- covers `parseWorkoutNote` for sample-style shorthand workout notes, including
  day and section headings, mixed-weight rows, deload summaries, graceful
  degradation of ambiguous fragments, and the non-weight cardio regression from
  the archived treadmill sample
- covers long-note session alignment, including positional `- ...` grouping,
  bare `-` skip-slot preservation, warmup/day boundary avoidance, non-weight
  alignment, deload coexistence, and uneven-count warning behavior
- covers `countWorkoutSessions` for day-aware current-workout counting,
  including same-day warmup+lifting grouping, highest-day-count semantics,
  non-weight warmup session entries, skip-slot exclusion, zero when no rows
  exist, and a real-format `current_workout`-shape fixture asserting main
  lifts retain history rows and bare `-` skips do not hide that history
- covers `epleyPR` and `deriveWorkoutAnalytics`, including grouped-row
  preservation, multi-occurrence exercise merging, stable
  `set_prs[].occurrence_index` linkage, and propagation of non-weight
  `unparsed_rows` into the derived analytics contract
- covers `deriveTrackedPRs` caller-order behavior and `derive1kTotal`
  aggregation behavior, including missing-lift null totals, mixed-weight rows,
  changing tracked selections, alias-merged histories, latest-complete-cycle
  selection across weekday, dash-entry, and blank-line session shapes, and
  regression coverage preventing mixed-cycle totals when one lift is skipped or
  has an extra unmatched newer cycle
- covers `classifyExerciseSessions`, including single-session `Initial`,
  majority-of-sets progression, same-weight rep-drop regression threshold,
  skip-window inconsistency, alias-aware tracked-name resolution, and plain-row
  occurrence handling
- covers `deriveProgressionSignals`, including bodyweight rep-fallback
  behavior, same-weight total-rep trend tiebreaks, and the guard that a
  multi-row plain-row block still counts as one comparable session rather than
  fabricating history

### `mobile/tests/data.test.js`

- helper and derivation coverage for `mobile/lib/data.js`
- verifies canonical temporal-helper semantics for native workout analytics,
  including Sunday-based `currentWeekStart()`, inclusive
  `rollingWindowStart()`, and DST-adjacent date handling
- verifies `computeWeeksIn()` keeps the mixed-format routine-depth contract by
  counting plain rows, `session_entries`, and skipped `session_entries`
  correctly across migrated history shapes
- verifies `deriveSkipData()` session-depth window for repeated weekday skip
  detection, including within-window and outside-window boundaries, and
  weekday-name-only headings without ISO dates
- verifies intra-session `computeRepDropOff()` classification boundaries,
  mixed-weight ambiguity handling, and working-set filtering
- verifies `deriveRepDropOffFlags()` stores per-session flag maps keyed by
  logged session position while omitting skipped sessions
- verifies the `deriveSessionCheckIn()` fatigue detector contract on the latest
  positional session, covering null/empty guards, the not-rough baseline case, the
  brand-new-exercise no-history guard, the four detectors (volume-drop on rep
  collapse vs baseline including within-row skipped sets, intra-session collapse,
  skips above the usual rate with floor and strict `avg + margin` boundary, and
  whole-day skip), and the `#270` single-exercise repro cases
- verifies `deriveCheckInHistory()` reverse-chron list shaping and `{ total,
  top_reason }` summary tally, including null/empty inputs and notes whose
  `session_checkins` is null
- verifies `deriveWorkoutNoteAnalytics()` canonical layer return shape,
  per-field output (weeksIn, classifications, skipData, signals, and
  `nameDisplayMap`), absence of `repDropOffFlags`, empty-sections behavior,
  missing-exercise handling, and determinism
- pins direct helper parity for the canonical workout path by asserting
  `deriveWorkoutNoteAnalytics()` matches `computeWeeksIn()`,
  `classifyExerciseSessions()`, `deriveSkipData()`, and `deriveSignals()` for
  the same inputs
- verifies workout-note storage round-trips `session_checkins` entries intact
  and loads legacy notes without the field null-safely
- pins the canonical Analytics migration contract by asserting that
  `deriveWorkoutNoteAnalytics(...).signals` matches `deriveSignals(...)` for
  the same sections, tracked lifts, and multiplier inputs
- pins HomeScreen progression-depth contract through the canonical
  `deriveWorkoutNoteAnalytics(sections, []).weeksIn` path, covering
  null-sections, empty-sections, single/multi-exercise depth, skipped
  sessions, bare-row-only exercises, and mixed-format history with skipped
  `session_entries`
- verifies canonical alias resolution for Analytics signals so tracked
  exercises such as `DB Bench Press` still yield overload trends when the
  note uses an alias like `DB Bench`
- verifies `deriveWeightGoalAnalytics()` canonical weight/goal return shape and
  per-field outputs across empty/null entries, saved-goal and edited-goal
  paths, `start_weight` fallback, rolling-series limit behavior, pace-level
  nullability, and maintain-goal calorie guidance
- verifies the new Analytics-specific `rollingSeries30` contract and the
  backward-compatible `computeWeightRollingAverageSeries(..., windowDays)`
  behavior for 7-day vs 30-day windows
- verifies `derive1kTotalSeries()` aligns Big-3 history by shared session
  ordinal, including gap preservation for skipped sessions or sessions with no
  valid weighted set so later points cannot drift onto earlier squat/deadlift
  cycles, and pins the direct helper parity contract that `derive1kTotal()`
  reuses the last complete aligned series point for the Home headline
- verifies the #396 cross-routine fix: `derive1kTotalSeriesFromSectionsList()`
  aligns Big-3 history per note before concatenating with monotonic global
  ordinals, so unequal per-lift session counts across notes no longer pair a
  deload/old-routine session of one lift with another lift's current-routine
  session; covers per-note ordinals, intra-note skip alignment, empty-cycle notes
  taking no ordinal space, and the `derive1kTotalFromSectionsList()` fallback
  returning a null total with per-lift latest PRs (never a cross-note sum) when no
  note has a complete Big-3 cycle
- verifies the #397 deload exclusion: `deriveAnalytics()` filters deload notes out
  of the strength-signal derivation so Kilo Max matches the current-routine-only
  value instead of being dragged down (and asserts the legacy contaminated path is
  strictly lower), while the 1K series still emits the deload note as its own point
- pins direct helper parity for the canonical weight/goal path by asserting
  `deriveWeightGoalAnalytics()` matches `computeWeightTrendSummary()`,
  `computeWeightPaceLevel()`, `computeWeightRollingAverageSeries()`,
  `computeWeightGoal()`, and `computeCalorieEstimate()` for the same inputs,
  including a manual BMR -> TDEE -> calorie-target chain check
- verifies cross-consumer consistency for shared workout and weight inputs so
  canonical outputs stay aligned across repeated calls and downstream surfaces
- verifies the calorie helper's TDEE path with Mifflin-St Jeor BMR, all five
  activity multipliers, gain/loss/maintain target outputs, and incomplete
  profile fallback behavior

### `mobile/tests/format.test.js`

- shared formatting helper coverage for `mobile/lib/format.js`
- verifies ISO date display formatting for date-only and datetime inputs
- verifies weight-delta pace/severity thresholds plus signed delta formatting

### `mobile/tests/analytics-screen.test.js`

- spies on `deriveWeightGoalAnalytics()` and verifies the rendered
  `AnalyticsScreen` latest-weight display uses the shared-layer `currentWeight`
  result instead of any raw-entry local sort or pick
- verifies the rendered `7-day` and `30-day` weight averages come from the
  shared-layer `avg7` / `avg30` outputs
- verifies the split `7-day rolling average` and `30-day rolling average`
  chart labels render on Analytics
- verifies the `Session Health` section rename plus the gauge zone/caption
  contract (`No sessions logged`, `Approaching deload`, and the three zone
  labels)
- verifies the two-metric deload display so Analytics explicitly labels both
  `sessions since deload` and `weeks since deload`, including the no-history
  em-dash state for the weeks metric
- verifies Analytics derives `sessions since deload` from stored session
  anchors rather than deload dates or check-in chronology, including date-edit
  and multiple-deload ordering regressions, count-vs-first-post-deload ordinal
  compatibility, mixed old/new deload-history boundary ordering, and
  prior-routine deload exclusion so a new routine with 3 qualifying sessions
  does not show 4 total sessions
- verifies feature-toggle gating so the `Fatigue` section disappears when
  fatigue tracking is off and the `Session Health` section disappears when
  deload mode is off while unrelated Analytics sections remain visible
- verifies the `Fatigue` card's collapsed default summary, expand-then-collapse
  toggle cycle, post-expansion rough-row edit affordances, post-expansion
  ok/pending chip edit affordances, and the unanswered-check-in badge
- verifies the `SessionCheckInModal` rendered handler wiring so backdrop taps
  and Android `onRequestClose` call the defer path without writing
  `session_checkins`, while the explicit close control writes a session check-in
  entry before closing
- verifies the Log-tab active-state regression boundary so switching away from
  Log while the current routine is in edit mode fires check-in detection, while
  switching away in read mode does not open the prompt
- verifies exercises are grouped by routine day with correct group headers
- verifies multi-day exercises render per-day row metrics from
  `perDaySignals`, including null-trend fallback to the global signal and
  bodyweight `reps` units in cross-day chips
- verifies alias exercise names in the note still resolve to the canonical
  tracked signal row
- verifies redesigned 1K Progress card renders hero total, progress bar,
  and full breakdown labels (Squats, Bench, Deadlifts)
- verifies the `1K total over sessions` chart label only appears when the
  derived series has multiple aligned points
- verifies `deriveOneKChartData` preserves per-point squat/bench/deadlift
  breakdown values so selected chart points can drive the 1K Progress stats

### `mobile/tests/storage.test.js`

- AsyncStorage-backed load/save/delete/update/migrate coverage for
  `mobile/storage/entries.js`
- verifies empty-load behavior, newest-first sorting, update misses, workout
  note save/overwrite/clear behavior, tracked-exercise persistence across note
  edits, note-first Log raw-text save/edit/parser-display coverage,
  weight-entry value/note/date correction coverage, archived weight-goal
  persistence/raw-list coverage, invalid date rejection,
  delete-refresh ordering, optional user-profile persistence, the deload
  dual-write linkage contract (`note_id` plus `Deload · ` note filtering and
  deletion pattern), tolerance for pre-#257 history rows without `note_id`, direct
  `updateDeloadHistory(id, patch)` coverage for linked deload-date sync,
  persisted default and round-trip behavior for the `Fatigue tracking` and
  `Deload mode` settings, and migration of legacy structured sessions into the
  canonical workout-note document
- includes a contract-driven migration suite that verifies weighted entries,
  non-weight entries, mixed weighted-plus-metadata entries, positional skip
  slots, multi-session count preservation, and session-view-visible mixed-entry
  comments after `buildSessionsFromNote()`

### `mobile/tests/autosave.test.js`

- focused autosave and persistence coverage for the Log-screen note-editing
  flow
- verifies the debounce pattern contract (reschedule, cancel, manual flush, and
  no-op when no changes are pending)
- verifies stale-result guards suppress older async save results when the user
  keeps typing or switches routines before an in-flight save resolves, while
  still allowing unchanged saves and new-note first saves to settle correctly
- verifies storage-level persistence behavior for rapid note rewrites so autosave
  updates converge to the latest content without duplicating or corrupting the
  underlying note list

### `mobile/tests/weight-goal-ui.test.js`

- rendered React Native screen coverage for `mobile/screens/WeightScreen.js`
  using `react-test-renderer`
- verifies saved-goal derived-state presentation for loss, gain, maintain, and
  no-estimate cases
- verifies advisory warning copy for aggressive and unrealistic pace states
- exercises the saved-goal display path with `start_weight` fallback coverage
  rather than only pure helper-level calculation tests
- covers the met-goal lifecycle UI, including the `Goal Met!` badge, archive
  action visibility after the target is reached or an unmet goal is overdue,
  and preservation of the normal in-progress goal actions
- covers archived-goal history visibility, hidden empty state, newest-first
  ordering, required row fields including the separate `End Weight` column, and
  the subscriber refresh path after archiving a completed goal
- covers the unified Goal History and Weight History visual system, including
  matching value/date/label typography, matching column flex ratios, hidden
  column headers in collapsed panels, the always-visible Weight History filter
  icon, and the collapsed filter-icon tap path that expands the panel and shows
  the From/To controls

### `mobile/tests/weight-screen.test.js`

- rendered React Native screen coverage for the Weight screen edit and delete
  correction flows using `react-test-renderer`
- verifies tapping a history row loads the entry into the form in editing mode
  (sets `editingId`, populates weight and note inputs)
- verifies edit submit reruns `parseWeightEntry` validation and calls `update`
  with the correct entry id and note on valid input
- verifies date-enabled edit submit threads the corrected ISO date through the
  existing `update` seam
- verifies edit submit shows a validation error and does not call `update` when
  the weight field contains invalid input
- verifies tapping the delete affordance (✕) triggers `Alert.alert` with a
  confirm prompt, calls `remove` on the destructive confirmation, and refreshes
  the rendered history
- verifies cancelling the delete prompt does not call `remove`
- verifies tapping a history row also calls the forwarded `ScreenShell`
  `scrollTo` ref so the loaded editor is brought back into view
- verifies the Weight History disclosure toggle keeps the expected accessible
  expand/collapse state after adopting the shared open-chevron icon convention
- verifies a saved goal renders the split target + guidance presentation rather
  than collapsing all goal information into one card
- verifies the active weigh-in date picker exposes the native `onChange`
  callback and updates the visible ISO date when a new date is selected
- verifies the goal target-date picker exposes the native `onChange`
  callback and updates the visible MM-DD-YYYY label when a new date is
  selected
- verifies the Weight History date range From/To pickers ignore a cancelled
  (`type: 'dismissed'`) change so the sentinel `01-01-2000` value is never
  committed, while confirmed selections still update the chip

### `mobile/tests/app-navigation.test.js`

- rendered `App` coverage (Android platform, real `LogScreen` and
  `WeightScreen`, not stubs) for the single-slot `registerBackConsumer`
  back-handler-ownership mechanism (#527)
- verifies a hardware back press on the Log tab finishes the active
  current-routine editor instead of falling through to Home
- verifies switching away from an editing Log tab and back preserves handler
  precedence for the visible tab (the shell's own listener re-registers on
  every `activeTab` change, which is the scenario the underlying #522 bug
  exploited)
- verifies a hidden Log editor left mid-edit cannot consume a back press
  while another tab is active; the shell falls back to Home instead
- verifies editing the Weight tab's goal form, then switching to Log, leaves
  the hidden goal-edit state untouched by a Log back press
- verifies that with no active in-tab state on any tab, back still returns a
  non-Home tab to Home

### `mobile/tests/sync-queue.test.js`

- deterministically defers the first transport push, enqueues a newer snapshot
  under the same id, and verifies exact-snapshot cleanup retains and later sends
  the replacement
- covers live rows and tombstones through both the write-enqueued `syncTable`
  path and the diff-tracked `syncDiffTable` path
- verifies a failed push leaves the acknowledged snapshot queued and a later
  successful retry clears it idempotently
- verifies future and lagging device clocks cannot become pull cursors in either
  sync engine, server acknowledgements replace device-stamped metadata, and a
  later remote row remains pullable without causing a redundant second push
- verifies both sync engines clear an already-poisoned future cursor after a
  normal server acknowledgement, then recover all previously hidden rows on the
  next full pull without re-pushing the acknowledged local edit
- verifies both sync engines advance to the server's completed xid boundary and
  recover a writer that commits after the prior read, even when its
  `updated_at` sorts before that read

### `mobile/tests/bootstrap-cloud.test.js` and `mobile/tests/offline-sync.test.js`

- cover archived weight-goal cloud transport wiring so dirty
  `archived_weight_goals` records are pushed, remote archived goals are pulled
  into local storage, and the sync result set includes the table alongside
  weight entries and workout notes
- cover the real Supabase transport's server-stamped upsert response,
  collection/singleton keyset continuation, fixed transaction boundary, and
  complete pagination when equal-timestamp rows exceed one page; deleting a row
  from an already-consumed page cannot shift and strand the next unvisited row
- keep the fake offline-sync cloud table map aligned with all tables processed
  by the sync adapter, preventing new sync tables from regressing existing
  offline create/edit/delete tests
- verify ordinary profile settings stay on `user_profile` while current routine,
  tracked lifts, and fatigue multiplier use the consent-gated
  `user_health_profile`, including singleton conflict targets, clean-install
  restore, row-level LWW convergence, retry behavior, and post-contract-safe
  transport allowlists
- verify active-deload create/edit/clear convergence through `user_health_profile`
  without timestamp ping-pong or sibling-field clobbering, and verify the
  deterministic one-way `fatigue_checkins` projection covers create, update,
  tombstone, retry, idempotency, bootstrap follow-up, and two-device convergence
- verify the clean-device recovery path restores all nine cloud contracts
  without pushing local state, while every non-empty local-state family and a
  pending dirty queue suppress or reject that path
- verify ownership bootstrap preserves workout-note provenance and tombstones,
  already-stripped `wn_legacy_` rows converge back to tombstones, repeated sync
  stays idempotent, and legitimate legacy-only/user-authored notes survive
  (#501)
- verify a verified-zero purge leaves an ordinary sync pass with nothing to
  detect (the #538 failure mode, pinned directly against the real engine);
  verify `rearmGatedTablesForRebuild()` plus one ordinary pass fully
  reconstructs all seven gated tables, including tombstones and the derived
  `fatigue_checkins` projection, while leaving ungated tables untouched; verify
  `rebuildCloudCopy()` reconstructs every gated table and runs a reconciliation
  pass that leaves nothing dirty; verify a push interrupted mid-rebuild does not
  falsely report success, leaves the dirty queue armed, and a reconnected retry
  is safe and idempotent (no duplicate rows) (#538)

### `mobile/tests/recovery-blocks.test.js`

Covers the recovery-block domain (baseline capture, single-record storage
invariants, ordinals, tombstones) and the durable recovery operation journal
(#696). The journal coverage is a failure-injection matrix rather than a happy
-path suite: each case breaks exactly one protocol boundary against the real
`jsonStorage` read/write path — never a fake collection — then asserts the
immediate persisted state, the retained journal record, the returned
machine-readable code, and convergence after replay.

Boundaries injected, for all three durable operations (complete block with
current week, delete linked note, add a new note as the next week):

- journal intent read and intent write (an intent write failure must produce no
  domain mutation at all; an intent read failure must refuse the operation);
- each affected-domain read;
- the first domain write (week completion / membership tombstone);
- the second domain write (block completion / note deletion);
- the cloud tombstone write and the queue enqueue/bookkeeping step, separately;
- the post-write verification read;
- the journal stage update;
- the journal clear.

Scenarios pinned beyond the per-boundary sweep:

- delete committed and then threw — the persisted state decides, and the
  membership is not restored;
- delete committed, threw, and the verification read failed — pending, fail
  closed, no dangling live membership, converges on retry;
- membership tombstoned while the note is live, and note deleted while the
  membership is live — both converge toward the recorded deletion;
- both postconditions already satisfied under a stale journal intent — cleanup
  only, with no timestamp churn on either record;
- journal cleanup failure — reported as verified-with-cleanup-pending, cleared on
  the next reconciliation;
- malformed record, unsupported schema version, and unparseable journal bytes —
  all fail closed, stay on disk, and block a new operation rather than reading as
  "no pending work";
- concurrent retry, sync, and double-tap attempts — one completion, one stable
  timestamp, no duplicate ordinals, and single-flight re-entry returning the
  in-flight pass;
- local hard-delete versus cloud tombstone plus pending-sync intent, including a
  replay that re-enqueues without re-stamping the tombstone;
- app-restart replay: in-memory protocol state (single-flight queue, registered
  note operations) is discarded and only persisted state drives convergence;
- pre-action gating: a pending operation over the same block, week, or note
  blocks a conflicting action, while an unrelated action still proceeds;
- cancellation and validation failures proving zero writes, journal included;
- new-note week specifics: note-write failure, membership-write failure, a
  membership failure whose journal clear also fails, restart replay between the
  two writes, and concurrent confirms — all asserting exactly one note and
  exactly one ordinal afterwards;
- new-note week note postcondition: a cloud note whose write committed and whose
  enqueue then failed must NOT verify on existence alone (the operation stays
  pending, no membership is published, and a replay re-enqueues it), a
  live-but-unqueued note is re-enqueued from a stale intent without duplicating
  anything, and a tombstoned note is restored live before the membership is
  attached rather than being accepted as valid;
- new-note week conflict liveness — every conflict must EXIT, not repeat: an
  ordinal claimed by another device is durably reassigned (recorded on the record
  before the write, so a failure replays the new ordinal) and one retry converges
  to a gap-free `[1, 2, 3]`; a note that joined another block and a deleted block
  both retire as `CONFLICT_CANCELLED` with nothing pending, and a further retry is
  a clean no-op. `log-screen.test.js` pins the UI half: a terminal cancellation
  shows its explanation, offers no `Retry recovery` button, and leaves every
  lifecycle action enabled;
- storage-mode change mid-operation: a deletion that hard-removed the note in
  local mode and is replayed in cloud mode must reconstruct the tombstone and its
  dirty-queue record before the journal may be cleared, must stay pending while
  the enqueue keeps failing, and must still finish as a plain hard delete when the
  device is genuinely local (`mobile/tests/sync-recovery.test.js`).

`mobile/tests/log-screen.test.js` covers the same protocol at the screen level
(verified persisted postconditions instead of a mocked storage call, the pending
warning with its `Retry recovery` action, disabled conflicting actions, and a
same-tick double confirm on the new-note Add Week path — which only a synchronous
ref mutex can reject, since two presses dispatched before a re-render both observe
the same React busy state), and
`mobile/tests/sync-recovery.test.js` / `sync-recovery-ui.test.js` cover the sync
boundaries below.

### `mobile/tests/recovery-analytics.test.js`

Covers the per-exercise return-to-baseline comparison (#697) — the pure
derivation layer only; there is no UI to render yet. Fixtures are written as
historical-style notes rather than hand-built result objects, so the suite pins
what a lifter's log actually produces:

- weighted exercises reaching `Baseline met` only when top load AND volume are
  both at baseline, with load-only and volume-only weeks staying `Rebuilding`
  and naming the unmet dimension;
- reps-only and timed exercises judged on their single applicable metric, with
  no load dimension invented for them;
- ratios above baseline retaining their factual value uncapped, and a fractional
  shortfall flooring so 99.6% can never render as "100%" beside a `Rebuilding`
  state;
- exclusions that must not inflate work: warmup sections, whole-exercise skips,
  within-row skipped sets, unparsed rows, and notes rejected by the parser's
  size or structure contract (which report `note_unreadable`, never a comparison
  against zero);
- `Not comparable` rather than a fabricated ratio when the exercise changed
  family between baseline and week, when the week's work carries none of the
  baseline family's numbers, or when the frozen row is unusable — and baseline
  usability decided from the snapshot alone, so a quiet week and a logged week
  report the same reason instead of the quiet one reading as
  `not_reintroduced`;
- non-finite evidence rejected: individual `Infinity`/`NaN` sets are excluded,
  and an aggregate that overflows (four sets at 1e307, from values the parser
  itself accepts) is dropped rather than emitted as an infinite volume that
  would falsely satisfy `baseline_met`;
- the baseline format version read before any assumption about snapshot shape,
  so a future-version snapshot without an `exercises` array is
  `baseline_unsupported` rather than `baseline_unavailable`;
- substitutions and mobility additions listed as `Added during recovery` with
  real numbers and no baseline percentage, while the lift they stood in for
  stays `Not reintroduced`;
- deterministic aggregation of the same normalized exercise across an A/B week
  and across repeated sessions in one note;
- week results following membership order — not note dates, titles, or the order
  weeks were supplied — with tombstoned and other-block weeks excluded;
- purity: neither the notes nor the frozen snapshot are mutated, repeated
  derivation is identical, and switching the lb/kg display preference cannot
  change a state or a percentage.

### `mobile/tests/home-screen.test.js`

Covers the recovery/normal-analytics boundary (#699) as a CROSS-surface
contract, which is the only level at which it can be pinned: one fixture
(ordinary routine, deload note, an excluded block's week, an included completed
block's week, and a baseline routine) is run through Home's and Analytics'
real derivation entry points together, so a regression that filtered only one
surface fails here. It asserts default exclusion, 1K agreeing exactly between
the two screens, a live toggle moving Kilo Max and non-weighted metrics on both
at once, a round-trip toggle restoring every aggregate exactly (no double
counting), independent per-block memberships, deload exclusion unchanged in
both preference states, an excluded week still producing full Recovery
Analytics evidence, and a missing linked note leaving unrelated ordinary notes
alone.

It also pins the fail-closed contract at the screen level: with the recovery
store unreadable, Home paints neither its dashboard nor its empty state, because
"no records read" and "nothing is excluded" are the same empty snapshot and only
one of them is true. `analytics-screen.test.js` pins the matching Analytics gate
(the 1K card and Progressive Overload list hold their spinner while the Recovery,
weight, and fatigue sections, which do not depend on the boundary, are left
alone).

The per-block filter rules themselves (tombstoned membership, orphaned or
tombstoned block, malformed `note_id`, baseline notes never being members, and
verified-versus-unknown) are unit-tested in `data.test.js`; the switch's UI,
persistence, per-block independence, locking, error surface, and live subscriber
refresh are in `log-screen.test.js`, alongside save-time classification honoring
the same boundary and omitting the classification entirely when the recovery read
fails. `log-screen.test.js` also covers the subscriber's freshness and failure
behavior directly: a restored local backup refreshing every mounted subscriber, a
cold-start read failure reporting an unverified boundary that still hides nothing,
its bounded self-retry publishing once storage recovers, and a later failure
keeping the last verified boundary instead of reverting to unfiltered.

### `mobile/tests/sync-recovery.test.js`

- drives the confirmed #522 claim-4 lifecycle end to end against the real
  storage layer and sync engine: signed-in and synced, sign out, write through
  the local adapter, then sign back in as the same owner
- verifies a row created, a row edited, and a row deleted while signed out all
  reach the cloud, with the signed-out delete arriving as a tombstone that the
  next pull does not resurrect; the five collection cases fail on the
  pre-#525 engine
- verifies a concurrent edit made on another device converges instead of being
  overwritten by the reconciled local state
- verifies the singleton/diff-tracked contracts (weight goal set, tracked lifts
  changed, goal cleared) still upload signed-out changes, pinning the snapshot
  diff's adapter-independence that keeps them outside the defect
- verifies repeated sign-in and repeated sync push nothing further, duplicate no
  rows, leave the dirty queue empty, and record a baseline for every collection
- verifies a reconciliation that cannot complete leaves the sync phase failed and
  retryable with the unsynced row still absent from the cloud, never "synced"
- covers the upgrade window, where no baseline is recorded yet: a signed-out
  workout note created through the real `makeWorkoutNoteItem` factory (so it
  carries its own `updated_at`) is uploaded and only then admitted to the
  baseline; a signed-out edit is uploaded; a failed push leaves the table
  baseline-less so the retry reconciles again rather than treating the skipped
  row as synced; the pull ignores the stored cursor so an already-synced row is
  still recognised and not re-pushed; and a newer remote row wins instead of
  being clobbered
- covers signed-out deletes on the upgrade path, bounded by the stored pull
  cursor: a delete at or before a trustworthy cursor propagates as a tombstone
  the next pull does not resurrect; a remote row written after the cursor is
  preserved rather than tombstoned; a #523-poisoned future-clock cursor produces
  no tombstone, records no baseline, and fails the sync phase with an actionable
  message that the retry then clears; and a missing cursor is resolved by the
  `ownedDevice` transition context — an owned device whose cleared cursor cannot
  classify a signed-out delete surfaces an honest conflict (no tombstone, no
  baseline, retry converges) while a clean first download of the exact same
  local shape still downloads without a conflict, and the #538 post-purge rebuild
  still converges on an unbaselined device
- unit-covers `assessCursorTrust` (corroborated, ahead-of-server, uncorroborated,
  absent, malformed, empty remote) and `reconcileAgainstRemote`'s absent-local
  classification, including that an already-tombstoned remote row is never
  re-tombstoned and that a missing cursor is a conflict on an owned device but not
  on a clean one
- covers the recovery operation journal's sync boundaries (#696): an unverifiable
  pending operation and a corrupt journal both fail the pass before it runs, so
  mid-operation state is never pushed; a resumable operation is reconciled before
  the pass and the pass then proceeds; reconciliation runs AGAIN after the
  pull/merge, so an operation a remote change introduced is applied and verified
  before success may be published; and reconciliation repairs local invariants
  with no transport configured at all, proving repair needs no network.
  `sync-recovery-ui.test.js` pins the user-facing half: `maybeSyncCloud` leaves
  the SYNC phase failed and retryable with the reconciliation cause and the
  journal record intact, and reports a complete sync through the same code path
  once nothing is pending
- covers the exclusion boundary deterministically: a fake pass snapshots the whole
  recovery-week collection, suspends on a gate, and writes the merged whole list
  back on resume. A journaled Add Week started while the pass is gated is drained
  for far more turns than it needs and must still not have run — proving exclusion
  rather than luck — and after both complete, the pass's pulled row AND the
  journaled week both survive, with the new ordinal derived from post-pass state.
  The mirrored case (lifecycle action first) proves the pass observes the verified
  write instead of publishing success over a stale merge. This test was
  negative-controlled against the previous behaviour that released the guard for
  the pass body: it fails there and passes with the guard held
- covers the same boundary for cloud bootstrap, which uploads the recovery
  collections as the account's initial state: a resumable pending operation is
  reconciled before `bootstrapFromLocal` observes its snapshot (bootstrap sees the
  converged records, not the mid-flight ones); an unresolvable operation and a
  corrupt journal each prevent any upload at all; and a lifecycle action started
  during a gated bootstrap is drained for far more turns than it needs and must
  still not have run, after which both the uploaded snapshot and the local write
  are intact. `sync-recovery-ui.test.js` proves the WIRING end to end through the
  real `runBootstrap` hook — no upload, no ownership claim, no cloud-mode
  activation, phase failed/retryable, journal intact — and that the same path
  uploads and completes once the operation converges. Both wiring tests were
  negative-controlled against the unwrapped bootstrap runner: they fail there and
  pass with it routed through the boundary across the whole
  sequence

### `mobile/tests/backup-import.test.js`

- drives the confirmed #522 claim-5 restore lifecycle against the real storage
  layer and sync engine with an in-memory transport: a signed-in, fully synced
  device imports a backup that edits one row, drops another, and introduces a
  third
- verifies the cloud contract establishes durable local and sync intent before
  reporting success — every imported row stamped and enqueued, every omitted
  collection record retained as a tombstone rather than removed
- verifies imported creates and edits reach the account, omitted records arrive
  as tombstones, and a second pass does not resurrect them
- verifies an optional field the backup OMITS (a weight-entry `note`, a
  workout-note derived `session_checkins`) is cleared on the restored row and
  absent from the queued upload rather than carried over from the device's
  current row — the restored record is built from the validated backup row alone,
  matching replace semantics and the local contract
- verifies a REMOTE-ONLY row this device merely pulled is tombstoned by a replace
- verifies an import performed before the device has any sync baseline still
  uploads, which the signed-out-write reconciliation alone cannot do because it
  conservatively adopts only unstamped rows when no baseline exists
- verifies a failed push leaves the imported state, the tombstones, and the dirty
  queue intact, the account unmodified, and a retry completing the restore
- verifies idempotency across repeated syncs and repeated imports of the same
  backup: no duplicate rows, no further pushes, and no restated tombstones
- verifies the preserved invariants — the local-data owner marker untouched, an
  invalid payload writing and queueing nothing, a v1 backup not deleting workout
  notes, and archived weight goals not tombstoned by a format that omits them
- verifies the local contract is byte-for-byte unchanged: domain keys
  overwritten, no stamping, no tombstones, and nothing enqueued
- covers the v4 recovery collections (#694): a recovery-aware backup round-trips
  active and completed blocks, frozen baseline snapshots, week order, membership
  completion, the analytics preference, and tombstones; the export emits only
  allowlisted fields, so a stray local field cannot reach the shared artifact
- covers twenty-six malformed recovery payloads, asserting each is rejected with
  local storage, the unrelated collections, and both recovery dirty queues
  byte-identical afterwards — the "no partial writes" property, not merely
  "rejected". Per-record cases: a membership referencing a block the payload does
  not carry, a non-positive, null, or missing week ordinal, a baseline with no
  version or from a newer capture format, a non-numeric baseline metric, a
  duplicate or missing block id, a non-array collection, and either recovery
  collection present without the other. Cross-record cases, matching the three
  partial unique indexes on the cloud tables: two live blocks both still active,
  one workout note with two live memberships, and two live memberships claiming
  the same week ordinal. Eleven timestamp cases pin the strict ISO instant rule,
  including the ones `Date.parse` accepts (`"1"`, `"01/02/03"`, `"2026"`,
  `"March 5, 2026"`, a date with no time, a time with no offset) and the ones it
  silently normalizes into a different day (`"2026-02-30T00:00:00Z"`,
  `"2025-02-29T00:00:00Z"`)
- verifies the strict timestamp rule does not overshoot: a server-stamped
  `+00:00` offset with microsecond precision, which is what a synced cloud user's
  raw local rows actually carry, is accepted and persisted verbatim
- verifies the mirror-image property, since the uniqueness rules are scoped to
  live rows: a completed block beside a new active one, with the second recovery
  reusing a workout note and a week ordinal the first one released, round-trips
  rather than being rejected as a conflict
- verifies blocks are queued and pushed before the memberships that reference
  them, matching the `recovery_block_weeks` foreign key; that a membership the
  backup omits becomes a tombstone the account accepts and a later pull cannot
  resurrect; and that a v3 backup, which says nothing about recovery data,
  deletes no block or membership and queues nothing
- negative control: with the cloud branch forced back to the local path, the
  cloud-contract cases fail because no stamping, queueing, or tombstoning happens;
  and restoring the prior `{ ...base, ...content }` whole-row merge fails exactly
  the two omitted-optional-field cases while the rest stay green, pinning that
  narrow field-preservation defect and nothing broader

### `mobile/tests/auto-sync.test.js` and `mobile/tests/sync-recovery-ui.test.js`

- verify a truly empty unclaimed device can explicitly download the signed-in
  account's data, claim ownership, activate cloud mode, pull, and refresh the UI
- verify the recovery action rechecks local emptiness before running and leaves
  non-empty or dirty local state untouched without a cloud push
- verify Manual Sync Now cannot report completion while the local adapter is
  active, and pull failures remain visible and retryable
- verify an active password recovery or recovery-link error suppresses and defers
  the ownership prompt, then re-presents the still-valid decision once recovery
  ends, without disturbing ordinary sign-in ownership behavior (#500)
- verify the full foreign-owner upload lifecycle through the real
  `confirmOwnershipUpload()` entrypoint: prompt, persisted owner marker,
  bootstrap plus sync, fresh-mount restart with no recurring prompt, and
  repeated-launch phantom-note convergence (#501)
- verify withdrawal and deletion-pending restarts switch to local-only storage,
  retain the reconciled legacy tombstone only in raw storage, keep legitimate
  user-authored `Routine 1` notes visible, and perform no health sync on repeated
  refresh; verify a successful same-owner re-grant restores cloud routing without
  bypassing the foreign-owner gate (#544)
- verify a same-owner sign-in whose server `cloud_rebuild_generation` is ahead of
  this device runs the full post-purge cloud rebuild automatically, in place of
  the ordinary sync pass, with no user action, then records the caught-up
  generation; verify a device already caught up (or an absent generation field)
  falls back to the ordinary pass (never a spurious rebuild) and stays idempotent
  across launches; verify per-device completion — a second same-owner device that
  has not caught up still rebuilds, since there is no single server flag the first
  device could clear; verify manual Sync Now selects the rebuild the same way;
  verify a failed rebuild leaves the sync phase failed/retryable without touching
  local data, the owner marker, or the device generation, and a retry
  re-attempts it (#538)
- exercise the production `CloudSyncRecovery -> HealthDataConsent` wrapper:
  assert the synchronized app version reaches the grant, no sync starts before
  the grant succeeds, same-owner success runs ordinary sync or the generation-
  selected rebuild before reporting activation, failures preserve local data and
  expose retry, and unclaimed/foreign history stays behind ownership choice (#539)

### `mobile/tests/health-consent.test.js` and `mobile/tests/consent-gate-client.test.js`

- pin the exact Cloud Sync consent/withdrawal copy, unchecked affirmation,
  validation-disabled versus genuinely loading button labels, grant failure
  behavior, and distinct client handling for update-required, missing, stale,
  and deletion-pending consent states
- verify bootstrap and automatic sync remain off until preflight confirms the
  required material version and protocol

### `mobile/tests/account-lifecycle-ui.test.js`

- rendered hook/UI-adjacent coverage for the signed-in account export/delete
  flow in `mobile/hooks/useAuthSession.js`
- verify dismissing consent with `Not now` uses the shared `ScreenShell` ref to
  return the Account screen to the top instead of leaving it mid-scroll (#539)
- verifies configured Android builds render GitHub sign-in, open the system auth
  browser with `kilo://auth/callback`, exchange only the returned PKCE code, and
  surface cancellation, provider, missing-callback, and exchange failures
- verifies Account consumes an injected app-shell auth object, preserving the
  cold-start loading gate while rendering a resolved signed-in session
  immediately without a signed-out form flash
- verifies reset requests use explicit native/web base redirects, recovery state
  opens the set-new-password surface through More > Account, expired links show
  readable errors, and matching passwords reach `updateUser({ password })`
- verifies `serverExport()` calls `/functions/v1/account-export` with the
  current session JWT and returns the JSON payload on success
- verifies export and deletion function errors are surfaced without clearing
  local session state
- verifies `deleteAccount()` calls `/functions/v1/account-delete`, then signs
  out and clears local session state only after a successful server response
- verifies the mobile/web client never includes a service-role or secret key in
  fetch headers

### `mobile/tests/app-update-banner.test.js`

- rendered app-shell coverage for the global OTA update-pending banner in
  `mobile/App.js` (`expo-updates` mocked)
- verifies the banner is absent when no update is pending, present with the
  "Update ready" / "Restart to apply" copy when `isUpdatePending` is true, and
  that pressing the restart action calls `Updates.reloadAsync()`

### `mobile/tests/backup-screen.test.js`

- rendered UI coverage for the `BackupScreen` import-confirm flow
  (`mobile/components/BackupScreen.js`)
- verifies tapping Import with valid pasted JSON raises the destructive
  confirmation alert and does not call `onImport` until the user confirms
- verifies the alert's Cancel path is a safe no-op that leaves data untouched
- verifies confirming the destructive action calls `onImport` and surfaces the
  restored-data success state
- verifies empty or whitespace-only input is rejected with guidance and without
  raising the alert
- verifies local-export failures surface the provided error, retain a generic
  fallback, and preserve native `Share.share()` exception messages

### `mobile/tests/app-export.test.js`

- direct unit coverage for the `buildExportPayload()` envelope used by
  `mobile/App.js`
- verifies successful backup serialization, preservation of thrown error
  messages, and the generic fallback for thrown values without a message

### `supabase/tests/account-lifecycle.test.sql`

- pgTAP requester-isolation coverage for the `kilo` schema account lifecycle
  contract
- verifies a signed-in user can select only their own rows across all seven app
  tables
- verifies cross-user delete attempts affect zero rows under RLS
- verifies owner self-delete removes the requester's rows while preserving
  another user's rows
- requester-isolation coverage remains separate from durable rate-limit SQL
  coverage in `supabase/tests/rate-limit.test.sql`
- run with `supabase test db --file supabase/tests/account-lifecycle.test.sql`
  from repo root, or `supabase test db --file tests/account-lifecycle.test.sql`
  from inside `supabase/`

### `supabase/tests/rate-limit.test.sql`

- pgTAP coverage for the durable `kilo.rate_limit_check` and scheduled global
  prune contract
- verifies admission through the configured maximum, denial above the maximum,
  bucket independence, and persisted hit counts
- verifies export rows are removed after 10 minutes, delete rows after 1 hour,
  live rows survive, and unknown prefixes use the defensive fallback horizon
- run with `supabase test db --local supabase/tests/rate-limit.test.sql`; the
  Supabase CLI local database requires Docker
- forged-header resistance remains a deployed Edge Function check because the
  SQL suite cannot observe platform forwarding-header behavior

### Consent, migration, and purge suites

- `supabase/tests/commit-safe-change-feed.test.sql` uses independent reader and
  writer sessions on disposable local Postgres: the writer is stamped before
  the reader snapshot, stays uncommitted until after the reader returns its
  cursor, then is recovered by the later pull from that exact cursor; it also
  verifies owner-scoped RLS and exact xid evidence

- `supabase/tests/health-mirror.test.sql` covers expand/backfill parity,
  depth-guarded dual writes, timestamp preservation, later-origin conflict
  resolution, canonical tie-breaking, and client clock-forgery resistance
- `supabase/tests/consent-gate.test.sql` covers all server modes and denial
  states plus RLS/privilege resistance to forged revisions, events, grants,
  wording, timestamps, and configuration
- `supabase/tests/consent-lifecycle.test.sql` covers withdrawal transitions,
  partial-purge retry, operator re-enqueue, re-grant, per-account quarantine,
  purge arming, and evidence-key lifecycle behavior; also covers the
  reconsent cloud-rebuild signal (#538): a verified-zero purge advances the
  monotonic `cloud_rebuild_generation`, `consent_grant` and
  `health_sync_preflight` both surface it, re-granting never resets it, a second
  purge advances it again (the monotonic multi-device property), and a fresh
  first-time grant with no prior purge sits at generation 0
- `supabase/tests/health-deletion-worker.test.sql` proves Cron dispatches the
  Vault-authenticated Edge Function worker, honors capped backoff without an
  abandonment limit, reclaims stale jobs, and completes only after verified
  deletion. Its final section covers what the operator backlog monitor reads:
  partial erasure never advances the user to `withdrawn`, a partially erased job
  is visible as `failed` with a rising attempt count, worker errors are bounded
  before they can reach a log, and a transport-level failure leaves the job in
  the backlog rather than losing it. Since #694 it also proves
  `kilo.health_gated_tables()` names both recovery collections and that leftover
  recovery metadata blocks completion even when every other gated table is empty
  — the state that was previously certified as a finished erasure
- `supabase/tests/reenqueue-health-deletion-consent-gate.test.sql` proves the
  operator re-enqueue RPC is fail-closed on consent state (#598): a `granted`,
  `needs_reconsent`, or stateless account (and a null target) is refused with an
  explicit reason and no job is created, while a `deletion_pending` account's
  failed job is rearmed in place (not duplicated) and a `withdrawn` account
  stays authorized. It also proves the RPC's reported `table_counts` surface
  leftover recovery rows as remaining health data (#694), so an operator cannot
  read a clean bill of health for an unfinished erasure
- `supabase/tests/health-integrity-monitor.test.sql` proves the post-contract
  health-data-loss monitor (#558) flags a genuine loss (a granted account whose
  content-bearing `user_health_profile` row disappeared or went empty) and stays
  quiet for every legitimate absence: never-written, withdrawn,
  `deletion_pending`, and a purge armed after content was last seen. Since #694
  it also pins the gap that quietness leaves: the monitor watches ONE table, so
  an account it is silent about can still hold leftover recovery blocks and week
  memberships, and `kilo.health_data_row_counts()` must report them as remaining
  health data
- `npm run test:health-deletion-monitor` runs the offline contract suite for the
  backlog monitor and the e2e harness: the redaction allowlist (a `user_id`,
  email address, Supabase key, or JWT can never reach an alert surface), all
  five finding kinds, the 0/1/2 exit-code discipline including the
  credentialless exit 2, the harness's two-key production guard, its
  API/database target binding (a mismatched pair is rejected before any account
  or SQL), the rule that a failed fixture cleanup can never exit 0, and each of
  the seven classified boundary failures. It stubs `psql` and never contacts a
  database, a project, or a real secret
- `scripts/test-health-deletion-e2e.mjs` is the separately identifiable
  full-boundary test: it creates a disposable auth account and synthetic gated
  rows, records consent, withdraws, verifies the `health-deletion-drain` cron is
  active and actually invokes `kilo.drain_health_deletion_jobs()`, drives that
  **drain entrypoint** (the function `pg_cron` runs, not
  `dispatch_health_deletion_worker()` directly) and asserts its returned
  `reopened` / `reclaimed_stale` / `dispatched` / `request_id` contract, waits
  for the real pg_net response, proves every table in
  `kilo.health_gated_tables()` is empty and `consent_state` is `withdrawn`, then
  deletes the fixture account in a `finally` block and **confirms** its removal.
  A failed cleanup fails the run and prints the fixture account's uuid — never
  its password or token — so an operator can remove it
- **Target binding.** `KILO_E2E_SUPABASE_URL` and `KILO_E2E_DATABASE_URL` must
  resolve to the same project ref before any account is created or any SQL is
  issued. The ref is parsed from the API host, from `db.<ref>.supabase.co`, or
  from the pooler's `postgres.<ref>` username; an endpoint that cannot be parsed
  is refused rather than assumed safe. Without this, an isolated API URL paired
  with the production database URL satisfied both production guards while every
  write went to production. Production additionally requires **both**
  `--allow-production` and `KILO_E2E_DISPOSABLE_ACCOUNT_CONFIRMED` (set to the
  exact disposable mail domain); ordinary CI points it at a local or isolated
  project. The fixture password is generated at runtime and never printed
- `--scenarios` adds the seven required failure/recovery stages as real drives
  against an isolated target — missing Vault configuration and missing function
  (Vault secrets are *renamed*, never decrypted, and renamed back), HTTP auth
  failure, pg_net transport failure, partial erasure (via
  `complete_health_deletion_job` refusing to advance while rows remain), retry
  with drain-driven recovery, and eventual completion — plus the stale-`running`
  reclaim. It is refused against production unconditionally, with no operator
  override, because the stages park Vault secrets and induce failed jobs.
  Both the happy path and `--scenarios` have been executed end to end against a
  local `supabase start` stack: the happy path drove cron -> drain -> pg_net
  (real HTTP, `status=200`) -> Edge Function -> verified erasure of all 7 gated
  tables, and all 8 scenarios behaved as required
- **Running it locally.** Point `KILO_E2E_SUPABASE_URL` at `http://127.0.0.1:54321`
  and `KILO_E2E_DATABASE_URL` at the local database, set
  `KILO_E2E_ANON_KEY`/`KILO_E2E_SERVICE_ROLE_KEY` from `supabase status`, and set
  `KILO_E2E_EMAIL_DOMAIN`. The worker Vault secrets must name an origin the
  **database container** can reach (`http://kong:8000`), not the host-side
  `127.0.0.1:54321`. Two local-stack caveats: `supabase start` fails to load the
  PostgREST schema cache because `supabase/config.toml` exposes the co-tenant
  `canonical`/`raw`/`serving`/`ops` schemas, which no Kilo migration creates; and
  the harness requires `sslmode=require`, which the local database does not enable
  by default
- **Local and production share a project ref.** `supabase start` names the local
  stack from `config.toml`'s `project_id`, which is the production ref, so local
  containers are literally `supabase_db_ogzhnscdqcdrhfqcobuv`. The target guard is
  not fooled, because it classifies by **endpoint host first**: a loopback
  endpoint resolves to the `local` identity and never reaches the ref comparison,
  and the production ref only ever matches a real `*.supabase.co` host. That
  precedence is pinned by regression tests. It is nonetheless a genuine blind spot
  in identifying a target by ref alone — anything added here must keep host
  classification ahead of ref matching
- `npm run test:deploy-kilo-functions` runs the offline contract tests for
  `scripts/deploy-kilo-functions.sh`. They mock Supabase management-plane and
  database responses, including every fail-closed deployment prerequisite; the
  suite never contacts production or reads secret values.
- `supabase/functions/_shared/health-data-scope.test.ts` is the Deno contract
  suite preventing `account-export`, `account-delete`, and
  `health-data-delete` from diverging from the shared gated table set. It pins
  the set at exactly nine tables (the two recovery collections joined in #694),
  pins recovery memberships ahead of the blocks they reference in deletion
  order, and compares the module against the EFFECTIVE
  `kilo.health_gated_tables()` — resolved from the latest migration that
  redefines it, since a pinned migration path would keep checking a definition
  the database no longer runs. Run it with
  `deno test --no-check --allow-read supabase/functions/_shared/health-data-scope.test.ts`;
  `--no-check` is required only because the shared `supabase-js` client typing
  fails to resolve locally, which is unrelated to the contract under test

### Public Signup Legal And Abuse Checks

- before open signup, verify the public web auth/signup surface links privacy
  and terms beside the signup action, the signed-in Account lifecycle surface
  links them near export/delete actions, and More > About Kilo links them for
  existing users; each link must resolve to the published policy document and
  no `example.com` privacy/terms placeholder may remain
- verify Supabase Auth launch configuration keeps platform rate limits active,
  uses production-owned SMTP for email signup/password recovery, and has CAPTCHA
  enabled for open signup, or records an explicit closed-beta deferral before
  release; see `docs/backend-activation.md` Step 5 for dashboard locations and
  release verification steps for CAPTCHA and SMTP
- verify `account-export` and `account-delete` reject unauthenticated requests,
  include no service-role or secret key in client requests, and enforce both
  per-user and per-IP throttles before open signup
- type-check the account lifecycle Edge Functions after changing shared
  function helpers or CDN imports:
  `deno check --no-lock supabase/functions/account-export/index.ts` and
  `deno check --no-lock supabase/functions/account-delete/index.ts`
- manual throttle verification (issue #328): call `account-export` twice within
  10 minutes as the same user — second call must return HTTP 429; call
  `account-delete` four times within one hour as the same user — fourth call must
  return HTTP 429; call either function six or more times from the same IP within
  the window — calls beyond the IP limit (5 per window) must return HTTP 429

---

## Coverage Gaps

The following MVP behaviors have no automated test coverage:

**End-to-end**
- No automated native test covers native forms, native validation/success UI
  feedback, or native layout/runtime behavior. `mobile/App.js` now has focused
  app-shell coverage for tab switching and Android hardware-back behavior, but
  not a real Expo device/emulator pass.

---

## Dependency Audit Gate

A CI workflow (`.github/workflows/audit.yml`) runs `npm audit --audit-level=high` against both the root and `mobile/` package trees on every push to `main`, on every pull request, and on a weekly schedule (Mondays 06:00 UTC). The job fails if any high-severity or critical vulnerability is found. The weekly run catches new advisories that land against an otherwise-unchanged lockfile before unrelated work merges.

The Expo SDK 56 upgrade in issue #367 cleared the prior mobile `postcss` and
`js-yaml` moderate advisories while preserving the high-severity gate. Issue
#429 then added targeted mobile overrides for `postcss` and `uuid`, so both
root and mobile audit runs report zero known vulnerabilities at closeout.

Run the same check locally:

```sh
npm run audit               # root package tree
npm --prefix mobile audit   # or: cd mobile && npm run audit
```

The gate catches advisories in `package-lock.json` and `mobile/package-lock.json`. It does not perform dependency upgrades; remediation is handled separately.

### Proactive dependency updates

`.github/dependabot.yml` schedules weekly npm version checks for the repository root (`/`) and the mobile workspace (`/mobile`), grouping compatible minor/patch version updates while leaving security updates as separate, independently visible PRs.

`.github/workflows/dependabot-automerge.yml` enables GitHub native auto-merge for narrowly-scoped Dependabot PRs: only when the author is `dependabot[bot]`, the update is a SemVer patch, and the changed files are limited to the root/mobile dependency manifests and lockfiles. Auto-merge still waits on all required status checks (including the audit gate above) and branch protections; the workflow never performs an unconditional merge. End-to-end operation requires repo settings that cannot live in tracked files: *Allow auto-merge*, branch protection on `main` with the audit job as a required check, and Dependabot alerts enabled.

---

## Version Sync Gate

A CI workflow (`.github/workflows/version-check.yml`) runs `node scripts/sync-version.mjs --check` on every push to `main` and on every pull request. The job fails if the mobile version surfaces (`mobile/package.json` and `app.json` `expo.version`) drift from the canonical root `package.json` version.

The canonical app version lives in the root `package.json`. `mobile/package.json` (displayed version) and `app.json` `expo.version` must mirror it. Any required version change and sync must be included in the PR before final review; closeout makes no tracked edits. Note: `expo.version` is no longer the OTA runtime boundary for preview builds; that role is held by `PREVIEW_RUNTIME` in `mobile/app.config.js`.

Run the check or fix drift locally:

```sh
node scripts/sync-version.mjs --check   # report drift (CI gate)
node scripts/sync-version.mjs           # write the canonical version into the mobile files
```

---

## Installable Preview Smoke Checklist

Before declaring the packaged preview ready, a human tester must pass every step below on a physical phone. This is the minimum real-device check for installability, launch, update/relaunch, loading behavior, and basic touch interaction. It is not full product QA.

1. Build and install the native preview APK on a connected phone.
   ```sh
   cd mobile && eas build --platform android --profile preview
   ```
2. Open the app from the phone launcher and confirm it starts without a crash or blank screen.  **[BLOCKER]**
3. Confirm all five tabs are visible and respond to taps: Home, Log, Weight, Analytics, More.  **[BLOCKER]**
4. On **Weight**, confirm the entry field and **Log** button load, the button is disabled when the field is empty, and a valid value such as `185` saves successfully and updates the Entries list.  **[BLOCKER]**
5. Change the visible version text in the packaged app footer from `0.1.0` to `0.1.0-test`, rebuild and redeploy the preview to the same phone, then relaunch it from the launcher. Confirm the app opens normally after the update, the footer now shows `0.1.0-test`, and the saved weight entry is still present.  **[BLOCKER]**
6. On **Log**, enter one simple workout row such as `135 5,5,5`. Confirm the parse preview appears, the header **Save** action becomes enabled, and saving shows the "Workout saved" confirmation screen.  **[BLOCKER]**
7. Return to **Home** and confirm the new workout appears in Recent history with the most recent entry first.  **[BLOCKER]**
8. Do one basic touch pass on the device: scroll Recent history, switch tabs a few times, and confirm taps register cleanly without missed or stuck interactions.  **[BLOCKER]**

---

## Web Export Smoke Check

This is the minimum repeatable verification for the static web export path
(Phase 2 / Task 4, issue #313). It has two parts: a fast automated **pre-flight**
that only proves the static entrypoint is served, and a **required** manual
browser + local-data pass that actually proves the exported app boots and reads
and writes local data. It is intentionally narrow: it is a boot/local-data smoke
check, not full web E2E. No browser automation framework is added as a repo
dependency.

Boot is only considered verified once the required browser + local-data pass
below is performed. The automated pre-flight alone does not prove boot.

Dependency: relies on the static web export from Task 4 / #313
(`app.json` `web.bundler: "metro"` and `web.output: "single"`) being present
after merge. The pre-flight does not inspect or validate that config itself; it
fails fast with a clear message only if `expo export --platform web` does not
emit a `dist/index.html` single-output build.

### Automated pre-flight (`web:smoke`)

This is a fast pre-flight only. Run it first to catch gross export/serve
failures, but **do not** treat a pass as proof that the app boots or reads local
data — it does neither.

Run from the repo root:

```sh
npm run web:smoke
```

This single command:

1. Builds the static web export (`expo export --platform web`) into
   `mobile/dist/`.
2. Asserts `mobile/dist/index.html` exists (proves a single-output web build,
   not a native bundle).
3. Serves the exported output locally with `expo serve` on port `8099`.
4. Fetches the served entrypoint and confirms it is served: an HTTP `200`, the
   `root` mount node in the static HTML, and a referenced `_expo/static/js`
   bundle.
5. Prints `SMOKE PASS` and exits `0` on success, or `SMOKE FAIL: <reason>` and
   exits non-zero so a human or CI runner can gate on it.

What this pre-flight does **not** prove: it never executes the JS bundle, never
observes React Native Web mounting, and never exercises local-data
(AsyncStorage/`localStorage`) behavior. It only confirms the static entrypoint is
served. It can still pass with a bundle that crashes before mount. Use it as a
cheap gate, then run the required pass below for actual boot verification.

### Required browser + local-data boot verification (human)

This is the authoritative boot check. The export is not considered verified until
this pass succeeds. It must be performed in a real browser against the served
export.

```sh
npm run web:export   # build the static export into mobile/dist/
npm run web:serve    # serve mobile/dist/ at http://127.0.0.1:8081/
```

Open `http://127.0.0.1:8081/` in a browser, then:

1. Confirm the app shell **visibly mounts**: the Kilo Home screen renders with
   real content (Welcome card and the five tabs Home, Log, Weight, Analytics,
   More), not just an empty `#root` and no blank screen or console boot crash.
   An empty or text-less `#root` is a failure even if the pre-flight passed.
2. On **Weight**, enter a value such as `185` in the Weight (lb) field and tap
   **Save weigh-in**. Confirm it appears in the History list (the local browser
   storage write path works). Optionally confirm the browser dev tools show a
   `kilo_weight_entries` key in `localStorage`/IndexedDB (the AsyncStorage web
   backend).
3. Reload the page and confirm the saved entry **persists** in the History list
   and trends, proving the export boots against local data rather than a fresh
   empty shell.

Stop and reload from native QA if the served export cannot mount the shell or the
saved entry does not survive reload; that indicates a Task 4 export-config or
local-data regression rather than a smoke-tooling issue.

### Static hosting note

The exported `mobile/dist/` is the static artifact for the documented hosting
target (Cloudflare Pages, Netlify, Vercel static output, or equivalent). The
selected host must serve `index.html` as the SPA fallback entrypoint. `expo
serve` is the local stand-in for that static host during smoke verification; it
is not a production hosting dependency.

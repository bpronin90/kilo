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

For Android release-style update verification after a compatible build is
installed, publish to the configured EAS Update channels from `mobile/`:

```sh
npm --prefix mobile run publish:android -- --message "describe the change"
npm --prefix mobile run publish:android:preview -- --message "describe the change"
```

Use OTA publish only for JavaScript and asset changes. Any native-affecting
change still requires a fresh Android build because `mobile/app.json` uses
`runtimeVersion.policy: "fingerprint"` to block incompatible updates from
reaching existing installs.

Current limitation:

- Native parser and storage modules now have Jest coverage under `mobile/tests/`,
  including tracked-exercise persistence on the canonical workout note and a
  fixture-driven migration contract suite for legacy structured workout
  history, plus weight-goal persistence/derivation coverage, explicit
  weight-pace threshold boundary coverage, canonical goal current-weight
  resolution coverage (latest-entry ordering plus no-entry fallback paths),
  shared weight trend-summary helper coverage, direct
  `deriveWeightGoalAnalytics()` canonical contract coverage for empty/null
  entries, saved-goal/edit-state paths, rolling-series limits, and maintain
  handling, per-session rep-drop-off flag derivation coverage, weekly-summary
  stored-input shaping coverage (session presence and persisted
  classification counts), plain-row progression comparables for note-based
  sessions, lowercase canonical `perDaySignals` key coverage, and malformed
  backup rejection coverage for the optional `weight_goal` v2
  import field.
- Native rendered-screen coverage is still narrow, but `mobile/tests/` now
  includes a `react-test-renderer` suite for the Weight goal card's loss,
  gain, maintain, no-estimate, and pace-warning states, plus merged Trends
  rendering checks that lock the day-level `date` trend bucketing contract
  while confirming Weight history still displays `logged_at`, plus a
  `AnalyticsScreen` consumer-drift regression that spies on
  `deriveWeightGoalAnalytics()` to prove the rendered latest weight and
  7-day/30-day averages come from the shared layer instead of screen-local
  reshaping.
- No automated native test covers broader tab routing or an Expo
  device/emulator pass yet.
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

The repo root no longer hosts an active browser/Vitest suite. After the
browser prototype archival in issue `#213`, the root `package.json` only
retains non-test commands such as `npm run audit`.

---

## Automated Coverage Inventory

### `mobile/tests/parser.test.js`

- parser parity coverage for `mobile/lib/parser.js`
- validates canonical native `parseWeightEntry`, `parseWorkoutRow`, and
  `parseWorkoutEntry` behavior against the same constrained MVP forms preserved
  from the archived browser prototype
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
  changing tracked selections, and best-set selection across multiple days
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
- verifies `getLatestRepDropOff()` returns the latest derived session flag for
  Log and Analytics display, including null-latest and skipped-gap cases
- verifies `deriveWorkoutNoteAnalytics()` canonical layer return shape,
  per-field output (weeksIn, classifications, skipData, repDropOffFlags,
  signals, and `nameDisplayMap`), empty-sections behavior,
  missing-exercise handling, and determinism
- pins direct helper parity for the canonical workout path by asserting
  `deriveWorkoutNoteAnalytics()` matches `computeWeeksIn()`,
  `classifyExerciseSessions()`, `deriveSkipData()`,
  `deriveRepDropOffFlags()`, and `deriveSignals()` for the same inputs
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
- verifies live `repDropOffFlags` returned from
  `deriveWorkoutNoteAnalytics()` distinguish no-drop-off vs `hit_wall`
  current-section patterns without relying on stale persisted badge state
- verifies `deriveWeightGoalAnalytics()` canonical weight/goal return shape and
  per-field outputs across empty/null entries, saved-goal and edited-goal
  paths, `start_weight` fallback, rolling-series limit behavior, pace-level
  nullability, and maintain-goal calorie guidance
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

### `mobile/tests/stats-screen.test.js`

- spies on `deriveWeightGoalAnalytics()` and verifies the rendered
  `StatsScreen` latest-weight display uses the shared-layer `currentWeight`
  result instead of any raw-entry local sort or pick
- verifies the rendered `7-day` and `30-day` weight averages come from the
  shared-layer `avg7` / `avg30` outputs
- verifies exercises are grouped by routine day with correct group headers
- verifies multi-day exercises render per-day row metrics from
  `perDaySignals`, including null-trend fallback to the global signal and
  bodyweight `reps` units in cross-day chips
- verifies alias exercise names in the note still resolve to the canonical
  tracked signal row
- verifies redesigned 1K Progress card renders hero total, progress bar,
  and full breakdown labels (Squats, Bench, Deadlifts)

### `mobile/tests/storage.test.js`

- AsyncStorage-backed load/save/delete/update/migrate coverage for
  `mobile/storage/entries.js`
- verifies empty-load behavior, newest-first sorting, update misses, workout
  note save/overwrite/clear behavior, tracked-exercise persistence across note
  edits, optional user-profile persistence, and migration of legacy structured
  sessions into the canonical workout-note document
- includes a contract-driven migration suite that verifies weighted entries,
  non-weight entries, mixed weighted-plus-metadata entries, positional skip
  slots, multi-session count preservation, and session-view-visible mixed-entry
  comments after `buildSessionsFromNote()`

### `mobile/tests/weight-goal-ui.test.js`

- rendered React Native screen coverage for `mobile/screens/WeightScreen.js`
  using `react-test-renderer`
- verifies saved-goal derived-state presentation for loss, gain, maintain, and
  no-estimate cases
- verifies advisory warning copy for aggressive and unrealistic pace states
- exercises the saved-goal display path with `start_weight` fallback coverage
  rather than only pure helper-level calculation tests

### `mobile/tests/weight-screen.test.js`

- rendered React Native screen coverage for the Weight screen edit and delete
  correction flows using `react-test-renderer`
- verifies tapping a history row loads the entry into the form in editing mode
  (sets `editingId`, populates weight and note inputs)
- verifies edit submit reruns `parseWeightEntry` validation and calls `update`
  with the correct entry id and note on valid input
- verifies edit submit shows a validation error and does not call `update` when
  the weight field contains invalid input
- verifies tapping the delete affordance (✕) triggers `Alert.alert` with a
  confirm prompt and calls `remove` on the destructive confirmation
- verifies cancelling the delete prompt does not call `remove`

---

## Coverage Gaps

The following MVP behaviors have no automated test coverage:

**End-to-end**
- No automated native test covers `mobile/App.js`, native tab routing, native
  forms, native validation/success UI feedback, or native layout/runtime
  behavior

---

## Dependency Audit Gate

A CI workflow (`.github/workflows/audit.yml`) runs `npm audit --audit-level=high` against both the root and `mobile/` package trees on every push to `main` and on every pull request. The job fails if any high-severity or critical vulnerability is found.

Run the same check locally:

```sh
npm run audit               # root package tree
npm --prefix mobile audit   # or: cd mobile && npm run audit
```

The gate catches advisories in `package-lock.json` and `mobile/package-lock.json`. It does not perform dependency upgrades; remediation is handled separately.

---

## Version Sync Gate

A CI workflow (`.github/workflows/version-check.yml`) runs `node scripts/sync-version.mjs --check` on every push to `main` and on every pull request. The job fails if the mobile version surfaces (`mobile/package.json` and `app.json` `expo.version`) drift from the canonical root `package.json` version.

The canonical app version lives in the root `package.json`. `mobile/package.json` (displayed version) and `app.json` `expo.version` (OTA `appVersion` runtime boundary) must mirror it. The closeout script (`scripts/close-issue.sh`) runs the same sync after bumping the root version, so a normal closeout keeps all three aligned automatically.

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

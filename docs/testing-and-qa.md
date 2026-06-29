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

For release-style update verification after a compatible build is installed,
publish to the configured EAS Update channels from `mobile/`:

```sh
npm --prefix mobile run update:android:preview
npm --prefix mobile run update:ios:preview
```

iOS preview builds (`ios-simulator`, `ios-device`) are bound to the same
`preview` channel. Live on-device iOS delivery is not yet verified end to end
(deferred pending an iOS build, issue #63).

Use OTA publish only for JavaScript and asset changes. Any native-affecting
change still requires a fresh Android build. Preview builds use a stable manual
runtime string (`preview-1`) in `mobile/app.config.js`; app version bumps alone
do not force a rebuild. Only bump `PREVIEW_RUNTIME` in `mobile/app.config.js`
when a native-incompatible change actually requires it.

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
  handling, per-session rep-drop-off flag derivation coverage,
  fatigue session check-in detection coverage (`deriveSessionCheckIn` detectors
  plus `deriveCheckInHistory` list/summary shaping), within-row skipped-set
  parser coverage, `session_checkins` storage round-trip coverage,
  weekly-summary stored-input shaping coverage (session presence and persisted
  classification counts), plain-row progression comparables for note-based
  sessions, lowercase canonical `perDaySignals` key coverage, and malformed
  backup rejection coverage for the optional `weight_goal` v2
  import field.
- Native rendered-screen coverage is still narrow, but `mobile/tests/` now
  includes a `log-screen.test.js` parser-and-render-logic suite covering
  skip-marker interleaving and bare-unparsed-row chronological positioning for
  the workout-note clean view, plus source-contract coverage that pins the
  Log autosave regression boundary by asserting both debounce timers pass
  `{ autosave: true }` and both save handlers guard the visible `Saved!`
  notice behind `!autosave`, plus the past-deload save-path regression boundary
  by asserting the non-current note editor reuses one in-flight save promise
  during `Done` flushes and clears that pending state in `finally`, plus a
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
  `DateTimePicker` `onChange` callback wiring, plus web fallback coverage for
  Weight DOM date inputs, plus targeted account lifecycle UI coverage for
  server-owned export/delete calls, local session clearing after successful
  deletion, function error surfacing, and absence of service-role keys in
  client fetch headers. The same `log-screen.test.js` suite now also
  includes `react-test-renderer` coverage for the rendered App Guide workout
  example, the aligned Log editor placeholder, current-note Undo, saved-note
  Undo, and failure-path handling around note-scoped Undo for editable deload
  records, plus source-contract coverage for the explicit single-press Log edit
  path and Log deload-date web fallback. `mobile/App.js` app-shell coverage now
  covers initial tab visibility, tab switching through the shared `TabBar`
  contract, Android hardware-back behavior from Home and non-Home tabs, and the
  web-only Home back affordance. Full transactional undo guarantees across
  linked records are still deferred until a DB-backed persistence layer exists.
- No automated native test covers an Expo device/emulator pass yet.
- Android GitHub OAuth has rendered regression coverage for button visibility,
  browser success/cancellation/provider errors, PKCE code exchange, missing
  callback data, and session-exchange failures. The custom
  `kilo://auth/callback` return and restart persistence still require an
  installed development/preview build; Expo Go is not sufficient. Because the
  OAuth implementation adds `expo-web-browser` and a native URL scheme, the
  first release containing it requires a fresh APK/AAB rather than OTA-only
  delivery.
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
- verifies a saved goal renders the split target + guidance presentation rather
  than collapsing all goal information into one card
- verifies the active weigh-in date picker exposes the native `onChange`
  callback and updates the visible ISO date when a new date is selected
- verifies the goal target-date picker exposes the native `onChange`
  callback and updates the visible MM-DD-YYYY label when a new date is
  selected

### `mobile/tests/bootstrap-cloud.test.js` and `mobile/tests/offline-sync.test.js`

- cover archived weight-goal cloud transport wiring so dirty
  `archived_weight_goals` records are pushed, remote archived goals are pulled
  into local storage, and the sync result set includes the table alongside
  weight entries and workout notes
- keep the fake offline-sync cloud table map aligned with all tables processed
  by the sync adapter, preventing new sync tables from regressing existing
  offline create/edit/delete tests

### `mobile/tests/account-lifecycle-ui.test.js`

- rendered hook/UI-adjacent coverage for the signed-in account export/delete
  flow in `mobile/hooks/useAuthSession.js`
- verifies configured Android builds render GitHub sign-in, open the system auth
  browser with `kilo://auth/callback`, exchange only the returned PKCE code, and
  surface cancellation, provider, missing-callback, and exchange failures
- verifies Account consumes an injected app-shell auth object, preserving the
  cold-start loading gate while rendering a resolved signed-in session
  immediately without a signed-out form flash
- verifies `serverExport()` calls `/functions/v1/account-export` with the
  current session JWT and returns the JSON payload on success
- verifies export and deletion function errors are surfaced without clearing
  local session state
- verifies `deleteAccount()` calls `/functions/v1/account-delete`, then signs
  out and clears local session state only after a successful server response
- verifies the mobile/web client never includes a service-role or secret key in
  fetch headers

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

### `supabase/tests/account-lifecycle.test.sql`

- pgTAP requester-isolation coverage for the `kilo` schema account lifecycle
  contract
- verifies a signed-in user can select only their own rows across all seven app
  tables
- verifies cross-user delete attempts affect zero rows under RLS
- verifies owner self-delete removes the requester's rows while preserving
  another user's rows
- rate-limit coverage is at the Edge Function layer and requires manual
  verification (see Public Signup Legal And Abuse Checks above); the pgTAP suite
  covers only DB-layer isolation
- run with `supabase test db --file supabase/tests/account-lifecycle.test.sql`
  from repo root, or `supabase test db --file tests/account-lifecycle.test.sql`
  from inside `supabase/`

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
`js-yaml` moderate advisories while preserving the high-severity gate. A
moderate `uuid` advisory remains on the mobile dependency tree through
dev-tooling paths and is tracked separately; it is not part of the blocking
high-severity gate.

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

The canonical app version lives in the root `package.json`. `mobile/package.json` (displayed version) and `app.json` `expo.version` must mirror it. The closeout script (`scripts/close-issue.sh`) runs the same sync after bumping the root version, so a normal closeout keeps all three aligned automatically. Note: `expo.version` is no longer the OTA runtime boundary for preview builds; that role is held by `PREVIEW_RUNTIME` in `mobile/app.config.js`.

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

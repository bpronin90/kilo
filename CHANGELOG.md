# Changelog

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

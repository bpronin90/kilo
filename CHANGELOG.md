# Changelog

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

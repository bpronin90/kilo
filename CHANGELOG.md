# Changelog

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

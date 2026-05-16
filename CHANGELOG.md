# Changelog

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

# Changelog

## 0.1.1 - 2026-05-10

- Issue #28: Replaced the plain `Kilo` text treatment with the approved Direction 3 brand lockup in the app header and More screen footer, and added shipped brand assets for the prototype UI.
- Issue #31: Added `npm run build` script that stages `Kilo.html` and `src/` into `www/` for Capacitor packaging. Added `.gitignore` to exclude `www/` and `node_modules/`.
- Issue #29: Initialized Capacitor with Android as the single native target. Added `capacitor.config.json` (appId `com.benpronin.kilo`, webDir `www`), generated `android/` project directory, and added `cap:sync` and `cap:open` npm scripts.

## 0.1.0 - 2026-05-10

- Issue #25: Established the initial documented MVP baseline, added canonical repo versioning in `package.json`, and defined lightweight pre-1.0 versioning and changelog rules in `AGENTS.md`.
- Issue #26: Refactored the More screen footer to render the app version from a new runtime global seeded in `src/data.jsx`.

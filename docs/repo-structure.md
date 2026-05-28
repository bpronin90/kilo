# Repo Structure

This document maps the MVP-relevant areas of the Kilo repository for a human
reviewer or agent performing launch validation.

---

## Entry Point

`Kilo.html` — the source browser entry point. It loads React, ReactDOM, and
Babel from CDN, then loads all source files as `<script type="text/babel">`
tags. For direct browser use, start a local server and open this file:

```sh
python3 -m http.server 8000
# open http://localhost:8000/Kilo.html
```

For mobile packaging or a stable staged web artifact, run:

```sh
npm run build
```

That produces `www/index.html` plus `www/src/` by copying `Kilo.html` and the
current `src/` tree without changing runtime behavior.

To package that staged web app into the current device target:

```sh
npm run cap:sync
npm run cap:open
```

`cap:sync` copies `www/` into `android/app/src/main/assets/public/` and updates
generated Capacitor config assets. `cap:open` opens the Android project in
Android Studio for device install and launch.

For the real native app path, run the Expo scaffold in `mobile/`:

```sh
npm run mobile:start
```

Open Expo Go or an emulator from that dev server, or use:

```sh
npm run mobile:android
```

---

## Directory Layout

```
Kilo.html              ← browser entry point
README.md
AGENTS.md              ← shared repo protocol
CLAUDE.md / CODEX.md / GEMINI.md  ← per-agent instructions
.gitignore             ← root ignore policy for generated output and local-only runtime state
package.json
capacitor.config.json    ← Capacitor app id/name + staged webDir
vitest.config.js
www/                   ← generated build output from `npm run build` (not committed)
android/               ← intentionally tracked Capacitor shell source; generated build artifacts are excluded by `android/.gitignore`
mobile/                ← active Expo / React Native app path

src/                   ← all application source
  app.jsx
  data.jsx
  parser.jsx
  components/
    ui.jsx             ← shared UI primitives (MVP)
    ios-frame.jsx      ← prototype chrome only
    android-frame.jsx  ← prototype chrome only
    design-canvas.jsx  ← prototype chrome only
    tweaks-panel.jsx   ← prototype chrome only
  screens/
    home.jsx
    log.jsx
    weight.jsx
    stats.jsx
    more.jsx

tests/
  setup.js
  parser.test.jsx
  weight-ui.test.jsx
  log-ui.test.jsx

docs/
  current-state.md
  architecture.md
  testing-and-qa.md
  mvp-roadmap.md
  mvp-v2-roadmap.md
  design-system-map.md ← cross-screen style audit: every color, font, spacing token with file and line
  phone-runbook.md
  repo-structure.md    ← this file
  archive/
    original-spec.md   ← original product spec; superseded by docs/ above
    samples/           ← raw workout log files used during parser development

mobile/
  App.js               ← native root; tab state + native save/reload wiring
  index.js             ← Expo root registration
  app.json             ← Expo app metadata
  package.json
  assets/
    brand/
      logo.png
      wordmark.png
  components/
    ScreenShell.js     ← native screen wrapper
    TabBar.js          ← native tab bar
    UI.js              ← shared native UI primitives
  lib/
    data.js            ← native entry factories + exercise catalog
    format.js          ← native timestamp formatter
    parser.js          ← native MVP parser port
  hooks/
    useEntries.js      ← native read/write hooks for weight/workout entries
  screens/
    HomeScreen.js
    MoreScreen.js
    LogScreen.js
    WeightScreen.js
    StatsScreen.js
  theme/
    colors.js          ← shared native color tokens
  storage/
    entries.js         ← AsyncStorage CRUD for weight/workout entries
  tests/
    parser.test.js     ← native parser parity tests
    storage.test.js    ← native AsyncStorage tests
```

---

## Script Load Order

`Kilo.html` loads files in this order. Changing the order breaks global
dependencies.

1. `src/components/ios-frame.jsx`, `src/components/android-frame.jsx`,
   `src/components/design-canvas.jsx`, `src/components/tweaks-panel.jsx` —
   prototype chrome only; not part of the MVP logging loop (see below)
2. `src/parser.jsx` — pure parse functions; no DOM or React dependency
3. `src/data.jsx` — seeds all globals; depends on `src/parser.jsx`
4. `src/components/ui.jsx` — shared UI primitives; depends on globals from `src/data.jsx`
5. `src/screens/home.jsx`, `src/screens/log.jsx`, `src/screens/weight.jsx`,
   `src/screens/stats.jsx`, `src/screens/more.jsx`
6. `src/app.jsx` — root component; references all screen components

---

## MVP Source Files

These files implement the core MVP logging loop. They are the primary surfaces
for code review and manual validation.

| File | Role |
|------|------|
| `src/parser.jsx` | All parse and validation logic. Two paths: legacy freeform (`parseKiloInput`) for read-only history display; MVP canonical (`parseWeightEntry`, `parseWorkoutRow`, `parseWorkoutEntry`) for save. |
| `src/data.jsx` | Seed data (exercises, sessions, weight log, goals). Builds `window.KILO_*` globals on page load. Also contains the three correction helpers (`deleteWeightEntry`, `updateWeightEntry`, `deleteWorkoutSession`). |
| `src/components/ui.jsx` | Design tokens (`KILO_C`), shared components (`KiloHeader`, `KiloTabBar`, `KiloIcon`, `KiloSection`, `KiloPill`, `KiloNum`). No business logic. |
| `src/screens/weight.jsx` | Weight log screen. Merges `localStorage` entries into `KILO_WEIGHTS` on load via an IIFE. Exports `persistWeightEntry` as a global. |
| `src/screens/log.jsx` | Workout log screen. Merges `localStorage` sessions into `KILO_SESSIONS` on load via an IIFE. Exports `persistWorkoutSession` as a global. |
| `src/screens/home.jsx` | Home / dashboard. Quick-log weight entry; recent history combined feed; featured goal; today's split. |
| `src/screens/stats.jsx` | Stats screen. 1RM display per exercise; unified history list; exercise drilldown. Read-only; no save or correction flows. |
| `src/screens/more.jsx` | More screen. Goals list and PT info. Read-only at MVP. |
| `src/app.jsx` | Root. Tab routing via `React.useState`. Renders active screen and `KiloTabBar`. |

## Native App Files

These files define the current real native app path.

| File | Role |
|------|------|
| `mobile/App.js` | Root native app shell. Owns five-tab routing (`Home`, `Log`, `Weight`, `Analytics`, `More`), calls native parser/save hooks, and adapts persisted entries for the Home and Analytics screens. |
| `mobile/components/ScreenShell.js` | Shared native screen wrapper with bundled logo/wordmark branding, alpha version badge, and scroll container. |
| `mobile/components/TabBar.js` | Shared native bottom tab bar. |
| `mobile/components/UI.js` | Shared native cards, buttons, chips, section titles, and stat cards. |
| `mobile/components/LogEmptyState.js` | Presentational Log-tab empty state shown when no workout routine exists yet (intro copy, `New Routine` action, example-format card). |
| `mobile/hooks/useEntries.js` | React hooks exposing native load/add/remove/update APIs for weight entries and workout sessions. |
| `mobile/lib/data.js` | Native exercise catalog plus `makeWeightEntry` / `makeWorkoutSession` factories. |
| `mobile/screens/HomeScreen.js` | Native dashboard with weekly summary, weight goal, and 1k Club progress cards. |
| `mobile/screens/MoreScreen.js` | Native More tab menu plus Profile, Backup, Settings, Help, and About sub-screens. |
| `mobile/screens/LogScreen.js` | Native workout logging form UI. |
| `mobile/screens/WeightScreen.js` | Native weight logging form UI. |
| `mobile/screens/StatsScreen.js` | Native Analytics tab UI for tracked-lift and bodyweight detail. |
| `mobile/storage/entries.js` | AsyncStorage persistence module for weight entries and workout sessions. |
| `mobile/theme/colors.js` | Shared native color tokens. |
| `mobile/lib/format.js` | Shared native timestamp formatting helper. |

---

## Prototype-Only Files

These files are loaded by `Kilo.html` and visible in the browser but are not
part of the MVP logging loop. A launch reviewer can ignore them.

| File | Role |
|------|------|
| `src/components/ios-frame.jsx` | iOS device frame shell |
| `src/components/android-frame.jsx` | Android device frame shell |
| `src/components/design-canvas.jsx` | Design-canvas container used during development |
| `src/components/tweaks-panel.jsx` | Live-tweaks panel for prototype tuning |

---

## Test Files

| File | Role |
|------|------|
| `tests/setup.js` | Global runtime contract for jsdom. Sets `global.React`, `global.KILO_C`, `global.KILO_TODAY`, empty arrays for `KILO_WEIGHTS` / `KILO_SESSIONS` / etc. Runs `cleanup()` and `localStorage.clear()` after each test. |
| `tests/parser.test.jsx` | Parser unit tests: `parseWeightEntry`, `parseWorkoutRow`, `parseWorkoutEntry`. |
| `tests/weight-ui.test.jsx` | Weight-log UI tests: `KiloWeight` and `KiloHome` button states, success/failure feedback, `localStorage` write shape, `parseWeightEntry` acceptance/rejection cases. |
| `tests/log-ui.test.jsx` | Workout-log UI tests for the `KiloLog` screen. |
| `mobile/tests/parser.test.js` | Native parser parity tests for `mobile/lib/parser.js`. |
| `mobile/tests/storage.test.js` | Native storage tests for `mobile/storage/entries.js` using the AsyncStorage Jest mock. |
| `vitest.config.js` | Vitest config. `jsdom` environment, `globals: true`, `esbuild` JSX factory set for React without imports. |

Run the suite:

```sh
npm test
```

---

## Docs

| File | Role |
|------|------|
| `docs/current-state.md` | Single source of truth for MVP status: what is implemented, known gaps, and the launch prerequisite checklist. Read this first. |
| `docs/architecture.md` | Script load order, screen routing, parser paths, persistence model, entry shapes, global state map. |
| `docs/testing-and-qa.md` | Automated coverage inventory and the full manual smoke checklist with **[BLOCKER]** steps for launch. |
| `docs/mvp-roadmap.md` | Full ordered roadmap from Phase 1 through launch. Includes the Pre-Launch Repo Readiness Sequence and the hold statement for issue #17. Covers the original MVP scope. |
| `docs/mvp-v2-roadmap.md` | Roadmap for MVP v2, which redefines the product around a freeform logging model rather than the rigid tracker model. Extends and supersedes portions of `docs/mvp-roadmap.md` for post-v1 work. |
| `docs/design-system-map.md` | Cross-screen style audit: every color token, font size, spacing value, and card treatment with file paths and line numbers. Reference for manual visual refinement. |
| `docs/phone-runbook.md` | Operational runbook for running the Expo app from WSL and loading it on a physical device via Expo Go. |
| `docs/repo-structure.md` | This file. |
| `docs/calculations-reference.md` | Human-readable calculations reference covering workout analytics, weight trends, goal guidance, and user configuration. Describes current app behavior in plain language, designed to map onto future in-app help surfaces. |
| `docs/archive/original-spec.md` | Original product spec from early planning. Superseded by `docs/mvp-roadmap.md` and `docs/current-state.md`. |
| `docs/archive/samples/` | Raw workout log files used as reference input during parser development. No active role in code or tests. |

---

## Key Cross-File Dependencies

These implicit dependencies exist because there is no bundler. Load order in
`Kilo.html` is the only enforcement mechanism.

- `src/data.jsx` calls `window.parseKiloInput` and `window.adjusted1RM` — both
  must be set by `src/parser.jsx` before `src/data.jsx` runs.
- `src/screens/home.jsx` calls `window.persistWeightEntry` — set by
  `src/screens/weight.jsx`. This is a runtime dependency only: `persistWeightEntry`
  is invoked during user interaction (after all scripts have loaded), not at
  parse time. `Kilo.html` loads `home.jsx` before `weight.jsx` and the app
  works correctly; no reordering is required.
- All screens call `window.KILO_C`, `window.KiloHeader`, etc. — set by
  `src/components/ui.jsx`; must load before any screen.
- All screens read `window.KILO_TODAY`, `window.KILO_SPLIT`, etc. — set by
  `src/data.jsx`; must load before any screen.

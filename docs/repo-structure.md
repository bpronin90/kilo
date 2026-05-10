# Repo Structure

This document maps the MVP-relevant areas of the Kilo repository for a human
reviewer or agent performing launch validation.

---

## Entry Point

`Kilo.html` — the only file a browser needs to open. It loads React, ReactDOM,
and Babel from CDN, then loads all source files as `<script type="text/babel">`
tags. No build step. Start a local server and open this file:

```sh
python3 -m http.server 8000
# open http://localhost:8000/Kilo.html
```

---

## Directory Layout

```
Kilo.html              ← browser entry point
README.md
AGENTS.md              ← shared repo protocol
CLAUDE.md / CODEX.md / GEMINI.md  ← per-agent instructions
package.json
vitest.config.js

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

docs/
  current-state.md
  architecture.md
  testing-and-qa.md
  mvp-roadmap.md
  repo-structure.md    ← this file
  archive/
    original-spec.md   ← original product spec; superseded by docs/ above
    samples/           ← raw workout log files used during parser development
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
| `docs/mvp-roadmap.md` | Full ordered roadmap from Phase 1 through launch. Includes the Pre-Launch Repo Readiness Sequence and the hold statement for issue #17. |
| `docs/repo-structure.md` | This file. |
| `docs/archive/original-spec.md` | Original product spec from early planning. Superseded by `docs/mvp-roadmap.md` and `docs/current-state.md`. |
| `docs/archive/samples/` | Raw workout log files used as reference input during parser development. No active role in code or tests. |

---

## Key Cross-File Dependencies

These implicit dependencies exist because there is no bundler. Load order in
`Kilo.html` is the only enforcement mechanism.

- `src/data.jsx` calls `window.parseKiloInput` and `window.adjusted1RM` — both
  must be set by `src/parser.jsx` before `src/data.jsx` runs.
- `src/screens/home.jsx` calls `window.persistWeightEntry` — set by
  `src/screens/weight.jsx`; load order must put `weight.jsx` before `home.jsx`.
- All screens call `window.KILO_C`, `window.KiloHeader`, etc. — set by
  `src/components/ui.jsx`; must load before any screen.
- All screens read `window.KILO_TODAY`, `window.KILO_SPLIT`, etc. — set by
  `src/data.jsx`; must load before any screen.

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

## Script Load Order

`Kilo.html` loads files in this order. Changing the order breaks global
dependencies.

1. `components/ios-frame.jsx`, `components/android-frame.jsx`,
   `components/design-canvas.jsx`, `components/tweaks-panel.jsx` — prototype
   chrome only; not part of the MVP logging loop (see below)
2. `parser.jsx` — pure parse functions; no DOM or React dependency
3. `data.jsx` — seeds all globals; depends on `parser.jsx`
4. `components/ui.jsx` — shared UI primitives; depends on globals from `data.jsx`
5. `screens/home.jsx`, `screens/log.jsx`, `screens/weight.jsx`,
   `screens/stats.jsx`, `screens/more.jsx`
6. `app.jsx` — root component; references all screen components

---

## MVP Source Files

These files implement the core MVP logging loop. They are the primary surfaces
for code review and manual validation.

| File | Role |
|------|------|
| `parser.jsx` | All parse and validation logic. Two paths: legacy freeform (`parseKiloInput`) for read-only history display; MVP canonical (`parseWeightEntry`, `parseWorkoutRow`, `parseWorkoutEntry`) for save. |
| `data.jsx` | Seed data (exercises, sessions, weight log, goals). Builds `window.KILO_*` globals on page load. Also contains the three correction helpers (`deleteWeightEntry`, `updateWeightEntry`, `deleteWorkoutSession`). |
| `components/ui.jsx` | Design tokens (`KILO_C`), shared components (`KiloHeader`, `KiloTabBar`, `KiloIcon`, `KiloSection`, `KiloPill`, `KiloNum`). No business logic. |
| `screens/weight.jsx` | Weight log screen. Merges `localStorage` entries into `KILO_WEIGHTS` on load via an IIFE. Exports `persistWeightEntry` as a global. |
| `screens/log.jsx` | Workout log screen. Merges `localStorage` sessions into `KILO_SESSIONS` on load via an IIFE. Exports `persistWorkoutSession` as a global. |
| `screens/home.jsx` | Home / dashboard. Quick-log weight entry; recent history combined feed; featured goal; today's split. |
| `screens/stats.jsx` | Stats screen. 1RM display per exercise; unified history list; exercise drilldown. Read-only; no save or correction flows. |
| `screens/more.jsx` | More screen. Goals list and PT info. Read-only at MVP. |
| `app.jsx` | Root. Tab routing via `React.useState`. Renders active screen and `KiloTabBar`. |

---

## Prototype-Only Files

These files are loaded by `Kilo.html` and visible in the browser but are not
part of the MVP logging loop. A launch reviewer can ignore them.

| File | Role |
|------|------|
| `components/ios-frame.jsx` | iOS device frame shell |
| `components/android-frame.jsx` | Android device frame shell |
| `components/design-canvas.jsx` | Design-canvas container used during development |
| `components/tweaks-panel.jsx` | Live-tweaks panel for prototype tuning |

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

---

## Other Files

| File | Role |
|------|------|
| `AGENTS.md` | Shared repo protocol for all agents: task contract, scope control, git and completion rules. |
| `CLAUDE.md`, `CODEX.md`, `GEMINI.md` | Per-agent instructions. |
| `samples/current_workout`, `samples/latest_deload`, `samples/previous_workout` | Raw workout text files used as reference input during prototype development. Not referenced by any source code or tests. No active role at launch. |
| `Kilo — Fitness Tracker App Spec.md` | Original product spec used during early planning. Superseded by `docs/mvp-roadmap.md` and `docs/current-state.md` for launch purposes. |
| `README.md` | Repo entry point. Start here. |

---

## Key Cross-File Dependencies

These implicit dependencies exist because there is no bundler. Load order in
`Kilo.html` is the only enforcement mechanism.

- `data.jsx` calls `window.parseKiloInput` and `window.adjusted1RM` — both must
  be set by `parser.jsx` before `data.jsx` runs.
- `screens/home.jsx` calls `window.persistWeightEntry` — set by
  `screens/weight.jsx`; load order must put `weight.jsx` before `home.jsx`.
- All screens call `window.KILO_C`, `window.KiloHeader`, etc. — set by
  `components/ui.jsx`; must load before any screen.
- All screens read `window.KILO_TODAY`, `window.KILO_SPLIT`, etc. — set by
  `data.jsx`; must load before any screen.

---

## Structural Verdict (Issue #23)

The current repo structure is **acceptable as-is for launch**. The code
boundaries between parser, data, UI primitives, screens, and tests are clear
and well-matched to the MVP scope. No code reorganization is needed before
launch validation.

### Must-fix (docs only)

Both were resolved as part of issue #23:

- `README.md` was empty — now written.
- `docs/repo-structure.md` did not exist — this file.

### Nice-to-have (not blocking)

- `samples/` contains three raw workout text files with no active role. They can
  be removed after launch without affecting any behavior.
- `Kilo — Fitness Tracker App Spec.md` is superseded by the `docs/` files.
  Can be removed after launch.

Neither removal is required before issue #17 proceeds.

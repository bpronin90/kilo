# Repo Structure

This document maps the MVP-relevant areas of the Kilo repository for a human
reviewer or agent performing launch validation.

---

## Entry Point

The active app is the Expo / React Native app in `mobile/`. Run it with:

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
README.md
AGENTS.md              ← shared repo protocol
CLAUDE.md / CODEX.md / GEMINI.md  ← per-agent instructions
.gitignore             ← root ignore policy for generated output and local-only runtime state
package.json
mobile/                ← active Expo / React Native app path

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
    browser-prototype/ ← archived frozen browser prototype (Kilo.html, src/, tests/)

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

## App Files

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

## Test Files

| File | Role |
|------|------|
| `mobile/tests/parser.test.js` | Native parser parity tests for `mobile/lib/parser.js`. |
| `mobile/tests/storage.test.js` | Native storage tests for `mobile/storage/entries.js` using the AsyncStorage Jest mock. |

Run the native test suite:

```sh
npm --prefix mobile test
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


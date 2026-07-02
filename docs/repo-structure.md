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
CONTRIBUTING.md        ← public contributor guide (setup, issue/PR workflow, testing, versioning)
AGENTS.md              ← shared repo protocol (local-only, gitignored — not tracked)
CLAUDE.md / CODEX.md / GEMINI.md  ← per-agent instructions (local-only, gitignored — not tracked)
.gitignore             ← root ignore policy for generated output, local-only runtime state, and agent instruction files
package.json
mobile/                ← active Expo / React Native app path
scripts/               ← repository maintenance and deployment entrypoints
supabase/              ← tracked Supabase config, Edge Functions, and DB tests

docs/
  current-state.md
  architecture.md
  testing-and-qa.md
  backend-roadmap.md
  backend-activation.md ← backend activation runbook
  backend-schema.md    ← cloud schema and source-of-truth policy
  ui-design-rules.md   ← adopted UI design rules; companion to design-system-map.md
  design-system-map.md ← cross-screen style audit: every color, font, spacing token with file and line
  calculations-reference.md
  phone-runbook.md
  tester-guide.md      ← tester-facing preview install guide
  repo-structure.md    ← this file
  archive/
    original-spec.md   ← original product spec; superseded by docs/ above
    mvp-roadmap.md     ← archived MVP1 roadmap
    mvp-v2-roadmap.md  ← archived MVP2 roadmap
    mvp-v3-roadmap.md  ← archived MVP3 roadmap
    mvp-v3.5-roadmap.md ← archived MVP3.5 roadmap
    mvp-v4-roadmap.md  ← archived MVP4 roadmap
    mvp-v4.5-roadmap.md ← archived MVP4.5 roadmap
    mvp-refine-roadmap.md ← archived MVP-Refine roadmap
    mvp-fatigue-roadmap.md ← archived Session Check-In / Fatigue roadmap
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
    LogEmptyState.js   ← Log-tab empty state (intro copy, New Routine action)
    SessionCheckInModal.js ← fatigue session check-in prompt modal (Log + Analytics)
  lib/
    data.js            ← compatibility barrel for shared data exports
    data/              ← domain exercise, weight, routine, fatigue, 1K, and analytics helpers
    format.js          ← native timestamp formatter
    parser.js          ← compatibility barrel for parser and derived-analytics exports
    parser/            ← domain weight/workout parsing, sessions, analytics, exercise names, and deload helpers
  hooks/
    useEntries.js      ← compatibility barrel for native entry hooks
    entries/           ← domain hook implementations for entries, settings, profile, and sync
  screens/
    HomeScreen.js
    home/             ← Home screen local dashboard derivation helper
    MoreScreen.js
    more/             ← More screen local account, cloud recovery, lifecycle, and legal-link panels
    LogScreen.js
    log/              ← Log screen local editor/controller hooks
    WeightScreen.js
    AnalyticsScreen.js
    analytics/        ← Analytics screen local derivation and grouping helpers
  theme/
    colors.js          ← shared native color tokens
  storage/
    entries.js         ← compatibility barrel for local persistence exports
    entries/           ← domain storage, backup/import, migration, and adapter-mode modules
    cloudAdapter.js    ← compatibility barrel and assembler for cloud storage exports
    cloud/             ← cloud bootstrap, transport, sync, domain-method, and error modules
  tests/
    parser.test.js     ← native parser parity tests
    data.test.js       ← native analytics/data helper contract tests
    format.test.js     ← native formatting and weight-delta helper tests
    analytics-screen.test.js ← native Analytics screen consumer checks
    storage.test.js    ← native AsyncStorage tests
    weight-goal-ui.test.js ← native Weight goal rendering checks
    account-lifecycle-ui.test.js ← account export/delete hook and UI tests

supabase/
  config.toml           ← project-local config, exposed schemas, and Edge Function JWT settings
  functions/
    _shared/            ← shared Edge Function helpers
    account-export/     ← requester-only cloud account export endpoint
    account-delete/     ← requester-only app-data deletion + auth-user deletion endpoint
  tests/
    account-lifecycle.test.sql ← pgTAP requester-isolation checks

scripts/
  sync-version.mjs     ← syncs mobile version fields from root package.json
  deploy-kilo-functions.sh ← deploys kilo Edge Functions to the tracked remote project ref
```

---

## App Files

These files define the current real native app path.

| File | Role |
|------|------|
| `mobile/App.js` | Root native app shell. Owns five-tab routing (`Home`, `Log`, `Weight`, `Analytics`, `More`), calls native parser/save hooks, and adapts persisted entries for the Home and Analytics screens. |
| `mobile/components/ScreenShell.js` | Shared native screen wrapper with the common header, version badge, scroll container, and shared tab-bar scroll signaling. |
| `mobile/components/TabBar.js` | Shared native bottom tab bar. |
| `mobile/components/UI.js` | Shared native cards, buttons, chips, section titles, and stat cards. |
| `mobile/components/LogEmptyState.js` | Presentational Log-tab empty state shown when no workout routine exists yet (intro copy, `New Routine` action, example-format card). |
| `mobile/components/SessionCheckInModal.js` | Centered fatigue check-in prompt modal. Opened from `LogScreen.js` after a rough detected session and reopened from `AnalyticsScreen.js` to edit an existing entry; writes the `I'm okay` / `Not great` / dismissed (`status: null`) response with `responded_at` onto the note's `session_checkins[sessionIndex]`. |
| `mobile/hooks/useEntries.js` | Compatibility barrel preserving the public entry-hook exports used by native screens. |
| `mobile/hooks/entries/` | Domain implementations for weight entries and goals, workout notes, tracked lifts, deloads, feature toggles, profile, storage-mode routing, and sync recovery/export. |
| `mobile/lib/data.js` | Compatibility barrel preserving the public shared-data exports used by native consumers. |
| `mobile/lib/data/` | Domain implementations for the exercise catalog and entry factories, weight goals, routine status, fatigue, skip data, workout analytics, 1K totals, and non-weighted metrics. |
| `mobile/lib/parser.js` | Compatibility barrel preserving the public parser and derived-analytics exports used by native consumers. |
| `mobile/lib/parser/` | Domain implementations for weight entries, workout rows and notes, session construction and counting, exercise-name normalization, progression analytics, and deload history/generation. |
| `mobile/screens/HomeScreen.js` | Native dashboard with weekly summary, weight goal, and 1k Club progress cards. |
| `mobile/screens/home/` | Local Home screen dashboard derivation helper. |
| `mobile/screens/MoreScreen.js` | Native More tab menu/router plus Profile, Backup, Settings, Help, and About sub-screens. |
| `mobile/screens/more/` | Local More screen panels for account auth, cloud sync recovery, account lifecycle actions, and legal links. |
| `mobile/screens/LogScreen.js` | Native workout logging form UI and composition shell for Log-tab visual components. |
| `mobile/screens/log/` | Local Log screen editor/controller hooks and helpers for current-routine, non-current-routine, and deload editing flows. |
| `mobile/screens/WeightScreen.js` | Native weight logging form UI. |
| `mobile/screens/AnalyticsScreen.js` | Native Analytics tab UI for tracked-lift and bodyweight detail. |
| `mobile/screens/analytics/` | Local Analytics screen derivation and progressive-overload grouping helpers. |
| `mobile/storage/entries.js` | Compatibility barrel preserving the public local-persistence exports used by native consumers. |
| `mobile/storage/entries/` | Domain implementations for storage keys and JSON access, settings, weight data, workout notes, deloads, profile, backup/import, migrations, and adapter-mode selection. |
| `mobile/storage/cloudAdapter.js` | Compatibility barrel and assembler preserving the public cloud-storage adapter exports. |
| `mobile/storage/cloud/` | Cloud bootstrap planning and execution, Supabase transport, sync orchestration, cloud-backed domain methods, and cloud error implementations. |
| `mobile/theme/colors.js` | Shared native color tokens. |
| `mobile/lib/format.js` | Shared native timestamp formatting helper. |

---

## Test Files

| File | Role |
|------|------|
| `mobile/tests/parser.test.js` | Native parser and derived-analytics contract tests for the public `mobile/lib/parser.js` barrel and its domain implementations. |
| `mobile/tests/data.test.js` | Native workout/weight analytics helper contract tests for `mobile/lib/data.js`. |
| `mobile/tests/format.test.js` | Native formatting and weight-delta helper tests for `mobile/lib/format.js`. |
| `mobile/tests/analytics-screen.test.js` | Native Analytics-screen consumer checks for shared weight-goal and per-day signal rendering. |
| `mobile/tests/storage.test.js` | Native storage tests for `mobile/storage/entries.js` using the AsyncStorage Jest mock. |
| `mobile/tests/weight-goal-ui.test.js` | Native Weight-screen goal-card rendering checks using `react-test-renderer`. |
| `mobile/tests/account-lifecycle-ui.test.js` | Account export/delete hook and UI tests, including JWT function calls and no service-role-key client exposure. |
| `supabase/tests/account-lifecycle.test.sql` | pgTAP requester-isolation checks for account export/delete table access. |

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
| `docs/backend-roadmap.md` | Active public self-serve roadmap for the web-first Supabase transition: note-first cloud schema, RLS/auth isolation, offline sync, account export/deletion, web distribution, and ordered implementation issues. |
| `docs/backend-activation.md` | Backend activation runbook: env config, schema application, and cloud-mode verification steps. |
| `docs/backend-schema.md` | Cloud `kilo` schema documentation and source-of-truth policy. |
| `docs/ui-design-rules.md` | Adopted UI design rules (spacing, alignment, panels, history lists, collapse/filter, analytics hierarchy, anti-patterns). Companion to `docs/design-system-map.md`. |
| `docs/design-system-map.md` | Cross-screen style audit: every color token, font size, spacing value, and card treatment with file paths and line numbers. Reference for manual visual refinement. |
| `docs/calculations-reference.md` | Human-readable calculations reference covering workout analytics, weight trends, goal guidance, and user configuration. Describes current app behavior in plain language, designed to map onto future in-app help surfaces. |
| `docs/phone-runbook.md` | Operational runbook for running the Expo app from WSL and loading it on a physical device via Expo Go. |
| `docs/tester-guide.md` | Tester-facing guide for installing and exercising preview builds. |
| `docs/repo-structure.md` | This file. |
| `docs/archive/original-spec.md` | Original product spec from early planning. Superseded by current docs. |
| `docs/archive/mvp-roadmap.md` | Archived MVP1 roadmap. Superseded by subsequent passes. |
| `docs/archive/mvp-v2-roadmap.md` | Archived MVP2 roadmap. Superseded by subsequent passes. |
| `docs/archive/mvp-v3-roadmap.md` | Archived MVP3 roadmap. Superseded by subsequent passes. |
| `docs/archive/mvp-v3.5-roadmap.md` | Archived MVP3.5 roadmap. Superseded by subsequent passes. |
| `docs/archive/mvp-v4-roadmap.md` | Archived MVP4 roadmap. Superseded by subsequent passes. |
| `docs/archive/mvp-v4.5-roadmap.md` | Archived MVP4.5 roadmap. Complete; retained as the cumulative reference for the app state through MVP4.5. |
| `docs/archive/mvp-refine-roadmap.md` | Archived roadmap for the MVP-Refine pass, which ran after MVP4.5. Complete and retained as a historical reference. |
| `docs/archive/mvp-fatigue-roadmap.md` | Archived roadmap for the Session Check-In / Fatigue feature pass. Complete and retained as a historical reference. |
| `docs/archive/samples/` | Raw workout log files used as reference input during parser development. No active role in code or tests. |

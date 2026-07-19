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
.github/workflows/     ← required CI, review-disposition, audit, and version gates
mobile/                ← active Expo / React Native app path
scripts/               ← repository maintenance and deployment entrypoints
supabase/              ← tracked Supabase config, Edge Functions, and DB tests

docs/
  current-state.md
  architecture.md
  testing-and-qa.md
  backend-activation.md ← backend activation runbook
  backend-schema.md    ← cloud schema and source-of-truth policy
  ui-design-rules.md   ← adopted UI design rules; companion to design-system-map.md
  design-system-map.md ← cross-screen style audit: every color, font, spacing token with file and line
  calculations-reference.md
  phone-runbook.md
  play-store-readiness.md ← Google Play production-readiness checklist
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
    backend-roadmap.md ← archived backend / web-first distribution roadmap (executed)
    samples/           ← raw workout log files used during parser development
    browser-prototype/ ← archived frozen browser prototype (Kilo.html, src/, tests/)

mobile/
  App.js               ← native root; tab state + native save/reload wiring
  index.js             ← Expo root registration
  app.config.js        ← Expo dynamic config; preview runtime string + env-based profile
  app.json             ← Expo app metadata
  eas.json             ← EAS build profiles (preview, ios-simulator, ios-device, production)
  package.json
  assets/
    brand/
      logo.png
      wordmark.png
  certs/               ← certificate/key documentation (tracked)
  mockups/             ← HTML mockup files used during design (tracked)
  components/
    ScreenShell.js     ← native screen wrapper
    TabBar.js          ← native tab bar
    UI.js              ← shared native UI primitives
    LineChart.js       ← shared SVG sparkline / line chart primitive
    LogEmptyState.js   ← Log-tab empty state (intro copy, New Routine action)
    SessionCheckInModal.js ← fatigue session check-in prompt modal (Log + Analytics)
    WorkoutContentRenderer.js ← shared workout note content renderer (read-only display)
    LogActiveRoutineCard.js ← Log screen active routine card component
    LogDeloadSection.js ← Log screen deload section component
    LogPreviousRoutines.js ← Log screen previous routines list component
    LogScreenEditorCard.js ← Log screen note editor card component
    PlateCalculatorModal.js ← plate-loading calculator modal
    ReminderSettingsCard.js ← reminder settings card used in SettingsScreen
    WeightGoalCard.js   ← Weight screen goal display card component
    WeightHistoryList.js ← Weight screen weight history list component
    WeightTrendSection.js ← Weight screen trend section component
    AnalyticsCrossDayComparison.js ← Analytics cross-day session comparison component
    AnalyticsFatigueCard.js ← Analytics fatigue / session check-in card component
    AnalyticsStrengthSection.js ← Analytics strength / Big 3 / 1K section component
    AnalyticsWeightTrendsCard.js ← Analytics weight trends card component
    AboutScreen.js      ← More > About sub-screen (extracted from MoreScreen)
    BackupScreen.js     ← More > Data & Backup sub-screen (extracted from MoreScreen)
    HelpScreen.js       ← More > Help sub-screen (extracted from MoreScreen)
    ProfileScreen.js    ← More > Profile sub-screen (extracted from MoreScreen)
    SettingsScreen.js   ← More > Settings sub-screen (extracted from MoreScreen)
  lib/
    data.js            ← compatibility barrel for shared data exports
    data/              ← domain exercise, weight, routine, fatigue, 1K, and analytics helpers
    format.js          ← native timestamp formatter
    parser.js          ← compatibility barrel for parser and derived-analytics exports
    parser/            ← domain weight/workout parsing, sessions, analytics, exercise names, and deload helpers
    supabaseClient.js  ← single authorized Supabase client construction point
    errorReporting.js  ← Sentry-backed error reporting wrapper
    units.js           ← lb/kg display-unit conversion helpers
    unitPreference.js  ← module-level unit preference (lb/kg) store
    plateMath.js       ← plate-loading math for standard barbell (lb display)
    reminders.js       ← reminder scheduling decision logic (pure, no native side effects)
    reminderScheduler.js ← side-effect layer for expo-notifications (lazily imported)
    AnalyticsScreenHelpers.js ← Analytics screen derivation helper (screen-local)
    LogScreenHelpers.js    ← Log screen helper (screen-local)
    WeightScreenHelpers.js ← Weight screen helper (screen-local)
  hooks/
    useEntries.js      ← compatibility barrel for native entry hooks
    useAuthSession.js  ← auth/session boundary hook (session restore, auth state changes)
    useWeightGoalForm.js ← weight goal form state and validation hook
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
    localAdapter.js    ← local-only storage adapter (wraps entries.js domains for the adapter interface)
    syncQueue.js       ← offline LWW sync primitives (transport-agnostic)
    syncRecovery.js    ← user-facing cloud bootstrap and sync recovery state store
  tests/
    parser.test.js     ← native parser parity tests
    data.test.js       ← native analytics/data helper contract tests
    format.test.js     ← native formatting and weight-delta helper tests
    analytics-screen.test.js ← native Analytics screen consumer checks
    analytics-weight-trends-card.test.js ← Analytics weight trends card rendering checks
    storage.test.js    ← native AsyncStorage tests
    weight-goal-ui.test.js ← native Weight goal rendering checks
    weight-screen.test.js ← Weight screen rendering and interaction checks
    account-lifecycle-ui.test.js ← account export/delete hook and UI tests
    about-screen.test.js ← About screen rendering checks
    backup-screen.test.js ← Backup screen rendering and export/import checks
    auth-session.test.js ← useAuthSession hook behavior tests
    auto-sync.test.js  ← auto-sync trigger and scheduling tests
    autosave.test.js   ← autosave debounce behavior tests
    bootstrap-cloud.test.js ← cloud bootstrap flow tests
    error-reporting.test.js ← error reporting wrapper tests
    home-dashboard.test.js ← Home dashboard derivation checks
    log-screen.test.js ← Log screen rendering and editor interaction checks
    offline-sync.test.js ← offline LWW sync primitive tests
    plate-math.test.js ← plate-loading math correctness tests
    reminder-scheduler.test.js ← reminder scheduler side-effect tests
    reminder-settings-card.test.js ← ReminderSettingsCard rendering checks
    reminders.test.js  ← reminder decision logic tests
    screen-shell.test.js ← ScreenShell rendering checks
    session-checkin-modal.test.js ← SessionCheckInModal behavior tests
    session-checkin-tab-blur.test.js ← session check-in tab-blur trigger tests
    storage-adapter.test.js ← storage adapter routing and mode-selection tests
    sync-recovery-ui.test.js ← sync recovery UI state checks
    unit-display-ui.test.js ← unit display (lb/kg) rendering checks
    units.test.js      ← lb/kg conversion helper tests
    app-config.test.js ← Expo app.config.js correctness checks
    app-shell-back.test.js ← App shell back-button routing tests
    app-update-banner.test.js ← OTA update banner behavior tests

supabase/
  config.toml           ← project-local config, exposed schemas, and Edge Function JWT settings
  functions/
    _shared/            ← shared Edge Function helpers
    account-export/     ← requester-only cloud account export endpoint
    account-delete/     ← requester-only app-data deletion + auth-user deletion endpoint
  tests/
    account-lifecycle.test.sql ← pgTAP requester-isolation checks
    rate-limit.test.sql ← pgTAP rate-limiter checks
    rls_note_first_test.sql    ← pgTAP RLS checks for the note-first schema
    rls_note_first_manual_check.sql ← harness-free manual RLS isolation check (plain SQL + RAISE EXCEPTION, no pgTAP)

scripts/
  sync-version.mjs     ← syncs mobile version fields from root package.json
  review-disposition.mjs ← trusted current-PR-head review gate evaluator
  review-disposition.test.mjs ← deterministic evaluator contract tests
  deploy-kilo-functions.sh ← deploys and fail-closed verifies Kilo Edge Functions and purge-worker prerequisites
  deploy-kilo-functions.test.mjs ← offline management-plane/cron verification contract tests
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
| `mobile/components/LineChart.js` | Shared SVG sparkline / line chart primitive used across Home and Analytics weight displays. |
| `mobile/components/LogEmptyState.js` | Presentational Log-tab empty state shown when no workout routine exists yet (intro copy, `New Routine` action, example-format card). |
| `mobile/components/SessionCheckInModal.js` | Centered fatigue check-in prompt modal. Opened from `LogScreen.js` after a rough detected session and reopened from `AnalyticsScreen.js` to edit an existing entry; writes the `I'm okay` / `Not great` / dismissed (`status: null`) response with `responded_at` onto the note's `session_checkins[sessionIndex]`. |
| `mobile/components/WorkoutContentRenderer.js` | Shared read-only workout note content renderer; used by Log non-current routine view and other note-display surfaces. |
| `mobile/components/LogActiveRoutineCard.js` | Log screen active routine card UI component. |
| `mobile/components/LogDeloadSection.js` | Log screen deload section UI component. |
| `mobile/components/LogPreviousRoutines.js` | Log screen previous routines list UI component. |
| `mobile/components/LogScreenEditorCard.js` | Log screen note editor card UI component. |
| `mobile/components/PlateCalculatorModal.js` | Plate-loading calculator modal accessible from the Log screen. |
| `mobile/components/ReminderSettingsCard.js` | Reminder settings card rendered within `SettingsScreen`. |
| `mobile/components/WeightGoalCard.js` | Weight screen goal display card component. |
| `mobile/components/WeightHistoryList.js` | Weight screen weight history list with date-range filter, collapse, and delete affordances. |
| `mobile/components/WeightTrendSection.js` | Weight screen rolling average trend section component. |
| `mobile/components/AnalyticsCrossDayComparison.js` | Analytics cross-day session comparison component. |
| `mobile/components/AnalyticsFatigueCard.js` | Analytics Fatigue section card component. |
| `mobile/components/AnalyticsStrengthSection.js` | Analytics Strength / Big 3 / 1K section component. |
| `mobile/components/AnalyticsWeightTrendsCard.js` | Analytics weight trends card component. |
| `mobile/components/AboutScreen.js` | More > About Kilo sub-screen (extracted from `MoreScreen.js`). |
| `mobile/components/BackupScreen.js` | More > Data & Backup sub-screen (extracted from `MoreScreen.js`). |
| `mobile/components/HelpScreen.js` | More > Help sub-screen (extracted from `MoreScreen.js`). |
| `mobile/components/ProfileScreen.js` | More > User Profile sub-screen (extracted from `MoreScreen.js`). |
| `mobile/components/SettingsScreen.js` | More > Settings sub-screen (extracted from `MoreScreen.js`). |
| `mobile/hooks/useEntries.js` | Compatibility barrel preserving the public entry-hook exports used by native screens. |
| `mobile/hooks/useAuthSession.js` | Auth/session boundary hook: restores persisted Supabase session on mount and subscribes to auth state changes. Used by `App.js` to thread a single session probe down to screens. |
| `mobile/hooks/useWeightGoalForm.js` | Weight goal form state and validation hook used by `WeightScreen`. |
| `mobile/hooks/entries/` | Domain implementations for weight entries and goals, workout notes, tracked lifts, deloads, feature toggles, profile, storage-mode routing, and sync recovery/export. |
| `mobile/lib/data.js` | Compatibility barrel preserving the public shared-data exports used by native consumers. |
| `mobile/lib/data/` | Domain implementations for the exercise catalog and entry factories, weight goals, routine status, fatigue, skip data, workout analytics, 1K totals, and non-weighted metrics. |
| `mobile/lib/parser.js` | Compatibility barrel preserving the public parser and derived-analytics exports used by native consumers. |
| `mobile/lib/parser/` | Domain implementations for weight entries, workout rows and notes, session construction and counting, exercise-name normalization, progression analytics, and deload history/generation. |
| `mobile/lib/supabaseClient.js` | Single authorized Supabase client construction point; auth via `useAuthSession`, cloud storage via the storage adapter. Stores sessions in 2000-byte SecureStore chunks with high-water-mark protection. |
| `mobile/lib/errorReporting.js` | Sentry-backed error reporting wrapper. |
| `mobile/lib/units.js` | lb/kg display-unit conversion helpers. Canonical storage is always lb; these convert at the display layer only. |
| `mobile/lib/unitPreference.js` | Module-level store for the lb/kg display preference (persisted on the user profile). |
| `mobile/lib/plateMath.js` | Plate-loading math for a standard barbell (lb display, per the `#435` decision). |
| `mobile/lib/reminders.js` | Pure scheduling-decision logic for optional local reminders; no native imports, fully testable. |
| `mobile/lib/reminderScheduler.js` | Side-effect layer for `expo-notifications`; lazily imported to avoid native-module load before permission is granted. |
| `mobile/lib/AnalyticsScreenHelpers.js` | Analytics screen-local helper (color interpolation for 1K progress, shared derivation utilities). |
| `mobile/lib/LogScreenHelpers.js` | Log screen-local helpers (deload note prefix, autosave debounce constant). |
| `mobile/lib/WeightScreenHelpers.js` | Weight screen-local helpers (delta formatting using units layer). |
| `mobile/screens/HomeScreen.js` | Native dashboard with weekly summary, weight goal, and 1k Club progress cards. |
| `mobile/screens/home/` | Local Home screen dashboard derivation helper. |
| `mobile/screens/MoreScreen.js` | Native More tab routing shell. Imports and renders Help, About, Backup, Settings, and Profile sub-screens from `mobile/components/`; Account and AccountLifecycle remain in `mobile/screens/more/`. |
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
| `mobile/storage/localAdapter.js` | Local-only storage adapter: wraps `entries.js` domain functions into a single adapter object grouped by domain (weight, workout, deload, settings, profile). |
| `mobile/storage/syncQueue.js` | Offline last-write-wins (LWW) sync primitives; pure, transport-agnostic, used by the cloud storage adapter. |
| `mobile/storage/syncRecovery.js` | User-facing recovery state store for cloud bootstrap and offline sync; owns recovery prompts, not the sync algorithm. |
| `mobile/theme/colors.js` | Shared native color tokens. |
| `mobile/lib/format.js` | Shared native timestamp formatting helper. |

---

## Test Files

| File | Role |
|------|------|
| `mobile/tests/parser.test.js` | Native parser and derived-analytics contract tests for the public `mobile/lib/parser.js` barrel and its domain implementations. |
| `mobile/tests/data.test.js` | Native workout/weight analytics helper contract tests for `mobile/lib/data.js`. |
| `mobile/tests/format.test.js` | Native formatting and weight-delta helper tests for `mobile/lib/format.js`. |
| `mobile/tests/units.test.js` | lb/kg conversion helper tests for `mobile/lib/units.js`. |
| `mobile/tests/unit-display-ui.test.js` | Unit display (lb/kg) rendering checks across screens. |
| `mobile/tests/analytics-screen.test.js` | Native Analytics-screen consumer checks for shared weight-goal and per-day signal rendering. |
| `mobile/tests/analytics-weight-trends-card.test.js` | Analytics weight trends card rendering checks. |
| `mobile/tests/storage.test.js` | Native storage tests for `mobile/storage/entries.js` using the AsyncStorage Jest mock. |
| `mobile/tests/storage-adapter.test.js` | Storage adapter routing and mode-selection tests (local vs cloud adapter). |
| `mobile/tests/weight-goal-ui.test.js` | Native Weight-screen goal-card rendering checks using `react-test-renderer`. |
| `mobile/tests/weight-screen.test.js` | Weight screen rendering and interaction checks. |
| `mobile/tests/account-lifecycle-ui.test.js` | Account export/delete hook and UI tests, including JWT function calls and no service-role-key client exposure. |
| `mobile/tests/about-screen.test.js` | About screen rendering checks. |
| `mobile/tests/backup-screen.test.js` | Backup screen rendering and export/import flow checks. |
| `mobile/tests/auth-session.test.js` | `useAuthSession` hook behavior tests (session restore, sign-in, sign-out). |
| `mobile/tests/auto-sync.test.js` | Auto-sync trigger and scheduling tests. |
| `mobile/tests/autosave.test.js` | Autosave debounce behavior tests for the Log editor. |
| `mobile/tests/bootstrap-cloud.test.js` | Cloud bootstrap flow tests (ownership gate, data-owner transitions). |
| `mobile/tests/error-reporting.test.js` | Error reporting wrapper tests for `mobile/lib/errorReporting.js`. |
| `mobile/tests/home-dashboard.test.js` | Home dashboard derivation helper checks. |
| `mobile/tests/log-screen.test.js` | Log screen rendering and editor interaction checks. |
| `mobile/tests/offline-sync.test.js` | Offline LWW sync primitive tests for `mobile/storage/syncQueue.js`. |
| `mobile/tests/plate-math.test.js` | Plate-loading math correctness tests for `mobile/lib/plateMath.js`. |
| `mobile/tests/reminders.test.js` | Reminder decision logic tests for `mobile/lib/reminders.js`. |
| `mobile/tests/reminder-scheduler.test.js` | Reminder scheduler side-effect tests for `mobile/lib/reminderScheduler.js`. |
| `mobile/tests/reminder-settings-card.test.js` | `ReminderSettingsCard` rendering checks. |
| `mobile/tests/screen-shell.test.js` | `ScreenShell` rendering and scroll-signaling checks. |
| `mobile/tests/session-checkin-modal.test.js` | `SessionCheckInModal` behavior tests (prompt, response writing, edit path). |
| `mobile/tests/session-checkin-tab-blur.test.js` | Session check-in tab-blur trigger tests. |
| `mobile/tests/sync-recovery-ui.test.js` | Sync recovery UI state and prompt checks. |
| `mobile/tests/app-config.test.js` | Expo `app.config.js` correctness checks (preview runtime string, env branching). |
| `mobile/tests/app-shell-back.test.js` | App shell back-button routing tests (tab ownership slot, Android Home/exit fallback). |
| `mobile/tests/app-update-banner.test.js` | OTA update banner behavior tests. |
| `supabase/tests/account-lifecycle.test.sql` | pgTAP requester-isolation checks for account export/delete table access. |
| `supabase/tests/rate-limit.test.sql` | pgTAP rate-limiter checks for `kilo.rate_limit_check` and `kilo.rate_limit_hits`. |
| `supabase/tests/rls_note_first_test.sql` | pgTAP RLS checks for the note-first cloud schema. |
| `supabase/tests/rls_note_first_manual_check.sql` | Harness-free manual RLS isolation check (plain SQL + `RAISE EXCEPTION`, no pgTAP required). Runs on any Supabase Postgres that has the schema applied. |

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
| `docs/archive/backend-roadmap.md` | Archived public self-serve roadmap for the web-first Supabase transition: note-first cloud schema, RLS/auth isolation, offline sync, account export/deletion, web distribution, and ordered implementation issues. |
| `docs/backend-activation.md` | Backend activation runbook: env config, schema application, and cloud-mode verification steps. |
| `docs/backend-schema.md` | Cloud `kilo` schema documentation and source-of-truth policy. |
| `docs/ui-design-rules.md` | Adopted UI design rules (spacing, alignment, panels, history lists, collapse/filter, analytics hierarchy, anti-patterns). Companion to `docs/design-system-map.md`. |
| `docs/design-system-map.md` | Cross-screen style audit: every color token, font size, spacing value, and card treatment with file paths and line numbers. Reference for manual visual refinement. |
| `docs/calculations-reference.md` | Human-readable calculations reference covering workout analytics, weight trends, goal guidance, and user configuration. Describes current app behavior in plain language, designed to map onto future in-app help surfaces. |
| `docs/phone-runbook.md` | Operational runbook for running the Expo app from WSL and loading it on a physical device via Expo Go. |
| `docs/play-store-readiness.md` | Google Play production-readiness checklist covering closed testing, App content declarations, store listing assets, build requirements, and target API verification. |
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

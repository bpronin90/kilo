# Current State

This document is the single source of truth for what Kilo currently is, what is
implemented for MVP, what remains uncertain, and what manual validation status
has been reached for the current launch-review path.

---

## What Kilo Is Right Now

Kilo currently has two app paths with different roles:

- `mobile/` is now the active native-app path. It is an Expo/React Native
  scaffold with a Kilo-specific shell that runs as a real native app surface.
- The repo root remains the legacy prototype path. It runs directly in a
  browser via CDN React and Babel from `Kilo.html`, and there is also a minimal
  Android Capacitor shell that stages that same web app into `www/` for device
  install.

There is still no server, no backend, and no Supabase connection. Persistence
remains local-only in the current implementation paths: the browser prototype
persists via `localStorage`, while the native app now persists user-created
entries via AsyncStorage-backed modules under `mobile/storage/`.

The prototype is a seeded fitness-logging app with approximately 221 synthetic
workout sessions and bodyweight entries used as history scaffolding. User-created
entries are layered on top of this seed via `localStorage` merge on each page
load.

The browser prototype has five tabs: Home, Log, Weight, Stats, More. The native
Expo app now also exposes five tabs: Home, Log, Weight, Analytics, and More.

For physical-device packaging, the repo now has two Android paths with different
constraints:

1. Legacy prototype shell:
   - `npm run build`
   - `npm run cap:sync`
   - `npm run cap:open`
   - Build and run from Android Studio to a connected device
2. Native Expo app:
   - `cd mobile`
   - `eas build --platform android --profile preview`
   - Install the resulting APK on the phone
   - After a compatible Android build is installed, publish OTA-safe JS and
     asset updates with `npm --prefix mobile run publish:android:preview --
     --message "describe the change"`
   - The runtime boundary is enforced via `runtimeVersion.policy: "appVersion"`
     (runtime version = `version` in `app.json`). OTA updates apply to any
     installed build with the same version. A new Android build is required
     when: a native module changes, a native `app.json` field changes, the
     `version` is bumped, or any APK built under the old `"fingerprint"` policy
     is still installed (those builds carry a fingerprint hash runtime version
     and will never receive `appVersion`-keyed OTA updates — install a fresh
     APK first).

The shipped prototype branding now uses the approved Direction 3 Kilo mark and
wordmark treatment in the main Home header and the More screen footer instead of
plain text-only product naming. The native Expo path now uses a quieter shared
header treatment: no-title screens render a plain `Kilo` text title with a
low-emphasis `vX.Y.Z` version label derived from `mobile/package.json`, rather
than shared logo/wordmark header branding or an alpha badge.

The native app path is not yet a feature-complete port. It now proves that Kilo
can run as a real React Native app with native screens, native parser/data
modules, and local persistence instead of a WebView wrapper. The two app paths
still differ in surface area, but their active parsing and derived-analytics
rules now come from the same shared domain logic.

---

## Native Migration Contract

Issue #35 establishes the migration boundary from prototype-wrapper to native
app:

- `mobile/` is the only path that should receive forward-looking app
  architecture work.
- The repo-root prototype path stays in place temporarily as a reference and
  behavior source during migration.
- No new product behavior should depend on embedding the prototype inside the
  native app.
- The first implementation split is:
  - UI migration in issue #36
  - Parser and local data-model migration in issue #37

The current `mobile/` scaffold is intentionally narrow. It is a branch-off base
for implementation agents, not a claim that the native MVP is already complete.

## First Native MVP Milestone

The first native MVP milestone is reached when all of the following are true in
`mobile/`:

1. The app has real native Home, Log, Weight, and Stats surfaces.
2. Weight entries can be created locally, stored locally, and shown again in a
   recent-history view.
3. Workout entries can be created locally, stored locally, and shown again in a
   recent-history view.
4. Parser and storage code used by the MVP loop live in `mobile/`, not in the
   legacy browser-runtime path.
5. The native UI consumes parser/storage behavior through explicit local module
   boundaries instead of screen-local ad hoc state.

This milestone does not require Supabase, sync, account work, or deletion of the
legacy prototype path.

---

## MVP Surface — What Is Implemented

### Native UI shell (`mobile/`)

The real native app path now has a modular React Native shell:

- `mobile/App.js` owns tab state, routes weight saves through the canonical
  parser path, routes workout saves through the current-workout path in the
  multi-note workout store, adapts persisted entries for the Home and Analytics
  surfaces, and now exposes a separate More tab for Help, About, and a
  local Data & Backup export/import/recovery surface
- `mobile/screens/HomeScreen.js` renders a native dashboard with tappable
  summary-card shortcuts into Weight and Log, workout-volume and weight-trend
  graphs, and the exported More/Help/About/Data & Backup surfaces used by the
  More tab
- `mobile/screens/LogScreen.js` renders a native workout-note authoring flow
  with read/edit modes, a formatted mirror of the canonical note that always
  renders day/section/exercise blocks faithful to the raw text, parsed
  exercise tracking toggles in read mode, inline `—` skip markers for bare `-`
  lines, a labeled bottom `Edit note` action in the read view, and attempt-scoped save
  handling that preserves the editor's current context instead of bouncing back
  to the top-level read view after a successful save
- `mobile/screens/WeightScreen.js` renders native weight/note inputs plus
  direct history edit/delete controls for saved weight entries
- `mobile/screens/StatsScreen.js` now renders a native analytics surface for
  weight trends, tracked-lift estimated-max values, user-selectable 1k slot
  progress, progression status, and set-count context
- `mobile/components/` contains shared shell, tab bar, and UI primitives
- `mobile/assets/brand/` contains the bundled native logo and wordmark assets
- `mobile/theme/colors.js` centralizes the native color system
- `mobile/lib/parser.js` ports the MVP canonical parser path into native ES
  modules and now also includes tolerant workout-note parsing for the archived
  sample-style shorthand logs used by the v2 note-based workflow plus a
  derived analytics contract for later note-based UI and analytics work,
  including tracked-exercise estimated-PR derivation from parsed sets and
  positional session-alignment derivation for long-note imports
- `mobile/lib/data.js` defines the native exercise catalog and entry factories,
  including the default 1k exercise-slot selection used by analytics and a
  factory for titled workout-note items in the multi-note model
- `mobile/hooks/useEntries.js` exposes the native read/write APIs used by the
  UI, including multi-note current-workout reads/writes and cross-consumer
  refresh fanout
- `mobile/storage/entries.js` persists weight entries plus a local-only
  multi-note workout model via AsyncStorage: `kilo_workout_notes` stores
  multiple titled workout notes, `kilo_current_workout_id` stores the explicit
  current selection, and persisted note items retain `tracked_exercises` and
  `one_k_exercises` selections. The legacy structured workout-session key is
  retained only as a one-time migration source. The local Data & Backup
  recovery path now exports a versioned v2 snapshot (weight entries, workout
  notes, current workout id), restores the full multi-note model on v2 import,
  and still accepts older v1 backups to restore weight history without wiping
  the newer workout-note state

This path is no longer UI-only. Weight saves run through `parseWeightEntry()`
before persistence, and the native Log flow now saves through the current item
in a local multi-note workout store instead of requiring a structured
title-and-detail workout entry form. Saved native weight entries, workout note
items, and the selected current workout all reload across app restarts through
the native hook/storage layer. The shared native `ScreenShell` now normalizes Android top
safe-area clearance across Home, Log, Weight, Analytics, and More/Help using
shared status-bar spacing instead of per-screen header offsets, and its
no-title header state now uses a plain text `Kilo` title plus a quiet `vX.Y.Z`
version label instead of the heavier logo/wordmark-and-badge treatment. The
native Log and Weight flows now keep save actions responsive on the first tap
even with the keyboard visible, guard against duplicate in-flight saves, and
keep the bottom tab bar reachable above the iOS keyboard. Successful native
weight saves now keep the user on the Weight screen instead of bouncing them
back to Home.
The native Weight screen now also lets the user reopen saved entries from a
denser scannable history list, correct them in place, delete mistakes from
inline row affordances, and immediately refresh the shared weight views after
AsyncStorage updates. It also now derives 7-day and 30-day rolling averages
plus fast gain/loss pace flags from saved entries, and shows that trend
feedback on both the Weight and Stats screens.
The v2 parser groundwork for one long workout note now exists alongside the
raw-note editor, a formatted read-mode mirror that preserves headings,
exercise blocks, mixed-weight rows, and unparsed history lines, and a stable
derived analytics input model so later PR, 1k, and repeatability work can
consume parsed note output without rebuilding the parser contract. It now also
includes a tracked-exercise estimated-PR engine that computes Epley values per
parseable set, keeps each tracked exercise's best current estimate, and
deduplicates tracked names before emitting analytics rows. It now also derives
the tracked 1k total locally from the user-selected bench, squat, and
deadlift exercises, persists those three slot choices on the canonical workout
note document, and resolves a conservative set of deterministic exercise-name
aliases so obvious note variants such as `DB Bench` still count toward the
intended lift without fuzzy matching. Progression-over-time and repeatability
signals compare the latest comparable weighted result against the prior
comparable result without changing the formal estimated-PR formula. The native
Home and Analytics tabs now derive workout activity consistently from the
currently selected workout note in the same multi-note store used by the Log
screen, while later UI work can add routine switching without replacing the
data contract. The local backup/import path also now preserves multiple titled
workout notes plus the current-workout selection, and remains backward
compatible with older weight-only v1 backups. The native Home tab is
now a dashboard rather than a static blurb, with top summary cards that jump
directly to Weight and Log plus simple workout-volume and bodyweight trend
graphs as the default landing view. The native Log read
view now also lets the user explicitly mark parsed exercises as tracked or not
tracked without editing note syntax, and that selection persists on the
canonical workout-note document. The read view always renders the formatted
note mirror (day heading, `+` subheading, `-` exercise block, history rows)
faithful to the raw text, with bare `-` lines shown as unobtrusive inline skip
markers; Home and Analytics derive the workout/session count from the maximum
parsed history-row count across exercises rather than positional session
decomposition. The native Analytics tab now consumes those
derived analytics directly, combining weight trends with tracked-lift
estimated-max values, 1k progress, progression status, and set-count context
in one minimal analytics view while keeping totals in sync with canonical
workout-note refreshes. A separate native More tab now exposes Help and
About surfaces while keeping the parent More quick actions intact; the Help
surface now uses the shared top-safe-area header treatment, a local accessible
header back control, and a centered Kilo logo placed above the Help and
Terminology content only. About continues to surface attribution, displayed
version, copyright notice, and an OTA Diagnostics panel covering the EAS
channel, runtime version, current bundle (embedded vs. applied update),
update-available/pending state, and a manual update check.

### Parser (`src/parser.jsx`)

The MVP canonical parse path is fully implemented and tested.

- `parseWeightEntry(raw)` — accepts `\d+(\.\d+)?` only; rejects unit suffixes,
  signs, commas, prose, zero, and negative values; defaults `weight_unit` to
  `'lb'`; supplies `logged_at` from context.
- `parseWorkoutRow(raw)` — accepts `-`, comma-separated rep-groups, and
  `load rep-group` pairs; rejects standalone integers, timed formats, prose, and
  slash notation; normalizes spaces around commas.
- `parseWorkoutEntry(items, workout_date)` — calls `parseWorkoutRow` per row;
  collects per-row errors; returns a canonical workout entry or a structural
  violation when no valid items remain.
- `parseWorkoutNote(noteText)` — parses multi-day shorthand workout notes into
  stable sections and exercise blocks, preserves parseable set rows plus
  positional session-entry slots for downstream analytics, and degrades
  ambiguous or non-weight note fragments into `unparsed_rows` instead of
  rejecting the note.
- `buildSessionsFromNote(noteText)` — aligns the `N`th positional `- ...`
  entry for each exercise into session `N`, ignores day and warmup/lifting
  boundaries for session construction, preserves bare `-` skips, and emits a
  warning when exercises have uneven positional entry counts. Retained for
  legacy-migration-format validation only; no product screen reads workout
  presentation or counts through it.
- `countWorkoutSessions(noteText)` — returns the workout/session count as the
  maximum number of parsed history rows across all exercises in the note, and
  `0` when no exercise has any parsed row. Source of the Home and Analytics
  session counts.
- `deriveWorkoutAnalytics(sections)` — converts parsed note sections into a
  per-exercise analytics input contract with flattened sets, grouped rows,
  per-occurrence context, preserved `unparsed_rows`, per-set Epley estimates,
  and a best-set `estimated_pr` summary.
- `deriveTrackedPRs(sections, trackedNames)` — filters derived analytics down
  to one row per unique tracked exercise name, preserving caller order while
  surfacing each exercise's best current `estimated_pr` or `null` when absent.
- `derive1kTotal(sections, selections)` — sums the estimated PR values for the
  selected bench, squat, and deadlift exercises and returns `total: null`
  until all three tracked lifts are present in the note.
- `deriveProgressionSignals(sections, trackedNames)` — walks backward through
  tracked exercise occurrences to compare the latest comparable weighted result
  to the prior comparable result, returning improved, held, regressed, or
  first-session progression status plus a same-session top-weight
  `repeatability_score`.

A legacy freeform path (`parseKiloInput`, `formatParsed`, legacy helpers)
still exists for seeded-history compatibility and other browser-runtime
formatting helpers. It is not used on any save path, and the active web/native
analytics consumers now route through the canonical row/note parser plus the
shared Epley-based derived-analytics helpers.

### Weight Logging (`src/screens/weight.jsx`)

- `KiloWeight` renders an entry field and Log button.
- The Log button is disabled when the field is empty.
- On submit, `parseWeightEntry` runs; validation errors are shown inline.
- On success, "✓ Weight saved successfully" is shown; the button changes to
  "Saved" and disables.
- A new weight entry is written to `localStorage` (`kilo_weight_entries`) and
  merged into `window.KILO_WEIGHTS`.
- The Entries list below the graph shows the 12 most recent entries.
- Edit (pencil icon) and delete (× icon) are present for user-created entries.
  Edit opens an inline row editor with Save and cancel controls, re-runs
  `parseWeightEntry` on the new value, and shows invalid edits as inline error
  text.
  Delete uses an inline confirm state (`DEL` / `×`) before removing the entry.

### Home Quick-Log (`src/screens/home.jsx`)

- A weight quick-log field and button are present on the Home tab when
  `loggedToday` is false.
- The same `parseWeightEntry` validation and `persistWeightEntry` write path are
  used as on the Weight tab.

**Prototype limitation:** in the current seeded prototype, `window.KILO_TODAY`
is hardcoded to `'2026-05-05'` and `src/data.jsx` always seeds a weight entry
for that date. This means `loggedToday` is always true and the Home quick-log
input is always hidden in normal browser use. This path is covered by automated
tests but cannot be reached by a manual tester without modifying the prototype
source.

### Workout Logging (`src/screens/log.jsx`)

- `KiloLog` renders the exercise list for today's day-of-week split.
- Each `ExerciseRow` runs `parseWorkoutRow` live on every keystroke and renders
  a `ParsePreview` chip (or `⚠` error) inline.
- The primary Save button lives in the Log header, stays reachable without
  footer scrolling, and is disabled when no rows have valid parseable input.
- If today's split has already been logged, the header area shows an
  informational duplicate-session banner. Duplicate saves remain allowed.
- On save, `parseWorkoutEntry` validates all rows together.
  - Rows with errors are highlighted inline; no success screen appears.
  - Non-inline save failures render directly below the header progress area.
  - On success, a "Workout saved" confirmation screen is shown with both
    `View Stats` and `Back to Home` actions.
- Saved sessions are written to `localStorage` (`kilo_workout_sessions`) and
  merged into `window.KILO_SESSIONS`.

### Recent History (`src/screens/home.jsx`, `src/screens/stats.jsx`)

- The Home tab and Stats history list both combine weight entries and workout
  sessions, sorted by `saved_at` DESC.
- The Home tab is display-only for recent history rows and does not expose
  per-row correction actions.
- Stats continues to own recent-history correction actions for user-created
  entries.
- Entries persist across page reloads via `localStorage`.
- Seeded entries appear without correction actions (`isUserEntry` is false).

### Correction Flows (`src/data.jsx`)

Three correction helpers are implemented via `window.*` globals:

| Function | Behavior |
|---|---|
| `window.deleteWeightEntry(id)` | Removes from `KILO_WEIGHTS` and `localStorage` |
| `window.updateWeightEntry(id, value)` | Updates weight value in-place in `KILO_WEIGHTS` and `localStorage`; does not parse — the caller (`KiloWeight`) runs `parseWeightEntry` before invoking this helper |
| `window.deleteWorkoutSession(id)` | Removes from `KILO_SESSIONS` and `localStorage` |

Workout entries can only be deleted, not edited (within the MVP correction
contract). Seeded entries are not correctable.

---

## What Issue #17 Validated

Issue #17 completed the legacy prototype MVP acceptance review and the final
launch hold was cleared by user-confirmed on-phone validation. This closeout
should not be mistaken for native-app readiness. The native migration contract
established in issue #35 creates a separate path of work before any native-app
launch claim would be credible.

Required readiness artifacts and their current status:

| Artifact | Status |
|---|---|
| `README.md` | Complete |
| `docs/current-state.md` | Complete |
| `docs/architecture.md` | Complete |
| `docs/testing-and-qa.md` | Complete |
| `docs/repo-structure.md` | Complete |

---

## Known Gaps That Affect Launch Confidence

### Native app path still has partial UI parity only

The `mobile/` Expo app now covers the native MVP create/store/retrieve loop for
weight and workout entries, but it still exposes a narrower UI than the browser
prototype. The native app has five tabs, its own note-first Log flow rather than
the prototype exercise-row form, and it still lacks full parity for seeded
history presentation and the prototype's live per-row parse preview treatment.

### No automated tests for workout logging, corrections, or recent history

The following MVP behaviors have no automated test coverage:

- `KiloLog` render, save path (success and error), per-row error highlighting,
  `ParsePreview` live preview, PT checklist toggle, `persistWorkoutSession`
  (`src/screens/log.jsx`)
- Weight entry delete and edit from `KiloWeight` (`src/screens/weight.jsx`)
- Combined weight + workout sort in recent history
- Workout and weight card rendering in `KiloHome`
- `KiloWeight` entry list, delta calculation, graph, range tabs
- `KiloStats`, `KiloMore`, `KiloApp` tab routing
- Script load order and `window.*` global wiring
- `localStorage` rehydration on fresh load
- Native App.js hook wiring, native save handlers, and AsyncStorage-backed
  native reload behavior

These gaps mean the automated suite passing does not confirm that the workout
logging loop or correction flows work correctly. Manual smoke testing (per
`docs/testing-and-qa.md`) is required to cover these paths.

### No Supabase or backend

All persistence is `localStorage` in the current browser profile. There is no
Supabase connection, no authentication, no server, and no network persistence.
This is a known prototype constraint, not a regression. The MVP roadmap (Phase 2)
defines the Supabase schema and write-boundary contract, but those have not been
implemented or wired up.

Launch validation must treat `localStorage` as the persistence layer. Any
evaluation of the app against the Supabase-based data model described in
`docs/mvp-roadmap.md` Phase 2 is premature.

### Android shell is packaging-only

The Capacitor shell is intentionally minimal. It wraps the existing staged web
app in an Android WebView and does not add native product features, offline
bundling, or platform-specific business logic. Because `Kilo.html` still loads
React and Babel from CDN, the installed app currently requires internet access
to render successfully on device.

**Supply-chain hardening:** all runtime CDN dependencies in `Kilo.html` (React,
ReactDOM, and Babel) are hardened with Subresource Integrity (SRI) using stable
versioned URLs, `integrity` hashes, and `crossorigin="anonymous"`. This ensures
that a compromise of the CDN provider cannot be used to inject malicious
JavaScript into the packaged Android app or the browser prototype.

**Android backup policy:** `android:allowBackup="true"` is set intentionally.
User workout and weight entries stored in WebView `localStorage` are included in
Android backup and device-to-device transfer. SharedPreferences, which contain
Capacitor framework internals (device IDs, cached paths), are excluded via
`backup_content.xml` (API ≤30) and `backup_rules.xml` (API 31+). There is no
backend or auth layer in this path; the only user data worth preserving is the
`localStorage`-backed entry history.

### OTA update code signing is configured (not yet active on installed builds)

`mobile/app.json` is now configured for Expo OTA code signing via
`updates.codeSigningCertificate` and `updates.codeSigningMetadata`. The public
X.509 certificate is committed at `mobile/certs/certificate.crt`. The matching
private key is not in the repo; see `mobile/certs/KEYS.md` for storage
guidance and the signed-publish command.

**On-device enforcement requires a new native build.** The certificate is
embedded in the app binary at build time. Builds produced before this config
change do not contain the certificate and will not verify OTA signatures.
Once a binary built after this change is installed, `expo-updates` will reject
any OTA update whose manifest signature does not verify against the embedded
certificate. Published OTA updates must be signed via `--private-key-path`
passed to `eas update`.

### Native Expo app has standalone Android and iOS build paths

The `mobile/` Expo app now has checked-in EAS build profiles for both Android
and iOS output, plus the required platform identifiers (`android.package` and
`ios.bundleIdentifier` are both `com.benpronin.kilo`). That gives the native app
installable paths that do not depend on the developer machine staying on or
serving a local Expo session.

Android: the `preview` profile produces a plain `.apk` for sideloading.

iOS: two profiles are available:
- `ios-simulator` — builds a Simulator `.app` bundle; no Apple Developer account
  required.
- `ios-device` — builds an internal-distribution `.ipa` for direct real-device
  install via ad hoc provisioning; requires an Apple Developer Program membership
  and the target device UDID registered in the Apple Developer portal.

The one-time Expo account linking step still must write a real
`extra.eas.projectId` into `mobile/app.json`, and the repo documents that
contributors should commit that linked project ID once it exists.

The shipped native Android launcher, adaptive icon, splash icon, and web
favicon assets now use Kilo-branded PNG files instead of the default Expo
placeholder artwork.

**iOS device build blockers:** the `ios-device` profile uses internal
(ad hoc) distribution, which requires an Apple Developer account and the target
device UDID registered in the Apple Developer portal before the build starts. The
`ios-simulator` profile has no such requirement. See `docs/phone-runbook.md` for
the full iOS build command path and known blockers.

### Native UI runtime is not yet validated end-to-end

Issue #36 review approved the native UI structure, but the approval was based on
static inspection of the `mobile/**` diff. The Expo app has not yet been
validated end-to-end on a device or emulator as part of the issue closeout.

### `KILO_TODAY` is hardcoded

`window.KILO_TODAY` is set to `'2026-05-05'` by `data.jsx`. All screens use
this value as "today." The Home quick-log is unreachable during manual testing
because a seeded weight entry always exists for that date. No screen reads the
real system date. Any date-sensitive behavior (split day, `logged_at` defaulting)
depends on this fixed value.

### Seeded sessions do not carry canonical `items`

Seeded workout sessions expose only `raw` strings per exercise, not parsed `items`.
Any code path that reads `session.items` must guard against missing `items`. The
Stats screen and Log screen `lastRef` display now derive from
`parseWorkoutRow()`, so seeded raw strings continue to work without depending on
the legacy parser path.

---

## Launch Prerequisite Checklist

These were the prerequisites for manual launch validation on issue #17.

**Docs**
- [x] `README.md` explains where the app lives, how to start it, and which docs
      matter for launch review
- [x] `docs/current-state.md` exists and is internally consistent with the other
      docs (this document)
- [x] `docs/architecture.md` is current and accurate
- [x] `docs/testing-and-qa.md` is current and accurate
- [x] `docs/repo-structure.md` exists and maps MVP-relevant repo areas

**Automated tests**
- [x] `npm test` passes with zero failures

**Manual smoke test**
- [x] Final launch-signoff validation was completed for issue #17 with
      user-confirmed on-phone verification before closeout

**Known non-blockers for launch** (acceptable prototype limitations)
- PT checklist items are toggle-only; not persisted across reloads
- Stats screen is read-only and has no correction flows
- `KILO_TODAY` is hardcoded; real-date behavior is a post-MVP concern
- Seeded entries cannot be corrected via the product UI
- Home quick-log is not manually reachable in the seeded prototype state (covered
  by automated tests)
- Supabase is not wired up; `localStorage` is the persistence layer for MVP validation

## Ownership Split For Native Migration

Issue #35 fixes the first implementation ownership split as follows:

- Issue #36 (`agent:gemini`): native screen structure, navigation, reusable UI
  components, and MVP surface composition in `mobile/`
- Issue #37 (`agent:claude`): completed parser port, entry model, local
  persistence, recent-history retrieval, and native-side data access boundaries
  in `mobile/`

Codex stays responsible for contract definition, sequencing, and review rather
than owning the implementation slices directly.

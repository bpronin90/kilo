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
Expo app currently exposes four tabs: Home, Log, Weight, and Stats.

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

The shipped prototype branding now uses the approved Direction 3 Kilo mark and
wordmark treatment in the main Home header and the More screen footer instead of
plain text-only product naming. The native Expo path currently uses simple
native text treatment and shared color tokens rather than the full prototype
branding stack.

The native app path is not yet a feature-complete port. It now proves that Kilo
can run as a real React Native app with native screens, native parser/data
modules, and local persistence instead of a WebView wrapper, but it still does
not match the full browser prototype surface or analytics behavior.

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
  parser path, and now routes workout saves through the canonical workout-note
  persistence path while still adapting persisted weight entries and legacy
  workout sessions for the Home and Stats surfaces
- `mobile/screens/HomeScreen.js` renders recent activity and a native overview
  card
- `mobile/screens/LogScreen.js` renders a native workout-note authoring flow
  with read/edit modes, a formatted mirror of the canonical note, parsed
  exercise tracking toggles in read mode, and attempt-scoped save handling that
  only leaves edit mode after a successful save result
- `mobile/screens/WeightScreen.js` renders native weight/note inputs plus
  direct history edit/delete controls for saved weight entries
- `mobile/screens/StatsScreen.js` renders a small native summary card grid
- `mobile/components/` contains shared shell, tab bar, and UI primitives
- `mobile/theme/colors.js` centralizes the native color system
- `mobile/lib/parser.js` ports the MVP canonical parser path into native ES
  modules and now also includes tolerant workout-note parsing for the archived
  sample-style shorthand logs used by the v2 note-based workflow plus a
  derived analytics contract for later note-based UI and analytics work,
  including tracked-exercise estimated-PR derivation from parsed sets
- `mobile/lib/data.js` defines the native exercise catalog and entry factories,
  including the default tracked-exercise name selection used by analytics
- `mobile/hooks/useEntries.js` exposes the native read/write APIs used by the
  UI, including workout-note migration plumbing and cross-consumer note refresh
  fanout
- `mobile/storage/entries.js` persists weight entries and workout sessions via
  AsyncStorage and now also supports one canonical workout routine note with a
  persisted `tracked_exercises` selection and a one-time migration bridge from
  legacy structured sessions

This path is no longer UI-only. Weight saves run through `parseWeightEntry()`
before persistence, and the native Log flow now saves one canonical workout
note document through the hook and storage layer instead of requiring a
structured title-and-detail workout entry form. Saved native weight entries and
the saved workout note both reload across app restarts through the native
hook/storage layer. The native Log and Weight flows now keep save actions
responsive on the first tap even with the keyboard visible, guard against
duplicate in-flight saves, and keep the bottom tab bar reachable above the iOS
keyboard. The native Weight screen now also lets the user reopen saved entries
from history, correct them in place, delete mistakes, and immediately refresh
the shared weight views after AsyncStorage updates.
The v2 parser groundwork for one long workout note now exists alongside the
raw-note editor, a formatted read-mode mirror that preserves headings,
exercise blocks, mixed-weight rows, and unparsed history lines, and a stable
derived analytics input model so later PR, 1k, and repeatability work can
consume parsed note output without rebuilding the parser contract. It now also
includes a tracked-exercise estimated-PR engine that computes Epley values per
parseable set, keeps each tracked exercise's best current estimate, and
deduplicates tracked names before emitting analytics rows. Recent history in
the native app still reflects persisted workout sessions rather than live
workout-note revisions, so the note-first authoring shift is complete before
the downstream read and analytics surfaces are updated. The native Log read
view now also lets the user explicitly mark parsed exercises as tracked or not
tracked without editing note syntax, and that selection persists on the
canonical workout-note document.

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
  stable sections and exercise blocks, preserves parseable set rows for
  downstream analytics, and degrades ambiguous or non-weight note fragments
  into `unparsed_rows` instead of rejecting the note.
- `deriveWorkoutAnalytics(sections)` — converts parsed note sections into a
  per-exercise analytics input contract with flattened sets, grouped rows,
  per-occurrence context, preserved `unparsed_rows`, per-set Epley estimates,
  and a best-set `estimated_pr` summary.
- `deriveTrackedPRs(sections, trackedNames)` — filters derived analytics down
  to one row per unique tracked exercise name, preserving caller order while
  surfacing each exercise's best current `estimated_pr` or `null` when absent.

A legacy freeform path (`parseKiloInput`, `formatParsed`, analytics helpers)
exists for read-only display of seeded history. It is not used on any save path.

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
prototype. The native app has only four tabs, a simplified workout form, and no
native equivalents yet for the prototype More screen, correction flows, seeded
history analytics, or live per-row parse previews.

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

### Native Expo app now has a standalone Android build path

The `mobile/` Expo app now has a checked-in EAS build profile for Android APK
output plus the required Android package identifier. That gives the native app
an installable path that does not depend on the developer machine staying on or
serving a local Expo session. The one-time Expo account linking step still must
write a real `extra.eas.projectId` into `mobile/app.json`, and the repo
documents that contributors should commit that linked project ID once it exists.

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
Stats screen and Log screen `lastRef` display use the legacy `parseKiloInput`
path to handle these gracefully.

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

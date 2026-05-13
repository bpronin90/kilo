# Current State

This document is the single source of truth for what Kilo currently is, what is
implemented for MVP, what remains uncertain, and what must happen before the app
can be manually launch-validated.

---

## What Kilo Is Right Now

Kilo now has two active local app paths:

- the original client-only React prototype in `Kilo.html`, which still runs in
  the browser via CDN React and Babel and remains the only path with the full
  parser and `localStorage` save loop wired up
- a real Expo/React Native app scaffold in `mobile/`, which now has native UI
  screens for Home, Log, Weight, and Stats but does not yet own parser or
  persistence behavior

The repo still includes the minimal Android Capacitor shell that stages the web
prototype into `www/` for installable preview testing. There is no server, no
backend, and no Supabase connection. The browser prototype persists to
`localStorage`; the native app path currently uses local in-memory seed state
only.

The prototype is a seeded fitness-logging app with approximately 221 synthetic
workout sessions and bodyweight entries used as history scaffolding. User-created
entries are layered on top of this seed via `localStorage` merge on each page
load.

The browser prototype has five tabs: Home, Log, Weight, Stats, More. The native
Expo app currently exposes four tabs: Home, Log, Weight, and Stats.

For physical-device packaging of the staged web prototype, the current
supported Capacitor path is Android only:

1. `npm run build`
2. `npm run cap:sync`
3. `npm run cap:open`
4. Build and run from Android Studio to a connected device

The shipped prototype branding now uses the approved Direction 3 Kilo mark and
wordmark treatment in the main Home header and the More screen footer instead of
plain text-only product naming. The native Expo path currently uses simple
native text treatment and shared color tokens rather than the full prototype
branding stack.

---

## MVP Surface — What Is Implemented

### Native UI shell (`mobile/`)

The real native app path now has a modular React Native shell:

- `mobile/App.js` owns tab state plus temporary in-memory entry state
- `mobile/screens/HomeScreen.js` renders recent seeded activity and a native
  overview card
- `mobile/screens/LogScreen.js` renders native workout title/detail inputs and a
  save action
- `mobile/screens/WeightScreen.js` renders native weight/note inputs and a save
  action
- `mobile/screens/StatsScreen.js` renders a small native summary card grid
- `mobile/components/` contains shared shell, tab bar, and UI primitives
- `mobile/theme/colors.js` centralizes the native color system

This path is intentionally UI-only today. Save actions update local React state
inside `mobile/App.js` and return the user to Home, but they do not yet call the
prototype parser or persist entries across app restarts.

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
  Edit re-runs `parseWeightEntry` on the new value and rejects invalid input.
  Delete prompts for confirmation before removing the entry.

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
- The Save Session button is disabled when no rows have valid parseable input.
- On save, `parseWorkoutEntry` validates all rows together.
  - Rows with errors are highlighted inline; no success screen appears.
  - On success, a "Workout saved" confirmation screen is shown with a back button.
- Saved sessions are written to `localStorage` (`kilo_workout_sessions`) and
  merged into `window.KILO_SESSIONS`.

### Recent History (`src/screens/home.jsx`)

- The Home tab shows a "Recent history" section combining weight entries and
  workout sessions, sorted by `saved_at` DESC.
- User-created weight entries show a delete icon (× icon).
- User-created workout sessions show a delete icon.
- Entries persist across page reloads via `localStorage`.
- Seeded entries appear but do not show delete icons (`isUserEntry` is false).

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

Issue #17 is the manual launch validation task. It has not been executed yet.
The Pre-Launch Repo Readiness Sequence (defined in `docs/mvp-roadmap.md`) is
now complete. Issue #17 is no longer blocked on repo-orientation uncertainty
and can proceed to manual smoke testing.

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

### Native app path is UI-only so far

The `mobile/` Expo app now renders the MVP surfaces natively, but it still uses
temporary local React state and seeded entries from `mobile/App.js`. The native
path does not yet parse canonical weight/workout input, persist data locally, or
reload saved entries across restarts. Issue #37 exists to migrate parser and
local data behavior into `mobile/`.

### No automated tests for workout logging, corrections, or recent history

The following MVP behaviors have no automated test coverage:

- `KiloLog` render, save path (success and error), per-row error highlighting,
  `ParsePreview` live preview, PT checklist toggle, `persistWorkoutSession`
  (`src/screens/log.jsx`)
- Weight entry delete and edit from `KiloWeight` (`src/screens/weight.jsx`)
- Workout session delete from `KiloHome` (`src/screens/home.jsx`)
- Weight entry delete from `KiloHome`
- Combined weight + workout sort in recent history
- Workout and weight card rendering in `KiloHome`
- `KiloWeight` entry list, delta calculation, graph, range tabs
- `KiloStats`, `KiloMore`, `KiloApp` tab routing
- Script load order and `window.*` global wiring
- `localStorage` rehydration on fresh load

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

All items below must be true before manual launch validation (issue #17) begins.

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
- [ ] A human tester has executed the full Manual Smoke Checklist in
      `docs/testing-and-qa.md` and all **[BLOCKER]** steps pass

**Known non-blockers for launch** (acceptable prototype limitations)
- PT checklist items are toggle-only; not persisted across reloads
- Stats screen is read-only and has no correction flows
- `KILO_TODAY` is hardcoded; real-date behavior is a post-MVP concern
- Seeded entries cannot be corrected via the product UI
- Home quick-log is not manually reachable in the seeded prototype state (covered
  by automated tests)
- Supabase is not wired up; `localStorage` is the persistence layer for MVP validation

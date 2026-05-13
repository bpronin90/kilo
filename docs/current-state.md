# Current State

This document is the single source of truth for what Kilo currently is, what is
implemented for MVP, what remains uncertain, and what must happen before the app
can be manually launch-validated.

---

## What Kilo Is Right Now

Kilo is transitioning from a browser-centric prototype to a real native mobile
application.

The **native app surface** is a React Native / Expo implementation located in
the `mobile/` directory. It ports the Home, Log, Weight, and Stats screens into
intentional native components and screen flows. This is the long-term supported
path for the Kilo MVP.

The **legacy prototype surface** remains at the repo root in `Kilo.html`. It
runs directly in a browser via CDN React and Babel. A Capacitor shell also exists
to stage this web app into `android/` for legacy device install, but this path
is now considered a "prototype-wrapper" and is superseded by the `mobile/` app.

There is no server, no backend, and no Supabase connection in either surface yet.
The native app currently uses in-memory state for its MVP loop, while the web
prototype uses `localStorage`. All persistence and synchronization logic remains
a known Phase 2 roadmap item.

The app has four primary tabs in the native shell: Home, Log, Weight, Stats.

To run the native app:
1. `cd mobile`
2. `npm start`
3. Use the Expo Go app or an emulator to launch the project.

---

## MVP Surface — What Is Implemented

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

### Android shell is now two-tier

The repository contains two Android paths:
1. **Legacy Capacitor Shell**: Wraps the staged `Kilo.html` web app in a WebView.
   Requires internet access due to CDN dependencies and does not offer native
   performance or components.
2. **New Native App (`mobile/`)**: A real React Native / Expo application. It
   offers native components, offline-ready UI, and a structural foundation for
   further development. This is the recommended path for validation and future
   work.

The native app currently lacks the legacy history seeds and `localStorage`
persistence of the web prototype. Persistence migration is the next major step.

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

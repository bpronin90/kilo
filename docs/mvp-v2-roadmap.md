# MVP v2 Roadmap For Kilo

Status: complete and historical.

This roadmap reflects an earlier completed planning pass. The active roadmap
lives in `docs/roadmap-mvp-refine.md`; keep this file as history and do not use
it as the edit target for future roadmap work.

## MVP v2 Definition
Kilo MVP v2 remains a single-user logging product, but it should align with
the real user workflow instead of forcing a rigid tracker model.

The v2 product contract is:
- workouts are tracked in one long editable routine note, similar to Google
  Keep
- weight stays a separate lightweight daily logging flow in its own tab
- analytics are derived from the underlying note and weight data, not
  maintained as separate manual records
- editing or removing source data must immediately change derived analytics
- Kilo stays minimalist: notepad first, analysis second

MVP v2 non-goals:
- coaching or recommendations
- generated programs
- exercise catalog management
- nutrition overhaul
- social or multi-user features
- import or export workflows
- broad settings systems
- aggressive tracker-style structure that changes the user's logging style

## Current MVP Mismatch
The current MVP roadmap and implementation direction assume:
- one structured workout entry per save
- constrained accepted input formats
- recent-entry correction as the primary workout editing model

That is not the intended product.

The target workflow is:
1. Keep one long workout note for the active routine and update it over time.
2. Log daily bodyweight separately in a fast dedicated flow.
3. Let analytics interpret existing user-authored data without making the user
   log in a stricter format than they already use.

## Core Model Decisions
- Workout source of truth: one long editable routine note, not one note per
  workout session.
- Workout tab model: raw note editing remains primary.
- Workout read view: the workout area may render a cleaner formatted mirror of
  the note for readability, but the raw note remains canonical.
- Workout analytics surface: separate from the workout note tab.
- Weight flow: separate from workout logging and still optimized for quick
  daily entry.
- Weight correction: saved weight entries must support edit and delete.
- Exercise selection for analytics: the user selects tracked exercises from the
  parsed workout content in the UI. The note text does not require special
  tagging syntax for v2.
- PR model: show both a standard estimated PR and a separate progression or
  repeatability signal.
- Estimated PR formula: use Epley, `weight * (1 + reps / 30)`.
- Estimated PR calculation unit: calculate per parsed set, then keep the best
  eligible estimate for the exercise.
- Repeatability and PO: repeated heavy sets should influence progression
  interpretation even when the formal estimated PR remains set-based.
- 1k tracking: sum the estimated PR values for the user-selected bench, squat,
  and deadlift exercises.

## Ordered MVP v2 Roadmap

### Phase 1: Lock The v2 Product Contract (Complete)
- Phase goal: replace the old structured-entry MVP assumptions with the real
  minimalist product contract.
- Status: complete. The roadmap was published and the initial implementation
  card stack was created before Phase 2 work begins.
- Allowed scope: roadmap or spec rewrite, terminology, ownership, acceptance
  criteria, and implementation sequencing.
- Explicit out of scope: coding.
- Completion condition: implementation no longer has to guess whether Kilo is
  a strict tracker or a notepad-plus-analytics product.

Ordered tasks:

#### Task 1: Publish the MVP v2 roadmap
- Session goal: create the replacement product contract for the remaining MVP
  work.
- Status: complete.
- Intended agent: `codex`
- Allowed scope: docs only.
- Explicit out of scope: implementation.
- Dependency: none.
- Verification target: one written roadmap covering workout note, weight,
  analytics, task sequencing, and agent ownership.
- Stop condition: implementation cards can reference one stable source of
  truth.

#### Task 2: Convert the roadmap into focused implementation cards
- Session goal: split v2 into narrow issues with compliant labels and clear
  allowed-file boundaries.
- Status: complete.
- Intended agent: `codex`
- Allowed scope: issue creation, issue sequencing, ownership, and acceptance
  criteria.
- Explicit out of scope: implementation.
- Dependency: Publish the MVP v2 roadmap.
- Verification target: each card has one primary intent, one owner, and a
  realistic file boundary.
- Stop condition: implementation can proceed without scope confusion.

### Phase 2: Workout Note Foundation
- Phase goal: make the workout note the durable source of truth and make
  parsing tolerant of the user's shorthand format.
- Allowed scope: persisted model, parser behavior, derived analytics inputs,
  note save or reload flows.
- Explicit out of scope: final UI polish or analytics presentation.
- Dependency: Phase 1 complete.
- Completion condition: the app can store one long routine note, parse it into
  stable workout structures, and expose derived exercise data without blocking
  raw note editing.

Ordered tasks:

#### Task 1: Persist one long editable routine note
- Session goal: replace structured workout-entry storage assumptions with one
  stored note document for the active routine.
- Status: complete.
- Intended agent: `claude`
- Allowed scope: workout note persistence, load or save plumbing, and tests.
- Explicit out of scope: analytics UI.
- Dependency: Phase 1 complete.
- Verification target: note content can be saved, reopened, edited, and
  cleared without losing canonical raw text.
- Stop condition: workout history no longer depends on rigid structured
  workout-entry saves.

#### Task 2: Build tolerant workout-note parsing for sample-style shorthand
- Session goal: support headings, exercise declarations, inline notes, partial
  lines, repeated sets, mixed weights, and non-weight-based movements.
- Status: complete.
- Intended agent: `claude`
- Allowed scope: parser and parser tests.
- Explicit out of scope: UI.
- Dependency: Persist one long editable routine note.
- Verification target: sample workout formats parse into stable exercise
  blocks and set-level records without blocking note save on ambiguity.
- Stop condition: unclear note fragments degrade analytics gracefully instead
  of rejecting the note.

#### Task 3: Define derived workout analytics inputs
- Session goal: produce parse outputs suitable for exercise selection, PR
  calculation, 1k tracking, and PO comparison.
- Intended agent: `claude`
- Allowed scope: derived data model and tests.
- Explicit out of scope: analytics screen rendering.
- Dependency: Build tolerant workout-note parsing for sample-style shorthand.
- Verification target: parsed sets are individually usable for formulas while
  grouped line or session context remains available for repeatability logic.
- Stop condition: analytics work does not need to reinvent parser output
  contracts.

### Phase 3: Workout Notepad UX
- Phase goal: deliver a workout experience that feels like a notepad first and
  a tracker second.
- Allowed scope: note editor UX, formatted mirror of note content, and
  exercise selection interaction.
- Explicit out of scope: analytics engine internals.
- Dependency: Phase 2 Task 2 available.
- Completion condition: the user can log workouts in Kilo the same way they
  log them in Google Keep, without rigid form friction.

Ordered tasks:

#### Task 1: Replace rigid workout entry UI with raw note editing
- Session goal: make workout logging a plain editable note instead of a strict
  structured entry form.
- Status: complete.
- Intended agent: `gemini`
- Allowed scope: workout logging screen, editor interaction, and local
  validation behavior.
- Explicit out of scope: parser internals.
- Dependency: Phase 2 Task 1 available.
- Verification target: no required exercise catalog, fixed set rows, or
  submission-blocking structured workout fields remain in the primary flow.
- Stop condition: raw note entry is the default workout authoring experience.

#### Task 2: Add a formatted mirror of the workout note
- Session goal: preserve aesthetics without changing the underlying note
  model.
- Status: complete.
- Intended agent: `gemini`
- Allowed scope: workout tab presentation only.
- Explicit out of scope: parser internals or analytics math.
- Dependency: Replace rigid workout entry UI with raw note editing.
- Verification target: headings, exercise blocks, and history lines render
  more cleanly while staying faithful to the raw text.
- Stop condition: the app can present the note neatly without introducing
  tracker-style rigidity.

#### Task 3: Add exercise tracking controls from parsed workout content
- Session goal: let the user click exercises to include or remove them from
  analytics tracking.
- Status: complete.
- Intended agent: `gemini`
- Allowed scope: workout read view interaction and tracked-exercise selection
  UI.
- Explicit out of scope: PR math.
- Dependency: Add a formatted mirror of the workout note.
- Verification target: bench, squat, deadlift, and optional extra tracked
  exercises can be selected from parsed content without editing note syntax.
- Stop condition: analytics tracking selection is explicit and low-friction.

### Phase 4: Weight Logging Corrections And Trends
- Phase goal: keep weight tracking separate, minimal, and fully correctable.
- Allowed scope: weight-entry edit or delete flows, rolling averages, rate
  flags, and related UI.
- Explicit out of scope: workout-note behavior.
- Dependency: Phase 1 complete.
- Completion condition: weight entries are easy to log, edit, remove, and
  review without touching workout workflows.

Ordered tasks:

#### Task 1: Add durable weight edit and delete flows
- Session goal: fix the current inability to correct mistaken weight entries.
- Status: complete.
- Intended agent: `gemini`
- Allowed scope: weight history UI, edit interaction, delete interaction, and
  any minimal plumbing required to support those flows.
- Explicit out of scope: workout logging.
- Dependency: Phase 1 complete.
- Verification target: a saved daily weight can be opened, corrected in place,
  or removed from history.
- Stop condition: accidental wrong submissions are recoverable in-product.

#### Task 2: Add rolling averages and rate-of-change flags
- Session goal: show 7-day and 30-day averages plus alerts for gain or loss
  faster than 0.5 lb per week.
- Status: complete.
- Intended agent: `claude`
- Allowed scope: calculations, derived trend model, and supporting tests.
- Explicit out of scope: broad visual redesign.
- Dependency: Add durable weight edit and delete flows.
- Verification target: analytics update immediately when weight data changes.
- Stop condition: the weight tab has useful trend feedback without becoming a
  nutrition dashboard.

### Phase 5: Workout Analytics v2
- Phase goal: provide lightweight strength analytics without agent
  involvement and without bloating the product.
- Allowed scope: estimated PR math, 1k tracking, PO or repeatability logic,
  and analytics tab presentation.
- Explicit out of scope: coaching or recommendations.
- Dependency: Phases 2 and 3 complete.
- Completion condition: the analytics tab gives immediate value for tracked
  lifts, 1k progress, and workout progression.

Ordered tasks:

#### Task 1: Build the estimated PR engine
- Session goal: calculate exercise PRs from parsed sets using Epley at the
  individual-set level.
- Status: complete.
- Intended agent: `claude`
- Allowed scope: calculations, parser integration, and tests.
- Explicit out of scope: analytics tab visuals.
- Dependency: Phase 2 Task 3 available.
- Verification target: each parseable set can produce an estimated PR and each
  tracked exercise surfaces the best current estimate.
- Stop condition: the app no longer depends on an external agent to estimate
  strength progress.

#### Task 2: Build 1k tracking from selected lifts
- Session goal: sum the user-selected bench, squat, and deadlift PR estimates
  toward the 1,000 lb goal.
- Status: complete.
- Intended agent: `claude`
- Allowed scope: tracked-lift aggregation and tests.
- Explicit out of scope: generic recommendations.
- Dependency: Build the estimated PR engine.
- Verification target: changing tracked exercises or editing note content
  immediately changes the 1k total.
- Stop condition: the 1k goal is visible and derived locally.

#### Task 3: Build PO and repeatability signals
- Session goal: show whether a tracked exercise improved, held, or regressed
  relative to its previous comparable result while also reflecting repeated
  heavy-set context.
- Status: complete.
- Intended agent: `claude`
- Allowed scope: progression logic and tests.
- Explicit out of scope: coaching language.
- Dependency: Build the estimated PR engine.
- Verification target: a line like `305 6,6,4 295 6` is treated as stronger
  session evidence than a lone `305 6`, even when the formal PR stays
  set-based.
- Stop condition: analytics capture both estimated max strength and evidence
  of repeatable performance.

#### Task 4: Build the analytics tab UI
- Session goal: present tracked lifts, estimated PRs, 1k progress, PO, and
  weight trends in one clean analytics surface.
- Status: complete.
- Intended agent: `gemini`
- Allowed scope: analytics tab presentation and user interaction.
- Explicit out of scope: analytics formula design.
- Dependency: Phase 4 Task 2 and Phase 5 Tasks 1 through 3 available.
- Verification target: analytics are useful at a glance and stay visually
  minimal.
- Stop condition: the product provides feedback value without drifting into a
  full coaching product.

## MVP v2 Acceptance Checklist
1. Workout logging gates
   - The workout tab allows freeform note editing without requiring structured
     exercise rows or predefined exercises.
   - The workout note can be saved, reopened, edited, and cleared while
     preserving raw text fidelity.
   - Parse ambiguity does not block note save.

2. Workout derivation gates
   - Parsed workout content can power a formatted read view without replacing
     the raw note as source of truth.
   - Parsed exercises can be selected or removed from analytics tracking
     directly in the UI.
   - Editing or removing note content immediately changes derived workout
     analytics.

3. Weight gates
   - A daily weight entry can be created quickly in a dedicated weight flow.
   - A saved weight entry can be edited or deleted without leaving the product.
   - Weight trends and flags update immediately after edit or delete actions.

4. Analytics gates
   - The app shows estimated PRs for tracked exercises using Epley.
   - The app shows a 1k total derived from the selected bench, squat, and
     deadlift exercises.
   - The app shows progression signals that account for repeated heavy-set
     context separately from the formal estimated PR.
   - The app shows 7-day and 30-day rolling weight averages plus pace flags.

5. MVP v2 non-goal gates
   - v2 does not require coaching, exercise catalogs, auto-generated programs,
     social features, or nutrition expansion.
   - v2 does not require forcing the user into tracker-native syntax or data
     entry patterns.

## Recommended Implementation Ownership
- `codex`
  - planning
  - roadmap and spec maintenance
  - card creation
  - review and coordination
- `claude`
  - parser work
  - data model and persistence logic
  - derived metrics, PR math, PO logic, and tests
- `gemini`
  - workout logging UX
  - weight-screen correction UX
  - analytics screen presentation
  - note read-view and exercise selection interaction

Best-agent fit should win if it conflicts with the repo's default routing
guidance, but this roadmap does not currently require overriding that default.

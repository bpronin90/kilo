# MVP Roadmap For Kilo

## MVP Definition
Kilo MVP is a single-user logging product for workouts and bodyweight with a reliable path from input to saved record to visible history. The MVP should let a user enter a workout or weight entry, have the system parse and validate it well enough to prevent obvious bad data, persist it in Supabase, and show the saved results back in a simple UI with basic correction flows.

MVP non-goals:
- Coaching
- Recommendations
- Advanced analytics
- Social features
- Multi-user collaboration
- Wearables or import integrations
- Automation beyond core parsing
- Broad settings or customization
- Prototype-only work that does not directly support the logging loop

## Ordered MVP Roadmap

### Phase 1: Lock The MVP Contract
- Phase goal: turn the current spec into a strict implementation contract for MVP only.
- Allowed scope: product spec cleanup, acceptance criteria, terminology, and explicit MVP boundaries.
- Explicit out of scope: implementation, schema work, UI building, parser tuning, prototype expansion.
- Dependency: none.
- Completion condition: the team has one stable MVP definition with accepted entities, user flows, and non-goals.

Ordered tasks:

#### Task 1: Finalize MVP user flows
- Session goal: lock the minimum end-to-end flows required for launch.
- Intended agent: `codex`
- Allowed scope: define the exact MVP flows for logging weight, logging workouts, reviewing saved entries, and correcting mistakes.
- Explicit out of scope: field-level implementation details, future features, admin workflows.
- Dependency: none.
- Verification target: written flow list with acceptance criteria for each flow.
- Stop condition: every MVP flow is either included now or explicitly deferred.

MVP flows included for launch:

1. Log a weight entry
   - Flow: the user enters one weight entry, submits it, receives a clear save result, and can later see that saved weight entry in recent history.
   - Acceptance criteria:
     - A valid weight entry can move from input to saved record without requiring any manual database or admin step.
     - An invalid weight entry is blocked before save with a clear failure result.
     - A successful weight save is visible in the product as a recent saved entry.

2. Log a workout entry
   - Flow: the user enters one workout entry, submits it, receives a clear save result, and can later see that saved workout entry in recent history.
   - Acceptance criteria:
     - A valid workout entry can move from input to saved record without requiring any manual database or admin step.
     - An invalid workout entry is blocked before save with a clear failure result.
     - A successful workout save is visible in the product as a recent saved entry.

3. Review saved recent entries
   - Flow: after saving weight or workout data, the user can open the product and verify the most recent saved entries in a simple history view.
   - Acceptance criteria:
     - Recent history shows newly saved entries in a predictable order.
     - Each recent entry exposes enough detail for the user to confirm what was saved.
     - Review of saved entries does not depend on prototype-only tools or direct database access.

4. Correct an obvious recent mistake
   - Flow: if the user notices a clearly wrong recent weight or workout entry, the user can correct or remove that recent entry without leaving the product.
   - Acceptance criteria:
     - The user can fix or remove at least one obviously wrong recent entry through a product flow.
     - The corrected result is reflected in recent history after the action completes.
     - Correction does not require revision history, bulk editing, or direct database access.

Flows explicitly deferred from MVP:

- Field-level authoring conveniences such as advanced helpers, smart defaults, or guided entry composition.
- Flexible free-form parsing beyond the constrained MVP input formats.
- Admin or support workflows for managing user data.
- Bulk entry, imports, exports, or wearable sync.
- Analytics, trends, coaching, or recommendations.
- Multi-user collaboration, sharing, or social flows.
- Settings, customization, or other non-core account management flows.

#### Task 2: Freeze MVP entities and terminology
- Session goal: define the minimum domain objects and names the rest of the work depends on.
- Intended agent: `codex`
- Allowed scope: user-facing terms and the minimum record shapes implied by the product spec.
- Explicit out of scope: database migration design, API contracts, parser internals.
- Dependency: Finalize MVP user flows.
- Verification target: one approved list of core entities and terms.
- Stop condition: no unresolved naming or entity ambiguity remains for MVP sequencing.

#### Task 3: Define MVP acceptance gates
- Session goal: turn the spec into release gates that later phases can satisfy.
- Intended agent: `codex`
- Allowed scope: launch checklist, must-pass behaviors, explicit non-goals.
- Explicit out of scope: test implementation, QA execution, performance tuning beyond core expectations.
- Dependency: Freeze MVP entities and terminology.
- Verification target: short acceptance checklist covering logging, storage, retrieval, and correction.
- Stop condition: later implementation work can be judged against a fixed MVP bar.

### Phase 2: Data Foundation
- Phase goal: establish the minimum persisted model and app plumbing needed for logging.
- Allowed scope: Supabase schema, write/read path design, validation boundaries, environment setup needed for MVP.
- Explicit out of scope: parser sophistication, broad UI polish, analytics, reporting.
- Dependency: Phase 1 complete.
- Completion condition: the app has a stable minimal data model and a verified save/read foundation for MVP records.

Ordered tasks:

#### Task 1: Define persisted record model
- Session goal: translate MVP entities into the minimum durable storage model.
- Intended agent: `claude`
- Allowed scope: tables, required fields, relationships, and deletion or update expectations for MVP.
- Explicit out of scope: speculative extensibility, non-MVP metrics, reporting tables.
- Dependency: Phase 1 complete.
- Verification target: schema proposal matches every Phase 1 MVP flow.
- Stop condition: no MVP flow requires an undefined persisted record.

#### Task 2: Establish validation and write boundaries
- Session goal: define where invalid or partial data is rejected before persistence.
- Intended agent: `claude`
- Allowed scope: input validation boundaries, canonical save shape, minimal error categories.
- Explicit out of scope: parser heuristics, UI copy polish, future import rules.
- Dependency: Define persisted record model.
- Verification target: clear pass or fail cases for each record type.
- Stop condition: save behavior is predictable enough for parser and UI work to proceed.

#### Task 3: Verify read path for recent history
- Session goal: confirm the minimum query or view model needed for MVP history screens.
- Intended agent: `claude`
- Allowed scope: recent entries retrieval, ordering, basic grouping if required by MVP.
- Explicit out of scope: dashboards, trends, aggregations, performance work beyond obvious blockers.
- Dependency: Establish validation and write boundaries.
- Verification target: each MVP history or review flow can be served from the proposed read path.
- Stop condition: UI work does not need to invent data access behavior later.

### Phase 3: Input And Parsing
- Phase goal: make workout and weight entry creation usable enough for MVP.
- Allowed scope: minimum parser behavior, fallback input constraints, parse error handling.
- Explicit out of scope: natural-language ambition beyond MVP, bulk import, parser optimization for edge formats.
- Dependency: Phase 2 complete.
- Completion condition: a user can create valid workout and weight records through a constrained, reliable input path.

Ordered tasks:

#### Task 1: Define accepted MVP input formats
- Session goal: narrow the input surface so parser work stays disciplined.
- Intended agent: `codex`
- Allowed scope: accepted syntax or examples for workout entries and weight entries.
- Explicit out of scope: flexible free-form language support, legacy or prototype compatibility unless explicitly required.
- Dependency: Phase 2 complete.
- Verification target: finite list of accepted examples and explicit rejected examples.
- Stop condition: parser scope is small enough to implement in one pass without guessing.

#### Task 2: Build weight-entry parse path
- Session goal: support the simplest valid weight logging path first.
- Intended agent: `claude`
- Allowed scope: parse, validate, normalize, and save weight entries.
- Explicit out of scope: workout parsing, edit history, UI polish.
- Dependency: Define accepted MVP input formats.
- Verification target: accepted weight examples persist correctly; invalid examples fail clearly.
- Stop condition: weight logging is independently functional end to end.

#### Task 3: Build workout-entry parse path
- Session goal: support the minimum valid workout logging path for MVP.
- Intended agent: `claude`
- Allowed scope: parse, validate, normalize, and save workout entries.
- Explicit out of scope: advanced exercise grammar, recommendations, summary analytics.
- Dependency: Build weight-entry parse path.
- Verification target: accepted workout examples persist correctly; invalid examples fail clearly.
- Stop condition: the MVP workout logging loop works without manual database intervention.

### Phase 4: Core UI For Logging
- Phase goal: expose the MVP logging loop in the product UI.
- Allowed scope: primary entry surfaces, success or failure feedback, recent-history visibility.
- Explicit out of scope: advanced navigation, visual polish beyond usability, settings, onboarding expansion.
- Dependency: Phase 3 complete.
- Completion condition: a user can log, confirm, and review entries through the UI without relying on prototype-only tools.

Ordered tasks:

#### Task 1: Add weight logging UI
- Session goal: ship the minimum UI path for entering and saving weight.
- Intended agent: `gemini`
- Allowed scope: weight input form or surface, validation feedback, success confirmation.
- Explicit out of scope: workout UI, charts, profile or settings surfaces.
- Dependency: Phase 3 complete.
- Verification target: user can submit a valid weight entry and see confirmation in UI.
- Stop condition: weight logging is usable without hidden or manual steps.

#### Task 2: Add workout logging UI
- Session goal: ship the minimum UI path for entering and saving workouts.
- Intended agent: `gemini`
- Allowed scope: workout input surface, validation feedback, success confirmation.
- Explicit out of scope: history editing, analytics, advanced formatting helpers.
- Dependency: Add weight logging UI.
- Verification target: user can submit a valid workout entry and see confirmation in UI.
- Stop condition: workout logging is usable without prototype-only flows.

#### Task 3: Add recent history view
- Session goal: let the user confirm what was saved.
- Intended agent: `gemini`
- Allowed scope: basic recent entries list and enough detail to verify saved data.
- Explicit out of scope: trends, filtering, exports, deep drilldowns.
- Dependency: Add workout logging UI.
- Verification target: newly saved entries appear in the expected order with core fields visible.
- Stop condition: the MVP loop includes visible feedback after save.

### Phase 5: Correction And Launch Readiness
- Phase goal: remove the last blockers to a usable MVP.
- Allowed scope: basic correction flow, error-state coverage, final acceptance verification, prototype retirement where needed.
- Explicit out of scope: post-MVP enhancements, broad refactors, optimization work without a concrete blocker.
- Dependency: Phase 4 complete.
- Completion condition: the MVP acceptance gates from Phase 1 are satisfied and no core logging flow depends on prototype-only behavior.

Ordered tasks:

#### Task 1: Add minimum correction flow
- Session goal: let users fix or remove an obviously wrong recent entry.
- Intended agent: `gemini`
- Allowed scope: simple edit or delete path for the most recent or recent records, depending on the Phase 1 contract.
- Explicit out of scope: full revision history, bulk editing, audit tooling.
- Dependency: Phase 4 complete.
- Verification target: a bad entry can be corrected without direct database access.
- Stop condition: obvious user mistakes no longer block MVP usability.

#### Task 2: Close parser and validation gaps
- Session goal: fix only the concrete failure cases found against the MVP acceptance gates.
- Intended agent: `claude`
- Allowed scope: targeted parser or validation fixes tied to blocked MVP scenarios.
- Explicit out of scope: parser expansion for non-MVP formats, generalized cleanup.
- Dependency: Add minimum correction flow.
- Verification target: every Phase 1 acceptance case passes on the intended input set.
- Stop condition: remaining parser work is enhancement, not MVP-critical.

#### Task 3: Run MVP acceptance review
- Session goal: verify that the product meets the locked MVP contract and identify only launch-blocking gaps.
- Intended agent: `codex`
- Allowed scope: acceptance review, gap list, release recommendation for MVP readiness.
- Explicit out of scope: implementing fixes, drafting future roadmap beyond blocked items.
- Dependency: Close parser and validation gaps.
- Verification target: explicit pass or fail against every Phase 1 acceptance gate.
- Stop condition: MVP is either ready or reduced to a short blocker list.

## Open Questions / Blockers
None for this prompt-only roadmap.

Assumptions used:
- The MVP centers on workout logging, weight logging, storage, and recent-history review.
- Supabase is the persistence layer for MVP.
- Parser capability is part of the product's core value, but it should be constrained rather than ambitious in MVP.
- Prototype work should only be carried forward when it directly shortens the path to the MVP logging loop.

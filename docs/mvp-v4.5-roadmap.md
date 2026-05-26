# MVP4.5 Roadmap

Status: active stabilization roadmap. Phase 3 / Task 9 is complete; Phase 4
contract hardening remains in progress.

This roadmap starts after MVP4.0 and is intentionally narrower in one sense
and deeper in another:

- MVP4 fixed a large amount of visible product breakage and unblocked the
  native app from feeling obviously unfinished.
- MVP4.5 is not another general polish pass.
- MVP4.5 is the data-stability and consistency pass: fix ownership, remove
  mixed-source behavior, harden tests, then redesign the UI on top of the
  stabilized model.

This pass follows a few strict rules:

- data stabilization comes before UI redesign
- no screen should keep its own parallel interpretation of the same data
- raw user-entered data remains canonical
- derived analytics should come from one shared layer, not per-tab drift
- design review happens after stabilization, not in parallel with it
- layman-readable calculation docs should describe stabilized reality, not a
  moving target

Issue-label policy for this pass:

- every MVP4.5 issue must include the label `mvp4.5`
- use `Phase X / Task Y:` issue titles
- keep issue scope narrow enough for a normal implementation/review pass
- prefer `reasoning:medium`; use `reasoning:high` only when the issue itself is
  visibly complex

Agent routing follows repo policy:

- `agent:gemini` for frontend / UI implementation
- `agent:claude` for backend / data / parser / logic implementation
- `agent:codex` for planning, review, investigation, roadmap upkeep, and issue
  writing

---

## MVP4.5 Problems Summary

- **Data ownership drift:** Home, Analytics, Log, and Weight do not yet read
  from one clear shared derivation model. Mixed-source behavior undermines
  trust and makes implementation brittle.
- **Workout semantics drift:** workout progression, `Weeks In`, weekly
  summaries, and related signals need one session-order-based interpretation
  instead of ad hoc per-consumer logic.
- **Weight derivation confidence:** raw weight history appears sound, but the
  ownership and presentation contract for derived weight/goal calculations
  still needs a final stabilization pass.
- **Documentation gap:** the repo needs both developer-facing architecture/docs
  and one human-readable calculation reference that can later inform in-app
  terminology/help.
- **App-shell inconsistency:** safe-area and shared boundary/layout behavior
  should be fixed before deeper UI review.
- **UI inconsistency:** once the data layer is stable, Home and Progressive
  Overload need structured redesign passes instead of isolated one-off fixes.

---

## Tracker Cleanup Before MVP4.5 Implementation

This is roadmap setup, not a separate phase.

- `#63` — leave on hold outside MVP4.5. OTA-for-iOS remains non-actionable for
  the current environment.
- `#87` — leave on hold outside MVP4.5. OTA strategy cleanup remains deferred
  until the owner chooses a real update direction.
- `#89` — close as duplicate/superseded by `#90`.
- `#90` / `#91` — move to MVP5 backlog. Deload is explicitly post-MVP4.5.
- `#92` — defer to MVP5 backlog unless it becomes trivial after session
  semantics stabilize; it is not a MVP4.5 priority.
- `#164` — close as superseded/rejected. The asterisk model is no longer a
  desired product direction.
- `#165` / `#166` — leave in backlog, explicitly outside MVP4.5. Non-weighted
  tracked-exercise expansion is not part of this pass.
- `#169` / `#170` — merge conceptually into one later MVP4.5 UI track for
  approved Progressive Overload redesign.
- `#171` / `#175` — do not use them as the final human-readable truth artifact
  directly. MVP4.5 should create one new late-phase human-doc closeout issue
  that reflects stabilized behavior after the refactor.
- `big_3_deltas` — treat as a removal candidate inside MVP4.5 stabilization
  work unless a clear product need reappears.

---

### Phase 1: Audit Closeout And Refactor Setup
- Phase goal: finish only the remaining audit/setup work needed before the
  refactor starts.
- Why this phase comes here: MVP4.5 should not reopen broad rediscovery, but it
  still needs a clean starting contract for weight and for the final human-doc
  framework.
- Completion condition: the remaining unstabilized data surfaces are mapped,
  the final human-doc framework exists, and implementation issues can proceed
  without guesswork.

Ordered tasks:

#### Task 1: Audit native weight and goal calculation ownership

- **Title:** `Phase 1 / Task 1: Audit native weight and goal calculation ownership`
- **Goal:** close the remaining technical audit gap for weight/goal
  derivations so MVP4.5 refactor work starts from a known contract.
- **Scope:**
  - inventory the canonical raw weight inputs
  - map all derived weight/goal calculations and their consumers
  - identify duplicate or conflicting derivations across Weight, Home, and
    Analytics
  - produce an implementation-ready follow-up brief
- **Out of scope:**
  - refactoring product code
  - UI redesign
  - final layman-facing documentation text
- **Verification:**
  - one clear producer/consumer map exists for weight and goal calculations
  - any duplicate derivation paths are explicitly named
  - the resulting implementation issue does not require another audit pass
- **Labels:**
  - `mvp4.5`
  - `agent:codex`
  - `area:weight`
  - `area:docs`
  - `type:planning`
  - `effort:default`

#### Task 2: Define shared workout session semantics for stabilization

- **Title:** `Phase 1 / Task 2: Define shared workout session semantics for stabilization`
- **Goal:** lock the session-order semantics that workout consumers must share
  during MVP4.5 refactor work.
- **Scope:**
  - define the canonical meaning of session depth / progression depth
  - define how `Weeks In` and related routine-progress signals should count
  - explicitly reject calendar-driven workout semantics where session-order
    semantics are the intended rule
  - define which workout behaviors remain calendar-driven by exception
- **Out of scope:**
  - weight trends and target-date logic
  - non-weighted tracked-exercise expansion
  - UI redesign
- **Verification:**
  - `Weeks In` and session count semantics are unambiguous
  - the issue includes enough concrete examples for implementers and reviewers
  - later workout tasks can reference one shared semantic contract
- **Labels:**
  - `mvp4.5`
  - `agent:codex`
  - `area:workouts`
  - `area:docs`
  - `type:planning`
  - `effort:default`

#### Task 3: Create the human-readable calculation-reference framework

- **Title:** `Phase 1 / Task 3: Create human-readable calculation reference framework`
- **Goal:** create the structure for the final layman-facing calculations doc
  without trying to fill it from unstable behavior yet.
- **Scope:**
  - create one human-readable reference doc structure
  - organize it by calculation type, where the user sees it, and short FAQ
    entries
  - make the structure easy to adapt later into in-app terminology/help
- **Out of scope:**
  - documenting unstable current behavior in detail
  - final wording for every calculation
  - product-code changes
- **Verification:**
  - the doc structure exists
  - it is navigable without engineering context
  - later stabilization issues can update it directly at closeout time
- **Labels:**
  - `mvp4.5`
  - `agent:codex`
  - `area:docs`
  - `type:planning`
  - `effort:default`

---

### Phase 2: Workout Data Refactor
- Phase goal: make workout analytics read from one canonical shared derivation
  layer sourced from raw workout data.
- Why this phase comes here: this is the highest-trust-risk area and the main
  blocker behind cross-tab inconsistency.
- Completion condition: Home, Analytics, and Log no longer drift on workout
  analytics ownership or session semantics.

Ordered tasks:

#### Task 4: Build the canonical workout analytics derivation layer

- **Title:** `Phase 2 / Task 4: Build canonical workout analytics derivation layer`
- **Goal:** create one shared workout-analytics derivation surface that turns
  canonical workout-note input into the outputs consumers are allowed to use.
- **Scope:**
  - base the layer on canonical raw workout-note input
  - expose shared outputs for session depth, classifications, summary counts,
    and supported workout analytics
  - eliminate consumer-side parallel interpretation rules
  - migrate `deriveSkipData` attendance window from 30-day calendar to
    session-depth per the session-semantics contract (#178)
- **Out of scope:**
  - Home redesign
  - Weight/goal derivations
  - non-weighted tracked-exercise expansion
- **Verification:**
  - one shared derivation layer exists
  - consumers can switch to it without screen-local recomputation
  - unsupported or duplicate outputs are not carried forward casually
- **Labels:**
  - `mvp4.5`
  - `agent:claude`
  - `area:workouts`
  - `type:implementation`
  - `effort:heavy`

#### Task 5: Fix `Weeks In` and routine-progress trust on Home

- **Title:** `Phase 2 / Task 5: Fix Weeks In and routine-progress trust on Home`
- **Goal:** repair the first known user-facing trust failure by making Home
  consume the shared routine/session semantics correctly.
- **Scope:**
  - migrate `Weeks In` to the canonical shared workout derivation output
  - verify Home is no longer using an incompatible interpretation of routine
    depth
  - keep the fix narrow to trust-critical routine-progress behavior
- **Out of scope:**
  - broader Home redesign
  - weight card changes
  - new analytics features
- **Verification:**
  - `Weeks In` matches the shared semantic contract
  - the user can trust that routine depth is no longer a one-off Home rule
  - tests pin representative progression-depth cases
- **Labels:**
  - `mvp4.5`
  - `agent:claude`
  - `area:workouts`
  - `area:ui`
  - `type:bug`
  - `effort:default`

#### Task 6: Simplify Home weekly summary and remove unsupported workout fields

- **Title:** `Phase 2 / Task 6: Simplify Home weekly summary and remove unsupported workout fields`
- **Goal:** remove unsupported or mixed-source workout summary behavior from
  Home so the screen only shows what the stabilized model can defend.
- **Scope:**
  - remove `big_3_deltas` from the active Home contract
  - strip or simplify any Home workout summary elements that depend on mixed or
    low-trust sourcing
  - keep only summary outputs backed by the canonical workout derivation layer
- **Out of scope:**
  - final Home redesign
  - Progressive Overload layout changes
  - non-weighted exercise analytics
- **Verification:**
  - unsupported workout fields are removed from the Home contract
  - Home no longer depends on ad hoc or speculative workout outputs
  - the resulting panel is simpler but more trustworthy
- **Labels:**
  - `mvp4.5`
  - `agent:claude`
  - `area:workouts`
  - `area:ui`
  - `type:implementation`
  - `effort:default`

#### Task 7: Migrate Analytics and Log consumers to the shared workout layer

- **Title:** `Phase 2 / Task 7: Migrate Analytics and Log consumers to shared workout derivations`
- **Goal:** finish the workout-side refactor by removing remaining screen-local
  drift in Analytics and any affected Log consumers.
- **Scope:**
  - move Analytics workout consumers onto the canonical derivation outputs
  - ensure Log is only a producer for raw workout input plus any explicitly
    allowed save-path responsibilities
  - remove duplicated workout interpretation logic where it still exists
- **Out of scope:**
  - major UI redesign
  - new tracked-exercise product rules
  - weight/goal derivation work
- **Verification:**
  - Analytics and Log no longer carry parallel workout interpretation logic
  - screen behavior remains consistent with Home after the migration
  - contract tests prove the same source data yields the same derived outputs
- **Labels:**
  - `mvp4.5`
  - `agent:claude`
  - `area:workouts`
  - `type:implementation`
  - `effort:heavy`

---

### Phase 3: Weight And Goal Data Refactor
- Phase goal: give weight and goal derivations the same single-owner treatment
  as workout analytics.
- Why this phase comes here: the raw weight data looks stable, but the
  derivation and consumer contract still needs one coherent pass.
- Completion condition: Weight, Home, and Analytics all read weight/goal
  signals from one shared derivation model.

Ordered tasks:

#### Task 8: Build the canonical weight and goal derivation layer

- **Title:** `Phase 3 / Task 8: Build canonical weight and goal derivation layer`
- **Goal:** centralize weight trends, pace, rolling averages, and goal guidance
  behind one shared derivation layer fed by canonical raw weight history and
  persisted goal state.
- **Scope:**
  - keep raw weight entries canonical
  - centralize derived weight/goal outputs in one shared layer
  - make the serving contract explicit for Weight, Home, and Analytics
- **Out of scope:**
  - redesigning Weight screen layout
  - changing the raw entry model
  - new backend/database work
- **Verification:**
  - one shared derivation layer exists for weight/goal calculations
  - consumers stop shaping their own incompatible variants
  - tests cover the shared outputs directly
- **Labels:**
  - `mvp4.5`
  - `agent:claude`
  - `area:weight`
  - `type:implementation`
  - `effort:heavy`

#### Task 9: Migrate Weight, Home, and Analytics to the shared weight layer

Status: complete via issue `#185`.

- **Title:** `Phase 3 / Task 9: Migrate Weight, Home, and Analytics to shared weight derivations`
- **Goal:** finish the weight-side refactor by making all consumers read the
  same derived weight/goal outputs.
- **Scope:**
  - migrate Weight-tab consumers
  - migrate Home weight-summary consumers
  - migrate Analytics weight consumers
  - remove screen-local shaping that conflicts with the shared layer
- **Out of scope:**
  - final dashboard redesign
  - changing raw weight-entry storage
  - deload/session-warning UI work
- **Verification:**
  - the same saved weight history yields the same derived answers everywhere
  - consumer drift is removed
  - any remaining screen-local logic is strictly presentational
- **Labels:**
  - `mvp4.5`
  - `agent:claude`
  - `area:weight`
  - `type:implementation`
  - `effort:default`

#### Task 10: Finalize weight-goal estimate framing after stabilization

- **Title:** `Phase 3 / Task 10: Finalize weight goal estimate framing after stabilization`
- **Goal:** revisit the current goal-estimate model only after the shared
  derivation contract is stable.
- **Scope:**
  - review the current weekly-pace / calorie-estimate model in the stabilized
    architecture
  - decide whether to keep it with clearer framing or tighten it with a
    narrower improved model
  - write the chosen product rule clearly enough for implementation or closure
- **Out of scope:**
  - redesigning the full Weight tab
  - introducing nutrition tracking
  - backend/database changes
- **Verification:**
  - one explicit decision exists for the estimate model
  - no consumer is left guessing whether the current formula is provisional
  - if a change is needed, the follow-up implementation scope is narrow
- **Labels:**
  - `mvp4.5`
  - `agent:codex`
  - `area:weight`
  - `area:docs`
  - `type:planning`
  - `effort:default`

---

### Phase 4: Contract Tests And Human Docs
- Phase goal: lock the stabilized model down in tests and publish the final
  human-readable explanation layer.
- Why this phase comes here: docs should describe settled behavior, and tests
  should protect that settled behavior before UI redesign builds on top of it.
- Completion condition: the canonical data contract is test-hardened and the
  layman-facing calculations reference reflects actual stabilized behavior.

Ordered tasks:

#### Task 11: Add canonical data-contract test coverage

- **Title:** `Phase 4 / Task 11: Add canonical data-contract test coverage`
- **Goal:** harden the stabilized data model with tests that assert one shared
  derivation path and one answer per input.
- **Scope:**
  - add workout contract tests
  - add weight/goal contract tests
  - add representative consumer-consistency tests where the same input should
    agree across tabs
- **Out of scope:**
  - broad UI snapshot growth
  - unrelated refactors
  - performance tuning not directly needed for the contract
- **Verification:**
  - canonical workout and weight derivations are directly tested
  - mixed-source regressions are harder to reintroduce
  - trust-critical cases such as `Weeks In` are pinned
- **Labels:**
  - `mvp4.5`
  - `agent:claude`
  - `area:workouts`
  - `area:weight`
  - `type:implementation`
  - `effort:default`

#### Task 12: Publish the human-readable calculations reference

- **Title:** `Phase 4 / Task 12: Publish human-readable calculations reference`
- **Goal:** fill the framework from Phase 1 with the actual stabilized behavior
  so the repo has one human-readable source for app calculations and
  terminology.
- **Scope:**
  - document stabilized calculation behavior by calculation type
  - note where the user sees each calculation in the app
  - include short FAQ-style clarifications
  - keep the language adaptable for future in-app terminology/help
- **Out of scope:**
  - redesigning help screens
  - speculative future analytics
  - restating unstable historical behavior
- **Verification:**
  - one human-readable doc exists and is easy to navigate
  - calculation explanations align with stabilized code and architecture docs
  - future issue closeout can update this doc as part of behavior changes
- **Labels:**
  - `mvp4.5`
  - `agent:codex`
  - `area:docs`
  - `type:planning`
  - `effort:default`

---

### Phase 5: App Shell Consistency
- Phase goal: fix cross-screen shell/layout behavior before screen-level design
  passes land.
- Why this phase comes here: safe-area and boundary problems affect every
  screen and should not be solved as isolated one-off UI tweaks.
- Completion condition: the app shell fits devices cleanly and screens share a
  coherent boundary/container contract.

Ordered tasks:

#### Task 13: Implement safe-area and shared screen-container rules

- **Title:** `Phase 5 / Task 13: Implement safe-area and shared screen-container rules`
- **Goal:** establish the foundational shell/layout rules that every tab should
  follow.
- **Scope:**
  - fix top/bottom safe-area handling
  - define shared screen container boundaries and spacing behavior
  - remove obvious device-fit problems such as content bleeding into app
    boundaries
- **Out of scope:**
  - redesigning Home or Analytics information architecture
  - theme overhaul
  - Progressive Overload layout redesign
- **Verification:**
  - the app fits cleanly on affected devices
  - shared shell/layout behavior is consistent across tabs
  - later UI implementation can assume a stable app shell
- **Labels:**
  - `mvp4.5`
  - `agent:gemini`
  - `area:ui`
  - `type:implementation`
  - `effort:default`

---

### Phase 6: UI Design Review
- Phase goal: use the stabilized data model and stable shell to produce approved
  UI directions before implementation.
- Why this phase comes here: UI review should happen after the underlying model
  is trustworthy and the app shell is no longer moving.
- Completion condition: Home and Progressive Overload each have a concrete
  approved design direction, and cross-tab consistency rules are explicit.

Ordered tasks:

#### Task 14: Review the Home dashboard around trust and usefulness

- **Title:** `Phase 6 / Task 14: Review Home dashboard information hierarchy`
- **Goal:** define what Home should tell the user immediately once the data is
  trustworthy again.
- **Scope:**
  - decide the approved Home information hierarchy
  - keep the focus on "how am I doing?" signals
  - allow simplification/removal of weak current panels
- **Out of scope:**
  - implementation
  - inventing new analytics
  - redesigning weight/goal calculation rules
- **Verification:**
  - the design brief clearly states which Home signals stay, go, or change
  - the resulting implementation issue is narrow and direct
- **Labels:**
  - `mvp4.5`
  - `agent:codex`
  - `area:ui`
  - `area:docs`
  - `type:planning`
  - `effort:default`

#### Task 15: Review Progressive Overload redesign direction

- **Title:** `Phase 6 / Task 15: Review Progressive Overload redesign direction`
- **Goal:** merge the structure concerns from `#169` and the owner-provided
  visual direction from `#170` into one approved redesign brief.
- **Scope:**
  - review grouped/collapsible organization
  - use the owner-provided code as a strong directional reference, not a
    pixel-locked mandate
  - define final structure plus visual treatment together
- **Out of scope:**
  - implementation
  - changing workout analytics rules
  - non-weighted tracked-exercise expansion
- **Verification:**
  - one approved design brief replaces the split `#169` / `#170` direction
  - the implementation issue does not need another design round
- **Labels:**
  - `mvp4.5`
  - `agent:codex`
  - `area:ui`
  - `area:docs`
  - `type:planning`
  - `effort:default`

#### Task 16: Review cross-tab consistency anchored on the Log note surface

- **Title:** `Phase 6 / Task 16: Review cross-tab visual consistency rules`
- **Goal:** define the cross-tab consistency rules that should guide MVP4.5 UI
  implementation without flattening everything into generic sameness.
- **Scope:**
  - preserve the current-note presentation on Log as the strongest visual
    anchor
  - define what other routines may change versus what should stay uniform
  - keep the current color direction unless an explicit reviewed change is
    justified
- **Out of scope:**
  - implementation
  - rewriting the Log note presentation itself
  - brand overhaul
- **Verification:**
  - the brief states what is sacred, flexible, and shared
  - downstream UI implementation does not need to guess the visual rules
- **Labels:**
  - `mvp4.5`
  - `agent:codex`
  - `area:ui`
  - `area:docs`
  - `type:planning`
  - `effort:default`

---

### Phase 7: UI Implementation
- Phase goal: implement the approved UI changes on top of the stabilized data
  and shell layers.
- Why this phase comes here: this work should be straightforward execution of
  already-approved product and design rules.
- Completion condition: the app presents stable, trustworthy data through a
  consistent and approved UI.

Ordered tasks:

#### Task 17: Implement the approved Home dashboard redesign

- **Title:** `Phase 7 / Task 17: Implement approved Home dashboard redesign`
- **Goal:** rebuild Home around the stabilized data contract and approved
  information hierarchy.
- **Scope:**
  - apply the approved Home hierarchy
  - remove or simplify weak prior panels as needed
  - keep the implementation aligned with the stabilized derivation layer
- **Out of scope:**
  - changing underlying calculation rules
  - Progressive Overload redesign
  - theme overhaul without explicit approval
- **Verification:**
  - Home reads as a trustworthy "how am I doing?" dashboard
  - the implementation does not reintroduce mixed-source logic
- **Labels:**
  - `mvp4.5`
  - `agent:gemini`
  - `area:ui`
  - `type:implementation`
  - `effort:default`

#### Task 18: Implement the approved Progressive Overload redesign

- **Title:** `Phase 7 / Task 18: Implement approved Progressive Overload redesign`
- **Goal:** ship the approved Progressive Overload structure and visual
  treatment using the stabilized analytics contract.
- **Scope:**
  - grouped/collapsible organization
  - approved row/card treatment
  - search and layout behavior if the design brief keeps them
- **Out of scope:**
  - changing analytics semantics
  - non-weighted tracked-exercise expansion
  - unrelated Analytics redesign
- **Verification:**
  - Progressive Overload matches the approved brief
  - the implementation remains a consumer of stable shared analytics outputs
- **Labels:**
  - `mvp4.5`
  - `agent:gemini`
  - `area:ui`
  - `type:implementation`
  - `effort:default`

---

## MVP4.5 Explicit Deferrals

- Deload generation and deload UI (`#90`, `#91`) move to MVP5.
- Session-count warning-color UI (`#92`) is lower priority and can move to MVP5
  unless it becomes trivial after stabilization.
- Non-weighted tracked-exercise analytics expansion (`#165`, `#166`) is outside
  MVP4.5.
- OTA strategy / iOS OTA work (`#63`, `#87`) remains deferred outside MVP4.5.

---

## Bottom Line

MVP4.5 should not try to impress through more surface area. It should make the
app trustworthy again:

1. raw data stays canonical
2. one shared layer derives the answers
3. all consumers read those same answers
4. tests lock the contract
5. docs explain it clearly
6. only then does the UI redesign land

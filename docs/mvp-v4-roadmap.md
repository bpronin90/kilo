# MVP4.0 Roadmap

Status: draft for planning.

This roadmap translates the post-MVP3.5 findings into a phased MVP4.0 issue
stack. It keeps the same discipline as prior roadmap passes:

- phases are ordered by user-blocking severity first
- tasks are tightly scoped and intended to fit in a normal single agent session
- phases do not overlap on purpose
- design/spec work is separated from implementation where product rules are not
  yet settled

Issue-number policy for this pass:

- reuse GitHub issues `#122` through `#128` first, sequentially
- after `#128`, resume normal issue creation
- every MVP4 issue must include the label `mvp4.0`

Agent routing follows repo policy:

- `agent:gemini` for frontend / UI implementation
- `agent:claude` for backend / data / parser / logic implementation
- `agent:codex` for planning, review, investigation, and issue writing

---

## MVP4 Problems Summary

- **Home:** Kilo image is blurry and too large; `Weeks In` is not using the
  intended routine-progress rule; Home summary panels should not navigate.
- **Log:** current workout title is not behaving like a note title; current
  workout needs persistent collapse behavior; note save / done semantics are
  wrong; empty state auto-opens a note incorrectly; top-level `Edit` affordance
  is wrong for the current model; rendered workout typography still needs
  investigation.
- **Weight:** top summary is mostly good; goal panel needs design direction;
  trends panel layout is weak and needs redesign; duplicate-entry handling
  should remain unchanged in MVP4.
- **Analytics:** weight trends graph is broken; strength section spacing is
  broken; current strength cards do not reflect the desired metric model; the
  broader exercise-analytics rules need a dedicated spec before implementation.
- **More / Navigation:** Help back arrow is visually inconsistent.

---

### Phase 1: Repair Broken Core Flows
- Phase goal: fix the behaviors that currently make Log and Analytics feel
  broken.
- Why this phase comes here: these are direct workflow failures, not polish.
- Completion condition: note editing follows clear save-discard rules, the
  current routine is manageable, and Analytics renders core data again.

Ordered tasks:

#### Task 1: Fix workout-note save semantics and button actions

- **Title:** `MVP4: fix workout note save semantics`
- **Goal:** make note creation and editing obey explicit save/discard behavior.
- **Scope:**
  - `Save Changes` must persist note edits reliably
  - `Done` must stop acting like an implicit save
  - a brand-new unsaved note must prompt before discard when leaving with
    unsaved text
  - an existing saved note with unsaved edits must present a `Save or Discard`
    prompt when leaving without saving
  - button copy should return to `Done`
- **Allowed Files if determinable:**
  - `mobile/screens/LogScreen.js`
  - any directly-related local note editor helper already used by Log note save
    flow
- **Out of scope:**
  - current-routine collapse behavior
  - typography/rendering fixes
  - analytics rules
- **Verification:**
  - create a new note, type text, press `Done`, confirm discard prompt appears
  - create a new note, type text, save it, reload, confirm persistence
  - edit an existing note, press `Done`, confirm `Save or Discard` prompt
  - verify `Back` no longer silently saves
- **Labels:**
  - `mvp4.0`
  - `agent:gemini`
  - `area:ui`
  - `area:workouts`
  - `type:bug`
  - `effort:default`
- **Suggested runtime:** `agent:gemini`

#### Task 2: Make the current routine behave like a collapsible note

- **Title:** `MVP4: make current routine collapsible and title-driven`
- **Goal:** make the current routine act like a note while preserving the
  special rendered-workout treatment.
- **Scope:**
  - show the current note title as the collapsed row label
  - allow the current routine to collapse down to its title, similar to a
    non-current note
  - persist the collapsed / expanded state
  - when expanded, keep the nice rendered workout view
  - title tap should collapse / expand, not open edit
  - remove the top `Edit` button beside `Workout Note`
- **Allowed Files if determinable:**
  - `mobile/screens/LogScreen.js`
  - any directly-related local state helper for Log note presentation
- **Out of scope:**
  - deep typography cleanup
  - final edit-entry affordance inside rendered workout rows
  - empty-state redesign
- **Verification:**
  - current note can be collapsed to title-only
  - collapsed state persists when leaving and re-entering Log
  - expanded state still shows rendered workout
  - top `Edit` button no longer appears
- **Labels:**
  - `mvp4.0`
  - `agent:gemini`
  - `area:ui`
  - `area:workouts`
  - `type:implementation`
  - `effort:default`
- **Suggested runtime:** `agent:gemini`

#### Task 3: Fix empty Log state and stop unwanted note auto-open

- **Title:** `MVP4: fix empty Log state auto-open behavior`
- **Goal:** stop Log from throwing the user into an editor when no workout note
  exists yet.
- **Scope:**
  - when no workout has ever been logged, do not auto-open a note
  - do not auto-open the keyboard
  - show `New Routine` as the primary action
  - include short empty-state copy plus an example/sample card so the user can
    see what the format could look like
- **Allowed Files if determinable:**
  - `mobile/screens/LogScreen.js`
  - any small presentational component created only for the Log empty state
- **Out of scope:**
  - actual note save semantics
  - current-routine collapse behavior
  - typography investigation
- **Verification:**
  - fresh state opens Log without editor focus
  - keyboard stays closed
  - `New Routine` is visible immediately
  - empty-state copy and sample/example card render cleanly
- **Labels:**
  - `mvp4.0`
  - `agent:gemini`
  - `area:ui`
  - `area:workouts`
  - `type:bug`
  - `effort:default`
- **Suggested runtime:** `agent:gemini`

#### Task 4: Restore Analytics weight-trend rendering

- **Title:** `MVP4: fix Analytics weight trends graph rendering`
- **Goal:** make the Analytics weight trend graph render real data again.
- **Scope:**
  - repair the broken weight-trend graph path so it no longer shows nothing
  - keep same-day duplicate-weight behavior unchanged
  - do not alter current analytics rules for duplicate entries
- **Allowed Files if determinable:**
  - `mobile/screens/StatsScreen.js`
  - weight-trend helpers already feeding Analytics
- **Out of scope:**
  - trends panel visual redesign
  - goal-panel redesign
  - duplicate-entry policy changes
- **Verification:**
  - Analytics weight graph renders with existing saved data
  - same-day duplicate entries still behave exactly as they do today
  - no regression in Weight history behavior
- **Labels:**
  - `mvp4.0`
  - `agent:claude`
  - `area:weight`
  - `type:bug`
  - `effort:default`
  - `model:gpt-5.4`
  - `reasoning:medium`
- **Suggested runtime:** `agent:claude`, `model:gpt-5.4`, `reasoning:medium`

#### Task 5: Repair baseline strength analytics presentation

- **Title:** `MVP4: repair baseline strength analytics cards`
- **Goal:** fix the obviously broken current strength section without trying to
  solve the full future analytics spec yet.
- **Scope:**
  - restore uniform spacing between strength panels
  - for the current Big 3 tracked-lift cards, surface both `estimated 1RM` and
    `Kilo max` together
  - stop displaying tracked exercise names in lower case; normalize display to
    title case such as `Bench Press`
- **Allowed Files if determinable:**
  - `mobile/screens/StatsScreen.js`
  - any existing strength analytics formatter / presenter used by Analytics
- **Out of scope:**
  - full non-Big-3 analytics model
  - overload-rule redesign
  - non-weighted exercise analytics
- **Verification:**
  - strength section spacing matches neighboring app panels
  - a Big 3 tracked lift shows both `estimated 1RM` and `Kilo max`
  - tracked names render in title case
- **Labels:**
  - `mvp4.0`
  - `agent:gemini`
  - `area:ui`
  - `area:workouts`
  - `type:implementation`
  - `effort:default`
- **Suggested runtime:** `agent:gemini`

---

### Phase 2: Restore Home And Log Usability
- Phase goal: fix the parts of Home and Log that currently feel misleading or
  unfinished after the core bugs are gone.
- Why this phase comes here: the app should feel navigable and honest before
  deeper design work.
- Completion condition: Home reflects the intended static-dashboard behavior,
  and Log has a clear path from rendered view into editable raw note content.

Ordered tasks:

#### Task 6: Refresh Home header asset and remove panel navigation

- **Title:** `MVP4: sharpen Home header and remove tile navigation`
- **Goal:** clean up the Home surface so it looks intentional and no longer
  routes the user unexpectedly.
- **Scope:**
  - regenerate or replace the Kilo image with a sharper asset
  - make the Home image slightly smaller on the Home surface
  - remove all Home summary-panel navigation from `1k Club` and `Weight Trend`
  - leave those panels fully non-interactive
- **Allowed Files if determinable:**
  - `mobile/screens/HomeScreen.js`
  - the specific bundled Kilo image asset under the existing mobile brand/image
    path
- **Out of scope:**
  - `Weeks In` calculation rewrite
  - broader Home copy rewrite
  - analytics redesign
- **Verification:**
  - Home image is visibly sharper
  - Home image footprint is slightly smaller than current behavior
  - tapping `1k Club` or `Weight Trend` no longer navigates anywhere
- **Labels:**
  - `mvp4.0`
  - `agent:gemini`
  - `area:ui`
  - `type:implementation`
  - `effort:default`
- **Suggested runtime:** `agent:gemini`

#### Task 7: Rebuild `Weeks In` around routine progression depth

- **Title:** `MVP4: rebuild Weeks In from routine progression depth`
- **Goal:** make `Weeks In` match the intended routine-progression rule rather
  than a date-based approximation.
- **Scope:**
  - define `Weeks In` from the longest progression depth found in any exercise
    on any day in the current routine
  - treat the longest entry chain as the current routine week count
  - preserve `0` when nothing meaningful has been logged yet
  - use the user-provided progression model rather than `currentSince`
- **Allowed Files if determinable:**
  - `mobile/screens/HomeScreen.js`
  - parser / workout summarization helpers directly used to derive Home routine
    progress
- **Out of scope:**
  - deload logic
  - current-routine switching rules
  - analytics redesign
- **Verification:**
  - a routine with no logged progression shows `0`
  - a routine whose deepest single exercise line has 1 entry shows `1`
  - a routine whose deepest single exercise line has 12 entries shows `12`
  - mixed routines use the longest valid progression chain, not averages
- **Labels:**
  - `mvp4.0`
  - `agent:claude`
  - `area:workouts`
  - `area:ui`
  - `type:implementation`
  - `effort:heavy`
  - `model:gpt-5.4`
  - `reasoning:high`
- **Suggested runtime:** `agent:claude`, `model:gpt-5.4`, `reasoning:high`

#### Task 8: Define Log rendered-note interaction and copyability

- **Title:** `MVP4: spec rendered workout note interaction model`
- **Goal:** settle how the rendered current note should enter edit mode without
  breaking scroll, and define text-copy behavior.
- **Scope:**
  - define the final edit-entry affordance inside expanded rendered workout
    content
  - settle whether day text / workout text should be tappable instead of the
    full rendered body
  - define rendered workout copy behavior and granularity
  - produce a narrow implementation-ready spec for later execution
- **Allowed Files if determinable:**
  - `docs/mvp-v4-roadmap.md`
  - the eventual GitHub issue body for this spec
- **Out of scope:**
  - implementation of the chosen interaction
  - typography cleanup
- **Verification:**
  - spec explicitly states entry point(s) into raw edit mode
  - spec explicitly states scroll behavior and copyability expectations
  - resulting implementation issue can be written without re-planning
- **Final interaction spec:**
  - keep the expanded rendered workout body scroll-first
  - do not open edit mode from a single tap anywhere inside the expanded
    rendered note body
  - enter raw edit mode from a double tap anywhere inside the expanded rendered
    note body
  - do not require tapping the rendered day label or other header-like text to
    enter edit mode
  - keep the outer current-note title row behavior from Task 2 unchanged:
    single tap on the title still expands or collapses the note and is not an
    edit-entry path
  - exercise rows, set rows, notes, and spacer/body lines remain passive on
    single tap so normal reading and scrolling are not interrupted
  - drag/scroll gestures always win over edit-entry detection; double tap
    should only fire when the body is stationary rather than during an
    in-progress scroll gesture
  - rendered workout text should remain selectable so the user can highlight
    and copy arbitrary portions of the note
  - copy behavior should rely on normal platform text selection rather than a
    separate required whole-note copy affordance
  - the implementation may add an optional secondary whole-note `Copy`
    affordance later only if it does not compete with selection or add visual
    clutter, but selection is the primary copy model
  - this spec intentionally favors readable selectable content plus a deliberate
    double-tap edit gesture over single-tap edit affordances inside the body
- **Implementation handoff constraints:**
  - remove ambiguity by keeping body single tap inert and using double tap as
    the only in-body edit-entry path
  - if the current note is collapsed, expand/collapse continues to belong to
    the outer title row from Task 2; this spec only governs the expanded
    rendered state
  - follow-up implementation should verify that text selection, double-tap
    edit, and vertical scrolling can coexist without accidental edit entry
    during normal reading
- **Labels:**
  - `mvp4.0`
  - `agent:codex`
  - `area:docs`
  - `area:workouts`
  - `type:planning`
  - `effort:default`
  - `model:gpt-5.4`
  - `reasoning:medium`
- **Suggested runtime:** `agent:codex`, `model:gpt-5.4`, `reasoning:medium`

#### Task 9: Investigate exercise-log font rendering and normalization

- **Title:** `MVP4: investigate Log exercise typography and normalization`
- **Goal:** determine why rendered exercise logging still looks wrong and turn
  that into a targeted implementation brief.
- **Scope:**
  - inspect rendered exercise typography problems
  - determine how much is caused by inconsistent note entry versus renderer
    assumptions
  - define a concrete cleanup target that the app can handle robustly
- **Allowed Files if determinable:**
  - `mobile/screens/LogScreen.js`
  - parser / formatting helpers directly used by rendered workout output
  - the resulting issue or doc artifact for findings
- **Out of scope:**
  - shipping the typography fix itself
  - broader analytics work
- **Verification:**
  - findings identify root-cause categories
  - follow-up implementation issue can be scoped without broad rediscovery
- **Labels:**
  - `mvp4.0`
  - `agent:codex`
  - `area:workouts`
  - `area:docs`
  - `type:planning`
  - `effort:default`
  - `model:gpt-5.4`
  - `reasoning:medium`
- **Suggested runtime:** `agent:codex`, `model:gpt-5.4`, `reasoning:medium`

---

### Phase 3: Weight UX Design Pass
- Phase goal: settle the Weight-tab redesign direction before implementation.
- Why this phase comes here: the user called out design quality more than raw
  correctness here.
- Completion condition: implementation agents can execute Weight changes
  without needing to invent layout or product language.

Ordered tasks:

#### Task 10: Design the Weight goal-panel rewrite

- **Title:** `MVP4: design Weight goal panel rewrite`
- **Goal:** produce an implementation-ready UX brief for the odd-feeling goal
  panel.
- **Current-state note:**
  - preserve the native target-date picker behavior landed in `#139`
  - preserve the weekly pace and calorie guidance restored in `#144`
- **Scope:**
  - make `Target` and `By Date` the visual focus
  - preserve the useful pace and calorie guidance
  - update wording toward:
    - `Suggested Cal [surplus/deficit]`
    - `Target x lb/week`
  - define layout and copy clearly enough for direct implementation
- **Allowed Files if determinable:**
  - issue body / design brief only
- **Out of scope:**
  - implementation
  - duplicate-entry policy changes
  - changing target-date picker behavior
  - regressing weekly pace or calorie guidance
- **Verification:**
  - brief defines visual priority, copy, and expected information hierarchy
  - brief explicitly preserves target-date, pace, and calorie-estimate behavior
  - implementation issue can be created without product ambiguity
- **Labels:**
  - `mvp4.0`
  - `agent:codex`
  - `area:weight`
  - `area:docs`
  - `type:planning`
  - `effort:default`
  - `model:gpt-5.4`
  - `reasoning:medium`
- **Suggested runtime:** `agent:codex`, `model:gpt-5.4`, `reasoning:medium`

#### Task 11: Design the Weight trends panel redesign

- **Title:** `MVP4: design Weight trends panel layout`
- **Goal:** replace the current left-heavy / empty-space layout with an
  intentional trends panel design.
- **Outcome (`#153`):**
  - Weight should read as four stacked sections: weight entry, Goals, Trends,
    and History.
  - `Goals` and `Trends` should use the same heading treatment as `History`.
  - Trends should render as three stacked panels: `Pace`, `7-day rolling`, and
    `30-day rolling`.
  - Each trend panel should present: main value, intra-window trend cue, and
    delta vs prior comparable window.
  - Implementation was spun off to `#156`.
- **Scope:**
  - redesign the trends panel layout
  - decide how rolling averages should use width and alignment
  - define final panel structure, spacing, and information priority
- **Allowed Files if determinable:**
  - issue body / design brief only
- **Out of scope:**
  - graph-data correctness
  - implementation
- **Verification:**
  - brief resolves the current empty-space complaint
  - implementation issue can be written directly from the design brief
- **Labels:**
  - `mvp4.0`
  - `agent:codex`
  - `area:weight`
  - `area:docs`
  - `type:planning`
  - `effort:default`
  - `model:gpt-5.4`
  - `reasoning:medium`
- **Suggested runtime:** `agent:codex`, `model:gpt-5.4`, `reasoning:medium`

---

### Phase 4: Strength Analytics Spec Pass
- Phase goal: define the actual exercise-analytics product model before trying
  to ship more strength-card behavior.
- Why this phase comes here: the current complaints show that the metric rules
  are not settled enough for implementation to proceed cleanly.
- Completion condition: Big 3, non-Big-3 weighted lifts, and non-weighted
  exercises all have an explicit metric model and display contract.

Ordered tasks:

#### Task 12: Spec the strength analytics model for tracked exercises

- **Title:** `Phase 4 / Task 12: Spec tracked exercise analytics rules`
- **Goal:** write the product spec for what metrics tracked exercises should
  show and when.
- **Scope:**
  - define the metric set for Big 3 lifts
  - define the metric set for weighted non-Big-3 lifts
  - define whether any metrics should be optional or settings-driven
  - define what `overload` means, or remove / replace it if it is not a useful
    concept
  - define how `estimated 1RM` and `Kilo max` should coexist visually
  - define fallback behavior when a tracked lift lacks enough history to
    support part of the display
- **Allowed Files if determinable:**
  - issue body / design brief only
- **Out of scope:**
  - implementation
  - tracked-exercise section organization or large-list layout planning already
    covered by `#147`
  - chart polishing unrelated to metric rules
- **Verification:**
  - spec explicitly covers Big 3 and weighted non-Big-3 rules
  - spec resolves the current meaningless `initial` overload state
  - spec states the fallback behavior for missing or immature lift history
  - follow-up implementation can be split into normal scoped issues
- **Labels:**
  - `mvp4.0`
  - `agent:codex`
  - `area:workouts`
  - `area:docs`
  - `type:planning`
  - `effort:default`
  - `model:gpt-5.4`
  - `reasoning:medium`
- **Suggested runtime:** `agent:codex`, `model:gpt-5.4`, `reasoning:medium`

#### Task 13: Spec fallback analytics for non-weighted tracked exercises

- **Title:** `Phase 4 / Task 13: Spec non-weighted exercise analytics`
- **Goal:** define the analytics contract for tracked exercises that do not use
  weight.
- **Scope:**
  - decide reps/volume-style metrics for movements such as in-and-outs
  - define how these exercises surface alongside weighted exercise cards
  - define whether non-weighted rules stay uniform or differ by movement class
  - define fallback behavior when a tracked exercise lacks enough history to
    support part of the display
  - keep the output implementation-ready, not exploratory
- **Allowed Files if determinable:**
  - issue body / design brief only
- **Out of scope:**
  - implementation
  - changing weight-entry behavior
  - tracked-exercise section organization or large-list layout planning already
    covered by `#147`
- **Verification:**
  - spec names the concrete metric set for non-weighted tracked exercises
  - spec states whether any movement-class exceptions exist
  - card/display expectations are clear enough for a later build issue
- **Labels:**
  - `mvp4.0`
  - `agent:codex`
  - `area:workouts`
  - `area:docs`
  - `type:planning`
  - `effort:default`
  - `model:gpt-5.4`
  - `reasoning:medium`
- **Suggested runtime:** `agent:codex`, `model:gpt-5.4`, `reasoning:medium`

---

### Phase 5: Final MVP4 Polish
- Phase goal: resolve remaining small but visible UI inconsistencies after the
  larger bug and design work is defined or shipped.
- Why this phase comes here: these are worthwhile, but not blockers for core
  product use.
- Completion condition: residual nav and one-off UI inconsistencies are cleaned
  up.

Ordered tasks:

#### Task 14: Match the Help back arrow to the rest of the app

- **Title:** `MVP4: align Help back arrow styling`
- **Goal:** make the Help back arrow visually match the app’s normal back-arrow
  treatment.
- **Scope:**
  - visual consistency only
- **Allowed Files if determinable:**
  - the More / Help screen component and any local shared back-arrow styling it
    already uses
- **Out of scope:**
  - navigation behavior changes
  - More-tab redesign
- **Verification:**
  - Help back arrow visually matches the app’s other back arrows
- **Labels:**
  - `mvp4.0`
  - `agent:gemini`
  - `area:ui`
  - `type:implementation`
  - `effort:default`
- **Suggested runtime:** `agent:gemini`

#### Task 15: Rework bottom-tab fade behavior around interaction

- **Title:** `MVP4: rework bottom tab bar fade behavior`
- **Status:** shipped in issue `#167`
- **Goal:** make the bottom navigation behave like a content-aware overlay
  instead of a persistent solid block.
- **Scope:**
  - tab bar becomes transparent while scrolling content
  - tab bar becomes solid when directly tapped / interacted with
  - after interaction, return to transparent after a short timeout
- **Allowed Files if determinable:**
  - `mobile/components/TabBar.js`
  - any immediately-related styling or animation helper already used by the tab
    bar
- **Out of scope:**
  - app-wide theme redesign
  - route changes
- **Verification:**
  - tab bar becomes transparent during content scroll
  - direct interaction makes it solid
  - it fades back after a short timeout
  - hit areas and active-state clarity remain intact
- **Labels:**
  - `mvp4.0`
  - `agent:gemini`
  - `area:ui`
  - `type:implementation`
  - `effort:default`
- **Suggested runtime:** `agent:gemini`

### Phase 6: Off-Shoots
- Phase goal: track cards spun off mid-MVP4 that were not part of the original
  planning sweep but still belong to the MVP4 effort.
- Why this phase exists: regressions and review needs surface during execution;
  this phase keeps them roadmap-visible without disturbing the planned
  Phase 1-5 sequence.
- Completion condition: all off-shoot cards are resolved or explicitly deferred.

Off-shoot cards:

- `#146` - `Phase 6 / Task 1: Fix routine editor exit scroll-position
  regression in Log` (Phase 1 core-flow regression; `agent:gemini`,
  `type:bug`)
- `#147` - `Phase 6 / Task 2: Review Tracked Exercises / Progressive
  Overload section organization` (spun off from `#126`; `agent:codex`,
  `type:planning`)
- `#150` - `Phase 6 / Task 3: Implement rendered workout note double-tap
  edit and text selection` (spun off from `#148`; `agent:claude`,
  `type:implementation`)
- `#151` - `Phase 6 / Task 4: Normalize rendered workout rows and improve
  unparsed fallback in Log` (spun off from `#149`; `agent:claude`,
  `type:implementation`; completed 2026-05-24)
- `#154` - `Phase 6 / Task 5: Implement Weight goal panel hierarchy and copy
  rewrite` (spun off from `#152`; `agent:gemini`, `type:implementation`;
  completed 2026-05-24)
- `#155` - `Phase 6 / Task 6: Review Weight goal estimate formula accuracy`
  (spun off from `#152`; `agent:codex`, `type:planning`)
- `#156` - `Phase 6 / Task 7: Implement Weight tab section hierarchy and
  stacked trends layout` (spun off from `#153`; `agent:gemini`,
  `type:implementation`; completed 2026-05-24)
- `#159` - `Phase 6 / Task 8: Implement per-exercise session
  classification` (spun off from `#157`; `agent:claude`,
  `type:implementation`)
- `#160` - `Phase 6 / Task 9: Implement intra-session rep drop-off flag`
  (spun off from `#157`; `agent:claude`, `type:implementation`)
- `#161` - `Phase 6 / Task 10: Implement session skip detection and
  attendance flags` (spun off from `#157`; `agent:claude`,
  `type:implementation`)
- `#162` - `Phase 6 / Task 11: Implement cross-lift asymmetry detection
  (Big 3)` (spun off from `#157`; `agent:claude`,
  `type:implementation`)
- `#163` - `Phase 6 / Task 12: Implement weekly assessment summary
  panel` (spun off from `#157`; `agent:gemini`,
  `type:implementation`; completed 2026-05-25)
- `#164` - `Phase 6 / Task 13: Implement tracked-exercise asterisk
  opt-out` (spun off from `#157`; `agent:claude`,
  `type:implementation`)
- `#165` - `Phase 6 / Task 14: Derive non-weighted tracked-exercise card
  metrics` (spun off from `#158`; `agent:claude`,
  `type:implementation`)
- `#166` - `Phase 6 / Task 15: Render non-weighted tracked-exercise cards`
  (spun off from `#158`; `agent:gemini`,
  `type:implementation`)

---

## Proposed Sequential Issue Mapping

- `#122` - `MVP4: fix workout note save semantics`
- `#123` - `MVP4: make current routine collapsible and title-driven`
- `#124` - `MVP4: fix empty Log state auto-open behavior`
- `#125` - `MVP4: fix Analytics weight trends graph rendering`
- `#126` - `MVP4: repair baseline strength analytics cards`
- `#127` - `Phase 2 / Task 6: Sharpen Home header and remove tile navigation`
- `#128` - `Phase 2 / Task 7: Rebuild Weeks In from routine progression depth`
- `#148` - `Phase 2 / Task 8: Spec rendered workout note interaction model`
- `#149` - `Phase 2 / Task 9: Investigate Log exercise typography and normalization`
- `#152` - `Phase 3 / Task 10: Design Weight goal panel rewrite`
- `#153` - `Phase 3 / Task 11: Design Weight trends panel layout`
- `#157` - `Phase 4 / Task 12: Spec tracked exercise analytics rules`
- `#158` - `Phase 4 / Task 13: Spec non-weighted exercise analytics`
- `TBD` - `Phase 5 / Task 14: align Help back arrow styling`
- `#167` - `Phase 5 / Task 15: rework bottom tab bar fade behavior`

The `#122`-`#128` reserved-number block is now exhausted. Phase 2's
remaining cards were created at the next available numbers (`#148`, `#149`)
because the issue counter had advanced past `#130`. Phase 3's planning cards
were later created as `#152` and `#153`. Phase 4's planning cards were then
created as `#157` and `#158`. Phase 5+ cards take whatever number GitHub
assigns at creation time.

Note for future issue creation:

- follow the same issue-body structure used for `#148`, `#149`, `#152`, and
  `#153` for later MVP4 planning cards
- keep the `mvp4.0` label on every MVP4 card
- record any card spun off during MVP4 under `Phase 6: Off-Shoots` and apply the
  `mvp4.0` label; do not add off-shoots to the sequential mapping above
- prefer `agent:claude` for any `effort:heavy` task, even if it is UI-heavy
- prefer `agent:claude` for UI tasks that depend on non-trivial logic or are
  likely to be too brittle for `agent:gemini`

---

## UX-Design-Only Or Spec-First Items

- `#148` rendered-note interaction and copyability
- `#152` Weight goal panel rewrite
- `#153` Weight trends panel redesign
- `#157` tracked exercise analytics rules
- `#158` non-weighted exercise analytics rules

These should be completed before any implementation issues that depend on them.

---

## Items Intentionally Left Unchanged In MVP4

- same-day duplicate weight-entry behavior
- current analytics handling of duplicate same-day weight entries

The explicit MVP4 instruction is to leave those behaviors as they currently
work.

---

## Remaining Clarification Notes For Issue Writers

- `#128` depends on a precise implementation reading of the workout parser’s
  notion of an exercise progression chain. The product rule is clear, but the
  issue writer should include one or two concrete routine examples in the final
  GitHub issue body.
- the follow-up implementation issue for `#148` should carry forward the
  resolved rule that rendered workout text stays selectable and uses double tap
  in the expanded body as the edit-entry gesture.
- `#130` should explicitly decide whether normalization belongs in parser
  cleanup, renderer cleanup, or both.

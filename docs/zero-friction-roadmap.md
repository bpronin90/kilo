# Kilo Zero-Friction and Active Context Roadmap

**Status: Complete; Phases 1–5 and F17 are complete.** This roadmap consolidates
the independent UX/friction audits in GitHub
issues [#849](https://github.com/bpronin90/kilo/issues/849) and
[#850](https://github.com/bpronin90/kilo/issues/850), the Recovery-state addenda
posted to those threads, and the owner decisions made while reconciling them.

This is not another broad redesign pass. Kilo already has a coherent product thesis: text-first workout logging, low ceremony, local-first behavior, and a small set of durable surfaces. The purpose of this roadmap is narrower:

> **Remove correctness hazards and repeated friction, then make the product follow the user's actual active training context instead of exposing implementation state.**

The selected product direction is **Zero Friction + Active Context**:

- preserve text as the canonical workout authoring model
- preserve the intentional cumulative long-note logging model while making direct navigation inside it fast
- surface parser/alignment problems where the user can fix them
- protect autosaved work from destructive or misleading controls
- treat Recovery as a temporary change in **current training**, not as an accessory feature
- keep the baseline routine intact and paused during Recovery
- keep baseline progression analytics separate from Recovery work by default
- let Home and Analytics adapt their hierarchy to what is actually live
- keep bodyweight fully live during Recovery
- keep fatigue attached to normal training; do not convert Recovery edits into fatigue sessions
- give a Recovery block its own optional reason instead of linking it to fatigue history
- do not add timers, calendar-driven logging, AI, or a form-based workout builder

---

## Source of Truth

Primary evidence:

- GitHub issue `#849` — GPT-5.6 Sol forensic UX/friction audit and Recovery-state addendum
- GitHub issue `#850` — Claude Opus independent UX/friction audit and Recovery-state addendum
- current repository behavior and tests are authoritative where an audit claim conflicts with implementation

Owner-resolved decisions captured by this roadmap supersede contradictory audit recommendations.

### Owner-resolved Recovery decisions

1. **Recovery-first on Log is intentional and correct.**
2. While a Recovery block has an open week:
   - the open Recovery-week note is the **active training context**
   - the stored current/baseline routine remains the **return target**
3. Recovery must not simply default back to the baseline Routine.
4. Baseline strength/progression analytics remain separate and normally excluded from Recovery loads.
5. Frozen baseline metrics must not continue occupying the product as though they were live.
6. During Recovery, Home and Analytics should **change hierarchy**, not merely add `Paused` labels to every stale component.
7. Weight remains live and should gain relative prominence while baseline training is paused.
8. Fatigue/check-ins remain part of normal training.
9. **Opus R-4 is rejected:** do not run normal fatigue/check-in detection from Recovery-note saves.
10. A Recovery block should have an optional standalone **reason for recovery**.
11. The Recovery reason is not linked to, inferred from, or owned by fatigue history.
12. No separate Recovery dashboard, new Recovery tab, duplicated Analytics suite, or `currentId` semantic rewrite is required.

### Owner-resolved non-Recovery decisions

1. **The cumulative long workout note is intentional product design.** Kilo does not have, and must not invent, a `Start next session` workflow.
2. Direct logging acceleration means **double-tap a rendered exercise → open the canonical raw note positioned at that exact exercise**. The implementation may solve anchoring/caret mechanics, but it may not replace the long-list model.
3. Progressive Overload tracking remains **explicit and manual**. `Track` / `Tracked` stays as the compact control label.
4. Logging an exercise and choosing to track its PO are deliberately separate decisions.
5. Do not add automatic exercise tracking, AI inference, or a separate PO-management workflow.
6. PO lifecycle follows the **Opus hybrid**:
   - Est. Max, Kilo Max, and Best Set continue to use all eligible historical data.
   - Trend, Progressing/Steady/Regressing classification, and Home PO classification are scoped to entries since the most recent Track activation.
   - Untracked maintenance/rehab work must not drive the next tracked-period trend.
   - Retracking restores historical capability metrics immediately while progression restarts from `First session` until enough newly tracked entries exist.
   - Use the minimum invisible tracking watermark rather than a full historical campaign subsystem.
7. Stable exercise identity/rename semantics are a prerequisite for the tracking watermark.
8. Fatigue and Deload default **OFF for new users**. Existing users keep their stored preferences.
9. Fatigue and Deload discovery lives in **Settings + App Guide**. No proactive nags, onboarding popups, or workout interruptions are authorized.
10. Normal-state Home keeps its current hierarchy except targeted correctness, tracking-coherence, navigation, and accessibility fixes. The structural Home hierarchy change in this roadmap is Recovery-specific.
11. The tab bar is **out of scope and remains exactly as-is**. Do not reopen its opacity, motion, styling, settle behavior, or interaction design under this roadmap.
12. `docs/ui-design-rules.md` and `docs/design-system-map.md` remain authoritative for UI work.
13. This roadmap may normalize inconsistent implementation to the adopted design system, but it may not opportunistically redesign the system itself.
14. Buttons, text hierarchy, density, visual personality, and other aesthetic changes that are consistent-but-unsatisfying belong in a separate **UI Style Audit**. Any such redesign requires owner review before implementation.

---

## Roadmap Rules

- Each implementation task becomes one GitHub issue and one authoritative implementation PR.
- Do not create every issue up front merely to mirror this document. Triage work when dependencies and owner decisions are satisfied.
- Every implementation issue must restate:
  - `Goal`
  - `Allowed Files`
  - `Out of Scope`
  - `Acceptance`
  - `Verification`
- Expected files below are starting points, not authorization to expand scope opportunistically.
- Follow the repository's current agent, review, exact-SHA, CI, changes-fragment, and issue-label governance. This roadmap does not weaken existing gates.
- Product behavior changes add the required `.changes/<issue>-1.md` fragment.
- Validate affected UI at 320dp, 375dp, and 448dp, with large text and both themes where applicable.
- Accessibility requirements are acceptance criteria, not a later polish pass.
- **Every UI change is governed by `docs/ui-design-rules.md` and `docs/design-system-map.md`.** Those adopted documents are the visual/composition source of truth unless an issue explicitly carries an owner-approved design-system amendment.
- Reuse the established shared primitives and roles before inventing local styling: `ScreenShell`, `Card`, `SectionTitle`, shared `Button`, semantic palette tokens, established panel/header/disclosure patterns, and the documented 16px vertical rhythm.
- Do not introduce local spacing scales, raw colors, one-off type sizes, alternate card radii, custom chevron/disclosure conventions, or visually equivalent duplicate components merely to complete a roadmap task.
- If an intentional UI change creates a genuinely new reusable pattern, update both the rule document and design-system map in the same delivery so the app cannot drift again.
- Consistency repair is authorized; aesthetic redesign is not. If a compliant existing button/text/component treatment still appears weak, flag it for the separate UI Style Audit rather than redesigning it inside this roadmap.
- Preserve capability continuity: do not remove a surface or control until its replacement path is live in the same PR or a shipped dependency.
- Keep Recovery, fatigue, deload, skip-week, and ordinary training semantics distinct.
- Do not mix Recovery loads into baseline progression calculations merely to make charts move.
- Do not reinterpret the stored current routine as the Recovery note. Use a derived active-context concept.
- Do not automatically link Recovery to a prior fatigue entry.
- Do not implement Opus R-4.
- Do not create a second form-driven workout logger alongside canonical text.
- Do not create a `Start next session` action, session scaffold, placeholder insertion pass, or whole-note transformation. The cumulative note is intentional.
- Exercise-to-source acceleration must navigate within the existing canonical note rather than generating a session representation.
- Do not add timers, calendar workflow, or AI.
- Do not treat an audit's aggregate phrase such as "tracked lifts" as proof of explicit user tracking. Verify the exact persisted `tracked_exercises` / tracking semantics before changing that system.
- Parallel implementation is allowed only where contracts and files do not overlap. Re-read merged dependencies before starting dependent work.

---

# Visual Coherence Contract

This roadmap changes interaction and information hierarchy, but it does **not** authorize each feature area to invent its own visual treatment.

The adopted Kilo UI system remains authoritative:

- `docs/ui-design-rules.md` owns durable composition and interaction-presentation rules.
- `docs/design-system-map.md` maps the current tokens, shared components, palette roles, and implemented treatments.
- active code is authoritative for exact token/component behavior where documentation lags.

## Required visual invariants

Unless an owner-approved design-system amendment says otherwise:

- every top-level tab stays inside `ScreenShell`
- top-level horizontal padding stays 16px
- top-level vertical rhythm stays on the documented 16px system
- screen titles, `SectionTitle`s, micro-labels, cards, panels, buttons, badges, chips, and disclosure controls use their established shared roles
- ordinary cards use the shared radius/padding/border treatment; no nested-card decoration merely to create hierarchy
- long repeating data uses the established panel/header-row pattern rather than bespoke card stacks
- collapse/expand uses the established `MaterialIcons` conventions and preserves a meaningful collapsed summary
- analytics keeps one hero metric per card and a clear section hierarchy
- all colors come from semantic theme tokens; hardcoded visual colors are prohibited except the documented wordmark exception
- Light, Dark, and System appearance behavior must remain coherent without reload
- any new filled surface/text pairing must meet the repository's recorded contrast requirements
- card headers carry identity; actions belong in the body/action strip under the adopted UI rules
- visual hierarchy changes required by Recovery should be expressed by **reordering, disclosure, labels, and existing component roles**, not by inventing a visually separate "Recovery design language"
- the tab bar is not part of the coherence normalization; preserve it exactly
- a surface that follows the current design system but still looks aesthetically weak is not automatically a defect under this roadmap; record it for the future UI Style Audit

## Coherence review requirement

Every UI implementation PR under this roadmap must include a review pass against both design-system documents, not only its local screenshot.

The roadmap closes with a whole-app coherence verification (`F17`) so individually correct PRs cannot accumulate new cross-tab drift.

---

# Target Experience

## Home

Home answers:

> **What am I doing now, what should I log, and what is still changing?**

### Normal training

- current training/routine state remains primary
- Log workout and Log weight remain immediate actions
- weight and training summaries show current data
- normal progress handoffs remain available

### Active Recovery

Home reorients around the live state:

1. **Recovery · Week N** and the active Recovery note
2. **Log workout** → active Recovery note
3. current bodyweight / live weight trend
4. concise current Recovery status
5. one compact **Baseline training paused during Recovery** handoff

Home does **not** continue giving primary real estate to frozen 1K, exercise-progress, routine-health, or other baseline metrics individually.

The user can still reach baseline detail; it is simply no longer presented as the current story.

---

## Log

Log answers:

> **What am I training right now?**

### Normal training

- baseline/current routine is the active training context
- logging remains text-first
- the user should be able to reach the exact exercise/session location with minimal navigation

### Active Recovery

- Recovery remains the first/default context
- the open Recovery-week note is presented as **Current training**
- the baseline routine remains accessible and is explicitly **paused**
- Recovery administration remains secondary/collapsed
- Deload is not presented as a peer current-training action while baseline training is paused
- `Log workout` resolves to the open Recovery-week note
- between Recovery weeks, no baseline workout is implied; the primary next action is Add next week or End Recovery

Recovery is not a management screen with a workout buried inside it. The active Recovery workout is the primary object; block controls are administration.

---

## Weight

Weight remains the dedicated bodyweight surface.

- entry, goal, trends, and history remain valid during both normal training and Recovery
- Recovery does not create a parallel weight model
- because weight remains live while many baseline workout metrics pause, its summaries gain relative prominence on Home and Analytics during Recovery
- simplification of the high-frequency weigh-in loop is allowed later in this roadmap, but it is not coupled to Recovery semantics

---

## Analytics

Analytics answers:

> **What is changing over time right now, and what is intentionally paused?**

### Normal training

Normal hierarchy remains available.

### Active Recovery

Lead with live information:

1. concise Recovery-state context
2. existing Recovery analytics
3. Weight trends / current bodyweight information
4. one collapsible **Baseline training · paused during Recovery** group containing:
   - Routine Health / baseline session count
   - fatigue history
   - Strength / 1K
   - Progressive Overload
   - tracked exercise progress
   - exercise trends
   - other baseline-only progression detail

Frozen baseline metrics are not recomputed from Recovery work. They are preserved as historical/return-to-training context.

Fatigue remains attached to ordinary training and is shown as paused history, not re-triggered from Recovery saves.

---

## More

More remains account, data, settings, backup, help, and product administration.

Recovery should not add dashboard-style content here.

---

# Product-State Contract

The roadmap introduces one derived UX concept:

```text
activeTrainingContext
```

It does not replace storage truth.

## Normal

```text
activeTrainingContext.kind = baseline
activeTrainingContext.activeNote = current routine
activeTrainingContext.baselineNote = current routine
baselinePaused = false
```

## Recovery with an open week

```text
activeTrainingContext.kind = recovery
activeTrainingContext.activeNote = latest open Recovery-week note
activeTrainingContext.baselineNote = Recovery block baseline_note_id
baselinePaused = true
```

## Recovery between weeks

```text
activeTrainingContext.kind = recovery-transition
activeTrainingContext.activeNote = none
activeTrainingContext.baselineNote = Recovery block baseline_note_id
baselinePaused = true
primaryNextAction = Add next week | End Recovery
```

## Recovery ends

```text
activeTrainingContext.kind = baseline
activeTrainingContext.activeNote = stored current/baseline routine
baselinePaused = false
```

Normal analytics resume from the preserved pre-Recovery history.

---

# Dependency Map

```text
Phase 1: correctness / safety
F0 ───────────────┐
F1                │
F2a ──> F2b ──> F3├──> F4
                  │
                  └──────────────┐

Phase 2: active context [DONE]   │
F5 ──> F7 ──────────────────────┤
 │    ├──> F8                    ├──> Phase 3+
 │    └──> F9                    │
 └──> F6 ────────────────────────┘

Phase 3: direct exercise-to-source navigation
F10a ──> owner approval ──> F10b
F11 can begin after F0/F3 contracts are stable

Phase 4: analytics / tracking coherence
F12a ──> owner approval ──> F12b
F13 depends on F12b where identity/tracking semantics overlap

Phase 5: high-frequency and secondary cleanup
F14
F15
F16
```

`F0`, `F1`, `F2a`, and `F5` are product-independent enough to begin without waiting for later design gates, subject to overlapping-file checks.

---

# Phase 1 — Protect Data and Make Errors Local

**Status:** Complete as of 2026-08-23. Delivered through #851 (safe editor rollback), #852 (truthful metric entry), #853–#854 (parser/authored-text contract), #855 (session-alignment safety), #856 (inline validation and jump-to-problem), #863/PR #864 (quiet on-demand problem list and non-blocking exit path), and #865/PR #866 (stable, visibly highlighted problem jumps that warning-list toggles cannot reapply).

**Phase goal:** eliminate correctness hazards and destructive editor behavior before optimizing interaction speed.

**Completion condition:** Kilo does not silently reinterpret units, silently corrupt positional sessions, silently discard authored content, or present destructive whole-edit rollback as ordinary Undo/Cancel.

---

## F0 — Make edit rollback safe and truthful

- **Suggested title:** `Zero Friction / F0: make editor rollback explicit and non-destructive by surprise`
- **Goal:** prevent autosaved workout work from being lost through controls whose labels imply harmless navigation or local undo.
- **Depends on:** none.
- **Expected files:**
  - current-routine editor hook
  - other/recovery routine editor hook
  - Log editor/header components
  - focused editor tests
- **Scope:**
  - remove ambiguity around current `Undo`
  - fix Recovery editor `Cancel` behavior that restores the editor-entry snapshot after autosave
  - use explicit language such as `Revert this edit` only when a persisted rollback is actually intended
  - require confirmation before destructive whole-edit rollback
  - provide a safe non-destructive close/Done path
- **Out of scope:** redesigning the entire editor, changing canonical note storage, or adding per-set form state.
- **Acceptance:**
  - no control labeled `Cancel`, `Back`, or equivalent destroys autosaved edits without explicit destructive confirmation
  - rollback semantics are identical in meaning across baseline and Recovery editors
  - closing an editor cannot silently rewrite persisted data to an older snapshot
- **Verification:** autosave-before-close, autosave-before-revert, rapid save/revert, baseline editor, Recovery editor, Android Back, supported widths/large text.

---

## F1 — Make metric workout entry truthful

- **Suggested title:** `Zero Friction / F1: make workout-note entry honor the selected unit`
- **Goal:** ensure the configured lift-entry unit governs note interpretation.
- **Depends on:** none.
- **Expected files:**
  - parser/unit boundary
  - unit preference helpers
  - settings/help copy
  - parser/data tests
- **Scope:**
  - selected kg entry must not be parsed as lb and converted afterward
  - preserve canonical internal representation intentionally
  - define compatibility behavior for existing notes
  - make examples/help unit-aware
- **Out of scope:** changing bodyweight storage semantics or migrating existing imperial accounts without evidence.
- **Acceptance:** a metric user entering a load receives the same load back in metric display and correct derived values.
- **Verification:** lb and kg parser cases, existing-note compatibility cases, settings changes, round trips.

---

## F2a — Define the parser contract from real authored behavior

- **Suggested title:** `Zero Friction / F2a: define accepted workout-note grammar from real usage`
- **Goal:** convert the audit's real-data parser failures into an explicit owner-approved grammar contract before broadening parsing.
- **Depends on:** none.
- **Type:** investigation/contract; no production implementation.
- **Evidence to resolve:**
  - single positive integer as one reps-only set
  - bodyweight skipped-set forms such as `3,3,-`
  - trailing commas
  - duration/cardio-style values
  - ranges
  - freeform instructions/prose
  - lines that currently survive in raw text but disappear from formatted read view
- **Required decision:** for each observed pattern classify:
  - structured workout data
  - preserved visible annotation
  - invalid but visibly retained with useful feedback
- **Out of scope:** turning Kilo into a universal freeform parser or guessing hidden structure from arbitrary prose.
- **Acceptance:** no implementation ambiguity remains for the real patterns identified in #849/#850.

---

## F2b — Implement the approved parser and authored-text contract

- **Suggested title:** `Zero Friction / F2b: accept approved workout syntax and never silently hide authored text`
- **Goal:** make common real input parse correctly while preserving unsupported authored text visibly.
- **Depends on:** F2a owner approval.
- **Expected files:**
  - `mobile/lib/parser/`
  - `WorkoutContentRenderer`
  - parser/data/render tests
- **Scope:** exactly the F2a decision table.
- **Out of scope:** unapproved syntax expansion.
- **Acceptance:**
  - approved real-world rows parse as specified
  - unsupported lines never vanish silently from formatted output
  - errors explain the actual problem rather than suggesting unrelated fixes
- **Verification:** regression fixtures using redacted representative patterns from both audits.

---

## F3 — Make positional session alignment safe

- **Suggested title:** `Zero Friction / F3: surface and prevent session-column misalignment`
- **Goal:** prevent uneven exercise entry counts from silently producing synthetic skips or misattributed sessions.
- **Depends on:** F2b.
- **Expected files:**
  - session derivation/alignment helpers
  - current editor save path
  - Log validation UI
  - focused tests
- **Scope:**
  - detect uneven session counts in the active edit flow
  - identify only exercises and session positions that are actually missing authored entries
  - surface correction or intentional-skip guidance inline without blocking Done, swipe-back, or any editor exit
  - ensure alignment problems are reachable from the real Log edit path through the shared on-demand problem list
- **Out of scope:** replacing positional session storage with a new dated session database in this roadmap.
- **Acceptance:** Kilo does not silently pad or reinterpret an uneven active session; the editor offers a quiet, ignorable warning for each missing session position and jumps to the correct insertion point without placing a dialog on the exit path.
- **Verification:** missing row, duplicate row, intentional skip, A/B routine, Recovery note where applicable.

---

## F4 — Put parse/alignment feedback inside the editor

- **Status:** Complete through #856, the #863 refinement (merged in PR #864 on 2026-08-23), and the #865 selection-stability follow-up (merged in PR #866 on 2026-08-23).
- **Suggested title:** `Zero Friction / F4: add local validation and jump-to-error in text editing`
- **Goal:** eliminate Done → scan → Edit → relocate as the correction loop.
- **Depends on:** F2b, F3.
- **Expected files:**
  - Log editor components/hooks
  - parser/session validation adapter
  - focused editor tests
- **Scope:**
  - debounced validation that never delays or rewrites the live `TextInput`
  - a quiet outlined `!` and total problem count, with error/warning color determined by severity
  - an inline, height-limited problem list that opens only on demand and uses human section/exercise labels rather than visible source line numbers
  - one problem row per syntax diagnostic or actually missing session position; aligned exercises are omitted
  - deterministic one-shot navigation: malformed syntax visibly selects its complete authored row, while a missing session places the caret after that exercise's existing entries; releasing selection control after the jump ensures warning-list toggles cannot restore a stale caret, selection, or internal scroll position
  - one dismissible selected-problem bar below the input, resolved against live validation so it clears when fixed and follows the same logical row when surrounding lines move
  - clear list/selection state on editor exit, note switch, and A/B week switch
  - no alignment alert or acknowledgement plumbing on Done
  - preserve raw text and user control
- **Out of scope:** full split-pane preview, automatic rewriting, or form conversion.
- **Acceptance:** syntax and alignment problems remain invisible until requested, are described in human terms, and can be reached precisely without leaving edit mode or obstructing exit.
- **Verification:** multiple errors and mixed severities, repeated identical diagnostics, shifted lines, missing-session insertion points, large notes, manual scrolling followed by repeated warning-list toggles, current and other-routine editors, A/B switching, keyboard-open row taps, and performance under repeated typing.

---

# Phase 2 — Make Recovery a Product-Wide Active Context

**Status:** Complete as of 2026-08-23. Delivered through #868 (shared active
training context), #869 (Recovery-aware Home), #870 (Recovery-first Log), #871
(live-versus-paused Analytics), and #872/PR #877 (optional Recovery reason).

**Phase goal:** Kilo should remain an actively useful application while normal training is intentionally paused.

**Completion condition:** Home, Log, and Analytics agree on what the user is currently training; Weight stays live; baseline progress is preserved but no longer dominates; fatigue remains normal-training history.

---

## F5 — Derive one active-training-context contract

- **Status:** Complete through #868.
- **Suggested title:** `Zero Friction / F5: derive product-wide active training context`
- **Goal:** give Home, Log, and Analytics one presentation-level answer to "what am I training now?"
- **Depends on:** none.
- **Expected files:**
  - recovery state/hooks
  - smallest shared derivation helper
  - Home/Log/Analytics consumers
  - focused state tests
- **Scope:**
  - normal
  - Recovery with open week
  - Recovery between weeks
  - transition back to normal
  - expose active note, baseline note, Recovery week number, and `baselinePaused`
- **Out of scope:**
  - changing `currentId`
  - changing Recovery membership
  - changing analytics inclusion
  - duplicating recovery state storage
- **Acceptance:** all consuming screens derive the same active context from the authoritative Recovery state.
- **Verification:** cold load, active week, completed week/no next week, add week, end Recovery, stale/error/pending Recovery states.

---

## F6 — Add an optional block-level Recovery reason

- **Status:** Complete through #872/PR #877.
- **Suggested title:** `Zero Friction / F6: record why a Recovery block started`
- **Goal:** let the user preserve the context for starting Recovery without coupling it to fatigue history or workout-note text.
- **Depends on:** F5 contract stable enough to avoid duplicate Recovery state work.
- **Expected files:**
  - Recovery block schema/migration
  - local/cloud Recovery storage and sync
  - backup/import/export where Recovery blocks are represented
  - start/manage/history Recovery UI
  - focused Recovery tests
- **Contract:**
  - optional free-text `reason`
  - stored on the Recovery block
  - editable through Recovery administration
  - visible as concise Recovery context where useful
  - preserved in completed Recovery history
- **Explicitly rejected:**
  - linking to a fatigue check-in
  - requiring a fatigue record
  - inferring the reason automatically
  - making the Recovery workout note own the reason
- **Acceptance:** a block can exist with or without a reason; changing the reason changes no workout/fatigue/analytics semantics.
- **Verification:** create/edit/sync/backup/restore/completed history/empty reason.

---

## F7 — Adapt Home to the active context

- **Status:** Complete through #869.
- **Suggested title:** `Zero Friction / F7: make Home follow current training`
- **Goal:** make Home useful during Recovery instead of mostly displaying frozen baseline progress.
- **Depends on:** F5.
- **Expected files:**
  - `HomeScreen`
  - home dashboard derivations/components
  - navigation tests
- **Active-Recovery scope:**
  - hero identifies Recovery and current week/note
  - `Log workout` targets the active Recovery note
  - live weight remains prominent
  - current Recovery status remains concise
  - collapse separate frozen baseline cards into one compact `Baseline training paused during Recovery` handoff
- **Out of scope:** broad normal-state Home redesign unless separately owner-approved.
- **Acceptance:** a user in week N of Recovery can tell from Home what is current, what to log, what is changing, and what is paused without scanning frozen baseline cards.
- **Verification:** normal vs Recovery snapshots, between-weeks state, repeated handoffs, responsive/a11y matrix.

---

## F8 — Make the active Recovery workout dominant on Log

- **Status:** Complete through #870.
- **Suggested title:** `Zero Friction / F8: make Recovery Log hierarchy match current training`
- **Goal:** keep Recovery-first behavior while making the open Recovery note—not block administration—the primary object.
- **Depends on:** F5.
- **Expected files:**
  - `LogScreen`
  - `LogRecoverySection`
  - active/baseline routine components
  - navigation/editor handoff tests
- **Scope:**
  - Recovery remains first/default during an active block
  - open week is labeled/presented as `Current training`
  - active note is expanded/focused when reached through `Log workout`
  - baseline Routine is labeled `Baseline routine · paused`
  - manage-block controls remain subordinate
  - Deload is demoted/suppressed as a peer live-training mode while baseline is paused
  - between weeks, do not send the user into the baseline workout
- **Out of scope:** changing Recovery calculations, membership, inclusion, or currentId.
- **Acceptance:** the active Recovery workout is easier to reach and edit than Recovery administration or the paused baseline.
- **Verification:** direct Log tab, Home handoff, edit/save/close, add-week transition, end Recovery, baseline read access.

---

## F9 — Reorder Analytics around live vs paused information

- **Status:** Complete through #871.
- **Suggested title:** `Zero Friction / F9: adapt Analytics hierarchy during Recovery`
- **Goal:** solve the "most of the app is outwardly pointless" state without contaminating baseline metrics.
- **Depends on:** F5.
- **Expected files:**
  - `AnalyticsScreen`
  - Overview
  - Recovery section
  - Fatigue/Routine Health
  - Strength/1K
  - Progressive Overload
  - focused analytics tests
- **Scope during active Recovery:**
  - lead with Recovery context and existing Recovery analytics
  - promote Weight trends
  - Overview shows Recovery state/current weight rather than frozen baseline counts as freshness
  - group baseline-only analytics under one collapsible `Baseline training · paused during Recovery`
  - suppress active deload/routine-health advice that assumes baseline training is currently accumulating
  - retain fatigue history only as paused normal-training history
- **Explicitly rejected:** Opus R-4; Recovery saves do not trigger normal fatigue check-ins.
- **Out of scope:** new Recovery-specific copies of 1K/overload/fatigue, new formulas, automatic Recovery-load inclusion.
- **Acceptance:** the majority of visible Analytics during Recovery answers something current; baseline data remains reachable without dominating.
- **Verification:** normal vs active Recovery, weight continues updating, baseline data unchanged, Recovery include/exclude preference unchanged, end Recovery restores normal hierarchy.

---

# Phase 3 — Make the Cumulative Note Fast to Navigate

**Status:** Complete as of 2026-08-26. Delivered through #881/PR #883
(exercise-to-source navigation), #880/PR #882 (durable drafts and legible save
state), and the #886/PR #887 and #888/PR #891 source-jump refinements. #889
verified the long-note measurement ceiling.

**Phase goal:** preserve Kilo's intentional cumulative long-note model while removing the mechanical cost of hunting for the exact exercise to edit.

**Completion condition:** a mature 200+ line note remains the canonical workout surface, but the user can jump from a rendered exercise directly into its exact raw-text location.

---

## F10a — Specify direct exercise-to-source anchoring

- **Status:** Complete through #881/PR #883.
- **Suggested title:** `Zero Friction / F10a: specify direct exercise-to-source navigation`
- **Type:** bounded implementation contract; the product direction is already decided.
- **Depends on:** F0/F3 contracts stable enough that edit and alignment semantics are known.
- **Owner-approved interaction:**
  1. user views the formatted workout
  2. user **double-taps the exercise**
  3. Kilo opens the canonical raw-text editor for that same note
  4. the editor lands at that exact exercise occurrence
  5. the prior exercise lines remain visible enough to provide context
  6. caret/focus behavior is deterministic and device-verified
- **Required edge cases to specify:**
  - repeated exercise names in one note
  - Week A / Week B
  - same normalized movement under different headings
  - active Recovery note
  - invalid/unparsed rows inside the exercise block
  - exercise at start/end of the current edit slice
  - note changed between render and edit intent
- **Explicitly out of scope:**
  - `Start next session`
  - placeholder insertion
  - aligned session scaffolding
  - whole-note rewriting
  - conventional set/rep form logging
- **Acceptance:** the contract identifies one stable raw-source target for the rendered exercise without changing the user's authored workout structure.

---

## F10b — Implement double-tap exercise → exact raw-note location

- **Status:** Complete through #881/PR #883, with landing refinements in
  #886/PR #887 and #888/PR #891 and long-note verification in #889.
- **Suggested title:** `Zero Friction / F10b: jump from rendered exercise to its raw source`
- **Depends on:** F10a.
- **Goal:** make the long-list design practical at mature note sizes without replacing it.
- **Scope:** exactly the approved F10a anchoring contract.
- **Acceptance:**
  - double-tapping a rendered exercise opens the correct canonical note
  - the raw editor lands at the intended exercise occurrence
  - no note content is inserted, reordered, normalized, or rewritten to make the jump work
  - baseline and active Recovery notes behave consistently
  - single-tap/selectable-text behavior is not broken accidentally
- **Verification:** current large routine, repeated names, A/B, Recovery, invalid rows, iOS/Android keyboard/caret behavior, large text.

---

## F11 — Make drafts and save state trustworthy

- **Status:** Complete through #880/PR #882.
- **Suggested title:** `Zero Friction / F11: make text edits durable and save state legible`
- **Goal:** survive interruption and reduce uncertainty/churn from silent autosave.
- **Depends on:** F0 and stable editor semantics.
- **Scope candidates:**
  - visible `Saving… / Saved / Offline` state
  - flush/persist on background where safe
  - durable draft strategy for new notes
  - separate cheap draft persistence from expensive derivation/cloud work if profiling confirms the audit concern
- **Requirement:** performance work must be measured; do not redesign the save pipeline solely from static suspicion.
- **Acceptance:** ordinary interruption does not silently lose a whole new routine or recent edits, and the user can tell whether work is durable.
- **Verification:** background/foreground, process-kill where testable, offline, rapid typing, sync failure, new vs existing note.

---

# Phase 4 — Make Progressive Overload Semantics Coherent

**Status:** Complete as of 2026-08-26. Delivered through #892 (approved stable
exercise-identity contract), #893/PR #895 (tracked-span watermark semantics),
and #894/PR #896 (PO dependency and state explainability).

**Phase goal:** preserve explicit `Track` / `Tracked` intent while making PO behavior understandable and correct across track → untrack → retrack, routine changes, and exercise renames.

**Completion condition:** Kilo never guesses which exercises the user intends to pursue PO on, historical capability remains available, and current progression status never bridges an untracked maintenance/rehab gap.

---

## F12a — Verify and contract stable exercise identity for PO tracking

- **Status:** Complete through #892.
- **Suggested title:** `Zero Friction / F12a: make tracked-exercise identity safe across routine changes`
- **Type:** investigation + bounded data contract.
- **Goal:** establish an identity key stable enough to support the tracking watermark.
- **Depends on:** none, but implementation must precede F12b if current identity is unsafe.
- **Evidence to resolve:**
  - normalization differences already observed across names/classifications
  - renamed exercises
  - same movement appearing under different headings
  - exercise removed from the current routine and later reintroduced
  - aliases and duplicate identities
- **Owner decision already made:** tracking remains explicit/manual; this task does not reconsider automatic tracking.
- **Acceptance:** a Track activation cannot silently attach its watermark to the wrong movement after an ordinary routine rename/edit.

---

## F12b — Implement the approved PO tracking watermark semantics

- **Status:** Complete through #893/PR #895.
- **Suggested title:** `Zero Friction / F12b: scope PO trend to the current tracked span`
- **Depends on:** F12a.
- **Owner-approved semantics:**
  - `Track` / `Tracked` labels stay unchanged
  - tracking is manual and explicit
  - Est. Max, Kilo Max, and Best Set remain based on all eligible historical data
  - Trend, Progressing/Steady/Regressing classification, and Home PO classification only use entries since the latest false→true Track activation
  - untracking removes the exercise from PO as today
  - retracking restores historical capability metrics immediately
  - retracking progression begins fresh (`First session` until sufficient newly tracked entries exist)
  - untracked maintenance/rehab entries do not drive the new tracked-period trend
- **Data-shape direction:** use the minimum invisible per-exercise `since`/watermark representation compatible with existing storage/sync; do not create a full historical campaign/event subsystem unless implementation evidence proves the minimal shape unsafe.
- **Migration:** existing boolean-only tracked state remains valid/legacy behavior until the next user toggle; do not invent retrospective tracking periods.
- **Out of scope:**
  - automatic tracking
  - AI inference
  - separate PO management screen
  - renaming `Track` / `Tracked`
  - retrospective reconstruction of old tracked periods
- **Acceptance:** retracking cannot compare the first new intentional PO entry against an untracked maintenance/rehab entry as though both belonged to one active PO trend.
- **Verification:** first Track, untrack, retrack, rename, removal/reintroduction, recovery exclusion, deload exclusion, backup/restore, offline/cloud sync.

---

## F13 — Make PO dependency and state legible

- **Status:** Complete through #894/PR #896.
- **Suggested title:** `Zero Friction / F13: make explicit PO tracking understandable`
- **Goal:** ensure users understand that PO applies only to exercises they deliberately mark `Track`, without adding new selection UI.
- **Scope:**
  - preserve the existing inline `Track` / `Tracked` control beside exercises
  - Progressive Overload empty/insufficient states explain the dependency accurately
  - App Guide uses the exact shipped label and explains that logging alone does not enroll an exercise in PO tracking
  - Home/Analytics use the same tracked population and classification semantics
- **Out of scope:** automatic suggestions, a choose-exercises manager, onboarding nags, or expanding the inline label to multi-word copy.
- **Acceptance:** a user can understand why an exercise does or does not appear in PO without discovering a hidden rule after the fact.

---

# Phase 5 — High-Frequency and Secondary Friction Cleanup

These are important but should not preempt correctness, active-context, or core logging work.

**Status: Complete; all Phase 5 work, including the F17 whole-app visual coherence gate, is complete.**

---

## F14 — Simplify the daily weigh-in loop

- **Suggested title:** `Zero Friction / F14: remove unused ceremony from weigh-in`
- **Evidence:** the real account logs weight frequently and has not used weigh-in notes.
- **Goal:** optimize the highest-frequency persisted interaction without removing optional capability.
- **Scope candidates:**
  - keep weight value + save as the primary path
  - demote optional note/date controls
  - preserve editing/history behavior
- **Acceptance:** normal same-day weigh-in requires no interaction with optional metadata.

---

## F15 — Bound long history surfaces

- **Suggested title:** `Zero Friction / F15: keep growing history from dominating daily surfaces`
- **Scope candidates:**
  - collapse/window Weight history
  - preserve access to full history
  - verify other ever-growing lists before expanding scope
- **Acceptance:** daily surfaces do not become progressively longer merely because the user has used Kilo longer.

---

## F16 — Close verified navigation/accessibility/presentation gaps

- **Suggested title:** `Zero Friction / F16: close verified secondary UX defects`
- **Candidate carry-forward items from #849/#850:**
  - Cloud Sync exact-target/anchor behavior
  - 44dp minimum targets
  - large-text/header crowding
  - chart accessibility
  - verified contrast failures
  - misleading save failure states
  - state persistence that is proven accidental rather than intentional
- **Rule:** each candidate must be re-verified against current HEAD before inclusion in the issue contract.
- **Tab-bar rule:** the tab bar is explicitly excluded from this roadmap. Do not change or re-audit its opacity, motion, styling, settle behavior, layout ownership, or interaction design.

---

## F17 — Verify whole-app visual coherence against the adopted design system

- **Suggested title:** `Zero Friction / F17: normalize cross-tab visual coherence`
- **Goal:** ensure the roadmap leaves Kilo looking like one product rather than a collection of locally-correct feature implementations.
- **Depends on:** all roadmap UI work intended for the release candidate.
- **Type:** verification-first; implementation only for confirmed deviations.
- **Authoritative references:**
  - `docs/ui-design-rules.md`
  - `docs/design-system-map.md`
- **Audit across Home, Log, Weight, Analytics, More, and modals:**
  - top-of-tab alignment and 16px rhythm
  - screen and section-title hierarchy
  - Card vs panel ownership
  - radius, padding, borders, and dividers
  - button/action hierarchy
  - disclosure/chevron conventions
  - micro-labels and column headers
  - status/badge/chip usage
  - semantic colors and both appearance modes
  - large text, overflow, 44dp targets, and screen-reader labels
  - Recovery state using the **same** design language as normal Kilo
- **Rule:** normalize deviations to the established system. Do not use this task to create a new visual direction. Exclude the tab bar from redesign/re-audit. If a compliant pattern still looks aesthetically weak, record it for the separate UI Style Audit instead of changing it here.
- **Acceptance:**
  - no changed surface introduces an undocumented one-off visual primitive
  - equivalent hierarchy roles look equivalent across tabs
  - intentional exceptions are documented in the design-system sources
  - Light/Dark/System and supported widths pass
- **Verification:** whole-app screenshot matrix plus focused component/render tests and design-system doc diff.

---

# Explicitly Rejected / Not Authorized

The following must not reappear in implementation issues as if they were approved:

- **Make Routine default during active Recovery**
- **Opus R-4:** run normal fatigue detection/check-ins from Recovery-note saves
- link a Recovery block to a fatigue record
- infer Recovery reason from fatigue history
- make fatigue own Recovery reason
- count Recovery loads in baseline progression by default
- duplicate normal Analytics into a Recovery-specific analytics suite
- add a Recovery dashboard solely to fill empty/stale space
- add another top-level tab
- rewrite `currentId` semantics merely to represent active Recovery
- convert text-first logging into a conventional set/rep form workflow
- add timers
- add calendar-driven workout UX
- add AI to the product

---

# Owner Decisions — Final

These decisions are authoritative for this roadmap. Implementation agents must not reopen them unless the repository owner explicitly changes direction.

## D1 — Cumulative note and direct exercise navigation

- The cumulative long note is intentional.
- Kilo does not have a `Start next session` workflow.
- Double-tapping a rendered exercise should open the canonical raw note positioned at that exact exercise.
- Implementation difficulty is not authorization to replace the interaction model.

## D2 — Progressive Overload tracking

- Tracking is explicit/manual.
- `Track` / `Tracked` remains the compact control.
- Logging an exercise does not imply PO tracking.
- No automatic tracking, AI inference, or separate manager.
- Use the Opus hybrid:
  - historical Est. Max / Kilo Max / Best Set remain available from all eligible history
  - current PO Trend / classification / Home PO status are scoped to entries since the latest Track activation
  - untracked work does not contaminate the next tracked-period trend
  - retracking starts progression fresh while preserving known capability metrics
  - use the minimum invisible tracking watermark, not a full campaign-history subsystem
- Stable exercise identity is a prerequisite.

## D3 — Fatigue and Deload defaults/discovery

- Default both OFF for new users.
- Existing users retain their saved preferences.
- Discovery: Settings + App Guide.
- No nags, onboarding popups, or proactive workout prompts solely to advertise them.

## D4 — Normal Home

- Keep the current normal-state Home hierarchy.
- Make only targeted fixes required by correctness, PO coherence, exact navigation, or accessibility.
- Structural Home reprioritization in this roadmap is Recovery-specific.

## D5 — Tab bar

- Keep it exactly as-is.
- It is not a design question in this roadmap.
- Do not reopen it through implementation, review, F16, or F17.

## D6 — Visual system and future aesthetic redesign

- `docs/ui-design-rules.md` and `docs/design-system-map.md` remain authoritative.
- This roadmap normalizes inconsistency to that system.
- It does not authorize opportunistic redesign of compliant components.
- A separate **UI Style Audit** may later evaluate weak button treatments, text hierarchy, labels, density, visual personality, and broader design-system evolution.
- Any style-audit redesign must be explained/shown to the owner before implementation.

# Suggested Execution Order

Phases 1–4 are complete. If only the next work is being triaged:

1. **new-user Fatigue/Deload default/discovery task** — bounded Settings/App Guide change
2. **F14/F15/F16 — high-frequency and secondary cleanup**
3. **F17 — whole-app visual coherence gate**
4. **UI Style Audit — separate future roadmap/audit, not implementation under this one**

Parallel work must respect the dependency map, overlapping-file checks, and the
latest merged contracts from completed phases.

---

# Roadmap Completion Condition

This roadmap is complete when:

- destructive editor actions cannot erase autosaved work by surprise
- workout entry honors the selected unit
- real common workout syntax is either parsed or visibly preserved with accurate feedback
- session misalignment cannot silently corrupt longitudinal interpretation
- errors are discoverable and reachable inside the editor
- a user can begin logging without searching an ever-growing note
- Recovery is the active training context everywhere it should be
- Home and Analytics emphasize live Recovery/Weight information while baseline training is paused
- baseline progression resumes cleanly after Recovery without contamination
- fatigue remains normal-training history and Recovery has its own optional reason
- PO tracking remains explicit, historical capability survives untracking, and current progression never bridges an untracked gap
- high-frequency weight entry remains low-friction as history grows
- Home, Log, Weight, Analytics, More, and modals conform to the adopted visual/composition system with no undocumented one-off styling
- the tab bar remains unchanged
- any desired aesthetic redesign beyond consistency is deferred to the separate UI Style Audit with owner review before implementation
- no rejected complexity has been introduced to solve these problems

The intended end state is simple:

> **Kilo should always make the thing the user is actually doing now feel current, easy to reach, and easy to record—while everything paused or historical stays available without competing for attention.**

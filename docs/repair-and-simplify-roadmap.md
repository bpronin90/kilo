# Kilo Repair and Simplify Roadmap

**Status: Active — Phases 1–2 and 4 complete; Phase 3 final delivery active.**
Phase 1's confirmed regressions shipped through issues #770 and #771 on
2026-08-10. Phase 2's approved routine-context behavior shipped through issue
#775 / PR #777 the same day. In Phase 3, R3a's approved Home contract shipped
through #782 / PR #783, R4b's approved Log hierarchy shipped through #789 / PR
#792, and R5a's Analytics contract is approved. The final delivery task is
triaged as R5b issue #793. Phase 4 completed on 2026-08-10: R6b-1 shipped
through #785 / PR #787, R6b-3 shipped through #786 / PR #788, and the owner
explicitly dropped R6b-2's inline-suggestion design.

Source of truth: the repository owner's cross-tab review supplied on 2026-08-09,
with immutable GitHub records authoritative for triaged tasks and approved
decisions. Issues #770 and #771 record Phase 1 delivery; issues #774 and #775
record Phase 2 discovery and delivery. Approved findings supersede provisional
language here and this document must be updated to match.

This pass is not a new feature roadmap. The recent work added useful navigation,
Recovery, routine-management, and guided-workout capabilities, but several
details either regress earlier visual quality or make the product more complex
than the owner wants. The purpose of this roadmap is to repair the clear defects,
remove accidental complexity, and make the affected features feel native to
Kilo rather than inherited from conventional fitness trackers.

The selected product direction is **Repair and Simplify**:

- preserve the parts of Home, Weight, and More that the owner already accepts
- make every explicit Home handoff land at its named Analytics destination
- restore the visual authority of the Home `1K Progress` summary
- make Recovery answer a small number of understandable questions on each tab
- keep routine management subordinate to the workout being performed
- distinguish a routine's meaningful workout date from its last edit timestamp
- preserve user-controlled disclosure state unless a new explicit request needs it
- redesign guided workouts from first principles through owner interviews before
  approving implementation — completed through R6a, which established that Kilo
  has no guided *workout* at all, only text-entry aids, and that the aids the
  owner rejects should be deleted rather than rebuilt

---

## Roadmap Rules

- Each implementation task becomes one GitHub issue and one authoritative PR.
- Do not create every issue merely to mirror this document. Triage a task only
  when its dependencies and product decisions are satisfied.
- Without Recovery/guided discovery results, implementation is limited to `R0`
  and `R1`, and investigation is limited to the investigation half of `R2`.
  Dependency-free discovery tasks, including `R3a` and `R4a`, may also begin;
  implementation that consumes their outputs remains gated on an owner-approved
  contract.
- Route new work to Claude under the repository owner's standing direction.
- Every issue needs one `agent:claude` label and at least one matching `area:`
  label. Model and reasoning labels are optional unless useful for execution.
- Use higher reasoning for cross-screen navigation, Recovery semantics, date
  provenance, and guided-workout interaction design. Bounded visual repairs may
  use the normal implementation tier.
- Each issue contract must contain `Goal`, `Allowed Files`, `Acceptance`, and
  `Verification`. Expected paths below are starting points, not standing
  authorization to broaden scope.
- Product behavior fixes and user-visible redesigns add the required
  `.changes/<issue>-1.md` fragment. Investigation-only tasks do not.
- Validate affected UI at 320dp, 375dp, and 448dp, with large text and both
  themes. Controls must remain operable and correctly announced by screen readers.
- Do not change the tab bar's opacity, scroll response, settle timing, motion,
  post-interaction behavior, layout ownership, or styling.
- A plain tab press may continue preserving that tab's local state. An explicit
  named handoff must land at the destination promised by its label.
- Recovery, fatigue, deload, and guided-workout concepts remain distinct unless
  an approved discovery contract explicitly changes their relationship.
- No redesign may change Recovery calculations, membership, persistence, sync,
  or analytics-inclusion semantics merely to simplify presentation.
- Do not implement `R4b` or `R5b` from provisional ideas in this document. Each
  requires an owner-approved discovery output first. `R6b-1` and `R6b-3` are
  released by R6a's approved output; `R6b-2` is dropped and needs a new owner
  decision before it may be reconsidered.
- Preserve capability continuity: replacement UI must ship before old access is
  removed, unless the owner explicitly decides the old capability should be cut.

---

## Target Experience

### Home

Home answers: **What is my current state, and where should I go next?**

- The title and weight/workout summary retain their current design.
- `Exercise Progress` opens the Progressive Overload section, not the broader
  Strength section.
- `Full history and insights` opens Analytics at the top regardless of the
  Analytics position most recently visited.
- An active Recovery summary states how much of the baseline has been regained
  and how the remaining exercises are distributed across meaningful states.
- The Recovery handoff always opens the Recovery section in Analytics.
- `1K Progress` regains the typographic scale and polish expected of a primary
  progress summary; adding a handoff must not visually demote the metric.

### Log

Log answers: **What am I doing in the gym right now?**

- The active workout remains dominant.
- Recovery status is concise enough to scan while training and exposes only the
  actions needed for the active week.
- Recovery-linked notes do not appear to jump unpredictably into an unrelated
  routine-management area.
- `Recovery` and `More Routines` use the same heading role and therefore the
  same typography unless an approved hierarchy intentionally distinguishes them.
- A routine's visible date has a documented user meaning and is not silently
  replaced by the most recent edit timestamp.
- Collapsing a routine or Deload disclosure remains respected when switching
  views and returning. Only a new, explicit navigation request may reveal a
  hidden target.
- Creating a routine is available near the routine context without forcing the
  user to hunt at the bottom of the tab.
- Guided behavior, when eventually approved, feels like a light extension of
  Kilo's normal logging model rather than a separate multi-step tracker workflow.

### Weight

Weight remains unchanged unless targeted regression evidence appears during
implementation. This roadmap does not authorize proactive Weight cleanup.

### Analytics

Analytics answers: **What is changing over time?**

- Every named cross-screen handoff can target the top or an exact section.
- Recovery presents the return-to-baseline answer before supporting controls,
  filters, history, and detailed evidence.
- Recovery and Fatigue are placed near each other if discovery confirms that
  their relationship helps interpretation without implying they are the same
  concept.
- Existing Weight, Strength, 1K, and Progressive Overload calculations remain
  unchanged.

### More

More is intentionally outside this pass. Its current behavior and local subview
state remain unchanged.

---

## Dependency Map

```text
R0 ───────────────────────────────────────────────┐
                                                  │
R1                                                │
                                                  ├──> roadmap closeout
R2a ──> R2b                                       │
                                                  │
R3a ──┬──> R3b ──────────┐                        │
      └──────┐             │                      │
             ├──> R5a ─────┤                      │
      ┌──────┘             ├──> R5b               │
R4a ──┴──> R4b ──────────┘                        │
                                                  │
R6a ──> owner approval ──> R6b-1 ──> R6b-3 ──────┘
```

`R0`, `R1`, `R2a`, `R3a`, `R4a`, and `R6a` are independent in product terms,
but implementation must still avoid overlapping files and stale assumptions.
`R5a` follows the Home and Log Recovery decisions so Analytics can serve as the
coherent evidence owner rather than becoming a third independent redesign.

---

## Phase 1 — Repair Confirmed Regressions [COMPLETE]

Phase goal: fix behavior whose intended outcome is already explicit, without
waiting for the larger Recovery and guided-workout redesign.

Completion condition: every named Home action lands correctly; the 1K summary
has recovered its intended hierarchy; no ordinary tab behavior is changed.

Completed on 2026-08-10: R0 shipped in PR #772 and R1 shipped in PR #773. The
targeted checks and exact-head reviews passed, and both issues are closed.

### R0 — Make Analytics navigation targets exact

- **Issue:** [#770](https://github.com/bpronin90/kilo/issues/770)
- **Suggested title:** `Repair and Simplify / R0: make Home Analytics handoffs exact`
- **Goal:** make each explicit Home control land at the destination promised by
  its text while preserving local Analytics state for ordinary tab presses.
- **Depends on:** none.
- **Expected files:**
  - `mobile/App.js`
  - `mobile/screens/HomeScreen.js`
  - `mobile/screens/AnalyticsScreen.js`
  - directly relevant navigation and screen tests
  - directly affected living navigation/design documentation
- **Scope:**
  - extend the bounded Analytics target vocabulary with `overview`,
    `progressive-overload`, and `recovery`
  - make `Exercise Progress` target `progressive-overload`
  - make `Full history and insights` target `overview`
  - make the Home Recovery handoff target `recovery`
  - make repeated identical explicit requests re-apply through the existing
    monotonic-key contract
  - scroll only after the destination layout is known
- **Out of scope:** navigation-library migration, tab-root reset on ordinary
  Analytics presses, changing Analytics order, or changing the tab bar.
- **Acceptance:**
  - `Exercise Progress` consistently lands at Progressive Overload
  - `Full history and insights` consistently lands at the Analytics top after
    any previous Analytics scroll position
  - `Recovery` consistently lands at Recovery
  - repeating any handoff works
  - tapping Analytics in the tab bar preserves its current established behavior
  - accessibility hints name the actual destination
- **Verification:** direct and repeated requests for every target; request before
  layout; switch from every existing section; ordinary tab press; malformed and
  unknown targets; 320dp/375dp/448dp and large text.
- **Routing:** `agent:claude`; `area:architecture`, `area:ui`.

### R1 — Restore Home hierarchy and heading consistency

- **Issue:** [#771](https://github.com/bpronin90/kilo/issues/771)
- **Suggested title:** `Repair and Simplify / R1: restore summary typography and section hierarchy`
- **Goal:** reverse the visual regression in Home's 1K card and remove accidental
  heading drift on Log without redesigning otherwise accepted panels.
- **Depends on:** none.
- **Expected files:**
  - `mobile/screens/HomeScreen.js`
  - `mobile/components/LogRecoverySection.js`
  - `mobile/components/LogPreviousRoutines.js`
  - shared UI tokens only if both headings already occupy the same semantic role
  - focused render/style tests
  - `docs/design-system-map.md`
- **Scope:**
  - compare the current Home 1K label and total to the last accepted pre-regression
    treatment and restore their intended scale
  - retain the current card content and Analytics handoff
  - keep the header action from shrinking or visually competing with the total
  - make Log's `Recovery` and `More Routines` headings share the same section-title
    treatment unless one has a documented different role
- **Out of scope:** changing 1K calculations, reordering Home cards, redesigning
  Recovery content, or broad token cleanup.
- **Acceptance:**
  - `1K Progress` and its total no longer read smaller or less polished than the
    accepted design they replaced
  - the chevron remains a clear but quiet affordance
  - Recovery and More Routines headers match in size, weight, color, casing, and
    spacing when performing the same hierarchy role
  - no text clips or forces a horizontal layout at supported widths/large text
- **Verification:** before/after comparison against repository history or an
  owner-approved reference; both themes; responsive/large-text matrix; focused
  screen-render tests.
- **Routing:** `agent:claude`; `area:ui`.

---

## Phase 2 — Make Routine Context Predictable [COMPLETE]

Phase goal: make dates, note ownership, routine creation, and disclosure state
behave according to user meaning rather than implementation convenience.

Completion condition: visible routine dates have correct provenance; Recovery
navigation does not masquerade as an arbitrary More Routines expansion; manual
collapse choices survive view changes; new-routine creation is easy to find.

Completed on 2026-08-10: R2a established and received owner approval for the
date, note-ownership, disclosure, and unavailable-note contract in issue #774.
R2b shipped that contract in PR #777 and issue #775 closed. The related
backup-import integrity follow-up shipped separately in issue #776 / PR #778; it
was not part of the R2b contract and does not extend Phase 2 scope.

### R2a — Define routine date and disclosure semantics [COMPLETE]

- **Issue:** [#774](https://github.com/bpronin90/kilo/issues/774)
- **Suggested title:** `Repair and Simplify / R2a: investigate routine dates and reveal state`
- **Goal:** establish the exact source of the reported `8/8` Return-note date and
  specify truthful date/reveal behavior before changing stored or visible data.
- **Depends on:** none.
- **Outcome:** completed 2026-08-10. Findings, the decision table, the
  unavailable-linked-note revision, the owner's D1–D8 approval, and the final R2b
  contract are immutable comments on #774; the approved contract is authoritative
  over the summary below.
- **What the investigation established:**
  - The visible date was `note.updated_at`, which `LogPreviousRoutines` was the
    only UI in the app to read. That field is the sync conflict cursor, so it also
    moved on a read-only `Week A/B` tap, on any cloud sync (the server stamps it),
    and on a cloud-mode backup restore, which re-stamps every note.
  - No last-performed date is derivable: notes index sessions by ordinal and carry
    no per-session dates. `saved_at` is written once and survives edits, sync, and
    both restore paths.
  - The Recovery jump was two defects — a row labelled `View …` opening a distant
    management panel, and a never-reset reveal key re-expanding that panel on every
    later remount with no new request.
  - Neither disclosure outlived its own mount, so collapse choices were lost in
    opposite directions on Routine↔Deload switching.
  - A recovery week whose linked note is unavailable fabricated the title
    `Untitled Routine`, was an inert press, and anchored an unlink confirmation
    promising to preserve an already-absent note.
- **Approved decisions (D1–D8):** display `Created <date>` from `saved_at`, falling
  back to the note id's creation day and then to no date, never `updated_at`; sort
  the list and `Latest:` by the displayed field; Recovery renders its own linked
  notes inline and More Routines is not touched; only an unconsumed `navNoteKey`
  intent may auto-reveal; disclosure state is per surface for the mounted Log
  session, owned by `LogScreen`; `New Routine` needs no change; an unavailable
  linked note shows `Note unavailable` and is not a control, keeping its week and
  `Unlink` with no auto-repair.
- **Routing:** `agent:claude`; `area:workouts`, `area:architecture`, `area:ui`.

### R2b — Implement approved routine context behavior [COMPLETE]

- **Issue:** [#775](https://github.com/bpronin90/kilo/issues/775)
The owner-approved contract on
[#774](https://github.com/bpronin90/kilo/issues/774#issuecomment-5241795090) is
authoritative and was copied into the implementation issue. R2b shipped in
[PR #777](https://github.com/bpronin90/kilo/pull/777) at commit
`cc365b036157f9aceacca2c4ed96499aff834752` and closed on 2026-08-10. The summary
below remains for roadmap continuity only; where it differs from the approved
issue record, the issue record wins.

- **Suggested title:** `Repair and Simplify / R2b: make routine context and disclosures predictable`
- **Goal:** give a routine row a date with one documented meaning, move
  Recovery-linked note reading into Recovery, and make a user's disclosure choice
  survive Routine↔Deload switching — while an explicit cross-screen request still
  reveals its target.
- **Depends on:** R2a — satisfied; decisions approved 2026-08-10.
- **Expected files:** `mobile/screens/LogScreen.js`,
  `mobile/components/LogPreviousRoutines.js`,
  `mobile/components/LogRecoverySection.js`,
  `mobile/components/LogDeloadSection.js`, `mobile/tests/log-screen.test.js`,
  `docs/current-state.md`, `docs/design-system-map.md`, and the changelog fragment.
  No storage, hook, or sync file: `updated_at` keeps stamping exactly as it does
  because it is the sync conflict cursor, and the fix is that the UI stops reading
  it.
- **Scope:**
  - render `Created <date>` from `saved_at` in the row sub-line and its
    accessibility label, replacing every `updated_at` read
  - fall back to the note id's creation day, then to no date; never `updated_at`
  - sort the list and the `Latest:` summary by the displayed field, undated last
  - render a tapped Recovery week's note inline in the Recovery card, dropping the
    reveal call and the current-routine early return
  - hoist both disclosure states and the consumed-reveal marker into `LogScreen`
  - auto-reveal only for an unconsumed `navNoteKey` intent naming a non-current,
    non-deload routine
  - show `Note unavailable` for a week whose linked note is missing or null, with
    no press handler, keeping the week and its `Unlink` and correcting that
    confirmation's copy
- **Out of scope:** any new stored date field; last-performed tracking; historical
  data migration; `updated_at` semantics or any sync/storage change; backup-import
  referential validation ([#776](https://github.com/bpronin90/kilo/issues/776));
  automatic dangling-membership cleanup; Recovery metric
  redesign; guided-workout redesign; routine templates; `New Routine` relocation
  (D7 — no change needed); unrelated Log cleanup.
- **Acceptance:**
  - editing, reading `Week A/B`, syncing, and restoring a backup all leave the
    displayed date unchanged
  - `Latest:` names the same routine the sorted list shows first
  - tapping a Recovery week renders that note where the user tapped, including when
    it is the current routine, and More Routines does not change state
  - an unavailable linked note reads `Note unavailable`, never `Untitled Routine`,
    exposes no read action, keeps its week count and working `Unlink`, and triggers
    no automatic repair
  - a collapsed Deload/routine surface stays collapsed after switching away and
    back, with and without an earlier Recovery tap
  - an explicit request still reveals its target, including a repeat for the
    already-selected note; an ordinary view switch never does
- **Verification:** create/edit/reload/sync/restore timelines; the three
  unavailable-note shapes; Routine↔Deload switches; collapse/revisit; a remount
  carrying a consumed key; internal and cross-tab note targets; 0/1/many routines;
  responsive, large-text, and screen-reader checks.
- **Changelog:** user-visible — `.changes/<issue>-1.md`, `bump: patch`.
- **Routing:** `agent:claude`; `area:workouts`, `area:ui`, `area:architecture`.

---

## Phase 3 — Redesign Recovery Around One Answer Per Surface [DELIVERY ACTIVE]

Phase goal: replace dense Recovery presentations with a coherent cross-tab model
that answers the user's immediate question first and progressively discloses
supporting evidence.

R3a and R4a produced owner-approved written contracts. R3b shipped through
issue #782 / PR #783 and R4b shipped through issue #789 / PR #792. R5a's
corrected Analytics contract is owner-approved on #790, releasing R5b as the
phase's final delivery task under issue #793.

### R3a — Specify the Home return-to-baseline summary [COMPLETE]

- **Issue:** [#779](https://github.com/bpronin90/kilo/issues/779)
- **Outcome:** owner-approved Home contract recorded on #779 and implemented by
  R3b.

- **Suggested title:** `Repair and Simplify / R3a: define the Home Recovery summary`
- **Goal:** decide the smallest honest summary of progress toward baseline.
- **Depends on:** none.
- **Expected outputs:** issue comments, a compact state/copy table, and directly
  triggered design documentation only.
- **Starting proposal for discussion, not an approved design:**

  ```text
  RECOVERY
  4 of 7 exercises at baseline
  2 rebuilding · 1 not started
  ```

- **Questions to resolve:**
  - whether the headline counts baseline met, percent recovered, or another
    directly supported measure
  - whether `on track` means merely improving or meeting an expected weekly pace
  - which existing Recovery states can be rolled into the Home summary without
    making medically suggestive or unsupported claims
  - treatment of added-during-recovery and not-comparable exercises
  - whether week/baseline/inclusion context belongs on Home at all
  - loading, stale, error, complete, and missing-note presentation
- **Out of scope:** calculation changes, new prediction models, implementation,
  or conflating Recovery with fatigue.
- **Acceptance:** every active-state row is derivable from existing authoritative
  data; copy is understandable without opening Analytics; the component has a
  defined maximum information budget and exact handoff destination.
- **Verification:** walk through new, partial, fully recovered, regressing,
  added-exercise, missing-note, stale, and error fixtures.
- **Routing:** `agent:claude`; `model:claude-sonnet-5`; `reasoning:high`;
  `effort:default`; `area:ui`, `area:workouts`, `area:docs`.

### R3b — Implement the approved Home Recovery summary [COMPLETE]

- **Issue:** [#782](https://github.com/bpronin90/kilo/issues/782)
- **Outcome:** shipped in [PR #783](https://github.com/bpronin90/kilo/pull/783)
  on 2026-08-10.

- **Suggested title:** `Repair and Simplify / R3b: implement return-to-baseline on Home`
- **Goal:** replace the current confusing Home Recovery card with R3a's approved
  compact summary.
- **Depends on:** R0, R3a, and owner approval.
- **Expected files:** `mobile/screens/HomeScreen.js`,
  `mobile/screens/home/homeDashboardData.js`, focused Home/Recovery tests, and
  `docs/design-system-map.md`.
- **Scope:** presentation and the smallest existing-data derivation approved by
  R3a; preserve authoritative loading/stale/error state; use R0's Recovery target.
- **Out of scope:** Recovery persistence, lifecycle, baseline membership,
  inclusion semantics, or Analytics/Log redesign.
- **Acceptance:** the first readable statement answers return-to-baseline status;
  supporting categories remain concise; the handoff always reaches Analytics
  Recovery; non-ready states remain honest and actionable.
- **Verification:** every R3a fixture; existing authoritative-state tests;
  responsive/large-text, themes, TalkBack, and VoiceOver.
- **Routing:** `agent:claude`; `area:ui`, `area:workouts`.

### R4a — Specify the active Recovery experience on Log [COMPLETE]

- **Issue:** [#780](https://github.com/bpronin90/kilo/issues/780)
- **Outcome:** owner approved the final state/action matrix, calm default
  hierarchy, disclosure cut list, and corrected locked-state behavior on #780.

- **Suggested title:** `Repair and Simplify / R4a: simplify active Recovery on Log`
- **Goal:** determine exactly what Recovery must expose during a workout and
  remove everything else from the high-frequency Log path.
- **Depends on:** none.
- **Expected outputs:** issue comments, state/action matrix, low-fidelity content
  hierarchy, and directly triggered design documentation.
- **Questions to resolve:**
  - which single Recovery fact matters while logging the current workout
  - ~~whether the active Recovery week should own its linked note directly~~ —
    already decided by R2a/D4: Recovery owns the inline read of its linked notes.
    R4a inherits that and must not re-litigate it; it may still decide how that
    inline read is presented within a simplified Recovery surface.
  - which actions must remain visible versus live behind one disclosure
  - whether inclusion preferences belong anywhere on Log
  - how week completion, starting another week, retry, and blocked mutations appear
  - whether Recovery should sit above the active routine, inside it, or immediately
    after it
  - what content can be removed rather than merely collapsed
- **Out of scope:** implementation, Recovery calculations, completed history,
  guided-workout behavior, or routine date semantics owned by R2a.
- **Acceptance:** every active/pending/stale/error action has one discoverable
  owner; the default state is scannable during a workout; no control appears in
  two sections.
- **Verification:** paper walkthrough of start, active week, note editing, complete
  week, next week, stale/error, pending mutation, and completed block.
- **Routing:** `agent:claude`; `model:claude-sonnet-5`; `reasoning:high`;
  `effort:default`; `area:ui`, `area:workouts`, `area:docs`.

### R4b — Implement the approved Log Recovery hierarchy [COMPLETE]

- **Issue:** [#789](https://github.com/bpronin90/kilo/issues/789)
- **Outcome:** shipped in [PR #792](https://github.com/bpronin90/kilo/pull/792)
  on 2026-08-10.

- **Suggested title:** `Repair and Simplify / R4b: implement calm active Recovery on Log`
- **Goal:** implement R4a without disturbing routine, Deload, or Recovery state
  semantics.
- **Depends on:** R2b, R4a, and owner approval.
- **Expected files:** determined by R4a; likely `mobile/screens/LogScreen.js`,
  `mobile/components/LogRecoverySection.js`, focused Recovery/Log tests, and
  `docs/design-system-map.md`.
- **Scope:** approved placement, summary, disclosures, and action ownership only.
- **Out of scope:** calculation/storage changes, Analytics redesign, guided mode,
  or adjacent Log restyling.
- **Acceptance:** default active Recovery is visibly calmer; routine management
  no longer appears to own Recovery navigation accidentally; every lifecycle
  action remains available exactly once; stale/unverified states remain read-only.
- **Verification:** full R4a matrix; R2b reveal-state cases; responsive/large-text,
  themes, TalkBack, and VoiceOver.
- **Routing:** `agent:claude`; `area:ui`, `area:workouts`.

### R5a — Define Analytics Recovery hierarchy and placement [COMPLETE]

- **Issue:** [#790](https://github.com/bpronin90/kilo/issues/790)
- **Outcome:** owner-approved section order, evidence hierarchy, disclosure
  defaults, cut list, and corrected lifecycle-state contract recorded on #790.

- **Suggested title:** `Repair and Simplify / R5a: define Recovery evidence in Analytics`
- **Goal:** make Analytics the clear evidence owner without showing every control
  and detail at once, and decide its relationship to Fatigue.
- **Depends on:** R3a and R4a.
- **Expected outputs:** approved section order, content hierarchy, disclosure
  defaults, state matrix, and directly triggered design documentation.
- **Questions to resolve:**
  - whether Recovery and Fatigue should be adjacent and in which order
  - what Recovery headline is shared with Home versus expanded here
  - which filters are essential and which can be removed
  - whether exercise details, completed-block history, and inclusion controls
    need separate disclosures
  - whether week selection precedes the summary or follows it
  - which information is useful evidence versus implementation leakage
- **Out of scope:** implementation, changing fatigue/recovery semantics,
  predictions, or new analytics.
- **Acceptance:** the first screenful answers return-to-baseline status; section
  placement does not imply Recovery and Fatigue are interchangeable; every
  remaining control has a stated user question it answers.
- **Verification:** walkthrough with active short/long blocks, completed history,
  multiple weeks, missing notes, added exercises, stale/error, and large data sets.
- **Routing:** `agent:claude`; `area:ui`, `area:workouts`, `area:docs`.

### R5b — Implement the approved Analytics Recovery model

- **Issue:** [#793](https://github.com/bpronin90/kilo/issues/793)
- **Triage status:** ready; all dependencies and owner approvals are satisfied.

- **Suggested title:** `Repair and Simplify / R5b: implement focused Recovery Analytics`
- **Goal:** implement R5a's evidence hierarchy and approved Recovery/Fatigue order.
- **Depends on:** R0, R3b, R4b, R5a, and owner approval.
- **Expected files:** `mobile/screens/AnalyticsScreen.js`,
  `mobile/components/AnalyticsRecoverySection.js`, the smallest relevant section
  components/tests, and `docs/design-system-map.md`.
- **Scope:** approved ordering, summary, disclosures, filters, history, and
  existing inclusion controls; update R0 section coordinates after reordering.
- **Out of scope:** new metrics, persistence/calculation changes, or redesigning
  Weight, Strength, 1K, Progressive Overload, or Fatigue internals.
- **Acceptance:** Recovery's primary answer precedes controls and evidence;
  Recovery/Fatigue placement matches R5a; repeated Home Recovery targeting remains
  exact; no existing history or preference becomes unreachable unintentionally.
- **Verification:** R5a matrix; exact section navigation before/after layout;
  long history; responsive/large-text, themes, TalkBack, and VoiceOver.
- **Routing:** `agent:claude`; `model:claude-sonnet-5`; `reasoning:high`;
  `effort:default`; `area:ui`, `area:workouts`; `type:implementation`.

---

## Phase 4 — Rebuild Guided Workouts From First Principles [COMPLETE]

Phase goal: determine whether Kilo needs a distinct guided mode at all and, if it
does, make it a light, comprehensible extension of the canonical logging model.

The owner's current verdict is that the shipped guided experience is too
convoluted and resembles the fitness trackers Kilo is intended to avoid. This
phase therefore begins with questioning, not iteration on the existing shape.

R6a answered the phase goal on 2026-08-10, and the answer was **no**. Kilo has no
guided workout: no set-by-set flow, no rest timer, no session lifecycle. What
shipped under that name is five text-entry aids over the one canonical model — a
workout note's `raw_text`, parsed at read time. The approved outcome deletes the
aids the owner rejects rather than rebuilding them, and adds one small
affordance in their place.

Approved decisions live in the immutable comments on issue
[#781](https://github.com/bpronin90/kilo/issues/781): the decision log, the
state model and low-fidelity flow, two corrections that made the R6b contracts
implementation-ready, two feasibility amendments, and the final owner decision.

Completed on 2026-08-10: R6b-1 shipped in PR #787 and R6b-3 shipped in PR #788.
The ordinary editor now offers the approved tappable seed, and the superseded
composer, session-autofill sheet, and S2 first-use card are gone. R6b-2 remains
dropped by explicit owner decision.

### R6a — Conduct a multi-round guided-workout planning session [COMPLETE]

- **Issue:** [#781](https://github.com/bpronin90/kilo/issues/781)
- **Outcome:** owner-approved contract recorded in the issue's immutable
  comments. Guidance is a property of the ordinary editor, not a mode, an
  overlay, or a surface; the canonical source of truth is unchanged; and the
  approved work is two dependency-ordered issues, `R6b-1` and `R6b-3`.
- **Dropped by explicit owner decision:** the inline suggestion ("ghost text")
  half of the design, recorded as `R6b-2`. It depended on two visible changes to
  the daily editor — an explicit line height with a monospace font, and a change
  to which component owns vertical scrolling — and the owner chose not to accept
  either. The design is written down should it return. Its absence leaves one
  known gap, named below.
- **Known gap accepted by the owner:** nothing assists formatting *while
  typing*. Starting a note and learning the format are covered; the space
  between them is not.

- **Suggested title:** `Repair and Simplify / R6a: redesign guided workouts from first principles`
- **Goal:** produce an owner-approved interaction contract through multiple
  question-and-answer rounds, without treating the current guided flow as the
  default solution.
- **Depends on:** none.
- **Expected outputs:** issue comments, decision log, state/transition model,
  low-fidelity flow, explicit cut list, and directly triggered product/design docs.
- **Planning rounds:**
  1. **Job and boundary:** what problem guidance solves; who invokes it; whether
     it is a mode, an overlay, or ordinary Log becoming context-aware.
  2. **Workout structure:** free exercise order, supersets, skipped exercises,
     ad hoc additions, and switching between routine days.
  3. **Set interaction:** text editing versus compact inputs; completion gesture;
     previous result; target; rest; corrections; undo.
  4. **Decision authority:** whether Kilo prescribes, suggests, or only presents
     evidence; how the user overrides it; whether any choice is persisted.
  5. **Lifecycle:** start, resume, background/return, abandon, finish, edit after
     completion, and device/app interruption.
  6. **Recovery/Deload interaction:** whether guidance changes during either
     state and how it avoids collapsing distinct concepts.
  7. **Failure and accessibility:** parser uncertainty, incomplete notes, stale
     data, sync failure, large text, one-handed use, TalkBack, and VoiceOver.
  8. **Subtraction pass:** identify every screen, confirmation, control, and
     concept that can be removed.
- **Required decisions:**
  - canonical source of truth during and after a guided workout
  - whether a separate guided surface exists
  - exact entry and exit points
  - minimum always-visible information
  - set completion/edit/undo interaction
  - exercise-order freedom
  - suggestion authority and override behavior
  - resume behavior
  - explicit relationship to normal Log, Recovery, and Deload
  - which existing guided behavior is deleted
- **Out of scope:** implementation, telemetry, backend changes, exercise
  programming algorithms, or retaining current behavior merely for continuity.
- **Acceptance:**
  - the owner explicitly approves the final contract
  - the proposed happy path can be explained in a few sentences
  - common gym actions require no unexplained hidden state
  - freeform/manual logging remains available unless explicitly removed
  - R6b needs no product decision to start
- **Verification:** scenario walkthroughs for first use, routine workout,
  superset, out-of-order exercise, changed weight/reps, skip, interruption,
  resume, finish, correction, Recovery week, and Deload.
- **Routing:** `agent:claude`; `model:claude-opus-4-8`; `reasoning:high`;
  `effort:default`; `area:ui`, `area:workouts`, `area:architecture`, `area:docs`;
  `type:planning`.

### R6b-1 — Add the tappable example to the workout editor [COMPLETE]

- **Issue:** [#785](https://github.com/bpronin90/kilo/issues/785)
- **Outcome:** shipped in [PR #787](https://github.com/bpronin90/kilo/pull/787)
  on 2026-08-10.

- **Suggested title:** `Repair and Simplify / R6b-1: seed an empty workout note
  from a tappable example`
- **Goal:** when the editor is open on an empty note, show a four-line example
  and let one tap turn it into real editable text.
- **Depends on:** R6a. Ships before R6b-3 so the composer's replacement exists
  before the composer is deleted.
- **Expected files:** `mobile/components/WorkoutSyntaxReference.js` (add the seed
  constant only), `mobile/components/LogScreenEditorCard.js`, the directly
  relevant editor tests, and a changelog fragment.
- **Scope:** a `WORKOUT_SEED_EXAMPLE_TEXT` constant equal to exactly
  `Monday\n+Lifting\n-Bench\n135 5,5,5`, rendered below the input while the note
  is empty and inserted verbatim on tap. No new storage path: existing notes
  continue to use debounced autosave, while a new draft (`editingNoteId ===
  'new'`) persists only through the existing explicit Save/Done path. Not wired
  into the deload editor.
- **Out of scope:** any change to the taught seven-line syntax example or its
  three consumers, the syntax modal, Help, or the parser.
- **Acceptance:** one tap inserts exactly those four lines and the block
  disappears; emptying the note brings it back with no persisted flag; the
  inserted text parses cleanly with one exercise and one session entry; the
  teaching example stays byte-unchanged.
- **Verification:** empty, emptied, and whitespace-only notes; tap then undo; for
  a new draft, explicit Save and Done persist the inserted text and a failed save
  keeps the draft open and editable; existing-note autosave remains covered;
  deload editor unaffected; 320/375/448dp, large text, both themes, TalkBack,
  and VoiceOver.
- **Routing:** `agent:claude`; `area:ui`, `area:workouts`.

### R6b-3 — Remove the superseded guided surfaces [COMPLETE]

- **Issue:** [#786](https://github.com/bpronin90/kilo/issues/786)
- **Outcome:** shipped in [PR #788](https://github.com/bpronin90/kilo/pull/788)
  on 2026-08-10.

- **Suggested title:** `Repair and Simplify / R6b-3: remove the guided routine
  and session-autofill sheets`
- **Goal:** delete the composer sheet, the Copy-last-session sheet, the S2
  first-use card, and their dead helpers, leaving freeform text entry as the
  single path.
- **Depends on:** R6b-1 merged.
- **Expected files:** `mobile/components/GuidedRoutineSheet.js` and
  `mobile/components/SessionAutofillSheet.js` (both deleted),
  `mobile/lib/guidedEntry.js`, `mobile/screens/LogScreen.js`,
  `mobile/components/LogScreenEditorCard.js`,
  `mobile/components/LogEmptyState.js` (intro copy only),
  `mobile/tests/first-use-workout-note-flows.test.js`, the directly affected
  living docs, and a changelog fragment.
- **Scope:** the R6a cut list. `New Routine` opens the ordinary editor on an
  empty note showing R6b-1's seed.
- **Out of scope:** `mobile/components/WorkoutSyntaxReference.js`, which already
  carries both of the S2 card's lessons and must not be edited; the adoption
  prompt; the S1 card; the session check-in; the parser; and every Recovery,
  Deload, and fatigue semantic.
- **Acceptance:** no route reaches either sheet; both files are gone; the syntax
  reference is byte-unchanged and both its lessons still render in Help and in
  the editor-reachable modal; the adoption prompt, S1 card, and session check-in
  are unchanged; no unreachable exports remain in `guidedEntry.js`.
- **Verification:** `New Routine` from every entry point; save-then-`Not now`
  recovered via the S1 card; a routine with two or more day groups, whose
  crashing autofill path is now gone; full targeted Log suite.
- **Routing:** `agent:claude`; `area:ui`, `area:workouts`, `area:docs`.

### R6b-2 — Inline formatting suggestions [DROPPED]

Designed in full and dropped by explicit owner decision on 2026-08-10. Recorded
here so the decision is not silently revisited: the feature required an explicit
line height and a monospace font on the editor input, plus a change to which
component owns vertical scrolling, and the owner declined both. Do not implement
without a new owner decision.

---

## Explicitly Preserved

- Home title.
- Home weight and workout summary panel design, apart from its named navigation
  destinations.
- Weight tab behavior and design.
- More tab behavior and design.
- Existing strength, Progressive Overload, 1K, Recovery, and fatigue calculations.
- Recovery inclusion semantics and authoritative stale/error/mutation safeguards.
- Routine, Recovery, Deload, fatigue, and skip-week conceptual separation.
- Current tab-bar behavior in full.

## Deferred and Explicitly Excluded

- Broad Home redesign beyond Recovery and 1K regression repair.
- Proactive Weight cleanup without new regression evidence.
- More-tab cleanup.
- New Recovery scoring or prediction models.
- Exercise-programming recommendations not approved through R6a.
- Inline formatting suggestions in the workout editor, and the editor typography
  and scroll-ownership changes they depend on (R6b-2, dropped by the owner).
- Product telemetry or measurement work.
- Navigation-library migration.
- Broad design-system normalization unrelated to the named mismatches.
- Backend, Auth, sync, and Supabase changes unless a later approved contract
  proves one is strictly required; this roadmap currently expects none.

---

## Roadmap Closeout

This roadmap is complete when every included implementation task is merged and
closed, or explicitly removed/deferred by a newer owner decision recorded in
GitHub, and every discovery-gated task has either an approved implementation or
an explicit decision not to build it.

At closeout:

1. Verify all explicit Home handoffs from arbitrary Analytics positions.
2. Compare the Home 1K card to the owner-approved visual reference at every
   supported width and large text.
3. Re-run Log routine/Deload/Recovery disclosure and date timelines on device.
4. Validate Recovery across never-used, active, partial, complete, pending,
   first-load failure, stale refresh, missing-note, and completed-history states.
5. Confirm the workout editor seeds an empty note from the tappable example, that
   neither guided sheet is reachable from any entry point, and that the syntax
   reference still teaches the session rule and the `Track` control.
6. Confirm Weight and More remained unchanged and the tab bar still matches its
   locked behavior.
7. Update directly affected living docs, archive this roadmap only after it is
   marked complete, and record any intentionally deferred follow-up work.

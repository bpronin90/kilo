# Kilo Contain and Connect Roadmap

**Status: Complete.** This roadmap was executed through to completion. All named deliverables have shipped and the roadmap is retained here as historical reference. The product-cohesion pass is complete as of issue #767.

---

Status: active product-cohesion roadmap; Phases 1 and 2 are complete.

Source of truth: the approved audit on GitHub issue `#714`, specifically the
owner direction in comment `5152669329`, the final consolidated audit in comment
`5152692672`, and the approval in comment `5152705784`.

This pass is not another MVP version. Kilo currently happens to be in closed testing with a
five-tab native product, cloud/auth flows, recovery and deload workflows,
analytics, and release infrastructure. The purpose of this roadmap is narrower:
make the existing product feel obvious, connected, and calm enough that testers
can start and complete its two daily loops without navigating accumulated
feature clutter.

The selected product direction is **Contain and Connect**:

- keep the five current tabs and their jobs
- keep the tab bar exactly as designed
- make Home a useful starting point for training and weigh-in
- keep Log focused on the workout happening now
- show Recovery on Log only while it affects the current workout
- move completed Recovery context and analytics preferences to Analytics
- connect existing surfaces with lightweight typed navigation intents
- centralize shared Recovery and sync state instead of multiplying subscriptions
- defer product telemetry and reduced-motion expansion to separately contracted work

---

## Roadmap Rules

- Each task becomes one GitHub issue and one authoritative implementation PR.
- Do not create every issue up front merely to mirror this document. Triage a
  task when its dependencies are satisfied or when the owner explicitly wants
  the next batch prepared.
- D0, D4, and D13 are the only dependency-free implementation tasks.
- Route new work to Claude under the repository owner's standing direction.
- Every issue must include exactly one `agent:claude`, one matching Claude
  `model:` label, one `reasoning:` label, and all relevant `area:` labels.
- Use Claude Opus 4.8 with high reasoning for cross-surface state, navigation,
  recovery, or ambiguous semantics. Use Claude Sonnet 5 with medium reasoning
  for bounded UI work.
- An issue contract must restate its exact `Allowed Files`; paths below are the
  expected starting set, not permission to expand opportunistically.
- Product behavior changes add the required `.changes/<issue>-1.md` fragment.
  Investigation-only tasks and governance work do not.
- Every affected UI task validates at 320dp, 375dp, and 448dp plus large text.
  Accessibility requirements are acceptance criteria, not a later cleanup pass.
- No task may alter the tab bar's opacity, scroll response, settle timing,
  motion, post-interaction behavior, layout ownership, or styling.
- No task may add product telemetry, a consent prompt, event buffering, event
  flushing, ingestion, or dashboards under this roadmap.
- No task may merge deload, Recovery, fatigue, or skip-week semantics. They are
  distinct product concepts.
- Preserve capability continuity: a source surface is removed only after its
  replacement is live in the same PR or an already-shipped dependency.

---

## Target Experience

### Home

Home answers: **What is my state, and what do I do next?**

- A populated Home keeps its existing summaries.
- Training and weigh-in remain separate daily loops, and both are reachable in
  one tap.
- Weight and strength summaries link to the owning Analytics sections.
- Loading uses a skeleton instead of rendering nothing.
- Errors have a readable banner and retry.

### Log

Log answers: **What am I doing in the gym right now?**

- The active routine remains the hero.
- Other routines collapse to a count plus latest-summary row and expand in place.
- `+ New routine` and `Start recovery block` live inside expanded routine management.
- A user who has never used Recovery sees no Recovery lifecycle/history section;
  eligible users can still find `Start recovery block` inside expanded routine
  management.
- A user with only completed Recovery history sees no Recovery UI on Log.
- An active, pending, failed, or stale Recovery state remains visible because
  it affects the current workout.
- Completed Recovery history lives only on Analytics, where its contextual
  replacement is now available.

### Weight

Weight remains the dedicated daily body-weight surface.

- Entry, goal, pace, calories, trends, and history keep their current ownership.
- A lightweight handoff opens full weight trends in Analytics.
- Date editing is no longer controlled by global Settings toggles. Weight and
  deload surfaces show a compact secondary row such as `Date · Today`; tapping
  it opens the existing date control.

### Analytics

Analytics answers: **What is changing over time?**

- Existing strength, weight, fatigue, and Recovery evidence remain.
- Completed Recovery history owns a per-week contextual index: block grouping,
  week ordinal, completion dates, and navigation to the exact workout note.
- The completed-block inclusion preference lives beside the history it governs.
- Recovery loading, stale, error, pending, busy, and rejected-write states use
  the same shared foundation as Log.

### More

More remains the account, data, settings, and help menu.

- Its existing local subview behavior is preserved.
- Typed navigation may target Account > Cloud Sync.
- Tapping More after visiting a subview continues to preserve today's behavior;
  returning to the tab root is not part of this roadmap.

---

## Dependency Map

```text
D0 ──> D1 ──> D3 ──> D5
 │      │
 │      ├──────────────> D10
 │      └──┐
 │         ├──> D1b <── D13
 │         └──> D7  <── D4
 │                    └──> D9a ──> D9b
 │
D4 and D13 start independently

D7 ──> D11
D7 ──> D12
```

Parallel work is allowed only where contracts and files do not overlap. Before
starting a task, re-check the current tree and every dependency's merged output;
this roadmap describes intent, not a license to implement against stale line
numbers.

---

## Phase 1 — Shared Foundations and Connections

Status: complete.

Phase goal: repair the two live Recovery state defects and establish navigation
contracts before moving ownership between screens.

Completion condition: Log and Analytics consume one verified Recovery state;
the six low-risk handoffs work through today's contract; typed cross-screen
intents can target Analytics sections, an exact Log note, and More > Cloud Sync.

### D0 — Build one shared Recovery state foundation

- **Issue:** [#716](https://github.com/bpronin90/kilo/issues/716)

- **Suggested title:** `Contain and Connect / D0: centralize verified Recovery state`
- **Goal:** give Log and Analytics one authoritative Recovery read/reconcile
  contract so neither interprets failed reads as valid empty state.
- **Depends on:** none.
- **Expected files:**
  - `mobile/hooks/entries/recoveryBlockHooks.js`
  - a narrowly scoped shared provider/context if the implementation needs one
  - `mobile/screens/LogScreen.js`
  - `mobile/screens/AnalyticsScreen.js`
  - directly relevant Recovery component and hook tests
- **Scope:**
  - expose initial loading, ready, stale, and error states
  - retain last-known-good blocks/weeks after a failed refresh
  - expose pending and terminal journal state, retry, and one `mutationsAllowed` decision
  - raise explicit refresh progress without confusing cold load with retry
  - make eligibility unknown—not empty—until a verified snapshot exists
  - re-check `mutationsAllowed` at confirmation time
  - share one subscription/reconciliation path between mounted consumers
- **Out of scope:** moving Recovery UI, changing lifecycle semantics, changing
  persistence, or changing analytics inclusion semantics.
- **Acceptance:**
  - a failed first read cannot expose `Start recovery block`
  - a failed Analytics read cannot silently present verified-empty history
  - stale records remain readable and every mutation stays disabled
  - retry preserves a visible repair state while the read is in flight
  - Log and Analytics cannot disagree about verified/stale/pending state
- **Verification:** hook contract tests; first-load failure; successful empty
  load followed by failed refresh; populated load followed by failed refresh;
  retry; pending/terminal journal outcomes; mounted consumers sharing one update.
- **Routing:** `agent:claude`, `model:claude-opus-4-8`, `reasoning:high`;
  `area:architecture`, `area:ui`, `area:workouts`.

### D4 — Connect the six existing-contract handoffs

- **Issue:** [#717](https://github.com/bpronin90/kilo/issues/717)

- **Suggested title:** `Contain and Connect / D4: connect daily loops and Analytics sections`
- **Goal:** remove dead ends using the navigation contract that already exists.
- **Depends on:** none.
- **Expected files:** `mobile/App.js`, `mobile/screens/HomeScreen.js`,
  `mobile/screens/WeightScreen.js`, `mobile/screens/AnalyticsScreen.js`, and
  directly relevant screen/navigation tests.
- **Scope:** Home -> Log current routine; Home -> Weight entry; Analytics empty
  -> Log; Home -> Analytics strength; Home weight value/sparkline -> Analytics
  weight; Weight -> Analytics weight via `See full trends`; add only the minimum
  App wiring needed by Weight and Analytics.
- **Out of scope:** D13 migration, Cloud Sync targeting, Recovery-note targeting,
  tab behavior, or internal screen navigation rewrites.
- **Acceptance:** all six handoffs land on the intended existing tab/section;
  ordinary tab presses preserve current behavior; repeated explicit section
  handoffs work; no summary becomes a second competing interactive owner.
- **Verification:** screen tests for every handoff; ordinary Analytics/More tab
  behavior; 320dp/375dp/448dp plus large text; screen-reader labels/order.
- **Routing:** `agent:claude`, `model:claude-sonnet-5`, `reasoning:medium`;
  `area:ui`, `area:architecture`.

### D13 — Add typed cross-screen navigation intents

- **Issue:** [#718](https://github.com/bpronin90/kilo/issues/718)

- **Suggested title:** `Contain and Connect / D13: add typed cross-screen navigation intents`
- **Goal:** express precise cross-screen destinations without replacing the
  current tab shell or each screen's appropriate local view model.
- **Depends on:** none.
- **Expected files:** `mobile/App.js`, `mobile/screens/LogScreen.js`,
  `mobile/screens/MoreScreen.js`, `mobile/screens/AnalyticsScreen.js`, and the
  smallest directly relevant Log/More helpers and tests.
- **Contract:**

  ```js
  navTarget = { tab, target, key }

  target =
    | { kind: 'section', id: 'weight' | 'strength' }
    | { kind: 'note', noteId: string }
    | { kind: 'subview', view: string, anchor?: string }
  ```

- **Scope:** monotonic keys; absent targets preserve local state; a set-only Log
  note entry point; explicit current/loading/missing/repeated/editing outcomes;
  More > Account > Cloud Sync targeting after layout; section migration without
  changing ordinary tab presses.
- **Out of scope:** a navigation-library migration, tab-root resets, tab-bar
  work, or changing More/Log/Analytics internal interaction models.
- **Acceptance:** every target has one owning consumer; unknown target kinds are
  ignored safely; repeated intents re-apply; deleted-note and editing-state
  refusals are announced and never open unrelated content.
- **Verification:** request construction and every consumer case; repeated note
  targets, current-note scroll, notes loading, deleted note, editor refusal,
  repeated Cloud Sync target, absent target; responsive and screen-reader checks.
- **Routing:** `agent:claude`, `model:claude-opus-4-8`, `reasoning:high`;
  `area:architecture`, `area:ui`.

---

## Phase 2 — Contain Log and Move Completed Recovery Context

Status: complete as of 2026-08-02.

Phase goal: make the gym-floor surface calm without losing Recovery capability.

Completion condition: Recovery appears on Log only while relevant to the current
workout; Analytics owns completed Recovery context and inclusion; every completed
week still opens its exact note.

### D1 — Contain the Log surface

- **Issue:** [#724](https://github.com/bpronin90/kilo/issues/724)
- **Status:** complete.

- **Suggested title:** `Contain and Connect / D1: contain Recovery and routine management on Log`
- **Goal:** keep the active routine dominant and remove permanent Recovery and
  library clutter from ordinary logging.
- **Depends on:** D0.
- **Expected files:** `mobile/screens/LogScreen.js`,
  `mobile/components/LogRecoverySection.js`,
  `mobile/components/LogPreviousRoutines.js`,
  `mobile/components/LogActiveRoutineCard.js`, and directly relevant Log tests.
- **Scope:** apply Shape 1; preserve completed history until D1b; move Start
  into routine management under `mutationsAllowed`; collapse More Routines;
  keep collapsed lists action-free; add chevrons/summaries; retire visible
  double-tap hints while preserving the gesture.
- **Out of scope:** completed-history deletion, Analytics controls, Deload
  header action relocation, Recovery semantics, or tab behavior.
- **Acceptance:** non-adopters see no Recovery lifecycle/history section;
  eligible users retain the `Start recovery block` entry point inside expanded
  routine management; active/pending/error/stale states remain visible; history
  remains until D1b; primary actions remain one tap; collapsed routine
  management exposes no actions.
- **Verification:** every D0 Recovery state; 0/1/many routines; active/completed
  combinations; confirmation re-check; responsive, large-text, collapse, and
  screen-reader state.
- **Routing:** `agent:claude`, `model:claude-opus-4-8`, `reasoning:high`;
  `area:ui`, `area:workouts`, `area:architecture`.

### D1b — Make Analytics the completed Recovery owner

- **Issues:** [#727](https://github.com/bpronin90/kilo/issues/727),
  [#728](https://github.com/bpronin90/kilo/issues/728), and
  [#729](https://github.com/bpronin90/kilo/issues/729)
- **Status:** complete.

- **Suggested title:** `Contain and Connect / D1b: move completed Recovery context to Analytics`
- **Goal:** place completed Recovery evidence, contextual navigation, and the
  analytics-inclusion preference on their durable owner surface.
- **Depends on:** D0, D1, D13.
- **Expected files:** `mobile/screens/AnalyticsScreen.js`,
  `mobile/components/AnalyticsRecoverySection.js`,
  `mobile/components/LogRecoverySection.js`, the smallest shared inclusion
  extraction if needed, and focused Recovery/Analytics tests.
- **Scope:** add block grouping, week ordinal, dates, and note title; navigate
  each week to its exact Log note through D13; move completed-block inclusion;
  keep active inclusion on Log; consume every D0 state; serialize switches;
  report rejection by block; remove Log history only after replacement is live.
- **Out of scope:** Recovery calculations, membership, inclusion meaning, or
  active-lifecycle ownership.
- **Acceptance:** no context disappears; each week opens the correct note;
  stale/unverified state is read-only; switches show persisted truth; Log
  history disappears only after the replacement renders.
- **Verification:** all Recovery states; multiple blocks/preferences; rejected
  and serialized writes; every note-target outcome; responsive, large-text, and
  screen-reader identity.
- **Routing:** `agent:claude`, `model:claude-opus-4-8`, `reasoning:high`;
  `area:ui`, `area:workouts`, `area:architecture`.

---

## Phase 3 — Hierarchy, Accessibility, and State Coverage

Phase goal: apply progressive disclosure consistently and make loading, error,
queued, destructive, and assistive states trustworthy.

### D3 — Move Deload header actions into expanded bodies

- **Suggested title:** `Contain and Connect / D3: apply progressive disclosure to Deload cards`
- **Goal:** remove configuration/destructive actions from collapsed headers.
- **Depends on:** D1.
- **Expected files:** `mobile/components/LogDeloadSection.js` and its tests.
- **Scope:** move active Edit and past Delete into expanded bodies; use the
  shared chevron/summary pattern; keep collapsed rows free of actions.
- **Out of scope:** Deload semantics, Recovery, or a new overflow menu/sheet.
- **Acceptance:** collapsed Deload cards have zero actions; expanded cards keep
  every capability; destructive actions retain confirmation.
- **Verification:** active/past and collapsed/expanded cases; responsive,
  large-text, screen-reader expanded state and action order.
- **Routing:** `agent:claude`, `model:claude-sonnet-5`, `reasoning:medium`;
  `area:ui`, `area:workouts`.

### D5 — Complete the cross-surface accessibility pass

- **Suggested title:** `Contain and Connect / D5: close accessibility gaps across daily surfaces`
- **Goal:** make affected controls operable through touch, TalkBack, and VoiceOver.
- **Depends on:** D3.
- **Expected files:** directly cited Log, Deload, Home, Weight, and Analytics
  components; focused tests; `docs/testing-and-qa.md` if its checklist changes.
- **Scope:** cited targets >=44dp; roles/labels/states on Deload actions and
  collapse targets; text/screen-reader meaning for trend arrows and Home Pace;
  block identity in switch labels; confirm hidden tabs are excluded from a11y.
- **Out of scope:** reduced motion, tab-bar changes, or broad visual redesign.
- **Acceptance:** no cited control depends on color; all controls have unique
  spoken identity; hidden tabs do not pollute order; collapsed surfaces expose
  summaries and no hidden actions.
- **Verification:** TalkBack/VoiceOver walkthroughs; label/state tests; target
  measurement; responsive and large-text matrix.
- **Routing:** `agent:claude`, `model:claude-sonnet-5`, `reasoning:high`;
  `area:ui`.

### D7 — Add honest loading, error, queued-sync, and destructive states

- **Suggested title:** `Contain and Connect / D7: add shared loading error and sync states`
- **Goal:** stop screens from rendering nothing or silently losing work-state context.
- **Depends on:** D1, D4, D13.
- **Expected files:** `mobile/App.js`, `mobile/hooks/useEntries.js`, the Home,
  Log, Weight, Analytics screens, the actual Cloud Sync owner, and focused tests.
- **Scope:** one shell-owned sync subscription/context; Home/Log/Weight
  skeletons; Home/Analytics error banners; `N pending changes` -> Cloud Sync;
  sync-failed copy/retry; confirmation before Set as current routine.
- **Out of scope:** connectivity detection, calling queued work offline,
  changing sync semantics, or per-tab subscriptions.
- **Acceptance:** mounted tabs share one summary; loading/failure stay distinct;
  pending copy makes no network claim; repeated Cloud Sync targets apply; routine
  switch requires confirmation.
- **Verification:** subscription-count contract; queue broadcasts; sync failure
  and retry; every affected screen state; responsive, large-text, alert announcements.
- **Routing:** `agent:claude`, `model:claude-opus-4-8`, `reasoning:high`;
  `area:architecture`, `area:ui`, `area:integrations`.

---

## Phase 4 — First-Use and Semantics

Phase goal: learn why testers fail to start, implement only evidence-backed
guidance, and lock fatigue semantics before any UI change.

### D9a — Observe first use and define guided-entry semantics

- **Suggested title:** `Contain and Connect / D9a: observe first use and specify guided entry`
- **Goal:** replace guesses about tester abandonment with qualitative evidence
  and an implementation-ready first-entry contract.
- **Depends on:** D4.
- **Expected outputs:** issue comments and only directly triggered planning/testing docs.
- **Scope:** observe representative closed testers; distinguish comprehension,
  navigation, entry, and trust failures; define teaching order and autofill
  source, target fields, confirmation, parser interaction, persistence, and boundary.
- **Out of scope:** telemetry, analytics events, implementation, or parser changes.
- **Acceptance:** D9b requires no further product decision; no participant data
  is added to the repository.
- **Verification:** observation protocol, anonymized synthesis, walkthrough of
  proposed empty/partial/returning flows.
- **Routing:** `agent:claude`, `model:claude-opus-4-8`, `reasoning:high`;
  `area:ui`, `area:architecture`, `area:docs`.

### D9b — Implement guided first entry and confirmed autofill

- **Suggested title:** `Contain and Connect / D9b: implement approved guided first entry`
- **Goal:** help a new tester reach the first useful routine without silent decisions.
- **Depends on:** D9a.
- **Expected files:** determined by D9a; likely Home/Log empty/editor surfaces,
  parser-facing helpers, focused tests, and directly affected living docs.
- **Scope:** implement only D9a's sequence/autofill; require confirmation before
  persistence; preserve manual note-first entry.
- **Out of scope:** telemetry, account onboarding, parser redesign, templates.
- **Acceptance:** first useful routine is reachable; suggestions are inspectable
  and confirmable; manual entry remains; returning users do not repeat guidance.
- **Verification:** empty/partial/returning, cancel/edit, parser failure,
  persistence reload, responsive, large text, TalkBack, VoiceOver.
- **Routing:** `agent:claude`, `model:claude-opus-4-8`, `reasoning:high`;
  `area:ui`, `area:workouts`, `area:architecture`.

### D10 — Investigate and lock fatigue-trigger semantics

- **Suggested title:** `Contain and Connect / D10: define fatigue check-in trigger semantics`
- **Goal:** decide which signals prompt and when before changing UI or stored meaning.
- **Depends on:** D1.
- **Expected outputs:** issue comments and directly triggered semantic docs only.
- **Scope:** evaluate skipped, volume-drop, collapse, and day-skip detectors;
  define timing; distinguish typed skip from inferred fatigue; define precedence.
- **Out of scope:** implementation, merging fatigue with Deload/Recovery, or
  historical-record changes.
- **Acceptance:** every detector has a prompt/no-prompt rule and timing; normal
  constraints are not medicalized; the follow-up needs no further audit.
- **Verification:** session timelines, repeated skips, normal completion, Done,
  effect, and intentional skip markers.
- **Routing:** `agent:claude`, `model:claude-opus-4-8`, `reasoning:high`;
  `area:workouts`, `area:architecture`, `area:docs`.

---

## Phase 5 — Coherence and Settings Simplification

Phase goal: finish lower-priority visual consistency and remove configuration
that exists only to reveal ordinary fields.

### D11 — Align cross-tab visual hierarchy

- **Suggested title:** `Contain and Connect / D11: align cross-tab metric hierarchy`
- **Goal:** make repeated summaries feel related without making screens identical.
- **Depends on:** D7.
- **Expected files:** Home/Analytics summary components, genuinely shared UI
  tokens/components, `docs/design-system-map.md`, focused tests.
- **Scope:** summary-vs-owner scale for 1K; reduce label drift; normalize padding
  where roles match; preserve intentional hierarchy.
- **Out of scope:** new analytics, ownership changes, or one universal card size.
- **Acceptance:** each repeated metric has one owner treatment and one compact
  summary treatment; deviations are documented; touch/text scaling do not regress.
- **Verification:** all tabs at all widths/large text; light/dark; design map;
  relevant snapshots/components.
- **Routing:** `agent:claude`, `model:claude-sonnet-5`, `reasoning:medium`;
  `area:ui`, `area:docs`.

### D12 — Replace global Date Editing toggles with contextual date rows

- **Suggested title:** `Contain and Connect / D12: make date editing contextual and discoverable`
- **Goal:** remove Settings-driven UI while keeping historical dates available
  without cluttering frequent flows.
- **Depends on:** D7.
- **Expected files:** `mobile/screens/WeightScreen.js`, the actual Deload editor
  owner, the Settings owner, preference hooks/storage only as needed, focused
  tests, and directly affected living docs.
- **Scope:** remove Weight/Deload Date Editing toggles; show a compact secondary
  `Date · Today` row on relevant surfaces; open the existing control on press;
  keep it below the primary action; preserve dates/semantics; safely ignore or
  retire obsolete persisted preference values without product-data migration.
- **Out of scope:** date formats, timezone/default semantics, ordering, or date
  editing on unrelated surfaces.
- **Acceptance:** date editing is discoverable without Settings; the full
  control is absent from the default high-frequency layout; saved dates remain;
  Weight and Deload use the same interaction pattern.
- **Verification:** default today, historical date, cancel, save/reload, stale
  stored preferences, responsive, large text, screen-reader label/state.
- **Routing:** `agent:claude`, `model:claude-sonnet-5`, `reasoning:medium`;
  `area:ui`, `area:weight`, `area:workouts`.

---

## Deferred and Explicitly Excluded

- **Product measurement / telemetry:** scaffolding exists but cannot emit in
  production. It is not completed or removed here. Reconsider only through a
  separate contract covering consent, buffering, delivery, ingestion, retention,
  and product use of the signal.
- **Reduced motion:** raise a separate chart/motion issue only when prioritized.
- **Tab bar:** current behavior is intentional and locked.
- **C15 conditional-view resurrection:** Shape 1 adds no conditional view, so
  existing Deload selection behavior is recorded but unchanged.
- **Vocabulary pass:** broader than this cohesion pass.
- **More tab-root behavior:** preserve today's local subview state.
- **Directions B and C:** evaluated alternatives in #714, not active branches.

---

## Roadmap Closeout

This roadmap is complete when every included task is merged and closed, or
explicitly removed/deferred by a newer owner decision recorded in GitHub.

At closeout:

1. Re-run the two core loops with a fresh tester: weigh in and complete a gym session.
2. Validate Recovery across never-used, active, pending, first-load failure,
   stale refresh, completed history, and inclusion-write failure states.
3. Complete each card's width, large-text, TalkBack, and VoiceOver matrix.
4. Confirm every cross-screen handoff and ordinary tab press.
5. Update living docs only where merged behavior changed their truth.
6. Mark this document complete and move it to `docs/archive/` in a dedicated
   governance change after the final task ships.

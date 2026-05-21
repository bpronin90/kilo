# MVP3.5 Roadmap

Post-MVP3 cleanup and capability roadmap. Phases are ordered by user-blocking
severity → correctness → missing capability → IA fixes → polish. Each phase
ends with the app in a releasable state so the reviewer can gate the next.

Agent routing follows `AGENTS.md`:

- `agent:claude` — backend/data/logic (parser, storage, formulas, migration)
- `agent:gemini` — frontend/UI (screens, components, styling, navigation)
- `agent:codex` — planning, review, investigation

Reasoning labels noted where required (claude tasks). Tasks are individual and
narrowly scoped — they are not bundled within a phase.

---

## Current Problems Summary

- **P0 broken behavior:** 1k Club blank screen, raw-note Save no-op, Android back exits app, Track is a dead control.
- **Correctness:** Pacing flag thresholds wrong; Kilo max equals 1RM max because the spec formula is not implemented.
- **Missing MVP3 capability:** Multi-routine notes ("workout notebook" model), Track → progressive-overload pipeline, current-routine designation drives Analytics scope.
- **Structure:** Log tab duplicates weekdays (warmup vs lifting split); Analytics tab entry flickers.
- **Polish:** Kilo title image, Home subheader/copy, scoped tile click targets, "Weeks In" tile (deload coloring deferred to backlog issue #92), global content offset, Weight log Save sizing/color, date picker, Goal/suggestion prominence, Log typography, "first" label rename.

---

## Phase 1 — Stop the Bleeding

**Goal:** Eliminate dead-ends and data-loss bugs that make the build feel broken on launch.
**Why first:** Tester-visible crashes and no-ops in the first 60 seconds; everything downstream is easier to verify once nav and saves work.
**Exit condition:** No tap leads to a blank screen, raw-note Save persists, Android back stays inside the app, and Track is no longer an interactive dead control.

### 1.1 — Fix 1k Club bubble blank-screen crash

- **Problem:** Tapping the 1k Club bubble on Home opens a blank screen.
- **Scope:** `mobile/screens/HomeScreen.js` — fix the 1k Club tile `onPress` / target route so it no longer crashes.
- **Out of scope:** Final destination (set in Phase 4), tile redesign.
- **Acceptance:** Tapping the bubble never produces a blank screen; no console errors.
- **Agent:** `agent:gemini`

### 1.2 — Fix raw-note Save no-op

- **Problem:** In the Log tab raw-note editor, Save does nothing.
- **Scope:** `mobile/screens/LogScreen.js` raw-note handler + persistence path in `mobile/storage` / `mobile/lib/data.js`.
- **Out of scope:** Multi-note model (Phase 3).
- **Acceptance:** Edited note persists across reload; existing single-note flow unbroken; visual confirmation on save.
- **Agent:** `agent:claude`, `reasoning:medium`

### 1.3 — Android system-back stays in app

- **Problem:** Back gesture from Home exits Kilo instead of navigating within it.
- **Scope:** Navigator config in `mobile/App.js` + hardware-back listener; pop within stack; exit/no-op only at Home root.
- **Out of scope:** iOS gesture changes.
- **Acceptance:** Back from any non-Home returns toward Home; back at Home root either no-ops or shows exit confirmation; verified on Android emulator/device.
- **Agent:** `agent:gemini`

### 1.4 — Disable Track button until pipeline lands

- **Problem:** Tapping Track on an exercise does nothing — false affordance.
- **Scope:** `mobile/screens/LogScreen.js` Track button rendered visibly disabled (greyed out) until Phase 3 wires it up.
- **Out of scope:** Persistence logic (Phase 3).
- **Acceptance:** Track is clearly inert; no tap-with-no-result interaction.
- **Agent:** `agent:gemini`

---

## Phase 2 — Correctness Pass

**Goal:** Trust the numbers before any UI is built on top of them.
**Why now:** Math fixes are independent of UI; doing them later forces re-verification of every screen that displays the values.
**Exit condition:** Pacing flag matches the stated thresholds; Kilo max is computed per spec; Kilo max and 1RM max diverge as expected.

### 2.1 — Repair pacing-flag thresholds (single source of truth)

- **Problem:** A 0.2 lb daily delta shows "LOSING FAST"; thresholds are wrong and may be duplicated across Weight log and Analytics.
- **Scope:** Locate pacing classifier (likely `mobile/lib/format.js` or `mobile/lib/data.js`); set bidirectional bands vs. yesterday's reading: `|Δ| ≥ 1.5 lb` → yellow, `|Δ| ≥ 2.3 lb` → red. Ensure Weight log and Analytics call the same function.
- **Out of scope:** 7-day-avg pacing, goal-direction-aware bands.
- **Acceptance:** 0.2 lb = no flag; 1.6 lb either direction = yellow; 2.4 lb either direction = red; Weight + Analytics show identical flag for same data; unit tests at boundaries.
- **Agent:** `agent:claude`, `reasoning:medium`

### 2.2 — Implement Kilo max per Epley-average × fatigue spec

- **Problem:** Kilo max equals 1RM max because the spec formula is not implemented.
- **Scope:** Per session, per exercise: for each non-warmup, non-skipped set compute Epley `weight × (1 + reps/30)`; average across all sets (drop sets each count individually); multiply by `kilo_fatigue_multiplier` (default 1.07); round to whole number. Store both raw average and adjusted; display adjusted as primary, raw on tap.
- **Out of scope:** Settings UI for multiplier (Task 2.3), card layout changes.
- **Acceptance:** Verified against the worked example (Squat 245×5,5 / 240×8,8 → adjusted ≈ 310); excludes warmups + skipped sets; Kilo max ≠ 1RM max for multi-set sessions; unit tests cover the example, single-set, all-warmup, and all-skipped cases.
- **Agent:** `agent:claude`, `reasoning:high`

### 2.3 — Surface fatigue multiplier setting in More tab

- **Problem:** 1.07 should be tunable but not prominent.
- **Scope:** Add `kilo_fatigue_multiplier` setting in the More tab (`mobile/screens/...` for More, or `src/screens/more.jsx` mobile path), tucked under an advanced/secondary section; default 1.07; persists via existing storage; feeds Task 2.2's calculation.
- **Out of scope:** Other settings, More-tab redesign.
- **Acceptance:** Setting persists across reload; Kilo max recalculates on change; default remains 1.07; placement is unobtrusive.
- **Agent:** `agent:gemini`

---

## Phase 3 — Workout Notebook + Track Pipeline

**Goal:** Land the multi-routine "notebook" model and wire Track into progressive-overload analytics.
**Why now:** Nav and math are stable; structural data changes can happen without re-fighting Phase 1/2. Phase 4's nav targets need Phase 3's data to point at something real.
**Exit condition:** Multiple titled notes/routines persist; one is designated current; switching prompts confirmation; Analytics strength view re-scopes to current routine while preserving per-lift history; Track persists per-lift globally and tracked lifts appear in Analytics.

### 3.1 — Multi-note storage model + migration

- **Problem:** Storage only holds one note.
- **Scope:** `mobile/storage` / `mobile/lib/data.js` — convert single-note shape to a list of `{ id, title, body, isCurrent }`. Migration: existing single note becomes one entry titled "Routine 1" (or filename-derived) with `isCurrent: true`. No UI in this task.
- **Out of scope:** UI (Task 3.2), confirmation prompt (Task 3.3).
- **Acceptance:** Existing user data round-trips without loss; legacy single-note loads as current routine; tests cover migration and shape.
- **Agent:** `agent:claude`, `reasoning:high`

### 3.2 — Notes list UI + collapsed non-current routines

- **Problem:** No way to view or manage multiple routines.
- **Scope:** `mobile/screens/LogScreen.js` — render current routine in full (parsed workout view, unchanged); render all other routines as collapsed title-only rows at the bottom; tap-to-expand opens raw editor for that note; allow add / rename / delete.
- **Out of scope:** Set-as-current logic (Task 3.3), typography fixes (Phase 5).
- **Acceptance:** Can create, title, edit, delete multiple notes; non-current notes show only title; tapping a collapsed note opens its raw editor.
- **Agent:** `agent:gemini`

### 3.3 — "Set as current routine" with confirmation prompt

- **Problem:** No way to switch which routine is current.
- **Scope:** Add an action on each non-current note to mark it current; confirmation modal ("Switch current routine to `<title>`? Analytics will re-scope."); on confirm, flip `isCurrent` flags; Log tab re-renders new current routine in full view.
- **Out of scope:** Analytics re-scope behavior (Task 3.5 covers it).
- **Acceptance:** Exactly one note is current at all times; confirmation appears every switch; cancel preserves prior state; confirming the switch records a real `currentSince` timestamp for the newly current routine.
- **Agent:** `agent:gemini`

### 3.4 — Track button → global tracked-lift persistence

- **Status:** Shipped in Issue #121.

- **Problem:** Track is currently disabled (Task 1.4); needs real persistence.
- **Scope:** Re-enable Track in `mobile/screens/LogScreen.js`; toggling persists a global `tracked: true` flag keyed by normalized lift name (lowercase, trim, collapse internal whitespace); helper to list tracked lifts.
- **Out of scope:** Analytics rendering (Task 3.5).
- **Acceptance:** Toggle persists across reload; name normalization treats "Bench Press" / "bench press" / " Bench  Press " as one lift; tests cover normalization.
- **Agent:** `agent:claude`, `reasoning:medium`

### 3.5 — Strength analytics: routine-scoped visibility, lift-continuous trends

- **Status:** Shipped in Issue #129.

- **Problem:** Tracked lifts have nowhere to surface; Analytics doesn't react to current routine.
- **Scope:** Extend Analytics strength section (cards from #109) to render one card per tracked lift that also appears in the current routine. Each card's overload trend pulls all historical data for that lift name regardless of which routine logged it. Tracked-but-not-in-current-routine lifts are hidden (data preserved).
- **Out of scope:** Card redesign, new chart types, weight-section changes.
- **Acceptance:** A lift toggled Track + present in current routine appears as a card; switching current routine immediately changes which cards are visible; per-card trend includes data across routines; un-tracking removes the card; re-tracking restores full history.
- **Agent:** `agent:claude`

---

## Phase 4 — Information Architecture & Structural Fixes

**Goal:** Make navigation and layout honest now that the data beneath them is correct.
**Why now:** Phase 3 features mean the new nav targets actually have something to show. Doing IA before pure visual polish prevents polishing screens whose structure will change.
**Exit condition:** Tile click regions match spec; Log shows one section per day; Analytics tab entry is flicker-free.

### 4.1 — Scoped Home tile click regions

- **Problem:** Whole cards are tappable; only specific regions should navigate.
- **Scope:** `mobile/screens/HomeScreen.js` — remove card-level Pressable; add scoped Pressables on "7-day rolling average" (→ Analytics weight section) and 1k Club total (→ Analytics strength section). Remove the "current workout progress" line from the 1k Club bubble.
- **Out of scope:** Card visuals, header (Task 4.2).
- **Acceptance:** Non-target areas don't navigate; target regions land on the correct Analytics sub-section.
- **Agent:** `agent:gemini`

### 4.2 — Home header + copy pass

- **Problem:** "Dashboard" text title; wrong subheader; wrong tile name; Total Weeks tile going away.
- **Scope:** Replace "Dashboard" with Kilo title image from `mobile/assets/brand`; subheader → "Current Routine Progress"; rename "1,000 lb Club" → "1k Club Progress"; remove the Total Weeks tile (replacement in Task 4.3).
- **Out of scope:** "Weeks In" tile (Task 4.3), global layout shift (Phase 5).
- **Acceptance:** Header renders the brand image responsively; copy matches spec; no broken image fallback.
- **Agent:** `agent:gemini`

### 4.3 — Add "Weeks In" tile (no deload coloring)

- **Problem:** Total Weeks is being removed; need a tile that conveys progress in current routine.
- **Scope:** `mobile/screens/HomeScreen.js` — new "Weeks In" tile showing weeks elapsed since the current routine was designated. Plain neutral styling — **no deload color coding** (deferred to backlog issue #92).
- **Out of scope:** Deload detection or coloring (issue #92).
- **Acceptance:** Counter starts at 1 the day current routine is set; advances weekly; resets on current-routine switch; styling neutral.
- **Agent:** `agent:gemini`

### 4.4 — Log tab: unify warmup + lifting per day

- **Problem:** Warmup and lifting render as separate day sections, producing duplicate Mondays/Tuesdays/etc.
- **Scope:** Day-grouping logic in `mobile/screens/LogScreen.js` and/or `mobile/lib/parser.js`; merge warmup + lifting into a single section per calendar day with clear subheads.
- **Out of scope:** Typography fixes (Phase 5).
- **Acceptance:** For sample weeks with mixed warmup/lifting, each weekday appears exactly once; warmup sets clearly delineated within the day; parser tests updated; empty days and double-session days handled.
- **Agent:** `agent:claude`, `reasoning:high`

### 4.5 — Eliminate Analytics tab-entry flicker

- **Problem:** Visible flash when entering Analytics.
- **Scope:** `mobile/screens/StatsScreen.js` — find mount-time layout shift or loading-state flash; stabilize via correctly-sized skeleton or state-ordering fix.
- **Out of scope:** New analytics, card redesign.
- **Acceptance:** No visible flash on mid-range Android, verified by screen recording.
- **Agent:** `agent:gemini`

---

## Phase 5 — Polish & Affordance Pass

**Goal:** Final visual + interaction polish across all tabs.
**Why last:** Underlying structure and data are settled; polish edits will not be redone.
**Exit condition:** Every visual item from the brief is addressed; the "first" label is grounded in code reality and renamed.

### 5.1 — Bottom tab bar softening [DONE]

- **Problem:** Tab bar visually overpowers content.
- **Scope:** `mobile/components/TabBar.js` styling — translucent / faded treatment; preserve hit areas and active-state contrast.
- **Acceptance:** Bar reads as subtler; active tab still clearly indicated.
- **Agent:** `agent:gemini`

### 5.2 — Global content vertical offset [DONE]

- **Status:** Shipped in Issue #136.

- **Problem:** Content sits too low from the top.
- **Scope:** `mobile/components/ScreenShell.js` top padding / safe-area; applied once at the shell, not per-screen.
- **Acceptance:** Consistent upward shift across all four tabs; no notch/status-bar clipping on notched device.
- **Agent:** `agent:gemini`

### 5.3 — Weight log: Save button sizing + color

- **Status:** Shipped in Issue #137.

- **Problem:** Buttons too large and black.
- **Scope:** `mobile/screens/WeightScreen.js` button styles only.
- **Acceptance:** Buttons sized like other primary actions; no raw black; palette-aligned.
- **Agent:** `agent:gemini`

### 5.4 — Weight log: date display format MM-DD-YYYY [DONE]

- **Status:** Shipped in Issue #138.

- **Problem:** Dates show YYYY-MM-DD.
- **Scope:** `mobile/lib/format.js` display-layer formatter; storage stays ISO.
- **Acceptance:** All visible dates in Weight log render MM-DD-YYYY; storage unchanged; tests updated.
- **Agent:** `agent:claude`, `reasoning:medium`

### 5.5 — Weight log: native date picker for target date [DONE]

- **Status:** Shipped in Issue #139.

- **Problem:** Target date has no picker.
- **Scope:** `mobile/screens/WeightScreen.js` target-date field uses native date picker; on select, stores ISO and displays MM-DD-YYYY (depends on Task 5.4).
- **Acceptance:** Tap opens picker; selection persists; display format correct.
- **Agent:** `agent:gemini`

### 5.6 — Weight log: Goal + suggestion prominence

- **Problem:** Goal is buried; suggestion numbers (target gain/week, calorie surplus) too small.
- **Scope:** Visual hierarchy pass in `mobile/screens/WeightScreen.js`; pull Goal up or highlight inside panel; increase suggestion-number type weight/size.
- **Acceptance:** Goal and the two key suggestion numbers dominate their regions; no small-screen regressions.
- **Agent:** `agent:gemini`

### 5.7 — Log tab typography normalization

- **Problem:** Font sizes oscillate; some entries become italicized mid-list.
- **Scope:** Consolidate exercise/set row text styles in `mobile/screens/LogScreen.js`; one source of truth for set-line typography.
- **Acceptance:** Set rows render uniformly across a sample week; no spurious italics.
- **Agent:** `agent:gemini`

### 5.8 — Investigate "first" label semantics (spike)

- **Problem:** The label "first" in Analytics is unclear; even Ben isn't sure what it represents.
- **Scope:** Read-only investigation in `mobile/screens/StatsScreen.js` and supporting `mobile/lib/data.js`; identify what value the "first" label currently displays and how it's computed; report findings as an issue comment with file/line references and a recommended replacement label. No code changes.
- **Acceptance:** Issue comment posted stating exactly what "first" represents in current code and a recommended replacement label awaiting Ben's confirmation.
- **Agent:** `agent:codex`

### 5.9 — Rename "first" label based on investigation

- **Problem:** Label remains unclear until renamed.
- **Scope:** `mobile/screens/StatsScreen.js` label string only; uses the replacement approved after Task 5.8.
- **Acceptance:** Label reads unambiguously in context.
- **Agent:** `agent:gemini`

---

## Cross-cutting notes

- Backlog issue **#92** owns deload-week detection and color coding for the "Weeks In" tile. Task 4.3 ships neutral styling; #92 layers the coloring on later.
- Strength analytics scope model (Phase 3): tracked lifts are global; visibility is filtered by current routine; per-lift trends are continuous across routine changes. Removing a lift from the current routine hides its card but preserves the data; re-adding restores full history.
- Version bumps and `CHANGELOG.md` updates are handled at issue close per the policy in `AGENTS.md` — not pre-decided here.

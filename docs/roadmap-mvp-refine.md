# Kilo App State Assessment — 2026-05-28

## Executive Summary

Kilo is a local-only fitness tracking app at **v0.46.3** with strong core functionality and 751 passing tests. The app works — weight logging, workout parsing, analytics, and multi-routine notebooks are all functional. But the codebase is accumulating structural debt that will make the next round of feature work harder and buggier:

1. **HomeScreen.js is a 1401-line monolith** packing 6 components (Home + More + Profile + Backup + Settings + Help + About) into one file, with an expensive dashboard memo that re-parses all notes on every render.
2. **parser.js has 80 lines of duplicated signal logic** (`deriveProgressionSignals` and `derivePerDaySignals` are near-identical), creating a divergence risk that already bit us in #207.
3. **The browser prototype is dead weight** — tests, code, and build pipeline for a frozen reference path that adds maintenance cost with zero value.
4. **LogScreen's double-tap-to-edit is undiscoverable** — it's the only way to enter edit mode and relies on a 300ms debounce with a tiny hint line.

The open issues are mostly valid, but the priority should be **stability and structural cleanup before new features**. The app needs to get simpler before it gets bigger.

---

## 1. Current Working State

### Functional core flows
- **Weight logging**: save/edit/delete with validation, rolling 7-day and 30-day averages, pace classification (gaining/losing/stable/spike), weight goal tracking with calorie estimates
- **Workout logging**: freeform text editor with structured parsing (multi-load sets, bodyweight reps, skip markers), multi-routine notebook model with create/rename/delete
- **Analytics**: progressive overload tracking with routine-day grouping, per-exercise trend arrows, cross-day comparison for multi-day exercises, 1K Club progress, searchable exercise filtering
- **Home dashboard**: redesigned hero layout with weekly summary, weight sparkline, goal panel, 1K Club card
- **Data management**: local backup/restore with versioning, fatigue multiplier persistence, tracked lift toggles
- **Parser**: robust numeric format parsing with 270+ unit tests covering edge cases

### Solid infrastructure
- **751 mobile tests passing** (parser, data, storage, format, stats-screen, weight-goal-ui)
- **836 browser tests archived** (parser, weight-UI, log-UI) — removed from active pipeline in #213
- Clean pub/sub hook architecture for cross-tab state updates
- Well-documented architecture, persistence model, and design tokens
- Active OTA update pipeline via EAS for Android preview builds

### Recently shipped (last 48h)
- #207: Fixed PO arrow regression in analytics
- #206: Rounded weeks-left display
- #205: Per-day signal plumbing for multi-day exercises
- #203: Fixed Home weight sparkline render
- #198: Major Analytics PO redesign with routine-day grouping

---

## 2. Current Broken / Regressed State

### Confirmed issues
- ~~**Vitest picks up mobile Jest test files**: resolved in #208; vitest and browser test infrastructure removed entirely in #213.~~
- **Tab-switch flicker** (#204): intermittent visual flicker on all main tabs except More, most visible on Stats. Likely caused by full screen remount on tab switch in `App.js`. User-visible UI defect.

### Documented gaps (acceptable per current-state.md)
- No Supabase backend / no cloud sync / no auth
- Native UI narrower than browser prototype in some areas
- No automated UI flow tests (only unit/logic tests)
- `KILO_TODAY` reference removed from mobile (was previously hardcoded) — appears resolved

### Stale doc references to clean up
- `docs/current-state.md` references `KILO_TODAY` hardcode that no longer exists in the mobile codebase
- "Seeded sessions lacking canonical items field" mentioned in docs — not a real issue, remove

---

## 3. Roadmap / Issue Alignment

### 11 open issues assessed:

| # | Title | Verdict | Rationale |
|---|-------|---------|-----------|
| **204** | Tab-switch flicker | **Keep** | Valid bug, well-scoped, ready for Gemini |
| **202** | Scope More surface radius cleanup | **Keep** | Valid planning task for Codex, small |
| **200** | Weight tab visual consistency cleanups | **Keep** | Valid UI polish from #189 review, ready for Gemini |
| **166** | Render non-weighted tracked-exercise cards | **Keep** | Valid feature, depends on #165 |
| **165** | Derive non-weighted tracked-exercise card metrics | **Keep** | Valid feature for Claude, self-contained |
| **92** | Session-count signifier colors | **Keep, but deprioritize** | Nice-to-have UI polish, open 9 days with no activity. Not blocking anything. |
| **91** | Routine/Deload toggle + Generate deload + editable view | **Hold** | Blocked by #90, user defers for stability |
| **90** | Deload-week generation engine | **Hold** | User defers deload work for stability |
| **87** | Tidy OTA strategy docs | **Close** | Fold content into #63 as a comment |
| **63** | Enable OTA for iOS | **Keep on hold** | Blocked on Apple Developer account |

### Gaps — issues that should exist but don't

1. ~~**Vitest config: exclude mobile/tests/**: resolved in #208; vitest removed in #213.~~
2. **Stale docs cleanup**: `docs/current-state.md` references `KILO_TODAY` hardcode that no longer exists. Several superseded roadmap docs (`mvp-roadmap.md`, `v2`, `v3`, `v3.5`) still in the repo. Low priority but adds confusion.
3. **No issue for More screen file ownership resolution outcome**: #202 is planning to determine where the More surface lives, but the implementation issue hasn't been created yet. This is expected — #202 will produce it.

---

## 4. Architecture / Maintainability Concerns

### High concern

- **HomeScreen.js is a 1401-line monolith**: Contains HomeScreen (229 lines), MoreScreen, ProfileScreen (270 lines), BackupScreen, SettingsScreen, HelpScreen, and AboutScreen. These share no state. MoreScreen receives props (`onExport`, `onImport`, `fatigueMultiplier`) that HomeScreen doesn't use, inflating the prop contract. Every change to More risks HomeScreen and vice versa.

- **Signal derivation duplication in parser.js**: `deriveProgressionSignals` (lines 590-670) and `derivePerDaySignals` (lines 684-765) are ~80 lines each with near-identical logic for building comparables, finding latest/prior indices, computing bodyweight fallbacks, and calculating trend. The per-day version was added in #205 and immediately caused a regression (#207) when the copies diverged. This will happen again.

- **HomeScreen re-parses all notes on every render**: The `dashboardData` useMemo (lines 61-102) calls `parseWorkoutNote()` on every note in the notebook to build `allSections`, then derives signals and overload counts. This runs on the most-visited screen and is gated only by the `notes` reference changing. Any note save triggers a full reparse of the entire notebook.

### Medium concern

- **Full remount on tab switch** (`App.js`): Each tab switch remounts the screen component. This causes the flicker (#204) and loses scroll position. The Stats screen is worst because its loading guard briefly renders a placeholder during remount.

- ~~**Browser prototype is dead weight**: archived in #213. `src/`, `Kilo.html`, `tests/` moved to `docs/archive/browser-prototype/`; Capacitor shell and vitest removed.~~

- **LogScreen's double-tap is undiscoverable**: The only way to enter edit mode on the current routine is a 300ms double-tap (line 54-60) with a small "Double-tap to edit" hint (line 540). No explicit Edit button exists. Users will try single-tap first and get confused.

### Low concern

- **useEntries.js pub/sub has no error handling**: Listeners are called in a bare `forEach` (e.g., `goalListeners.forEach(l => l())`). One throwing listener breaks notification for all subsequent listeners. Low probability but catastrophic if it happens.

- **StatsScreen sticky header index is hardcoded**: `stickyHeaderIndices={[4]}` (line 206) assumes a fixed layout order. Adding/removing a section above it silently breaks the sticky behavior.

- **Three overlapping name normalizations**: `_normalizeExerciseName` (parser.js), `canonicalizeName` (parser.js), and `normalizeLiftName` (data.js) are applied inconsistently across call sites. Most paths do `normalizeLiftName(canonicalizeName(name))` but some skip `canonicalizeName`.

---

## 5. Recommended Next Actions

Priority: **stability and structural cleanup first, then features.** The app works but is accumulating complexity debt that makes every subsequent change riskier.

### Phase 1: Structural cleanup (do before new features)

**1. Extract MoreScreen from HomeScreen.js** — Gemini or Claude
- HomeScreen.js is 1401 lines with 6 components. MoreScreen + its 5 sub-screens (Profile, Backup, Settings, Help, About) account for ~700 lines and share zero state with HomeScreen.
- Extract to `mobile/screens/MoreScreen.js` (or a `more/` directory).
- This is the single biggest maintainability win available. Every future change to Home or More currently risks the other.

**2. Deduplicate deriveProgressionSignals / derivePerDaySignals** — Claude
- `parser.js` lines 590-670 and 684-765 are near-identical 80-line functions. The per-day version was added in #205 and already caused a regression in #207 because the two copies diverged.
- Extract the shared comparable-building and trend-comparison logic into a `_deriveSignalForComparables(comparable)` helper. Both functions call it.
- This prevents the next signal-related bug.

**3. Remove the browser prototype from the test pipeline** — Claude
- ~~Browser prototype tests archived and vitest removed in #213.~~

**4. Fix tab-switch flicker (#204)** — Gemini
- Confirmed still present on device. The full remount on tab switch in `App.js` causes visible flicker, worst on Stats.
- This is the most user-visible defect in the app right now.

### Phase 2: Targeted hardening

**5. Add search debounce to StatsScreen** — Gemini
- Exercise search (line 334) filters on every keystroke with no debounce. With 50+ tracked exercises, this triggers expensive `groupedSignals` recomputation constantly. 300ms debounce is a one-line fix.

**6. Address HomeScreen dashboard memo cost** — Claude
- Lines 61-102: `dashboardData` useMemo re-parses ALL workout notes (`notes.flatMap(n => parseWorkoutNote(n.raw_text).sections)`) on every render when any dependency changes. This is the most expensive computation in the app and runs on the most frequently visited screen.
- Consider: caching parsed sections at the note level (parse once on save, not on every Home render), or splitting the memo into smaller independent memos so unrelated changes don't trigger full recomputation.

**7. LogScreen nudge persistence** — Claude
- Dismissed rep-drop-off nudges are stored in component state (line 35). Navigating away and back re-shows them. Either persist to AsyncStorage or accept this as intentional.

### Phase 3: Open issue work (after stability)

**8. #202: Scope More surface radius** — Codex (quick planning, may be resolved by Phase 1 extraction)

**9. #200: Weight tab visual consistency** — Gemini

**10. #165 then #166: Non-weighted tracked-exercise cards** — Claude then Gemini (data layer first, then UI)

**11. #92: Session-count signifier colors** — Gemini (low priority, pick up in gaps)

### On hold (user decision)

- **#90, #91: Deload engine + UI** — User intentionally deferring for stability. Do not queue.
- **#63: iOS OTA** — Blocked on Apple Developer account.
- **#87: OTA docs cleanup** — Close, fold into #63 as a comment.

### Housekeeping (no separate issue needed)

- Update `docs/current-state.md` to remove stale `KILO_TODAY` and "seeded sessions items field" references
- Archive or annotate superseded roadmap docs (`mvp-roadmap.md`, `v2`, `v3`, `v3.5`) — only `v4.5` is active

---

## Specific Issue Recommendations

| # | Action | Notes |
|---|--------|-------|
| 204 | **Keep** | High priority bug, ready for Gemini |
| 202 | **Keep** | Quick Codex planning task |
| 200 | **Keep** | Ready for Gemini after #202 |
| 166 | **Keep** | Blocked by #165 |
| 165 | **Keep** | Ready for Claude |
| 92 | **Keep, deprioritize** | Nice-to-have, pick up in gaps |
| 91 | **Hold** | Blocked by #90, user defers for stability |
| 90 | **Hold** | User defers deload work for stability |
| 87 | **Close** | Fold content into #63 as a comment |
| 63 | **Keep on hold** | Blocked on external dependency |

---
---

# MVP Refine Roadmap

Status: active. Stability and structural cleanup pass before new feature work.

This roadmap starts after MVP4.5 and addresses accumulated structural debt
that makes every subsequent change riskier:

- large files packing unrelated components together
- duplicated derivation logic that has already caused regressions
- dead prototype code adding maintenance cost
- undiscoverable UX patterns
- fragile hardcoded layout assumptions

This pass follows a few strict rules:

- structural cleanup comes before new features
- no behavior changes during extraction/dedup work
- each task is scoped to the minimum files needed
- verification is test suite + manual spot-check, not broad regression sweep

Issue-label policy for this pass:

- every MVP Refine issue must include the label `mvp-refine`
- keep issue scope narrow enough for a single implementation session
- prefer `reasoning:medium` per repo policy

Agent routing follows repo policy:

- `agent:gemini` for frontend / UI implementation
- `agent:claude` for backend / data / parser / logic implementation
- `agent:codex` for planning, review, and issue writing

---

## Tracker Cleanup Before MVP Refine Implementation

- `#63` — leave on hold outside MVP Refine. iOS OTA remains blocked on Apple
  Developer account.
- `#87` — close, fold content into `#63` as a comment. Not worth a standalone
  issue.
- `#90` / `#91` — leave on hold. Deload is explicitly deferred for stability.
- `#92` — defer to post-refine. Session-count signifier is polish, not
  stability.
- `#165` / `#166` — defer to Phase 3. Non-weighted tracked-exercise cards are
  feature work that should follow structural cleanup.
- `#200` / `#202` — defer to Phase 3. Weight tab polish and More surface
  planning are UI work that should follow the MoreScreen extraction.
- `#204` — include in Phase 1. Tab-switch flicker is a user-visible stability
  defect.

---

### Phase 1: Structural Cleanup

Phase goal: reduce file complexity, remove duplication, and eliminate dead code
so subsequent work is safer and faster.

Completion condition: the four largest structural risks are resolved, test suite
runs clean with no false failures.

Ordered tasks:

#### Task 1: Fix vitest config to exclude mobile Jest test files — COMPLETE

- **Issue:** `#208` (closed)
- Resolved; vitest and browser test infrastructure subsequently removed in #213.

#### Task 2: Extract MoreScreen and sub-screens from HomeScreen.js

- **Issue:** `#210`
- **Goal:** split the 1401-line HomeScreen.js into two focused files by moving
  MoreScreen + 5 sub-screens (Profile, Backup, Settings, Help, About) into
  their own file.
- **Scope:** pure extraction — move ~700 lines to
  `mobile/screens/MoreScreen.js`, update the import in `App.js`. No behavior
  or styling changes.
- **Verification:** `npm --prefix mobile test` passes; Home and More tabs
  render correctly; Android back button unchanged.
- **Labels:** `mvp-refine`, `agent:claude`, `area:ui`, `type:implementation`,
  `effort:default`, `reasoning:medium`

#### Task 3: Deduplicate deriveProgressionSignals and derivePerDaySignals

- **Issue:** `#211`
- **Goal:** extract the shared comparable-building and trend-comparison logic
  into a single helper so signal changes only need to happen once.
- **Scope:** create `_deriveSignalForComparables(comparable)` in parser.js;
  refactor both functions to call it. No changes to public API or return
  shapes.
- **Verification:** `npm --prefix mobile test` passes (especially data.test.js
  and stats-screen.test.js); Analytics PO section renders identical metrics.
- **Labels:** `mvp-refine`, `agent:claude`, `area:parser`,
  `type:implementation`, `effort:default`, `reasoning:medium`

#### Task 4: Archive browser prototype source and test files — COMPLETE

- **Issue:** `#213` (closed)
- Browser prototype source, tests, and `Kilo.html` moved to
  `docs/archive/browser-prototype/`. Capacitor shell, vitest config, and all
  browser-specific deps removed.

#### Task 5: Fix tab-switch flicker

- **Issue:** `#204`
- **Goal:** eliminate the intermittent visual flicker when switching between
  main app tabs.
- **Scope:** investigate the full-remount pattern in `App.js` and fix the
  rendering path that produces the flicker. Most likely a conditional-display
  or keep-alive pattern.
- **Verification:** switching between all main tabs no longer flickers; no
  tab-state regressions.
- **Labels:** `mvp-refine`, `agent:gemini`, `area:ui`, `type:bug`,
  `effort:default`

#### Task 6: Clean up stale doc references and archive superseded roadmaps

- **Issue:** `#209`
- **Goal:** remove stale references from `docs/current-state.md` and move
  superseded roadmap docs to `docs/archive/`.
- **Scope:** remove `KILO_TODAY` and "seeded sessions items field" references
  from `current-state.md`; move `mvp-roadmap.md`, `mvp-v2-roadmap.md`,
  `mvp-v3-roadmap.md`, `mvp-v3.5-roadmap.md`, `mvp-v4-roadmap.md` to
  `docs/archive/`.
- **Verification:** `docs/current-state.md` has no references to removed
  features; archived docs are intact.
- **Labels:** `mvp-refine`, `agent:claude`, `area:docs`,
  `type:implementation`, `effort:default`, `reasoning:medium`

---

### Phase 2: Targeted Hardening

Phase goal: fix performance, UX discoverability, and fragility issues that
don't require structural changes but reduce app quality.

Completion condition: no silent performance traps on the main screen, no
undiscoverable edit patterns, no hardcoded layout assumptions.

Ordered tasks:

#### Task 7: Reduce HomeScreen dashboard memo cost

- **Issue:** `#212`
- **Goal:** stop re-parsing every workout note on every Home render by
  splitting or caching the expensive computation.
- **Scope:** separate the `allSections` parse into its own useMemo gated only
  on `notes`, or cache parsed sections at the note level. No changes to what
  the dashboard displays.
- **Verification:** `npm --prefix mobile test` passes; Home dashboard renders
  identical data.
- **Labels:** `mvp-refine`, `agent:claude`, `area:ui`,
  `type:implementation`, `effort:default`, `reasoning:medium`

#### Task 8: Add explicit Edit button to LogScreen current routine

- **Issue:** `#214`
- **Goal:** make edit mode discoverable without relying solely on the
  double-tap gesture.
- **Scope:** add a small Edit button to the current routine card header;
  calls existing `enterCurrentEditor()`. Double-tap remains as power-user
  shortcut. Respect Log tab style lock.
- **Verification:** Edit button visible in read mode, enters edit mode on tap,
  hidden in edit mode, double-tap still works.
- **Labels:** `mvp-refine`, `agent:gemini`, `area:ui`,
  `type:implementation`, `effort:default`

#### Task 9: Add error handling to useEntries.js pub/sub listeners

- **Issue:** `#215`
- **Goal:** prevent one failing listener from silently breaking state updates
  for all subsequent listeners.
- **Scope:** wrap each listener call in try-catch within notify functions; log
  caught errors to `console.warn`.
- **Verification:** `npm --prefix mobile test` passes; all tabs refresh when
  data changes.
- **Labels:** `mvp-refine`, `agent:claude`, `area:workouts`, `type:bug`,
  `effort:default`, `reasoning:medium`

#### Task 10: Make StatsScreen sticky header index dynamic

- **Issue:** `#216`
- **Goal:** replace the hardcoded `stickyHeaderIndices={[4]}` with a dynamic
  calculation based on rendered section order.
- **Scope:** compute the index from actual children or use a ref-based
  approach. No visual changes.
- **Verification:** Analytics search bar sticks on scroll (same behavior as
  today).
- **Labels:** `mvp-refine`, `agent:gemini`, `area:ui`, `type:bug`,
  `effort:default`

#### Task 11: Normalize exercise name canonicalization across call sites

- **Issue:** `#217`
- **Goal:** ensure every call site that normalizes an exercise name uses the
  same chain, eliminating silent key mismatches.
- **Scope:** audit all normalization call sites in `parser.js` and `data.js`;
  optionally create a single `normalizeExerciseKey(name)` that composes
  `normalizeLiftName(canonicalizeName(name))`.
- **Verification:** `npm --prefix mobile test` passes; exercises with known
  aliases appear correctly in Analytics.
- **Labels:** `mvp-refine`, `agent:claude`, `area:parser`, `type:bug`,
  `effort:default`, `reasoning:medium`

#### Task 12: Update living docs to reflect MVP Refine structural changes

- **Issue:** `#218`
- **Goal:** update repo living docs so they accurately describe the codebase
  after Phases 1–2 complete.
- **Scope:** review and update only the sections affected by Phase 1–2 changes:
  - `docs/current-state.md` — shipped status, known gaps
  - `docs/architecture.md` — file paths, data flow, parse/persist diagram
  - `docs/repo-structure.md` — file map (new/moved/removed files)
  - `docs/testing-and-qa.md` — test inventory after browser test removal
- **Verification:** no references to removed files or pre-refine structure
  remain in updated sections.
- **Labels:** `mvp-refine`, `agent:claude`, `area:docs`,
  `type:implementation`, `effort:default`, `reasoning:medium`

---

### Phase 3: Feature And Polish Work

Phase goal: resume feature and polish work from the open backlog once
structural stability is established.

Completion condition: remaining open UI polish and feature issues are resolved.

Ordered tasks:

#### Task 13: Scope More surface radius cleanup

- **Issue:** `#202`
- **Goal:** determine actual file ownership for the More surface menu-radius
  fix and produce a precise implementation contract.
- **Note:** may be trivially resolved by Task 2's MoreScreen extraction.
- **Labels:** `mvp-refine`, `agent:codex`, `area:ui`, `type:planning`,
  `effort:default`, `reasoning:medium`

#### Task 14: Implement Weight tab visual consistency cleanups

- **Issue:** `#200`
- **Goal:** apply the Weight tab visual consistency cleanups identified in the
  `#189` design review.
- **Labels:** `mvp-refine`, `agent:gemini`, `area:ui`, `area:weight`,
  `type:implementation`, `effort:default`

#### Task 15: Derive non-weighted tracked-exercise card metrics

- **Issue:** `#165`
- **Goal:** compute analytics metrics for non-weighted tracked exercises
  (bodyweight, timed, etc.) so they can be rendered as cards.
- **Labels:** `mvp-refine`, `agent:claude`, `area:workouts`,
  `type:implementation`, `effort:default`, `reasoning:medium`

#### Task 16: Render non-weighted tracked-exercise cards

- **Issue:** `#166`
- **Depends on:** Task 15 (`#165`)
- **Goal:** render the non-weighted tracked-exercise cards using metrics from
  Task 15.
- **Labels:** `mvp-refine`, `agent:gemini`, `area:ui`,
  `type:implementation`, `effort:default`

#### Task 17: Session-count signifier colors on Analytics and Home

- **Issue:** `#92`
- **Goal:** add yellow (7–9 sessions) and red (10–12 sessions) color signifiers
  to session counts on Analytics and Home.
- **Labels:** `mvp-refine`, `agent:gemini`, `area:ui`,
  `type:implementation`, `effort:default`

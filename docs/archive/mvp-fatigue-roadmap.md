# Kilo Fatigue Check-In Feature Plan — 2026-06-04

## Executive Summary

Kilo logs *what* you did but says nothing useful when a session goes sideways. The only
reactive signal today is a cold per-exercise chip — "Last time you hit a wall — stay at this
weight" (`formatRepDropOffNudge`) — that fires on a narrow intra-session rep-drop rule and
that the user dislikes.

This roadmap replaces that chip with a **session check-in**: when a freshly logged session
shows a rough pattern, the offending exercises are **highlighted red** in the routine view and
a **contextual popup** asks what's going on ("Exercises skipped — you okay?" / "Big volume
drop — you okay?"). The user can wave it off ("I'm fine — no time") or report a real cause
(fatigue, shoulder pain, etc.). Answers are logged and surfaced in a new **Fatigue section in
Analytics** that tracks the date, the issues logged, exercises skipped, and how much volume
declined. v1 logs and reports only — no deload or fatigue-multiplier automation.

The work is sequenced **data/parser first, UI second**, so the UI builds against a stable
detection API. It is feature work (a new MVP-visible capability), so it lands after the MVP
Refine structural pass.

---

## 1. Why Now / Problem

- The "hit a wall" chip is disliked, prescriptive, and narrow. It is the wrong response to a
  rough day and the user wants it gone.
- Real training has off days — fatigue, pain, no time. The app should notice and ask, kindly,
  then remember the answer so patterns surface over time.
- There is currently **no place** that records *why* a session was rough, and no Fatigue
  surface in Analytics (only a "Fatigue setting in" caption on the Session gauge).

## 2. Current-State Facts (verified)

- Local `AsyncStorage` only. Workouts are freeform `raw_text` parsed by `parseWorkoutNote()`
  into `sections`. Sessions are **positional** (aligned by entry index), not dated — so the
  reliable calendar date for a logged issue is the **`responded_at`** timestamp at answer time.
- Reusable primitives in `mobile/lib/data.js`: `deriveWorkoutAnalytics`, `_occurrenceEntries`,
  `_classifyEntries`, `computeRepDropOff`, `deriveSkipData` (`exercise_skips` / `day_skips` /
  `attendance_flags`), `_totalRepsAtWeight`, `computeWeeksIn`. Canonical entry point
  `deriveWorkoutNoteAnalytics()` (`data.js:1119`). Note factory `makeWorkoutNoteItem()`
  (`data.js:592`).
- The chip to remove: `formatRepDropOffNudge` (`mobile/lib/format.js:65`), rendered at
  `mobile/screens/LogScreen.js:1196-1200, 1229-1236`.
- Parser gap: `parseWorkoutRow()` (`parser.js:47`) rejects a `-` rep token via
  `REP_RE = /^\d+(,\d+)*$/` (`parser.js:92`), so `80 4,-` degrades to `unparsed_rows` and reads
  as "inconsistent". Set-line render: `SetLine`.
- AnalyticsScreen sections today: Weight Trends, Session Health, Strength, Progressive
  Overload. No Fatigue section exists.
- **No training-volume (weight×reps) computation exists** anywhere — added here for reporting.

## 3. Detection Design (reference for the tasks)

`deriveSessionCheckIn(sections, trackedNames)` runs on the latest positional session
(`lastIdx = computeWeeksIn - 1`). For each tracked exercise with prior logged history, it runs
four detectors and tags the exercise with the reason(s) it triggered:

1. **Exercises skipped (relative to usual)** — latest skipped count exceeds the routine's usual
   skip rate (baseline avg + margin, absolute floor ≥2). Built on `deriveSkipData`.
2. **Big volume drop (rep collapse vs baseline)** — per working weight, compare reps to the
   exercise's baseline reps at that weight; count sets dropping **>2 reps**; a within-row
   skipped set counts as a full collapse. Flag when **≥2 such sets**
   (`REP_DROP_THRESHOLD = 2`, `MIN_COLLAPSED_SETS = 2`).
3. **Sets collapsed mid-set** — reuse `computeRepDropOff(entry.sets)` → flag on `'hit_wall'`.
4. **Whole day skipped** — `deriveSkipData().day_skips` where `session_index === lastIdx`.

Returns `{ sessionIndex, isRough, detectors[], flagged[{normName,name,reasons[]}],
metrics{exercises_skipped, volume_decline_pct} }`. `volume_decline_pct` = flagged-exercise
session tonnage Σ(weight×reps) vs recent baseline — reporting only. `detectors` drives the
popup message; multiple → combined message. A present `session_checkins[sessionIndex]`
suppresses re-prompting.

Note model gains `session_checkins: { [idx]: { status:'ok'|'rough', reasons[], note,
flagged[], detectors[], exercises_skipped, volume_decline_pct, responded_at } } | null`.

---

# MVP Fatigue Roadmap

Status: complete and historical. This roadmap defined the Session Check-In / Fatigue feature pass.

Rules for this pass:

- data, parser, and detection logic land before any UI consumes them
- detection is pure and unit-tested before it is wired to a screen
- each task is scoped to the minimum files needed for a single implementation session
- no behavior change to unrelated flows; the only removed behavior is the "hit a wall" chip
- verification is test suite + manual spot-check, not a broad regression sweep

Issue-label policy for this pass:

- every issue includes the label `mvp-fatigue`
- exactly one `agent:`, at least one `area:`, exactly one `type:` per repo policy
- `reasoning:medium` for `agent:claude` issues unless complexity warrants higher
- keep scope narrow enough for one implementation session

Agent routing for this pass:

- `agent:claude` for parser / data / detection / storage / docs **and the screen/component UI**
  — UI work is explicitly reassigned from `agent:gemini` to `agent:claude` for this pass at the
  user's direction (the repo default routes UI to Gemini; this pass overrides it).
- `agent:codex` for planning, review, and issue writing

---

### Phase 1: Detection Foundations (data + parser) — ✅ COMPLETE

Status: complete. All four tasks (`#262`–`#265`) merged to `main` and closed.

Phase goal: a stable, tested detection and storage API plus the parser support it needs, with
the old chip's data surface retired.

Completion condition (met): `deriveSessionCheckIn` (`data.js:972`), `deriveCheckInHistory`
(`data.js:1392`), the `session_checkins` model (`makeWorkoutNoteItem`, `data.js:605`), and
within-row skip parsing all exist and are unit-tested; `deriveWorkoutNoteAnalytics` no longer
emits `repDropOffFlags` and the note model no longer carries `rep_drop_off_flags` (the chip's
data surface is retired); `npm --prefix mobile test` is green.

Carry-over into Phase 2 (state left by Phase 1, drives the Task 5 scope below): the
rep-drop-off signal is dark but still wired against now-undefined data in **two** UI surfaces —
the LogScreen nudge chip and the AnalyticsScreen `⚠ Hit wall` badge — and the helpers
`getLatestRepDropOff` (`data.js:922`) and `formatRepDropOffNudge` (`format.js:66`) still exist.
Task 5 owns removing all of it.

Ordered tasks:

#### Task 1: Parse within-row skipped sets (`80 4,-`)

- **Issue:** `#262`
- **Goal:** make a `-` rep token inside a weighted rep group a valid *skipped set at that
  weight* instead of dumping the row to `unparsed_rows`.
- **Scope:** in `mobile/lib/parser.js`, allow `-` as a rep token in `parseWorkoutRow` (e.g.
  `80 4,-`, `80 -,8`); emit a set with `weight_value` kept, `rep_count: 0`, and a new optional
  `skipped: true` flag. Backward compatible (absent flag = real set). No other parse behavior
  changes.
- **Verification:** new parser tests for `80 4,-`, `80 -,8`, mixed groups, and that these no
  longer land in `unparsed_rows`; `npm --prefix mobile test` passes.
- **Labels:** `mvp-fatigue`, `agent:claude`, `area:parser`, `type:implementation`,
  `effort:default`, `reasoning:medium`

#### Task 2: Add `deriveSessionCheckIn` with the four detectors

- **Issue:** `#263` (depends on `#262`)
- **Goal:** a pure function that flags a rough latest session and which exercises/reasons
  triggered it.
- **Scope:** add `deriveSessionCheckIn(sections, trackedNames)` to `mobile/lib/data.js`
  implementing detectors 1–4 (skips relative to usual; rep-collapse >2 on ≥2 sets vs baseline,
  counting within-row skipped sets; intra-session collapse via `computeRepDropOff`; whole-day
  skip via `deriveSkipData`), with named tunable consts. Compute `metrics.volume_decline_pct`
  (tonnage). Reuse existing analytics primitives; no new O(n²) scans.
- **Verification:** unit tests — not-rough when latest ≈ baseline; volume_drop fires for
  `80 8,8`→`80 4,-` but not `8,8`→`6,6`; skips fire only above usual; collapse and day-skip
  cases; correct `flagged`, `reasons`, `detectors`, and `volume_decline_pct`.
- **Labels:** `mvp-fatigue`, `agent:claude`, `area:workouts`, `type:implementation`,
  `effort:heavy`, `reasoning:medium`

#### Task 3: Add `session_checkins` to the note model + storage; stop populating the chip flags

- **Issue:** `#264` (relates to `#263`)
- **Goal:** persist check-in answers and stop the rep-drop-off flag data from flowing so the
  chip goes dark — without breaking `LogScreen` (which still imports the helpers until Phase 2).
- **Scope:** extend `makeWorkoutNoteItem()` with the `session_checkins` shape (null-safe load)
  in `mobile/lib/data.js`; ensure it round-trips through `mobile/storage/entries.js`. Stop
  populating `rep_drop_off_flags` in `deriveWorkoutNoteAnalytics()` and the note model.
  **Do not delete** `formatRepDropOffNudge` / `getLatestRepDropOff` here — that removal is owned
  by Phase 2 Task 5 alongside the LogScreen render, so the app keeps compiling. Keep
  `computeRepDropOff` (internal input to Task 2). Grep and report all consumers for Task 5.
- **Verification:** unit tests for save/load round-trip and null-safe load on legacy notes;
  `npm --prefix mobile test` passes; app still compiles (no dangling imports).
- **Labels:** `mvp-fatigue`, `agent:claude`, `area:workouts`, `type:implementation`,
  `effort:default`, `reasoning:medium`

#### Task 4: Add `deriveCheckInHistory` for the Fatigue analytics section

- **Issue:** `#265` (depends on `#264`)
- **Goal:** shape the stored check-ins into the data the Analytics Fatigue section renders.
- **Scope:** add `deriveCheckInHistory(notes)` to `mobile/lib/data.js` returning a
  reverse-chron list `{ responded_at, status, reasons, exercises_skipped, volume_decline_pct,
  flagged }` plus a summary `{ total, top_reason }`.
- **Verification:** unit tests for ordering, summary tally, and empty state.
- **Labels:** `mvp-fatigue`, `agent:claude`, `area:workouts`, `type:implementation`,
  `effort:default`, `reasoning:medium`

---

### Phase 2: Check-In UI (depends on Phase 1) — ✅ COMPLETE

Status: complete. All four tasks (`#266`–`#269`) merged to `main` and closed. The shipped
behavior is live: the old chip is gone, `80 4,-` renders as `80 lb 4,-`, a rough session
highlights flagged exercises and opens `SessionCheckInModal` on editor exit, answers persist via
`session_checkins` and suppress re-prompts, and the Analytics Fatigue section shows the history.

Phase goal: surface the check-in on editor exit, highlight flagged exercises, capture the
answer, and present logged issues in Analytics.

Completion condition (met): a rough session highlights red + pops the contextual popup on exit,
answers persist and suppress re-prompts, the old chip is gone, `80 4,-` renders as `80 lb 4,-`,
and the Analytics Fatigue section shows the history.

Post-ship follow-ups (these refined the shipped surface without changing the Phase 2 data model
or edit path; they are the current contract docs must describe):

- `#272` — refined the Analytics fatigue UX (collapsible card, rough/ok/pending row edit
  affordances, unanswered-check-in badge) while preserving the same `session_checkins` data model
  and edit path.
- `#274` — fixed skipped-session placeholder rendering in clean workout-note views so within-row
  and bare skips position correctly.
- `#275` — added targeted `AnalyticsScreen` fatigue interaction coverage (collapse/expand cycle,
  row/chip edit affordances, pending badge).

Ordered tasks:

#### Task 5: Remove the rep-drop-off chip (LogScreen + Analytics) and render within-row skipped sets — ✅ COMPLETE

- **Issue:** `#266`
- **Status:** complete. The legacy Log nudge chip and Analytics `⚠ Hit wall`
  badge are removed, `getLatestRepDropOff` / `formatRepDropOffNudge` are
  deleted, within-row skipped sets now render as `80 lb 4, -`, and the mobile
  Jest suite passes after removing the obsolete `getLatestRepDropOff` tests.
- **Goal:** delete the disliked rep-drop-off ("hit a wall") signal everywhere it renders and
  display within-row skipped sets correctly.
- **Scope (corrected for post-Phase-1 state):** the signal renders in **two** dead-but-wired
  surfaces, not one. Remove both, plus the helpers and dead plumbing:
  - `mobile/lib/data.js` — delete `getLatestRepDropOff` (`:922`); keep `computeRepDropOff`.
  - `mobile/lib/format.js` — delete `formatRepDropOffNudge` (`:66`).
  - `mobile/screens/LogScreen.js` — remove the two helper imports, the dead `repDropOffFlags`
    destructure (`:389`) and `rep_drop_off_flags` keys on both `update()` calls (`:401`, `:407`),
    `dismissedNudges` state, `handleDismissNudge`, the nudge chip render (`~:1196-1200`,
    `1229-1236`), and the `nudge*` styles.
  - `mobile/screens/AnalyticsScreen.js` — remove the `getLatestRepDropOff` import, the dead
    `repDropOffFlags` destructure + return key (`:134`, `:143`), the `⚠ Hit wall` badge
    (`:453`, `:456`, `:464-468`), and `dropOffBadgeColor` (`:595`) if now unused. Removal only —
    the Fatigue section is Task 8.
  - `mobile/components/UI.js` — `SetLine` lives here (`:206`), not in LogScreen. Render a
    `skipped` set's rep as `-` (`set.skipped ? '-' : set.rep_count`) so `80 4,-` shows
    `80 lb 4, -`. Backward compatible.
  No new trigger logic. Respect the Log tab style lock.
- **Verification:** neither the LogScreen chip nor the Analytics `⚠ Hit wall` badge renders; no
  references to `formatRepDropOffNudge` / `getLatestRepDropOff` / `repDropOffFlags` /
  `rep_drop_off_flags` remain (grep clean); `80 4,-` renders correctly in read mode; existing
  rows unchanged; `npm --prefix mobile test` passes; app compiles.
- **Labels:** `mvp-fatigue`, `agent:claude`, `area:ui`, `type:implementation`,
  `effort:default`, `reasoning:medium`

#### Task 6: Exit-editor trigger + red highlight of flagged exercises — ✅ COMPLETE

- **Issue:** `#267` (depends on `#266`)
- **Goal:** detect a rough session when the user leaves the editor and visually flag it.
- **Scope:** in `mobile/screens/LogScreen.js`, on editor exit (after autosave flush) call
  `deriveSessionCheckIn`; if `isRough` and `session_checkins[sessionIndex]` is absent, mark the
  `flagged` exercises with a **red highlight** style and open the modal (Task 7). Highlight
  clears once answered.
- **Verification:** logging a rough session highlights exactly the flagged exercises on exit; a
  normal session highlights nothing; answered sessions don't re-highlight.
- **Labels:** `mvp-fatigue`, `agent:claude`, `area:ui`, `type:implementation`,
  `effort:default`, `reasoning:medium`

#### Task 7: `SessionCheckInModal` — contextual question + answer capture — ✅ COMPLETE

- **Issue:** `#268` (depends on `#267`)
- **Status:** complete. `mobile/components/SessionCheckInModal.js` ships the
  contextual popup with the two-tier answer flow; answers persist via
  `session_checkins` and suppress re-prompting on the answered session.
- **Goal:** the popup that asks "you okay?" and records the answer.
- **Scope:** new `mobile/components/SessionCheckInModal.js`. Contextual title from `detectors`
  + flagged display names. Two-tier answer: **"I'm okay"** (optional Life/logistics quick chips:
  No time / Short session) → `status:'ok'`; **"Not great"** → multi-select reason chips across
  four groups + optional free text → `status:'rough'`. On submit, persist via
  `update(currentId, { session_checkins: { ...prev, [idx]: record } })`, close, clear highlight.
  Reason vocabulary — Fatigue/recovery {Tired, Poor sleep, Under-recovered, Low energy};
  Pain/injury {Shoulder, Elbow/wrist, Knee, Low back, Hip, Other pain}; Life/logistics {No
  time, Short session, Gym busy, Traveling}; Illness/stress {Sick, Stressed, Burned out, Low
  motivation}.
- **Verification:** popup shows the right message per detector(s); both answer paths persist
  correctly and dismiss; reopening the routine does not re-prompt the answered session.
- **Labels:** `mvp-fatigue`, `agent:claude`, `area:ui`, `type:implementation`,
  `effort:heavy`, `reasoning:medium`

#### Task 8: Analytics Fatigue section (dated list + summary) — ✅ COMPLETE

- **Issue:** `#269` (depends on `#268`; assumes `#266` removed the dead Analytics badge)
- **Status:** complete. `AnalyticsScreen` renders the Fatigue section from
  `deriveCheckInHistory(notes)` with the summary header and reverse-chron dated
  list, gated by the Fatigue tracking setting.
- **Goal:** present logged check-ins in Analytics.
- **Scope:** in `mobile/screens/AnalyticsScreen.js` add a **Fatigue** section backed by
  `deriveCheckInHistory(notes)` → `{ list[], summary:{ total, top_reason } }`: a summary header
  (total flagged/rough sessions, most common reason) above a reverse-chron dated list keyed on
  `responded_at`; each row shows date, issue(s)/reasons, # exercises skipped, and volume decline
  % (omit when `null`). Empty state when no check-ins.
- **Verification:** answered rough sessions appear with correct date/reasons/skips/volume;
  summary tallies match; empty state renders when none.
- **Labels:** `mvp-fatigue`, `agent:claude`, `area:ui`, `type:implementation`,
  `effort:default`, `reasoning:medium`

---

### Phase 3: Docs & Closeout

Phase goal: living docs reflect the new feature and removed chip. With Phases 1–2 shipped, the
remaining work is the docs pass below plus reviewer closeout (changelog + version bump) — there
is no outstanding UI or detection implementation.

Completion condition: docs describe the check-in flow, the Fatigue analytics surface, the new
parser token, and the `session_checkins` model; changelog and version bumped at closeout.

Task 9 was split into two scoped docs passes:

#### Task 9A: Product/architecture docs for the fatigue feature — ✅ COMPLETE

- **Issue:** `#276`
- **Status:** complete. The product-state and architecture docs describe the shipped check-in
  flow, the Fatigue analytics surface, the new parser token, and the `session_checkins` model,
  with no references to the removed chip.
- **Scope:** `docs/current-state.md` (new check-in flow + Fatigue analytics; chip removed),
  `docs/architecture.md` (detection data flow, `session_checkins` persistence),
  `docs/repo-structure.md` (new `SessionCheckInModal.js`).

#### Task 9B: QA docs + roadmap status — ✅ COMPLETE

- **Issue:** `#277`
- **Status:** complete. `docs/testing-and-qa.md` documents the real fatigue verification surface
  (detector/parser/storage checks plus the post-ship `AnalyticsScreen` interaction coverage), and
  this roadmap is brought current with Phase 2 completion and the post-ship follow-ups.
- **Goal:** keep `testing-and-qa` accurate after Phases 1–2 and align roadmap status with shipped
  reality.
- **Scope:** `docs/testing-and-qa.md` (detector/parser/interaction test coverage),
  `docs/mvp-fatigue-roadmap.md` (Phase 2 completion + follow-ups, remaining = reviewer closeout).
- **Verification:** no references to the removed chip; fatigue verification surface described
  accurately; roadmap no longer presents Tasks 7/8 as outstanding.
- **Labels:** `mvp-fatigue`, `agent:claude`, `area:docs`, `type:implementation`,
  `effort:default`, `reasoning:medium`

Remaining after Task 9B: reviewer closeout only — changelog entry and version bump per the
versioning policy. No implementation work remains in this pass.

---

## Sequencing summary

- Phase 1 (claude): Task 1 `#262` → Task 2 `#263` → Task 3 `#264` → Task 4 `#265` — ✅ complete
- Phase 2 (claude, after Phase 1): Task 5 `#266` → Task 6 `#267` → Task 7 `#268` → Task 8 `#269` — ✅ complete
- Post-ship follow-ups (claude): `#272` (Analytics fatigue UX), `#274` (skip placeholder render),
  `#275` (Analytics fatigue interaction coverage) — ✅ complete
- Phase 3 (claude, after Phase 2): Task 9A `#276` — ✅ complete; Task 9B `#277` — ✅ complete;
  then reviewer closeout (changelog + version bump)
- Reviewer (codex) writes each issue from these task specs and reviews on completion.

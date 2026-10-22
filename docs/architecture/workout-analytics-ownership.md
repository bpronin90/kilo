# Workout Analytics Ownership

For implementers deciding which layer may produce, persist, or recompute workout analytics.

## Tracked-lift lifecycle

Tracked-lift visibility now follows a similar shared-hook pattern. Log toggles
persist through the global `kilo_tracked_lifts` map, `useTrackedLifts()`
fanouts the updated in-memory state to all mounted consumers immediately, and
Analytics filters that global tracked set down to lifts present in the current
routine while still deriving each visible lift's trend and exercise display
casing from all routine notes through `deriveWorkoutNoteAnalytics()`. Because
that tracked-lift map is global, PO/tracked progression continuity survives
current-routine switches without any per-routine migration step; only 1K slot
selections are rolled from one routine note to another when the user accepts
the switch prompt.

Since #893, a Track activation also records WHEN that span opened. `useTrackedLifts()`
mints an activation record beside the flag on every false-to-true toggle and deletes
both together on untrack, so the two can never diverge. The record's `anchor` is the
exercise's logged-session count at that moment, counted in one normative list defined
in `lib/parser/analytics.js`:

```
occurrences.flatMap(_occurrenceEntries)
  .filter(se => !se.skipped && !se.unparsed && se.sets?.length > 0)
```

Every progression consumer — the weighted signal, the per-day signal, the
Progressing/Steady/Regressing classification, and the non-weighted reps/hold arrow —
drops units below that ordinal, so they cannot land on different boundaries. Capability
metrics (Est. Max, Kilo Max, Best Set) ignore the anchor entirely and keep using all
eligible history, which is why retracking restores them immediately while the trend
restarts at `First session`.

The record's `witness` (the activation-time headings plus a literal serialization of the
opening sessions) is a verification token, not an identity: identity is the canonical
name key alone. A mismatch RETIRES the watermark — the record is deleted, the Track flag
is untouched, and the exercise falls back to legacy full-history behavior — but a
watermark is never reassigned. Retirement and the stale-anchor repair are writes, and they
happen at exactly one place: the note-save boundary in `useLogCurrentRoutineEditor`, over
the UNFILTERED note population, and only when the recovery boundary is known. Render paths
stay pure — they apply the anchor with an in-memory clamp and never write. The one
uncovered path, documented and bounded, is a same-save substitution whose opening history
and headings are byte-identical; the boundary then still lands inside the substitute's own
history, so no cross-movement comparison is possible, and the next untrack clears it.

Since #1395, a Normalize exercise names apply is the one place a tracked span moves to a
different key. `planTrackedLiftRenameTransition` (`lib/data/workoutAnalyticsActivations.js`)
matches each renamed header's sessions before/after by provenance (note order, section,
exercise slot, position — never set values or spelling). A tracked source makes its
destination tracked; a source keeps its flag while any live header still produces it.
Each valid activation's excluded sessions are located in the resulting key and the
boundary becomes the shortest prefix holding them, maximum over every contributor, with
the witness rebuilt over the result; boolean-only and unverifiable records contribute
nothing and are never re-attached. The note texts and both Track maps commit in the one
batch under the notebook and local-write locks, journaled by a roll-forward intent
(`kilo_normalization_apply_intent_v1`): an in-process failure rolls back, and an
interrupted commit is finished before the next apply, Track write, tracked-lift load, or
sync pass; a replay whose target note changed after the interruption decides whether the notebook
write landed from a local-only apply id stamped on the rows in that same write (never
uploaded; the cloud column whitelist drops it): landed rolls the intent's affected Track
keys forward, not landed retires it untouched, and a key matching neither its before nor
after value keeps the intent and fails safe. Every notebook-lock holder (note writers,
backup restore, sync write-back, migration, purge) settles a pending intent first, through
the adapter of the storage mode current at that moment, refusing its own write if the
intent cannot be reconciled (skipped while the device key is latched, so a #1186 recovery
restore can still replace everything); the stamp is stripped once the intent completes.
An intent that can never be replayed (unparseable or structurally invalid JSON, or a note that matches
neither side while a recorded Track key matches neither its before nor after value) is distinguished
from a transient read/write failure and published through the sync-recovery store
(`getUnfinishedRenameBlock`); the Cloud Sync recovery panel (reachable without a consent grant)
re-inspects it on mount and offers **Discard unfinished rename** only for a currently proven
one. The discard runs under recovery guard → tracked-lift queue → notebook → local-write without settling
first, revalidates the exact raw record, preserves it in the encrypted device-local, unsynced,
unbacked-up `kilo_normalization_apply_quarantine_v1_<n>` (never overwritten; an interrupted attempt reuses
its copy), and only then removes the active key. Note text and both Track maps are never written; it does not
mark any sync phase complete, and it refuses while the device key is latched.
Lock order is recovery guard → tracked-lift queue → notebook → local-write, and no
local-write holder takes the notebook lock. The hook runs the apply as one tracked-lift
queue entry under the recovery guard every sync pass holds, so toggles and passes see it
wholly or not at all. Every write of either Track map bumps a storage write generation
(`settings.js`); the hook claims its own bumps, and any other writer (an apply or replay
from any entry point, a lock-level settle, a sync pull, a restore) makes the next queued
write re-read storage before it derives, while an adoption-only queue step re-reads and
broadcasts to mounted consumers. That adoption, the derivation and both writes of one
queued change run in a single local-write-lock section (any pending intent is rolled
forward just before it), so a sync write-back can never land between derive and write.
A save's reconcile population is the caller's snapshot and can predate a rename, so a
record changed by an external writer is retired or clamped only when the durable notebook
gives the same result (else it waits for the next save); other records reconcile as before.

## Session Check-In (Fatigue) Flow

The fatigue feature is a detection → response → consumer pipeline keyed by
session index on the current workout note. The old rep-drop-off / `hit_wall`
chip is gone; nothing in the active path produces or reads `rep_drop_off_flags`.

- **Detection** — `deriveSessionCheckIn(sections, trackedNames)` in
  `mobile/lib/data.js` evaluates the latest (deepest) session column of the
  current note only. It runs skip, whole-day-skip, and per-exercise
  volume-drop/collapse detectors over the tracked lifts and returns
  `{ sessionIndex, isRough, detectors, flagged, metrics }`. `LogScreen.js` runs
  this when the user leaves the current-routine editor after a rough session.
- **Prompt** — when `isRough` is true and no matching
  `session_checkins[sessionIndex]` entry exists yet, `LogScreen.js` highlights
  the flagged exercises in red in the rendered note and opens
  `mobile/components/SessionCheckInModal.js` with a detector-aware title and the
  flagged exercise names.
- **Response / persistence** — the modal writes a check-in record onto the
  note's `session_checkins[sessionIndex]` carrying `status`
  (`'ok'` / `'rough'` / `null` for a dismissed/pending answer), optional
  `reasons` and free-text `note`, the captured detector `metrics`
  (`exercises_skipped`, `volume_decline_pct`), `flagged`, `detectors`, and an
  answer-time `responded_at` ISO timestamp. The highlight and prompt suppress
  once that entry exists. This record is persisted on the workout-note document
  through the normal note save path.
- **Consumer** — `deriveCheckInHistory(notes)` in `mobile/lib/data.js` flattens
  `session_checkins` across all notes into a `responded_at`-sorted history split
  into `rough` / `ok` / `pending` groups plus a summary (`top_reason`, group
  totals). `AnalyticsScreen.js` consumes this for the `Fatigue` section and can
  reopen `SessionCheckInModal` against an existing record to edit it, preserving
  the original `responded_at`. Both the Log prompt and the Analytics Fatigue
  surface are gated on the More > Settings `Fatigue tracking` toggle.

## Workout Analytics Ownership Contract

This section is the canonical source-of-truth for which layer owns each native
workout analytics field, which consumers are allowed to read it, and whether
recomputation at render time is permitted.

### Ownership Principles

1. **Single canonical producer.** Every analytics field has exactly one
   authoritative producer path. Consumers must read from that producer's output;
   they must not recompute the same value through a parallel path.
2. **Persisted fields are read-only after save.** When a field is persisted on
   the workout-note document during the Log save path, downstream consumers
   (Home, Analytics) must read the persisted value. They must not override it
   with a live recomputation unless an explicit exception is documented below.
3. **Recompute-only fields have no persistence obligation.** Fields documented
   as recompute-only are derived fresh on each render from canonical note text
   and global state. They must not be written to storage.
4. **Mixed ownership is a bug.** If a field appears in both the persisted note
   document and a consumer-side recomputation with potentially different results,
   that constitutes a source-of-truth conflict that must be resolved.

### Field-by-Field Ownership Matrix

| Field | Canonical Owner | Persistence | Allowed Consumers | Recompute at Render? |
|-------|----------------|-------------|-------------------|---------------------|
| `exercise_classifications` | Log save path via `deriveWorkoutNoteAnalytics()` | Persisted on note document | Home (read-only), Analytics (read-only) | **No** — consumers must read `workoutNote.exercise_classifications` |
| `skip_markers` (`exercise_skips` + `day_skips`) | Log save path via `deriveSkipData()` (current-note scoped) | Persisted on note document | No current UI consumer after `#163`; available for future use | No |
| `attendance_flags` | Log save path via `deriveSkipData()` (current-note scoped) | Persisted on note document | No current UI consumer after `#163`; available for future use | No |
| `session_checkins` | Detection via `deriveSessionCheckIn()`; response written by `SessionCheckInModal` keyed by `sessionIndex` (carries `status`, `reasons`, `responded_at`, captured metrics) | Persisted on note document | Analytics Fatigue section via `deriveCheckInHistory()` (read + edit) | No |
| `rep_drop_off_flags` | _Removed from active contract in issue `#264`; cleanup finished in `#266`_ | No longer produced by the active pipeline; legacy note documents may still carry stale values | No active consumers | N/A |
| `tracked_exercises` | Log tracked-lift toggles via global `kilo_tracked_lifts` | Persisted on note document + global key | Home, Analytics | No |
| `one_k_exercises` | Analytics 1k slot selection | Persisted on note document | Home 1k card + Recovery Big 3, Analytics 1k card, Log rollover — all via `resolveOneKSelections()` in `data/oneK.js` (malformed/restored slots fall back to defaults) | No |
| `exercise_movement_groups` (Recovery group choices) | Log Manage block group editor via `setMovementGroupCore()` in `hooks/entries/movementGroupHooks.js` (explicit edit only; fresh read, serialized merge, read-back) | Persisted on the Recovery baseline note; `{version: 1}` broad or `{version: 2}` broad + detailed ids (#1581) | Recovery snapshot (`recoveryMovementGroups.js`), Analytics Training breakdown | No — authored; automatic groups are recomputed from the frozen record name, never written back |
| `big_3_deltas` | _Removed from active contract in issue `#182`_ | Still persisted on legacy note documents but no longer consumed | None | N/A |
| Estimated 1RM per lift | `deriveProgressionSignals()` in `parser.js`, surfaced through `deriveWorkoutNoteAnalytics()` in `data/workoutAnalytics.js` | Not persisted | Analytics strength rows | Yes — recompute-only |
| Kilo max per lift | `deriveProgressionSignals()` in `parser.js`, surfaced through `deriveWorkoutNoteAnalytics()` in `data/workoutAnalytics.js` | Not persisted | Analytics strength rows | Yes — recompute-only |
| Latest top weight | `deriveProgressionSignals()` / `derivePerDaySignals()` in `parser.js`, surfaced through `deriveWorkoutNoteAnalytics()` in `data/workoutAnalytics.js` | Not persisted | Analytics strength rows | Yes — recompute-only |
| Overload trend | `deriveProgressionSignals()` / `derivePerDaySignals()` in `parser.js`, surfaced through `deriveWorkoutNoteAnalytics()` in `data/workoutAnalytics.js` | Not persisted | Analytics strength rows | Yes — recompute-only |
| Exercise Progress summary (progressing/stalled/regressing, newly tracked, inherited) | `deriveExerciseProgress()` / `summarizeExerciseProgress()` in `data/exerciseProgress.js` over the deload-excluded `deriveProgressionSections()` population; one count per tracked exercise from its overall trend | Not persisted | Home hero counts, Analytics Progressive Overload summary | Yes — recompute-only |
| 1k total | `derive1kTotal()` in `data/oneK.js` | Not persisted | Home 1k card, Analytics 1k card | Yes — recompute-only |
| Weight rolling averages | `computeWeightTrends()` / `computeWeightRollingAverageSeries()` in `data/weightGoal.js` | Not persisted | Home chart, Weight trends card, Analytics weight section | Yes — recompute-only |
| Weight trend prior-window summary | `computeWeightTrendSummary()` via `deriveWeightGoalAnalytics()` in `data/weightGoal.js` | Not persisted | Weight trends card, Home weight summary, Analytics weight section | Yes — recompute-only |
| Weight pace level | `computeWeightPaceLevel()` in `data/weightGoal.js` | Not persisted | Weight trends card, Analytics weight section | Yes — recompute-only |
| Weight goal guidance | `resolveGoalCurrentWeight()` / `computeWeightGoal()` / `computeCalorieEstimate()` in `data/weightGoal.js` | Goal persisted; guidance recomputed | Weight goal card only | Yes — recompute-only (from persisted goal plus latest-entry/start-weight fallback contract) |
| Weight goal state (`isOverdue`, clamped `weeks_remaining`, safe `required_weekly_pace`) | `normalizeGoalInfo()` applied inside `deriveWeightGoalAnalytics()` in `data/weightGoal.js` | Not persisted | Home weight card, Weight goal card | Yes — recompute-only; screens must not re-normalize |
| Weeks In | `computeWeeksIn()`, surfaced as `weeksIn` by `deriveRoutineStatus()` in `data/routineStatus.js` | Not persisted | Home summary card | Yes — recompute-only |
| Routine status (sessions logged / since deload, elapsed weeks) | `deriveRoutineStatus()` in `data/routineStatus.js` | Not persisted | Home (`routineStatus`), Analytics Routine Health gauge | Yes — recompute-only |
| Session/activity count | `countWorkoutSessions()` in `parser.js` | Not persisted | Home, Analytics | Yes — recompute-only |
| Big 3 asymmetry notes | `detectBig3Asymmetry()` in `data.js` | Not persisted | No current UI consumer after `#174`; available for future use | Yes — recompute-only |
| Weekly summary aggregation | `computeWeeklySummary()` in `data/workoutAnalytics.js` | Not persisted | Home only | Yes — recompute-only (reads persisted note fields) |

### Producer/Consumer Map

```
┌─────────────────────────────────────────────────────────────────────┐
│  LOG SAVE PATH (Producer)                                           │
│  LogScreen.js — via deriveWorkoutNoteAnalytics() + deriveSkipData() │
│                                                                     │
│  Produces on each save:                                             │
│    • exercise_classifications  (via canonical layer, all sections)   │
│    • skip_markers (exercise_skips + day_skips)  (current note only)  │
│    • attendance_flags                           (current note only)  │
│                                                                     │
│  Does NOT produce:                                                  │
│    • rep_drop_off_flags (removed from active contract in #264)       │
│    • big_3_deltas (removed from active contract in #182)            │
└─────────────────────────────────────────────────────────────────────┘
        │
        ▼  persisted on workoutNote document
┌─────────────────────────────────────────────────────────────────────┐
│  HOME (Consumer — read-only from persisted note)                    │
│  HomeScreen.js                                                      │
│                                                                     │
│  Reads from persisted note:                                         │
│    • exercise_classifications (via computeWeeklySummary)            │
│                                                                     │
│  Legitimately recomputes:                                           │
│    • 1k total, weight series, weeks-in                              │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  ANALYTICS (Consumer — canonical live derivation)                   │
│  StatsScreen.js                                                     │
│                                                                     │
│  Legitimately recomputes:                                           │
│    • signal rows + display casing via deriveWorkoutNoteAnalytics()  │
│    • 1k total, weight rolling averages, pace                        │
└─────────────────────────────────────────────────────────────────────┘
```

### Recomputation Rules

`session_checkins` is persisted separately by the session check-in response
flow (`SessionCheckInModal`) and keyed by session index on the workout-note
document, with each record carrying an answer-time `responded_at` timestamp.
Detection is `deriveSessionCheckIn()` and the read/edit consumer is
`deriveCheckInHistory()`; see [Session Check-In Flow](#session-check-in-fatigue-flow).

**Consumers MUST NOT recompute these fields:**
- `exercise_classifications` — read from `workoutNote.exercise_classifications`
- `skip_markers` — read from `workoutNote.skip_markers`
- `attendance_flags` — read from `workoutNote.attendance_flags`
- `session_checkins` — read from `workoutNote.session_checkins`

**Consumers MAY recompute these fields (they have no persisted equivalent):**
- Estimated 1RM, Kilo max, latest top weight, overload trend, and signal-row
  display casing via `deriveWorkoutNoteAnalytics()`
- 1k total
- Weight rolling averages, pace level, goal guidance
- Weeks In, session count
- Weekly summary aggregation (reads persisted note fields, aggregates live)

**Canonical temporal helper semantics for recompute-only consumers:**
- `currentWeekStart()` defines the shared Sunday-based current-week gate used by
  native workout consumers that need a current-week boundary
- `rollingWindowStart()` defines the shared inclusive rolling-window cutoff used
  by native weight-trend consumers that need calendar-based rolling windows
- `detectBig3Asymmetry()` now aligns Big 3 history by session-entry index rather
  than calendar-week buckets

**`computeWeeklySummary` consumption contract:**
- Must read `exercise_classifications` from `workoutNote.exercise_classifications` only
- Must read `attendance_flags` from `workoutNote.attendance_flags` only
- Does not currently consume `rep_drop_off_flags`

### Acceptance Contract for Downstream Issues

Any downstream implementation issue that touches workout analytics must:
1. Identify which fields from this matrix it reads or writes.
2. Confirm its read/write pattern matches the documented ownership.
3. Not introduce a new parallel computation path for a field already owned by
   the Log save path.
4. If it needs to change ownership for a field, explicitly state which row in
   this matrix it modifies and why.

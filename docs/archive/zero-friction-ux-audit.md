# Kilo UX Friction Audit

Independent forensic UI/UX and product-friction audit (issue #850).
Read-only diagnosis. No product code, schema, or configuration was changed.

---

## 0. Method, evidence base, and limits

### What was inspected

| Source | Extent |
| --- | --- |
| Application code | `mobile/` — all five screens, the Log editor hooks, the parser (`lib/parser/`), derivations (`lib/data/`), storage/sync hooks, shared UI components, theme, tab bar |
| Product docs | `docs/current-state.md`, `docs/ui-design-rules.md`, `docs/design-system-map.md` (as current design intent) |
| Live account data | Production Supabase project `ogzhnscdqcdrhfqcobuv`, **`kilo` schema only**, **read-only** (`default_transaction_read_only=on` on every statement). No `INSERT`/`UPDATE`/`DELETE`/DDL was issued. |
| Parser behaviour | The shipped `parseWorkoutNote`/`parseWorkoutRow` modules were copied unmodified into a scratch directory and executed against the account's real note text, so every parser claim below is an observed output, not an inference from reading regexes. |

### Account snapshot (read-only, 2026-08-21)

Two `user_id`s hold near-identical data (the same device history synced under an
older and a current sign-in). Counts below are the union; the active account is
the one with 9 notes.

| Table | Rows | Notes |
| --- | --- | --- |
| `workout_notes` | 14 (9 active account) | 33 KB of routine text total |
| `weight_entries` | 136 | 83 distinct days, 2026-05-18 → 2026-08-21 |
| `recovery_blocks` | 1 | baseline *Summer 2026 Routine*, started 2026-08-08, **not completed**, `include_in_normal_analytics = false` |
| `recovery_block_weeks` | 1 logical week | Week 1 → *Return (ease the back) rehab* |
| `deload_history` | 1 logical record | |
| `fatigue_checkins` | 3 | 2026-06-11, 2026-06-26, 2026-06-30 |
| `weight_goal` / `archived_weight_goals` | 1 / 2 | |
| `product_measurement_events` | **0** | telemetry consent is off — see "What could not be determined" |

Current routine (*Summer 2026 Routine*): 242 lines, 3.2 KB, 15 parsed sections,
**71 exercises**, of which **42 have zero parsed sets**, and **21 rows the
parser rejects**.

### What could not be determined, and is therefore not asserted

1. **No interaction telemetry exists.** `product_measurement_events` is empty
   (consent off by design). Every claim about *taps, dwell time, rage-taps,
   abandonment, or which control a user reached for* is therefore inference from
   code paths and persisted artefacts, and is labelled as such.
2. **No per-session dates exist** anywhere except
   `workout_notes.session_checkins[idx].responded_at`. Sessions are positional
   columns in note text. Nothing in this audit can reconstruct "what happened on
   Tuesday the 12th", and neither can the product (see KUX-009).
3. **On-device behaviour was not observed.** No emulator or device run was
   performed. Claims about keyboard behaviour, caret placement in a nested
   scrolling `TextInput`, animation feel, and Android back-gesture handling are
   derived from code and are flagged **needs device verification** where that
   matters.
4. **Only one real user's data exists.** Findings from account data describe one
   power user's behaviour. Where a finding depends on that user being
   representative, it says so.
5. **Deleted notes are soft-deleted** (`deleted_at` tombstones with `raw_text`
   retained). This audit did not evaluate the retention/erasure contract; it is
   named once in KUX-036 only where it contradicts user-facing copy.

Evidence in the register is tagged:
**[E]** direct evidence in code or account data ·
**[I]** inference from that evidence ·
**[T]** would need interaction telemetry to confirm.

---

## 1. Pass 1 — What Kilo actually is

### 1.1 Shell

`App.js` mounts **all five tabs simultaneously** and hides the inactive four
with `display: none` (`App.js:16-38`, memoised per tab). Tab state, the workout
note draft (`workoutNoteText`, `workoutNoteTitle`), and the weight draft
(`weightValue`, `weightNote`) all live at the shell level. Consequences that
matter downstream: screens never unmount, so per-screen state (including "which
sub-tab of Log am I on") survives tab switches for the life of the process but
not across a cold start.

Navigation between tabs is a typed intent `{ tab, target, key }` with three
target kinds — `section` (Analytics), `note` (Log), `subview` (More).

The tab bar (`components/TabBar.js`) is a floating rounded pill, absolutely
positioned above the content. **It animates itself to `opacity: 0.25` two
seconds after mount, and returns to 0.25 one and a half seconds after any
touch.** Scrolling also drives it to 0.25 (`TabBar.js:47-54`).

### 1.2 The five surfaces

| Tab | What it actually is |
| --- | --- |
| **Home** | Read-only dashboard: week number, latest bodyweight + 7-day sparkline, two text links ("Log workout", "Log weight"), weight-goal card, 1K progress, a per-exercise progress-status list, recovery status card, cloud-sync notice. No data entry. |
| **Log** | The product. Contains a *second* tab strip (Recovery / Routine / Deload) plus the current-routine card, a "Start recovery block" row, a "Reopen recovery block" row, and a collapsed "More Routines" disclosure. |
| **Weight** | Weigh-in form (weight, note, collapsible date), goal card, trends, history list, archived goal history. |
| **Analytics** | Overview card, weight trends, recovery section, fatigue card, strength/1K section, Progressive Overload table. |
| **More** | Six menu rows → Profile, Settings, Account, Data & Backup, App Guide, About. |

### 1.3 The workout-note model

A routine is **one note**: a title and one block of plain text. Everything —
the programme, the warm-ups, every session ever logged against it — lives in
that single string.

```
MONDAY — Push          ← day heading (matched by leading weekday name)
+WARMUP                ← section subheading ('+'); 'warmup'/'lift' change `kind`
-Bike 5 min            ← exercise header ('-' + non-space)
-DB Bench Press 3x6-8  ← exercise header; the " 3x6-8" is stripped from the name
100 8,8,7              ← session 1: three sets of 100 lb × 8,8,7
100 8,8,8              ← session 2  (each new line = the NEXT session)
100 8,8,7              ← session 3
-                      ← session 4: skipped
---                    ← Week A / Week B separator
```

Additional grammar that exists in `lib/parser/` but appears in **no in-app
teaching surface**: `--` comment lines, `*mark` star annotations, ` - ` inline
prose tails, `Core:` and `1.`-numbered exercise headers, the deload form
`Name: 135 lbs 3x5`, and the in-row skipped-set marker `80 4,-`.

Two facts about this model drive most of this report:

- **A session is a position, not a date.** "Session 4" means "the fourth line
  under this exercise". Nothing records when it happened.
- **The note only grows.** Every session appends one line to every exercise
  block. The live routine is already 242 lines after ~4 session-columns.

### 1.4 Core flows as they actually run

**Log a workout (returning user, cold start)**

1. Open app → lands on Home.
2. Tap *Log workout* (or the Log tab).
3. **If a recovery block is active, Log opens on the Recovery tab, not Routine**
   (`LogScreen.js:274-279`). Tap *Routine*.
4. The current routine card renders in read mode, showing all 71 exercises of
   the active week.
5. Tap *Edit* (or double-tap the body — the retained undocumented gesture,
   `useLogCurrentRoutineEditor.js:831-840`).
6. A full-screen editor opens with **one `multiline` TextInput containing the
   entire active week** (`LogScreenEditorCard.js:337-353`) — 170 lines for this
   user.
7. Scroll to the day, then to the exercise, place the caret at the end of its
   last line, press return, type `100 8,8,8`.
8. Autosave fires 800 ms after the last keystroke (`AUTOSAVE_DEBOUNCE_MS`),
   **silently** — `handleSave` only sets a success message when
   `autosave === false` (`useLogCurrentRoutineEditor.js:506`).
9. Tap *Done*. A fatigue check-in modal may appear. Editor exits.

**Log a weigh-in**

1. Weight tab → tap field → type → tap *Save weigh-in*. The *Note* field sits
   between the number and the button.

**Correct a mistake**

Edit the text. There is no per-set undo; the editor header has a single *Undo*
that reverts the note to its state when the editor was opened, immediately and
without confirmation (`useLogCurrentRoutineEditor.js:645-668`).

---

## 2. Pass 2 — Real-account / longitudinal findings

### 2.1 Direct evidence [E]

| # | Observation | Source |
| --- | --- | --- |
| E1 | `workout_notes.tracked_exercises` is `[]` on the current routine. **The user has never tracked a single exercise in three months.** | live row |
| E2 | `exercise_classifications` holds **33 entries**, including `pec deck`, `seated cable row`, `hammer strength iso row`, `goblet calf raise — db on step`, `calf raises at end of each set`, `hammer strength shoulder press` — none of which exist in the current routine. 24 of the 33 carry a status Home displays. | live row |
| E3 | Six pairs of duplicate identities for the same movement: `pallof press`/`core: pallof press`, `single-leg extension`/`single-leg calf extension`, `hammer shoulder press`/`hammer strength shoulder press`, `goblet calf raise`/`goblet calf raise — db on step`, `dead bugs 3x10 each side`/`core: dead bugs 3x8 each side`, `db curl`/`dumbbell curls`/`cable curls`. | live row |
| E4 | `skip_markers.exercise_skips` holds **49 entries**; `attendance_flags` holds **10** flags, incl. `consecutive_exercise_skips` for `RDL` (2), `DB Floor Press` (3), `Core: Ab wheel or in-and-outs` (3) — exercises with **zero** logged sets ever. | live row |
| E5 | `attendance_flags` contains `repeated_weekday_skip: friday, skip_count: 2`, and `day_skips` lists `friday @ session_index 0` **twice** — once for Week A's Friday and once for Week B's Friday. | live row |
| E6 | The live routine contains **21 rows the shipped parser rejects**, including five instances of the same pattern (`3,3,-`, `30,-`, `2,2,-`, `20,20,-`, `10,10,-`) and one stale typo (`12,`). | parser run on live text |
| E7 | The rehab routine contains **~34 distinct rejected rows**, including `60` (×9, stretch durations), `10 5` / `11 5` / `12 5` (bike level+minutes), `12/10`, `135-155`, `95-115`, `120 12,`, and three emphatic prose lines (`NO LIFTING. NO CORE.`, `NO RUNNING. NO SHOULDER PT.`, `NO RUNNING. NO CORE. NO SKULL CRUSHERS.`). | parser run on live text |
| E8 | The three lines under `HOME WEEK NOTES` at the end of the current routine (`- No PRs, no grinding…`, `- Keep protein high…`, `- Friday is rest on home weeks`) produce **no output at all** — no section, no exercise, no unparsed row. They exist in the saved text and are invisible in the read view. | parser run on live text |
| E9 | The current routine contains **two** `---` separators (lines 171 and 238). `parseWorkoutNote` reports `weekBStartIndex` from the *last* one; `activeEditText` slices at the *first* one. | parser run + `useLogCurrentRoutineEditor.js:267-274` |
| E10 | 136 weight entries across 83 days. **`note` is populated on zero of them.** | live rows |
| E11 | Four residue notes live in the notebook: `Test` (3 chars), `test` (6 chars), `test ` (0 chars, trailing space in title), `Untitled Routine` (**32 chars — byte-for-byte the length of `WORKOUT_SEED_EXAMPLE_TEXT`**). | live rows |
| E12 | `bottles test` is a live exercise inside MONDAY/+LIFTING of the current routine with two logged sets. | live text |
| E13 | One recovery block, opened 2026-08-08, still active 13 days later, one week attached, `include_in_normal_analytics = false`. | live row |
| E14 | Three `session_checkins` (indices 0, 2, 3). Index 3 flagged **15 exercises across all five weekdays** as skipped in a single "session". `volume_decline_pct` is `null` in all three. | live row |
| E15 | 42 of 71 exercises in the current routine have zero parsed sets — warm-ups, stretches, and never-performed template lines. | parser run |

### 2.2 Inference from that evidence [I]

- **I1.** The `Untitled Routine` note (E11) is an abandoned tap on the "Tap to
  try this example" seed block: the seed inserts exactly that text, and saving
  defaults the title to `Untitled Routine`. Trying the example therefore leaves
  a permanent artefact in the notebook.
- **I2.** The user does not know that Analytics' Progressive Overload table
  requires explicit tracking (E1). Home nevertheless shows 24 progress rows
  (E2), so the app *looks* like it is tracking — which removes any prompt to go
  find the `Track` pill.
- **I3.** The user believes `-` marks a skipped set in bodyweight rows, because
  they wrote it five times in the current routine and again in the rehab note
  (E6). They are wrong, and the error message tells them to remove a trailing
  comma rather than that `-` is not allowed there.
- **I4.** The user routinely wants to record things that are not
  `weight × reps`: durations, bike level, rep ranges, and instructions to
  themselves (E7). They write them anyway and tolerate them being rejected.
- **I5.** *Skip week* was pressed at least once with the routine in its current
  shape, producing a skip marker on every exercise with any history — including
  RDL and four Core lines that have never been performed (E4). The resulting
  attendance flags ("you keep skipping RDL") are artefacts of the button, not
  of behaviour.
- **I6.** The recovery block (E13) is not being closed because closing it is a
  five-modal lifecycle the user has no reason to complete; meanwhile it makes
  Recovery the default Log tab on every launch and excludes the rehab weeks
  from normal analytics.
- **I7.** The weigh-in loop is the highest-frequency interaction in the product
  (83 days of entries vs. roughly 12–16 note-editing sessions inferable from
  4 session-columns × 5 weekdays). Optimisation effort is currently
  concentrated on the lower-frequency loop.

### 2.3 Questions that need telemetry [T]

- **T1.** How many taps/scroll distance separate opening the app from the first
  keystroke of a set row?
- **T2.** How often is the editor opened and closed without a change (e.g.
  opened to *read* history rather than to write)?
- **T3.** Is *Undo* ever pressed, and if so, immediately after entering the
  editor or after substantial work?
- **T4.** Are the ⚠ unparsed-row warnings seen and ignored, or not seen? The
  red `3,3,-` warning has been sitting inside `+LIFTING (~30 min)` on Monday
  for weeks.
- **T5.** Does anyone ever open the "Workout syntax help" sheet from the editor?

---

## 3. Friction register

### 3.1 Index

| ID | Surface | Sev | Freq | One line |
| --- | --- | --- | --- | --- |
| KUX-001 | Log | High | Every workout | Log opens on Recovery, not the routine you came to write in |
| KUX-002 | Log editor | **Critical** | Every workout | No way to reach today's exercise; you scroll a 170-line raw text field |
| KUX-003 | Log editor | High | Every workout | The whole week is one `TextInput` inside a `ScrollView` |
| KUX-004 | Log editor | High | Every workout | Autosave is completely silent; the only save confirmation is unreadable |
| KUX-005 | Log editor | **Critical** | Rare, catastrophic | `Undo` sits beside `Done` and irreversibly reverts the entire session |
| KUX-006 | Log | Low | Occasional | Double-tap-to-edit survives as an undocumented gesture |
| KUX-007 | Log | High | Every workout, compounding | The note only grows; no rollover, archive, or collapse of old sessions |
| KUX-008 | Log | High | Weekly | `Skip week` marks exercises you never do, manufacturing false attendance flags |
| KUX-009 | Model | High | Always | Sessions are positions, not dates; Kilo cannot answer "when" |
| KUX-010 | Parser | High | Every workout | `-` marks a skipped set after a weight but is illegal in a bodyweight rep group; the error misdiagnoses it |
| KUX-011 | Parser | Medium | Every workout | A single number is not a valid row; `60` for a 60-second stretch is rejected |
| KUX-012 | Parser | Medium | Frequent | No syntax for a plain note line; prose is rejected or silently deleted |
| KUX-013 | Parser/Analytics | High | Every routine rewrite | Exercise identity is the header line, so editing the prescription forks history |
| KUX-014 | Parser | Medium | Occasional | A second `---` silently changes what "Week B" means; parser and editor disagree |
| KUX-015 | Parser | Medium | Every workout | Cardio/non-weight exercises accept no input at all |
| KUX-016 | Log | Medium | Frequent | Rejected rows are muted to near-invisibility outside `+Lifting` sections |
| KUX-017 | Settings/Parser | **Critical** | Every workout (metric users) | kg is a display-only setting; typing `100 5` records 100 **lb** |
| KUX-018 | Analytics | **Critical** | Always | Progressive Overload is empty; the only way in is a per-exercise `Track` pill |
| KUX-019 | Home | High | Every launch | Home's progress list is computed from a different, stale population |
| KUX-020 | Help | Medium | First use | App Guide describes Home as showing "tracked exercises". It does not. |
| KUX-021 | Analytics | High | Every routine rewrite | Tracking silently stops applying when the exercise name changes |
| KUX-022 | Analytics | Medium | Always | Default tracked lifts are hardcoded to a built-in split the user abandoned |
| KUX-023 | Log | Low | Occasional | Plate calculator is an unmarked tap on plain-looking text, offered for dumbbells |
| KUX-024 | Log | High | Occasional | The fatigue check-in interrupts the exit path with a modal |
| KUX-025 | Log | Medium | Occasional | "Latest session" spans all five weekdays and both A/B weeks at once |
| KUX-026 | Settings | Medium | First use | Fatigue tracking and Deload mode both default **on** |
| KUX-027 | Shell | High | Always | The tab bar sits at 25% opacity by default |
| KUX-028 | IA | Medium | Always | Five tabs, two of which carry the daily loop |
| KUX-029 | Log | Medium | Every workout | A second tab strip inside a tab |
| KUX-030 | More | Low | Occasional | Two navigation rows carry a permanent error-red border |
| KUX-031 | Log | Medium | Rare | Recovery blocks are a five-modal lifecycle most users will never finish |
| KUX-032 | Weight | Medium | Daily | The weigh-in `Note` field has 0/136 uses and sits between the number and the button |
| KUX-033 | Weight | Low | Daily | The weight placeholder is a fixed `185.0` rather than your last weigh-in |
| KUX-034 | Log | Medium | Occasional | Empty and junk notes accumulate with no cleanup path |
| KUX-035 | Log | Medium | First use | Trying the seed example leaves a permanent `Untitled Routine` note |
| KUX-036 | Log | Low | Rare | Delete copy promises permanence the cloud copy does not deliver |
| KUX-037 | Log | Low | Occasional | Cross-screen navigation is refused with "Finish your edit first" |

### 3.2 Entries

#### KUX-001 — Log lands on Recovery instead of your routine

| Field | Value |
| --- | --- |
| Surface | Log tab |
| Scenario | Open the app after the gym to record what you just did |
| User type | All (while any recovery block exists) |
| Friction | A one-shot effect makes Recovery the default sub-tab the first time verified recovery state resolves. `recoveryTabVisible` is true whenever a block is active *or* a pending operation, stale snapshot, or terminal read failure exists. The current-routine card renders **only** on the Routine sub-tab, so the user must tap Routine before they can log anything. |
| Category | Navigation, repetition |
| Frequency | Every cold start while a block is open |
| Severity | High |
| Evidence | `mobile/screens/LogScreen.js:261-279` (`recoveryTabVisible`, `recoveryDefaultAppliedRef`); `LogScreen.js:990-1014` (current card gated on `effectiveTabView === 'routine'`). **[E]** live `kilo.recovery_blocks`: one block, `started_at 2026-08-08`, `completed_at NULL` — open for 13 days as of the audit. |
| User consequence | "Why am I looking at this again? I just want to write my sets." One extra tap and one extra decision on the single most frequent journey in the app. |
| Recommendation | Delete the auto-default. Log always opens on Routine. Surface recovery state as a compact banner **above** the routine card (it already has copy for exactly this: `LogRecoverySection`'s pending/stale/error banners), with a chevron into the Recovery sub-tab. Keep the auto-switch only for the one moment it is genuinely right: immediately after `handleConfirmRecoveryBlock` succeeds, which `LogScreen.js:580` already does separately. |
| Expected improvement | Removes one tap and one re-orientation from every logging session; the routine is where the user's intent already is. |
| Risk | A user mid-recovery might not notice their recovery week. Mitigated by the banner, which is more visible than a sub-tab label. |
| Confidence | High |

#### KUX-002 — There is no way to get to today's exercise

| Field | Value |
| --- | --- |
| Surface | Log editor |
| Scenario | Add three sets of bench press to Monday |
| User type | Power / returning |
| Friction | Entering the editor replaces the rendered view with the raw text of the entire active week. `enterCurrentEditor` restores the *read view's* scroll offset into the editor's scroll view, but the two have completely different layouts (rendered cards vs. monospace-ish raw lines), so the landing position is arbitrary. The user then hunts for `-DB Bench Press`, taps at the end of its last line, and presses return. |
| Category | Navigation, mechanical, visual scanning |
| Frequency | Every workout, once per exercise touched (4–6× per session) |
| Severity | **Critical** (low intensity × very high frequency × no workaround) |
| Evidence | `mobile/screens/log/useLogCurrentRoutineEditor.js:549-559` (`enterCurrentEditor` scroll restore); `components/LogScreenEditorCard.js:337-353` (single editor input). **[E]** the live active week is 170 lines / 71 exercises. |
| User consequence | The dominant cost of using Kilo is *finding the line*, not writing it. This is the single largest violation of "type and move on". |
| Recommendation | Make the read view's exercise row the entry point. Tapping an exercise name in the rendered card opens the editor with the caret **already placed on a new line at the end of that exercise's block**, keyboard up. The parser already knows each exercise's line span (`raw_header` plus its rows); the editor already accepts a `selection` prop (used by the seed-example insert at `LogScreenEditorCard.js:344`). No new screen, no new mode — the same editor, positioned. |
| Expected improvement | Collapses "scroll, hunt, tap precisely, newline" into one tap. Applied 4–6× per session, this is the highest-leverage change available. |
| Risk | The caret jump must not scroll past what the user wants to see (they often want the previous session's numbers visible above the caret). Land with the exercise's last 2–3 lines on screen, not the caret at the very bottom edge. |
| Confidence | High |

#### KUX-003 — The whole week is one text field inside a scroll view

| Field | Value |
| --- | --- |
| Surface | Log editor |
| Scenario | Any edit |
| User type | All |
| Friction | `ScreenShell` is a `ScrollView`; the editor's `TextInput` is `multiline` with `minHeight: 250` and no height cap, holding the full active-week text. A multiline `TextInput` nested in a `ScrollView` has to negotiate caret-follow scrolling with its parent. |
| Category | Mechanical, interpretation |
| Frequency | Every workout |
| Severity | High |
| Evidence | `components/LogScreenEditorCard.js:337-353`; `components/ScreenShell.js`. **Needs device verification** — the failure mode (caret drifting under the keyboard, parent scroll fighting the input) is characteristic of this composition but was not observed on hardware. **[I]** |
| User consequence | Tapping precisely in a long note is fiddly; the caret can end up under the keyboard. |
| Recommendation | Do not restructure the editor. Fixing KUX-002 removes most of the need to hand-place the caret. Separately, verify on a device that caret-follow works at 170 lines with the keyboard up, and cap the input's height so the parent `ScrollView` is not scrolling a 4000 px child. |
| Expected improvement | Removes a class of "the app fought me" moments that are individually small and jointly corrosive. |
| Risk | Capping height introduces a second scroll region — only do it if device testing shows the current composition actually misbehaves. |
| Confidence | Medium (needs device verification) |

#### KUX-004 — Nothing ever tells you your workout was saved

| Field | Value |
| --- | --- |
| Surface | Log editor |
| Scenario | Type sets, leave |
| User type | All |
| Friction | Autosave fires 800 ms after the last keystroke but sets no message: `if (!autosave) setSaveSuccess('Saved on device')`. The explicit save inside *Done* does set it — and then `exitCurrentEditor()` immediately dismisses the keyboard and switches to read mode 150–250 ms later, at which point the editor (and its banner) is `display: none`. The ordinary edit path also renders **no Save button at all**; the button only exists for brand-new notes. |
| Category | Interpretation, error/trust |
| Frequency | Every workout |
| Severity | High |
| Evidence | `mobile/screens/log/useLogCurrentRoutineEditor.js:506` (`if (!autosave)`), `:624-643` (`handleDoneCurrent` → save → exit), `:527-547` (`exitCurrentEditor` 150–250 ms timeout); `components/LogScreenEditorCard.js:426-436` (Save button gated on `editingNoteId === 'new' \|\| (!editingNoteId && !currentId)`). |
| User consequence | "Did that save?" A text-first tracker whose entire value is *the text persisted* never confirms persistence. Users compensate by re-opening the note to check — an invisible tax. |
| Recommendation | One persistent, low-emphasis status line in the editor header area, driven by autosave state: `Saving…` → `Saved`. Not a toast, not a banner that self-clears. It replaces nothing and adds no control. |
| Expected improvement | Removes the verification re-open loop and the background anxiety; costs zero taps. |
| Risk | A permanently visible "Saved" could read as noise. Keep it at caption weight in `textMuted`, and let it be the only chrome in that slot. |
| Confidence | High |

#### KUX-005 — `Undo` destroys the whole session and sits next to `Done`

| Field | Value |
| --- | --- |
| Surface | Log editor header |
| Scenario | Finish logging, reach for *Done* |
| User type | All |
| Friction | The editor header renders `[Week A/B] [Merge weeks] [Undo] [Done]`. `handleUndoCurrent` writes `originalNoteState` — the note's contents at the moment the editor was **opened** — straight back to storage. No confirmation, no redo, no scope limit. A user who opened the editor twenty minutes ago and mis-taps loses everything logged since. |
| Category | Error, decision |
| Frequency | Rare |
| Severity | **Critical** (catastrophic intensity; irreversible; adjacency to the most-tapped control raises probability materially) |
| Evidence | `mobile/screens/LogScreen.js:1165-1188` (Undo immediately left of Done, same `styles.modeToggle` family); `screens/log/useLogCurrentRoutineEditor.js:645-668` (unconditional revert + persist, only an `Alert` on *failure*). |
| User consequence | The single worst possible outcome in a training log — losing logged work — is one mis-tap away from the button you press every session. |
| Recommendation | Two changes, both small. (1) Confirm before reverting when the note has changed since the editor opened: "Discard everything you've typed since opening this note?" — Kilo already uses exactly this confirm pattern for skip removal (`useLogCurrentRoutineEditor.js:817-828`) and routine deletion. (2) Separate it visually and spatially from *Done* — it is a discard, not a peer of the primary exit. |
| Expected improvement | Converts an irreversible one-tap loss into a two-tap deliberate act, without removing the capability. |
| Risk | One extra tap on a genuinely-wanted revert. Acceptable: reverting is rare, losing a session is not recoverable. |
| Confidence | High |

#### KUX-006 — Double-tap-to-edit is still wired but taught nowhere

| Field | Value |
| --- | --- |
| Surface | Log, current routine card |
| Scenario | Tap the note body expecting something |
| User type | New |
| Friction | `handleNoteBodyPress` opens the editor on a second tap within 300 ms. The explicit `Edit` control now supersedes it and the "Double-tap to edit" hint text was removed, but the gesture remains bound to the whole card body. A single tap does nothing at all. |
| Category | Discovery |
| Frequency | Occasional |
| Severity | Low |
| Evidence | `mobile/screens/log/useLogCurrentRoutineEditor.js:831-840`; `components/LogActiveRoutineCard.js:78-86` (the comment explicitly documents keeping it as a hidden path). |
| User consequence | Tapping the content does nothing, then unexpectedly does something. Minor, but it is a control with no label and no discoverability. |
| Recommendation | Keep it (it costs nothing and existing users have it in their fingers), but make the single tap on an exercise row do the useful thing from KUX-002. That converts a dead tap target into the product's best affordance. |
| Expected improvement | Removes a dead zone; no capability lost. |
| Risk | Single-tap-to-edit could fire while the user is trying to select text (`selectable={true}` is set throughout). Scope the tap target to the exercise header row, not the whole body. |
| Confidence | High |

#### KUX-007 — The note only grows, forever

| Field | Value |
| --- | --- |
| Surface | Log |
| Scenario | Week 30 of the same routine |
| User type | Power |
| Friction | Each session appends one line per exercise. `Skip week` appends one line per exercise *with history*, whether or not that exercise was involved. Nothing ever rolls over, archives, or collapses. At the audit the live routine is 242 lines with only ~4 session-columns; at 30 columns it would be roughly 1,000 lines, all of it re-parsed on **every keystroke** (`parsed = useMemo(() => parseWorkoutNote(workoutNoteText), [workoutNoteText])`). |
| Category | Repetition, latency, visual |
| Frequency | Every workout, compounding |
| Severity | High |
| Evidence | `mobile/lib/parser/workoutNote.js:393-406` (`applyWeekSkipToText`, one marker per eligible exercise, explicitly stacking on repeat presses); `screens/log/useLogCurrentRoutineEditor.js:217` (full re-parse per keystroke). **[E]** live note is 242 lines / 71 exercises / 42 with zero sets. |
| User consequence | Reading the routine gets slower every week; finding this week's line gets harder every week; the app gets *more* cumbersome with use, which is the explicit inverse of the stated philosophy. |
| Recommendation | In the **read** view only, collapse each exercise's history to the most recent 3 session-columns with a `+12 earlier` expander. The stored text is untouched; the editor still shows everything. This is a rendering change, not a data-model change, and it is the only one of the three obvious options (rollover, archive, collapse) that adds no concept the user has to learn. |
| Expected improvement | The read view stops degrading with tenure. Combined with KUX-002, the routine becomes a fixed-size surface regardless of history depth. |
| Risk | Users who scan back further than 3 sessions must expand. Acceptable — 3 columns is the window `deriveSessionCheckIn`'s own baselines use, and the expander is one tap. |
| Confidence | High |

#### KUX-008 — `Skip week` invents skips for exercises you never do

| Field | Value |
| --- | --- |
| Surface | Log, current routine card |
| Scenario | Travelled for a week; press *Skip week* |
| User type | Power |
| Friction | `applyWeekSkipToText` appends a `-` to **every exercise with at least one session entry** — which after the first press includes every exercise, since a skip marker *is* a session entry. Exercises the user has never performed accumulate skip records, which `deriveSkipData` then turns into `consecutive_exercise_skips` attendance flags, which feed the fatigue check-in's skip trigger. |
| Category | Error, interpretation |
| Frequency | Weekly (when used) |
| Severity | High |
| Evidence | `mobile/lib/parser/workoutNote.js:393-406`. **[E]** live `attendance_flags` flags `RDL` (2 consecutive), `DB Floor Press` (3), `Core: Ab wheel or in-and-outs` (3) — all with **zero logged sets ever**. `exercise_skips` holds 49 entries. |
| User consequence | Kilo tells the user they keep skipping things they never intended to do. The signal is manufactured by the button, so every derived attendance insight built on it is noise. |
| Recommendation | Restrict the skip marker to exercises that have at least one **real** (non-skip) session entry, and stop stacking: a press that would add a second consecutive skip to an exercise is a no-op for that exercise. Both are two-line changes to the `needsDash` predicate. |
| Expected improvement | Attendance flags start describing behaviour instead of button presses; the note grows more slowly (KUX-007). |
| Risk | A user who genuinely skips two weeks running loses the second marker. Acceptable — the note's session-column depth still advances, and "skipped twice" was never reliably distinguishable from "pressed twice" anyway. |
| Confidence | High |

#### KUX-009 — Kilo cannot tell you when anything happened

| Field | Value |
| --- | --- |
| Surface | Data model (affects Log, Analytics, Home) |
| Scenario | "When did I last squat 250?" / "Did I train last Tuesday?" |
| User type | All |
| Friction | A session is the *n*-th line under an exercise. No per-session date is stored anywhere except `session_checkins[idx].responded_at`, which exists only when a fatigue prompt was answered. Home's "Week N" is a Monday-span from `note.saved_at`, not from any logged activity. |
| Category | Cognitive, interpretation |
| Frequency | Always |
| Severity | High |
| Evidence | `mobile/lib/data/routineStatus.js:25-36` (`computeWeeksIn` = max session-entry depth); `lib/data/skipData.js` (`session_index` throughout, `date` only when the user typed one into a heading). **[E]** live `session_checkins` carries the only three timestamps that exist for four session-columns. |
| User consequence | The user cannot ask the most basic question a training log answers. This also silently distorts every derived metric: "latest session" is a column index, not a day. |
| Recommendation | **Do not** add a date picker or calendar UX — that is the thing Kilo deliberately rejects. Instead stamp a date automatically: when a save adds a new session-entry to an exercise, record `{exercise, columnIndex, savedAt}` in note metadata (a sibling of the existing `skip_markers` / `attendance_flags` maps). Zero user interaction, zero new syntax, zero new screen; the read view can then show `3 days ago` beside a set row, and Analytics gains a real time axis. |
| Expected improvement | Unlocks the entire category of "when" questions without asking the user for a single additional input. |
| Risk | Retroactive edits to old columns would stamp a wrong date. Stamp only on *append* (a new deepest column), never on modification of an existing one, and treat absence as unknown rather than guessing. |
| Confidence | Medium (mechanism is clear; exact metadata shape needs design) |

#### KUX-010 — `-` means "skipped set" after a weight but is illegal without one

| Field | Value |
| --- | --- |
| Surface | Parser |
| Scenario | Log a plank: 30 seconds, then failed the second set |
| User type | All |
| Friction | `REP_RE` accepts `-` as a skipped set inside a weighted row (`80 4,-` parses). The bodyweight branch requires `^\d+(,\d+)+$`, which rejects any `-`. The user gets `Invalid rep group — use: 8,8,8 (no trailing comma)` — which **misdiagnoses the problem**: there is no trailing comma, the `-` is the issue, and following the advice produces a row that means something different. |
| Category | Error, interpretation |
| Frequency | Every workout (for anyone logging bodyweight or timed work) |
| Severity | High |
| Evidence | `mobile/lib/parser/workoutRow.js:46-52` (bodyweight branch) vs `:71, :93` (weighted branch `REP_RE` allows `-`). **[E]** five live instances in the current routine (`3,3,-`, `30,-`, `2,2,-`, `20,20,-`, `10,10,-`), one of which sits inside a `+LIFTING` section and therefore renders as a **red ⚠ error the user has left in place for weeks**. |
| User consequence | A rule that works in one row shape and not another, explained by a message that points at the wrong character. The user's honest record of a failed set is thrown away. |
| Recommendation | Change the bodyweight rep-group regex to the same alphabet the weighted branch already uses (`(\d+\|-)(,(\d+\|-))*`), and emit `0`-rep skipped sets identically. Then correct the error text so it names the actual offending token. |
| Expected improvement | Removes an entire class of rejected rows from real notes, and makes the grammar internally consistent — one rule for "skipped set" everywhere. |
| Risk | `-` alone on a line already means "skipped session"; a lone `-` inside a comma group is unambiguous because the group form requires a comma. Low. |
| Confidence | High |

#### KUX-011 — A single number is never a valid row

| Field | Value |
| --- | --- |
| Surface | Parser |
| Scenario | Log a 60-second stretch, or 10 reps of one thing |
| User type | All |
| Friction | `_parseSetTokens` rejects a lone token: a standalone rep group "requires at least one comma to be unambiguous". So `60` fails but `60,60` succeeds. The message — `Enter reps as reps,reps or weight reps,reps` — states the rule but not the reason, and the rule is arbitrary from the user's side. |
| Category | Interpretation, error |
| Frequency | Every workout for anyone doing timed or single-set work |
| Severity | Medium |
| Evidence | `mobile/lib/parser/workoutRow.js:63-65`. **[E]** the rehab note contains `60` nine times (stretch durations) and `10`, `15`, `12/10`, all rejected; the current routine contains `8`/`9`/`10` under five separate `-Bike 5 min` headers. |
| User consequence | "Why do I have to type it twice?" The user writes what happened; Kilo refuses it for a parser-internal reason. |
| Recommendation | Accept a lone integer as one set of that many reps. The ambiguity the comma rule guards against (is `135` a weight with missing reps, or 135 reps?) is real but resolvable in favour of reps, because a bare weight with no reps is *already* an error (`Missing reps after weight`) and a one-token row currently has no valid meaning at all — so nothing is being disambiguated away from. |
| Expected improvement | Eliminates a large share of the rejected rows in real notes at zero user cost. |
| Risk | A user typing `225` meaning "225 lb, reps to follow" gets one set of 225 reps instead of an error. Mitigate by treating implausible rep counts (say > 100) as the existing error. |
| Confidence | Medium (the disambiguation heuristic needs a decision; the friction is High confidence) |

#### KUX-012 — There is no way to write a note

| Field | Value |
| --- | --- |
| Surface | Parser / Log read view |
| Scenario | "No PRs this week, treat it as maintenance" |
| User type | All |
| Friction | The only note syntax is `--`, which attaches to the immediately preceding **valid** logged entry and is taught nowhere. A standalone prose line is either swallowed as an unparsed row under whatever exercise precedes it, or — if no exercise is open — **silently discarded with no trace in the read view**. |
| Category | Interpretation, discovery |
| Frequency | Frequent |
| Severity | Medium |
| Evidence | `mobile/lib/parser/workoutNote.js:160-178` (`--` requires a preceding non-skipped, non-unparsed entry), `:124-133` (any line with no open exercise and no recognised prefix is `continue`d). **[E]** the three `HOME WEEK NOTES` lines at the end of the live routine produce zero parser output; `NO LIFTING. NO CORE.` in the rehab note is attached as an unparsed row under an unrelated jog interval. |
| User consequence | The user writes instructions to themselves in their own routine, and the app either buries them under the wrong exercise or deletes them from the view entirely. Content loss with no error. |
| Recommendation | Two parts. (1) Make `--` a first-class standalone note line: when no entry precedes it, render it as a section-level note rather than dropping it. (2) Render *any* unrecognised line that is not inside an exercise as a visible muted note rather than discarding it — never silently drop user text. Add `--` to the taught syntax (`WORKOUT_SYNTAX_ROW_EXPLANATIONS`). |
| Expected improvement | Kilo stops deleting things the user wrote. That is a floor, not a feature. |
| Risk | More visual noise in the read view for users with messy notes — which is exactly the honest representation of what they wrote. |
| Confidence | High |

#### KUX-013 — Editing the prescription forks the exercise's history

| Field | Value |
| --- | --- |
| Surface | Parser / Analytics |
| Scenario | Progress `-DB Bench Press 3x6-8` to `-DB Bench Press 4x6-8` |
| User type | Power |
| Friction | An exercise's identity is its normalised header text. `_normalizeExerciseName` strips a trailing ` 3x6-8`, a trailing ` *`, a trailing `\| …`, and a few other suffix forms — but only when they are at the **end**. `Core: Pallof Press 2x10 each side` keeps its entire prescription in the name; so does `DB Bench Press — 3×6-8, start at 70 lbs, build up if clean`. Change any of it and analytics sees a brand-new exercise with no history. |
| Category | Cognitive, interpretation |
| Frequency | Every routine rewrite or progression |
| Severity | High |
| Evidence | `mobile/lib/parser/workoutNote.js:36-47`. **[E]** the live account holds six duplicate identities for the same movements (`pallof press` / `core: pallof press`; `single-leg extension` / `single-leg calf extension`; `hammer shoulder press` / `hammer strength shoulder press`; `goblet calf raise` / `goblet calf raise — db on step`; `dead bugs 3x10 each side` / `core: dead bugs 3x8 each side`; `db curl` / `dumbbell curls` / `cable curls`) across `exercise_classifications`. |
| User consequence | Long-term progress charts quietly reset whenever the user does the normal thing of rewriting their programme. The user is unlikely ever to work out why. |
| Recommendation | Do not introduce an exercise picker or a catalog — that is the conventional-tracker trap Kilo exists to avoid. Instead: (a) treat a `Core:` prefix as a section marker, not part of the name, so `Core: Plank` and `Plank` are one exercise; (b) strip a trailing set×rep prescription wherever it appears in the header, not only at the end; (c) when a new exercise name is within a small edit distance of an existing one *in the same note*, show a one-line, dismissible read-view hint offering to merge. Never merge silently. |
| Expected improvement | Analytics history survives ordinary programme maintenance. |
| Risk | (c) is a suggestion surface and could nag. Make it appear once per new name, in the read view only, never as a modal. |
| Confidence | High for the defect; Medium for the specific remedy |

#### KUX-014 — A second `---` silently changes what Week B means

| Field | Value |
| --- | --- |
| Surface | Parser / Log editor |
| Scenario | Use `---` as a visual divider anywhere below the A/B split |
| User type | Power |
| Friction | `parseWorkoutNote` sets `weekBStartIndex` on **every** `---`, so the last one wins. `activeEditText` and `handleCurrentTextChange` slice the note at the **first** `---`. Only the boolean `weekBStartIndex !== null` is consumed, so the disagreement is invisible — but everything after the first separator becomes "Week B", including content the user meant as a footer. |
| Category | Interpretation |
| Frequency | Occasional |
| Severity | Medium |
| Evidence | `mobile/lib/parser/workoutNote.js:137-142` vs `screens/log/useLogCurrentRoutineEditor.js:267-274`. **[E]** the live routine has separators at lines 171 and 238; the parser reports `weekBStartIndex: 15` (equal to `sections.length`, i.e. from the *second* one), while the editor slices at line 171. |
| User consequence | A trailing notes block is filed inside Week B and hidden whenever Week A is active. |
| Recommendation | Make the first `---` authoritative in the parser too, and treat any subsequent `---` as ordinary content (rendered, not structural). One-line change; matches what the editor already does. |
| Expected improvement | Parser and editor agree; a common typographic habit stops having structural consequences. |
| Risk | None identified — no consumer reads the numeric index. |
| Confidence | High |

#### KUX-015 — Cardio exercises accept no input at all

| Field | Value |
| --- | --- |
| Surface | Parser |
| Scenario | Log 5 minutes on the bike at level 10 |
| User type | All |
| Friction | An exercise whose name matches `treadmill\|bike\|cycling\|elliptical\|run\|walk\|swim\|cardio\|rowing machine\|ski erg` is marked `currentExerciseNonWeight`, after which **every** row under it is routed to `unparsed_rows` unconditionally. There is no accepted syntax for duration, distance, pace, or level. |
| Category | Mechanical, interpretation |
| Frequency | Every workout (this user opens all five training days with a bike warm-up) |
| Severity | Medium |
| Evidence | `mobile/lib/parser/workoutNote.js:17, 121, 262-269`. **[E]** `8`/`9`/`10` under `-Bike 5 min` ×5 days in the live routine; `10 5`, `11 5`, `12 5`, `5 min 3.5,5` in the rehab note — every one rejected. |
| User consequence | The user logs their bike warm-up every session and Kilo throws all of it away, every time, silently (see KUX-016). |
| Recommendation | Either (a) accept the existing rep-group grammar for non-weight exercises and label the values "reps/units" rather than sets, or (b) stop special-casing these names and let the ordinary grammar apply — `10 5` then simply means "10 × 5", which is what the user meant. (b) is the smaller change and removes a hardcoded English word list. |
| Expected improvement | Warm-up and conditioning data stops being discarded; one fewer arbitrary rule. |
| Risk | Cardio values would enter volume/tonnage aggregates as if they were loads. Guard the aggregate, not the parser — `isStrengthExerciseName` already exists for exactly this. |
| Confidence | High |

#### KUX-016 — Rejected rows are muted into invisibility outside `+Lifting`

| Field | Value |
| --- | --- |
| Surface | Log read view |
| Scenario | A row fails to parse in a warm-up or an unlabelled section |
| User type | All |
| Friction | `WorkoutContentRenderer` passes `muted={mutedUnparsed \|\| section.kind !== 'lifting'}`. `kind` is `'lifting'` only when the `+` subheading matches `/lift/i`. In a `+WARMUP`, a `+COOLDOWN`, or any section with no `+` header at all, a rejected row renders as plain muted text with no ⚠ and no message — visually indistinguishable from content Kilo understood. |
| Category | Error, interpretation |
| Frequency | Frequent |
| Severity | Medium |
| Evidence | `mobile/components/WorkoutContentRenderer.js:119, 133, 189, 212`; `components/UI.js:343-366` (`UnparsedRow` drops the ⚠ and hint when `error` is absent, and mutes the raw line when `muted`). **[E]** every Week B section of the live routine has `subheading: null`, `kind: 'general'` — so all four of its rejected rows are silent. |
| User consequence | Data loss with no signal. The user believes it was recorded. |
| Recommendation | Show the ⚠ and the message wherever a parser error exists, regardless of section kind. Keep muting for genuinely non-erroring content (the alt-week preview). |
| Expected improvement | "Kilo didn't understand this" becomes visible everywhere instead of only in one section type. |
| Risk | Warm-up sections get visibly noisier — accurately so. Fixing KUX-011/KUX-015 removes most of the noise at the source. |
| Confidence | High |

#### KUX-017 — Choosing kg does not change what you type

| Field | Value |
| --- | --- |
| Surface | Settings / Parser / Log |
| Scenario | A metric user sets kg and logs `100 5` on the bench |
| User type | All metric users |
| Friction | `parseWorkoutRow` hardcodes `weight_unit: 'lb'` on every set it produces. `inputWeightToLb` — the entry-path conversion — is called for the bodyweight entry and the weight goal, and **nowhere in the workout-note path**. So the kg user's `100` is stored as 100 lb and rendered back to them as `45.4 kg`. The Settings copy admits this ("Workout notes and stored data stay in lb") but the app still lets the choice be made and still displays lift weights converted. |
| Category | Interpretation, error |
| Frequency | Every set of every workout |
| Severity | **Critical** for the affected population (currently zero of one real accounts, but every non-US user) |
| Evidence | `mobile/lib/parser/workoutRow.js:103` and `:57` (`weight_unit: 'lb'` hardcoded); `grep inputWeightToLb` → `lib/parser/weightEntry.js:21`, `screens/WeightScreen.js:220-232` only; `components/SettingsScreen.js:112` (the disclaimer). |
| User consequence | Every lift number in the app is wrong by a factor of 2.2, and the user's own typed values are silently reinterpreted. This is not a friction — it is a correctness failure that makes the product unusable outside imperial markets. |
| Recommendation | Convert on the entry path: interpret numeric loads in workout notes as the selected display unit and store canonical lb, exactly as `parseWeightEntry` already does. Round-trip stability matters — `formatLiftWeightValue` already rounds kg to one decimal, and `inputWeightToLb` rounds to one decimal lb, so `100 kg → 220.5 lb → 100 kg` holds. Until that ships, the kg selector should say what it does in the control itself, not only in help text below it. |
| Expected improvement | Makes Kilo usable for the majority of the world's lifters. |
| Risk | Existing notes were typed in lb; a user who switches to kg would have their history reinterpreted. Convert *display* of stored values (already done) and *interpretation* of newly typed values; do not rewrite stored text. Mixed-unit history is a real edge case that needs an explicit decision. |
| Confidence | High |

#### KUX-018 — Progressive Overload is empty and nothing says why

| Field | Value |
| --- | --- |
| Surface | Analytics |
| Scenario | Open Analytics after three months to see strength progress |
| User type | All |
| Friction | `deriveAnalytics` computes `globallyTrackedNames` from `trackedLifts` only — the exercises the user has explicitly tapped `Track` on. There is no default. The user's `tracked_exercises` is `[]`, so `visibleTrackedNames` is empty, `signals` is empty, and `groupedSignals.length === 0` — the headline strength table renders nothing after three months of daily logging. The only path in is a `Track` pill rendered next to **each of the 71 exercise names** in the Log read view. |
| Category | Discovery, decision |
| Frequency | Always |
| Severity | **Critical** |
| Evidence | `mobile/screens/analytics/analyticsDerivations.js:58-63`; `components/UI.js:230-264` (the per-exercise `Track` pill). **[E]** live `tracked_exercises = []` after 83 days of use and ~4 session-columns across 5 training days. |
| User consequence | The app's most-advertised analytics feature is blank for a committed power user, and the user does not know a step is missing — because Home is simultaneously showing 24 progress rows (KUX-019). |
| Recommendation | Track by default, correct by exception. On save, auto-track any exercise in the **current** routine that has at least two logged session-entries and passes `isStrengthExerciseName` — Kilo already computes exactly this population for `exercise_classifications`. Keep the `Track` pill as the opt-out and as the way to add something outside the heuristic. |
| Expected improvement | Analytics fills itself from behaviour instead of demanding 71 decisions. Directly answers "what does Kilo make the user do that the software should do?" |
| Risk | Over-tracking clutters the table. The two-session floor plus `isStrengthExerciseName` excludes warm-ups, stretches, and one-off experiments; anything else the user can untrack in one tap. |
| Confidence | High |

#### KUX-019 — Home shows progress for exercises you no longer do

| Field | Value |
| --- | --- |
| Surface | Home |
| Scenario | Glance at the dashboard |
| User type | Power |
| Friction | `computeWeeklySummary` builds Home's status rows from the note's **stored** `exercise_classifications` map, which `handleSave` derives over `[...getDefaultTrackedNames(), ...explicitlyTracked]` across **all** non-excluded notes. The result accumulates every exercise name the user has ever used, in any routine, and never prunes. Analytics, meanwhile, uses only explicitly-tracked names present in the *current* note. The two surfaces answer the same question from different populations. |
| Category | Interpretation, visual |
| Frequency | Every launch |
| Severity | High |
| Evidence | `mobile/lib/data/workoutAnalytics.js:448-493`; `screens/log/useLogCurrentRoutineEditor.js:416-464`. **[E]** live `exercise_classifications` holds 33 entries, 24 of them displayable; at least eight name exercises absent from the current routine (`pec deck`, `seated cable row`, `hammer strength iso row`, `goblet calf raise`, `goblet calf raise — db on step`, `calf raises at end of each set`, `hammer strength shoulder press`, `leg press (calf raise superset)`). |
| User consequence | A 24-row list on the dashboard, a third of which is archaeology, several rows of which are the same movement under two spellings. It looks like tracking is working, which is why KUX-018 goes unnoticed. |
| Recommendation | Scope Home's status rows to exercises present in the current routine, using the same population Analytics uses. One shared derivation, two surfaces. |
| Expected improvement | Home shrinks to a truthful, scannable list and stops masking the empty Analytics table. |
| Risk | Users lose visibility of lifts they have paused. That is the correct trade — the current routine is what "this week's progress" means. |
| Confidence | High |

#### KUX-020 — The App Guide describes a Home screen that does not exist

| Field | Value |
| --- | --- |
| Surface | More → App Guide |
| Scenario | New user reads the guide |
| User type | New |
| Friction | The guide says Home shows "a breakdown of your **tracked** exercises by progress status". Home in fact shows every classified exercise from every note regardless of tracking, and the live user has tracked none. The guide also tells the user to "tap it in your parsed log and tap 'Track'" without saying that Analytics' strength table is **empty** until they do. |
| Category | Interpretation, discovery |
| Frequency | First use |
| Severity | Medium |
| Evidence | `mobile/components/HelpScreen.js:37` and `components/WorkoutSyntaxReference.js:71`; contradicted by `lib/data/workoutAnalytics.js:459-479`. This violates the repo's own `docs/ui-design-rules.md` §11 ("Feature descriptions must state material prerequisites"). |
| User consequence | A user who follows the documentation still gets an empty chart and no explanation. |
| Recommendation | If KUX-018 ships, the copy becomes true by construction and this collapses into it. If it does not, correct the copy and put the prerequisite where the empty state is, not only in a guide behind two taps. |
| Expected improvement | Documentation stops actively misleading. |
| Risk | None. |
| Confidence | High |

#### KUX-021 — Tracking silently stops working when you rename an exercise

| Field | Value |
| --- | --- |
| Surface | Analytics |
| Scenario | Track `DB Bench Press`, then rewrite the routine as `DB Bench Press — 3×6-8, start at 70 lbs` |
| User type | Power |
| Friction | `visibleTrackedNames` filters the tracked set down to names present in the **current** note. A tracked name that no longer matches any header disappears from Analytics with no notice. Combined with KUX-013 (identity is the header text), any ordinary programme rewrite silently un-tracks lifts. |
| Category | Interpretation |
| Frequency | Every routine rewrite |
| Severity | High |
| Evidence | `mobile/screens/analytics/analyticsDerivations.js:55-61`. **[E]** the rehab note's header is `DB Bench Press — 3×6-8, start at 70 lbs, build up if clean`, a different identity from the current routine's `DB Bench Press`. |
| User consequence | Progress charts vanish for reasons the user cannot connect to anything they did. |
| Recommendation | Fixing KUX-013 (stable identity) and KUX-018 (track by behaviour) both dissolve this. If neither ships, surface it: when a tracked name has no match in the current routine, show it in the table with "not in your current routine" rather than removing the row. |
| Expected improvement | Tracking survives programme maintenance, or fails loudly instead of silently. |
| Risk | None for the loud-failure variant. |
| Confidence | High |

#### KUX-022 — Default tracked lifts are hardcoded to an abandoned split

| Field | Value |
| --- | --- |
| Surface | Analytics / Home |
| Scenario | Any |
| User type | All |
| Friction | `getDefaultTrackedNames()` returns 17 exercise names from `KILO_EXERCISES`, a fixed five-day split baked into the source. These drive `exercise_classifications` (and therefore Home) and the fatigue check-in's assessment set. Roughly half of them (`Pec Deck`, `Seated Cable Row`, `Hammer Strength Iso Row`, `Goblet Calf Raise`, `Single-Leg Extension`, `Leg Press`, `Hammer Curl`, `Pallof Press`) do not match anything the live user has trained in months. |
| Category | Cognitive, interpretation |
| Frequency | Always |
| Severity | Medium |
| Evidence | `mobile/lib/data/exerciseCatalog.js:11-93`; consumed at `screens/log/useLogCurrentRoutineEditor.js:418, 588`. **[E]** name-by-name comparison against the live routine: 6 of 17 match, 11 do not; 5 exercises the user trains 3×/week (`Barbell Row`, `Lateral Raise`, `Face Pulls`, `Hammer Shoulder Press`, `Single-arm pushdown`) are absent from the defaults. |
| User consequence | The app's opinion about which of your lifts matter was fixed before you installed it, and it is wrong. |
| Recommendation | Delete the default list once KUX-018's behaviour-derived tracking exists. Keep `KILO_EXERCISES` only for what it is genuinely good at — `isStrengthExerciseName`'s warm-up exclusion. |
| Expected improvement | Removes a hidden, un-editable opinion from the middle of the analytics pipeline. |
| Risk | Nothing to track on day one. Correct — there is nothing to say on day one. |
| Confidence | High |

#### KUX-023 — The plate calculator is an unmarked tap on plain text

| Field | Value |
| --- | --- |
| Surface | Log read view |
| Scenario | Wonder how to load 245 |
| User type | All |
| Friction | Every weight value in a set line is a `Pressable` that opens `PlateCalculatorModal`. It looks exactly like the reps beside it — no underline, no icon, no colour change. It is also offered for dumbbell and machine loads (`100 8,8,7` on DB Bench, `72.5` on Hammer Press), where plate maths is meaningless. |
| Category | Discovery, interpretation |
| Frequency | Occasional |
| Severity | Low |
| Evidence | `mobile/components/UI.js:286-298`. **[E]** the live routine's loads are predominantly dumbbell/machine values. |
| User consequence | A useful tool nobody finds, and a surprise modal for anyone who taps a weight for another reason (e.g. trying to select text — `selectable` is on). |
| Recommendation | Either give it a real affordance on barbell-plausible loads only, or delete it. Given how little of this user's training is barbell work, deletion is defensible; a small `▦` glyph on values that are plausible barbell loads is the cheaper middle path. |
| Expected improvement | Removes an invisible tap target from the reading surface. |
| Risk | Losing a feature some users like. Low — it is currently undiscoverable. |
| Confidence | Medium |

#### KUX-024 — The fatigue check-in blocks the exit

| Field | Value |
| --- | --- |
| Surface | Log editor → Done |
| Scenario | Finish logging and leave |
| User type | All (feature defaults on) |
| Friction | `handleDoneCurrent` runs `_runCheckInDetection()` between the save and the exit. When it fires, a modal takes the screen at the exact moment the user has declared they are finished. Tapping outside or ✕ defers without recording, so the same prompt can return later. |
| Category | Interruption |
| Frequency | Occasional (cooldown is 3 session-indices) |
| Severity | High (intensity of a blocking modal at the moment of exit) |
| Evidence | `mobile/screens/log/useLogCurrentRoutineEditor.js:624-643`; `components/SessionCheckInModal.js:154-230`. **[E]** three answered check-ins in three months, the last on 2026-06-30 — 52 days before the most recent note edit. |
| User consequence | "I said Done." The one moment the product should get out of the way is the one it chooses to ask a question. |
| Recommendation | Do not delete the feature — the three stored responses carry real content ("Back seized up on deadlifts", "Injury persists, have to rest this week") and one of them precedes the recovery block the user later started. Move it out of the exit path: mark the session in the read view (the inline flagging already exists via `roughFlaggedNames`) and let the user tap it to answer. The interruption becomes an invitation. |
| Expected improvement | "Type and move on" is restored at the exact point it is currently violated, with no loss of data capture for users who want it. |
| Risk | Fewer responses. Acceptable — a deferred prompt already produces no record, and an unanswered check-in costs nothing. |
| Confidence | High |

#### KUX-025 — "The latest session" spans five weekdays and both A/B weeks

| Field | Value |
| --- | --- |
| Surface | Fatigue check-in / Analytics |
| Scenario | Log Monday; get asked about "this session" |
| User type | All |
| Friction | `deriveSessionCheckIn` defines the latest session as `computeWeeksIn(sections) - 1` — the deepest session-entry column found anywhere in the note. `_runCheckInDetection` parses the **full** note text, so that includes every weekday and both A/B weeks. Skips from Tuesday, Friday, and the home-week variant are all attributed to one "session". |
| Category | Interpretation |
| Frequency | Occasional |
| Severity | Medium |
| Evidence | `mobile/lib/data/workoutAnalytics.js:207-267`; `screens/log/useLogCurrentRoutineEditor.js:594-597`. **[E]** live `session_checkins["3"]` flagged **15 exercises spanning all five training days** as skipped in a single session record. |
| User consequence | The app's account of "what happened in that session" is not a session. Any user who reads the flagged list will see it is wrong, which discredits the feature. |
| Recommendation | Scope detection to the section (day) the user actually edited, which the caret position or the diff between saved and previous text identifies. Failing that, scope at minimum to the active A/B week — `activeWeekParsed` is already computed and already excludes the other week. |
| Expected improvement | The question matches the thing the user just did. |
| Risk | Fewer triggers. That is a feature. |
| Confidence | High |

#### KUX-026 — Two advanced features are on before you know what they are

| Field | Value |
| --- | --- |
| Surface | Settings |
| Scenario | First week of use |
| User type | New |
| Friction | `DEFAULT_FEATURE_TOGGLES = { fatigueTrackingEnabled: true, deloadModeEnabled: true }`. A new user therefore gets a Deload sub-tab inside Log and a fatigue check-in modal, before they have logged a second session or encountered either concept. Both terms are explained only in the App Guide's Terminology card, two taps deep in More. |
| Category | Cognitive, discovery |
| Frequency | First use |
| Severity | Medium |
| Evidence | `mobile/hooks/entries/featureToggleHooks.js:5`; `screens/LogScreen.js:911-920` (Deload tab visibility); `components/HelpScreen.js:133-136`. |
| User consequence | A "type your workout" app greets the user with two unexplained modes. |
| Recommendation | Default both off. Offer Deload when the routine has enough logged history for a deload to be meaningful (`sessionsSinceLastDeload` already exists), and offer fatigue tracking the first time a rough-session detector would have fired. Feature discovery earned by data, exactly as `deriveFirstUseState` already does for routine adoption. |
| Expected improvement | The first-run surface shrinks to the one thing that matters — the note. |
| Risk | Existing users must not be silently switched off. Default only for accounts with no stored toggle value. |
| Confidence | High |

#### KUX-027 — The navigation bar spends most of its life at 25% opacity

| Field | Value |
| --- | --- |
| Surface | App shell |
| Scenario | Reading anything |
| User type | All |
| Friction | `TabBar` fades to `opacity: 0.25` two seconds after mount, returns to 1.0 on touch, and fades again 1.5 s after the touch ends. Scrolling also drives it to 0.25. Its labels are already `colors.textMuted` at 13 px; at 25% opacity over arbitrary content they are far below any contrast floor, and the bar is a floating pill with no background plate behind it. |
| Category | Visual, discovery, accessibility |
| Frequency | Always |
| Severity | High |
| Evidence | `mobile/components/TabBar.js:30-65, 94-128`. Contrast cannot be computed without a render, but 25% opacity on `textMuted` cannot satisfy WCAG 1.4.3 against any background. **Needs device verification** for exact measured contrast. |
| User consequence | The primary navigation is, by default, nearly invisible — including the indication of which tab you are on. Users tap it to see it, then it fades again. |
| Recommendation | Keep the fade as a *de-emphasis*, not a disappearance: floor it at ~0.75, or fade the container's background while holding label opacity at 1.0. The design intent (content-first, unobtrusive chrome) survives; the accessibility failure does not. |
| Expected improvement | Navigation is legible without a preparatory tap. |
| Risk | Slightly less "invisible chrome". The intent is preserved at 0.75. |
| Confidence | High for the behaviour; Medium for the exact floor |

#### KUX-028 — Five tabs for a two-loop product

| Field | Value |
| --- | --- |
| Surface | IA |
| Scenario | Every session |
| User type | All |
| Friction | Home is read-only and duplicates data available one tab away. More holds six rows, five of which are visited a handful of times ever. Log and Weight carry the entire daily loop. Five equal-weight tabs give a permanent 20% of the navigation budget to a settings menu. |
| Category | Navigation |
| Frequency | Always |
| Severity | Medium |
| Evidence | `mobile/App.js:53` (`TABS`); `screens/MoreScreen.js:140-183` (six rows); `screens/HomeScreen.js` (no data entry — every action is `onNavigate`). |
| User consequence | Not painful, but it is scaffolding the product does not need, and it is what pushes Log's own sub-navigation into a second tab strip (KUX-029). |
| Recommendation | **Do not restructure now.** The benefit is real but modest, and the changes in P0/P1 alter what Home and Log contain — restructuring before those land would be reorganising the wrong contents. Revisit once Home is scoped to the current routine (KUX-019) and Log has a single surface (KUX-001): at that point Home may have nothing left that Log does not show better, and a four-tab bar with More behind a header control becomes the obvious shape. |
| Expected improvement | Deferred. |
| Risk | Reorganising navigation for its own sake is the classic audit failure. Explicitly declined for now. |
| Confidence | Medium |

#### KUX-029 — A tab strip inside a tab

| Field | Value |
| --- | --- |
| Surface | Log |
| Scenario | Open Log |
| User type | All |
| Friction | Log renders its own Recovery / Routine / Deload strip above the content, so the user reads two levels of tabs stacked. Which of the three exists depends on a settings toggle (Deload) and on recovery state, so the strip's shape changes underneath the user. `handleTabViewChange` additionally **refuses** to leave Recovery while an inline recovery edit is open, with no explanation rendered — the presses simply do nothing (the tabs are `disabled`, styled only by `accessibilityState`). |
| Category | Navigation, interpretation |
| Frequency | Every workout |
| Severity | Medium |
| Evidence | `mobile/screens/LogScreen.js:890-922` (strip), `:808-812` (`handleTabViewChange` silent refusal), `:903-919` (`disabled` with no visual disabled treatment). |
| User consequence | A second navigation model to hold in mind on the product's core screen, plus a state in which tapping a visible tab does nothing at all. |
| Recommendation | Fixing KUX-001 (Recovery becomes a banner) and KUX-026 (Deload off by default) leaves the strip with one item in the common case, at which point it should not render. Independently: when a tab is refused, disable it *visibly* or, better, show the inline editor's Save/Cancel in a position that does not require trapping the user. |
| Expected improvement | Log becomes one surface again for the majority of sessions. |
| Risk | None — the strip already self-hides when only Routine qualifies. |
| Confidence | High |

#### KUX-030 — Two ordinary menu rows are permanently red

| Field | Value |
| --- | --- |
| Surface | More |
| Scenario | Open More |
| User type | All |
| Friction | `menuItemRisky` gives Account and Data & Backup a `colors.error` border. These are navigation rows to sub-screens; they perform no action. The destructive actions inside them already have their own Danger Zone treatment (`docs/ui-design-rules.md` §14). |
| Category | Visual, interpretation |
| Frequency | Occasional |
| Severity | Low |
| Evidence | `mobile/screens/MoreScreen.js:156-169, 201-205`. |
| User consequence | Alarm colouring on 2 of 6 rows dilutes the meaning of red everywhere else — including inside those very screens, where it actually matters. |
| Recommendation | Remove the error border from the navigation rows. Keep the existing subtitles ("Sign-in & cloud account", "Local & cloud backup"), which already do the warning work honestly. |
| Expected improvement | Red goes back to meaning "this destroys something". |
| Risk | None. |
| Confidence | High |

#### KUX-031 — Recovery blocks are a five-modal lifecycle

| Field | Value |
| --- | --- |
| Surface | Log → Recovery |
| Scenario | Come back from a back injury |
| User type | Power |
| Friction | The feature ships `RecoveryBlockStartModal`, `RecoveryBlockWeekModal`, `RecoveryBlockEndModal`, an Add Week modal, a Reopen confirmation, a per-week Unlink action, an inclusion toggle, a journaled operation log with a `Retry recovery` affordance, and a mutex serialising all of it. `LogRecoverySection.js` alone is 58 KB. |
| Category | Cognitive, decision |
| Frequency | Rare |
| Severity | Medium (low frequency, high intensity, and it imposes cost on the common path via KUX-001) |
| Evidence | `mobile/components/LogRecoverySection.js` (58 KB), `hooks/entries/recoveryBlockHooks.js` (61 KB), `screens/LogScreen.js:189-217, 547-758`. **[E]** the live account has exactly one block, opened 2026-08-08, one week attached, never completed after 13 days. |
| User consequence | The user started a recovery block and has not finished it. The unfinished state then costs them a tap on every launch (KUX-001) and quietly excludes their rehab weeks from analytics. |
| Recommendation | Do not remove it — the underlying need is real and evidenced (an injury, a rehab routine, a check-in saying "have to rest this week"). But the block should not need *ending*. Close it automatically when the baseline routine becomes current again and logs a full session, and make "include in normal analytics" a single choice at that moment rather than a separate persistent toggle. That removes the End modal, the Reopen path, and the reason the block is still open today. |
| Expected improvement | The feature stops requiring maintenance from a user who is, by definition, dealing with something else. |
| Risk | Auto-closing could surprise. Make it a one-line, undoable notice in the Recovery banner rather than a silent state change. |
| Confidence | Medium |

#### KUX-032 — The weigh-in Note field has never been used, and it is in the way

| Field | Value |
| --- | --- |
| Surface | Weight |
| Scenario | Daily weigh-in |
| User type | All |
| Friction | The form is `[Weight] [Note] [Save weigh-in]`. The Note field sits directly between the value the user types and the button they must press. The date — a field with an actual use case — is already correctly collapsed behind a `DateDisclosureRow`. |
| Category | Mechanical, visual |
| Frequency | Daily (the highest-frequency interaction in the product) |
| Severity | Medium |
| Evidence | `mobile/screens/WeightScreen.js:459-479`. **[E]** `note` is populated on **0 of 136** live weight entries across 83 days. |
| User consequence | Every weigh-in traverses a control that has never once been used, and the primary action is pushed further from the thumb. |
| Recommendation | Put Note behind the same disclosure row the date already uses. Zero capability removed, one control removed from the daily path. |
| Expected improvement | The most frequent action in the app becomes type → tap, adjacent. |
| Risk | Users who do write notes need one extra tap. Given 0/136 usage on the only real account, the trade is clear — though this is one user, so keep the control, do not delete it. |
| Confidence | High |

#### KUX-033 — The weight placeholder is a stranger's weight

| Field | Value |
| --- | --- |
| Surface | Weight |
| Scenario | Daily weigh-in |
| User type | All |
| Friction | The placeholder is a hardcoded `185.0` (or `84.0` in kg). The user's last weigh-in — which is within a pound of today's answer on 83 consecutive days of live data — is already loaded on screen and is not used. |
| Category | Memory, mechanical |
| Frequency | Daily |
| Severity | Low |
| Evidence | `mobile/screens/WeightScreen.js:462`. **[E]** live entries move by a median of well under 1.5 lb day to day (191.7–201.2 over three months). |
| User consequence | Trivial, but it is a free improvement Kilo is declining: the app knows the answer to within a pound and shows a stranger's number instead. |
| Recommendation | Use the last weigh-in as the placeholder (not the value — never pre-fill a measurement the user must actually take). |
| Expected improvement | Confirms the field's meaning, gives an anchor, costs nothing. |
| Risk | Pre-*filling* would be dangerous (a tap-through would record a fabricated measurement). Placeholder only. |
| Confidence | High |

#### KUX-034 — Junk notes accumulate with no cleanup

| Field | Value |
| --- | --- |
| Surface | Log → More Routines |
| Scenario | Experiment once |
| User type | All |
| Friction | Notes can be created with an empty body, an empty title, or a whitespace-only title, and there is no prompt, no expiry, and no bulk cleanup. They then sit permanently in the More Routines disclosure and — via `pickAdoptableRoutine`, which sorts by `saved_at` — can become the routine the first-use card offers to adopt. |
| Category | Repetition, error |
| Frequency | Occasional; permanent once it happens |
| Severity | Medium |
| Evidence | `mobile/screens/log/useLogOtherRoutineEditor.js` (`handleCreateRoutine`); `lib/guidedEntry.js:pickAdoptableRoutine`. **[E]** four live residue notes: `Test` (3 chars), `test` (6), `test ` (**0 chars, trailing space in the title**), `Untitled Routine` (32). |
| User consequence | The routine list is 44% junk on the only real account. |
| Recommendation | Do not add a cleanup screen. Instead: refuse to persist a note whose body is empty *and* whose title is untouched, and trim titles on save. A note the user never typed into was never a routine. |
| Expected improvement | The list stays clean without the user having to maintain it. |
| Risk | A user who wants an empty placeholder note cannot make one. Acceptable. |
| Confidence | High |

#### KUX-035 — Trying the example leaves a permanent note

| Field | Value |
| --- | --- |
| Surface | Log editor, empty note |
| Scenario | Tap "Tap to try this example" to see how it works |
| User type | New |
| Friction | The seed block inserts `WORKOUT_SEED_EXAMPLE_TEXT` into the draft. Once the draft is non-empty it saves like any other note, defaulting the title to `Untitled Routine`. Exploring the teaching affordance creates a persistent artefact. |
| Category | Error, discovery |
| Frequency | Once per user |
| Severity | Medium (it is the first thing a new user does) |
| Evidence | `mobile/components/LogScreenEditorCard.js:186-191, 354-366`; `lib/data/exerciseCatalog.js:146` (`title = 'Untitled Routine'` default). **[E]** the live account holds a 32-character `Untitled Routine` note — exactly the seed text's length. |
| User consequence | Experimentation is not free. The user learns that touching things in Kilo leaves residue. |
| Recommendation | Covered by KUX-034 if the seed text is treated as "not yet typed into" — but better: keep the seed insert, and if the user leaves the editor with the text *unchanged from the seed*, discard the note. The comparison is a string equality. |
| Expected improvement | Makes the teaching affordance genuinely safe to try, which is the point of it. |
| Risk | A user who genuinely wants the example as their routine loses it. They will have edited it — that is what the example is for. |
| Confidence | High |

#### KUX-036 — "Permanently erases" is not what happens

| Field | Value |
| --- | --- |
| Surface | Log → Delete routine |
| Scenario | Delete a routine |
| User type | All |
| Friction | The confirm says "permanently erases the workout history logged in this note… This cannot be undone." In the cloud the row is soft-deleted: `deleted_at` is set and `raw_text` is retained. The statement is true from the device's perspective and false from the account's. |
| Category | Interpretation |
| Frequency | Rare |
| Severity | Low (as a UX matter; this audit does not assess the retention contract) |
| Evidence | `mobile/screens/log/useLogOtherRoutineEditor.js:684-706`. **[E]** live `workout_notes` rows for `Routine 1`, `Test`, `test` carry `deleted_at` **and** their full `raw_text` (4,922 / 3 / 6 chars). |
| User consequence | None felt today — but the copy makes a promise the system does not keep, and users of a local-first, privacy-positioned product are exactly the ones who will care. |
| Recommendation | Say what happens: deleted from this device and from your account, retained briefly as a tombstone so the deletion syncs. Or make the cloud copy actually purge. Either is fine; the mismatch is not. |
| Expected improvement | The strongest claim the app makes about data destruction becomes accurate. |
| Risk | None. |
| Confidence | High |

#### KUX-037 — Cross-screen links refuse with a dead-end alert

| Field | Value |
| --- | --- |
| Surface | Log |
| Scenario | Tap a note link from Home/Analytics while an editor is open |
| User type | All |
| Friction | The navigation-intent effect refuses terminally and raises `Alert.alert('Finish your edit first', 'Tap Done to close the note you are editing, then try opening that note again.')`. The intent is discarded, so the user must remember where they were going and repeat the whole journey after pressing Done. |
| Category | Navigation, memory |
| Frequency | Occasional |
| Severity | Low |
| Evidence | `mobile/screens/LogScreen.js:373-382`. |
| User consequence | An alert that tells you to do something and then makes you start over. |
| Recommendation | Since Done already saves and there is autosave underneath it, the honest options are (a) save and navigate, or (b) keep the refusal but retain the intent and apply it once the editor closes. (b) is one ref, and the comment at the call site explicitly rejected it on "surprise navigation" grounds — which is right for a *silent* replay, but the user was just told to press Done, so replay is expected, not surprising. |
| Expected improvement | The instruction the alert gives actually completes the journey. |
| Risk | Replaying a stale intent much later. Expire it when the editor closes for any reason other than the Done the alert asked for. |
| Confidence | Medium |

---

## 4. Prioritisation

### Top 10 "Fuck This" risks

Ordered by likelihood of producing real frustration, avoidance, or abandonment.

1. **KUX-005** — `Undo` beside `Done` wipes the session irreversibly. The only finding here that can destroy user data in one tap.
2. **KUX-017** — kg is display-only. For a metric user every number in the app is wrong; there is no recovery and no workaround.
3. **KUX-002** — Hunting for the line in a 170-line text field, every exercise, every session. The dominant cost of using Kilo.
4. **KUX-018** — Three months of disciplined logging, and the strength analytics screen is blank.
5. **KUX-004** — No save confirmation, ever, in an app whose whole value is that the text persisted.
6. **KUX-012** — Kilo silently deletes prose the user wrote into their own routine.
7. **KUX-010** — A skipped set is expressible for barbell work and rejected for bodyweight work, with an error that names the wrong character.
8. **KUX-001** — Opening Log to write your workout and landing somewhere else.
9. **KUX-024** — A modal at the exact moment you pressed Done.
10. **KUX-007** — The app gets slower and harder to use the longer you use it.

### Top 10 repeated friction costs (intensity × frequency)

| Rank | ID | Per occurrence | Occurrences | Why it ranks here |
| --- | --- | --- | --- | --- |
| 1 | KUX-002 | ~5–15 s of scrolling and precise tapping | 4–6 × per session, ~250 sessions/yr | ≈ 1,500 hunts per year for one user |
| 2 | KUX-007 | grows monotonically | every session | the cost of #1 rises every week |
| 3 | KUX-004 | a moment's doubt, sometimes a re-open | every session | trust tax, invisible but constant |
| 4 | KUX-001 | 1 tap + reorientation | every cold start | pure overhead on the core journey |
| 5 | KUX-032 | traversing a never-used field | daily (83 days observed) | highest raw frequency in the product |
| 6 | KUX-010 | one row silently or redly rejected | every bodyweight/timed exercise | 5 live instances standing unfixed |
| 7 | KUX-015 | warm-up data discarded | 5 × per week (bike opens every day) | 100% loss rate on a logged activity |
| 8 | KUX-011 | retype a value twice to satisfy the grammar | several per session | arbitrary from the user's side |
| 9 | KUX-029 | a second navigation model to parse | every Log open | small, unavoidable, permanent |
| 10 | KUX-027 | tap to make the nav legible | every navigation | affects every journey in the app |

### Top 10 simplification opportunities

Things that can be removed, merged, inferred, remembered, or defaulted.

1. **KUX-018** — Infer tracking from what you actually log. Removes 71 per-exercise decisions.
2. **KUX-022** — Delete the hardcoded 17-exercise default list once tracking is inferred.
3. **KUX-031** — Auto-close a recovery block when the baseline routine resumes. Removes the End modal, the Reopen path, and a persistent toggle.
4. **KUX-026** — Default Deload and Fatigue off. Removes a sub-tab and a modal from first run.
5. **KUX-029** — With #3 and #4, Log's inner tab strip disappears in the common case.
6. **KUX-032** — Collapse the weigh-in Note behind the disclosure the date already uses.
7. **KUX-008** — Stop stacking skip markers. Removes lines from the note and false flags from analytics.
8. **KUX-019** — One shared progress derivation for Home and Analytics instead of two disagreeing ones.
9. **KUX-023** — Remove or mark the invisible plate-calculator tap target.
10. **KUX-030** — Remove decorative error-red from two navigation rows.

### First-time user failures

- **The empty state teaches five lines of syntax; the parser has twelve constructs.** `WORKOUT_SYNTAX_ROW_EXPLANATIONS` covers `-Bench`, `135 5,5,5`, `140 5,5`, `-`, `12,12`. It never mentions `--`, `---`, `+`, `*`, `Core:`, numbered headers, the ` - ` prose tail, or the in-row skip `80 4,-`. A user cannot discover half the grammar. (KUX-012)
- **Trying the example creates a permanent note.** (KUX-035)
- **"Each new line is a new session" is the load-bearing concept and gets one clause.** The mental model — *lines are sessions, not sets* — is the single thing that must land, and it is taught as an aside on the `140 5,5` row.
- **Two unexplained modes are on before the first workout.** (KUX-026)
- **`Track` is the prerequisite for the entire Analytics tab and is taught only in the App Guide.** (KUX-018, KUX-020)
- **Warm-ups, stretches, and cardio cannot be logged.** A new user writing what they actually did will have 20–30% of it rejected. (KUX-011, KUX-015)
- **The navigation is at 25% opacity within two seconds of first launch.** (KUX-027)

### Power-user failures

- **Analytics is empty after three months.** (KUX-018) — observed, not hypothesised.
- **History forks on every programme rewrite.** (KUX-013, KUX-021) — six live duplicate identities.
- **The note grows without bound and the read view never compacts.** (KUX-007)
- **Attendance insights are artefacts of a button.** (KUX-008) — 49 skip records, 10 flags, several for exercises never performed.
- **Home shows archaeology.** (KUX-019) — 24 rows, a third stale.
- **An abandoned recovery block silently taxes every launch and excludes weeks from analytics.** (KUX-001, KUX-031) — open 13 days at audit time.
- **No way to answer "when".** (KUX-009)

### Hidden capability problems

| Capability | Where it lives | Why it is hidden |
| --- | --- | --- |
| `--` comment lines | `workoutNote.js:160-178` | taught nowhere; requires a preceding valid entry |
| `---` A/B weeks | `workoutNote.js:137-142` | taught nowhere; the Week A/B pill only appears once the note already contains one |
| `*mark` star annotations | `workoutRow.js:13-16` | taught nowhere; renders as `★ PR` |
| ` - ` inline prose tail | `workoutRow.js:129-148` | taught nowhere |
| `Core:` and `1.` headers | `workoutNote.js:227-237` | taught nowhere; `Core:` silently becomes part of the exercise identity |
| In-row skipped set `80 4,-` | `workoutRow.js:71` | taught nowhere; and does not work in the bodyweight form (KUX-010) |
| Plate calculator | `UI.js:286-298` | no affordance at all |
| Double-tap to edit | `useLogCurrentRoutineEditor.js:831` | hint text deliberately removed |
| `Track` → Analytics | `UI.js:230-264` | the gate on an entire tab, presented as a small pill among 71 |
| Merge weeks | `LogScreen.js:1155-1164` | only visible while editing an A/B note |

### Error-recovery problems

- **`Undo` is the only undo, it is total, and it is irreversible.** (KUX-005)
- **A rejected row is the user's only record of what happened, and outside `+Lifting` it is rendered as if it were fine.** (KUX-016)
- **Error messages misdiagnose.** `3,3,-` → "no trailing comma". (KUX-010)
- **A save failure keeps the text but the user may never learn a save succeeded either.** (KUX-004)
- **Deleting a routine deletes every session logged in it**, with a text-only confirm and no offer to export first. `BackupScreen` exists; the delete path does not mention it. (KUX-036 and the register entry for delete)
- **Recovery operations have a journal, a retry affordance, and a mutex** — genuinely good engineering — but the user-facing result is a "Retry recovery" button whose failure mode they cannot interpret.
- **Silent content loss:** lines with no open exercise are `continue`d out of existence. (KUX-012)

### Real-usage findings

Things the cloud-synced account showed that code inspection alone would not have established.

1. **Tracking has never been used.** `tracked_exercises = []` after 83 days. This converts KUX-018 from "a discoverability concern" into "the feature is dead in the field". **[E]**
2. **Analytics and Home disagree, and the disagreement hides the failure.** 33 stored classifications vs. 0 tracked lifts. **[E]**
3. **The user writes non-`weight × reps` data constantly and Kilo rejects all of it** — 21 rejected rows in the current routine, ~34 in the rehab note. Reading the parser suggests this is possible; the account proves it is habitual. **[E]**
4. **The bodyweight skip marker is a belief the user holds and the parser does not honour** — five independent instances of `n,n,-`. **[E]** A code-only audit would have classified this as an edge case. It is this user's normal.
5. **Attendance flags fire for exercises never performed** — `RDL`, `DB Floor Press`, three Core lines. Only the stored `attendance_flags` reveal that the skip mechanic manufactures its own input. **[E]**
6. **The weigh-in note field is at 0/136.** No amount of code reading establishes that a field is unused. **[E]**
7. **A recovery block has been open and unfinished for 13 days**, which is what makes KUX-001 a daily cost rather than a theoretical one. **[E]**
8. **44% of the notebook is junk** (4 of 9 notes), one of which is a byte-exact abandoned seed example. **[E]**
9. **The routine carries a live exercise called `bottles test`** with two logged sets — experimentation residue promoted to permanent programme content and to analytics. **[E]**
10. **Three fatigue check-ins in three months, the last 52 days before the most recent edit**, two of them recording a real injury ("Back seized up on deadlifts") that preceded the recovery block. The feature's *content* is valuable; its *cadence* is not working. **[E]**
11. **The user's routine ends with three lines of guidance to themselves that the app deletes from the view entirely.** Only running the shipped parser over the real text surfaces this. **[E]**

---

## 5. Priority plan

The minimum set of changes that materially improves Kilo. Everything else in the
register is either downstream of these or genuinely small.

### P0 — fix immediately (3)

| # | Change | Eliminates | Why now |
| --- | --- | --- | --- |
| P0-1 | Confirm before `Undo` reverts a changed note, and move it out of the header slot adjacent to `Done` | KUX-005 | One mis-tap can destroy a logging session with no recovery. Cheapest possible fix for the worst possible outcome. |
| P0-2 | Convert workout-note loads on the entry path using the selected unit | KUX-017 | Not friction — a correctness failure that makes the product unusable for most of the world. |
| P0-3 | Log always opens on the Routine sub-tab; recovery state becomes a banner above the routine card | KUX-001, part of KUX-029 | Costs a tap and a reorientation on the single most frequent journey, right now, in production, for the only real user. |

### P1 — high leverage (5)

| # | Change | Eliminates | Notes |
| --- | --- | --- | --- |
| P1-1 | Tapping an exercise in the read view opens the editor with the caret positioned at the end of that exercise's block | KUX-002, KUX-003 (mostly), KUX-006 | The single highest-leverage change available. Uses the `selection` prop the seed insert already uses. |
| P1-2 | Track by behaviour: auto-track current-routine exercises with ≥2 logged entries that pass `isStrengthExerciseName`; keep the pill as opt-out | KUX-018, KUX-020, KUX-021 (partly), KUX-022 | Turns a dead feature on for every existing user with no action from them. |
| P1-3 | Fix the row grammar: allow `-` in bodyweight rep groups, accept a lone integer, correct the error text, stop special-casing cardio names | KUX-010, KUX-011, KUX-015 | Removes ~21 rejected rows from the live routine and ~34 from the rehab note. |
| P1-4 | Persistent autosave status in the editor (`Saving…` / `Saved`) | KUX-004 | One caption. Removes the trust tax from every session. |
| P1-5 | Never discard user text: render standalone `--` and unrecognised out-of-exercise lines as visible notes; show the ⚠ and message regardless of section kind | KUX-012, KUX-016 | Content loss is a floor violation, not a polish item. |

### P2 — polish (7)

| # | Change | Eliminates |
| --- | --- | --- |
| P2-1 | Collapse each exercise's history to the last 3 columns in the read view, with an expander | KUX-007 |
| P2-2 | Scope Home's progress rows to the current routine, sharing Analytics' derivation | KUX-019 |
| P2-3 | Skip markers only on exercises with real history; no stacking | KUX-008 |
| P2-4 | Weigh-in Note behind a disclosure; last weigh-in as the placeholder | KUX-032, KUX-033 |
| P2-5 | Refuse to persist untouched/empty notes; trim titles; discard an unmodified seed example | KUX-034, KUX-035 |
| P2-6 | Default Fatigue and Deload off for new accounts; offer each when the data warrants | KUX-026, rest of KUX-029 |
| P2-7 | Tab bar opacity floor; remove error-red from More's navigation rows; correct the delete copy | KUX-027, KUX-030, KUX-036 |

**Deliberately not scheduled:** KUX-009 (auto-dated sessions), KUX-013
(identity stability), KUX-024 (check-in relocation), KUX-025 (session scoping),
KUX-031 (recovery auto-close), KUX-028 (tab restructure). Each is real and each
needs a design decision rather than a patch; they belong to a second round, after
P0/P1 changes what the surfaces contain. KUX-023 and KUX-037 are genuinely minor.

---

## 6. Adversarial self-review

Every substantial recommendation was re-attacked with: *am I adding complexity? another screen? another decision? am I burdening everyone to fix an edge case? would an experienced Kilo user actually be faster? is there a simpler answer?*

### Recommendations that survived, and what changed under pressure

- **P1-1 (caret positioning).** Attacked as "you're adding a mode". It is not — same editor, same text, different starting caret. It removes a step rather than adding one. Kept unchanged.
- **P1-2 (track by behaviour).** Attacked as "smart defaults that become opaque". The mitigation is that the pill stays, so the user can always see and change what is tracked; and the heuristic is one the user can state in a sentence ("things you've done twice"). Kept, with the explicit requirement that the tracked set remain visible and editable.
- **P1-3 (grammar).** The lone-integer rule was the weakest part: accepting `225` as 225 reps is worse than an error. Revised to add an implausibility guard rather than accepting anything. The `-` and cardio changes survived untouched.
- **P0-3 (Log opens on Routine).** Attacked as "you'll hide recovery from someone mid-rehab". Revised: the recovery banner must be above the routine card, not below, and must use the existing state copy — otherwise this trades one problem for another.
- **P2-1 (collapse history).** Attacked as "a disclosure is a new decision". It is, but the alternative is a surface that degrades forever. Kept, with the constraint that it be read-view only and never touch stored text.
- **KUX-009 (auto-dated sessions).** Survived as a finding but was demoted out of the plan: any implementation touches storage and sync, and the stamping rule (append-only) needs review. Recorded, not scheduled.

### Recommendations considered and dropped

- **A structured set-entry row (weight/reps steppers, "+ Set" button).** This is the conventional-tracker solution and it would make an experienced Kilo user *slower* — typing `100 8,8,8` is three tokens; three sets through steppers is a dozen taps. Dropped. It also contradicts the product's reason to exist.
- **An exercise picker / autocomplete backed by a catalog.** Would fix KUX-013's duplicate identities, and would import the entire mental model Kilo rejects. Dropped in favour of better normalisation plus a dismissible merge hint.
- **Splitting each day into its own note.** Would fix KUX-007's unbounded growth and KUX-025's cross-day session index cleanly. Dropped: it multiplies the notebook by five, breaks the A/B week model, and makes "my routine" stop being one thing the user can read end to end. The read-view collapse achieves most of the benefit for none of the cost.
- **A dedicated "quick log" screen.** Another screen to solve a problem caused by navigation. Rejected on its own terms.
- **Making the weigh-in note field disappear entirely.** 0/136 on one account is suggestive, not conclusive, and a note field on a body-weight measurement has obvious legitimate uses. Demoted to a disclosure.
- **Removing the fatigue check-in.** The three stored responses contain the most valuable qualitative data in the account, and one of them precedes and explains the recovery block. The problem is the interruption, not the question. Relocation, not deletion.
- **Removing recovery blocks.** Same reasoning: the need is evidenced by an actual injury in the data. The lifecycle is too heavy, not unnecessary.
- **Onboarding: a syntax tutorial or a guided first-workout flow.** The repo already removed a guided composer (#786/R6b-3) and was right to. More teaching surface is not the answer to an under-taught grammar; a *smaller* grammar that rejects less (P1-3) and a teaching block that covers what exists (P1-5) are.
- **Restructuring the tab bar to four tabs.** Real but modest, and premature — see KUX-028. Explicitly declined rather than deferred silently.
- **Rest timers, calendar-driven workout UX, AI features, and any "because Hevy does it" recommendation.** Out of scope by the issue's constraints and, independently, wrong for this product.

---

## 7. Final questions

### 1. If I had to use Kilo four days a week for the next three years, what would slowly begin to irritate me?

**The hunt.** Not the typing — the typing is genuinely fast and genuinely good. What would grind is that every single time, for every single exercise, I have to find the line. And the note gets longer every week, so the hunt gets worse every week. Three years is roughly 150 session-columns; the current routine would be several thousand lines. The app I chose *because* it was fast would have become the slowest thing about training.

Second: never being told my work saved. Three years of a small unresolved doubt, several times a week.

Third: watching my own analytics quietly forget things — an exercise renamed, a routine rewritten, a chart that used to have history and now starts from zero, with nothing anywhere explaining why.

### 2. What does Kilo currently make the user do that the software should be doing for them?

- **Deciding which exercises "count".** 71 `Track` decisions, which this user made zero of, and which the app could infer perfectly from the fact that they logged squats three times.
- **Finding the right line in their own note.** The app knows exactly where every exercise's block ends; it makes the user find it by eye.
- **Remembering when anything happened.** The app records nothing and asks the user to hold the calendar in their head.
- **Maintaining the note.** Pruning stale sessions, cleaning up test notes, closing a recovery block, removing skip markers the app itself wrote.
- **Reconciling two contradictory answers about their own progress** — Home's 24 rows and Analytics' zero.
- **Translating what they did into a grammar that rejects durations, ranges, single values, cardio, and their own written notes.**

### 3. What parts of Kilo appear designed around implementation structure rather than the user's mental model?

- **Session-as-column.** "The fourth line under this exercise" is a text-file concept. Nobody thinks about their training that way, and it forces every derived feature — check-ins, skips, attendance, comparisons — into a positional frame that produces visibly wrong answers (15 exercises across five weekdays in one "session").
- **Exercise identity as header text.** An artefact of parsing a string, exposed to the user as "your history disappeared".
- **The Recovery / Routine / Deload strip.** These are three implementations that happen to live on one screen, presented as three peer destinations. The user's model is "my training", with occasional detours.
- **`Skip week` as a text transform.** It writes markers into the document because the document is the data model, which is why it marks exercises the user has never touched.
- **Home as a place.** Home is a projection of Log and Weight. It exists because tab bars have a first tab.
- **The kg toggle.** A display-layer preference exposed as a units setting, because that is where the conversion was implemented — with a disclaimer in the help text where the honest answer would be either "convert properly" or "don't offer it".

### 4. Where does Kilo violate its own "type and move on" philosophy?

- **You can't type until you've navigated.** Home → Log → Routine sub-tab → Edit → scroll → position caret. Five steps before the first character.
- **You can't move on.** `Done` can raise a modal asking how the session felt.
- **You can't trust that you moved on.** Nothing confirms the save.
- **It types back at you.** `Skip week` writes lines into your note that you did not author, for exercises you have never performed.
- **It refuses what you typed.** 21 rejected rows in the live routine, and three lines it deleted outright.
- **It asks you to type twice.** `60` is invalid; `60,60` is fine.

### 5. What conventional mobile-UX advice should Kilo deliberately not follow?

- **"Replace free text with structured input."** Steppers, pickers, and per-set rows are the reason every other tracker is slow. `100 8,8,8` is unbeatable.
- **"Add onboarding."** The repo already removed a guided composer and was right to. The fix for an under-taught grammar is a grammar that rejects less.
- **"Confirm destructive actions."** Kilo already over-confirms in some places (`Remove skips?`) while under-confirming in the one place it matters (`Undo`). Confirmation should follow consequence, not category.
- **"Use icons to save space."** Kilo's text labels (`Edit`, `Track`, `Week B`, `Skip week`) are unambiguous. Icons would cost clarity for room it does not need.
- **"Surface everything on the dashboard."** Home's 24-row progress list is the result of this instinct.
- **"Notify to build habit."** Reminders off by default is correct for a local-first, privacy-positioned product, and the account data shows 83 days of self-directed weigh-ins without them.
- **"Gamify."** The 1K Club is enough, and it is already tied to a real number.

### 6. What is the smallest version of Kilo's UX that still gives users everything they actually need?

Two surfaces.

**The note.** One screen. Your current routine, rendered. Tap an exercise → the caret is on a new line at the end of its block, keyboard up. Type. Leave. History older than three sessions is collapsed behind a count. Everything else about routines — switching, creating, deleting, A/B weeks — lives behind one disclosure below.

**The numbers.** One screen. Bodyweight in at the top (type, tap, done). Below it: your trend, and your lifts' progress — auto-populated from what you actually log, no tracking decisions.

Settings and account live behind a header control, not a tab. Deload, recovery, and fatigue appear inside the note screen when the data says they are relevant, and are absent otherwise.

That is two tabs, one text field, one number field, and no configuration required to reach a fully working product.

### 7. If you could change only five things, in order

1. **Tap an exercise → the caret lands at the end of its block.** (KUX-002) The single largest recurring cost in the product, removed by reusing machinery that already exists.
2. **Make `Undo` ask before it destroys the session, and move it away from `Done`.** (KUX-005) The only one-tap irreversible data loss in the app.
3. **Track what the user actually logs.** (KUX-018) Turns the entire Analytics tab from blank to populated for every existing user, with no action from them, and removes 71 decisions.
4. **Fix the row grammar and stop discarding text.** (KUX-010, KUX-011, KUX-012, KUX-015, KUX-016) One coherent pass that makes Kilo accept what its users are already writing — and never silently delete any of it.
5. **Open Log on the routine, and say "Saved".** (KUX-001, KUX-004) Two small changes that together fix the beginning and the end of every single session.

If a sixth were allowed: convert workout-note loads for kg users (KUX-017). It is ranked below these only because it affects nobody in the current account and everybody outside the United States.

---

# 8. Addendum — Recovery as an active product state

Targeted correction and extension of the audit above, following the clarified
product intent. Read-only; no implementation authorized.

**The corrected model.** When a recovery block is active, the recovery-week note
*is* the user's training. The baseline routine is a paused thing they intend to
return to. Recovery being the primary Log context is correct and intentional.

I audited against the opposite assumption, and one finding (KUX-001) was built
on it. That finding is withdrawn below. The larger question — whether Kilo
adapts *the rest of itself* to the changed training context — turns out to be
where the real problem is, and it is worse than the thing I originally flagged.

**One-sentence answer.** Kilo switches the Log tab to Recovery and then switches
nothing else: Home, Analytics, the fatigue system, and the visual hierarchy of
the logging surface itself all continue to describe the baseline routine, in the
present tense, without ever saying it is paused.

---

## 8.A Corrected interpretation

### Withdrawn

| ID | Was | Why it is wrong |
| --- | --- | --- |
| **KUX-001** | "Log lands on Recovery instead of your routine" — recommended Log always open on Routine, with recovery demoted to a banner. Ranked #8 in the Fuck-This list. | Inverted. The recovery week is the active training context; opening there is correct. The "extra tap" I counted was a tap *toward* the right note, not away from it. |
| **P0-3** | "Log always opens on the Routine sub-tab" | Withdrawn with KUX-001. Replaced by **R-3** below, which pushes in the opposite direction: make the recovery surface *more* primary, not less. |

The observation underneath KUX-001 survives in corrected form as **KUX-R01**:
the default lands correctly, and then the context stops travelling. Everything
outside the Log tab still assumes the baseline is being trained.

### Modified

| ID | Amendment |
| --- | --- |
| **KUX-029** (tab strip inside a tab) | I recommended the strip collapse to nothing. Wrong for the recovery case: the strip is the switch between *what I'm training* and *what I'm returning to*, which is a real and necessary control. Amended: keep it, but it is labelled by feature name (`Recovery` / `Routine` / `Deload`) rather than by role. A user cannot tell from those three words which one is live. The Deload half of the original finding stands — see KUX-R08. |
| **KUX-031** (recovery lifecycle is five modals) | I read "block open 13 days, never completed" as abandonment under ceremony. Corrected: an open block is the **normal steady state** of recovering. Thirteen days open is not evidence of anything. The finding narrows to the *ending* only, and the auto-close recommendation is re-justified in 8.F on different grounds (the block should end when baseline training demonstrably resumes, not because ending is annoying). |
| **KUX-007** (the note only grows) | Scoped: this is a baseline-routine problem. Recovery week notes are short-lived and small (the live one is 210 lines but spans a whole rehab programme, not accumulated sessions). No change to the finding; it simply does not apply to the recovery surface. |
| **KUX-019** (Home shows stale progress rows) | Escalated. In normal use this is accumulated cruft. During recovery it is *categorically* stale — every row describes training that is deliberately not happening — and nothing labels it. Severity during recovery: **Critical**, not High. |
| **KUX-024 / KUX-025** (fatigue check-in) | Superseded in part by **KUX-R05**, which is a larger finding: the check-in is not merely badly timed during recovery, it is **structurally unreachable**. |
| **KUX-005** (`Undo` beside `Done`) | Extended to the recovery surface, where it is worse — see **KUX-R06**. The recovery inline editor's discard control is labelled `Cancel`. |
| **KUX-002** (caret positioning) | Supplemented: the fix must land on the recovery inline editor too, or it lands on the surface the user is not using. |
| **KUX-018 / KUX-021 / KUX-022** (tracking) | Supplemented, and the P1-2 recommendation is confirmed correct under the new model *by accident*: auto-tracking is scoped to `currentNote`, which during recovery is the baseline. That is the right scope — rehab loads must not enter progression. Stated explicitly now rather than left implicit. |
| **KUX-032 / KUX-033** (weight entry) | Reprioritized upward. During recovery, bodyweight is the **only** metric in the product still moving. The daily weigh-in stops being one of two loops and becomes the entire live surface. |

### Retained unchanged

KUX-002 (mechanism), KUX-003, KUX-004, KUX-006, KUX-008, KUX-009, KUX-010
through KUX-017, KUX-020, KUX-023, KUX-026, KUX-027, KUX-028, KUX-030,
KUX-034 through KUX-037. None depended on the recovery model.

---

## 8.B Current-state map — what each surface becomes during Recovery

Verified against the live account (block active since 2026-08-08,
`include_in_normal_analytics = false`, Week 1 = *Return (ease the back) rehab*,
baseline = *Summer 2026 Routine* with `is_current = true`).

### The structural fact everything follows from

`currentNote` **remains the baseline routine**. The recovery week note is a
non-current note edited through `useLogOtherRoutineEditor`. Every derivation in
the app that keys on `currentNote` therefore keys on the paused routine:

- `deriveHomeDashboardData({ workoutNote, ... })` — Home's week label, session
  count, classification counts, 1K selections, tracked-name visibility.
- `deriveParsedSections(notes, currentNote, ...)` → `currentSections =
  getNoteSections(currentNote)` — Analytics' Progressive Overload grouping,
  routine status, tracked-lift visibility.
- `deriveRoutineStatus(currentSections, currentNote, deloadHistory)` — sessions
  logged, sessions since deload.

And the recovery week note is simultaneously *removed* from the aggregate
population by `buildRecoveryAnalyticsFilter`, because
`include_in_normal_analytics` is false. So the training the user is actually
doing feeds nothing outside the recovery-specific components.

That is a defensible data decision. It is not accompanied by any presentation
decision.

### Home

| Element | During recovery |
| --- | --- |
| `Week N` hero label | **Frozen.** It is `computeWeeksIn` — session *depth* of the baseline note — rendered as "Week". It stops advancing while calendar weeks pass. `docs`-internal guidance already warns against calling this a week; Home does. |
| Latest bodyweight + 7-day sparkline | **Live.** The only continuously-updating thing on the screen. |
| `Log workout` / `Log weight` links | **Correct.** `onNavigate('Log')` lands on the Recovery tab. Works under the corrected model. |
| `Exercise Progress` band (Progressing / Steady / Regressing) | **Frozen, unlabelled.** Derived from baseline classifications. Reads as this week's status. |
| Recovery status card | **Live and genuinely recovery-specific** — week number, "N baseline exercises met", rebuilding / not-reintroduced / not-comparable / added-during-recovery counts, handoff to Analytics. This component is the one part of the app that already does the right thing. |
| Weight goal card | **Live.** |
| 1K card | **Frozen, unlabelled.** |

The source comment above the recovery card is revealing: *"Directly under the
hero because it is what the hero's week label and classification counts mean
right now, not a separate topic."* The relationship was understood; the response
was placement. Placement does not relabel the hero.

### Log

| Element | During recovery |
| --- | --- |
| Landing tab | **Recovery. Correct.** |
| Recovery block card | Live: week rows, status dots, current-week accent rail. |
| The active training note | **Collapsed by default**, behind a week row that must be tapped to expand. Then `Edit` to reach the text. |
| Its rendering | `WorkoutContentRenderer` in **`compact` mode** — 14/700 names, 13/muted sets, day headings suppressed, **no `Track` affordance**, no plate-calculator target, no `ExerciseBlock` chrome. |
| Its editor | Inline `TextInput`, `minHeight: 160`, with `Save` / `Cancel`. |
| Baseline routine (Routine tab) | Full-scale card, **4 px accent border**, expanded by default, full-screen editor at `minHeight: 250`, `Track` pills, `Skip week`, Week A/B toggle, and **no indication whatsoever that it is paused** (the `recoveryWeekNumber` badge only renders when the *current* note is itself a recovery week, which the baseline is not). |
| Deload tab | Still present if enabled — offering to generate a deload from a routine that is not being performed. |

### Weight

Entirely unaffected and entirely live. Under recovery this is no longer a
secondary loop; it is the product's only continuously-changing surface.

### Analytics

| Section (in render order) | During recovery |
| --- | --- |
| Overview card | Rows are 1K, exercise progress, sessions-since-deload, current weight. Three of four frozen. Its `asOf` stamp reads **"3 sessions logged"** — a frozen count presented as the tab's freshness marker. |
| Weight trends | **Live.** |
| Recovery section | **Live and recovery-specific.** Already positioned third, deliberately (source comment: *"it is the only time-boxed, situational section on the tab"*). |
| `Fatigue` section title | Present. |
| `Routine Health` gauge (`SessionGauge`) | **Frozen and actively wrong in tense.** `count = sessionsSinceDeload`, `total = sessionsLogged`, both baseline. At 1–6 sessions its caption reads **"Cultivating mass"** — a positive, present-tense claim about training that is deliberately not happening. |
| Fatigue check-in history | Frozen. Last live record 2026-06-30, five weeks before the block opened. |
| Strength / 1K | Frozen, unlabelled. |
| Progressive Overload | Frozen, unlabelled — and empty regardless for this account (KUX-018). |

### More

Unaffected. Correctly so.

### The metric Kilo computes and throws away

`deriveRoutineStatus` returns `elapsedWeeks` (a genuine Monday-anchored calendar
span from `note.saved_at`) and `weeksSinceDeload`. **Neither is rendered
anywhere in the app.** The one number that would make the freeze legible — "11
calendar weeks on this routine, 3 sessions logged" — is already computed and
discarded, while the frozen session count is displayed under the word "Week".

---

## 8.C Staleness map

Classified per the requested vocabulary. "Frozen" is not a defect; the question
is whether the UI gives the frozen value the right meaning.

### Still current and relevant

- Bodyweight entry, 7-day and 30-day rolling averages, pace flag, weight goal and
  its projections (Home, Weight, Analytics).
- Recovery status card (Home) and Recovery section (Analytics) — week number,
  baseline-met count, per-exercise recovery categories.
- The recovery week note itself, and its editing surface.
- `Log workout` / `Log weight` handoffs.

### Correctly frozen because baseline training is paused

- Progressive Overload signals, Est. Max / Kilo Max, per-lift trends.
- 1K total and its series.
- Exercise classifications (progressing / steady / regressing).
- Sessions-since-deload.
- Fatigue check-in history.

All of these are *correctly* excluding rehab loads. The data decision is right.

### Stale but presented as current — the core failure

- Home `Week N` — frozen session depth, labelled as a calendar unit.
- Home `Exercise Progress` counts — no paused/baseline marker.
- Home 1K card — no paused/baseline marker.
- Analytics Overview `asOf: "3 sessions logged"` — a frozen number used as the
  tab's freshness stamp, which is precisely the claim it cannot support.
- Analytics Strength / Progressive Overload / 1K — no paused marker.

### Actually incorrect

- **`Routine Health` gauge caption.** "Cultivating mass" is a present-tense
  assertion about training that is intentionally not occurring. At the other end
  of the scale, a user who enters recovery at 10+ sessions is told **"Plan
  deload asap"** — advice to deload from a routine they have already stopped.
- **Home `Week N`.** Wrong unit in normal use; visibly wrong during recovery,
  when it holds still for weeks at a time.
- **Deload availability.** Deload generation reads the baseline routine and
  proposes reduced volume for training that is already suspended.

### Should become recovery-specific

- The Log surface hierarchy: the active note should carry the presentation
  weight the baseline card currently monopolises.
- Fatigue check-in: its two triggers are *self-relative* (see 8.D / KUX-R05), so
  they work on any note. Recovery is when this feedback matters most.

### Should remain historical but be visibly labelled paused/baseline

Everything in "correctly frozen" above. None of it should be hidden — a user in
week 3 of rehab absolutely wants to see what they will be returning to. It needs
one word of context, not removal.

### Should be temporarily demoted or hidden

- The Deload tab and deload generation.
- `Skip week` on the baseline card (a skip marker on a routine that is formally
  paused manufactures exactly the false attendance data of KUX-008).
- Progressive Overload's position at the bottom of Analytics is already
  effectively demoted; no change needed.

---

## 8.D Top Recovery-state UX failures

Prioritized by frequency × consequence. New IDs, continuing the register.

#### KUX-R01 — The active training context is set once, in one tab, and travels nowhere

**Surface** Whole app · **Freq** Every launch, for the duration of the block ·
**Sev Critical** · **Confidence High**

Log switches to Recovery. Home, Analytics, and the fatigue system continue to
compute and present the baseline as though it were live, because every
derivation keys on `currentNote` and `currentNote` is still the baseline.
Kilo has the *data* concept (`activeBlock`, an authoritative subscribed store
already consumed by all three screens) and no *presentation* concept.

**Evidence** `LogScreen.js:274-279`; `homeDashboardData.js` →
`deriveHomeDashboardData({ workoutNote })`; `analyticsDerivations.js:41`
`currentSections = getNoteSections(currentNote)`; `useHomeRecoverySummary` and
`useRecoveryBlockState` already available on all three screens.

**Consequence** The user opens Kilo in week 3 of rehab, having trained four
times that week, and the app shows Week 4, 3 sessions, the same progress counts
as a month ago, and "Cultivating mass". Nothing is technically false and the
whole screen is misleading.

#### KUX-R02 — Frozen baseline metrics are presented in the present tense

**Surface** Home, Analytics · **Freq** Every launch · **Sev Critical** ·
**Confidence High**

No frozen value anywhere carries a marker distinguishing "this is not changing
because you paused it" from "this is your current status". The Analytics
Overview goes further and uses a frozen count as its *freshness stamp*.

**Evidence** `AnalyticsScreen.js:369-371` (`overviewAsOf`); `UI.js:105-114`
(`getSessionZoneCaption`); `HomeScreen.js` hero week row and classification
band.

**Consequence** This is the difference the brief names: *"your normal training
is intentionally paused"* versus *"nothing has happened in Kilo for three
weeks"*. Kilo currently communicates the second.

#### KUX-R03 — The surface the user actually trains from is the most demoted in the app

**Surface** Log → Recovery · **Freq** Every session · **Sev High** ·
**Confidence High**

The active note is collapsed by default inside a week row, rendered in `compact`
mode (smaller type, no day headings, **no `Track` control at all**, no plate
target), and edited in a 160 px inline box. The routine the user is *not*
performing gets a 4 px accent border, full type scale, an expanded body, a
full-screen editor, and every control.

**Evidence** `LogRecoverySection.js:508-556` (rows collapsed;
`recoveryViewingNoteId` initialises to `null`), `:583-603` (inline editor
`minHeight: 160`), `:667-671` (`compact`); `WorkoutContentRenderer.js:72, 90-98`
(compact suppresses day headings and the entire `ExerciseBlock` /
`onToggleTrack` path); `LogActiveRoutineCard.js:177-182` (`borderWidth: 4`).

**Consequence** Two taps to reach the text the user came to write, in a smaller
box, with fewer capabilities, while the paused routine looks like the main
event. The visual hierarchy is inverted relative to behaviour.

#### KUX-R04 — The baseline routine is never marked as paused

**Surface** Log → Routine · **Freq** Whenever the user checks the baseline ·
**Sev High** · **Confidence High**

The current-routine card during recovery is byte-identical to the card in normal
use. The only recovery badge in that component fires on
`recoveryWeekNumberByNoteId[currentNote.id]`, and the baseline is deliberately
not a block member — so it never renders.

**Evidence** `LogActiveRoutineCard.js:33, 66-74`; `recoveryAnalyticsFilter.js:20-23`
(the baseline is explicitly not a member, by design).

**Consequence** Nothing prevents or even discourages logging into the paused
routine, which would silently contaminate the baseline the recovery comparison
is measured against.

#### KUX-R05 — Fatigue check-in is structurally unreachable during recovery

**Surface** Log · **Freq** Entire block · **Sev High** · **Confidence High**

`_runCheckInDetection()` is called from exactly one place:
`handleDoneCurrent` in `useLogCurrentRoutineEditor` — the **baseline** editor.
Recovery notes are saved through `handleDoneOther` / `handleCancelRecoveryEdit`
in `useLogOtherRoutineEditor`, which never calls it. So no amount of rehab
logging can raise a check-in.

This is a **wiring gap, not a conceptual one.** Both triggers are *self-relative*
— `volume_drop` compares an entry to that same exercise's own prior top weight;
`skipped` compares a column to that same note's own per-column mean. Neither
consults the baseline. They would work correctly on a recovery note as-is.

**Evidence** `useLogCurrentRoutineEditor.js:641` (sole call site),
`:564-622` (trigger definitions); `useLogOtherRoutineEditor.js:520` (`handleDoneOther`).
**[E]** live: last check-in 2026-06-30; block opened 2026-08-08; two of the three
stored check-ins record the injury ("Back seized up on deadlifts", "Injury
persists, have to rest this week") that preceded this very block.

**Consequence** The feature switches itself off at the exact moment its subject
matter — pain, fatigue, whether today went badly — is most relevant, and the
user's own history shows it was working for them right up until then.

#### KUX-R06 — The recovery editor's discard control is called `Cancel`

**Surface** Log → Recovery inline editor · **Freq** Rare, catastrophic ·
**Sev Critical** · **Confidence High**

`handleCancelRecoveryEdit` awaits any in-flight autosave, then calls
`handleUndoOther`, which writes the note's contents *as of when the editor
opened* back to storage, then closes the session. Autosave has already persisted
everything typed. So `Cancel` — the most benign word in the interface vocabulary,
sitting beside `Save` — destroys the entire editing session on the surface the
user is actively training from.

This is KUX-005 with a worse label, on a more important surface. The full-screen
editor at least says `Undo`.

**Evidence** `useLogOtherRoutineEditor.js:669-679`, `:564-600`;
`LogScreen.js:1044-1045`.

**Consequence** A user who taps `Cancel` expecting "back out of edit mode"
loses the session they just logged. Irreversibly.

#### KUX-R07 — Entering recovery acknowledges nothing; leaving it asks the wrong question

**Surface** Recovery lifecycle · **Freq** Twice per block · **Sev Medium** ·
**Confidence High**

On start, `handleConfirmRecoveryBlock` refreshes state and calls
`setTabView('recovery')`. That is the entire transition. Nothing tells the user
that baseline analytics have just frozen, that their session count has stopped,
or that the routine they were on is now paused. On end, the modal's headline
question is about **analytics inclusion** — an internal data-boundary decision —
rather than about resuming training.

**Evidence** `LogScreen.js:574-583`; `RecoveryBlockEndModal.js:109, 187`.

#### KUX-R08 — Deload remains offered against paused training

**Surface** Log → Deload; Analytics → Routine Health · **Freq** Every launch
with deload enabled · **Sev Medium** · **Confidence High**

Deload generation reads the baseline routine. `Routine Health` advises "Plan
deload asap" at 10+ baseline sessions regardless of whether those sessions are
still accumulating. A deload is a planned reduction from active training; there
is nothing to reduce.

**Evidence** `LogScreen.js:911-920, 924-951`; `UI.js:105-114, 155-180`;
`AnalyticsScreen.js:469`.

#### KUX-R09 — The tab strip labels features, not roles

**Surface** Log · **Freq** Every session · **Sev Low** · **Confidence Medium**

`Recovery` / `Routine` / `Deload` are three feature names. Nothing in them says
which is the live training context and which is the parked one. This is the
amended remainder of KUX-029.

**Evidence** `LogScreen.js:890-922`.

---

## 8.E Minimum adaptive design

Five changes. No new tabs, no recovery dashboard, no duplicated Analytics
components, no rehab loads in progression metrics, no additional routine
ceremony, and no defaulting to Routine. Every one is a labelling, hierarchy, or
wiring change to a component that already exists.

### R-1 — One context statement, derived once, rendered in three places

Kilo already has the authoritative store (`useRecoveryBlockState`) and it is
already subscribed on Home, Log, and Analytics — the source comments note it is
refcounted and coalescing, so this adds a read, not a fetch.

Derive one value: `activeTrainingContext = { kind: 'baseline' | 'recovery',
label, weekNumber, baselinePaused }`. Render its label in the three places the
user's eye already goes:

- **Home hero week row** — replacing the frozen `Week 4` with `Recovery · Week 2`
  while a block is active.
- **Log tab strip** — the active context's tab carries the live marker.
- **Analytics Overview `asOf`** — `3 baseline sessions · paused during recovery`.

This single change is what converts *"nothing has happened in three weeks"* into
*"your normal training is intentionally paused"*. It is the highest-leverage
item in this addendum, and it is a string.

### R-2 — A `paused` flag on the frozen components, changing captions only

Thread `baselinePaused` from the same store into the components that already
render frozen values, and change nothing but their captions:

- `SessionGauge` — suppress the zone advice entirely while paused (the caption
  is the actively-wrong part), and label the counts `baseline`.
- Home `Exercise Progress` band — append the paused marker to the header.
- Home 1K card, Analytics Strength / Progressive Overload — same.

No component is hidden, no data changes, no layout moves. A user in rehab can
still see exactly what they are returning to; it simply stops claiming to be now.

### R-3 — Give the active note the presentation weight it has earned

Three sub-changes, all in the Recovery surface:

1. **Expand the current week's note by default.** Seed `recoveryViewingNoteId`
   from the active block's latest live week. This is the thing the user opened
   the app to write in; it should not be behind a disclosure.
2. **Drop `compact` for the current week only.** Full type scale and the `Track`
   affordance, matching the current-routine card. Completed weeks stay compact —
   the distinction becomes meaningful rather than blanket.
3. **Rename `Cancel`** (KUX-R06) and confirm before discarding, mirroring the
   KUX-005 fix.

Combined with the KUX-002 caret change applied to the inline editor, logging a
rehab session becomes: open app → tap Log → tap the exercise → type.

### R-4 — Wire check-in detection to the active training note

Call `_runCheckInDetection` from the recovery save path. The detectors need no
modification — both triggers are self-relative, as established in KUX-R05. The
check-in's suppression key (`session_checkins[idx]`) is already per-note, so
recovery check-ins land on the recovery note and do not touch the baseline's
record.

If this is judged too large for a first pass, the honest fallback is to label
the Fatigue section as paused under R-2 — but that forfeits feedback during the
period it matters most, so R-4 is the recommended form.

### R-5 — Mark the baseline card as paused

One line under `Current routine` on the baseline card while a block is active:
its role, and which context is live. This is the counterpart to R-1 — R-1 says
what you *are* doing, R-5 says what this other thing *is*. It also removes the
risk of logging into the paused routine and contaminating the comparison
baseline.

Optionally, under the same flag, withdraw `Skip week` from the baseline card
while paused. A formally paused routine does not need per-week skip markers, and
KUX-008 shows what they cost.

### What deliberately stays out

- No recovery-specific Analytics components beyond the section that already
  exists. It is good; it does not need siblings.
- No inclusion of rehab loads in progression metrics. The default-off boundary
  is correct.
- No new tab, no new screen, no new modal.
- No change to `currentId` or the storage model. The active training context is
  a derived presentation concept, exactly as the brief frames it.

---

## 8.F Exact transition model

### Normal

**Active training context** = baseline routine (`currentNote`).
Everything behaves as today.

### Normal → Recovery

Triggered by `startRecoveryBlock` succeeding.

| | |
| --- | --- |
| **Becomes active** | The Week 1 note. Log switches to Recovery *(already implemented, and correct)*. |
| **Freezes** | Progressive Overload, Est./Kilo Max, 1K, classifications, sessions-logged, sessions-since-deload, check-in history. |
| **Keeps moving** | Bodyweight, trends, goal, and the recovery comparison. |
| **Currently acknowledged** | Nothing beyond the tab switch. |
| **Should acknowledge** | One confirmation line at the moment of starting: what is now being trained, and that baseline progress is paused and preserved. This belongs in the existing start-modal success path, not a new surface. |

### Recovery (steady state)

| | |
| --- | --- |
| **Active training context** | The latest live recovery week note. |
| **Baseline** | Visible, readable, editable, and marked paused (R-5). |
| **Adapts** | Home hero label, Analytics `asOf`, frozen-metric captions (R-1, R-2); Recovery card and section carry the live story; check-ins follow the active note (R-4). |
| **Unchanged** | Weight in every form. More. The recovery data boundary. |
| **Demoted** | Deload generation and its advice; `Skip week` on the paused baseline. |

Adding a week is an ordinary continuation of this state, not a transition.

### Recovery → Normal

Triggered by ending the block.

| | |
| --- | --- |
| **Active training context** | Returns to the baseline routine. |
| **Baseline analytics** | Resume **exactly where they stopped** — the frozen values were never wrong, only unlabelled, and the recovery weeks stay excluded, so the next baseline session continues the series with no discontinuity. This is a real strength of the current data design and should be stated to the user, not left to be discovered. |
| **Recovery information** | Persists as history. The block's comparison record stays readable; it is the evidence of how the return went. |
| **Currently** | The end modal leads with the analytics-inclusion question. |
| **Should** | Lead with the resumption — you are back on *[baseline]*, your progress picks up from *N* sessions — and keep inclusion as the secondary choice it actually is. |

On **auto-close** (the re-justified KUX-031): the honest signal that recovery has
ended is the user logging a full session into the baseline routine again. Closing
on that signal, with an undoable notice in the Recovery banner, removes the End
modal from the common path. This is a follow-up, not part of the minimum set —
it changes lifecycle behaviour, and the minimum set deliberately changes only
presentation and one wiring.

---

## 8.G Previous-audit amendments

| ID | Action | Detail |
| --- | --- | --- |
| KUX-001 | **Withdrawn** | Premise inverted. Replaced by KUX-R01. |
| P0-3 | **Withdrawn** | Replaced by R-1 (context statement) and R-3 (recovery surface hierarchy). |
| KUX-005 | **Supplemented** | Extended by KUX-R06; the recovery `Cancel` variant is worse and should be fixed in the same pass. |
| KUX-007 | **Scoped** | Applies to the baseline routine only. |
| KUX-019 | **Reprioritized** | High → **Critical** during an active block. |
| KUX-024 | **Superseded in part** | By KUX-R05. The interruption complaint stands for normal use. |
| KUX-025 | **Superseded in part** | By KUX-R05. |
| KUX-029 | **Modified** | The strip is a legitimate context switcher; the finding narrows to its labelling (KUX-R09). |
| KUX-031 | **Modified** | An open block is the normal steady state, not abandonment. Auto-close re-justified on resumption grounds (8.F). |
| KUX-032, KUX-033 | **Reprioritized upward** | The only live loop during recovery. |
| KUX-018, KUX-021, KUX-022 | **Supplemented** | P1-2 auto-tracking is correctly scoped to `currentNote` (= baseline during recovery); rehab loads stay out of progression. |
| KUX-002 | **Supplemented** | The caret fix must be applied to the recovery inline editor as well. |
| — | **Added** | KUX-R01 … KUX-R09. |

### Amended priority plan

**P0** — P0-1 (`Undo` confirm) now covers **KUX-R06** as well; P0-2 (kg)
unchanged; **P0-3 replaced by R-1** — one context statement rendered in three
existing places.

**P1** — add **R-2** (paused captions) and **R-3** (recovery surface hierarchy,
including the `Cancel` rename). P1-1's caret change extends to the inline editor.

**P2** — add **R-4** (check-in wiring) and **R-5** (baseline paused marker), plus
demoting Deload while paused.

---

## 8.H Direct answers to the brief's framing questions

**Does Kilo adapt the whole product to the changed training context?**
No. It adapts exactly one thing — which sub-tab of Log opens — and that one
thing is right. Everything downstream of `currentNote` still describes the
baseline, in the present tense, unlabelled.

**Is the frozen data broken?**
No, and this matters. The exclusion boundary is deliberate, correct, and well
built: rehab loads would read as a months-long regression. The values are right.
Only their *meaning on screen* is missing.

**Is 60% of the app pointless during recovery?**
Not pointless — **unlabelled**. A user in week 3 of rehab has a legitimate
reason to open Progressive Overload: to see what they are coming back to. What
they do not have is any way to tell that from "here is your current status".
The fix is one word of context on each frozen surface, not removal — which is
also why the minimum design is small.

**What should the session count read?**
The concept first: it is *baseline session depth*, and the baseline is paused.
So it should read as a baseline quantity with a paused state — the shape
suggested in the brief (`3 baseline sessions · paused during recovery`) is
right. Separately and independently, Home should stop calling session depth
`Week`: `elapsedWeeks` — a real Monday-anchored calendar span — is already
computed by `deriveRoutineStatus` and rendered nowhere. During recovery it is
the number that would make the freeze legible.

**Does fatigue tracking have work to do during recovery?**
Yes, and it is currently prevented from doing it. Both triggers are
self-relative and would function unmodified on a recovery note; the only reason
they never fire is that detection is wired to the baseline editor's `Done`. Of
everything in this addendum, this is the one where the product's own logic is
already correct and only the plumbing is missing.

---

# 9. Addendum — Progressive Overload tracking semantics (A vs B)

Evaluation of the temporal meaning of the `Track` / `Tracked` control.
Read-only analysis; no implementation authorized. Labels stay `Track` / `Tracked`.

---

## 9.1 What tracking does today — measured, not assumed

Before choosing a semantic, the actual evaluation depth matters, because the
question as posed assumes PO analytics reach back over a *period*. They do not.

### Where tracking state lives

- **Local:** one AsyncStorage key, `kilo_tracked_lifts`, holding a flat global
  map `{ [normalizedName]: true }` (`storage/entries/keys.js:11`,
  `hooks/entries/trackedLiftHooks.js:57-72`). Toggling deletes the key rather
  than writing `false`, so the map is a set.
- **Cloud:** `kilo.user_health_profile.tracked_lifts jsonb`
  (`storage/cloud/bootstrapPlan.js:395-408`) — **a consent-gated Article 9
  table** (issue #487), not `user_profile`. Confirmed against the live schema.
- **Not per-note.** `workout_notes.tracked_exercises` still exists and is
  written as `[]` (`storage/entries/workoutNotes.js:48`); nothing reads it for
  analytics. It is vestigial.

### What the PO row is actually computed from

`deriveAnalytics` passes `visibleTrackedNames` into
`deriveWorkoutNoteAnalytics(signalSections, ...)`. `trackedNames` selects **which
names get a row** — it never filters the section population. Each row's values
come from `deriveWorkoutAnalytics(sections)`, which aggregates every occurrence
of that exercise in the population regardless of tracking.

The row has two halves with **different temporal depths**:

| Value shown | Derived from | Depth |
| --- | --- | --- |
| **Est. Max** (`estimated_pr`) | max Epley over *every set ever logged* | Unbounded |
| **Kilo Max** (`computeKiloMax`) | mean Epley over *every non-warmup set ever*, × 1.07 | Unbounded |
| **Best set** (`latest_top_weight`) | the single latest logged entry | 1 entry |
| **Trend** (`overload_trend`, `progression_status`) | the **last two** comparable entries carrying a PR | 2 entries |
| **Home classification** (`_classifyEntries`) | `allEntries.slice(-3)`, comparing the **last two logged** | 3 entries |

Evidence: `lib/parser/analytics.js:103-157` (`_deriveSignalForComparables`
scans backwards for exactly two comparable units), `:171` (`kilo_max =
ex.estimated_pr`); `lib/data/workoutAnalytics.js:43-72` (`_classifyEntries`,
`slice(-3)`); `lib/data/fatigue.js:13-27` (`computeKiloMax` averages all
occurrences).

### The consequence for the question

The scenario as framed — *"retracking includes all eligible DB Bench history,
including Apr–Jun"* — is true of **Est. Max and Kilo Max only**. For trend and
classification, "history" is the last two-to-three logged entries, full stop.

So the practical difference between Model A and Model B is not three months of
contaminated data. It is:

> **One to two progression comparisons immediately after retracking, plus the
> permanent inclusion of untracked-period sets in the all-time max aggregates.**

Model A's contamination window self-heals after two or three tracked sessions.
That single measurement reframes the entire trade-off, and it is what the rest
of this section is built on.

---

## 9.2 The structural blocker for Model B as literally specified

**Kilo has no per-session dates.** A session is a positional column in note
text. The only timestamps in the entire training data model are
`workout_notes.saved_at` / `updated_at` (note-level) and
`session_checkins[idx].responded_at` (present only when a fatigue prompt was
answered — three records in three months on the live account). This is
KUX-009 from the main report.

Model B requires mapping calendar intervals ("Jan–Mar tracked, Apr–Jun not")
onto session entries. There is nothing to map onto. **Model B in its calendar
form is not implementable on today's data model** without first solving
KUX-009.

There is, however, a formulation of B that needs no dates at all — a
**session-ordinal watermark** rather than a time interval, expressed in the same
coordinate system the PO algorithms already use (entry index within an
exercise's history). That is the basis of the recommendation in 9.6.

Its own failure mode must be stated plainly: **entry indices are not stable.**
The whole note is a free-text field, and editing history is normal in Kilo.
Deleting a line from the middle of an exercise's block shifts every later index
by one. The codebase already has to compensate for exactly this —
`_performUnskipRemoval` re-keys `session_checkins` when a session is removed
(`useLogCurrentRoutineEditor.js:725-751`). Any ordinal watermark inherits that
drift.

---

## 9.3 Evaluating the two models against product intent

### The mental model is right, but it applies to only half the row

The stated intent — *"when I mark an exercise Tracked, I am intentionally doing
Progressive Overload on it and want Kilo evaluating that progression until I
stop"* — is a claim about **progression**, not about **capability**.

- **Est. Max / Kilo Max / best set** answer *what can you lift*. A real set is
  a real set. If the user hit 105 lb for 8 during a maintenance block, their
  estimated max genuinely went up, whatever their intent was that month.
  Excluding real lifts from a maximum is not respecting intent; it is
  discarding evidence.
- **Trend / progression status** answer *are you overloading*. That question is
  only meaningful relative to a period during which the user was trying to.
  Comparing July's first deliberate session against June's last maintenance
  session is a comparison the user never asked for.

Neither model gets this right, because both treat the row as one thing.
Model A applies capability semantics to progression; Model B would apply
progression semantics to capability.

### Where Model A actually hurts

One specific, real failure: on retracking, the first tracked session is compared
against the last untracked session. In the stated scenario that comparison is
July-session-1 vs June-maintenance-session, at a lower load — which renders as
**`improved` / trend `up`**. A spurious win, on the first row the user looks at
after deliberately resuming PO. The symmetric case (rehab at higher volume,
deliberate return at conservative load) renders as a spurious `regressing`,
which is worse: it is discouraging at the exact moment the user has re-committed.

That is a genuine defect and it is worth fixing. It is also, precisely, one
comparison.

### Where Model B would hurt

1. **Capability metrics go wrong** (above).
2. **Retracking produces an empty-looking row.** Under B, on retracking there
   are zero entries in the new window, so trend is `first_session` and
   classification is `initial` until two tracked sessions exist. Given that
   tracking is already at **zero adoption on the live account** (KUX-018),
   shipping a version where tapping `Track` produces *less* visible output than
   before is a real adoption risk.
3. **Renames silently destroy periods.** The tracking key is derived from the
   exercise header text at the moment of tapping. Rename the header and the key
   no longer matches, so the exercise is untracked *and* its period record is
   orphaned (KUX-013, KUX-021). Under A a rename loses a boolean; under B it
   loses history the user believes is being kept.
4. **The consent surface.** `tracked_lifts` sits in the consent-gated health
   table. A *period* record is materially more revealing than a boolean — it
   encodes when someone stopped pursuing progression, which for many users is an
   injury or illness window. A separate `tracking_periods` table would land
   inside the health-deletion-job, evidence-archive, and RLS machinery. Widening
   the existing `jsonb` value is a non-event; a new table is not.

---

## 9.4 The specific sub-questions

**Should pre-tracking history establish an initial baseline?**
For capability, yes and automatically — Est. Max / Kilo Max / best set should
always read all eligible history, so the row is never empty the moment it
appears. For progression, **no anchor**. Borrowing one pre-window entry as a
comparison anchor reintroduces exactly the spurious first comparison that
motivated B. `first_session` is the honest state, and it costs one session.
This is consistent with how the rest of the codebase handles unverified state
(`recoveryReady`, `recoveryBoundaryKnown`) — it prefers "not known yet" to a
guess.

**How should untracked periods affect trend calculations?**
Excluded from progression comparison; included in capability aggregates.

**Retracking behaviour?**
Resets the progression window to the current point. Capability values are
untouched and stay continuous. The user sees Est. Max immediately and a trend
after their second tracked session.

**Exercise removal / reintroduction?**
Removal from the current routine is **not** an untrack — the user expressed no
intent. Today `visibleTrackedNames` silently drops it (KUX-021); that should be
fixed regardless of A or B. On reintroduction the stored watermark may be far in
the past; clamping it to the available entry count is sufficient, and the
worst case is a slightly wider progression window, never a wrong maximum.

**Renames / normalized identity?**
This is the weakest joint in the system and it is already broken. Note also a
live inconsistency: tracking is **stored** under `normalizeLiftName` (lowercase
+ whitespace collapse, no aliasing) but **matched** in analytics under
`normalizeExerciseKey` (alias-canonicalised first). So `-DB Bench` on Monday and
`-Dumbbell Bench Press` on Thursday are one row in analytics but two independent
`Track` pills, one of which will read `Track` while the merged row is already
tracked. Any temporal model inherits this. **Do not ship period semantics onto
an identity that is not stable** — KUX-013 and KUX-021 are prerequisites.

**Migration from today's boolean-only state?**
See 9.6 — under the recommended shape there is no migration. `true` remains a
legal value meaning "no watermark", which evaluates exactly as Model A does
today.

**Implementation complexity and failure modes?**
Full period history: a new consent-gated table or a per-key array, index drift
on every history edit, invalidation of the save-time `exercise_classifications`
cache, and a new class of "why did my trend disappear" support surface.
Scalar watermark: one widened `jsonb` value, one `slice` in two derivations,
bounded drift, no migration.

**Does B justify temporal state?**
As specified — calendar periods, full history — **no**. It is not implementable
without dated sessions, it corrupts the capability half of the row, and the
defect it fixes is one-to-two comparisons wide.
As a single scalar watermark — **yes**, because it fixes exactly that defect at
close to zero cost.

---

## 9.5 Recommendation

**A specific hybrid: capability is period-agnostic (Model A); progression is
period-scoped (Model B), implemented as a single session-ordinal watermark
rather than a period history.**

The split follows a line that already exists in the code — the boundary between
`ex.estimated_pr` / `computeKiloMax` and `_deriveSignalForComparables` — so it
is a change of inputs to two functions, not a new subsystem.

| PO row value | Semantics | Reads |
| --- | --- | --- |
| Est. Max | A | all eligible history |
| Kilo Max | A | all eligible history |
| Best set | A | latest entry |
| **Trend / progression status** | **B** | entries since the current tracking watermark |
| **Home classification** | **B** | entries since the current tracking watermark |

---

## 9.6 Minimum viable data model and UX semantics

### Data model

Widen the existing value in `kilo_tracked_lifts` (and its `tracked_lifts` jsonb
mirror). No new key, no new column, no new table, no new consent surface:

```
{ "db bench press": true }                 // legacy — no watermark
{ "db bench press": { "since": 14 } }      // tracked from that exercise's 15th logged entry
```

- `since` is the count of that exercise's logged entries at the moment `Track`
  was turned on, computed from the same `_occurrenceEntries` sequence the
  progression derivations already walk.
- Only the **current** span is stored. No history of past periods. Untracking
  deletes the key exactly as it does today.

**Migration: none.** `true` is a legal value meaning "no watermark", which
evaluates identically to today's behaviour. Every currently-tracked lift keeps
Model A semantics until the user next toggles it. Nothing is rewritten, and a
client that has not shipped the change still reads the map correctly (it only
checks truthiness — `Object.keys(map).filter(k => map[k])`, which an object
satisfies).

### Derivation changes

Two, both one line:

- `_deriveSignalForComparables` receives `comparable.slice(sinceIndex)`.
- `_classifyEntries` receives `allEntries.slice(sinceIndex)` before its
  existing `slice(-3)`.

`estimated_pr`, `computeKiloMax`, and `latest_top_weight` are **not** touched.

`sinceIndex` is clamped: `Math.min(since ?? 0, entries.length)`. Index drift
from history edits therefore degrades the progression window slightly and can
never produce a wrong maximum, a crash, or a negative slice.

### UX semantics

- **Labels unchanged.** `Track` / `Tracked`. No new control, no PO-management
  workflow, no automatic tracking, no inference.
- **Tapping `Track`** means "evaluate my progression from here". The row appears
  immediately with Est. Max and best set from full history, and trend reads
  `First session` until a second tracked entry exists. That is one session of
  patience in exchange for never showing an unasked-for comparison.
- **Tapping `Tracked` (off)** means "stop evaluating". The row disappears as it
  does today. Capability values are unaffected and reappear intact on retracking.
- **No visible surface for the watermark.** It is not a date the user sets, a
  history they browse, or a thing they can get wrong. If it ever needs to be
  explained in the UI, the model is too complicated and should be reduced to
  plain Model A.

### Sequencing

**Prerequisites, in order:** KUX-013 (stable exercise identity — strip
prescriptions wherever they appear, treat `Core:` as a section marker) and
KUX-021 (absence from the current routine is not an untrack), plus reconciling
`normalizeLiftName` and `normalizeExerciseKey` so the pill state and the
analytics row agree on identity.

Shipping period semantics before those lands a feature whose correctness depends
on an identity that a routine rewrite silently changes. If only one of the two
can be done, **do the identity work and stay on Model A** — that is strictly
better than a temporal model built on unstable keys.

### The honest sizing

This recommendation fixes one real defect: the spurious first comparison after
retracking. It is worth doing because it costs a widened jsonb value and two
`slice` calls, not because the defect is large. If the identity prerequisites
prove expensive, Model A remains defensible and the correct thing to do is
nothing.

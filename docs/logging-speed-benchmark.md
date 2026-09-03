# Logging-Speed Benchmark

A repeatable baseline for how much work it takes to log a gym session in Kilo,
established for the three representative tasks approved in **#575 §8** and locked
by **#940**. Re-run it after every logging-workflow change (#938, #939, and the
gated repeat-last-set suggestion) and update the tables below.

- Model: `mobile/tests/loggingSpeedBenchmark.js`
- Fixtures: `mobile/tests/fixtures/loggingSpeedNote.js`
- Test / regression lock: `mobile/tests/logging-speed-benchmark.test.js`

## Why a model

The three tasks span the note editor, the on-screen keyboard, and scroll/scan
attention that no instrumented unit test can observe end to end. The benchmark is
therefore a deterministic **state-transition model**: each task is walked step by
step, every step contributes counts by action kind, and elapsed time is derived.
It turns the #575 estimate into a precise, versioned, re-runnable number. It
makes **no product-code change** and reads only the parser so the exercise lists
come from the real fixture notes.

## How to run

```
cd mobile && npx jest tests/logging-speed-benchmark.test.js
```

The suite guards the fixtures against grammar drift, locks the action taxonomy,
locks the current-`main` numbers below, demonstrates a comparable rerun with a
changed flow, and prints a paste-ready markdown report (`renderMarkdownReport`).

## Action taxonomy

One discrete user action or attention unit each:

| Kind | Meaning | Cost (s) |
| --- | --- | ---: |
| `TAP` | a screen tap: button, caret placement, Done | 0.6 |
| `KEY` | one on-screen keyboard key: digit, comma, space, Return, or a keyboard-plane switch | 0.4 |
| `SCROLL` | one deliberate scroll gesture | 1.2 |
| `SCAN` | one visual search to locate an exercise block in a long note | 1.5 |
| `CARET_FIX` | one re-tap / caret-handle drag after an imprecise multiline tap | 2.0 |

Elapsed time is exactly `Σ(count × cost)`. It deliberately **excludes**
recall/decision latency (deciding what to log), which is not one of the five
action kinds. Fractional counts are averages (e.g. `CARET_FIX 0.7` = 70 % of
end-of-line multiline taps need a correction).

Forward scroll to reach an exercise (`forwardScrollPerExercise`) scales with the
block's depth: a block is `1 header + N prior session rows`, spread over ~9
visible editor lines, so `SCROLL ≈ (1 + N) / 9` per exercise. At the #575 §8
fixture depth (12 prior sessions) that is ~1.4, matching #575 §1's "~1.5"; at the
A/B note's 6-session depth it is ~0.8. Prior-session depth is therefore a real
input to the SCROLL baseline.

Keystrokes to type one session row (`keyCostForRow`): one actual keypress per
literal character, comma included and counted once. There is **no** per-row
plane-switch or comma surcharge — GBoard keeps the digit/symbol plane active
while the user scrolls and moves the caret within the same focused multiline
input, so the switch onto that plane is charged **once per editor session**
(`PLANE_SWITCH_KEYS`, a discrete step), not once per row. The #938 keypad flow's
only KEY saving is removing that single session-level plane switch.

`Done` is `LogScreen`'s `headerRight`; `ScreenShell` renders that header as the
first child inside its **non-sticky** `ScrollView` (the current-routine editor
passes no `stickyHeaderIndices`). Every task therefore ends with a scroll back up
to the header to reach `Done`. This return scroll applies to the auto-scrolling
`nextPrev` variant too.

- **T1, T2** edit the plain PPL note, which the editor renders whole:
  `RETURN_TO_HEADER_SCROLLS` = T1 3, T2 4 coarse return flings, keyed to how deep
  the last caret work landed in the full note (Push day ~line 67; the T2 lift on
  the last day ~line 160).
- **T3** edits an A/B routine. The current-routine editor's `TextInput` shows
  **only the active-week slice** — `useLogCurrentRoutineEditor.js`'s
  `activeEditText` returns the lines after `---` when Week B is active — so the
  user never scrolls through Week A. T3's return scroll is derived from that
  **61-line Week B slice** (`weekBReturnScroll`): the Week B target day is the
  first day in the slice, its heading + 4 exercise blocks end ~line 31, so
  `round1(31 / 20)` = **1.6** flings (vs. the 3 an earlier revision wrongly
  scaled off the full 122-line A/B document).

## Recorded assumptions

- Device class: low-end Android with GBoard, one-handed.
- Fixture: the #575 §8 **"180-line, 12-prior-session"** 3-day Push/Pull/Legs
  cumulative note (`PPL_CUMULATIVE_NOTE`) — 15 lifts (5 per day), **12 prior
  sessions per lift = 180 logged session rows**; the file is 201 lines
  (180 rows + 15 exercise headers + 3 day headings + 3 blank separators). Also a
  122-line A/B routine (`AB_ROUTINE_NOTE`), Upper/Lower, 6 prior sessions per
  lift, with a `---` week separator.
- Editor keyboard is the default alphabetic multiline field; autoCorrect /
  autoCapitalize / spellCheck are off.
- One key per literal character, comma counted once; the digit/symbol plane is
  entered once per editor session, not per row.
- `Done` scrolls away with the note (non-sticky header), so each task ends with a
  scroll back up to the header.
- The user logs exactly one working row per exercise; no parse errors are
  introduced.
- Autosave has already fired at idle before Done; Done is a re-save + check-in
  detection tap.
- Double-tap-to-source (#881, shipped) is **not** used in the baseline flow: it
  only reaches the first exercise of a session, so T1/T3 cannot use it for lifts
  2..n. Its effect on T2's single entry is tracked as a separate flow variant if
  needed.

## The three tasks

| Id | Task | Definition |
| --- | --- | --- |
| **T1** | Full push session | Open the editor, log one working row for each of the 5 Push-day lifts, exit. |
| **T2** | Single-lift touch-up | Open the editor, add one row to a single lift ~two-thirds down the note (Romanian Deadlift), exit. |
| **T3** | A/B Week B day | Week B is the active week; log one working row for each of the 4 Week B target-day lifts, exit. |

## Baseline — current `main`

Captured from `main` at the #940 implementation commit. These values are locked
by `logging-speed-benchmark.test.js`; changing the model requires re-recording
them here.

| Task | TAP | KEY | SCROLL | SCAN | CARET-FIX | Total actions | Elapsed (s) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| T1 — full push session | 7 | 54 | 10.0 | 5 | 3.5 | **79.5** | **52.3** |
| T2 — single-lift touch-up | 3 | 11 | 5.4 | 1 | 0.7 | **21.1** | **15.6** |
| T3 — A/B Week B day | 6 | 42 | 4.8 | 4 | 2.8 | **59.6** | **37.8** |

T3's `SCROLL` is `4 × 0.8` forward + `1.6` return, the return derived from the
61-line Week B slice the editor actually shows (not the full 122-line A/B note).

## After #938 — numeric / symbol keypad row (2026-09-03)

`WorkoutNoteKeypad` (PR #944) adds a focus-gated accessory row of one-tap
digits, space, comma, hyphen, asterisk, and newline keys to the workout-note
editor. On this model — session-level keyboard state, not per-row — its only
`KEY` effect is removing the single session-level digit/symbol plane switch
(`PLANE_SWITCH_KEYS`), so each task drops exactly **−1 KEY** and nothing else
moves. `caret placement / CARET_FIX / SCAN / SCROLL` are unchanged: reaching the
right line in a long note is #939's job, not this row's.

Generated by `renderMarkdownReport([BASELINE_FLOW, makeFlow({ keypad: true })])`.

| Task | TAP | KEY | SCROLL | SCAN | CARET-FIX | Total actions | Elapsed (s) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| T1 — full push session | 7 | 53 | 10.0 | 5 | 3.5 | **78.5** | **51.9** |
| T2 — single-lift touch-up | 3 | 10 | 5.4 | 1 | 0.7 | **20.1** | **15.2** |
| T3 — A/B Week B day | 6 | 41 | 4.8 | 4 | 2.8 | **58.6** | **37.4** |

Delta vs. current-`main` baseline: T1 −1.0 actions / −0.4 s (−1.3 %), T2 −1.0 /
−0.4 s, T3 −1.0 / −0.4 s. #938 on its own does not approach #575's ≥ 30 %
target — that needs #939's caret navigation (and possibly the gated
repeat-last-set option) on top; the combined #938 + #939 projection is in the
next section.

Where the cost is: caret positioning and scroll navigation in a long note
(`SCAN + SCROLL + TAP + CARET_FIX`, per exercise, plus the return scroll to
`Done`) is ~30 % of T1's actions and the bulk of the attention cost; the rest is
`KEY`, which is now almost entirely literal characters (one session-level plane
switch, not one per row). Expressing the sets themselves is not the bottleneck.

Reconciliation with #575 §8: that report estimated T1 ≈ 80 actions, T2 18–24,
T3 ≈ 62. This model computes **T1 79.5 / T2 21.1 / T3 59.6** — all within the
report's ranges, on the approved 180-row / 12-prior-session fixture. (Earlier
revisions used an 11-session fixture, charged a plane switch per row plus a
fractional comma surcharge, and scaled T3's return scroll off the whole A/B
document; corrected per Codex and review feedback on PR #942. The 12-session
fixture deepens each PPL block — hence T1/T2 SCROLL up slightly — while T3 is
scoped to the shorter visible Week B slice.)

## Rerunning after a logging-workflow change

Flip a flag on `BASELINE_FLOW` (via `makeFlow`) and re-run:

- `keypad: true` — #938 numeric / symbol input accessory row.
- `caretNav: 'nextPrev'` — #939 next / previous exercise caret navigation.
- `repeatLastSet: true` — #575 option C (gated; not yet an issue).

Then paste the new table here as a dated row-set beneath the baseline and note
which change produced it. Illustrative projection for #938 + #939 combined
(printed by the test today, not a measurement of shipped code):

| Task | TAP | KEY | SCROLL | SCAN | CARET-FIX | Total actions | Elapsed (s) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| T1 | 7 | 53 | 3 | 0 | 0 | 63.0 | 29.0 |
| T2 | 3 | 10 | 4 | 0 | 0 | 17.0 | 10.6 |
| T3 | 6 | 41 | 1.6 | 0 | 0 | 48.6 | 21.9 |

These deltas now reflect **session-level** keyboard state, not per-row: the #938
keypad removes only the one session plane switch (−1 KEY per task), and the
residual `SCROLL` is the return-to-`Done` fling that #939's auto-scroll does not
eliminate. On this model #938 + #939 cut T1 by ~21 % of total actions
(79.5 → 63.0) — short of #575's ≥ 30 % target, though `SCAN + CARET_FIX` on T1
does fall 100 % (8.5 → 0). The gap is the signal to weigh the gated
repeat-last-set option (`repeatLastSet: true`) or a sticky editor header.

## #575 targets (yardstick, not asserted here)

- #938 + #939: ≥ 30 % fewer total actions than `main` on T1, and ≥ 50 % fewer
  `SCAN + CARET_FIX` actions; no regression on the #889 long-note typing-latency
  benchmark.
- Repeat-last-set (if pursued): ≥ 45 % fewer `KEY` on T1, with zero unedited
  suggestions reaching disk.

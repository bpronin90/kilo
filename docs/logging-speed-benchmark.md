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
end-of-line multiline taps need a correction; `SCROLL 1.5` per exercise).

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
to the header to reach `Done` (`RETURN_TO_HEADER_SCROLLS`: T1 3, T2 4, T3 3
coarse return flings, keyed to how deep the last caret work ended). This return
scroll applies to the auto-scrolling `nextPrev` variant too.

## Recorded assumptions

- Device class: low-end Android with GBoard, one-handed.
- Fixture: 186-line 3-day Push/Pull/Legs cumulative note (`PPL_CUMULATIVE_NOTE`),
  11 prior sessions per lift, 15 lifts; 122-line A/B routine (`AB_ROUTINE_NOTE`),
  Upper/Lower, 6 prior sessions per lift, with a `---` week separator.
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
| T1 — full push session | 7 | 54 | 10.5 | 5 | 3.5 | **80.0** | **52.9** |
| T2 — single-lift touch-up | 3 | 11 | 5.5 | 1 | 0.7 | **21.2** | **15.7** |
| T3 — A/B Week B day | 6 | 42 | 9 | 4 | 2.8 | **63.8** | **42.8** |

Where the cost is: caret positioning and scroll navigation in a long note
(`SCAN + SCROLL + TAP + CARET_FIX`, per exercise, plus the return scroll to
`Done`) is ~30 % of T1's actions and the bulk of the attention cost; the rest is
`KEY`, which is now almost entirely literal characters (one session-level plane
switch, not one per row). Expressing the sets themselves is not the bottleneck.

Reconciliation with #575 §8: that report estimated T1 ≈ 80 actions, T2 18–24,
T3 ≈ 62. This model computes **T1 80.0 / T2 21.2 / T3 63.8** — all within the
report's ranges. (An earlier revision of this model inflated T1 to 86.0 by
charging a plane switch per row and adding a fractional comma surcharge; both
were corrected per Codex review on PR #942.)

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
| T3 | 6 | 41 | 3 | 0 | 0 | 50.0 | 23.6 |

These deltas now reflect **session-level** keyboard state, not per-row: the #938
keypad removes only the one session plane switch (−1 KEY per task), and the
residual `SCROLL` is the return-to-`Done` fling that #939's auto-scroll does not
eliminate. On this model #938 + #939 cut T1 by ~21 % of total actions
(80.0 → 63.0) — short of #575's ≥ 30 % target, though `SCAN + CARET_FIX` on T1
does fall 100 % (8.5 → 0). The gap is the signal to weigh the gated
repeat-last-set option (`repeatLastSet: true`) or a sticky editor header.

## #575 targets (yardstick, not asserted here)

- #938 + #939: ≥ 30 % fewer total actions than `main` on T1, and ≥ 50 % fewer
  `SCAN + CARET_FIX` actions; no regression on the #889 long-note typing-latency
  benchmark.
- Repeat-last-set (if pursued): ≥ 45 % fewer `KEY` on T1, with zero unedited
  suggestions reaching disk.

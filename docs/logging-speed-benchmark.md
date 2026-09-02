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

Keystrokes to type one session row (`keyCostForRow`): one key per character, plus
one switch into the digit/symbol plane, plus `0.5` per comma for the secondary
reach on the alphabetic keyboard. The #938 keypad flow removes the plane switch
and the comma reach (one key per character only).

## Recorded assumptions

- Device class: low-end Android with GBoard, one-handed.
- Fixture: 186-line 3-day Push/Pull/Legs cumulative note (`PPL_CUMULATIVE_NOTE`),
  11 prior sessions per lift, 15 lifts; 122-line A/B routine (`AB_ROUTINE_NOTE`),
  Upper/Lower, 6 prior sessions per lift, with a `---` week separator.
- Editor keyboard is the default alphabetic multiline field; autoCorrect /
  autoCapitalize / spellCheck are off.
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
| T1 — full push session | 7 | 63 | 7.5 | 5 | 3.5 | **86.0** | **52.9** |
| T2 — single-lift touch-up | 3 | 12 | 1.5 | 1 | 0.7 | **18.2** | **11.3** |
| T3 — A/B Week B day | 6 | 49 | 6 | 4 | 2.8 | **67.8** | **42.0** |

Where the cost is: caret positioning in a long note (`SCAN + SCROLL + TAP +
CARET_FIX`, repeated per exercise) is ~24 % of T1's actions and the bulk of the
attention cost; keyboard-plane toggling on all-numeric rows is the other large
share of `KEY`. Expressing the sets themselves is not the bottleneck.

Reconciliation with #575 §8: that report estimated T1 ≈ 80 actions from an
assumed ~8-character row. This model computes **86.0** from the fixture's actual
rows (avg ~9.4 characters) with an explicit plane-switch + comma-reach surcharge —
agreement within ~8 %. T2 (18–24 → 18.2) and T3 (≈62 → 67.8) likewise land in
the report's ranges.

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
| T1 | 7 | 53 | 0 | 0 | 0 | 60.0 | 25.4 |
| T2 | 3 | 10 | 0 | 0 | 0 | 13.0 | 5.8 |
| T3 | 6 | 41 | 0 | 0 | 0 | 47.0 | 20.0 |

## #575 targets (yardstick, not asserted here)

- #938 + #939: ≥ 30 % fewer total actions than `main` on T1, and ≥ 50 % fewer
  `SCAN + CARET_FIX` actions; no regression on the #889 long-note typing-latency
  benchmark.
- Repeat-last-set (if pursued): ≥ 45 % fewer `KEY` on T1, with zero unedited
  suggestions reaching disk.

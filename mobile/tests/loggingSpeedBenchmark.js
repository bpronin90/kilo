// Gym-logging speed benchmark model (issue #940, parent #575 §8).
//
// A deterministic state-transition model of the three representative
// gym-logging tasks approved in #575. It converts a step-by-step walkthrough
// of each task into action counts by kind (TAP, KEY, SCROLL, SCAN, CARET-FIX)
// and a derived elapsed time, for a fixed set of recorded assumptions.
//
// Why a model and not an instrumented UI run: the tasks span the editor, the
// on-screen keyboard, and scroll/scan attention that no unit test can observe.
// The model makes the #575 research estimate precise, versioned, and
// re-runnable: `logging-speed-benchmark.test.js` locks the current-`main`
// numbers, and any logging-workflow change is measured by flipping a flow
// flag below and re-running, then re-recording `docs/logging-speed-benchmark.md`.
//
// Scope: this file makes NO product-code change and imports only the parser
// (read-only) so the exercise lists are driven by the real fixture notes.

import { parseWorkoutNote } from '../lib/parser';
import {
  PPL_CUMULATIVE_NOTE,
  AB_ROUTINE_NOTE,
  PPL_PRIOR_SESSIONS_PER_LIFT,
  AB_PRIOR_SESSIONS_PER_LIFT,
  T1_PUSH_ROWS,
  T2_TOUCHUP_LIFT,
  T2_TOUCHUP_ROW,
  T3_WEEK_B_DAY,
  T3_WEEK_B_ROWS,
} from './fixtures/loggingSpeedNote';

// ── Action taxonomy ─────────────────────────────────────────────────────────
//
// One discrete user action or attention unit each:
//   TAP       - a screen tap (button, caret placement, Done).
//   KEY       - one on-screen keyboard key: a digit, comma, space, Return, or
//               a keyboard-plane switch.
//   SCROLL    - one deliberate scroll gesture.
//   SCAN      - one visual search to locate an exercise block in a long note.
//   CARET_FIX - one re-tap / caret-handle drag after an imprecise multiline
//               tap landed the caret in the wrong place.

export const ACTION_KINDS = ['TAP', 'KEY', 'SCROLL', 'SCAN', 'CARET_FIX'];

// Per-action wall-clock cost, seconds. From #575 §8. Elapsed time in this
// model is exactly Σ(count × cost); it deliberately excludes recall/decision
// latency (deciding what to log), which is not one of the five action kinds.
export const ACTION_COST_SECONDS = {
  TAP: 0.6,
  KEY: 0.4,
  SCROLL: 1.2,
  SCAN: 1.5,
  CARET_FIX: 2.0,
};

// Sub-rates used to build per-exercise steps. Kept named so the model is
// auditable rather than a pile of literals.
const CARET_FIX_RATE = 0.7; // fraction of end-of-line multiline caret taps that need a correction
const REPEAT_ADJUST_KEYS = 3; // keystrokes to tweak a pre-filled "repeat last set" row

// Note lines visible above the raised keyboard in the editor on a low-end
// phone. Forward scrolling to bring an exercise block's last logged row into
// view scales with how deep the block is: a block is `1 header + N prior
// session rows`, so deeper history (more prior sessions) costs more scroll
// gestures per exercise. At the #575 §8 fixture depth (12 prior sessions ->
// 13-line block) this yields ~1.4, matching #575 §1's "~1.5" estimate.
const EDITOR_VISIBLE_NOTE_LINES = 9;

function round1(n) {
  return Math.round(n * 10) / 10;
}

function forwardScrollPerExercise(priorSessions) {
  return round1((1 + priorSessions) / EDITOR_VISIBLE_NOTE_LINES);
}

// GBoard keeps the digit/symbol plane active while the user scrolls and moves
// the caret within the same focused multiline input, so the switch into that
// plane is paid once per editor session, not once per row.
const PLANE_SWITCH_KEYS = 1;

// `Done` is LogScreen's `headerRight`; ScreenShell renders that header as the
// first child *inside* its non-sticky ScrollView (the current-routine editor
// passes no `stickyHeaderIndices`). After scrolling down the note to place
// carets, the user must fling back up to the header to tap Done. Coarse
// return flings, keyed to how deep in the note the last caret work ended:
//   T1 - Push is the first day (~top third)        -> 3
//   T2 - touch-up lift is on the last day (~3/4)   -> 4
//   T3 - Week B target day sits past the midpoint  -> 3
const RETURN_TO_HEADER_SCROLLS = { T1: 3, T2: 4, T3: 3 };

// ── Flow configuration ──────────────────────────────────────────────────────
//
// The baseline is current `main`. Each later logging-workflow issue flips one
// flag and the benchmark is re-run for a comparable delta.

export const BASELINE_FLOW = Object.freeze({
  label: 'current main',
  keypad: false, // #938: numeric / symbol input accessory row
  caretNav: 'manual', // 'manual' | 'nextPrev'  (#939: next/previous exercise caret navigation)
  repeatLastSet: false, // gated repeat-last-set suggestion (#575 option C, not yet an issue)
});

export function makeFlow(overrides = {}) {
  return { ...BASELINE_FLOW, label: overrides.label || 'variant', ...overrides };
}

// ── Cost primitives ─────────────────────────────────────────────────────────

// Keystrokes to type one session row (e.g. "225 5,5,5"): one actual keypress
// per literal character, comma included. No plane-switch term here - the
// digit/symbol plane is entered once per editor session (see
// `keyboardPlaneSetupStep`), not re-entered per row, and GBoard keeps it
// active across the scroll/caret moves between rows. The #938 keypad flow
// changes nothing about the per-character count; its only KEY saving is
// removing that one session-level plane switch.
export function keyCostForRow(rowText) {
  return rowText.length;
}

function emptyCounts() {
  return { TAP: 0, KEY: 0, SCROLL: 0, SCAN: 0, CARET_FIX: 0 };
}

function step(label, counts) {
  return { label, ...emptyCounts(), ...counts };
}

// Locate an exercise block and put the caret at the end of its last row.
// `priorSessions` is the block's logged-history depth (drives forward scroll).
function positionCaretStep(exerciseName, flow, priorSessions) {
  if (flow.caretNav === 'nextPrev') {
    // #939: one tap on Next/Previous; the editor auto-scrolls the target into
    // view and places the caret. No visual search, no caret correction.
    return step(`Tap Next exercise -> caret lands at end of "${exerciseName}"`, { TAP: 1 });
  }
  return step(`Locate "${exerciseName}", scroll its last row into view, tap to place caret`, {
    SCAN: 1,
    SCROLL: forwardScrollPerExercise(priorSessions),
    TAP: 1,
    CARET_FIX: CARET_FIX_RATE,
  });
}

// One-time step: bring the keyboard onto the digit/symbol plane for the whole
// editor session. The #938 keypad flow removes it (dedicated digit keys).
function keyboardPlaneSetupStep(flow) {
  if (flow.keypad) return null;
  return step('Switch keyboard to the digit/symbol plane (once for the editor session)', {
    KEY: PLANE_SWITCH_KEYS,
  });
}

// Scroll back up to the non-sticky header to reach Done.
function returnToHeaderStep(taskId) {
  return step('Scroll back up to the header to reach Done', {
    SCROLL: RETURN_TO_HEADER_SCROLLS[taskId],
  });
}

// Add today's working row for one exercise.
function enterRowStep(exerciseName, rowText, flow) {
  if (flow.repeatLastSet) {
    // #575 option C: invoke the suggestion, tap Add to splice last session's
    // row in with the weight token selected, then retype the parts that changed.
    return step(`Repeat last set for "${exerciseName}", adjust to "${rowText}"`, {
      TAP: 2,
      KEY: REPEAT_ADJUST_KEYS,
    });
  }
  return step(`New line + type "${rowText}" for "${exerciseName}"`, {
    KEY: 1 + keyCostForRow(rowText),
  });
}

// ── Task walkthroughs ───────────────────────────────────────────────────────

function pplSectionsFor(heading) {
  const { sections } = parseWorkoutNote(PPL_CUMULATIVE_NOTE);
  return sections.filter((s) => s.heading && s.heading.toLowerCase().startsWith(heading.toLowerCase()));
}

function liftNames(sections) {
  return sections.flatMap((s) => s.exercises.map((e) => e.name));
}

// T1 - full push session: open the editor, log one working row for each lift
// on the Push day, exit.
function walkT1(flow) {
  const names = liftNames(pplSectionsFor('Monday'));
  if (names.length !== T1_PUSH_ROWS.length) {
    throw new Error(`T1 fixture drift: ${names.length} push lifts vs ${T1_PUSH_ROWS.length} rows`);
  }
  const steps = [step('Tap Edit on the current-routine card -> editor opens, caret at end of note', { TAP: 1 })];
  const planeSetup = keyboardPlaneSetupStep(flow);
  if (planeSetup) steps.push(planeSetup);
  names.forEach((name, i) => {
    steps.push(positionCaretStep(name, flow, PPL_PRIOR_SESSIONS_PER_LIFT));
    steps.push(enterRowStep(name, T1_PUSH_ROWS[i], flow));
  });
  steps.push(returnToHeaderStep('T1'));
  steps.push(step('Tap Done (autosave already fired; Done re-saves + runs check-in detection)', { TAP: 1 }));
  return steps;
}

// T2 - single-lift touch-up: open the editor, add one row to a single lift
// ~two-thirds down the note, exit.
function walkT2(flow) {
  const steps = [step('Tap Edit on the current-routine card -> editor opens, caret at end of note', { TAP: 1 })];
  const planeSetup = keyboardPlaneSetupStep(flow);
  if (planeSetup) steps.push(planeSetup);
  steps.push(positionCaretStep(T2_TOUCHUP_LIFT, flow, PPL_PRIOR_SESSIONS_PER_LIFT));
  steps.push(enterRowStep(T2_TOUCHUP_LIFT, T2_TOUCHUP_ROW, flow));
  steps.push(returnToHeaderStep('T2'));
  steps.push(step('Tap Done', { TAP: 1 }));
  return steps;
}

// T3 - A/B Week B day: Week B is already the active week; log one working row
// for each lift on the Week B target day, exit.
function walkT3(flow) {
  const { sections, weekBStartIndex } = parseWorkoutNote(AB_ROUTINE_NOTE);
  if (weekBStartIndex == null) throw new Error('T3 fixture drift: AB_ROUTINE_NOTE has no `---` week separator');
  const weekB = sections.slice(weekBStartIndex);
  const names = liftNames(
    weekB.filter((s) => s.heading && s.heading.toLowerCase().startsWith(T3_WEEK_B_DAY.toLowerCase())),
  );
  if (names.length !== T3_WEEK_B_ROWS.length) {
    throw new Error(`T3 fixture drift: ${names.length} Week B lifts vs ${T3_WEEK_B_ROWS.length} rows`);
  }
  const steps = [
    step('Tap Edit on the current-routine card -> editor opens on the active week (Week B)', { TAP: 1 }),
  ];
  const planeSetup = keyboardPlaneSetupStep(flow);
  if (planeSetup) steps.push(planeSetup);
  names.forEach((name, i) => {
    steps.push(positionCaretStep(name, flow, AB_PRIOR_SESSIONS_PER_LIFT));
    steps.push(enterRowStep(name, T3_WEEK_B_ROWS[i], flow));
  });
  steps.push(returnToHeaderStep('T3'));
  steps.push(step('Tap Done', { TAP: 1 }));
  return steps;
}

export const TASKS = [
  { id: 'T1', title: 'Full push session (5 lifts, one working row each)', walk: walkT1 },
  { id: 'T2', title: 'Single-lift touch-up (one row added ~two-thirds down)', walk: walkT2 },
  { id: 'T3', title: 'A/B Week B day (4 lifts, one working row each)', walk: walkT3 },
];

// ── Aggregation ─────────────────────────────────────────────────────────────

export function tally(steps) {
  const counts = emptyCounts();
  for (const s of steps) {
    for (const k of ACTION_KINDS) counts[k] += s[k] || 0;
  }
  return counts;
}

export function totalActions(counts) {
  return ACTION_KINDS.reduce((sum, k) => sum + counts[k], 0);
}

export function elapsedSeconds(counts) {
  return ACTION_KINDS.reduce((sum, k) => sum + counts[k] * ACTION_COST_SECONDS[k], 0);
}

export function measureTask(task, flow = BASELINE_FLOW) {
  const steps = task.walk(flow);
  const counts = tally(steps);
  const rounded = {};
  for (const k of ACTION_KINDS) rounded[k] = round1(counts[k]);
  return {
    id: task.id,
    title: task.title,
    flow: flow.label,
    steps,
    counts: rounded,
    totalActions: round1(totalActions(counts)),
    elapsedSeconds: round1(elapsedSeconds(counts)),
  };
}

export function runBenchmark(flow = BASELINE_FLOW) {
  return TASKS.map((t) => measureTask(t, flow));
}

// ── Recorded assumptions (for the living doc) ───────────────────────────────

export const ASSUMPTIONS = [
  'Device class: low-end Android with GBoard, one-handed.',
  'Fixture: the #575 §8 "180-line, 12-prior-session" 3-day PPL cumulative note (`PPL_CUMULATIVE_NOTE`) - 15 lifts, 12 prior sessions each = 180 logged session rows; A/B routine (`AB_ROUTINE_NOTE`), 6 prior sessions per lift, with a `---` week separator.',
  'Forward scroll to reach an exercise scales with its block depth (1 header + N prior session rows) over ~9 visible editor lines; ~1.4 per exercise at the 12-session PPL depth, ~0.8 at the 6-session A/B depth.',
  'Editor keyboard is the default alphabetic multiline field; autoCorrect / autoCapitalize / spellCheck are off.',
  'One key per literal character, comma counted once. The digit/symbol plane is entered once per editor session (GBoard keeps it active across scroll/caret moves), not per row.',
  'Done is LogScreen `headerRight`, rendered inside ScreenShell\'s non-sticky ScrollView, so each task ends with a scroll back up to the header to tap Done.',
  'The user logs exactly one working row per exercise; no parse errors are introduced.',
  'Autosave has already fired at idle before Done; Done is a re-save + check-in detection tap.',
  'Elapsed time = Σ(action count × per-action cost); recall/decision latency is excluded.',
  `Per-action costs (s): ${ACTION_KINDS.map((k) => `${k} ${ACTION_COST_SECONDS[k]}`).join(', ')}.`,
];

// ── Markdown report (printed by the test; paste into the living doc) ─────────

export function renderMarkdownReport(flows = [BASELINE_FLOW]) {
  const lines = [];
  for (const flow of flows) {
    lines.push(`#### Flow: ${flow.label}`);
    lines.push('');
    lines.push('| Task | TAP | KEY | SCROLL | SCAN | CARET-FIX | Total actions | Elapsed (s) |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const r of runBenchmark(flow)) {
      lines.push(
        `| ${r.id} ${r.title} | ${r.counts.TAP} | ${r.counts.KEY} | ${r.counts.SCROLL} | ${r.counts.SCAN} | ${r.counts.CARET_FIX} | ${r.totalActions} | ${r.elapsedSeconds} |`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

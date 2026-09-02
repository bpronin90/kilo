// Issue #940 (parent #575 §8): a repeatable baseline for the three
// representative gym-logging tasks, plus proof the same model supports a
// comparable rerun after a logging-workflow change.
//
// This suite:
//   1. guards the fixture notes against grammar drift (they must parse clean),
//   2. locks the action taxonomy,
//   3. locks the current-`main` baseline action counts + elapsed time for
//      T1/T2/T3 - the numbers recorded in docs/logging-speed-benchmark.md,
//   4. shows a rerun with a changed flow (#938 keypad + #939 next/prev)
//      recomputes comparably and moves the numbers in the expected direction,
//   5. prints the markdown report for pasting into the living doc.

import { parseWorkoutNote } from '../lib/parser';
import {
  PPL_CUMULATIVE_NOTE,
  AB_ROUTINE_NOTE,
  PPL_PRIOR_SESSIONS_PER_LIFT,
  AB_PRIOR_SESSIONS_PER_LIFT,
  FIXTURE_META,
} from './fixtures/loggingSpeedNote';
import {
  ACTION_KINDS,
  ACTION_COST_SECONDS,
  BASELINE_FLOW,
  makeFlow,
  runBenchmark,
  measureTask,
  TASKS,
  keyCostForRow,
  renderMarkdownReport,
} from './loggingSpeedBenchmark';

function byId(results, id) {
  return results.find((r) => r.id === id);
}

// ── 1. Fixture sanity ───────────────────────────────────────────────────────

describe('benchmark fixtures parse clean under the real grammar', () => {
  test('PPL_CUMULATIVE_NOTE is a well-formed ~180-line 3-day cumulative note', () => {
    const parsed = parseWorkoutNote(PPL_CUMULATIVE_NOTE);
    expect(parsed.ok).not.toBe(false);
    expect(parsed.problems).toEqual([]);

    const lineCount = PPL_CUMULATIVE_NOTE.split('\n').length;
    expect(lineCount).toBe(FIXTURE_META.pplLineCount);
    expect(lineCount).toBeGreaterThanOrEqual(170);
    expect(lineCount).toBeLessThanOrEqual(195);

    const allLifts = parsed.sections.flatMap((s) => s.exercises);
    expect(allLifts).toHaveLength(FIXTURE_META.pplLiftCount);
    expect(FIXTURE_META.pplLiftCount).toBe(15);

    // Every lift carries its logged history, so caret navigation and scanning
    // are exercised against real depth.
    for (const lift of allLifts) {
      expect(lift.session_entries).toHaveLength(PPL_PRIOR_SESSIONS_PER_LIFT);
    }
  });

  test('the Push day has exactly the five lifts T1 logs', () => {
    const { sections } = parseWorkoutNote(PPL_CUMULATIVE_NOTE);
    const monday = sections.filter((s) => s.heading && s.heading.toLowerCase().startsWith('monday'));
    const names = monday.flatMap((s) => s.exercises.map((e) => e.name));
    expect(names).toEqual([
      'Bench Press',
      'Overhead Press',
      'Incline DB Press',
      'Triceps Pushdown',
      'Lateral Raise',
    ]);
  });

  test('AB_ROUTINE_NOTE has a week separator and a 4-lift Week B target day', () => {
    const parsed = parseWorkoutNote(AB_ROUTINE_NOTE);
    expect(parsed.ok).not.toBe(false);
    expect(parsed.problems).toEqual([]);
    expect(typeof parsed.weekBStartIndex).toBe('number');
    expect(parsed.weekBStartIndex).toBeGreaterThanOrEqual(1);

    const weekB = parsed.sections.slice(parsed.weekBStartIndex);
    const mondayB = weekB.filter((s) => s.heading && s.heading.toLowerCase().startsWith('monday'));
    const names = mondayB.flatMap((s) => s.exercises.map((e) => e.name));
    expect(names).toHaveLength(4);
    for (const s of weekB) {
      for (const lift of s.exercises) {
        expect(lift.session_entries).toHaveLength(AB_PRIOR_SESSIONS_PER_LIFT);
      }
    }
  });
});

// ── 2. Action taxonomy ──────────────────────────────────────────────────────

describe('action taxonomy is fixed', () => {
  test('exactly TAP / KEY / SCROLL / SCAN / CARET_FIX, each with a cost', () => {
    expect(ACTION_KINDS).toEqual(['TAP', 'KEY', 'SCROLL', 'SCAN', 'CARET_FIX']);
    expect(Object.keys(ACTION_COST_SECONDS).sort()).toEqual([...ACTION_KINDS].sort());
    for (const k of ACTION_KINDS) {
      expect(typeof ACTION_COST_SECONDS[k]).toBe('number');
      expect(ACTION_COST_SECONDS[k]).toBeGreaterThan(0);
    }
  });

  test('keyCostForRow: alphabetic plane pays a plane switch + comma reach; keypad does not', () => {
    // "225 5,5,5" = 9 chars, +1 plane switch, +2 commas x 0.5
    expect(keyCostForRow('225 5,5,5')).toBeCloseTo(11);
    expect(keyCostForRow('225 5,5,5', { keypad: true })).toBe(9);
  });
});

// ── 3. Current-main baseline (locked; mirrored in the living doc) ────────────

describe('current-main baseline action counts and elapsed time', () => {
  const results = runBenchmark(BASELINE_FLOW);

  test('T1 - full push session', () => {
    const r = byId(results, 'T1');
    expect(r.counts).toEqual({ TAP: 7, KEY: 63, SCROLL: 7.5, SCAN: 5, CARET_FIX: 3.5 });
    expect(r.totalActions).toBeCloseTo(86);
    expect(r.elapsedSeconds).toBeCloseTo(52.9);
  });

  test('T2 - single-lift touch-up', () => {
    const r = byId(results, 'T2');
    expect(r.counts).toEqual({ TAP: 3, KEY: 12, SCROLL: 1.5, SCAN: 1, CARET_FIX: 0.7 });
    expect(r.totalActions).toBeCloseTo(18.2);
    expect(r.elapsedSeconds).toBeCloseTo(11.3);
  });

  test('T3 - A/B Week B day', () => {
    const r = byId(results, 'T3');
    expect(r.counts).toEqual({ TAP: 6, KEY: 49, SCROLL: 6, SCAN: 4, CARET_FIX: 2.8 });
    expect(r.totalActions).toBeCloseTo(67.8);
    expect(r.elapsedSeconds).toBeCloseTo(42);
  });

  test('elapsed time equals the sum of action-cost products', () => {
    for (const r of results) {
      const expected = ACTION_KINDS.reduce((sum, k) => sum + r.counts[k] * ACTION_COST_SECONDS[k], 0);
      expect(r.elapsedSeconds).toBeCloseTo(Math.round(expected * 10) / 10);
    }
  });
});

// ── 4. Comparable rerun after a logging-workflow change ─────────────────────

describe('the same model reruns comparably for a changed flow', () => {
  const improvedFlow = makeFlow({
    label: 'A + B: numeric keypad (#938) + next/prev caret nav (#939)',
    keypad: true,
    caretNav: 'nextPrev',
  });
  const base = runBenchmark(BASELINE_FLOW);
  const improved = runBenchmark(improvedFlow);

  test('every task still reports all five action kinds', () => {
    for (const r of improved) {
      expect(Object.keys(r.counts).sort()).toEqual([...ACTION_KINDS].sort());
    }
  });

  test('next/prev caret nav removes visual search and caret correction on T1', () => {
    const t1 = byId(improved, 'T1');
    expect(t1.counts.SCAN).toBe(0);
    expect(t1.counts.CARET_FIX).toBe(0);
  });

  test('T1 improves on every headline metric and by a meaningful margin', () => {
    const b = byId(base, 'T1');
    const i = byId(improved, 'T1');
    expect(i.counts.KEY).toBeLessThan(b.counts.KEY);
    expect(i.totalActions).toBeLessThan(b.totalActions);
    expect(i.elapsedSeconds).toBeLessThan(b.elapsedSeconds);

    const actionReduction = (b.totalActions - i.totalActions) / b.totalActions;
    const scanFixReduction =
      (b.counts.SCAN + b.counts.CARET_FIX - i.counts.SCAN - i.counts.CARET_FIX) /
      (b.counts.SCAN + b.counts.CARET_FIX);
    expect(actionReduction).toBeGreaterThanOrEqual(0.2);
    expect(scanFixReduction).toBeGreaterThanOrEqual(0.5);
  });

  test('measureTask exposes an auditable per-step breakdown', () => {
    const r = measureTask(TASKS[0], BASELINE_FLOW);
    expect(Array.isArray(r.steps)).toBe(true);
    expect(r.steps.length).toBeGreaterThan(5);
    for (const s of r.steps) {
      expect(typeof s.label).toBe('string');
      for (const k of ACTION_KINDS) expect(typeof s[k]).toBe('number');
    }
  });
});

// ── 5. Report ──────────────────────────────────────────────────────────────

describe('markdown report', () => {
  test('renders a table row per task for each requested flow', () => {
    const md = renderMarkdownReport([
      BASELINE_FLOW,
      makeFlow({ label: 'A + B', keypad: true, caretNav: 'nextPrev' }),
    ]);
    expect(md).toContain('| Task | TAP | KEY | SCROLL | SCAN | CARET-FIX | Total actions | Elapsed (s) |');
    expect(md).toMatch(/\| T1 .* \|/);
    expect(md).toMatch(/\| T2 .* \|/);
    expect(md).toMatch(/\| T3 .* \|/);
    // eslint-disable-next-line no-console
    console.log(
      '\n' +
        renderMarkdownReport([
          BASELINE_FLOW,
          makeFlow({
            label: 'A + B: numeric keypad (#938) + next/prev caret nav (#939)',
            keypad: true,
            caretNav: 'nextPrev',
          }),
        ]) +
        '\n',
    );
  });
});

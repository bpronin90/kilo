import { parseWorkoutNote, parseWorkoutRow } from '../lib/parser';
import { applyWeekSkipToText } from '../lib/parser/workoutNoteMutations.js';
import { insertionIndex } from '../lib/interoperability/normalizationHeaderEdits.js';
import { MAX_SETS_PER_ROW } from '../lib/parser/workoutRow.js';

const deload = (n, reps = 5) => `Squat: 135 lb ${n}x${reps}`;

describe('compact deload set-count bound (#1482)', () => {
  test('normal generated line keeps its parsed meaning', () => {
    const { ok, sections, problems } = parseWorkoutNote(deload(3));
    expect(ok).toBe(true);
    expect(problems).toEqual([]);
    const ex = sections[0].exercises[0];
    expect(ex.sets).toHaveLength(3);
    expect(ex.sets[2]).toMatchObject({ set_index: 3, rep_count: 5, weight_value: 135, weight_unit: 'lb' });
  });

  test('exact limit parses, limit + 1 is rejected without sets', () => {
    const at = parseWorkoutNote(deload(MAX_SETS_PER_ROW));
    expect(at.problems).toEqual([]);
    expect(at.sections[0].exercises[0].sets).toHaveLength(MAX_SETS_PER_ROW);

    const over = parseWorkoutNote(`Bench\n${deload(MAX_SETS_PER_ROW + 1)}`);
    const ex = over.sections[0].exercises[0];
    expect(ex.sets).toEqual([]);
    expect(ex.unparsed_rows).toEqual([deload(MAX_SETS_PER_ROW + 1)]);
    expect(over.problems).toHaveLength(1);
    expect(over.problems[0]).toMatchObject({ line: 2, severity: 'error', exerciseName: 'Squat' });
    expect(over.problems[0].message).toMatch(/Too many sets/);
  });

  test('huge digit strings and non-safe integers are rejected', () => {
    for (const n of ['99999999', '9007199254740993', '9'.repeat(400)]) {
      const r = parseWorkoutNote(deload(n));
      expect(r.sections[0].exercises[0].sets).toEqual([]);
      expect(r.problems).toHaveLength(1);
      expect(r.problems[0].message.length).toBeLessThan(120);
    }
  });

  test('zero keeps existing behavior (no sets, no problem)', () => {
    const r = parseWorkoutNote(deload(0));
    expect(r.sections[0].exercises[0].sets).toEqual([]);
    expect(r.problems).toEqual([]);
  });

  test('repeated lines: one problem per bad line, good lines unaffected', () => {
    const text = [deload(3), deload(101), deload(4), deload(101)].join('\n');
    const r = parseWorkoutNote(text);
    const ex = r.sections[0].exercises;
    expect(ex.map(e => e.sets.length)).toEqual([3, 0, 4, 0]);
    expect(r.problems.map(p => p.line)).toEqual([2, 4]);
  });
});

describe('row set-count bound (#1482)', () => {
  const group = n => Array(n).fill('5').join(',');

  test('rep group and weighted row accept the limit and reject limit + 1', () => {
    expect(parseWorkoutRow(group(MAX_SETS_PER_ROW)).sets).toHaveLength(MAX_SETS_PER_ROW);
    expect(parseWorkoutRow(`100 ${group(MAX_SETS_PER_ROW)}`).sets).toHaveLength(MAX_SETS_PER_ROW);
    for (const row of [group(MAX_SETS_PER_ROW + 1), `100 ${group(MAX_SETS_PER_ROW + 1)}`]) {
      const r = parseWorkoutRow(row);
      expect(r.ok).toBe(false);
      expect(r.category).toBe('invalid_field_value');
      expect(r.error).toMatch(/Too many sets/);
    }
  });

  test('multiple weight groups share the per-row budget', () => {
    const half = group(60);
    const r = parseWorkoutRow(`100 ${half} 110 ${half}`);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Too many sets/);
  });

  test('over-limit row in a note becomes a located problem', () => {
    const r = parseWorkoutNote(`-Bench\n100 ${group(MAX_SETS_PER_ROW + 1)}`);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatchObject({ line: 2, exerciseName: 'Bench' });
    expect(r.sections[0].exercises[0].sets).toEqual([]);
  });

  test('over-limit continuation segment is rejected, not demoted to prose tail', () => {
    const over = parseWorkoutRow(`100 5 - 90 ${group(MAX_SETS_PER_ROW + 1)}`);
    expect(over.ok).toBe(false);
    expect(over.error).toMatch(/Too many sets/);
    const atLimit = parseWorkoutRow(`100 5 - 90 ${group(MAX_SETS_PER_ROW - 1)}`);
    expect(atLimit.ok).toBe(true);
    expect(atLimit.sets).toHaveLength(MAX_SETS_PER_ROW);
    expect(atLimit.tail).toBeNull();
    const note = parseWorkoutNote(`-Bench\n100 5 - 90 ${group(MAX_SETS_PER_ROW + 1)}`);
    expect(note.problems).toHaveLength(1);
    expect(note.sections[0].exercises[0].sets).toEqual([]);
  });

  test('missing-space dash row (-100 5,5,...) is a set row at the limit and a located problem over it', () => {
    const ok = parseWorkoutNote(`-Bench\n-100 ${group(MAX_SETS_PER_ROW)}`);
    expect(ok.problems).toEqual([]);
    expect(ok.sections[0].exercises).toHaveLength(1);
    expect(ok.sections[0].exercises[0].sets).toHaveLength(MAX_SETS_PER_ROW);

    const over = parseWorkoutNote(`-Bench\n-100 ${group(MAX_SETS_PER_ROW + 1)}`);
    expect(over.ok).toBe(true);
    expect(over.sections[0].exercises).toHaveLength(1);
    expect(over.sections[0].exercises[0].name).toBe('Bench');
    expect(over.sections[0].exercises[0].sets).toEqual([]);
    expect(over.problems).toHaveLength(1);
    expect(over.problems[0]).toMatchObject({ line: 2, exerciseName: 'Bench', severity: 'error' });
    expect(over.problems[0].message).toMatch(/Too many sets/);
  });

  test('over-limit missing-space row with no exercise is the existing no-exercise rejection', () => {
    const r = parseWorkoutNote(`-100 ${group(MAX_SETS_PER_ROW + 1)}`);
    expect(r.ok).toBe(false);
    expect(r.sections).toEqual([]);
  });

  test('header-line classifiers treat over-limit rows as set rows', () => {
    const over = `-100 ${group(MAX_SETS_PER_ROW + 1)}`;
    // normalization insertionIndex: over-limit row still counts as a set row.
    expect(insertionIndex(['-Bench', over, '-Squat'], 0, new Set([2]))).toBe(1);
    // week-skip mutation: over-limit row must not count as a new exercise header.
    const text = `-Bench\n- 100 5\n${over}`;
    const parsed = parseWorkoutNote(text);
    expect(applyWeekSkipToText(text, parsed.sections)).toBe(`${text}\n-`);
  });
});

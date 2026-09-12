// Module-boundary contract for the #1057 split of lib/parser/workoutNote.js
// into workoutNoteCore / workoutNoteErrors / workoutNoteMutations.
//
// Everything here imports through the compatibility barrel
// (lib/parser/workoutNote) exactly as production consumers do, so the test
// fails if the split changed the public surface, a parse-result shape, an
// error message, ordering, week-skip mutation, or progression-insertion
// formatting. Golden fixtures cover: malformed input, maximum length, CRLF,
// duplicate exercises, skipped weeks, progression insertion, and
// parse -> mutation -> parse round trips.
import {
  parseWorkoutNote,
  applyWeekSkipToText,
  removeWeekSkipFromText,
  applyProgressionSuggestionToNoteText,
  MAX_RAW_TEXT_LENGTH,
} from '../lib/parser/workoutNote';

// The two user-visible parser strings this refactor must preserve byte for
// byte. Pinned as literals (not derived from the engine) so a message drift is
// caught. See workoutNoteCore.js / workoutNoteErrors.js.
const NO_EXERCISE_SET_ROW_MESSAGE = (raw) =>
  `Set row with no exercise — start the exercise with "- " (a dash and a space): "${raw}"`;
const PROSE_AS_SET_ROW_MESSAGE =
  'This looks like a note, not a set — start it with "-- " (two dashes and a space) to keep it as a comment.';

const workingSuggestion = () => ({
  name: 'Bench Press',
  suggested: true,
  heuristic: {
    action: 'increase_weight',
    unit: 'lb',
    suggested_weight: 140,
    suggested_sets: 3,
    suggested_reps: 5,
  },
  evidence: { rep_range: { sets: 3, lo: 5, hi: 8 } },
});

describe('workoutNote barrel — public surface', () => {
  test('re-exports the full parsing + mutation surface', () => {
    expect(typeof parseWorkoutNote).toBe('function');
    expect(typeof applyWeekSkipToText).toBe('function');
    expect(typeof removeWeekSkipFromText).toBe('function');
    expect(typeof applyProgressionSuggestionToNoteText).toBe('function');
    expect(MAX_RAW_TEXT_LENGTH).toBe(200000);
  });

  test('empty / whitespace input returns the safe-empty parse shape', () => {
    for (const input of ['', '   ', '\n\n', undefined, null]) {
      expect(parseWorkoutNote(input)).toEqual({
        ok: true,
        sections: [],
        weekBStartIndex: null,
        problems: [],
      });
    }
  });
});

describe('golden: malformed input', () => {
  test('set row with no open exercise is a Tier-A rejection with kept problems', () => {
    const result = parseWorkoutNote('-230 5');
    expect(result.ok).toBe(false);
    expect(result.error).toBe(NO_EXERCISE_SET_ROW_MESSAGE('-230 5'));
    expect(result.sections).toEqual([]);
    expect(result.weekBStartIndex).toBeNull();
    expect(result.problems).toEqual([
      {
        line: 1,
        message: NO_EXERCISE_SET_ROW_MESSAGE('-230 5'),
        exerciseName: null,
        severity: 'error',
      },
    ]);
  });

  test('malformed import directive surfaces the ImportRecordError message', () => {
    expect(parseWorkoutNote('-@import-exercise')).toEqual({
      ok: false,
      error: 'Invalid imported workout record: exercise name is empty.',
      sections: [],
      weekBStartIndex: null,
      problems: [],
    });
  });

  test('bare prose typed as a set row is preserved with the note-form hint', () => {
    const result = parseWorkoutNote('-Bench Press: 3x5\n- feeling strong today');
    expect(result.ok).toBe(true);
    const ex = result.sections[0].exercises[0];
    expect(ex.unparsed_rows).toEqual(['feeling strong today']);
    const entry = ex.session_entries[ex.session_entries.length - 1];
    expect(entry.unparsed).toBe(true);
    expect(entry.error).toBe(PROSE_AS_SET_ROW_MESSAGE);
    expect(result.problems).toEqual([
      {
        line: 2,
        message: PROSE_AS_SET_ROW_MESSAGE,
        exerciseName: 'Bench Press',
        severity: 'error',
      },
    ]);
  });
});

describe('golden: maximum length', () => {
  test('input at the cap parses; one over the cap is rejected with the exact message', () => {
    const atCap = 'a'.repeat(MAX_RAW_TEXT_LENGTH);
    const atCapResult = parseWorkoutNote(atCap);
    expect(atCapResult.ok).toBe(true);

    const overCap = 'a'.repeat(MAX_RAW_TEXT_LENGTH + 1);
    expect(parseWorkoutNote(overCap)).toEqual({
      ok: false,
      error: `Note text is too large to parse (${MAX_RAW_TEXT_LENGTH + 1} characters; limit ${MAX_RAW_TEXT_LENGTH}).`,
      sections: [],
      weekBStartIndex: null,
      problems: [],
    });
  });

  test('progression apply refuses an over-cap note byte-for-byte', () => {
    const overCap = 'a'.repeat(MAX_RAW_TEXT_LENGTH + 1);
    const out = applyProgressionSuggestionToNoteText(overCap, workingSuggestion());
    expect(out).toEqual({ text: overCap, applied: false, reason: 'note-too-large' });
  });
});

describe('golden: CRLF equivalence', () => {
  test('CRLF and LF notes parse to identical sections', () => {
    const lf = 'Monday\n+LIFTING\n-Bench Press: 3x5\n135 5,5,5\n-Squat: 3x5\n225 5,5,5';
    const crlf = lf.replace(/\n/g, '\r\n');
    const lfParsed = parseWorkoutNote(lf);
    const crlfParsed = parseWorkoutNote(crlf);
    expect(crlfParsed.ok).toBe(true);
    expect(crlfParsed).toEqual(lfParsed);
  });
});

describe('golden: duplicate exercises + ordering', () => {
  test('same-named warmup and working occurrences are distinct, in order', () => {
    const note = '+WARMUP\n-Bench Press\n45 10\n+LIFTING\n-Bench Press: 3x5\n135 5,5,5';
    const parsed = parseWorkoutNote(note);
    expect(parsed.ok).toBe(true);
    const occurrences = parsed.sections.flatMap((s) => s.exercises.map((e) => ({ kind: s.kind, name: e.name })));
    expect(occurrences).toEqual([
      { kind: 'warmup', name: 'Bench Press' },
      { kind: 'lifting', name: 'Bench Press' },
    ]);
  });

  test('progression insertion targets the working occurrence, not the warmup', () => {
    const note = '+WARMUP\n-Bench Press\n45 10\n+LIFTING\n-Bench Press: 3x5\n135 5,5,5';
    const out = applyProgressionSuggestionToNoteText(note, workingSuggestion());
    expect(out.applied).toBe(true);
    expect(out.reason).toBe('appended');
    // Row is appended under the LIFTING block (after 135 5,5,5), never under
    // the +WARMUP occurrence (after 45 10).
    expect(out.text).toBe(`${note}\n140 5,5,5`);
    const reparsed = parseWorkoutNote(out.text);
    const warmup = reparsed.sections[0].exercises[0];
    const working = reparsed.sections[1].exercises[0];
    expect(warmup.session_entries.map((e) => e.raw)).toEqual(['45 10']);
    expect(working.session_entries[working.session_entries.length - 1].raw).toBe('140 5,5,5');
  });
});

describe('golden: skipped weeks (parse -> mutation -> parse round trip)', () => {
  const note = '-Bench Press: 3x5\n135 5,5,5\n-Squat: 3x5\n225 5,5,5';

  test('applyWeekSkipToText appends one skip marker per exercise with entries', () => {
    const sections = parseWorkoutNote(note).sections;
    const applied = applyWeekSkipToText(note, sections);
    expect(applied).toBe('-Bench Press: 3x5\n135 5,5,5\n-\n-Squat: 3x5\n225 5,5,5\n-');

    const reparsed = parseWorkoutNote(applied);
    for (const ex of reparsed.sections[0].exercises) {
      const last = ex.session_entries[ex.session_entries.length - 1];
      expect(last.skipped).toBe(true);
      expect(last.raw).toBe('-');
    }
  });

  test('removeWeekSkipFromText undoes exactly one apply, restoring the text', () => {
    const applied = applyWeekSkipToText(note, parseWorkoutNote(note).sections);
    const restored = removeWeekSkipFromText(applied, parseWorkoutNote(applied).sections);
    expect(restored).toBe(note);
  });

  test('week-skip mutations preserve notes with no session entries', () => {
    const empty = '-Bench Press: 3x5';
    const sections = parseWorkoutNote(empty).sections;
    expect(applyWeekSkipToText(empty, sections)).toBe(empty);
    expect(removeWeekSkipFromText(empty, sections)).toBe(empty);
  });
});

describe('golden: progression insertion formatting', () => {
  test('append into an existing working exercise formats "140 5,5,5"', () => {
    const note = '-Bench Press: 3x5\n135 5,5,5';
    const out = applyProgressionSuggestionToNoteText(note, workingSuggestion());
    expect(out).toEqual({ text: '-Bench Press: 3x5\n135 5,5,5\n140 5,5,5', applied: true, reason: 'appended' });

    // parse -> mutation -> parse: the appended row is now the last logged set.
    const reparsed = parseWorkoutNote(out.text);
    const ex = reparsed.sections[0].exercises[0];
    const last = ex.session_entries[ex.session_entries.length - 1];
    expect(last.raw).toBe('140 5,5,5');
    expect(last.sets).toHaveLength(3);
    for (const set of last.sets) {
      expect(set.weight_value).toBe(140);
      expect(set.rep_count).toBe(5);
      expect(set.weight_unit).toBe('lb');
    }
  });

  test('re-applying the same suggestion does not stack a duplicate row', () => {
    const note = '-Bench Press: 3x5\n135 5,5,5';
    const once = applyProgressionSuggestionToNoteText(note, workingSuggestion());
    const twice = applyProgressionSuggestionToNoteText(once.text, workingSuggestion());
    expect(twice).toEqual({ text: once.text, applied: false, reason: 'already-applied' });
  });

  test('a note with no matching exercise synthesizes a fresh block using the declared range', () => {
    const note = '-Squat: 3x5\n225 5,5,5';
    const out = applyProgressionSuggestionToNoteText(note, workingSuggestion());
    expect(out).toEqual({
      text: `${note}\n-Bench Press: 3x5-8\n140 5,5,5`,
      applied: true,
      reason: 'synthesized',
    });

    const reparsed = parseWorkoutNote(out.text);
    expect(reparsed.ok).toBe(true);
    const names = reparsed.sections.flatMap((s) => s.exercises.map((e) => e.name));
    expect(names).toEqual(['Squat', 'Bench Press']);
  });

  test('a non-applicable suggestion returns the input text unchanged', () => {
    const note = '-Bench Press: 3x5\n135 5,5,5';
    expect(applyProgressionSuggestionToNoteText(note, null)).toEqual({
      text: note,
      applied: false,
      reason: 'no-suggestion',
    });
    expect(applyProgressionSuggestionToNoteText(note, { name: 'Bench Press', suggested: false }))
      .toEqual({ text: note, applied: false, reason: 'not-applicable' });
  });
});

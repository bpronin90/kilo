import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseWorkoutNote } from '../lib/parser';
import {
  deriveProgressionSuggestion,
  deriveProgressionSuggestions,
  findDeclaredRepRange,
  inferIncrement,
  isExerciseUnderActiveRecovery,
  PROGRESSION_SUGGESTION_KINDS,
  PROGRESSION_SUGGESTION_REASONS,
} from '../lib/data/progressionSuggestions';
import {
  loadProgressionSuggestionsEnabled,
  saveProgressionSuggestionsEnabled,
} from '../storage/entries/settings';

// Fixtures are the ones approved on #580, in the grammar the real parser
// accepts: a header with NO space after the dash, and logged rows as
// `weight reps,reps,reps`.
function suggest(note, name, options) {
  const { sections } = parseWorkoutNote(note);
  return deriveProgressionSuggestion(sections, name, options);
}

describe('progression suggestions settings toggle (#958)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  test('defaults to false (off) when not set', async () => {
    expect(await loadProgressionSuggestionsEnabled()).toBe(false);
  });

  test('fails closed to false when the read throws', async () => {
    AsyncStorage.getItem.mockImplementationOnce(() =>
      Promise.reject(new Error('storage unavailable')),
    );
    expect(await loadProgressionSuggestionsEnabled()).toBe(false);
  });

  test('preserves an explicitly stored disabled state', async () => {
    await saveProgressionSuggestionsEnabled(false);
    expect(await loadProgressionSuggestionsEnabled()).toBe(false);
  });

  test('preserves an explicitly stored enabled state', async () => {
    await saveProgressionSuggestionsEnabled(true);
    expect(await loadProgressionSuggestionsEnabled()).toBe(true);
  });
});

describe('#580 fixture 1 — double progression, ready to jump', () => {
  const note = ['-Bench Press: 3x8-10', '135 10,10,10', '135 10,10,10'].join('\n');

  test('fires with the approved explanation', () => {
    const rec = suggest(note, 'Bench Press');
    expect(rec.kind).toBe(PROGRESSION_SUGGESTION_KINDS.DOUBLE_PROGRESSION);
    expect(rec.suggested).toBe(true);
    expect(rec.reason).toBe(PROGRESSION_SUGGESTION_REASONS.READY);
    expect(rec.explanation).toBe(
      'Your last 2 logged sessions both hit 3x10 at 135 lb — the top of your 8–10 rep target. Consider 140 lb for 3x8 next time.',
    );
  });

  test('separates observed evidence from the heuristic advice', () => {
    const rec = suggest(note, 'Bench Press');
    expect(rec.evidence).toMatchObject({
      classification: 'stalled',
      is_bodyweight: false,
      top_weight: 135,
      latest_reps: [10, 10, 10],
      prior_reps: [10, 10, 10],
      rep_range: { lo: 8, hi: 10, sets: 3 },
      skipped_sessions: 0,
      kg_entry: null,
    });
    expect(rec.heuristic).toEqual({
      action: 'increase_weight',
      suggested_weight: 140,
      suggested_reps: 8,
      suggested_sets: 3,
      increment: 5,
      unit: 'lb',
    });
  });

  test('is deterministic across repeated derivations', () => {
    expect(suggest(note, 'Bench Press')).toEqual(suggest(note, 'Bench Press'));
  });
});

describe('#580 fixture 2 — reps still climbing, not at ceiling', () => {
  const note = ['-Bench Press: 3x8-10', '135 8,8,8', '135 9,9,9'].join('\n');

  test('does not suggest, and says why', () => {
    const rec = suggest(note, 'Bench Press');
    expect(rec.suggested).toBe(false);
    expect(rec.kind).toBe(PROGRESSION_SUGGESTION_KINDS.NONE);
    expect(rec.reason).toBe(PROGRESSION_SUGGESTION_REASONS.BELOW_CEILING);
    expect(rec.evidence.classification).toBe('progressing');
    expect(rec.heuristic).toBeNull();
    expect(rec.explanation).toBe(
      'You added a rep since last time (24→27 reps @ 135 lb) but haven\'t hit the top of your 8–10 target yet — no change suggested.',
    );
  });
});

describe('#580 fixture 3 — missing history', () => {
  const note = ['-Overhead Press: 3x6-8', '95 6,6,6'].join('\n');

  test('does not suggest with a single logged session', () => {
    const rec = suggest(note, 'Overhead Press');
    expect(rec.suggested).toBe(false);
    expect(rec.reason).toBe(PROGRESSION_SUGGESTION_REASONS.INSUFFICIENT_HISTORY);
    expect(rec.evidence.sessions_compared).toBe(1);
    expect(rec.explanation).toBe(
      'Not enough logged history yet — need at least 2 non-skipped sessions to compare.',
    );
  });
});

describe('#580 fixture 4 — skipped week excluded from the streak', () => {
  const note = ['-Squat: 3x5-5', '225 5,5,5', '-', '225 5,5,5'].join('\n');

  test('fires on the two logged sessions and calls out the skip', () => {
    const rec = suggest(note, 'Squat');
    expect(rec.suggested).toBe(true);
    expect(rec.evidence.classification).toBe('stalled');
    expect(rec.evidence.skipped_sessions).toBe(1);
    expect(rec.heuristic.suggested_weight).toBe(230);
    expect(rec.explanation).toBe(
      "Skipped weeks aren't counted — comparing your last 2 logged sessions only. Your last 2 logged sessions both hit 3x5 at 225 lb — the top of your 5–5 rep target. Consider 230 lb for 3x5 next time.",
    );
  });
});

describe('#580 fixture 5 — bodyweight movement at ceiling', () => {
  const note = ['-Pull-ups: 3x8-12', '12,12,12', '12,12,12'].join('\n');

  test('suggests reps, never a load', () => {
    const rec = suggest(note, 'Pull-ups');
    expect(rec.kind).toBe(PROGRESSION_SUGGESTION_KINDS.BODYWEIGHT_CEILING);
    expect(rec.suggested).toBe(true);
    expect(rec.evidence.is_bodyweight).toBe(true);
    expect(rec.evidence.progression_status).toBe('held');
    expect(rec.evidence.latest_best_reps).toBe(12);
    expect(rec.heuristic.action).toBe('add_reps');
    expect(rec.heuristic.suggested_weight).toBeNull();
    expect(rec.explanation).toBe(
      "Your last 2 sessions both hit 3x12 — the top of your 8–12 rep target. Kilo won't suggest a weight for a bodyweight movement — consider more reps past 12, a slower tempo, or a harder variation.",
    );
  });
});

describe('#580 fixture 6 — kg-marked entry compared against a bare-lb entry', () => {
  const note = ['-Deadlift: 3x5-5', '100kg 5,5,5', '220 5,5,5'].join('\n');

  test('compares canonically in lb and annotates the kg provenance', () => {
    const rec = suggest(note, 'Deadlift');
    expect(rec.suggested).toBe(true);
    expect(rec.evidence.top_weight).toBe(220);
    expect(rec.evidence.kg_entry).toEqual({ side: 'prior', kg_value: 100 });
    expect(rec.explanation).toBe(
      'Your last 2 logged sessions both hit 3x5 at 220 lb (entered as 100kg last time) — the top of your 5–5 rep target. Consider 225 lb for 3x5 next time.',
    );
  });

  test('the kg marker never gates the comparison', () => {
    const bareNote = ['-Deadlift: 3x5-5', '220 5,5,5', '220 5,5,5'].join('\n');
    const marked = suggest(note, 'Deadlift');
    const bare = suggest(bareNote, 'Deadlift');
    expect(marked.suggested).toBe(bare.suggested);
    expect(marked.heuristic).toEqual(bare.heuristic);
  });
});

describe('#580 fixture 7 — post-deload re-entry session', () => {
  const note = ['-Bench Press: 3x8-10', '135 8,8,8'].join('\n');

  test('produces no double-progression suggestion', () => {
    const rec = suggest(note, 'Bench Press');
    expect(rec.suggested).toBe(false);
    expect(rec.reason).toBe(PROGRESSION_SUGGESTION_REASONS.INSUFFICIENT_HISTORY);
  });
});

describe('#580 fixture 8 — regressing lift is evidence, not a suggestion', () => {
  const note = ['-Squat: 3x5-5', '225 5,5,5', '215 5,5,5', '205 5,5,5'].join('\n');

  test('no progression suggestion while the lift is regressing', () => {
    const rec = suggest(note, 'Squat');
    expect(rec.suggested).toBe(false);
    expect(rec.evidence.classification).toBe('regressing');
    expect(rec.evidence.progression_status).toBe('regressed');
    expect(rec.heuristic).toBeNull();
  });
});

describe('no declared rep range', () => {
  test('never invents a range', () => {
    const note = ['-Bench Press', '135 10,10,10', '135 10,10,10'].join('\n');
    const rec = suggest(note, 'Bench Press');
    expect(rec.suggested).toBe(false);
    expect(rec.reason).toBe(PROGRESSION_SUGGESTION_REASONS.NO_REP_RANGE);
    expect(rec.explanation).toBe(
      'No rep-range target declared for this exercise (e.g. "3x8-10") — add one to get double-progression suggestions.',
    );
  });

  test('a hand-edited header is authoritative on the next derivation', () => {
    const note = ['-Bench Press: 3x8-10', '135 10,10,10', '135 10,10,10'].join('\n');
    const edited = note.replace('3x8-10', '3x10-12');
    expect(suggest(note, 'Bench Press').suggested).toBe(true);
    const rec = suggest(edited, 'Bench Press');
    expect(rec.suggested).toBe(false);
    expect(rec.evidence.rep_range).toEqual({ lo: 10, hi: 12, sets: 3 });
  });
});

describe('active Recovery suppression', () => {
  const note = ['-Bench Press: 3x8-10', '135 10,10,10', '135 10,10,10'].join('\n');
  const block = (completed_at = null) => ({
    id: 'block_1',
    completed_at,
    deleted_at: null,
    baseline: { version: 1, exercises: [{ key: 'bench press', name: 'Bench Press' }] },
  });

  test('an active block covering the exercise suppresses the suggestion', () => {
    const rec = suggest(note, 'Bench Press', { recoveryBlocks: [block()] });
    expect(rec.suggested).toBe(false);
    expect(rec.reason).toBe(PROGRESSION_SUGGESTION_REASONS.RECOVERY_ACTIVE);
    expect(rec.heuristic).toBeNull();
    expect(isExerciseUnderActiveRecovery('Bench Press', [block()])).toBe(true);
  });

  test('a completed block no longer suppresses', () => {
    const rec = suggest(note, 'Bench Press', {
      recoveryBlocks: [block('2026-01-01T00:00:00.000Z')],
    });
    expect(rec.suggested).toBe(true);
  });

  test('an active block that does not cover the exercise leaves it alone', () => {
    const other = block();
    other.baseline = { version: 1, exercises: [{ key: 'squat', name: 'Squat' }] };
    expect(suggest(note, 'Bench Press', { recoveryBlocks: [other] }).suggested).toBe(true);
  });
});

describe('purity and helpers', () => {
  test('the module never mutates the note text or the parsed sections', () => {
    const note = ['-Bench Press: 3x8-10', '135 10,10,10', '135 10,10,10'].join('\n');
    const parsed = parseWorkoutNote(note);
    const before = JSON.stringify(parsed.sections);
    const rec = deriveProgressionSuggestion(parsed.sections, 'Bench Press');
    expect(rec.suggested).toBe(true);
    expect(JSON.stringify(parsed.sections)).toBe(before);
    expect(parsed.raw_text ?? note).toBe(note);
    // No note-mutation surface is exported from this module.
    const api = require('../lib/data/progressionSuggestions');
    expect(Object.keys(api).some(k => /apply|write|save|mutate/i.test(k))).toBe(false);
  });

  test('inferIncrement mirrors the deload generator heuristic', () => {
    expect(inferIncrement([{ weight_value: 135 }])).toBe(5);
    expect(inferIncrement([{ weight_value: 135 }, { weight_value: 137.5 }])).toBe(2.5);
    expect(inferIncrement([])).toBe(5);
  });

  test('findDeclaredRepRange reads the user header only', () => {
    const { sections } = parseWorkoutNote('-Bench Press: 3x8-10\n135 10,10,10');
    expect(findDeclaredRepRange(sections, 'Bench Press')).toMatchObject({ sets: 3, repLo: 8, repHi: 10 });
    expect(findDeclaredRepRange(sections, 'Squat')).toBeNull();
  });

  test('deriveProgressionSuggestions derives one record per unique name', () => {
    const note = [
      '-Bench Press: 3x8-10',
      '135 10,10,10',
      '135 10,10,10',
      '-Squat: 3x5-5',
      '225 5,5,5',
    ].join('\n');
    const { sections } = parseWorkoutNote(note);
    const records = deriveProgressionSuggestions(sections, ['Bench Press', 'Squat', 'Bench Press']);
    expect(records.map(r => r.name)).toEqual(['Bench Press', 'Squat']);
    expect(records[0].suggested).toBe(true);
    expect(records[1].suggested).toBe(false);
  });

  test('no explanation makes a medical, injury, or readiness claim', () => {
    const notes = [
      ['-Bench Press: 3x8-10', '135 10,10,10', '135 10,10,10'],
      ['-Bench Press: 3x8-10', '135 8,8,8', '135 9,9,9'],
      ['-Pull-ups: 3x8-12', '12,12,12', '12,12,12'],
      ['-Overhead Press: 3x6-8', '95 6,6,6'],
    ].map(lines => lines.join('\n'));
    const banned = /injur|pain|safe|unsafe|ready to|recovered|you must|you should|diagnos/i;
    for (const note of notes) {
      const { sections } = parseWorkoutNote(note);
      for (const rec of deriveProgressionSuggestions(sections, ['Bench Press', 'Pull-ups', 'Overhead Press'])) {
        expect(rec.explanation).not.toMatch(banned);
      }
    }
  });
});

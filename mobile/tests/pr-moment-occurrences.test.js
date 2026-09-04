import { parseWorkoutNote } from '../lib/parser';
import { deriveTrackedPROccurrences } from '../lib/data/workoutAnalytics';
import { tagNoteSections } from '../screens/analytics/analyticsDerivations';

function tag(text, noteId = 'n1') {
  const { sections } = parseWorkoutNote(text);
  return sections.map((s, i) => ({ ...s, __noteId: noteId, __noteOrdinal: 0, __sectionOrdinal: i }));
}

describe('deriveTrackedPROccurrences (#577 Contract 3)', () => {
  test('returns per-set entries with note-aware coordinates', () => {
    const sections = tag('-Bench\n135 5,5,5', 'noteA');
    const entries = deriveTrackedPROccurrences(sections, ['Bench']);
    expect(entries.length).toBe(3);
    for (const e of entries) {
      expect(e.noteId).toBe('noteA');
      expect(e.exerciseKey).toBeTruthy();
      expect(e.epley).toBeCloseTo(135 * (1 + 5 / 30));
    }
    expect(entries.map((e) => e.setOrdinal)).toEqual([0, 1, 2]);
  });

  test('warmup-kind occurrences are excluded from the returned entries', () => {
    const sections = tag('Monday\n+Warmup\n-Bench\n95 8\n+Lifting\n-Bench\n135 5');
    const entries = deriveTrackedPROccurrences(sections, ['Bench']);
    // Only the non-warmup 135x5 set should survive.
    expect(entries.length).toBe(1);
    expect(entries[0].weight_value).toBe(135);
  });

  test('skipped sets never produce an entry', () => {
    const sections = tag('-Bench\n135 5,-');
    const entries = deriveTrackedPROccurrences(sections, ['Bench']);
    expect(entries.length).toBe(1);
    expect(entries[0].rep_count).toBe(5);
  });

  test('two notes tagged separately never collide on exerciseKey+noteId', () => {
    const sectionsA = tag('-Bench\n135 5', 'noteA');
    const sectionsB = tag('-Bench\n225 5', 'noteB');
    const entries = deriveTrackedPROccurrences([...sectionsA, ...sectionsB], ['Bench']);
    expect(entries.length).toBe(2);
    const byNote = Object.fromEntries(entries.map((e) => [e.noteId, e.weight_value]));
    expect(byNote.noteA).toBe(135);
    expect(byNote.noteB).toBe(225);
  });

  test('an untracked exercise name produces no entries', () => {
    const sections = tag('-Squat\n225 5');
    const entries = deriveTrackedPROccurrences(sections, ['Bench']);
    expect(entries).toEqual([]);
  });

  test('a non-strength (bodyweight/cardio) exercise name is excluded', () => {
    const sections = tag('-Bike\n5 min 9');
    const entries = deriveTrackedPROccurrences(sections, ['Bike']);
    expect(entries).toEqual([]);
  });

  test('occurrenceOrdinal is stable across multiple occurrences of the same exercise', () => {
    const sections = tag('Monday\n-Bench\n135 5\nWednesday\n-Bench\n145 5');
    const entries = deriveTrackedPROccurrences(sections, ['Bench']);
    expect(entries.length).toBe(2);
    expect(entries[0].occurrenceOrdinal).toBe(0);
    expect(entries[1].occurrenceOrdinal).toBe(1);
  });
});

describe('tagNoteSections', () => {
  test('tags each note\'s sections with its own noteId/noteOrdinal/sectionOrdinal', () => {
    const notes = [
      { id: 'n1', raw_text: '-Bench\n135 5' },
      { id: 'n2', raw_text: 'Monday\n-Squat\n225 5\nWednesday\n-Squat\n235 5' },
    ];
    const tagged = tagNoteSections(notes);
    expect(tagged.filter((s) => s.__noteId === 'n1').every((s) => s.__noteOrdinal === 0)).toBe(true);
    expect(tagged.filter((s) => s.__noteId === 'n2').every((s) => s.__noteOrdinal === 1)).toBe(true);
    const n2Ordinals = tagged.filter((s) => s.__noteId === 'n2').map((s) => s.__sectionOrdinal);
    expect(n2Ordinals).toEqual([...n2Ordinals].sort((a, b) => a - b));
  });

  test('a note with no id falls back to the "current:new" sentinel', () => {
    const tagged = tagNoteSections([{ raw_text: '-Bench\n135 5' }]);
    expect(tagged[0].__noteId).toBe('current:new');
  });

  test('does not mutate deriveParsedSections output shape (additive tags only)', () => {
    const notes = [{ id: 'n1', raw_text: '-Bench\n135 5' }];
    const tagged = tagNoteSections(notes);
    expect(tagged[0]).toHaveProperty('heading');
    expect(tagged[0]).toHaveProperty('exercises');
  });
});

// #577 gap fix: adversarial/stale activation fixtures, matching
// resolveTrackedLiftAnchors' own (unverified, clamp-only) read-side
// behavior exactly — deriveTrackedPROccurrences must never diverge from it.
describe('deriveTrackedPROccurrences — activation/watermark edge cases', () => {
  test('an anchor larger than the logged-session count clamps to that count rather than excluding everything', () => {
    const sections = tag('-Bench\n135 5\n145 5\n155 5'); // 3 logged sessions
    const activations = { bench: { anchor: 100, at: '2024-01-01T00:00:00.000Z' } };
    const clamped = deriveTrackedPROccurrences(sections, ['Bench'], activations);
    // Clamp to 3 means "drop the first 3" -> nothing left, not an error and
    // not "drop nothing" — matches resolveTrackedLiftAnchors' own
    // Math.min(raw, loggedSessionUnits(...).length) clamp.
    expect(clamped).toEqual([]);
  });

  test('a non-positive or non-integer anchor is treated as no watermark (full history)', () => {
    const sections = tag('-Bench\n135 5\n145 5');
    for (const anchor of [0, -5, 1.5, 'not-a-number', null]) {
      const activations = { bench: { anchor, at: '2024-01-01T00:00:00.000Z' } };
      const entries = deriveTrackedPROccurrences(sections, ['Bench'], activations);
      expect(entries.length).toBe(2);
    }
  });

  test('a malformed activations map (not an object, or a record missing required fields) never throws — treated as no watermark', () => {
    const sections = tag('-Bench\n135 5');
    expect(() => deriveTrackedPROccurrences(sections, ['Bench'], null)).not.toThrow();
    expect(() => deriveTrackedPROccurrences(sections, ['Bench'], undefined)).not.toThrow();
    expect(() => deriveTrackedPROccurrences(sections, ['Bench'], 'garbage')).not.toThrow();
    expect(() => deriveTrackedPROccurrences(sections, ['Bench'], { bench: 'garbage' })).not.toThrow();
    expect(deriveTrackedPROccurrences(sections, ['Bench'], { bench: 'garbage' }).length).toBe(1);
  });

  test('an activation record for an exercise absent from this population contributes no anchor and no error', () => {
    const sections = tag('-Bench\n135 5');
    const activations = { squat: { anchor: 5, at: '2024-01-01T00:00:00.000Z' } };
    const entries = deriveTrackedPROccurrences(sections, ['Bench'], activations);
    expect(entries.length).toBe(1);
  });

  test('an anchor of exactly the logged-session count excludes all prior history, matching the resolver boundary exactly', () => {
    const sections = tag('-Bench\n135 5\n145 5\n155 5'); // 3 sessions
    const activations = { bench: { anchor: 3, at: '2024-01-01T00:00:00.000Z' } };
    expect(deriveTrackedPROccurrences(sections, ['Bench'], activations)).toEqual([]);
  });

  test('an anchor of count-minus-one keeps exactly the most recent session', () => {
    const sections = tag('-Bench\n135 5\n145 5\n155 5');
    const activations = { bench: { anchor: 2, at: '2024-01-01T00:00:00.000Z' } };
    const entries = deriveTrackedPROccurrences(sections, ['Bench'], activations);
    expect(entries.length).toBe(1);
    expect(entries[0].weight_value).toBe(155);
  });

  test('a duplicate activation record for the same canonical key (case/whitespace variants) resolves via the newest `at`, matching _dedupeByCanonicalKey', () => {
    const sections = tag('-Bench\n135 5\n145 5\n155 5');
    const activations = {
      Bench: { anchor: 1, at: '2024-01-01T00:00:00.000Z' },
      bench: { anchor: 2, at: '2024-06-01T00:00:00.000Z' }, // newer — wins
    };
    const entries = deriveTrackedPROccurrences(sections, ['Bench'], activations);
    expect(entries.length).toBe(1);
    expect(entries[0].weight_value).toBe(155);
  });
});

// #577 gap fix: boundary-unready suppression at the caller level (the
// contract's "if the boundary is not ready at Done, suppress for that
// Done" requirement) is implemented as a blanket try/catch in
// useLogCurrentRoutineEditor.js's computePendingPRCandidate around the
// whole aggregate-build/detection pipeline — any failure there, including a
// recovery-boundary read failure, yields no candidate rather than a
// possibly-wrong one. That behavior is exercised at the hook level in
// pr-moment-editor.test.js; this file only covers the pure derivation
// layer, which has no "readiness" concept of its own (deriveParsedSections
// itself has none either — readiness is a hook-level/render concept).

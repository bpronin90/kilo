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

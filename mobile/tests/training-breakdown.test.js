import { parseWorkoutNote } from '../lib/parser';
import { deriveTrainingBreakdown } from '../lib/data/trainingBreakdown';
import { deriveParsedSections, deriveAnalytics } from '../screens/analytics/analyticsDerivations';

const note = (id, raw_text, extra = {}) => ({ id, title: id, raw_text, ...extra });
const breakdownOf = (notes, excluded = null) => deriveTrainingBreakdown(deriveParsedSections(notes, notes[0], excluded));
const sectionsOnly = (text) => deriveTrainingBreakdown({ allSections: parseWorkoutNote(text).sections });
const bucket = (list, id) => list.find((b) => b.id === id);

describe('deriveTrainingBreakdown counting (#1580)', () => {
  test('collapsed multi-set rows count each parsed set; multiple rows add up', () => {
    const b = sectionsOnly('Monday\n-Barbell Bench Press: 3x5\n135 5,5,5\n145 5');
    expect(b.totals.completedSets).toBe(4);
    expect(b.movement.groups[0].sets).toBe(4);
  });

  test('warm-ups, skipped entries, skipped sets, empty prescriptions and unparsed rows add nothing', () => {
    const b = sectionsOnly([
      'Monday', '-Barbell Bench Press: 3x5', '135 5,5,-', '-', 'not a set ???', '-Cable Row: 3x10',
      '+Warmup', '-Barbell Bench Press', '45 10,10',
    ].join('\n'));
    expect(b.totals.completedSets).toBe(2);
    expect(b.movement.groups.map((g) => g.exercises.map((e) => e.name))).toEqual([['Barbell Bench Press']]);
  });

  test('timed activity stays visible without becoming strength sets', () => {
    const b = sectionsOnly('Monday\n-Plank: 3x30s\n30\n30\n-Barbell Back Squat: 3x5\n185 5');
    expect(b.timed).toMatchObject({ sets: 2 });
    expect(b.totals).toMatchObject({ completedSets: 1, timedSets: 2 });
  });

  test('a note with only a timed hold is not empty', () => {
    const b = sectionsOnly('Monday\n-Plank: 3x30s\n30\n30\n30');
    expect(b.isEmpty).toBe(false);
    expect(b.totals).toMatchObject({ completedSets: 0, timedSets: 3 });
  });

  test('no notes and no sets are empty', () => {
    expect(deriveTrainingBreakdown(null).isEmpty).toBe(true);
    expect(breakdownOf([note('a', '')]).isEmpty).toBe(true);
    expect(sectionsOnly('Monday\n-Cable Row: 3x10').isEmpty).toBe(true);
  });

  test('a deload note counts like any ordinary note', () => {
    const b = breakdownOf([note('a', 'Monday\n-Barbell Bench Press: 3x5\n135 5,5,5', { title: 'DELOAD · week' })]);
    expect(b.totals.completedSets).toBe(3);
  });
});

describe('movement view', () => {
  const text = [
    'Monday', '-Barbell Bench Press: 3x5', '135 5,5,5', '-Barbell Back Squat: 3x5', '185 5,5',
    '-Mystery Machine Thing: 3x10', '50 10,10',
  ].join('\n');

  test('each set lands in exactly one group and groups plus unclassified reconcile to the total', () => {
    const b = sectionsOnly(text);
    const grouped = b.movement.groups.reduce((n, g) => n + g.sets, 0);
    expect(b.movement.unclassified).toMatchObject({ sets: 2, exercises: [{ name: 'Mystery Machine Thing', sets: 2 }] });
    expect(grouped + b.movement.unclassified.sets).toBe(b.totals.completedSets);
    expect(b.movement.coverage).toEqual({ knownSets: 5, totalSets: 7 });
  });

  test('original aliases are retained: RDL and Romanian Deadlift stay separate exercise names', () => {
    const b = sectionsOnly('Monday\n-RDL: 3x8\n135 8,8\n-Romanian Deadlift: 3x8\n135 8');
    const names = b.movement.groups.flatMap((g) => g.exercises.map((e) => e.name)).sort();
    expect(names).toEqual(['RDL', 'Romanian Deadlift']);
  });

  test('a note-scoped authored override wins and keeps its legacy label', () => {
    const notes = [
      note('a', 'Monday\n-Barbell Curl: 3x10\n25 10,10,10', { exercise_movement_groups: { version: 1, overrides: { 'barbell curl': 'pull' } } }),
      note('b', 'Monday\n-Barbell Curl: 3x10\n25 10'),
    ];
    const b = breakdownOf(notes);
    expect(bucket(b.movement.groups, 'legacy:pull')).toMatchObject({ label: 'Pull', sets: 3, source: 'override' });
    expect(b.movement.groups.find((g) => g.source === 'library').sets).toBe(1);
    expect(b.movement.overriddenSets).toBe(3);
  });

  test('an unreadable override map falls back to the library group and says so', () => {
    const b = breakdownOf([note('a', 'Monday\n-Barbell Curl: 3x10\n25 10', { exercise_movement_groups: { version: 9 } })]);
    expect(b.movement.groups.every((g) => g.source === 'library')).toBe(true);
    expect(b.movement.unreadableOverrideNotes).toBe(1);
  });
});

describe('muscle and equipment views', () => {
  test('primary and secondary muscle sets are separate and may overlap', () => {
    const b = sectionsOnly('Monday\n-Barbell Bench Press: 3x5\n135 5,5,5');
    expect(bucket(b.muscles.primary, 'pectoralis_major')).toMatchObject({ sets: 3 });
    expect(bucket(b.muscles.secondary, 'triceps_brachii')).toMatchObject({ sets: 3 });
    expect(bucket(b.muscles.secondary, 'anterior_deltoid')).toMatchObject({ sets: 3 });
    expect(b.muscles.primary.reduce((n, m) => n + m.sets, 0)).toBeGreaterThanOrEqual(b.totals.completedSets);
  });

  test('one set can involve several implements', () => {
    const b = sectionsOnly('Monday\n-Barbell Bench Press: 3x5\n135 5,5');
    expect(bucket(b.equipment.items, 'barbell').sets).toBe(2);
    expect(bucket(b.equipment.items, 'flat_bench').sets).toBe(2);
  });

  test('unknown equipment and muscles stay unknown without losing the movement group', () => {
    const b = sectionsOnly('Monday\n-Mystery Machine Thing: 3x10\n50 10');
    expect(b.equipment.unknown.sets).toBe(1);
    expect(b.muscles.unknown.sets).toBe(1);
    expect(b.equipment.coverage).toEqual({ knownSets: 0, totalSets: 1 });
  });

  test('a family-only name keeps its movement group while equipment stays unknown', () => {
    const b = sectionsOnly('Monday\n-Romanian Deadlift: 3x8\n135 8');
    expect(b.movement.groups.length).toBe(1);
    expect(b.equipment.unknown).not.toBeNull();
  });

  test('generic weighted exercises never imply a vest or belt', () => {
    const b = sectionsOnly('Monday\n-Weighted Pull-Up: 3x5\n25 5,5\n-Weighted Push-Up: 3x8\n25 8');
    const labels = b.equipment.items.map((i) => i.label.toLowerCase());
    expect(labels.some((l) => /vest|belt/.test(l))).toBe(false);
  });

  test('exercises with no equipment are labelled, not unknown', () => {
    const b = sectionsOnly('Monday\n-Push-Up: 3x10\n10,10');
    expect(bucket(b.equipment.items, 'no_equipment')).toMatchObject({ label: 'No equipment needed', sets: 2 });
    expect(b.equipment.coverage.knownSets).toBe(2);
  });
});

describe('population and additivity', () => {
  const notes = [
    note('keep', 'Monday\n-Barbell Bench Press: 3x5\n135 5,5,5'),
    note('drop', 'Monday\n-Barbell Back Squat: 3x5\n185 5,5,5'),
  ];

  test('Recovery-excluded notes are left out because the shared projection drops them', () => {
    const b = breakdownOf(notes, new Set(['drop']));
    expect(b.totals.completedSets).toBe(3);
    expect(b.movement.groups.flatMap((g) => g.exercises.map((e) => e.name))).toEqual(['Barbell Bench Press']);
  });

  test('deriveAnalytics adds trainingBreakdown without changing existing results', () => {
    const parsed = deriveParsedSections(notes, notes[0], null);
    const withNew = deriveAnalytics(parsed, {}, {}, 1);
    const { trainingBreakdown, ...rest } = withNew;
    expect(trainingBreakdown.totals.completedSets).toBe(6);
    expect(Object.keys(rest).sort()).toEqual(
      ['exerciseProgress', 'nameDisplayMap', 'nonWeightedMetrics', 'oneK', 'oneKSeries', 'perDaySignals', 'progressionSuggestions', 'reentry', 'signals'].sort()
    );
  });

  test('parsed sections and notes are not mutated', () => {
    const parsed = deriveParsedSections(notes, notes[0], null);
    const before = JSON.stringify(parsed.noteSectionsList) + JSON.stringify(notes);
    deriveTrainingBreakdown(parsed);
    expect(JSON.stringify(parsed.noteSectionsList) + JSON.stringify(notes)).toBe(before);
  });
});

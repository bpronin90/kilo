import { deriveTrainingBreakdownForRange } from '../lib/data/trainingBreakdown';
import { MOVEMENT_COMPARISONS, MUSCLE_REGIONS, MUSCLE_SHORT_NAMES, muscleShortName, regionForMuscle, validateRegionCoverage } from '../lib/data/trainingBreakdownMappings';
import { parseWorkoutNote } from '../lib/parser';
import { normalizeExerciseKey } from '../lib/parser/exerciseNames';

const LIBRARY = require('../lib/data/exerciseLibrary/v3.json');
const of = (text, extra = {}) => deriveTrainingBreakdownForRange(
  { normalNotes: [{ id: 'n', date: '2026-10-20', ...extra }], noteSectionsList: [parseWorkoutNote(text).sections] },
  'All',
);
const region = (b, id) => b.muscles.regions.find((r) => r.id === id);
const cmp = (b, id) => b.movement.comparisons.find((c) => c.id === id);

describe('region map (#1589)', () => {
  test('ordered regions with stable lowercase ids', () => {
    expect(MUSCLE_REGIONS.map((r) => [r.id, r.label])).toEqual([
      ['chest', 'Chest'], ['back', 'Back'], ['shoulders', 'Shoulders'], ['arms', 'Arms'], ['legs', 'Legs'], ['core', 'Core'],
    ]);
    expect(MUSCLE_REGIONS.flatMap((r) => r.muscles)).not.toContain('supraspinatus');
  });

  test('every bundled primary-muscle id maps to exactly one region', () => {
    const ids = LIBRARY.exercises.flatMap((e) => e.primary_muscles || []);
    expect(ids.length).toBeGreaterThan(0);
    expect(validateRegionCoverage(ids)).toEqual([]);
  });

  test('an unmapped id fails validation instead of being dropped', () => {
    expect(validateRegionCoverage(['pectoralis_major', 'made_up_muscle'])).toEqual(['made_up_muscle']);
    const dup = [...MUSCLE_REGIONS, { id: 'x', label: 'X', muscles: ['pectoralis_major'] }];
    expect(validateRegionCoverage(['pectoralis_major'], dup)).toEqual(['pectoralis_major']);
  });

  test('zero-set regions are included in order', () => {
    const b = of('Monday\n-Barbell Bench Press: 3x5\n135 5,5');
    expect(b.muscles.regions.map((r) => [r.id, r.sets])).toEqual([
      ['chest', 2], ['back', 0], ['shoulders', 0], ['arms', 0], ['legs', 0], ['core', 0],
    ]);
    // Secondary delts/triceps never increment a region.
    expect(b.muscles.secondary.length).toBeGreaterThan(0);
  });

  test('a set counts once within a region and once in each of several regions', () => {
    const b = of('Monday\n-Barbell Back Squat: 3x5\n185 5,5,5\n-Back Extension: 3x10\n10,10');
    // Squat: quadriceps + gluteus_maximus are both Legs -> 3, not 6.
    expect(region(b, 'legs').sets).toBe(5);
    expect(region(b, 'back').sets).toBe(2);
    expect(region(b, 'legs').exercises).toEqual([
      { key: 'barbell back squat', name: 'Barbell Back Squat', sets: 3 },
      { key: 'back extension', name: 'Back Extension', sets: 2 },
    ]);
    expect(region(b, 'back').exercises.map((e) => e.key)).toEqual(['back extension']);
    // Per-muscle totals overlap; the region total is not their sum.
    const legMuscles = b.muscles.primary.filter((m) => regionForMuscle(m.id) === 'legs').reduce((n, m) => n + m.sets, 0);
    expect(legMuscles).toBeGreaterThan(region(b, 'legs').sets);
  });
});

describe('movement comparisons (#1589)', () => {
  test('exact constants', () => {
    expect(MOVEMENT_COMPARISONS.map((c) => [c.id, c.sides.map((s) => [s.id, s.groups])])).toEqual([
      ['push_pull', [['push', ['horizontal_push', 'vertical_push']], ['pull', ['horizontal_pull', 'vertical_pull']]]],
      ['knee_hip', [['knee', ['squat', 'lunge_step', 'knee_extension']], ['hip', ['hip_hinge', 'hip_extension']]]],
    ]);
  });

  test('counts, shares and denominators use only the two sides', () => {
    const b = of([
      'Monday', '-Barbell Bench Press: 3x5', '135 5,5,5', '-Pull-Up: 3x8', '8', '-Barbell Biceps Curl: 3x10', '25 10,10',
      '-Mystery Movement: 3x5', '10 5,5',
    ].join('\n'));
    expect(cmp(b, 'push_pull')).toEqual({
      id: 'push_pull', label: 'Push vs pull', totalSets: 4,
      sides: [{ id: 'push', label: 'Push', sets: 3, share: 0.75 }, { id: 'pull', label: 'Pull', sets: 1, share: 0.25 }],
    });
    expect(b.totals.completedSets).toBe(8);
    expect(cmp(b, 'knee_hip')).toMatchObject({ totalSets: 0, sides: [{ sets: 0, share: 0 }, { sets: 0, share: 0 }] });
  });

  test('saved legacy override buckets and Unclassified are outside both sides', () => {
    const b = of('Monday\n-Barbell Bench Press: 3x5\n135 5,5\n-Pull-Up: 3x8\n8\n-Mystery Movement: 3x5\n10 5', {
      exercise_movement_groups: { version: 1, overrides: { [normalizeExerciseKey('Barbell Bench Press')]: 'push' } },
    });
    expect(b.movement.overriddenSets).toBe(2);
    expect(cmp(b, 'push_pull')).toMatchObject({ totalSets: 1, sides: [{ sets: 0, share: 0 }, { sets: 1, share: 1 }] });
  });

  test('knee and hip sides', () => {
    const b = of('Monday\n-Barbell Back Squat: 3x5\n185 5\n-Machine Leg Extension: 3x10\n50 10\n-Barbell Hip Thrust: 3x8\n135 8,8');
    expect(cmp(b, 'knee_hip').sides.map((s) => [s.id, s.sets, s.share])).toEqual([['knee', 2, 0.5], ['hip', 2, 0.5]]);
  });
});

describe('short names are display only (#1589)', () => {
  test('mapped labels and fallback', () => {
    expect(MUSCLE_SHORT_NAMES.gluteus_maximus).toBe('Glutes');
    expect(MUSCLE_SHORT_NAMES.lateral_deltoid).toBe('Side delts');
    expect(muscleShortName('unknown_id', 'Unknown id')).toBe('Unknown id');
  });

  test('no short name repeats its owning region label (#1593)', () => {
    expect(MUSCLE_SHORT_NAMES.pectoralis_major).toBe('Pecs');
    expect(muscleShortName('pectoralis_major', 'Pectoralis major')).toBe('Pecs');
    const collisions = MUSCLE_REGIONS.flatMap((r) => r.muscles
      .filter((id) => (MUSCLE_SHORT_NAMES[id] || '').toLowerCase() === r.label.toLowerCase())
      .map((id) => `${r.id}:${id}`));
    expect(collisions).toEqual([]);
    const b = of('Monday\n-Barbell Bench Press: 3x5\n135 5');
    const pecs = b.muscles.primary.find((m) => m.id === 'pectoralis_major');
    expect(pecs.label).not.toBe('Pecs');
    expect(pecs.exercises[0].key).toBe('barbell bench press');
  });

  test('breakdown ids and labels keep library identity', () => {
    const b = of('Monday\n-Barbell Back Squat: 3x5\n185 5');
    const glute = b.muscles.primary.find((m) => m.id === 'gluteus_maximus');
    expect(glute.label).toBe('Gluteus maximus');
    expect(glute.exercises[0].key).toBe('barbell back squat');
  });
});

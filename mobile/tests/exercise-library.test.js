import { spawnSync } from 'child_process';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import {
  EXERCISE_LIBRARY,
  SCHEMA_VERSION,
  DATASET_VERSION,
  SOURCE_PROVENANCE,
  normalizeExerciseName,
  resolveExerciseName,
  resolveExerciseId,
  getExercise,
  getFamily,
} from '../lib/data/exerciseLibrary';

const ROOT = path.join(__dirname, '..', '..');
const VALIDATOR = path.join(ROOT, 'scripts', 'validate-exercise-library.py');
const NEGATIVE = path.join(__dirname, 'fixtures', 'exercise-library-negative.json');
const ARTIFACT = path.join(__dirname, '..', 'lib', 'data', 'exerciseLibrary', 'v3.json');

function runValidator(args) {
  return spawnSync('python3', [VALIDATOR, ...args], { encoding: 'utf8' });
}

describe('exercise library artifact', () => {
  it('matches the recorded provenance hash and schema version', () => {
    const sha = crypto.createHash('sha256').update(fs.readFileSync(ARTIFACT)).digest('hex');
    expect(sha).toBe(SOURCE_PROVENANCE.sha256);
    expect(SCHEMA_VERSION).toBe(3);
    expect(DATASET_VERSION).not.toBe(String(SCHEMA_VERSION));
  });

  it('claimed summary values equal actual contents', () => {
    const s = EXERCISE_LIBRARY.validation_summary;
    const count = (list, f) => list.reduce((m, e) => ({ ...m, [e[f]]: (m[e[f]] || 0) + 1 }), {});
    expect(s.exercise_count).toBe(EXERCISE_LIBRARY.exercises.length);
    expect(s.family_count).toBe(EXERCISE_LIBRARY.families.length);
    expect(s.ambiguous_name_count).toBe(EXERCISE_LIBRARY.ambiguous_names.length);
    expect(s.matching_test_case_count).toBe(EXERCISE_LIBRARY.matching_test_cases.length);
    expect(s.activity_counts).toEqual(count(EXERCISE_LIBRARY.exercises, 'activity_type'));
    expect(s.loading_type_counts).toEqual(count(EXERCISE_LIBRARY.exercises, 'loading_type'));
    expect(s.logging_type_counts).toEqual(count(EXERCISE_LIBRARY.exercises, 'logging_type'));
  });

  it('passes the independent validator', () => {
    const r = runValidator([]);
    expect(r.stderr).toBe('');
    expect(r.stdout).toMatch(/^valid:/);
    expect(r.status).toBe(0);
  });

  it('rejects every reported mutation', () => {
    const spec = JSON.parse(fs.readFileSync(NEGATIVE, 'utf8'));
    expect(spec.mutations).toHaveLength(6);
    const r = runValidator(['--mutations', NEGATIVE]);
    expect(r.status).toBe(0);
    const rejected = r.stdout.split('\n').filter((l) => l.startsWith('rejected '));
    expect(rejected).toHaveLength(spec.mutations.length);
    expect(r.stdout).not.toMatch(/NOT REJECTED/);
  });
});

describe('resolveExerciseName against supplied fixtures', () => {
  const cases = EXERCISE_LIBRARY.matching_test_cases;

  it('has the full fixture set', () => {
    expect(cases.length).toBe(EXERCISE_LIBRARY.validation_summary.matching_test_case_count);
  });

  it.each(cases.map((c) => [c.input, c]))('%j', (_name, c) => {
    const r = resolveExerciseName(c.input);
    expect(r.input).toBe(c.input);
    expect(r.matchType).toBe(c.expected_match_type);
    expect(r.exerciseId).toBe(c.expected_exercise_id);
    expect(r.familyId).toBe(c.expected_family_id);
  });
});

describe('normalization', () => {
  it('folds case, punctuation, unicode and initialisms', () => {
    const rdl = normalizeExerciseName('rdl');
    for (const v of ['R.D.L.', 'R D L', 'r.d.l.', 'RDL', ' R.D.L ']) {
      expect(normalizeExerciseName(v)).toBe(rdl);
    }
    expect(normalizeExerciseName('Push-Up')).toBe(normalizeExerciseName('PUSH   UP'));
    expect(normalizeExerciseName('Farmer’s Walk')).toBe('farmers walk');
    expect(normalizeExerciseName('ＢＢ bench')).toBe('bb bench');
    expect(normalizeExerciseName(null)).toBe('');
  });

  it('never discards explicit qualifiers', () => {
    expect(resolveExerciseName('incline db row').matchType).toBe('ambiguous');
    expect(resolveExerciseName('barbell treadmill running').matchType).toBe('unknown');
    expect(resolveExerciseName('DB BB Bench Press').exerciseId).toBeNull();
  });
});

describe('contract', () => {
  it('returns unknown/ambiguous partials without arbitrary ids and does no fuzzy matching', () => {
    const unknown = resolveExerciseName('Zorblax Cable Pullover');
    expect(unknown).toMatchObject({ matchType: 'unknown', exerciseId: null, familyId: null });
    const amb = resolveExerciseName('chest press');
    expect(amb.exerciseId).toBeNull();
    expect(amb.candidates.length).toBeGreaterThan(1);
    expect(amb.missingDiscriminators.length).toBeGreaterThan(0);
    expect(resolveExerciseName('barbell bench pres').matchType).toBe('unknown');
    expect(resolveExerciseName(undefined).matchType).toBe('unknown');
  });

  it('keeps generic assisted pull-up ambiguous while the ID API redirects retired ids', () => {
    expect(resolveExerciseName('assisted pull-up').exerciseId).toBeNull();
    const r = resolveExerciseId('assisted_pull_up');
    expect(r).toMatchObject({ id: 'machine_assisted_pull_up', redirected: true });
    expect(resolveExerciseId('pull_up')).toMatchObject({ id: 'pull_up', redirected: false });
    expect(resolveExerciseId('nope')).toMatchObject({ id: null, exercise: null });
  });

  it('cannot mutate the shared catalog or caller input', () => {
    const input = 'bb bench press';
    const r = resolveExerciseName(input);
    expect(input).toBe('bb bench press');
    expect(() => {
      'use strict';
      r.exercise.name = 'hacked';
    }).toThrow();
    expect(() => {
      'use strict';
      r.candidates.push('x');
    }).toThrow();
    expect(() => {
      'use strict';
      getExercise('barbell_bench_press').aliases.push('x');
    }).toThrow();
    expect(getFamily('bench_press').name).toBe('Bench Press');
    expect(resolveExerciseName(input).exerciseId).toBe('barbell_bench_press');
  });
});

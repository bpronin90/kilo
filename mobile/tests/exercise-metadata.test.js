import {
  EXERCISE_LIBRARY,
  KILO_ALIAS_ENTRIES,
  ALIAS_VERSION,
  DATASET_VERSION,
  resolveExerciseName,
  getFamilyExercises,
  getExercise,
} from '../lib/data/exerciseLibrary';
import { getExerciseMetadata, enrichParsedExercises } from '../lib/data/exerciseMetadata';

const FIELD_KEYS = {
  activityType: 'activity_type',
  movementPatterns: 'movement_patterns',
  primaryMuscles: 'primary_muscles',
  secondaryMuscles: 'secondary_muscles',
  equipment: 'equipment',
  loadingType: 'loading_type',
  loggingType: 'logging_type',
  laterality: 'laterality',
  compoundStatus: 'compound_status',
};
const norm = (v) => JSON.stringify(Array.isArray(v) ? [...v].sort() : v);
const agreed = (members, key) => members.length > 0 && members.every((m) => norm(m[key]) === norm(members[0][key]));
const allNull = (obj) => Object.values(obj).every((v) => v === null);

describe('Kilo spelling aliases', () => {
  it('only add spellings the library cannot already resolve, to resolvable targets', () => {
    expect(KILO_ALIAS_ENTRIES.length).toBeGreaterThan(0);
    const seen = new Set();
    for (const { alias, target } of KILO_ALIAS_ENTRIES) {
      const m = getExerciseMetadata(alias);
      expect(m.source).toBe('kilo_alias');
      expect(m.aliasTarget).toBe(target);
      const t = resolveExerciseName(target);
      expect(t.source).toBe('library');
      expect(t.matchType).not.toBe('unknown');
      expect(m.matchType).toBe(t.matchType);
      expect(seen.has(alias.toLowerCase())).toBe(false);
      seen.add(alias.toLowerCase());
    }
    expect(ALIAS_VERSION).toBe(1);
  });

  it('never override a library answer', () => {
    expect(resolveExerciseName('lat pulldown')).toMatchObject({ matchType: 'alias', source: 'library', aliasTarget: null });
    expect(resolveExerciseName('Barbell Bench Press').source).toBe('library');
  });
});

describe('named Romanian deadlift spellings', () => {
  const NAMES = ['Romanian deadlift', 'Romanian deadlifts', 'RDL', 'R.D.L.', 'R D L'];

  it('resolve to hinge metadata, keep their own match type, and invent no equipment', () => {
    for (const input of NAMES) {
      const m = getExerciseMetadata(input);
      const raw = resolveExerciseName(input);
      expect(m.input).toBe(input);
      expect(m.matchType).toBe(raw.matchType);
      expect(['family_only', 'ambiguous']).toContain(m.matchType);
      expect(m.exerciseId).toBeNull();
      expect(m.familyId).toBe('romanian_deadlift');
      expect(m.primaryGroup).toMatchObject({ id: 'hip_hinge' });
      expect(m.fields.movementPatterns).toEqual(['hinge']);
      expect(m.fields.equipment).toBeNull();
      expect(m.fieldBasis.equipment).toBeNull();
      expect(m.fieldBasis.movementPatterns).toBe(m.matchType === 'ambiguous' ? 'candidates' : 'family');
    }
    expect(getExerciseMetadata('Romanian deadlifts').source).toBe('kilo_alias');
    expect(getExerciseMetadata('RDL').source).toBe('library');
  });
});

describe('field-specific partial matching', () => {
  const sets = [
    ...EXERCISE_LIBRARY.ambiguous_names.map((r) => ({ input: r.input, members: r.candidate_ids.map(getExercise), basis: 'candidates' })),
    ...EXERCISE_LIBRARY.families.map((f) => ({ input: f.name, members: getFamilyExercises(f.id), basis: 'family' })),
  ];

  it('supplies a field exactly when every member agrees, never a union', () => {
    for (const { input, members, basis } of sets) {
      const m = getExerciseMetadata(input);
      if (m.matchType === 'exact' || m.matchType === 'alias') continue;
      const expectedMembers = m.matchType === 'ambiguous'
        ? getExerciseMetadata(input).candidateIds.map(getExercise)
        : getFamilyExercises(m.familyId);
      for (const [out, key] of Object.entries(FIELD_KEYS)) {
        if (agreed(expectedMembers, key)) {
          expect(norm(m.fields[out])).toBe(norm(expectedMembers[0][key]));
          expect(m.fieldBasis[out]).toBe(m.matchType === 'ambiguous' ? 'candidates' : 'family');
        } else {
          expect(m.fields[out]).toBeNull();
          expect(m.fieldBasis[out]).toBeNull();
        }
      }
      expect(basis).toBeTruthy();
      expect(members.length).toBeGreaterThan(0);
    }
  });

  it('keeps agreed movement data when equipment disagrees', () => {
    const hit = sets.find((s) => {
      const m = getExerciseMetadata(s.input);
      return m.matchType !== 'unknown' && m.fields.equipment === null && m.fields.movementPatterns !== null;
    });
    expect(hit).toBeTruthy();
    const m = getExerciseMetadata(hit.input);
    expect(m.fields.movementPatterns.length).toBeGreaterThan(0);
  });

  it('takes every field from an exact match without inventing others', () => {
    const m = getExerciseMetadata('Barbell Bench Press');
    expect(m).toMatchObject({ matchType: 'exact', exerciseId: 'barbell_bench_press', source: 'library' });
    expect(m.fields.equipment).toEqual(['barbell', 'flat_bench']);
    expect(m.fields.primaryMuscles).toEqual(['pectoralis_major']);
    expect(m.fieldBasis.equipment).toBe('exercise');
    expect(m.primaryGroup).toMatchObject({ id: 'horizontal_push', basis: 'exercise' });
  });
});

describe('secondary patterns, ambiguity and unknown input', () => {
  it('derives secondary patterns from the curated group, not list order', () => {
    expect(getExerciseMetadata('Glute ham raise').secondaryMovementPatterns).toEqual(['hip_extension']);
    expect(getExerciseMetadata('Dumbbell Renegade Row').secondaryMovementPatterns).toEqual(['horizontal_pull']);
    expect(getExerciseMetadata('Barbell Bench Press').secondaryMovementPatterns).toEqual([]);
  });

  it('keeps assistance ambiguous with no equipment and high/low bar distinct', () => {
    const a = getExerciseMetadata('assisted pull-up');
    expect(a).toMatchObject({ matchType: 'ambiguous', exerciseId: null });
    expect(a.candidateIds.length).toBeGreaterThan(1);
    expect(a.fields.equipment).toBeNull();
    expect(a.primaryGroup.id).toBe('vertical_pull');
    const hi = getExerciseMetadata('high bar squat');
    const lo = getExerciseMetadata('low bar squat');
    expect(hi.exerciseId).not.toBe(lo.exerciseId);
    expect(hi.primaryGroup.id).toBe('squat');
    expect(lo.primaryGroup.id).toBe('squat');
  });

  it('returns empty metadata for unknown, contradictory or invalid input', () => {
    for (const input of ['qwerty zzz', '', null, undefined, 12, ['bench']]) {
      const m = getExerciseMetadata(input);
      expect(m.matchType).toBe('unknown');
      expect(allNull(m.fields)).toBe(true);
      expect(allNull(m.fieldBasis)).toBe(true);
      expect(m.primaryGroup).toMatchObject({ id: 'unclassified', basis: 'none' });
      expect(m.secondaryMovementPatterns).toBeNull();
      expect(m.candidateIds).toEqual([]);
    }
    const mixed = getExerciseMetadata('pulldown');
    expect(mixed.matchType).toBe('ambiguous');
    expect(mixed.fields.movementPatterns).toBeNull();
    expect(mixed.primaryGroup.id).toBe('unclassified');
  });

  it('carries dataset, taxonomy and alias versions', () => {
    expect(getExerciseMetadata('squat').versions).toEqual({ dataset: DATASET_VERSION, taxonomy: 1, aliases: 1 });
  });
});

describe('immutability and repeatability', () => {
  it('returns frozen records whose arrays are copies of the catalog', () => {
    const m = getExerciseMetadata('Barbell Bench Press');
    for (const part of [m, m.fields, m.fieldBasis, m.primaryGroup, m.versions, m.fields.equipment, m.candidateIds]) {
      expect(Object.isFrozen(part)).toBe(true);
    }
    expect(m.fields.equipment).not.toBe(getExercise('barbell_bench_press').equipment);
    expect(() => { 'use strict'; m.fields.equipment.push('x'); }).toThrow();
    expect(getExercise('barbell_bench_press').equipment).toEqual(['barbell', 'flat_bench']);
  });

  it('gives identical results on repeated lookups', () => {
    for (const input of ['RDL', 'Barbell Bench Press', 'unknown thing', 'Romanian deadlifts']) {
      expect(getExerciseMetadata(input)).toEqual(getExerciseMetadata(input));
    }
  });

  it('never mutates parsed exercises and ignores warm-up/working/cooldown context', () => {
    const parsed = [
      Object.freeze({ name: 'Leg curl', section: 'warm-up', sets: Object.freeze([Object.freeze({ reps: 12 })]) }),
      Object.freeze({ name: 'Leg curl', section: 'working', sets: Object.freeze([]) }),
      Object.freeze({ name: 'Zzz mystery', section: 'cooldown' }),
    ];
    const snapshot = JSON.stringify(parsed);
    const out = enrichParsedExercises(parsed);
    expect(JSON.stringify(parsed)).toBe(snapshot);
    expect(out).toHaveLength(3);
    out.forEach((entry, i) => expect(entry.exercise).toBe(parsed[i]));
    expect(out[0].metadata).toEqual(out[1].metadata);
    expect(out[0].metadata.input).toBe('Leg curl');
    expect(out[2].metadata.matchType).toBe('unknown');
    expect(enrichParsedExercises(null)).toEqual([]);
  });
});

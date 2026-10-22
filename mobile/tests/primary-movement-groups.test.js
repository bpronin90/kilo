import { EXERCISE_LIBRARY, getFamilyExercises } from '../lib/data/exerciseLibrary';
import {
  PRIMARY_MOVEMENT_GROUPS,
  PRIMARY_MOVEMENT_GROUP_IDS,
  PRIMARY_GROUP_BY_EXERCISE_ID,
  PRIMARY_GROUP_BY_FAMILY_ID,
  UNCLASSIFIED_GROUP_ID,
  TAXONOMY_VERSION,
  isPrimaryMovementGroupId,
  groupForExerciseId,
  groupForFamilyId,
  groupForResolution,
  legacyBroadGroupFor,
  resolvePrimaryMovementGroup,
} from '../lib/data/primaryMovementGroups';
import { MOVEMENT_GROUP_IDS } from '../lib/data/movementGroups';
import { normalizeExerciseKey } from '../lib/parser';

const EXPECTED_IDS = [
  'horizontal_push', 'vertical_push', 'horizontal_pull', 'vertical_pull', 'squat',
  'lunge_step', 'hip_hinge', 'hip_extension', 'knee_flexion', 'knee_extension',
  'calf_ankle', 'shoulder_isolation', 'elbow_flexion', 'elbow_extension',
  'hip_abduction_adduction', 'forearm_grip', 'trunk_movement', 'trunk_stability',
  'loaded_carry', 'olympic_lift', 'jump_throw', 'mixed_conditioning', 'cardio',
  'mobility', 'stretching', 'unclassified',
];
const PATTERNS = EXERCISE_LIBRARY.vocabulary.movement_patterns;

describe('primary movement taxonomy', () => {
  it('has the 26 stable group IDs, each with a label and valid references', () => {
    expect([...PRIMARY_MOVEMENT_GROUP_IDS]).toEqual(EXPECTED_IDS);
    expect(new Set(PRIMARY_MOVEMENT_GROUP_IDS).size).toBe(EXPECTED_IDS.length);
    expect(TAXONOMY_VERSION).toBe(1);
    for (const group of PRIMARY_MOVEMENT_GROUPS) {
      expect(group.label.length).toBeGreaterThan(0);
      expect(MOVEMENT_GROUP_IDS).toContain(group.legacy_broad_group);
      for (const pattern of group.movement_patterns) expect(PATTERNS).toContain(pattern);
    }
  });

  it('maps every catalog exercise explicitly to exactly one valid group', () => {
    const catalogIds = EXERCISE_LIBRARY.exercises.map((e) => e.id).sort();
    expect(Object.keys(PRIMARY_GROUP_BY_EXERCISE_ID).sort()).toEqual(catalogIds);
    for (const id of catalogIds) {
      const group = groupForExerciseId(id);
      expect(typeof group).toBe('string');
      expect(isPrimaryMovementGroupId(group)).toBe(true);
    }
  });

  it('keeps unclassified out of the curated catalog mapping', () => {
    expect(Object.values(PRIMARY_GROUP_BY_EXERCISE_ID)).not.toContain(UNCLASSIFIED_GROUP_ID);
    const used = new Set(Object.values(PRIMARY_GROUP_BY_EXERCISE_ID));
    for (const id of EXPECTED_IDS.filter((g) => g !== UNCLASSIFIED_GROUP_ID)) expect(used.has(id)).toBe(true);
  });

  it('lists a family group only when all its members agree', () => {
    expect(Object.keys(PRIMARY_GROUP_BY_FAMILY_ID).sort()).toEqual(EXERCISE_LIBRARY.families.map((f) => f.id).sort());
    for (const family of EXERCISE_LIBRARY.families) {
      const groups = new Set(getFamilyExercises(family.id).map((e) => groupForExerciseId(e.id)));
      expect(groupForFamilyId(family.id)).toBe(groups.size === 1 ? [...groups][0] : null);
    }
  });

  it('matches the named examples and keeps rows and pulldowns apart', () => {
    expect(groupForExerciseId('machine_lying_leg_curl')).toBe('knee_flexion');
    expect(groupForExerciseId('barbell_standing_overhead_press')).toBe('vertical_push');
    expect(groupForExerciseId('barbell_hip_thrust')).toBe('hip_extension');
    expect(groupForExerciseId('barbell_romanian_deadlift')).toBe('hip_hinge');
    expect(groupForExerciseId('barbell_bent_over_row')).toBe('horizontal_pull');
    expect(groupForExerciseId('cable_lat_pulldown')).toBe('vertical_pull');
    expect(groupForExerciseId('not_an_exercise')).toBeNull();
    expect(groupForExerciseId('__proto__')).toBeNull();
  });

  it('applies the documented tie rules to hybrids', () => {
    expect(groupForExerciseId('glute_ham_raise')).toBe('knee_flexion');
    expect(groupForExerciseId('dumbbell_renegade_row')).toBe('trunk_stability');
    expect(groupForExerciseId('copenhagen_plank')).toBe('hip_abduction_adduction');
    expect(groupForExerciseId('sled_push')).toBe('mixed_conditioning');
    expect(groupForFamilyId('thruster')).toBe('mixed_conditioning');
    expect(groupForFamilyId('jerk')).toBe('olympic_lift');
    expect(groupForFamilyId('push_press')).toBe('vertical_push');
    expect(groupForFamilyId('pullover')).toBe('vertical_pull');
    expect(groupForFamilyId('rear_delt_fly')).toBe('shoulder_isolation');
  });

  it('keeps activity types consistent with cardio, mobility and stretching groups', () => {
    for (const e of EXERCISE_LIBRARY.exercises) {
      const g = groupForExerciseId(e.id);
      expect(g === 'stretching').toBe(e.activity_type === 'stretching');
      expect(g === 'cardio').toBe(e.activity_type === 'cardio');
      if (e.activity_type === 'mobility') expect(g).toBe('mobility');
    }
  });
});

describe('resolvePrimaryMovementGroup', () => {
  it('uses the exercise entry for exact and alias matches', () => {
    const exact = resolvePrimaryMovementGroup('Barbell Hip Thrust');
    expect(exact).toMatchObject({ matchType: 'exact', groupId: 'hip_extension', basis: 'exercise' });
    expect(resolvePrimaryMovementGroup('high bar squat')).toMatchObject({ matchType: 'alias', groupId: 'squat' });
  });

  it('gives the named RDL spellings hinge via family or candidate agreement', () => {
    const cases = {
      'Romanian deadlift': ['family_only', 'family'],
      'Romanian deadlifts': ['family_only', 'family'],
      RDL: ['ambiguous', 'candidates'],
      'R.D.L.': ['ambiguous', 'candidates'],
      'R D L': ['ambiguous', 'candidates'],
    };
    for (const [input, [matchType, basis]] of Object.entries(cases)) {
      const r = resolvePrimaryMovementGroup(input);
      expect(r).toMatchObject({ input, matchType, basis, groupId: 'hip_hinge' });
    }
  });

  it('keeps ambiguous assistance in one group and high/low bar in squat', () => {
    expect(resolvePrimaryMovementGroup('assisted pull-up')).toMatchObject({ matchType: 'ambiguous', groupId: 'vertical_pull' });
    expect(resolvePrimaryMovementGroup('low bar squat').groupId).toBe('squat');
    expect(resolvePrimaryMovementGroup('high bar squat').groupId).toBe('squat');
  });

  it('is unclassified for unknown, contradictory or non-string input', () => {
    // "pulldown" spans lat pulldown, triceps pushdown and straight-arm candidates.
    expect(resolvePrimaryMovementGroup('pulldown')).toMatchObject({ matchType: 'ambiguous', groupId: UNCLASSIFIED_GROUP_ID, basis: 'none' });
    for (const input of ['qwerty zzz', '', null, undefined, 42, {}, { name: 7 }]) {
      expect(resolvePrimaryMovementGroup(input)).toMatchObject({ groupId: UNCLASSIFIED_GROUP_ID, basis: 'none' });
    }
    expect(groupForResolution(null).groupId).toBe(UNCLASSIFIED_GROUP_ID);
    expect(groupForResolution({ matchType: 'ambiguous', candidates: [] }).basis).toBe('none');
  });

  it('keeps the user override authoritative and never narrows the legacy group', () => {
    const key = normalizeExerciseKey('Romanian deadlift');
    const r = resolvePrimaryMovementGroup('Romanian deadlift', { overrides: { [key]: 'core' } });
    expect(r.legacy).toEqual({ group: 'core', source: 'override' });
    expect(r.groupId).toBe('hip_hinge');
    expect(resolvePrimaryMovementGroup('Romanian deadlift').legacy.source).toBe('rules');
    for (const id of PRIMARY_MOVEMENT_GROUP_IDS) expect(MOVEMENT_GROUP_IDS).toContain(legacyBroadGroupFor(id));
    expect(legacyBroadGroupFor('nope')).toBe('other');
  });

  it('ignores warm-up/working/cooldown occurrence context', () => {
    const base = resolvePrimaryMovementGroup({ name: 'Barbell Back Squat', section: 'working' });
    for (const section of ['warm-up', 'cooldown']) {
      expect(resolvePrimaryMovementGroup({ name: 'Barbell Back Squat', section })).toEqual(base);
    }
  });

  it('is deterministic, frozen, and leaves the parsed exercise untouched', () => {
    const parsed = Object.freeze({ name: 'Leg curl', sets: Object.freeze([Object.freeze({ reps: 10 })]) });
    const snapshot = JSON.stringify(parsed);
    const first = resolvePrimaryMovementGroup(parsed);
    expect(resolvePrimaryMovementGroup(parsed)).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.legacy)).toBe(true);
    expect(JSON.stringify(parsed)).toBe(snapshot);
    expect(first.input).toBe('Leg curl');
  });
});

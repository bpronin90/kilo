// Training breakdown display mappings (#1589). Pure constants consumed by the
// derivation and by the #1588 dashboard; the UI needs no second map.
//
// - MUSCLE_REGIONS: ordered [{ id, label, muscles: [libraryMuscleId] }]. Every
//   bundled-library primary-muscle ID belongs to exactly one region.
// - MOVEMENT_COMPARISONS: ordered [{ id, label, sides: [{ id, label, groups }] }],
//   `groups` being library primary movement group IDs. Saved legacy override
//   buckets and Unclassified are outside every side.
// - MUSCLE_SHORT_NAMES: libraryMuscleId -> short display label. Display only:
//   library IDs and original exercise-name keys remain identity.

const freezeDeep = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
};

export const MUSCLE_REGIONS = freezeDeep([
  { id: 'chest', label: 'Chest', muscles: ['pectoralis_major'] },
  { id: 'back', label: 'Back', muscles: ['latissimus_dorsi', 'rhomboids', 'erector_spinae', 'upper_trapezius', 'lower_trapezius'] },
  { id: 'shoulders', label: 'Shoulders', muscles: ['anterior_deltoid', 'lateral_deltoid', 'posterior_deltoid', 'rotator_cuff', 'infraspinatus', 'teres_minor', 'subscapularis'] },
  { id: 'arms', label: 'Arms', muscles: ['biceps_brachii', 'triceps_brachii', 'brachialis', 'brachioradialis', 'forearm_flexors', 'forearm_extensors'] },
  { id: 'legs', label: 'Legs', muscles: ['quadriceps', 'gluteus_maximus', 'gluteus_medius', 'hamstrings', 'hip_adductors', 'gastrocnemius', 'soleus', 'tibialis_anterior'] },
  { id: 'core', label: 'Core', muscles: ['rectus_abdominis', 'obliques', 'transversus_abdominis', 'hip_flexors', 'serratus_anterior'] },
]);

export const MOVEMENT_COMPARISONS = freezeDeep([
  {
    id: 'push_pull',
    label: 'Push vs pull',
    sides: [
      { id: 'push', label: 'Push', groups: ['horizontal_push', 'vertical_push'] },
      { id: 'pull', label: 'Pull', groups: ['horizontal_pull', 'vertical_pull'] },
    ],
  },
  {
    id: 'knee_hip',
    label: 'Knee vs hip dominant',
    sides: [
      { id: 'knee', label: 'Knee-dominant', groups: ['squat', 'lunge_step', 'knee_extension'] },
      { id: 'hip', label: 'Hip-dominant', groups: ['hip_hinge', 'hip_extension'] },
    ],
  },
]);

export const MUSCLE_SHORT_NAMES = freezeDeep({
  pectoralis_major: 'Chest',
  latissimus_dorsi: 'Lats',
  rhomboids: 'Rhomboids',
  erector_spinae: 'Lower back',
  upper_trapezius: 'Upper traps',
  lower_trapezius: 'Lower traps',
  anterior_deltoid: 'Front delts',
  lateral_deltoid: 'Side delts',
  posterior_deltoid: 'Rear delts',
  rotator_cuff: 'Rotator cuff',
  infraspinatus: 'Infraspinatus',
  teres_minor: 'Teres minor',
  subscapularis: 'Subscapularis',
  biceps_brachii: 'Biceps',
  triceps_brachii: 'Triceps',
  brachialis: 'Brachialis',
  brachioradialis: 'Brachioradialis',
  forearm_flexors: 'Forearm flexors',
  forearm_extensors: 'Forearm extensors',
  quadriceps: 'Quads',
  gluteus_maximus: 'Glutes',
  gluteus_medius: 'Glute med',
  hamstrings: 'Hamstrings',
  hip_adductors: 'Adductors',
  gastrocnemius: 'Calves',
  soleus: 'Soleus',
  tibialis_anterior: 'Tibialis',
  rectus_abdominis: 'Abs',
  obliques: 'Obliques',
  transversus_abdominis: 'Deep core',
  hip_flexors: 'Hip flexors',
  serratus_anterior: 'Serratus',
  middle_trapezius: 'Mid traps',
});

const REGION_BY_MUSCLE = new Map();
for (const region of MUSCLE_REGIONS) for (const m of region.muscles) REGION_BY_MUSCLE.set(m, region.id);

export const regionForMuscle = (muscleId) => REGION_BY_MUSCLE.get(muscleId) || null;

// Display label for a muscle ID; falls back to `fallback` (or the ID) when unmapped.
export const muscleShortName = (muscleId, fallback) => MUSCLE_SHORT_NAMES[muscleId] || fallback || String(muscleId || '');

// Returns the IDs that map to zero or to more than one region. An empty array
// means every ID maps to exactly one region; callers must treat any entry as a
// validation failure rather than dropping it.
export function validateRegionCoverage(muscleIds, regions = MUSCLE_REGIONS) {
  const counts = new Map();
  for (const region of regions) for (const m of region.muscles) counts.set(m, (counts.get(m) || 0) + 1);
  return [...new Set(muscleIds)].filter((id) => counts.get(id) !== 1);
}

// Read-only exercise enrichment (#1579) from the offline library. Accepts the
// original parsed name (string or { name }), keeps it as `input`, and returns a
// fresh frozen record; the caller's exercise object is never written to. Library
// IDs describe metadata only. They do not replace normalizeExerciseKey() history
// keys, rename exercises, or merge history. Nothing here is persisted or cached.
//
// Field-specific partial matching: an exact or alias match supplies every field
// from that exercise; a family or ambiguous candidate set supplies a field only
// when all its members agree on it. Unknown equipment therefore never suppresses
// agreed movement data, and shared muscles are never fabricated by unioning.
//
// Warm-up/working/cooldown is occurrence context. It is not read here, so it can
// never change a result, and no field implies equivalent fatigue or eligibility.

import {
  resolveExerciseName,
  getExercise,
  getFamilyExercises,
  DATASET_VERSION,
  ALIAS_VERSION,
} from './exerciseLibrary';
import {
  groupForResolution,
  getPrimaryMovementGroup,
  legacyBroadGroupFor,
  primaryPatternsFor,
  TAXONOMY_VERSION,
} from './primaryMovementGroups.js';

const FIELDS = Object.freeze([
  ['activityType', 'activity_type'],
  ['movementPatterns', 'movement_patterns'],
  ['primaryMuscles', 'primary_muscles'],
  ['secondaryMuscles', 'secondary_muscles'],
  ['equipment', 'equipment'],
  ['loadingType', 'loading_type'],
  ['loggingType', 'logging_type'],
  ['laterality', 'laterality'],
  ['compoundStatus', 'compound_status'],
]);

const nameOf = (input) => (typeof input === 'string' ? input : input && typeof input.name === 'string' ? input.name : '');
const sameValue = (a, b) => JSON.stringify(Array.isArray(a) ? [...a].sort() : a) === JSON.stringify(Array.isArray(b) ? [...b].sort() : b);
const copy = (value) => (Array.isArray(value) ? Object.freeze([...value]) : value);

// The exercises whose agreement can back a field, with the basis label.
function memberSet(resolution) {
  if (resolution.exercise) return { members: [resolution.exercise], basis: 'exercise' };
  if (resolution.matchType === 'ambiguous') {
    return { members: resolution.candidates.map(getExercise).filter(Boolean), basis: 'candidates' };
  }
  if (resolution.matchType === 'family_only') return { members: getFamilyExercises(resolution.familyId), basis: 'family' };
  return { members: [], basis: null };
}

export function getExerciseMetadata(input) {
  const name = nameOf(input);
  const resolution = resolveExerciseName(name);
  const { members, basis } = memberSet(resolution);
  const fields = {};
  const fieldBasis = {};
  for (const [out, key] of FIELDS) {
    const first = members[0];
    const agrees = first && members.every((member) => sameValue(member[key], first[key]));
    fields[out] = agrees ? copy(first[key]) : null;
    fieldBasis[out] = agrees ? basis : null;
  }
  const { groupId, basis: groupBasis } = groupForResolution(resolution);
  const group = getPrimaryMovementGroup(groupId);
  // Patterns outside the curated group's primary motion (its own patterns plus the
  // family's documented tie-rule exceptions); never "the rest after the first".
  const primaryPatterns = primaryPatternsFor(groupId, resolution.familyId);
  const secondary = fields.movementPatterns && groupBasis !== 'none'
    ? Object.freeze(fields.movementPatterns.filter((p) => !primaryPatterns.includes(p)))
    : null;
  return Object.freeze({
    input: name,
    matchType: resolution.matchType,
    source: resolution.source,
    aliasTarget: resolution.aliasTarget,
    exerciseId: resolution.exerciseId,
    familyId: resolution.familyId,
    candidateIds: Object.freeze([...resolution.candidates]),
    primaryGroup: Object.freeze({
      id: groupId,
      label: group.label,
      basis: groupBasis,
      libraryLegacyBroadGroup: legacyBroadGroupFor(groupId),
    }),
    secondaryMovementPatterns: secondary,
    fields: Object.freeze(fields),
    fieldBasis: Object.freeze(fieldBasis),
    versions: Object.freeze({ dataset: DATASET_VERSION, taxonomy: TAXONOMY_VERSION, aliases: ALIAS_VERSION }),
  });
}

// Pair each original parsed exercise with its metadata; the originals are returned
// by reference, untouched.
export function enrichParsedExercises(exercises) {
  if (!Array.isArray(exercises)) return Object.freeze([]);
  return Object.freeze(exercises.map((exercise) => Object.freeze({ exercise, metadata: getExerciseMetadata(exercise) })));
}

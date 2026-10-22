// Primary movement taxonomy (#1579): exactly one curated group per catalog
// exercise, read-only and offline. Groups are the explicit mapping in
// exerciseLibrary/primaryGroups.json; nothing is derived from the first listed
// movement pattern or muscle. This is library metadata only: it never replaces
// normalizeExerciseKey() history keys, the legacy broad groups in
// movementGroups.js, or a user's saved group choice.
//
// Tie rules for hybrid movements (the curated mapping follows these):
//  1. Group by the movement the exercise exists to load; the limiting stabilizer
//     decides only when no external-load pattern leads (renegade row and
//     Copenhagen plank follow their stabilizer, not their row or lift).
//  2. Single-joint deltoid and scapular work is shoulder isolation; chest fly keeps
//     horizontal push because there is no chest-isolation group.
//  3. Lat-dominant shoulder extension (pullover, straight-arm pulldown) is vertical pull.
//  4. A squat-to-press complex (thruster) is mixed conditioning; the jerk is an
//     Olympic lift while the push press stays vertical push.
//  5. Hamstring work that also extends the hip (glute-ham raise) is knee flexion;
//     the hip pattern stays a secondary pattern.
//  6. Loaded locomotion without a carried implement (sled) is mixed conditioning.
//
// Warm-up/working/cooldown is occurrence context and never affects the group.
// A group implies no equivalent fatigue and no prescription eligibility.

import PRIMARY_GROUPS from './exerciseLibrary/primaryGroups.json';
import { resolveExerciseName } from './exerciseLibrary';
import { resolveMovementGroup } from './movementGroups.js';

export const TAXONOMY_VERSION = PRIMARY_GROUPS.taxonomy_version;
export const UNCLASSIFIED_GROUP_ID = 'unclassified';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}
deepFreeze(PRIMARY_GROUPS);

export const PRIMARY_MOVEMENT_GROUPS = PRIMARY_GROUPS.groups;
export const PRIMARY_MOVEMENT_GROUP_IDS = Object.freeze(PRIMARY_GROUPS.groups.map((g) => g.id));
export const PRIMARY_GROUP_BY_EXERCISE_ID = PRIMARY_GROUPS.exercises;
export const PRIMARY_GROUP_BY_FAMILY_ID = PRIMARY_GROUPS.families;

const groupsById = new Map(PRIMARY_GROUPS.groups.map((g) => [g.id, g]));
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

export const isPrimaryMovementGroupId = (id) => typeof id === 'string' && groupsById.has(id);
export const getPrimaryMovementGroup = (id) => (isPrimaryMovementGroupId(id) ? groupsById.get(id) : null);

// Legacy broad group (movementGroups.js id) the library group sits inside; a
// coarse hint only, never a replacement for a user's saved choice.
export const legacyBroadGroupFor = (id) => groupsById.get(id)?.legacy_broad_group || 'other';

export function groupForExerciseId(id) {
  return typeof id === 'string' && has(PRIMARY_GROUPS.exercises, id) ? PRIMARY_GROUPS.exercises[id] : null;
}

// Members must agree; one dissenting member leaves the answer unknown.
function agreedGroup(exerciseIds) {
  const groups = new Set(exerciseIds.map(groupForExerciseId));
  if (groups.size !== 1) return null;
  const [only] = groups;
  return only || null;
}

// Movement patterns the curated group treats as primary motion for a family:
// the group's own patterns plus the family's documented tie-rule exceptions (for
// example pullover is vertical pull although its sole pattern is shoulder
// extension). Anything else an exercise lists is a secondary pattern.
export function primaryPatternsFor(groupId, familyId) {
  const own = groupsById.get(groupId)?.movement_patterns || [];
  const extra = typeof familyId === 'string' && has(PRIMARY_GROUPS.primary_pattern_exceptions, familyId)
    ? PRIMARY_GROUPS.primary_pattern_exceptions[familyId]
    : [];
  return Object.freeze([...own, ...extra]);
}

export function groupForFamilyId(familyId) {
  if (typeof familyId !== 'string' || !has(PRIMARY_GROUPS.families, familyId)) return null;
  return PRIMARY_GROUPS.families[familyId] || null;
}

// { groupId, basis } for a resolveExerciseName() result. Exact/alias use the
// exercise's own entry; a family or candidate set supplies a group only when its
// members agree. Unknown or disagreeing input is 'unclassified' with basis 'none'.
export function groupForResolution(resolution) {
  const none = { groupId: UNCLASSIFIED_GROUP_ID, basis: 'none' };
  if (!resolution) return none;
  if (resolution.exerciseId) {
    const groupId = groupForExerciseId(resolution.exerciseId);
    return groupId ? { groupId, basis: 'exercise' } : none;
  }
  if (resolution.matchType === 'ambiguous') {
    const groupId = resolution.candidates.length ? agreedGroup(resolution.candidates) : null;
    return groupId ? { groupId, basis: 'candidates' } : none;
  }
  if (resolution.matchType === 'family_only') {
    const groupId = groupForFamilyId(resolution.familyId);
    return groupId ? { groupId, basis: 'family' } : none;
  }
  return none;
}

function nameOf(input) {
  if (typeof input === 'string') return input;
  return input && typeof input.name === 'string' ? input.name : '';
}

// Primary group for an original parsed name (string or { name }). The caller's
// object is only read. `overrides` is the user's saved legacy group map: it is
// reported unchanged under `legacy` (override wins there, as before) and is never
// narrowed or replaced by the library group.
export function resolvePrimaryMovementGroup(input, { overrides = {} } = {}) {
  const name = nameOf(input);
  const resolution = resolveExerciseName(name);
  const { groupId, basis } = groupForResolution(resolution);
  const legacy = resolveMovementGroup(name, overrides);
  return Object.freeze({
    input: name,
    matchType: resolution.matchType,
    groupId,
    label: groupsById.get(groupId).label,
    basis,
    libraryLegacyBroadGroup: legacyBroadGroupFor(groupId),
    legacy: Object.freeze({ group: legacy.group, source: legacy.source }),
    taxonomyVersion: TAXONOMY_VERSION,
  });
}

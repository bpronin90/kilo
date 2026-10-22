// Movement groups (#1306): a fixed, deterministic taxonomy that puts every
// exercise in EXACTLY ONE group (owner decision: never multi-group, compound
// lifts included), plus the per-exercise user override map.
//
// Identity is the existing exercise-name identity function
// (`normalizeExerciseKey`), so an override and a baseline key line up exactly;
// there is no fuzzy or substitute matching.
//
// Keyword rules. A name is lower-cased, every non-alphanumeric run becomes a
// space, and each word is singularized the same way as the rule phrases (a
// trailing "s"/"es" is dropped), so "Pull-Ups", "pull ups" and "pullup" differ
// only by the phrases listed. A phrase matches only on whole-word boundaries
// ("row" does not match "rowing"). RULES are evaluated in the order written and
// the FIRST rule with a matching phrase decides the group. That order is the
// documented tie precedence: specific phrases precede broad ones ("leg curl"
// precedes "curl"; "tricep" precedes "leg extension"; "deadlift" precedes
// "leg"/"squat"). A name with no matching phrase is "other". Nothing infers
// anatomy from an unlisted name. A user override always wins over the rules.

//
// Detailed choices (#1581). Version 2 maps may also hold a primary library group
// id (exerciseLibrary/primaryGroups.json, excluding 'unclassified'). The two id
// sets are disjoint, so one value names exactly one bucket. Version 1 stays
// readable and writable unchanged; a map becomes version 2 only when an explicit
// edit stores a detailed id, and is never rewritten back to version 1. An older
// client reads a version 2 map as INVALID (rules only, editing unavailable), so it
// can neither discard nor downgrade the authored values.

import { normalizeExerciseKey } from '../parser.js';
import PRIMARY_GROUPS from './exerciseLibrary/primaryGroups.json';

export const MOVEMENT_GROUPS = Object.freeze([
  Object.freeze({ id: 'push', label: 'Push' }),
  Object.freeze({ id: 'pull', label: 'Pull' }),
  Object.freeze({ id: 'shoulders', label: 'Shoulders' }),
  Object.freeze({ id: 'arms', label: 'Arms' }),
  Object.freeze({ id: 'legs', label: 'Legs (quad-dominant)' }),
  Object.freeze({ id: 'hinge', label: 'Hinge / posterior chain' }),
  Object.freeze({ id: 'core', label: 'Core' }),
  Object.freeze({ id: 'other', label: 'Other' }),
]);

export const MOVEMENT_GROUP_IDS = Object.freeze(MOVEMENT_GROUPS.map(g => g.id));
export const OTHER_GROUP_ID = 'other';

// Primary (detailed) ids a version 2 map may store.
export const DETAILED_MOVEMENT_GROUPS = Object.freeze(PRIMARY_GROUPS.groups
  .filter(g => g.id !== 'unclassified')
  .map(g => Object.freeze({ id: g.id, label: g.label, legacy: g.legacy_broad_group })));
export const DETAILED_MOVEMENT_GROUP_IDS = Object.freeze(DETAILED_MOVEMENT_GROUPS.map(g => g.id));

const _labels = new Map([...MOVEMENT_GROUPS, ...DETAILED_MOVEMENT_GROUPS].map(g => [g.id, g.label]));
export const movementGroupLabel = (id) => _labels.get(id) || _labels.get(OTHER_GROUP_ID);
export const isMovementGroupId = (id) => typeof id === 'string' && MOVEMENT_GROUP_IDS.includes(id);
export const isDetailedMovementGroupId = (id) => typeof id === 'string' && DETAILED_MOVEMENT_GROUP_IDS.includes(id);

export const MOVEMENT_GROUPS_VERSION = 1;
export const DETAILED_MOVEMENT_GROUPS_VERSION = 2;
const _allowed = (version) => (version === DETAILED_MOVEMENT_GROUPS_VERSION
  ? (id) => isMovementGroupId(id) || isDetailedMovementGroupId(id)
  : isMovementGroupId);
export const MAX_MOVEMENT_OVERRIDES = 1000;
export const MAX_MOVEMENT_KEY_LENGTH = 200;

// Ordered, first match wins. See the header for the precedence contract.
const RULES = Object.freeze([
  // Hinge / posterior chain: before every broad leg or arm phrase.
  ['hinge', ['deadlift', 'rdl', 'good morning', 'hip thrust', 'glute bridge', 'leg curl', 'hamstring curl', 'nordic curl']],
  // Shoulder phrases that contain a broader push/pull word ("upright row",
  // "push press", "rear delt fly", "reverse fly").
  ['shoulders', ['upright row', 'push press', 'overhead press', 'shoulder press', 'military press', 'arnold press',
    'lateral raise', 'side raise', 'front raise', 'rear delt', 'delt raise', 'reverse fly', 'ohp']],
  ['core', ['plank', 'crunch', 'ab wheel', 'ab rollout', 'sit up', 'situp', 'leg raise', 'knee raise',
    'russian twist', 'pallof press', 'dead bug', 'wood chop']],
  // "tricep"/"bicep" precede "leg extension"/"dip"; "curl" follows "leg curl".
  ['arms', ['tricep', 'bicep', 'pushdown', 'push down', 'skull crusher', 'hammer curl', 'curl']],
  ['push', ['bench press', 'chest press', 'floor press', 'incline db press', 'incline press', 'decline press',
    'push up', 'pushup', 'chest fly', 'pec deck', 'pec fly', 'fly', 'flye', 'flie', 'dip', 'crossover']],
  ['pull', ['pull up', 'pullup', 'chin up', 'chinup', 'pulldown', 'pull down', 'row']],
  ['legs', ['squat', 'leg press', 'lunge', 'leg extension', 'step up']],
  // Lowest priority so "bench row"/"bench dip"/"bench step up" resolve above.
  ['push', ['bench']],
]);

function _stem(word) {
  if (/(ch|sh|x|ss)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 2 && word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us')) return word.slice(0, -1);
  return word;
}

function _tokens(text) {
  return String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(_stem);
}

const COMPILED = RULES.map(([group, phrases]) => [group, phrases.map(p => ` ${_tokens(p).join(' ')} `)]);

// The one group the keyword rules give a name; "other" when none decides.
export function keywordMovementGroup(name) {
  const haystack = ` ${_tokens(normalizeExerciseKey(name)).join(' ')} `;
  for (const [group, phrases] of COMPILED) {
    if (phrases.some(p => haystack.includes(p))) return group;
  }
  return OTHER_GROUP_ID;
}

// ── override map ──────────────────────────────────────────────────────────────

// Error string for an invalid map, null when valid. `null`/`undefined` is valid
// (rules only). Exactly {version: 1|2, overrides: {<key>: <one group id>}}: no
// extra top-level fields, no arrays of groups, keys 1-200 chars, <= 1000 keys.
// Version 1 accepts only the eight broad ids; version 2 also the detailed ids.
export function movementGroupMapError(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return 'must be an object';
  const keys = Object.keys(value);
  if (keys.length !== 2 || !('version' in value) || !('overrides' in value)) return 'must have exactly version and overrides';
  if (value.version !== MOVEMENT_GROUPS_VERSION && value.version !== DETAILED_MOVEMENT_GROUPS_VERSION) return `unsupported version ${String(value.version)}`;
  const allowed = _allowed(value.version);
  const o = value.overrides;
  if (!o || typeof o !== 'object' || Array.isArray(o)) return 'overrides must be an object';
  const entries = Object.entries(o);
  if (entries.length > MAX_MOVEMENT_OVERRIDES) return `too many overrides (${entries.length}; limit ${MAX_MOVEMENT_OVERRIDES})`;
  for (const [k, g] of entries) {
    if (k.length < 1 || k.length > MAX_MOVEMENT_KEY_LENGTH || k === '__proto__') return 'override key must be 1-200 characters';
    if (typeof g !== 'string' || !allowed(g)) return `unknown movement group for "${k}"`;
  }
  return null;
}

export const OVERRIDE_STATE = Object.freeze({
  RULES_ONLY: 'rules_only',
  OVERRIDES: 'overrides',
  INVALID: 'invalid',
});

// Read a stored map into { state, overrides }. An invalid map is an explicit
// INVALID state with no usable overrides, never a silently accepted mapping.
export function readMovementOverrides(value) {
  if (value == null) return { state: OVERRIDE_STATE.RULES_ONLY, overrides: {}, version: null };
  const error = movementGroupMapError(value);
  if (error) return { state: OVERRIDE_STATE.INVALID, overrides: {}, error };
  return { state: OVERRIDE_STATE.OVERRIDES, overrides: { ...value.overrides }, version: value.version };
}

// The group for one exercise: the user override when one exists for the exact
// normalized key, else the keyword rules. Always exactly one valid id.
export const normalizeOverrideKey = (name) => normalizeExerciseKey(name);

export function resolveMovementGroup(name, overrides = {}) {
  const key = normalizeExerciseKey(name);
  const own = Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : null;
  if (own && (isMovementGroupId(own) || isDetailedMovementGroupId(own))) return { group: own, source: 'override', key };
  return { group: keywordMovementGroup(key), source: 'rules', key };
}

// Next stored map after choosing `group` for `key`, or after Reset (`group`
// null) removing the key so automatic classification applies again. Always a map
// object (an emptied map is `{version, overrides:{}}`, never null, so the cleared
// state reaches the server instead of being skipped as "no value"). Other keys'
// values are carried over exactly. The version is 2 when the current map already
// is, or when `group` is a detailed id; otherwise it stays 1.
export function nextMovementGroupMap(current, key, group) {
  const read = readMovementOverrides(current);
  if (read.state === OVERRIDE_STATE.INVALID) return { ok: false, error: 'Saved group choices are unreadable.' };
  const k = normalizeExerciseKey(key);
  if (!k || k === '__proto__' || k.length > MAX_MOVEMENT_KEY_LENGTH) return { ok: false, error: 'That exercise name is too long to save a group for.' };
  const overrides = { ...read.overrides };
  if (group == null) delete overrides[k];
  else if (!isMovementGroupId(group) && !isDetailedMovementGroupId(group)) return { ok: false, error: 'Unknown movement group.' };
  else overrides[k] = group;
  if (Object.keys(overrides).length > MAX_MOVEMENT_OVERRIDES) return { ok: false, error: 'Too many saved group choices.' };
  const version = read.version === DETAILED_MOVEMENT_GROUPS_VERSION || isDetailedMovementGroupId(group)
    ? DETAILED_MOVEMENT_GROUPS_VERSION : MOVEMENT_GROUPS_VERSION;
  return { ok: true, map: { version, overrides } };
}

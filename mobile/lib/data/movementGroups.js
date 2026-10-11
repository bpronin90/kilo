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

import { normalizeExerciseKey } from '../parser.js';

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

const _labels = new Map(MOVEMENT_GROUPS.map(g => [g.id, g.label]));
export const movementGroupLabel = (id) => _labels.get(id) || _labels.get(OTHER_GROUP_ID);
export const isMovementGroupId = (id) => typeof id === 'string' && MOVEMENT_GROUP_IDS.includes(id);

export const MOVEMENT_GROUPS_VERSION = 1;
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
// (rules only). Exactly {version: 1, overrides: {<key>: <one group id>}}: no
// extra top-level fields, no arrays of groups, keys 1-200 chars, <= 1000 keys.
export function movementGroupMapError(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return 'must be an object';
  const keys = Object.keys(value);
  if (keys.length !== 2 || !('version' in value) || !('overrides' in value)) return 'must have exactly version and overrides';
  if (value.version !== MOVEMENT_GROUPS_VERSION) return `unsupported version ${String(value.version)}`;
  const o = value.overrides;
  if (!o || typeof o !== 'object' || Array.isArray(o)) return 'overrides must be an object';
  const entries = Object.entries(o);
  if (entries.length > MAX_MOVEMENT_OVERRIDES) return `too many overrides (${entries.length}; limit ${MAX_MOVEMENT_OVERRIDES})`;
  for (const [k, g] of entries) {
    if (k.length < 1 || k.length > MAX_MOVEMENT_KEY_LENGTH || k === '__proto__') return 'override key must be 1-200 characters';
    if (typeof g !== 'string' || !MOVEMENT_GROUP_IDS.includes(g)) return `unknown movement group for "${k}"`;
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
  if (value == null) return { state: OVERRIDE_STATE.RULES_ONLY, overrides: {} };
  const error = movementGroupMapError(value);
  if (error) return { state: OVERRIDE_STATE.INVALID, overrides: {}, error };
  return { state: OVERRIDE_STATE.OVERRIDES, overrides: { ...value.overrides } };
}

// The group for one exercise: the user override when one exists for the exact
// normalized key, else the keyword rules. Always exactly one valid id.
export function resolveMovementGroup(name, overrides = {}) {
  const key = normalizeExerciseKey(name);
  const own = Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : null;
  if (own && MOVEMENT_GROUP_IDS.includes(own)) return { group: own, source: 'override', key };
  return { group: keywordMovementGroup(key), source: 'rules', key };
}

// Next stored map after choosing `group` for `key`, or after Reset (`group`
// null) removing the key so the keyword rules apply again. Always a map object
// (an emptied map is `{version:1, overrides:{}}`, never null, so the cleared
// state reaches the server instead of being skipped as "no value").
export function nextMovementGroupMap(current, key, group) {
  const read = readMovementOverrides(current);
  if (read.state === OVERRIDE_STATE.INVALID) return { ok: false, error: 'Saved group choices are unreadable.' };
  const k = normalizeExerciseKey(key);
  if (!k || k === '__proto__' || k.length > MAX_MOVEMENT_KEY_LENGTH) return { ok: false, error: 'That exercise name is too long to save a group for.' };
  const overrides = { ...read.overrides };
  if (group == null) delete overrides[k];
  else if (!MOVEMENT_GROUP_IDS.includes(group)) return { ok: false, error: 'Unknown movement group.' };
  else overrides[k] = group;
  if (Object.keys(overrides).length > MAX_MOVEMENT_OVERRIDES) return { ok: false, error: 'Too many saved group choices.' };
  return { ok: true, map: { version: MOVEMENT_GROUPS_VERSION, overrides } };
}

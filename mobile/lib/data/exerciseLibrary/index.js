// Offline, deterministic exercise metadata lookup (#1578).
//
// Read-only enrichment for analytics. Library IDs describe metadata; they never
// replace normalizeExerciseKey() history keys, rename exercises, or force a
// selection. No network, storage, fuzzy matching, or caller mutation.
//
// Resolver priority (vocabulary.normalization_policy): canonical name > exercise
// alias > explicit ambiguity record > family registry > unknown. Deprecated IDs
// resolve only through resolveExerciseId(); they never alter text matching, so
// generic "assisted pull-up" text stays ambiguous.

import LIBRARY from './v3.json';

// Provenance and dataset version are tracked separately from schema_version.
export const SOURCE_PROVENANCE = Object.freeze({
  source: 'Owner-supplied kilo_exercise_library.json, relocated unchanged',
  suppliedOn: '2026-10-22',
  sha256: '094e8ebbe7a4ea7ad947cde44be806f9a8bd778a61f9d2e198993b4482b38920',
});
export const DATASET_VERSION = 'v3-2026-10-22';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}
deepFreeze(LIBRARY);

// Single-letter tokens in a row (R.D.L., R D L) fold into one token (rdl).
function foldInitialisms(tokens) {
  const out = [];
  let run = '';
  const flush = () => {
    if (run) out.push(run);
    run = '';
  };
  for (const token of tokens) {
    if (token.length === 1 && /\p{L}/u.test(token)) {
      run += token;
    } else {
      flush();
      out.push(token);
    }
  }
  flush();
  return out;
}

export function normalizeExerciseName(input) {
  if (typeof input !== 'string') return '';
  const text = input
    .normalize('NFKC')
    .toUpperCase()
    .toLowerCase()
    .replace(/\u03c2/g, '\u03c3')
    .replace(/[‘’'`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  if (!text) return '';
  // upper->lower applies the full (multi-character) Unicode case mappings, so it
  // matches casefold for these inputs (e.g. ss, final sigma, U+0345); re-normalize.
  return foldInitialisms(text.split(' ')).join(' ').normalize('NFKC');
}

const exercisesById = new Map();
const familiesById = new Map();
const canonicalIndex = new Map();
const aliasIndex = new Map();
const ambiguityIndex = new Map();
const familyIndex = new Map();

function buildIndexes() {
  for (const family of LIBRARY.families) {
    familiesById.set(family.id, family);
    for (const label of [family.name, ...family.aliases]) {
      const key = normalizeExerciseName(label);
      if (key && !familyIndex.has(key)) familyIndex.set(key, family);
    }
  }
  for (const exercise of LIBRARY.exercises) {
    exercisesById.set(exercise.id, exercise);
    const key = normalizeExerciseName(exercise.name);
    if (key && !canonicalIndex.has(key)) canonicalIndex.set(key, exercise);
  }
  for (const exercise of LIBRARY.exercises) {
    for (const alias of exercise.aliases) {
      const key = normalizeExerciseName(alias);
      if (key && !aliasIndex.has(key)) aliasIndex.set(key, exercise);
    }
  }
  for (const record of LIBRARY.ambiguous_names) {
    const key = normalizeExerciseName(record.input);
    if (key && !ambiguityIndex.has(key)) ambiguityIndex.set(key, record);
  }
}
buildIndexes();

function result(input, fields) {
  return Object.freeze({
    input,
    matchType: fields.matchType,
    exerciseId: fields.exerciseId || null,
    familyId: fields.familyId || null,
    exercise: fields.exercise || null,
    candidates: Object.freeze([...(fields.candidates || [])]),
    missingDiscriminators: Object.freeze([...(fields.missingDiscriminators || [])]),
    clarificationQuestion: fields.clarificationQuestion || null,
  });
}

export function resolveExerciseName(input) {
  const key = normalizeExerciseName(input);
  const exact = canonicalIndex.get(key);
  if (exact) {
    return result(input, {
      matchType: 'exact',
      exerciseId: exact.id,
      familyId: exact.family_id,
      exercise: exact,
    });
  }
  const alias = aliasIndex.get(key);
  if (alias) {
    return result(input, {
      matchType: 'alias',
      exerciseId: alias.id,
      familyId: alias.family_id,
      exercise: alias,
    });
  }
  const ambiguity = ambiguityIndex.get(key);
  if (ambiguity) {
    return result(input, {
      matchType: 'ambiguous',
      familyId: ambiguity.family_id,
      candidates: ambiguity.candidate_ids,
      missingDiscriminators: ambiguity.missing_discriminators,
      clarificationQuestion: ambiguity.clarification_question,
    });
  }
  const family = familyIndex.get(key);
  if (family) return result(input, { matchType: 'family_only', familyId: family.id });
  return result(input, { matchType: 'unknown' });
}

// Separate ID API: follows deprecated redirects (e.g. assisted_pull_up ->
// machine_assisted_pull_up) for stored IDs only, never for free text.
export function resolveExerciseId(id) {
  if (typeof id !== 'string' || !id) {
    return Object.freeze({ requestedId: id, id: null, exercise: null, redirected: false });
  }
  const target = Object.prototype.hasOwnProperty.call(LIBRARY.deprecated_id_redirects, id)
    ? LIBRARY.deprecated_id_redirects[id]
    : id;
  const exercise = exercisesById.get(target) || null;
  return Object.freeze({
    requestedId: id,
    id: exercise ? exercise.id : null,
    exercise,
    redirected: target !== id && Boolean(exercise),
  });
}

export function getExercise(id) {
  return exercisesById.get(id) || null;
}

export function getFamily(id) {
  return familiesById.get(id) || null;
}

export const SCHEMA_VERSION = LIBRARY.schema_version;
export const EXERCISE_LIBRARY = LIBRARY;

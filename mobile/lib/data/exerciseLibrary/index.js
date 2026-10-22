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

// Code points where upper->lower differs from Unicode casefold(), as
// `codepoint=folded.codepoints` hex. Generated from Python str.casefold() against
// JS toUpperCase().toLowerCase(); the parity test re-derives it exhaustively.
export const CASEFOLD_EXCEPTIONS = new Map(
  [
    '131=131 13a0=13a0 13a1=13a1 13a2=13a2 13a3=13a3 13a4=13a4 13a5=13a5 13a6=13a6 13a7=13a7 ',
    '13a8=13a8 13a9=13a9 13aa=13aa 13ab=13ab 13ac=13ac 13ad=13ad 13ae=13ae 13af=13af 13b0=13b0 ',
    '13b1=13b1 13b2=13b2 13b3=13b3 13b4=13b4 13b5=13b5 13b6=13b6 13b7=13b7 13b8=13b8 13b9=13b9 ',
    '13ba=13ba 13bb=13bb 13bc=13bc 13bd=13bd 13be=13be 13bf=13bf 13c0=13c0 13c1=13c1 13c2=13c2 ',
    '13c3=13c3 13c4=13c4 13c5=13c5 13c6=13c6 13c7=13c7 13c8=13c8 13c9=13c9 13ca=13ca 13cb=13cb ',
    '13cc=13cc 13cd=13cd 13ce=13ce 13cf=13cf 13d0=13d0 13d1=13d1 13d2=13d2 13d3=13d3 13d4=13d4 ',
    '13d5=13d5 13d6=13d6 13d7=13d7 13d8=13d8 13d9=13d9 13da=13da 13db=13db 13dc=13dc 13dd=13dd ',
    '13de=13de 13df=13df 13e0=13e0 13e1=13e1 13e2=13e2 13e3=13e3 13e4=13e4 13e5=13e5 13e6=13e6 ',
    '13e7=13e7 13e8=13e8 13e9=13e9 13ea=13ea 13eb=13eb 13ec=13ec 13ed=13ed 13ee=13ee 13ef=13ef ',
    '13f0=13f0 13f1=13f1 13f2=13f2 13f3=13f3 13f4=13f4 13f5=13f5 13f8=13f0 13f9=13f1 13fa=13f2 ',
    '13fb=13f3 13fc=13f4 13fd=13f5 1c89=1c89 1e9e=73.73 a7cb=a7cb a7cc=a7cc a7ce=a7ce a7d2=a7d2 ',
    'a7d4=a7d4 a7da=a7da a7dc=a7dc ab70=13a0 ab71=13a1 ab72=13a2 ab73=13a3 ab74=13a4 ab75=13a5 ',
    'ab76=13a6 ab77=13a7 ab78=13a8 ab79=13a9 ab7a=13aa ab7b=13ab ab7c=13ac ab7d=13ad ab7e=13ae ',
    'ab7f=13af ab80=13b0 ab81=13b1 ab82=13b2 ab83=13b3 ab84=13b4 ab85=13b5 ab86=13b6 ab87=13b7 ',
    'ab88=13b8 ab89=13b9 ab8a=13ba ab8b=13bb ab8c=13bc ab8d=13bd ab8e=13be ab8f=13bf ab90=13c0 ',
    'ab91=13c1 ab92=13c2 ab93=13c3 ab94=13c4 ab95=13c5 ab96=13c6 ab97=13c7 ab98=13c8 ab99=13c9 ',
    'ab9a=13ca ab9b=13cb ab9c=13cc ab9d=13cd ab9e=13ce ab9f=13cf aba0=13d0 aba1=13d1 aba2=13d2 ',
    'aba3=13d3 aba4=13d4 aba5=13d5 aba6=13d6 aba7=13d7 aba8=13d8 aba9=13d9 abaa=13da abab=13db ',
    'abac=13dc abad=13dd abae=13de abaf=13df abb0=13e0 abb1=13e1 abb2=13e2 abb3=13e3 abb4=13e4 ',
    'abb5=13e5 abb6=13e6 abb7=13e7 abb8=13e8 abb9=13e9 abba=13ea abbb=13eb abbc=13ec abbd=13ed ',
    'abbe=13ee abbf=13ef 10d50=10d50 10d51=10d51 10d52=10d52 10d53=10d53 10d54=10d54 ',
    '10d55=10d55 10d56=10d56 10d57=10d57 10d58=10d58 10d59=10d59 10d5a=10d5a 10d5b=10d5b ',
    '10d5c=10d5c 10d5d=10d5d 10d5e=10d5e 10d5f=10d5f 10d60=10d60 10d61=10d61 10d62=10d62 ',
    '10d63=10d63 10d64=10d64 10d65=10d65 16ea0=16ea0 16ea1=16ea1 16ea2=16ea2 16ea3=16ea3 ',
    '16ea4=16ea4 16ea5=16ea5 16ea6=16ea6 16ea7=16ea7 16ea8=16ea8 16ea9=16ea9 16eaa=16eaa ',
    '16eab=16eab 16eac=16eac 16ead=16ead 16eae=16eae 16eaf=16eaf 16eb0=16eb0 16eb1=16eb1 ',
    '16eb2=16eb2 16eb3=16eb3 16eb4=16eb4 16eb5=16eb5 16eb6=16eb6 16eb7=16eb7 16eb8=16eb8',
  ]
    .join('')
    .split(' ')
    .map((entry) => {
      const [cp, folded] = entry.split('=');
      return [
        String.fromCodePoint(parseInt(cp, 16)),
        String.fromCodePoint(...folded.split('.').map((h) => parseInt(h, 16))),
      ];
    }),
);

export function foldCase(text) {
  let out = '';
  for (const ch of text) {
    out += CASEFOLD_EXCEPTIONS.get(ch) ?? ch.toUpperCase().toLowerCase();
  }
  return out;
}

export function normalizeExerciseName(input) {
  if (typeof input !== 'string') return '';
  // Recompose after casefold, before filtering: casefold can emit base + mark.
  const text = foldCase(input.normalize('NFKC'))
    .normalize('NFKC')
    .replace(/[‘’'`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  if (!text) return '';
  // Full Unicode casefold (foldCase), then re-normalize.
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

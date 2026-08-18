// The parser-output cache that must never be persisted (issue #813).
//
// `derived_sections` was the sync merge's recomputed `parseWorkoutNote()` output,
// attached to a workout note whenever the local and remote copies agreed on
// `raw_text` (see syncQueue.resolveRecord and the recompute seam in
// storage/cloud/transport.js) and then written back into the notebook, the
// per-table sync baseline, and the dirty queue. Nothing ever read it: every
// screen re-parses `raw_text` at render, it is not a cloud column (the push
// whitelist omits it), and it is not part of the backup contract. Yet the
// parser's output is roughly one hundred times the size of the text it
// describes, so each note that had ever been pushed made every notebook read
// and write, every sync pass, and every backup pay for a cache no one used -
// and on a device the whole payload is decrypted and re-encrypted in pure JS.
//
// This module is the single place that names the field. Every notebook write
// path strips it, the dirty queue strips it, the sync fingerprint ignores it,
// and a one-time purge removes it from storage that already carries it. Both
// helpers return their input by identity when there is nothing to strip, so the
// ordinary (clean) path allocates nothing.
export const DERIVED_SECTIONS_FIELD = 'derived_sections';

export function hasDerivedSections(note) {
  return note != null && typeof note === 'object' && DERIVED_SECTIONS_FIELD in note;
}

export function stripDerivedSections(note) {
  if (!hasDerivedSections(note)) return note;
  const { [DERIVED_SECTIONS_FIELD]: _derived, ...clean } = note; // eslint-disable-line no-unused-vars
  return clean;
}

export function stripDerivedSectionsFromList(list) {
  if (!Array.isArray(list) || !list.some(hasDerivedSections)) return list;
  return list.map(stripDerivedSections);
}

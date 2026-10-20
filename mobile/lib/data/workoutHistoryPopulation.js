// Canonical workout-history population projection (#1492).
//
// Home, Analytics, Log progression suggestions, and save-time classification
// each project the same notebook into the same populations:
//
//   - the full notebook, in persisted order (Track anchors are minted here, and
//     save-time retirement deliberately reads it unfiltered);
//   - the ordinary-analytics ("normal") notes: the notebook minus notes a
//     Recovery block withholds from ordinary analytics;
//   - the progression notes: normal notes minus deloads (exerciseProgress
//     `deriveProgressionSections`/`deriveProgressionAnchorSource`).
//
// This module is PURE and only projects. Every decision about WHO is a member
// stays with the caller and arrives as an explicit input:
//
//   - `isExcluded(note)` is the caller's Recovery membership answer. Render-time
//     callers pass their subscribed snapshot; save-time callers pass a FRESH
//     authoritative read they performed themselves. Whether that answer is
//     known at all (readiness / unknown-state degradation) is also the caller's
//     call — an empty or missing predicate here means "nothing excluded", never
//     "membership unknown", so callers must not reach this projection with an
//     unverified boundary.
//   - `sectionsOf(note, index)` is the caller's parse. It is where an explicit
//     live-draft replacement happens (the current note's unsaved text standing
//     in for its persisted text) and where each caller keeps its own parse
//     failure policy and cache.
//
// No storage reads or writes, subscriptions, parser changes, or module-level
// cache live here. Output arrays preserve input note order and object identity;
// `sectionsOf` runs exactly once per note.

import { isDeloadNote } from './exerciseProgress';

// The Recovery exclusion predicate for a raw excluded-note-id set, matching
// recoveryAnalyticsFilter `filterNotesForNormalAnalytics`: a note without an id
// is never excluded. Null for a missing or empty set, so the projection keeps
// the caller's own array for `normalNotes`.
export function isExcludedByNoteIds(excludedNoteIds) {
  if (!excludedNoteIds || excludedNoteIds.size === 0) return null;
  return (note) => !!(note?.id && excludedNoteIds.has(note.id));
}

// Membership only — no parsing. `included[i]` is true when `notes[i]` feeds
// progression (normal and not a deload).
export function classifyWorkoutHistoryMembers(notes, { isExcluded = null } = {}) {
  const all = notes || [];
  const normalFlags = all.map(n => !(isExcluded && isExcluded(n)));
  const included = all.map((n, i) => normalFlags[i] && !isDeloadNote(n));
  const normalNotes = isExcluded ? all.filter((_, i) => normalFlags[i]) : all;
  const progressionNotes = all.filter((_, i) => included[i]);
  return { notes: all, normalFlags, included, normalNotes, progressionNotes };
}

// The full projection. `noteSectionsList` stays aligned with the WHOLE notebook
// (the anchor provenance `deriveProgressionAnchorSource` builds), while the
// normal/progression lists are its order-preserving subsets.
export function projectWorkoutHistoryPopulation(notes, { sectionsOf, isExcluded = null } = {}) {
  if (typeof sectionsOf !== 'function') {
    throw new TypeError('projectWorkoutHistoryPopulation requires sectionsOf');
  }
  const members = classifyWorkoutHistoryMembers(notes, { isExcluded });
  const noteSectionsList = members.notes.map((n, i) => sectionsOf(n, i) || []);
  const normalNoteSectionsList = noteSectionsList.filter((_, i) => members.normalFlags[i]);
  const progressionSections = noteSectionsList.filter((_, i) => members.included[i]).flat();
  return {
    notes: members.notes,
    noteSectionsList,
    normalNotes: members.normalNotes,
    normalNoteSectionsList,
    normalSections: normalNoteSectionsList.flat(),
    unfilteredSections: noteSectionsList.flat(),
    progressionNotes: members.progressionNotes,
    progressionSections,
    anchorSource: { noteSectionsList, included: members.included },
  };
}

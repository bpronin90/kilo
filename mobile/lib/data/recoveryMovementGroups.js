// Movement-group breakdown of the Recovery strength view (#1306).
//
// Pure and read-only. It reuses the score rows `deriveRecoveryStrength` already
// produced (#1305): no new e1RM is computed, load and volume are never averaged,
// and the overall score and pace are not touched. Each exercise (baseline roster
// plus lifts added during recovery) is placed in EXACTLY ONE group, so a
// reassignment moves it exactly once and the grouped count always equals the
// number of exercises listed.
//
// A group's percent is the mean over that group's subset of the SAME comparable
// cohort the headline uses (lifts scored in every readable week), read from the
// selected week. A group with no scored cohort lift has no percent (null), never
// 0%. Added and unscoreable exercises stay grouped but never enter an average.

//
// Classification (#1581). A saved choice (version 1 broad or version 2 detailed)
// always wins, exactly as stored. Otherwise the shared library resolver
// classifies the record's own frozen display name; when the library cannot (an
// unknown name, or a record with no name), the existing keyword rules decide and
// the source says so ('keywords', never presented as library certainty). The
// normalized key is never fed to the library: it would reconstruct a
// specificity the record does not hold. Display buckets only: scores, cohort,
// percent and frozen evidence are read from `strength` unchanged.

import {
  DETAILED_MOVEMENT_GROUPS, MOVEMENT_GROUPS, OVERRIDE_STATE, isDetailedMovementGroupId, isMovementGroupId,
  keywordMovementGroup, normalizeOverrideKey, readMovementOverrides,
} from './movementGroups.js';
import { UNCLASSIFIED_GROUP_ID, groupForResolution } from './primaryMovementGroups.js';
import { resolveExerciseName } from './exerciseLibrary';

// Detailed buckets first (library order), then the broad buckets that only
// legacy choices and keyword fallback fill.
const BUCKETS = Object.freeze([...DETAILED_MOVEMENT_GROUPS, ...MOVEMENT_GROUPS]);

// { group, source: 'library' | 'keywords' } for one frozen row, ignoring overrides.
export function automaticRecoveryGroup(row) {
  const name = row && typeof row.name === 'string' && row.name.trim() ? row.name : null;
  if (name) {
    const { groupId } = groupForResolution(resolveExerciseName(name));
    if (groupId !== UNCLASSIFIED_GROUP_ID) return { group: groupId, source: 'library' };
  }
  return { group: keywordMovementGroup(name || (row && row.key) || ''), source: 'keywords' };
}

export function deriveMovementGroupBreakdown({ strength = null, baselineRows = [], addedRows = [], overrides = {} } = {}) {
  const scoreByKey = new Map(((strength && strength.lifts) || []).map(l => [l.key, l]));
  const members = [];
  const seen = new Set();
  const add = (row, origin) => {
    if (!row || !row.key || seen.has(row.key)) return;
    seen.add(row.key);
    const name = row.name || row.key;
    const auto = automaticRecoveryGroup(row);
    const k = normalizeOverrideKey(row.key);
    const own = Object.prototype.hasOwnProperty.call(overrides, k) ? overrides[k] : null;
    const chosen = own && (isMovementGroupId(own) || isDetailedMovementGroupId(own));
    const lift = origin === 'baseline' ? scoreByKey.get(row.key) : null;
    const percent = lift && lift.in_cohort && Number.isFinite(lift.percent) ? lift.percent : null;
    members.push({
      key: row.key, name, origin,
      group: chosen ? own : auto.group,
      source: chosen ? 'override' : auto.source,
      legacy_choice: chosen ? isMovementGroupId(own) : false,
      automatic_group: auto.group,
      automatic_source: auto.source,
      in_cohort: !!(lift && lift.in_cohort),
      percent,
    });
  };
  for (const row of baselineRows) add(row, 'baseline');
  for (const row of addedRows) add(row, 'added');

  const groups = BUCKETS.map(({ id, label }) => {
    const exercises = members.filter(m => m.group === id);
    const cohort = exercises.filter(m => m.in_cohort);
    const scored = cohort.filter(m => m.percent != null);
    return {
      id,
      label,
      exercises,
      total_count: exercises.length,
      baseline_count: exercises.filter(m => m.origin === 'baseline').length,
      cohort_count: cohort.length,
      scored_count: scored.length,
      percent: scored.length > 0 ? scored.reduce((a, m) => a + m.percent, 0) / scored.length : null,
    };
  }).filter(g => g.total_count > 0);

  return { groups, total_count: members.length };
}

// Where this block's overrides come from and whether they can be edited. The
// baseline note is the single authority for every week of the block (and any
// other block that references it). A failed read, a missing/deleted note, or an
// invalid stored map each fall back to clearly labelled rules-only grouping with
// editing unavailable; none of them pretends there are simply no overrides.
export function resolveMovementGroupSource({ block, notes = [], notesError = null } = {}) {
  const noteId = (block && block.baseline_note_id) || null;
  if (notesError) return { available: false, reason: 'unreadable', overrides: {}, noteId };
  const note = (notes || []).find(n => n && n.id === noteId && !n.deleted_at);
  if (!note) return { available: false, reason: 'missing', overrides: {}, noteId };
  const read = readMovementOverrides(note.exercise_movement_groups);
  if (read.state === OVERRIDE_STATE.INVALID) return { available: false, reason: 'invalid', overrides: {}, noteId };
  return { available: true, reason: null, overrides: read.overrides, noteId };
}

// How a member got its group, for display. Keyword fallback is named as such so
// it never reads as library certainty; a legacy broad choice says so.
export function groupSourceText(ex) {
  if (!ex) return 'Automatic';
  if (ex.source === 'override') return ex.legacy_choice ? 'Your earlier broad choice' : 'Your choice';
  return ex.source === 'keywords' ? 'Automatic (name keywords)' : 'Automatic';
}

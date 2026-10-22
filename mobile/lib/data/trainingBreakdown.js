// Training breakdown (#1580): what the user actually logged, grouped by the
// offline exercise library. Pure and read-only; it reads the SAME ordinary-history
// sections `deriveParsedSections` already projected (Recovery exclusion applied
// once, there) and never builds a competing notebook filter.
//
// Counting reuses existing parsed semantics: logged session units come from
// `_occurrenceEntries` (so a collapsed row like "135 5,5,5" is its three parsed
// sets), warm-up sections, skipped entries/sets, unparsed rows and empty
// prescriptions contribute nothing, and a deload note counts like any ordinary
// note. A set with reps is a completed strength set; a set carrying a duration is
// timed activity and stays in its own tally instead of inventing strength sets.
//
// Enrichment is by the ORIGINAL parsed name (getExerciseMetadata), never the
// alias-grouped history key, so distinctions the legacy grouping discards survive.
// Muscle and equipment counts are multi-attribution (one compound set can sit
// under several muscles or implements) and are never summed into a unique total.
// A note-scoped authored movement choice wins over the library group and keeps
// its legacy label. Nothing here is persisted, cached across calls, or written
// back, and it does not touch exercise_classifications or any history key.

import { _occurrenceEntries } from '../parser/analytics.js';
import { getExerciseMetadata } from './exerciseMetadata';
import { UNCLASSIFIED_GROUP_ID } from './primaryMovementGroups';
import { OVERRIDE_STATE, movementGroupLabel, readMovementOverrides, resolveMovementGroup } from './movementGroups';

export const TRAINING_BREAKDOWN_SCOPE = 'Eligible ordinary history';

const NO_EQUIPMENT_ID = 'no_equipment';

export function humanizeLibraryId(id) {
  const text = String(id || '').replace(/_/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

function newBucketMap() {
  return new Map();
}

function addTo(map, id, label, name, key, sets, extra = null) {
  let bucket = map.get(id);
  if (!bucket) {
    bucket = { id, label, sets: 0, exercises: new Map(), ...(extra || {}) };
    map.set(id, bucket);
  }
  bucket.sets += sets;
  const entry = bucket.exercises.get(key);
  if (entry) entry.sets += sets;
  else bucket.exercises.set(key, { key, name, sets });
}

function finish(map) {
  return [...map.values()]
    .map((b) => ({
      ...b,
      exercises: [...b.exercises.values()].sort((a, c) => c.sets - a.sets || a.name.localeCompare(c.name)),
    }))
    .sort((a, c) => c.sets - a.sets || a.label.localeCompare(c.label));
}

const knownList = (value) => (Array.isArray(value) && value.length > 0 ? value : null);

// Counts the completed (strength) and timed sets of one exercise occurrence.
function countOccurrence(exercise, kind) {
  let strength = 0;
  let timed = 0;
  if (kind === 'warmup') return { strength, timed };
  for (const unit of _occurrenceEntries({ ...exercise, kind })) {
    if (!unit || unit.skipped || unit.unparsed || !unit.sets || unit.sets.length === 0) continue;
    for (const set of unit.sets) {
      if (!set || set.skipped) continue;
      if (set.duration_seconds > 0) timed += 1;
      else if (set.rep_count > 0) strength += 1;
    }
  }
  return { strength, timed };
}

// `parsedSections` is the object `deriveParsedSections` returns. `normalNotes[i]`
// pairs with `noteSectionsList[i]` (both are the recovery-filtered population);
// without that pairing there is no note to read authored overrides from, so the
// library group is used for every set.
export function deriveTrainingBreakdown(parsedSections) {
  const lists = parsedSections?.noteSectionsList;
  const notes = parsedSections?.normalNotes;
  const sectionLists = Array.isArray(lists) ? lists : [parsedSections?.allSections || []];
  const paired = Array.isArray(lists) && Array.isArray(notes) && notes.length === lists.length;

  const movement = newBucketMap();
  const unclassified = newBucketMap();
  const primary = newBucketMap();
  const secondary = newBucketMap();
  const unknownMuscles = newBucketMap();
  const equipment = newBucketMap();
  const unknownEquipment = newBucketMap();
  const timed = newBucketMap();
  const seenExercises = new Set();
  const metaCache = new Map();
  const unreadableNotes = new Set();
  const cov = { total: 0, movement: 0, primary: 0, secondary: 0, equipment: 0, overridden: 0 };

  sectionLists.forEach((sections, noteIndex) => {
    const note = paired ? notes[noteIndex] : null;
    const read = readMovementOverrides(note ? note.exercise_movement_groups : null);
    const overrides = read.state === OVERRIDE_STATE.OVERRIDES ? read.overrides : {};
    for (const section of sections || []) {
      for (const exercise of section.exercises || []) {
        const name = exercise.name;
        const { strength, timed: timedSets } = countOccurrence(exercise, section.kind);
        if (strength + timedSets === 0) continue;
        // Original-name identity, not the alias-grouped history key, so "RDL" and
        // "Romanian Deadlift" stay distinct names behind the breakdown.
        const key = String(name).trim().toLowerCase();
        seenExercises.add(key);
        if (timedSets > 0) addTo(timed, 'timed', 'Timed activity', name, key, timedSets);
        if (strength === 0) continue;
        if (read.state === OVERRIDE_STATE.INVALID && note) unreadableNotes.add(note.id ?? noteIndex);

        let meta = metaCache.get(name);
        if (!meta) { meta = getExerciseMetadata(name); metaCache.set(name, meta); }
        cov.total += strength;

        const chosen = resolveMovementGroup(name, overrides);
        if (chosen.source === 'override') {
          cov.movement += strength;
          cov.overridden += strength;
          addTo(movement, `legacy:${chosen.group}`, movementGroupLabel(chosen.group), name, key, strength, { source: 'override' });
        } else if (meta.primaryGroup.id !== UNCLASSIFIED_GROUP_ID) {
          cov.movement += strength;
          addTo(movement, meta.primaryGroup.id, meta.primaryGroup.label, name, key, strength, { source: 'library' });
        } else {
          addTo(unclassified, UNCLASSIFIED_GROUP_ID, 'Unclassified', name, key, strength);
        }

        const prim = knownList(meta.fields.primaryMuscles);
        if (prim) {
          cov.primary += strength;
          for (const m of prim) addTo(primary, m, humanizeLibraryId(m), name, key, strength);
        } else {
          addTo(unknownMuscles, 'unknown', 'Unknown muscles', name, key, strength);
        }
        if (Array.isArray(meta.fields.secondaryMuscles)) {
          cov.secondary += strength;
          for (const m of meta.fields.secondaryMuscles) addTo(secondary, m, humanizeLibraryId(m), name, key, strength);
        }

        if (Array.isArray(meta.fields.equipment)) {
          cov.equipment += strength;
          if (meta.fields.equipment.length === 0) addTo(equipment, NO_EQUIPMENT_ID, 'No equipment needed', name, key, strength);
          for (const e of meta.fields.equipment) addTo(equipment, e, humanizeLibraryId(e), name, key, strength);
        } else {
          addTo(unknownEquipment, 'unknown', 'Unknown equipment', name, key, strength);
        }
      }
    }
  });

  const timedBuckets = finish(timed);
  const timedSets = timedBuckets.length ? timedBuckets[0].sets : 0;
  const coverage = (known) => ({ knownSets: known, totalSets: cov.total });
  return {
    scope: TRAINING_BREAKDOWN_SCOPE,
    isEmpty: cov.total === 0 && timedSets === 0,
    totals: { completedSets: cov.total, timedSets, exerciseCount: seenExercises.size },
    movement: {
      groups: finish(movement),
      unclassified: finish(unclassified)[0] || null,
      coverage: coverage(cov.movement),
      overriddenSets: cov.overridden,
      unreadableOverrideNotes: unreadableNotes.size,
    },
    muscles: {
      primary: finish(primary),
      secondary: finish(secondary),
      unknown: finish(unknownMuscles)[0] || null,
      coverage: { primary: coverage(cov.primary), secondary: coverage(cov.secondary) },
    },
    equipment: {
      items: finish(equipment),
      unknown: finish(unknownEquipment)[0] || null,
      coverage: coverage(cov.equipment),
    },
    timed: timedBuckets[0] || null,
  };
}

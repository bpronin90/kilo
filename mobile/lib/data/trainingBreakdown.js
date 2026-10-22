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
import { MOVEMENT_COMPARISONS, MUSCLE_REGIONS, regionForMuscle } from './trainingBreakdownMappings';
import { resolveWindow, streamKey, windowKeeper } from './trainingBreakdownRange';

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

// Cardio / non-lift activity: the library's own cardio type, or a cardio-style name
// the library does not know as a strength exercise (mirrors the keyword list in
// exerciseCatalog's isStrengthExerciseName, without its warm-up-name exclusions, which
// would turn a working "Bodyweight squats" or "Band pull-aparts" set into activity).
const CARDIO_NAME_RE = /\b(treadmill|bike|bicycle|cycling|elliptical|run|walk|swim|cardio|rowing machine|ski erg)\b/i;
const isCardioActivity = (name, meta) => meta.fields.activityType === 'cardio'
  || (CARDIO_NAME_RE.test(name) && meta.fields.activityType !== 'strength');

// One exercise occurrence as its ordered eligible session units (#1597), each
// with what it contributes. Only units that count toward the breakdown are
// returned, so a skipped entry, an all-skipped row, a strength-unparsed row or an
// empty prescription never occupies a session-window slot. Summing every unit
// reproduces the pre-#1597 per-occurrence tallies exactly.
function occurrenceUnits(exercise, kind, nonLift) {
  if (kind === 'warmup') return [];
  const entries = _occurrenceEntries({ ...exercise, kind });
  const out = [];
  if (nonLift) {
    // A logged entry is a row with a performed set or an unparsed row; a row whose
    // sets are all skipped is not activity. Bare unparsed rows ("5 min 9") are the
    // exercise's unparsed_positions (unparsed_rows also holds preserved comments,
    // which are not activity, and rows already present as session entries). A bare
    // row sits before the session entry at its `pos`; ties keep array order.
    const performed = (u) => !!u.unparsed || (Array.isArray(u.sets) && u.sets.some((x) => x && !x.skipped));
    const bare = (exercise.unparsed_positions || []).map((b, i) => ({ pos: Number(b?.pos) || 0, i }))
      .sort((a, b) => a.pos - b.pos || a.i - b.i);
    const activity = { strength: 0, timed: 0, entries: 1 };
    let next = 0;
    entries.forEach((u, idx) => {
      while (next < bare.length && bare[next].pos <= idx) { out.push(activity); next += 1; }
      if (u && !u.skipped && performed(u)) out.push(activity);
    });
    while (next < bare.length) { out.push(activity); next += 1; }
    return out;
  }
  for (const unit of entries) {
    if (!unit || unit.skipped || unit.unparsed || !unit.sets) continue;
    const c = { strength: 0, timed: 0, entries: 0 };
    for (const set of unit.sets) {
      if (!set || set.skipped) continue;
      if (set.duration_seconds > 0) c.timed += 1;
      else if (set.rep_count > 0) c.strength += 1;
    }
    if (c.strength + c.timed > 0) out.push(c);
  }
  return out;
}

// `parsedSections` is the object `deriveParsedSections` returns. `normalNotes[i]`
// pairs with `noteSectionsList[i]` (both are the recovery-filtered population);
// without that pairing there is no note to read authored overrides from, so the
// library group is used for every set.
export function deriveTrainingBreakdown(parsedSections) {
  return accumulate(parsedSections).result;
}

// Walks the population in its positional session order, calling
// visit({ note, noteIndex, name, meta, units, key, read }) per occurrence with units.
function walk(parsedSections, metaCache, visit) {
  const lists = parsedSections?.noteSectionsList;
  const notes = parsedSections?.normalNotes;
  const sectionLists = Array.isArray(lists) ? lists : [parsedSections?.allSections || []];
  const paired = Array.isArray(lists) && Array.isArray(notes) && notes.length === lists.length;
  sectionLists.forEach((sections, noteIndex) => {
    const note = paired ? notes[noteIndex] : null;
    const read = readMovementOverrides(note ? note.exercise_movement_groups : null);
    for (const section of sections || []) {
      for (const exercise of section.exercises || []) {
        const name = exercise.name;
        let meta = metaCache.get(name);
        if (!meta) { meta = getExerciseMetadata(name); metaCache.set(name, meta); }
        const units = occurrenceUnits(exercise, section.kind, isCardioActivity(name, meta));
        if (units.length > 0) visit({ note, noteIndex, name, meta, units, key: streamKey(name), read });
      }
    }
  });
}

// `size` (#1597): when set, only each stream's newest `size` session units count.
function accumulate(parsedSections, size = null) {
  const metaCache = new Map();
  let keep = null;
  if (size) {
    const totals = new Map();
    walk(parsedSections, metaCache, ({ key, units }) => totals.set(key, (totals.get(key) || 0) + units.length));
    keep = windowKeeper(totals, size);
  }
  const ordinals = new Map();
  const movement = newBucketMap();
  const unclassified = newBucketMap();
  const primary = newBucketMap();
  const secondary = newBucketMap();
  const unknownMuscles = newBucketMap();
  const equipment = newBucketMap();
  const unknownEquipment = newBucketMap();
  const timed = newBucketMap();
  const regions = newBucketMap();
  const seenExercises = new Set();
  const unreadableNotes = new Set();
  const cov = { total: 0, movement: 0, primary: 0, secondary: 0, equipment: 0, overridden: 0 };

  walk(parsedSections, metaCache, ({ note, noteIndex, name, meta, units, key, read }) => {
    const overrides = read.state === OVERRIDE_STATE.OVERRIDES ? read.overrides : {};
    let strength = 0; let timedSets = 0; let entries = 0;
    for (const u of units) {
      const ordinal = ordinals.get(key) || 0;
      ordinals.set(key, ordinal + 1);
      if (keep && !keep(key, ordinal)) continue;
      strength += u.strength; timedSets += u.timed; entries += u.entries;
    }
    // Original-name identity, not the alias-grouped history key, so "RDL" and
    // "Romanian Deadlift" stay distinct names behind the breakdown.
    if (strength > 0) seenExercises.add(key);
    if (strength + timedSets + entries === 0) return;
    if (timedSets + entries > 0) addTo(timed, 'timed', 'Timed and cardio activity', name, key, timedSets + entries, { unit: 'entry' });
    if (strength === 0) return;
    if (read.state === OVERRIDE_STATE.INVALID && note) unreadableNotes.add(note.id ?? noteIndex);

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
      // A set counts once per region however many of its primaries sit there.
      const touched = new Set(prim.map(regionForMuscle).filter(Boolean));
      for (const r of touched) addTo(regions, r, r, name, key, strength);
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
  });

  const timedBuckets = finish(timed);
  const activityEntries = timedBuckets.length ? timedBuckets[0].sets : 0;
  const coverage = (known) => ({ knownSets: known, totalSets: cov.total });
  const result = {
    scope: TRAINING_BREAKDOWN_SCOPE,
    isEmpty: cov.total === 0 && activityEntries === 0,
    totals: { completedSets: cov.total, activityEntries, exerciseCount: seenExercises.size },
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
  return { result, regions };
}

function regionBuckets(regionMap) {
  const done = new Map(finish(regionMap).map((b) => [b.id, b]));
  return MUSCLE_REGIONS.map(({ id, label }) => ({
    id, label, sets: done.get(id)?.sets || 0, exercises: done.get(id)?.exercises || [],
  }));
}

function comparisons(movementGroups) {
  const setsOf = (groups) => movementGroups
    .filter((g) => g.source === 'library' && groups.includes(g.id))
    .reduce((n, g) => n + g.sets, 0);
  return MOVEMENT_COMPARISONS.map(({ id, label, sides }) => {
    const counted = sides.map((side) => ({ id: side.id, label: side.label, sets: setsOf(side.groups) }));
    const totalSets = counted.reduce((n, side) => n + side.sets, 0);
    return { id, label, totalSets, sides: counted.map((side) => ({ ...side, share: totalSets ? side.sets / totalSets : 0 })) };
  });
}

// #1597: the breakdown for one session window ('last4' | 'last12' | 'All') plus
// `muscles.regions` and `movement.comparisons`. `parsedSections` must come from a
// verified Recovery population; pass `populationVerified: false` when membership
// is unknown and the result is null rather than an unfiltered or empty breakdown.
// Bounded windows also return null without usable note/section pairing; All keeps
// the legacy allSections fallback and applies no window. No clock is read; any
// other option (e.g. a stale `now`) is ignored. Pure: no input mutation, storage
// or caching.
export function deriveTrainingBreakdownForRange(parsedSections, windowId, { populationVerified = true } = {}) {
  if (!populationVerified) return null;
  const selection = resolveWindow(parsedSections, windowId);
  if (!selection) return null;
  const { result, regions } = accumulate(parsedSections, selection.all ? null : selection.size);
  return {
    ...result,
    movement: { ...result.movement, comparisons: comparisons(result.movement.groups) },
    muscles: { ...result.muscles, regions: regionBuckets(regions) },
  };
}

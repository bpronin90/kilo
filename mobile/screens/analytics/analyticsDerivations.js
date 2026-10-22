import { getNoteSections } from '../../hooks/useEntries';
import { DELOAD_NOTE_PREFIX } from '../../hooks/entries/workoutNoteHooks';
import {
  isStrengthExerciseName,
  derive1kTotalFromSectionsList,
  derive1kTotalSeriesFromSectionsList,
} from '../../lib/data';
import { deriveExerciseProgress } from '../../lib/data/exerciseProgress';
import { normalizeExerciseKey } from '../../lib/parser/workoutPure';
import { deriveTrainingBreakdown } from '../../lib/data/trainingBreakdown';
import { projectWorkoutHistoryPopulation, isExcludedByNoteIds } from '../../lib/data/workoutHistoryPopulation';

// `excludedNoteIds` (#699) is the set of recovery-linked note ids whose block
// keeps `include_in_normal_analytics` off. It is applied ONCE here, so every
// ordinary population below (1K series, signals, aggregate sections) is derived
// from the same filtered note list and the surfaces cannot disagree. Recovery
// Analytics does not come through here — AnalyticsScreen hands it the unfiltered
// notes, because a block's own analytics always read its linked notes.
//
// `currentSections` is deliberately NOT filtered: it is the routine the user is
// looking at, not an aggregate, and a recovery week must stay readable and
// editable while excluded.
// #577 (Contract 3): tags each note's own sections with that note's
// identity BEFORE flattening, so a caller that later flattens several
// notes' sections together (deriveTrackedPROccurrences, via
// deriveWorkoutAnalytics' pass-through) can still trace any one section
// back to its source note — a heading/subheading string alone is not
// unique across notes. Pure, additive-only (every existing field on the
// section object is preserved unchanged); does not alter
// deriveParsedSections or any existing Analytics semantics, and is not
// called from deriveParsedSections itself.
export function tagNoteSections(notes) {
  return (notes || []).flatMap((n, noteOrdinal) =>
    getNoteSections(n).map((s, sectionOrdinal) => ({
      ...s,
      __noteId: n?.id ?? 'current:new',
      __noteOrdinal: noteOrdinal,
      __sectionOrdinal: sectionOrdinal,
    }))
  );
}

export function deriveParsedSections(notes, currentNote, excludedNoteIds = null) {
  // #1492: the canonical population projection. `noteSectionsList`/`allSections`
  // are the recovery-filtered normal population; the 1K series intentionally
  // keeps deload as its own point (#396), so they are left deload-inclusive.
  // signalSections is the deload-excluded progression population Home also
  // derives its summary from, and anchorSource (#1391) carries the unfiltered
  // notebook the Track anchors were minted in, so they are translated into
  // signalSections rather than clamped.
  const population = projectWorkoutHistoryPopulation(notes, {
    sectionsOf: getNoteSections,
    isExcluded: isExcludedByNoteIds(excludedNoteIds),
  });
  const noteSectionsList = population.normalNoteSectionsList;
  const allSections = population.normalSections;
  const signalSections = population.progressionSections;
  const normalNotes = population.normalNotes;
  const anchorSource = population.anchorSource;
  const currentSections = getNoteSections(currentNote);
  return { allSections, signalSections, currentSections, noteSectionsList, normalNotes, anchorSource };
}

export function deriveNoteExerciseNames(currentSections) {
  const names = currentSections.flatMap(s => s.exercises.map(e => e.name));
  return [...new Set(names)].filter(isStrengthExerciseName);
}

// `activations` (#893) are the tracked-lift activation records. Threaded into
// both derivations below rather than resolved separately in each, so the
// weighted signals, the per-day signals and the non-weighted arrows on one card
// cannot disagree about where the tracked span starts.
// `deloadContext` (#989) carries the post-deload re-entry inputs: the deload
// history, the stable current-routine id, and the live recovery blocks. Threaded
// into the one canonical analytics pass so the re-entry label Analytics surfaces
// agrees with Home and the save-time cache rather than each deriving its own.
export function deriveAnalytics(parsedSections, trackedLifts, oneKSelections, multiplier, activations = null, deloadContext = {}) {
  const { allSections, currentSections, noteSectionsList } = parsedSections;
  // Fall back to allSections for legacy callers that don't supply signalSections.
  const signalSections = parsedSections.signalSections || allSections;

  // The one canonical progression pass (lib/data/exerciseProgress) — Home reads
  // the same pass, so `exerciseProgress` here is Home's summary verbatim.
  const progress = deriveExerciseProgress({
    progressionSections: signalSections,
    currentSections,
    trackedLifts,
    activations,
    anchorSource: parsedSections.anchorSource ?? null,
    multiplier,
    deloadContext,
  });
  const { signals, nameDisplayMap, perDaySignals, nonWeightedMetrics, reentry, progressionSuggestions } = progress;
  const oneK = derive1kTotalFromSectionsList(noteSectionsList || [], oneKSelections);
  const oneKSeries = derive1kTotalSeriesFromSectionsList(noteSectionsList || [], oneKSelections);

  // #1580: additive, read-only library breakdown of the same ordinary-history
  // sections; no existing result above reads it.
  const trainingBreakdown = deriveTrainingBreakdown(parsedSections);

  return { signals, oneK, oneKSeries, nameDisplayMap, perDaySignals, nonWeightedMetrics, reentry, progressionSuggestions, exerciseProgress: progress.summary, trainingBreakdown };
}

const _LEADING_DAY_RE = /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

function _dayGroupKey(heading) {
  if (!heading) return heading;
  const m = heading.match(_LEADING_DAY_RE);
  return m ? m[1].toUpperCase() : heading;
}

export function deriveGroupedSignals(parsedSections, analytics, searchQuery) {
  const groups = [];
  const groupByKey = new Map();
  const sections = parsedSections.currentSections;
  const signals = analytics.signals || [];
  const perDaySignals = analytics.perDaySignals || {};
  const normCanon = normalizeExerciseKey;
  const nameToSignal = new Map(signals.map(s => [normCanon(s.name), s]));

  // Count unique day keys per exercise so same-day variants (e.g. gym Monday and
  // home Monday) don't inflate the multi-day count.
  const exerciseDayKeys = new Map();
  sections.forEach(s => {
    const key = _dayGroupKey(s.heading);
    s.exercises.forEach(e => {
      const norm = normCanon(e.name);
      if (!exerciseDayKeys.has(norm)) exerciseDayKeys.set(norm, new Set());
      exerciseDayKeys.get(norm).add(key);
    });
  });

  sections.forEach(section => {
    let groupExercises = section.exercises
      .map(e => nameToSignal.get(normCanon(e.name)))
      .filter(Boolean);

    if (searchQuery) {
      groupExercises = groupExercises.filter(sig =>
        sig.name.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    if (groupExercises.length > 0) {
      const dayKey = _dayGroupKey(section.heading);
      const mappedExercises = groupExercises.map(sig => {
        const norm = normCanon(sig.name);
        const dayKeys = exerciseDayKeys.get(norm);
        const isMultiDay = dayKeys ? dayKeys.size > 1 : false;
        const canonName = normalizeExerciseKey(sig.name);

        return {
          ...sig,
          isMultiDay,
          currentDayHeading: section.heading,
          otherDays: isMultiDay
            ? [...new Set(
                sections
                  .filter(s => _dayGroupKey(s.heading) !== dayKey && s.exercises.some(e => normCanon(e.name) === norm))
                  .map(s => _dayGroupKey(s.heading))
              )]
            : [],
          daySignals: isMultiDay ? (perDaySignals[canonName] || null) : null,
        };
      });

      if (groupByKey.has(dayKey)) {
        const existing = groupByKey.get(dayKey);
        const existingNorms = new Set(existing.exercises.map(e => normCanon(e.name)));
        existing.exercises.push(...mappedExercises.filter(e => !existingNorms.has(normCanon(e.name))));
      } else {
        const group = { name: dayKey, exercises: mappedExercises };
        groupByKey.set(dayKey, group);
        groups.push(group);
      }
    }
  });
  return groups;
}

// Count sessions an exercise appears in within a single note.
// Uses session_entries length if present (new format), else filtered rows.
function _countExerciseSessionsInNote(note, exerciseName) {
  const sections = getNoteSections(note);
  const key = normalizeExerciseKey(exerciseName);
  let count = 0;
  for (const section of sections) {
    for (const ex of section.exercises) {
      if (normalizeExerciseKey(ex.name) !== key) continue;
      if ((ex.session_entries || []).length > 0) {
        count += ex.session_entries.length;
      } else {
        count += (ex.rows || []).filter(r => r.sets?.length > 0).length;
      }
    }
  }
  return count;
}

// Returns a Set of 1-based session ordinals that mark the first session of a
// new (non-deload) routine in the 1K series. The first routine never produces
// a marker. Deload notes (title starts with DELOAD_NOTE_PREFIX) are skipped.
export function deriveRoutineStartBoundaries(notes, oneKSelections) {
  const { bench, squat, deadlift } = oneKSelections || {};
  if (!bench && !squat && !deadlift) return new Set();

  let cumBench = 0, cumSquat = 0, cumDeadlift = 0;
  const boundaries = new Set();
  let seenFirstRoutine = false;

  for (const note of notes || []) {
    const isDeload = note.title?.startsWith(DELOAD_NOTE_PREFIX);
    if (!isDeload) {
      if (seenFirstRoutine) {
        // First valid session index (0-based) where all three lifts are in the new note
        const boundary0 = Math.min(
          bench ? cumBench : Infinity,
          squat ? cumSquat : Infinity,
          deadlift ? cumDeadlift : Infinity,
        );
        if (Number.isFinite(boundary0)) {
          boundaries.add(boundary0 + 1); // convert to 1-based session ordinal
        }
      }
      seenFirstRoutine = true;
    }
    if (bench) cumBench += _countExerciseSessionsInNote(note, bench);
    if (squat) cumSquat += _countExerciseSessionsInNote(note, squat);
    if (deadlift) cumDeadlift += _countExerciseSessionsInNote(note, deadlift);
  }

  return boundaries;
}

export function deriveOneKChartData(oneKSeries, routineStartBoundaries = new Set()) {
  // Sort boundaries ascending so we can step through them once.
  const sorted = [...routineStartBoundaries].sort((a, b) => a - b);
  let bIdx = 0;
  let prevSession = 0;

  return (oneKSeries || []).map(p => {
    // Mark this point if any boundary falls in (prevSession, p.session].
    // This correctly handles gaps in the series: a boundary at session 2 that
    // was skipped (no 1K point emitted) still marks the next emitted point.
    let isRoutineStart = false;
    while (bIdx < sorted.length && sorted[bIdx] <= p.session) {
      if (sorted[bIdx] > prevSession) isRoutineStart = true;
      bIdx++;
    }
    prevSession = p.session;

    return {
      value: Math.round(p.total),
      label: `#${p.session}`,
      unit: 'lb',
      bench: p.bench,
      squat: p.squat,
      deadlift: p.deadlift,
      isRoutineStart,
    };
  });
}

export function shapeEditCheckInData(editPendingCheckIn) {
  if (!editPendingCheckIn) return null;
  return {
    sessionIndex: editPendingCheckIn.ci.sessionIndex,
    responded_at: editPendingCheckIn.ci.responded_at,
    status: editPendingCheckIn.ci.status,
    reasons: editPendingCheckIn.ci.reasons,
    note: editPendingCheckIn.ci.note,
    detectors: editPendingCheckIn.ci.detectors,
    flagged: editPendingCheckIn.ci.flagged,
    metrics: {
      exercises_skipped: editPendingCheckIn.ci.exercises_skipped,
      volume_decline_pct: editPendingCheckIn.ci.volume_decline_pct,
    },
  };
}

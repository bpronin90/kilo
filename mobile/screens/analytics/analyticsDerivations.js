import { getNoteSections } from '../../hooks/useEntries';
import { DELOAD_NOTE_PREFIX } from '../../hooks/entries/workoutNoteHooks';
import {
  isStrengthExerciseName,
  deriveWorkoutNoteAnalytics,
  derive1kTotalFromSectionsList,
  derive1kTotalSeriesFromSectionsList,
  deriveNonWeightedTrackedExerciseMetrics,
} from '../../lib/data';
import { normalizeExerciseKey } from '../../lib/parser';

export function deriveParsedSections(notes, currentNote) {
  const noteSectionsList = notes.map(n => getNoteSections(n));
  const allSections = noteSectionsList.flat();
  const currentSections = getNoteSections(currentNote);
  return { allSections, currentSections, noteSectionsList };
}

export function deriveNoteExerciseNames(currentSections) {
  const names = currentSections.flatMap(s => s.exercises.map(e => e.name));
  return [...new Set(names)].filter(isStrengthExerciseName);
}

export function deriveAnalytics(parsedSections, trackedLifts, oneKSelections, multiplier) {
  const { allSections, currentSections, noteSectionsList } = parsedSections;

  const namesInCurrent = new Set(
    currentSections.flatMap(s => s.exercises.map(e => normalizeExerciseKey(e.name)))
  );
  const globallyTrackedNames = Object.keys(trackedLifts).filter(k => trackedLifts[k]);
  const visibleTrackedNames = globallyTrackedNames.filter(
    name => namesInCurrent.has(normalizeExerciseKey(name))
  );

  const { signals, nameDisplayMap, perDaySignals } = deriveWorkoutNoteAnalytics(allSections, visibleTrackedNames, multiplier);
  const nonWeightedMetrics = deriveNonWeightedTrackedExerciseMetrics(allSections, visibleTrackedNames);
  const oneK = derive1kTotalFromSectionsList(noteSectionsList || [], oneKSelections);
  const oneKSeries = derive1kTotalSeriesFromSectionsList(noteSectionsList || [], oneKSelections);

  return { signals, oneK, oneKSeries, nameDisplayMap, perDaySignals, nonWeightedMetrics };
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

import { getNoteSections } from '../../hooks/useEntries';
import {
  isStrengthExerciseName,
  deriveWorkoutNoteAnalytics,
  derive1kTotal,
  derive1kTotalSeries,
  deriveNonWeightedTrackedExerciseMetrics,
} from '../../lib/data';
import { normalizeExerciseKey } from '../../lib/parser';

export function deriveParsedSections(notes, currentNote) {
  const allSections = notes.flatMap(n => getNoteSections(n));
  const currentSections = getNoteSections(currentNote);
  return { allSections, currentSections };
}

export function deriveNoteExerciseNames(currentSections) {
  const names = currentSections.flatMap(s => s.exercises.map(e => e.name));
  return [...new Set(names)].filter(isStrengthExerciseName);
}

export function deriveAnalytics(parsedSections, trackedLifts, oneKSelections, multiplier) {
  const { allSections, currentSections } = parsedSections;

  const namesInCurrent = new Set(
    currentSections.flatMap(s => s.exercises.map(e => normalizeExerciseKey(e.name)))
  );
  const globallyTrackedNames = Object.keys(trackedLifts).filter(k => trackedLifts[k]);
  const visibleTrackedNames = globallyTrackedNames.filter(
    name => namesInCurrent.has(normalizeExerciseKey(name))
  );

  const { signals, nameDisplayMap, perDaySignals } = deriveWorkoutNoteAnalytics(allSections, visibleTrackedNames, multiplier);
  const nonWeightedMetrics = deriveNonWeightedTrackedExerciseMetrics(allSections, visibleTrackedNames);
  const oneK = derive1kTotal(allSections, oneKSelections);
  const oneKSeries = derive1kTotalSeries(allSections, oneKSelections);

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

export function deriveOneKChartData(oneKSeries) {
  return (oneKSeries || []).map(p => ({
    value: Math.round(p.total),
    label: `#${p.session}`,
    unit: 'lb',
    bench: p.bench,
    squat: p.squat,
    deadlift: p.deadlift,
  }));
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

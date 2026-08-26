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
import { filterNotesForNormalAnalytics } from '../../lib/data/recoveryAnalyticsFilter';
import { ACTIVE_TRAINING_STATUS } from '../../lib/data/activeTrainingContext';

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
export function deriveParsedSections(notes, currentNote, excludedNoteIds = null) {
  const normalNotes = filterNotesForNormalAnalytics(notes || [], excludedNoteIds);
  const noteSectionsList = normalNotes.map(n => getNoteSections(n));
  const allSections = noteSectionsList.flat();
  // Deload sessions are intentionally light (see DELOAD_NOTE_PREFIX). They must
  // not feed the progression/strength signal derivation — most visibly the
  // fatigue-adjusted Kilo Max, which flat-averages every set's Epley across all
  // occurrences (computeKiloMax), so a light deload session always biases it
  // downward. signalSections is the deload-excluded section list used for those
  // signals. The 1K series intentionally keeps deload as its own point (#396),
  // so noteSectionsList/allSections are left untouched.
  //
  // Deload exclusion composes with, and is independent of, the recovery filter:
  // it runs over the already-recovery-filtered list, so turning recovery
  // inclusion ON re-admits recovery notes only and never a deload note.
  const signalSections = normalNotes
    .filter(n => !n.title?.startsWith(DELOAD_NOTE_PREFIX))
    .flatMap(n => getNoteSections(n));
  const currentSections = getNoteSections(currentNote);
  return { allSections, signalSections, currentSections, noteSectionsList, normalNotes };
}

export function deriveNoteExerciseNames(currentSections) {
  const names = currentSections.flatMap(s => s.exercises.map(e => e.name));
  return [...new Set(names)].filter(isStrengthExerciseName);
}

// `activations` (#893) are the tracked-lift activation records. Threaded into
// both derivations below rather than resolved separately in each, so the
// weighted signals, the per-day signals and the non-weighted arrows on one card
// cannot disagree about where the tracked span starts.
export function deriveAnalytics(parsedSections, trackedLifts, oneKSelections, multiplier, activations = null) {
  const { allSections, currentSections, noteSectionsList } = parsedSections;
  // Fall back to allSections for legacy callers that don't supply signalSections.
  const signalSections = parsedSections.signalSections || allSections;

  const namesInCurrent = new Set(
    currentSections.flatMap(s => s.exercises.map(e => normalizeExerciseKey(e.name)))
  );
  const globallyTrackedNames = Object.keys(trackedLifts).filter(k => trackedLifts[k]);
  const visibleTrackedNames = globallyTrackedNames.filter(
    name => namesInCurrent.has(normalizeExerciseKey(name))
  );

  const { signals, nameDisplayMap, perDaySignals } = deriveWorkoutNoteAnalytics(signalSections, visibleTrackedNames, multiplier, activations);
  const nonWeightedMetrics = deriveNonWeightedTrackedExerciseMetrics(signalSections, visibleTrackedNames, activations);
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

// Overview rows (#821). Every value here is READ from a series or collection
// that already existed — nothing is recomputed and no formula changes. The only
// new arithmetic is a subtraction between two adjacent points of a series the
// tab already plots, which is what turns "here is a number" into "here is what
// changed".
//
// A row is `null` when its source cannot honestly report anything. The caller
// distinguishes three reasons so the block never prints "no data" over a failed
// read: `unavailable` (the source errored), `loading`, and an ordinary empty
// state carrying its own next action.
// NOTE ON UNITS: every numeric input is expected in DISPLAY space — the same
// arrays AnalyticsScreen already hands the charts (`oneKChartData`, `rolling7`)
// and a pre-converted current weight. Deltas are therefore subtractions between
// two values in the unit being shown, and this file never converts anything.
// Taking raw-lb values here and converting locally is how a kg-mode rounding
// bug gets reintroduced (#441).
export function deriveOverviewRows({
  oneKPoints = [],
  signals = [],
  sessionsSinceDeload = null,
  deloadModeEnabled = true,
  currentWeight = null,
  weightPoints = [],
  notesUnavailable = false,
  weightUnavailable = false,
  // Zero Friction F9 (#871): the shared "what am I training now?" context
  // (#868), same shape `useActiveTrainingContext` resolves for Home/Log. Only
  // `status`/`recoveryWeekNumber` are read here — this derives no new Recovery
  // formula and recomputes nothing, it only relabels which existing rows are
  // "live right now" vs "frozen baseline history" and leads with the former
  // during an active block.
  activeTraining = null,
} = {}) {
  const isRecoveryActive = activeTraining?.status === ACTIVE_TRAINING_STATUS.RECOVERY_OPEN_WEEK
    || activeTraining?.status === ACTIVE_TRAINING_STATUS.RECOVERY_BETWEEN_WEEKS;

  // 1K — latest total, and its change against the previous session in the
  // series. This is the same series the Strength chart plots, so the two can
  // never disagree.
  const oneK = (oneKPoints || []).filter(p => p && typeof p.value === 'number');
  const latestOneK = oneK.length > 0 ? oneK[oneK.length - 1] : null;
  const priorOneK = oneK.length > 1 ? oneK[oneK.length - 2] : null;
  // During active Recovery this is the same frozen baseline logic as Exercise
  // Progress/Routine below: the value itself is untouched (still the latest
  // real 1K total), but its "since your last session" delta is suppressed and
  // it is marked `paused` so the row never presents a frozen number as a fresh
  // live change (#871 review finding).
  const oneKRow = {
    key: 'oneK',
    label: '1K Total',
    section: 'strength',
    unavailable: notesUnavailable,
    value: latestOneK ? Math.round(latestOneK.value) : null,
    showUnit: true,
    delta: (!isRecoveryActive && latestOneK && priorOneK) ? Math.round(latestOneK.value - priorOneK.value) : null,
    deltaCaption: (!isRecoveryActive && latestOneK && priorOneK) ? 'since your last session' : null,
    emptyCaption: 'Map your three lifts and log one full cycle',
    paused: isRecoveryActive,
    pausedCaption: isRecoveryActive ? 'Baseline training paused during Recovery' : null,
  };

  // Exercise progress — the same overload_trend classification the table
  // itemises, counted. During active Recovery this reads the current routine
  // as it stood before the block paused it (#699 excludes recovery-linked
  // notes from this population already) — it is frozen baseline history, not
  // a fresh count, so it is marked `paused` rather than recomputed.
  const counts = { up: 0, flat: 0, down: 0 };
  for (const signal of signals || []) {
    if (signal?.overload_trend === 'up') counts.up += 1;
    else if (signal?.overload_trend === 'down') counts.down += 1;
    else if (signal?.overload_trend === 'flat') counts.flat += 1;
  }
  const classified = counts.up + counts.flat + counts.down;
  const progressRow = {
    key: 'progress',
    label: 'Exercise Progress',
    section: 'progressive-overload',
    unavailable: notesUnavailable,
    value: classified > 0 ? counts.up : null,
    valueSuffix: classified > 0 ? `of ${classified} up` : null,
    counts,
    emptyCaption: 'Tap Track on an exercise in your log',
    paused: isRecoveryActive,
    pausedCaption: isRecoveryActive ? 'Baseline training paused during Recovery' : null,
  };

  // Routine depth. Suppressed entirely when deload mode is off — the count only
  // means something against the deload zones, and #821 also stops SessionGauge
  // rendering that advisory in the same condition. Also suppressed here (as
  // `paused`, not hidden) during active Recovery: it is a baseline count that
  // has stopped accumulating, not fresh routine-health advice (#871).
  const routineRow = (deloadModeEnabled && sessionsSinceDeload != null) ? {
    key: 'routine',
    label: 'Routine',
    section: null,
    unavailable: false,
    value: sessionsSinceDeload,
    valueSuffix: sessionsSinceDeload === 1 ? 'session' : 'sessions',
    emptyCaption: null,
    paused: isRecoveryActive,
    pausedCaption: isRecoveryActive ? 'Baseline training paused during Recovery' : null,
  } : null;

  // Bodyweight — latest 7-day rolling average against the previous point of the
  // same series, so the delta is average-to-average rather than one noisy
  // weigh-in against another. Weight keeps updating during Recovery (#871
  // scope), so this row is never marked paused.
  const points = (weightPoints || []).filter(p => p && typeof p.value === 'number');
  const latestPoint = points.length > 0 ? points[points.length - 1] : null;
  const priorPoint = points.length > 1 ? points[points.length - 2] : null;
  const weightRow = {
    key: 'weight',
    label: 'Body Weight',
    section: 'weight',
    unavailable: weightUnavailable,
    value: currentWeight != null ? currentWeight : null,
    showUnit: true,
    decimals: 1,
    delta: latestPoint && priorPoint ? Number((latestPoint.value - priorPoint.value).toFixed(1)) : null,
    deltaCaption: latestPoint && priorPoint ? '7-day average' : null,
    emptyCaption: 'Log a weigh-in to start a trend',
  };

  if (!isRecoveryActive) {
    // Unchanged normal hierarchy (#871 acceptance: ending Recovery restores
    // this exact order).
    return [oneKRow, progressRow, routineRow, weightRow].filter(Boolean);
  }

  // Active Recovery: lead with the Recovery state itself, then current weight
  // — the two rows that answer something current right now — ahead of the
  // frozen baseline rows.
  // A value only prints for a genuinely open, in-progress week — the
  // BETWEEN_WEEKS status's `recoveryWeekNumber` names the latest COMPLETED
  // week, and showing it as this row's value would read as "week 1 is
  // current" when it is not; the between-weeks caption is the true current
  // answer instead.
  const isOpenWeek = activeTraining.status === ACTIVE_TRAINING_STATUS.RECOVERY_OPEN_WEEK;
  const recoveryRow = {
    key: 'recovery',
    label: 'Recovery',
    section: 'recovery',
    unavailable: false,
    value: isOpenWeek ? activeTraining.recoveryWeekNumber : null,
    showUnit: false,
    valueSuffix: isOpenWeek && activeTraining.recoveryWeekNumber != null ? 'week' : null,
    emptyCaption: !isOpenWeek
      ? 'Between weeks — add the next week or end Recovery'
      : null,
  };

  return [recoveryRow, weightRow, oneKRow, progressRow, routineRow].filter(Boolean);
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

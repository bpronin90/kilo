import { deriveWorkoutAnalytics, normalizeExerciseKey, deriveProgressionSignals, derivePerDaySignals } from '../parser.js';
import { classifyExerciseSessions, loggedSessionUnits } from '../parser/analytics.js';
import { normalizeLiftName, isStrengthExerciseName } from './exerciseCatalog.js';
import { computeWeeksIn } from './routineStatus.js';
import { deriveSkipData } from './skipData.js';
import { computeKiloMax, getKiloFatigueMultiplier } from './fatigue.js';
import { deriveProgressionSuggestions, isExerciseUnderActiveRecovery } from './progressionSuggestions.js';
import { deriveDeloadReentry } from '../parser/deloadHistory.js';
import { resolveTrackedLiftAnchors } from './workoutAnalyticsActivations.js';

// Wrap deriveProgressionSignals and replace kilo_max with the Epley-average x
// fatigue formula (adjusted, rounded).
export function deriveSignals(sections, trackedNames, multiplier = getKiloFatigueMultiplier(), anchors = null) {
  const { exercises: signals } = deriveProgressionSignals(sections, trackedNames, anchors);
  const { exercises: analyticsExercises } = deriveWorkoutAnalytics(sections);

  const byName = new Map(analyticsExercises.map(ex => [normalizeExerciseKey(ex.name), ex]));

  return {
    exercises: signals.map(sig => {
      const ex = byName.get(normalizeExerciseKey(sig.name));
      // #854/R3: kilo_max is a strength-specific aggregate — a cardio-named
      // exercise never gets one, matching the null deriveProgressionSignals
      // already returned for it above.
      if (!ex || !isStrengthExerciseName(ex.name)) return sig;
      const { kilo_max_adjusted } = computeKiloMax(ex.occurrences, multiplier);
      return { ...sig, kilo_max: kilo_max_adjusted };
    }),
  };
}

// ── Canonical workout analytics derivation layer ──────────────────────────────

// Derives the full set of shared workout analytics from parsed sections.
// This is the single canonical entry point for all workout analytics consumers.
//
// sections:      output of parseWorkoutNote(noteText).sections
// trackedNames:  string[] of exercise names to classify, track, and derive signals for
// multiplier:    optional fatigue multiplier for signal derivation (defaults to getKiloFatigueMultiplier())
// activations:   optional tracked-lift activation records (#893). Resolved to
//                anchors ONCE here and handed to every progression consumer, so
//                Home and Analytics cannot classify the same population against
//                different time boundaries. Omitted (or empty) means no
//                watermark anywhere: legacy full-history behavior, unchanged.
//
// Returns:
//   weeksIn:         session depth (routine depth) — max session_entries.length
//   classifications: { [normalizedName]: 'progressing'|'stalled'|'regressing'|'inconsistent'|null }
//   skipData:        { exercise_skips, day_skips, attendance_flags }
//   signals:         exercise[] — progression signals for trackedNames
//   nameDisplayMap:  Map<normalizedName, displayName> — last-seen user-typed casing
export function deriveWorkoutNoteAnalytics(sections, trackedNames, multiplier, activations = null, options = {}) {
  const _multiplier = multiplier !== undefined ? multiplier : getKiloFatigueMultiplier();
  if (!sections) {
    const emptyClassif = Object.fromEntries((trackedNames || []).map(n => [normalizeLiftName(n), null]));
    return {
      weeksIn: null,
      classifications: emptyClassif,
      skipData: { exercise_skips: [], day_skips: [], attendance_flags: [] },
      signals: [],
      nameDisplayMap: new Map(),
      perDaySignals: {},
      anchors: {},
      progressionSuggestions: [],
      reentry: {},
    };
  }
  const nameDisplayMap = new Map();
  sections.forEach(s => s.exercises.forEach(e => {
    nameDisplayMap.set(normalizeExerciseKey(e.name), e.name);
  }));
  const anchors = resolveTrackedLiftAnchors(sections, activations);
  const reentry = deriveDeloadReentry(sections, options.deloadHistory, options.sourceNoteId);
  const byKey = new Map(deriveWorkoutAnalytics(sections).exercises.map(ex => [normalizeExerciseKey(ex.name), ex]));
  for (const key of Object.keys(reentry)) {
    if (!(trackedNames || []).some(name => normalizeExerciseKey(name) === key)
      || isExerciseUnderActiveRecovery(key, options.recoveryBlocks)) delete reentry[key];
    // A newer tracking activation can exclude even this first return session.
    // Count its position in the normative (warmup-inclusive) anchor population.
    else if (anchors[key]) {
      const exercise = byKey.get(key);
      const units = loggedSessionUnits(exercise.occurrences);
      const lastWorkingIndex = units.reduce((last, entry, index) => entry.kind !== 'warmup' ? index : last, -1);
      if (anchors[key] > lastWorkingIndex) delete reentry[key];
    }
  }
  const progressionSuggestions = deriveProgressionSuggestions(sections, trackedNames || [], {
    anchors, recoveryBlocks: options.recoveryBlocks,
  }).map(suggestion => {
    const context = reentry[normalizeExerciseKey(suggestion.name)];
    if (!context) return suggestion;
    return {
      ...suggestion,
      kind: 're_entry', suggested: false, reason: 'post_deload_reentry',
      evidence: { ...suggestion.evidence, reentry: context },
      heuristic: null, explanation: context.explanation,
    };
  });
  return {
    weeksIn: computeWeeksIn(sections),
    classifications: classifyExerciseSessions(sections, trackedNames, anchors),
    skipData: deriveSkipData(sections),
    signals: deriveSignals(sections, trackedNames, _multiplier, anchors).exercises,
    nameDisplayMap,
    perDaySignals: derivePerDaySignals(sections, trackedNames, anchors),
    anchors,
    progressionSuggestions,
    reentry,
  };
}

// Count progressing/stalled/regressing rows exactly as the analytics panel renders.
// Iterates each exercise-per-section appearance; multi-day exercises contribute once
// per day using the per-day trend (falling back to global signal trend).
export function deriveOverloadCounts(sections, signals, perDaySignals) {
  const sigMap = new Map(
    signals.map(s => [normalizeExerciseKey(s.name), s])
  );
  const counts = { progressing: 0, stalled: 0, regressing: 0 };
  (sections || []).forEach(sec => {
    sec.exercises.forEach(ex => {
      const key = normalizeExerciseKey(ex.name);
      const sig = sigMap.get(key);
      if (!sig) return;
      const dayRow = perDaySignals?.[key]?.[sec.heading];
      const rowTrend = dayRow?.overload_trend ?? sig.overload_trend;
      if (rowTrend === 'up')   counts.progressing++;
      if (rowTrend === 'flat') counts.stalled++;
      if (rowTrend === 'down') counts.regressing++;
    });
  });
  return counts;
}

// ── Weekly Assessment Summary ────────────────────────────────────────────────

// #854/R5: `workoutNote.exercise_classifications` is a save-time cache, so an
// existing note can carry classifications derived under an older parser
// grammar until its next save. `liveClassifications`, when supplied, is a
// freshly derived value (same shape, same `deriveWorkoutNoteAnalytics` call
// the save path uses) that the caller recomputes on every render instead of
// trusting the persisted value — this makes the read side self-healing
// across a grammar change with no separate migration step. Omitted for
// backward compatibility with callers (and tests) that intentionally want
// the persisted value.
export function computeWeeklySummary(sections, workoutNote, liveClassifications) {
  // A session exists if there are any non-skipped entries or sets in the sections
  const hasActivity = (sections || []).some(section =>
    section.exercises.some(ex => {
      if ((ex.session_entries || []).length > 0) {
        return ex.session_entries.some(se => !se.skipped);
      }
      return (ex.sets || []).length > 0;
    })
  );

  // 1. Classification counts (tracked exercises only)
  let classifications = null;
  const sourceClassifs = liveClassifications || workoutNote?.exercise_classifications;

  if (sourceClassifs) {
    classifications = { progressing: 0, stalled: 0, regressing: 0, inconsistent: 0, initial: 0 };
    Object.values(sourceClassifs).forEach(val => {
      if (classifications[val] !== undefined) {
        classifications[val]++;
      }
    });
  }

  const DISPLAYABLE = new Set(['progressing', 'stalled', 'regressing']);
  let sessionStatusRows = null;
  if (sourceClassifs) {
    const rows = Object.entries(sourceClassifs)
      .filter(([, cls]) => DISPLAYABLE.has(cls))
      .map(([name, classification]) => ({ name, classification }));
    sessionStatusRows = rows.length > 0 ? rows : null;
  }

  if (!hasActivity) {
    return {
      hasActivity: false,
      sessionStatusRows,
    };
  }

  return {
    hasActivity: true,
    classifications,
    sessionStatusRows,
  };
}

// ── Check-in history ──────────────────────────────────────────────────────────

export function deriveCheckInHistory(notes) {
  const empty = { list: [], rough: [], ok: [], pending: [], summary: { roughTotal: 0, okTotal: 0, pendingTotal: 0, top_reason: null } };
  if (!notes || notes.length === 0) return empty;

  const list = [];
  for (const note of notes) {
    const checkins = note?.session_checkins;
    if (!checkins) continue;
    for (const [key, checkin] of Object.entries(checkins)) {
      if (!checkin || !checkin.responded_at) continue;
      list.push({
        noteId: note.id,
        sessionIndex: Number(key),
        responded_at: checkin.responded_at,
        status: checkin.status ?? null,
        reasons: checkin.reasons ?? [],
        note: checkin.note ?? null,
        exercises_skipped: checkin.exercises_skipped ?? 0,
        volume_decline_pct: checkin.volume_decline_pct ?? null,
        flagged: checkin.flagged ?? [],
        detectors: checkin.detectors ?? [],
      });
    }
  }

  list.sort((a, b) => (a.responded_at < b.responded_at ? 1 : a.responded_at > b.responded_at ? -1 : 0));

  const rough = list.filter(c => c.status === 'rough');
  const ok = list.filter(c => c.status === 'ok');
  const pending = list.filter(c => c.status == null);

  let top_reason = null;
  if (rough.length > 0) {
    const counts = new Map();
    for (const c of rough) {
      for (const r of c.reasons) {
        counts.set(r, (counts.get(r) ?? 0) + 1);
      }
    }
    let max = 0;
    for (const [reason, count] of counts) {
      if (count > max) { max = count; top_reason = reason; }
    }
  }

  return { list, rough, ok, pending, summary: { roughTotal: rough.length, okTotal: ok.length, pendingTotal: pending.length, top_reason } };
}

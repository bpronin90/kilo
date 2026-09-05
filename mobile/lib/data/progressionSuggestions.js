import { deriveWorkoutAnalytics, normalizeExerciseKey } from '../parser.js';
import { parseExerciseHeader } from '../parser/deloadGenerator.js';
import { deriveProgressionSignals, loggedSessionUnits, _occurrenceEntries } from '../parser/analytics.js';
import { classifyExerciseSessions } from './workoutAnalytics.js';
import { isBlockActive } from './recoveryBlocks.js';

// ── Progression suggestions (#958, stage 1 of #580) ───────────────────────────
//
// PURE derivation only. Nothing here reads storage, touches a note's
// `raw_text`, or renders a surface: it turns already-parsed sections into
// inspectable records and stops. Stage 2 (#959) wires these into the analytics
// derivation layer and stage 3 (#960) renders them; until then this module ships
// no visible behavior at all, which is why the settings toggle it pairs with
// (`loadProgressionSuggestionsEnabled`) defaults OFF.
//
// The contract every record keeps, per #580's approved rules:
//
//   evidence   — only what was actually logged (classification, compared
//                sessions, weights, reps, skips, kg provenance). Never a claim.
//   heuristic  — what the rule proposes to do with that evidence, or null when
//                nothing is proposed. Always separable from the evidence.
//   explanation— deterministic text built from the two above, in the exact
//                wording approved on #580. Conditional language only; no
//                medical, injury, or readiness claims anywhere.
//
// No rule invents a rep range: the range is always the user's own header
// declaration (`-Bench Press: 3x8-10`), read fresh on every derivation so a
// hand-edited header is authoritative immediately.

export const PROGRESSION_SUGGESTION_KINDS = Object.freeze({
  DOUBLE_PROGRESSION: 'double_progression',
  BODYWEIGHT_CEILING: 'bodyweight_ceiling',
  NONE: 'none',
});

export const PROGRESSION_SUGGESTION_REASONS = Object.freeze({
  READY: 'ready',
  BELOW_CEILING: 'below_ceiling',
  INSUFFICIENT_HISTORY: 'insufficient_history',
  NO_REP_RANGE: 'no_rep_range',
  RECOVERY_ACTIVE: 'recovery_active',
  NOT_COMPARABLE: 'not_comparable',
});

// Minimum non-skipped logged sessions before any comparison is possible.
export const MIN_SESSIONS_FOR_COMPARISON = 2;

const EN_DASH = '–';
const EM_DASH = '—';
const ARROW = '→';

function _formatWeight(value) {
  if (value == null) return null;
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function _range(repLo, repHi) {
  return `${repLo}${EN_DASH}${repHi}`;
}

// The plate increment heuristic is deliberately the SAME one the deload
// generator already uses (`_inferIncrement`): 2.5 when any logged weight is not
// a multiple of 5, else 5. Introducing a second increment scheme would let two
// Kilo surfaces disagree about the user's own equipment.
export function inferIncrement(sets) {
  for (const set of sets || []) {
    if (set && set.weight_value != null && (set.weight_value % 5) !== 0) return 2.5;
  }
  return 5;
}

function _findExercise(sections, name) {
  const key = normalizeExerciseKey(name);
  const { exercises } = deriveWorkoutAnalytics(sections || []);
  return exercises.find(ex => normalizeExerciseKey(ex.name) === key) || null;
}

// The user's own declaration is ground truth, and the most recent one wins: a
// mid-cycle edit from `3x8-10` to `3x6-8` is read on the very next derivation
// rather than argued with.
export function findDeclaredRepRange(sections, name) {
  const key = normalizeExerciseKey(name);
  let found = null;
  for (const section of sections || []) {
    for (const ex of section.exercises || []) {
      if (normalizeExerciseKey(ex.name) !== key) continue;
      const parsed = parseExerciseHeader(ex.raw_header);
      if (parsed) found = { ...parsed, raw_header: ex.raw_header };
    }
  }
  return found;
}

// Recovery owns its own lifecycle and its own reason field. While an active
// block covers an exercise, this module stays silent for it entirely rather
// than second-guessing that block with a progression opinion.
export function isExerciseUnderActiveRecovery(name, recoveryBlocks) {
  const key = normalizeExerciseKey(name);
  for (const block of recoveryBlocks || []) {
    if (!isBlockActive(block)) continue;
    const covered = block.baseline?.exercises || [];
    if (covered.some(row => row && row.key === key)) return true;
  }
  return false;
}

function _topWeight(sets) {
  const weighted = (sets || []).filter(
    s => s.weight_value != null && s.weight_value > 0 && s.rep_count != null && s.rep_count > 0
  );
  if (weighted.length === 0) return null;
  return Math.max(...weighted.map(s => s.weight_value));
}

function _setsAtWeight(sets, weight) {
  return (sets || []).filter(s => s.weight_value === weight && s.rep_count != null && s.rep_count > 0);
}

function _totalReps(sets) {
  return (sets || []).reduce((sum, s) => sum + (s.rep_count || 0), 0);
}

function _kgProvenance(sets, weight) {
  const marked = _setsAtWeight(sets, weight).find(s => s.converted_from_kg && s.kg_value != null);
  return marked ? { kg_value: marked.kg_value } : null;
}

function _record({ name, kind, suggested, reason, evidence, heuristic, explanation }) {
  return { name, kind, suggested, reason, evidence, heuristic, explanation };
}

function _emptyEvidence(extra = {}) {
  return {
    classification: null,
    progression_status: null,
    is_bodyweight: false,
    rep_range: null,
    sessions_compared: 0,
    skipped_sessions: 0,
    top_weight: null,
    latest_reps: [],
    prior_reps: [],
    kg_entry: null,
    ...extra,
  };
}

// Derive the progression-suggestion record for one exercise.
//
// `sections` is `parseWorkoutNote(text).sections`. Options:
//   recoveryBlocks — recovery block records; an active block covering this
//                    exercise suppresses every suggestion for it.
//   anchors        — tracked-span anchors, passed straight through to the
//                    existing classification/signal derivations (#893).
export function deriveProgressionSuggestion(sections, name, options = {}) {
  const { recoveryBlocks = null, anchors = null } = options;

  if (isExerciseUnderActiveRecovery(name, recoveryBlocks)) {
    return _record({
      name,
      kind: PROGRESSION_SUGGESTION_KINDS.NONE,
      suggested: false,
      reason: PROGRESSION_SUGGESTION_REASONS.RECOVERY_ACTIVE,
      evidence: _emptyEvidence(),
      heuristic: null,
      explanation:
        `This exercise is inside an active Recovery block ${EM_DASH} Kilo doesn't suggest progression while Recovery is active.`,
    });
  }

  const range = findDeclaredRepRange(sections, name);
  if (!range) {
    return _record({
      name,
      kind: PROGRESSION_SUGGESTION_KINDS.NONE,
      suggested: false,
      reason: PROGRESSION_SUGGESTION_REASONS.NO_REP_RANGE,
      evidence: _emptyEvidence(),
      heuristic: null,
      explanation:
        `No rep-range target declared for this exercise (e.g. "3x8-10") ${EM_DASH} add one to get double-progression suggestions.`,
    });
  }

  const { repLo, repHi } = range;
  const rep_range = { lo: repLo, hi: repHi, sets: range.sets };

  const exercise = _findExercise(sections, name);
  const occurrences = exercise ? exercise.occurrences : [];
  const logged = loggedSessionUnits(occurrences);
  const skipped_sessions = occurrences
    .flatMap(occ => _occurrenceEntries(occ))
    .filter(entry => entry && entry.skipped).length;

  const insufficient = _record({
    name,
    kind: PROGRESSION_SUGGESTION_KINDS.NONE,
    suggested: false,
    reason: PROGRESSION_SUGGESTION_REASONS.INSUFFICIENT_HISTORY,
    evidence: _emptyEvidence({ rep_range, sessions_compared: logged.length, skipped_sessions }),
    heuristic: null,
    explanation:
      `Not enough logged history yet ${EM_DASH} need at least ${MIN_SESSIONS_FOR_COMPARISON} non-skipped sessions to compare.`,
  });
  if (logged.length < MIN_SESSIONS_FOR_COMPARISON) return insufficient;

  const classifications = classifyExerciseSessions(sections, [name], anchors);
  const classification = Object.values(classifications)[0] ?? null;
  const signal = deriveProgressionSignals(sections, [name], anchors).exercises[0];

  const latest = logged[logged.length - 1];
  const prior = logged[logged.length - 2];
  const latestTop = _topWeight(latest.sets);
  const priorTop = _topWeight(prior.sets);

  // ── Bodyweight ceiling ─────────────────────────────────────────────────────
  //
  // A bodyweight session has no weight column at all, so the weighted
  // classification path (`_classifyEntries` → `_topWeight`) drops it and returns
  // null. The real signal is `deriveProgressionSignals`' bodyweight branch,
  // whose `latest_top_weight` field holds the latest session's BEST REP COUNT,
  // not a weight (#580, confirmed against real parser output).
  if (signal && signal.is_bodyweight) {
    const latestReps = (latest.sets || []).map(s => s.rep_count || 0);
    const priorReps = (prior.sets || []).map(s => s.rep_count || 0);
    const bestReps = signal.latest_top_weight;
    const evidence = _emptyEvidence({
      classification,
      progression_status: signal.progression_status,
      is_bodyweight: true,
      rep_range,
      sessions_compared: MIN_SESSIONS_FOR_COMPARISON,
      skipped_sessions,
      latest_reps: latestReps,
      prior_reps: priorReps,
      latest_best_reps: bestReps,
    });

    const atCeiling =
      signal.progression_status === 'held' && bestReps != null && bestReps >= repHi;
    if (!atCeiling) {
      return _record({
        name,
        kind: PROGRESSION_SUGGESTION_KINDS.NONE,
        suggested: false,
        reason: PROGRESSION_SUGGESTION_REASONS.BELOW_CEILING,
        evidence,
        heuristic: null,
        explanation:
          `Your last ${MIN_SESSIONS_FOR_COMPARISON} logged sessions haven't held the top of your ${_range(repLo, repHi)} rep target yet ${EM_DASH} no change suggested.`,
      });
    }

    return _record({
      name,
      kind: PROGRESSION_SUGGESTION_KINDS.BODYWEIGHT_CEILING,
      suggested: true,
      reason: PROGRESSION_SUGGESTION_REASONS.READY,
      evidence,
      heuristic: {
        action: 'add_reps',
        suggested_weight: null,
        suggested_reps: null,
        increment: null,
        unit: null,
      },
      explanation:
        `Your last ${MIN_SESSIONS_FOR_COMPARISON} sessions both hit ${latestReps.length}x${bestReps} ${EM_DASH} the top of your ${_range(repLo, repHi)} rep target. Kilo won't suggest a weight for a bodyweight movement ${EM_DASH} consider more reps past ${repHi}, a slower tempo, or a harder variation.`,
    });
  }

  if (latestTop == null || priorTop == null) {
    return _record({
      name,
      kind: PROGRESSION_SUGGESTION_KINDS.NONE,
      suggested: false,
      reason: PROGRESSION_SUGGESTION_REASONS.NOT_COMPARABLE,
      evidence: _emptyEvidence({
        classification,
        progression_status: signal ? signal.progression_status : null,
        rep_range,
        sessions_compared: MIN_SESSIONS_FOR_COMPARISON,
        skipped_sessions,
      }),
      heuristic: null,
      explanation:
        `Your last ${MIN_SESSIONS_FOR_COMPARISON} logged sessions can't be compared at the same weight ${EM_DASH} no change suggested.`,
    });
  }

  const latestAtTop = _setsAtWeight(latest.sets, latestTop);
  const priorAtTop = _setsAtWeight(prior.sets, priorTop);
  const latest_reps = latestAtTop.map(s => s.rep_count);
  const prior_reps = priorAtTop.map(s => s.rep_count);
  // The kg marker never gates a comparison: `kgMarkerToLb` already resolved the
  // set to the same canonical lb value a bare entry would carry. It is surfaced
  // only so the user can cross-check the sentence against what they typed.
  const kgLatest = _kgProvenance(latest.sets, latestTop);
  const kgPrior = _kgProvenance(prior.sets, priorTop);

  const evidence = _emptyEvidence({
    classification,
    progression_status: signal ? signal.progression_status : null,
    is_bodyweight: false,
    rep_range,
    sessions_compared: MIN_SESSIONS_FOR_COMPARISON,
    skipped_sessions,
    top_weight: latestTop,
    prior_top_weight: priorTop,
    latest_reps,
    prior_reps,
    kg_entry: kgLatest
      ? { side: 'latest', kg_value: kgLatest.kg_value }
      : kgPrior
        ? { side: 'prior', kg_value: kgPrior.kg_value }
        : null,
  });

  const atCeiling =
    classification === 'stalled' &&
    latestTop === priorTop &&
    latest_reps.length > 0 &&
    prior_reps.length > 0 &&
    Math.min(...latest_reps) >= repHi &&
    Math.min(...prior_reps) >= repHi;

  if (!atCeiling) {
    const sameWeight = latestTop === priorTop;
    const explanation =
      classification === 'progressing' && sameWeight
        ? `You added a rep since last time (${_totalReps(prior.sets)}${ARROW}${_totalReps(latest.sets)} reps @ ${_formatWeight(latestTop)} lb) but haven't hit the top of your ${_range(repLo, repHi)} target yet ${EM_DASH} no change suggested.`
        : `Your last ${MIN_SESSIONS_FOR_COMPARISON} logged sessions haven't hit the top of your ${_range(repLo, repHi)} target at the same weight yet ${EM_DASH} no change suggested.`;
    return _record({
      name,
      kind: PROGRESSION_SUGGESTION_KINDS.NONE,
      suggested: false,
      reason: PROGRESSION_SUGGESTION_REASONS.BELOW_CEILING,
      evidence,
      heuristic: null,
      explanation,
    });
  }

  const increment = inferIncrement(exercise ? exercise.sets : []);
  const suggested_weight = latestTop + increment;
  const setCount = latest_reps.length;
  const repsHit = Math.min(...latest_reps);
  const kgNote = evidence.kg_entry
    ? evidence.kg_entry.side === 'latest'
      ? ` (entered as ${evidence.kg_entry.kg_value}kg)`
      : ` (entered as ${evidence.kg_entry.kg_value}kg last time)`
    : '';
  const skipNote = skipped_sessions > 0 ? `Skipped weeks aren't counted ${EM_DASH} comparing your last ${MIN_SESSIONS_FOR_COMPARISON} logged sessions only. ` : '';

  return _record({
    name,
    kind: PROGRESSION_SUGGESTION_KINDS.DOUBLE_PROGRESSION,
    suggested: true,
    reason: PROGRESSION_SUGGESTION_REASONS.READY,
    evidence,
    heuristic: {
      action: 'increase_weight',
      suggested_weight,
      suggested_reps: repLo,
      suggested_sets: setCount,
      increment,
      unit: 'lb',
    },
    explanation:
      `${skipNote}Your last ${MIN_SESSIONS_FOR_COMPARISON} logged sessions both hit ${setCount}x${repsHit} at ${_formatWeight(latestTop)} lb${kgNote} ${EM_DASH} the top of your ${_range(repLo, repHi)} rep target. Consider ${_formatWeight(suggested_weight)} lb for ${setCount}x${repLo} next time.`,
  });
}

export function deriveProgressionSuggestions(sections, names, options = {}) {
  const unique = [...new Set(names || [])];
  return unique.map(name => deriveProgressionSuggestion(sections, name, options));
}

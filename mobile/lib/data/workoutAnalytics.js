import { deriveWorkoutAnalytics, normalizeExerciseKey, deriveProgressionSignals, derivePerDaySignals } from '../parser.js';
// #893: imported from the parser module directly rather than through the
// compatibility barrel — these are the watermark primitives, and the barrel is
// the public parser surface, not an internal one.
import {
  _occurrenceEntries,
  loggedSessionUnits,
  sliceEntriesFromAnchor,
} from '../parser/analytics.js';
import { normalizeLiftName, isStrengthExerciseName } from './exerciseCatalog.js';
import { computeWeeksIn } from './routineStatus.js';
import { deriveSkipData } from './skipData.js';
import { computeKiloMax, getKiloFatigueMultiplier } from './fatigue.js';

// ── Tracked-span activation records (#893 / F12a contract revision 3) ────────
//
// A Track activation is explicit and manual; nothing here infers one. What it
// persists beside the unchanged `tracked_lifts` boolean map is a sibling record
// per canonical key:
//
//   { anchor: <logged-session count at the false->true toggle>,
//     at:     <ISO-8601 activation instant — display/debug/tie-break only>,
//     witness: { headings: [...sorted distinct headings...],
//                sessions: "<first min(anchor,10) logged sessions>" } | null }
//
// The record is a VERIFICATION TOKEN, not an identity. Identity is the canonical
// name key and nothing else. The witness cannot make identity absolute — within
// the current note grammar nothing can tell "renamed" from "substituted" once
// the original is gone — so its job is to RETIRE a watermark that no longer
// plainly belongs to the movement holding the key, never to reassign one. The
// residual (a same-save substitution whose opening history and headings are
// byte-identical) is accepted and bounded: the boundary always lands inside the
// substitute's own history, no cross-movement comparison is possible, capability
// metrics are untouched, and the next untrack/retrack clears it.
export const TRACKED_LIFT_WITNESS_SESSIONS = 10;

function _witnessHeadings(occurrences) {
  return [...new Set((occurrences || []).map(o => o.heading ?? null))].sort();
}

// Canonical, literal, byte-comparable. Built from `sets` rather than raw text:
// _occurrenceEntries synthesizes entries with no `.raw` on its rows-only and
// sets-only fallbacks, so a text witness would be silently unverifiable for some
// movements.
function _witnessSessions(units) {
  return units
    .map(u => JSON.stringify((u.sets || []).map(s => [
      s.set_index ?? null,
      s.rep_count ?? null,
      s.weight_value ?? null,
      s.weight_unit ?? null,
    ])))
    .join('|');
}

function _sameHeadings(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

// Mint the record for a false->true toggle on `name`, against the sections the
// user was looking at. `anchor` 0 (a movement with no logged history yet) is
// identity-neutral: it means "count from this movement's own first session",
// which is what a fresh activation on ANY movement produces, so nothing wrong
// can be inherited and no witness is needed.
export function buildTrackedLiftActivation(sections, name, now = new Date()) {
  const { exercises } = deriveWorkoutAnalytics(sections || []);
  const key = normalizeExerciseKey(name);
  const ex = exercises.find(e => normalizeExerciseKey(e.name) === key) || null;
  const occurrences = ex ? ex.occurrences : [];
  const units = loggedSessionUnits(occurrences);
  const anchor = units.length;
  return {
    anchor,
    at: now.toISOString(),
    witness: anchor === 0 ? null : {
      headings: _witnessHeadings(occurrences),
      sessions: _witnessSessions(units.slice(0, TRACKED_LIFT_WITNESS_SESSIONS)),
    },
  };
}

// Verify one record against the movement currently holding its key.
// Returns { live, anchor }: `live` false means RETIRE (the caller decides
// whether that is a write or just this render's behavior); `anchor` is the
// stale-anchor-clamped boundary to use when live.
function _verifyActivation(ex, record) {
  const raw = record && Number.isInteger(record.anchor) && record.anchor > 0 ? record.anchor : 0;
  // Identity-neutral. Note there is nothing to fill in later either: a witness
  // protects the EXCLUDED prefix, and an anchor of 0 excludes nothing.
  if (raw === 0) return { live: true, anchor: 0 };
  if (!record.witness || typeof record.witness !== 'object') return { live: false, anchor: 0 };

  // Headings first — this is what separates two accessories that both opened
  // `3x10` but sit on different days. Not durable (moving a movement to another
  // day retires its binding), but that failure is a retire, not a wrong attach.
  if (!_sameHeadings(record.witness.headings, _witnessHeadings(ex.occurrences))) {
    return { live: false, anchor: 0 };
  }

  const units = loggedSessionUnits(ex.occurrences);
  // Compare only the prefix both sides can supply. A movement whose session
  // count FELL (a deleted past column) must reach the clamp below rather than
  // being retired for a length mismatch it did not cause; a movement whose
  // opening history DIFFERS still fails here, on content.
  const have = Math.min(raw, TRACKED_LIFT_WITNESS_SESSIONS, units.length);
  const stored = String(record.witness.sessions || '').split('|').slice(0, have).join('|');
  if (stored !== _witnessSessions(units.slice(0, have))) return { live: false, anchor: 0 };

  // Stale-anchor clamp: a live verified record whose count fell.
  return { live: true, anchor: Math.min(raw, units.length) };
}

// At most one live record per canonical key. Two keys collapsing onto one —
// reachable through alias-table growth or a sync merge — keep the LATEST `at`,
// because the later activation yields the narrower span: a merge can never widen
// a trend back across a span the user did not choose.
function _dedupeByCanonicalKey(activations) {
  const winners = new Map();
  for (const [rawKey, record] of Object.entries(activations || {})) {
    if (!record || typeof record !== 'object') continue;
    const key = normalizeExerciseKey(rawKey);
    const prior = winners.get(key);
    if (!prior) { winners.set(key, { rawKey, record }); continue; }
    const priorAt = Date.parse(prior.record.at ?? '') || 0;
    const thisAt = Date.parse(record.at ?? '') || 0;
    if (thisAt >= priorAt) winners.set(key, { rawKey, record });
  }
  return winners;
}

// READ side. Pure: resolves the boundary every progression consumer applies on
// this render, and writes nothing.
//
// It deliberately does NOT verify the witness. Verification is a retirement
// decision, and retirement is a write that belongs to the note-save boundary
// alone (see reconcileTrackedLiftActivations below) — for two reasons that both
// point the same way. Render paths stay pure, so lazy evaluation is the
// conservative direction: a movement substituted by an import or a sync is
// simply unobserved until the next save, and §5 already bounds what that costs.
// And render populations are NARROWER than the save boundary's — Analytics
// excludes deload notes, both surfaces exclude recovery weeks whose block opts
// out — so a witness minted over the whole notebook would legitimately fail to
// match here, and verifying would retire a perfectly good watermark over a
// population difference rather than an identity change.
//
// What does apply here is the stale-anchor clamp, and only in memory. A
// consumer whose population holds fewer sessions than the anchor sees an empty
// tracked span and reads `First session` until its own count catches up; the
// stored anchor is untouched, so nothing is lost when it does.
export function resolveTrackedLiftAnchors(sections, activations) {
  const winners = _dedupeByCanonicalKey(activations);
  if (winners.size === 0) return {};
  const { exercises } = deriveWorkoutAnalytics(sections || []);
  const byKey = new Map(exercises.map(ex => [normalizeExerciseKey(ex.name), ex]));
  const anchors = {};
  for (const [key, { record }] of winners) {
    const ex = byKey.get(key);
    if (!ex) continue;
    const raw = Number.isInteger(record.anchor) && record.anchor > 0 ? record.anchor : 0;
    if (raw === 0) continue;
    anchors[key] = Math.min(raw, loggedSessionUnits(ex.occurrences).length);
  }
  return anchors;
}

// WRITE side, for the note-save boundary only. Retires records whose key stopped
// resolving or whose witness no longer matches, canonicalizes keys, collapses
// duplicates, and persists the stale-anchor repair — which MUST persist, or the
// movement re-clamps on every render and shows `First session` forever.
//
// Retirement deletes the record and leaves the Track flag alone. Clearing a flag
// on absence is rejected as destructive: a movement out of the routine for a
// deload, an injury, or a routine switch is still tracked, and auto-untracking
// would destroy the explicit intent the flag exists to carry. A retired record
// simply falls back to legacy full-history behavior.
//
// `sections` MUST be the unfiltered note population. A movement appearing only
// in a recovery-excluded week is present, not absent, and must never be retired
// for sitting outside the ordinary-analytics boundary.
export function reconcileTrackedLiftActivations(sections, activations) {
  const winners = _dedupeByCanonicalKey(activations);
  const original = activations || {};
  if (winners.size === 0) {
    return { next: {}, changed: Object.keys(original).length > 0 };
  }
  const { exercises } = deriveWorkoutAnalytics(sections || []);
  const byKey = new Map(exercises.map(ex => [normalizeExerciseKey(ex.name), ex]));

  const next = {};
  let changed = winners.size !== Object.keys(original).length;
  for (const [key, { rawKey, record }] of winners) {
    const ex = byKey.get(key);
    if (!ex) { changed = true; continue; }
    const { live, anchor } = _verifyActivation(ex, record);
    if (!live) { changed = true; continue; }
    if (key !== rawKey || anchor !== (record.anchor ?? 0)) changed = true;
    next[key] = anchor === record.anchor ? record : { ...record, anchor };
  }
  return { next, changed };
}

// ── Per-exercise session classification ───────────────────────────────────────

function _totalRepsAtWeight(sets, weight) {
  return sets.filter(s => s.weight_value === weight).reduce((sum, s) => sum + s.rep_count, 0);
}

// #893: the implementation moved down into lib/parser/analytics.js so the
// tracked-span watermark can count exactly the units the signal builders
// consume. Re-exported here unchanged — oneK, recoveryBlocks, recoveryAnalytics
// and nonWeightedMetrics still import it from this module.
export { _occurrenceEntries };

function _topWeight(sets) {
  const weighted = sets.filter(s => s.weight_value != null && s.weight_value > 0 && s.rep_count != null && s.rep_count > 0);
  if (weighted.length === 0) return null;
  return Math.max(...weighted.map(s => s.weight_value));
}

// Classify one exercise given its full session_entries list (newest last).
// Returns 'progressing' | 'stalled' | 'regressing' | 'inconsistent' | null
function _classifyEntries(allEntries) {
  const window = allEntries.slice(-3);
  const logged = window.filter(se => !se.skipped && !se.unparsed && se.sets && _topWeight(se.sets) !== null);
  if (logged.length === 0) return null;
  if (logged.length === 1) {
    return window.some(se => se.skipped) ? 'inconsistent' : 'initial';
  }

  const latest = logged[logged.length - 1];
  const prior = logged[logged.length - 2];
  const latestTop = _topWeight(latest.sets);
  const priorTop = _topWeight(prior.sets);

  if (latestTop < priorTop) return 'regressing';
  if (latestTop > priorTop) return 'progressing';

  // Same top weight: compare total reps at top weight
  const latestTotal = _totalRepsAtWeight(latest.sets, latestTop);
  const priorTotal = _totalRepsAtWeight(prior.sets, priorTop);
  if (latestTotal > priorTotal) return 'progressing';
  if (latestTotal < priorTotal) return 'regressing';

  // Same top weight and same total reps: check distribution
  const latestReps = latest.sets.filter(s => s.weight_value === latestTop).map(s => s.rep_count).sort((a, b) => a - b);
  const priorReps = prior.sets.filter(s => s.weight_value === priorTop).map(s => s.rep_count).sort((a, b) => a - b);
  if (JSON.stringify(latestReps) === JSON.stringify(priorReps)) return 'stalled';

  return null;
}

// Classify session trends for all tracked exercises.
// sections: output of parseWorkoutNote(noteText).sections
// trackedNames: string[] of exercise names to classify
// anchors: optional { [canonicalKey]: anchor } from resolveTrackedLiftAnchors
// Returns { [normalizedName]: 'progressing'|'stalled'|'regressing'|'inconsistent'|null }
export function classifyExerciseSessions(sections, trackedNames, anchors = null) {
  const { exercises } = deriveWorkoutAnalytics(sections);
  const byKey = new Map(exercises.map(ex => [normalizeExerciseKey(ex.name), ex]));
  const result = {};
  for (const name of trackedNames) {
    const normName = normalizeLiftName(name);
    const key = normalizeExerciseKey(name);
    const ex = byKey.get(key);
    if (!ex) { result[normName] = null; continue; }
    // #854/R3: progressing/stalled/regressing is a strength-specific
    // signal — a cardio-named exercise never gets one, and a warmup-kind
    // entry never contributes to it, without discarding the exercise's
    // underlying occurrence data (other consumers still read it intact).
    //
    // #893: the watermark cut runs on the UNFILTERED entry list, before the
    // warmup filter, because the anchor counts positions in that list. It is a
    // classification — a progression signal — so it obeys the watermark; the
    // capability metrics elsewhere on the same card do not.
    const anchor = anchors?.[key] ?? 0;
    const allEntries = isStrengthExerciseName(ex.name)
      ? sliceEntriesFromAnchor(ex.occurrences.flatMap(occ => _occurrenceEntries(occ)), anchor)
          .filter(e => e.kind !== 'warmup')
      : [];
    const classification = _classifyEntries(allEntries);
    result[normName] = classification;
  }
  return result;
}

// ── Rep drop-off flag ─────────────────────────────────────────────────────────

// Compute the intra-session rep drop-off flag for one session's sets.
// Uses working sets (weight_value > 0, rep_count > 0) only.
// Mixed-weight: uses the heaviest-weight sets to compute first/last reps.
// Returns 'hit_wall' | null.
export function computeRepDropOff(sets) {
  const working = (sets || []).filter(s => s.weight_value > 0 && s.rep_count > 0);
  if (working.length < 2) return null;
  const maxWeight = Math.max(...working.map(s => s.weight_value));
  const atMax = working.filter(s => s.weight_value === maxWeight);
  if (atMax.length < 2) return null; // only 1 set at heaviest weight → ambiguous
  const dropOff = atMax[0].rep_count - atMax[atMax.length - 1].rep_count;
  if (dropOff >= 2) return 'hit_wall';
  return null;
}

// Derive rep drop-off flags for all tracked exercises, per session.
// Returns { [normalizedName]: { [sessionIndex]: 'hit_wall' | null } }
// Only logged (non-skipped) sessions are included; skipped sessions are omitted.
// sessionIndex is the positional index in the exercise's full entry history (oldest = 0).
export function deriveRepDropOffFlags(sections, trackedNames) {
  const { exercises } = deriveWorkoutAnalytics(sections);
  const byKey = new Map(exercises.map(ex => [normalizeExerciseKey(ex.name), ex]));
  const result = {};
  for (const name of trackedNames) {
    const normName = normalizeLiftName(name);
    const key = normalizeExerciseKey(name);
    const ex = byKey.get(key);
    if (!ex) { result[normName] = {}; continue; }
    // #854/R3: allEntries stays the exercise's FULL entry history (positional
    // indices below are matched elsewhere by that same position) — only the
    // flag computation is gated, so a cardio-named exercise or a warmup-kind
    // entry contributes no drop-off flag without shifting any other index.
    const strengthEligible = isStrengthExerciseName(ex.name);
    const allEntries = ex.occurrences.flatMap(occ => _occurrenceEntries(occ));
    const sessionFlags = {};
    allEntries.forEach((entry, idx) => {
      if (strengthEligible && entry.kind !== 'warmup' && !entry.skipped && !entry.unparsed && entry.sets && entry.sets.length > 0) {
        sessionFlags[String(idx)] = computeRepDropOff(entry.sets);
      }
    });
    result[normName] = sessionFlags;
  }
  return result;
}

// ── Session check-in detection ────────────────────────────────────────────────
//
// Decides whether the latest logged session is worth *asking* the user about.
// Kilo asks about the shape of the work; it never infers a bodily state, and a
// silent outcome is always valid. Per the D10 trigger contract (#747) there are
// exactly TWO triggers and two signals that can never open a prompt:
//
//   - volume_drop [TRIGGER]  reps collapsed >REP_DROP_THRESHOLD on
//                  ≥MIN_COLLAPSED_SETS sets at the latest entry's OWN top
//                  weight, versus the most recent prior entry that used that
//                  same weight (a within-row skipped set, rep_count 0, counts
//                  as a full collapse). Requires ≥MIN_PRIOR_ENTRIES prior
//                  logged entries for that exercise — one observation is not a
//                  baseline. Sets below the top weight are never scored, so a
//                  deliberate back-off session does not read as a decline, and
//                  because the baseline is looked up at that same top weight,
//                  adding load can never fire it.
//   - skipped [TRIGGER, narrowed]  more exercises skipped at the latest column
//                  than the rounded per-column MEAN of the prior columns plus
//                  SKIP_MARGIN, with an absolute SKIP_FLOOR, at least two prior
//                  columns, and at least one non-skipped logged tracked entry
//                  at the latest column. That last requirement is what keeps
//                  this rule meaning "attended and cut it short" rather than
//                  "did not train".
//   - collapse [reason only]  reps fell apart within the latest session
//                  (computeRepDropOff). Corroborating evidence only: straight
//                  sets taken toward failure are numerically identical to a
//                  session that fell apart, so this never opens a prompt alone.
//   - day_skip [neither]  a whole skipped column is the user stating that
//                  nothing happened. Kilo takes that at its word: it is neither
//                  a trigger nor a reason and never appears in `detectors`.
//                  deriveSkipData still produces day_skips and the
//                  repeated_weekday_skip attendance flag for the non-modal
//                  Analytics surfaces.
//
// `isRough` is true only when a TRIGGER fired — not merely when a reason exists.
//
// The latest session is the deepest column, lastIdx = computeWeeksIn(sections) - 1,
// matching the suppression key used by the persistence layer. Multi-day routines
// share the existing positional-alignment limitation (see classifyExerciseSessions).
// Pure; operates on parsed sections. Returns:
//   { sessionIndex, isRough, detectors: string[],
//     flagged: [{ normName, name, reasons: ('skip'|'volume_drop'|'collapse')[] }],
//     metrics: { exercises_skipped: number, volume_decline_pct: number|null } }
export const SESSION_CHECKIN_REP_DROP_THRESHOLD = 2; // reps lost vs baseline to call a set "collapsed"
export const SESSION_CHECKIN_MIN_COLLAPSED_SETS = 2; // collapsed sets needed to flag a volume drop
export const SESSION_CHECKIN_MIN_PRIOR_ENTRIES = 2;  // prior logged entries needed before a volume drop can be judged
export const SESSION_CHECKIN_SKIP_FLOOR = 2;         // min skipped exercises before a skip trigger fires
export const SESSION_CHECKIN_SKIP_MARGIN = 1;        // skips above the historical average to count as "more than usual"
export const SESSION_CHECKIN_MIN_SKIP_COLUMNS = 2;   // prior columns needed before a mean skip baseline means anything

// The only detectors that may open a prompt. `collapse` is corroboration and
// `day_skip` is not produced at all.
const SESSION_CHECKIN_TRIGGERS = ['volume_drop', 'skipped'];

function _checkinTonnage(sets) {
  return (sets || []).reduce(
    (sum, s) => (s.weight_value > 0 && s.rep_count > 0 ? sum + s.weight_value * s.rep_count : sum),
    0
  );
}

// Best (max) reps recorded at a given working weight within one entry's sets.
function _maxRepsAtWeight(sets, weight) {
  let max = 0;
  for (const s of sets || []) {
    if (s.weight_value === weight && s.rep_count > max) max = s.rep_count;
  }
  return max;
}

export function deriveSessionCheckIn(sections, trackedNames) {
  const empty = {
    sessionIndex: null,
    isRough: false,
    detectors: [],
    flagged: [],
    metrics: { exercises_skipped: 0, volume_decline_pct: null },
  };
  if (!sections || !trackedNames || trackedNames.length === 0) return empty;

  // Latest session index per the contract: the routine's deepest session column.
  const sessionIndex = computeWeeksIn(sections) - 1;
  if (sessionIndex < 0) return empty;

  const { exercises } = deriveWorkoutAnalytics(sections);
  const byKey = new Map(exercises.map(ex => [normalizeExerciseKey(ex.name), ex]));

  // Build the positional entry history for each tracked exercise that exists.
  const assessments = [];
  for (const name of trackedNames) {
    const ex = byKey.get(normalizeExerciseKey(name));
    if (!ex) continue;
    const allEntries = ex.occurrences.flatMap(occ => _occurrenceEntries(occ));
    if (allEntries.length === 0) continue;
    assessments.push({ normName: normalizeLiftName(name), name: ex.name, allEntries });
  }
  if (assessments.length === 0) return empty;

  // ── Skip trigger, via deriveSkipData ──
  // Fires only for a PARTIAL skip inside an attended session: more exercises
  // skipped at the latest column than this user's own per-column mean, by a
  // margin, above a floor, with enough history for a mean to mean anything, and
  // with real logged work still present at that column. A whole-column absence
  // is a declaration, not evidence, and is never a trigger or a reason.
  const skipData = deriveSkipData(sections);
  const skipByIndex = {};
  for (const s of skipData.exercise_skips) {
    skipByIndex[s.session_index] = (skipByIndex[s.session_index] || 0) + 1;
  }
  const latestSkipCount = skipByIndex[sessionIndex] || 0;
  // Rounded arithmetic MEAN of prior columns, matching what this contract has
  // always claimed. A minimum would let one clean column pin the baseline at 0
  // forever, so a user whose honest normal is two skips would be asked every
  // single session and the rule could never learn their "usual".
  let baselineSkips = 0;
  if (sessionIndex > 0) {
    let total = 0;
    for (let i = 0; i < sessionIndex; i++) total += skipByIndex[i] || 0;
    baselineSkips = Math.round(total / sessionIndex);
  }
  // Attendance: at least one tracked exercise logged real, parseable work at the
  // latest column. Without this, "more skipped than usual" would fire on a day
  // the user simply did not train.
  const attendedLatest = assessments.some(a => {
    const e = a.allEntries[sessionIndex];
    return !!e && !e.skipped && !e.unparsed && !!e.sets && e.sets.length > 0;
  });
  const skipFired = sessionIndex >= SESSION_CHECKIN_MIN_SKIP_COLUMNS
    && attendedLatest
    && latestSkipCount >= SESSION_CHECKIN_SKIP_FLOOR
    && latestSkipCount > baselineSkips + SESSION_CHECKIN_SKIP_MARGIN;

  // ── Per-exercise volume_drop / collapse on the latest entry ──
  const detectorSet = new Set();
  const flaggedMap = new Map(); // normName -> { normName, name, reasons:Set }
  let sumBaseTon = 0;
  let sumLatestTon = 0;
  let anyVolumeDrop = false;

  const addReason = (a, reason) => {
    if (!flaggedMap.has(a.normName)) flaggedMap.set(a.normName, { normName: a.normName, name: a.name, reasons: new Set() });
    flaggedMap.get(a.normName).reasons.add(reason);
  };

  for (const a of assessments) {
    const latest = a.allEntries[sessionIndex];
    if (!latest) continue; // exercise shorter than the latest column — not part of this session
    const priorLogged = a.allEntries
      .slice(0, sessionIndex)
      .filter(e => !e.skipped && !e.unparsed && e.sets && e.sets.length > 0);
    // Need a baseline to judge "rough": skip brand-new exercises with no history.
    if (priorLogged.length === 0) continue;

    if (latest.skipped) {
      if (skipFired) addReason(a, 'skip');
      continue;
    }

    // #854/R3: volume_drop/collapse is a strength-specific signal — a
    // cardio-named exercise, or a warmup-kind latest entry, never
    // contributes it. The skip/attendance signals above, and the general
    // "has any history" gate, already used the exercise's full, unfiltered
    // entry history.
    if (!isStrengthExerciseName(a.name) || latest.kind === 'warmup') continue;
    // Re-derive the baseline excluding warmup-kind entries so a warm-up set
    // at this same exercise never seeds the comparison either.
    const strengthPriorLogged = priorLogged.filter(e => e.kind !== 'warmup');
    if (strengthPriorLogged.length === 0) continue;

    const latestSets = latest.sets || [];
    // Two prior logged entries minimum: a single observation is not a baseline,
    // so a user's second-ever session at a lift is never judged against their
    // first.
    if (strengthPriorLogged.length >= SESSION_CHECKIN_MIN_PRIOR_ENTRIES) {
      // Score ONLY the latest entry's own top weight — the thing the user was
      // actually testing. Back-off and accessory rows below it are ignored, so
      // changing the shape of a session (heavy top set, then lighter volume)
      // never reads as a decline. Only working sets define the top weight; a
      // within-row skipped set (rep_count 0) is scored against it below but
      // cannot set it.
      const working = latestSets.filter(s => s.weight_value > 0 && s.rep_count > 0);
      const topWeight = working.length > 0
        ? Math.max(...working.map(s => s.weight_value))
        : null;
      if (topWeight !== null) {
        // Baseline reps at that same weight: most recent prior logged entry that
        // used it. Looking the baseline up AT the top weight is also what makes
        // added load safe — a heavier top set has no baseline of its own, so
        // nothing is scored and progression is never called a decline.
        let baseReps = 0;
        for (let i = strengthPriorLogged.length - 1; i >= 0; i--) {
          const m = _maxRepsAtWeight(strengthPriorLogged[i].sets, topWeight);
          if (m > 0) { baseReps = m; break; }
        }
        if (baseReps > 0) { // otherwise: new weight, nothing to compare against
          let collapsedSets = 0;
          for (const s of latestSets) {
            if (s.weight_value !== topWeight) continue;
            if (baseReps - s.rep_count > SESSION_CHECKIN_REP_DROP_THRESHOLD) collapsedSets++;
          }
          if (collapsedSets >= SESSION_CHECKIN_MIN_COLLAPSED_SETS) {
            addReason(a, 'volume_drop');
            anyVolumeDrop = true;
            sumBaseTon += _checkinTonnage(strengthPriorLogged[strengthPriorLogged.length - 1].sets);
            sumLatestTon += _checkinTonnage(latestSets);
          }
        }
      }
    }
    if (computeRepDropOff(latestSets) === 'hit_wall') {
      addReason(a, 'collapse');
    }
  }

  // Roll up detectors from flagged reasons + the session-level skip trigger.
  for (const f of flaggedMap.values()) {
    for (const r of f.reasons) detectorSet.add(r === 'skip' ? 'skipped' : r);
  }
  if (skipFired) detectorSet.add('skipped');

  const flagged = [...flaggedMap.values()].map(f => ({ normName: f.normName, name: f.name, reasons: [...f.reasons] }));
  const detectorOrder = ['skipped', 'volume_drop', 'collapse'];
  const detectors = detectorOrder.filter(d => detectorSet.has(d));
  const volume_decline_pct = anyVolumeDrop && sumBaseTon > 0
    ? Math.round(((sumBaseTon - sumLatestTon) / sumBaseTon) * 100)
    : null;

  return {
    sessionIndex,
    // Only a trigger opens a prompt: a lone `collapse` is corroboration with
    // nothing to corroborate.
    isRough: detectors.some(d => SESSION_CHECKIN_TRIGGERS.includes(d)),
    detectors,
    flagged,
    metrics: { exercises_skipped: latestSkipCount, volume_decline_pct },
  };
}

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
export function deriveWorkoutNoteAnalytics(sections, trackedNames, multiplier, activations = null) {
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
    };
  }
  const nameDisplayMap = new Map();
  sections.forEach(s => s.exercises.forEach(e => {
    nameDisplayMap.set(normalizeExerciseKey(e.name), e.name);
  }));
  const anchors = resolveTrackedLiftAnchors(sections, activations);
  return {
    weeksIn: computeWeeksIn(sections),
    classifications: classifyExerciseSessions(sections, trackedNames, anchors),
    skipData: deriveSkipData(sections),
    signals: deriveSignals(sections, trackedNames, _multiplier, anchors).exercises,
    nameDisplayMap,
    perDaySignals: derivePerDaySignals(sections, trackedNames, anchors),
    anchors,
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

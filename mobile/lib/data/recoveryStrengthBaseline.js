// Frozen best-set strength pair for a recovery baseline (#1305).
//
// A weighted v2 baseline row carries `best_e1rm_weight` + `best_e1rm_reps`: the
// ONE completed working set with the highest Epley estimate (w * (1 + r/30)) in
// the exact session baseline capture already selected. Weights are the parser's
// canonical pounds (a kg-marked row is converted at parse time), so kg and lb
// logs compare directly. The pair is captured once and never reconstructed from
// aggregates: `top_weight` + `total_reps` cannot say which reps went with which
// load. Unscoreable rows (timed, reps-only, assisted-only) carry no pair.
//
// Pure leaf (imports only the parser): recoveryBlocks.js (capture),
// recoveryStrength.js (scores), recoveryStorage.js (rebuild gate), backup
// validation and recoveryBaselineNames.js all read this module.

import { normalizeExerciseKey } from '../parser.js';

const PREFIX_RE = /^[A-Za-z][A-Za-z ]{0,23}:\s*/;
const SCHEME_RE = /\s+\d+\s*[x×]\s*\d+(?:\s*-\s*\d+)?(?:\s*(?:seconds?|secs?|sec|s|minutes?|mins?|min|reps?))?(?:\s+each\s+(?:leg|side|arm|hand))?\s*$/i;
const DESCRIPTOR_RE = /\s*(?:,|—|–|\s-\s).*$/;

// Canonical comparison key for a display name (#1298); '' when nothing
// meaningful remains. A name is reduced by three conservative strips (section
// prefix, trailing sets x reps / duration scheme, comma/dash descriptor).
export function canonicalMatchKey(name) {
  let s = String(name || '').trim().replace(/\s+/g, ' ');
  s = s.replace(PREFIX_RE, '').replace(DESCRIPTOR_RE, '').replace(SCHEME_RE, '').trim();
  return normalizeExerciseKey(s);
}

export const BEST_E1RM_WEIGHT = 'best_e1rm_weight';
export const BEST_E1RM_REPS = 'best_e1rm_reps';

const _pos = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

export function epley(weight, reps) {
  return weight * (1 + reps / 30);
}

// A set that can carry a strength estimate: completed, positive finite load and
// reps, and no assistance (assistance is never treated as positive load).
export function isScoreableSet(s) {
  return !!s && !s.skipped && _pos(s.weight_value) && _pos(s.rep_count)
    && (s.assistance_value == null || s.assistance_value === 0);
}

// The best Epley set in one set list, first-in-order on ties; null when no set
// qualifies or the estimate is not finite.
export function bestEpleySet(sets) {
  let best = null;
  for (const s of sets || []) {
    if (!isScoreableSet(s)) continue;
    const e1rm = epley(s.weight_value, s.rep_count);
    if (!Number.isFinite(e1rm)) continue;
    if (!best || e1rm > best.e1rm) best = { weight: s.weight_value, reps: s.rep_count, e1rm };
  }
  return best;
}

// The frozen pair on one baseline row, or null when absent/invalid.
export function baselineStrengthPair(row) {
  if (!row || row.exercise_class !== 'weighted') return null;
  const weight = row[BEST_E1RM_WEIGHT];
  const reps = row[BEST_E1RM_REPS];
  if (!_pos(weight) || !_pos(reps)) return null;
  const e1rm = epley(weight, reps);
  return Number.isFinite(e1rm) ? { weight, reps, e1rm } : null;
}

// Backup/import check for one row: null when valid (pair absent, or a complete
// finite positive pair on a weighted row), otherwise an error string. A partial
// or misplaced pair is rejected rather than silently ignored.
export function strengthPairError(row) {
  const hasW = row[BEST_E1RM_WEIGHT] !== undefined;
  const hasR = row[BEST_E1RM_REPS] !== undefined;
  if (!hasW && !hasR) return null;
  if (hasW !== hasR) return 'Invalid backup: recovery baseline best-set pair is incomplete';
  if (row.exercise_class !== 'weighted') return 'Invalid backup: recovery baseline best-set pair is only valid on weighted rows';
  if (!baselineStrengthPair(row)) return 'Invalid backup: recovery baseline best-set pair must be positive finite numbers';
  return null;
}

// True when a baseline has no usable strength data to score against: any v1
// snapshot, or a v2 snapshot with weighted rows but no pair on any of them (a
// pre-#1305 capture). A #1305 capture may legitimately omit the pair on a
// loaded-duration row, so ONE pair anywhere marks it upgraded. Only a lacking
// snapshot may be rebuilt on explicit confirmation, and only into one that is
// not lacking; an upgraded snapshot is never rewritten again.
export function baselineLacksStrengthData(baseline) {
  if (!baseline || !Array.isArray(baseline.exercises)) return false;
  if (baseline.version === 1) return true;
  if (baseline.version !== 2) return false;
  const weighted = baseline.exercises.filter(r => r && r.exercise_class === 'weighted');
  return weighted.length > 0 && !weighted.some(r => baselineStrengthPair(r));
}

// Carry confirmed name matches (#1298) from an existing v2 snapshot onto a
// freshly captured one, using #1298's OWN proof rule (owner decision, PR #1308):
// a match only ever links names that reduce to the same canonical key, and only
// when that canonical group is one-to-one. So, per old row:
//   - key still captured: kept, unless a NEW row (a key the old snapshot did not
//     have) now shares its canonical name — then which row is "that lift" is
//     ambiguous (a matched identity could silently move), so refuse;
//   - key gone (a matched or removed row): carried only onto the ONE new-capture
//     row sharing its canonical name, when that row is itself new, of the same
//     class, and not already claimed; otherwise refuse.
// Neither a missing key, a position, nor equal numbers is proof. A refusal names
// the row: a match is never silently undone and another lift's best set is never
// frozen under a matched name. v1 snapshots cannot carry matches (rename is
// v2-only), so they pass through unchanged.
export function preserveNameMatches(previous, next) {
  if (!previous || previous.version !== 2) return { ok: true, baseline: next };
  const prevKeys = new Set(previous.exercises.map(r => r.key));
  const exercises = next.exercises.map(r => ({ ...r }));
  const nextKeys = new Set(exercises.map(r => r.key));
  const canonOf = (r) => canonicalMatchKey(r.name || r.key);
  const claimed = new Set();
  const refuse = (old) => ({
    ok: false,
    message: `“${old.name || old.key}” no longer lines up with the routine, so a matched name on it can’t be carried over safely. The baseline was not rebuilt.`,
  });
  for (const old of previous.exercises) {
    const canon = canonOf(old);
    const group = canon ? exercises.filter(r => canonOf(r) === canon) : [];
    const fresh = group.filter(r => !prevKeys.has(r.key));
    if (nextKeys.has(old.key)) {
      if (fresh.length > 0) return refuse(old);
      continue;
    }
    const target = group.length === 1 && fresh.length === 1 ? fresh[0] : null;
    if (!target || claimed.has(target) || target.exercise_class !== old.exercise_class) return refuse(old);
    claimed.add(target);
    target.key = old.key;
    target.name = old.name;
  }
  if (new Set(exercises.map(r => r.key)).size !== exercises.length) {
    return { ok: false, message: 'Matched exercise names would collide in the rebuilt baseline. The baseline was not rebuilt.' };
  }
  return { ok: true, baseline: { ...next, exercises } };
}

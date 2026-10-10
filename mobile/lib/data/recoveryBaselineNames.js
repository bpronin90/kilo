// Local, deterministic exercise-name matching for a frozen recovery baseline (#1298).
//
// A frozen baseline row keyed "plank 3x45 sec" never matches a week that logs
// "Plank", so comparison reports not-reintroduced + added. This module proposes
// one-to-one renames of FROZEN rows (key/name only) for the lifter to confirm. No
// network, no fuzzy scoring, and the global comparison normalization is untouched:
// a name is reduced by three conservative strips (section prefix, trailing
// sets x reps / duration scheme, comma/dash descriptor) and only mutually unique
// canonical-name groups become candidates.

import { normalizeExerciseKey } from '../parser.js';
import { RECOVERY_COMPARISON_STATES, RECOVERY_WEEK_STATUS, deriveRecoveryComparison } from './recoveryAnalytics.js';

const PREFIX_RE = /^[A-Za-z][A-Za-z ]{0,23}:\s*/;
const SCHEME_RE = /\s+\d+\s*[x×]\s*\d+(?:\s*-\s*\d+)?(?:\s*(?:seconds?|secs?|sec|s|minutes?|mins?|min|reps?))?(?:\s+each\s+(?:leg|side|arm|hand))?\s*$/i;
const DESCRIPTOR_RE = /\s*(?:,|—|–|\s-\s).*$/;

// Canonical comparison key for a display name; '' when nothing meaningful remains.
export function canonicalMatchKey(name) {
  let s = String(name || '').trim().replace(/\s+/g, ' ');
  s = s.replace(PREFIX_RE, '').replace(DESCRIPTOR_RE, '').replace(SCHEME_RE, '').trim();
  return normalizeExerciseKey(s);
}

function _group(items, keyOf) {
  const map = new Map();
  for (const item of items) {
    const k = keyOf(item);
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  return map;
}

// Candidates for one block: [{ group, from_key, from_name, to_key, to_name }]. Pure and
// read-only; derived from the same comparison the evidence card renders, so a
// baseline row is "unmatched" only if no live week matched it, and a logged
// identity is "unmatched" when it is not a baseline key (sightings across weeks
// collapse to one by key).
export function planBaselineNameMatches({ block, weeks = [], notes = [] } = {}) {
  const baseline = block && block.baseline;
  if (!block || !baseline || baseline.version !== 2 || !Array.isArray(baseline.exercises)) return [];
  const comparison = deriveRecoveryComparison({ block, weeks, notes });
  const okWeeks = (comparison.weeks || []).filter(w => w.status === RECOVERY_WEEK_STATUS.OK);
  if (okWeeks.length === 0) return [];

  const matched = new Set();
  const logged = new Map();
  for (const w of okWeeks) {
    for (const row of w.exercises) {
      if (row.state !== RECOVERY_COMPARISON_STATES.NOT_REINTRODUCED) matched.add(row.key);
    }
    for (const a of w.added) if (a.key && !logged.has(a.key)) logged.set(a.key, a.name);
  }

  const allRows = baseline.exercises;
  const baselineKeys = new Set(allRows.map(r => r.key));
  const matchedCanon = new Set(allRows.filter(r => matched.has(r.key)).map(r => canonicalMatchKey(r.name || r.key)));
  const unmatchedByCanon = _group(allRows.filter(r => !matched.has(r.key)), r => canonicalMatchKey(r.name || r.key));
  const loggedRows = [...logged].filter(([k]) => !baselineKeys.has(k)).map(([key, name]) => ({ key, name }));
  const loggedByCanon = _group(loggedRows, r => canonicalMatchKey(r.name));

  const out = [];
  for (const [canon, rows] of unmatchedByCanon) {
    const targets = loggedByCanon.get(canon) || [];
    // One-to-one is a plain pair; one-to-many / many-to-one is a CHOICE group where the
    // user picks exactly one pair (rows are never merged). Many-to-many stays excluded,
    // as does a group whose canonical name an exact-matched baseline row already holds.
    if (targets.length === 0 || (rows.length > 1 && targets.length > 1) || matchedCanon.has(canon)) continue;
    for (const row of rows) {
      for (const t of targets) {
        if (t.key === row.key) continue;
        out.push({ group: canon, from_key: row.key, from_name: row.name || row.key, to_key: t.key, to_name: t.name });
      }
    }
  }
  return out;
}

// Pure v2 row rename. Returns the new baseline, or null if it is not a supported
// one-row key/name change (wrong version, source absent/duplicated, target taken).
export function renameBaselineRow(baseline, { fromKey, toKey, toName }) {
  if (!baseline || baseline.version !== 2 || !Array.isArray(baseline.exercises)) return null;
  if (!fromKey || !toKey || !toName || fromKey === toKey) return null;
  const hits = baseline.exercises.filter(r => r.key === fromKey);
  if (hits.length !== 1 || baseline.exercises.some(r => r.key === toKey)) return null;
  return {
    ...baseline,
    exercises: baseline.exercises.map(r => (r === hits[0] ? { ...r, key: toKey, name: toName } : r)),
  };
}

import { deriveWorkoutAnalytics, normalizeExerciseKey } from '../parser.js';
import { loggedSessionUnits } from '../parser/analytics.js';

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

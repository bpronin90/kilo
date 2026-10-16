import { deriveWorkoutAnalytics, normalizeExerciseKey, parseWorkoutNote } from '../parser.js';
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
// What does apply here is the stale-anchor clamp, and only in memory.
//
// #1391: an anchor is an ordinal in the WHOLE notebook (the population it was
// minted in), so it cannot be applied directly to a narrower population — the
// excluded notes before the toggle would push the cut past genuine
// post-activation sessions. `anchorSource` (from exerciseProgress
// deriveProgressionAnchorSource) is that unfiltered notebook, note by note, with
// each note's membership in `sections`. The anchor is then TRANSLATED: the
// boundary in `sections` is the number of included units inside the stored
// prefix. Membership is provenance (which note a unit came from), never content
// matching. Translation always starts from the stored record, so a translated
// boundary can never be translated twice. Without `anchorSource`, or when it
// does not describe `sections` for a key, the boundary is the plain clamp:
// conservative, since it can only drop post-activation sessions, never admit a
// pre-activation one.
export function resolveTrackedLiftAnchors(sections, activations, anchorSource = null) {
  const winners = _dedupeByCanonicalKey(activations);
  if (winners.size === 0) return {};
  const { exercises } = deriveWorkoutAnalytics(sections || []);
  const byKey = new Map(exercises.map(ex => [normalizeExerciseKey(ex.name), ex]));
  const source = anchorSource ? _sourceUnitCounts(anchorSource) : null;
  const anchors = {};
  for (const [key, { record }] of winners) {
    const ex = byKey.get(key);
    if (!ex) continue;
    const raw = Number.isInteger(record.anchor) && record.anchor > 0 ? record.anchor : 0;
    if (raw === 0) continue;
    const have = loggedSessionUnits(ex.occurrences).length;
    const translated = source ? _translateAnchor(source, key, raw, have) : null;
    const anchor = translated ?? Math.min(raw, have);
    if (anchor > 0) anchors[key] = anchor;
  }
  return anchors;
}

// Per-note logged-session counts for every key, in notebook order. The
// normative list is a flatMap over occurrences in section order, so the
// notebook's list is exactly these per-note lists concatenated.
const _sourceCountCache = new WeakMap();
function _sourceUnitCounts(anchorSource) {
  const cached = _sourceCountCache.get(anchorSource);
  if (cached) return cached;
  const notes = (anchorSource.noteSectionsList || []).map((noteSections, i) => {
    const counts = new Map();
    for (const ex of deriveWorkoutAnalytics(noteSections || []).exercises) {
      counts.set(normalizeExerciseKey(ex.name), loggedSessionUnits(ex.occurrences).length);
    }
    return { counts, included: !!anchorSource.included?.[i] };
  });
  _sourceCountCache.set(anchorSource, notes);
  return notes;
}

// Returns the boundary in the included population, or null when the source does
// not account for exactly the `have` units this population holds (the caller
// then clamps). The stale-anchor clamp applies in the source population first:
// that is where the anchor was minted and where deleted history shrinks it.
function _translateAnchor(sourceNotes, key, raw, have) {
  let total = 0;
  let includedTotal = 0;
  for (const note of sourceNotes) {
    const n = note.counts.get(key) || 0;
    total += n;
    if (note.included) includedTotal += n;
  }
  if (includedTotal !== have) return null;
  const prefix = Math.min(raw, total);
  let seen = 0;
  let translated = 0;
  for (const note of sourceNotes) {
    if (seen >= prefix) break;
    const n = note.counts.get(key) || 0;
    if (note.included) translated += Math.min(n, prefix - seen);
    seen += n;
  }
  return translated;
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

// ── Carrying Track across a normalization rename (#1395) ─────────────────────
//
// A rename moves header occurrences from one canonical key to another. Their
// sessions are matched before/after by PROVENANCE only: note (notebook order),
// section, exercise slot and position inside the slot — never set values,
// spelling or `at`. Pure; the caller supplies the whole live unfiltered notebook.

function _slots(text, noteIndex) {
  const sections = text ? (parseWorkoutNote(text).sections || []) : [];
  const slots = [];
  sections.forEach((s, si) => (s.exercises || []).forEach((ex, ei) => {
    const occ = { heading: s.heading, subheading: s.subheading, kind: s.kind, rows: ex.rows, sets: ex.sets, unparsed_rows: ex.unparsed_rows, session_entries: ex.session_entries };
    slots.push({ id: `${noteIndex}:${si}:${ei}`, key: normalizeExerciseKey(ex.name), occ, units: loggedSessionUnits([occ]) });
  }));
  return { sections: sections.length, slots };
}

// An edit may change exercise names (and add `--` note lines) and nothing the
// session ordinal reads; anything more means the correspondence is unknown.
function _sameShape(a, b) {
  if (a.sections !== b.sections || a.slots.length !== b.slots.length) return false;
  return a.slots.every((x, i) => {
    const y = b.slots[i];
    return x.id === y.id && x.occ.heading === y.occ.heading && x.occ.subheading === y.occ.subheading
      && x.occ.kind === y.occ.kind && _witnessSessions(x.units) === _witnessSessions(y.units);
  });
}

// key -> { occurrences, units, ids } in the normative notebook order.
function _population(notes) {
  const byKey = new Map();
  for (const { slots } of notes) {
    for (const slot of slots) {
      if (!byKey.has(slot.key)) byKey.set(slot.key, { occurrences: [], units: [], ids: [] });
      const pop = byKey.get(slot.key);
      pop.occurrences.push(slot.occ);
      slot.units.forEach((u, i) => { pop.units.push(u); pop.ids.push(`${slot.id}:${i}`); });
    }
  }
  return byKey;
}

const _canon = key => normalizeExerciseKey(key) || key;
const _EMPTY = { occurrences: [], units: [], ids: [] };

// Display metadata only; deterministic whatever order contributors arrive in.
function _latestAt(contributors) {
  let best = null;
  for (const { at } of contributors) {
    if (typeof at !== 'string') continue;
    const a = Date.parse(at) || 0;
    const b = best === null ? -1 : (Date.parse(best) || 0);
    if (a > b || (a === b && at > best)) best = at;
  }
  return best;
}

const _entriesFor = (map, key, canon) => JSON.stringify(Object.entries(map).filter(([k]) => canon(k) === key));

/**
 * Plan the Track transition of one committed rename batch. `notes` is the live
 * notebook in order (current texts), `nextById` maps written note ids to their
 * new text. Returns `{ ok: true, changed, lifts, activations }`, or
 * `{ ok: false, reason }` when a written note's sessions cannot be matched.
 *
 *  - only slots whose key differs before/after are edits; same-key edits and
 *    untouched keys stay exactly as stored;
 *  - a tracked source makes its destination tracked; a source keeps its flag
 *    while ANY live header in the resulting notebook still produces it;
 *  - each valid activation (verified against the before population) excludes
 *    its first `anchor` sessions. In each resulting key the boundary is the
 *    shortest prefix holding every excluded session that landed there; the
 *    maximum over contributors wins and the witness is rebuilt over the result;
 *  - boolean-only or invalid records contribute no boundary and are never
 *    re-attached; with no valid contributor the key is boolean-only.
 */
export function planTrackedLiftRenameTransition(notes, nextById, trackedLifts, activations) {
  const before = [];
  const after = [];
  const edges = new Map();
  for (const [i, note] of (notes || []).entries()) {
    const b = _slots(note?.raw_text, i);
    before.push(b);
    if (!nextById.has(note?.id)) { after.push(b); continue; }
    const a = _slots(nextById.get(note.id), i);
    if (!_sameShape(b, a)) return { ok: false, reason: 'A renamed routine’s sessions could not be matched, so nothing was written.' };
    after.push(a);
    b.slots.forEach((slot, k) => {
      const to = a.slots[k].key;
      if (slot.key === to) return;
      if (!edges.has(to)) edges.set(to, new Set());
      edges.get(to).add(slot.key);
    });
  }
  const lifts = { ...(trackedLifts || {}) };
  const records = { ...(activations || {}) };
  if (edges.size === 0) return { ok: true, changed: false, lifts, activations: records };

  const popB = _population(before);
  const popA = _population(after);
  const tracked = new Set(Object.keys(lifts).filter(k => lifts[k]).map(_canon));
  const winners = _dedupeByCanonicalKey(activations);
  const excluded = new Map();
  // The excluded session ids of a tracked key's VALID activation, else null.
  const valid = (key) => {
    if (!excluded.has(key)) {
      const rec = tracked.has(key) ? winners.get(key)?.record : null;
      const pop = popB.get(key) || _EMPTY;
      const verdict = rec ? _verifyActivation(pop, rec) : { live: false };
      excluded.set(key, verdict.live ? { at: rec.at ?? null, ids: pop.ids.slice(0, verdict.anchor) } : null);
    }
    return excluded.get(key);
  };

  const affected = new Set(edges.keys());
  for (const sources of edges.values()) for (const s of sources) affected.add(s);
  let changed = false;
  for (const key of [...affected].sort()) {
    const incoming = [...(edges.get(key) || [])].filter(s => tracked.has(s));
    const pop = popA.get(key);
    const trackedAfter = !!pop && (tracked.has(key) || incoming.length > 0);
    if (!tracked.has(key) && !trackedAfter) continue;
    const prior = _entriesFor(lifts, key, _canon) + _entriesFor(records, key, normalizeExerciseKey);
    for (const k of Object.keys(lifts)) if (_canon(k) === key) delete lifts[k];
    for (const k of Object.keys(records)) if (normalizeExerciseKey(k) === key) delete records[k];
    const contributors = trackedAfter ? [...(tracked.has(key) ? [key] : []), ...incoming].map(valid).filter(Boolean) : [];
    if (trackedAfter) lifts[key] = true;
    if (contributors.length) {
      const index = new Map(pop.ids.map((id, i) => [id, i]));
      const anchor = Math.max(...contributors.map(c => c.ids.reduce((m, id) => (index.has(id) ? Math.max(m, index.get(id) + 1) : m), 0)));
      records[key] = {
        anchor,
        at: _latestAt(contributors),
        witness: anchor === 0 ? null : {
          headings: _witnessHeadings(pop.occurrences),
          sessions: _witnessSessions(pop.units.slice(0, Math.min(anchor, TRACKED_LIFT_WITNESS_SESSIONS))),
        },
      };
    }
    if (prior !== _entriesFor(lifts, key, _canon) + _entriesFor(records, key, normalizeExerciseKey)) changed = true;
  }
  return { ok: true, changed, lifts, activations: records };
}

function stableJson(value) {
  if (value === undefined) return 'undefined';
  return JSON.stringify(value, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v));
}

// Replay of a rename whose target note changed after an interruption (#1395).
// Over the intent's AFFECTED keys only (a later toggle elsewhere is kept) each
// current value must equal its recorded before or after value; a key matching
// neither is unknown and throws so the intent is kept. A key already at its
// after value also proves the rename landed. When landed, returns the maps with
// those keys moved to the recorded result; `landed: false` means leave Track.
export function reconcileDivergedApplyTracking(intent, lifts, activations, landedHint) {
  let landed = landedHint;
  const same = (x, y) => stableJson(x) === stableJson(y);
  const out = {};
  for (const [name, cur] of [['lifts', lifts], ['activations', activations]]) {
    const next = { ...cur };
    for (const key of new Set([...Object.keys(intent.before[name]), ...Object.keys(intent.tracking[name])])) {
      const was = intent.before[name][key];
      const will = intent.tracking[name][key];
      if (same(was, will)) continue;
      if (same(cur[key], will)) landed = true;
      else if (!same(cur[key], was)) throw new Error('An unfinished routine rename could not be reconciled.');
      if (will === undefined) delete next[key]; else next[key] = will;
    }
    out[name] = next;
  }
  return { ...out, landed };
}

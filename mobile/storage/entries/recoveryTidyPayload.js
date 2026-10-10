// Device-local operation payload for Tidy names (#1309).
//
// The recovery journal never stores workout text (#696). Tidy names has to know,
// across a restart, exactly which note texts to roll forward to (and, for Undo,
// back to), so that text lives HERE, in a dedicated device-local list that a
// strictly validated journal record references by id. Neither this list nor the
// journal is read by backup/export or the cloud sync engine: it is protocol
// state, not health history.
//
// Lifecycle: `pending` (written before the journal intent, before any domain
// write) -> `applied` (verified; kept as the single bounded Undo payload for its
// block until it expires or the next tidy replaces it) -> deleted (Undo
// consumed, expiry, replacement, or an orphan that no journal record names).

import { readList, writeList } from './jsonStorage';

export const TIDY_PAYLOAD_KEY = 'kilo_recovery_tidy_payload_v1';
export const TIDY_PAYLOAD_VERSION = 1;
// Bounded: one Undo payload per block, and at most this many across blocks.
export const TIDY_PAYLOAD_MAX = 4;
export const TIDY_UNDO_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const str = (v) => typeof v === 'string' && v.length > 0;

// Fail-closed shape check: a payload the replay cannot fully interpret is
// treated as missing, never partially trusted.
export function isValidTidyPayload(p) {
  if (!p || typeof p !== 'object' || p.version !== TIDY_PAYLOAD_VERSION) return false;
  if (!str(p.id) || !str(p.block_id) || !str(p.requested_at) || !str(p.baseline_shape)) return false;
  if (p.status !== 'pending' && p.status !== 'applied') return false;
  if (!Array.isArray(p.notes) || !Array.isArray(p.baseline)) return false;
  if (p.notes.length === 0 && p.baseline.length === 0) return false;
  const ids = new Set();
  for (const n of p.notes) {
    if (!n || !str(n.id) || typeof n.before !== 'string' || typeof n.after !== 'string' || n.before === n.after) return false;
    if (ids.has(n.id)) return false;
    ids.add(n.id);
  }
  return p.baseline.every(c => c && str(c.from_key) && str(c.to_key) && str(c.from_name) && str(c.to_name));
}

export function buildTidyPayload({ id, blockId, requestedAt, plan, baselineShape }) {
  return {
    version: TIDY_PAYLOAD_VERSION,
    id,
    block_id: blockId,
    status: 'pending',
    requested_at: requestedAt,
    expires_at: null,
    baseline_shape: baselineShape,
    notes: plan.noteWrites.map(w => ({ id: w.note_id, before: w.expected_raw_text, after: w.next_raw_text })),
    baseline: plan.baseline.map(c => ({ ...c })),
  };
}

async function readPayloads() {
  const list = await readList(TIDY_PAYLOAD_KEY);
  return list.filter(isValidTidyPayload);
}

export async function saveTidyPayload(payload) {
  if (!isValidTidyPayload(payload)) throw new Error('Tidy names payload is invalid.');
  const list = (await readPayloads()).filter(p => p.id !== payload.id);
  list.push(payload);
  await writeList(TIDY_PAYLOAD_KEY, list);
}

// The payload for an id, or null when absent or not interpretable.
export async function loadTidyPayload(id) {
  return (await readPayloads()).find(p => p.id === id) || null;
}

export async function deleteTidyPayload(id) {
  const list = await readList(TIDY_PAYLOAD_KEY);
  const next = list.filter(p => !p || p.id !== id);
  if (next.length !== list.length) await writeList(TIDY_PAYLOAD_KEY, next);
}

// Verified apply: this payload becomes its block's one Undo payload. Anything
// else already kept for the block is replaced, and the list stays bounded.
export async function markTidyPayloadApplied(id, now = Date.now()) {
  const list = await readPayloads();
  const mine = list.find(p => p.id === id);
  if (!mine) throw new Error('Tidy names payload is missing.');
  const applied = { ...mine, status: 'applied', expires_at: new Date(now + TIDY_UNDO_TTL_MS).toISOString() };
  const others = list.filter(p => p.id !== id && !(p.block_id === mine.block_id && p.status === 'applied'));
  const keepApplied = others.filter(p => p.status === 'applied').slice(-(TIDY_PAYLOAD_MAX - 1));
  await writeList(TIDY_PAYLOAD_KEY, [...others.filter(p => p.status !== 'applied'), ...keepApplied, applied]);
}

// The block's current Undo payload, or null once absent or expired.
export async function loadTidyUndoPayload(blockId, now = Date.now()) {
  const hit = (await readPayloads()).find(p => p.block_id === blockId && p.status === 'applied');
  if (!hit) return null;
  return hit.expires_at && Date.parse(hit.expires_at) <= now ? null : hit;
}

// Drop payloads nothing can use: expired Undo payloads, and `pending` payloads
// that no journal record names (a start that failed between the payload write
// and the journal intent). `referencedIds` comes from the journal, read under
// the same lock, so a payload being started right now is never swept.
export async function sweepTidyPayloads(referencedIds, now = Date.now()) {
  const list = await readList(TIDY_PAYLOAD_KEY);
  const refs = new Set(referencedIds);
  const keep = list.filter(p => isValidTidyPayload(p)
    && (p.status === 'pending' ? refs.has(p.id) : (!p.expires_at || Date.parse(p.expires_at) > now || refs.has(p.id))));
  if (keep.length !== list.length) await writeList(TIDY_PAYLOAD_KEY, keep);
}

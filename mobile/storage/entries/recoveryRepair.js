// Storage repair for persisted Recovery records (#1368).
//
// The two Recovery collections (blocks, week memberships) are separate keys with
// no shared transaction, and cloud sync can deliver their rows in any order. So
// a crash between the writes of `deleteRecoveryBlock`, or an out-of-order pull,
// can leave WELL-FORMED records that contradict each other. Journal replay only
// replays recorded operations; it cannot repair that. This module is the one
// repair, run by `reconcileAllUnlocked` (recoveryJournalReplay.js) under the
// exclusive Recovery access boundary, AFTER journal replay, whether or not the
// journal is empty. Startup, Retry, pre-action gates, and both cloud sync
// boundaries all reach it through that reconciler; there is no second algorithm.
//
// ── repair order (deterministic; every tie breaks on immutable record fields) ─
//   0. Records that cannot be interpreted (wrong shape, duplicate ids) are set
//      aside as UNREPAIRABLE; byte-identical duplicate copies are dropped.
//   1. Re-attach held weeks whose parent block is now present.
//   2. Duplicate active blocks: the latest `started_at` (then id) survives, the
//      others are completed (shared with sync: syncRecoveryResolution.js).
//   3. Live week under a TOMBSTONED block: tombstoned with the block's own
//      `deleted_at` (the same value the pull-time cascade writes).
//   4. Live week under a MISSING block: DETACHED (see policy below).
//   5. Live week whose note is its block's frozen baseline note: tombstoned.
//   6. One live membership per note (earliest `saved_at`, then id, survives;
//      the rest are tombstoned) and one live ordinal per (block, week), completed
//      blocks included (the loser is renumbered to the next free ordinal).
//      Ordinal gaps left by deleted weeks stay valid.
//   An active block's non-latest OPEN week is deliberately left alone: only the
//   provisional display selector is strict about it, repairing it would rewrite
//   user progress, and the authoritative gate does not require it
//   (arePersistedRecoveryRecordsConsistent), so it is never a failed read.
//
// ── missing-parent policy ─────────────────────────────────────────────────────
// A parent absent locally is NOT evidence of deletion: its row may simply not
// have downloaded yet. So repair never tombstones such a week (a synced
// tombstone would win LWW and destroy a legitimate membership when the block
// arrives). It DETACHES it: the untouched raw record moves to the device-local
// held store (`RECOVERY_HELD_KEY`), out of the live list, so it cannot block
// the note, the ordinal, or the verified read. Nothing waits on the parent:
// the read verifies immediately. If the block arrives later, the next pass
// re-attaches the week and the rules above apply to it normally. If it never
// arrives, the record stays held, harmless and inspectable
// (`loadHeldRecoveryRecords`), never deleted. The held store is not a sync
// table and is wiped with every `kilo_` key on a device wipe.
//
// ── unrepairable records ──────────────────────────────────────────────────────
// Malformed records / duplicate ids / a corrupt payload cannot be reasoned about.
// The FIRST pass that sees a set of them leaves them untouched and reports them,
// so the read fails with Retry (never verified Normal). The next pass that sees
// the SAME set sets them aside non-destructively (held store with
// `kind: 'quarantined'`; a corrupt payload is copied byte-for-byte) and repairs
// what remains. So Retry never loops over unchanged corruption, needs no cloud,
// and never wipes the device.
//
// ── persistence ───────────────────────────────────────────────────────────────
// Held additions are written FIRST, then blocks, then weeks, then held removals,
// so a crash at any boundary loses nothing and the next pass re-plans from
// persisted state and converges. Writes are skipped when the plan is empty (no
// timestamp churn); changed records advance `updated_at` (sync's baseline diff
// queues them; no network is needed). The pass re-reads before writing (a
// concurrent change re-plans) and re-reads after to verify the postcondition.

import { RECOVERY_BLOCKS_KEY, RECOVERY_BLOCK_WEEKS_KEY } from './keys';
import { CorruptStorageError, readList, writeList } from './jsonStorage';
import { secureStorage as AsyncStorage } from '../secureStorage';
import { getClientId, stampWrite } from '../syncQueue';
import { pickWinner, stableStringify } from '../sync/records';
import {
  cascadeTombstonedParents,
  resolveDuplicateActiveBlocks,
  resolveDuplicateWeekMemberships,
  retractMembership,
} from '../cloud/syncRecoveryResolution';
import { isLiveRecord } from '../../lib/data/recoveryBlocks';
import {
  arePersistedRecoveryRecordsConsistent,
  isWellTypedRecoveryBlock,
  isWellTypedRecoveryWeek,
} from '../../lib/data/activeTrainingContext';

export const RECOVERY_HELD_KEY = 'kilo_recovery_held_records_v1';
export const RECOVERY_CORRUPT_PAYLOAD_PREFIX = 'kilo_recovery_corrupt_payload_v1_';
export const HELD_KINDS = Object.freeze({ MISSING_PARENT: 'missing_parent', QUARANTINED: 'quarantined' });

const MAX_ATTEMPTS = 3;
const str = v => String(v ?? '');

// Winner first: newest `updated_at`, then a stable content order.
function compareCopies(a, b) {
  return str(b.updated_at).localeCompare(str(a.updated_at))
    || stableStringify(b).localeCompare(stableStringify(a));
}

// Split a raw list into interpretable records (unique ids) and the rest.
function classify(list, isWellTyped) {
  const good = [];
  const bad = [];
  const dropped = [];
  const groups = new Map();
  for (const record of list) {
    if (!isWellTyped(record)) bad.push(record);
    else if (groups.has(record.id)) groups.get(record.id).push(record);
    else groups.set(record.id, [record]);
  }
  for (const group of groups.values()) {
    const [winner, ...copies] = group.sort(compareCopies);
    good.push(winner);
    for (const copy of copies) {
      if (stableStringify(copy) === stableStringify(winner)) dropped.push(copy);
      else bad.push(copy);
    }
  }
  return { good, bad, dropped };
}

function advance(record, original) {
  if (!original || record === original || str(record.updated_at) > str(original.updated_at)) return record;
  const ms = Date.parse(original.updated_at);
  return Number.isNaN(ms) ? record : { ...record, updated_at: new Date(ms + 1).toISOString() };
}

function hashOf(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return `${h.toString(36)}${text.length.toString(36)}`;
}
// Quarantined entries are keyed by collection, id and a content hash, then by a
// collision suffix chosen by FULL-content comparison (as the corrupt-payload
// archive does), so every distinct raw version is preserved and an identical one
// is not duplicated. A missing-parent week is one logical record per id (LWW).
const baseHeldId = (kind, collection, record) => (kind === HELD_KINDS.QUARANTINED
  ? `${kind}:${collection}:${record.id ?? ''}:${hashOf(stableStringify(record))}`
  : `${kind}:${collection}:${record.id}`);
const asHeldRecord = original => (original && typeof original === 'object' ? original : { __raw: original });
const isHeld = h => !!h && typeof h.held_id === 'string' && !!h.record && typeof h.record === 'object';

// Pure planner. `quarantine` sets unrepairable records aside instead of
// reporting them. Never mutates its inputs.
export function planRecoveryRepair({ blocks, weeks, held = [], clientId, quarantine = false, deferConsistency = false, now = new Date().toISOString() }) {
  const cb = classify(blocks, isWellTypedRecoveryBlock);
  const cw = classify(weeks, isWellTypedRecoveryWeek);
  const unrepairable = [
    ...cb.bad.map(r => ({ collection: 'blocks', id: r?.id ?? null, record: r })),
    ...cw.bad.map(r => ({ collection: 'weeks', id: r?.id ?? null, record: r })),
  ];
  const heldAdds = [];
  const heldText = new Map(held.filter(isHeld).map(h => [h.held_id, stableStringify(h.record)]));
  const addHeld = (kind, collection, original, reason) => {
    const record = asHeldRecord(original);
    let id = baseHeldId(kind, collection, record);
    if (kind === HELD_KINDS.QUARANTINED) {
      const text = stableStringify(record);
      const base = id;
      for (let n = 1; heldText.has(id) && heldText.get(id) !== text; n += 1) id = `${base}_${n}`;
      heldText.set(id, text);
    }
    heldAdds.push({ held_id: id, kind, collection, reason, held_at: now, record });
  };
  if (quarantine) {
    unrepairable.forEach(u => addHeld(HELD_KINDS.QUARANTINED, u.collection, u.record, 'unrepairable'));
  }

  const removedBadBlocks = quarantine ? new Set(cb.bad) : new Set();
  const removedBadWeeks = quarantine ? new Set(cw.bad) : new Set();
  let B = cb.good;
  let W = cw.good;
  const knownBlockIds = new Set([...B, ...cb.bad.filter(r => !removedBadBlocks.has(r))].map(b => b?.id));
  const badWeekIds = new Set(cw.bad.filter(r => !removedBadWeeks.has(r)).map(w => w?.id));

  // Consistency repairs (1-7) wait for pending journaled operations
  // (`deferConsistency`); shape classification and set-aside above never do.
  const spent = new Set();
  let detached = [];
  if (!deferConsistency) {
    // 1. re-attach (or drop superseded) held weeks
    const goodW = new Map(W.map(w => [w.id, w]));
    for (const h of held.filter(isHeld)) {
      if (h.kind !== HELD_KINDS.MISSING_PARENT || h.collection !== 'weeks') continue;
      if (!knownBlockIds.has(h.record.block_id)) continue;
      if (badWeekIds.has(h.record.id) || !isWellTypedRecoveryWeek(h.record)) continue; // stays held
      spent.add(h.held_id);
      const existing = goodW.get(h.record.id);
      // The existing winner policy decides: a newer held edit must not lose to an
      // older live row, and an older one never overwrites a newer row.
      if (!existing || pickWinner(existing, h.record) === h.record) goodW.set(h.record.id, h.record);
    }
    W = [...goodW.values()];

    // 2-7
    B = resolveDuplicateActiveBlocks(B, clientId).list;
    W = cascadeTombstonedParents(B, W, clientId).list;
    detached = W.filter(w => isLiveRecord(w) && !knownBlockIds.has(w.block_id));
    detached.forEach(w => addHeld(HELD_KINDS.MISSING_PARENT, 'weeks', w, 'parent block not present'));
    W = W.filter(w => !detached.includes(w));
    const baselineOf = new Map(B.filter(isLiveRecord).map(b => [b.id, b.baseline_note_id]));
    W = W.map(w => (isLiveRecord(w) && baselineOf.get(w.block_id) === w.note_id ? retractMembership(w, clientId) : w));
    W = resolveDuplicateWeekMemberships(W, clientId).list;
  }

  const origB = new Map(cb.good.map(b => [b.id, b]));
  const origW = new Map(cw.good.map(w => [w.id, w]));
  const finalB = new Map(B.map(b => [b.id, advance(b, origB.get(b.id))]));
  const finalW = new Map(W.map(w => [w.id, advance(w, origW.get(w.id))]));
  const dropB = new Set(cb.dropped);
  const dropW = new Set(cw.dropped);
  const rebuild = (list, final, drop, removedBad, orig) => {
    const out = [];
    const present = new Set();
    for (const r of list) {
      if (drop.has(r) || removedBad.has(r)) continue;
      if (r && orig.get(r.id) === r) {
        present.add(r.id);
        if (final.has(r.id)) out.push(final.get(r.id));
      } else out.push(r);
    }
    for (const [id, r] of final) if (!present.has(id)) out.push(r);
    return out;
  };
  const outBlocks = rebuild(blocks, finalB, dropB, removedBadBlocks, origB);
  const outWeeks = rebuild(weeks, finalW, dropW, removedBadWeeks, origW);

  // Held store: additions first (replace same id only when content differs),
  // then removals (re-attached / superseded).
  const existingHeld = new Map(held.filter(isHeld).map(h => [h.held_id, h]));
  const replaced = new Set();
  const fresh = [];
  for (const a of heldAdds) {
    const ex = existingHeld.get(a.held_id);
    if (fresh.some(f => f.held_id === a.held_id)) continue;
    if (!ex) fresh.push(a);
    else if (stableStringify(ex.record) !== stableStringify(a.record) && pickWinner(ex.record, a.record) === a.record) {
      replaced.add(a.held_id);
      fresh.push(a);
    }
  }
  const keep = held.filter(isHeld).filter(h => !replaced.has(h.held_id));
  const heldBefore = [...keep, ...fresh];
  const heldAfter = heldBefore.filter(h => !spent.has(h.held_id));

  const sameList = (a, b) => a.length === b.length && a.every((r, i) => r === b[i]);
  return {
    blocks: outBlocks,
    weeks: outWeeks,
    heldBefore,
    heldAfter,
    unrepairable: quarantine ? [] : unrepairable,
    quarantined: quarantine ? unrepairable.length : 0,
    detached: detached.length,
    changed: {
      blocks: !sameList(outBlocks, blocks),
      weeks: !sameList(outWeeks, weeks),
      held: stableStringify(heldAfter) !== stableStringify(held) || stableStringify(heldBefore) !== stableStringify(held),
    },
  };
}

// A payload that is present but not a JSON list. Copied byte-for-byte aside,
// then the key is reset, but only when the SAME failure was already reported by
// an earlier pass (the first sight surfaces as a failed read with Retry).
let lastCorruptKeys = new Set();
let lastUnrepairableSignature = null;
export function __resetRecoveryRepairState() {
  lastCorruptKeys = new Set();
  lastUnrepairableSignature = null;
}

async function readRepairList(key) {
  try {
    const list = await readList(key);
    lastCorruptKeys.delete(key);
    return list;
  } catch (e) {
    if (!(e instanceof CorruptStorageError)) throw e;
    if (!lastCorruptKeys.has(key)) {
      lastCorruptKeys.add(key);
      throw e;
    }
    const raw = await AsyncStorage.getItem(key);
    // One archive entry per payload (no read-modify-write of a shared list), so
    // an earlier salvage can never be erased or mis-read as empty.
    const base = `${RECOVERY_CORRUPT_PAYLOAD_PREFIX}${hashOf(`${key}|${raw}`)}`;
    for (let n = 0; ; n += 1) {
      const archiveKey = n === 0 ? base : `${base}_${n}`;
      // eslint-disable-next-line no-await-in-loop
      const existing = await AsyncStorage.getItem(archiveKey);
      if (existing == null) {
        // eslint-disable-next-line no-await-in-loop
        await AsyncStorage.setItem(archiveKey, JSON.stringify({ key, raw, quarantined_at: new Date().toISOString() }));
        break;
      }
      let same = false;
      try { const p = JSON.parse(existing); same = p.key === key && p.raw === raw; } catch { /* distinct */ }
      if (same) break;
    }
    await writeList(key, []);
    lastCorruptKeys.delete(key);
    return [];
  }
}

const readAll = () => Promise.all([
  readRepairList(RECOVERY_BLOCKS_KEY),
  readRepairList(RECOVERY_BLOCK_WEEKS_KEY),
  readRepairList(RECOVERY_HELD_KEY),
]);

// Source keys of Recovery payloads archived as corrupt (and then reset). Sync uses
// this so a reset collection is never read as the deletion of every synced row.
export async function loadArchivedCorruptKeys() {
  // Fails closed: a read error propagates (sync then fails and retries) instead
  // of shrinking the answer. An archive entry that cannot be parsed is treated as
  // covering BOTH collections, so sync never infers a deletion from it.
  const keys = (await AsyncStorage.getAllKeys()).filter(k => k.startsWith(RECOVERY_CORRUPT_PAYLOAD_PREFIX));
  const out = new Set();
  for (const k of keys) {
    // eslint-disable-next-line no-await-in-loop
    const raw = await AsyncStorage.getItem(k);
    try {
      out.add(JSON.parse(raw).key);
    } catch {
      out.add(RECOVERY_BLOCKS_KEY).add(RECOVERY_BLOCK_WEEKS_KEY);
    }
  }
  return out;
}

// Records set aside by repair, for support/export and recovery tooling.
export const loadHeldRecoveryRecords = () => readList(RECOVERY_HELD_KEY);

// One repair pass. Throws on a read/write/verification failure (the caller
// reports it as a failed read; the next pass re-plans from persisted state).
// Resolves `{ ok, changed, unrepairable, detached, quarantined }`: `ok` is false
// while unrepairable records remain.
export async function repairRecoveryRecords({ deferConsistency = false } = {}) {
  const clientId = await getClientId();
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const [blocks, weeks, held] = await readAll();
    let plan = planRecoveryRepair({ blocks, weeks, held, clientId, deferConsistency });
    if (plan.unrepairable.length === 0) {
      lastUnrepairableSignature = null;
    } else {
      const signature = stableStringify(plan.unrepairable);
      // A set already preserved (a sync merge wrote it back from the sync view)
      // is set aside again immediately: nothing new for the user to see.
      const preserved = new Set(held.filter(isHeld).filter(h => h.kind === HELD_KINDS.QUARANTINED)
        .map(h => `${h.collection}|${stableStringify(h.record)}`));
      const alreadyPreserved = plan.unrepairable.every(
        u => preserved.has(`${u.collection}|${stableStringify(asHeldRecord(u.record))}`)
      );
      if (signature === lastUnrepairableSignature || alreadyPreserved) {
        plan = planRecoveryRepair({ blocks, weeks, held, clientId, quarantine: true, deferConsistency });
        lastUnrepairableSignature = null;
      } else {
        lastUnrepairableSignature = signature;
      }
    }
    const { changed } = plan;
    const wrote = changed.blocks || changed.weeks || changed.held;
    if (wrote) {
      // eslint-disable-next-line no-await-in-loop
      const [b2, w2, h2] = await readAll();
      if (stableStringify([b2, w2, h2]) !== stableStringify([blocks, weeks, held])) continue;
      if (changed.held) await writeList(RECOVERY_HELD_KEY, plan.heldBefore);
      if (changed.blocks) await writeList(RECOVERY_BLOCKS_KEY, plan.blocks);
      if (changed.weeks) await writeList(RECOVERY_BLOCK_WEEKS_KEY, plan.weeks);
      if (stableStringify(plan.heldAfter) !== stableStringify(plan.heldBefore)) {
        await writeList(RECOVERY_HELD_KEY, plan.heldAfter);
      }
    }
    // Verify what is PERSISTED, not what was planned.
    // eslint-disable-next-line no-await-in-loop
    const [vb, vw, vh] = wrote ? await readAll() : [blocks, weeks, held];
    const again = planRecoveryRepair({ blocks: vb, weeks: vw, held: vh, clientId, deferConsistency });
    const unrepaired = again.unrepairable.length;
    const settled = !again.changed.blocks && !again.changed.weeks && !again.changed.held;
    if (!unrepaired && (!settled || (!deferConsistency && !arePersistedRecoveryRecordsConsistent(vb, vw)))) {
      if (attempt + 1 < MAX_ATTEMPTS) continue;
      throw new Error('Recovery repair could not be verified against stored records.');
    }
    return {
      ok: unrepaired === 0,
      changed: wrote,
      deferred: deferConsistency,
      unrepairable: unrepaired,
      detached: plan.detached,
      quarantined: plan.quarantined,
    };
  }
  throw new Error('Recovery records kept changing while they were being repaired.');
}

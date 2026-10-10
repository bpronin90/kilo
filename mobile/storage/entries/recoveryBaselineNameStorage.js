// Multi-row, name-only writer for a frozen v2 baseline (#1309).
//
// Tidy names (and its Undo) change the key/name of several baseline rows at
// once. This is the one sanctioned writer for that: it rewrites only the
// key/name of the rows a validated change list names, in one write, and keeps
// the baseline version, metrics, best-set pair, row order, basis and every other
// field byte-identical. The generic patch API still drops `baseline`.
//
// Each change is classified against the persisted baseline in the direction of
// the operation (`apply` = from -> to, `undo` = to -> from):
//   done      the row already reads as the destination;
//   todo      the row reads as the source and the destination key is free;
//   conflict  anything else (edited, removed, colliding).
// All changes are classified before the first write, and a replay of a
// half-applied operation therefore writes nothing twice.

import { RECOVERY_BLOCKS_KEY } from './keys';
import { readList, writeList } from './jsonStorage';
import { isLiveRecord } from '../../lib/data/recoveryBlocks';

export const NAME_STATE = Object.freeze({ DONE: 'done', TODO: 'todo', CONFLICT: 'conflict' });

const sides = (change, direction) => (direction === 'undo'
  ? { src: { key: change.to_key, name: change.to_name }, dst: { key: change.from_key, name: change.from_name } }
  : { src: { key: change.from_key, name: change.from_name }, dst: { key: change.to_key, name: change.to_name } });

// Pure. { state, rows: [per-change state] } for one block's baseline.
export function classifyBaselineNames(baseline, changes, direction) {
  if (!baseline || baseline.version !== 2 || !Array.isArray(baseline.exercises)) {
    return { state: NAME_STATE.CONFLICT, rows: [] };
  }
  const rows = baseline.exercises;
  const taken = new Set(rows.map(r => r.key));
  const srcKeys = new Set(changes.map(c => sides(c, direction).src.key));
  const per = changes.map((c) => {
    const { src, dst } = sides(c, direction);
    const atSrc = rows.filter(r => r.key === src.key);
    const atDst = rows.filter(r => r.key === dst.key);
    if (src.key === dst.key) {
      if (atSrc.length !== 1) return NAME_STATE.CONFLICT;
      if (atSrc[0].name === dst.name) return NAME_STATE.DONE;
      return atSrc[0].name === src.name ? NAME_STATE.TODO : NAME_STATE.CONFLICT;
    }
    if (atDst.length === 1 && atDst[0].name === dst.name && atSrc.length === 0) return NAME_STATE.DONE;
    if (atSrc.length !== 1 || atSrc[0].name !== src.name) return NAME_STATE.CONFLICT;
    // The destination key must be free, or be another change's own source.
    if (taken.has(dst.key) && !srcKeys.has(dst.key)) return NAME_STATE.CONFLICT;
    return NAME_STATE.TODO;
  });
  const state = per.includes(NAME_STATE.CONFLICT) ? NAME_STATE.CONFLICT
    : per.every(s => s === NAME_STATE.DONE) ? NAME_STATE.DONE : NAME_STATE.TODO;
  return { state, rows: per };
}

// Pure. The baseline with every `todo` row renamed; null if the result would
// carry duplicate keys. Rows not named by a change are the same objects.
export function applyBaselineNameChanges(baseline, changes, direction) {
  const { rows: per } = classifyBaselineNames(baseline, changes, direction);
  const bySrc = new Map();
  changes.forEach((c, i) => { if (per[i] === NAME_STATE.TODO) bySrc.set(sides(c, direction).src.key, sides(c, direction).dst); });
  const exercises = baseline.exercises.map(r => (bySrc.has(r.key) ? { ...r, key: bySrc.get(r.key).key, name: bySrc.get(r.key).name } : r));
  return new Set(exercises.map(r => r.key)).size === exercises.length ? { ...baseline, exercises } : null;
}

// Persisted state of the block's baseline names for this operation.
export async function readBaselineNameState(blockId, changes, direction) {
  const block = (await readList(RECOVERY_BLOCKS_KEY)).find(b => b.id === blockId);
  if (!block || !isLiveRecord(block)) return { state: NAME_STATE.CONFLICT, missing: true };
  return classifyBaselineNames(block.baseline, changes, direction);
}

// One write. Idempotent: a baseline already at the destination is left alone.
export async function writeRecoveryBlockBaselineNames(blockId, changes, direction, requestedAt) {
  const list = await readList(RECOVERY_BLOCKS_KEY);
  const idx = list.findIndex(b => b.id === blockId);
  if (idx < 0 || !isLiveRecord(list[idx])) return { state: NAME_STATE.CONFLICT, written: false };
  const { state } = classifyBaselineNames(list[idx].baseline, changes, direction);
  if (state !== NAME_STATE.TODO) return { state, written: false };
  const baseline = applyBaselineNameChanges(list[idx].baseline, changes, direction);
  if (!baseline) return { state: NAME_STATE.CONFLICT, written: false };
  const previous = list[idx].updated_at;
  list[idx] = { ...list[idx], baseline, updated_at: previous && previous > requestedAt ? previous : requestedAt };
  await writeList(RECOVERY_BLOCKS_KEY, list);
  return { state: NAME_STATE.DONE, written: true };
}

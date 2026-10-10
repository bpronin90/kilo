// Multi-row, name-only writer for a frozen v2 baseline (#1309).
//
// Tidy names renames the key/name of baseline rows that carry a descriptor, in one
// write, and nothing else: the baseline version, metrics, best-set pair, row
// order, basis and every other field stay byte-identical. It is the sanctioned
// name-only writer (like #1298's single-row one); the generic patch API still
// drops `baseline`. Each change must still read as its source (an unmatched or
// colliding row rejects the whole call with no write), and a baseline already at
// the destination is a no-op, so re-running the action is safe.

import { RECOVERY_BLOCKS_KEY } from './keys';
import { readList, writeList } from './jsonStorage';
import { RECOVERY_ERROR_CODES, RecoveryBlockError, isLiveRecord } from '../../lib/data/recoveryBlocks';

// Pure. The renamed baseline, the same object when every change is already
// applied, or null when a change no longer matches (edited, removed, colliding).
export function applyBaselineNameChanges(baseline, changes) {
  if (!baseline || baseline.version !== 2 || !Array.isArray(baseline.exercises)) return null;
  const rows = baseline.exercises;
  const bySrc = new Map();
  for (const c of changes) {
    const atDst = rows.filter(r => r.key === c.to_key);
    if (atDst.length === 1 && atDst[0].name === c.to_name && (c.from_key === c.to_key || !rows.some(r => r.key === c.from_key))) continue;
    const atSrc = rows.filter(r => r.key === c.from_key);
    if (atSrc.length !== 1 || atSrc[0].name !== c.from_name) return null;
    bySrc.set(c.from_key, c);
  }
  if (bySrc.size === 0) return baseline;
  const exercises = rows.map(r => (bySrc.has(r.key) ? { ...r, key: bySrc.get(r.key).to_key, name: bySrc.get(r.key).to_name } : r));
  const sources = new Set(bySrc.keys());
  const untouched = rows.filter(r => !sources.has(r.key)).map(r => r.key);
  const targets = [...bySrc.values()].map(c => c.to_key);
  return new Set([...untouched, ...targets]).size === exercises.length ? { ...baseline, exercises } : null;
}

export async function writeRecoveryBlockBaselineNames(blockId, changes) {
  const list = await readList(RECOVERY_BLOCKS_KEY);
  const idx = list.findIndex(b => b.id === blockId);
  if (idx < 0 || !isLiveRecord(list[idx])) throw new RecoveryBlockError(RECOVERY_ERROR_CODES.BLOCK_NOT_FOUND, `No live recovery block with id ${blockId}.`);
  const baseline = applyBaselineNameChanges(list[idx].baseline, changes);
  if (!baseline) throw new RecoveryBlockError(RECOVERY_ERROR_CODES.BASELINE_NOT_REBUILDABLE, 'These baseline names changed, so they were not renamed.');
  if (baseline === list[idx].baseline) return list[idx];
  list[idx] = { ...list[idx], baseline, updated_at: new Date().toISOString() };
  await writeList(RECOVERY_BLOCKS_KEY, list);
  return list[idx];
}

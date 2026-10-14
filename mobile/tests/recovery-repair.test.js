// Storage repair for persisted Recovery inconsistencies (#1368). Everything runs
// against persisted fixtures through the real repair / reconcile / read path.

import React from 'react';
import TestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  RECOVERY_BLOCKS_KEY,
  RECOVERY_BLOCK_WEEKS_KEY,
  RECOVERY_OPERATION_JOURNAL_KEY,
} from '../storage/entries/keys';
import * as jsonStorage from '../storage/entries/jsonStorage';
import {
  RECOVERY_CORRUPT_PAYLOADS_KEY,
  RECOVERY_HELD_KEY,
  __resetRecoveryRepairState,
  loadHeldRecoveryRecords,
  planRecoveryRepair,
  repairRecoveryRecords,
} from '../storage/entries/recoveryRepair';
import { deleteRecoveryBlock } from '../storage/entries/recoveryStorage';
import * as journal from '../storage/entries/recoveryOperationJournal';
import { arePersistedRecoveryRecordsConsistent } from '../lib/data/activeTrainingContext';
import { CLIENT_ID_KEY, mergeRecords } from '../storage/sync/records';
import { resetClientIdCacheForTests } from '../storage/syncQueue';
import * as readState from '../hooks/entries/recoveryReadState';
import { withRecoveryReconciliation } from '../hooks/entries/storageMode';

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-02T00:00:00.000Z';
const T2 = '2026-01-03T00:00:00.000Z';
const T3 = '2026-01-04T00:00:00.000Z';
const DEL = '2026-02-01T00:00:00.000Z';

const blk = (id, extra = {}) => ({
  id, baseline_note_id: `base_${id}`, baseline: { version: 2, exercises: [{ key: 'squat', name: 'Squat' }] },
  started_at: T0, saved_at: T0, updated_at: T0, completed_at: null, deleted_at: null, ...extra,
});
const wk = (id, blockId, noteId, n, extra = {}) => ({
  id, block_id: blockId, note_id: noteId, week_number: n,
  saved_at: T0, updated_at: T0, completed_at: null, deleted_at: null, ...extra,
});

const put = (key, list) => AsyncStorage.setItem(key, JSON.stringify(list));
const get = async key => JSON.parse((await AsyncStorage.getItem(key)) || '[]');
const seed = async (blocks, weeks) => { await put(RECOVERY_BLOCKS_KEY, blocks); await put(RECOVERY_BLOCK_WEEKS_KEY, weeks); };
const read = async () => ({ blocks: await get(RECOVERY_BLOCKS_KEY), weeks: await get(RECOVERY_BLOCK_WEEKS_KEY), held: await get(RECOVERY_HELD_KEY) });
const isConsistent = ({ blocks, weeks }) => arePersistedRecoveryRecordsConsistent(blocks, weeks);
const byId = list => Object.fromEntries(list.map(r => [r.id, r]));
// Domain state: everything except per-device sync metadata, id-ordered.
const domain = ({ blocks, weeks }) => {
  const strip = ({ updated_at, client_id, ...rest }) => rest; // eslint-disable-line no-unused-vars
  const sort = l => l.map(strip).sort((a, b) => a.id.localeCompare(b.id));
  return { blocks: sort(blocks), weeks: sort(weeks) };
};
const spyWrites = () => jest.spyOn(jsonStorage, 'writeList');

beforeEach(async () => {
  await AsyncStorage.clear();
  journal.__resetRecoveryOperationJournal();
  __resetRecoveryRepairState();
  resetClientIdCacheForTests();
});
afterEach(() => { jest.restoreAllMocks(); });

describe('each persisted invariant is repaired conservatively', () => {
  test('valid empty data, completed history and ordinal gaps are a no-op with no writes', async () => {
    const writes = spyWrites();
    expect(await repairRecoveryRecords()).toMatchObject({ ok: true, changed: false });
    const blocks = [blk('done', { completed_at: T1 }), blk('gone', { deleted_at: DEL }), blk('act', { started_at: T2 })];
    const weeks = [
      wk('d1', 'done', 'n1', 1, { completed_at: T1 }), wk('d4', 'done', 'n2', 4, { completed_at: T1 }),
      wk('a2', 'act', 'n3', 2, { completed_at: T2 }), wk('a5', 'act', 'n4', 5),
      wk('g1', 'gone', 'n5', 1, { deleted_at: DEL }),
    ];
    await seed(blocks, weeks);
    writes.mockClear();
    expect(await repairRecoveryRecords()).toMatchObject({ ok: true, changed: false });
    expect(writes).not.toHaveBeenCalled();
    expect(await read()).toMatchObject({ blocks, weeks });
  });

  test('live week under a tombstoned block is tombstoned with the block deleted_at; content survives', async () => {
    await seed([blk('b', { deleted_at: DEL, updated_at: DEL })], [wk('w', 'b', 'n', 1, { completed_at: T1 })]);
    await repairRecoveryRecords();
    const s = await read();
    expect(isConsistent(s)).toBe(true);
    expect(s.weeks[0]).toMatchObject({ deleted_at: DEL, completed_at: T1, note_id: 'n' });
    expect(s.weeks[0].updated_at > T0).toBe(true);
    expect(s.blocks[0].baseline).toEqual(blk('b').baseline);
  });

  test('live week under a MISSING block is detached, not deleted, and re-attached when the block arrives', async () => {
    const week = wk('w', 'late', 'n', 1);
    await seed([], [week]);
    expect(await repairRecoveryRecords()).toMatchObject({ ok: true, changed: true, detached: 1 });
    let s = await read();
    expect(s.weeks).toEqual([]);
    expect(s.held).toHaveLength(1);
    expect(s.held[0]).toMatchObject({ kind: 'missing_parent', record: week });
    expect((await loadHeldRecoveryRecords())[0].record).toEqual(week);
    // Nothing was tombstoned and nothing churns while the parent is absent.
    const writes = spyWrites();
    expect(await repairRecoveryRecords()).toMatchObject({ ok: true, changed: false });
    expect(writes).not.toHaveBeenCalled();

    await put(RECOVERY_BLOCKS_KEY, [blk('late')]);
    await repairRecoveryRecords();
    s = await read();
    expect(s.weeks).toEqual([week]);
    expect(s.held).toEqual([]);
    expect(isConsistent(s)).toBe(true);
  });

  test('a held week whose block arrives TOMBSTONED is cascaded, never resurrected', async () => {
    await seed([], [wk('w', 'late', 'n', 1)]);
    await repairRecoveryRecords();
    await put(RECOVERY_BLOCKS_KEY, [blk('late', { deleted_at: DEL })]);
    await repairRecoveryRecords();
    const s = await read();
    expect(s.weeks[0]).toMatchObject({ id: 'w', deleted_at: DEL });
    expect(s.held).toEqual([]);
  });

  test('a newer incoming copy of a held week supersedes the held one', async () => {
    await seed([], [wk('w', 'late', 'n', 1)]);
    await repairRecoveryRecords();
    await seed([blk('late')], [wk('w', 'late', 'n', 1, { deleted_at: DEL, updated_at: DEL })]);
    await repairRecoveryRecords();
    const s = await read();
    expect(s.weeks).toHaveLength(1);
    expect(s.weeks[0].deleted_at).toBe(DEL);
    expect(s.held).toEqual([]);
  });

  test('multiple active blocks: latest started survives (id breaks ties); losers complete, history kept', async () => {
    await seed(
      [blk('a', { started_at: T0 }), blk('c', { started_at: T2 }), blk('b', { started_at: T2 })],
      [wk('wa', 'a', 'n1', 1)]
    );
    await repairRecoveryRecords();
    const { blocks, weeks } = await read();
    const m = byId(blocks);
    expect(m.c.completed_at).toBeNull();
    expect(m.a.completed_at).toBe(T2);
    expect(m.b.completed_at).toBe(T2);
    expect(m.a.baseline).toEqual(blk('a').baseline);
    expect(weeks).toHaveLength(1);
    expect(weeks[0].deleted_at).toBeNull();
    expect(isConsistent({ blocks, weeks })).toBe(true);
  });

  test('one live membership per note across blocks: earliest saved_at survives, id breaks ties', async () => {
    await seed(
      [blk('x', { completed_at: T1 }), blk('y')],
      [wk('w2', 'y', 'n', 1, { saved_at: T1 }), wk('w1', 'x', 'n', 1, { saved_at: T1 }), wk('w0', 'y', 'n', 2, { saved_at: T2 })]
    );
    await repairRecoveryRecords();
    const m = byId((await read()).weeks);
    expect(m.w1.deleted_at).toBeNull();
    expect(m.w2.deleted_at).toBe(T1);
    expect(m.w0.deleted_at).toBe(T2);
  });

  test('a week whose note is its block baseline note is tombstoned, baseline untouched', async () => {
    await seed([blk('b', { baseline_note_id: 'base' })], [wk('w', 'b', 'base', 1)]);
    await repairRecoveryRecords();
    const s = await read();
    expect(s.weeks[0].deleted_at).toBe(T0);
    expect(s.blocks[0].baseline_note_id).toBe('base');
    expect(isConsistent(s)).toBe(true);
  });

  test('duplicate week_number, completed blocks included, is renumbered; gaps stay', async () => {
    await seed(
      [blk('done', { completed_at: T1 })],
      [wk('p', 'done', 'n1', 2, { saved_at: T0 }), wk('q', 'done', 'n2', 2, { saved_at: T1 }), wk('r', 'done', 'n3', 7, { saved_at: T2 })]
    );
    await repairRecoveryRecords();
    const m = byId((await read()).weeks);
    expect([m.p.week_number, m.q.week_number, m.r.week_number]).toEqual([2, 8, 7]);
    expect(m.q.deleted_at).toBeNull();
  });

  test('an earlier open week of the active block is user data: untouched, and not a failed read', async () => {
    const weeks = [wk('w1', 'b', 'n1', 1), wk('w2', 'b', 'n2', 2)];
    await seed([blk('b')], weeks);
    const writes = spyWrites();
    expect(await repairRecoveryRecords()).toMatchObject({ ok: true, changed: false });
    expect(writes).not.toHaveBeenCalled();
    expect(isConsistent(await read())).toBe(true);
    readState._resetRecoveryAnalyticsFilterCache();
    expect((await readState.refreshRecoveryState()).ok).toBe(true);
  });

  test('a repaired record always advances updated_at, even over a future timestamp', async () => {
    const future = '2099-01-01T00:00:00.000Z';
    await seed([blk('b', { deleted_at: DEL })], [wk('w', 'b', 'n', 1, { updated_at: future })]);
    await repairRecoveryRecords();
    expect((await read()).weeks[0].updated_at > future).toBe(true);
  });

  test('multiple interacting violations repair identically for any input order, and idempotently', async () => {
    const blocks = [blk('a'), blk('b', { started_at: T2 }), blk('dead', { deleted_at: DEL }), blk('c', { completed_at: T1 })];
    const weeks = [
      wk('w1', 'a', 'n1', 1, { saved_at: T0 }), wk('w2', 'b', 'n1', 1, { saved_at: T1 }),
      wk('w3', 'dead', 'n2', 1), wk('w4', 'ghost', 'n3', 1), wk('w5', 'b', 'n4', 1, { saved_at: T2 }),
      wk('w6', 'b', 'n5', 2), wk('w7', 'c', 'base_c', 1), wk('w8', 'c', 'n6', 3), wk('w9', 'c', 'n7', 3, { saved_at: T1 }),
    ];
    const run = async (b, w) => {
      await AsyncStorage.clear();
      await seed(b, w);
      await repairRecoveryRecords();
      const first = await read();
      expect(isConsistent(first)).toBe(true);
      const writes = spyWrites();
      expect(await repairRecoveryRecords()).toMatchObject({ ok: true, changed: false });
      expect(writes).not.toHaveBeenCalled();
      writes.mockRestore();
      expect(await read()).toEqual(first);
      return { ...first, held: first.held.map(h => h.record.id) };
    };
    const forward = await run(blocks, weeks);
    const reversed = await run([...blocks].reverse(), [...weeks].reverse());
    expect(domain(reversed)).toEqual(domain(forward));
    expect(forward.held).toEqual(['w4']);
    expect(byId(forward.weeks).w1.deleted_at).toBeNull();
  });

  test('plan is pure: inputs are never mutated', () => {
    const blocks = [blk('a'), blk('b')];
    const weeks = [wk('w', 'zz', 'n', 1)];
    const snapshot = JSON.stringify([blocks, weeks]);
    planRecoveryRepair({ blocks, weeks, clientId: 'c' });
    expect(JSON.stringify([blocks, weeks])).toBe(snapshot);
  });
});

describe('interrupted delete cascade and failure recovery', () => {
  test('deleteRecoveryBlock interrupted after the block write is repaired by the next pass', async () => {
    await seed([blk('b')], [wk('w', 'b', 'n', 1, { completed_at: T1 })]);
    const failWeeks = jest.spyOn(jsonStorage, 'writeList').mockImplementationOnce(async (k, l) => {
      await AsyncStorage.setItem(k, JSON.stringify(l));
    }).mockImplementationOnce(async () => { throw new Error('killed mid-cascade'); });
    await expect(deleteRecoveryBlock('b')).rejects.toThrow('killed mid-cascade');
    failWeeks.mockRestore();
    const torn = await read();
    expect(torn.blocks[0].deleted_at).toBeTruthy();
    expect(torn.weeks[0].deleted_at).toBeNull();
    expect(isConsistent(torn)).toBe(false);

    // Journal is EMPTY: repair still runs through the shared reconciler.
    expect(await AsyncStorage.getItem(RECOVERY_OPERATION_JOURNAL_KEY)).toBeNull();
    const rec = await journal.reconcileRecoveryOperations();
    expect(rec.repair).toMatchObject({ ok: true, changed: true });
    const fixed = await read();
    expect(isConsistent(fixed)).toBe(true);
    expect(fixed.weeks[0]).toMatchObject({ completed_at: T1, note_id: 'n', deleted_at: fixed.blocks[0].deleted_at });
  });

  test.each([
    ['held store', RECOVERY_HELD_KEY],
    ['blocks', RECOVERY_BLOCKS_KEY],
    ['weeks', RECOVERY_BLOCK_WEEKS_KEY],
  ])('a failed %s write fails the pass and the next pass converges without loss', async (_n, key) => {
    await seed(
      [blk('a'), blk('b', { started_at: T2 }), blk('dead', { deleted_at: DEL })],
      [wk('w1', 'dead', 'n1', 1), wk('w2', 'ghost', 'n2', 1), wk('w3', 'b', 'n3', 1)]
    );
    const original = jsonStorage.writeList;
    let armed = true;
    const spy = jest.spyOn(jsonStorage, 'writeList').mockImplementation(async (k, l, s) => {
      if (armed && k === key) { armed = false; throw new Error('Injected write failure'); }
      return original(k, l, s);
    });
    await expect(repairRecoveryRecords()).rejects.toThrow('Injected write failure');
    spy.mockRestore();
    await expect(repairRecoveryRecords()).resolves.toMatchObject({ ok: true });
    const s = await read();
    expect(isConsistent(s)).toBe(true);
    // Nothing lost: the detached week is held intact, the tombstoned one kept.
    expect(s.held.map(h => h.record.id)).toEqual(['w2']);
    expect(byId(s.weeks).w1.deleted_at).toBe(DEL);
    expect(byId(s.weeks).w3.deleted_at).toBeNull();
    expect(byId(s.blocks).a.baseline).toEqual(blk('a').baseline);
  });

  test('a failed verification read fails the pass; the retry verifies the persisted result', async () => {
    await seed([blk('b', { deleted_at: DEL })], [wk('w', 'b', 'n', 1)]);
    const original = jsonStorage.readList;
    let reads = 0;
    const spy = jest.spyOn(jsonStorage, 'readList').mockImplementation(async (k) => {
      if (k === RECOVERY_BLOCKS_KEY && (reads += 1) === 3) throw new Error('Injected read failure');
      return original(k);
    });
    await expect(repairRecoveryRecords()).rejects.toThrow('Injected read failure');
    spy.mockRestore();
    expect(await repairRecoveryRecords()).toMatchObject({ ok: true, changed: false });
    expect(isConsistent(await read())).toBe(true);
  });

  test('a pass that sees a concurrent change re-plans instead of overwriting it', async () => {
    await seed([blk('b', { deleted_at: DEL }), blk('live')], [wk('w', 'b', 'n', 1)]);
    const original = jsonStorage.readList;
    let injected = false;
    jest.spyOn(jsonStorage, 'readList').mockImplementation(async (k) => {
      const list = await original(k);
      if (!injected && k === RECOVERY_BLOCK_WEEKS_KEY && list.length === 1) {
        // The first read (planning) returns; a concurrent writer then adds a week.
        const first = list;
        injected = true;
        await AsyncStorage.setItem(k, JSON.stringify([...first, wk('w2', 'live', 'n2', 1)]));
        return first;
      }
      return list;
    });
    await repairRecoveryRecords();
    jest.restoreAllMocks();
    const s = await read();
    expect(s.weeks.map(w => w.id).sort()).toEqual(['w', 'w2']);
    expect(isConsistent(s)).toBe(true);
  });
});

describe('unrepairable records always have a non-destructive way forward', () => {
  const bad = { id: 'bad', baseline_note_id: 'x', started_at: T0, completed_at: null, deleted_at: { not: 'a marker' } };

  test('first pass reports without touching; the next pass sets the record aside byte-for-byte', async () => {
    await seed([blk('good'), bad], [wk('w', 'good', 'n', 1), wk('orphan', 'bad', 'n2', 1)]);
    const first = await repairRecoveryRecords();
    expect(first).toMatchObject({ ok: false, unrepairable: 1 });
    expect((await read()).blocks).toContainEqual(bad);
    expect(isConsistent(await read())).toBe(false);

    const second = await repairRecoveryRecords();
    expect(second).toMatchObject({ ok: true, quarantined: 1 });
    const s = await read();
    expect(isConsistent(s)).toBe(true);
    expect(s.held.find(h => h.kind === 'quarantined').record).toEqual(bad);
    // Its membership is detached (not deleted), good content untouched.
    expect(s.held.find(h => h.record.id === 'orphan').kind).toBe('missing_parent');
    expect(byId(s.blocks).good).toEqual(blk('good'));
  });

  test('a duplicate id with different content keeps the newest and sets the other aside', async () => {
    await seed([blk('b', { updated_at: T1 }), blk('b', { updated_at: T0, reason: 'older' }), blk('b', { updated_at: T1 })], []);
    expect(await repairRecoveryRecords()).toMatchObject({ ok: false, unrepairable: 1 });
    expect(await repairRecoveryRecords()).toMatchObject({ ok: true, quarantined: 1 });
    const s = await read();
    expect(s.blocks).toEqual([blk('b', { updated_at: T1 })]);
    expect(s.held[0].record.reason).toBe('older');
  });

  test('a corrupt payload fails once, then is copied aside and the key reset', async () => {
    await AsyncStorage.setItem(RECOVERY_BLOCK_WEEKS_KEY, '{not json');
    await put(RECOVERY_BLOCKS_KEY, [blk('b')]);
    await expect(repairRecoveryRecords()).rejects.toThrow('Corrupt list data');
    await expect(repairRecoveryRecords()).resolves.toMatchObject({ ok: true });
    expect(await get(RECOVERY_BLOCK_WEEKS_KEY)).toEqual([]);
    expect(await get(RECOVERY_CORRUPT_PAYLOADS_KEY)).toEqual([
      expect.objectContaining({ key: RECOVERY_BLOCK_WEEKS_KEY, raw: '{not json' }),
    ]);
  });
});

describe('reconciliation owns repair', () => {
  test('a pending journaled operation defers repair; once it settles repair runs', async () => {
    // Block 'b' completes via a journaled op whose block write keeps failing;
    // an unrelated tombstoned block 'dead' still has a live week to repair.
    await seed(
      [blk('b'), blk('dead', { deleted_at: DEL })],
      [wk('w', 'b', 'n1', 1), wk('d', 'dead', 'n2', 1)]
    );
    await put(RECOVERY_OPERATION_JOURNAL_KEY, [{
      version: journal.RECOVERY_JOURNAL_VERSION, operation_id: 'op1', created_at: T0, updated_at: T0,
      stage: 'intent', attempts: 0, last_error: null,
      type: journal.RECOVERY_OPERATION_TYPES.COMPLETE_BLOCK_WITH_WEEK, block_id: 'b', week_id: 'w', requested_completed_at: T1,
    }]);
    const original = jsonStorage.writeList;
    const spy = jest.spyOn(jsonStorage, 'writeList').mockImplementation(async (k, l, s) => {
      if (k === RECOVERY_BLOCKS_KEY) throw new Error('Injected write failure');
      return original(k, l, s);
    });
    const stuck = await journal.reconcileRecoveryOperations();
    expect(stuck.pending).toHaveLength(1);
    expect(stuck.repair).toMatchObject({ deferred: true });
    expect(byId((await read()).weeks).d.deleted_at).toBeNull(); // untouched while pending

    spy.mockRestore();
    const settled = await journal.reconcileRecoveryOperations();
    expect(settled.pending).toHaveLength(0);
    expect(settled.repair).toMatchObject({ ok: true, changed: true });
    const s = await read();
    expect(byId(s.weeks).d.deleted_at).toBe(DEL);
    expect(byId(s.blocks).b.completed_at).toBe(T1);
    expect(isConsistent(s)).toBe(true);
  });

  test('a repair failure is reported on the reconciliation instead of throwing', async () => {
    await seed([blk('b', { deleted_at: DEL })], [wk('w', 'b', 'n', 1)]);
    const original = jsonStorage.writeList;
    jest.spyOn(jsonStorage, 'writeList').mockImplementation(async (k, l, s) => {
      if (k === RECOVERY_BLOCK_WEEKS_KEY) throw new Error('disk full');
      return original(k, l, s);
    });
    const rec = await journal.reconcileRecoveryOperations();
    expect(rec.repair).toMatchObject({ ok: false, failed: true });
    // The sync boundary checks `ok` alone, so a failed repair must refuse it.
    expect(rec.ok).toBe(false);
    expect(rec.code).toBe('RECOVERY_REPAIR_INCOMPLETE');
  });

  test('the sync boundary refuses an unrepairable pass, then proceeds once it is set aside', async () => {
    const bad = { id: 'bad', baseline_note_id: 'x', started_at: T0, completed_at: null, deleted_at: { not: 'a marker' } };
    await seed([blk('good'), bad], []);
    const run = jest.fn(async () => 'synced');
    await expect(withRecoveryReconciliation(run)).rejects.toBeTruthy();
    expect(run).not.toHaveBeenCalled();
    // The refused pass set nothing aside; the next one does, and sync runs.
    await expect(withRecoveryReconciliation(run)).resolves.toBe('synced');
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('authoritative read gate (real storage)', () => {
  beforeEach(() => { readState._resetRecoveryAnalyticsFilterCache(); });

  test('a pre-existing inconsistency is repaired, then verified and the gate opens', async () => {
    await seed([blk('b', { deleted_at: DEL })], [wk('w', 'b', 'n', 1)]);
    const outcome = await readState.refreshRecoveryState();
    expect(outcome.ok).toBe(true);
    expect((await readState.ensureVerifiedRecoveryState()).ok).toBe(true);
  });

  const mounted = [];
  afterEach(() => { mounted.splice(0).forEach(r => TestRenderer.act(() => r.unmount())); });
  const flush = () => TestRenderer.act(async () => { await new Promise(r => setImmediate(r)); });
  function mount() {
    const ref = { current: null };
    const Probe = () => { ref.current = readState.useRecoveryBlockState(); return null; };
    let renderer;
    TestRenderer.act(() => { renderer = TestRenderer.create(React.createElement(Probe)); });
    mounted.push(renderer);
    return ref;
  }
  const malformed = { id: 'bad', started_at: T0, completed_at: null, deleted_at: null };

  test('first load: unrepairable data is ERROR/unknown with Retry, never verified Normal; Retry resolves it', async () => {
    await seed([malformed, blk('b')], [wk('w', 'b', 'n', 1)]);
    const ref = mount();
    await flush();
    expect(ref.current).toMatchObject({ status: 'error', ready: false, mutationsAllowed: false });
    expect(ref.current.blocks).toEqual([]);
    expect(String(ref.current.error.message)).toMatch(/malformed/);
    // This exact failed pass denies a confirm-time precondition.
    const denied = await (async () => { __resetRecoveryRepairState(); return readState.ensureVerifiedRecoveryState(); })();
    expect(denied).toMatchObject({ ok: false, code: 'RECOVERY_STATE_UNVERIFIED' });

    await TestRenderer.act(async () => { await ref.current.retryRecovery(); });
    expect(ref.current).toMatchObject({ status: 'ready', ready: true, mutationsAllowed: true });
    expect(ref.current.blocks.map(x => x.id)).toEqual(['b']);
    expect((await read()).held.find(h => h.kind === 'quarantined').record).toEqual(malformed);
    expect((await readState.ensureVerifiedRecoveryState()).ok).toBe(true);
  });

  test('refresh failure over a verified snapshot is STALE with last-known-good and Retry; confirm is denied', async () => {
    await seed([blk('b')], [wk('w', 'b', 'n', 1)]);
    const ref = mount();
    await flush();
    expect(ref.current).toMatchObject({ status: 'ready', ready: true });

    await put(RECOVERY_BLOCKS_KEY, [blk('b'), malformed]);
    await TestRenderer.act(async () => { await ref.current.refresh(); });
    expect(ref.current).toMatchObject({ status: 'stale', stale: true, ready: true });
    expect(ref.current.blocks.map(x => x.id)).toEqual(['b']); // last-known-good
    expect(ref.current.activeBlock.id).toBe('b');

    // A confirmation whose pass is the failing one is denied despite the
    // previously verified snapshot.
    __resetRecoveryRepairState();
    expect(await readState.ensureVerifiedRecoveryState()).toMatchObject({ ok: false, code: 'RECOVERY_STATE_UNVERIFIED' });
    await TestRenderer.act(async () => { await ref.current.retryRecovery(); });
    expect(ref.current).toMatchObject({ status: 'ready', stale: false });
  });

  test('well-formed but inconsistent data the sync merge delivered is repaired, not rejected', async () => {
    await seed([blk('b')], [wk('w', 'b', 'n', 1)]);
    const ref = mount();
    await flush();
    await put(RECOVERY_BLOCKS_KEY, [blk('b'), blk('b2', { started_at: T3 })]);
    await TestRenderer.act(async () => { await ref.current.refresh(); });
    expect(ref.current).toMatchObject({ status: 'ready', stale: false });
    expect(ref.current.activeBlock.id).toBe('b2');
  });

  test('a transient repair write failure is ERROR then Retry unlocks', async () => {
    await seed([blk('b', { deleted_at: DEL })], [wk('w', 'b', 'n', 1)]);
    const original = jsonStorage.writeList;
    const spy = jest.spyOn(jsonStorage, 'writeList').mockImplementation(async (k, l, s) => {
      if (k === RECOVERY_BLOCK_WEEKS_KEY) throw new Error('disk full');
      return original(k, l, s);
    });
    expect((await readState.refreshRecoveryState()).ok).toBe(false);
    spy.mockRestore();
    expect((await readState.refreshRecoveryState()).ok).toBe(true);
  });
});

describe('two devices converge', () => {
  const KEYS = [RECOVERY_BLOCKS_KEY, RECOVERY_BLOCK_WEEKS_KEY];
  // Run one device: load its records, repair, return what it now holds.
  async function onDevice(clientId, { blocks, weeks, held = [] }) {
    await AsyncStorage.clear();
    await AsyncStorage.setItem(CLIENT_ID_KEY, clientId);
    resetClientIdCacheForTests();
    __resetRecoveryRepairState();
    await seed(blocks, weeks);
    await put(RECOVERY_HELD_KEY, held); // device-local, never exchanged
    const writes = spyWrites();
    await repairRecoveryRecords();
    const wrote = writes.mock.calls.length;
    writes.mockRestore();
    return { state: await read(), wrote };
  }
  const exchange = (a, b) => KEYS.map((k, i) => {
    const key = i === 0 ? 'blocks' : 'weeks';
    return [key, [...mergeRecords(a[key], b[key]).values()]];
  });

  async function converge(startA, startB) {
    let a = (await onDevice('dev_a', startA)).state;
    let b = (await onDevice('dev_b', startB)).state;
    let quiet = 0;
    for (let round = 0; round < 6 && quiet < 2; round += 1) {
      const [[, ab], [, aw]] = exchange(a, b);
      const [[, bb], [, bw]] = exchange(b, a);
      const ra = await onDevice('dev_a', { blocks: ab, weeks: aw, held: a.held });
      const rb = await onDevice('dev_b', { blocks: bb, weeks: bw, held: b.held });
      a = ra.state; b = rb.state;
      quiet = ra.wrote + rb.wrote === 0 ? quiet + 1 : 0;
    }
    return { a, b, quiet };
  }

  const conflict = {
    blocks: [blk('a1'), blk('b1', { started_at: T2 }), blk('dead', { deleted_at: DEL, updated_at: DEL })],
    weeks: [
      wk('w1', 'a1', 'n1', 1, { saved_at: T0 }), wk('w2', 'b1', 'n1', 1, { saved_at: T1 }),
      wk('w3', 'dead', 'n2', 1), wk('w4', 'b1', 'n3', 1, { saved_at: T2 }), wk('w5', 'a1', 'n4', 2, { saved_at: T3 }),
    ],
  };

  test('same conflicting records in different orders reach the identical domain state, then go quiet', async () => {
    const { a, b, quiet } = await converge(conflict, {
      blocks: [...conflict.blocks].reverse(), weeks: [...conflict.weeks].reverse(),
    });
    expect(domain(a)).toEqual(domain(b));
    expect(isConsistent(a)).toBe(true);
    expect(quiet).toBeGreaterThanOrEqual(2);
    const m = byId(a.weeks);
    expect(m.w1.deleted_at).toBeNull(); // earliest survivor
    expect(m.w2.deleted_at).toBe(T1);
    expect(m.w3.deleted_at).toBe(DEL);
  });

  test('out-of-order delivery: the week reaches a device before its block, then converges', async () => {
    const block = blk('p');
    const week = wk('wp', 'p', 'n', 1);
    const { a, b, quiet } = await converge({ blocks: [block], weeks: [week] }, { blocks: [], weeks: [week] });
    expect(domain(a)).toEqual(domain(b));
    expect(a.weeks).toHaveLength(1);
    expect(a.weeks[0].deleted_at).toBeNull();
    expect(b.held).toEqual([]);
    expect(quiet).toBeGreaterThanOrEqual(2);
  });

  test('a newer incoming tombstone is not resurrected by the other device repair', async () => {
    const gone = wk('w', 'b', 'n', 1, { deleted_at: T3, updated_at: T3, client_id: 'dev_b' });
    const { a, b } = await converge(
      { blocks: [blk('b')], weeks: [wk('w', 'b', 'n', 1)] },
      { blocks: [blk('b')], weeks: [gone] }
    );
    expect(domain(a)).toEqual(domain(b));
    expect(a.weeks[0].deleted_at).toBe(T3);
  });

  test('exact updated_at ties resolve to one winner on both devices', async () => {
    const x = wk('w', 'b', 'n', 1, { client_id: 'dev_a', completed_at: T1 });
    const y = wk('w', 'b', 'n', 1, { client_id: 'dev_b', completed_at: null });
    const { a, b } = await converge({ blocks: [blk('b')], weeks: [x] }, { blocks: [blk('b')], weeks: [y] });
    expect(domain(a)).toEqual(domain(b));
  });

  test('a permanently missing parent stays held on both devices and never blocks the read', async () => {
    const orphan = wk('o', 'never', 'n', 1);
    const { a, b } = await converge({ blocks: [blk('ok')], weeks: [orphan] }, { blocks: [blk('ok')], weeks: [orphan] });
    expect(domain(a)).toEqual(domain(b));
    expect(a.held.map(h => h.record.id)).toEqual(['o']);
    expect(isConsistent(a)).toBe(true);
  });
});

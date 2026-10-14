// Bounded local Recovery repair (#1368). Real persisted paths throughout:
// AsyncStorage-backed lists, the real exclusive reconcile boundary, the real
// dirty queue, and the real authoritative read. Only startup scheduling and the
// storage-mode hook module are stubbed (no UI, no cloud).
//
// Binding invariant asserted everywhere: no record ever leaves the synced
// collections, and anything not in the four approved repairs is left
// byte-for-byte in place and reported as unresolved.

import React from 'react';
import TestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  RECOVERY_BLOCKS_KEY,
  RECOVERY_BLOCK_WEEKS_KEY,
  RECOVERY_OPERATION_JOURNAL_KEY,
} from '../storage/entries/keys';
import * as jsonStorage from '../storage/entries/jsonStorage';
import { setStorageMode, STORAGE_MODES } from '../storage/entries/storageMode';
import { getDirtyRecords, SYNC_TABLES } from '../storage/syncQueue';
import { planRecoveryRepair } from '../storage/entries/recoveryRepair';
import * as journal from '../storage/entries/recoveryOperationJournal';

jest.mock('../storage/entries/startupTiming', () => ({
  ...jest.requireActual('../storage/entries/startupTiming'),
  markStartupPhase: jest.fn(),
  recordStartupReconcileStart: jest.fn(),
  whenStartupBackgroundWorkReleased: jest.fn((task) => { task(); return () => {}; }),
}));
jest.mock('../hooks/entries/storageMode', () => ({}));

const ReadState = require('../hooks/entries/recoveryReadState');

const T = (n) => `2026-01-${String(n).padStart(2, '0')}T00:00:00.000Z`;

function block(id, extra = {}) {
  return {
    id, baseline_note_id: `base_${id}`, started_at: T(1), saved_at: T(1), updated_at: T(1),
    completed_at: null, deleted_at: null, ...extra,
  };
}
function week(id, blockId, noteId, weekNumber, extra = {}) {
  return {
    id, block_id: blockId, note_id: noteId, week_number: weekNumber,
    saved_at: T(2), updated_at: T(2), completed_at: null, deleted_at: null, ...extra,
  };
}

const seed = (key, value) => AsyncStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
const rawOf = (key) => AsyncStorage.getItem(key);
const load = async (key) => JSON.parse((await rawOf(key)) || '[]');
const blocksRaw = () => rawOf(RECOVERY_BLOCKS_KEY);
const weeksRaw = () => rawOf(RECOVERY_BLOCK_WEEKS_KEY);
const byId = (list, id) => list.find((r) => r.id === id);
const ids = (list) => list.map((r) => r.id).sort();

function countWrites() {
  const spy = jest.spyOn(AsyncStorage, 'setItem');
  spy.mockClear();
  return spy;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  journal.__resetRecoveryOperationJournal();
  ReadState._resetRecoveryAnalyticsFilterCache();
  setStorageMode(STORAGE_MODES.LOCAL);
});
afterEach(() => {
  jest.restoreAllMocks();
  setStorageMode(STORAGE_MODES.LOCAL);
});

describe('automatic repairs (shared policy)', () => {
  test('explicit parent tombstone cascades surviving live weeks, retaining every row', async () => {
    setStorageMode(STORAGE_MODES.CLOUD);
    const dead = T(9);
    await seed(RECOVERY_BLOCKS_KEY, [block('b1', { deleted_at: dead })]);
    await seed(RECOVERY_BLOCK_WEEKS_KEY, [
      week('w1', 'b1', 'n1', 1),
      week('w2', 'b1', 'n2', 2, { deleted_at: T(5) }),
    ]);

    const res = await journal.reconcileRecoveryOperations();

    expect(res.ok).toBe(true);
    expect(res.repair.ok).toBe(true);
    const weeks = await load(RECOVERY_BLOCK_WEEKS_KEY);
    expect(ids(weeks)).toEqual(['w1', 'w2']);
    expect(byId(weeks, 'w1').deleted_at).toBe(dead);
    expect(byId(weeks, 'w1').note_id).toBe('n1');
    expect(byId(weeks, 'w2').deleted_at).toBe(T(5)); // existing tombstone kept
    const dirty = await getDirtyRecords(SYNC_TABLES.RECOVERY_BLOCK_WEEKS);
    expect(dirty.map((d) => d.id)).toEqual(['w1']);
    expect((await load(RECOVERY_BLOCKS_KEY)).length).toBe(1);
  });

  test('an interrupted block delete (parent tombstoned, weeks live) converges on the next pass', async () => {
    await seed(RECOVERY_BLOCKS_KEY, [block('b1', { deleted_at: T(9) }), block('b2')]);
    await seed(RECOVERY_BLOCK_WEEKS_KEY, [week('w1', 'b1', 'n1', 1), week('w2', 'b2', 'n2', 1)]);
    await journal.reconcileRecoveryOperations();
    const weeks = await load(RECOVERY_BLOCK_WEEKS_KEY);
    expect(byId(weeks, 'w1').deleted_at).toBe(T(9));
    expect(byId(weeks, 'w2').deleted_at).toBeNull();
  });

  test('multiple active blocks: latest start survives, older ones are completed, history kept', async () => {
    await seed(RECOVERY_BLOCKS_KEY, [
      block('bA', { started_at: T(3) }),
      block('bB', { started_at: T(5) }),
      block('bC', { started_at: T(1), completed_at: T(2) }),
    ]);
    await journal.reconcileRecoveryOperations();
    const blocks = await load(RECOVERY_BLOCKS_KEY);
    expect(ids(blocks)).toEqual(['bA', 'bB', 'bC']);
    expect(byId(blocks, 'bB').completed_at).toBeNull();
    expect(byId(blocks, 'bA').completed_at).toBe(T(5));
    expect(byId(blocks, 'bC').completed_at).toBe(T(2));
  });

  test('duplicate note membership across blocks keeps the earliest and tombstones the rest', async () => {
    await seed(RECOVERY_BLOCKS_KEY, [block('b1', { completed_at: T(4) }), block('b2')]);
    await seed(RECOVERY_BLOCK_WEEKS_KEY, [
      week('w2', 'b2', 'n1', 1, { saved_at: T(6) }),
      week('w1', 'b1', 'n1', 1, { saved_at: T(2) }),
    ]);
    await journal.reconcileRecoveryOperations();
    const weeks = await load(RECOVERY_BLOCK_WEEKS_KEY);
    expect(ids(weeks)).toEqual(['w1', 'w2']);
    expect(byId(weeks, 'w1').deleted_at).toBeNull();
    expect(byId(weeks, 'w2').deleted_at).toBeTruthy();
  });

  test('colliding ordinals renumber deterministically whatever the input order', async () => {
    const blocks = [block('b1')];
    const weeks = [
      week('w1', 'b1', 'n1', 1, { saved_at: T(2) }),
      week('w2', 'b1', 'n2', 1, { saved_at: T(3) }),
      week('w3', 'b1', 'n3', 2, { saved_at: T(2) }),
      week('w4', 'b1', 'n4', 2, { saved_at: T(4) }),
      week('w5', 'b1', 'n5', 4, { saved_at: T(2) }),
    ];
    const domain = (plan) => plan.weeks
      .map((w) => `${w.id}:${w.week_number}:${w.deleted_at ? 'x' : 'live'}`).sort();
    const forward = domain(planRecoveryRepair(blocks, weeks, 'devA'));
    const reversed = domain(planRecoveryRepair(blocks, weeks.slice().reverse(), 'devB'));
    const shuffled = domain(planRecoveryRepair(blocks, [weeks[3], weeks[0], weeks[4], weeks[2], weeks[1]], 'devC'));
    expect(reversed).toEqual(forward);
    expect(shuffled).toEqual(forward);
    expect(forward).toEqual(['w1:1:live', 'w2:5:live', 'w3:2:live', 'w4:6:live', 'w5:4:live']);
  });

  test('winners are chosen by instant, not string, across mixed UTC offsets', async () => {
    const later = '2026-12-31T23:00:00-02:00'; // 2027-01-01T01:00Z
    const earlier = '2027-01-01T00:00:00Z';
    await seed(RECOVERY_BLOCKS_KEY, [
      block('bA', { started_at: later }),
      block('bB', { started_at: earlier }),
    ]);
    await seed(RECOVERY_BLOCK_WEEKS_KEY, [
      week('w1', 'bA', 'n1', 1, { saved_at: later }),
      week('w2', 'bA', 'n1', 2, { saved_at: earlier }),
    ]);
    await journal.reconcileRecoveryOperations();
    const blocks = await load(RECOVERY_BLOCKS_KEY);
    expect(byId(blocks, 'bA').completed_at).toBeNull(); // later instant survives
    expect(byId(blocks, 'bB').completed_at).toBe(later);
    const weeks = await load(RECOVERY_BLOCK_WEEKS_KEY);
    expect(byId(weeks, 'w2').deleted_at).toBeNull(); // earliest instant kept
    expect(byId(weeks, 'w1').deleted_at).toBeTruthy();
  });

  test('equal instants with different strings tie-break by id on any input order', async () => {
    const a = '2027-01-01T00:00:00Z';
    const b = '2027-01-01T01:00:00+01:00';
    const blocks = [block('bA', { started_at: a }), block('bB', { started_at: b })];
    const weeks = [
      week('w1', 'bA', 'n1', 1, { saved_at: a }),
      week('w2', 'bA', 'n1', 2, { saved_at: b }),
    ];
    const outcome = (bl, wk) => {
      const plan = planRecoveryRepair(bl, wk, 'c');
      return [
        plan.blocks.filter((x) => !x.completed_at).map((x) => x.id),
        plan.weeks.filter((x) => !x.deleted_at).map((x) => x.id),
      ];
    };
    expect(outcome(blocks, weeks)).toEqual([['bB'], ['w1']]);
    expect(outcome(blocks.slice().reverse(), weeks.slice().reverse())).toEqual([['bB'], ['w1']]);
  });

  test('unparseable timestamps are never compared: nothing is repaired', async () => {
    const blocks = [block('bA', { started_at: 'zzz' }), block('bB')];
    expect(planRecoveryRepair(blocks, [], 'c').changedBlocks).toEqual([]);
    const weeks = [week('w1', 'bA', 'n1', 1, { saved_at: 'nope' }), week('w2', 'bA', 'n1', 2)];
    expect(planRecoveryRepair([block('bA')], weeks, 'c').changedWeeks).toEqual([]);
  });

  test('two devices repairing equivalent conflicts in different orders reach the same domain state', async () => {
    const blocks = [block('bA', { started_at: T(3) }), block('bB', { started_at: T(5) })];
    const weeks = [
      week('w1', 'bB', 'n1', 1, { saved_at: T(6) }),
      week('w2', 'bA', 'n1', 1, { saved_at: T(4) }),
      week('w3', 'bB', 'n2', 1, { saved_at: T(7) }),
    ];
    const strip = ({ updated_at, client_id, ...rest }) => rest; // eslint-disable-line no-unused-vars
    const a = planRecoveryRepair(blocks, weeks, 'devA');
    const b = planRecoveryRepair(blocks.slice().reverse(), weeks.slice().reverse(), 'devB');
    const norm = (list) => list.map(strip).sort((x, y) => x.id.localeCompare(y.id));
    expect(norm(b.blocks)).toEqual(norm(a.blocks));
    expect(norm(b.weeks)).toEqual(norm(a.weeks));
  });

  test('a resolved dataset is idempotent: the second pass writes nothing', async () => {
    await seed(RECOVERY_BLOCKS_KEY, [block('bA', { started_at: T(3) }), block('bB', { started_at: T(5) })]);
    await seed(RECOVERY_BLOCK_WEEKS_KEY, [week('w1', 'bB', 'n1', 1), week('w2', 'bB', 'n2', 1, { saved_at: T(3) })]);
    await journal.reconcileRecoveryOperations();
    const [b1, w1] = [await blocksRaw(), await weeksRaw()];
    const writes = countWrites();
    const res = await journal.reconcileRecoveryOperations();
    expect(res.repair).toEqual({ ok: true, changed: 0, error: null });
    expect(writes).not.toHaveBeenCalled();
    expect([await blocksRaw(), await weeksRaw()]).toEqual([b1, w1]);
  });

  test('valid empty state, completed history, and gaps are left alone', async () => {
    await seed(RECOVERY_BLOCKS_KEY, [block('b1', { completed_at: T(4) })]);
    await seed(RECOVERY_BLOCK_WEEKS_KEY, [week('w1', 'b1', 'n1', 1), week('w2', 'b1', 'n2', 5)]);
    const [b, w] = [await blocksRaw(), await weeksRaw()];
    const writes = countWrites();
    await journal.reconcileRecoveryOperations();
    expect(writes).not.toHaveBeenCalled();
    expect([await blocksRaw(), await weeksRaw()]).toEqual([b, w]);
    await AsyncStorage.clear();
    expect((await journal.reconcileRecoveryOperations()).repair.ok).toBe(true);
  });
});

describe('unsafe or unresolved data stays byte-for-byte in place', () => {
  const unchanged = async (blocks, weeks) => {
    await seed(RECOVERY_BLOCKS_KEY, blocks);
    await seed(RECOVERY_BLOCK_WEEKS_KEY, weeks);
    const [b, w] = [await blocksRaw(), await weeksRaw()];
    const writes = countWrites();
    const res = await journal.reconcileRecoveryOperations();
    expect(writes).not.toHaveBeenCalled();
    expect([await blocksRaw(), await weeksRaw()]).toEqual([b, w]);
    return res;
  };

  test('missing parent (even permanently) is not treated as deletion', async () => {
    const res = await unchanged([block('b1')], [week('w1', 'ghost', 'n1', 1)]);
    expect(res.ok).toBe(true);
    expect(res.repair.ok).toBe(true);
  });

  test('collision at MAX_SAFE_INTEGER is not renumbered', async () => {
    await unchanged([block('b1')], [
      week('w1', 'b1', 'n1', Number.MAX_SAFE_INTEGER),
      week('w2', 'b1', 'n2', Number.MAX_SAFE_INTEGER, { saved_at: T(3) }),
    ]);
  });

  test('unsafe 1e20 ordinals (malformed) are not touched', async () => {
    await unchanged([block('b1')], [week('w1', 'b1', 'n1', 1e20), week('w2', 'b1', 'n2', 1e20)]);
  });

  test('duplicate ids and ambiguous identity block every repair', async () => {
    await unchanged(
      [block('b1', { deleted_at: T(9) }), block('b1')],
      [week('w1', 'b1', 'n1', 1)]
    );
  });

  test('null rows and invalid markers are left as found', async () => {
    await unchanged([block('b1', { deleted_at: T(9) }), null], [week('w1', 'b1', 'n1', 1)]);
    await unchanged([block('b1', { completed_at: 'nope' })], [week('w1', 'b1', 'n1', 1)]);
  });

  test('malformed JSON is neither overwritten nor reset and fails the pass truthfully', async () => {
    await seed(RECOVERY_BLOCKS_KEY, '{not json');
    await seed(RECOVERY_BLOCK_WEEKS_KEY, [week('w1', 'b1', 'n1', 1)]);
    const writes = countWrites();
    const res = await journal.reconcileRecoveryOperations();
    expect(res.ok).toBe(true);
    expect(res.repair.ok).toBe(false);
    expect(writes).not.toHaveBeenCalled();
    expect(await blocksRaw()).toBe('{not json');
  });

  test('baseline-note membership and an earlier open week are not invented away', async () => {
    await unchanged([block('b1')], [week('w1', 'b1', 'base_b1', 1)]);
    await unchanged([block('b1')], [week('w1', 'b1', 'n1', 1), week('w2', 'b1', 'n2', 2)]);
  });

  test('an independent safe repair does not depend on an unresolved orphan', async () => {
    await seed(RECOVERY_BLOCKS_KEY, [block('b1', { deleted_at: T(9) }), block('b2')]);
    const orphan = week('wo', 'ghost', 'n9', 1);
    await seed(RECOVERY_BLOCK_WEEKS_KEY, [week('w1', 'b1', 'n1', 1), orphan, week('w2', 'b2', 'n9', 1, { saved_at: T(5) })]);
    await journal.reconcileRecoveryOperations();
    const weeks = await load(RECOVERY_BLOCK_WEEKS_KEY);
    expect(byId(weeks, 'w1').deleted_at).toBe(T(9));
    expect(byId(weeks, 'wo')).toEqual(orphan);
    expect(byId(weeks, 'w2').deleted_at).toBeNull();
  });
});

describe('authoritative read honesty', () => {
  const run = () => ReadState.refreshRecoveryState();

  // Capture the shared read-model the Home/Log/Analytics screens consume.
  const readModel = () => {
    let value;
    const Probe = () => { value = ReadState.useRecoveryBlockState(); return null; };
    let renderer;
    TestRenderer.act(() => { renderer = TestRenderer.create(React.createElement(Probe)); });
    return { get: () => value, unmount: () => TestRenderer.act(() => renderer.unmount()) };
  };

  test('a permanently missing parent: verified state excluding it, honest unresolved flag, Retry', async () => {
    await seed(RECOVERY_BLOCKS_KEY, [block('b1')]);
    await seed(RECOVERY_BLOCK_WEEKS_KEY, [week('w1', 'b1', 'n1', 1), week('wo', 'ghost', 'n2', 1)]);
    const before = await weeksRaw();

    const outcome = await run();
    const model = readModel();
    await TestRenderer.act(async () => { await run(); });
    const view = model.get();

    // The orphan cannot change the mode, so the rest verifies (owner direction:
    // ignored for operational state, surfaced, only dependent actions blocked).
    expect(outcome.ok).toBe(true);
    expect(outcome.unresolvedCount).toBe(1);
    // Unrelated Recovery data stays usable; the orphan is excluded.
    expect(view.ready).toBe(true);
    expect(view.activeBlock.id).toBe('b1');
    expect(view.weeks.map((w) => w.id)).toEqual(['w1']);
    // Never presented as a clean snapshot: notice (stale presentation) + Retry.
    expect(view.unresolvedCount).toBe(1);
    expect(view.stale).toBe(true);
    expect(typeof view.retryRecovery).toBe('function');
    // Recovery actions stay open; only ones touching the orphan are refused
    // (see the dependent-action tests below).
    expect(view.mutationsAllowed).toBe(true);
    expect((await ReadState.ensureVerifiedRecoveryState()).ok).toBe(true);
    // Raw bytes untouched, and a second unchanged pass writes nothing.
    expect(await weeksRaw()).toBe(before);
    const writes = countWrites();
    await run();
    expect(writes).not.toHaveBeenCalled();
    model.unmount();
  });

  test('Retry clears the flag and reopens mutations once the legitimate parent arrives', async () => {
    await seed(RECOVERY_BLOCKS_KEY, [block('b0', { completed_at: T(2) })]);
    await seed(RECOVERY_BLOCK_WEEKS_KEY, [week('w1', 'b1', 'n1', 1)]);
    const model = readModel();
    await TestRenderer.act(async () => { await run(); });
    expect(model.get().unresolvedCount).toBe(1);
    await seed(RECOVERY_BLOCKS_KEY, [block('b0', { completed_at: T(2) }), block('b1')]);
    await TestRenderer.act(async () => { await model.get().retryRecovery(); });
    expect(model.get().unresolvedCount).toBe(0);
    expect(model.get().stale).toBe(false);
    expect(model.get().mutationsAllowed).toBe(true);
    expect((await ReadState.ensureVerifiedRecoveryState()).ok).toBe(true);
    model.unmount();
  });

  test('malformed records stay fail-closed (#1366): unknown, not verified', async () => {
    await seed(RECOVERY_BLOCKS_KEY, [block('b1', { deleted_at: 'not a date' })]);
    await seed(RECOVERY_BLOCK_WEEKS_KEY, []);
    const model = readModel();
    await TestRenderer.act(async () => { await run(); });
    expect(model.get().ready).toBe(false);
    expect(model.get().error).toBeTruthy();
    expect(model.get().mutationsAllowed).toBe(false);
    model.unmount();
  });

  test('mode-relevant unresolved data on refresh is STALE keeping last-known-good; only dependent actions refused', async () => {
    await seed(RECOVERY_BLOCKS_KEY, [block('b1')]);
    await seed(RECOVERY_BLOCK_WEEKS_KEY, [week('w1', 'b1', 'n1', 1)]);
    const model = readModel();
    await TestRenderer.act(async () => { await run(); });
    expect(model.get().activeBlock.id).toBe('b1');
    // A second record with the active block's id: which one is active is now
    // ambiguous, so the mode answer cannot be trusted.
    await seed(RECOVERY_BLOCKS_KEY, [block('b1'), block('b1', { completed_at: T(4) })]);
    let gate;
    await TestRenderer.act(async () => { gate = await ReadState.ensureVerifiedRecoveryState(); });
    // The confirm gate does not refuse every edit; it reports the condition and
    // the journal entry points refuse only dependent actions.
    expect(gate).toEqual({ ok: true, unresolved: true });
    const action = jest.fn(async () => ({ ok: true }));
    expect((await journal.runGuardedRecoveryAction({ blockId: 'b1' }, action)).reason).toBe('RECOVERY_DATA_UNRESOLVED');
    expect((await journal.runGuardedRecoveryAction({}, action)).reason).toBe('RECOVERY_DATA_UNRESOLVED');
    expect(action).not.toHaveBeenCalled();
    expect(model.get().stale).toBe(true);
    expect(model.get().activeBlock.id).toBe('b1');
    expect(model.get().mutationsAllowed).toBe(true);
    model.unmount();
  });

  test('mode-relevant unresolved data on first load is unknown (ERROR), never Normal', async () => {
    await seed(RECOVERY_BLOCKS_KEY, [block('b1'), block('b1', { completed_at: T(4) })]);
    await seed(RECOVERY_BLOCK_WEEKS_KEY, []);
    const model = readModel();
    await TestRenderer.act(async () => { await run(); });
    expect(model.get().ready).toBe(false);
    expect(model.get().error).toBeTruthy();
    expect(model.get().mutationsAllowed).toBe(false);
    model.unmount();
  });

  test('repair makes a safely repairable dataset verify in one pass', async () => {
    await seed(RECOVERY_BLOCKS_KEY, [block('bA', { started_at: T(3) }), block('bB', { started_at: T(5) })]);
    await seed(RECOVERY_BLOCK_WEEKS_KEY, []);
    expect((await run()).ok).toBe(true);
  });

  test('unsafe ordinals stay unresolved and unchanged across passes', async () => {
    await seed(RECOVERY_BLOCKS_KEY, [block('b1')]);
    await seed(RECOVERY_BLOCK_WEEKS_KEY, [
      week('w1', 'b1', 'n1', Number.MAX_SAFE_INTEGER),
      week('w2', 'b1', 'n2', Number.MAX_SAFE_INTEGER, { saved_at: T(3) }),
    ]);
    const before = await weeksRaw();
    expect((await run()).ok).toBe(false);
    expect((await run()).ok).toBe(false);
    expect(await weeksRaw()).toBe(before);
  });
});

describe('failure injection', () => {
  const seedCascade = async () => {
    await seed(RECOVERY_BLOCKS_KEY, [block('b1', { deleted_at: T(9) })]);
    await seed(RECOVERY_BLOCK_WEEKS_KEY, [week('w1', 'b1', 'n1', 1)]);
  };

  test('a write failure keeps the evidence, reports failure, and Retry recovers', async () => {
    await seedCascade();
    const before = await weeksRaw();
    const { secureStorage } = require('../storage/secureStorage');
    const original = secureStorage.updateItem.bind(secureStorage);
    const spy = jest.spyOn(secureStorage, 'updateItem').mockImplementation(async () => { throw new Error('disk'); });
    const res = await journal.reconcileRecoveryOperations();
    expect(res.ok).toBe(true);
    expect(res.repair.ok).toBe(false);
    expect(await weeksRaw()).toBe(before);
    expect((await ReadState.refreshRecoveryState()).ok).toBe(false);
    spy.mockImplementation(original);
    expect((await ReadState.refreshRecoveryState()).ok).toBe(true);
    expect(byId(await load(RECOVERY_BLOCK_WEEKS_KEY), 'w1').deleted_at).toBe(T(9));
  });

  test('an enqueue failure in cloud mode writes nothing and retries cleanly', async () => {
    setStorageMode(STORAGE_MODES.CLOUD);
    await seedCascade();
    const before = await weeksRaw();
    const queueKeySpy = jest.spyOn(AsyncStorage, 'setItem');
    queueKeySpy.mockImplementationOnce(async () => { throw new Error('queue'); });
    const res = await journal.reconcileRecoveryOperations();
    expect(res.repair.ok).toBe(false);
    expect(await weeksRaw()).toBe(before);
    expect((await journal.reconcileRecoveryOperations()).repair.ok).toBe(true);
    expect(byId(await load(RECOVERY_BLOCK_WEEKS_KEY), 'w1').deleted_at).toBe(T(9));
    expect((await getDirtyRecords(SYNC_TABLES.RECOVERY_BLOCK_WEEKS)).map((d) => d.id)).toEqual(['w1']);
  });

  test('a post-write verification mismatch is a truthful failure', async () => {
    await seedCascade();
    const real = jsonStorage.readList;
    let weekReads = 0;
    jest.spyOn(jsonStorage, 'readList').mockImplementation(async (key) => {
      if (key === RECOVERY_BLOCK_WEEKS_KEY) weekReads += 1;
      // weeks reads: initial (1), post-write verify (2): serve stale. (The
      // compare-and-set read happens inside the atomic updateItem.)
      if (key === RECOVERY_BLOCK_WEEKS_KEY && weekReads === 2) return [week('w1', 'b1', 'n1', 1)];
      return real(key);
    });
    const res = await journal.reconcileRecoveryOperations();
    expect(res.repair.ok).toBe(false);
  });

  test('a read failure fails the pass without writing', async () => {
    await seedCascade();
    const real = jsonStorage.readList;
    jest.spyOn(jsonStorage, 'readList').mockImplementation(async (key) => {
      if (key === RECOVERY_BLOCK_WEEKS_KEY) throw new Error('read');
      return real(key);
    });
    const writes = countWrites();
    const res = await journal.reconcileRecoveryOperations();
    expect(res.repair.ok).toBe(false);
    expect(writes).not.toHaveBeenCalled();
  });

  test('a pending journal intent skips repair and never alters its postconditions', async () => {
    await seedCascade();
    await seed(RECOVERY_OPERATION_JOURNAL_KEY, [{
      version: journal.RECOVERY_JOURNAL_VERSION,
      operation_id: 'recop_seed_1',
      created_at: T(3),
      updated_at: T(3),
      stage: journal.RECOVERY_OPERATION_STAGES.INTENT,
      attempts: 0,
      last_error: null,
      type: journal.RECOVERY_OPERATION_TYPES.DELETE_LINKED_NOTE,
      week_id: 'w1',
      note_id: 'n1',
      requested_deleted_at: T(4),
    }]);
    journal.setRecoveryNoteOperations({
      loadNoteState: async () => { throw new Error('note store unavailable'); },
    });
    const b = await blocksRaw();
    const res = await journal.reconcileRecoveryOperations();
    expect(res.ok).toBe(false);
    expect(res.pending.length).toBe(1);
    expect(res.repair.skipped).toBe(true);
    expect(await blocksRaw()).toBe(b);
    // Only the pending operation's own immutable intent applied (T(4)), never the
    // repair's cascade value (T(9)).
    expect(byId(await load(RECOVERY_BLOCK_WEEKS_KEY), 'w1').deleted_at).toBe(T(4));
    expect((await journal.readRecoveryJournal()).length).toBe(1);
  });

  test('guarded actions and operation starts reconcile WITHOUT repairing (zero writes)', async () => {
    await seedCascade();
    const [b, w] = [await blocksRaw(), await weeksRaw()];
    const writes = countWrites();
    const action = jest.fn(async () => ({ ok: true }));
    // An unrelated block's action runs; the tombstoned block's live week is
    // unresolved until the sync-boundary repair cascades it, so b1 is refused.
    await journal.runGuardedRecoveryAction({ blockId: 'b2' }, action);
    const refused = await journal.runGuardedRecoveryAction({ blockId: 'b1' }, action);
    await journal.startRecoveryOperation({
      scope: { blockId: 'b2' },
      validate: async () => ({ ok: false, error: 'rejected' }),
    });
    expect(action).toHaveBeenCalledTimes(1);
    expect(refused.reason).toBe('RECOVERY_DATA_UNRESOLVED');
    expect(writes).not.toHaveBeenCalled();
    expect([await blocksRaw(), await weeksRaw()]).toEqual([b, w]);
    // The sync boundary's reconcile does repair.
    await journal.withExclusiveRecoveryAccess(({ reconcile }) => reconcile());
    expect(byId(await load(RECOVERY_BLOCK_WEEKS_KEY), 'w1').deleted_at).toBe(T(9));
  });

  test('unresolved domain data never turns the journal result into a sync gate', async () => {
    await seed(RECOVERY_BLOCKS_KEY, [block('b1')]);
    await seed(RECOVERY_BLOCK_WEEKS_KEY, [week('w1', 'ghost', 'n1', 1)]);
    const res = await journal.reconcileRecoveryOperations();
    expect(res.ok).toBe(true);
    expect(res.pending).toEqual([]);
    expect(res.corrupt).toBe(false);
  });
});

describe('dependent-action gate (#1368)', () => {
  const orphanSeed = async () => {
    await seed(RECOVERY_BLOCKS_KEY, [block('b1', { completed_at: T(3) })]);
    await seed(RECOVERY_BLOCK_WEEKS_KEY, [week('w1', 'b1', 'n1', 1, { completed_at: T(3) }), week('wo', 'ghost', 'n9', 1)]);
  };

  test('an unrelated orphan does not block an independent edit (include_in_normal_analytics on b1)', async () => {
    await orphanSeed();
    const action = jest.fn(async () => ({ ok: true }));
    const res = await journal.runGuardedRecoveryAction({ blockId: 'b1' }, action);
    expect(action).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(true);
  });

  test('actions touching the unresolved record or its note are refused with zero writes', async () => {
    await orphanSeed();
    const writes = countWrites();
    const action = jest.fn(async () => ({ ok: true }));
    for (const scope of [{ blockId: 'ghost' }, { weekId: 'wo' }, { noteId: 'n9' }]) {
      const res = await journal.runGuardedRecoveryAction(scope, action);
      expect(res.ok).toBe(false);
      expect(res.reason).toBe('RECOVERY_DATA_UNRESOLVED');
    }
    expect(action).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
  });

  test('a global action (start a block) is refused only when unresolved data could change the mode', async () => {
    await orphanSeed();
    const action = jest.fn(async () => ({ ok: true }));
    expect((await journal.runGuardedRecoveryAction({}, action)).ok).toBe(true);
    await seed(RECOVERY_BLOCKS_KEY, [block('bA'), block('bA', { completed_at: T(4) })]);
    const res = await journal.runGuardedRecoveryAction({}, action);
    expect(res.reason).toBe('RECOVERY_DATA_UNRESOLVED');
    expect(action).toHaveBeenCalledTimes(1);
  });
});

describe('repair safety: reserved slots and concurrent writers (#1368)', () => {
  test('an excluded baseline-note row still reserves its ordinal slot', () => {
    const blocks = [block('b1', { completed_at: T(3) })];
    const weeks = [
      week('w1', 'b1', 'n1', 1, { saved_at: T(2) }),
      week('w2', 'b1', 'n2', 1, { saved_at: T(3) }),
      week('wb', 'b1', 'base_b1', 2),
    ];
    const plan = planRecoveryRepair(blocks, weeks, 'c1');
    const numbers = plan.weeks.filter((w) => !w.deleted_at).map((w) => `${w.id}:${w.week_number}`).sort();
    expect(numbers).toEqual(['w1:1', 'w2:3', 'wb:2']);
  });

  test('a write admitted just before the repair write is never overwritten (atomic compare-and-set)', async () => {
    await seed(RECOVERY_BLOCKS_KEY, [block('b1', { deleted_at: T(9) })]);
    await seed(RECOVERY_BLOCK_WEEKS_KEY, [week('w1', 'b1', 'n1', 1)]);
    const { secureStorage } = require('../storage/secureStorage');
    const original = secureStorage.updateItem.bind(secureStorage);
    let raced = false;
    jest.spyOn(secureStorage, 'updateItem').mockImplementation(async (key, transform) => {
      // Another writer is admitted after planning, immediately before the
      // repair's own locked read/transform/write.
      if (key === RECOVERY_BLOCK_WEEKS_KEY && !raced) {
        raced = true;
        const current = await jsonStorage.readList(key);
        await jsonStorage.writeList(key, [...current, week('w2', 'b2', 'n2', 1)]);
      }
      return original(key, transform);
    });
    await journal.withExclusiveRecoveryAccess(({ reconcile }) => reconcile());
    const weeks = await load(RECOVERY_BLOCK_WEEKS_KEY);
    expect(ids(weeks)).toEqual(['w1', 'w2']);
    expect(byId(weeks, 'w1').deleted_at).toBe(T(9));
  });

  test('cloud resolution applies the same guards: a missing-parent membership is never retracted', () => {
    const { resolveDuplicateWeekMemberships } = require('../storage/cloud/syncRecoveryResolution');
    const blocks = [block('b1')];
    const w1 = week('w1', 'b1', 'n1', 1, { saved_at: T(2) });
    const wo = week('wo', 'ghost', 'n1', 1, { saved_at: T(3) });
    const res = resolveDuplicateWeekMemberships([w1, wo], 'c1', { blocks });
    expect(res.changed).toEqual([]);
    expect(res.list).toEqual([w1, wo]);
  });
});

describe('codex round 3 regressions (#1368)', () => {
  test('a week colliding with an unresolved row is itself unresolved, and mode-relevant for the active block', async () => {
    const { partitionRecoveryRecords } = require('../lib/data/activeTrainingContext');
    const part = partitionRecoveryRecords([block('b1')], [week('w1', 'b1', 'n1', 1), week('wo', 'ghost', 'n1', 1)]);
    expect([...part.excludedWeekIds].sort()).toEqual(['w1', 'wo']);
    expect(part.modeRelevant).toBe(true);
  });

  test('cloud cascade ignores a malformed parent tombstone marker', () => {
    const { planDeletedBlockCascade } = require('../storage/cloud/syncRecoveryResolution');
    const w1 = week('w1', 'b1', 'n1', 1);
    const res = planDeletedBlockCascade([block('b1', { deleted_at: 'nope' })], [w1], 'c1');
    expect(res.cascaded).toEqual([]);
    expect(res.list).toEqual([w1]);
  });

  test('cloud membership resolution leaves a group with unsafe ordinals untouched, matching local', () => {
    const { resolveDuplicateWeekMemberships } = require('../storage/cloud/syncRecoveryResolution');
    const blocks = [block('b1')];
    const weeks = [
      week('w1', 'b1', 'n1', 1e20, { saved_at: T(2) }),
      week('w2', 'b1', 'n1', 1e20, { saved_at: T(3) }),
    ];
    expect(resolveDuplicateWeekMemberships(weeks, 'c1', { blocks }).changed).toEqual([]);
    expect(planRecoveryRepair(blocks, weeks, 'c1').changedWeeks).toEqual([]);
  });

  test('an independent edit is allowed while another record affects the mode', async () => {
    await seed(RECOVERY_BLOCKS_KEY, [
      block('good', { completed_at: T(3) }),
      block('bad'),
      block('bad', { completed_at: T(4) }),
    ]);
    await seed(RECOVERY_BLOCK_WEEKS_KEY, []);
    expect(await ReadState.ensureVerifiedRecoveryState()).toEqual({ ok: true, unresolved: true });
    const action = jest.fn(async () => ({ ok: true }));
    expect((await journal.runGuardedRecoveryAction({ blockId: 'good' }, action)).ok).toBe(true);
    expect((await journal.runGuardedRecoveryAction({ blockId: 'bad' }, action)).reason).toBe('RECOVERY_DATA_UNRESOLVED');
    expect(action).toHaveBeenCalledTimes(1);
  });
});

describe('codex round 4 regressions (#1368)', () => {
  const R = require('../storage/cloud/syncRecoveryResolution');

  test('cloud cascade leaves a malformed child of a valid tombstone untouched, matching local', () => {
    const blocks = [block('b1', { deleted_at: T(9) })];
    const bad = week('w1', 'b1', 'n1', 1e20, { completed_at: 'nope' });
    expect(R.planDeletedBlockCascade(blocks, [bad], 'c1').cascaded).toEqual([]);
    expect(planRecoveryRepair(blocks, [bad], 'c1').changedWeeks).toEqual([]);
  });

  test('cloud active-block resolution refuses a malformed active block, matching local', () => {
    const blocks = [block('b1', { baseline_note_id: null }), block('b2', { started_at: T(3) })];
    expect(R.resolveDuplicateActiveBlocks(blocks, 'c1').changed).toEqual([]);
    expect(planRecoveryRepair(blocks, [], 'c1').changedBlocks).toEqual([]);
  });

  test('a member of an unresolved note group is not renumbered by the ordinal rule', () => {
    const blocks = [block('b1')];
    const weeks = [
      week('wo', 'ghost', 'n1', 1, { saved_at: T(1) }),
      week('w1', 'b1', 'n1', 1, { saved_at: T(3) }),
      week('w2', 'b1', 'n2', 1, { saved_at: T(2) }),
    ];
    expect(planRecoveryRepair(blocks, weeks, 'c1').changedWeeks).toEqual([]);
    expect(R.resolveDuplicateWeekMemberships(weeks, 'c1', { blocks }).changed).toEqual([]);
  });
});

describe('codex round 5 regressions (#1368)', () => {
  const R = require('../storage/cloud/syncRecoveryResolution');

  test('a malformed parent never authorizes cloud membership repair, matching local', () => {
    const blocks = [block('b1', { baseline_note_id: null })];
    const weeks = [
      week('w1', 'b1', 'n1', 1, { saved_at: T(2) }),
      week('w2', 'b1', 'n1', 2, { saved_at: T(3) }),
    ];
    expect(R.resolveDuplicateWeekMemberships(weeks, 'c1', { blocks }).changed).toEqual([]);
    expect(planRecoveryRepair(blocks, weeks, 'c1').changedWeeks).toEqual([]);
  });

  test('evidence that turns malformed after confirmation refuses the action under the lock', async () => {
    await seed(RECOVERY_BLOCKS_KEY, [block('b1')]);
    await seed(RECOVERY_BLOCK_WEEKS_KEY, [week('w1', 'b1', 'n1', 1)]);
    expect((await ReadState.ensureVerifiedRecoveryState()).ok).toBe(true);
    // A raw replacement lands between confirmation and the action.
    await seed(RECOVERY_BLOCK_WEEKS_KEY, [week('w1', 'b1', 'n1', 1e20)]);
    const writes = countWrites();
    const action = jest.fn(async () => ({ ok: true }));
    const res = await journal.runGuardedRecoveryAction({ blockId: 'b1' }, action);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('RECOVERY_STATE_UNVERIFIED');
    expect(action).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
  });

  test('an unreadable list at the action boundary refuses the action', async () => {
    await seed(RECOVERY_BLOCKS_KEY, [block('b1')]);
    await seed(RECOVERY_BLOCK_WEEKS_KEY, '{not json');
    const action = jest.fn(async () => ({ ok: true }));
    const res = await journal.runGuardedRecoveryAction({ blockId: 'b1' }, action);
    expect(res.reason).toBe('RECOVERY_STATE_UNVERIFIED');
    expect(action).not.toHaveBeenCalled();
  });
});

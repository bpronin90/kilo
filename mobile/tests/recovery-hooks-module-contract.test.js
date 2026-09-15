// Module-boundary contract for the #1058 split of recoveryBlockHooks.js into
// read lifecycle (recoveryReadState), analytics filtering (recoveryAnalyticsHooks),
// pure eligibility (recoveryEligibility), and mutations (recoveryMutations) behind
// the compatibility barrel (recoveryBlockHooks).
//
// The split is behavior-only, so this file pins the invariants that a bad split
// would break — enumerated against the card's state-transition matrix — plus the
// adversarial fixtures it names: stale owner, malformed records, partial writes,
// interleaved reload/sync, listener unsubscribe, and clean restoration.
//
// State-transition matrix (every row asserted below):
//  - Identity source: the authoritative snapshot/lifecycle is the single owner of
//    "is recovery verified", shared by every module — no second store.
//  - Invalidation: storage mutations, sync completion, and explicit reload all go
//    through the SAME recovery listeners and refresh the SAME coalescing read.
//  - Missing source: a failed/unread source publishes loading/unverified/stale —
//    never an empty verified result, never another owner's data.
//  - Persistence: the exclusion read touches the same two storage entry points
//    and derives with the same engine; no new representation is introduced.

import React from 'react';
import TestRenderer from 'react-test-renderer';

// ── low-level seams (mocked); pure domain libs stay REAL so the split is pinned
//    to the same engine it ships with. ──────────────────────────────────────────

jest.mock('../storage/entries', () => ({
  loadRecoveryBlocks: jest.fn(async () => []),
  loadRecoveryBlockWeeks: jest.fn(async () => []),
  loadRecoveryBlocksRaw: jest.fn(async () => []),
  loadRecoveryBlockWeeksRaw: jest.fn(async () => []),
  loadRecoveryWeeksForBlock: jest.fn(async () => []),
  createRecoveryBlock: jest.fn(async () => ({ id: 'blkNew' })),
  addRecoveryWeek: jest.fn(async () => ({ id: 'wkNew', block_id: 'blkNew', note_id: 'noteNew' })),
  deleteRecoveryBlock: jest.fn(async () => {}),
  deleteRecoveryWeek: jest.fn(async () => {}),
  updateRecoveryBlock: jest.fn(async (id, patch) => ({ id, ...patch })),
  completeRecoveryWeek: jest.fn(async (id) => ({ id, completed_at: 'now' })),
  uncompleteRecoveryWeek: jest.fn(async (id) => ({ id, completed_at: null })),
  uncompleteRecoveryBlock: jest.fn(async (id) => ({ id, completed_at: null })),
}));

jest.mock('../storage/entries/recoveryOperationJournal', () => ({
  RECOVERY_OPERATION_CODES: {
    RECONCILIATION_PENDING: 'RECONCILIATION_PENDING',
    OPERATION_FAILED: 'OPERATION_FAILED',
  },
  RECOVERY_OPERATION_TYPES: {
    ADD_WEEK_WITH_NEW_NOTE: 'ADD_WEEK_WITH_NEW_NOTE',
    COMPLETE_BLOCK_WITH_WEEK: 'COMPLETE_BLOCK_WITH_WEEK',
    DELETE_LINKED_NOTE: 'DELETE_LINKED_NOTE',
  },
  reconcileRecoveryOperations: jest.fn(async () => ({ pending: [], corrupt: false, error: null })),
  // Pass-through so the core logic under test (rollback, ordering, error
  // propagation) runs unchanged without a real lock.
  runGuardedRecoveryAction: jest.fn((scope, action) => action()),
  startRecoveryOperation: jest.fn(async () => ({ ok: true })),
  deleteWorkoutNoteViaRecoveryOperations: jest.fn(async () => {}),
}));

jest.mock('../storage/syncRecovery', () => {
  const listeners = [];
  return {
    __esModule: true,
    SYNC_PHASE: { SYNC: 'sync' },
    SYNC_STATUS: { COMPLETE: 'complete', IN_PROGRESS: 'in_progress' },
    subscribeSyncState: jest.fn((cb) => {
      listeners.push(cb);
      return () => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      };
    }),
    __emit: (state) => listeners.slice().forEach((l) => l(state)),
    __count: () => listeners.length,
  };
});

jest.mock('../storage/entries/startupTiming', () => ({ markStartupPhase: jest.fn() }));
jest.mock('../hooks/entries/workoutNoteHooks', () => ({ reloadWorkoutNotes: jest.fn() }));
jest.mock('../hooks/entries/storageMode', () => ({}));

const barrel = require('../hooks/entries/recoveryBlockHooks');
const ReadState = require('../hooks/entries/recoveryReadState');
const AnalyticsHooks = require('../hooks/entries/recoveryAnalyticsHooks');
const Eligibility = require('../hooks/entries/recoveryEligibility');
const Mutations = require('../hooks/entries/recoveryMutations');
const Storage = require('../storage/entries');
const Journal = require('../storage/entries/recoveryOperationJournal');
const SyncRecovery = require('../storage/syncRecovery');
const WorkoutNoteHooks = require('../hooks/entries/workoutNoteHooks');

const ALL_EXPORTS = [
  'RECOVERY_STATUS', 'RECOVERY_LOADING_MESSAGE', 'RECOVERY_UNVERIFIED_MESSAGE', 'RECOVERY_STALE_MESSAGE',
  'refreshRecoveryState', 'ensureVerifiedRecoveryState', 'useRecoveryBlockState', 'useActiveTrainingContext',
  'useRecoveryAnalyticsFilter', 'reloadRecoveryBlocks', '_resetRecoveryAnalyticsFilterCache',
  'loadRecoveryExcludedNoteIds', 'isEligibleBaselineNote', 'isEligibleRecoveryWeekNote',
  'startRecoveryBlockCore', 'useStartRecoveryBlock', 'completeCurrentWeekCore', 'uncompleteCurrentWeekCore',
  'addRecoveryWeekCore', 'addRecoveryWeekWithNewNoteCore', 'completeRecoveryBlockCore', 'reopenRecoveryBlockCore',
  'unlinkRecoveryWeekCore', 'unlinkNoteForDeleteCore', 'setRecoveryNormalAnalyticsInclusionCore',
  'setRecoveryBlockReasonCore', 'useRecoveryBlockLifecycle',
];

// A live, active block owned by "owner A" plus one live week whose note is
// excluded from ordinary analytics (block opts out).
function ownerASnapshot() {
  return {
    blocks: [{ id: 'blkA', updated_at: '2', created_at: '1', include_in_normal_analytics: false, deleted_at: null, completed_at: null, baseline_note_id: 'baseA' }],
    weeks: [{ id: 'wkA1', block_id: 'blkA', note_id: 'noteA1', week_number: 1, updated_at: '2', deleted_at: null, completed_at: null }],
  };
}
function ownerBSnapshot() {
  return {
    blocks: [{ id: 'blkB', updated_at: '9', created_at: '8', include_in_normal_analytics: false, deleted_at: null, completed_at: null, baseline_note_id: 'baseB' }],
    weeks: [{ id: 'wkB1', block_id: 'blkB', note_id: 'noteB1', week_number: 1, updated_at: '9', deleted_at: null, completed_at: null }],
  };
}

function setReadSource(snapshot) {
  Storage.loadRecoveryBlocks.mockImplementation(async () => snapshot.blocks);
  Storage.loadRecoveryBlockWeeks.mockImplementation(async () => snapshot.weeks);
}
function failReadSource(error = new Error('recovery key unreadable')) {
  Storage.loadRecoveryBlocks.mockImplementation(async () => { throw error; });
  Storage.loadRecoveryBlockWeeks.mockImplementation(async () => { throw error; });
}

async function flush() {
  await TestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });
}

const mounted = [];
function mountHook(hook, props) {
  const ref = { current: null, renders: 0 };
  // A stable component type so `rerender` is a true re-render (hook state kept),
  // not a remount (which would reset every useCallback identity).
  function Probe() { ref.current = hook(props); ref.renders += 1; return null; }
  let renderer;
  TestRenderer.act(() => { renderer = TestRenderer.create(React.createElement(Probe)); });
  mounted.push(renderer);
  const rerender = () => { TestRenderer.act(() => { renderer.update(React.createElement(Probe)); }); };
  return { ref, renderer, rerender };
}

beforeEach(() => {
  jest.clearAllMocks();
  Storage.loadRecoveryBlocks.mockImplementation(async () => []);
  Storage.loadRecoveryBlockWeeks.mockImplementation(async () => []);
  Storage.loadRecoveryBlocksRaw.mockImplementation(async () => []);
  Storage.loadRecoveryBlockWeeksRaw.mockImplementation(async () => []);
  Storage.loadRecoveryWeeksForBlock.mockImplementation(async () => []);
  Journal.reconcileRecoveryOperations.mockImplementation(async () => ({ pending: [], corrupt: false, error: null }));
  Journal.runGuardedRecoveryAction.mockImplementation((scope, action) => action());
  barrel._resetRecoveryAnalyticsFilterCache();
});

afterEach(() => {
  TestRenderer.act(() => { mounted.forEach((r) => r.unmount()); });
  mounted.length = 0;
});

// ── Export surface + mock seams ───────────────────────────────────────────────

describe('barrel export surface and mock seams', () => {
  test('re-exports exactly the original public surface, with correct types', () => {
    expect(Object.keys(barrel).sort()).toEqual([...ALL_EXPORTS].sort());
    for (const name of ALL_EXPORTS) expect(barrel[name]).toBeDefined();
    expect(typeof barrel.RECOVERY_STATUS).toBe('object');
    expect(typeof barrel.RECOVERY_STALE_MESSAGE).toBe('string');
    for (const fn of ['refreshRecoveryState', 'useRecoveryBlockState', 'useRecoveryBlockLifecycle', 'startRecoveryBlockCore', 'isEligibleBaselineNote', 'loadRecoveryExcludedNoteIds']) {
      expect(typeof barrel[fn]).toBe('function');
    }
  });

  test('each symbol is the SAME identity as its owning module (no wrappers)', () => {
    expect(barrel.useRecoveryBlockState).toBe(ReadState.useRecoveryBlockState);
    expect(barrel.refreshRecoveryState).toBe(ReadState.refreshRecoveryState);
    expect(barrel.RECOVERY_STATUS).toBe(ReadState.RECOVERY_STATUS);
    expect(barrel.useRecoveryAnalyticsFilter).toBe(AnalyticsHooks.useRecoveryAnalyticsFilter);
    expect(barrel.useActiveTrainingContext).toBe(AnalyticsHooks.useActiveTrainingContext);
    expect(barrel.loadRecoveryExcludedNoteIds).toBe(AnalyticsHooks.loadRecoveryExcludedNoteIds);
    expect(barrel.isEligibleBaselineNote).toBe(Eligibility.isEligibleBaselineNote);
    expect(barrel.useRecoveryBlockLifecycle).toBe(Mutations.useRecoveryBlockLifecycle);
  });

  test('every barrel export is a writable, configurable data property (jest.spyOn seam)', () => {
    for (const name of ALL_EXPORTS) {
      const d = Object.getOwnPropertyDescriptor(barrel, name);
      expect(d).toBeDefined();
      expect(d.configurable).toBe(true);
      expect(d.writable).toBe(true);
      expect(d.get).toBeUndefined();
    }
  });

  test('spyOn(barrel, "useRecoveryBlockLifecycle") replaces the export (analytics-recovery-section seam)', () => {
    const spy = jest.spyOn(barrel, 'useRecoveryBlockLifecycle').mockReturnValue({ marker: true });
    expect(barrel.useRecoveryBlockLifecycle()).toEqual({ marker: true });
    spy.mockRestore();
  });

  test('spread of the barrel copies every real export (pr-moment-editor requireActual seam)', () => {
    const spread = { ...barrel };
    for (const name of ALL_EXPORTS) expect(spread[name]).toBe(barrel[name]);
  });
});

// ── Identity source: single shared store across modules ───────────────────────

describe('single shared store (identity source is authoritative, no duplicate state)', () => {
  test('an authoritative read (read lifecycle) publishes to the analytics-filter snapshot (analytics module) — one store', async () => {
    setReadSource(ownerASnapshot());
    const { ref: filter } = mountHook(barrel.useRecoveryAnalyticsFilter);
    // Before the read resolves, the filter is not ready (unverified boundary).
    expect(filter.current.ready).toBe(false);
    await flush();
    // The authoritative read publishes the SAME records the filter renders from,
    // proving both hooks read one store rather than two.
    expect(filter.current.ready).toBe(true);
    expect(filter.current.hasExclusions).toBe(true);
    expect(filter.current.isNoteExcluded('noteA1')).toBe(true);
  });

  test('a plain filter read never grants mutation trust (authoritative gate stays closed)', async () => {
    setReadSource(ownerASnapshot());
    // Only the filter hook mounts — no authoritative reconcile-then-read runs.
    mountHook(barrel.useRecoveryAnalyticsFilter);
    await flush();
    // ensureVerifiedRecoveryState must still refuse: the filter boundary is
    // verified, but the authoritative snapshot is not.
    Journal.reconcileRecoveryOperations.mockImplementationOnce(async () => { throw new Error('down'); });
    failReadSource();
    const gate = await barrel.ensureVerifiedRecoveryState();
    expect(gate.ok).toBe(false);
  });

  test('_resetRecoveryAnalyticsFilterCache clears the whole store (test isolation seam)', async () => {
    setReadSource(ownerASnapshot());
    await barrel.refreshRecoveryState();
    const before = mountHook(barrel.useRecoveryBlockState);
    await flush();
    expect(before.ref.current.ready).toBe(true);
    TestRenderer.act(() => { before.renderer.unmount(); });

    barrel._resetRecoveryAnalyticsFilterCache();
    const after = mountHook(barrel.useRecoveryBlockState);
    // Fresh mount before any new read: back to the unverified placeholder.
    expect(after.ref.current.ready).toBe(false);
    expect(after.ref.current.blocks).toEqual([]);
  });
});

// ── Missing source: loading / unverified, never empty-verified, never another owner
// ─────────────────────────────────────────────────────────────────────────────

describe('missing source publishes loading/unverified — never a fabricated empty', () => {
  test('a cold first-read failure resolves to ERROR, not an empty verified snapshot', async () => {
    failReadSource();
    const { ref } = mountHook(barrel.useRecoveryBlockState);
    expect(ref.current.loading).toBe(true); // before the read settles
    expect(ref.current.ready).toBe(false);
    await flush();
    expect(ref.current.ready).toBe(false);
    expect(ref.current.loading).toBe(false); // terminal error is NOT loading
    expect(ref.current.error).toBeInstanceOf(Error);
    expect(ref.current.mutationsAllowed).toBe(false);
    expect(ref.current.blocks).toEqual([]); // placeholder, but ready===false
  });

  test('ensureVerifiedRecoveryState refuses against an unverified source', async () => {
    failReadSource();
    const gate = await barrel.ensureVerifiedRecoveryState();
    expect(gate.ok).toBe(false);
    expect(gate.code).toBe('RECOVERY_STATE_UNVERIFIED');
  });

  test('a corrupt journal blocks mutations with its own code (paused, not empty)', async () => {
    Journal.reconcileRecoveryOperations.mockImplementation(async () => ({ corrupt: true, code: 'JOURNAL_CORRUPT', error: 'unreadable' }));
    const gate = await barrel.ensureVerifiedRecoveryState();
    expect(gate.ok).toBe(false);
    expect(gate.code).toBe('RECOVERY_JOURNAL_CORRUPT');
  });

  test('a still-pending reconciliation refuses with the pending code', async () => {
    Journal.reconcileRecoveryOperations.mockImplementation(async () => ({ pending: [{ id: 'op1' }], corrupt: false, error: null }));
    setReadSource(ownerASnapshot());
    const gate = await barrel.ensureVerifiedRecoveryState();
    expect(gate.ok).toBe(false);
    expect(gate.code).toBe(Journal.RECOVERY_OPERATION_CODES.RECONCILIATION_PENDING);
  });
});

// ── Adversarial fixture: stale owner (last-known-good retained; never substituted)
// ─────────────────────────────────────────────────────────────────────────────

describe('stale owner: a failed refresh keeps last-known-good, never swaps owners', () => {
  test('verified owner-A survives a later read failure as STALE with A still shown', async () => {
    setReadSource(ownerASnapshot());
    const { ref } = mountHook(barrel.useRecoveryBlockState);
    await flush();
    expect(ref.current.ready).toBe(true);
    expect(ref.current.activeBlock.id).toBe('blkA');

    // The source now fails. Nothing substitutes owner B; A stays visible.
    failReadSource();
    await TestRenderer.act(async () => { await barrel.refreshRecoveryState(); });
    await flush();
    expect(ref.current.ready).toBe(true); // last-known-good still verified
    expect(ref.current.stale).toBe(true);
    expect(ref.current.activeBlock.id).toBe('blkA');
    expect(ref.current.blocks[0].id).toBe('blkA');
    expect(ref.current.mutationsAllowed).toBe(true); // verified + not corrupt
  });

  test('a corrupt journal over a verified snapshot goes STALE AND blocks mutation', async () => {
    setReadSource(ownerASnapshot());
    const { ref } = mountHook(barrel.useRecoveryBlockState);
    await flush();
    expect(ref.current.ready).toBe(true);

    Journal.reconcileRecoveryOperations.mockImplementation(async () => ({ corrupt: true, code: 'C', error: 'x' }));
    await TestRenderer.act(async () => { await barrel.refreshRecoveryState(); });
    await flush();
    expect(ref.current.stale).toBe(true);
    expect(ref.current.activeBlock.id).toBe('blkA'); // owner A retained
    expect(ref.current.mutationsAllowed).toBe(false); // journal corrupt gate
  });
});

// ── Adversarial fixture: malformed records (handled, never thrown) ─────────────

describe('malformed records are tolerated by the derivation engine', () => {
  test('weeks/blocks with missing or non-string fields do not throw and derive sanely', async () => {
    // Field-level malformation (missing/wrong-typed fields, tombstones). Null
    // ARRAY ELEMENTS are intentionally not asserted: the shipped signature has
    // never guarded them, and this split changes no such behavior.
    const malformed = {
      blocks: [{ id: 'blkA', include_in_normal_analytics: false, deleted_at: null }, { id: 'orphan', include_in_normal_analytics: true }],
      weeks: [
        { id: 'wkA1', block_id: 'blkA', note_id: 'noteA1', deleted_at: null },
        { id: 'bad', block_id: 'blkA', note_id: null, deleted_at: null },
        { id: 'numeric', block_id: 'blkA', note_id: 42, deleted_at: null },
        { id: 'tomb', block_id: 'blkA', note_id: 'noteGhost', deleted_at: 'yes' },
      ],
    };
    setReadSource(malformed);
    const { ref } = mountHook(barrel.useRecoveryAnalyticsFilter);
    await flush();
    expect(ref.current.ready).toBe(true);
    expect(ref.current.isNoteExcluded('noteA1')).toBe(true); // valid live week excluded
    expect(ref.current.isNoteExcluded('noteGhost')).toBe(false); // tombstoned, skipped
  });

  test('loadRecoveryExcludedNoteIds tolerates malformed records without throwing', async () => {
    Storage.loadRecoveryBlocks.mockImplementation(async () => [{ id: 'blkA', include_in_normal_analytics: false }, null]);
    Storage.loadRecoveryBlockWeeks.mockImplementation(async () => [{ note_id: 'noteA1', block_id: 'blkA', deleted_at: null }, { note_id: 42 }]);
    const excluded = await barrel.loadRecoveryExcludedNoteIds();
    expect(excluded.has('noteA1')).toBe(true);
    expect(excluded.size).toBe(1);
  });
});

// ── Adversarial fixture: partial writes (rollback + error propagation) ─────────

describe('partial writes roll back and propagate errors as values, never throws', () => {
  test('startRecoveryBlockCore rolls back the block when Week-1 attach fails', async () => {
    const order = [];
    Storage.createRecoveryBlock.mockImplementation(async () => { order.push('create'); return { id: 'blkRB' }; });
    Storage.addRecoveryWeek.mockImplementation(async () => { order.push('addWeek'); throw new Error('attach failed'); });
    Storage.deleteRecoveryBlock.mockImplementation(async () => { order.push('rollback'); });

    const result = await barrel.startRecoveryBlockCore(Storage, { baselineNoteId: 'baseA', weekNoteId: 'noteA1' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('attach failed'); // storage error propagated verbatim
    expect(Storage.deleteRecoveryBlock).toHaveBeenCalledWith('blkRB');
    expect(order).toEqual(['create', 'addWeek', 'rollback']); // operation order preserved
  });

  test('startRecoveryBlockCore success attaches then notifies (order preserved)', async () => {
    const order = [];
    Storage.createRecoveryBlock.mockImplementation(async () => { order.push('create'); return { id: 'blkOK' }; });
    Storage.addRecoveryWeek.mockImplementation(async () => { order.push('addWeek'); return { id: 'wkOK' }; });
    const result = await barrel.startRecoveryBlockCore(Storage, { baselineNoteId: 'baseA', weekNoteId: 'noteA1' });
    expect(result).toEqual({ ok: true, block: { id: 'blkOK' }, week: { id: 'wkOK' } });
    expect(order).toEqual(['create', 'addWeek']);
  });

  test('a core surfaces a storage rejection as { ok:false, code } rather than throwing', async () => {
    const err = Object.assign(new Error('boom'), { code: 'STORE_FAIL' });
    Storage.loadRecoveryWeeksForBlock.mockImplementation(async () => [{ id: 'wk', completed_at: null }]);
    Storage.completeRecoveryWeek.mockImplementation(async () => { throw err; });
    const result = await barrel.completeCurrentWeekCore(Storage, { blockId: 'blkA' });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('STORE_FAIL');
    expect(result.error).toBe('boom');
  });
});

// ── Adversarial fixture: interleaved reload / sync + coalescing + invalidation ──

describe('invalidation goes through one coalesced read for reload, sync, and mutation', () => {
  test('N concurrent refreshes coalesce to exactly one extra reconcile pass', async () => {
    setReadSource(ownerASnapshot());
    barrel.refreshRecoveryState();
    barrel.refreshRecoveryState();
    barrel.refreshRecoveryState();
    await flush();
    // One in-flight pass + one coalesced follow-up = 2, never 1 or 3.
    expect(Journal.reconcileRecoveryOperations).toHaveBeenCalledTimes(2);
  });

  test('two mounted read consumers share ONE sync subscription and one refresh per signal', async () => {
    setReadSource(ownerASnapshot());
    mountHook(barrel.useRecoveryBlockState);
    mountHook(barrel.useRecoveryBlockState);
    await flush();
    // First consumer owns the single shared sync subscription; second adds none.
    expect(SyncRecovery.__count()).toBe(1);
    const afterMount = Journal.reconcileRecoveryOperations.mock.calls.length;

    // Interleave an explicit reload and a sync-completion — each is one shared
    // refresh across both consumers, not one per consumer.
    barrel.reloadRecoveryBlocks();
    await flush();
    SyncRecovery.__emit({ sync: { status: 'complete' } });
    await flush();
    expect(Journal.reconcileRecoveryOperations.mock.calls.length).toBe(afterMount + 2);
  });

  test('a lifecycle-hook mutation (recoveryMutations) invalidates the read store (recoveryReadState) end to end', async () => {
    setReadSource(ownerASnapshot());
    const read = mountHook(barrel.useRecoveryBlockState);
    const life = mountHook(barrel.useRecoveryBlockLifecycle);
    await flush();
    expect(read.ref.current.blocks[0].include_in_normal_analytics).toBe(false);

    // The write lands and the source now reports the toggled value. The mutation
    // hook's notify (imported from recoveryReadState) must refresh the mounted
    // read consumer so it reflects the change — proving one shared store.
    const toggled = ownerASnapshot();
    toggled.blocks[0].include_in_normal_analytics = true;
    toggled.blocks[0].updated_at = '3';
    setReadSource(toggled);
    await TestRenderer.act(async () => {
      await life.ref.current.setIncludeInNormalAnalytics({ blockId: 'blkA', include: true });
    });
    await flush();
    expect(Storage.updateRecoveryBlock).toHaveBeenCalledWith('blkA', { include_in_normal_analytics: true });
    expect(read.ref.current.blocks[0].include_in_normal_analytics).toBe(true);
  });

  test('duplicate sync-COMPLETE broadcasts refresh only on the transition', async () => {
    setReadSource(ownerASnapshot());
    mountHook(barrel.useRecoveryBlockState);
    await flush();
    const before = Journal.reconcileRecoveryOperations.mock.calls.length;
    SyncRecovery.__emit({ sync: { status: 'complete' } });
    SyncRecovery.__emit({ sync: { status: 'complete' } }); // no new transition
    await flush();
    expect(Journal.reconcileRecoveryOperations.mock.calls.length).toBe(before + 1);
  });
});

// ── Adversarial fixture: listener unsubscribe (clean teardown, no leaks) ───────

describe('listener unsubscribe leaves no live listener behind', () => {
  test('unmounting the last read consumer removes its sync subscription', async () => {
    setReadSource(ownerASnapshot());
    const a = mountHook(barrel.useRecoveryBlockState);
    await flush();
    expect(SyncRecovery.__count()).toBe(1);
    TestRenderer.act(() => { a.renderer.unmount(); mounted.length = 0; });
    expect(SyncRecovery.__count()).toBe(0);
  });

  test('after an analytics-filter hook unmounts, a reload does not re-read through it', async () => {
    setReadSource(ownerASnapshot());
    const f = mountHook(barrel.useRecoveryAnalyticsFilter);
    await flush();
    TestRenderer.act(() => { f.renderer.unmount(); mounted.length = 0; });
    expect(SyncRecovery.__count()).toBe(0);

    const readsBefore = Storage.loadRecoveryBlocks.mock.calls.length;
    barrel.reloadRecoveryBlocks(); // notifies remaining recovery listeners
    await flush();
    // The unmounted hook's refresh is gone, so no extra storage read happens.
    expect(Storage.loadRecoveryBlocks.mock.calls.length).toBe(readsBefore);
  });
});

// ── Adversarial fixture: clean restoration (error → retry → verified) ──────────

describe('clean restoration: a failed source recovers to a verified snapshot on retry', () => {
  test('ERROR then a successful retry publishes READY with the real data', async () => {
    failReadSource();
    const { ref } = mountHook(barrel.useRecoveryBlockState);
    await flush();
    expect(ref.current.ready).toBe(false);
    expect(ref.current.error).toBeInstanceOf(Error);

    // The Retry recovery affordance is the same refresh the mount used.
    setReadSource(ownerASnapshot());
    await TestRenderer.act(async () => { await ref.current.retryRecovery(); });
    await flush();
    expect(ref.current.ready).toBe(true);
    expect(ref.current.error).toBeNull();
    expect(ref.current.activeBlock.id).toBe('blkA');
    expect(ref.current.mutationsAllowed).toBe(true);
  });

  test('reloadRecoveryBlocks after a wholesale restore republishes the new owner', async () => {
    setReadSource(ownerASnapshot());
    const { ref } = mountHook(barrel.useRecoveryBlockState);
    await flush();
    expect(ref.current.activeBlock.id).toBe('blkA');

    // Simulate a restored backup that replaces both collections wholesale.
    setReadSource(ownerBSnapshot());
    barrel.reloadRecoveryBlocks();
    await flush();
    expect(ref.current.activeBlock.id).toBe('blkB');
  });
});

// ── Hook return identity where consumers rely on it ───────────────────────────

describe('hook return identity is stable across renders (memoization preserved)', () => {
  test('useRecoveryBlockState returns a stable object and stable refresh/retry across a no-op re-render', async () => {
    setReadSource(ownerASnapshot());
    const { ref, rerender } = mountHook(barrel.useRecoveryBlockState);
    await flush();
    const first = ref.current;
    expect(first.retryRecovery).toBe(first.refresh); // same affordance
    rerender(); // re-render the SAME component; no store change between renders
    expect(ref.current).toBe(first); // memoized object identity holds
    expect(ref.current.refresh).toBe(first.refresh);
  });

  test('useRecoveryBlockLifecycle exposes the full action set with stable callbacks', async () => {
    const { ref, rerender } = mountHook(barrel.useRecoveryBlockLifecycle);
    const api = ref.current;
    for (const k of ['completeCurrentWeek', 'uncompleteCurrentWeek', 'addWeek', 'addWeekWithNewNote', 'completeBlock', 'reopenBlock', 'unlinkWeek', 'unlinkNoteForDelete', 'setIncludeInNormalAnalytics', 'setBlockReason', 'retryRecovery']) {
      expect(typeof api[k]).toBe('function');
    }
    rerender();
    expect(ref.current.completeBlock).toBe(api.completeBlock);
  });
});

// ── Pure eligibility (unchanged predicates) ───────────────────────────────────

describe('pure eligibility predicates', () => {
  const blocks = [{ baseline_note_id: 'baseA' }];
  const weeks = [{ id: 'wkA1', block_id: 'blkA', note_id: 'noteA1', deleted_at: null }];

  test('isEligibleBaselineNote rejects deload notes, existing baselines, and live members', () => {
    expect(barrel.isEligibleBaselineNote({ id: 'fresh' }, { blocks, weeks })).toBe(true);
    expect(barrel.isEligibleBaselineNote({ id: 'baseA' }, { blocks, weeks })).toBe(false);
    expect(barrel.isEligibleBaselineNote({ id: 'noteA1' }, { blocks, weeks })).toBe(false);
    expect(barrel.isEligibleBaselineNote({ id: 'd', title: 'Deload week' }, { blocks, weeks, deloadNotePrefix: 'Deload' })).toBe(false);
    expect(barrel.isEligibleBaselineNote(null, { blocks, weeks })).toBe(false);
  });

  test('isEligibleRecoveryWeekNote matches the baseline rule', () => {
    expect(barrel.isEligibleRecoveryWeekNote({ id: 'fresh' }, { blocks, weeks })).toBe(true);
    expect(barrel.isEligibleRecoveryWeekNote({ id: 'noteA1' }, { blocks, weeks })).toBe(false);
  });
});

// ── Persistence representation unchanged ──────────────────────────────────────

describe('persistence representation is unchanged by the extraction', () => {
  test('the exclusion read touches only the two recovery read entry points and writes nothing', async () => {
    setReadSource(ownerASnapshot());
    await barrel.loadRecoveryExcludedNoteIds();
    expect(Storage.loadRecoveryBlocks).toHaveBeenCalledTimes(1);
    expect(Storage.loadRecoveryBlockWeeks).toHaveBeenCalledTimes(1);
    expect(Storage.createRecoveryBlock).not.toHaveBeenCalled();
    expect(Storage.updateRecoveryBlock).not.toHaveBeenCalled();
    expect(Storage.deleteRecoveryBlock).not.toHaveBeenCalled();
    expect(Storage.deleteRecoveryWeek).not.toHaveBeenCalled();
  });

  test('loadRecoveryExcludedNoteIds accepts an injected storage and reads through it', async () => {
    const injected = {
      loadRecoveryBlocks: jest.fn(async () => ownerASnapshot().blocks),
      loadRecoveryBlockWeeks: jest.fn(async () => ownerASnapshot().weeks),
    };
    const excluded = await barrel.loadRecoveryExcludedNoteIds(injected);
    expect(injected.loadRecoveryBlocks).toHaveBeenCalledTimes(1);
    expect(excluded.has('noteA1')).toBe(true);
    expect(Storage.loadRecoveryBlocks).not.toHaveBeenCalled(); // default not used
  });
});

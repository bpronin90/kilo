// Module-split contract for the recovery operation journal (#1059).
//
// recoveryOperationJournal.js was split into schema / store / operations /
// replay modules, with the entry file kept as a compatibility barrel. These
// tests lock the split down two ways:
//
//   1. Structural — the barrel re-exports the identical public surface, each
//      member sharing identity with its owning submodule, the serialized
//      constant vocabulary is byte-for-byte unchanged, and the
//      `jest.spyOn(module, 'reconcileRecoveryOperations')` seam still works.
//
//   2. Behavioral — every row of the recovery state-transition matrix still
//      holds when driven through the barrel across the new module boundaries,
//      exercising every stage boundary, duplicate replay, stale identity, a
//      malformed record, a partial write, a concurrent action, and a clean
//      restoration. Failures are injected at the real jsonStorage read/write
//      seam (never a fake collection), exactly as the sibling recovery suites.

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  RECOVERY_BLOCKS_KEY,
  RECOVERY_BLOCK_WEEKS_KEY,
  RECOVERY_OPERATION_JOURNAL_KEY,
} from '../storage/entries/keys';
import * as readListModule from '../storage/entries/jsonStorage';
import * as writeListModule from '../storage/entries/jsonStorage';
import * as journal from '../storage/entries/recoveryOperationJournal';

const CODES = journal.RECOVERY_OPERATION_CODES;
const TYPES = journal.RECOVERY_OPERATION_TYPES;
const STAGES = journal.RECOVERY_OPERATION_STAGES;

const nowISO = '2026-01-01T00:00:00.000Z';
const completedAt = '2026-02-01T00:00:00.000Z';
const deletedAt = '2026-02-02T00:00:00.000Z';
const createdAt = '2026-02-03T00:00:00.000Z';

// ── durable-storage helpers (real jsonStorage / AsyncStorage path) ────────────

async function setBlocks(blocks) {
  await AsyncStorage.setItem(RECOVERY_BLOCKS_KEY, JSON.stringify(blocks));
}
async function setWeeks(weeks) {
  await AsyncStorage.setItem(RECOVERY_BLOCK_WEEKS_KEY, JSON.stringify(weeks));
}
async function setJournal(records) {
  await AsyncStorage.setItem(RECOVERY_OPERATION_JOURNAL_KEY, JSON.stringify(records));
}
async function getBlocks() {
  const raw = await AsyncStorage.getItem(RECOVERY_BLOCKS_KEY);
  return raw ? JSON.parse(raw) : [];
}
async function getWeeks() {
  const raw = await AsyncStorage.getItem(RECOVERY_BLOCK_WEEKS_KEY);
  return raw ? JSON.parse(raw) : [];
}
async function getJournal() {
  const raw = await AsyncStorage.getItem(RECOVERY_OPERATION_JOURNAL_KEY);
  return raw ? JSON.parse(raw) : [];
}

function block(id, extra = {}) {
  return { id, name: 'Block', created_at: nowISO, updated_at: nowISO, completed_at: null, deleted_at: null, ...extra };
}
function week(id, blockId, noteId, weekNumber, extra = {}) {
  return {
    id,
    block_id: blockId,
    note_id: noteId,
    week_number: weekNumber,
    created_at: nowISO,
    updated_at: nowISO,
    completed_at: null,
    deleted_at: null,
    ...extra,
  };
}

let seedSeq = 0;
function record(intent) {
  seedSeq += 1;
  return {
    version: journal.RECOVERY_JOURNAL_VERSION,
    operation_id: `recop_seed_${seedSeq}`,
    created_at: nowISO,
    updated_at: nowISO,
    stage: STAGES.INTENT,
    attempts: 0,
    last_error: null,
    ...intent,
  };
}

function completeIntent(blockId, weekId, at = completedAt) {
  return { type: TYPES.COMPLETE_BLOCK_WITH_WEEK, block_id: blockId, week_id: weekId || null, requested_completed_at: at };
}
function deleteNoteIntent(weekId, noteId, at = deletedAt) {
  return { type: TYPES.DELETE_LINKED_NOTE, week_id: weekId, note_id: noteId, requested_deleted_at: at };
}
function addWeekIntent(blockId, noteId, weekId, weekNumber = 1, at = createdAt) {
  return {
    type: TYPES.ADD_WEEK_WITH_NEW_NOTE,
    block_id: blockId,
    note_id: noteId,
    week_id: weekId,
    requested_created_at: at,
    note_seed: { id: noteId, title: 'New week', raw_text: '' },
    week_seed: week(weekId, blockId, noteId, weekNumber, { created_at: at, updated_at: at }),
  };
}

function startOp(scope, intent) {
  return journal.startRecoveryOperation({ scope, validate: async () => ({ ok: true, intent }) });
}

// An in-memory note store standing in for hooks/entries/storageMode.js's
// registered, mode-aware note operations. `requiresQueue` models cloud mode.
function makeNoteStore(notes, { requiresQueue = false } = {}) {
  const queue = [];
  return {
    loadNoteState: async (id) => {
      const note = notes.find((n) => n.id === id);
      if (!note) return { exists: false, deleted: true, requiresQueue, queued: false };
      if (!note.deleted_at) return { exists: true, deleted: false, requiresQueue, queued: false };
      return { exists: true, deleted: true, requiresQueue, queued: queue.includes(id) };
    },
    deleteNote: async (id, opts) => {
      const note = notes.find((n) => n.id === id);
      if (!note) return;
      if (!note.deleted_at) note.deleted_at = (opts && opts.deletedAt) || deletedAt;
      if (requiresQueue && !queue.includes(id)) queue.push(id);
    },
    loadNoteLiveState: async (id) => {
      const note = notes.find((n) => n.id === id);
      if (!note) return { exists: false, deleted: false, requiresQueue, queued: false };
      return { exists: true, deleted: !!note.deleted_at, requiresQueue, queued: queue.includes(id) };
    },
    ensureNoteLive: async (seed) => {
      const existing = notes.find((n) => n.id === seed.id);
      if (existing) existing.deleted_at = null;
      else notes.push({ ...seed, deleted_at: null });
      if (requiresQueue && !queue.includes(seed.id)) queue.push(seed.id);
    },
  };
}

// Fail every write to `keys`, up to `times`, then behave normally.
function failWritesFor(keys, { times = Infinity } = {}) {
  const original = writeListModule.writeList;
  let remaining = times;
  return jest.spyOn(writeListModule, 'writeList').mockImplementation(async (key, list) => {
    if (keys.includes(key) && remaining > 0) {
      remaining -= 1;
      throw new Error('Injected write failure');
    }
    return original(key, list);
  });
}

// Fail reads of `keys`, after `skip` successful ones, up to `times`.
function failReadsFor(keys, { skip = 0, times = Infinity } = {}) {
  const original = readListModule.readList;
  let skipped = 0;
  let remaining = times;
  return jest.spyOn(readListModule, 'readList').mockImplementation(async (key) => {
    if (keys.includes(key) && remaining > 0) {
      if (skipped >= skip) {
        remaining -= 1;
        throw new Error('Injected read failure');
      }
      skipped += 1;
    }
    return original(key);
  });
}

// Fail only the journal-clearing write (the empty-array shrink), so a verified
// operation cannot remove its own record.
function failJournalClear() {
  const original = writeListModule.writeList;
  return jest.spyOn(writeListModule, 'writeList').mockImplementation(async (key, list) => {
    if (key === RECOVERY_OPERATION_JOURNAL_KEY && Array.isArray(list) && list.length === 0) {
      throw new Error('Injected journal-clear failure');
    }
    return original(key, list);
  });
}

// Record the key of every write in order, without changing behavior.
function recordWriteOrder() {
  const order = [];
  const original = writeListModule.writeList;
  jest.spyOn(writeListModule, 'writeList').mockImplementation(async (key, list) => {
    order.push(key);
    return original(key, list);
  });
  return order;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  journal.__resetRecoveryOperationJournal();
});

afterEach(() => {
  jest.restoreAllMocks();
  journal.__resetRecoveryOperationJournal();
});

// ── 1. module surface contract ────────────────────────────────────────────────

describe('module surface contract', () => {
  const barrelR = require('../storage/entries/recoveryOperationJournal');
  const schemaR = require('../storage/entries/recoveryJournalSchema');
  const storeR = require('../storage/entries/recoveryJournalStore');
  const opsR = require('../storage/entries/recoveryJournalOperations');
  const replayR = require('../storage/entries/recoveryJournalReplay');

  const PUBLIC_EXPORTS = [
    'RECOVERY_JOURNAL_VERSION',
    'RECOVERY_OPERATION_TYPES',
    'RECOVERY_OPERATION_CODES',
    'RECOVERY_OPERATION_STAGES',
    'RecoveryJournalCorruptError',
    'isRecoveryJournalCorruptError',
    'setRecoveryNoteOperations',
    'deleteWorkoutNoteViaRecoveryOperations',
    'resetRecoveryNoteOperations',
    'readRecoveryJournal',
    'loadPendingRecoveryOperations',
    '__resetRecoveryOperationJournal',
    'withExclusiveRecoveryAccess',
    'reconcileRecoveryOperations',
    'runGuardedRecoveryAction',
    'startRecoveryOperation',
  ];

  test('re-exports every documented public member', () => {
    for (const name of PUBLIC_EXPORTS) {
      expect(barrelR[name]).toBeDefined();
    }
    const fns = PUBLIC_EXPORTS.filter((n) => !n.startsWith('RECOVERY_'));
    for (const name of fns) {
      // Constants aside, and the error class (also a function), every public
      // member is callable.
      expect(typeof barrelR[name]).toBe('function');
    }
  });

  test('each barrel member shares identity with its owning submodule', () => {
    expect(barrelR.RECOVERY_JOURNAL_VERSION).toBe(schemaR.RECOVERY_JOURNAL_VERSION);
    expect(barrelR.RECOVERY_OPERATION_TYPES).toBe(schemaR.RECOVERY_OPERATION_TYPES);
    expect(barrelR.RECOVERY_OPERATION_CODES).toBe(schemaR.RECOVERY_OPERATION_CODES);
    expect(barrelR.RECOVERY_OPERATION_STAGES).toBe(schemaR.RECOVERY_OPERATION_STAGES);
    expect(barrelR.RecoveryJournalCorruptError).toBe(schemaR.RecoveryJournalCorruptError);
    expect(barrelR.isRecoveryJournalCorruptError).toBe(schemaR.isRecoveryJournalCorruptError);

    expect(barrelR.readRecoveryJournal).toBe(storeR.readRecoveryJournal);
    expect(barrelR.loadPendingRecoveryOperations).toBe(storeR.loadPendingRecoveryOperations);

    expect(barrelR.setRecoveryNoteOperations).toBe(opsR.setRecoveryNoteOperations);
    expect(barrelR.resetRecoveryNoteOperations).toBe(opsR.resetRecoveryNoteOperations);
    expect(barrelR.deleteWorkoutNoteViaRecoveryOperations).toBe(opsR.deleteWorkoutNoteViaRecoveryOperations);

    expect(barrelR.withExclusiveRecoveryAccess).toBe(replayR.withExclusiveRecoveryAccess);
    expect(barrelR.reconcileRecoveryOperations).toBe(replayR.reconcileRecoveryOperations);
    expect(barrelR.runGuardedRecoveryAction).toBe(replayR.runGuardedRecoveryAction);
    expect(barrelR.startRecoveryOperation).toBe(replayR.startRecoveryOperation);
    expect(barrelR.__resetRecoveryOperationJournal).toBe(replayR.__resetRecoveryOperationJournal);
  });

  test('preserves the serialized constant vocabulary verbatim', () => {
    expect(barrelR.RECOVERY_JOURNAL_VERSION).toBe(1);
    expect(barrelR.RECOVERY_OPERATION_TYPES).toEqual({
      COMPLETE_BLOCK_WITH_WEEK: 'complete_block_with_week',
      DELETE_LINKED_NOTE: 'delete_linked_note',
      ADD_WEEK_WITH_NEW_NOTE: 'add_week_with_new_note',
    });
    expect(barrelR.RECOVERY_OPERATION_CODES).toEqual({
      VALIDATION_FAILED: 'VALIDATION_FAILED',
      OPERATION_FAILED: 'OPERATION_FAILED',
      RECONCILIATION_PENDING: 'RECONCILIATION_PENDING',
      JOURNAL_CORRUPT: 'JOURNAL_CORRUPT',
      VERIFIED: 'VERIFIED',
      VERIFIED_CLEANUP_PENDING: 'VERIFIED_CLEANUP_PENDING',
      CONFLICT_CANCELLED: 'CONFLICT_CANCELLED',
    });
    expect(barrelR.RECOVERY_OPERATION_STAGES).toEqual({
      INTENT: 'intent',
      DOMAIN_READ: 'domain_read',
      FIRST_WRITE: 'first_write',
      SECOND_WRITE: 'second_write',
      VERIFY_READ: 'verify_read',
      VERIFIED: 'verified',
      CLEANUP: 'cleanup',
    });
    expect(Object.isFrozen(barrelR.RECOVERY_OPERATION_TYPES)).toBe(true);
    expect(Object.isFrozen(barrelR.RECOVERY_OPERATION_CODES)).toBe(true);
    expect(Object.isFrozen(barrelR.RECOVERY_OPERATION_STAGES)).toBe(true);
  });

  test('reconcileRecoveryOperations remains a spy-able binding (mock seam preserved)', async () => {
    const spy = jest
      .spyOn(barrelR, 'reconcileRecoveryOperations')
      .mockResolvedValue({ ok: true, code: 'VERIFIED', corrupt: false, pending: [], cancelled: [], results: [] });
    const result = await barrelR.reconcileRecoveryOperations();
    expect(spy).toHaveBeenCalled();
    expect(result.code).toBe('VERIFIED');
    spy.mockRestore();
  });

  test('the serialized record shape written at intent time is unchanged', async () => {
    await setBlocks([block('b1')]);
    await setWeeks([week('w1', 'b1', 'n1', 1)]);
    // Keep the record on disk after a verified pass by failing only its clear.
    const spy = failJournalClear();
    await startOp({ blockId: 'b1' }, completeIntent('b1', 'w1'));
    const [rec] = await getJournal();
    spy.mockRestore();

    expect(Object.keys(rec).sort()).toEqual(
      [
        'attempts',
        'block_id',
        'created_at',
        'last_error',
        'operation_id',
        'requested_completed_at',
        'stage',
        'type',
        'updated_at',
        'version',
        'week_id',
      ].sort()
    );
    expect(rec.version).toBe(1);
    expect(rec.type).toBe(TYPES.COMPLETE_BLOCK_WITH_WEEK);
    expect(typeof rec.operation_id).toBe('string');
    expect(rec.operation_id).toMatch(/^recop_/);
  });
});

// ── 2. matrix row: Start — persist intent before the first guarded mutation ────

describe('start: intent is durable before any domain mutation', () => {
  test('the journal intent is written before any block/week write', async () => {
    await setBlocks([block('b1')]);
    await setWeeks([week('w1', 'b1', 'n1', 1)]);
    const order = recordWriteOrder();

    const res = await startOp({ blockId: 'b1' }, completeIntent('b1', 'w1'));

    expect(res.ok).toBe(true);
    expect(order[0]).toBe(RECOVERY_OPERATION_JOURNAL_KEY);
    const intentIdx = order.indexOf(RECOVERY_OPERATION_JOURNAL_KEY);
    expect(intentIdx).toBeLessThan(order.indexOf(RECOVERY_BLOCK_WEEKS_KEY));
    expect(intentIdx).toBeLessThan(order.indexOf(RECOVERY_BLOCKS_KEY));
  });

  test('a failed intent write changes nothing (provable zero domain writes)', async () => {
    await setBlocks([block('b1')]);
    await setWeeks([week('w1', 'b1', 'n1', 1)]);
    failWritesFor([RECOVERY_OPERATION_JOURNAL_KEY]);

    const res = await startOp({ blockId: 'b1' }, completeIntent('b1', 'w1'));

    expect(res.ok).toBe(false);
    expect(res.code).toBe(CODES.OPERATION_FAILED);
    expect((await getBlocks())[0].completed_at).toBeFalsy();
    expect((await getWeeks())[0].completed_at).toBeFalsy();
  });
});

// ── 3. matrix row: Partial write/crash — recorded stage boundaries, idempotent ─

describe('partial write: each protocol boundary is recorded and replays idempotently', () => {
  test('a domain-read failure retains the record at DOMAIN_READ and stays pending', async () => {
    await setBlocks([block('b1')]);
    await setWeeks([week('w1', 'b1', 'n1', 1)]);
    failReadsFor([RECOVERY_BLOCKS_KEY]);

    const res = await startOp({ blockId: 'b1' }, completeIntent('b1', 'w1'));

    expect(res.code).toBe(CODES.RECONCILIATION_PENDING);
    expect(res.stage).toBe(STAGES.DOMAIN_READ);
    expect((await getJournal())[0].stage).toBe(STAGES.DOMAIN_READ);
  });

  test('a first-write failure retains the record at FIRST_WRITE as OPERATION_FAILED', async () => {
    await setBlocks([block('b1')]);
    await setWeeks([week('w1', 'b1', 'n1', 1)]);
    failWritesFor([RECOVERY_BLOCK_WEEKS_KEY]);

    const res = await startOp({ blockId: 'b1' }, completeIntent('b1', 'w1'));

    expect(res.code).toBe(CODES.OPERATION_FAILED);
    expect(res.stage).toBe(STAGES.FIRST_WRITE);
    expect((await getJournal())[0].stage).toBe(STAGES.FIRST_WRITE);
    expect((await getWeeks())[0].completed_at).toBeFalsy();
  });

  test('a second-write failure retains the record at SECOND_WRITE (week done, block not)', async () => {
    await setBlocks([block('b1')]);
    await setWeeks([week('w1', 'b1', 'n1', 1)]);
    failWritesFor([RECOVERY_BLOCKS_KEY]);

    const res = await startOp({ blockId: 'b1' }, completeIntent('b1', 'w1'));

    expect(res.code).toBe(CODES.OPERATION_FAILED);
    expect(res.stage).toBe(STAGES.SECOND_WRITE);
    expect((await getWeeks())[0].completed_at).toBe(completedAt);
    expect((await getBlocks())[0].completed_at).toBeFalsy();
    expect((await getJournal())[0].stage).toBe(STAGES.SECOND_WRITE);
  });

  test('a verification-read failure retains the record at VERIFY_READ and stays pending', async () => {
    await setBlocks([block('b1')]);
    await setWeeks([week('w1', 'b1', 'n1', 1)]);
    // Let the initial domain read through; fail the post-write verification read.
    failReadsFor([RECOVERY_BLOCKS_KEY], { skip: 1 });

    const res = await startOp({ blockId: 'b1' }, completeIntent('b1', 'w1'));

    expect(res.code).toBe(CODES.RECONCILIATION_PENDING);
    expect(res.stage).toBe(STAGES.VERIFY_READ);
    expect((await getJournal())[0].stage).toBe(STAGES.VERIFY_READ);
  });

  test('replaying after a partial write converges without sliding the timestamp', async () => {
    await setBlocks([block('b1')]);
    await setWeeks([week('w1', 'b1', 'n1', 1)]);
    const spy = failWritesFor([RECOVERY_BLOCKS_KEY]);

    const partial = await startOp({ blockId: 'b1' }, completeIntent('b1', 'w1'));
    expect(partial.code).toBe(CODES.OPERATION_FAILED);
    expect((await getWeeks())[0].completed_at).toBe(completedAt);

    // "Restart" and clear the fault, then replay the retained record.
    spy.mockRestore();
    journal.__resetRecoveryOperationJournal();
    const res = await journal.reconcileRecoveryOperations();

    expect(res.ok).toBe(true);
    expect(res.code).toBe(CODES.VERIFIED);
    expect((await getBlocks())[0].completed_at).toBe(completedAt);
    expect((await getWeeks())[0].completed_at).toBe(completedAt);
    expect(await getJournal()).toEqual([]);
  });
});

// ── 4. duplicate replay is idempotent ──────────────────────────────────────────

describe('duplicate replay', () => {
  test('re-running a verified complete-block does not double-apply or move the timestamp', async () => {
    await setBlocks([block('a1')]);
    await setWeeks([week('w1', 'a1', 'n1', 1)]);
    await setJournal([record(completeIntent('a1', 'w1', completedAt))]);

    // First pass verifies but cannot clear, so the record survives for a re-run.
    const spy = failJournalClear();
    const first = await journal.reconcileRecoveryOperations();
    expect(first.results[0].code).toBe(CODES.VERIFIED_CLEANUP_PENDING);
    expect((await getBlocks())[0].completed_at).toBe(completedAt);

    spy.mockRestore();
    const second = await journal.reconcileRecoveryOperations();
    expect(second.ok).toBe(true);
    expect(second.code).toBe(CODES.VERIFIED);
    expect((await getBlocks())[0].completed_at).toBe(completedAt);
    expect((await getWeeks())[0].completed_at).toBe(completedAt);
    expect(await getJournal()).toEqual([]);
  });

  test('re-running a verified add-week never mints a second week or ordinal', async () => {
    await setBlocks([block('a1')]);
    await setWeeks([]);
    const notes = [];
    journal.setRecoveryNoteOperations(makeNoteStore(notes));
    await setJournal([record(addWeekIntent('a1', 'n1', 'wk1', 1))]);

    const spy = failJournalClear();
    const first = await journal.reconcileRecoveryOperations();
    expect(first.results[0].code).toBe(CODES.VERIFIED_CLEANUP_PENDING);
    expect((await getWeeks()).filter((w) => !w.deleted_at)).toHaveLength(1);

    spy.mockRestore();
    const second = await journal.reconcileRecoveryOperations();
    expect(second.ok).toBe(true);
    const live = (await getWeeks()).filter((w) => !w.deleted_at);
    expect(live).toHaveLength(1);
    expect(live[0].id).toBe('wk1');
    expect(live[0].week_number).toBe(1);
    expect(await getJournal()).toEqual([]);
  });
});

// ── 5. matrix row: Malformed journal — same typed corruption, evidence kept ────

describe('malformed journal', () => {
  test('unparseable bytes raise the typed corruption result and retain evidence', async () => {
    await AsyncStorage.setItem(RECOVERY_OPERATION_JOURNAL_KEY, '{not json');

    const res = await journal.reconcileRecoveryOperations();
    expect(res.corrupt).toBe(true);
    expect(res.code).toBe(CODES.JOURNAL_CORRUPT);
    expect(res.pending).toEqual([]);
    // Evidence is not discarded.
    expect(await AsyncStorage.getItem(RECOVERY_OPERATION_JOURNAL_KEY)).toBe('{not json');

    const err = await journal.readRecoveryJournal().catch((e) => e);
    expect(journal.isRecoveryJournalCorruptError(err)).toBe(true);
    expect(err).toBeInstanceOf(journal.RecoveryJournalCorruptError);
    expect(err.name).toBe('RecoveryJournalCorruptError');
    expect(err.code).toBe(CODES.JOURNAL_CORRUPT);
  });

  test('an unsupported schema version fails closed and is retained', async () => {
    await setJournal([
      { version: 99, operation_id: 'x', created_at: nowISO, type: TYPES.COMPLETE_BLOCK_WITH_WEEK, block_id: 'b', requested_completed_at: completedAt },
    ]);
    const res = await journal.reconcileRecoveryOperations();
    expect(res.code).toBe(CODES.JOURNAL_CORRUPT);
    expect(await getJournal()).toHaveLength(1);
  });

  test('a malformed record blocks a new operation instead of writing under it', async () => {
    await setBlocks([block('b1')]);
    await setWeeks([week('w1', 'b1', 'n1', 1)]);
    await setJournal([{ version: 1, type: TYPES.DELETE_LINKED_NOTE }]); // missing required fields

    const res = await startOp({ blockId: 'b1' }, completeIntent('b1', 'w1'));

    expect(res.ok).toBe(false);
    expect(res.code).toBe(CODES.JOURNAL_CORRUPT);
    expect((await getBlocks())[0].completed_at).toBeFalsy();
  });
});

// ── 6. matrix row: Successful replay — verify, then clear only the completed ───

describe('successful replay', () => {
  test('completes both records with ONE stable timestamp and clears the journal', async () => {
    await setBlocks([block('b1')]);
    await setWeeks([week('w1', 'b1', 'n1', 1)]);

    const res = await startOp({ blockId: 'b1' }, completeIntent('b1', 'w1'));

    expect(res.ok).toBe(true);
    expect(res.code).toBe(CODES.VERIFIED);
    const [b] = await getBlocks();
    const [w] = await getWeeks();
    expect(b.completed_at).toBe(completedAt);
    expect(w.completed_at).toBe(completedAt);
    expect(await getJournal()).toEqual([]);
  });

  test('clears only the completed operation and retains the still-pending one', async () => {
    await setBlocks([block('a1'), block('b2')]);
    await setWeeks([week('w1', 'a1', 'n1', 1), week('w2', 'b2', 'n2', 1)]);
    // A note store whose deletion never actually persists keeps op2 pending.
    journal.setRecoveryNoteOperations({
      loadNoteState: async () => ({ exists: true, deleted: false, requiresQueue: false, queued: false }),
      deleteNote: async () => {},
    });
    await setJournal([record(completeIntent('a1', 'w1')), record(deleteNoteIntent('w2', 'n2'))]);

    const res = await journal.reconcileRecoveryOperations();

    expect(res.ok).toBe(false);
    expect(res.code).toBe(CODES.RECONCILIATION_PENDING);
    expect(res.pending).toHaveLength(1);
    expect(res.pending[0].note_id).toBe('n2');

    const remaining = await getJournal();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].type).toBe(TYPES.DELETE_LINKED_NOTE);
    expect((await getBlocks()).find((b) => b.id === 'a1').completed_at).toBe(completedAt);
  });

  test('a verified operation whose cleanup fails reports cleanup-pending and keeps the record', async () => {
    await setBlocks([block('a1')]);
    await setWeeks([week('w1', 'a1', 'n1', 1)]);
    await setJournal([record(completeIntent('a1', 'w1'))]);
    failJournalClear();

    const res = await journal.reconcileRecoveryOperations();

    // The reconcile is ok (no pending), but the individual result signals that
    // the user-visible operation succeeded while cleanup still needs retry.
    expect(res.ok).toBe(true);
    expect(res.results[0].code).toBe(CODES.VERIFIED_CLEANUP_PENDING);
    expect(res.results[0].ok).toBe(true);
    expect((await getBlocks())[0].completed_at).toBe(completedAt);
    expect(await getJournal()).toHaveLength(1);
  });
});

// ── 7. stale identity — recorded outcome no longer reachable ───────────────────

describe('stale identity', () => {
  test('a completed-block op whose block was deleted is retired as redundant, no domain writes', async () => {
    await setBlocks([block('a1', { deleted_at: deletedAt })]);
    await setWeeks([week('w1', 'a1', 'n1', 1)]);
    await setJournal([record(completeIntent('a1', 'w1'))]);
    const order = recordWriteOrder();

    const res = await journal.reconcileRecoveryOperations();

    expect(res.ok).toBe(true);
    expect(res.results[0].code).toBe(CODES.VERIFIED);
    expect(order).not.toContain(RECOVERY_BLOCKS_KEY);
    expect(order).not.toContain(RECOVERY_BLOCK_WEEKS_KEY);
    expect(await getJournal()).toEqual([]);
  });

  test('an add-week op is terminally cancelled when its block was removed, keeping the note', async () => {
    await setBlocks([]); // block gone
    await setWeeks([]);
    const notes = [{ id: 'n1', deleted_at: null }]; // note already minted; must be kept
    journal.setRecoveryNoteOperations(makeNoteStore(notes));
    await setJournal([record(addWeekIntent('gone', 'n1', 'wk1', 1))]);

    const res = await journal.reconcileRecoveryOperations();

    expect(res.ok).toBe(true); // nothing pending
    expect(res.cancelled).toHaveLength(1);
    expect(res.cancelled[0].terminal).toBe(true);
    expect(res.cancelled[0].code).toBe(CODES.CONFLICT_CANCELLED);
    expect(res.code).toBe(CODES.CONFLICT_CANCELLED);
    expect(await getJournal()).toEqual([]); // record cleared: nothing stays locked
    expect(notes.find((n) => n.id === 'n1')).toBeTruthy(); // user data preserved
  });
});

// ── 8. concurrent action — one lock serializes everything ──────────────────────

describe('concurrent action', () => {
  test('a pending operation blocks a guarded action over the same scope, not others', async () => {
    await setWeeks([week('w2', 'b2', 'n2', 1)]);
    journal.setRecoveryNoteOperations({
      loadNoteState: async () => ({ exists: true, deleted: false, requiresQueue: false, queued: false }),
      deleteNote: async () => {},
    });
    await setJournal([record(deleteNoteIntent('w2', 'n2'))]);

    let ranBlocked = false;
    const blocked = await journal.runGuardedRecoveryAction({ noteId: 'n2' }, async () => {
      ranBlocked = true;
      return { ok: true };
    });
    expect(ranBlocked).toBe(false);
    expect(blocked.ok).toBe(false);
    expect(blocked.code).toBe(CODES.RECONCILIATION_PENDING);

    let ranOther = false;
    const allowed = await journal.runGuardedRecoveryAction({ noteId: 'other' }, async () => {
      ranOther = true;
      return { ok: true, code: CODES.VERIFIED };
    });
    expect(ranOther).toBe(true);
    expect(allowed.ok).toBe(true);
  });

  test('exclusive access holds the lock so a competing guarded action runs after it', async () => {
    const order = [];
    const p1 = journal.withExclusiveRecoveryAccess(async ({ reconcile }) => {
      order.push('exclusive:start');
      await reconcile();
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push('exclusive:end');
      return { ok: true };
    });
    const p2 = journal.runGuardedRecoveryAction({ blockId: 'none' }, async () => {
      order.push('guarded');
      return { ok: true };
    });

    await Promise.all([p1, p2]);
    expect(order).toEqual(['exclusive:start', 'exclusive:end', 'guarded']);
  });
});

// ── 9. matrix row: Clean restore — no stale lock/cache after a restart ─────────

describe('clean restore', () => {
  test('reconciliation converges from the durable journal after a simulated restart, with no stale lock', async () => {
    // A partially-applied complete-block left on disk: week done, block not.
    await setBlocks([block('a1')]);
    await setWeeks([week('w1', 'a1', 'n1', 1, { completed_at: completedAt, updated_at: completedAt })]);
    await setJournal([record({ ...completeIntent('a1', 'w1', completedAt), stage: STAGES.SECOND_WRITE })]);

    // Simulate process restart: wipe all in-memory lock/dedup/registry state.
    journal.__resetRecoveryOperationJournal();

    const res = await journal.reconcileRecoveryOperations();
    expect(res.ok).toBe(true);
    expect(res.code).toBe(CODES.VERIFIED);
    expect((await getBlocks())[0].completed_at).toBe(completedAt);
    expect((await getWeeks())[0].completed_at).toBe(completedAt);
    expect(await getJournal()).toEqual([]);

    // No stale lock or cache: the pending read resolves empty and a fresh
    // exclusive operation proceeds immediately.
    await expect(journal.loadPendingRecoveryOperations()).resolves.toEqual([]);

    await setBlocks([block('a1', { completed_at: completedAt }), block('a2')]);
    await setWeeks([
      week('w1', 'a1', 'n1', 1, { completed_at: completedAt }),
      week('w2', 'a2', 'n2', 1),
    ]);
    const fresh = await startOp({ blockId: 'a2' }, completeIntent('a2', 'w2', '2026-03-01T00:00:00.000Z'));
    expect(fresh.ok).toBe(true);
    expect(fresh.code).toBe(CODES.VERIFIED);
    expect((await getBlocks()).find((b) => b.id === 'a2').completed_at).toBe('2026-03-01T00:00:00.000Z');
  });

  test('the registered note operations route through the mode-aware adapter', async () => {
    const calls = [];
    journal.setRecoveryNoteOperations({
      deleteNote: async (id) => {
        calls.push(id);
      },
    });
    await journal.deleteWorkoutNoteViaRecoveryOperations('note-42');
    expect(calls).toEqual(['note-42']);

    // Resetting restores the default local-only registry (no thrown error).
    journal.resetRecoveryNoteOperations();
  });
});

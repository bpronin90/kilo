// Journaled Tidy names write path (#1309): stale-preview rejection with zero
// writes, one durable roll-forward result, injected failures at every storage
// boundary, concurrent edits, explicit conflict resolution, and verified Undo.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureRecoveryBaselineFromText } from '../lib/data/recoveryBlocks';
import { normalizeExerciseKey } from '../lib/parser';
import { planTidyNames } from '../lib/data/recoveryTidyNames';
import {
  RECOVERY_BLOCKS_KEY, RECOVERY_BLOCK_WEEKS_KEY, RECOVERY_OPERATION_JOURNAL_KEY, WORKOUT_NOTES_KEY,
} from '../storage/entries/keys';
import { TIDY_PAYLOAD_KEY } from '../storage/entries/recoveryTidyPayload';
import * as Storage from '../storage/entries';
import * as journal from '../storage/entries/recoveryOperationJournal';
import * as tidyPayload from '../storage/entries/recoveryTidyPayload';
import * as batch from '../storage/entries/workoutNoteRecoveryBatch';
import { exportBackup } from '../storage/entries/backupExport';
import * as syncQueue from '../storage/syncQueue';
import { setStorageMode } from '../storage/entries/storageMode';
import { registerRecoveryNoteOperations } from '../hooks/entries/storageMode';
import * as recoveryReadState from '../hooks/entries/recoveryReadState';
import * as noteHooks from '../hooks/entries/workoutNoteHooks';
import { tidyNamesCore, undoTidyNamesCore, loadTidyUndoSummary } from '../hooks/entries/recoveryTidyMutations';

jest.mock('../lib/supabaseClient', () => ({ getSupabaseClient: jest.fn() }));

const STAMP = '2026-05-01T00:00:00Z';
const SQUAT = [
  'Squat — empty bar or very light, 3x8 (movement/pain test, not a working set)',
  'Squat 3x6-8, step up from empty bar 135-155',
  'Squat 3x6-8, step up',
  'Squat 3x6-8, step up',
  'Squat 3x8',
  'Squat 3x8',
];
const weekText = (h, i) => `-${h}\r\n- 135 8,8,8\r\n-Bench\r\n- ${100 + i} 5\r\n`;
const NOTE_IDS = SQUAT.map((_h, i) => `n${i + 1}`);

const storage = () => ({
  ...Storage,
  loadTidyUndoPayload: tidyPayload.loadTidyUndoPayload,
  saveTidyPayload: tidyPayload.saveTidyPayload,
  sweepTidyPayloads: tidyPayload.sweepTidyPayloads,
  readRecoveryJournal: journal.readRecoveryJournal,
});
const read = async (key) => JSON.parse((await AsyncStorage.getItem(key)) || '[]');
const noteTexts = async () => (await read(WORKOUT_NOTES_KEY)).map(n => n.raw_text);
const snapshot = async () => JSON.stringify(await Promise.all(
  [RECOVERY_BLOCKS_KEY, RECOVERY_BLOCK_WEEKS_KEY, WORKOUT_NOTES_KEY, RECOVERY_OPERATION_JOURNAL_KEY, TIDY_PAYLOAD_KEY].map(k => AsyncStorage.getItem(k))
));

let original;
async function seed() {
  const baseline = captureRecoveryBaselineFromText('-Squat\n- 225 5,5,5\n-Bench\n- 185 5');
  const block = {
    id: 'rb1', baseline, baseline_note_id: 'nb', baseline_note_title: 'Routine', started_at: STAMP, completed_at: null,
    saved_at: STAMP, updated_at: STAMP, deleted_at: null, include_in_normal_analytics: false, reason: null,
  };
  await AsyncStorage.setItem(RECOVERY_BLOCKS_KEY, JSON.stringify([block]));
  await AsyncStorage.setItem(RECOVERY_BLOCK_WEEKS_KEY, JSON.stringify(SQUAT.map((_h, i) => ({
    id: `w${i + 1}`, block_id: 'rb1', note_id: `n${i + 1}`, week_number: i + 1, completed_at: null, saved_at: STAMP, updated_at: STAMP, deleted_at: null,
  }))));
  await AsyncStorage.setItem(WORKOUT_NOTES_KEY, JSON.stringify(SQUAT.map((h, i) => ({
    id: `n${i + 1}`, title: `Week ${i + 1}`, raw_text: weekText(h, i), saved_at: STAMP, updated_at: STAMP, deleted_at: null, isCurrent: i === 0, tracked_exercises: ['x'],
  }))));
  original = await noteTexts();
}

// The reviewed evidence + signature, derived from authoritative storage like the UI does.
async function review() {
  const block = (await Storage.loadRecoveryBlocks())[0];
  const plan = planTidyNames({ block, weeks: await Storage.loadRecoveryBlockWeeks(), notes: await Storage.loadWorkoutNotes() });
  return { blockId: 'rb1', evidence: plan.evidence, signature: plan.signature, plan };
}
const tidy = async (over = {}) => {
  const { plan: _plan, ...params } = await review();
  return tidyNamesCore(storage(), { ...params, ...over });
};

beforeEach(async () => {
  await AsyncStorage.clear();
  journal.__resetRecoveryOperationJournal();
  await seed();
});
afterEach(() => { jest.restoreAllMocks(); journal.__resetRecoveryOperationJournal(); });

describe('verified apply', () => {
  test('rewrites every week and the baseline as one result, preserving numbers and metadata', async () => {
    const before = (await Storage.loadRecoveryBlocks())[0];
    const result = await tidy();
    expect(result).toMatchObject({ ok: true, code: 'VERIFIED' });
    const texts = await noteTexts();
    expect(texts[0]).toBe('-Squat\r\n- 135 8,8,8\r\n-- empty bar or very light, 3x8 (movement/pain test, not a working set)\r\n-Bench\r\n- 100 5\r\n');
    expect(texts[1]).toBe('-Squat 3x6-8\r\n- 135 8,8,8\r\n-- step up from empty bar 135-155\r\n-Bench\r\n- 101 5\r\n');
    expect(texts[4]).toBe(original[4]);
    const notes = await read(WORKOUT_NOTES_KEY);
    expect(notes[0]).toMatchObject({ isCurrent: true, tracked_exercises: ['x'], title: 'Week 1' });
    const after = (await Storage.loadRecoveryBlocks())[0];
    expect(after.baseline).toEqual(before.baseline); // already clean: nothing renamed
    expect(await read(RECOVERY_OPERATION_JOURNAL_KEY)).toEqual([]);
    expect((await read(TIDY_PAYLOAD_KEY))[0]).toMatchObject({ status: 'applied', block_id: 'rb1' });
  });

  test('a messy baseline name is cleaned together with the weeks; frozen numbers never change', async () => {
    const [block] = await read(RECOVERY_BLOCKS_KEY);
    const messy = 'Squat — 3×6-8, start light';
    block.baseline = {
      ...block.baseline,
      exercises: block.baseline.exercises.map(r => (r.key === 'squat' ? { ...r, key: normalizeExerciseKey(messy), name: messy } : r)),
    };
    await AsyncStorage.setItem(RECOVERY_BLOCKS_KEY, JSON.stringify([block]));
    const result = await tidy();
    expect(result.ok).toBe(true);
    const [after] = await read(RECOVERY_BLOCKS_KEY);
    const row = after.baseline.exercises.find(r => r.name === 'Squat');
    const was = block.baseline.exercises[0];
    expect(row).toEqual({ ...was, key: 'squat', name: 'Squat' });
    expect(after.baseline.version).toBe(block.baseline.version);
    expect(after.baseline.exercises.map(r => r.key)).toEqual(['squat', 'bench']);
  });
});

describe('stale preview', () => {
  test.each([
    ['note text', async () => {
      const notes = await read(WORKOUT_NOTES_KEY);
      notes[2].raw_text += '-- edited\r\n';
      await AsyncStorage.setItem(WORKOUT_NOTES_KEY, JSON.stringify(notes));
    }],
    ['note timestamp', async () => {
      const notes = await read(WORKOUT_NOTES_KEY);
      notes[0].updated_at = '2026-06-01T00:00:00Z';
      await AsyncStorage.setItem(WORKOUT_NOTES_KEY, JSON.stringify(notes));
    }],
    ['membership', async () => {
      const weeks = await read(RECOVERY_BLOCK_WEEKS_KEY);
      weeks[5].deleted_at = STAMP;
      await AsyncStorage.setItem(RECOVERY_BLOCK_WEEKS_KEY, JSON.stringify(weeks));
    }],
    ['baseline', async () => {
      const [b] = await read(RECOVERY_BLOCKS_KEY);
      b.baseline.exercises[1].name = 'Bench Press';
      await AsyncStorage.setItem(RECOVERY_BLOCKS_KEY, JSON.stringify([b]));
    }],
    ['lifecycle', async () => {
      const [b] = await read(RECOVERY_BLOCKS_KEY);
      b.completed_at = STAMP;
      await AsyncStorage.setItem(RECOVERY_BLOCKS_KEY, JSON.stringify([b]));
    }],
    ['deleted block', async () => {
      const [b] = await read(RECOVERY_BLOCKS_KEY);
      b.deleted_at = STAMP;
      await AsyncStorage.setItem(RECOVERY_BLOCKS_KEY, JSON.stringify([b]));
    }],
  ])('a changed %s rejects the preview with zero domain writes', async (_name, mutate) => {
    const params = await review();
    await mutate();
    const frozen = await snapshot();
    const { plan: _plan, ...rest } = params;
    const result = await tidyNamesCore(storage(), rest);
    expect(result).toMatchObject({ ok: false });
    expect(await snapshot()).toBe(frozen);
  });

  test('a missing preview fingerprint is rejected, and an empty plan reports no change', async () => {
    const frozen = await snapshot();
    expect(await tidy({ evidence: undefined })).toMatchObject({ ok: false });
    expect(await snapshot()).toBe(frozen);
    expect((await tidy()).ok).toBe(true);
    const again = await tidy();
    expect(again).toMatchObject({ ok: false });
    expect(again.error).toMatch(/already tidy/i);
  });
});

describe('injected failures (durable pending, then roll-forward)', () => {
  const recordsLeft = async () => (await read(RECOVERY_OPERATION_JOURNAL_KEY));

  test('payload write failure: nothing started, nothing changed', async () => {
    jest.spyOn(tidyPayload, 'saveTidyPayload');
    const params = await review();
    const { plan: _p, ...rest } = params;
    const frozen = await snapshot();
    const bad = { ...storage(), saveTidyPayload: async () => { throw new Error('disk full'); } };
    expect(await tidyNamesCore(bad, rest)).toMatchObject({ ok: false });
    expect(await snapshot()).toBe(frozen);
  });

  test('journal intent failure leaves an orphan payload that the next start sweeps', async () => {
    const params = await review();
    const { plan: _p, ...rest } = params;
    const write = require('../storage/entries/jsonStorage').writeList;
    const spy = jest.spyOn(require('../storage/entries/jsonStorage'), 'writeList').mockImplementation(async (key, ...a) => {
      if (key === RECOVERY_OPERATION_JOURNAL_KEY) throw new Error('journal write failed');
      return write(key, ...a);
    });
    const result = await tidyNamesCore(storage(), rest);
    spy.mockRestore();
    expect(result).toMatchObject({ ok: false });
    expect(await noteTexts()).toEqual(original);
    expect((await read(TIDY_PAYLOAD_KEY)).length).toBe(1);
    const retry = await tidy();
    expect(retry.ok).toBe(true);
    expect((await read(TIDY_PAYLOAD_KEY)).length).toBe(1);
  });

  test('notebook write failure keeps a pending record and payload; a retry rolls forward once', async () => {
    let fail = true;
    journal.setRecoveryNoteOperations({
      applyTidyTexts: async (req) => (fail ? { status: 'failed', error: new Error('notebook write failed'), written: [] } : batch.applyTidyNoteTexts(req)),
      loadTidyTextStates: batch.loadTidyTextStates,
    });
    const result = await tidy();
    expect(result).toMatchObject({ ok: false, code: 'OPERATION_FAILED', tidy: true });
    expect(await noteTexts()).toEqual(original);
    expect((await recordsLeft()).length).toBe(1);
    expect((await read(TIDY_PAYLOAD_KEY))[0].status).toBe('pending');
    fail = false;
    const reconciled = await journal.reconcileRecoveryOperations();
    expect(reconciled.ok).toBe(true);
    const texts = await noteTexts();
    expect(texts[2].match(/^-- /gm)).toHaveLength(1);
    expect(await recordsLeft()).toEqual([]);
  });

  test('commit-then-throw is not success; replay verifies without duplicating comments', async () => {
    let throwOnce = true;
    journal.setRecoveryNoteOperations({
      applyTidyTexts: async (req) => {
        const r = await batch.applyTidyNoteTexts(req);
        if (throwOnce) { throwOnce = false; throw new Error('threw after commit'); }
        return r;
      },
      loadTidyTextStates: batch.loadTidyTextStates,
    });
    const result = await tidy();
    expect(result.ok).toBe(false);
    expect((await noteTexts())[1]).toContain('-- step up from empty bar');
    expect((await recordsLeft()).length).toBe(1);
    expect((await journal.reconcileRecoveryOperations()).ok).toBe(true);
    const texts = await noteTexts();
    expect(texts.every(t => (t.match(/^-- /gm) || []).length <= 1)).toBe(true);
    expect(await recordsLeft()).toEqual([]);
  });

  test('a failed baseline write after the notes committed stays pending, then completes', async () => {
    const [block] = await read(RECOVERY_BLOCKS_KEY);
    const messy = 'Squat — light';
    block.baseline.exercises[0] = { ...block.baseline.exercises[0], key: normalizeExerciseKey(messy), name: messy };
    await AsyncStorage.setItem(RECOVERY_BLOCKS_KEY, JSON.stringify([block]));
    const json = require('../storage/entries/jsonStorage');
    const write = json.writeList;
    let fail = true;
    jest.spyOn(json, 'writeList').mockImplementation(async (key, ...a) => {
      if (key === RECOVERY_BLOCKS_KEY && fail) throw new Error('block write failed');
      return write(key, ...a);
    });
    const result = await tidy();
    expect(result).toMatchObject({ ok: false, tidy: true });
    expect((await noteTexts())[2]).toContain('-- step up');
    expect((await read(RECOVERY_BLOCKS_KEY))[0].baseline.exercises[0].name).toBe(messy);
    fail = false;
    expect((await journal.reconcileRecoveryOperations()).ok).toBe(true);
    expect((await read(RECOVERY_BLOCKS_KEY))[0].baseline.exercises[0]).toMatchObject({ key: 'squat', name: 'Squat' });
  });

  test('a failed verification read is pending, never success', async () => {
    let calls = 0;
    journal.setRecoveryNoteOperations({
      applyTidyTexts: batch.applyTidyNoteTexts,
      loadTidyTextStates: async (ids) => {
        calls += 1;
        if (calls === 2) throw new Error('read failed');
        return batch.loadTidyTextStates(ids);
      },
    });
    const result = await tidy();
    expect(result).toMatchObject({ ok: false, code: 'RECONCILIATION_PENDING' });
    expect((await recordsLeft()).length).toBe(1);
    expect((await journal.reconcileRecoveryOperations()).ok).toBe(true);
  });

  test('cleanup-only failure is reported separately and retried', async () => {
    const spy = jest.spyOn(tidyPayload, 'markTidyPayloadApplied').mockRejectedValueOnce(new Error('cleanup failed'));
    const result = await tidy();
    expect(result).toMatchObject({ ok: true, code: 'VERIFIED_CLEANUP_PENDING' });
    expect((await recordsLeft()).length).toBe(1);
    spy.mockRestore();
    expect((await journal.reconcileRecoveryOperations()).ok).toBe(true);
    expect(await recordsLeft()).toEqual([]);
    expect((await read(TIDY_PAYLOAD_KEY))[0].status).toBe('applied');
  });

  test('a restart (fresh module state) resumes a pending record from persisted state alone', async () => {
    journal.setRecoveryNoteOperations({ applyTidyTexts: async () => ({ status: 'failed', error: new Error('x'), written: [] }), loadTidyTextStates: batch.loadTidyTextStates });
    await tidy();
    journal.__resetRecoveryOperationJournal();
    expect((await journal.reconcileRecoveryOperations()).ok).toBe(true);
    expect((await noteTexts())[3]).toContain('-- step up');
  });
});

describe('concurrent changes and explicit resolution', () => {
  async function pendingWithEdit() {
    let fail = true;
    journal.setRecoveryNoteOperations({
      applyTidyTexts: async (req) => (fail ? { status: 'failed', error: new Error('x'), written: [] } : batch.applyTidyNoteTexts(req)),
      loadTidyTextStates: batch.loadTidyTextStates,
    });
    await tidy();
    const notes = await read(WORKOUT_NOTES_KEY);
    notes[2].raw_text += '- 140 6\r\n'; // authored after the intent
    await AsyncStorage.setItem(WORKOUT_NOTES_KEY, JSON.stringify(notes));
    fail = false;
  }

  test('an edited note is never overwritten: conflict state, zero further writes, record retained', async () => {
    await pendingWithEdit();
    const frozen = await snapshot();
    const rec = await journal.reconcileRecoveryOperations();
    expect(rec.ok).toBe(false);
    expect(rec.pending[0]).toMatchObject({ conflict: true, tidy: true });
    expect((await noteTexts())[2]).toContain('- 140 6');
    const after = JSON.parse(await snapshot());
    expect(after[2]).toBe(JSON.parse(frozen)[2]); // notes untouched
    expect((await read(RECOVERY_OPERATION_JOURNAL_KEY))[0].conflict).toBeTruthy();
  });

  test('Keep current names clears the record and payload without touching notes', async () => {
    await pendingWithEdit();
    const rec = await journal.reconcileRecoveryOperations();
    const before = await noteTexts();
    const result = await journal.resolveTidyConflict({ operationId: rec.pending[0].operationId, choice: 'keep' });
    expect(result).toMatchObject({ ok: true, resolution: 'keep' });
    expect(await noteTexts()).toEqual(before);
    expect(await read(RECOVERY_OPERATION_JOURNAL_KEY)).toEqual([]);
    expect(await read(TIDY_PAYLOAD_KEY)).toEqual([]);
  });

  test('Restore is journaled and compare-and-set: tidied notes revert, the edited note is kept', async () => {
    await pendingWithEdit();
    // A first attempt wrote nothing, so tidy a second time without the edit gate.
    const rec = await journal.reconcileRecoveryOperations();
    const result = await journal.resolveTidyConflict({ operationId: rec.pending[0].operationId, choice: 'restore' });
    expect(result).toMatchObject({ ok: true, resolution: 'restore' });
    const texts = await noteTexts();
    expect(texts[0]).toBe(original[0]);
    expect(texts[2]).toBe(`${original[2]}- 140 6\r\n`);
    expect(await read(RECOVERY_OPERATION_JOURNAL_KEY)).toEqual([]);
    expect(await read(TIDY_PAYLOAD_KEY)).toEqual([]);
  });

  test('a deleted note and a missing or corrupt payload are conflicts, never silent success', async () => {
    let fail = true;
    journal.setRecoveryNoteOperations({
      applyTidyTexts: async (req) => (fail ? { status: 'failed', error: new Error('x'), written: [] } : batch.applyTidyNoteTexts(req)),
      loadTidyTextStates: batch.loadTidyTextStates,
    });
    await tidy();
    await AsyncStorage.setItem(TIDY_PAYLOAD_KEY, JSON.stringify([{ id: 'garbage' }]));
    fail = false;
    const rec = await journal.reconcileRecoveryOperations();
    expect(rec.pending[0]).toMatchObject({ conflict: true });
    expect(rec.pending[0].conflicts[0].reason).toBe('payload_missing');
    expect(await noteTexts()).toEqual(original);
  });

  test('a note deleted after the intent is a conflict; Keep leaves the deletion alone', async () => {
    let fail = true;
    journal.setRecoveryNoteOperations({
      applyTidyTexts: async (req) => (fail ? { status: 'failed', error: new Error('x'), written: [] } : batch.applyTidyNoteTexts(req)),
      loadTidyTextStates: batch.loadTidyTextStates,
    });
    await tidy();
    const notes = await read(WORKOUT_NOTES_KEY);
    notes[1].deleted_at = STAMP;
    await AsyncStorage.setItem(WORKOUT_NOTES_KEY, JSON.stringify(notes));
    fail = false;
    const rec = await journal.reconcileRecoveryOperations();
    expect(rec.pending[0]).toMatchObject({ conflict: true });
    expect(rec.pending[0].conflicts[0]).toMatchObject({ id: 'n2', reason: 'missing' });
    expect((await noteTexts())[0]).toBe(original[0]);
  });

  test('resolving something that is not a conflict is refused', async () => {
    expect(await journal.resolveTidyConflict({ operationId: 'nope', choice: 'keep' })).toMatchObject({ ok: false });
  });
});

describe('Undo', () => {
  test('restores header/comment bytes and baseline together, then is consumed', async () => {
    const [block] = await read(RECOVERY_BLOCKS_KEY);
    const messy = 'Squat — light';
    block.baseline.exercises[0] = { ...block.baseline.exercises[0], key: normalizeExerciseKey(messy), name: messy };
    await AsyncStorage.setItem(RECOVERY_BLOCKS_KEY, JSON.stringify([block]));
    const blocksBefore = await AsyncStorage.getItem(RECOVERY_BLOCKS_KEY);
    expect((await tidy()).ok).toBe(true);
    const s = await loadTidyUndoSummary(storage(), {
      blockId: 'rb1', block: (await Storage.loadRecoveryBlocks())[0], notes: await Storage.loadWorkoutNotes(),
    });
    expect(s).toMatchObject({ available: true, noteCount: 4 });
    const undone = await undoTidyNamesCore(storage(), { blockId: 'rb1' });
    expect(undone).toMatchObject({ ok: true });
    expect(await noteTexts()).toEqual(original);
    const [restored] = await read(RECOVERY_BLOCKS_KEY);
    expect(restored.baseline).toEqual(JSON.parse(blocksBefore)[0].baseline);
    expect(await read(TIDY_PAYLOAD_KEY)).toEqual([]);
    expect(await undoTidyNamesCore(storage(), { blockId: 'rb1' })).toMatchObject({ ok: false });
  });

  test('is withheld after a later edit, and rejects with no destructive overwrite', async () => {
    expect((await tidy()).ok).toBe(true);
    const notes = await read(WORKOUT_NOTES_KEY);
    notes[1].raw_text += '- 150 5\r\n';
    await AsyncStorage.setItem(WORKOUT_NOTES_KEY, JSON.stringify(notes));
    const frozen = await snapshot();
    expect(await loadTidyUndoSummary(storage(), {
      blockId: 'rb1', block: (await Storage.loadRecoveryBlocks())[0], notes: await Storage.loadWorkoutNotes(),
    })).toEqual({ available: false });
    expect(await undoTidyNamesCore(storage(), { blockId: 'rb1' })).toMatchObject({ ok: false });
    expect(await snapshot()).toBe(frozen);
  });

  test('a second tidy replaces the block’s Undo payload; expiry withholds it', async () => {
    expect((await tidy()).ok).toBe(true);
    const [p] = await read(TIDY_PAYLOAD_KEY);
    expect(await tidyPayload.loadTidyUndoPayload('rb1', Date.parse(p.expires_at) + 1)).toBeNull();
    expect((await tidyPayload.loadTidyUndoPayload('rb1'))?.id).toBe(p.id);
  });
});

describe('device-local only', () => {
  test('the undo payload and journal vocabulary stay out of the backup export', async () => {
    expect((await tidy()).ok).toBe(true);
    expect((await read(TIDY_PAYLOAD_KEY)).length).toBe(1);
    const exported = JSON.stringify(await exportBackup());
    expect(exported).not.toContain('tidy_');
    expect(exported).not.toContain('payload_id');
    expect(exported).not.toContain('"before"');
    expect(exported).not.toContain(TIDY_PAYLOAD_KEY);
    expect(exported).not.toContain('tidy_recovery_names');
  });

  test('journal records never carry workout text', async () => {
    journal.setRecoveryNoteOperations({ applyTidyTexts: async () => ({ status: 'failed', error: new Error('x'), written: [] }), loadTidyTextStates: batch.loadTidyTextStates });
    await tidy();
    const raw = await AsyncStorage.getItem(RECOVERY_OPERATION_JOURNAL_KEY);
    expect(raw).not.toContain('Squat');
    expect(JSON.parse(raw)[0]).toMatchObject({ type: 'tidy_recovery_names', direction: 'apply', block_id: 'rb1' });
  });

  test('a malformed tidy journal record fails closed', async () => {
    await AsyncStorage.setItem(RECOVERY_OPERATION_JOURNAL_KEY, JSON.stringify([{
      version: 1, operation_id: 'x', created_at: STAMP, type: 'tidy_recovery_names', block_id: 'rb1', direction: 'sideways',
    }]));
    expect((await journal.reconcileRecoveryOperations()).corrupt).toBe(true);
  });
});

describe('cloud mode', () => {
  const dirtyNotes = async () => (await syncQueue.getDirtyRecords(syncQueue.SYNC_TABLES.WORKOUT_NOTES));
  beforeEach(() => { setStorageMode('cloud'); registerRecoveryNoteOperations(); });
  afterEach(() => setStorageMode('local'));

  test('stamps the immutable requested timestamp, enqueues exactly the tidied notes, and verifies', async () => {
    expect((await tidy())).toMatchObject({ ok: true, code: 'VERIFIED' });
    const [payload] = await read(TIDY_PAYLOAD_KEY);
    const notes = await read(WORKOUT_NOTES_KEY);
    expect(notes.slice(0, 4).every(n => n.updated_at === payload.requested_at && n.client_id)).toBe(true);
    expect(notes.slice(4).every(n => n.updated_at === STAMP)).toBe(true);
    const dirty = await dirtyNotes();
    expect(dirty.map(r => r.id).sort()).toEqual(['n1', 'n2', 'n3', 'n4']);
    expect(dirty.find(r => r.id === 'n2').raw_text).toBe(notes[1].raw_text);
  });

  test('an enqueue failure after the commit is not success; replay re-enqueues without re-stamping', async () => {
    const real = syncQueue.enqueueDirty;
    let calls = 0;
    jest.spyOn(syncQueue, 'enqueueDirty').mockImplementation(async (...a) => {
      calls += 1;
      if (calls === 2) throw new Error('enqueue failed');
      return real(...a);
    });
    const result = await tidy();
    expect(result).toMatchObject({ ok: false, tidy: true });
    const stamped = (await read(WORKOUT_NOTES_KEY)).map(n => n.updated_at);
    expect((await dirtyNotes()).length).toBeLessThan(4);
    expect((await read(RECOVERY_OPERATION_JOURNAL_KEY)).length).toBe(1);
    expect((await journal.reconcileRecoveryOperations()).ok).toBe(true);
    expect((await read(WORKOUT_NOTES_KEY)).map(n => n.updated_at)).toEqual(stamped);
    expect((await dirtyNotes()).map(r => r.id).sort()).toEqual(['n1', 'n2', 'n3', 'n4']);
    expect((await noteTexts())[1].match(/^-- /gm)).toHaveLength(1);
  });

  test('a stale prior queue entry is never upload intent: enqueue failure then retry leaves the target snapshot, once', async () => {
    const before = (await read(WORKOUT_NOTES_KEY))[1];
    await syncQueue.enqueueDirty(syncQueue.SYNC_TABLES.WORKOUT_NOTES, { ...before, client_id: 'c' });
    const real = syncQueue.enqueueDirty;
    let fail = true;
    jest.spyOn(syncQueue, 'enqueueDirty').mockImplementation(async (...a) => {
      if (fail && a[1].id === 'n2') throw new Error('enqueue failed');
      return real(...a);
    });
    expect(await tidy()).toMatchObject({ ok: false, tidy: true });
    const { loadTidyTextStates } = require('../storage/cloud/recoveryTidyNoteWrites');
    const [state] = await loadTidyTextStates(['n2']);
    expect(state.raw_text).toContain('-- step up from empty bar'); // committed locally
    expect(state.queued).toBe(false); // the stale id-only entry is rejected
    expect((await dirtyNotes()).find(r => r.id === 'n2').raw_text).toBe(before.raw_text);
    fail = false;
    expect((await journal.reconcileRecoveryOperations()).ok).toBe(true);
    const dirty = await dirtyNotes();
    const n2 = (await read(WORKOUT_NOTES_KEY))[1];
    expect(dirty.filter(r => r.id === 'n2')).toHaveLength(1);
    expect(dirty.find(r => r.id === 'n2')).toMatchObject({ raw_text: n2.raw_text, updated_at: n2.updated_at });
    expect(dirty.map(r => r.id).sort()).toEqual(['n1', 'n2', 'n3', 'n4']);
  });

  test('Undo replaces a stale queue entry the same way', async () => {
    expect((await tidy()).ok).toBe(true);
    const tidied = (await read(WORKOUT_NOTES_KEY))[1];
    await syncQueue.enqueueDirty(syncQueue.SYNC_TABLES.WORKOUT_NOTES, { ...tidied, raw_text: 'stale', client_id: 'c' });
    expect((await undoTidyNamesCore(storage(), { blockId: 'rb1' })).ok).toBe(true);
    const n2 = (await read(WORKOUT_NOTES_KEY))[1];
    expect(n2.raw_text).toBe(original[1]);
    expect((await dirtyNotes()).find(r => r.id === 'n2')).toMatchObject({ raw_text: original[1], updated_at: n2.updated_at });
  });

  test('a stale or deleted note rejects the whole batch with no stamp and no queue entry', async () => {
    const notes = await read(WORKOUT_NOTES_KEY);
    notes[3].deleted_at = STAMP;
    const items = notes.slice(0, 4).map((n, i) => ({ id: n.id, source: n.raw_text, target: `${n.raw_text}x${i}` }));
    await AsyncStorage.setItem(WORKOUT_NOTES_KEY, JSON.stringify(notes));
    const { applyTidyNoteTexts } = require('../storage/cloud/recoveryTidyNoteWrites');
    const result = await applyTidyNoteTexts({ items, requestedAt: '2026-07-01T00:00:00Z' });
    expect(result).toMatchObject({ status: 'conflict', written: [] });
    expect(await dirtyNotes()).toEqual([]);
    expect((await read(WORKOUT_NOTES_KEY)).every(n => n.updated_at === STAMP)).toBe(true);
  });
});

describe('PR #1310 review regressions', () => {
  const failingApply = () => {
    let fail = true;
    journal.setRecoveryNoteOperations({
      applyTidyTexts: async (req) => (fail ? { status: 'failed', error: new Error('x'), written: [] } : batch.applyTidyNoteTexts(req)),
      loadTidyTextStates: batch.loadTidyTextStates,
    });
    return () => { fail = false; };
  };

  test('1: a journal-clear failure after Undo is cleanup-only; retry never reports payload_missing', async () => {
    expect((await tidy()).ok).toBe(true);
    const store = require('../storage/entries/recoveryJournalStore');
    const clear = jest.spyOn(store, 'clearRecord').mockRejectedValueOnce(new Error('clear failed'));
    const undone = await undoTidyNamesCore(storage(), { blockId: 'rb1' });
    expect(undone).toMatchObject({ ok: true, code: 'VERIFIED_CLEANUP_PENDING' });
    expect((await read(TIDY_PAYLOAD_KEY)).length).toBe(1); // evidence outlives the intent
    clear.mockRestore();
    const rec = await journal.reconcileRecoveryOperations();
    expect(rec.ok).toBe(true);
    expect(rec.results.every(r => !r.conflict)).toBe(true);
    expect(await read(RECOVERY_OPERATION_JOURNAL_KEY)).toEqual([]);
    expect(await read(TIDY_PAYLOAD_KEY)).toEqual([]);
    expect(await noteTexts()).toEqual(original);
  });

  test('2: a pending tidy blocks note-scoped actions on its target notes only', async () => {
    failingApply();
    await tidy();
    const action = jest.fn().mockResolvedValue({ ok: true });
    const blocked = await journal.runGuardedRecoveryAction({ noteId: 'n1' }, action);
    expect(blocked.ok).toBe(false);
    expect(action).not.toHaveBeenCalled();
    expect((await journal.runGuardedRecoveryAction({ noteId: 'n6' }, action)).ok).toBe(true);
    expect(action).toHaveBeenCalledTimes(1);
  });

  test('3: export waits while a tidy is pending, then succeeds once it is verified', async () => {
    const done = failingApply();
    await tidy();
    await expect(exportBackup()).rejects.toThrow(/Tidy names is still finishing/);
    done();
    expect((await journal.reconcileRecoveryOperations()).ok).toBe(true);
    await expect(exportBackup()).resolves.toBeDefined();
  });

  test('4: a competing frozen baseline with the same names is a conflict, even with no name changes', async () => {
    failingApply();
    await tidy(); // the Squat fixture needs no baseline rename
    const [b] = await read(RECOVERY_BLOCKS_KEY);
    b.baseline.exercises[0].best_e1rm_weight = 999;
    await AsyncStorage.setItem(RECOVERY_BLOCKS_KEY, JSON.stringify([b]));
    journal.setRecoveryNoteOperations({ applyTidyTexts: batch.applyTidyNoteTexts, loadTidyTextStates: batch.loadTidyTextStates });
    const rec = await journal.reconcileRecoveryOperations();
    expect(rec.pending[0]).toMatchObject({ conflict: true });
    expect(rec.pending[0].conflicts[0].reason).toBe('baseline_changed');
    expect(await noteTexts()).toEqual(original);
  });

  test('4b: a removed block is a conflict, not silent success', async () => {
    failingApply();
    await tidy();
    const [b] = await read(RECOVERY_BLOCKS_KEY);
    b.deleted_at = STAMP;
    await AsyncStorage.setItem(RECOVERY_BLOCKS_KEY, JSON.stringify([b]));
    const rec = await journal.reconcileRecoveryOperations();
    expect(rec.pending[0].conflicts[0].reason).toBe('block_missing');
  });

  test('5: a replay completed by an authoritative read refreshes mounted note consumers', async () => {
    const done = failingApply();
    await tidy();
    done();
    const reload = jest.spyOn(noteHooks, 'reloadWorkoutNotes');
    await recoveryReadState.refreshRecoveryState();
    expect(reload).toHaveBeenCalled();
    expect((await noteTexts())[2]).toContain('-- step up');
  });
});

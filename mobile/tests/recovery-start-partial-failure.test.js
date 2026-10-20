// Recovery Week 1 partial-start failure matrix (#1489).
//
// `startRecoveryBlockCore` makes up to three durable writes (the optional new
// Week 1 note, the block, the Week 1 membership) and up to two compensating
// deletes (block, created note). Every one of them can fail on its own, and a
// write can also land and THEN reject (a storage write that persisted before
// its caller saw an error). Each case below injects failures into the real
// jsonStorage write path, then asserts:
//   - the persisted blocks/weeks/notes (read back from storage, never from
//     the previous call's memory),
//   - the returned result (never ok:true for a partial operation),
//   - whether recovery subscribers were notified,
//   - what a fresh retry through the same entry point does afterwards
//     (a "restart": the journal module is reset and nothing from the failed
//     call is reused except durable state).

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as jsonStorage from '../storage/entries/jsonStorage';
import { RECOVERY_BLOCKS_KEY, RECOVERY_BLOCK_WEEKS_KEY } from '../storage/entries/keys';
import {
  addRecoveryWeek,
  createRecoveryBlock,
  deleteRecoveryBlock,
  loadRecoveryBlockWeeks,
  loadRecoveryBlockWeeksRaw,
  loadRecoveryBlocks,
  loadRecoveryBlocksRaw,
  loadRecoveryWeeksForBlock,
} from '../storage/entries/recoveryStorage';
import { RECOVERY_ERROR_CODES, isBlockActive } from '../lib/data/recoveryBlocks';
import { partitionRecoveryRecords } from '../lib/data/activeTrainingContext';
import {
  __resetRecoveryOperationJournal,
  reconcileRecoveryOperations,
} from '../storage/entries/recoveryOperationJournal';
import { notifyRecoveryBlocks } from '../hooks/entries/recoveryReadState';
import { addRecoveryWeekCore, startRecoveryBlockCore } from '../hooks/entries/recoveryMutations';

jest.mock('../hooks/entries/recoveryReadState', () => ({
  ...jest.requireActual('../hooks/entries/recoveryReadState'),
  notifyRecoveryBlocks: jest.fn(),
}));

const storage = {
  loadRecoveryBlocks,
  loadRecoveryWeeksForBlock,
  createRecoveryBlock,
  addRecoveryWeek,
  deleteRecoveryBlock,
};

const BASELINE = { baselineNoteId: 'wn_base', baselineNoteTitle: 'Routine', baselineNoteText: '-Bench\n- 135 5' };

// Script each writeList call per key: 'ok' writes, 'fail' rejects without
// writing, 'land' writes and then rejects. Calls past the script write.
function scriptWrites(script) {
  const original = jsonStorage.writeList;
  const calls = {};
  return jest.spyOn(jsonStorage, 'writeList').mockImplementation(async (key, list, store) => {
    const index = calls[key] || 0;
    calls[key] = index + 1;
    const step = (script[key] || [])[index] || 'ok';
    if (step === 'fail') throw new Error(`Injected ${key} write failure`);
    await original(key, list, store);
    if (step === 'land') throw new Error(`Injected ${key} post-write failure`);
  });
}

// The core re-reads notes after a rejected note delete; back that read with a notebook.
const withNotes = (book) => ({ ...storage, loadWorkoutNotes: async () => book.notes });

// An in-memory notebook standing in for LogScreen's `add`/`remove` wiring.
function makeNotebook(initial = []) {
  const notes = [...initial];
  let seq = 0;
  return {
    notes,
    createWeekNote: jest.fn(async () => {
      const note = { id: `wn_new_${++seq}`, title: 'Recovery Week 1' };
      notes.push(note);
      return note;
    }),
    removeWeekNote: jest.fn(async (id) => {
      const idx = notes.findIndex(n => n.id === id);
      if (idx >= 0) notes.splice(idx, 1);
    }),
  };
}

async function durable() {
  const blocks = await loadRecoveryBlocksRaw();
  const weeks = await loadRecoveryBlockWeeksRaw();
  return {
    blocks,
    weeks,
    activeBlocks: (await loadRecoveryBlocks()).filter(isBlockActive),
    liveWeeks: await loadRecoveryBlockWeeks(),
    unresolved: partitionRecoveryRecords(blocks, weeks).unresolvedCount,
  };
}

// Restart: drop every in-memory journal/lock state; only storage survives.
async function restart() {
  jest.restoreAllMocks();
  notifyRecoveryBlocks.mockClear();
  __resetRecoveryOperationJournal();
  const reconciled = await reconcileRecoveryOperations();
  // Start is not journaled, so reconciliation has nothing to replay for it.
  expect(reconciled.ok).toBe(true);
  expect(reconciled.pending || []).toEqual([]);
}

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetRecoveryOperationJournal();
  notifyRecoveryBlocks.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Recovery Week 1 partial start: note create failures', () => {
  test('note create rejects: typed failure, nothing persisted, retry starts cleanly', async () => {
    const book = makeNotebook();
    book.createWeekNote.mockRejectedValueOnce(new Error('Could not save the note.'));

    const result = await startRecoveryBlockCore(storage, { ...BASELINE, createWeekNote: book.createWeekNote, removeWeekNote: book.removeWeekNote });

    expect(result).toMatchObject({ ok: false });
    expect(result.error).toMatch(/Could not save the note\./);
    expect(result.error).toMatch(/No recovery block was started/);
    expect(book.removeWeekNote).not.toHaveBeenCalled();
    expect((await durable()).blocks).toEqual([]);
    expect(notifyRecoveryBlocks).not.toHaveBeenCalled();

    await restart();
    const retry = await startRecoveryBlockCore(storage, { ...BASELINE, createWeekNote: book.createWeekNote, removeWeekNote: book.removeWeekNote });
    expect(retry.ok).toBe(true);
    const state = await durable();
    expect(state.activeBlocks).toHaveLength(1);
    expect(state.liveWeeks).toEqual([expect.objectContaining({ note_id: 'wn_new_1', week_number: 1 })]);
  });

  test('note create returns no id: refused before any block write', async () => {
    const result = await startRecoveryBlockCore(storage, { ...BASELINE, createWeekNote: async () => null });
    expect(result).toEqual({ ok: false, error: 'Select or create a note for Recovery Week 1.' });
    expect((await durable()).blocks).toEqual([]);
  });
});

describe('Recovery Week 1 partial start: block create failures', () => {
  test('block write fails: the created note is removed, nothing is left, retry succeeds', async () => {
    const book = makeNotebook();
    scriptWrites({ [RECOVERY_BLOCKS_KEY]: ['fail'] });

    const result = await startRecoveryBlockCore(storage, { ...BASELINE, createWeekNote: book.createWeekNote, removeWeekNote: book.removeWeekNote });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Injected/);
    expect(result.keptNoteId).toBeUndefined();
    expect(book.removeWeekNote).toHaveBeenCalledWith('wn_new_1');
    expect(book.notes).toEqual([]);
    expect((await durable()).blocks).toEqual([]);
    expect(notifyRecoveryBlocks).toHaveBeenCalled();

    await restart();
    const retry = await startRecoveryBlockCore(storage, { ...BASELINE, createWeekNote: book.createWeekNote, removeWeekNote: book.removeWeekNote });
    expect(retry.ok).toBe(true);
    expect((await durable()).activeBlocks).toHaveLength(1);
  });

  test('block write fails AND note delete rejects before deleting: the confirmed-present note is reported as kept', async () => {
    const book = makeNotebook();
    book.removeWeekNote.mockRejectedValueOnce(new Error('note delete failed'));
    scriptWrites({ [RECOVERY_BLOCKS_KEY]: ['fail'] });

    const result = await startRecoveryBlockCore(withNotes(book), { ...BASELINE, createWeekNote: book.createWeekNote, removeWeekNote: book.removeWeekNote });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Injected/);
    expect(result.error).toMatch(/new Week 1 note was kept in your notes/);
    expect(result.keptNoteId).toBe('wn_new_1');
    expect(book.notes.map(n => n.id)).toEqual(['wn_new_1']);
    expect((await durable()).blocks).toEqual([]);

    // The kept note is an ordinary unlinked note: a retry may pick it as Week 1.
    await restart();
    const retry = await startRecoveryBlockCore(storage, { ...BASELINE, weekNoteId: 'wn_new_1' });
    expect(retry.ok).toBe(true);
    const state = await durable();
    expect(state.activeBlocks).toHaveLength(1);
    expect(state.liveWeeks).toEqual([expect.objectContaining({ note_id: 'wn_new_1', week_number: 1 })]);
  });

  test('block write fails AND note delete lands then rejects: the gone note is never claimed as kept', async () => {
    const book = makeNotebook();
    const remove = book.removeWeekNote.getMockImplementation();
    book.removeWeekNote.mockImplementationOnce(async (id) => { await remove(id); throw new Error('selection clear failed'); });
    scriptWrites({ [RECOVERY_BLOCKS_KEY]: ['fail'] });

    const result = await startRecoveryBlockCore(withNotes(book), { ...BASELINE, createWeekNote: book.createWeekNote, removeWeekNote: book.removeWeekNote });

    expect(result.ok).toBe(false);
    expect(book.notes).toEqual([]);
    expect(result.keptNoteId).toBeUndefined();
    expect(result.error).not.toMatch(/Week 1 note/);
    expect((await durable()).blocks).toEqual([]);
  });

  test('block write fails, note delete rejects, and the note re-read fails: uncertain wording, no keptNoteId', async () => {
    const book = makeNotebook();
    book.removeWeekNote.mockRejectedValueOnce(new Error('note delete failed'));
    scriptWrites({ [RECOVERY_BLOCKS_KEY]: ['fail'] });
    const unreadable = { ...storage, loadWorkoutNotes: async () => { throw new Error('notes unreadable'); } };

    const result = await startRecoveryBlockCore(unreadable, { ...BASELINE, createWeekNote: book.createWeekNote, removeWeekNote: book.removeWeekNote });

    expect(result.ok).toBe(false);
    expect(result.keptNoteId).toBeUndefined();
    expect(result.error).toMatch(/new Week 1 note may still be in your notes/);
    expect(result.error).not.toMatch(/was kept/);
  });

  test('block write lands then rejects: the stranded active block is reported; retry cannot duplicate it; Add week recovers', async () => {
    const book = makeNotebook();
    scriptWrites({ [RECOVERY_BLOCKS_KEY]: ['land'] });

    const result = await startRecoveryBlockCore(storage, { ...BASELINE, createWeekNote: book.createWeekNote, removeWeekNote: book.removeWeekNote });

    expect(result.ok).toBe(false);
    expect(result.blockMayRemain).toBe(true);
    expect(result.error).toMatch(/may still be active; open Recovery/);
    // No week was ever written for it, so removing the created note is safe.
    expect(book.notes).toEqual([]);
    let state = await durable();
    expect(state.activeBlocks).toHaveLength(1);
    expect(state.liveWeeks).toEqual([]);
    expect(state.unresolved).toBe(0);
    expect(notifyRecoveryBlocks).toHaveBeenCalled();

    await restart();
    const retry = await startRecoveryBlockCore(storage, { ...BASELINE, weekNoteId: 'wn_existing' });
    expect(retry).toMatchObject({ ok: false, code: RECOVERY_ERROR_CODES.ACTIVE_BLOCK_EXISTS });
    expect((await durable()).activeBlocks).toHaveLength(1);

    // Existing recovery path: the Recovery tab offers Add week for an active
    // block with no current week, which attaches Week 1.
    const blockId = state.activeBlocks[0].id;
    const added = await addRecoveryWeekCore(storage, { blockId, noteId: 'wn_existing' });
    expect(added.ok).toBe(true);
    state = await durable();
    expect(state.activeBlocks).toHaveLength(1);
    expect(state.liveWeeks).toEqual([expect.objectContaining({ block_id: blockId, note_id: 'wn_existing', week_number: 1 })]);
  });

  test('a pre-existing active block is not reported as stranded by this call', async () => {
    await createRecoveryBlock({ baselineNoteId: 'wn_other' });
    const result = await startRecoveryBlockCore(storage, { ...BASELINE, weekNoteId: 'wn_existing' });
    expect(result).toMatchObject({ ok: false, code: RECOVERY_ERROR_CODES.ACTIVE_BLOCK_EXISTS });
    expect(result.blockMayRemain).toBeUndefined();
    expect(result.error).not.toMatch(/open Recovery/);
  });
});

describe('Recovery Week 1 partial start: Week 1 attach failures', () => {
  test.each([['existing note', false], ['new note', true]])('week write fails (%s): block tombstoned, pre-existing note never deleted, retry succeeds', async (_label, isNew) => {
    const book = makeNotebook([{ id: 'wn_existing' }]);
    scriptWrites({ [RECOVERY_BLOCK_WEEKS_KEY]: ['fail'] });
    const args = isNew
      ? { createWeekNote: book.createWeekNote, removeWeekNote: book.removeWeekNote }
      : { weekNoteId: 'wn_existing', removeWeekNote: book.removeWeekNote };

    const result = await startRecoveryBlockCore(storage, { ...BASELINE, ...args });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Injected/);
    expect(result.blockMayRemain).toBeUndefined();
    const state = await durable();
    expect(state.activeBlocks).toEqual([]);
    expect(state.blocks).toHaveLength(1);
    expect(state.blocks[0].deleted_at).toBeTruthy();
    expect(state.liveWeeks).toEqual([]);
    expect(book.notes.map(n => n.id)).toEqual(['wn_existing']);
    if (!isNew) expect(book.removeWeekNote).not.toHaveBeenCalled();
    expect(notifyRecoveryBlocks).toHaveBeenCalled();

    await restart();
    const retry = await startRecoveryBlockCore(storage, { ...BASELINE, weekNoteId: 'wn_existing' });
    expect(retry.ok).toBe(true);
    const after = await durable();
    expect(after.activeBlocks).toHaveLength(1);
    expect(after.liveWeeks).toEqual([expect.objectContaining({ note_id: 'wn_existing', week_number: 1 })]);
  });

  test('week write lands then rejects, block delete succeeds: the cascade leaves no live membership; retry reuses the note once', async () => {
    scriptWrites({ [RECOVERY_BLOCK_WEEKS_KEY]: ['land'] });

    const result = await startRecoveryBlockCore(storage, { ...BASELINE, weekNoteId: 'wn_existing' });

    expect(result.ok).toBe(false);
    let state = await durable();
    expect(state.activeBlocks).toEqual([]);
    expect(state.liveWeeks).toEqual([]);

    await restart();
    expect((await startRecoveryBlockCore(storage, { ...BASELINE, weekNoteId: 'wn_existing' })).ok).toBe(true);
    state = await durable();
    expect(state.activeBlocks).toHaveLength(1);
    expect(state.liveWeeks.filter(w => w.note_id === 'wn_existing')).toHaveLength(1);
  });

  test('week write fails AND block delete fails: stranded block reported, new note kept for Week 1, Add week recovers', async () => {
    const book = makeNotebook();
    scriptWrites({ [RECOVERY_BLOCKS_KEY]: ['ok', 'fail'], [RECOVERY_BLOCK_WEEKS_KEY]: ['fail'] });

    const result = await startRecoveryBlockCore(storage, { ...BASELINE, createWeekNote: book.createWeekNote, removeWeekNote: book.removeWeekNote });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/^Injected kilo_recovery_block_weeks write failure/);
    expect(result.blockMayRemain).toBe(true);
    expect(result.keptNoteId).toBe('wn_new_1');
    expect(result.error).toMatch(/new Week 1 note was kept in your notes/);
    expect(book.removeWeekNote).not.toHaveBeenCalled();
    let state = await durable();
    expect(state.activeBlocks).toHaveLength(1);
    expect(state.liveWeeks).toEqual([]);

    await restart();
    expect((await startRecoveryBlockCore(storage, { ...BASELINE, weekNoteId: 'wn_new_1' })))
      .toMatchObject({ ok: false, code: RECOVERY_ERROR_CODES.ACTIVE_BLOCK_EXISTS });
    const added = await addRecoveryWeekCore(storage, { blockId: state.activeBlocks[0].id, noteId: 'wn_new_1' });
    expect(added.ok).toBe(true);
    state = await durable();
    expect(state.activeBlocks).toHaveLength(1);
    expect(state.liveWeeks).toEqual([expect.objectContaining({ note_id: 'wn_new_1', week_number: 1 })]);
  });

  test('week write lands then rejects AND block delete fails: the still-linked new note is never deleted', async () => {
    const book = makeNotebook();
    scriptWrites({ [RECOVERY_BLOCKS_KEY]: ['ok', 'fail'], [RECOVERY_BLOCK_WEEKS_KEY]: ['land'] });

    const result = await startRecoveryBlockCore(storage, { ...BASELINE, createWeekNote: book.createWeekNote, removeWeekNote: book.removeWeekNote });

    // Durable state is a full block + Week 1, but the call cannot know that,
    // so it reports failure with the stranded-block guidance, never success.
    expect(result.ok).toBe(false);
    expect(result.blockMayRemain).toBe(true);
    expect(book.removeWeekNote).not.toHaveBeenCalled();
    expect(book.notes.map(n => n.id)).toEqual(['wn_new_1']);
    const state = await durable();
    expect(state.activeBlocks).toHaveLength(1);
    expect(state.liveWeeks).toEqual([expect.objectContaining({ note_id: 'wn_new_1', week_number: 1 })]);
    expect(state.unresolved).toBe(0);

    await restart();
    expect(await startRecoveryBlockCore(storage, { ...BASELINE, weekNoteId: 'wn_other' }))
      .toMatchObject({ ok: false, code: RECOVERY_ERROR_CODES.ACTIVE_BLOCK_EXISTS });
    const after = await durable();
    expect(after.activeBlocks).toHaveLength(1);
    expect(after.liveWeeks).toHaveLength(1);
  });

  test('week write lands, block tombstone lands but its week cascade fails: the note is kept and reconciliation retires the orphan membership', async () => {
    const book = makeNotebook();
    scriptWrites({ [RECOVERY_BLOCKS_KEY]: ['ok', 'ok'], [RECOVERY_BLOCK_WEEKS_KEY]: ['land', 'fail'] });

    const result = await startRecoveryBlockCore(storage, { ...BASELINE, createWeekNote: book.createWeekNote, removeWeekNote: book.removeWeekNote });

    expect(result.ok).toBe(false);
    expect(result.keptNoteId).toBe('wn_new_1');
    expect(book.removeWeekNote).not.toHaveBeenCalled();
    const state = await durable();
    expect(state.activeBlocks).toEqual([]);
    // A live membership under a tombstoned block: the shared classifier
    // excludes it as unresolved (it does not count as Week 1 of anything).
    expect(state.unresolved).toBe(1);

    // Restart: existing reconciliation tombstones the orphan, so the kept note
    // can be Week 1 again with exactly one live membership.
    await restart();
    expect((await durable()).unresolved).toBe(0);
    expect((await startRecoveryBlockCore(storage, { ...BASELINE, weekNoteId: 'wn_new_1' })).ok).toBe(true);
    const after = await durable();
    expect(after.activeBlocks).toHaveLength(1);
    expect(after.unresolved).toBe(0);
    expect(after.liveWeeks).toEqual([expect.objectContaining({ block_id: after.activeBlocks[0].id, note_id: 'wn_new_1', week_number: 1 })]);
  });
});

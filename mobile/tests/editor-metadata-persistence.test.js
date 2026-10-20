import React, { useState } from 'react';
import renderer, { act } from 'react-test-renderer';

import { useLogOtherRoutineEditor } from '../screens/log/useLogOtherRoutineEditor';
import { DELOAD_NOTE_PREFIX, AUTOSAVE_DEBOUNCE_MS } from '../lib/LogScreenHelpers';

// #1500: other-routine metadata (A/B activeWeek, linked-deload date/ordinal) is
// part of what a save persists, so a metadata-only edit must schedule the
// autosave and invalidate any `Saved on device` claim, and status must stay
// bound to the payload actually in flight / made durable.

const AB_RAW = 'MONDAY — Push\n-Bench 3x8\n---\nMONDAY — Home\n-Floor Press 3x8\n';

let mounted = [];

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// A stateful store: successful writes flow back into `notes`/`deloadHistory`,
// as useWorkoutNotes/useDeloadHistory do, so canonical comparisons are real.
function mountEditor({ notes: initialNotes, deloadHistory: initialHistory = [], updateImpl, updateDeloadImpl }) {
  const ref = { current: null };
  const update = jest.fn(async (id, patch) => {
    const ok = updateImpl ? await updateImpl(id, patch) : true;
    if (!ok) return ok;
    let next = null;
    act(() => {
      ref.setNotes((ns) => ns.map((n) => {
        if (n.id !== id) return n;
        next = { ...n, ...patch };
        return next;
      }));
    });
    return next ?? { id, ...patch };
  });
  const updateDeload = jest.fn(async (id, patch) => {
    if (updateDeloadImpl) await updateDeloadImpl(id, patch);
    act(() => {
      ref.setHistory((hs) => hs.map((h) => (h.id === id ? { ...h, ...patch } : h)));
    });
    return true;
  });
  function Probe() {
    const [notes, setNotes] = useState(initialNotes);
    const [deloadHistory, setHistory] = useState(initialHistory);
    ref.setNotes = setNotes;
    ref.setHistory = setHistory;
    ref.notes = notes;
    ref.history = deloadHistory;
    ref.current = useLogOtherRoutineEditor({
      notes,
      currentId: 'current',
      currentNote: { id: 'current', title: 'C', raw_text: 'x' },
      deloadHistory,
      update,
      add: jest.fn(),
      remove: jest.fn(),
      selectCurrent: jest.fn(),
      updateDeload,
      deleteDeloadNote: jest.fn(),
      autosaveCurrentTimerRef: { current: null },
      handleSave: jest.fn(),
      currentEditorMode: 'read',
      hasUnsavedCurrent: false,
      editorScrollRef: { current: { scrollTo: jest.fn() } },
    });
    return null;
  }
  let tree;
  act(() => { tree = renderer.create(React.createElement(Probe)); });
  mounted.push(tree);
  return { ref, update, updateDeload };
}

async function flush(times = 4) {
  for (let i = 0; i < times; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  }
}

async function fireAutosave() {
  await act(async () => { jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 10); });
  await flush();
}

const deloadNote = () => ({
  id: 'd1',
  title: `${DELOAD_NOTE_PREFIX}2026-01-01`,
  raw_text: 'body',
  saved_at: '2026-01-01T12:00:00.000Z',
});
const linkedRecord = () => ({
  id: 'h1', note_id: 'd1', deload_session_ordinal: 3, completed_at: '2026-01-01T12:00:00.000Z',
});

beforeEach(() => {
  jest.useFakeTimers();
  mounted = [];
});
afterEach(() => {
  mounted.forEach((tree) => act(() => tree.unmount()));
  mounted = [];
  jest.useRealTimers();
});

describe('metadata-only edits schedule the autosave (#1500)', () => {
  test('a linked-deload ordinal change alone autosaves the ordinal', async () => {
    const { ref, updateDeload } = mountEditor({ notes: [deloadNote()], deloadHistory: [linkedRecord()] });
    act(() => { ref.current.handleOpenOtherNote(ref.notes[0]); });
    act(() => { ref.current.setDeloadEditOrdinal('5'); });
    expect(ref.current.hasUnsavedOther).toBe(true);

    await fireAutosave();

    expect(updateDeload).toHaveBeenCalledWith('h1', { deload_session_ordinal: 5 });
    expect(ref.history[0].deload_session_ordinal).toBe(5);
    expect(ref.current.hasUnsavedOther).toBe(false);
  });

  test('a linked-deload date change alone autosaves completed_at and saved_at', async () => {
    const { ref, update, updateDeload } = mountEditor({ notes: [deloadNote()], deloadHistory: [linkedRecord()] });
    act(() => { ref.current.handleOpenOtherNote(ref.notes[0]); });
    act(() => { ref.current.setDeloadEditDate('2026-01-05'); });

    await fireAutosave();

    expect(updateDeload).toHaveBeenCalledWith('h1', { completed_at: '2026-01-05T12:00:00.000Z' });
    expect(update).toHaveBeenCalledWith('d1', expect.objectContaining({ saved_at: '2026-01-05T12:00:00.000Z' }));
    expect(ref.current.hasUnsavedOther).toBe(false);
  });

  test('toggling the editing week of an A/B note alone autosaves activeWeek', async () => {
    const note = { id: 'r1', title: 'R', raw_text: AB_RAW, activeWeek: 'A' };
    const { ref, update } = mountEditor({ notes: [note] });
    act(() => { ref.current.handleOpenOtherNote(ref.notes[0]); });
    expect(ref.current.hasUnsavedOther).toBe(false);
    act(() => { ref.current.handleToggleEditingWeek(); });
    expect(ref.current.hasUnsavedOther).toBe(true);

    await fireAutosave();

    expect(update).toHaveBeenCalledWith('r1', expect.objectContaining({ activeWeek: 'B', raw_text: AB_RAW }));
    expect(ref.notes[0].activeWeek).toBe('B');
    expect(ref.current.hasUnsavedOther).toBe(false);
  });

  test('opening a legacy A/B note with no persisted week does not write', async () => {
    const note = { id: 'r1', title: 'R', raw_text: AB_RAW };
    const { ref, update } = mountEditor({ notes: [note] });
    act(() => { ref.current.handleOpenOtherNote(ref.notes[0]); });
    expect(ref.current.hasUnsavedOther).toBe(false);
    await fireAutosave();
    expect(update).not.toHaveBeenCalled();
  });

  test('an invalid or empty ordinal neither writes nor loops, and Done still closes', async () => {
    const { ref, update, updateDeload } = mountEditor({ notes: [deloadNote()], deloadHistory: [linkedRecord()] });
    act(() => { ref.current.handleOpenOtherNote(ref.notes[0]); });
    act(() => { ref.current.setDeloadEditOrdinal(''); });
    await fireAutosave();
    await fireAutosave();
    expect(update).not.toHaveBeenCalled();
    expect(updateDeload).not.toHaveBeenCalled();
    expect(ref.current.saveStatus).toBe(null);

    // Existing validation policy: Done saves without writing the ordinal and closes.
    await act(async () => { await ref.current.handleDoneOther(); });
    expect(updateDeload).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    expect(ref.current.editingNoteId).toBe(null);
  });

  test('an unlinked deload note ignores date/ordinal edits (no write, no dirty state)', async () => {
    const { ref, update, updateDeload } = mountEditor({ notes: [deloadNote()], deloadHistory: [] });
    act(() => { ref.current.handleOpenOtherNote(ref.notes[0]); });
    act(() => { ref.current.setDeloadEditOrdinal('7'); });
    act(() => { ref.current.setDeloadEditDate('2026-01-09'); });
    expect(ref.current.hasUnsavedOther).toBe(false);
    await fireAutosave();
    expect(update).not.toHaveBeenCalled();
    expect(updateDeload).not.toHaveBeenCalled();
  });
});

describe('saved status is bound to persisted metadata (#1500)', () => {
  test('a metadata-only edit removes a durable `Saved on device` claim immediately', async () => {
    const { ref } = mountEditor({ notes: [deloadNote()], deloadHistory: [linkedRecord()] });
    act(() => { ref.current.handleOpenOtherNote(ref.notes[0]); });
    act(() => { ref.current.setEditingText('body2'); });
    await act(async () => { await ref.current.handleSaveOtherNote(); });
    expect(ref.current.saveStatus).toBe('saved');
    expect(ref.current.saveSuccess).toBe('Saved on device');

    act(() => { ref.current.setDeloadEditOrdinal('4'); });
    expect(ref.current.saveStatus).toBe(null);
    expect(ref.current.saveSuccess).toBe('');
  });

  test('toggling the A/B week after a save removes the saved claim', async () => {
    const note = { id: 'r1', title: 'R', raw_text: AB_RAW, activeWeek: 'A' };
    const { ref } = mountEditor({ notes: [note] });
    act(() => { ref.current.handleOpenOtherNote(ref.notes[0]); });
    act(() => { ref.current.setEditingTitle('R2'); });
    await act(async () => { await ref.current.handleSaveOtherNote(); });
    expect(ref.current.saveStatus).toBe('saved');
    act(() => { ref.current.handleToggleEditingWeek(); });
    expect(ref.current.saveStatus).toBe(null);
  });

  test('metadata changed during a deferred save is never claimed by that save', async () => {
    const gate = deferred();
    let calls = 0;
    const { ref, updateDeload } = mountEditor({
      notes: [deloadNote()],
      deloadHistory: [linkedRecord()],
      updateImpl: async () => { calls += 1; if (calls === 1) await gate.promise; return true; },
    });
    act(() => { ref.current.handleOpenOtherNote(ref.notes[0]); });
    act(() => { ref.current.setDeloadEditOrdinal('4'); });

    let savePromise;
    act(() => { savePromise = ref.current.handleSaveOtherNote(); });
    await flush();
    expect(ref.current.saveStatus).toBe('saving');

    // Change metadata again while the ordinal-4 payload is in flight.
    act(() => { ref.current.setDeloadEditOrdinal('6'); });
    expect(ref.current.saveStatus).toBe(null);

    await act(async () => { gate.resolve(); await savePromise; });
    await flush();
    expect(updateDeload).toHaveBeenLastCalledWith('h1', { deload_session_ordinal: 4 });
    expect(ref.current.saveStatus).toBe(null);
    expect(ref.current.saveSuccess).toBe('');
    expect(ref.current.hasUnsavedOther).toBe(true);

    // Restoring the in-flight value makes the durable claim true again.
    act(() => { ref.current.setDeloadEditOrdinal('4'); });
    expect(ref.current.saveStatus).toBe('saved');
  });

  test('a rejected metadata save keeps retryable state; a retry persists it and shows saved', async () => {
    let fail = true;
    const { ref, update, updateDeload } = mountEditor({
      notes: [deloadNote()],
      deloadHistory: [linkedRecord()],
      updateDeloadImpl: async () => { if (fail) throw new Error('offline'); },
    });
    act(() => { ref.current.handleOpenOtherNote(ref.notes[0]); });
    act(() => { ref.current.setDeloadEditOrdinal('8'); });

    let ok;
    await act(async () => { ok = await ref.current.handleSaveOtherNote(); });
    expect(ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(ref.current.saveError).toBe('Save failed');
    expect(ref.current.saveStatus).toBe(null);
    expect(ref.current.hasUnsavedOther).toBe(true);
    expect(ref.current.deloadEditOrdinal).toBe('8');

    fail = false;
    await act(async () => { ok = await ref.current.handleSaveOtherNote(); });
    expect(ok).toBe(true);
    expect(updateDeload).toHaveBeenLastCalledWith('h1', { deload_session_ordinal: 8 });
    expect(ref.history[0].deload_session_ordinal).toBe(8);
    expect(ref.current.saveError).toBe('');
    expect(ref.current.saveStatus).toBe('saved');
    expect(ref.current.hasUnsavedOther).toBe(false);
  });

  test('a partial failure (history written, note rejected) never claims the date saved', async () => {
    let failNote = true;
    const { ref, update } = mountEditor({
      notes: [deloadNote()],
      deloadHistory: [linkedRecord()],
      updateImpl: async () => !failNote,
    });
    act(() => { ref.current.handleOpenOtherNote(ref.notes[0]); });
    act(() => { ref.current.setDeloadEditDate('2026-01-07'); });

    await act(async () => { await ref.current.handleSaveOtherNote(); });
    expect(ref.history[0].completed_at).toBe('2026-01-07T12:00:00.000Z');
    expect(ref.notes[0].saved_at).toBe('2026-01-01T12:00:00.000Z');
    expect(ref.current.saveError).toBe('Save failed');
    expect(ref.current.saveStatus).toBe(null);
    expect(ref.current.hasUnsavedOther).toBe(true);

    failNote = false;
    await act(async () => { await ref.current.handleSaveOtherNote(); });
    expect(update).toHaveBeenLastCalledWith('d1', expect.objectContaining({ saved_at: '2026-01-07T12:00:00.000Z' }));
    expect(ref.current.saveStatus).toBe('saved');
  });
});

describe('a debounce that expires during an older save is not dropped (#1500)', () => {
  test('ordinal changed and debounced while the previous autosave is in flight is persisted after it settles', async () => {
    const gate = deferred();
    let calls = 0;
    const { ref, update, updateDeload } = mountEditor({
      notes: [deloadNote()],
      deloadHistory: [linkedRecord()],
      updateImpl: async () => { calls += 1; if (calls === 1) await gate.promise; return true; },
    });
    act(() => { ref.current.handleOpenOtherNote(ref.notes[0]); });
    act(() => { ref.current.setDeloadEditOrdinal('4'); });
    await fireAutosave(); // ordinal-4 autosave starts; its note update is held
    expect(updateDeload).toHaveBeenLastCalledWith('h1', { deload_session_ordinal: 4 });

    act(() => { ref.current.setDeloadEditOrdinal('6'); });
    await fireAutosave(); // this debounce expires while the ordinal-4 save is in flight
    expect(updateDeload).toHaveBeenCalledTimes(1);

    await act(async () => { gate.resolve(); });
    await flush();
    await fireAutosave();

    expect(updateDeload).toHaveBeenLastCalledWith('h1', { deload_session_ordinal: 6 });
    expect(ref.history[0].deload_session_ordinal).toBe(6);
    expect(update).toHaveBeenCalledTimes(2);
    expect(ref.current.hasUnsavedOther).toBe(false);
  });

  test('a failed in-flight save is not auto-retried, and a failing write never loops', async () => {
    const gate = deferred();
    const { ref, update, updateDeload } = mountEditor({
      notes: [deloadNote()],
      deloadHistory: [linkedRecord()],
      updateImpl: async () => { await gate.promise; return false; },
    });
    act(() => { ref.current.handleOpenOtherNote(ref.notes[0]); });
    act(() => { ref.current.setDeloadEditOrdinal('4'); });
    await fireAutosave();
    act(() => { ref.current.setDeloadEditOrdinal('6'); });
    await fireAutosave(); // coalesces onto the in-flight (failing) save

    await act(async () => { gate.resolve(); });
    await flush();
    for (let i = 0; i < 4; i++) {
      // eslint-disable-next-line no-await-in-loop
      await fireAutosave();
    }

    expect(update).toHaveBeenCalledTimes(1);
    expect(updateDeload).toHaveBeenCalledTimes(1);
    expect(ref.current.saveError).toBe('Save failed');
    expect(ref.current.saveStatus).toBe(null);
    expect(ref.current.hasUnsavedOther).toBe(true);
  });

  test('no follow-up save runs once the editor has left the note', async () => {
    const gate = deferred();
    let calls = 0;
    const { ref, update } = mountEditor({
      notes: [deloadNote()],
      deloadHistory: [linkedRecord()],
      updateImpl: async () => { calls += 1; if (calls === 1) await gate.promise; return true; },
    });
    act(() => { ref.current.handleOpenOtherNote(ref.notes[0]); });
    act(() => { ref.current.setDeloadEditOrdinal('4'); });
    await fireAutosave();
    act(() => { ref.current.setDeloadEditOrdinal('6'); });
    await act(async () => { jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 10); });
    // Leave the editor before the in-flight save settles.
    act(() => { ref.current.setEditingNoteId(null); });
    await act(async () => { gate.resolve(); });
    await flush();
    await fireAutosave();
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe('Done converges on metadata edited after Done is pressed (#1500)', () => {
  test('an ordinal changed while Done awaits an in-flight save is persisted and Done closes', async () => {
    const gate = deferred();
    let calls = 0;
    const { ref, updateDeload } = mountEditor({
      notes: [deloadNote()],
      deloadHistory: [linkedRecord()],
      updateImpl: async () => { calls += 1; if (calls === 1) await gate.promise; return true; },
    });
    act(() => { ref.current.handleOpenOtherNote(ref.notes[0]); });
    act(() => { ref.current.setEditingText('body2'); });

    let donePromise;
    act(() => { donePromise = ref.current.handleDoneOther(); });
    await flush();
    // Done's save closure is now from an older render; the edit lands after it.
    act(() => { ref.current.setDeloadEditOrdinal('9'); });

    await act(async () => { gate.resolve(); await donePromise; });
    await flush();

    expect(updateDeload).toHaveBeenLastCalledWith('h1', { deload_session_ordinal: 9 });
    expect(ref.history[0].deload_session_ordinal).toBe(9);
    expect(ref.current.editingNoteId).toBe(null);
  });
});

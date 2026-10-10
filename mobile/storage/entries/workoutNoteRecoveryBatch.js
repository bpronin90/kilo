// Local-mode, all-or-nothing note text batch for Tidy names (#1309).
//
// The existing normalization batch (#1172) skips a stale item and writes the
// rest. Tidy names must not: every targeted note is validated first, and any
// missing, deleted or edited note rejects the whole batch with zero writes. One
// notebook lock covers the validation and the single notebook write, and the
// write reuses the journal's immutable requested timestamp so a replay is
// timestamp-stable. Unrelated note metadata is untouched (spread, not rebuilt).

import { withWorkoutNotebookLock, loadWorkoutNotesRaw, replaceWorkoutNotesRaw } from './workoutNotes';

// Per-item classification shared by the local and cloud implementations.
// `source` is the text the note must hold to be written; `target` is the text it
// holds once done. Anything else is a concurrent edit.
export function classifyTidyItems(list, items, isLive) {
  const byId = new Map(list.filter(n => n && n.id).map(n => [n.id, n]));
  return items.map((item) => {
    const note = byId.get(item.id);
    if (!note || !isLive(note)) return { id: item.id, state: 'conflict', reason: note ? 'deleted' : 'missing' };
    if (note.raw_text === item.target) return { id: item.id, state: 'done' };
    if (note.raw_text === item.source) return { id: item.id, state: 'todo' };
    return { id: item.id, state: 'conflict', reason: 'edited' };
  });
}

// Persisted per-id state for verification reads (local mode has no queue).
export async function loadTidyTextStates(ids) {
  const list = await loadWorkoutNotesRaw();
  const byId = new Map(list.map(n => [n && n.id, n]));
  return ids.map((id) => {
    const note = byId.get(id);
    return {
      id, exists: !!note, deleted: !note || !!note.deleted_at, raw_text: note ? note.raw_text : null,
      requiresQueue: false, queued: false,
    };
  });
}

// items: [{ id, source, target }]. Returns { status: 'ok' | 'conflict' | 'failed', ... }.
export function applyTidyNoteTexts({ items, requestedAt }) {
  return withWorkoutNotebookLock(async () => {
    const list = await loadWorkoutNotesRaw();
    const states = classifyTidyItems(list, items, n => !n.deleted_at);
    const conflicts = states.filter(s => s.state === 'conflict');
    if (conflicts.length) return { status: 'conflict', conflicts, written: [] };
    const targets = new Map(items.filter((_i, k) => states[k].state === 'todo').map(i => [i.id, i.target]));
    if (targets.size === 0) return { status: 'ok', written: [] };
    try {
      await replaceWorkoutNotesRaw(list.map(n => (n && targets.has(n.id) ? { ...n, raw_text: targets.get(n.id), updated_at: requestedAt } : n)));
    } catch (error) {
      return { status: 'failed', error, written: [] };
    }
    return { status: 'ok', written: [...targets.keys()] };
  });
}

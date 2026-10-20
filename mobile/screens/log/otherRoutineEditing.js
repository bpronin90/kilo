import { useMemo, useRef } from 'react';
import { parseWorkoutNote } from '../../lib/parser';
import { deriveSessionAlignmentIssue } from '../../lib/parser/sessions.js';
import { sliceWeekText, spliceWeekText, isValidActiveWeek } from './editorWeekText';
import { metadataMatches } from './editorConvergence';
import { newRoutineTitleConverged } from './useLogEditorSave';

// The other-routine editor's A/B projection onto the note currently open in the
// editor, extracted from useLogOtherRoutineEditor (#1055). Mirrors the
// current-routine editor's workoutNoteText/activeEditText split: hasABWeeks and
// the effective week are derived from the full underlying text (both halves),
// and editingText is the selected week's body only (what LogScreenEditorCard
// binds its input to). State lives in the calling hook and is passed in, so no
// module-level editor state is held.
export function useOtherEditingProjection({
  editingFullText,
  editingActiveWeek,
  setEditingFullText,
  setEditingActiveWeek,
  cancelPendingDraftRestore,
}) {
  const editingParsed = useMemo(() => parseWorkoutNote(editingFullText), [editingFullText]);
  const editingHasABWeeks = (editingParsed.weekBStartIndex ?? null) !== null;
  const editingEffectiveWeek = editingHasABWeeks ? (editingActiveWeek ?? 'A') : null;

  const editingText = useMemo(
    () => (editingHasABWeeks ? sliceWeekText(editingFullText, editingEffectiveWeek) : editingFullText),
    [editingFullText, editingHasABWeeks, editingEffectiveWeek]
  );

  // Non-current and Recovery editors share this hook. Derive against the visible
  // A/B half so the inline Recovery Save and the full-screen Done path enforce
  // the same positional-session contract.
  const sessionAlignmentIssue = useMemo(
    () => deriveSessionAlignmentIssue(editingText),
    [editingText]
  );

  // Setter bound to the editor input: splices the edited half back into the full
  // underlying text, preserving the other week and the separator.
  const setEditingText = (newActiveText) => {
    cancelPendingDraftRestore();
    if (!editingHasABWeeks) {
      setEditingFullText(newActiveText);
      return;
    }
    setEditingFullText(spliceWeekText(editingFullText, editingEffectiveWeek, newActiveText));
  };

  const handleToggleEditingWeek = () => {
    if (!editingHasABWeeks) return;
    setEditingActiveWeek(prev => ((prev ?? 'A') === 'B' ? 'A' : 'B'));
  };

  // Explicit boundary-removal action: merges Week A and Week B back into a
  // single-week note (Week A body, a single blank-line join, then Week B body,
  // so no text is lost and nothing is reordered). editingHasABWeeks recomputes
  // to false on the next render, the Week toggle disappears, and
  // editingActiveWeek is cleared so a stale selection can't leak into a future
  // save. The persisted activeWeek field is reconciled by handleSaveOtherNote.
  const handleMergeEditingWeeks = () => {
    if (!editingHasABWeeks) return;
    const weekAText = sliceWeekText(editingFullText, 'A');
    const weekBText = sliceWeekText(editingFullText, 'B');
    setEditingFullText(weekAText + '\n\n' + weekBText);
    setEditingActiveWeek(null);
  };

  return {
    editingParsed,
    editingHasABWeeks,
    editingEffectiveWeek,
    editingText,
    sessionAlignmentIssue,
    setEditingText,
    handleToggleEditingWeek,
    handleMergeEditingWeeks,
  };
}

// #1500 field matrix: besides title/raw_text, handleSaveOtherNote persists the
// A/B activeWeek (A/B notes only) and, for a deload note with a linked history
// record, the note date (saved_at), the history date (completed_at, a separate
// write that can succeed while the note write fails), and the history session
// ordinal. A field the save never writes for this note is null.
export function otherMetadata({ hasABWeeks, week, linked, date, historyDate, ordinal }) {
  return {
    activeWeek: hasABWeeks ? week : null,
    deloadDate: linked ? date : null,
    deloadHistoryDate: linked ? historyDate : null,
    deloadOrdinal: linked ? ordinal : null,
  };
}

// The note and history dates as the linked deload note was opened, captured
// once per editing session (the history record may arrive a render later).
export function useOpenDeloadDates(noteId, note, record) {
  const ref = useRef({ noteId: null });
  if (ref.current.noteId !== noteId) ref.current = { noteId, noteDate: undefined, historyDate: undefined };
  if (ref.current.noteDate === undefined && note) ref.current.noteDate = note.saved_at?.slice(0, 10) ?? '';
  if (ref.current.historyDate === undefined && record) {
    ref.current.historyDate = record.completed_at?.slice(0, 10) ?? '';
  }
  return ref.current;
}

// The history date the live editor intends. Untouched (or cleared): whatever
// is stored, so opening never writes. Touched: the picked date, except that
// restoring the opened note date means "as opened" — the opened history date —
// which also repairs a history write left behind by a failed note write.
export function liveOtherMetadata({
  hasABWeeks, week, record, date, dateTouched, ordinal, open, canonical,
}) {
  const storedHistoryDate = canonical?.deloadHistoryDate ?? null;
  let historyDate = storedHistoryDate;
  if (dateTouched && date) {
    historyDate = date === open?.noteDate && open?.historyDate !== undefined ? open.historyDate : date;
  }
  return otherMetadata({ hasABWeeks, week, linked: !!record, date, historyDate, ordinal });
}

// The canonical note/history record in the same shape. A missing or invalid
// persisted week opens as Week A, so it is normalized the same way here.
export function canonicalOtherMetadata({ note, hasABWeeks, record }) {
  if (!note) return null;
  return otherMetadata({
    hasABWeeks,
    week: isValidActiveWeek(note.activeWeek) ? note.activeWeek : 'A',
    linked: !!record,
    date: note.saved_at?.slice(0, 10) ?? '',
    historyDate: record?.completed_at?.slice(0, 10) ?? '',
    ordinal: record?.deload_session_ordinal != null ? String(record.deload_session_ordinal) : '',
  });
}

const parsesOrdinal = (value) => !isNaN(parseInt(value, 10));

// Whether the live metadata holds a change the save would actually write. The
// save ignores a cleared date and an unparseable ordinal (existing validation
// policy), so such a value alone must not schedule an autosave.
export function hasPersistableMetadataChange(live, canonical) {
  if (!live || !canonical) return false;
  if (live.activeWeek !== canonical.activeWeek) return true;
  if (live.deloadDate && live.deloadDate !== canonical.deloadDate) return true;
  if (live.deloadHistoryDate && live.deloadHistoryDate !== canonical.deloadHistoryDate) return true;
  return parsesOrdinal(live.deloadOrdinal)
    && String(parseInt(live.deloadOrdinal, 10)) !== canonical.deloadOrdinal;
}

// What a successful save made durable: the submitted metadata, except a note
// date the save did not write (never touched, or cleared) or an unparseable
// ordinal, which stay at their canonical value so status never claims them
// saved. The submitted history date is written whenever it differs.
export function persistedOtherMetadata(submitted, canonical, dateTouched) {
  return {
    activeWeek: submitted.activeWeek,
    deloadDate: dateTouched && submitted.deloadDate ? submitted.deloadDate : (canonical?.deloadDate ?? null),
    deloadHistoryDate: submitted.deloadHistoryDate,
    deloadOrdinal: parsesOrdinal(submitted.deloadOrdinal)
      ? submitted.deloadOrdinal
      : (canonical?.deloadOrdinal ?? null),
  };
}

// The debounced autosave body (#1500). A debounce that expires while an older
// save is in flight coalesces onto it and would otherwise drop the newer edit,
// so once that save SUCCEEDS, run exactly one fresh save (which reads live
// inputs) if the same note/source is still open with a persistable change. A
// failed save is never retried here: status stays unsaved until the next edit
// or Done, so a failing write cannot loop.
export async function runOtherAutosave({ save, inFlightRef, identity, isStillPersistable }) {
  const coalesced = !!inFlightRef.current;
  const scheduledIdentity = identity();
  const ok = await save();
  if (!coalesced || !ok) return ok;
  if (identity() !== scheduledIdentity || !isStillPersistable()) return ok;
  return save();
}

// Done's convergence test (#1500): the live editor matches what the last save
// SUBMITTED for every persisted field — text, title (a new routine's blank
// title saves as 'Untitled Routine'), and otherMetadata. Submitted rather than
// durable metadata, so an unparseable ordinal the save ignores still converges.
export function otherDoneConverged({
  isNew, liveText, liveTitle, liveMetadata, savedText, savedTitle, savedMetadata,
}) {
  const titleConverged = isNew
    ? newRoutineTitleConverged(liveTitle, savedTitle)
    : liveTitle === savedTitle;
  return liveText === savedText && titleConverged && metadataMatches(liveMetadata, savedMetadata);
}

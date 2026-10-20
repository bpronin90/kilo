import { useMemo } from 'react';
import { parseWorkoutNote } from '../../lib/parser';
import { deriveSessionAlignmentIssue } from '../../lib/parser/sessions.js';
import { sliceWeekText, spliceWeekText, isValidActiveWeek } from './editorWeekText';

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
// record, its date and session ordinal. Values are held as the editor holds
// them; a field the save never writes for this note is null.
export function otherMetadata({ hasABWeeks, week, linked, date, ordinal }) {
  return {
    activeWeek: hasABWeeks ? week : null,
    deloadDate: linked ? date : null,
    deloadOrdinal: linked ? ordinal : null,
  };
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
  return parsesOrdinal(live.deloadOrdinal)
    && String(parseInt(live.deloadOrdinal, 10)) !== canonical.deloadOrdinal;
}

// What a successful save made durable: the submitted metadata, except a date
// the save did not write (never touched, or cleared) or an unparseable ordinal,
// which stay at their canonical value so status never claims them saved.
export function persistedOtherMetadata(submitted, canonical, dateTouched) {
  return {
    activeWeek: submitted.activeWeek,
    deloadDate: dateTouched && submitted.deloadDate ? submitted.deloadDate : (canonical?.deloadDate ?? null),
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

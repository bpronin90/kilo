import { useMemo } from 'react';
import { parseWorkoutNote } from '../../lib/parser';
import { deriveSessionAlignmentIssue } from '../../lib/parser/sessions.js';
import { sliceWeekText, spliceWeekText } from './editorWeekText';

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

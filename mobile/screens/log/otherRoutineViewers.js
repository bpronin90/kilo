import { useState, useEffect, useMemo } from 'react';
import { parseWorkoutNote } from '../../lib/parser';
import { isValidActiveWeek, sliceWeekText } from './editorWeekText';
import { buildDayGroups } from './logScreenHelpers';

// One independent "which note is expanded, and which A/B half" slot (#836),
// extracted from useLogOtherRoutineEditor (#1055). Instantiated once for the
// Routine tab (LogPreviousRoutines) and once for the Recovery tab
// (LogRecoverySection) so the two tabs never share a viewed note: switching
// tabs must not leak Recovery's expansion into Routine or vice versa. Each
// instance owns its own React state, so there is no module-level shared state.
export function useNoteViewer(notes) {
  const [viewingNoteId, setViewingNoteId] = useState(null);
  // Per-note selected week for the expanded card. Reset whenever the viewed
  // note changes to that note's own persisted `activeWeek` (or 'A' when
  // missing/invalid), so switching between routines never bleeds one note's
  // selection into another's.
  const [viewingActiveWeek, setViewingActiveWeek] = useState(null);

  const viewingNote = useMemo(() =>
    viewingNoteId ? notes.find(n => n.id === viewingNoteId) : null
  , [viewingNoteId, notes]);

  const viewingNoteParsed = useMemo(() =>
    viewingNote ? parseWorkoutNote(viewingNote.raw_text || '') : null
  , [viewingNote]);

  const viewingHasABWeeks = !!viewingNoteParsed && (viewingNoteParsed.weekBStartIndex ?? null) !== null;
  const viewingEffectiveWeek = viewingHasABWeeks ? (viewingActiveWeek ?? 'A') : null;

  useEffect(() => {
    if (!viewingNoteId) {
      setViewingActiveWeek(null);
      return;
    }
    const note = notes.find(n => n.id === viewingNoteId);
    const persisted = isValidActiveWeek(note?.activeWeek) ? note.activeWeek : null;
    setViewingActiveWeek(persisted ?? 'A');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingNoteId]);

  const viewingActiveText = useMemo(() => {
    if (!viewingNote) return '';
    if (!viewingHasABWeeks) return viewingNote.raw_text || '';
    return sliceWeekText(viewingNote.raw_text || '', viewingEffectiveWeek);
  }, [viewingNote, viewingHasABWeeks, viewingEffectiveWeek]);

  const viewingNoteProjectedParsed = useMemo(() => {
    if (!viewingNote) return null;
    return viewingHasABWeeks ? parseWorkoutNote(viewingActiveText) : viewingNoteParsed;
  }, [viewingNote, viewingHasABWeeks, viewingActiveText, viewingNoteParsed]);

  const viewingNoteDayGroups = useMemo(() => {
    if (!viewingNoteProjectedParsed) return [];
    return buildDayGroups(viewingNoteProjectedParsed.sections);
  }, [viewingNoteProjectedParsed]);

  return {
    viewingNoteId,
    setViewingNoteId,
    viewingNote,
    viewingNoteDayGroups,
    viewingHasABWeeks,
    viewingEffectiveWeek,
    viewingActiveWeek,
    setViewingActiveWeek,
    // #881: the exact raw-text slice `viewingNoteDayGroups` was built from —
    // needed as the `sliceText` a rendered exercise's source anchor is both
    // built against and later resolved against.
    viewingActiveText,
  };
}

// Toggles an expanded card's selected week and persists it through the note's
// existing activeWeek field — never touching currentId, so this never affects
// which routine is current. Shared by both viewer slots (#836).
export function toggleViewingWeek(viewer, update) {
  return async () => {
    if (!viewer.viewingNoteId || !viewer.viewingHasABWeeks) return;
    const previous = viewer.viewingEffectiveWeek ?? 'A';
    const next = previous === 'B' ? 'A' : 'B';
    viewer.setViewingActiveWeek(next);
    try {
      const updated = await update(viewer.viewingNoteId, { activeWeek: next });
      if (!updated) viewer.setViewingActiveWeek(previous);
    } catch (err) {
      viewer.setViewingActiveWeek(previous);
      throw err;
    }
  };
}

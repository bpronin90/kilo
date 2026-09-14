import { useEffect, useMemo } from 'react';
import { sliceRoutineWeekText } from '../../lib/interoperability/routineShare';
import { parseWorkoutNote } from '../../lib/parser';
import { deriveSessionAlignmentIssueFromSections } from '../../lib/parser/sessions.js';
import { buildDayGroups } from './logScreenHelpers';

// Shared A/B active-week text handling for the two Log editor hooks (#1055).
// Pure string helpers plus the current-routine editor's week projection and
// active-week reconciliation, parameterized by identity/state so no module-level
// editor state is held.

export function isValidActiveWeek(value) {
  return value === 'A' || value === 'B';
}

// Split raw note text on a standalone '---' line and return the requested
// half (or the full text unchanged when there is no boundary). This is the
// single implementation of the A/B read split (#955), so a pasted A/B routine
// is previewed exactly as the editors read it back.
export const sliceWeekText = sliceRoutineWeekText;

// Splice a transformed active-week body back into the full note text,
// preserving the other A/B week's body and the separator untouched. When
// there is no standalone '---' boundary the text is single-week, so the new
// active body IS the whole text.
export function spliceWeekText(fullText, week, newActiveText) {
  const lines = (fullText || '').split('\n');
  const sepIdx = lines.findIndex(l => l.trim() === '---');
  if (sepIdx === -1) return newActiveText;
  const weekAText = lines.slice(0, sepIdx).join('\n');
  const weekBText = lines.slice(sepIdx + 1).join('\n');
  if (week === 'A') return newActiveText + '\n---\n' + weekBText;
  return weekAText + '\n---\n' + newActiveText;
}

// The current-routine editor's read/edit projection onto the selected A/B half.
// activeEditText is the visible slice (full text for a plain note or a new,
// not-yet-persisted note), and everything else derives from that slice so a
// clean Week A is never blocked by Week B and vice versa.
export function useCurrentWeekProjection({ fullText, parsed, hasABWeeks, effectiveWeek, currentId }) {
  const activeEditText = useMemo(() => {
    if (!hasABWeeks || !currentId) return fullText;
    return sliceWeekText(fullText, effectiveWeek);
  }, [fullText, hasABWeeks, effectiveWeek, currentId]);

  const activeWeekParsed = useMemo(
    () => (hasABWeeks ? parseWorkoutNote(activeEditText) : parsed),
    [hasABWeeks, activeEditText, parsed]
  );

  const sessionAlignmentIssue = useMemo(
    () => deriveSessionAlignmentIssueFromSections(activeWeekParsed.sections),
    [activeWeekParsed]
  );

  const dayGroups = useMemo(
    () => buildDayGroups(activeWeekParsed.sections),
    [activeWeekParsed]
  );

  // Note-level parser rejection (e.g. an oversize note that parseWorkoutNote
  // refuses with ok:false). Surfaced as a sibling to dayGroups so the read view
  // can show a parse-failure affordance instead of a blank empty state. Checks
  // both the full-note parse and the active-week slice so an A/B note that fails
  // on either side is not silent.
  const noteError = useMemo(
    () => (!parsed.ok && parsed.error) || (!activeWeekParsed.ok && activeWeekParsed.error) || null,
    [parsed, activeWeekParsed]
  );

  // Whether there is a trailing skip marker on at least one exercise in the
  // active week, i.e. whether 'Undo skip' has anything to remove.
  const canUnskipWeek = useMemo(() => {
    for (const section of activeWeekParsed.sections) {
      for (const ex of section.exercises) {
        const entries = ex.session_entries;
        const last = entries[entries.length - 1];
        if (last && last.skipped) return true;
      }
    }
    return false;
  }, [activeWeekParsed]);

  return { activeEditText, activeWeekParsed, sessionAlignmentIssue, dayGroups, noteError, canUnskipWeek };
}

// Reconciles the current editor's local active-week selection against the note's
// persisted activeWeek. A note switch reseeds from the persisted value (or 'A');
// otherwise the user's in-session selection wins, with a one-time promotion from
// the fallback default to a newly-persisted value. Local authority (refs) is the
// same pattern used for the universal-skip counter.
export function useActiveWeekReconcile({
  hasABWeeks,
  noteIdentity,
  persistedActiveWeekValue,
  previousNoteIdentityRef,
  pendingActiveWeekRef,
  activeWeekAuthorityRef,
  setLocalActiveWeek,
}) {
  useEffect(() => {
    const noteChanged = previousNoteIdentityRef.current !== noteIdentity;
    previousNoteIdentityRef.current = noteIdentity;

    const persistedActiveWeek = isValidActiveWeek(persistedActiveWeekValue)
      ? persistedActiveWeekValue
      : null;

    if (!hasABWeeks) {
      pendingActiveWeekRef.current = null;
      activeWeekAuthorityRef.current = 'fallback';
      setLocalActiveWeek(null);
      return;
    }

    if (noteChanged) {
      pendingActiveWeekRef.current = null;
      activeWeekAuthorityRef.current = persistedActiveWeek ? 'persisted' : 'fallback';
      setLocalActiveWeek(persistedActiveWeek ?? 'A');
      return;
    }

    if (pendingActiveWeekRef.current && persistedActiveWeek === pendingActiveWeekRef.current) {
      pendingActiveWeekRef.current = null;
    }

    if (activeWeekAuthorityRef.current === 'fallback' && persistedActiveWeek) {
      activeWeekAuthorityRef.current = 'persisted';
      setLocalActiveWeek(prev => (prev === persistedActiveWeek ? prev : persistedActiveWeek));
      return;
    }

    setLocalActiveWeek(prev => (isValidActiveWeek(prev) ? prev : (persistedActiveWeek ?? 'A')));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistedActiveWeekValue, hasABWeeks, noteIdentity]);
}

// Toggles the current editor's A/B selection and persists it through the note's
// activeWeek field, rolling back the optimistic local selection if the write
// does not land. Never touches currentId, so it never changes which routine is
// current.
export async function toggleActiveWeek({
  currentId,
  hasABWeeks,
  effectiveWeek,
  update,
  pendingActiveWeekRef,
  activeWeekAuthorityRef,
  setLocalActiveWeek,
}) {
  if (!currentId || !hasABWeeks) return;
  const previous = effectiveWeek ?? 'A';
  const previousAuthority = activeWeekAuthorityRef.current;
  const next = previous === 'B' ? 'A' : 'B';
  activeWeekAuthorityRef.current = 'user';
  pendingActiveWeekRef.current = next;
  setLocalActiveWeek(next);
  try {
    const updated = await update(currentId, { activeWeek: next });
    if (!updated) {
      pendingActiveWeekRef.current = null;
      activeWeekAuthorityRef.current = previousAuthority;
      setLocalActiveWeek(previous);
    }
  } catch (err) {
    pendingActiveWeekRef.current = null;
    activeWeekAuthorityRef.current = previousAuthority;
    setLocalActiveWeek(previous);
    throw err;
  }
}

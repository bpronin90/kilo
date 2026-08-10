// First-use state machine (#748, contract in #745 Parts 3–6; the composer and
// session-autofill sheets this module used to also support were removed by
// #786/R6b-3 — freeform text entry, seeded by the tappable example in
// LogScreenEditorCard, is the single entry path now).
//
// Everything here is a PURE function over already-loaded data, derived from
// verified data, never from a persisted onboarding flag: nothing in this
// module reads or writes storage.

import { DELOAD_NOTE_PREFIX } from './LogScreenHelpers';

// ── First-use state machine (#745 Part 3 §1) ────────────────────────────────

export const FIRST_USE_UNKNOWN = 'unknown';
export const FIRST_USE_S0 = 's0';
export const FIRST_USE_S1 = 's1';
// The terminal state once a current routine has at least one logged session.
// The S2/S3 split that used to distinguish "exactly one session" from "two or
// more" existed only to power the S2 first-use card, deleted by #786/R6b-3;
// nothing distinguishes them any more, so they collapse into one state.
export const FIRST_USE_ESTABLISHED = 'established';

// Deload records are not routines. Every predicate below counts routines only,
// so generating a deload never advances or regresses the teaching state.
export function selectRoutineNotes(notes) {
  return (notes || []).filter(n => !n?.title?.startsWith(DELOAD_NOTE_PREFIX));
}

// The state is UNKNOWN until the owning read has resolved without error
// (#737's gate, inherited verbatim): a failed read leaves `notes` empty, which
// is byte-identical to a brand-new account. Callers render nothing for UNKNOWN
// rather than fabricating an empty notebook.
export function deriveFirstUseState({
  notes,
  currentId,
  notesLoading,
  notesError,
  activeSessionCount,
}) {
  if (notesLoading || notesError) return FIRST_USE_UNKNOWN;
  const routineNotes = selectRoutineNotes(notes);
  if (routineNotes.length === 0) return FIRST_USE_S0;
  if (!currentId) return FIRST_USE_S1;
  const sessions = Number.isFinite(activeSessionCount) ? activeSessionCount : 0;
  return sessions === 0 ? FIRST_USE_S1 : FIRST_USE_ESTABLISHED;
}

// The routine the S1 card offers to adopt: the most recently saved routine that
// is not already current. Ordering is by the note's own `saved_at`; notes with
// no timestamp sort last but stay reachable, so a legacy note is never hidden.
export function pickAdoptableRoutine(notes, currentId) {
  const candidates = selectRoutineNotes(notes).filter(n => n && n.id && n.id !== currentId);
  if (candidates.length === 0) return null;
  const scored = candidates.map((note, index) => {
    const t = Date.parse(note.saved_at || '');
    return { note, index, time: Number.isNaN(t) ? -Infinity : t };
  });
  scored.sort((a, b) => (b.time - a.time) || (a.index - b.index));
  return scored[0].note;
}

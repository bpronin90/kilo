// Kilo freeform input parser — ES module, no window globals
// Public compatibility barrel: re-exports from domain sub-modules under parser/
export { parseWeightEntry } from './parser/weightEntry.js';
export { parseWorkoutRow, parseHeaderDeclaration } from './parser/workoutRow.js';
export { parseWorkoutNote, applyWeekSkipToText } from './parser/workoutNote.js';
export { buildSessionsFromNote, countWorkoutSessionsFromSections, countWorkoutSessions } from './parser/sessions.js';
export { epleyPR, deriveWorkoutAnalytics, deriveTrackedPRs, deriveProgressionSignals, derivePerDaySignals } from './parser/analytics.js';
export { normalizeExerciseKey } from './parser/exerciseNames.js';
export { parseExerciseHeader, generateDeloadNote } from './parser/deloadGenerator.js';
export { sessionDateMapFromNote, sessionsSinceLastDeload, weeksSinceLastDeload } from './parser/deloadHistory.js';
export { parseWorkoutEntry } from './parser/workoutEntry.js';

// --- #881 (F10a/F10b): exercise source-jump anchor helpers ---
//
// Composite source identity for a rendered exercise occurrence, per the F10a
// contract (issue #879 comment 5399648016). Identity is NEVER the normalized
// or raw exercise name alone: sectionIndex + exerciseOrdinal (positional,
// against the exact parse that produced the render) is primary; headerLine/
// headerText are a staleness fingerprint only, never a fallback identity.
// Resolution is always a re-parse-and-locate against a `sliceRevision`-gated
// exact text match — never a stored character offset trusted across edits.
import { parseWorkoutNote as _parseWorkoutNoteForSourceAnchor } from './parser/workoutNote.js';

// Cheap non-cryptographic fingerprint of an exact raw-text slice. Used only
// as a staleness gate (sliceRevision) — never as content identity, and never
// itself sufficient to resolve an anchor (see resolveExerciseSourceAnchor).
export function hashSourceSlice(text) {
  const str = text || '';
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return `${str.length}:${h}`;
}

// Splits raw note text on a standalone '---' line and returns the requested
// half: weekIndex 0 = before the separator (Week A / single-week notes),
// weekIndex 1 = after it (Week B). Mirrors the slicing already used
// independently by the current- and other-routine editors.
export function sliceNoteWeekText(fullText, weekIndex) {
  const lines = (fullText || '').split('\n');
  const sepIdx = lines.findIndex(l => l.trim() === '---');
  if (sepIdx === -1) return fullText || '';
  return weekIndex === 1 ? lines.slice(sepIdx + 1).join('\n') : lines.slice(0, sepIdx).join('\n');
}

// { start, end } character range of a 1-based line number within `text`.
// Mirrors LogScreenEditorCard's private `_lineCharRange`.
export function headerLineCharRange(text, lineNumber) {
  if (!lineNumber || lineNumber < 1) return null;
  const lines = (text || '').split('\n');
  if (lineNumber > lines.length) return null;
  let start = 0;
  for (let i = 0; i < lineNumber - 1; i++) start += lines[i].length + 1;
  return { start, end: start + lines[lineNumber - 1].length };
}

// Builds the composite source anchor for one rendered exercise occurrence
// (F10a §1). `exercise` is the parsed exercise object that produced the
// render — sections[sectionIndex].exercises[exerciseOrdinal] — and
// `sliceText` is the exact raw-text slice that was parsed to produce it.
// Returns null when there is no valid header line to anchor to.
export function buildExerciseSourceAnchor({ noteId, weekIndex, sliceText, sectionIndex, exerciseOrdinal, exercise }) {
  if (!exercise || exercise.header_line == null) return null;
  return {
    noteId,
    weekIndex,
    sliceRevision: hashSourceSlice(sliceText),
    sectionIndex,
    exerciseOrdinal,
    headerLine: exercise.header_line,
    headerText: exercise.raw_header,
  };
}

// Resolves an anchor back to a raw-text character range (F10a §2/§3),
// re-parsing `sliceText` fresh rather than trusting any stored offset.
// Returns null — "stale, do nothing" — whenever noteId, weekIndex, or the
// exact slice text (sliceRevision) fail to match, or the positional lookup
// or header-text invariant fails. The positional tuple (sectionIndex/
// exerciseOrdinal) is never dereferenced until every gate above it passes.
export function resolveExerciseSourceAnchor(anchor, { noteId, weekIndex, sliceText }) {
  if (!anchor) return null;
  if (anchor.noteId !== noteId) return null;
  if (anchor.weekIndex !== weekIndex) return null;
  if (anchor.sliceRevision !== hashSourceSlice(sliceText)) return null;
  const parsed = _parseWorkoutNoteForSourceAnchor(sliceText);
  if (!parsed.ok) return null;
  const section = parsed.sections[anchor.sectionIndex];
  if (!section) return null;
  const exercise = section.exercises[anchor.exerciseOrdinal];
  if (!exercise) return null;
  if (exercise.raw_header !== anchor.headerText) return null;
  return headerLineCharRange(sliceText, exercise.header_line);
}

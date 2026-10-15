// Compact request catalog for "Normalize exercise names" (#1386). Pure: reads
// plain note data, never storage or the network. The request carries only the
// authority routine's exercise NAMES and each DISTINCT raw target exercise
// header once (with a lightweight day/section context), so no logged set,
// weight, date, comment or note body ever leaves the device. Refs (H1, H2, ...)
// are assigned deterministically in target order, then header order, and map
// back to snapshot note ids and source lines for local reconstruction.
import { parseWorkoutNote } from '../parser.js';
import { _DAY_RE, _EXERCISE_NUMBERED_RE, _EXERCISE_CORE_RE } from '../parser/workoutNoteCore.js';

// Local snapshot discriminator for this protocol (not the snapshot's counter).
export const NORMALIZATION_PROTOCOL = 'compact-exercise-v1';
// Reserved bare reply that means "leave this header unchanged".
export const RESERVED_NO_MATCH = 'no match';

const MAX_CONTEXTS = 6;
const SAFE_SECTION_LABEL = /^[\p{L}\s&/'’-]{1,30}$/u;

// A name/descriptor field in the reply grammar: nonempty, no edge whitespace,
// no control or line-separator characters.
export function isReplyField(text) {
  return typeof text === 'string' && text !== '' && text === text.trim() && !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(text);
}

// Only the backslash and the pipe are escaped inside a reply field.
export function escapeReplyField(text) {
  return String(text).replace(/[\\|]/g, '\\$&');
}

// The framing that precedes a header's name: the dash, or "3. " numbering. A
// "Core: X" header keeps its whole text as the name, so it has no framing.
// Returns null for lines that are not plain exercise headers (deload rows).
export function headerFraming(raw) {
  if (raw.startsWith('-')) return '-';
  const numbered = _EXERCISE_NUMBERED_RE.exec(raw);
  if (numbered) return /^\d+[a-z]?\.\s+/i.exec(raw)[0];
  return _EXERCISE_CORE_RE.test(raw) ? '' : null;
}

function sectionLabel(section) {
  const sub = (section.subheading || '').trim();
  if (SAFE_SECTION_LABEL.test(sub)) return sub;
  return section.kind && section.kind !== 'general' ? section.kind : null;
}

/**
 * Parse one note into its exercise headers. `headers` are the plain headers
 * that can be sent and rebuilt (`{ line, raw, name, where }`, 0-based `line`
 * into `raw_text.split('\n')`); `boundaries` holds every exercise-start line so
 * a note is never placed past the next exercise. Returns null when the note
 * cannot be parsed, so callers block instead of guessing.
 */
export function extractNoteHeaders(rawText) {
  const parsed = parseWorkoutNote(rawText);
  if (!parsed || parsed.ok === false) return null;
  const lines = String(rawText ?? '').split('\n');
  const boundaries = new Set();
  const headers = [];
  parsed.sections.forEach((section, sectionIndex) => {
    const day = _DAY_RE.exec(section.heading || '');
    const where = [
      parsed.weekBStartIndex == null ? null : (sectionIndex < parsed.weekBStartIndex ? 'Week A' : 'Week B'),
      day ? day[1] : null,
      sectionLabel(section),
    ].filter(Boolean).join(' · ');
    for (const exercise of section.exercises) {
      if (exercise.header_line == null) continue;
      const line = exercise.header_line - 1;
      boundaries.add(line);
      const raw = exercise.raw_header;
      if (exercise.imported || !exercise.name || headerFraming(raw) == null || lines[line].trim() !== raw) continue;
      headers.push({ line, raw, name: exercise.name, where });
    }
  });
  return { lines, headers, boundaries };
}

function authorityNames(rawText) {
  const parsed = parseWorkoutNote(rawText);
  if (!parsed || parsed.ok === false) return null;
  const names = new Set();
  for (const section of parsed.sections) {
    for (const exercise of section.exercises) {
      // A name that cannot be written in the reply grammar can never be chosen.
      if (exercise.header_line != null && isReplyField(exercise.name) && exercise.name !== RESERVED_NO_MATCH) names.add(exercise.name);
    }
  }
  return [...names];
}

const blocked = reason => ({ ok: false, reason });

/**
 * Build the request catalog for an authority and ordered targets. Returns
 * `{ ok: false, reason }` when nothing safe can be extracted.
 */
export function buildHeaderCatalog(authority, targets = []) {
  const names = authorityNames(authority?.raw_text);
  if (!names) return blocked('The authoritative routine couldn’t be read, so no exercise names can be shared.');
  if (!names.length) return blocked('The authoritative routine has no exercise names to share.');
  const byRaw = new Map();
  const headers = [];
  const notes = new Map();
  for (const target of targets) {
    const extraction = extractNoteHeaders(target?.raw_text);
    if (!extraction) return blocked(`“${target?.title || 'Untitled Routine'}” couldn’t be read, so its exercise headers can’t be shared.`);
    notes.set(target.id, extraction);
    for (const header of extraction.headers) {
      let entry = byRaw.get(header.raw);
      if (!entry) {
        entry = { ref: `H${headers.length + 1}`, raw: header.raw, name: header.name, wheres: [], occurrences: [] };
        byRaw.set(header.raw, entry);
        headers.push(entry);
      }
      entry.occurrences.push({ noteId: target.id, line: header.line });
      if (header.where && !entry.wheres.includes(header.where)) entry.wheres.push(header.where);
    }
  }
  if (!headers.length) return blocked('The selected routines have no exercise headers to share.');
  return {
    ok: true,
    names,
    headers: headers.map(({ wheres, ...rest }) => ({
      ...rest,
      where: wheres.length > MAX_CONTEXTS ? `${wheres.slice(0, MAX_CONTEXTS).join('; ')}; +${wheres.length - MAX_CONTEXTS} more` : wheres.join('; '),
    })),
    routineCount: targets.length,
    headerCount: headers.length,
    notes,
  };
}

/** The deterministic part persisted locally with a snapshot (no contexts). */
export function toStoredCatalog(catalog) {
  return {
    names: [...catalog.names],
    headers: catalog.headers.map(({ ref, raw, occurrences }) => ({ ref, raw, occurrences: occurrences.map(({ noteId, line }) => ({ noteId, line })) })),
  };
}

export function sameStoredCatalog(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

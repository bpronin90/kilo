// Pure text splice for Tidy names (#1309).
//
// One exercise header line is rewritten to a clean target name while its valid
// prescription scheme is kept, and the removed descriptor is moved verbatim to a
// single `-- <descriptor>` line directly under that occurrence's first valid
// set row. Every other byte of the note (CRLF/LF, blanks, separators, marks,
// existing comments, terminal newline) is untouched. Nothing here is trusted on
// its own: `verifyTidyEdits` reparses the result and proves the set semantics,
// entry boundaries and annotations are unchanged apart from the added comment.

import { parseWorkoutNote, normalizeExerciseKey } from '../parser.js';
import { splitNameParts } from './recoveryStrengthBaseline.js';

const DASH_HEADER_RE = /^(\s*)-(?=[^-\s])(.*?)(\s*)$/;
const NUMBERED_HEADER_RE = /^(\s*)(\d+[a-z]?\.\s+)(.*?)(\s*)$/i;
// The only promotable scheme (#1314): the descriptor's FIRST token, written
// compactly (`3x8`, `3×6-8`; 1-9 sets, 1-2 digit reps), IMMEDIATELY followed by
// `,` `;` a single space before `(`, or whitespace to the end. Anything else
// (mid-text, spaced, longer tokens like `3x8-1000`, loads, durations) is never guessed.
const LEADING_SCHEME_RE = /^([1-9][xX×][1-9]\d?(?:[-–][1-9]\d?)?)(?:[,;]\s*| (?=\()|\s*$)/;
const SEPARATOR_RE = /^\s*(?:,|—|–|-)\s*/;

// The leading scheme of a descriptor and the descriptor without it and its
// trailing separator, or null when the first token is not a compact scheme.
function promoteScheme(descriptor) {
  const m = LEADING_SCHEME_RE.exec(descriptor);
  return m ? { scheme: m[1], rest: descriptor.slice(m[0].length).trim() } : null;
}

function crOf(line) {
  return line.endsWith('\r') ? '\r' : '';
}

function liveExercise(parsed, headerLine) {
  for (const section of parsed.sections) {
    for (const ex of section.exercises) if (ex.header_line === headerLine) return ex;
  }
  return null;
}

// 1-based line number of the first valid (non-skipped, non-unparsed) set row of
// the exercise whose header is at `headerLine`, or null. Found by reparsing line
// prefixes with the real parser, so "valid row" is never re-derived here. The
// predicate is monotone in the prefix length, so a binary search is exact.
export function firstValidRowLine(lines, headerLine) {
  const hasRow = (upto) => {
    const parsed = parseWorkoutNote(lines.slice(0, upto).join('\n'));
    const ex = parsed.ok ? liveExercise(parsed, headerLine) : null;
    return !!ex && ex.session_entries.some(e => !e.skipped && !e.unparsed);
  };
  if (!hasRow(lines.length)) return null;
  let lo = headerLine + 1;
  let hi = lines.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (hasRow(mid)) hi = mid; else lo = mid + 1;
  }
  return lo;
}

// Plan one occurrence's rewrite. Returns { ok: true, edit } or { ok: false,
// reason }. `edit` carries the full new header line and the optional comment.
export function buildOccurrenceEdit(lines, ex, targetName) {
  const headerLine = ex.header_line;
  const line = lines[headerLine - 1];
  if (typeof line !== 'string') return { ok: false, reason: 'header line not found' };
  const dash = DASH_HEADER_RE.exec(line);
  const numbered = dash ? null : NUMBERED_HEADER_RE.exec(line);
  if (!dash && !numbered) return { ok: false, reason: 'unsupported header form' };
  const lead = dash ? dash[1] : numbered[1];
  const marker = dash ? '-' : numbered[2];
  const content = dash ? dash[2] : numbered[3];
  const trail = dash ? dash[3] : numbered[4];
  // The parser strips pipes, @loads, stars and colons from a name; a header the
  // parser had to normalize is not a plain name/scheme/descriptor header.
  if (content.trim() !== ex.name || ex.raw_header !== line.trim()) {
    return { ok: false, reason: 'header carries notation tidy cannot preserve' };
  }
  const parts = splitNameParts(content, { collapse: false });
  let descriptor = parts.descriptor.replace(SEPARATOR_RE, '').trim();
  // The header's own scheme keeps its original separator bytes exactly; only a
  // scheme promoted out of a descriptor gets a fresh single space. A promoted
  // scheme lives in the header alone: its span is cut out of the moved note.
  let schemeBytes = parts.scheme;
  if (!schemeBytes.trim() && descriptor) {
    const promo = promoteScheme(descriptor);
    if (promo) { schemeBytes = ` ${promo.scheme}`; descriptor = promo.rest; }
  }
  const scheme = schemeBytes.trim();
  const newContent = scheme ? `${targetName}${schemeBytes}` : targetName;
  // Everything the strips remove (a section prefix and the descriptor) becomes the one note.
  const comment = [parts.prefix.trim(), descriptor].filter(Boolean).join(' ');
  const afterLine = comment ? firstValidRowLine(lines, headerLine) : null;
  if (comment && afterLine == null) return { ok: false, reason: 'no set row to attach the moved comment to' };
  return {
    ok: true,
    edit: {
      headerLine,
      oldContent: content.trim(),
      newContent,
      newHeader: `${lead}${marker}${newContent}${trail}`,
      scheme: scheme || null,
      comment: comment || null,
      afterLine,
      targetName,
    },
  };
}

// Apply edits (all from the same original text) bottom-up so line numbers stay
// valid. A new comment line follows the row's own line ending; at an unterminated
// last line the header's ending is adopted so the file stays uniformly CRLF/LF.
export function applyTidyEdits(text, edits) {
  const lines = String(text).split('\n');
  for (const e of [...edits].sort((a, b) => b.headerLine - a.headerLine)) {
    const oldHeader = lines[e.headerLine - 1];
    lines[e.headerLine - 1] = e.newHeader;
    if (e.comment) {
      const idx = e.afterLine - 1;
      const last = idx === lines.length - 1;
      let cr = crOf(lines[idx]);
      if (!cr && last) {
        cr = crOf(oldHeader);
        lines[idx] += cr;
        lines.splice(idx + 1, 0, `-- ${e.comment}`);
      } else {
        lines.splice(idx + 1, 0, `-- ${e.comment}${cr}`);
      }
    }
  }
  return lines.join('\n');
}

function entryShape(e) {
  return {
    skipped: !!e.skipped,
    raw: e.raw,
    sets: e.sets,
    unparsed: !!e.unparsed,
    bare: !!e.bare,
    recovered: !!e.recovered,
    error: e.error ?? null,
    category: e.category ?? null,
    mark: e.annotation ? e.annotation.mark : null,
    tail: e.annotation ? e.annotation.tail : null,
    comments: e.annotation ? [...e.annotation.comments] : [],
  };
}

function exerciseShape(ex, renamed) {
  return {
    ...(renamed ? null : { name: ex.name, raw_header: ex.raw_header }),
    rows: ex.rows,
    sets: ex.sets,
    entries: ex.session_entries.map(entryShape),
    unparsed_rows: ex.unparsed_rows,
    unparsed_positions: ex.unparsed_positions.map(p => ({ pos: p.pos, raw: p.raw, error: p.error, category: p.category })),
  };
}

// Reparse proof. `edits` are the edits applied to `oldText` to make `newText`.
// Returns null when verified, else a reason. Header lines are matched by the old
// parse (positions are stable: only comment lines are inserted below them).
export function verifyTidyEdits(oldText, newText, edits) {
  const before = parseWorkoutNote(oldText);
  const after = parseWorkoutNote(newText);
  if (!before.ok || !after.ok) return 'the note no longer parses';
  if (before.weekBStartIndex !== after.weekBStartIndex) return 'week boundary changed';
  if (before.sections.length !== after.sections.length) return 'section count changed';
  const byHeader = new Map(edits.map(e => [e.headerLine, e]));
  const msgs = (p) => p.problems.map(x => x.message);
  if (JSON.stringify(msgs(before)) !== JSON.stringify(msgs(after))) return 'parse problems changed';
  for (let s = 0; s < before.sections.length; s++) {
    const a = before.sections[s];
    const b = after.sections[s];
    const secShape = (x) => JSON.stringify([x.heading, x.subheading, x.kind, x.annotations || null, x.import_annotations || null]);
    if (secShape(a) !== secShape(b) || a.exercises.length !== b.exercises.length) return 'section structure changed';
    for (let i = 0; i < a.exercises.length; i++) {
      const edit = byHeader.get(a.exercises[i].header_line);
      const oldShape = exerciseShape(a.exercises[i], !!edit);
      const newShape = exerciseShape(b.exercises[i], !!edit);
      if (edit) {
        if (normalizeExerciseKey(b.exercises[i].name) !== normalizeExerciseKey(edit.targetName)) return 'header did not reparse to the target name';
        if (edit.comment) {
          const idx = newShape.entries.findIndex(e => !e.skipped && !e.unparsed);
          const got = idx >= 0 ? newShape.entries[idx].comments : [];
          if (got[0] !== edit.comment) return 'moved comment did not attach to the first set row';
          newShape.entries[idx].comments = got.slice(1);
        }
      }
      if (JSON.stringify(oldShape) !== JSON.stringify(newShape)) return 'sets or entries changed';
    }
  }
  return null;
}

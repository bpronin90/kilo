// Local header reconstruction for "Normalize exercise names" (#1386). Adapted
// from the #1383 header validation and placement rules, now run on the model's
// {name, descriptor} choice instead of on model-written routine text: Kilo
// builds the new header itself from the exact authority name plus the ORIGINAL
// framing and prescription bytes, proves the moved descriptor is the header's
// remainder and nothing else, and splices the result into the original text.
// Pure: no storage, no network.
import { parseWorkoutNote } from '../parser.js';
import { parseHeaderDeclaration, parseWorkoutRow } from '../parser/workoutRow.js';
import { _dashContentAsSetRow } from '../parser/workoutNoteCore.js';
import { headerFraming } from './normalizationHeaderCatalog.js';

// Mirrors the parser's header time units (workoutRow.js _TIME_UNIT).
const TIME_UNIT = '(?:sec|secs|seconds?|s|min|mins|minutes?|m)';
// Sets x reps/holds (with any range and time unit), timed ranges, and
// @-loads: prescription tokens that stay whole in the header, so no range
// endpoint, unit, or load digit can ever leave it.
const PRESCRIPTION_RE = new RegExp(`\\d+(?:\\.\\d+)?\\s*[xX×]\\s*\\d+(?:\\.\\d+)?(?:\\s*[-–/]\\s*\\d+(?:\\.\\d+)?)*(?:\\s*${TIME_UNIT}\\b)?|\\d+(?:\\.\\d+)?\\s*[-–]\\s*\\d+(?:\\.\\d+)?\\s*${TIME_UNIT}\\b|@\\s*\\d[\\d.]*\\S*`, 'gi');
const UNIT_START_RE = new RegExp(`^\\s*${TIME_UNIT}\\b`, 'i');
// A scalar duration ("Bike 5 min") is prescription unless a descriptor
// separator precedes it ("Bench | 2 sec pause"), where it is descriptor text.
const SCALAR_TIME_RE = new RegExp(`\\d+(?:\\.\\d+)?\\s*${TIME_UNIT}\\b`, 'gi');
// Separators that introduce a descriptor inside an alias's header name: any
// punctuation that is not in-word name punctuation (Single-Leg, Farmer's,
// Push/Pull, 45°, T.B.D.), and any punctuation that starts a word (a spaced
// dash or slash, an opening quote). Spaced "&" and "+" join name words
// (Clean & Jerk) by owner decision (#1383). Marks (*) are handled separately.
const NAME_DESCRIPTOR_RE = /\s*[^\p{L}\p{N}\s'’\-./&+°*]|\s[^\p{L}\p{N}\s&+*]/u;
const PAIRS = { '(': ')', '[': ']', '{': '}', '<': '>', '"': '"', '“': '”', "'": "'", '‘': '’' };
const JOINS = [', ', '; ', ' '];

// Descriptor rule ("only its introducing separator and enclosing brackets
// around all of it may be dropped"). A header is framing + name + [part A] +
// prescription + [part B]; a descriptor may span both parts, cleaned apart.
// From each part only edge whitespace, ONE leading introducing separator
// (",;:|" or a spaced dash/slash/~#!.) and ONE bracket/quote pair enclosing
// ALL of what is left may go. Part A alone, and only when a prescription
// follows it, also drops ONE trailing ",;:|" or spaced dash: that separator is
// framing between descriptor and prescription ("Bench, paused, 3x5"), which
// the rebuilt header (framing + name + original prescription bytes) never
// carries. Everything else is descriptor content returned byte-for-byte:
// part B's trailing punctuation ("slow;", "slow -"), part A's when nothing
// follows it, runs ("--heavy", "slow,,"), glued symbols ("-5 lb", "...slow"),
// inner punctuation and nested brackets.
export function cleanDescriptor(text, beforePrescription = false) {
  let out = String(text).trim().replace(/^(?:[,;:|]|[—–\-/~#!.](?=\s|$))?\s*/u, '');
  if (beforePrescription) out = out.replace(/(?:\s[—–-]|[,;:|])$/u, '').trimEnd();
  const closer = PAIRS[out[0]];
  if (closer && out.length > 1 && out.endsWith(closer)) {
    const inner = out.slice(1, -1);
    if (!/[()[\]{}<>"“”]/.test(inner) && !(/['‘]/.test(out[0]) && /['‘’]/.test(inner))) out = inner.trim();
  }
  return out;
}

// The one contiguous span Kilo keeps in the header: from the first
// prescription token (or mark) with the spacing before it, through the last
// token. A mark ("*") keeps everything after it too, as the parser reads it.
function keptSpan(content) {
  const tokens = [...content.matchAll(PRESCRIPTION_RE), ...[...content.matchAll(SCALAR_TIME_RE)].filter(m => !NAME_DESCRIPTOR_RE.test(content.slice(0, m.index)))];
  const star = content.indexOf('*');
  const starts = tokens.map(m => m.index);
  if (star >= 0) starts.push(star);
  if (!starts.length) return null;
  return {
    start: content.slice(0, Math.min(...starts)).trimEnd().length,
    end: star >= 0 ? content.length : Math.max(...tokens.map(m => m.index + m[0].length)),
  };
}

// Where the name ends inside the text ahead of the prescription: right after
// the chosen name when the header already starts with it (case aside), else at
// the alias's first descriptor separator or parsed old-name end.
function nameEnd(named, oldName, newName) {
  if (named.slice(0, newName.length).toLowerCase() === newName.toLowerCase() && !/^[\p{L}\p{N}]/u.test(named.slice(newName.length))) return newName.length;
  let end = named.length;
  if (oldName && named.startsWith(oldName)) end = Math.min(end, oldName.length);
  const sep = NAME_DESCRIPTOR_RE.exec(named);
  if (sep && sep.index > 0) end = Math.min(end, sep.index);
  return end;
}

/**
 * The normalization name/prescription boundary (#1394: anything after the
 * prescription is a descriptor), shared by target edits and authority names.
 * Splits header content (framing removed) into `named` (ahead of the
 * prescription), `kept` (the whole prescription span) and `after`. `ambiguous`
 * marks a cut inside a token ("3x30" + "s") or a number glued to a range/unit.
 */
export function splitHeaderContent(content) {
  const span = keptSpan(content);
  const named = span ? content.slice(0, span.start) : content;
  const kept = span ? content.slice(span.start, span.end) : '';
  const after = span ? content.slice(span.end) : '';
  const ambiguous = /^[\p{L}\p{N}]|^[-–/.]\d/u.test(after) || (/\d$/.test(kept) && UNIT_START_RE.test(after));
  return { hasPrescription: Boolean(span), named, kept, after, ambiguous };
}

const numbers = text => (text.match(/\d+(?:\.\d+)?/g) || []).join(',');
const fail = problem => ({ ok: false, problem });

/**
 * Plan one distinct header's edit from the model's choice. `header` is
 * `{ raw, name }` (the exact trimmed header and its parsed name); `choice` is
 * `{ name, descriptor|null }`. Returns `{ ok: true, newBody, comment|null }`
 * or `{ ok: false, problem }`; ambiguous or unsafe splits are rejected.
 */
export function planHeaderEdit(header, choice) {
  const prefix = headerFraming(header.raw);
  if (prefix == null) return fail('This header isn’t a plain exercise header.');
  const { hasPrescription, named, kept, after, ambiguous } = splitHeaderContent(header.raw.slice(prefix.length));
  if (!named.trim()) return fail('There is no exercise name ahead of the prescription.');
  if (ambiguous) return fail('The prescription boundary is ambiguous, so it can’t be kept whole.');
  const end = nameEnd(named, header.name, choice.name);
  // Numbers in the old name text being replaced would vanish unless the chosen
  // name carries the same ones ("Squat 5/3/1" must not become "Back Squat").
  if (numbers(named.slice(0, end)) !== numbers(choice.name) && named.slice(0, end).toLowerCase() !== choice.name.toLowerCase()) return fail('Numbers in the old name would be dropped, so it was left alone.');
  const parts = [cleanDescriptor(named.slice(end), hasPrescription), cleanDescriptor(after)].filter(Boolean);
  if (!parts.length && choice.descriptor != null) return fail('The header has no descriptor text, but one was given.');
  if (parts.length && choice.descriptor == null) return fail(`Header text “${parts.join(', ')}” would be dropped without a descriptor.`);
  if (parts.length && !JOINS.some(join => parts.join(join) === choice.descriptor)) return fail(`The descriptor doesn’t match the header’s own text “${parts.join(', ')}”.`);
  const newBody = prefix + choice.name + kept;
  // The rebuilt header must still read as exactly the chosen name (plus any
  // mark attached to it) and keep its declared row meaning.
  const parsed = parseWorkoutNote(newBody);
  const exercise = parsed.ok ? parsed.sections[0]?.exercises[0] : null;
  const attached = /^\*+/.exec(kept)?.[0] || '';
  if (!exercise || exercise.name !== choice.name + attached) return fail('The rebuilt header wouldn’t read as that exercise name, so it was left alone.');
  if (JSON.stringify(parseHeaderDeclaration(header.raw)) !== JSON.stringify(parseHeaderDeclaration(newBody))) return fail('The rebuilt header would change what the exercise declares.');
  return { ok: true, newBody, comment: parts.length ? choice.descriptor : null };
}

// Dashed ("- 135 5"), bare ("135 5,5"), and skip ("-", "135 -") set rows.
function isSetRow(line) {
  const t = line.trim();
  if (t === '-' || /^-\s/.test(t)) return true;
  if (/^-\d/.test(t)) return Boolean(_dashContentAsSetRow(t.slice(1)));
  if (!/^\d/.test(t)) return false;
  const row = parseWorkoutRow(t);
  return row.ok && !row.blank;
}

/**
 * Where a descriptor note lands for the header at `headerLine`: directly after
 * the exercise's last set row (or its header when it has none), before any
 * trailing comments, never past another exercise, day, section or `---`.
 */
export function insertionIndex(lines, headerLine, boundaries) {
  let last = headerLine;
  for (let k = headerLine + 1; k < lines.length; k += 1) {
    if (boundaries.has(k)) break;
    const t = lines[k].trim();
    if (isSetRow(lines[k])) last = k;
    else if (t !== '' && !(t !== '---' && t.startsWith('--'))) break;
  }
  return last;
}

/**
 * Apply occurrence edits (`{ line, newBody, comment, insertAfter }`) to the
 * ORIGINAL text, bottom-up, so everything else (CRLF/LF, indentation, trailing
 * whitespace, the final newline) stays byte-identical.
 */
export function applyHeaderEdits(text, edits) {
  const lines = String(text).split('\n');
  for (const edit of [...edits].sort((a, b) => b.line - a.line)) {
    const old = lines[edit.line];
    lines[edit.line] = old.slice(0, old.length - old.trimStart().length) + edit.newBody + old.slice(old.trimEnd().length);
    if (edit.comment == null) continue;
    const at = edit.insertAfter;
    const eol = lines[at].endsWith('\r') ? '\r' : '';
    // A CRLF note whose last line has no terminator: that line gains one and
    // the new last line stays unterminated, as the note was.
    if (!eol && at === lines.length - 1 && at > 0 && lines[at - 1].endsWith('\r')) lines[at] += '\r';
    lines.splice(at + 1, 0, `-- ${edit.comment}${eol}`);
  }
  return lines.join('\n');
}

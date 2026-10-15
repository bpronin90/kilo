// Return path for the "Normalize exercise names" prompt (#1172). Parses an
// external LLM's reply as untrusted text, matches each returned routine to the
// exact target captured when the prompt was generated, and proves that only
// exercise header names changed. Pure functions: no storage, no network.
//
// Identity is the prompt's "Target routine N" reference label, never a title
// or result order, so duplicate titles and reordered replies cannot land on the
// wrong note. Every edit is re-spliced into the ORIGINAL text, so everything
// outside an approved header name stays byte-identical by construction.
import { parseWorkoutNote } from '../parser.js';
import { parseHeaderDeclaration, parseWorkoutRow } from '../parser/workoutRow.js';

// Untrusted input bound, checked before any split: generous for many full
// routines, far below anything that could stall the per-line walk.
export const MAX_REPLY_LENGTH = 1024 * 1024;

const LABEL_RE = /^\s*(?:#{1,6}\s*)?(?:[-*]\s+)?target\s+routine\s+(\d+)\b\s*(?::.*)?$/i;
const FENCE_RE = /^\s*(```|~~~)/;
const MARK_TAIL_RE = /\*+$/;

function stripDecoration(line) {
  // Models commonly bold or backtick the label line; the label itself is the
  // only thing matched, the routine lines are never decoration-stripped.
  return line.replace(/[*_`]/g, '');
}

function trimBlankEdges(lines, fences = false) {
  const edge = line => line.trim() === '' || (fences && FENCE_RE.test(line));
  let start = 0;
  let end = lines.length;
  while (start < end && edge(lines[start])) start += 1;
  while (end > start && edge(lines[end - 1])) end -= 1;
  return { start, end };
}

/**
 * Split a reply into labelled sections. Text before the first label
 * (explanations) and Markdown fence lines are ignored; anything else inside a
 * section is kept verbatim so structural edits are caught by validation.
 */
export function splitNormalizationReply(replyText) {
  if (String(replyText ?? '').length > MAX_REPLY_LENGTH) return [];
  const lines = String(replyText ?? '').replace(/\r\n?/g, '\n').split('\n');
  const sections = [];
  let current = null;
  for (const line of lines) {
    const label = LABEL_RE.exec(stripDecoration(line));
    if (label) {
      current = { number: parseInt(label[1], 10), lines: [] };
      sections.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  // Fences are dropped only at a section's edges (where models wrap output);
  // a fence-like line inside a routine stays and is validated like any line.
  return sections.map(section => {
    const { start, end } = trimBlankEdges(section.lines, true);
    return { number: section.number, lines: section.lines.slice(start, end) };
  });
}

function headerMap(text) {
  const parsed = parseWorkoutNote(text);
  const map = new Map();
  if (!parsed.ok) return map;
  for (const section of parsed.sections) {
    for (const exercise of section.exercises) {
      if (exercise.header_line != null) map.set(exercise.header_line, exercise.name);
    }
  }
  return map;
}

function splitHeader(line, name) {
  const at = line.indexOf(name);
  if (!name || at < 0) return null;
  return { prefix: line.slice(0, at), suffix: line.slice(at + name.length) };
}

// The parser can fold a spaced prescription ("Bench 3 x 5") into the name, so
// a rename must keep every number on the header line exactly as it was.
function numbers(line) {
  return (line.match(/\d+(?:\.\d+)?/g) || []).join(',');
}

// Everything from the first number on, including any whitespace right before
// it (the prescription, however spaced or attached), must be byte-identical.
function prescriptionTail(line) {
  const at = line.search(/\s*\d/);
  return at < 0 ? '' : line.slice(at);
}

function markTail(name) {
  return (MARK_TAIL_RE.exec(name) || [''])[0];
}

// A parser-supported note line; a bare "---" (week divider) never qualifies.
const INSERTED_COMMENT_RE = /^--\s+\S/;
const COMMENT_RE = /^--(\s|$)/;
// Mirrors the parser's header time units (workoutRow.js _TIME_UNIT).
const TIME_UNIT = '(?:sec|secs|seconds?|s|min|mins|minutes?|m)';
// Sets x reps/holds (with any range and time unit), timed ranges, and
// @-loads: prescription tokens that must stay whole in the header, so no range
// endpoint, unit, or load digit can leave it.
const PRESCRIPTION_RE = new RegExp(`\\d+(?:\\.\\d+)?\\s*[xX×]\\s*\\d+(?:\\.\\d+)?(?:\\s*[-–/]\\s*\\d+(?:\\.\\d+)?)*(?:\\s*${TIME_UNIT}\\b)?|\\d+(?:\\.\\d+)?\\s*[-–]\\s*\\d+(?:\\.\\d+)?\\s*${TIME_UNIT}\\b|@\\s*\\d[\\d.]*\\S*`, 'gi');
const UNIT_START_RE = new RegExp(`^\\s*${TIME_UNIT}\\b`, 'i');
// A scalar duration ("Bike 5 min") is prescription unless a descriptor
// separator precedes it ("Bench | 2 sec pause"), where it is descriptor text.
const SCALAR_TIME_RE = new RegExp(`\\d+(?:\\.\\d+)?\\s*${TIME_UNIT}\\b`, 'gi');
// Separators that introduce a descriptor inside an alias's header name: any
// punctuation that is not in-word name punctuation (Single-Leg, Farmer's,
// 3/4, 45°, T.B.D., Clean & Jerk), plus a spaced dash. Marks (*) are
// checked separately.
const NAME_DESCRIPTOR_RE = /\s*[^\p{L}\p{N}\s'’\-./&+°*]|\s[—–-]\s/u;

// Dashed ("- 135 5"), bare ("135 5,5"), and skip ("-", "135 -") set rows.
function isSetRow(line) {
  const t = line.trim();
  if (t === '-' || /^-\s/.test(line)) return true;
  if (!/^\d/.test(t)) return false;
  const row = parseWorkoutRow(t);
  return row.ok && !row.blank;
}

// Where a descriptor comment may land: directly after an exercise's last set
// row (or its header when it has none), never past another exercise, day,
// section, or Week A/B boundary. Maps that original line index -> header index.
function insertionPoints(core, originalHeaders, offset) {
  const points = new Map();
  for (let i = 0; i < core.length; i += 1) {
    if (!originalHeaders.has(offset + i + 1)) continue;
    let last = i;
    for (let k = i + 1; k < core.length; k += 1) {
      const line = core[k];
      if (originalHeaders.has(offset + k + 1)) break;
      if (isSetRow(line)) last = k;
      else if (line.trim() !== '' && !COMMENT_RE.test(line)) break;
    }
    points.set(last, i);
  }
  return points;
}

function originalHeaderText(core, change, start) {
  return core[change.lineIndex - start];
}

// Surrounding separators and one enclosing pair of brackets may go; wording,
// capitalization, and internal punctuation must survive byte-for-byte.
function cleanDescriptor(text) {
  let out = String(text).trim().replace(/^[^\p{L}\p{N}([{<"“]+/u, '').replace(/[^\p{L}\p{N})\]}>"”]+$/u, '').trim();
  const pair = /^([(\[{<"“])(.*)([)\]}>"”])$/.exec(out);
  if (pair && '([{<"“'.indexOf(pair[1]) === ')]}>"”'.indexOf(pair[3]) && !/[()[\]{}<>"“”]/.test(pair[2])) out = pair[2].trim();
  return out;
}

// Split the original header content into <old name><descriptor 1><kept tail>
// <descriptor 2>, where the kept tail is exactly what the returned header
// keeps after the new name (prescription and marks, byte-identical). Returns
// the cleaned descriptor parts, or null when no such split exists.
function descriptorSplit(content, returned, tail, oldName, newName) {
  const stars = text => (text.match(/\*/g) || []).length;
  if (stars(returned) !== stars(content)) return null;
  const prescriptions = [...content.matchAll(PRESCRIPTION_RE), ...[...content.matchAll(SCALAR_TIME_RE)].filter(m => !NAME_DESCRIPTOR_RE.test(content.slice(0, m.index)))];
  const candidates = [];
  if (!tail) candidates.push(content.length);
  else for (let at = content.indexOf(tail, 1); at >= 1; at = content.indexOf(tail, at + 1)) candidates.push(at);
  for (const at of candidates) {
    const named = content.slice(0, at);
    const after = content.slice(at + tail.length);
    if (/^[\p{L}\p{N}]|^[-–/.]\d/u.test(after) || (/\d$/.test(tail) && UNIT_START_RE.test(after))) continue;
    if (prescriptions.some(m => m.index < at || m.index + m[0].length > at + tail.length)) continue;
    let nameEnd = named.length;
    if (named.toLowerCase().startsWith(newName.toLowerCase()) && !/^[\p{L}\p{N}]/u.test(named.slice(newName.length))) {
      nameEnd = newName.length;
    } else {
      if (oldName && named.startsWith(oldName)) nameEnd = Math.min(nameEnd, oldName.length);
      const sep = NAME_DESCRIPTOR_RE.exec(named);
      if (sep && sep.index > 0) nameEnd = Math.min(nameEnd, sep.index);
    }
    const parts = [named.slice(nameEnd), after].map(cleanDescriptor).filter(Boolean);
    return parts.some(part => part.includes('*')) ? null : { parts };
  }
  return null;
}

// The moved comment must carry every descriptor part, unparaphrased.
function commentMatches(commentLine, parts) {
  const body = cleanDescriptor(commentLine.replace(/^--\s+/, ''));
  return Boolean(body) && [', ', '; ', ' '].some(join => parts.join(join) === body);
}

/**
 * Compare one target's original text with the returned text. Returns
 * `{ changes }` (header renames, each optionally with one descriptor comment
 * inserted directly after that exercise's set rows) or `{ problems }`.
 */
export function diffTargetNames(originalText, returnedLines, authorityNames = null) {
  const originalLines = String(originalText ?? '').split('\n');
  const bare = originalLines.map(line => line.replace(/\r$/, ''));
  const { start, end } = trimBlankEdges(bare);
  const core = bare.slice(start, end);
  const problems = [];
  const originalHeaders = headerMap(bare.join('\n'));
  const returnedHeaders = headerMap([...bare.slice(0, start), ...returnedLines, ...bare.slice(end)].join('\n'));
  const points = insertionPoints(core, originalHeaders, start);
  const changeByHeader = new Map();
  const inserts = [];
  let j = 0;
  for (let i = 0; i < core.length; i += 1) {
    const lineNumber = start + i + 1;
    const before = core[i];
    const after = returnedLines[j];
    const oldName = originalHeaders.get(lineNumber);
    const newName = returnedHeaders.get(start + j + 1);
    j += 1;
    if (after == null) continue;
    if (oldName == null || newName == null) {
      if (before !== after || (oldName == null) !== (newName == null)) {
        problems.push(`Line ${lineNumber} changed: “${before}” → “${after}”.`);
      }
    } else if (before !== after) {
      const a = splitHeader(before, oldName);
      const b = splitHeader(after, newName);
      const framed = Boolean(a && b && a.prefix === b.prefix && newName.trim());
      // Descriptor text leaving the header (before or after an unchanged
      // prescription) must reappear in that exercise's one moved comment.
      const split = framed ? descriptorSplit(before.slice(a.prefix.length), after.slice(b.prefix.length), b.suffix, oldName, newName) : null;
      // The header's declared row meaning (reps, duration, timed) must survive.
      const sameDeclaration = JSON.stringify(parseHeaderDeclaration(before)) === JSON.stringify(parseHeaderDeclaration(after));
      const descriptor = split && sameDeclaration ? split.parts : [];
      const plain = framed && a.suffix === b.suffix && markTail(oldName) === markTail(newName) && numbers(before) === numbers(after) && prescriptionTail(before) === prescriptionTail(after);
      if (descriptor.length && authorityNames && !authorityNames.has(newName)) {
        problems.push(`Line ${lineNumber}: “${newName}” is not an exercise name in the authoritative routine.`);
      } else if (descriptor.length || plain) {
        changeByHeader.set(i, { lineIndex: start + i, oldName, newName, newLine: after, descriptor });
      } else {
        problems.push(`Line ${lineNumber} changed more than the exercise name: “${before}” → “${after}”.`);
      }
    }
    const next = returnedLines[j];
    if (points.has(i) && next != null && INSERTED_COMMENT_RE.test(next) && next !== core[i + 1] && !returnedHeaders.has(start + j + 1)) {
      inserts.push({ header: points.get(i), afterIndex: start + i, line: next });
      j += 1;
    }
  }
  if (!problems.length && j !== returnedLines.length) {
    problems.push(`Line count changed (${core.length} expected, ${returnedLines.length} returned). Only exercise names may change, plus one “-- ” comment directly after a corrected exercise's sets.`);
  }
  for (const insert of inserts) {
    const change = changeByHeader.get(insert.header);
    if (!change) problems.push(`Inserted comment “${insert.line}” is not attached to a corrected exercise header.`);
    else if (!change.descriptor.length || !commentMatches(insert.line, change.descriptor)) problems.push(`Inserted comment “${insert.line}” does not match descriptor text removed from “${originalHeaderText(core, change, start)}”.`);
    else change.insert = { afterIndex: insert.afterIndex, line: insert.line };
  }
  for (const change of changeByHeader.values()) {
    if (change.descriptor.length && !change.insert && !problems.length) problems.push(`Line ${change.lineIndex + 1} dropped header text without moving it to a “-- ” comment.`);
  }
  for (const change of changeByHeader.values()) delete change.descriptor;
  return problems.length ? { problems } : { changes: [...changeByHeader.values()] };
}

/**
 * Validate a whole reply against the snapshot captured at prompt time
 * (`{ authority, targets: [{ id, title, raw_text }] }`, in prompt order) and
 * the notes as they exist now. Valid targets proceed; every invalid target is
 * reported with its reasons and is never written.
 */
export function buildNormalizationPreview(replyText, snapshot, currentNotes = []) {
  const targets = snapshot?.targets || [];
  const byId = new Map((currentNotes || []).map(note => [note?.id, note]));
  const currentAuthority = byId.get(snapshot?.authority?.id);
  if (!currentAuthority || currentAuthority.raw_text !== snapshot?.authority?.raw_text) {
    return { authorityStale: true, entries: [], unknown: [], mappings: [] };
  }
  if (String(replyText ?? '').length > MAX_REPLY_LENGTH) {
    return { authorityStale: false, tooLarge: true, entries: [], unknown: [], mappings: [] };
  }
  const sections = splitNormalizationReply(replyText);
  const authorityNames = new Set(headerMap(snapshot.authority.raw_text).values());
  const grouped = new Map();
  const unknown = [];
  for (const section of sections) {
    if (section.number < 1 || section.number > targets.length) unknown.push(section.number);
    else grouped.set(section.number, [...(grouped.get(section.number) || []), section]);
  }
  const entries = targets.map((target, index) => {
    const number = index + 1;
    const found = grouped.get(number) || [];
    const base = { number, id: target.id, title: target.title || 'Untitled Routine', snapshot: target.raw_text };
    const current = byId.get(target.id);
    if (!current) return { ...base, problems: ['This routine no longer exists.'] };
    if (current.raw_text !== target.raw_text) return { ...base, problems: ['This routine was edited after the prompt was generated. Generate a fresh prompt.'] };
    if (found.length === 0) return { ...base, problems: [`No result labelled “Target routine ${number}”.`] };
    if (found.length > 1) return { ...base, problems: [`“Target routine ${number}” appears ${found.length} times.`] };
    const diff = diffTargetNames(target.raw_text, found[0].lines, authorityNames);
    return diff.problems ? { ...base, problems: diff.problems } : { ...base, changes: diff.changes };
  });
  const mappingIndex = new Map();
  for (const entry of entries) {
    for (const change of entry.changes || []) {
      const key = `${change.oldName}\u0000${change.newName}`;
      if (!mappingIndex.has(key)) mappingIndex.set(key, { key, oldName: change.oldName, newName: change.newName, noteIds: new Set() });
      mappingIndex.get(key).noteIds.add(entry.id);
    }
  }
  const mappings = [...mappingIndex.values()].map(m => ({ key: m.key, oldName: m.oldName, newName: m.newName, noteCount: m.noteIds.size }));
  return { authorityStale: false, entries, unknown: [...new Set(unknown)], mappings };
}

export function mappingKey(change) {
  return `${change.oldName}\u0000${change.newName}`;
}

/**
 * Rebuild one target's text from its snapshot, applying only the selected
 * mappings. Returns null when nothing selected would change.
 */
export function applySelectedChanges(entry, selectedKeys) {
  const chosen = (entry.changes || []).filter(change => selectedKeys.has(mappingKey(change)));
  if (!chosen.length) return null;
  const lines = String(entry.snapshot).split('\n');
  for (const change of chosen) {
    const cr = lines[change.lineIndex].endsWith('\r') ? '\r' : '';
    lines[change.lineIndex] = change.newLine + cr;
  }
  // Insert descriptor comments last, bottom-up, so earlier indices stay valid.
  const inserts = chosen.filter(change => change.insert).map(change => change.insert).sort((x, y) => y.afterIndex - x.afterIndex);
  for (const insert of inserts) {
    const cr = lines[insert.afterIndex].endsWith('\r') ? '\r' : '';
    lines.splice(insert.afterIndex + 1, 0, insert.line + cr);
  }
  return lines.join('\n');
}

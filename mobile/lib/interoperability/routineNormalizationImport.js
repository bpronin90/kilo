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

const LABEL_RE = /^\s*(?:#{1,6}\s*)?(?:[-*]\s+)?target\s+routine\s+(\d+)\b\s*(?::.*)?$/i;
const FENCE_RE = /^\s*(```|~~~)/;
const MARK_TAIL_RE = /\*+$/;

function stripDecoration(line) {
  // Models commonly bold or backtick the label line; the label itself is the
  // only thing matched, the routine lines are never decoration-stripped.
  return line.replace(/[*_`]/g, '');
}

function trimBlankEdges(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') start += 1;
  while (end > start && lines[end - 1].trim() === '') end -= 1;
  return { start, end };
}

/**
 * Split a reply into labelled sections. Text before the first label
 * (explanations) and Markdown fence lines are ignored; anything else inside a
 * section is kept verbatim so structural edits are caught by validation.
 */
export function splitNormalizationReply(replyText) {
  const lines = String(replyText ?? '').replace(/\r\n?/g, '\n').split('\n');
  const sections = [];
  let current = null;
  for (const line of lines) {
    if (FENCE_RE.test(line)) continue;
    const label = LABEL_RE.exec(stripDecoration(line));
    if (label) {
      current = { number: parseInt(label[1], 10), lines: [] };
      sections.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  return sections.map(section => {
    const { start, end } = trimBlankEdges(section.lines);
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

function markTail(name) {
  return (MARK_TAIL_RE.exec(name) || [''])[0];
}

/**
 * Compare one target's original text with the returned text. Returns
 * `{ changes }` (header renames only, possibly empty) or `{ problems }`.
 */
export function diffTargetNames(originalText, returnedLines) {
  const originalLines = String(originalText ?? '').split('\n');
  const bare = originalLines.map(line => line.replace(/\r$/, ''));
  const { start, end } = trimBlankEdges(bare);
  const core = bare.slice(start, end);
  const problems = [];
  if (returnedLines.length !== core.length) {
    return { problems: [`Line count changed (${core.length} expected, ${returnedLines.length} returned). Only exercise names may change.`] };
  }
  const originalHeaders = headerMap(bare.join('\n'));
  const returnedHeaders = headerMap([...bare.slice(0, start), ...returnedLines, ...bare.slice(end)].join('\n'));
  const changes = [];
  for (let i = 0; i < core.length; i += 1) {
    const lineNumber = start + i + 1;
    const before = core[i];
    const after = returnedLines[i];
    const oldName = originalHeaders.get(lineNumber);
    const newName = returnedHeaders.get(lineNumber);
    if (oldName == null || newName == null) {
      if (before !== after || (oldName == null) !== (newName == null)) {
        problems.push(`Line ${lineNumber} changed: “${before}” → “${after}”.`);
      }
      continue;
    }
    if (before === after) continue;
    const a = splitHeader(before, oldName);
    const b = splitHeader(after, newName);
    if (!a || !b || a.prefix !== b.prefix || a.suffix !== b.suffix || markTail(oldName) !== markTail(newName) || !newName.trim()) {
      problems.push(`Line ${lineNumber} changed more than the exercise name: “${before}” → “${after}”.`);
      continue;
    }
    changes.push({ lineIndex: start + i, oldName, newName, newLine: after });
  }
  return problems.length ? { problems } : { changes };
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
  const sections = splitNormalizationReply(replyText);
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
    const diff = diffTargetNames(target.raw_text, found[0].lines);
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
  return lines.join('\n');
}

// Return path for the "Normalize exercise names" prompt (#1172, compact
// protocol #1386). Parses an external LLM's reply as untrusted text against the
// catalog captured when the prompt was copied, validates every mapping against
// the ORIGINAL notes held locally, and reconstructs each edit deterministically:
// the reply only ever names an authority exercise and, optionally, the
// descriptor text moving out of a header. Pure functions: no storage, no network.
//
// Identity is the prompt's header ref (H1, H2, ...) resolved through the
// persisted catalog to snapshot note ids and source lines, never a title or
// result order, so duplicate titles and reordered replies cannot land on the
// wrong note or occurrence.
import {
  NORMALIZATION_PROTOCOL,
  RESERVED_NO_MATCH,
  buildHeaderCatalog,
  isReplyField,
  sameStoredCatalog,
  toStoredCatalog,
} from './normalizationHeaderCatalog.js';
import { applyHeaderEdits, insertionIndex, planHeaderEdit } from './normalizationHeaderEdits.js';

// Untrusted input bound, checked before any split. A valid reply is one short
// line per distinct header, so this is far above any legitimate reply.
export const MAX_REPLY_LENGTH = 1024 * 1024;
// Reply grammar (#1386 criterion 4), applied with no trimming or repair:
//   reply  = line *(EOL line) [EOL]   EOL = "\n", or "\r\n" used for every line
//   line   = "H" ref " => " ( "no match" | name [ " | " descriptor ] )
//   ref    = [1-9][0-9]*              (no leading zero, no lowercase "h")
//   field  = nonempty, no edge whitespace, no control (Cc incl. CR, TAB, NUL,
//            NEL) or U+2028/U+2029; "\\" and "\|" are the only escapes and
//            every literal "\" or "|" must be escaped
// Any other byte sequence (bare CR, mixed endings, blank or whitespace-only
// lines, BOM/lookalike arrows before or in " => ", an empty reply) is
// malformed and blocks the whole reply. Format characters (e.g. U+200B) are
// not control characters: inside a field they parse, then fail the exact
// authority-name / original-descriptor comparison unless really present
// (U+FEFF counts as whitespace, so at a field edge it is malformed).
// "no match | x" is a match production whose name can never be an authority
// name (the reserved text is excluded), so it is rejected and never applied.
const LINE_RE = /^H([1-9][0-9]*) => /;
const ANSWER_RE = /H[1-9][0-9]* => /g;
const LOST_LINE_BREAKS = 'The reply lost its line breaks — every answer is on one line. In the chat app, use the Copy button on the code block, then paste again.';
const FENCE = '```';
const FENCE_OPEN_RE = /^```[^\r\n`]*\r?\n/;

// #1389: a reply may arrive as ONE Markdown code block. Exactly one enclosing
// pair is removed (opening fence with an optional language tag, closing fence)
// and whitespace OUTSIDE it is ignored; the payload is never trimmed or
// repaired. Unfenced text passes through untouched. Returns { text } or { error }.
function stripFence(text) {
  if (!text.includes(FENCE)) return { text };
  const t = text.trim();
  if (!t.startsWith(FENCE)) return { error: 'There is text before the code block. Reply with only one code block and nothing outside it.' };
  const count = t.split(FENCE).length - 1;
  if (count === 1) return { error: 'The code block is never closed. Reply with one complete code block that ends with ```.' };
  if (count > 2) return { error: 'The reply has more than one code block. Put every answer line in a single code block.' };
  if (!t.endsWith(FENCE)) return { error: 'There is text after the code block. Reply with only one code block and nothing outside it.' };
  const open = FENCE_OPEN_RE.exec(t);
  if (!open) return { error: 'The code block must start with ``` on its own line, with the answers on the following lines.' };
  return { text: t.slice(open[0].length, t.length - FENCE.length) };
}

// Consecutive missing refs collapse into ranges (H1–H72), numerically.
function missingRefProblems(missing) {
  const nums = missing.map(ref => Number(ref.slice(1))).sort((a, b) => a - b);
  const problems = [];
  for (let i = 0; i < nums.length;) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j += 1;
    problems.push(j === i ? `H${nums[i]} has no reply line.` : `H${nums[i]}–H${nums[j]} have no reply line.`);
    i = j + 1;
  }
  return problems;
}

function excerpt(text) {
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

// Split "<name>" or "<name> | <descriptor>" honouring only the two escapes
// (\\ and \|). Returns { name, descriptor|null } or a reason string.
function parseFields(rest) {
  const fields = [''];
  for (let i = 0; i < rest.length; i += 1) {
    const ch = rest[i];
    if (ch === '\\') {
      const next = rest[i + 1];
      if (next !== '\\' && next !== '|') return 'has an unknown or dangling escape';
      fields[fields.length - 1] += next;
      i += 1;
    } else if (ch === '|') {
      if (rest[i - 1] !== ' ' || rest[i + 1] !== ' ' || fields.length > 1) return 'has a “|” that isn’t the one “ | ” between name and descriptor';
      fields[0] = fields[0].slice(0, -1);
      fields.push('');
      i += 1;
    } else {
      fields[fields.length - 1] += ch;
    }
  }
  if (!fields.every(isReplyField)) return 'has an empty field, edge whitespace, or a control character';
  return { name: fields[0], descriptor: fields.length > 1 ? fields[1] : null };
}

/**
 * Parse a reply against the stored catalog. One line per H-ref, any order.
 * Structural problems (malformed, unknown, duplicate or missing refs) are
 * reported and make the whole reply unusable. No trimming or repair is done
 * beyond removing one enclosing code fence. Every problem is kept (the screen
 * limits only what it shows). Returns `{ ok, errors, errorCount, choices }`; `choices` maps ref to
 * `{ kind: 'none' }` or `{ kind: 'match', name, descriptor }`.
 */
export function parseNormalizationReply(replyText, catalog) {
  const raw = String(replyText ?? '');
  const errors = [];
  const report = message => { errors.push(message); };
  const fail = message => ({ ok: false, errors: [message], errorCount: 1, choices: new Map() });
  if (raw.length > MAX_REPLY_LENGTH) return { ok: false, tooLarge: true, errors, errorCount: 0, choices: new Map() };
  const fenced = stripFence(raw);
  if (fenced.error) return fail(fenced.error);
  const text = fenced.text;
  const refs = new Set(catalog.headers.map(h => h.ref));
  const choices = new Map();
  // Line terminators: "\r\n" throughout when the reply contains any CRLF, else
  // "\n". The one empty piece after a final terminator is dropped; any other
  // empty piece (empty reply, blank line, second final newline) is malformed.
  const crlf = text.includes('\r\n');
  const lines = text.split(crlf ? '\r\n' : '\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  if (lines.some(line => (line.match(ANSWER_RE) || []).length > 1)) return fail(LOST_LINE_BREAKS);
  lines.forEach((line, index) => {
    const at = `Line ${index + 1}`;
    if (line.includes('\r')) { report(`${at} has a carriage return that doesn’t end a CRLF line.`); return; }
    if (line.includes('\n')) { report(`${at} mixes LF and CRLF line endings.`); return; }
    const head = LINE_RE.exec(line);
    if (!head) { report(`${at} isn’t “H<number> => …”: ${excerpt(JSON.stringify(line))}.`); return; }
    const ref = `H${head[1]}`;
    const rest = line.slice(head[0].length);
    const parsed = rest === RESERVED_NO_MATCH ? { kind: 'none' } : parseFields(rest);
    if (typeof parsed === 'string') { report(`${at} (${ref}) ${parsed}.`); return; }
    if (!refs.has(ref)) { report(`${at}: ${ref} wasn’t in the prompt.`); return; }
    if (choices.has(ref)) { report(`${ref} appears more than once.`); return; }
    choices.set(ref, parsed.kind ? parsed : { kind: 'match', ...parsed });
  });
  missingRefProblems([...refs].filter(ref => !choices.has(ref))).forEach(report);
  return { ok: errors.length === 0, errors, errorCount: errors.length, choices };
}

const NO_PREVIEW = {
  authorityStale: false, tooLarge: false, unsupported: false, inconsistent: false,
  replyErrors: [], replyErrorCount: 0, entries: [], mappings: [], rejected: [], noMatchCount: 0, unchangedCount: 0,
};

/**
 * Validate a whole reply against the snapshot captured at prompt time
 * (`{ protocol, authority, targets, catalog }`) and the notes as they exist
 * now. A structurally invalid reply applies nothing. Otherwise each mapping is
 * validated on its own: valid mappings proceed, invalid ones are listed with
 * their reason and never written, and stale targets are skipped individually.
 */
export function buildNormalizationPreview(replyText, snapshot, currentNotes = []) {
  if (!snapshot || snapshot.protocol !== NORMALIZATION_PROTOCOL || !snapshot.catalog) return { ...NO_PREVIEW, unsupported: true };
  const byId = new Map((currentNotes || []).map(note => [note?.id, note]));
  const currentAuthority = byId.get(snapshot.authority?.id);
  if (!currentAuthority || currentAuthority.raw_text !== snapshot.authority.raw_text) return { ...NO_PREVIEW, authorityStale: true };
  if (String(replyText ?? '').length > MAX_REPLY_LENGTH) return { ...NO_PREVIEW, tooLarge: true };
  // Refs come from the persisted catalog; it must still describe the saved
  // original texts exactly, or the saved prompt can't be trusted.
  const rebuilt = buildHeaderCatalog(snapshot.authority, snapshot.targets);
  if (!rebuilt.ok || !sameStoredCatalog(toStoredCatalog(rebuilt), snapshot.catalog)) return { ...NO_PREVIEW, inconsistent: true };
  const reply = parseNormalizationReply(replyText, snapshot.catalog);
  if (!reply.ok) return { ...NO_PREVIEW, replyErrors: reply.errors, replyErrorCount: reply.errorCount };

  const names = new Set(rebuilt.names);
  const accepted = new Map();
  const rejected = [];
  let noMatchCount = 0;
  let unchangedCount = 0;
  for (const header of rebuilt.headers) {
    const choice = reply.choices.get(header.ref);
    if (choice.kind === 'none') { noMatchCount += 1; continue; }
    const plan = names.has(choice.name) ? planHeaderEdit(header, choice) : { ok: false, problem: `“${choice.name}” isn’t an exercise name in the authoritative routine.` };
    if (!plan.ok) rejected.push({ ref: header.ref, header: header.raw, problem: plan.problem });
    else if (plan.newBody === header.raw) unchangedCount += 1;
    else accepted.set(header.ref, { ...plan, name: choice.name, header });
  }

  const tally = new Map();
  const entries = snapshot.targets.map((target, index) => {
    const base = { number: index + 1, id: target.id, title: target.title || 'Untitled Routine', snapshot: target.raw_text };
    const current = byId.get(target.id);
    if (!current) return { ...base, problems: ['This routine no longer exists.'] };
    if (current.raw_text !== target.raw_text) return { ...base, problems: ['This routine was edited after the prompt was generated. Generate a fresh prompt.'] };
    const { lines, boundaries } = rebuilt.notes.get(target.id);
    const occurrences = [];
    for (const [ref, plan] of accepted) {
      for (const at of plan.header.occurrences) {
        if (at.noteId !== target.id) continue;
        occurrences.push({
          key: `${target.id}:${at.line}`, ref, line: at.line, newBody: plan.newBody, comment: plan.comment,
          insertAfter: plan.comment == null ? at.line : insertionIndex(lines, at.line, boundaries),
        });
        const seen = tally.get(ref) || { occurrences: 0, notes: new Set() };
        seen.occurrences += 1;
        seen.notes.add(target.id);
        tally.set(ref, seen);
      }
    }
    return { ...base, occurrences: occurrences.sort((a, b) => a.line - b.line) };
  });
  const mappings = [...accepted].filter(([ref]) => tally.has(ref)).map(([ref, plan]) => ({
    ref, oldHeader: plan.header.raw, newName: plan.name, newHeader: plan.newBody, descriptor: plan.comment,
    occurrenceCount: tally.get(ref).occurrences, noteCount: tally.get(ref).notes.size,
  }));
  return { ...NO_PREVIEW, entries, mappings, rejected, noMatchCount, unchangedCount };
}

/**
 * Rebuild one target's text from its snapshot, applying only the occurrences
 * `isSelected` accepts. Returns null when nothing selected would change.
 */
export function applySelectedChanges(entry, isSelected = () => true) {
  const chosen = (entry.occurrences || []).filter(isSelected);
  return chosen.length ? applyHeaderEdits(entry.snapshot, chosen) : null;
}

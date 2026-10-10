// Tidy names planner (#1309): one local, deterministic plan that cleans linked
// Recovery week exercise headers and the frozen baseline's display names/keys
// together. Pure and read-only: no network, no fuzzy matching, no alias
// invention, no routine edits. Baseline rows are the authority.
//
// A lift (one canonical identity, shared by exactly one baseline row) is either
// planned in full — every non-warmup occurrence ends with the baseline's clean
// target name, and the baseline row follows — or skipped in full with a stated
// reason. A rename never applies to just the baseline or just a subset of weeks.
// Anything that prevents proving "every linked week" (a deleted/unreadable note,
// an invalid baseline, a note that no longer parses) fails the whole operation.

import { parseWorkoutNote, normalizeExerciseKey } from '../parser.js';
import { orderedLiveWeeks, isLiveRecord } from './recoveryBlocks.js';
import { baselineNamesEvidence, fingerprintText } from './recoveryBaselineNames.js';
import { canonicalDisplayName, canonicalMatchKey } from './recoveryStrengthBaseline.js';
import { applyTidyEdits, buildOccurrenceEdit, verifyTidyEdits } from './recoveryTidyText.js';

const fail = (error) => ({ ok: false, error });

function readWeeks(block, weeks, notes) {
  const byId = new Map((notes || []).map(n => [n && n.id, n]));
  const out = [];
  for (const week of orderedLiveWeeks(weeks, block.id)) {
    const note = byId.get(week.note_id);
    if (!note || note.deleted_at || typeof note.raw_text !== 'string') {
      return fail(`Week ${week.week_number}’s note can’t be read, so names can’t be tidied safely. Nothing was changed.`);
    }
    const parsed = parseWorkoutNote(note.raw_text);
    if (!parsed.ok) return fail(`Week ${week.week_number}’s note can’t be parsed, so names can’t be tidied safely. Nothing was changed.`);
    out.push({ week, note, parsed, lines: note.raw_text.split('\n') });
  }
  return { ok: true, weeks: out };
}

function occurrencesOf(weekRead) {
  const out = [];
  weekRead.parsed.sections.forEach((section, si) => {
    section.exercises.forEach((ex) => {
      out.push({
        weekNumber: weekRead.week.week_number,
        noteId: weekRead.note.id,
        warmup: section.kind === 'warmup',
        name: ex.name,
        key: normalizeExerciseKey(ex.name),
        canon: canonicalMatchKey(ex.name),
        ex,
        weekRead,
        section: si,
      });
    });
  });
  return out;
}

// Plan for one block. Returns { ok: false, error } or
// { ok: true, empty, occurrences, baseline, unchanged, skipped, warmups,
//   noteWrites, evidence, signature }.
export function planTidyNames({ block, weeks = [], notes = [] } = {}) {
  const baseline = block && block.baseline;
  if (!block || !isLiveRecord(block)) return fail('This recovery block is no longer available.');
  if (!baseline || baseline.version !== 2 || !Array.isArray(baseline.exercises)
    || baseline.exercises.some(r => !r || typeof r.key !== 'string' || !r.key)) {
    return fail('This block’s baseline can’t be tidied. Nothing was changed.');
  }
  const read = readWeeks(block, weeks, notes);
  if (!read.ok) return read;

  const all = read.weeks.flatMap(occurrencesOf);
  const logged = all.filter(o => !o.warmup);
  const warmupOccs = all.filter(o => o.warmup);
  const rowsByCanon = new Map();
  for (const row of baseline.exercises) {
    const canon = canonicalMatchKey(row.name || row.key);
    if (!rowsByCanon.has(canon)) rowsByCanon.set(canon, []);
    rowsByCanon.get(canon).push(row);
  }

  const occurrences = [];
  const baselineChanges = [];
  const unchanged = [];
  const clean = []; // already-clean occurrences of lifts that change elsewhere
  const skipped = [];
  const edits = new Map(); // noteId -> { weekRead, edits: [] }
  const skip = (name, reason) => skipped.push({ name, reason });

  for (const [canon, rows] of rowsByCanon) {
    const occs = logged.filter(o => o.canon === canon && canon !== '');
    const label = rows[0].name || rows[0].key;
    if (!canon) { skip(label, 'No name is left once the section label, description and scheme are removed.'); continue; }
    if (rows.length > 1) {
      if (occs.length) skip(label, 'Two baseline rows share this name, so the match is ambiguous.');
      continue;
    }
    if (occs.length === 0) continue; // baseline-only rows with no logged evidence stay untouched
    const row = rows[0];
    const targetName = canonicalDisplayName(row.name || row.key);
    const targetKey = normalizeExerciseKey(targetName);
    if (targetKey !== canon) { skip(label, 'The clean name does not match the baseline identity.'); continue; }
    if (baseline.exercises.some(r => r !== row && r.key === targetKey)) {
      skip(label, `Another baseline row already uses “${targetName}”.`);
      continue;
    }
    if (warmupOccs.some(o => o.canon === canon && o.key !== targetKey)) {
      skip(label, 'A warmup entry shares this name and is never rewritten, so it would collide.');
      continue;
    }
    const needs = occs.filter(o => o.key !== targetKey);
    const weekKeys = new Map();
    for (const o of occs) {
      if (!weekKeys.has(o.weekNumber)) weekKeys.set(o.weekNumber, new Set());
      weekKeys.get(o.weekNumber).add(o.key);
    }
    const merging = [...weekKeys].find(([, keys]) => keys.size > 1);
    if (merging) { skip(label, `Week ${merging[0]} logs this lift under different names that would merge.`); continue; }

    const planned = [];
    let reason = null;
    for (const o of needs) {
      const built = buildOccurrenceEdit(o.weekRead.lines, o.ex, targetName);
      if (!built.ok) { reason = `Week ${o.weekNumber}: ${built.reason}.`; break; }
      const proof = verifyTidyEdits(o.weekRead.note.raw_text, applyTidyEdits(o.weekRead.note.raw_text, [built.edit]), [built.edit]);
      if (proof) { reason = `Week ${o.weekNumber}: ${proof}.`; break; }
      planned.push({ o, edit: built.edit });
    }
    if (reason) { skip(label, reason); continue; }

    const rowKeyChange = row.key !== targetKey;
    const rowNameChange = (row.name || row.key) !== targetName;
    if (planned.length === 0 && !rowKeyChange && !rowNameChange) { unchanged.push({ name: targetName }); continue; }
    for (const o of occs.filter(x => x.key === targetKey)) clean.push({ weekNumber: o.weekNumber, name: o.name });
    for (const { o, edit } of planned) {
      occurrences.push({
        weekNumber: o.weekNumber, noteId: o.noteId, group: canon, from: edit.oldContent, to: edit.newContent,
        scheme: edit.scheme, comment: edit.comment, headerLine: edit.headerLine,
      });
      if (!edits.has(o.noteId)) edits.set(o.noteId, { weekRead: o.weekRead, edits: [] });
      edits.get(o.noteId).edits.push(edit);
    }
    if (rowKeyChange || rowNameChange) {
      baselineChanges.push({ from_key: row.key, from_name: row.name || row.key, to_key: targetKey, to_name: targetName });
    }
  }

  // Whole-note proof: every edit of a note applied together must still reparse.
  const noteWrites = [];
  for (const [noteId, { weekRead, edits: list }] of edits) {
    const next = applyTidyEdits(weekRead.note.raw_text, list);
    if (verifyTidyEdits(weekRead.note.raw_text, next, list)) {
      return fail(`Week ${weekRead.week.week_number}’s note could not be verified after tidying. Nothing was changed.`);
    }
    noteWrites.push({ note_id: noteId, week_number: weekRead.week.week_number, expected_raw_text: weekRead.note.raw_text, next_raw_text: next });
  }
  noteWrites.sort((a, b) => a.week_number - b.week_number);
  occurrences.sort((a, b) => a.weekNumber - b.weekNumber || a.headerLine - b.headerLine);

  clean.sort((a, b) => a.weekNumber - b.weekNumber);
  const warmups = warmupOccs.filter(o => o.canon && rowsByCanon.has(o.canon)).map(o => ({ weekNumber: o.weekNumber, name: o.name }));
  const evidence = baselineNamesEvidence({ block, weeks, notes });
  const signature = fingerprintText(JSON.stringify([
    block.id, block.completed_at || null, block.deleted_at || null,
    noteWrites.map(w => [w.note_id, w.expected_raw_text, w.next_raw_text]), baselineChanges,
  ]));
  return {
    ok: true,
    empty: noteWrites.length === 0 && baselineChanges.length === 0,
    occurrences, baseline: baselineChanges, unchanged, clean, skipped, warmups, noteWrites, evidence, signature,
  };
}

// True while a stored Undo payload still describes the persisted state: every
// tidied note is live and holds exactly its tidied text, and every renamed
// baseline row still reads as its tidied name. Anything else (an edit, a delete,
// a later rename) means Undo would overwrite someone's work, so it is withheld.
export function tidyUndoStillValid(payload, { block, notes = [] } = {}) {
  if (!payload || !block || !block.baseline || !Array.isArray(block.baseline.exercises)) return false;
  const byId = new Map((notes || []).map(n => [n && n.id, n]));
  const notesOk = payload.notes.every((n) => {
    const note = byId.get(n.id);
    return !!note && !note.deleted_at && note.raw_text === n.after;
  });
  const rows = block.baseline.exercises;
  const namesOk = payload.baseline.every(c => rows.filter(r => r.key === c.to_key && r.name === c.to_name).length === 1);
  return notesOk && namesOk;
}

// Name-neutral fingerprint of a frozen baseline: version, every non-row field and
// every row field EXCEPT key/name, in row order. It is identical before and after
// a tidy or its Undo, but differs for any competing snapshot (other metrics,
// best-set pair, basis, order or version), so replay can tell the reviewed
// baseline from a replacement.
export function baselineShapeFingerprint(baseline) {
  if (!baseline || !Array.isArray(baseline.exercises)) return '';
  const { exercises, ...rest } = baseline;
  return fingerprintText(JSON.stringify([rest, exercises.map(({ key: _k, name: _n, ...r }) => r)]));
}

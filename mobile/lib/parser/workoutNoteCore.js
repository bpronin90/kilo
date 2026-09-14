// Workout-note parsing core (split from workoutNote.js, #1057).
//
// Owns MAX_RAW_TEXT_LENGTH, the line-classifier regexes, the small shape
// helpers, and parseWorkoutNote itself — the shared production contract
// consumed by Home, Log, Analytics, imports, and Recovery. The text-mutation
// module imports the regexes and _dashContentAsSetRow from here so the
// header/set-row classification stays a single source of truth; the barrel
// re-exports parseWorkoutNote and MAX_RAW_TEXT_LENGTH from here.
import { parseWorkoutRow, parseHeaderDeclaration } from './workoutRow.js';
import { kgMarkerToLb } from '../units.js';
import {
  ImportRecordError,
  _importError,
  _decodeBase64UrlJson,
  _validateImportRecord,
  _validateImportNote,
  _proseAsSetRowMessage,
} from './workoutNoteErrors.js';

// Upper bound on untrusted note text fed to the per-line parser. Real workout
// notes are at most a few KB; this cap (~200KB, thousands of lines) sits far
// above any legitimate note but bounds the work an attacker-influenced payload
// can force. Oversized input is rejected before the per-line split/loop so a
// pathological paste or synced note cannot freeze the device. Reused on the
// cloud recompute path so synced remote rows cannot bypass the limit.
export const MAX_RAW_TEXT_LENGTH = 200000;

export const _DAY_RE = /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
export const _EXERCISE_DASH_RE = /^-([^-\s].*)/;
const _SESSION_ENTRY_RE = /^-\s+(.+)/;
export const _EXERCISE_NUMBERED_RE = /^(\d+[a-z]?)\.\s+(.+)/i;
export const _EXERCISE_CORE_RE = /^Core:\s+(.+)/i;
export const _DELOAD_RE = /^([^:+\d-][^:]*?):\s+(\d+(?:\.\d+)?)\s+lbs?\s+(\d+)x(\d+)\s*$/i;
const _IMPORT_EXERCISE_RE = /^-@import-exercise\s+(.+)$/;
const _IMPORT_RECORD_RE = /^-\s+@import-record(?:\s+(.*))?$/;
const _IMPORT_NOTE_RE = /^--\s+@import-note(?:\s+(.*))?$/;

// Shared by parseWorkoutNote and `_isExerciseHeaderLine` below (single source
// of truth for the "is this a header or a missing-space set row" decision, so
// the two never disagree — see #617). A dash immediately followed by digits
// with no space (e.g. "-230 5") is never a valid exercise-name header once its
// content parses as an actual set row: the user meant "- 230 5" (a logged set)
// and just missed the space. Requires the content to literally start with a
// digit before even attempting the parse — otherwise `parseWorkoutRow`'s
// leading-alphabetic-flag stripping (e.g. "Row 135 10" -> "135 10") would
// reclassify a genuine alphabetic exercise header (e.g. "-Row 135 10") as a
// missing-space set row, which is not what this recovery is for. Returns the
// parsed row on match, else null.
export function _dashContentAsSetRow(content, declaration = null) {
  if (!/^\d/.test(content)) return null;
  const r = parseWorkoutRow(content, declaration);
  return (r.ok && !r.blank && !r.skipped) ? r : null;
}

function _normalizeExerciseName(raw) {
  let name = raw
    .replace(/\s*\|.*$/, '')
    .replace(/\s+@\d[\d.]*\S*.*$/, '')
    .replace(/\s*:\s*\d+[xX×][\d\s\-–]+.*$/, '')
    .replace(/\s+\*.*$/, '')
    .replace(/\s+\d+[xX×][\d][\d\-–]*\S*$/, '')
    .replace(/\s+\d+\s+\d+[-–]\d+$/, '')
    .replace(/:\s*$/, '')
    .trim();
  return name || raw.trim();
}

// Canonical annotation shape carried on logged session_entries: a star `mark`
// (e.g. "PR") preserved from parseWorkoutRow, any `--` comment lines attributed
// to this entry, and a captured inline prose `tail` (e.g. "RPE 9") that followed
// the row's valid set segments. Consumed by WorkoutContentRenderer for display;
// never enters exercise-name normalization or the analytics set/rep data.
function _makeAnnotation(mark, tail) {
  return { mark: mark || null, comments: [], tail: tail || null };
}

function _makeSet(setIndex, repCount, weightValue, weightUnit) {
  return {
    set_index: setIndex,
    rep_count: repCount,
    weight_value: weightValue,
    weight_unit: weightUnit,
    duration_seconds: null,
    assistance_value: null,
    assistance_unit: null,
    note_text: null,
  };
}

export function parseWorkoutNote(noteText) {
  if (!noteText || noteText.trim() === '') return { ok: true, sections: [], weekBStartIndex: null, problems: [] };

  // Reject untrusted text over the cap before the per-line split/loop runs.
  // Returns the safe-empty shape so existing callers that only read `sections`
  // degrade to "no parse" instead of doing unbounded work, while `ok: false`
  // and `error` are available to callers that surface the rejection.
  if (noteText.length > MAX_RAW_TEXT_LENGTH) {
    return {
      ok: false,
      error: `Note text is too large to parse (${noteText.length} characters; limit ${MAX_RAW_TEXT_LENGTH}).`,
      sections: [],
      weekBStartIndex: null,
      problems: [],
    };
  }

  try {
  const sections = [];
  let currentDay = null;
  let currentSection = null;
  let currentExercise = null;
  // #854/G1: the header-declaration grammar governing bare-integer set rows
  // under the currently open exercise (null = no declaration, so a bare
  // integer is preserved rather than parsed — see G1-p).
  let currentDeclaration = null;
  let weekBStartIndex = null;
  // #854/G7c: prose lines with no open exercise are preserved as note-level
  // annotations on the section that hosts them, never silently dropped.
  let sectionAnnotations = [];
  // #856: flat, line-addressable list of syntax errors encountered while
  // walking the note, in line order — the single source of truth for
  // jump-to-problem navigation in the editor. Never affects parsing itself.
  const problems = [];

  function flushExercise() {
    if (currentExercise && currentSection) {
      currentExercise.sets = currentExercise.rows.flatMap(r => r.sets);
      currentSection.exercises.push(currentExercise);
      currentExercise = null;
      currentDeclaration = null;
    }
  }

  function flushSection() {
    flushExercise();
    if (currentSection) {
      if (sectionAnnotations.length > 0) currentSection.annotations = sectionAnnotations;
      sections.push(currentSection);
      currentSection = null;
    }
    sectionAnnotations = [];
  }

  function ensureSection() {
    if (!currentSection) {
      currentSection = { heading: currentDay, subheading: null, kind: 'general', exercises: [] };
    }
  }

  function startExercise(name, rawHeader) {
    flushExercise();
    ensureSection();
    currentExercise = { name, raw_header: rawHeader, rows: [], session_entries: [], unparsed_rows: [], unparsed_positions: [] };
    currentDeclaration = parseHeaderDeclaration(rawHeader);
  }

  const rawLines = noteText.split('\n');
  for (let lineIdx = 0; lineIdx < rawLines.length; lineIdx++) {
    const rawLine = rawLines[lineIdx];
    const lineNumber = lineIdx + 1;
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const importExerciseMatch = _IMPORT_EXERCISE_RE.exec(trimmed);
    if (trimmed.startsWith('-@import-exercise') && !importExerciseMatch) _importError('exercise name is empty.');
    if (importExerciseMatch) {
      let name;
      try { name = JSON.parse(importExerciseMatch[1]); }
      catch { _importError('exercise name is not valid JSON.'); }
      if (typeof name !== 'string' || name.length === 0 || name.length > 20000) _importError('exercise name is invalid.');
      startExercise(name, trimmed);
      currentExercise.header_line = lineNumber;
      currentExercise.imported = true;
      continue;
    }

    const importRecordMatch = _IMPORT_RECORD_RE.exec(trimmed);
    if (importRecordMatch) {
      if (!currentExercise) _importError('record has no exercise.');
      const record = _validateImportRecord(_decodeBase64UrlJson(importRecordMatch[1]));
      const expectedOrdinal = currentExercise.session_entries.length;
      if (record.rowOrdinal !== expectedOrdinal) _importError(`record rowOrdinal ${record.rowOrdinal} does not match ${expectedOrdinal}.`);
      const setOffset = currentExercise.rows.reduce((sum, row) => sum + row.sets.length, 0);
      const sets = (record.sets || []).map((sourceSet, index) => {
        const authoredKg = sourceSet.weight_unit === 'kg' && sourceSet.weight_value != null;
        return {
          ..._makeSet(
            setOffset + index + 1,
            sourceSet.rep_count ?? null,
            authoredKg ? kgMarkerToLb(sourceSet.weight_value) : (sourceSet.weight_value ?? null),
            sourceSet.weight_value == null ? null : 'lb',
          ),
          duration_seconds: sourceSet.duration_seconds ?? null,
          ...(authoredKg ? { converted_from_kg: true, kg_value: sourceSet.weight_value } : null),
        };
      });
      const entry = { skipped: false, raw: trimmed, sets, imported: true, import_record: record };
      if (record.kind === 'unparsed') {
        entry.unparsed = true;
        currentExercise.unparsed_rows.push(record.prose || trimmed);
      } else if (sets.length) {
        currentExercise.rows.push({ raw: trimmed, sets });
      }
      currentExercise.session_entries.push(entry);
      continue;
    }

    const importNoteMatch = _IMPORT_NOTE_RE.exec(trimmed);
    if (importNoteMatch) {
      const annotation = _validateImportNote(_decodeBase64UrlJson(importNoteMatch[1]));
      if (annotation.scope === 'section') {
        if (currentSection) flushSection();
        ensureSection();
        if (sections.length !== annotation.sectionOrdinal) _importError('section annotation coordinates do not resolve.');
        if (!currentSection.import_annotations) currentSection.import_annotations = [];
        currentSection.import_annotations.push(annotation);
      } else {
        if (sections.length !== annotation.sectionOrdinal || !currentSection || !currentExercise) _importError('annotation section coordinates do not resolve.');
        if (currentSection.exercises.length !== annotation.exerciseOrdinal) _importError('annotation exercise coordinates do not resolve.');
        const matching = currentExercise.session_entries.filter(entry => (
          annotation.scope === 'skipped_row' ? entry.skipped
            : annotation.scope === 'unparsed_row' ? entry.unparsed
              : !entry.skipped && !entry.unparsed
        ));
        const target = matching[annotation.targetOrdinal];
        if (!target) _importError('annotation target coordinates do not resolve.');
        if (!target.import_annotations) target.import_annotations = [];
        target.import_annotations.push(annotation);
      }
      continue;
    }

    if (trimmed === '-') {
      if (currentExercise) {
        currentExercise.session_entries.push({ skipped: true, raw: '-', sets: [] });
      }
      continue;
    }

    // Week B separator: '---' marks the boundary between week A and week B.
    // Must be checked before the '--' comment handler since '---'.startsWith('--') is true.
    if (trimmed === '---') {
      flushSection();
      weekBStartIndex = sections.length;
      currentDay = null;
      continue;
    }

    if (_DAY_RE.test(trimmed)) {
      flushSection();
      currentDay = trimmed;
      continue;
    }

    if (trimmed.startsWith('+')) {
      flushSection();
      const subheading = trimmed.slice(1).trim();
      const kind = /warmup/i.test(subheading) ? 'warmup'
                 : /lift/i.test(subheading) ? 'lifting'
                 : 'general';
      currentSection = { heading: currentDay, subheading, kind, exercises: [] };
      continue;
    }

    if (trimmed.startsWith('--')) {
      if (currentExercise) {
        const entries = currentExercise.session_entries;
        const last = entries[entries.length - 1];
        if (last && !last.skipped && !last.unparsed) {
          if (!last.annotation) last.annotation = _makeAnnotation(null);
          const commentText = trimmed.slice(2).trim();
          last.annotation.comments.push(commentText);
          // Legacy alias kept for existing consumers (e.g. the storage
          // migration contract) that read entry.comments directly; the
          // canonical shape going forward is entry.annotation.comments.
          if (!last.comments) last.comments = [];
          last.comments.push(commentText);
        } else {
          currentExercise.unparsed_rows.push(trimmed);
        }
      } else {
        // #854/G7a: "-- " with no open exercise to attach to — retained as a
        // section-level annotation instead of dropped.
        ensureSection();
        sectionAnnotations.push(trimmed.slice(2).trim());
      }
      continue;
    }

    const dashMatch = _EXERCISE_DASH_RE.exec(trimmed);
    if (dashMatch) {
      const dashContent = dashMatch[1].trim();
      const recovery = _dashContentAsSetRow(dashContent, currentDeclaration);
      if (recovery) {
        // Missing dash-space (#617): "-230 5" was meant as "- 230 5", a
        // logged set, not an exercise-name header. Never mint a numeric-named
        // phantom exercise for it.
        if (currentExercise) {
          if (recovery.preserved) {
            // #854/G1-p: recognized bare integer, no governing declaration —
            // preserved, not structured data.
            currentExercise.unparsed_rows.push(dashContent);
            currentExercise.session_entries.push({ skipped: false, raw: dashContent, sets: [], unparsed: true, error: null, category: null });
          } else {
            // Recover it as a set under the current exercise, same shape as a
            // normal dash-space session entry.
            const offset = currentExercise.rows.reduce((sum, r) => sum + r.sets.length, 0);
            const reindexed = recovery.sets.map(s => ({ ...s, set_index: offset + s.set_index }));
            currentExercise.rows.push({ raw: dashContent, sets: reindexed });
            currentExercise.session_entries.push({
              skipped: false,
              raw: dashContent,
              sets: reindexed,
              recovered: true,
              annotation: _makeAnnotation(recovery.mark, recovery.tail),
            });
          }
        } else {
          // No current exercise to attach the recovered set to: never invent
          // one just to hold it. Surface a visible Tier-A parser error instead
          // (mirrors the existing note-level `ok:false` rejection path — no
          // synthetic section/exercise is invented).
          return {
            ok: false,
            error: `Set row with no exercise — start the exercise with "- " (a dash and a space): "${trimmed}"`,
            sections: [],
            weekBStartIndex: null,
            // Every error already collected before this rejection is kept
            // (not just the rejection itself) so the editor can still
            // navigate to an earlier malformed row, not only the one that
            // ultimately aborted the parse.
            problems: [...problems, {
              line: lineNumber,
              message: `Set row with no exercise — start the exercise with "- " (a dash and a space): "${trimmed}"`,
              exerciseName: null,
              severity: 'error',
            }],
          };
        }
        continue;
      }

      startExercise(_normalizeExerciseName(dashContent), trimmed);
      currentExercise.header_line = lineNumber;
      continue;
    }

    const numberedMatch = _EXERCISE_NUMBERED_RE.exec(trimmed);
    if (numberedMatch) {
      startExercise(_normalizeExerciseName(numberedMatch[2].trim()), trimmed);
      currentExercise.header_line = lineNumber;
      continue;
    }

    const coreMatch = _EXERCISE_CORE_RE.exec(trimmed);
    if (coreMatch) {
      startExercise(_normalizeExerciseName('Core: ' + coreMatch[1].trim()), trimmed);
      currentExercise.header_line = lineNumber;
      continue;
    }

    const deloadMatch = _DELOAD_RE.exec(trimmed);
    if (deloadMatch) {
      flushExercise();
      ensureSection();
      const dlName = deloadMatch[1].trim();
      const dlWeight = parseFloat(deloadMatch[2]);
      const dlNumSets = parseInt(deloadMatch[3], 10);
      const dlReps = parseInt(deloadMatch[4], 10);
      const dlSets = [];
      for (let si = 0; si < dlNumSets; si++) {
        dlSets.push(_makeSet(si + 1, dlReps, dlWeight, 'lb'));
      }
      currentSection.exercises.push({
        name: dlName,
        raw_header: trimmed,
        header_line: lineNumber,
        rows: [{ raw: trimmed, sets: dlSets }],
        sets: dlSets,
        session_entries: [],
        unparsed_rows: [],
      });
      continue;
    }

    if (currentExercise) {
      const sessionEntryMatch = _SESSION_ENTRY_RE.exec(trimmed);

      if (sessionEntryMatch) {
        const entryRaw = sessionEntryMatch[1].trim();
        const rowResult = parseWorkoutRow(entryRaw, currentDeclaration);
        if (rowResult.ok && !rowResult.blank && !rowResult.skipped && !rowResult.preserved) {
          const offset = currentExercise.rows.reduce((sum, r) => sum + r.sets.length, 0);
          const reindexed = rowResult.sets.map(s => ({ ...s, set_index: offset + s.set_index }));
          currentExercise.rows.push({ raw: entryRaw, sets: reindexed });
          currentExercise.session_entries.push({ skipped: false, raw: entryRaw, sets: reindexed, annotation: _makeAnnotation(rowResult.mark, rowResult.tail) });
        } else if (rowResult.skipped) {
          currentExercise.session_entries.push({ skipped: true, raw: entryRaw, sets: [] });
        } else if (rowResult.preserved) {
          // #854/G1-p: a bare integer with no governing header declaration —
          // recognized, but not structured workout data. Preserved visibly,
          // no ⚠, no message.
          currentExercise.unparsed_rows.push(entryRaw);
          currentExercise.session_entries.push({ skipped: false, raw: entryRaw, sets: [], unparsed: true, error: null, category: null });
        } else if (!rowResult.blank) {
          // #854/G7b: prose typed directly as a set row (no digits at all)
          // gets a message teaching the "-- " note form instead of the reps
          // grammar it was never attempting to use.
          const error = /\d/.test(entryRaw) ? (rowResult.error ?? null) : _proseAsSetRowMessage();
          currentExercise.unparsed_rows.push(entryRaw);
          // Carry the parser's error/category onto the unparsed entry so the
          // read view can surface a labeled, actionable message instead of a
          // bare red line. The raw text is preserved unchanged.
          currentExercise.session_entries.push({ skipped: false, raw: entryRaw, sets: [], unparsed: true, error, category: rowResult.category ?? null });
          if (error) {
            problems.push({ line: lineNumber, message: error, exerciseName: currentExercise.name, severity: 'error' });
          }
        }
      } else {
        const rowResult = parseWorkoutRow(trimmed, currentDeclaration);
        if (rowResult.ok && !rowResult.blank && !rowResult.skipped && !rowResult.preserved) {
          const offset = currentExercise.rows.reduce((sum, r) => sum + r.sets.length, 0);
          const reindexed = rowResult.sets.map(s => ({ ...s, set_index: offset + s.set_index }));
          currentExercise.rows.push({ raw: trimmed, sets: reindexed });
          // bare: true marks this as a plain row (no leading '- '); a following
          // '--' comment still attaches to it via annotation.comments since it
          // is a valid logged entry (not skipped, not unparsed).
          currentExercise.session_entries.push({ skipped: false, raw: trimmed, sets: reindexed, bare: true, annotation: _makeAnnotation(rowResult.mark, rowResult.tail) });
        } else if (rowResult.preserved) {
          currentExercise.unparsed_positions.push({ pos: currentExercise.session_entries.length, raw: trimmed, error: null, category: null });
          currentExercise.unparsed_rows.push(trimmed);
        } else if (!rowResult.blank && !rowResult.skipped) {
          const error = /\d/.test(trimmed) ? (rowResult.error ?? null) : _proseAsSetRowMessage();
          // Preserve the parser error/category alongside the positional raw so
          // a bare-int/garbage row can render its recovery hint in place.
          currentExercise.unparsed_positions.push({ pos: currentExercise.session_entries.length, raw: trimmed, error, category: rowResult.category ?? null });
          currentExercise.unparsed_rows.push(trimmed);
          if (error) {
            problems.push({ line: lineNumber, message: error, exerciseName: currentExercise.name, severity: 'error' });
          }
        }
      }
    } else {
      // #854/G7c: a nonblank line with no open exercise is never data and
      // never an error — preserved as a note/section-level annotation so it
      // is accounted for instead of silently vanishing.
      ensureSection();
      sectionAnnotations.push(trimmed);
    }
  }

  flushSection();
  return { ok: true, sections, weekBStartIndex, problems };
  } catch (error) {
    if (!(error instanceof ImportRecordError)) throw error;
    return { ok: false, error: error.message, sections: [], weekBStartIndex: null, problems: [] };
  }
}

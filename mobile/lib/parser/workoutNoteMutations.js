// Workout-note text mutations (split from workoutNote.js, #1057).
//
// Owns the note-text transforms that add or remove lines while preserving every
// existing logged value: the shared exercise-block walker, the week-skip
// apply/remove pair, and the progression-suggestion insertion. All of these
// depend on parseWorkoutNote and the classifier regexes from the core module so
// exercise occurrence order lines up with `sections[*].exercises`. The barrel
// re-exports applyWeekSkipToText, removeWeekSkipFromText, and
// applyProgressionSuggestionToNoteText from here.
import { parseHeaderDeclaration } from './workoutRow.js';
import { normalizeExerciseKey } from './exerciseNames.js';
import {
  parseWorkoutNote,
  MAX_RAW_TEXT_LENGTH,
  _dashContentAsSetRow,
  _DAY_RE,
  _EXERCISE_DASH_RE,
  _EXERCISE_NUMBERED_RE,
  _EXERCISE_CORE_RE,
  _DELOAD_RE,
} from './workoutNoteCore.js';

// Shared line-classifier for the skip-week transforms below: matches the
// same section/exercise boundary lines parseWorkoutNote uses, so occurrence
// order lines up with `sections[*].exercises`. Deload lines
// ("Name: 135 lbs 3x5") count too — parseWorkoutNote turns each into its own
// exercise, so omitting them here would shift every later exercise onto the
// wrong eligibility flag.
function _isExerciseHeaderLine(t) {
  const dashMatch = _EXERCISE_DASH_RE.exec(t);
  // A missing-space set row (#617, e.g. "-230 5") is never a header here
  // either — parseWorkoutNote never starts a new exercise for it (it either
  // recovers into the current exercise or becomes a Tier-A note error), so
  // this classifier must not count it as one either.
  const isDashHeader = !!dashMatch && !_dashContentAsSetRow(dashMatch[1].trim());
  return (
    isDashHeader ||
    /^(\d+[a-z]?)\.\s+.+/i.test(t) ||
    /^Core:\s+.+/i.test(t) ||
    _DELOAD_RE.test(t)
  );
}

// Walks rawText line-by-line, grouping lines into per-exercise blocks in the
// same order as `sections[*].exercises`, and calls `onExerciseBlock(pending,
// eligible)` when each block closes, where `pending` is the mutable array of
// lines belonging to that block and `eligible` is `eligibleFlags[occIdx]`.
// Shared by applyWeekSkipToText and removeWeekSkipFromText so both stay a
// single linear pass over the note text.
function _transformExerciseBlocks(rawText, eligibleFlags, onExerciseBlock) {
  const lines = rawText.split('\n');
  const result = [];
  let occIdx = 0;
  let inExercise = false;
  let eligible = false;
  const pending = [];

  function flush() {
    if (inExercise) onExerciseBlock(pending, eligible);
    result.push(...pending);
    pending.length = 0;
    inExercise = false;
    eligible = false;
  }

  for (const line of lines) {
    const t = line.trim();

    if (!t) {
      (inExercise ? pending : result).push(line);
      continue;
    }

    if (t === '---' || _DAY_RE.test(t) || t.startsWith('+')) {
      flush();
      result.push(line);
      continue;
    }

    if (_isExerciseHeaderLine(t)) {
      flush();
      inExercise = true;
      eligible = occIdx < eligibleFlags.length ? eligibleFlags[occIdx] : false;
      occIdx++;
      pending.push(line);
      continue;
    }

    (inExercise ? pending : result).push(line);
  }

  flush();
  return result.join('\n');
}

// Insert a standalone '-' skip marker after each exercise block that has at
// least one recorded session entry. Preserves all existing logged values.
// Every press appends exactly one marker per eligible exercise — there is no
// same-marker guard, so an exercise that already ends in a skip still gets
// another one on a further press (repeated presses stack skip markers, and
// each stack level can be undone one at a time with removeWeekSkipFromText).
// sections must come from parseWorkoutNote(rawText) so exercise order matches.
export function applyWeekSkipToText(rawText, sections) {
  const needsDash = [];
  for (const section of sections) {
    for (const ex of section.exercises) {
      needsDash.push(ex.session_entries.length > 0);
    }
  }

  if (!needsDash.some(Boolean)) return rawText;

  return _transformExerciseBlocks(rawText, needsDash, (pending, eligible) => {
    if (eligible) pending.push('-');
  });
}

// Inverse of applyWeekSkipToText: removes exactly one trailing skip marker
// (a standalone '-' line) from each exercise block whose last session entry
// is a skip, undoing one 'Skip week' press. Exercises with no session
// entries, or whose last entry is not a skip, are left untouched — this
// never removes a non-trailing skip marker or any logged value. Trailing
// blank lines after the marker are preserved. sections must come from
// parseWorkoutNote(rawText) so exercise order matches.
export function removeWeekSkipFromText(rawText, sections) {
  const needsRemoval = [];
  for (const section of sections) {
    for (const ex of section.exercises) {
      const entries = ex.session_entries;
      const last = entries[entries.length - 1];
      needsRemoval.push(!!last && last.skipped);
    }
  }

  if (!needsRemoval.some(Boolean)) return rawText;

  return _transformExerciseBlocks(rawText, needsRemoval, (pending, eligible) => {
    if (!eligible) return;
    // Remove the last non-blank line in this block only if it is exactly a
    // bare skip marker; trailing blank lines are skipped over and preserved.
    for (let i = pending.length - 1; i >= 0; i--) {
      const lt = pending[i].trim();
      if (lt === '') continue;
      if (lt === '-') pending.splice(i, 1);
      break;
    }
  });
}

// ── Apply a progression suggestion to note text (#961, stage 4 of #580) ────────
//
// This is the ONLY path by which a progression suggestion changes canonical
// note text, and it runs only on an explicit "Apply to note" tap. It inserts
// new lines — a target set row appended under the matching exercise, or a whole
// synthesized exercise block when the note has no such exercise yet — and never
// rewrites or deletes an existing line. Every other suggestion interaction
// (cancel, dismiss, mute, passive rendering) leaves `raw_text` byte-identical
// by never calling this.
//
// `suggestion` is a record from `deriveProgressionSuggestion` (see
// `lib/data/progressionSuggestions.js`). Only a positive, weighted
// double-progression record carries a concrete numeric target that can be typed
// as a row; the bodyweight-ceiling record proposes no weight, so there is
// nothing to insert and the card offers no Apply control for it.
//
// Returns `{ text, applied, reason }`. When `applied` is false the returned
// `text` is the input, byte-for-byte.
function _formatTargetWeight(value) {
  return Number.isInteger(value) ? String(value) : String(Number(Number(value).toFixed(2)));
}

export function applyProgressionSuggestionToNoteText(rawText, suggestion) {
  const text = typeof rawText === 'string' ? rawText : '';
  const unchanged = (reason) => ({ text, applied: false, reason });

  if (text.length > MAX_RAW_TEXT_LENGTH) return unchanged('note-too-large');
  if (!suggestion || typeof suggestion !== 'object') return unchanged('no-suggestion');

  const heuristic = suggestion.heuristic;
  const name = typeof suggestion.name === 'string' ? suggestion.name.trim() : '';
  if (
    !name ||
    /[\r\n]/.test(name) ||
    suggestion.suggested !== true ||
    !heuristic || typeof heuristic !== 'object' ||
    heuristic.action !== 'increase_weight' ||
    heuristic.unit !== 'lb' ||
    heuristic.suggested_weight == null ||
    !Number.isFinite(heuristic.suggested_weight) ||
    heuristic.suggested_weight <= 0
  ) {
    return unchanged('not-applicable');
  }

  const setCount = Number.isInteger(heuristic.suggested_sets) && heuristic.suggested_sets > 0
    ? heuristic.suggested_sets : null;
  const repCount = Number.isInteger(heuristic.suggested_reps) && heuristic.suggested_reps > 0
    ? heuristic.suggested_reps : null;
  if (setCount == null || repCount == null) return unchanged('incomplete-target');

  // A bare weight token is lb (see workoutRow.js), and a comma rep-group with
  // one member per declared set is exactly how the user types a logged row:
  // "140 8,8,8".
  const targetRow = `${_formatTargetWeight(heuristic.suggested_weight)} ${Array(setCount).fill(repCount).join(',')}`;

  // Guard the produced text before returning it as applied: an insertion that
  // pushes a boundary-length note past the parser cap, or that otherwise fails
  // to reparse, is refused rather than handed back as a successful apply.
  const finalize = (candidate, reason) => {
    if (candidate.length > MAX_RAW_TEXT_LENGTH) return unchanged('note-too-large');
    if (parseWorkoutNote(candidate).ok !== true) return unchanged('would-not-reparse');
    return { text: candidate, applied: true, reason };
  };

  const parsed = parseWorkoutNote(text);
  if (!parsed.ok) return unchanged('note-unparsable');

  const targetKey = normalizeExerciseKey(name);

  // Pick which occurrence of the exercise the target belongs under. A
  // double-progression suggestion is predicated on the user's own declared rep
  // range, so its real home is a non-warmup occurrence that carries a header
  // declaration. A same-named "+WARMUP" entry (an empty-bar "-Bench Press",
  // say) must never receive the heavy working row; when there is no usable
  // working occurrence we synthesize a fresh block instead of polluting one.
  let occ = 0;
  let bestIdx = -1;
  let bestRank = 0;
  let bestEntries = [];
  for (const section of parsed.sections) {
    const isWarmup = section.kind === 'warmup';
    for (const ex of section.exercises) {
      if (normalizeExerciseKey(ex.name) === targetKey) {
        const header = ex.raw_header || '';
        // Only a real opening header (dash, numbered, or Core) starts a
        // `currentExercise` in parseWorkoutNote, so only those can host an
        // appended bare row. A deload line ("Name: 135 lbs 3x5") opens
        // nothing — appending under it would misfile the row on reparse.
        const opensExercise =
          _EXERCISE_DASH_RE.test(header) ||
          _EXERCISE_NUMBERED_RE.test(header) ||
          _EXERCISE_CORE_RE.test(header);
        // 3 = non-warmup, header declares a rep range (the working exercise);
        // 2 = non-warmup, no declaration; 1 = warmup; 0 = cannot host a row.
        const rank = !opensExercise ? 0 : isWarmup ? 1 : parseHeaderDeclaration(header) ? 3 : 2;
        if (rank > bestRank) {
          bestRank = rank;
          bestIdx = occ;
          bestEntries = ex.session_entries || [];
        }
      }
      occ++;
    }
  }

  // Append only into a real non-warmup working occurrence (rank >= 2). A
  // warmup-only or deload-only match falls through to a synthesized block.
  if (bestRank >= 2) {
    // Stale / repeated apply: the identical target row is already this
    // exercise's last logged entry. Re-applying must not silently stack a
    // duplicate row.
    const last = bestEntries[bestEntries.length - 1];
    if (last && !last.skipped && (last.raw || '').trim() === targetRow) {
      return unchanged('already-applied');
    }

    const flags = Array.from({ length: occ }, (_unused, i) => i === bestIdx);
    let inserted = false;
    const next = _transformExerciseBlocks(text, flags, (pending, eligible) => {
      if (!eligible || inserted) return;
      inserted = true;
      // Insert right after the block's last non-blank line, so trailing blank
      // lines (and every other existing line) are preserved untouched.
      let i = pending.length;
      while (i > 0 && pending[i - 1].trim() === '') i--;
      pending.splice(i, 0, targetRow);
    });
    if (!inserted || next === text) return unchanged('no-insertion-point');
    return finalize(next, 'appended');
  }

  // No usable exercise in the note: synthesize a new block. The header uses the
  // accepted NO-SPACE dash form ("-Name") and canonical rep-prescription
  // grammar, preferring the user's own declared rep range when the record
  // carries one.
  const repRange = suggestion.evidence && suggestion.evidence.rep_range;
  const headerSets = repRange && Number.isInteger(repRange.sets) && repRange.sets > 0
    ? repRange.sets : setCount;
  const declaration = repRange && repRange.lo != null && repRange.hi != null
    ? `${headerSets}x${repRange.lo}-${repRange.hi}`
    : `${setCount}x${repCount}`;
  const header = `-${name}: ${declaration}`;
  const prefix = text.length === 0 ? '' : (text.endsWith('\n') ? text : `${text}\n`);
  return finalize(`${prefix}${header}\n${targetRow}`, 'synthesized');
}

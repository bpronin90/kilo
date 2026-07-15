import { parseWorkoutRow } from './workoutRow.js';

// Upper bound on untrusted note text fed to the per-line parser. Real workout
// notes are at most a few KB; this cap (~200KB, thousands of lines) sits far
// above any legitimate note but bounds the work an attacker-influenced payload
// can force. Oversized input is rejected before the per-line split/loop so a
// pathological paste or synced note cannot freeze the device. Reused on the
// cloud recompute path so synced remote rows cannot bypass the limit.
export const MAX_RAW_TEXT_LENGTH = 200000;

const _DAY_RE = /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i;
const _EXERCISE_DASH_RE = /^-([^-\s].*)/;
const _SESSION_ENTRY_RE = /^-\s+(.+)/;
const _EXERCISE_NUMBERED_RE = /^(\d+[a-z]?)\.\s+(.+)/i;
const _EXERCISE_CORE_RE = /^Core:\s+(.+)/i;
const _DELOAD_RE = /^([^:+\d-][^:]*?):\s+(\d+(?:\.\d+)?)\s+lbs?\s+(\d+)x(\d+)\s*$/i;
const _NON_WEIGHT_RE = /\b(treadmill|bike|bicycle|cycling|elliptical|run|walk|swim|cardio|rowing machine|ski erg)\b/i;

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
  if (!noteText || noteText.trim() === '') return { ok: true, sections: [], weekBStartIndex: null };

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
    };
  }

  const sections = [];
  let currentDay = null;
  let currentSection = null;
  let currentExercise = null;
  let currentExerciseNonWeight = false;
  let weekBStartIndex = null;

  function flushExercise() {
    if (currentExercise && currentSection) {
      currentExercise.sets = currentExercise.rows.flatMap(r => r.sets);
      currentSection.exercises.push(currentExercise);
      currentExercise = null;
      currentExerciseNonWeight = false;
    }
  }

  function flushSection() {
    flushExercise();
    if (currentSection) {
      sections.push(currentSection);
      currentSection = null;
    }
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
    currentExerciseNonWeight = _NON_WEIGHT_RE.test(name);
  }

  for (const rawLine of noteText.split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

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
        if (last && !last.skipped && !last.bare) {
          if (!last.comments) last.comments = [];
          last.comments.push(trimmed.slice(2).trim());
        } else {
          currentExercise.unparsed_rows.push(trimmed);
        }
      }
      continue;
    }

    const dashMatch = _EXERCISE_DASH_RE.exec(trimmed);
    if (dashMatch) {
      startExercise(_normalizeExerciseName(dashMatch[1].trim()), trimmed);
      continue;
    }

    const numberedMatch = _EXERCISE_NUMBERED_RE.exec(trimmed);
    if (numberedMatch) {
      startExercise(_normalizeExerciseName(numberedMatch[2].trim()), trimmed);
      continue;
    }

    const coreMatch = _EXERCISE_CORE_RE.exec(trimmed);
    if (coreMatch) {
      startExercise(_normalizeExerciseName('Core: ' + coreMatch[1].trim()), trimmed);
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
        rows: [{ raw: trimmed, sets: dlSets }],
        sets: dlSets,
        session_entries: [],
        unparsed_rows: [],
      });
      continue;
    }

    if (currentExercise) {
      const sessionEntryMatch = _SESSION_ENTRY_RE.exec(trimmed);

      if (currentExerciseNonWeight) {
        currentExercise.unparsed_rows.push(trimmed);
        if (sessionEntryMatch) {
          currentExercise.session_entries.push({ skipped: false, raw: sessionEntryMatch[1].trim(), sets: [], unparsed: true });
        }
      } else if (sessionEntryMatch) {
        const entryRaw = sessionEntryMatch[1].trim();
        const rowResult = parseWorkoutRow(entryRaw);
        if (rowResult.ok && !rowResult.blank && !rowResult.skipped) {
          const offset = currentExercise.rows.reduce((sum, r) => sum + r.sets.length, 0);
          const reindexed = rowResult.sets.map(s => ({ ...s, set_index: offset + s.set_index }));
          currentExercise.rows.push({ raw: entryRaw, sets: reindexed });
          currentExercise.session_entries.push({ skipped: false, raw: entryRaw, sets: reindexed });
        } else if (rowResult.skipped) {
          currentExercise.session_entries.push({ skipped: true, raw: entryRaw, sets: [] });
        } else if (!rowResult.blank) {
          currentExercise.unparsed_rows.push(entryRaw);
          currentExercise.session_entries.push({ skipped: false, raw: entryRaw, sets: [], unparsed: true });
        }
      } else {
        const rowResult = parseWorkoutRow(trimmed);
        if (rowResult.ok && !rowResult.blank && !rowResult.skipped) {
          const offset = currentExercise.rows.reduce((sum, r) => sum + r.sets.length, 0);
          const reindexed = rowResult.sets.map(s => ({ ...s, set_index: offset + s.set_index }));
          currentExercise.rows.push({ raw: trimmed, sets: reindexed });
          // bare: true marks this as a plain row so -- comment lines still fall through to unparsed_rows
          currentExercise.session_entries.push({ skipped: false, raw: trimmed, sets: reindexed, bare: true });
        } else if (!rowResult.blank && !rowResult.skipped) {
          currentExercise.unparsed_positions.push({ pos: currentExercise.session_entries.length, raw: trimmed });
          currentExercise.unparsed_rows.push(trimmed);
        }
      }
    }
  }

  flushSection();
  return { ok: true, sections, weekBStartIndex };
}

// Shared line-classifier for the skip-week transforms below: matches the
// same section/exercise boundary lines parseWorkoutNote uses, so occurrence
// order lines up with `sections[*].exercises` order.
function _isExerciseHeaderLine(t) {
  return (
    /^-([^-\s].*)/.test(t) ||
    /^(\d+[a-z]?)\.\s+.+/i.test(t) ||
    /^Core:\s+.+/i.test(t)
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

    if (t === '---' ||
        /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(t) ||
        t.startsWith('+')) {
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

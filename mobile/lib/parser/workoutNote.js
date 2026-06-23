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

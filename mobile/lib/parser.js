// Kilo freeform input parser — ES module, no window globals

export function parseWeightEntry(raw) {
  if (!raw || raw.trim() === '') {
    return { ok: false, raw: raw || '', error: 'Weight is required', category: 'missing_required_field' };
  }
  const trimmed = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return { ok: false, raw, error: 'Enter a number only (e.g. 180 or 180.4)', category: 'invalid_field_value' };
  }
  const value = parseFloat(trimmed);
  if (value <= 0) {
    return { ok: false, raw, error: 'Weight must be greater than zero', category: 'invalid_field_value' };
  }
  return { ok: true, raw, weight_value: value, weight_unit: 'lb', logged_at: new Date().toISOString() };
}

// Accepted forms: '-' | <rep-group> | (<load> <rep-group>)+
// Standalone rep-group requires at least one comma to be unambiguous.
export function parseWorkoutRow(raw) {
  if (!raw || raw.trim() === '') return { ok: true, blank: true };
  const trimmed = raw.trim();
  if (trimmed === '-') return { ok: true, skipped: true };

  const normalized = trimmed.replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ');
  const tokens = normalized.split(' ');

  if (tokens[0].includes(',')) {
    if (tokens.length !== 1) {
      return { ok: false, raw, error: 'Unrecognized format — use: reps,reps or weight reps,reps', category: 'invalid_field_value' };
    }
    if (!/^\d+(,\d+)+$/.test(tokens[0])) {
      return { ok: false, raw, error: 'Invalid rep group — use: 8,8,8 (no trailing comma)', category: 'invalid_field_value' };
    }
    const reps = tokens[0].split(',').map(n => parseInt(n, 10));
    if (reps.some(r => r <= 0)) {
      return { ok: false, raw, error: 'Rep counts must be positive integers', category: 'invalid_field_value' };
    }
    return {
      ok: true, skipped: false,
      sets: reps.map((rep_count, i) => ({
        set_index: i + 1, rep_count,
        weight_value: null, weight_unit: null,
        duration_seconds: null, assistance_value: null, assistance_unit: null, note_text: null,
      })),
    };
  }

  if (tokens.length === 1) {
    return { ok: false, raw, error: 'Enter reps as reps,reps or weight reps,reps', category: 'invalid_field_value' };
  }

  const LOAD_RE = /^\d+(\.\d+)?$/;
  const REP_RE = /^\d+(,\d+)*$/;
  const sets = [];
  let set_index = 1;
  let i = 0;
  while (i < tokens.length) {
    const load_tok = tokens[i];
    if (!LOAD_RE.test(load_tok)) {
      return { ok: false, raw, error: `Unrecognized input "${load_tok}" — use: weight reps,reps`, category: 'invalid_field_value' };
    }
    const weight = parseFloat(load_tok);
    if (weight <= 0) {
      return { ok: false, raw, error: 'Weight must be greater than zero', category: 'invalid_field_value' };
    }
    i++;
    if (i >= tokens.length) {
      return { ok: false, raw, error: `Missing reps after weight ${weight}`, category: 'structural_violation' };
    }
    const rep_tok = tokens[i];
    if (!REP_RE.test(rep_tok)) {
      return { ok: false, raw, error: `Invalid reps "${rep_tok}" — use: 8 or 8,8,8`, category: 'invalid_field_value' };
    }
    const reps = rep_tok.split(',').map(n => parseInt(n, 10));
    if (reps.some(r => r <= 0)) {
      return { ok: false, raw, error: 'Rep counts must be positive integers', category: 'invalid_field_value' };
    }
    i++;
    for (const rep_count of reps) {
      sets.push({
        set_index: set_index++, rep_count,
        weight_value: weight, weight_unit: 'lb',
        duration_seconds: null, assistance_value: null, assistance_unit: null, note_text: null,
      });
    }
  }
  return { ok: true, skipped: false, sets };
}

// ── parseWorkoutNote ──────────────────────────────────────────────────────────
// Parses a long freeform workout note (multi-session, multi-day) into stable
// exercise blocks. Never fails — ambiguous lines degrade to unparsed_rows.
//
// Returns:
//   { ok: true, sections: Section[] }
//   Section: { heading, subheading, kind, exercises: Exercise[] }
//   Exercise: { name, raw_header, rows: Row[], sets: Set[], unparsed_rows: string[] }
//   Row: { raw, sets: Set[] }
//   Set: canonical set shape (set_index, rep_count, weight_value, weight_unit, ...)

const _DAY_RE = /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i;
const _EXERCISE_DASH_RE = /^-([^-\s].*)/;
const _EXERCISE_NUMBERED_RE = /^(\d+[a-z]?)\.\s+(.+)/i;
const _EXERCISE_CORE_RE = /^Core:\s+(.+)/i;
// Deload format: "Name: weight lbs NxM"
const _DELOAD_RE = /^([^:+\d-][^:]*?):\s+(\d+(?:\.\d+)?)\s+lbs?\s+(\d+)x(\d+)\s*$/i;
// Non-weight cardio exercises — rows degrade to unparsed_rows instead of fake weighted sets
const _NON_WEIGHT_RE = /\b(treadmill|bike|bicycle|cycling|elliptical|run|walk|swim|cardio|rowing machine|ski erg)\b/i;

function _normalizeExerciseName(raw) {
  let name = raw
    .replace(/\s*\|.*$/, '')                         // drop "| rest notes"
    .replace(/\s+@\d[\d.]*\S*.*$/, '')               // drop "@weight ..."
    .replace(/\s*:\s*\d+[xX×][\d\s\-–]+.*$/, '')    // drop ": 3x6-8 ..."
    .replace(/\s+\*.*$/, '')                         // drop "* annotation"
    .replace(/\s+\d+[xX×][\d][\d\-–]*\S*$/, '')     // drop trailing "4x6-8"
    .replace(/\s+\d+\s+\d+[-–]\d+$/, '')             // drop trailing "2 8-10"
    .replace(/:\s*$/, '')                             // drop trailing colon
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
  if (!noteText || noteText.trim() === '') return { ok: true, sections: [] };

  const sections = [];
  let currentDay = null;
  let currentSection = null;
  let currentExercise = null;
  let currentExerciseNonWeight = false;

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
    currentExercise = { name, raw_header: rawHeader, rows: [], unparsed_rows: [] };
    currentExerciseNonWeight = _NON_WEIGHT_RE.test(name);
  }

  for (const rawLine of noteText.split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (/^-\s*$/.test(trimmed)) continue;

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
      if (currentExercise) currentExercise.unparsed_rows.push(trimmed);
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
        unparsed_rows: [],
      });
      continue;
    }

    if (currentExercise) {
      if (currentExerciseNonWeight) {
        currentExercise.unparsed_rows.push(trimmed);
      } else {
        const rowResult = parseWorkoutRow(trimmed);
        if (rowResult.ok && !rowResult.blank && !rowResult.skipped) {
          const offset = currentExercise.rows.reduce((sum, r) => sum + r.sets.length, 0);
          const reindexed = rowResult.sets.map(s => ({ ...s, set_index: offset + s.set_index }));
          currentExercise.rows.push({ raw: trimmed, sets: reindexed });
        } else if (!rowResult.blank && !rowResult.skipped) {
          currentExercise.unparsed_rows.push(trimmed);
        }
      }
    }
  }

  flushSection();
  return { ok: true, sections };
}

// ── Derived analytics ────────────────────────────────────────────────────────
// epleyPR: estimated 1-rep max using Epley formula (weight * (1 + reps / 30))
// Returns null when weight or reps are absent or non-positive.
export function epleyPR(weight, reps) {
  if (!weight || !reps || weight <= 0 || reps <= 0) return null;
  return weight * (1 + reps / 30);
}

// deriveWorkoutAnalytics: aggregates parseWorkoutNote sections into
// per-exercise analytics records.
//
// Input: sections array from parseWorkoutNote (sections[].exercises[].rows/sets)
// Output: { exercises: DerivedExercise[] }
//
// DerivedExercise: {
//   name,
//   occurrences: [{ heading, subheading, kind, rows, sets, unparsed_rows }],
//   sets: Set[],               — all sets flattened across occurrences
//   rows: Row[],               — all rows flattened (line-level context for repeatability)
//   unparsed_rows: string[],   — all unparsed lines flattened (non-weight/cardio context)
//   set_prs: [{ set, epley_pr, occurrence_index }],
//   estimated_pr: number | null  — best eligible Epley across all sets
// }
export function deriveWorkoutAnalytics(sections) {
  const byName = new Map();

  for (const section of sections) {
    const { heading, subheading, kind, exercises } = section;
    for (const ex of exercises) {
      if (!byName.has(ex.name)) {
        byName.set(ex.name, { name: ex.name, occurrences: [], sets: [], rows: [], unparsed_rows: [] });
      }
      const derived = byName.get(ex.name);
      derived.occurrences.push({ heading, subheading, kind, rows: ex.rows, sets: ex.sets, unparsed_rows: ex.unparsed_rows });
      for (const s of ex.sets) derived.sets.push(s);
      for (const r of ex.rows) derived.rows.push(r);
      for (const u of ex.unparsed_rows) derived.unparsed_rows.push(u);
    }
  }

  const exercises = [];
  for (const derived of byName.values()) {
    const set_prs = [];
    for (let oi = 0; oi < derived.occurrences.length; oi++) {
      for (const set of derived.occurrences[oi].sets) {
        set_prs.push({ set, epley_pr: epleyPR(set.weight_value, set.rep_count), occurrence_index: oi });
      }
    }
    let estimated_pr = null;
    for (const { epley_pr } of set_prs) {
      if (epley_pr !== null && (estimated_pr === null || epley_pr > estimated_pr)) {
        estimated_pr = epley_pr;
      }
    }
    exercises.push({ name: derived.name, occurrences: derived.occurrences, sets: derived.sets, rows: derived.rows, unparsed_rows: derived.unparsed_rows, set_prs, estimated_pr });
  }

  return { exercises };
}

// deriveTrackedPRs: filter deriveWorkoutAnalytics output to a caller-supplied
// list of tracked exercise names. Exercises absent from the note return null.
//
// Input: sections from parseWorkoutNote, trackedNames string[]
// Output: { exercises: [{ name, estimated_pr }] } in trackedNames order
export function deriveTrackedPRs(sections, trackedNames) {
  const uniqueNames = [...new Set(trackedNames)];
  const { exercises } = deriveWorkoutAnalytics(sections);
  const byName = new Map(exercises.map(e => [e.name, e]));
  return {
    exercises: uniqueNames.map(name => ({
      name,
      estimated_pr: byName.has(name) ? byName.get(name).estimated_pr : null,
    })),
  };
}

// ── Progression and repeatability signals ────────────────────────────────────

// Best Epley PR for one occurrence.
function _occurrencePR(occurrence) {
  let best = null;
  for (const s of occurrence.sets) {
    const pr = epleyPR(s.weight_value, s.rep_count);
    if (pr !== null && (best === null || pr > best)) best = pr;
  }
  return best;
}

// Count of sets at the maximum weight in one occurrence.
// Returns null when the occurrence has no weighted sets.
function _occurrenceRepeatabilityScore(occurrence) {
  const weighted = occurrence.sets.filter(s => s.weight_value !== null && s.weight_value > 0);
  if (weighted.length === 0) return null;
  const maxWeight = Math.max(...weighted.map(s => s.weight_value));
  return weighted.filter(s => s.weight_value === maxWeight).length;
}

// deriveProgressionSignals: progression status and repeatability context for tracked exercises.
//
// Compares the latest occurrence against the most recent prior occurrence with a computable PR.
// Also surfaces how many sets were at the top weight in the latest session (repeatability_score),
// so a line like "305 6,6,4 295 6" registers stronger evidence than a lone "305 6".
//
// Input: sections from parseWorkoutNote, trackedNames string[]
// Output: { exercises: ProgressionSignal[] }
//
// ProgressionSignal: {
//   name: string,
//   progression_status: 'improved' | 'held' | 'regressed' | 'first_session' | null,
//   latest_pr: number | null,
//   prior_pr: number | null,
//   repeatability_score: number | null,
// }
export function deriveProgressionSignals(sections, trackedNames) {
  const uniqueNames = [...new Set(trackedNames)];
  const { exercises } = deriveWorkoutAnalytics(sections);
  const byName = new Map(exercises.map(e => [e.name, e]));

  return {
    exercises: uniqueNames.map(name => {
      const absent = { name, progression_status: null, latest_pr: null, prior_pr: null, repeatability_score: null };
      if (!byName.has(name)) return absent;
      const ex = byName.get(name);
      const occs = ex.occurrences;
      if (occs.length === 0) return absent;

      // Walk backward to find the two most recent occurrences with computable PRs.
      let latestIdx = -1;
      let priorIdx = -1;
      for (let i = occs.length - 1; i >= 0; i--) {
        if (_occurrencePR(occs[i]) !== null) {
          if (latestIdx === -1) latestIdx = i;
          else { priorIdx = i; break; }
        }
      }

      if (latestIdx === -1) return absent;

      const latestOcc = occs[latestIdx];
      const latest_pr = _occurrencePR(latestOcc);
      const repeatability_score = _occurrenceRepeatabilityScore(latestOcc);

      if (priorIdx === -1) {
        return { name, progression_status: 'first_session', latest_pr, prior_pr: null, repeatability_score };
      }

      const prior_pr = _occurrencePR(occs[priorIdx]);
      const progression_status = latest_pr > prior_pr ? 'improved'
                                : latest_pr < prior_pr ? 'regressed'
                                : 'held';

      return { name, progression_status, latest_pr, prior_pr, repeatability_score };
    }),
  };
}

// ── parseWorkoutEntry ─────────────────────────────────────────────────────────
// items: array of { exerciseName: string, raw: string }
// workout_date: YYYY-MM-DD; defaults to today's UTC date if omitted
export function parseWorkoutEntry(items, workout_date) {
  const date = workout_date || new Date().toISOString().slice(0, 10);
  const parsedItems = [];
  const rowErrors = [];

  for (const { exerciseName, raw } of items) {
    const row = parseWorkoutRow(raw);
    if (row.blank || row.skipped) continue;
    if (!row.ok) {
      rowErrors.push({ exerciseName, error: row.error, category: row.category });
      continue;
    }
    parsedItems.push({
      exercise_name: exerciseName,
      result_kind: 'sets',
      note_text: null,
      position: parsedItems.length + 1,
      sets: row.sets,
    });
  }

  if (rowErrors.length > 0) {
    return { ok: false, error: rowErrors[0].error, category: rowErrors[0].category, rowErrors };
  }
  if (parsedItems.length === 0) {
    return { ok: false, error: 'Workout must include at least one completed exercise', category: 'structural_violation' };
  }
  return { ok: true, workout_date: date, items: parsedItems };
}

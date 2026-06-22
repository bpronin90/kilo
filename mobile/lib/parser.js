// Kilo freeform input parser — ES module, no window globals
import { KILO_EXERCISES } from './data/exerciseCatalog.js';

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

// Strip a single leading alphabetic flag (e.g. "F", "Flat", "Cable") when
// immediately followed by a digit. Returns the input unchanged otherwise.
function _stripLeadingFlag(s) {
  const m = /^([A-Za-z]+)\s+(\S.*)$/.exec(s);
  return (m && /^\d/.test(m[2])) ? m[2] : s;
}

// Normalize a workout row string before tokenization.
// Strips trailing *annotation suffixes (PR marks, tempo notes, etc.), then
// splits on " - " to separate parseable set segments from inline prose notes.
// Each segment is flag-stripped and validated (must consist only of digits,
// commas, dots, and spaces). Valid segments are joined; prose is dropped.
// Falls back to the original trimmed string if no segments are parseable.
function _preprocessWorkoutRow(trimmed) {
  // Drop trailing "* ..." or "*word" annotations (same rule as exercise name normalization)
  const noAnnotation = trimmed.replace(/\s+\*.*$/, '').trim();
  if (!noAnnotation.includes(' - ')) return _stripLeadingFlag(noAnnotation);

  const parseable = [];
  for (const seg of noAnnotation.split(' - ')) {
    const stripped = _stripLeadingFlag(seg.trim());
    if (/^[\d.,\s]+$/.test(stripped)) parseable.push(stripped.trim());
  }
  return parseable.length > 0 ? parseable.join(' ') : noAnnotation;
}

// Accepted forms: '-' | <rep-group> | (<load> <rep-group>)+
// Standalone rep-group requires at least one comma to be unambiguous.
export function parseWorkoutRow(raw) {
  if (!raw || raw.trim() === '') return { ok: true, blank: true };
  const trimmed = raw.trim();
  if (trimmed === '-') return { ok: true, skipped: true };

  const preprocessed = _preprocessWorkoutRow(trimmed);
  // ", " can be a pair separator ("90 10, 70 10,10") or a spaced rep-group
  // separator ("135 8, 8, 8"). Disambiguate: split on ", " and check whether
  // every subsequent chunk contains a space (weight+reps pair shape). If so,
  // join with " " (pair separator). Otherwise collapse the ", " to "," (rep group).
  let pairNormalized = preprocessed;
  if (preprocessed.includes(', ')) {
    const chunks = preprocessed.split(', ');
    const allSubsequentArePairs = chunks.slice(1).every(c => c.includes(' '));
    pairNormalized = allSubsequentArePairs ? chunks.join(' ') : chunks.join(',');
  }
  const normalized = pairNormalized.replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ');
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
  // A rep token is a comma-separated group whose members are positive integers
  // or "-", a skipped set at this weight (e.g. "80 4,-" → a set of 4 then a
  // skipped set, both at 80 lb).
  const REP_RE = /^(\d+|-)(,(\d+|-))*$/;
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
    // null marks a skipped set ("-"); real reps must be positive integers.
    const reps = rep_tok.split(',').map(n => (n === '-' ? null : parseInt(n, 10)));
    if (reps.some(r => r !== null && r <= 0)) {
      return { ok: false, raw, error: 'Rep counts must be positive integers', category: 'invalid_field_value' };
    }
    i++;
    for (const rep_count of reps) {
      sets.push({
        set_index: set_index++,
        rep_count: rep_count === null ? 0 : rep_count,
        ...(rep_count === null ? { skipped: true } : null),
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
// Session entry line: "- data" (dash-space-content within an exercise block)
const _SESSION_ENTRY_RE = /^-\s+(.+)/;
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
  if (!noteText || noteText.trim() === '') return { ok: true, sections: [], weekBStartIndex: null };

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

    // Bare dash: session skip slot in exercise context (including non-weight), silently dropped otherwise
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

// ── buildSessionsFromNote ─────────────────────────────────────────────────────
// Aligns exercise session_entries by position across the whole note.
// Section/day boundaries and warmup/lift distinctions are ignored for session
// construction — only the positional order of `- entry` lines matters.
//
// Returns:
//   { sessions: Session[], warnings: string[] }
//   Session: { session_index: number, entries: SessionEntry[] }
//   SessionEntry: { exercise_name: string, entry: { raw, sets, skipped, unparsed? } }
export function buildSessionsFromNote(noteText) {
  const { sections } = parseWorkoutNote(noteText || '');

  // Collect all exercises across all sections, preserving declaration order
  const allExercises = sections.flatMap(s => s.exercises);

  // Only exercises that have at least one explicit session entry participate
  const withEntries = allExercises.filter(e => e.session_entries.length > 0);

  if (withEntries.length === 0) return { sessions: [], warnings: [] };

  const counts = withEntries.map(e => e.session_entries.length);
  const maxCount = Math.max(...counts);
  const minCount = Math.min(...counts);

  const warnings = [];
  if (minCount !== maxCount) {
    const details = withEntries.map(e => `${e.name} (${e.session_entries.length})`).join(', ');
    warnings.push(
      `Uneven entry counts — ${details}. Check your note for missing or extra entries and correct before logging.`
    );
  }

  const sessions = Array.from({ length: maxCount }, (_, i) => ({
    session_index: i + 1,
    entries: withEntries.map(ex => ({
      exercise_name: ex.name,
      entry: i < ex.session_entries.length
        ? ex.session_entries[i]
        : { skipped: true, raw: null, sets: [] },
    })),
  }));

  return { sessions, warnings };
}

// ── countWorkoutSessionsFromSections ─────────────────────────────────────────
// Returns the session count from an already-parsed sections array.
// Groups sections by day heading so warmup + lifting on the same day count as
// one session. Counts logged sessions per exercise as the max of rows.length
// and non-skipped session_entries.length — rows covers weight exercises while
// non-skipped session_entries covers non-weight exercises (e.g. Bike) that
// populate session_entries but never rows. Skip markers are excluded from both.
export function countWorkoutSessionsFromSections(sections) {
  const byDay = new Map();
  for (const section of sections) {
    const day = section.heading ?? '__no_day__';
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(section);
  }
  let max = 0;
  for (const daySections of byDay.values()) {
    let dayMax = 0;
    for (const section of daySections) {
      for (const ex of section.exercises) {
        const nonSkipped = (ex.session_entries || []).filter(e => !e.skipped).length;
        const count = Math.max((ex.rows || []).length, nonSkipped);
        if (count > dayMax) dayMax = count;
      }
    }
    if (dayMax > max) max = dayMax;
  }
  return max;
}

// ── countWorkoutSessions ──────────────────────────────────────────────────────
// Returns the workout session count for the current workout note.
// Delegates to countWorkoutSessionsFromSections for day-aware session counting.
export function countWorkoutSessions(noteText) {
  const { sections } = parseWorkoutNote(noteText || '');
  return countWorkoutSessionsFromSections(sections);
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
      const key = normalizeExerciseKey(ex.name);
      if (!byName.has(key)) {
        byName.set(key, { name: _canonicalizeName(ex.name), occurrences: [], sets: [], rows: [], unparsed_rows: [] });
      }
      const derived = byName.get(key);
      derived.occurrences.push({ heading, subheading, kind, rows: ex.rows, sets: ex.sets, unparsed_rows: ex.unparsed_rows, session_entries: ex.session_entries });
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
    let latest_pr = null;
    const last_oi = derived.occurrences.length - 1;
    for (const { epley_pr, occurrence_index } of set_prs) {
      if (epley_pr !== null && (estimated_pr === null || epley_pr > estimated_pr)) {
        estimated_pr = epley_pr;
      }
      if (occurrence_index === last_oi && epley_pr !== null && (latest_pr === null || epley_pr > latest_pr)) {
        latest_pr = epley_pr;
      }
    }
    exercises.push({ name: derived.name, occurrences: derived.occurrences, sets: derived.sets, rows: derived.rows, unparsed_rows: derived.unparsed_rows, set_prs, estimated_pr, latest_pr });
  }

  return { exercises };
}

// ── Exercise alias resolution ─────────────────────────────────────────────────
// Deterministic table: canonical name → lowercase alias variants.
// Canonicalization happens at grouping time in deriveWorkoutAnalytics so that
// mixed-name history (e.g. "DB Bench Press" one week, "DB Bench" the next) is
// merged into one bucket and never splits progression or 1k calculations.
const _EXERCISE_ALIASES = new Map([
  ['DB Bench Press',           ['db bench', 'dumbbell bench press', 'dumbbell bench', 'db bench press']],
  ['Bench Press',              ['bb bench press', 'barbell bench press', 'barbell bench']],
  ['Incline DB Press',         ['incline dumbbell press', 'incline db', 'incline press', 'incline db bench', 'incline bench']],
  ['Squat',                    ['back squat', 'barbell squat', 'bb squat', 'low bar squat', 'high bar squat', 'low-bar squat', 'high-bar squat']],
  ['Deadlift',                 ['deadlifts', 'dl', 'conventional deadlift', 'barbell deadlift', 'bb deadlift', 'conv deadlift', 'conv. deadlift']],
  ['RDL',                      ['romanian deadlift', 'romanian dl', 'rdls']],
  ['Hammer Strength Iso Row',  ['hs iso row', 'iso row', 'hs row']],
  ['Lat Pulldown',             ['lat pd', 'lat pulldowns', 'pulldowns']],
]);

function _canonicalizeName(name) {
  const lower = name.toLowerCase().trim();
  for (const [canonical, aliases] of _EXERCISE_ALIASES) {
    if (canonical.toLowerCase() === lower) return canonical;
    if (aliases.includes(lower)) return canonical;
  }
  return name;
}

// Full normalization chain: resolve aliases then lowercase+trim+collapse whitespace.
// Use this as the single canonical key for all exercise name comparisons and map keys.
export function normalizeExerciseKey(name) {
  if (!name) return '';
  return _canonicalizeName(name).trim().replace(/\s+/g, ' ').toLowerCase();
}

// Looks up a target name in an analytics exercises array using canonical keys.
function _findExercise(exercises, targetName) {
  const key = normalizeExerciseKey(targetName);
  return exercises.find(e => normalizeExerciseKey(e.name) === key) || null;
}

// deriveTrackedPRs: filter deriveWorkoutAnalytics output to a caller-supplied
// list of tracked exercise names. Exercises absent from the note return null.
// Supports alias matching so note variants like "DB Bench" resolve to "DB Bench Press".
//
// Input: sections from parseWorkoutNote, trackedNames string[]
// Output: { exercises: [{ name, estimated_pr, latest_pr }] } in trackedNames order
export function deriveTrackedPRs(sections, trackedNames) {
  const uniqueNames = [...new Set(trackedNames)];
  const { exercises } = deriveWorkoutAnalytics(sections);
  return {
    exercises: uniqueNames.map(name => {
      const match = _findExercise(exercises, name);
      return { 
        name, 
        estimated_pr: match ? match.estimated_pr : null,
        latest_pr: match ? match.latest_pr : null
      };
    }),
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

// Highest completed weight_value in one occurrence.
function _occurrenceTopWeight(occurrence) {
  const weighted = occurrence.sets.filter(s => s.weight_value !== null && s.weight_value > 0);
  if (weighted.length === 0) return null;
  return Math.max(...weighted.map(s => s.weight_value));
}

// Build the session-level comparable list from an occurrences array.
// Each occurrence is expanded per-session-entry when present, then per-row, then falls back to the occurrence itself.
function _buildComparable(occs) {
  return occs.flatMap(occ => {
    const valid = (occ.session_entries || []).filter(se => !se.skipped && !se.unparsed);
    if (valid.length > 0) return valid.map(se => ({ sets: se.sets }));
    const rows = (occ.rows || []).filter(r => r.sets && r.sets.length > 0);
    if (rows.length > 0) return rows.map(r => ({ sets: r.sets }));
    return occ.sets && occ.sets.length > 0 ? [occ] : [];
  });
}

// Derive signal fields from a comparable list (session-level units with .sets).
// Returns { latest_pr, prior_pr, latest_top_weight, overload_trend, progression_status, is_bodyweight, repeatability_score }
// or null when the comparable list is empty or carries no usable data.
function _deriveSignalForComparables(comparable) {
  if (comparable.length === 0) return null;

  // Walk backward to find the two most recent units with computable PRs.
  let latestIdx = -1;
  let priorIdx = -1;
  for (let i = comparable.length - 1; i >= 0; i--) {
    if (_occurrencePR(comparable[i]) !== null) {
      if (latestIdx === -1) latestIdx = i;
      else { priorIdx = i; break; }
    }
  }

  if (latestIdx === -1) {
    // Rep-only (bodyweight) fallback: use total reps per session as the comparable metric.
    const repTotals = comparable.map(unit =>
      unit.sets.reduce((sum, s) => sum + (s.rep_count || 0), 0)
    );
    const latestReps = repTotals[repTotals.length - 1];
    if (!latestReps) return null;
    const latestBestSet = Math.max(...comparable[comparable.length - 1].sets.map(s => s.rep_count || 0));
    const priorReps = repTotals.length > 1 ? repTotals[repTotals.length - 2] : null;
    const progression_status = priorReps === null ? 'first_session'
      : latestReps > priorReps ? 'improved' : latestReps < priorReps ? 'regressed' : 'held';
    const overload_trend = priorReps === null ? null
      : latestReps > priorReps ? 'up' : latestReps < priorReps ? 'down' : 'flat';
    return { latest_pr: null, prior_pr: null, latest_top_weight: latestBestSet || null, overload_trend, progression_status, is_bodyweight: true, repeatability_score: null };
  }

  const latestOcc = comparable[latestIdx];
  const latest_pr = _occurrencePR(latestOcc);
  const repeatability_score = _occurrenceRepeatabilityScore(latestOcc);
  const latest_top_weight = _occurrenceTopWeight(latestOcc);

  if (priorIdx === -1) {
    return { latest_pr, prior_pr: null, latest_top_weight, overload_trend: 'first_session', progression_status: 'first_session', is_bodyweight: false, repeatability_score };
  }

  const prior_pr = _occurrencePR(comparable[priorIdx]);
  const prior_top_weight = _occurrenceTopWeight(comparable[priorIdx]);
  const progression_status = latest_pr > prior_pr ? 'improved'
                            : latest_pr < prior_pr ? 'regressed'
                            : 'held';

  const latest_total_reps = latestOcc.sets.reduce((sum, s) => sum + (s.rep_count || 0), 0);
  const prior_total_reps = comparable[priorIdx].sets.reduce((sum, s) => sum + (s.rep_count || 0), 0);
  const weight_diff = latest_top_weight !== null && prior_top_weight !== null
    ? latest_top_weight - prior_top_weight : null;
  const overload_trend = weight_diff === null ? null
    : weight_diff > 0 ? 'up'
    : weight_diff < 0 ? 'down'
    : latest_total_reps > prior_total_reps ? 'up'
    : latest_total_reps < prior_total_reps ? 'down'
    : 'flat';

  return { latest_pr, prior_pr, latest_top_weight, overload_trend, progression_status, is_bodyweight: false, repeatability_score };
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
//   kilo_max: number | null,          — all-time best Epley across all occurrences
//   repeatability_score: number | null,
//   latest_top_weight: number | null, — highest completed weight_value in latest occurrence
//   overload_trend: 'up' | 'flat' | 'down' | 'first_session' | null,
// }
export function deriveProgressionSignals(sections, trackedNames) {
  const uniqueNames = [...new Set(trackedNames)];
  const { exercises } = deriveWorkoutAnalytics(sections);

  return {
    exercises: uniqueNames.map(name => {
      const absent = { name, progression_status: null, latest_pr: null, prior_pr: null, kilo_max: null, repeatability_score: null, latest_top_weight: null, overload_trend: null };
      const ex = _findExercise(exercises, name);
      if (!ex) return absent;
      const occs = ex.occurrences;
      if (occs.length === 0) return absent;

      const kilo_max = ex.estimated_pr;
      const comparable = _buildComparable(occs);
      const signal = _deriveSignalForComparables(comparable);
      if (!signal) return absent;

      const { latest_pr, prior_pr, latest_top_weight, overload_trend, progression_status, is_bodyweight, repeatability_score } = signal;
      if (is_bodyweight) {
        return { name, progression_status, latest_pr: null, prior_pr: null, kilo_max: null, repeatability_score: null, latest_top_weight, overload_trend, is_bodyweight: true };
      }
      return { name, progression_status, latest_pr, prior_pr, kilo_max, repeatability_score, latest_top_weight, overload_trend };
    }),
  };
}

// derivePerDaySignals: per-day progression metrics for multi-day exercises.
//
// For each tracked exercise, computes latest_top_weight, latest_pr,
// overload_trend, and is_bodyweight separately for each routine-day heading
// where the exercise appears. Single-day exercises also get an entry so
// callers can use this uniformly without special-casing.
// Rep-only/bodyweight exercises mirror the fallback semantics of
// deriveProgressionSignals: latest_top_weight is the best single-set rep
// count, overload_trend is derived from total rep volume, is_bodyweight: true.
//
// Input: sections from parseWorkoutNote, trackedNames string[]
// Output: { [canonicalName]: { [heading]: { latest_pr, latest_top_weight, overload_trend, is_bodyweight } } }
export function derivePerDaySignals(sections, trackedNames) {
  const uniqueNames = [...new Set(trackedNames)];
  const { exercises } = deriveWorkoutAnalytics(sections);
  const result = {};

  for (const name of uniqueNames) {
    const ex = _findExercise(exercises, name);
    if (!ex) continue;

    const byHeading = new Map();
    for (const occ of ex.occurrences) {
      const heading = occ.heading;
      if (!byHeading.has(heading)) byHeading.set(heading, []);
      byHeading.get(heading).push(occ);
    }

    const dayMap = {};
    for (const [heading, occs] of byHeading) {
      const comparable = _buildComparable(occs);
      const signal = _deriveSignalForComparables(comparable);
      if (!signal) {
        dayMap[heading] = { latest_pr: null, latest_top_weight: null, overload_trend: null, is_bodyweight: false };
        continue;
      }
      const { latest_pr, latest_top_weight, overload_trend, is_bodyweight } = signal;
      // derivePerDaySignals does not expose 'first_session' for overload_trend — callers use null there.
      dayMap[heading] = { latest_pr, latest_top_weight, overload_trend: overload_trend === 'first_session' ? null : overload_trend, is_bodyweight };
    }

    result[normalizeExerciseKey(name)] = dayMap;
  }

  return result;
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

// ── Deload history ────────────────────────────────────────────────────────────

const _DAY_MS = 24 * 60 * 60 * 1000;
const _WEEK_MS = 7 * _DAY_MS;

// UTC midnight epoch for a 'YYYY-MM-DD...' string (time-of-day ignored).
function _utcDayFromIso(iso) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

// Latest-wins deload record by completed_at. Returns null for empty history.
function _latestDeload(deloadHistory) {
  if (!deloadHistory || deloadHistory.length === 0) return null;
  return deloadHistory.reduce((best, r) =>
    !best || r.completed_at > best.completed_at ? r : best, null);
}

// ── sessionDateMapFromNote ────────────────────────────────────────────────────
// Builds the per-session date chronology for the current routine from its stored
// session check-ins. Returns Map<sessionIndex(int), 'YYYY-MM-DD'>.
//
// session_checkins is the only per-session dated anchor in the note model, so it
// is the chronology source for deload-boundary and active-week derivation. Index
// keys are 0-based positions in the session chain (oldest = 0), matching the
// session ordinals counted by countWorkoutSessionsFromSections.
export function sessionDateMapFromNote(note) {
  const out = new Map();
  const checkins = note?.session_checkins;
  if (!checkins) return out;
  for (const [key, ci] of Object.entries(checkins)) {
    if (!ci || !ci.responded_at) continue;
    const idx = Number(key);
    if (!Number.isInteger(idx) || idx < 0) continue;
    out.set(idx, ci.responded_at.slice(0, 10));
  }
  return out;
}

// ── sessionsSinceLastDeload ───────────────────────────────────────────────────
// Sessions logged after the most recently completed deload, excluding the deload
// boundary session itself (so a freshly completed deload reads 0).
//
// When a session-date chronology (dateMap) is supplied, the boundary is located
// from workout chronology relative to the deload's completed_at date: the highest
// session ordinal whose date is on/before the deload date is the boundary, and
// every later ordinal counts as a post-deload session. Sessions are chronological
// by index, so dates are only used to LOCATE the boundary — undated sessions past
// the boundary are still counted by ordinal. This makes editing a past deload
// date move sessions-since-deload in lockstep with weeks-since-deload.
//
// Falls back to the stored session_count snapshot when no chronology is available
// (no dated check-ins), preserving legacy behavior. Returns totalSessions when no
// deload has ever been completed. Clamps to 0.
export function sessionsSinceLastDeload(totalSessions, deloadHistory, dateMap) {
  const latest = _latestDeload(deloadHistory);
  if (!latest) return totalSessions;
  if (dateMap && dateMap.size > 0 && latest.completed_at) {
    const boundary = latest.completed_at.slice(0, 10);
    let boundaryIndex = -1; // highest dated ordinal on/before the deload date
    for (const [idx, day] of dateMap) {
      if (day <= boundary && idx > boundaryIndex) boundaryIndex = idx;
    }
    return Math.max(0, totalSessions - (boundaryIndex + 1));
  }
  return Math.max(0, totalSessions - latest.session_count);
}

// ── weeksSinceLastDeload ──────────────────────────────────────────────────────
// Returns the number of full calendar weeks elapsed since the most recently
// completed deload (by completed_at). Returns null when history is empty.
// Uses the same latest-wins logic as sessionsSinceLastDeload.
//
// Comparison is calendar-date based: the time-of-day in completed_at is ignored
// so that a deload logged late at night on day D still counts as a full week
// once today's UTC date is D+7, regardless of the clock time.
export function weeksSinceLastDeload(deloadHistory) {
  const latest = _latestDeload(deloadHistory);
  if (!latest) return null;
  const deloadDay = _utcDayFromIso(latest.completed_at);
  const now = new Date(Date.now());
  const todayDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const diffMs = todayDay - deloadDay;
  if (diffMs < 0) return 0;
  return Math.floor(diffMs / _WEEK_MS);
}

// The weeks-on-routine metric (elapsedWeeks) and the deriveRoutineStatus
// composite live in lib/data.js (the canonical analytics layer); data.js
// imports the deload primitives above from this module.

// ── Deload generation ─────────────────────────────────────────────────────────

// Heaviest weight with ≥2 sets in the last row; fallback to heaviest weight present.
function _mostRecentWorkingWeight(exercise) {
  const rows = exercise.rows;
  if (rows.length === 0) return null;
  const lastRow = rows[rows.length - 1];
  const weighted = lastRow.sets.filter(s => s.weight_value != null && s.weight_value > 0);
  if (weighted.length === 0) return null;
  const byWeight = new Map();
  for (const s of weighted) byWeight.set(s.weight_value, (byWeight.get(s.weight_value) || 0) + 1);
  const sorted = [...byWeight.entries()].sort((a, b) => b[0] - a[0]);
  for (const [w, count] of sorted) if (count >= 2) return w;
  return sorted[0][0];
}

// If any weight in the exercise history is not a multiple of 5, use 2.5 lb increments; else 5.
function _inferIncrement(exercise) {
  for (const row of exercise.rows) {
    for (const s of row.sets) {
      if (s.weight_value != null && (s.weight_value % 5) !== 0) return 2.5;
    }
  }
  return 5;
}

function _roundToIncrement(weight, increment) {
  return Math.round(weight / increment) * increment;
}

// parseExerciseHeader: extract prescribed set count + rep range from an exercise header line.
// Handles: "4x6-8", "2x12", "* 2x10-12", ": 3x6-8", "2 8-10" (space-separated).
// Returns { sets, repLo, repHi } or null when no pattern is found.
export function parseExerciseHeader(raw_header) {
  if (!raw_header) return null;
  const nxm = /(\d+)\s*[xX×]\s*(\d+)(?:[–\-](\d+))?/.exec(raw_header);
  if (nxm) {
    return {
      sets: parseInt(nxm[1], 10),
      repLo: parseInt(nxm[2], 10),
      repHi: nxm[3] != null ? parseInt(nxm[3], 10) : parseInt(nxm[2], 10),
    };
  }
  const spaced = /(\d+)\s+(\d+)[–\-](\d+)/.exec(raw_header);
  if (spaced) {
    return { sets: parseInt(spaced[1], 10), repLo: parseInt(spaced[2], 10), repHi: parseInt(spaced[3], 10) };
  }
  return null;
}

// generateDeloadNote: produce a deterministic deload week note from a routine note.
// Algorithm: skip warmup sections; for each remaining exercise compute a reduced
// weight (0.65× for PO catalog entries, unchanged otherwise), sets−1 (floor 2),
// and the midpoint rep count; emit as "Name: weight lbs SETSxREPS".
// Core: exercises are emitted as "Core: <short>, easy".
export function generateDeloadNote(routineRawText) {
  const { sections } = parseWorkoutNote(routineRawText);

  const byHeading = [];
  const headingIdx = new Map();

  function pushItem(heading, line) {
    if (!headingIdx.has(heading)) {
      headingIdx.set(heading, byHeading.length);
      byHeading.push({ heading, lines: [] });
    }
    byHeading[headingIdx.get(heading)].lines.push(line);
  }

  for (const section of sections) {
    if (section.kind === 'warmup') continue;
    const heading = section.heading;

    for (const exercise of section.exercises) {
      const isCore = /^Core:/i.test(exercise.name);

      if (isCore) {
        const shortName = exercise.name.replace(/^Core:\s*/i, '').toLowerCase();
        pushItem(heading, `Core: ${shortName}, easy`);
        continue;
      }

      if (exercise.rows.length === 0) continue;

      const workingWeight = _mostRecentWorkingWeight(exercise);
      if (workingWeight === null) continue;

      const headerInfo = parseExerciseHeader(exercise.raw_header);
      let prescribedSets, repLo, repHi;
      if (headerInfo) {
        prescribedSets = headerInfo.sets;
        repLo = headerInfo.repLo;
        repHi = headerInfo.repHi;
      } else {
        const lastRow = exercise.rows[exercise.rows.length - 1];
        prescribedSets = lastRow.sets.length;
        const rowReps = lastRow.sets.map(s => s.rep_count).filter(r => r != null && r > 0);
        repLo = rowReps.length > 0 ? Math.min(...rowReps) : 8;
        repHi = rowReps.length > 0 ? Math.max(...rowReps) : 8;
      }

      const deloadSets = Math.max(2, prescribedSets - 1);
      const deloadReps = Math.ceil((repLo + repHi) / 2);

      const increment = _inferIncrement(exercise);
      const canonKey = normalizeExerciseKey(exercise.name);
      const catalogEntry = KILO_EXERCISES.find(e => normalizeExerciseKey(e.name) === canonKey);

      const deloadWeight = (catalogEntry && catalogEntry.po)
        ? _roundToIncrement(0.65 * workingWeight, increment)
        : workingWeight;

      pushItem(heading, `${exercise.name}: ${deloadWeight} lbs ${deloadSets}x${deloadReps}`);
    }
  }

  const outputLines = [];
  for (const { heading, lines } of byHeading) {
    if (lines.length === 0) continue;
    if (heading) outputLines.push(heading);
    for (const line of lines) outputLines.push(line);
  }
  return outputLines.join('\n');
}

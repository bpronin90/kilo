// parser.jsx — Kilo freeform input parser
// Pure function. Tokenize, alternate weight/rep-group pairs, output structured.

function parseKiloInput(raw) {
  const out = { sets: [], skipped: false, raw: raw || '', warnings: [] };
  if (!raw) return out;
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '-') {
    out.skipped = trimmed === '-';
    return out;
  }
  // Tokenize by whitespace
  const tokens = trimmed.split(/\s+/);
  // Pattern: weight (number) followed by rep-group (comma-separated ints)
  // Alternates: w r w r w r ...
  let i = 0;
  let expecting = 'weight';
  let curWeight = null;
  while (i < tokens.length) {
    const t = tokens[i];
    if (expecting === 'weight') {
      const w = parseFloat(t);
      if (!isNaN(w) && !t.includes(',')) {
        curWeight = w;
        expecting = 'reps';
      } else {
        out.warnings.push(`Expected weight, got "${t}"`);
        i++;
        continue;
      }
    } else {
      // rep group
      if (t.includes(',') || /^\d+$/.test(t)) {
        const reps = t.split(',').map(s => parseInt(s, 10)).filter(n => !isNaN(n));
        if (reps.length > 0) {
          out.sets.push({ weight: curWeight, reps });
        }
        expecting = 'weight';
      } else {
        // maybe a new weight (drop set with no rep group? shouldn't happen but be lenient)
        const w = parseFloat(t);
        if (!isNaN(w)) {
          curWeight = w;
        } else {
          out.warnings.push(`Expected reps, got "${t}"`);
        }
      }
    }
    i++;
  }
  return out;
}

// Format parsed output as compact summary
function formatParsed(parsed) {
  if (parsed.skipped) return 'skipped';
  if (parsed.sets.length === 0) return '—';
  return parsed.sets.map(s => `${s.weight}×${s.reps.join(',')}`).join(' · ');
}

// Total volume
function totalVolume(parsed) {
  return parsed.sets.reduce((sum, s) => sum + s.weight * s.reps.reduce((a, b) => a + b, 0), 0);
}

// Total reps
function totalReps(parsed) {
  return parsed.sets.reduce((sum, s) => sum + s.reps.reduce((a, b) => a + b, 0), 0);
}

// Heaviest set (top weight × top reps at that weight)
function topSet(parsed) {
  if (!parsed.sets.length) return null;
  let topW = 0;
  for (const s of parsed.sets) if (s.weight > topW) topW = s.weight;
  const atTop = parsed.sets.filter(s => s.weight === topW);
  const reps = atTop.flatMap(s => s.reps);
  return { weight: topW, reps, topReps: Math.max(...reps) };
}

// Multi-set adjusted Epley 1RM
function adjusted1RM(parsed) {
  const top = topSet(parsed);
  if (!top) return null;
  // count sets at or near (within 5 lbs) heaviest weight, before fatigue correction
  const nearTop = parsed.sets.filter(s => Math.abs(s.weight - top.weight) <= 5);
  const totalSetsBefore = nearTop.reduce((sum, s) => sum + s.reps.length, 0) - 1; // sets done before the heaviest single
  const fatigueAdd = Math.floor(Math.max(0, totalSetsBefore) / 2);
  const adjReps = top.topReps + fatigueAdd;
  const epleyRaw = top.weight * (1 + top.topReps / 30);
  const epleyAdj = top.weight * (1 + adjReps / 30);
  return {
    weight: top.weight,
    reps: top.topReps,
    adjReps,
    fatigueAdd,
    raw: Math.round(epleyRaw * 10) / 10,
    adjusted: Math.round(epleyAdj * 10) / 10,
  };
}

// Weight-entry parse path (MVP)
// Accepted: ASCII digits with optional single decimal point, surrounding whitespace ignored.
// Rejected: unit suffixes, commas, signs, dates, prose, or empty input.
function parseWeightEntry(raw) {
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

// Workout row parse path (MVP)
// Accepted forms: '-' | <rep-group> | (<load> <rep-group>)+
// load = ASCII digits with optional single decimal point
// rep-group = positive integers separated by commas, no trailing comma
// Standalone rep-group form requires at least one comma to be unambiguous.
function parseWorkoutRow(raw) {
  if (!raw || raw.trim() === '') return { ok: true, blank: true };
  const trimmed = raw.trim();
  if (trimmed === '-') return { ok: true, skipped: true };

  // Normalize spaces around/after commas, collapse repeated spaces
  const normalized = trimmed.replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ');
  const tokens = normalized.split(' ');

  if (tokens[0].includes(',')) {
    // Standalone rep-group form: must be exactly one token with at least one comma
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

  // First token has no comma
  if (tokens.length === 1) {
    // Single number with no comma: ambiguous between load and single-rep rep-group — reject
    return { ok: false, raw, error: 'Enter reps as reps,reps or weight reps,reps', category: 'invalid_field_value' };
  }

  // Parse as alternating <load> <rep-group> pairs
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

// Workout entry parse path (MVP)
// items: array of { exerciseName: string, raw: string }
// workout_date: optional YYYY-MM-DD; defaults to window.KILO_TODAY if available, else current UTC date.
// Returns canonical workout entry shape or error with per-row details.
function parseWorkoutEntry(items, workout_date) {
  const date = workout_date || (typeof window !== 'undefined' && window.KILO_TODAY) || new Date().toISOString().slice(0, 10);

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

// ── parseWorkoutNote ──────────────────────────────────────────────────────────
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

function parseWorkoutNote(noteText) {
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
    currentExercise = { name, raw_header: rawHeader, rows: [], session_entries: [], unparsed_rows: [] };
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
        if (last && !last.skipped) {
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
        } else if (!rowResult.blank && !rowResult.skipped) {
          currentExercise.unparsed_rows.push(trimmed);
        }
      }
    }
  }

  flushSection();
  return { ok: true, sections };
}

function buildSessionsFromNote(noteText) {
  const { sections } = parseWorkoutNote(noteText || '');
  const allExercises = sections.flatMap(s => s.exercises);
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

// epleyPR: estimated 1-rep max using Epley formula (weight * (1 + reps / 30))
function epleyPR(weight, reps) {
  if (!weight || !reps || weight <= 0 || reps <= 0) return null;
  return weight * (1 + reps / 30);
}

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

function _findExercise(exercises, targetName) {
  const canonical = _canonicalizeName(targetName);
  return exercises.find(e => e.name === canonical) || null;
}

function deriveWorkoutAnalytics(sections) {
  const byName = new Map();

  for (const section of sections) {
    const { heading, subheading, kind, exercises } = section;
    for (const ex of exercises) {
      const key = _canonicalizeName(ex.name);
      if (!byName.has(key)) {
        byName.set(key, { name: key, occurrences: [], sets: [], rows: [], unparsed_rows: [] });
      }
      const derived = byName.get(key);
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

function deriveTrackedPRs(sections, trackedNames) {
  const uniqueNames = [...new Set(trackedNames)];
  const { exercises } = deriveWorkoutAnalytics(sections);
  return {
    exercises: uniqueNames.map(name => {
      const match = _findExercise(exercises, name);
      return { name, estimated_pr: match ? match.estimated_pr : null };
    }),
  };
}

function _occurrencePR(occurrence) {
  let best = null;
  for (const s of occurrence.sets) {
    const pr = epleyPR(s.weight_value, s.rep_count);
    if (pr !== null && (best === null || pr > best)) best = pr;
  }
  return best;
}

function _occurrenceRepeatabilityScore(occurrence) {
  const weighted = occurrence.sets.filter(s => s.weight_value !== null && s.weight_value > 0);
  if (weighted.length === 0) return null;
  const maxWeight = Math.max(...weighted.map(s => s.weight_value));
  return weighted.filter(s => s.weight_value === maxWeight).length;
}

function deriveProgressionSignals(sections, trackedNames) {
  const uniqueNames = [...new Set(trackedNames)];
  const { exercises } = deriveWorkoutAnalytics(sections);

  return {
    exercises: uniqueNames.map(name => {
      const absent = { name, progression_status: null, latest_pr: null, prior_pr: null, repeatability_score: null };
      const ex = _findExercise(exercises, name);
      if (!ex) return absent;
      const occs = ex.occurrences;
      if (occs.length === 0) return absent;

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

window.parseKiloInput = parseKiloInput;
window.parseWeightEntry = parseWeightEntry;
window.parseWorkoutRow = parseWorkoutRow;
window.parseWorkoutEntry = parseWorkoutEntry;
window.parseWorkoutNote = parseWorkoutNote;
window.buildSessionsFromNote = buildSessionsFromNote;
window.epleyPR = epleyPR;
window.deriveWorkoutAnalytics = deriveWorkoutAnalytics;
window.deriveTrackedPRs = deriveTrackedPRs;
window.deriveProgressionSignals = deriveProgressionSignals;
window.formatParsed = formatParsed;
window.totalVolume = totalVolume;
window.totalReps = totalReps;
window.topSet = topSet;
window.adjusted1RM = adjusted1RM;

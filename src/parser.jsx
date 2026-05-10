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

window.parseKiloInput = parseKiloInput;
window.parseWeightEntry = parseWeightEntry;
window.parseWorkoutRow = parseWorkoutRow;
window.parseWorkoutEntry = parseWorkoutEntry;
window.formatParsed = formatParsed;
window.totalVolume = totalVolume;
window.totalReps = totalReps;
window.topSet = topSet;
window.adjusted1RM = adjusted1RM;

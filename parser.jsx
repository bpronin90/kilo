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

window.parseKiloInput = parseKiloInput;
window.parseWeightEntry = parseWeightEntry;
window.formatParsed = formatParsed;
window.totalVolume = totalVolume;
window.totalReps = totalReps;
window.topSet = topSet;
window.adjusted1RM = adjusted1RM;

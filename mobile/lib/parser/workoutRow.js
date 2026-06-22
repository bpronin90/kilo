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

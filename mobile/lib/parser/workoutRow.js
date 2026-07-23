// Strip a single leading alphabetic flag (e.g. "F", "Flat", "Cable") when
// immediately followed by a digit. Returns the input unchanged otherwise.
function _stripLeadingFlag(s) {
  const m = /^([A-Za-z]+)\s+(\S.*)$/.exec(s);
  return (m && /^\d/.test(m[2])) ? m[2] : s;
}

// Extract a trailing "*..." annotation (e.g. "*PR", "*top set") from a raw
// row string, mirroring the suffix `_segmentWorkoutRow` strips before
// tokenizing. Returns the trimmed mark text, or null if no annotation is
// present. This is the sole source of the canonical `mark` field so the
// star text survives parsing for display instead of being silently dropped.
function _extractMark(trimmed) {
  const m = /\s+\*(.*)$/.exec(trimmed);
  return m ? (m[1].trim() || null) : null;
}

// Complete row-grammar classifier. Takes an already-cleaned set string (leading
// flag resolved, no ` - ` prose tail, no trailing `*` mark) and validates it
// against the row grammar, returning parsed sets or a structured error. This is
// the single grammar authority: the primary parser (`parseWorkoutRow`) and the
// continuation-segment classifier (`_isSetSegment`) both route through it, so a
// trailing segment is treated as a continuation set iff the primary parser
// would accept it as one.
//
// Accepted forms: <rep-group> | (<load> <rep-group>)+
// A standalone rep-group requires at least one comma to be unambiguous.
function _parseSetTokens(setStr, raw) {
  // ", " can be a pair separator ("90 10, 70 10,10") or a spaced rep-group
  // separator ("135 8, 8, 8"). Disambiguate: split on ", " and check whether
  // every subsequent chunk contains a space (weight+reps pair shape). If so,
  // join with " " (pair separator). Otherwise collapse the ", " to "," (rep group).
  let pairNormalized = setStr;
  if (setStr.includes(', ')) {
    const chunks = setStr.split(', ');
    const allSubsequentArePairs = chunks.slice(1).every(c => c.includes(' '));
    pairNormalized = allSubsequentArePairs ? chunks.join(' ') : chunks.join(',');
  }
  const normalized = pairNormalized.replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ').trim();
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

// Classify a raw ` - `-separated continuation segment. No leading-flag stripping
// (only the primary segment gets that), so prose like "RPE 9" can never be
// promoted to a phantom load `9`; a segment counts as a continuation set iff it
// parses cleanly under the shared grammar above.
function _isSetSegment(seg) {
  const t = seg.trim();
  if (!t) return false;
  return _parseSetTokens(t, t).ok === true;
}

// Split a trimmed row into its tokenizable set string and an optional captured
// prose `tail`. The remainder after `*mark` removal is split on ` - `. Segment 0
// is the primary set segment: leading-flag stripped and tokenized as the set
// head (preserving forms like "Flat 225 5"). Each later segment is kept as a
// continuation set only while it classifies as a set segment; the first segment
// that does not (and every segment after it) is rejoined verbatim with ` - ` and
// captured as the prose `tail` — displayed de-emphasized, never re-tokenized as
// a load. Sets before the first prose segment are always preserved.
function _segmentWorkoutRow(trimmed) {
  const noAnnotation = trimmed.replace(/\s+\*.*$/, '').trim();
  if (!noAnnotation.includes(' - ')) {
    return { setString: _stripLeadingFlag(noAnnotation), tail: null };
  }

  const segments = noAnnotation.split(' - ');
  const setParts = [_stripLeadingFlag(segments[0].trim())];
  let tailStart = -1;
  for (let k = 1; k < segments.length; k++) {
    if (_isSetSegment(segments[k])) {
      setParts.push(segments[k].trim());
    } else {
      tailStart = k;
      break;
    }
  }
  const tail = tailStart >= 0 ? (segments.slice(tailStart).join(' - ').trim() || null) : null;
  return { setString: setParts.join(' '), tail };
}

// Parse a single logged set row. Returns `{ ok, blank }` for empty input,
// `{ ok, skipped }` for a bare "-", or `{ ok, skipped: false, mark, tail, sets }`
// on success. `mark` is the trailing `*...` star text; `tail` is any captured
// inline prose (e.g. "RPE 9") that follows a valid set segment.
export function parseWorkoutRow(raw) {
  if (!raw || raw.trim() === '') return { ok: true, blank: true };
  const trimmed = raw.trim();
  if (trimmed === '-') return { ok: true, skipped: true };

  const mark = _extractMark(trimmed);
  const { setString, tail } = _segmentWorkoutRow(trimmed);
  const result = _parseSetTokens(setString, raw);
  if (!result.ok) return result;
  return { ...result, mark, tail };
}

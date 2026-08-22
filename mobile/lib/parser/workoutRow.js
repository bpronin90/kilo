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

// A rep/duration token is a comma-separated group whose members are positive
// integers or "-", a skipped set (e.g. "80 4,-" -> a set of 4 then a skipped
// set, both at 80 lb). #854/G2 widens the bodyweight branch to the same
// alphabet as the weighted branch, so "-" is legal in both.
const REP_RE = /^(\d+|-)(,(\d+|-))*$/;

// #854/G6: a bare "N-M" or "N/M" token reads as a range or a fraction, not a
// rep/weight value — never guess which endpoint the user meant.
function _isRangeLike(tok) {
  return /^\d+[-/]\d+$/.test(tok);
}

function _rangeMessage() {
  return 'Ranges aren’t supported as a set value — log what was done (e.g. "135 5") or put the target in the exercise header.';
}

// #854/G3: a trailing or empty comma-separated group member (e.g. "12,",
// "3,,3") gets a message naming the problem and offering both completions,
// instead of the generic "invalid group" message.
function _hasTrailingOrEmptyComma(tok) {
  return tok.endsWith(',') || /,,/.test(tok) || tok.startsWith(',');
}

function _trailingCommaMessage(tok) {
  const trimmed = tok.replace(/,+$/, '').replace(/,+/g, ',');
  const lastMember = trimmed.split(',').pop() || trimmed;
  return `Trailing comma in "${tok}" — remove it (e.g. "${trimmed}") or complete the group (e.g. "${trimmed},${lastMember}")`;
}

// #854/G1: read the header-declaration grammar so a bare integer set row
// (e.g. "8") knows whether it means reps or a duration. Precedence order
// (must never consider the exercise name — declaration syntax only):
//   1. "N x M T"  — sets x timed holds        -> duration (M, in T)
//   2. "N-M T"    — timed target range         -> duration (in T)
//   3. "N x M" / "N x M-P" — rep prescription  -> reps
//   4. "N T" alone — scalar time prescription  -> no declaration (G1-p)
//   5. no declaration                          -> no declaration (G1-p)
// [xX×]: the "x" multiplier in a set×rep/hold prescription is authored as
// either the ASCII letter or the canonical "×" (U+00D7) the repo already
// uses elsewhere (see deloadGenerator.js's parseExerciseHeader) — matching
// only ASCII "x" left "×"-authored headers (e.g. "4×6–8", "2×60s") ungoverned.
const _TIME_UNIT = '(?:sec|secs|seconds?|s|min|mins|minutes?|m)';
const _HEADER_TIMED_HOLDS_RE = new RegExp(`\\d+\\s*[xX×]\\s*\\d+(?:\\.\\d+)?\\s*${_TIME_UNIT}\\b`, 'i');
const _HEADER_TIMED_RANGE_RE = new RegExp(`\\d+\\s*[-–]\\s*\\d+(?:\\.\\d+)?\\s*${_TIME_UNIT}\\b`, 'i');
const _HEADER_REP_PRESCRIPTION_RE = /\d+\s*[xX×]\s*\d+(?:\s*[-–]\s*\d+)?/;

export function parseHeaderDeclaration(rawHeader) {
  if (!rawHeader) return null;
  const header = rawHeader.replace(/^-/, '');
  if (_HEADER_TIMED_HOLDS_RE.test(header)) return { type: 'duration' };
  if (_HEADER_TIMED_RANGE_RE.test(header)) return { type: 'duration' };
  if (_HEADER_REP_PRESCRIPTION_RE.test(header)) return { type: 'reps' };
  return null; // scalar-time prescription or no declaration -> G1-p
}

// Complete row-grammar classifier. Takes an already-cleaned set string (leading
// flag resolved, no ` - ` prose tail, no trailing `*` mark) and validates it
// against the row grammar, returning parsed sets or a structured error. This is
// the single grammar authority: the primary parser (`parseWorkoutRow`) and the
// continuation-segment classifier (`_isSetSegment`) both route through it, so a
// trailing segment is treated as a continuation set iff the primary parser
// would accept it as one.
//
// Accepted forms: <rep-group> | (<load> <rep-group>)+ | <bare-integer>
// A standalone rep-group requires at least one comma to be unambiguous.
// `declaration` is the result of parseHeaderDeclaration(raw_header) for the
// exercise this row belongs to (#854/G1); a bare integer with no comma reads
// as one set of the declared quantity when a declaration governs, or is
// preserved un-parsed (G1-p) otherwise — never guessed, never an error.
function _parseSetTokens(setStr, raw, declaration = null) {
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
    // #854/G2: widened to the weighted branch's alphabet so a bodyweight
    // skipped set ("3,3,-") parses instead of misfiring the trailing-comma
    // message.
    if (!REP_RE.test(tokens[0])) {
      if (_hasTrailingOrEmptyComma(tokens[0])) {
        return { ok: false, raw, error: _trailingCommaMessage(tokens[0]), category: 'invalid_field_value' };
      }
      return { ok: false, raw, error: 'Invalid rep group — use: 8,8,8 (no trailing comma)', category: 'invalid_field_value' };
    }
    const reps = tokens[0].split(',').map(n => (n === '-' ? null : parseInt(n, 10)));
    if (reps.some(r => r !== null && r <= 0)) {
      return { ok: false, raw, error: 'Rep counts must be positive integers', category: 'invalid_field_value' };
    }
    return {
      ok: true, skipped: false,
      sets: reps.map((rep_count, i) => ({
        set_index: i + 1, rep_count: rep_count === null ? 0 : rep_count,
        ...(rep_count === null ? { skipped: true } : null),
        weight_value: null, weight_unit: null,
        duration_seconds: null, assistance_value: null, assistance_unit: null, note_text: null,
      })),
    };
  }

  if (tokens.length === 1) {
    const tok = tokens[0];
    // #854/G1 + G1-p: a bare positive integer. Under a governing header
    // declaration it's one set of the declared quantity; otherwise it is
    // preserved as-is — never rejected, never guessed.
    if (/^\d+$/.test(tok)) {
      const n = parseInt(tok, 10);
      if (n <= 0) {
        return { ok: false, raw, error: 'Rep counts must be positive integers', category: 'invalid_field_value' };
      }
      if (declaration && declaration.type === 'duration') {
        return {
          ok: true, skipped: false,
          sets: [{
            set_index: 1, rep_count: null,
            weight_value: null, weight_unit: null,
            duration_seconds: n, assistance_value: null, assistance_unit: null, note_text: null,
          }],
        };
      }
      if (declaration && declaration.type === 'reps') {
        return {
          ok: true, skipped: false,
          sets: [{
            set_index: 1, rep_count: n,
            weight_value: null, weight_unit: null,
            duration_seconds: null, assistance_value: null, assistance_unit: null, note_text: null,
          }],
        };
      }
      return { ok: true, skipped: false, preserved: true, sets: [] };
    }
    if (_isRangeLike(tok)) {
      return { ok: false, raw, error: _rangeMessage(), category: 'invalid_field_value' };
    }
    return { ok: false, raw, error: 'Enter reps as reps,reps or weight reps,reps', category: 'invalid_field_value' };
  }

  const LOAD_RE = /^\d+(\.\d+)?$/;
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
      if (_hasTrailingOrEmptyComma(rep_tok)) {
        return { ok: false, raw, error: _trailingCommaMessage(rep_tok), category: 'invalid_field_value' };
      }
      if (_isRangeLike(rep_tok)) {
        return { ok: false, raw, error: _rangeMessage(), category: 'invalid_field_value' };
      }
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
  const result = _parseSetTokens(t, t);
  // A G1-p preserved bare integer (no governing declaration) is not
  // structured data — it belongs in the prose `tail`, not absorbed as an
  // empty continuation set (#854/C2).
  return result.ok === true && !result.preserved;
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
// inline prose (e.g. "RPE 9") that follows a valid set segment. A bare
// integer with no governing header `declaration` (#854/G1) comes back as
// `{ ok: true, skipped: false, preserved: true, sets: [] }` — recognized,
// but not structured workout data; never an error.
export function parseWorkoutRow(raw, declaration = null) {
  if (!raw || raw.trim() === '') return { ok: true, blank: true };
  const trimmed = raw.trim();
  if (trimmed === '-') return { ok: true, skipped: true };

  const mark = _extractMark(trimmed);
  const { setString, tail } = _segmentWorkoutRow(trimmed);
  const result = _parseSetTokens(setString, raw, declaration);
  if (!result.ok) return result;
  return { ...result, mark, tail };
}

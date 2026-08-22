// Entry-boundary unit conversion for free-text workout notes (#852).
//
// raw_text is the single source of truth for a workout note, and every
// reader (Log editors, Recovery Analytics, Home/Analytics summaries, the
// cloud sync recompute) re-parses it fresh via parseWorkoutNote's fixed
// 'lb' default (see workoutNote.js's module comment) — there is no separate
// "weight_value" column that could carry a per-entry unit tag. That means
// honoring the selected unit for entry can't happen only at the moment of
// parsing for display: for a converted load to keep reading correctly on
// every later read (Home, Analytics, reopening the note), the canonical lb
// number has to actually land in raw_text itself. This module is that
// conversion, applied once at save time in the Log editors — see
// convertNewNoteLinesToLb's doc comment for the existing-note compatibility
// contract that makes this safe to run on a whole note's text.
import { parseWorkoutRow } from './workoutRow.js';

// Converts a single "plain" logged-set row's weight tokens from `unit` to
// the canonical lb value, returning the reconstructed row text. Every
// fallback path below returns `raw` completely UNCHANGED — this function
// never guesses: a row it declines to touch is never at risk of being
// corrupted, only left interpreted as literally-typed (the pre-#852
// behavior). It intentionally only rewrites the unambiguous, common
// grammar subset (one or more "weight reps[,reps...]" pairs, optionally
// with a leading alphabetic flag like "Flat 225 5"):
//   - a trailing "*mark" or an inline " - " continuation/tail is left
//     untouched (reconstructing those precisely enough to guarantee no
//     content loss is out of scope here);
//   - a bare rep-only row (no weight token, e.g. a bodyweight "12,12" line)
//     has nothing to convert;
//   - anything parseWorkoutRow doesn't accept as a row (blank, skipped, an
//     exercise-name header, an error) is left untouched.
// A round-trip check (reparse the rebuilt text and compare set-for-set)
// guards even the accepted subset: if reconstruction doesn't reproduce the
// exact sets it was built from, the original text wins.
export function convertPlainRowToLb(raw, unit) {
  if (unit === 'lb' || !raw) return raw;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '-' || trimmed.includes(' - ') || trimmed.includes('*')) return raw;
  // A leading alphabetic flag (e.g. "Flat 225 5") is stripped by
  // parseWorkoutRow before parsing but is NOT reproduced by the
  // reconstruction below, and the round-trip check further down only
  // verifies the parsed *sets*, not the surrounding text — it would not
  // notice a dropped flag. Require the row to start with the weight number
  // itself so reconstruction never has text to lose.
  if (!/^\d/.test(trimmed)) return raw;

  const result = parseWorkoutRow(trimmed, unit);
  if (!result.ok || result.blank || result.skipped || result.mark || result.tail) return raw;
  if (!result.sets.some((s) => s.weight_value !== null)) return raw;

  const groups = [];
  for (const set of result.sets) {
    const repToken = set.skipped ? '-' : String(set.rep_count);
    const last = groups[groups.length - 1];
    if (last && last.weight_value === set.weight_value) {
      last.reps.push(repToken);
    } else {
      groups.push({ weight_value: set.weight_value, reps: [repToken] });
    }
  }
  const rebuilt = groups.map((g) => `${g.weight_value} ${g.reps.join(',')}`).join(' ');

  const reparsed = parseWorkoutRow(rebuilt, 'lb');
  const matches = reparsed.ok && !reparsed.blank && !reparsed.skipped
    && reparsed.sets.length === result.sets.length
    && reparsed.sets.every((s, i) => s.weight_value === result.sets[i].weight_value
      && s.rep_count === result.sets[i].rep_count
      && !!s.skipped === !!result.sets[i].skipped);
  return matches ? rebuilt : raw;
}

// Existing-note compatibility contract (#852): converts only the lines in
// `nextText` that are NEW relative to `previousText` — a line already
// present in `previousText` is left byte-for-byte untouched no matter what
// it contains, so a previously saved row's weight_value can never shift
// just because the viewer's unit preference changed after it was written.
// "Already present" is tracked as a multiset of `previousText`'s lines (so
// duplicates and pure reordering both match correctly); a line consumed
// from that multiset is never reconverted even if it recurs, and a line
// with no remaining match — freshly typed or edited this session — is the
// only kind of line convertPlainRowToLb is ever asked to touch.
export function convertNewNoteLinesToLb(previousText, nextText, unit) {
  if (unit === 'lb' || !nextText) return nextText;

  const remaining = new Map();
  for (const line of (previousText || '').split('\n')) {
    remaining.set(line, (remaining.get(line) || 0) + 1);
  }

  return nextText
    .split('\n')
    .map((line) => {
      const count = remaining.get(line) || 0;
      if (count > 0) {
        remaining.set(line, count - 1);
        return line;
      }
      if (line.trim() !== line) return line; // leave padded/blank lines untouched
      const dashMatch = /^-\s+(\S.*)$/.exec(line);
      if (dashMatch) return `- ${convertPlainRowToLb(dashMatch[1], unit)}`;
      return convertPlainRowToLb(line, unit);
    })
    .join('\n');
}

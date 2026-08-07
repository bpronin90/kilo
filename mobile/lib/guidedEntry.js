// Guided first-use entry helpers (#748, contract in #745 Parts 3–6).
//
// Everything here is a PURE function over already-loaded data. Three governing
// rules from the contract are structural, not stylistic:
//
//   1. Kilo never invents a weight, a rep count, an exercise, or a day. Every
//      character composed below originates in text the user typed in the sheet
//      or in a session the user already logged.
//   2. Guidance is derived from verified data, never from a persisted
//      onboarding flag. Nothing in this module reads or writes storage.
//   3. The parser is CALLED, never modified. `parseWorkoutNote` /
//      `parseWorkoutRow` are imported and used as the sole grammar authority;
//      every composed string is round-tripped back through them before any
//      caller is allowed to persist it.

import { parseWorkoutNote } from './parser';
import { parseWorkoutRow } from './parser/workoutRow.js';
import { DELOAD_NOTE_PREFIX } from './LogScreenHelpers';

// ── First-use state machine (#745 Part 3 §1) ────────────────────────────────

export const FIRST_USE_UNKNOWN = 'unknown';
export const FIRST_USE_S0 = 's0';
export const FIRST_USE_S1 = 's1';
export const FIRST_USE_S2 = 's2';
export const FIRST_USE_S3 = 's3';

// Deload records are not routines. Every predicate below counts routines only,
// so generating a deload never advances or regresses the teaching state.
export function selectRoutineNotes(notes) {
  return (notes || []).filter(n => !n?.title?.startsWith(DELOAD_NOTE_PREFIX));
}

// The state is UNKNOWN until the owning read has resolved without error
// (#737's gate, inherited verbatim): a failed read leaves `notes` empty, which
// is byte-identical to a brand-new account. Callers render nothing for UNKNOWN
// rather than fabricating an empty notebook.
export function deriveFirstUseState({
  notes,
  currentId,
  notesLoading,
  notesError,
  activeSessionCount,
}) {
  if (notesLoading || notesError) return FIRST_USE_UNKNOWN;
  const routineNotes = selectRoutineNotes(notes);
  if (routineNotes.length === 0) return FIRST_USE_S0;
  if (!currentId) return FIRST_USE_S1;
  const sessions = Number.isFinite(activeSessionCount) ? activeSessionCount : 0;
  if (sessions === 0) return FIRST_USE_S1;
  if (sessions === 1) return FIRST_USE_S2;
  return FIRST_USE_S3;
}

// The routine the S1 card offers to adopt: the most recently saved routine that
// is not already current. Ordering is by the note's own `saved_at`; notes with
// no timestamp sort last but stay reachable, so a legacy note is never hidden.
export function pickAdoptableRoutine(notes, currentId) {
  const candidates = selectRoutineNotes(notes).filter(n => n && n.id && n.id !== currentId);
  if (candidates.length === 0) return null;
  const scored = candidates.map((note, index) => {
    const t = Date.parse(note.saved_at || '');
    return { note, index, time: Number.isNaN(t) ? -Infinity : t };
  });
  scored.sort((a, b) => (b.time - a.time) || (a.index - b.index));
  return scored[0].note;
}

// ── Scaffold autofill (#745 Part 3 §3.1, as amended by Part 4) ──────────────

// `raw_text` = optional day-label line, then one `-<name>` line per exercise.
// NO set rows are composed: the app has no basis for a weight or a rep count.
// Names are inserted verbatim — display normalization is a read-time concern
// and must never be applied at write time.
export function composeScaffoldText({ dayLabel, exerciseNames } = {}) {
  const day = (dayLabel || '').trim();
  const names = (exerciseNames || []).map(n => (n || '').trim()).filter(Boolean);
  const lines = [];
  if (day) lines.push(day);
  for (const name of names) lines.push(`-${name}`);
  return lines.join('\n');
}

// Parser gate that must pass before the sheet's primary action is enabled.
// Requires all of: `ok === true`; exercise count equals the number of entered
// names; every exercise has `unparsed_rows.length === 0`. `nameErrors` maps a
// 0-based entered-name index to the reason that name is rejected, so the sheet
// can mark the offending row inline instead of failing the whole form silently.
export function verifyScaffold({ dayLabel, exerciseNames } = {}) {
  const rawNames = (exerciseNames || []).map(n => (n || '').trim());
  const names = rawNames.filter(Boolean);
  const text = composeScaffoldText({ dayLabel, exerciseNames });
  const base = { text, names, nameErrors: {} };

  if (names.length === 0) {
    return { ...base, ok: false, reason: 'Add at least one exercise name.' };
  }

  const parsed = parseWorkoutNote(text);
  if (!parsed.ok) {
    // The parser's own reason, verbatim. Attribute it to the first name that
    // starts with a digit when it can be attributed — that is the only shape
    // that produces a note-level rejection from a names-only scaffold.
    const nameErrors = {};
    const culprit = rawNames.findIndex(n => n && /^\d/.test(n));
    if (culprit >= 0) nameErrors[culprit] = parsed.error;
    return { ...base, ok: false, nameErrors, reason: parsed.error };
  }

  const exercises = parsed.sections.flatMap(s => s.exercises);
  const unparsed = exercises.find(ex => (ex.unparsed_rows || []).length > 0);
  if (unparsed) {
    return {
      ...base,
      ok: false,
      reason: `"${unparsed.name}" could not be read back as an exercise. Try a simpler name.`,
    };
  }

  if (exercises.length !== names.length) {
    // A name that the parser reads as something other than an exercise header
    // (a weekday, a `+block` header, a `1.`-numbered line colliding with the
    // day label, …). Report it against the row rather than saving a note whose
    // stored text does not mean what the sheet showed.
    return {
      ...base,
      ok: false,
      reason: `${names.length} exercise${names.length === 1 ? '' : 's'} entered but ${exercises.length} read back. Check the names and day label.`,
    };
  }

  return { ...base, ok: true, exerciseCount: exercises.length, reason: null };
}

// ── Session autofill (#745 Part 3 §3.2) ─────────────────────────────────────

// Line classifiers mirroring `parseWorkoutNote`'s own boundary rules so the
// line walk below groups lines into exercise blocks in exactly the order
// `sections[*].exercises` reports them. This duplicates classification, never
// grammar: the actual accept/reject decision for a row is delegated to
// `parseWorkoutRow`, and every composed result is verified by re-parsing.
const DAY_RE = /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i;
const EXERCISE_DASH_RE = /^-([^-\s].*)/;
const EXERCISE_NUMBERED_RE = /^(\d+[a-z]?)\.\s+(.+)/i;
const EXERCISE_CORE_RE = /^Core:\s+(.+)/i;
const DELOAD_RE = /^([^:+\d-][^:]*?):\s+(\d+(?:\.\d+)?)\s+lbs?\s+(\d+)x(\d+)\s*$/i;

const WEEKDAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

// "-230 5" is a missing-space SET row, not an exercise header (#617). Same
// recovery rule the parser applies, reusing the parser's own row grammar.
function dashContentAsSetRow(content) {
  if (!/^\d/.test(content)) return null;
  const r = parseWorkoutRow(content);
  return (r.ok && !r.blank && !r.skipped) ? r : null;
}

function isExerciseHeaderLine(t) {
  const dashMatch = EXERCISE_DASH_RE.exec(t);
  const isDashHeader = !!dashMatch && !dashContentAsSetRow(dashMatch[1].trim());
  return (
    isDashHeader
    || EXERCISE_NUMBERED_RE.test(t)
    || EXERCISE_CORE_RE.test(t)
    || DELOAD_RE.test(t)
  );
}

// Consecutive sections sharing a heading form one day group, matching the read
// view's own grouping.
function groupSections(sections) {
  const groups = [];
  for (const section of sections || []) {
    const last = groups[groups.length - 1];
    if (last && last.heading === section.heading) last.sections.push(section);
    else groups.push({ heading: section.heading, sections: [section] });
  }
  return groups;
}

function formatWeight(value) {
  return String(value);
}

// Re-emit a logged entry canonically from its PARSED sets, never by copying the
// raw string. Consequently `*` marks and inline prose tails are structurally
// incapable of being carried forward — they live on `annotation`, which this
// never reads. A skipped member inside an otherwise valid row (`80 4,-`) IS
// re-emitted, because that is the user's own recorded shape.
export function formatSetsAsRow(sets) {
  if (!sets || sets.length === 0) return null;
  const groups = [];
  for (const set of sets) {
    const weight = set.weight_value == null ? null : set.weight_value;
    const rep = set.skipped ? '-' : String(set.rep_count);
    if (!set.skipped && !(Number.isFinite(set.rep_count) && set.rep_count > 0)) return null;
    const last = groups[groups.length - 1];
    if (last && last.weight === weight) last.reps.push(rep);
    else groups.push({ weight, reps: [rep] });
  }
  // The grammar accepts either a lone rep group (bodyweight) or one or more
  // `<load> <rep-group>` pairs — never a mix. Anything else is withheld.
  const bodyweightGroups = groups.filter(g => g.weight == null);
  if (bodyweightGroups.length > 0 && groups.length > 1) return null;
  if (bodyweightGroups.length > 0) {
    // A standalone rep group needs at least one comma to be unambiguous.
    if (groups[0].reps.length < 2) return null;
    return groups[0].reps.join(',');
  }
  return groups.map(g => `${formatWeight(g.weight)} ${g.reps.join(',')}`).join(' ');
}

// Day groups offered by the sheet's first control, with the pre-selection rule:
// a single group is used with no picker; otherwise today's weekday heading is
// pre-selected when it matches case-insensitively, and nothing is pre-selected
// when it does not. The app never guesses which day a user is training.
export function listAutofillDayGroups(activeText) {
  const parsed = parseWorkoutNote(activeText || '');
  if (!parsed.ok) return [];
  const groups = groupSections(parsed.sections);
  return groups.map((group, index) => {
    let maxEntries = 0;
    for (const section of group.sections) {
      for (const ex of section.exercises) {
        maxEntries = Math.max(maxEntries, (ex.session_entries || []).length);
      }
    }
    return {
      index,
      heading: group.heading,
      label: group.heading || 'Ungrouped',
      maxEntries,
    };
  });
}

export function pickDefaultDayGroup(dayGroups, today = new Date()) {
  if (!dayGroups || dayGroups.length === 0) return null;
  if (dayGroups.length === 1) return dayGroups[0].index;
  const weekday = WEEKDAY_NAMES[today.getDay()].toLowerCase();
  const match = dayGroups.find(g => (g.heading || '').trim().toLowerCase().startsWith(weekday));
  return match ? match.index : null;
}

// Per-exercise plan for one day group. Exclusions always carry their reason in
// text — no meaning is carried by color alone.
export function buildSessionAutofillPlan({ activeText, dayGroupIndex }) {
  const parsed = parseWorkoutNote(activeText || '');
  if (!parsed.ok) {
    return { ok: false, reason: parsed.error, included: [], excluded: [] };
  }
  const groups = groupSections(parsed.sections);
  const group = groups[dayGroupIndex];
  if (!group) {
    return { ok: false, reason: 'Choose a day first.', included: [], excluded: [] };
  }

  // Global occurrence index across the whole active slice — the same order the
  // line walk in `applySessionAutofill` counts exercise headers in.
  let occurrence = 0;
  const inGroup = [];
  for (let gi = 0; gi < groups.length; gi++) {
    for (const section of groups[gi].sections) {
      for (const ex of section.exercises) {
        if (gi === dayGroupIndex) inGroup.push({ ex, occurrence });
        occurrence++;
      }
    }
  }

  const maxCount = inGroup.reduce(
    (max, { ex }) => Math.max(max, (ex.session_entries || []).length),
    0
  );
  if (maxCount === 0) {
    return {
      ok: false,
      reason: 'No logged sessions in this day yet, so there is nothing to copy.',
      included: [],
      excluded: [],
    };
  }

  const included = [];
  const excluded = [];
  for (const { ex, occurrence: idx } of inGroup) {
    const entries = ex.session_entries || [];
    const behind = maxCount - entries.length;
    if (behind > 0) {
      excluded.push({
        name: ex.name,
        reason: `Behind by ${behind} session${behind === 1 ? '' : 's'} — not included`,
      });
      continue;
    }
    const last = [...entries].reverse().find(
      e => e && !e.skipped && !e.unparsed && (e.sets || []).length > 0
    );
    if (!last) {
      excluded.push({
        name: ex.name,
        reason: 'Last session was skipped or could not be read — not included',
      });
      continue;
    }
    const line = formatSetsAsRow(last.sets);
    if (!line) {
      excluded.push({
        name: ex.name,
        reason: 'This line could not be rebuilt exactly — not included',
      });
      continue;
    }
    included.push({ name: ex.name, line, occurrence: idx });
  }

  if (included.length === 0) {
    return {
      ok: false,
      reason: 'Nothing in this day could be copied forward.',
      included: [],
      excluded,
    };
  }
  return { ok: true, reason: null, included, excluded, heading: group.heading };
}

// Appends one row per addition immediately after that exercise's last existing
// row. Every other byte of the note is preserved, including blank lines and the
// exact spelling of every other row.
export function applySessionAutofill(activeText, additions) {
  const byOccurrence = new Map((additions || []).map(a => [a.occurrence, a.line]));
  const lines = (activeText || '').split('\n');
  const out = [];
  let pending = [];
  let inExercise = false;
  let lineToAppend = null;
  let occurrence = 0;

  const flush = () => {
    if (inExercise && lineToAppend != null) {
      let i = pending.length - 1;
      while (i >= 0 && pending[i].trim() === '') i--;
      pending.splice(i + 1, 0, lineToAppend);
    }
    out.push(...pending);
    pending = [];
    inExercise = false;
    lineToAppend = null;
  };

  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      (inExercise ? pending : out).push(line);
      continue;
    }
    if (t === '---' || DAY_RE.test(t) || t.startsWith('+')) {
      flush();
      out.push(line);
      continue;
    }
    if (isExerciseHeaderLine(t)) {
      flush();
      inExercise = true;
      lineToAppend = byOccurrence.has(occurrence) ? byOccurrence.get(occurrence) : null;
      occurrence++;
      pending.push(line);
      continue;
    }
    (inExercise ? pending : out).push(line);
  }
  flush();
  return out.join('\n');
}

// The safety net. Re-parses the composed text and requires: `ok === true`;
// every included exercise gained exactly one `session_entry`; every other
// exercise gained none; no exercise gained an `unparsed_row`; and the exercise
// list itself is otherwise identical. If any check fails the caller withholds
// the suggestion ENTIRELY — it is never partially applied.
export function verifySessionAutofill({ beforeText, afterText, additions }) {
  const before = parseWorkoutNote(beforeText || '');
  const after = parseWorkoutNote(afterText || '');
  if (!before.ok || !after.ok) return false;
  const beforeEx = before.sections.flatMap(s => s.exercises);
  const afterEx = after.sections.flatMap(s => s.exercises);
  if (beforeEx.length !== afterEx.length) return false;
  const expected = new Map((additions || []).map(a => [a.occurrence, 1]));
  for (let i = 0; i < beforeEx.length; i++) {
    const b = beforeEx[i];
    const a = afterEx[i];
    if (b.name !== a.name) return false;
    if ((a.unparsed_rows || []).length !== (b.unparsed_rows || []).length) return false;
    const delta = (a.session_entries || []).length - (b.session_entries || []).length;
    if (delta !== (expected.get(i) || 0)) return false;
  }
  return true;
}

// One call the UI can trust: compose, verify, and hand back either the exact
// next text or a readable reason to withhold. Never touches storage.
export function buildSessionAutofillSuggestion({ activeText, dayGroupIndex, excludedNames }) {
  const plan = buildSessionAutofillPlan({ activeText, dayGroupIndex });
  if (!plan.ok) return plan;
  const skip = new Set(excludedNames || []);
  const additions = plan.included.filter(item => !skip.has(item.name));
  if (additions.length === 0) {
    return { ...plan, ok: false, reason: 'Select at least one exercise to add.' };
  }
  const nextText = applySessionAutofill(activeText, additions);
  if (!verifySessionAutofill({ beforeText: activeText, afterText: nextText, additions })) {
    return {
      ok: false,
      reason: 'Could not build a suggestion from this note. Nothing was changed.',
      included: [],
      excluded: plan.excluded,
    };
  }
  return { ...plan, ok: true, additions, nextText };
}

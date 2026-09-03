// Kilo CSV export — workout and weight history, in the schema defined by
// issue #578 (comment 5530857840, "Kilo exports" section).
//
// CSV is interoperability, never backup or sync: this module is read-only
// over existing storage and never writes anything back. JSON backup
// (mobile/storage/entries/backupImport.js) remains the only lossless format.
//
// Scope note: this is Issue A only (Kilo CSV export). It does not read a CSV
// file, and it carries no vendor/import concept — `source_session_key`,
// `source_started_at`, `source_date`, and `source_date_origin` values of
// `vendor_timestamp`/`vendor_date`/`persisted_session_date` are reserved for
// the shared import foundation and adapters (Issues B-E) to populate on
// imported notes; a note with no imported provenance never produces those
// values today, and the columns exist now so the schema does not change
// shape once import ships.

import { parseWorkoutNote } from '../parser.js';
import { writeCsvDocument } from './csv.js';

const SCHEMA_VERSION = '1';

export const WORKOUT_CSV_COLUMNS = [
  'schema_version', 'record_kind', 'routine_id', 'routine_title', 'is_current_routine',
  'section_ordinal', 'routine_day', 'section_subheading', 'section_kind',
  'exercise_ordinal', 'exercise_name', 'raw_exercise_header',
  'session_index', 'source_session_key', 'source_started_at', 'source_date', 'source_date_origin',
  'set_ordinal', 'history_set_ordinal',
  'weight_value_lb', 'authored_unit', 'authored_value', 'rep_count', 'duration_seconds',
  'assistance_value', 'assistance_unit', 'note_text',
  'mark', 'row_tail', 'row_comments',
  'is_skipped', 'is_unparsed', 'raw_unparsed_text',
  'annotation_scope', 'annotation_text',
  'spreadsheet_escaped_fields',
];

export const WEIGHT_CSV_COLUMNS = [
  'schema_version', 'date', 'logged_at', 'weight_value_lb', 'note', 'spreadsheet_escaped_fields',
];

// Free-text columns eligible for spreadsheet-trigger escaping (csv.js). Every
// other column is a number, boolean, id, or a value Kilo controls the shape
// of (schema_version, record_kind, origin enums, ISO dates).
const WORKOUT_FREE_TEXT_COLUMNS = new Set([
  'routine_title', 'routine_day', 'section_subheading',
  'exercise_name', 'raw_exercise_header',
  'source_session_key',
  'note_text', 'mark', 'row_tail', 'row_comments',
  'raw_unparsed_text', 'annotation_text',
]);

const WEIGHT_FREE_TEXT_COLUMNS = new Set(['note']);

function emptyRow() {
  const row = {};
  for (const column of WORKOUT_CSV_COLUMNS) row[column] = '';
  row.schema_version = SCHEMA_VERSION;
  return row;
}

// Mirrors mobile/lib/data/skipData.js's private `_headingInfo()` — duplicated
// rather than imported because that module is outside this stage's Allowed
// Files (issue #578 Issue A scope), and `_headingInfo` is not exported. Same
// extraction rule: an ISO `YYYY-MM-DD` or common `MM-DD-YYYY`/`MM/DD/YYYY`
// date embedded anywhere in the heading text.
function extractHeadingDate(heading) {
  if (!heading) return null;
  const isoMatch = /(\d{4}-\d{2}-\d{2})/.exec(heading);
  if (isoMatch) return isoMatch[1];
  const commonMatch = /(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(heading);
  if (commonMatch) {
    const m = commonMatch[1].padStart(2, '0');
    const d = commonMatch[2].padStart(2, '0');
    const y = commonMatch[3];
    return `${y}-${m}-${d}`;
  }
  return null;
}

// Date precedence for one section's sessions (issue #578 "Kilo exports" +
// the export-date correction chain, comment 5530737035 as later refined):
// evidence-based only, never inferred from note timestamps, weekday alone,
// or import/now time. Issue A has no vendor/persisted-session-date source
// yet, so the only representable evidence today is a single-session dated
// heading. Returns { date, origin } applied uniformly to every row this
// section emits (a multi-session section with no date-list mechanism gets
// no date at all — the date-list mechanism itself is an import-side
// convention, added when Issue B ships).
function sectionDateEvidence(section, sessionCount) {
  if (sessionCount !== 1) return { date: '', origin: '' };
  const headingDate = extractHeadingDate(section.heading);
  if (!headingDate) return { date: '', origin: '' };
  return { date: headingDate, origin: 'dated_heading' };
}

function sectionMaxSessionCount(section) {
  let max = 0;
  for (const exercise of section.exercises) {
    const count = (exercise.session_entries || []).length;
    if (count > max) max = count;
  }
  return max;
}

// Builds every record row for one live note. `routine` carries the note's
// stable identity/ordering fields already resolved by the caller.
function buildNoteRows(note, routine) {
  const rows = [];
  rows.push({
    ...emptyRow(),
    record_kind: 'routine',
    routine_id: routine.id,
    routine_title: routine.title,
    is_current_routine: String(routine.isCurrent),
  });

  const parsed = parseWorkoutNote(note.raw_text || '');
  const sections = parsed.sections || [];

  sections.forEach((section, sectionIdx) => {
    const sectionOrdinal = sectionIdx + 1;
    rows.push({
      ...emptyRow(),
      record_kind: 'section',
      routine_id: routine.id,
      routine_title: routine.title,
      is_current_routine: String(routine.isCurrent),
      section_ordinal: String(sectionOrdinal),
      routine_day: section.heading || '',
      section_subheading: section.subheading || '',
      section_kind: section.kind || '',
    });

    for (const prose of section.annotations || []) {
      rows.push({
        ...emptyRow(),
        record_kind: 'annotation',
        routine_id: routine.id,
        routine_title: routine.title,
        is_current_routine: String(routine.isCurrent),
        section_ordinal: String(sectionOrdinal),
        routine_day: section.heading || '',
        annotation_scope: 'section',
        annotation_text: prose,
      });
    }

    const sessionCount = sectionMaxSessionCount(section);
    const { date: sectionDate, origin: sectionDateOrigin } = sectionDateEvidence(section, sessionCount);

    section.exercises.forEach((exercise, exerciseIdx) => {
      const exerciseOrdinal = exerciseIdx + 1;
      const exerciseBase = {
        record_kind: 'exercise',
        routine_id: routine.id,
        routine_title: routine.title,
        is_current_routine: String(routine.isCurrent),
        section_ordinal: String(sectionOrdinal),
        routine_day: section.heading || '',
        section_subheading: section.subheading || '',
        section_kind: section.kind || '',
        exercise_ordinal: String(exerciseOrdinal),
        exercise_name: exercise.name || '',
        raw_exercise_header: exercise.raw_header || '',
      };
      rows.push({ ...emptyRow(), ...exerciseBase });

      const entries = exercise.session_entries || [];
      entries.forEach((entry, entryIdx) => {
        const sessionIndex = entryIdx + 1;
        const rowBase = {
          ...exerciseBase,
          record_kind: 'session',
          session_index: String(sessionIndex),
          source_date: sectionDate,
          source_date_origin: sectionDateOrigin,
        };

        if (entry.skipped) {
          rows.push({ ...emptyRow(), ...rowBase, is_skipped: 'true' });
        } else if (entry.unparsed) {
          rows.push({
            ...emptyRow(),
            ...rowBase,
            record_kind: 'unparsed',
            is_unparsed: 'true',
            raw_unparsed_text: entry.raw || '',
          });
        } else {
          const sets = entry.sets || [];
          if (sets.length === 0) {
            // A performed entry the parser produced with no derivable sets
            // (e.g. a non-weight/duration-only row with nothing numeric to
            // carry) still occupies a real session position.
            rows.push({ ...emptyRow(), ...rowBase });
          } else {
            sets.forEach((set, setIdx) => {
              const authoredUnit = set.converted_from_kg ? 'kg' : 'lb';
              const authoredValue = set.converted_from_kg ? set.kg_value : set.weight_value;
              rows.push({
                ...emptyRow(),
                ...rowBase,
                record_kind: 'set',
                set_ordinal: String(setIdx + 1),
                history_set_ordinal: set.set_index != null ? String(set.set_index) : '',
                weight_value_lb: set.weight_value != null ? String(set.weight_value) : '',
                authored_unit: set.weight_value != null ? authoredUnit : '',
                authored_value: set.weight_value != null ? String(authoredValue) : '',
                rep_count: set.rep_count != null ? String(set.rep_count) : '',
                duration_seconds: set.duration_seconds != null ? String(set.duration_seconds) : '',
                assistance_value: set.assistance_value != null ? String(set.assistance_value) : '',
                assistance_unit: set.assistance_unit || '',
                note_text: set.note_text || '',
              });
            });
          }

          const annotation = entry.annotation;
          if (annotation && (annotation.mark || annotation.tail || (annotation.comments || []).length > 0)) {
            rows.push({
              ...emptyRow(),
              ...rowBase,
              record_kind: 'annotation',
              annotation_scope: 'performed_row',
              mark: annotation.mark || '',
              row_tail: annotation.tail || '',
              row_comments: JSON.stringify(annotation.comments || []),
            });
          }
        }
      });
    });
  });

  return rows;
}

// Deterministic ordering (issue #578 "Kilo exports"): current-first, then
// NFC-normalized title compared by explicit Unicode code-point order (never
// `localeCompare`, whose collation varies by runtime/locale), then exact id
// as the final tiebreak.
function compareRoutines(a, b) {
  if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
  const titleA = (a.title || '').normalize('NFC');
  const titleB = (b.title || '').normalize('NFC');
  if (titleA < titleB) return -1;
  if (titleA > titleB) return 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

// Exports every live (non-tombstoned) notebook note as one CSV document.
// `notes` is the already-loaded live notebook list (e.g. from
// `loadWorkoutNotes()`), so this function has no storage dependency of its
// own beyond the pure transform — callers pass in what they already read.
export function exportWorkoutsCsv(notes) {
  // Filtered here too, not just by the caller: "export every live routine and
  // no tombstones" is this function's own contract (issue #578), so it holds
  // even if a caller passes the raw/unfiltered notebook list by mistake.
  const routines = (notes || [])
    .filter((note) => !note?.deleted_at)
    .map((note) => ({
    id: note.id,
    title: note.title || '',
    isCurrent: !!note.isCurrent,
    raw_text: note.raw_text || '',
  }));
  routines.sort(compareRoutines);

  const rows = routines.flatMap((routine) => buildNoteRows(routine, routine));
  return writeCsvDocument(WORKOUT_CSV_COLUMNS, rows, WORKOUT_FREE_TEXT_COLUMNS);
}

// Exports every live weight entry as one CSV document, ascending by
// `logged_at` then exact id (issue #578 "Kilo exports").
export function exportWeightCsv(entries) {
  const live = (entries || []).filter((entry) => !entry.deleted_at);
  const sorted = live.slice().sort((a, b) => {
    const loggedA = a.logged_at || '';
    const loggedB = b.logged_at || '';
    if (loggedA < loggedB) return -1;
    if (loggedA > loggedB) return 1;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });

  const rows = sorted.map((entry) => ({
    schema_version: SCHEMA_VERSION,
    date: entry.date || (entry.logged_at ? entry.logged_at.slice(0, 10) : ''),
    logged_at: entry.logged_at || '',
    weight_value_lb: entry.weight_value != null ? String(entry.weight_value) : '',
    note: entry.note || '',
  }));

  return writeCsvDocument(WEIGHT_CSV_COLUMNS, rows, WEIGHT_FREE_TEXT_COLUMNS);
}

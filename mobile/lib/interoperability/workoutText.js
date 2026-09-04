import { Buffer } from 'buffer';
import { MAX_RAW_TEXT_LENGTH } from '../parser/workoutNote.js';

export const IMPORT_PROSE_MAX_LENGTH = 2000;
export const IMPORT_TRUNCATION_MARKER = '… [truncated]';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => { out[key] = canonicalize(value[key]); return out; }, {});
  }
  return value;
}

export function canonicalJson(value) { return JSON.stringify(canonicalize(value)); }

export function encodeImportPayload(value) {
  return Buffer.from(canonicalJson(value), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function truncateImportProse(value, report, location) {
  const text = value == null ? '' : String(value);
  if ([...text].length <= IMPORT_PROSE_MAX_LENGTH) return text;
  const kept = [...text].slice(0, IMPORT_PROSE_MAX_LENGTH - [...IMPORT_TRUNCATION_MARKER].length).join('') + IMPORT_TRUNCATION_MARKER;
  report?.truncated?.push({ location, originalLength: [...text].length, keptLength: [...kept].length });
  return kept;
}

function assertOrdinal(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
}

// Vendor adapters produce this neutral shape. Source-authored names and prose
// are always JSON/base64url payloads, never interpolated into Kilo grammar.
export function serializeImportedWorkoutNote(note) {
  if (!note || !Array.isArray(note.sections)) throw new Error('Imported note requires sections.');
  const report = { truncated: [] };
  const lines = [];
  note.sections.forEach((section, sectionOrdinal) => {
    if (!section || !Array.isArray(section.exercises)) throw new Error(`Section ${sectionOrdinal} requires exercises.`);
    lines.push(`-- @import-note ${encodeImportPayload({
      v: 1,
      scope: 'section',
      sectionOrdinal,
      text: truncateImportProse(section.heading || '', report, `section:${sectionOrdinal}:heading`),
      metadata: section.metadata ?? null,
      noteMetadata: sectionOrdinal === 0 ? (note.metadata ?? null) : null,
    })}`);
    section.exercises.forEach((exercise, exerciseOrdinal) => {
      if (typeof exercise?.name !== 'string' || !exercise.name) throw new Error('Imported exercise requires a name.');
      lines.push(`-@import-exercise ${canonicalJson(exercise.name)}`);
      const rows = Array.isArray(exercise.rows) ? exercise.rows : [];
      rows.forEach((record, rowOrdinal) => {
        if (record?.kind === 'skipped') lines.push('-');
        else if (record?.kind === 'performed' || record?.kind === 'unparsed') {
          const payload = { ...record, v: 1, rowOrdinal };
          if (payload.prose != null) payload.prose = truncateImportProse(payload.prose, report, `section:${sectionOrdinal}:exercise:${exerciseOrdinal}:row:${rowOrdinal}`);
          lines.push(`- @import-record ${encodeImportPayload(payload)}`);
        } else throw new Error(`Unsupported imported row kind at ${sectionOrdinal}/${exerciseOrdinal}/${rowOrdinal}.`);
      });
      for (const annotation of exercise.annotations || []) {
        assertOrdinal(annotation.targetOrdinal, 'Annotation targetOrdinal');
        const allowed = ['performed_row', 'skipped_row', 'unparsed_row'];
        if (!allowed.includes(annotation.scope)) throw new Error(`Invalid annotation scope "${annotation.scope}".`);
        lines.push(`-- @import-note ${encodeImportPayload({ v: 1, scope: annotation.scope, sectionOrdinal, exerciseOrdinal, targetOrdinal: annotation.targetOrdinal, text: truncateImportProse(annotation.text, report, `annotation:${sectionOrdinal}:${exerciseOrdinal}:${annotation.targetOrdinal}`) })}`);
      }
    });
  });
  const rawText = lines.join('\n');
  if (rawText.length >= MAX_RAW_TEXT_LENGTH) throw new Error(`Generated workout note must be below ${MAX_RAW_TEXT_LENGTH} characters.`);
  return { rawText, report };
}

export function serializeImportedWorkoutNotes(notes) {
  if (!Array.isArray(notes) || notes.length === 0) throw new Error('Import requires at least one note.');
  return notes.map((note) => ({ ...serializeImportedWorkoutNote(note), title: note.title == null ? 'Imported workout' : String(note.title) }));
}

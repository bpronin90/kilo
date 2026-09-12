// Workout-note validation and error surface (split from workoutNote.js, #1057).
//
// Owns the ImportRecordError class (the sole error type the note parser throws
// for malformed imported records), its `_importError` thrower, the base64url
// payload decoder, and the imported-record / imported-annotation validators.
// The parsing core imports these so error class identity and messages stay
// byte-for-byte identical to the pre-split module.
import { Buffer } from 'buffer';

const _IMPORT_PAYLOAD_MAX_LENGTH = 50000;

export class ImportRecordError extends Error {}

export function _importError(message) {
  throw new ImportRecordError(`Invalid imported workout record: ${message}`);
}

export function _decodeBase64UrlJson(encoded) {
  if (!encoded || encoded.length > _IMPORT_PAYLOAD_MAX_LENGTH) _importError(encoded ? 'payload is too large.' : 'payload is empty.');
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) _importError('payload is not unpadded base64url.');
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - encoded.length % 4) % 4);
  const bytes = Buffer.from(padded, 'base64');
  const canonical = bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  if (canonical !== encoded) _importError('payload is not valid base64url.');
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) _importError('payload is not valid UTF-8.');
  let value;
  try { value = JSON.parse(text); }
  catch { _importError('payload is not valid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) _importError('payload must be an object.');
  return value;
}

export function _validateImportRecord(value) {
  if (value.v !== 1 || !['performed', 'unparsed'].includes(value.kind)) _importError('unsupported record schema.');
  if (!Number.isInteger(value.rowOrdinal) || value.rowOrdinal < 0) _importError('record rowOrdinal is invalid.');
  if (value.sets != null) {
    if (!Array.isArray(value.sets)) _importError('record sets must be an array.');
    for (const set of value.sets) {
      if (!set || typeof set !== 'object' || Array.isArray(set)) _importError('record set is invalid.');
      for (const key of ['rep_count', 'weight_value', 'duration_seconds']) {
        if (set[key] != null && (!Number.isFinite(set[key]) || set[key] < 0)) _importError(`record ${key} is invalid.`);
      }
      if (set.weight_unit != null && !['lb', 'kg'].includes(set.weight_unit)) _importError('record weight_unit is invalid.');
    }
  }
  return value;
}

export function _validateImportNote(value) {
  const scopes = ['performed_row', 'skipped_row', 'unparsed_row', 'section'];
  if (value.v !== 1 || !scopes.includes(value.scope) || typeof value.text !== 'string') _importError('unsupported annotation schema.');
  if (!Number.isInteger(value.sectionOrdinal) || value.sectionOrdinal < 0) _importError('annotation sectionOrdinal is invalid.');
  if (value.scope !== 'section') {
    if (!Number.isInteger(value.exerciseOrdinal) || value.exerciseOrdinal < 0) _importError('annotation exerciseOrdinal is invalid.');
    if (!Number.isInteger(value.targetOrdinal) || value.targetOrdinal < 0) _importError('annotation targetOrdinal is invalid.');
  }
  return value;
}

// #854/G7b: a bare prose line typed directly as a set row, not through "-- ".
export function _proseAsSetRowMessage() {
  return 'This looks like a note, not a set — start it with "-- " (two dashes and a space) to keep it as a comment.';
}

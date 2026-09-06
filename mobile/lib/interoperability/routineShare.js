// Share a routine as portable plain text (#954, Stage 1 of #581's design).
//
// The payload is the routine note grammar itself — Kilo's routine text IS the
// interchange format, so nothing is re-serialized and the body travels
// byte-for-byte. A three-line `#`-prefixed envelope wraps it so a receiving
// device can tell a shared routine from an arbitrary paste. `#` is never a
// line-leading token in the note grammar (`lib/parser/workoutNote.js`,
// `workoutRow.js`), so the envelope can never collide with routine content.
//
//   #kilo-routine v1
//   #title: Upper/Lower A
//   #exported: 2026-09-05
//
//   Monday
//   -Bench Press
//   - 135 5
//
// Privacy: only the title, the export date, and the routine body ever leave
// the device. No note id, saved_at/updated_at, sync columns, account
// identifier, weight/fatigue/recovery/health record, or analytics value is
// read by this module at all — the export path simply never touches those
// stores. `buildRoutineShareText` takes exactly two content inputs (title and
// rawText) for that reason; there is no note object to over-read.
//
// The strip side is what #581's Stage 2 import flow (#955) consumes, unchanged:
// `parseRoutineShareText` recovers the body, and `analyzeRoutineImportText`
// below turns that body into the preview/validation verdict the import screen
// renders. Import writes nothing here — it only ever describes the paste.

// `Alert` comes from lib/platformAlert, never from react-native directly: the
// RN web Alert silently no-ops for multi-button dialogs, so a direct import
// would make the pre-share notice — and therefore sharing itself — dead on
// web (#721; guarded by tests/platform-alert.test.js).
import { Share } from 'react-native';
import { Alert } from '../platformAlert';
import { parseWorkoutNote } from '../parser';

export const ROUTINE_SHARE_MARKER = '#kilo-routine';
export const ROUTINE_SHARE_VERSION = 'v1';
export const ROUTINE_SHARE_HEADER = `${ROUTINE_SHARE_MARKER} ${ROUTINE_SHARE_VERSION}`;

export const ROUTINE_SHARE_NOTICE_TITLE = 'Shared as plain text';
export const ROUTINE_SHARE_NOTICE_BODY =
  'Sharing copies this routine’s exercises, sets, and any comments you wrote on them as plain text. '
  + 'It does not include your weight history, fatigue or recovery data, or account info. '
  + 'Anyone who receives this text can read it.';

const HEADER_LINE = /^#/;

function toDateStamp(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  // Local calendar day, not UTC: the date reads as "the day I shared this" on
  // the sharer's own device, and it is informational only — nothing resolves
  // conflicts or ordering with it.
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// A title is one envelope line, so any newline a title somehow carries is
// folded to a space rather than being allowed to forge extra header lines or
// terminate the header block early. Everything else — Unicode, emoji, `:`,
// even a leading `#` — passes through untouched.
function normalizeTitleLine(title) {
  const text = title == null ? '' : String(title);
  const folded = text.replace(/[\r\n]+/g, ' ').trim();
  return folded || null;
}

/**
 * Compose the shareable text for one routine.
 *
 * @param {object} input
 * @param {string=} input.title       Routine title; omitted from the envelope when blank.
 * @param {string=} input.rawText     Routine body, emitted verbatim.
 * @param {Date|string|number=} input.exportedAt  Defaults to now.
 * @returns {string}
 */
export function buildRoutineShareText({ title, rawText, exportedAt } = {}) {
  const lines = [ROUTINE_SHARE_HEADER];
  const titleLine = normalizeTitleLine(title);
  if (titleLine) lines.push(`#title: ${titleLine}`);
  const stamp = toDateStamp(exportedAt);
  if (stamp) lines.push(`#exported: ${stamp}`);
  // The blank line is the separator, not decoration: the strip side splits on
  // the first line after the header block, so the body keeps its own leading
  // and trailing whitespace exactly as authored.
  return `${lines.join('\n')}\n\n${rawText == null ? '' : String(rawText)}`;
}

/**
 * Recover the routine body (and envelope metadata) from shared text.
 *
 * Text with no marker line is not rejected — it is treated as a bare routine
 * body, because users paste routine text that never went through an export.
 * An unrecognized version is likewise consumed as metadata rather than
 * refused, so a future `v2` envelope degrades to a best-effort body.
 *
 * @param {string} text
 * @returns {{ hasEnvelope: boolean, version: string|null, title: string|null, exportedAt: string|null, body: string }}
 */
export function parseRoutineShareText(text) {
  const empty = { hasEnvelope: false, version: null, title: null, exportedAt: null, body: '' };
  if (text == null) return empty;
  // Share targets (iOS Messages/Notes especially) reintroduce CRLF; the parser
  // splits on '\n' only, so normalize once, here.
  const normalized = String(text).replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  // A share sheet's own chrome can prepend blank lines; skipping them costs
  // nothing and never removes body content, because the marker has to be the
  // first non-blank line for the envelope to count at all.
  let index = 0;
  while (index < lines.length && lines[index].trim() === '') index += 1;
  const markerLine = lines[index] == null ? '' : lines[index].trim();
  if (!markerLine.startsWith(`${ROUTINE_SHARE_MARKER} `) && markerLine !== ROUTINE_SHARE_MARKER) {
    return { ...empty, body: normalized };
  }

  const version = markerLine.slice(ROUTINE_SHARE_MARKER.length).trim() || null;
  let title = null;
  let exportedAt = null;
  index += 1;
  while (index < lines.length && HEADER_LINE.test(lines[index])) {
    const line = lines[index];
    if (title == null && /^#title:/i.test(line)) title = line.slice('#title:'.length).trim() || null;
    else if (exportedAt == null && /^#exported:/i.test(line)) exportedAt = line.slice('#exported:'.length).trim() || null;
    index += 1;
  }
  // Exactly one separator line is consumed. A second blank line belongs to the
  // body and stays there, so the body is returned as written.
  if (lines[index] != null && lines[index].trim() === '') index += 1;
  return { hasEnvelope: true, version, title, exportedAt, body: lines.slice(index).join('\n') };
}

export const ROUTINE_IMPORT_EMPTY_MESSAGE =
  'Paste a routine to preview it before you import it.';
export const ROUTINE_IMPORT_NO_EXERCISES_MESSAGE =
  'No exercises were found in this text, so there is nothing to import. '
  + 'Check that you pasted the whole routine.';
export const ROUTINE_IMPORT_UNKNOWN_VERSION_MESSAGE =
  'This routine was shared by a newer version of Kilo. '
  + 'Anything this version does not understand is shown below exactly as it was written.';

/**
 * Split raw routine text on a standalone `---` week separator and return the
 * requested half (or the text unchanged when there is no separator).
 *
 * This is the single implementation of the A/B split for reading: the routine
 * editors import it (`screens/log/useLogOtherRoutineEditor.js`) and so does the
 * import preview, so a pasted A/B routine is previewed exactly as the Routine
 * tab will read it back. It lives here rather than in a screen module because
 * it is pure text handling with no React or storage dependency.
 */
export function sliceRoutineWeekText(fullText, week) {
  const lines = (fullText || '').split('\n');
  const sepIdx = lines.findIndex(l => l.trim() === '---');
  if (sepIdx === -1) return fullText || '';
  if (week === 'B') return lines.slice(sepIdx + 1).join('\n');
  return lines.slice(0, sepIdx).join('\n');
}

function countExercises(sections) {
  let count = 0;
  for (const section of sections || []) count += (section.exercises || []).length;
  return count;
}

/**
 * Describe a pasted routine: what the envelope claimed, what the body parses
 * to, and whether it may be imported at all.
 *
 * Import is a read-only inspection of text the user pasted, so this function
 * writes nothing and reads nothing — it takes the pasted string and returns a
 * verdict. The screen renders `sections` through the same
 * `WorkoutContentRenderer` the Routine tab already uses, so an imported
 * routine previews exactly as it will read once saved.
 *
 * Two conditions block import, and only these two:
 *   - the body could not be parsed at all (`parsed.ok === false`, i.e. the
 *     text is over `MAX_RAW_TEXT_LENGTH` or the parser threw);
 *   - the body parsed but contains zero exercises, so saving it would create
 *     an empty routine.
 *
 * Line-level `problems` are surfaced but deliberately NOT blocking. They are
 * ordinary syntax errors in individual set rows, the note grammar preserves
 * those lines verbatim, and the editor lets you save a routine that has them —
 * so blocking here would make it impossible to re-import a routine Kilo itself
 * exported, which is a data-loss outcome, not a safety one.
 *
 * An A/B routine (a body containing a standalone `---` week separator) is
 * analyzed one week at a time, under `week`, because that is how the Routine
 * tab reads a saved routine back. Previewing both halves concatenated would
 * show the user a routine that does not exist anywhere in the app. The whole
 * body is still what gets saved — `week` selects the PREVIEW, never the write.
 *
 * @param {string} text  Raw pasted text, enveloped or bare.
 * @param {'A'|'B'=} week  Which half of an A/B routine to preview. Default 'A'.
 */
export function analyzeRoutineImportText(text, week = 'A') {
  const envelope = parseRoutineShareText(text);
  const body = envelope.body;
  const isBlank = body.trim() === '';
  // An unrecognized version is informational only: `parseRoutineShareText`
  // already degraded a future envelope to a best-effort body, and the body is
  // still just note text, so the preview and the import both proceed.
  const unknownVersion = envelope.hasEnvelope && envelope.version !== ROUTINE_SHARE_VERSION;
  // The full body decides IMPORTABILITY (an A/B routine whose week A is empty
  // is still a real routine), while the selected week decides what the preview
  // renders.
  const fullParsed = parseWorkoutNote(body);
  const hasABWeeks = (fullParsed.weekBStartIndex ?? null) !== null;
  const effectiveWeek = hasABWeeks ? (week === 'B' ? 'B' : 'A') : null;
  const previewText = hasABWeeks ? sliceRoutineWeekText(body, effectiveWeek) : body;
  const parsed = hasABWeeks ? parseWorkoutNote(previewText) : fullParsed;
  const sections = parsed.sections || [];
  const exerciseCount = countExercises(fullParsed.sections || []);

  const notices = [];
  if (unknownVersion) {
    notices.push({ severity: 'info', message: ROUTINE_IMPORT_UNKNOWN_VERSION_MESSAGE });
  }
  // Blocking and problem reporting read the FULL body, never the previewed
  // week: what gets saved is the whole routine, so a defect in week B must
  // block and be reported even while week A is on screen.
  if (!isBlank && fullParsed.ok === false) {
    notices.push({ severity: 'error', message: fullParsed.error });
  } else if (!isBlank && exerciseCount === 0) {
    notices.push({ severity: 'error', message: ROUTINE_IMPORT_NO_EXERCISES_MESSAGE });
  }
  const problems = fullParsed.problems || [];
  if (problems.length > 0) {
    notices.push({
      severity: 'warning',
      message: `${problems.length} line${problems.length === 1 ? '' : 's'} could not be read as sets. `
        + 'They are kept exactly as written and you can fix them after importing.',
    });
  }

  return {
    isBlank,
    hasEnvelope: envelope.hasEnvelope,
    version: envelope.version,
    unknownVersion,
    // The envelope title is a suggestion for the import screen's title field,
    // never an identity: import always creates a new routine, so a title that
    // collides with an existing one is not a conflict to resolve.
    envelopeTitle: envelope.title,
    exportedAt: envelope.exportedAt,
    body,
    // `parsed` describes the full body (what will be saved); `sections` is the
    // previewed week (what is on screen). For a non-A/B routine they are the
    // same parse.
    parsed: fullParsed,
    hasABWeeks,
    effectiveWeek,
    previewText,
    sections,
    problems,
    exerciseCount,
    notices,
    canImport: !isBlank && fullParsed.ok !== false && exerciseCount > 0,
  };
}

/**
 * Show the pre-share plain-text notice and, on acknowledgement, hand the
 * composed text to the platform share sheet. No backend, no file, no image.
 *
 * `deps` exists so tests can drive the flow without the native modules; the
 * app always uses the real RN `Alert`/`Share`, the same pair BackupScreen's
 * unencrypted-export path uses.
 */
export function shareRoutine({ title, rawText, exportedAt } = {}, deps = {}) {
  const alert = deps.alert || Alert.alert.bind(Alert);
  const share = deps.share || Share.share.bind(Share);
  const message = buildRoutineShareText({ title, rawText, exportedAt });
  alert(
    ROUTINE_SHARE_NOTICE_TITLE,
    ROUTINE_SHARE_NOTICE_BODY,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Share routine',
        onPress: () => {
          // A failed/dismissed share sheet is not an error worth a second
          // modal — the user simply backed out.
          Promise.resolve(share({ message })).catch(() => {});
        },
      },
    ],
  );
}

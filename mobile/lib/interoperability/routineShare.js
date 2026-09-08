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
// This is export only. The strip side exists so the round trip is provable in
// tests today, and so #581's Stage 2 import flow can reuse it unchanged.

// `Alert` comes from lib/platformAlert, never from react-native directly: the
// RN web Alert silently no-ops for multi-button dialogs, so a direct import
// would make the pre-share notice — and therefore sharing itself — dead on
// web (#721; guarded by tests/platform-alert.test.js).
import { Platform, Share } from 'react-native';
import { Alert } from '../platformAlert';
import { parseWorkoutNote } from '../parser/workoutNote';
import { parseExerciseHeader } from '../parser/deloadGenerator';
import { parseHeaderDeclaration } from '../parser/workoutRow';

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

// Image sharing has a separate allowlist. Never send a note or parsed section
// object to the renderer: those objects also hold annotations and raw rows.
export function buildRoutineShareSummary({ title, rawText, includeNumbers = false } = {}) {
  const parsed = parseWorkoutNote(String(rawText ?? ''));
  const sections = parsed.ok ? parsed.sections : [];
  return {
    title: normalizeTitleLine(title) || 'Untitled Routine',
    sections: sections.map((section, index) => ({
      week: parsed.weekBStartIndex == null ? null : (index < parsed.weekBStartIndex ? 'A' : 'B'),
      heading: section.heading || null,
      subheading: section.subheading || null,
      exercises: (section.exercises || []).map(exercise => {
        const declaration = parseExerciseHeader(exercise.raw_header);
        // A `2x60s` header parses as `2` sets of `60` under parseExerciseHeader,
        // which cannot tell a timed hold from a rep range. Ask the row grammar
        // whether the declaration is timed so the numbers below stay honest.
        const timed = parseHeaderDeclaration(exercise.raw_header)?.type === 'duration';
        const latest = (exercise.rows || []).filter(row => row.sets?.length).slice(-1)[0];
        const item = {
          name: exercise.name,
          setCount: declaration?.sets ?? latest?.sets.length ?? null,
        };
        if (includeNumbers) {
          const declaredRange = declaration ? { lo: declaration.repLo, hi: declaration.repHi } : null;
          item.repRange = timed ? null : declaredRange;
          // Only timed declarations get a hold range; a rep exercise keeps its
          // established `{ name, setCount, repRange, latestSets }` shape.
          if (timed) item.holdRange = declaredRange;
          item.latestSets = (latest?.sets || []).map(set => ({
            reps: set.rep_count ?? null,
            weight: set.weight_value ?? null,
            unit: set.weight_unit ?? null,
            // Timed holds carry seconds, not reps; only surface the key when the
            // row actually logged one so a rep-only set keeps its old shape.
            ...(set.duration_seconds != null ? { holdSeconds: set.duration_seconds } : null),
          })).filter(set => set.reps != null || set.weight != null || set.holdSeconds != null);
        }
        return item;
      }),
    })).filter(section => section.exercises.length > 0),
  };
}

// Capture only the redacted preview, never the surrounding routine screen.
// Load native modules at the point of use so a missing module in an older
// installed build cannot break the independent text-share action.
export async function shareRoutineImage(view, deps = {}) {
  const platform = deps.platform ?? Platform.OS;
  if (platform === 'web') {
    // view-shot 4's wrapper calls findNodeHandle, which RN Web no longer
    // supports. Capture the actual DOM ref with its web rasterizer directly.
    const capture = deps.capture || (async target => {
      const module = require('html2canvas');
      const html2canvas = module.default || module;
      const canvas = await html2canvas(target.current || target, { logging: false });
      return canvas.toDataURL('image/png');
    });
    const uri = await capture(view, { format: 'png', result: 'data-uri' });
    if (!uri.startsWith('data:image/png;base64,')) throw new Error('Image capture failed');
    if (deps.download) deps.download(uri);
    else {
      const link = document.createElement('a');
      link.href = uri;
      link.download = 'kilo-routine.png';
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    return;
  }
  const captureModule = deps.capture ? deps : require('react-native-view-shot');
  const capture = deps.capture || captureModule.captureRef;
  const sharing = deps.share ? deps : require('expo-sharing');
  const available = deps.available || sharing.isAvailableAsync;
  if (!await available()) throw new Error('Image sharing is unavailable');
  const share = deps.share || sharing.shareAsync;
  const release = deps.release || captureModule.releaseCapture;
  const uri = await capture(view, { format: 'png', result: 'tmpfile' });
  try {
    await share(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: 'Share routine image' });
  } finally {
    release(uri);
  }
}

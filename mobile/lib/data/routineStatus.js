import { countWorkoutSessions, countWorkoutSessionsFromSections, weeksSinceLastDeload } from '../parser.js';

// ── Canonical temporal helpers ────────────────────────────────────────────────

// Returns the start of a rolling N-day window ending on referenceDate, as 'YYYY-MM-DD'.
// Inclusive on both ends: rollingWindowStart(ref, 30) covers ref-date minus 29 days.
export function rollingWindowStart(referenceDate = new Date(), days = 30) {
  const pad = n => String(n).padStart(2, '0');
  const start = new Date(referenceDate);
  start.setDate(start.getDate() - (days - 1)); // setDate handles DST correctly
  return `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
}

// Session-depth window for repeated_weekday_skip detection.
// Counts only skips within the last N session cycles for each day slot.
export const REPEATED_WEEKDAY_SKIP_SESSION_WINDOW = 8;

// ── Routine depth ─────────────────────────────────────────────────────────────

// Returns the longest session chain across all exercises in sections.
// Per exercise: rows.length (plain rows + non-skipped session entries) plus the count
// of skipped session_entries (which appear in session_entries but not in rows). This
// handles mixed-format history and correctly counts skipped sessions in the depth total.
// Returns null when sections is absent (no routine loaded). Returns 0 when no entries logged.
export function computeWeeksIn(sections) {
  if (!sections) return null;
  let max = 0;
  for (const section of sections) {
    for (const ex of section.exercises) {
      const skippedCount = (ex.session_entries || []).filter(se => se.skipped).length;
      const depth = Math.max(ex.session_entries.length, (ex.rows || []).length + skippedCount);
      if (depth > max) max = depth;
    }
  }
  return max;
}

// ── Routine status (issue #282) ───────────────────────────────────────────────
// Canonical routine-status derivation for the Analytics surface. Built on the
// session chain (computeWeeksIn / countWorkoutSessionsFromSections) so the
// week metrics work for any routine — including legacy history and chains with
// no fatigue/check-in coverage. The deload-relative metrics reuse the parser
// primitives for elapsed calendar weeks, while sessions-since-deload is derived
// only from stored session anchors so deload date edits cannot move it.

// Total deload sessions logged across archived deload notes. Each completed
// deload is archived separately in deloadHistory with its own raw_text, so its
// logged session passes are added back to total routine exposure. Records
// without raw_text (legacy) contribute 0.
export function deloadSessionsLogged(deloadHistory) {
  if (!deloadHistory || deloadHistory.length === 0) return 0;
  return deloadHistory.reduce((sum, r) => sum + countWorkoutSessions(r?.raw_text || ''), 0);
}

// elapsedWeeks is a genuine calendar-week metric (Monday-anchored), not a
// session-pass count. It uses the routine's saved_at start, which is always
// present.
const _DAY_MS = 24 * 60 * 60 * 1000;
const _WEEK_MS = 7 * _DAY_MS;

// Monday-of-week UTC epoch for a 'YYYY-MM-DD...' ISO string.
function _mondayEpochFromIso(iso) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const dow = new Date(ms).getUTCDay();   // 0=Sun..6=Sat
  return ms - (((dow + 6) % 7) * _DAY_MS); // back up to Monday
}

// Monday-of-week UTC epoch for "now" (optionally injected for tests).
function _mondayEpochNow(nowMs) {
  const now = new Date(nowMs != null ? nowMs : Date.now());
  const ms = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dow = new Date(ms).getUTCDay();
  return ms - (((dow + 6) % 7) * _DAY_MS);
}

// Elapsed weeks: calendar weeks the routine has spanned since it began
// (note.saved_at), including inactive gaps. Monday-anchored and 1-based: the
// routine's first calendar week reads 1. Returns null without a start date, 0
// for a future start.
export function elapsedWeeksOnRoutine(note, nowMs) {
  const start = note?.saved_at;
  if (!start) return null;
  const startMon = _mondayEpochFromIso(start);
  const nowMon = _mondayEpochNow(nowMs);
  if (nowMon < startMon) return 0;
  return Math.round((nowMon - startMon) / _WEEK_MS) + 1;
}

function _deloadSessionAnchor(record) {
  if (record?.deload_session_ordinal != null) return Number(record.deload_session_ordinal);
  if (record?.session_count != null) return Number(record.session_count);
  return null;
}

// Returns the normalized pre-deload session count for comparison across records with
// different deload_session_ordinal semantics (old format vs new format vs no ordinal).
function _normalizedBoundary(record) {
  if (record?.deload_session_ordinal != null) {
    const ordinal = Number(record.deload_session_ordinal);
    const count = record?.session_count != null ? Number(record.session_count) : null;
    if (record.deload_ordinal_is_count) return ordinal;
    if (count != null && ordinal === count) return ordinal;
    return ordinal - 1;  // old format: ordinal = count+1; normalize to count
  }
  if (record?.session_count != null) return Number(record.session_count);
  return null;
}

// Latest deload for session-count analytics is the furthest routine anchor,
// not the newest calendar date. Date edits must not move sessionsSinceDeload.
// Comparison uses normalized pre-deload counts so old-format and new-format
// records rank on the same scale.
function _latestDeloadSessionRecord(deloadHistory) {
  if (!Array.isArray(deloadHistory) || !deloadHistory.length) return null;
  return deloadHistory.reduce((best, r) => {
    const boundary = _normalizedBoundary(r);
    if (!Number.isFinite(boundary)) return best;
    const bestBoundary = _normalizedBoundary(best);
    return !Number.isFinite(bestBoundary) || boundary > bestBoundary ? r : best;
  }, null);
}

// Single canonical entry point for the Analytics routine-status surface.
//
// Returns:
//   sessionsLogged:      total sessions on the routine, INCLUDING archived
//                        deload sessions (never reduced by deloads)
//   elapsedWeeks:        calendar weeks since the routine began, incl. gaps
//   sessionsSinceDeload: sessions after the latest deload boundary (excludes it)
//   weeksSinceDeload:    full weeks since the latest deload (null if no deload)
//
// Session-count analytics deliberately ignore completed_at.
//
// deload_session_ordinal semantics:
//   deload_ordinal_is_count=true  → ordinal = pre-deload count; formula: routineSessions - anchor
//   ordinal === session_count     → user entered count directly (bug/early); same formula
//   otherwise (old format)        → ordinal = first post-deload session; formula: routineSessions - anchor + 1
//   session_count (no ordinal)    → pre-deload count; formula: routineSessions - anchor
export function deriveRoutineStatus(currentSections, note, deloadHistory) {
  const routineSessions = countWorkoutSessionsFromSections(currentSections || []);
  const latestSessionRecord = _latestDeloadSessionRecord(deloadHistory);
  const anchor = _deloadSessionAnchor(latestSessionRecord);
  let sessionsSinceDeload;
  if (!Number.isFinite(anchor)) {
    sessionsSinceDeload = routineSessions;
  } else if (latestSessionRecord?.deload_session_ordinal != null) {
    const r = latestSessionRecord;
    const countSemantic = r.deload_ordinal_is_count ||
      (r.session_count != null && anchor === Number(r.session_count));
    sessionsSinceDeload = countSemantic
      ? Math.max(0, routineSessions - anchor)
      : Math.max(0, routineSessions - anchor + 1);
  } else {
    sessionsSinceDeload = Math.max(0, routineSessions - anchor);
  }
  return {
    sessionsLogged: routineSessions + deloadSessionsLogged(deloadHistory),
    elapsedWeeks: elapsedWeeksOnRoutine(note),
    sessionsSinceDeload,
    weeksSinceDeload: weeksSinceLastDeload(deloadHistory),
  };
}

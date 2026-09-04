// Pure state/transition logic for the optional background-safe rest timer
// (#577). No expo-notifications imports here — everything is plain data
// in/out so it can be unit-tested without native modules. The side-effect
// layer lives in lib/restTimerScheduler.js.

const RECORD_VERSION = 1;
// A record whose endsAtMs is this far in the past is treated as stale/
// corrupt rather than "just barely missed" (#577 review: never replay a
// banner for something that elapsed long before this launch).
const MAX_SANE_PAST_MS = 1000 * 60 * 60 * 24; // 24h
const MAX_SANE_FUTURE_MS = 1000 * 60 * 60 * 24; // 24h — guards a corrupt future timestamp too

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// Fresh opaque per-start identity, used as the generation/dedup key so a
// late completion from a replaced/cancelled timer can never affect the
// current one.
export function generateTimerId() {
  return `rt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// Builds a fresh persisted record for a newly started timer.
export function startTimerRecord({ durationSec, exerciseLabel = null, nowMs = Date.now() }) {
  const timerId = generateTimerId();
  const startedAtMs = nowMs;
  const endsAtMs = startedAtMs + durationSec * 1000;
  return {
    version: RECORD_VERSION,
    timerId,
    startedAtMs,
    durationSec,
    endsAtMs,
    exerciseLabel,
    notificationId: null,
    // #950 review (P2): whether a background OS notification was actually
    // scheduled for THIS timer (permission granted + schedule succeeded) —
    // not merely whether the platform supports scheduling one at all. This
    // is what RestTimerBanner's "Background alert unavailable" warning must
    // reflect, and it is persisted with the record so a resumed/cold-started
    // timer still reports its true alert status, not a re-guessed default.
    notificationScheduled: false,
  };
}

// Validates a raw parsed record. Returns null (never throws) for anything
// malformed or implausible so a corrupted/stale AsyncStorage value is
// treated exactly like "no timer" rather than crashing or resurrecting
// garbage state.
export function normalizeRestTimerRecord(raw, nowMs = Date.now()) {
  if (!raw || typeof raw !== 'object') return null;
  const { version, timerId, startedAtMs, durationSec, endsAtMs, exerciseLabel, notificationId, notificationScheduled } = raw;
  if (version !== RECORD_VERSION) return null;
  if (typeof timerId !== 'string' || timerId.length === 0) return null;
  if (!isFiniteNumber(startedAtMs) || !isFiniteNumber(durationSec) || !isFiniteNumber(endsAtMs)) return null;
  if (durationSec <= 0) return null;
  if (Math.round(startedAtMs + durationSec * 1000) !== Math.round(endsAtMs)) return null;
  if (endsAtMs < nowMs - MAX_SANE_PAST_MS) return null;
  if (endsAtMs > nowMs + MAX_SANE_FUTURE_MS) return null;
  return {
    version: RECORD_VERSION,
    timerId,
    startedAtMs,
    durationSec,
    endsAtMs,
    exerciseLabel: typeof exerciseLabel === 'string' ? exerciseLabel : null,
    notificationId: typeof notificationId === 'string' ? notificationId : null,
    notificationScheduled: notificationScheduled === true,
  };
}

// Remaining ms, always clamped at 0. No interval counter is ever
// authoritative — every tick/resume recomputes this from the record and the
// current wall clock, so backgrounding, restart, and a manual clock change
// all resolve to the same correct value.
export function remainingMs(record, nowMs = Date.now()) {
  if (!record) return 0;
  return Math.max(0, record.endsAtMs - nowMs);
}

export function isElapsed(record, nowMs = Date.now()) {
  return !!record && remainingMs(record, nowMs) === 0;
}

// "Elapsed long ago" — used to decide whether a resumed/cold-started app
// should treat a past-due record as something to still surface (recently
// elapsed) or just silently clear (elapsed so long ago it's not a live
// event any more). Threshold is deliberately the same generous window as
// MAX_SANE_PAST_MS validation, kept as its own export so callers don't
// hardcode the number twice.
const REPLAY_WINDOW_MS = 1000 * 60 * 2; // 2x a typical short rest is well past this
export function elapsedRecently(record, nowMs = Date.now()) {
  if (!record) return false;
  const overdueMs = nowMs - record.endsAtMs;
  return overdueMs >= 0 && overdueMs <= REPLAY_WINDOW_MS;
}

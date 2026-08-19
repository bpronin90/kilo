// Sync/bootstrap recovery state store (Phase 4 / Task 12).
//
// Scope note: this module owns the *user-facing recovery state* for cloud
// bootstrap and offline sync — not the sync algorithm itself. The actual
// bootstrap and last-write-wins sync engines land in their own tasks (#319,
// #320); when those exist they drive this store by calling `markRunning`,
// `markComplete`, and `markFailed`. Until then the store still gives the UI a
// truthful "idle/running/failed/complete" surface and a retry affordance.
//
// Retry contract: `retryPhase(phase, runner)` simply re-invokes the
// caller-provided runner (the bootstrap or sync operation). It does NOT mutate
// local data. A runner that fails leaves the phase in `failed` with the
// captured error, and local AsyncStorage is untouched — recovery is
// non-destructive and repeatable. This preserves the roadmap rule that a failed
// bootstrap leaves local state intact.
//
// Bootstrap gating: whether bootstrap may run is decided by the local-data
// owner marker in `storage/entries/localDataOwner.js` (#450), which replaced
// the old per-user `kilo_sync_bootstrapped_<userId>` markers this module used
// to own.

import { secureStorage as AsyncStorage } from './secureStorage';

const LAST_SUCCESS_KEY = 'kilo_sync_last_success_at';

let cachedLastSuccessfulSyncAt = null;
let lastSuccessfulSyncLoaded = false;

// Status vocabulary surfaced to the user.
export const SYNC_STATUS = Object.freeze({
  IDLE: 'idle',
  RUNNING: 'running',
  FAILED: 'failed',
  COMPLETE: 'complete',
});

// The two recovery phases the user can see and retry.
export const SYNC_PHASE = Object.freeze({
  BOOTSTRAP: 'bootstrap',
  SYNC: 'sync',
});

function makePhaseState() {
  return {
    status: SYNC_STATUS.IDLE,
    error: null,
    updatedAt: null,
    // True once a runner has failed and not yet succeeded, so the UI can offer
    // a retry without exposing any other recovery controls.
    retryable: false,
  };
}

const state = {
  [SYNC_PHASE.BOOTSTRAP]: makePhaseState(),
  [SYNC_PHASE.SYNC]: makePhaseState(),
};

let listeners = [];

function isPhase(phase) {
  return phase === SYNC_PHASE.BOOTSTRAP || phase === SYNC_PHASE.SYNC;
}

// ── phase run ownership (issue #813 review) ──────────────────────────────────
//
// A run may outlive the phase it started: a sync pass can still be in flight
// when the user signs out (which resets the phase) and signs back in (which
// starts a NEW pass). Status alone cannot tell those two runs apart — the second
// pass's `running` looks exactly like the first pass's own — so a late settle
// from the first would publish one run's outcome, and a `last successful sync`
// timestamp, for a different run that is still in flight.
//
// Every run therefore gets a token, and every transition — a run starting, a
// settle, a reset on sign-out — claims a fresh one, permanently staling any
// token handed out before it. A run that presents a stale token cannot settle
// the phase: whoever claimed it after that run started owns the outcome now.
let nextRunToken = 1;
const runTokens = {
  [SYNC_PHASE.BOOTSTRAP]: 0,
  [SYNC_PHASE.SYNC]: 0,
};

function claimPhase(phase) {
  runTokens[phase] = nextRunToken;
  nextRunToken += 1;
  return runTokens[phase];
}

// True when `token` identifies the run that currently owns `phase`. A token is
// never reused, so this is false for every run that has been superseded.
export function phaseRunIsCurrent(phase, token) {
  return isPhase(phase) && token != null && runTokens[phase] === token;
}

// Start a run of `phase`: mark it running and return the ownership token the run
// must present to settle it. Use this rather than a bare `markRunning` whenever
// the run is async and could still be in flight when something else (sign-out,
// a later pass) takes the phase over.
export function beginPhaseRun(phase) {
  if (!isPhase(phase)) return null;
  markRunning(phase);
  return runTokens[phase];
}

function notify() {
  const snapshot = getSyncState();
  for (const l of listeners) {
    try {
      l(snapshot);
    } catch (e) {
      console.warn('[syncQueue] listener error', e);
    }
  }
}

// Returns a defensive copy of the full recovery state for both phases.
export function getSyncState() {
  return {
    [SYNC_PHASE.BOOTSTRAP]: { ...state[SYNC_PHASE.BOOTSTRAP] },
    [SYNC_PHASE.SYNC]: { ...state[SYNC_PHASE.SYNC] },
  };
}

// Subscribe to recovery-state changes. Returns an unsubscribe function.
export function subscribeSyncState(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function markRunning(phase) {
  if (!isPhase(phase)) return getSyncState();
  claimPhase(phase);
  state[phase] = {
    status: SYNC_STATUS.RUNNING,
    error: null,
    updatedAt: new Date().toISOString(),
    retryable: false,
  };
  notify();
  return getSyncState();
}

// `token` is optional: pass the token returned by `beginPhaseRun` to settle the
// phase only while this run still owns it. Omit it for a direct, unconditional
// transition that belongs to no run (e.g. marking bootstrap complete because the
// device already owns its data).
export function markComplete(phase, { token } = {}) {
  if (!isPhase(phase)) return getSyncState();
  if (token != null && !phaseRunIsCurrent(phase, token)) return getSyncState();
  claimPhase(phase);
  const now = new Date().toISOString();
  state[phase] = {
    status: SYNC_STATUS.COMPLETE,
    error: null,
    updatedAt: now,
    retryable: false,
  };
  if (phase === SYNC_PHASE.SYNC) {
    cachedLastSuccessfulSyncAt = now;
    lastSuccessfulSyncLoaded = true;
    AsyncStorage.setItem(LAST_SUCCESS_KEY, now).catch(() => {});
  }
  notify();
  return getSyncState();
}

// `token` follows the same optional-ownership rule as `markComplete`.
export function markFailed(phase, error, { token } = {}) {
  if (!isPhase(phase)) return getSyncState();
  if (token != null && !phaseRunIsCurrent(phase, token)) return getSyncState();
  claimPhase(phase);
  const message =
    error == null
      ? 'Unknown error'
      : typeof error === 'string'
      ? error
      : error.message || String(error);
  state[phase] = {
    status: SYNC_STATUS.FAILED,
    error: message,
    updatedAt: new Date().toISOString(),
    retryable: true,
  };
  notify();
  return getSyncState();
}

// Reset a phase back to idle. Used when a phase no longer applies (e.g. user
// signs out and returns to local-only mode).
export function resetPhase(phase) {
  if (!isPhase(phase)) return getSyncState();
  // Claim the phase so a run that is still in flight across this reset (a sync
  // pass outliving sign-out) can no longer settle it.
  claimPhase(phase);
  state[phase] = makePhaseState();
  if (phase === SYNC_PHASE.SYNC) {
    cachedLastSuccessfulSyncAt = null;
    lastSuccessfulSyncLoaded = true;
    AsyncStorage.removeItem(LAST_SUCCESS_KEY).catch(() => {});
  }
  notify();
  return getSyncState();
}

export async function loadLastSuccessfulSyncAt() {
  if (lastSuccessfulSyncLoaded) {
    return cachedLastSuccessfulSyncAt;
  }
  try {
    const raw = await AsyncStorage.getItem(LAST_SUCCESS_KEY);
    cachedLastSuccessfulSyncAt = raw || null;
  } catch {
    cachedLastSuccessfulSyncAt = null;
  }
  lastSuccessfulSyncLoaded = true;
  return cachedLastSuccessfulSyncAt;
}

// Run (or retry) a phase runner with non-destructive failure handling.
//
// `runner` is the async bootstrap/sync operation provided by the caller. This
// store does not know how to bootstrap or sync; it only sequences the status
// transitions around the runner and captures failures so the user can retry.
//
// Returns { ok: true, result } or { ok: false, error }. On failure the phase is
// left in `failed`/`retryable` and local data is never touched by this module.
export async function runPhase(phase, runner) {
  if (!isPhase(phase)) {
    return { ok: false, error: `Unknown sync phase: ${phase}` };
  }
  if (typeof runner !== 'function') {
    return { ok: false, error: 'No sync runner provided' };
  }
  // The runner is async, so this run can be superseded while it is in flight.
  // The returned {ok} still describes THIS runner's outcome — only the published
  // phase state is withheld once another run owns the phase.
  const token = beginPhaseRun(phase);
  try {
    const result = await runner();
    // Allow a runner to signal a recoverable failure via { ok: false }.
    if (result && result.ok === false) {
      markFailed(phase, result.error || 'Sync failed', { token });
      return { ok: false, error: result.error || 'Sync failed' };
    }
    markComplete(phase, { token });
    return { ok: true, result };
  } catch (e) {
    markFailed(phase, e, { token });
    return { ok: false, error: e?.message || String(e) };
  }
}

// Retry alias. Identical to runPhase; named for call-site clarity at the UI
// retry affordance.
export function retryPhase(phase, runner) {
  return runPhase(phase, runner);
}

// Test/teardown helper: clear all state and listeners.
export function __resetSyncQueue() {
  // Claim rather than zero the tokens: a run left over from the previous test
  // must not be able to settle a phase in the next one, and tokens are never
  // reused because the counter keeps advancing.
  claimPhase(SYNC_PHASE.BOOTSTRAP);
  claimPhase(SYNC_PHASE.SYNC);
  state[SYNC_PHASE.BOOTSTRAP] = makePhaseState();
  state[SYNC_PHASE.SYNC] = makePhaseState();
  cachedLastSuccessfulSyncAt = null;
  lastSuccessfulSyncLoaded = false;
  listeners = [];
}

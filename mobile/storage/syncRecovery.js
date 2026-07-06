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
// Bootstrap marker: `isBootstrapped(userId)` / `setBootstrapped(userId)` persist
// a per-user AsyncStorage flag so repeated app launches don't re-upload already-
// bootstrapped local history (#432). The marker is set only after a successful
// bootstrap; a failed bootstrap leaves it unset so the next launch retries.

import AsyncStorage from '@react-native-async-storage/async-storage';

const BOOTSTRAP_MARKER_PREFIX = 'kilo_sync_bootstrapped_';
const LAST_SUCCESS_KEY = 'kilo_sync_last_success_at';

let cachedLastSuccessfulSyncAt = null;
let lastSuccessfulSyncLoaded = false;

// Returns true if this device has already successfully bootstrapped for userId.
export async function isBootstrapped(userId) {
  if (!userId) return false;
  try {
    const val = await AsyncStorage.getItem(`${BOOTSTRAP_MARKER_PREFIX}${userId}`);
    return val === 'true';
  } catch {
    return false;
  }
}

// Persist the bootstrap-completed marker for userId. Non-critical: if the write
// fails, the worst case is an extra bootstrap attempt on the next launch, which
// is safe because bootstrap upserts are idempotent.
export async function setBootstrapped(userId) {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(`${BOOTSTRAP_MARKER_PREFIX}${userId}`, 'true');
  } catch {
    // Intentionally swallowed — see comment above.
  }
}

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
  state[phase] = {
    status: SYNC_STATUS.RUNNING,
    error: null,
    updatedAt: new Date().toISOString(),
    retryable: false,
  };
  notify();
  return getSyncState();
}

export function markComplete(phase) {
  if (!isPhase(phase)) return getSyncState();
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

export function markFailed(phase, error) {
  if (!isPhase(phase)) return getSyncState();
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
  markRunning(phase);
  try {
    const result = await runner();
    // Allow a runner to signal a recoverable failure via { ok: false }.
    if (result && result.ok === false) {
      markFailed(phase, result.error || 'Sync failed');
      return { ok: false, error: result.error || 'Sync failed' };
    }
    markComplete(phase);
    return { ok: true, result };
  } catch (e) {
    markFailed(phase, e);
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
  state[SYNC_PHASE.BOOTSTRAP] = makePhaseState();
  state[SYNC_PHASE.SYNC] = makePhaseState();
  cachedLastSuccessfulSyncAt = null;
  lastSuccessfulSyncLoaded = false;
  listeners = [];
}

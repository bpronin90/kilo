// Privacy-safe cold-start phase timing (#809). Each mark is a fixed phase NAME
// plus an elapsed-ms NUMBER, logged to the console only — nothing here is
// persisted or sent over the network, and no workout content, health values,
// credentials, decrypted payloads, or user identifiers are ever captured.
// Used to compare the initial weight/note reads, weight-goal hydration,
// tracked-lift hydration, recovery-state hydration, and encrypted-storage
// migration against each other when reproducing the Home cold-launch skeleton
// on a device.
let startedAt = Date.now();
let marks = [];

// Device-read fan-out counters (#818). The phase marks above answer "when did
// each phase finish"; they cannot answer "how much of that interval was the
// same encrypted value being read more than once", which is what actually
// dominated the launch path. These are COUNTS only — never a key name, a
// value, or a size — and like the marks they are compiled out of release
// builds, never persisted, and never transmitted.
let storageReads = { issued: 0, coalesced: 0 };
// Device-key validation counters (#1364): how many launches proved the key by
// the constant-time canary versus the full-store envelope scan. Counts only.
let keyChecks = { canary: 0, scan: 0 };
// Journal replay starts (#1366). Counts only.
let reconcileStarts = 0;

// Exported for tests: pins the reference instant a "cold start" is measured
// from, since module import time (the real cold-start signal) is not
// controllable from a test.
export function resetStartupTiming(now = Date.now()) {
  startedAt = now;
  marks = [];
  storageReads = { issued: 0, coalesced: 0 };
  keyChecks = { canary: 0, scan: 0 };
  reconcileStarts = 0;
}

export function markStartupPhase(name, now = Date.now()) {
  // No-op in production, not just quiet: this is called on every reload (not
  // only at startup), including every write/broadcast for the lifetime of the
  // app, so an unguarded push would grow `marks` forever with objects no
  // production consumer ever reads.
  if (typeof __DEV__ === 'undefined' || !__DEV__) return null;
  const elapsedMs = now - startedAt;
  marks.push({ name, elapsedMs });
  // eslint-disable-next-line no-console
  console.log(`[startup] ${name}: ${elapsedMs}ms`);
  return elapsedMs;
}

export function getStartupTimingMarks() {
  return marks.slice();
}

// Called from the device-storage boundary on every read (#818). `coalesced` is
// true when the read was served by an already in-flight read of the same key
// rather than costing another decrypt. Guarded the same way markStartupPhase
// is, and for the same reason: this runs for the life of the app, not only at
// startup, so production must not pay for it at all.
export function recordStartupStorageRead(coalesced) {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  if (coalesced) storageReads.coalesced += 1;
  else storageReads.issued += 1;
}

export function getStartupStorageReadCounts() {
  return { ...storageReads };
}

// `kind` is 'canary' or 'scan'. Same dev-only guard as the read counters.
export function recordStartupKeyCheck(kind) {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  if (kind === 'canary' || kind === 'scan') keyChecks[kind] += 1;
}

export function getStartupKeyCheckCounts() {
  return { ...keyChecks };
}

// One fixed-name line, emitted next to `home:first-paint`, so a device trace
// shows how many device reads the launch actually paid for and how many were
// avoided — the interval the phase marks alone could not isolate.
export function markStartupStorageReads(now = Date.now()) {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return null;
  const elapsedMs = now - startedAt;
  // eslint-disable-next-line no-console
  console.log(`[startup] storage:reads: issued=${storageReads.issued} coalesced=${storageReads.coalesced} keycheck:canary=${keyChecks.canary} keycheck:scan=${keyChecks.scan} reconcile:starts=${reconcileStarts} at ${elapsedMs}ms`);
  return { ...storageReads, keyChecks: { ...keyChecks }, reconcileStarts };
}

// ── first-usable-paint scheduling (#1366) ─────────────────────────────────────
//
// NOT dev-only, unlike everything above: this is the one production contract
// that keeps background startup work (Recovery journal replay, the automatic
// cloud sync, reminder reconciliation) off the storage queues until Home has
// painted from local data. The shell holds it during its first render — before
// any child effect can start a read. Home claims it while rendering, which
// cancels the fallback timer: from then on only Home's first paint (or Home
// unmounting) releases it, however long local hydration takes. The fallback
// only covers a shell whose Home never mounts.
const STARTUP_HOLD_FALLBACK_MS = 2500;
let backgroundHold = null;
let backgroundWaiters = [];

export function holdStartupBackgroundWork(fallbackMs = STARTUP_HOLD_FALLBACK_MS) {
  if (backgroundHold) return;
  const hold = {};
  hold.timer = setTimeout(() => releaseHold(hold), fallbackMs);
  hold.timer?.unref?.();
  backgroundHold = hold;
}

export function isStartupBackgroundWorkHeld() {
  return !!backgroundHold;
}

// Home's claim: cancels the fallback and returns the release for THIS hold
// only, so a Home unmounting after a wipe remount re-held cannot release the
// new shell's hold.
export function claimStartupFirstPaint() {
  const hold = backgroundHold;
  if (!hold) return () => {};
  clearTimeout(hold.timer);
  return () => releaseHold(hold);
}

// Runs `task` now when nothing is held; otherwise once the hold is released, in
// a later macrotask so it lands after the paint that released it rather than
// inside that commit. Returns a cancel function.
export function whenStartupBackgroundWorkReleased(task) {
  if (!backgroundHold) {
    task();
    return () => {};
  }
  const entry = { task };
  backgroundWaiters.push(entry);
  return () => { backgroundWaiters = backgroundWaiters.filter(e => e !== entry); };
}

export function releaseStartupBackgroundWork() {
  if (backgroundHold) releaseHold(backgroundHold);
}

function releaseHold(hold) {
  if (backgroundHold !== hold) return;
  clearTimeout(hold.timer);
  backgroundHold = null;
  const waiters = backgroundWaiters;
  backgroundWaiters = [];
  if (waiters.length === 0) return;
  setTimeout(() => {
    for (const { task } of waiters) {
      try { task(); } catch { /* one waiter cannot starve the rest */ }
    }
  }, 0);
}

// Journal replay starts (#1366): a count, reported with the read counters so a
// trace shows whether replay ran before `home:first-paint`.
export function recordStartupReconcileStart() {
  reconcileStarts += 1;
  if (typeof __DEV__ !== 'undefined' && __DEV__) markStartupPhase('recovery:reconcile:start');
}

export function getStartupReconcileStartCount() {
  return reconcileStarts;
}

// Test seam: drop any hold, parked task, and replay count.
export function _resetStartupScheduling() {
  if (backgroundHold) clearTimeout(backgroundHold.timer);
  backgroundHold = null;
  backgroundWaiters = [];
  reconcileStarts = 0;
}

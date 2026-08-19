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

// Exported for tests: pins the reference instant a "cold start" is measured
// from, since module import time (the real cold-start signal) is not
// controllable from a test.
export function resetStartupTiming(now = Date.now()) {
  startedAt = now;
  marks = [];
  storageReads = { issued: 0, coalesced: 0 };
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

// One fixed-name line, emitted next to `home:first-paint`, so a device trace
// shows how many device reads the launch actually paid for and how many were
// avoided — the interval the phase marks alone could not isolate.
export function markStartupStorageReads(now = Date.now()) {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return null;
  const elapsedMs = now - startedAt;
  // eslint-disable-next-line no-console
  console.log(`[startup] storage:reads: issued=${storageReads.issued} coalesced=${storageReads.coalesced} at ${elapsedMs}ms`);
  return { ...storageReads };
}

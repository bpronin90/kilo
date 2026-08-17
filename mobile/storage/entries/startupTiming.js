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

// Exported for tests: pins the reference instant a "cold start" is measured
// from, since module import time (the real cold-start signal) is not
// controllable from a test.
export function resetStartupTiming(now = Date.now()) {
  startedAt = now;
  marks = [];
}

export function markStartupPhase(name, now = Date.now()) {
  const elapsedMs = now - startedAt;
  marks.push({ name, elapsedMs });
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    // eslint-disable-next-line no-console
    console.log(`[startup] ${name}: ${elapsedMs}ms`);
  }
  return elapsedMs;
}

export function getStartupTimingMarks() {
  return marks.slice();
}

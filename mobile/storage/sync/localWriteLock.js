// One shared lock for LOCAL storage writes that must not interleave (#1393).
//
// A diff sync pass writes merged rows and push acks back into local storage
// through several awaited storage operations. If a Track/untrack lands between
// them, the write-back can overwrite it, and the pass's snapshot then hides the
// overwrite from the next diff. So the write-back (re-read plus apply) and the
// tracked-lift write queue both run inside this lock. Each one is then entirely
// before or entirely after the other.
//
// Rules for holders, which together are what make deadlock impossible:
//   * hold it only across local storage operations, never a network call;
//   * never wait on another queue (the tracked-lift write queue, a sync pass)
//     while holding it. A sync request made after a write is fire-and-forget
//     and is issued only after the lock is released.
// Not re-entrant: a holder that calls withLocalWriteLock again would wait on
// itself. No current path does.
//
// A holder that throws rejects its own caller only; the chain moves on to the
// next holder, so one failed write never wedges every later one.

let tail = Promise.resolve();

export function withLocalWriteLock(fn) {
  const run = tail.then(() => fn());
  tail = run.then(
    () => {},
    () => {}
  );
  return run;
}

// Test-only: drop any holder left behind by a previous test.
export function __resetLocalWriteLockForTests() {
  tail = Promise.resolve();
}

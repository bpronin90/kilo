# Test Coverage and Performance Evidence

For maintainers assessing what the suite proves and what still needs device evidence. Historical benchmark measurements retain their original issue context and do not claim current device timings.

## Automated Coverage Inventory

The test files are the executable source of truth. Use these commands for the
exact current inventory instead of maintaining a prose list of every assertion:

```sh
npm --prefix mobile test -- --listTests
rg -n '^select plan\(' supabase/tests
node --test scripts/*.test.mjs
```

Coverage is organized by boundary:

| Area | Primary locations |
|------|-------------------|
| Parsing and workout calculations | `mobile/tests/parser*.test.js`, `mobile/tests/data*.test.js`, and focused analytics/recovery suites |
| Weight, goals, units, and plate math | weight, unit-display, units, format, and plate-math suites under `mobile/tests/` |
| Local storage, backup, and migration | storage, secure-storage, backup/import, and recovery-journal suites |
| Cloud bootstrap and sync | bootstrap-cloud, offline-sync, sync-queue, auto-sync, sync-recovery, and cloud transport suites |
| Auth, consent, and account lifecycle | auth-session, health-consent, consent-gate, account-lifecycle, Turnstile, and bounded-write suites |
| Screen and component contracts | app shell, Home, Log, Weight, Analytics, More sub-screen, theme, navigation, and modal suites |
| Notifications and diagnostics | reminders, scheduler, app-update, and error-reporting suites |
| Repository tooling | Node tests beside review, changelog, migration, deployment, monitoring, security-event, and security-delivery scripts |
| Database security and concurrency | planned SQL tests under `supabase/tests/` |
| Shared Edge Function contracts | tests beside `supabase/functions/_shared/` and focused deployment scripts |

The mobile suite includes pure unit tests, storage and hook integration tests,
`react-test-renderer` interaction tests, and narrow source-contract tests.
Source-contract tests protect wiring that is difficult to render in Jest; they
are not substitutes for behavioral coverage when behavior can be exercised
directly.

Database setup and pgTAP execution are owned by [Automated Tests](automated-tests.md#running-automated-tests).

### Cloud sync cost regressions

Sync latency is dominated by device-storage volume and serialized round trips,
not by algorithmic wall time, so the guards are written as assertions on *how
much work a pass does* rather than as timing thresholds (which are unstable in
CI). They live beside the behavioral sync coverage:

- `mobile/tests/sync-queue.test.js` — the dirty queue persists a whole batch in
  one write and lands the same queue a record-by-record loop would; a failed
  push leaves the entire batch armed with the cursor unmoved and no baseline
  claimed; the baseline is recorded from what `writeLocal` persisted; an
  unchanged baseline is not rewritten, a changed one is, and a baseline removed
  underneath the engine is re-persisted.
- `mobile/tests/recovery-repair.test.js` — persisted Recovery repair (#1368)
  through the real reconcile boundary, dirty queue, and authoritative read: the
  four repairs, deterministic permuted-order convergence, idempotent second
  passes, byte-identical retention of missing-parent / malformed / duplicate-id /
  unsafe-ordinal data, a verified read that excludes unresolved records with an
  `unresolvedCount` notice and Retry, mode-relevant unresolved data giving
  first-load ERROR and refresh STALE with last-known-good plus exact-pass
  denial, malformed data still failing closed, dependent-action gating (an
  unrelated edit runs, actions touching the unresolved block/week/note are
  refused with zero writes, a global start is refused only when mode-relevant),
  reserved ordinal slots, compare-and-set against a concurrent writer, cloud
  resolution applying the same guards, guarded actions performing no repair
  writes, and read/write/enqueue/verification failure injection.
- `mobile/tests/sync-recovery.test.js` — with independent tables running
  concurrently, a note is still pushed before the recovery block whose baseline
  names it and a block before its memberships; a failure in one independent
  table still fails the pass and still stops the dependent recovery collections
  from being attempted, while unrelated tables complete; overlapping `sync()`
  calls still resolve to a single pass. Two further cases cover work that exists
  only in memory when something goes wrong: an entry saved while a pass is
  holding its copy survives that pass's whole-table write even when the pass then
  fails, and a note tombstone deferred by a table that succeeded still reaches
  the dirty queue when a sibling table fails the pass. Both were verified by
  disabling their fix and confirming the test fails.

To profile a pass, drive `syncAdapter.sync()` against `createSupabaseTransport`
with a fake Supabase client that delays each `rpc`/`upsert`/`auth` call by a
chosen RTT, and wrap the AsyncStorage jest mock so every `getItem`/`setItem`
performs the same AES-GCM envelope `secureStorage` applies on device. Count round
trips and bytes per storage key; those are reproducible, whereas wall time is
not. Such a harness records counts, byte sizes, table names, and timings only —
never payload content, which would put workout text and health values into test
output.

### Home cold-launch latency (#809)

The multi-second Home skeleton on cold launch traced to two blocking phases
ahead of first paint, not to Cloud Sync's own latency (already fixed by #806):

- `secureStorage.migrateKiloData()` ran its `getAllKeys()` + per-key
  `getItem()` scan on every cold start, and every other storage read is
  serialized behind it through the module's single operation-lock queue.
  `mobile/tests/secure-storage.test.js` and `mobile/tests/home-startup-latency.test.js`
  assert the scan runs at most once per device (a persisted marker short-circuits
  every later launch to a single `getItem()`).
- `useWeightEntries`/`useWorkoutNotes` gated their first read behind
  `maybeSyncCloud()` — a network round trip — before ever touching local
  storage. `mobile/tests/home-startup-latency.test.js` asserts both hooks paint
  existing on-device data while an in-flight `maybeSyncCloud()` mock is still
  unresolved.

What remained of the launch stall after #809 was the size of the notebook
each of those reads decrypts; see the next section.

Cold-launch phase marks (weight/note reads, weight-goal hydration,
tracked-lift hydration, recovery-state hydration, encrypted-storage migration,
and `app:local-ready`) are logged via `console.log` — and only collected in
memory at all — when `__DEV__` is true, from
`mobile/storage/entries/startupTiming.js`; a release build sets `__DEV__` to
false, so it never emits or retains them. Never sent over the network or
persisted, and carrying only a phase name and an elapsed-ms number.

To read the phase-by-phase `[startup] <phase>: <ms>ms` trace, install a
**debug or dev-client build** (not a release build — its logging is
compiled out), force-stop the app, launch it, and read the lines between
`migration:requested` and `app:local-ready` from `adb logcat` or the
Metro/dev-client console. To measure the overall wall-clock number the
acceptance criteria ask for, install a **release build** instead, force-stop
the app, and time from launch to the skeleton being replaced by real content
with a stopwatch or screen recording — the phase marks are diagnostic only
and are not required for that number.

### Device-key validation off the cold-launch path (#1364)

`probeDeviceKey()` (Home mount) used to decrypt every stored `kilo_` envelope,
including Cloud Sync dirty queues, cursors, and snapshots, on every cold start.
It now reads and authenticates one encrypted canary. Coverage:

- `mobile/tests/secure-storage.test.js` (`constant-time device-key canary`):
  valid-canary launch with zero `getAllKeys()` and one validation read; one-time
  legacy scan then canary-only relaunch; an unreadable legacy envelope never gets
  a canary; missing key, stale valid-length key, and malformed / truncated /
  tampered / wrong-plaintext canaries all latch, preserve data, and refuse
  writes; fresh install; canary persistence failure and transient canary read
  failure stay retryable; wipe and `clearDeviceKey()`.
- `mobile/tests/device-key-recovery.test.js` (`device-key canary across
  recovery`): recovery commits a matching canary, a failed recovery leaves the
  orphaned canary and key untouched, and an interrupted commit rolls forward to a
  matching key and canary.
- `mobile/tests/home-startup-latency.test.js`: on a populated cold launch every
  raw backing `getItem()` is accounted for by the startup read counters plus the
  canary and the two plain markers, and `getAllKeys()` is never called.

The dev-only `[startup] storage:reads:` line now also reports
`keycheck:canary=<n> keycheck:scan=<n>`; an ordinary launch shows `canary=1
scan=0`, and a legacy first launch after upgrade shows `scan=1`. Counts only.

### Local-first startup (#1366)

Home's first usable paint waits only on bounded local reads; Recovery journal
replay, the automatic sync, and the reminder reconcile start after it.
Coverage:

- `mobile/tests/home-screen.test.js` (`local-first startup (#1366)`): the real
  Home plus a hidden-tab stand-in mounting the Log/Analytics Recovery hooks,
  under the shell's hold. Recovery, Normal, and Deload paint from persisted data
  with zero journal reads and zero replay starts at paint, and mutations stay
  ineligible until reconciliation; a corrupt journal, an inconsistent persisted
  snapshot, a malformed tombstone marker the filtered reader would hide, and
  unreadable Recovery data show unknown (never Normal) with the
  weight card still painted; an early `ensureVerifiedRecoveryState` reconciles
  immediately; a slow local hydration keeps the hold past the fallback until
  Home paints; a wipe mid-replay publishes nothing.
- `mobile/tests/app-startup.test.js`: the real App holds the automatic sync
  (auth seen as loading) and the reminder reconcile until release.
- `mobile/tests/active-training-context.test.js`: provisional derivation and
  its consistency rules.

The dev-only `[startup] storage:reads:` line also reports
`reconcile:starts=<n>`; an ordinary launch shows `0` at `app:local-ready`, and
`recovery:reconcile:start` is logged after it. Device traces (force-stopped cold
launch, populated data, Recovery offline and sync-enabled) are still to be
captured on a real Android build.

### Persisted parser cache and sync fan-out (#813)

The app-wide lag that survived #806 and #809 traced to payload, not to the
network: the sync merge attached the parser's full output (`derived_sections`)
to every workout note a device had ever pushed, and that field is roughly one
hundred times the size of the note text. Every notebook read and write, every
sync pass (notebook plus baseline), and every backup then decrypted or
encrypted it in pure JS on the UI thread. On top of that, one write broadcast
ran one full sync pass per mounted hook instance, and each instance read the
notebook twice at mount even in local mode. Coverage:

- `mobile/tests/derived-sections-cache.test.js` - against a fake transport that
  reproduces the commit-safe xid window of `pull_sync_changes` (a device's own
  pushed rows come back on the next pull), a push followed by the next pull
  leaves the notebook, its baseline, and the dirty queue cache-free and the
  notebook the same size; the recompute seam still runs an injected recomputer;
  every notebook write path, the workout-notes dirty queue, backup export, and
  backup import strip the field; a note that differs from its baseline only by
  the cache is not a local edit in either direction; the one-time purge strips
  all three keys, records completion, costs one marker read afterwards, leaves
  an unreadable notebook untouched, retries after a storage failure, cannot
  lose a domain write that lands while it runs, and a queue writer whose read
  predates the rewrite and whose whole-map write follows it cannot restore the
  cache (the FIFO storage lock pins that exact interleaving).
- `mobile/tests/secure-storage.test.js` - `updateItem` transforms the decrypted
  value under the operation lock, writes nothing when the transform declines,
  cannot be overwritten by a write queued behind it, is discarded behind a
  confirmed wipe, and migrates plaintext in place first.
- `mobile/tests/sync-fanout-coalescing.test.js` - callers of `maybeSyncCloud()`
  arriving together share one pass; callers arriving during a pass get exactly
  one shared trailing pass; a failed pass still resolves for every sharer and
  marks the phase failed; the mode is re-checked when a pending pass starts; a
  pass finishing after sign-out leaves the reset phase idle (success and
  failure paths); a pass finishing after sign-out **and a re-sign-in** cannot
  settle the new sign-in's still-running pass or stamp a last-successful-sync
  time for it (success and failure paths); each entry hook reads its table once
  at mount in local mode and reloads once after the single shared pass in cloud
  mode, however many instances are mounted (three instances cost one read each
  time since #818 shares the decrypt; before that they cost one read per
  instance, and before #813 two); a write broadcast with three mounted
  instances costs one pass; and, end to end against the real adapter and the
  xid-faithful fake transport (`mobile/tests/mocks/xidFakeCloud.js`), that
  single pass is the one that uploads the caller's write.
- `mobile/tests/sync-recovery-ui.test.js` (`phase run ownership tokens`) -
  `beginPhaseRun` marks the phase running and yields the current token; tokens
  are per phase and never reused; `resetPhase` and any later run stale an
  outstanding token; a stale token cannot settle the phase while a current one
  can; omitting the token keeps the unconditional transition; and a superseded
  `runPhase` run still reports its own outcome to its caller without publishing
  it over the run that owns the phase.

Every one of these was verified to fail with its fix disabled. Two rounds of
opposite-vendor (Codex) review of the diff found the queue interleaving, the
sign-out phase race, and the run-identity gap that survived the first fix for
it; all three are covered above.

**Profiling method.** Two measurements together explain the symptom, and
neither records payload content - the fixture is synthetic (a deterministic
12-note account with 4-day routines and 4-14 logged weeks each, 300 weight
entries), and the harness reports counts, byte sizes, key names, and timings
only.

1. *CPU cost on the real engine.* The Node/V8 profile #806 used hides the
   device cost of `secureStorage`: `@noble/ciphers` AES-GCM is pure JS, the
   envelope is hex-encoded (2x), and `bytesToUtf8` runs through Expo's JS
   `TextDecoder` polyfill (`installGlobal` replaces the engine's). Bundle the
   exact libraries plus the app's own parser with esbuild, transpile with
   `@react-native/babel-preset` (Hermes has no native class syntax), compile
   with `hermesc -O`, and run under the Hermes CLI (`facebook/hermes` release
   `hermes-cli-linux`) beside Node. On a desktop x86 core, one notebook read
   (decrypt + parse) is 26 ms for the plain 36 KB notebook, 849 ms once four of
   twelve notes carry the cache (1.28 MB), and 2478 ms with all twelve
   (3.74 MB) - 1/33/86 ms in Node for the same three. A phone core is several
   times slower again, and Android AsyncStorage caps a database at 6 MB and a
   row at ~2 MB, so a device could only ever hold a couple of bloated notes.
2. *Operations per user action on the real engine and hooks.* Drive
   `cloudAdapter.sync()` and the real `useWorkoutNotes()`/`useWeightEntries()`
   hooks (three mounted instances each, as App/Log/Weight/Analytics hold)
   against a fake transport with the xid-window pull semantics above, wrap the
   AsyncStorage jest mock to count operations and plaintext bytes per key, and
   spy on `cloudAdapter.sync` to count passes. Multiplying bytes by the measured
   Hermes ms/KB gives a modeled UI-thread cost per action.

Before/after on the worst-case fixture (all twelve notes carrying the cache,
which is what two settled passes after a first upload produced):

| scenario | before | after |
|---|---|---|
| launch: mount 3x notes + 3x weight hooks | 18 reads, 22.3 MB decrypted (6 notebook decrypts), ~15 s modeled | 9 reads, 0.29 MB, ~0.2 s |
| settled no-change pass | 62 reads, 7.4 MB, ~5 s | 62 reads, 0.20 MB, ~0.13 s |
| one Log autosave, all tabs mounted | 3 passes, 33 pulls, 208 reads / 53 MB, 44 writes / 38 MB, ~52 s | 1 pass, 11 pulls, 79 reads / 0.46 MB, 30 writes / 0.23 MB, ~0.4 s |
| notebook + baseline after two passes | 3.74 MB + 3.74 MB, 12/12 notes bloated | 37 KB + 37 KB, 0/12 |

No physical-device timing was captured for this change; the modeled numbers
are a lower bound on device cost, and the operation counts are exact.

### Residual cold-launch lag: duplicated hydration reads (#818)

The delay that survived #809 and #813 reproduces the same with Cloud Sync on
and off, which rules out sync latency and points at the shared local path. It
is not one slow phase: it is the same encrypted values being read several times
in a row. All five tabs mount at once (#527) and hydrate from the same keys, so
a cold start issued the notebook, the weight table, the current-routine pointer
and the tracked lifts three times each and the weight goal twice — twenty
device reads for nine distinct keys — every one of them a native round trip
plus a full AES-GCM decrypt, and all of them serialized behind the storage
module's single operation queue so none of them overlapped. React runs child
effects before the parent's, so the shell's own `useWeightEntries` /
`useWorkoutNotes` reads — the two Home's `loading` prop is gated on — were
enqueued 15th and 16th of the twenty, behind every duplicate the four hidden
tabs had already queued.

`secureStorage.getItem()` now shares one in-flight read per key, which removes
both costs at once: nine reads instead of twenty, and the two gating reads land
on a read a tab already started rather than on a new one behind it.

Coverage in `mobile/tests/startup-read-coalescing.test.js`:

- concurrent reads of one key resolve from a single backing read/decrypt;
- a pending read is **not** shared across a `setItem`, `removeItem`,
  `updateItem`, or `wipeKiloData` for that key — the read enqueued first still
  resolves the pre-write value (what it would have returned from that queue
  position anyway) and the read enqueued after the mutation sees the write;
- a pending read **is** still shared across `migrateKiloData()`, which only
  re-encodes values already present. App queues that migration between the tabs'
  hydration reads and the shell's own, so invalidating there would put the two
  gating reads back at the end of the queue;
- mounting every tab's real hook set plus the shell reads the notebook, weight
  table, current-routine pointer, tracked lifts, tracked-lift activations
  (#893) and weight goal once each, and both gating reads are issued inside the
  initial mount burst rather than appended after every other tab's hydration.

Verified to fail with the fix disabled: reverting `getItem()` to its
uncoalesced form fails four of the six tests (the two that pin the
*non*-sharing rules correctly still pass, since they guard correctness rather
than the optimization).

The `[startup]` trace gained one fixed-name line beside `app:local-ready`:
`storage:reads: issued=<n> coalesced=<n> at <ms>ms`. It reports counts only —
no key names, no values, no sizes — and is compiled out of release builds with
the rest of `startupTiming.js`.

**Measurement.** Read counts and their order are exact and device-independent
(they come from driving the real hooks against the AsyncStorage jest mock).
The per-read cost was measured on the real encrypted path with
`forceEncryption: true` on a desktop x86 core: 0.5 ms for a 1.5 KB notebook,
2.6 ms at 14.5 KB, and 15.5 ms at 76.3 KB — so removing two of three notebook
decrypts saves ~1/5/31 ms respectively there, before the two weight-table and
two tracked-lift decrypts and the native round trips. A phone core running
Hermes is several times slower again (see the #813 profiling method above for
why Node understates this). **No physical-device wall-clock timing was
captured for this change**; the acceptance criteria ask for force-stopped
before/after samples in both storage modes on a physical Android device, and
that remains outstanding — see the device procedure under the #809 section
above for how to take them.

### Home first-paint read overlap (#984)

#818 removed the duplicate reads; the survivors still queued. Every operation
shared one strictly serial FIFO at the storage boundary, so the eight
**distinct** keys Home's four-term first-paint gate depends on — weight goal,
tracked lifts, tracked-lift activations, recovery blocks, recovery block weeks,
notebook, current-routine pointer, weight table — executed one after another
even though none depends on another. Driving the real cold-start hook fan-out
against the AsyncStorage jest mock and recording the read order confirms this:
twelve reads, strictly sequential, with all eight gating reads inside the first
eight positions.

The boundary now uses a readers/writer discipline. Writes stay totally ordered
and exclusive; reads admitted between two writes overlap. The gate is
untouched.

Coverage in `mobile/tests/home-first-paint-concurrency.test.js`:

- reads of different keys run concurrently (high-water mark of in-flight
  backing reads, plus wall clock under an injected per-read latency);
- concurrent reads of ONE key still resolve from a single decrypt (#818);
- no read is ever in flight while a write runs, in either direction, and a read
  enqueued before a write still resolves the pre-write value;
- a pending read is still not shared across `removeItem`, `updateItem`, or a
  device wipe;
- a **failed** read neither wedges the boundary nor rejects the next write —
  the barrier a write awaits holds every admitted read, so a rejecting entry
  there would take every later operation down with it;
- writes remain totally ordered with respect to each other;
- all four terms of Home's `isLoading` gate still resolve independently, and
  the launch still issues one read per key.

**Measurement.** With the real encrypted path (`forceEncryption: true`) and a
fixed injected per-read device latency, reading the eight gating keys on a
desktop x86 core: 175 ms before / 34 ms after at 20 ms per read (5.1x), and
53 ms before / 28 ms after at 5 ms per read. The residual is the AES-GCM
decrypt itself, which runs on the JS thread and does **not** parallelize — this
change overlaps the native round trips, not the CPU. The split was measured
directly on a 12.9 KB notebook payload: 0.57 ms AES-GCM decrypt against a
6.35 ms end-to-end read.

**No physical-device wall-clock timing was captured for this change.** The
acceptance criteria ask for force-stopped cold-launch `[startup]` traces before
and after on a real installed development client with populated data, plus
owner sign-off across Home's populated/empty/source-error and Recovery
open/stale states. Both remain outstanding; see the device procedure under the
#809 section above for how to take them. The injected-latency numbers above
isolate the I/O component only and are not a substitute.

Operational production checks are not automated test inventory:

- Auth-provider, CAPTCHA, SMTP, OAuth, policy-link, and throttle verification
  belongs in [Backend Activation](backend-activation.md).
- Installed-device and browser verification belongs in [Manual QA](manual-qa.md).
- Play Console state belongs in
  [Play Store Readiness](play-store-readiness.md).

---

## Coverage Gaps

The following MVP behaviors have no automated test coverage:

**End-to-end**
- No automated native test covers native forms, native validation/success UI
  feedback, or native layout/runtime behavior. `mobile/App.js` now has focused
  app-shell coverage for tab switching and Android hardware-back behavior, but
  not a real Expo device/emulator pass.

---

# Recovery State and Operation Journal

For maintainers changing Recovery readiness, multi-record lifecycle writes, replay, or failure handling. Cloud reconciliation is owned by [Cloud Sync](cloud-sync.md).

### Recovery lifecycle operation journal

Three Log-tab recovery actions change more than one persisted collection:
completing a recovery block together with its open current week; deleting a
workout note that is a linked recovery week (membership plus the note, which in
cloud mode is a tombstone plus sync-queue intent); and creating a brand-new note
AND attaching it as the next sequential week (notebook plus membership). AsyncStorage, the workout-note cloud queue,
`kilo_recovery_blocks`, and `kilo_recovery_block_weeks` share no native
transaction, and snapshot-and-revert cannot substitute for one: the revert write
can itself fail, and a note-delete that persists the removal and then throws is
indistinguishable from one that never committed.

`mobile/storage/entries/recoveryOperationJournal.js` owns the protocol.
Ownership and ordering, per operation:

1. validate eligibility against persisted state — a rejection here writes nothing,
   journal included;
2. persist the operation intent under `kilo_recovery_operation_journal_v1` before
   the first domain write. If that write fails, no domain mutation happens;
3. apply idempotent domain writes toward the recorded outcome, in a fixed order,
   each conditional on its own postcondition being unmet, all reusing the one
   immutable requested timestamp on the record;
4. re-read every affected collection from persisted storage;
5. verify all postconditions;
6. clear the journal record only after verification succeeds. A failed clear is
   reported as a verified success whose cleanup is retried, never as a failure and
   never as a silently dropped record;
7. notify/refresh UI only after a verified result or a durable pending state.

All three operations roll forward only. A note deletion converges to "membership
tombstoned and note deleted/tombstoned with pending-sync intent", never back to a
live membership, because restoring one could point a live week at a note that is
already gone. Block completion converges to block and current week completed at
one stable timestamp, and never reopens a record or slides a timestamp forward.
The new-note week converges to "this note is durably LIVE and this week id links
it at this ordinal": both the note id and the ordinal are minted once at intent
time and stored on the record as seeds, so no replay can mint a second note or a
second ordinal, and a same-tick double confirm cannot allocate two. The note
postcondition is deliberately not existence — a tombstoned row exists, and in
cloud mode `saveWorkoutNoteItem` persists the row before it enqueues, so a failed
enqueue leaves a note that exists with no durable upload intent. Since memberships
reach the cloud through the baseline diff, verifying on existence alone would
publish a membership referencing a note that may never upload. The postcondition is
therefore `exists && !deleted`, plus queued intent in cloud mode
(`loadWorkoutNotePresenceState`), repaired idempotently from the recorded seed by
`ensureWorkoutNoteLive`.

Retention is only honest when a retry can change the result, so conditions no
retry, restart, or sync can alter get an explicit terminal transition instead of
permanent pending:

- **ordinal claimed by another device** — a durable reassignment. The next free
  ordinal (one past the highest live week, the domain's own rule) is written onto
  the journal record *before* any domain write, so replay and verification both
  read the reassigned value and the outcome stays single and recorded. One retry
  exits the conflict.
- **the seeded note has joined another block**, or **the target block was
  deleted** — `CONFLICT_CANCELLED`. The record is retired, so nothing stays
  locked, and the caller receives a terminal non-ok result describing what
  happened. Anything already persisted remains an ordinary workout note:
  destroying a note the user asked to create, over a race they did not cause, is
  worse than the untidiness. If the retiring write itself fails, the result
  degrades to ordinary pending rather than claiming resolution.

Reconciliation reports `pending` and `cancelled` separately for exactly this
reason: pending locks conflicting actions, cancelled locks nothing and is shown
once, without a retry affordance there is nothing left to retry.
An unreadable, malformed, or unsupported-version journal fails closed with a
retryable error; it is never read as "no pending work". A verification read that
cannot determine the outcome retains the record rather than choosing a default.

The journal owns no notebook mechanics of its own. The mode-aware implementations
(local hard-delete, or cloud tombstone plus `enqueueDirty` bookkeeping) are
registered into it at load by `mobile/hooks/entries/storageMode.js`, so replay
always uses the adapter current when it runs and repairing local invariants never
requires network access or a signed-in session. The local default is what a
signed-out device uses.

Because the storage mode can change while an operation is pending, cloud-mode
deletion verification never accepts local absence as proof. A local-mode attempt
hard-removes the note; if it is interrupted before verification and the device then
enters cloud mode, the row may still be live on the server and would return on the
next pull. `loadWorkoutNoteDeletionState` in `storage/cloud/cloudDomainMethods.js`
therefore reports `requiresQueue: true` even for an absent note, and
`ensureWorkoutNoteDeleted` reconstructs a minimal tombstone from the journal's own
recorded id and requested timestamp, persists it, and enqueues it. Only durable
pending-sync intent can verify a cloud-mode deletion. A deletion that local mode
already verified and cleared is a different case, handled by the existing
`reconcileSignedOutWrites` baseline diff rather than by this journal.

One reconciler serves every entry point — `reconcileRecoveryOperations()`. It runs
on initial mount/remount before recovery lifecycle state is considered ready,
before any conflicting lifecycle action (a still-pending operation over the same
block, week, or note blocks the action instead of writing underneath it), behind
the UI's `Retry recovery` affordance, and on both cloud sync boundaries: before a
pass reads or pushes workout notes, recovery blocks, or recovery weeks, and again
after the pull/merge before the SYNC phase may be published as complete, because a
remote change can alter an affected record while an operation is pending
(`withRecoveryReconciliation` in `storageMode.js`, applied by both `maybeSyncCloud`
and every `SYNC_PHASE.SYNC` runner in `syncRecoveryHooks.js`). An operation that
still cannot be verified fails the pass, surfacing through the existing
failed/retryable sync state with the reconciliation cause rather than a silent
"Fully synced".

UI actions, retries, sync, and cloud bootstrap share one single-flight queue, and
that boundary holds it across the WHOLE pre-reconcile → operation →
post-reconcile sequence (`withExclusiveRecoveryAccess`), not merely around each
reconciliation. Releasing
it for the pass body would not be safe: the sync engine and the journal replayers
both read a complete `recovery_blocks`/`recovery_block_weeks` array and later write
the whole array back, so a lifecycle action executing during the pass means
whichever side writes last silently discards the other's change — and the post-pass
reconciliation cannot detect that once the UI operation has verified and cleared
its own record, so sync would report success over a lost update. Excluding
lifecycle writes for the duration of the pass is what actually prevents it. The
nested pre/post reconciliation runs without re-acquiring the guard, which is what
keeps that nesting from deadlocking; competing UI actions queue behind the pass and
run against post-pass state.

Cloud **bootstrap** gets the identical boundary, applied at `makeBootstrapRunner`
in `syncRecoveryHooks.js` so both upload paths (`runBootstrap` and
`confirmOwnershipUpload`) are covered by one seam. `buildBootstrapPlan` includes
`recovery_blocks` and `recovery_block_weeks`, so bootstrap reads and uploads
exactly the collections the journal rewrites — and it matters more there than for
an ordinary pass, because there is no earlier cloud state to converge against:
whatever bootstrap uploads becomes the account's initial truth. The one exception
is a recovery block's optional `reason` (#872), which `buildRecoveryBlockRows`
carries only when the local record actually has the key. Bootstrap is a blind
upsert and PostgREST derives its `on conflict do update set` list from the keys
the payload carries, so a legacy record — which says nothing about that column —
omits it and leaves any server-side value intact, while an explicit `null` (a
reason the user cleared) is sent and does propagate. Rows are grouped by key
shape before upserting, since PostgREST requires a uniform key set per batch. An operation still
pending at sign-in would otherwise be uploaded as a partial transition, and a
lifecycle action started while the snapshot is being built or uploaded would race a
whole-list write. Because both callers persist ownership and switch the storage
mode only after the runner resolves, the post-reconcile always completes first; a
pending or corrupt journal throws, which `runPhase` turns into a failed/retryable
BOOTSTRAP phase with the owner unwritten, the mode still local, and the journal
intact. The pull-only restore path (`downloadAccountData`) needs no boundary of its
own: it uploads nothing, runs only on a verified-empty device, and its follow-on
sync already goes through the same guard.

### Authoritative Recovery read state

`hooks/entries/recoveryBlockHooks.js` owns one shared, module-scoped Recovery
snapshot plus the lifecycle status around it. `useRecoveryBlockState` is a
subscriber to that store, not an owner of its own copy, so the Log and Analytics
tabs cannot hold divergent snapshots while mounted together, and
`useRecoveryAnalyticsFilter` publishes into and reads from the same snapshot.
Every read goes through `refreshRecoveryState()`, which runs at most one
reconcile-then-read at a time and coalesces concurrent requests into a single
queued follow-up, so two mounted consumers can never reconcile the journal
concurrently.

Automatic reads (the first consumer's mount, a completed sync) are deferred
while the shell holds startup background work, so replay starts after Home's
first usable paint (#1366); explicit reads (`ensureVerifiedRecoveryState`,
`Retry recovery`, mutation notifications) never wait. While the first
authoritative pass is pending, `useRecoveryBlockState` exposes the plain filter
read as display-only `provisional` blocks/weeks. Home alone opts into it
(`useActiveTrainingContext({ allowProvisional: true })`) and uses it only when
internally consistent (`selectProvisionalRecovery`: one active block at most,
no orphan or duplicate weeks, no week on its own block's baseline note, no open
week before the latest, well-typed
identities and lifecycle markers) and when the RAW persisted lists behind it
(`loadRecovery*Raw`, read concurrently on the same keys) are well-formed, since
the filtered readers silently drop a record with a malformed truthy
`deleted_at`; otherwise it shows unknown. The authoritative pass applies the
same raw-record check after reconciliation: malformed persisted records are a
failed read (`error`/`stale`, mutations closed, `Retry recovery`), never a
verified empty snapshot. Provisional data never sets `ready` or `mutationsAllowed`, and
it is dropped once the authoritative pass fails. A device wipe calls
`invalidateRecoveryReadState()`, which clears both snapshots and makes any read
begun for the wiped data resolve without publishing.

The store distinguishes `idle`, `loading`, `ready`, `refreshing`, `stale`, and
`error` (`RECOVERY_STATUS`). The load-bearing distinction is `ready`: it is true
only after a read has actually succeeded, so an empty `blocks`/`weeks` array is a
verified result only when `ready` is true and a placeholder otherwise. A failed
read is never promoted to a result — a refresh failure over a verified snapshot
keeps last-known-good blocks and weeks visible and marks them `stale` with a
retry path, and a first-load failure produces `error`, not an empty state.

Recovery eligibility and every recovery mutation stay closed until the snapshot
is verified. `LogScreen` derives no eligible baseline or week notes while
`ready` is false (both predicates mean "no live membership blocks this note", so
an unverified empty snapshot would call every note eligible), and every mutation
in `useRecoveryBlockLifecycle`/`useStartRecoveryBlock` calls
`ensureVerifiedRecoveryState()` at confirmation time — re-establishing a verified
read then, not trusting the render that opened the dialog — and returns
`RECOVERY_STATE_UNVERIFIED` without touching storage if it cannot.

`lib/data/activeTrainingContext.js` derives one presentation-level answer to
"what am I training now?" (#868) over that same store — never a second copy of
it. `useActiveTrainingContext` (in `recoveryBlockHooks.js`) wraps
`useRecoveryBlockState()` plus the caller's own workout-note `currentId`/
`notes`, and Home, Log, and Analytics all resolve it at their existing Recovery
-state boundary, so they cannot disagree about which note is "active" (the open
Recovery week's note when one exists, otherwise the stored current routine),
which is the frozen baseline, whether the baseline is paused, or the current
Recovery week number. An unverified/loading Recovery read resolves to its own
`loading`/`unverified` status, never to `normal` — the derivation reads
`ready`/`loading` off the shared store the same way every other consumer does.
Once verified, a snapshot that is `stale` (the latest refresh failed) or has an
unresolved `pendingRecovery` operation also cannot resolve to a confirmed
`normal` with no active block — it resolves to its own `stale`/`pending`
status instead, still carrying the last-known-good shape (active note,
baseline, `baselinePaused`) so a caller can keep showing it, just not present
it as freshly confirmed. Both flags also propagate onto an active-block result
(`recovery_open_week`/`recovery_between_weeks`) rather than being swallowed by
it, so a caller rendering last-known-good Recovery data can still flag it as
not-current. "Latest open week" comes from `orderedLiveWeeks`, the same
structural ordering `recoveryBlockHooks.js` already uses, never from note
titles, `currentId`, or array order.

Surface ownership is deliberately split by lifecycle state. Log owns only the
active block, current-workout lifecycle actions, and the active block's ordinary
analytics inclusion control; completed week rows and completed-block history do
not render there. `AnalyticsRecoverySection` owns completed-block evidence, its
ordered contextual week index, exact-note navigation through the typed Log
intent, and each completed block's inclusion control. Both surfaces still read
and mutate through the same authoritative Recovery store, so moving the controls
does not introduce a second state owner.

## Persisted Recovery repair

Persisted Recovery repair (#1368) runs only inside that deferred
  authoritative pass: `storage/entries/recoveryRepair.js` is called by the
  journal reconciler under the exclusive Recovery lock, after replay and only
  when no journaled operation is pending. It makes exactly four repairs through
  the cloud-resolution helpers in `syncRecoveryResolution.js` (one policy for
  local and cloud): an explicit parent tombstone cascades to its live weeks,
  several active blocks complete all but the latest start, a note linked twice
  keeps the earliest membership, and colliding ordinals renumber in ascending
  collision order only while every output stays a positive safe integer. No
  record is ever removed from `recovery_blocks` / `recovery_block_weeks`: a
  repair rewrites a row (completion, tombstone, ordinal) with one atomic
  compare-and-set through `secureStorage.updateItem` against the exact list it
  planned from (a concurrent writer forces a re-plan, never an overwrite),
  re-reads to verify every repaired row, then enqueues the rows dirty in cloud
  mode (a crash before the enqueue loses nothing: sync's baseline diff picks up
  the local change). A missing parent, malformed or unreadable payload,
  duplicate ids, baseline-note membership, or unsafe ordinal is left
  byte-for-byte in place. The safety guards live inside the shared helpers, so
  cloud resolution applies the same ones: ambiguous ids, unparseable winner
  timestamps, and missing or ambiguous parents never choose a winner or
  cascade; every record a shared decision touches (cascade parent and child,
  each active block, each collision-group member) must pass the same full
  shape check local repair applies, or the decision is skipped; members of a
  note group that cannot be resolved are protected from ordinal repair, and
  unresolved rows still reserve their note and ordinal slot.
  Winners compare parsed instants, never timestamp strings. Only the authoritative read / Retry and the sync
  boundary repair; guarded actions and operation starts reconcile without
  repairing. The result rides beside the journal `ok` (never inside it, so sync
  is not gated). For WELL-FORMED but unresolved records,
  `partitionRecoveryRecords` finds note/ordinal collisions over every live week
  before excluding anything (a week colliding with an unresolved row is itself
  unresolved), names the ids to exclude, and whether any could
  change the mode answer (`modeRelevant`: a duplicate block id, an unresolved
  block that is or could be active, or an unresolved week of the active block).
  Mode-relevant: the pass fails, so first load is ERROR/unknown and a refresh is
  STALE keeping last-known-good; `ensureVerifiedRecoveryState` reports
  `{ ok: true, unresolved: true }` rather than refusing every edit. Otherwise the read verifies the rest, publishes
  `unresolvedCount`, and shows the stale-style notice with `Retry recovery`.
  Only DEPENDENT actions are refused: the journal entry points
  (`runGuardedRecoveryAction`, `startRecoveryOperation`) re-partition under the
  lock and refuse an action whose scope touches an unresolved record's block,
  week, note, or ordinal slot, or a global action (starting a block) when the
  data is mode-relevant, as a validation failure with zero writes. That gate
  fails closed: malformed or unreadable evidence seen under the lock refuses
  the action, since data can change after the confirm-time check. Timestamps
  are not classified (the server columns are nullable and only the winner
  policy reads them). An earlier open week is valid data: per-row LWW sync
  produces it from ordinary use. MALFORMED records keep #1366's fail-closed
  ERROR/STALE. Retry re-reads and re-classifies; it does not promise a fix.

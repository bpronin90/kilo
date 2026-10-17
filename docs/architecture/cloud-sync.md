# Cloud Sync Contract

For sync maintainers tracing account ownership, reconciliation, ordering, cursors, consent, and retry behavior. Consent wording and policy belong to [Health-Data Consent](../privacy/health-data-consent.md).

## Ownership and reconciliation

On sign-in, cloud bootstrap is gated solely by `kilo_local_data_owner`.
Unclaimed non-empty data requires upload confirmation. When the complete local
state projection is empty and no dirty sync work is queued, an unclaimed device
may instead claim the signed-in account, activate cloud mode, and perform a
pull-only restore; the action rechecks emptiness immediately before claiming
ownership. A different user id or `unknown` keeps storage in local mode until
the user explicitly starts fresh or uploads the device history. The one-time
migration derives ownership from legacy `kilo_sync_bootstrapped_*` keys, and
ownership is claimed only after the selected bootstrap or restore path and
marker persistence succeed. Local-adapter no-ops are never valid manual sync
runners and cannot produce a completed cloud-sync status.

Cloud bootstrap allowlists `display_name` and `unit_system` from
`kilo_user_profile`; all other local profile fields remain on-device. The
Supabase `user_profile` schema has no catch-all profile payload column.

After bootstrap, ongoing cloud reconciliation covers eleven table contracts:
`weight_entries`, `workout_notes`, `archived_weight_goals`, `recovery_blocks`,
`recovery_block_weeks`, `user_profile`, `user_health_profile`,
`feature_toggles`, `weight_goal`, `deload_history`, and `fatigue_checkins`.
Ordinary account settings remain in `user_profile`; current routine, fatigue
multiplier, tracked lifts, tracked-span activation records, and the active
generated deload reconcile through the consent-gated `user_health_profile`. The
activation records ride the same row as the flags they belong to, so whole-row
LWW resolves both at once and they cannot desynchronize; they are deliberately
absent from the expand-phase `user_profile` mirror, which exists for clients
predating the #487 split and can read no such field.

One pairing invariant holds across every path: an activation record exists ONLY
for a currently tracked key. A watermark-aware client maintains it by
construction — untrack deletes flag and record in one write — but an older build
cannot, because its upsert names `tracked_lifts` and not the activations column,
so Postgres preserves the stored records across its untrack. A trigger on
`kilo.user_health_profile` (`prune_orphan_tracked_lift_activations`) drops
orphaned records at the moment such a write lands, which is the only place the
intermediate untracked state is observable; the mobile sync, backup-restore and
bootstrap paths apply the same prune locally. Without it, a legacy
untrack/log/retrack would hand back a record whose witness still matched the
unchanged opening history, reviving the abandoned span with every gap session
inside it. A backup restore goes further and treats flags and records as one
authoritative fact: a boolean-only backup restores an empty record map, so its
flags get the documented legacy full-history behavior rather than inheriting
boundaries minted against later local state. `fatigue_checkins` is derived
deterministically from converged `workout_notes.session_checkins` and
never applies pulled projection rows back to canonical notes. The five
collections enqueue dirty rows at write time or through the baseline
reconciliation below; the profile, toggles, active goal, and deload history
diff their allowlisted local projections against persisted sync snapshots.

Collection order is part of the contract, because two of these tables hold
references: a recovery block names the workout note its baseline was frozen
from, and a week membership names both its block and its note. Every pass —
bootstrap upload and ongoing sync alike — therefore runs `workout_notes` before
`recovery_blocks` and `recovery_blocks` before `recovery_block_weeks`, so a
reference always arrives after the row it points at. `kilo.recovery_block_weeks`
carries a real owner-first foreign key to `kilo.recovery_blocks`; the reference
to `workout_notes` is deliberately not a foreign key, because the withdrawal
purge deletes workout notes and a referencing row in a table it does not cover
would block that delete.

Deleting a block tombstones its live memberships, and that cascade is the
client's responsibility on both halves: when the delete is made on this device,
and when the block tombstone arrives by PULL, which is applied before every
membership sync. The foreign key cannot substitute for the second half — a
tombstoned block row is still physically present, so a live membership under a
deleted block satisfies it. A membership created offline against a block another
device deleted would otherwise upload live under a dead parent: invisible to the
user, while still holding the live-note unique slot, so that workout note could
never join another block. A block that is merely ABSENT locally never cascades,
matching the engine's rule that a row not yet downloaded is not a delete.

The recovery collections are the only synced tables with cross-record
uniqueness: one active block per user, one live membership per workout note, and
one live ordinal per (block, week). All three are enforced as partial unique
indexes over live rows, so tombstoned history is retained and never blocks a
note from joining a later block. Two offline devices can each legitimately
create a state that violates one of them; the database rejects the second write
deterministically, and every device then collapses the duplicate from the merged
row set alone — keeping the most recently started block and completing the
older, keeping the earliest membership for a note and tombstoning the rest, and
renumbering a colliding ordinal to the next free one rather than dropping a
legitimate membership. Because that resolution reads only client-authored,
immutable values, all devices pick the same survivor.

The collapsed rows are then re-pushed inside the same pass, in an order derived
from row content: slot-freeing rows (a completed block, a tombstoned membership,
a membership renumbered to a higher ordinal) go before rows that claim the slot
being freed. The partial unique indexes are not deferrable, so Postgres checks
them as it processes each row of an upsert, against the state the earlier rows
left — a batch whose final form is valid is still rejected if a row claims a slot
a later row frees. Order matters most on the device holding the SURVIVING row:
its own write sits first in the id-keyed dirty queue and the freeing row is
appended after it, so without an explicit order that device rebuilds the same
rejected statement on every retry and never converges. A recovery-block failure
is isolated: the pass finishes every unrelated table first and raises the
failure afterwards, so a rejected recovery push never stops weight, workout-note,
or settings sync — and never reports success over recovery data that has not
reached the cloud. That isolation stops at the dependency between the two
recovery tables: memberships are not synced when the block pass failed, because
the cascade can only act on a tombstone a successful block pull delivered, so an
unconditional membership pass would upload the same stranded row through the
failure path. The deferred memberships stay queued and are synced as soon as a
block pass succeeds, including a recovery within the same pass. The frozen `baseline` snapshot and the assigned membership
order are carried through every sync and bootstrap path verbatim; no path
recomputes a baseline metric or renumbers an established sequence.

Write-time dirty tracking only sees writes made through the cloud adapter, so it
misses everything written while signed out. Sign-out reverts storage to
local-only but deliberately keeps the local-data owner marker, and the local
adapter neither stamps sync metadata nor enqueues anything; its delete removes
the row instead of leaving a tombstone. A later same-owner sign-in skips
bootstrap, so before #525 the resulting sync pass pushed zero rows and still
reported success. Every sync pass now begins by reconciling the three
dirty-queue-tracked collections against a last-synced baseline that `syncTable`
persists alongside the diff-tracked snapshots, enqueueing new rows, edits, and
tombstones for rows present at the last sync and physically absent now. The
reconciliation only enqueues; the ordinary pull/merge/push loop performs the
upload, so last-write-wins, tombstone ordering, and cursor advancement are
unchanged. It runs inside the sync phase runner, so a reconciliation that cannot
complete fails the phase and stays retryable rather than reporting a successful
sync. Repeated sign-in and sync are idempotent — unchanged rows match the
refreshed baseline and enqueue nothing. Diff-tracked tables never had this gap,
because their snapshot diff is indifferent to which adapter performed the write.

A device upgrading into that build has no collection baseline yet, and the
presence of `updated_at` is not evidence that a row was ever synced — the
workout-note factory stamps one on every note the user creates. That first pass
therefore reconciles against the server instead of against local state: it
ignores the stored cursor so the pull returns the complete remote row set, then
enqueues every local row the merge will keep that the server does not already
hold in the same form.

Signed-out deletes on that pass are classified against the stored pull cursor,
which is the one piece of server-authored evidence such a device carries about
what it has already observed. Current cursors are PostgreSQL transaction-ID
boundaries (`xid:<n>`), not timestamps. Every synced row records the xid of the
transaction that wrote it. The pull RPC captures
`pg_snapshot_xmin(pg_current_snapshot())`, restricts every page to
`previous_boundary <= sync_xid < new_boundary`, and seeks after the last
`(updated_at, id)` pair. A completed pull at boundary `C` therefore delivered
every row version with `sync_xid < C`. A writer still invisible when the pull
starts has xid at or above `C`; after it commits, the next pass starting at `C`
recovers it. Concurrent inserts and deletes cannot shift an unvisited row across
an offset because the feed has no offset pagination. Duplicates across adjacent
boundaries remain harmless under the existing owner/id upserts.

This transaction boundary is required because `updated_at` is stamped with
PostgreSQL `now()`, which is the writer transaction's start time. A writer may
receive an old timestamp, remain open for an unbounded duration, and commit only
after another session finishes pulling. No fixed wall-clock lag can prove that
writer safe to skip. Devices carrying a legacy timestamp cursor perform one
complete replay, then replace it with the server-returned xid boundary only
after the full pull and any push complete. The legacy timestamp trust checks
remain solely for the first unbaselined signed-out-delete classification during
that upgrade replay.

Three outcomes follow for a row present remotely and absent locally. At or before
a trustworthy cursor the row was demonstrably delivered, so its absence is a
signed-out delete and the tombstone propagates. After a trustworthy cursor this
version of the row postdates the device's last pull window, so it was never
observed; it is preserved and restored by the merge, which is also what
last-write-to-reach-the-server-wins requires, since any unrecorded local delete
never reached the server. With an untrustworthy cursor the row cannot be
classified: no tombstone is invented and no baseline is recorded, and the pass
raises a reconciliation conflict that fails the sync phase with an actionable
message rather than reporting success. A missing cursor is handled by the
transition context the app layer threads down (`ownedDevice`), because it is
reachable from two states that local data alone cannot always separate — an owned
device that deleted every local row looks exactly like a clean download. On a
genuine clean device (first download, or the #538 post-purge rebuild) it is the
ordinary first-download state, so it infers nothing and blocks nothing;
restoring the full remote set is the download. On an owned device with real prior
sync history whose cursor was intentionally cleared (#523 healing, #538 rearm) the
absent-local row can be neither classified as a signed-out delete nor safely
restored as success, so it takes the same honest conflict as an untrustworthy
cursor — never a fabricated tombstone. The clean-device download, upload-claim,
start-fresh, and rebuild flows pass `ownedDevice` false; the ordinary same-owner
sign-in sync and manual "Sync Now" pass it true. The conflict is reported once: it is raised after the merge has
restored the rows, after the real dirty queue has been pushed, and after cursor
advancement has replaced the untrustworthy value with a server-authored one, so
the retry has nothing ambiguous left and completes. The governing invariant is
that a baseline is never recorded over a row that has not reached the server: a
failed push throws before the baseline is written, so an uncertain pass fails
retryably instead of completing green.

> **Cursor wording conflict retained for follow-up:** the next paragraph describes
> the earlier timestamp cursor, while the commit-safe xid protocol above describes
> the current transport (`mobile/storage/cloud/transport.js`, `pull_sync_changes`).
> Treat the timestamp cursor description as upgrade context, not permission to
> replace xid pagination. An owner-scoped sync contract change must reconcile
> the remaining acknowledgement/advancement wording before changing behavior.

A pending local row always reaches Supabase before conflict ordering is settled,
so the database's server-authored `updated_at` establishes arrival order without
trusting the device clock. Exact timestamp ties prefer the shared server row;
ties between two local candidates use the stable per-install `client_id`.
Supabase returns each pushed row after its timestamp trigger runs; that
acknowledgement replaces the device-stamped sync metadata locally and is the only
push-side evidence allowed to advance the pull cursor. Pulls use an inclusive
timestamp boundary and fetch the complete PostgREST result in explicit pages,
ordered by `updated_at` and then the table primary key (`id` for collections,
`user_id` for singletons). Equal-timestamp boundary rows may be read again, but
the stable secondary order and idempotent merge prevent skipped or starved rows.
If a successful server acknowledgement is older than the stored cursor, the
cursor is known to be poisoned by the former device-clock path. It is removed
rather than clamped to the acknowledgement, so the next pass performs a complete
pull and recovers rows hidden anywhere below that bad cursor.
After a successful push, dirty-queue cleanup compares the queue snapshot captured
for that upload with the value still queued under the same id. The live row sent
to Supabase may also carry local-only state, so it is not the queue identity. A
newer edit or tombstone enqueued while the older push is in flight therefore
stays pending for the next pass instead of being cleared by the older
acknowledgment.
Singleton tables use a synthetic local merge id that is removed before upsert,
and tombstones remain in the sync contract so deletes do not resurrect. The
ownership-confirmation bootstrap projection preserves workout-note
`deleted_at` and `source_snapshot` fields. Workout-note reconciliation also
recognizes the bootstrap-only `wn_legacy_` id namespace when legacy provenance
was stripped by an older upload, but tombstones that row only when a live
non-legacy note coexists; this keeps cleanup linear and preserves legacy-only
and user-authored `Routine 1` notes (#501). Raw workout-note tombstones remain in
AsyncStorage for retry and convergence, while both local and cloud public loaders
filter them from user-visible note lists (#544).

Cloud health authorization is server-owned. Material-versioned grants and
withdrawals are recorded in an immutable consent catalog/event ledger with a
keyed current state. RLS checks the active grant before any health-table read or
write, while protocol and material-version denial codes give the mobile client
actionable UI states without becoming the security boundary. Withdrawal moves
`granted -> deletion_pending -> withdrawn`: the first transition blocks access
and creates a durable job; the client immediately switches to local-only storage,
and any denied preflight does the same so ordinary entry-hook refreshes cannot
attempt consent-gated reads or writes. `health-data-delete` erases the shared
gated scope, and the final transition occurs only after server-side zero-row
verification. After a renewed grant, the client restores cloud routing in-session
only when `kilo_local_data_owner` matches the signed-in user, then runs the normal
sync selector before reporting Cloud Sync active. That selector also owns the
post-purge rebuild branch described below. A failed pass stays local-safe and
retryable; foreign or unclaimed device data remains behind the explicit ownership
decision.
Supabase Cron dispatches the worker through `pg_net` with Vault-held
credentials, retries indefinitely with capped backoff, and exposes an operator
backlog/re-enqueue path. Account export, account deletion, and withdrawal purge
share one health-data scope; account deletion replaces linked consent rows with
minimum HMAC-pseudonymized evidence retained for six years.

A same-owner device that keeps its complete local copy across a verified-zero
purge and a later re-grant cannot rely on ordinary sync to notice: its dirty
queue is already empty and every diff-tracked snapshot already agrees with
what is now an intentionally empty cloud copy, so a normal pass pushes
nothing (#538). `consent_state.cloud_rebuild_generation` is the server-
authenticated signal that resolves this without the client ever inferring
anything from an empty cloud copy — which a brand-new account also has on its
first grant. It is a monotonic counter: `kilo.complete_health_deletion_job`
increments it on any verified-zero purge (withdrawal, quarantine expiry, or
operator re-enqueue), and `kilo.consent_grant` and `kilo.health_sync_preflight`
both surface it. There is deliberately no server-side "rebuild done" flag:
completion is tracked PER DEVICE in local storage
(`storage/entries/localDataOwner.js`), so each device rebuilds whenever the
server's generation is ahead of the one it last rebuilt for. That is what lets
two of an account's devices, each holding its own complete local copy, both
rebuild and converge through the ordinary LWW merge, instead of the first one
to sync clearing a single flag for the rest. The mobile client compares the
generation wherever a sync runner is selected (automatic sign-in sync and
manual Sync Now alike) and, when this device is behind, runs
`rebuildCloudCopy()` instead of an ordinary pass: it rearms every one of the
seven gated tables for a full reupload — collection tables by re-enqueuing
every local record, live and tombstoned, as dirty; diff-tracked tables by
discarding their last-synced snapshot so the next pass treats local state as
unreconciled — then pushes through the ordinary sync engine and runs one more
ordinary pass as reconciliation, and only then records the caught-up generation
for this device. A failure at any step leaves local data untouched and the
device's generation unadvanced, so any retry (a fresh rearm, a re-push of
already-acknowledged rows) is safe, re-runs on the next launch, and never loses
or duplicates data.

#493 contracted `kilo.user_profile`'s six legacy health columns and every
expand-phase compatibility path (`health_parity_report()`,
`reconcile_user_health()`, `health_values_differ()`), which also removed the
only detector for health-data loss: those helpers worked by comparing the two
duplicated copies, and that duplication was itself the Art. 9 problem #487/#493
exist to remove. Post-contract, `kilo.health_presence_watermark` (#558) is a
presence/timestamp-only shadow of `kilo.user_health_profile`, kept current by
a 30-minute `kilo.health_presence_sweep()` cron job; it never stores health
values, only whether a row exists, whether it currently has any content, and
when it was last seen either way. `kilo.health_integrity_report()` is the
operator-facing check: it flags a previously content-bearing, currently
granted account whose row has disappeared or gone fully empty, unless
`consent_state.status` is `withdrawn`/`deletion_pending` or a completed purge
(`cloud_rebuild_armed_at`) explains the absence as a pending #538 rebuild.
`health_content_cleared` also fires on legitimate user-initiated clearing
(e.g. deleting a deload note), by design — with a single remaining copy there
is no way to distinguish that from a bug without storing the values the
monitor exists to protect, so it is a coarse signal for operator review rather
than an automated alert.

### Cloud sync pass cost

A sync pass is bounded by two things, and both are shaped deliberately (#806).

**Device storage.** Every synced table lives in one encrypted `kilo_` value, so
touching a table at all costs a full decrypt + parse (or stringify + encrypt) of
every row it holds. Three rules keep that from scaling with the account rather
than with the pending work:

- The dirty queue is written **once per batch**, never once per record.
  `enqueueDirtyMany` is the bulk entry point used by the signed-out
  reconciliation, the diff-table pass, and the #538 rebuild reseed;
  `enqueueDirty` is a single-record call through it. Enqueueing row by row is
  quadratic in the batch, because each record rewrote the whole queue.
- `runSyncPass` holds a **pass-scoped table cache** (`createPassCache` in
  `storage/cloud/syncAdapter.js`). Each collection table is read once per pass
  and shared by the reconciliation, the phantom-note cleanup, the merge, and the
  derived fatigue projection. A write whose serialized form matches what the
  pass already holds is skipped outright, so a pass that changes nothing writes
  nothing.
- A write that DOES change the table re-reads it first and folds in any row the
  domain changed since the pass took its copy (`preserveConcurrentWrites`). The
  cloud-operation queue does not serialize UI/domain writes, so a
  `saveWeightEntry` can land between the copy and the write; without the reload
  the whole-table replace would drop it from the device until a later pass
  rebuilt it from the dirty queue — and if that pass fails before its push, it
  would not rebuild it at all. Concurrent rows win because a cloud-mode domain
  write is stamped and dirty-queued, which is the same "pending local row is not
  voted against remote" rule `syncTable` already applies. The reload happens only
  on a write that will touch storage, so the steady-state pass pays nothing.
- `syncTable` records its baseline from the list `writeLocal` **returned**, not
  from a re-read. Every table writer returns what it actually persisted, which
  is both cheaper and stricter: a re-read could sweep a concurrent domain write
  into the baseline and launder it into looking synced.
- `setSyncSnapshot` skips a byte-identical baseline rewrite, and may only do so
  against a value `getSyncSnapshot` has actually read back — one read grounds
  one skip, so a snapshot removed outside `clearSyncSnapshot` (a device wipe, a
  purge) costs at most one skipped write before the next read repairs it.

**Round trips.** Tables that do not depend on each other pull and push together:
`weight_entries`, `workout_notes`, and `archived_weight_goals` as one group, then
all six diff-tracked tables as another. The orders that carry meaning are
unchanged and still strictly sequential — workout notes before `recovery_blocks`
(a block names the note its frozen baseline came from), `recovery_blocks` before
`recovery_block_weeks`, and every collection table before the diff-tracked ones
(so `fatigue_checkins` projects a settled notebook and `user_health_profile`
uploads a `current_workout_note_id` the pass is not about to drop). Groups are
settled with `Promise.allSettled` and the first failure is raised only after every
member has finished, so a pass never reports a failure while its own work is still
in flight.

A failing pass drains its deferred rows before the failure propagates. Phantom-note
tombstones and collapsed recovery duplicates are held in memory until the pass
enqueues them, but the table that produced them has already recorded a baseline
containing them — so the next pass's reconciliation finds no local difference and
would never rediscover them. Draining into the durable dirty queue on the way out
is what stops a tombstone this device minted from being silently dropped while the
phantom lives on in the cloud.

`transport.push` also caches the user id it validated against the exact
access token it validated, so one pass costs one `auth.getUser()` round trip
rather than one per pushed table; RLS remains the authority that rejects a
mismatched `user_id`.

**Payload size.** Because every table is one encrypted value, what a pass costs
is set by what a row carries, and on a device every byte is decrypted and
re-encrypted in pure JS on the UI thread. The notebook therefore never persists
derived parser output (#813): the merge's recompute seam
(`storage/cloud/transport.js`, consumed by `syncQueue.resolveRecord` when local
and remote agree on `raw_text`) has no default recompute, every notebook read
and write path strips a `derived_sections` field
(`storage/entries/derivedCache.js`), every read and write of the workout-notes
dirty queue normalizes the whole queue the same way (so a writer holding a
stale copy cannot restore it), backup export/import do the same, and the
sync fingerprint ignores it so a note that differs from its baseline only by
that cache is never treated as a local edit. Older builds attached the parser's
full output - roughly a hundred times the note text - to every note a device
had ever pushed, because `pull_sync_changes` serves a device its own pushed rows
on the next pull; `purgePersistedDerivedSections()` strips it once per device
at startup, one key at a time, each as a single serialized rewrite
(`secureStorage.updateItem`).

**Fan-out.** A write broadcast reaches every mounted `useWorkoutNotes()` /
`useWeightEntries()` instance, and each instance's `refresh()` asks for a sync.
`maybeSyncCloud()` (`hooks/entries/storageMode.js`) shares passes between those
callers (#813): callers arriving before a pass starts join it, callers arriving
while one runs are promised exactly one trailing pass, and every caller still
gets a pass that began after its own (already durable) write. `sync()`'s
single-flight alone could not do this, because the recovery-reconciliation
guard around it is a strict queue.

**Phase run ownership.** A sync pass can outlive the phase it started, so
`storage/syncRecovery.js` gives every run an ownership token (`beginPhaseRun`);
`markComplete`/`markFailed` publish nothing when the token they are handed is no
longer the current one, and every transition - a run starting, a settle, a
`resetPhase` - claims a fresh token. Status alone is not enough to identify a
run: sign-out resets the SYNC phase mid-flight (a late completion there would
leave a signed-out device non-idle and skip the next sign-in's automatic sync),
and after a re-sign-in the new pass has set the phase running again, which looks
identical to the stale pass's own `running`. Without the token the stale pass
would settle the live one and stamp a last-successful-sync time for a pass that
had not finished. `runCloudSyncPass` additionally requires cloud mode, and
`runPhase` carries its own token the same way.

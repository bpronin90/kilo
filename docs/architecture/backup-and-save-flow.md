# Save and Backup Data Flow

For maintainers tracing save validation and local/cloud backup replacement, including failure and deletion intent.

## Parse-to-Persistence Flow

```
User types in native Weight or Log form
  → App.js save handler calls native parser (`parseWeightEntry`) or workout-note save path
  → on error: save is blocked in the handler
  → on ok: App.js builds a canonical weight entry via `makeWeightEntry`, or parses the workout note, derives persisted session classifications plus skip/attendance metadata, and upserts the selected titled workout note through `useWorkoutNotes`
  → `useWeightEntries` / `useWorkoutNotes` writes through `mobile/storage/entries.js`
  → AsyncStorage persists the updated weight list, workout-notes array, and current-workout id
  → hook state updates
  → Home / Analytics re-derive recent activity and analytics from the selected current workout note
```

`mobile/storage/entries.js` also exposes a backup/restore recovery path:
`exportBackup()` serializes a versioned v4 snapshot (weight entries, titled
workout notes with `isCurrent` / `currentSince` metadata, the current workout
id, an optional weight goal, an optional fatigue multiplier, the completed
deload history, and — since issue #694 — the two recovery collections:
`recovery_blocks` with each frozen `baseline` snapshot, and
`recovery_block_weeks`). Both recovery collections are emitted through explicit
field allowlists and carry their retained tombstones, because a tombstone is the
only record that a block or membership was removed.
`importBackup(payload, 'replace')` validates before any write, restores the
full multi-note model for v2 and later backups, conditionally restores or clears the
weight goal when the key is present, restores only a finite in-range fatigue
multiplier, validates every v3/v4 deload-history record and caps its raw text before
restoring it, and still
accepts v1 backups to restore weight history without
clearing the newer workout-note state.

Recovery data is restored only from a v4 backup, and blocks are always restored
before memberships — the order the real
`recovery_block_weeks (user_id, block_id)` foreign key requires. A v4 payload
carries both collections or neither: half a payload is unrestorable in either
direction, since memberships alone have references that cannot be checked, and
blocks alone would tombstone a block by omission while the device's live
memberships still point at it.

Validation is bounded and total before the first write. Per record: non-empty
unique ids, every membership's `block_id` resolving to a block in the same
payload, a required positive-integer week ordinal, strict ISO instants, and a
frozen baseline that is an object with a known snapshot version and a bounded,
numerically typed exercise list.

Two of those are stricter than the cloud column they mirror, deliberately. The
`week_number` column is nullable, but the local domain has no such tolerance —
`orderedLiveWeeks` subtracts ordinals numerically and `nextWeekNumber` derives
from the highest one, so a null stops week order from being a total order rather
than leaving a harmless gap. Timestamps are matched against a strict ISO instant
pattern with calendar validation instead of `Date.parse`, which accepts `"1"`,
`"2026"`, and `"March 5, 2026"`, and which normalizes an impossible calendar date
rather than rejecting it — `"2026-02-30T00:00:00Z"` parses to March 2 while the
importer persists the original string. An explicit UTC offset is required, since
both producers of these values emit one (`toISOString()` on the device,
PostgREST's `+00:00` with up to microsecond precision for a server-stamped
`updated_at`) and a local-time string names no instant to order against. Across the collections, the same three
cross-record invariants the cloud tables enforce as partial unique indexes over
live rows — one active block, one live membership per workout note, unique live
week ordinals within a block. Those three are checked here because the database
otherwise catches them only mid-push, after a replace has already overwritten
local storage and enqueued the rows; in local mode nothing pushes at all, so an
invalid domain state would simply persist. Like the indexes, all three are
scoped to live rows, so a completed block, a tombstoned membership, and a reused
week ordinal are history rather than conflicts. A malformed recovery collection
therefore rejects the whole restore, so no partial state reaches storage or the
sync queue. A v1/v2/v3 file predates the
format and says nothing about recovery data, so a legacy restore leaves every
block and membership exactly where it is rather than treating silence as a
deletion.

The same storage module also performs a
one-time forward migration from the legacy single-note key by seeding a
`Routine 1` notebook entry with `isCurrent: true` and `currentSince: null`,
and normalizes pre-existing notebook rows that predate the new metadata fields.

Import has two contracts and the caller states which one applies, because a
device with no account and a device that is one replica of an account need
different behavior from the same button. `importBackup(payload, 'replace',
{ mode })` takes the local contract by default: it overwrites the domain keys and
nothing else, which is the whole story when the device is the only copy. The app
shell passes the active storage mode through, so a signed-in user gets the cloud
contract instead. Before #526 there was only the local path and it ran in cloud
mode too, so a cloud restore wrote local keys, enqueued nothing, tombstoned
nothing, reported success, and left the account holding the pre-import data until
the next pull put it back (#522 claim 5).

Under the cloud contract a replace is a batch of ordinary cloud writes rather
than a special upload path. Every imported collection row is stamped and enqueued
with the same primitives an in-app edit uses, and every `weight_entries`,
`workout_notes`, `recovery_blocks`, or `recovery_block_weeks` record the backup
OMITS becomes a tombstone, because "replace" means those records are gone and a
plain local deletion would simply be re-pulled from the server. Local storage is written before the queue, so an interruption
between them leaves the imported state on disk for the [signed-out-write
reconciliation](cloud-sync.md#ownership-and-reconciliation) to re-derive; the reverse order would promise rows the
device does not have. The importer never uploads anything itself, so
last-write-wins, tombstone ordering, cursor advancement, and the consent gate at
the sync seam are all unchanged, and a failed push retries with both the imported
state and the deletion intent intact. Incoming `updated_at` and `client_id` are
dropped rather than trusted, since they describe the exporting device's history
and would otherwise compete in LWW as if this device had made the write;
`deleted_at` is preserved, because a backup taken from raw storage legitimately
carries tombstones.

Everything outside those four collections is left to the diff-tracked sync path
and needs no import-time queueing: the weight goal, deload history, profile,
health profile, and feature toggles detect local change by diffing live state
against a persisted snapshot, and that diff is indifferent to which writer
produced the change. `archived_weight_goals` is a collection table the backup
format does not carry at all, so a replace leaves it untouched — the payload is
not evidence that those records were dropped, and tombstoning them on that
non-evidence would destroy data the user never asked to remove. A v1 backup
predates the notebook model and likewise does not delete workout notes.

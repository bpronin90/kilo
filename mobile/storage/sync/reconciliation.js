// Signed-out write reconciliation (issue #525).
//
// Split out of storage/syncQueue.js (issue #1061). Sign-out switches storage to
// LOCAL but deliberately keeps the local-data owner marker: the history still
// belongs to that account. Everything written in that window goes through the
// LOCAL adapter, which is a plain AsyncStorage store — it does not stamp sync
// metadata, does not enqueue anything dirty, and deletes by removing the row
// outright rather than leaving a tombstone.
//
// When the SAME owner signs back in, the owner marker matches, so bootstrap is
// skipped and the app switches straight to CLOUD and runs an ordinary sync pass.
// That pass consults the dirty queue, finds nothing, pushes zero rows, and still
// reports success — the signed-out writes stay on the device while the UI says
// "synced". This is the defect #522 confirmed as claim 4.
//
// The diff-tracked tables (syncDiffTable) are already immune: they detect local
// change by diffing live local state against a persisted snapshot, and that diff
// does not care which adapter performed the write. Reconciliation therefore
// gives the dirty-queue-tracked COLLECTION tables the same property, using the
// same baseline mechanism (`kilo_sync_snapshot_<table>`, written by syncTable)
// and the same stamping primitives, so a reconciled write is indistinguishable
// from an ordinary one by the time the sync loop sees it.
//
// Deliberately NOT a separate upload path: reconciliation only ENQUEUES, then
// the ordinary pull/merge/push loop does the work. LWW, tombstone ordering,
// cursor advancement, and idempotency stay identical to every other pass.
//
// There are TWO reconciliations, because there are two situations:
//
//   * `reconcileAgainstBaseline` — the steady state. A baseline exists, so a
//     local row that differs from it is unambiguous evidence of a local write,
//     and a baseline row that is physically absent locally is unambiguous
//     evidence of a local DELETE. New rows, edits, and tombstones are all
//     detected.
//
//   * `reconcileAgainstRemote` — the upgrade window, run inside syncTable. A
//     device upgrading into this build has no baseline yet, and the presence of
//     `updated_at` is NOT evidence that a row was ever synced (makeWorkoutNoteItem
//     stamps one on every locally created note), so there is nothing local to
//     diff against. The server's row set is used as the ground truth instead, and
//     signed-out DELETES are classified against the stored pull cursor — the one
//     piece of server-authored evidence such a device already carries about what
//     it has observed. The cursor is validated first (assessCursorTrust); when it
//     cannot be trusted the pass reports an honest actionable conflict rather
//     than inferring in either direction.

import { DERIVED_SECTIONS_FIELD } from '../entries/derivedCache';
import {
  getClientId,
  ROW_XID_FIELD,
  pickWinner,
  isTombstone,
  stampWrite,
  stampTombstone,
  stableStringify,
} from './records';
import { assessCursorTrust, parseCommitSafeCursor } from './cursors';
import { enqueueDirtyMany } from './dirtyQueue';
import { getSyncSnapshot } from './snapshots';

// Raised when an unbaselined pass finds remote rows it can neither classify as
// signed-out deletes nor explain as never-downloaded. Thrown BEFORE the baseline
// is recorded, so the pass invents no tombstone, records no baseline, and makes
// no successful reconciliation claim. See reconcileAgainstRemote (and syncTable,
// which throws it).
export class SyncReconciliationConflictError extends Error {
  constructor({ table, reason, ids }) {
    super(
      `Sync paused for ${table}: this device's saved sync position is not trustworthy ` +
        `(${reason}), so ${ids.length} cloud row(s) missing from this device could not be ` +
        `classified as deletions or as rows that were never downloaded. Nothing was deleted ` +
        `and the rows were restored from the cloud; sync again to continue.`
    );
    this.name = 'SyncReconciliationConflictError';
    this.table = table;
    this.reason = reason;
    this.ids = ids;
    this.reconciliationConflict = true;
  }
}

// Sync bookkeeping that describes WHEN a row was written rather than WHAT it
// says. Two rows that differ only here hold the same user data.
const SYNC_METADATA_FIELDS = Object.freeze(['updated_at', 'client_id']);

// Device-local caches that describe neither WHEN nor WHAT: recomputable from the
// row's own payload, never a cloud column. A row that differs from its baseline
// only here has not been edited, so treating the difference as a local write
// would re-stamp and re-push an unchanged note - and, because a pending local
// row is never voted against its remote counterpart, could overwrite another
// device's genuine edit. Ignoring the field is what lets the one-time purge in
// entries/derivedCachePurge.js clean the notebook and its baseline separately
// without ever making the two disagree (issue #813).
const LOCAL_CACHE_FIELDS = Object.freeze([DERIVED_SECTIONS_FIELD]);

// Structural identity of a record's user-visible content. `deleted_at` is
// deliberately retained: live and tombstoned are different states of the row.
function payloadFingerprint(record) {
  const payload = {};
  for (const key of Object.keys(record)) {
    if (SYNC_METADATA_FIELDS.includes(key) || LOCAL_CACHE_FIELDS.includes(key)) continue;
    payload[key] = record[key];
  }
  return stableStringify(payload);
}

// Compare the live local rows of a collection table against the last-synced
// baseline and return the rows that must be pushed. Pure; the caller persists.
//
// `baseline == null` means this device has no record of a completed sync for the
// table — it has never synced, or its last sync predates the snapshot syncTable
// records. Nothing can be concluded from local state alone in that case, and in
// particular the presence of `updated_at` must NOT be read as "already synced":
// `makeWorkoutNoteItem` (mobile/lib/data/exerciseCatalog.js) stamps one on every
// note the user creates, so a note written through the local adapter while
// signed out carries one too. Treating it as synced is exactly how a signed-out
// note got skipped, then recorded as a baseline, and stranded on the device
// permanently.
//
// So this returns `deferred` and enqueues NOTHING. The unbaselined case belongs
// to `reconcileAgainstRemote`, which syncTable runs against the server's row set
// once the pull has completed; that is real evidence rather than an inference,
// and it is available before any baseline is recorded.
export function reconcileAgainstBaseline({ current, baseline, clientId }) {
  const dirty = [];

  if (baseline == null) return { dirty, deferred: true };

  const baselineById = new Map();
  for (const rec of baseline) {
    if (rec && rec.id != null) baselineById.set(rec.id, rec);
  }

  const seen = new Set();
  for (const rec of current || []) {
    if (!rec || rec.id == null) continue;
    seen.add(rec.id);
    const base = baselineById.get(rec.id);
    // Unchanged since the state the server and this device last agreed on. Leave
    // it alone: re-stamping would move updated_at forward for no reason and let
    // this device beat another device's genuine edit on the next merge.
    if (base && payloadFingerprint(base) === payloadFingerprint(rec)) continue;
    // A new row, an edit, or a tombstone that never made it into the queue.
    // Merge over the baseline so columns the local writer never touched (and a
    // local-adapter write touches only the domain fields) still ride along.
    const merged = { ...(base || {}), ...rec };
    dirty.push(
      isTombstone(rec) ? stampTombstone(merged, clientId) : stampWrite(merged, clientId)
    );
  }

  for (const [id, base] of baselineById) {
    if (seen.has(id)) continue;
    // Already a synced tombstone: the row is gone locally because it was
    // deleted, pushed, and cleaned up. Nothing new to say about it.
    if (isTombstone(base)) continue;
    // Present at the last sync and physically absent now. The local adapter's
    // delete removes the row instead of tombstoning it, so this is the only
    // trace a signed-out delete leaves — and without it the next pull would
    // simply resurrect the row from the cloud.
    dirty.push(stampTombstone({ ...base }, clientId));
  }

  return { dirty, deferred: false };
}

// The unbaselined (upgrade-window) reconciliation, run inside syncTable against
// the rows a FULL pull returned. Pure; the caller enqueues.
//
// The rule is a single invariant, and it is deliberately phrased in terms of the
// merge that is about to run rather than in terms of guessed intent:
//
//     enqueue every local row that the merge will KEEP and that the server does
//     not already hold in exactly that form.
//
// That is what makes the baseline syncTable records at the end of the pass
// honest. After the push, every row local state keeps is a row the server also
// has, so "the last state this device and the server agreed on" is true by
// construction. Anything weaker re-creates the stranding bug; anything stronger
// (enqueueing on any difference) would make this device win LWW unconditionally
// and clobber an edit another device made while this one was signed out.
//
// `pickWinner` is used rather than a hand-rolled comparison precisely because it
// is what `mergeRecords` uses. If local loses, the merge overwrites local with
// the remote row and nothing diverges, so there is nothing to push. If local
// wins, the merge keeps local, and NOT pushing it is what would strand it.
//
// DELETES — a row present on the server and absent locally. Local state alone
// cannot classify it, but the stored pull CURSOR can, because it is
// server-authored evidence of what a completed, inclusive, paginated pull had
// already delivered to this device (see assessCursorTrust). Three cases, and the
// safety ordering is absolute: never tombstone a row that may not have been
// observed.
//
//   1. TRUSTWORTHY cursor, `server.updated_at <= cursor` → the engine's pull
//      already delivered this row to this device, so its absence now is evidence
//      of a local delete performed while signed out. Propagate the tombstone.
//
//   2. TRUSTWORTHY cursor, `server.updated_at > cursor` → this VERSION of the row
//      postdates the last pull window this device completed, so this device never
//      observed it. Explicit policy: preserve the remote row, no tombstone, no
//      conflict. This is not a guess — it is the engine's own convergence rule.
//      Any signed-out delete here went unrecorded and never reached the server,
//      while the remote write did; under "last write to REACH THE SERVER wins"
//      the remote row is the later write and legitimately survives. The ordinary
//      merge restores it locally.
//
//   3. Cursor MISSING → the decision depends on `ownedDevice`, the transition
//      context threaded from the app layer, because a missing cursor is reachable
//      from two genuinely different states that local data alone cannot always
//      tell apart (an owned device that deleted every row locally looks exactly
//      like a clean download):
//        - clean device first download / #538 rebuild (`ownedDevice === false`):
//          there is nothing to contradict, so nothing is inferred and nothing is
//          blocked. Restoring the full remote set IS the download. Blocking here
//          would break every fresh install and the post-purge rebuild.
//        - owned device with real prior sync history whose cursor was cleared by
//          #523 healing or #538 rearm (`ownedDevice === true`): this absent-local
//          row can be neither classified as a signed-out delete (no cursor proves
//          it was observed) nor safely restored-as-success (that is the exact
//          contract failure #525 exists to close), so it is genuinely unresolved.
//      Cursor INVALID or UNTRUSTWORTHY (malformed / ahead-of-server /
//      uncorroborated), with at least one such row → genuinely unresolved
//      regardless of `ownedDevice`. Every unresolved id is reported to the caller,
//      which stops the pass before recording a baseline. No tombstone is
//      fabricated and no success is claimed; the merge still restores the rows and
//      the retry converges. Deliberately NOT a destructive inference: an owned
//      device never tombstones from a missing cursor, it only refuses to lie.
//
// A remote row that is ALREADY a tombstone needs no inference in any case: the
// delete has already propagated, and the row is absent locally because it was
// cleaned up.
export function reconcileAgainstRemote({
  current,
  remote,
  clientId,
  cursor = null,
  ownedDevice = false,
}) {
  const remoteById = new Map();
  for (const rec of remote || []) {
    if (rec && rec.id != null) remoteById.set(rec.id, rec);
  }

  const dirty = [];
  const seen = new Set();
  for (const rec of current || []) {
    if (!rec || rec.id == null) continue;
    seen.add(rec.id);
    const server = remoteById.get(rec.id);
    if (server) {
      // The server already holds this row in the same form. Nothing to say.
      if (payloadFingerprint(server) === payloadFingerprint(rec)) continue;
      // The remote row wins the merge, so it is about to replace local state.
      if (pickWinner(rec, server) !== rec) continue;
    }
    // Either the server has never seen this row (a signed-out create, whether or
    // not it carries an `updated_at`), or local wins the merge (a signed-out
    // edit or delete-then-recreate). Merge over the server's copy so columns the
    // local writer never touched still ride along.
    const merged = { ...(server || {}), ...rec };
    dirty.push(
      isTombstone(rec) ? stampTombstone(merged, clientId) : stampWrite(merged, clientId)
    );
  }

  const trust = assessCursorTrust({ cursor, remote });
  const commitBoundary = parseCommitSafeCursor(cursor);
  const unresolved = [];
  for (const [id, server] of remoteById) {
    if (seen.has(id) || isTombstone(server)) continue;
    if (trust.trusted) {
      // Case 1: inside the window a completed pull already delivered.
      const rowXid = server[ROW_XID_FIELD];
      const deliveredByCommitBoundary =
        commitBoundary != null && rowXid != null && BigInt(rowXid) < commitBoundary;
      const deliveredByLegacyTimestamp =
        commitBoundary == null && (server.updated_at || '') <= cursor;
      if (deliveredByCommitBoundary || deliveredByLegacyTimestamp) {
        dirty.push(stampTombstone({ ...server }, clientId));
      }
      // Case 2: after the window. Preserve; the merge restores it.
      continue;
    }
    // Case 3. A missing cursor is the first-download state on a clean device, so
    // it is not a conflict there; on an owned device it is unclassifiable and must
    // surface honestly rather than restore-as-success. Every other untrusted
    // reason (malformed / ahead-of-server / uncorroborated) is unresolved either
    // way.
    if (trust.reason === 'absent' && !ownedDevice) continue;
    unresolved.push(id);
  }

  return { dirty, unresolved, cursorTrust: trust };
}

// Reconcile one dirty-queue-tracked collection table against its baseline and
// enqueue whatever diverged, so the sync pass that follows pushes it.
//
// Does not write local domain storage. The enqueued rows are what the push
// sends, and the server's acknowledgement is what lands back in local storage
// through the ordinary loop — so a reconciliation that is interrupted after
// enqueueing but before pushing leaves local data untouched and simply retries.
//
// Idempotent: re-running before a successful push overwrites the same queue
// entries under the same ids, and re-running after one finds local state equal
// to the refreshed baseline and enqueues nothing.
//
// Returns `deferred: true` when the table has no baseline yet. That is not a
// failure and not "nothing to do": it means the reconciliation for this table
// belongs to syncTable's unbaselined pass, which has the server's row set to
// work from. Callers that need the work to have happened must run a sync pass.
export async function reconcileLocalWrites({ table, readLocal }) {
  const clientId = await getClientId();
  const [current, baseline] = await Promise.all([readLocal(), getSyncSnapshot(table)]);
  const { dirty, deferred } = reconcileAgainstBaseline({
    current: current || [],
    baseline,
    clientId,
  });
  await enqueueDirtyMany(table, dirty);
  return { table, reconciled: dirty.length, deferred: Boolean(deferred) };
}

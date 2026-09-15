import * as Storage from '../entries';
import {
  SYNC_TABLES,
  syncTable,
  syncDiffTable,
  getDirtyRecords,
  getSyncSnapshot,
  diffAgainstBaseline,
  reconcileAgainstBaseline,
  enqueueDirtyMany,
} from '../syncQueue';
import { deriveFatigueCheckinRows } from './bootstrapPlan';
import { getTransport, getRecomputeDerived } from './transport';
import {
  createPassCache,
  createTableIo,
  tombstoneLocalPhantoms,
  cascadeDeletedBlockMemberships,
  COLLECTION_SYNC_TABLES,
} from './syncTableIo';
import { orderRecoveryPush, RECOVERY_SYNC_TABLES } from './syncRecoveryResolution';
import { withSingletonIds, DIFF_TABLES } from './syncSingletons';
import { reconcileSignedOutWrites } from './signedOutReconciliation';

async function syncOne(table, tableIo, ownedDevice = false, knownUnbaselined = null) {
  const io = tableIo[table];
  return syncTable({
    table,
    transport: getTransport(),
    readLocal: io.read,
    writeLocal: io.write,
    recomputeDerived: getRecomputeDerived(),
    // Only the recovery collections need one; see orderRecoveryPush for the two
    // orderings and the wedge they exist to prevent.
    orderPush: orderRecoveryPush(table),
    // These three are the tables whose signed-out writes the dirty queue misses,
    // so they opt into the unbaselined (upgrade-window) reconciliation described
    // in syncQueue: on the one pass where no baseline exists yet, reconcile
    // against a full pull instead of against local state (#525). That pass also
    // classifies signed-out deletes against the validated pull cursor, and can
    // throw SyncReconciliationConflictError when the cursor cannot establish what
    // this device already observed — which fails the SYNC phase with an
    // actionable message instead of reporting success over an unreconciled table.
    reconcileUnbaselined: true,
    // Transition context for the missing-cursor case (#525, round 4). Only the app
    // layer knows whether this pass is a clean-device first download / #538
    // rebuild (false) or an owned device whose cursor was cleared (true); see
    // reconcileAgainstRemote. Defaults false so every unthreaded caller (the
    // background maybeSyncCloud refresh, #538 rebuildCloudCopy, tests) keeps the
    // safe non-blocking first-download behaviour.
    ownedDevice,
    // The baseline this table's reconciliation already read moments ago in this
    // same pass (issue #806). `null` makes syncTable read it itself, which is
    // what every caller outside runSyncPass gets.
    knownUnbaselined,
  });
}

// A status read must not run a sync pass just to learn whether a save still
// needs upload. Collection writes are already present in the persisted dirty
// queue; the settings/history tables below intentionally have no write-time
// queue hooks, so compare their live projection to the last server-confirmed
// snapshot using the same diff as syncDiffTable. This function never stamps,
// enqueues, pulls, pushes, or changes a snapshot.
//
// fatigue_checkins is deliberately excluded. It is a deterministic projection
// of workout_notes, not a user-authored intent in its own right; any source
// note change is already represented by the collection queue or health profile.
const STATUS_DIFF_TABLES = Object.freeze(
  DIFF_TABLES.filter(({ table }) => table !== SYNC_TABLES.FATIGUE_CHECKINS)
);

// The recovery collections have no write-time queue hook (see the recovery
// methods in storage/cloudAdapter.js): the domain writes them through the same
// storage module in both adapter modes, and the sync engine picks the change up
// through reconcileSignedOutWrites at the start of the next pass. That is what
// makes them correct, but it also means their dirty queue is EMPTY between the
// write and that pass — so reading the queue alone would report "nothing to
// upload" over a recovery block the user just created.
//
// Reconciling against the persisted baseline is the same evidence the pass
// itself uses, so the count reported here is the count the next pass will push.
// Pure: it reads local state and the snapshot, and enqueues/stamps nothing (the
// stamped records reconcileAgainstBaseline builds are counted and discarded).
// The other three collection tables are deliberately not read this way — they DO
// enqueue at write time, so their queue is already the answer.
const STATUS_RECONCILED_COLLECTION_TABLES = RECOVERY_SYNC_TABLES;

export async function getPendingSyncIntent() {
  const dirtyByTable = await Promise.all(
    Object.values(SYNC_TABLES).map(async (table) => ({
      table,
      records: await getDirtyRecords(table),
    }))
  );
  const dirtyCount = dirtyByTable.reduce((count, { records }) => count + records.length, 0);

  const tableIo = createTableIo(() => {});
  const reconciled = await Promise.all(
    STATUS_RECONCILED_COLLECTION_TABLES.map(async (table) => {
      const baseline = await getSyncSnapshot(table);
      // No baseline: this device has no server-confirmed state to diff against,
      // so it cannot claim an upload is pending. Same rule as the diff tables.
      if (baseline == null) return { table, count: 0 };
      const { dirty } = reconcileAgainstBaseline({
        current: (await tableIo[table].read()) || [],
        baseline,
        clientId: 'pending-intent-read',
      });
      // A record already sitting in the dirty queue is counted once, above.
      const queued = new Set(
        (dirtyByTable.find((entry) => entry.table === table)?.records || []).map((r) => r.id)
      );
      return { table, count: dirty.filter((rec) => !queued.has(rec.id)).length };
    })
  );
  const reconciledCount = reconciled.reduce((count, result) => count + result.count, 0);

  const diffed = await Promise.all(
    STATUS_DIFF_TABLES.map(async (config) => {
      const baseline = await getSyncSnapshot(config.table);
      // No snapshot means this device has no server-confirmed baseline to
      // compare against. Treat that as local cache rather than inventing an
      // upload claim; the first real pass establishes the baseline safely.
      if (baseline == null) return { table: config.table, count: 0 };
      const current = (await config.buildLocal()) || [];
      const { dirty } = diffAgainstBaseline({
        current,
        baseline,
        // The value is never persisted: diffing needs an id only to construct
        // hypothetical records, and we retain only the count.
        clientId: 'pending-intent-read',
        payloadFields: config.payloadFields,
        fieldKinds: config.fieldKinds,
        allowDelete: config.allowDelete,
        isEmptyLocal: config.isEmptyLocal,
      });
      return { table: config.table, count: dirty.length };
    })
  );
  const diffCount = diffed.reduce((count, result) => count + result.count, 0);

  return {
    hasPending: dirtyCount + diffCount + reconciledCount > 0,
    dirtyCount,
    diffCount,
    reconciledCount,
    tables: [...dirtyByTable, ...diffed, ...reconciled]
      .filter(({ records, count }) => (records ? records.length : count) > 0)
      .map(({ table }) => table)
      .filter((table, index, all) => all.indexOf(table) === index),
  };
}

// Consent (#487) is deliberately NOT checked here. This module is transport-
// agnostic by contract — the transport is injected, and the tests drive it with no
// Supabase client at all — so an authorization call in this loop would be both out
// of place and unenforceable. The gate lives at the app seam
// (hooks/entries/syncRecoveryHooks.js), which is where a denial becomes a screen
// the user can act on, and the real boundary is the server's RLS, which refuses
// these reads and writes whether or not any client ever asks.
// `ownedDevice` (issue #525, round 4) is the ONLY behavioural input this function
// takes, and it matters solely on the one upgrade-window pass where a collection
// table has no baseline yet AND its stored cursor is missing. It is false by
// default so a clean-device first download, the #538 post-purge rebuild, the
// background maybeSyncCloud refresh, and every test that calls sync() bare all get
// the safe non-blocking behaviour (restore the remote set, never conflict). The
// app layer passes true only from the ordinary owned-device sync paths — automatic
// same-owner sign-in sync and manual "Sync Now" — where an absent-local remote row
// under a cleared cursor is an unclassifiable signed-out delete that must surface
// an honest conflict instead of being silently restored as success. See
// reconcileAgainstRemote for why local data alone cannot make this call.
//
// Sync mutates a shared collection of local records, cursors, dirty queues, and
// diff snapshots. It therefore cannot safely be re-entrant: two passes can both
// snapshot the same dirty batch, then each clear bookkeeping the other still
// needs. Keep every cloud operation in one process-local queue. Calls with the
// same transition context share the exact promise/pass; callers with different
// `ownedDevice` meaning are deliberately serialized as separate passes so a
// first-download caller can never inherit an owned-device conflict decision (or
// vice versa).
let cloudOperationTail = Promise.resolve();
const inFlightSyncs = new Map();

export function enqueueCloudOperation(operation) {
  const scheduled = cloudOperationTail.then(operation, operation);
  // Keep the queue available after a failed pass while returning the original
  // rejecting promise to its caller.
  cloudOperationTail = scheduled.catch(() => {});
  return scheduled;
}

// Raised at the END of a pass whose recovery-block work failed while every other
// table completed. Carries the first underlying failure as `cause` so the app's
// error surface can still show what actually went wrong.
export class RecoverySyncError extends Error {
  constructor(failures) {
    const [first] = failures;
    super(
      `Recovery-block sync failed for ${failures.map((f) => f.table).join(', ')}: ` +
        `${first?.error?.message || first?.error || 'unknown error'}. Every other table synced.`
    );
    this.name = 'RecoverySyncError';
    this.failures = failures;
    this.recoverySyncFailure = true;
    if (first?.error !== undefined) this.cause = first.error;
  }
}

// The three collection tables with no dependency on each other (issue #806).
// weight_entries, workout_notes, and archived_weight_goals reference nothing in
// one another, are stored under distinct keys, keep distinct cursors, dirty
// queues, and baselines, and their pulls are independent server reads — so
// running them together is a pure overlap of three round trips, not a reordering
// of anything. The two recovery collections are deliberately excluded: a block
// must not be pushed before the note its baseline names, and a membership must
// not be pushed before its block. They stay strictly sequential, after this
// group, exactly as COLLECTION_SYNC_TABLES documents.
const INDEPENDENT_COLLECTION_TABLES = Object.freeze(
  COLLECTION_SYNC_TABLES.filter((table) => !RECOVERY_SYNC_TABLES.includes(table))
);

// Collect deferred recovery resolutions into one batch per table, preserving the
// order they were produced in. Shared by the converging rerun loop and the
// failure drain so both queue the same way.
function groupResolutionsByTable(resolutions) {
  const byTable = new Map();
  for (const { table, record } of resolutions) {
    const batch = byTable.get(table);
    if (batch) batch.push(record);
    else byTable.set(table, [record]);
  }
  return byTable;
}

// Run independent table passes together and settle every one of them before
// raising anything. `Promise.all` would reject at the first failure while the
// others kept running unobserved, which is exactly the "reports failure over
// work that is still in flight" shape the pass must not have. Settling first
// means every table either completed and recorded its own consistent
// cursor/baseline or failed on its own, and only then does the first failure
// fail the pass — the same outcome the sequential loop produced, minus the
// tables it used to skip on the way out.
async function runIndependentPasses(tasks) {
  const settled = await Promise.allSettled(tasks.map((task) => task()));
  const failure = settled.find((outcome) => outcome.status === 'rejected');
  if (failure) throw failure.reason;
  return settled.map((outcome) => outcome.value);
}

export async function runSyncPass({ ownedDevice = false } = {}) {
  const pendingWorkoutNoteTombstones = [];
  const pendingRecoveryResolutions = [];
  const cache = createPassCache();
  const tableIo = createTableIo(
    (tombstone) => pendingWorkoutNoteTombstones.push(tombstone),
    (table, record) => pendingRecoveryResolutions.push({ table, record }),
    cache
  );
  // Before anything else: adopt writes made while signed out (#525). A failure
  // here propagates, so the SYNC phase fails and the user sees a retryable state
  // rather than a success that silently left local data behind.
  const reconciliation = await reconcileSignedOutWrites(tableIo);

  // Each reconciliation result already reports whether this table had a baseline
  // (`deferred` is exactly "no baseline yet"), read moments ago from the same
  // storage syncTable would read again. Hand that answer over instead, once per
  // table: it is consumed by the FIRST pass for the table, because any later
  // rerun in this same pass runs after a baseline has been recorded and the
  // answer no longer holds (issue #806). A table whose reconciliation failed
  // contributes no hint, so its pass reads the baseline itself.
  const unbaselinedHints = new Map();
  for (const result of reconciliation) {
    if (result && !result.error) unbaselinedHints.set(result.table, Boolean(result.deferred));
  }
  const takeUnbaselinedHint = (table) => {
    if (!unbaselinedHints.has(table)) return null;
    const hint = unbaselinedHints.get(table);
    unbaselinedHints.delete(table);
    return hint;
  };
  // Isolated recovery failures (#693) are carried, not thrown, so the pass keeps
  // going for every unrelated table; they are raised together at the end.
  //
  // A failed RECONCILIATION is terminal for this pass and is never cleared by a
  // later success: it means local writes were not enqueued, so a table sync that
  // then "succeeds" has pushed an incomplete set and would record a baseline that
  // launders the rest into looking synced. A failed PUSH is different — the rows
  // are still queued — so it is keyed by table and dropped as soon as a later
  // attempt for that table lands, which is what stops the converging rerun below
  // from reporting a failure over data that did reach the cloud.
  const terminalFailures = reconciliation
    .filter((result) => result && result.error)
    .map(({ table, error }) => ({ table, error }));
  const pushFailures = new Map();
  const results = [];

  // Isolation between the recovery tables and everything else is the point;
  // isolation BETWEEN the two recovery tables is not, because memberships depend
  // on their blocks. The cascade below can only act on a tombstone a successful
  // block PULL delivered, so after a failed block pass local state still shows
  // every parent live and the cascade correctly finds nothing to do — while an
  // unconditional membership pass would upload a membership created offline
  // against a block that is deleted remotely. The foreign key accepts it (the
  // tombstoned parent row is physically present), so the stranded note returns
  // through the failure path. The membership pass therefore runs only when the
  // most recent block attempt of this pass succeeded.
  let blocksSynced = false;
  let weeksDeferred = false;

  const syncRecoveryTable = async (table) => {
    if (table === SYNC_TABLES.RECOVERY_BLOCK_WEEKS && !blocksSynced) {
      // Not a failure of its own: the block failure is already recorded and is
      // what fails this pass. The rows stay queued and this device pushes them
      // once it can see the blocks they belong to.
      weeksDeferred = true;
      results.push({ table, skipped: true, dependsOn: SYNC_TABLES.RECOVERY_BLOCKS });
      return;
    }
    try {
      // Every membership pass is preceded by the cascade, reruns included: the
      // blocks pass immediately before it may have pulled a tombstone, and a
      // membership left live under a deleted block would upload and strand its
      // note. Throwing here deliberately skips the push rather than sending a
      // set this device knows is inconsistent.
      if (table === SYNC_TABLES.RECOVERY_BLOCK_WEEKS) {
        await cascadeDeletedBlockMemberships(cache);
      }
      results.push(await syncOne(table, tableIo, ownedDevice, takeUnbaselinedHint(table)));
      if (table === SYNC_TABLES.RECOVERY_BLOCKS) blocksSynced = true;
      if (table === SYNC_TABLES.RECOVERY_BLOCK_WEEKS) weeksDeferred = false;
      pushFailures.delete(table);
    } catch (error) {
      if (table === SYNC_TABLES.RECOVERY_BLOCKS) blocksSynced = false;
      results.push({ table, failed: true, error });
      pushFailures.set(table, error);
    }
  };

  // Rows a table's write DEFERRED (phantom-note tombstones, collapsed recovery
  // duplicates) exist only in these in-memory lists until they are queued. That
  // is fine while the pass runs to completion — it enqueues and reruns them
  // below — but a table that COMPLETED and deferred rows has already recorded a
  // baseline containing them, so the next pass's reconciliation finds no local
  // difference and never rediscovers them. If the pass is about to fail for an
  // unrelated reason, the deferred rows must reach the durable dirty queue
  // first, or a tombstone this device minted is silently never uploaded and the
  // phantom row lives on in the cloud.
  const drainDeferredWrites = async () => {
    if (pendingWorkoutNoteTombstones.length > 0) {
      await enqueueDirtyMany(
        SYNC_TABLES.WORKOUT_NOTES,
        pendingWorkoutNoteTombstones.splice(0)
      );
    }
    if (pendingRecoveryResolutions.length === 0) return;
    for (const [table, batch] of groupResolutionsByTable(
      pendingRecoveryResolutions.splice(0)
    )) {
      // eslint-disable-next-line no-await-in-loop
      await enqueueDirtyMany(table, batch);
    }
  };

  try {
    await tombstoneLocalPhantoms(cache);
    results.push(
      ...(await runIndependentPasses(
        INDEPENDENT_COLLECTION_TABLES.map(
          (table) => () => syncOne(table, tableIo, ownedDevice, takeUnbaselinedHint(table))
        )
      ))
    );
    for (const table of RECOVERY_SYNC_TABLES) {
      // eslint-disable-next-line no-await-in-loop
      await syncRecoveryTable(table);
    }
    if (pendingWorkoutNoteTombstones.length > 0) {
      const tombstones = pendingWorkoutNoteTombstones.splice(0);
      await enqueueDirtyMany(SYNC_TABLES.WORKOUT_NOTES, tombstones);
      // No baseline hint: the pass above already recorded one for this table.
      results.push(await syncOne(SYNC_TABLES.WORKOUT_NOTES, tableIo, ownedDevice));
    }

    // Collapsed cross-device duplicates (issue #693). The write that produced them
    // ran inside syncTable, which snapshots and clears its dirty batch around
    // writeLocal, so — exactly like the phantom-note tombstones above — they are
    // enqueued here and pushed by a rerun of their own table. This is what makes a
    // two-device duplicate converge inside ONE sync() call: the first attempt is
    // rejected by the partial unique index, the merge that follows collapses the
    // duplicate locally, and this rerun uploads the collapsed rows.
    //
    // Drained in a bounded loop because a rerun can itself pull a row that
    // collapses. Every resolved row MUST be enqueued before its table records a
    // baseline, or the baseline would launder a local-only change into looking
    // synced — the invariant syncTable documents at step 6. In practice the
    // collapse is idempotent and the first round settles it; the bound exists so a
    // pathological case ends the pass rather than spinning, and anything still
    // pending is carried by the dirty queue into the next one.
    for (let round = 0; round < 3 && pendingRecoveryResolutions.length > 0; round += 1) {
      const byTable = groupResolutionsByTable(pendingRecoveryResolutions.splice(0));
      const tables = [...byTable.keys()];
      for (const [table, batch] of byTable) {
        // eslint-disable-next-line no-await-in-loop
        await enqueueDirtyMany(table, batch);
      }
      // Preserve the blocks-before-memberships dependency order on the rerun too.
      for (const table of RECOVERY_SYNC_TABLES) {
        if (!tables.includes(table)) continue;
        // eslint-disable-next-line no-await-in-loop
        await syncRecoveryTable(table);
      }
    }

    // A block rerun above can recover a block pass that failed earlier in this
    // same pass. The memberships deferred by that failure are safe to sync now —
    // this device has seen the blocks — so run them rather than making the user
    // wait for another pass to push rows that are already reconciled.
    if (weeksDeferred && blocksSynced) {
      await syncRecoveryTable(SYNC_TABLES.RECOVERY_BLOCK_WEEKS);
    }

    // The tables bootstrap used to push once and abandon (issue #489). Run them
    // after the workout-note passes above (including the phantom-tombstone rerun,
    // which can clear the current routine) so user_health_profile uploads the
    // settled current_workout_note_id rather than one this pass is about to drop.
    //
    // The six run TOGETHER (issue #806). Each owns a distinct set of local storage
    // keys, a distinct cursor, dirty queue and baseline, and none reads a value
    // another one writes — so there is no order among them to preserve, and the
    // only thing serializing them bought was six round trips end to end instead of
    // one. The orders that DO matter are unchanged: every collection pass above
    // has already completed, so fatigue_checkins still projects the settled
    // notebook and user_health_profile still uploads a current_workout_note_id
    // this pass is not about to drop.
    const singletonAware = withSingletonIds(getTransport());
    const diffConfigs = DIFF_TABLES.map((config) =>
      config.table === SYNC_TABLES.FATIGUE_CHECKINS
        ? {
            ...config,
            // Derived from the same converged notebook the collection pass just
            // wrote, read from the pass cache instead of decrypting and parsing
            // every note a second time.
            buildLocal: async () =>
              deriveFatigueCheckinRows(
                await cache.read(SYNC_TABLES.WORKOUT_NOTES, Storage.loadWorkoutNotesRaw)
              ),
          }
        : config
    );
    results.push(
      ...(await runIndependentPasses(
        diffConfigs.map(
          (config) => () => syncDiffTable({ ...config, transport: singletonAware })
        )
      ))
    );
  } catch (error) {
    // Best effort, and deliberately not allowed to replace the failure the user
    // needs to see: if this drain also fails the deferred rows are exactly as
    // lost as they would have been without it, while the original error is the
    // one that explains the failed pass.
    await drainDeferredWrites().catch(() => {});
    throw error;
  }

  // Every unrelated table is now synced and persisted. What remains unresolved is
  // reported here, and it IS reported: swallowing it would let the UI claim
  // "Fully synced" over recovery data that never reached the cloud, which is the
  // same contract failure #525 exists to close. A rejection that the collapse
  // rerun then resolved is deliberately NOT reported — the rows did reach the
  // cloud, and an error the user cannot act on is its own kind of dishonesty.
  const recoveryFailures = [
    ...terminalFailures,
    ...[...pushFailures].map(([table, error]) => ({ table, error })),
  ];
  if (recoveryFailures.length > 0) throw new RecoverySyncError(recoveryFailures);

  return results;
}

export function sync({ ownedDevice = false } = {}) {
  const key = ownedDevice ? 'owned-device' : 'first-download';
  const inFlight = inFlightSyncs.get(key);
  if (inFlight) return inFlight;

  const pass = enqueueCloudOperation(() => runSyncPass({ ownedDevice }));
  inFlightSyncs.set(key, pass);
  const clearInFlight = () => {
    if (inFlightSyncs.get(key) === pass) inFlightSyncs.delete(key);
  };
  // Handle both paths rather than `finally`, whose returned rejection would be
  // detached from callers and can become an unhandled rejection in React Native.
  pass.then(clearInFlight, clearInFlight);
  return pass;
}

import {
  getClientId,
  mergeRecords,
  SyncReconciliationConflictError,
} from './records';
import {
  enqueueDirtyMany,
  getDirtyRecords,
  clearDirty,
} from './dirtyQueue';
import {
  getCursor,
  normalizePullResult,
  recoverPushAcknowledgements,
  applyPushAcknowledgements,
  advanceCursorFromServerEvidence,
} from './cursors';
import { getSyncSnapshot, setSyncSnapshot } from './snapshots';
import { reconcileAgainstRemote, diffAgainstBaseline } from './reconciliation';

// ── sync loop ──────────────────────────────────────────────────────────────────

// Run one full sync pass for a single table against an injected transport.
//
// transport contract:
//   - pull(table, cursor) -> Promise<Array<record>>   changed rows since cursor
//   - push(table, records) -> Promise<void>           upsert dirty rows (incl.
//                                                      tombstones)
//
// readLocal()/writeLocal(list) read and persist the local cache list for the
// table. recomputeDerived(raw_text) is used for the workout-note recompute rule.
//
// Loop shape (roadmap): pull changed rows since cursor -> merge into local cache
// -> push dirty local records -> advance the per-table cursor only after the
// push succeeds. Tombstones are pushed alongside live records so a delete syncs
// before any physical deletion. If the push throws, the cursor is NOT advanced
// and the dirty queue is left intact so the next pass retries.
//
// `orderPush(records)` optionally reorders the batch handed to `transport.push`.
// It exists because a table can carry a constraint the DATABASE evaluates ROW BY
// ROW inside one statement rather than against the batch's end state: Postgres
// checks a non-deferrable unique index as each row of an
// `insert ... on conflict do update` is processed, against the state the earlier
// rows produced. A batch whose completed form satisfies every index is still
// rejected if a row CLAIMS a slot that a LATER row in the same batch frees.
//
// The dirty queue is keyed by id and returns insertion order, which has no
// relationship to that dependency — so without this hook a table with such a
// constraint can queue a permanently failing order and retry it forever (the
// recovery-block wedge; see storage/cloud/syncAdapter.js for the two orderings
// that matter and why they are content-derived). It is a pure reordering: the
// same records, and `clearDirty` still acknowledges the snapshots this pass read,
// so nothing else in the loop depends on the order.
//
// `reconcileUnbaselined` opts the table into the first-pass reconciliation
// described under "signed-out write reconciliation" below. It is a parameter
// rather than unconditional behaviour because it makes the pass pull the FULL
// remote table, which is only worth doing for the collection tables whose local
// writes the dirty queue can miss.
//
// `ownedDevice` is the transition context reconcileAgainstRemote needs when the
// stored cursor is MISSING (issue #525, round 4). It is threaded from the app
// layer (hooks/entries/syncRecoveryHooks.js), which is the only place that knows
// whether this pass is a genuine clean-device first download / #538 rebuild
// (false) or an owned device with real prior sync history whose cursor was
// cleared (true). It defaults to false so the safe first-download behaviour is
// what every unthreaded caller gets. It only changes the missing-cursor case;
// every other cursor outcome is identical.
//
// `knownUnbaselined` (issue #806) lets a caller that has ALREADY read this
// table's snapshot in this same pass state whether one existed, instead of
// making this function read and decrypt the whole baseline again just to test it
// against null. `reconcileSignedOutWrites` reads exactly that value moments
// earlier, and nothing between the two writes a snapshot for this table, so the
// answer is the same one this read would produce. Pass `null`/omit to have the
// read performed here as before.
export async function syncTable({
  table,
  transport,
  readLocal,
  writeLocal,
  recomputeDerived,
  orderPush,
  reconcileUnbaselined = false,
  ownedDevice = false,
  knownUnbaselined = null,
}) {
  const clientId = await getClientId();
  const storedCursor = await getCursor(table);

  // Issue #525. `reconcileAgainstBaseline` (below) can only detect a signed-out
  // write by diffing against a recorded baseline. A device upgrading into this
  // build has no baseline for this table yet, so that diff has nothing to say —
  // and if the pass below simply recorded the current local table as the new
  // baseline, any signed-out write sitting in it would be laundered into looking
  // synced forever. This pass therefore reconciles against the SERVER's row set
  // instead, which needs no prior local state.
  const unbaselined =
    reconcileUnbaselined &&
    (typeof knownUnbaselined === 'boolean'
      ? knownUnbaselined
      : (await getSyncSnapshot(table)) == null);

  // 1. Pull changed rows since the last cursor.
  //
  //    On an unbaselined pass the stored cursor is deliberately IGNORED so the
  //    pull returns the complete server row set. A delta pull cannot ground this
  //    reconciliation: an already-synced row that simply predates the cursor
  //    would be absent from the delta and therefore indistinguishable from a row
  //    the server has never seen, so every local row would be re-pushed and this
  //    device would claim authorship of the whole table. This costs one full
  //    pull, once per table, on the upgrade pass only.
  const cursor = unbaselined ? null : storedCursor;
  const pulled = normalizePullResult((await transport.pull(table, cursor)) || []);
  const remote = pulled.rows;

  // 1b. Adopt local rows the server does not already hold in the same form (see
  //     reconcileAgainstRemote). Enqueued before the dirty queue is read below,
  //     so the ordinary push in step 4 uploads them; nothing local is written
  //     here, so an interrupted pass simply retries.
  //
  //     Signed-out DELETES are classified here too, against the stored cursor
  //     (which the pull above deliberately ignored, but which is still the
  //     server-authored record of what this device has already observed). See
  //     reconcileAgainstRemote for the three cases and assessCursorTrust for why
  //     the cursor is validated rather than trusted.
  let unresolvedConflict = null;
  if (unbaselined) {
    const {
      dirty: adopted,
      unresolved,
      cursorTrust,
    } = reconcileAgainstRemote({
      current: (await readLocal()) || [],
      remote,
      clientId,
      cursor: storedCursor,
      ownedDevice,
    });
    await enqueueDirtyMany(table, adopted);
    if (unresolved.length > 0) {
      unresolvedConflict = { table, reason: cursorTrust.reason, ids: unresolved };
    }
  }

  // 2. Collect what is awaiting upload BEFORE merging. These are local writes
  //    and tombstones that have never reached the server.
  //
  //    (writeLocal may DEFER new workout-note tombstones rather than enqueueing
  //    them — see createTableIo — so they are not in this set and ride the
  //    follow-up pass sync() runs for them. Reading the queue here is therefore
  //    equivalent to reading it after writeLocal, and lets the merge below see
  //    which ids have local intent.)
  const dirty = await getDirtyRecords(table);
  const dirtyIds = new Set(dirty.map((d) => d.id));

  // 3. Merge remote into the local cache via LWW (+ derived recompute) — but a
  //    row with a pending local edit is NOT put to a vote against its remote
  //    counterpart.
  //
  //    A local record carries a DEVICE-clock `updated_at`; `transport.push`
  //    strips `updated_at` so the server trigger assigns the authoritative one.
  //    The two are from different clocks and are not comparable. Running them
  //    through pickWinner meant a device whose clock lagged the server lost:
  //    `merged.get(id)` returned the REMOTE row, which was then pushed in place
  //    of the pending local write and cleared from the dirty queue.
  //
  //    For a tombstone that means a DELETE never reaches the cloud and the row
  //    resurrects on the next pull. This is the same defect fixed in
  //    syncDiffTable; it lives here too, on the path that carries weight
  //    entries and workout notes.
  //
  //    "Last write to REACH the server wins" — so arrival decides, not a guess
  //    made on the client first. A pending row is always submitted; the server
  //    stamps it on arrival, necessarily later than the row just pulled.
  const localList = (await readLocal()) || [];
  const contested = remote.filter((r) => !dirtyIds.has(r.id));
  const merged = mergeRecords(localList, contested, { table, recomputeDerived });
  let mergedList = Array.from(merged.values());
  // `writeLocal` may transform the list before persisting it (see
  // syncAdapter.createTableIo, which tombstones phantom legacy notes and
  // collapses cross-device recovery duplicates during the write), so it returns
  // what it actually put on disk. That returned list — not `mergedList`, and not
  // a re-read — is what step 6 records as the baseline (issue #806). The
  // fallback keeps writers that return nothing working unchanged.
  let persistedList = (await writeLocal(mergedList)) || mergedList;

  // 4. Push dirty local records (live writes and tombstones together). A delete
  //    rides this same push as a tombstone, so it always reaches the cloud
  //    before any physical deletion happens locally.
  let acknowledged = [];
  if (dirty.length > 0) {
    const pending = dirty.map((d) => merged.get(d.id) || d);
    // See `orderPush` above: for a table whose constraints are checked per row,
    // the queue's insertion order is not a safe statement order.
    const toPush = typeof orderPush === 'function' ? orderPush(pending) : pending;
    const recovered = await recoverPushAcknowledgements(
      table,
      transport,
      cursor,
      toPush,
      await transport.push(table, toPush)
    );
    acknowledged = recovered.rows;
    await clearDirty(table, dirty);

    // The acknowledgement is the persisted form of the pending write, so it
    // replaces that device-stamped local version unconditionally. Comparing the
    // two timestamps via LWW would reintroduce device-clock skew here.
    if (recovered.replacesLocal) applyPushAcknowledgements(merged, acknowledged);
    if (recovered.replacesLocal && acknowledged.length > 0) {
      mergedList = Array.from(merged.values());
      persistedList = (await writeLocal(mergedList)) || mergedList;
    }
  }

  // 5. Advance only from server-authored rows: the complete pull plus any rows
  //    returned after Postgres stamped a successful push. This spans the FULL
  //    remote set, including rows excluded from the merge above. If an injected
  //    transport does not return acknowledgements, the pushed rows are safely
  //    picked up by the next inclusive pull instead.
  await advanceCursorFromServerEvidence(
    table,
    cursor,
    remote,
    acknowledged,
    pulled.cursor
  );

  // 6. Record the last-synced baseline for this table (issue #525). The dirty
  //    queue only knows about writes made through the CLOUD adapter; writes made
  //    while signed out go through the local adapter, which neither stamps nor
  //    enqueues them, and whose delete removes the row outright instead of
  //    leaving a tombstone. Without a durable record of what this device and the
  //    server last agreed on there is no way to tell such a write from an
  //    untouched row, so reconcileLocalWrites below diffs against this snapshot.
  //
  //    Record what writeLocal actually PERSISTED rather than `mergedList`:
  //    writeLocal may legitimately transform the list before persisting it (see
  //    syncAdapter.createTableIo, which tombstones phantom legacy notes during
  //    the write), and a baseline that does not match what is actually on disk
  //    would read as a local edit on the very next pass. This used to re-read
  //    the table instead, which is both a full extra decrypt+parse of every row
  //    and strictly less accurate: a domain write landing between writeLocal and
  //    the re-read would be baked into the baseline and laundered into looking
  //    synced. The persisted list is the exact bytes this pass wrote (#806).
  //
  //    Reached only after a successful push, because the push either throws
  //    (leaving the previous baseline and the dirty queue intact for a retry) or
  //    completes.
  //
  //    THE INVARIANT: a baseline must never launder an un-uploaded local row
  //    into looking synced. Every row that reaches this line either (a) matched
  //    the baseline this pass diffed against, (b) was enqueued by
  //    reconcileAgainstBaseline / reconcileAgainstRemote / a write-time hook and
  //    has just been pushed, or (c) is still in the dirty queue because the
  //    write deferred it (see syncAdapter.createTableIo), in which case the queue
  //    — not the baseline — is what carries it forward. A push failure throws
  //    before this point, so an uncertain pass fails retryably rather than
  //    completing green.
  //
  //    An UNRESOLVED absent-local remote row (case 3 in reconcileAgainstRemote)
  //    stops the pass right here, before the baseline is written. The issue
  //    objective explicitly permits surfacing an honest actionable state instead
  //    of reporting successful sync, and that is strictly better than either
  //    guess: fabricating a tombstone would destroy cloud data this device may
  //    never have seen, and silently restoring the row while recording a baseline
  //    and reporting success is the contract failure this replaces.
  //
  //    Everything before this line has already happened and is what makes the
  //    state converge rather than wedge: the merge restored the rows into local
  //    storage (step 3), the genuine dirty queue was pushed (step 4), and step 5
  //    replaced the untrustworthy cursor with a server-authored one. So the retry
  //    finds those rows present locally, has no ambiguous row left to classify,
  //    and completes normally. The user sees exactly one honest, actionable
  //    failure and nothing is lost.
  if (unresolvedConflict) throw new SyncReconciliationConflictError(unresolvedConflict);

  await setSyncSnapshot(table, persistedList);

  return {
    table,
    clientId,
    pulled: remote.length,
    pushed: dirty.length,
    records: mergedList,
  };
}

// One full sync pass for a diff-tracked table. Same loop shape as `syncTable`
// (pull -> merge -> push dirty -> advance cursor only after a successful push)
// and the same LWW primitives; the only difference is where "dirty" comes from.
//
//   buildLocal()  -> Promise<Array<record>>  live local state, payload fields + id
//   applyMerged(list) -> Promise<void>       write the merged winners back into
//                                            local domain storage (tombstoned
//                                            rows removed, unsynced local fields
//                                            preserved)
export async function syncDiffTable({
  table,
  transport,
  buildLocal,
  applyMerged,
  payloadFields,
  fieldKinds,
  allowDelete = false,
  isEmptyLocal,
}) {
  const clientId = await getClientId();
  const cursor = await getCursor(table);

  // 1. Pull changed rows since the last cursor.
  const pulled = normalizePullResult((await transport.pull(table, cursor)) || []);
  const remote = pulled.rows;

  // 2. Diff live local state against the last-synced snapshot. With no snapshot
  //    (first pass on this device) seed the baseline from the remote rows, so
  //    local state that already agrees with the cloud is not misread as a fresh
  //    local edit — that would re-stamp it at `now` and let a clean install that
  //    merely hydrated the cloud clobber another device's real data.
  const current = (await buildLocal()) || [];
  const persisted = await getSyncSnapshot(table);
  const seeded = persisted == null;
  const { localList, dirty } = diffAgainstBaseline({
    current,
    baseline: persisted || remote,
    clientId,
    payloadFields,
    fieldKinds,
    allowDelete,
    seeded,
    isEmptyLocal,
  });

  await enqueueDirtyMany(table, dirty);

  // 3. Collect everything awaiting upload BEFORE the merge: this pass's diffs
  //    plus anything left over from a previously failed push. Both are genuine
  //    local edits that have never reached the server.
  const pending = await getDirtyRecords(table);
  const pendingIds = new Set(pending.map((d) => d.id));

  // 4. Merge remote into the diffed local list — but a row with a pending local
  //    edit is NOT put to a vote against its remote counterpart.
  //
  //    A local record is stamped with the DEVICE clock, while `transport.push`
  //    deliberately strips `updated_at` so the DB trigger assigns the
  //    authoritative one. The two timestamps therefore come from different
  //    clocks and are not comparable. Running them through pickWinner meant a
  //    device whose clock merely lagged the server lost the comparison, so the
  //    remote row became the "winner", got written back over the user's edit in
  //    applyMerged, was pushed in place of it, and was then cleared from the
  //    dirty queue — silently discarding the edit and never retrying it.
  //
  //    The rule is "last write to REACH THE SERVER wins", so arrival at the
  //    server is what decides — not a guess made on the client beforehand. A
  //    pending edit is always submitted; the server stamps it on arrival, which
  //    is necessarily later than the row we just pulled, so it wins there. The
  //    client never needs its clock to agree with the server's.
  //
  //    This gates on the DIFF, not on the clock: with no local edit there is
  //    nothing pending, remote applies normally, and a second pass pushes
  //    nothing. Idempotency is unaffected.
  const contested = remote.filter((r) => !pendingIds.has(r.id));
  const merged = mergeRecords(localList, contested, { table });
  let mergedList = Array.from(merged.values());
  await applyMerged(mergedList);
  await setSyncSnapshot(table, mergedList);

  // 5. Push the pending edits. merged.get() now returns the local record for
  //    these ids, so the user's edit is what actually goes up.
  let acknowledged = [];
  if (pending.length > 0) {
    const toPush = pending.map((d) => merged.get(d.id) || d);
    const recovered = await recoverPushAcknowledgements(
      table,
      transport,
      cursor,
      toPush,
      await transport.push(table, toPush)
    );
    acknowledged = recovered.rows;
    await clearDirty(table, pending);

    if (recovered.replacesLocal) applyPushAcknowledgements(merged, acknowledged);
    if (recovered.replacesLocal && acknowledged.length > 0) {
      mergedList = Array.from(merged.values());
      await applyMerged(mergedList);
      await setSyncSnapshot(table, mergedList);
    }
  }

  // 6. Advance only from the full set of server-authored pull rows and
  //    server-stamped push acknowledgements.
  await advanceCursorFromServerEvidence(
    table,
    cursor,
    remote,
    acknowledged,
    pulled.cursor
  );

  return {
    table,
    clientId,
    pulled: remote.length,
    pushed: pending.length,
    records: mergedList,
  };
}

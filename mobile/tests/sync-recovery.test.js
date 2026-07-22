// Signed-out write reconciliation (issue #525).
//
// The lifecycle under test, which #522 confirmed as claim 4:
//
//   1. the user is signed in, cloud mode is active, everything is synced;
//   2. the user signs out — storage switches to LOCAL, but the local-data owner
//      marker is deliberately KEPT, because the history still belongs to them;
//   3. they keep using the app. Every write now goes through the LOCAL adapter,
//      which is a plain AsyncStorage store: it stamps no sync metadata, enqueues
//      nothing dirty, and deletes by removing the row rather than tombstoning it;
//   4. they sign back in as the SAME owner. The marker matches, so bootstrap is
//      skipped and the app switches straight to CLOUD and runs an ordinary sync.
//
// Before the fix that pass consulted the dirty queue, found nothing, pushed zero
// rows, and reported success — the signed-out writes stayed on the device while
// the UI said "synced". These tests drive the real storage layer and the real
// sync engine against an in-memory transport and assert that every locally
// changed row (new, edited, and deleted) reaches the cloud before the SYNC phase
// can complete.

import AsyncStorage from '@react-native-async-storage/async-storage';

// Lets one test make the raw weight-entry read fail so the "reconciliation could
// not complete" path is exercised for real. `var` because jest hoists the
// jest.mock factory above the import block.
// eslint-disable-next-line no-var
var mockFailLoadWeightEntriesRaw = null;

jest.mock('../storage/entries/weightEntries', () => {
  const actual = jest.requireActual('../storage/entries/weightEntries');
  return {
    ...actual,
    loadWeightEntriesRaw: (...args) => {
      if (mockFailLoadWeightEntriesRaw) return Promise.reject(mockFailLoadWeightEntriesRaw);
      return actual.loadWeightEntriesRaw(...args);
    },
  };
});

import * as Storage from '../storage/entries';
import { setCloudTransport } from '../storage/cloudAdapter';
import {
  sync,
  reconcileSignedOutWrites,
  rebuildCloudCopy,
  getPendingSyncIntent,
} from '../storage/cloud/syncAdapter';
import { loadWeightGoal, saveWeightGoal } from '../storage/entries/weightGoal';
import { makeWorkoutNoteItem } from '../lib/data/exerciseCatalog';
import {
  SYNC_TABLES,
  SINGLETON_SYNC_ID,
  assessCursorTrust,
  clearCursor,
  clearSyncSnapshot,
  getCursor,
  setCursor,
  getDirtyRecords,
  getSyncSnapshot,
  isTombstone,
  reconcileAgainstBaseline,
  reconcileAgainstRemote,
  resetClientIdCacheForTests,
  resetStampClockForTests,
} from '../storage/syncQueue';
import {
  SYNC_PHASE,
  SYNC_STATUS,
  getSyncState,
  runPhase,
  __resetSyncQueue,
} from '../storage/syncRecovery';

// ── in-memory fake cloud ─────────────────────────────────────────────────────
//
// Models the real server's contract rather than a kinder one: Postgres accepts
// every upsert and stamps `updated_at` itself (transport.js omits the column
// precisely because a trigger forces now()), and `client_id` is not a stored
// column so nothing pulled ever carries one.
function makeFakeCloud() {
  const tables = {};
  for (const table of Object.values(SYNC_TABLES)) tables[table] = new Map();

  const singletons = new Set([
    SYNC_TABLES.USER_PROFILE,
    SYNC_TABLES.USER_HEALTH_PROFILE,
    SYNC_TABLES.FEATURE_TOGGLES,
    SYNC_TABLES.WEIGHT_GOAL,
  ]);

  const pushes = [];
  let lastServerMs = 0;
  function serverNow(table) {
    let maxMs = Math.max(lastServerMs, Date.now());
    for (const row of tables[table].values()) {
      const ms = Date.parse(row.updated_at || 0);
      if (Number.isFinite(ms) && ms > maxMs) maxMs = ms;
    }
    lastServerMs = maxMs + 1;
    return new Date(lastServerMs).toISOString();
  }

  const transport = {
    async pull(table, cursor) {
      const rows = [...tables[table].values()];
      const changed = cursor ? rows.filter((r) => (r.updated_at || '') >= cursor) : rows;
      const sorted = changed.sort((a, b) =>
        (a.updated_at || '').localeCompare(b.updated_at || '')
      );
      // eslint-disable-next-line no-unused-vars
      const served = sorted.map(({ client_id: _c, ...row }) => row);
      if (!singletons.has(table)) return served;
      // eslint-disable-next-line no-unused-vars
      return served.map(({ id: _id, ...row }) => row);
    },
    async push(table, records) {
      pushes.push({ table, ids: records.map((r) => r.id) });
      const written = [];
      for (const rec of records) {
        // eslint-disable-next-line no-unused-vars
        const { client_id: _clientId, ...row } = rec;
        const stored = { ...row, updated_at: serverNow(table) };
        tables[table].set(rec.id, stored);
        written.push(singletons.has(table) ? { ...stored, id: undefined } : stored);
      }
      return written;
    },
  };

  return {
    transport,
    pushes,
    pushedIds: (table) =>
      pushes.filter((p) => p.table === table).flatMap((p) => p.ids),
    remoteRow: (table, id) => tables[table].get(id),
    remoteRows: (table) => [...tables[table].values()],
    liveRemoteRows: (table) => [...tables[table].values()].filter((r) => !isTombstone(r)),
  };
}

let cloud;

// The three lifecycle steps, expressed once so every test reads as the scenario
// rather than as storage-mode bookkeeping.
function signOut() {
  // Sign-out reverts storage to local and leaves the owner marker in place; the
  // owner marker itself is covered by auto-sync.test.js.
  Storage.setStorageMode(Storage.STORAGE_MODES.LOCAL);
}

function signInAsSameOwner() {
  // What useAutoSync does when the local-data owner matches the signed-in user:
  // no bootstrap, straight to cloud mode, then an ordinary sync pass.
  Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
}

function localAdapter() {
  Storage.setStorageMode(Storage.STORAGE_MODES.LOCAL);
  return Storage.getStorageAdapter();
}

beforeEach(async () => {
  await AsyncStorage.clear();
  resetClientIdCacheForTests();
  resetStampClockForTests();
  __resetSyncQueue();
  cloud = makeFakeCloud();
  setCloudTransport(cloud.transport);
  Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
});

afterEach(() => {
  setCloudTransport(null);
  Storage.setStorageMode(Storage.STORAGE_MODES.LOCAL);
  __resetSyncQueue();
});

// Establish a device that is signed in and fully synced, so the snapshot
// baseline the reconciliation diffs against exists.
async function seedSyncedDevice() {
  const adapter = Storage.getStorageAdapter();
  await adapter.saveWeightEntry({
    id: 'w-existing',
    weight_value: 180,
    logged_at: '2026-07-01T08:00:00.000Z',
    date: '2026-07-01',
  });
  await adapter.saveWorkoutNoteItem({
    id: 'wn-existing',
    title: 'Routine A',
    raw_text: 'Squat 100x5',
    saved_at: '2026-07-01T08:00:00.000Z',
  });
  await sync();
}

// The upgrade window. A device that synced on a build BEFORE syncTable recorded
// collection baselines has real data, a real pull cursor, and NO baseline. That
// is the state in which local `updated_at` carries no information about whether
// a row was ever synced, so reconciliation has to reach for the server instead.
const COLLECTION_TABLES = [
  SYNC_TABLES.WEIGHT_ENTRIES,
  SYNC_TABLES.WORKOUT_NOTES,
  SYNC_TABLES.ARCHIVED_WEIGHT_GOALS,
];

async function simulatePreUpgradeDevice() {
  for (const table of COLLECTION_TABLES) {
    // eslint-disable-next-line no-await-in-loop
    await clearSyncSnapshot(table);
  }
}

describe('collection tables: sign out -> local write -> same-owner sign in', () => {
  it('uploads a row CREATED while signed out', async () => {
    await seedSyncedDevice();

    signOut();
    await localAdapter().saveWeightEntry({
      id: 'w-offline',
      weight_value: 178,
      logged_at: '2026-07-05T08:00:00.000Z',
      date: '2026-07-05',
    });

    // The defect in one assertion: the local adapter left no dirty entry, so
    // before this fix the sync pass below had nothing to push.
    expect(await getDirtyRecords(SYNC_TABLES.WEIGHT_ENTRIES)).toHaveLength(0);

    signInAsSameOwner();
    await sync();

    expect(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w-offline')).toMatchObject({
      id: 'w-offline',
      weight_value: 178,
    });
  });

  it('uploads a row EDITED while signed out', async () => {
    await seedSyncedDevice();

    signOut();
    const updated = await localAdapter().updateWeightEntry('w-existing', 176, 'felt light');
    expect(updated).toBe(true);
    expect(await getDirtyRecords(SYNC_TABLES.WEIGHT_ENTRIES)).toHaveLength(0);

    signInAsSameOwner();
    await sync();

    expect(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w-existing')).toMatchObject({
      weight_value: 176,
      note: 'felt light',
    });
  });

  it('tombstones a row DELETED while signed out, and the cloud copy does not resurrect it', async () => {
    await seedSyncedDevice();

    signOut();
    // The local adapter deletes by removing the row outright — no tombstone is
    // written, so the dirty queue and the local record both lose every trace of
    // the delete. The baseline snapshot is the only thing that still remembers.
    await localAdapter().deleteWeightEntry('w-existing');
    expect(await Storage.loadWeightEntriesRaw()).toHaveLength(0);
    expect(await getDirtyRecords(SYNC_TABLES.WEIGHT_ENTRIES)).toHaveLength(0);

    signInAsSameOwner();
    await sync();

    const remote = cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w-existing');
    expect(remote).toBeDefined();
    expect(isTombstone(remote)).toBe(true);

    // A second pass must not pull the row back into the user's list.
    await sync();
    const visible = await Storage.getStorageAdapter().loadWeightEntries();
    expect(visible.map((e) => e.id)).not.toContain('w-existing');
  });

  it('uploads a workout note created while signed out', async () => {
    await seedSyncedDevice();

    signOut();
    await localAdapter().saveWorkoutNoteItem({
      id: 'wn-offline',
      title: 'Routine B',
      raw_text: 'Bench 80x5',
      saved_at: '2026-07-06T08:00:00.000Z',
    });

    signInAsSameOwner();
    await sync();

    expect(cloud.remoteRow(SYNC_TABLES.WORKOUT_NOTES, 'wn-offline')).toMatchObject({
      id: 'wn-offline',
      raw_text: 'Bench 80x5',
    });
    // The note that was already synced is untouched, not re-uploaded as a new row.
    expect(cloud.liveRemoteRows(SYNC_TABLES.WORKOUT_NOTES).map((n) => n.id).sort()).toEqual([
      'wn-existing',
      'wn-offline',
    ]);
  });

  it('does not overwrite a remote row that changed on another device while this one was signed out', async () => {
    await seedSyncedDevice();

    signOut();
    // Local edit to ONE row while another device edits a DIFFERENT row.
    await localAdapter().updateWeightEntry('w-existing', 176, 'local edit');
    cloud.transport.push(SYNC_TABLES.WEIGHT_ENTRIES, [
      {
        id: 'w-other-device',
        weight_value: 999,
        logged_at: '2026-07-04T08:00:00.000Z',
        date: '2026-07-04',
      },
    ]);

    signInAsSameOwner();
    await sync();

    // Both converge: the local edit reached the cloud and the other device's row
    // reached this device.
    expect(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w-existing').weight_value).toBe(176);
    expect(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w-other-device').weight_value).toBe(999);
    const localIds = (await Storage.loadWeightEntriesRaw()).map((e) => e.id).sort();
    expect(localIds).toEqual(['w-existing', 'w-other-device']);
  });
});

describe('singleton / diff-tracked tables: sign out -> local write -> same-owner sign in', () => {
  // These tables detect local change by diffing live state against a snapshot
  // rather than through the dirty queue, so which adapter performed the write is
  // irrelevant to them. That is a property worth pinning down: it is the reason
  // #525 is scoped to the collection tables, and a future change that moved them
  // onto write-time dirty tracking would silently reintroduce the same defect
  // here.
  it('uploads a weight goal set while signed out', async () => {
    await seedSyncedDevice();

    signOut();
    await saveWeightGoal({
      target_weight: 170,
      target_date: '2026-12-01',
      start_weight: 180,
      start_date: '2026-07-01',
      saved_at: '2026-07-05T08:00:00.000Z',
    });

    signInAsSameOwner();
    await sync();

    expect(cloud.remoteRow(SYNC_TABLES.WEIGHT_GOAL, SINGLETON_SYNC_ID)).toMatchObject({
      target_weight: 170,
    });
  });

  it('uploads tracked lifts changed while signed out', async () => {
    await seedSyncedDevice();

    signOut();
    await localAdapter().saveTrackedLifts({ squat: true });

    signInAsSameOwner();
    await sync();

    expect(
      cloud.remoteRow(SYNC_TABLES.USER_HEALTH_PROFILE, SINGLETON_SYNC_ID).tracked_lifts
    ).toEqual({ squat: true });
  });

  it('uploads a goal CLEARED while signed out as a tombstone', async () => {
    await seedSyncedDevice();
    await saveWeightGoal({
      target_weight: 170,
      start_weight: 180,
      saved_at: '2026-07-01T08:00:00.000Z',
    });
    await sync();
    expect(isTombstone(cloud.remoteRow(SYNC_TABLES.WEIGHT_GOAL, SINGLETON_SYNC_ID))).toBe(false);

    signOut();
    await localAdapter().clearWeightGoal();

    signInAsSameOwner();
    await sync();

    expect(isTombstone(cloud.remoteRow(SYNC_TABLES.WEIGHT_GOAL, SINGLETON_SYNC_ID))).toBe(true);
    expect(await loadWeightGoal()).toBeNull();
  });
});

describe('idempotency and non-interference', () => {
  it('repeated sign-in and sync pushes nothing further and duplicates no rows', async () => {
    await seedSyncedDevice();

    signOut();
    await localAdapter().saveWeightEntry({
      id: 'w-offline',
      weight_value: 178,
      logged_at: '2026-07-05T08:00:00.000Z',
      date: '2026-07-05',
    });

    signInAsSameOwner();
    await sync();

    const afterFirst = cloud.pushedIds(SYNC_TABLES.WEIGHT_ENTRIES).length;

    // Sign out and back in again without changing anything.
    signOut();
    signInAsSameOwner();
    await sync();
    await sync();

    expect(cloud.pushedIds(SYNC_TABLES.WEIGHT_ENTRIES).length).toBe(afterFirst);
    expect(await getDirtyRecords(SYNC_TABLES.WEIGHT_ENTRIES)).toHaveLength(0);
    expect(cloud.remoteRows(SYNC_TABLES.WEIGHT_ENTRIES).map((r) => r.id).sort()).toEqual([
      'w-existing',
      'w-offline',
    ]);
    const localIds = (await Storage.loadWeightEntriesRaw()).map((e) => e.id).sort();
    expect(localIds).toEqual(['w-existing', 'w-offline']);
  });

  it('an ordinary signed-in pass with no local change enqueues nothing', async () => {
    await seedSyncedDevice();
    await sync();
    expect(await getDirtyRecords(SYNC_TABLES.WEIGHT_ENTRIES)).toHaveLength(0);
    expect(await getDirtyRecords(SYNC_TABLES.WORKOUT_NOTES)).toHaveLength(0);
  });

  it('records a baseline for every collection table so the next pass can diff against it', async () => {
    await seedSyncedDevice();
    for (const table of [
      SYNC_TABLES.WEIGHT_ENTRIES,
      SYNC_TABLES.WORKOUT_NOTES,
      SYNC_TABLES.ARCHIVED_WEIGHT_GOALS,
    ]) {
      // eslint-disable-next-line no-await-in-loop
      expect(await getSyncSnapshot(table)).not.toBeNull();
    }
  });
});

describe('read-only pending sync intent', () => {
  it('finds a diff-tracked weight-goal change even when the dirty queue is empty', async () => {
    await seedSyncedDevice();
    expect(await getDirtyRecords(SYNC_TABLES.WEIGHT_GOAL)).toEqual([]);

    await saveWeightGoal({
      target_weight: 170,
      start_weight: 180,
      target_date: '2026-12-01',
      saved_at: '2026-07-05T08:00:00.000Z',
    });

    const pending = await getPendingSyncIntent();
    expect(pending.hasPending).toBe(true);
    expect(pending.dirtyCount).toBe(0);
    expect(pending.diffCount).toBeGreaterThan(0);
    expect(pending.tables).toContain(SYNC_TABLES.WEIGHT_GOAL);
    // Status inspection must not turn a diff into a real queue entry or run a pass.
    expect(await getDirtyRecords(SYNC_TABLES.WEIGHT_GOAL)).toEqual([]);
  });

  it('keeps a collection write made during a pass queued for the next server acknowledgement', async () => {
    const adapter = Storage.getStorageAdapter();
    await adapter.saveWeightEntry({
      id: 'w-first',
      weight_value: 180,
      logged_at: '2026-07-01T08:00:00.000Z',
      date: '2026-07-01',
    });

    const originalPush = cloud.transport.push;
    let releasePush;
    const pushGate = new Promise((resolve) => {
      releasePush = resolve;
    });
    let pushStarted;
    const pushStartedGate = new Promise((resolve) => {
      pushStarted = resolve;
    });
    cloud.transport.push = async (table, records) => {
      if (table === SYNC_TABLES.WEIGHT_ENTRIES && records.some((record) => record.id === 'w-first')) {
        pushStarted();
        await pushGate;
      }
      return originalPush(table, records);
    };

    const pass = sync();
    await pushStartedGate;
    await adapter.saveWeightEntry({
      id: 'w-during-pass',
      weight_value: 179,
      logged_at: '2026-07-02T08:00:00.000Z',
      date: '2026-07-02',
    });
    releasePush();
    await pass;

    const pending = await getPendingSyncIntent();
    expect(pending.hasPending).toBe(true);
    expect(await getDirtyRecords(SYNC_TABLES.WEIGHT_ENTRIES)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'w-during-pass' })])
    );
  });
});

describe('reconciliation cannot be skipped or inferred without evidence', () => {
  it('fails the SYNC phase instead of reporting success when reconciliation cannot complete', async () => {
    await seedSyncedDevice();

    signOut();
    await localAdapter().saveWeightEntry({
      id: 'w-offline',
      weight_value: 178,
      logged_at: '2026-07-05T08:00:00.000Z',
      date: '2026-07-05',
    });
    signInAsSameOwner();

    // Fail the read reconciliation depends on. Driven through the owning module
    // (weightEntries), never by spying on AsyncStorage: the shared AsyncStorage
    // mock's methods are already jest.fn()s, so mockRestore() would leave them
    // permanent no-ops and break every later suite.
    mockFailLoadWeightEntriesRaw = new Error('storage unavailable');
    try {
      const result = await runPhase(SYNC_PHASE.SYNC, () => sync());
      expect(result.ok).toBe(false);
    } finally {
      mockFailLoadWeightEntriesRaw = null;
    }

    // The user sees a retryable failure, never "Fully synced" over data that is
    // still only on the device.
    expect(getSyncState()[SYNC_PHASE.SYNC].status).toBe(SYNC_STATUS.FAILED);
    expect(getSyncState()[SYNC_PHASE.SYNC].retryable).toBe(true);
    expect(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w-offline')).toBeUndefined();
  });

  it('defers rather than guessing when the table has no baseline', async () => {
    // `updated_at` is NOT evidence that a row was ever synced — makeWorkoutNoteItem
    // stamps one on every note the user creates. Treating it as evidence is what
    // stranded signed-out notes, so the baseline diff now concludes nothing at
    // all without a baseline and hands the table to the remote-grounded pass.
    const stamped = { id: 'w-stamped', weight_value: 180, updated_at: '2026-07-01T08:00:00.000Z' };
    const unstamped = { id: 'w-unstamped', weight_value: 178 };

    const { dirty, deferred } = reconcileAgainstBaseline({
      current: [stamped, unstamped],
      baseline: null,
      clientId: 'this-device',
    });

    expect(deferred).toBe(true);
    expect(dirty).toEqual([]);
  });

  it('reconciles each collection table exactly once per pass', async () => {
    await seedSyncedDevice();
    const results = await reconcileSignedOutWrites();
    expect(results.map((r) => r.table)).toEqual([
      SYNC_TABLES.WEIGHT_ENTRIES,
      SYNC_TABLES.WORKOUT_NOTES,
      SYNC_TABLES.ARCHIVED_WEIGHT_GOALS,
    ]);
    expect(results.every((r) => r.reconciled === 0)).toBe(true);
  });
});

// ── the upgrade window: signed-out writes on a device with NO baseline ────────
//
// A device that last synced on a build before syncTable recorded collection
// baselines has data, a cursor, and no baseline. The first version of this fix
// assumed a row without `updated_at` was the only trustworthy sign of a
// local-adapter write; `makeWorkoutNoteItem` stamps `updated_at` on every note
// the user creates, so that assumption stranded exactly the rows it was meant to
// rescue — and then `syncTable` recorded them as the baseline, which made every
// later pass consider them reconciled. These tests pin the replacement:
// reconcile against the SERVER's row set, which needs no prior local state.
describe('upgrade window: no baseline recorded yet', () => {
  it('uploads a signed-out workout note that carries its own updated_at', async () => {
    await seedSyncedDevice();
    await simulatePreUpgradeDevice();

    signOut();
    // The exact object useWorkoutNotes.add persists through the local adapter.
    const note = makeWorkoutNoteItem({ title: 'Routine B', raw_text: 'Bench 80x5' });
    expect(note.updated_at).toBeTruthy();
    await localAdapter().saveWorkoutNoteItem(note);

    expect(await getDirtyRecords(SYNC_TABLES.WORKOUT_NOTES)).toHaveLength(0);
    expect(await getSyncSnapshot(SYNC_TABLES.WORKOUT_NOTES)).toBeNull();

    signInAsSameOwner();
    await sync();

    // It actually reached the cloud...
    expect(cloud.remoteRow(SYNC_TABLES.WORKOUT_NOTES, note.id)).toMatchObject({
      id: note.id,
      raw_text: 'Bench 80x5',
    });
    // ...and only then was it allowed into the baseline.
    const baseline = await getSyncSnapshot(SYNC_TABLES.WORKOUT_NOTES);
    expect(baseline.map((n) => n.id)).toContain(note.id);
  });

  it('never records a baseline containing a row the push did not deliver', async () => {
    // The precise laundering the reviewer traced: skip a row, push nothing,
    // record the local table as the baseline, and it looks reconciled forever.
    // A failing push must leave the table baseline-less so the next pass runs
    // the same remote-grounded reconciliation again.
    await seedSyncedDevice();
    await simulatePreUpgradeDevice();

    signOut();
    const note = makeWorkoutNoteItem({ title: 'Routine C', raw_text: 'Row 60x8' });
    await localAdapter().saveWorkoutNoteItem(note);
    signInAsSameOwner();

    const realPush = cloud.transport.push;
    cloud.transport.push = async (table, records) => {
      if (table === SYNC_TABLES.WORKOUT_NOTES) throw new Error('network down');
      return realPush(table, records);
    };
    await expect(sync()).rejects.toThrow('network down');
    cloud.transport.push = realPush;

    expect(await getSyncSnapshot(SYNC_TABLES.WORKOUT_NOTES)).toBeNull();
    expect(cloud.remoteRow(SYNC_TABLES.WORKOUT_NOTES, note.id)).toBeUndefined();

    // The retry succeeds and the row lands.
    await sync();
    expect(cloud.remoteRow(SYNC_TABLES.WORKOUT_NOTES, note.id)).toMatchObject({
      raw_text: 'Row 60x8',
    });
  });

  it('uploads a row EDITED while signed out', async () => {
    await seedSyncedDevice();
    await simulatePreUpgradeDevice();

    signOut();
    await localAdapter().updateWeightEntry('w-existing', 176, 'edited offline');

    signInAsSameOwner();
    await sync();

    expect(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w-existing')).toMatchObject({
      weight_value: 176,
      note: 'edited offline',
    });
  });

  it('does not re-push rows the server already holds unchanged', async () => {
    // The hazard on the other side: re-stamping every local row would let this
    // device claim authorship of the whole table and beat another device's
    // newer cloud copy. Nothing changed locally, so nothing may be pushed.
    await seedSyncedDevice();
    const before = cloud.pushedIds(SYNC_TABLES.WEIGHT_ENTRIES).length;
    await simulatePreUpgradeDevice();

    signOut();
    signInAsSameOwner();
    await sync();

    expect(cloud.pushedIds(SYNC_TABLES.WEIGHT_ENTRIES).length).toBe(before);
    expect(await getDirtyRecords(SYNC_TABLES.WEIGHT_ENTRIES)).toHaveLength(0);
  });

  it('ignores the stale cursor so an unchanged row is still recognised as synced', async () => {
    // The reason the unbaselined pull must be FULL. With a delta pull, a row
    // synced long before the stored cursor is simply absent from the response
    // and is therefore indistinguishable from a row the server has never seen —
    // so the pass would re-push the entire table.
    await seedSyncedDevice();
    const cursor = await getCursor(SYNC_TABLES.WEIGHT_ENTRIES);
    expect(cursor).toBeTruthy();

    const pulls = [];
    const realPull = cloud.transport.pull;
    cloud.transport.pull = async (table, c) => {
      pulls.push({ table, cursor: c });
      return realPull(table, c);
    };
    await simulatePreUpgradeDevice();
    await sync();
    cloud.transport.pull = realPull;

    const weightPull = pulls.find((p) => p.table === SYNC_TABLES.WEIGHT_ENTRIES);
    expect(weightPull.cursor).toBeNull();
    expect(await getDirtyRecords(SYNC_TABLES.WEIGHT_ENTRIES)).toHaveLength(0);
  });

  it('lets a newer remote row win instead of clobbering it with local state', async () => {
    await seedSyncedDevice();
    await simulatePreUpgradeDevice();

    signOut();
    // Another device edits the row AFTER this device's copy was written, while
    // this device is signed out and cannot know about it.
    await cloud.transport.push(SYNC_TABLES.WEIGHT_ENTRIES, [
      {
        id: 'w-existing',
        weight_value: 171,
        logged_at: '2026-07-01T08:00:00.000Z',
        date: '2026-07-01',
        note: 'other device',
      },
    ]);
    const pushesBefore = cloud.pushedIds(SYNC_TABLES.WEIGHT_ENTRIES).length;

    signInAsSameOwner();
    await sync();

    expect(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w-existing')).toMatchObject({
      weight_value: 171,
      note: 'other device',
    });
    expect(cloud.pushedIds(SYNC_TABLES.WEIGHT_ENTRIES).length).toBe(pushesBefore);
    const local = (await Storage.loadWeightEntriesRaw()).find((e) => e.id === 'w-existing');
    expect(local.weight_value).toBe(171);
  });

  it('reconcileAgainstRemote enqueues exactly the rows the merge would keep', async () => {
    // The invariant, unit-level: enqueue every local row the merge will KEEP and
    // that the server does not already hold in that form. Anything less strands
    // data; anything more clobbers another device.
    const serverRow = { id: 'a', v: 1, updated_at: '2026-07-02T00:00:00.000Z' };
    const unchanged = { id: 'a', v: 1, updated_at: '2026-07-02T00:00:00.000Z' };
    const localOnlyStamped = { id: 'b', v: 2, updated_at: '2026-07-03T00:00:00.000Z' };
    const localNewerEdit = { id: 'c', v: 9, updated_at: '2026-07-09T00:00:00.000Z' };
    const localStaleEdit = { id: 'd', v: 8, updated_at: '2026-07-01T00:00:00.000Z' };

    const { dirty } = reconcileAgainstRemote({
      current: [unchanged, localOnlyStamped, localNewerEdit, localStaleEdit],
      remote: [
        serverRow,
        { id: 'c', v: 3, updated_at: '2026-07-04T00:00:00.000Z' },
        { id: 'd', v: 4, updated_at: '2026-07-05T00:00:00.000Z' },
        // Present remotely, absent locally: never inferred as a delete.
        { id: 'e', v: 5, updated_at: '2026-07-06T00:00:00.000Z' },
      ],
      clientId: 'this-device',
    });

    expect(dirty.map((r) => r.id).sort()).toEqual(['b', 'c']);
  });
});

// ── signed-out deletes on the upgrade path, bounded by the pull cursor ────────
//
// The mechanism is the reviewer's, from the #525 STATUS=REVIEW_RESPONSE: a
// pre-upgrade device has no baseline but DOES have a persisted per-table cursor,
// and that cursor is server-authored evidence of what a completed, inclusive,
// paginated pull already delivered. A remote row absent locally whose
// `updated_at` sits at or before a TRUSTWORTHY cursor was therefore observed by
// this device, so its absence is a signed-out delete.
//
// The cursor is validated rather than trusted, because issue #523 proved this
// repo shipped cursors computed from `[...remote, ...dirty]` — device-clock
// values that could sit in the future and silently hide later server rows. On
// such a device `updated_at <= cursor` does NOT mean "was delivered".
describe('upgrade window: signed-out DELETES against the stored cursor', () => {
  // Case 1 ────────────────────────────────────────────────────────────────────
  it('propagates a signed-out delete when the cursor is trustworthy', async () => {
    await seedSyncedDevice();
    const cursor = await getCursor(SYNC_TABLES.WEIGHT_ENTRIES);
    // Trustworthy: the cursor is literally the `updated_at` of a row the server
    // still holds, so it is a real completed-pull boundary and not a device clock.
    expect(cloud.remoteRows(SYNC_TABLES.WEIGHT_ENTRIES).some((r) => r.updated_at === cursor))
      .toBe(true);
    await simulatePreUpgradeDevice();

    signOut();
    // The local adapter removes the row outright: no tombstone, no dirty entry.
    await localAdapter().deleteWeightEntry('w-existing');
    expect(await Storage.loadWeightEntriesRaw()).toHaveLength(0);
    expect(await getDirtyRecords(SYNC_TABLES.WEIGHT_ENTRIES)).toHaveLength(0);

    signInAsSameOwner();
    await sync();

    // The delete reached the cloud as a tombstone...
    expect(isTombstone(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w-existing'))).toBe(true);
    // ...and a second pass does not resurrect the row locally.
    await sync();
    const visible = await Storage.getStorageAdapter().loadWeightEntries();
    expect(visible.map((e) => e.id)).not.toContain('w-existing');
  });

  // Case 2 ────────────────────────────────────────────────────────────────────
  it('preserves a remote row written AFTER the cursor instead of tombstoning it', async () => {
    // Another device wrote this row after our last completed pull window, so we
    // never observed it. Its absence locally is not evidence of anything, and
    // under "last write to REACH THE SERVER wins" the remote write is the later
    // one regardless. Preserve it, and do not call it a conflict.
    await seedSyncedDevice();
    await simulatePreUpgradeDevice();

    signOut();
    await cloud.transport.push(SYNC_TABLES.WEIGHT_ENTRIES, [
      {
        id: 'w-other-device',
        weight_value: 165,
        logged_at: '2026-07-09T08:00:00.000Z',
        date: '2026-07-09',
      },
    ]);
    const cursor = await getCursor(SYNC_TABLES.WEIGHT_ENTRIES);
    expect(
      cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w-other-device').updated_at > cursor
    ).toBe(true);

    signInAsSameOwner();
    await sync();

    // No tombstone invented, and the row arrived on this device.
    expect(isTombstone(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w-other-device'))).toBe(false);
    const localIds = (await Storage.loadWeightEntriesRaw()).map((e) => e.id).sort();
    expect(localIds).toEqual(['w-existing', 'w-other-device']);
    // Not a conflict: the pass completed and recorded its baseline.
    expect(await getSyncSnapshot(SYNC_TABLES.WEIGHT_ENTRIES)).not.toBeNull();
  });

  // Case 3, poisoned cursor ───────────────────────────────────────────────────
  it('does NOT tombstone against a #523-poisoned cursor, and refuses to claim success', async () => {
    // The unrecoverable failure this guards. Pre-#523 builds advanced the cursor
    // from `[...remote, ...dirty]`; a device whose clock ran ahead stored a
    // FUTURE cursor and then filtered every later server row out of its own
    // pulls. Those rows are remote, absent locally, and `updated_at <= cursor` —
    // exactly the shape of a signed-out delete. Inferring one would destroy cloud
    // data this device never downloaded.
    await seedSyncedDevice();
    await simulatePreUpgradeDevice();

    signOut();
    await localAdapter().deleteWeightEntry('w-existing');
    // The device clock was an hour ahead of the server when the old build wrote
    // this cursor, so it sits past everything the server holds.
    const poisoned = new Date(Date.now() + 3600_000).toISOString();
    await setCursor(SYNC_TABLES.WEIGHT_ENTRIES, poisoned);
    expect(
      poisoned > cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w-existing').updated_at
    ).toBe(true);

    signInAsSameOwner();
    await expect(sync()).rejects.toThrow(/not trustworthy/);

    // Nothing was deleted in the cloud.
    expect(isTombstone(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w-existing'))).toBe(false);
    // No successful reconciliation was claimed: no baseline was recorded.
    expect(await getSyncSnapshot(SYNC_TABLES.WEIGHT_ENTRIES)).toBeNull();
  });

  it('surfaces the poisoned-cursor conflict as a FAILED sync phase, not a completed one', async () => {
    await seedSyncedDevice();
    await simulatePreUpgradeDevice();
    signOut();
    await localAdapter().deleteWeightEntry('w-existing');
    await setCursor(SYNC_TABLES.WEIGHT_ENTRIES, new Date(Date.now() + 3600_000).toISOString());
    signInAsSameOwner();

    const result = await runPhase(SYNC_PHASE.SYNC, () => sync());

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not trustworthy/);
    expect(getSyncState()[SYNC_PHASE.SYNC].status).toBe(SYNC_STATUS.FAILED);
  });

  it('converges on the retry: the conflict is reported once, not forever', async () => {
    // The conflict throws AFTER the merge restored the rows, after the real dirty
    // queue was pushed, and after step 5 replaced the poisoned cursor with a
    // server-authored one. So the retry has nothing ambiguous left and completes.
    await seedSyncedDevice();
    await simulatePreUpgradeDevice();
    signOut();
    await localAdapter().deleteWeightEntry('w-existing');
    await setCursor(SYNC_TABLES.WEIGHT_ENTRIES, new Date(Date.now() + 3600_000).toISOString());
    signInAsSameOwner();

    await expect(sync()).rejects.toThrow(/not trustworthy/);
    // The row was restored locally rather than left in limbo.
    expect((await Storage.loadWeightEntriesRaw()).map((e) => e.id)).toContain('w-existing');

    await expect(sync()).resolves.toBeDefined();
    expect(await getSyncSnapshot(SYNC_TABLES.WEIGHT_ENTRIES)).not.toBeNull();
    // Still no fabricated tombstone.
    expect(isTombstone(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w-existing'))).toBe(false);
  });

  // Case 3, missing cursor ────────────────────────────────────────────────────
  it('never blocks a first download, where every remote row is legitimately absent locally', async () => {
    // A device with no cursor has no completed pull to contradict. This is the
    // ordinary first-download state — empty local table, full remote one — so
    // "absent locally" carries no information and must neither be tombstoned nor
    // treated as a conflict. Blocking here would break every fresh install.
    await seedSyncedDevice();
    await simulatePreUpgradeDevice();
    for (const table of COLLECTION_TABLES) {
      // eslint-disable-next-line no-await-in-loop
      await clearCursor(table);
    }
    await Storage.replaceWeightEntriesRaw([]);
    await Storage.replaceWorkoutNotesRaw([]);

    await sync();

    // Nothing was destroyed and the account's data arrived.
    expect(isTombstone(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w-existing'))).toBe(false);
    expect((await Storage.loadWeightEntriesRaw()).map((e) => e.id)).toContain('w-existing');
    expect(await getSyncSnapshot(SYNC_TABLES.WEIGHT_ENTRIES)).not.toBeNull();
  });

  // Case 3, missing cursor on an OWNED device ─────────────────────────────────
  it('surfaces an honest conflict for an owned device whose cleared cursor cannot classify a signed-out delete', async () => {
    // The distinct reachable state round 4 closes. #523 healing / #538 rearm can
    // clear the cursor of a device that HAS real prior sync history. If that owned
    // device then signs out, physically deletes a previously-synced row, and
    // upgrades, its missing cursor cannot prove the row was ever observed — so the
    // delete can be neither classified as a tombstone (that would risk destroying
    // cloud data a poisoned window hid) nor silently restored as success (the exact
    // contract failure #525 exists to close). It must surface an honest conflict.
    //
    // ownedDevice: true is what the app layer passes on the ordinary same-owner
    // sign-in and manual "Sync Now" paths (syncRecoveryHooks.js). It is the ONLY
    // difference from the clean first download in the next test, which shares this
    // exact local shape.
    await seedSyncedDevice();
    await simulatePreUpgradeDevice();
    await clearCursor(SYNC_TABLES.WEIGHT_ENTRIES);

    signOut();
    await localAdapter().deleteWeightEntry('w-existing');
    signInAsSameOwner();

    await expect(sync({ ownedDevice: true })).rejects.toThrow(/not trustworthy/);

    // No fabricated tombstone, no baseline recorded, nothing claimed synced.
    expect(isTombstone(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w-existing'))).toBe(false);
    expect(await getSyncSnapshot(SYNC_TABLES.WEIGHT_ENTRIES)).toBeNull();
    // The conflict restored the row locally rather than leaving it in limbo.
    expect((await Storage.loadWeightEntriesRaw()).map((e) => e.id)).toContain('w-existing');

    // Reported once, not forever: the merge restored the row and step 5 anchored a
    // server-authored cursor, so the retry has nothing ambiguous left and
    // completes, recording a baseline. The delete surfaced honestly and was never
    // silently swallowed; a genuine re-delete now propagates cleanly.
    await expect(sync({ ownedDevice: true })).resolves.toBeDefined();
    expect(await getSyncSnapshot(SYNC_TABLES.WEIGHT_ENTRIES)).not.toBeNull();
    signOut();
    await localAdapter().deleteWeightEntry('w-existing');
    signInAsSameOwner();
    await sync({ ownedDevice: true });
    expect(isTombstone(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w-existing'))).toBe(true);
  });

  it('still downloads normally for a clean first-download with the same missing-cursor, empty-local shape', async () => {
    // The negative image of the test above, sharing its exact local shape — empty
    // local table, no cursor, full remote — but this is a genuine clean first
    // download (the clean-device download / #538 rebuild flow, ownedDevice: false).
    // A first download MUST never be blocked, so the account's rows arrive and no
    // conflict is raised. The ONLY thing that differs from the owned-device
    // conflict is the transition context the app layer supplies.
    await seedSyncedDevice();
    await simulatePreUpgradeDevice();
    await clearCursor(SYNC_TABLES.WEIGHT_ENTRIES);
    await Storage.replaceWeightEntriesRaw([]);

    await sync({ ownedDevice: false });

    expect(isTombstone(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w-existing'))).toBe(false);
    expect((await Storage.loadWeightEntriesRaw()).map((e) => e.id)).toContain('w-existing');
    expect(await getSyncSnapshot(SYNC_TABLES.WEIGHT_ENTRIES)).not.toBeNull();
  });

  it('the #538 post-purge rebuild still converges without a conflict on an unbaselined device', async () => {
    // The rebuild path must keep working (round 4 constraint). rebuildCloudCopy
    // rearms every gated collection (re-enqueue all local rows, CLEAR the cursor)
    // and syncs, so on a pre-#525 device the rebuild pass is unbaselined with a
    // cleared cursor — structurally identical to the owned-device conflict above.
    // But it goes through sync() with ownedDevice at its false default (a
    // first-download-shaped rebuild), so it converges rather than blocking: the
    // local set re-uploads and a row this device never pulled downloads.
    await seedSyncedDevice();
    await simulatePreUpgradeDevice();
    // A row another device wrote that this one never pulled: absent locally.
    await cloud.transport.push(SYNC_TABLES.WEIGHT_ENTRIES, [
      {
        id: 'w-other-device',
        weight_value: 150,
        logged_at: '2026-07-09T08:00:00.000Z',
        date: '2026-07-09',
      },
    ]);

    const result = await rebuildCloudCopy();
    expect(result.ok).toBe(true);

    // No conflict: the local row re-uploaded, the never-seen remote row arrived,
    // and the baseline was recorded.
    expect(isTombstone(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w-existing'))).toBe(false);
    expect((await Storage.loadWeightEntriesRaw()).map((e) => e.id).sort()).toEqual([
      'w-existing',
      'w-other-device',
    ]);
    expect(await getSyncSnapshot(SYNC_TABLES.WEIGHT_ENTRIES)).not.toBeNull();
  });
});

// ── cursor trust, unit level ─────────────────────────────────────────────────
describe('assessCursorTrust', () => {
  const rows = [
    { id: 'a', updated_at: '2026-07-01T00:00:00.000Z' },
    { id: 'b', updated_at: '2026-07-05T00:00:00.000Z' },
  ];

  it('trusts a cursor that a server row still corroborates exactly', () => {
    expect(assessCursorTrust({ cursor: '2026-07-05T00:00:00.000Z', remote: rows })).toEqual({
      trusted: true,
      reason: 'corroborated',
    });
  });

  it('rejects a cursor ahead of every row the server holds (#523 future clock)', () => {
    // Cursor advancement only ever takes the max updated_at of SERVER-AUTHORED
    // rows, so an honest cursor can never sit past the newest row on the server.
    expect(assessCursorTrust({ cursor: '2099-01-01T00:00:00.000Z', remote: rows })).toEqual({
      trusted: false,
      reason: 'ahead-of-server',
    });
  });

  it('rejects a cursor no server row corroborates, even when it is not ahead', () => {
    // The subtler #523 shape: a device clock skewed forward by LESS than the
    // newest server row. `ahead-of-server` misses it; exact corroboration does
    // not, because a real cursor is always literally some server row's timestamp.
    expect(assessCursorTrust({ cursor: '2026-07-03T12:34:56.789Z', remote: rows })).toEqual({
      trusted: false,
      reason: 'uncorroborated',
    });
  });

  it('reports a missing cursor separately, because it is not a conflict', () => {
    expect(assessCursorTrust({ cursor: null, remote: rows }).reason).toBe('absent');
  });

  it('rejects a malformed cursor', () => {
    expect(assessCursorTrust({ cursor: 'not-a-timestamp', remote: rows })).toEqual({
      trusted: false,
      reason: 'malformed',
    });
  });

  it('rejects any cursor when the server holds nothing to corroborate it', () => {
    expect(assessCursorTrust({ cursor: '2026-07-05T00:00:00.000Z', remote: [] }).trusted)
      .toBe(false);
  });
});

describe('reconcileAgainstRemote: absent-local remote rows', () => {
  const clientId = 'this-device';
  const cursor = '2026-07-05T00:00:00.000Z';
  // Corroborates the cursor, so the classification below is allowed to run.
  const anchor = { id: 'anchor', updated_at: cursor };

  it('tombstones only the rows at or before a trustworthy cursor', () => {
    const { dirty, unresolved } = reconcileAgainstRemote({
      current: [anchor],
      remote: [
        anchor,
        { id: 'observed', v: 1, updated_at: '2026-07-02T00:00:00.000Z' },
        { id: 'unseen', v: 2, updated_at: '2026-07-09T00:00:00.000Z' },
      ],
      clientId,
      cursor,
    });

    expect(dirty.map((r) => r.id)).toEqual(['observed']);
    expect(isTombstone(dirty[0])).toBe(true);
    expect(unresolved).toEqual([]);
  });

  it('never tombstones an already-tombstoned remote row', () => {
    const { dirty, unresolved } = reconcileAgainstRemote({
      current: [anchor],
      remote: [
        anchor,
        { id: 'gone', updated_at: '2026-07-02T00:00:00.000Z', deleted_at: '2026-07-02T00:00:00.000Z' },
      ],
      clientId,
      cursor,
    });

    expect(dirty).toEqual([]);
    expect(unresolved).toEqual([]);
  });

  it('reports rows as unresolved rather than tombstoning them on an untrusted cursor', () => {
    const { dirty, unresolved, cursorTrust } = reconcileAgainstRemote({
      current: [],
      remote: [{ id: 'observed', updated_at: '2026-07-02T00:00:00.000Z' }],
      clientId,
      cursor: '2099-01-01T00:00:00.000Z',
    });

    expect(dirty).toEqual([]);
    expect(unresolved).toEqual(['observed']);
    expect(cursorTrust.reason).toBe('ahead-of-server');
  });

  it('neither tombstones nor reports a conflict with no cursor on a clean device', () => {
    // ownedDevice defaults false: the clean-device first-download / #538 rebuild
    // case, where a missing cursor is the ordinary state and absent-local rows are
    // simply the account's data being downloaded.
    const { dirty, unresolved } = reconcileAgainstRemote({
      current: [],
      remote: [{ id: 'never-downloaded', updated_at: '2026-07-02T00:00:00.000Z' }],
      clientId,
      cursor: null,
    });

    expect(dirty).toEqual([]);
    expect(unresolved).toEqual([]);
  });

  it('reports a conflict with no cursor on an OWNED device, without fabricating a tombstone', () => {
    // Same inputs, ownedDevice true: an owned device with real prior sync history
    // whose cursor was cleared cannot classify the absent-local row, so it is
    // reported as unresolved (an honest conflict upstream) — but never tombstoned.
    const { dirty, unresolved, cursorTrust } = reconcileAgainstRemote({
      current: [],
      remote: [{ id: 'never-classified', updated_at: '2026-07-02T00:00:00.000Z' }],
      clientId,
      cursor: null,
      ownedDevice: true,
    });

    expect(dirty).toEqual([]);
    expect(unresolved).toEqual(['never-classified']);
    expect(cursorTrust.reason).toBe('absent');
  });
});

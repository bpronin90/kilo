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
import { sync, reconcileSignedOutWrites } from '../storage/cloud/syncAdapter';
import { loadWeightGoal, saveWeightGoal } from '../storage/entries/weightGoal';
import {
  SYNC_TABLES,
  SINGLETON_SYNC_ID,
  getDirtyRecords,
  getSyncSnapshot,
  isTombstone,
  reconcileAgainstBaseline,
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

  it('with no baseline, adopts unstamped local rows but never re-stamps synced ones', async () => {
    // A device whose last sync predates the baseline being recorded. It cannot
    // tell an edit from an untouched row, so re-stamping everything would let it
    // claim authorship of the whole table and beat another device's newer cloud
    // copy. Only a row with NO sync metadata is unambiguously a local-adapter
    // write.
    const synced = {
      id: 'w-synced',
      weight_value: 180,
      updated_at: '2026-07-01T08:00:00.000Z',
      client_id: 'other-device',
    };
    const localOnly = { id: 'w-local', weight_value: 178 };

    const { dirty } = reconcileAgainstBaseline({
      current: [synced, localOnly],
      baseline: null,
      clientId: 'this-device',
    });

    expect(dirty.map((r) => r.id)).toEqual(['w-local']);
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

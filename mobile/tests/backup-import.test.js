// Cloud-mode backup import (issue #526).
//
// The defect #522 confirmed as claim 5: `App.handleImport` called
// `importBackup(payload, 'replace')` no matter what storage mode was active. The
// importer wrote domain keys straight into AsyncStorage, enqueued nothing,
// created no tombstones for the records the backup omitted, and returned
// `{ ok: true }`. A signed-in user's restore therefore left the DEVICE holding
// the imported data and the ACCOUNT holding the old data, while the UI said the
// restore succeeded — and the next pull happily resurrected everything the
// import had "replaced".
//
// These tests drive the real storage layer and the real sync engine against an
// in-memory transport, so what they assert is what actually reaches the cloud.
//
// The local contract is asserted here too, because "cloud mode now stamps and
// queues" is only half the fix: a device with no account must keep the old
// behavior exactly, and nothing may fabricate sync intent for it.

import AsyncStorage from '@react-native-async-storage/async-storage';

import * as Storage from '../storage/entries';
import { setCloudTransport } from '../storage/cloudAdapter';
import { sync } from '../storage/cloud/syncAdapter';
import { importBackup, IMPORT_MODES } from '../storage/entries/backupImport';
import {
  loadWeightGoal,
  saveWeightGoal,
  saveArchivedWeightGoal,
} from '../storage/entries/weightGoal';
import {
  SYNC_TABLES,
  getDirtyRecords,
  getSyncSnapshot,
  isTombstone,
  resetClientIdCacheForTests,
  resetStampClockForTests,
} from '../storage/syncQueue';
import { __resetSyncQueue } from '../storage/syncRecovery';

// ── in-memory fake cloud ─────────────────────────────────────────────────────
//
// Same shape as sync-recovery.test.js's: Postgres accepts every upsert and
// stamps `updated_at` itself, and `client_id` is not a stored column so nothing
// pulled ever carries one.
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

  // Set to an Error to make the very next push of that table fail, modelling a
  // connection dropping mid-restore.
  let failNextPush = null;

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
      if (failNextPush && failNextPush.table === table) {
        failNextPush = null;
        throw new Error('network lost');
      }
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
    failPushOnce: (table) => {
      failNextPush = { table };
    },
    pushes,
    pushedIds: (table) => pushes.filter((p) => p.table === table).flatMap((p) => p.ids),
    remoteRow: (table, id) => tables[table].get(id),
    remoteRows: (table) => [...tables[table].values()],
    liveRemoteRows: (table) => [...tables[table].values()].filter((r) => !isTombstone(r)),
    seedRemote: (table, row) => tables[table].set(row.id, row),
  };
}

let cloud;

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

// A signed-in device holding two weight entries and two notes, fully synced, so
// the cloud and the device genuinely agree before the import runs.
async function seedSyncedDevice() {
  const adapter = Storage.getStorageAdapter();
  await adapter.saveWeightEntry({
    id: 'w-keep',
    entry_type: 'weight',
    weight_value: 180,
    logged_at: '2026-07-01T08:00:00.000Z',
    date: '2026-07-01',
  });
  await adapter.saveWeightEntry({
    id: 'w-dropped',
    entry_type: 'weight',
    weight_value: 181,
    logged_at: '2026-07-02T08:00:00.000Z',
    date: '2026-07-02',
  });
  await adapter.saveWorkoutNoteItem({
    id: 'wn-keep',
    title: 'Routine A',
    raw_text: 'Squat 100x5',
    saved_at: '2026-07-01T08:00:00.000Z',
  });
  await adapter.saveWorkoutNoteItem({
    id: 'wn-dropped',
    title: 'Routine B',
    raw_text: 'Bench 80x5',
    saved_at: '2026-07-02T08:00:00.000Z',
  });
  await sync();
}

function weightRow(id, weight_value, date) {
  return {
    id,
    entry_type: 'weight',
    weight_value,
    date,
    logged_at: `${date}T08:00:00.000Z`,
  };
}

// A backup that keeps one entry, EDITS it, drops the other, keeps one note and
// drops the other, and introduces a row the account has never seen.
function replacementBackup() {
  return {
    version: '3',
    exported_at: '2026-07-10T00:00:00.000Z',
    weight_entries: [weightRow('w-keep', 175, '2026-07-01'), weightRow('w-new', 174, '2026-07-09')],
    workout_notes: [
      { id: 'wn-keep', title: 'Routine A', raw_text: 'Squat 110x5', saved_at: '2026-07-09T08:00:00.000Z' },
    ],
    current_workout_id: 'wn-keep',
    weight_goal: null,
    fatigue_multiplier: 1.07,
    deload_history: [],
  };
}

const cloudImport = (payload) => importBackup(payload, 'replace', { mode: IMPORT_MODES.CLOUD });

describe('cloud-mode replace: durable local and sync intent before success', () => {
  it('reports the cloud contract and queues every write and every omission', async () => {
    await seedSyncedDevice();

    const result = await cloudImport(replacementBackup());

    expect(result.ok).toBe(true);
    expect(result.mode).toBe(IMPORT_MODES.CLOUD);
    // 2 imported entries + 1 tombstone, 1 imported note + 1 tombstone.
    expect(result.queued).toBe(5);

    const weightDirty = await getDirtyRecords(SYNC_TABLES.WEIGHT_ENTRIES);
    expect(weightDirty.map((r) => r.id).sort()).toEqual(['w-dropped', 'w-keep', 'w-new']);
    const noteDirty = await getDirtyRecords(SYNC_TABLES.WORKOUT_NOTES);
    expect(noteDirty.map((r) => r.id).sort()).toEqual(['wn-dropped', 'wn-keep']);
  });

  it('stamps every imported row rather than trusting the exporting device metadata', async () => {
    await seedSyncedDevice();
    await cloudImport(replacementBackup());

    const raw = await Storage.loadWeightEntriesRaw();
    for (const row of raw) {
      expect(typeof row.updated_at).toBe('string');
      expect(typeof row.client_id).toBe('string');
    }
  });

  it('leaves the imported state and the deletion intent on disk before any upload', async () => {
    await seedSyncedDevice();
    await cloudImport(replacementBackup());

    const raw = await Storage.loadWeightEntriesRaw();
    // The dropped row is RETAINED as a tombstone, not removed: a removed row
    // leaves no trace of the delete for the push to carry.
    const dropped = raw.find((r) => r.id === 'w-dropped');
    expect(dropped).toBeDefined();
    expect(isTombstone(dropped)).toBe(true);
    // Readers still see only the imported live set.
    const visible = await Storage.getStorageAdapter().loadWeightEntries();
    expect(visible.map((r) => r.id).sort()).toEqual(['w-keep', 'w-new']);
  });
});

// The P2 finding on the first review (thread at backupImport.js:520): the old
// `{ ...(base || {}), ...content }` merge preserved any field the backup OMITTED
// by carrying it over from the device's current row, then stamped and queued the
// stale value as part of the restore. "Replace" means the backup is
// authoritative, so an omitted optional field must be CLEARED, not re-uploaded.
// These pin that: the stored row and the queued upload payload must both reflect
// the cleared field, never the stale local value.
describe('cloud-mode replace: an omitted optional field is cleared, not re-uploaded', () => {
  it('clears a weight-entry note the backup omits instead of carrying the stale local value', async () => {
    const adapter = Storage.getStorageAdapter();
    // A synced row that currently carries an optional `note` on THIS device.
    await adapter.saveWeightEntry({
      id: 'w-note',
      entry_type: 'weight',
      weight_value: 180,
      note: 'stale local note',
      date: '2026-07-01',
      logged_at: '2026-07-01T08:00:00.000Z',
    });
    await sync();
    expect(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w-note')).toMatchObject({
      note: 'stale local note',
    });

    // The same row in the backup, with `note` OMITTED entirely (not just nulled).
    const backup = {
      version: '3',
      exported_at: '2026-07-10T00:00:00.000Z',
      weight_entries: [
        {
          id: 'w-note',
          entry_type: 'weight',
          weight_value: 181,
          date: '2026-07-01',
          logged_at: '2026-07-01T08:00:00.000Z',
        },
      ],
      workout_notes: [],
      current_workout_id: null,
      weight_goal: null,
      deload_history: [],
    };

    await cloudImport(backup);

    // Stored row reflects the CLEARED field and the imported value, not the
    // stale local note.
    const stored = (await Storage.loadWeightEntriesRaw()).find((r) => r.id === 'w-note');
    expect(stored.weight_value).toBe(181);
    expect(stored.note).toBeUndefined();

    // The queued upload payload — what actually reaches the account — does not
    // carry the stale note either.
    const weightDirty = await getDirtyRecords(SYNC_TABLES.WEIGHT_ENTRIES);
    const dirty = weightDirty.find((r) => r.id === 'w-note');
    expect(dirty).toBeDefined();
    expect(dirty.note).toBeUndefined();
  });

  it('clears a workout-note derived field (session_checkins) the backup omits', async () => {
    const adapter = Storage.getStorageAdapter();
    // A synced note that currently carries a derived session_checkins cache.
    await adapter.saveWorkoutNoteItem({
      id: 'wn-derived',
      title: 'Routine A',
      raw_text: 'Squat 100x5',
      saved_at: '2026-07-01T08:00:00.000Z',
      session_checkins: [{ idx: 0, responded_at: '2026-07-01T09:00:00.000Z' }],
    });
    await sync();

    // The backup carries the same note but OMITS the derived session_checkins.
    const backup = {
      version: '3',
      exported_at: '2026-07-10T00:00:00.000Z',
      weight_entries: [],
      workout_notes: [
        {
          id: 'wn-derived',
          title: 'Routine A',
          raw_text: 'Squat 110x5',
          saved_at: '2026-07-09T08:00:00.000Z',
        },
      ],
      current_workout_id: 'wn-derived',
      weight_goal: null,
      deload_history: [],
    };

    await cloudImport(backup);

    const stored = (await Storage.loadWorkoutNotesRaw()).find((n) => n.id === 'wn-derived');
    expect(stored.raw_text).toBe('Squat 110x5');
    expect(stored.session_checkins).toBeUndefined();

    const noteDirty = await getDirtyRecords(SYNC_TABLES.WORKOUT_NOTES);
    const dirty = noteDirty.find((n) => n.id === 'wn-derived');
    expect(dirty).toBeDefined();
    expect(dirty.session_checkins).toBeUndefined();
  });
});

describe('cloud-mode replace: what reaches the account', () => {
  it('uploads imported creates and updates', async () => {
    await seedSyncedDevice();
    await cloudImport(replacementBackup());
    await sync();

    expect(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w-new')).toMatchObject({
      id: 'w-new',
      weight_value: 174,
    });
    // The imported EDIT of an already-synced row wins, rather than the cloud copy.
    expect(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w-keep')).toMatchObject({
      weight_value: 175,
    });
    expect(cloud.remoteRow(SYNC_TABLES.WORKOUT_NOTES, 'wn-keep')).toMatchObject({
      raw_text: 'Squat 110x5',
    });
  });

  it('tombstones records the backup omitted, and a later pull does not resurrect them', async () => {
    await seedSyncedDevice();
    await cloudImport(replacementBackup());
    await sync();

    const droppedEntry = cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w-dropped');
    expect(droppedEntry).toBeDefined();
    expect(isTombstone(droppedEntry)).toBe(true);
    const droppedNote = cloud.remoteRow(SYNC_TABLES.WORKOUT_NOTES, 'wn-dropped');
    expect(isTombstone(droppedNote)).toBe(true);

    expect(cloud.liveRemoteRows(SYNC_TABLES.WEIGHT_ENTRIES).map((r) => r.id).sort()).toEqual([
      'w-keep',
      'w-new',
    ]);

    // Second pass: the omitted rows must not come back into the user's list.
    await sync();
    const visible = await Storage.getStorageAdapter().loadWeightEntries();
    expect(visible.map((r) => r.id).sort()).toEqual(['w-keep', 'w-new']);
    const notes = await Storage.getStorageAdapter().loadWorkoutNotes();
    expect(notes.map((n) => n.id)).toEqual(['wn-keep']);
  });

  it('tombstones a REMOTE-ONLY row the device pulled but the backup omits', async () => {
    await seedSyncedDevice();
    // A row that only ever existed on another device, pulled down before import.
    // Written through the transport so the fake server stamps it, exactly as a
    // real second device's push would.
    await cloud.transport.push(SYNC_TABLES.WEIGHT_ENTRIES, [
      weightRow('w-other-device', 999, '2026-07-03'),
    ]);
    await sync();
    expect((await Storage.loadWeightEntriesRaw()).map((r) => r.id)).toContain('w-other-device');

    await cloudImport(replacementBackup());
    await sync();

    const remote = cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w-other-device');
    expect(isTombstone(remote)).toBe(true);
    const visible = await Storage.getStorageAdapter().loadWeightEntries();
    expect(visible.map((r) => r.id).sort()).toEqual(['w-keep', 'w-new']);
  });

  // The case #525's reconciliation cannot reach on its own, and the sharpest
  // reason import needs its own contract rather than leaning on the next pass.
  //
  // reconcileLocalWrites diffs local state against the last-synced baseline. With
  // NO baseline it is deliberately conservative: it adopts only rows carrying no
  // `updated_at`, because re-stamping already-stamped rows would let one device
  // claim authorship of a whole table. A cloud export is taken from RAW storage,
  // so every row in it carries the exporting device's `updated_at` — which means
  // a restore onto a device that has not yet completed a sync for the table is
  // invisible to the reconciliation and would never reach the account at all.
  it('uploads an import performed BEFORE the device has any sync baseline', async () => {
    expect(await getSyncSnapshot(SYNC_TABLES.WEIGHT_ENTRIES)).toBeNull();

    // A backup carrying the exporting device's sync metadata, as a real cloud
    // export does.
    const exported = replacementBackup();
    exported.weight_entries = exported.weight_entries.map((row) => ({
      ...row,
      updated_at: '2026-07-09T10:00:00.000Z',
      client_id: 'c_other_device',
      deleted_at: null,
    }));

    await cloudImport(exported);
    await sync();

    expect(cloud.liveRemoteRows(SYNC_TABLES.WEIGHT_ENTRIES).map((r) => r.id).sort()).toEqual([
      'w-keep',
      'w-new',
    ]);
    // The exporting device's identity did not ride along into this device's rows.
    const raw = await Storage.loadWeightEntriesRaw();
    expect(raw.every((r) => r.client_id !== 'c_other_device')).toBe(true);
  });

  it('leaves diff-tracked state (the weight goal) to the snapshot diff, which clears it in the cloud', async () => {
    // The cloud adapter does not implement the goal domain methods; the goal is
    // diff-tracked, so writing it through its own storage module is exactly what
    // the sync pass observes.
    await saveWeightGoal({ target_weight: 170, target_date: '2026-12-01' });
    await sync();
    expect(cloud.liveRemoteRows(SYNC_TABLES.WEIGHT_GOAL)).toHaveLength(1);

    // The backup carries `weight_goal: null`, so the restore clears it.
    await cloudImport(replacementBackup());
    expect(await loadWeightGoal()).toBeNull();

    await sync();
    expect(cloud.liveRemoteRows(SYNC_TABLES.WEIGHT_GOAL)).toHaveLength(0);
  });
});

describe('cloud-mode replace: interruption, retry, idempotency', () => {
  it('keeps the imported state and the deletion intent when the upload fails, and a retry completes it', async () => {
    await seedSyncedDevice();
    await cloudImport(replacementBackup());

    cloud.failPushOnce(SYNC_TABLES.WEIGHT_ENTRIES);
    await expect(sync()).rejects.toThrow();

    // Nothing was lost by the failure: the imported rows are still on the
    // device, the tombstone is still on the device, and the queue is still armed.
    const visible = await Storage.getStorageAdapter().loadWeightEntries();
    expect(visible.map((r) => r.id).sort()).toEqual(['w-keep', 'w-new']);
    const dropped = (await Storage.loadWeightEntriesRaw()).find((r) => r.id === 'w-dropped');
    expect(isTombstone(dropped)).toBe(true);
    expect((await getDirtyRecords(SYNC_TABLES.WEIGHT_ENTRIES)).length).toBeGreaterThan(0);
    // The account still holds the pre-import row, unmodified.
    expect(isTombstone(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w-dropped'))).toBe(false);

    await sync();

    expect(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w-new')).toBeDefined();
    expect(isTombstone(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w-dropped'))).toBe(true);
    expect(await getDirtyRecords(SYNC_TABLES.WEIGHT_ENTRIES)).toHaveLength(0);
  });

  it('is idempotent: repeated syncs after an import push nothing further and duplicate no rows', async () => {
    await seedSyncedDevice();
    await cloudImport(replacementBackup());
    await sync();

    const pushedAfterFirst = cloud.pushedIds(SYNC_TABLES.WEIGHT_ENTRIES).length;
    await sync();
    await sync();

    expect(cloud.pushedIds(SYNC_TABLES.WEIGHT_ENTRIES).length).toBe(pushedAfterFirst);
    expect(await getDirtyRecords(SYNC_TABLES.WEIGHT_ENTRIES)).toHaveLength(0);
    expect(await getDirtyRecords(SYNC_TABLES.WORKOUT_NOTES)).toHaveLength(0);
    expect(cloud.remoteRows(SYNC_TABLES.WEIGHT_ENTRIES).map((r) => r.id).sort()).toEqual([
      'w-dropped',
      'w-keep',
      'w-new',
    ]);
    expect(await getSyncSnapshot(SYNC_TABLES.WEIGHT_ENTRIES)).not.toBeNull();
  });

  it('is idempotent across a REPEATED import of the same backup', async () => {
    await seedSyncedDevice();
    await cloudImport(replacementBackup());
    await sync();

    await cloudImport(replacementBackup());
    await sync();

    expect(cloud.liveRemoteRows(SYNC_TABLES.WEIGHT_ENTRIES).map((r) => r.id).sort()).toEqual([
      'w-keep',
      'w-new',
    ]);
    const raw = await Storage.loadWeightEntriesRaw();
    expect(raw.map((r) => r.id).sort()).toEqual(['w-dropped', 'w-keep', 'w-new']);
  });

  it('does not restate an existing tombstone on a second import', async () => {
    await seedSyncedDevice();
    await cloudImport(replacementBackup());
    await sync();

    const before = cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w-dropped').deleted_at;
    const second = await cloudImport(replacementBackup());
    // Only the two live imported rows are re-queued; the tombstone is left alone.
    expect((await getDirtyRecords(SYNC_TABLES.WEIGHT_ENTRIES)).map((r) => r.id).sort()).toEqual([
      'w-keep',
      'w-new',
    ]);
    expect(second.queued).toBe(3);
    await sync();
    expect(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w-dropped').deleted_at).toBe(before);
  });
});

describe('cloud-mode replace: preserved invariants', () => {
  it('does not disturb the local-data owner marker', async () => {
    await Storage.setLocalDataOwner('user-abc');
    await seedSyncedDevice();

    await cloudImport(replacementBackup());

    expect(await Storage.getLocalDataOwner()).toBe('user-abc');
  });

  it('writes nothing and queues nothing when the payload is invalid', async () => {
    await seedSyncedDevice();
    const before = await Storage.loadWeightEntriesRaw();

    const result = await cloudImport({ version: '3', weight_entries: 'nope' });

    expect(result.ok).toBe(false);
    expect(await Storage.loadWeightEntriesRaw()).toEqual(before);
    expect(await getDirtyRecords(SYNC_TABLES.WEIGHT_ENTRIES)).toHaveLength(0);
  });

  it('does not delete workout notes for a v1 backup, which says nothing about them', async () => {
    await seedSyncedDevice();

    await cloudImport({ version: '1', weight_entries: [weightRow('w-v1', 170, '2026-07-08')] });

    const notes = await Storage.getStorageAdapter().loadWorkoutNotes();
    expect(notes.map((n) => n.id).sort()).toEqual(['wn-dropped', 'wn-keep']);
    expect(await getDirtyRecords(SYNC_TABLES.WORKOUT_NOTES)).toHaveLength(0);
  });

  it('does not tombstone archived weight goals, which the backup format does not carry', async () => {
    await seedSyncedDevice();
    await saveArchivedWeightGoal({
      id: 'awg-1',
      target_weight: 170,
      target_date: '2026-12-01',
      archived_at: '2026-06-01T00:00:00.000Z',
    });
    await sync();
    const archivedBefore = cloud.liveRemoteRows(SYNC_TABLES.ARCHIVED_WEIGHT_GOALS).length;
    expect(archivedBefore).toBeGreaterThan(0);

    await cloudImport(replacementBackup());
    await sync();

    expect(cloud.liveRemoteRows(SYNC_TABLES.ARCHIVED_WEIGHT_GOALS)).toHaveLength(archivedBefore);
  });
});

describe('local-mode replace: unchanged contract', () => {
  beforeEach(() => {
    Storage.setStorageMode(Storage.STORAGE_MODES.LOCAL);
    setCloudTransport(null);
  });

  it('overwrites the domain keys and fabricates no sync intent', async () => {
    await Storage.getStorageAdapter().saveWeightEntry(weightRow('w-old', 180, '2026-07-01'));

    const result = await importBackup(replacementBackup(), 'replace', {
      mode: IMPORT_MODES.LOCAL,
    });

    expect(result.ok).toBe(true);
    expect(result.mode).toBe(IMPORT_MODES.LOCAL);
    expect(result.queued).toBe(0);
    // The replaced-away row is GONE, not tombstoned: on a device with no
    // account there is no second copy for a tombstone to reconcile against.
    const raw = await Storage.loadWeightEntriesRaw();
    expect(raw.map((r) => r.id).sort()).toEqual(['w-keep', 'w-new']);
    expect(raw.every((r) => r.updated_at === undefined)).toBe(true);
    expect(await getDirtyRecords(SYNC_TABLES.WEIGHT_ENTRIES)).toHaveLength(0);
    expect(await getDirtyRecords(SYNC_TABLES.WORKOUT_NOTES)).toHaveLength(0);
  });

  it('defaults to the local contract when no mode is given', async () => {
    const result = await importBackup(replacementBackup());
    expect(result.mode).toBe(IMPORT_MODES.LOCAL);
    expect(await getDirtyRecords(SYNC_TABLES.WEIGHT_ENTRIES)).toHaveLength(0);
  });
});

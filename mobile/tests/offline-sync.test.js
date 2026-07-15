// Offline last-write-wins sync tests (Phase 4 / Task 11).
//
// Drives the cloud storage adapter and sync engine fully offline using an
// in-memory fake cloud transport. Covers the acceptance criteria:
//   - offline weight create/edit/delete syncs after reconnect
//   - offline workout-note create/edit/delete syncs after reconnect
//   - LWW uses updated_at; exact ties break by deterministic client id
//   - delete tombstones sync before physical deletion
//   - derived JSON conflict on unchanged raw_text resolves by recompute, not a
//     user-facing conflict

import AsyncStorage from '@react-native-async-storage/async-storage';

import * as Storage from '../storage/entries';
import { loadArchivedWeightGoalsRaw } from '../storage/entries/weightGoal';
import { cloudAdapter, setCloudTransport, setRecomputeDerived } from '../storage/cloudAdapter';
import {
  pickWinner,
  resolveRecord,
  mergeRecords,
  stampWrite,
  stampTombstone,
  isTombstone,
  maxUpdatedAt,
  resetClientIdCacheForTests,
  resetStampClockForTests,
  getCursor,
  getDirtyRecords,
  enqueueDirty,
  getClientId,
  SYNC_TABLES,
  SINGLETON_SYNC_ID,
} from '../storage/syncQueue';

import {
  deriveFatigueCheckinRows,
  fatigueCheckinId,
} from '../storage/cloud/bootstrapPlan';

import React from 'react';
import TestRenderer from 'react-test-renderer';
import { useWeightEntries, useDeloadHistory } from '../hooks/useEntries';
import { getSupabaseClient } from '../lib/supabaseClient';

// Mock the Supabase client module so the user_id-stamping test can drive the
// REAL transport without a network. Every other test injects its own fake
// transport via setCloudTransport, so this mock stays dormant for them.
jest.mock('../lib/supabaseClient', () => ({ getSupabaseClient: jest.fn() }));

// ── in-memory fake cloud ───────────────────────────────────────────────────────
//
// Models a remote keyed by (table, id). `online` gates connectivity so we can
// simulate edits made while offline that only push after "reconnect".
// The three tables whose primary key is `user_id` alone. They have NO `id`
// column, so a row pulled from the real database never carries one — the fake
// strips `id` on pull to model that faithfully, and the sync engine must
// synthesize `SINGLETON_SYNC_ID` to key its id-based merge.
const SINGLETON_TABLES = new Set([
  SYNC_TABLES.USER_PROFILE,
  SYNC_TABLES.FEATURE_TOGGLES,
  SYNC_TABLES.WEIGHT_GOAL,
]);

function makeFakeCloud() {
  // Every table the sync engine touches, including the four routed through the
  // ongoing sync path in issue #489.
  const tables = {};
  for (const table of Object.values(SYNC_TABLES)) {
    tables[table] = new Map();
  }
  const state = { online: true };
  const pushes = [];

  // Stands in for the Postgres `now()` the updated_at trigger uses. It must be
  // strictly later than anything already stored, so an arriving write always
  // orders after the rows it is racing — which is what makes "last write to
  // reach the server wins" true, independent of any device's clock.
  let lastServerMs = 0;
  function serverNow(table) {
    // Seed from wall-clock so stamps are realistic, then force them strictly
    // past both the previous stamp and anything already in the table.
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
      if (!state.online) throw new Error('offline');
      const rows = [...tables[table].values()];
      // Inclusive cursor (`>=`) mirrors the real transport so an exact-timestamp
      // LWW tie at the boundary is still pulled. Idempotent merge makes the
      // re-pull safe.
      const changed = cursor ? rows.filter((r) => (r.updated_at || '') >= cursor) : rows;
      const sorted = changed.sort((a, b) =>
        (a.updated_at || '').localeCompare(b.updated_at || '')
      );
      // `client_id` is NOT a stored column: transport.js drops it from every
      // upsert, so no row in the real database has one and no pulled row can
      // carry one back. Enforce that here — pull is the single point where rows
      // leave the server — so pickWinner's tie-break is exercised against the
      // same shape production actually produces.
      const served = sorted.map(({ client_id: _c, ...row }) => row); // eslint-disable-line no-unused-vars
      if (!SINGLETON_TABLES.has(table)) return served;
      return served.map(({ id, ...row }) => row); // eslint-disable-line no-unused-vars
    },
    async push(table, records) {
      if (!state.online) throw new Error('offline');
      pushes.push({ table, ids: records.map((r) => r.id) });
      for (const rec of records) {
        // Model the REAL server, which does not arbitrate by client clock.
        //
        // `transport.js` deliberately omits `updated_at` from every upsert
        // whitelist because a BEFORE INSERT/UPDATE trigger forces `now()`. So
        // Postgres accepts the upsert unconditionally and stamps it itself —
        // there is no server-side pickWinner. "Last write to REACH the server
        // wins" is a property of arrival order, not of a comparison.
        //
        // This fake previously ran pickWinner(existing, rec) against the
        // CLIENT's updated_at, which no production code path does. That guard
        // masked the clock-skew edit loss Codex found in #489: it made a lagging
        // device's push look correctly rejected instead of wrongly discarded.
        // A test double must not be kinder than the system it stands in for.
        //
        // `client_id` is dropped for the same reason: buildUpsertRow omits it
        // (it is not a stored column), so it never survives a write.
        const { client_id: _clientId, ...row } = rec; // eslint-disable-line no-unused-vars
        tables[table].set(rec.id, { ...row, updated_at: serverNow(table) });
      }
    },
  };

  return {
    transport,
    state,
    pushes,
    remoteRow: (table, id) => tables[table].get(id),
    remoteRows: (table) => [...tables[table].values()],
    seedRemote: (table, rec) => tables[table].set(rec.id, rec),
    setOnline: (v) => {
      state.online = v;
    },
  };
}

let cloud;

beforeEach(async () => {
  await AsyncStorage.clear();
  resetClientIdCacheForTests();
  resetStampClockForTests();
  cloud = makeFakeCloud();
  setCloudTransport(cloud.transport);
  Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
});

afterEach(() => {
  setCloudTransport(null);
  setRecomputeDerived(null);
  Storage.setStorageMode(Storage.STORAGE_MODES.LOCAL);
});

// ── pure LWW unit coverage ──────────────────────────────────────────────────────

describe('LWW resolution', () => {
  // A server row is identified by the ABSENCE of client_id: transport.js drops it
  // from every upsert because it is not a stored column, so nothing pulled from
  // the database ever carries one.
  it('on an exact tie the server row wins, so every device converges', () => {
    const serverRow = { id: '1', updated_at: '2026-06-15T10:00:00.000Z', weight_value: 199 };

    // Two different devices, each holding its own local copy at the same instant.
    const deviceA = { ...serverRow, weight_value: 180, client_id: 'aaaa-device' };
    const deviceB = { ...serverRow, weight_value: 181, client_id: 'zzzz-device' };

    // Both must adopt the server's copy — regardless of argument order, and
    // regardless of how their client_ids compare to each other.
    expect(pickWinner(deviceA, serverRow)).toBe(serverRow);
    expect(pickWinner(serverRow, deviceA)).toBe(serverRow);
    expect(pickWinner(deviceB, serverRow)).toBe(serverRow);
    expect(pickWinner(serverRow, deviceB)).toBe(serverRow);

    // The old rule fell through to `(a.client_id || '') >= (b.client_id || '')`,
    // which always favours the side that HAS a client_id — the local row. Each
    // device would have kept its own value (180 vs 181) and silently diverged.
  });

  it('between two local rows an exact tie still breaks deterministically on client_id', () => {
    const a = { id: '1', updated_at: '2026-06-15T10:00:00.000Z', client_id: 'aaaa' };
    const b = { id: '1', updated_at: '2026-06-15T10:00:00.000Z', client_id: 'zzzz' };
    expect(pickWinner(a, b)).toBe(b);
    expect(pickWinner(b, a)).toBe(b);
  });

  it('newer updated_at wins', () => {
    const a = { id: '1', updated_at: '2026-06-15T10:00:00.000Z', client_id: 'a' };
    const b = { id: '1', updated_at: '2026-06-15T11:00:00.000Z', client_id: 'a' };
    expect(pickWinner(a, b)).toBe(b);
    expect(pickWinner(b, a)).toBe(b);
  });

  it('exact updated_at tie breaks by lexicographically greater client_id', () => {
    const same = '2026-06-15T10:00:00.000Z';
    const a = { id: '1', updated_at: same, client_id: 'aaa' };
    const z = { id: '1', updated_at: same, client_id: 'zzz' };
    expect(pickWinner(a, z)).toBe(z);
    expect(pickWinner(z, a)).toBe(z);
    // Deterministic regardless of argument order.
  });

  it('a later delete tombstone wins over an earlier edit, and a later edit revives', () => {
    const edit = { id: '1', updated_at: '2026-06-15T10:00:00.000Z', client_id: 'a' };
    const del = { id: '1', updated_at: '2026-06-15T11:00:00.000Z', client_id: 'a', deleted_at: '2026-06-15T11:00:00.000Z' };
    expect(isTombstone(pickWinner(edit, del))).toBe(true);

    const revive = { id: '1', updated_at: '2026-06-15T12:00:00.000Z', client_id: 'a', deleted_at: null };
    expect(isTombstone(pickWinner(del, revive))).toBe(false);
  });

  it('maxUpdatedAt advances the cursor to the highest seen timestamp', () => {
    const recs = [
      { updated_at: '2026-06-15T10:00:00.000Z' },
      { updated_at: '2026-06-15T12:00:00.000Z' },
      { updated_at: '2026-06-15T11:00:00.000Z' },
    ];
    expect(maxUpdatedAt(recs, '2026-06-15T09:00:00.000Z')).toBe('2026-06-15T12:00:00.000Z');
    expect(maxUpdatedAt([], '2026-06-15T09:00:00.000Z')).toBe('2026-06-15T09:00:00.000Z');
  });
});

describe('derived-JSON conflict resolves by recompute, not user conflict', () => {
  it('same raw_text but divergent derived fields recomputes from raw_text', () => {
    const recompute = (raw) => ({ tracked_exercises: [`derived:${raw}`] });
    const local = {
      id: 'n1',
      raw_text: 'Squat 3x5',
      updated_at: '2026-06-15T10:00:00.000Z',
      client_id: 'a',
      tracked_exercises: ['STALE-LOCAL'],
    };
    const remote = {
      id: 'n1',
      raw_text: 'Squat 3x5',
      updated_at: '2026-06-15T11:00:00.000Z',
      client_id: 'a',
      tracked_exercises: ['STALE-REMOTE'],
    };
    const resolved = resolveRecord(local, remote, {
      table: SYNC_TABLES.WORKOUT_NOTES,
      recomputeDerived: recompute,
    });
    // Neither stale snapshot survives; derived is recomputed from raw_text.
    expect(resolved.tracked_exercises).toEqual(['derived:Squat 3x5']);
    expect(resolved.raw_text).toBe('Squat 3x5');
  });

  it('different raw_text is a normal LWW pick (no recompute short-circuit)', () => {
    const recompute = () => ({ tracked_exercises: ['RECOMPUTED'] });
    const local = { id: 'n1', raw_text: 'A', updated_at: '2026-06-15T10:00:00.000Z', client_id: 'a' };
    const remote = { id: 'n1', raw_text: 'B', updated_at: '2026-06-15T11:00:00.000Z', client_id: 'a' };
    const resolved = resolveRecord(local, remote, {
      table: SYNC_TABLES.WORKOUT_NOTES,
      recomputeDerived: recompute,
    });
    expect(resolved.raw_text).toBe('B');
    expect(resolved.tracked_exercises).toBeUndefined();
  });
});

describe('mergeRecords (keyed, no nested scan)', () => {
  it('merges remote into local by id applying LWW', () => {
    const local = [
      { id: '1', updated_at: '2026-06-15T10:00:00.000Z', client_id: 'a', weight_value: 180 },
      { id: '2', updated_at: '2026-06-15T10:00:00.000Z', client_id: 'a', weight_value: 200 },
    ];
    const remote = [
      { id: '1', updated_at: '2026-06-15T11:00:00.000Z', client_id: 'a', weight_value: 181 },
      { id: '3', updated_at: '2026-06-15T11:00:00.000Z', client_id: 'a', weight_value: 150 },
    ];
    const merged = mergeRecords(local, remote);
    expect(merged.get('1').weight_value).toBe(181); // remote newer
    expect(merged.get('2').weight_value).toBe(200); // local only
    expect(merged.get('3').weight_value).toBe(150); // remote only
  });
});

// ── weight entries: offline create / edit / delete ──────────────────────────────

describe('weight entries offline create/edit/delete sync', () => {
  function weightEntry(id, value) {
    return {
      id,
      entry_type: 'weight',
      date: '2026-06-15',
      logged_at: '2026-06-15T12:00:00.000Z',
      weight_value: value,
    };
  }

  it('offline create pushes to cloud after reconnect', async () => {
    cloud.setOnline(false);
    await cloudAdapter.saveWeightEntry(weightEntry('w1', 180));
    // Local cache reflects it immediately while offline.
    expect((await cloudAdapter.loadWeightEntries()).map((e) => e.id)).toContain('w1');
    // Nothing reached the cloud yet.
    expect(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w1')).toBeUndefined();

    cloud.setOnline(true);
    await cloudAdapter.sync();
    const remote = cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w1');
    expect(remote).toBeDefined();
    expect(remote.weight_value).toBe(180);
    // client_id must NOT survive the write. buildUpsertRow omits it — it is not
    // a stored column — so it exists only in the local sync engine. Asserting it
    // came back was asserting the old fake's behavior, not the database's.
    expect(remote.client_id).toBeUndefined();
    expect(remote.updated_at).toBeTruthy(); // server-assigned, not the client's
  });

  it('offline edit pushes the updated value after reconnect', async () => {
    await cloudAdapter.saveWeightEntry(weightEntry('w1', 180));
    await cloudAdapter.sync();

    cloud.setOnline(false);
    await cloudAdapter.updateWeightEntry('w1', 185, 'after meal', '2026-06-15');
    cloud.setOnline(true);
    await cloudAdapter.sync();

    expect(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w1').weight_value).toBe(185);
  });

  it('offline delete syncs a tombstone before physical deletion, hiding it locally', async () => {
    await cloudAdapter.saveWeightEntry(weightEntry('w1', 180));
    await cloudAdapter.sync();

    cloud.setOnline(false);
    await cloudAdapter.deleteWeightEntry('w1');
    // Hidden from user-facing reads immediately.
    expect((await cloudAdapter.loadWeightEntries()).map((e) => e.id)).not.toContain('w1');
    // But still physically present as a tombstone in the raw cache (not deleted).
    const raw = await Storage.loadWeightEntriesRaw();
    const row = raw.find((r) => r.id === 'w1');
    expect(row).toBeDefined();
    expect(isTombstone(row)).toBe(true);
    // Tombstone has not reached the cloud while offline.
    expect(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w1')).toBeDefined(); // live row from earlier sync
    expect(isTombstone(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w1'))).toBe(false);

    cloud.setOnline(true);
    await cloudAdapter.sync();
    // The tombstone reached the cloud (delete synced before any physical purge).
    expect(isTombstone(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w1'))).toBe(true);
  });

  it('pulls an exact-timestamp tie at the cursor boundary and converges on the server row', async () => {
    // Create + sync so this device's cursor advances to the row's updated_at.
    await cloudAdapter.saveWeightEntry(weightEntry('w1', 180));
    await cloudAdapter.sync();

    const cursor = await getCursor(SYNC_TABLES.WEIGHT_ENTRIES);
    expect(cursor).toBeTruthy();

    // Another device's write landed at EXACTLY the cursor timestamp. An exclusive
    // `>` cursor would skip it forever; an inclusive `>=` re-pulls the boundary
    // and LWW resolves it.
    //
    // Note what the row does NOT have: a client_id. It is not a stored column, so
    // no row coming back from the server carries one — the fake now enforces that
    // on pull. The tie therefore cannot be settled by comparing client_ids, and
    // the old rule silently favoured whichever side HAD one, i.e. the local row.
    // That does not converge: each device would keep its own copy. The server row
    // wins instead, and every device sees the same server row, so all of them
    // land on the same value.
    cloud.seedRemote(SYNC_TABLES.WEIGHT_ENTRIES, {
      ...weightEntry('w1', 199),
      updated_at: cursor,
    });

    await cloudAdapter.sync();
    const local = await cloudAdapter.loadWeightEntries();
    expect(local.find((e) => e.id === 'w1').weight_value).toBe(199);
  });

  it('remote newer edit wins over older local on pull (multi-device LWW)', async () => {
    await cloudAdapter.saveWeightEntry(weightEntry('w1', 180));
    await cloudAdapter.sync();

    // Another device wrote a newer value directly to the cloud.
    cloud.seedRemote(SYNC_TABLES.WEIGHT_ENTRIES, {
      ...weightEntry('w1', 199),
      updated_at: '2099-01-01T00:00:00.000Z',
      client_id: 'other-device',
    });

    await cloudAdapter.sync();
    const local = await cloudAdapter.loadWeightEntries();
    expect(local.find((e) => e.id === 'w1').weight_value).toBe(199);
  });
});

// ── workout notes: offline create / edit / delete + derived recompute ────────────

describe('workout notes offline create/edit/delete sync', () => {
  function note(id, raw_text) {
    return {
      id,
      title: 'Routine',
      raw_text,
      saved_at: '2026-06-15T12:00:00.000Z',
      tracked_exercises: [],
    };
  }

  it('offline create/edit/delete reconcile after reconnect', async () => {
    cloud.setOnline(false);
    await cloudAdapter.saveWorkoutNoteItem(note('n1', 'Squat 3x5'));
    expect((await cloudAdapter.loadWorkoutNotes()).map((n) => n.id)).toContain('n1');
    cloud.setOnline(true);
    await cloudAdapter.sync();
    expect(cloud.remoteRow(SYNC_TABLES.WORKOUT_NOTES, 'n1').raw_text).toBe('Squat 3x5');

    cloud.setOnline(false);
    await cloudAdapter.saveWorkoutNoteItem(note('n1', 'Squat 3x5\nBench 3x5'));
    cloud.setOnline(true);
    await cloudAdapter.sync();
    expect(cloud.remoteRow(SYNC_TABLES.WORKOUT_NOTES, 'n1').raw_text).toBe('Squat 3x5\nBench 3x5');

    cloud.setOnline(false);
    await cloudAdapter.deleteWorkoutNoteItem('n1');
    expect((await cloudAdapter.loadWorkoutNotes()).map((n) => n.id)).not.toContain('n1');
    cloud.setOnline(true);
    await cloudAdapter.sync();
    expect(isTombstone(cloud.remoteRow(SYNC_TABLES.WORKOUT_NOTES, 'n1'))).toBe(true);
  });

  // Codex re-review, #489: the same incomparable-clocks defect fixed in
  // syncDiffTable also lived in syncTable — the path carrying weight entries and
  // workout notes. A local tombstone is stamped with the DEVICE clock; the pulled
  // row carries the SERVER's. Merging them through pickWinner meant a device whose
  // clock lagged lost, so `merged.get(id)` yielded the live remote row, THAT was
  // pushed in place of the tombstone, and the tombstone was cleared from the dirty
  // queue. The delete never reached the cloud and the note resurrected on the next
  // pull.
  //
  // The existing test above only hit this when real millisecond timing happened to
  // line up, which is why it failed intermittently rather than reliably. This one
  // forces the skew, so the defect cannot hide behind a lucky clock.
  it('a delete still reaches the cloud when the device clock lags the server', async () => {
    await cloudAdapter.saveWorkoutNoteItem(note('n1', 'Squat 3x5'));
    await cloudAdapter.sync();

    // Another device touched the row and the server stamped it far beyond
    // anything this device's clock can mint.
    cloud.seedRemote(SYNC_TABLES.WORKOUT_NOTES, {
      ...cloud.remoteRow(SYNC_TABLES.WORKOUT_NOTES, 'n1'),
      updated_at: '2099-01-01T00:00:00.000Z',
    });

    await cloudAdapter.deleteWorkoutNoteItem('n1');
    await cloudAdapter.sync();

    // The delete must reach the server. Arrival decides the winner, not a
    // comparison against a clock this device does not share.
    expect(isTombstone(cloud.remoteRow(SYNC_TABLES.WORKOUT_NOTES, 'n1'))).toBe(true);

    // And it must not come back on the next pull.
    await cloudAdapter.sync();
    expect((await cloudAdapter.loadWorkoutNotes()).map((n) => n.id)).not.toContain('n1');
  });

  it('an edit still reaches the cloud when the device clock lags the server', async () => {
    await cloudAdapter.saveWorkoutNoteItem(note('n1', 'Squat 3x5'));
    await cloudAdapter.sync();

    cloud.seedRemote(SYNC_TABLES.WORKOUT_NOTES, {
      ...cloud.remoteRow(SYNC_TABLES.WORKOUT_NOTES, 'n1'),
      updated_at: '2099-01-01T00:00:00.000Z',
    });

    await cloudAdapter.saveWorkoutNoteItem(note('n1', 'Squat 5x5'));
    await cloudAdapter.sync();

    expect(cloud.remoteRow(SYNC_TABLES.WORKOUT_NOTES, 'n1').raw_text).toBe('Squat 5x5');
    expect(
      (await cloudAdapter.loadWorkoutNotes()).find((n) => n.id === 'n1').raw_text
    ).toBe('Squat 5x5');
  });

  it('derived-only divergence on unchanged raw_text recomputes silently on sync', async () => {
    // Inject a deterministic recompute so we can assert it ran.
    setRecomputeDerived((raw) => ({ tracked_exercises: [`recomputed:${raw}`] }));

    await cloudAdapter.saveWorkoutNoteItem(note('n1', 'Deadlift 1x5'));
    await cloudAdapter.sync();

    // A remote copy with the SAME raw_text but stale/different derived cache and
    // a newer updated_at arrives from another device.
    cloud.seedRemote(SYNC_TABLES.WORKOUT_NOTES, {
      ...note('n1', 'Deadlift 1x5'),
      tracked_exercises: ['STALE-FROM-OTHER-DEVICE'],
      updated_at: '2099-01-01T00:00:00.000Z',
      client_id: 'other-device',
    });

    await cloudAdapter.sync();
    const merged = (await cloudAdapter.loadWorkoutNotes()).find((n) => n.id === 'n1');
    // Conflict resolved by recompute from raw_text, not by trusting either cache.
    expect(merged.tracked_exercises).toEqual(['recomputed:Deadlift 1x5']);
  });
});

describe('sync metadata stamping', () => {
  it('stampWrite advances updated_at, sets client_id, clears tombstone', () => {
    const stamped = stampWrite({ id: 'x' }, 'client-7', '2026-06-15T10:00:00.000Z');
    expect(stamped.updated_at).toBe('2026-06-15T10:00:00.000Z');
    expect(stamped.client_id).toBe('client-7');
    expect(stamped.deleted_at).toBeNull();
  });

  it('stampTombstone sets deleted_at = updated_at', () => {
    const ts = stampTombstone({ id: 'x' }, 'client-7', '2026-06-15T10:00:00.000Z');
    expect(ts.deleted_at).toBe('2026-06-15T10:00:00.000Z');
    expect(ts.updated_at).toBe('2026-06-15T10:00:00.000Z');
    expect(isTombstone(ts)).toBe(true);
  });
});

// ── failed-push safety (folded in from the Task 11 bootstrap-substrate set) ──────
//
// These invariants — that a failed offline push loses no local data, retains the
// dirty queue, never advances the cursor, and re-pushes cleanly on reconnect —
// are exactly the safety guarantees a cloud bootstrap (#319) sits on top of.
describe('failed offline push is safe (no data loss, retryable)', () => {
  const w = (id, value) => ({
    id,
    entry_type: 'weight',
    date: '2026-06-15',
    logged_at: '2026-06-15T12:00:00.000Z',
    weight_value: value,
  });

  it('retains local data, the dirty queue, and the cursor when a push fails offline', async () => {
    await cloudAdapter.saveWeightEntry(w('w1', 180));

    cloud.setOnline(false);
    await expect(cloudAdapter.sync()).rejects.toThrow('offline');

    const local = await cloudAdapter.loadWeightEntries();
    expect(local.map((e) => e.id)).toEqual(['w1']);
    expect(local[0].weight_value).toBe(180);

    expect((await getDirtyRecords(SYNC_TABLES.WEIGHT_ENTRIES)).map((d) => d.id)).toEqual(['w1']);
    expect(await getCursor(SYNC_TABLES.WEIGHT_ENTRIES)).toBeNull();
  });

  it('re-pushes successfully with no data loss once back online', async () => {
    await cloudAdapter.saveWeightEntry(w('w1', 180));

    cloud.setOnline(false);
    await expect(cloudAdapter.sync()).rejects.toThrow('offline');

    cloud.setOnline(true);
    await cloudAdapter.sync();

    expect(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w1').weight_value).toBe(180);
    expect(await getDirtyRecords(SYNC_TABLES.WEIGHT_ENTRIES)).toHaveLength(0);
    expect(await getCursor(SYNC_TABLES.WEIGHT_ENTRIES)).toBeTruthy();
  });
});

// ── Finding 1: cloud-mode writes through the app hooks enter the dirty queue ─────
//
// The gap: useEntries mutators previously called raw Storage.* directly, which
// only writes AsyncStorage and never stamps sync metadata or enqueues a dirty
// record — so offline edits made through the app never synced. These tests
// exercise the REAL hook (not just the adapter) to prove the write path now
// routes through the cloud adapter.
function driveHook(useHook) {
  const ref = { current: null };
  function Probe() {
    ref.current = useHook();
    return null;
  }
  TestRenderer.act(() => {
    TestRenderer.create(React.createElement(Probe));
  });
  return ref;
}

async function flushAsync() {
  await TestRenderer.act(async () => {
    await Promise.resolve();
  });
}

describe('cloud-mode writes through the app hooks (Finding 1)', () => {
  const wEntry = (id, value) => ({
    id,
    entry_type: 'weight',
    date: '2026-06-15',
    logged_at: '2026-06-15T12:00:00.000Z',
    weight_value: value,
  });

  it('a create via useWeightEntries stamps + enqueues and syncs after reconnect', async () => {
    const hook = driveHook(useWeightEntries);
    await flushAsync(); // settle the on-mount refresh against the empty cloud

    cloud.setOnline(false);
    await TestRenderer.act(async () => {
      await hook.current.add(wEntry('w1', 180));
    });

    // Routed through the cloud adapter, so it entered the persisted dirty queue.
    // (A raw Storage.saveWeightEntry would have left the queue empty.)
    const dirty = await getDirtyRecords(SYNC_TABLES.WEIGHT_ENTRIES);
    expect(dirty.map((d) => d.id)).toContain('w1');

    cloud.setOnline(true);
    await cloudAdapter.sync();
    expect(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w1').weight_value).toBe(180);
  });

  it('an offline edit + delete via useWeightEntries reconcile after reconnect', async () => {
    const hook = driveHook(useWeightEntries);
    await flushAsync();

    cloud.setOnline(false);
    await TestRenderer.act(async () => {
      await hook.current.add(wEntry('w1', 180));
      await hook.current.update('w1', 181, 'edit', '2026-06-15');
    });
    expect((await getDirtyRecords(SYNC_TABLES.WEIGHT_ENTRIES)).map((d) => d.id)).toContain('w1');

    cloud.setOnline(true);
    await cloudAdapter.sync();
    expect(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w1').weight_value).toBe(181);

    cloud.setOnline(false);
    await TestRenderer.act(async () => {
      await hook.current.remove('w1');
    });
    cloud.setOnline(true);
    await cloudAdapter.sync();
    // The delete tombstone reached the cloud (synced before any physical purge).
    expect(isTombstone(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w1'))).toBe(true);
  });
});

// ── Finding 2: the real Supabase transport stamps user_id on every pushed row ────
describe('real Supabase transport stamps user_id (Finding 2)', () => {
  const wEntry = (id, value) => ({
    id,
    entry_type: 'weight',
    date: '2026-06-15',
    logged_at: '2026-06-15T12:00:00.000Z',
    weight_value: value,
  });

  it('adds user_id = auth user id to every upserted row', async () => {
    const upserts = [];
    const query = { gte: () => query, order: async () => ({ data: [], error: null }) };
    const fakeClient = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'user-123' } }, error: null }),
      },
      schema: () => ({
        from: () => ({
          select: () => query,
          upsert: async (rows) => {
            upserts.push(...rows);
            return { error: null };
          },
        }),
      }),
    };
    getSupabaseClient.mockReturnValue(fakeClient);

    // Enqueue a dirty record through the adapter, then force the REAL transport
    // (not the injected fake) so the push path runs auth + user_id stamping.
    await cloudAdapter.saveWeightEntry(wEntry('w1', 180));
    setCloudTransport(null);
    await cloudAdapter.sync();

    expect(upserts.length).toBeGreaterThan(0);
    for (const row of upserts) {
      expect(row.user_id).toBe('user-123');
    }
    expect(upserts.find((r) => r.id === 'w1')).toBeTruthy();
  });

  it('pushes archived_weight_goals rows with whitelisted columns only', async () => {
    const upserts = [];
    const query = { gte: () => query, order: async () => ({ data: [], error: null }) };
    const fakeClient = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'user-abc' } }, error: null }),
      },
      schema: () => ({
        from: () => ({
          select: () => query,
          upsert: async (rows) => {
            upserts.push(...rows);
            return { error: null };
          },
        }),
      }),
    };
    getSupabaseClient.mockReturnValue(fakeClient);

    // Enqueue a dirty archived goal directly (mirrors weightHooks archiveGoal).
    // Include a local-only field that must be stripped by the whitelist.
    const clientId = await getClientId();
    const goal = stampWrite(
      {
        id: 'ag1',
        target_weight: 180,
        target_date: '2026-12-31',
        start_weight: 200,
        start_date: '2026-01-01',
        completed_weight: 179,
        archived_at: '2026-06-15T12:00:00.000Z',
        goal_json: { extra: true },
        saved_at: '2026-06-15T12:00:00.000Z',
        local_only_field: 'should-not-appear',
      },
      clientId
    );
    await enqueueDirty(SYNC_TABLES.ARCHIVED_WEIGHT_GOALS, goal);

    setCloudTransport(null);
    await cloudAdapter.sync();

    const pushed = upserts.find((r) => r.id === 'ag1');
    expect(pushed).toBeTruthy();

    // server-bound identity
    expect(pushed.user_id).toBe('user-abc');

    // all whitelisted archived-goal fields must be present with correct values
    expect(pushed.target_weight).toBe(180);
    expect(pushed.target_date).toBe('2026-12-31');
    expect(pushed.start_weight).toBe(200);
    expect(pushed.start_date).toBe('2026-01-01');
    expect(pushed.completed_weight).toBe(179);
    expect(pushed.archived_at).toBe('2026-06-15T12:00:00.000Z');
    expect(pushed.goal_json).toEqual({ extra: true });
    expect(pushed.saved_at).toBe('2026-06-15T12:00:00.000Z');

    // server-authoritative and local-only fields must be absent
    expect(pushed.updated_at).toBeUndefined();
    expect(pushed.client_id).toBeUndefined();
    expect(pushed.local_only_field).toBeUndefined();
  });
});

// ── Regression #458: phantom "Routine 1" reappears via sync pull ─────────────────
//
// Root cause: the #443 fix guards the bootstrap upload path but an already-uploaded
// cloud row (wn_legacy_<userId>, source_snapshot.async_storage_key = 'kilo_workout_note')
// is pulled on every sync pass and merged into local storage via LWW. The sync path
// had no awareness of the phantom-prevention guard, so it re-wrote the phantom
// locally on every sync even though bootstrap would no longer create it.
//
// The fix: before the sync loop, tombstone any live phantom legacy notes in local
// storage when non-phantom notes already exist, and enqueue them dirty so the
// tombstone is pushed to cloud in the same sync pass.
describe('phantom Routine 1 regression via sync pull (issue #458)', () => {
  const USER_ID = 'u-phantom-458';
  const PHANTOM_ID = `wn_legacy_${USER_ID}`;

  function phantomRow(overrides = {}) {
    return {
      id: PHANTOM_ID,
      title: 'Routine 1',
      raw_text: '-Squat\n- 225 5,5,5',
      saved_at: '2026-05-01T00:00:00.000Z',
      updated_at: '2026-05-02T00:00:00.000Z',
      source_snapshot: { async_storage_key: 'kilo_workout_note' },
      ...overrides,
    };
  }

  function realNote(id = 'wn_real_1') {
    return {
      id,
      title: 'Current Program',
      raw_text: '-Bench\n- 185 5,5,5',
      saved_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-15T00:00:00.000Z',
    };
  }

  it('phantom pulled from cloud is NOT written to local when non-phantom notes exist', async () => {
    // Local has a real non-phantom note; user never sees phantom.
    const preserved = realNote();
    await Storage.replaceWorkoutNotesRaw([preserved]);
    await Storage.setCurrentWorkoutNote(preserved.id);

    // Cloud has the old phantom row from a pre-#443 or edge-case bootstrap.
    cloud.seedRemote(SYNC_TABLES.WORKOUT_NOTES, phantomRow());

    await cloudAdapter.sync();

    // Phantom must not appear as a live note after sync.
    const notes = await cloudAdapter.loadWorkoutNotes();
    expect(notes.find((n) => n.id === PHANTOM_ID)).toBeUndefined();
    expect(notes.find((n) => n.id === preserved.id)).toMatchObject({
      id: preserved.id,
      raw_text: preserved.raw_text,
      isCurrent: true,
    });
    expect(await Storage.loadCurrentWorkoutId()).toBe(preserved.id);

    const localPhantom = (await Storage.loadWorkoutNotesRaw()).find((n) => n.id === PHANTOM_ID);
    expect(localPhantom.source_snapshot).toEqual({ async_storage_key: 'kilo_workout_note' });
    expect(isTombstone(localPhantom)).toBe(true);
    expect(localPhantom.updated_at > phantomRow().updated_at).toBe(true);
    expect(localPhantom.deleted_at).toBe(localPhantom.updated_at);

    // Scenario B completes cloud cleanup during the same public sync operation.
    const remotePhantom = cloud.remoteRow(SYNC_TABLES.WORKOUT_NOTES, PHANTOM_ID);
    expect(remotePhantom).toMatchObject({
      id: PHANTOM_ID,
      source_snapshot: { async_storage_key: 'kilo_workout_note' },
      // deleted_at is a client-supplied column and survives the round trip
      // verbatim. updated_at does NOT: it is stripped on push and reassigned by
      // the server trigger, so it is necessarily LATER than the client's
      // tombstone stamp rather than equal to it. Asserting equality here was
      // asserting the old fake's behavior, not Postgres's.
      deleted_at: localPhantom.deleted_at,
    });
    expect(remotePhantom.updated_at >= localPhantom.deleted_at).toBe(true);
    expect(isTombstone(remotePhantom)).toBe(true);

    await cloudAdapter.sync();
    await cloudAdapter.sync();
    expect((await cloudAdapter.loadWorkoutNotes()).find((n) => n.id === PHANTOM_ID)).toBeUndefined();
    expect(await Storage.loadCurrentWorkoutId()).toBe(preserved.id);
  });

  it('clears a current selection that points at a tombstoned phantom', async () => {
    await Storage.replaceWorkoutNotesRaw([realNote(), phantomRow({ isCurrent: true })]);
    await Storage.saveCurrentWorkoutId(PHANTOM_ID);

    await cloudAdapter.sync();

    expect(await Storage.loadCurrentWorkoutId()).toBeNull();
    const localPhantom = (await Storage.loadWorkoutNotesRaw()).find((n) => n.id === PHANTOM_ID);
    expect(isTombstone(localPhantom)).toBe(true);
    expect(localPhantom.source_snapshot.async_storage_key).toBe('kilo_workout_note');
  });

  it('phantom already in local storage is tombstoned and pushed to cloud in the same sync pass', async () => {
    // Simulate state after a prior sync that wrote the phantom locally.
    await Storage.replaceWorkoutNotesRaw([realNote(), phantomRow()]);

    // Cloud also has the live phantom.
    cloud.seedRemote(SYNC_TABLES.WORKOUT_NOTES, phantomRow());

    await cloudAdapter.sync();

    // Phantom not visible to the user.
    const notes = await cloudAdapter.loadWorkoutNotes();
    expect(notes.find((n) => n.id === PHANTOM_ID)).toBeUndefined();

    // Tombstone was pushed to cloud in the same sync pass.
    const remotePhantom = cloud.remoteRow(SYNC_TABLES.WORKOUT_NOTES, PHANTOM_ID);
    expect(isTombstone(remotePhantom)).toBe(true);
  });

  it('repeated sync passes are idempotent: phantom does not reappear', async () => {
    await Storage.replaceWorkoutNotesRaw([realNote(), phantomRow()]);
    cloud.seedRemote(SYNC_TABLES.WORKOUT_NOTES, phantomRow());

    await cloudAdapter.sync();
    await cloudAdapter.sync();
    await cloudAdapter.sync();

    const notes = await cloudAdapter.loadWorkoutNotes();
    expect(notes.find((n) => n.id === PHANTOM_ID)).toBeUndefined();
    expect(isTombstone(cloud.remoteRow(SYNC_TABLES.WORKOUT_NOTES, PHANTOM_ID))).toBe(true);
  });

  it('overlapping sync calls cannot lose a deferred cloud-only phantom tombstone', async () => {
    await Storage.replaceWorkoutNotesRaw([realNote()]);
    cloud.seedRemote(SYNC_TABLES.WORKOUT_NOTES, phantomRow());

    const baseTransport = cloud.transport;
    let workoutPulls = 0;
    let releasePulls;
    let bothPullsStarted;
    const pullGate = new Promise((resolve) => { releasePulls = resolve; });
    const bothStarted = new Promise((resolve) => { bothPullsStarted = resolve; });
    setCloudTransport({
      ...baseTransport,
      async pull(table, cursor) {
        if (table === SYNC_TABLES.WORKOUT_NOTES && workoutPulls < 2) {
          workoutPulls += 1;
          if (workoutPulls === 2) bothPullsStarted();
          await pullGate;
        }
        return baseTransport.pull(table, cursor);
      },
    });

    const first = cloudAdapter.sync();
    const second = cloudAdapter.sync();
    await bothStarted;
    releasePulls();
    await Promise.all([first, second]);

    const localPhantom = (await Storage.loadWorkoutNotesRaw()).find((n) => n.id === PHANTOM_ID);
    const remotePhantom = cloud.remoteRow(SYNC_TABLES.WORKOUT_NOTES, PHANTOM_ID);
    expect(isTombstone(localPhantom)).toBe(true);
    expect(isTombstone(remotePhantom)).toBe(true);
    expect(remotePhantom.source_snapshot.async_storage_key).toBe('kilo_workout_note');
  });

  it('preserves the phantom for a legacy-only user who has no non-phantom notes', async () => {
    // Legacy user: ONLY the phantom note exists (bootstrapped from kilo_workout_note).
    await Storage.replaceWorkoutNotesRaw([phantomRow()]);
    cloud.seedRemote(SYNC_TABLES.WORKOUT_NOTES, phantomRow());

    await cloudAdapter.sync();

    // Legacy user's only note must not be deleted.
    const notes = await cloudAdapter.loadWorkoutNotes();
    expect(notes.find((n) => n.id === PHANTOM_ID)).toMatchObject(phantomRow());
    expect(isTombstone(cloud.remoteRow(SYNC_TABLES.WORKOUT_NOTES, PHANTOM_ID))).toBe(false);
  });

  it('a legitimate user-created note titled "Routine 1" (no source_snapshot) is never treated as a phantom', async () => {
    const userNote = {
      id: 'wn_user_routine_1',
      title: 'Routine 1',
      raw_text: '-Press\n- 95 5,5,5',
      saved_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-15T00:00:00.000Z',
      // No source_snapshot — user created this themselves.
    };
    await Storage.replaceWorkoutNotesRaw([userNote, realNote('wn_other')]);

    await cloudAdapter.sync();

    const notes = await cloudAdapter.loadWorkoutNotes();
    expect(notes.find((n) => n.id === 'wn_user_routine_1')).toMatchObject(userNote);
  });
});

// ── Regression #501: legacy phantom re-uploaded with its provenance stripped ──────
//
// The ownership-confirmation "Upload It Into My Account" path re-uploads the whole
// local notebook through bootstrap. On the buggy 0.95.0 build bootstrap set
// source_snapshot: null on every notebook row, so a legacy phantom that a device
// re-uploaded arrived in the account as a LIVE cloud row with NO
// async_storage_key provenance. The #458 sync guard keyed only on source_snapshot,
// so it no longer recognized that row and wrote it to local as a visible note that
// survived restart and repeated sync.
//
// The account may already hold such a row from that build, so the sync path must
// clean it without a source_snapshot: the `wn_legacy_<userId>` id namespace is
// bootstrap-only provenance (user notes and the local migrate-to-notebook entry
// use `wn_<date>_<ts>` ids) and is the durable signal the cleanup now also keys on.
describe('phantom Routine 1 regression via provenance-stripped id (issue #501)', () => {
  const USER_ID = 'u-phantom-501';
  const PHANTOM_ID = `wn_legacy_${USER_ID}`;

  // A LIVE legacy row as the buggy ownership upload left it in the account:
  // correct id namespace, but source_snapshot stripped to null.
  function strippedPhantomRow(overrides = {}) {
    return {
      id: PHANTOM_ID,
      title: 'Routine 1',
      raw_text: '-Squat\n- 225 5,5,5',
      saved_at: '2026-05-01T00:00:00.000Z',
      updated_at: '2026-05-02T00:00:00.000Z',
      source_snapshot: null,
      ...overrides,
    };
  }

  function realNote(id = 'wn_real_501') {
    return {
      id,
      title: 'Summer 2026 Routine',
      raw_text: '-Bench\n- 185 5,5,5',
      saved_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-15T00:00:00.000Z',
    };
  }

  it('a provenance-stripped legacy row pulled from cloud is tombstoned, hidden, and converged in the same pass', async () => {
    const preserved = realNote();
    await Storage.replaceWorkoutNotesRaw([preserved]);
    await Storage.setCurrentWorkoutNote(preserved.id);

    // The account already holds the resurrected, provenance-stripped phantom.
    cloud.seedRemote(SYNC_TABLES.WORKOUT_NOTES, strippedPhantomRow());

    await cloudAdapter.sync();

    // Never user-visible, and the user's real note (and selection) is intact.
    const notes = await cloudAdapter.loadWorkoutNotes();
    expect(notes.find((n) => n.id === PHANTOM_ID)).toBeUndefined();
    expect(notes.find((n) => n.id === preserved.id)).toMatchObject({
      id: preserved.id,
      raw_text: preserved.raw_text,
      isCurrent: true,
    });
    expect(await Storage.loadCurrentWorkoutId()).toBe(preserved.id);

    // Tombstoned locally by the id-namespace guard even without a source_snapshot.
    const localPhantom = (await Storage.loadWorkoutNotesRaw()).find((n) => n.id === PHANTOM_ID);
    expect(isTombstone(localPhantom)).toBe(true);

    // Cloud converges to a tombstone in the same public sync operation.
    const remotePhantom = cloud.remoteRow(SYNC_TABLES.WORKOUT_NOTES, PHANTOM_ID);
    expect(isTombstone(remotePhantom)).toBe(true);
    expect(remotePhantom.deleted_at).toBe(localPhantom.deleted_at);
  });

  it('repeated sync passes (restart) never resurface the provenance-stripped phantom', async () => {
    await Storage.replaceWorkoutNotesRaw([realNote()]);
    cloud.seedRemote(SYNC_TABLES.WORKOUT_NOTES, strippedPhantomRow());

    await cloudAdapter.sync();
    await cloudAdapter.sync();
    await cloudAdapter.sync();

    expect((await cloudAdapter.loadWorkoutNotes()).find((n) => n.id === PHANTOM_ID)).toBeUndefined();
    expect(isTombstone(cloud.remoteRow(SYNC_TABLES.WORKOUT_NOTES, PHANTOM_ID))).toBe(true);
  });

  it('a stale local tombstone is not resurrected by the newer live cloud row', async () => {
    // Local carries the #458 tombstone; cloud carries the buggy live resurrection
    // with a strictly newer server stamp, so LWW would otherwise revive it.
    const tombstone = {
      ...strippedPhantomRow({ source_snapshot: { async_storage_key: 'kilo_workout_note' } }),
      updated_at: '2026-05-03T00:00:00.000Z',
      deleted_at: '2026-05-03T00:00:00.000Z',
    };
    await Storage.replaceWorkoutNotesRaw([realNote(), tombstone]);
    cloud.seedRemote(SYNC_TABLES.WORKOUT_NOTES, strippedPhantomRow({ updated_at: '2026-06-20T00:00:00.000Z' }));

    await cloudAdapter.sync();
    await cloudAdapter.sync();

    expect((await cloudAdapter.loadWorkoutNotes()).find((n) => n.id === PHANTOM_ID)).toBeUndefined();
    expect(isTombstone(cloud.remoteRow(SYNC_TABLES.WORKOUT_NOTES, PHANTOM_ID))).toBe(true);
  });

  it('an "Imported sessions" note (wn_sessions_ namespace) is NOT treated as a phantom', async () => {
    // wn_sessions_<userId> is a legitimate one-time migration, not a phantom, so
    // the id-namespace guard must match wn_legacy_ only.
    const sessionsNote = {
      id: `wn_sessions_${USER_ID}`,
      title: 'Imported sessions',
      raw_text: '-Bench\n- 135 5,5,5',
      saved_at: null,
      updated_at: '2026-06-15T00:00:00.000Z',
      source_snapshot: { async_storage_key: 'kilo_workout_sessions' },
    };
    await Storage.replaceWorkoutNotesRaw([sessionsNote, realNote('wn_other_501')]);

    await cloudAdapter.sync();

    const notes = await cloudAdapter.loadWorkoutNotes();
    expect(notes.find((n) => n.id === sessionsNote.id)).toMatchObject({
      id: sessionsNote.id,
      raw_text: sessionsNote.raw_text,
    });
  });

  it('preserves a legacy-only user whose sole note is the wn_legacy_ row', async () => {
    // Even provenance-stripped, a legacy-only user's only note must survive: the
    // guard fires only when a non-phantom note co-exists.
    await Storage.replaceWorkoutNotesRaw([strippedPhantomRow()]);
    cloud.seedRemote(SYNC_TABLES.WORKOUT_NOTES, strippedPhantomRow());

    await cloudAdapter.sync();

    const notes = await cloudAdapter.loadWorkoutNotes();
    expect(notes.find((n) => n.id === PHANTOM_ID)).toBeTruthy();
    expect(isTombstone(cloud.remoteRow(SYNC_TABLES.WORKOUT_NOTES, PHANTOM_ID))).toBe(false);
  });
});

// ── Latest review finding: deload-derived workout notes must sync too ────────────
//
// completeDeload() creates a workout-note row and deleteDeloadNote() removes one.
// These previously called raw Storage.* directly, so in cloud mode they bypassed
// the adapter — never stamping sync metadata nor enqueuing a dirty record. These
// tests drive the REAL useDeloadHistory hook to prove the deload create routes
// through the dirty queue and syncs after reconnect, and the deload delete syncs
// a tombstone instead of silently removing the row locally.
describe('deload-derived workout notes sync (latest review finding)', () => {
  it('an offline deload-completed note enters the dirty queue and syncs after reconnect', async () => {
    const hook = driveHook(useDeloadHistory);
    await flushAsync(); // settle the on-mount refresh against the empty cloud

    // Stage an active deload note the way the app does before completion.
    await Storage.saveDeloadNote('squat 5x5');

    cloud.setOnline(false);
    let record;
    await TestRenderer.act(async () => {
      record = await hook.current.completeDeload({ sessionCount: 6, deloadSessionOrdinal: 1 });
    });
    expect(record).toBeTruthy();
    const noteId = record.note_id;

    // Routed through the cloud adapter: the deload-created note is in the dirty
    // queue. (A raw Storage.saveWorkoutNoteItem would have left it empty.)
    const dirty = await getDirtyRecords(SYNC_TABLES.WORKOUT_NOTES);
    expect(dirty.map((d) => d.id)).toContain(noteId);

    cloud.setOnline(true);
    await cloudAdapter.sync();
    const remote = cloud.remoteRow(SYNC_TABLES.WORKOUT_NOTES, noteId);
    expect(remote).toBeTruthy();
    expect(remote.raw_text).toBe('squat 5x5');
    expect(isTombstone(remote)).toBe(false);
  });

  it('deleting a deload note syncs a tombstone, not a silent physical removal', async () => {
    const hook = driveHook(useDeloadHistory);
    await flushAsync();

    await Storage.saveDeloadNote('squat 5x5');
    let record;
    await TestRenderer.act(async () => {
      record = await hook.current.completeDeload({ sessionCount: 6, deloadSessionOrdinal: 1 });
    });
    const noteId = record.note_id;

    // Sync the create up first so the remote has a live row to be tombstoned.
    await cloudAdapter.sync();
    expect(isTombstone(cloud.remoteRow(SYNC_TABLES.WORKOUT_NOTES, noteId))).toBe(false);

    cloud.setOnline(false);
    await TestRenderer.act(async () => {
      await hook.current.deleteDeloadNote(noteId);
    });
    // Tombstone enqueued, not a physical purge.
    expect((await getDirtyRecords(SYNC_TABLES.WORKOUT_NOTES)).map((d) => d.id)).toContain(noteId);

    cloud.setOnline(true);
    await cloudAdapter.sync();
    expect(isTombstone(cloud.remoteRow(SYNC_TABLES.WORKOUT_NOTES, noteId))).toBe(true);
  });
});

// ── issue #489: profile, toggles, weight goal, and deload history sync ─────────
//
// Before #489 these four tables were written to the cloud exactly once, by
// bootstrap, and never again: `sync()` looped over only weight_entries,
// workout_notes, and archived_weight_goals. Every later change to the current
// routine, tracked lifts, feature toggles, unit system, fatigue multiplier,
// active weight goal, or deload history was invisible to the cloud, and the
// active goal and deload history had no pull path at all.
//
// Convergence rule under test (see syncQueue.js): because these tables have no
// per-setter dirty hooks, a local change is detected by diffing live storage
// against the last-synced snapshot and is stamped at SYNC time. So the rule is
// "last write to REACH THE SERVER wins; exact updated_at ties break by
// lexicographically greater client_id" — deterministic and identical on every
// device, but not edit-time ordering.
describe('ongoing profile/toggles/goal/deload sync (issue #489)', () => {
  const SELF = SINGLETON_SYNC_ID;

  // Swap the whole device: AsyncStorage IS the device. Capturing and restoring
  // every key (including the persisted client id, cursors, dirty queues, and
  // sync snapshots) lets one test drive two genuinely independent devices
  // against one shared fake cloud.
  async function captureDevice() {
    const keys = await AsyncStorage.getAllKeys();
    return AsyncStorage.multiGet(keys);
  }

  async function restoreDevice(pairs) {
    await AsyncStorage.clear();
    resetClientIdCacheForTests();
    await AsyncStorage.multiSet(pairs);
  }

  async function cleanInstall() {
    await AsyncStorage.clear();
    resetClientIdCacheForTests();
  }

  const deloadRecord = (id, date) => ({
    id,
    date,
    raw_text: `deload ${id}`,
    saved_at: `${date}T10:00:00.000Z`,
    completed_at: `${date}T11:00:00.000Z`,
    session_count: 3,
    note_id: 'wn_1',
  });

  // Everything a user can change AFTER bootstrap that used to be stranded.
  async function seedDeviceState() {
    await Storage.saveCurrentWorkoutId('wn_1');
    await Storage.saveTrackedLifts({ Squat: true, Bench: true });
    await Storage.saveFatigueMultiplier(1.15);
    await Storage.saveUserProfile({ display_name: 'Ben', unit_system: 'lb' });
    await Storage.saveWeightDateEditEnabled(true);
    await Storage.saveDeloadModeEnabled(false);
    await Storage.saveWeightGoal({
      target_weight: 175,
      target_date: '2026-12-01',
      start_weight: 190,
      start_date: '2026-06-01',
    });
    await Storage.appendDeloadHistory(deloadRecord('dh_1', '2026-06-20'));
  }

  it('pushes post-bootstrap routine, tracked-lift, toggle, unit, multiplier, goal, and deload changes', async () => {
    await seedDeviceState();
    await cloudAdapter.sync();

    // Account settings and health values are two cloud rows since #487: the three
    // Art. 9 values (current routine, tracked lifts, fatigue multiplier) sync
    // through the consent-gated user_health_profile, not user_profile.
    const profile = cloud.remoteRow(SYNC_TABLES.USER_PROFILE, SELF);
    expect(profile.unit_system).toBe('lb');
    expect(profile.display_name).toBe('Ben');

    const health = cloud.remoteRow(SYNC_TABLES.USER_HEALTH_PROFILE, SELF);
    expect(health.current_workout_note_id).toBe('wn_1');
    expect(health.tracked_lifts).toEqual({ Squat: true, Bench: true });
    expect(health.fatigue_multiplier).toBe(1.15);

    const toggles = cloud.remoteRow(SYNC_TABLES.FEATURE_TOGGLES, SELF);
    expect(toggles.weight_date_edit_enabled).toBe(true);
    expect(toggles.deload_mode_enabled).toBe(false);
    expect(toggles.fatigue_tracking_enabled).toBe(true);

    const goal = cloud.remoteRow(SYNC_TABLES.WEIGHT_GOAL, SELF);
    expect(goal.target_weight).toBe(175);
    expect(goal.start_weight).toBe(190);

    const deload = cloud.remoteRow(SYNC_TABLES.DELOAD_HISTORY, 'dh_1');
    expect(deload.raw_text).toBe('deload dh_1');
    expect(deload.record_json).toEqual({
      completed_at: '2026-06-20T11:00:00.000Z',
      note_id: 'wn_1',
      session_count: 3,
    });
  });

  it('repairs a cloud row frozen at bootstrap on an existing device that already has real data', async () => {
    // The exact production state observed on 2026-07-13 (project ogzhnscdqcdrhfqcobuv):
    // the single user_profile row was still whatever it was at first sign-in —
    // current_workout_note_id null, tracked_lifts {}, unit_system null — while
    // weight entries had synced the same day. This is the bug #489 exists to fix.
    cloud.seedRemote(SYNC_TABLES.USER_PROFILE, {
      id: SELF,
      display_name: null,
      unit_system: null,
      current_workout_note_id: null,
      tracked_lifts: {},
      fatigue_multiplier: 1.07,
      ui_state: { log_current_collapsed: false },
      updated_at: '2026-06-01T00:00:00.000Z',
    });

    // The device, meanwhile, has the user's real state — set AFTER bootstrap ran.
    await seedDeviceState();

    // This device has never run a #489 sync, so it has no snapshot. Its real data
    // must win over the frozen cloud row rather than being overwritten by it.
    await cloudAdapter.sync();

    const repaired = cloud.remoteRow(SYNC_TABLES.USER_PROFILE, SELF);
    expect(repaired.unit_system).toBe('lb');

    const repairedHealth = cloud.remoteRow(SYNC_TABLES.USER_HEALTH_PROFILE, SELF);
    expect(repairedHealth.current_workout_note_id).toBe('wn_1');
    expect(repairedHealth.tracked_lifts).toEqual({ Squat: true, Bench: true });
    expect(repairedHealth.fatigue_multiplier).toBe(1.15);

    // And the device kept its own data: the stale cloud row did not overwrite it.
    expect(await Storage.loadCurrentWorkoutId()).toBe('wn_1');
    expect(await Storage.loadTrackedLifts()).toEqual({ Squat: true, Bench: true });
  });

  // Codex review, #489: the device stamps a local edit with its OWN clock, while
  // transport.push strips updated_at so the DB trigger assigns the authoritative
  // one. Those timestamps come from different clocks. Putting them to a vote in
  // pickWinner meant a device whose clock merely lagged the server lost: the
  // remote row won, overwrote the user's edit locally, was pushed in place of it,
  // and the edit was then cleared from the dirty queue — gone, and never retried.
  //
  // A user on a slightly slow phone would watch a setting silently revert.
  //
  // This test FAILS against 4d13ae7 and passes after the reconciliation fix.
  it('a local edit still reaches the cloud when the device clock lags the server', async () => {
    await seedDeviceState();
    await cloudAdapter.sync();

    // Another device wrote the row, and the server stamped it far ahead of
    // anything this device's clock can mint. This is ordinary clock skew, not an
    // exotic case — the server clock is simply not the device clock.
    cloud.seedRemote(SYNC_TABLES.USER_PROFILE, {
      id: SELF,
      display_name: 'Ben',
      unit_system: 'lb',
      current_workout_note_id: 'wn_1',
      tracked_lifts: { Squat: true, Bench: true },
      fatigue_multiplier: 1.15,
      ui_state: { log_current_collapsed: false },
      updated_at: '2099-01-01T00:00:00.000Z',
    });

    // The user now changes something on THIS device.
    await Storage.saveTrackedLifts({ Squat: true, Bench: true, Deadlift: true });

    await cloudAdapter.sync();

    // The edit must actually be uploaded — arrival at the server is what decides
    // the winner, not a comparison made on the client beforehand.
    expect(cloud.remoteRow(SYNC_TABLES.USER_HEALTH_PROFILE, SELF).tracked_lifts).toEqual({
      Squat: true,
      Bench: true,
      Deadlift: true,
    });

    // And it must survive locally rather than being reverted by the pulled row.
    expect(await Storage.loadTrackedLifts()).toEqual({
      Squat: true,
      Bench: true,
      Deadlift: true,
    });
  });

  it('a lagging clock does not make sync chatty: a pass with no local edit pushes nothing', async () => {
    await seedDeviceState();
    await cloudAdapter.sync();

    cloud.seedRemote(SYNC_TABLES.USER_PROFILE, {
      id: SELF,
      display_name: 'Ben',
      unit_system: 'lb',
      current_workout_note_id: 'wn_1',
      tracked_lifts: { Squat: true, Bench: true },
      fatigue_multiplier: 1.15,
      ui_state: { log_current_collapsed: false },
      updated_at: '2099-01-01T00:00:00.000Z',
    });

    // No local change this time. The push must be gated on the DIFF, not on the
    // clock — otherwise the skew fix would turn every pass into a write.
    const results = await cloudAdapter.sync();
    const profilePass = results.find((r) => r.table === SYNC_TABLES.USER_PROFILE);
    expect(profilePass.pushed).toBe(0);
  });

  it('never uploads the device-local demographics (issue #476 stays on hold)', async () => {
    await Storage.saveUserProfile({
      display_name: 'Ben',
      unit_system: 'kg',
      date_of_birth: '1990-01-01',
      sex: 'male',
      height_cm: 180,
      activity_level: 'moderate',
    });
    await cloudAdapter.sync();

    const profile = cloud.remoteRow(SYNC_TABLES.USER_PROFILE, SELF);
    expect(profile.unit_system).toBe('kg');
    expect(profile).not.toHaveProperty('date_of_birth');
    expect(profile).not.toHaveProperty('sex');
    expect(profile).not.toHaveProperty('height_cm');
    expect(profile).not.toHaveProperty('activity_level');
    expect(profile).not.toHaveProperty('profile_json');
  });

  it('a clean install pulls all four tables down from the cloud', async () => {
    await seedDeviceState();
    await cloudAdapter.sync();

    await cleanInstall();
    expect(await Storage.loadCurrentWorkoutId()).toBeNull();
    expect(await Storage.loadWeightGoal()).toBeNull();
    expect(await Storage.loadDeloadHistory()).toEqual([]);

    await cloudAdapter.sync();

    expect(await Storage.loadCurrentWorkoutId()).toBe('wn_1');
    expect(await Storage.loadTrackedLifts()).toEqual({ Squat: true, Bench: true });
    expect(await Storage.loadFatigueMultiplier()).toBe(1.15);
    expect((await Storage.loadUserProfile()).unit_system).toBe('lb');
    expect(await Storage.loadWeightDateEditEnabled()).toBe(true);
    expect(await Storage.loadDeloadModeEnabled()).toBe(false);

    const goal = await Storage.loadWeightGoal();
    expect(goal.target_weight).toBe(175);
    expect(goal.start_date).toBe('2026-06-01');

    const history = await Storage.loadDeloadHistory();
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe('dh_1');
    expect(history[0].session_count).toBe(3);
    expect(history[0].completed_at).toBe('2026-06-20T11:00:00.000Z');
  });

  it('re-running sync is a no-op: nothing is pushed and nothing changes', async () => {
    await seedDeviceState();
    await cloudAdapter.sync();

    const before = {
      profile: cloud.remoteRow(SYNC_TABLES.USER_PROFILE, SELF),
      toggles: cloud.remoteRow(SYNC_TABLES.FEATURE_TOGGLES, SELF),
      goal: cloud.remoteRow(SYNC_TABLES.WEIGHT_GOAL, SELF),
      deload: cloud.remoteRows(SYNC_TABLES.DELOAD_HISTORY),
    };

    cloud.pushes.length = 0;
    await cloudAdapter.sync();
    await cloudAdapter.sync();

    // No dirty record was manufactured by the diff, so no push happened at all.
    expect(cloud.pushes).toEqual([]);
    for (const table of [
      SYNC_TABLES.USER_PROFILE,
      SYNC_TABLES.FEATURE_TOGGLES,
      SYNC_TABLES.WEIGHT_GOAL,
      SYNC_TABLES.DELOAD_HISTORY,
    ]) {
      expect(await getDirtyRecords(table)).toEqual([]);
    }

    expect(cloud.remoteRow(SYNC_TABLES.USER_PROFILE, SELF)).toEqual(before.profile);
    expect(cloud.remoteRow(SYNC_TABLES.FEATURE_TOGGLES, SELF)).toEqual(before.toggles);
    expect(cloud.remoteRow(SYNC_TABLES.WEIGHT_GOAL, SELF)).toEqual(before.goal);
    expect(cloud.remoteRows(SYNC_TABLES.DELOAD_HISTORY)).toEqual(before.deload);

    // Local state is untouched by the extra passes.
    expect(await Storage.loadDeloadHistory()).toHaveLength(1);
    expect(await Storage.loadTrackedLifts()).toEqual({ Squat: true, Bench: true });
  });

  it('two devices editing the same settings converge: the later sync wins, and both devices agree', async () => {
    // Device A: the user's existing device.
    await seedDeviceState();
    await cloudAdapter.sync();
    const deviceA = await captureDevice();

    // Device B: clean install, signs into the same account, restores from cloud.
    await cleanInstall();
    await cloudAdapter.sync();
    expect((await Storage.loadUserProfile()).unit_system).toBe('lb');

    // B changes the unit system and the fatigue multiplier, and syncs.
    await Storage.saveUserProfile({ display_name: 'Ben', unit_system: 'kg' });
    await Storage.saveFatigueMultiplier(1.2);
    await cloudAdapter.sync();
    expect(cloud.remoteRow(SYNC_TABLES.USER_PROFILE, SELF).unit_system).toBe('kg');
    const deviceB = await captureDevice();

    // A, meanwhile, sets a different unit system and tracked lifts, and syncs
    // LAST. Under the stated rule the last write to reach the server wins.
    await restoreDevice(deviceA);
    await Storage.saveUserProfile({ display_name: 'Ben', unit_system: 'st' });
    await Storage.saveTrackedLifts({ Deadlift: true });
    await cloudAdapter.sync();

    const remote = cloud.remoteRow(SYNC_TABLES.USER_PROFILE, SELF);
    expect(remote.unit_system).toBe('st');

    const remoteHealth = cloud.remoteRow(SYNC_TABLES.USER_HEALTH_PROFILE, SELF);
    expect(remoteHealth.tracked_lifts).toEqual({ Deadlift: true });

    // LWW here is ROW-level, not field-level: tracked_lifts and fatigue_multiplier
    // share the single user_health_profile row (#487 moved them off user_profile),
    // so the winning device's whole row wins — including fields it never touched.
    // A's row still carries A's 1.15, so B's concurrent 1.2 is overwritten. This is
    // the stated rule, not an accident of ordering: a losing concurrent edit to an
    // independent field of the SAME row does not survive.
    expect(remoteHealth.fatigue_multiplier).toBe(1.15);
    expect(await Storage.loadFatigueMultiplier()).toBe(1.15);
    const settledA = await captureDevice();

    // B syncs again and converges on exactly the same state as A — no ping-pong,
    // no divergence, and a third pass changes nothing.
    await restoreDevice(deviceB);
    await cloudAdapter.sync();
    await cloudAdapter.sync();

    expect((await Storage.loadUserProfile()).unit_system).toBe('st');
    expect(await Storage.loadTrackedLifts()).toEqual({ Deadlift: true });
    expect(await Storage.loadFatigueMultiplier()).toBe(1.15);

    // Both devices report identical synced state: they have converged.
    await restoreDevice(settledA);
    await cloudAdapter.sync();
    expect((await Storage.loadUserProfile()).unit_system).toBe('st');
    expect(await Storage.loadTrackedLifts()).toEqual({ Deadlift: true });
    expect(await Storage.loadFatigueMultiplier()).toBe(1.15);
  });

  it('an exact updated_at tie on a singleton resolves to the greater client_id on every device', () => {
    const at = '2026-07-13T10:00:00.000Z';
    const a = { id: SELF, updated_at: at, client_id: 'c_aaa', unit_system: 'lb' };
    const z = { id: SELF, updated_at: at, client_id: 'c_zzz', unit_system: 'kg' };
    // Deterministic and order-independent: both devices pick the same survivor.
    expect(pickWinner(a, z)).toBe(z);
    expect(pickWinner(z, a)).toBe(z);
  });

  it('a deleted deload record does not resurrect on the next sync or on the other device', async () => {
    await seedDeviceState();
    await Storage.appendDeloadHistory(deloadRecord('dh_2', '2026-06-27'));
    await cloudAdapter.sync();
    const deviceA = await captureDevice();

    // Device B mirrors both records.
    await cleanInstall();
    await cloudAdapter.sync();
    expect((await Storage.loadDeloadHistory()).map((r) => r.id)).toEqual(['dh_1', 'dh_2']);
    const deviceB = await captureDevice();

    // A deletes one record. The next sync must push a tombstone, not silently
    // drop it (a silent drop would let the cloud copy re-download it).
    await restoreDevice(deviceA);
    await Storage.deleteDeloadHistory('dh_1');
    await cloudAdapter.sync();
    expect(isTombstone(cloud.remoteRow(SYNC_TABLES.DELOAD_HISTORY, 'dh_1'))).toBe(true);
    expect((await Storage.loadDeloadHistory()).map((r) => r.id)).toEqual(['dh_2']);

    // Re-syncing A does not bring it back.
    await cloudAdapter.sync();
    await cloudAdapter.sync();
    expect((await Storage.loadDeloadHistory()).map((r) => r.id)).toEqual(['dh_2']);

    // And B applies the delete instead of re-uploading its live copy.
    await restoreDevice(deviceB);
    await cloudAdapter.sync();
    expect((await Storage.loadDeloadHistory()).map((r) => r.id)).toEqual(['dh_2']);
    await cloudAdapter.sync();
    expect((await Storage.loadDeloadHistory()).map((r) => r.id)).toEqual(['dh_2']);
    expect(isTombstone(cloud.remoteRow(SYNC_TABLES.DELOAD_HISTORY, 'dh_1'))).toBe(true);
  });

  it('clearing the active weight goal tombstones it and clears it on the other device', async () => {
    await seedDeviceState();
    await cloudAdapter.sync();
    const deviceA = await captureDevice();

    await cleanInstall();
    await cloudAdapter.sync();
    expect(await Storage.loadWeightGoal()).toBeTruthy();
    const deviceB = await captureDevice();

    await restoreDevice(deviceA);
    await Storage.clearWeightGoal();
    await cloudAdapter.sync();
    expect(isTombstone(cloud.remoteRow(SYNC_TABLES.WEIGHT_GOAL, SELF))).toBe(true);

    await restoreDevice(deviceB);
    await cloudAdapter.sync();
    expect(await Storage.loadWeightGoal()).toBeNull();
    // Idempotent: the cleared goal is not resurrected by a second pass.
    await cloudAdapter.sync();
    expect(await Storage.loadWeightGoal()).toBeNull();

    // A new goal set afterwards revives the singleton rather than staying dead.
    await Storage.saveWeightGoal({ target_weight: 165, start_weight: 175 });
    await cloudAdapter.sync();
    const revived = cloud.remoteRow(SYNC_TABLES.WEIGHT_GOAL, SELF);
    expect(isTombstone(revived)).toBe(false);
    expect(revived.target_weight).toBe(165);
  });

  it('applying a pulled profile does not clobber unsynced local data on a device that already has some', async () => {
    // Device A publishes a profile.
    await Storage.saveUserProfile({ display_name: 'Ben', unit_system: 'kg' });
    await Storage.saveTrackedLifts({ Squat: true });
    await cloudAdapter.sync();
    const deviceA = await captureDevice();

    // Device B already has data of its own, including the device-local
    // demographics that are deliberately NOT synced (issue #476) and a deload
    // record carrying a key the cloud schema does not model.
    await cleanInstall();
    await Storage.saveUserProfile({
      display_name: 'Ben',
      unit_system: 'lb',
      date_of_birth: '1990-01-01',
      height_cm: 180,
    });
    await Storage.appendDeloadHistory({
      ...deloadRecord('dh_9', '2026-07-01'),
      local_only_field: 'keep me',
    });
    await cloudAdapter.sync();
    const deviceB = await captureDevice();

    // A now changes the unit system and syncs after B, so A wins the merge.
    await restoreDevice(deviceA);
    await Storage.saveUserProfile({ display_name: 'Ben', unit_system: 'st' });
    await cloudAdapter.sync();
    expect(cloud.remoteRow(SYNC_TABLES.USER_PROFILE, SELF).unit_system).toBe('st');

    // B (the SAME device, with its snapshot intact) pulls A's profile. The synced
    // fields update; the unsynced local ones survive. saveUserProfile would have
    // replaced the whole record and silently deleted the demographics, which is
    // why the sync path merges instead.
    await restoreDevice(deviceB);
    await cloudAdapter.sync();

    const profile = await Storage.loadUserProfile();
    expect(profile.unit_system).toBe('st');
    expect(profile.date_of_birth).toBe('1990-01-01');
    expect(profile.height_cm).toBe(180);

    // The deload record's local-only key survived the cloud round trip.
    const history = await Storage.loadDeloadHistory();
    expect(history.find((r) => r.id === 'dh_9').local_only_field).toBe('keep me');

    // And B's tracked lifts came down from A rather than being lost.
    expect(await Storage.loadTrackedLifts()).toEqual({ Squat: true });
  });

  it('a clean install that merely hydrated the cloud does not re-stamp and clobber the other device', async () => {
    // Regression guard for the diff engine's first-pass seeding rule: with no
    // snapshot, the baseline is seeded from the REMOTE rows. Without that, a
    // fresh device would treat everything it just downloaded as a brand-new
    // local edit, stamp it at `now`, and win LWW over the device that actually
    // owns the data.
    await seedDeviceState();
    await cloudAdapter.sync();
    const authored = cloud.remoteRow(SYNC_TABLES.USER_PROFILE, SELF);

    await cleanInstall();
    cloud.pushes.length = 0;
    await cloudAdapter.sync();

    // Nothing was pushed for the diff-tracked tables: the clean install had no
    // local changes, only downloads.
    const pushedTables = cloud.pushes.map((p) => p.table);
    expect(pushedTables).not.toContain(SYNC_TABLES.USER_PROFILE);
    expect(pushedTables).not.toContain(SYNC_TABLES.FEATURE_TOGGLES);
    expect(pushedTables).not.toContain(SYNC_TABLES.WEIGHT_GOAL);
    expect(pushedTables).not.toContain(SYNC_TABLES.DELOAD_HISTORY);

    // The authoring device's row is byte-for-byte intact.
    expect(cloud.remoteRow(SYNC_TABLES.USER_PROFILE, SELF)).toEqual(authored);
  });

  it('an offline change to a synced setting pushes once back online', async () => {
    await seedDeviceState();
    await cloudAdapter.sync();

    cloud.setOnline(false);
    await Storage.saveTrackedLifts({ Squat: true, Bench: true, Row: true });
    await Storage.saveFatigueTrackingEnabled(false);
    await expect(cloudAdapter.sync()).rejects.toThrow('offline');

    // The cloud still holds the pre-offline state.
    expect(cloud.remoteRow(SYNC_TABLES.USER_HEALTH_PROFILE, SELF).tracked_lifts).toEqual({
      Squat: true,
      Bench: true,
    });

    cloud.setOnline(true);
    await cloudAdapter.sync();

    expect(cloud.remoteRow(SYNC_TABLES.USER_HEALTH_PROFILE, SELF).tracked_lifts).toEqual({
      Squat: true,
      Bench: true,
      Row: true,
    });
    expect(cloud.remoteRow(SYNC_TABLES.FEATURE_TOGGLES, SELF).fatigue_tracking_enabled).toBe(
      false
    );
    // Local data survived the failed pass untouched.
    expect(await Storage.loadTrackedLifts()).toEqual({ Squat: true, Bench: true, Row: true });
  });
});

// ── issue #489: the real transport's singleton upsert contract ─────────────────
describe('real Supabase transport: singleton tables (issue #489)', () => {
  function makeClient(userId, capture) {
    const query = { gte: () => query, order: async () => ({ data: [], error: null }) };
    return {
      auth: {
        getUser: async () => ({ data: { user: { id: userId } }, error: null }),
      },
      schema: () => ({
        from: (table) => ({
          select: () => query,
          upsert: async (rows, options) => {
            capture.push({ table, rows, options });
            return { error: null };
          },
        }),
      }),
    };
  }

  it('upserts singletons on user_id, strips the synthetic id, and sends whitelisted columns only', async () => {
    const capture = [];
    getSupabaseClient.mockReturnValue(makeClient('user-489', capture));

    await Storage.saveUserProfile({
      display_name: 'Ben',
      unit_system: 'kg',
      // Device-local demographics must never reach the wire.
      date_of_birth: '1990-01-01',
    });
    await Storage.saveTrackedLifts({ Squat: true });
    await Storage.saveWeightDateEditEnabled(true);
    await Storage.saveWeightGoal({ target_weight: 170, start_weight: 185 });

    setCloudTransport(null); // force the REAL transport
    await cloudAdapter.sync();

    const byTable = new Map(capture.map((c) => [c.table, c]));

    for (const table of ['user_profile', 'user_health_profile', 'feature_toggles', 'weight_goal']) {
      const call = byTable.get(table);
      expect(call).toBeTruthy();
      // Singletons key on user_id alone. The pre-#489 hardcoded 'user_id,id'
      // could never have matched a table with no id column.
      expect(call.options).toEqual({ onConflict: 'user_id' });
      for (const row of call.rows) {
        expect(row.user_id).toBe('user-489');
        // The synthetic merge key must not reach a column that does not exist.
        expect(row).not.toHaveProperty('id');
        // Server-authoritative / local-only sync metadata is never forged.
        expect(row).not.toHaveProperty('updated_at');
        expect(row).not.toHaveProperty('client_id');
      }
    }

    const profileRow = byTable.get('user_profile').rows[0];
    expect(profileRow.unit_system).toBe('kg');
    expect(profileRow).not.toHaveProperty('date_of_birth');
    expect(profileRow).not.toHaveProperty('profile_json');
    // The Art. 9 values are NOT on this row any more (#487). Sending them here
    // would be an ungated health write, and the contract migration drops the
    // columns, so a PGRST204 would take ordinary settings sync down with it.
    expect(profileRow).not.toHaveProperty('tracked_lifts');
    expect(profileRow).not.toHaveProperty('fatigue_multiplier');
    expect(profileRow).not.toHaveProperty('current_workout_note_id');

    const healthRow = byTable.get('user_health_profile').rows[0];
    expect(healthRow.tracked_lifts).toEqual({ Squat: true });

    expect(byTable.get('weight_goal').rows[0].target_weight).toBe(170);
  });

  it('keeps collection tables on the composite (user_id, id) conflict target', async () => {
    const capture = [];
    getSupabaseClient.mockReturnValue(makeClient('user-489', capture));

    await Storage.appendDeloadHistory({
      id: 'dh_x',
      date: '2026-07-01',
      raw_text: 'deload',
      saved_at: '2026-07-01T10:00:00.000Z',
      session_count: 4,
      rogue_key: 'must not upload',
    });

    setCloudTransport(null);
    await cloudAdapter.sync();

    const call = capture.find((c) => c.table === 'deload_history');
    expect(call.options).toEqual({ onConflict: 'user_id,id' });
    expect(call.rows[0].id).toBe('dh_x');
    expect(call.rows[0].record_json).toEqual({ session_count: 4 });
    expect(call.rows[0]).not.toHaveProperty('rogue_key');
  });
});

// ── clean-device restore end-to-end (issue #499) ─────────────────────────────
//
// The production failure: a signed-in device with EMPTY local state, whose
// account already holds a full cloud dataset, ran a sync that reported success
// and restored nothing. Two defects combined — a missing pull-only restore path
// at the app seam, and the local no-op adapter reporting a false "Fully synced".
// The engine itself pulls correctly in cloud mode; this proves the whole seven-
// contract dataset restores from a production-shaped remote onto a clean device
// WITHOUT the device pushing empty rows back over the good cloud copy.
describe('clean device restores the whole account from cloud (issue #499)', () => {
  const SELF = SINGLETON_SYNC_ID;
  const T = '2026-07-14T23:34:00.000Z';

  // Seed every synced contract directly on the remote, in the shape the real
  // database serves (singleton rows keyed on user_id; the fake strips their id
  // on pull exactly as Postgres has no id column for them).
  function seedProductionAccount() {
    cloud.seedRemote(SYNC_TABLES.WEIGHT_ENTRIES, {
      id: 'we_1', entry_type: 'weigh_in', date: '2026-07-14',
      logged_at: '2026-07-14T08:00:00.000Z', weight_value: 182.4, note: null,
      saved_at: T, updated_at: T,
    });
    cloud.seedRemote(SYNC_TABLES.WEIGHT_ENTRIES, {
      id: 'we_2', entry_type: 'weigh_in', date: '2026-07-13',
      logged_at: '2026-07-13T08:00:00.000Z', weight_value: 183.0, note: 'am',
      saved_at: T, updated_at: T,
    });
    cloud.seedRemote(SYNC_TABLES.WORKOUT_NOTES, {
      id: 'wn_1', title: 'Upper A', raw_text: 'Bench 3x5\nRow 3x8',
      is_current: true, saved_at: T, updated_at: T,
    });
    cloud.seedRemote(SYNC_TABLES.ARCHIVED_WEIGHT_GOALS, {
      id: 'ag_1', target_weight: 180, target_date: '2026-05-01',
      start_weight: 195, start_date: '2026-01-01', completed_weight: 181,
      archived_at: '2026-05-02T00:00:00.000Z', goal_json: {}, saved_at: T,
      updated_at: T,
    });
    cloud.seedRemote(SYNC_TABLES.USER_PROFILE, {
      id: SELF, display_name: 'Ben', unit_system: 'lb',
      ui_state: { log_current_collapsed: true }, updated_at: T,
    });
    cloud.seedRemote(SYNC_TABLES.USER_HEALTH_PROFILE, {
      id: SELF, current_workout_note_id: 'wn_1',
      tracked_lifts: { Squat: true, Bench: true }, fatigue_multiplier: 1.15,
      updated_at: T,
    });
    cloud.seedRemote(SYNC_TABLES.FEATURE_TOGGLES, {
      id: SELF, weight_date_edit_enabled: true, deload_date_edit_enabled: false,
      fatigue_tracking_enabled: true, deload_mode_enabled: false, updated_at: T,
    });
    cloud.seedRemote(SYNC_TABLES.WEIGHT_GOAL, {
      id: SELF, target_weight: 175, target_date: '2026-12-01',
      start_weight: 190, start_date: '2026-06-01', goal_json: {}, saved_at: T,
      updated_at: T,
    });
    cloud.seedRemote(SYNC_TABLES.DELOAD_HISTORY, {
      id: 'dh_1', date: '2026-06-20', raw_text: 'deload week',
      record_json: { session_count: 3, completed_at: '2026-06-20T11:00:00.000Z' },
      saved_at: T, updated_at: T,
    });
  }

  it('pulls all seven contracts onto empty local state and pushes nothing back', async () => {
    seedProductionAccount();

    // Precondition: the device is genuinely clean — the exact state the report
    // describes (eligible remote rows exist, local data empty).
    expect(await Storage.loadWeightEntries()).toEqual([]);
    expect(await Storage.loadWorkoutNotes()).toEqual([]);
    expect(await Storage.loadWeightGoal()).toBeNull();
    expect(await Storage.loadDeloadHistory()).toEqual([]);
    expect(await Storage.loadCurrentWorkoutId()).toBeNull();

    const results = await cloudAdapter.sync();

    // Every synced contract is now visible locally, no app restart required.
    const entries = await Storage.loadWeightEntries();
    expect(entries.map((e) => e.id).sort()).toEqual(['we_1', 'we_2']);

    const notes = await Storage.loadWorkoutNotes();
    expect(notes.map((n) => n.id)).toContain('wn_1');

    const archived = await loadArchivedWeightGoalsRaw();
    expect(archived.map((g) => g.id)).toContain('ag_1');

    const profile = await Storage.loadUserProfile();
    expect(profile.display_name).toBe('Ben');
    expect(profile.unit_system).toBe('lb');

    expect(await Storage.loadCurrentWorkoutId()).toBe('wn_1');
    expect(await Storage.loadTrackedLifts()).toEqual({ Squat: true, Bench: true });
    expect(await Storage.loadFatigueMultiplier()).toBe(1.15);

    expect(await Storage.loadWeightDateEditEnabled()).toBe(true);
    expect(await Storage.loadDeloadModeEnabled()).toBe(false);

    const goal = await Storage.loadWeightGoal();
    expect(goal.target_weight).toBe(175);
    expect(goal.start_date).toBe('2026-06-01');

    const history = await Storage.loadDeloadHistory();
    expect(history.map((h) => h.id)).toContain('dh_1');
    expect(history.find((h) => h.id === 'dh_1').session_count).toBe(3);

    // The good cloud copy is untouched: a clean restore is pull-only. Nothing
    // dirty exists, so no empty-device row is ever pushed back (which would
    // clobber the account via LWW-at-now — the risk called out in #489/#499).
    expect(cloud.pushes).toEqual([]);
    for (const pass of results) {
      expect(pass.pushed).toBe(0);
    }
  });
});

// ── issue #498: fatigue-checkin projection + active-deload cross-device sync ────
//
// Two ongoing-sync gaps closed here:
//   1. kilo.fatigue_checkins is the queryable projection of the canonical
//      workout_notes.session_checkins, but nothing ever wrote it. It is now
//      derived from the converged workout-note state and maintained through the
//      ongoing sync path, one-directionally: a pulled derived row is never written
//      back into a note.
//   2. The active in-progress generated deload (kilo_workout_deload_note) synced
//      only at bootstrap, so a deload generated on device A never reached device B.
//      It now rides the consent-gated user_health_profile singleton via the three
//      current_deload_note_* columns.
describe('fatigue-checkin projection + active-deload sync (issue #498)', () => {
  const SELF = SINGLETON_SYNC_ID;
  const FATIGUE = SYNC_TABLES.FATIGUE_CHECKINS;
  const HEALTH = SYNC_TABLES.USER_HEALTH_PROFILE;

  async function captureDevice() {
    const keys = await AsyncStorage.getAllKeys();
    return AsyncStorage.multiGet(keys);
  }
  async function restoreDevice(pairs) {
    await AsyncStorage.clear();
    resetClientIdCacheForTests();
    await AsyncStorage.multiSet(pairs);
  }
  async function cleanInstall() {
    await AsyncStorage.clear();
    resetClientIdCacheForTests();
  }

  const checkin = (respondedAt, status = 'rough') => ({
    status,
    reasons: status === 'rough' ? ['fatigued'] : [],
    responded_at: respondedAt,
    note: 'hard session',
    exercises_skipped: 1,
    volume_decline_pct: 10,
    flagged: ['bench'],
    detectors: ['collapse'],
  });

  // Write a workout note carrying session_checkins into local storage and mark it
  // dirty, the way the app's own note writes reach the sync loop. Replaces the
  // note if it already exists so an "edit" is just a re-seed with new content.
  async function seedNoteWithCheckins(id, checkins) {
    const clientId = await getClientId();
    const note = stampWrite(
      {
        id,
        title: id,
        raw_text: 'Squat 3x5',
        saved_at: '2026-05-01T00:00:00.000Z',
        session_checkins: checkins,
        is_current: false,
      },
      clientId
    );
    const list = await Storage.loadWorkoutNotesRaw();
    await Storage.replaceWorkoutNotesRaw([...list.filter((n) => n.id !== id), note]);
    await enqueueDirty(SYNC_TABLES.WORKOUT_NOTES, note);
    return note;
  }

  const T0 = '2026-05-03T08:00:00.000Z';
  const T1 = '2026-05-10T08:00:00.000Z';

  // ── pure projection ────────────────────────────────────────────────────────

  it('derives one row per answered check-in with a stable id and allowlisted source_json', () => {
    const rows = deriveFatigueCheckinRows([
      {
        id: 'wn_a',
        session_checkins: {
          0: { ...checkin(T0, 'rough'), __sentinel__: 'must not leave the device' },
          1: checkin(T1, 'ok'),
          2: { status: 'ok' }, // unanswered (no responded_at) → no row
        },
      },
      { id: 'wn_b', deleted_at: '2026-05-04T00:00:00.000Z', session_checkins: { 0: checkin(T0) } },
    ]);

    // Two answered check-ins on the live note; the tombstoned note is skipped.
    expect(rows).toHaveLength(2);
    const r0 = rows.find((r) => r.id === fatigueCheckinId('wn_a', 0));
    expect(r0.workout_note_id).toBe('wn_a');
    expect(r0.session_date).toBe('2026-05-03');
    expect(r0.status).toBe('rough');
    expect(r0.reasons).toEqual(['fatigued']);
    // Explicit allowlist: no wildcard copy of an unknown check-in key.
    expect(r0.source_json).not.toHaveProperty('__sentinel__');
    expect(r0.source_json).not.toHaveProperty('status');
    expect(r0.source_json).toMatchObject({ responded_at: T0, note: 'hard session' });
  });

  // ── projection sync ──────────────────────────────────────────────────────

  it('projects a fatigue_checkins row to the cloud from a note check-in', async () => {
    await seedNoteWithCheckins('wn_f1', { 0: checkin(T0) });
    await cloudAdapter.sync();

    const row = cloud.remoteRow(FATIGUE, fatigueCheckinId('wn_f1', 0));
    expect(row).toBeTruthy();
    expect(row.workout_note_id).toBe('wn_f1');
    expect(row.session_date).toBe('2026-05-03');
    expect(row.status).toBe('rough');
    expect(row.reasons).toEqual(['fatigued']);
  });

  it('re-syncing the projection is idempotent: no duplicate rows, no re-push', async () => {
    await seedNoteWithCheckins('wn_f1', { 0: checkin(T0) });
    await cloudAdapter.sync();

    cloud.pushes.length = 0;
    await cloudAdapter.sync();
    await cloudAdapter.sync();

    expect(cloud.pushes.filter((p) => p.table === FATIGUE)).toEqual([]);
    expect(cloud.remoteRows(FATIGUE)).toHaveLength(1);
  });

  it('editing a check-in updates the derived row in place (stable id, no duplicate)', async () => {
    await seedNoteWithCheckins('wn_f1', { 0: checkin(T0, 'ok') });
    await cloudAdapter.sync();

    await seedNoteWithCheckins('wn_f1', { 0: checkin(T0, 'rough') });
    await cloudAdapter.sync();

    const rows = cloud.remoteRows(FATIGUE).filter((r) => !isTombstone(r));
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(fatigueCheckinId('wn_f1', 0));
    expect(rows[0].status).toBe('rough');
  });

  it('removing a check-in tombstones its derived row without resurrection', async () => {
    await seedNoteWithCheckins('wn_f1', { 0: checkin(T0), 1: checkin(T1) });
    await cloudAdapter.sync();
    expect(cloud.remoteRows(FATIGUE).filter((r) => !isTombstone(r))).toHaveLength(2);

    // Drop session index 1.
    await seedNoteWithCheckins('wn_f1', { 0: checkin(T0) });
    await cloudAdapter.sync();

    const gone = cloud.remoteRow(FATIGUE, fatigueCheckinId('wn_f1', 1));
    expect(isTombstone(gone)).toBe(true);
    expect(isTombstone(cloud.remoteRow(FATIGUE, fatigueCheckinId('wn_f1', 0)))).toBe(false);

    // Idempotent: repeated passes do not resurrect the removed row.
    await cloudAdapter.sync();
    await cloudAdapter.sync();
    expect(isTombstone(cloud.remoteRow(FATIGUE, fatigueCheckinId('wn_f1', 1)))).toBe(true);
  });

  it('deleting the source note tombstones its derived fatigue rows', async () => {
    await seedNoteWithCheckins('wn_f1', { 0: checkin(T0) });
    await cloudAdapter.sync();
    expect(isTombstone(cloud.remoteRow(FATIGUE, fatigueCheckinId('wn_f1', 0)))).toBe(false);

    // Delete the note the way the sync loop carries a delete: a tombstone row.
    const clientId = await getClientId();
    const list = await Storage.loadWorkoutNotesRaw();
    const tomb = stampTombstone(
      list.find((n) => n.id === 'wn_f1'),
      clientId
    );
    await Storage.replaceWorkoutNotesRaw(list.map((n) => (n.id === 'wn_f1' ? tomb : n)));
    await enqueueDirty(SYNC_TABLES.WORKOUT_NOTES, tomb);
    await cloudAdapter.sync();

    expect(isTombstone(cloud.remoteRow(FATIGUE, fatigueCheckinId('wn_f1', 0)))).toBe(true);
  });

  it('a pulled derived fatigue row never mutates the canonical session_checkins', async () => {
    await seedNoteWithCheckins('wn_f1', { 0: checkin(T0, 'rough') });
    await cloudAdapter.sync();

    // A tampered remote fatigue row claims a different status/date. Nothing about
    // it may leak back into the note's canonical session_checkins.
    cloud.seedRemote(FATIGUE, {
      id: fatigueCheckinId('wn_f1', 0),
      workout_note_id: 'wn_f1',
      session_date: '1999-01-01',
      status: 'ok',
      reasons: [],
      source_json: null,
      updated_at: '2099-01-01T00:00:00.000Z',
    });
    await cloudAdapter.sync();

    const note = (await Storage.loadWorkoutNotesRaw()).find((n) => n.id === 'wn_f1');
    expect(note.session_checkins['0'].status).toBe('rough');
    expect(note.session_checkins['0'].responded_at).toBe(T0);
  });

  it('two devices converge on the same projection; the second derives, it does not re-push', async () => {
    await seedNoteWithCheckins('wn_f1', { 0: checkin(T0, 'rough') });
    await cloudAdapter.sync();

    // Device B: clean install pulls the note, derives the identical row, and has
    // nothing new to push for the projection.
    await cleanInstall();
    cloud.pushes.length = 0;
    await cloudAdapter.sync();

    expect(cloud.remoteRow(FATIGUE, fatigueCheckinId('wn_f1', 0)).status).toBe('rough');
    expect(cloud.pushes.filter((p) => p.table === FATIGUE)).toEqual([]);
  });

  it('a failed projection push is retried on the next sync, not lost', async () => {
    await seedNoteWithCheckins('wn_f1', { 0: checkin(T0) });

    let failFatigue = true;
    setCloudTransport({
      pull: (t, c) => cloud.transport.pull(t, c),
      push: async (t, records) => {
        if (t === FATIGUE && failFatigue) {
          failFatigue = false;
          throw new Error('boom fatigue');
        }
        return cloud.transport.push(t, records);
      },
    });

    await expect(cloudAdapter.sync()).rejects.toThrow('boom fatigue');
    expect(cloud.remoteRow(FATIGUE, fatigueCheckinId('wn_f1', 0))).toBeUndefined();
    expect((await getDirtyRecords(FATIGUE)).length).toBeGreaterThan(0);

    await cloudAdapter.sync();
    expect(cloud.remoteRow(FATIGUE, fatigueCheckinId('wn_f1', 0)).workout_note_id).toBe('wn_f1');
    expect(await getDirtyRecords(FATIGUE)).toEqual([]);
  });

  // ── active deload ─────────────────────────────────────────────────────────

  it('a generated active deload on device A appears as the active deload on device B', async () => {
    await Storage.saveDeloadNote('deload week 1');
    await cloudAdapter.sync();
    expect(cloud.remoteRow(HEALTH, SELF).current_deload_note_raw_text).toBe('deload week 1');

    await cleanInstall();
    await cloudAdapter.sync();

    const note = await Storage.loadDeloadNote();
    expect(note.raw_text).toBe('deload week 1');
  });

  it('editing the active deload converges across devices with no ping-pong', async () => {
    await Storage.saveDeloadNote('v1');
    await cloudAdapter.sync();
    const deviceA = await captureDevice();

    await cleanInstall();
    await cloudAdapter.sync();
    expect((await Storage.loadDeloadNote()).raw_text).toBe('v1');
    const deviceB = await captureDevice();

    // A edits and syncs last.
    await restoreDevice(deviceA);
    await Storage.saveDeloadNote('v2');
    await cloudAdapter.sync();
    expect(cloud.remoteRow(HEALTH, SELF).current_deload_note_raw_text).toBe('v2');

    // B pulls v2, applies it verbatim, and does NOT push it back — no ping-pong.
    await restoreDevice(deviceB);
    cloud.pushes.length = 0;
    await cloudAdapter.sync();
    await cloudAdapter.sync();
    expect((await Storage.loadDeloadNote()).raw_text).toBe('v2');
    expect(cloud.pushes.filter((p) => p.table === HEALTH)).toEqual([]);
  });

  it('clearing the active deload converges across devices without resurrection', async () => {
    await Storage.saveDeloadNote('to be cleared');
    await cloudAdapter.sync();
    const deviceA = await captureDevice();

    await cleanInstall();
    await cloudAdapter.sync();
    expect(await Storage.loadDeloadNote()).toBeTruthy();
    const deviceB = await captureDevice();

    await restoreDevice(deviceA);
    await Storage.clearDeloadNote();
    await cloudAdapter.sync();
    expect(cloud.remoteRow(HEALTH, SELF).current_deload_note_raw_text).toBeNull();

    await restoreDevice(deviceB);
    await cloudAdapter.sync();
    expect(await Storage.loadDeloadNote()).toBeNull();
    await cloudAdapter.sync();
    expect(await Storage.loadDeloadNote()).toBeNull();
  });

  it('active-deload sync does not overwrite current routine, tracked lifts, or fatigue multiplier', async () => {
    await Storage.saveCurrentWorkoutId('wn_x');
    await Storage.saveTrackedLifts({ Squat: true });
    await Storage.saveFatigueMultiplier(1.2);
    await Storage.saveDeloadNote('deload A');
    await cloudAdapter.sync();

    const health = cloud.remoteRow(HEALTH, SELF);
    expect(health.current_workout_note_id).toBe('wn_x');
    expect(health.tracked_lifts).toEqual({ Squat: true });
    expect(health.fatigue_multiplier).toBe(1.2);
    expect(health.current_deload_note_raw_text).toBe('deload A');

    // Device B restores every health field together, then edits ONLY the deload.
    await cleanInstall();
    await cloudAdapter.sync();
    expect(await Storage.loadCurrentWorkoutId()).toBe('wn_x');
    expect(await Storage.loadTrackedLifts()).toEqual({ Squat: true });
    expect(await Storage.loadFatigueMultiplier()).toBe(1.2);
    expect((await Storage.loadDeloadNote()).raw_text).toBe('deload A');

    await Storage.saveDeloadNote('deload B2');
    await cloudAdapter.sync();

    // The deload change did not null out the sibling health fields on the row.
    const after = cloud.remoteRow(HEALTH, SELF);
    expect(after.current_deload_note_raw_text).toBe('deload B2');
    expect(after.current_workout_note_id).toBe('wn_x');
    expect(after.tracked_lifts).toEqual({ Squat: true });
    expect(after.fatigue_multiplier).toBe(1.2);
  });

  it('a failed user_health_profile push carrying an active deload is retried, not lost', async () => {
    await Storage.saveDeloadNote('retry me');

    let failHealth = true;
    setCloudTransport({
      pull: (t, c) => cloud.transport.pull(t, c),
      push: async (t, records) => {
        if (t === HEALTH && failHealth) {
          failHealth = false;
          throw new Error('boom health');
        }
        return cloud.transport.push(t, records);
      },
    });

    await expect(cloudAdapter.sync()).rejects.toThrow('boom health');
    expect(cloud.remoteRow(HEALTH, SELF)).toBeUndefined();
    expect((await getDirtyRecords(HEALTH)).length).toBeGreaterThan(0);

    await cloudAdapter.sync();
    expect(cloud.remoteRow(HEALTH, SELF).current_deload_note_raw_text).toBe('retry me');
    expect((await Storage.loadDeloadNote()).raw_text).toBe('retry me');
  });
});

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
} from '../storage/syncQueue';

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
function makeFakeCloud() {
  const tables = {
    [SYNC_TABLES.WEIGHT_ENTRIES]: new Map(),
    [SYNC_TABLES.WORKOUT_NOTES]: new Map(),
    [SYNC_TABLES.ARCHIVED_WEIGHT_GOALS]: new Map(),
  };
  const state = { online: true };

  const transport = {
    async pull(table, cursor) {
      if (!state.online) throw new Error('offline');
      const rows = [...tables[table].values()];
      // Inclusive cursor (`>=`) mirrors the real transport so an exact-timestamp
      // LWW tie at the boundary is still pulled. Idempotent merge makes the
      // re-pull safe.
      const changed = cursor ? rows.filter((r) => (r.updated_at || '') >= cursor) : rows;
      return changed.sort((a, b) => (a.updated_at || '').localeCompare(b.updated_at || ''));
    },
    async push(table, records) {
      if (!state.online) throw new Error('offline');
      for (const rec of records) {
        // Server-side LWW guard: a stale push must not clobber a newer remote.
        const existing = tables[table].get(rec.id);
        tables[table].set(rec.id, existing ? pickWinner(existing, rec) : rec);
      }
    },
  };

  return {
    transport,
    state,
    remoteRow: (table, id) => tables[table].get(id),
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
    expect(remote.client_id).toBeTruthy();
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

  it('pulls an exact-timestamp tie at the cursor boundary and converges to the winning client_id', async () => {
    // Create + sync so this device's cursor advances to the row's updated_at.
    await cloudAdapter.saveWeightEntry(weightEntry('w1', 180));
    await cloudAdapter.sync();

    const cursor = await getCursor(SYNC_TABLES.WEIGHT_ENTRIES);
    expect(cursor).toBeTruthy();

    // Another device wrote a row at EXACTLY the cursor timestamp with a winning
    // (lexicographically greater) client_id. An exclusive `>` cursor would skip
    // this forever; an inclusive `>=` re-pulls the boundary and LWW resolves it.
    cloud.seedRemote(SYNC_TABLES.WEIGHT_ENTRIES, {
      ...weightEntry('w1', 199),
      updated_at: cursor,
      client_id: 'zzzz-winning-device',
    });

    await cloudAdapter.sync();
    const local = await cloudAdapter.loadWeightEntries();
    expect(local.find((e) => e.id === 'w1').weight_value).toBe(199);
    expect(local.find((e) => e.id === 'w1').client_id).toBe('zzzz-winning-device');
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
    await Storage.replaceWorkoutNotesRaw([realNote()]);

    // Cloud has the old phantom row from a pre-#443 or edge-case bootstrap.
    cloud.seedRemote(SYNC_TABLES.WORKOUT_NOTES, phantomRow());

    await cloudAdapter.sync();

    // Phantom must not appear as a live note after sync.
    const notes = await cloudAdapter.loadWorkoutNotes();
    expect(notes.find((n) => n.id === PHANTOM_ID)).toBeUndefined();
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

  it('preserves the phantom for a legacy-only user who has no non-phantom notes', async () => {
    // Legacy user: ONLY the phantom note exists (bootstrapped from kilo_workout_note).
    await Storage.replaceWorkoutNotesRaw([phantomRow()]);
    cloud.seedRemote(SYNC_TABLES.WORKOUT_NOTES, phantomRow());

    await cloudAdapter.sync();

    // Legacy user's only note must not be deleted.
    const notes = await cloudAdapter.loadWorkoutNotes();
    expect(notes.find((n) => n.id === PHANTOM_ID)).toBeTruthy();
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
    expect(notes.find((n) => n.id === 'wn_user_routine_1')).toBeTruthy();
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

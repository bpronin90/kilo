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
  SINGLETON_SYNC_ID,
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
      if (!SINGLETON_TABLES.has(table)) return sorted;
      return sorted.map(({ id, ...row }) => row); // eslint-disable-line no-unused-vars
    },
    async push(table, records) {
      if (!state.online) throw new Error('offline');
      pushes.push({ table, ids: records.map((r) => r.id) });
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
      deleted_at: localPhantom.deleted_at,
      updated_at: localPhantom.updated_at,
    });
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

    const profile = cloud.remoteRow(SYNC_TABLES.USER_PROFILE, SELF);
    expect(profile.current_workout_note_id).toBe('wn_1');
    expect(profile.tracked_lifts).toEqual({ Squat: true, Bench: true });
    expect(profile.unit_system).toBe('lb');
    expect(profile.display_name).toBe('Ben');
    expect(profile.fatigue_multiplier).toBe(1.15);

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
    expect(repaired.current_workout_note_id).toBe('wn_1');
    expect(repaired.tracked_lifts).toEqual({ Squat: true, Bench: true });
    expect(repaired.unit_system).toBe('lb');
    expect(repaired.fatigue_multiplier).toBe(1.15);

    // And the device kept its own data: the stale cloud row did not overwrite it.
    expect(await Storage.loadCurrentWorkoutId()).toBe('wn_1');
    expect(await Storage.loadTrackedLifts()).toEqual({ Squat: true, Bench: true });
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
    expect(remote.tracked_lifts).toEqual({ Deadlift: true });

    // LWW here is ROW-level, not field-level: user_profile is a single cloud row,
    // so the winning device's whole row wins — including fields it never touched.
    // A's row still carries A's 1.15, so B's concurrent 1.2 is overwritten. This
    // is the stated rule, not an accident of ordering: a losing concurrent edit
    // to an independent field of the SAME row does not survive.
    expect(remote.fatigue_multiplier).toBe(1.15);
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
    expect(cloud.remoteRow(SYNC_TABLES.USER_PROFILE, SELF).tracked_lifts).toEqual({
      Squat: true,
      Bench: true,
    });

    cloud.setOnline(true);
    await cloudAdapter.sync();

    expect(cloud.remoteRow(SYNC_TABLES.USER_PROFILE, SELF).tracked_lifts).toEqual({
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

    for (const table of ['user_profile', 'feature_toggles', 'weight_goal']) {
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
    expect(profileRow.tracked_lifts).toEqual({ Squat: true });
    expect(profileRow).not.toHaveProperty('date_of_birth');
    expect(profileRow).not.toHaveProperty('profile_json');

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

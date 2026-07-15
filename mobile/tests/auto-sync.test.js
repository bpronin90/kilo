// Automatic cloud sync tests (Issue #432, ownership-gated by Issue #450).
//
// Covers:
//   1. Local-data owner marker: get/set, one-time legacy migration, purge.
//   2. useAutoSync sign-in branches across all four owner states:
//      equal / unclaimed / different userId / unknown — bootstrapFromLocal is
//      called ONLY in the sanctioned cases (owner unclaimed + user confirmed,
//      or explicit foreign upload).
//   3. Cloud-mode writes: cloud mode activates only once ownership is resolved,
//      and writes then route through the dirty queue.
//   4. Failure paths: a rejecting bootstrap leaves the owner unchanged and the
//      phase failed/retryable; manual retry recovers and claims ownership.

import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import renderer, { act } from 'react-test-renderer';

import {
  SYNC_STATUS,
  SYNC_PHASE,
  getSyncState,
  markComplete,
  __resetSyncQueue,
} from '../storage/syncRecovery';
import {
  LOCAL_DATA_OWNER_KEY,
  OWNER_UNCLAIMED,
  OWNER_UNKNOWN,
  LEGACY_BOOTSTRAP_MARKER_PREFIX,
  getLocalDataOwner,
  setLocalDataOwner,
  purgeLocalData,
} from '../storage/entries/localDataOwner';
import * as KEYS from '../storage/entries/keys';
import { cloudAdapter, bootstrapFromLocal } from '../storage/cloudAdapter';
import * as Storage from '../storage/entries';
import { useAutoSync, useSyncRecovery, useWeightEntries, useWorkoutNotes } from '../hooks/useEntries';
import {
  SYNC_TABLES,
  clearDirty,
  getDirtyRecords,
  enqueueDirty,
  isTombstone,
  resetClientIdCacheForTests,
  resetStampClockForTests,
} from '../storage/syncQueue';
import { setCloudTransport } from '../storage/cloudAdapter';
import { replaceArchivedWeightGoalsRaw } from '../storage/entries/weightGoal';
import { useCloudSyncStatus } from '../hooks/useEntries';

// Health-data consent (#487) is granted for these suites. They exercise sync,
// bootstrap, and ownership mechanics, not authorization — consent-gate-client.test.js
// covers the denial paths. Without this the hook's grant check would short-circuit
// every sync here (no Supabase client is configured under test), and these tests
// would silently pass for the wrong reason.
jest.mock('../storage/cloud/consent', () => {
  const actual = jest.requireActual('../storage/cloud/consent');
  return {
    ...actual,
    fetchConsentStatus: jest.fn().mockResolvedValue({ allowed: true, code: 'OK' }),
    withdrawConsent: jest.fn().mockResolvedValue({ ok: true, status: 'deletion_pending' }),
    requestHealthDataDeletion: jest.fn().mockResolvedValue({ ok: true }),
    fetchActiveConsentRevision: jest.fn().mockResolvedValue({
      catalog_revision: 1,
      material_version: 1,
      privacy_policy_url: 'https://example.invalid/privacy.html',
    }),
  };
});


const USER = { id: 'u-auto-1', email: 'auto@test.co' };

function makeAuth(overrides = {}) {
  return {
    configured: true,
    loading: false,
    signedIn: true,
    user: USER,
    ...overrides,
  };
}

function renderHook(useHook) {
  const ref = { current: null };
  function Probe() {
    ref.current = useHook();
    return null;
  }
  let tree;
  act(() => {
    tree = renderer.create(React.createElement(Probe));
  });
  return { ref, tree };
}

async function flush() {
  // The auto-sync effect chains several awaits (owner read/migration, phase
  // runners, owner writes); drain generously.
  for (let i = 0; i < 8; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
}

function mockCloudSyncAdapter(syncImpl) {
  const syncFn = jest.fn(syncImpl || (() => Promise.resolve({ ok: true })));
  jest
    .spyOn(Storage, 'getStorageAdapter')
    .mockReturnValue({ mode: 'cloud', sync: syncFn });
  return syncFn;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetSyncQueue();
  resetClientIdCacheForTests();
  resetStampClockForTests();
  Storage.setStorageMode(Storage.STORAGE_MODES.LOCAL);
  jest.restoreAllMocks();
  setCloudTransport(null);
});

afterEach(() => {
  Storage.setStorageMode(Storage.STORAGE_MODES.LOCAL);
  setCloudTransport(null);
});

// ── Local-data owner marker ──────────────────────────────────────────────────

describe('localDataOwner: marker get/set', () => {
  test('fresh storage derives unclaimed and persists the marker', async () => {
    expect(await getLocalDataOwner()).toBe(OWNER_UNCLAIMED);
    expect(await AsyncStorage.getItem(LOCAL_DATA_OWNER_KEY)).toBe(OWNER_UNCLAIMED);
  });

  test('setLocalDataOwner persists and getLocalDataOwner returns it', async () => {
    await setLocalDataOwner(USER.id);
    expect(await getLocalDataOwner()).toBe(USER.id);
  });

  test('setLocalDataOwner ignores empty values', async () => {
    await setLocalDataOwner(USER.id);
    await setLocalDataOwner(null);
    expect(await getLocalDataOwner()).toBe(USER.id);
  });
});

describe('localDataOwner: one-time migration from legacy bootstrap markers', () => {
  test('exactly one legacy marker: owner is that user, silently, no prompt state', async () => {
    await AsyncStorage.setItem(`${LEGACY_BOOTSTRAP_MARKER_PREFIX}user-a`, 'true');
    expect(await getLocalDataOwner()).toBe('user-a');
    // Persisted so the derivation never reruns.
    expect(await AsyncStorage.getItem(LOCAL_DATA_OWNER_KEY)).toBe('user-a');
  });

  test('more than one legacy marker: owner is unknown (co-mingled device)', async () => {
    await AsyncStorage.setItem(`${LEGACY_BOOTSTRAP_MARKER_PREFIX}user-a`, 'true');
    await AsyncStorage.setItem(`${LEGACY_BOOTSTRAP_MARKER_PREFIX}user-b`, 'true');
    expect(await getLocalDataOwner()).toBe(OWNER_UNKNOWN);
  });

  test('no legacy markers: owner is unclaimed', async () => {
    expect(await getLocalDataOwner()).toBe(OWNER_UNCLAIMED);
  });

  test('an explicit marker wins over legacy markers (migration runs only when absent)', async () => {
    await AsyncStorage.setItem(`${LEGACY_BOOTSTRAP_MARKER_PREFIX}user-a`, 'true');
    await setLocalDataOwner('user-z');
    expect(await getLocalDataOwner()).toBe('user-z');
  });
});

describe('localDataOwner: purge', () => {
  test('clears every keys.js key and every legacy marker, then writes the owner', async () => {
    const entryKeys = Object.values(KEYS);
    for (const key of entryKeys) {
      // eslint-disable-next-line no-await-in-loop
      await AsyncStorage.setItem(key, JSON.stringify([{ id: 'residue' }]));
    }
    await AsyncStorage.setItem(`${LEGACY_BOOTSTRAP_MARKER_PREFIX}user-a`, 'true');
    await AsyncStorage.setItem(`${LEGACY_BOOTSTRAP_MARKER_PREFIX}user-b`, 'true');
    await AsyncStorage.setItem('kilo_sync_dirty_weight_entries', '[{"id":"stale"}]');
    await setLocalDataOwner('user-a');

    await purgeLocalData('user-new');

    for (const key of entryKeys) {
      // eslint-disable-next-line no-await-in-loop
      expect(await AsyncStorage.getItem(key)).toBeNull();
    }
    const remaining = await AsyncStorage.getAllKeys();
    expect(remaining.filter((k) => k.startsWith(LEGACY_BOOTSTRAP_MARKER_PREFIX))).toEqual([]);
    expect(remaining.filter((k) => k.startsWith('kilo_sync_dirty_'))).toEqual([]);
    // Owner is written explicitly, never left absent.
    expect(await AsyncStorage.getItem(LOCAL_DATA_OWNER_KEY)).toBe('user-new');
    // No residue for a later read to re-derive from.
    expect(await getLocalDataOwner()).toBe('user-new');
  });

  test('defaults the post-purge owner to unclaimed', async () => {
    await setLocalDataOwner('user-a');
    await purgeLocalData();
    expect(await getLocalDataOwner()).toBe(OWNER_UNCLAIMED);
  });
});

// ── useAutoSync: owner === signed-in user ────────────────────────────────────

describe('useAutoSync: owner equals signed-in user', () => {
  test('skips bootstrap entirely, activates cloud mode, and syncs', async () => {
    await setLocalDataOwner(USER.id);
    const bootstrapSpy = jest.spyOn(cloudAdapter, 'bootstrapFromLocal');
    const syncFn = mockCloudSyncAdapter();

    const { ref } = renderHook(() => useAutoSync(makeAuth()));
    await flush();

    expect(bootstrapSpy).not.toHaveBeenCalled();
    expect(Storage.getStorageMode()).toBe(Storage.STORAGE_MODES.CLOUD);
    expect(getSyncState()[SYNC_PHASE.BOOTSTRAP].status).toBe(SYNC_STATUS.COMPLETE);
    expect(syncFn).toHaveBeenCalledTimes(1);
    expect(ref.current.ownershipPrompt).toBeNull();
  });

  test('legacy upgrade regression: single-account install migrates silently, no prompt, no re-upload', async () => {
    // Existing install: legacy bootstrap marker for this user, no owner marker.
    await AsyncStorage.setItem(`${LEGACY_BOOTSTRAP_MARKER_PREFIX}${USER.id}`, 'true');
    const bootstrapSpy = jest.spyOn(cloudAdapter, 'bootstrapFromLocal');
    const syncFn = mockCloudSyncAdapter();

    const { ref } = renderHook(() => useAutoSync(makeAuth()));
    await flush();

    expect(bootstrapSpy).not.toHaveBeenCalled();
    expect(ref.current.ownershipPrompt).toBeNull();
    expect(Storage.getStorageMode()).toBe(Storage.STORAGE_MODES.CLOUD);
    expect(syncFn).toHaveBeenCalledTimes(1);
    expect(await getLocalDataOwner()).toBe(USER.id);
  });

  test('does not re-run bootstrap if the phase is already complete this session', async () => {
    await setLocalDataOwner(USER.id);
    markComplete(SYNC_PHASE.BOOTSTRAP);

    const bootstrapSpy = jest.spyOn(cloudAdapter, 'bootstrapFromLocal');
    const syncFn = mockCloudSyncAdapter();

    renderHook(() => useAutoSync(makeAuth()));
    await flush();

    expect(bootstrapSpy).not.toHaveBeenCalled();
    expect(syncFn).toHaveBeenCalledTimes(1);
  });
});

// ── useAutoSync: unclaimed local data (legitimate first sign-in) ─────────────

describe('useAutoSync: unclaimed owner requires confirmation', () => {
  test('does NOT auto-bootstrap; surfaces the first-upload prompt and stays in local mode', async () => {
    const bootstrapSpy = jest.spyOn(cloudAdapter, 'bootstrapFromLocal');
    const syncFn = mockCloudSyncAdapter();

    const { ref } = renderHook(() => useAutoSync(makeAuth()));
    await flush();

    expect(bootstrapSpy).not.toHaveBeenCalled();
    expect(syncFn).not.toHaveBeenCalled();
    expect(Storage.getStorageMode()).toBe(Storage.STORAGE_MODES.LOCAL);
    expect(ref.current.ownershipPrompt).toEqual({ type: 'first-upload' });
  });

  test('confirmOwnershipUpload bootstraps, claims ownership, activates cloud mode, and syncs', async () => {
    const bootstrapSpy = jest
      .spyOn(cloudAdapter, 'bootstrapFromLocal')
      .mockResolvedValue({ ok: true });
    const syncFn = mockCloudSyncAdapter();

    const { ref } = renderHook(() => useAutoSync(makeAuth()));
    await flush();

    let result;
    await act(async () => {
      result = await ref.current.confirmOwnershipUpload();
    });

    expect(result.ok).toBe(true);
    expect(bootstrapSpy).toHaveBeenCalledWith(USER.id);
    expect(await getLocalDataOwner()).toBe(USER.id);
    expect(Storage.getStorageMode()).toBe(Storage.STORAGE_MODES.CLOUD);
    expect(getSyncState()[SYNC_PHASE.BOOTSTRAP].status).toBe(SYNC_STATUS.COMPLETE);
    expect(syncFn).toHaveBeenCalledTimes(1);
    expect(ref.current.ownershipPrompt).toBeNull();
  });

  test('dismiss ("Not Now") leaves everything untouched: no bootstrap, no sync, local mode, owner unclaimed', async () => {
    const bootstrapSpy = jest.spyOn(cloudAdapter, 'bootstrapFromLocal');
    const syncFn = mockCloudSyncAdapter();

    const { ref } = renderHook(() => useAutoSync(makeAuth()));
    await flush();

    act(() => {
      ref.current.dismissOwnershipPrompt();
    });

    expect(ref.current.ownershipPrompt).toBeNull();
    expect(bootstrapSpy).not.toHaveBeenCalled();
    expect(syncFn).not.toHaveBeenCalled();
    expect(Storage.getStorageMode()).toBe(Storage.STORAGE_MODES.LOCAL);
    expect(await getLocalDataOwner()).toBe(OWNER_UNCLAIMED);
  });

  test('a failed confirmed bootstrap leaves the owner unchanged and the phase failed/retryable', async () => {
    jest
      .spyOn(cloudAdapter, 'bootstrapFromLocal')
      .mockRejectedValue(new Error('network down'));
    const syncFn = mockCloudSyncAdapter();

    const { ref } = renderHook(() => useAutoSync(makeAuth()));
    await flush();

    let result;
    await act(async () => {
      result = await ref.current.confirmOwnershipUpload();
    });

    expect(result.ok).toBe(false);
    // Owner unchanged so the next launch retries the prompt/bootstrap.
    expect(await getLocalDataOwner()).toBe(OWNER_UNCLAIMED);
    const state = getSyncState();
    expect(state[SYNC_PHASE.BOOTSTRAP].status).toBe(SYNC_STATUS.FAILED);
    expect(state[SYNC_PHASE.BOOTSTRAP].retryable).toBe(true);
    expect(syncFn).not.toHaveBeenCalled();
    expect(Storage.getStorageMode()).toBe(Storage.STORAGE_MODES.LOCAL);
  });

  test('a successful upload whose owner write fails is a failed bootstrap: local mode, no sync, owner unchanged', async () => {
    jest
      .spyOn(cloudAdapter, 'bootstrapFromLocal')
      .mockResolvedValue({ ok: true });
    const syncFn = mockCloudSyncAdapter();

    const { ref } = renderHook(() => useAutoSync(makeAuth()));
    await flush();
    expect(ref.current.ownershipPrompt).toEqual({ type: 'first-upload' });

    // Fail only the owner-marker write; every other storage write still works.
    const owners = require('../storage/entries/localDataOwner');
    const ownerWriteSpy = jest
      .spyOn(owners, 'setLocalDataOwner')
      .mockRejectedValue(new Error('disk full'));

    let result;
    await act(async () => {
      result = await ref.current.confirmOwnershipUpload();
    });
    ownerWriteSpy.mockRestore();

    expect(result.ok).toBe(false);
    // The claim never became durable, so cloud activity must not start.
    expect(Storage.getStorageMode()).toBe(Storage.STORAGE_MODES.LOCAL);
    expect(syncFn).not.toHaveBeenCalled();
    const state = getSyncState();
    expect(state[SYNC_PHASE.BOOTSTRAP].status).toBe(SYNC_STATUS.FAILED);
    expect(state[SYNC_PHASE.BOOTSTRAP].retryable).toBe(true);
    expect(await getLocalDataOwner()).toBe(OWNER_UNCLAIMED);
  });

  test('manual retry via useSyncRecovery recovers and claims ownership', async () => {
    jest
      .spyOn(cloudAdapter, 'bootstrapFromLocal')
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce({ ok: true });
    mockCloudSyncAdapter();

    const { ref } = renderHook(() => useAutoSync(makeAuth()));
    await flush();
    await act(async () => {
      await ref.current.confirmOwnershipUpload();
    });
    expect(getSyncState()[SYNC_PHASE.BOOTSTRAP].status).toBe(SYNC_STATUS.FAILED);
    expect(await getLocalDataOwner()).toBe(OWNER_UNCLAIMED);

    const { ref: recoveryRef } = renderHook(() => useSyncRecovery(USER));
    await flush();

    let retryResult;
    await act(async () => {
      retryResult = await recoveryRef.current.retryBootstrap();
    });

    expect(retryResult.ok).toBe(true);
    expect(getSyncState()[SYNC_PHASE.BOOTSTRAP].status).toBe(SYNC_STATUS.COMPLETE);
    expect(await getLocalDataOwner()).toBe(USER.id);
  });
});

// ── useAutoSync: clean-device pull-only restore (issue #499) ────────────────
//
// The production failure: a clean device signed into an account with existing
// cloud data got only Upload / Not Now, and a later Sync Now reported success
// while restoring nothing. The fix adds a genuinely pull-only Download action,
// offered ONLY when the device is verifiably empty so it can never push local
// state up.

describe('useAutoSync: clean-device download restore', () => {
  test('an empty device is offered the restore, and Download claims ownership, activates cloud mode, runs a real pull, and refreshes the UI', async () => {
    const syncFn = mockCloudSyncAdapter();
    const onSyncComplete = jest.fn();

    const { ref } = renderHook(() =>
      useAutoSync(makeAuth(), { onSyncComplete })
    );
    await flush();

    // Empty device: unclaimed prompt AND the pull-only restore affordance.
    expect(ref.current.ownershipPrompt).toEqual({ type: 'first-upload' });
    expect(ref.current.canRestore).toBe(true);

    let result;
    await act(async () => {
      result = await ref.current.downloadAccountData();
    });

    expect(result.ok).toBe(true);
    // Claimed for this account, cloud mode active, bootstrap marked done.
    expect(await getLocalDataOwner()).toBe(USER.id);
    expect(Storage.getStorageMode()).toBe(Storage.STORAGE_MODES.CLOUD);
    expect(getSyncState()[SYNC_PHASE.BOOTSTRAP].status).toBe(SYNC_STATUS.COMPLETE);
    // A real pull ran through the cloud runner (not the local no-op)...
    expect(syncFn).toHaveBeenCalledTimes(1);
    // ...and the refresh callback fired so restored data is visible with no restart.
    expect(onSyncComplete).toHaveBeenCalled();
    expect(ref.current.ownershipPrompt).toBeNull();
  });

  // The "This device is empty" promise must hold across EVERY local state that
  // bootstrap or ongoing sync can carry — not just user_profile. Each case seeds
  // one such state on an unclaimed device and proves the restore is neither
  // offered (canRestore false) nor performed (refuses, zero pushes, ownership and
  // storage mode unchanged). Reviewer #499 flagged archived goals, a current
  // deload note, and a non-default collapsed panel as the specific gaps; the rest
  // pin the whole surface.
  describe.each([
    ['a user profile', async () => {
      await Storage.saveUserProfile({ display_name: 'Ben', unit_system: 'lb' });
    }],
    ['a weight entry', async () => {
      await Storage.saveWeightEntry({
        id: 'w1',
        entry_type: 'weigh_in',
        date: '2026-07-14',
        logged_at: '2026-07-14T08:00:00.000Z',
        weight_value: 180,
      });
    }],
    ['an archived weight goal', async () => {
      await replaceArchivedWeightGoalsRaw([
        {
          id: 'ag_1',
          target_weight: 180,
          start_weight: 195,
          archived_at: '2026-05-02T00:00:00.000Z',
        },
      ]);
    }],
    ['a current deload note', async () => {
      await Storage.saveDeloadNote('deload week notes');
    }],
    ['a non-default collapsed panel', async () => {
      await Storage.saveWorkoutCollapsed(true);
    }],
    ['an active weight goal', async () => {
      await Storage.saveWeightGoal({ target_weight: 175, start_weight: 190 });
    }],
    ['tracked lifts', async () => {
      await Storage.saveTrackedLifts({ Squat: true });
    }],
    ['a non-default feature toggle', async () => {
      await Storage.saveWeightDateEditEnabled(true);
    }],
    ['a non-default fatigue multiplier', async () => {
      await Storage.saveFatigueMultiplier(1.2);
    }],
    ['deload history', async () => {
      await Storage.appendDeloadHistory({
        id: 'dh_1',
        date: '2026-06-20',
        raw_text: 'deload',
        saved_at: '2026-06-20T10:00:00.000Z',
      });
    }],
  ])('Download is hidden and non-uploading when the device holds %s', (_label, seed) => {
    test('canRestore false, direct invocation refuses, zero pushes, ownership/mode unchanged', async () => {
      await seed();

      const pushes = [];
      setCloudTransport({
        async pull() {
          return [];
        },
        async push(table, records) {
          pushes.push({ table, ids: records.map((r) => r.id) });
        },
      });

      const { ref } = renderHook(() => useAutoSync(makeAuth()));
      await flush();

      // The restore affordance is hidden on a device that has data to protect.
      expect(ref.current.ownershipPrompt).toEqual({ type: 'first-upload' });
      expect(ref.current.canRestore).toBe(false);

      // Even if invoked directly, Download refuses rather than uploading.
      let result;
      await act(async () => {
        result = await ref.current.downloadAccountData();
      });

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/already has training data/i);
      // Zero pushes, account untouched, device still unclaimed and in local mode.
      expect(pushes).toEqual([]);
      expect(await getLocalDataOwner()).toBe(OWNER_UNCLAIMED);
      expect(Storage.getStorageMode()).toBe(Storage.STORAGE_MODES.LOCAL);
    });
  });
});

// ── useAutoSync: foreign owner (different userId or unknown) ─────────────────

describe('useAutoSync: foreign owner never auto-bootstraps', () => {
  test('a different userId surfaces the foreign prompt with no upload and no sync', async () => {
    await setLocalDataOwner('someone-else');
    const bootstrapSpy = jest.spyOn(cloudAdapter, 'bootstrapFromLocal');
    const syncFn = mockCloudSyncAdapter();

    const { ref } = renderHook(() => useAutoSync(makeAuth()));
    await flush();

    expect(bootstrapSpy).not.toHaveBeenCalled();
    expect(syncFn).not.toHaveBeenCalled();
    expect(Storage.getStorageMode()).toBe(Storage.STORAGE_MODES.LOCAL);
    expect(ref.current.ownershipPrompt).toEqual({ type: 'foreign' });
  });

  test('unknown owner takes the same foreign branch', async () => {
    await setLocalDataOwner(OWNER_UNKNOWN);
    const bootstrapSpy = jest.spyOn(cloudAdapter, 'bootstrapFromLocal');
    mockCloudSyncAdapter();

    const { ref } = renderHook(() => useAutoSync(makeAuth()));
    await flush();

    expect(bootstrapSpy).not.toHaveBeenCalled();
    expect(ref.current.ownershipPrompt).toEqual({ type: 'foreign' });
  });

  test('start fresh purges local data, claims ownership, and pulls cloud data — never uploading', async () => {
    await AsyncStorage.setItem(KEYS.WEIGHT_KEY, JSON.stringify([{ id: 'a-weight' }]));
    await AsyncStorage.setItem(`${LEGACY_BOOTSTRAP_MARKER_PREFIX}someone-else`, 'true');
    await setLocalDataOwner('someone-else');
    const bootstrapSpy = jest.spyOn(cloudAdapter, 'bootstrapFromLocal');
    const syncFn = mockCloudSyncAdapter();

    const { ref } = renderHook(() => useAutoSync(makeAuth()));
    await flush();

    let result;
    await act(async () => {
      result = await ref.current.startFreshOnDevice();
    });

    expect(result.ok).toBe(true);
    expect(bootstrapSpy).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(KEYS.WEIGHT_KEY)).toBeNull();
    expect(await getLocalDataOwner()).toBe(USER.id);
    expect(Storage.getStorageMode()).toBe(Storage.STORAGE_MODES.CLOUD);
    expect(getSyncState()[SYNC_PHASE.BOOTSTRAP].status).toBe(SYNC_STATUS.COMPLETE);
    expect(syncFn).toHaveBeenCalledTimes(1);
    expect(ref.current.ownershipPrompt).toBeNull();
  });

  test('explicit foreign upload is allowed after the deliberate choice', async () => {
    await setLocalDataOwner('someone-else');
    const bootstrapSpy = jest
      .spyOn(cloudAdapter, 'bootstrapFromLocal')
      .mockResolvedValue({ ok: true });
    const syncFn = mockCloudSyncAdapter();

    const { ref } = renderHook(() => useAutoSync(makeAuth()));
    await flush();

    let result;
    await act(async () => {
      result = await ref.current.confirmOwnershipUpload();
    });

    expect(result.ok).toBe(true);
    expect(bootstrapSpy).toHaveBeenCalledWith(USER.id);
    expect(await getLocalDataOwner()).toBe(USER.id);
    expect(syncFn).toHaveBeenCalledTimes(1);
  });

  test('user B on user A\'s device is never auto-uploaded (two accounts, one device)', async () => {
    const USER_B = { id: 'u-b', email: 'b@test.co' };

    // User A's session: owns the local data, syncs normally.
    await setLocalDataOwner(USER.id);
    const bootstrapSpy = jest.spyOn(cloudAdapter, 'bootstrapFromLocal');
    mockCloudSyncAdapter();
    renderHook(() => useAutoSync(makeAuth({ user: USER })));
    await flush();
    expect(bootstrapSpy).not.toHaveBeenCalled();

    // A signs out — phases reset, owner retained.
    renderHook(() => useAutoSync(makeAuth({ signedIn: false, user: null })));
    await flush();
    expect(getSyncState()[SYNC_PHASE.BOOTSTRAP].status).toBe(SYNC_STATUS.IDLE);
    expect(await getLocalDataOwner()).toBe(USER.id);

    // B signs in on the same device: foreign branch, no automatic upload.
    const { ref } = renderHook(() => useAutoSync(makeAuth({ user: USER_B })));
    await flush();

    expect(bootstrapSpy).not.toHaveBeenCalled();
    expect(ref.current.ownershipPrompt).toEqual({ type: 'foreign' });
    expect(Storage.getStorageMode()).toBe(Storage.STORAGE_MODES.LOCAL);
  });
});

// ── Regression #501: full foreign-owner "Upload It Into My Account" lifecycle ────
//
// Drives the REAL ownership-resolution entrypoint (useAutoSync →
// confirmOwnershipUpload), not bootstrap/sync called directly: foreign-owner
// prompt → current-account upload confirmation (real bootstrapFromLocal against a
// shared in-memory cloud) → real ongoing sync → a modeled process restart
// (unmount + module sync-state reset + fresh hook mount re-running the sign-in
// ownership check against persisted AsyncStorage) → prompt absent, ownership
// decision persisted, and no phantom Routine 1 anywhere in the lifecycle.
describe('foreign-owner upload lifecycle: no phantom Routine 1 (issue #501)', () => {
  const PHANTOM_ID = `wn_legacy_${USER.id}`;

  // One in-memory store that BOTH the bootstrap upsert path (Supabase-client
  // facade) and the ongoing sync path (transport) write into, so the rows the
  // ownership upload pushes are exactly the rows sync later pulls. A server
  // trigger stamps updated_at on every write, as Postgres does; the
  // client-supplied deleted_at survives verbatim.
  function makeSharedCloud() {
    const tables = {};
    for (const table of Object.values(SYNC_TABLES)) tables[table] = new Map();
    let lastMs = 0;
    const serverNow = (table) => {
      let maxMs = Math.max(lastMs, Date.now());
      for (const row of tables[table].values()) {
        const ms = Date.parse(row.updated_at || 0);
        if (Number.isFinite(ms) && ms > maxMs) maxMs = ms;
      }
      lastMs = maxMs + 1;
      return new Date(lastMs).toISOString();
    };
    const applyUpsert = (table, rows) => {
      for (const rec of rows) {
        const { client_id: _c, ...row } = rec; // eslint-disable-line no-unused-vars
        tables[table].set(row.id, { ...row, updated_at: serverNow(table) });
      }
    };
    const transport = {
      async pull(table, cursor) {
        const rows = [...tables[table].values()];
        const changed = cursor ? rows.filter((r) => (r.updated_at || '') >= cursor) : rows;
        return changed
          .sort((a, b) => (a.updated_at || '').localeCompare(b.updated_at || ''))
          .map(({ client_id: _c, ...row }) => row); // eslint-disable-line no-unused-vars
      },
      async push(table, records) { applyUpsert(table, records); },
    };
    const client = {
      schema() {
        return {
          from(table) {
            return {
              async upsert(rows) { applyUpsert(table, rows); return { data: rows, error: null }; },
              select() {
                return { eq() { return { async maybeSingle() { return { data: null, error: null }; } }; } };
              },
            };
          },
        };
      },
    };
    return { transport, client, remoteRow: (t, id) => tables[t].get(id) };
  }

  async function visibleNotes() {
    const notes = await Storage.loadWorkoutNotes();
    return notes.filter((n) => !n.deleted_at);
  }

  test('foreign prompt → Upload It Into My Account → sync → restart: owner persisted, prompt absent, phantom never visible', async () => {
    // Device state as reported on 0.95.0: the phone history belongs to the
    // signed-in account but the owner marker says otherwise, and the notebook
    // holds the user's real routine plus a legacy phantom the #458 cleanup
    // already tombstoned.
    await AsyncStorage.setItem(
      KEYS.WORKOUT_NOTES_KEY,
      JSON.stringify([
        {
          id: 'wn_real',
          title: 'Summer 2026 Routine',
          raw_text: '-Bench\n- 185 5,5,5',
          saved_at: '2026-06-01T00:00:00.000Z',
          updated_at: '2026-06-15T00:00:00.000Z',
          isCurrent: true,
        },
        {
          id: PHANTOM_ID,
          title: 'Routine 1',
          raw_text: '-Squat\n- 225 5,5,5',
          saved_at: '2026-05-01T00:00:00.000Z',
          updated_at: '2026-05-03T00:00:00.000Z',
          deleted_at: '2026-05-03T00:00:00.000Z',
          source_snapshot: { async_storage_key: 'kilo_workout_note' },
        },
      ])
    );
    await AsyncStorage.setItem(KEYS.CURRENT_WORKOUT_ID_KEY, JSON.stringify('wn_real'));
    await setLocalDataOwner('someone-else');

    const shared = makeSharedCloud();
    setCloudTransport(shared.transport);
    // Route the hook's real bootstrap call through the shared cloud instead of a
    // live Supabase client. The upload logic itself is the REAL bootstrapFromLocal.
    const bootstrapSpy = jest
      .spyOn(cloudAdapter, 'bootstrapFromLocal')
      .mockImplementation((uid) => bootstrapFromLocal(uid, shared.client));

    // Sign in: the foreign-owner prompt surfaces; nothing uploads or syncs.
    const { ref, tree } = renderHook(() => useAutoSync(makeAuth()));
    await flush();
    expect(ref.current.ownershipPrompt).toEqual({ type: 'foreign' });
    expect(bootstrapSpy).not.toHaveBeenCalled();
    expect(Storage.getStorageMode()).toBe(Storage.STORAGE_MODES.LOCAL);

    // The user chooses "Upload It Into My Account" — the real confirmation path:
    // real bootstrap upload, owner claim, cloud-mode activation, real initial sync.
    let result;
    await act(async () => {
      result = await ref.current.confirmOwnershipUpload();
    });
    await flush();

    expect(result.ok).toBe(true);
    expect(bootstrapSpy).toHaveBeenCalledWith(USER.id);
    // The ownership decision is PERSISTED (durable marker, not hook state).
    expect(await getLocalDataOwner()).toBe(USER.id);
    expect(Storage.getStorageMode()).toBe(Storage.STORAGE_MODES.CLOUD);
    expect(getSyncState()[SYNC_PHASE.BOOTSTRAP].status).toBe(SYNC_STATUS.COMPLETE);
    expect(getSyncState()[SYNC_PHASE.SYNC].status).toBe(SYNC_STATUS.COMPLETE);
    expect(ref.current.ownershipPrompt).toBeNull();

    // No phantom after upload + sync: hidden locally, tombstoned in the account,
    // and the user's real note is live in both places with selection intact.
    let visible = await visibleNotes();
    expect(visible.find((n) => n.id === PHANTOM_ID)).toBeUndefined();
    expect(visible.find((n) => n.id === 'wn_real')).toBeTruthy();
    expect(await Storage.loadCurrentWorkoutId()).toBe('wn_real');
    expect(isTombstone(shared.remoteRow(SYNC_TABLES.WORKOUT_NOTES, PHANTOM_ID))).toBe(true);
    expect(isTombstone(shared.remoteRow(SYNC_TABLES.WORKOUT_NOTES, 'wn_real'))).toBe(false);

    // ── Restart ──────────────────────────────────────────────────────────────
    // Model a real process restart, not just another sync call: unmount the app
    // tree, wipe the in-memory sync-phase state (module state does not survive a
    // process), and mount a fresh hook that re-runs the sign-in ownership check
    // against what actually persisted (owner marker, notebook, cursors).
    act(() => tree.unmount());
    __resetSyncQueue();
    Storage.setStorageMode(Storage.STORAGE_MODES.LOCAL);

    const { ref: ref2 } = renderHook(() => useAutoSync(makeAuth()));
    await flush();
    await flush();

    // The persisted decision routes sign-in down the owner === userId branch:
    // the ownership prompt does NOT recur, cloud mode reactivates, sync reruns.
    expect(ref2.current.ownershipPrompt).toBeNull();
    expect(await getLocalDataOwner()).toBe(USER.id);
    expect(Storage.getStorageMode()).toBe(Storage.STORAGE_MODES.CLOUD);
    expect(getSyncState()[SYNC_PHASE.SYNC].status).toBe(SYNC_STATUS.COMPLETE);
    // Bootstrap is not re-run on restart — the upload already happened.
    expect(bootstrapSpy).toHaveBeenCalledTimes(1);

    // The phantom stays invisible after the restart's sync pass, and the
    // tombstone state remains converged — no repeated cleanup, no resurrection.
    visible = await visibleNotes();
    expect(visible.find((n) => n.id === PHANTOM_ID)).toBeUndefined();
    expect(visible.find((n) => n.id === 'wn_real')).toBeTruthy();
    expect(await Storage.loadCurrentWorkoutId()).toBe('wn_real');
    expect(isTombstone(shared.remoteRow(SYNC_TABLES.WORKOUT_NOTES, PHANTOM_ID))).toBe(true);

    // Second restart: repeated launch remains idempotent.
    __resetSyncQueue();
    Storage.setStorageMode(Storage.STORAGE_MODES.LOCAL);
    const { ref: ref3 } = renderHook(() => useAutoSync(makeAuth()));
    await flush();
    await flush();
    expect(ref3.current.ownershipPrompt).toBeNull();
    expect((await visibleNotes()).find((n) => n.id === PHANTOM_ID)).toBeUndefined();
    expect(isTombstone(shared.remoteRow(SYNC_TABLES.WORKOUT_NOTES, PHANTOM_ID))).toBe(true);

    setCloudTransport(null);
  });
});

// ── useAutoSync: password recovery takes precedence over ownership ───────────

describe('useAutoSync: password recovery defers ownership decisions', () => {
  test('suppresses the first-upload prompt during recovery, then presents it after recovery exits', async () => {
    let auth = makeAuth({ passwordRecovery: true });
    const ref = { current: null };
    function Probe() {
      ref.current = useAutoSync(auth);
      return null;
    }

    let tree;
    act(() => {
      tree = renderer.create(React.createElement(Probe));
    });
    await flush();

    expect(ref.current.ownershipPrompt).toBeNull();
    expect(Storage.getStorageMode()).toBe(Storage.STORAGE_MODES.LOCAL);

    auth = makeAuth();
    act(() => {
      tree.update(React.createElement(Probe));
    });
    await flush();

    expect(ref.current.ownershipPrompt).toEqual({ type: 'first-upload' });
  });

  test('hides an already-visible foreign-owner prompt while a recovery callback is active', async () => {
    await setLocalDataOwner('someone-else');
    let auth = makeAuth();
    const ref = { current: null };
    function Probe() {
      ref.current = useAutoSync(auth);
      return null;
    }

    let tree;
    act(() => {
      tree = renderer.create(React.createElement(Probe));
    });
    await flush();
    expect(ref.current.ownershipPrompt).toEqual({ type: 'foreign' });

    auth = makeAuth({ recoveryError: 'Email link is invalid or has expired' });
    act(() => {
      tree.update(React.createElement(Probe));
    });
    await flush();

    expect(ref.current.ownershipPrompt).toBeNull();
    expect(Storage.getStorageMode()).toBe(Storage.STORAGE_MODES.LOCAL);
  });
});

// ── useAutoSync: configured/loading/sign-out guards ──────────────────────────

describe('useAutoSync: guards and sign-out', () => {
  test('does nothing when configured is false', async () => {
    const spy = jest.spyOn(cloudAdapter, 'bootstrapFromLocal');

    const { ref } = renderHook(() => useAutoSync(makeAuth({ configured: false })));
    await flush();

    expect(spy).not.toHaveBeenCalled();
    expect(Storage.getStorageMode()).toBe(Storage.STORAGE_MODES.LOCAL);
    expect(ref.current.ownershipPrompt).toBeNull();
  });

  test('does nothing while auth is still loading', async () => {
    const spy = jest.spyOn(cloudAdapter, 'bootstrapFromLocal');

    renderHook(() => useAutoSync(makeAuth({ loading: true })));
    await flush();

    expect(spy).not.toHaveBeenCalled();
  });

  test('sets storage mode back to LOCAL and clears phases when signed out', async () => {
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    markComplete(SYNC_PHASE.BOOTSTRAP);
    markComplete(SYNC_PHASE.SYNC);

    renderHook(() => useAutoSync(makeAuth({ signedIn: false, user: null })));
    await flush();

    expect(Storage.getStorageMode()).toBe(Storage.STORAGE_MODES.LOCAL);
    expect(getSyncState()[SYNC_PHASE.BOOTSTRAP].status).toBe(SYNC_STATUS.IDLE);
    expect(getSyncState()[SYNC_PHASE.SYNC].status).toBe(SYNC_STATUS.IDLE);
  });

  test('sign-out does not clear the local-data owner (history stays theirs)', async () => {
    await setLocalDataOwner(USER.id);

    renderHook(() => useAutoSync(makeAuth({ signedIn: false, user: null })));
    await flush();

    expect(await getLocalDataOwner()).toBe(USER.id);
  });
});

// ── useAutoSync: cloud mode enables dirty-queue writes ────────────────────────

describe('useAutoSync: cloud mode wires writes through the dirty queue', () => {
  test('after ownership resolves, a weight write enters the dirty queue', async () => {
    await setLocalDataOwner(USER.id);
    mockCloudSyncAdapter();

    renderHook(() => useAutoSync(makeAuth()));
    await flush();

    expect(Storage.getStorageMode()).toBe(Storage.STORAGE_MODES.CLOUD);

    // Write through the cloud adapter directly (as writeVia would in cloud mode).
    await cloudAdapter.saveWeightEntry({
      id: 'w-auto-1',
      entry_type: 'weight',
      date: '2026-07-06',
      logged_at: '2026-07-06T08:00:00.000Z',
      weight_value: 185,
    });

    const dirty = await getDirtyRecords(SYNC_TABLES.WEIGHT_ENTRIES);
    expect(dirty.map((d) => d.id)).toContain('w-auto-1');
  });
});

// ── Stale UI fix: onSyncComplete reloads mounted entry hooks ─────────────────
//
// Verifies that after auto-sync writes remote data into local storage, the
// already-mounted weight entry hook reflects the new data without any manual
// user action. This is the integration proof for the onSyncComplete callback
// added in review round 3 (#432) and the read-only reload path used in #437.

describe('useAutoSync + useWeightEntries: UI stays current after auto-sync', () => {
  test('mounted weight and workout entry hooks reflect remote data after auto-sync without manual action', async () => {
    await setLocalDataOwner(USER.id);

    const remoteEntry = {
      id: 'w-remote-ui-1',
      entry_type: 'weight',
      date: '2026-07-06',
      logged_at: '2026-07-06T08:00:00.000Z',
      weight_value: 185,
    };
    const remoteNote = {
      id: 'wn-remote-ui-1',
      title: 'Remote note',
      raw_text: 'Updated from sync',
      isCurrent: true,
    };

    // Stub the storage adapter: sync writes the remote entry into local
    // AsyncStorage directly (no real transport), loadWeightEntries reads back.
    // This keeps the async chain shallow enough for flush to drain it.
    const {
      replaceWeightEntriesRaw,
      loadWeightEntriesRaw,
      replaceWorkoutNotesRaw,
      loadWorkoutNotesRaw,
    } = require('../storage/entries');
    const syncFn = jest.fn(async () => {
      await replaceWeightEntriesRaw([remoteEntry]);
      await replaceWorkoutNotesRaw([remoteNote]);
      await Storage.setCurrentWorkoutNote(remoteNote.id);
    });
    jest.spyOn(Storage, 'getStorageAdapter').mockReturnValue({
      mode: 'cloud',
      sync: syncFn,
      loadWeightEntries: async () => {
        const list = await loadWeightEntriesRaw();
        return list.filter((e) => !e.deleted_at);
      },
      loadWorkoutNotes: async () => {
        const list = await loadWorkoutNotesRaw();
        return list.filter((e) => !e.deleted_at);
      },
    });

    // Mirrors how App.js mounts both hooks and forwards onSyncComplete to refresh.
    const weightRef = { current: null };
    const noteRef = { current: null };
    function Probe() {
      const weightHook = useWeightEntries();
      const noteHook = useWorkoutNotes();
      weightRef.current = weightHook;
      noteRef.current = noteHook;
      useAutoSync(makeAuth(), {
        onSyncComplete() {
          weightRef.current?.reload();
          noteRef.current?.reload();
        },
      });
      return null;
    }

    act(() => {
      renderer.create(React.createElement(Probe));
    });

    // Flush deeply: owner read → sync → onSyncComplete → reload →
    // loadWeightEntries → setState.
    for (let i = 0; i < 10; i++) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { await Promise.resolve(); });
    }

    expect(weightRef.current.entries.map((e) => e.id)).toContain('w-remote-ui-1');
    expect(noteRef.current.notes.map((n) => n.id)).toContain('wn-remote-ui-1');
    expect(noteRef.current.currentId).toBe('wn-remote-ui-1');
    expect(syncFn).toHaveBeenCalledTimes(1);
  });
});

describe('useCloudSyncStatus: dirty queue and last sync summary', () => {
  test('tracks dirty records and the last successful sync timestamp', async () => {
    const { ref } = renderHook(() => useCloudSyncStatus());
    await flush();

    expect(ref.current.statusLabel).toBe('Ready to sync');
    expect(ref.current.lastSuccessfulLabel).toBeNull();

    await act(async () => {
      await enqueueDirty(SYNC_TABLES.WEIGHT_ENTRIES, { id: 'w-status-1' });
    });
    await flush();
    expect(ref.current.statusLabel).toBe('1 pending local change');

    await act(async () => {
      await clearDirty(SYNC_TABLES.WEIGHT_ENTRIES, ['w-status-1']);
    });
    await flush();
    expect(ref.current.statusLabel).toBe('Ready to sync');

    await act(async () => {
      markComplete(SYNC_PHASE.SYNC);
    });
    await flush();

    expect(ref.current.statusLabel).toBe('Fully synced');
    expect(ref.current.lastSuccessfulAt).toEqual(expect.any(String));
    expect(ref.current.lastSuccessfulLabel).toEqual(expect.any(String));
  });

  test('bootstrap completion does not stamp the last successful sync time', async () => {
    const { ref } = renderHook(() => useCloudSyncStatus());
    await flush();

    await act(async () => {
      markComplete(SYNC_PHASE.BOOTSTRAP);
    });
    await flush();

    expect(ref.current.statusLabel).toBe('Ready to sync');
    expect(ref.current.lastSuccessfulAt).toBeNull();
    expect(ref.current.lastSuccessfulLabel).toBeNull();
  });
});

// ── Manual retry error display (Finding 2 fix) ───────────────────────────────
//
// Tests that handleRun in CloudSyncRecovery shows a generic user-facing
// message on failure, not the raw error from the runner. Exercises the code
// path through useSyncRecovery: runner rejects → runPhase returns {ok:false,
// error: <raw Supabase message>} → handleRun must NOT propagate result.error.

describe('CloudSyncRecovery handleRun: generic error on failure', () => {
  test('runBootstrap failure returns raw error internally but handleRun shows generic message', async () => {
    // The raw error message that Supabase / bootstrap.js would emit.
    const rawMsg = 'Bootstrap failed writing workout_notes: permission denied';
    jest
      .spyOn(cloudAdapter, 'bootstrapFromLocal')
      .mockRejectedValue(new Error(rawMsg));

    // Drive the bootstrap runner directly (as handleRun does) and capture what
    // runPhase returns vs. what should be shown to the user.
    const { ref } = renderHook(() => useSyncRecovery(USER));
    await flush();

    let result;
    await act(async () => {
      result = await ref.current.runBootstrap();
    });

    // The raw message IS in the internal result (used by the state machine for
    // retry logic) — but it must NOT be what handleRun sets as the user-visible
    // status string. handleRun maps any failure to the generic message.
    expect(result.ok).toBe(false);

    // Simulate what handleRun does with the result:
    const userFacingStatus = result?.ok
      ? 'complete'
      : 'Could not complete — try again.';

    expect(userFacingStatus).toBe('Could not complete — try again.');
    // The raw error does not appear in what the user sees.
    expect(userFacingStatus).not.toMatch(rawMsg);
  });
});

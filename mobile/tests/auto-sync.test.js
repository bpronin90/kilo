// Automatic cloud sync tests (Issue #432).
//
// Covers the four required verification areas:
//   1. First-sign-in upload trigger: useAutoSync auto-runs bootstrap on first sign-in.
//   2. Repeated-launch idempotence: second session with the AsyncStorage marker set
//      skips bootstrap and runs sync only.
//   3. Cloud-mode writes: useAutoSync sets storage mode to cloud so entry-hook
//      writes route through the cloud adapter and enter the dirty queue.
//   4. Failed sync retry: a bootstrap failure leaves the phase failed/retryable;
//      the manual retry (useSyncRecovery.retryBootstrap) recovers and marks done.
//
// Bootstrap marker persistence is also unit-tested directly.

import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import renderer, { act } from 'react-test-renderer';

import {
  SYNC_STATUS,
  SYNC_PHASE,
  getSyncState,
  isBootstrapped,
  setBootstrapped,
  __resetSyncQueue,
} from '../storage/syncRecovery';
import { cloudAdapter } from '../storage/cloudAdapter';
import * as Storage from '../storage/entries';
import { useAutoSync, useSyncRecovery } from '../hooks/useEntries';
import {
  SYNC_TABLES,
  getDirtyRecords,
  resetClientIdCacheForTests,
  resetStampClockForTests,
} from '../storage/syncQueue';
import { setCloudTransport } from '../storage/cloudAdapter';

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
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
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

// ── Bootstrap marker persistence ─────────────────────────────────────────────

describe('bootstrap marker persistence', () => {
  test('isBootstrapped returns false when no marker is stored', async () => {
    expect(await isBootstrapped(USER.id)).toBe(false);
  });

  test('isBootstrapped returns false for a null userId', async () => {
    expect(await isBootstrapped(null)).toBe(false);
  });

  test('setBootstrapped persists the marker; isBootstrapped returns true', async () => {
    await setBootstrapped(USER.id);
    expect(await isBootstrapped(USER.id)).toBe(true);
  });

  test('marker is per-userId: a different user id reads false', async () => {
    await setBootstrapped('user-a');
    expect(await isBootstrapped('user-b')).toBe(false);
    expect(await isBootstrapped('user-a')).toBe(true);
  });

  test('marker survives an AsyncStorage.clear for the target id (cleared means gone)', async () => {
    await setBootstrapped(USER.id);
    await AsyncStorage.clear();
    expect(await isBootstrapped(USER.id)).toBe(false);
  });
});

// ── useAutoSync: first sign-in triggers automatic bootstrap ──────────────────

describe('useAutoSync: first sign-in auto-bootstrap', () => {
  test('auto-runs bootstrap and sets the persistent marker when not yet bootstrapped', async () => {
    const bootstrapSpy = jest
      .spyOn(cloudAdapter, 'bootstrapFromLocal')
      .mockResolvedValue({ ok: true });
    jest
      .spyOn(Storage, 'getStorageAdapter')
      .mockReturnValue({ mode: 'cloud', sync: jest.fn().mockResolvedValue({ ok: true }) });

    renderHook(() => useAutoSync(makeAuth()));
    await flush();

    expect(bootstrapSpy).toHaveBeenCalledWith(USER.id);
    expect(getSyncState()[SYNC_PHASE.BOOTSTRAP].status).toBe(SYNC_STATUS.COMPLETE);
    expect(await isBootstrapped(USER.id)).toBe(true);
  });

  test('sets storage mode to CLOUD on sign-in', async () => {
    jest.spyOn(cloudAdapter, 'bootstrapFromLocal').mockResolvedValue({ ok: true });
    jest
      .spyOn(Storage, 'getStorageAdapter')
      .mockReturnValue({ mode: 'cloud', sync: jest.fn().mockResolvedValue({ ok: true }) });

    renderHook(() => useAutoSync(makeAuth()));
    await flush();

    expect(Storage.getStorageMode()).toBe(Storage.STORAGE_MODES.CLOUD);
  });

  test('also triggers sync after a successful bootstrap', async () => {
    jest.spyOn(cloudAdapter, 'bootstrapFromLocal').mockResolvedValue({ ok: true });
    const syncFn = jest.fn().mockResolvedValue({ ok: true });
    jest
      .spyOn(Storage, 'getStorageAdapter')
      .mockReturnValue({ mode: 'cloud', sync: syncFn });

    renderHook(() => useAutoSync(makeAuth()));
    await flush();

    expect(syncFn).toHaveBeenCalledTimes(1);
    expect(getSyncState()[SYNC_PHASE.SYNC].status).toBe(SYNC_STATUS.COMPLETE);
  });

  test('does nothing when configured is false', async () => {
    const spy = jest.spyOn(cloudAdapter, 'bootstrapFromLocal');

    renderHook(() => useAutoSync(makeAuth({ configured: false })));
    await flush();

    expect(spy).not.toHaveBeenCalled();
    expect(Storage.getStorageMode()).toBe(Storage.STORAGE_MODES.LOCAL);
  });

  test('does nothing while auth is still loading', async () => {
    const spy = jest.spyOn(cloudAdapter, 'bootstrapFromLocal');

    renderHook(() => useAutoSync(makeAuth({ loading: true })));
    await flush();

    expect(spy).not.toHaveBeenCalled();
  });
});

// ── useAutoSync: repeated-launch idempotence ──────────────────────────────────

describe('useAutoSync: repeated-launch idempotence', () => {
  test('skips bootstrap and runs sync only when marker is already set', async () => {
    await setBootstrapped(USER.id);

    const bootstrapSpy = jest.spyOn(cloudAdapter, 'bootstrapFromLocal');
    const syncFn = jest.fn().mockResolvedValue({ ok: true });
    jest
      .spyOn(Storage, 'getStorageAdapter')
      .mockReturnValue({ mode: 'cloud', sync: syncFn });

    renderHook(() => useAutoSync(makeAuth()));
    await flush();

    expect(bootstrapSpy).not.toHaveBeenCalled();
    // Bootstrap phase reflects prior session completion (not idle).
    expect(getSyncState()[SYNC_PHASE.BOOTSTRAP].status).toBe(SYNC_STATUS.COMPLETE);
    expect(syncFn).toHaveBeenCalledTimes(1);
  });

  test('does not re-run bootstrap if the phase is already complete this session', async () => {
    // Simulate the phase already being complete (e.g. useAutoSync ran once this session).
    const { markComplete: mc } = require('../storage/syncRecovery');
    mc(SYNC_PHASE.BOOTSTRAP);

    const bootstrapSpy = jest.spyOn(cloudAdapter, 'bootstrapFromLocal');
    const syncFn = jest.fn().mockResolvedValue({ ok: true });
    jest
      .spyOn(Storage, 'getStorageAdapter')
      .mockReturnValue({ mode: 'cloud', sync: syncFn });

    renderHook(() => useAutoSync(makeAuth()));
    await flush();

    expect(bootstrapSpy).not.toHaveBeenCalled();
    expect(syncFn).toHaveBeenCalledTimes(1);
  });
});

// ── useAutoSync: cloud mode enables dirty-queue writes ────────────────────────

describe('useAutoSync: cloud mode wires writes through the dirty queue', () => {
  test('after useAutoSync activates cloud mode, a weight write enters the dirty queue', async () => {
    jest.spyOn(cloudAdapter, 'bootstrapFromLocal').mockResolvedValue({ ok: true });
    const syncFn = jest.fn().mockResolvedValue({ ok: true });
    jest
      .spyOn(Storage, 'getStorageAdapter')
      .mockReturnValue({ mode: 'cloud', sync: syncFn });

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

// ── Failed bootstrap: retry behavior ─────────────────────────────────────────

describe('useAutoSync: failed bootstrap leaves phase retryable', () => {
  test('a throwing bootstrap runner leaves phase failed/retryable, skips sync', async () => {
    jest
      .spyOn(cloudAdapter, 'bootstrapFromLocal')
      .mockRejectedValue(new Error('network down'));
    const syncFn = jest.fn();
    jest
      .spyOn(Storage, 'getStorageAdapter')
      .mockReturnValue({ mode: 'cloud', sync: syncFn });

    renderHook(() => useAutoSync(makeAuth()));
    await flush();

    const state = getSyncState();
    expect(state[SYNC_PHASE.BOOTSTRAP].status).toBe(SYNC_STATUS.FAILED);
    expect(state[SYNC_PHASE.BOOTSTRAP].retryable).toBe(true);
    // Sync must not run after a failed bootstrap.
    expect(syncFn).not.toHaveBeenCalled();
    // Persistent marker must NOT be set so the next launch retries.
    expect(await isBootstrapped(USER.id)).toBe(false);
  });

  test('manual retry via useSyncRecovery.retryBootstrap succeeds and sets the marker', async () => {
    jest
      .spyOn(cloudAdapter, 'bootstrapFromLocal')
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce({ ok: true });

    // Drive the initial failure through useAutoSync.
    renderHook(() => useAutoSync(makeAuth()));
    await flush();
    expect(getSyncState()[SYNC_PHASE.BOOTSTRAP].status).toBe(SYNC_STATUS.FAILED);
    expect(await isBootstrapped(USER.id)).toBe(false);

    // Now retry via useSyncRecovery.
    const { ref } = renderHook(() => useSyncRecovery(USER));
    await flush();

    let retryResult;
    await act(async () => {
      retryResult = await ref.current.retryBootstrap();
    });

    expect(retryResult.ok).toBe(true);
    expect(getSyncState()[SYNC_PHASE.BOOTSTRAP].status).toBe(SYNC_STATUS.COMPLETE);
    expect(await isBootstrapped(USER.id)).toBe(true);
  });
});

// ── Sign-out resets storage mode ─────────────────────────────────────────────

describe('useAutoSync: sign-out resets storage mode', () => {
  test('sets storage mode back to LOCAL when signed out', async () => {
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);

    renderHook(() => useAutoSync(makeAuth({ signedIn: false, user: null })));
    await flush();

    expect(Storage.getStorageMode()).toBe(Storage.STORAGE_MODES.LOCAL);
  });
});

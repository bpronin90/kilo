// Sync recovery + cloud export UX coverage (Phase 4 / Task 12).
//
// Covers the user-facing recovery surface and the cloud export hook:
// - syncQueue state machine: idle/running/failed/complete per phase
// - non-destructive retry: a failing runner leaves local AsyncStorage untouched
// - useSyncRecovery hook reflects store state and triggers retry
// - useCloudExport hook produces a v3-compatible payload plus cloud-only fields
//
// The sync algorithm itself is out of scope and not exercised here; these tests
// only prove the recovery/status/export affordances behave safely.

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  SYNC_STATUS,
  SYNC_PHASE,
  getSyncState,
  markRunning,
  markComplete,
  markFailed,
  runPhase,
  retryPhase,
  resetPhase,
  subscribeSyncState,
  __resetSyncQueue,
} from '../storage/syncRecovery';
import { useSyncRecovery, useCloudExport } from '../hooks/useEntries';
import * as entries from '../storage/entries';
import { saveWeightEntry } from '../storage/entries';
import { cloudAdapter } from '../storage/cloudAdapter';
import {
  getLocalDataOwner,
  setLocalDataOwner,
} from '../storage/entries/localDataOwner';
import { CloudSyncRecovery } from '../screens/more/CloudSyncRecovery';
import { HealthDataConsent } from '../screens/more/HealthDataConsent';

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

const { DENIAL_CODES, fetchConsentStatus } = require('../storage/cloud/consent');


beforeEach(() => {
  AsyncStorage.clear();
  __resetSyncQueue();
  fetchConsentStatus.mockResolvedValue({ allowed: true, code: 'OK' });
});

function flush() {
  return act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('syncQueue state machine', () => {
  test('both phases start idle', () => {
    const state = getSyncState();
    expect(state[SYNC_PHASE.BOOTSTRAP].status).toBe(SYNC_STATUS.IDLE);
    expect(state[SYNC_PHASE.SYNC].status).toBe(SYNC_STATUS.IDLE);
    expect(state[SYNC_PHASE.BOOTSTRAP].retryable).toBe(false);
  });

  test('markRunning/markComplete/markFailed transition a single phase', () => {
    markRunning(SYNC_PHASE.SYNC);
    expect(getSyncState()[SYNC_PHASE.SYNC].status).toBe(SYNC_STATUS.RUNNING);
    // Bootstrap is unaffected.
    expect(getSyncState()[SYNC_PHASE.BOOTSTRAP].status).toBe(SYNC_STATUS.IDLE);

    markComplete(SYNC_PHASE.SYNC);
    expect(getSyncState()[SYNC_PHASE.SYNC].status).toBe(SYNC_STATUS.COMPLETE);

    markFailed(SYNC_PHASE.BOOTSTRAP, new Error('network down'));
    const bs = getSyncState()[SYNC_PHASE.BOOTSTRAP];
    expect(bs.status).toBe(SYNC_STATUS.FAILED);
    expect(bs.error).toBe('network down');
    expect(bs.retryable).toBe(true);
  });

  test('resetPhase returns a phase to idle', () => {
    markFailed(SYNC_PHASE.SYNC, 'boom');
    resetPhase(SYNC_PHASE.SYNC);
    expect(getSyncState()[SYNC_PHASE.SYNC].status).toBe(SYNC_STATUS.IDLE);
    expect(getSyncState()[SYNC_PHASE.SYNC].retryable).toBe(false);
  });

  test('subscribeSyncState notifies on change and unsubscribe stops it', () => {
    const seen = [];
    const unsubscribe = subscribeSyncState((s) => seen.push(s[SYNC_PHASE.SYNC].status));
    markRunning(SYNC_PHASE.SYNC);
    markComplete(SYNC_PHASE.SYNC);
    unsubscribe();
    markFailed(SYNC_PHASE.SYNC, 'x');
    expect(seen).toEqual([SYNC_STATUS.RUNNING, SYNC_STATUS.COMPLETE]);
  });
});

describe('runPhase / retryPhase', () => {
  test('successful runner drives running -> complete and returns ok', async () => {
    const result = await runPhase(SYNC_PHASE.BOOTSTRAP, async () => 'done');
    expect(result.ok).toBe(true);
    expect(getSyncState()[SYNC_PHASE.BOOTSTRAP].status).toBe(SYNC_STATUS.COMPLETE);
  });

  test('throwing runner leaves phase failed and retryable', async () => {
    const result = await runPhase(SYNC_PHASE.SYNC, async () => {
      throw new Error('sync exploded');
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('sync exploded');
    const s = getSyncState()[SYNC_PHASE.SYNC];
    expect(s.status).toBe(SYNC_STATUS.FAILED);
    expect(s.retryable).toBe(true);
  });

  test('runner returning { ok: false } is treated as recoverable failure', async () => {
    const result = await runPhase(SYNC_PHASE.SYNC, async () => ({ ok: false, error: 'conflict' }));
    expect(result.ok).toBe(false);
    expect(getSyncState()[SYNC_PHASE.SYNC].status).toBe(SYNC_STATUS.FAILED);
    expect(getSyncState()[SYNC_PHASE.SYNC].error).toBe('conflict');
  });

  test('a failed bootstrap leaves local AsyncStorage untouched (non-destructive)', async () => {
    await saveWeightEntry({
      id: 'w_keep_1',
      entry_type: 'weight',
      date: '2026-06-01',
      weight_value: 180,
      logged_at: '2026-06-01T08:00:00.000Z',
    });
    const before = await AsyncStorage.getItem('kilo_weight_entries');

    await runPhase(SYNC_PHASE.BOOTSTRAP, async () => {
      throw new Error('upload failed');
    });

    const after = await AsyncStorage.getItem('kilo_weight_entries');
    expect(after).toBe(before);
    expect(JSON.parse(after).map((e) => e.id)).toContain('w_keep_1');
  });

  test('retry of a previously failed phase can succeed and clears retryable', async () => {
    let attempt = 0;
    const runner = async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('first fails');
      return 'ok';
    };
    await runPhase(SYNC_PHASE.SYNC, runner);
    expect(getSyncState()[SYNC_PHASE.SYNC].status).toBe(SYNC_STATUS.FAILED);

    const retry = await retryPhase(SYNC_PHASE.SYNC, runner);
    expect(retry.ok).toBe(true);
    expect(getSyncState()[SYNC_PHASE.SYNC].status).toBe(SYNC_STATUS.COMPLETE);
    expect(getSyncState()[SYNC_PHASE.SYNC].retryable).toBe(false);
  });

  test('unknown phase or missing runner returns ok:false without throwing', async () => {
    expect((await runPhase('bogus', async () => 1)).ok).toBe(false);
    expect((await runPhase(SYNC_PHASE.SYNC, null)).ok).toBe(false);
  });
});

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

describe('useSyncRecovery hook', () => {
  const USER = { id: 'u_1', email: 'me@x.co' };

  afterEach(() => {
    jest.restoreAllMocks();
    // Leave storage mode local for other suites.
    entries.setStorageMode('local');
  });

  test('reflects current store state and live updates', async () => {
    const { ref } = renderHook(() => useSyncRecovery(USER));
    await flush();
    expect(ref.current.bootstrap.status).toBe(SYNC_STATUS.IDLE);
    expect(ref.current.sync.status).toBe(SYNC_STATUS.IDLE);

    await act(async () => {
      markFailed(SYNC_PHASE.BOOTSTRAP, 'offline');
    });
    expect(ref.current.bootstrap.status).toBe(SYNC_STATUS.FAILED);
    expect(ref.current.bootstrap.retryable).toBe(true);
  });

  test('bootstrap runner calls cloudAdapter.bootstrapFromLocal with the user id and drives running -> complete', async () => {
    const spy = jest
      .spyOn(cloudAdapter, 'bootstrapFromLocal')
      .mockResolvedValue({ ok: true });

    const { ref } = renderHook(() => useSyncRecovery(USER));
    await flush();

    let result;
    await act(async () => {
      result = await ref.current.runBootstrap();
    });
    expect(spy).toHaveBeenCalledWith('u_1');
    expect(result.ok).toBe(true);
    expect(ref.current.bootstrap.status).toBe(SYNC_STATUS.COMPLETE);
    // A successful manual upload claims local-data ownership (#450).
    expect(await getLocalDataOwner()).toBe('u_1');
  });

  test('a successful upload whose owner write fails leaves the phase failed/retryable and local mode active', async () => {
    jest
      .spyOn(cloudAdapter, 'bootstrapFromLocal')
      .mockResolvedValue({ ok: true });
    await setLocalDataOwner('previous-owner');

    const { ref } = renderHook(() => useSyncRecovery(USER));
    await flush();

    // Fail only the owner-marker write; other storage writes still work.
    const owners = require('../storage/entries/localDataOwner');
    const ownerWriteSpy = jest
      .spyOn(owners, 'setLocalDataOwner')
      .mockRejectedValue(new Error('disk full'));

    let result;
    await act(async () => {
      result = await ref.current.runBootstrap();
    });
    ownerWriteSpy.mockRestore();

    expect(result.ok).toBe(false);
    expect(ref.current.bootstrap.status).toBe(SYNC_STATUS.FAILED);
    expect(ref.current.bootstrap.retryable).toBe(true);
    expect(entries.getStorageMode()).toBe('local');
    // The prior owner is unchanged — the claim never became durable.
    expect(await getLocalDataOwner()).toBe('previous-owner');
  });

  test('initial bootstrap action drives idle -> running -> complete on success (no prior failure)', async () => {
    // Inject a fake adapter result via the bootstrap export; assert the runner
    // both calls bootstrapFromLocal(userId) and transitions the visible status
    // for normal (first-time) work, not just retry.
    const order = [];
    const unsubscribe = subscribeSyncState((s) =>
      order.push(s[SYNC_PHASE.BOOTSTRAP].status)
    );
    const spy = jest
      .spyOn(cloudAdapter, 'bootstrapFromLocal')
      .mockResolvedValue({ ok: true });

    const { ref } = renderHook(() => useSyncRecovery(USER));
    await flush();
    // Starts idle (never failed first).
    expect(ref.current.bootstrap.status).toBe(SYNC_STATUS.IDLE);
    expect(ref.current.bootstrap.retryable).toBe(false);

    let result;
    await act(async () => {
      result = await ref.current.runBootstrap();
    });
    unsubscribe();

    expect(spy).toHaveBeenCalledWith('u_1');
    expect(result.ok).toBe(true);
    expect(ref.current.bootstrap.status).toBe(SYNC_STATUS.COMPLETE);
    // The initial action passed through running before completing.
    expect(order).toContain(SYNC_STATUS.RUNNING);
    expect(order).toContain(SYNC_STATUS.COMPLETE);
  });

  test('initial bootstrap action drives running -> failed/retryable on a throwing runner', async () => {
    const order = [];
    const unsubscribe = subscribeSyncState((s) =>
      order.push(s[SYNC_PHASE.BOOTSTRAP].status)
    );
    jest
      .spyOn(cloudAdapter, 'bootstrapFromLocal')
      .mockRejectedValue(new Error('bootstrap exploded'));

    const { ref } = renderHook(() => useSyncRecovery(USER));
    await flush();
    expect(ref.current.bootstrap.status).toBe(SYNC_STATUS.IDLE);

    let result;
    await act(async () => {
      result = await ref.current.runBootstrap();
    });
    unsubscribe();

    expect(result.ok).toBe(false);
    expect(result.error).toBe('bootstrap exploded');
    expect(ref.current.bootstrap.status).toBe(SYNC_STATUS.FAILED);
    expect(ref.current.bootstrap.retryable).toBe(true);
    expect(order).toContain(SYNC_STATUS.RUNNING);
    expect(order).toContain(SYNC_STATUS.FAILED);
  });

  test('retry re-invokes the bound bootstrap runner: failed/retryable on throw, then complete on retry', async () => {
    const spy = jest
      .spyOn(cloudAdapter, 'bootstrapFromLocal')
      .mockRejectedValueOnce(new Error('upload failed'))
      .mockResolvedValueOnce({ ok: true });

    const { ref } = renderHook(() => useSyncRecovery(USER));
    await flush();

    await act(async () => {
      await ref.current.runBootstrap();
    });
    expect(ref.current.bootstrap.status).toBe(SYNC_STATUS.FAILED);
    expect(ref.current.bootstrap.retryable).toBe(true);

    let retry;
    await act(async () => {
      retry = await ref.current.retryBootstrap();
    });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith('u_1');
    expect(retry.ok).toBe(true);
    expect(ref.current.bootstrap.status).toBe(SYNC_STATUS.COMPLETE);
    expect(ref.current.bootstrap.retryable).toBe(false);
  });

  test('no signed-in user: bootstrap reports honestly without calling the adapter', async () => {
    const spy = jest.spyOn(cloudAdapter, 'bootstrapFromLocal');

    const { ref } = renderHook(() => useSyncRecovery(null));
    await flush();

    let result;
    await act(async () => {
      result = await ref.current.runBootstrap();
    });
    expect(spy).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/sign in/i);
  });

  test('sync runner is feature-detected: drives running -> complete when adapter.sync exists', async () => {
    const sync = jest.fn().mockResolvedValue({ ok: true });
    jest
      .spyOn(entries, 'getStorageAdapter')
      .mockReturnValue({ mode: 'cloud', sync });

    const { ref } = renderHook(() => useSyncRecovery(USER));
    await flush();

    let result;
    await act(async () => {
      result = await ref.current.runSync();
    });
    expect(sync).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(ref.current.sync.status).toBe(SYNC_STATUS.COMPLETE);
  });

  test('sync reports honestly (not silent success) when no adapter.sync runner is available', async () => {
    jest
      .spyOn(entries, 'getStorageAdapter')
      .mockReturnValue({ mode: 'cloud' }); // no sync method

    const { ref } = renderHook(() => useSyncRecovery(USER));
    await flush();

    let result;
    await act(async () => {
      result = await ref.current.runSync();
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not available/i);
    // Status must not flip to complete on a missing runner.
    expect(ref.current.sync.status).not.toBe(SYNC_STATUS.COMPLETE);
  });

  // issue #499: the local adapter exposes a no-op `sync` that resolves cleanly.
  // Before the fix, a signed-in device still in LOCAL mode ran that no-op on
  // Sync Now and the SYNC phase flipped to complete — reporting "Fully synced"
  // while restoring nothing. The runner must refuse the local no-op so status
  // stays honest (never complete).
  test('local-mode Sync Now cannot transition to complete (real local no-op adapter)', async () => {
    // No getStorageAdapter mock: use the REAL local adapter (mode 'local').
    entries.setStorageMode('local');

    const { ref } = renderHook(() => useSyncRecovery(USER));
    await flush();

    let result;
    await act(async () => {
      result = await ref.current.runSync();
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not available/i);
    expect(ref.current.sync.status).not.toBe(SYNC_STATUS.COMPLETE);
    expect(ref.current.sync.status).toBe(SYNC_STATUS.IDLE);
  });

  test('a pull/persist failure leaves the sync phase failed and retryable, not complete', async () => {
    const sync = jest.fn().mockRejectedValue(new Error('pull exploded'));
    jest
      .spyOn(entries, 'getStorageAdapter')
      .mockReturnValue({ mode: 'cloud', sync });

    const { ref } = renderHook(() => useSyncRecovery(USER));
    await flush();

    let result;
    await act(async () => {
      result = await ref.current.runSync();
    });

    expect(sync).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    expect(ref.current.sync.status).toBe(SYNC_STATUS.FAILED);
    expect(ref.current.sync.retryable).toBe(true);
  });
});

describe('CloudSyncRecovery: manual upload respects local-data ownership (#450)', () => {
  const USER = { id: 'u_1', email: 'me@x.co' };

  afterEach(() => {
    jest.restoreAllMocks();
    entries.setStorageMode('local');
  });

  function renderPanel(user = USER) {
    let tree;
    act(() => {
      tree = renderer.create(React.createElement(CloudSyncRecovery, { user }));
    });
    return tree;
  }

  async function press(tree, title) {
    await act(async () => {
      await tree.root.findByProps({ title }).props.onPress();
    });
  }

  test('foreign owner: Upload Local History asks for confirmation instead of uploading', async () => {
    await setLocalDataOwner('someone-else');
    const spy = jest
      .spyOn(cloudAdapter, 'bootstrapFromLocal')
      .mockResolvedValue({ ok: true });

    const tree = renderPanel();
    await flush();
    await press(tree, 'Upload Local History');

    // No silent upload of another account's data.
    expect(spy).not.toHaveBeenCalled();
    expect(tree.root.findAllByProps({ title: 'Upload Anyway' }).length).toBeGreaterThan(0);

    // Confirming performs the upload and claims ownership.
    await press(tree, 'Upload Anyway');
    await flush();
    expect(spy).toHaveBeenCalledWith(USER.id);
    expect(await getLocalDataOwner()).toBe(USER.id);
  });

  test('foreign owner: Cancel dismisses the confirmation without uploading', async () => {
    await setLocalDataOwner('someone-else');
    const spy = jest.spyOn(cloudAdapter, 'bootstrapFromLocal');

    const tree = renderPanel();
    await flush();
    await press(tree, 'Upload Local History');
    await press(tree, 'Cancel');

    expect(spy).not.toHaveBeenCalled();
    expect(tree.root.findAllByProps({ title: 'Upload Anyway' })).toHaveLength(0);
    expect(await getLocalDataOwner()).toBe('someone-else');
  });

  test('own or unclaimed data: Upload Local History runs directly (the press is the consent)', async () => {
    const spy = jest
      .spyOn(cloudAdapter, 'bootstrapFromLocal')
      .mockResolvedValue({ ok: true });

    const tree = renderPanel();
    await flush();
    await press(tree, 'Upload Local History');
    await flush();

    expect(spy).toHaveBeenCalledWith(USER.id);
    expect(await getLocalDataOwner()).toBe(USER.id);
  });

  test('successful withdrawal switches to local-only mode before requesting the purge', async () => {
    const { withdrawConsent, requestHealthDataDeletion } = require('../storage/cloud/consent');
    withdrawConsent.mockClear();
    requestHealthDataDeletion.mockClear();
    entries.setStorageMode(entries.STORAGE_MODES.CLOUD);

    const tree = renderPanel();
    await flush();
    await press(tree, 'Turn Off Cloud Sync');
    await press(tree, 'Withdraw consent and delete cloud data');
    await flush();

    expect(withdrawConsent).toHaveBeenCalledTimes(1);
    expect(entries.getStorageMode()).toBe(entries.STORAGE_MODES.LOCAL);
    expect(requestHealthDataDeletion).toHaveBeenCalledTimes(1);
  });

  test('successful same-owner re-grant restores cloud mode in the current session', async () => {
    await setLocalDataOwner(USER.id);
    entries.setStorageMode(entries.STORAGE_MODES.LOCAL);
    fetchConsentStatus
      .mockResolvedValueOnce({
        allowed: false,
        code: DENIAL_CODES.CONSENT_VERSION_STALE,
      })
      .mockResolvedValue({ allowed: true, code: 'OK' });

    const tree = renderPanel();
    await flush();
    await press(tree, 'Review and enable Cloud Sync');
    const consent = tree.root.findByType(HealthDataConsent);
    await act(async () => {
      await consent.props.onGranted({ ok: true, status: 'granted' });
    });

    expect(entries.getStorageMode()).toBe(entries.STORAGE_MODES.CLOUD);
  });

  test('successful re-grant does not bypass a foreign local-data owner', async () => {
    await setLocalDataOwner('someone-else');
    entries.setStorageMode(entries.STORAGE_MODES.LOCAL);
    fetchConsentStatus
      .mockResolvedValueOnce({
        allowed: false,
        code: DENIAL_CODES.CONSENT_VERSION_STALE,
      })
      .mockResolvedValue({ allowed: true, code: 'OK' });

    const tree = renderPanel();
    await flush();
    await press(tree, 'Review and enable Cloud Sync');
    const consent = tree.root.findByType(HealthDataConsent);
    await act(async () => {
      await consent.props.onGranted({ ok: true, status: 'granted' });
    });

    expect(entries.getStorageMode()).toBe(entries.STORAGE_MODES.LOCAL);
  });
});

describe('useCloudExport hook', () => {
  test('produces a v3-compatible JSON payload with cloud-only fields', async () => {
    await saveWeightEntry({
      id: 'w_export_1',
      entry_type: 'weight',
      date: '2026-06-02',
      weight_value: 181,
      logged_at: '2026-06-02T08:00:00.000Z',
    });
    const { ref } = renderHook(useCloudExport);
    await flush();

    let result;
    await act(async () => {
      result = await ref.current.exportCloud({ id: 'u_9', email: 'me@x.co' });
    });
    expect(result.ok).toBe(true);
    const parsed = JSON.parse(result.json);
    expect(parsed.version).toBe('3');
    expect(parsed.weight_entries.map((e) => e.id)).toContain('w_export_1');
    expect(parsed.cloud.cloud_export_format).toBe('cloud-1');
    expect(parsed.cloud.account).toEqual({ id: 'u_9', email: 'me@x.co' });
  });

  test('cloud.account carries the signed-in id/email when a user is present, and is null when signed out', async () => {
    const { ref } = renderHook(useCloudExport);
    await flush();

    let signedIn;
    await act(async () => {
      signedIn = await ref.current.exportCloud({ id: 'u_42', email: 'a@b.co' });
    });
    expect(signedIn.ok).toBe(true);
    expect(JSON.parse(signedIn.json).cloud.account).toEqual({ id: 'u_42', email: 'a@b.co' });

    let signedOut;
    await act(async () => {
      signedOut = await ref.current.exportCloud();
    });
    expect(signedOut.ok).toBe(true);
    expect(JSON.parse(signedOut.json).cloud.account).toBeNull();
  });
});

import { useState, useEffect, useCallback } from 'react';
import * as Storage from '../../storage/entries';
import { cloudAdapter } from '../../storage/cloudAdapter';
import {
  SYNC_PHASE,
  SYNC_STATUS,
  getSyncState,
  subscribeSyncState,
  runPhase,
  markComplete,
  isBootstrapped,
  setBootstrapped,
} from '../../storage/syncRecovery';

function makeBootstrapRunner(user) {
  const userId = user?.id;
  if (!userId) return null;
  return () => cloudAdapter.bootstrapFromLocal(userId);
}

function makeSyncRunner() {
  const adapter = Storage.getStorageAdapter();
  return typeof adapter.sync === 'function' ? () => adapter.sync() : null;
}

export function useSyncRecovery(user = null) {
  const [snapshot, setSnapshot] = useState(getSyncState);

  useEffect(() => {
    setSnapshot(getSyncState());
    const unsubscribe = subscribeSyncState((next) => setSnapshot(next));
    return unsubscribe;
  }, []);

  const userId = user?.id ?? null;

  const runBootstrap = useCallback(async () => {
    const runner = makeBootstrapRunner(user);
    if (!runner) {
      return { ok: false, error: 'Sign in to bootstrap your cloud data.' };
    }
    const result = await runPhase(SYNC_PHASE.BOOTSTRAP, runner);
    if (result.ok && userId) {
      await setBootstrapped(userId);
    }
    return result;
  }, [userId]);

  const runSync = useCallback(() => {
    const runner = makeSyncRunner();
    if (!runner) {
      return Promise.resolve({
        ok: false,
        error: 'Cloud sync is not available in this build yet.',
      });
    }
    return runPhase(SYNC_PHASE.SYNC, runner);
  }, []);

  return {
    bootstrap: snapshot[SYNC_PHASE.BOOTSTRAP],
    sync: snapshot[SYNC_PHASE.SYNC],
    runBootstrap,
    retryBootstrap: runBootstrap,
    runSync,
    retrySync: runSync,
  };
}

// Automatic cloud sync on sign-in (#432).
//
// Sets the storage mode to cloud when the user is signed in and cloud is
// configured, and reverts to local on sign-out. Runs the first-sign-in bootstrap
// once (guarded by the persistent AsyncStorage marker), then runs an initial
// bidirectional sync. Ongoing sync after writes is handled by maybeSyncCloud()
// in the entry-hook refresh paths once cloud mode is active.
//
// Failures are non-destructive: a failed bootstrap leaves the phase in
// failed/retryable so the manual Retry button in CloudSyncRecovery can recover.
export function useAutoSync(auth) {
  const userId = auth?.user?.id ?? null;
  const configured = auth?.configured ?? false;
  const authLoading = auth?.loading ?? true;
  const signedIn = auth?.signedIn ?? false;

  useEffect(() => {
    if (!configured || authLoading) return;

    if (!signedIn || !userId) {
      Storage.setStorageMode(Storage.STORAGE_MODES.LOCAL);
      return;
    }

    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);

    let cancelled = false;

    (async () => {
      const state = getSyncState();
      // Skip if bootstrap was already driven this session (running or complete).
      if (state[SYNC_PHASE.BOOTSTRAP].status !== SYNC_STATUS.IDLE) {
        if (state[SYNC_PHASE.BOOTSTRAP].status === SYNC_STATUS.COMPLETE &&
            getSyncState()[SYNC_PHASE.SYNC].status === SYNC_STATUS.IDLE) {
          const runner = makeSyncRunner();
          if (runner && !cancelled) await runPhase(SYNC_PHASE.SYNC, runner);
        }
        return;
      }

      const alreadyBootstrapped = await isBootstrapped(userId);
      if (cancelled) return;

      if (alreadyBootstrapped) {
        // Bootstrap completed in a prior session. Reflect that in the UI so the
        // manual "Upload Local History" button doesn't appear unnecessarily.
        markComplete(SYNC_PHASE.BOOTSTRAP);
      } else {
        const runner = makeBootstrapRunner({ id: userId });
        if (!runner) return;
        const result = await runPhase(SYNC_PHASE.BOOTSTRAP, runner);
        if (cancelled) return;
        if (!result.ok) return;
        await setBootstrapped(userId);
      }

      if (getSyncState()[SYNC_PHASE.SYNC].status !== SYNC_STATUS.IDLE) return;
      const syncRunner = makeSyncRunner();
      if (syncRunner && !cancelled) await runPhase(SYNC_PHASE.SYNC, syncRunner);
    })().catch(() => {});

    return () => { cancelled = true; };
  }, [configured, authLoading, signedIn, userId]);
}

export function useCloudExport() {
  const exportCloud = useCallback(async (account = null) => {
    try {
      // Cloud recovery is the explicit account-identity flow: the user is
      // exporting their own data to re-link an account, so it opts into the
      // signed-in email. The default backup export omits email (issue #350).
      const payload = await Storage.buildCloudExport({ account, includeEmail: true });
      return { ok: true, json: JSON.stringify(payload, null, 2), payload };
    } catch (e) {
      return { ok: false, error: e?.message || 'Failed to export cloud data.' };
    }
  }, []);

  return { exportCloud };
}

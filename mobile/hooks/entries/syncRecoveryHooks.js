import { useState, useEffect, useCallback, useRef } from 'react';
import * as Storage from '../../storage/entries';
import { cloudAdapter } from '../../storage/cloudAdapter';
import {
  SYNC_PHASE,
  SYNC_STATUS,
  getSyncState,
  subscribeSyncState,
  runPhase,
  markComplete,
  resetPhase,
} from '../../storage/syncRecovery';
import {
  OWNER_UNCLAIMED,
  getLocalDataOwner,
  setLocalDataOwner,
  purgeLocalData,
} from '../../storage/entries/localDataOwner';

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
      // A successful upload makes this account the owner of the local data,
      // and cloud mode can activate so subsequent writes are sync-tracked.
      // A failed bootstrap leaves the owner unchanged so the next attempt
      // retries (#450).
      await setLocalDataOwner(userId);
      Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
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

// Automatic cloud sync on sign-in (#432), ownership-gated (#450).
//
// Sets the storage mode to cloud when the signed-in user owns the local data,
// and reverts to local on sign-out. Whether the first-sign-in bootstrap may run
// is decided solely by the local-data owner marker:
//
//   owner === userId   → nothing to bootstrap; activate cloud mode and sync.
//   owner unclaimed    → surface a confirmation prompt; bootstrap only after
//                        the user confirms, then claim ownership.
//   anything else      → local data belongs to some other account. Never
//                        bootstrap automatically; surface an explicit choice
//                        between purging ("start fresh") and a deliberate
//                        upload. Storage mode stays LOCAL until resolved so no
//                        foreign data can enter the dirty queue.
//
// `onSyncComplete` is called after a sync pass writes new remote data into
// local storage so callers can refresh their UI state. Passed as an option so
// App.js can forward the entry-hook refresh callbacks without adding them to
// the effect dependency array (the ref always holds the latest value).
//
// Failures are non-destructive: a failed bootstrap leaves the phase in
// failed/retryable and the owner marker unchanged, so the manual Retry button
// in CloudSyncRecovery (or the next launch) can recover.
//
// Returns { ownershipPrompt, confirmOwnershipUpload, startFreshOnDevice,
// dismissOwnershipPrompt }. `ownershipPrompt` is null or
// { type: 'first-upload' | 'foreign' }; App.js renders the decision UI.
export function useAutoSync(auth, { onSyncComplete } = {}) {
  // Keep the callback ref current on every render so the async effect always
  // calls the latest version without it becoming an effect dependency.
  const onSyncCompleteRef = useRef(onSyncComplete);
  onSyncCompleteRef.current = onSyncComplete;

  const [ownershipPrompt, setOwnershipPrompt] = useState(null);

  const userId = auth?.user?.id ?? null;
  const configured = auth?.configured ?? false;
  const authLoading = auth?.loading ?? true;
  const signedIn = auth?.signedIn ?? false;

  const runInitialSync = useCallback(async () => {
    if (getSyncState()[SYNC_PHASE.SYNC].status === SYNC_STATUS.IDLE) {
      const runner = makeSyncRunner();
      if (runner) await runPhase(SYNC_PHASE.SYNC, runner);
    }
    onSyncCompleteRef.current?.();
  }, []);

  // The user confirmed the upload (first-sign-in claim of unclaimed data, or a
  // deliberate upload of another account's data into theirs).
  const confirmOwnershipUpload = useCallback(async () => {
    if (!userId) return { ok: false, error: 'Not signed in.' };
    setOwnershipPrompt(null);
    const runner = makeBootstrapRunner({ id: userId });
    const result = await runPhase(SYNC_PHASE.BOOTSTRAP, runner);
    if (!result.ok) {
      // Owner unchanged and storage mode stays LOCAL; the failed/retryable
      // phase lets CloudSyncRecovery retry, and the next launch re-prompts.
      return result;
    }
    await setLocalDataOwner(userId);
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    await runInitialSync();
    return result;
  }, [userId, runInitialSync]);

  // The safe default for foreign-owned data: purge this device, claim it, and
  // pull the signed-in account's cloud data down.
  const startFreshOnDevice = useCallback(async () => {
    if (!userId) return { ok: false, error: 'Not signed in.' };
    setOwnershipPrompt(null);
    try {
      await purgeLocalData(userId);
    } catch (e) {
      // Purge did not complete, so the device must not be treated as fresh.
      // Re-surface the choice instead of syncing over foreign data.
      setOwnershipPrompt({ type: 'foreign' });
      return { ok: false, error: e?.message || 'Could not clear this device.' };
    }
    // Nothing left to bootstrap; reflect that so the manual upload button
    // doesn't appear.
    markComplete(SYNC_PHASE.BOOTSTRAP);
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    await runInitialSync();
    return { ok: true };
  }, [userId, runInitialSync]);

  // "Decide later": no bootstrap, no sync, storage mode stays LOCAL. The
  // prompt returns on the next launch because the owner marker is unchanged.
  const dismissOwnershipPrompt = useCallback(() => {
    setOwnershipPrompt(null);
  }, []);

  useEffect(() => {
    if (!configured || authLoading) return;

    if (!signedIn || !userId) {
      Storage.setStorageMode(Storage.STORAGE_MODES.LOCAL);
      // Reset phases so the next sign-in (possibly a different user) starts
      // clean. The owner marker is deliberately NOT cleared: local history is
      // retained on sign-out and still belongs to that user.
      resetPhase(SYNC_PHASE.BOOTSTRAP);
      resetPhase(SYNC_PHASE.SYNC);
      setOwnershipPrompt(null);
      return;
    }

    let cancelled = false;

    (async () => {
      const state = getSyncState();
      // Skip if bootstrap was already driven this session for THIS user
      // (running or complete). A phase left over from a prior user is cleared
      // on sign-out (see resetPhase above), so a stale non-IDLE status here
      // always belongs to the current user.
      if (state[SYNC_PHASE.BOOTSTRAP].status !== SYNC_STATUS.IDLE) {
        if (state[SYNC_PHASE.BOOTSTRAP].status === SYNC_STATUS.COMPLETE) {
          Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
          if (getSyncState()[SYNC_PHASE.SYNC].status === SYNC_STATUS.IDLE) {
            const runner = makeSyncRunner();
            if (runner && !cancelled) await runPhase(SYNC_PHASE.SYNC, runner);
            if (!cancelled) onSyncCompleteRef.current?.();
          }
        }
        return;
      }

      const owner = await getLocalDataOwner();
      if (cancelled) return;

      if (owner === userId) {
        // Local data is already theirs — nothing to bootstrap. Activate cloud
        // mode and sync normally (this keeps #432's purpose intact).
        Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
        markComplete(SYNC_PHASE.BOOTSTRAP);
        if (!cancelled) await runInitialSync();
      } else if (owner === OWNER_UNCLAIMED) {
        setOwnershipPrompt({ type: 'first-upload' });
      } else {
        // A different userId or 'unknown': the data belongs to someone else.
        setOwnershipPrompt({ type: 'foreign' });
      }
    })().catch(() => {});

    return () => { cancelled = true; };
  }, [configured, authLoading, signedIn, userId, runInitialSync]);

  return {
    ownershipPrompt,
    confirmOwnershipUpload,
    startFreshOnDevice,
    dismissOwnershipPrompt,
  };
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

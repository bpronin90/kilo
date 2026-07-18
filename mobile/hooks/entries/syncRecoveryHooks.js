import { useState, useEffect, useCallback, useRef } from 'react';
import * as Storage from '../../storage/entries';
import { cloudAdapter, isLocalDataEmpty } from '../../storage/cloudAdapter';
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
import { fetchConsentStatus } from '../../storage/cloud/consent';

// The Cloud Sync authorization seam (#487).
//
// Every table bootstrap and sync touch is consent-gated health data, so both are
// checked here, once, before any upload is attempted. Two reasons this happens at
// the app layer rather than inside the sync engine:
//
//   * A bootstrap that ran without a grant would push settings up and then have its
//     health tables rejected by RLS one at a time, leaving a half-uploaded account
//     and an error the user cannot act on. Refusing before the first write keeps the
//     failure honest.
//   * A denial has to become a SCREEN — update the app, consent, re-consent, or wait
//     for a deletion to finish. Those are four different outcomes, and the engine has
//     no way to express them.
//
// This is not the authorization boundary and must never be mistaken for one. The
// server's RLS gate refuses the same reads and writes whether or not this check
// runs; a tampered client that skipped it would simply get empty pulls and rejected
// writes.
async function assertConsent() {
  const consent = await fetchConsentStatus();
  if (consent.allowed) return null;
  // A denial is also a storage-mode boundary. Keeping the cloud adapter active
  // would let ordinary entry-hook refreshes bypass this preflight seam and try
  // consent-gated reads/writes one table at a time. Local data remains usable,
  // including retained raw tombstones needed for later convergence.
  Storage.setStorageMode(Storage.STORAGE_MODES.LOCAL);
  return {
    ok: false,
    code: consent.code,
    consentDenied: true,
    error: 'Cloud Sync needs your consent to store health data.',
  };
}

function makeBootstrapRunner(user) {
  const userId = user?.id;
  if (!userId) return null;
  return () => cloudAdapter.bootstrapFromLocal(userId);
}

function makeSyncRunner() {
  const adapter = Storage.getStorageAdapter();
  // The local adapter also exposes `sync`, but it is a deliberate no-op
  // (localAdapter.js) that resolves successfully without ever contacting the
  // cloud. That no-op is exactly how a signed-in device which never activated
  // cloud mode could report "Fully synced" while restoring none of the
  // account's data (issue #499): a manual Sync Now ran the local no-op and the
  // SYNC phase flipped to complete. Only a cloud-backed adapter performs a real
  // pull/push, so refuse the explicit local no-op (`mode: 'local'`) — leaving
  // the phase untouched and honest — while a cloud adapter still drives sync.
  // Feature detection on `sync` is kept for the cloud adapter shell.
  return adapter.mode !== 'local' && typeof adapter.sync === 'function'
    ? () => adapter.sync()
    : null;
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
    // No grant, no upload. The phase is left untouched (not failed): the user has
    // not hit an error, they simply have not consented yet, and the consent surface
    // is what resolves it.
    const denied = await assertConsent();
    if (denied) return denied;
    // The owner write is part of the phase runner: a successful upload whose
    // ownership claim fails to persist is a failed (retryable) bootstrap, not
    // a success — cloud mode must never activate without a durable owner
    // (#450). Retrying re-runs the upload, which is safe: upserts are
    // idempotent.
    const result = await runPhase(SYNC_PHASE.BOOTSTRAP, async () => {
      const r = await runner();
      if (r && r.ok === false) return r;
      await setLocalDataOwner(userId);
      return r;
    });
    if (result.ok && userId) {
      Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    }
    return result;
  }, [userId]);

  const runSync = useCallback(async () => {
    const runner = makeSyncRunner();
    if (!runner) {
      return {
        ok: false,
        error: 'Cloud sync is not available in this build yet.',
      };
    }
    const denied = await assertConsent();
    if (denied) return denied;
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
  // Whether the unclaimed-device prompt may offer the pull-only restore. True
  // only when this device is verifiably empty (isLocalDataEmpty), so the
  // "Download my account's data" action can never push local state up. Kept
  // separate from ownershipPrompt so the prompt shape stays {type} and the
  // restore affordance simply hides on a device that has data to protect.
  const [canRestore, setCanRestore] = useState(false);
  // The server's denial code, so App/CloudSyncRecovery can route the user to the
  // consent surface, an update prompt, or a deletion-pending notice rather than
  // silently doing nothing.
  const [consentDenial, setConsentDenial] = useState(null);

  const userId = auth?.user?.id ?? null;
  const configured = auth?.configured ?? false;
  const authLoading = auth?.loading ?? true;
  const signedIn = auth?.signedIn ?? false;
  // PASSWORD_RECOVERY establishes an authenticated session, but it is not an
  // ordinary sign-in: completing (or explicitly exiting) password recovery
  // must take precedence over any local-data ownership decision (#500).
  const recoveryActive = Boolean(auth?.passwordRecovery || auth?.recoveryError);

  const runInitialSync = useCallback(async () => {
    // The automatic path is exactly where an ungated upload would be most damaging:
    // it runs on sign-in, with no user watching. A user who has not granted
    // health-data consent must not have their history pushed to the cloud simply
    // because they signed in on a new device.
    const denied = await assertConsent();
    if (denied) {
      setConsentDenial(denied.code);
      return;
    }
    setConsentDenial(null);
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
    // Confirming ownership is not consent. This upload is the largest health-data
    // write the app makes, so it needs its own grant check.
    const denied = await assertConsent();
    if (denied) {
      setConsentDenial(denied.code);
      return denied;
    }
    setOwnershipPrompt(null);
    const runner = makeBootstrapRunner({ id: userId });
    // The owner write is part of the phase runner so a successful upload
    // whose ownership claim fails to persist still fails the phase: owner
    // unchanged, storage mode stays LOCAL, no sync. The failed/retryable
    // phase lets CloudSyncRecovery retry, and the next launch re-prompts.
    const result = await runPhase(SYNC_PHASE.BOOTSTRAP, async () => {
      const r = await runner();
      if (r && r.ok === false) return r;
      await setLocalDataOwner(userId);
      return r;
    });
    if (!result.ok) return result;
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

  // Restore-only claim for a clean/unclaimed device (issue #499). A device that
  // signs into an account which already holds cloud data must be able to PULL
  // that data down WITHOUT first uploading its own (empty or unrelated) local
  // history. Claim the device for this account, activate cloud mode, and run the
  // initial sync — which is pull-only when there is nothing dirty to push, so a
  // clean device restores the account without pushing empty rows over the good
  // cloud copy. Mirrors startFreshOnDevice minus the purge: there is nothing to
  // discard on the restore path, so any local history is preserved and merged
  // rather than destroyed.
  const downloadAccountData = useCallback(async () => {
    if (!userId) return { ok: false, error: 'Not signed in.' };
    // Genuinely pull-only: a download must never push local state up. The
    // ongoing sync is download-only exactly when there is nothing to push, so
    // re-verify (defense in depth behind the hidden button) that this device is
    // empty before claiming it. A device with real local data uses "Upload My
    // History" (a merge) instead — Download never silently uploads (#499).
    if (!(await isLocalDataEmpty())) {
      return {
        ok: false,
        error:
          'This device already has training data. Use Upload My History to merge it into your account.',
      };
    }
    setOwnershipPrompt(null);
    try {
      await setLocalDataOwner(userId);
    } catch (e) {
      // Ownership did not persist, so the device must not silently enter cloud
      // mode. Re-surface the choice instead of syncing unclaimed.
      setOwnershipPrompt({ type: 'first-upload' });
      return { ok: false, error: e?.message || 'Could not claim this device.' };
    }
    // Nothing to bootstrap on the restore path; reflect that so the manual
    // upload button doesn't reappear.
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

    if (recoveryActive) {
      // A recovery callback may arrive after a sign-in ownership check has
      // already surfaced its prompt. Hide it and leave the owner marker alone;
      // when recovery ends this effect re-runs and presents the still-valid
      // decision through the normal path.
      setOwnershipPrompt(null);
      setCanRestore(false);
      return;
    }

    if (!signedIn || !userId) {
      Storage.setStorageMode(Storage.STORAGE_MODES.LOCAL);
      // Reset phases so the next sign-in (possibly a different user) starts
      // clean. The owner marker is deliberately NOT cleared: local history is
      // retained on sign-out and still belongs to that user.
      resetPhase(SYNC_PHASE.BOOTSTRAP);
      resetPhase(SYNC_PHASE.SYNC);
      setOwnershipPrompt(null);
      setCanRestore(false);
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
        // Offer the pull-only restore only on a verifiably empty device, so
        // "Download my account's data" can never push local state up (#499).
        const empty = await isLocalDataEmpty();
        if (cancelled) return;
        setCanRestore(empty);
        setOwnershipPrompt({ type: 'first-upload' });
      } else {
        // A different userId or 'unknown': the data belongs to someone else.
        setOwnershipPrompt({ type: 'foreign' });
      }
    })().catch(() => {});

    return () => { cancelled = true; };
  }, [configured, authLoading, recoveryActive, signedIn, userId, runInitialSync]);

  return {
    ownershipPrompt,
    canRestore,
    confirmOwnershipUpload,
    downloadAccountData,
    startFreshOnDevice,
    dismissOwnershipPrompt,
    consentDenial,
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

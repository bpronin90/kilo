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
  getCloudRebuildGeneration,
  setCloudRebuildGeneration,
} from '../../storage/entries/localDataOwner';
import { fetchConsentStatus } from '../../storage/cloud/consent';
import { rebuildCloudCopy } from '../../storage/cloud/syncAdapter';

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
// Checks the server's consent status and, on a denial, also moves storage to
// local-only (a denial is a storage-mode boundary: keeping the cloud adapter
// active would let ordinary entry-hook refreshes bypass this preflight seam
// and try consent-gated reads/writes one table at a time). Local data remains
// usable either way, including retained raw tombstones needed for later
// convergence.
//
// On success returns the full consent payload, not just a boolean: callers
// that select a sync runner need `consent.cloud_rebuild_generation` (issue
// #538) — the server-authenticated monotonic counter of how many times a
// verified-zero purge has emptied this account's cloud copy. A device whose
// own last-rebuilt generation is behind it must run a full rebuild rather than
// an ordinary pass. It is a plain field on the same payload fetchConsentStatus
// already returns, so no extra round trip is needed.
async function checkConsent() {
  const consent = await fetchConsentStatus();
  if (consent.allowed) return { ok: true, consent };
  Storage.setStorageMode(Storage.STORAGE_MODES.LOCAL);
  return {
    ok: false,
    denial: {
      ok: false,
      code: consent.code,
      consentDenied: true,
      error: 'Cloud Sync needs your consent to store health data.',
    },
  };
}

function makeBootstrapRunner(user) {
  const userId = user?.id;
  if (!userId) return null;
  return () => cloudAdapter.bootstrapFromLocal(userId);
}

// Select the SYNC_PHASE.SYNC runner for this pass (issue #538). When the
// server's cloud_rebuild_generation is ahead of the one THIS device last
// rebuilt for, the ordinary adapter.sync() pass is replaced by a runner that
// calls rebuildCloudCopy() (rearm every gated table + push + reconcile through
// the same sync engine) and, only after it succeeds, records the caught-up
// generation for this device. Both branches run under the identical
// SYNC_PHASE.SYNC state machine, so the UI and retry behavior are unchanged —
// only which operation "Sync Now" / automatic sign-in sync actually performs.
//
// Per-device on purpose: the generation write is local to this device, so two
// of an account's devices each rebuild their own complete local copy rather
// than the first one to sync clearing a single server flag for the rest.
// `ownedDevice` (issue #525, round 4) is forwarded to adapter.sync() so the
// unbaselined reconciliation can tell a genuine clean-device first download from
// an owned device whose pull cursor was cleared (see reconcileAgainstRemote). It
// is true only on the ordinary owned-device sync paths; the #538 rebuild branch
// below is a first-download-shaped rebuild and deliberately leaves it false.
async function selectSyncRunner(consent, userId, { ownedDevice = false } = {}) {
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
  if (adapter.mode === 'local' || typeof adapter.sync !== 'function') return null;

  const serverGeneration = Number(consent?.cloud_rebuild_generation ?? 0);
  const deviceGeneration = await getCloudRebuildGeneration(userId);
  if (userId && serverGeneration > deviceGeneration) {
    return async () => {
      const result = await rebuildCloudCopy();
      if (result && result.ok === false) return result;
      // Advance this device's generation only after the rebuild AND its
      // reconciliation pass have both succeeded. A failure to persist here is
      // treated like any other phase failure (a retry re-rebuilds, which is
      // idempotent), mirroring how the bootstrap runner treats its owner write.
      await setCloudRebuildGeneration(userId, serverGeneration);
      return result;
    };
  }
  return () => adapter.sync({ ownedDevice });
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
    const checked = await checkConsent();
    if (!checked.ok) return checked.denial;
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
    const checked = await checkConsent();
    if (!checked.ok) return checked.denial;
    // Manual "Sync Now" only reaches a cloud adapter, which means ownership is
    // already established — an owned device (#525, round 4).
    const runner = await selectSyncRunner(checked.consent, userId, { ownedDevice: true });
    if (!runner) {
      return {
        ok: false,
        error: 'Cloud sync is not available in this build yet.',
      };
    }
    return runPhase(SYNC_PHASE.SYNC, runner);
  }, [userId]);

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

  const runInitialSync = useCallback(async ({ ownedDevice = false } = {}) => {
    // The automatic path is exactly where an ungated upload would be most damaging:
    // it runs on sign-in, with no user watching. A user who has not granted
    // health-data consent must not have their history pushed to the cloud simply
    // because they signed in on a new device.
    const checked = await checkConsent();
    if (!checked.ok) {
      setConsentDenial(checked.denial.code);
      return;
    }
    setConsentDenial(null);
    if (getSyncState()[SYNC_PHASE.SYNC].status === SYNC_STATUS.IDLE) {
      // This is the primary path issue #538 fixes: a same-owner device skips
      // bootstrap entirely on sign-in and lands here automatically, with no
      // user action. selectSyncRunner compares cloud_rebuild_generation from
      // the SAME preflight response against this device's own last-rebuilt
      // generation and silently substitutes the full rebuild for the ordinary
      // sync pass whenever this device has not yet caught up to a completed
      // withdrawal purge — otherwise a same-owner re-grant after a purge would
      // report "Fully synced" while the cloud copy stayed empty.
      const runner = await selectSyncRunner(checked.consent, userId, { ownedDevice });
      if (runner) await runPhase(SYNC_PHASE.SYNC, runner);
    }
    onSyncCompleteRef.current?.();
  }, [userId]);

  // The user confirmed the upload (first-sign-in claim of unclaimed data, or a
  // deliberate upload of another account's data into theirs).
  const confirmOwnershipUpload = useCallback(async () => {
    if (!userId) return { ok: false, error: 'Not signed in.' };
    // Confirming ownership is not consent. This upload is the largest health-data
    // write the app makes, so it needs its own grant check.
    const checked = await checkConsent();
    if (!checked.ok) {
      setConsentDenial(checked.denial.code);
      return checked.denial;
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
    // Establishing ownership, not an owned-device resync: bootstrap just pushed
    // the full local set, so absent-local remote rows are legitimately
    // never-downloaded and must be pulled, not conflicted (#525, round 4). Leave
    // ownedDevice at its safe false default.
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
    // A just-purged device is a first download, not an owned resync: leave
    // ownedDevice false so the full remote set downloads without a conflict
    // (#525, round 4).
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
    // A verified-empty device explicitly downloading its account: this is the
    // canonical clean first download, so ownedDevice stays false and the full
    // remote set arrives without a conflict (#525, round 4).
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
            // Route through runInitialSync rather than duplicating its consent
            // check and rebuild-aware runner selection inline (issue #538): this
            // branch (the effect re-running mid-session, e.g. once a password
            // recovery interruption clears) is exactly as capable of landing on a
            // same-owner device whose grant still awaits a post-purge rebuild as
            // the ordinary sign-in path is.
            //
            // Bootstrap is already COMPLETE, so this device owns its data — pass
            // ownedDevice so a cleared cursor cannot silently restore a signed-out
            // delete as success (#525, round 4).
            if (!cancelled) await runInitialSync({ ownedDevice: true });
          }
        }
        return;
      }

      const owner = await getLocalDataOwner();
      if (cancelled) return;

      if (owner === userId) {
        // Local data is already theirs — nothing to bootstrap. Activate cloud
        // mode and sync normally (this keeps #432's purpose intact). This is the
        // owned-device path #525 (round 4) protects: a cleared cursor here must
        // surface a signed-out delete as a conflict, not restore it as success.
        Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
        markComplete(SYNC_PHASE.BOOTSTRAP);
        if (!cancelled) await runInitialSync({ ownedDevice: true });
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

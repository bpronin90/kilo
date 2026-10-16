import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import { Button, SectionTitle } from '../../components/UI';
import { useThemedStyles } from '../../theme/ThemeContext';
import { useSyncRecovery, useCloudExport } from '../../hooks/useEntries';
import { useUnfinishedRename } from '../../hooks/entries/syncRecoveryHooks';
import * as Storage from '../../storage/entries';
import { SYNC_STATUS } from '../../storage/syncRecovery';
import { subscribeDirtyQueue } from '../../storage/syncQueue';
import { getPendingSyncIntent } from '../../storage/cloud/syncAdapter';
import { OWNER_UNCLAIMED, getLocalDataOwner } from '../../storage/entries/localDataOwner';
import { HealthDataConsent } from './HealthDataConsent';
import {
  DENIAL_CODES,
  WITHDRAWAL_COPY,
  fetchConsentStatus,
  withdrawConsent,
  requestHealthDataDeletion,
} from '../../storage/cloud/consent';
import appConfig from '../../app.json';
import { TYPOGRAPHY, useKuaTypography } from '../../theme/typography';

// Local unfinished-rename recovery (#1402, #1417): no account or consent needed.
// Hosted in the cloud panel it shares that panel's busy interlock; standalone
// (signed-out BackupScreen) it keeps its own.
export function UnfinishedRenameRecovery({ busy: sharedBusy, setBusy: setSharedBusy }) {
  const styles = useThemedStyles(createStyles);
  const { found: renameFound, discard: discardRename } = useUnfinishedRename();
  // The record shown when the confirmation opened; discard revalidates it.
  const [renameConfirmRaw, setRenameConfirmRaw] = useState(null);
  const [renameStatus, setRenameStatus] = useState('');
  const [localBusy, setLocalBusy] = useState(false);
  const busy = sharedBusy ?? localBusy;
  const setBusy = setSharedBusy ?? setLocalBusy;

  const handleDiscardRename = async () => {
    setBusy(true);
    try {
      const { message } = await discardRename(renameConfirmRaw);
      setRenameConfirmRaw(null);
      setRenameStatus(message);
    } finally {
      setBusy(false);
    }
  };

  const renameBlocked = renameFound.status === 'blocked';
  return renameBlocked || renameStatus ? (
    <View style={styles.summaryBlock} testID="unfinished-rename-recovery">
      {renameBlocked ? (
        <>
          <Text style={styles.syncLabel}>Unfinished rename</Text>
          <Text style={styles.accountNote} accessibilityLabel="Unfinished rename">
            A routine rename on this device was interrupted and cannot be finished
            or undone automatically. Until it is cleared, saving routines, changing
            tracked lifts and syncing are paused. Discarding it stops the unfinished
            rename; your current notes and tracked lifts stay exactly as they are.
          </Text>
          {renameConfirmRaw === null ? (
            <Button title="Discard unfinished rename" disabled={busy} accessibilityLabel="Discard unfinished rename"
              onPress={() => { setRenameStatus(''); setRenameConfirmRaw(renameFound.raw); }} />
          ) : (
            <>
              <Text style={styles.phaseDesc} accessibilityLabel="Discard unfinished rename confirmation">
                Discard the unfinished rename? A private copy of the record is kept
                on this device only; it is not synced or included in backups.
              </Text>
              <Button title="Discard" tone="danger" loadingTitle="Working…" disabled={busy}
                onPress={handleDiscardRename} accessibilityLabel="Confirm discard unfinished rename" />
              <Button title="Cancel" disabled={busy} onPress={() => setRenameConfirmRaw(null)}
                accessibilityLabel="Cancel discard unfinished rename" />
            </>
          )}
        </>
      ) : null}
      {renameStatus ? <Text style={styles.accountStatus} accessibilityLabel="Unfinished rename status">{renameStatus}</Text> : null}
    </View>
  ) : null;
}

// User-facing cloud bootstrap/sync recovery panel (Phase 4 / Task 12).
//
// Shows whether each phase is idle/running/failed/complete and offers a
// non-destructive retry only when a phase has failed. There are deliberately no
// admin/support controls here — only the signed-in user's own retry/export.
export function CloudSyncRecovery({ user, onConsentDismiss }) {
  const styles = useThemedStyles(createStyles);
  const typography = useKuaTypography();
  const { bootstrap, sync, runBootstrap, runSync, retryBootstrap, retrySync } =
    useSyncRecovery(user);
  const { exportCloud } = useCloudExport();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [confirmingForeignUpload, setConfirmingForeignUpload] = useState(false);
  const [pendingIntent, setPendingIntent] = useState({ known: false, hasPending: false });
  const pendingIntentMounted = useRef(true);

  const refreshPendingIntent = useCallback(async () => {
    try {
      const next = await getPendingSyncIntent();
      if (pendingIntentMounted.current) setPendingIntent({ known: true, ...next });
    } catch {
      // An unknown local cache must never become a cloud claim; stay conservative.
      if (pendingIntentMounted.current) setPendingIntent({ known: false, hasPending: false });
    }
  }, []);

  useEffect(() => {
    pendingIntentMounted.current = true;
    refreshPendingIntent();
    const unsubscribe = subscribeDirtyQueue(refreshPendingIntent);
    return () => {
      pendingIntentMounted.current = false;
      unsubscribe();
    };
  }, [refreshPendingIntent]);

  // Health-data consent (#487). `consent` is the server's answer, never a local
  // preference: the backend is the authorization boundary and this state only
  // decides what to SHOW.
  const [consent, setConsent] = useState(null);
  const [showingConsent, setShowingConsent] = useState(false);
  const [confirmingWithdrawal, setConfirmingWithdrawal] = useState(false);

  const refreshConsent = useCallback(async () => {
    const next = await fetchConsentStatus();
    setConsent(next);
    return next;
  }, []);

  useEffect(() => {
    refreshConsent();
  }, [refreshConsent]);

  const phaseLabel = (s, phase) => {
    switch (s.status) {
      case SYNC_STATUS.RUNNING:
        return 'Running…';
      case SYNC_STATUS.FAILED:
        return 'Failed';
      case SYNC_STATUS.COMPLETE:
        return phase === 'bootstrap' ? 'Recovery complete' : 'Server-confirmed pass complete';
      default:
        return 'Idle';
    }
  };

  const cloudStatusLabel = () => {
    if (sync.status === SYNC_STATUS.RUNNING) return 'Syncing with server';
    if (sync.status === SYNC_STATUS.FAILED) return 'Sync failed. Retry needed';
    if (pendingIntent.hasPending) return 'Changes queued for cloud sync';
    if (sync.status === SYNC_STATUS.COMPLETE && pendingIntent.known) {
      return 'Server acknowledged. Up to date';
    }
    if (bootstrap.status === SYNC_STATUS.COMPLETE) {
      return 'Recovery upload complete. Sync still needs to run';
    }
    return 'Saved on this device';
  };

  // Run a phase against its bound runner. Used both for the initial action
  // (drives idle → running → complete/failed for normal, first-time work) and
  // for retry after a failure. The hook binds bootstrap to
  // cloudAdapter.bootstrapFromLocal(userId) and sync to the active adapter's
  // sync() (feature-detected). The store drives the status transitions and
  // leaves local data untouched on failure.
  const handleRun = async (kind, runner) => {
    setBusy(true);
    setStatus('');
    try {
      const result = await runner();
      setStatus(
        result?.ok
          ? `${kind === 'bootstrap' ? 'Local history uploaded' : 'Sync'} complete.`
          : 'Could not complete. Try again.'
      );
    } finally {
      setBusy(false);
    }
  };

  // Ownership gate for the manual upload (#450): foreign or unidentifiable
  // local history needs explicit confirmation; unclaimed or own data uploads
  // directly (pressing the button is the consent).
  const handleBootstrapPress = async () => {
    const owner = await getLocalDataOwner();
    if (owner !== OWNER_UNCLAIMED && owner !== user?.id) {
      setConfirmingForeignUpload(true);
      return;
    }
    await handleRun('bootstrap', runBootstrap);
  };

  const isRunning = (s) => s.status === SYNC_STATUS.RUNNING;
  // The initial action is offered while a phase has never run (idle) and is not
  // already running. Once it fails it becomes retryable and the retry button
  // takes over.
  const canStart = (s) => s.status === SYNC_STATUS.IDLE;

  const handleCloudExport = async () => {
    setBusy(true);
    setStatus('');
    try {
      // Pass the signed-in identity so the export carries cloud.account.
      // buildCloudExport reduces this to non-sensitive { id, email }.
      const account = user ? { id: user.id, email: user.email } : null;
      const result = await exportCloud(account);
      if (!result.ok) {
        setStatus(result.error || 'Cloud export failed.');
        return;
      }
      await Share.share({ message: result.json });
      setStatus('Cloud export ready.');
    } catch {
      setStatus('Cloud export failed.');
    } finally {
      setBusy(false);
    }
  };

  // Withdrawal: the server blocks access and queues the purge atomically, then
  // the worker is kicked. A failed kick is not a failed withdrawal (cron retries
  // the durable job), so the user is told deletion is in progress, never failed
  // and never finished early.
  const handleWithdraw = async () => {
    setBusy(true);
    setStatus('');
    try {
      const result = await withdrawConsent();
      if (!result.ok) {
        setStatus(result.error || 'Could not withdraw consent. Cloud Sync is unchanged.');
        return;
      }
      // consent_withdraw atomically blocks health access before returning. Move
      // the client to local-only mode immediately so mounted entry hooks cannot
      // start another consent-gated refresh while the purge is pending.
      Storage.setStorageMode(Storage.STORAGE_MODES.LOCAL);
      setConfirmingWithdrawal(false);
      await requestHealthDataDeletion();
      await refreshConsent();
      setStatus('Cloud Sync is off. Your cloud health data is being deleted; your data on this device is untouched.');
    } finally {
      setBusy(false);
    }
  };

  // The server grant is already durable here. Select the safe activation:
  //   own history                -> ordinary sync (or #538's signalled rebuild)
  //   unclaimed / foreign history -> keep local mode for the ownership choice
  // A failed phase stays retryable and never clears local data; success copy is
  // withheld until every required phase has completed.
  const handleConsentGranted = async () => {
    setShowingConsent(false);
    setBusy(true);
    setStatus('');
    try {
      const owner = await getLocalDataOwner();
      await refreshConsent();

      if (owner !== user?.id) {
        setStatus(
          owner === OWNER_UNCLAIMED
            ? 'Consent was recorded, but Cloud Sync is still off. Choose whether to upload the history on this device or download your account copy.'
            : 'Consent was recorded, but Cloud Sync is still off. Choose how to handle the history already on this device.',
        );
        return;
      }

      // A denied preflight deliberately moved the app to local-only mode.
      // Restore cloud routing for this signed-in owner so runSync can execute;
      // its own preflight moves back to local mode if the grant cannot be
      // confirmed. Post-purge re-consent is selected inside runSync from the
      // server-authenticated cloud rebuild generation.
      Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
      const result = await runSync();

      setStatus(
        result?.ok
          ? 'Cloud Sync is on.'
          : 'Consent was recorded, but Cloud Sync could not finish. Your data on this device is safe. Try again.',
      );
    } catch {
      setStatus(
        'Consent was recorded, but Cloud Sync could not finish. Your data on this device is safe. Try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  const denialCode = consent && !consent.allowed ? consent.code : null;
  const deletionPending = denialCode === DENIAL_CODES.HEALTH_DATA_DELETION_PENDING;
  const needsConsent =
    denialCode === DENIAL_CODES.CONSENT_REQUIRED ||
    denialCode === DENIAL_CODES.CONSENT_VERSION_STALE;
  const needsUpdate = denialCode === DENIAL_CODES.CLIENT_UPDATE_REQUIRED;
  const syncAllowed = Boolean(consent?.allowed);

  // A purge is in flight. The user gets deletion status and a support path — NOT a
  // sync toggle that would appear to work and silently do nothing.
  if (deletionPending) {
    return (
      <View style={styles.accountBlock}>
        <SectionTitle>Cloud Sync</SectionTitle>
        <Text style={styles.accountNote} accessibilityLabel="Deletion pending">
          Cloud Sync is off and your cloud health data is being deleted. This can take
          a few minutes. Your data on this device and your Kilo account are unaffected.
          You can turn Cloud Sync back on once the deletion finishes.
        </Text>
        <UnfinishedRenameRecovery busy={busy} setBusy={setBusy} />
      </View>
    );
  }

  if (needsUpdate) {
    return (
      <View style={styles.accountBlock}>
        <SectionTitle>Cloud Sync</SectionTitle>
        <Text style={styles.accountNote} accessibilityLabel="Client update required">
          This version of Kilo can no longer sync health data. Update Kilo to continue
          syncing. Your data on this device is safe and every local feature still works.
        </Text>
        <UnfinishedRenameRecovery busy={busy} setBusy={setBusy} />
      </View>
    );
  }

  // The consent surface is the entry point to Cloud Sync, and it is a dedicated
  // step: no sync control is offered behind it until the server confirms a grant.
  if (showingConsent) {
    return (
      <View style={styles.accountBlock}>
        <HealthDataConsent
          appVersion={appConfig.expo.version}
          onGranted={handleConsentGranted}
          onDecline={() => {
            // Records no grant and leaves Cloud Sync off. Every local feature keeps
            // working; refusal must cost the user nothing.
            setShowingConsent(false);
            setStatus('Cloud Sync stays off. Kilo keeps working on this device.');
            onConsentDismiss?.();
          }}
        />
      </View>
    );
  }

  return (
    <View
      style={styles.accountBlock}
      testID="cloud-sync-recovery-panel"
      // Inactive tabs stay mounted (display:none); re-read when visible so
      // diff-tracked settings/history writes are caught.
      onLayout={refreshPendingIntent}
    >
      <SectionTitle>Cloud Sync</SectionTitle>

      <Text style={styles.accountNote}>
        Your training history is your offline working copy and is always saved on
        this device. Your account keeps a cloud copy in sync with it, so you can
        continue on another device or after reinstalling. Syncing reconciles the
        two — for any item changed in both places, the most recent change wins.
      </Text>

      <UnfinishedRenameRecovery busy={busy} setBusy={setBusy} />

      {needsConsent ? (
        <View style={styles.summaryBlock}>
          <Text style={styles.accountNote} accessibilityLabel="Consent required">
            {denialCode === DENIAL_CODES.CONSENT_VERSION_STALE
              ? 'Kilo has updated what it asks you to agree to for cloud health data. Review it to turn Cloud Sync back on.'
              : 'Cloud Sync stores health and fitness data, so Kilo needs your explicit consent before it can turn on.'}
            {consent?.quarantine_expires_at
              ? ' Until then your existing cloud data is retained only so you can export it or delete it.'
              : ''}
          </Text>
          <Button
            title="Review and enable Cloud Sync"
            disabled={busy}
            onPress={() => setShowingConsent(true)}
            accessibilityLabel="Review and enable Cloud Sync"
          />
          {/* Export stays available to a non-granting user: the right of access
              does not depend on the Art. 9 consent, and the quarantine window
              explicitly offers "export, then delete". */}
          <Button
            title="Export Cloud Copy"
            loadingTitle="Working…"
            disabled={busy}
            onPress={handleCloudExport}
          />
        </View>
      ) : null}

      {/* Everything below is a health-data operation, so it appears only once the
          SERVER confirms an active grant. Rendering these controls to a user who
          has not consented would offer them an action the backend will refuse. */}
      {!syncAllowed ? null : (
      <>
      <View style={styles.summaryBlock}>
        <View style={styles.syncRow}>
          <Text style={styles.syncLabel}>Cloud status</Text>
          <Text style={[styles.syncValue, typography['label-lg']]} accessibilityLabel="Cloud sync summary">
            {cloudStatusLabel()}
          </Text>
        </View>
        <Text style={styles.phaseDesc}>
          Local data stays saved on this device while cloud sync is pending or failed.
        </Text>
      </View>

      <View style={styles.syncRow}>
        <Text style={styles.syncLabel}>Upload your local history</Text>
        <Text style={[styles.syncValue, typography['label-lg']]} accessibilityLabel={`Bootstrap status ${bootstrap.status}`}>
          {phaseLabel(bootstrap, 'bootstrap')}
        </Text>
      </View>
      <Text style={styles.phaseDesc}>
        First-time setup. Sends the history already on this device up to your
        account. Run this once after signing in.
      </Text>
      {canStart(bootstrap) && !confirmingForeignUpload ? (
        <Button
          title="Upload Local History"
          loadingTitle="Working…"
          disabled={busy || isRunning(bootstrap)}
          onPress={handleBootstrapPress}
        />
      ) : null}
      {confirmingForeignUpload ? (
        <View style={styles.summaryBlock}>
          <Text style={styles.phaseDesc} accessibilityLabel="Foreign data warning">
            The history on this device belongs to a different account. Uploading
            will copy it into the account you are signed in to now. Only continue
            if this is really your data.
          </Text>
          <Button
            title="Upload Anyway"
            loadingTitle="Working…"
            disabled={busy}
            onPress={async () => {
              setConfirmingForeignUpload(false);
              await handleRun('bootstrap', runBootstrap);
            }}
          />
          <Button
            title="Cancel"
            disabled={busy}
            onPress={() => setConfirmingForeignUpload(false)}
          />
        </View>
      ) : null}
      {bootstrap.retryable ? (
        <Button
          title="Retry Upload"
          loadingTitle="Working…"
          disabled={busy}
          onPress={() => handleRun('bootstrap', retryBootstrap)}
        />
      ) : null}

      <View style={styles.syncRow}>
        <Text style={styles.syncLabel}>Keep device and account in sync</Text>
        <Text style={[styles.syncValue, typography['label-lg']]} accessibilityLabel={`Sync status ${sync.status}`}>
          {phaseLabel(sync, 'sync')}
        </Text>
      </View>
      <Text style={styles.phaseDesc}>
        Ongoing sync. Sends your newer changes up and pulls newer changes down so
        this device and your account match. Run this after logging new workouts or
        when switching devices.
      </Text>
      {canStart(sync) ? (
        <Button
          title="Sync Now"
          loadingTitle="Working…"
          disabled={busy || isRunning(sync)}
          onPress={() => handleRun('sync', runSync)}
        />
      ) : null}
      {sync.retryable ? (
        <Button
          title="Retry Sync"
          loadingTitle="Working…"
          disabled={busy}
          onPress={() => handleRun('sync', retrySync)}
        />
      ) : null}

      <Text style={styles.accountNote}>
        Retrying is safe to run as often as you like. It never deletes your
        history; if the same item was edited in two places, the most recent edit
        is kept.
      </Text>

      <Text style={styles.phaseDesc}>
        Exports the training history and settings currently saved on this
        device, with your account identity attached. Use this to move your
        local data elsewhere.
      </Text>
      <Button
        title="Export Cloud Copy"
        loadingTitle="Working…"
        disabled={busy}
        onPress={handleCloudExport}
      />

      {/* Withdrawal. Turning Cloud Sync off IS the withdrawal mechanism, and the
          control says what it actually does. A "pause" that quietly leaves the
          cloud copy in place would not be a withdrawal at all, and Art. 7(3)
          requires withdrawing to be as easy as consenting — so this lives here,
          one tap from the toggle that turned it on, not behind account deletion. */}
      {!confirmingWithdrawal ? (
        <Button
          title="Turn Off Cloud Sync"
          disabled={busy}
          onPress={() => setConfirmingWithdrawal(true)}
          accessibilityLabel="Turn Off Cloud Sync"
        />
      ) : (
        <View style={styles.summaryBlock}>
          <Text style={styles.syncLabel} accessibilityLabel={WITHDRAWAL_COPY.title}>
            {WITHDRAWAL_COPY.title}
          </Text>
          <Text style={styles.accountNote} accessibilityLabel="Withdrawal disclosure">
            {WITHDRAWAL_COPY.body}
          </Text>
          <Button
            title={WITHDRAWAL_COPY.primaryAction}
            loadingTitle="Working…"
            disabled={busy}
            onPress={handleWithdraw}
            accessibilityLabel={WITHDRAWAL_COPY.primaryAction}
          />
          <Button
            title={WITHDRAWAL_COPY.secondaryAction}
            disabled={busy}
            onPress={() => setConfirmingWithdrawal(false)}
            accessibilityLabel={WITHDRAWAL_COPY.secondaryAction}
          />
        </View>
      )}
      </>
      )}

      {status ? (
        <Text style={styles.accountStatus} accessibilityLabel="Cloud sync status">
          {status}
        </Text>
      ) : null}
    </View>
  );
}

// Under the production KUA gate (`kua` supplied) text ink resolves through the
// selected court palette; with `kua` null (isolated tests) the legacy palette.
export const createStyles = (colors, kua = null) => StyleSheet.create({
  accountBlock: {
    gap: 12,
  },
  summaryBlock: {
    gap: 8,
  },
  accountNote: {
    fontSize: TYPOGRAPHY['body-md'].fontSize,
    color: kua ? kua.onSurface : colors.text,
    lineHeight: 22,
    marginBottom: 12,
  },
  phaseDesc: {
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    lineHeight: 18,
    marginTop: -2,
  },
  accountStatus: {
    fontSize: TYPOGRAPHY['body-md'].fontSize,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    marginTop: 16,
  },
  syncRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  syncLabel: {
    fontSize: TYPOGRAPHY['body-md'].fontSize,
    fontWeight: '600',
    color: kua ? kua.onSurface : colors.text,
  },
  syncValue: {
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    flexShrink: 1,
    textAlign: 'right',
    marginLeft: 12,
  },
});

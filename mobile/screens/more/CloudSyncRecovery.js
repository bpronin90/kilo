import React, { useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import { Button, SectionTitle } from '../../components/UI';
import { Colors } from '../../theme/colors';
import { useSyncRecovery, useCloudExport } from '../../hooks/useEntries';
import { SYNC_STATUS } from '../../storage/syncRecovery';

// User-facing cloud bootstrap/sync recovery panel (Phase 4 / Task 12).
//
// Shows whether each phase is idle/running/failed/complete and offers a
// non-destructive retry only when a phase has failed. There are deliberately no
// admin/support controls here — only the signed-in user's own retry/export.
export function CloudSyncRecovery({ user }) {
  const { bootstrap, sync, runBootstrap, runSync, retryBootstrap, retrySync } =
    useSyncRecovery(user);
  const { exportCloud } = useCloudExport();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const phaseLabel = (s) => {
    switch (s.status) {
      case SYNC_STATUS.RUNNING:
        return 'Running…';
      case SYNC_STATUS.FAILED:
        return 'Failed';
      case SYNC_STATUS.COMPLETE:
        return 'Complete';
      default:
        return 'Idle';
    }
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
          : 'Could not complete — try again.'
      );
    } finally {
      setBusy(false);
    }
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

  return (
    <View style={styles.accountBlock}>
      <SectionTitle>Cloud Sync</SectionTitle>

      <Text style={styles.accountNote}>
        Your training history is your offline working copy and is always saved on
        this device. Your account keeps a cloud copy in sync with it, so you can
        continue on another device or after reinstalling. Syncing reconciles the
        two — for any item changed in both places, the most recent change wins.
      </Text>

      <View style={styles.syncRow}>
        <Text style={styles.syncLabel}>Upload your local history</Text>
        <Text style={styles.syncValue} accessibilityLabel={`Bootstrap status ${bootstrap.status}`}>
          {phaseLabel(bootstrap)}
        </Text>
      </View>
      <Text style={styles.phaseDesc}>
        First-time setup. Sends the history already on this device up to your
        account. Run this once after signing in.
      </Text>
      {canStart(bootstrap) ? (
        <Button
          title="Upload Local History"
          loadingTitle="Working…"
          disabled={busy || isRunning(bootstrap)}
          onPress={() => handleRun('bootstrap', runBootstrap)}
        />
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
        <Text style={styles.syncValue} accessibilityLabel={`Sync status ${sync.status}`}>
          {phaseLabel(sync)}
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

      {status ? (
        <Text style={styles.accountStatus} accessibilityLabel="Cloud sync status">
          {status}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  accountBlock: {
    gap: 12,
  },
  accountNote: {
    fontSize: 15,
    color: Colors.text,
    lineHeight: 22,
    marginBottom: 12,
  },
  phaseDesc: {
    fontSize: 13,
    color: Colors.textMuted,
    lineHeight: 18,
    marginTop: -2,
  },
  accountStatus: {
    fontSize: 14,
    color: Colors.textMuted,
    marginTop: 16,
  },
  syncRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  syncLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  syncValue: {
    fontSize: 14,
    color: Colors.textMuted,
    flexShrink: 1,
    textAlign: 'right',
    marginLeft: 12,
  },
});

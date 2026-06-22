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
        return `Failed${s.error ? `: ${s.error}` : ''}`;
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
          ? `${kind === 'bootstrap' ? 'Bootstrap' : 'Sync'} complete.`
          : result?.error || 'Could not start.'
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

      <View style={styles.syncRow}>
        <Text style={styles.syncLabel}>Bootstrap</Text>
        <Text style={styles.syncValue} accessibilityLabel={`Bootstrap status ${bootstrap.status}`}>
          {phaseLabel(bootstrap)}
        </Text>
      </View>
      {canStart(bootstrap) ? (
        <Button
          title={busy ? 'Working…' : 'Run Bootstrap'}
          disabled={busy || isRunning(bootstrap)}
          onPress={() => handleRun('bootstrap', runBootstrap)}
        />
      ) : null}
      {bootstrap.retryable ? (
        <Button
          title={busy ? 'Working…' : 'Retry Bootstrap'}
          disabled={busy}
          onPress={() => handleRun('bootstrap', retryBootstrap)}
        />
      ) : null}

      <View style={styles.syncRow}>
        <Text style={styles.syncLabel}>Sync</Text>
        <Text style={styles.syncValue} accessibilityLabel={`Sync status ${sync.status}`}>
          {phaseLabel(sync)}
        </Text>
      </View>
      {canStart(sync) ? (
        <Button
          title={busy ? 'Working…' : 'Run Sync'}
          disabled={busy || isRunning(sync)}
          onPress={() => handleRun('sync', runSync)}
        />
      ) : null}
      {sync.retryable ? (
        <Button
          title={busy ? 'Working…' : 'Retry Sync'}
          disabled={busy}
          onPress={() => handleRun('sync', retrySync)}
        />
      ) : null}

      <Text style={styles.accountNote}>
        Retrying is safe and never overwrites your local data.
      </Text>

      <Button
        title={busy ? 'Working…' : 'Export Cloud Data'}
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

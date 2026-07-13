import { useEffect, useState } from 'react';
import { SYNC_PHASE, SYNC_STATUS, getSyncState, loadLastSuccessfulSyncAt, subscribeSyncState } from '../storage/syncRecovery';
import { SYNC_TABLES, getDirtyRecords, subscribeDirtyQueue } from '../storage/syncQueue';

function formatSyncTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function summarizeCloudSync(syncState, dirtyCount, lastSuccessfulAt) {
  const bootstrap = syncState[SYNC_PHASE.BOOTSTRAP] || {};
  const sync = syncState[SYNC_PHASE.SYNC] || {};
  const isRunning = bootstrap.status === SYNC_STATUS.RUNNING || sync.status === SYNC_STATUS.RUNNING;
  const hasFailed = bootstrap.status === SYNC_STATUS.FAILED || sync.status === SYNC_STATUS.FAILED;
  const hasDirty = dirtyCount > 0;
  const hasLastSuccess = Boolean(lastSuccessfulAt);

  let statusLabel = 'Ready to sync';
  if (isRunning) {
    statusLabel = 'Syncing';
  } else if (hasFailed) {
    statusLabel = 'Last sync failed';
  } else if (hasDirty) {
    statusLabel = dirtyCount === 1 ? '1 pending local change' : `${dirtyCount} pending local changes`;
  } else if (hasLastSuccess) {
    statusLabel = 'Fully synced';
  }

  return {
    statusLabel,
    dirtyCount,
    lastSuccessfulAt,
    lastSuccessfulLabel: formatSyncTimestamp(lastSuccessfulAt),
    isRunning,
    hasFailed,
    hasDirty,
    hasLastSuccess,
  };
}

async function loadDirtyCount() {
  const counts = await Promise.all(
    Object.values(SYNC_TABLES).map((table) => getDirtyRecords(table).then((records) => records.length))
  );
  return counts.reduce((sum, count) => sum + count, 0);
}

export function useCloudSyncStatus() {
  const [summary, setSummary] = useState(() => summarizeCloudSync(getSyncState(), 0, null));

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const [syncState, dirtyCount, lastSuccessfulAt] = await Promise.all([
        Promise.resolve(getSyncState()),
        loadDirtyCount(),
        loadLastSuccessfulSyncAt(),
      ]);
      if (!cancelled) {
        setSummary(summarizeCloudSync(syncState, dirtyCount, lastSuccessfulAt));
      }
    };

    refresh();
    const unsubscribeSync = subscribeSyncState(refresh);
    const unsubscribeDirty = subscribeDirtyQueue(refresh);

    return () => {
      cancelled = true;
      unsubscribeSync();
      unsubscribeDirty();
    };
  }, []);

  return summary;
}

export { getNoteSections } from './entries/noteSections';
export { useWeightGoal, useWeightEntries, reloadWeightEntries } from './entries/weightHooks';
export { useWorkoutNotes, reloadWorkoutNotes } from './entries/workoutNoteHooks';
export { useTrackedLifts } from './entries/trackedLiftHooks';
export { useDeloadNote, useDeloadHistory } from './entries/deloadHooks';
export { useFeatureToggles } from './entries/featureToggleHooks';
export { useUserProfile } from './entries/profileHooks';
export { useSyncRecovery, useCloudExport, useAutoSync } from './entries/syncRecoveryHooks';

import { createContext, useContext, useEffect, useState } from 'react';
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

// The two states worth interrupting a screen for (#737). Anything else — idle,
// running, fully synced — is ordinary background bookkeeping the user does not
// need to act on, so it produces no notice at all.
export const CLOUD_SYNC_NOTICE = {
  FAILED: 'failed',
  PENDING: 'pending',
};

// Queued-work copy that describes the QUEUE, never the network (#737). The
// dirty queue is a local record of writes that have not been sent yet; nothing
// about it implies a connection, an in-flight request, or an imminent attempt.
// So the copy says where the work is ("saved on this device") and what will
// move it ("Cloud Sync", the surface that actually runs a pass) and stops
// there. Kilo does no connectivity detection, so any "offline"/"reconnecting"
// wording here would be a claim the app cannot back up.
function pendingChangeCopy(dirtyCount) {
  const noun = dirtyCount === 1 ? 'change is' : 'changes are';
  return `${dirtyCount} ${noun} saved on this device and waiting for Cloud Sync.`;
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

  // Same precedence as statusLabel, deliberately: a pass that is running right
  // now supersedes the previous pass's failure, so a stale "did not finish"
  // never sits on screen while the retry it asks for is already in flight.
  let noticeKind = null;
  if (!isRunning && hasFailed) {
    noticeKind = CLOUD_SYNC_NOTICE.FAILED;
  } else if (!isRunning && hasDirty) {
    noticeKind = CLOUD_SYNC_NOTICE.PENDING;
  }

  let noticeTitle = null;
  let noticeMessage = null;
  if (noticeKind === CLOUD_SYNC_NOTICE.FAILED) {
    noticeTitle = 'Cloud Sync did not finish';
    // The failure is stated without blaming a cause the app did not observe,
    // and it leads with the thing the user actually cares about: nothing was
    // lost. The pending count is appended only when there is one.
    noticeMessage = hasDirty
      ? `Your last sync did not finish. ${pendingChangeCopy(dirtyCount)}`
      : 'Your last sync did not finish. Everything you logged is still saved on this device.';
  } else if (noticeKind === CLOUD_SYNC_NOTICE.PENDING) {
    noticeTitle = 'Waiting for Cloud Sync';
    noticeMessage = pendingChangeCopy(dirtyCount);
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
    noticeKind,
    noticeTitle,
    noticeMessage,
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

// One shell-owned sync summary for every mounted tab (#737).
//
// All five tabs stay mounted under display:none (#527), so a `useCloudSyncStatus()`
// call inside a screen is not one subscription — it is a permanent one per tab,
// each with its own duplicate dirty-queue scan, all re-running on every queue
// and phase broadcast. The app shell subscribes once and publishes the result
// here; screens read it and never subscribe.
//
// The value is `{ summary, retrySync, openCloudSync }`. `null` outside a
// provider is deliberate and is the standalone-render case (tests, and any
// screen mounted without the shell): consumers render no sync surface at all
// rather than inventing a summary the shell never produced.
export const CloudSyncContext = createContext(null);

export function useCloudSyncSummary() {
  return useContext(CloudSyncContext);
}

export { getNoteSections } from './entries/noteSections';
export { useWeightGoal, useWeightEntries, reloadWeightEntries } from './entries/weightHooks';
export { useWorkoutNotes, reloadWorkoutNotes } from './entries/workoutNoteHooks';
export { useTrackedLifts } from './entries/trackedLiftHooks';
export { useDeloadNote, useDeloadHistory } from './entries/deloadHooks';
export { useFeatureToggles } from './entries/featureToggleHooks';
export { useUserProfile } from './entries/profileHooks';
export { useSyncRecovery, useCloudExport, useAutoSync } from './entries/syncRecoveryHooks';
export {
  useRecoveryBlockState,
  useStartRecoveryBlock,
  isEligibleBaselineNote,
  isEligibleRecoveryWeekNote,
} from './entries/recoveryBlockHooks';

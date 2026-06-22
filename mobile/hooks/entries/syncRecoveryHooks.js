import { useState, useEffect, useCallback } from 'react';
import * as Storage from '../../storage/entries';
import { cloudAdapter } from '../../storage/cloudAdapter';
import {
  SYNC_PHASE,
  getSyncState,
  subscribeSyncState,
  runPhase,
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

  const runBootstrap = useCallback(() => {
    const runner = makeBootstrapRunner(user);
    if (!runner) {
      return Promise.resolve({
        ok: false,
        error: 'Sign in to bootstrap your cloud data.',
      });
    }
    return runPhase(SYNC_PHASE.BOOTSTRAP, runner);
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

export function useCloudExport() {
  const exportCloud = useCallback(async (account = null) => {
    try {
      const payload = await Storage.buildCloudExport({ account });
      return { ok: true, json: JSON.stringify(payload, null, 2), payload };
    } catch (e) {
      return { ok: false, error: e?.message || 'Failed to export cloud data.' };
    }
  }, []);

  return { exportCloud };
}

import { getStorageAdapter, getStorageMode, STORAGE_MODES } from '../../storage/entries';
import { markComplete, markFailed, markRunning, SYNC_PHASE } from '../../storage/syncRecovery';

export async function maybeSyncCloud() {
  if (getStorageMode() !== STORAGE_MODES.CLOUD) return;
  const adapter = getStorageAdapter();
  if (typeof adapter.sync !== 'function') return;
  markRunning(SYNC_PHASE.SYNC);
  try {
    await adapter.sync();
    markComplete(SYNC_PHASE.SYNC);
  } catch (error) {
    // Offline or transient failure: keep the local cache, expose a retryable
    // phase state, and invalidate any older complete/synced display.
    markFailed(SYNC_PHASE.SYNC, error);
  }
}

export function readVia(method, localFn) {
  if (getStorageMode() === STORAGE_MODES.CLOUD) {
    const adapter = getStorageAdapter();
    if (typeof adapter[method] === 'function') return adapter[method]();
  }
  return localFn();
}

export function writeVia(method, localFn, ...args) {
  if (getStorageMode() === STORAGE_MODES.CLOUD) {
    const adapter = getStorageAdapter();
    if (typeof adapter[method] === 'function') return adapter[method](...args);
  }
  return localFn(...args);
}

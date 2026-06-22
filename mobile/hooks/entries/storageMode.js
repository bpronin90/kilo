import { getStorageAdapter, getStorageMode, STORAGE_MODES } from '../../storage/entries';

export async function maybeSyncCloud() {
  if (getStorageMode() !== STORAGE_MODES.CLOUD) return;
  const adapter = getStorageAdapter();
  if (typeof adapter.sync !== 'function') return;
  try {
    await adapter.sync();
  } catch {
    // Offline or transient failure: keep the local cache, retry on next refresh.
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

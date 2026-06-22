import { localAdapter } from '../localAdapter';
import { cloudAdapter } from '../cloudAdapter';

const STORAGE_MODES = Object.freeze({ LOCAL: 'local', CLOUD: 'cloud' });

let activeStorageMode = STORAGE_MODES.LOCAL;

export function getStorageMode() {
  return activeStorageMode;
}

export function setStorageMode(mode) {
  activeStorageMode = mode === STORAGE_MODES.CLOUD ? STORAGE_MODES.CLOUD : STORAGE_MODES.LOCAL;
  return activeStorageMode;
}

export function getStorageAdapter() {
  return activeStorageMode === STORAGE_MODES.CLOUD ? cloudAdapter : localAdapter;
}

export { STORAGE_MODES };

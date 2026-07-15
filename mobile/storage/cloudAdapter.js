// Public compatibility barrel for the cloud storage adapter.
// Implementation is split into focused modules under storage/cloud/.
// All previously-exported names remain available from this file.

import { ADAPTER_METHODS } from './localAdapter';
import { CloudNotImplementedError } from './cloud/errors';
import { sync } from './cloud/syncAdapter';
import { bootstrapFromLocal } from './cloud/bootstrap';
import {
  loadWeightEntries,
  saveWeightEntry,
  updateWeightEntry,
  deleteWeightEntry,
  loadWorkoutNotes,
  saveWorkoutNoteItem,
  deleteWorkoutNoteItem,
} from './cloud/cloudDomainMethods';

export { CloudNotImplementedError } from './cloud/errors';
export { BootstrapError } from './cloud/errors';
export { synthesizeSessionsNote, buildBootstrapPlan } from './cloud/bootstrapPlan';
export { bootstrapFromLocal, isLocalDataEmpty } from './cloud/bootstrap';
export { setCloudTransport } from './cloud/transport';
export { setRecomputeDerived } from './cloud/transport';
export { sync } from './cloud/syncAdapter';

const IMPLEMENTED = {
  sync,
  loadWeightEntries,
  saveWeightEntry,
  updateWeightEntry,
  deleteWeightEntry,
  loadWorkoutNotes,
  saveWorkoutNoteItem,
  deleteWorkoutNoteItem,
};

function buildCloudAdapter() {
  const adapter = { mode: 'cloud', sync };
  for (const method of ADAPTER_METHODS) {
    adapter[method] = IMPLEMENTED[method]
      ? IMPLEMENTED[method]
      : () => {
          throw new CloudNotImplementedError(method);
        };
  }
  adapter.bootstrapFromLocal = bootstrapFromLocal;
  return adapter;
}

export const cloudAdapter = buildCloudAdapter();

export default cloudAdapter;

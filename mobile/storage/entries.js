export {
  loadTrackedLifts,
  saveTrackedLifts,
  loadWorkoutCollapsed,
  saveWorkoutCollapsed,
  loadFatigueMultiplier,
  saveFatigueMultiplier,
  loadWeightDateEditEnabled,
  saveWeightDateEditEnabled,
  loadDeloadDateEditEnabled,
  saveDeloadDateEditEnabled,
  loadFatigueTrackingEnabled,
  saveFatigueTrackingEnabled,
  loadDeloadModeEnabled,
  saveDeloadModeEnabled,
  loadWeighInReminder,
  saveWeighInReminder,
  loadWorkoutReminder,
  saveWorkoutReminder,
} from './entries/settings';

export {
  loadWeightEntries,
  loadWeightEntriesRaw,
  replaceWeightEntriesRaw,
  saveWeightEntry,
  deleteWeightEntry,
  updateWeightEntry,
} from './entries/weightEntries';

export {
  loadWeightGoal,
  saveWeightGoal,
  clearWeightGoal,
} from './entries/weightGoal';

export {
  loadWorkoutSessions,
  saveWorkoutSession,
  deleteWorkoutSession,
  loadWorkoutNote,
  saveWorkoutNote,
  saveTrackedExercises,
  saveOneKExercises,
  clearWorkoutNote,
  loadWorkoutNotes,
  loadWorkoutNotesRaw,
  replaceWorkoutNotesRaw,
  saveWorkoutNoteItem,
  deleteWorkoutNoteItem,
  loadCurrentWorkoutId,
  saveCurrentWorkoutId,
  clearCurrentWorkoutId,
  setCurrentWorkoutNote,
} from './entries/workoutNotes';

export {
  loadDeloadNote,
  saveDeloadNote,
  clearDeloadNote,
  loadDeloadHistory,
  appendDeloadHistory,
  deleteDeloadHistory,
  updateDeloadHistory,
} from './entries/deloadStorage';

export {
  loadUserProfile,
  saveUserProfile,
  clearUserProfile,
} from './entries/profileStorage';

export {
  exportBackup,
  buildCloudExport,
  importBackup,
} from './entries/backupImport';

export {
  migrateToNotebook,
  migrateWorkoutNote,
} from './entries/migrations';

import {
  STORAGE_MODES as _STORAGE_MODES,
  getStorageMode as _getStorageMode,
  setStorageMode as _setStorageMode,
  getStorageAdapter as _getStorageAdapter,
} from './entries/storageMode';

// Defined as direct functions (not re-exports) so Jest can spy on them via the
// module namespace object (import * as entries from 'entries').
export const STORAGE_MODES = _STORAGE_MODES;
export function getStorageMode() { return _getStorageMode(); }
export function setStorageMode(mode) { return _setStorageMode(mode); }
export function getStorageAdapter() { return _getStorageAdapter(); }

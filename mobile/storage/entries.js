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
  loadWeightGoalResult,
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
  loadWorkoutNoteDeletionState,
  loadWorkoutNotePresenceState,
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
  loadRecoveryBlocks,
  loadRecoveryBlocksRaw,
  replaceRecoveryBlocksRaw,
  getActiveRecoveryBlock,
  createRecoveryBlock,
  updateRecoveryBlock,
  completeRecoveryBlock,
  deleteRecoveryBlock,
  loadRecoveryBlockWeeks,
  loadRecoveryBlockWeeksRaw,
  replaceRecoveryBlockWeeksRaw,
  loadRecoveryWeeksForBlock,
  addRecoveryWeek,
  updateRecoveryWeek,
  completeRecoveryWeek,
  deleteRecoveryWeek,
} from './entries/recoveryStorage';

// Durable write-ahead journal for the two multi-record recovery lifecycle
// operations (#696). Device-local protocol metadata: deliberately absent from
// the backup/export payload and from SYNC_TABLES.
export {
  RECOVERY_JOURNAL_VERSION,
  RECOVERY_OPERATION_CODES,
  RECOVERY_OPERATION_STAGES,
  RECOVERY_OPERATION_TYPES,
  RecoveryJournalCorruptError,
  isRecoveryJournalCorruptError,
  readRecoveryJournal,
  loadPendingRecoveryOperations,
  reconcileRecoveryOperations,
  runGuardedRecoveryAction,
  startRecoveryOperation,
  setRecoveryNoteOperations,
  resetRecoveryNoteOperations,
  deleteWorkoutNoteViaRecoveryOperations,
} from './entries/recoveryOperationJournal';

export {
  loadUserProfile,
  saveUserProfile,
  clearUserProfile,
} from './entries/profileStorage';

export {
  exportBackup,
  buildCloudExport,
  importBackup,
  hydrateProfileFromCloud,
} from './entries/backupImport';

export {
  migrateToNotebook,
  migrateWorkoutNote,
} from './entries/migrations';

export {
  OWNER_UNCLAIMED,
  OWNER_UNKNOWN,
  getLocalDataOwner,
  setLocalDataOwner,
  purgeLocalData,
} from './entries/localDataOwner';

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

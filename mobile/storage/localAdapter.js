// Local-only storage adapter.
//
// Wraps the AsyncStorage-backed domain functions in storage/entries.js into a
// single adapter object grouped by the domains the backend roadmap needs:
// weight entries, weight goal, workout notes, deload data, settings, profile,
// tracked lifts, and backup/restore.
//
// This is the default adapter. It changes no behavior: every method delegates
// directly to the existing storage/entries.js implementation, which remains the
// canonical local persistence layer. The adapter merely gives callers a single
// explicit surface so a cloud-backed adapter can later be substituted behind the
// storage seam without screens or hooks importing storage internals directly.

import * as Storage from './entries';

// The explicit adapter method surface. Keys mirror storage/entries.js named
// exports so the cloud adapter shell can declare the same contract.
export const localAdapter = {
  mode: 'local',

  // ── weight entries ──────────────────────────────────────────────────────
  loadWeightEntries: (...args) => Storage.loadWeightEntries(...args),
  saveWeightEntry: (...args) => Storage.saveWeightEntry(...args),
  deleteWeightEntry: (...args) => Storage.deleteWeightEntry(...args),
  updateWeightEntry: (...args) => Storage.updateWeightEntry(...args),

  // ── weight goal ─────────────────────────────────────────────────────────
  loadWeightGoal: (...args) => Storage.loadWeightGoal(...args),
  saveWeightGoal: (...args) => Storage.saveWeightGoal(...args),
  clearWeightGoal: (...args) => Storage.clearWeightGoal(...args),

  // ── workout sessions (legacy) ───────────────────────────────────────────
  loadWorkoutSessions: (...args) => Storage.loadWorkoutSessions(...args),
  saveWorkoutSession: (...args) => Storage.saveWorkoutSession(...args),
  deleteWorkoutSession: (...args) => Storage.deleteWorkoutSession(...args),

  // ── workout routine note (single canonical document) ────────────────────
  loadWorkoutNote: (...args) => Storage.loadWorkoutNote(...args),
  saveWorkoutNote: (...args) => Storage.saveWorkoutNote(...args),
  saveTrackedExercises: (...args) => Storage.saveTrackedExercises(...args),
  saveOneKExercises: (...args) => Storage.saveOneKExercises(...args),
  clearWorkoutNote: (...args) => Storage.clearWorkoutNote(...args),

  // ── multi-note workout storage ──────────────────────────────────────────
  loadWorkoutNotes: (...args) => Storage.loadWorkoutNotes(...args),
  saveWorkoutNoteItem: (...args) => Storage.saveWorkoutNoteItem(...args),
  deleteWorkoutNoteItem: (...args) => Storage.deleteWorkoutNoteItem(...args),
  loadCurrentWorkoutId: (...args) => Storage.loadCurrentWorkoutId(...args),
  saveCurrentWorkoutId: (...args) => Storage.saveCurrentWorkoutId(...args),
  clearCurrentWorkoutId: (...args) => Storage.clearCurrentWorkoutId(...args),
  setCurrentWorkoutNote: (...args) => Storage.setCurrentWorkoutNote(...args),

  // ── deload note + history ───────────────────────────────────────────────
  loadDeloadNote: (...args) => Storage.loadDeloadNote(...args),
  saveDeloadNote: (...args) => Storage.saveDeloadNote(...args),
  clearDeloadNote: (...args) => Storage.clearDeloadNote(...args),
  loadDeloadHistory: (...args) => Storage.loadDeloadHistory(...args),
  appendDeloadHistory: (...args) => Storage.appendDeloadHistory(...args),
  deleteDeloadHistory: (...args) => Storage.deleteDeloadHistory(...args),
  updateDeloadHistory: (...args) => Storage.updateDeloadHistory(...args),

  // ── tracked lifts + collapsed state ─────────────────────────────────────
  loadTrackedLifts: (...args) => Storage.loadTrackedLifts(...args),
  saveTrackedLifts: (...args) => Storage.saveTrackedLifts(...args),
  loadWorkoutCollapsed: (...args) => Storage.loadWorkoutCollapsed(...args),
  saveWorkoutCollapsed: (...args) => Storage.saveWorkoutCollapsed(...args),

  // ── settings / feature toggles ──────────────────────────────────────────
  loadFatigueMultiplier: (...args) => Storage.loadFatigueMultiplier(...args),
  saveFatigueMultiplier: (...args) => Storage.saveFatigueMultiplier(...args),
  loadWeightDateEditEnabled: (...args) => Storage.loadWeightDateEditEnabled(...args),
  saveWeightDateEditEnabled: (...args) => Storage.saveWeightDateEditEnabled(...args),
  loadDeloadDateEditEnabled: (...args) => Storage.loadDeloadDateEditEnabled(...args),
  saveDeloadDateEditEnabled: (...args) => Storage.saveDeloadDateEditEnabled(...args),
  loadFatigueTrackingEnabled: (...args) => Storage.loadFatigueTrackingEnabled(...args),
  saveFatigueTrackingEnabled: (...args) => Storage.saveFatigueTrackingEnabled(...args),
  loadDeloadModeEnabled: (...args) => Storage.loadDeloadModeEnabled(...args),
  saveDeloadModeEnabled: (...args) => Storage.saveDeloadModeEnabled(...args),

  // ── user profile ────────────────────────────────────────────────────────
  loadUserProfile: (...args) => Storage.loadUserProfile(...args),
  saveUserProfile: (...args) => Storage.saveUserProfile(...args),
  clearUserProfile: (...args) => Storage.clearUserProfile(...args),

  // ── backup / restore + migrations ───────────────────────────────────────
  exportBackup: (...args) => Storage.exportBackup(...args),
  importBackup: (...args) => Storage.importBackup(...args),
  migrateToNotebook: (...args) => Storage.migrateToNotebook(...args),
  migrateWorkoutNote: (...args) => Storage.migrateWorkoutNote(...args),
};

// Canonical list of adapter method names. The cloud adapter shell reuses this
// to guarantee its surface stays in lockstep with the local adapter.
export const ADAPTER_METHODS = Object.keys(localAdapter).filter(
  (k) => typeof localAdapter[k] === 'function'
);

export default localAdapter;

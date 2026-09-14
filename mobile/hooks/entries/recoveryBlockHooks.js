// Recovery-block hooks: compatibility barrel (#695; split in #1058).
//
// The recovery module was split into four cohesive files without any behavior
// change (#1058). This barrel re-exports their combined public surface so every
// existing importer — Home, Log, Analytics, the editor exclusion path, app
// reload, and the test suites that read or `jest.spyOn` these symbols — keeps
// working against the exact same specifier and export shape as before:
//
//   ./recoveryReadState      read lifecycle + the single shared store (verified
//                            authoritative snapshot, filter snapshot, lifecycle
//                            status, coalescing reads, listener registries)
//   ./recoveryAnalyticsHooks  ordinary-analytics filter hook, active-training
//                            context, and the one-shot excluded-ids read
//   ./recoveryEligibility     pure baseline/week eligibility predicates
//   ./recoveryMutations       lifecycle mutation cores + their hooks
//
// Each symbol is re-exposed as a writable data property (`export const NAME =
// mod.NAME`) rather than a live re-export binding, so the mock seams that
// `jest.spyOn(recoveryBlockHooks, ...)` and `{ ...jest.requireActual(...) }`
// rely on behave exactly as they did when everything lived in one file.

import * as ReadState from './recoveryReadState';
import * as AnalyticsHooks from './recoveryAnalyticsHooks';
import * as Eligibility from './recoveryEligibility';
import * as Mutations from './recoveryMutations';

// ── read lifecycle + shared store ─────────────────────────────────────────────
export const RECOVERY_STATUS = ReadState.RECOVERY_STATUS;
export const RECOVERY_LOADING_MESSAGE = ReadState.RECOVERY_LOADING_MESSAGE;
export const RECOVERY_UNVERIFIED_MESSAGE = ReadState.RECOVERY_UNVERIFIED_MESSAGE;
export const RECOVERY_STALE_MESSAGE = ReadState.RECOVERY_STALE_MESSAGE;
export const refreshRecoveryState = ReadState.refreshRecoveryState;
export const ensureVerifiedRecoveryState = ReadState.ensureVerifiedRecoveryState;
export const useRecoveryBlockState = ReadState.useRecoveryBlockState;
export const reloadRecoveryBlocks = ReadState.reloadRecoveryBlocks;
export const _resetRecoveryAnalyticsFilterCache = ReadState._resetRecoveryAnalyticsFilterCache;

// ── analytics filtering + read-derived hooks ──────────────────────────────────
export const useRecoveryAnalyticsFilter = AnalyticsHooks.useRecoveryAnalyticsFilter;
export const useActiveTrainingContext = AnalyticsHooks.useActiveTrainingContext;
export const loadRecoveryExcludedNoteIds = AnalyticsHooks.loadRecoveryExcludedNoteIds;

// ── pure eligibility ──────────────────────────────────────────────────────────
export const isEligibleBaselineNote = Eligibility.isEligibleBaselineNote;
export const isEligibleRecoveryWeekNote = Eligibility.isEligibleRecoveryWeekNote;

// ── mutations ─────────────────────────────────────────────────────────────────
export const startRecoveryBlockCore = Mutations.startRecoveryBlockCore;
export const useStartRecoveryBlock = Mutations.useStartRecoveryBlock;
export const completeCurrentWeekCore = Mutations.completeCurrentWeekCore;
export const uncompleteCurrentWeekCore = Mutations.uncompleteCurrentWeekCore;
export const addRecoveryWeekCore = Mutations.addRecoveryWeekCore;
export const addRecoveryWeekWithNewNoteCore = Mutations.addRecoveryWeekWithNewNoteCore;
export const completeRecoveryBlockCore = Mutations.completeRecoveryBlockCore;
export const reopenRecoveryBlockCore = Mutations.reopenRecoveryBlockCore;
export const unlinkRecoveryWeekCore = Mutations.unlinkRecoveryWeekCore;
export const unlinkNoteForDeleteCore = Mutations.unlinkNoteForDeleteCore;
export const setRecoveryNormalAnalyticsInclusionCore = Mutations.setRecoveryNormalAnalyticsInclusionCore;
export const setRecoveryBlockReasonCore = Mutations.setRecoveryBlockReasonCore;
export const useRecoveryBlockLifecycle = Mutations.useRecoveryBlockLifecycle;

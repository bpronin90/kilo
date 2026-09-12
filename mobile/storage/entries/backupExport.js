// Backup export and cloud profile round-trip (issue #1060 split of backupImport.js).
//
// The write-out side of the backup engine: exportBackup builds the portable
// snapshot, buildCloudExport wraps it with the account-scoped cloud block, and
// hydrateProfileFromCloud is the paired read-back that writes downloaded cloud
// profile/toggle rows into local storage on a clean device. Co-located exactly
// as the original file grouped them. The projection allowlists and projectFields
// live here because both export and restore project records through them;
// backupRestore.js imports them from here. backupImport.js re-exports the public
// names so this split is invisible to callers.
import {
  WEIGHT_KEY,
  WORKOUT_NOTES_KEY,
  WORKOUT_DELOAD_HISTORY_KEY,
} from './keys';
import { readList } from './jsonStorage';
import { stripDerivedSectionsFromList } from './derivedCache';
import { loadCurrentWorkoutId, saveCurrentWorkoutId } from './workoutNotes';
import { loadWeightGoal } from './weightGoal';
import { loadUserProfile, saveUserProfile } from './profileStorage';
import {
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
  loadTrackedLifts,
  saveTrackedLifts,
  loadTrackedLiftActivations,
  saveTrackedLiftActivations,
  normalizeTrackedLiftActivations,
  pruneTrackedLiftActivations,
  loadWorkoutCollapsed,
  saveWorkoutCollapsed,
} from './settings';
import { loadDeloadNote } from './deloadStorage';
import {
  loadRecoveryBlocksRaw,
  loadRecoveryBlockWeeksRaw,
} from './recoveryStorage';
import { BACKUP_VERSION, validateFatigueMultiplier } from './backupValidation';

const CLOUD_EXPORT_FORMAT = 'cloud-1';

// Explicit field allowlists for the two recovery collections, in both
// directions. Export projects each record through them so a stray local field
// can never leak into a shareable artifact, and import rebuilds each record from
// them so a hand-edited file cannot write an unknown key into local storage —
// the same discipline #471/#475/#488 applied to the profile block.
//
// These are the exact columns kilo.recovery_blocks / kilo.recovery_block_weeks
// hold, minus the server-owned `sync_xid` and the device-owned `client_id`.
export const RECOVERY_BLOCK_FIELDS = [
  'id',
  'baseline_note_id',
  'baseline_note_title',
  'baseline',
  'include_in_normal_analytics',
  // #872. Absent on every block written before that issue, and `projectFields`
  // keeps an absent field absent, so a backup taken from legacy records carries
  // no `reason` key at all rather than a fabricated null.
  'reason',
  'started_at',
  'completed_at',
  'saved_at',
  'updated_at',
  'deleted_at',
];

export const RECOVERY_WEEK_FIELDS = [
  'id',
  'block_id',
  'note_id',
  'week_number',
  'completed_at',
  'saved_at',
  'updated_at',
  'deleted_at',
];

// Project one record through an explicit field allowlist. An absent field stays
// absent rather than becoming `undefined`, so the emitted JSON matches the
// stored record instead of gaining null-ish keys the source never had.
export function projectFields(record, fields) {
  const out = {};
  for (const field of fields) {
    if (record && Object.prototype.hasOwnProperty.call(record, field)) {
      out[field] = record[field];
    }
  }
  return out;
}

export async function exportBackup() {
  const weight_entries = await readList(WEIGHT_KEY);
  // The RAW notebook (tombstones included), minus the device-local parser cache
  // an older build may still be carrying (issue #813): it is recomputable from
  // raw_text, never part of the backup contract, and ~100x the note text.
  const workout_notes = stripDerivedSectionsFromList(await readList(WORKOUT_NOTES_KEY));
  const current_workout_id = await loadCurrentWorkoutId();
  const weight_goal = await loadWeightGoal();
  const fatigue_multiplier = await loadFatigueMultiplier();
  const deload_history = await readList(WORKOUT_DELOAD_HISTORY_KEY);
  // The RAW lists, tombstones included. A tombstone is the only record that a
  // block or membership was removed, so dropping them here would make a restore
  // resurrect every deleted recovery record — and in cloud mode would re-upload
  // them under a `deleted_at` the account has already accepted.
  const recovery_blocks = (await loadRecoveryBlocksRaw())
    .map((b) => projectFields(b, RECOVERY_BLOCK_FIELDS));
  const recovery_block_weeks = (await loadRecoveryBlockWeeksRaw())
    .map((w) => projectFields(w, RECOVERY_WEEK_FIELDS));
  return {
    version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    weight_entries,
    workout_notes,
    current_workout_id,
    weight_goal,
    fatigue_multiplier,
    deload_history,
    recovery_blocks,
    recovery_block_weeks,
  };
}

// Cloud export parity (Phase 4 / Task 12).
//
// Cloud users need an export that is a strict superset of the plain backup shape
// so it stays importable via importBackup(), but also carries the account-scoped
// data the roadmap calls out for self-serve cloud users: profile, feature
// toggles, and the preferences/pointers that live on user_profile in the cloud
// model (roadmap "Self-Serve Product Obligations": "v3 backup shape plus
// account/profile/toggle additions needed for cloud users").
//
// The base payload is exactly exportBackup() (currently version "4", which adds
// the two recovery collections to the v3 shape), so any importer of that version
// ignores the extra `cloud` block. The cloud-only additions are namespaced under
// `cloud` to keep the top-level contract untouched.
// Security (#350): the cloud block can carry account identity. The account `id`
// is an opaque, non-PII identifier and is always safe to include. The account
// `email` is personal data, so it is excluded from the shareable artifact unless
// the caller explicitly opts in via `includeEmail: true`. This keeps email out
// of any incidentally-shared export by default while preserving the option for
// flows that genuinely need the signed-in identity in the payload.
export async function buildCloudExport({ account = null, includeEmail = false } = {}) {
  const base = await exportBackup();

  const [
    profile,
    weightDateEditEnabled,
    deloadDateEditEnabled,
    fatigueTrackingEnabled,
    deloadModeEnabled,
    trackedLifts,
    trackedLiftActivations,
    deloadNote,
    logCurrentCollapsed,
  ] = await Promise.all([
    loadUserProfile(),
    loadWeightDateEditEnabled(),
    loadDeloadDateEditEnabled(),
    loadFatigueTrackingEnabled(),
    loadDeloadModeEnabled(),
    loadTrackedLifts(),
    loadTrackedLiftActivations(),
    loadDeloadNote(),
    loadWorkoutCollapsed(),
  ]);

  return {
    ...base,
    cloud: {
      cloud_export_format: CLOUD_EXPORT_FORMAT,
      account: account
        ? {
            id: account.id ?? null,
            // Email is personal data and is omitted unless explicitly opted in.
            ...(includeEmail ? { email: account.email ?? null } : {}),
          }
        : null,
      user_profile: profile,
      current_workout_id: base.current_workout_id,
      current_deload_note: deloadNote,
      tracked_lifts: trackedLifts,
      // #893: a sibling field, never folded into tracked_lifts. An older build
      // restoring this file ignores the unknown field and keeps every flag,
      // where a non-boolean value inside tracked_lifts would have been dropped
      // by its own importer and silently untracked the exercise.
      tracked_lift_activations: trackedLiftActivations,
      ui_state: { log_current_collapsed: logCurrentCollapsed },
      feature_toggles: {
        weight_date_edit_enabled: weightDateEditEnabled,
        deload_date_edit_enabled: deloadDateEditEnabled,
        fatigue_tracking_enabled: fatigueTrackingEnabled,
        deload_mode_enabled: deloadModeEnabled,
      },
    },
  };
}

// ── clean-bootstrap cloud restore (issues #481/#482/#483) ──────────────────
//
// The cloud `user_profile` and `feature_toggles` rows are singletons that only
// ever got pushed via bootstrapFromLocal (see mobile/storage/cloud/bootstrap.js);
// nothing ever read them back. This is the write side of that missing
// direction: given the two rows downloaded from Supabase for the signed-in
// account, write each known field into the same local storage keys that
// buildBootstrapPlan's buildUserProfileRow/buildFeatureTogglesRow originally
// read from. Deliberately not a wildcard copy: only the named fields below
// cross the boundary, mirroring the #471/#475 allowlist discipline already
// applied to the upload/export direction. The fatigue-multiplier sanity check
// reuses validateFatigueMultiplier so a corrupted or tampered cloud row can't
// push a NaN/absurd value into local fatigue calculations.
//
// Caller contract: mobile/storage/cloud/bootstrap.js only invokes this when
// the local device's snapshot is already clean/empty (a fresh install or a
// device that has never held any profile/routine/tracked-lift state), so this
// function's writes can never clobber a device's real existing local data.
export async function hydrateProfileFromCloud(profileRow, featureTogglesRow) {
  if (profileRow && typeof profileRow === 'object') {
    if (profileRow.current_workout_note_id != null) {
      await saveCurrentWorkoutId(profileRow.current_workout_note_id);
    }
    if (profileRow.fatigue_multiplier != null) {
      const check = validateFatigueMultiplier(profileRow.fatigue_multiplier);
      if (check.ok) {
        await saveFatigueMultiplier(profileRow.fatigue_multiplier);
      }
    }
    if (
      profileRow.tracked_lifts &&
      typeof profileRow.tracked_lifts === 'object' &&
      !Array.isArray(profileRow.tracked_lifts)
    ) {
      await saveTrackedLifts(profileRow.tracked_lifts);
    }
    // #893: pruned to the flags restored just above, so a downloaded row whose
    // records outlived their Track flags cannot seed a boundary onto this
    // device. (This path only runs on a clean/empty device, so there is nothing
    // local to lose either way — it is paired for the same reason the backup
    // path is: a flag map and its records are one fact.)
    if (
      profileRow.tracked_lift_activations &&
      typeof profileRow.tracked_lift_activations === 'object' &&
      !Array.isArray(profileRow.tracked_lift_activations)
    ) {
      await saveTrackedLiftActivations(
        pruneTrackedLiftActivations(
          await loadTrackedLifts(),
          normalizeTrackedLiftActivations(profileRow.tracked_lift_activations),
        ),
      );
    }
    if (profileRow.ui_state && typeof profileRow.ui_state === 'object') {
      await saveWorkoutCollapsed(!!profileRow.ui_state.log_current_collapsed);
    }
    if (profileRow.display_name != null || profileRow.unit_system != null) {
      await saveUserProfile({
        display_name: profileRow.display_name ?? null,
        unit_system: profileRow.unit_system ?? null,
      });
    }
  }

  if (featureTogglesRow && typeof featureTogglesRow === 'object') {
    if (typeof featureTogglesRow.weight_date_edit_enabled === 'boolean') {
      await saveWeightDateEditEnabled(featureTogglesRow.weight_date_edit_enabled);
    }
    if (typeof featureTogglesRow.deload_date_edit_enabled === 'boolean') {
      await saveDeloadDateEditEnabled(featureTogglesRow.deload_date_edit_enabled);
    }
    if (typeof featureTogglesRow.fatigue_tracking_enabled === 'boolean') {
      await saveFatigueTrackingEnabled(featureTogglesRow.fatigue_tracking_enabled);
    }
    if (typeof featureTogglesRow.deload_mode_enabled === 'boolean') {
      await saveDeloadModeEnabled(featureTogglesRow.deload_mode_enabled);
    }
  }

  return { ok: true };
}

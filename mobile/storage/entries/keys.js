export const WEIGHT_KEY = 'kilo_weight_entries';
export const WEIGHT_GOAL_KEY = 'kilo_weight_goal';
export const WORKOUT_KEY = 'kilo_workout_sessions';
export const WORKOUT_NOTE_KEY = 'kilo_workout_note';
export const WORKOUT_NOTES_KEY = 'kilo_workout_notes';
export const CURRENT_WORKOUT_ID_KEY = 'kilo_current_workout_id';
export const FATIGUE_MULTIPLIER_KEY = 'kilo_fatigue_multiplier';
export const WEIGHT_DATE_EDIT_KEY = 'kilo_weight_date_edit_enabled';
export const WORKOUT_DELOAD_NOTE_KEY = 'kilo_workout_deload_note';
export const WORKOUT_DELOAD_HISTORY_KEY = 'kilo_workout_deload_history';
export const TRACKED_LIFTS_KEY = 'kilo_tracked_lifts';
// Tracked-span activation records (#893). A SIBLING of TRACKED_LIFTS_KEY, never
// folded into its value: backupImport hard-filters that map to booleans, so an
// already-installed older build importing a new backup would silently untrack
// every exercise. A separate key has no such interaction — an old build simply
// never reads it.
export const TRACKED_LIFT_ACTIVATIONS_KEY = 'kilo_tracked_lift_activations';
export const COLLAPSED_STATE_KEY = 'kilo_log_current_collapsed';
export const USER_PROFILE_KEY = 'kilo_user_profile';
export const DELOAD_DATE_EDIT_KEY = 'kilo_deload_date_edit_enabled';
export const FATIGUE_TRACKING_KEY = 'kilo_fatigue_tracking_enabled';
export const DELOAD_MODE_KEY = 'kilo_deload_mode_enabled';
export const WEIGH_IN_REMINDER_KEY = 'kilo_weigh_in_reminder';
export const WORKOUT_REMINDER_KEY = 'kilo_workout_reminder';
export const RECOVERY_BLOCKS_KEY = 'kilo_recovery_blocks';
export const RECOVERY_BLOCK_WEEKS_KEY = 'kilo_recovery_block_weeks';
// Device-local write-ahead journal for multi-record recovery lifecycle
// operations (#696). Protocol metadata, never user health data: it is not a
// sync table, is not exported in a backup, and is versioned in the key itself
// so an older build's records are never silently reinterpreted.
export const RECOVERY_OPERATION_JOURNAL_KEY = 'kilo_recovery_operation_journal_v1';
// Device-local plate-calculator equipment profile (#577): bar weight + finite
// per-side plate inventory, kept independently per unit (lb/kg). Not synced,
// not part of JSON backup — it describes this device's gym equipment, not
// workout history.
export const PLATE_CALCULATOR_PROFILE_KEY = 'kilo_plate_calculator_profile';
// Device-local rest timer (#577): the single active timer's wall-clock end
// time and its scheduled notification id. Not synced, not part of JSON
// backup — it is transient device utility state, not health history.
export const REST_TIMER_KEY = 'kilo_rest_timer';

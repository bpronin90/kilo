# Local Data Reference

For storage maintainers looking up persisted keys, migration inputs, and entry shapes. Encryption and startup ordering are in [Native Runtime](native-runtime.md); sync semantics are in [Cloud Sync](cloud-sync.md).

## Persistence Model

### AsyncStorage keys

| Key | Contents |
|-----|----------|
| `kilo_local_data_owner` | Single bootstrap/sync ownership gate: `unclaimed`, `unknown`, or the owning Supabase user id. Foreign-owned history requires an explicit purge-or-upload choice before cloud mode starts. |
| `kilo_weight_entries` | JSON array of native weight entries |
| `kilo_weight_goal` | Optional native weight-goal object |
| `kilo_archived_weight_goals` | JSON array of archived completed weight-goal records, including target/start/completed weights plus archive/sync metadata |
| `kilo_fatigue_multiplier` | Persisted native fatigue-multiplier number |
| `kilo_weigh_in_reminder` | Optional local daily weigh-in reminder settings (`enabled`, `hour`, `minute`) |
| `kilo_workout_reminder` | Optional local workout-day nudge settings (`enabled`, `hour`, `minute`, `fallbackWeekdays`) |
| `kilo_tracked_lifts` | JSON object keyed by canonical exercise key for global Track toggles. Keys are canonicalized at an exercise's next toggle, so a legacy alias key stays readable until then |
| `kilo_tracked_lift_activations` | JSON object keyed by canonical exercise key holding the tracked-span activation record for each currently tracked exercise (`anchor`, `at`, `witness`). A sibling of `kilo_tracked_lifts`, never folded into it; a record never outlives the flag it belongs to, and a flag with no record is legacy boolean-only state that keeps full-history progression |
| `kilo_normalization_apply_intent_v1` | Present only while a normalization apply's commit is unfinished (#1395): the renamed note ids with their expected/next texts and the resulting `tracked_lifts` / activation maps. Rolled forward before the next apply, Track write, tracked-lift load, or sync pass, then removed. Device-local; not synced or backed up |
| `kilo_normalization_apply_quarantine_v1_<n>` | The exact raw record of an unreconcilable apply intent the user discarded (#1402), kept as evidence: `{version, quarantined_at, reason, raw}`. Written before the active intent is removed; never overwritten. Device-local, encrypted; not synced or backed up; wiped with the device's other `kilo_` keys |
| `kilo_user_profile` | Optional native calorie-profile object with `height_cm`, `date_of_birth`, `sex`, `activity_level`, and `saved_at` |
| `kilo_workout_sessions` | Legacy JSON array of native structured workout sessions, retained only as a migration source |
| `kilo_workout_notes` | JSON array of titled native workout note documents, including persisted `tracked_exercises`, `one_k_exercises`, `exercise_classifications`, `skip_markers`, `attendance_flags`, and `session_checkins` fields; legacy entries may still carry stale `rep_drop_off_flags`. Never carries parser output: a `derived_sections` field is stripped on every write and purged once from older notebooks (#813) |
| `kilo_derived_sections_purge_v1_complete` | Marker that the one-time `derived_sections` purge (#813) has completed on this device; every later launch reads only this key. Bookkeeping, no user data |
| `kilo_current_workout_id` | String id of the selected current native workout note |
| `kilo_workout_deload_history` | JSON array of completed deload records (`id`, `raw_text`, `generated_at`, `completed_at`, `session_count`, optional `deload_session_ordinal`); `completed_at` drives calendar/display behavior while Analytics session counts use the furthest stored session anchor (`deload_session_ordinal` for new records, `session_count` for legacy records) |
| `kilo_workout_deload_note` | Active in-progress deload note document; cleared on deload completion or discard |
| `kilo_workout_note` | Legacy single-note key retained for backup compatibility |
| `kilo_fatigue_tracking_enabled` | Persisted feature toggle for fatigue / session check-in tracking (More > Settings) |
| `kilo_deload_mode_enabled` | Persisted feature toggle enabling deload flow in Log (More > Settings) |
| `kilo_weight_date_edit_enabled` | Developer / advanced setting enabling manual date editing on weight entries |
| `kilo_deload_date_edit_enabled` | Developer / advanced setting enabling manual date editing on deload entries |
| `kilo_log_current_collapsed` | Persisted UI state: whether the current Log routine card is collapsed |
| `kilo_recovery_blocks` | JSON array of recovery-block records (`baseline_note_id`, the frozen versioned `baseline` snapshot, `include_in_normal_analytics`, the optional free-text `reason` a block was started, `started_at`, `completed_at`) plus sync metadata and retained tombstones. `reason` is `null` when none was given, including on every record written before it existed; nothing in the domain reads it, so it changes no membership, baseline, comparison, or analytics result |
| `kilo_recovery_block_weeks` | JSON array of ordered recovery-week memberships linking a workout note to a block (`block_id`, `note_id`, domain-assigned `week_number`, `completed_at`) plus sync metadata and retained tombstones |
| `kilo_recovery_operation_journal_v1` | Device-local write-ahead journal of in-flight multi-record recovery lifecycle operations (`operation_id`, schema `version`, `type`, affected `block_id`/`week_id`/`note_id`, immutable requested timestamp, intended outcome, stage/attempt metadata, `created_at`/`updated_at`, last-error diagnostics). Protocol metadata, not user health data: never exported in a backup, never a sync table, and never stores workout-note text |

## Entry Shapes

### Weight entry

```js
{
  id: 'w_2026-04-15',          // seeded: w_${iso}; user: generated by weight.jsx
  entry_type: 'weight',
  date: '2026-04-15',
  weight: 192.3,               // legacy field; kept for read compat
  weight_value: 192.3,         // canonical field used by MVP path
  weight_unit: 'lb',
  logged_at: '2026-04-15T08:00:00Z',
  saved_at: '2026-04-15T08:00:05Z',
  isUserEntry: true,           // only on user-created entries
  note_text: null,             // string or null; only present on entries logged with a note
}
```

### Workout session (seeded)

```js
{
  id: 's_2026-04-28_monday',
  entry_type: 'workout',
  date: '2026-04-28',
  saved_at: '2026-04-28T23:00:00Z',
  day: 'monday',
  duration: 62,                // minutes
  exercises: [
    { exerciseId: 'db_bench', raw: '95 7,7,7,7' },
    // ...
  ],
  // no `items` field — seeded sessions retain only the raw strings
}
```

### Workout session (user-created)

Same shape as seeded, plus:

```js
{
  // ...all seeded fields...
  isUserEntry: true,
  items: [                     // canonical parse output embedded at save time
    {
      exercise_name: 'DB Bench Press',
      result_kind: 'sets',
      note_text: null,
      position: 1,
      sets: [
        {
          set_index: 1, rep_count: 7,
          weight_value: 95, weight_unit: 'lb',
          duration_seconds: null,
          assistance_value: null, assistance_unit: null,
          note_text: null,
        },
        // ...
      ],
    },
  ],
}
```

## Legacy note migration

When `useWorkoutNotes()` loads, the storage layer synthesizes a note from any
legacy `kilo_workout_sessions` content if no `kilo_workout_note` exists, saving
the migrated result before returning. Tracked exercise toggles update the global
`kilo_tracked_lifts` map keyed by normalized lift name; 1k slot changes and note
edits update the selected workout-note document so analytics inputs and raw
workout text stay persisted across reloads.

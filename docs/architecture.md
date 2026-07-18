# Architecture

Kilo is a single-path native app:

- `mobile/` is the active Expo/React Native app and receives all forward-looking
  architecture work.
- The legacy browser prototype (`Kilo.html`, `src/`, `tests/`) is archived under
  `docs/archive/browser-prototype/`. The Capacitor Android shell and vitest
  config have been removed entirely (issue #213).

## Architecture Overview

```mermaid
graph TD
    subgraph expo["Native Expo App"]
        ExpoEntry["mobile/index.js\n(Expo entry)"]
        AppJs["mobile/App.js\ntab state · save wiring"]
        NativeScreens["mobile/screens/\nHome · Log · Weight · Analytics · More"]
        NativeLib["mobile/lib/\nparser.js · data.js/data/ · format.js"]
        NativeHooks["mobile/hooks/useEntries.js"]
        NativeStorage["mobile/storage/entries.js"]
        AS[("AsyncStorage\nkilo_local_data_owner\nkilo_weight_entries\nkilo_weight_goal\nkilo_archived_weight_goals\nkilo_fatigue_multiplier\nkilo_weigh_in_reminder\nkilo_workout_reminder\nkilo_workout_sessions\nkilo_workout_notes\nkilo_current_workout_id\nkilo_workout_note (legacy backup/import)")]
    end
    subgraph supabase["Supabase Project"]
        EdgeExport["account-export Edge Function"]
        EdgeDelete["account-delete Edge Function"]
        EdgeHealthDelete["health-data-delete Edge Function"]
        KiloSchema[("kilo schema\nRLS app tables · consent ledger\npurge jobs · evidence archive")]
        Auth[("Supabase Auth")]
    end

    ExpoEntry --> AppJs
    AppJs --> NativeScreens
    NativeScreens --> NativeLib
    NativeScreens --> NativeHooks
    NativeHooks --> NativeStorage
    NativeStorage <--> AS
    NativeScreens --> EdgeExport
    NativeScreens --> EdgeDelete
    NativeScreens --> EdgeHealthDelete
    EdgeExport --> KiloSchema
    EdgeDelete --> KiloSchema
    EdgeHealthDelete --> KiloSchema
    EdgeDelete --> Auth
```

## Supabase Deployment Configuration

`supabase/config.toml` records the local project identifier, the exact exposed
schema set, and `verify_jwt = false` for `account-export` and
`account-delete`. `health-data-delete` also disables platform JWT verification
because it authenticates either the withdrawing user's JWT or the Vault-backed
service-role Cron worker itself. Those functions perform their own JWT
validation and must
receive CORS preflight and pre-auth rate-limit requests before authentication.
Their pre-auth IP buckets use the platform-controlled rightmost forwarding
value, while durable limiter hits live in `kilo.rate_limit_hits`. A scheduled
`pg_cron` reaper removes export hits after the 10-minute window and delete hits
after the 1-hour window so abandoned bucket keys cannot grow the table without
bound (#451).

The config's `project_id` is not the remote deployment target. Run
`scripts/deploy-kilo-functions.sh` from the repository root to deploy the three
Kilo-owned functions; the script supplies project ref
`ogzhnscdqcdrhfqcobuv` explicitly and does not deploy the unrelated `anime`
function hosted in the same Supabase project.

## Preview OTA Update Path

The native Expo app uses unsigned `expo-updates` for the preview workflow on
both Android and iOS.

- `mobile/app.json` keeps `updates.enabled` and the EAS project `updates.url`.
  `mobile/app.config.js` gives preview builds a stable manual runtime string
  (`preview-3`) so compatible installed preview builds can fetch JavaScript and
  bundled-asset updates from the `preview` channel on launch. Production builds
  continue to use `runtimeVersion.policy: "appVersion"`.
- `mobile/eas.json` binds the `preview` (Android), `ios-simulator`, and
  `ios-device` build profiles to the `preview` channel so their builds receive
  preview-channel OTA updates. `production` is bound to the `production` channel.
- `mobile/package.json` exposes preview and production Android build/update
  scripts. Preview update scripts set `APP_ENV=preview`; production Android
  updates use the default `runtimeVersion.policy: "appVersion"` path.
- Native/config changes still require a fresh `eas build --profile preview`
  (Android) or `eas build --profile ios-simulator|ios-device` (iOS). Expo SDK
  upgrades, including the SDK 56 upgrade in issue #367, are native runtime
  changes and cannot be delivered to SDK-54 installs by OTA/EAS Update alone.
- Live on-device iOS OTA delivery has not yet been verified end to end; it is
  deferred pending an iOS build (issue #63).
- Signed OTA updates are intentionally not configured. There is no checked-in
  certificate, no `codeSigningCertificate` / `codeSigningMetadata`, and no
  `--private-key-path` requirement in the supported preview workflow.

## Migration History

The browser prototype served as the behavior reference during native migration
(issue #35). That migration is complete: the prototype source is archived and
the Capacitor shell has been removed. `mobile/` is the only app surface.

## Target Native Runtime Shape

The first native milestone does not require backend work. It does require a
clear separation between UI and data responsibilities inside `mobile/`:

- Screen and component layers render Home, Log, Weight, Analytics, and More surfaces.
- Parser and persistence modules own entry validation, canonical save shapes,
  local writes, and recent-history reads.
- Screen components consume explicit module boundaries instead of directly
  re-creating parser or storage rules inline.

## Runtime Shape

The `mobile/` app is a separate runtime from the browser prototype. `mobile/index.js`
registers `mobile/App.js` with Expo. The current native architecture is narrow:

- `mobile/App.js` owns tab state plus the native save/reload orchestration
  layer, including the persisted fatigue-multiplier state threaded into More
  and Analytics and the shared auth/session hook threaded through More into
  Account so Account entry does not create a second session probe
- `mobile/lib/supabaseClient.js` is the single authorized Supabase client
  construction point in the app. Screens and hooks must not import
  `@supabase/supabase-js` directly; auth flows reach it through
  `mobile/hooks/useAuthSession.js`, and cloud storage reaches it through the
  storage adapter. The module stores native Supabase sessions in 2000-byte
  SecureStore chunks. Authoritative high-water metadata is raised before chunk
  writes and lowered only after cleanup, preventing new orphaned token chunks
  across shrinking writes, interrupted cleanup, and sign-out. Legacy or corrupt
  pre-HWM states receive a documented bounded 64-chunk best-effort sweep because
  SecureStore cannot enumerate unknown keys.
- `mobile/components/` holds reusable shell and UI primitives
- `mobile/screens/MoreScreen.js` owns the More-tab routing shell. Help, About,
  Backup, Settings, and Profile sub-screens are extracted to individual files in
  `mobile/components/` (`HelpScreen.js`, `AboutScreen.js`, `BackupScreen.js`,
  `SettingsScreen.js`, `ProfileScreen.js`); `MoreScreen.js` imports and renders
  them. Account and AccountLifecycle remain in `mobile/screens/more/`. The
  screen routes to server-side account export and two-step deletion calls that
  stay behind Supabase Edge Functions rather than exposing privileged credentials
  to the client, leaving `HomeScreen.js` focused on dashboard rendering. The
  same public-account surfaces expose placeholder privacy and terms links beside
  signup, near Account export/delete actions, and in More > About Kilo. The
  Account screen also starts GitHub OAuth on web and Android; Android uses
  `expo-web-browser` with `kilo://auth/callback`, then exchanges the returned
  PKCE code through the app-shell Supabase auth/session hook passed down from
  `App.js`. Password recovery reuses that callback boundary: the shared auth
  hook handles recovery sessions and native cold/warm deep links, while `App.js`
  and `MoreScreen.js` route active recovery state to the Account-owned
  set-new-password surface. While a recovery session or recovery-link error is
  active, the auto-sync ownership gate defers: it suppresses any upload/start-fresh
  prompt without clearing the owner marker and re-presents the still-valid decision
  once recovery completes or is exited, so recovery never sits behind the ownership
  overlay (#500).
- `mobile/hooks/useEntries.js` owns native read/write hooks for weight entries
  plus the persisted weight-goal and multi-note current-workout read/write
  paths, plus lightweight listener fanout for cross-consumer refreshes and a
  separate post-sync reload fanout that re-reads storage for every mounted
  workout-note and weight-entry hook instance, plus a shared reactive
  `useTrackedLifts()` hook consumed by both Log and Analytics
- `mobile/lib/parser.js` ports the canonical MVP parser path into native ES
  modules, now exposes the note-derived analytics contract used by downstream
  native workout analytics work, and centralizes exercise alias resolution in
  `normalizeExerciseKey()` so parser and data consumers share one canonical
  matching chain. `parseWorkoutNote()` also recognizes a standalone `---` line
  as the boundary between week A and week B inside one routine note and returns
  `weekBStartIndex` so Log can project the active week without splitting the
  stored routine into multiple notes
- `mobile/lib/data.js` is the compatibility barrel for shared data exports.
  Domain implementations live under `mobile/lib/data/`: exercise catalog and
  entry factories, weight goals, routine status, fatigue, skip data, workout
  analytics, 1K totals, and non-weighted metrics. The barrel preserves the
  existing consumer API, including the canonical `deriveWorkoutNoteAnalytics()`
  entry point and fatigue helpers `deriveSessionCheckIn()` and
  `deriveCheckInHistory()`. `parser.js` imports the exercise catalog directly
  from `data/exerciseCatalog.js` so the barrel does not create a parser/data
  dependency cycle
- `mobile/storage/entries.js` owns AsyncStorage reads/writes for recent-history
  data plus the local weight-goal key (`kilo_weight_goal`), the persisted
  fatigue-multiplier key (`kilo_fatigue_multiplier`), the global tracked-lift
  key (`kilo_tracked_lifts`), the optional user-profile key
  (`kilo_user_profile`), and the multi-note workout store
  (`kilo_workout_notes` and `kilo_current_workout_id`). Saved workout-note
  documents now also carry persisted `exercise_classifications`,
  `skip_markers`, `attendance_flags`, `session_checkins`, and `activeWeek`
  alongside
  tracked-lift and 1k-slot selections. The old `rep_drop_off_flags` surface is
  no longer produced or consumed by the active app path. The legacy session
  key remains only a migration source and the old single-note key remains both
  a migration source into the notebook model and a backup-compatibility
  fallback
- `mobile/screens/` holds one component per visible MVP surface
- `mobile/theme/colors.js` centralizes native design tokens
- `mobile/lib/format.js` contains a small shared timestamp formatter

The native path uses its own parser/data/storage modules.

## Screen Routing

`mobile/App.js` owns a separate `activeTab` state string initialized to
`'Home'`. All five native screens are mounted persistently and visibility is
toggled via `display: 'none'` / `display: 'flex'` based on `activeTab`,
eliminating remount flicker on tab switch:

```
activeTab: 'Home' | 'Log' | 'Weight' | 'Analytics' | 'More'
```

`mobile/components/TabBar.js` calls `setActiveTab` directly. The workout save
handler validates input, persists via the hook/storage layer, and then
navigates the user back to Home. The weight save handler validates and persists
but keeps the user on the Weight screen. The More tab now also owns a local
Settings & Algorithm sub-screen that updates a persisted fatigue-multiplier
value in `App.js` state and immediately re-derives Analytics through a
prop-driven recomputation path. For nested navigation, `App.js` exposes one
active-tab back-consumer slot; `MoreScreen` registers its menu-pop handler only
while an active child is visible. The shell consults that consumer before its
Android Home/exit fallback, and the same child-ownership signal suppresses the
global web Home control in a pre-paint layout effect. `App.js` also provides shared scroll
activity down through `ScreenShell` so the tab bar can react to content
scrolling as an overlay surface. There is no router library or persisted
navigation state in the native path. The only registered deep link is
`kilo://auth/callback`: active Android GitHub OAuth consumes it through the
browser auth session, while password-recovery links opened externally are
handled by the shared auth hook and route the shell to More > Account.

`mobile/screens/WeightScreen.js` also renders saved weight history as a direct
correction surface. Tapping a row reloads that entry into the shared form
state, edit submissions rerun `parseWeightEntry()` before
`updateWeightEntry()`, delete submissions remove the selected entry in place,
and the hook-level listener fanout reloads other weight consumers so Home,
Analytics, and the Weight history stay in sync after edits or deletes. The same
screen also saves an optional weight-goal record (target weight + target date),
derives direction and required weekly pace from a centralized current-weight
resolution contract in `mobile/lib/data.js` (latest saved entry by date when
present, otherwise the saved goal `start_weight`, or the in-progress typed
fallback while editing), renders advisory warnings without blocking the
save path, detects when the active goal has been met, and lets the user archive
the completed goal so current analytics clear back to the new-goal path while
the completed target/start/completion fields are preserved as history. Shared
prior-window comparison ownership for weight trends also now
lives in `computeWeightTrendSummary()` in `mobile/lib/data.js`, and Weight,
Home, and Analytics now all consume that shared weight/goal derivation contract
through `deriveWeightGoalAnalytics()` instead of carrying screen-local
reshaping.

Tracked-lift visibility now follows a similar shared-hook pattern. Log toggles
persist through the global `kilo_tracked_lifts` map, `useTrackedLifts()`
fanouts the updated in-memory state to all mounted consumers immediately, and
Analytics filters that global tracked set down to lifts present in the current
routine while still deriving each visible lift's trend and exercise display
casing from all routine notes through `deriveWorkoutNoteAnalytics()`. Because
that tracked-lift map is global, PO/tracked progression continuity survives
current-routine switches without any per-routine migration step; only 1K slot
selections are rolled from one routine note to another when the user accepts
the switch prompt.

## Parse-to-Persistence Flow

```
User types in native Weight or Log form
  → App.js save handler calls native parser (`parseWeightEntry`) or workout-note save path
  → on error: save is blocked in the handler
  → on ok: App.js builds a canonical weight entry via `makeWeightEntry`, or parses the workout note, derives persisted session classifications plus skip/attendance metadata, and upserts the selected titled workout note through `useWorkoutNotes`
  → `useWeightEntries` / `useWorkoutNotes` writes through `mobile/storage/entries.js`
  → AsyncStorage persists the updated weight list, workout-notes array, and current-workout id
  → hook state updates
  → Home / Analytics re-derive recent activity and analytics from the selected current workout note
```

`mobile/storage/entries.js` also exposes a local-only recovery path:
`exportBackup()` serializes a versioned v3 snapshot (weight entries, titled
workout notes with `isCurrent` / `currentSince` metadata, the current workout
id, an optional weight goal, an optional fatigue multiplier, and the completed
deload history).
`importBackup(payload, 'replace')` validates before any write, restores the
full multi-note model for v2 and v3 backups, conditionally restores or clears the
weight goal when the key is present, restores only a finite in-range fatigue
multiplier, validates every v3 deload-history record and caps its raw text before
restoring it, and still
accepts v1 backups to restore weight history without
clearing the newer workout-note state. The same storage module also performs a
one-time forward migration from the legacy single-note key by seeding a
`Routine 1` notebook entry with `isCurrent: true` and `currentSince: null`,
and normalizes pre-existing notebook rows that predate the new metadata fields.
No remote sync is involved.

## Launch Abuse Boundary

Supabase Auth owns platform authentication throttles and CAPTCHA enforcement for
signup, password recovery, verification, and token endpoints. Kilo's launch
configuration keeps those platform limits active, uses production-owned SMTP for
public email signup and password recovery, and enables CAPTCHA before open
signup unless a closed-beta release explicitly records a temporary deferral.
The production SMTP boundary is Resend with a verified sender domain (#478);
delivery authentication is configured outside the repository in Supabase Auth.

Kilo-owned Edge Functions remain responsible for app-specific abuse controls.
`account-export` and `account-delete` require the caller JWT, perform no
unauthenticated writes, keep service-role credentials server-side only, and
apply durable, shared per-user and per-IP rate limits. Their shared CORS helper
defaults closed with no browser origins allowlisted; native callers are
unaffected, and any future browser caller must be added explicitly rather than
receiving a wildcard origin. Limit state lives in
Postgres (`kilo.rate_limit_hits` via the `kilo.rate_limit_check` SECURITY
DEFINER function, granted to `service_role` only), so the limits hold across
Edge-Function isolate recycling and cold starts rather than resetting per
isolate; a per-bucket advisory lock makes each check-and-record atomic under
concurrency. `account-export` limits successful exports to one per signed-in
user per 10 minutes by default, while `account-delete` limits delete attempts to
three per signed-in user per hour by default; both functions also reject
repeated callers through an IP bucket. The limiter fails open if the durable
check itself errors, so an infrastructure outage cannot lock users out of
export or deletion.

## Session Check-In (Fatigue) Flow

The fatigue feature is a detection → response → consumer pipeline keyed by
session index on the current workout note. The old rep-drop-off / `hit_wall`
chip is gone; nothing in the active path produces or reads `rep_drop_off_flags`.

- **Detection** — `deriveSessionCheckIn(sections, trackedNames)` in
  `mobile/lib/data.js` evaluates the latest (deepest) session column of the
  current note only. It runs skip, whole-day-skip, and per-exercise
  volume-drop/collapse detectors over the tracked lifts and returns
  `{ sessionIndex, isRough, detectors, flagged, metrics }`. `LogScreen.js` runs
  this when the user leaves the current-routine editor after a rough session.
- **Prompt** — when `isRough` is true and no matching
  `session_checkins[sessionIndex]` entry exists yet, `LogScreen.js` highlights
  the flagged exercises in red in the rendered note and opens
  `mobile/components/SessionCheckInModal.js` with a detector-aware title and the
  flagged exercise names.
- **Response / persistence** — the modal writes a check-in record onto the
  note's `session_checkins[sessionIndex]` carrying `status`
  (`'ok'` / `'rough'` / `null` for a dismissed/pending answer), optional
  `reasons` and free-text `note`, the captured detector `metrics`
  (`exercises_skipped`, `volume_decline_pct`), `flagged`, `detectors`, and an
  answer-time `responded_at` ISO timestamp. The highlight and prompt suppress
  once that entry exists. This record is persisted on the workout-note document
  through the normal note save path.
- **Consumer** — `deriveCheckInHistory(notes)` in `mobile/lib/data.js` flattens
  `session_checkins` across all notes into a `responded_at`-sorted history split
  into `rough` / `ok` / `pending` groups plus a summary (`top_reason`, group
  totals). `AnalyticsScreen.js` consumes this for the `Fatigue` section and can
  reopen `SessionCheckInModal` against an existing record to edit it, preserving
  the original `responded_at`. Both the Log prompt and the Analytics Fatigue
  surface are gated on the More > Settings `Fatigue tracking` toggle.

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
| `kilo_tracked_lifts` | JSON object keyed by normalized lift name for global Track toggles |
| `kilo_user_profile` | Optional native calorie-profile object with `height_cm`, `date_of_birth`, `sex`, `activity_level`, and `saved_at` |
| `kilo_workout_sessions` | Legacy JSON array of native structured workout sessions, retained only as a migration source |
| `kilo_workout_notes` | JSON array of titled native workout note documents, including persisted `tracked_exercises`, `one_k_exercises`, `exercise_classifications`, `skip_markers`, `attendance_flags`, and `session_checkins` fields; legacy entries may still carry stale `rep_drop_off_flags` |
| `kilo_current_workout_id` | String id of the selected current native workout note |
| `kilo_workout_deload_history` | JSON array of completed deload records (`id`, `raw_text`, `generated_at`, `completed_at`, `session_count`, optional `deload_session_ordinal`); `completed_at` drives calendar/display behavior while Analytics session counts use the furthest stored session anchor (`deload_session_ordinal` for new records, `session_count` for legacy records) |
| `kilo_workout_deload_note` | Active in-progress deload note document; cleared on deload completion or discard |
| `kilo_workout_note` | Legacy single-note key retained for backup compatibility |
| `kilo_fatigue_tracking_enabled` | Persisted feature toggle for fatigue / session check-in tracking (More > Settings) |
| `kilo_deload_mode_enabled` | Persisted feature toggle enabling deload flow in Log (More > Settings) |
| `kilo_weight_date_edit_enabled` | Developer / advanced setting enabling manual date editing on weight entries |
| `kilo_deload_date_edit_enabled` | Developer / advanced setting enabling manual date editing on deload entries |
| `kilo_log_current_collapsed` | Persisted UI state: whether the current Log routine card is collapsed |

On sign-in, cloud bootstrap is gated solely by `kilo_local_data_owner`.
Unclaimed non-empty data requires upload confirmation. When the complete local
state projection is empty and no dirty sync work is queued, an unclaimed device
may instead claim the signed-in account, activate cloud mode, and perform a
pull-only restore; the action rechecks emptiness immediately before claiming
ownership. A different user id or `unknown` keeps storage in local mode until
the user explicitly starts fresh or uploads the device history. The one-time
migration derives ownership from legacy `kilo_sync_bootstrapped_*` keys, and
ownership is claimed only after the selected bootstrap or restore path and
marker persistence succeed. Local-adapter no-ops are never valid manual sync
runners and cannot produce a completed cloud-sync status.

Cloud bootstrap allowlists `display_name` and `unit_system` from
`kilo_user_profile`; all other local profile fields remain on-device. The
Supabase `user_profile` schema has no catch-all profile payload column.

After bootstrap, ongoing cloud reconciliation covers nine table contracts:
`weight_entries`, `workout_notes`, `archived_weight_goals`, `user_profile`,
`user_health_profile`, `feature_toggles`, `weight_goal`, `deload_history`, and
`fatigue_checkins`.
Ordinary account settings remain in `user_profile`; current routine, fatigue
multiplier, tracked lifts, and the active generated deload reconcile through the
consent-gated `user_health_profile`. The ninth contract, `fatigue_checkins`, is
derived deterministically from converged `workout_notes.session_checkins` and
never applies pulled projection rows back to canonical notes. The first three enqueue
dirty rows at write time; the profile, toggles, active goal, and deload history
diff their allowlisted local projections against persisted sync snapshots. A
pending local row always reaches Supabase before conflict ordering is settled,
so the database's server-authored `updated_at` establishes arrival order without
trusting the device clock. Exact timestamp ties prefer the shared server row;
ties between two local candidates use the stable per-install `client_id`.
Supabase returns each pushed row after its timestamp trigger runs; that
acknowledgement replaces the device-stamped sync metadata locally and is the only
push-side evidence allowed to advance the pull cursor. Pulls use an inclusive
timestamp boundary and fetch the complete PostgREST result in explicit pages,
ordered by `updated_at` and then the table primary key (`id` for collections,
`user_id` for singletons). Equal-timestamp boundary rows may be read again, but
the stable secondary order and idempotent merge prevent skipped or starved rows.
If a successful server acknowledgement is older than the stored cursor, the
cursor is known to be poisoned by the former device-clock path. It is removed
rather than clamped to the acknowledgement, so the next pass performs a complete
pull and recovers rows hidden anywhere below that bad cursor.
After a successful push, dirty-queue cleanup compares the queue snapshot captured
for that upload with the value still queued under the same id. The live row sent
to Supabase may also carry local-only state, so it is not the queue identity. A
newer edit or tombstone enqueued while the older push is in flight therefore
stays pending for the next pass instead of being cleared by the older
acknowledgment.
Singleton tables use a synthetic local merge id that is removed before upsert,
and tombstones remain in the sync contract so deletes do not resurrect. The
ownership-confirmation bootstrap projection preserves workout-note
`deleted_at` and `source_snapshot` fields. Workout-note reconciliation also
recognizes the bootstrap-only `wn_legacy_` id namespace when legacy provenance
was stripped by an older upload, but tombstones that row only when a live
non-legacy note coexists; this keeps cleanup linear and preserves legacy-only
and user-authored `Routine 1` notes (#501). Raw workout-note tombstones remain in
AsyncStorage for retry and convergence, while both local and cloud public loaders
filter them from user-visible note lists (#544).

Cloud health authorization is server-owned. Material-versioned grants and
withdrawals are recorded in an immutable consent catalog/event ledger with a
keyed current state. RLS checks the active grant before any health-table read or
write, while protocol and material-version denial codes give the mobile client
actionable UI states without becoming the security boundary. Withdrawal moves
`granted -> deletion_pending -> withdrawn`: the first transition blocks access
and creates a durable job; the client immediately switches to local-only storage,
and any denied preflight does the same so ordinary entry-hook refreshes cannot
attempt consent-gated reads or writes. `health-data-delete` erases the shared
gated scope, and the final transition occurs only after server-side zero-row
verification. After a renewed grant, the client restores cloud routing in-session
only when `kilo_local_data_owner` matches the signed-in user; foreign or unclaimed
device data remains behind the explicit ownership decision.
Supabase Cron dispatches the worker through `pg_net` with Vault-held
credentials, retries indefinitely with capped backoff, and exposes an operator
backlog/re-enqueue path. Account export, account deletion, and withdrawal purge
share one health-data scope; account deletion replaces linked consent rows with
minimum HMAC-pseudonymized evidence retained for six years.

When `useWorkoutNotes()` loads, the storage layer synthesizes a note from any
legacy `kilo_workout_sessions` content if no `kilo_workout_note` exists, saving
the migrated result before returning. Tracked exercise toggles update the global
`kilo_tracked_lifts` map keyed by normalized lift name; 1k slot changes and note
edits update the selected workout-note document so analytics inputs and raw
workout text stay persisted across reloads.

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

## Workout Analytics Ownership Contract

This section is the canonical source-of-truth for which layer owns each native
workout analytics field, which consumers are allowed to read it, and whether
recomputation at render time is permitted.

### Ownership Principles

1. **Single canonical producer.** Every analytics field has exactly one
   authoritative producer path. Consumers must read from that producer's output;
   they must not recompute the same value through a parallel path.
2. **Persisted fields are read-only after save.** When a field is persisted on
   the workout-note document during the Log save path, downstream consumers
   (Home, Analytics) must read the persisted value. They must not override it
   with a live recomputation unless an explicit exception is documented below.
3. **Recompute-only fields have no persistence obligation.** Fields documented
   as recompute-only are derived fresh on each render from canonical note text
   and global state. They must not be written to storage.
4. **Mixed ownership is a bug.** If a field appears in both the persisted note
   document and a consumer-side recomputation with potentially different results,
   that constitutes a source-of-truth conflict that must be resolved.

### Field-by-Field Ownership Matrix

| Field | Canonical Owner | Persistence | Allowed Consumers | Recompute at Render? |
|-------|----------------|-------------|-------------------|---------------------|
| `exercise_classifications` | Log save path via `deriveWorkoutNoteAnalytics()` | Persisted on note document | Home (read-only), Analytics (read-only) | **No** — consumers must read `workoutNote.exercise_classifications` |
| `skip_markers` (`exercise_skips` + `day_skips`) | Log save path via `deriveSkipData()` (current-note scoped) | Persisted on note document | No current UI consumer after `#163`; available for future use | No |
| `attendance_flags` | Log save path via `deriveSkipData()` (current-note scoped) | Persisted on note document | No current UI consumer after `#163`; available for future use | No |
| `session_checkins` | Detection via `deriveSessionCheckIn()`; response written by `SessionCheckInModal` keyed by `sessionIndex` (carries `status`, `reasons`, `responded_at`, captured metrics) | Persisted on note document | Analytics Fatigue section via `deriveCheckInHistory()` (read + edit) | No |
| `rep_drop_off_flags` | _Removed from active contract in issue `#264`; cleanup finished in `#266`_ | No longer produced by the active pipeline; legacy note documents may still carry stale values | No active consumers | N/A |
| `tracked_exercises` | Log tracked-lift toggles via global `kilo_tracked_lifts` | Persisted on note document + global key | Home, Analytics | No |
| `one_k_exercises` | Analytics 1k slot selection | Persisted on note document | Home 1k card, Analytics 1k card | No |
| `big_3_deltas` | _Removed from active contract in issue `#182`_ | Still persisted on legacy note documents but no longer consumed | None | N/A |
| Estimated 1RM per lift | `deriveProgressionSignals()` in `parser.js`, surfaced through `deriveWorkoutNoteAnalytics()` in `data/workoutAnalytics.js` | Not persisted | Analytics strength rows | Yes — recompute-only |
| Kilo max per lift | `deriveProgressionSignals()` in `parser.js`, surfaced through `deriveWorkoutNoteAnalytics()` in `data/workoutAnalytics.js` | Not persisted | Analytics strength rows | Yes — recompute-only |
| Latest top weight | `deriveProgressionSignals()` / `derivePerDaySignals()` in `parser.js`, surfaced through `deriveWorkoutNoteAnalytics()` in `data/workoutAnalytics.js` | Not persisted | Analytics strength rows | Yes — recompute-only |
| Overload trend | `deriveProgressionSignals()` / `derivePerDaySignals()` in `parser.js`, surfaced through `deriveWorkoutNoteAnalytics()` in `data/workoutAnalytics.js` | Not persisted | Analytics strength rows | Yes — recompute-only |
| 1k total | `derive1kTotal()` in `data/oneK.js` | Not persisted | Home 1k card, Analytics 1k card | Yes — recompute-only |
| Weight rolling averages | `computeWeightTrends()` / `computeWeightRollingAverageSeries()` in `data/weightGoal.js` | Not persisted | Home chart, Weight trends card, Analytics weight section | Yes — recompute-only |
| Weight trend prior-window summary | `computeWeightTrendSummary()` via `deriveWeightGoalAnalytics()` in `data/weightGoal.js` | Not persisted | Weight trends card, Home weight summary, Analytics weight section | Yes — recompute-only |
| Weight pace level | `computeWeightPaceLevel()` in `data/weightGoal.js` | Not persisted | Weight trends card, Analytics weight section | Yes — recompute-only |
| Weight goal guidance | `resolveGoalCurrentWeight()` / `computeWeightGoal()` / `computeCalorieEstimate()` in `data/weightGoal.js` | Goal persisted; guidance recomputed | Weight goal card only | Yes — recompute-only (from persisted goal plus latest-entry/start-weight fallback contract) |
| Weeks In | `computeWeeksIn()` in `data/routineStatus.js` | Not persisted | Home summary card | Yes — recompute-only |
| Session/activity count | `countWorkoutSessions()` in `parser.js` | Not persisted | Home, Analytics | Yes — recompute-only |
| Big 3 asymmetry notes | `detectBig3Asymmetry()` in `data.js` | Not persisted | No current UI consumer after `#174`; available for future use | Yes — recompute-only |
| Weekly summary aggregation | `computeWeeklySummary()` in `data/workoutAnalytics.js` | Not persisted | Home only | Yes — recompute-only (reads persisted note fields) |

### Producer/Consumer Map

```
┌─────────────────────────────────────────────────────────────────────┐
│  LOG SAVE PATH (Producer)                                           │
│  LogScreen.js — via deriveWorkoutNoteAnalytics() + deriveSkipData() │
│                                                                     │
│  Produces on each save:                                             │
│    • exercise_classifications  (via canonical layer, all sections)   │
│    • skip_markers (exercise_skips + day_skips)  (current note only)  │
│    • attendance_flags                           (current note only)  │
│                                                                     │
│  Does NOT produce:                                                  │
│    • rep_drop_off_flags (removed from active contract in #264)       │
│    • big_3_deltas (removed from active contract in #182)            │
└─────────────────────────────────────────────────────────────────────┘
        │
        ▼  persisted on workoutNote document
┌─────────────────────────────────────────────────────────────────────┐
│  HOME (Consumer — read-only from persisted note)                    │
│  HomeScreen.js                                                      │
│                                                                     │
│  Reads from persisted note:                                         │
│    • exercise_classifications (via computeWeeklySummary)            │
│                                                                     │
│  Legitimately recomputes:                                           │
│    • 1k total, weight series, weeks-in                              │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  ANALYTICS (Consumer — canonical live derivation)                   │
│  StatsScreen.js                                                     │
│                                                                     │
│  Legitimately recomputes:                                           │
│    • signal rows + display casing via deriveWorkoutNoteAnalytics()  │
│    • 1k total, weight rolling averages, pace                        │
└─────────────────────────────────────────────────────────────────────┘
```

### Recomputation Rules

`session_checkins` is persisted separately by the session check-in response
flow (`SessionCheckInModal`) and keyed by session index on the workout-note
document, with each record carrying an answer-time `responded_at` timestamp.
Detection is `deriveSessionCheckIn()` and the read/edit consumer is
`deriveCheckInHistory()`; see the Session Check-In (Fatigue) Flow section above.

**Consumers MUST NOT recompute these fields:**
- `exercise_classifications` — read from `workoutNote.exercise_classifications`
- `skip_markers` — read from `workoutNote.skip_markers`
- `attendance_flags` — read from `workoutNote.attendance_flags`
- `session_checkins` — read from `workoutNote.session_checkins`

**Consumers MAY recompute these fields (they have no persisted equivalent):**
- Estimated 1RM, Kilo max, latest top weight, overload trend, and signal-row
  display casing via `deriveWorkoutNoteAnalytics()`
- 1k total
- Weight rolling averages, pace level, goal guidance
- Weeks In, session count
- Weekly summary aggregation (reads persisted note fields, aggregates live)

**Canonical temporal helper semantics for recompute-only consumers:**
- `currentWeekStart()` defines the shared Sunday-based current-week gate used by
  native workout consumers that need a current-week boundary
- `rollingWindowStart()` defines the shared inclusive rolling-window cutoff used
  by native weight-trend consumers that need calendar-based rolling windows
- `detectBig3Asymmetry()` now aligns Big 3 history by session-entry index rather
  than calendar-week buckets

**`computeWeeklySummary` consumption contract:**
- Must read `exercise_classifications` from `workoutNote.exercise_classifications` only
- Must read `attendance_flags` from `workoutNote.attendance_flags` only
- Does not currently consume `rep_drop_off_flags`

### Acceptance Contract for Downstream Issues

Any downstream implementation issue that touches workout analytics must:
1. Identify which fields from this matrix it reads or writes.
2. Confirm its read/write pattern matches the documented ownership.
3. Not introduce a new parallel computation path for a field already owned by
   the Log save path.
4. If it needs to change ownership for a field, explicitly state which row in
   this matrix it modifies and why.

## Testing Shape

The native Jest suite under `mobile/tests/` covers parser, data, storage,
format, weight-goal UI, and account lifecycle. Additional test modules cover
analytics screen derivations, auth session, auto-sync, autosave, backup screen,
cloud bootstrap, error reporting, home dashboard, log screen, offline sync,
plate math, reminders and reminder scheduling, screen shell, session check-in
modal, storage adapter routing, sync recovery UI, unit display, units conversion,
and weight screen. Run the suite with `npm --prefix mobile test`.

The browser prototype's vitest suite and jsdom setup have been archived with the
prototype source (issue #213). No browser test infrastructure remains in the
active codebase.

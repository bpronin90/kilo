# Backend And Web-First Distribution Roadmap

Kilo is moving from a personal local-only app to a public self-serve product. This roadmap is the build contract for that move. The app must remain usable after every card, web is the primary distribution surface, and the shipped note-first workout model is the source of truth.

Out of scope for this roadmap: dumbbell-to-barbell bench conversion, normalized per-set workout storage, broad coaching features, social features, and speculative analytics tables.

## Current Product Grounding

- The shipped workout model is note-first. `workout_notes.raw_text` remains canonical, and derived fields are snapshots used for rendering, sync, and export.
- `mobile/storage/entries.js` is the persistence seam behind `mobile/hooks/useEntries.js`. Cloud sync must slot behind that seam instead of screens calling Supabase directly.
- AsyncStorage remains the offline cache. Supabase Postgres is the cloud source of truth once a user signs in.
- Web already runs locally through React Native Web. Public distribution still needs a deployable static export path, web-safe auth and sync, desktop responsiveness, and non-touch-only edit/date/back interactions.

## Target Cloud Model

All app-owned tables live in `public`, have RLS enabled, and include `user_id uuid not null references auth.users(id) on delete cascade` unless the table primary key is the user id. Client queries must always be user-scoped and index-backed; avoid nested scans by fetching changed records by table and `updated_at` cursor.

### `user_profile`

One row per user. This is the account-owned singleton for preferences and current pointers that do not need their own history.

| Field | Type | Notes |
|---|---|---|
| user_id | UUID | Primary key, equals `auth.users.id` |
| display_name | TEXT | Optional self-serve profile field |
| unit_system | TEXT | Optional default unit preference |
| current_workout_note_id | TEXT | Current routine id from local notebook |
| fatigue_multiplier | NUMERIC | Current fatigue multiplier preference |
| tracked_lifts | JSONB | Map of normalized exercise names to booleans |
| ui_state | JSONB | Small cross-device UI preferences, including current Log collapse state |
| current_deload_note_raw_text | TEXT | Draft/current deload note text |
| current_deload_note_saved_at | TIMESTAMPTZ | Original draft save time |
| current_deload_note_updated_at | TIMESTAMPTZ | Last draft update time |
| profile_json | JSONB | Forward-compatible copy of local profile fields not yet promoted |
| created_at | TIMESTAMPTZ | Server default |
| updated_at | TIMESTAMPTZ | Conflict cursor |
| deleted_at | TIMESTAMPTZ | Tombstone for sync/account export consistency |

### `feature_toggles`

One row per user. Feature settings stay separate from profile copy because they gate product behavior.

| Field | Type | Notes |
|---|---|---|
| user_id | UUID | Primary key |
| weight_date_edit_enabled | BOOLEAN | Defaults false |
| deload_date_edit_enabled | BOOLEAN | Defaults false |
| fatigue_tracking_enabled | BOOLEAN | Defaults true |
| deload_mode_enabled | BOOLEAN | Defaults true |
| created_at | TIMESTAMPTZ | Server default |
| updated_at | TIMESTAMPTZ | Conflict cursor |
| deleted_at | TIMESTAMPTZ | Tombstone |

### `weight_entries`

One row per weight entry.

| Field | Type | Notes |
|---|---|---|
| id | TEXT | Primary key with `user_id`; preserves local ids |
| user_id | UUID | Owner |
| entry_type | TEXT | Constant `weight` |
| date | DATE | Local effective date |
| logged_at | TIMESTAMPTZ | Original logged timestamp |
| weight_value | NUMERIC | Required |
| note | TEXT | Optional note |
| saved_at | TIMESTAMPTZ | Local saved time when available |
| updated_at | TIMESTAMPTZ | Conflict cursor |
| deleted_at | TIMESTAMPTZ | Tombstone |

Primary key: `(user_id, id)`. Index: `(user_id, logged_at desc)` for history.

### `weight_goal`

One row per user when a goal exists.

| Field | Type | Notes |
|---|---|---|
| user_id | UUID | Primary key |
| target_weight | NUMERIC | Required when row exists |
| target_date | DATE | Required when row exists |
| start_weight | NUMERIC | Optional local field if present |
| start_date | DATE | Optional local field if present |
| goal_json | JSONB | Copy of unpromoted local fields |
| saved_at | TIMESTAMPTZ | Local saved time |
| updated_at | TIMESTAMPTZ | Conflict cursor |
| deleted_at | TIMESTAMPTZ | Tombstone for clearing the goal |

### `workout_notes`

One row per notebook routine. This replaces the stale normalized workout tree. Raw text is canonical; derived JSON is a cache/snapshot and can be regenerated from `raw_text`.

| Field | Type | Notes |
|---|---|---|
| id | TEXT | Primary key with `user_id`; preserves local ids |
| user_id | UUID | Owner |
| title | TEXT | Notebook title |
| raw_text | TEXT | Canonical workout note |
| saved_at | TIMESTAMPTZ | Original save time |
| updated_at | TIMESTAMPTZ | Conflict cursor |
| tracked_exercises | JSONB | Derived list from current parser |
| one_k_exercises | JSONB | Derived 1k tracking data |
| skip_markers | JSONB | Derived skip marker data |
| attendance_flags | JSONB | Derived attendance data |
| exercise_classifications | JSONB | Derived classifications |
| session_checkins | JSONB | Derived fatigue/check-in data embedded in note model |
| is_current | BOOLEAN | Convenience mirror; `user_profile.current_workout_note_id` is authoritative |
| source_snapshot | JSONB | Optional one-time import snapshot for legacy `kilo_workout_sessions` or `kilo_workout_note` |
| deleted_at | TIMESTAMPTZ | Tombstone |

Primary key: `(user_id, id)`. Index: `(user_id, updated_at desc)`.

### `deload_history`

One row per deload history record. The current/draft deload note remains on `user_profile`; completed historical records live here.

| Field | Type | Notes |
|---|---|---|
| id | TEXT | Primary key with `user_id`; preserves local ids |
| user_id | UUID | Owner |
| date | DATE | Effective deload date if present |
| raw_text | TEXT | Original deload text or note |
| record_json | JSONB | Copy of local record fields |
| saved_at | TIMESTAMPTZ | Local saved time if present |
| updated_at | TIMESTAMPTZ | Conflict cursor |
| deleted_at | TIMESTAMPTZ | Tombstone |

### `fatigue_checkins`

Optional extracted rows for queryable fatigue history. These rows are derived from `workout_notes.session_checkins`; the note remains canonical.

| Field | Type | Notes |
|---|---|---|
| id | TEXT | Stable id derived from note id and session/date |
| user_id | UUID | Owner |
| workout_note_id | TEXT | Source note id |
| session_date | DATE | Effective session date |
| status | TEXT | Rough/normal/skipped or current local vocabulary |
| reasons | JSONB | Triggering detectors/answers |
| source_json | JSONB | Derived source payload |
| updated_at | TIMESTAMPTZ | Conflict cursor |
| deleted_at | TIMESTAMPTZ | Tombstone |

Primary key: `(user_id, id)`. Indexes: `(user_id, session_date desc)` and `(user_id, workout_note_id)`.

## AsyncStorage Key Mapping

Every key in `mobile/storage/entries.js` has an explicit cloud destination or migration rule.

| AsyncStorage key | Cloud target | Rule |
|---|---|---|
| `kilo_weight_entries` | `weight_entries` | One local item becomes one row. Preserve `id`, `entry_type`, `date`, `logged_at`, `weight_value`, `note`, `saved_at`, and unknown fields only if later required by export. |
| `kilo_weight_goal` | `weight_goal` | Singleton row. Clearing the local goal sets a `deleted_at` tombstone or deletes after sync retention. |
| `kilo_workout_sessions` | `workout_notes.raw_text`, `workout_notes.source_snapshot` | Legacy structured sessions are not a target model. During bootstrap, synthesize note text using the existing migration semantics and optionally retain the original session array in `source_snapshot`. |
| `kilo_workout_note` | `workout_notes` | Legacy single note migrates into a notebook row with `source_snapshot.async_storage_key = "kilo_workout_note"`. |
| `kilo_workout_notes` | `workout_notes` | One local notebook item becomes one row. Preserve raw text and derived JSON fields. |
| `kilo_current_workout_id` | `user_profile.current_workout_note_id` | Pointer only. The pointed routine must exist in `workout_notes` unless it was deleted locally. |
| `kilo_fatigue_multiplier` | `user_profile.fatigue_multiplier` | Singleton preference. Default remains local default until the first profile sync. |
| `kilo_weight_date_edit_enabled` | `feature_toggles.weight_date_edit_enabled` | Boolean feature setting. |
| `kilo_workout_deload_note` | `user_profile.current_deload_note_raw_text`, `current_deload_note_saved_at`, `current_deload_note_updated_at` | Current/draft deload note, not historical record. |
| `kilo_workout_deload_history` | `deload_history` | One local record becomes one row. Preserve unknown local fields in `record_json`. |
| `kilo_tracked_lifts` | `user_profile.tracked_lifts` | Account-level tracked lift map. |
| `kilo_log_current_collapsed` | `user_profile.ui_state.log_current_collapsed` | Cross-device UI preference. |
| `kilo_user_profile` | `user_profile` | Promote known fields and copy unpromoted fields to `profile_json`. |
| `kilo_deload_date_edit_enabled` | `feature_toggles.deload_date_edit_enabled` | Boolean feature setting. |
| `kilo_fatigue_tracking_enabled` | `feature_toggles.fatigue_tracking_enabled` | Boolean feature setting; default true. |
| `kilo_deload_mode_enabled` | `feature_toggles.deload_mode_enabled` | Boolean feature setting; default true. |

The v3 backup payload remains the migration/export shape reference: `weight_entries`, `workout_notes`, `current_workout_id`, `weight_goal`, `fatigue_multiplier`, and `deload_history`.

## Auth, RLS, And Isolation Contract

- Auth methods: email/password, password reset, and at least one OAuth provider before public launch.
- React Native sessions use Supabase client storage backed by `expo-secure-store` for token material. Browser sessions use the web-safe Supabase client storage path.
- No public client may receive a `service_role` key. Account deletion and full export run through server-owned code only.
- Enable RLS on every app table before exposing the client. Policies must allow authenticated users to select, insert, update, and delete only rows where `user_id = auth.uid()` or `user_id` primary key equals `auth.uid()`.
- Update policies must include the matching select policy because Postgres update visibility depends on row selection.
- Do not use user-editable metadata for authorization. If role-like data is later needed, store it in app-owned server-controlled metadata or app tables.
- For singleton tables, inserts require `with check (user_id = auth.uid())`; updates and deletes require `using (user_id = auth.uid())`.
- Account deletion must delete or tombstone all app rows before calling the server-side auth admin deletion path, then sign the client out. JWTs may remain valid until expiry, so deletion UX must not imply immediate token invalidation across already-open clients.

## Offline-First Sync Contract

- Local AsyncStorage remains the immediate read/write cache so daily use works offline.
- Supabase is the cloud source of truth after sign-in. Anonymous/local users continue to use the existing local-only behavior until they opt in.
- Each table syncs by stable record id, `updated_at`, and `deleted_at`.
- Conflict policy: last-write-wins per record by `updated_at`; exact timestamp ties break deterministically by `client_id` lexicographic order. This is acceptable because the app has personal single-user data and the main risk is multi-device editing, not collaboration.
- Deletes write tombstones first. Physical deletion can happen after an export-safe retention window.
- Sync loop shape: pull changed rows since cursor, merge into AsyncStorage, push dirty local records, then advance per-table cursors only after successful writes.
- Derived workout JSON must be regenerated from `raw_text` before upload when local parser output is newer than the cloud row. If derived JSON conflicts but `raw_text` does not, recompute instead of treating it as user conflict.
- Bootstrap from existing local data is explicit and reversible until first successful cloud commit. Failed bootstrap leaves local AsyncStorage untouched.

## Self-Serve Product Obligations

- Signup, login, logout, OAuth callback, and password reset must work on web before public launch.
- Account deletion must be available to the signed-in user and must remove app data plus the auth user through server-owned code.
- Data export must return a JSON payload compatible with the v3 backup shape plus account/profile/toggle additions needed for cloud users.
- Privacy policy and terms must be linked from the public web surface before open signup.
- Abuse posture before public launch: Supabase Auth rate limits reviewed, CAPTCHA enabled or explicitly deferred with reason, server-side export/delete endpoints rate-limited per user and IP, and no unauthenticated write endpoints.

## Web-First Distribution Contract

- `app.json` needs `web.bundler: "metro"` and `web.output: "single"` for static export.
- Add the runtime dependency required by Expo web static export if missing.
- Build command target: `npx expo export --platform web`.
- Hosting target: static hosting through Cloudflare Pages, Netlify, Vercel static output, or equivalent. The selected host must support SPA fallback to the exported entrypoint.
- Web is primary; native Android remains secondary and must not regress.
- Web fallbacks required before public launch: explicit edit controls for double-tap-to-edit flows, browser-safe back behavior for Android-back-only flows, and a web date input/modal fallback for native `DateTimePicker`.
- Desktop responsive pass must cover the shell, Log, Weight, More/settings, auth screens, export/delete screens, and error/offline states.

## Sequenced Issue Series

Use this naming convention exactly for the GitHub issues: `Phase X / Task Y: <imperative scope>`. Every issue in this series must carry the `backend-v1` label.

Each issue body must be a tight task contract with these sections:

- `Role`
- `Parent` with `Roadmap: #309`, `Series label: backend-v1`, and the roadmap phase/task reference
- `Objective`
- `Tight scope`
- `Non-goals`
- `Allowed Files`
- `Acceptance Criteria`
- `Verification`
- `Stop Condition`

`Allowed Files` must name the narrowest plausible file paths. Use a glob only for a directory that the task is explicitly allowed to create, such as a new Supabase migration or Edge Function folder. If implementation requires files outside the listed set, the assigned agent must stop and report the mismatch instead of widening scope.

### Phase 1: Safety Net

- Phase goal: add missing coverage around the flows most likely to break during web and sync work.
- Allowed scope: tests and minimal testability seams only.
- Explicit out of scope: Supabase implementation, web deployment, UI redesign.
- Dependency: issue 309 complete.
- Completion condition: app shell/back, Log save/edit/parse, and Weight edit/delete have targeted coverage.

Ordered tasks:

#### Task 1: Cover app shell and navigation back behavior
- GitHub title: `Phase 1 / Task 1: Cover app shell and navigation back behavior`
- Intended agent: `gemini`
- Labels: `backend-v1`, `agent:gemini`, `area:ui`, `type:implementation`, `effort:default`
- Session goal: add focused coverage for app shell navigation and back behavior before web fallback changes.
- Dependency: issue 309 complete.
- Verification target: the relevant app-shell/back tests fail on broken navigation and pass on current behavior.
- Stop condition: no production behavior changes beyond minimal testability seams.

#### Task 2: Cover Log save, edit, and parse behavior
- GitHub title: `Phase 1 / Task 2: Cover Log save, edit, and parse behavior`
- Intended agent: `gemini`
- Labels: `backend-v1`, `agent:gemini`, `area:ui`, `area:workouts`, `area:parser`, `type:implementation`, `effort:heavy`
- Session goal: protect the note-first Log flow before sync and web edits.
- Dependency: Phase 1 / Task 1 complete.
- Verification target: tests cover saving raw note text, editing an existing note, parser-derived display state, and persistence through the storage seam.
- Stop condition: no parser contract or storage shape change.

#### Task 3: Cover Weight edit and delete behavior
- GitHub title: `Phase 1 / Task 3: Cover Weight edit and delete behavior`
- Intended agent: `gemini`
- Labels: `backend-v1`, `agent:gemini`, `area:ui`, `area:weight`, `type:implementation`, `effort:default`
- Session goal: protect the shipped weight correction flows before sync writes are introduced.
- Dependency: Phase 1 / Task 1 complete.
- Verification target: tests cover edit, date validation behavior, delete, and list refresh from the storage seam.
- Stop condition: no weight UX redesign.

### Phase 2: Web Deployability

- Phase goal: make the current local-data app deployable on web without backend dependency.
- Allowed scope: Expo web config, web runtime dependency, static export, hosting notes, responsive and input fallbacks.
- Explicit out of scope: Supabase schema and cloud sync.
- Dependency: Phase 1 coverage tasks complete where they touch the same flow.
- Completion condition: local-data Kilo can be exported and smoke-tested as a static web build.

Ordered tasks:

#### Task 4: Enable Expo web static export
- GitHub title: `Phase 2 / Task 4: Enable Expo web static export`
- Intended agent: `gemini`
- Labels: `backend-v1`, `agent:gemini`, `area:ui`, `type:implementation`, `effort:default`
- Session goal: configure Metro web bundling and single-output static export.
- Dependency: Phase 1 / Task 1 complete.
- Verification target: `npx expo export --platform web` produces a static output.
- Stop condition: native Android still starts with existing local storage behavior.
- Status: complete in issue #313; `mobile/app.json` now sets `web.bundler:
  "metro"` and `web.output: "single"`, and the export command completed from
  `mobile/`.

#### Task 5: Add desktop responsive and touch-idiom fallbacks
- GitHub title: `Phase 2 / Task 5: Add desktop responsive and touch-idiom fallbacks`
- Intended agent: `gemini`
- Labels: `backend-v1`, `agent:gemini`, `area:ui`, `area:workouts`, `area:weight`, `type:implementation`, `effort:heavy`
- Session goal: make core local flows usable on desktop web.
- Dependency: Phase 2 / Task 4 complete.
- Verification target: Log, Weight, More/settings, and shell flows work without double-tap-only, Android-back-only, or native-date-picker-only interactions.
- Stop condition: no visual redesign beyond web usability.
- Status: complete in issue #314; web now has an explicit Home back affordance,
  a wide-content readability cap, explicit single-press Log edit paths, and DOM
  date-input fallbacks for Weight date edits and linked Log deload-date edits.
  Native Android back and native date-picker paths remain in place.

#### Task 6: Add web export smoke verification
- GitHub title: `Phase 2 / Task 6: Add web export smoke verification`
- Intended agent: `claude`
- Labels: `backend-v1`, `agent:claude`, `area:ui`, `area:docs`, `type:implementation`, `effort:default`, `reasoning:medium`
- Session goal: document and automate the minimum repeatable verification for static web export.
- Dependency: Phase 2 / Task 4 complete.
- Verification target: a command or documented QA path confirms the exported web build boots with local data.
- Stop condition: no hosting provider lock-in beyond documenting the selected static-hosting path.
- Verification path: `npm run web:smoke` is a fast automated pre-flight only — it exports the web build, serves it with `expo serve`, and asserts the static entrypoint is served (HTTP 200 with the `root` mount node and an `_expo/static/js` bundle). It does not execute the bundle or prove boot/local-data. Boot is verified by the required browser + local-data pass: `npm run web:export` / `npm run web:serve`, then open the served URL in a browser, confirm the app shell visibly mounts, add a weight entry, reload, and confirm it persists via AsyncStorage-backed local storage. Both are documented in `docs/testing-and-qa.md` under "Web Export Smoke Check". The pre-flight does not validate the Task 4 config (`web.bundler: "metro"`, `web.output: "single"`); it relies on that config being present after merge and fails fast only if the export does not emit `dist/index.html`.

### Phase 3: Supabase Foundation

- Phase goal: introduce the cloud schema, auth shell, and storage-seam architecture without taking over daily local use.
- Allowed scope: Supabase migrations/config, auth client setup, storage adapter seams, tests.
- Explicit out of scope: destructive local migration, public signup launch.
- Dependency: Phase 1 complete.
- Completion condition: signed-in test users can access isolated empty cloud data while signed-out users keep local behavior.

Ordered tasks:

#### Task 7: Create note-first Supabase schema and RLS
- GitHub title: `Phase 3 / Task 7: Create note-first Supabase schema and RLS`
- Intended agent: `claude`
- Labels: `backend-v1`, `agent:claude`, `area:supabase`, `type:implementation`, `effort:heavy`, `reasoning:high`
- Session goal: implement the tables, indexes, and RLS policies from this roadmap.
- Dependency: issue 309 complete.
- Verification target: migration applies cleanly and policy tests prove user A cannot read or mutate user B rows.
- Stop condition: no normalized per-set workout tables are introduced.

#### Task 8: Add Supabase auth client behind app shell
- GitHub title: `Phase 3 / Task 8: Add Supabase auth client behind app shell`
- Intended agent: `claude`
- Labels: `backend-v1`, `agent:claude`, `area:supabase`, `area:ui`, `type:implementation`, `effort:heavy`, `reasoning:medium`
- Session goal: add email/password, password reset, OAuth callback plumbing, and secure session storage without forcing sign-in for existing local users.
- Dependency: Phase 3 / Task 7 complete.
- Verification target: native and web auth smoke tests cover sign in, sign out, session restore, and password reset path.
- Stop condition: no cloud data writes outside authenticated test flows.

#### Task 9: Define and test the storage-seam cloud adapter
- GitHub title: `Phase 3 / Task 9: Define and test the storage-seam cloud adapter`
- Intended agent: `claude`
- Labels: `backend-v1`, `agent:claude`, `area:supabase`, `area:workouts`, `area:weight`, `type:implementation`, `effort:heavy`, `reasoning:high`
- Session goal: introduce an adapter behind `mobile/storage/entries.js`/`useEntries.js` that can choose local-only or cloud-backed sync mode.
- Dependency: Phase 3 / Task 8 complete.
- Verification target: existing screens still use the storage hook/seam and tests prove signed-out local mode is unchanged.
- Stop condition: screens do not import or call Supabase directly.

### Phase 4: Bootstrap And Sync

- Phase goal: safely move existing local data into the note-first cloud model and keep devices synchronized.
- Allowed scope: bootstrap import, per-table sync cursors, dirty queues, conflict/tombstone handling, export parity.
- Explicit out of scope: collaboration, admin tooling, realtime multi-user editing.
- Dependency: Phase 3 complete.
- Completion condition: a signed-in user can bootstrap current local data, go offline, edit, reconnect, and see consistent cloud-backed state.

Ordered tasks:

#### Task 10: Bootstrap local AsyncStorage data to cloud
- GitHub title: `Phase 4 / Task 10: Bootstrap local AsyncStorage data to cloud`
- Intended agent: `claude`
- Labels: `backend-v1`, `agent:claude`, `area:supabase`, `area:workouts`, `area:weight`, `type:implementation`, `effort:heavy`, `reasoning:high`
- Session goal: upload the v3-backup-shaped local dataset into the cloud tables without mutating local data on failure.
- Dependency: Phase 3 / Task 9 complete.
- Verification target: every mapped AsyncStorage key lands in the target table/field and a failed bootstrap leaves local state intact.
- Stop condition: no automatic destructive migration.

#### Task 11: Implement last-write-wins offline sync
- GitHub title: `Phase 4 / Task 11: Implement last-write-wins offline sync`
- Intended agent: `claude`
- Labels: `backend-v1`, `agent:claude`, `area:supabase`, `area:workouts`, `area:weight`, `type:implementation`, `effort:heavy`, `reasoning:high`
- Session goal: sync changed records by table using `updated_at`, `deleted_at`, stable ids, dirty queues, and deterministic tie-breaks.
- Dependency: Phase 4 / Task 10 complete.
- Verification target: offline create/edit/delete for weight entries and workout notes syncs correctly after reconnect.
- Stop condition: no realtime or collaborative editing requirement.

#### Task 12: Add cloud export parity and sync recovery UX
- GitHub title: `Phase 4 / Task 12: Add cloud export parity and sync recovery UX`
- Intended agent: `gemini`
- Labels: `backend-v1`, `agent:gemini`, `area:ui`, `area:supabase`, `type:implementation`, `effort:heavy`
- Session goal: expose user-safe states for bootstrap/sync/export success, conflict overwrite, retry, and recoverable errors.
- Dependency: Phase 4 / Task 11 complete.
- Verification target: user can export cloud-backed data in the v3-compatible shape and recover from an interrupted sync without data loss.
- Stop condition: no admin-only support tools.

### Phase 5: Self-Serve Launch Requirements

- Phase goal: complete the public-account obligations around account lifecycle, policies, and abuse posture.
- Allowed scope: account screens, server-owned export/delete endpoints, static legal pages/links, rate limiting/CAPTCHA configuration.
- Explicit out of scope: billing, teams, social sharing.
- Dependency: Phase 4 complete for data-bearing account actions.
- Completion condition: a public user can sign up, recover access, export data, delete the account, and understand terms/privacy.

Ordered tasks:

#### Task 13: Add account export and deletion
- GitHub title: `Phase 5 / Task 13: Add account export and deletion`
- Status: Complete in issue #322.
- Intended agent: `claude`
- Labels: `backend-v1`, `agent:claude`, `area:supabase`, `area:ui`, `type:implementation`, `effort:heavy`, `reasoning:high`
- Session goal: implement server-owned full export and account deletion flows without exposing privileged keys.
- Dependency: Phase 4 / Task 12 complete.
- Verification target: export includes all mapped tables and deletion removes app data plus the auth user for the requester only.
- Stop condition: no cross-user/admin deletion surface.

#### Task 14: Add privacy, terms, and abuse-limiting posture
- GitHub title: `Phase 5 / Task 14: Add privacy, terms, and abuse-limiting posture`
- Intended agent: `codex`
- Labels: `backend-v1`, `agent:codex`, `area:docs`, `area:supabase`, `type:planning`, `effort:default`, `model:gpt-5.4`, `reasoning:medium`
- Session goal: create the launch-blocking legal/abuse checklist and wire follow-up implementation issues only where needed.
- Dependency: Phase 5 / Task 13 complete.
- Verification target: public web surface has linked privacy/terms placeholders or final docs, and Auth/server endpoint rate-limit/CAPTCHA decisions are documented.
- Stop condition: no legal claims beyond user-approved copy.

### Phase 6: Public Web Readiness Review

- Phase goal: verify the web-first Supabase product is safe to expose beyond personal use.
- Allowed scope: review, QA, living docs/changelog/version closeout if instructed by repo process.
- Explicit out of scope: new feature implementation.
- Dependency: Phases 1 through 5 complete.
- Completion condition: reviewer either approves public web readiness or files blocking follow-up issues.

Ordered tasks:

#### Task 15: Run public web readiness review
- GitHub title: `Phase 6 / Task 15: Run public web readiness review`
- Intended agent: `codex`
- Labels: `backend-v1`, `agent:codex`, `area:docs`, `area:supabase`, `area:ui`, `type:review`, `effort:heavy`, `model:gpt-5.4`, `reasoning:high`
- Session goal: review the completed backend, sync, self-serve, and web distribution work against this roadmap.
- Dependency: Phase 5 / Task 14 complete.
- Verification target: explicit `VERDICT=APPROVED`, `VERDICT=FEEDBACK`, or `VERDICT=BLOCKED` with blocker issues filed when needed.
- Stop condition: do not close or merge incomplete launch work.

## GitHub Label Rules For This Series

- Every created issue must have exactly one `agent:` label.
- Every created issue must have exactly one `type:` label.
- Every created issue must have at least one `area:` label.
- Every created issue must have the roadmap series label `backend-v1`.
- Every `agent:codex` issue must have exactly one `model:` label and exactly one `reasoning:` label.
- Every `agent:claude` issue must have exactly one `reasoning:` label and no `model:` label.
- Every `agent:gemini` issue must not have a `model:` label and does not require `reasoning:` under the current repo policy.
- Use `effort:heavy` only on cards with multi-surface implementation, schema/RLS risk, sync risk, or higher verification burden.

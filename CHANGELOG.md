# Changelog

## 0.79.1 - 2026-06-25

- Issue #365: Fixed the Account screen's session-restore flicker by suppressing
  the configured signed-out form while the persisted-session probe is still in
  flight. Restored sessions now resolve to the signed-in view without briefly
  flashing the Sign In form, while unconfigured local-only builds and signed-out
  configured builds keep their existing behavior.

## 0.79.0 - 2026-06-24

- Issue #363: Added GitHub sign-in to configured Android builds using a stable
  `kilo://auth/callback` deep link, an SDK-compatible system browser auth
  session, and Supabase PKCE code exchange with persisted sessions. Added clear
  cancellation, provider, missing-callback, and exchange-error feedback while
  preserving the existing web OAuth path and unconfigured local-only mode. The
  Supabase redirect is configured; installed-build callback and restart
  persistence verification was deferred by owner direction. This native module
  and URL-scheme change requires a fresh APK/AAB rather than an OTA-only update.

## 0.78.0 - 2026-06-24

- Issue #359: Reorganized the More tab into balanced `Profile & Account`,
  `Settings & Data`, and `Help & Support` sections; removed duplicate workout
  and weight quick actions; aligned the Settings label; clarified how Profile
  data supports Weight calorie targets; added Account state headings; and
  differentiated local-device, client-built cloud, and server-held exports.

## 0.77.21 - 2026-06-24

- Issue #362: Fixed the remaining low-contrast More-tab surfaces left out of
  #357's scope. Accent tone cards and the improved/held trend badges now meet
  WCAG AA via card-/badge-scoped darkened background constants (accent
  2.39:1 -> 5.09:1, success badge 4.39:1 -> 6.44:1); error surfaces were already
  compliant and are unchanged. The shared color palette is untouched, so the
  session gauge and other palette consumers are visually identical.

## 0.77.20 - 2026-06-24

- Issue #361: Added automated coverage for the Backup import-confirm flow shipped
  in #356. New `mobile/tests/backup-screen.test.js` verifies that import requires
  the destructive confirmation before `onImport` runs, that cancel is a safe
  no-op, that confirming restores data, and that empty input is rejected without
  firing the alert. Test-only change; no product code affected.

## 0.77.19 - 2026-06-23

- Issue #357: Improved More-tab accessibility. Filled success and caution tone
  cards now use darkened card-only background constants so light text meets WCAG
  AA contrast (success 6.44:1, caution 5.06:1) without altering the shared
  palette used by the session gauge and badges; error cards were already
  compliant and left unchanged. Back-button touch targets in the screen shell
  and web header are now at least 44x44.

## 0.77.18 - 2026-06-23

- Issue #356: Hardened More-tab correctness and data safety. Data import now
  requires an explicit destructive confirmation before replacing local data;
  busy buttons show their intended label (e.g. "Working…", "Checking…") via a new
  `loadingTitle` prop instead of always reading "Saving…"; the Backup unencrypted
  warning renders in the caution color instead of error red; and Privacy/Terms
  links are reachable from the Account screen in the cloud-unconfigured state.

## 0.77.17 - 2026-06-23

- Issue #355: Coordinated App-shell and More-tab back handling so Android
  system back returns from a More child to the More menu before returning Home,
  while web More children show one stable local Back control without the global
  Home control or a transition flicker.

## 0.77.16 - 2026-06-23

- Issue #360: Replaced user-facing cloud bootstrap jargon with plain-language
  first-upload and bidirectional-sync guidance across Account and the App Guide.
  Clarified the offline working copy, synchronized cloud copy, conflict behavior,
  and that deleting an account preserves training history on the device.

## 0.77.15 - 2026-06-23

- Issue #353: Added tracked Supabase configuration for the project-local
  identifier, exact Data API exposed schemas, and `verify_jwt = false` on the
  account export/delete Edge Functions. Added a repository deployment script
  that supplies the hosted project ref explicitly and deploys only the two
  Kilo-owned functions, preventing fresh-checkout deploys from drifting auth
  settings or targeting the unrelated function in the shared project.

## 0.77.14 - 2026-06-22

- Issue #350: Hardened backup/export data exposure (audit #347 Finding #2). The
  backup export now shows a blocking "export is unencrypted" confirmation before
  sharing and a persistent on-screen caution, and `buildCloudExport` omits the
  signed-in account email by default — it is included only when a caller opts in,
  which the cloud-recovery identity flow now does explicitly.
- Issue #351: Capped untrusted input size on the parse, import, and recompute
  paths (audit #347 Finding #3). Oversized note text and oversized import arrays
  are rejected with a clear error before the per-line/per-element loops run, so a
  pathological paste or synced row cannot freeze the device.
- Issue #352: Replaced the per-isolate in-memory rate limiting in the
  `account-export`/`account-delete` Edge Functions with durable, shared
  Postgres-backed limits (audit #347 Finding #4). A `kilo.rate_limit_hits` table
  plus a `SECURITY DEFINER` `rate_limit_check` (service_role only) holds state
  across isolate recycling/cold starts, and a per-bucket advisory lock makes each
  check atomic under concurrency; the limiter fails open on backend error. New
  migration must be applied to the remote Supabase project.

## 0.77.13 - 2026-06-22

- Issue #349: Hardened the cloud-sync write path against last-write-wins
  manipulation (audit #347 Finding #1). `push()` now builds each upsert row from
  a per-table column whitelist plus the server-bound `user_id` instead of
  spreading arbitrary client fields, and a new migration adds a server-side
  `BEFORE INSERT/UPDATE` trigger (`kilo.set_updated_at`) that forces
  `updated_at = now()` so a forged or future-dated client timestamp can no longer
  win a sync conflict. Pull/bootstrap behavior unchanged; migration must be
  applied to the remote Supabase project.

## 0.77.12 - 2026-06-22

- Issue #346: Added proactive dependency automation. New `.github/dependabot.yml`
  schedules weekly npm version checks for the repo root and `mobile/`, grouping
  compatible minor/patch updates while keeping security updates as separate PRs.
  Extended `.github/workflows/audit.yml` with a weekly schedule (alongside the
  existing push/PR triggers), preserving the high-severity blocking gate. Added
  `.github/workflows/dependabot-automerge.yml`, a least-privilege workflow that
  enables GitHub auto-merge for Dependabot SemVer-patch PRs limited to dependency
  manifests/lockfiles, gated behind required checks (no unconditional merge).
  Updated the dependency-audit documentation. Auto-merge requires maintainer-side
  repo settings (Allow auto-merge, branch protection with the audit check,
  Dependabot alerts).

## 0.77.11 - 2026-06-22

- Issue #345: Refreshed the mobile lockfile's transitive `undici` resolution
  from 6.26.0 to 6.27.0 so the high-severity dependency audit gate passes
  without upgrading Expo or changing declared dependencies.

## 0.77.10 - 2026-06-22

- Issue #343: Split `mobile/storage/cloudAdapter.js` into focused cloud
  bootstrap, transport, sync, domain-method, and error modules under
  `mobile/storage/cloud/` while preserving the existing public exports and
  behavior. Updated the repo-structure documentation for the new module folder.

## 0.77.9 - 2026-06-22

- Issue #342: Split `mobile/storage/entries.js` into focused local-persistence,
  settings, backup/import, migration, and storage-mode domain modules under
  `mobile/storage/entries/` while preserving the existing public exports and
  behavior. Updated the repo-structure documentation for the new module folder.

## 0.77.8 - 2026-06-22

- Issue #341: Split `mobile/lib/parser.js` into focused parser, session,
  analytics, exercise-name, and deload domain modules under
  `mobile/lib/parser/` while preserving the existing public exports and
  behavior. Updated the repo-structure documentation for the new module folder.

## 0.77.7 - 2026-06-22

- Issue #340: Split the shared `mobile/lib/data.js` implementation into focused
  domain modules under `mobile/lib/data/` while preserving the existing public
  exports and behavior. Updated the parser to import the exercise catalog
  directly, removing the parser/data-barrel dependency cycle.

## 0.77.6 - 2026-06-22

- Issue #338: Extracted Analytics screen derivation and grouping helpers into
  `mobile/screens/analytics/` while preserving weight trends, routine status,
  fatigue, 1K progress, progressive-overload grouping, search, collapse, and
  edit-check-in behavior. Updated the repo-structure documentation for the new
  local helper folder.

## 0.77.5 - 2026-06-22

- Issue #337: Extracted Home dashboard data derivation and goal sanitization
  into `mobile/screens/home/` while preserving existing values, loading and
  empty-state behavior, layout, navigation, and styling. Updated the
  repo-structure documentation for the new local helper folder.

## 0.77.4 - 2026-06-22

- Issue #336: Extracted the More screen account, cloud sync recovery, account
  lifecycle, and legal-link panels into `mobile/screens/more/` while preserving
  existing UI, behavior, routing, and compatibility exports. Updated the
  repo-structure documentation for the new local module folder.

## 0.77.3 - 2026-06-17

- Issue #344: Refreshed the mobile lockfile's high-severity audit paths for
  `@babel/core`, `form-data`, `hasown`, and `ws` so the mobile
  `npm audit --audit-level=high` gate passes without taking the breaking
  Expo/Jest upgrade path required for the remaining moderate-only advisories.

## 0.77.2 - 2026-06-17

- Issue #335: Refactored the Log screen controller logic into local
  `mobile/screens/log/` hooks for current-routine editing, non-current routine
  editing, and deload editing while preserving the existing Log UI and
  behavior. Updated the repo-structure documentation for the new local module
  folder.

## 0.77.1 - 2026-06-17

- Issue #332 (Phase 6 follow-up): Replaced the placeholder Privacy Policy and
  Terms of Service URLs with the published GitHub Pages policy documents on the
  auth/signup, Account lifecycle, and More > About surfaces. The backend
  activation runbook now records published privacy/terms documents as an
  open-signup gate.

## 0.77.0 - 2026-06-17

- Issue #331 (Phase 6 follow-up): Surfaced GitHub OAuth sign-in on the web build
  alongside email/password. The Account screen renders a "Continue with GitHub"
  action only on web and only when cloud accounts are configured, passes an
  explicit `redirectTo` of the web origin for a deterministic callback, and
  reuses the existing web auth-callback handler to complete the round-trip.
  Native OAuth is intentionally out of scope for Phase 6 (the button does not
  render on native). The backend activation runbook documents the GitHub OAuth
  App and dashboard setup as a web-only open-signup gate.

## 0.76.1 - 2026-06-16

- Issue #329 (Phase 5 / Task 14 follow-up): Documented the production Supabase
  Auth abuse posture gate before open signup. The backend activation runbook now
  requires CAPTCHA dashboard configuration plus frontend CAPTCHA token
  integration for public auth forms, requires production-owned SMTP before public
  email signup/password recovery, and defines release verification and
  closed-beta deferral wording for both checks. The QA checklist now points
  release reviewers to that runbook step.

## 0.76.0 - 2026-06-16

- Issue #328 (Phase 5 / Task 14 follow-up): Added app-owned abuse controls to
  the account lifecycle Edge Functions. `account-export` now limits successful
  exports to one per signed-in user per 10 minutes by default, and
  `account-delete` limits delete attempts to three per signed-in user per hour;
  both functions also apply an IP bucket and return HTTP 429 throttled
  responses without exposing cross-account state. Rate-limit verification is
  documented as manual Edge Function QA while requester-isolation remains
  covered by the existing pgTAP suite.

## 0.75.0 - 2026-06-16

- Issue #330 (Phase 5 / Task 14 follow-up): Added placeholder Privacy Policy
  and Terms of Service links to the public-account launch surfaces without
  adding production legal claims: beside the signed-out Account signup action,
  near signed-in Account export/delete actions, and in More > About Kilo.
  Existing account lifecycle export/delete behavior is unchanged.

## 0.74.0 - 2026-06-16

- Issue #322 (Phase 5 / Task 13): Added requester-only account export and
  account deletion. Signed-in users can export all app-owned cloud rows through
  the server-owned `account-export` Edge Function in a v3-compatible JSON
  shape, and can delete their account through `account-delete`, which deletes
  app rows under requester-scoped RLS before using the server-side auth admin
  path to remove the auth user. The mobile Account screen now exposes account
  data export and two-step destructive deletion, clears local session state
  after successful deletion, and never sends a service-role key to the client.
  Live Supabase verification confirmed 26/26 requester-isolation checks.

## 0.73.0 - 2026-06-16

- Issue #321 (Phase 4 / Task 12): Added cloud export parity and sync recovery
  UX. The signed-in Account screen now has a Cloud Sync panel showing per-phase
  bootstrap/sync status (idle/running/failed/complete), with Run Bootstrap / Run
  Sync actions that drive the real operations through a non-destructive recovery
  store (`mobile/storage/syncRecovery.js`) and failure-only retry that re-invokes
  the same bound runner — bootstrap binds to `cloudAdapter.bootstrapFromLocal`,
  sync to the adapter's `sync()` engine. Added `buildCloudExport()`: the v3
  backup payload plus a namespaced `cloud` block (profile, feature toggles,
  tracked lifts, ui_state, current deload note, and the non-sensitive signed-in
  account identity), importable by existing v3 importers and never carrying
  secrets/tokens. No admin/support controls are exposed.

## 0.72.0 - 2026-06-16

- Issue #320 (Phase 4 / Task 11): Implemented last-write-wins offline sync for
  weight entries and workout notes behind the cloud storage adapter. A
  transport-agnostic engine (`mobile/storage/syncQueue.js`) owns sync metadata
  (`client_id`, monotonic `updated_at`, `deleted_at`), persisted per-table dirty
  queues and pull cursors, deterministic LWW resolution, tombstone-first deletes,
  and derived-JSON recompute from canonical `raw_text`. Cloud-mode reads/writes
  (including the deload-derived workout note path) route through the adapter so
  offline create/edit/delete stamp and enqueue and reconcile on reconnect; the
  pull cursor is inclusive so exact-timestamp ties converge; real pushes stamp
  `user_id` to satisfy the `kilo` schema RLS and `(user_id,id)` conflict target.
  Bootstrap and sync now coexist on the adapter; other cloud domains still throw
  `CloudNotImplementedError`. Still gated behind cloud mode and not yet surfaced
  in the UI (Task 12).

## 0.71.0 - 2026-06-15

- Issue #319 (Phase 4 / Task 10): Implemented a user-initiated, one-way cloud
  bootstrap on the storage cloud adapter (`bootstrapFromLocal`). It reads every
  mapped AsyncStorage key through read-only local accessors and writes them to
  the note-first `kilo` schema with one idempotent, PK-keyed upsert per table,
  so re-running for the same user updates rather than duplicates rows. Legacy
  `kilo_workout_sessions` is synthesized into note-first `workout_notes`
  (`raw_text` + original array retained in `source_snapshot`), never normalized
  per-set tables, and legacy `kilo_workout_note` is tagged via `source_snapshot`.
  Local AsyncStorage is never mutated, so a failed bootstrap leaves local state
  intact and is retryable. Continuous sync and a user-facing trigger remain
  Phase 4 Tasks 11–12; other cloud domain methods still throw
  `CloudNotImplementedError`.

## 0.70.1 - 2026-06-15

- Issue #327: Added `docs/backend-activation.md`, the operator runbook for
  activating Kilo's Supabase backend (apply migration → expose `kilo` → set
  client env → verify) with revert/safety notes and the exact env var names.
- Docs: Updated `docs/current-state.md` to reflect that the `kilo` schema has
  been applied to and exposed in the shared Supabase project, with the app
  entering cloud-aware mode only when `EXPO_PUBLIC_SUPABASE_*` env is configured
  (otherwise local-only). No local data is moved to the cloud yet (Phase 4).

## 0.70.0 - 2026-06-15

- Issue #316: Added the note-first Supabase schema and RLS foundation in a
  dedicated `kilo` schema (the project is shared with another app), with seven
  owner-scoped tables, indexes, RLS enabled on every table, owner-only
  select/insert/update/delete policies, and explicit schema/table grants for
  `authenticated` and `service_role` (never `anon`). Per-user isolation was
  verified against real `auth.uid()` via a transaction-rollback dry run.
- Issue #317: Added the Supabase auth/session client behind the app shell —
  email/password, password reset, OAuth callback handling, and secure native
  session storage (`expo-secure-store`, no token material in plain
  AsyncStorage) with web localStorage — plus a minimal Account surface in More.
  Signed-out users keep using local data with no account; the app stays
  local-only when Supabase env config is absent.
- Issue #318: Introduced the storage-seam cloud adapter behind
  `mobile/storage/entries.js` with local-only mode as the default, an explicit
  local adapter surface, a cloud adapter shell (no bootstrap/sync yet), and a
  test that fails if `mobile/screens/**` imports Supabase directly. The #317 and
  #318 Supabase client modules were reconciled into one auth-aware client during
  integration.
- Issue #326: Added `docs/backend-schema.md` documenting Kilo's single-schema
  tenancy, single-schema rationale, source-of-truth rule, naming conventions,
  grants/isolation posture, and operational notes.

## 0.69.1 - 2026-06-15

- Issue #315: Added the repeatable web export smoke verification path. Root and
  mobile scripts now export, serve, and run a served-entrypoint pre-flight for
  the static web build, while `docs/testing-and-qa.md` defines the required
  browser local-data boot pass that verifies mount, save, reload, and
  persistence.

## 0.69.0 - 2026-06-15

- Issue #314: Made the local-data app usable on desktop web without changing
  parser or storage behavior. Added a web-only Home back affordance for
  non-Home tabs, centered wide web content, kept native Android back/date
  behavior intact, and added DOM date-input fallbacks for Weight date edits and
  linked Log deload-date edits.

## 0.68.15 - 2026-06-15

- Issue #313: Enabled Expo web static export by configuring the mobile Expo
  web target for Metro bundling and single-output export. `npx expo export
  --platform web` now emits a static web build without changing native Android
  behavior or adding a new runtime dependency.

## 0.68.14 - 2026-06-15

- Issue #311: Added focused storage-seam regression coverage for the
  note-first Log workflow, pinning raw workout note saves, existing-note edits
  through the upsert path, sibling-note preservation, and parser-derived display
  state from persisted raw text before backend sync work lands.
- Issue #312: Added focused Weight correction coverage for value/note/date
  edits, invalid future or malformed date rejection, storage refresh ordering
  after deletes, and date-enabled edit submission through the existing
  `update` seam. Runtime behavior is unchanged.
- Issue #325: Updated the repo README with a clear `Tech Stack` section
  covering the active Expo/React Native app, JavaScript modules,
  AsyncStorage-backed local persistence, Jest tests, EAS Build, and the current
  absence of backend/Supabase wiring.

## 0.68.13 - 2026-06-14

- Issue #310: Added focused native app-shell regression coverage for initial
  tab visibility, switching across the five-tab `mobile/App.js` shell, and
  Android hardware-back behavior from Home and non-Home tabs. Added only
  `testID` seams to the tab content containers; shipped runtime behavior is
  unchanged.
- Issue #309: Added `docs/backend-roadmap.md` as the build-ready roadmap for
  moving Kilo from local-only personal use to a public web-first self-serve
  product on Supabase. The roadmap preserves the shipped note-first workout
  model, maps every current AsyncStorage key to a cloud target, defines RLS and
  last-write-wins sync expectations, covers account export/deletion plus
  privacy/abuse obligations, names the Expo web static-export path, and spun out
  the ordered `backend-v1` follow-up issue series #310-#324 with tight per-card
  scope, allowed-file, verification, and stop-condition contracts.

## 0.68.12 - 2026-06-14

- Issue #308: Captured the phone-connectivity troubleshooting chain in
  `docs/phone-runbook.md` so it is not re-derived. Documented that
  `expo start --tunnel` no longer works on the free ngrok plan (it requests a
  random `*.ngrok.app` domain free accounts cannot bind → `ERR_NGROK_316`, a
  server-side policy change absent from the ngrok/Expo changelogs), and replaced
  the preferred flow with self-run `ngrok http 8081` on the account's reserved
  static domain plus `EXPO_PACKAGER_PROXY_URL` so Metro advertises the public
  tunnel URL instead of baking in `:8081` (which otherwise breaks JS bundle
  loading). Also added symptom-indexed entries for the WSL `netsh portproxy`
  fallback gotchas (`iphlpsvc`, IPv6-only `[::1]:8081`, WSL-IP churn), the
  QR-encodes-WSL-IP case, and the benign `@react-native-community/datetimepicker`
  update notice (do not "fix" via `expo install --fix`).

## 0.68.11 - 2026-06-12

- Issue #307: Fixed the cold-launch Home flicker where the Welcome card (and a
  zero-valued dashboard) briefly flashed before data loaded. Home now gates its
  first paint on all of its data sources — weight entries, workout notes, weight
  goal, and tracked lifts — rendering nothing for the content region until they
  resolve, then showing the dashboard (or the Welcome card only for a genuinely
  empty first-run user). No more empty-state flash on launch.

## 0.68.10 - 2026-06-11

- Issue #306: Taught `scripts/sync-version.mjs` to also keep
  `mobile/package-lock.json`'s self-version (`.version` and
  `.packages[""].version`) aligned with the canonical root version, in both
  write and `--check` modes, and reconciled the pre-existing lockfile drift.
  The lockfile is updated via a JSON round-trip (byte-identical apart from the
  self-version fields), so version bumps no longer leave the mobile lockfile
  trailing behind `package.json`/`app.json`.

## 0.68.9 - 2026-06-11

- Issue #305: Fixed the failing Dependency Audit CI job by resolving the
  critical `shell-quote` advisory (GHSA-w7jw-789q-3m8p) in the mobile
  lockfile via `npm audit fix` (no `--force`), bumping `shell-quote`
  `1.8.3 → 1.8.4`. `mobile/` `npm audit --audit-level=high` now exits clean;
  `package.json` deps and `expo` remain in-range. The remaining moderate
  advisories require an `expo@56` breaking upgrade and are deferred.

## 0.68.8 - 2026-06-11

- Issue #304: Fixed the Log editor header so a long routine/note title no
  longer pushes the `Undo` and `Done` actions off screen. In `ScreenShell`,
  string titles now truncate to a single line (`numberOfLines={1}`,
  `ellipsizeMode="tail"`) inside a shrinkable title group, keeping the header
  actions fully visible and tappable regardless of title length while leaving
  short titles and custom-node titles unchanged.

## 0.68.7 - 2026-06-11

- Issue #303: Fixed three low-severity mobile defects surfaced by the #287
  audit — imperial profile height can now be fully cleared without snapping
  back to `0 ft` while single-field edits (e.g. clearing inches on `5 ft 10
  in`) preserve the sibling value, the fatigue multiplier stepper increment is
  now capped at `2.0` to mirror its existing floor, and a dead `InputStyle`
  import was removed from `BackupScreen.js`.

## 0.68.6 - 2026-06-11

- Issue #302: Reduced avoidable root-level mobile re-renders during active
  scrolling by replacing per-tick App scroll state churn with a localized
  TabBar listener path, preserving the approved fade behavior while narrowing
  the work triggered by scroll interactions.

## 0.68.5 - 2026-06-11

- Issue #301: Added a first-run Home welcome card that appears only when the
  user has no meaningful dashboard data yet, guides them into the `Log
  Workout` and `Log Weight` flows, and tightened the Home card spacing around
  a shared 24px padding baseline without flattening the existing hierarchy.

## 0.68.4 - 2026-06-11

- Issue #300: Aligned non-SVG mobile accent-color usage with shared theme
  tokens by routing the Home 1K progress interpolation through `Colors.accent`
  and `Colors.success`, centralizing the session check-in modal's rough-state
  button colors in `mobile/theme/colors.js`, and leaving the intentional
  `#FF5C00` SVG brand fills unchanged.

## 0.68.3 - 2026-06-11

- Issue #299: Hardened the Home and Weight goal UI for overdue targets so
  expired goals no longer show negative weeks-left text or invalid pace math.
  The Home goal card now renders a stable `Goal ended` state, and the Weight
  guidance card now suppresses the misleading future-date prompt for both past
  and same-day `weeks_remaining <= 0` goals while the mobile tests pin those
  overdue-state regressions.

## 0.68.2 - 2026-06-11

- Issue #298: Fixed new weight-entry saves to keep the user's local calendar
  date instead of drifting to the next UTC day during late-evening logs, and
  added regression coverage for both the UTC-rollover case and the fallback
  path when the parsed entry does not provide `logged_at`.

## 0.68.1 - 2026-06-08

- Issue #296: Refactored the oversized mobile screen files (`LogScreen`,
  `AnalyticsScreen`, `MoreScreen`, `WeightScreen`) into smaller screen-local
  components, hooks, and pure helpers without changing shipped behavior, and
  caught/fixed six behavior regressions introduced during extraction: the
  weight goal editor live preview, the A/B-week active-card text style, the
  past-deload unparsed-row red styling, a crashing phantom Track toggle on the
  read-only routine viewer, the stubbed-out double-tap-to-edit on saved
  routines and past deload records, and the active routine card auto-collapsing
  after exiting the editor. Added focused render/behavior coverage pinning the
  per-mode rendering, the header-collapse vs body-edit split, and the restored
  double-tap-to-edit.

## 0.68.0 - 2026-06-08

- Issue #295: Added alternating A/B week support to Log routines via a `---`
  week separator plus a persisted manual week toggle, made A/B edit mode work
  against the active week's raw text while keeping one shared routine note, and
  added current-routine switch rollover for matching 1K slot selections while
  documenting that PO/tracked-lift continuity already persists globally by
  exercise name.

## 0.67.7 - 2026-06-07

- Issue #294: Fixed the Log-tab truncation regression introduced by the More
  sub-page sticky-header refactor by restoring `ScreenShell`'s root style
  contract, so hiding the inactive Log shell now removes it from layout
  entirely, and added focused regression coverage for that shell contract.

## 0.67.6 - 2026-06-07

- Issue #292: Moved More-subpage back navigation into a persistent shared
  header path so `User Profile`, `Data & Backup`, `Settings`, `App Guide`, and
  `About` keep an always-available Back control while their content scrolls.

## 0.67.5 - 2026-06-07

- Issue #293: Standardized the main mobile text-input treatment across Weight,
  More, Analytics, and the session check-in modal, aligned the modal primary
  action button with the shared primary-button sizing, and replaced touched
  hardcoded white text with the shared warm `Colors.textLight` token.

## 0.67.4 - 2026-06-07

- Issue #290: Added a visible per-note `Undo` escape hatch to Log editing so
  current routines, saved routines, and editable past deload notes can revert
  to the state they had when the user entered edit mode, aligned the Log editor
  placeholder with the canonical App Guide workout syntax, and added rendered
  regression coverage for guide/placeholder alignment plus the main Undo flows.

## 0.67.3 - 2026-06-07

- Issue #289: Made Weight history delta highlighting respect the active goal
  direction so intentional loss/gain movement no longer gets warning colors,
  kept opposite-direction swings highlighted, and locked the Analytics parent
  section title to a static `Fatigue` label while adding regression coverage
  for both behaviors.

## 0.67.2 - 2026-06-07

- Issue #288: Fixed the native mobile date pickers to use the correct
  `DateTimePicker` `onChange` callback in Weight, Log, and More so date
  selection now updates correctly on physical devices, and added regression
  coverage for the Weight and Log picker wiring.

## 0.67.1 - 2026-06-07

- Issue #286: Reframed the More tab around the current shipped baseline by
  promoting `App Guide` to the top of the menu, flattening the menu into a
  five-item list, rewriting the in-app guide around the real five-tab app
  structure and workout-note syntax, and regrouping `Settings & Algorithm`
  into clearer `Features`, `Date Editing`, and `Advanced` sections.

## 0.67.0 - 2026-06-07

- Issue #283: Simplified Analytics routine status to a session-only `Routine
  Health` gauge, merged the routine-status and fatigue surfaces under one
  parent section, kept `Deload mode` focused on hiding only the `Since deload`
  stat, added editable deload `Session #` support on linked past-deload
  records, and updated the current-state docs to match the shipped contract.

## 0.66.0 - 2026-06-07

- Issue #284: Anchored Analytics deload session counts to routine session
  position instead of deload dates. Completing a deload now prompts for an
  editable session ordinal prefilled from the current note, persists it on the
  deload history record, and keeps dates as display/calendar metadata for
  titles and `weeks since deload` only. Legacy records continue to use their
  stored `session_count`, and regression tests now pin that date edits and
  check-in chronology cannot move `sessions since deload`.

## 0.65.3 - 2026-06-06

- Issue #282: Fixed the Analytics deload-cycle derivation so `sessions since
  deload` now recomputes from dated workout chronology when that history
  exists, making past deload date edits move both deload-relative metrics
  together instead of leaving the session count frozen. Analytics also now
  counts archived deload sessions in `sessions logged`, exposes `weeks on
  routine` as elapsed calendar weeks since the routine start, and explicitly
  defers the removed `active weeks` metric to follow-up issue #284.

## 0.65.2 - 2026-06-06

- Issue #280: Fixed a Log deload-record save race that could leave the editor
  appearing stuck in `Saving...` after changing the date on an existing past
  deload while an autosave was already in flight. The non-current note editor
  now reuses the active save promise during the explicit `Done` flush, exits
  cleanly when that save succeeds, and the `log-screen` test suite now pins
  that in-flight deload-save contract.

## 0.65.1 - 2026-06-06

- Issue #279: Removed the visible autosave `Saved!` flicker from the Log note
  editor. Debounced autosaves for existing current and non-current routines now
  stay silent on success while explicit user-triggered saves still surface the
  existing confirmation, save failures remain visible, and the `log-screen`
  test suite now pins that autosave-vs-explicit-save contract at the real save
  call sites.

## 0.65.0 - 2026-06-06

- Issue #278: Reframed `Session Health` into two explicit deload metrics.
  Analytics now keeps `sessions since deload` as the session-based gauge while
  adding a separate calendar-based `weeks since deload` value, and past deload
  date edits now sync the linked workout note and deload-history record
  together without redefining skipped sessions or introducing the abandoned
  manual-repair/session-date model. Legacy note-backed deloads without a
  linked history row now keep their date field read-only so note dates cannot
  silently drift away from the analytics anchor.

## 0.64.4 - 2026-06-06

- Issue #277: Aligned the fatigue QA docs and roadmap status with shipped
  reality. `docs/testing-and-qa.md` now documents the real fatigue verification
  surface — `deriveSessionCheckIn` detector coverage, `deriveCheckInHistory`
  list/summary shaping, within-row skipped-set parser coverage,
  `session_checkins` storage round-trip, and the post-ship `AnalyticsScreen`
  Fatigue-section interaction coverage — and drops the stale
  `getLatestRepDropOff` test bullet. `docs/mvp-fatigue-roadmap.md` marks Phase 2
  and Tasks 7/8 complete, records the `#272`/`#274`/`#275` post-ship follow-ups,
  splits Phase 3 Task 9 into 9A (#276) and 9B (#277), and notes the remaining
  work is reviewer closeout only.

## 0.64.3 - 2026-06-06

- Issue #276: Updated the fatigue product docs to match the shipped session
  check-in feature. `docs/architecture.md` now documents the detection →
  response → consumer flow (`deriveSessionCheckIn`, `SessionCheckInModal`
  persisting `session_checkins` with answer-time `responded_at`, and the
  `deriveCheckInHistory` Analytics consumer) and `docs/repo-structure.md` now
  lists `mobile/components/SessionCheckInModal.js`. `docs/current-state.md` was
  reviewed and already accurate.

## 0.64.2 - 2026-06-06

- Issue #275: Added targeted `AnalyticsScreen` fatigue interaction coverage so
  the native test suite now locks the card's collapsed default state,
  expand-then-collapse toggle behavior, rough-row and ok/pending-chip edit
  affordances, and the unanswered-check-in badge.

## 0.64.1 - 2026-06-06

- Issue #274: Fixed skipped-session placeholder rendering in workout-note clean
  views. Skip markers (`—`) now render consistently across all clean views
  (current routine, expanded more-routines notes, deload notes). Bare rows that
  fail to parse (e.g. an incomplete weight entry with no reps) now render in
  their chronological position between skip groups rather than drifting to the
  bottom of the exercise block.

## 0.64.0 - 2026-06-05

- Issue #272: Refined the Analytics `Fatigue` card into a calmer collapsible
  summary with a most-common-reason insight, pending-check-in alert badge, and
  expanded detail groups that keep rough entries as callout rows while
  rendering ok/pending history as compact date chips. The existing Analytics
  edit path for each fatigue entry remains intact.

## 0.63.0 - 2026-06-05

- Issue #273: Added persisted `Fatigue tracking` and `Deload mode` settings
  under More > Settings so those workout-side optional flows can be turned off
  cleanly without deleting stored data. When disabled, the app now hides
  fatigue prompts plus Analytics fatigue surfaces, and separately hides
  deload-specific Log and Analytics UI while restoring the existing data if the
  feature is turned back on later.

## 0.62.0 - 2026-06-05

- Issue #271: Added an Analytics-side edit path for fatigue check-ins so
  unanswered entries can be completed later and existing responses can be
  reopened without losing their saved status, reasons, note text, or original
  session date. The Fatigue card now restores a `Most common` rough-session
  reason insight, surfaces flagged exercise names per row, and preserves
  reverse-chronological ordering when historical check-ins are edited.

## 0.61.0 - 2026-06-05

- Issue #270: Fixed the Log-tab fatigue check-in trigger so rough-session
  detection runs against the current routine instead of all workout notes,
  restoring prompts for the single-exercise repro cases (`110 2,2,2`,
  `110 2,2,-`, and whole-session skip). The fatigue modal now uses the widened
  centered-dialog UX with pending/unanswered dismissal state, and Analytics now
  splits fatigue history into `Not great`, `All good`, and `Unanswered`
  sections backed by the expanded `deriveCheckInHistory()` shape.

## 0.60.0 - 2026-06-04

- Issue #269: Added a `Fatigue` section to Analytics backed by
  `deriveCheckInHistory(notes)`, including a reverse-chronological dated list
  of answered session check-ins, rough-session summary counts, top-reason
  labeling, empty-state handling, and stable date formatting that preserves
  the stored calendar day from `responded_at`.

## 0.59.0 - 2026-06-04

- Issue #268: Completed the Log-tab fatigue check-in flow with a contextual
  bottom-sheet modal that opens after a rough detected session, titles the
  prompt from the firing detectors plus flagged exercise names where available,
  captures either `I'm okay` or `Not great` responses with the defined reason
  vocabulary, persists the answer into `session_checkins`, and suppresses
  future prompts/highlights for that answered session index.

## 0.58.0 - 2026-06-04

- Issue #267: Added the first visible fatigue check-in cue on the Log tab.
  Leaving the current routine editor after a rough detected session now runs
  the session check-in detector after autosave, highlights exactly the flagged
  exercises in red in the rendered routine view, and suppresses the highlight
  once that session index has already been answered. The Log screen also now
  exposes a gated `onCheckInPrompt` hook so the Task #268 modal can open
  without changing the detection contract.

## 0.57.2 - 2026-06-04

- Issue #266: Removed the last legacy rep-drop-off UI plumbing from the native
  app by deleting the Log `hit a wall` nudge chip, the Analytics `⚠ Hit wall`
  badge, their dead helper functions, and the obsolete `getLatestRepDropOff`
  test coverage. Structured Log read mode now renders within-row skipped sets
  with their original weight and a `-` rep token (`80 4,-` → `80 lb 4, -`).

## 0.57.1 - 2026-06-04

- Issue #265: Added `deriveCheckInHistory(notes)` so persisted workout-note
  `session_checkins` now shape into the reverse-chronological list and rough-
  check-in summary contract required by the upcoming Analytics fatigue section,
  with null-safe handling for notes that do not carry stored check-ins.

## 0.57.0 - 2026-06-04

- Issue #264: Persisted workout-note `session_checkins` entries keyed by
  session index, added round-trip and legacy-load coverage for that field, and
  stopped populating the old `rep_drop_off_flags` surface so the legacy Log and
  Analytics rep-drop-off chip/badge stay dark pending the Phase 2 UI cleanup.

## 0.56.2 - 2026-06-04

- Issue #263: Added the `deriveSessionCheckIn(sections, trackedNames)` data-layer
  detector for rough latest sessions, combining skip-rate, whole-day-skip,
  rep-collapse, and intra-session collapse signals into a single pure result
  shape for the upcoming fatigue/session-check-in flow.

## 0.56.1 - 2026-06-04

- Issue #262: Fixed weighted workout-row parsing so within-row skipped-set
  tokens like `80 4,-`, `80 -,8`, and mixed weighted groups no longer degrade
  into `unparsed_rows`. The parser now preserves the set weight, records the
  skipped set as `rep_count: 0` with an optional `skipped: true` flag, and
  keeps bare whole-line `-` behavior unchanged.

## 0.56.0 - 2026-06-04

- Issue #261: Added safe debounced autosave for existing workout-note raw
  editing with `Done` flushes, stale-result guards against in-flight overwrite
  races, and the removal of manual save-button dependence for existing notes
  while preserving explicit first-save behavior for brand-new routines. The
  Log tab now keeps non-current routines and note-backed past deloads expanded
  inline in place instead of jumping into a separate reader, fixes collapse
  scroll jumps and inline action clipping, switches displayed Log/deload dates
  to local-midnight parsing to prevent UTC off-by-one regressions, and adds an
  opt-in `Edit deload dates` setting so past deload records can change their
  saved date without breaking deload classification.

## 0.55.0 - 2026-06-04

- Issue #260: Changed `More Routines` note-open behavior on the Log tab so
  non-current routines now open into a rendered read view first instead of
  jumping straight into raw text edit, matching the current routine's explicit
  `Edit` control and double-tap-to-edit interaction model. Also fixed Android
  hardware Back so it dismisses that intermediate read view before leaving the
  screen.

## 0.54.2 - 2026-06-03

- Issue #259: Polished the Analytics `Session Health` card presentation by
  reworking the deload/total stat layout, updating the shipped gauge caption
  copy, and aligning the targeted Analytics screen test with that copy without
  changing session-health calculations, thresholds, or gauge behavior.

## 0.54.1 - 2026-06-03

- Issue #258: Stopped preview OTA compatibility from breaking on every app
  version bump by moving Expo runtime selection into `mobile/app.config.js`,
  pinning preview builds/updates to a stable manual `PREVIEW_RUNTIME`, keeping
  production on the stricter `appVersion` policy, wiring the preview EAS
  profiles and OTA scripts to the preview runtime env, and updating the phone
  runbook/current-state/testing docs to document the one-time rebuild and the
  new manual runtime-bump rule.

## 0.54.0 - 2026-06-03

- Issue #257: Gave completed deloads full editor parity with saved routines by
  dual-writing new completions into the workout-notes store as `Deload ·
  YYYY-MM-DD` notes while keeping `kilo_workout_deload_history` authoritative
  for the Session Health gauge. The Log Deload tab now opens note-backed past
  deloads in the full-screen routine editor, filters those deload notes out of
  `More Routines`, deletes note-backed deloads from both stores together, and
  preserves pre-#257 history visibility by rendering legacy history-only
  deloads inline as read-only expandable cards until they have note twins.

## 0.53.0 - 2026-06-03

- Issue #256: Surfaced deload completion and the sessions-since-deload clock in
  the UI. The Session Health gauge now runs its zones, marker, and caption off
  sessions-since-last-deload while showing the absolute total as a secondary
  stat. The Log Deload tab gains a `Deload complete` action (confirm dialog that
  archives + clears the active note via `completeDeload`) and a collapsible
  `Past deloads` list of archived records with per-record delete behind a
  confirm; delete is backed by a new `deleteDeloadHistory(id)` storage helper and
  `deleteDeload(id)` on `useDeloadHistory`, and the gauge recomputes off the
  remaining history (resetting to the absolute session count when none remain).
  Shared `Button` gained horizontal padding so long labels no longer crowd the
  rounded edges. The out-of-scope past-deload full-editor experiment was reverted
  and split into #257.

## 0.52.5 - 2026-06-03

- Issue #255: Added the deload-completion data layer. New `kilo_workout_deload_history`
  store with `loadDeloadHistory`/`appendDeloadHistory`, a `useDeloadHistory` hook whose
  `completeDeload({ sessionCount })` archives the active deload note (capturing the
  session count at completion) and clears it, and a `sessionsSinceLastDeload` selector
  that runs the deload clock off the latest completed deload while leaving the absolute
  session count intact. Backup format bumped to v3 to export/restore the deload history;
  v1/v2 backups remain supported. UI wiring is tracked in #256.

## 0.52.4 - 2026-06-03

- Issue #63: Enabled iOS preview OTA delivery by binding the `ios-simulator` and
  `ios-device` EAS build profiles to the `preview` channel and adding
  `build:ios:simulator`, `build:ios:device`, and `update:ios:preview` scripts.
  The shared `app.json` `updates` block and `runtimeVersion.policy: "appVersion"`
  are reused unchanged. Live on-device iOS delivery is deferred pending an iOS
  build; config validity was verified by asserting all EAS profiles declare a
  channel.

## 0.52.3 - 2026-06-03

- Issue #254: Restored unsigned Android preview OTA updates by adding a plain
  `update:android:preview` EAS Update script, documenting the build-vs-update
  workflow and native rebuild boundary for preview installs, and removing the
  remaining signed-OTA assumptions from the repo's living docs.

## 0.52.2 - 2026-06-03

- Issue #252: Fixed parser session-slot preservation for workout notes that mix
  bare logged rows with bare `-` skip markers so the Log formatted read view
  keeps skipped weeks interleaved in their original order, and restored session
  counting for non-weight histories by deriving counts from non-skipped
  `session_entries` when `rows` are absent.

## 0.52.1 - 2026-06-03

- Issue #250: Fixed the Home 1K headline so it behaves as a current-performance
  metric instead of sticking to an earlier per-occurrence PR, and aligned it
  directly to the shared `derive1kTotalSeries()` session-ordinal contract so
  the headline and Analytics chart can no longer disagree or mix PRs from
  different workout cycles.

## 0.52.0 - 2026-06-03

- Issue #249: Expanded Analytics into a more chart-driven surface by splitting
  Weight Trends into distinct 7-day and 30-day rolling-average charts, replacing
  the old Activity session-count card with a Session Health gauge and zone
  captions, and adding a new `1K total over sessions` chart backed by a shared
  per-session Big-3 derivation aligned by session ordinal. Also extended the
  shared line-chart component with tapped-point readouts and expanded native
  Analytics/data coverage around the new chart and alignment contracts.

## 0.51.3 - 2026-06-02

- Issue #248: Reworked the Weight tab's goal presentation into a cleaner
  singular Goal plus separate Guidance treatment, added semantic trend colors
  for pace and rolling-direction cues, and fixed history-row editing so
  selecting an entry scrolls the screen back to the editor instead of leaving
  the loaded form off-screen.

## 0.51.2 - 2026-06-02

- Issue #247: Redesigned the Home tab's information hierarchy without changing
  data sources or navigation. The weekly hero now separates the lift-status
  counts into a labeled `Exercise Progress` section, the goal card now presents
  `Goal: Bulking/Cutting/Maintaining` with semantic success/caution/error color
  still carried by the required pace based on `goalInfo.warnings`, and the 1K
  card now uses a centered `1K Progress` treatment with progress-based emphasis
  on the hero total.

## 0.51.1 - 2026-06-02

- Issue #246: Fixed the compact Home weight sparkline clipping by enforcing
  shared chart insets for edge markers/strokes, and reconciled the Home,
  Weight, and Analytics typography pass by aligning Analytics' latest-weight
  hero tier with Home and raising the remaining undersized 10px Analytics unit
  labels to the 11px readability floor.

## 0.51.0 - 2026-06-01

- Issue #242: Added an opt-in `Edit weigh-in dates` setting under More so
  Weight can expose inline local-day-capped date pickers for both new and
  existing weigh-ins while preserving the stored time-of-day on edits,
  re-sorting history by `logged_at`, and keeping the default logging/edit path
  unchanged when the setting is off.

## 0.50.0 - 2026-06-01

- Issue #91: Added a separate Deload mode to the Log tab with a `Routine |
  Deload` toggle, empty-state generation flow, overwrite confirmation,
  separate deload-note editing/persistence, and routine-style shaping of the
  generated deload source text so the raw editor remains comfortable to use
  while the rendered read view stays parser-compatible.

## 0.49.19 - 2026-05-31

- Issue #90: Added deterministic deload-note generation to the parser layer
  (`parseExerciseHeader` plus `generateDeloadNote`), persisted a separate
  AsyncStorage-backed deload note independent from the canonical routine note,
  exposed the matching `useDeloadNote()` hook, and expanded parser/storage
  coverage for deload generation, round-trip parsing, and note-isolation
  behavior.

## 0.49.18 - 2026-05-31

- Issue #245: Shortened the Expo OTA code-signing certificate validity window
  to 3 years, replaced the checked-in signing cert, and expanded the OTA key
  handling docs with a compromise-response runbook, CI secret storage policy,
  and team-change rotation guidance.

## 0.49.17 - 2026-05-30

- Issue #241: Standardized the routine-set microcopy on the Log tab to one
  consistent `Set as current routine` label across the alert title/action,
  inline chip, and full button; softened the Android exit-confirmation dialog
  to the app's sentence-case voice (`Exit app?` / `Exit`); and removed the dead
  Home `formatGoalDirection` helper so the rendered goal-direction label has a
  single source of truth.

## 0.49.16 - 2026-05-30

- Issue #240: Corrected the Home weight sparkline label from a misleading
  "7-day trend" to the accurate "7-day rolling avg" to match the existing
  rolling-average data series, and documented the intentional `null` goal
  argument on Analytics' shared weight-analytics call without changing
  rendered behavior.

## 0.49.15 - 2026-05-30

- Issue #239: Normalized the shared hero-metric type scale across Home, Weight,
  and Analytics by introducing named `HeroMetric` steps in `mobile/components/UI.js`
  and applying them to the Home latest-weight hero, Home/Analytics 1K totals,
  Analytics latest-weight stat, and Weight goal/trend values. This removes the
  prior ad-hoc `800`/`900` split and keeps the same semantic metric roles on a
  shared size/weight system.

## 0.49.14 - 2026-05-30

- Issue #238: Disambiguated `Colors.accent` so brand/hero/CTA treatments no
  longer double as mild-severity signaling. Moved the Weight history
  `deltaNotable` color, Weight/Analytics pace-notable badge treatment, and the
  Home `Cutting` goal-direction label from `Colors.accent` to the existing
  `Colors.caution` token, leaving the remaining in-scope accent uses as
  brand-facing UI and leaving the intentional `#FF5C00` wordmark untouched.

## 0.49.13 - 2026-05-30

- Issue #237: Reconciled `docs/design-system-map.md` and `docs/current-state.md`
  with the shipped app (doc-drift fixes from the #233 audit). Retargeted the
  Analytics screen section from the renamed `StatsScreen.js` to
  `AnalyticsScreen.js`, removed the stale `#4ade80` hardcoded-color rows (now
  `Colors.success`), dropped the Home `SectionTitle` rows (Home no longer imports
  `SectionTitle`), added the `divider`/`subtleBg`/`panelBackground` color tokens
  (noting `panelBackground == inputBackground`), and finished the Stats→Analytics
  rename throughout. Corrected `current-state.md` to drop the non-existent Home
  deep-link claims (the 1K total and sparkline are non-navigating; the only
  Home→Analytics link is the generic "Full history and insights" CTA).
  Documentation only.

## 0.49.12 - 2026-05-30

- Issue #236: Surfaced AsyncStorage load failures on the Weight and Log tabs
  instead of rendering a silent empty screen. Wired the existing `error` state
  from `useWeightEntries`/`useWorkoutNotes` to a new shared `ErrorBanner`
  (`UI.js`) on `WeightScreen` and the Log read view, each with a Retry action.
  Also fixed both hooks to reset `error` at the start of every `refresh` so a
  successful Retry clears the banner instead of leaving it stuck. Log visual
  styling preserved.

## 0.49.11 - 2026-05-30

- Issue #235: Added `hitSlop` to the three sub-minimum inline controls in the
  Log tab flagged in the #233 a11y audit — the `Edit` and `Set Current`
  `inlineSwitchButton`s and the nudge-dismiss `×` — bringing each effective
  touch target to ≥44px on both axes (`top/bottom: 12` on all three;
  `left/right: 14` on the single-glyph dismiss, `left/right: 8` on the wider
  labels). Touch-area only; no padding, size, or visual change, with the Log
  style lock preserved.

## 0.49.10 - 2026-05-30

- Issue #234: Added `accessibilityRole="button"` and descriptive
  `accessibilityLabel`s to the glyph-only interactive controls flagged in the
  #233 a11y audit — Weight delete `✕`, More menu `→` rows, More fatigue-multiplier
  `−`/`+` steppers, Analytics slot `▲/▼` (with the current value folded into the
  label), and the Log nudge-dismiss `×` — and marked the bare glyph `Text` nodes
  (including the Profile activity-level `✓`) `accessible={false}` so screen
  readers announce the control instead of the raw character. Labels only; no
  visual, layout, or styling change to any screen, with the Log style lock
  preserved.

## 0.49.9 - 2026-05-29

- Issue #231: Standardized the Analytics surface naming across the screen
  file/component, Home navigation key, native test filename, and living docs,
  fixing the Home "Full history and insights" route so the Analytics tab stays
  highlighted after navigation.

## 0.49.8 - 2026-05-29

- Issue #229: Unified the Log tab's untitled-routine fallback label to
  `Untitled Routine` across current-routine save, display, editor-title, and
  delete-confirmation paths so users no longer see mixed default routine names.

## 0.49.7 - 2026-05-29

- Issue #227: Added rendered `WeightScreen` correction-flow coverage for row
  reload, edited-entry validation/update, and delete confirmation/removal, and
  updated `docs/testing-and-qa.md` to remove the corresponding Weight coverage
  gaps from the inventory.

## 0.49.6 - 2026-05-29

- Issue #232: Realigned `mobile/package.json` and `mobile/app.json` to the
  canonical root app version, changed the About version display to `vX.Y.Z`,
  and added a sync script plus CI/closeout guard so future version bumps keep
  the mobile version surfaces aligned.

## 0.49.5 - 2026-05-29

- Issue #225: Moved superseded roadmap docs (`mvp-roadmap.md` through
  `mvp-v4-roadmap.md`) into `docs/archive/`, updated `docs/current-state.md`
  to reflect MVP-Refine as the last completed planning pass with no active
  follow-up, and corrected `docs/repo-structure.md` so the `docs/` inventory
  matches the live repo state.

## 0.49.4 - 2026-05-29

- Issue #224: Removed the dead singular `useWorkoutNote()` hook from
  `mobile/hooks/useEntries.js` and corrected `docs/architecture.md` so it no
  longer documents that unused hook as a live load/migrate path. Preserved the
  storage-layer legacy single-note migration behavior.

## 0.49.3 - 2026-05-29

- Issue #221: Integrated the Analytics workout-session count into the screen
  layout by adding an `Activity` section heading above the existing
  tone-colored `Workout sessions` StatCard. Preserved the shared
  `getSessionTone` thresholds and left session-count computation unchanged.

## 0.49.2 - 2026-05-29

- Issue #220: Replaced `exercises.find` linear scans with keyed `Map` lookups
  in `classifyExerciseSessions`, `deriveRepDropOffFlags`, and
  `deriveNonWeightedTrackedExerciseMetrics`. Pure Big-O cleanup, no behavior
  change.

## 0.49.1 - 2026-05-29

- Issue #219: Migrated screen files to `normalizeExerciseKey`. Replaced all
  manual `normalizeLiftName(canonicalizeName(...))` chains in HomeScreen and
  StatsScreen with the unified `normalizeExerciseKey` helper. Fixed a bug in
  StatsScreen where `canonicalizeName(...).toLowerCase()` was missing whitespace
  collapse, causing potential key mismatches for multi-word exercise names.
  Removed the now-unused `canonicalizeName` public export from parser.js.

## 0.49.0 - 2026-05-29

- Issue #92: Session-count signifier colors on Analytics and Home. The
  workout session count now turns green (1–6), yellow (7–9), or red (≥ 10)
  as a deload-approach cue. Home colors the "Week N" label; Analytics adds
  a "Workout sessions" StatCard with the corresponding tone. Shared
  `getSessionTone` helper in UI.js, `cardWarn` style switched from accent
  orange to caution yellow, both screens use `countWorkoutSessionsFromSections`
  for metric consistency.

## 0.48.0 - 2026-05-29

- Issue #166: Render non-weighted tracked-exercise cards in the Progressive
  Overload section with avg/best metrics, inline labels, and progression
  arrows (↔ steady, ↑/↓ improving/declining, — no trend). Reps-only
  exercises show average and best reps per set; time-based exercises show
  average and best hold duration. Includes `formatDuration` helper for
  time formatting.

## 0.47.0 - 2026-05-28

- Issue #165: Added per-session derivation for non-weighted tracked exercises
  covering reps-only (total_reps + arrow) and time-based (longest_hold + arrow)
  exercise classes, with loaded-bodyweight exclusion routing to the existing
  weighted path.

## 0.46.15 - 2026-05-28

- Issue #200: Switched the Weight save CTA to the primary dark button
  treatment and converted goal Edit/Clear actions from bare text to
  chip-style treatment for visual consistency with the established UI system.

## 0.46.14 - 2026-05-28

- Issue #217: Unified exercise name normalization into a single
  `normalizeExerciseKey` function and migrated all call sites in parser.js
  and data.js, fixing key mismatches for aliased exercises in analytics
  and per-day signal lookups.

## 0.46.13 - 2026-05-28

- Issue #216: Replaced hardcoded `stickyHeaderIndices={[4]}` in StatsScreen
  with a dynamic index calculation so the sticky header stays correct if
  sections are added or reordered.

## 0.46.12 - 2026-05-28

- Issue #215: Wrapped all useEntries pub/sub listener calls in try-catch so
  one failing listener no longer silently drops notifications to subsequent
  listeners.

## 0.46.11 - 2026-05-28

- Issue #214: Added an explicit Edit button to the current routine card
  header on the Log tab so users can enter edit mode without discovering the
  double-tap gesture.

## 0.46.10 - 2026-05-28

- Issue #212: Extracted the per-note `parseWorkoutNote` flatMap from the
  `dashboardData` useMemo into a dedicated memo gated only on `notes`, so
  weight entry and tracked lift changes no longer trigger a full notebook
  reparse on HomeScreen.

## 0.46.9 - 2026-05-28

- Issue #209: Removed stale `KILO_TODAY` references from
  `docs/current-state.md` and marked legacy roadmap files as historical,
  directing readers to `docs/roadmap-mvp-refine.md` as the active roadmap.

## 0.46.8 - 2026-05-28

- Issue #204: Fixed intermittent tab-switch flicker by replacing conditional
  screen rendering with a persistent keep-alive pattern in `App.js`. All main
  screens are now mounted once and visibility is toggled via `display` style,
  eliminating remount cycles during tab navigation.

## 0.46.7 - 2026-05-28

- Issue #213: Archived the frozen browser prototype (`Kilo.html`, `src/`,
  `tests/`) to `docs/archive/browser-prototype/`. Removed the Capacitor Android
  shell (`android/`, `capacitor.config.json`), vitest config, and all
  browser-specific dependencies and scripts from `package.json`. The mobile Expo
  app under `mobile/` is now the only active app path.

## 0.46.6 - 2026-05-28

- Issue #211: Deduplicated progression signal logic by extracting
  `_buildComparable` and `_deriveSignalForComparables` helpers from
  `deriveProgressionSignals` and `derivePerDaySignals`, eliminating ~80 lines
  of near-identical code that previously caused the #207 regression when the
  two copies diverged.

## 0.46.5 - 2026-05-28

- Issue #210: Extracted MoreScreen and its five sub-screens (ProfileScreen,
  BackupScreen, SettingsScreen, HelpScreen, AboutScreen) from HomeScreen.js
  into a dedicated MoreScreen.js file, reducing HomeScreen from 1401 to 420
  lines and eliminating cross-concern coupling between the Home dashboard and
  More tab surfaces.

## 0.46.4 - 2026-05-28

- Issue #208: Fixed vitest config to exclude `mobile/**` by spreading
  `defaultExclude` from `vitest/config` and appending the mobile glob, so the
  root `npm test` no longer picks up mobile Jest test files or drops vitest's
  built-in exclusions.

## 0.46.3 - 2026-05-28

- Issue #207: Fixed the native Analytics Progressive Overload regression by
  restoring visible row-level trend arrows, canonicalizing alias lookups,
  using per-day `latest_pr` / `latest_top_weight` / `overload_trend` values
  for multi-day exercise rows, and treating plain note rows as separate
  comparable sessions so repeated same-note logging no longer stalls at
  `first_session`. Reviewer closeout aligned the Home weekly-summary
  classification band to the live overload-count source of truth and extended
  parser/data/StatsScreen regression coverage for the per-day key contract.

## 0.46.2 - 2026-05-27

- Issue #206: Rounded the native Home weight-goal `weeks left` display to the
  nearest whole number at the `HomeScreen` render site so goal timelines no
  longer expose raw fractional week values.

## 0.46.1 - 2026-05-27

- Issue #205: Fixed the per-day multi-day comparison regression for
  rep-only/bodyweight exercises after the original merge. `derivePerDaySignals`
  now mirrors the global rep-based fallback semantics for day-level analytics,
  carries `is_bodyweight` through the per-day payload, and the Analytics
  `CrossDayComparison` row now renders `reps` instead of hardcoded `lb` for
  bodyweight day chips. Added targeted regression coverage for parser, data,
  and StatsScreen bodyweight multi-day cases.

## 0.46.0 - 2026-05-27

- Issue #205: Implemented per-day signal plumbing for multi-day exercise
  comparison. Added `derivePerDaySignals` to `parser.js` which groups
  occurrences by routine-day heading and computes `latest_top_weight`,
  `latest_pr`, and `overload_trend` independently per day. Threaded
  `perDaySignals` through `deriveWorkoutNoteAnalytics`. Analytics Progressive
  Overload section now renders a `CrossDayComparison` row (`MON 185lb ↑ ·
  FRI 175lb →`) for multi-day exercises instead of the static "Also on X"
  text. Global signal contract from #159 unchanged; single-day exercises
  unaffected.

## 0.45.0 - 2026-05-27

- Issue #198: Redesigned the Analytics Progressive Overload section with
  routine-day grouping, collapsible group headers, search filtering, and a
  tabular two-line row layout (exercise name + 4-column metric grid). Multi-day
  exercises appear in each relevant group with an inline cross-day summary.
  Trend arrows now use MaterialIcons with semantic color mapping. Redesigned
  the 1K Progress card with hero total, progress bar, and full breakdown
  labels (Squats/Bench/Deadlifts) in an artisanal-panel container.
  Standardized color tokens (`Colors.divider`, `Colors.subtleBg`,
  `Colors.panelBackground`) and eliminated hardcoded color leaks within scope.
  Added `ArtisanalPanel` shared component to `UI.js`. Per-day signal
  breakdown for multi-day exercises deferred to #205.

## 0.44.0 - 2026-05-27

- Issue #196: Redesigned the Home dashboard to an approved information
  hierarchy. Weekly Summary is now a unified hero card with inline week label,
  dominant 48px weight value, full-width sparkline strip, and semantic
  classification band. Weight Goal card is conditional and visually subordinate.
  1K Club card is tertiary with centered total and canonical breakdown. Removed
  floating badge, section title labels between cards, hero divider, and
  nonfunctional goal chevron. Restricted orange to the weight value and
  wordmark. Added `Colors.caution` token for steady-state classifications.
  Added `docs/design-system-map.md` cross-screen style audit.

## 0.43.3 - 2026-05-27

- Issue #201: Added a small muted `Double-tap to edit` helper line at the top
  of the current Log routine card so the current-note edit gesture is more
  discoverable without changing the established card treatment.

## 0.43.2 - 2026-05-26

- Issue #203: Fixed the native Home weight sparkline render path so the
  7-day rolling-average chart now mounts inside a measured explicit-height
  container with the redundant in-chart header suppressed, matching the
  working Analytics layout contract and preventing blank charts when weight
  history is present.

## 0.43.1 - 2026-05-26

- Issue #197: Wired the stored weight goal into the native Home dashboard data
  pipeline so `deriveWeightGoalAnalytics()` now returns `goalInfo` there for
  the upcoming dashboard goal-status UI work, without changing current Home
  rendering.

## 0.43.0 - 2026-05-26

- Issue #195: Added a native `User Profile` flow under More so users can
  locally save optional height, date of birth, biological sex, and activity
  level inputs for the TDEE-based calorie model, including unit conversion,
  clear-state controls, and save feedback. Reviewer closeout updated
  `docs/current-state.md` to match and bumped the app version.

## 0.42.3 - 2026-05-26

- Issue #169: Produced Progressive Overload redesign brief merging structural
  organization from #147 (routine-day grouping, collapsible sections, search,
  multi-day handling) with visual treatment from #170 (tabular two-line row
  layout, four-column metric grid, artisanal-panel container). Created
  implementation card #198 for agent:gemini.

## 0.42.2 - 2026-05-26

- Issue #188: Approved Home dashboard information hierarchy — consolidated
  weekly signals (week badge, classifications, latest weight, 7-day sparkline)
  into a single hero panel, added conditional weight goal panel, demoted 1k Club
  to last position, and removed unreachable success toast. Spun off #197
  (data wiring) and #196 (UI implementation) as follow-ups.
- Issue #187: Standardized the native app shell safe-area and screen-container
  rules by moving stable top/bottom safe-area ownership into `mobile/App.js`,
  migrating Analytics onto the shared `ScreenShell` layout contract, and
  aligning current-state documentation during reviewer closeout.

## 0.42.1 - 2026-05-26

- Issue #186: Added native canonical data-contract coverage for the stabilized
  workout and weight derivation layers, pinning `deriveWorkoutNoteAnalytics()`
  and `deriveWeightGoalAnalytics()` against their underlying helpers, adding
  representative cross-consumer consistency checks, and locking trust-critical
  `computeWeeksIn()` depth cases against regression.

## 0.42.0 - 2026-05-26

- Issue #194: Replaced the native Weight goal card's flat 3500 cal/lb helper
  with a TDEE-anchored daily calorie target when a complete stored user
  profile is available, using Mifflin-St Jeor BMR plus activity multipliers
  with a legacy estimated deficit/surplus fallback when profile data is
  incomplete. Added local user-profile AsyncStorage support plus a shared
  `useUserProfile()` hook, extended data/storage tests to pin the new
  calorie-model contract, and aligned current-state, testing, and
  architecture docs during reviewer closeout.

## 0.41.7 - 2026-05-26

- Issue #185: Finished the native weight-consumer migration by removing the
  last `StatsScreen` screen-local weight reshaping path so Weight, Home, and
  Analytics all render from the shared `deriveWeightGoalAnalytics()` contract,
  added targeted rendered-screen regression coverage for the Analytics weight
  summary path, and aligned the architecture, testing, calculations-reference,
  and MVP4.5 roadmap docs during reviewer closeout.

## 0.41.6 - 2026-05-26

- Issue #171: Published the human-readable calculations reference with verified
  descriptions of all workout analytics (classifications, skip markers,
  attendance flags, rep drop-off, 1k total, Kilo Max, weekly summary), weight
  analytics (trends, pace, rolling averages), goal guidance (direction, pace,
  calorie estimate, weight resolution), and user configuration (tracked lifts,
  1k selections). Includes FAQ and data lifecycle summary.

## 0.41.5 - 2026-05-26

- Issue #193: Repaired workout-data trust regressions by fixing `Weeks In`
  depth for mixed plain-row and `session_entries` history including skipped
  sessions, restoring alias-aware Progressive Overload signal matching,
  switching Analytics rep-drop-off badges to live canonical derivation instead
  of stale persisted badge state, and extending the native Jest suite to pin
  the skipped-session, alias-resolution, and live `hit_wall` regression cases.

## 0.41.4 - 2026-05-25

- Issue #184: Added `deriveWeightGoalAnalytics()` as the canonical native
  weight/goal derivation layer, migrated Home, Weight, and Analytics to the
  shared contract for latest weight, trends, pace, rolling averages, and goal
  guidance, and extended the native data-suite coverage to pin the shared
  output shape.

## 0.41.3 - 2026-05-25

- Issue #183: Finished the workout-consumer migration by routing Analytics
  signal rows and display-name casing through the canonical
  `deriveWorkoutNoteAnalytics()` layer, removing the remaining screen-local
  signal derivation path, and adding contract tests that pin canonical signal
  outputs against `deriveSignals()` for the same inputs.

## 0.41.2 - 2026-05-25

- Issue #181: Fixed Weeks In on Home to use the canonical
  `deriveWorkoutNoteAnalytics` derivation layer instead of calling
  `computeWeeksIn` directly, and added a null-sections guard so
  Home does not crash when no routine is loaded.

## 0.41.1 - 2026-05-25

- Issue #182: Simplified the Home weekly summary by removing `big_3_deltas`
  from the active contract. The Home dashboard no longer renders the Big 3
  Strength Delta panel; `computeWeeklySummary` now returns only
  classification counts and session status rows backed by the canonical
  workout derivation layer.

## 0.41.0 - 2026-05-25

- Issue #180: Built the canonical workout analytics derivation layer
  (`deriveWorkoutNoteAnalytics`) as the single shared entry point for
  workout analytics consumers, migrated LogScreen to use the canonical
  layer for cross-note classifications and rep-drop-off flags, and migrated
  `deriveSkipData` from a 30-day calendar window to a session-depth window
  so repeated weekday skip detection no longer requires calendar dates.

## 0.40.2 - 2026-05-25

- Issue #179: Created the human-readable calculations reference framework at
  `docs/calculations-reference.md`. Organized by calculation type (weight,
  goals, workouts) with "where you see it" surface tags and a FAQ table,
  ready to be filled as MVP4.5 stabilization completes.

## 0.40.1 - 2026-05-25

- Issue #192: Made native weight/goal calculation ownership explicit by moving
  weight-pace threshold ownership into `mobile/lib/data.js`, centralizing
  goal-guidance current-weight resolution for latest-entry and no-entry
  fallback paths, adding a shared weight trend-summary helper for prior-window
  comparisons, and extending native data-suite coverage to lock the contract.

## 0.40.0 - 2026-05-25

- Issue #163: Added the native Home weekly summary panel beneath the existing
  summary cards. The panel now renders from persisted workout-note inputs,
  showing classification counts for stored tracked-exercise classifications,
  opportunistic stored Big 3 deltas, and a session-based empty state when the
  current routine has no logged sessions. Reviewer closeout also aligned the
  Home empty-state copy and restored the parser's single-occurrence semantics
  for plain inline workout rows so the native Jest suite passes cleanly.

## 0.39.0 - 2026-05-25

- Issue #174: Rebuilt the native Home weekly summary around persisted workout
  note analytics instead of live recomputation, corrected the underlying
  session-classification and Big 3 alignment rules from the #171 audit, fixed
  Log save-path producer completeness plus ephemeral inline `hit_wall` nudge
  dismissal behavior, and aligned the docs/testing notes with the new
  canonical-input contract and removal of persisted nudge-dismiss storage.

## 0.38.2 - 2026-05-25

- Issue #173: Added shared native workout temporal helpers for Sunday-based
  current-week gating and inclusive rolling attendance windows, documented the
  distinct `computeWeeksIn()` routine-depth contract, updated skip-attendance
  logic to use the shared rolling-window helper, and added regression coverage
  for plain-row vs `session_entries` semantics plus DST-adjacent date handling.

## 0.38.1 - 2026-05-24

- Issue #172: Defined canonical ownership contract for native workout analytics
  calculations in `docs/architecture.md`, including field-by-field ownership
  matrix, producer/consumer map, recomputation rules, and acceptance contract
  for downstream issues. Identified Home classification dual-source violation
  and `big_3_deltas` ownership gap as HIGH-priority follow-ups. Updated
  `docs/current-state.md` classification semantics and `docs/testing-and-qa.md`
  test gap documentation.

## 0.38.0 - 2026-05-24

- Issue #162: Added native Big 3 cross-lift asymmetry detection so Home now
  surfaces a dismissible informational note when one of squat, bench, or
  deadlift is progressing while another is stalled or regressing for 2+
  weeks, with dismissal persistence that suppresses re-fire until the pair
  shares a classification and the asymmetry later re-emerges. Reviewer
  closeout updated `docs/current-state.md` and `docs/testing-and-qa.md` to
  match and bumped the app version.

## 0.37.0 - 2026-05-24

- Issue #160: Added persisted intra-session rep drop-off flags for tracked
  exercises in the native workout-note save path, surfaced the latest
  `hit_wall` / `in_reserve` state in Log and Analytics, and moved nudge
  dismissals to a global AsyncStorage key so they survive routine switches.
  Reviewer closeout updated `docs/current-state.md`,
  `docs/testing-and-qa.md`, and `docs/architecture.md` to match and bumped the
  app version.

## 0.36.1 - 2026-05-24

- Issue #161: Added persisted workout skip markers and attendance flags to the
  native workout-note save path, including exercise-level skip tracking,
  fully-skipped day detection, 30-day repeated-weekday attendance flags, and
  cross-section consecutive-skip detection that preserves catalog rename
  continuity. Reviewer closeout updated `docs/current-state.md` and
  `docs/architecture.md` to match and bumped the app version.

## 0.36.0 - 2026-05-24

- Issue #159: Added persisted per-exercise session classifications to native
  workout analytics, widened parser/analytics handling so tracked exercise
  histories resolve more reliably across session-entry, plain-row, alias, and
  bodyweight cases, and rebuilt the `Progressive Overload` surface around a
  sticky column header plus compact trend indicators. Reviewer closeout updated
  `docs/current-state.md` and `docs/testing-and-qa.md` to match and bumped the
  app version.

## 0.35.28 - 2026-05-24

- Issue #156: Reworked the native Weight tab into the approved top-to-bottom
  `Goals`, `Trends`, and `History` hierarchy beneath the existing weigh-in
  entry area, merged the Trends presentation into a cleaner sectioned card
  covering `Pace`, `7-day rolling`, and `30-day rolling`, clarified the
  day-level `date` vs recorded `logged_at` contract in the screen code, and
  added rendered-screen regression coverage for merged Trends behavior plus the
  Weight history timestamp split. Reviewer closeout updated
  `docs/current-state.md`, `docs/testing-and-qa.md`, and
  `docs/mvp-v4-roadmap.md` to match and bumped the app version.

## 0.35.27 - 2026-05-24

- Issue #154: Reworked the native Weight goal card around `Target` and
  `By Date` as the primary anchors, rewrote the derived guidance into the
  approved concise `Target pace` / `Suggested deficit|surplus` hierarchy while
  preserving maintain and no-estimate states, and added rendered-screen
  regression coverage for loss, gain, maintain, no-estimate, and pace-warning
  variants. Reviewer closeout updated `docs/current-state.md`,
  `docs/testing-and-qa.md`, and `docs/mvp-v4-roadmap.md` to match.

## 0.35.26 - 2026-05-24

- Issue #151: Tightened native Log workout-row normalization so recurring
  mixed-load shorthand, simple leading flags, and parseable set segments split
  by inline note tails now recover into the existing structured set path
  instead of degrading to raw fallback rows. Unparsed fallback rows keep the
  shared set-row typography treatment, render unresolved lifting rows in error
  red, and leave warmup/non-lifting fallback rows in normal text. Reviewer
  closeout updated `docs/current-state.md` and `docs/mvp-v4-roadmap.md` to
  match and bumped the app version.

## 0.35.25 - 2026-05-24

- Issue #150: Updated the native Log current-routine read view so the expanded
  rendered note body is scroll-first and partially selectable, single taps stay
  inert, double tap enters raw edit, and the editor now preserves the rendered
  note's approximate scroll position on read-to-edit transition. Reviewer
  closeout also replaced the initial scroll-tracking state with a ref to avoid
  unnecessary re-renders in the long-note scroll path, and updated
  `docs/current-state.md` to match.

## 0.35.24 - 2026-05-24

- Issue #146: Finalized the native Log current-routine editor exit behavior on
  the accepted fallback: leaving the raw current-note editor via `Done` or
  Android back now returns consistently to the top of the rendered current
  note instead of landing at stale or random scroll positions. Reviewer
  closeout also removed the dead App-level current-note scroll state plumbing
  and reverted an unrelated tab-persistence widen so the fix stays scoped to
  the Log flow. Updated `docs/current-state.md` to match.

## 0.35.23 - 2026-05-22

- Issue #168: Aligned the native Help screen back arrow with the standard
  in-content back-button treatment already used by the other More sub-screens,
  preserving the existing return-to-More behavior while removing the now-unused
  `headerLeft` prop/render path from `mobile/components/ScreenShell.js`.

## 0.35.22 - 2026-05-22

- Issue #167: Reworked the native bottom tab bar into a content-aware overlay.
  `mobile/components/ScreenShell.js` now reports shared scroll activity up to
  `App.js`, `mobile/components/TabBar.js` fades the bar toward transparency
  during scrolling, restores the solid treatment during direct interaction, and
  returns to its resting overlay state after a short timeout. Reviewer closeout
  also removed the unused `mobile/context/ScrollContext.js` artifact and stale
  imports left behind during implementation. Updated `docs/current-state.md`,
  `docs/architecture.md`, and `docs/mvp-v4-roadmap.md` to match.

## 0.35.21 - 2026-05-22

- Issue #157: Finalized the MVP4 tracked-exercise analytics spec as a
  comment on the issue, locking the per-card metric model to e1RM and
  Kilo max as co-primary alongside two session-to-session arrows (PO and
  Kilo PO) with an explicit baseline state on the first logged session,
  applying uniformly to all tracked weighted exercises with no settings
  toggles. Spun off six Phase 6 implementation cards (#159 per-exercise
  classification, #160 intra-session rep drop-off flag, #161 skip
  detection, #162 Big 3 asymmetry detection, #163 weekly assessment
  summary panel, #164 asterisk opt-out) and recorded them in the MVP4
  Phase 6 off-shoot list in `docs/mvp-v4-roadmap.md`.

## 0.35.20 - 2026-05-22

- Issue #153: Finalized the MVP4 Weight trends design brief in
  `docs/mvp-v4-roadmap.md` by locking the Weight tab into stacked `Goals`,
  `Trends`, and `History` sections beneath the existing weight-entry area,
  defining Trends as three stacked panels (`Pace`, `7-day rolling`,
  `30-day rolling`) with a fixed internal information order, and recording the
  implementation spin-off issue #156 in the MVP4 Phase 6 off-shoot list.

## 0.35.19 - 2026-05-22

- Issue #148: Finalized the MVP4 rendered-workout-note interaction spec in
  `docs/mvp-v4-roadmap.md`. The roadmap now resolves expanded-note behavior to
  body text that remains selectable for normal highlight/copy, single-tap body
  content that stays inert, and double tap anywhere in the expanded rendered
  note body as the only in-body path into raw edit mode while preserving the
  existing title-row expand/collapse behavior. Spun off implementation issue
  #150 and recorded it in the MVP4 Phase 6 off-shoot list.

## 0.35.18 - 2026-05-22

- Issue #128: Rebuilt the Home `Weeks In` counter around routine progression
  depth instead of a calendar-date approximation. `computeWeeksIn` in
  `mobile/lib/data.js` now takes parsed `sections` and returns the longest
  `session_entries` chain across all exercises and days (`null` when no routine
  is loaded, `0` when a routine has no logged entries); `HomeScreen.js` parses
  `sections` once and feeds them to the new signature. As follow-up cleanup,
  the now-orphaned `currentSince` field — read only by the old `computeWeeksIn`
  — was removed from the `makeWorkoutNoteItem` model and from all
  `mobile/storage/entries.js` writes, normalization, and migration paths. Added
  10 `computeWeeksIn` tests and removed 7 stale `currentSince` tests. Updated
  `docs/current-state.md` to match.

## 0.35.17 - 2026-05-22

- Issue #127: Sharpened the Home header and made the summary panels static.
  Replaced the low-resolution wordmark PNG with a resolution-independent inline
  `react-native-svg` `KiloWordmark` component in `HomeScreen.js`, sourced from
  `src/assets/brand/home-title.svg` (renamed from `kilo-wordmark-clean.svg` for
  clarity). Removed navigation from the `1k Club Progress` and `Weight Trend`
  panels, which are now non-interactive dashboard elements, and dropped the
  now-dead `wordmark` style and the `0.8` opacity on the footer logo. Updated
  `docs/current-state.md` to match the new Home header and static panels.

## 0.35.16 - 2026-05-22

- Issue #126: Repaired the baseline strength Analytics presentation in
  `StatsScreen`. Restored uniform spacing between strength panels, replaced the
  Kilo-max tap-toggle with both `1 Rep Max` and `Kilo Max` shown together in
  every Progressive Overload row, and reworked the tracked-lift cards into a
  compact bordered list matching the weight-history style. Labels were polished
  (`Tracked Lifts` -> `Progressive Overload`, `Big Three 1RM Total` ->
  `1K Progress`, `Slot assignments` -> `Big 3 Mapping`) and exercise names now
  render with their original user-typed casing. The now-dead `kilo_max_raw`
  field was removed from `computeKiloMax` and `deriveSignals` along with its
  test assertions. Updated `docs/current-state.md` to match the new strength
  surface.

## 0.35.15 - 2026-05-21

- Issue #125: Restored the Analytics weight-trend chart, which had stopped
  rendering. `StatsScreen` was overriding its raw weight entries with the
  display-adapted `entries` prop from `App.js` (string `value`, no `date` or
  `weight_value`), so the trend filter stripped every entry and the chart drew
  nothing. `StatsScreen` now derives weight data exclusively from its own
  `useWeightEntries()` hook, and the now-dead `entries` prop and its adapter
  memo in `App.js` were removed. Same-day duplicate-weight behavior and weight
  history are unchanged. Updated `docs/current-state.md` to drop the stale
  entry-adapter description.

## 0.35.14 - 2026-05-21

- Issue #124: Fixed the empty Log state so a fresh install no longer auto-opens
  the note editor or keyboard. Log now renders a dedicated `LogEmptyState`
  component (`mobile/components/LogEmptyState.js`) with explanatory copy, a
  `New Routine` primary action, and an example-format card, gated on the
  workout-note load so existing users never see it flash before their routine
  appears. Removed `autoFocus` from the note editor. Updated
  `docs/current-state.md` and `docs/repo-structure.md` to match.

## 0.35.13 - 2026-05-21

- Issue #123: Made the current routine a title-first collapsible card on the
  Log tab — the header row toggles a collapsed/expanded state persisted under
  `kilo_log_current_collapsed` and held in `App.js` so it survives tab
  navigation and app restarts. Removed the top header `Edit` button (edit mode
  is now entered through the in-card `Edit note` action), renamed the Log
  surfaces to `Workout Notes` / `More Routines` / `Set Current`, and added a
  `LOG TAB STYLE LOCK` notice so Log-tab typography and styling are not changed
  without an explicit owner request. Updated `docs/current-state.md` to match.

## 0.35.12 - 2026-05-21

- Issue #122: Fixed workout-note save semantics so `Save` is the explicit save
  action, the editor stays open with a transient `Saved!` confirmation, and
  `Done` / Android back no longer save implicitly — leaving with unsaved
  changes now prompts to discard a never-saved note or save/discard an existing
  note. Removed implicit creation of a never-saved note, fixed a stale
  `BackHandler` closure that could drop the discard prompt, and replaced the
  implicit save-on-switch with an explicit save-and-switch / switch-anyway
  choice. Updated `docs/current-state.md` to match the shipped behavior.

## 0.35.11 - 2026-05-21

- Issue #144: Restored native Weight goal pace and calorie guidance by
  computing saved-goal estimates without waiting for form-state hydration,
  adding a current-weight fallback for no-entry goal setup, and clearing that
  fallback state on edit cancel/clear so stale values are not silently reused.

## 0.35.10 - 2026-05-21

- Issue #143: Renamed the native Analytics `first_session` label from `First`
  to the approved `Initial` wording in both progression-status and overload
  contexts.

## 0.35.9 - 2026-05-21

- Issue #145: Fixed tracked-lift Analytics progression status and overload
  trend so exercises logged as multiple session-entry lines under one block no
  longer stick on `first_session`, and mixed inline/session-entry history now
  compares against the latest prior comparable session correctly.

## 0.35.8 - 2026-05-21

- Issue #141: Normalized native Log-tab set-row typography by routing both
  parsed `SetLine` rows and fallback unparsed/skip rows through one shared
  font-size token, removing the stray italics and inconsistent sizing from the
  read view. Updated `docs/current-state.md` and `docs/mvp-v3.5-roadmap.md`
  to match the shipped UI.

## 0.35.7 - 2026-05-21

- Issue #140: Raised the native Weight screen Goal section to the top of the
  screen, enlarged goal target/date typography, promoted weekly pace and
  calorie guidance into high-hierarchy suggestion boxes, preserved semantic
  maintain-goal messaging, and updated `docs/current-state.md` plus
  `docs/mvp-v3.5-roadmap.md` to match the shipped UI.

## 0.35.6 - 2026-05-21

- Issue #139: Replaced the native Weight goal target-date text field with a
  native date picker, kept stored goal dates in ISO while rendering visible
  target dates as `MM-DD-YYYY`, and updated `docs/current-state.md` plus
  `docs/mvp-v3.5-roadmap.md` to match the shipped behavior. Follow-up bug
  #144 tracks the separate missing goal-estimate display issue found during
  closeout verification.

## 0.35.5 - 2026-05-21

- Issue #138: Reformatted visible native Weight history dates to
  `MM-DD-YYYY` through a display-only formatter while leaving stored ISO
  timestamps unchanged, added formatter regression coverage, and updated
  `docs/current-state.md` plus `docs/mvp-v3.5-roadmap.md` to reflect the
  shipped behavior.

## 0.35.4 - 2026-05-21

- Issue #137: Right-sized and recolored the native Weight log weigh-in save
  button so it matches the app's primary-action sizing more closely and uses
  the shared accent palette instead of raw black. Updated
  `docs/mvp-v3.5-roadmap.md` to mark the polish task shipped.

## 0.35.3 - 2026-05-20

- Issue #136: Shifted native app content upward at the shared shell by moving
  top-spacing responsibility into `mobile/components/ScreenShell.js`,
  wrapping the shared header in `SafeAreaView`, keeping one Android
  status-bar-aware offset there, and removing the old global top container
  padding so all tabs sit higher without notch or status-bar clipping.
  Updated `docs/current-state.md` and `docs/mvp-v3.5-roadmap.md` to match the
  shipped behavior.

## 0.35.2 - 2026-05-20

- Issue #135: Softened the native bottom tab bar by switching it from the
  heavy dark floating treatment to the lighter shared card/chip palette,
  keeping touch targets intact while making the active state remain easy to
  identify. Updated `docs/current-state.md` and `docs/mvp-v3.5-roadmap.md` to
  match the shipped UI and roadmap status.

## 0.35.1 - 2026-05-20

- Issue #134: Fixed native Analytics tab entry flicker by stabilizing the
  initial `StatsScreen` layout and loading state, scoped section placeholders
  to their own data dependencies, filtered incomplete weight rows before the
  rolling-average helpers, and updated `docs/current-state.md` plus
  `docs/mvp-roadmap.md` to match the shipped behavior.

## 0.35.0 - 2026-05-20

- Issue #133: Updated the native Log read view so warmup and lifting work for
  the same calendar day render under one weekday heading while preserving
  distinct sub-sections, added parser coverage for the same-day heading
  contract, and updated `docs/current-state.md` plus `docs/mvp-roadmap.md` to
  match the shipped behavior.

## 0.34.0 - 2026-05-20

- Issue #132: Added a neutral native Home `Weeks In` tile derived from the
  current routine's `currentSince` date, kept it 1-indexed from the
  designation day, preserved a neutral unknown state for migrated legacy
  routines without a known start date, and updated `docs/current-state.md`
  plus `docs/mvp-roadmap.md` to match the shipped Home behavior.

## 0.33.2 - 2026-05-20

- Issue #131: Updated the native Home header to use the bundled Kilo
  wordmark, changed the supporting copy to `Current Routine Progress`,
  renamed the strength card to `1k Club Progress`, removed the old `Total
  Weeks` tile, and updated `docs/current-state.md` plus
  `docs/mvp-roadmap.md` to match the shipped Home behavior.

## 0.33.1 - 2026-05-20

- Issue #130: Tightened the native Home dashboard navigation so only the
  intended `1,000 lb Club` total and `7-day rolling average` regions
  navigate, routed both targets to the matching Analytics section, removed the
  misleading extra line from the 1k bubble, and updated
  `docs/current-state.md` and `docs/mvp-roadmap.md` to match the shipped
  behavior.

## 0.33.0 - 2026-05-20

- Issue #129: Shipped routine-aware tracked-lift Analytics cards on the native
  app by wiring Log and Analytics to the same reactive global tracked-lift
  store, filtering visible cards to lifts present in the current routine while
  preserving full per-lift history across routines, and keeping Big Three 1RM
  totals plus workout counts scoped to the current routine. Updated
  `docs/current-state.md`, `docs/architecture.md`, and
  `docs/mvp-v3.5-roadmap.md` to match the shipped behavior.

## 0.32.0 - 2026-05-20

- Issue #121: Re-enabled the native Log-screen `Track` control with persistent
  global tracked-lift storage keyed by normalized exercise names, fixed the
  rapid-toggle race so consecutive Track updates cannot overwrite each other,
  and updated `docs/current-state.md`, `docs/architecture.md`, and
  `docs/mvp-v3.5-roadmap.md` to match the shipped behavior.

## 0.31.0 - 2026-05-20

- Issue #120: Added native Log-tab `Set current` actions for non-current
  routines, requiring confirmation before routine switches, preserving pending
  edits before the switch, and recording a real `currentSince` timestamp when
  a different routine becomes current. Updated `docs/current-state.md` and
  `docs/mvp-v3.5-roadmap.md` to match the shipped behavior.

## 0.30.0 - 2026-05-20

- Issue #119: Added native Log-tab routine CRUD controls so users can create,
  rename, and delete routine notes from the notebook UI, with confirmation on
  deletes and persisted current-routine cleanup when the active routine is
  removed. Updated `docs/current-state.md` and `docs/mvp-roadmap.md` to match
  the shipped behavior.

## 0.29.0 - 2026-05-20

- Issue #118: Updated the native Log tab so the selected current routine stays
  in the full parsed-workout view while every non-current routine now appears
  as a collapsed title-only row in the bottom `Routines` list that opens its
  raw editor on tap. Updated `docs/current-state.md` and
  `docs/mvp-roadmap.md` to match the shipped behavior.

## 0.28.1 - 2026-05-20

- Issue #117: Migrated native workout-note storage from the legacy single-note
  shape into the multi-routine notebook model, including one-time backfill of
  a `Routine 1` current entry for old local data, normalization of older
  notebook rows so they carry `isCurrent` and `currentSince`, and regression
  coverage for migration, persistence, and current-routine metadata. Updated
  `docs/current-state.md`, `docs/architecture.md`, and `docs/mvp-roadmap.md`
  to match the shipped storage behavior.

## 0.28.0 - 2026-05-20

- Issue #116: Added a low-prominence fatigue-multiplier setting to the More
  tab in both the native app and the browser prototype, persisted the value
  through the existing local storage paths and backup/export contract, and
  wired Analytics to recompute tracked-lift Kilo max values immediately after
  multiplier changes. Updated `docs/current-state.md` and
  `docs/architecture.md` to match the shipped behavior.

## 0.27.6 - 2026-05-20

- Issue #115: Fixed native Analytics Kilo max so tracked lifts no longer reuse
  estimated 1RM. The tracked-lift cards now compute Kilo max from the average
  Epley value across non-warmup sets with the default `1.07` fatigue
  multiplier, store both adjusted and raw values, and let the user tap to
  inspect the raw value on the Analytics screen. Updated `docs/current-state.md`
  to match the shipped behavior.

## 0.27.5 - 2026-05-20

- Issue #114: Fixed the shared native weight pace classifier so tiny daily
  changes no longer trigger false fast-gain/fast-loss warnings, centralized
  the threshold logic in one helper used by both Weight and Analytics, and
  restored distinct yellow (`>= 1.5 lb`) versus red (`>= 2.3 lb`) warning
  bands across both screens. Updated `docs/current-state.md` to match the
  shipped behavior.

## 0.27.4 - 2026-05-20

- Issue #113: Disabled the native Log-screen `Track` control until the
  persistence pipeline lands, removed the silent tap-with-no-result behavior,
  and updated `docs/current-state.md` to match the shipped read-view state.

## 0.27.3 - 2026-05-20

- Issue #112: Fixed native Android hardware-back behavior so non-Home tabs
  route back toward Home instead of exiting immediately, the More and Log
  flows pop their own in-screen subviews before falling through, and the Home
  root now shows an exit confirmation instead of closing the app outright.
  Updated `docs/current-state.md` to match the shipped mobile navigation
  behavior.

## 0.27.2 - 2026-05-20

- Issue #111: Fixed the native Log raw-note Save flow so current-note edits
  persist through the workout-note store, successful saves return to read mode
  for visible confirmation, first-save creation still blocks empty notes, and
  existing notes can still be cleared to an empty string. Added storage
  regression coverage for both the raw-text update round-trip and the
  existing-note clear path, and updated `docs/current-state.md` to match the
  shipped Log behavior.

## 0.27.1 - 2026-05-20

- Issue #110: Fixed the native Home screen `1,000 lb Club` bubble so it
  navigates to the shipped `Analytics` tab instead of a blank screen, and
  added a legacy `Stats` route fallback in `mobile/App.js` so stale
  navigation targets still resolve cleanly.
- Added `docs/mvp-v3.5-roadmap.md` to capture the next post-MVP cleanup and
  capability plan, and shipped the mobile Android bundle dependency fix that
  updates the declared `expo-updates` version plus `mobile/package-lock.json`
  so the native install path stays buildable.

## 0.27.0 - 2026-05-19

- Issue #109: Redesigned the native Analytics strength section by renaming the
  old `1,000 lb Club` panel to a Big Three 1RM total, filtering 1k slot
  selection down to strength lifts, and expanding tracked-lift cards to show
  estimated 1RM, all-time Kilo max, latest top weight, and overload trend.
  Added parser coverage for the new analytics outputs and updated
  `docs/current-state.md` to match the shipped behavior.

## 0.26.0 - 2026-05-19

- Issue #108: Compacted the native Analytics weight section into a single
  summary card with latest weigh-in, corrected shared pace warning, embedded
  7-day rolling-average chart, and 7-day/30-day averages while removing the
  low-value totals layout. Updated `docs/current-state.md` to match the
  shipped Analytics behavior.

## 0.25.0 - 2026-05-19

- Issue #107: Replaced the native Home mini-analytics cards by removing the
  old sets-per-session panel, adding a current-workout `1,000 lb Club`
  progress card derived from the latest tracked lift results, and switching
  the weight surface to a compact 7-day rolling-average line chart with the
  shared tap-to-inspect value display. Updated `docs/current-state.md` and
  `docs/mvp-roadmap.md` to match the shipped Home behavior.

## 0.24.0 - 2026-05-19

- Issue #106: Added a reusable compact native line-chart primitive for the
  shared mobile UI layer, with latest-value display and tap-to-inspect point
  selection while removing hard-coded screen-width assumptions so future Home
  and Analytics chart surfaces can embed it in different layout contexts.

## 0.23.0 - 2026-05-19

- Issue #105: Added a lightweight advisory calorie-estimate helper for native
  weight goals. The Weight screen now shows a direction-aware daily
  surplus/deficit estimate derived from the saved goal's required weekly pace,
  suppresses contradictory output for maintain goals, and includes regression
  coverage for the maintain-direction edge case.

## 0.22.0 - 2026-05-19

- Issue #104: Added a lightweight native Weight-goal flow with persistent
  target weight and target date storage, derived gain/loss/maintain direction,
  required weekly pace, and advisory unrealistic/unhealthy warnings that do
  not block save. The local v2 backup/import path now includes the persisted
  weight goal with pre-write validation and malformed-payload rejection
  coverage, and the current-state, architecture, testing, and roadmap docs
  now reflect the shipped native behavior.

## 0.21.2 - 2026-05-19

- Issue #103: Redesigned the native Weight history rows for long-history use
  by tightening row spacing, adding per-entry delta formatting plus visual
  severity cues for notable (`> 1.5 lb`), spike (`> 2.3 lb`), and outlier
  (`> 3.5 lb`) changes, and keeping the existing row edit/delete behavior
  intact. Updated `docs/current-state.md` to match the shipped Weight-screen
  behavior.

## 0.21.1 - 2026-05-19

- Issue #102: Fixed the shared native weight pace calculation so backdated
  entries are classified by their actual `date` instead of insertion order,
  keeping Weight and Analytics aligned on the same gain/loss pace result and
  adding regression coverage for gain, loss, and neutral cases.

## 0.21.0 - 2026-05-19

- Issue #101: Fixed current-workout session counting so warmup and lifting
  blocks under the same day heading count as one session, changed Home `Total
  Weeks` to use the highest per-day session count from the selected workout
  note through a stable parser helper, and added regression coverage for the
  corrected combined-day counting rules.

## 0.20.0 - 2026-05-19

- Issue #100: Extended the native Log routine workflow so any non-current
  workout note can be opened in a dedicated raw-note editor from the always-
  visible `Previous Routines` list, current-note saves are guarded against
  duplicate in-flight taps, and promoting another routine to the current
  workout now requires confirmation and preserves unsaved edits by saving them
  first or surfacing a failure without switching. Updated
  `docs/current-state.md` to match the shipped Log behavior.

## 0.19.0 - 2026-05-19

- Issue #99: Rebuilt the native Log tab around the selected current workout.
  `mobile/screens/LogScreen.js` now shows the active routine in the structured
  read view while rendering non-current routines as compact `Previous
  Routines` panels that switch the current selection, and `mobile/App.js` now
  refreshes the editor text when the current routine changes. Updated
  `docs/current-state.md` to match the shipped Log-tab behavior.

## 0.18.2 - 2026-05-19

- Issue #98: Replaced the native single workout-note store with a local-only
  multi-note current-workout model. `mobile/storage/entries.js` now persists
  multiple titled workout notes plus an explicit current-workout selection,
  `mobile/hooks/useEntries.js` exposes the new current-note hook surface for
  later UI work, `mobile/App.js` now saves through the selected workout note,
  and the local backup/import path now exports the v2 multi-note format while
  still accepting legacy v1 backups to restore weight history without wiping
  the newer workout-note state. Updated the current-state, architecture, and
  roadmap docs to match the shipped storage contract.

## 0.18.1 - 2026-05-19

- Issue #97: Polished the native Help flow inside the More tab by extending
  `mobile/components/ScreenShell.js` with a title-row `headerLeft` slot,
  keeping More-screen quick actions unchanged, and moving Help-only branding
  to a centered in-content logo above the Help and Terminology panel with an
  accessible header back control.

## 0.18.0 - 2026-05-19

- Issue #96: Made the native Home dashboard more actionable by turning the
  `Latest Weight` and `Total Weeks` summary cards into tab shortcuts to Weight
  and Log, removing the low-value `Recent activity` section, and extending the
  shared native `Card` primitive with an `onPress` path that preserves the
  non-pressable card rendering behavior.

## 0.17.7 - 2026-05-19

- Issue #95: Simplified the native Home dashboard copy and top summary
  presentation in `mobile/screens/HomeScreen.js` by changing the subtitle to
  `Your training dashboard.`, renaming the second summary card from
  `Total Workouts` to `Total Weeks`, and balancing the two summary cards with
  local Home-only styling instead of broad shared-component changes.

## 0.17.6 - 2026-05-19

- Issue #94: Simplified the native shared header treatment in
  `mobile/components/ScreenShell.js` by removing the shared logo/wordmark
  header assets, reducing the version display to a low-emphasis `vX.Y.Z`
  label, and standardizing the displayed version naming away from the old
  `alpha-` prefix. Updated `docs/current-state.md` so the documented native
  header behavior matches the shipped app.

## 0.17.5 - 2026-05-19

- Issue #93: Normalized the native app's top safe-area spacing across Home,
  Log, Weight, Analytics, and More/Help by moving Log and Weight onto the
  shared `ScreenShell`, adding Android status-bar-aware top spacing there, and
  preserving first-tap form actions via `keyboardShouldPersistTaps="handled"`
  on the form-based screens. Bottom tab bar behavior unchanged.

## 0.17.4 - 2026-05-19

- Issue #88: Fixed a regression from #79 that broke the workout read view.
  `buildSessionsFromNote` had been wired into `LogScreen`, `HomeScreen`, and
  `StatsScreen`, so the real freeform log format (bare `weight reps` history
  lines, bare `-` skip markers) rendered as "Session N" blocks full of
  "— skipped" while actual parsed history was hidden, and workout counts
  collapsed to skip-slot artifacts. Removed `buildSessionsFromNote` from all
  product screens: the read view now always renders the formatted note mirror
  (day → `+` subheading → `-` exercise → history rows) faithful to the raw
  text with inline `—` skip markers. Added `countWorkoutSessions` (max parsed
  history-row count across exercises) as the source for Home "Total Workouts"
  / "Sets per session" and Analytics "Workout sessions". `buildSessionsFromNote`
  and its tests are retained for legacy-migration-format validation only. No
  migration-format, analytics-formula, or persistence change.

## 0.17.3 - 2026-05-18

- Issue #86: Wired the OTA signing key into the mobile publish scripts. Both
  `publish:android` and `publish:android:preview` now pass
  `--private-key-path "${EXPO_OTA_PRIVATE_KEY_PATH:?...}"`, so signed preview
  and production updates no longer require hand-appending the key path and a
  missing env var fails fast with a clear message instead of a cryptic
  `eas` signing error. Documented the env var contract and both signed-publish
  flows in `mobile/certs/KEYS.md`. No signing certificate, channel, or
  platform change.

## 0.17.2 - 2026-05-18

- Issue #85: Replaced the opaque-background brand assets with true RGBA
  transparent PNGs (`logo.png`/`wordmark.png` in both `mobile/assets/brand/`
  and `src/assets/brand/`) and switched `ScreenShell` `require()` paths off
  the `.jpg` files. Re-cropped the wordmark from a 512×512 square canvas to
  its true 303×106 text bounding box and set the `ScreenShell` wordmark
  display size to `91×32` with `resizeMode="contain"`, fixing the squashed
  wordmark and the white box on the cream native background. Legacy `.jpg`
  files left in place; no code references them.
- Issue #33: UX scoping pass on Kilo theme and color. Captured concrete
  contrast/readability findings against shipped screens (KiloHeader filter
  hack, `ink4` AA failure, faint `accentDim`, marginal small-size labels)
  and a tighter follow-up implementation scope. Scoping only; no product
  code change. Spawned issue #85.

## 0.17.1 - 2026-05-18

- Issue #83: Synced `mobile/package-lock.json` with the declared
  `expo-updates@~29.0.17` dependency so EAS `npm ci` no longer fails in the
  Install dependencies phase. No version-pin change.
- Issue #84: Renamed `mobile/assets/brand/logo.png` and `wordmark.png` to
  `.jpg` (the files were JPEG data with a `.png` extension) and updated the
  `ScreenShell` `require()` paths, fixing the AAPT2
  `:app:mergeReleaseResources` failure on the Android preview build. No
  visual or transcoding change.

## 0.17.0 - 2026-05-18

- Issue #82: Fixed Android preview OTA update visibility. Switched
  `runtimeVersion.policy` from `fingerprint` to `appVersion` so valid
  JS/asset OTA updates apply to installed builds sharing the app version,
  and added an OTA Diagnostics panel to the About screen (channel, runtime
  version, embedded-vs-applied bundle, update-available/pending state, and a
  manual update check). Documented the exact cases requiring a fresh Android
  build — including the one-time rebuild needed to migrate off legacy
  `fingerprint` APKs — in `docs/phone-runbook.md` and `docs/current-state.md`.

## 0.16.0 - 2026-05-18

- Issue #80: Added a local-only mobile export/import and recovery flow for user
  data. Introduced a versioned v1 backup format plus `exportBackup`,
  `validateBackup`, and `importBackup` in the native storage layer, with
  validation before any write, a batched atomic-as-possible replace restore,
  and a Data & Backup surface in the More tab for export/share and paste-to-
  import with clear success/error handling. Restore leaves the legacy
  workout-session key untouched and no remote sync is introduced. Aligned the
  architecture and current-state living docs with the new recovery path.

## 0.15.0 - 2026-05-18

- Issue #81: Extracted the shared workout parsing and derived-analytics domain
  layer across the web and native app paths, migrated the browser consumers to
  the canonical row/note parser plus shared Epley-based analytics helpers, and
  aligned the living docs with the now-shared analytics behavior.

## 0.14.8 - 2026-05-18

- Issue #79: Unified the native app around the canonical workout-note
  persistence model, removed downstream dependence on the legacy structured
  workout-session path for current Home/Log/Analytics behavior, and added a
  contract-driven migration flow plus test coverage so legacy installs retain
  session counts, weighted history, non-weight history, and mixed-entry note
  metadata when their older session data is folded into the workout note.

## 0.14.7 - 2026-05-18

- Issue #75: Hardened the legacy `Kilo.html` runtime CDN dependencies with
  verified SRI hashes and `crossorigin="anonymous"` attributes, switched React
  and ReactDOM to production-minified CDN assets, and updated the architecture
  and current-state docs to document the browser and Capacitor shell
  supply-chain protection posture.

## 0.14.6 - 2026-05-18

- Issue #78: Made the Android Capacitor shell's backup behavior explicit by
  wiring manifest backup rules that preserve WebView `localStorage` workout and
  weight history across backup/restore flows while excluding SharedPreferences,
  and documented that packaged-Android persistence policy in
  `docs/current-state.md`.

## 0.14.5 - 2026-05-18

- Issue #77: Added a GitHub Actions dependency-audit gate for both the root
  and `mobile/` package trees, added matching local `npm audit` scripts, and
  documented the new high-severity vulnerability check in
  `docs/testing-and-qa.md`.

## 0.14.4 - 2026-05-18

- Issue #76: Enabled Expo OTA update code signing for the native app by adding
  the client-side certificate and manifest-signing configuration, documenting
  private-key handling and signed publish requirements, and clarifying that
  on-device enforcement begins only after installing a native build produced
  with the embedded certificate.

## 0.14.3 - 2026-05-18

- Issue #74: Updated `docs/repo-structure.md` so the tracked repo inventory
  includes `docs/mvp-v2-roadmap.md`, `docs/phone-runbook.md`, and
  `tests/log-ui.test.jsx`, and clarified that `android/` is intentionally
  tracked Capacitor shell source while generated artifacts remain excluded by
  `android/.gitignore`.

## 0.14.2 - 2026-05-18

- Issue #73: Added a root `.gitignore` covering generated and local-only
  artifacts, made the `.claude/` runtime boundary explicit at the repo root,
  and removed the previously tracked `.claude/napkin.md` and
  `.claude/settings.json` files from version control.

## 0.14.1 - 2026-05-18

- Issue #69: Added a Mermaid current-state architecture diagram to
  `docs/architecture.md` and refreshed stale native-app routing references so
  the architecture doc matches the current Expo app surface.

## 0.14.0 - 2026-05-18

- Issue #68: Made native strength analytics resilient to conservative
  deterministic exercise-name variants, added explicit persisted 1k exercise
  slot selection on the Analytics screen, and updated analytics copy so 1k and
  tracked-lift behavior no longer depends on rigid hardcoded lift names.

## 0.13.3 - 2026-05-18

- Issue #67: Fixed the native Weight flow so saving a weigh-in keeps the user on
  Weight history, replaced the oversized bubble-card history treatment with a
  denser scannable row layout, and added inline per-row deletion without
  interfering with tap-to-edit behavior.

## 0.13.2 - 2026-05-17

- Issue #66: Fixed the native workout-note editor polish so the bottom Log
  read-view action now shows visible `Edit note` text and saving a note keeps
  the user in the editor near the same cursor and scroll context instead of
  jumping them back to a different read-view position.

## 0.13.1 - 2026-05-17

- Issue #65: Fixed long-note workout session alignment in the native app so
  positional `- ...` exercise entries now build shared sessions across warmup
  and lifting blocks, bare `-` skip slots preserve cross-exercise alignment,
  uneven entry counts surface a visible warning, and the Log read view exposes
  one editable block per detected session instead of reporting sessions that
  were not separately surfaced.

## 0.13.0 - 2026-05-17

- Issue #62: Enabled Android EAS OTA updates for the native Expo app by
  configuring `expo-updates`, explicit Android update channels, channel-based
  publish scripts, and a fingerprint-based runtime boundary so JS and asset
  changes can ship without a rebuild while native-affecting changes still
  require a new build.

## 0.12.0 - 2026-05-17

- Issue #64: Replaced the native Home tab with a dashboard that shows recent
  activity plus workout-volume and bodyweight trend graphs, renamed the native
  Stats tab to Analytics with clearer tracked-lift terminology, added distinct
  Help and About surfaces under More, shipped native logo/wordmark header
  branding with an alpha version badge sourced from `mobile/package.json`, and
  aligned the repo docs with the updated native UI surface.

## 0.11.3 - 2026-05-17

- Issue #61: Added the first documented iOS EAS build path for the real
  `mobile/` Expo app, including checked-in simulator and internal-device
  profiles, the required iOS bundle identifier, explicit iPhone/iPad install
  and update steps, and the remaining Apple account, UDID, Developer Mode, and
  simulator-platform blockers.

## 0.11.2 - 2026-05-17

- Issue #60: Reconciled the top-level README with the living current-state
  doc so repo-facing docs consistently describe `mobile/` as the active app
  path, the browser prototype as the legacy reference path, and Expo EAS
  Android packaging as the documented native build flow.

## 0.11.1 - 2026-05-17

- Issue #59: Replaced the native Expo app's default placeholder launcher,
  adaptive-icon, splash, and favicon assets with shipped Kilo-branded PNG
  assets, and aligned the Android adaptive-icon and splash background colors to
  the branded native identity.

## 0.11.0 - 2026-05-17

- Issue #55: Replaced the native Stats summary grid with a minimal analytics
  surface that combines tracked-lift estimated PRs, 1k progress,
  progression/repeatability signals, weight-trend cards, and shared
  workout-session refresh behavior in the Expo app.

## 0.10.0 - 2026-05-16

- Issue #54: Added local native progression-over-time and repeatability
  signals for tracked exercises, comparing the latest comparable weighted
  result against the prior comparable result while preserving separate
  estimated-PR math and covering mixed weighted or rep-only history cases in
  the parser suite.

## 0.9.0 - 2026-05-16

- Issue #57: Added local native 1k-total derivation from the user-selected
  bench, squat, and deadlift estimated PRs, including immediate recompute
  behavior when note content or tracked-lift selection changes and focused
  parser-suite coverage for mixed-weight and multi-day note cases.

## 0.8.0 - 2026-05-16

- Issue #52: Added native 7-day and 30-day derived weight averages plus fast
  gain/loss pace flags on the Weight and Stats screens, and covered the local
  calendar-date boundary behavior for those trend calculations in mobile
  storage tests.

## 0.7.1 - 2026-05-16

- Issue #58: Added the minimum Expo EAS Android build configuration for the
  real `mobile/` app, documented the standalone APK build/install flow, and
  clarified the one-time project-linking step needed to commit the EAS
  `projectId` for reproducible builds.

## 0.7.0 - 2026-05-16

- Issue #56: Added parsed-exercise tracking controls to the native workout-note
  read view, persisted tracked exercise selections on the canonical note
  document, and expanded native storage coverage for tracked-exercise
  persistence.

## 0.6.0 - 2026-05-16

- Issue #50: Added a formatted read/edit workout-note flow in the native Log
  screen, including a faithful rendered mirror of the canonical note,
  mixed-weight row display, and attempt-scoped save handling that only exits
  edit mode after a successful workout-note save.

## 0.5.0 - 2026-05-16

- Issue #51: Added native weight-entry correction flows so saved weigh-ins can
  be reopened from history, edited or deleted in place, validated inline, and
  reflected immediately across shared native weight views.

## 0.4.0 - 2026-05-16

- Issue #49: Replaced the native Log screen's rigid workout title and session
  detail form with a single freeform workout-note editor, and rewired the app
  shell to save the workout tab through canonical workout-note persistence
  instead of structured workout sessions.

## 0.3.3 - 2026-05-16

- Issue #53: Added a native tracked-exercise estimated-PR engine that computes
  Epley values per parseable set, surfaces the best current estimate per
  tracked exercise, and deduplicates default and caller-supplied tracked names
  before emitting analytics rows.

## 0.3.2 - 2026-05-16

- Issue #48: Added a native derived workout analytics contract on top of
  parsed workout notes, including per-exercise rollups, grouped-row
  preservation, stable occurrence linkage for set-level PR inputs, and
  retention of non-weight `unparsed_rows` for later note-based UI and
  analytics work.

## 0.3.1 - 2026-05-16

- Issue #47: Added tolerant native parsing for sample-style workout-note
  shorthand, including day and section headings, mixed-weight set rows, deload
  summaries, and graceful degradation for ambiguous or non-weight note
  fragments without failing the canonical note parse.

## 0.3.0 - 2026-05-15

- Issue #46: Added native AsyncStorage support for one canonical workout
  routine note, including save/load/overwrite/clear behavior, a one-time
  migration bridge from legacy structured workout sessions, and expanded mobile
  storage coverage for the workout-note path.

## 0.2.7 - 2026-05-15

- Issue #17: Closed the legacy MVP acceptance review after the repo-readiness
  stack was completed and the final launch hold was cleared by user-confirmed
  on-phone verification. Updated current-state readiness status to reflect the
  completed review.

## 0.2.6 - 2026-05-15

- Issue #45: Added automated Log screen UI coverage for the duplicate-session continuity banner and the save-success state actions, without changing duplicate logging behavior.

## 0.2.5 - 2026-05-15

- Issue #44: Removed the Home screen's recent-history delete affordances for workout and weight rows so Home stays a display-only summary surface while Stats continues to own history deletion.

## 0.2.4 - 2026-05-15

- Issue #43: Fixed the native Expo app's first-tap reliability by making weight and workout saves register with the keyboard open, preventing duplicate in-flight saves, and keeping the tab bar reachable above the iOS keyboard without changing completed-tap semantics.

## 0.2.3 - 2026-05-14

- Issue #40: Replaced native browser confirm, prompt, and alert flows on Home, Stats, and Weight with app-native inline delete confirmation and inline weight editing errors while preserving the underlying correction actions.

## 0.2.2 - 2026-05-14

- Issue #41: Added a duplicate-session informational banner on the Log screen when today's split was already logged, and expanded the save-success state to offer both `View Stats` and `Back to Home`.

## 0.2.1 - 2026-05-14

- Issue #39: Moved the Log screen's primary save control into the header so it stays reachable without footer scrolling, while keeping footer summary stats in place and rendering generic save failures near the header action.

## 0.1.3 - 2026-05-10

- Issue #35: Declared `mobile/` the active native-app path, documented the migration boundary versus the legacy prototype-wrapper path, defined the first native MVP milestone, and split first implementation ownership between UI migration and parser/storage migration.

## 0.2.0 - 2026-05-13

- Issue #36: Ported the MVP UI shell into the real native Expo app path under `mobile/`, adding native Home, Log, Weight, and Stats screens plus shared native components, and updated the living docs to reflect the active native UI path and remaining parser/storage gap.

## 0.1.2 - 2026-05-10

- Issue #30: Added `cap:run` and `preview` npm scripts for a repeatable device sync and relaunch loop. Documented the full rebuild → sync → run workflow in `docs/testing-and-qa.md`.
- Issue #32: Replaced the browser-centric manual smoke flow with a concise physical-phone checklist for the installable preview, including a concrete on-device update/redeploy step alongside install, update/relaunch, loading behavior, and basic touch interaction.

## 0.1.1 - 2026-05-10

- Issue #28: Replaced the plain `Kilo` text treatment with the approved Direction 3 brand lockup in the app header and More screen footer, and added shipped brand assets for the prototype UI.
- Issue #31: Added `npm run build` script that stages `Kilo.html` and `src/` into `www/` for Capacitor packaging. Added `.gitignore` to exclude `www/` and `node_modules/`.
- Issue #29: Initialized Capacitor with Android as the single native target. Added `capacitor.config.json` (appId `com.benpronin.kilo`, webDir `www`), generated `android/` project directory, and added `cap:sync` and `cap:open` npm scripts.

## 0.1.0 - 2026-05-10

- Issue #25: Established the initial documented MVP baseline, added canonical repo versioning in `package.json`, and defined lightweight pre-1.0 versioning and changelog rules in `AGENTS.md`.
- Issue #26: Refactored the More screen footer to render the app version from a new runtime global seeded in `src/data.jsx`.

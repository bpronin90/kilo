# Native Runtime and Navigation

For app maintainers locating shell, hydration, routing, and read-failure ownership.

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
- `mobile/storage/secureStorage.js` is the native health/training persistence
  boundary. It encrypts every `kilo_` AsyncStorage value with AES-256-GCM and a
  device key held in SecureStore, authenticates each storage key as associated
  data, and orders migration, read/write, and confirmed wipe operations under a
  readers/writer discipline: writes stay totally ordered and exclusive, while
  reads admitted between two writes run concurrently with each other (#984).
  Reads of distinct keys have no data dependency, so the cold launch overlaps
  their native round trips instead of paying their sum; the AES-GCM decrypts
  themselves still run on the JS thread and are unaffected.
  A successful wipe advances an app-shell generation that remounts every
  always-mounted tab, discarding hydrated domain state and unsaved health-data
  input before success is reported. If a post-sign-out or post-account-delete
  wipe fails, Account exposes a standalone signed-out retry that does not
  require the deleted/revoked cloud identity. Storage mutations capture a
  generation when queued, so an autosave waiting behind a wipe cannot recreate
  the discarded data afterward.
  Startup-wide plus lazy migration encrypt legacy plaintext before replacing it;
  a failed migration leaves the recoverable plaintext in place and fails closed.
  The startup-wide scan runs its full `getAllKeys()` + per-key pass at most once
  per device: a plaintext marker key records completion, and every later cold
  start reads that one marker instead of re-scanning every `kilo_` key, since
  the per-key lazy migration path already covers anything written before the
  scan last completed and no write after it can ever reintroduce plaintext
  (#809). Device-key ownership is proven by a constant-time canary
  (`kilo_device_key_check_v1`: a fixed plaintext sealed under the device key)
  rather than by decrypting every stored envelope on every launch (#1364).
  Legacy encrypted data without a canary gets the full #1177 envelope scan once,
  and the canary is written only after every envelope authenticates. A missing
  key with encrypted data never mints a replacement; a stale key or a malformed,
  tampered, or wrong-plaintext canary latches `DeviceKeyUnavailable` and blocks
  encrypting writes, and is never replaced or treated as absent. Transient read
  failures stay retryable. #1186 recovery commits the canary with the restored
  data under the same fresh key through the recovery journal; a confirmed wipe
  re-creates it under the new key, and `clearDeviceKey()` removes it before the
  key. A `kilo_` purge (account switch) also removes it, costing one rescan on
  the next launch. `updateItem(key, transform)` rewrites one value as a single serialized
  read-transform-write, so no other storage operation can land between its
  read and its write (#813); a writer that read earlier and writes a whole
  value later is a separate matter, which is why every notebook and
  workout-notes-queue write path also strips the purged field itself.
  `getItem()` coalesces concurrent reads of the same key onto one in-flight
  read, so a value is decrypted once no matter how many mounted consumers ask
  for it at the same moment (#818). A pending read is shared only with callers
  that arrived before any operation that could change that key was enqueued:
  `setItem`/`removeItem`/`updateItem`/`multiSet`/`multiRemove` drop the pending
  entry for the keys they touch, and `clearDeviceKey`/`wipeKiloData` drop all
  of them, at enqueue time rather than at execution time. A read is likewise
  bound at enqueue time to exactly the writes already enqueued when its caller
  asked, and concurrent readers touch strictly disjoint keys (coalescing allows
  at most one in-flight read per key), so a coalesced caller still always
  receives exactly the value its own read would have returned from the same
  position in the old FIFO. The one-time
  plaintext migration deliberately does not invalidate: it re-encodes values
  that are already there and cannot change what any key decrypts to. Web
  retains browser storage semantics, where client-side key storage would not
  provide an independent security boundary.
- `mobile/components/` holds reusable shell and UI primitives
- `mobile/screens/MoreScreen.js` owns the More-tab routing shell. Help, About,
  Backup, Settings, and Profile sub-screens are extracted to individual files in
  `mobile/components/` (`HelpScreen.js`, `AboutScreen.js`, `BackupScreen.js`,
  `SettingsScreen.js`, `ProfileScreen.js`); `MoreScreen.js` imports and renders
  them. Account and AccountLifecycle remain in `mobile/screens/more/`. The
  screen routes to server-side account export and two-step deletion calls that
  stay behind Supabase Edge Functions rather than exposing privileged credentials
  to the client, leaving `HomeScreen.js` focused on dashboard rendering. The
  same public-account surfaces expose published privacy and terms links beside
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
  `useTrackedLifts()` hook consumed by both Log and Analytics. On mount,
  `useWeightEntries`/`useWorkoutNotes` read on-device storage immediately and
  do not wait on the initial cloud sync: `maybeSyncCloud()` still runs, but in
  the background, so first paint reflects the local cache rather than a
  network round trip (#809), and the follow-up read happens only when a pass
  actually ran (#813). Every later reload — a write, a broadcast, or an
  explicit `refresh()` call — keeps the ordinary sync-then-reload sequence,
  with concurrent callers sharing passes rather than each running one.
  All five tabs mount at once (#527), so several instances of these hooks
  hydrate from the same keys in one synchronous burst on cold start; each
  instance still owns its own read call, but the storage boundary's read
  coalescing above collapses them into one decrypt per key (#818). That also
  fixes their order: React runs child effects before the parent's, so the
  shell's own `useWeightEntries`/`useWorkoutNotes` reads — the two Home's
  `loading` prop is gated on — used to be enqueued behind every duplicate the
  four hidden tabs had already queued, and now land on the read a tab already
  started. The eight distinct keys Home's four-term first-paint gate depends on
  (weight goal, tracked lifts, tracked-lift activations, recovery blocks,
  recovery block weeks, notebook, current-routine pointer, weight table) are
  then issued as one overlapping batch rather than one after another (#984).
  Since #1366 the gate is local-first: `loading || goalLoading ||
  trackedLiftsLoading`, plus the bounded persisted Recovery read (LOADING until
  it lands), plus `!recoveryBoundaryReady` only when boundary-dependent
  aggregates would render (#699). Recovery journal replay is not a term. The
  shell holds background startup work during its first render
  (`holdStartupBackgroundWork` in `storage/entries/startupTiming.js`). Home
  claims the hold while rendering (`claimAppLocalReady`), which cancels the
  fallback timer, and releases it at `app:local-ready` — the gate above
  settling — or on unmount, so a slow hydration never times out into replay;
  the fallback only covers a shell whose Home never mounts, and neither it nor
  unmount counts as readiness. A failed bounded Recovery read renders unknown,
  so Home always reaches local-ready. Since #1372 the shell mounts the app
  beneath an opaque `AppStartupOverlay` (wordmark, barbell loader, one loading
  status) that hides the content from touch and accessibility; Home signals
  `AppLocalReadyContext` in the same effect that releases the hold, and the
  overlay unmounts immediately. That latch is one-way per shell instance, so
  only a cold launch or a device-wipe remount shows it. Until local-ready no mounted `useRecoveryBlockState` consumer — Home
  or the hidden Log/Analytics tabs — starts reconciliation, the automatic
  cloud sync sees auth as still loading, and the workout-reminder reconcile
  waits. The device-key canary probe (#1364) and the legacy migration stay
  ahead of paint as safety gates.
  Persisted Recovery repair and unresolved-record action gating are owned by
  [Recovery State](recovery-state.md#persisted-recovery-repair).
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
- `mobile/storage/entries.js` owns local reads/writes for recent-history
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
  fallback. Native reads and writes route through the encrypted storage boundary
  above; AsyncStorage remains its serialized backing store
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
prop-driven recomputation path.

Cross-screen handoffs use a typed navigation-intent contract rather than ad hoc
per-destination arguments. A request is `{ tab, target, key }`: callers pass the
tab and an optional target to `handleTabPress`, and the shell mints the
monotonic `key` itself. The target vocabulary is
`{ kind: 'section', id: 'weight' | 'strength' }` for Analytics,
`{ kind: 'note', noteId }` for Log, and `{ kind: 'subview', view, anchor? }` for
More. One exported normalizer in `App.js` validates target *shape* and the
tab/kind pairing only; each destination's internal vocabulary stays with the
destination, so `MoreScreen` — not the shell — decides which sub-view names are
real. Malformed, unknown-kind, and wrong-tab targets normalize away and the tab
press proceeds unchanged. The shell keeps one independent (target, key) pair per
destination and advances a key only for an intent that addresses that
destination, so ordinary navigation never invalidates another tab's memoized
tree. An absent target preserves the destination's current internal state; a
later key re-applies an identical target; each destination consumes a key
exactly once. Log's note target is set-only: the shell says which note to show
and never reads or owns Log's editor state, so `LogScreen` itself decides the
current/loading/missing/editing outcomes and announces its refusals. Because
Log's Routine and Deload views are mutually exclusive and render disjoint sets
of notes off one shared viewer id, consuming a note intent also selects the view
that owns the resolved note. Absence counts as "deleted" only after a successful
read: while the note list is loading or a read has failed, the intent stays
pending so the existing Retry can still fulfill it.

Cloud sync status is a shell-owned subscription, not a per-tab one (#737).
Because all five tabs stay mounted, a screen-level `useCloudSyncStatus()` would
mean five permanent subscriptions and five duplicate dirty-queue scans on every
phase or queue broadcast. `App.js` calls the hook once and publishes
`{ summary, retrySync, openCloudSync }` through `CloudSyncContext`
(`mobile/hooks/useEntries.js`); screens read it with `useCloudSyncSummary()` and
never subscribe. Outside the provider the context is `null`, which consumers
treat as "no summary was published" and render no sync surface at all. The
summary derives at most one notice — `failed` or `pending`, with a running pass
suppressing both so a stale failure never outlives the retry it asks for — and
its copy describes the local queue only; Kilo does no connectivity detection, so
nothing in it claims a connection or an in-flight request. `openCloudSync` is an
ordinary typed intent (`CLOUD_SYNC_NAV_TARGET`, exported from `App.js`) rather
than a bespoke route, so a repeated request re-applies under a later key like
any other, and `retrySync` binds the same `useSyncRecovery` runner the Cloud
Sync panel's own Retry uses — no second sync path exists.

Loading, failure, and verified-empty are distinct outcomes on every mounted
surface (#737). Home, Log, and Weight paint static (non-animated) placeholder
cards while a first read is unresolved, and Home, Log, Weight, and Analytics
surface a retry banner when a read fails. This matters because the entry hooks
clear `loading` on failure and leave their collection empty, making a failed
read byte-identical to a genuinely empty account: every screen therefore
requires a *successful* read before it may render onboarding/empty copy or a
zeroed dashboard, and withholds derived sections it cannot honestly compute.
A failed read that still has cached data keeps rendering it under the banner.

Failure state is per read source, not per screen: Weight raises one banner for
the weigh-in read and one for the goal read, each retrying only its own source,
and Home folds its two locally-owned reads (`useWeightGoal`, `useTrackedLifts`)
in with the shell's weight/note reads behind one retry that re-runs all of them.
`useWeightGoal` was the last read hook without an `error`/`refresh` pair; it now
matches `useWeightEntries` and `useTrackedLifts`, and a failed refresh keeps the
previously loaded value rather than reverting to null. Writes never clear
`error` themselves — `notifyGoal()` re-runs the read, and that read decides.

Across every read hook in `hooks/entries`, `error` is cleared **only by a read
that succeeds**, never on the way into one. Clearing it eagerly reopened the
exact hole these states close: after a first failure the hook already sits at
`loading: false` with an empty collection, so dropping `error` at the start of a
retry left `{ empty, not loading, no error }` — a verified-empty signature — for
the whole duration of the retry read, and the screen fell back to its
onboarding/no-data rendering mid-recovery. The last completed read stays the
truth until a new one replaces it, so a retry holds the failure until it
resolves and a retry that fails again does not flicker.

That contract reaches the storage layer through a second, additive reader.
`loadWeightGoal()` in `storage/entries/weightGoal.js` catches its own errors and
resolves `null`, which collapses "unreadable record" into "no goal set" — and it
has to keep doing so, because `syncAdapter` (`buildWeightGoalRecords`,
`applyWeightGoal`), `bootstrap`, `exportBackup`, and `localAdapter` all await it
and are not written to survive a rejection; making it throw would let a corrupt
goal record fail a sync pass or an export. So the honest signal is a separate
`loadWeightGoalResult()` returning `{ ok, goal, error }`, which never rejects
either: `ok: false` is a failed read and `ok: true` with `goal: null` is a
verified absence. `useWeightGoal` reads through it; every sync/bootstrap/export
caller keeps the unchanged `loadWeightGoal()`. New UI reads that must tell
failure from absence should use the result variant.

For nested navigation, `App.js` exposes one
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

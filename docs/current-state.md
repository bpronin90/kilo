# Current State

This document is the single source of truth for what Kilo currently is, what is
implemented for MVP, what remains uncertain, and what manual validation status
has been reached for the current launch-review path.

---

## What Kilo Is Right Now

Kilo is a single-path native app:

- `mobile/` is the active Expo/React Native app with local-only persistence via
  AsyncStorage-backed modules under `mobile/storage/`.
- The legacy browser prototype (`Kilo.html`, `src/`, `tests/`) is archived under
  `docs/archive/browser-prototype/`. The Capacitor Android shell and vitest
  config have been removed (issue #213).

There is no running app server. As of `0.70.0` the backend foundation landed on
`main` — the note-first `kilo` Supabase schema and RLS (#316), the auth/session
client (#317), and the storage-seam cloud adapter (#318). The `kilo` schema has
since been applied to and exposed in the shared Supabase project
(`anime-streaming-tracker`). The app activates cloud mode only when
`EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` are provided (e.g. a
local gitignored `mobile/.env`); with no env config it runs entirely on
AsyncStorage, and signed-out users stay local-only either way.

As of issue #367, the active mobile runtime is Expo SDK 56 with React Native
0.85.x and React 19.2.x. The SDK upgrade cleared the `postcss` and `js-yaml`
moderate dependency advisories that were tied to the previous Expo/Jest
dependency graph; the remaining moderate `uuid` advisory is intentionally
tracked as separate dev-tooling work. Because SDK 56 changes the native runtime,
shipping this upgrade requires fresh Android/iOS native builds; OTA/EAS Update
cannot move installed SDK-54 builds onto SDK 56.

Roadmap status:

- MVP4.0 through MVP4.5 are complete roadmap passes. Their roadmap documents
  are archived under `docs/archive/`.
- The MVP-Refine pass (`docs/mvp-refine-roadmap.md`) ran after MVP4.5 and is
  also complete.
- `docs/mvp-v4.5-roadmap.md` tracks the cumulative state of the app through
  the end of the MVP4.5 pass and remains as a reference document.
- `docs/backend-roadmap.md` is the active public self-serve planning roadmap.
  It sequences the `backend-v1` issue series (#310-#324) for moving from
  local-only personal use to a web-first Supabase product while preserving the
  current note-first workout model and local daily-use path between cards. The
  public-account lifecycle slice now includes server-owned requester-only export
  and deletion (#322), conservative account lifecycle endpoint throttles (#328),
  published privacy/terms links on the signup, account lifecycle, and About
  Kilo surfaces (#330, #332), and the documented Auth abuse posture gate for
  CAPTCHA plus production SMTP before open signup (#329). The web distribution
  surface now also offers GitHub OAuth sign-in alongside email/password behind
  cloud config (#331). Installed Android builds expose the same provider through
  the stable `kilo://auth/callback` deep link and a PKCE browser session (#363).
  The Account screen suppresses the signed-out form while the persisted session
  restore probe is in flight, so returning signed-in users no longer see a
  transient sign-in flash on cold start (#365), and Account now consumes the
  app-shell auth session instead of re-probing on each entry, so a resolved
  signed-in session renders immediately when the screen opens (#366). The
  redirect is allow-listed in Supabase; the first installed-build callback and
  restart-persistence pass remains deferred by owner direction.

The prototype is a seeded fitness-logging app with approximately 221 synthetic
workout sessions and bodyweight entries used as history scaffolding. User-created
entries are layered on top of this seed through the app's local persistence
path.

The native Expo app exposes five tabs: Home, Log, Weight, Analytics, and More.

For physical-device packaging:
   - `cd mobile`
   - `eas build --platform android --profile preview`
   - Install the resulting APK on the phone
   - After a compatible Android build is installed, publish OTA-safe JS and
     asset updates with `npm --prefix mobile run update:android:preview`
   - iOS preview builds (`ios-simulator`, `ios-device`) are bound to the same
     `preview` channel; publish iOS OTA updates with
     `npm --prefix mobile run update:ios:preview`. Live on-device iOS delivery
     is not yet verified end to end (deferred pending an iOS build, issue #63).
   - The preview runtime boundary is a stable manual string (`preview-1`)
     set in `mobile/app.config.js` when `APP_ENV=preview`. OTA updates apply
     to any installed preview build sharing that runtime string. App version
     bumps do not create a new OTA boundary. A new native build is required
     only when: a native module changes, a native `app.json` field changes, or
     `PREVIEW_RUNTIME` in `mobile/app.config.js` is deliberately bumped.
     Production builds continue to use `runtimeVersion.policy: "appVersion"`.

The shipped prototype branding now uses the approved Direction 3 Kilo mark and
wordmark treatment in the main Home header and the More screen footer instead of
plain text-only product naming. The native Expo path now uses a quieter shared
header treatment: no-title screens render a plain `Kilo` text title with a
low-emphasis `vX.Y.Z` version label derived from `mobile/package.json`, rather
than shared logo/wordmark header branding or an alpha badge.

The native app path is not yet a feature-complete port. It now proves that Kilo
can run as a real React Native app with native screens, native parser/data
modules, and local persistence instead of a WebView wrapper. The two app paths
still differ in surface area, but their active parsing and derived-analytics
rules now come from the same shared domain logic.

---

## Native Migration Contract

Issue #35 establishes the migration boundary from prototype-wrapper to native
app:

- `mobile/` is the only path that should receive forward-looking app
  architecture work.
- The former repo-root browser prototype has been archived under
  `docs/archive/browser-prototype/` and is no longer part of the active app
  runtime or test path.
- No new product behavior should depend on embedding the prototype inside the
  native app.
- The first implementation split is:
  - UI migration in issue #36
  - Parser and local data-model migration in issue #37

The current `mobile/` scaffold is intentionally narrow. It is a branch-off base
for implementation agents, not a claim that the native MVP is already complete.

## First Native MVP Milestone

The first native MVP milestone is reached when all of the following are true in
`mobile/`:

1. The app has real native Home, Log, Weight, Analytics, and More surfaces.
2. Weight entries can be created locally, stored locally, and shown again in a
   recent-history view.
3. Workout entries can be created locally, stored locally, and shown again in a
   recent-history view.
4. Parser and storage code used by the MVP loop live in `mobile/`, not in the
   legacy browser-runtime path.
5. The native UI consumes parser/storage behavior through explicit local module
   boundaries instead of screen-local ad hoc state.

This milestone does not require Supabase, sync, account work, or deletion of the
legacy prototype path.

---

## MVP Surface — What Is Implemented

### Native UI shell (`mobile/`)

The real native app path now has a modular React Native shell:

- `mobile/App.js` owns tab state, routes weight saves through the canonical
  parser path, routes workout saves through the current-workout path in the
  multi-note workout store, now keeps Android hardware-back inside the app by returning
  non-Home tabs to Home and gating root exit behind confirmation, keeps the
  Kilo fatigue multiplier in app state for deterministic Analytics
  recomputation, and exposes a separate More tab for Profile, Account, Settings,
  local Data & Backup export/import/recovery, Help, and About
- `mobile/screens/HomeScreen.js` renders a native dashboard with a resolution-
  independent Kilo wordmark header drawn as an inline `react-native-svg`
  component (`KiloWordmark`, sourced from `src/assets/brand/home-title.svg`)
  and sentence-case `Current routine progress.` subtitle. The screen uses a
  first-run/steady-state split: when the user has no weight history, no saved
  workout notes, and no active draft workout note, Home now renders a welcome
  onboarding card with `Log Workout` and `Log Weight` CTA buttons plus short
  guidance for the two starter flows; otherwise it renders the established
  three-panel hierarchy of a Weekly Summary hero card, a conditional Weight
  Goal card, and a 1K Club Progress card. The steady-state hero card contains
  an inline week label, a dominant 48px latest-weight value (the only
  accent-colored text element on the screen besides the wordmark), a full-
  width 7-day sparkline strip, and a separated classification section labeled
  `Exercise Progress` with three semantic color dots (green/yellow/red) for
  live `Progressing`, `Steady`, and `Regressing` overload counts mirrored from
  the current Analytics row contract, and a quiet `Full history and insights`
  link into Analytics. The Home cards now share a consistent 24px internal
  padding baseline while preserving the intentional visual hierarchy between
  the hero, goal, and 1K sections. The Weight Goal card renders only when a goal is set
  (`dashboardData.goalInfo !== null`) and now uses a `Goal: Bulking` /
  `Cutting` / `Maintaining` heading row with the mode word accent-emphasized,
  separate Target and Pace stat columns, and semantic pace coloring driven by
  `goalInfo.warnings` (`unrealistic` = error, `unhealthy` = caution, otherwise
  success) while showing weeks remaining only for active goals and a stable
  `Goal ended` state for overdue ones. The 1K card now uses a centered
  `1K Progress` label and total, keeps the shared progress bar plus three-column
  breakdown with full exercise names (Squats/Bench/Deadlifts) matching the
  canonical structure on Analytics, and adds progress-based hero-number color
  emphasis as the total approaches 1,000 lb. Its headline value now comes
  directly from the same shared session-ordinal Big-3 series contract used by
  Analytics, so the Home total reflects the latest complete aligned workout
  cycle rather than a sticky per-occurrence PR or a mixed-cycle fallback. All
  dashboard data comes from existing shared derivation functions; no Home-only
  calculations exist. The success toast is removed from the render
- `mobile/screens/LogScreen.js` renders a native workout-note authoring flow
  centered on the selected current routine, with read/edit modes, a formatted
  mirror of the canonical note that always renders day/section/exercise blocks
  faithful to the raw text while collapsing same-day warmup and lifting
  sections under one weekday heading, parsed exercise tracking toggles in read
  mode that now persist a global tracked-lift map keyed by normalized
  exercise name, inline `—` skip markers for bare `-` lines, the current
  routine rendered as a title-first card whose header row toggles a persisted
  collapsed/expanded state (`kilo_log_current_collapsed`, surviving tab
  navigation and app restarts) with a small muted `Double-tap to edit` helper
  line at the top of the expanded current-note body, an explicit `Edit`
  button in the current routine card header row (using the same
  `inlineSwitchButton` style as the `Set Current` button on other routine
  cards), and a double-tap on the rendered note body as an alternative
  edit affordance, where the rendered body remains scroll-first and supports
  partial text selection, and where entering raw edit from a scrolled rendered
  note keeps the editor aligned to that same approximate scroll position.
  Current routines can now also embed alternating A/B weeks inside one raw note
  by separating the weeks with a standalone `---` line. When present, Log shows
  a persisted manual `Week A`/`Week B` toggle in the current-routine header,
  renders and edits only the active week's text in the editor while preserving
  the full note on save, and keeps progression continuity shared across both
  weeks because the underlying analytics still derive from the full note by
  exercise name.
  Existing saved routines now autosave raw-note edits through the current
  workout-note store with an 800 ms debounce plus an immediate `Done` flush,
  while stale-result guards prevent in-flight saves from overwriting newer
  typing or cross-routine switches; only never-saved routines still keep an
  explicit `Save` button because autosave does not begin until a storage id
  exists. Existing-note editors no longer flash a visible success notice during
  debounce-driven autosave, but still preserve the muted transient `Saved!`
  confirmation for explicit user-triggered saves; leaving an editor via `Done`
  or Android back now saves and exits even for a never-saved new routine rather
  than trapping the user behind a discard-only path, while existing notes save
  and exit without the old save/discard prompt, including the past-deload edit
  path when a debounced autosave is already in flight. For the current routine
  specifically, exiting raw edit now returns consistently to the top of the
  rendered note as the accepted fallback behavior. The editor now pairs the
  `Done` action with a visible `Undo` action that restores
  only the note currently being edited to its pre-edit-session state, including
  linked editable deload metadata for note-backed past deload records. This is
  a best-effort local-persistence undo on the current AsyncStorage-backed model;
  true atomic cross-record undo guarantees remain deferred until the app has an
  underlying transactional database layer. A bottom `More Routines` list keeps each
  non-current routine collapsed to a compact row that now expands inline in
  place rather than jumping to a dedicated full-screen reader; the expanded
  view reuses the same rendered-note body and double-tap-to-edit affordance as
  the current routine and keeps inline `Set as current routine`, `Edit
  routine`, and `Delete routine` actions inside the expanded card. Routine
  create/rename/delete controls still keep confirmation and current-selection
  cleanup guardrails; switching the current workout now requires explicit
  confirmation, offers a save-and-switch or switch-anyway choice when there are
  unsaved edits, and when the destination routine shares exercise names with
  the current one it now asks once whether to carry over matching 1K exercise
  slot selections before completing the switch. The same screen now also
  includes a `Routine | Deload` segmented toggle so the user can switch
  between the canonical routine note and a separate generated deload note. The
  Deload view reads and writes only the separate deload-note storage path,
  shows a clear empty state before generation, confirms before regenerate
  overwrite, reuses the existing rendered-note and raw-edit UX, and now shapes
  generated deload source text into routine-style editable blocks with blank
  line day separation plus explicit `+Lifting` section markers before
  persistence so the raw editor is comfortable to use while the rendered view
  stays parser-compatible. When an active deload note exists the Deload tab now
  shows a `Deload complete` action that archives the note (capturing the current
  session count) behind a confirm dialog, dual-writes that completion into the
  workout-notes store as a dated `Deload · YYYY-MM-DD` note, and renders a
  `Past deloads` list that now splits behavior by record type: note-backed
  deloads expand inline in place like saved routines, expose inline edit/delete
  affordances, and delete from both stores together, while pre-#257
  history-only deloads remain visible as read-only inline expandable cards with
  history-only delete. A persisted `Edit deload dates` toggle under More >
  Settings optionally exposes a date picker while editing note-backed past
  deloads; when enabled, changing the date now updates both the workout-note
  `saved_at` date and the linked deload-history `completed_at` date so the
  editor and analytics stay in sync, while legacy note-backed deloads without a
  linked history row keep the date field read-only. The edit path still
  preserves the `Deload · ` title prefix invariant so deload records cannot
  silently reclassify into normal routines.
  Deleting any past deload recomputes the sessions-since-deload clock off the
  remaining history (resetting to the absolute session count when none remain). The read view now also
  routes parsed `SetLine` rows plus fallback unparsed/skip rows through one
  shared set-row typography token so Log-tab rows render at a uniform size
  without the earlier stray italics, while unresolved lifting fallbacks render
  in error red and warmup/non-lifting fallbacks stay standard text, and bare
  `-` skipped-week markers now stay interleaved with logged rows in their
  original chronological slots across all clean note views (current routine,
  expanded more-routines notes, and deload notes) instead of drifting into a
  clustered skip block; bare rows that fail to parse (e.g. an incomplete weight
  entry with no reps) also render in their chronological position between skip
  groups rather than being displaced to the bottom of the exercise block. The same
  save path now also persists workout-note `skip_markers`
  (`exercise_skips` plus `day_skips`) and derived `attendance_flags`, so
  downstream analytics consumers read stored skip/attendance state instead of
  recomputing it during render. Native workout-note documents now also persist
  `session_checkins` keyed by session index so fatigue check-ins survive
  reloads. When the user leaves the current-routine editor via `Done`, Android
  back, or switching away from the Log tab after a rough detected session, the
  same Log flow now re-runs the session check-in detector against the current
  note only, highlights exactly the flagged exercises in red in the rendered
  routine view, opens a centered
  `SessionCheckInModal` with a detector-aware title plus flagged exercise names
  where available, and persists either an `I'm okay`, `Not great`, or
  explicit dismissed/pending (`status: null`) state back onto that session
  index. Backdrop taps and Android modal close defer without writing
  `session_checkins`, so the same session can be rechecked after the next
  relevant edit/save/close decision point. The highlight and modal prompt both
  suppress once a matching `session_checkins[sessionIndex]` entry exists. The
  old `rep_drop_off_flags` surface is no longer populated or consumed. The
  legacy `hit_wall` chip/badge and its helper reads are removed from Log and
  Analytics, and within-row skipped sets
  now render in structured read mode as `-` at their original weight
  (`80 4,-` → `80 lb 4, -`); Android back now exits edit subviews before
  falling through to tab-level navigation.
  A fresh install with no
  logged routines now renders a dedicated `LogEmptyState` surface — short
  explanatory copy, a `New Routine` primary action, and an example-format card
  — instead of auto-opening the editor or keyboard, and that empty state is
  gated on the workout-note load so existing users do not see it flash before
  their routine appears. A failed workout-note load now surfaces a retryable
  `ErrorBanner` above the read view instead of a silent empty screen, and a
  successful Retry clears the banner.
- `mobile/screens/WeightScreen.js` renders native weight/note inputs plus
  direct history edit/delete controls for saved weight entries, including a
  persisted opt-in date-edit path controlled from More > Settings: when the
  `Edit weigh-in dates` toggle is on, both the new-entry form and the
  existing-entry edit form expose an inline date picker capped at the local
  calendar day, and those native picker changes now apply correctly on
  physical devices through the canonical `DateTimePicker` `onChange`
  callback; new entries splice the chosen date onto the current
  time-of-day, and edited entries preserve their original time-of-day while
  re-sorting history by `logged_at`, plus a
  denser history row treatment with per-entry delta badges for notable
  (`> 1.5 lb`), spike (`> 2.3 lb`), and outlier (`> 3.5 lb`) changes, where
  active loss/gain goals suppress those warning colors when the delta moves in
  the target direction while maintain/no-goal states keep the symmetrical
  threshold treatment, MM-DD-YYYY display dates for visible weight-history
  rows while stored timestamps remain ISO, and a prominent top-level goal card
  with a native target-date picker,
  MM-DD-YYYY visible goal-date formatting, `Target` and `By Date` as the
  primary anchors, and row-based derived guidance for `Target pace` plus
  advisory calorie guidance alongside warnings; when a complete stored user
  profile exists (`height_cm`, `date_of_birth`, `sex`, `activity_level`), the
  calorie row now shows an approximate TDEE-anchored daily target using the
  Mifflin-St Jeor BMR formula and activity multipliers, including maintenance
  targets. Without a complete profile, it falls back to the legacy estimated
  deficit/surplus helper. Maintain-goal fallback cases still render semantic
  maintenance guidance instead of gain/loss math, overdue or same-day-complete
  goals now render a terminal `Goal ended.` guidance state without negative
  weeks-left or invalid pace output, overdue ended goals expose the same
  archive action as met goals so the archived-history path can clear the active
  goal and reopen the new-goal form, the no-estimate state keeps the panel
  hierarchy visible with neutral fallback messaging for goals that still need a
  future target date, and when no
  saved weight entries exist the goal form still requires a current-weight
  fallback so the pace and calorie guidance can render from the saved goal
  state. Saved goals now render as a singular `Goal` section with a compact
  target card plus a separate `Guidance` card so the target values and derived
  pace/calorie guidance are easier to scan, and archived completed goals now
  appear in a compact conditional `Goal History` list beneath the active/new
  goal flow, ordered newest first with target weight, completed weight when
  available, target date, and archived date, with compact column headers and a
  collapse/expand control for scanning longer history. The Trends card now colors both
  pace-severity states and directional gain/loss cues instead of leaving the
  trend column uniformly neutral, and tapping a history row now scrolls back
  to the top editor as it loads the selected entry. The Weight tab now reads
  top-to-bottom as weight entry, `Goal`, optional `Goal History`, `Trends`, and `History`, with `Goal`
  / `Trends` using the shared section-heading treatment and a merged Trends card that
  now consumes the same canonical `deriveWeightGoalAnalytics()` output used by
  Home and Analytics for trend summary, pace severity, goal guidance, and
  calorie guidance, and
  surfaces `Pace`, `7-day rolling`, and `30-day rolling` rows with
  current-or-average value, prior-window comparison, and trend cue summaries
  derived from the day-level `date` key while History continues to display the
  recorded `logged_at` timestamp. The History panel now includes column
  headers, collapse/expand, and local All/30d/90d/6m date-range chips over the
  already loaded entries, without changing saved weight calculations or
  persistence. A failed weight-entry load now surfaces a
  retryable `ErrorBanner` at the top of the screen instead of a silent empty
  screen, and a successful Retry clears the banner.
- `mobile/screens/MoreScreen.js` now owns the native More menu plus the
  `User Profile`, `Account`, `Settings`, `Data & Backup`, `App Guide`, and
  `About Kilo` sub-screens extracted out of `HomeScreen.js`. When Supabase cloud
  accounts are configured and the user is signed in, the Account surface also
  exposes server-side account export and a two-step account deletion flow:
  export shares a v3-compatible JSON payload from the requester-scoped
  `account-export` Edge Function, and deletion calls `account-delete` before
  signing out and clearing local session state. Those More subviews
  intercept Android back presses and return to the More menu before falling
  through to tab-level navigation. The parent More menu groups six destinations
  into three balanced sections: `Profile & Account` (`User Profile`, `Account`),
  `Settings & Data` (`Settings`, `Data & Backup`), and `Help & Support`
  (`App Guide`, `About Kilo`). Redundant Log Workout and Log Weight quick actions
  are no longer shown there. The Settings screen groups its
  controls into `Features`, `Date Editing`, and `Advanced`: persisted
  `Fatigue tracking` and `Deload mode` switches let users disable those
  optional workout-side flows without deleting their saved check-ins, deload
  note, or deload history; `Edit weigh-in dates` governs whether the Weight
  tab exposes date controls for new and existing weigh-ins; `Edit deload
  dates` governs whether past deload records expose the opt-in date picker on
  the Log tab, with those date edits now applying correctly on physical
  devices; and the same screen keeps a persisted fatigue-multiplier
  stepper plus reset control. The
  `User Profile` sub-screen lets users optionally save or later clear the
  four TDEE-profile inputs stored by the shared user-profile contract:
  height with ft/in or cm entry mapped to persisted `height_cm`, date of
  birth, biological sex, and one of five activity-level choices with helper
  descriptions. The flow stays local-only, allows partial profiles, and
  surfaces explicit save feedback plus clear-state controls rather than
  forcing onboarding or a fully populated profile
- `mobile/screens/AnalyticsScreen.js` now renders a native analytics surface with
  a compact weight-trends card that highlights the latest weigh-in, corrected
  pace warning, separate labeled `7-day rolling average` and `30-day rolling
  average` charts, and 7-day/30-day summary averages. Selecting a prior chart
  point updates the card's top summary and footer averages to that selected
  date until the selection is cleared. The screen also includes a merged
  `Fatigue` parent section. That section contains a
  `Routine Health` sessions-status panel — a three-zone gauge (`Building` /
  `Approaching` / `Deload`) driven entirely by session-ordinal data. Newly
  completed deloads now persist a user-confirmed `deload_session_ordinal`
  prefilled from the current routine's inferred pre-deload session count,
  mark that ordinal as count-semantic, and remain editable before
  confirmation; legacy first-post-deload ordinal records and records that only
  have `session_count` remain compatible through normalized deload-boundary
  comparison. On the Analytics surface, `sessions since deload` and
  `sessions logged` are the only routine-status metrics shown; no calendar
  metrics appear in this panel. Archived deload records completed before the
  current routine's `saved_at` start are excluded from that routine-status
  derivation so prior-routine deloads cannot inflate the current routine's
  total or anchor its deload-relative clock. The gauge marker, zone labels,
  and caption always render, while `Deload mode` hides only the `Since deload`
  stat. The same parent section contains a `Fatigue Tracking` panel backed by
  persisted `session_checkins`. The parent title now stays statically
  `Fatigue`; turning fatigue tracking off hides only the fatigue panel and its
  Analytics edit path. The redesigned `1K
  Progress` card now keeps the hero total and progress bar, full breakdown
  labels (Squats/Bench/Deadlifts), and adds a `1K total over sessions` chart
  driven by a shared per-session Big-3 derivation across all synced workout
  notes, so newly synced historical/current note sessions are included when
  they form complete aligned Big-3 cycles. Selecting a prior 1K chart point
  updates the 1K Progress hero total, progress bar, and squat/bench/deadlift
  breakdown to that selected session while the unselected card falls back to
  the latest complete session. The Big 3 Mapping panel is now
  collapsible so the selection rows can be hidden while keeping the mapping
  context available. The screen now also includes
  a fatigue-tracking panel that stays collapsed by default into a signal-first
  summary row highlighting the most common rough reason when available and an
  unanswered-count alert when pending check-ins exist. Expanding the panel
  reveals `Not great`, `All good`, and conditional `Unanswered` groups with
  stable calendar-day formatting from `responded_at`; rough entries render as
  quieter callout rows with reasons plus non-zero skipped/volume-drop stats,
  while ok/pending entries collapse into date chips to reduce scan noise.
  Every fatigue entry still exposes an Analytics-side edit path that reopens
  the check-in modal against the original session record. Editing an existing
  entry hydrates its saved status/reasons/note, preserves the original
  `responded_at` timestamp, and lets unanswered dismissals be completed later
  without reordering history.
  Shared chart surfaces now also expose a tapped-point readout without breaking
  existing callers. The screen still uses an artisanal-panel strength
  container, strength-only 1k slot selection, and a `Progressive Overload`
  section with routine-day grouping, collapsible group headers, search
  filtering, and a tabular two-line row layout (exercise name + 4-column
  metric grid: `1RM`, `Kilo`, `Best`, `Trend`).
  Non-weighted exercises (reps-only or time-based) render with a minimal
  sub-layout showing `Avg` and `Best` metrics (average reps/hold per set
  and highest single-set value) with inline labels, plus a PO arrow
  trending on average progression (`↔` steady, `↑`/`↓` improving/declining,
  `—` when fewer than two sessions are logged).
  Multi-day exercises appear in each relevant group and now render their row
  metrics from the matching per-day signal payload for that weekday slot
  (`latest_pr`, `latest_top_weight`, `overload_trend`, `is_bodyweight`) while
  the inline cross-day comparison chips summarize the other day-specific
  values. Trend arrows use MaterialIcons for up/down plus a text `↔` steady
  marker with semantic color mapping (`Colors.success`, `Colors.caution`,
  `Colors.error`), alias variants resolve through canonical exercise-name
  mapping, and plain note rows now count as separate comparable sessions for
  progression derivation. It now uses the shared `ScreenShell` component for a
  consistent layout and safe-area handling across all analytics sections. Its
  weight summary card now reads the displayed latest weigh-in, pace flag, and
  rolling-series chart data from the same canonical
  `deriveWeightGoalAnalytics()` path used by Home and Weight, so backdated or
  out-of-order weight entries resolve consistently across all three native
  consumers.
  The list now keeps per-exercise session classifications persisted on note
  save (`Initial`, `Progressing`, `Stalled`, `Inconsistent`, `Regressing`),
  parses workout-note sections once per render path, routes visible lift
  signals plus exercise display casing through the shared
  `deriveWorkoutNoteAnalytics()` layer used by the broader workout analytics
  contract, surfaces estimated 1RM and Kilo max together,
  shows either latest top weight in pounds or best-set reps for bodyweight
  exercises, renders the trend column as `↑`, `↔`, `↓`, or `—` based on the
  latest comparable session pair, and no longer shows the old `⚠ Hit wall`
  rep-drop-off badge surface.
  Its mount-time entry state is now stabilized so Analytics no longer visibly
  flashes on entry, section loading placeholders stay scoped to the data each
  section actually needs, and incomplete weight rows are filtered before they
  reach the rolling-average path
- `mobile/components/` contains shared shell, tab bar, and UI primitives; the
  shared bottom tab bar now uses the lighter card/chip palette instead of the
  older heavy dark floating treatment so it reads as lower-emphasis chrome
  while keeping the active tab easy to distinguish, and it now behaves like a
  content-aware overlay by fading toward transparency during shared-shell
  scrolling, restoring a solid treatment during direct interaction, and then
  settling back after a short timeout
- `mobile/assets/brand/` contains the bundled native logo and wordmark assets
- `mobile/theme/colors.js` centralizes the native color system
- `mobile/lib/parser.js` ports the MVP canonical parser path into native ES
  modules and now also includes tolerant workout-note parsing for the archived
  sample-style shorthand logs used by the v2 note-based workflow plus a
  derived analytics contract for later note-based UI and analytics work,
  including tracked-exercise estimated-PR derivation from parsed sets,
  positional session-alignment derivation for long-note imports, stable
  same-day section headings so warmup and lifting blocks can render under one
  calendar-day heading in the Log view, and normalization for the recurring
  mixed-load shorthand, leading flag prefixes, and parseable inline-tail row
  segments evidenced in the archived workout-note samples. Progression and
  per-day signal derivation now share one comparable-building helper, and the
  module also exports `normalizeExerciseKey()` so alias resolution and
  lowercased key matching follow the same canonical chain everywhere
- `mobile/lib/data.js` defines the native exercise catalog and entry factories,
  including the default 1k exercise-slot selection used by analytics, a
  factory for titled workout-note items in the multi-note model, and
  per-session derivation for non-weighted tracked exercises covering
  reps-only (`total_reps` + arrow) and time-based (`longest_hold` + arrow)
  exercise classes with loaded-bodyweight exclusion
- `mobile/hooks/useEntries.js` exposes the native read/write APIs used by the
  UI, including multi-note current-workout reads/writes, cross-consumer
  refresh fanout, persisted weight-goal reads/writes, and a separate
  `useDeloadNote()` hook for the generated/editable deload note, plus a
  shared `useFeatureToggles()` hook that fans persisted fatigue/deload toggle
  changes live to Settings, Log, and Analytics without threading new props
  through `App.js`
- `mobile/storage/entries.js` persists weight entries plus a local-only
  multi-note workout model via AsyncStorage: `kilo_workout_notes` stores
  multiple titled workout notes, `kilo_current_workout_id` stores the explicit
  current selection, and persisted note items now carry an `isCurrent` flag
  alongside the retained `tracked_exercises`, `one_k_exercises`,
  `skip_markers`, `attendance_flags`, `exercise_classifications`, and
  `session_checkins` fields. Legacy notes may still contain old
  `rep_drop_off_flags`, but the active save pipeline no longer writes that
  surface. It also
  persists a lightweight
  active weight-goal record under `kilo_weight_goal` with `target_weight`,
  `target_date`, optional `start_weight`, and `saved_at`, plus archived
  completed weight goals under `kilo_archived_weight_goals` so completed
  goals can clear the active-goal analytics path without losing history. It
  also persists a Kilo fatigue multiplier under `kilo_fatigue_multiplier`, a separate
  weight-date-edit setting under `kilo_weight_date_edit_enabled`, separate
  fatigue-tracking and deload-mode feature toggles under
  `kilo_fatigue_tracking_enabled` and `kilo_deload_mode_enabled`, a separate
  deload-date-edit setting under `kilo_deload_date_edit_enabled`, a separate
  deload-note record under `kilo_workout_deload_note`, a completed
  deload history under `kilo_workout_deload_history`, note-backed completed
  deload records in `kilo_workout_notes` linked from history via `note_id`, a global
  tracked-lift map under `kilo_tracked_lifts`, and the Log-tab
  current-routine collapsed state under `kilo_log_current_collapsed`. The
  legacy structured
  workout-session key is retained only as a one-time migration source, and the
  older
  single-note key is now also migrated forward into the notebook model by
  synthesizing a `Routine 1` current entry. The local Data & Backup recovery
  path now exports a versioned v3 snapshot (weight entries, workout notes,
  current workout id, optional active weight goal, archived completed weight
  goals, optional fatigue multiplier, and completed deload history),
  validates that payload before
  any write, restores the full multi-note model plus weight goal, fatigue
  multiplier, and deload history on v2/v3 import, and still accepts older v1
  backups to restore weight history without wiping the newer workout-note state.
  The export action now shows a blocking "export is unencrypted" confirmation
  before sharing, and the cloud export omits the signed-in account email by
  default (it is included only in the dedicated cloud-recovery identity flow),
  and both import and parse paths reject oversized untrusted input

This path is no longer UI-only. Weight saves run through `parseWeightEntry()`
before persistence, and the native Log flow now saves through the current item
in a local multi-note workout store instead of requiring a structured
title-and-detail workout entry form. Saved native weight entries, workout note
items, and the selected current workout all reload across app restarts through
the native hook/storage layer. The native app shell now owns the stable
top/bottom safe-area boundaries in `mobile/App.js`, with an Android-aware top
cap for the status bar/notch and an absolute bottom safe-area wrapper for the
tab bar, while `ScreenShell` standardizes the in-screen content padding and
header layout used across Home, Log, Weight, Analytics, and More/Help. Its
no-title header state now uses a plain text `Kilo` title plus a quiet
`vX.Y.Z` version label instead of the heavier logo/wordmark-and-badge
treatment. The
native Log and Weight flows now keep save actions responsive on the first tap
even with the keyboard visible, guard against duplicate in-flight saves, and
keep the bottom tab bar reachable above the iOS keyboard. Successful native
weight saves now keep the user on the Weight screen instead of bouncing them
back to Home. Android hardware-back now stays inside the native app flow:
non-Home tabs return to Home first, the More and Log screens pop their own
subviews before yielding, a second back from the More menu returns Home, and
the Home root shows an exit confirmation.
The native Weight screen now also lets the user reopen saved entries from a
denser scannable history list, correct them in place, delete mistakes from
inline row affordances, and immediately refresh the shared weight views after
AsyncStorage updates. Each saved row also surfaces the change versus the next
older weigh-in with visual severity cues for notable, spike, and outlier
movement. The native Log flow now also supports creating additional routine
notes, renaming existing routines, and deleting routines with confirmation
while clearing the persisted current-routine pointer when the active routine is
removed. It also now derives 7-day and 30-day rolling averages plus fast
gain/loss pace flags from saved entries, and shows that trend feedback on
both the Weight and Analytics screens with shared threshold bands: sub-`1.5 lb`
daily deltas stay unflagged, `1.5-2.2 lb` changes render as notable
yellow/amber warnings, and `>= 2.3 lb` changes render as red spike warnings,
with Weight-history goal-aware suppression when a saved gain/loss target makes
that direction intentional.
The native Weight screen now also supports
a lightweight saved goal with target weight and target date, derives gain,
loss, or maintain direction plus required weekly pace from the latest saved
weight entry, surfaces unrealistic or unhealthy pace warnings as advisory-only
feedback rather than hard validation, and now stores an optional local user
profile for calorie guidance. When that profile is complete, the screen uses a
TDEE-anchored daily target; otherwise it falls back to the legacy estimated
deficit/surplus helper without introducing nutrition tracking or onboarding.
The v2 parser groundwork for one long workout note now exists alongside the
raw-note editor, a formatted read-mode mirror that preserves headings,
exercise blocks, mixed-weight rows, and unparsed history lines, and a stable
derived analytics input model so later PR, 1k, and repeatability work can
consume parsed note output without rebuilding the parser contract. It now also
includes a tracked-exercise estimated-PR engine that computes Epley values per
parseable set, keeps each tracked exercise's best current estimate, and
deduplicates tracked names before emitting analytics rows. It now also derives
the tracked 1k total locally from the user-selected bench, squat, and
deadlift exercises, persists those three slot choices on the canonical workout
note document, and resolves a conservative set of deterministic exercise-name
aliases so obvious note variants such as `DB Bench` still count toward the
intended lift without fuzzy matching. Progression-over-time and repeatability
signals compare the latest comparable weighted result against the prior
comparable result without changing the formal estimated-PR formula. The native
Home and Analytics tabs now derive workout activity consistently from the
currently selected workout note in the same multi-note store used by the Log
screen, and the Log flow now keeps the selected current routine in the full
parsed-workout view while rendering every non-current routine as a compact row
in the bottom `More Routines` list, where it can be expanded inline as a
rendered read view, edited from there, or promoted directly to the current
workout through an explicit confirmation step that also preserves any pending
draft before switching. The same Log flow now autosaves edits to existing
saved routines and note-backed past deloads while preserving explicit-save
behavior only for never-saved notes. The local backup/import path
also now preserves multiple
titled workout notes plus the current-workout selection, and remains backward
compatible with older weight-only v1 backups. The native Home tab is
now a dashboard rather than a static blurb, with a responsive Kilo wordmark
header, `Current Routine Progress` subtitle copy, a single non-navigating
latest-weight summary card, a compact non-pressable `1k Club Progress` card, and a plain (non-navigating)
line-chart view of the 7-day rolling-average weight trend. The only Home→Analytics
navigation is a "Full history and insights" CTA that opens the Analytics tab at
its default landing view with no section argument. The native Log read
view now also lets the user explicitly mark parsed exercises as tracked or not
tracked without editing note syntax, and that selection now persists globally
by normalized lift name so `Bench Press`, `bench press`, and ` Bench  Press `
map to the same tracked lift across app reloads. The read view always renders
the formatted note mirror (day heading, `+` subheading, `-` exercise block,
history rows) faithful to the raw text, with bare `-` lines shown as
unobtrusive inline skip markers; Home and Analytics derive the
workout/session count from the highest per-day session count in the current
workout note, so warmup and lifting sections under the same day heading count
as one session rather than splitting the day across separate section blocks.
The session count drives a color signifier on both screens: green (1–6
sessions), yellow/caution (7–9, approaching deload window), and red (≥ 10,
at or past deload window), derived through a shared `getSessionTone` helper
in UI.js. On Home the color applies to the "Week N" label text; on Analytics
the `Routine Health` gauge applies the tone to its `sessions since deload`
count and caption; `sessions logged` is shown as a `Total` stat within the
same gauge card. No calendar-based metrics are shown in the Analytics routine
status surface.
The native Analytics tab now consumes those
derived analytics directly, combining weight trends with tracked-lift
estimated-max values, Big Three 1RM progress, progression status, Kilo max,
latest top weight, and overload trend in one minimal analytics view while
keeping totals in sync with canonical workout-note refreshes. Those
tracked-lift cards now use the same reactive global tracked-lift state as the
Log screen, update immediately when Track is toggled while Analytics remains
mounted, stay visible only for tracked lifts that appear in the current
routine, and still aggregate each lift's full history across all saved
routines. A separate native More tab now exposes `App Guide` and About surfaces
inside the three-section menu without duplicate quick actions; the App
Guide surface now uses the shared top-safe-area header treatment, a local
accessible header back control, and a centered Kilo logo placed above concise
orientation content covering what Kilo is, what each of the five tabs does,
how workout logging syntax works, and the current terminology glossary. About
continues to surface attribution, displayed version, copyright notice, and an
OTA Diagnostics panel covering the EAS channel, runtime version, current
bundle (embedded vs. applied update), update-available/pending state, and a
manual update check that fetches available OTA updates and offers a restart
action only after a new update is downloaded.

### Parser (`mobile/lib/parser.js`)

The MVP canonical parse path is fully implemented and tested.

- `parseWeightEntry(raw)` — accepts `\d+(\.\d+)?` only; rejects unit suffixes,
  signs, commas, prose, zero, and negative values; defaults `weight_unit` to
  `'lb'`; supplies `logged_at` from context.
- `parseWorkoutRow(raw)` — accepts `-`, comma-separated rep-groups, and
  `load rep-group` pairs; rejects standalone integers, timed formats, prose, and
  slash notation; normalizes spaces around commas.
- `parseWorkoutEntry(items, workout_date)` — calls `parseWorkoutRow` per row;
  collects per-row errors; returns a canonical workout entry or a structural
  violation when no valid items remain.
- `parseWorkoutNote(noteText)` — parses multi-day shorthand workout notes into
  stable sections and exercise blocks, preserves parseable set rows plus
  positional session-entry slots for downstream analytics, and degrades
  ambiguous or non-weight note fragments into `unparsed_rows` instead of
  rejecting the note.
- `parseExerciseHeader(raw_header)` — extracts prescribed set/rep targets from
  trailing exercise-header patterns like `4x6-8`, `2x12`, and `2 8-10` so
  downstream flows can recover intended working ranges from routine text.
- `buildSessionsFromNote(noteText)` — aligns the `N`th positional `- ...`
  entry for each exercise into session `N`, ignores day and warmup/lifting
  boundaries for session construction, preserves bare `-` skips, and emits a
  warning when exercises have uneven positional entry counts. Retained for
  legacy-migration-format validation only; no product screen reads workout
  presentation or counts through it.
- `countWorkoutSessions(noteText)` — returns the workout/session count as the
  highest session count among day headings in the note, treating same-day
  warmup and lifting sections as one session bucket and returning `0` when no
  exercise has any parsed or explicit session history. Source of the Home and
  Analytics session counts.
- `deriveWorkoutAnalytics(sections)` — converts parsed note sections into a
  per-exercise analytics input contract with flattened sets, grouped rows,
  per-occurrence context, preserved `unparsed_rows`, per-set Epley estimates,
  and a best-set `estimated_pr` summary.
- `deriveTrackedPRs(sections, trackedNames)` — filters derived analytics down
  to one row per unique tracked exercise name, preserving caller order while
  surfacing each exercise's best current `estimated_pr` or `null` when absent.
- `derive1kTotal(sections, selections)` — sums the estimated PR values for the
  selected bench, squat, and deadlift exercises and returns `total: null`
  until all three tracked lifts are present in the note.
- `deriveProgressionSignals(sections, trackedNames)` — walks backward through
  tracked exercise occurrences to compare the latest comparable weighted result
  to the prior comparable result, returning improved, held, regressed, or
  first-session progression status plus latest-session estimated 1RM, all-time
  Kilo max, latest top weight, overload trend, and same-session top-weight
  `repeatability_score`. Exercises with no weighted sets fall back to a
  bodyweight path that compares session-level total reps and surfaces the best
  set reps in place of top weight.
- `generateDeloadNote(routineRawText)` — deterministically derives a deload
  note from the canonical routine note by skipping warmup/non-weight rows,
  reducing PO lifts to 65% of the most recent working weight with inferred
  2.5/5 lb rounding, preserving accessory weights, and emitting a separate
  deload-note text format that round-trips back through `parseWorkoutNote()`.

A legacy freeform path (`parseKiloInput`, `formatParsed`, legacy helpers)
exists in the archived browser prototype for seeded-history compatibility. It is
not used on any active save path.

---

## What Issue #17 Validated

Issue #17 completed the legacy prototype MVP acceptance review and the final
launch hold was cleared by user-confirmed on-phone validation. This closeout
should not be mistaken for native-app readiness. The native migration contract
established in issue #35 creates a separate path of work before any native-app
launch claim would be credible.

Required readiness artifacts and their current status:

| Artifact | Status |
|---|---|
| `README.md` | Complete |
| `docs/current-state.md` | Complete |
| `docs/architecture.md` | Complete |
| `docs/testing-and-qa.md` | Complete |
| `docs/repo-structure.md` | Complete |

---

## Known Gaps That Affect Launch Confidence

### Native app path still has partial UI parity only

The `mobile/` Expo app now covers the native MVP create/store/retrieve loop for
weight and workout entries, but it still exposes a narrower UI than the
archived browser prototype. The native app has five tabs, its own note-first
Log flow rather than the prototype exercise-row form, and it still lacks full
parity for seeded history presentation and the prototype's live per-row parse
preview treatment.

### No automated tests for full native runtime, workout logging, or correction flows

The following MVP behaviors have no automated test coverage:

- `mobile/screens/LogScreen.js` end-to-end save/error UI, raw-edit
  transitions, and the rendered parse-preview/logging loop
- `mobile/screens/WeightScreen.js` delete and edit correction flows
- `mobile/screens/HomeScreen.js` rendered weekly-summary contract from a saved
  workout note
- full Expo device/emulator runtime behavior and layout validation across the
  mounted tab set

`mobile/App.js` now has focused automated coverage for five-tab shell routing
and Android hardware-back behavior, but these remaining gaps mean the automated
suite passing does not confirm that the workout logging loop, correction flows,
or real-device runtime behavior work correctly. Manual smoke testing (per
`docs/testing-and-qa.md`) is required to cover these paths.

### Supabase backend (schema live, app local-only by default)

Runtime persistence is local device storage via AsyncStorage in the native Expo
app. As of `0.70.0` the backend foundation landed on `main` — the note-first
`kilo` Supabase schema and RLS (#316), the auth/session client (#317), and the
storage-seam cloud adapter with local mode as the default (#318). The `kilo`
schema has since been applied to the shared Supabase project and exposed:
per-user RLS isolation was proven against real `auth.uid()` (first via a
transaction-rollback dry run, then applied for real), and an unauthenticated
REST call is correctly denied (`permission denied for schema kilo`). The app
enters cloud-aware mode only when `EXPO_PUBLIC_SUPABASE_URL` /
`EXPO_PUBLIC_SUPABASE_ANON_KEY` are configured; absent that it runs entirely
local, and signed-out users stay local-only regardless. Archived completed
weight goals have their own owner-scoped `kilo.archived_weight_goals` table and
participate in account export, account delete, and the cloud sync loop. The Phase 4 bootstrap
import path now exists in the cloud adapter (#319): `bootstrapFromLocal` reads
the mapped AsyncStorage keys read-only and upserts them idempotently into the
note-first `kilo` tables, with legacy `kilo_workout_sessions` synthesized into
note-first `workout_notes`. Continuous offline sync (Task 11, #320) is now
implemented too: a transport-agnostic last-write-wins engine with per-install
`client_id`, monotonic `updated_at` stamping, persisted per-table dirty queues
and pull cursors, tombstone-first deletes, and derived-JSON recompute, wired
behind the cloud adapter so cloud-mode reads/writes stamp and enqueue and
reconcile on reconnect. The Task 12 (#321) recovery UX now surfaces this, and
issue #360 replaces its implementation jargon with a user-facing cloud model:
the signed-in Account screen offers Upload Local History for the one-time local
upload and Sync Now for bidirectional reconciliation, with descriptions and
visible idle/running/failed/complete status per phase. The App Guide and Account
surface explain the device as the offline working copy, the account as the
synchronized cloud copy, most-recent-edit-wins conflict handling, and that
account deletion preserves local history. Live last-synced/dirty-state status
and automatic first-sign-in upload remain deferred backend follow-ups. The
surface also provides a v3-compatible cloud export (the existing backup shape
plus a namespaced `cloud` block with profile, feature toggles, and the
non-sensitive signed-in account identity). Retry/run are non-destructive — a
failed run leaves local AsyncStorage intact. The Phase 5 account lifecycle path
now adds server-owned Edge Functions for requester-only account export and
account deletion (#322): `account-export` uses the caller JWT and RLS to return
only the signed-in user's app rows, while `account-delete` deletes app rows
under requester-scoped RLS and then uses the server-side auth admin deletion
path for the auth user. The service-role key stays server-side and is never
sent to the mobile/web bundle. These paths still only act when the user is
signed in and cloud mode is configured. The Phase 5 launch posture for issue
#323 is now defined, and issue #330 adds placeholder Privacy Policy and Terms
of Service links beside public signup, on the signed-in Account lifecycle
surface near export/delete actions, and in More > About Kilo. Issue #328 adds
conservative in-memory Edge Function abuse controls: `account-export` allows one
successful export per signed-in user per 10 minutes plus an IP bucket, and
`account-delete` allows three delete attempts per signed-in user per hour plus
an IP bucket. The Account screen now gates the configured signed-out form during
the initial persisted-session restore probe, preventing a transient sign-in form
flash before a restored session resolves (#365), and it uses the app-shell auth
session rather than creating a second session probe when the Account subview
opens (#366). Remaining launch-posture follow-ups are Supabase Auth
configuration: Auth must keep platform rate limits, use production-owned SMTP
before email signup, keep the published Privacy Policy and Terms of Service
documents live, and enable CAPTCHA before open signup unless a closed-beta
release explicitly defers the still-pending gates.
`docs/backend-schema.md` documents the schema and source-of-truth policy,
`docs/backend-activation.md` the activation runbook, and
`docs/backend-roadmap.md` the remaining cloud work.

Launch validation must still treat AsyncStorage as the immediate offline cache:
the Phase 4 cloud paths are user-invokable from the Account screen only when the
user is signed in and `EXPO_PUBLIC_SUPABASE_*` is configured. Initial upload is
one-way from that cache to the account; ongoing sync is bidirectional and
reconciles local and cloud rows with the most recent edit winning.

### Legacy Capacitor shell removed

The Capacitor Android shell (`android/`, `capacitor.config.json`) and the
browser prototype build pipeline have been removed (issue #213). The native Expo
app under `mobile/` is the only device-packaging path.

### Android preview OTA updates use the unsigned preview channel

The native Expo app uses plain `expo-updates` for Android preview OTA delivery.
Preview builds check the `preview` EAS Update channel on launch and can accept
JavaScript and bundled-asset updates without reinstalling the APK. The preview
runtime is a stable manual string (`preview-1`) defined in `mobile/app.config.js`
and is not tied to `expo.version`; app version bumps do not force a rebuild or
break OTA delivery. A rebuild is only required when a native module changes, a
native `app.json` field changes, or `PREVIEW_RUNTIME` in `mobile/app.config.js`
is deliberately bumped. Production builds continue to use
`runtimeVersion.policy: "appVersion"`.

Signed OTA updates are not in use. `mobile/app.json` no longer configures
`codeSigningCertificate` or `codeSigningMetadata`, `mobile/package.json` no
longer requires `--private-key-path`, and `mobile/certs/KEYS.md` now documents
the unsigned preview OTA workflow plus the rebuild boundary for native/config
changes.

### Native Expo app has standalone Android and iOS build paths

The `mobile/` Expo app now has checked-in EAS build profiles for both Android
and iOS output, plus the required platform identifiers (`android.package` and
`ios.bundleIdentifier` are both `com.benpronin.kilo`). That gives the native app
installable paths that do not depend on the developer machine staying on or
serving a local Expo session.

Android: the `preview` profile produces a plain `.apk` for sideloading.

iOS: two profiles are available:
- `ios-simulator` — builds a Simulator `.app` bundle; no Apple Developer account
  required.
- `ios-device` — builds an internal-distribution `.ipa` for direct real-device
  install via ad hoc provisioning; requires an Apple Developer Program membership
  and the target device UDID registered in the Apple Developer portal.

The one-time Expo account linking step still must write a real
`extra.eas.projectId` into `mobile/app.json`, and the repo documents that
contributors should commit that linked project ID once it exists.

The shipped native Android launcher, adaptive icon, splash icon, and web
favicon assets now use Kilo-branded PNG files instead of the default Expo
placeholder artwork.

The Expo web target is configured for static export with Metro and single-output
web output in `mobile/app.json`. `npx expo export --platform web` now emits the
static web artifact from `mobile/`. The SDK 56 upgrade validated the local web
export pre-flight and a headless Chromium boot pass against the exported app;
live Cloudflare Pages verification still requires the pushed issue branch or a
superseding PR because that build configuration is account-side rather than
tracked in the repository.

Desktop web has the minimum local-data usability fallbacks needed before backend
work: non-Home tab roots render an explicit web-only Home back control, while a
More child replaces it before paint with one local Back control that returns to
the More menu. Wide web viewports center the single-column app within a 640px
content cap, Log edit entry is available through explicit single-press edit
controls, and Weight plus linked Log deload date edits use DOM
`input type="date"` controls on web while native Android keeps the existing
hardware-back and native `DateTimePicker` paths. Local exported-web boot is now
covered by the documented pre-flight plus browser boot check; production static
hosting remains dependent on the selected host serving `index.html` as the SPA
fallback.

**iOS device build blockers:** the `ios-device` profile uses internal
(ad hoc) distribution, which requires an Apple Developer account and the target
device UDID registered in the Apple Developer portal before the build starts. The
`ios-simulator` profile has no such requirement. See `docs/phone-runbook.md` for
the full iOS build command path and known blockers.

### Native UI runtime is not yet validated end-to-end

Issue #36 review approved the native UI structure, but the approval was based on
static inspection of the `mobile/**` diff. The Expo app has not yet been
validated end-to-end on a device or emulator as part of the issue closeout.

## Launch Prerequisite Checklist

These were the prerequisites for manual launch validation on issue #17.

**Docs**
- [x] `README.md` explains where the app lives, how to start it, and which docs
      matter for launch review
- [x] `docs/current-state.md` exists and is internally consistent with the other
      docs (this document)
- [x] `docs/architecture.md` is current and accurate
- [x] `docs/testing-and-qa.md` is current and accurate
- [x] `docs/repo-structure.md` exists and maps MVP-relevant repo areas

**Automated tests**
- [x] `npm --prefix mobile test` passes with zero failures

**Manual smoke test**
- [x] Final launch-signoff validation was completed for issue #17 with
      user-confirmed on-phone verification before closeout

**Known non-blockers for launch** (acceptable prototype limitations)
- PT checklist items are toggle-only; not persisted across reloads
- Stats screen is read-only and has no correction flows
- Seeded entries cannot be corrected via the product UI
- Home quick-log is not manually reachable in the seeded prototype state (covered
  by automated tests)
- Cloud account flows are still gated by Supabase env config and sign-in;
  AsyncStorage remains the immediate offline cache for MVP validation

## Ownership Split For Native Migration

Issue #35 fixes the first implementation ownership split as follows:

- Issue #36 (`agent:gemini`): native screen structure, navigation, reusable UI
  components, and MVP surface composition in `mobile/`
- Issue #37 (`agent:claude`): completed parser port, entry model, local
  persistence, recent-history retrieval, and native-side data access boundaries
  in `mobile/`

Codex stays responsible for contract definition, sequencing, and review rather
than owning the implementation slices directly.

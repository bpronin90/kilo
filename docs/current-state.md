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
0.85.x and React 19.2.x. Issue #429 then cleared the remaining mobile
dependency-audit findings in the Expo tooling tree with targeted `postcss` and
`uuid` overrides, so root and mobile `npm audit --audit-level=high` both pass.
Because SDK 56 changes the native runtime, shipping this upgrade requires fresh
Android/iOS native builds; OTA/EAS Update cannot move installed SDK-54 builds
onto SDK 56.
Issue #434 adds minimal Sentry crash/error reporting for native production
builds via `@sentry/react-native`, initialized from the public
`EXPO_PUBLIC_SENTRY_DSN` and tagged with Expo update/runtime context without
opting into default PII capture. Because the Expo Sentry plugin changes native
build behavior for source-map upload, this must land before the production AAB
intended for Play closed testing is built.

Roadmap status:

- MVP4.0 through MVP4.5 are complete roadmap passes. Their roadmap documents
  are archived under `docs/archive/`.
- The MVP-Refine pass (`docs/archive/mvp-refine-roadmap.md`) ran after MVP4.5
  and is also complete.
- `docs/archive/mvp-v4.5-roadmap.md` tracks the cumulative state of the app
  through the end of the MVP4.5 pass and remains as a reference document.
- `docs/archive/backend-roadmap.md` is the archived public self-serve planning roadmap.
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
  signed-in session renders immediately when the screen opens (#366). Password
  recovery now requests an explicit base redirect, handles cold- and warm-start
  callbacks, navigates directly to More > Account, and presents a dedicated
  set-new-password or readable link-error surface (#497). The
  redirect is allow-listed in Supabase, and production Auth now sends signup
  confirmation and password-recovery email through Resend from a verified
  domain (#478). Signup confirmation and password reset have completed against
  production, with current spam placement documented as a cold-domain
  reputation limitation. Account signup and failed password-sign-in messages
  now use enumeration-safe wording and direct users who may have registered
  through GitHub to Continue with GitHub without revealing whether an email
  address exists (#496).

The archived browser prototype was a seeded fitness-logging app with
approximately 221 synthetic workout sessions and bodyweight entries used as
history scaffolding; that seed exists only in the archived prototype. The
shipping mobile app starts empty on a new install — Play beta testers see no
preloaded workout or weight history — and all data comes from what the user
creates or imports through the app's local persistence path.

The native Expo app exposes five tabs: Home, Log, Weight, Analytics, and More.

For physical-device packaging:
   - `cd mobile`
   - `eas build --platform android --profile preview`
   - For a Play Store production AAB, run
     `npm --prefix mobile run build:android:production` from the repo root
   - Install the resulting APK on the phone
   - After a compatible Android build is installed, publish OTA-safe JS and
     asset updates with `npm --prefix mobile run update:android:preview`
   - Production Android OTA-safe JS and asset updates publish with
     `npm --prefix mobile run update:android:production`, but only after a
     compatible production AAB exists and is verified.
   - iOS preview builds (`ios-simulator`, `ios-device`) are bound to the same
     `preview` channel; publish iOS OTA updates with
     `npm --prefix mobile run update:ios:preview`. Live on-device iOS delivery
     is not yet verified end to end (deferred pending an iOS build, issue #63).
   - The preview runtime boundary is a stable manual string (`preview-3`)
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
  first-run/steady-state split: after Home hydration resolves, when the user has
  no weight history, no saved workout notes, no active draft workout note, no
  saved weight goal, and no active tracked lifts, Home renders a welcome
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
  emphasis as the total approaches 1,000 lb. The Home weight hero, goal stats,
  pace suffix, sparkline, and 1K values render in the selected lb/kg display
  unit while the 1,000 lb club threshold remains lb-defined internally. Its
  headline value now comes
  directly from the same shared session-ordinal Big-3 series contract used by
  Analytics, so the Home total reflects the latest complete aligned workout
  cycle rather than a sticky per-occurrence PR or a mixed-cycle fallback. All
  dashboard data comes from existing shared derivation functions; no Home-only
  calculations exist. After cloud sync, every mounted workout-note subscriber
  now reloads from storage, keeping Home and Analytics on the same note snapshot
  so their 1K totals and progress series update together (#459). The success
  toast is removed from the render
  - Cross-routine alignment fixed (#396): the 1K headline and `1K Progress` graph
    now align lifts per note (`derive1kTotalSeriesFromSectionsList`) before
    concatenating, so unequal per-lift session counts across routines (e.g. a
    one-session deload note) no longer misalign at routine boundaries. The graph
    keeps full cross-routine history with each point summing same-cycle PRs, and
    the headline ends on the most recent complete cycle without ever mixing
    cycles. When no note has a complete Big-3 cycle the total is null and each
    lift reports its latest session PR individually.
  - Deload sessions excluded from strength signals (#397): deload notes (title
    prefix `Deload · `) are filtered out of the analytics signal derivation
    (`signalSections` in `analyticsDerivations.js`) that feeds the fatigue-adjusted
    Kilo Max and tracked-lift signals, since `computeKiloMax` flat-averages every
    set's Epley and the intentionally-light deload sets otherwise bias it downward.
    Deload sessions are still kept in the 1K series as their own point (#396).
    Overload counts and latest-PR/classification signals were already unaffected.
  - Accepted residual (#398, won't-fix): alignment within a single note is purely
    by session ordinal (the parsed model carries no per-session date, and the
    maintainer declined adding one). Skipped sessions are absorbed by null
    placeholders, but if you log one lift *more often* than the other two within
    the same routine note, that lift's newest session is dropped from the 1K and
    it reads one session behind — a mild, generally downward skew (consecutive
    training sessions are close in weight), not the dramatic cross-routine drop
    fixed in #396. It self-corrects when the other lifts catch up to equal counts
    and fully resets when a new routine note begins. This behavior is surfaced to
    users in-app (#399): the Analytics `1K Progress` card has a collapsible
    "How is this calculated?" note explaining the Big-3 cycle definition, the
    one-session-behind reset, and that deload sessions show on the graph but not
    in strength stats — rather than being fixed in the model.
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
  line at the top of the expanded current-note body and a matching low-emphasis
  `Skip week` action that appends the normal bare `-` skip marker to each
  active-week exercise that already has logged session entries regardless of
  tracked-lift selection, saves the note, and then enters the existing
  fatigue-reason prompt path only after the save succeeds, an explicit `Edit`
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
  the full note on save, preserves the locally selected week across stale or
  out-of-order persistence refreshes, and keeps progression continuity shared
  across both weeks because the underlying analytics still derive from the full
  note by exercise name.
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
  recomputing it during render. Parsed set-row weight values in the rendered
  Log read view are also unobtrusive tap targets that open a lb-only plate
  calculator sheet for a standard 45 lb barbell, showing the per-side
  45/25/10/5/2.5 lb plate loading plus any unloadable remainder without
  changing parsing, storage, or workout analytics. Native workout-note
  documents now also persist
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
  with a native target-date picker plus a web `<input type="date">` fallback so
  the goal target date stays editable on web,
  MM-DD-YYYY visible goal-date formatting, `Target` and `Target Date` as
  equal-priority anchors, enlarged touch targets on the goal action and
  history date-filter chips, and row-based derived guidance for `Target pace` plus
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
  state. Saved goals now render as a singular `Goal` section that inlines the
  derived pace/calorie guidance directly into the goal card instead of a
  separate `Guidance` card, adds a remaining-distance `lb to go` progress line,
  demotes the derived labels to a quieter uppercase hierarchy, and keeps target
  weight and target date at equal visual priority. Archived completed goals
  appear in a compact conditional `Goal History` list beneath the active/new
  goal flow, defaulting collapsed so it does not push Weight History down,
  ordered newest first with target weight, `End Weight` when available, and
  target date; the archived date is no longer shown as its own table column.
  Archived row values use a stronger value typography so the section reads as
  intentionally secondary rather than undersized, and `End Weight` is colored by
  outcome via `isGoalMet` (success when the completed weight met the saved
  target, error when it missed, neutral when no completed weight is recorded).
  The
  Goal History and Weight History panels now share one history-panel visual
  system: a static section title sits above each card, and the card's top row is
  the live header row. When expanded, the column labels live in that row with
  the collapse chevron at the trailing edge; when collapsed, the row swaps to
  the compact summary with the same trailing control cell. Goal History sits
  below Trends and stays collapsed by default; its collapsed summary presents a
  two-line count/latest stack carrying `{n} goals` plus `Latest: {outcome}`,
  where the latest archived goal's result renders as bold `Success` in
  success/green when met, bold `Missed` in error/red when not, and neutral when
  there is no completed weight to judge (via the same `isGoalMet` check used for
  End Weight coloring).
  The Trends card now colors trend direction in a goal-direction-aware way so
  gain and loss goals do not invert success/error meaning; when no active goal
  is set it still applies visible directional color to `↑ Gaining` / `↓ Losing`
  rather than going fully neutral, keeps fixed severity color for pace anomalies,
  and reserves neutral treatment for `→ Stable` / no-data values, and tapping a history
  row now scrolls back to the top editor as it loads the selected entry. The
  Weight tab now reads top-to-bottom as weight entry, `Goal`, `Trends`,
  optional `Goal History`, and `Weight History`, with `Goal` / `Trends` using
  the shared section-heading treatment and a merged Trends card that now
  consumes the same canonical `deriveWeightGoalAnalytics()` output used by
  Home and Analytics for trend summary, pace severity, goal guidance, and
  calorie guidance, and
  surfaces `Today`, `7-day rolling`, and `30-day rolling` rows with
  current-or-average value, prior-window comparison, and trend cue summaries
  derived from the day-level `date` key while History continues to display the
  recorded `logged_at` timestamp. The Weight History panel keeps its column
  headers and expanded rows, defaults expanded, and groups its calendar/filter
  icon inside the expanded Date header immediately before `DATE` while the
  trailing control cell holds only the collapse chevron. Its From/To date-range
  controls are hidden by default and reveal as a separated row directly under
  the header when the icon is tapped; when collapsed, the panel keeps a calendar
  icon in the trailing controls so tapping it expands the panel and shows that
  filter row in one step, and toggling the icon off or clearing the range closes
  and clears it. When collapsed it uses the same two-line count/latest stack as
  Goal History, carrying `{n} entries` plus `Latest: {bold weight} on {date}`,
  with Goal History and Weight History sharing the same column flex ratios,
  label/value/date typography, row padding, divider treatment, and trailing
  control-cell width, without changing saved weight calculations or persistence.
  A failed weight-entry load
  now surfaces a retryable `ErrorBanner` at the top of the screen instead of a
  silent empty screen, and a successful Retry clears the banner.
- `mobile/screens/MoreScreen.js` is a routing shell for the native More menu;
  it renders sub-screen components imported from `mobile/components/`
  (`User Profile`, `Settings`, `Data & Backup`, `App Guide`, `About Kilo`) and
  `Account` from `mobile/screens/more/AccountScreen`. When Supabase cloud
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
  controls into `Features`, `Reminders`, `Units`, `Date Editing`, and
  `Advanced`:
  persisted `Fatigue tracking` and `Deload mode` switches let users disable
  those optional workout-side flows without deleting their saved check-ins,
  deload note, or deload history; `Daily weigh-in reminder` and `Workout day
  nudge` are independent local-notification toggles that default off, request
  OS notification permission only when enabled, cancel their own scheduled
  notifications when disabled, and keep workout nudges on weekday sections
  inferred from the active routine note or user-selected fallback weekdays when
  inference is ambiguous; the `Weight unit` selector defaults to lb and lets
  users opt into kg display and entry while leaving stored values and workout
  note text lb-canonical; `Edit weigh-in dates` governs whether the Weight tab
  exposes date controls for new and existing weigh-ins; `Edit deload dates`
  governs whether past deload records expose the opt-in date picker on the Log
  tab, with those date edits now applying correctly on physical devices; and
  the same screen keeps a persisted fatigue-multiplier stepper plus reset
  control. The
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
  date until the selection is cleared. Weight trends, strength suffixes, 1K
  totals, and per-lift breakdowns render through the selected lb/kg display
  unit while the underlying analytics math remains lb-canonical. The screen
  also includes a merged
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
  the latest complete session. The chart also marks new non-deload routine
  starts with subtle dotted vertical lines, carrying a marker to the next
  emitted 1K point when the exact routine-boundary session does not produce a
  complete Big-3 total. The Big 3 Mapping panel is now
  collapsible with the shared open-chevron icon convention, so the selection
  rows can be hidden while keeping the mapping context available. The
  squat/bench/deadlift breakdown values in the 1K Progress card now also open
  the same lb-only per-side plate calculator sheet for the rounded displayed
  estimate. The screen now
  also includes
  a fatigue-tracking panel that stays collapsed by default into a signal-first
  summary row highlighting the most common rough reason when available and an
  unanswered-count alert when pending check-ins exist. Expanding the panel
  reveals `Not great`, `All good`, and conditional `Unanswered` groups with
  stable calendar-day formatting from `responded_at`; rough entries render as
  quieter callout rows with reasons plus note-first summary context: saved
  check-in notes replace skipped-exercise counts in the meta line when present,
  otherwise non-zero skipped/volume-drop stats remain visible. Ok/pending
  entries collapse into date chips to reduce scan noise.
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
  metric grid: `1RM`, `Kilo`, `Best`, `Trend`). Consecutive parsed sections
  with the same day heading, such as multiple `+` subheadings under one
  weekday, render as one routine-day group, and non-consecutive current-note
  sections that begin with the same weekday (for example separate gym/home
  Monday blocks) now merge into one normalized weekday group instead of
  duplicating the day under Progressive Overload. Same-day exercise duplicates
  are deduplicated within that merged group, while true multi-day detection
  counts unique weekday keys so same-day variants do not inflate cross-day
  comparisons. The Progressive Overload sticky header now keeps matching top
  and bottom breathing room when pinned, and the Analytics weight-trends section
  uses the same 16px section-title-to-card spacing as the other Analytics
  panels.
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
- `mobile/components/` contains the extracted sub-screen components
  (AboutScreen, BackupScreen, HelpScreen, ProfileScreen, SettingsScreen —
  rendered by the MoreScreen routing shell) plus shared shell, tab bar, and
  UI primitives; the shared bottom tab bar now uses the lighter card/chip
  palette instead of the older heavy dark floating treatment so it reads as
  lower-emphasis chrome while keeping the active tab easy to distinguish, and
  it now behaves like a content-aware overlay by fading toward transparency
  during shared-shell scrolling, restoring a solid treatment during direct
  interaction, and then settling back after a short timeout
- `mobile/assets/brand/` contains the bundled native logo and wordmark assets
- `mobile/theme/colors.js` centralizes the native color system
- `mobile/lib/parser.js` / `mobile/lib/parser/` — parser barrel and domain
  implementations. Ports the MVP canonical parser path into native ES
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
- `mobile/lib/data.js` / `mobile/lib/data/` — data barrel and domain
  implementations. Defines the native exercise catalog and entry factories,
  including the default 1k exercise-slot selection used by analytics, a
  factory for titled workout-note items in the multi-note model, and
  per-session derivation for non-weighted tracked exercises covering
  reps-only (`total_reps` + arrow) and time-based (`longest_hold` + arrow)
  exercise classes with loaded-bodyweight exclusion
- `mobile/hooks/useEntries.js` / `mobile/hooks/entries/` — compatibility barrel
  for entry hooks; exposes read/write APIs used by the UI, including
  multi-note current-workout reads/writes, cross-consumer
  refresh fanout, persisted weight-goal reads/writes, and a separate
  `useDeloadNote()` hook for the generated/editable deload note, plus a
  shared `useFeatureToggles()` hook that fans persisted fatigue/deload toggle
  changes live to Settings, Log, and Analytics without threading new props
  through `App.js`
- `mobile/storage/entries.js` / `mobile/storage/entries/` — local persistence
  barrel and domain implementations. Persists weight entries plus a local-only
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
  `kilo_fatigue_tracking_enabled` and `kilo_deload_mode_enabled`, independent
  local reminder settings under `kilo_weigh_in_reminder` and
  `kilo_workout_reminder`, a separate deload-date-edit setting under
  `kilo_deload_date_edit_enabled`, a separate deload-note record under
  `kilo_workout_deload_note`, a completed
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
  goals, optional fatigue multiplier, and completed deload history) plus an
  allowlisted cloud block carrying the local user profile, tracked lifts,
  feature toggles, Log collapsed state, and current deload note. On Android,
  large backups are written through the Storage Access Framework to a folder
  chosen by the user and can be loaded back from that folder without crossing
  the share-intent size limit; picker cancellation or write failure retains the
  native share fallback. Import validates the cloud block before any write and
  reconstructs profile and tracked-lift objects from supported fields only.
  Base-payload validation accepts only a finite in-range
  fatigue multiplier, validates each deload-history record and caps its raw
  text, restores the full multi-note model plus weight goal, fatigue multiplier,
  and deload history on v2/v3 import, and still accepts older v1
  backups to restore weight history without wiping the newer workout-note state.
  The export action now shows a blocking "export is unencrypted" confirmation
  before sharing; local export and native share failures preserve their
  underlying error message and log the full exception for device diagnostics.
  The cloud export omits the signed-in account email by
  default (it is included only in the dedicated cloud-recovery identity flow),
  and both import and parse paths reject oversized untrusted input

This path is no longer UI-only. Weight saves run through `parseWeightEntry()`
before persistence, and the native Log flow now saves through the current item
in a local multi-note workout store instead of requiring a structured
title-and-detail workout entry form. Saved native weight entries, workout note
items, and the selected current workout all reload across app restarts through
the native hook/storage layer. The native app shell now provides runtime
safe-area metrics in `mobile/App.js`, retains its Android-aware top cap for the
status bar/notch, and positions the absolute tab bar above the current bottom
system-navigation inset. `ScreenShell` adds that same bottom inset once to its
standard 120px tab-bar clearance while preserving the shared in-screen content
padding and header layout used across Home, Log, Weight, Analytics, and
More/Help. Its
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
action only after a new update is downloaded. In addition to that manual
panel, the app shell now shows a global non-blocking "Update ready — Restart
to apply" banner above the content area whenever a background-downloaded OTA
update is pending, so a single launch plus one restart reaches the latest
published update without visiting About (#426). While an update is pending,
the About panel suppresses its own pending alert and restart button and
defers to the global banner as the single restart affordance; the panel's
local restart button appears only in the fallback window where a manual
fetch has completed but the pending signal has not yet flipped (#427).

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

### Units: lb-canonical storage with lb/kg display preference

Kilo now ships a simple lb/kg display preference. The default remains lb for the
US-centric launch path, and kg is an explicit opt-in from Settings. The
preference lives on the local profile as `unit_system` (`imperial` / `metric`)
and uses the existing cloud bootstrap promotion for the reserved
`kilo.user_profile.unit_system` field; no schema migration was required.

Stored data remains lb-canonical. Bodyweight entries, weight goals, workout
sets, parser output, weight-pace thresholds, the 3500 cal/lb deficit display,
and the 1,000 lb club domain threshold continue to use lb internally. The kg
path converts only at render and at the bodyweight/goal entry boundary before
storage. Workout note text remains user-authored lb text, and the workout-note
grammar still does not parse kg input.

Converted display surfaces include Home weight/goal/1K values, Weight entry and
goal forms, Weight and Goal History rows, Analytics weight trends and strength
suffixes, shared set rows, and Help copy where it describes the 1K total. Body
weight display uses one decimal in kg; lift displays use compact kg rounding
for dense set rows.

---

## Known Gaps That Affect Launch Confidence

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
reconcile on reconnect. Issue #489 extends that ongoing path beyond weight
entries, workout notes, and archived goals to the allowlisted user profile and
current-routine state, feature toggles, active weight goal, and deload history,
and issue #487 moves the three ongoing health-profile values
(`current_workout_note_id`, `fatigue_multiplier`, and `tracked_lifts`) out of
the mixed `user_profile` row into the consent-gated `user_health_profile`.
Issue #498 extends that health projection with the active generated deload and
maintains `fatigue_checkins` as a deterministic, one-way projection of canonical
`workout_notes.session_checkins`, so active deload edits/clears converge across
devices and queryable fatigue rows stay synchronized without becoming a second
source of truth. All nine cloud tables push post-bootstrap changes and restore
onto a clean install without routing health values through the ordinary
account-settings row. Pending local changes are submitted before conflict resolution and
receive server-authored timestamps on arrival, avoiding device-clock-skew data
loss; exact timestamp ties converge on the shared server row, while local-only
ties retain the stable per-install `client_id` rule. Snapshot-based dirty
detection, idempotent passes, and tombstones prevent repeated writes,
duplicates, and deleted-record resurrection. Ownership-confirmation uploads now
preserve each workout note's tombstone and legacy provenance, and ongoing sync
repairs provenance-stripped `wn_legacy_` rows only when a real non-legacy note
coexists, preventing the phantom `Routine 1` regression without deleting
legitimate legacy-only or user-authored notes (#501). The Task 12 (#321)
recovery UX now surfaces this, and
issue #360 replaces its implementation jargon with a user-facing cloud model:
the signed-in Account screen offers Upload Local History for the one-time local
upload and Sync Now for bidirectional reconciliation, with descriptions and
visible idle/running/failed/complete status per phase. The App Guide and Account
surface explain the device as the offline working copy, the account as the
synchronized cloud copy, most-recent-edit-wins conflict handling, and that
account deletion preserves local history. The signed-in Account cloud-sync
surface now shows whether this device is synced, has pending local changes,
is actively syncing, or saw the last sync fail, and it surfaces the last
successful sync time when known. Issue #450 gates first-sign-in bootstrap on a
single durable local-data owner marker. Unclaimed local history requires upload
confirmation; history owned by another or unknown account is never uploaded
automatically and instead offers an explicit start-fresh or deliberate-upload
choice. Existing single-account installs migrate from the legacy bootstrap
marker without a prompt or re-upload, and failed ownership writes remain local
and retryable. Issue #499 adds the complementary clean-device restore path:
when every synced and device-local state family is empty and no dirty sync work
is queued, an unclaimed device can explicitly download the signed-in account's
cloud data. The action rechecks that invariant, claims the device for the
account, activates cloud mode, and performs a real pull without pushing local
state. Non-empty devices continue to require the upload/start-fresh ownership
flow, except that an active password-recovery session or recovery-link error now
takes precedence: the ownership prompt is suppressed and deferred until recovery
completes or is exited, then re-presented through the normal flow (#500). Manual
Sync Now remains available after ownership is resolved, and local mode can no
longer report its no-op adapter as a completed cloud sync.
The surface also provides a v3-compatible cloud export (the existing backup shape
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
conservative durable Edge Function abuse controls: `account-export` allows one
successful export per signed-in user per 10 minutes plus an IP bucket, and
`account-delete` allows three delete attempts per signed-in user per hour plus
an IP bucket. Issue #451 hardens those pre-auth buckets against caller-supplied
forwarding values by selecting the platform-controlled rightmost value, and a
scheduled global reaper removes expired export/delete hits independently of
bucket cardinality. Issue #429 masks internal account export/delete 500 details
from client responses while preserving server-side console diagnostics. The Account
screen now gates the configured signed-out form during
the initial persisted-session restore probe, preventing a transient sign-in form
flash before a restored session resolves (#365), and it uses the app-shell auth
session rather than creating a second session probe when the Account subview
opens (#366). Native session persistence now tracks an authoritative SecureStore
chunk high-water mark so shrinking writes and sign-out remove every chunk owned
by the current adapter, while legacy or corrupt states without trustworthy
metadata receive a documented bounded best-effort cleanup (#453). Remaining
launch-posture follow-ups are Supabase Auth
configuration: Auth keeps platform rate limits and now uses production-owned
Resend SMTP from a verified domain for email signup and password recovery
(#478). The published Privacy Policy and Terms of Service documents must remain
live, and CAPTCHA must be enabled before open signup unless a closed-beta
release explicitly defers that still-pending gate.

Issue #487 adds the staged Article 9 explicit-consent boundary for Cloud Sync.
The client renders the approved United States/SCC/health-category disclosure
and records grants only through server-owned, material-versioned consent RPCs.
Supabase RLS gates `user_health_profile` plus the six health-data tables; stale
clients and grants receive distinct denial codes. Withdrawal immediately blocks
cloud health access, queues an idempotent purge through `health-data-delete`,
and advances to `withdrawn` only after the shared gated set is verified empty.
Account export and both deletion paths consume that same table definition, and
account deletion retains only a six-year HMAC-pseudonymized evidence archive.
Existing users are not grandfathered: the deployment sequence is expand, ship
the consent-capable client, wait through adoption, activate enforcement,
contract the legacy columns, then separately arm per-account quarantine purge.
None of those production migration or activation steps occurred during issue
#487 closeout, and issue #477 remains blocked until deployment and policy
publication make its Article 9 wording true.

`docs/backend-schema.md` documents the schema and source-of-truth policy,
`docs/backend-activation.md` the activation runbook, and
`docs/archive/backend-roadmap.md` the remaining cloud work.

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
runtime is a stable manual string (`preview-3`) defined in `mobile/app.config.js`
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

Android: the `preview` profile produces a plain `.apk` for sideloading. The
`production` profile is configured to produce a Play Store `.aab` bound to the
EAS `production` environment, which carries the same `EXPO_PUBLIC_SUPABASE_*`
variables as preview so store builds are cloud-enabled (sign-in, sync, account
lifecycle), and it auto-increments `versionCode` for repeat Play uploads (#425).
Issue #491 qualified the owner-built Android production release from commit
`6f6bfcf871a4a609ad8a169e514abdbb070e1945`: app version `0.95.0`, versionCode
8, runtime `0.95.0`, distributed as an AAB through the Play closed track. The
Play-installed client retained local data, restored the account cloud copy
after #499, exported the large Android backup, and continuously synchronized
workout-note, tracked-lift, and profile changes. Production remains in
`legacy` consent mode; consent-surface and grant qualification moved to #492's
controlled enforcement cutover and was not waived by the release qualification.

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

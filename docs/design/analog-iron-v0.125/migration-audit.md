# Analog Iron migration audit and child issue drafts

Planning contract: [#978](https://github.com/bpronin90/kilo/issues/978).
Audited main: `a4bb03a44b0369791e14387e045cdb620f89e15d` (2026-09-07).
This document reports the current application and proposes future work; it does
not attest that the migration or device verification has happened. The reference
package is present in `docs/design/analog-iron-v0.125/README.md`; the development
client loop is documented in `docs/testing-and-qa.md` and configured in
`mobile/eas.json` and `mobile/app.config.js`.

## Authority and scope

Existing behavior, navigation, state transitions, and data win over an image:
`mobile/App.js`, `mobile/screens/`, and `mobile/components/` are the implementation
evidence below. Written visual rules win over screenshot pixels:
`docs/design/analog-iron-v0.125/visual-language-spec.md`,
`docs/design/analog-iron-v0.125/dark-mode-implementation-note.md`, and the
qualifications in `docs/design/analog-iron-v0.125/README.md` govern this plan.

The migration preserves every inventory row below, including states without a
reference. It must not create a workout scheduler, change parsing, calculations,
storage, sync, authentication, or routes to make an image possible. Visual
implementation uses open canvas, restrained surface grouping, 0–2px corners,
no shadows/glass/pills, no decorative red, no faux-technical copy, and no mobile
text below 11px. Ordinary separation is a continuous **1px hairline**; the
**1.5px structural frame** is a different role. Dark `inkSubtle` is decoration
only; small text and essential secondary information use accessible `inkMuted`.
Sources: the three written handoff files above; current semantic text/mark
pairing tests in `mobile/tests/theme-rendering.test.js`.

Children remain drafts in this document. #978's acceptance criteria explicitly
ask for proposed cards, while its introductory wording also says “emit” child
issues. No GitHub children are created by this audit. Owner clarification is
required before creating actual cards, and owner approval of this audit is
required before implementing any child. This follows the #978 contract linked
above; the drafts and their file ownership are recorded here for that review.

## Baseline verification, not a new discovery exercise

The supplied counts remain the sizing baseline. One bounded literal check of
the existing production JavaScript in `mobile/App.js`, `mobile/components/`,
`mobile/screens/`, `mobile/lib/`, `mobile/hooks/`, and `mobile/storage/` checked
the named categories. It excluded tests, configuration JSON, generated files,
and dependencies. These are textual matches, not an AST census of rendered
styles; comments and different historical search boundaries can affect them.
The current check does **not** reproduce every historical number, so those
numbers must not be presented as newly confirmed exact totals.

| Supplied baseline | Bounded verification and implication | Repository evidence |
|---|---|---|
| Two semantic palettes; palette reskin, not a new theme architecture | Confirmed: Light/Dark role objects, preference plus system derivation, palette-keyed style factories, and contrast assertions already exist. Preserve these interfaces. | `mobile/theme/colors.js`, `mobile/theme/ThemeContext.js`, `mobile/lib/themePreference.js`, `mobile/tests/theme-rendering.test.js` |
| Only 3 hardcoded hex literals outside theme | Production quoted-JS check found 2, both fixed orange SVG fills in Home. Configuration has additional splash/adaptive-icon hex values and is outside that comparison. The “3” is not an exact count of all repository color strings. | `mobile/screens/HomeScreen.js`, `mobile/app.json` |
| About 470 font-size literals / 18 values | Current bounded match found 449 / 17: 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 24, 28, 30, 32, 34, 48. The scope remains a distributed typography migration, not a palette-only task. Existing `HeroMetric` and `SET_ROW_FONT_SIZE` provide partial reuse, not a complete scale. | `mobile/components/UI.js`, `mobile/components/`, `mobile/screens/`, `mobile/App.js` |
| Four instances of 10px text | Confirmed in the shared gauge, chart scale, recovery-end modal, and Analytics weight trend styles. Each has an owner below. | `mobile/components/UI.js`, `mobile/components/LineChart.js`, `mobile/components/RecoveryBlockEndModal.js`, `mobile/components/AnalyticsWeightTrendsCard.js` |
| 128 radii / 15 values | Current bounded match found 131 / the same 15 values: 3, 4, 5, 6, 8, 9, 10, 12, 13, 14, 16, 18, 20, 24, 999. None is within the target ceiling. | `mobile/components/`, `mobile/screens/`, `mobile/App.js` |
| Space Grotesk absent; expo-font transitive 14.0.12 | Confirmed: no bundled font in the current asset tree or direct font dependency; the lockfile resolves expo-font 14.0.12. Existing explicit families are platform mono/inherit, not the target face. | `mobile/assets/`, `mobile/package.json`, `mobile/package-lock.json`, `mobile/components/LogScreenEditorCard.js`, `mobile/screens/AnalyticsScreen.js` |
| Three shadow/elevation files | Confirmed: UI panels, tab bar, and Log. Remove their style effects in their owning stages. | `mobile/components/UI.js`, `mobile/components/TabBar.js`, `mobile/screens/LogScreen.js` |
| 40 Platform.OS branches / 23 files: 20 web, 14 iOS, 6 Android | Current direct comparison check found 45 / 23: 22 web, 15 iOS, 8 Android. This excludes Platform.select and platform filename resolution. The supplied conclusion stands: native and browser behavior diverge materially. | `mobile/App.js`, `mobile/components/`, `mobile/screens/`, `mobile/lib/platformAlert.js`, `mobile/hooks/useAuthSession.js` |

No second repository-wide recount is necessary for planning. A future enforcement
card checks actual migrated styles, including expressions and rendered size,
rather than treating these historical totals as an acceptance oracle. The
existing size-sensitive chart and editor behavior is in
`mobile/components/LineChart.js` and `mobile/components/LogScreenEditorCard.js`.

## Screen, route, and state inventory

The app has no file-router screen hierarchy: `mobile/App.js` keeps Home, Log,
Weight, Analytics, and More mounted and hides inactive wrappers. “Stats” in the
handoff maps to **Analytics**, and screenshot “Settings” in the fifth tab maps
to **More**, whose Settings subview must remain separately reachable.
`mobile/screens/MoreScreen.js` owns six subviews: help, about, backup, settings,
profile, account. Password reset is an Account state rendered by
`mobile/screens/more/SetNewPasswordScreen.js`, not an extra tab.

### Navigation contracts

| Entry / destination | State and workflow to preserve | Evidence |
|---|---|---|
| Ordinary tab press | Mounted draft/scroll state persists; keyboard dismisses on tab change. Android back first delegates to the active screen, then Home/exit behavior; web has a Home affordance unless a subview owns Back. | `mobile/App.js`, `mobile/tests/app-navigation.test.js`, `mobile/tests/app-shell-back.test.js` |
| Analytics section intent | overview, weight, strength, progressive-overload, recovery; repeated keyed requests reapply. Measurements fulfill pending scroll requests. A strength/progression arrival expands the paused-baseline disclosure during Recovery. | `mobile/App.js`, `mobile/screens/AnalyticsScreen.js`, `mobile/tests/analytics-screen.test.js` |
| Log note intent | Normal note and recovery-note intents are distinct. Wait for verified reads, route current/previous/recovery notes to their existing viewer, preserve pending edits and repeat-request keys. | `mobile/App.js`, `mobile/screens/LogScreen.js`, `mobile/tests/log-screen.test.js` |
| More subview intent | Six-name whitelist; unknown views do not reroute. Backup's cloud-sync anchor can be requested repeatedly; manual navigation retires the anchor. | `mobile/screens/MoreScreen.js`, `mobile/components/BackupScreen.js`, `mobile/tests/app-navigation.test.js` |
| Authentication callbacks | Native link handling and web callback handling lead to Account; valid password recovery or recovery error opens the reset surface. Do not add screenshot profile shortcuts or new URLs. | `mobile/App.js`, `mobile/hooks/useAuthSession.js`, `mobile/screens/MoreScreen.js`, `mobile/screens/more/AccountScreen.js` |

### Main surfaces

Every row is a preservation checklist, not permission to build new states.
“No dedicated state” means the source has no such presentation; do not fabricate
a spinner, online claim, toast, or error handler as part of restyling.

| ID / surface | Meaningful current states and workflows | Evidence |
|---|---|---|
| S0 App shell | Initial hydration; update-ready/restart banner; persistent tabs; contextual Back; global running/elapsed rest timer; first-upload ownership prompt, optional account download on an empty device, foreign-owner start-fresh/upload/later decisions; recovery flow suppresses ownership prompt. Cloud summary is shared, not inferred separately per screen. | `mobile/App.js`, `mobile/tests/app-workout-hydration.test.js`, `mobile/tests/app-update-banner.test.js`, `mobile/tests/app-shell-render-isolation.test.js` |
| S1 Home | Skeleton before verified dashboard inputs; true first-use welcome with independent Log/Weight actions; failed read without data versus cached data under error/retry banner; no weigh-in; latest weight, 7-day sparkline, current routine week, classifications, first tracked span/inherited tracking captions, goal direction/pace/ended state, 1K missing/partial/progress states. Recovery open week and between weeks retarget Log and subordinate baseline metrics; unverified/stale/pending Recovery preserves truthful status and retry. Cloud queued/failed/retrying notice links to Backup; no generic always-online badge. | `mobile/screens/HomeScreen.js`, `mobile/screens/home/homeDashboardData.js`, `mobile/tests/home-screen.test.js`, `mobile/tests/home-dashboard.test.js`, `mobile/tests/active-training-context-consumers.test.js` |
| S2 Log root and routine viewer | First load, read error/retry, verified empty/new routine; saved note with no current routine and adoption choice; current routine read/edit, collapsed content, A/B week selection and merge where available, skip/remove skip; other routine list, view/edit/share/set-current/delete and confirmations. Routine/Deload/Recovery segment availability follows feature and Recovery state. Track/Tracked starts/removes tracking independently of logging. | `mobile/screens/LogScreen.js`, `mobile/components/LogEmptyState.js`, `mobile/components/LogActiveRoutineCard.js`, `mobile/components/LogPreviousRoutines.js`, `mobile/screens/log/useLogOtherRoutineEditor.js` |
| S3 Log editor and workout execution | Guided first entry/example, new/current/other/deload editor identities, title plus multiline raw text, native keyboard versus web text selection, double-tap source jump, syntax-help sheet, debounced problem list/selected problem/dismissal and alignment actions, A/B edits, Done/back/cancel/save-and-switch gates, pending draft recovery, manual first save versus autosave, saving/saved-on-device/not-yet-synced/error/retry states, post-save adoption prompt and failure. Parsed groups/exercises, weighted/kg-authored/bodyweight/reps/duration/skipped sets, annotations/marks and unparsed rows remain visible. PR banner, rest timer, and optional fatigue check-in coexist under their existing ownership rules; Done is not a new finish-session data transition. | `mobile/components/LogScreenEditorCard.js`, `mobile/components/WorkoutContentRenderer.js`, `mobile/components/UI.js`, `mobile/screens/log/useLogCurrentRoutineEditor.js`, `mobile/screens/log/useLogOtherRoutineEditor.js`, `mobile/screens/log/useLogDeloadEditor.js`, `mobile/tests/first-use-workout-note-flows.test.js`, `mobile/tests/exercise-source-jump.test.js` |
| S4 Deload | Feature off hides its tab; eligible routine generates a deload; empty, generated active, edit, completion session-number prompt, completed history/edit/delete, and destructive confirmations. Existing save/parse failures use their current UI. | `mobile/screens/LogScreen.js`, `mobile/components/LogDeloadSection.js`, `mobile/screens/log/useLogDeloadEditor.js`, `mobile/tests/log-screen.test.js` |
| S5 Recovery in Log | Initial/unverified, refreshing with last-known state, stale/error/retry, pending reconciliation and mutation locks; active open week/between weeks/completed history; baseline and reason, attach existing/create new week, inline note read/edit/save/error/cancel, A/B, week completion/undo, unlink without deleting note, delete linked note confirmation, reason edit, inclusion choice, end block, reopen latest eligible completed block. Manage disclosure and open note stay usable without changing lifecycle semantics. | `mobile/components/LogRecoverySection.js`, `mobile/screens/LogScreen.js`, `mobile/components/RecoveryBlockStartModal.js`, `mobile/components/RecoveryBlockWeekModal.js`, `mobile/components/RecoveryBlockEndModal.js`, `mobile/tests/log-recovery-hierarchy.test.js`, `mobile/tests/log-recovery-save-status.test.js` |
| S6 Weight | Immediate decimal entry even while history/goal load; separate source errors/retries; saving/invalid/save failure; new versus edit/update/cancel/delete; optional note/date disclosures preserve text when collapsed; native date picker versus browser date input; default-today rolls forward correctly. Goal unset/create/edit/clear/archive, loss/gain/maintenance, future/overdue/met/ahead states and unavailable/unsafe pace guidance; archived goals; trend summaries; history initially empty, date-filter empty, paginated/load-more, selected/edit row. All lb/kg display conversions remain unchanged. This screen currently has trend **tables**, not the screenshot's stepped graph. | `mobile/screens/WeightScreen.js`, `mobile/components/WeightGoalCard.js`, `mobile/components/WeightTrendSection.js`, `mobile/components/WeightHistoryList.js`, `mobile/tests/weight-screen.test.js`, `mobile/tests/weight-goal-read-failure.test.js`, `mobile/tests/weight-history-list-render-isolation.test.js` |
| S7 Analytics / Stats reference | Overview loading/real/partial/error; independent weight/note retry; 7/30-day weight trends with too-few-distinct-days CTA and selected/latest chart values; Routine Health and fatigue feature gates; empty/rough/normal/unanswered check-ins and history editing. Strength incomplete mapping/no cycles/total/progress and calculation disclosure; Big 3 searchable picker; Progressive Overload search/no matches/no tracked lifts, grouped expand/collapse, Est. Max/Kilo Max/best set, weighted and non-weighted evidence, inherited/new tracked span captions and cross-day comparisons. Recovery can promote its section and collapse baseline sections; deep links expand the right content. | `mobile/screens/AnalyticsScreen.js`, `mobile/components/AnalyticsOverviewCard.js`, `mobile/components/AnalyticsWeightTrendsCard.js`, `mobile/components/AnalyticsStrengthSection.js`, `mobile/components/AnalyticsFatigueCard.js`, `mobile/components/AnalyticsCrossDayComparison.js`, `mobile/tests/analytics-screen.test.js` |
| S8 Recovery in Analytics | Unverified/loading, stale/pending/error/retry; active and historical block selection/back-to-active; missing/incompatible/empty frozen baseline, baseline without week, week without evidence, exercise details/categories/comparison, expandable explanations, reason edit with failure, and inclusion toggle with lock/busy state. Do not replace these with a normal strength total. | `mobile/components/AnalyticsRecoverySection.js`, `mobile/components/RecoveryInclusionToggle.js`, `mobile/tests/analytics-recovery-section.test.js`, `mobile/tests/recovery-reason.test.js` |

### More and secondary surfaces

| ID / surface | Meaningful current states and workflows | Evidence |
|---|---|---|
| S9 More menu | Preferences (Profile, Settings), Account & Data (Account, Data & Backup), Help & Support (App Guide, About). Subview return and tab re-entry retain the existing menu/back model; no independent loading/offline screen. | `mobile/screens/MoreScreen.js`, `mobile/tests/app-navigation.test.js` |
| S10 Settings | Fatigue/Deload toggles; appearance Light/Dark/System; lb/kg selection disabled during profile load; session preference versus failed durable save, retry and failure surviving Settings remount; multiplier increment/decrement/bounds/reset. Reminder toggles off/on, permission blocked, unsupported web, scheduling failure, native time pickers, routine-derived days versus fallback weekday selection. No account management, calculator defaults, or timer haptics setting here. | `mobile/components/SettingsScreen.js`, `mobile/components/ReminderSettingsCard.js`, `mobile/tests/profile-write-failure.test.js`, `mobile/tests/reminder-settings-card.test.js` |
| S11 Profile | Initial loading subtitle; empty or existing biological sex/height/DOB/activity; ft/in versus cm input; optional DOB clear, native date picker/browser date entry; busy save, temporary success, save-failure alert, clear-all confirmation and clear-failure alert. Preserve optionality and current stored units; no new profile fields. | `mobile/components/ProfileScreen.js`, `mobile/tests/profile-write-failure.test.js`, `mobile/tests/unit-display-ui.test.js` |
| S12 Account | Unconfigured/offline-local explanation, auth loading, signed-out email/password, sign-in/create/reset busy and status/error, confirmation pending/resend/retry CAPTCHA, configured security verification loading/expiry/error, GitHub auth on supported platforms, signed-in/sign-out and failure. Legal links and health-data consent stay distinct from account identity. | `mobile/screens/more/AccountScreen.js`, `mobile/components/CaptchaChallenge.native.js`, `mobile/components/CaptchaChallenge.web.js`, `mobile/components/CaptchaChallenge.js`, `mobile/screens/more/HealthDataConsent.js`, `mobile/screens/more/LegalLinks.js`, `mobile/tests/account-lifecycle-ui.test.js`, `mobile/tests/health-consent.test.js` |
| S13 Password reset | Recovery-only valid session versus unusable/expired link; new/confirm password validation, busy, failure/status, success and back to sign-in. Entered secret fields and callback semantics are not migration data. | `mobile/screens/more/SetNewPasswordScreen.js`, `mobile/tests/auth-session.test.js`, `mobile/tests/account-lifecycle-ui.test.js` |
| S14 Account destruction | Initial danger disclosure, confirm delete keeping device history versus confirm delete and wipe, pending operation and error/status. Preserve the explicit local/cloud distinction and all confirmations. | `mobile/screens/more/AccountLifecycle.js`, `mobile/tests/account-lifecycle-ui.test.js` |
| S15 Data & Backup | Local JSON export/busy/success/error and unencrypted-data disclosure; separate lossy workout/weight CSV exports; native Android file handling versus browser download/file input; pasted/file JSON, replace-all confirmation, import parse/storage failure and success. Cloud unavailable/signed-out; account export versus local export; sign-out-and-wipe and wipe-required retry/status. Cloud anchor arrival must remain measurable. | `mobile/components/BackupScreen.js`, `mobile/tests/backup-screen.test.js`, `mobile/tests/app-export.test.js`, `mobile/tests/backup-import.test.js` |
| S16 Cloud Sync and consent | Consent absent/review/checkbox/submit/error; authorized, withdrawal disclosure, deletion-pending and client-update-required states; local history upload, foreign-data warning/upload-anyway/cancel, upload/sync busy/failed/retry, queue and last-sync summary, export cloud copy, turn-off sync. Offline queued data remains saved locally. Native alerts and web confirmations are separate presentations of the same actions. | `mobile/screens/more/CloudSyncRecovery.js`, `mobile/screens/more/HealthDataConsent.js`, `mobile/hooks/entries/syncRecoveryHooks.js`, `mobile/tests/sync-recovery-ui.test.js`, `mobile/tests/offline-sync.test.js`, `mobile/lib/platformAlert.js` |
| S17 App Guide | Scrollable guide, syntax reference, terminology and local/cloud explanations, Back. No asynchronous empty/error/sync presentation; content must remain selectable/readable at large text. | `mobile/components/HelpScreen.js`, `mobile/components/WorkoutSyntaxReference.js`, `mobile/tests/workout-syntax-reference.test.js` |
| S18 About | Attribution/version, OTA channel/runtime/bundle diagnostics, check-update busy/result/error and restart-when-ready, legal links and Back. Build information is real, not fabricated screenshot spec identifiers. | `mobile/components/AboutScreen.js`, `mobile/tests/about-screen.test.js` |

Offline is a shared operating mode, not one additional route per screen. Local
Log/Weight/Profile/Settings workflows remain available; a sync failure does not
mean their save failed. Preserve the existing shell summary and individual
save labels, and do not announce “Synced” from local success. Evidence:
`mobile/App.js`, `mobile/components/LogScreenEditorCard.js`,
`mobile/screens/more/CloudSyncRecovery.js`, `mobile/tests/offline-sync.test.js`.

## Shared component inventory

| Family | Components and states that require a visual treatment | Evidence |
|---|---|---|
| UI primitives | Card default/pressable/tone; SectionTitle; Button ordinary/danger/disabled/loading and truthful busy labels; StatCard, Badge status variants, Chip; HeroMetric and set-row size; createInputStyle/useInputStyle; SessionGauge and its feature-gated deload advice; ArtisanalPanel; ErrorBanner/retry. Keep call signatures and semantic labels; surface grouping must be deliberate, not a global card wrapper. | `mobile/components/UI.js`, `mobile/tests/ui-button-a11y.test.js` |
| Parsed workout presentation | WorkoutHeading/Subheading, ExerciseBlock Track/Tracked/disabled, SetLine grouped reps/durations/skips, BW, converted-kg annotation and tappable weight, marks, AnnotationNote, UnparsedRow with/without hint, NoteParseError. WorkoutContentRenderer retains day/group ordering, full versus compact Recovery presentation, rough-session flags, source-jump gestures including screen-reader activation, empty/alternate-week copy, and raw fallback content. | `mobile/components/UI.js`, `mobile/components/WorkoutContentRenderer.js`, `mobile/tests/unit-display-ui.test.js`, `mobile/tests/workout-syntax-reference.test.js` |
| Navigation chrome | TabBar selected/inactive, 2s initial settle, 0.25 faded opacity, scroll response, touch solidification, 1.5s post-touch settle; safe-area bottom placement and measured height. TabBarLayout owns 24px visual gap/64px fallback; ScreenShell owns scroll delegation, measured clearance, Back/headerRight/sticky children, 640px wide-web cap. Preserve timing and scroll behavior; geometry/tokens can migrate. | `mobile/components/TabBar.js`, `mobile/components/TabBarLayout.js`, `mobile/components/ScreenShell.js`, `mobile/tests/tab-bar-safe-area.test.js`, `mobile/tests/screen-shell.test.js` |
| Charts | LineChart fewer-than-two-points placeholder; unmeasured/measured width, true min/max including flat/fractional data, selected/latest readout, header hidden/visible, optional scale and font-scaled gutter; interactive adjustable accessibility actions and web arrows/Escape versus static image description. Marker padding and selection callback semantics survive. Current consumers are Home and Analytics, not WeightScreen. | `mobile/components/LineChart.js`, `mobile/screens/HomeScreen.js`, `mobile/components/AnalyticsWeightTrendsCard.js`, `mobile/components/AnalyticsStrengthSection.js`, `mobile/tests/line-chart.test.js` |
| Execution overlays | RestTimerBanner idle preset 60/90/120/180s, running/cancel, elapsed/dismiss, unavailable-background-alert warning; contextual startOnly and shell-owned running instance. PRMomentBanner is non-modal, dismissible. SessionCheckInModal normal/rough tiers, grouped reasons/side selection/free text, edit history, busy/save failure/back/close. Preserve deferred modal triggers and tab-blur suppression. | `mobile/components/RestTimerBanner.js`, `mobile/components/PRMomentBanner.js`, `mobile/components/SessionCheckInModal.js`, `mobile/tests/session-checkin-tab-blur.test.js`, `mobile/tests/session-checkin-trigger.test.js`, `mobile/tests/rest-timer-banner.test.js` |
| Recovery sheets | Start: baseline and existing/new note eligibility, optional reason, blockers and submit error. Add week: existing/new choice, no eligible note, busy/blocker/error. End: explicit inclusion choices, week summary and errors. All retain native Back/outside/close behavior and keyboard avoidance. RecoveryInclusionToggle also serves Analytics with lock/busy/error semantics. | `mobile/components/RecoveryBlockStartModal.js`, `mobile/components/RecoveryBlockWeekModal.js`, `mobile/components/RecoveryBlockEndModal.js`, `mobile/components/RecoveryInclusionToggle.js` |
| Plate calculator | Read-only tapped-weight target; initial profile load renders nothing, invalid/below-bar/empty-bar/exact-load/remainder states; independent lb/kg equipment profiles, authored-kg target precision; inventory editor bar/count fields, save/cancel/reset, unit switch discards unsaved inventory edit. Existing profile persistence errors are swallowed; there is no visible success/failure/retry contract to redesign. | `mobile/components/PlateCalculatorModal.js`, `mobile/components/UI.js`, `mobile/tests/plate-calculator-modal.test.js` |
| Other dialogs and sheets | WorkoutSyntaxModal with shared syntax reference; Deload completion prompt nested in LogDeloadSection; native Alert confirmations versus WebAlertHost; App ownership overlays; Account CAPTCHA web widget/native WebView. Preserve focus, cancellation, destructive confirmation order, external challenge behavior, and modal ownership. | `mobile/components/WorkoutSyntaxModal.js`, `mobile/components/WorkoutSyntaxReference.js`, `mobile/components/LogDeloadSection.js`, `mobile/components/WebAlertHost.js`, `mobile/lib/platformAlert.js`, `mobile/App.js`, `mobile/components/CaptchaChallenge.native.js`, `mobile/components/CaptchaChallenge.web.js` |
| Forms and controls | Shared input skin is only a style object, not a TextInput wrapper. Custom inputs remain in Log, Recovery, Weight/goal/history, Profile, Plate, Account/reset, Backup JSON, Analytics search/reason and check-in. Native Switch occurs in Settings, Reminders and Recovery inclusion; native dates/times in editor, weight/history/goal, profile and reminders have browser-specific counterparts. | `mobile/components/UI.js`, `mobile/components/LogScreenEditorCard.js`, `mobile/components/LogRecoverySection.js`, `mobile/screens/WeightScreen.js`, `mobile/components/WeightGoalCard.js`, `mobile/components/WeightHistoryList.js`, `mobile/components/ProfileScreen.js`, `mobile/components/ReminderSettingsCard.js`, `mobile/screens/more/SetNewPasswordScreen.js` |

## Native dark-mode wiring: not complete end to end

The JavaScript palette path is wired: persisted preference → ThemeProvider →
resolved mode → themed styles. Explicit Dark works at this layer without asking
native Appearance to change. `mobile/theme/ThemeContext.js` only reads
useColorScheme; it does not call Appearance.setColorScheme. The source's claim
that System follows OS changes is therefore conditional on the scheme native
actually exposes. `mobile/lib/themePreference.js` stores the preference and
`mobile/components/SettingsScreen.js` selects it; neither bridges native chrome.

| Layer | Finding and practical effect | Repository evidence / platform support |
|---|---|---|
| Native configuration | app.json pins userInterfaceStyle to light and app.config.js does not override it. On iOS the generated app appearance is light; native default alerts/pickers and the scheme observed by the app can remain light despite an OS dark setting. A JS dark palette does not remove that native override. | `mobile/app.json`, `mobile/app.config.js`, `mobile/theme/ThemeContext.js`; [Expo SDK 54 configuration](https://docs.expo.dev/versions/v54.0.0/config/app/#userinterfacestyle), [RN 0.81 Appearance](https://reactnative.dev/docs/0.81/appearance) |
| Android qualification | Expo requires expo-system-ui to apply userInterfaceStyle on Android. It is absent from both direct dependencies and the lockfile, so the config string alone does **not** prove Android native chrome is forced light. OS/build defaults may govern instead, independently of Kilo's explicit JS preference. Do not report identical native behavior across platforms without a binary test. | `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json`; [Expo color-theme requirements](https://docs.expo.dev/develop/user-interface/color-themes/) |
| Status bar and safe areas | App explicitly chooses light status-bar glyphs for JS dark mode and dark glyphs for light; React safe-area and outer backgrounds use palette colors. This part is wired. That does not configure every OS surface or Android navigation-bar icon policy. There is no expo-navigation-bar integration, and Android is edge-to-edge. | `mobile/App.js`, `mobile/app.json`, `mobile/package.json`; [Expo system bars](https://docs.expo.dev/develop/user-interface/system-bars/) |
| Keyboard | No TextInput callsite sets keyboardAppearance and there is no application-wide native appearance bridge. iOS keyboardAppearance is a separate iOS-only prop; default keyboard styling follows native appearance, so a dark JS editor can retain a light keyboard under the native light policy. Android keyboards belong to the IME and its settings; the iOS prop cannot promise a dark Android keyboard. | `mobile/components/LogScreenEditorCard.js`, `mobile/screens/WeightScreen.js`, `mobile/components/ProfileScreen.js`, `mobile/screens/more/AccountScreen.js`, `mobile/screens/more/SetNewPasswordScreen.js`, `mobile/theme/ThemeContext.js`; [RN 0.81 TextInput](https://reactnative.dev/docs/0.81/textinput#keyboardappearance-ios) |
| Alerts, dates, switches | platformAlert forwards native calls directly. Native date/time pickers do not receive themeVariant; Settings Switches have no explicit track/thumb palette. Reminders and Recovery inclusion also use native Switch. JavaScript sheet backgrounds repaint, but system controls are not thereby tokenized. Native picker appearance has platform-specific limits; web inputs/widget internals are separate surfaces. | `mobile/lib/platformAlert.js`, `mobile/screens/WeightScreen.js`, `mobile/components/WeightHistoryList.js`, `mobile/components/WeightGoalCard.js`, `mobile/components/ProfileScreen.js`, `mobile/components/LogScreenEditorCard.js`, `mobile/components/SettingsScreen.js`, `mobile/components/ReminderSettingsCard.js`, `mobile/components/RecoveryInclusionToggle.js`; [DateTimePicker appearance options](https://github.com/react-native-datetimepicker/datetimepicker#themevariant-optional-ios-only) |
| Startup and hosted controls | Splash/adaptive-icon backgrounds are static light-era configuration. CAPTCHA content is separately hosted/generated, not a descendant whose CSS comes from useThemedStyles. An OS permission dialog or external OAuth browser cannot be promised an exact Analog Iron skin. | `mobile/app.json`, `mobile/components/CaptchaChallenge.native.js`, `mobile/components/CaptchaChallenge.web.js`, `mobile/screens/more/AccountScreen.js` |

Conclusion: dark React surfaces plus correctly selected status-bar glyphs are
present; native appearance, System preference, keyboard, controls, and startup
are not a verified end-to-end dark implementation. This is a source/config
finding, **not an observation from an installed binary**. The foundation child
must reconcile native appearance and rebuild where required; screen owners
handle their own control styling under the common contract's native control
appearance rule, and D2 enforces it by presence check rather than leaving it to
device vigilance. Do not merely switch the config to automatic
and declare explicit Light/Dark/System synchronized. Evidence:
`mobile/theme/ThemeContext.js`, `mobile/app.config.js`,
`mobile/tests/theme-preference.test.js`, `mobile/tests/theme-rendering.test.js`.

The device matrix for that child is OS light/dark × app Light/Dark/System, cold
launch and live switch, text/secure/decimal keyboards, alerts, date/time pickers,
switches, status/navigation bars, and background/foreground on Android and iOS.
Record the binary/runtime and any untested platform explicitly. Use the actual
development client procedure in `docs/testing-and-qa.md`; web/Jest cannot prove
native chrome. Native config changes follow `mobile/app.config.js`'s runtime
compatibility rule. No config change is made by this audit.

## Handoff gaps and image conflicts

### Unshown states and unresolved decisions

The S0–S18 inventory and shared-component rows are the complete preservation
matrix for the inspected route/render surfaces. The following groups assign
every unshown state there to a design extension or a prerequisite decision;
an image's happy path is never sufficient acceptance coverage.

| Gap | Required disposition / owner | Evidence |
|---|---|---|
| G1 Semantic mapping beyond the supplied roles | Decide mappings for all existing tone fills, on-fill labels, pressed/disabled/focus/selected states, overlays, rough/fatigue and passive trend classifications. Globally mapping current accent to red would color ordinary navigation, links and charts red. Define neutral ordinary accents and explicit execution/exception roles, and measure actual text/fill pairs. D0 decision, D1 tokens, then each consumer owner. | `mobile/theme/colors.js`, `mobile/components/UI.js`, `mobile/components/TabBar.js`, `mobile/components/WeightTrendSection.js`, `mobile/tests/theme-rendering.test.js`, `docs/design/analog-iron-v0.125/visual-language-spec.md` |
| G2 Chart colors (hard prerequisite) | Stats blue-gray fills and Weight trend colors have no approved semantic light/dark contract. D0 must obtain explicit owner-approved roles/values for existing series, selection, axes, grid and comparison markers, including distinctions without color alone. No pixel sampling, invented hex, or unapproved new series. D1 installs the approved roles; D4, D8 and D9 wait. | `docs/design/analog-iron-v0.125/README.md`, `docs/design/analog-iron-v0.125/stats-light.png`, `docs/design/analog-iron-v0.125/weight-light.png`, `mobile/components/LineChart.js`, `mobile/components/AnalyticsStrengthSection.js`, `mobile/components/AnalyticsWeightTrendsCard.js` |
| G3 Font assets and responsive metrics | Handoff names Space Grotesk and bundled mono, but supplies no files, mono family, license or exact native face/weight mapping. Resolve the 800 display-weight request against available font assets without silently relying on synthetic weight. D0 approves family/weight/fallback behavior; D1 bundles/loads; every owning stage sweeps its local sizes, line heights and geometry together. Preserve font scaling and reflow instead of clipping or shrinking below 11px. | `docs/design/analog-iron-v0.125/visual-language-spec.md`, `docs/design/analog-iron-v0.125/README.md`, `mobile/assets/`, `mobile/components/LogScreenEditorCard.js`, `mobile/components/LineChart.js` |
| G4 Global loading/error/offline/sync and first-use | S0/S1/S2/S6/S7/S12/S15/S16 need quiet skeletons, true empty versus failure, retained stale data, retry, local-save versus cloud-pending labels, ownership and consent prompts. Extend written surfaces and semantic status rules; do not add fictitious status. D1 shell; D6/D7/D8/D9/D14/D16 owners. | `mobile/App.js`, `mobile/screens/HomeScreen.js`, `mobile/screens/LogScreen.js`, `mobile/screens/WeightScreen.js`, `mobile/screens/AnalyticsScreen.js`, `mobile/screens/more/CloudSyncRecovery.js` |
| G5 Editor/execution states | S2–S5 plus shared parsed rows, draft/adoption/errors, raw text and rendered views, source jumps, A/B, skips, problem disclosure, optional check-in and timer/PR overlap lack a full layout specification. Extend tokens while retaining measured selection and all controls; do not implement screenshot-only quick-insert/Done semantics. D3/D5/D7/D10. | `mobile/components/LogScreenEditorCard.js`, `mobile/components/WorkoutContentRenderer.js`, `mobile/screens/LogScreen.js`, `mobile/components/SessionCheckInModal.js`, `mobile/components/RestTimerBanner.js` |
| G6 Recovery and Deload | No dedicated reference for S4/S5/S8: pending/stale/locked, baseline failure, week lifecycle, reason/inclusion and historical drilldowns all need compact open sections and readable sheets. D5 modal/control treatment, D7 Log, D8 Analytics. | `mobile/components/LogDeloadSection.js`, `mobile/components/LogRecoverySection.js`, `mobile/components/AnalyticsRecoverySection.js`, `mobile/components/RecoveryBlockEndModal.js` |
| G7 Weight and Analytics non-happy paths | S6/S7 need edit/filter/history-empty/pagination, optional date/note, goal lifecycle/pace warnings, feature-off, partial mapping, no cycles, tracked-span captions, no search matches, chart selection/flat/fractional/empty and larger text. D4/D8/D9 extend the written hierarchy using current data only; screenshot-only metrics remain excluded. | `mobile/screens/WeightScreen.js`, `mobile/components/WeightHistoryList.js`, `mobile/components/WeightGoalCard.js`, `mobile/screens/AnalyticsScreen.js`, `mobile/components/LineChart.js` |
| G8 Secondary routes and settings | S9–S18 except the representative Settings state have no supplied screen. Preserve all menu entries, feature toggles, reminders/permission failure, optional profile, guide, diagnostic, auth/reset/consent/destructive/export/import states with the same typography/input/divider rules. D11–D18; shared dialogs D3. | `mobile/screens/MoreScreen.js`, `mobile/components/SettingsScreen.js`, `mobile/components/ProfileScreen.js`, `mobile/components/HelpScreen.js`, `mobile/components/AboutScreen.js`, `mobile/components/BackupScreen.js`, `mobile/screens/more/` |
| G9 Platform and accessibility exceptions | Native switches/pickers/alerts, keyboard and hosted CAPTCHA cannot be inferred from raster screenshots. D0 records approved treatment/OS-owned limits; D1 reconciles appearance; every screen owner verifies own native controls, focus, accessible names, touch targets and large text. Do not replace security/permission controls or invent a new modal framework to satisfy a picture. | `mobile/lib/platformAlert.js`, `mobile/components/WebAlertHost.js`, `mobile/components/CaptchaChallenge.native.js`, `mobile/components/ReminderSettingsCard.js`, `mobile/tests/interaction-target-a11y.test.js` |
| G10 Calculator loading/inventory/failure | Only one lb result is pictured. Preserve kg and authored-kg precision, no plates/below bar/remainder, custom counts, unit-switch draft discard, invisible profile load and existing persistence-error limitation. Style those existing states; new persistence recovery or a target editor would need separate behavior authorization. D10. | `mobile/components/PlateCalculatorModal.js`, `mobile/tests/plate-calculator-modal.test.js` |

### Reference conflicts: apply these resolutions, not the pictured behavior

| Reference | Conflict with current functionality or written rules | Resolution and code evidence |
|---|---|---|
| `docs/design/analog-iron-v0.125/home-light.png`, `docs/design/analog-iron-v0.125/home-dark.png` | Scheduled session/day-of-five, estimated duration, target exercise/progress bar, sets completed and Start/Resume imply a scheduling/execution model absent from current Home. The seven-day planned/completed strip and block-relative lift delta are not current dashboard outputs. | Restyle the actual current routine/Recovery entry action, latest weight, sparkline, classifications, goal and 1K. Do not invent a schedule, completion counters, duration estimate, plan strip, recent-log count or new “program routine” route. Sources: `mobile/screens/HomeScreen.js`, `mobile/screens/home/homeDashboardData.js`, `mobile/App.js`. |
| `docs/design/analog-iron-v0.125/log-light.png`, `docs/design/analog-iron-v0.125/log-dark.png` | Combined line-numbered rendered editor, target RPE, per-set Done, quick Group/Item/PR/Note/Plate insertion, Add Line and Finish Session do not describe the current multiline-editor/read-view distinction. A screenshot Track control must not become a completion control. | Preserve raw input, rendered parser output, Track/Tracked, actual Done/save, source jump and problem tools. Keep marks/user annotations; no parser additions or set-completion records. Sources: `mobile/components/LogScreenEditorCard.js`, `mobile/components/WorkoutContentRenderer.js`, `mobile/components/UI.js`, `mobile/screens/LogScreen.js`. |
| Log timer in both images | +30s/Skip and a 3:00 track imply actions not exposed by the timer. The pictured timer is Log-only, whereas elapsed/running feedback is shell-owned across tabs. | Keep actual presets, Cancel, Dismiss and unavailable-background-alert warning, plus its existing lifecycle; any track may only represent already available timer evidence and cannot add a new control. Sources: `mobile/components/RestTimerBanner.js`, `mobile/App.js`, `mobile/hooks/useRestTimer.js`. |
| `docs/design/analog-iron-v0.125/weight-light.png` | Hero-first form, +/- weight stepper, time-of-weigh-in, fixed 14-day daily/average/target graph, five-row history with per-row average/delta and in-screen CSV export differ from current entry-first, trend-table, filtered/paginated history. | Preserve immediate Save/Update, optional note/date and goal/archive workflow, current trends/history fields and CSV location in Backup. Do not add graph series, timestamps, stepper or medical coaching copy. Sources: `mobile/screens/WeightScreen.js`, `mobile/components/WeightHistoryList.js`, `mobile/components/WeightGoalCard.js`, `mobile/components/BackupScreen.js`. |
| `docs/design/analog-iron-v0.125/stats-light.png` | 4W/12W/1Y/ALL controls, Wilks/class, split percentages, weekly volume bar chart, average RPE, verified-record table and IPF/version footer are not current Analytics outputs. Its simple hierarchy omits fatigue/recovery/overload/mapping controls; the volume label is clipped. | Preserve actual Overview, 7/30-day trends, 1K-cycle chart/mapping, overload and Recovery hierarchy. Do not add formulas, certification, filters or record types. Render actual labels without reproducing clipping; chart colors wait for D0. Sources: `mobile/screens/AnalyticsScreen.js`, `mobile/components/AnalyticsStrengthSection.js`, `mobile/components/AnalyticsWeightTrendsCard.js`, `docs/design/analog-iron-v0.125/README.md`. |
| `docs/design/analog-iron-v0.125/settings-light.png`, `docs/design/analog-iron-v0.125/settings-dark.png` | Account/cloud/export/wipe have been moved into pictured Settings; default rest time, calculator enable/default bar and timer haptics are not Settings controls. “Standard Tier,” fabricated account identifier, online claims, and screenshot version are not live product fields. Existing fatigue, deload, reminders and multiplier are omitted. | Keep More → Account and Data & Backup destinations, Settings' current options, and exact destructive distinctions. No new controls, subscription identity or fake sync status. Sources: `mobile/screens/MoreScreen.js`, `mobile/components/SettingsScreen.js`, `mobile/components/ReminderSettingsCard.js`, `mobile/components/BackupScreen.js`, `mobile/screens/more/AccountLifecycle.js`. |
| `docs/design/analog-iron-v0.125/plate-calculator-light.png` | Strict-lb adjustable target, named 35/45/55lb bar presets, Apply to Log Row, symmetric sleeve drawing with collar assertions, total-count manifest, reset-to-45 action and “live synchronized” footer are not the current read-only tapped target plus editable per-unit inventory. | Keep lb/kg profile selection, computed per-side rows/remainder and reset-current-unit behavior. A schematic may only depict existing computed plate counts, without asserting unmodeled sleeve/collar dimensions. No target editing or log write-back. Sources: `mobile/components/PlateCalculatorModal.js`, `mobile/components/UI.js`, `mobile/lib/plateMath.js`. |
| All nine exports in `docs/design/analog-iron-v0.125/` | Red active tabs/profile icons/date accents and enclosing boxes/shadows conflict with restrained red/open-canvas/flat written rules. Some images rename Analytics to Stats or More to Settings, add profile shortcuts, and replace floating text tabs with fixed icon navigation. | Written component rules control appearance; existing tab destinations and opacity/scroll/settle behavior stay intact. Passive active selection uses approved neutral roles. Sources: `docs/design/analog-iron-v0.125/visual-language-spec.md`, `mobile/components/TabBar.js`, `mobile/components/ScreenShell.js`, `mobile/App.js`. |
| Dark Home/Log/Settings exports | Stale light red, narrow wrapping, clipped or overlapping rows and dim small labels are explicitly qualified artifacts. | Use written dark red, responsive height/reflow and inkMuted for text; never infer a sub-11px exception or use decoration-only inkSubtle for labels. Sources: `docs/design/analog-iron-v0.125/dark-mode-implementation-note.md`, `docs/design/analog-iron-v0.125/README.md`. |
| Copy across the package | SETTINGS LEDGER, LEDGER #8402, TRAINING LEDGER PREFERENCES, AUTO DUAL-PASS, ACTIVE MOTOR PREP, TELEMETRY, MANIFEST, CALCULATION PROTOCOL and invented spec/version IDs are visibly present but rejected. | Preserve human Kilo concepts and existing copy where behavior is unchanged; do not rewrite user-authored notes or diagnostics through a banned-copy filter. Sources: `docs/design/analog-iron-v0.125/README.md`, `docs/design/analog-iron-v0.125/visual-language-spec.md`, `mobile/components/WorkoutSyntaxReference.js`, `mobile/components/AboutScreen.js`. |

## Named-file regression risks

| Risk | Why a visual sweep can break behavior; required verification |
|---|---|
| `mobile/App.js`, `mobile/components/TabBarLayout.js`, `mobile/components/TabBar.js`, `mobile/components/ScreenShell.js` | New typography changes measured tab height, keyboard space and timer clearance. Preserve mounted tabs, memoized callbacks, back delegation and opacity timings. Check `mobile/tests/app-shell-render-isolation.test.js`, `mobile/tests/app-shell-back.test.js`, `mobile/tests/tab-bar-safe-area.test.js` and device scroll/timer/keyboard overlap. |
| `mobile/components/LogScreenEditorCard.js` | Font, line height, padding and border changes affect mirrored text measurement and source selection; a persistent selection prop can pin the caret. Preserve one-shot jumps, validation debounce, cursor ownership and save-status announcements. Check `mobile/tests/exercise-source-jump.test.js`, `mobile/tests/log-editor-card-saving-state.test.js`, `mobile/tests/save-status-region.test.js` and a long wrapped note on device. |
| `mobile/screens/log/useLogCurrentRoutineEditor.js`, `mobile/screens/log/useLogOtherRoutineEditor.js`, `mobile/screens/log/useLogDeloadEditor.js` | Draft identity, first-save/adoption, save-and-switch and modal triggering are hook-owned. These are read-only dependencies, not visual migration targets. Run `mobile/tests/log-current-editor-drafts.test.js`, `mobile/tests/log-other-editor-drafts.test.js`, `mobile/tests/session-checkin-tab-blur.test.js` without rewriting hooks to fit layout. |
| `mobile/components/UI.js`, `mobile/components/WorkoutContentRenderer.js`, `mobile/components/PlateCalculatorModal.js` | Grouping sets must retain kg provenance, durations, skips and accessible tap-to-plate behavior. Text/geometry changes cannot alter parsing or write back a calculated target. Check `mobile/tests/unit-display-ui.test.js`, `mobile/tests/workout-syntax-reference.test.js`, `mobile/tests/plate-calculator-modal.test.js`. |
| `mobile/components/LogRecoverySection.js`, `mobile/components/AnalyticsRecoverySection.js`, `mobile/screens/LogScreen.js` | Flattening hierarchy can accidentally hide mutation locks, inline edits, pending reconciliation or inclusion consequences. Preserve active-training context and each lifecycle action; check `mobile/tests/log-recovery-hierarchy.test.js`, `mobile/tests/log-recovery-save-status.test.js`, `mobile/tests/analytics-recovery-section.test.js`. |
| `mobile/components/LineChart.js`, `mobile/components/AnalyticsStrengthSection.js`, `mobile/components/AnalyticsWeightTrendsCard.js` | Axis font scaling, true data extent, marker insets and adjustable traversal are functional. Do not turn an interactive chart into a static image or change the plotted cycle population. Check `mobile/tests/line-chart.test.js`, `mobile/tests/analytics-weight-trends-card.test.js`, `mobile/tests/one-k-progress-consistency.test.js`. |
| `mobile/screens/WeightScreen.js`, `mobile/components/WeightHistoryList.js`, `mobile/components/WeightGoalCard.js` | A hero-first redraw can bury entry or lose note/date drafts; font changes can clip filtered history and goal warnings. Preserve midnight/date and canonical-unit behavior, source-specific error retry and edit failure retention. Check `mobile/tests/weight-screen.test.js`, `mobile/tests/weight-goal-read-failure.test.js`, `mobile/tests/unit-display-ui.test.js`. |
| `mobile/components/SettingsScreen.js`, `mobile/components/ProfileScreen.js`, `mobile/components/ReminderSettingsCard.js` | Optimistic preference can differ from durable storage; reminders depend on permission and inferred days. Native controls and large-text rows need device checks; preserve failure/retry and optional profile fields. Check `mobile/tests/profile-write-failure.test.js`, `mobile/tests/reminder-settings-card.test.js`. |
| `mobile/components/BackupScreen.js`, `mobile/screens/more/AccountLifecycle.js`, `mobile/screens/more/CloudSyncRecovery.js`, `mobile/screens/more/HealthDataConsent.js` | Simplifying danger/consent copy could reverse local-versus-cloud scope or remove a confirmation. Keep callbacks, busy guards and verbatim disclosures; use disposable device fixtures for destructive-state sign-off, not the owner's real history. Check `mobile/tests/account-lifecycle-ui.test.js`, `mobile/tests/sync-recovery-ui.test.js`, `mobile/tests/backup-screen.test.js`. |
| `mobile/screens/more/AccountScreen.js`, `mobile/screens/more/SetNewPasswordScreen.js`, `mobile/components/CaptchaChallenge.native.js`, `mobile/components/CaptchaChallenge.web.js` | Theme changes must not disturb callback, password, challenge expiry/retry or hosted-widget protocols. Visual-only edits need a security-sensitive scoped review and native/web interaction evidence. Existing contracts: `mobile/tests/auth-session.test.js`, `mobile/tests/account-lifecycle-ui.test.js`. |
| `mobile/theme/colors.js`, `mobile/theme/ThemeContext.js`, `mobile/app.json`, `mobile/app.config.js` | Existing AA assertions, native appearance and font startup can regress independently. Verify actual role pairs, preference transitions, font failure fallback and a matching native runtime; don't use Jest color mocks as device proof. Sources: `mobile/tests/theme-rendering.test.js`, `mobile/tests/theme-preference.test.js`, `mobile/tests/app-config.test.js`. |

## In-flight work and sequencing boundaries

These are sequencing observations, not authority to update, rebase, supersede,
close or absorb other PRs. Their status below follows the owner assignment;
the file overlaps were checked against the linked PR file lists. New files in
those PRs are not treated as existing main routes or cited as existing files.

| Existing work | Relevant overlap and migration consequence |
|---|---|
| [#957 / PR #974](https://github.com/bpronin90/kilo/pull/974), frozen | Shares current/previous-routine presentation, routine-share dependency and mobile manifest/lockfile. Existing main paths: `mobile/components/LogActiveRoutineCard.js`, `mobile/components/LogPreviousRoutines.js`, `mobile/lib/interoperability/routineShare.js`, `mobile/package.json`, `mobile/package-lock.json`, `mobile/tests/log-screen.test.js`. Keep frozen; D1/D7 must not adopt its proposed share-card implementation. Resume only under owner sequencing after foundations. |
| [#969 / PR #972](https://github.com/bpronin90/kilo/pull/972), frozen | Test-only overlap in `mobile/tests/log-screen.test.js`. Preserve current tests as behavioral evidence; don't import this PR's assertions or rewrite its branch. Coordinate resumption after D7 ownership is released. |
| [#959 / PR #973](https://github.com/bpronin90/kilo/pull/973), draft | Changes analytics/parser calculations, not this visual program. Existing shared dependencies include `mobile/lib/data/workoutAnalytics.js`, `mobile/lib/data/progressionSuggestions.js`, `mobile/lib/parser/analytics.js`, `mobile/lib/parser/deloadHistory.js`, `docs/calculations-reference.md`. D8 must not absorb the calculation work; if independently landed later, recheck displayed metric meaning against its accepted contract. |
| [#955 / PR #971](https://github.com/bpronin90/kilo/pull/971), open/unapproved | Overlaps `mobile/App.js`, `mobile/screens/MoreScreen.js`, `mobile/screens/log/useLogOtherRoutineEditor.js`, `mobile/lib/interoperability/routineShare.js`; proposes an import surface absent from main. D1/D11 preserve current route vocabulary. If the owner later lands it, separately scope its visual migration; don't invent its screen here or preapprove the PR. |
| [#936](https://github.com/bpronin90/kilo/pull/936), separate security work | Mobile dependency-lock overlap (`mobile/package-lock.json`) matters to D1 dependency changes. It is not blocked by the UI program's pause and is not a design dependency to absorb; resolve ordering with the owner if it lands first. |
| #956, #960, #961, #962 alongside #957/#969 | #978 explicitly pauses overlapping Log/Analytics/sharing work. Core owners are `mobile/screens/LogScreen.js`, `mobile/screens/AnalyticsScreen.js`, `mobile/components/LogActiveRoutineCard.js`, `mobile/components/LogPreviousRoutines.js`. The foundation gate below establishes eligibility to resume, not permission to work simultaneously in those files. |

The literal file-ownership constraint prevents separate whole-app font and radius
sweeps followed by screen cards: those would all edit the same screen files.
Instead D1 supplies palette/type/geometry foundations, D3 supplies shared
primitives/chrome, and each later owner applies **typography, radius, borders,
red-role correction and screen layout in one pass** to its exclusive files.
This is a deliberate adjustment to #978's illustrative child list, permitted by
its “subject to what the audit actually finds” wording. Evidence for the
distributed styles: `mobile/components/UI.js`, `mobile/screens/LogScreen.js`,
`mobile/screens/HomeScreen.js`, `mobile/screens/WeightScreen.js`.

The paused work's “palette, typography, radius and shared primitives landed” gate
is fully met only after every applicable file-owner sweep has landed; a new token
module alone is not a completed typography/radius migration. Relevant owners
must release their files before overlapping feature work resumes. An owner may
sequence a feature after its final visual owner while unrelated owners proceed,
but none of the listed PRs is automatically unfrozen by this document.

## Implementation-ready child issue drafts

### Common contract, incorporated into every card below

- **Goal boundary:** implement the stated visual slice and preserve every
  applicable S/G inventory entry, source callback, data value, state distinction
  and workflow. No parser/data/storage/backend changes, new navigation, generic
  card UI, decorative red, faux-technical copy or sub-11px mobile text.
- **Behavior-change escalation:** behavior is fixed; only appearance changes.
  If a card cannot meet the visual target without altering behavior, state,
  timing, ordering, copy meaning or a data value, it **stops and escalates to the
  owner for explicit written approval** before proceeding. It does not resolve the
  conflict in either direction on its own and does not silently choose a visual
  compromise. Record every such escalation and its disposition in the card's
  handoff. A reference image is never sufficient authority for a behavior change.
- **Native control appearance:** the native-appearance findings above are owned
  here, not by D1, whose write set cannot reach these callsites. Any card whose
  Allowed Files contain a `TextInput` sets `keyboardAppearance` from the resolved
  theme; a `Switch` sets `trackColor`/`thumbColor` from tokens; a
  `DateTimePicker` sets `themeVariant`. This binds D5, D7, D9, D12, D13, D14 and
  D15 on the callsites named in the native dark-mode section. Adding a
  theme-driven appearance prop to an existing control is an appearance change;
  altering what a control does is a behavior change and escalates.
- **Allowed Files:** each card's exact list below is its exclusive write set.
  Tests named only under Verification are read/run dependencies, not additional
  write permission. No screen card edits the foundation or shared files. A need
  to do so blocks that card pending owner contract correction; do not quietly
  broaden scope. Existing-directory entries below explicitly name the only new
  artifacts permitted inside them, so all repository path citations exist today.
- **Acceptance criteria:** both themes follow the written handoff, preserve
  accessibility names/roles/focus and existing touch targets, reflow long labels
  at larger OS text sizes, and distinguish 1px hairlines from 1.5px frames.
  Consumer-owned files complete their own typography/geometry sweep; inherited
  shared components keep their already-approved treatment.
- **Verification:** run targeted existing tests named on the card using
  `npm --prefix mobile test -- --runInBand --runTestsByPath` followed by those
  paths relative to mobile (remove their leading `mobile/`), plus focused
  anti-pattern checks once D2 lands and
  `npm run check:changes`. Trust the ordinary exact-head CI suite and review;
  no repeated full local suite. Existing test commands/configuration are in
  `mobile/package.json`, `package.json`, `.github/workflows/test.yml`.
- **Device sign-off requirement (every implementation child):** owner device
  sign-off is a **closing requirement**, scoped to this program by #978. Use
  `docs/testing-and-qa.md`'s development-client loop, record full tested commit,
  device/OS, runtime/build, light/dark and large-text results, applicable state
  checklist and owner approval. Android and iOS differences must be exercised
  or explicitly recorded as an outstanding gap for owner disposition; web is
  supplemental. Never claim device sign-off from screenshots or Jest. D0 is a
  decision prerequisite requiring owner approval; D2 also needs owner sign-off
  that enforcement does not prevent the installed app's current flows.
- **Dependencies/order:** all cards wait for owner approval of this audit.
  D0 → D1 → D2 → D3 → D4 → D5; then D6–D18 can be delivered in the order
  below, each against landed prerequisites. D6–D18 have disjoint files, so
  independent scheduling is possible after shared prerequisites, but frozen
  feature work stays under the preceding sequencing gate. Each stage can be
  opened and checked in the installed app before proceeding; no stage requires
  an unlanded sibling to render.
- **Docs/fragments:** D1 alone owns the living implementation-map/rules update
  and must make it explicit which legacy consumers remain, referring to this
  fixed stage manifest and code rather than claiming all screens migrated.
  D2 owns enforcement documentation in its script. D0 owns approved handoff
  decisions. Each eventual user-visible child gets only its own issue-numbered
  fragment in `.changes/`, under `scripts/changelog-fragments.mjs`'s format;
  allocate that single unique file when actual card numbers exist. No shared
  fragment, version or CHANGELOG edit. **#978 adds no fragment.**

### D0 — Prerequisite chart tokens and remaining visual decisions

**Goal:** close G1/G2/G3/G9 with owner-approved decisions before code consumes
unspecified colors, font assets or native-control treatments. Chart colors are
a dedicated required decision on this card, not a screenshot-sampling task.

**Allowed Files:** `docs/design/analog-iron-v0.125/README.md`,
`docs/design/analog-iron-v0.125/visual-language-spec.md`,
`docs/design/analog-iron-v0.125/dark-mode-implementation-note.md`.

**Acceptance criteria:** publish explicit light/dark chart-role values and
non-color distinctions for current LineChart consumers; clarify that the
Weight/Stats screenshot-only chart types/data are not authorized. Record a
complete old-role → approved-role mapping with AA on actual/pressed fills,
neutral passive accent treatment, bundled mono choice/license, Space Grotesk
available-weight mapping including the requested 800, loading/fallback behavior,
and native/hosted control exceptions. Obtain owner approval; unresolved values
remain blockers, never guessed defaults.

**Owner decision recorded 2026-09-07 — chart roles.** Chart strokes, point
markers and axis marks use a **neutral ink** role in both themes: dark iron on
newsprint in light, warm off-white on iron in dark. **Vermilion is never a
chart's ordinary series colour**; it appears in a chart only to mark an
exceptional or execution state, consistent with the program-wide rule that red
is never decoration. `LineChart`'s `color` prop keeps its current contract but
its default stops resolving to a red accent. Any chart showing more than one
series must distinguish them by **more than colour** (dash pattern or marker
shape). D0 transcribes this into the handoff spec files and still owes the exact
light/dark values, the selected-vs-unselected marker fills at AA against real
backgrounds, and the remaining font/native-control decisions.

**Verification:** inspect `mobile/theme/colors.js`,
`mobile/components/LineChart.js`, `mobile/components/AnalyticsStrengthSection.js`,
`mobile/components/AnalyticsWeightTrendsCard.js` against the decisions; check
contrast for actual role pairs and `npm run check:changes`. Owner reviews the
proposed roles alongside current device Stats/Weight states; no code/device
migration is claimed. **Order:** first; D1/D4/D8/D9 are blocked until accepted.

### D1 — Palette, font/geometry foundation and native appearance bridge

**Goal:** retint the existing two palettes, bundle the approved fonts, expose
type/spacing/radius/border roles, and reconcile explicit/System native appearance.
Migrate the App shell's own typography/geometry and S0 overlays in this slice.

**Allowed Files:** `mobile/theme/` (existing files and new typography/geometry
modules only), `mobile/lib/themePreference.js`, `mobile/App.js`,
`mobile/app.json`, `mobile/app.config.js`, `mobile/package.json`,
`mobile/package-lock.json`, `mobile/assets/` (new approved font files and their
license notices only; no icon/image changes), `mobile/tests/theme-rendering.test.js`,
`mobile/tests/theme-preference.test.js`, `mobile/tests/app-config.test.js`,
`mobile/tests/app-startup.test.js`, `docs/design-system-map.md`,
`docs/ui-design-rules.md`, `docs/testing-and-qa.md`, `docs/phone-runbook.md`.

**Acceptance criteria:** preserve palette keys/factories and preference storage
semantics; add D0's approved roles without mapping every accent to red. Promote
expo-font directly with the SDK-compatible version and bundle the approved
proportional/mono faces. Font readiness/failure must not lose drafts or leave
startup blank. Provide reusable complete type styles including line height.
Reconcile native Appearance with explicit/System choice without a feedback loop
that mistakes an app override for OS preference. Address native config/runtime
compatibility, startup surfaces and status/navigation chrome within this scope;
do not upgrade SDK or absorb #936/#971/#974. Map/rules describe foundations and
remaining stage owners truthfully, so later screen work need not share doc files.

**Verification:** allowed theme/config/startup tests, plus
`mobile/tests/app-workout-hydration.test.js`,
`mobile/tests/app-shell-render-isolation.test.js`,
`mobile/tests/app-update-banner.test.js`. Device sign-off: full native appearance
matrix above, cold font load/fallback, Home → Settings theme change, shell
ownership prompt and active timer with keyboard/tab changes. **Order:** after D0;
new compatible native build precedes later device sign-offs.

### D2 — Incremental visual anti-pattern enforcement

**Goal:** prevent new or migrated files from reintroducing forbidden geometry,
colors, copy and text sizes without requiring a whole-app rewrite in one commit.

**Allowed Files:** `package.json`, `.github/workflows/test.yml`, `scripts/`
(only new files named `check-analog-iron.mjs` and `check-analog-iron.test.mjs`).

**Acceptance criteria:** build/CI check rejects radius above 2, shadow/elevation,
hardcoded UI hex outside the token authority, banned authored UI copy, and text
below 11px in changed production presentation files. Include complete-file
checking for each touched presentation file, not just added lines. Initially
untouched legacy files are reported as migration debt; provide an explicit
whole-program mode for final verification. Token definitions, numeric icon/SVG
geometry, native config assets, tests, documentation quotes and user input are
not mistaken for authored UI violations. Assert **presence** as well as absence:
flag a `TextInput` without `keyboardAppearance`, a `Switch` without
`trackColor`/`thumbColor`, and a `DateTimePicker` without `themeVariant`, because
an omitted prop is structurally invisible to a forbidden-pattern scan and would
otherwise reach release behind manual device vigilance alone. Use parsing/fixtures to cover aliases,
style arrays and common expressions; manual review still verifies semantic red
usage and AA. Do not edit screen files or a per-stage mutable allowlist.

**Verification:** script self-tests exercise positive/negative fixtures and a
representative clean/legacy diff; run on the real branch without failing unrelated
untouched legacy debt. Wire CI without altering unrelated test/security gates.
Device sign-off: unchanged Home/Log/Settings can still build and open in the D1
client. **Order:** after D1, before consumer sweeps; final screen owner runs the
whole-program mode read-only and reports any remaining owner-specific defect.

### D3 — Shared primitives, parsed content, syntax help and navigation chrome

**Goal:** migrate shared styles and navigation geometry once, retaining all
primitive APIs and S2/S3/S17 interactions.

**Allowed Files:** `mobile/components/UI.js`,
`mobile/components/WorkoutContentRenderer.js`, `mobile/components/TabBar.js`,
`mobile/components/TabBarLayout.js`, `mobile/components/ScreenShell.js`,
`mobile/components/WebAlertHost.js`, `mobile/components/WorkoutSyntaxModal.js`,
`mobile/components/WorkoutSyntaxReference.js`, `mobile/tests/ui-button-a11y.test.js`,
`mobile/tests/interaction-target-a11y.test.js`, `mobile/tests/screen-shell.test.js`,
`mobile/tests/tab-bar-safe-area.test.js`, `mobile/tests/workout-syntax-reference.test.js`.

**Acceptance criteria:** migrate every shared-component inventory primitive,
including gauge/parse error/input/tone variants; remove shared shadows and all
local oversized radii/10px text. Open canvas is the default grouping treatment;
forms/execution/sheets retain purposeful surfaces. Preserve Track/span meaning,
kg/duration/skipped/marked rows and source gestures. Preserve floating tab
opacity, settle/scroll/touch timings, destinations, safe areas and measured
clearance. Keep native platformAlert unchanged and web dialog callbacks/focus.

**Verification:** allowed tests plus `mobile/tests/unit-display-ui.test.js` and
`mobile/tests/app-shell-back.test.js`. Device sign-off: all five tabs, settled and
scrolling tab bar, parsed long routine/BW/kg/skipped rows, syntax sheet, button
busy/error variants and keyboard clearance at large text. **Order:** after D2;
no new chart behavior (D4 owns LineChart).

### D4 — Shared LineChart visual/accessibility migration

**Goal:** apply approved chart roles and typography to the existing chart API.

**Allowed Files:** `mobile/components/LineChart.js`, `mobile/tests/line-chart.test.js`.

**Acceptance criteria:** consume D0/D1 chart tokens, replace the 10px scale,
retain selected/latest/header modes, measured width/gutter, true min/max, flat
data, marker insets, point callbacks and native adjustable/web-keyboard actions.
No new chart type, interpolation rule, target series or calculation.

**Verification:** allowed test; device sign-off: Home static sparkline and
Analytics interactive weight/1K charts, insufficient/flat/fractional series,
long scaled labels, VoiceOver/TalkBack selection and clear action; web arrow/Escape
supplement. **Order:** after D3 and approved chart decisions; before D6/D8/D9.

### D5 — Shared workout, check-in and Recovery overlays

**Goal:** restyle execution feedback and Recovery sheets while preserving modal
ownership, mutations and S3/S5/S8 states.

**Allowed Files:** `mobile/components/RestTimerBanner.js`,
`mobile/components/PRMomentBanner.js`, `mobile/components/SessionCheckInModal.js`,
`mobile/components/RecoveryBlockStartModal.js`,
`mobile/components/RecoveryBlockWeekModal.js`,
`mobile/components/RecoveryBlockEndModal.js`,
`mobile/components/RecoveryInclusionToggle.js`,
`mobile/tests/rest-timer-banner.test.js`, `mobile/tests/pr-moment-banner.test.js`,
`mobile/tests/session-checkin-modal.test.js`.

**Acceptance criteria:** all shared overlay states fit large text/keyboard;
recovery-end 10px text becomes an approved size. Use red only for real execution
or exceptional meaning. Preserve preset/Cancel/Dismiss timer controls, shell
versus contextual instance, check-in tiers/reasons/edit/failure and lifecycle
eligibility/busy/error/inclusion. Do not add +30s/Skip, timer persistence changes,
or new triggers; style native inclusion control without changing its meaning.

**Verification:** allowed tests plus `mobile/tests/session-checkin-trigger.test.js`,
`mobile/tests/session-checkin-tab-blur.test.js`, `mobile/tests/recovery-reason.test.js`.
Device sign-off: timer through a tab switch/background/elapsed state, PR plus
check-in, rough form with keyboard, start/add/end Recovery and failed submit.
**Order:** after D4; before screen-owner work.

### D6 — Home migration

**Goal:** apply the launchpad visual hierarchy to S1's real dashboard evidence.

**Allowed Files:** `mobile/screens/HomeScreen.js`,
`mobile/tests/home-screen.test.js`, `mobile/tests/home-dashboard.test.js`.

**Acceptance criteria:** preserve every S1 and Home conflict resolution; migrate
all local type/radius/borders/semantic colors and fixed-orange wordmark fills to
the approved treatment. Preserve independent Log/Weight entry, Recovery routing,
all analytics links and source-specific retry. No calendar/schedule/estimated
duration or fake session/completion metric.

**Verification:** allowed tests plus `mobile/tests/active-training-context-consumers.test.js`.
Device sign-off: empty, populated, source error, offline queued/retry, Recovery
open/between/stale, no weigh-in, partial 1K and long goal text in both themes.
**Order:** after D5; D4 chart already usable.

### D7 — Log, editor, Deload and inline Recovery migration

**Goal:** migrate the single Log route and its local views while retaining
S2–S5's full authoring and workout workflows.

**Allowed Files:** `mobile/screens/LogScreen.js`,
`mobile/components/LogEmptyState.js`, `mobile/components/LogActiveRoutineCard.js`,
`mobile/components/LogPreviousRoutines.js`, `mobile/components/LogScreenEditorCard.js`,
`mobile/components/LogDeloadSection.js`, `mobile/components/LogRecoverySection.js`,
`mobile/tests/log-screen.test.js`, `mobile/tests/log-editor-card-saving-state.test.js`,
`mobile/tests/save-status-region.test.js`, `mobile/tests/exercise-source-jump.test.js`,
`mobile/tests/log-recovery-hierarchy.test.js`, `mobile/tests/log-recovery-save-status.test.js`.

**Acceptance criteria:** complete local type/radius/border/shadow sweep, including
measured editor/mirror styles and recovery inline form; preserve all saving,
draft, selection, problem, A/B/skip, adoption, share, deload and recovery
transitions. First save remains deliberate; Track remains independent. Keep
hooks/parser/helpers read-only, don't import #974 share UI or #972 test changes,
and don't copy screenshot quick-insert/per-set Done/Finish controls.

**Verification:** allowed tests plus `mobile/tests/first-use-workout-note-flows.test.js`,
`mobile/tests/log-current-editor-drafts.test.js`,
`mobile/tests/log-other-editor-drafts.test.js`,
`mobile/tests/logging-speed-benchmark.test.js`. Device sign-off: long wrapped note
with problem/source jumps and caret movement, save failure/retry and tab-return
draft, offline saved/pending labels, current/previous/A/B/skip/share, generated
deload/completion, Recovery inline save/end/reopen and keyboard/modal overlap.
**Order:** after D5; overlapping frozen work waits until this owner releases files.

### D8 — Analytics (Stats) migration

**Goal:** migrate S7/S8 using current analytics meaning and approved chart roles.

**Allowed Files:** `mobile/screens/AnalyticsScreen.js`,
`mobile/components/AnalyticsOverviewCard.js`,
`mobile/components/AnalyticsStrengthSection.js`,
`mobile/components/AnalyticsWeightTrendsCard.js`,
`mobile/components/AnalyticsFatigueCard.js`,
`mobile/components/AnalyticsCrossDayComparison.js`,
`mobile/components/AnalyticsRecoverySection.js`,
`mobile/tests/analytics-screen.test.js`,
`mobile/tests/analytics-strength-section-labels.test.js`,
`mobile/tests/analytics-weight-trends-card.test.js`,
`mobile/tests/analytics-recovery-section.test.js`.

**Acceptance criteria:** complete local typography/geometry and 10px removal;
consume approved series roles without replacing existing chart data. Preserve
all partial/error/loading/search/mapping/tracking/check-in/Recovery states,
deep-link expansion/measurement and calculation disclosures. No Wilks/class,
time-range controls, weekly-volume chart, verified record table or #973 math.

**Verification:** allowed tests plus `mobile/tests/one-k-progress-consistency.test.js`,
`mobile/tests/active-training-context-consumers.test.js`. Device sign-off: missing
data/mapping, populated/selected charts, searches with no match, grouped overload
at large text, fatigue off/on/unanswered, Recovery active/history/baseline errors
and repeated cross-tab section arrivals. **Order:** after D5; D0/D4 are hard
chart prerequisites; paused feature work must not edit these files concurrently.

### D9 — Weight migration

**Goal:** restyle S6's fast entry, goal/trend summaries and editable history.

**Allowed Files:** `mobile/screens/WeightScreen.js`, `mobile/components/WeightGoalCard.js`,
`mobile/components/WeightTrendSection.js`, `mobile/components/WeightHistoryList.js`,
`mobile/tests/weight-screen.test.js`, `mobile/tests/weight-goal-ui.test.js`,
`mobile/tests/weight-goal-read-failure.test.js`,
`mobile/tests/weight-history-list-render-isolation.test.js`.

**Acceptance criteria:** full local type/radius/border/input/native-picker
treatment while preserving immediately available entry, independent source
errors, retry, edit failure retention, date/note disclosures, midnight default,
goal lifecycle/guidance and date-filter/paginated history. Preserve current trend
tables; the screenshot does not authorize a chart, +/- stepper or export route.
Use only approved G1/G2 roles and no decorative red for ordinary values.

**Verification:** allowed tests plus `mobile/tests/unit-display-ui.test.js`.
Device sign-off: new/edit/error
weigh-ins with keyboard and lb/kg, date picker, note disclosure, no/active/met/
archived goal, large text, empty/filter-empty/load-more history and offline save.
**Order:** after D5; D0 chart/color decision is required even though new chart
functionality is excluded.

### D10 — Plate Calculator migration

**Goal:** apply the calculator/sheet visual language to the existing tapped-load
and per-unit equipment workflow.

**Allowed Files:** `mobile/components/PlateCalculatorModal.js`,
`mobile/tests/plate-calculator-modal.test.js`.

**Acceptance criteria:** migrate all type/geometry/input states; preserve empty/
below-bar/invalid/remainder cases, authored-kg precision, inventory edits, per-unit
defaults and unit-switch discard behavior. An optional sleeve illustration uses
only existing computed counts; no target editor, bar preset invention, fake
sync badge, math/persistence fix or Apply to Log Row.

**Verification:** allowed test plus `mobile/tests/plate-math.test.js` unchanged.
Device sign-off: tap lb and kg-authored sets, switch units during edit, save/
cancel/reset inventory, limited inventory/remainder, keyboard and close/Back.
**Order:** after D5; shared SetLine entry is already migrated by D3.

### D11 — More menu migration

**Goal:** restyle the menu on open canvas while preserving S9 navigation.

**Allowed Files:** `mobile/screens/MoreScreen.js`, `mobile/tests/app-navigation.test.js`.

**Acceptance criteria:** complete local type/radius/border sweep; preserve all
six entries, labels, callback routes, repeated anchor handling, subview Back and
password-recovery entry. No Settings replacement tab or #971 import route.

**Verification:** allowed test and `mobile/tests/app-shell-back.test.js`.
Device sign-off: visit all six subviews and return, switch away/back, repeat
Cloud Sync anchor and use hardware Back with large menu text. **Order:** after D5;
individual subviews may still have legacy local styles until their owner lands.

### D12 — Settings and Reminders migration

**Goal:** restyle S10's existing preferences and native controls.

**Allowed Files:** `mobile/components/SettingsScreen.js`,
`mobile/components/ReminderSettingsCard.js`, `mobile/tests/reminder-settings-card.test.js`.

**Acceptance criteria:** complete local typography/geometry, native Switch/time
picker appearance and selected/disabled/error states. Preserve feature toggles,
Light/Dark/System, durable-unit failure/retry, multiplier and all reminder
permission/scheduling/fallback-day behavior. No default timer/haptics/bar settings
or moved account/backup controls.

**Verification:** allowed test plus `mobile/tests/profile-write-failure.test.js`
and `mobile/tests/theme-preference.test.js`. Device sign-off: OS/app appearance
combinations, unit-save failure/remount/retry, features off/on, native times,
permission denied, fallback days and large text. **Order:** after D5; consumes
D1 native bridge without reopening its files.

### D13 — Profile migration

**Goal:** apply the form treatment to S11 without changing biometric semantics.

**Allowed Files:** `mobile/components/ProfileScreen.js`,
`mobile/tests/profile-write-failure.test.js`.

**Acceptance criteria:** migrate local typography/geometry, text/decimal inputs,
date picker and selected controls; preserve optional values, ft/in/cm conversion,
DOB clear, activity options, save success/error and clear confirmation.

**Verification:** allowed test plus `mobile/tests/unit-display-ui.test.js`.
Device sign-off: empty/existing profile, both height inputs, DOB/clear, failure/
retry, clear confirmation and keyboard/large-text layout. **Order:** after D5.

### D14 — Account, consent and lifecycle presentation

**Goal:** migrate S12/S14's security-sensitive presentation and the shared consent
surface without changing auth, health-data or deletion contracts.

**Allowed Files:** `mobile/screens/more/AccountScreen.js`,
`mobile/screens/more/AccountLifecycle.js`, `mobile/screens/more/HealthDataConsent.js`,
`mobile/screens/more/LegalLinks.js`, `mobile/components/CaptchaChallenge.js`,
`mobile/components/CaptchaChallenge.native.js`, `mobile/components/CaptchaChallenge.web.js`,
`mobile/tests/account-lifecycle-ui.test.js`, `mobile/tests/health-consent.test.js`.

**Acceptance criteria:** complete app-owned typography/geometry/colors, including
verification container/error/loading states; respect D0's hosted-control limits.
Preserve disclosures verbatim, every busy/error/confirmation/resend/retry state,
platform OAuth support, password handling, challenge message protocol and local/
cloud deletion distinctions. No auth hook/backend/config changes.

**Verification:** allowed tests plus `mobile/tests/auth-session.test.js` and
`mobile/tests/consent-gate-client.test.js`; security-sensitive scoped review.
Device sign-off: configured/unconfigured, signed-out/pending/signed-in/error,
challenge expiry/retry and consent, then deletion keep/wipe confirmations using
disposable fixtures. **Order:** after D5; D15 owns the separate reset component,
D16 owns Cloud Sync/Backup consumers of the consent component.

### D15 — Set New Password migration

**Goal:** apply the form treatment to S13's recovery-only surface.

**Allowed Files:** `mobile/screens/more/SetNewPasswordScreen.js`.

**Acceptance criteria:** migrate local typography/geometry/secure inputs; retain
valid/invalid recovery-link branches, validation, busy/error/success and return
to sign-in. Preserve callbacks and password semantics; no deep-link redesign.

**Verification:** run `mobile/tests/account-lifecycle-ui.test.js` and
`mobile/tests/auth-session.test.js` unchanged; security-sensitive scoped review.
Device sign-off: valid and expired recovery entry, mismatch/error, keyboard at
large text and successful return. **Order:** after D14 in the suggested sequence;
its shared shell/consent prerequisites are already available.

### D16 — Data & Backup and Cloud Sync migration

**Goal:** migrate S15/S16 with explicit local/cloud and destructive boundaries.

**Allowed Files:** `mobile/components/BackupScreen.js`,
`mobile/screens/more/CloudSyncRecovery.js`, `mobile/tests/backup-screen.test.js`,
`mobile/tests/sync-recovery-ui.test.js`.

**Acceptance criteria:** migrate local typography/geometry/forms/status/danger
surfaces; preserve all JSON/CSV/account export distinctions, disclosure copy,
native/browser file paths, import replacement confirmation, consent/deletion-
pending/update-required branches, foreign-history prompt, sync/upload errors/
retry and wipe-required state. No changes to transport, import/export formats,
storage adapters or consent/deletion logic.

**Verification:** allowed tests plus `mobile/tests/app-export.test.js`,
`mobile/tests/backup-import.test.js`, `mobile/tests/offline-sync.test.js`.
Device sign-off: anchored arrival, offline queued/failed/retry, consent off/on/
withdrawal, file and pasted import error, export status and dangerous confirmations
with disposable data; supplemental web file/dialog pass. **Order:** after D14's
shared consent presentation; no dependency on #973 calculations or #971 import.

### D17 — App Guide migration

**Goal:** restyle S17 documentation as readable open sections.

**Allowed Files:** `mobile/components/HelpScreen.js`.

**Acceptance criteria:** complete local typography/geometry without dropping
guide sections, examples, units or local/cloud explanations. Shared syntax
reference remains D3-owned; preserve scroll/Back and real terminology.

**Verification:** `mobile/tests/workout-syntax-reference.test.js` unchanged and
focused visual-rule check. Device sign-off: full guide scroll, syntax examples,
large text and Back in both themes. **Order:** after D5; D3 syntax prerequisite.

### D18 — About migration and read-only program completeness check

**Goal:** restyle S18 and verify all exclusive owners have completed their slices.

**Allowed Files:** `mobile/components/AboutScreen.js`, `mobile/tests/about-screen.test.js`.

**Acceptance criteria:** complete local typography/geometry; preserve real version,
attribution, legal links, OTA diagnostics/check/result/error/restart. No fabricated
spec IDs or screenshot version. Final whole-program scan must pass; a failure in
another owner's file is reported to that owner, not edited under this card.

**Verification:** allowed test, D2's whole-program mode and read-only comparison
of all S0–S18 rows against the landed child handoffs. Device sign-off: About
update/check/failure states and Back in both themes; owner confirms every child
has its own recorded device sign-off. **Order:** last in the proposed sequence;
this is verification of the migration, not authority to merge, close or release.

# Current State

Status: current product snapshot. The package manifests and active code are
authoritative for exact dependency versions and implementation details; this
document owns the concise description of what ships and what remains externally
unverified.

## Product

Kilo is a local-first fitness tracker built with Expo and React Native. A new
installation starts empty and can be used without an account. Users write
workout notes in Kilo's compact note-first format, record bodyweight, set goals,
and review derived progress and recovery analytics.

The active application lives in `mobile/` and has five tabs:

- **Home** summarizes recent training, weight, goals, strength, and recovery.
- **Log** creates and edits workout routines, sessions, deloads, and recovery
  blocks from canonical note text.
- **Weight** records weigh-ins and goals and presents history and trends.
- **Analytics** derives workout, strength, weight, fatigue, and recovery views,
  including a Training breakdown dashboard (Movement, Muscles, Equipment) of
  eligible ordinary history placed after Strength and shown as paused baseline
  history during an active Recovery block. It has a Last 4 / Last 12 / All
  session window (per exercise, by logged session rather than date; default
  Last 12, kept in memory and affecting only that section), descriptive
  Push vs Pull and Knee vs Hip comparisons, a body-region heatmap, ranked
  equipment bars, and bottom-sheet drill-downs to the contributing exercises. Recovery groups lifts by detailed movement
  (for example Hip hinge, Vertical pull) while keeping earlier broad group
  choices as saved.

Progression suggestions are an opt-in feature (off by default, enabled from
Settings). When on, the deterministic rule engine's double-progression prompts
appear as explainable, dismissible cards on the Log current-routine view and the
Analytics strength section, each marked as a heuristic rather than a guaranteed
prescription and each mutable per exercise. Workout-note text changes only when
the user explicitly applies a suggestion; viewing, dismissing, muting, or
disabling suggestions does not change a note.

- **More** contains profile, settings, reminders, backup/import, account, cloud
  sync, help, and product information.

A verified empty installation offers a skippable, five-step walkthrough over the
real tabs after startup. More → App Guide (Help) → Replay walkthrough starts it again at
Home. Skip leaves the current screen usable; Done returns Home. Dismissal is a
device-local preference outside fitness backups and account sync. Unreadable
preferences or unverified local data suppress automatic launch; manual replay
remains available. Existing Home welcome actions and Log guidance remain.

The retired browser prototype is preserved in
[`docs/archive/browser-prototype/`](../archive/browser-prototype/) for historical
reference. It is not an active runtime or test target.

## Local Data

Local persistence is the default and remains available when cloud configuration
is absent, the user is signed out, or health-data consent is not active.

On native platforms, health and training values stored under Kilo's AsyncStorage
keys pass through an AES-256-GCM boundary. The encryption key is held in
SecureStore and excluded from Android backup. Web uses browser-storage semantics
and does not claim the same independent key boundary.

The app supports local backup export and import. Account deletion separately
offers the user a choice to keep the on-device copy or wipe it; sign-out also
offers an explicit device-wipe path.

Data & Backup also offers CSV export of workout and weight history
(`mobile/lib/interoperability/csv.js`, `mobile/lib/interoperability/kiloCsv.js`)
for moving data into other tools. CSV is interoperability, never backup or
sync: it is one-way (Kilo has no CSV importer), excludes tombstones, Recovery
records, deload/fatigue state, weight goals, profile, feature toggles,
sync/cloud metadata, and tracked-lift activation records, and most sessions
have no recoverable calendar date (only a single-session dated section
heading is representable evidence today). JSON backup remains the only
lossless recovery format. One-shot import from Strong, Hevy, or FitNotes CSV
exports is a separate, not-yet-implemented follow-up (issue #578).

## Accounts and Cloud Sync

Supabase is optional. Cloud-aware mode requires both
`EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`; signed-out
users remain local-only even when those variables are present.

Kilo owns only the `kilo` schema in the shared Supabase project. App tables use
owner-scoped RLS, and privileged account export, account deletion, and
health-data deletion run through server-owned Edge Functions.

Cloud health-data processing requires a signed-in account, explicit consent at
the active material version, and resolution of the local-data ownership prompt.
Withdrawing consent stops health-data sync and starts deletion of the cloud
health-data copy while retaining local data. Ordinary account preferences remain
separate from the consent-gated health-data set.

Sync is offline-first. Local writes remain usable without a connection, durable
dirty state is reconciled later, server-authored change boundaries protect
against device-clock skew, and tombstones prevent deleted records from
reappearing.

## Privacy and Diagnostics

- Crash reporting is limited to production error diagnostics and excludes
  default PII capture and user-authored health content.
- Product measurement is disabled by default, separately consented, and limited
  to an allow-listed non-health event vocabulary.
- Health-data consent, withdrawal, export, deletion, evidence retention, and
  purge monitoring follow the contracts linked from
  [the documentation index](../README.md).
- Server-owned endpoints record classified, pseudonymized security events with
  a 90-day retention period; production alerting and the investigation runbook
  live in [Security Monitoring](../security/security-monitoring.md). The production security
  monitor is credentialed and scheduled to run hourly.

## Runtime and Distribution

The package manifests are the source of truth for the current Expo, React
Native, React, and application versions. Forward-looking work targets
`mobile/`; there is no application server required for local use.

Supported repository build paths are:

- Expo development through the root `mobile:start` and `mobile:android`
  scripts.
- Android preview and production builds through the mobile EAS scripts.
- An Expo web export served as a static application, published at
  https://kilo-app.pages.dev by the [Web Deployment](../operations/web-deployment.md)
  workflow. Web sign-out and the Edge-Function account flows do not work there
  yet; see its Known web gaps.
- iOS simulator and device profiles documented in the mobile build runbook.

Remote EAS Update publication is intentionally blocked while update-signing key
custody is unresolved. Native build replacement is the supported delivery path;
the exact runtime and build procedure lives in
[Phone Runbook](../phone-runbook.md).

## Verification State

The repository has Jest coverage for domain logic, storage, cloud sync, hooks,
and rendered component contracts, plus database security tests and focused
repository scripts. The exact commands, CI gates, and coverage inventory live in
[Testing and QA](../testing-and-qa.md).

The repository does not by itself prove external or physical-device state.
Release decisions still require the applicable manual checks:

- installed-device launch, layout, notification, deep-link, and email-link
  behavior;
- iOS device distribution where called out by the build runbook;
- remaining Play Console declarations, listing assets, and release-build checks;
- production configuration for Supabase Auth, Turnstile, SMTP, OAuth, Sentry,
  policy URLs, and deployment secrets.

Use [Play Store Readiness](../operations/play-store-readiness.md) for operator-owned Android
release status and [Beta Tester Guide](../testing/tester-guide.md) for participant steps.

## Document Ownership

Use the task-oriented [Documentation Index](../README.md) to find each topic's
authoritative guide. This snapshot owns shipped-product state and externally
unverified release boundaries; detailed contracts belong to those linked guides.

Issue-by-issue delivery history belongs in the changelog, GitHub, and
[`docs/archive/`](../archive/), not in this snapshot.

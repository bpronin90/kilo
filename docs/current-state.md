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
- **Analytics** derives workout, strength, weight, fatigue, and recovery views.
- **More** contains profile, settings, reminders, backup/import, account, cloud
  sync, help, and product information.

The retired browser prototype is preserved in
[`docs/archive/browser-prototype/`](archive/browser-prototype/) for historical
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
  [the documentation index](README.md).

## Runtime and Distribution

The package manifests are the source of truth for the current Expo, React
Native, React, and application versions. Forward-looking work targets
`mobile/`; there is no application server required for local use.

Supported repository build paths are:

- Expo development through the root `mobile:start` and `mobile:android`
  scripts.
- Android preview and production builds through the mobile EAS scripts.
- An Expo web export served as a static application.
- iOS simulator and device profiles documented in the mobile build runbook.

Remote EAS Update publication is intentionally blocked while update-signing key
custody is unresolved. Native build replacement is the supported delivery path;
the exact runtime and build procedure lives in
[Phone Runbook](phone-runbook.md).

## Verification State

The repository has Jest coverage for domain logic, storage, cloud sync, hooks,
and rendered component contracts, plus database security tests and focused
repository scripts. The exact commands, CI gates, and coverage inventory live in
[Testing and QA](testing-and-qa.md).

The repository does not by itself prove external or physical-device state.
Release decisions still require the applicable manual checks:

- installed-device launch, layout, notification, deep-link, and email-link
  behavior;
- iOS device distribution where called out by the build runbook;
- Play Console closed-testing and production-access actions;
- production configuration for Supabase Auth, Turnstile, SMTP, OAuth, Sentry,
  policy URLs, and deployment secrets.

Use [Play Store Readiness](play-store-readiness.md) for operator-owned Android
release status and [Beta Tester Guide](tester-guide.md) for participant steps.

## Document Ownership

| Topic | Authoritative document |
|-------|------------------------|
| Runtime boundaries and data flow | [Architecture](architecture.md) |
| Repository layout | [Repo Structure](repo-structure.md) |
| Tests, CI, and manual QA | [Testing and QA](testing-and-qa.md) |
| Calculations and derived values | [Calculations Reference](calculations-reference.md) |
| UI rules and current visual implementation | [UI Design Rules](ui-design-rules.md) and [Design System Map](design-system-map.md) |
| Supabase schema policy | [Backend Schema](backend-schema.md) |
| Supabase and Auth operations | [Backend Activation](backend-activation.md) |
| Health-data consent | [Health-Data Consent](health-data-consent.md) |
| Optional product measurement | [Product Measurement](product-measurement.md) |
| Build and device procedures | [Phone Runbook](phone-runbook.md) |
| Release checklist | [Play Store Readiness](play-store-readiness.md) |

Issue-by-issue delivery history belongs in the changelog, GitHub, and
[`docs/archive/`](archive/), not in this snapshot.

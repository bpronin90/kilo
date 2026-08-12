# Health-Data Consent Contract

Status: current product, privacy, and engineering contract.

This document owns Kilo's consent boundary for cloud processing of health data.
The completed design and rollout specification is preserved in the
[documentation archive](archive/article-9-explicit-consent-spec.md). This is a
product and engineering contract, not legal advice.

## Product Decision

Kilo requests GDPR Article 9(2)(a) explicit consent in a dedicated step when an
authenticated user asks to enable Cloud Sync. Account creation, sign-in, and
ordinary local use do not imply consent.

- Refusing or dismissing consent keeps Cloud Sync off and leaves local features
  available.
- No cloud health-data read or write may occur until the backend confirms an
  active grant for the required material version.
- Client state improves the experience but is never the authorization boundary.
- Cloud Sync reports success only after the server records the grant and the
  activation operation succeeds.

## Exact Consent Surface

The approved title is:

> Store health data in the cloud?

The approved disclosure is:

> Cloud Sync stores the following health and fitness data in Kilo's
> Supabase-hosted cloud database in the United States so Kilo can sync it across
> your devices:
>
> - body-weight entries
> - current and archived weight goals
> - tracked lifts and workout notes
> - deload notes and history, and fatigue-tracking data
>
> You can keep using Kilo locally if you do not consent. You can withdraw at any
> time by turning off Cloud Sync. Kilo will then stop cloud processing and delete
> the cloud copy while keeping your on-device data. Supabase processes the data
> for Kilo under EU Standard Contractual Clauses. Kilo keeps a minimal
> pseudonymized record of your consent choices for six years after account
> deletion to demonstrate compliance; that record contains no health entries,
> notes, or measurements.

The unchecked affirmation is:

> I explicitly consent to Kilo storing the health and fitness data listed above
> in its United States cloud database for cross-device sync.

The actions are `Agree and enable Cloud Sync` and `Not now`. The primary action
stays disabled until the affirmation is checked. The surface links to the
privacy-policy revision recorded by the active server catalog.

The immutable `kilo.consent_revision` row is the server authority for rendered
wording and its SHA-256 digest. `mobile/storage/cloud/consent.js` mirrors that
wording verbatim, and tests fail if its canonical bytes drift from the seeded
catalog revision.

## Health-Data Boundary

`supabase/functions/_shared/health-data-scope.ts` is the single code definition
used by account export, account deletion, and health-data deletion. It currently
contains these nine `kilo` tables:

- `fatigue_checkins`
- `deload_history`
- `recovery_block_weeks`
- `recovery_blocks`
- `workout_notes`
- `weight_entries`
- `archived_weight_goals`
- `weight_goal`
- `user_health_profile`

During the expand phase, the six health fields still present on mixed
`user_profile` rows are also gated, exported through their canonical
`user_health_profile` copy, and cleared during deletion. The contract operation
drops those legacy fields after protocol enforcement and parity verification.

`feature_toggles.fatigue_tracking_enabled` and
`feature_toggles.deload_mode_enabled` remain ordinary account preferences. They
are not measurements and withdrawal does not delete them. They must not be used
for health profiling or combined with analytics.

Adding a health table, field, category, or purpose requires one coordinated
change to the shared scope, its parity tests, the database's gated-table
definition, the consent catalog, and the required material version before any
new value is collected.

## Server Enforcement and Evidence

`kilo.health_gate_ok()` and the surrounding RLS/RPC rules fail closed unless the
user has a `granted` state for the server's required material version. The
supported denial outcomes distinguish an outdated client, missing consent,
stale material consent, deletion in progress, and an operator-paused sync mode.

Consent evidence consists of:

- an immutable revision catalog containing the exact wording, purpose,
  categories, processor, policy revision, material version, and digest;
- append-only, server-timestamped grant and withdrawal events; and
- one indexed current-state row per user for authorization and deletion state.

The client submits the revision it rendered plus app/platform context. It cannot
supply the wording, digest, controller, purpose, categories, or timestamp.
Account deletion replaces the account-linked ledger with a six-year,
HMAC-pseudonymized evidence record containing no health payload, free text,
device identifier, or IP address. Evidence keys are versioned outside the
database and remain available while unexpired records or retained backups refer
to them.

## Withdrawal and Deletion

Turning off Cloud Sync is the withdrawal action. It uses this exact confirmation:

> **Withdraw cloud health-data consent?**
>
> Kilo will stop syncing and delete your body-weight entries, current and
> archived weight goals, tracked lifts and workout notes, deload notes and
> history, and fatigue-tracking data from the cloud. Your on-device data and Kilo
> account will remain.

The actions are `Withdraw consent and delete cloud data` and
`Keep Cloud Sync on`.

On confirmation, the server atomically blocks health-data access, appends the
withdrawal event, moves the user to `deletion_pending`, and creates a durable,
idempotent deletion job. The worker deletes all shared-scope resources and
clears temporary legacy fields. It moves the state to `withdrawn` only after a
server-side zero-row check succeeds. Retries record counts and status, never
deleted values. Re-grant is forbidden while deletion is pending; a later grant
after completed withdrawal creates a new event and rebuilds the cloud copy from
the user's current local data.

## Re-consent and Change Control

A fresh material version and affirmative grant are required before processing a
new health-data category or purpose, a controller change, or a material change
to processors, recipients, international transfer, retention, withdrawal, or
what the user agrees to. The backend sets `needs_reconsent` and blocks sync; it
never upgrades an old grant automatically.

Editorial corrections create a new immutable catalog revision with the same
material version and do not invalidate existing grants. New grants cite the
latest active revision.

The published privacy policy must describe the deployed categories, explicit-
consent basis, controller, sync purpose, Supabase processing and transfer,
local-only choice, withdrawal/deletion behavior, and six-year pseudonymized
evidence retention. Recheck that policy whenever this contract changes.

## Verification

The primary contract checks are:

```sh
npm --prefix mobile test -- --runInBand tests/health-consent.test.js tests/consent-gate-client.test.js
deno test --no-check --no-lock --allow-read supabase/functions/_shared/health-data-scope.test.ts
```

Database consent-gate, withdrawal, purge, protocol, and migration checks live
under `supabase/tests/` and are included in the migration test workflow described
in [Testing and QA](testing-and-qa.md).

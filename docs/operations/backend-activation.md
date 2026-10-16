# Backend Activation Runbook

Status: current operator procedure for deploying and activating Kilo's optional
Supabase backend in the shared production project.

This document owns migration deployment, Data API exposure, client
configuration and operational verification. Public Auth-provider setup lives in
[Auth Activation](auth-activation.md). Schema
meaning and ownership rules live in [Backend Schema](../architecture/backend-schema.md);
historical sequencing lives in the
[archived backend roadmap](../archive/backend-roadmap.md).

## Preconditions

- You have authorized operator access to the target Supabase project.
- The Supabase CLI and Docker are available for local migration verification.
- The target project is positively identified before any command is run.
- Kilo owns only the `kilo` schema. Do not modify `public`, `raw`,
  `canonical`, `serving`, `serving_stage`, `legacy`, or `ops`.
- Secrets remain outside source control. A service-role or secret key must never
  enter the mobile client, a committed environment file, an issue, or a log.

## 1. Validate The Migration Set Locally

The ordered files under `supabase/migrations/` are the database source of
truth. Do not apply only the original baseline migration and do not reproduce
later changes by hand.

From a disposable local Supabase stack:

```sh
supabase db reset --local --no-seed
node scripts/run-pgtap-suite.mjs
```

A reset must apply the full migration chain successfully. The test runner must
discover and pass every planned pgTAP file; skips, TODOs, parse errors, and
zero-test plans are failures.

## 2. Apply Pending Migrations

> **Unresolved deployment instruction:** this inherited section says to use
> `supabase db push`; the repository's `AGENTS.md` and carry workflow prohibit
> that command against shared production. The commands below are retained as
> provenance, not authorization to run them on production. Stop before remote
> application until an authorized operator supplies a reviewed deployment method
> and exact pending set. This documentation refactor makes no production change.

Link the CLI to the intended project, then inspect the exact pending set before
changing remote state:

```sh
supabase migration list
supabase db push --dry-run
```

Review pending migrations by filename and SQL ownership. Every Kilo migration
must be limited to the `kilo` schema plus deliberate read-only references to
Supabase-managed `auth` objects. The production project is shared, so unrelated
migration-ledger rows belonging to co-tenants are expected.

Apply the reviewed pending set through migration tooling:

```sh
supabase db push
```

Supabase records applied migrations in
`supabase_migrations.schema_migrations`; do not bypass that ledger with ad hoc
remote SQL. After deployment, run the repository drift check with the approved
read-only connection:

```sh
npm run check:migrations
```

The drift check compares migration identity by name and Kilo-owned SQL. Extra
live migrations from the co-tenant application are not Kilo drift.

## 3. Expose The `kilo` Schema

Add `kilo` to the project's exposed schemas in the Supabase API settings.
Leave every other schema entry unchanged.

Exposure and authorization are separate controls. The schema needs Data API
exposure for the client, but `anon` receives no Kilo grants. Tables reachable
by authenticated clients must retain RLS and owner-scoped policies.

## 4. Configure The Client

Set these public client values in the deployment environment or a gitignored
`mobile/.env`:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

Use the project URL and publishable client key. Never use a service-role or
secret key. Restart the Expo bundler after changing local values.

When either value is absent, the Supabase client factory returns no client and
the app remains local-only. Configuration does not itself authorize cloud
health-data access: the user must also sign in, resolve local-data ownership,
and grant the active health-data consent revision.

## 5. Verify Activation

Before relying on the backend:

1. Confirm the full repository migration set is present in the remote migration
   ledger and `npm run check:migrations` passes.
2. Confirm RLS is enabled on every client-reachable Kilo table.
3. As two authenticated test users, prove each can read and mutate only their
   own rows.
4. Confirm an unauthenticated Data API request to `kilo` is denied.
5. Confirm signed-out and unconfigured app sessions remain local-only.
6. Run the relevant account, consent, sync, export, deletion, and bounded-write
   checks for the release being activated.

A schema count or table count is not an activation invariant; the migration set
evolves. Verify migration identity, RLS/grants, and behavior instead.

## Deactivation And Recovery

- To disable cloud use in a client without changing stored cloud data, remove
  the two public Supabase environment values and rebuild/restart the client.
- Do not re-run an individual historical migration against an existing schema.
- Do not drop the `kilo` schema as a routine rollback. Production rollback
  requires a reviewed forward migration or an explicit disaster-recovery plan.
- Never change another application's schemas, Auth settings, extensions, or
  roles as part of Kilo recovery.

## Public Auth And Abuse Controls

See [Public Auth Activation](auth-activation.md) for the complete ordered setup
and release-verification procedure.

## Relationship To Other Docs

- `docs/architecture/backend-schema.md` owns the schema structure and the naming, source-of-truth, ownership, and isolation **policy** that schema changes must follow. Consult it for what the tables, columns, RLS, and grants mean.
- `docs/archive/backend-roadmap.md` preserves the completed implementation sequence. It is historical, not an operational authority.
- This document owns the current activation and provider-configuration procedure.

## Supabase Deployment Configuration

`supabase/config.toml` records the local project identifier, the exact exposed
schema set, and `verify_jwt = false` for `account-export`,
`account-delete`, and `android-restore-credentials` (whose restore routes are
reached before the device has any session). `health-data-delete` also disables platform JWT verification
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
`scripts/deploy-kilo-functions.sh` from the repository root to deploy the four
Kilo-owned functions; the script supplies project ref
`ogzhnscdqcdrhfqcobuv` explicitly and does not deploy functions outside Kilo's
ownership boundary. It reports success only after the
Supabase management plane shows `account-export`, `account-delete`,
`health-data-delete`, and `android-restore-credentials` as `ACTIVE` with an update timestamp from that deployment.

The production health-deletion worker also requires two **database Vault**
secrets, verified by name from `vault.secrets` (never decrypted, read, or
printed) by the deployment procedure:
`kilo_functions_base_url` and `kilo_service_role_key`. Set the base URL to the
production project URL. For this new-key project, set `kilo_service_role_key`
to its `sb_secret_` service-role value, not the legacy `service_role` JWT.
Before running the script, an authorized operator supplies `KILO_DATABASE_URL`
for its read-only `health-deletion-drain` cron check; do not put that URL or a
secret value in shell history or logs. To exercise the worker dispatch boundary,
the operator may additionally set `HEALTH_DELETION_FIXTURE_USER_ID` to a
disposable, already-due deletion job. The script dispatches only when that is
the sole due job, and otherwise fails without enqueuing or changing any user.

### CAPTCHA

See [CAPTCHA](auth-activation.md#captcha).

#### 1. Choose the two origins

See [1. Choose the two origins](auth-activation.md#1-choose-the-two-origins).

#### 2. Create or recover the Cloudflare widget

See [2. Create or recover the Cloudflare widget](auth-activation.md#2-create-or-recover-the-cloudflare-widget).

#### 3. Configure local and hosted client builds

See [3. Configure local and hosted client builds](auth-activation.md#3-configure-local-and-hosted-client-builds).

#### 4. Build replacements before enabling Supabase

See [4. Build replacements before enabling Supabase](auth-activation.md#4-build-replacements-before-enabling-supabase).

#### 5. Enable the secret in Supabase

See [5. Enable the secret in Supabase](auth-activation.md#5-enable-the-secret-in-supabase).

#### 6. Verify before opening signup

See [6. Verify before opening signup](auth-activation.md#6-verify-before-opening-signup).

#### What the app already does

See [What the app already does](auth-activation.md#what-the-app-already-does).

### Production SMTP

See [Production SMTP](auth-activation.md#production-smtp).

### Published Privacy Policy and Terms of Service

See [Published Privacy Policy and Terms of Service](auth-activation.md#published-privacy-policy-and-terms-of-service).

### GitHub OAuth Provider

See [GitHub OAuth Provider](auth-activation.md#github-oauth-provider).

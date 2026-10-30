# CI and Review Gates

For contributors diagnosing merge checks and their local equivalents. This is the owner of gate behavior; test execution is in [Automated Tests](automated-tests.md).

## Review disposition

Every PR additionally requires the `review disposition accepted` status for
its exact current head SHA. The trusted evaluator in
`scripts/review-disposition.mjs` reads current-head implementation metadata and
the newest valid independent review or owner-override record. Missing
current-head implementation metadata, or the absence of any exact-head review,
fails the check with an actionable status rather than leaving it pending
indefinitely.

As a narrow exception, an ordinary exact-head approval is carried forward
across a verified closeout refresh. When the current head is a two-parent merge
of a previously approved head and the current base, and the refresh is
object-identical to the reviewed change — namespace-disjoint paths, an unchanged
raw object delta, and a tree equal to the reproducible conflict-free Git merge —
the evaluator preserves the prior approval, so an already-approved, disjoint PR
does not need re-review solely because another PR merged first. The carried
approval is bound to the same implementation execution as the reviewed head;
chained refreshes, changed deltas, path overlap, manufactured trees, or a
missing ordinary approval all fail closed. Exact-head review, owner override,
self-review rejection, and branch-protection enforcement are unaffected.

Evaluation is serialized and reconciles every open PR on each run. The
workflow uses one repository-wide concurrency group with
`cancel-in-progress: false`, so runs never overlap and a running job is never
canceled; GitHub may replace a queued job with a newer one, which is safe
because the replacement reevaluates all open PRs. Runs trigger on PR
open/reopen/synchronize/edit/close, issue/PR comment create/edit/delete, and
pushes to `main` (which can retract a carried approval whose base proof no
longer holds). Each run first retracts any prior success to `pending` on every
open head, starting with the PRs the event touched, before reading any
evidence. It then publishes a terminal state per head; an exception during
evidence retrieval or Git proof publishes `error` for that issue's PRs, never
success. Transient API failures are retried a bounded number of times.

Outage limits: no script can write a status when GitHub rejects every write,
when an event is not delivered, or when a job never starts. In those cases the
last written status stands until the next run; a failed or canceled evaluator
job does not itself replace an existing successful custom status. A run that
is interrupted after its retraction phase leaves heads `pending` (fail-closed);
one interrupted during that phase may leave unreached heads at their previous
state. Any later event, or a rerun of the failed job, reconciles all PRs.

Review disposition is independent from CI: an
override cannot satisfy a pending or failed test, audit, version, or migration
check. Dependabot PRs derive their implementation execution from the bot and
current head, but still require an accepted review disposition before their
guarded auto-merge can complete. The evaluator's deterministic parser and
refresh-verification tests run with:

```sh
node --test scripts/review-disposition.test.mjs
```

### Security-critical changes

Changes that can materially affect authentication, authorization, RLS and
policies, server functions/APIs, secrets, health data, encryption/storage,
account deletion/export, abuse controls, update delivery, or deployment
security follow the [Security-critical change review](../security/security-review.md)
policy. The PR must identify its security impact and, when critical, retain an
explicit human security sign-off bound to the full current head SHA before the
change is eligible for release. A new head invalidates that sign-off and
requires renewal. This is an additional review lens, not a replacement for
ordinary review or the required automated security, database, dependency, and
migration checks.

## Migration drift

GitHub Actions also runs the migration drift check via
`.github/workflows/migration-drift.yml`, and it is a **required pre-merge
status check on `main`** (job `merged migrations are applied to the live
project`): it runs credentialed on every push to `main` and on every pull
request from this same repository, not only after merge. #490 reached
production because the only credentialed run used to happen after merge; the
pre-merge run is the fix. The check uses the least-privilege
`SUPABASE_MIGRATION_CHECK_URL` repository secret to compare migrations in
`supabase/migrations/` with the live `supabase_migrations.schema_migrations`
ledger. A live row must prove Kilo identity through an exact `(version, name)`
pair or prove ownership through same-name SQL qualified to Kilo's owned `kilo`
schema. Bare name membership is insufficient, so a same-name co-tenant row
cannot hide a missing Kilo migration.

Fork pull requests cannot receive that secret (GitHub withholds repository
secrets from a `pull_request` run whose head repo differs from this one), so a
separate, non-required job (`migration-drift-fork`) runs the same script with
no credentials and reports the honest result: exit 2, "unable to check" — never
exit 0, "no drift". A maintainer applies the credentialed check to a fork PR's
changes locally, or relies on the required push-to-main run, before it reaches
production. The post-merge push-to-main run remains as defense in depth, not
the first detection point.

Run the same check locally with either:

```sh
# explicit export — always takes precedence over a local .env file
SUPABASE_MIGRATION_CHECK_URL=postgresql://... npm run check:migrations

# or create a .env file (gitignored) in the repo root:
#   SUPABASE_MIGRATION_CHECK_URL=postgresql://...
npm run check:migrations
```

The URL must use the session pooler and the read-only `migration_check` role.
Missing repo migrations fail the check; extra live migrations are allowed
because the Supabase project is shared with another app. Missing credentials or
database connection failures also fail rather than reporting a false pass.

`scripts/check-migration-drift.mjs` has a deterministic self-test harness that
exercises env-loading precedence, ownership-aware exact-collision/unrelated-
extra/missing/complete ledger fixtures, and the exit-code contract (0/1/2)
against a stubbed `psql` and disposable temp-dir fixtures only — it never
connects to a real database or touches a real secret:

```sh
npm run check:migrations:selftest
```

## Dependency Audit Gate

A CI workflow (`.github/workflows/audit.yml`) runs `npm audit --audit-level=high` against both the root and `mobile/` package trees on every push to `main`, on every pull request, and on a weekly schedule (Mondays 06:00 UTC). The job fails if any high-severity or critical vulnerability is found. The weekly run catches new advisories that land against an otherwise-unchanged lockfile before unrelated work merges.

The manifests and lockfiles are authoritative for the current dependency set.
Do not carry a past audit result forward: run both checks against the current
head whenever dependencies or audit configuration change.

Run the same check locally:

```sh
npm run audit               # root package tree
npm --prefix mobile audit   # or: cd mobile && npm run audit
```

The gate catches advisories in `package-lock.json` and `mobile/package-lock.json`. It does not perform dependency upgrades; remediation is handled separately.

### Proactive dependency updates

`.github/dependabot.yml` schedules weekly npm version checks for the repository root (`/`) and the mobile workspace (`/mobile`), grouping compatible minor/patch version updates while leaving security updates as separate, independently visible PRs.

`.github/workflows/dependabot-automerge.yml` enables GitHub native auto-merge for narrowly-scoped Dependabot PRs: only when the author is `dependabot[bot]`, the update is a SemVer patch, and the changed files are limited to the root/mobile dependency manifests and lockfiles. Auto-merge still waits on all required status checks (including the audit gate above) and branch protections; the workflow never performs an unconditional merge. End-to-end operation requires repo settings that cannot live in tracked files: *Allow auto-merge*, branch protection on `main` with the audit job as a required check, and Dependabot alerts enabled.

---

## Version Sync Gate

A CI workflow (`.github/workflows/version-check.yml`) runs `node scripts/sync-version.mjs --check` on every push to `main` and on every pull request. The job fails if the mobile version surfaces (`mobile/package.json` and `app.json` `expo.version`) drift from the canonical root `package.json` version.

The canonical app version lives in the root `package.json`. `mobile/package.json` (displayed version) and `app.json` `expo.version` must mirror it. Any required version change and sync must be included in the PR before final review; closeout makes no tracked edits. `PREVIEW_RUNTIME` in `mobile/app.config.js` separately marks preview native compatibility for EAS Update targeting.

Run the check or fix drift locally:

```sh
node scripts/sync-version.mjs --check   # report drift (CI gate)
node scripts/sync-version.mjs           # write the canonical version into the mobile files
```

---

## App File Line Limit

A CI step (`.github/workflows/test.yml`, job `test`) runs `npm run check:app-lines` on every push to `main` and every pull request. It rejects any `mobile/**/*.{js,jsx,ts,tsx}` production file over 600 lines, excluding tests (`*.test.*`/`*.spec.*` and anything under a `tests/`, `__tests__/`, `__mocks__/`, or `mocks/` directory), fixtures, generated/vendor content (`node_modules/`, `.expo/`, `dist/`, `build/`, `coverage/`, `web-build/`, `android/`, `ios/`, `assets/`), and configuration entry points (`*.config.js`/`.jsx`/`.ts`/`.tsx`, e.g. `metro.config.js`, `app.config.js`).

The repository already carried 20 files past 600 lines when this gate was added. Rather than block all unrelated work on rewriting them at once, `scripts/check-app-file-lines.mjs` pins each of them to its line count at the time (`BASELINE` in that file): a baselined file still passes as long as it has not grown past its baselined count, and partial shrinking (file stays above 600) passes without requiring a matching edit to `BASELINE`. Any file not already in `BASELINE` — new or pre-existing — is held to the plain 600-line limit with no exception. This lets an ongoing refactor program shrink the debt card by card while stopping it from growing anywhere else.

**Ratchet rule (graduation).** When a baselined file's line count is reduced to 600 or fewer, the check fails with a `STALE` regression: the BASELINE entry must be removed in the same commit that reduced the file. The authorized retirement path is to include `scripts/check-app-file-lines.mjs` in Allowed Files for the reduction card and delete the entry there. Once removed, the plain 600-line guard applies permanently — a later PR that reintroduces growth past 600 fails as a new violation. Similarly, a baseline entry for a file that has been deleted or renamed fails as `ORPHANED` and must be removed to prevent a future over-limit recreation at the same path from inheriting the old exemption.

Run the check locally:

```sh
npm run check:app-lines
```

The check's own deterministic parsing and classification (new violation vs. baseline growth vs. legacy debt) are covered by:

```sh
node --test scripts/check-app-file-lines.test.mjs
```

---

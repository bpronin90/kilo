# Testing And QA

Status: current verification guide. Commands and coverage belong here; build
mechanics and release-dashboard state belong in their dedicated runbooks.

## Native Expo Workflow

Start the Expo app:

```sh
npm run mobile:start
```

Open the QR code in Expo Go, or launch Android directly:

```sh
npm run mobile:android
```

For a standalone installable Android APK that does not depend on a running dev
machine, use the EAS build flow documented in `docs/phone-runbook.md`.
For Play Store closed-testing participants, use `docs/tester-guide.md`; it is
the plain-language quick start for joining, installing, testing, and reporting
feedback during the required 14-day window.
Play production readiness is tracked in `docs/play-store-readiness.md`.

This document owns automated verification, CI gates, coverage boundaries, and
manual smoke checks. Build and device procedures live in
[Phone Runbook](phone-runbook.md); operator-owned Play status lives in
[Play Store Readiness](play-store-readiness.md).

The automated suite covers domain logic, persistence, sync, auth, account and
consent flows, rendered component contracts, database security, and repository
tooling. It does not replace installed-device validation. Physical-device or
emulator checks remain required for native layout, notification delivery,
OAuth and password-recovery deep links, and platform packaging. The detailed
known gaps are maintained in [Coverage Gaps](#coverage-gaps), not repeated in
the coverage inventory.

---

## Running Automated Tests

Install dependencies (first time only):

```sh
npm install
npm --prefix mobile install
```

Run the active native test suite:

```sh
npm --prefix mobile test
```

GitHub Actions runs this same mobile Jest suite with Node 24 and a reproducible
`npm ci` install on every pull request and every push to `main` via
`.github/workflows/test.yml`. The required job also exports and serves the Expo
web build as a production-style bundle smoke check. A separate
`database-security` job starts a fresh disposable local Supabase database,
reapplies every migration with `supabase db reset --no-seed`, discovers every
SQL file that declares a pgTAP plan, and runs each independently.
Any failed command, skip, TODO, zero-test plan, parse failure, or abort fails the
job; CI never targets the shared production project.

Run the same database verification locally with Docker available:

```sh
supabase start --exclude edge-runtime,gotrue,imgproxy,kong,logflare,mailpit,postgres-meta,postgrest,realtime,storage-api,studio,supavisor,vector
supabase db reset --local --no-seed
node scripts/run-pgtap-suite.mjs
```

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

Review disposition is independent from CI: an
override cannot satisfy a pending or failed test, audit, version, or migration
check. Dependabot PRs derive their implementation execution from the bot and
current head, but still require an accepted review disposition before their
guarded auto-merge can complete. The evaluator's deterministic parser and
refresh-verification tests run with:

```sh
node --test scripts/review-disposition.test.mjs
```

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

For the crash reporter specifically, the narrow bootstrap verification is:

```sh
npm --prefix mobile test -- --runInBand tests/error-reporting.test.js
```

Production-like verification for issue #434:

1. Build a preview or production native binary after the Sentry env vars are set.
2. Install the binary, launch it once, and trigger a test error with a temporary `Sentry.captureException(new Error(...))` or equivalent release-only smoke hook.
3. Confirm the event appears in Sentry with app/update tags and the expected release build context.
4. Remove the temporary smoke trigger before shipping.

The repo root no longer hosts an active browser/Vitest suite. After the
browser prototype archival in issue `#213`, the root `package.json` only
retains non-test commands such as `npm run audit`.

### Cross-file test isolation: fake timers

Jest reuses a worker process across test files. The module registry is reset
between files, but React and `react-test-renderer` scheduler state established
during import-graph evaluation is not. A module-scope `jest.useFakeTimers()`
therefore contaminates the next file that runs on the same worker, which caused
an intermittent required-`test`-job failure in `session-checkin-modal.test.js`
(issue `#679`).

Suites that render components must install fake timers per test, never at module
scope:

```js
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(MOCK_NOW);
});
afterEach(() => {
  jest.useRealTimers();
});
```

When reproducing a suspected isolation flake, always pass `--no-cache`; Jest's
on-disk transform cache masks the failure roughly half the time:

```sh
npm --prefix mobile test -- --no-cache --maxWorkers=2
```

### Cross-file test isolation: unmount renderers that schedule real timers

If a rendered component schedules a real (non-fake) `setTimeout`/`setInterval` as
a side effect (for example, clearing a transient "saved" flag a couple of
seconds after a successful save), the test must unmount the `react-test-renderer`
instance so the component's effect cleanup clears that timer before the test
file ends:

```js
let harnessRenderer;
afterEach(() => {
  if (harnessRenderer) {
    render.act(() => { harnessRenderer.unmount(); });
    harnessRenderer = null;
  }
});
// ...
render.act(() => { harnessRenderer = render.create(<Harness />); });
```

An un-unmounted renderer leaves the real timer live past the test file's
completion. If it fires later in the same process, the resulting `console.error`
(for example, a React "not wrapped in act(...)" warning) lands on Jest's
post-teardown console guard, which sets a non-zero exit code with no failing
suite or test to point at. This reproduced as `cd mobile && npx jest --runInBand`
exiting 1 with a fully green summary and no visible diagnostic (issue `#683`);
`--runInBand` runs the whole suite in one process, so the leaked timer has time
to fire before the process exits. The default parallel `npm test` job splits
work across worker processes and did not reproduce the same exit-code flip,
but the underlying leak is still worth fixing wherever it's found.

---

## Automated Coverage Inventory

The test files are the executable source of truth. Use these commands for the
exact current inventory instead of maintaining a prose list of every assertion:

```sh
npm --prefix mobile test -- --listTests
rg -n '^select plan\(' supabase/tests
node --test scripts/*.test.mjs
```

Coverage is organized by boundary:

| Area | Primary locations |
|------|-------------------|
| Parsing and workout calculations | `mobile/tests/parser*.test.js`, `mobile/tests/data*.test.js`, and focused analytics/recovery suites |
| Weight, goals, units, and plate math | weight, unit-display, units, format, and plate-math suites under `mobile/tests/` |
| Local storage, backup, and migration | storage, secure-storage, backup/import, and recovery-journal suites |
| Cloud bootstrap and sync | bootstrap-cloud, offline-sync, sync-queue, auto-sync, sync-recovery, and cloud transport suites |
| Auth, consent, and account lifecycle | auth-session, health-consent, consent-gate, account-lifecycle, Turnstile, and bounded-write suites |
| Screen and component contracts | app shell, Home, Log, Weight, Analytics, More sub-screen, theme, navigation, and modal suites |
| Notifications and diagnostics | reminders, scheduler, app-update, and error-reporting suites |
| Repository tooling | Node tests beside review, changelog, migration, deployment, monitoring, and security-delivery scripts |
| Database security and concurrency | planned SQL tests under `supabase/tests/` |
| Shared Edge Function contracts | tests beside `supabase/functions/_shared/` and focused deployment scripts |

The mobile suite includes pure unit tests, storage and hook integration tests,
`react-test-renderer` interaction tests, and narrow source-contract tests.
Source-contract tests protect wiring that is difficult to render in Jest; they
are not substitutes for behavioral coverage when behavior can be exercised
directly.

The database-security CI job starts a disposable local Supabase database,
reapplies every migration, and runs every SQL file that declares a pgTAP plan.
The runner rejects skips, TODOs, zero-test plans, parse failures, and aborted
suites. Concurrency SQL uses real separate sessions where the contract requires
overlap.

### Cloud sync cost regressions

Sync latency is dominated by device-storage volume and serialized round trips,
not by algorithmic wall time, so the guards are written as assertions on *how
much work a pass does* rather than as timing thresholds (which are unstable in
CI). They live beside the behavioral sync coverage:

- `mobile/tests/sync-queue.test.js` — the dirty queue persists a whole batch in
  one write and lands the same queue a record-by-record loop would; a failed
  push leaves the entire batch armed with the cursor unmoved and no baseline
  claimed; the baseline is recorded from what `writeLocal` persisted; an
  unchanged baseline is not rewritten, a changed one is, and a baseline removed
  underneath the engine is re-persisted.
- `mobile/tests/sync-recovery.test.js` — with independent tables running
  concurrently, a note is still pushed before the recovery block whose baseline
  names it and a block before its memberships; a failure in one independent
  table still fails the pass and still stops the dependent recovery collections
  from being attempted, while unrelated tables complete; overlapping `sync()`
  calls still resolve to a single pass. Two further cases cover work that exists
  only in memory when something goes wrong: an entry saved while a pass is
  holding its copy survives that pass's whole-table write even when the pass then
  fails, and a note tombstone deferred by a table that succeeded still reaches
  the dirty queue when a sibling table fails the pass. Both were verified by
  disabling their fix and confirming the test fails.

To profile a pass, drive `syncAdapter.sync()` against `createSupabaseTransport`
with a fake Supabase client that delays each `rpc`/`upsert`/`auth` call by a
chosen RTT, and wrap the AsyncStorage jest mock so every `getItem`/`setItem`
performs the same AES-GCM envelope `secureStorage` applies on device. Count round
trips and bytes per storage key; those are reproducible, whereas wall time is
not. Such a harness records counts, byte sizes, table names, and timings only —
never payload content, which would put workout text and health values into test
output.

Operational production checks are not automated test inventory:

- Auth-provider, CAPTCHA, SMTP, OAuth, policy-link, and throttle verification
  belongs in [Backend Activation](backend-activation.md).
- Installed-device and browser verification belongs in the smoke checklists
  below.
- Play Console state belongs in
  [Play Store Readiness](play-store-readiness.md).

---

## Coverage Gaps

The following MVP behaviors have no automated test coverage:

**End-to-end**
- No automated native test covers native forms, native validation/success UI
  feedback, or native layout/runtime behavior. `mobile/App.js` now has focused
  app-shell coverage for tab switching and Android hardware-back behavior, but
  not a real Expo device/emulator pass.

---

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

The canonical app version lives in the root `package.json`. `mobile/package.json` (displayed version) and `app.json` `expo.version` must mirror it. Any required version change and sync must be included in the PR before final review; closeout makes no tracked edits. `PREVIEW_RUNTIME` in `mobile/app.config.js` separately marks preview native compatibility even while remote updates are disabled.

Run the check or fix drift locally:

```sh
node scripts/sync-version.mjs --check   # report drift (CI gate)
node scripts/sync-version.mjs           # write the canonical version into the mobile files
```

---

## Installable Preview Smoke Checklist

Before declaring the packaged preview ready, a human tester must pass every step below on a physical phone. This is the minimum real-device check for installability, launch, update/relaunch, loading behavior, and basic touch interaction. It is not full product QA.

1. Build and install the native preview APK on a connected phone.
   ```sh
   cd mobile && eas build --platform android --profile preview
   ```
2. Open the app from the phone launcher and confirm it starts without a crash or blank screen.  **[BLOCKER]**
3. Confirm all five tabs are visible and respond to taps: Home, Log, Weight, Analytics, More.  **[BLOCKER]**
4. On **Weight**, confirm the entry field and **Save weigh-in** button load, the button is disabled when the field is empty, and a valid value such as `185` saves successfully and updates Weight History.  **[BLOCKER]**
5. Fully close and reopen the installed app. Confirm it launches normally and the saved weight entry remains present.  **[BLOCKER]**
6. On **Log**, enter one simple workout row such as `135 5,5,5`. Confirm the parse preview appears, the header **Save** action becomes enabled, and saving shows the saved workout.  **[BLOCKER]**
7. Return to **Home** and confirm the new workout appears in recent history with the most recent entry first.  **[BLOCKER]**
8. Do one basic touch pass on the device: scroll recent history, switch tabs a few times, and confirm taps register cleanly without missed or stuck interactions.  **[BLOCKER]**

---

## Web Export Smoke Check

This is the minimum repeatable verification for the static web export path
(Phase 2 / Task 4, issue #313). It has two parts: a fast automated **pre-flight**
that only proves the static entrypoint is served, and a **required** manual
browser + local-data pass that actually proves the exported app boots and reads
and writes local data. It is intentionally narrow: it is a boot/local-data smoke
check, not full web E2E. No browser automation framework is added as a repo
dependency.

Boot is only considered verified once the required browser + local-data pass
below is performed. The automated pre-flight alone does not prove boot.

Dependency: relies on the static web export from Task 4 / #313
(`app.json` `web.bundler: "metro"` and `web.output: "single"`) being present
after merge. The pre-flight does not inspect or validate that config itself; it
fails fast with a clear message only if `expo export --platform web` does not
emit a `dist/index.html` single-output build.

### Automated pre-flight (`web:smoke`)

This is a fast pre-flight only. Run it first to catch gross export/serve
failures, but **do not** treat a pass as proof that the app boots or reads local
data — it does neither.

Run from the repo root:

```sh
npm run web:smoke
```

This single command:

1. Builds the static web export (`expo export --platform web`) into
   `mobile/dist/`.
2. Asserts `mobile/dist/index.html` exists (proves a single-output web build,
   not a native bundle).
3. Serves the exported output locally with `expo serve` on port `8099`.
4. Fetches the served entrypoint and confirms it is served: an HTTP `200`, the
   `root` mount node in the static HTML, and a referenced `_expo/static/js`
   bundle.
5. Prints `SMOKE PASS` and exits `0` on success, or `SMOKE FAIL: <reason>` and
   exits non-zero so a human or CI runner can gate on it.

What this pre-flight does **not** prove: it never executes the JS bundle, never
observes React Native Web mounting, and never exercises local-data
(AsyncStorage/`localStorage`) behavior. It only confirms the static entrypoint is
served. It can still pass with a bundle that crashes before mount. Use it as a
cheap gate, then run the required pass below for actual boot verification.

### Required browser + local-data boot verification (human)

This is the authoritative boot check. The export is not considered verified until
this pass succeeds. It must be performed in a real browser against the served
export.

```sh
npm run web:export   # build the static export into mobile/dist/
npm run web:serve    # serve mobile/dist/ at http://127.0.0.1:8081/
```

Open `http://127.0.0.1:8081/` in a browser, then:

1. Confirm the app shell **visibly mounts**: the Kilo Home screen renders with
   real content (Welcome card and the five tabs Home, Log, Weight, Analytics,
   More), not just an empty `#root` and no blank screen or console boot crash.
   An empty or text-less `#root` is a failure even if the pre-flight passed.
2. On **Weight**, enter a value such as `185` in the Weight (lb) field and tap
   **Save weigh-in**. Confirm it appears in the History list (the local browser
   storage write path works). Optionally confirm the browser dev tools show a
   `kilo_weight_entries` key in `localStorage`/IndexedDB (the AsyncStorage web
   backend).
3. Reload the page and confirm the saved entry **persists** in the History list
   and trends, proving the export boots against local data rather than a fresh
   empty shell.

Stop and reload from native QA if the served export cannot mount the shell or the
saved entry does not survive reload; that indicates a Task 4 export-config or
local-data regression rather than a smoke-tooling issue.

### Static hosting note

The exported `mobile/dist/` is the static artifact for the documented hosting
target (Cloudflare Pages, Netlify, Vercel static output, or equivalent). The
selected host must serve `index.html` as the SPA fallback entrypoint. `expo
serve` is the local stand-in for that static host during smoke verification; it
is not a production hosting dependency.

`mobile/public/_headers` is copied into the static export and is the Cloudflare
Pages security-header contract. It applies a CSP with `frame-ancestors 'none'`,
same-origin application scripts plus the exact Turnstile challenge origin,
narrowly allow-listed Supabase/Auth, Turnstile, and Sentry data connections, and
no `unsafe-eval`; it also denies unused browser capabilities through
`Permissions-Policy`. After export, confirm `mobile/dist/_headers`
exists. After deployment, inspect the actual entrypoint response and confirm at
least `Content-Security-Policy`, `Permissions-Policy`,
`X-Content-Type-Options`, and `X-Frame-Options` are present. Cloudflare `_headers`
does not apply to Pages Functions responses, so a future Worker/Functions path
must set the same policy in its own response code.

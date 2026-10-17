# Run Automated Tests

For contributors selecting a targeted test command and writing isolated Jest fixtures. CI policy is in [CI Gates](ci-gates.md); coverage evidence is in [Test Coverage](test-coverage.md).

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

Log-screen coverage is organized by behavior in `mobile/tests/log-screen-*.test.js`
(editor save/revert, A/B weeks, routine cards, skip/deload, recovery lifecycle,
and navigation). Repeated rendering/action helpers live in
`mobile/tests/helpers/log-screen.js`; mocks and cleanup remain suite-local.
Run all log-screen suites together, or one behavior suite independently:

```sh
cd mobile
npx jest --runInBand --testPathPattern='tests/log-screen-.*\.test\.js$'
timeout 200 npx jest --runInBand --runTestsByPath tests/log-screen-autosave.test.js
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

A third `shared-deno` job runs the shared Edge Function module tests on every
pull request and every push to `main`. It installs Deno and executes all three
`supabase/functions/_shared/*.test.ts` files (`security-event`, `rate-limit`,
and `health-data-scope`) in one `deno test` invocation. The permissions are the
minimum the current suite needs: `--allow-import` for the remote `deno.land`
standard-library import and `--allow-read` for the migration-directory reads
that `health-data-scope.test.ts` performs; `--no-check` and `--no-lock` keep the
suite's established invocation. The rate-limit cases assert event
classification behaviorally — they drive `rateLimitAllowed` through a recording
client double and inspect the `record_security_event` RPC it receives, so an
exhausted bucket is proven to emit the subject-attributed
`ratelimit.ip_blocked` / `ratelimit.user_blocked` throttle event while a limiter
outage emits only a subjectless `ratelimit.unavailable` (denied under the `deny`
policy, allowed under `allow`). No test greps implementation or endpoint source
to reach that verdict.

Run the same shared-module suite locally with Deno installed:

```sh
deno test --no-check --no-lock --allow-import --allow-read \
  supabase/functions/_shared/security-event.test.ts \
  supabase/functions/_shared/rate-limit.test.ts \
  supabase/functions/_shared/health-data-scope.test.ts
```


## Security monitoring tests

### Production security monitoring

`.github/workflows/security-event-monitor.yml` runs
`scripts/check-security-events.mjs` hourly against the live project and alerts
on any critical security event, on auth-failure volume and spread, on throttle
volume, on failed privileged operations, and on a retention sweep that has
stopped running. Findings are exit 1; a run that cannot reach the database is
exit 2 and a failed monitor, never a green one.

Its offline contract suite runs on any pull request that touches the monitor,
the recorder, the migration, or the workflow:

```sh
npm run test:security-events
node scripts/check-security-events.mjs --dry-run
```

Those cover redaction, every threshold boundary, the 0/1/2 exit discipline, and
the agreement between the TypeScript and SQL copies of the event catalog and
context allow-list. The database side --- catalog enforcement, server-derived
severity, context sanitization, access control, the ingest cap, and retention
--- is `supabase/tests/security-events.test.sql`, run by the `database-security`
job. The full contract lives in [Security Monitoring](../security/security-monitoring.md).

## Crash-reporting verification

For the crash reporter specifically, the narrow bootstrap verification is:

```sh
npm --prefix mobile test -- --runInBand tests/error-reporting.test.js
```

Production-like verification for issue #434:

1. Build a preview or production native binary after the Sentry env vars are set.
2. Install the binary, launch it once, and trigger a test error with a temporary `Sentry.captureException(new Error(...))` or equivalent release-only smoke hook.
3. Confirm the event appears in Sentry with app/update tags and the expected release build context.
4. Remove the temporary smoke trigger before shipping.

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

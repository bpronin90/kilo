#!/usr/bin/env node
// Deterministic contract tests for the health-deletion backlog monitor and the
// e2e boundary harness.
//
// Everything here runs against a stubbed `psql` and pure functions. Nothing
// contacts a database, a Supabase project, or a real secret. The repo root has
// no test runner (see docs/testing-and-qa.md), so this uses node:assert and the
// same subprocess-stub shape as scripts/deploy-kilo-functions.test.mjs.
//
// The load-bearing test is the redaction one: kilo.health_deletion_backlog
// returns user_id, and the monitor must never let it -- or an email address, or
// a key -- reach an alert surface.

import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  buildAlert,
  redactJob,
  scrubError,
  thresholdsFromEnv,
} from './check-health-deletion-backlog.mjs';
import {
  BOUNDARY_SCENARIOS,
  assertTargetAllowed,
  classifyBoundaryFailure,
  finalExitCode,
  projectRefFromDatabaseUrl,
  projectRefFromUrl,
  resolveTargetIdentity,
} from './test-health-deletion-e2e.mjs';

const repoRoot = new URL('..', import.meta.url).pathname;
const monitorPath = join(repoRoot, 'scripts/check-health-deletion-backlog.mjs');

const FIXTURE_USER_ID = '99999999-9999-4999-8999-999999999999';
const FIXTURE_JOB_ID = '11111111-1111-4111-8111-111111111111';
const FIXTURE_EMAIL = 'withdrawn.person@example.com';
const FIXTURE_KEY = 'sb_secret_thisisnotarealkeyvalue';

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: err.message });
  }
}

const DEFAULT_THRESHOLDS = { maxAgeMinutes: 60, maxAttempts: 5, runningStaleMinutes: 30 };

function snapshot(overrides = {}) {
  return {
    checked_at: '2026-07-19T12:00:00Z',
    drain_cron_active: true,
    drain_cron_present: true,
    required_secret_names: ['kilo_functions_base_url', 'kilo_service_role_key'],
    present_secret_names: ['kilo_functions_base_url', 'kilo_service_role_key'],
    jobs: [],
    ...overrides,
  };
}

function job(overrides = {}) {
  return {
    job_id: FIXTURE_JOB_ID,
    user_id: FIXTURE_USER_ID,
    reason: 'withdrawal',
    status: 'pending',
    attempts: 0,
    age: '00:05:00',
    age_seconds: 300,
    last_error: null,
    ...overrides,
  };
}

// --- redaction ----------------------------------------------------------

test('redactJob drops user_id entirely', () => {
  const redacted = redactJob(job());
  assert.ok(!('user_id' in redacted), 'user_id must not survive redaction');
  assert.equal(JSON.stringify(redacted).includes(FIXTURE_USER_ID), false);
});

test('redactJob is an allowlist: an unknown future column is dropped', () => {
  const redacted = redactJob(job({ weight_value: 81.4, email: FIXTURE_EMAIL }));
  assert.deepEqual(Object.keys(redacted).sort(), [
    'age_seconds',
    'attempts',
    'job_id',
    'last_error',
    'reason',
    'status',
  ]);
  assert.equal(JSON.stringify(redacted).includes('81.4'), false);
  assert.equal(JSON.stringify(redacted).includes(FIXTURE_EMAIL), false);
});

test('scrubError removes email addresses, Supabase keys, and JWTs', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl';
  const scrubbed = scrubError(`failed for ${FIXTURE_EMAIL} using ${FIXTURE_KEY} and ${jwt}`);
  assert.equal(scrubbed.includes(FIXTURE_EMAIL), false);
  assert.equal(scrubbed.includes(FIXTURE_KEY), false);
  assert.equal(scrubbed.includes(jwt), false);
  assert.match(scrubbed, /\[redacted-email\]/);
  assert.match(scrubbed, /\[redacted-key\]/);
  assert.match(scrubbed, /\[redacted-jwt\]/);
});

test('scrubError bounds length and collapses newlines', () => {
  const scrubbed = scrubError(`a\nb${'x'.repeat(500)}`);
  assert.ok(scrubbed.length <= 220, `expected a bounded string, got ${scrubbed.length}`);
  assert.equal(scrubbed.includes('\n'), false);
  assert.match(scrubbed, /\[truncated\]$/);
});

test('scrubError preserves the operational row count the runbook needs', () => {
  assert.equal(scrubError('17 scoped rows remain'), '17 scoped rows remain');
});

test('buildAlert output never contains a user id anywhere', () => {
  const alert = buildAlert(
    snapshot({ jobs: [job({ status: 'failed', attempts: 9, last_error: `boom ${FIXTURE_EMAIL}` })] }),
    DEFAULT_THRESHOLDS,
    'test-ref'
  );
  assert.equal(JSON.stringify(alert).includes(FIXTURE_USER_ID), false);
  assert.equal(JSON.stringify(alert).includes(FIXTURE_EMAIL), false);
});

// --- finding detection --------------------------------------------------

test('a healthy snapshot produces no findings', () => {
  const alert = buildAlert(snapshot({ jobs: [job()] }), DEFAULT_THRESHOLDS, 'test-ref');
  assert.equal(alert.healthy, true);
  assert.deepEqual(alert.findings, []);
});

test('a job older than the age threshold is a finding', () => {
  const alert = buildAlert(snapshot({ jobs: [job({ age_seconds: 4000 })] }), DEFAULT_THRESHOLDS, 'test-ref');
  assert.equal(alert.healthy, false);
  assert.ok(alert.findings.some((f) => f.kind === 'job-older-than-threshold'));
});

test('attempts at the threshold without completion is a finding', () => {
  const alert = buildAlert(
    snapshot({ jobs: [job({ status: 'failed', attempts: 5 })] }),
    DEFAULT_THRESHOLDS,
    'test-ref'
  );
  assert.ok(alert.findings.some((f) => f.kind === 'attempts-without-completion'));
});

test('a running job past the reclaim ceiling is a finding', () => {
  const alert = buildAlert(
    snapshot({ jobs: [job({ status: 'running', age_seconds: 2400 })] }),
    DEFAULT_THRESHOLDS,
    'test-ref'
  );
  assert.ok(alert.findings.some((f) => f.kind === 'running-job-stale'));
});

test('a running job inside the reclaim ceiling is not a finding', () => {
  const alert = buildAlert(
    snapshot({ jobs: [job({ status: 'running', age_seconds: 600 })] }),
    DEFAULT_THRESHOLDS,
    'test-ref'
  );
  assert.equal(alert.healthy, true);
});

// Finding 3 (stale-`running` measured from created_at rather than updated_at)
// is deliberately NOT fixed here: correcting it needs an RLS policy or a change
// to kilo.health_deletion_backlog's return type, both in supabase/migrations/,
// which is outside this issue's Allowed Files. This test pins the current,
// documented behavior so the limitation is explicit rather than accidental.
test('the stale check currently measures from created_at (documented scope-blocked gap)', () => {
  const alert = buildAlert(
    snapshot({ jobs: [job({ status: 'running', age_seconds: 3000 })] }),
    DEFAULT_THRESHOLDS,
    'test-ref'
  );
  const finding = alert.findings.find((f) => f.kind === 'running-job-stale');
  assert.ok(finding, 'a long-queued running job still pages today');
  assert.match(finding.detail, /since creation/);
});

test('an inactive drain cron is a finding even with an empty queue', () => {
  const alert = buildAlert(snapshot({ drain_cron_active: false }), DEFAULT_THRESHOLDS, 'test-ref');
  assert.equal(alert.healthy, false);
  assert.ok(alert.findings.some((f) => f.kind === 'drain-cron-inactive'));
});

test('a missing worker Vault secret name is a finding, and only names are reported', () => {
  const alert = buildAlert(
    snapshot({ present_secret_names: ['kilo_functions_base_url'] }),
    DEFAULT_THRESHOLDS,
    'test-ref'
  );
  const finding = alert.findings.find((f) => f.kind === 'worker-config-absent');
  assert.ok(finding);
  assert.match(finding.detail, /kilo_service_role_key/);
  assert.equal(finding.detail.includes(FIXTURE_KEY), false);
});

test('thresholdsFromEnv reads overrides and falls back to documented defaults', () => {
  assert.deepEqual(thresholdsFromEnv({}), DEFAULT_THRESHOLDS);
  assert.deepEqual(thresholdsFromEnv({ KILO_DELETION_MAX_AGE_MINUTES: '10' }), {
    ...DEFAULT_THRESHOLDS,
    maxAgeMinutes: 10,
  });
});

// --- exit-code contract (subprocess, stubbed psql) ----------------------

function writeStubPsql(directory, payload, mode = 'ok') {
  const binDirectory = join(directory, 'bin');
  mkdirSync(binDirectory, { recursive: true });
  const stubPath = join(binDirectory, 'psql');
  writeFileSync(
    stubPath,
    `#!/usr/bin/env node
if (process.env.STUB_MODE === 'fail') {
  process.stderr.write('stub psql: simulated connection failure\\n');
  process.exit(1);
}
process.stdout.write(process.env.STUB_PAYLOAD + '\\n');
`,
    { mode: 0o755 }
  );
  chmodSync(stubPath, 0o755);
  return { binDirectory, payload, mode };
}

function runMonitor({ payload = snapshot(), mode = 'ok', env = {}, credentials = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'kilo-deletion-monitor-'));
  try {
    const { binDirectory } = writeStubPsql(directory, payload, mode);
    const result = spawnSync(process.execPath, [monitorPath], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        PATH: `${binDirectory}:${process.env.PATH}`,
        STUB_MODE: mode,
        STUB_PAYLOAD: JSON.stringify(payload),
        // Point at a nonexistent file so a developer's real .env can never
        // influence a test run.
        KILO_MONITOR_ENV_FILE: join(directory, 'absent.env'),
        ...(credentials
          ? { SUPABASE_HEALTH_MONITOR_URL: 'postgresql://monitor:stub-credential-not-real@example.invalid:5432/postgres' }
          : {}),
        ...env,
      },
    });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('exit 0 when the queue is draining', () => {
  const { status, output } = runMonitor({ payload: snapshot({ jobs: [job()] }) });
  assert.equal(status, 0, output);
  assert.match(output, /health-deletion-backlog: ok/);
});

test('exit 1 when a real production problem is detected', () => {
  const { status, output } = runMonitor({
    payload: snapshot({ jobs: [job({ age_seconds: 99999, status: 'failed', attempts: 12 })] }),
  });
  assert.equal(status, 1, output);
  assert.match(output, /finding\(s\)/);
});

test('exit 2 when credentials are missing — never a green result', () => {
  const { status, output } = runMonitor({ credentials: false });
  assert.equal(status, 2, output);
  assert.match(output, /Refusing to report a healthy purge queue/);
  assert.doesNotMatch(output, /ok —/);
});

test('exit 2 when the database is unreachable', () => {
  const { status, output } = runMonitor({ mode: 'fail' });
  assert.equal(status, 2, output);
  assert.doesNotMatch(output, /ok —/);
});

test('exit 2 when the query returns unparseable output', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kilo-deletion-monitor-bad-'));
  try {
    const { binDirectory } = writeStubPsql(directory, {});
    const result = spawnSync(process.execPath, [monitorPath], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        PATH: `${binDirectory}:${process.env.PATH}`,
        STUB_MODE: 'ok',
        STUB_PAYLOAD: 'not json at all',
        KILO_MONITOR_ENV_FILE: join(directory, 'absent.env'),
        SUPABASE_HEALTH_MONITOR_URL: 'postgresql://monitor:stub-credential-not-real@example.invalid:5432/postgres',
      },
    });
    assert.equal(result.status, 2, `${result.stdout}${result.stderr}`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the subprocess never prints the user id or the connection password', () => {
  const { output } = runMonitor({
    payload: snapshot({ jobs: [job({ status: 'failed', attempts: 9, last_error: `boom ${FIXTURE_EMAIL}` })] }),
  });
  assert.equal(output.includes(FIXTURE_USER_ID), false, 'user id leaked to an alert surface');
  assert.equal(output.includes(FIXTURE_EMAIL), false, 'email leaked to an alert surface');
  assert.equal(output.includes('stub-credential-not-real'), false, 'connection password leaked');
});

// --- e2e harness guards -------------------------------------------------

const PROD_REF = 'ogzhnscdqcdrhfqcobuv';
const PROD_API = `https://${PROD_REF}.supabase.co`;
const PROD_DB = `postgresql://postgres.${PROD_REF}:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres`;
const ISOLATED_API = 'https://localtestref.supabase.co';
const ISOLATED_DB = 'postgresql://postgres:pw@db.localtestref.supabase.co:5432/postgres';

test('projectRefFromUrl extracts the ref', () => {
  assert.equal(projectRefFromUrl(PROD_API), PROD_REF);
  assert.equal(projectRefFromUrl('not a url'), null);
});

test('projectRefFromUrl fails closed on an unrecognized host', () => {
  assert.equal(projectRefFromUrl('https://example.com'), null);
  assert.equal(projectRefFromUrl('https://evil.supabase.co.attacker.test'), null);
});

test('projectRefFromUrl recognizes a local stack as one identity', () => {
  assert.equal(projectRefFromUrl('http://127.0.0.1:54321'), 'local');
  assert.equal(projectRefFromUrl('http://localhost:54321'), 'local');
});

test('projectRefFromDatabaseUrl extracts the ref from the direct host', () => {
  assert.equal(projectRefFromDatabaseUrl(`postgresql://postgres:pw@db.${PROD_REF}.supabase.co:5432/postgres`), PROD_REF);
});

test('projectRefFromDatabaseUrl extracts the ref from the pooler username', () => {
  assert.equal(projectRefFromDatabaseUrl(PROD_DB), PROD_REF);
});

test('projectRefFromDatabaseUrl fails closed on hosts it cannot identify', () => {
  assert.equal(projectRefFromDatabaseUrl('postgresql://postgres:pw@somewhere.example.com:5432/postgres'), null);
  // Pooler host without the ref-bearing username: unidentifiable, so refused.
  assert.equal(projectRefFromDatabaseUrl('postgresql://postgres:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres'), null);
  assert.equal(projectRefFromDatabaseUrl('https://db.example.supabase.co'), null);
  assert.equal(projectRefFromDatabaseUrl('not a url'), null);
});

// --- finding 1 regression: mismatched targets are rejected up front ------

test('a mismatched API/database target pair is REJECTED', () => {
  // The exact bypass: an isolated API URL paired with the production database
  // URL. Every write goes through the database URL, so this previously passed
  // both production guards and wrote fixture rows to production.
  const identity = resolveTargetIdentity({ supabaseUrl: ISOLATED_API, databaseUrl: PROD_DB });
  assert.equal(identity.ok, false);
  assert.match(identity.reason, /target mismatch/);
  assert.match(identity.reason, new RegExp(PROD_REF));
});

test('assertTargetAllowed refuses a mismatched pair before any production check', () => {
  const guard = assertTargetAllowed({
    supabaseUrl: ISOLATED_API,
    databaseUrl: PROD_DB,
    emailDomain: 'e2e.invalid',
    // Both production guards fully satisfied: they must not be able to rescue a
    // mismatched pair, because they never inspected the database endpoint.
    allowProduction: true,
    confirmedDomain: 'e2e.invalid',
  });
  assert.equal(guard.ok, false);
  assert.match(guard.reason, /target mismatch/);
});

test('the reverse mismatch is refused too', () => {
  const guard = assertTargetAllowed({
    supabaseUrl: PROD_API,
    databaseUrl: ISOLATED_DB,
    emailDomain: 'e2e.invalid',
    allowProduction: true,
    confirmedDomain: 'e2e.invalid',
  });
  assert.equal(guard.ok, false);
  assert.match(guard.reason, /target mismatch/);
});

test('an unparseable database endpoint fails closed rather than being assumed safe', () => {
  const guard = assertTargetAllowed({
    supabaseUrl: ISOLATED_API,
    databaseUrl: 'postgresql://postgres:pw@unknown-host.example:5432/postgres',
    emailDomain: 'e2e.invalid',
    allowProduction: false,
  });
  assert.equal(guard.ok, false);
  assert.match(guard.reason, /KILO_E2E_DATABASE_URL/);
});

test('an unparseable API endpoint fails closed', () => {
  const guard = assertTargetAllowed({
    supabaseUrl: 'https://example.com',
    databaseUrl: ISOLATED_DB,
    emailDomain: 'e2e.invalid',
    allowProduction: false,
  });
  assert.equal(guard.ok, false);
  assert.match(guard.reason, /KILO_E2E_SUPABASE_URL/);
});

test('a matched isolated pair needs no production guards', () => {
  const guard = assertTargetAllowed({
    supabaseUrl: ISOLATED_API,
    databaseUrl: ISOLATED_DB,
    emailDomain: 'e2e.invalid',
    allowProduction: false,
  });
  assert.equal(guard.ok, true);
  assert.equal(guard.isProduction, false);
});

test('a matched local stack pair is accepted and is never production', () => {
  const guard = assertTargetAllowed({
    supabaseUrl: 'http://127.0.0.1:54321',
    databaseUrl: 'postgresql://postgres:pw@127.0.0.1:54322/postgres',
    emailDomain: 'e2e.invalid',
    allowProduction: false,
  });
  assert.equal(guard.ok, true);
  assert.equal(guard.isProduction, false);
});

test('production is refused without the operator flag', () => {
  const guard = assertTargetAllowed({
    supabaseUrl: PROD_API,
    databaseUrl: PROD_DB,
    emailDomain: 'e2e.invalid',
    allowProduction: false,
    confirmedDomain: 'e2e.invalid',
  });
  assert.equal(guard.ok, false);
  assert.match(guard.reason, /--allow-production/);
});

test('production is refused with the flag but no disposable-account guard', () => {
  const guard = assertTargetAllowed({
    supabaseUrl: PROD_API,
    databaseUrl: PROD_DB,
    emailDomain: 'e2e.invalid',
    allowProduction: true,
  });
  assert.equal(guard.ok, false);
  assert.match(guard.reason, /DISPOSABLE_ACCOUNT_CONFIRMED/);
});

test('production is refused when the disposable-account guard names another domain', () => {
  const guard = assertTargetAllowed({
    supabaseUrl: PROD_API,
    databaseUrl: PROD_DB,
    emailDomain: 'e2e.invalid',
    allowProduction: true,
    confirmedDomain: 'someone-elses-domain.test',
  });
  assert.equal(guard.ok, false);
});

test('production is allowed only when both endpoints match and both guards agree', () => {
  const guard = assertTargetAllowed({
    supabaseUrl: PROD_API,
    databaseUrl: PROD_DB,
    emailDomain: 'e2e.invalid',
    allowProduction: true,
    confirmedDomain: 'e2e.invalid',
  });
  assert.equal(guard.ok, true);
  assert.equal(guard.isProduction, true);
});

test('a missing disposable mail domain is refused even off production', () => {
  const guard = assertTargetAllowed({
    supabaseUrl: ISOLATED_API,
    databaseUrl: ISOLATED_DB,
    emailDomain: '',
    allowProduction: false,
  });
  assert.equal(guard.ok, false);
});

// --- boundary failure classification ------------------------------------

const healthy = {
  dispatchRequestId: 42,
  secretsPresent: true,
  functionDeployed: true,
  netResponse: { status_code: 200, error_msg: null },
  remainingRows: 0,
  jobStatus: 'complete',
  attempts: 1,
};

test('missing Vault configuration is classified', () => {
  assert.equal(
    classifyBoundaryFailure({ ...healthy, secretsPresent: false, dispatchRequestId: null }).stage,
    'missing-vault-configuration'
  );
});

test('a missing function is classified', () => {
  assert.equal(classifyBoundaryFailure({ ...healthy, functionDeployed: false }).stage, 'missing-function');
  assert.equal(
    classifyBoundaryFailure({ ...healthy, netResponse: { status_code: 404, error_msg: null } }).stage,
    'missing-function'
  );
});

test('a null dispatch (the #492 silent failure) is classified', () => {
  assert.equal(
    classifyBoundaryFailure({ ...healthy, dispatchRequestId: null }).stage,
    'dispatch-returned-null'
  );
});

test('a pg_net transport failure is classified', () => {
  assert.equal(
    classifyBoundaryFailure({ ...healthy, netResponse: { status_code: null, error_msg: 'timeout' } }).stage,
    'pg-net-failure'
  );
});

test('an HTTP authentication failure is classified', () => {
  for (const code of [401, 403]) {
    assert.equal(
      classifyBoundaryFailure({ ...healthy, netResponse: { status_code: code, error_msg: null } }).stage,
      'http-authentication-failure'
    );
  }
});

test('partial erasure is classified', () => {
  assert.equal(
    classifyBoundaryFailure({ ...healthy, remainingRows: 3, jobStatus: 'failed' }).stage,
    'partial-erasure'
  );
});

test('a retrying job is classified', () => {
  assert.equal(
    classifyBoundaryFailure({ ...healthy, jobStatus: 'pending', attempts: 2 }).stage,
    'retry-pending'
  );
});

test('eventual completion classifies as no failure', () => {
  assert.equal(classifyBoundaryFailure(healthy), null);
});

// --- finding 2 regression: the drain entrypoint and real scenario stages --

const harnessSource = readFileSync(join(repoRoot, 'scripts/test-health-deletion-e2e.mjs'), 'utf8');

test('the harness drives the cron entrypoint, not dispatch directly', () => {
  assert.match(harnessSource, /kilo\.drain_health_deletion_jobs\(\)/);
  assert.equal(
    harnessSource.includes('select kilo.dispatch_health_deletion_worker()'),
    false,
    'the harness must drive kilo.drain_health_deletion_jobs(), the function pg_cron actually invokes'
  );
});

test('the harness asserts the drain result contract', () => {
  for (const key of ['reopened', 'reclaimed_stale', 'dispatched', 'request_id']) {
    assert.ok(harnessSource.includes(`'${key}'`), `the drain result key ${key} must be asserted`);
  }
});

test('the harness verifies the cron job exists, is active, and calls the drain function', () => {
  assert.match(harnessSource, /from cron\.job where jobname = 'health-deletion-drain'/);
  assert.match(harnessSource, /is not active/);
  assert.match(harnessSource, /drain_health_deletion_jobs\\s\*\\\(/);
});

test('all seven required boundary cases exist as real harness stages', () => {
  const names = BOUNDARY_SCENARIOS.map((s) => s.name).sort();
  assert.deepEqual(names, [
    'eventual-completion',
    'http-authentication-failure',
    'missing-function',
    'missing-vault-configuration',
    'partial-erasure',
    'pg-net-failure',
    'retry',
  ]);
  for (const scenario of BOUNDARY_SCENARIOS) {
    assert.equal(typeof scenario.run, 'function', `${scenario.name} must drive the target`);
  }
});

test('the scenario stages are refused against production unconditionally', () => {
  assert.match(harnessSource, /--scenarios is refused against production unconditionally/);
});

// --- finding 4 regression: cleanup failure can never be green ------------

test('a cleanup failure alone produces a nonzero exit', () => {
  assert.equal(finalExitCode({ failed: null, cleanupFailure: 'account still present' }), 1);
});

test('a clean run with successful cleanup exits 0', () => {
  assert.equal(finalExitCode({ failed: null, cleanupFailure: null }), 0);
});

test('no combination involving a cleanup failure can exit 0', () => {
  for (const failed of [null, { stage: 'partial-erasure' }, { stage: 'harness-error' }]) {
    assert.notEqual(
      finalExitCode({ failed, cleanupFailure: 'left behind' }),
      0,
      'a surviving fixture account must never report success'
    );
  }
});

test('a boundary failure still outranks nothing and a harness error exits 2', () => {
  assert.equal(finalExitCode({ failed: { stage: 'partial-erasure' }, cleanupFailure: null }), 1);
  assert.equal(finalExitCode({ failed: { stage: 'harness-error' }, cleanupFailure: null }), 2);
});

test('the cleanup failure report identifies the account without leaking a secret', () => {
  assert.match(harnessSource, /CLEANUP FAILED/);
  assert.match(harnessSource, /account uuid/);
  // The fixture password and access token must never reach the report.
  const report = harnessSource.slice(harnessSource.indexOf('CLEANUP FAILED'), harnessSource.indexOf('CLEANUP FAILED') + 600);
  assert.equal(report.includes('${password}'), false, 'the fixture password must never be printed');
  assert.equal(report.includes('${accessToken}'), false, 'the access token must never be printed');
});

// --- report -------------------------------------------------------------

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? 'ok' : 'FAIL'} - ${r.name}${r.ok ? '' : `\n     ${r.error}`}`);
}
console.log(`\n${results.length - failed.length}/${results.length} health-deletion monitor tests passed.`);
process.exit(failed.length > 0 ? 1 : 0);

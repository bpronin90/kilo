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
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  assertTargetAllowed,
  classifyBoundaryFailure,
  projectRefFromUrl,
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

test('projectRefFromUrl extracts the ref', () => {
  assert.equal(projectRefFromUrl('https://ogzhnscdqcdrhfqcobuv.supabase.co'), 'ogzhnscdqcdrhfqcobuv');
  assert.equal(projectRefFromUrl('not a url'), null);
});

test('an isolated project needs no production guards', () => {
  const guard = assertTargetAllowed({
    supabaseUrl: 'https://localtestref.supabase.co',
    emailDomain: 'e2e.invalid',
    allowProduction: false,
  });
  assert.equal(guard.ok, true);
  assert.equal(guard.isProduction, false);
});

test('production is refused without the operator flag', () => {
  const guard = assertTargetAllowed({
    supabaseUrl: 'https://ogzhnscdqcdrhfqcobuv.supabase.co',
    emailDomain: 'e2e.invalid',
    allowProduction: false,
    confirmedDomain: 'e2e.invalid',
  });
  assert.equal(guard.ok, false);
  assert.match(guard.reason, /--allow-production/);
});

test('production is refused with the flag but no disposable-account guard', () => {
  const guard = assertTargetAllowed({
    supabaseUrl: 'https://ogzhnscdqcdrhfqcobuv.supabase.co',
    emailDomain: 'e2e.invalid',
    allowProduction: true,
  });
  assert.equal(guard.ok, false);
  assert.match(guard.reason, /DISPOSABLE_ACCOUNT_CONFIRMED/);
});

test('production is refused when the disposable-account guard names another domain', () => {
  const guard = assertTargetAllowed({
    supabaseUrl: 'https://ogzhnscdqcdrhfqcobuv.supabase.co',
    emailDomain: 'e2e.invalid',
    allowProduction: true,
    confirmedDomain: 'someone-elses-domain.test',
  });
  assert.equal(guard.ok, false);
});

test('production is allowed only when both guards are present and agree', () => {
  const guard = assertTargetAllowed({
    supabaseUrl: 'https://ogzhnscdqcdrhfqcobuv.supabase.co',
    emailDomain: 'e2e.invalid',
    allowProduction: true,
    confirmedDomain: 'e2e.invalid',
  });
  assert.equal(guard.ok, true);
  assert.equal(guard.isProduction, true);
});

test('a missing disposable mail domain is refused even off production', () => {
  const guard = assertTargetAllowed({
    supabaseUrl: 'https://localtestref.supabase.co',
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

// --- report -------------------------------------------------------------

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? 'ok' : 'FAIL'} - ${r.name}${r.ok ? '' : `\n     ${r.error}`}`);
}
console.log(`\n${results.length - failed.length}/${results.length} health-deletion monitor tests passed.`);
process.exit(failed.length > 0 ? 1 : 0);

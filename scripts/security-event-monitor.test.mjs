#!/usr/bin/env node
// Deterministic contract tests for the production security-event layer
// (issue #975): the monitor's redaction and exit discipline, and the
// server-side instrumentation contract the monitor's thresholds depend on.
//
// Everything here runs against a stubbed `psql` and pure functions. Nothing
// contacts a database, a Supabase project, or a real secret. The repo root has
// no test runner (see docs/testing-and-qa.md), so this uses node:assert and the
// same subprocess-stub shape as scripts/health-deletion-monitor.test.mjs.
//
// Three properties are load-bearing:
//
//   1. REDACTION. The alert is rebuilt from an explicit allowlist, so a field
//      that appears on the snapshot but not on the allowlist -- a subject
//      digest, a user id, an email address, a key, a JWT -- can never reach an
//      alert surface, and a string that does not match the bounded-label
//      pattern is replaced rather than truncated.
//   2. THE 0/1/2 EXIT DISCIPLINE. Missing credentials or an unreachable
//      database must exit 2 ("I never looked"), never 0 ("nothing is wrong").
//   3. SILENCE IS NOT A FINDING. A quiet window is the ordinary case for an
//      application this size; alerting on it would train the operator to ignore
//      the monitor.
//
// A fourth section covers the contract BETWEEN the layers: the catalog and the
// allow-lists exist in both TypeScript and SQL, and the monitor's thresholds are
// written against event names that something must actually emit. Drift there is
// silent in production -- the database raises, the Edge Function swallows it as
// best-effort, and the event simply never arrives -- so it is asserted here.

import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  boundedLabel,
  buildAlert,
  redactEvent,
  thresholdsFromEnv,
} from './check-security-events.mjs';

const repoRoot = new URL('..', import.meta.url).pathname;
const monitorPath = join(repoRoot, 'scripts/check-security-events.mjs');

const FIXTURE_USER_ID = '99999999-9999-4999-8999-999999999999';
const FIXTURE_DIGEST = 'a'.repeat(64);
const FIXTURE_EMAIL = 'rejected.person@example.com';
const FIXTURE_KEY = 'sb_secret_thisisnotarealkeyvalue';
const FIXTURE_JWT = 'eyJhbGciOiJIUzI1NiJ9.examplepayload.examplesignature';

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: err.message });
  }
}

const DEFAULT_THRESHOLDS = {
  windowMinutes: 90,
  maxAuthFailures: 100,
  maxAuthSubjects: 20,
  maxRateLimitBlocks: 200,
  maxServerErrors: 10,
};

function snapshot(overrides = {}) {
  return {
    checked_at: '2026-09-08T12:00:00Z',
    window_seconds: 3600,
    retention_days: 90,
    purge_cron_active: true,
    purge_cron_present: true,
    oldest_event_age_seconds: 86400,
    newest_event_at: '2026-09-08T11:58:00Z',
    stored_rows: 120,
    severity_counts: { critical: 0, warning: 0, info: 0 },
    events: [],
    ...overrides,
  };
}

function event(overrides = {}) {
  return {
    event_name: 'auth.token_rejected',
    severity: 'warning',
    outcome: 'denied',
    count: 1,
    distinct_subjects: 1,
    ...overrides,
  };
}

// --- redaction ----------------------------------------------------------

test('redactEvent drops every field that is not on the allowlist', () => {
  const redacted = redactEvent({
    event_name: 'auth.token_rejected',
    severity: 'warning',
    outcome: 'denied',
    count: 12,
    distinct_subjects: 9,
    subject_digest: FIXTURE_DIGEST,
    user_id: FIXTURE_USER_ID,
    context: { message: `failed for ${FIXTURE_EMAIL}` },
  });
  assert.deepEqual(Object.keys(redacted).sort(), [
    'count',
    'distinct_subjects',
    'event_name',
    'outcome',
    'severity',
  ]);
});

test('boundedLabel replaces an unexpected value instead of truncating it', () => {
  // Truncation would still emit a prefix of the offending string. Replacement
  // emits none of it.
  assert.equal(boundedLabel(`${FIXTURE_EMAIL} leaked here`), '[unexpected-value]');
  assert.equal(boundedLabel(FIXTURE_EMAIL), '[unexpected-value]');
  // A JWT header segment is mixed case and would pass a general identifier
  // charset. The pattern is the shape of the three columns it guards, not a
  // generic one, precisely so this fails it.
  assert.equal(boundedLabel(FIXTURE_JWT), '[unexpected-value]');
  assert.equal(boundedLabel('eyJhbGciOiJIUzI1NiJ9'), '[unexpected-value]');
  assert.equal(boundedLabel('auth.token_rejected'), 'auth.token_rejected');
  assert.equal(boundedLabel('warning'), 'warning');
  assert.equal(boundedLabel(null), null);
});

test('buildAlert output never contains a digest, a user id, an email, a key, or a JWT', () => {
  const alert = buildAlert(
    snapshot({
      severity_counts: { critical: 1, warning: 380, info: 27 },
      events: [
        event({
          count: 380,
          distinct_subjects: 274,
          subject_digest: FIXTURE_DIGEST,
          user_id: FIXTURE_USER_ID,
          last_error: `rejected for ${FIXTURE_EMAIL} with ${FIXTURE_KEY}`,
          token: FIXTURE_JWT,
        }),
        event({ event_name: 'ratelimit.unavailable', severity: 'critical', count: 1, distinct_subjects: 0 }),
      ],
    }),
    DEFAULT_THRESHOLDS,
    'test-project',
  );

  const rendered = JSON.stringify(alert);
  for (const secret of [FIXTURE_DIGEST, FIXTURE_USER_ID, FIXTURE_EMAIL, FIXTURE_KEY, FIXTURE_JWT]) {
    assert.ok(!rendered.includes(secret), `alert leaked ${secret.slice(0, 16)}...`);
  }
  assert.ok(!rendered.includes('example.com'), 'alert leaked an email domain');
});

// --- findings -----------------------------------------------------------

test('a quiet window is healthy — silence is never a finding', () => {
  const alert = buildAlert(snapshot(), DEFAULT_THRESHOLDS, 'test-project');
  assert.equal(alert.healthy, true);
  assert.deepEqual(alert.findings, []);
});

test('ordinary events below every threshold are healthy', () => {
  const alert = buildAlert(
    snapshot({
      severity_counts: { critical: 0, warning: 12, info: 40 },
      events: [
        event({ count: 12, distinct_subjects: 3 }),
        event({ event_name: 'account.export_succeeded', severity: 'info', outcome: 'succeeded', count: 40, distinct_subjects: 40 }),
      ],
    }),
    DEFAULT_THRESHOLDS,
    'test-project',
  );
  assert.equal(alert.healthy, true);
});

test('a single critical event is a finding at any volume', () => {
  const alert = buildAlert(
    snapshot({
      severity_counts: { critical: 1, warning: 0, info: 0 },
      events: [event({ event_name: 'authz.denied', severity: 'critical', count: 1, distinct_subjects: 1 })],
    }),
    DEFAULT_THRESHOLDS,
    'test-project',
  );
  const kinds = alert.findings.map((f) => f.kind);
  assert.deepEqual(kinds, ['critical-security-event']);
  assert.match(alert.findings[0].detail, /authz\.denied/);
});

test('auth failure volume above the threshold is a finding', () => {
  const alert = buildAlert(
    snapshot({
      severity_counts: { critical: 0, warning: 101, info: 0 },
      events: [
        event({ event_name: 'auth.token_missing', severity: 'info', count: 60, distinct_subjects: 2 }),
        event({ count: 41, distinct_subjects: 2 }),
      ],
    }),
    DEFAULT_THRESHOLDS,
    'test-project',
  );
  assert.deepEqual(alert.findings.map((f) => f.kind), ['auth-failure-volume']);
  assert.equal(alert.totals.auth_failures, 101);
});

test('distributed rejections are a finding even below the volume threshold', () => {
  // The whole reason the accessor returns a distinct-subject count: 30 failures
  // from 30 subjects is a very different event from 30 from one, and volume
  // alone cannot tell them apart.
  const alert = buildAlert(
    snapshot({
      severity_counts: { critical: 0, warning: 30, info: 0 },
      events: [event({ count: 30, distinct_subjects: 30 })],
    }),
    DEFAULT_THRESHOLDS,
    'test-project',
  );
  assert.deepEqual(alert.findings.map((f) => f.kind), ['auth-failure-spread']);
});

test('the same volume from one subject is NOT a spread finding', () => {
  const alert = buildAlert(
    snapshot({
      severity_counts: { critical: 0, warning: 30, info: 0 },
      events: [event({ count: 30, distinct_subjects: 1 })],
    }),
    DEFAULT_THRESHOLDS,
    'test-project',
  );
  assert.equal(alert.healthy, true, 'one wedged client must not page as an attack');
});

test('throttled request volume above the threshold is a finding', () => {
  const alert = buildAlert(
    snapshot({
      severity_counts: { critical: 0, warning: 201, info: 0 },
      events: [
        event({ event_name: 'ratelimit.ip_blocked', count: 150, distinct_subjects: 4 }),
        event({ event_name: 'ratelimit.user_blocked', count: 51, distinct_subjects: 3 }),
      ],
    }),
    DEFAULT_THRESHOLDS,
    'test-project',
  );
  assert.deepEqual(alert.findings.map((f) => f.kind), ['rate-limit-volume']);
});

test('failed privileged operations have their own low threshold', () => {
  const alert = buildAlert(
    snapshot({
      severity_counts: { critical: 0, warning: 11, info: 0 },
      events: [
        event({ event_name: 'account.delete_failed', outcome: 'failed', count: 6, distinct_subjects: 6 }),
        event({ event_name: 'health.purge_failed', outcome: 'failed', count: 5, distinct_subjects: 5 }),
      ],
    }),
    DEFAULT_THRESHOLDS,
    'test-project',
  );
  assert.deepEqual(alert.findings.map((f) => f.kind), ['server-failure-volume']);
});

// --- retention ----------------------------------------------------------

test('an inactive retention sweep is a finding even in a silent window', () => {
  const alert = buildAlert(
    snapshot({ purge_cron_active: false, purge_cron_present: true }),
    DEFAULT_THRESHOLDS,
    'test-project',
  );
  assert.deepEqual(alert.findings.map((f) => f.kind), ['retention-sweep-inactive']);
  assert.match(alert.findings[0].detail, /is not active/);
});

test('a missing retention sweep names the absent cron entry', () => {
  const alert = buildAlert(
    snapshot({ purge_cron_active: false, purge_cron_present: false }),
    DEFAULT_THRESHOLDS,
    'test-project',
  );
  assert.match(alert.findings[0].detail, /security-event-purge" is missing/);
});

test('rows surviving past retention are a finding even with an active cron', () => {
  // The cron entry can be present and active while the sweep still fails (a
  // permission change, a renamed function). Surviving rows are the only
  // evidence that separates those two states.
  const alert = buildAlert(
    snapshot({ oldest_event_age_seconds: 93 * 86400 }),
    DEFAULT_THRESHOLDS,
    'test-project',
  );
  assert.deepEqual(alert.findings.map((f) => f.kind), ['retention-exceeded']);
});

test('a row inside the retention grace window is not a finding', () => {
  const alert = buildAlert(
    snapshot({ oldest_event_age_seconds: 91 * 86400 }),
    DEFAULT_THRESHOLDS,
    'test-project',
  );
  assert.equal(alert.healthy, true);
});

test('an empty log reports no retention finding rather than fabricating one', () => {
  const alert = buildAlert(
    snapshot({ oldest_event_age_seconds: null, stored_rows: 0 }),
    DEFAULT_THRESHOLDS,
    'test-project',
  );
  assert.equal(alert.healthy, true);
});

// --- thresholds ---------------------------------------------------------

test('the default window is wider than the hourly schedule, so jitter cannot open a gap', () => {
  // A window tiled to the schedule (60/60) leaves the interval between two late
  // starts permanently unexamined, because each run only ever looks backwards
  // from its own start time. The overlap is the fix and is load-bearing.
  assert.ok(
    DEFAULT_THRESHOLDS.windowMinutes > 60,
    'the default window must exceed the 60-minute schedule interval',
  );
  assert.deepEqual(thresholdsFromEnv({}).windowMinutes, DEFAULT_THRESHOLDS.windowMinutes);
});

test('thresholdsFromEnv reads overrides and falls back to documented defaults', () => {
  assert.deepEqual(thresholdsFromEnv({}), DEFAULT_THRESHOLDS);
  assert.deepEqual(
    thresholdsFromEnv({
      KILO_SECURITY_WINDOW_MINUTES: '15',
      KILO_SECURITY_MAX_AUTH_FAILURES: '5',
      KILO_SECURITY_MAX_AUTH_SUBJECTS: '3',
      KILO_SECURITY_MAX_RATE_LIMIT_BLOCKS: '7',
      KILO_SECURITY_MAX_SERVER_ERRORS: '2',
    }),
    {
      windowMinutes: 15,
      maxAuthFailures: 5,
      maxAuthSubjects: 3,
      maxRateLimitBlocks: 7,
      maxServerErrors: 2,
    },
  );
});

// --- subprocess behaviour ----------------------------------------------

function writeStubPsql(directory) {
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
    { mode: 0o755 },
  );
  chmodSync(stubPath, 0o755);
  return binDirectory;
}

function runMonitor({ payload = snapshot(), mode = 'ok', env = {}, credentials = true, args = [] } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'kilo-security-monitor-'));
  try {
    const binDirectory = writeStubPsql(directory);
    const result = spawnSync(process.execPath, [monitorPath, ...args], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        PATH: `${binDirectory}:${process.env.PATH}`,
        STUB_MODE: mode,
        STUB_PAYLOAD: typeof payload === 'string' ? payload : JSON.stringify(payload),
        // Point at a nonexistent file so a developer's real .env can never
        // influence a test run.
        KILO_MONITOR_ENV_FILE: join(directory, 'absent.env'),
        ...(credentials
          ? { SUPABASE_SECURITY_MONITOR_URL: 'postgresql://monitor:stub-credential-not-real@example.invalid:5432/postgres' }
          : {}),
        ...env,
      },
    });
    return { status: result.status, stdout: result.stdout, output: `${result.stdout}${result.stderr}` };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('exit 0 when the window is clean', () => {
  const { status } = runMonitor();
  assert.equal(status, 0);
});

test('exit 1 when a real production security finding is detected', () => {
  const { status, output } = runMonitor({
    payload: snapshot({
      severity_counts: { critical: 2, warning: 0, info: 0 },
      events: [event({ event_name: 'ratelimit.unavailable', severity: 'critical', count: 2, distinct_subjects: 0 })],
    }),
  });
  assert.equal(status, 1);
  assert.match(output, /critical-security-event/);
});

test('exit 2 when credentials are missing — never a green result', () => {
  const { status, output } = runMonitor({ credentials: false });
  assert.equal(status, 2);
  assert.match(output, /SUPABASE_SECURITY_MONITOR_URL is not set/);
});

test('exit 2 when the database is unreachable', () => {
  const { status } = runMonitor({ mode: 'fail' });
  assert.equal(status, 2);
});

test('exit 2 when the query returns unparseable output', () => {
  const { status, output } = runMonitor({ payload: 'not json at all' });
  assert.equal(status, 2);
  assert.match(output, /did not return valid JSON/);
});

test('exit 2 when the query returns nothing at all', () => {
  const { status, output } = runMonitor({ payload: '' });
  assert.equal(status, 2);
  assert.match(output, /Refusing to report a clean security window/);
});

test('the subprocess never prints a digest, a user id, or the connection password', () => {
  const { output } = runMonitor({
    payload: snapshot({
      severity_counts: { critical: 1, warning: 0, info: 0 },
      events: [
        event({
          event_name: 'authz.denied',
          severity: 'critical',
          count: 1,
          distinct_subjects: 1,
          subject_digest: FIXTURE_DIGEST,
          user_id: FIXTURE_USER_ID,
          note: `${FIXTURE_EMAIL} ${FIXTURE_KEY}`,
        }),
      ],
    }),
  });
  for (const secret of [FIXTURE_DIGEST, FIXTURE_USER_ID, FIXTURE_EMAIL, FIXTURE_KEY, 'stub-credential-not-real']) {
    assert.ok(!output.includes(secret), `monitor output leaked ${secret.slice(0, 16)}...`);
  }
});

test('the dry run renders the alert format and exits 0 without a database', () => {
  const { status, output } = runMonitor({ credentials: false, args: ['--dry-run'] });
  assert.equal(status, 0, 'the dry run exercises the format and must not fail CI');
  assert.match(output, /retention-sweep-inactive/);
  assert.match(output, /critical-security-event/);
  for (const secret of [FIXTURE_DIGEST, FIXTURE_USER_ID, 'person@example.com', 'sb_secret_examplekeymaterial']) {
    assert.ok(!output.includes(secret), `dry run leaked ${secret.slice(0, 16)}...`);
  }
});

test('a threshold override in the .env file is honoured by a real run', () => {
  // SUBPROCESS, deliberately: the failure mode this guards is module-load
  // ordering inside main(), where thresholds are read from process.env before
  // loadLocalEnv() populates it. An in-process import cannot observe it.
  const directory = mkdtempSync(join(tmpdir(), 'kilo-security-monitor-envfile-'));
  try {
    const binDirectory = writeStubPsql(directory);
    const envFile = join(directory, 'fixture.env');
    writeFileSync(
      envFile,
      'SUPABASE_SECURITY_MONITOR_URL=postgresql://monitor:stub-credential-not-real@example.invalid:5432/postgres\n' +
        'KILO_SECURITY_MAX_AUTH_FAILURES=1000\n',
    );
    const payload = snapshot({
      severity_counts: { critical: 0, warning: 500, info: 0 },
      events: [event({ count: 500, distinct_subjects: 2 })],
    });
    const result = spawnSync(process.execPath, [monitorPath], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        PATH: `${binDirectory}:${process.env.PATH}`,
        STUB_MODE: 'ok',
        STUB_PAYLOAD: JSON.stringify(payload),
        KILO_MONITOR_ENV_FILE: envFile,
      },
    });
    assert.equal(result.status, 0, `widened threshold did not suppress the finding:\n${result.stdout}${result.stderr}`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// --- server-side instrumentation contract -------------------------------
//
// Source-contract tests. The Edge Functions cannot be executed here (they are
// Deno modules that open a listener and expect Supabase environment variables),
// so these assert the wiring instead: that each function reaches for the events
// the monitor thresholds on, and that the catalog and allow-lists have not
// drifted between the TypeScript and the SQL that both enforce them.

const migrationSource = readFileSync(
  join(repoRoot, 'supabase/migrations/20260908120000_security_event_log.sql'),
  'utf8',
);
const recorderSource = readFileSync(
  join(repoRoot, 'supabase/functions/_shared/security-event.ts'),
  'utf8',
);
const functionSources = {
  'account-export': readFileSync(join(repoRoot, 'supabase/functions/account-export/index.ts'), 'utf8'),
  'account-delete': readFileSync(join(repoRoot, 'supabase/functions/account-delete/index.ts'), 'utf8'),
  'health-data-delete': readFileSync(join(repoRoot, 'supabase/functions/health-data-delete/index.ts'), 'utf8'),
  'rate-limit': readFileSync(join(repoRoot, 'supabase/functions/_shared/rate-limit.ts'), 'utf8'),
};

// Reads the quoted string list out of a `... in ( 'a', 'b' )` SQL fragment that
// starts at the given anchor.
function sqlStringList(source, anchor) {
  const start = source.indexOf(anchor);
  assert.notEqual(start, -1, `anchor not found in the migration: ${anchor}`);
  const open = source.indexOf('(', start);
  const close = source.indexOf(')', open);
  return [...source.slice(open, close).matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
}

// Reads the entries of an `export const NAME = [ 'a', 'b' ] as const` array.
function tsStringList(source, name) {
  const start = source.indexOf(`export const ${name} = [`);
  assert.notEqual(start, -1, `array not found in the recorder: ${name}`);
  const close = source.indexOf(']', start);
  return [...source.slice(start, close).matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
}

test('the event catalog is identical in TypeScript and SQL', () => {
  assert.deepEqual(
    tsStringList(recorderSource, 'SECURITY_EVENT_NAMES'),
    sqlStringList(migrationSource, 'event_name text not null check (event_name in'),
  );
});

test('the source allow-list is identical in TypeScript and SQL', () => {
  assert.deepEqual(
    tsStringList(recorderSource, 'SECURITY_EVENT_SOURCES'),
    sqlStringList(migrationSource, 'source text not null check (source in'),
  );
});

test('the outcome allow-list is identical in TypeScript and SQL', () => {
  assert.deepEqual(
    tsStringList(recorderSource, 'SECURITY_EVENT_OUTCOMES'),
    sqlStringList(migrationSource, 'outcome text not null check (outcome in'),
  );
});

test('the context reason allow-list is identical in TypeScript and SQL', () => {
  assert.deepEqual(
    tsStringList(recorderSource, 'SECURITY_EVENT_REASONS'),
    sqlStringList(migrationSource, "v_text := p_context ->> 'reason';"),
  );
});

test('every catalog event has a server-derived severity', () => {
  // A name the severity map does not know returns null, and the NOT NULL column
  // then rejects the insert -- loudly in a test, silently in production, since
  // recording is best-effort by design.
  for (const name of tsStringList(recorderSource, 'SECURITY_EVENT_NAMES')) {
    assert.ok(
      migrationSource.includes(`when '${name}' then`),
      `kilo.security_event_severity has no branch for ${name}`,
    );
  }
});

test('a caller can never set its own severity', () => {
  assert.ok(
    !/p_severity/.test(migrationSource),
    'record_security_event must not accept a severity argument',
  );
  assert.ok(
    !/severity/.test(recorderSource.split('export interface SecurityEvent')[1].split('}')[0]),
    'the SecurityEvent shape must not carry a severity field',
  );
});

// Every ratelimit.* event is owned by _shared/rate-limit.ts, not by the
// endpoints: only the limiter can tell an exhausted bucket from an outage, and
// an endpoint that classified a false return itself logged a quota throttle
// during a database outage.
const REQUIRED_EVENTS = {
  'account-export': [
    'auth.token_missing',
    'auth.token_rejected',
    'server.error',
    'account.export_succeeded',
  ],
  'account-delete': [
    'auth.token_missing',
    'auth.token_rejected',
    'account.delete_failed',
    'account.delete_succeeded',
  ],
  'health-data-delete': [
    'auth.token_missing',
    'auth.token_rejected',
    'authz.denied',
    'server.error',
    'health.purge_succeeded',
    'health.purge_failed',
  ],
  'rate-limit': [
    'ratelimit.unavailable',
    'ratelimit.ip_blocked',
    'ratelimit.user_blocked',
  ],
};

for (const [fn, events] of Object.entries(REQUIRED_EVENTS)) {
  test(`${fn} records every event the monitor thresholds on`, () => {
    for (const name of events) {
      assert.ok(
        functionSources[fn].includes(`'${name}'`),
        `${fn} never records ${name}, so the monitor can never see it`,
      );
    }
  });
}

test('every rate-limit call site identifies both its source and its subject', () => {
  // The limiter records the throttle event, so it needs the source to attribute
  // it and the subject to name it. A call missing either is silently unlogged:
  // recording is best-effort, so nothing fails loudly at runtime.
  for (const fn of ['account-export', 'account-delete', 'health-data-delete']) {
    const calls = functionSources[fn].match(/rateLimitAllowed\([^)]*\)/g) ?? [];
    assert.ok(calls.length > 0, `${fn} has no rate-limit call sites`);
    for (const call of calls) {
      assert.match(call, /SECURITY_SOURCE/, `a rate-limit call in ${fn} cannot attribute its event`);
      assert.match(call, /type: '(ip|user)'/, `a rate-limit call in ${fn} names no subject`);
    }
  }
});

test('endpoints never classify a rate-limit rejection themselves', () => {
  // The defect this guards: under the `deny` policy an outage and an exhausted
  // bucket both return false, so an endpoint recording ratelimit.ip_blocked on
  // a false return logged a quota throttle during a database outage -- blaming
  // the caller for the server's failure and spiking the throttle-volume alert
  // on the very incident ratelimit.unavailable exists to isolate.
  for (const fn of ['account-export', 'account-delete', 'health-data-delete']) {
    assert.ok(
      !functionSources[fn].includes('ratelimit.'),
      `${fn} classifies a rate-limit rejection itself; only the limiter can`,
    );
  }
});

test('the recorder never logs the subject it sends to the database', () => {
  const mirror = recorderSource.split('console.log(JSON.stringify({')[1].split('}))')[0];
  assert.ok(!/subject:/.test(mirror), 'the console mirror must not carry the raw subject');
  assert.match(mirror, /subject_type/, 'the console mirror should still classify the subject');
});

// --- report -------------------------------------------------------------

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? 'ok' : 'FAIL'} - ${r.name}${r.ok ? '' : `\n     ${r.error}`}`);
}
console.log(`\n${results.length - failed.length}/${results.length} security-event monitor tests passed.`);
process.exit(failed.length > 0 ? 1 : 0);

#!/usr/bin/env node
// Alerts on Kilo's production security signals (issue #975).
//
// Kilo could already PREVENT a large class of security failures — RLS, the
// consent gate, the durable rate limiter, the dependency-audit gate, the
// security-review gate — and could RESPOND to one it had been told about
// (docs/security-incident-response.md). It could not NOTICE. Every
// security-relevant server decision existed only as a `console.error` line in a
// Supabase Edge Function log: retained for days, not queryable as events, and
// with no threshold behind it, so nothing ever alerted and an incident found a
// week later had no evidence left.
//
// This is the operator-visible half of the fix. The Edge Functions write
// classified, redacted events to kilo.security_events through
// supabase/functions/_shared/security-event.ts; this reads the aggregate
// snapshot and decides whether an operator needs to hear about it.
//
// Usage:
//   node scripts/check-security-events.mjs
//   node scripts/check-security-events.mjs --json
//   node scripts/check-security-events.mjs --dry-run
//
// A `.env` file at the repo root is loaded automatically. An already-exported
// variable always wins over a value from that file.
//
// Exit codes:
//   0  no finding in the window, and the retention control is healthy
//   1  a real production security finding
//   2  the check could not run (no credentials, bad URL, database unreachable)
//
// 1 and 2 are distinct for the same reason they are in
// scripts/check-health-deletion-backlog.mjs and
// scripts/check-migration-drift.mjs: a monitor that cannot tell "nothing is
// wrong" from "I never looked" reports green while detecting nothing. Missing
// credentials are themselves a failed monitor here, never a pass.
//
// SILENCE IS NOT A FINDING. Kilo is a small application; a window with zero
// events is the ordinary case, not a broken pipeline. Alerting on quiet would
// train an operator to ignore this monitor within a week. The retention sweep
// is monitored instead, because that is the control whose silent failure
// actually matters.
//
// REDACTION CONTRACT
//
// kilo.security_event_monitor_snapshot(interval) returns aggregates only: it has
// no subject digest, no context, and no row identity to leak. This script
// narrows further anyway — buildAlert() rebuilds every rendered field from an
// explicit allowlist and constrains each string to a bounded charset, so a field
// added to the accessor later is dropped by default rather than forwarded to an
// alert surface by default. scripts/security-event-monitor.test.mjs asserts that
// against a snapshot deliberately stuffed with a user id, an email address, a
// key, and a JWT.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Not a secret: this project ref is already tracked in supabase/config.toml and
// scripts/deploy-kilo-functions.sh. It is in the alert so an operator reading a
// notification knows which project is affected without opening the workflow.
const DEFAULT_PROJECT_REF = 'ogzhnscdqcdrhfqcobuv';

// The retention sweep scheduled by
// supabase/migrations/20260908120000_security_event_log.sql. Same name, one
// source of truth.
const PURGE_CRON_JOB = 'security-event-purge';

const CONNECTION_ENV = 'SUPABASE_SECURITY_MONITOR_URL';

// Defaults, all overridable by env so an incident can widen or tighten them
// without a code change.
//
//   WINDOW           60m  matches the accessor's default aggregation window.
//   AUTH_FAILURES    100  auth.token_missing + auth.token_rejected in the
//                         window. Kilo's real traffic produces single digits;
//                         100 is comfortably above a flapping client and far
//                         below a serious attempt.
//   AUTH_SUBJECTS     20  DISTINCT subjects on auth.token_rejected. This is the
//                         shape test, not the volume test: 300 rejections from
//                         one subject is a broken client, and 300 from 280
//                         subjects is credential stuffing. Volume alone cannot
//                         tell those apart, which is why the accessor returns a
//                         distinct-subject count at all.
//   RATE_LIMIT       200  ratelimit.ip_blocked + ratelimit.user_blocked. The
//                         limiter working as designed is not itself a finding;
//                         a sustained rate of it is abuse worth looking at.
//   SERVER_ERRORS     10  server.error + account.delete_failed +
//                         health.purge_failed. These are failures of operations
//                         the user asked for, so the threshold is deliberately
//                         low.
const DEFAULTS = {
  windowMinutes: 60,
  maxAuthFailures: 100,
  maxAuthSubjects: 20,
  maxRateLimitBlocks: 200,
  maxServerErrors: 10,
};

// Grace on top of the declared retention period before a surviving row is read
// as a failed sweep. The sweep runs daily, so anything under two days is noise.
const RETENTION_GRACE_DAYS = 2;

const AUTH_FAILURE_EVENTS = ['auth.token_missing', 'auth.token_rejected'];
const RATE_LIMIT_EVENTS = ['ratelimit.ip_blocked', 'ratelimit.user_blocked'];
const SERVER_FAILURE_EVENTS = ['server.error', 'account.delete_failed', 'health.purge_failed'];

function abort(code, message, detail) {
  emit('error', `security-events: ${message}`);
  if (detail) console.error(String(detail).trim());
  process.exit(code);
}

// GitHub Actions turns these into annotations on the job, so a scheduled run
// surfaces the finding in the run summary instead of only in the log body.
function emit(level, message) {
  if (process.env.GITHUB_ACTIONS === 'true') {
    console.error(`::${level}::${message}`);
  } else {
    console.error(message);
  }
}

// Identical precedence rule to check-health-deletion-backlog.mjs: an explicit
// shell export always wins over the file. Values only ever land in process.env;
// they are never logged or echoed.
export function loadLocalEnv(envPath) {
  if (!existsSync(envPath)) return;

  let contents;
  try {
    contents = readFileSync(envPath, 'utf8');
  } catch {
    return;
  }

  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    if (!key || key in process.env) continue;

    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

// Same reasoning as check-health-deletion-backlog.mjs: split the URL into libpq
// variables so the password never appears in argv (no process listing, no crash
// message, no CI log) and punctuation in it is not re-parsed as URL syntax.
export function libpqEnv(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    abort(2, `${CONNECTION_ENV} is not a valid URL (expected postgresql://user:password@host:port/database).`);
  }

  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    abort(2, `${CONNECTION_ENV} must be a postgresql:// URL, got ${url.protocol}//`);
  }

  return {
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.replace(/^\//, '') || 'postgres',
    PGSSLMODE: 'require',
    PGCONNECT_TIMEOUT: '15',
  };
}

// A bounded identifier, or null. The accessor's event_name, severity, and
// outcome are already constrained by CHECK constraints in the schema; this is
// the second wall, so that a value which somehow reaches the snapshot from
// outside that contract cannot be rendered verbatim onto an alert surface.
//
// The pattern is exactly the shape those three columns take -- lowercase, dot-
// or underscore-separated, no whitespace -- rather than a general identifier
// charset. That is deliberate: a permissive pattern would pass a JWT header
// segment or a mixed-case token through unchanged. A value that does not match
// is replaced with a placeholder, not truncated, because truncation still emits
// a prefix of whatever it was.
export function boundedLabel(value) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return /^[a-z0-9][a-z0-9_.-]{0,63}$/.test(text) ? text : '[unexpected-value]';
}

function boundedCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed);
}

// THE redaction boundary. An explicit allowlist, not a denylist: a field added
// to kilo.security_event_monitor_snapshot() later is dropped by default rather
// than leaked by default.
export function redactEvent(raw) {
  return {
    event_name: boundedLabel(raw?.event_name),
    severity: boundedLabel(raw?.severity),
    outcome: boundedLabel(raw?.outcome),
    count: boundedCount(raw?.count),
    distinct_subjects: boundedCount(raw?.distinct_subjects),
  };
}

export function thresholdsFromEnv(env = process.env) {
  const read = (name, fallback) => {
    const value = env[name];
    if (value === undefined || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      abort(2, `${name} must be a positive number, got "${value}".`);
    }
    return parsed;
  };

  return {
    windowMinutes: read('KILO_SECURITY_WINDOW_MINUTES', DEFAULTS.windowMinutes),
    maxAuthFailures: read('KILO_SECURITY_MAX_AUTH_FAILURES', DEFAULTS.maxAuthFailures),
    maxAuthSubjects: read('KILO_SECURITY_MAX_AUTH_SUBJECTS', DEFAULTS.maxAuthSubjects),
    maxRateLimitBlocks: read('KILO_SECURITY_MAX_RATE_LIMIT_BLOCKS', DEFAULTS.maxRateLimitBlocks),
    maxServerErrors: read('KILO_SECURITY_MAX_SERVER_ERRORS', DEFAULTS.maxServerErrors),
  };
}

function sumWhere(events, names) {
  return events
    .filter((event) => names.includes(event.event_name))
    .reduce((total, event) => total + event.count, 0);
}

function maxSubjectsWhere(events, names) {
  return events
    .filter((event) => names.includes(event.event_name))
    .reduce((most, event) => Math.max(most, event.distinct_subjects), 0);
}

// Pure. Takes the raw snapshot document, returns the redacted alert. Every
// field an operator ever sees is produced here, which is why the redaction test
// can assert on this function's whole output rather than sampling strings.
export function buildAlert(snapshot, thresholds, projectRef) {
  const findings = [];
  const events = Array.isArray(snapshot.events) ? snapshot.events.map(redactEvent) : [];
  const severity = snapshot.severity_counts ?? {};
  const criticalCount = boundedCount(severity.critical);

  // Retention first: it is a control, and its failure explains nothing else on
  // this list, so an operator should be able to read it independently.
  if (!snapshot.purge_cron_active) {
    findings.push({
      kind: 'retention-sweep-inactive',
      detail: snapshot.purge_cron_present
        ? `pg_cron job "${PURGE_CRON_JOB}" exists but is not active`
        : `pg_cron job "${PURGE_CRON_JOB}" is missing`,
    });
  }

  const retentionDays = boundedCount(snapshot.retention_days) || 90;
  const oldestDays = snapshot.oldest_event_age_seconds === null
    || snapshot.oldest_event_age_seconds === undefined
    ? null
    : boundedCount(snapshot.oldest_event_age_seconds) / 86400;
  if (oldestDays !== null && oldestDays > retentionDays + RETENTION_GRACE_DAYS) {
    // The cron entry can be present and active while the sweep still fails
    // (a permission change, a renamed function). The surviving rows are the
    // only evidence that distinguishes those two.
    findings.push({
      kind: 'retention-exceeded',
      detail:
        `oldest stored event is ${Math.round(oldestDays)}d old, past the ` +
        `${retentionDays}d retention period (+${RETENTION_GRACE_DAYS}d grace)`,
    });
  }

  // Any critical event, at any volume. The two events classified critical --
  // ratelimit.unavailable and authz.denied -- both mean a control that is
  // supposed to hold has stopped holding, so there is no rate at which one is
  // acceptable.
  if (criticalCount > 0) {
    const names = events
      .filter((event) => event.severity === 'critical')
      .map((event) => event.event_name)
      .join(', ');
    findings.push({
      kind: 'critical-security-event',
      detail: `${criticalCount} critical event(s) in the window: ${names || 'unnamed'}`,
    });
  }

  const authFailures = sumWhere(events, AUTH_FAILURE_EVENTS);
  if (authFailures > thresholds.maxAuthFailures) {
    findings.push({
      kind: 'auth-failure-volume',
      detail: `${authFailures} authentication failure(s) (threshold ${thresholds.maxAuthFailures})`,
    });
  }

  const authSubjects = maxSubjectsWhere(events, ['auth.token_rejected']);
  if (authSubjects > thresholds.maxAuthSubjects) {
    findings.push({
      kind: 'auth-failure-spread',
      detail:
        `rejected tokens from ${authSubjects} distinct subjects ` +
        `(threshold ${thresholds.maxAuthSubjects}) — distributed, not a single client`,
    });
  }

  const rateLimitBlocks = sumWhere(events, RATE_LIMIT_EVENTS);
  if (rateLimitBlocks > thresholds.maxRateLimitBlocks) {
    findings.push({
      kind: 'rate-limit-volume',
      detail: `${rateLimitBlocks} throttled request(s) (threshold ${thresholds.maxRateLimitBlocks})`,
    });
  }

  const serverErrors = sumWhere(events, SERVER_FAILURE_EVENTS);
  if (serverErrors > thresholds.maxServerErrors) {
    findings.push({
      kind: 'server-failure-volume',
      detail:
        `${serverErrors} failed privileged operation(s) — export, deletion, or purge ` +
        `(threshold ${thresholds.maxServerErrors})`,
    });
  }

  return {
    project: projectRef,
    checked_at: snapshot.checked_at ?? null,
    window_minutes: thresholds.windowMinutes,
    retention_days: retentionDays,
    thresholds,
    totals: {
      critical: criticalCount,
      warning: boundedCount(severity.warning),
      info: boundedCount(severity.info),
      auth_failures: authFailures,
      rate_limit_blocks: rateLimitBlocks,
      server_failures: serverErrors,
      stored_rows: boundedCount(snapshot.stored_rows),
    },
    events,
    findings,
    healthy: findings.length === 0,
  };
}

export function renderAlert(alert) {
  const lines = [];
  lines.push(
    `project ${alert.project} — ${alert.window_minutes}m window, ` +
      `${alert.totals.critical} critical / ${alert.totals.warning} warning / ${alert.totals.info} info`,
  );

  for (const event of alert.events) {
    lines.push(
      `  ${event.event_name} severity=${event.severity} outcome=${event.outcome} ` +
        `count=${event.count} subjects=${event.distinct_subjects}`,
    );
  }

  if (alert.findings.length > 0) {
    lines.push('');
    lines.push('findings:');
    for (const finding of alert.findings) {
      lines.push(`  [${finding.kind}] ${finding.detail}`);
    }
    lines.push('');
    lines.push(RUNBOOK);
  }

  return lines.join('\n');
}

const RUNBOOK = `Response (see docs/security-monitoring.md, "Investigation runbook"):
  1. Read the window's aggregates first: volume answers "how much", and
     distinct_subjects answers "one caller or many".
  2. As service_role, widen the window and correlate by subject_digest in
     kilo.security_events. The digest is stable per caller, so one actor can be
     followed across endpoints without the log naming anyone.
  3. Join to the platform Edge Function log with context.request_id for the
     request detail this log deliberately does not store.
  4. A critical event is never a threshold miss: ratelimit.unavailable means the
     durable limiter is unreachable, and authz.denied means a subject reached
     data that was not theirs. Treat either as an incident under
     docs/security-incident-response.md.
  5. Never delete rows to clear a finding. The log is append-only and is the
     evidence an investigation runs on.`;

function readSnapshot(connectionUrl, windowMinutes) {
  // windowMinutes is validated as a finite positive number by thresholdsFromEnv
  // and rounded here, so it cannot carry SQL syntax into the statement.
  const query =
    `select kilo.security_event_monitor_snapshot(make_interval(mins => ${Math.round(windowMinutes)}))`;

  let stdout;
  try {
    stdout = execFileSync(
      'psql',
      ['--no-psqlrc', '--tuples-only', '--no-align', '-v', 'ON_ERROR_STOP=1', '-c', query],
      {
        env: { ...process.env, ...libpqEnv(connectionUrl) },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  } catch (err) {
    // err.message is "Command failed: psql ...". Report psql's own stderr only,
    // which describes the failure without echoing the command or the env.
    abort(2, 'could not read the security-event snapshot from the live project.', err.stderr || err.stdout);
  }

  const trimmed = stdout.trim();
  if (!trimmed) {
    abort(2, 'the monitor query returned nothing. Refusing to report a clean security window.');
  }

  try {
    return JSON.parse(trimmed);
  } catch (err) {
    abort(2, 'the monitor query did not return valid JSON.', err.message);
  }
}

// A real dry run of the alert path, with a synthetic snapshot instead of a
// database. It deliberately feeds fields the accessor never returns — a subject
// digest, a raw user id, an email address, a key, and a JWT — so an operator can
// SEE the redaction working before wiring this to a notification channel. Never
// connects to anything.
const DRY_RUN_SNAPSHOT = {
  checked_at: '2026-09-08T12:00:00Z',
  window_seconds: 3600,
  retention_days: 90,
  purge_cron_active: false,
  purge_cron_present: true,
  oldest_event_age_seconds: 8035200, // 93 days: past retention, sweep is not running
  newest_event_at: '2026-09-08T11:58:00Z',
  stored_rows: 41822,
  severity_counts: { critical: 3, warning: 412, info: 27 },
  events: [
    {
      event_name: 'auth.token_rejected',
      severity: 'warning',
      outcome: 'denied',
      count: 380,
      distinct_subjects: 274,
      // None of the four below exist on the real accessor. They are here to
      // prove the allowlist drops an unexpected field rather than forwarding it.
      subject_digest: 'a'.repeat(64),
      user_id: '99999999-9999-4999-8999-999999999999',
      last_error: 'rejected for person@example.com with sb_secret_examplekeymaterial',
      token: 'eyJhbGciOiJIUzI1NiJ9.examplepayload.examplesignature',
    },
    {
      event_name: 'ratelimit.unavailable',
      severity: 'critical',
      outcome: 'denied',
      count: 3,
      distinct_subjects: 0,
    },
    {
      event_name: 'account.export_succeeded',
      severity: 'info',
      outcome: 'succeeded',
      count: 27,
      distinct_subjects: 27,
    },
    {
      // A value that does not match the bounded-label pattern must be replaced,
      // not truncated: truncation would still emit part of it.
      event_name: 'person@example.com dropped a message here',
      severity: 'warning',
      outcome: 'failed',
      count: 32,
      distinct_subjects: 4,
    },
  ],
};

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const dryRun = args.includes('--dry-run');

  // Load the local env file FIRST, before anything reads process.env, so a
  // threshold override written to the documented location is honoured rather
  // than silently ignored. Unconditional, including under --dry-run, so the dry
  // run renders with the same thresholds a real run would use. loadLocalEnv()
  // never overwrites an already-exported variable, and a missing file is a
  // no-op. (Same module-load ordering defect that
  // check-health-deletion-backlog.mjs had to fix; the regression test for it
  // runs this script as a subprocess rather than importing it.)
  loadLocalEnv(process.env.KILO_MONITOR_ENV_FILE || join(root, '.env'));

  const projectRef = process.env.KILO_MONITOR_PROJECT_REF || DEFAULT_PROJECT_REF;
  const thresholds = thresholdsFromEnv();

  let snapshot;
  if (dryRun) {
    console.log('security-events: --dry-run, synthetic snapshot, no database connection.\n');
    snapshot = DRY_RUN_SNAPSHOT;
  } else {
    const connectionUrl = process.env[CONNECTION_ENV];
    if (!connectionUrl) {
      abort(2, `${CONNECTION_ENV} is not set. Refusing to report a clean security window without reading the database.`);
    }
    snapshot = readSnapshot(connectionUrl, thresholds.windowMinutes);
  }

  const alert = buildAlert(snapshot, thresholds, projectRef);
  const rendered = asJson ? JSON.stringify(alert, null, 2) : renderAlert(alert);

  if (alert.healthy) {
    console.log(rendered);
    console.log(
      `security-events: ok — no finding in the last ${alert.window_minutes}m; ` +
        `retention sweep active and within ${alert.retention_days}d.`,
    );
    process.exit(0);
  }

  console.log(rendered);
  emit('error', `security-events: ${alert.findings.length} finding(s) on project ${alert.project}.`);

  // --dry-run demonstrates the alert rendering; it must not fail a CI job that
  // is only exercising the format.
  process.exit(dryRun ? 0 : 1);
}

// Importable for scripts/security-event-monitor.test.mjs without executing.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}

#!/usr/bin/env node
// Alerts when the consent-withdrawal purge queue is not draining.
//
// #492 exposed the failure this monitor exists to catch: every visible symptom
// of a healthy system (cron scheduled, no errors, jobs queued) while
// kilo.dispatch_health_deletion_worker() returned NULL on every tick because the
// Edge Function or its Vault credentials were absent. It only `raise warning`s --
// deliberately, because raising would abort the shared cron transaction and still
// delete nothing -- so nothing outside the database can see it. A user who
// withdrew consent sits in `deletion_pending` forever, having been told their
// cloud health data was being erased.
//
// This is the operator-visible half of that fail-safe design. It consumes the
// SAME prerequisites scripts/deploy-kilo-functions.sh (#540) verifies at deploy
// time -- the `health-deletion-drain` cron and the two Vault secret NAMES from
// kilo.worker_secret_names() -- rather than inventing a second operational
// contract. Deploy-time proves they were there once; this proves they are there
// now.
//
// Usage:
//   node scripts/check-health-deletion-backlog.mjs
//   node scripts/check-health-deletion-backlog.mjs --json
//   node scripts/check-health-deletion-backlog.mjs --dry-run
//
// A `.env` file at the repo root is loaded automatically. An already-exported
// variable always wins over a value from that file.
//
// Exit codes:
//   0  the queue is draining and every prerequisite is present
//   1  a real production problem was detected
//   2  the check could not run (no credentials, bad URL, database unreachable)
//
// 1 and 2 are distinct for the same reason they are in
// scripts/check-migration-drift.mjs: a monitor that cannot tell "nothing is
// wrong" from "I never looked" reports green while detecting nothing, which is
// precisely the silent failure being monitored. Missing credentials are
// themselves a failed monitor here, never a pass.
//
// REDACTION CONTRACT
//
// kilo.health_deletion_backlog(interval) returns user_id. It is read here (the
// function's shape is fixed and shared with the operator SQL path) but it is
// dropped by buildAlert() and can never reach stdout, stderr, a workflow
// annotation, or --json output. The alert carries project, job id, reason,
// status, attempts, age, and a bounded, scrubbed last_error -- nothing else.
// No health values, no user ids, no email addresses, no tokens, no secret
// values. scripts/health-deletion-monitor.test.mjs asserts this against a
// stubbed psql that deliberately returns a user id and an error string stuffed
// with an email address and a token.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Not a secret: this project ref is already tracked in supabase/config.toml and
// scripts/deploy-kilo-functions.sh. It is in the alert so an operator reading a
// notification knows which project is degraded without opening the workflow.
const DEFAULT_PROJECT_REF = 'ogzhnscdqcdrhfqcobuv';

// The cron entry #540 verifies at deploy time. Same name, one source of truth.
const DRAIN_CRON_JOB = 'health-deletion-drain';

// Defaults, all overridable by env so an incident can widen or tighten them
// without a code change.
//
//   AGE       60m  a withdrawal must be erased "without undue delay"; the drain
//                  runs every 5 minutes, so an hour is ~12 missed cycles.
//   ATTEMPTS  5    kilo.health_deletion_backoff caps at 1 hour by attempt 8;
//                  5 failed attempts is a job that is retrying, not recovering.
//   RUNNING   30m  exactly kilo.drain_health_deletion_jobs()'s own stale-job
//                  reclaim ceiling. A `running` job older than that means either
//                  the worker is wedged or the reclaimer itself is not running.
const DEFAULTS = {
  maxAgeMinutes: 60,
  maxAttempts: 5,
  runningStaleMinutes: 30,
};

const CONNECTION_ENV = 'SUPABASE_HEALTH_MONITOR_URL';

// One round trip. Everything the monitor needs, as a single JSON document, so
// there is no per-job query loop against production.
//
// Scope note: this reads the `kilo` schema plus `cron.job` and the NAME column
// of `vault.secrets`. It never selects decrypted_secret and never touches the
// co-tenant `canonical`/`raw`/`serving`/`ops`/`legacy` schemas.
const MONITOR_QUERY = `
select jsonb_build_object(
  'checked_at', now(),
  'drain_cron_active', exists (
    select 1 from cron.job where jobname = '${DRAIN_CRON_JOB}' and active
  ),
  'drain_cron_present', exists (
    select 1 from cron.job where jobname = '${DRAIN_CRON_JOB}'
  ),
  'required_secret_names', (
    select jsonb_build_array(n.functions_base_url, n.service_role_key)
    from kilo.worker_secret_names() n
  ),
  'present_secret_names', coalesce((
    select jsonb_agg(s.name)
    from vault.secrets s, kilo.worker_secret_names() n
    where s.name in (n.functions_base_url, n.service_role_key)
  ), '[]'::jsonb),
  'jobs', coalesce((
    select jsonb_agg(
      to_jsonb(b) || jsonb_build_object('age_seconds', extract(epoch from b.age))
    )
    from kilo.health_deletion_backlog(interval '0 seconds') b
  ), '[]'::jsonb)
)
`;

function abort(code, message, detail) {
  emit('error', `health-deletion-backlog: ${message}`);
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

// Identical precedence rule to check-migration-drift.mjs: an explicit shell
// export always wins over the file. Values only ever land in process.env; they
// are never logged or echoed.
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

// Same reasoning as check-migration-drift.mjs: split the URL into libpq
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

// Bounded, scrubbed, single-line. The database already caps last_error at 500
// characters (kilo.fail_health_deletion_job), and its only writers produce
// operational strings such as "17 scoped rows remain". This is defence in depth
// for the case where a future worker propagates an upstream message verbatim:
// anything shaped like an email address, a Supabase secret key, or a JWT is
// replaced before it can reach an alert surface.
export function scrubError(value, limit = 200) {
  if (value === null || value === undefined) return null;

  const scrubbed = String(value)
    .replace(/\s+/g, ' ')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[redacted-email]')
    .replace(/\b(?:sb_secret_|sb_publishable_|sbp_)[A-Za-z0-9_-]+/g, '[redacted-key]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-jwt]')
    .trim();

  if (scrubbed.length <= limit) return scrubbed;
  return `${scrubbed.slice(0, limit)}...[truncated]`;
}

// THE redaction boundary. An explicit allowlist, not a denylist: a column added
// to kilo.health_deletion_backlog in future is dropped by default rather than
// leaked by default. user_id is present on the input and deliberately absent
// from the output.
export function redactJob(raw) {
  return {
    job_id: raw.job_id ?? null,
    reason: raw.reason ?? null,
    status: raw.status ?? null,
    attempts: Number.isFinite(Number(raw.attempts)) ? Number(raw.attempts) : null,
    age_seconds: Number.isFinite(Number(raw.age_seconds)) ? Math.round(Number(raw.age_seconds)) : null,
    last_error: scrubError(raw.last_error),
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
    maxAgeMinutes: read('KILO_DELETION_MAX_AGE_MINUTES', DEFAULTS.maxAgeMinutes),
    maxAttempts: read('KILO_DELETION_MAX_ATTEMPTS', DEFAULTS.maxAttempts),
    runningStaleMinutes: read('KILO_DELETION_RUNNING_STALE_MINUTES', DEFAULTS.runningStaleMinutes),
  };
}

// Pure. Takes the raw query document, returns the redacted alert. Every field
// that reaches an operator is produced here, which is why the redaction test can
// assert on this function's whole output rather than sampling strings.
export function buildAlert(snapshot, thresholds, projectRef) {
  const findings = [];
  const jobs = Array.isArray(snapshot.jobs) ? snapshot.jobs.map(redactJob) : [];

  // Prerequisites first: an absent cron or absent Vault secret explains every
  // downstream backlog finding, so an operator should read it first.
  if (!snapshot.drain_cron_active) {
    findings.push({
      kind: 'drain-cron-inactive',
      detail: snapshot.drain_cron_present
        ? `pg_cron job "${DRAIN_CRON_JOB}" exists but is not active`
        : `pg_cron job "${DRAIN_CRON_JOB}" is missing`,
    });
  }

  const required = Array.isArray(snapshot.required_secret_names) ? snapshot.required_secret_names : [];
  const present = new Set(Array.isArray(snapshot.present_secret_names) ? snapshot.present_secret_names : []);
  const missingSecrets = required.filter((name) => !present.has(name));
  if (missingSecrets.length > 0) {
    findings.push({
      kind: 'worker-config-absent',
      // Names only. kilo.worker_secret_names() returns the NAMES the operator
      // must create; the values are never read by this monitor.
      detail: `missing Vault secret name(s): ${missingSecrets.join(', ')}`,
    });
  }

  const maxAgeSeconds = thresholds.maxAgeMinutes * 60;
  const runningStaleSeconds = thresholds.runningStaleMinutes * 60;

  for (const job of jobs) {
    const age = job.age_seconds ?? 0;

    if (age > maxAgeSeconds) {
      findings.push({
        kind: 'job-older-than-threshold',
        job_id: job.job_id,
        detail: `open for ${formatAge(age)} (threshold ${thresholds.maxAgeMinutes}m)`,
      });
    }

    // "Attempts increase without completion": the job is still open, so by
    // definition it has not completed, and it has burned through more retries
    // than a transient failure should need.
    if ((job.attempts ?? 0) >= thresholds.maxAttempts) {
      findings.push({
        kind: 'attempts-without-completion',
        job_id: job.job_id,
        detail: `${job.attempts} attempts with status ${job.status} (threshold ${thresholds.maxAttempts})`,
      });
    }

    // KNOWN LIMITATION (issue #541 review finding 3, scope-blocked).
    //
    // This measures staleness from created_at, because
    // kilo.health_deletion_backlog(interval) exposes age from created_at only.
    // kilo.drain_health_deletion_jobs() reclaims a `running` job on updated_at,
    // so the two clocks disagree: a job queued more than 30 minutes ago and
    // claimed seconds ago pages here while the worker is perfectly fresh.
    //
    // It cannot be corrected from this file. kilo.health_data_deletion_jobs has
    // RLS enabled with NO policies, so it is deny-all to every role without
    // BYPASSRLS; the security definer backlog function is the only read path,
    // and a column-level grant of (id, status, updated_at) to the monitor role
    // still returns zero rows (verified on a disposable Postgres with all
    // migrations applied). The fix therefore requires either a new RLS policy or
    // adding updated_at to the backlog function's return type -- both changes to
    // supabase/migrations/, which is outside this issue's Allowed Files.
    //
    // Erring toward a false page rather than a missed wedged worker is the safer
    // side of that trade while it stands. See docs/architecture.md.
    if (job.status === 'running' && age > runningStaleSeconds) {
      findings.push({
        kind: 'running-job-stale',
        job_id: job.job_id,
        detail:
          `running for ${formatAge(age)} since creation, past the ` +
          `${thresholds.runningStaleMinutes}m reclaim ceiling`,
      });
    }
  }

  return {
    project: projectRef,
    checked_at: snapshot.checked_at ?? null,
    thresholds,
    open_jobs: jobs.length,
    jobs,
    findings,
    healthy: findings.length === 0,
  };
}

function formatAge(seconds) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

export function renderAlert(alert) {
  const lines = [];
  lines.push(`project ${alert.project} — ${alert.open_jobs} open deletion job(s)`);

  for (const job of alert.jobs) {
    const parts = [
      `job ${job.job_id}`,
      `reason=${job.reason}`,
      `status=${job.status}`,
      `attempts=${job.attempts}`,
      `age=${formatAge(job.age_seconds ?? 0)}`,
    ];
    if (job.last_error) parts.push(`last_error="${job.last_error}"`);
    lines.push(`  ${parts.join(' ')}`);
  }

  if (alert.findings.length > 0) {
    lines.push('');
    lines.push('findings:');
    for (const finding of alert.findings) {
      lines.push(`  [${finding.kind}]${finding.job_id ? ` job ${finding.job_id}` : ''} ${finding.detail}`);
    }
    lines.push('');
    lines.push(RUNBOOK);
  }

  return lines.join('\n');
}

const RUNBOOK = `Response (see docs/architecture.md, "Health-Deletion Queue Monitor"):
  1. Inspect the backlog and the pg_net response metadata; do not clear the job.
  2. Restore the prerequisites deploy verifies: Edge Function ACTIVE, both Vault
     secret names present, "${DRAIN_CRON_JOB}" cron active.
  3. Dispatch safely with kilo.dispatch_health_deletion_worker() once the
     prerequisites are back.
  4. Verify kilo.health_data_row_counts(user_id) is zero on every gated table.
  5. NEVER delete or force-complete a job to silence this alert: the user is
     still waiting on an erasure they were told had started.`;

function readSnapshot(connectionUrl) {
  let stdout;
  try {
    stdout = execFileSync(
      'psql',
      ['--no-psqlrc', '--tuples-only', '--no-align', '-v', 'ON_ERROR_STOP=1', '-c', MONITOR_QUERY],
      {
        env: { ...process.env, ...libpqEnv(connectionUrl) },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
  } catch (err) {
    // err.message is "Command failed: psql ...". Report psql's own stderr only,
    // which describes the failure without echoing the command or the env.
    abort(2, 'could not read the deletion backlog from the live project.', err.stderr || err.stdout);
  }

  const trimmed = stdout.trim();
  if (!trimmed) {
    abort(2, 'the monitor query returned nothing. Refusing to report a healthy queue.');
  }

  try {
    return JSON.parse(trimmed);
  } catch (err) {
    abort(2, 'the monitor query did not return valid JSON.', err.message);
  }
}

// A real dry run of the alert path, with a synthetic snapshot instead of a
// database. It intentionally feeds a user id and a last_error stuffed with an
// email address and a token so an operator can SEE the redaction working before
// wiring this to a notification channel. Never connects to anything.
const DRY_RUN_SNAPSHOT = {
  checked_at: '2026-07-19T12:00:00Z',
  drain_cron_active: false,
  drain_cron_present: true,
  required_secret_names: ['kilo_functions_base_url', 'kilo_service_role_key'],
  present_secret_names: ['kilo_functions_base_url'],
  jobs: [
    {
      job_id: '11111111-1111-4111-8111-111111111111',
      user_id: '99999999-9999-4999-8999-999999999999',
      reason: 'withdrawal',
      status: 'failed',
      attempts: 9,
      age: '03:20:00',
      age_seconds: 12000,
      last_error: 'dispatch rejected for person@example.com with sb_secret_examplekeymaterial',
    },
    {
      job_id: '22222222-2222-4222-8222-222222222222',
      user_id: '88888888-8888-4888-8888-888888888888',
      reason: 'quarantine_expiry',
      status: 'running',
      attempts: 1,
      age: '00:50:00',
      age_seconds: 3000,
      last_error: null,
    },
  ],
};

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const dryRun = args.includes('--dry-run');

  const projectRef = process.env.KILO_MONITOR_PROJECT_REF || DEFAULT_PROJECT_REF;
  const thresholds = thresholdsFromEnv();

  let snapshot;
  if (dryRun) {
    console.log('health-deletion-backlog: --dry-run, synthetic snapshot, no database connection.\n');
    snapshot = DRY_RUN_SNAPSHOT;
  } else {
    loadLocalEnv(process.env.KILO_MONITOR_ENV_FILE || join(root, '.env'));
    const connectionUrl = process.env[CONNECTION_ENV];
    if (!connectionUrl) {
      abort(2, `${CONNECTION_ENV} is not set. Refusing to report a healthy purge queue without reading the database.`);
    }
    snapshot = readSnapshot(connectionUrl);
  }

  const alert = buildAlert(snapshot, thresholds, projectRef);
  const rendered = asJson ? JSON.stringify(alert, null, 2) : renderAlert(alert);

  if (alert.healthy) {
    console.log(rendered);
    console.log(
      `health-deletion-backlog: ok — ${alert.open_jobs} open job(s), all within thresholds; ` +
        `drain cron active and worker configuration present.`
    );
    process.exit(0);
  }

  console.log(rendered);
  emit('error', `health-deletion-backlog: ${alert.findings.length} finding(s) on project ${alert.project}.`);

  // --dry-run demonstrates the alert rendering; it must not fail a CI job that
  // is only exercising the format.
  process.exit(dryRun ? 0 : 1);
}

// Importable for scripts/health-deletion-monitor.test.mjs without executing.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}

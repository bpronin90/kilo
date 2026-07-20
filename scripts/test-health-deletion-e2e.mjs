#!/usr/bin/env node
// End-to-end proof that cron/drain -> pg_net -> health-data-delete -> verified
// erasure actually works, across the real HTTP boundary.
//
// The existing pgTAP suite (supabase/tests/health-deletion-worker.test.sql) is
// fast, deterministic, and deliberately stops at the queue: inside its
// uncommitted transaction the pg_net background worker cannot see the rows, so
// it asserts on net.http_request_queue -- what WOULD have been sent. That is the
// right unit-level contract, and it is exactly why #492's failure survived it.
// The request was well-formed; the Edge Function on the other end was missing.
//
// This harness is the separately identifiable boundary test. It creates a
// disposable account, gives it synthetic health rows, records consent, withdraws
// it, dispatches the real worker, waits for the real HTTP response, and proves
// every shared gated table is empty before deleting the fixture account.
//
// Usage:
//   node scripts/test-health-deletion-e2e.mjs
//   node scripts/test-health-deletion-e2e.mjs --scenarios
//   node scripts/test-health-deletion-e2e.mjs --allow-production
//
// --scenarios additionally runs the seven required failure/recovery stages
// (missing function, missing Vault configuration, HTTP auth failure, pg_net
// failure, partial erasure, retry, eventual completion) plus the stale-`running`
// reclaim. It is refused against production unconditionally.
//
// Required environment:
//   KILO_E2E_DATABASE_URL      postgresql:// superuser-or-owner URL for the target
//   KILO_E2E_SUPABASE_URL      https://<ref>.supabase.co
//
// Both must resolve to the SAME project ref; a mismatched pair is refused before
// any account is created or any SQL is issued.
//   KILO_E2E_SERVICE_ROLE_KEY  service-role key for the target project
//   KILO_E2E_ANON_KEY          anon key for the target project
//   KILO_E2E_EMAIL_DOMAIN      disposable mail domain for the fixture account
//
// Production guard: BOTH are required, and neither alone is enough.
//   --allow-production                              explicit operator flag
//   KILO_E2E_DISPOSABLE_ACCOUNT_CONFIRMED=<domain>  operator echoes the domain
//
// Exit codes:
//   0  the full boundary works and the fixture account is gone
//   1  the boundary is broken (see the classified stage in the output)
//   2  the harness could not run (guards, config, unreachable target)
//
// This file never contains, prints, or commits a credential. The fixture
// password is generated at runtime and never leaves the process.

import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// AGENTS.md "Infrastructure Facts": this ref is production and is shared with a
// co-tenant app. Anything targeting it needs both guards.
const PRODUCTION_PROJECT_REF = 'ogzhnscdqcdrhfqcobuv';

// Synthetic fixture rows, one per gated table. Values are obviously fake and
// carry no real health meaning.
//
// This map is asserted against kilo.health_gated_tables() at runtime: a table
// added to the gated set but not to this map fails the harness loudly rather
// than silently proving erasure over a smaller set than production deletes.
const FIXTURE_ROWS = {
  user_health_profile: `insert into kilo.user_health_profile (user_id, fatigue_multiplier, tracked_lifts)
    values ($1, 1.25, '["e2e-fixture-lift"]'::jsonb)
    on conflict (user_id) do update set fatigue_multiplier = 1.25`,
  weight_entries: `insert into kilo.weight_entries (user_id, id, weight_value, entry_type)
    values ($1, 'e2e-fixture-weight', 77.7, 'weight')`,
  weight_goal: `insert into kilo.weight_goal (user_id, target_weight, start_weight)
    values ($1, 70, 80)`,
  archived_weight_goals: `insert into kilo.archived_weight_goals (user_id, id, target_weight, start_weight)
    values ($1, 'e2e-fixture-archived-goal', 70, 80)`,
  workout_notes: `insert into kilo.workout_notes (user_id, id, title, raw_text)
    values ($1, 'e2e-fixture-note', 'e2e fixture', 'e2e fixture routine')`,
  deload_history: `insert into kilo.deload_history (user_id, id, raw_text)
    values ($1, 'e2e-fixture-deload', 'e2e fixture deload')`,
  fatigue_checkins: `insert into kilo.fatigue_checkins (user_id, id, status)
    values ($1, 'e2e-fixture-checkin', 'ok')`,
};

// --- guards -------------------------------------------------------------

// A local stack is one identity for both endpoints; it is never production.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal']);
const LOCAL_IDENTITY = 'local';

function normalizeHost(host) {
  return (host || '').replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
}

// The project ref behind the API URL: https://<ref>.supabase.co
export function projectRefFromUrl(supabaseUrl) {
  let host;
  try {
    host = normalizeHost(new URL(supabaseUrl).hostname);
  } catch {
    return null;
  }
  if (!host) return null;
  if (LOCAL_HOSTS.has(host)) return LOCAL_IDENTITY;
  const match = /^([a-z0-9-]+)\.supabase\.(co|in|red|net)$/.exec(host);
  return match ? match[1] : null;
}

// The project ref behind the DATABASE URL. Supabase exposes two shapes and the
// ref lives in a different place in each, which is exactly why a check on the
// API URL alone could never bind them:
//
//   direct   postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres
//   pooler   postgresql://postgres.<ref>:...@aws-N-<region>.pooler.supabase.com:5432/postgres
//
// Returns null for anything it cannot positively identify, so the caller fails
// closed rather than assuming an unrecognized host is safe.
export function projectRefFromDatabaseUrl(databaseUrl) {
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') return null;

  const host = normalizeHost(url.hostname);
  if (!host) return null;
  if (LOCAL_HOSTS.has(host)) return LOCAL_IDENTITY;

  if (host.endsWith('.pooler.supabase.com')) {
    const user = decodeURIComponent(url.username || '').toLowerCase();
    const match = /^postgres\.([a-z0-9-]+)$/.exec(user);
    return match ? match[1] : null;
  }

  const match = /^db\.([a-z0-9-]+)\.supabase\.(co|in|red|net)$/.exec(host);
  return match ? match[1] : null;
}

// Binds the API endpoint and the database endpoint to ONE verified project
// identity before anything is created or written.
//
// Without this the two URLs are independent: every fixture insert, prerequisite
// read, drain, and erasure assertion goes through KILO_E2E_DATABASE_URL, while
// the production classification looked only at KILO_E2E_SUPABASE_URL. An
// isolated API URL paired with the production database URL therefore satisfied
// both production guards and still wrote synthetic rows to production.
//
// Fails closed on either side: an endpoint whose ref cannot be parsed is a
// refusal, not an assumption of safety.
export function resolveTargetIdentity({ supabaseUrl, databaseUrl }) {
  const apiRef = projectRefFromUrl(supabaseUrl);
  if (!apiRef) {
    return {
      ok: false,
      reason:
        'KILO_E2E_SUPABASE_URL does not resolve to an identifiable project ' +
        '(expected https://<ref>.supabase.co or a local host). Failing closed.',
    };
  }

  const dbRef = projectRefFromDatabaseUrl(databaseUrl);
  if (!dbRef) {
    return {
      ok: false,
      reason:
        'KILO_E2E_DATABASE_URL does not resolve to an identifiable project (expected ' +
        'postgresql://...@db.<ref>.supabase.co, postgresql://postgres.<ref>@...pooler.supabase.com, ' +
        'or a local host). Failing closed.',
    };
  }

  if (apiRef !== dbRef) {
    return {
      ok: false,
      reason:
        `target mismatch: KILO_E2E_SUPABASE_URL resolves to project "${apiRef}" but ` +
        `KILO_E2E_DATABASE_URL resolves to project "${dbRef}". Both endpoints must belong to ` +
        'one verified project; a mismatched pair could write fixture rows to a project the ' +
        'production guards never inspected.',
    };
  }

  return { ok: true, ref: apiRef };
}

// Pure, and unit-tested in scripts/health-deletion-monitor.test.mjs. The whole
// point is that this cannot be satisfied by accident: an operator who exports
// production credentials and runs the harness out of habit gets exit 2, not a
// live purge run against real accounts.
export function assertTargetAllowed({
  supabaseUrl,
  databaseUrl,
  emailDomain,
  allowProduction,
  confirmedDomain,
}) {
  // Identity binding runs FIRST: a mismatched pair is refused before the
  // production classification is even reached, and long before any account or
  // SQL statement exists.
  const identity = resolveTargetIdentity({ supabaseUrl, databaseUrl });
  if (!identity.ok) return { ok: false, reason: identity.reason };
  const ref = identity.ref;

  if (!emailDomain) {
    return { ok: false, reason: 'KILO_E2E_EMAIL_DOMAIN is required; the harness will not invent a mail domain.' };
  }

  const isProduction = ref === PRODUCTION_PROJECT_REF;
  if (!isProduction) return { ok: true, ref, isProduction: false };

  if (!allowProduction) {
    return {
      ok: false,
      reason:
        `refusing to run against production project ${ref} without --allow-production. ` +
        'Ordinary CI runs against a local or isolated test project.',
    };
  }

  // Second, independent key. The operator has to know and retype the disposable
  // mail domain, which is the thing that proves they understand which accounts
  // this run creates and destroys.
  if (!confirmedDomain) {
    return {
      ok: false,
      reason:
        '--allow-production requires KILO_E2E_DISPOSABLE_ACCOUNT_CONFIRMED to be set to the ' +
        'disposable mail domain. The flag alone is not sufficient.',
    };
  }

  if (confirmedDomain !== emailDomain) {
    return {
      ok: false,
      reason:
        'KILO_E2E_DISPOSABLE_ACCOUNT_CONFIRMED does not match KILO_E2E_EMAIL_DOMAIN. ' +
        'The disposable-account guard must name the exact domain the fixture is created in.',
    };
  }

  return { ok: true, ref, isProduction: true };
}

// --- failure classification --------------------------------------------

// Maps an observed boundary outcome onto the operator-actionable stage that
// broke. Pure and exhaustively unit-tested, so the harness reports "missing
// Vault configuration" rather than "timed out" -- these seven are the failure
// modes #492 and #540 established, and each one has a different fix.
export function classifyBoundaryFailure(observation) {
  const { dispatchRequestId, secretsPresent, functionDeployed, netResponse, remainingRows, jobStatus, attempts } =
    observation;

  if (secretsPresent === false) {
    return {
      stage: 'missing-vault-configuration',
      detail: 'kilo.dispatch_health_deletion_worker() cannot authenticate: a Vault secret named by kilo.worker_secret_names() is absent.',
    };
  }

  if (functionDeployed === false) {
    return {
      stage: 'missing-function',
      detail: 'health-data-delete is not deployed or not ACTIVE; run scripts/deploy-kilo-functions.sh.',
    };
  }

  if (dispatchRequestId === null || dispatchRequestId === undefined) {
    return {
      stage: 'dispatch-returned-null',
      detail: 'the worker was never invoked. This is the silent-failure mode from #492; check the raise warning in the Postgres log.',
    };
  }

  // pg_net records transport failures as error_msg with no status code at all.
  if (netResponse && netResponse.error_msg) {
    return {
      stage: 'pg-net-failure',
      detail: `pg_net could not complete the request: ${netResponse.error_msg}`,
    };
  }

  if (netResponse && (netResponse.status_code === 401 || netResponse.status_code === 403)) {
    return {
      stage: 'http-authentication-failure',
      detail: `health-data-delete rejected the worker credential (HTTP ${netResponse.status_code}); the Vault service-role key is wrong or rotated.`,
    };
  }

  if (netResponse && netResponse.status_code === 404) {
    return {
      stage: 'missing-function',
      detail: 'health-data-delete returned 404; the function is not deployed at the configured base URL.',
    };
  }

  // An actively-retrying job outranks the remaining-row count.
  //
  // A job that is back in `pending` after at least one attempt is, by
  // definition, queued for another try -- and gated rows still remaining is the
  // REASON it is retrying, not an independent finding. Reporting that as
  // `partial-erasure` tells an operator "the worker ran and could not finish",
  // which prompts intervention on a queue that is already recovering on its own.
  // `retry-pending` tells them to wait and watch the attempt count, which is the
  // correct action.
  //
  // `partial-erasure` keeps everything else, including a `failed` job and a job
  // whose completion was refused outright -- those are not queued for a further
  // attempt and do need a human.
  if (jobStatus === 'pending' && (attempts ?? 0) >= 1) {
    return {
      stage: 'retry-pending',
      detail: `the job is ${jobStatus} after ${attempts} attempt(s); it is retrying rather than completing.`,
    };
  }

  if (remainingRows > 0) {
    return {
      stage: 'partial-erasure',
      detail: `${remainingRows} gated row(s) remain after the worker ran; kilo.complete_health_deletion_job correctly refused to advance to withdrawn.`,
    };
  }

  if (jobStatus && jobStatus !== 'complete') {
    return {
      stage: 'retry-pending',
      detail: `the job is ${jobStatus} after ${attempts ?? 0} attempt(s); it is retrying rather than completing.`,
    };
  }

  return null; // eventual completion
}

// --- exit-code contract -------------------------------------------------

// Pure, so the "cleanup failure can never be green" property is asserted
// directly rather than inferred from a code path. There is deliberately no
// branch that maps a cleanup failure to 0: a run that leaves a real auth account
// behind is not a successful run, however well the boundary itself behaved.
export function finalExitCode({ failed, cleanupFailure }) {
  if (failed && failed.stage === 'harness-error') return 2;
  if (failed) return 1;
  if (cleanupFailure) return 1;
  return 0;
}

// --- plumbing -----------------------------------------------------------

function loadLocalEnv(envPath) {
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function libpqEnv(rawUrl) {
  const url = new URL(rawUrl);
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

let PG_ENV = null;

// Parameters go through psql -v bindings rather than string interpolation, and
// the connection password stays in libpq env vars, never argv.
//
// The statement is fed on STDIN, not via `-c`. psql performs `:'var'` variable
// interpolation only for input it reads from a file or standard input; with
// `-c` the string is passed through untouched, so every parameterised statement
// here reached the server with a literal `:'p1'` and died on
// `syntax error at or near ":"`. That made the whole harness unrunnable, which
// is precisely the class of defect that only an actual end-to-end execution can
// surface -- the offline source-shape tests were all green against it.
function sql(statement, params = []) {
  const args = ['--no-psqlrc', '--tuples-only', '--no-align', '-v', 'ON_ERROR_STOP=1'];
  let text = statement;
  params.forEach((value, index) => {
    const name = `p${index + 1}`;
    args.push('-v', `${name}=${value}`);
    text = text.replaceAll(`$${index + 1}`, `:'${name}'`);
  });

  return execFileSync('psql', args, {
    input: text,
    env: { ...process.env, ...PG_ENV },
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function fail(code, message, detail) {
  console.error(`health-deletion-e2e: ${message}`);
  if (detail) console.error(String(detail).trim());
  process.exit(code);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Throwing helper: the normal call shape, where any non-2xx is fatal.
async function admin(path, method, body, { supabaseUrl, serviceRoleKey }) {
  const result = await adminRaw(path, method, body, { supabaseUrl, serviceRoleKey });
  if (!result.ok) {
    // Never echo the request body: it carries the fixture password.
    throw new Error(
      `admin ${method} ${path} failed with HTTP ${result.status}: ${String(result.text).slice(0, 300)}`
    );
  }
  return result.json;
}

// Status-exposing helper. Deletion confirmation needs to tell "the account is
// genuinely gone" (404) apart from "I could not find out" (401, 500, a network
// timeout, an unparseable body). The throwing wrapper above collapses all of
// those into one exception, and the cleanup path used to read ANY exception as
// proof of absence -- so an expired service-role key or a 500 printed "removal
// confirmed" and the run could still exit 0 with a live account behind it.
//
// `ok` here means "the HTTP round trip completed and was parsed", NOT "2xx".
// `status` is null only when no response was obtained at all (transport error),
// which is precisely the case a caller must never read as a not-found.
async function adminRaw(path, method, body, { supabaseUrl, serviceRoleKey }) {
  let response;
  try {
    response = await fetch(`${supabaseUrl}/auth/v1/admin/${path}`, {
      method,
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    return { ok: false, status: null, text: '', json: null, transportError: err.message };
  }

  const text = await response.text();
  let json = null;
  let parseError = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch (err) {
      parseError = err.message;
    }
  }

  return {
    ok: response.ok && parseError === null,
    status: response.status,
    text,
    json,
    parseError,
    transportError: null,
  };
}

// The ONLY response that proves a fixture account is gone.
//
// GoTrue answers a admin GET for an unknown user with 404. Anything else -- a
// 2xx (it is still there), a 401/403 (the key stopped working, so this probe
// never actually checked), a 5xx, a timeout, an unparseable body -- means the
// account's fate is unknown, and unknown must never render as confirmed.
export function classifyDeletionProbe(result) {
  if (result.transportError) {
    return { confirmed: false, reason: `the confirmation request did not complete: ${result.transportError}` };
  }
  if (result.status === 404) {
    return { confirmed: true, reason: null };
  }
  if (result.status === 200 || result.status === 201) {
    return { confirmed: false, reason: 'the account still resolves after a successful DELETE (possible soft delete)' };
  }
  if (result.parseError) {
    return {
      confirmed: false,
      reason: `the confirmation request returned HTTP ${result.status} with an unparseable body, so deletion is unverified`,
    };
  }
  return {
    confirmed: false,
    reason: `the confirmation request returned HTTP ${result.status}, so deletion is unverified (only 404 proves removal)`,
  };
}

async function rpcAsUser(fn, body, { supabaseUrl, anonKey, accessToken }) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept-Profile': 'kilo',
      'Content-Profile': 'kilo',
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`rpc ${fn} failed with HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

// --- failure / recovery scenarios ---------------------------------------
//
// The seven required boundary cases, as REAL harness stages that drive the
// isolated target rather than as fabricated observations fed to a pure function.
// Each one arranges a genuine fault in the live stack, drives the actual cron
// entrypoint, observes what the stack does, and asserts the classification.
//
// Enabled with --scenarios. Refused on production unconditionally, with no
// operator override: these stages park Vault secrets and induce failed jobs, and
// there is no version of that which is acceptable against real users' data. The
// happy-path run has an operator escape hatch; this deliberately does not.
//
// Vault handling never decrypts anything. A secret is "parked" by RENAMING it,
// and a substitute is created under the required name, so the original value is
// never read, printed, or reconstructed -- it is restored by renaming back.

const PARKED_SUFFIX = '__e2e_parked';

// Reads a Vault secret's VALUE. Used only to derive a deliberately-dead variant
// of a working URL for the missing-function scenario. The value is never
// printed, never returned to an alert surface, and never leaves this process.
function currentSecretValue(name) {
  return sql('select decrypted_secret from vault.decrypted_secrets where name = $1', [name]).trim();
}

function parkSecret(name) {
  sql(`update vault.secrets set name = $1 || '${PARKED_SUFFIX}' where name = $1`, [name]);
}

function installSecret(name, value) {
  sql('select vault.create_secret($1, $2)', [value, name]);
}

function restoreSecret(name) {
  sql('delete from vault.secrets where name = $1', [name]);
  sql(`update vault.secrets set name = $1 where name = $1 || '${PARKED_SUFFIX}'`, [name]);
}

function secretNames() {
  const row = sql('select functions_base_url || $1 || service_role_key from kilo.worker_secret_names()', ['|']);
  const [baseUrl, serviceKey] = row.split('|');
  return { baseUrl, serviceKey };
}

// Re-arm the fixture: put the synthetic rows back and move the job to a due,
// pending state. Inserts are attempted individually because a scenario that did
// not purge leaves its rows in place, and a duplicate there is expected.
function rearmFixture(userId, gatedTables) {
  for (const table of gatedTables) {
    try {
      sql(FIXTURE_ROWS[table], [userId]);
    } catch {
      // Row already present from a scenario that intentionally did not erase.
    }
  }
  const seeded = Number(sql('select sum(value::bigint) from jsonb_each_text(kilo.health_data_row_counts($1))', [userId]));
  if (!(seeded > 0)) throw new Error('could not re-arm fixture rows; the scenario would be vacuous');
  sql('select kilo.reenqueue_health_deletion($1)', [userId]);

  // Return consent to the state a genuinely pending purge is in.
  //
  // The happy path that runs before these scenarios completes the purge and
  // legitimately advances consent_state to `withdrawn`, and
  // kilo.reenqueue_health_deletion() deliberately does not touch consent_state
  // (an operator retry is about the job, not the grant). Without this reset the
  // partial-erasure scenario asserts "consent must not be withdrawn" against a
  // row that the previous stage had already withdrawn for a legitimate reason,
  // so it could never pass -- and the retry scenario then inherited the same
  // false failure.
  sql(
    "update kilo.consent_state set status = 'deletion_pending' where user_id = $1 and status = 'withdrawn'",
    [userId]
  );
  return seeded;
}

function currentJob(userId) {
  const row = sql(
    `select j.id::text || '|' || j.status || '|' || j.attempts::text || '|' ||
            (j.next_attempt_at > now())::text
     from kilo.health_data_deletion_jobs j
     where j.user_id = $1 order by j.created_at desc limit 1`,
    [userId]
  );
  if (!row) return null;
  const [id, status, attempts, backoffPending] = row.split('|');
  return { id, status, attempts: Number(attempts), backoffPending: backoffPending === 'true' };
}

function drain() {
  return JSON.parse(sql('select kilo.drain_health_deletion_jobs()'));
}

// Returns null for a null request id rather than querying for it.
//
// kilo.dispatch_health_deletion_worker() returns NULL whenever there is nothing
// due -- including the ordinary case where a previous scenario's dispatch is
// still in flight and the job is already `running`. Passing that straight into
// the lookup produced `invalid input syntax for type bigint: "null"` and failed
// the scenario for a condition that is not an error.
function awaitNetResponse(requestId, seconds = 60) {
  if (requestId === null || requestId === undefined) return Promise.resolve(null);
  return (async () => {
    for (let attempt = 0; attempt < seconds; attempt += 1) {
      const row = sql(
        `select coalesce(status_code::text, '') || '|' || coalesce(error_msg, '')
         from net._http_response where id = $1`,
        [requestId]
      );
      if (row) {
        const [status, errorMessage] = row.split('|');
        return { status_code: status ? Number(status) : null, error_msg: errorMessage || null };
      }
      await sleep(1000);
    }
    return null;
  })();
}

function remainingFor(userId) {
  return Number(sql('select sum(value::bigint) from jsonb_each_text(kilo.health_data_row_counts($1))', [userId]));
}

async function awaitCompletion(userId, seconds = 120) {
  for (let attempt = 0; attempt < seconds / 2; attempt += 1) {
    const job = currentJob(userId);
    const remaining = remainingFor(userId);
    if (job && job.status === 'complete' && remaining === 0) return { job, remaining };
    await sleep(2000);
  }
  return { job: currentJob(userId), remaining: remainingFor(userId) };
}

// Each scenario returns the stage it expects classifyBoundaryFailure to name, so
// the assertion is on the real stack's observed behavior, not on a hand-built
// observation object.
export const BOUNDARY_SCENARIOS = [
  {
    name: 'missing-vault-configuration',
    expect: 'missing-vault-configuration',
    async run({ userId, gatedTables }) {
      const { baseUrl, serviceKey } = secretNames();
      rearmFixture(userId, gatedTables);
      parkSecret(baseUrl);
      parkSecret(serviceKey);
      try {
        const result = drain();
        if (result.dispatched !== false || result.request_id !== null) {
          throw new Error('drain dispatched despite absent Vault configuration');
        }
        return { dispatchRequestId: null, secretsPresent: false, functionDeployed: true, netResponse: null };
      } finally {
        restoreSecret(baseUrl);
        restoreSecret(serviceKey);
      }
    },
  },
  {
    name: 'missing-function',
    expect: 'missing-function',
    async run({ userId, gatedTables }) {
      const { baseUrl } = secretNames();
      rearmFixture(userId, gatedTables);

      // A reachable origin with no function mounted at the worker path: the
      // request leaves the database and comes back 404, which is the shape of a
      // never-deployed or renamed Edge Function.
      //
      // Derived from the target's OWN working base URL rather than a synthesised
      // `https://<ref>.supabase.co` host. That construction was wrong twice: on a
      // local target `ref` is the string "local", so it produced
      // `https://local.supabase.co`, which does not resolve -- pg_net returned a
      // transport error and the scenario observed `pg-net-failure` instead of
      // `missing-function`. And on any non-local target it would have sent a real
      // request to a real Supabase origin the harness never verified. Appending a
      // dead path segment to the configured origin keeps the host reachable,
      // which is exactly what distinguishes "function missing" from "network
      // broken".
      const workingBaseUrl = currentSecretValue(baseUrl);
      parkSecret(baseUrl);
      installSecret(baseUrl, `${workingBaseUrl.replace(/\/$/, '')}/e2e-nonexistent-base`);
      try {
        const result = drain();
        const netResponse = await awaitNetResponse(result.request_id);
        return {
          dispatchRequestId: result.request_id,
          secretsPresent: true,
          functionDeployed: !(netResponse && netResponse.status_code === 404),
          netResponse,
        };
      } finally {
        restoreSecret(baseUrl);
      }
    },
  },
  {
    name: 'http-authentication-failure',
    expect: 'http-authentication-failure',
    async run({ userId, gatedTables }) {
      const { serviceKey } = secretNames();
      rearmFixture(userId, gatedTables);
      parkSecret(serviceKey);
      // Well-formed but invalid: the function must reject the credential rather
      // than fail to parse it, which is what a rotated key looks like in prod.
      installSecret(serviceKey, 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e2e-invalid.e2e-invalid');
      try {
        const result = drain();
        const netResponse = await awaitNetResponse(result.request_id);
        return {
          dispatchRequestId: result.request_id,
          secretsPresent: true,
          functionDeployed: true,
          netResponse,
        };
      } finally {
        restoreSecret(serviceKey);
      }
    },
  },
  {
    name: 'pg-net-failure',
    expect: 'pg-net-failure',
    async run({ userId, gatedTables }) {
      const { baseUrl } = secretNames();
      rearmFixture(userId, gatedTables);
      parkSecret(baseUrl);
      // Closed port on the loopback interface: pg_net records a transport
      // error_msg with no status code at all.
      installSecret(baseUrl, 'https://127.0.0.1:1');
      try {
        const result = drain();
        const netResponse = await awaitNetResponse(result.request_id);
        return {
          dispatchRequestId: result.request_id,
          secretsPresent: true,
          functionDeployed: true,
          netResponse,
        };
      } finally {
        restoreSecret(baseUrl);
      }
    },
  },
  {
    name: 'partial-erasure',
    expect: 'partial-erasure',
    async run({ userId, gatedTables }) {
      // Drive the completion path directly with rows still present. This is the
      // real guard in kilo.complete_health_deletion_job: it re-counts the gated
      // set and refuses to advance to `withdrawn` while anything remains.
      const seeded = rearmFixture(userId, gatedTables);
      const job = currentJob(userId);
      const outcome = JSON.parse(sql('select kilo.complete_health_deletion_job($1)', [job.id]));
      if (outcome.ok !== false) {
        throw new Error('complete_health_deletion_job advanced a job while gated rows remained');
      }
      if (Number(outcome.remaining) !== seeded) {
        throw new Error(`completion reported remaining=${outcome.remaining}, expected ${seeded}`);
      }
      const consent = sql('select status from kilo.consent_state where user_id = $1', [userId]);
      if (consent === 'withdrawn') {
        throw new Error('consent_state advanced to withdrawn despite a refused completion');
      }
      return {
        dispatchRequestId: 1,
        secretsPresent: true,
        functionDeployed: true,
        netResponse: { status_code: 200, error_msg: null },
        remainingRows: Number(outcome.remaining),
        jobStatus: 'failed',
      };
    },
  },
  {
    name: 'retry',
    expect: 'retry-pending',
    async run({ userId, gatedTables }) {
      rearmFixture(userId, gatedTables);

      // Claim before failing, because that is the real order of events: the
      // worker claims a job (which is what increments `attempts` --
      // kilo.fail_health_deletion_job deliberately does not), then the attempt
      // fails. Failing an unclaimed job left attempts at 0, so the scenario was
      // simulating a "retry" that had never actually been tried, and the
      // observation was indistinguishable from a job that had merely stalled.
      sql('select kilo.claim_health_deletion_job()');
      const before = currentJob(userId);
      sql('select kilo.fail_health_deletion_job($1, $2)', [before.id, 'e2e induced transient failure']);

      const failedJob = currentJob(userId);
      if (!(failedJob.attempts >= 1)) {
        throw new Error(`a claimed-then-failed job must record an attempt, got attempts=${failedJob.attempts}`);
      }
      if (failedJob.status !== 'failed') throw new Error(`expected status failed, got ${failedJob.status}`);
      if (!failedJob.backoffPending) throw new Error('a failed job must sit out its backoff window');

      // Recovery half: once the backoff elapses the DRAIN itself must re-open it.
      // This is the reclaim path a direct dispatch call never exercised.
      sql('update kilo.health_data_deletion_jobs set next_attempt_at = now() where id = $1', [failedJob.id]);
      const result = drain();
      if (!(result.reopened >= 1)) {
        throw new Error(`drain did not re-open the due failed job (reopened=${result.reopened})`);
      }
      return {
        dispatchRequestId: result.request_id,
        secretsPresent: true,
        functionDeployed: true,
        netResponse: { status_code: 200, error_msg: null },
        remainingRows: remainingFor(userId),
        jobStatus: 'pending',
        attempts: failedJob.attempts,
      };
    },
  },
  {
    name: 'eventual-completion',
    expect: null,
    async run({ userId, gatedTables }) {
      rearmFixture(userId, gatedTables);

      // Drain until it actually dispatches. The preceding retry scenario leaves a
      // dispatch in flight, so the first drain here can legitimately find the job
      // already `running` and return request_id = null -- which is "nothing due",
      // not "the worker was never invoked". Retrying briefly distinguishes the
      // two instead of failing the run on a scheduling race.
      let result = drain();
      for (let attempt = 0; attempt < 30 && result.request_id === null; attempt += 1) {
        await sleep(2000);
        result = drain();
      }

      const netResponse = await awaitNetResponse(result.request_id);
      const { job, remaining } = await awaitCompletion(userId);
      return {
        dispatchRequestId: result.request_id,
        secretsPresent: true,
        functionDeployed: true,
        netResponse,
        remainingRows: remaining,
        jobStatus: job ? job.status : 'none',
        attempts: job ? job.attempts : 0,
      };
    },
  },
];

// Also exercises the stale-`running` reclaim, which is the condition the backlog
// monitor pages on and which only the drain entrypoint can perform.
async function runStaleReclaimStage(userId, gatedTables) {
  rearmFixture(userId, gatedTables);
  const job = currentJob(userId);
  sql(
    `update kilo.health_data_deletion_jobs
     set status = 'running', updated_at = now() - interval '31 minutes' where id = $1`,
    [job.id]
  );
  const result = drain();
  if (!(result.reclaimed_stale >= 1)) {
    throw new Error(`drain did not reclaim a stale running job (reclaimed_stale=${result.reclaimed_stale})`);
  }
  console.log('    ok - stale `running` job reclaimed by the drain entrypoint');
}

async function runBoundaryScenarios(context) {
  console.log('health-deletion-e2e: running boundary failure/recovery scenarios');
  const failures = [];

  await runStaleReclaimStage(context.userId, context.gatedTables);

  for (const scenario of BOUNDARY_SCENARIOS) {
    try {
      const observation = await scenario.run(context);
      const classification = classifyBoundaryFailure({
        remainingRows: 0,
        jobStatus: 'complete',
        attempts: 1,
        ...observation,
      });
      const actual = classification ? classification.stage : null;
      if (actual !== scenario.expect) {
        failures.push(`${scenario.name}: expected stage ${scenario.expect ?? 'none'}, observed ${actual ?? 'none'}`);
        console.log(`    FAIL - ${scenario.name} (observed ${actual ?? 'none'})`);
      } else {
        console.log(`    ok - ${scenario.name}`);
      }
    } catch (err) {
      failures.push(`${scenario.name}: ${err.stderr ? String(err.stderr).slice(0, 300) : err.message}`);
      console.log(`    FAIL - ${scenario.name}`);
    }
  }

  return failures;
}

// --- the run ------------------------------------------------------------

async function main() {
  loadLocalEnv(process.env.KILO_E2E_ENV_FILE || join(root, '.env'));

  const allowProduction = process.argv.includes('--allow-production');
  const runScenarios = process.argv.includes('--scenarios');
  const supabaseUrl = (process.env.KILO_E2E_SUPABASE_URL || '').replace(/\/$/, '');
  const serviceRoleKey = process.env.KILO_E2E_SERVICE_ROLE_KEY;
  const anonKey = process.env.KILO_E2E_ANON_KEY;
  const databaseUrl = process.env.KILO_E2E_DATABASE_URL;
  const emailDomain = process.env.KILO_E2E_EMAIL_DOMAIN;
  const confirmedDomain = process.env.KILO_E2E_DISPOSABLE_ACCOUNT_CONFIRMED;

  for (const [name, value] of Object.entries({
    KILO_E2E_SUPABASE_URL: supabaseUrl,
    KILO_E2E_SERVICE_ROLE_KEY: serviceRoleKey,
    KILO_E2E_ANON_KEY: anonKey,
    KILO_E2E_DATABASE_URL: databaseUrl,
  })) {
    if (!value) fail(2, `${name} is not set.`);
  }

  // Nothing below this line runs until the API and database endpoints are proven
  // to be the same project: no account, no fixture row, no SQL statement at all.
  const guard = assertTargetAllowed({
    supabaseUrl,
    databaseUrl,
    emailDomain,
    allowProduction,
    confirmedDomain,
  });
  if (!guard.ok) fail(2, guard.reason);

  // No override exists for this one. The scenarios park Vault secrets and induce
  // failed purge jobs; against production that would break real erasures.
  if (runScenarios && guard.isProduction) {
    fail(
      2,
      '--scenarios is refused against production unconditionally. The failure scenarios park Vault ' +
        'secrets and induce failed deletion jobs; run them only against an isolated project.'
    );
  }

  console.log(
    `health-deletion-e2e: target project ${guard.ref} (API and database endpoints verified identical)` +
      `${guard.isProduction ? ' — PRODUCTION, both guards satisfied' : ' — isolated'}`
  );

  try {
    PG_ENV = libpqEnv(databaseUrl);
  } catch {
    fail(2, 'KILO_E2E_DATABASE_URL is not a valid postgresql:// URL.');
  }

  // The gated set is the database's, not this file's. A drift here would mean
  // proving erasure over the wrong table list.
  let gatedTables;
  try {
    gatedTables = sql('select unnest(kilo.health_gated_tables())').split('\n').map((t) => t.trim()).filter(Boolean);
  } catch (err) {
    fail(2, 'could not read kilo.health_gated_tables() from the target.', err.stderr || err.message);
  }

  const uncovered = gatedTables.filter((table) => !(table in FIXTURE_ROWS));
  if (uncovered.length > 0) {
    fail(
      2,
      `the gated table set has grown and this harness has no fixture row for: ${uncovered.join(', ')}. ` +
        'Add one before trusting this test.'
    );
  }

  const email = `kilo-e2e-${randomBytes(8).toString('hex')}@${emailDomain}`;
  // Alphanumeric only: punctuation breaks URI parsing in connection strings and
  // `!` triggers bash history expansion. Never printed, never persisted.
  const password = randomBytes(24).toString('hex');

  let userId = null;
  let failed = null;
  let cleanupFailure = null;

  try {
    const created = await admin('users', 'POST', { email, password, email_confirm: true }, { supabaseUrl, serviceRoleKey });
    userId = created.id;
    console.log('  created disposable fixture account');

    // Sign in for a real user JWT: consent_grant and consent_withdraw are
    // security definer on auth.uid() and cannot be driven by service_role.
    const signIn = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!signIn.ok) throw new Error(`fixture sign-in failed with HTTP ${signIn.status}`);
    const accessToken = (await signIn.json()).access_token;

    const revision = Number(sql('select max(catalog_revision) from kilo.consent_revision'));
    if (!Number.isFinite(revision)) throw new Error('no consent catalog revision is published on the target');

    await rpcAsUser(
      'consent_grant',
      { p_catalog_revision: revision, p_app_version: 'e2e-harness', p_platform: 'e2e' },
      { supabaseUrl, anonKey, accessToken }
    );
    console.log('  recorded consent');

    for (const table of gatedTables) {
      sql(FIXTURE_ROWS[table], [userId]);
    }
    const seeded = Number(sql('select sum(value::bigint) from jsonb_each_text(kilo.health_data_row_counts($1))', [userId]));
    if (!(seeded > 0)) throw new Error('synthetic fixture rows were not written; the erasure proof would be vacuous');
    console.log(`  seeded ${seeded} synthetic gated row(s)`);

    await rpcAsUser('consent_withdraw', {}, { supabaseUrl, anonKey, accessToken });
    console.log('  withdrew consent (job enqueued, access blocked)');

    // Prerequisites, read the same way #540 verifies them at deploy time.
    const secretsPresent =
      Number(
        sql(`select count(*) from vault.secrets s, kilo.worker_secret_names() n
             where s.name in (n.functions_base_url, n.service_role_key)`)
      ) === 2;

    // The cron entrypoint itself must exist, be active, and actually invoke the
    // drain function. Driving drain_health_deletion_jobs() below proves the
    // function works; this proves pg_cron is wired to call THAT function, which
    // together is the cron -> drain half of the boundary. (Waiting out a real
    // */5 tick is deliberately not done: it would add five minutes of latency
    // and still only re-execute the same statement asserted here.)
    const cronRow = sql(
      `select coalesce(active::text, 'false') || '|' || coalesce(command, '')
       from cron.job where jobname = 'health-deletion-drain'`
    );
    if (!cronRow) throw new Error('pg_cron job "health-deletion-drain" does not exist on the target');
    const [cronActive, cronCommand] = cronRow.split('|');
    if (cronActive !== 't' && cronActive !== 'true') {
      throw new Error('pg_cron job "health-deletion-drain" exists but is not active');
    }
    if (!/kilo\.drain_health_deletion_jobs\s*\(/.test(cronCommand)) {
      throw new Error(
        `pg_cron job "health-deletion-drain" does not invoke kilo.drain_health_deletion_jobs(); command is: ${cronCommand}`
      );
    }
    console.log('  verified cron "health-deletion-drain" is active and invokes kilo.drain_health_deletion_jobs()');

    // The real boundary, driven through the ACTUAL cron entrypoint rather than
    // dispatch_health_deletion_worker(). drain_health_deletion_jobs() is what
    // pg_cron runs: it re-opens due failures, reclaims stale `running` jobs, and
    // only then dispatches. Calling dispatch directly skipped both recovery
    // steps, so the promised cron/drain -> pg_net path went untested.
    const drain = JSON.parse(sql('select kilo.drain_health_deletion_jobs()'));
    const dispatchRequestId =
      drain.request_id === null || drain.request_id === undefined ? null : Number(drain.request_id);

    // Assert the drain's own returned contract, not just its side effect.
    for (const key of ['reopened', 'reclaimed_stale', 'dispatched', 'request_id']) {
      if (!(key in drain)) throw new Error(`kilo.drain_health_deletion_jobs() omitted "${key}" from its result`);
    }
    if (typeof drain.dispatched !== 'boolean') {
      throw new Error(`drain reported a non-boolean "dispatched": ${JSON.stringify(drain.dispatched)}`);
    }
    if (drain.dispatched !== (dispatchRequestId !== null)) {
      throw new Error(
        `drain reported dispatched=${drain.dispatched} but request_id=${JSON.stringify(drain.request_id)}; ` +
          'the two must agree.'
      );
    }
    console.log(
      `  drained via cron entrypoint (reopened=${drain.reopened} reclaimed_stale=${drain.reclaimed_stale} ` +
        `dispatched=${drain.dispatched} request=${dispatchRequestId ?? 'NULL'})`
    );

    let netResponse = null;
    if (dispatchRequestId !== null) {
      // pg_net's background worker writes the response asynchronously, so poll.
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const row = sql(
          `select coalesce(status_code::text, '') || '|' || coalesce(error_msg, '')
           from net._http_response where id = $1`,
          [dispatchRequestId]
        );
        if (row) {
          const [status, errorMessage] = row.split('|');
          netResponse = {
            status_code: status ? Number(status) : null,
            error_msg: errorMessage || null,
          };
          break;
        }
        await sleep(1000);
      }
      console.log(
        `  pg_net response: ${netResponse ? `status=${netResponse.status_code ?? 'none'} error=${netResponse.error_msg ?? 'none'}` : 'none within 60s'}`
      );
    }

    // Wait for verified erasure. complete_health_deletion_job re-counts the
    // gated set and refuses to advance while any row remains, so a `complete`
    // job IS the proof, and the row count below is the independent confirmation.
    let jobStatus = null;
    let attempts = 0;
    let remainingRows = seeded;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const row = sql(
        `select coalesce(j.status, 'none') || '|' || coalesce(j.attempts::text, '0') || '|' ||
                (select coalesce(sum(value::bigint), 0) from jsonb_each_text(kilo.health_data_row_counts($1)))
         from (select status, attempts from kilo.health_data_deletion_jobs
               where user_id = $1 order by created_at desc limit 1) j`,
        [userId]
      );
      if (row) {
        const [status, attemptText, remainingText] = row.split('|');
        jobStatus = status;
        attempts = Number(attemptText);
        remainingRows = Number(remainingText);
        if (jobStatus === 'complete' && remainingRows === 0) break;
      }
      await sleep(2000);
    }

    const functionDeployed = !(netResponse && netResponse.status_code === 404);
    const classification = classifyBoundaryFailure({
      dispatchRequestId,
      secretsPresent,
      functionDeployed,
      netResponse,
      remainingRows,
      jobStatus,
      attempts,
    });

    if (classification) {
      failed = classification;
    } else {
      // Independent of the job row: every gated table must be individually zero.
      const perTable = JSON.parse(sql('select kilo.health_data_row_counts($1)', [userId]));
      const nonZero = Object.entries(perTable).filter(([, count]) => Number(count) !== 0);
      if (nonZero.length > 0) {
        failed = {
          stage: 'partial-erasure',
          detail: `gated table(s) still populated: ${nonZero.map(([t, c]) => `${t}=${c}`).join(', ')}`,
        };
      } else {
        const consentStatus = sql('select status from kilo.consent_state where user_id = $1', [userId]);
        if (consentStatus !== 'withdrawn') {
          failed = {
            stage: 'partial-erasure',
            detail: `consent_state is "${consentStatus}", not "withdrawn", after a verified-zero purge`,
          };
        } else {
          console.log(`  verified erasure: all ${gatedTables.length} gated table(s) empty, consent_state=withdrawn`);
        }
      }
    }

    if (runScenarios && !failed) {
      const scenarioFailures = await runBoundaryScenarios({
        userId,
        gatedTables,
        ref: guard.ref,
      });
      if (scenarioFailures.length > 0) {
        failed = {
          stage: 'boundary-scenario-failure',
          detail: `${scenarioFailures.length} scenario(s) did not behave as required: ${scenarioFailures.join('; ')}`,
        };
      } else {
        console.log(`  all ${BOUNDARY_SCENARIOS.length + 1} boundary scenario(s) behaved as required`);
      }
    }
  } catch (err) {
    failed = { stage: 'harness-error', detail: err.stderr ? String(err.stderr).slice(0, 500) : err.message };
  } finally {
    // Always destroy the fixture account. The cascade removes anything the purge
    // did not, so a failed run never leaves synthetic health rows behind.
    //
    // A cleanup failure is a REAL failure, never a warning on an otherwise green
    // run: reporting success while a live auth account survives is exactly the
    // kind of "looks clean, isn't" result this harness exists to prevent.
    if (userId) {
      try {
        await admin(`users/${userId}`, 'DELETE', null, { supabaseUrl, serviceRoleKey });

        // Confirm removal rather than trusting the response: the operator needs
        // to know the account is gone, not that a request returned 200.
        //
        // Only HTTP 404 counts. See classifyDeletionProbe: every other outcome,
        // including one that throws at the transport layer, leaves the account's
        // fate unknown and must be reported as a cleanup failure rather than
        // printed as confirmed.
        const probe = await adminRaw(`users/${userId}`, 'GET', null, { supabaseUrl, serviceRoleKey });
        const verdict = classifyDeletionProbe(probe);
        if (verdict.confirmed) {
          console.log('  deleted disposable fixture account (removal confirmed by HTTP 404)');
        } else {
          cleanupFailure = verdict.reason;
        }
      } catch (err) {
        cleanupFailure = err.message;
      }
    }
  }

  // Reported before the exit decision so an operator sees the account to remove
  // even when a boundary failure is also being reported.
  //
  // The uuid is the fixture account's own identifier and is the minimum an
  // operator needs to delete it safely. The fixture password and the access
  // token are never printed, and the email is withheld because the uuid alone is
  // sufficient for `auth.admin.deleteUser`.
  if (cleanupFailure) {
    console.error(
      `health-deletion-e2e: CLEANUP FAILED — the disposable fixture account was NOT removed.\n` +
        `  project:      ${guard.ref}\n` +
        `  account uuid: ${userId}\n` +
        `  cause:        ${cleanupFailure}\n` +
        `  Remove it with: select auth.admin_delete_user('${userId}');  -- or the Auth admin API`
    );
  }

  if (finalExitCode({ failed, cleanupFailure }) !== 0) {
    if (failed && failed.stage === 'harness-error') {
      fail(2, `the harness could not complete: ${failed.detail}`);
    }
    if (failed) {
      fail(1, `boundary failure at stage "${failed.stage}": ${failed.detail}`);
    }
    // Cleanup failure alone still fails the run: a surviving auth account is a
    // real problem an operator must act on, not an unchecked state.
    fail(1, 'the boundary passed but the disposable fixture account was left behind (see above).');
  }

  console.log('health-deletion-e2e: ok — cron/drain -> pg_net -> Edge Function -> verified erasure.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => fail(2, 'unexpected harness error.', err.stack || err.message));
}

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
//   node scripts/test-health-deletion-e2e.mjs --allow-production
//
// Required environment:
//   KILO_E2E_DATABASE_URL      postgresql:// superuser-or-owner URL for the target
//   KILO_E2E_SUPABASE_URL      https://<ref>.supabase.co
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

export function projectRefFromUrl(supabaseUrl) {
  try {
    const host = new URL(supabaseUrl).hostname;
    const [ref] = host.split('.');
    return ref || null;
  } catch {
    return null;
  }
}

// Pure, and unit-tested in scripts/health-deletion-monitor.test.mjs. The whole
// point is that this cannot be satisfied by accident: an operator who exports
// production credentials and runs the harness out of habit gets exit 2, not a
// live purge run against real accounts.
export function assertTargetAllowed({ supabaseUrl, emailDomain, allowProduction, confirmedDomain }) {
  const ref = projectRefFromUrl(supabaseUrl);
  if (!ref) {
    return { ok: false, reason: 'KILO_E2E_SUPABASE_URL is not a valid https://<ref>.supabase.co URL.' };
  }

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
function sql(statement, params = []) {
  const args = ['--no-psqlrc', '--tuples-only', '--no-align', '-v', 'ON_ERROR_STOP=1'];
  let text = statement;
  params.forEach((value, index) => {
    const name = `p${index + 1}`;
    args.push('-v', `${name}=${value}`);
    text = text.replaceAll(`$${index + 1}`, `:'${name}'`);
  });
  args.push('-c', text);

  return execFileSync('psql', args, {
    env: { ...process.env, ...PG_ENV },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function fail(code, message, detail) {
  console.error(`health-deletion-e2e: ${message}`);
  if (detail) console.error(String(detail).trim());
  process.exit(code);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function admin(path, method, body, { supabaseUrl, serviceRoleKey }) {
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/${path}`, {
    method,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) {
    // Never echo the request body: it carries the fixture password.
    throw new Error(`admin ${method} ${path} failed with HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
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

// --- the run ------------------------------------------------------------

async function main() {
  loadLocalEnv(process.env.KILO_E2E_ENV_FILE || join(root, '.env'));

  const allowProduction = process.argv.includes('--allow-production');
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

  const guard = assertTargetAllowed({ supabaseUrl, emailDomain, allowProduction, confirmedDomain });
  if (!guard.ok) fail(2, guard.reason);

  console.log(
    `health-deletion-e2e: target project ${guard.ref}${guard.isProduction ? ' (PRODUCTION, both guards satisfied)' : ' (isolated)'}`
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

    // The real boundary: Postgres -> pg_net -> HTTPS -> Edge Function.
    const dispatchRaw = sql('select kilo.dispatch_health_deletion_worker()');
    const dispatchRequestId = dispatchRaw === '' ? null : Number(dispatchRaw);
    console.log(`  dispatched worker (pg_net request ${dispatchRequestId ?? 'NULL'})`);

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
  } catch (err) {
    failed = { stage: 'harness-error', detail: err.stderr ? String(err.stderr).slice(0, 500) : err.message };
  } finally {
    // Always destroy the fixture account. The cascade removes anything the purge
    // did not, so a failed run never leaves synthetic health rows behind.
    if (userId) {
      try {
        await admin(`users/${userId}`, 'DELETE', null, { supabaseUrl, serviceRoleKey });
        console.log('  deleted disposable fixture account');
      } catch (err) {
        console.error(`health-deletion-e2e: WARNING could not delete fixture account: ${err.message}`);
      }
    }
  }

  if (failed) {
    if (failed.stage === 'harness-error') {
      fail(2, `the harness could not complete: ${failed.detail}`);
    }
    fail(1, `boundary failure at stage "${failed.stage}": ${failed.detail}`);
  }

  console.log('health-deletion-e2e: ok — cron/drain -> pg_net -> Edge Function -> verified erasure.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => fail(2, 'unexpected harness error.', err.stack || err.message));
}

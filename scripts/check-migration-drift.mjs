#!/usr/bin/env node
// Fails when a migration committed to supabase/migrations/ was never applied to
// the linked Supabase project.
//
// A migration can be written, reviewed, merged, and still never reach the
// database. #451's rate-limit prune sat unapplied on main for days: pg_cron was
// never installed, the prune never ran, and the retention promise published in
// the privacy policy was false the whole time. Nothing in the repo could see it,
// because the repo only knows what was merged, not what was deployed.
//
// #490 made the same gap fatal in production: three merged migrations were
// never applied, and the code depending on them shipped anyway. Two defects
// let that happen. First, this script never loaded the repo's local
// environment, so `npm run check:migrations` only worked when
// SUPABASE_MIGRATION_CHECK_URL was already exported in the shell -- the
// documented local command exited before checking anything. Second, the
// GitHub Actions job ran only on push to main, i.e. after merge, which is why
// the drift was detected only once it was already live. Both are fixed here;
// see .github/workflows/migration-drift.yml for the pre-merge gate design.
//
// Usage:
//   node scripts/check-migration-drift.mjs
//   SUPABASE_MIGRATION_CHECK_URL=postgresql://... node scripts/check-migration-drift.mjs
//   node scripts/check-migration-drift.mjs --self-test
//
// A `.env` file at the repo root is loaded automatically if present (see
// loadLocalEnv below). An already-exported environment variable always wins
// over a value loaded from that file.
//
// Exit codes:
//   0  every merged migration is applied
//   1  drift: at least one merged migration is missing from the live project
//   2  the check could not run (no credentials, bad URL, database unreachable)
//
// Codes 1 and 2 are distinct on purpose. A check that cannot tell "no drift"
// apart from "never ran" would go green while detecting nothing, which is the
// exact failure this script exists to prevent.

import { readdirSync, existsSync, readFileSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const SELF_TEST = process.argv.includes('--self-test');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const MIGRATIONS_DIR = join(root, 'supabase', 'migrations');

// The ledger Supabase writes on every applied migration. `name` is nullable, so
// unnamed rows are excluded rather than compared as empty strings.
const LEDGER_QUERY =
  'select name from supabase_migrations.schema_migrations where name is not null';

function abort(code, message, detail) {
  console.error(`migration-drift: ${message}`);
  if (detail) console.error(detail.trim());
  process.exit(code);
}

// Migration files are named <version>_<name>.sql and the ledger stores <name>.
//
// Compare by name, never by version. The versions in this project's ledger were
// re-stamped on the way in — supabase/migrations/20260615120000_note_first_schema.sql
// is recorded as version 20260615180805 — so comparing versions reports every
// migration as drifted.
function repoMigrations() {
  let files;
  try {
    files = readdirSync(MIGRATIONS_DIR);
  } catch (err) {
    abort(2, `cannot read ${MIGRATIONS_DIR}`, err.message);
  }

  return files
    .filter((file) => file.endsWith('.sql'))
    .map((file) => {
      const separator = file.indexOf('_');
      if (separator === -1) {
        abort(2, `migration filename is not <version>_<name>.sql: ${file}`);
      }
      return { file, name: file.slice(separator + 1, -'.sql'.length) };
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}

// Loads KEY=VALUE pairs from a local .env file, without ever overwriting a
// variable already present in process.env. This is what lets an explicit
// shell export (SUPABASE_MIGRATION_CHECK_URL=... npm run check:migrations)
// take precedence over whatever is on disk, matching dotenv's own precedence
// rule without adding a dependency for one file.
//
// Values are only ever written into process.env -- never logged, never
// echoed -- so a secret placed in the file cannot leak through this script's
// own output.
function loadLocalEnv(envPath) {
  if (!existsSync(envPath)) return;

  let contents;
  try {
    contents = readFileSync(envPath, 'utf8');
  } catch {
    return; // unreadable file is not fatal; treat as absent
  }

  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    if (!key || key in process.env) continue; // explicit export always wins

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

// Overridable only so the --self-test harness below can point at a disposable
// fixture file instead of a developer's real `.env`. Nothing else should set
// this.
const LOCAL_ENV_FILE = process.env.SUPABASE_MIGRATION_CHECK_ENV_FILE || join(root, '.env');

// Split the connection URL into libpq environment variables rather than passing
// it to psql as an argument. Two reasons, both load-bearing:
//
//   - The password never appears in argv, so it cannot surface in a child
//     process listing, in a crash message, or in a CI log.
//   - libpq takes the values verbatim, so punctuation in the password is not
//     re-parsed as URL syntax.
function libpqEnv(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    abort(2, 'SUPABASE_MIGRATION_CHECK_URL is not a valid URL (expected postgresql://user:password@host:port/database).');
  }

  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    abort(2, `SUPABASE_MIGRATION_CHECK_URL must be a postgresql:// URL, got ${url.protocol}//`);
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

function appliedMigrationNames(rawUrl) {
  let stdout;
  try {
    stdout = execFileSync('psql', ['--no-psqlrc', '--tuples-only', '--no-align', '-c', LEDGER_QUERY], {
      env: { ...process.env, ...libpqEnv(rawUrl) },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    // err.message would be "Command failed: psql ...". Report only psql's own
    // stderr, which describes the failure without echoing the command.
    abort(2, 'could not read the migration ledger from the live project.', err.stderr || err.stdout);
  }

  const names = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  // A reachable project always has migrations applied. An empty ledger means we
  // queried something other than what we think we did — treat it as a failure to
  // run, never as "nothing is missing".
  if (names.length === 0) {
    abort(2, 'the migration ledger came back empty, which should be impossible. Refusing to report "no drift".');
  }

  return names;
}

function runCheck() {
  loadLocalEnv(LOCAL_ENV_FILE);

  const connectionUrl = process.env.SUPABASE_MIGRATION_CHECK_URL;
  if (!connectionUrl) {
    abort(2, 'SUPABASE_MIGRATION_CHECK_URL is not set. Refusing to report "no drift" without reading the database.');
  }

  const repo = repoMigrations();
  const applied = new Set(appliedMigrationNames(connectionUrl));

  // Keyed lookup, so this stays O(repo + applied) rather than a nested scan.
  //
  // One-directional by design: a migration applied to the project but absent from
  // this repo is NOT drift. The Supabase project is intentionally shared with
  // another app, whose migrations land in the same ledger.
  const missing = repo.filter((migration) => !applied.has(migration.name));

  if (missing.length > 0) {
    console.error(
      `migration-drift: ${missing.length} merged migration(s) have never been applied to the live project:\n`
    );
    for (const migration of missing) {
      console.error(`  supabase/migrations/${migration.file}`);
    }
    console.error('\nApply them before merging. Merged is not deployed.');
    process.exit(1);
  }

  console.log(
    `migration-drift: ok — all ${repo.length} merged migration(s) are applied ` +
      `(${applied.size} migrations in the ledger; extras belong to the co-tenant app and are not drift).`
  );
}

// --- --self-test harness -----------------------------------------------
//
// Deterministic regression coverage for env-loading precedence and the
// exit-code contract, with no dependency on a real database and no test
// framework beyond node:assert (the repo root has no active test runner; see
// docs/testing-and-qa.md). Everything here runs against disposable temp-dir
// fixtures and a stub `psql` -- never a real connection, never a real secret.

function writeStubPsql(dir) {
  const stubPath = join(dir, 'psql');
  writeFileSync(
    stubPath,
    `#!/usr/bin/env node
const fs = require('fs');
const captureFile = process.env.STUB_PSQL_CAPTURE_FILE;
if (captureFile) {
  fs.writeFileSync(captureFile, JSON.stringify({ argv: process.argv.slice(2), env: process.env }, null, 2));
}
if (process.env.STUB_PSQL_MODE === 'fail') {
  process.stderr.write('stub psql: simulated connection failure\\n');
  process.exit(1);
}
const names = (process.env.STUB_PSQL_NAMES || '').split('\\n').filter(Boolean);
process.stdout.write(names.map((n) => ' ' + n).join('\\n') + (names.length ? '\\n' : ''));
process.exit(0);
`
  );
  chmodSync(stubPath, 0o755);
  return stubPath;
}

function runScript(env, captureFile) {
  const cleanEnv = { ...env, PATH: `${env.STUB_DIR}:${process.env.PATH}` };
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT_PATH], {
      env: cleanEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '', captured: readCapture(captureFile) };
  } catch (err) {
    return {
      status: err.status,
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      captured: readCapture(captureFile),
    };
  }
}

function readCapture(captureFile) {
  if (!captureFile || !existsSync(captureFile)) return null;
  return JSON.parse(readFileSync(captureFile, 'utf8'));
}

function runSelfTest() {
  const results = [];
  const record = (name, fn) => {
    try {
      fn();
      results.push({ name, ok: true });
    } catch (err) {
      results.push({ name, ok: false, error: err.message });
    }
  };

  const workDir = mkdtempSync(join(tmpdir(), 'migration-drift-selftest-'));
  const stubDir = mkdtempSync(join(tmpdir(), 'migration-drift-stubpsql-'));

  try {
    writeStubPsql(stubDir);
    const repoNames = repoMigrations().map((m) => m.name);
    assert.ok(repoNames.length > 0, 'expected at least one real migration to test against');

    const FAKE_FILE_SECRET = 'file-secret-do-not-connect';
    const FAKE_SHELL_SECRET = 'shell-secret-do-not-connect';
    const envFixture = join(workDir, 'fixture.env');
    writeFileSync(
      envFixture,
      `SUPABASE_MIGRATION_CHECK_URL=postgresql://fileuser:${FAKE_FILE_SECRET}@example.invalid:5432/db_file\n`
    );

    const baseEnv = () => ({
      STUB_DIR: stubDir,
      SUPABASE_MIGRATION_CHECK_ENV_FILE: envFixture,
    });

    // 1. No explicit env var, no env file at all (nonexistent path) -> exit 2,
    //    and it must not have tried to run psql at all.
    record('exit 2 when no credentials are available (mocked/no-secret path)', () => {
      const captureFile = join(workDir, 'capture-nocred.json');
      const result = runScript(
        {
          STUB_DIR: stubDir,
          SUPABASE_MIGRATION_CHECK_ENV_FILE: join(workDir, 'does-not-exist.env'),
          STUB_PSQL_MODE: 'ok',
          STUB_PSQL_NAMES: repoNames.join('\n'),
          STUB_PSQL_CAPTURE_FILE: captureFile,
        },
        captureFile
      );
      assert.equal(result.status, 2, `expected exit 2, got ${result.status}`);
      assert.equal(result.captured, null, 'psql must never be invoked without credentials');
    });

    // 2. Value loaded from the local env file (locally-loaded credential path).
    record('loads SUPABASE_MIGRATION_CHECK_URL from local env file when unset', () => {
      const captureFile = join(workDir, 'capture-fromfile.json');
      const result = runScript(
        {
          ...baseEnv(),
          STUB_PSQL_MODE: 'ok',
          STUB_PSQL_NAMES: repoNames.join('\n'),
          STUB_PSQL_CAPTURE_FILE: captureFile,
        },
        captureFile
      );
      assert.equal(result.status, 0, `expected exit 0, got ${result.status}. stderr: ${result.stderr}`);
      assert.ok(result.captured, 'expected the stub psql to have been invoked');
      assert.equal(result.captured.env.PGUSER, 'fileuser', 'expected PGUSER sourced from the env file');
      assert.equal(result.captured.env.PGPASSWORD, FAKE_FILE_SECRET);
      assertNoSecretLeak(result, [FAKE_FILE_SECRET]);
    });

    // 3. Explicit export takes precedence over the same env file.
    record('explicit SUPABASE_MIGRATION_CHECK_URL wins over the local env file', () => {
      const captureFile = join(workDir, 'capture-precedence.json');
      const result = runScript(
        {
          ...baseEnv(),
          SUPABASE_MIGRATION_CHECK_URL: `postgresql://shelluser:${FAKE_SHELL_SECRET}@example.invalid:5432/db_shell`,
          STUB_PSQL_MODE: 'ok',
          STUB_PSQL_NAMES: repoNames.join('\n'),
          STUB_PSQL_CAPTURE_FILE: captureFile,
        },
        captureFile
      );
      assert.equal(result.status, 0, `expected exit 0, got ${result.status}. stderr: ${result.stderr}`);
      assert.equal(result.captured.env.PGUSER, 'shelluser', 'explicit export must win over the env file');
      assert.equal(result.captured.env.PGPASSWORD, FAKE_SHELL_SECRET);
      assertNoSecretLeak(result, [FAKE_SHELL_SECRET, FAKE_FILE_SECRET]);
    });

    // 4. Drift detected -> exit 1.
    record('exit 1 when a merged migration is missing from the ledger', () => {
      const captureFile = join(workDir, 'capture-drift.json');
      const missingOne = repoNames.slice(1); // drop the first repo migration from the "ledger"
      const result = runScript(
        {
          ...baseEnv(),
          STUB_PSQL_MODE: 'ok',
          STUB_PSQL_NAMES: missingOne.join('\n'),
          STUB_PSQL_CAPTURE_FILE: captureFile,
        },
        captureFile
      );
      assert.equal(result.status, 1, `expected exit 1, got ${result.status}`);
      assert.ok(result.stderr.includes(repoNames[0]), 'expected the missing migration to be named in stderr');
    });

    // 5. Connection failure -> exit 2, not a false pass.
    record('exit 2 when psql fails (unreachable/misconfigured)', () => {
      const captureFile = join(workDir, 'capture-fail.json');
      const result = runScript(
        {
          ...baseEnv(),
          STUB_PSQL_MODE: 'fail',
          STUB_PSQL_CAPTURE_FILE: captureFile,
        },
        captureFile
      );
      assert.equal(result.status, 2, `expected exit 2, got ${result.status}`);
    });

    function assertNoSecretLeak(result, secrets) {
      const argv = result.captured.argv.join(' ');
      for (const secret of secrets) {
        assert.ok(!argv.includes(secret), `secret leaked into psql argv: ${argv}`);
        assert.ok(!result.stdout.includes(secret), 'secret leaked into check-migration-drift stdout');
        assert.ok(!result.stderr.includes(secret), 'secret leaked into check-migration-drift stderr');
      }
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
    rmSync(stubDir, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? 'ok' : 'FAIL'} - ${r.name}${r.ok ? '' : `\n     ${r.error}`}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} self-tests passed.`);
  process.exit(failed.length > 0 ? 1 : 0);
}

if (SELF_TEST) {
  runSelfTest();
} else {
  runCheck();
}

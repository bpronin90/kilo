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
// Usage:
//   SUPABASE_MIGRATION_CHECK_URL=postgresql://... node scripts/check-migration-drift.mjs
//
// Exit codes:
//   0  every merged migration is applied
//   1  drift: at least one merged migration is missing from the live project
//   2  the check could not run (no credentials, bad URL, database unreachable)
//
// Codes 1 and 2 are distinct on purpose. A check that cannot tell "no drift"
// apart from "never ran" would go green while detecting nothing, which is the
// exact failure this script exists to prevent.

import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
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

// Contract tests for the shared health-data scope (issue #487).
//
// These exist to make one specific bug impossible: a gated table that is added in
// one place and forgotten in another. When that happens, nothing crashes and no
// test fails — Kilo just quietly under-deletes health data after a user withdraws
// consent, or hands them an incomplete export. Both are compliance failures that
// only surface when someone audits the data months later.
//
// So the rule is enforced structurally, in four directions:
//
//   1. The set contains exactly the seven gated tables, no more, no fewer.
//   2. account-export, account-delete, and health-data-delete all IMPORT this
//      module and none of them keeps its own health-table list.
//   3. The database's kilo.health_gated_tables() names the same seven tables.
//   4. Every read and delete in this module is filtered to a single user_id.
//
// Run:  deno test --allow-read supabase/functions/_shared/health-data-scope.test.ts

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  HEALTH_DATA_SCOPE,
  LEGACY_HEALTH_COLUMNS,
  UNGATED_FEATURE_PREFERENCES,
  healthTableNames,
} from './health-data-scope.ts'

// The seven tables that hold data concerning health, per
// docs/article-9-explicit-consent-spec.md § "Authoritative health-data boundary".
// Written out literally rather than derived, so a change to the scope module can
// never quietly change what this test considers correct.
const EXPECTED_GATED_TABLES = [
  'archived_weight_goals',
  'deload_history',
  'fatigue_checkins',
  'user_health_profile',
  'weight_entries',
  'weight_goal',
  'workout_notes',
].sort()

const EXPECTED_LEGACY_COLUMNS = [
  'current_deload_note_raw_text',
  'current_deload_note_saved_at',
  'current_deload_note_updated_at',
  'current_workout_note_id',
  'fatigue_multiplier',
  'tracked_lifts',
].sort()

const CONSUMERS = [
  '../account-export/index.ts',
  '../account-delete/index.ts',
  '../health-data-delete/index.ts',
]

function readFunctionSource(relativePath: string): string {
  return Deno.readTextFileSync(new URL(relativePath, import.meta.url))
}

Deno.test('gated set is exactly the seven health tables', () => {
  assertEquals([...healthTableNames()].sort(), EXPECTED_GATED_TABLES)
})

Deno.test('gated set omits no table and adds none', () => {
  // Stated separately from the equality check above so a failure says WHICH
  // direction broke: an omission under-deletes, an addition over-deletes.
  for (const table of EXPECTED_GATED_TABLES) {
    assert(
      healthTableNames().includes(table),
      `gated table "${table}" is missing from HEALTH_DATA_SCOPE: withdrawal would not erase it`,
    )
  }
  for (const table of healthTableNames()) {
    assert(
      EXPECTED_GATED_TABLES.includes(table),
      `"${table}" is in HEALTH_DATA_SCOPE but is not a known gated table`,
    )
  }
})

Deno.test('deletion order is total and deterministic', () => {
  const orders = HEALTH_DATA_SCOPE.map((d) => d.deleteOrder)
  assertEquals(
    new Set(orders).size,
    orders.length,
    'two descriptors share a deleteOrder, so a partial purge would not retry identically',
  )
})

Deno.test('the six legacy user_profile health columns are covered', () => {
  assertEquals([...LEGACY_HEALTH_COLUMNS].sort(), EXPECTED_LEGACY_COLUMNS)
})

Deno.test('ungated feature preferences are not treated as health data', () => {
  // fatigue_tracking_enabled and deload_mode_enabled reveal that a feature is
  // used, not any measurement. Withdrawal must NOT delete them, so they must
  // never appear in the gated set.
  const gated = new Set(healthTableNames())
  assert(!gated.has('feature_toggles'), 'feature_toggles is an ungated preference table')
  assertEquals(UNGATED_FEATURE_PREFERENCES.length, 2)
})

Deno.test('all three consumers import the shared scope', () => {
  for (const consumer of CONSUMERS) {
    const src = readFunctionSource(consumer)
    assert(
      /from '\.\.\/_shared\/health-data-scope\.ts'/.test(src),
      `${consumer} does not import _shared/health-data-scope.ts`,
    )
  }
})

Deno.test('no consumer keeps its own health-table list', () => {
  // The failure this catches: someone adds a table to the shared scope but a
  // consumer still walks a hardcoded array it defined years ago. A consumer may
  // name a gated table at most once (in a comment or an unrelated read); what it
  // may not do is enumerate several of them, which is what an independent list
  // looks like.
  const gated = healthTableNames()

  for (const consumer of CONSUMERS) {
    const src = readFunctionSource(consumer)
    const enumerated = gated.filter((t) => {
      // A literal string reference, e.g. .from('weight_entries').
      const literal = new RegExp(`['"\`]${t}['"\`]`)
      return literal.test(src)
    })

    assert(
      enumerated.length <= 1,
      `${consumer} enumerates gated tables directly (${enumerated.join(', ')}); ` +
        `it must resolve them through HEALTH_DATA_SCOPE instead`,
    )
  }
})

Deno.test('database gated-table list matches the module', () => {
  // kilo.health_gated_tables() is the SQL half of the same contract: it is what
  // kilo.complete_health_deletion_job() re-counts before allowing
  // deletion_pending -> withdrawn. If the two lists drift, the database would
  // certify a purge complete while a table the Edge Function never touched still
  // holds the user's health data.
  const sql = Deno.readTextFileSync(
    new URL('../../migrations/20260714120002_health_deletion_jobs.sql', import.meta.url),
  )

  const fnStart = sql.indexOf('create or replace function kilo.health_gated_tables()')
  assert(fnStart > -1, 'kilo.health_gated_tables() not found in the migration')

  const body = sql.slice(fnStart, sql.indexOf('$$;', fnStart))
  const arrayMatch = body.match(/select array\[([\s\S]*?)\]::text\[\]/)
  assert(arrayMatch, 'could not parse the table array out of kilo.health_gated_tables()')

  const sqlTables = [...arrayMatch[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()

  assertEquals(
    sqlTables,
    EXPECTED_GATED_TABLES,
    'kilo.health_gated_tables() and HEALTH_DATA_SCOPE disagree',
  )
})

Deno.test('every health statement is scoped to one user_id', () => {
  // The shared module reaches past the consent gate with a service-role client.
  // That is safe only because every statement it issues is bound to one user id.
  // A read or delete that lost its .eq('user_id', ...) would silently operate on
  // the entire table — every user's health data at once.
  const src = readFunctionSource('./health-data-scope.ts')

  const statements = [...src.matchAll(/admin\s*\n?\s*\.from\([^)]*\)([\s\S]*?)(?=\n\s*(?:const|return|\}))/g)]
  assert(statements.length > 0, 'no admin.from(...) statements found to check')

  for (const [stmt] of statements) {
    assert(
      /\.eq\('user_id', userId\)/.test(stmt),
      `a service-role statement is not filtered to one user_id:\n${stmt.trim()}`,
    )
  }
})

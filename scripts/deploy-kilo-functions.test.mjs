import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = new URL('..', import.meta.url).pathname;
const scriptPath = join(repoRoot, 'scripts/deploy-kilo-functions.sh');
const projectRef = 'ogzhnscdqcdrhfqcobuv';
const requiredFunctions = ['account-export', 'account-delete', 'health-data-delete', 'android-restore-credentials'];
const activeFunctions = requiredFunctions.map((slug) => ({
  slug,
  status: 'ACTIVE',
  updated_at: '9999-01-01T00:00:00Z',
}));
// The management plane returns a digest beside each name; it must never be echoed.
const secretDigest = 'secret-digest-must-not-appear';
const evidenceSecrets = ['KILO_EVIDENCE_KEY', 'KILO_EVIDENCE_KEY_ID'].map((name) => ({ name, value: secretDigest }));
const presentSecrets = [{ name: 'SUPABASE_URL', value: secretDigest }, ...evidenceSecrets];

function writeExecutable(path, source) {
  writeFileSync(path, source, { mode: 0o755 });
  chmodSync(path, 0o755);
}

function run({ functions = activeFunctions, secrets = JSON.stringify(presentSecrets), secretsListFails = false, vault = 'present', cron = 'active', dispatch = 'dispatched', fixture, databaseUrl = 'postgres://operator:credential-must-not-appear@example.test/kilo' } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'kilo-deploy-test-'));
  const binDirectory = join(directory, 'bin');
  mkdirSync(binDirectory);

  try {
    writeExecutable(join(binDirectory, 'npx'), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$CALL_LOG"
expected='--project-ref ${projectRef}'
[[ " $* " == *" $expected "* ]] || exit 90
if [[ "$*" == *' functions list '* ]]; then
  printf '%s\\n' "$FUNCTIONS_JSON"
elif [[ "$*" == *' secrets list '* ]]; then
  [[ -z "\${SECRETS_LIST_FAILS:-}" ]] || exit 1
  printf '%s\\n' "$SECRETS_JSON"
elif [[ "$*" == *' functions deploy '* ]]; then
  :
else
  exit 91
fi
`);
    writeExecutable(join(binDirectory, 'psql'), `#!/usr/bin/env bash
set -euo pipefail
input="$(cat)"
printf '%s\\n' "$input" >> "$PSQL_LOG"
if [[ "$input" == *'dispatch_health_deletion_worker'* ]]; then
  printf '%s\\n' "$DISPATCH_STATUS"
elif [[ "$input" == *'from vault.secrets'* ]]; then
  printf '%s\\n' "$VAULT_STATUS"
else
  printf '%s\\n' "$CRON_STATUS"
fi
`);

    const callLog = join(directory, 'calls.log');
    const psqlLog = join(directory, 'psql.log');
    const result = spawnSync('bash', [scriptPath], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDirectory}:${process.env.PATH}`,
        CALL_LOG: callLog,
        PSQL_LOG: psqlLog,
        FUNCTIONS_JSON: JSON.stringify(functions),
        SECRETS_JSON: secrets,
        ...(secretsListFails ? { SECRETS_LIST_FAILS: '1' } : {}),
        VAULT_STATUS: vault,
        CRON_STATUS: cron,
        DISPATCH_STATUS: dispatch,
        KILO_DATABASE_URL: databaseUrl,
        ...(fixture ? { HEALTH_DELETION_FIXTURE_USER_ID: fixture } : {}),
      },
    });
    const output = `${result.stdout}${result.stderr}`;
    const calls = (() => {
      try { return readFileSync(callLog, 'utf8'); } catch { return ''; }
    })();
    return { result, output, calls };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function expectFailure(options, message) {
  const { result, output, calls } = run(options);
  assert.notEqual(result.status, 0, output);
  assert.match(output, message);
  assert.doesNotMatch(output, /Deployment verification complete\./);
  assert.doesNotMatch(output, new RegExp(secretDigest));
  return { output, calls };
}

// Evidence-secret preflight failures must stop before any function deploy.
function expectPreflightFailure(options, message) {
  const { output, calls } = expectFailure(options, message);
  assert.doesNotMatch(calls, /functions deploy/);
  assert.doesNotMatch(output, /Deploying kilo functions/);
}

{
  const { result, output, calls } = run();
  assert.equal(result.status, 0, output);
  assert.match(output, /Deployment verification complete\./);
  assert.match(output, /Skipping worker dispatch probe/);
  assert.doesNotMatch(output, /credential-must-not-appear/);
  for (const fn of requiredFunctions) {
    assert.match(calls, new RegExp(`functions deploy ${fn} --project-ref ${projectRef}`));
  }
  assert.match(calls, new RegExp(`functions list --project-ref ${projectRef} --output json`));
  assert.doesNotMatch(output, new RegExp(secretDigest));
  assert.match(calls, new RegExp(`secrets list --project-ref ${projectRef} --output json`));
  assert.doesNotMatch(calls, /secrets (set|unset)/);
  assert.ok(calls.indexOf('secrets list') < calls.indexOf('functions deploy'), 'secret names are checked before deploy');
}

const notProvisioned = /Consent-evidence Edge Function secrets are not provisioned/;
expectPreflightFailure({ secrets: JSON.stringify(presentSecrets.filter((s) => s.name !== 'KILO_EVIDENCE_KEY')) }, /secret is missing: KILO_EVIDENCE_KEY\./);
expectPreflightFailure({ secrets: JSON.stringify(presentSecrets.filter((s) => s.name !== 'KILO_EVIDENCE_KEY_ID')) }, /secret is missing: KILO_EVIDENCE_KEY_ID\./);
expectPreflightFailure({ secrets: JSON.stringify([{ name: 'SUPABASE_URL', value: secretDigest }]) }, /secret is missing: KILO_EVIDENCE_KEY, KILO_EVIDENCE_KEY_ID\./);
expectPreflightFailure({ secrets: '[]' }, notProvisioned);
expectPreflightFailure({ secretsListFails: true }, /Could not list Edge Function secret names/);
expectPreflightFailure({ secrets: 'not json' }, /secret list was not valid JSON/);
expectPreflightFailure({ secrets: JSON.stringify({ secrets: presentSecrets }) }, /not a list of named secrets/);
expectPreflightFailure({ secrets: JSON.stringify([...presentSecrets, { value: secretDigest }]) }, /not a list of named secrets/);
expectPreflightFailure({ secrets: JSON.stringify([...presentSecrets, null]) }, /not a list of named secrets/);

expectFailure({ functions: activeFunctions.slice(0, 2) }, /Required Edge Function is missing: health-data-delete/);
expectFailure({ functions: activeFunctions.slice(0, 3) }, /Required Edge Function is missing: android-restore-credentials/);
expectFailure({ functions: activeFunctions.map((fn) => fn.slug === 'account-delete' ? { ...fn, status: 'FAILED' } : fn) }, /not ACTIVE: account-delete/);
expectFailure({ functions: activeFunctions.map((fn) => fn.slug === 'account-export' ? { ...fn, updated_at: '2000-01-01T00:00:00Z' } : fn) }, /lacks current deployment evidence: account-export/);
expectFailure({ vault: 'missing' }, /Required health-deletion worker Vault secrets are missing/);
expectFailure({ cron: 'missing' }, /health-deletion-drain cron is missing or inactive/);
expectFailure({ fixture: '11111111-1111-4111-8111-111111111111', dispatch: 'not-dispatched' }, /Disposable fixture did not produce a health-deletion worker dispatch/);
expectFailure({ fixture: 'not-a-uuid' }, /HEALTH_DELETION_FIXTURE_USER_ID must be a UUID/);
expectFailure({ databaseUrl: '' }, /KILO_DATABASE_URL is required/);

console.log('deploy-kilo-functions tests passed');

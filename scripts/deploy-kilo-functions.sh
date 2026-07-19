#!/usr/bin/env bash
set -euo pipefail

# Deploy the kilo Edge Functions to the hosted Supabase project.
#
# Supplies --project-ref explicitly so this script works from a fresh
# checkout without first running `supabase link`. The remote target is
# therefore reproducible from tracked files alone.
#
# verify_jwt=false for all three functions is pinned in supabase/config.toml
# ([functions.account-export], [functions.account-delete], and
# [functions.health-data-delete]); the CLI reads that config during deploy
# so the setting cannot silently regress to the default of true.
#
# The unrelated anime function is not deployed by this script.

readonly PROJECT_REF="ogzhnscdqcdrhfqcobuv"
readonly FUNCTIONS=(account-export account-delete health-data-delete)

die() {
  echo "ERROR: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

verify_functions_active() {
  local functions_json

  functions_json="$(npx supabase functions list --project-ref "${PROJECT_REF}" --output json)" \
    || die "Could not read Edge Function status from the Supabase management plane."

  node - "${deploy_started_at}" "${functions_json}" "${FUNCTIONS[@]}" <<'NODE' \
    || die "Edge Function verification failed; no deployment success is recorded."
const [startedAt, functionsJson, ...requiredNames] = process.argv.slice(2);
let functions;
try {
  functions = JSON.parse(functionsJson);
} catch {
  process.stderr.write('Management-plane function response was not valid JSON.\n');
  process.exit(1);
}

if (!Array.isArray(functions)) {
  process.stderr.write('Management-plane function response was not a list.\n');
  process.exit(1);
}

const started = Date.parse(startedAt);
if (Number.isNaN(started)) {
  process.stderr.write('Could not establish the deployment start time.\n');
  process.exit(1);
}

for (const name of requiredNames) {
  const fn = functions.find((candidate) => candidate.slug === name || candidate.name === name);
  if (!fn) {
    process.stderr.write(`Required Edge Function is missing: ${name}.\n`);
    process.exit(1);
  }
  if (fn.status !== 'ACTIVE') {
    process.stderr.write(`Required Edge Function is not ACTIVE: ${name}.\n`);
    process.exit(1);
  }
  const updatedAt = Date.parse(fn.updated_at ?? '');
  if (Number.isNaN(updatedAt) || updatedAt < started) {
    process.stderr.write(`Required Edge Function lacks current deployment evidence: ${name}.\n`);
    process.exit(1);
  }
}
NODE
}

verify_worker_vault_secrets() {
  local vault_status

  vault_status="$(psql "${KILO_DATABASE_URL}" --no-psqlrc -v ON_ERROR_STOP=1 -Atq <<'SQL'
select case when count(*) = 2 then 'present' else 'missing' end
from vault.secrets
where name in ('kilo_functions_base_url', 'kilo_service_role_key');
SQL
)" || die "Could not verify health-deletion worker Vault secret names."

  [[ "${vault_status}" == "present" ]] \
    || die "Required health-deletion worker Vault secrets are missing."
}

verify_health_deletion_cron() {
  local cron_status

  [[ -n "${KILO_DATABASE_URL:-}" ]] \
    || die "KILO_DATABASE_URL is required to verify the health-deletion-drain cron."
  need_cmd psql

  cron_status="$(psql "${KILO_DATABASE_URL}" --no-psqlrc -v ON_ERROR_STOP=1 -Atq <<'SQL'
select case when exists (
  select 1
  from cron.job
  where jobname = 'health-deletion-drain'
    and active
) then 'active' else 'missing' end;
SQL
)" || die "Could not verify the health-deletion-drain cron."

  [[ "${cron_status}" == "active" ]] \
    || die "health-deletion-drain cron is missing or inactive."
}

verify_fixture_dispatch() {
  local fixture_user_id="$1"
  local dispatch_status

  [[ "${fixture_user_id}" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] \
    || die "HEALTH_DELETION_FIXTURE_USER_ID must be a UUID."

  dispatch_status="$(psql "${KILO_DATABASE_URL}" --no-psqlrc -v ON_ERROR_STOP=1 -v fixture_user_id="${fixture_user_id}" -Atq <<'SQL'
with due_jobs as (
  select
    count(*) as total,
    count(*) filter (where user_id = :'fixture_user_id'::uuid) as fixture_total
  from kilo.health_data_deletion_jobs
  where status in ('pending', 'failed')
    and next_attempt_at <= now()
), dispatch as (
  select kilo.dispatch_health_deletion_worker() as request_id
  from due_jobs
  where total = 1
    and fixture_total = 1
)
select case when exists (select 1 from dispatch where request_id is not null)
  then 'dispatched' else 'not-dispatched' end;
SQL
)" || die "Could not verify the disposable-fixture dispatch path."

  [[ "${dispatch_status}" == "dispatched" ]] \
    || die "Disposable fixture did not produce a health-deletion worker dispatch."
}

main() {
  need_cmd npx
  need_cmd node

  [[ -f "supabase/config.toml" ]] || die "supabase/config.toml not found; run from the repo root."
  [[ -n "${KILO_DATABASE_URL:-}" ]] \
    || die "KILO_DATABASE_URL is required to verify health-deletion worker prerequisites."
  need_cmd psql

  # Verify external prerequisites before changing any deployed function. The
  # function status check remains after deploy because it must prove this run.
  verify_worker_vault_secrets
  verify_health_deletion_cron

  # This timestamp is compared with the management-plane updated_at values after
  # deploy. CLI success alone is not evidence that the intended remote functions
  # are current and ACTIVE.
  local deploy_started_at
  deploy_started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)" || die "Could not establish deployment start time."

  echo "Deploying kilo functions to project ${PROJECT_REF}..."
  for fn in "${FUNCTIONS[@]}"; do
    echo "  Deploying ${fn}..."
    npx supabase functions deploy "${fn}" --project-ref "${PROJECT_REF}"
  done

  verify_functions_active

  if [[ -n "${HEALTH_DELETION_FIXTURE_USER_ID:-}" ]]; then
    verify_fixture_dispatch "${HEALTH_DELETION_FIXTURE_USER_ID}"
  else
    echo "Skipping worker dispatch probe; set HEALTH_DELETION_FIXTURE_USER_ID to a disposable queued fixture to run it."
  fi

  echo "Deployment verification complete."
}

main "$@"

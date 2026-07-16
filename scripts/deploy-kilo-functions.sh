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

main() {
  need_cmd npx

  [[ -f "supabase/config.toml" ]] || die "supabase/config.toml not found; run from the repo root."

  echo "Deploying kilo functions to project ${PROJECT_REF}..."
  for fn in "${FUNCTIONS[@]}"; do
    echo "  Deploying ${fn}..."
    npx supabase functions deploy "${fn}" --project-ref "${PROJECT_REF}"
    echo "  ${fn}: done."
  done
  echo "Deploy complete."
}

main "$@"

#!/usr/bin/env bash
# Bring the isolated MCP staging stack up or down (issue #1629).
#   stack.sh up     start Postgres + Auth + PostgREST and serve the mcp function
#   stack.sh serve  restart only the function from a fresh snapshot
#   stack.sh web    build the Kilo web app against this stack and serve it on 127.0.0.1:8081
#                   (needs `npm --prefix mobile ci`; uses Cloudflare's always-pass Turnstile test key)
#   stack.sh down   stop everything and delete the scratch workdir
#   stack.sh env    print the connection variables for scripts/verify-mcp-mvp.mjs
# Local only: ports 56321/56322, project id kilo_mcp_staging. Production is never
# touched; the workdir has its own config, links `supabase/migrations`, and serves a
# snapshot copy of `supabase/functions`.
set -euo pipefail

CLI_VERSION="${KILO_SUPABASE_CLI_VERSION:-2.117.0}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
WORK="${KILO_MCP_STACK_DIR:-${TMPDIR:-/tmp}/kilo-mcp-stack}"
SB=(npx --yes "supabase@${CLI_VERSION}")

prepare() {
  mkdir -p "$WORK/supabase"
  cp "$HERE/config.staging.toml" "$WORK/supabase/config.toml"
  ln -sfn "$REPO/supabase/migrations" "$WORK/supabase/migrations"
  # A snapshot, not a link: the function watcher restarts the runtime on any file
  # change, which would drop in-flight requests while the matrix runs. The
  # harness itself is left out of the served tree.
  rm -rf "$WORK/supabase/functions"
  cp -R "$REPO/supabase/functions" "$WORK/supabase/functions"
  rm -rf "$WORK/supabase/functions/mcp/integration"
  if [ ! -f "$WORK/supabase/signing_keys.json" ]; then
    node -e '
      const { generateKeyPairSync, randomUUID } = require("node:crypto");
      const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
      const jwk = privateKey.export({ format: "jwk" });
      process.stdout.write(JSON.stringify([{ ...jwk, kid: randomUUID(), alg: "ES256", use: "sig", key_ops: ["sign", "verify"], ext: true }]));
    ' > "$WORK/supabase/signing_keys.json"
  fi
}

case "${1:-}" in
  up)
    prepare
    cd "$WORK"
    "${SB[@]}" start --exclude imgproxy,logflare,mailpit,postgres-meta,realtime,storage-api,studio,supavisor,vector
    "${SB[@]}" status -o env > "$WORK/stack.env"
    "$0" serve
    echo "stack up; workdir $WORK"
    ;;
  serve)
    # (Re)serve the function from a fresh snapshot of supabase/functions.
    prepare
    cd "$WORK"
    [ -f functions.pid ] && kill "$(cat functions.pid)" 2>/dev/null || true
    # The function sees the in-network host, not the public one, so the issuer is
    # pinned explicitly (docs/operations/mcp-mvp.md).
    printf 'MCP_AUTH_ISSUER=http://127.0.0.1:56321/auth/v1\n' > "$WORK/functions.env"
    nohup "${SB[@]}" functions serve mcp --no-verify-jwt --env-file "$WORK/functions.env" > "$WORK/functions.log" 2>&1 &
    echo $! > "$WORK/functions.pid"
    for _ in $(seq 1 60); do
      grep -q "Serving functions" "$WORK/functions.log" && break
      sleep 1
    done
    ;;
  web)
    prepare
    cd "$WORK"
    ( cd "$REPO/mobile" && set -a && . "$WORK/stack.env" && set +a &&
      EXPO_PUBLIC_SUPABASE_URL="$API_URL" EXPO_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY" \
      EXPO_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA npm run export:web )
    rm -rf "$WORK/web" && cp -R "$REPO/mobile/dist" "$WORK/web"
    [ -f web.pid ] && kill "$(cat web.pid)" 2>/dev/null || true
    nohup node "$HERE/serve-web.mjs" "$WORK/web" 8081 > "$WORK/web.log" 2>&1 &
    echo $! > "$WORK/web.pid"
    echo "web build served at http://localhost:8081"
    ;;
  down)
    cd "$WORK" 2>/dev/null || { echo "nothing to stop"; exit 0; }
    [ -f functions.pid ] && kill "$(cat functions.pid)" 2>/dev/null || true
    [ -f web.pid ] && kill "$(cat web.pid)" 2>/dev/null || true
    "${SB[@]}" stop --no-backup || true
    cd / && rm -rf "$WORK"
    ;;
  env)
    cat "$WORK/stack.env"
    ;;
  *)
    echo "usage: stack.sh up|serve|web|down|env" >&2
    exit 2
    ;;
esac

# MCP MVP: staging prerequisites and operator checklist

Setup for the isolated MCP proof. The design contract is
[`docs/architecture/mcp-mvp.md`](../architecture/mcp-mvp.md). #1629 extends this
file with verified commands and results. Until then, steps are prerequisites and
have not been executed.

## Hard rules

- Never run `supabase config push`, `supabase functions deploy mcp`, signing-key
  rotation or OAuth-server changes against production `ogzhnscdqcdrhfqcobuv`.
- The repository `supabase/config.toml` targets production and must never carry
  `[auth]`/`[auth.oauth_server]` settings. Staging Auth config lives under
  `supabase/functions/mcp/integration/` (#1629).
- Synthetic users and synthetic health data only. No tokens, authorization codes,
  `authorization_id`s or response bodies in evidence.

## A. Local stack (executable; no operator needed)

| Item | Value |
| --- | --- |
| Supabase CLI | ≥ 2.117.0, invoked per command (`npx supabase@<exact version>`); do not change CI's 2.109.0 pin |
| Deno | v2.x (matches CI) |
| Node | 24 (matches CI) |
| Docker | running |
| Web origin / Site URL | `http://localhost:8081` (Expo web) |
| Authorization path | `/oauth/consent` |
| OAuth server | enabled in the staging config only |
| Dynamic registration | enabled in the staging config only |
| MCP URL | `http://127.0.0.1:54321/functions/v1/mcp` |
| Function env | `MCP_AUTH_ISSUER` unset locally (defaults correctly) |

Checks before starting implementation work:

1. `curl …/mcp` without a token returns 401 with `resource_metadata`.
2. `…/mcp/oauth-protected-resource` `authorization_servers[0]` equals the `issuer`
   in `…/auth/v1/.well-known/oauth-authorization-server`.
3. Run probes P1–P5 (architecture §11) and record the results in #1625/#1626.

Verified for #1625 on 2026-10-25 (synthetic user, scratch local stack with
Supabase CLI 2.109.0 and GoTrue v2.192.0, project id `kilo_probe_1625`, ports
56321/56322, OAuth server and dynamic registration on, torn down afterwards):
P1, P2 and P4 results are in the architecture §11. End to end, an OAuth access
token reached `initialize` and `whoami` through the function; the same function
rejected anonymous and first-party tokens (401); a direct PostgREST read of
`kilo.weight_entries` returned `[]` and `consent_withdraw` returned 403
(`42501`) for the OAuth token; after `DELETE /auth/v1/user/oauth/grants` (204),
replaying the unexpired token returned 401. Run the function tests with
`deno test --config supabase/functions/mcp/deno.json
--lock=supabase/functions/mcp/deno.lock --frozen --allow-net --allow-read
--allow-env --allow-import supabase/functions/mcp/`. Claude Code and HTTPS-only
clients were not exercised (#1629).

## B. Hosted staging (operator-owned prerequisites)

Needed only for HTTPS-only clients. Each item is an operator action; an agent
records "blocked: operator" rather than simulating success.

- [ ] Create a disposable project `kilo-mcp-staging` (not a branch of production).
- [ ] Confirm asymmetric JWT signing (ES256/RS256) is active.
- [ ] Enable OAuth 2.1 server, authorization path `/oauth/consent`, dynamic registration.
- [ ] Set Site URL to the staging web origin (a Cloudflare Pages preview alias is
      acceptable). Add it to Auth redirect URLs.
- [ ] Apply `kilo` migrations to the staging project only.
- [ ] Set the secret `MCP_AUTH_ISSUER=https://<staging-ref>.supabase.co/auth/v1`
      only if a custom domain is used.
- [ ] Set `health_sync_config.mode = 'consent_required'` so staging exercises the armed gate.
- [ ] Record the project alias, not its ref or keys, in evidence.

## C. Client target

Claude Code: `claude mcp add --transport http kilo-staging <MCP URL>`, then `/mcp`
→ authenticate. Record the client version and date. Testing one client does not
establish compatibility with another.

## D. Teardown and rollback

- Disconnect each test client from Account → Connected AI clients, then confirm
  replay of its last access token returns 401.
- Local: `npx supabase@<version> stop --no-backup`.
- Hosted: delete `kilo-mcp-staging`. Production needs no rollback because nothing
  is changed there.

## E. Before any production consideration

Production blockers PB-1–PB-4 and open decision OD-1 in the architecture contract
require a separate impact assessment with the co-tenant and explicit operator
approval. This MVP does not authorize them.

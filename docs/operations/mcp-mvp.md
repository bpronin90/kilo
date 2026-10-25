# MCP MVP: staging prerequisites and operator checklist

Setup for the isolated MCP proof. The design contract is
[`docs/architecture/mcp-mvp.md`](../architecture/mcp-mvp.md). Sections A–F are
prerequisites and per-issue notes; section G is the repeatable local run and its
verified results (#1629). Evidence: [`docs/verification/mcp-mvp/`](../verification/mcp-mvp/README.md).
Hosted staging (section B) has not been executed.

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
| Function env | `MCP_AUTH_ISSUER=http://127.0.0.1:56321/auth/v1` (the stack's public Auth URL). Under `functions serve` the function sees an in-network host, so the unset default does not match the token issuer and every token is rejected (verified in #1629). `stack.sh` sets it. |

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
establish compatibility with another. #1629 verified the official MCP TypeScript SDK
client only (section G); Claude Code was not run.

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

## F. Browser authorization and disconnect (#1626)

The web app serves `/oauth/consent?authorization_id=<id>` from the SPA fallback
(no `_redirects` file; Pages ignores that rule as a loop). The id is validated,
kept in `sessionStorage` for 10 minutes (key `kilo.mcp.pendingAuthorization`),
and removed from the visible URL. Nothing else about the request is stored,
logged or sent to analytics. Approve/Deny call Auth with
`skipBrowserRedirect: true` and Kilo navigates only to the returned URL when it is
`https:` or loopback `http:`. Account → Connected AI clients lists `listGrants()`
and calls `revokeGrant({ clientId })` for one client after an explicit
confirmation; success shows only after Auth confirms.

Evidence and capture steps: `docs/evidence/mcp-authorization/README.md`.

Probe P5 (local stack, GoTrue v2.192.0, 2026-10-25): after a client was approved,
a second authorization request from the same client returned only a
`redirect_url` from `getAuthorizationDetails`, with no consent details. Auth
therefore remembers approvals; the page follows that redirect (when safe) without
showing the disclosure again. OD-1 is resolved: **accept** (operator decision on
#1626). No grant revocation is added to the withdrawal flow, and enforcement
(`consent_stale`, the session gate) is unaffected.

## G. Repeatable local run and verified results (#1629)

Everything here is local and disposable. Nothing touches production
`ogzhnscdqcdrhfqcobuv`, hosted Auth, signing keys or `supabase config push`.

| Item | Value |
| --- | --- |
| Supabase CLI | `npx supabase@2.117.0` (override with `KILO_SUPABASE_CLI_VERSION`); CI stays on 2.109.0 |
| GoTrue / edge runtime | whatever the CLI pins; the tested versions are recorded in `docs/verification/mcp-mvp/results.json` |
| Deno / Node / Docker | Deno 2.x, Node 24, Docker running |
| MCP client under test | `@modelcontextprotocol/client` 2.4.0, the official MCP TypeScript SDK client (pinned in `integration/deno.json` and `deno.lock`) |
| Project id and ports | `kilo_mcp_staging`; API 56321, DB 56322 (no clash with a normal local stack) |
| MCP URL | `http://127.0.0.1:56321/functions/v1/mcp` |
| Discovery | `…/mcp/oauth-protected-resource` and `…/auth/v1/.well-known/oauth-authorization-server` |
| Browser route | Site URL `http://localhost:8081`, authorization path `/oauth/consent` |
| Registration policy | open dynamic registration, staging only (production blocker PB-2) |
| Staging Auth config | `supabase/functions/mcp/integration/config.staging.toml`, copied into a scratch workdir; asymmetric ES256 signing key generated locally |
| Operator-owned | nothing for the local run; hosted staging and HTTPS-only clients stay in section B |

Environment variable names (values come from the stack, none are committed):
`API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `JWT_SECRET` (local demo keys read from
`stack.env`), `KILO_MCP_SIGNING_KEYS`, `KILO_MCP_FUNCTIONS_LOG`, `KILO_MCP_RESULTS`,
`KILO_MCP_STACK_DIR`, `KILO_MCP_DB_CONTAINER`; function secret `MCP_AUTH_ISSUER`.

```sh
bash supabase/functions/mcp/integration/stack.sh up        # Postgres, Auth, PostgREST, migrations, mcp function
node scripts/verify-mcp-mvp.mjs                             # ~6 minutes; writes docs/verification/mcp-mvp/results.json
bash supabase/functions/mcp/integration/stack.sh serve      # re-snapshot supabase/functions after a code change
bash supabase/functions/mcp/integration/stack.sh down       # teardown: containers, volumes, workdir
```

Seed and cleanup: the matrix creates its own `@example.test` users and synthetic rows
(manifest: `docs/verification/mcp-mvp/fixture-manifest.json`), sets the consent gate to
`consent_required`, and leaves cleanup to `stack.sh down`, which discards the whole
database. `node scripts/verify-mcp-mvp.mjs --check` is the offline CI consistency
check (case list, recorded results, no credentials in evidence).

The matrix covers, with assertions on response content and row access: discovery and
anonymous challenge; SDK connect with dynamic registration, PKCE and explicit
approval; `tools/list` (exactly `whoami`, `workout_notes_list`, `weight_entries_list`,
all read-only); workout and weight pagination, tombstones, raw-text bounds, unknown
dates and the lb-only unit; empty snapshots; cross-user cursors and arguments; direct
table, write, withdrawal and other-function attempts with an OAuth token; eleven bad
token shapes; denied OAuth request; missing consent; refresh; disconnect and replay of
an unexpired token; withdrawal before purge, regrant and reconnect; deleted account;
gate, consent, session, page-RPC and limiter outages; a slow database; request-size,
batch and method limits; per-user, data-quota and pre-auth rate limits; and a log scan.

### Connecting a client (user guide)

1. The user keeps Cloud Sync health consent granted in Kilo. Without it the client
   connects but every data tool answers `consent_required`.
2. In the client, add the MCP URL. The client registers itself, then opens the
   authorization URL; Kilo's `/oauth/consent` page asks the user to sign in if needed
   and shows who is asking and what is shared.
3. Disclosure to give users: the client reads **only data already synced to Kilo
   Cloud** (workout note text and body-weight entries, read-only). Anything that exists
   only on a device is invisible, and an empty answer means "no cloud rows", not "no
   history". Weights are in pounds; the unit originally typed is not stored.
4. Disconnect: Account → Connected AI clients → Disconnect. The client's next request
   fails immediately, even with an unexpired access token. Signing out of the Kilo
   app is not a disconnect.

### Troubleshooting

| Symptom | Cause and check |
| --- | --- |
| Every token gets 401 on a fresh stack | `MCP_AUTH_ISSUER` missing from the function env (see section A); `stack.sh serve` re-applies it |
| 401 after the client worked | disconnected, signed out of Kilo everywhere, account deleted, or consent re-granted (`consent_stale`): reconnect through the browser flow |
| Tool result `consent_required` | consent withdrawn or never granted; grant it in Kilo, then reconnect if it was re-granted |
| 503 | session, consent or grant lookup failed; the request ran no data query. Retry; check Auth and Postgres health |
| 429 | per-IP, per-user or data quota; honor `Retry-After` / `rate_limited`. Behind the local gateway all requests share one IP bucket (120 / 60 s) |
| Client loops on refresh | a refresh token for a disconnected grant fails by design; reconnect |
| Matrix says "pre-auth bucket busy" | a run finished less than a minute ago; the matrix waits |

Minimal-log check: function logs contain `{"mcp": method, "tool", "status", "ms"}` only.
The matrix scans the log for JWTs, `authorization_id`, user ids, fixture markers and
cursors (case G1).

Rollback: nothing in production changed, so rollback is `stack.sh down`. For a hosted
staging project, delete `kilo-mcp-staging`; never roll back by editing production.

Production stays separate: PB-1–PB-4 (architecture §12), a co-tenant impact
assessment and explicit operator approval are required before any production
enablement. #1629 does not authorize them.

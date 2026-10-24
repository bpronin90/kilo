# MCP MVP: security and interface contract

Authoritative contract for the read-only MCP MVP (umbrella #1587, contract #1624).
Implementation issues #1625–#1629 build against this document and update only the
sections their issue names. Operator steps and the staging checklist live in
[`docs/operations/mcp-mvp.md`](../operations/mcp-mvp.md).

Status: **design contract, not implemented.** Nothing here is deployed, and no
live Supabase configuration was inspected while writing it. Each claim is backed
by a dated source (§13), a repository file, or is marked as a **probe** (§11) that
must be run in isolated staging before the dependent handoff.

## 1. Scope and non-goals

An existing Kilo user explicitly authorizes one external MCP client to read their
own **cloud-synced** workout notes and weight entries. Read-only; three tools:
`whoami`, `workout_notes_list`, `weight_entries_list`.

Not in scope: writes, derived analytics, device-local data, admin or SQL tools,
automatic Cloud Sync enablement, production rollout, and any change to the existing
cloud-storage consent purpose.

## 2. Platform facts this design depends on

Checked against Supabase documentation on 2026-10-24 and the supabase-js
`@supabase/auth-js` 2.108.2 type definitions already in `mobile/node_modules`.

| # | Fact | Source |
| --- | --- | --- |
| F1 | Supabase Auth acts as the OAuth 2.1 authorization server: authorization code with PKCE and refresh token grants only. OAuth 2.1 server is **beta**. | oauth-flows, getting-started |
| F2 | Auth redirects the browser to `Site URL + authorization path` with `?authorization_id=`. The app calls `getAuthorizationDetails`, `approveAuthorization`, `denyAuthorization`. | getting-started |
| F3 | OAuth access tokens are ordinary Supabase JWTs (`aud: authenticated`, `role: authenticated`, `sub`, `session_id`, `iss`) plus a `client_id` claim. | token-security |
| F4 | **OAuth scopes do not restrict database access.** An OAuth access token has the same PostgREST/RLS reach as a first-party session token. Custom scopes are not supported. | oauth-flows "Available scopes" |
| F5 | `revokeGrant({ clientId })` "marks consent as revoked, deletes active sessions for that OAuth client, and invalidates associated refresh tokens." `listGrants()` lists the user's grants. (The guide calls the list method `getUserGrants`; the 2.108.2 SDK names it `listGrants`.) | auth-js `lib/types.d.ts`; oauth-flows |
| F6 | Access tokens are verified locally against JWKS. Revoking a grant does **not** make an already-issued access token fail signature or expiry checks; it stays verifiable until `exp` (default 3600 s). | `withSupabase` docs (JWKS), signing-keys |
| F7 | `withSupabase({ auth: 'user' })` (`@supabase/server` ≥ 1.6.0) needs an asymmetric signing key (ES256/RS256) and rejects HS256. `withOAuthProtectedResource()` serves RFC 9728 metadata and the `WWW-Authenticate` challenge. | byo-mcp |
| F8 | Dynamic client registration is a project-wide switch; it lets any compatible client register. OAuth client redirect URIs are exact-match, no wildcards. | byo-mcp, getting-started |
| F9 | `byo-mcp` requires Supabase CLI ≥ 2.117.0; repository CI pins 2.109.0 (`.github/workflows/test.yml`). The OAuth server itself needs CLI ≥ 2.54.11 locally. | byo-mcp, getting-started |
| F10 | Authorization codes are single-use, PKCE-bound and valid 10 minutes. | oauth-flows |

**Consequence of F4 + F6.** Two things the tutorial does not cover are mandatory
here: (a) a revoked client's unexpired token must be denied by a server-side
check, not by token expiry; (b) an OAuth token must not be able to bypass the MCP
function and use Kilo's PostgREST tables, RPCs or Edge Functions directly. §5 and
§6 settle both.

## 3. Deployment path

- **Executable now (no operator):** local Supabase stack started with CLI
  ≥ 2.117.0 run per command (`npx supabase@<pinned ≥2.117.0>`), plus the Expo web
  export served on `http://localhost:8081`. Local tokens are signed with the CLI's
  asymmetric key. This is the development and CI-integration target.
- **Operator prerequisite:** one disposable hosted Supabase project dedicated to the
  MCP proof (alias `kilo-mcp-staging`), needed only for clients that require
  public HTTPS. It is not the shared production project.
- **Forbidden:** enabling the OAuth server, changing the Site URL, rotating signing
  keys, enabling dynamic registration, or deploying the `mcp` function on
  production project `ogzhnscdqcdrhfqcobuv`. Each of these is project-wide and would
  change Auth behavior for the co-tenant app (§12, PB-1–PB-4).

**Config isolation rule.** The repository `supabase/config.toml` carries the
production `project_id`. It must **not** gain `[auth]`, `[auth.oauth_server]` or
signing-key stanzas, because `supabase config push` from it targets production.
Only the `[functions.mcp] verify_jwt = false` stanza may be added (#1625). Staging
Auth settings live in a separate config owned by #1629 (`supabase/functions/mcp/integration/`).

**Tooling.** CI stays on 2.109.0. MCP Deno unit tests need no CLI. The new
migrations (§6) avoid any dependency on the OAuth server existing (they tolerate a
missing `auth.sessions`, as `20260926120000` already does), so the existing pgTAP
job covers them without a CLI upgrade. The ≥ 2.117.0 CLI is used only for local
and staging serving.

## 4. Browser authorization flow (#1626)

Route: `GET <web origin>/oauth/consent?authorization_id=<id>`. Staging sets
authorization path `/oauth/consent` and Site URL to the Kilo web origin.

Cold load: Cloudflare Pages already serves `index.html` for every path because the
export has no top-level `404.html` (`docs/operations/web-deployment.md`). **Do not
add `mobile/public/_redirects`**: Pages ignores `/* /index.html 200` as a loop.
Locally, the Expo web dev server already falls back to the SPA.

Flow:

1. On web mount, `AppShell` checks `location.pathname === '/oauth/consent'`
   before rendering tabs. The existing callback effect only matches
   `code|access_token|error` and does not fire on this path; it stays unchanged.
2. Validate `authorization_id`: 1–128 chars of `[A-Za-z0-9-_]`; anything else
   renders the "invalid request" state and makes no API call.
3. Store `{ authorizationId, storedAt }` in `sessionStorage` key
   `kilo.mcp.pendingAuthorization` (10-minute TTL, matching F10), then
   `history.replaceState` to drop the query string from the visible URL.
   Nothing else about the request is persisted, logged or sent to analytics.
4. Signed out: show the existing sign-in UI inline. Email/password stays on the
   page. GitHub sign-in returns to the origin root and loses the path, so on mount
   the shell also resumes from a non-expired `pendingAuthorization` entry. The
   entry is bound to nothing but the id; Auth re-checks ownership at approve time.
5. Signed in: `getAuthorizationDetails(id)`.
   - Error → expired/used/unknown state, cleared entry.
   - Response without `authorization_id` (Auth already holds prior consent and
     returns `redirect_url`) → follow it; see probe P5 and OD-1.
6. Show the disclosure (§4.1). **Approve** → `approveAuthorization(id, { skipBrowserRedirect: true })`;
   **Deny** → `denyAuthorization(id, { skipBrowserRedirect: true })`. Clear the
   entry first, then `location.assign(redirect_url)` only if it parses as an
   absolute `https:` URL or `http://localhost`/`127.0.0.1`. Kilo never constructs
   the redirect itself, so it cannot be an open redirector.
7. Account switch, sign-out or unmount cancels in-flight calls and clears the
   entry; a response arriving after a user change is dropped.

PKCE, `state` and redirect-URI matching are enforced between the client and Auth
(F2, F10). Kilo never sees the code, verifier or tokens.

**Health-consent prerequisite.** If the signed-in user's `consent_state` is not an
active grant, the page explains that Cloud Sync health consent is required first
and offers Deny. It must not grant consent, start sync, or approve.

### 4.1 Disclosure content

Render as plain text (client metadata is attacker-chosen; truncate the name at 80
chars and show the redirect URI host):

- the client's name and redirect host, labeled "provided by the client, not verified by Kilo";
- read-only access to workout notes and weight entries **already synced to Kilo
  Cloud**, not data that only exists on a device;
- data sent to the client is handled under that provider's terms; Kilo cannot
  recall data already sent;
- how to disconnect (Account → Connected AI clients) and that signing out of Kilo
  does not disconnect.

### 4.2 Connection management

Account → Connected AI clients: `listGrants()` and, after an explicit
confirmation, `revokeGrant({ clientId })`. Success appears only after the call
resolves; failure keeps the row and shows a retry. Copy states that sign-out is
separate and does not disconnect.

## 5. Identity and authorization on every request (#1625)

Each HTTP request to `/functions/v1/mcp` runs this order. Earlier failures stop the
request, and no data query runs.

| Step | Check | Failure |
| --- | --- | --- |
| 0 | `GET …/mcp/oauth-protected-resource` is public discovery (F7); nothing else is public. | — |
| 1 | Pre-auth limiter, bucket `mcp:ip:<clientIp>` (§8). | 429 |
| 2 | `withSupabase({ auth: 'user' })`: signature via JWKS, `exp`, `aud = authenticated`. | 401 `invalid_token` + challenge |
| 3 | Kilo claim checks: `iss` equals `MCP_AUTH_ISSUER` exactly; `role = authenticated`; `sub`, `session_id` are UUIDs; `client_id` is a non-empty string. A first-party Kilo session (no `client_id`) is rejected. | 401 `invalid_token` |
| 4 | Per-user limiter, buckets `mcp:user:<sub>:m` and `:h`. | 429 |
| 5 | `rpc('mcp_request_gate')` on the request-scoped user client (§6.1). | see §5.1 |
| 6 | MCP handler, fresh `McpServer` per request. Data tools call only the page RPCs (§6.3) on the same user client. Each RPC re-runs the full gate inside the statement that reads data, so step 5 is an early, cheap rejection, not the enforcement point. | tool error |

Identity source: the verified `sub` only. No tool accepts a user id, and cursors
carry no identity.

### 5.1 Gate outcomes

`kilo.mcp_request_gate()` returns one status. Mapping:

| Status | Meaning | Response |
| --- | --- | --- |
| `ok` | active session, active health consent | continue |
| `session_inactive` | session row gone/expired, or no live refresh token (disconnect, sign-out-everywhere, password reset) | 401 `invalid_token` |
| `account_missing` | `auth.users` row gone (account deleted) | 401 `invalid_token` |
| `consent_stale` | session created before the current health-consent grant (§5.2) | 401 `invalid_token` (re-authorize) |
| `consent_required` | consent missing, withdrawn, `needs_reconsent`, `deletion_pending`, stale material version, or gate mode `paused` | `initialize`, `tools/list`, `whoami` proceed; data tools return tool error `consent_required` |
| RPC error/timeout | lookup outage | 503, no data |

**Mode `legacy`.** `health_gate_ok()` returns true in `legacy` mode. The MCP gate
does not: it always requires `consent_state.status = 'granted'` with a current
material version. MCP is therefore never more permissive than the consent record.

### 5.2 Grant evidence and invalidation

Persistent grant evidence lives entirely in Supabase Auth (the OAuth consent, the
session, its refresh tokens) plus `kilo.consent_state`. **No Kilo grant table is
added**, so Kilo cannot drift from Auth.

| Event | Server effect | Why access stops |
| --- | --- | --- |
| Disconnect (`revokeGrant`) | Auth deletes that client's sessions and refresh tokens (F5) | gate: session row/refresh token absent → `session_inactive`, including for an unexpired access token |
| Access token expiry | — | step 2 |
| Refresh token revoked/reused | Auth revokes the token family | refresh fails; the gate sees no live refresh token for the session |
| Kilo mobile sign-out | ends **only the app's own session** | does not touch the client's session; **not revocation** (stated in the UI) |
| Sign out everywhere / password change | Auth deletes all user sessions | `session_inactive` |
| Health-consent withdrawal | `consent_state.status` leaves `granted` | `consent_required` at the HTTP gate and inside every page RPC, in every gate mode |
| Regrant after withdrawal | new `granted_at` | sessions created before it are `consent_stale`; the client must run the authorization flow again |
| Account deletion | `auth.users` row and its sessions/consent_state cascade | `account_missing` / `session_inactive` |

The `consent_stale` rule (`session.created_at < consent_state.granted_at`) means a
regrant never silently revives a connection made under an earlier grant. It needs
no new table.

## 6. Database changes (Kilo schema only)

### 6.1 `kilo.mcp_request_gate()` — #1625

`SECURITY DEFINER`, `set search_path = ''`, `statement_timeout` ≤ 2 s, execute
granted to `authenticated` only. It reads only `auth.jwt()` claims, `auth.users`,
`auth.sessions`, `auth.refresh_tokens` and `kilo.consent_state`/`health_sync_config`.
Auth tables are read through dynamic SQL guarded by `to_regclass`, following
`kilo.restore_session_active` in `20260926120000`: a missing table means "inactive",
never an exception.

Session active means **all** of: `auth.sessions` row with `id = session_id`,
`user_id = sub`, `not_after` null or future; and at least one
`auth.refresh_tokens` row for that session with `revoked = false`. Requiring both
makes the gate deny whether `revokeGrant` deletes sessions, deletes refresh tokens,
or only marks them revoked (P1 confirms which). If the session row exposes the
OAuth client (P2), the gate also requires it to equal the `client_id` claim.

Returns `jsonb`: `{ status, consent_granted_at }`; never returns user data.

The status logic lives in one internal function, `kilo.mcp_gate_status()`, which
is not executable by API roles. `mcp_request_gate()` and both page RPCs (§6.3)
call it, so the HTTP gate and the data boundary cannot diverge.

### 6.2 OAuth-token isolation — #1625

Because of F4, without this an approved MCP client could call PostgREST, Kilo RPCs
or Edge Functions with its token, including reads that skip the consent rules,
writes, and `consent_withdraw`.

**Principle: an OAuth token has no direct table access in `kilo`.** Its only data
path is the page RPCs. Each RPC enforces the full §5.1 gate, the per-user data
quota and the byte budget itself (§6.3). Calling one through PostgREST instead of
MCP therefore gains nothing: the gate, columns, row and byte bounds, and quota are
the same, and a quota spent directly is spent for MCP too.

- `kilo.is_oauth_client_token()`: `auth.jwt() ->> 'client_id' is not null`.
- On **every** RLS-enabled table in `kilo`, one `AS RESTRICTIVE` policy `FOR ALL`
  to `authenticated`: `not kilo.is_oauth_client_token()`. There are no exceptions,
  including `workout_notes` and `weight_entries`. First-party sessions are
  unaffected.
- Every `kilo` function executable by `authenticated` falls in one of three groups:
  - **Writers** raise `insufficient_privilege` when `kilo.is_oauth_client_token()`.
    Currently: `consent_grant`, `consent_withdraw`, `health_sync_preflight`,
    `record_product_measurement_event`, `delete_product_measurement_install`.
  - **Pure reads** with no user data are allowlisted: `health_gate_ok`,
    `is_valid_exercise_movement_groups`, `client_consent_protocol_version`,
    `is_oauth_client_token`.
  - **MCP functions** are allowlisted: `mcp_request_gate` and the page RPCs.
- `account-export`, `account-delete`, `health-data-delete` and
  `android-restore-credentials` reject a bearer token carrying `client_id` with 403
  before any other work.

### 6.3 Page RPCs — #1627, #1628

`kilo.mcp_workout_notes_page(p_limit int, p_as_of timestamptz, p_after_updated_at timestamptz, p_after_id text, p_include_raw_text bool)`
(#1627) and
`kilo.mcp_weight_entries_page(p_limit int, p_phase text, p_after_logged_at timestamptz, p_after_id text, p_logged_from timestamptz, p_logged_to timestamptz)`
(#1628).

Both functions:

- Are `SECURITY DEFINER`, `set search_path = ''`, `statement_timeout` ≤ 3 s, and
  executable by `authenticated` only.
- Run three checks first and return no rows unless all pass:
  - `kilo.is_oauth_client_token()` is true;
  - `kilo.mcp_gate_status()` is `ok` (active session, explicit current consent even
    in `legacy` mode, not `consent_stale`);
  - gate mode is not `paused`.

  On a failure they raise a fixed SQLSTATE carrying only the status. The tool maps
  it to the §5.1 response.
- Filter `user_id = auth.uid()` explicitly; definer rights bypass RLS, so the
  owner filter is in the body.
- Validate arguments: `p_limit` 1–100, or 1–25 when raw text is requested; the
  §7.3 range rules. Invalid arguments raise `invalid_arguments`.
- **Durable data quota, in the RPC.** After the gate passes and before reading,
  call `kilo.rate_limit_check` (callable by the definer owner) on two buckets:
  `mcp:data:<uid>:m` (30 / 60 s) and `mcp:data:<uid>:h` (500 / 3600 s).
  - Exhausted bucket: raise `rate_limited`.
  - Limiter error: propagates and aborts the statement, so a limiter outage fails
    closed with no rows.

  The quota is the same whether the RPC is called through MCP or directly. Windows
  stay ≤ 1 hour so the existing `kilo.rate_limit_global_prune` retention covers
  them; #1625 confirms that prune window when writing the migration.
- Return only the §7 item columns. Workout raw text is `left(raw_text, 4000)` with
  `char_length(raw_text)`, so it is bounded **in SQL** and never fetched whole.
  Derived jsonb columns, `source_snapshot`, and weight `note` are never selected.
- **Byte budget, in SQL.** Each candidate row's cost is
  `octet_length` of its returned text fields (`id`, `title`, truncated `raw_text`)
  plus 256 bytes of fixed overhead. Rows are emitted in order while the running sum
  is ≤ 200 KiB (a window sum over the ordered candidates); the first row is always
  emitted. A single row is at most about 33 KiB: `title` is bounded to 4096 chars
  by `20260823200340` and raw text to 4000 chars, at ≤ 4 bytes each. Each RPC also
  returns `has_more`, so the tool builds `next_cursor` from the last emitted row.
  The 56 KiB margin under the 256 KiB response cap covers the envelope and JSON
  escaping. The MCP-side trim (§8) stays as a second guard, not the only one.

Because the gate runs inside the reading statement, revocation, withdrawal and
regrant take effect on the next statement even with an unexpired token, whether
the RPC is called through MCP or directly.

### 6.4 Migration and test inventory

| Owner | Path | Purpose |
| --- | --- | --- |
| #1625 | `supabase/migrations/<ts>_mcp_request_gate.sql` | §6.1 and §6.2 |
| #1625 | `supabase/tests/mcp-request-gate.test.sql` | each gate status, outage-safe missing tables, legacy mode, regrant staleness |
| #1625 | `supabase/tests/mcp-oauth-token-isolation.test.sql` | OAuth token reads 0 rows / cannot write on every `kilo` table, guarded RPCs, catalog completeness |
| #1627 | `supabase/migrations/<ts>_mcp_workout_notes_page.sql` | §6.3 workout RPC |
| #1627 | `supabase/tests/mcp-workout-notes-page.test.sql` | gate inside the RPC (revoked session, withdrawn/legacy, stale regrant, first-party token), owner filter, tombstones, keyset order, truncation, in-RPC quota exhaustion and limiter failure, 200 KiB byte budget (4096-char titles) |
| #1628 | `supabase/migrations/<ts>_mcp_weight_entries_page.sql` | §6.3 weight RPC |
| #1628 | `supabase/tests/mcp-weight-entries-page.test.sql` | the same gate matrix, owner filter, entry type, tombstones, null `logged_at` phase, range bounds, in-RPC quota and limiter failure, byte budget |

Catalog tests (#1625) run in the same suite: every RLS table in `kilo` must carry
the restrictive policy, and every `kilo` function with
`has_function_privilege('authenticated', …, 'EXECUTE')` must be guarded or
allowlisted. New tables and functions therefore cannot silently reopen direct
access.

## 7. Tool interface

All tools: `annotations.readOnlyHint = true`, Zod `.strict()` input (unknown keys
rejected), and `structuredContent` plus one JSON `text` block with the same
content. Schema ids are versioned; a breaking change adds `/v2`.

### 7.1 Shared envelope

```json
{
  "schema": "kilo.mcp.workout_notes_list/v1",
  "provenance": {
    "source": "kilo_cloud_snapshot",
    "coverage": "unknown",
    "snapshot_as_of": "2026-10-24T23:00:00Z",
    "note": "Only data this account has synced to Kilo Cloud. Devices may hold unsynced or local-only data."
  },
  "result_state": "records | no_cloud_records",
  "items": [],
  "next_cursor": null
}
```

**Coverage rule.** The server cannot observe whether a device has local-only data
or whether sync is running. There is no server sync flag, and none is invented.
`coverage` is always `"unknown"`. `no_cloud_records` means "zero rows in the cloud
snapshot," never "the user has no workouts." **`sync_unavailable` is not emitted in
v1**: the only server evidence of unavailable sync is a missing consent grant, and
that is already the `consent_required` error.

Tool error (`isError: true`):
`{ "schema": "kilo.mcp.error/v1", "code": "<code>", "message": "<fixed text>", "retryable": bool }`.
Codes: `invalid_arguments`, `invalid_cursor`, `consent_required`, `rate_limited`,
`response_too_large`, `timeout`, `internal`. Messages are fixed strings; never echo
database errors, arguments or row content. Token, grant and session failures are
**protocol** errors (HTTP 401 with challenge), never tool errors.

### 7.2 `workout_notes_list` (#1627)

Input: `limit` int 1–100 (default 20; max 25 when `include_raw_text`),
`cursor` string ≤ 512, `include_raw_text` bool (default false).

Item: `id`, `title` (nullable), `saved_at` (nullable, client-reported save time),
`updated_at` (server last-modified time), `is_current`, and only when opted in:
`raw_text` (≤ 4000 chars), `raw_text_chars`, `raw_text_truncated`.

Semantics: one item is a **notebook record that may contain several sessions**.
No session date is produced; `saved_at`/`updated_at` are labeled as save/modify
times. No parsed or derived fields (`tracked_exercises` etc. are never selected).
Tombstones (`deleted_at is not null`) are excluded.

Order and cursor: `(updated_at desc, id desc)`, restricted to
`updated_at <= as_of`, where `as_of` is fixed on the first page. Rows edited during
pagination therefore leave the sequence instead of repeating. The cursor is
base64url JSON `{ "v":1, "as_of", "u", "id" }`, strictly validated. Tampering can
only move position within the caller's own RLS-visible rows.

### 7.3 `weight_entries_list` (#1628)

Input: `limit` 1–100 (default 50), `cursor`, optional `logged_from`/`logged_to`
(RFC 3339 instants with offset, `from < to`, span ≤ 366 days).

Item: `id`, `value`, `unit: "lb"`, `original_unit: null`,
`original_unit_status: "unavailable"`, `date` (nullable `YYYY-MM-DD`, returned
verbatim, never shifted), `logged_at` (nullable client-recorded entry instant).

Unit trace: the client converts typed input to canonical lb before storage
(`mobile/lib/parser/weightEntry.js` → `inputWeightToLb`; `mobile/lib/units.js`
"Canonical storage is ALWAYS lb"). `transport.js`/`bootstrapPlan.js` upload
`weight_value` unchanged, and `kilo.weight_entries` has no unit column. So `value`
is normalized lb. The entry unit and the user's current `unit_system` preference
are never used to guess an original unit.

Filtering and order: `entry_type = 'weight'` only; tombstones excluded; `note` is
never returned in v1. Order `(logged_at desc nulls last, id desc)`. With a range,
only rows whose `logged_at` falls in `[from, to)` match. Instants avoid any
timezone day boundary, so rows with null `logged_at` are excluded from ranged
queries and listed after dated rows in unranged ones. The cursor carries
`{ v, phase: "dated"|"undated", l, id }`.

### 7.4 `whoami` (#1625)

`kilo.mcp.whoami/v1`: `user_id` (`sub`), `client_id`, `health_consent:
"granted"|"not_granted"`, `server_version`, plus the provenance block. No email,
name or profile fields.

## 8. Limits

| Limit | Value |
| --- | --- |
| Rows per page | ≤ 100 (≤ 25 with raw text) |
| Raw text per note | 4000 chars, truncated in SQL |
| Response body | ≤ 256 KiB serialized. Enforced first in SQL (200 KiB row budget, §6.3), then by an MCP-side trim of trailing items; one item always fits. |
| Request body | ≤ 64 KiB; JSON-RPC batches rejected |
| DB call | 3 s abort; function `statement_timeout` |
| Whole request | 10 s → `timeout` |
| Pre-auth | 120 / 60 s per IP |
| Per user, any MCP method (HTTP) | 60 / 60 s and 1000 / 3600 s |
| Per user, data reads (inside page RPCs, also for direct calls) | 30 / 60 s and 500 / 3600 s |
| Limiter outage | **deny**: `failurePolicy: 'deny'` at HTTP; statement abort inside RPCs |

**Privileged limiter decision: approved, narrowly.** `_shared/rate-limit.ts`
requires a service-role client. #1625 creates it inside `mcp/limiter.ts`, which
exports only `allow(bucket, max, windowMs)`. The admin client is never exported,
passed to the MCP handler or tool registry, or used for any table read. A test
asserts the tool context exposes only the user client. Buckets embed the IP or
user UUID, so logs follow the module's existing no-bucket rule.

Logging: method name, tool name, status/error code, duration. Never tokens,
`authorization_id`, query strings, arguments, cursors or response bodies.

## 9. File ownership

| Issue | Owns |
| --- | --- |
| #1625 | `supabase/functions/mcp/{index.ts,deno.json,deno.lock,auth.ts,gate.ts,limiter.ts,limits.ts,envelope.ts}`, `mcp/tools/{index.ts,whoami.ts}` and tests; `[functions.mcp]` in `supabase/config.toml`; §6.4 #1625 rows; the OAuth-token guard in the four existing functions' `index.ts`; `docs/architecture/backend-schema.md` (new objects) |
| #1626 | `mobile/screens/mcp/**`, `mobile/lib/mcpAuthorization.js`, `mobile/hooks/useMcpAuthorization.js`, route entry in `AppShell`/`navigation`, Account entry; **no `_redirects`** |
| #1627 | `mcp/tools/workout-history.ts` (+test), registration line, §6.4 #1627 rows |
| #1628 | `mcp/tools/weight-history.ts` (+test), registration line, §6.4 #1628 rows |
| #1629 | `mcp/integration/**` (incl. staging `config.toml`), `scripts/verify-mcp-mvp.mjs`, `docs/verification/mcp-mvp/**` |

Pinned dependencies (#1625 commits `deno.lock`): `@modelcontextprotocol/server`
2.x, `@supabase/server` ≥ 1.6.0, `@supabase/middleware` 1.x, `zod` 4.x, each at an
exact version.

## 10. Failure-state walk-through

| Case | Stops at | Outcome |
| --- | --- | --- |
| Anonymous | 2 | 401 + `resource_metadata` challenge |
| Malformed / HS256 / bad signature | 2 | 401 |
| Wrong issuer | 3 | 401 |
| Wrong audience | 2 | 401 |
| No `client_id` (first-party app token) | 3 | 401 |
| Expired token | 2 | 401; client refreshes |
| Disconnected client, unexpired token | 5, and inside the page RPC | 401 `session_inactive`; direct table read returns 0 rows (§6.2); direct RPC call raises |
| Consent withdrawn mid-session (any gate mode, incl. `legacy` during purge) | 5, and inside the page RPC | `consent_required`; direct table/RPC paths also denied |
| Withdraw → regrant, old live session | 5, and inside the page RPC | 401 `consent_stale` → re-authorize; direct paths denied |
| OAuth token reads `kilo.workout_notes` via PostgREST | §6.2 restrictive policy | 0 rows; no raw columns or unbounded text |
| OAuth token calls a page RPC directly past its quota, or during a limiter outage | §6.3 in-RPC quota | `rate_limited` / statement aborted; no rows |
| Cross-user arguments/cursor | schema / RLS | `invalid_arguments`, or only own rows |
| Account deleted | 5 | 401 |
| Consent/grant lookup outage | 5 | 503, no query |
| Limiter outage | 1/4 | 429 (deny) |
| OAuth token calls `consent_withdraw` / writes / `account-delete` | §6.2 | denied |
| Oversized response | §8 | truncated page with cursor |

## 11. Probes (run in local stack before the named handoff)

| # | Question | Needed by | If the answer is unfavorable |
| --- | --- | --- | --- |
| P1 | After `revokeGrant`, what happens to `auth.sessions` and `auth.refresh_tokens` rows for that client's `session_id`? | #1625 | The gate already requires both. If **neither** changes, #1625 is blocked and returns here. |
| P2 | Does `auth.sessions` record the OAuth client (column name)? | #1625 | Rely on the signed `client_id` claim only. |
| P3 | Can an OAuth access token call Auth `PUT /user`, `/logout`, `/factors`? | #1629 | Record it; it is a production blocker (PB-4), acceptable for synthetic staging users. |
| P4 | Does `withSupabase` enforce `iss`/`aud`, and what does it return on failure? | #1625 | Kilo's step 3 already checks `iss`. |
| P5 | Does `getAuthorizationDetails` skip consent for a previously approved client? | #1626 | See OD-1. |

## 12. Blockers and open decisions

Production blockers (none affect isolated staging):

- **PB-1 Site URL.** The authorization page is `Site URL + path`. Production's
  Site URL is shared with the co-tenant; pointing it at Kilo changes their auth
  emails and redirects.
- **PB-2 OAuth server and dynamic registration** are project-wide (F8).
- **PB-3 Asymmetric signing** is required (F7). The live project's algorithm was
  not inspected (unknown), and rotation affects every tenant.
- **PB-4 Shared user pool.** A Kilo user's OAuth token is `authenticated` in every
  schema. §6.2 isolates `kilo` only; co-tenant schemas and Auth endpoints (P3) need
  the co-tenant's own assessment.

Open decision (does not block #1625/#1627/#1628):

- **OD-1 Re-showing the disclosure.** If P5 shows Auth auto-approves remembered
  clients, re-authorization after `consent_stale` may skip Kilo's screen.
  Enforcement is unaffected. Options: accept, or have the withdrawal flow call
  `revokeGrant` for each grant (needs consent-UI scope). **Operator decision before
  #1626 handoff.**

Client compatibility target: **Claude Code** (`claude mcp add --transport http`)
against the local stack. It supports DCR with loopback redirects. MCP Inspector is
for development only. HTTPS-only clients need `kilo-mcp-staging`.

## 13. Sources (retrieved 2026-10-24)

- https://supabase.com/docs/guides/ai-tools/byo-mcp (modified 2026-10-23)
- https://supabase.com/docs/guides/auth/oauth-server/getting-started
- https://supabase.com/docs/guides/auth/oauth-server/oauth-flows
- https://supabase.com/docs/guides/auth/oauth-server/token-security
- https://supabase.com/docs/guides/auth/signing-keys
- `mobile/node_modules/@supabase/auth-js/dist/module/lib/types.d.ts` (2.108.2): `listGrants`, `revokeGrant`, `skipBrowserRedirect`
- Repository: `supabase/migrations/20260615120000_note_first_schema.sql`,
  `20260714120001_consent_schema.sql`, `20260926120000_restore_credentials_auth_lifecycle.sql`,
  `20260622120001_edge_rate_limit.sql`, `supabase/functions/_shared/rate-limit.ts`,
  `mobile/storage/cloud/transport.js`, `mobile/lib/units.js`, `mobile/app/AppShell.js`

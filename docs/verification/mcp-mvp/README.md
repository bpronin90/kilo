# MCP MVP: integration verification (#1629)

Isolated end-to-end demonstration of the read-only MCP MVP with synthetic users, run
against a disposable local stack. Setup, commands and the operator guide:
[`docs/operations/mcp-mvp.md`](../../operations/mcp-mvp.md) section G. Contract:
[`docs/architecture/mcp-mvp.md`](../../architecture/mcp-mvp.md).

## Tested head

| Item | Value |
| --- | --- |
| Result | see `results.json` (`passed` / `total`, full `testedSha`, date, versions) |
| Environment alias | `local stack, project id kilo_mcp_staging` (not production, not hosted) |
| Client | `@modelcontextprotocol/client` 2.4.0, the official MCP TypeScript SDK client. No other client was tested |
| Code under test | `supabase/functions/**` and `supabase/migrations/**` at `testedSha`; later commits on this branch change documentation and CI only |

`results.json` and `fixture-manifest.json` hold no tokens, codes, authorization ids,
cursors or response bodies; `node scripts/verify-mcp-mvp.mjs --check` enforces that.

## Acceptance coverage

| Criterion | Cases |
| --- | --- |
| Reproducible setup | `stack.sh`, `config.staging.toml`, pinned `deno.lock`; operations §G |
| Two users, direct-link sign-in, explicit approval, discovery, `whoami`, workout and weight reads in a named real client | B1 (real Kilo web build in Chromium: authorization link → sign-in → disclosure → Approve, then SDK reads), S1, C1, C2, C3, C5 (users `a` and `b`, one SDK client each), X1 |
| Refresh; disconnect then replay of an unexpired token; withdrawal before purge; regrant | R1, R2, D1, W1 |
| Anonymous/expired/malformed/wrong issuer, audience, client; denied request; missing consent; cross-user; deleted account; lookup outages (each proves no data RPC ran via function-call counters); malformed input; pagination; rate/size/time | N1, O1 (denied in the real browser), M1, X1, X2, A1, F1–F6, L1, Q1, Q2 |
| Honest empty/unknown coverage, unknown dates, unavailable original unit; exactly three read-only tools | C1, C3, C4 |
| Documentation (setup, disclosure, disconnect, troubleshooting, logs, teardown, rollback) | operations §G; log check G1 |
| Visual evidence | below |
| Pass/fail and operator blockers | this file |

## Visual evidence (#1626)

This run also captured the real Kilo web build at 390x844 (`screens/`: `approve-1-signed-out`,
`approve-2-disclosure`, `deny-1-signed-out`, `deny-2-disclosure`; the `-3-` files are the stubbed
client callback page and show no app UI). They are the same screens #1626 rendered, here driven
by a real sign-in. #1626's evidence remains the reference for the connections list and disconnect.

Rendered evidence: `docs/evidence/mcp-authorization/` (390x844, Chromium, commit
`ee2a01d6`). `mobile/` is unchanged on this branch. Between `ee2a01d6` and the merged
#1626 head, only `mobile/screens/mcp/McpConnectedClients.js` changed in code, and only
in behavior: the Auth client became an injected prop and disconnect confirmations are
bound to the account that opened them. The JSX and styles are identical, so the prior
renders still describe the pixels. No re-render in #1626 is required.

## Capture steps

1. `npm --prefix mobile ci` (once), then `bash supabase/functions/mcp/integration/stack.sh up`
2. `bash supabase/functions/mcp/integration/stack.sh web` (builds the web app against the stack; uses
   Cloudflare's always-pass Turnstile test key, so the sign-in form completes locally)
3. `node scripts/verify-mcp-mvp.mjs` (about 12 minutes; one PASS/FAIL line per case; needs Chromium)
4. `node scripts/verify-mcp-mvp.mjs --check`
5. `bash supabase/functions/mcp/integration/stack.sh down`

## Observations recorded (not Kilo guarantees)

- Re-approving a request id after it was denied returned HTTP 400 with no code (O1).
- Auth accepted a rotated-out refresh token after its reuse window; disconnect ended every chain (R2).
- An OAuth token reaches Auth `GET/PUT /user` and `POST /logout` (P3, production blocker PB-4).
- A slow database ends the read with a `timeout` tool error at the 3 s database-call limit; client-side
  measurements ranged 2.5–3.1 s across runs (F6).

## Not demonstrated (remaining blockers)

- **Hosted staging and HTTPS-only clients** (ChatGPT and similar): operator-owned
  (operations §B); nothing was run against a hosted project.
- **Claude Code and any client other than the SDK client:** untested, so no compatibility claim.
- **Browser-driven disconnect:** disconnect is exercised through Auth's `revokeGrant` endpoint (what the
  Account screen calls); the screen itself is evidenced by #1626's renders.
- **Consent screen with expired or reused request ids:** covered by #1626 evidence and unit tests only.
- **10 s whole-request deadline:** unit-tested only.
- **Production enablement:** out of scope; PB-1–PB-4 and the co-tenant assessment remain.
- **Umbrella #1587:** delivered only when the owner accepts the evidence; the items above are the gaps.

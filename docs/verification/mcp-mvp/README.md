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
| Two users, approval, discovery, `whoami`, workout and weight reads in a real client | S1, C1, C2, C3, X1 (users `a` and `b`) |
| Refresh; disconnect then replay of an unexpired token; withdrawal before purge; regrant | R1, R2, D1, W1 |
| Anonymous/expired/malformed/wrong issuer, audience, client; denied request; missing consent; cross-user; deleted account; lookup outages; malformed input; pagination; rate/size/time | N1, O1, M1, X1, X2, A1, F1–F6, L1, Q1, Q2 |
| Honest empty/unknown coverage, unknown dates, unavailable original unit; exactly three read-only tools | C1, C3, C4 |
| Documentation (setup, disclosure, disconnect, troubleshooting, logs, teardown, rollback) | operations §G; log check G1 |
| Visual evidence | below |
| Pass/fail and operator blockers | this file |

## Visual evidence (#1626)

Rendered evidence: `docs/evidence/mcp-authorization/` (390x844, Chromium, commit
`ee2a01d6`). `mobile/` is unchanged on this branch. Between `ee2a01d6` and the merged
#1626 head, only `mobile/screens/mcp/McpConnectedClients.js` changed in code, and only
in behavior: the Auth client became an injected prop and disconnect confirmations are
bound to the account that opened them. The JSX and styles are identical, so the prior
renders still describe the pixels. No re-render in #1626 is required.

## Capture steps

1. `bash supabase/functions/mcp/integration/stack.sh up`
2. `node scripts/verify-mcp-mvp.mjs` (prints one PASS/FAIL line per case)
3. `node scripts/verify-mcp-mvp.mjs --check`
4. `bash supabase/functions/mcp/integration/stack.sh down`

## Not demonstrated (remaining blockers)

- **Hosted staging and HTTPS-only clients** (ChatGPT and similar): operator-owned
  (operations §B); nothing was run against a hosted project.
- **Claude Code and any client other than the SDK client:** untested, so no
  compatibility claim.
- **Real-browser sign-in in this run:** the matrix performs the consent page's Auth calls
  directly; the page itself is evidenced by #1626's renders.
- **10 s whole-request deadline:** unit-tested only.
- **Production enablement:** out of scope; PB-1–PB-4 and the co-tenant assessment remain.
- **Umbrella #1587:** delivered only when the external-client, revocation, consent, RLS
  and visual items above are accepted by the owner; the missing items are listed here.

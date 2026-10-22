# Web Edge Function CORS (#1552) — verification evidence

Durable evidence for issue #1552. Sections marked **PENDING** require explicit
owner authorization to redeploy the four functions to production project
`ogzhnscdqcdrhfqcobuv`, plus owner-approved disposable test accounts; they are
not claimed until filled with real results.

## Before: production preflight probes (2026-10-21)

Read-only `OPTIONS` requests, no credentials, from a terminal (`curl`).
Request headers: `Access-Control-Request-Method: POST`,
`Access-Control-Request-Headers: authorization,content-type`, and the listed
`Origin` (`-` = header omitted). Response headers shown: status, `vary`,
`access-control-allow-*`.

Result: every endpoint answers 200 with allow-headers but **no
`Access-Control-Allow-Origin` for any origin**, including the production web
origin, so browsers block the subsequent POST. This is the defect.

```text
android-restore-credentials/v1/revoke | https://kilo-app.pages.dev | HTTP/2 200 ;vary: Accept-Encoding;access-control-allow-headers: authorization, x-client-info, apikey, content-type;
android-restore-credentials/v1/revoke | https://evil.example | HTTP/2 200 ;vary: Accept-Encoding;access-control-allow-headers: authorization, x-client-info, apikey, content-type;
android-restore-credentials/v1/revoke | https://abc123.kilo-app.pages.dev | HTTP/2 200 ;vary: Accept-Encoding;access-control-allow-headers: authorization, x-client-info, apikey, content-type;
android-restore-credentials/v1/revoke | null | HTTP/2 200 ;vary: Accept-Encoding;access-control-allow-headers: authorization, x-client-info, apikey, content-type;
android-restore-credentials/v1/revoke | - | HTTP/2 200 ;vary: Accept-Encoding;access-control-allow-headers: authorization, x-client-info, apikey, content-type;
account-export | https://kilo-app.pages.dev | HTTP/2 200 ;vary: Accept-Encoding;access-control-allow-headers: authorization, x-client-info, apikey, content-type;
account-export | https://evil.example | HTTP/2 200 ;vary: Accept-Encoding;access-control-allow-headers: authorization, x-client-info, apikey, content-type;
account-export | https://abc123.kilo-app.pages.dev | HTTP/2 200 ;vary: Accept-Encoding;access-control-allow-headers: authorization, x-client-info, apikey, content-type;
account-export | null | HTTP/2 200 ;vary: Accept-Encoding;access-control-allow-headers: authorization, x-client-info, apikey, content-type;
account-export | - | HTTP/2 200 ;vary: Accept-Encoding;access-control-allow-headers: authorization, x-client-info, apikey, content-type;
account-delete | https://kilo-app.pages.dev | HTTP/2 200 ;vary: Accept-Encoding;access-control-allow-headers: authorization, x-client-info, apikey, content-type;
account-delete | https://evil.example | HTTP/2 200 ;vary: Accept-Encoding;access-control-allow-headers: authorization, x-client-info, apikey, content-type;
account-delete | https://abc123.kilo-app.pages.dev | HTTP/2 200 ;vary: Accept-Encoding;access-control-allow-headers: authorization, x-client-info, apikey, content-type;
account-delete | null | HTTP/2 200 ;vary: Accept-Encoding;access-control-allow-headers: authorization, x-client-info, apikey, content-type;
account-delete | - | HTTP/2 200 ;vary: Accept-Encoding;access-control-allow-headers: authorization, x-client-info, apikey, content-type;
health-data-delete | https://kilo-app.pages.dev | HTTP/2 200 ;vary: Accept-Encoding;access-control-allow-headers: authorization, x-client-info, apikey, content-type;
health-data-delete | https://evil.example | HTTP/2 200 ;vary: Accept-Encoding;access-control-allow-headers: authorization, x-client-info, apikey, content-type;
health-data-delete | https://abc123.kilo-app.pages.dev | HTTP/2 200 ;vary: Accept-Encoding;access-control-allow-headers: authorization, x-client-info, apikey, content-type;
health-data-delete | null | HTTP/2 200 ;vary: Accept-Encoding;access-control-allow-headers: authorization, x-client-info, apikey, content-type;
health-data-delete | - | HTTP/2 200 ;vary: Accept-Encoding;access-control-allow-headers: authorization, x-client-info, apikey, content-type;
```

Reproduce:

```sh
B=https://ogzhnscdqcdrhfqcobuv.supabase.co/functions/v1
curl -s -o /dev/null -D - -X OPTIONS -H 'Origin: https://kilo-app.pages.dev' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: authorization,content-type' \
  "$B/account-export"
```

## Change

`supabase/functions/_shared/cors.ts` allowlists exactly `https://kilo-app.pages.dev`
(string equality), adds `Access-Control-Allow-Methods: POST, OPTIONS`, and sends
`Vary: Origin` on every response. No `Access-Control-Allow-Credentials`. All four
functions already spread `corsHeaders(req)` into every response they build
(success and error), so no entrypoint changes. Bearer validation in each
function is unchanged and remains the trust boundary.

Local regression coverage: `supabase/functions/_shared/cors.test.ts`,
`supabase/functions/android-restore-credentials/handler.test.ts` (browser-origin
section), `mobile/tests/android-restore-credentials-client.test.js` (web sign-out),
`mobile/tests/account-lifecycle-ui.test.js` (web export/delete),
`mobile/tests/health-consent.test.js` (purge-kick transport).

## Deployment record — PENDING owner authorization

- Authorization: _not yet granted_
- Functions: `android-restore-credentials`, `account-export`, `account-delete`, `health-data-delete`
- Deployed source SHA: _pending_
- Commands/results: _pending_ (`supabase functions deploy <name> --project-ref ogzhnscdqcdrhfqcobuv`; `verify_jwt = false` preserved from `supabase/config.toml`)
- Rollback target: redeploy the same four functions from `main` before this change (`9c8990ec`)

## After: production probes — PENDING deployment

Same matrix as above. Expected: ACAO `https://kilo-app.pages.dev` only for the
production origin; none for attacker, preview, `null`, or absent Origin;
allowed-origin unauthenticated POST returns a browser-readable 401 with no
protected action.

## Deployed browser flows — PENDING deployment and test accounts

At `https://kilo-app.pages.dev`, separate disposable accounts: sign-out
(including a controlled revoke-network failure, then a successful retry),
cloud export (contains only the test user's data), account deletion (account
cannot regain access), consent withdrawal + health-data deletion (access
blocked immediately, durable job queued, purge completes or reports pending).

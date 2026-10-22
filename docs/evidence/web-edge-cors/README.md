# Web Edge Function CORS (#1552) — verification evidence

Durable evidence for issue #1552.

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

## Deployment record (2026-10-21)

- Authorization: owner, in-session ("get it all done", following the request to
  authorize redeploying the four functions); the owner ran the deploy command
  themselves after the agent's attempt was held by a permission gate.
- Functions and resulting versions: `android-restore-credentials` v2,
  `account-export` v7, `account-delete` v8, `health-data-delete` v6
- Deployed source SHA: `6ea143435a1a1c1fe7a1cb865904ccb791a67a28` (PR #1554 head)
- Command: `supabase functions deploy <name> --project-ref ogzhnscdqcdrhfqcobuv --use-api`
  for each function; each returned `Deployed Functions.`
- Post-deploy `supabase functions list`: `verify_jwt` is `false` on all four
  (unchanged, matching `supabase/config.toml`). No other function, schema, or
  project Auth setting was touched.
- Rollback target: redeploy the same four functions from `9c8990ec` (`main`
  before this change).

## After: production probes (2026-10-21, post-deploy)

Same request matrix as the before section. Only the exact production origin
receives `Access-Control-Allow-Origin`; attacker, Pages preview, `null`, and
absent Origin receive none. `Vary` now includes `Origin` (the gateway merges it
with its own `Accept-Encoding`). No `Access-Control-Allow-Credentials`.

```text
android-restore-credentials/v1/revoke | https://kilo-app.pages.dev | HTTP/2 200 ;access-control-allow-origin: https://kilo-app.pages.dev;vary: Accept-Encoding, Origin;access-control-allow-methods: POST, OPTIONS;
android-restore-credentials/v1/revoke | https://evil.example | HTTP/2 200 ;vary: Accept-Encoding, Origin;access-control-allow-methods: POST, OPTIONS;
android-restore-credentials/v1/revoke | https://abc123.kilo-app.pages.dev | HTTP/2 200 ;vary: Accept-Encoding, Origin;access-control-allow-methods: POST, OPTIONS;
android-restore-credentials/v1/revoke | null | HTTP/2 200 ;vary: Accept-Encoding, Origin;access-control-allow-methods: POST, OPTIONS;
android-restore-credentials/v1/revoke | - | HTTP/2 200 ;vary: Accept-Encoding, Origin;access-control-allow-methods: POST, OPTIONS;
account-export | https://kilo-app.pages.dev | HTTP/2 200 ;access-control-allow-origin: https://kilo-app.pages.dev;vary: Accept-Encoding, Origin;access-control-allow-methods: POST, OPTIONS;
account-export | https://evil.example | HTTP/2 200 ;vary: Accept-Encoding, Origin;access-control-allow-methods: POST, OPTIONS;
account-export | https://abc123.kilo-app.pages.dev | HTTP/2 200 ;vary: Accept-Encoding, Origin;access-control-allow-methods: POST, OPTIONS;
account-export | null | HTTP/2 200 ;vary: Accept-Encoding, Origin;access-control-allow-methods: POST, OPTIONS;
account-export | - | HTTP/2 200 ;vary: Accept-Encoding, Origin;access-control-allow-methods: POST, OPTIONS;
account-delete | https://kilo-app.pages.dev | HTTP/2 200 ;access-control-allow-origin: https://kilo-app.pages.dev;vary: Accept-Encoding, Origin;access-control-allow-methods: POST, OPTIONS;
account-delete | https://evil.example | HTTP/2 200 ;vary: Accept-Encoding, Origin;access-control-allow-methods: POST, OPTIONS;
account-delete | https://abc123.kilo-app.pages.dev | HTTP/2 200 ;vary: Accept-Encoding, Origin;access-control-allow-methods: POST, OPTIONS;
account-delete | null | HTTP/2 200 ;vary: Accept-Encoding, Origin;access-control-allow-methods: POST, OPTIONS;
account-delete | - | HTTP/2 200 ;vary: Accept-Encoding, Origin;access-control-allow-methods: POST, OPTIONS;
health-data-delete | https://kilo-app.pages.dev | HTTP/2 200 ;access-control-allow-origin: https://kilo-app.pages.dev;vary: Accept-Encoding, Origin;access-control-allow-methods: POST, OPTIONS;
health-data-delete | https://evil.example | HTTP/2 200 ;vary: Accept-Encoding, Origin;access-control-allow-methods: POST, OPTIONS;
health-data-delete | https://abc123.kilo-app.pages.dev | HTTP/2 200 ;vary: Accept-Encoding, Origin;access-control-allow-methods: POST, OPTIONS;
health-data-delete | null | HTTP/2 200 ;vary: Accept-Encoding, Origin;access-control-allow-methods: POST, OPTIONS;
health-data-delete | - | HTTP/2 200 ;vary: Accept-Encoding, Origin;access-control-allow-methods: POST, OPTIONS;
```

Unauthenticated `POST` (body `{}`, no bearer) from the production origin:
each is a browser-readable 401 and performs no protected action (each function
rejects before any data access; see the bearer tests in PR #1554).

```text
android-restore-credentials/v1/revoke | HTTP/2 401 ;access-control-allow-origin: https://kilo-app.pages.dev;{"error":"Unauthorized"}
account-export | HTTP/2 401 ;access-control-allow-origin: https://kilo-app.pages.dev;{"error":"Unauthorized"}
account-delete | HTTP/2 401 ;access-control-allow-origin: https://kilo-app.pages.dev;{"error":"Unauthorized"}
health-data-delete | HTTP/2 401 ;access-control-allow-origin: https://kilo-app.pages.dev;{"error":"Unauthorized"}
```

## Deployed browser flows (2026-10-21)

Production web app `https://kilo-app.pages.dev` against the deployed functions
above. **Rendered web-app revision:** `c0d996ecacfe39901419925cc43b5bd3b2321f6c`
(GitHub deployment 7241150004, environment `production-web`, status `success`
at 2026-10-22T01:10:58Z, the latest production-web deployment). Screenshots were
captured 2026-10-22T01:21:20Z–01:26:29Z, inside that deployment's window; the
first-use walkthrough that revision added appeared, and was dismissed, in every
run. Headless Chromium (playwright-core 1.63, chromium-1243), viewport
390×844. Each flow used its own disposable account
`kilo-e2e-1552-<a|b|c>@kilo-e2e.invalid`, created through the Auth admin API
with a confirmed email (Turnstile cannot be passed by automation, and the
project mailer rejects reserved test domains); the resulting session was
injected into the app's `sb-…-auth-token` storage key. All other steps went
through the app UI. Results were cross-checked by refresh-token exchange and
read-only SQL on `auth.*` and `kilo.*`.

| Flow | Account | Calls (status, `Access-Control-Allow-Origin`) | Outcome |
| --- | --- | --- | --- |
| Sign-out, revoke network aborted | A | `revoke` aborted by the test harness | "Could not revoke Android restore key. Sign out again to retry." User stays signed in — fails closed. [a-02](a-02-revoke-failed.png) |
| Sign-out retry | A | `android-restore-credentials/v1/revoke` 200, ACAO `https://kilo-app.pages.dev` | "Signed out." [a-03](a-03-signed-out.png). Old refresh token → 400. SQL: 0 sessions, 0 unrevoked restore credentials. (`/auth/v1/logout` 403 afterwards is expected: the session was already revoked server-side.) |
| Cloud export | B | `account-export` 200, ACAO production | Payload contains only B's user id. Delivering the file then fails on web (`Share.share`, "Export failed.") — separate defect, [#1563](https://github.com/bpronin90/kilo/issues/1563). [b-04](b-04-export.png) |
| Account deletion | B | `account-delete` 200, ACAO production | Signed out to the sign-in screen [b-06](b-06-deleted.png). Old refresh token → 400; `auth.users` has 0 rows for B. |
| Consent grant + upload | C | `consent_grant` 200; one weight entry uploaded | Export showed only C's id across cloud tables. [c-11](c-11-uploaded.png) |
| Consent withdrawal + health-data deletion | C | `consent_withdraw` 200 (job queued, `deletion_pending`); `health-data-delete` 200 `{"ok":true,"status":"withdrawn"}`, ACAO production | "Cloud Sync is off. Your cloud health data is being deleted; your data on this device is untouched." [c-13](c-13-withdrawn.png). SQL: `weight_entries` 0, consent `withdrawn` with `cloud_data_deleted_at` set, job `complete`. |

### Visual comparison

#1552 changes no `mobile/` production source (`git diff origin/main...HEAD -- mobile/`
touches tests only), so no layout changes by construction. What changes is
which existing state the user reaches.

**Reference (original problem):** the issue's quoted web sign-out failure —
every sign-out ends on "Could not revoke Android restore key. Sign out again to
retry." because the browser rejects the revoke `fetch`. No screenshot was taken
before the function deploy. [a-02](a-02-revoke-failed.png) renders that exact
state on the revision above: the harness aborts the revoke request, which gives
the client the same rejected `fetch` (`TypeError`) a CORS block did, and the same
code path (`useAuthSession.signOut`).

**Checklist** (390×844, Account screen), recorded from the reference:

1. Status line in the existing status area below the legal links: left-aligned
   with the 16px screen gutter, existing body text size and muted colour.
2. Long status text wraps within the content width; no clipping and no
   horizontal overflow.
3. Sign Out button, Danger Zone card and legal links keep their order, spacing
   and sizes.
4. After a successful sign-out the screen returns to the signed-out Sign In form
   with its existing layout.

**Comparison:**

| State | Screenshot | Result |
| --- | --- | --- |
| Revoke rejected (reference / pre-fix state) | [a-02](a-02-revoke-failed.png) | Pass 1–3: message wraps over two lines at the gutter; button, Danger Zone and links unchanged. |
| Revoke allowed (fixed) | [a-03](a-03-signed-out.png) | Pass 4: the signed-out form renders; the user is no longer stuck. Before the fix this state was unreachable on web. |
| Account deleted | [b-06](b-06-deleted.png) | Pass 4: the same signed-out form after deletion. |
| Health-data deletion pending | [c-13](c-13-withdrawn.png) | Pass 1–2: the truthful pending copy wraps inside the Cloud Sync section; Danger Zone unchanged. |
| Cloud export | [b-04](b-04-export.png) | Server call passes (200, own data only). The visible "Export failed." is the separate delivery defect #1563, unchanged by #1552. |

Found during verification, outside #1552's scope:

- **Account deletion for any user with consent history returns 500**
  (`evidence_key_missing`): production lacks the `KILO_EVIDENCE_KEY` /
  `KILO_EVIDENCE_KEY_ID` function secrets, so `account-delete` correctly
  refuses to archive consent evidence without pseudonymization. Affects all
  platforms; operator action required. Reproduced with account C (CORS was
  fine: the 500 carried ACAO). Tracked separately.
- Follow-ups from the sign-in/sign-out audit: #1556–#1565.

Account B was deleted by the flow. Accounts A (signed out, no data) and C
(consent withdrawn, health data purged) remain until C can be deleted through
the app once the evidence key is configured.

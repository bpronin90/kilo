# MCP authorization: rendered evidence (#1626)

- **Rendered commit:** `ee2a01d6` (full SHA in the exact-head handoff). Later commits on
  this branch change only this evidence folder, so these renders still apply.
- **Viewport:** 390x844 @2x, Chromium (headless), web export of `mobile/`.
- **Reference:** no annotated design; checked against the issue's layout checklist and
  the Account / HealthDataConsent styling (shared `Button`, `body-md` text, 16 px side padding).

## Layout checklist (derived before coding) and result

| Check | Result |
| --- | --- |
| Content width aligned to the 16 px page gutter, column capped at 560 px | pass (02, 07) |
| Existing typography/spacing (`body-md`, 22 px line height, 12 px gaps, label-sm caps for section labels) | pass (02, 04) |
| Provider/client name wraps and is truncated at 80 chars, shown as plain text with "not verified by Kilo" | pass (02); long/markup names covered in `tests/mcp-authorization.test.js` |
| Approve and Deny visually distinct (filled vs outlined), both full width, 44 px+ | pass (02) |
| Failure messages readable and actionable, no raw provider text | pass (07) |
| Sign-out described separately from disconnect | pass (02, 04) |

## Captures

| File | State |
| --- | --- |
| `01-cold-load-signed-out.png` | direct navigation to `/oauth/consent` from the Auth authorize redirect, signed out (existing sign-in surface) |
| `02-approval.png` | same request after sign-in and a reload of the scrubbed URL: disclosure + Approve/Deny |
| `04-connected-clients.png` | Account → Connected AI clients, one approved client |
| `05-disconnect-confirm.png` | explicit disconnect confirmation |
| `06-revoked.png` | after Auth confirmed `revokeGrant`; the row is gone and the notice appears |
| `07-request-unusable.png` | an unknown/used request id (real Auth 404) rendered as the safe state |

## Capture steps

1. Local stack (scratch project, ports 56321/56322; not production): Supabase CLI 2.117.0, GoTrue
   v2.192.0, the repository `supabase/migrations`, `kilo` exposed in the API schemas, OAuth server and
   dynamic registration on, Site URL `http://localhost:8081`, authorization path `/oauth/consent`.
2. `EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:56321 EXPO_PUBLIC_SUPABASE_ANON_KEY=<local anon key> npm run export:web`,
   served from `dist` with an SPA fallback (every unknown path returns `index.html`, as Pages does).
3. Synthetic user (`@example.test`) created by the Auth API; `kilo.consent_grant` called with the active
   catalog revision; a client registered through dynamic registration with a loopback redirect URI.
4. The browser opened the PKCE authorize URL, was redirected to `/oauth/consent?authorization_id=…` and
   the query was removed from the visible URL (01). A session was stored for the synthetic user (the
   release build requires a Turnstile token for the password form, which cannot complete locally) and the
   page was reloaded: the same request resumed (02).
5. **Approve** → Auth returned the client redirect; the browser navigated to
   `http://localhost:33418/callback` carrying `code` and `state` (stubbed; values not recorded).
6. Account → Connected AI clients (04) → Disconnect → confirm (05) → success notice only after Auth
   resolved (06). `GET /auth/v1/user/oauth/grants` then returned 0 grants.
7. `/oauth/consent?authorization_id=unknown-request-id` signed in → safe state (07).

## Not covered here

- The server-side denial of an unexpired access token after disconnect is the #1625 gate, verified in
  its own probes (P1/P4 in `docs/architecture/mcp-mvp.md`); this flow does not issue tokens.
- A hosted (`kilo-mcp-staging`) project does not exist yet (operator prerequisite, #1629). The proof above
  ran against the local stack, which the contract names as the executable development target.
- A physical device was not used, by policy.

No tokens, authorization codes, authorization ids or email passwords are recorded in these files.

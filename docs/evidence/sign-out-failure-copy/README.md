# Retryable sign-out failure copy (#1558): visual evidence

Evidence for the Visual acceptance gate on issue #1558.

## State

The signed-in Account screen on the web build. The user taps Sign out while the
session is valid, and the server revoke request
(`POST /functions/v1/android-restore-credentials/v1/revoke`) returns HTTP 500.
This is the retryable revoke-failure path. The user stays signed in.

- Viewport: 390x844 (Chromium, playwright-core)
- Before build: `origin/main` at `6967ad41eaadfbf8f5e6ceb8a01fc6cba3537dd2`
- After build (rendered commit): `5aedea078e3d10eea9dd4b781bbe02ac8477d4a2`.
  Later commits on the branch add only this evidence directory, which cannot
  affect rendering.

## Layout checklist (recorded before coding)

Reference: `before-390x844-revoke-failed.png` (current failure state) and
`reference-390x844-signed-in.png` (signed-in Account screen).

1. The message stays in the existing `Account status` text below the legal
   links. Left edge x=16, full 358px content column, same font size and 16px
   line height.
2. The text wraps naturally inside that column. No clipping, no overflow, no
   horizontal page scroll (document `scrollWidth` 390).
3. The text stays above the floating tab bar.
4. No new controls. Sign out, Danger Zone, and spacing are unchanged.
5. The copy does not mention Android or a restore key. It does not say the user
   is signed out or that anything was revoked.

## Result

| | Before (`6967ad41`) | After (`5aedea07`) |
|---|---|---|
| Status | "Could not revoke Android restore key. Sign out again to retry." | "Could not complete sign-out. Please try again." |
| Network after tap | `POST .../v1/revoke` (500) | `POST .../v1/revoke` (500) |
| Status box | x=16 y=701 w=358 h=32 (2 lines) | x=16 y=701 w=358 h=16 (1 line) |
| Overflow | scroll = client size | scroll = client size |
| Signed in afterwards | yes (Sign out still shown, session kept) | yes (Sign out still shown, session kept) |

All five checklist items pass. The status line keeps the same position, column
width, and type size. The shorter copy fits on one line. The rest of the screen
is unchanged.

Screenshots: `after-390x844-revoke-failed.png` (after),
`before-390x844-revoke-failed.png` (before), `reference-390x844-signed-in.png`
(signed-in reference, captured from the before build).

## Reproduce

No production project or data is used. Each build points at the fake host
`https://localfake.supabase.co`, and `capture.mjs` intercepts every request to
that host. It also stubs the Turnstile script.

```sh
cd mobile
EXPO_PUBLIC_TURNSTILE_SITE_KEY=fake-evidence-site-key \
EXPO_PUBLIC_SUPABASE_URL=https://localfake.supabase.co \
EXPO_PUBLIC_SUPABASE_ANON_KEY=fake-anon-key \
  npx expo export -p web --output-dir /path/to/dist
python3 -m http.server 8742 -d /path/to/dist &
node ../docs/evidence/sign-out-failure-copy/capture.mjs http://127.0.0.1:8742/ after.png [signed-in.png]
```

`capture.mjs` seeds a valid fake session in `sb-localfake-auth-token`, opens
More > Account, and saves the signed-in screen if a third path is given. It then
makes the revoke request return 500, taps Sign out, and captures the status
line. The playwright-core import path is machine-local; change it for another
machine.

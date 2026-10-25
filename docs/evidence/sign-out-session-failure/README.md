# Sign-out with no revocation bearer (#1557): visual evidence

> **Historical images:** completed captures have been removed from the current tree.
> [Browse the preserved image snapshot](https://github.com/bpronin90/kilo/tree/f7cf024e488471136e11e76834570093b140eaec/docs/evidence/sign-out-session-failure/) at
> `f7cf024e488471136e11e76834570093b140eaec`; image filenames, counts and sizes below describe that snapshot.
> Capture scripts, fixtures and the verification record remain here.

Durable evidence for the Visual acceptance gate on issue #1557.

## State

The signed-in Account screen, then Sign out while the SDK's stored session has
an expired access token and its refresh is refused (400
`refresh_token_not_found`). `getSession()` then resolves `{ session: null,
error }`, which is the issue's primary fixture. auth-js removes the session and
emits `SIGNED_OUT`, so the screen moves to the existing sign-in form. That form
is the recovery path.

- Viewport: 390x844 (Chromium, playwright-core)
- Before build: `origin/main` at `1c647540fda8bd0dfb1bd9d84e70fe6bebc2a47b`
- After build (rendered commit): `e809243cfa8db634364c038166bfc372b119d887`.
  Later commits on the branch add only this evidence directory, which cannot
  affect rendering.

## Layout checklist (recorded before coding)

Reference: `reference-390x844-signed-in.png` (signed-in Account screen) and
`before-390x844-null-session.png` (current result for the failure state).

1. The status line stays in the existing `Account status` text below the
   controls: left edge x=16, the full 358px content column, same font size and
   line height (16px per line) as the current "Signed out." status.
2. The longer failure text wraps naturally inside that column. No clipping, no
   overflow, no horizontal page scroll (document `scrollWidth` 390).
3. The text is not hidden under the floating tab bar.
4. No new controls. The existing sign-in form, buttons, and spacing are unchanged.
5. Copy says sign-out was not completed and asks the user to sign in again. It
   does not say "Signed out" and does not claim the key was revoked.

## Result

| | Before (`1c647540`) | After (`e809243c`) |
|---|---|---|
| Status | "Signed out." (false: zero revoke calls) | "Sign-out could not be completed because your session could not be verified. Sign in again, then sign out." |
| Network after tap | `POST /auth/v1/token` only | `POST /auth/v1/token` only (no revoke without a bearer) |
| Status box | x=16 y=768 w=358 h=16 | x=16 y=736 w=358 h=48 (3 lines), scroll = client size |

Pass on all five checklist items. The status keeps the same left alignment,
column width, and type size. It wraps to three lines with no overflow, and its
bottom edge (y=784) sits exactly where the one-line status sat before, just above
the tab bar. Nothing else on the screen changed.

Screenshots: `after-390x844-null-session.png` (after), `before-390x844-null-session.png`
(before), `reference-390x844-signed-in.png` (signed-in reference).

## Reproduce

No production project or data is involved. Each build points at the fake host
`https://localfake.supabase.co`, and `capture.mjs` intercepts every request to
that host. It also stubs the Turnstile script so the signed-out form's
widget does not replace the status line.

```sh
cd mobile
EXPO_PUBLIC_TURNSTILE_SITE_KEY=fake-evidence-site-key \
EXPO_PUBLIC_SUPABASE_URL=https://localfake.supabase.co \
EXPO_PUBLIC_SUPABASE_ANON_KEY=fake-anon-key \
  npx expo export -p web --output-dir /path/to/dist
python3 -m http.server 8732 -d /path/to/dist &
node ../docs/evidence/sign-out-session-failure/capture.mjs http://127.0.0.1:8732/ after.png
```

`capture.mjs` seeds a valid fake session in `sb-localfake-auth-token`, opens
More > Account, and saves the signed-in screen when a third path argument is
given. It then rewrites the stored session with an expired token, makes
`/auth/v1/token` refuse refresh, taps Sign out, and centres the status line
before capturing. The playwright-core import path is machine-local, so adjust
it for another machine.

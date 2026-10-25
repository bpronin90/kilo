# Unusable auth error fallback (#1564): visual evidence

> **Historical images:** completed captures have been removed from the current tree.
> [Browse the preserved image snapshot](https://github.com/bpronin90/kilo/tree/f7cf024e488471136e11e76834570093b140eaec/docs/evidence/auth-error-fallback/) at
> `f7cf024e488471136e11e76834570093b140eaec`; image filenames, counts and sizes below describe that snapshot.
> Capture scripts, fixtures and the verification record remain here.

Evidence for the Visual acceptance gate on issue #1564.

## State

The signed-out Account screen on the web build. The user enters synthetic
credentials and taps Create Account. The sign-up request
(`POST /auth/v1/signup`) returns HTTP 500 with an empty JSON body `{}`. The
real supabase-js SDK turns that 500 into an `AuthRetryableFetchError` whose
message is the literal string `"{}"` (it JSON-stringifies the fetch
`Response`). This is the same message shape seen in the production report. No
mail is sent and no provider is contacted.

- Viewport: 390x844 (Chromium, playwright-core)
- Before build: `origin/main` at `9ce48d4ad495ff8fc976d6a08d1748d6bcf51474`
- After build (rendered commit): `49bb476ba5a1a19974ee981e62f083f4269d3403`.
  Later commits on the branch add only this evidence directory, which cannot
  affect rendering.

## Layout checklist

Reference: `before-390x844-signup-500.png` (current failure state) and
`reference-390x844-signup-form.png` (filled form before the tap).

1. The message stays in the existing `Account status` text below the legal
   links. Left edge x=16, 358px content column, 14px font, no screen edits.
2. The text wraps inside that column. No clipping, no overflow, no horizontal
   page scroll (document `scrollWidth` 390).
3. The text stays above the floating tab bar.
4. No new controls. The form, buttons, and spacing are unchanged. The
   confirmation-pending panel does not appear (the sign-up failed).
5. The text is readable copy, not `{}`, `[object Object]`, or provider
   internals, and it does not guess a cause or reveal whether the address
   exists.

## Result

| | Before (`9ce48d4a`) | After (`49bb476b`) |
|---|---|---|
| Status | `{}` | "Account could not be created. Try again later." |
| Network after tap | `POST /auth/v1/signup` (500) | `POST /auth/v1/signup` (500) |
| Status box | x=16 y=768 w=358 h=16, 14px | x=16 y=768 w=358 h=16, 14px |
| Overflow | scroll = client size | scroll = client size |
| Confirmation panel | not shown | not shown |

All five checklist items pass. The status line keeps the same position, column
width, and type size, and the fallback fits on one line above the tab bar. The
status line's closeness to the tab bar is unchanged from before; Account
feedback placement is owned by #1565.

## Reproduce

No production project or data is used. Each build points at the fake host
`https://localfake.supabase.co`, and `capture.mjs` intercepts every request to
that host. It also stubs Turnstile with a widget that issues a fake token.

```sh
cd mobile
EXPO_PUBLIC_TURNSTILE_SITE_KEY=fake-evidence-site-key \
EXPO_PUBLIC_SUPABASE_URL=https://localfake.supabase.co \
EXPO_PUBLIC_SUPABASE_ANON_KEY=fake-anon-key \
  npx expo export -p web --output-dir /path/to/dist
python3 -m http.server 8752 -d /path/to/dist &
node ../docs/evidence/auth-error-fallback/capture.mjs http://127.0.0.1:8752/ after.png [form.png]
```

The playwright-core import path is machine-local; change it for another
machine.

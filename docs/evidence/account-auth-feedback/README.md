# Account auth feedback placement (#1565): visual evidence

> **Historical images:** completed captures have been removed from the current tree.
> [Browse the preserved image snapshot](https://github.com/bpronin90/kilo/tree/f7cf024e488471136e11e76834570093b140eaec/docs/evidence/account-auth-feedback/) at
> `f7cf024e488471136e11e76834570093b140eaec`; image filenames, counts and sizes below describe that snapshot.
> Capture scripts, fixtures and the verification record remain here.

Evidence for the Visual acceptance gate on issue #1565. The issue moves the
Account status from its detached spot at the bottom of the screen into the auth
action block it belongs to, and makes it a polite live region.

## Setup (local only)

- Viewports: 390x844 (phone) and 1366x768 (laptop, see below), headless Chromium (playwright-core).
- Before build: `origin/main` at `1eb8bf71c0ba2a93aaa26b8d9f6ac615b8c529ff`.
- After build (rendered commit): `35da64282208257f2baa16bdfa7f26bbf0a23951`. The
  export ran from the working tree right before that commit, and no file under
  `mobile/` changed between the export and the commit. Later commits add only
  this evidence directory, which cannot affect rendering.
- Both builds point at the fake host `https://localfake.supabase.co`.
  [`capture.mjs`](capture.mjs) answers every request to that host, and it stubs
  Turnstile so it can fire the token and expiry callbacks itself. No production
  project, account, or data was used.

States, all rendered in the same Account screen:

| State | How it is produced |
|---|---|
| `signin-failure` | Signed out. Stub issues a token, then Sign In. `POST /auth/v1/token?grant_type=password` returns 400 `invalid_credentials`. |
| `captcha-expired` | Same form. Stub fires the Turnstile `expired-callback`. |
| `signout-failure` | A fake session is seeded in `sb-localfake-auth-token`, then Sign Out. The restore-key revoke function returns 503, so sign-out stops and the user stays signed in. |

The sign-out copy names Android on web. #1558 owns that wording; this issue
changes only where the message appears.

## Layout checklist (written from the before renders, before coding)

1. Signed out: the status is the next item after the last auth button
   (Continue with GitHub), above Privacy Policy / Terms of Service.
2. Signed in: the status sits directly under Sign Out, above the Danger Zone and
   the legal links.
3. Alignment: left edge x=16, full 358px content column, same as the buttons.
4. Spacing: one 12px gap above and below, matching Account's action column. No
   extra margin. An empty status adds no space.
5. Type: shared `body-md` (14px) with a 22px line height, the same as the
   Account notes, in a semantic theme color (`onSurface`).
6. Wrapping: long copy wraps within the column, with no clipping
   (scroll size equals client size) and no horizontal page scroll (`scrollWidth` 390).
7. Unchanged: inputs, CAPTCHA slot, buttons, Danger Zone, legal links, header.
8. Exactly one status node, inside an `aria-live="polite"` region.

## Result

| | Before (`1eb8bf71`) | After (`35da6428`) |
|---|---|---|
| Sign-in failure position | After the legal links, y=752, just above the floating tab bar | 12px under Continue with GitHub (y=697), above the legal links |
| CAPTCHA expiry position | Same detached spot, y=752 | Same spot as the sign-in failure, y=697 |
| Sign-out failure position | After the Danger Zone and the legal links, y=701 | Directly under Sign Out (403 = 391 + 12), Danger Zone 12px below |
| Box | w=358, h=32, 2 lines | w=358, h=44, 2 lines at 22px; scroll size equals client size |
| Type | 14px / normal, muted `rgb(90,104,122)` | 14px / 22px, `onSurface` `rgb(14,23,38)` |
| Live region | none | `aria-live="polite"` on the region wrapper |
| Status nodes | 1 | 1 |
| Page `scrollWidth` | 390 | 390 |

**Comparison: PASS** on checklist items 1 to 8. In `after-signout-failure.png`, the
Sign Out to Danger Zone gap is 12px on each side of the message, the same as
the 12px gap between Sign Out and the Danger Zone in the before render. In
`after-signin-failure.png`, the message wraps to two lines under the buttons. The
empty space between Password and Sign In is the CAPTCHA slot: the stub renders
no widget there, and that slot looks the same in the before render.

Screenshots: `before-*.png` and `after-*.png` for `signin-failure`,
`captcha-expired`, and `signout-failure`.

## Laptop viewport (1366x768)

The issue asks for the production report's viewport, or a laptop viewport if
that is unknown. The original report came from the user's desktop browser on
https://kilo-app.pages.dev, and no exact viewport was recorded, so 1366x768 was
chosen as the laptop viewport. The same builds, fake host, and `capture.mjs`
were used (`node capture.mjs <url> . <prefix> 1366x768`). The before render is
from `1eb8bf71c0ba2a93aaa26b8d9f6ac615b8c529ff` (the pre-change base) and the after
render is from `35da64282208257f2baa16bdfa7f26bbf0a23951` (the rendered commit;
nothing under `mobile/` has changed since). At this width, ScreenShell centres a
608px content column starting at x=379.

Checklist at 1366x768, for the same items 1 to 8 with the column at x=379, w=608:

| | Before (`1eb8bf71`) | After (`35da6428`) |
|---|---|---|
| Sign-in failure position | After the legal links, y=692 | 12px under Continue with GitHub (631 + 12 = 643), above the legal links |
| Sign-out failure position | After the Danger Zone and the legal links, y=613 | Directly under Sign Out (347 + 12 = 359), Danger Zone 12px below |
| Box | x=379, w=608, h=16 (1 line) | x=379, w=608, h=22 (1 line at 22px); scroll size equals client size |
| Type | 14px / normal, muted `rgb(90,104,122)` | 14px / 22px, `onSurface` `rgb(14,23,38)` |
| Live region | none | `aria-live="polite"` |
| Status nodes / page `scrollWidth` | 1 / 1366 | 1 / 1366 |

**Comparison: PASS** on items 1 to 8. The message fits on one line inside the
centred column, its left edge matches the buttons, and the inputs, buttons,
Danger Zone, legal links, and tab bar are unchanged. Screenshots:
`before-1366x768-signin-failure.png`, `after-1366x768-signin-failure.png`,
`before-1366x768-signout-failure.png`, `after-1366x768-signout-failure.png`.

## Accessibility check and its limits

Playwright's accessibility snapshot (`ariaSnapshot`) of the after build lists the
status text right after the buttons it belongs to and before the legal links (or
the Danger Zone). The DOM check shows the text sits inside a container with
`aria-live="polite"`. That container stays mounted, empty and out of flow, while
its branch is shown, so a later message is a change inside an existing region.
No real screen reader (NVDA, VoiceOver, TalkBack) was run, so this proves the
semantics are present, not that a particular screen reader speaks the message.
On native, `accessibilityLiveRegion` is honored by Android only. iOS has no
live-region prop, and its behavior is unchanged.

## Reproduce

```sh
cd mobile
EXPO_PUBLIC_TURNSTILE_SITE_KEY=fake-evidence-site-key \
EXPO_PUBLIC_SUPABASE_URL=https://localfake.supabase.co \
EXPO_PUBLIC_SUPABASE_ANON_KEY=fake-anon-key \
  npx expo export -p web --output-dir /path/to/dist
python3 -m http.server 8742 -d /path/to/dist &
node ../docs/evidence/account-auth-feedback/capture.mjs http://127.0.0.1:8742/ <outDir> after            # 390x844
node ../docs/evidence/account-auth-feedback/capture.mjs http://127.0.0.1:8742/ <outDir> after-1366x768 1366x768
```

The script prints each state's text, box, overflow, font, live-region value,
document order relative to nearby controls, and an accessibility-tree excerpt.
The playwright-core import path and the Chromium path are machine-local.

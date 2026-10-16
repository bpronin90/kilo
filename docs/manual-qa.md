# Device and Browser QA

For testers verifying installed native behavior and exported-browser boot. Automated checks cannot replace the human passes marked required below. Build procedures are in [Mobile Builds](mobile-builds.md).

Physical-device or emulator checks remain required for native layout, notification
delivery, OAuth/password-recovery deep links, and platform packaging. The
[coverage gaps](test-coverage.md#coverage-gaps) remain explicit limitations.

## Android Edge-to-Edge Device Matrix

Verify Android inset-safe behavior on the following combinations after any change
to `App.js` safe-area wiring, `ScreenShell.js`, or `TabBar.js`.

| API level | Nav mode | Cut-out | Light theme | Dark theme |
|-----------|----------|---------|-------------|------------|
| Android 15 | Gesture | absent | tab bar and content clear system bars | same |
| Android 15 | Gesture | present (corner/hole-punch) | interactive content not obscured | same |
| Android 15 | 3-button | absent | bottom nav bar not covered by tab bar | same |
| Android 16 | Gesture | absent | tab bar and content clear system bars | same |
| Android 16 | Gesture | present | interactive content not obscured | same |
| Android 16 | 3-button | absent | bottom nav bar not covered by tab bar | same |

For each combination, also verify:
- Keyboard-visible inputs (Log workout entry, Weight entry) remain reachable and unobscured.
- First and last scroll positions do not clip behind the tab bar or top status bar.
- System-bar icon appearance (light glyphs on dark chrome and vice versa) remains legible.


## Large-Screen and Resizing Matrix (#1126)

`MainActivity` is no longer portrait-locked and declares
`smallestScreenSize` in `configChanges` (via `mobile/app.config.js`), so
rotation, unfold, and split-screen resizes re-lay out the mounted React tree
instead of recreating the activity. `mobile/tests/adaptive-layout.test.js`
covers the column/tab-bar geometry, side-inset clearance, draft preservation
across simulated resizes, and the `Modal` orientation contract.

Optional manual matrix after changes to `ScreenShell.js`, `TabBar.js`,
`components/adaptiveLayout.js`, or a dialog layout (not an acceptance gate):

| Window | Expect |
|--------|--------|
| Phone portrait | geometry identical to pre-#1126 |
| Phone landscape | primary actions reachable by scrolling; cut-out side cleared |
| Tablet portrait / landscape | 640px centered column, tab bar aligned with it |
| Unfolded foldable, split-screen, freeform resize | same as tablet at ≥640px; phone layout below |

Across each transition, with a Log draft, an active workout/rest timer, a
pushed screen (Settings → Account), and an open dialog: the draft, active
session, navigation depth, and dialog all survive. Only the rest-timer preset
menu (anchored to a measured position) closes.

---

## Installable Preview Smoke Checklist

Before declaring the packaged preview ready, a human tester must pass every step below on a physical phone. This is the minimum real-device check for installability, launch, update/relaunch, loading behavior, and basic touch interaction. It is not full product QA.

1. Build and install the native preview APK on a connected phone.
   ```sh
   cd mobile && eas build --platform android --profile preview
   ```
2. Open the app from the phone launcher and confirm it starts without a crash or blank screen.  **[BLOCKER]**
3. Confirm all five tabs are visible and respond to taps: Home, Log, Weight, Analytics, More.  **[BLOCKER]**
4. On **Weight**, confirm the entry field and **Save weigh-in** button load, the button is disabled when the field is empty, and a valid value such as `185` saves successfully and updates Weight History.  **[BLOCKER]**
5. Fully close and reopen the installed app. Confirm it launches normally and the saved weight entry remains present.  **[BLOCKER]**
6. On **Log**, enter one simple workout row such as `135 5,5,5`. Confirm the parse preview appears, the header **Save** action becomes enabled, and saving shows the saved workout.  **[BLOCKER]**
7. Return to **Home** and confirm the new workout appears in recent history with the most recent entry first.  **[BLOCKER]**
8. Do one basic touch pass on the device: scroll recent history, switch tabs a few times, and confirm taps register cleanly without missed or stuck interactions.  **[BLOCKER]**

---

## Web Export Smoke Check

This is the minimum repeatable verification for the static web export path
(Phase 2 / Task 4, issue #313). It has two parts: a fast automated **pre-flight**
that only proves the static entrypoint is served, and a **required** manual
browser + local-data pass that actually proves the exported app boots and reads
and writes local data. It is intentionally narrow: it is a boot/local-data smoke
check, not full web E2E. No browser automation framework is added as a repo
dependency.

Boot is only considered verified once the required browser + local-data pass
below is performed. The automated pre-flight alone does not prove boot.

Dependency: relies on the static web export from Task 4 / #313
(`app.json` `web.bundler: "metro"` and `web.output: "single"`) being present
after merge. The pre-flight does not inspect or validate that config itself; it
fails fast with a clear message only if `expo export --platform web` does not
emit a `dist/index.html` single-output build.

### Automated pre-flight (`web:smoke`)

This is a fast pre-flight only. Run it first to catch gross export/serve
failures, but **do not** treat a pass as proof that the app boots or reads local
data — it does neither.

Run from the repo root:

```sh
npm run web:smoke
```

This single command:

1. Builds the static web export (`expo export --platform web`) into
   `mobile/dist/`.
2. Asserts `mobile/dist/index.html` exists (proves a single-output web build,
   not a native bundle).
3. Serves the exported output locally with `expo serve` on port `8099`.
4. Fetches the served entrypoint and confirms it is served: an HTTP `200`, the
   `root` mount node in the static HTML, and a referenced `_expo/static/js`
   bundle.
5. Prints `SMOKE PASS` and exits `0` on success, or `SMOKE FAIL: <reason>` and
   exits non-zero so a human or CI runner can gate on it.

What this pre-flight does **not** prove: it never executes the JS bundle, never
observes React Native Web mounting, and never exercises local-data
(AsyncStorage/`localStorage`) behavior. It only confirms the static entrypoint is
served. It can still pass with a bundle that crashes before mount. Use it as a
cheap gate, then run the required pass below for actual boot verification.

### Required browser + local-data boot verification (human)

This is the authoritative boot check. The export is not considered verified until
this pass succeeds. It must be performed in a real browser against the served
export.

```sh
npm run web:export   # build the static export into mobile/dist/
npm run web:serve    # serve mobile/dist/ at http://127.0.0.1:8081/
```

Open `http://127.0.0.1:8081/` in a browser, then:

1. Confirm the app shell **visibly mounts**: the Kilo Home screen renders with
   real content (Welcome card and the five tabs Home, Log, Weight, Analytics,
   More), not just an empty `#root` and no blank screen or console boot crash.
   An empty or text-less `#root` is a failure even if the pre-flight passed.
2. On **Weight**, enter a value such as `185` in the Weight (lb) field and tap
   **Save weigh-in**. Confirm it appears in the History list (the local browser
   storage write path works). Optionally confirm the browser dev tools show a
   `kilo_weight_entries` key in `localStorage`/IndexedDB (the AsyncStorage web
   backend).
3. Reload the page and confirm the saved entry **persists** in the History list
   and trends, proving the export boots against local data rather than a fresh
   empty shell.

Stop and reload from native QA if the served export cannot mount the shell or the
saved entry does not survive reload; that indicates a Task 4 export-config or
local-data regression rather than a smoke-tooling issue.

### Static hosting note

The exported `mobile/dist/` is the static artifact for the documented hosting
target (Cloudflare Pages, Netlify, Vercel static output, or equivalent). The
selected host must serve `index.html` as the SPA fallback entrypoint. `expo
serve` is the local stand-in for that static host during smoke verification; it
is not a production hosting dependency.

`mobile/public/_headers` is copied into the static export and is the Cloudflare
Pages security-header contract. It applies a CSP with `frame-ancestors 'none'`,
same-origin application scripts plus the exact Turnstile challenge origin,
narrowly allow-listed Supabase/Auth, Turnstile, and Sentry data connections, and
no `unsafe-eval`; it also denies unused browser capabilities through
`Permissions-Policy`. After export, confirm `mobile/dist/_headers`
exists. After deployment, inspect the actual entrypoint response and confirm at
least `Content-Security-Policy`, `Permissions-Policy`,
`X-Content-Type-Options`, and `X-Frame-Options` are present. Cloudflare `_headers`
does not apply to Pages Functions responses, so a future Worker/Functions path
must set the same policy in its own response code.

---

## Android Restore Credentials Migration/Restore Test Flow

These steps verify the end-to-end Android Restore Credentials lifecycle added in
issue #1159. All steps require a physical Android device and a configured cloud
build (Supabase URL + anon key present).

> **Re-auth timing conflict:** step 2 retains the inherited ">5 minutes" fixture,
> while [Account Security](account-security.md#android-restore-credentials-trust-boundary)
> specifies a ten-minute fresh-auth boundary for #1162. Use a definitely expired
> sign-in (>10 minutes) when executing this negative check; this refactor does
> not redefine the server authentication policy.

**Enrollment (on the source device):**

1. Sign in with email/password on Android. After sign-in, enrollment fires
   automatically in the background. Verify by checking the server security event
   log for `restore.enrolled` and confirming
   `AsyncStorage.getItem('kilo.auth.androidRestoreCredentialId')` is populated.
2. Verify that a #1162 re-auth refusal (sign in, wait >5 minutes, sign in again
   without a fresh session) does not create a credential: the successful second
   sign-in is preserved but no `kilo.auth.androidRestoreCredentialId` entry
   appears.

**Restore (on a target device after Android backup/restore):**

3. After restoring the device from an Android backup that includes the source
   device's app data, open Kilo in the signed-out state. The app should detect
   a restore credential is available.
4. Trigger `androidRestoreSession()` via the UI path. Confirm the session
   transitions to signed-in (user ID matches the source device's account) and
   the server security event log records `restore.session_issued`.
5. Confirm that a failed restore (e.g., tampered assertion) leaves the app
   signed out with no partial session in secure storage.

**Sign-out revocation:**

6. While signed in on Android, sign out. Confirm the security event log records
   `restore.revoked`, the device's AsyncStorage entry for the credential ID is
   cleared, and a subsequent restore attempt on the same device returns
   "No restore credential."
7. Attempt to re-use the revoked credential directly (e.g., by restoring
   AsyncStorage from backup): confirm the server rejects the restore-verification
   with a 401 and the app remains signed out.

**Account deletion:**

8. Delete the account via the in-app flow. Confirm the device credential and
   AsyncStorage entry are cleared. Confirm no additional `/v1/revoke` client
   call is made (the server revokes at deletion step 0). A failed device clear
   is recorded but does not block deletion.

# Public Auth Activation

For operators opening or verifying public sign-in, signup, recovery, and OAuth. Keep unverified paths unavailable. Database deployment belongs to [Backend Activation](backend-activation.md).

## Public Auth And Abuse Controls

Open signup must not go live until every applicable control in this section has
been configured and verified. If a check cannot be completed, keep that public
Auth path unavailable.

### CAPTCHA

**Requirement:** CAPTCHA must be enabled on sign-in, signup, and password recovery
before open signup. Kilo uses
[Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/), a bot check
that runs inside the existing web page or native WebView. The app does not need to
move behind Cloudflare for Turnstile to work.

The client integration is already implemented. An operator still has to create or
recover the Turnstile widget, place its public values in the builds, and enable its
secret in Supabase. Complete the following steps in order. Enabling Supabase first
will break password Auth in every deployed client that does not yet have Turnstile.

#### 1. Choose the two origins

Write down these values before opening any dashboard:

- `WEB_HOSTNAME`: the hostname users open for the deployed web app, without
  `https://`, a port, or a path. Example: `app.example.com`.
- `NATIVE_ORIGIN`: a stable HTTPS origin that Kilo's native WebView may claim.
  Use the web app's production origin unless there is a reason to maintain a
  separate native hostname. Example: `https://app.example.com`.

Cloudflare's hostname field receives `app.example.com`; Kilo's
`EXPO_PUBLIC_TURNSTILE_ORIGIN` receives `https://app.example.com`. Do not use a
changing branch-preview URL for `NATIVE_ORIGIN`. Cloudflare's
[hostname rules](https://developers.cloudflare.com/turnstile/additional-configuration/hostname-management/)
do not accept schemes, ports, paths, or wildcard characters. Adding a hostname
also authorizes its subdomains.

#### 2. Create or recover the Cloudflare widget

1. Sign in to the [Cloudflare dashboard](https://dash.cloudflare.com/), open
   **Turnstile**, and look for an existing Kilo widget from the earlier CAPTCHA
   attempt.
2. If one exists and its secret is still trusted, select it and use **Settings →
   Hostname Management → Add Hostnames**. Otherwise select **Add widget** and name
   it `Kilo production`.
3. Choose the **Managed** widget mode.
4. Add `WEB_HOSTNAME`. If `NATIVE_ORIGIN` uses a different hostname, add that
   hostname too. For Cloudflare Pages previews, adding the stable
   `<project>.pages.dev` hostname covers its subdomains.
5. Save the widget and copy both generated values temporarily:
   - **Sitekey**: public; this goes into client build configuration.
   - **Secret key**: private; this goes only into Supabase Auth.

Never paste the secret key into this repository, `mobile/.env`, EAS, GitHub
Actions variables or secrets, an issue, a PR, or chat. If the previous secret's handling
is uncertain, rotate it in Cloudflare and use the replacement below. Cloudflare's
[setup guide](https://developers.cloudflare.com/turnstile/get-started/) explains
the public-sitekey/private-secret split.

#### 3. Configure local and hosted client builds

The two `EXPO_PUBLIC_` values below are intentionally public. Do not substitute
the Turnstile secret for either one.

For local testing, add these lines to the gitignored `mobile/.env`:

```dotenv
EXPO_PUBLIC_TURNSTILE_SITE_KEY=<Cloudflare Sitekey>
EXPO_PUBLIC_TURNSTILE_ORIGIN=https://<stable-native-hostname>
```

For native EAS builds:

1. Open [expo.dev](https://expo.dev/) → the `kilo-native` project → **Project
   settings → Environment variables → Add variables**.
2. Create `EXPO_PUBLIC_TURNSTILE_SITE_KEY` with the Sitekey, project scope,
   plaintext visibility, and both the **preview** and **production** environments.
3. Create `EXPO_PUBLIC_TURNSTILE_ORIGIN` with `NATIVE_ORIGIN`, project scope,
   plaintext visibility, and both the **preview** and **production** environments.
4. Confirm both names appear in each environment. The repository's EAS profiles
   already select `preview` or `production` as appropriate.

For the web build, which GitHub Actions builds and uploads to Cloudflare Pages
(see [Web Deployment](web-deployment.md)):

1. Open GitHub → the repository → **Settings → Secrets and variables → Actions →
   Variables**.
2. Set the repository variable `EXPO_PUBLIC_TURNSTILE_SITE_KEY` to the Sitekey.
   Use a variable, not a secret.
3. The web build does not need `EXPO_PUBLIC_TURNSTILE_ORIGIN`; it uses the page's
   current origin.
4. Redeploy (Actions → **Web Deploy** → Run workflow with the current `main`
   SHA). The value is embedded at build time, so changing the variable does not
   alter an existing deployment.

These are public values because Expo embeds `EXPO_PUBLIC_` variables in the app
bundle. See Expo's
[environment-variable guidance](https://docs.expo.dev/eas/environment-variables/manage/).

#### 4. Build replacements before enabling Supabase

From `mobile/`, create and install a fresh build for every release surface that
users can access:

```sh
npm run build:android:preview
npm run build:android:production
npm run build:ios:device
```

Run only the platform builds Kilo currently distributes. Clients older than the
`preview-6` update boundary cannot receive current OTA bundles; replace those
native builds before relying on remote delivery. Do not enable Supabase CAPTCHA
until the new web deployment is live and compatible native builds are ready for
the intended users.

#### 5. Enable the secret in Supabase

1. Open the Supabase Dashboard and select the shared production project.
2. Go to **Authentication → Settings → Bot and Abuse Protection**.
3. Select **Cloudflare Turnstile** as the CAPTCHA provider.
4. Paste the Cloudflare **Secret key** into the secret field.
5. Turn on **Enable CAPTCHA protection** and save.

This is the only destination for the secret. Supabase performs the server-side
token validation; do not also create a client or EAS secret. See Supabase's
[CAPTCHA activation guide](https://supabase.com/docs/guides/auth/auth-captcha).

#### 6. Verify before opening signup

Use a private browser window and a physical preview build. Test all three flows:

- Sign in with email and password.
- Create a test account with email and password.
- Request a password-reset email.

Each flow must display the security check and complete successfully. Submit a
second request in the same screen and confirm it receives a fresh challenge rather
than reusing the prior token. Then confirm the production web deployment and the
replacement native build behave the same way.

Stop and keep public password Auth closed if any of these occurs:

- **“Security verification is unavailable in this build”**: the Sitekey is absent
  or invalid, or a native build lacks a valid HTTPS `NATIVE_ORIGIN`. Correct the
  build variables and build/deploy again.
- **Cloudflare error 110200 / domain not authorized**: the current hostname is
  missing from the widget's Hostname Management list.
- **Supabase rejects a completed challenge**: confirm the Supabase provider is
  Cloudflare Turnstile and the secret belongs to the same widget as the Sitekey.
- **Only an old installed app fails**: replace it with the new native build; OTA is
  deliberately unavailable.

#### What the app already does

The frontend renders a widget for every password Auth form and passes the
one-use token into Supabase:

```js
supabase.auth.signUp({ email, password, options: { captchaToken } })
supabase.auth.signInWithPassword({ email, password, options: { captchaToken } })
supabase.auth.resetPasswordForEmail(email, { captchaToken })
```

The #796 client consumes each token once and asks for a new token after completion,
expiry, or error. Release builds fail closed when the Sitekey or native origin is
missing. Do not work around that failure by disabling CAPTCHA.

### Production SMTP

**Requirement:** Custom SMTP must be configured before production email signup or password-recovery flows are reachable by users.

The built-in Supabase SMTP relay is a shared dev aid: low per-hour rate limits, unbranded sender, and not suitable for production delivery.

**Dashboard location:** Authentication → Settings → Email → SMTP Settings

Provide: SMTP host, port (587 with STARTTLS or 465 with SSL), sender address from a verified sending domain, SMTP username, and SMTP password.

Supported providers: SendGrid, Postmark, Resend, or any SMTP-capable transactional email service. The sending domain must have SPF and DKIM records verified with the provider before production use.

**Release verification:** Trigger a password-recovery email from the production project. Confirm the email arrives from your branded sending domain (not `noreply@mail.app.supabase.io`) and is not throttled by a shared relay rate limit.

**Closed-beta deferral:** If password recovery and email signup are not reachable by public users, record: `SMTP: deferred — password recovery and email signup not publicly reachable. Configure before enabling.` Re-evaluate before open signup.

### Published Privacy Policy and Terms of Service

**Requirement:** Published privacy policy and terms of service documents must be live and linked from the auth surface, Account lifecycle surface, and More > About before open public signup.

**Published URLs:**
- Privacy Policy: `https://bpronin90.github.io/privacy.html`
- Terms of Service: `https://bpronin90.github.io/terms.html`

**Release verification:** Open each URL and confirm it resolves to the published document. Run `grep -r 'example.com' mobile/screens/MoreScreen.js mobile/components/AboutScreen.js` and confirm no results.

### GitHub OAuth Provider

**Requirement:** Configure GitHub OAuth before exposing the Continue with GitHub
action on web or Android.

**GitHub setup:**

1. In GitHub, create an OAuth App for Kilo.
2. Set the homepage to the production web origin
   (`https://kilo-app.pages.dev`; see [Web Deployment](web-deployment.md)). When
   `https://kilofitnesstracker.com` goes live, update it there; until the owner
   completes that cutover, `pages.dev` remains the configured origin.
3. Set the authorization callback to
   `https://<project-ref>.supabase.co/auth/v1/callback`.

GitHub returns to Supabase first. Supabase then redirects the completed flow back
to the allow-listed client URL.

**Supabase setup:**

1. In Authentication → Providers → GitHub, enable the provider and enter the
   OAuth App client ID and secret.
2. In Authentication → URL Configuration, allow the production web origin
   (`https://kilo-app.pages.dev/**`), required local web origins, and `kilo://auth/callback`.
   For the custom domain also allow `https://kilofitnesstracker.com/**` and add
   its hostname to the Turnstile widget; keep `pages.dev` during migration. These
   are owner-side steps and are not done by deploying code.
3. Keep the GitHub client secret in provider configuration only; never expose it
   to the app.

**Release verification:**

- On web, complete Continue with GitHub and confirm the browser returns to the
  deployed origin in a signed-in state.
- In an installed Android development or preview build, complete the browser
  flow and confirm `kilo://auth/callback` returns to Kilo and the PKCE code is
  exchanged for a session.
- Verify cancellation, provider failure, missing callback data, and session
  exchange failure return readable errors. Expo Go cannot prove the custom
  native callback.

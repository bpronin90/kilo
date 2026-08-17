# Backend Activation Runbook

Status: current operator procedure for deploying and activating Kilo's optional
Supabase backend in the shared production project.

This document owns migration deployment, Data API exposure, client
configuration, public Auth-provider setup, and operational verification. Schema
meaning and ownership rules live in [Backend Schema](backend-schema.md);
historical sequencing lives in the
[archived backend roadmap](archive/backend-roadmap.md).

## Preconditions

- You have authorized operator access to the target Supabase project.
- The Supabase CLI and Docker are available for local migration verification.
- The target project is positively identified before any command is run.
- Kilo owns only the `kilo` schema. Do not modify `public`, `raw`,
  `canonical`, `serving`, `serving_stage`, `legacy`, or `ops`.
- Secrets remain outside source control. A service-role or secret key must never
  enter the mobile client, a committed environment file, an issue, or a log.

## 1. Validate The Migration Set Locally

The ordered files under `supabase/migrations/` are the database source of
truth. Do not apply only the original baseline migration and do not reproduce
later changes by hand.

From a disposable local Supabase stack:

```sh
supabase db reset --local --no-seed
node scripts/run-pgtap-suite.mjs
```

A reset must apply the full migration chain successfully. The test runner must
discover and pass every planned pgTAP file; skips, TODOs, parse errors, and
zero-test plans are failures.

## 2. Apply Pending Migrations

Link the CLI to the intended project, then inspect the exact pending set before
changing remote state:

```sh
supabase migration list
supabase db push --dry-run
```

Review pending migrations by filename and SQL ownership. Every Kilo migration
must be limited to the `kilo` schema plus deliberate read-only references to
Supabase-managed `auth` objects. The production project is shared, so unrelated
migration-ledger rows belonging to co-tenants are expected.

Apply the reviewed pending set through migration tooling:

```sh
supabase db push
```

Supabase records applied migrations in
`supabase_migrations.schema_migrations`; do not bypass that ledger with ad hoc
remote SQL. After deployment, run the repository drift check with the approved
read-only connection:

```sh
npm run check:migrations
```

The drift check compares migration identity by name and Kilo-owned SQL. Extra
live migrations from the co-tenant application are not Kilo drift.

## 3. Expose The `kilo` Schema

Add `kilo` to the project's exposed schemas in the Supabase API settings.
Leave every other schema entry unchanged.

Exposure and authorization are separate controls. The schema needs Data API
exposure for the client, but `anon` receives no Kilo grants. Tables reachable
by authenticated clients must retain RLS and owner-scoped policies.

## 4. Configure The Client

Set these public client values in the deployment environment or a gitignored
`mobile/.env`:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

Use the project URL and publishable client key. Never use a service-role or
secret key. Restart the Expo bundler after changing local values.

When either value is absent, the Supabase client factory returns no client and
the app remains local-only. Configuration does not itself authorize cloud
health-data access: the user must also sign in, resolve local-data ownership,
and grant the active health-data consent revision.

## 5. Verify Activation

Before relying on the backend:

1. Confirm the full repository migration set is present in the remote migration
   ledger and `npm run check:migrations` passes.
2. Confirm RLS is enabled on every client-reachable Kilo table.
3. As two authenticated test users, prove each can read and mutate only their
   own rows.
4. Confirm an unauthenticated Data API request to `kilo` is denied.
5. Confirm signed-out and unconfigured app sessions remain local-only.
6. Run the relevant account, consent, sync, export, deletion, and bounded-write
   checks for the release being activated.

A schema count or table count is not an activation invariant; the migration set
evolves. Verify migration identity, RLS/grants, and behavior instead.

## Deactivation And Recovery

- To disable cloud use in a client without changing stored cloud data, remove
  the two public Supabase environment values and rebuild/restart the client.
- Do not re-run an individual historical migration against an existing schema.
- Do not drop the `kilo` schema as a routine rollback. Production rollback
  requires a reviewed forward migration or an explicit disaster-recovery plan.
- Never change another application's schemas, Auth settings, extensions, or
  roles as part of Kilo recovery.

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

Never paste the secret key into this repository, `mobile/.env`, EAS, Cloudflare
Pages build variables, an issue, a PR, or chat. If the previous secret's handling
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

For the Cloudflare Pages web build:

1. Open Cloudflare → **Workers & Pages** → the Kilo Pages project → **Settings →
   Environment variables**.
2. Add `EXPO_PUBLIC_TURNSTILE_SITE_KEY` with the Sitekey to both preview and
   production build environments.
3. The web build does not need `EXPO_PUBLIC_TURNSTILE_ORIGIN`; it uses the page's
   current origin.
4. Trigger a new preview/production deployment. The value is embedded at build
   time, so changing the variable does not alter an existing deployment.

These are public values because Expo embeds `EXPO_PUBLIC_` variables in the app
bundle. See Expo's
[environment-variable guidance](https://docs.expo.dev/eas/environment-variables/manage/)
and Cloudflare Pages'
[build-variable instructions](https://developers.cloudflare.com/pages/configuration/build-configuration/).

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
2. Set the homepage to the production web origin.
3. Set the authorization callback to
   `https://<project-ref>.supabase.co/auth/v1/callback`.

GitHub returns to Supabase first. Supabase then redirects the completed flow back
to the allow-listed client URL.

**Supabase setup:**

1. In Authentication → Providers → GitHub, enable the provider and enter the
   OAuth App client ID and secret.
2. In Authentication → URL Configuration, allow the production web origin,
   required local web origins, and `kilo://auth/callback`.
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

## Relationship To Other Docs

- `docs/backend-schema.md` owns the schema structure and the naming, source-of-truth, ownership, and isolation **policy** that schema changes must follow. Consult it for what the tables, columns, RLS, and grants mean.
- `docs/archive/backend-roadmap.md` preserves the completed implementation sequence. It is historical, not an operational authority.
- This document owns the current activation and provider-configuration procedure.

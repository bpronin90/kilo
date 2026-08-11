# Backend Activation Runbook

This doc is the canonical, repeatable, operator-facing procedure for turning Kilo's Supabase backend on inside the shared `anime-streaming-tracker` project. It owns the activation procedure only: how to apply the schema, expose it, point the client at it, and verify isolation, plus how to revert and what safety invariants must never break.

This activation has already been performed once against the shared project; the steps below describe the same procedure so it can be repeated (for example, against a fresh project or after a reset) with the same result.

For schema structure and the naming/ownership/isolation policy, see `docs/backend-schema.md`. For phase sequencing and the broader backend contract, see `docs/archive/backend-roadmap.md`. This doc does not duplicate either; it is the runbook that switches the shipped foundation on.

## Preconditions

- The Phase 3 backend foundation is merged (v0.70.0+): the note-first migration, the auth/session client, and the storage-seam adapter are present in the tree.
- You have operator access to the shared Supabase project (migration + API-settings permissions).
- `kilo` is the only Kilo-owned schema. Kilo must **never** create, read, or write `public`, `raw`, `canonical`, `serving`, `serving_stage`, `legacy`, or `ops` — those belong to the anime-tracker app. The only cross-schema reference Kilo makes is read-only to the Supabase-managed `auth` schema.
- You understand the isolation posture before applying anything: RLS scopes every row to its owner, `authenticated` gets RLS-scoped DML, `service_role` gets full access for future server-owned code, and `anon` is never granted.

## Step 1: Apply The Migration

Apply `supabase/migrations/20260615120000_note_first_schema.sql`. This creates the `kilo` schema, the seven note-first tables, their indexes, enables RLS on every table, and installs the owner-scoped policies and grants.

- **Dry-run first.** Before the real apply, prove isolation in a transaction-rollback dry run: run the migration body inside a transaction and roll it back, confirming it creates only `kilo` objects and touches nothing in the other app's schemas. The first apply against the shared project was gated on this dry run passing.
- Apply via the Supabase migration tooling (Supabase CLI migration path or the MCP `apply_migration` tool). Do not hand-run ad-hoc SQL outside the migration file; the migration file is the source of truth for the schema.
- Expected applied state, verified live after the first apply:
  - 7 tables in `kilo`: `user_profile`, `feature_toggles`, `weight_entries`, `weight_goal`, `workout_notes`, `deload_history`, `fatigue_checkins`.
  - RLS enabled on all 7 tables.
  - 28 owner-scoped policies (select/insert/update/delete on each of the 7 tables), each restricting rows to `user_id = auth.uid()`.
  - Grants: schema `usage` plus RLS-scoped `select/insert/update/delete` to `authenticated`; schema `usage` plus full (`all`) access to `service_role`.
  - No grant of any kind to `anon`.

The migration creates objects with `create ... if not exists`, but its policy and grant statements are not guarded; treat a re-apply as needing a clean state (see Revert And Safety Notes).

## Step 2: Expose The `kilo` Schema

A custom schema is not reachable through the auto-generated REST API until it is added to the project's exposed schemas. This is a project-config step, not part of the migration.

- Add `kilo` to the exposed schemas via the Dashboard (API settings) or `config.toml` `[api] schemas`.
- Leave the other app's schemas exactly as they are; only add `kilo`.
- Exposing the schema does **not** open it to the public. Because `anon` holds no grants, an unauthenticated REST call against `kilo` is correctly rejected. After the first activation, an `anon` REST call returns `401 permission denied for schema kilo` — schema exposed, `anon` locked out by design. That response is the expected, healthy state, not a misconfiguration.

## Step 3: Set The Client Env

The app reads its Supabase connection from two environment variables and stays local-only when they are unset.

- Set both in `mobile/.env` (gitignored):
  - `EXPO_PUBLIC_SUPABASE_URL`
  - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- Use the project URL and the modern publishable key (the `sb_publishable_...` form) for the anon key. Never use, embed, or commit a `service_role` key on the client.
- **Never commit secrets.** Keep these values in the gitignored `mobile/.env` only. No URL, key, or secret belongs in this doc, in source, or in version control.
- Restart the Expo dev server after changing `mobile/.env` — env values are read at bundler start, so a running server will not pick up new values until it is restarted.
- When either variable is unset, `getSupabaseClient()` returns null and the app runs in local-only (AsyncStorage) mode. Setting both is what opts the client into cloud mode.

## Step 4: Verify

Confirm activation end to end before relying on it.

- **Authenticated user sees only their own rows.** Sign in as a test user and confirm select/insert/update/delete reach only rows where `user_id = auth.uid()`. A second test user must not see or mutate the first user's rows. This is RLS doing its job on top of the `authenticated` grants.
- **Signed-out stays local.** With env unset, or signed out, confirm the app keeps working against local AsyncStorage and makes no cloud calls.
- **Anon REST is denied.** An unauthenticated REST call against any `kilo` table returns `401 permission denied for schema kilo`. This proves the schema is exposed but `anon` is correctly ungranted.

If any of these three checks fails, stop and reconcile before treating the backend as active.

## Revert And Safety Notes

- **`anon` is never granted.** No activation, re-apply, or config change may grant `anon` any access to `kilo`. Signed-out users stay local-only by design.
- **`service_role` keys never ship to clients.** The `service_role` grant exists only for future server-owned code (account export/deletion). Its key must never appear in `mobile/.env`, the client bundle, or this repo.
- **Before re-applying the migration:** confirm the target schema state. Object creation is `if not exists`, but the policy and grant statements are not idempotent and will error against an existing schema. For a clean re-apply, start from a project/schema without the prior `kilo` objects, or drop the existing `kilo` objects first in a controlled, isolation-checked step. Re-run the transaction-rollback dry run before any real re-apply.
- **To deactivate the client without touching the database:** unset `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` in `mobile/.env` and restart the Expo dev server. The app reverts to local-only mode; the cloud schema is untouched.
- Never modify the other app's schemas as part of any activation or revert step.

## Step 5: Auth Abuse Posture (Open Signup Gate)

Open signup must not go live without passing both checks in this section. If a check cannot be completed, keep public password Auth unavailable until it passes.

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

Run only the platform builds Kilo currently distributes. OTA updates are disabled,
so an old installed binary cannot receive this configuration. Do not enable
Supabase CAPTCHA until the new web deployment is live and replacement native
builds are ready for the intended users.

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

### OAuth Provider (GitHub - Web Only)

**Requirement:** GitHub OAuth must be configured in the Supabase Dashboard and GitHub developer settings before open public signup for the web distribution surface.

> [!NOTE]
> OAuth is currently supported on the **web build only**; native OAuth is disabled/out of scope for Phase 6.

**GitHub Setup (Create OAuth App):**
- In GitHub, go to your profile Settings → Developer settings → OAuth Apps → New OAuth App.
- Application name: `Kilo` (or `Kilo Dev` for local development).
- Homepage URL: Your web production website URL (or `http://localhost:8081` for local web development).
- Authorization callback URL: `https://<project-ref>.supabase.co/auth/v1/callback` (where `<project-ref>` is your Supabase project reference).

**Dashboard Configuration:**
- In the Supabase Dashboard, go to Authentication → Providers → GitHub.
- Toggle "Enable GitHub provider" to active.
- Paste the Client ID and Client Secret from your GitHub OAuth App settings.
- Ensure the Redirect URLs under Authentication → URL Configuration include your production web URL and any local web development URL (e.g., `http://localhost:8081`).

**Release Verification:**
- Launch the web build and navigate to the Account screen.
- Tap "Continue with GitHub" and confirm it redirects to the GitHub authorization page.
- Log in and verify that the flow successfully redirects back to the web app in a signed-in state.

## Relationship To Other Docs

- `docs/backend-schema.md` owns the schema structure and the naming, source-of-truth, ownership, and isolation **policy** that schema changes must follow. Consult it for what the tables, columns, RLS, and grants mean.
- `docs/archive/backend-roadmap.md` owns phase **sequencing** and the broader backend/auth/sync contract. Consult it for where activation fits in the overall build order.
- This doc owns the **activation procedure** only and defers to those two for structure/policy and sequencing.

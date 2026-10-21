# Web Deployment

For operators who publish, verify, or roll back the public Kilo web app. Public
Auth configuration belongs to [Public Auth Activation](auth-activation.md).

## Where it runs

| Item | Value |
|---|---|
| Production URL | https://kilo-app.pages.dev |
| Host | Cloudflare Pages project `kilo-app`, connected to this repository for branch previews only |
| Deployer (production) | [`.github/workflows/web-deploy.yml`](../../.github/workflows/web-deploy.yml) |
| Build | `npm --prefix mobile run export:web` → `mobile/dist` (Expo single-output static export) |
| Security headers | [`mobile/public/_headers`](../../mobile/public/_headers), copied into the export |

The app is local-first. The page is static; workouts and weigh-ins live in the
browser's storage, and the optional cloud account talks directly to Supabase.

## How production deploys

1. A PR merges to `main`.
2. The `Test` workflow runs on that push. Its `test` job includes the
   `smoke:web` export/serve check.
3. When `Test` completes successfully, `Web Deploy` checks out exactly that
   commit, confirms it is on `main`, exports the web build, and runs
   `wrangler pages deploy` to the `main` (production) branch with
   `--commit-hash` set to the deployed SHA.
4. The workflow fetches `/` and a non-existent deep path from `KILO_WEB_URL`
   and fails unless both return the app shell with the CSP and
   `X-Frame-Options: DENY` headers.

A failed or cancelled `Test` run deploys nothing. The deployed commit is shown
in Cloudflare → **Workers & Pages → kilo-app → Deployments** and in the
`production-web` environment history on GitHub.

### Branch previews

The project's Git integration builds every pushed branch in this repository
into a preview at `https://<hash>.kilo-app.pages.dev` and
`https://<branch-alias>.kilo-app.pages.dev`. Cloudflare builds previews with the
project's **preview** build variables, which hold only public `EXPO_PUBLIC_`
values, and does not build pull requests from forks.

**Automatic production deployments are off** (Workers & Pages → `kilo-app` →
Settings → Builds → Branch control). A preview can never replace production;
only the workflow above deploys the `main` branch. Do not re-enable automatic
production deployments: that would publish `main` before its checks finish.

The deploy workflow cannot be triggered by a PR. `workflow_run` always executes
the workflow file from the default branch, and the job refuses any run that is
not a successful push to `main` in this repository, so a PR cannot change the
deploy steps or read the Cloudflare token. `workflow_dispatch` accepts only a
full SHA that is already an ancestor of `main`.

### Configuration

GitHub repository **secrets** (deploy credentials only; never mapped into the
build step):

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Account token with **Cloudflare Pages: Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account that owns `kilo-app` |

GitHub repository **variables** (public; embedded in the bundle):

| Variable | Required | Value |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | yes | Shared project API URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase anon (publishable) key |
| `EXPO_PUBLIC_TURNSTILE_SITE_KEY` | yes | Turnstile Sitekey; see [Public Auth Activation](auth-activation.md#captcha) |
| `EXPO_PUBLIC_SENTRY_DSN` | no | Error-reporting DSN |
| `KILO_WEB_URL` | no | Production URL; enables the post-deploy live check |

Only `EXPO_PUBLIC_` values belong in the build. Never add the Supabase service
role key, the Turnstile secret, or the GitHub OAuth client secret to variables
or to the build environment; Expo would publish them in the JavaScript bundle.
Changing a variable affects only the next deployment.

Auth on the deployed origin also requires the owner-side allowlists in
[Public Auth Activation](auth-activation.md): the Supabase redirect URLs
`https://kilo-app.pages.dev/**`, the Turnstile hostname `kilo-app.pages.dev`,
and the GitHub OAuth App homepage.

## Single-page fallback

Kilo has no URL routes; every path must serve `index.html` so OAuth and
password-recovery returns load the app. Cloudflare Pages does this
automatically when the upload has no top-level `404.html`. The export step
fails if one appears. Do not add a `/* /index.html 200` `_redirects` rule;
Pages ignores it as an infinite loop.

## Vendored asset paths

Cloudflare Pages silently drops any uploaded path containing `node_modules`.
Expo writes the icon font to `dist/assets/node_modules/@expo/vector-icons/…`,
so before #1548 production served `index.html` in its place: the tab-bar icons
were blank and the page threw "A network error occurred." The `export:web`
script in `mobile/package.json` renames that directory to
`assets/vendor_modules`, rewrites the bundle references, and fails the export
if any `node_modules` path remains.

## Rollback

Use either path; both take effect in seconds and keep the browser data of
existing users.

- **Cloudflare dashboard (fastest).** Workers & Pages → `kilo-app` →
  Deployments → choose an earlier production deployment → **⋯ → Rollback to
  this deployment**.
- **Redeploy a known-good commit.** Actions → **Web Deploy** → Run workflow →
  enter the full SHA of an earlier `main` commit. The workflow rebuilds that
  commit with the current variables.

Afterwards confirm the deployment list shows the intended commit and reload
the production URL. The next successful `main` push deploys over a rollback,
so revert or fix the faulty change on `main` before merging anything else.

## Browser storage boundaries

- All local data lives in the origin's `localStorage` under the `kilo_*` keys
  listed in [Local Data Reference](../architecture/local-data-reference.md).
  Data belongs to one browser profile on one origin. A different browser,
  profile, private window, or hostname (including a preview URL) starts empty.
- Web does not have the native AES-256-GCM storage boundary; anyone with access
  to the browser profile can read the data.
- **Clearing site data** (browser settings, "Clear browsing data" with cookies
  and site data, or DevTools → Application → Clear storage) permanently deletes
  every local workout, weigh-in, draft, and the signed-in session. Signed-out
  data cannot be recovered. Signed-in data that already synced can be restored
  by signing in again. Export a backup first if the data matters.
- Browsers may evict storage under disk pressure. Kilo does not request
  persistent storage.

## Accounts on the web

- **Identity source.** Supabase Auth on the shared project. The session is
  stored in the origin's browser storage and refreshed by the Supabase client.
- **Local ownership.** `kilo_local_data_owner` binds local history to one user
  id. Signing in never changes or erases local data by itself; history owned by
  another account requires an explicit purge-or-upload choice before sync
  starts. See [Cloud Sync](../architecture/cloud-sync.md).
- **Session invalidation.** Sign-out is meant to end the session and return
  storage to local-only mode, offering an explicit device-wipe; on the web it
  currently fails (see below). Clearing site data removes the session.
- **Offline and sync failure.** Local reads and writes do not depend on
  Supabase, so the app keeps working offline or when Supabase is unreachable;
  retry and conflict behavior is in [Cloud Sync](../architecture/cloud-sync.md).
  Password Auth shows "Security verification is unavailable in this build" when
  the Turnstile Sitekey is missing, and "Complete the security verification
  before continuing" until the Turnstile check passes.

### Known web gaps

Kilo's Supabase Edge Functions deliberately return no
`Access-Control-Allow-Origin` header to browsers (`supabase/functions/_shared/cors.ts`),
so every web call to them fails. Until the follow-up issue opens them to the
production origin, the following do **not** work on the web; cloud accounts on
the web are not launch-ready:

- **Sign-out** fails with "Could not revoke Android restore key. Sign out again
  to retry." because it first calls `android-restore-credentials/v1/revoke`.
  Clearing the site's data ends the session but also deletes all local data,
  so export a backup first.
- **Cloud account export, account deletion, and health-data deletion**
  (`account-export`, `account-delete`, `health-data-delete`).
- **Cancelled GitHub sign-in** returns signed out without a message.

## Web limitations

- **Export Local Backup and CSV exports** use the browser's Web Share API.
  Browsers without it (desktop Chrome and Firefox on Linux and Windows) show
  "Export failed: Share is not supported in this browser." The app does not
  crash, and local data is unaffected.
- No offline install (PWA) and no native integrations.

## Verification evidence

The launch verification, including screenshots, viewports, and auth results,
is in [docs/evidence/public-web-launch](../evidence/public-web-launch/README.md).

# Account and Restore Trust Boundaries

For maintainers assessing authentication, restore credential lifecycle, session issuance, and abuse boundaries. Operator setup belongs to [Auth Activation](auth-activation.md).

## Android Restore Credentials Trust Boundary

`supabase/functions/android-restore-credentials/` (issue #1157) lets a user who
migrates to a new Android device be signed back in without typing credentials.
The device's Credential Manager holds a WebAuthn-style key pair that it backs up
with the device; Kilo stores only the public key, in `kilo.restore_credentials`
(migration `20260925120000_android_restore_credentials.sql`).

The v1 contract is five POST routes. `enrollment-options` and
`registration-verification` are authenticated and register a key for the bearer
user, replacing any previous one. `restore-options` and `restore-verification`
are unauthenticated and IP rate-limited: the device asks for a one-time
challenge, signs it, and the server verifies the signature, challenge, Android
origin (`android:apk-key-hash:` of an accepted signing certificate), and RP ID
with `@simplewebauthn/server`. `revoke` is authenticated and is the sign-out
path. An unknown credential is answered exactly like a known one, and every
rejected restore returns the same 401, so the routes cannot be used to learn
which credentials exist.

Only after verification does the function issue a session, through the
mechanism the user authorized on #1157: with the service-role key it checks the
key owner by id (existing, not banned, confirmed email), calls
`auth.admin.generateLink({ type: 'magiclink' })`, and immediately redeems the
hashed token with `verifyOtp` on a client that persists nothing. It returns
only `access_token` and `refresh_token`, and discards (and revokes) any session
whose subject is not the key owner. No shared-project Auth setting, role,
extension, or JWT signing changes.

Challenges live in `kilo.restore_challenges` and are consumed exactly once by a
single conditional `UPDATE`. Revocation is durable and one-way:
`kilo.restore_revoke_user` revokes the credential, burns outstanding
challenges, and stamps `kilo.restore_revocations`, and `account-delete` calls it
as step 0, before anything is deleted, so a later deletion failure leaves the
key revoked. Revocation wins both races with the restore flow: a registration
whose challenge was issued before the stamp is refused even if already
underway (challenge issue, registration, and revocation serialize on a per-user
advisory lock), and restore-verification re-checks the credential after the
GoTrue exchange and revokes the new session if the key was revoked meanwhile.
The `revoke` route then ends every GoTrue session the user holds
(`auth.admin.signOut(token, 'global')`, matching the client's default global
sign-out), which kills a session a restore minted and re-checked just before the
database revocation committed. Both tables are RLS
deny-all with no table grants; every access goes through `kilo.restore_*`
security-definer functions granted to `service_role` only.

A key also dies with its owner's auth lifecycle (issue #1162, migration
`20260926120000_restore_credentials_auth_lifecycle.sql`). Enrollment records a
digest of the owner's `auth.users.encrypted_password` and the GoTrue
`session_id` that enrolled it. The key is eligible only while the digest still
matches and that session still exists in `auth.sessions`, so a password change
or reset, or a global sign-out through any path, ends it. `restore_record_use`
checks this before issuance, `restore_credential_eligible` re-checks it after
the GoTrue exchange, and a stale key is revoked durably. Both enrollment routes
also require a sign-in within the last 10 minutes, read from the GoTrue-signed
`amr` claim (401 with `code: "reauth_required"` otherwise), and a registration
challenge can be spent only by the session that requested it, and only while
the owner's password is unchanged since the challenge was issued. These functions
only read the `auth` schema; nothing in it is altered.

The RP ID is `kilo-app.pages.dev`, and Android accepts restore keys for it only
because that domain publishes a Digital Asset Links statement for
`com.benpronin.kilo` (issue #1164). The source is
`mobile/public/.well-known/assetlinks.json`; `expo export --platform web` copies
it, hidden directory included, into the Pages build, where it is served as a
static JSON file ahead of the SPA fallback. `mobile/tests/assetlinks-export.test.js`
runs a real export and byte-compares the result. It lists the SHA-256 of the
Play app signing key; a build signed by any other key is not covered. After a
deploy, the owner checks it with `curl -D -` (HTTP 200, `application/json`, no
redirect) and Google's `statements:list` API.

Configuration is two Edge Function secrets, `KILO_RESTORE_RP_ID` and
`KILO_ANDROID_APK_KEY_HASHES`; with either missing or malformed, every
registration and restore route fails closed while `revoke` keeps working. The
RP ID domain must serve a matching `/.well-known/assetlinks.json`; hosting it
and the mobile wiring (#1159) are separate issues.

## Launch Abuse Boundary

Supabase Auth owns platform authentication throttles and CAPTCHA enforcement for
signup, password recovery, verification, and token endpoints. Kilo's launch
configuration keeps those platform limits active, uses production-owned SMTP for
public email signup and password recovery, and enables CAPTCHA before open
signup. The client renders Cloudflare Turnstile for sign-in, signup, and password
reset, consumes each token once, and fails closed in release builds when the
public site key (and the native HTTPS base origin) is missing. The Turnstile
secret remains only in Supabase Auth configuration.
The production SMTP boundary is Resend with a verified sender domain (#478);
delivery authentication is configured outside the repository in Supabase Auth.

Kilo-owned Edge Functions remain responsible for app-specific abuse controls.
`account-export` and `account-delete` require the caller JWT, perform no
unauthenticated writes, keep service-role credentials server-side only, and
apply durable, shared per-user and per-IP rate limits. Their shared CORS helper
defaults closed with no browser origins allowlisted; native callers are
unaffected, and any future browser caller must be added explicitly rather than
receiving a wildcard origin. Limit state lives in
Postgres (`kilo.rate_limit_hits` via the `kilo.rate_limit_check` SECURITY
DEFINER function, granted to `service_role` only), so the limits hold across
Edge-Function isolate recycling and cold starts rather than resetting per
isolate; a per-bucket advisory lock makes each check-and-record atomic under
concurrency. `account-export` limits successful exports to one per signed-in
user per 10 minutes by default, while `account-delete` limits delete attempts to
three per signed-in user per hour by default; both functions also reject
repeated callers through an IP bucket. Every current sensitive endpoint chooses
the explicit fail-closed limiter policy, returning the same throttle response if
the durable check is unavailable. Limiter error logs retain only a bounded error
code and never the raw IP/user bucket or upstream message.

Authenticated direct writes remain owner-isolated by RLS and are additionally
bounded by private `account_storage_usage` and `collection_storage_usage`
ledgers. Fixed-search-path triggers enforce field/row limits plus atomic
per-collection and aggregate account quotas; authenticated clients have no
access to the ledgers, and concurrent writes serialize on the account row rather
than racing a count query.

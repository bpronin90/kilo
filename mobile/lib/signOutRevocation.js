import { callAndroidRestoreApi } from './supabaseClient';

// Server-side restore-key revocation that must succeed before local sign-out.
//
// /v1/revoke authorizes only with a server-validated bearer: the current
// session's access token. Without one the client cannot revoke remotely, so
// every lookup outcome that fails to supply a token is a hard failure, and the
// caller must not sign out locally, clear device credentials, or wipe (#1557).
// There is deliberately no fallback to cached user IDs, stored credential IDs,
// platform, or a persisted bearer — none of those is authorization.

// A lookup or revoke request that failed in transit; repeating it can work.
export const REVOKE_FAILED_ERROR = 'Could not revoke Android restore key. Sign out again to retry.';

// The lookup resolved without a usable bearer (auth error, no session, or no
// access token). The SDK may already have removed the session, so another
// identical attempt cannot repair it; signing in again restores a bearer.
export const NO_BEARER_ERROR = 'Sign-out could not be completed because your session could not be verified. Sign in again, then sign out.';

// Inspects the complete getSession() result. Resolves { ok: true, token } only
// for a non-empty access token on a session returned without an error.
export async function resolveRevocationBearer(client) {
  let result;
  try {
    result = await client.auth.getSession();
  } catch {
    return { ok: false, error: REVOKE_FAILED_ERROR };
  }
  const token = result?.data?.session?.access_token;
  if (result?.error || typeof token !== 'string' || !token) {
    return { ok: false, error: NO_BEARER_ERROR };
  }
  return { ok: true, token };
}

// Revokes every restore credential for the bearer's user. Resolves { ok: true }
// only on a confirmed 2xx from the server; anything else is { ok: false, error }.
export async function revokeRestoreCredentialsBeforeSignOut(client, supabaseUrl) {
  if (!supabaseUrl) return { ok: false, error: REVOKE_FAILED_ERROR };
  const bearer = await resolveRevocationBearer(client);
  if (!bearer.ok) return bearer;
  const res = await callAndroidRestoreApi(supabaseUrl, 'revoke', {}, bearer.token).catch(() => null);
  return res?.ok ? { ok: true } : { ok: false, error: REVOKE_FAILED_ERROR };
}

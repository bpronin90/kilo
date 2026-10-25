// Web-only recovery discriminator (#497).
//
// GitHub OAuth and password recovery both return to window.location on web, so
// a callback URL alone cannot tell a recovery-link error apart from a generic
// OAuth error. We deliberately do NOT solve this by marking the redirect URL:
// the redirect must stay a plain allowlisted base URL (`kilo://auth/callback`
// native, the web origin on web). A query-bearing variant is not guaranteed to
// match Supabase's redirect-URL allowlist, and a rejected redirect falls back
// to the project Site URL — recreating the exact dead end this issue fixes.
//
// Instead, when a reset is requested we record a short-lived "recovery pending"
// flag in localStorage, and consume it when a callback error arrives. It is
// localStorage, not sessionStorage, because the email link commonly opens a new
// tab. The TTL is aligned to the reset-link validity so a stale flag cannot
// misclassify a much-later unrelated OAuth error.
//
// Native needs no discriminator at all: GitHub OAuth is captured by
// WebBrowser.openAuthSessionAsync's own return value, so any error that reaches
// the general kilo:// deep-link listener is unambiguously a recovery error
// (handled by that listener directly). getRecoveryStorage() returns null on
// native, so every helper here is a no-op there.
export const RECOVERY_PENDING_KEY = 'kilo.auth.recoveryPending';
// ~1h, matching the default Supabase reset-link validity.
export const RECOVERY_PENDING_TTL_MS = 60 * 60 * 1000;

function getRecoveryStorage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch (e) {
    // Accessing window.localStorage can throw (privacy mode, sandboxed frame).
  }
  return null;
}

export function markRecoveryPending() {
  const storage = getRecoveryStorage();
  if (!storage) return;
  try {
    storage.setItem(RECOVERY_PENDING_KEY, String(Date.now()));
  } catch (e) {
    // Best-effort: if this fails, a returning web error just stays unclassified.
  }
}

export function clearRecoveryPending() {
  const storage = getRecoveryStorage();
  if (!storage) return;
  try {
    storage.removeItem(RECOVERY_PENDING_KEY);
  } catch (e) {
    // ignore
  }
}

// Returns true — and clears the flag — when a recovery request was made within
// the TTL window. Returns false (leaving nothing behind) otherwise, including
// on native where there is no localStorage.
export function consumeRecoveryPending() {
  const storage = getRecoveryStorage();
  if (!storage) return false;
  let raw = null;
  try {
    raw = storage.getItem(RECOVERY_PENDING_KEY);
  } catch (e) {
    return false;
  }
  if (raw == null) return false;
  clearRecoveryPending();
  const ts = Number(raw);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts <= RECOVERY_PENDING_TTL_MS;
}

// Non-consuming read of the same flag (#1640): true while a reset requested in
// this browser is still inside its TTL.
export function peekRecoveryPending() {
  const storage = getRecoveryStorage();
  if (!storage) return false;
  try {
    const ts = Number(storage.getItem(RECOVERY_PENDING_KEY));
    return Number.isFinite(ts) && ts > 0 && Date.now() - ts <= RECOVERY_PENDING_TTL_MS;
  } catch (e) {
    return false;
  }
}

// Web PKCE callback classification (#1640). supabase-js (detectSessionInUrl)
// exchanges the `?code=` during client init, BEFORE React subscribes to auth
// events, so its PASSWORD_RECOVERY event is lost and the user would land on an
// ordinary signed-in view with no new-password step. The exchanged session's
// own access token still says how it was minted: GoTrue records the flow in the
// `amr` claim, and a recovery link yields method `recovery`. Only a session
// that arrived with a `?code=` in this page load is ever classified, so a
// later reload of the same (already-used) session is not re-entered as recovery.
export function callbackUrlHasCode() {
  try {
    return typeof window !== 'undefined' && /[?&]code=/.test(window.location?.search || '');
  } catch (e) {
    return false;
  }
}

export function isRecoverySession(session) {
  try {
    const payload = String(session?.access_token || '').split('.')[1];
    if (!payload || typeof atob !== 'function') return false;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const amr = JSON.parse(json)?.amr;
    return Array.isArray(amr) && amr.some((entry) => entry?.method === 'recovery');
  } catch (e) {
    return false;
  }
}

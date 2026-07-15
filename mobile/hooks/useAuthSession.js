// useAuthSession: the narrow auth/session boundary for the app shell.
//
// Responsibilities:
//   - Restore any persisted Supabase session on mount (secure storage native,
//     localStorage web) and subscribe to future auth state changes.
//   - Expose email/password sign in, sign up, sign out, and password reset.
//   - Provide OAuth sign-in plumbing and a web OAuth/reset callback handler.
//
// Local-only mode is the default. When Supabase env config is absent,
// `getSupabaseClient()` returns null and this hook reports a configured=false,
// signed-out state without touching the network. Existing local-only app
// behavior is unchanged for signed-out users.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform } from 'react-native';
import { getSupabaseClient, getSupabaseConfig, hasSupabaseConfig } from '../lib/supabaseClient';

const LOCAL_ONLY_RESULT = Object.freeze({
  ok: false,
  error: 'Cloud accounts are not configured in this build.',
});

// Deep link the app registers for both the GitHub OAuth callback and the
// password-recovery callback (#497). Native delivers both via this URL
// scheme; web carries the same payload as query/hash params on the app's own
// origin (see App.js's web callback effect).
export const KILO_AUTH_REDIRECT = 'kilo://auth/callback';

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

function markRecoveryPending() {
  const storage = getRecoveryStorage();
  if (!storage) return;
  try {
    storage.setItem(RECOVERY_PENDING_KEY, String(Date.now()));
  } catch (e) {
    // Best-effort: if this fails, a returning web error just stays unclassified.
  }
}

function clearRecoveryPending() {
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
function consumeRecoveryPending() {
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

export function useAuthSession() {
  const configured = hasSupabaseConfig();
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  // Loading reflects the initial session-restore probe. When unconfigured we
  // are immediately settled in signed-out local-only mode.
  const [loading, setLoading] = useState(configured);
  // True once Supabase reports a PASSWORD_RECOVERY auth-state event: the
  // session just established is a recovery session (the user followed a
  // password-reset link), not a normal sign-in. Screens gate a
  // set-new-password surface on this instead of on `signedIn` alone.
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  // Readable failure from a recovery-link callback that did not establish a
  // session (expired or already-used link). Cleared by clearPasswordRecovery.
  const [recoveryError, setRecoveryError] = useState('');
  const mountedRef = useRef(true);

  const applySession = useCallback((nextSession) => {
    if (!mountedRef.current) return;
    setSession(nextSession || null);
    setUser(nextSession?.user || null);
  }, []);

  const clearPasswordRecovery = useCallback(() => {
    setPasswordRecovery(false);
    setRecoveryError('');
    clearRecoveryPending();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const client = getSupabaseClient();
    if (!client) {
      // Local-only: nothing to restore.
      setLoading(false);
      return () => {
        mountedRef.current = false;
      };
    }

    client.auth
      .getSession()
      .then(({ data }) => {
        applySession(data?.session || null);
      })
      .catch(() => {
        applySession(null);
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });

    const { data: sub } = client.auth.onAuthStateChange((event, nextSession) => {
      // Supabase fires PASSWORD_RECOVERY (instead of SIGNED_IN) when the
      // session just came from a password-reset link, so screens can show a
      // set-new-password surface instead of the normal signed-in view.
      if (event === 'PASSWORD_RECOVERY' && mountedRef.current) {
        setPasswordRecovery(true);
        setRecoveryError('');
        // Recovery succeeded — drop the web pending flag so a later unrelated
        // OAuth error within the TTL window is not misclassified.
        clearRecoveryPending();
      }
      applySession(nextSession);
    });

    return () => {
      mountedRef.current = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, [applySession]);

  const requireClient = useCallback(() => {
    const client = getSupabaseClient();
    return client || null;
  }, []);

  const signInWithPassword = useCallback(async (email, password) => {
    const client = requireClient();
    if (!client) return LOCAL_ONLY_RESULT;
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: error.message };
    return { ok: true, session: data?.session || null };
  }, [requireClient]);

  const signUpWithPassword = useCallback(async (email, password) => {
    const client = requireClient();
    if (!client) return LOCAL_ONLY_RESULT;
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) return { ok: false, error: error.message };
    return { ok: true, session: data?.session || null };
  }, [requireClient]);

  const signOut = useCallback(async () => {
    const client = requireClient();
    if (!client) return LOCAL_ONLY_RESULT;
    const { error } = await client.auth.signOut();
    if (error) return { ok: false, error: error.message };
    applySession(null);
    return { ok: true };
  }, [requireClient, applySession]);

  const resetPasswordForEmail = useCallback(async (email, options) => {
    const client = requireClient();
    if (!client) return LOCAL_ONLY_RESULT;
    // Send the bare, allowlisted redirect URL unchanged (kilo://auth/callback
    // native, the web origin on web). No query marker is added — that would
    // risk an allowlist miss and a Site-URL fallback (see the discriminator
    // note above).
    const { error } = await client.auth.resetPasswordForEmail(
      email,
      options?.redirectTo ? { redirectTo: options.redirectTo } : undefined,
    );
    if (error) return { ok: false, error: error.message };
    // Record that a recovery is in flight so a returning web callback error
    // (expired/used link) can be attributed to recovery without a URL marker.
    // No-op on native (no localStorage).
    markRecoveryPending();
    return { ok: true };
  }, [requireClient]);

  // Call the account-export Edge Function with the requester's JWT.
  // Returns { ok, json } on success or { ok: false, error } on failure.
  const serverExport = useCallback(async () => {
    const client = requireClient();
    if (!client) return LOCAL_ONLY_RESULT;
    const supabaseUrl = getSupabaseConfig()?.url;
    if (!supabaseUrl) return LOCAL_ONLY_RESULT;
    const { data: { session } } = await client.auth.getSession();
    const token = session?.access_token;
    if (!token) return { ok: false, error: 'Not signed in.' };
    try {
      const res = await fetch(
        `${supabaseUrl}/functions/v1/account-export`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
      );
      const body = await res.json();
      if (!res.ok) return { ok: false, error: body?.error || 'Export failed.' };
      return { ok: true, json: JSON.stringify(body, null, 2), payload: body };
    } catch (e) {
      return { ok: false, error: e?.message || 'Export failed.' };
    }
  }, [requireClient]);

  // Call the account-delete Edge Function, then clear the local session.
  // Returns { ok: true } after successful deletion or { ok: false, error }.
  const deleteAccount = useCallback(async () => {
    const client = requireClient();
    if (!client) return LOCAL_ONLY_RESULT;
    const supabaseUrl = getSupabaseConfig()?.url;
    if (!supabaseUrl) return LOCAL_ONLY_RESULT;
    const { data: { session } } = await client.auth.getSession();
    const token = session?.access_token;
    if (!token) return { ok: false, error: 'Not signed in.' };
    try {
      const res = await fetch(
        `${supabaseUrl}/functions/v1/account-delete`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
      );
      const body = await res.json();
      if (!res.ok) return { ok: false, error: body?.error || 'Account deletion failed.' };
      // Clear local session state — the auth user is gone server-side.
      await client.auth.signOut();
      applySession(null);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || 'Account deletion failed.' };
    }
  }, [requireClient, applySession]);

  const signInWithOAuth = useCallback(async (provider, options) => {
    const client = requireClient();
    if (!client) return LOCAL_ONLY_RESULT;
    const oauthOptions = options
      ? {
          redirectTo: options.redirectTo,
          ...(options.skipBrowserRedirect != null ? { skipBrowserRedirect: options.skipBrowserRedirect } : {}),
        }
      : undefined;
    const { data, error } = await client.auth.signInWithOAuth({ provider, options: oauthOptions });
    if (error) return { ok: false, error: error.message };
    return { ok: true, url: data?.url || null };
  }, [requireClient]);

  // Web OAuth / password-reset callback handler. supabase-js with
  // detectSessionInUrl=true consumes the URL fragment automatically, but some
  // flows (PKCE code exchange) require an explicit exchange. This handles both
  // by exchanging an auth code when present and otherwise reading the restored
  // session.
  const handleAuthCallbackUrl = useCallback(async (url) => {
    const client = requireClient();
    if (!client) return LOCAL_ONLY_RESULT;

    const target = url || (typeof window !== 'undefined' ? window.location?.href : undefined);
    if (!target) return { ok: false, error: 'No callback URL available.' };

    // Surface any provider/Supabase error in the callback URL immediately.
    // Errors can arrive as query (?error=) or hash (#error=) params depending
    // on flow, so match either delimiter here.
    const errorMatch = /[?&#]error=([^&#]*)/.exec(target);
    if (errorMatch) {
      const errorCode = decodeURIComponent(errorMatch[1].replace(/\+/g, ' '));
      const descMatch = /[?&#]error_description=([^&#]*)/.exec(target);
      const desc = descMatch
        ? decodeURIComponent(descMatch[1].replace(/\+/g, ' '))
        : errorCode;
      // A recovery link that errored (expired/already-used) must land on the
      // set-new-password surface, not vanish. On web the caller (App.js's mount
      // effect) invokes this and ignores the return value, so persist the error
      // into recoveryError here. consumeRecoveryPending() is what keeps generic
      // OAuth sign-in errors — which set no pending flag — from being misfiled
      // as recovery failures, and it is a no-op on native (native recovery
      // errors are handled by the deep-link listener below, whose wrapper sets
      // recoveryError, and native OAuth never reaches that listener). Only the
      // explicit error-param branch consults it: a failed code exchange on the
      // success path is often just the web detectSessionInUrl double-exchange
      // race and must NOT surface as a recovery error.
      if (mountedRef.current && consumeRecoveryPending()) {
        setRecoveryError(desc || 'Password reset link is invalid or has expired.');
      }
      return { ok: false, error: desc };
    }

    // Extract and pass only the code value (not the full URL) to exchangeCodeForSession.
    const codeMatch = /[?&]code=([^&#]+)/.exec(target);
    if (codeMatch && typeof client.auth.exchangeCodeForSession === 'function') {
      const code = decodeURIComponent(codeMatch[1]);
      const { data, error } = await client.auth.exchangeCodeForSession(code);
      if (error) return { ok: false, error: error.message };
      if (!data?.session) return { ok: false, error: 'Sign in did not complete.' };
      applySession(data.session);
      return { ok: true, session: data.session };
    }

    // Fallback for web implicit flow: supabase-js with detectSessionInUrl=true
    // restores the session from the URL fragment automatically.
    const { data, error } = await client.auth.getSession();
    if (error) return { ok: false, error: error.message };
    if (!data?.session) return { ok: false, error: 'Sign in did not complete.' };
    applySession(data.session);
    return { ok: true, session: data.session };
  }, [requireClient, applySession]);

  // Native cold/warm-start deep-link handling for the recovery callback,
  // following the same code-exchange path as the GitHub OAuth callback
  // (handleAuthCallbackUrl above). Web does not need this: App.js's web
  // effect already drives handleAuthCallbackUrl from window.location on
  // mount, and detectSessionInUrl covers the implicit fallback.
  //
  // GitHub sign-in on native (see AccountScreen) already captures its
  // redirect directly via WebBrowser.openAuthSessionAsync's return value,
  // which intercepts the kilo:// redirect through its own auth-session
  // mechanism rather than the app's general deep-link surface, so this
  // listener does not race it. This listener's only real-world source is a
  // password-recovery link opened from outside the app (e.g. a mail client),
  // including the cold-start case where the app was not already running.
  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    const client = getSupabaseClient();
    if (!client) return undefined;

    const handleUrl = (url) => {
      if (!url || !url.startsWith(KILO_AUTH_REDIRECT)) return;
      handleAuthCallbackUrl(url).then((result) => {
        if (!result.ok && mountedRef.current) {
          setRecoveryError(result.error || 'Password reset link is invalid or has expired.');
        }
      }).catch(() => {});
    };

    Linking.getInitialURL().then((url) => {
      if (url) handleUrl(url);
    }).catch(() => {});

    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url));

    return () => {
      sub?.remove?.();
    };
  }, [handleAuthCallbackUrl]);

  // Set-new-password surface calls this after a recovery session is
  // established. Clears passwordRecovery on success so the caller falls back
  // to its normal signed-in view.
  const updatePassword = useCallback(async (password) => {
    const client = requireClient();
    if (!client) return LOCAL_ONLY_RESULT;
    const { data, error } = await client.auth.updateUser({ password });
    if (error) return { ok: false, error: error.message };
    if (mountedRef.current) {
      setPasswordRecovery(false);
      setRecoveryError('');
    }
    return { ok: true, user: data?.user || null };
  }, [requireClient]);

  return {
    configured,
    loading,
    session,
    user,
    signedIn: Boolean(session),
    passwordRecovery,
    recoveryError,
    clearPasswordRecovery,
    signInWithPassword,
    signUpWithPassword,
    signOut,
    resetPasswordForEmail,
    signInWithOAuth,
    handleAuthCallbackUrl,
    updatePassword,
    serverExport,
    deleteAccount,
  };
}

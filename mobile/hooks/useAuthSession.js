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
import { getSupabaseClient, getSupabaseConfig, hasSupabaseConfig } from '../lib/supabaseClient';

const LOCAL_ONLY_RESULT = Object.freeze({
  ok: false,
  error: 'Cloud accounts are not configured in this build.',
});

export function useAuthSession() {
  const configured = hasSupabaseConfig();
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  // Loading reflects the initial session-restore probe. When unconfigured we
  // are immediately settled in signed-out local-only mode.
  const [loading, setLoading] = useState(configured);
  const mountedRef = useRef(true);

  const applySession = useCallback((nextSession) => {
    if (!mountedRef.current) return;
    setSession(nextSession || null);
    setUser(nextSession?.user || null);
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

    const { data: sub } = client.auth.onAuthStateChange((_event, nextSession) => {
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
    const { error } = await client.auth.resetPasswordForEmail(
      email,
      options ? { redirectTo: options.redirectTo } : undefined,
    );
    if (error) return { ok: false, error: error.message };
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
    const errorMatch = /[?&]error=([^&#]*)/.exec(target);
    if (errorMatch) {
      const errorCode = decodeURIComponent(errorMatch[1].replace(/\+/g, ' '));
      const descMatch = /[?&]error_description=([^&#]*)/.exec(target);
      const desc = descMatch
        ? decodeURIComponent(descMatch[1].replace(/\+/g, ' '))
        : errorCode;
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

  return {
    configured,
    loading,
    session,
    user,
    signedIn: Boolean(session),
    signInWithPassword,
    signUpWithPassword,
    signOut,
    resetPasswordForEmail,
    signInWithOAuth,
    handleAuthCallbackUrl,
    serverExport,
    deleteAccount,
  };
}

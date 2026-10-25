// State machine for the MCP client authorization route (#1626, contract
// docs/architecture/mcp-mvp.md §4).
//
// Phases: idle (not our route) | invalid | signed_out | loading | ready |
// consent_missing | submitting | redirecting | error | ended.
//
// Identity: the view is bound to the user who was signed in when the lookup
// started. A different user, a sign-out or an unmount ends the request, clears the
// stored id and drops any response that is still in flight (the `seq` guard), so a
// grant requested under User A can never be approved or shown under User B.
// Approval is never automatic: only `approve()` calls Auth, and only from `ready`.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { getSupabaseClient } from '../lib/supabaseClient';
import {
  clearPendingAuthorization,
  fetchAuthorizationDetails,
  fetchHealthConsentGranted,
  loadPendingAuthorization,
  parseAuthorizationLocation,
  savePendingAuthorization,
  submitAuthorizationDecision,
} from '../lib/mcpAuthorization';

const IDLE = { phase: 'idle', details: null, error: null };

function hasWindow() {
  return Platform.OS === 'web' && typeof window !== 'undefined' && !!window.location;
}

function scrubUrl(path) {
  try {
    window.history.replaceState(null, '', path);
  } catch {
    // A blocked history API only leaves the (already persisted) id in the URL.
  }
}

// Runs once, before the first render, so the shell never flashes the tabs before
// the authorization surface. Only the id is retained; nothing else is persisted.
function readInitialRoute() {
  if (!hasWindow()) return { ...IDLE, id: null };
  const parsed = parseAuthorizationLocation(window.location);
  if (parsed.kind === 'id') {
    savePendingAuthorization(parsed.authorizationId);
    scrubUrl(window.location.pathname);
    return { phase: 'loading', details: null, error: null, id: parsed.authorizationId };
  }
  if (parsed.kind === 'invalid') {
    clearPendingAuthorization();
    scrubUrl(window.location.pathname);
    return { phase: 'invalid', details: null, error: null, id: null };
  }
  // A GitHub sign-in returns to the origin root and a reload drops the query, so
  // both resume from the stored id while it is still inside its TTL.
  const pending = loadPendingAuthorization();
  if (pending) return { phase: 'loading', details: null, error: null, id: pending };
  if (parsed.kind === 'missing') return { phase: 'invalid', details: null, error: null, id: null };
  return { ...IDLE, id: null };
}

export function useMcpAuthorization(auth, { getClient = getSupabaseClient, navigate } = {}) {
  const [route, setRoute] = useState(readInitialRoute);
  const seqRef = useRef(0);
  const boundUserRef = useRef(null);
  const busyRef = useRef(false);
  const routeRef = useRef(route);
  routeRef.current = route;

  const userId = auth?.user?.id || null;
  const signedIn = !!auth?.signedIn && !!userId;
  const authLoading = !!auth?.loading;
  const id = route.id;
  const active = route.phase !== 'idle';

  const end = useCallback((phase = 'ended') => {
    seqRef.current += 1;
    busyRef.current = false;
    boundUserRef.current = null;
    clearPendingAuthorization();
    setRoute({ phase, details: null, error: null, id: null });
  }, []);

  const lookup = useCallback(async (authorizationId, forUser) => {
    const seq = ++seqRef.current;
    setRoute((prev) => ({ ...prev, phase: 'loading', details: null, error: null }));
    const client = getClient();
    const result = await fetchAuthorizationDetails(client, authorizationId);
    if (seq !== seqRef.current || boundUserRef.current !== forUser) return;
    if (result.status === 'redirect') {
      clearPendingAuthorization();
      setRoute((prev) => ({ ...prev, phase: 'redirecting', id: null }));
      (navigate || ((url) => window.location.assign(url)))(result.url);
      return;
    }
    if (result.status === 'error') {
      if (result.reason === 'gone') clearPendingAuthorization();
      setRoute((prev) => ({ ...prev, phase: 'error', error: result.reason }));
      return;
    }
    if (result.details.userId && result.details.userId !== forUser) {
      // The request belongs to someone else; never display it under this account.
      clearPendingAuthorization();
      setRoute((prev) => ({ ...prev, phase: 'error', error: 'gone', id: null }));
      return;
    }
    const consented = await fetchHealthConsentGranted(client, forUser);
    if (seq !== seqRef.current || boundUserRef.current !== forUser) return;
    setRoute((prev) => ({
      ...prev,
      phase: consented ? 'ready' : 'consent_missing',
      details: result.details,
    }));
  }, [getClient, navigate]);

  useEffect(() => {
    if (!active || authLoading || route.phase === 'ended' || route.phase === 'invalid' || route.phase === 'redirecting') return;
    if (!signedIn) {
      if (boundUserRef.current) {
        // Sign-out while a request was open: the request does not survive it.
        end();
      } else if (route.phase !== 'signed_out') {
        seqRef.current += 1;
        setRoute((prev) => ({ ...prev, phase: 'signed_out', details: null, error: null }));
      }
      return;
    }
    if (boundUserRef.current && boundUserRef.current !== userId) {
      end();
      return;
    }
    if (!boundUserRef.current && id) {
      boundUserRef.current = userId;
      lookup(id, userId);
    }
  }, [active, authLoading, signedIn, userId, id, route.phase, lookup, end]);

  // Unmount cancels in-flight work and clears the stored id.
  useEffect(() => () => {
    seqRef.current += 1;
    if (routeRef.current.phase !== 'idle' && routeRef.current.phase !== 'redirecting') clearPendingAuthorization();
  }, []);

  const decide = useCallback(async (approve) => {
    const current = routeRef.current;
    const allowed = approve ? current.phase === 'ready' : (current.phase === 'ready' || current.phase === 'consent_missing');
    if (!allowed || busyRef.current || !current.id || boundUserRef.current !== userId) return;
    busyRef.current = true;
    const seq = ++seqRef.current;
    const forUser = boundUserRef.current;
    const authorizationId = current.id;
    setRoute((prev) => ({ ...prev, phase: 'submitting', error: null }));
    const result = await submitAuthorizationDecision(getClient(), authorizationId, approve);
    if (seq !== seqRef.current || boundUserRef.current !== forUser) return;
    busyRef.current = false;
    if (!result.ok) {
      if (result.reason === 'gone') clearPendingAuthorization();
      setRoute((prev) => (result.reason === 'gone'
        ? { ...prev, phase: 'error', error: 'gone', details: null, id: null }
        : { ...prev, phase: current.phase, error: 'decision_failed' }));
      return;
    }
    // Clear first so a back navigation cannot replay the used request.
    clearPendingAuthorization();
    setRoute((prev) => ({ ...prev, phase: 'redirecting', details: null, id: null }));
    (navigate || ((url) => window.location.assign(url)))(result.url);
  }, [getClient, navigate, userId]);

  const approve = useCallback(() => decide(true), [decide]);
  const deny = useCallback(() => decide(false), [decide]);
  const retry = useCallback(() => {
    const current = routeRef.current;
    if (current.phase !== 'error' || current.error !== 'unavailable' || !current.id || !boundUserRef.current) return;
    lookup(current.id, boundUserRef.current);
  }, [lookup]);
  const dismiss = useCallback(() => {
    end('idle');
    if (hasWindow()) scrubUrl('/');
  }, [end]);

  return {
    active,
    phase: route.phase,
    details: route.details,
    error: route.error,
    approve,
    deny,
    retry,
    dismiss,
  };
}

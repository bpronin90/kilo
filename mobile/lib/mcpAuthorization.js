// Browser authorization for external MCP clients (#1626, contract:
// docs/architecture/mcp-mvp.md §4).
//
// Supabase Auth is the OAuth server; Kilo only renders the consent step. This
// module holds the pure validation, the one short-lived pending-request entry,
// and thin wrappers over the Auth OAuth APIs that normalise every outcome into a
// small result shape. Kilo never sees the authorization code, PKCE verifier or
// tokens, and never builds the redirect: it follows `redirect_url` exactly as
// Auth returns it, and only when that URL is safe to navigate to.
//
// Nothing here logs or reports. The authorization id is the only request detail
// persisted, and only in sessionStorage for the approved TTL.

import { getSupabaseClient } from './supabaseClient';

export const AUTHORIZATION_PATH = '/oauth/consent';
export const PENDING_STORAGE_KEY = 'kilo.mcp.pendingAuthorization';
// Matches the authorization-code lifetime (contract F10).
export const PENDING_TTL_MS = 10 * 60 * 1000;
export const CLIENT_NAME_MAX = 80;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const HEALTH_SCHEMA = 'kilo';

export function isValidAuthorizationId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

// Reads the entry from a location-like object. Only the exact path counts; any
// other path (including a prefix match such as /oauth/consent-x) is not ours.
// `missing` is the path without an id (a reload after the query was scrubbed);
// `invalid` is a repeated or malformed id. Neither makes an API call.
export function parseAuthorizationLocation(loc) {
  if (!loc || loc.pathname !== AUTHORIZATION_PATH) return { kind: 'none' };
  let ids;
  try {
    ids = new URLSearchParams(loc.search || '').getAll('authorization_id');
  } catch {
    return { kind: 'invalid' };
  }
  if (ids.length === 0) return { kind: 'missing' };
  if (ids.length !== 1 || !isValidAuthorizationId(ids[0])) return { kind: 'invalid' };
  return { kind: 'id', authorizationId: ids[0] };
}

function getStore(storage) {
  if (storage) return storage;
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function savePendingAuthorization(authorizationId, { storage, now = Date.now() } = {}) {
  const store = getStore(storage);
  if (!store || !isValidAuthorizationId(authorizationId)) return false;
  try {
    store.setItem(PENDING_STORAGE_KEY, JSON.stringify({ authorizationId, storedAt: now }));
    return true;
  } catch {
    return false;
  }
}

export function clearPendingAuthorization({ storage } = {}) {
  const store = getStore(storage);
  if (!store) return;
  try {
    store.removeItem(PENDING_STORAGE_KEY);
  } catch {
    // Best effort: a blocked store only means a later resume finds nothing.
  }
}

// Returns the stored id while it is inside the TTL and well formed; anything else
// is removed so a stale or tampered entry cannot linger.
export function loadPendingAuthorization({ storage, now = Date.now() } = {}) {
  const store = getStore(storage);
  if (!store) return null;
  let entry = null;
  try {
    const raw = store.getItem(PENDING_STORAGE_KEY);
    entry = raw ? JSON.parse(raw) : null;
  } catch {
    entry = null;
  }
  const fresh = entry
    && isValidAuthorizationId(entry.authorizationId)
    && typeof entry.storedAt === 'number'
    && now - entry.storedAt >= 0
    && now - entry.storedAt <= PENDING_TTL_MS;
  if (!fresh) {
    clearPendingAuthorization({ storage: store });
    return null;
  }
  return entry.authorizationId;
}

// Strips control and bidi-override characters, collapses whitespace, truncates.
// Client metadata is attacker-chosen, so it is only ever rendered as plain text.
export function sanitizeClientText(value, max = CLIENT_NAME_MAX) {
  if (typeof value !== 'string') return '';
  const cleaned = value
    .replace(/[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

export function redirectHost(redirectUri) {
  try {
    const url = new URL(redirectUri);
    return sanitizeClientText(url.host, 120);
  } catch {
    return '';
  }
}

// Follow only absolute https URLs, or http on loopback (the Claude Code client
// uses a loopback redirect). Anything else, including javascript:, data: and
// relative or protocol-relative URLs, is refused.
export function isSafeRedirectUrl(value) {
  if (typeof value !== 'string') return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
}

function oauthApi(client) {
  return client?.auth?.oauth || null;
}

// Outcomes: details | redirect (Auth already holds consent) | error. The error
// reason never echoes provider text, only whether the request is gone or the
// lookup itself failed.
export async function fetchAuthorizationDetails(client, authorizationId) {
  const api = oauthApi(client);
  if (!api || !isValidAuthorizationId(authorizationId)) return { status: 'error', reason: 'unavailable' };
  try {
    const { data, error } = await api.getAuthorizationDetails(authorizationId);
    if (error) return { status: 'error', reason: classifyAuthError(error) };
    if (data && data.authorization_id) {
      return {
        status: 'details',
        details: {
          authorizationId: data.authorization_id,
          userId: data.user?.id || null,
          clientId: data.client?.id || null,
          clientName: sanitizeClientText(data.client?.name) || 'Unnamed client',
          redirectHost: redirectHost(data.redirect_uri),
        },
      };
    }
    if (data && isSafeRedirectUrl(data.redirect_url)) return { status: 'redirect', url: data.redirect_url };
    return { status: 'error', reason: 'unavailable' };
  } catch {
    return { status: 'error', reason: 'unavailable' };
  }
}

// 4xx from Auth means the request is expired, used, unknown or not this user's;
// anything else (network, 5xx) is a retryable provider failure.
function classifyAuthError(error) {
  const status = error?.status;
  return typeof status === 'number' && status >= 400 && status < 500 ? 'gone' : 'unavailable';
}

export async function submitAuthorizationDecision(client, authorizationId, approve) {
  const api = oauthApi(client);
  if (!api || !isValidAuthorizationId(authorizationId)) return { ok: false, reason: 'unavailable' };
  try {
    const call = approve ? api.approveAuthorization : api.denyAuthorization;
    const { data, error } = await call.call(api, authorizationId, { skipBrowserRedirect: true });
    if (error) return { ok: false, reason: classifyAuthError(error) };
    if (!isSafeRedirectUrl(data?.redirect_url)) return { ok: false, reason: 'unavailable' };
    return { ok: true, url: data.redirect_url };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

export async function listConnections(client = getSupabaseClient()) {
  const api = oauthApi(client);
  if (!api) return { ok: false };
  try {
    const { data, error } = await api.listGrants();
    if (error || !Array.isArray(data)) return { ok: false };
    return {
      ok: true,
      connections: data
        .filter((grant) => grant?.client?.id)
        .map((grant) => ({
          clientId: grant.client.id,
          name: sanitizeClientText(grant.client.name) || 'Unnamed client',
          grantedAt: typeof grant.granted_at === 'string' ? grant.granted_at : null,
        })),
    };
  } catch {
    return { ok: false };
  }
}

// Success is reported only after Auth resolves without an error.
export async function revokeConnection(client = getSupabaseClient(), clientId) {
  const api = oauthApi(client);
  if (!api || typeof clientId !== 'string' || !clientId) return { ok: false };
  try {
    const { error } = await api.revokeGrant({ clientId });
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}

// The Cloud Sync health consent is a prerequisite for external-client approval,
// never something this flow grants. Read the user's own consent_state row
// (end-user RLS); anything other than an explicit `granted` counts as missing.
// The server gate enforces consent independently of this display decision.
export async function fetchHealthConsentGranted(client, userId) {
  if (!client || !userId) return false;
  try {
    const { data, error } = await client
      .schema(HEALTH_SCHEMA)
      .from('consent_state')
      .select('status')
      .eq('user_id', userId)
      .maybeSingle();
    return !error && data?.status === 'granted';
  } catch {
    return false;
  }
}

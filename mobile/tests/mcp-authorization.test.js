// MCP client authorization (#1626): request validation and pending-entry
// lifecycle (lib), the route state machine (hook: continuation, approve/deny,
// failure states, account switch, stale async completion) and the disclosure
// screen. Contract: docs/architecture/mcp-mvp.md §4.

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Platform } from 'react-native';

jest.mock('../screens/more/AccountScreen', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { AccountScreen: () => React.createElement(View, { testID: 'account-sign-in' }) };
});
jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: () => null }));

const lib = require('../lib/mcpAuthorization');
const { useMcpAuthorization } = require('../hooks/useMcpAuthorization');
const { McpAuthorizationScreen } = require('../screens/mcp/McpAuthorizationScreen');
const { STATE_COPY } = require('../screens/mcp/mcpCopy');

const ID = 'abc123_-XYZ';

function memoryStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

describe('lib/mcpAuthorization', () => {
  test('authorization ids: 1-128 chars of [A-Za-z0-9_-] only', () => {
    expect(lib.isValidAuthorizationId('a')).toBe(true);
    expect(lib.isValidAuthorizationId('A-b_9'.repeat(25))).toBe(true);
    expect(lib.isValidAuthorizationId('a'.repeat(129))).toBe(false);
    for (const bad of ['', 'a b', 'a/b', 'a.b', '<x>', 'a;b', 'é', null, undefined, 5]) {
      expect(lib.isValidAuthorizationId(bad)).toBe(false);
    }
  });

  test('location parsing matches the exact path and rejects repeated/malformed ids', () => {
    const at = (pathname, search) => lib.parseAuthorizationLocation({ pathname, search });
    expect(at('/oauth/consent', `?authorization_id=${ID}`)).toEqual({ kind: 'id', authorizationId: ID });
    expect(at('/oauth/consent', '')).toEqual({ kind: 'missing' });
    expect(at('/oauth/consent', '?authorization_id=a&authorization_id=b')).toEqual({ kind: 'invalid' });
    expect(at('/oauth/consent', '?authorization_id=a%20b')).toEqual({ kind: 'invalid' });
    expect(at('/oauth/consent', '?authorization_id=')).toEqual({ kind: 'invalid' });
    expect(at('/oauth/consent-x', `?authorization_id=${ID}`)).toEqual({ kind: 'none' });
    expect(at('/', `?authorization_id=${ID}`)).toEqual({ kind: 'none' });
  });

  test('pending entry keeps only the id, expires after 10 minutes and drops tampering', () => {
    const storage = memoryStorage();
    expect(lib.savePendingAuthorization(ID, { storage, now: 1000 })).toBe(true);
    expect(JSON.parse(storage.map.get(lib.PENDING_STORAGE_KEY))).toEqual({ authorizationId: ID, storedAt: 1000 });
    expect(lib.loadPendingAuthorization({ storage, now: 1000 + lib.PENDING_TTL_MS })).toBe(ID);
    expect(lib.loadPendingAuthorization({ storage, now: 1001 + lib.PENDING_TTL_MS })).toBeNull();
    expect(storage.map.has(lib.PENDING_STORAGE_KEY)).toBe(false);
    storage.setItem(lib.PENDING_STORAGE_KEY, JSON.stringify({ authorizationId: '../evil', storedAt: 1 }));
    expect(lib.loadPendingAuthorization({ storage, now: 2 })).toBeNull();
    storage.setItem(lib.PENDING_STORAGE_KEY, 'not json');
    expect(lib.loadPendingAuthorization({ storage, now: 2 })).toBeNull();
    expect(lib.savePendingAuthorization('bad id', { storage })).toBe(false);
  });

  test('a throwing store degrades to "nothing stored"', () => {
    const storage = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
    expect(lib.savePendingAuthorization(ID, { storage })).toBe(false);
    expect(lib.loadPendingAuthorization({ storage })).toBeNull();
    expect(() => lib.clearPendingAuthorization({ storage })).not.toThrow();
  });

  test('redirects are followed only for https or loopback http, never script or relative URLs', () => {
    for (const ok of ['https://client.example/cb?code=1', 'http://localhost:33418/callback', 'http://127.0.0.1:8080/cb']) {
      expect(lib.isSafeRedirectUrl(ok)).toBe(true);
    }
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', '//evil.example/x', '/relative', 'http://evil.example/cb',
      'http://localhost.evil.example/cb', 'https://user:pw@client.example/cb', 'ftp://x/y', '', null, undefined, 5]) {
      expect(lib.isSafeRedirectUrl(bad)).toBe(false);
    }
  });

  test('client text is plain, control-free and truncated at 80 chars', () => {
    expect(lib.sanitizeClientText('  My\u0000 Client\n‮evil  ')).toBe('My Client evil');
    const long = lib.sanitizeClientText('x'.repeat(200));
    expect(long.length).toBe(80);
    expect(long.endsWith('…')).toBe(true);
    expect(lib.sanitizeClientText(undefined)).toBe('');
    expect(lib.redirectHost('https://client.example:8443/cb?code=secret')).toBe('client.example:8443');
    expect(lib.redirectHost('not a url')).toBe('');
  });

  test('details normalise to display fields only; a redirect response needs a safe URL', async () => {
    const client = (resp) => ({ auth: { oauth: { getAuthorizationDetails: jest.fn().mockResolvedValue(resp) } } });
    const ok = await lib.fetchAuthorizationDetails(client({
      data: { authorization_id: ID, redirect_uri: 'https://c.example/cb', scope: 'openid', user: { id: 'u1', email: 'a@b.c' }, client: { id: 'c1', name: 'Name\u0007', uri: 'x', logo_uri: 'y' } },
      error: null,
    }), ID);
    expect(ok).toEqual({ status: 'details', details: { authorizationId: ID, userId: 'u1', clientId: 'c1', clientName: 'Name', redirectHost: 'c.example' } });
    expect(JSON.stringify(ok)).not.toContain('a@b.c');
    expect(await lib.fetchAuthorizationDetails(client({ data: { redirect_url: 'https://c.example/cb?code=1' }, error: null }), ID))
      .toEqual({ status: 'redirect', url: 'https://c.example/cb?code=1' });
    expect(await lib.fetchAuthorizationDetails(client({ data: { redirect_url: 'javascript:x' }, error: null }), ID))
      .toEqual({ status: 'error', reason: 'unavailable' });
    expect(await lib.fetchAuthorizationDetails(client({ data: null, error: { status: 404 } }), ID)).toEqual({ status: 'error', reason: 'gone' });
    expect(await lib.fetchAuthorizationDetails(client({ data: null, error: { status: 503 } }), ID)).toEqual({ status: 'error', reason: 'unavailable' });
    expect(await lib.fetchAuthorizationDetails(null, ID)).toEqual({ status: 'error', reason: 'unavailable' });
    expect(await lib.fetchAuthorizationDetails(client({}), 'bad id')).toEqual({ status: 'error', reason: 'unavailable' });
  });

  test('decisions pass skipBrowserRedirect and refuse unsafe redirect URLs', async () => {
    const oauth = {
      approveAuthorization: jest.fn().mockResolvedValue({ data: { redirect_url: 'https://c.example/cb?code=1' }, error: null }),
      denyAuthorization: jest.fn().mockResolvedValue({ data: { redirect_url: 'javascript:x' }, error: null }),
    };
    const client = { auth: { oauth } };
    expect(await lib.submitAuthorizationDecision(client, ID, true)).toEqual({ ok: true, url: 'https://c.example/cb?code=1' });
    expect(oauth.approveAuthorization).toHaveBeenCalledWith(ID, { skipBrowserRedirect: true });
    expect(await lib.submitAuthorizationDecision(client, ID, false)).toEqual({ ok: false, reason: 'unavailable' });
    expect(oauth.denyAuthorization).toHaveBeenCalledWith(ID, { skipBrowserRedirect: true });
  });

  test('health consent counts only an explicit granted row for this user', async () => {
    const mk = (resp) => {
      const q = { eq: jest.fn(() => q), maybeSingle: jest.fn().mockResolvedValue(resp), select: jest.fn(() => q) };
      return { schema: jest.fn(() => ({ from: jest.fn(() => q) })), q };
    };
    const granted = mk({ data: { status: 'granted' }, error: null });
    expect(await lib.fetchHealthConsentGranted(granted, 'u1')).toBe(true);
    expect(granted.schema).toHaveBeenCalledWith('kilo');
    expect(granted.q.eq).toHaveBeenCalledWith('user_id', 'u1');
    for (const resp of [{ data: { status: 'withdrawn' }, error: null }, { data: null, error: null }, { data: { status: 'granted' }, error: { message: 'x' } }]) {
      expect(await lib.fetchHealthConsentGranted(mk(resp), 'u1')).toBe(false);
    }
    expect(await lib.fetchHealthConsentGranted(null, 'u1')).toBe(false);
    expect(await lib.fetchHealthConsentGranted(mk({ data: { status: 'granted' }, error: null }), null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const DETAILS = {
  authorization_id: ID, redirect_uri: 'https://c.example/cb', scope: 'openid',
  user: { id: 'user-a', email: 'a@example.com' }, client: { id: 'client-1', name: 'Claude Code', uri: '', logo_uri: '' },
};

function makeClient({ details = { data: DETAILS, error: null }, consent = 'granted', decision } = {}) {
  const oauth = {
    getAuthorizationDetails: jest.fn().mockResolvedValue(details),
    approveAuthorization: jest.fn().mockResolvedValue(decision || { data: { redirect_url: 'https://c.example/cb?code=1' }, error: null }),
    denyAuthorization: jest.fn().mockResolvedValue(decision || { data: { redirect_url: 'https://c.example/cb?error=access_denied' }, error: null }),
  };
  const q = { eq: () => q, select: () => q, maybeSingle: jest.fn().mockResolvedValue({ data: consent ? { status: consent } : null, error: null }) };
  return { auth: { oauth }, schema: () => ({ from: () => q }), oauth, q };
}

let storage;
let replaceState;
let originalWindow;
let originalOS;

beforeEach(() => {
  storage = memoryStorage();
  replaceState = jest.fn();
  originalWindow = global.window;
  originalOS = Platform.OS;
  Platform.OS = 'web';
  global.sessionStorage = storage;
  global.window = { location: { pathname: '/oauth/consent', search: `?authorization_id=${ID}` }, history: { replaceState } };
});

afterEach(() => {
  Platform.OS = originalOS;
  global.window = originalWindow;
  delete global.sessionStorage;
});

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

const signedInAs = (id) => ({ loading: false, signedIn: true, user: { id } });
const SIGNED_OUT = { loading: false, signedIn: false, user: null };

function mountHook(initialAuth, client, navigate = jest.fn()) {
  const out = { current: null };
  function Harness({ auth }) {
    out.current = useMcpAuthorization(auth, { getClient: () => client, navigate });
    return null;
  }
  let tree;
  act(() => { tree = renderer.create(<Harness auth={initialAuth} />); });
  return { out, navigate, setAuth: (auth) => act(() => { tree.update(<Harness auth={auth} />); }), unmount: () => act(() => tree.unmount()) };
}

describe('useMcpAuthorization', () => {
  test('is idle (and silent) outside the authorization route and off web', () => {
    global.window.location = { pathname: '/', search: '' };
    const client = makeClient();
    const h = mountHook(signedInAs('user-a'), client);
    expect(h.out.current.active).toBe(false);
    expect(client.oauth.getAuthorizationDetails).not.toHaveBeenCalled();
    h.unmount();
    Platform.OS = 'ios';
    global.window.location = { pathname: '/oauth/consent', search: `?authorization_id=${ID}` };
    const native = mountHook(signedInAs('user-a'), client);
    expect(native.out.current.active).toBe(false);
    native.unmount();
  });

  test('stores only the id, scrubs the query, and shows details only after a lookup and consent check', async () => {
    const client = makeClient();
    const h = mountHook(signedInAs('user-a'), client);
    expect(JSON.parse(storage.map.get(lib.PENDING_STORAGE_KEY)).authorizationId).toBe(ID);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/oauth/consent');
    await flush();
    expect(h.out.current.phase).toBe('ready');
    expect(h.out.current.details.clientName).toBe('Claude Code');
    expect(client.oauth.approveAuthorization).not.toHaveBeenCalled();
    expect(client.oauth.denyAuthorization).not.toHaveBeenCalled();
    h.unmount();
  });

  test('invalid ids render the invalid state with no API call and no stored entry', () => {
    global.window.location = { pathname: '/oauth/consent', search: '?authorization_id=<script>' };
    const client = makeClient();
    const h = mountHook(signedInAs('user-a'), client);
    expect(h.out.current.phase).toBe('invalid');
    expect(client.oauth.getAuthorizationDetails).not.toHaveBeenCalled();
    expect(storage.map.size).toBe(0);
    h.unmount();
  });

  test('signed-out users see sign-in, and signing in resumes the same request', async () => {
    const client = makeClient();
    const h = mountHook(SIGNED_OUT, client);
    await flush();
    expect(h.out.current.phase).toBe('signed_out');
    expect(client.oauth.getAuthorizationDetails).not.toHaveBeenCalled();
    h.setAuth(signedInAs('user-a'));
    await flush();
    expect(h.out.current.phase).toBe('ready');
    expect(client.oauth.getAuthorizationDetails).toHaveBeenCalledWith(ID);
    h.unmount();
  });

  test('resumes from the stored id at the origin root (GitHub sign-in return)', async () => {
    lib.savePendingAuthorization(ID);
    global.window.location = { pathname: '/', search: '' };
    const client = makeClient();
    const h = mountHook(signedInAs('user-a'), client);
    await flush();
    expect(h.out.current.phase).toBe('ready');
    h.unmount();
  });

  test('a reloaded path without a query resumes only while the stored id is fresh', () => {
    global.window.location = { pathname: '/oauth/consent', search: '' };
    const h = mountHook(signedInAs('user-a'), makeClient());
    expect(h.out.current.phase).toBe('invalid');
    h.unmount();
  });

  test('approve records the choice, clears the entry first, then follows the Auth redirect', async () => {
    const client = makeClient();
    const h = mountHook(signedInAs('user-a'), client);
    await flush();
    await act(async () => { h.out.current.approve(); });
    await flush();
    expect(client.oauth.approveAuthorization).toHaveBeenCalledWith(ID, { skipBrowserRedirect: true });
    expect(storage.map.has(lib.PENDING_STORAGE_KEY)).toBe(false);
    expect(h.navigate).toHaveBeenCalledWith('https://c.example/cb?code=1');
    expect(h.out.current.phase).toBe('redirecting');
    h.unmount();
  });

  test('deny works and a second tap while submitting is ignored', async () => {
    const client = makeClient();
    const h = mountHook(signedInAs('user-a'), client);
    await flush();
    await act(async () => { h.out.current.deny(); h.out.current.deny(); h.out.current.approve(); });
    await flush();
    expect(client.oauth.denyAuthorization).toHaveBeenCalledTimes(1);
    expect(client.oauth.approveAuthorization).not.toHaveBeenCalled();
    expect(h.navigate).toHaveBeenCalledWith('https://c.example/cb?error=access_denied');
    h.unmount();
  });

  test('missing health consent allows deny only and never approves', async () => {
    const client = makeClient({ consent: null });
    const h = mountHook(signedInAs('user-a'), client);
    await flush();
    expect(h.out.current.phase).toBe('consent_missing');
    await act(async () => { h.out.current.approve(); });
    await flush();
    expect(client.oauth.approveAuthorization).not.toHaveBeenCalled();
    await act(async () => { h.out.current.deny(); });
    await flush();
    expect(client.oauth.denyAuthorization).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  test('expired, used, unknown and foreign requests render the gone state and clear the entry', async () => {
    const h = mountHook(signedInAs('user-a'), makeClient({ details: { data: null, error: { status: 404 } } }));
    await flush();
    expect(h.out.current.phase).toBe('error');
    expect(h.out.current.error).toBe('gone');
    expect(storage.map.has(lib.PENDING_STORAGE_KEY)).toBe(false);
    h.unmount();
    lib.savePendingAuthorization(ID);
    const other = mountHook(signedInAs('user-b'), makeClient());
    await flush();
    expect(other.out.current.error).toBe('gone');
    expect(other.out.current.details).toBeNull();
    other.unmount();
  });

  test('a provider failure is retryable and keeps the request', async () => {
    const client = makeClient({ details: { data: null, error: { status: 503 } } });
    const h = mountHook(signedInAs('user-a'), client);
    await flush();
    expect(h.out.current.error).toBe('unavailable');
    expect(storage.map.has(lib.PENDING_STORAGE_KEY)).toBe(true);
    client.oauth.getAuthorizationDetails.mockResolvedValue({ data: DETAILS, error: null });
    await act(async () => { h.out.current.retry(); });
    await flush();
    expect(h.out.current.phase).toBe('ready');
    h.unmount();
  });

  test('a failed decision keeps the request open, reports truthfully and does not navigate', async () => {
    const client = makeClient({ decision: { data: null, error: { status: 503 } } });
    const h = mountHook(signedInAs('user-a'), client);
    await flush();
    await act(async () => { h.out.current.approve(); });
    await flush();
    expect(h.out.current.phase).toBe('ready');
    expect(h.out.current.error).toBe('decision_failed');
    expect(h.navigate).not.toHaveBeenCalled();
    h.unmount();
  });

  test('an unsafe redirect from Auth is treated as a failed decision', async () => {
    const client = makeClient({ decision: { data: { redirect_url: 'javascript:alert(1)' }, error: null } });
    const h = mountHook(signedInAs('user-a'), client);
    await flush();
    await act(async () => { h.out.current.approve(); });
    await flush();
    expect(h.navigate).not.toHaveBeenCalled();
    expect(h.out.current.error).toBe('decision_failed');
    h.unmount();
  });

  test('Auth that already holds consent returns a redirect, which is followed when safe', async () => {
    const client = makeClient({ details: { data: { redirect_url: 'https://c.example/cb?code=9' }, error: null } });
    const h = mountHook(signedInAs('user-a'), client);
    await flush();
    expect(h.navigate).toHaveBeenCalledWith('https://c.example/cb?code=9');
    expect(storage.map.has(lib.PENDING_STORAGE_KEY)).toBe(false);
    h.unmount();
  });

  test('sign-out and account switch end the request and clear the entry', async () => {
    const client = makeClient();
    const h = mountHook(signedInAs('user-a'), client);
    await flush();
    h.setAuth(SIGNED_OUT);
    await flush();
    expect(h.out.current.phase).toBe('ended');
    expect(h.out.current.details).toBeNull();
    expect(storage.map.has(lib.PENDING_STORAGE_KEY)).toBe(false);
    h.setAuth(signedInAs('user-b'));
    await flush();
    expect(h.out.current.phase).toBe('ended');
    expect(client.oauth.getAuthorizationDetails).toHaveBeenCalledTimes(1);
    h.unmount();

    const switched = mountHook(signedInAs('user-a'), makeClient());
    await flush();
    switched.setAuth(signedInAs('user-b'));
    await flush();
    expect(switched.out.current.phase).toBe('ended');
    expect(switched.out.current.details).toBeNull();
    await act(async () => { switched.out.current.approve(); });
    expect(switched.out.current.phase).toBe('ended');
    switched.unmount();
  });

  test('a stale lookup resolving after an account switch is dropped', async () => {
    let resolveLookup;
    const client = makeClient();
    client.oauth.getAuthorizationDetails.mockReturnValue(new Promise((resolve) => { resolveLookup = resolve; }));
    const h = mountHook(signedInAs('user-a'), client);
    await flush();
    h.setAuth(signedInAs('user-b'));
    await act(async () => { resolveLookup({ data: DETAILS, error: null }); });
    await flush();
    expect(h.out.current.phase).toBe('ended');
    expect(h.out.current.details).toBeNull();
    h.unmount();
  });

  test('a stale approval resolving after sign-out never navigates', async () => {
    let resolveApprove;
    const client = makeClient();
    client.oauth.approveAuthorization.mockReturnValue(new Promise((resolve) => { resolveApprove = resolve; }));
    const h = mountHook(signedInAs('user-a'), client);
    await flush();
    await act(async () => { h.out.current.approve(); });
    h.setAuth(SIGNED_OUT);
    await act(async () => { resolveApprove({ data: { redirect_url: 'https://c.example/cb?code=1' }, error: null }); });
    await flush();
    expect(h.navigate).not.toHaveBeenCalled();
    expect(h.out.current.phase).toBe('ended');
    h.unmount();
  });

  test('unmount drops in-flight work and clears the stored id', async () => {
    let resolveLookup;
    const client = makeClient();
    client.oauth.getAuthorizationDetails.mockReturnValue(new Promise((resolve) => { resolveLookup = resolve; }));
    const h = mountHook(signedInAs('user-a'), client);
    await flush();
    h.unmount();
    expect(storage.map.has(lib.PENDING_STORAGE_KEY)).toBe(false);
    await act(async () => { resolveLookup({ data: DETAILS, error: null }); });
    expect(client.q.maybeSingle).not.toHaveBeenCalled();
  });

  test('closing the request returns the shell to idle and the root URL', async () => {
    const h = mountHook(signedInAs('user-a'), makeClient({ details: { data: null, error: { status: 404 } } }));
    await flush();
    act(() => { h.out.current.dismiss(); });
    expect(h.out.current.active).toBe(false);
    expect(replaceState).toHaveBeenLastCalledWith(null, '', '/');
    h.unmount();
  });

  test('nothing sensitive reaches the console', async () => {
    const spies = ['log', 'info', 'warn', 'error'].map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
    const h = mountHook(signedInAs('user-a'), makeClient());
    await flush();
    await act(async () => { h.out.current.approve(); });
    await flush();
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(ID);
      expect(JSON.stringify(spy.mock.calls)).not.toContain('code=1');
      spy.mockRestore();
    }
    h.unmount();
  });
});

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

function textOf(node) {
  if (typeof node === 'string') return node;
  if (!node || !node.children) return '';
  return node.children.map(textOf).join('');
}

function renderScreen(mcp) {
  let tree;
  act(() => { tree = renderer.create(<McpAuthorizationScreen mcp={{ approve: jest.fn(), deny: jest.fn(), retry: jest.fn(), dismiss: jest.fn(), details: null, error: null, ...mcp }} auth={{}} />); });
  return tree;
}

const READY_DETAILS = { clientName: 'Claude Code', redirectHost: 'localhost:33418', clientId: 'c1', userId: 'u', authorizationId: ID };

describe('McpAuthorizationScreen', () => {
  test('ready: identity, read-only snapshot scope, transmission and disconnect disclosure, distinct actions', () => {
    const approve = jest.fn();
    const deny = jest.fn();
    const tree = renderScreen({ phase: 'ready', details: READY_DETAILS, approve, deny });
    const text = textOf(tree.toJSON());
    expect(text).toContain('Claude Code');
    expect(text).toContain('localhost:33418');
    expect(text).toContain('not verified by Kilo');
    expect(text).toMatch(/already synced to your Kilo Cloud/);
    expect(text).toMatch(/read-only/);
    expect(text).toMatch(/sent to this client/);
    expect(text).toMatch(/Account → Connected AI clients/);
    expect(text).toMatch(/does not disconnect it/);
    const approveBtn = tree.root.findByProps({ accessibilityLabel: 'Approve this AI client' });
    const denyBtn = tree.root.findByProps({ accessibilityLabel: 'Deny this AI client' });
    act(() => { approveBtn.props.onPress(); });
    act(() => { denyBtn.props.onPress(); });
    expect(approve).toHaveBeenCalledTimes(1);
    expect(deny).toHaveBeenCalledTimes(1);
  });

  test('client text renders as plain text, never as a link or markup', () => {
    const tree = renderScreen({ phase: 'ready', details: { ...READY_DETAILS, clientName: '<b>[x](https://evil.example)</b>' } });
    expect(textOf(tree.toJSON())).toContain('<b>[x](https://evil.example)</b>');
    expect(tree.root.findAllByProps({ accessibilityRole: 'link' })).toHaveLength(0);
  });

  test('missing consent offers Deny only and says it grants nothing', () => {
    const tree = renderScreen({ phase: 'consent_missing', details: READY_DETAILS });
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Approve this AI client' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Deny this AI client' }).length).toBeGreaterThan(0);
    expect(textOf(tree.toJSON())).toContain('does not turn on Cloud Sync or grant consent');
  });

  test('a failed decision is reported and the actions stay available', () => {
    const tree = renderScreen({ phase: 'ready', details: READY_DETAILS, error: 'decision_failed' });
    expect(textOf(tree.toJSON())).toContain(STATE_COPY.decisionFailed);
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Approve this AI client' }).length).toBeGreaterThan(0);
  });

  test.each([
    [{ phase: 'invalid' }, STATE_COPY.invalid.title],
    [{ phase: 'error', error: 'gone' }, STATE_COPY.gone.title],
    [{ phase: 'error', error: 'unavailable' }, STATE_COPY.unavailable.title],
    [{ phase: 'ended' }, STATE_COPY.ended.title],
    [{ phase: 'loading' }, STATE_COPY.loading.title],
    [{ phase: 'redirecting' }, STATE_COPY.redirecting.title],
  ])('safe state %j', (mcp, title) => {
    const tree = renderScreen(mcp);
    expect(textOf(tree.toJSON())).toContain(title);
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Approve this AI client' })).toHaveLength(0);
  });

  test('signed-out shows the existing sign-in surface', () => {
    const tree = renderScreen({ phase: 'signed_out' });
    expect(tree.root.findByProps({ testID: 'account-sign-in' })).toBeTruthy();
  });
});

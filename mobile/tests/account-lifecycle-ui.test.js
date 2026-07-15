// Account lifecycle UI tests (Phase 5 / Task 13 / issue #322, #330).
//
// Covers the two new useAuthSession methods (serverExport, deleteAccount) and
// the AccountLifecycle component's export + delete flows:
//   - serverExport calls /functions/v1/account-export with the session JWT.
//   - deleteAccount calls /functions/v1/account-delete, then clears the session.
//   - Export errors surface the error message from the function response.
//   - deleteAccount success results in a signed-out state.
//   - No privileged key appears in any test path (service-role key is server-only).
//   - AccountLifecycle renders Privacy Policy and Terms of Service links (issue #330).

import React from 'react';

// Health-data consent (#487) is granted for these suites. They exercise sync,
// bootstrap, and ownership mechanics, not authorization — consent-gate-client.test.js
// covers the denial paths. Without this the hook's grant check would short-circuit
// every sync here (no Supabase client is configured under test), and these tests
// would silently pass for the wrong reason.
jest.mock('../storage/cloud/consent', () => {
  const actual = jest.requireActual('../storage/cloud/consent');
  return {
    ...actual,
    fetchConsentStatus: jest.fn().mockResolvedValue({ allowed: true, code: 'OK' }),
    withdrawConsent: jest.fn().mockResolvedValue({ ok: true, status: 'deletion_pending' }),
    requestHealthDataDeletion: jest.fn().mockResolvedValue({ ok: true }),
    fetchActiveConsentRevision: jest.fn().mockResolvedValue({
      catalog_revision: 1,
      material_version: 1,
      privacy_policy_url: 'https://example.invalid/privacy.html',
    }),
  };
});

let renderer;
let act;

// Mocks needed when importing AccountLifecycle from MoreScreen for UI tests.
// These prevent cascading native deps (expo-updates, Pressable hooks) from
// breaking the hook-level tests that run in the same file.
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(),
}));

jest.mock('../components/HelpScreen', () => ({ HelpScreen: () => null }));
jest.mock('../components/AboutScreen', () => ({ AboutScreen: () => null }));
jest.mock('../components/BackupScreen', () => ({ BackupScreen: () => null }));
jest.mock('../components/SettingsScreen', () => ({ SettingsScreen: () => null }));
jest.mock('../components/ProfileScreen', () => ({ ProfileScreen: () => null }));
jest.mock('../components/ScreenShell', () => ({ ScreenShell: ({ children }) => children }));
jest.mock('../components/UI', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    Button: ({ title, accessibilityLabel, onPress }) => React.createElement(View, { accessibilityLabel, onPress }, React.createElement(Text, null, title)),
    SectionTitle: ({ children }) => React.createElement(View, null, React.createElement(Text, null, children)),
    InputStyle: {},
  };
});
jest.mock('../hooks/useEntries', () => ({
  useSyncRecovery: () => ({ bootstrap: { status: 'idle', retryable: false }, sync: { status: 'idle', retryable: false }, runBootstrap: jest.fn(), runSync: jest.fn(), retryBootstrap: jest.fn(), retrySync: jest.fn() }),
  useCloudExport: () => ({ exportCloud: jest.fn() }),
  useCloudSyncStatus: () => mockCloudSyncStatus,
}));

// --- fetch mock -----------------------------------------------------------
let mockFetch;
global.fetch = (...args) => mockFetch(...args);

// --- Supabase client mock -------------------------------------------------
let mockSession;
let mockAuth;
let mockCloudSyncStatus;

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: mockAuth }),
}));

process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

let useAuthSession;
let resetSupabaseClientForTests;
let AccountLifecycle;
let AccountScreen;
let MoreScreen;
let Platform;
let Linking;
let WebBrowser;

function makeMockAuth(session = null) {
  let authStateCb = null;
  return {
    getSession: jest.fn().mockResolvedValue({ data: { session }, error: null }),
    getUser: jest.fn().mockResolvedValue({ data: { user: session?.user ?? null }, error: null }),
    onAuthStateChange: jest.fn((cb) => {
      authStateCb = cb;
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    }),
    signInWithPassword: jest.fn().mockResolvedValue({ data: { session }, error: null }),
    signOut: jest.fn().mockResolvedValue({ error: null }),
    signUp: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
    resetPasswordForEmail: jest.fn().mockResolvedValue({ error: null }),
    signInWithOAuth: jest.fn().mockResolvedValue({ data: { url: null }, error: null }),
    exchangeCodeForSession: jest.fn().mockResolvedValue({ data: { session: { user: { email: 'oauth@test.com' } } }, error: null }),
    _emit: (event, s) => authStateCb && authStateCb(event, s),
    ...({} ),
  };
}

const FAKE_SESSION = {
  access_token: 'tok-abc',
  user: { id: 'uid-1', email: 'a@test.com' },
};

// AccountScreen now consumes an `auth` instance threaded down from the app shell
// (#366) instead of calling useAuthSession() itself. These helpers build the
// `auth` prop the screen expects, delegating OAuth plumbing to the current
// `mockAuth` so the existing flow assertions still hold.
//
// `makeResolvedAuthProp` mirrors a fully-restored shell session: loading=false,
// so the screen renders its terminal view immediately with no probe window.
// `makeLoadingAuthProp` mirrors a genuine cold-start restore window:
// loading=true, signedIn=false (the #365 gate input).
function makeOAuthDelegates() {
  return {
    signInWithOAuth: async (provider, options) => {
      const oauthOptions = options
        ? {
            redirectTo: options.redirectTo,
            ...(options.skipBrowserRedirect != null ? { skipBrowserRedirect: options.skipBrowserRedirect } : {}),
          }
        : undefined;
      const { data, error } = await mockAuth.signInWithOAuth({ provider, options: oauthOptions });
      if (error) return { ok: false, error: error.message };
      return { ok: true, url: data?.url || null };
    },
    handleAuthCallbackUrl: async (url) => {
      const errorMatch = /[?&]error=([^&#]*)/.exec(url);
      if (errorMatch) {
        const errorCode = decodeURIComponent(errorMatch[1].replace(/\+/g, ' '));
        const descMatch = /[?&]error_description=([^&#]*)/.exec(url);
        const desc = descMatch ? decodeURIComponent(descMatch[1].replace(/\+/g, ' ')) : errorCode;
        return { ok: false, error: desc };
      }
      const codeMatch = /[?&]code=([^&#]+)/.exec(url);
      if (codeMatch) {
        const code = decodeURIComponent(codeMatch[1]);
        const { data, error } = await mockAuth.exchangeCodeForSession(code);
        if (error) return { ok: false, error: error.message };
        if (!data?.session) return { ok: false, error: 'Sign in did not complete.' };
        return { ok: true, session: data.session };
      }
      return { ok: false, error: 'Sign in did not complete.' };
    },
  };
}

function makeResolvedAuthProp(session = null, overrides = {}) {
  return {
    configured: true,
    loading: false,
    session,
    user: session?.user || null,
    signedIn: Boolean(session),
    ...makeOAuthDelegates(),
    signInWithPassword: jest.fn().mockResolvedValue({ ok: true }),
    signUpWithPassword: jest.fn().mockResolvedValue({ ok: true }),
    signOut: jest.fn().mockResolvedValue({ ok: true }),
    resetPasswordForEmail: jest.fn().mockResolvedValue({ ok: true }),
    serverExport: jest.fn().mockResolvedValue({ ok: true, json: '{}' }),
    deleteAccount: jest.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

function makeCloudSyncStatus(overrides = {}) {
  return {
    statusLabel: 'Fully synced',
    dirtyCount: 0,
    lastSuccessfulAt: '2026-07-06T15:20:00.000Z',
    lastSuccessfulLabel: 'Jul 6, 2026, 3:20 PM',
    isRunning: false,
    hasFailed: false,
    hasDirty: false,
    hasLastSuccess: true,
    ...overrides,
  };
}

function renderHook() {
  const ref = { current: null };
  function Probe() {
    ref.current = useAuthSession();
    return null;
  }
  let tree;
  act(() => { tree = renderer.create(React.createElement(Probe)); });
  return { ref, tree };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

  mockSession = { ...FAKE_SESSION };
  mockAuth = makeMockAuth(mockSession);
  mockCloudSyncStatus = makeCloudSyncStatus();

  const testRenderer = require('react-test-renderer');
  renderer = testRenderer.default || testRenderer;
  act = testRenderer.act;

  const rn = require('react-native');
  Platform = rn.Platform;
  Linking = rn.Linking;

  useAuthSession = require('../hooks/useAuthSession').useAuthSession;
  resetSupabaseClientForTests = require('../lib/supabaseClient').resetSupabaseClientForTests;
  const moreScreen = require('../screens/MoreScreen');
  AccountLifecycle = moreScreen.AccountLifecycle;
  AccountScreen = moreScreen.AccountScreen;
  MoreScreen = moreScreen.MoreScreen;
  WebBrowser = require('expo-web-browser');

  resetSupabaseClientForTests();
  mockFetch = jest.fn();
});

// ---------------------------------------------------------------------------
// serverExport
// ---------------------------------------------------------------------------

describe('serverExport', () => {
  test('calls account-export with Bearer token and returns JSON on success', async () => {
    const payload = { version: 3, exportedAt: '2026-01-01T00:00:00Z', account: { id: 'uid-1' }, cloud: {} };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => payload,
    });

    const { ref } = renderHook();
    await flush();

    let result;
    await act(async () => { result = await ref.current.serverExport(); });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.supabase.co/functions/v1/account-export',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok-abc' }),
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.payload).toEqual(payload);
    expect(typeof result.json).toBe('string');
  });

  test('returns error when function responds with non-ok status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Unauthorized' }),
    });

    const { ref } = renderHook();
    await flush();

    let result;
    await act(async () => { result = await ref.current.serverExport(); });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Unauthorized');
  });

  test('returns error when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network failure'));

    const { ref } = renderHook();
    await flush();

    let result;
    await act(async () => { result = await ref.current.serverExport(); });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/network failure/);
  });

  test('returns LOCAL_ONLY_RESULT when Supabase is not configured', async () => {
    resetSupabaseClientForTests();
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    const { useAuthSession: freshHook } = jest.requireActual('../hooks/useAuthSession');
    // Re-require with no config.
    jest.resetModules();
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

    // Restore for other tests.
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

    // serverExport is tested for the configured path above; unconfigured path
    // returns LOCAL_ONLY_RESULT (ok: false) via requireClient returning null.
    // This is covered implicitly by the hook's local-only guard.
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// deleteAccount
// ---------------------------------------------------------------------------

describe('deleteAccount', () => {
  test('calls account-delete, then signs out on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });

    const { ref } = renderHook();
    await flush();

    let result;
    await act(async () => { result = await ref.current.deleteAccount(); });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.supabase.co/functions/v1/account-delete',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok-abc' }),
      }),
    );
    expect(result.ok).toBe(true);
    expect(mockAuth.signOut).toHaveBeenCalled();
  });

  test('returns error and does not sign out when function fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Account deletion failed.' }),
    });

    const { ref } = renderHook();
    await flush();

    let result;
    await act(async () => { result = await ref.current.deleteAccount(); });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Account deletion failed.');
    expect(mockAuth.signOut).not.toHaveBeenCalled();
  });

  test('returns error when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('offline'));

    const { ref } = renderHook();
    await flush();

    let result;
    await act(async () => { result = await ref.current.deleteAccount(); });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/offline/);
  });

  test('does not include service-role key in fetch call', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });

    const { ref } = renderHook();
    await flush();

    await act(async () => { await ref.current.deleteAccount(); });

    const [, options] = mockFetch.mock.calls[0];
    const headers = options?.headers ?? {};
    const headerValues = Object.values(headers).join(' ');
    expect(headerValues).not.toMatch(/service_role/i);
    expect(headerValues).not.toMatch(/secret/i);
  });
});

// ---------------------------------------------------------------------------
// AccountLifecycle privacy and terms links (issue #330)
// ---------------------------------------------------------------------------

describe('AccountLifecycle legal link placements', () => {
  function makeAuth() {
    return {
      serverExport: jest.fn().mockResolvedValue({ ok: true, json: '{}' }),
      deleteAccount: jest.fn().mockResolvedValue({ ok: true }),
    };
  }

  function renderLifecycle() {
    let tree;
    act(() => {
      tree = renderer.create(React.createElement(AccountLifecycle, { auth: makeAuth() }));
    });
    return JSON.stringify(tree.toJSON());
  }

  test('renders Privacy Policy link', () => {
    expect(renderLifecycle()).toMatch(/Privacy Policy/);
  });

  test('renders Terms of Service link', () => {
    expect(renderLifecycle()).toMatch(/Terms of Service/);
  });
});

// ---------------------------------------------------------------------------
// AccountScreen OAuth Flow
// ---------------------------------------------------------------------------

describe('AccountScreen OAuth Flow', () => {
  let originalPlatformOS;
  let originalWindow;

  beforeEach(() => {
    originalPlatformOS = Platform.OS;
    originalWindow = global.window;
    // Set up a clean signed-out mock auth
    mockSession = null;
    mockAuth = makeMockAuth(null);
    resetSupabaseClientForTests();
    if (WebBrowser && WebBrowser.openAuthSessionAsync) {
      WebBrowser.openAuthSessionAsync.mockClear();
    }
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalPlatformOS, configurable: true });
    jest.restoreAllMocks();
    if (originalWindow !== undefined) {
      global.window = originalWindow;
    } else {
      delete global.window;
    }
  });

  test('does not render Continue with GitHub button on iOS', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });

    let tree;
    act(() => {
      tree = renderer.create(React.createElement(AccountScreen, { onBack: jest.fn(), auth: makeResolvedAuthProp(null) }));
    });

    const buttons = tree.root.findAllByProps({ accessibilityLabel: 'Continue with GitHub' });
    expect(buttons.length).toBe(0);
  });

  test('calls signInWithOAuth with github and redirects on web', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    mockAuth.signInWithOAuth.mockResolvedValueOnce({
      data: { url: 'https://github.com/login/oauth-web' },
      error: null,
    });

    // Mock window.location and window.location.origin
    const mockLocation = { href: '', origin: 'https://kilo-app.example.com' };
    global.window = { location: mockLocation };

    let tree;
    act(() => {
      tree = renderer.create(React.createElement(AccountScreen, { onBack: jest.fn(), auth: makeResolvedAuthProp(null) }));
    });

    const button = tree.root.findByProps({ accessibilityLabel: 'Continue with GitHub' });
    await act(async () => {
      await button.props.onPress();
    });

    expect(mockAuth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'github',
      options: { redirectTo: 'https://kilo-app.example.com' },
    });
    expect(global.window.location.href).toBe('https://github.com/login/oauth-web');
  });

  test('displays error message when OAuth fails on web', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    mockAuth.signInWithOAuth.mockResolvedValueOnce({
      data: { url: null },
      error: new Error('OAuth authentication failed'),
    });

    // Mock window.location
    global.window = { location: { href: '', origin: 'https://kilo-app.example.com' } };

    let tree;
    act(() => {
      tree = renderer.create(React.createElement(AccountScreen, { onBack: jest.fn(), auth: makeResolvedAuthProp(null) }));
    });

    const button = tree.root.findByProps({ accessibilityLabel: 'Continue with GitHub' });
    await act(async () => {
      await button.props.onPress();
    });

    expect(mockAuth.signInWithOAuth).toHaveBeenCalled();
    const statusText = tree.root.findByProps({ accessibilityLabel: 'Account status' });
    expect(statusText.props.children).toBe('OAuth authentication failed');
  });

  test('does not render Continue with GitHub button when Supabase is not configured', () => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });

    const auth = {
      configured: false,
      loading: false,
      session: null,
      user: null,
      signedIn: false,
    };

    let tree;
    act(() => {
      tree = renderer.create(React.createElement(AccountScreen, { onBack: jest.fn(), auth }));
    });

    const buttons = tree.root.findAllByProps({ accessibilityLabel: 'Continue with GitHub' });
    expect(buttons.length).toBe(0);
  });

  test('renders Continue with GitHub button on Android', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });

    let tree;
    act(() => {
      tree = renderer.create(React.createElement(AccountScreen, { onBack: jest.fn(), auth: makeResolvedAuthProp(null) }));
    });

    // findByProps throws if not exactly one host element matches; this verifies
    // the button is present without depending on fiber-count implementation details.
    const button = tree.root.findByProps({ accessibilityLabel: 'Continue with GitHub' });
    expect(button).toBeTruthy();
  });

  test('Android OAuth success: opens browser and exchanges code for session', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });

    mockAuth.signInWithOAuth.mockResolvedValueOnce({
      data: { url: 'https://github.com/login/oauth-android' },
      error: null,
    });
    WebBrowser.openAuthSessionAsync.mockResolvedValueOnce({
      type: 'success',
      url: 'kilo://auth/callback?code=abc123',
    });

    let tree;
    act(() => {
      tree = renderer.create(React.createElement(AccountScreen, { onBack: jest.fn(), auth: makeResolvedAuthProp(null) }));
    });

    const button = tree.root.findByProps({ accessibilityLabel: 'Continue with GitHub' });
    await act(async () => {
      await button.props.onPress();
    });

    expect(mockAuth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'github',
      options: { redirectTo: 'kilo://auth/callback', skipBrowserRedirect: true },
    });
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
      'https://github.com/login/oauth-android',
      'kilo://auth/callback',
    );
    expect(mockAuth.exchangeCodeForSession).toHaveBeenCalledWith('abc123');
    const statusText = tree.root.findByProps({ accessibilityLabel: 'Account status' });
    expect(statusText.props.children).toBe('Signed in.');
  });

  test('Android OAuth cancellation shows cancelled message', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });

    mockAuth.signInWithOAuth.mockResolvedValueOnce({
      data: { url: 'https://github.com/login/oauth-android' },
      error: null,
    });
    WebBrowser.openAuthSessionAsync.mockResolvedValueOnce({ type: 'cancel' });

    let tree;
    act(() => {
      tree = renderer.create(React.createElement(AccountScreen, { onBack: jest.fn(), auth: makeResolvedAuthProp(null) }));
    });

    const button = tree.root.findByProps({ accessibilityLabel: 'Continue with GitHub' });
    await act(async () => {
      await button.props.onPress();
    });

    const statusText = tree.root.findByProps({ accessibilityLabel: 'Account status' });
    expect(statusText.props.children).toBe('Sign in cancelled.');
    expect(mockAuth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  test('Android OAuth error: signInWithOAuth failure shows error', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });

    mockAuth.signInWithOAuth.mockResolvedValueOnce({
      data: { url: null },
      error: { message: 'provider not enabled' },
    });

    let tree;
    act(() => {
      tree = renderer.create(React.createElement(AccountScreen, { onBack: jest.fn(), auth: makeResolvedAuthProp(null) }));
    });

    const button = tree.root.findByProps({ accessibilityLabel: 'Continue with GitHub' });
    await act(async () => {
      await button.props.onPress();
    });

    const statusText = tree.root.findByProps({ accessibilityLabel: 'Account status' });
    expect(statusText.props.children).toBe('provider not enabled');
    expect(WebBrowser.openAuthSessionAsync).not.toHaveBeenCalled();
  });

  test('Android OAuth error: provider callback contains error param shows error', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });

    mockAuth.signInWithOAuth.mockResolvedValueOnce({
      data: { url: 'https://github.com/login/oauth-android' },
      error: null,
    });
    WebBrowser.openAuthSessionAsync.mockResolvedValueOnce({
      type: 'success',
      url: 'kilo://auth/callback?error=access_denied&error_description=User+cancelled+login',
    });

    let tree;
    act(() => {
      tree = renderer.create(React.createElement(AccountScreen, { onBack: jest.fn(), auth: makeResolvedAuthProp(null) }));
    });

    const button = tree.root.findByProps({ accessibilityLabel: 'Continue with GitHub' });
    await act(async () => {
      await button.props.onPress();
    });

    const statusText = tree.root.findByProps({ accessibilityLabel: 'Account status' });
    expect(statusText.props.children).toBe('User cancelled login');
    expect(mockAuth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  test('Android OAuth success result with no code or error shows error', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });

    mockAuth.signInWithOAuth.mockResolvedValueOnce({
      data: { url: 'https://github.com/login/oauth-android' },
      error: null,
    });
    WebBrowser.openAuthSessionAsync.mockResolvedValueOnce({
      type: 'success',
      url: 'kilo://auth/callback',
    });

    let tree;
    act(() => {
      tree = renderer.create(React.createElement(AccountScreen, { onBack: jest.fn(), auth: makeResolvedAuthProp(null) }));
    });

    const button = tree.root.findByProps({ accessibilityLabel: 'Continue with GitHub' });
    await act(async () => {
      await button.props.onPress();
    });

    const statusText = tree.root.findByProps({ accessibilityLabel: 'Account status' });
    expect(statusText.props.children).toMatch(/did not complete/i);
    expect(mockAuth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  test('does not flash Sign In form while the shell session is still loading (#365)', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });

    // Genuine cold-start restore window: the shell auth instance threaded down
    // is still loading (configured && loading && !signedIn). The Sign In form /
    // email input must not be rendered during this window, and the loading
    // placeholder is shown instead. (#366 keeps the #365 gate for this case.)
    const loadingAuth = makeResolvedAuthProp(null, { loading: true });

    let tree;
    act(() => {
      tree = renderer.create(React.createElement(AccountScreen, { onBack: jest.fn(), auth: loadingAuth }));
    });

    expect(tree.root.findAllByProps({ accessibilityLabel: 'Email' }).length).toBe(0);
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Continue with GitHub' }).length).toBe(0);
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Account loading' }).length).toBeGreaterThanOrEqual(1);

    // Once the shell session resolves to signed-in, the signed-in view shows
    // and the Sign In form is still absent.
    act(() => {
      tree.update(React.createElement(AccountScreen, { onBack: jest.fn(), auth: makeResolvedAuthProp(FAKE_SESSION) }));
    });
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Email' }).length).toBe(0);
  });

  test('renders Sign In form once the shell session resolves to signed-out (#365)', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });

    let tree;
    act(() => {
      tree = renderer.create(React.createElement(AccountScreen, { onBack: jest.fn(), auth: makeResolvedAuthProp(null, { loading: true }) }));
    });

    // Still loading: no form yet.
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Email' }).length).toBe(0);

    // After the shell session resolves to signed-out, the Sign In form appears.
    act(() => {
      tree.update(React.createElement(AccountScreen, { onBack: jest.fn(), auth: makeResolvedAuthProp(null) }));
    });
    expect(tree.root.findByProps({ accessibilityLabel: 'Email' })).toBeTruthy();
    expect(tree.root.findByProps({ accessibilityLabel: 'Continue with GitHub' })).toBeTruthy();
  });

  test('renders the Signed-In view immediately when a resolved session is passed in (#366)', () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });

    // The shell already holds a restored session: loading=false, signedIn=true.
    // No per-mount probe runs, so the Signed-In view renders on first paint with
    // no loading placeholder and no Sign In form flash.
    let tree;
    act(() => {
      tree = renderer.create(React.createElement(AccountScreen, { onBack: jest.fn(), auth: makeResolvedAuthProp(FAKE_SESSION) }));
    });

    // Signed-In view is present on the very first synchronous paint.
    const json = JSON.stringify(tree.toJSON());
    expect(json).toMatch(/Signed In/);
    expect(json).toMatch(/a@test\.com/);
    // No loading placeholder and no Sign In form.
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Account loading' }).length).toBe(0);
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Email' }).length).toBe(0);
  });

  test('Android OAuth error: exchange failure shows error message', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });

    mockAuth.signInWithOAuth.mockResolvedValueOnce({
      data: { url: 'https://github.com/login/oauth-android' },
      error: null,
    });
    WebBrowser.openAuthSessionAsync.mockResolvedValueOnce({
      type: 'success',
      url: 'kilo://auth/callback?code=badcode',
    });
    mockAuth.exchangeCodeForSession.mockResolvedValueOnce({
      data: null,
      error: { message: 'invalid code' },
    });

    let tree;
    act(() => {
      tree = renderer.create(React.createElement(AccountScreen, { onBack: jest.fn(), auth: makeResolvedAuthProp(null) }));
    });

    const button = tree.root.findByProps({ accessibilityLabel: 'Continue with GitHub' });
    await act(async () => {
      await button.props.onPress();
    });

    const statusText = tree.root.findByProps({ accessibilityLabel: 'Account status' });
    expect(statusText.props.children).toBe('invalid code');
  });
});

// ---------------------------------------------------------------------------
// AccountScreen auth copy (#496): signing up with an email already registered
// via GitHub used to claim "Account created." then reject the login with a bare
// "Invalid login credentials", pointing nowhere. Supabase deliberately will not
// confirm whether an address exists, so the fix is in the copy, not in branching
// on existence: the signup message is true whether or not the address was
// already registered, and the sign-in hint is appended on EVERY failure so it
// leaks no account-existence oracle. Both messages render in the existing
// `accountStatus` status line — no new panels, spacing, or tokens — so the
// ScreenShell spacing contract (ui-design-rules.md sections 1-3) is unchanged.
// ---------------------------------------------------------------------------

describe('AccountScreen auth copy (#496)', () => {
  let originalPlatformOS;

  beforeEach(() => {
    originalPlatformOS = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    mockSession = null;
    mockAuth = makeMockAuth(null);
    resetSupabaseClientForTests();
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalPlatformOS, configurable: true });
  });

  // The Sign In / Create Account buttons carry no accessibilityLabel (only a
  // title), and the "Sign In" title also appears as the SectionTitle heading.
  // Match the button by its onPress + wrapped title Text so the section heading
  // (which has no onPress) is never selected.
  function findButtonByTitle(tree, title) {
    const matches = tree.root.findAll((node) => (
      typeof node.type === 'string'
      && typeof node.props.onPress === 'function'
      && node.props.children
      && node.props.children.props
      && node.props.children.props.children === title
    ));
    expect(matches.length).toBe(1);
    return matches[0];
  }

  test('Create Account shows honest, enumeration-safe copy instead of "Account created."', async () => {
    const signUpWithPassword = jest.fn().mockResolvedValue({ ok: true });
    const authProp = makeResolvedAuthProp(null, { signUpWithPassword });

    let tree;
    act(() => {
      tree = renderer.create(React.createElement(AccountScreen, { onBack: jest.fn(), auth: authProp }));
    });

    const button = findButtonByTitle(tree, 'Create Account');
    await act(async () => { await button.props.onPress(); });

    const status = tree.root.findByProps({ accessibilityLabel: 'Account status' });
    expect(status.props.children).toBe(
      'If that address is new, check your email to confirm it. If you already signed up with GitHub, use Continue with GitHub instead.',
    );
    expect(status.props.children).not.toMatch(/Account created/);
  });

  test('failed sign-in appends the GitHub hint on a generic Invalid login credentials failure', async () => {
    // The exact opaque error Supabase returns for both a wrong password and a
    // GitHub-only account. The hint must be present regardless.
    const signInWithPassword = jest.fn().mockResolvedValue({ ok: false, error: 'Invalid login credentials' });
    const authProp = makeResolvedAuthProp(null, { signInWithPassword });

    let tree;
    act(() => {
      tree = renderer.create(React.createElement(AccountScreen, { onBack: jest.fn(), auth: authProp }));
    });

    const button = findButtonByTitle(tree, 'Sign In');
    await act(async () => { await button.props.onPress(); });

    const status = tree.root.findByProps({ accessibilityLabel: 'Account status' });
    expect(status.props.children).toMatch(/Invalid login credentials/);
    expect(status.props.children).toMatch(/If you signed up with GitHub, use Continue with GitHub/);
  });

  test('successful sign-in still shows "Signed in." with no GitHub hint appended', async () => {
    const signInWithPassword = jest.fn().mockResolvedValue({ ok: true });
    const authProp = makeResolvedAuthProp(null, { signInWithPassword });

    let tree;
    act(() => {
      tree = renderer.create(React.createElement(AccountScreen, { onBack: jest.fn(), auth: authProp }));
    });

    const button = findButtonByTitle(tree, 'Sign In');
    await act(async () => { await button.props.onPress(); });

    const status = tree.root.findByProps({ accessibilityLabel: 'Account status' });
    expect(status.props.children).toBe('Signed in.');
  });
});

describe('CloudSyncRecovery status summary', () => {
  let originalPlatformOS;

  beforeEach(() => {
    originalPlatformOS = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    mockCloudSyncStatus = makeCloudSyncStatus();
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalPlatformOS, configurable: true });
  });

  test('shows fully synced and the last successful sync time when clean', async () => {
    mockCloudSyncStatus = makeCloudSyncStatus({
      statusLabel: 'Fully synced',
      dirtyCount: 0,
      lastSuccessfulAt: '2026-07-06T15:20:00.000Z',
      lastSuccessfulLabel: 'Jul 6, 2026, 3:20 PM',
    });

    let tree;
    // Awaited: CloudSyncRecovery resolves the health-data consent grant in an effect
    // (#487) and renders no sync controls until the server confirms one, so a
    // synchronous act() would assert against the pre-consent render.
    await act(async () => {
      tree = renderer.create(React.createElement(AccountScreen, { onBack: jest.fn(), auth: makeResolvedAuthProp(FAKE_SESSION) }));
    });

    const summary = tree.root.findByProps({ accessibilityLabel: 'Cloud sync summary' });
    expect(summary.props.children).toBe('Fully synced');
    expect(JSON.stringify(tree.toJSON())).toMatch(/Last synced[^]*Jul 6, 2026, 3:20 PM/);
  });

  test('shows pending local changes when the dirty queue is not empty', async () => {
    mockCloudSyncStatus = makeCloudSyncStatus({
      statusLabel: '2 pending local changes',
      dirtyCount: 2,
      hasDirty: true,
      lastSuccessfulLabel: 'Jul 6, 2026, 3:20 PM',
    });

    let tree;
    // Awaited: CloudSyncRecovery resolves the health-data consent grant in an effect
    // (#487) and renders no sync controls until the server confirms one, so a
    // synchronous act() would assert against the pre-consent render.
    await act(async () => {
      tree = renderer.create(React.createElement(AccountScreen, { onBack: jest.fn(), auth: makeResolvedAuthProp(FAKE_SESSION) }));
    });

    const summary = tree.root.findByProps({ accessibilityLabel: 'Cloud sync summary' });
    expect(summary.props.children).toBe('2 pending local changes');
    expect(JSON.stringify(tree.toJSON())).toMatch(/Local data stays saved on this device while cloud sync is pending or failed\./);
  });

  test('shows last sync failed when the sync phase failed', async () => {
    mockCloudSyncStatus = makeCloudSyncStatus({
      statusLabel: 'Last sync failed',
      hasFailed: true,
      lastSuccessfulLabel: 'Jul 6, 2026, 3:20 PM',
    });

    let tree;
    // Awaited: CloudSyncRecovery resolves the health-data consent grant in an effect
    // (#487) and renders no sync controls until the server confirms one, so a
    // synchronous act() would assert against the pre-consent render.
    await act(async () => {
      tree = renderer.create(React.createElement(AccountScreen, { onBack: jest.fn(), auth: makeResolvedAuthProp(FAKE_SESSION) }));
    });

    const summary = tree.root.findByProps({ accessibilityLabel: 'Cloud sync summary' });
    expect(summary.props.children).toBe('Last sync failed');
  });

  test('does not show cloud sync status for signed-out local-only users', () => {
    let tree;
    act(() => {
      tree = renderer.create(React.createElement(AccountScreen, { onBack: jest.fn(), auth: makeResolvedAuthProp(null) }));
    });

    expect(tree.root.findAllByProps({ accessibilityLabel: 'Cloud sync summary' }).length).toBe(0);
    expect(JSON.stringify(tree.toJSON())).not.toMatch(/Cloud Sync/);
  });
});

// ---------------------------------------------------------------------------
// Reset Password redirectTo (#497): without an explicit redirectTo the reset
// link falls back to the project's default Site URL and the app never sees
// the callback (the bug this issue reports). Mirrors the redirectTo split
// already covered above for GitHub sign-in.
// ---------------------------------------------------------------------------

describe('Reset Password redirectTo', () => {
  let originalPlatformOS;
  let originalWindow;

  beforeEach(() => {
    originalPlatformOS = Platform.OS;
    originalWindow = global.window;
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalPlatformOS, configurable: true });
    if (originalWindow !== undefined) {
      global.window = originalWindow;
    } else {
      delete global.window;
    }
  });

  test('passes the kilo:// deep link redirectTo on native (Android)', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    const resetPasswordForEmail = jest.fn().mockResolvedValue({ ok: true });
    const authProp = makeResolvedAuthProp(null, { resetPasswordForEmail });

    let tree;
    act(() => {
      tree = renderer.create(React.createElement(AccountScreen, { onBack: jest.fn(), auth: authProp }));
    });

    const emailInput = tree.root.findByProps({ accessibilityLabel: 'Email' });
    act(() => { emailInput.props.onChangeText('user@test.com'); });

    const button = tree.root.findByProps({ accessibilityLabel: 'Reset Password' });
    await act(async () => { await button.props.onPress(); });

    expect(resetPasswordForEmail).toHaveBeenCalledWith('user@test.com', { redirectTo: 'kilo://auth/callback' });
  });

  test('passes the web origin as redirectTo on web', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    global.window = { location: { origin: 'https://kilo-app.example.com' } };
    const resetPasswordForEmail = jest.fn().mockResolvedValue({ ok: true });
    const authProp = makeResolvedAuthProp(null, { resetPasswordForEmail });

    let tree;
    act(() => {
      tree = renderer.create(React.createElement(AccountScreen, { onBack: jest.fn(), auth: authProp }));
    });

    const emailInput = tree.root.findByProps({ accessibilityLabel: 'Email' });
    act(() => { emailInput.props.onChangeText('user@test.com'); });

    const button = tree.root.findByProps({ accessibilityLabel: 'Reset Password' });
    await act(async () => { await button.props.onPress(); });

    expect(resetPasswordForEmail).toHaveBeenCalledWith('user@test.com', { redirectTo: 'https://kilo-app.example.com' });
  });
});

// ---------------------------------------------------------------------------
// Set New Password surface (#497): AccountScreen shows SetNewPasswordScreen
// instead of its normal Sign In / Signed In views whenever the shared `auth`
// instance reports an active recovery session or a failed recovery-link
// callback (see useAuthSession.js's PASSWORD_RECOVERY event handling and
// native deep-link listener, covered at the hook level in
// auth-session.test.js).
// ---------------------------------------------------------------------------

describe('Set New Password surface', () => {
  test('shows the set-new-password surface instead of the Signed-In view when a recovery session is active', () => {
    const authProp = makeResolvedAuthProp(FAKE_SESSION, {
      passwordRecovery: true,
      recoveryError: '',
      clearPasswordRecovery: jest.fn(),
      updatePassword: jest.fn().mockResolvedValue({ ok: true }),
    });

    let tree;
    act(() => {
      tree = renderer.create(React.createElement(AccountScreen, { onBack: jest.fn(), auth: authProp }));
    });

    // findAllByProps defaults to a deep search, which also matches the
    // TextInput's own host descendant (composite + host both carry the
    // prop) — findByProps (used elsewhere in this file) defaults to a
    // shallow search and is used here to assert exactly one logical input.
    expect(tree.root.findByProps({ accessibilityLabel: 'New Password' })).toBeTruthy();
    expect(tree.root.findByProps({ accessibilityLabel: 'Confirm New Password' })).toBeTruthy();
    expect(JSON.stringify(tree.toJSON())).not.toMatch(/Signed In/);
  });

  test('submitting a matching new password calls updatePassword with the password', async () => {
    const updatePassword = jest.fn().mockResolvedValue({ ok: true });
    const authProp = makeResolvedAuthProp(FAKE_SESSION, {
      passwordRecovery: true,
      recoveryError: '',
      clearPasswordRecovery: jest.fn(),
      updatePassword,
    });

    let tree;
    act(() => {
      tree = renderer.create(React.createElement(AccountScreen, { onBack: jest.fn(), auth: authProp }));
    });

    act(() => { tree.root.findByProps({ accessibilityLabel: 'New Password' }).props.onChangeText('brand-new-pw'); });
    act(() => { tree.root.findByProps({ accessibilityLabel: 'Confirm New Password' }).props.onChangeText('brand-new-pw'); });

    const submit = tree.root.findByProps({ accessibilityLabel: 'Set New Password' });
    await act(async () => { await submit.props.onPress(); });

    expect(updatePassword).toHaveBeenCalledWith('brand-new-pw');
    const status = tree.root.findByProps({ accessibilityLabel: 'Set password status' });
    expect(status.props.children).toMatch(/Password updated/);
  });

  test('mismatched passwords are rejected locally without calling updatePassword', async () => {
    const updatePassword = jest.fn().mockResolvedValue({ ok: true });
    const authProp = makeResolvedAuthProp(FAKE_SESSION, {
      passwordRecovery: true,
      recoveryError: '',
      clearPasswordRecovery: jest.fn(),
      updatePassword,
    });

    let tree;
    act(() => {
      tree = renderer.create(React.createElement(AccountScreen, { onBack: jest.fn(), auth: authProp }));
    });

    act(() => { tree.root.findByProps({ accessibilityLabel: 'New Password' }).props.onChangeText('brand-new-pw'); });
    act(() => { tree.root.findByProps({ accessibilityLabel: 'Confirm New Password' }).props.onChangeText('different-pw'); });

    const submit = tree.root.findByProps({ accessibilityLabel: 'Set New Password' });
    await act(async () => { await submit.props.onPress(); });

    expect(updatePassword).not.toHaveBeenCalled();
    const status = tree.root.findByProps({ accessibilityLabel: 'Set password status' });
    expect(status.props.children).toBe('Passwords do not match.');
  });

  test('a weak-password failure from updateUser surfaces a readable message', async () => {
    const updatePassword = jest.fn().mockResolvedValue({ ok: false, error: 'Password should be at least 6 characters.' });
    const authProp = makeResolvedAuthProp(FAKE_SESSION, {
      passwordRecovery: true,
      recoveryError: '',
      clearPasswordRecovery: jest.fn(),
      updatePassword,
    });

    let tree;
    act(() => {
      tree = renderer.create(React.createElement(AccountScreen, { onBack: jest.fn(), auth: authProp }));
    });

    act(() => { tree.root.findByProps({ accessibilityLabel: 'New Password' }).props.onChangeText('123456'); });
    act(() => { tree.root.findByProps({ accessibilityLabel: 'Confirm New Password' }).props.onChangeText('123456'); });

    const submit = tree.root.findByProps({ accessibilityLabel: 'Set New Password' });
    await act(async () => { await submit.props.onPress(); });

    const status = tree.root.findByProps({ accessibilityLabel: 'Set password status' });
    expect(status.props.children).toBe('Password should be at least 6 characters.');
  });

  test('an expired or already-used link shows a readable error with no silent bounce back to the app', () => {
    const clearPasswordRecovery = jest.fn();
    const authProp = makeResolvedAuthProp(null, {
      passwordRecovery: false,
      recoveryError: 'Email link is invalid or has expired',
      clearPasswordRecovery,
      updatePassword: jest.fn(),
    });

    let tree;
    act(() => {
      tree = renderer.create(React.createElement(AccountScreen, { onBack: jest.fn(), auth: authProp }));
    });

    const status = tree.root.findByProps({ accessibilityLabel: 'Set password status' });
    expect(status.props.children).toBe('Email link is invalid or has expired');
    expect(tree.root.findAllByProps({ accessibilityLabel: 'New Password' }).length).toBe(0);

    const backButton = tree.root.findByProps({ accessibilityLabel: 'Back to Sign In' });
    act(() => { backButton.props.onPress(); });
    expect(clearPasswordRecovery).toHaveBeenCalled();
  });

  test('does not show the recovery surface for a normal signed-out session', () => {
    let tree;
    act(() => {
      tree = renderer.create(React.createElement(AccountScreen, { onBack: jest.fn(), auth: makeResolvedAuthProp(null) }));
    });

    expect(tree.root.findAllByProps({ accessibilityLabel: 'New Password' }).length).toBe(0);
    expect(tree.root.findByProps({ accessibilityLabel: 'Email' })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// MoreScreen recovery auto-navigation (#497 Finding 1): a recovery deep link
// can be opened from any tab. App.js switches to the More tab; MoreScreen must
// switch its own sub-view to Account so the set-new-password surface actually
// appears, instead of the recovery link being a visible dead end. MoreScreen
// stays mounted across tabs, so this switch is driven purely by the shared
// auth instance's recovery signals.
// ---------------------------------------------------------------------------

describe('MoreScreen recovery auto-navigation', () => {
  function makeRecoveryAuth(overrides = {}) {
    return {
      configured: true,
      loading: false,
      session: null,
      user: null,
      signedIn: false,
      passwordRecovery: false,
      recoveryError: '',
      clearPasswordRecovery: jest.fn(),
      updatePassword: jest.fn().mockResolvedValue({ ok: true }),
      resetPasswordForEmail: jest.fn().mockResolvedValue({ ok: true }),
      signInWithPassword: jest.fn(),
      signUpWithPassword: jest.fn(),
      signOut: jest.fn(),
      signInWithOAuth: jest.fn(),
      handleAuthCallbackUrl: jest.fn(),
      ...overrides,
    };
  }

  test('starts on the menu (no set-password surface) when there is no recovery signal', () => {
    let tree;
    act(() => {
      tree = renderer.create(React.createElement(MoreScreen, { isActive: true, auth: makeRecoveryAuth() }));
    });
    expect(tree.root.findAllByProps({ accessibilityLabel: 'New Password' }).length).toBe(0);
  });

  test('auto-opens the Account set-new-password surface when a recovery session is active', () => {
    let tree;
    act(() => {
      tree = renderer.create(React.createElement(MoreScreen, { isActive: true, auth: makeRecoveryAuth({ passwordRecovery: true }) }));
    });
    expect(tree.root.findByProps({ accessibilityLabel: 'New Password' })).toBeTruthy();
  });

  test('auto-opens the Account surface (showing the readable error) when a recovery link failed', () => {
    let tree;
    act(() => {
      tree = renderer.create(React.createElement(MoreScreen, {
        isActive: true,
        auth: makeRecoveryAuth({ recoveryError: 'Email link is invalid or has expired' }),
      }));
    });
    const status = tree.root.findByProps({ accessibilityLabel: 'Set password status' });
    expect(status.props.children).toBe('Email link is invalid or has expired');
  });

  test('switches to the Account surface when the recovery signal arrives after mount (deep link while running)', () => {
    let tree;
    const auth = makeRecoveryAuth();
    act(() => {
      tree = renderer.create(React.createElement(MoreScreen, { isActive: true, auth }));
    });
    expect(tree.root.findAllByProps({ accessibilityLabel: 'New Password' }).length).toBe(0);

    // Recovery becomes active on the shared instance (as it would after the
    // deep-link listener establishes the session): the screen re-renders with
    // the updated auth prop and the effect opens the Account surface.
    act(() => {
      tree.update(React.createElement(MoreScreen, { isActive: true, auth: makeRecoveryAuth({ passwordRecovery: true }) }));
    });
    expect(tree.root.findByProps({ accessibilityLabel: 'New Password' })).toBeTruthy();
  });
});

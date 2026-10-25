import React from 'react';
import renderer, { act } from 'react-test-renderer';

// #1640: the web `?code=` is exchanged by the hook (detectSessionInUrl is off),
// after it subscribes. Success/failure comes from the exchange result, never
// from whichever session happens to be stored.
let mockAuth;
let mockPlatform = 'web';
jest.mock('../storage/secureStorage', () => ({ wipeSensitiveDeviceData: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@supabase/supabase-js', () => ({ createClient: (url, key, opts) => { mockOpts = opts; return { auth: mockAuth }; } }));
jest.mock('react-native/Libraries/Utilities/Platform', () => {
  const platform = { get OS() { return mockPlatform; }, select: (o) => o[mockPlatform] ?? o.default };
  return { __esModule: true, default: platform, ...platform };
});
let mockOpts;

process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

const { useAuthSession, RECOVERY_PENDING_KEY } = require('../hooks/useAuthSession');
const { resetSupabaseClientForTests } = require('../lib/supabaseClient');
const { resetWebCallbackExchangeForTests } = require('../lib/webAuthCodeExchange');

const oldSession = { access_token: 'old', user: { email: 'old@b.com' } };
const newSession = { access_token: 'new', user: { email: 'new@b.com' } };

function installWindow({ search = '', seed = {} } = {}) {
  const store = new Map(Object.entries(seed));
  const replaceState = jest.fn();
  global.window = {
    location: { search, href: `https://app.example/${search}` },
    history: { state: null, replaceState },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    },
  };
  return { store, replaceState };
}

// `exchange` runs inside exchangeCodeForSession so tests can emit
// PASSWORD_RECOVERY the way auth-js does on a recovery exchange.
async function mountHook({ stored = null, exchange } = {}) {
  let cb = null;
  mockAuth = {
    getSession: jest.fn().mockResolvedValue({ data: { session: stored }, error: null }),
    onAuthStateChange: jest.fn((fn) => { cb = fn; return { data: { subscription: { unsubscribe: jest.fn() } } }; }),
    exchangeCodeForSession: jest.fn(async (code) => exchange(code, (e, s) => cb && cb(e, s))),
    signInWithOAuth: jest.fn().mockResolvedValue({ data: { url: 'https://oauth' }, error: null }),
  };
  resetSupabaseClientForTests();
  resetWebCallbackExchangeForTests();
  const ref = { current: null };
  function Probe() { ref.current = useAuthSession(); return null; }
  await act(async () => { renderer.create(React.createElement(Probe)); });
  await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); });
  return ref;
}

const recoveryExchange = async (code, emit) => { emit('PASSWORD_RECOVERY', newSession); return { data: { session: newSession }, error: null }; };
const rejectedExchange = async () => ({ data: { session: null }, error: { message: 'invalid grant' } });

afterEach(() => { delete global.window; mockPlatform = 'web'; });

describe('web callback code exchange', () => {
  test('supabase-js no longer consumes the URL itself', () => {
    installWindow();
    resetSupabaseClientForTests();
    require('../lib/supabaseClient').getSupabaseClient();
    expect(mockOpts.auth.detectSessionInUrl).toBe(false);
  });

  test('a reset link opens set-new-password via PASSWORD_RECOVERY, and the code leaves the URL', async () => {
    const { store, replaceState } = installWindow({ search: '?code=abc', seed: { [RECOVERY_PENDING_KEY]: String(Date.now()) } });
    const ref = await mountHook({ stored: newSession, exchange: recoveryExchange });
    expect(mockAuth.exchangeCodeForSession).toHaveBeenCalledWith('abc');
    expect(ref.current.passwordRecovery).toBe(true);
    expect(ref.current.recoveryError).toBe('');
    expect(store.has(RECOVERY_PENDING_KEY)).toBe(false);
    expect(replaceState).toHaveBeenCalled();
    expect(replaceState.mock.calls[0][2]).not.toMatch(/code=/);
  });

  test('already signed in: the recovery exchange still replaces the session and opens the step', async () => {
    installWindow({ search: '?code=abc' });
    const ref = await mountHook({ stored: newSession, exchange: recoveryExchange });
    expect(ref.current.signedIn).toBe(true);
    expect(ref.current.passwordRecovery).toBe(true);
  });

  test('a rejected/replayed code with ANY retained session (even a recovery-minted one) is a failed link', async () => {
    const { store } = installWindow({ search: '?code=abc', seed: { [RECOVERY_PENDING_KEY]: String(Date.now()) } });
    const ref = await mountHook({ stored: oldSession, exchange: rejectedExchange });
    expect(ref.current.passwordRecovery).toBe(false);
    expect(ref.current.recoveryError).toMatch(/invalid, expired or already used/);
    expect(ref.current.signedIn).toBe(true);
    expect(store.has(RECOVERY_PENDING_KEY)).toBe(false);
  });

  test('a thrown exchange is a failure too', async () => {
    installWindow({ search: '?code=abc', seed: { [RECOVERY_PENDING_KEY]: String(Date.now()) } });
    const ref = await mountHook({ exchange: async () => { throw new Error('network'); } });
    expect(ref.current.recoveryError).toMatch(/Request a new reset email/);
  });

  test('an OAuth return (no pending reset) signs in and is not a recovery failure or recovery', async () => {
    installWindow({ search: '?code=abc' });
    const ref = await mountHook({ stored: newSession, exchange: async () => ({ data: { session: newSession }, error: null }) });
    expect(ref.current.passwordRecovery).toBe(false);
    expect(ref.current.recoveryError).toBe('');
  });

  test('a failed OAuth return with no pending reset stays silent on the recovery surface', async () => {
    installWindow({ search: '?code=abc' });
    const ref = await mountHook({ exchange: rejectedExchange });
    expect(ref.current.recoveryError).toBe('');
  });

  test('a normal page load never exchanges or enters recovery', async () => {
    installWindow({ search: '' });
    const ref = await mountHook({ stored: newSession, exchange: recoveryExchange });
    expect(mockAuth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(ref.current.passwordRecovery).toBe(false);
  });

  test('a remount reuses the one exchange instead of replaying the consumed code', async () => {
    installWindow({ search: '?code=abc' });
    await mountHook({ exchange: recoveryExchange });
    const first = mockAuth.exchangeCodeForSession.mock.calls.length;
    const ref = { current: null };
    function Probe() { ref.current = useAuthSession(); return null; }
    await act(async () => { renderer.create(React.createElement(Probe)); });
    expect(mockAuth.exchangeCodeForSession.mock.calls.length).toBe(first);
  });

  test('starting GitHub sign-in drops a pending reset flag so its return is not misfiled', async () => {
    const { store } = installWindow({ seed: { [RECOVERY_PENDING_KEY]: String(Date.now()) } });
    const ref = await mountHook({ exchange: recoveryExchange });
    await act(async () => { await ref.current.signInWithOAuth('github'); });
    expect(store.has(RECOVERY_PENDING_KEY)).toBe(false);
  });

  test('native never touches the web exchange', async () => {
    mockPlatform = 'ios';
    installWindow({ search: '?code=abc' });
    await mountHook({ exchange: recoveryExchange });
    expect(mockAuth.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});

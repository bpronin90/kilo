import React from 'react';
import renderer, { act } from 'react-test-renderer';

// #1640: a web reset link's `?code=` is exchanged by supabase-js during client
// init, before the hook subscribes, so PASSWORD_RECOVERY is never seen. These
// pin the classification the hook derives from the restored session instead.
let mockAuth;
jest.mock('../storage/secureStorage', () => ({ wipeSensitiveDeviceData: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: mockAuth }) }));

process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

const { useAuthSession, RECOVERY_PENDING_KEY } = require('../hooks/useAuthSession');
const { resetSupabaseClientForTests } = require('../lib/supabaseClient');
const { isRecoverySession, callbackUrlHasCode, peekRecoveryPending } = require('../lib/authRecoveryLink');

function jwt(claims) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'HS256' })}.${b64(claims)}.sig`;
}
const recoverySession = { access_token: jwt({ amr: [{ method: 'recovery', timestamp: 1 }] }), user: { email: 'a@b.com' } };
const passwordSession = { access_token: jwt({ amr: [{ method: 'password', timestamp: 1 }] }), user: { email: 'old@b.com' } };

function installWindow({ search = '', seed = {} } = {}) {
  const store = new Map(Object.entries(seed));
  global.window = {
    location: { search, href: `https://app.example/${search}` },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    },
  };
  return store;
}

async function mountHook(session) {
  mockAuth = {
    getSession: jest.fn().mockResolvedValue({ data: { session }, error: null }),
    onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
    signInWithOAuth: jest.fn().mockResolvedValue({ data: { url: 'https://oauth' }, error: null }),
  };
  resetSupabaseClientForTests();
  const ref = { current: null };
  function Probe() { ref.current = useAuthSession(); return null; }
  await act(async () => { renderer.create(React.createElement(Probe)); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return ref;
}

afterEach(() => { delete global.window; });

describe('recovery link classification (web)', () => {
  test('isRecoverySession reads the amr claim and tolerates junk', () => {
    expect(isRecoverySession(recoverySession)).toBe(true);
    expect(isRecoverySession(passwordSession)).toBe(false);
    expect(isRecoverySession({ access_token: 'not-a-jwt' })).toBe(false);
    expect(isRecoverySession(null)).toBe(false);
  });

  test('a ?code= that restores a recovery session opens set-new-password, with or without a pending flag', async () => {
    const store = installWindow({ search: '?code=abc' });
    const ref = await mountHook(recoverySession);
    expect(ref.current.passwordRecovery).toBe(true);
    expect(ref.current.recoveryError).toBe('');
    expect(store.has(RECOVERY_PENDING_KEY)).toBe(false);
  });

  test('an already signed-in user who follows a reset link still gets the recovery step', async () => {
    installWindow({ search: '?code=abc', seed: { [RECOVERY_PENDING_KEY]: String(Date.now()) } });
    const ref = await mountHook(recoverySession);
    expect(ref.current.signedIn).toBe(true);
    expect(ref.current.passwordRecovery).toBe(true);
  });

  test('a failed link leaves an unrelated session in place but reports the failure', async () => {
    const store = installWindow({ search: '?code=abc', seed: { [RECOVERY_PENDING_KEY]: String(Date.now()) } });
    const ref = await mountHook(passwordSession);
    expect(ref.current.passwordRecovery).toBe(false);
    expect(ref.current.recoveryError).toMatch(/invalid, expired or already used/);
    expect(store.has(RECOVERY_PENDING_KEY)).toBe(false);
  });

  test('a code with no session and a pending reset reports the failure (replayed link)', async () => {
    installWindow({ search: '?code=abc', seed: { [RECOVERY_PENDING_KEY]: String(Date.now()) } });
    const ref = await mountHook(null);
    expect(ref.current.recoveryError).toMatch(/Request a new reset email/);
  });

  test('a normal page load (no code) never enters recovery, even on a recovery-minted session', async () => {
    installWindow({ search: '' });
    const ref = await mountHook(recoverySession);
    expect(ref.current.passwordRecovery).toBe(false);
    expect(ref.current.recoveryError).toBe('');
  });

  test('an OAuth return (code, non-recovery session) is not a recovery failure', async () => {
    installWindow({ search: '?code=abc' });
    const ref = await mountHook(passwordSession);
    expect(ref.current.passwordRecovery).toBe(false);
    expect(ref.current.recoveryError).toBe('');
  });

  test('starting GitHub sign-in drops a pending reset flag so its return is not misfiled', async () => {
    const store = installWindow({ seed: { [RECOVERY_PENDING_KEY]: String(Date.now()) } });
    const ref = await mountHook(null);
    expect(peekRecoveryPending()).toBe(true);
    await act(async () => { await ref.current.signInWithOAuth('github'); });
    expect(store.has(RECOVERY_PENDING_KEY)).toBe(false);
    expect(callbackUrlHasCode()).toBe(false);
  });
});

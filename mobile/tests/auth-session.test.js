import React from 'react';
import renderer, { act } from 'react-test-renderer';

// --- Supabase client mock -------------------------------------------------
// A controllable fake of the supabase-js auth surface so we can assert the hook
// wires sign in / out / restore / reset / OAuth callback without a network.
let mockAuth;
let mockCreateClientCalls;

jest.mock('@supabase/supabase-js', () => ({
  createClient: (url, key, opts) => {
    mockCreateClientCalls.push({ url, key, opts });
    return { auth: mockAuth };
  },
}));

// Configure env before requiring the modules under test.
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

const { useAuthSession } = require('../hooks/useAuthSession');
const {
  getSupabaseClient,
  resetSupabaseClientForTests,
  makeSecureStoreAdapter,
  resolveAuthStorage,
  hasSupabaseConfig,
} = require('../lib/supabaseClient');

function makeMockAuth(overrides = {}) {
  let authStateCb = null;
  return {
    getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
    onAuthStateChange: jest.fn((cb) => {
      authStateCb = cb;
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    }),
    signInWithPassword: jest.fn().mockResolvedValue({ data: { session: { user: { email: 'a@b.com' } } }, error: null }),
    signUp: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
    signOut: jest.fn().mockResolvedValue({ error: null }),
    resetPasswordForEmail: jest.fn().mockResolvedValue({ error: null }),
    signInWithOAuth: jest.fn().mockResolvedValue({ data: { url: 'https://oauth' }, error: null }),
    exchangeCodeForSession: jest.fn().mockResolvedValue({ data: { session: { user: { email: 'oauth@b.com' } } }, error: null }),
    _emit: (event, session) => authStateCb && authStateCb(event, session),
    ...overrides,
  };
}

// Render the hook and capture its latest return value.
function renderAuthHook() {
  const ref = { current: null };
  function Probe() {
    ref.current = useAuthSession();
    return null;
  }
  let tree;
  act(() => {
    tree = renderer.create(React.createElement(Probe));
  });
  return { ref, tree };
}

async function flush() {
  // Allow queued promises (getSession etc.) to resolve inside act.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  mockCreateClientCalls = [];
  mockAuth = makeMockAuth();
  resetSupabaseClientForTests();
});

describe('supabaseClient', () => {
  test('config presence is detected and client is cached', () => {
    expect(hasSupabaseConfig()).toBe(true);
    const a = getSupabaseClient();
    const b = getSupabaseClient();
    expect(a).toBe(b);
    expect(mockCreateClientCalls.length).toBe(1);
    // Web build path: detectSessionInUrl enabled (Platform defaults to ios in
    // jest-expo, so this asserts the native default instead).
    expect(mockCreateClientCalls[0].opts.auth.persistSession).toBe(true);
    expect(mockCreateClientCalls[0].opts.auth.autoRefreshToken).toBe(true);
    expect(mockCreateClientCalls[0].opts.auth.flowType).toBe('pkce');
  });

  test('web resolves to built-in storage (null), native to secure adapter', () => {
    expect(resolveAuthStorage('web')).toBe(null);
    // Native path returns an adapter when secure store is available; in the
    // jest-expo environment expo-secure-store is mocked below per test, so here
    // we exercise the adapter factory directly.
    expect(resolveAuthStorage('ios')).not.toBe(undefined);
  });
});

describe('secure store adapter', () => {
  function makeFakeSecureStore() {
    const store = new Map();
    return {
      store,
      getItemAsync: jest.fn((k) => Promise.resolve(store.has(k) ? store.get(k) : null)),
      setItemAsync: jest.fn((k, v) => { store.set(k, v); return Promise.resolve(); }),
      deleteItemAsync: jest.fn((k) => { store.delete(k); return Promise.resolve(); }),
    };
  }

  test('round-trips a small value as a single key', async () => {
    const fake = makeFakeSecureStore();
    const adapter = makeSecureStoreAdapter(fake);
    await adapter.setItem('k', 'hello');
    expect(fake.store.get('k')).toBe('hello');
    expect(await adapter.getItem('k')).toBe('hello');
    await adapter.removeItem('k');
    expect(await adapter.getItem('k')).toBe(null);
  });

  test('chunks large token material and reassembles it', async () => {
    const fake = makeFakeSecureStore();
    const adapter = makeSecureStoreAdapter(fake);
    const big = 'x'.repeat(5000); // exceeds 2000-byte chunk size
    await adapter.setItem('session', big);
    // No single plain value holds the whole token; it is split into chunks.
    expect(fake.store.has('session')).toBe(false);
    expect(fake.store.get('session.chunks')).toBe('3');
    expect(await adapter.getItem('session')).toBe(big);
    await adapter.removeItem('session');
    expect(await adapter.getItem('session')).toBe(null);
    expect(fake.store.has('session.chunks')).toBe(false);
  });

  test('returns null adapter when secure store is unavailable', () => {
    expect(makeSecureStoreAdapter(null)).toBe(null);
    expect(makeSecureStoreAdapter({})).toBe(null);
  });

  test('overwriting with fewer chunks purges the orphaned tail chunks', async () => {
    const fake = makeFakeSecureStore();
    const adapter = makeSecureStoreAdapter(fake);
    const big = 'x'.repeat(5000); // 3 chunks
    await adapter.setItem('session', big);
    expect(fake.store.get('session.chunks')).toBe('3');
    expect(fake.store.has('session.chunk.2')).toBe(true);

    const smaller = 'y'.repeat(2500); // 2 chunks
    await adapter.setItem('session', smaller);
    expect(fake.store.get('session.chunks')).toBe('2');
    // Chunks M..N-1 (here just chunk 2) from the previous larger value must
    // no longer be readable.
    expect(fake.store.has('session.chunk.2')).toBe(false);
    expect(await adapter.getItem('session')).toBe(smaller);
  });

  test('overwriting a chunked value with a sub-chunk-size value leaves no chunks', async () => {
    const fake = makeFakeSecureStore();
    const adapter = makeSecureStoreAdapter(fake);
    const big = 'x'.repeat(5000); // 3 chunks
    await adapter.setItem('session', big);
    expect(fake.store.get('session.chunks')).toBe('3');

    const small = 'small-value';
    await adapter.setItem('session', small);
    expect(fake.store.has('session.chunk.0')).toBe(false);
    expect(fake.store.has('session.chunk.1')).toBe(false);
    expect(fake.store.has('session.chunk.2')).toBe(false);
    expect(fake.store.has('session.chunks')).toBe(false);
    expect(await adapter.getItem('session')).toBe(small);
  });

  test('removeItem after a chunked write leaves the fake store empty', async () => {
    const fake = makeFakeSecureStore();
    const adapter = makeSecureStoreAdapter(fake);
    const big = 'x'.repeat(5000); // 3 chunks
    await adapter.setItem('session', big);
    await adapter.removeItem('session');
    expect(fake.store.size).toBe(0);
  });

  test('removeItem purges chunks when the count key is absent (legacy single value present)', async () => {
    const fake = makeFakeSecureStore();
    const adapter = makeSecureStoreAdapter(fake);
    // Legacy pre-HWM state: a small-value write left a single value behind
    // while chunks from an earlier larger value linger with no count key.
    fake.store.set('session', 'stale-single');
    fake.store.set('session.chunk.0', 'stale-a');
    fake.store.set('session.chunk.1', 'stale-b');
    await adapter.removeItem('session');
    expect(fake.store.size).toBe(0);
  });

  test('removeItem purges chunks when the count key is malformed', async () => {
    const fake = makeFakeSecureStore();
    const adapter = makeSecureStoreAdapter(fake);
    fake.store.set('session.chunks', 'not-a-number');
    fake.store.set('session.chunk.0', 'stale-a');
    fake.store.set('session.chunk.1', 'stale-b');
    fake.store.set('session.chunk.2', 'stale-c');
    await adapter.removeItem('session');
    expect(fake.store.size).toBe(0);
  });

  test('removeItem purges chunks beyond an understated count', async () => {
    const fake = makeFakeSecureStore();
    const adapter = makeSecureStoreAdapter(fake);
    fake.store.set('session.chunks', '1'); // understates the 3 chunks below
    fake.store.set('session.chunk.0', 'stale-a');
    fake.store.set('session.chunk.1', 'stale-b');
    fake.store.set('session.chunk.2', 'stale-c');
    await adapter.removeItem('session');
    expect(fake.store.size).toBe(0);
  });

  test('overwrite with a small value purges chunks despite absent/malformed/understated counts', async () => {
    for (const countState of [undefined, 'not-a-number', '1']) {
      const fake = makeFakeSecureStore();
      const adapter = makeSecureStoreAdapter(fake);
      // With no count key, a legacy state is marked by a stale single value
      // (a completely metadata-free key is treated as fresh and not swept).
      if (countState === undefined) fake.store.set('session', 'stale-single');
      else fake.store.set('session.chunks', countState);
      fake.store.set('session.chunk.0', 'stale-a');
      fake.store.set('session.chunk.1', 'stale-b');
      fake.store.set('session.chunk.2', 'stale-c');
      // eslint-disable-next-line no-await-in-loop
      await adapter.setItem('session', 'small-value');
      // Only the single value and its zeroed high-water mark remain; every
      // stale chunk is gone.
      expect([...fake.store.keys()].sort()).toEqual(['session', 'session.chunks.hwm']);
      expect(fake.store.get('session.chunks.hwm')).toBe('0');
      // eslint-disable-next-line no-await-in-loop
      expect(await adapter.getItem('session')).toBe('small-value');
    }
  });

  test('overwrite with a chunked value purges stale tail chunks despite absent/malformed/understated counts', async () => {
    for (const countState of [undefined, 'not-a-number', '1']) {
      const fake = makeFakeSecureStore();
      const adapter = makeSecureStoreAdapter(fake);
      // With no count key, a legacy state is marked by a stale single value
      // (a completely metadata-free key is treated as fresh and not swept).
      if (countState === undefined) fake.store.set('session', 'stale-single');
      else fake.store.set('session.chunks', countState);
      for (let i = 0; i < 5; i += 1) fake.store.set(`session.chunk.${i}`, `stale-${i}`);
      const value = 'y'.repeat(2500); // 2 chunks
      // eslint-disable-next-line no-await-in-loop
      await adapter.setItem('session', value);
      expect([...fake.store.keys()].sort()).toEqual([
        'session.chunk.0',
        'session.chunk.1',
        'session.chunks',
        'session.chunks.hwm',
      ]);
      expect(fake.store.get('session.chunks.hwm')).toBe('2');
      // eslint-disable-next-line no-await-in-loop
      expect(await adapter.getItem('session')).toBe(value);
    }
  });

  // Regression for review round 2: a gap of three or more consecutive missing
  // indices (the shape left by an interrupted sequential removal that deleted
  // chunks 0..2 before dying) must not stop cleanup before surviving chunks
  // at higher indices.

  test('removeItem purges a surviving chunk behind a 3+ index gap', async () => {
    const fake = makeFakeSecureStore();
    const adapter = makeSecureStoreAdapter(fake);
    // Legacy interrupted removal: the pre-HWM adapter deleted chunks 0-2 of a
    // 5-chunk value and died before removing the count key; chunks 3-4 and
    // the count survive.
    fake.store.set('session.chunks', '5');
    fake.store.set('session.chunk.3', 'stale-d');
    fake.store.set('session.chunk.4', 'stale-e');
    await adapter.removeItem('session');
    expect(fake.store.size).toBe(0);
  });

  test('removeItem purges a chunk behind a gap even with a stale HWM from before the interruption', async () => {
    const fake = makeFakeSecureStore();
    const adapter = makeSecureStoreAdapter(fake);
    // Interrupted removal of a 5-chunk value: HWM still present (it is only
    // dropped after all chunk deletions), chunks 0-2 gone, 3-4 survive.
    fake.store.set('session.chunks.hwm', '5');
    fake.store.set('session.chunk.3', 'stale-d');
    fake.store.set('session.chunk.4', 'stale-e');
    await adapter.removeItem('session');
    expect(fake.store.size).toBe(0);
  });

  test('small-value overwrite purges a surviving chunk behind a 3+ index gap', async () => {
    const fake = makeFakeSecureStore();
    const adapter = makeSecureStoreAdapter(fake);
    // Legacy state: a stale single value marks prior use; chunks 0-2 are gone
    // (interrupted cleanup) but 3-4 survive.
    fake.store.set('session', 'stale-single');
    fake.store.set('session.chunk.3', 'stale-d');
    fake.store.set('session.chunk.4', 'stale-e');
    await adapter.setItem('session', 'small-value');
    expect([...fake.store.keys()].sort()).toEqual(['session', 'session.chunks.hwm']);
    expect(await adapter.getItem('session')).toBe('small-value');
  });

  test('chunked overwrite purges a surviving chunk behind a 3+ index gap after the new count', async () => {
    const fake = makeFakeSecureStore();
    const adapter = makeSecureStoreAdapter(fake);
    // HWM from an interrupted earlier op still records 6; new value needs 2
    // chunks; indices 2-4 are missing, chunk 5 survives behind the gap.
    fake.store.set('session.chunks.hwm', '6');
    fake.store.set('session.chunk.5', 'stale-f');
    const value = 'y'.repeat(2500); // 2 chunks
    await adapter.setItem('session', value);
    expect([...fake.store.keys()].sort()).toEqual([
      'session.chunk.0',
      'session.chunk.1',
      'session.chunks',
      'session.chunks.hwm',
    ]);
    expect(fake.store.get('session.chunks.hwm')).toBe('2');
    expect(await adapter.getItem('session')).toBe(value);
  });

  // Round 3: the legacy fallback sweep is bounded and must not tax
  // fresh/routine writes.

  test('legacy fallback sweep boundary: index 63 is purged, index 64 is the accepted out-of-bound limitation', async () => {
    const fake = makeFakeSecureStore();
    const adapter = makeSecureStoreAdapter(fake);
    // Genuine legacy state: count key present, no HWM.
    fake.store.set('session.chunks', '1');
    fake.store.set('session.chunk.0', 'stale-a');
    fake.store.set('session.chunk.63', 'stale-last-in-bound');
    fake.store.set('session.chunk.64', 'stale-out-of-bound');
    await adapter.removeItem('session');
    // Everything inside the 64-chunk legacy bound is gone.
    expect(fake.store.has('session.chunk.0')).toBe(false);
    expect(fake.store.has('session.chunk.63')).toBe(false);
    expect(fake.store.has('session.chunks')).toBe(false);
    expect(fake.store.has('session.chunks.hwm')).toBe(false);
    // Accepted limitation: index 64 is the first index beyond the legacy
    // sweep bound; only a non-adapter writer could have created it, and it
    // is intentionally not swept.
    expect(fake.store.get('session.chunk.64')).toBe('stale-out-of-bound');
    expect(fake.store.size).toBe(1);
  });

  test('first-ever write pays no legacy sweep (bounded deletion count)', async () => {
    // Fresh small write: the only deletion is the count-key clear.
    const fakeSmall = makeFakeSecureStore();
    const small = makeSecureStoreAdapter(fakeSmall);
    await small.setItem('session', 'small-value');
    expect(fakeSmall.deleteItemAsync.mock.calls.map((c) => c[0])).toEqual(['session.chunks']);

    // Fresh chunked write: the only deletion is the stale single-value clear.
    const fakeBig = makeFakeSecureStore();
    const big = makeSecureStoreAdapter(fakeBig);
    await big.setItem('session', 'x'.repeat(5000)); // 3 chunks
    expect(fakeBig.deleteItemAsync.mock.calls.map((c) => c[0])).toEqual(['session']);
  });

  test('routine overwrite deletes only what the HWM bounds', async () => {
    const fake = makeFakeSecureStore();
    const adapter = makeSecureStoreAdapter(fake);
    await adapter.setItem('session', 'x'.repeat(5000)); // 3 chunks, HWM 3
    fake.deleteItemAsync.mockClear();
    await adapter.setItem('session', 'y'.repeat(2500)); // 2 chunks
    // Exactly two deletions: the stale single-value clear and the one
    // HWM-bounded tail chunk (index 2). No legacy sweep.
    expect(fake.deleteItemAsync.mock.calls.map((c) => c[0]).sort()).toEqual([
      'session',
      'session.chunk.2',
    ]);
    expect(await adapter.getItem('session')).toBe('y'.repeat(2500));
  });
});

describe('useAuthSession', () => {
  test('restores a persisted session on mount', async () => {
    mockAuth.getSession.mockResolvedValue({ data: { session: { user: { email: 'restored@b.com' } } }, error: null });
    const { ref } = renderAuthHook();
    await flush();
    expect(ref.current.signedIn).toBe(true);
    expect(ref.current.user.email).toBe('restored@b.com');
    expect(ref.current.loading).toBe(false);
  });

  test('starts signed out when no session is persisted', async () => {
    const { ref } = renderAuthHook();
    await flush();
    expect(ref.current.signedIn).toBe(false);
    expect(ref.current.user).toBe(null);
  });

  test('sign in returns ok and reflects auth state change', async () => {
    const { ref } = renderAuthHook();
    await flush();
    let result;
    await act(async () => { result = await ref.current.signInWithPassword('a@b.com', 'pw'); });
    expect(result.ok).toBe(true);
    expect(mockAuth.signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.com', password: 'pw' });
    // Auth state listener should update the session.
    await act(async () => { mockAuth._emit('SIGNED_IN', { user: { email: 'a@b.com' } }); });
    expect(ref.current.signedIn).toBe(true);
  });

  test('sign in surfaces errors', async () => {
    mockAuth.signInWithPassword.mockResolvedValue({ data: null, error: { message: 'bad creds' } });
    const { ref } = renderAuthHook();
    await flush();
    let result;
    await act(async () => { result = await ref.current.signInWithPassword('a@b.com', 'pw'); });
    expect(result).toEqual({ ok: false, error: 'bad creds' });
  });

  test('sign out clears the session', async () => {
    mockAuth.getSession.mockResolvedValue({ data: { session: { user: { email: 'x@b.com' } } }, error: null });
    const { ref } = renderAuthHook();
    await flush();
    expect(ref.current.signedIn).toBe(true);
    let result;
    await act(async () => { result = await ref.current.signOut(); });
    expect(result.ok).toBe(true);
    expect(mockAuth.signOut).toHaveBeenCalled();
    expect(ref.current.signedIn).toBe(false);
  });

  test('password reset path calls supabase', async () => {
    const { ref } = renderAuthHook();
    await flush();
    let result;
    await act(async () => { result = await ref.current.resetPasswordForEmail('a@b.com'); });
    expect(result.ok).toBe(true);
    expect(mockAuth.resetPasswordForEmail).toHaveBeenCalledWith('a@b.com', undefined);
  });

  test('OAuth callback exchanges a code for a session', async () => {
    const { ref } = renderAuthHook();
    await flush();
    let result;
    await act(async () => { result = await ref.current.handleAuthCallbackUrl('https://app/?code=abc123'); });
    expect(result.ok).toBe(true);
    expect(mockAuth.exchangeCodeForSession).toHaveBeenCalledWith('abc123');
    expect(ref.current.user.email).toBe('oauth@b.com');
  });

  test('OAuth callback without a code falls back to getSession', async () => {
    mockAuth.getSession.mockResolvedValue({ data: { session: { user: { email: 'hash@b.com' } } }, error: null });
    const { ref } = renderAuthHook();
    await flush();
    let result;
    await act(async () => { result = await ref.current.handleAuthCallbackUrl('https://app/#access_token=tok'); });
    expect(result.ok).toBe(true);
    expect(mockAuth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  test('callback with error param surfaces error without calling exchange or getSession', async () => {
    const { ref } = renderAuthHook();
    await flush();
    const callsBefore = mockAuth.getSession.mock.calls.length;
    let result;
    await act(async () => {
      result = await ref.current.handleAuthCallbackUrl(
        'https://app/?error=access_denied&error_description=User+cancelled+login',
      );
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('User cancelled login');
    expect(mockAuth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(mockAuth.getSession.mock.calls.length).toBe(callsBefore);
  });

  test('callback without code returns error when session is not established', async () => {
    // getSession remains null — sign-in did not complete (e.g. empty callback URL)
    const { ref } = renderAuthHook();
    await flush();
    let result;
    await act(async () => { result = await ref.current.handleAuthCallbackUrl('https://app/'); });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/did not complete/i);
    expect(mockAuth.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});

// Android Restore Credentials client integration tests (issue #1159).
// Covers enrollment after interactive sign-in, restore flow, sign-out revocation,
// and account-delete device-clear via useAuthSession.

import React from 'react';
import renderer, { act } from 'react-test-renderer';

// The moduleNameMapper maps AndroidRestoreCredentialsModule$ to this mock, so
// every import of 'android-restore-credentials' uses the controlled fake.
const nativeMock = require('./mocks/androidRestoreCredentials');

let mockFetch;
global.fetch = (...args) => mockFetch(...args);

let mockAuth;
let mockSetSession;

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: mockAuth }),
}));

jest.mock('../storage/secureStorage', () => ({
  wipeSensitiveDeviceData: jest.fn().mockResolvedValue(undefined),
}));

process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

const { Platform } = require('react-native');

const NEUTRAL_RETRY_ERROR = 'Could not complete sign-out. Please try again.';

const SUPABASE_URL = 'https://example.supabase.co';
const FAKE_SESSION = { access_token: 'tok-abc', refresh_token: 'ref-abc', user: { id: 'uid-1' } };

const ENROLLMENT_OPTIONS_BODY = {
  version: 1,
  operation: 'registration',
  challenge: 'chall-base64',
  rp: { id: 'kilo.app', name: 'Kilo' },
  user: { id: 'u-handle', name: 'Kilo account', displayName: 'Kilo account' },
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
  timeout: 30000,
  excludeCredentials: [],
};

const REGISTRATION_RESPONSE_JSON = JSON.stringify({
  version: 1,
  credential: {
    type: 'public-key',
    id: 'cred-id-123',
    rawId: 'cred-id-123',
    response: { clientDataJSON: 'Y2xpZW50', attestationObject: 'YXR0ZXN0' },
    clientExtensionResults: {},
  },
});

const RESTORE_OPTIONS_BODY = {
  version: 1,
  operation: 'assertion',
  challenge: 'restore-chall-base64',
  rpId: 'kilo.app',
  timeout: 30000,
  allowCredentials: [{ type: 'public-key', id: 'cred-id-123' }],
};

const ASSERTION_CREDENTIAL_JSON = JSON.stringify({
  version: 1,
  credential: {
    type: 'public-key',
    id: 'cred-id-123',
    rawId: 'cred-id-123',
    response: {
      clientDataJSON: 'Y2xpZW50UmVzdG9yZQ==',
      authenticatorData: 'YXV0aERhdGE=',
      signature: 'c2ln',
    },
    clientExtensionResults: {},
  },
});

function fakeRes(body, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
}

function makeMockAuth(session = FAKE_SESSION) {
  mockSetSession = jest.fn().mockResolvedValue({ error: null });
  let authStateCb = null;
  const mock = {
    getSession: jest.fn().mockResolvedValue({ data: { session }, error: null }),
    onAuthStateChange: jest.fn((cb) => {
      authStateCb = cb;
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    }),
    signInWithPassword: jest.fn().mockResolvedValue({ data: { session }, error: null }),
    signOut: jest.fn().mockResolvedValue({ error: null }),
    signUp: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
    resend: jest.fn().mockResolvedValue({ data: {}, error: null }),
    resetPasswordForEmail: jest.fn().mockResolvedValue({ error: null }),
    signInWithOAuth: jest.fn().mockResolvedValue({ data: { url: null }, error: null }),
    exchangeCodeForSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
    updateUser: jest.fn().mockResolvedValue({ data: { user: null }, error: null }),
    setSession: (...args) => mockSetSession(...args),
    _emit: (event, s) => authStateCb && authStateCb(event, s),
  };
  return mock;
}

function renderAuthHook() {
  const ref = { current: null };
  function Probe() {
    // eslint-disable-next-line global-require
    const { useAuthSession } = require('../hooks/useAuthSession');
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
    await Promise.resolve();
  });
}

beforeEach(() => {
  Platform.OS = 'android';
  nativeMock.__reset();
  mockAuth = makeMockAuth();
  mockFetch = jest.fn().mockResolvedValue(fakeRes({ ok: true }));
  const AS = require('@react-native-async-storage/async-storage');
  AS.clear();
  // eslint-disable-next-line global-require
  const { resetSupabaseClientForTests } = require('../lib/supabaseClient');
  resetSupabaseClientForTests();
});

afterEach(() => {
  Platform.OS = 'ios';
});

// ---------------------------------------------------------------------------
// Enrollment after interactive sign-in
// ---------------------------------------------------------------------------

describe('enrollment after signInWithPassword', () => {
  test('successful enrollment stores credential id', async () => {
    nativeMock.__setResult('createRestoreCredential', { status: 'success', responseJson: REGISTRATION_RESPONSE_JSON });
    mockFetch
      .mockResolvedValueOnce(fakeRes(ENROLLMENT_OPTIONS_BODY))           // enrollment-options
      .mockResolvedValueOnce(fakeRes({ version: 1, enrolled: true, credentialId: 'cred-id-123' })); // registration-verification

    const { ref } = renderAuthHook();
    await flush();

    let result;
    await act(async () => { result = await ref.current.signInWithPassword('a@b.com', 'pw'); });
    await flush();

    expect(result.ok).toBe(true);
    // enrollment-options called with bearer token
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/enrollment-options'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok-abc' }) }),
    );
    expect(nativeMock.createRestoreCredential).toHaveBeenCalledWith(JSON.stringify(ENROLLMENT_OPTIONS_BODY));
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/registration-verification'),
      expect.anything(),
    );
    const AS = require('@react-native-async-storage/async-storage');
    expect(await AS.getItem('kilo.auth.androidRestoreCredentialId')).toBe('cred-id-123');
  });

  test('reauth-required refusal preserves sign-in, skips credential', async () => {
    mockFetch.mockResolvedValueOnce(fakeRes({ error: 'Reauthentication required', code: 'reauth_required' }, 401));

    const { ref } = renderAuthHook();
    await flush();

    let result;
    await act(async () => { result = await ref.current.signInWithPassword('a@b.com', 'pw'); });
    await flush();

    expect(result.ok).toBe(true);
    expect(nativeMock.createRestoreCredential).not.toHaveBeenCalled();
    const AS = require('@react-native-async-storage/async-storage');
    expect(await AS.getItem('kilo.auth.androidRestoreCredentialId')).toBeNull();
  });

  test('native createRestoreCredential non-success does not store credential', async () => {
    nativeMock.__setResult('createRestoreCredential', { status: 'cancelled' });
    mockFetch.mockResolvedValueOnce(fakeRes(ENROLLMENT_OPTIONS_BODY));

    const { ref } = renderAuthHook();
    await flush();

    let result;
    await act(async () => { result = await ref.current.signInWithPassword('a@b.com', 'pw'); });
    await flush();

    expect(result.ok).toBe(true);
    const AS = require('@react-native-async-storage/async-storage');
    expect(await AS.getItem('kilo.auth.androidRestoreCredentialId')).toBeNull();
  });

  test('sign-in on non-Android skips enrollment API call and native module', async () => {
    Platform.OS = 'ios';
    const { ref } = renderAuthHook();
    await flush();

    let result;
    await act(async () => { result = await ref.current.signInWithPassword('a@b.com', 'pw'); });
    await flush();

    expect(result.ok).toBe(true);
    expect(nativeMock.createRestoreCredential).not.toHaveBeenCalled();
    // platform gate in enrollAndroidRestoreCredential prevents enrollment-options API call
    expect(mockFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('enrollment-options'),
      expect.anything(),
    );
  });

  test('GitHub OAuth callback triggers enrollment on Android', async () => {
    const session = { access_token: 'tok-github', refresh_token: 'ref-github', user: { id: 'uid-gh' } };
    mockAuth.exchangeCodeForSession = jest.fn().mockResolvedValue({ data: { session }, error: null });
    nativeMock.__setResult('createRestoreCredential', { status: 'success', responseJson: REGISTRATION_RESPONSE_JSON });
    mockFetch
      .mockResolvedValueOnce(fakeRes(ENROLLMENT_OPTIONS_BODY))           // enrollment-options
      .mockResolvedValueOnce(fakeRes({ credentialId: 'cred-id-github' })); // registration-verification

    const { ref } = renderAuthHook();
    await flush();

    let result;
    await act(async () => { result = await ref.current.handleAuthCallbackUrl('kilo://auth/callback?code=abc'); });
    await flush();

    expect(result.ok).toBe(true);
    expect(nativeMock.createRestoreCredential).toHaveBeenCalled();
    const AS = require('@react-native-async-storage/async-storage');
    expect(await AS.getItem('kilo.auth.androidRestoreCredentialId')).toBe('cred-id-github');
  });

  test('recovery callback does not trigger enrollment', async () => {
    const session = { access_token: 'tok-recovery', refresh_token: 'ref-recovery', user: { id: 'uid-r' } };
    mockAuth.exchangeCodeForSession = jest.fn().mockResolvedValue({ data: { session }, error: null });

    const { ref } = renderAuthHook();
    await flush();

    let result;
    await act(async () => { result = await ref.current.handleAuthCallbackUrl('kilo://auth/callback?code=abc', { isRecovery: true }); });
    await flush();

    expect(result.ok).toBe(true);
    expect(nativeMock.createRestoreCredential).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('enrollment-options'),
      expect.anything(),
    );
  });
});

// ---------------------------------------------------------------------------
// Restore session
// ---------------------------------------------------------------------------

describe('androidRestoreSession', () => {
  async function seedCredentialId(id = 'cred-id-123') {
    const AS = require('@react-native-async-storage/async-storage');
    await AS.setItem('kilo.auth.androidRestoreCredentialId', id);
  }

  test('successful restore calls setSession with token pair', async () => {
    await seedCredentialId();
    nativeMock.__setResult('getRestoreCredential', { status: 'success', credentialJson: ASSERTION_CREDENTIAL_JSON });
    mockFetch
      .mockResolvedValueOnce(fakeRes(RESTORE_OPTIONS_BODY))            // restore-options
      .mockResolvedValueOnce(fakeRes({ version: 1, access_token: 'new-tok', refresh_token: 'new-ref' })); // restore-verification

    const { ref } = renderAuthHook();
    await flush();

    let result;
    await act(async () => { result = await ref.current.androidRestoreSession(); });

    expect(result.ok).toBe(true);
    expect(mockSetSession).toHaveBeenCalledWith({ access_token: 'new-tok', refresh_token: 'new-ref' });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/restore-options'),
      expect.objectContaining({ body: expect.stringContaining('cred-id-123') }),
    );
  });

  test('no stored credential id uses discovery mode (no credentialId in request)', async () => {
    nativeMock.__setResult('getRestoreCredential', { status: 'success', credentialJson: ASSERTION_CREDENTIAL_JSON });
    mockFetch
      .mockResolvedValueOnce(fakeRes({ ...RESTORE_OPTIONS_BODY, allowCredentials: [] }))
      .mockResolvedValueOnce(fakeRes({ version: 1, access_token: 'new-tok', refresh_token: 'new-ref' }));

    const { ref } = renderAuthHook();
    await flush();

    let result;
    await act(async () => { result = await ref.current.androidRestoreSession(); });

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/restore-options'),
      expect.objectContaining({ body: expect.not.stringContaining('credentialId') }),
    );
  });

  test('discovery mode: restore-options request omits credentialId', async () => {
    nativeMock.__setResult('getRestoreCredential', { status: 'success', credentialJson: ASSERTION_CREDENTIAL_JSON });
    mockFetch
      .mockResolvedValueOnce(fakeRes({ ...RESTORE_OPTIONS_BODY, allowCredentials: [] }))
      .mockResolvedValueOnce(fakeRes({ version: 1, access_token: 'new-tok', refresh_token: 'new-ref' }));

    const { ref } = renderAuthHook();
    await flush();

    await act(async () => { await ref.current.androidRestoreSession(); });

    const [, init] = mockFetch.mock.calls.find(([url]) => url.includes('/v1/restore-options'));
    const body = JSON.parse(init.body);
    expect(body).not.toHaveProperty('credentialId');
    expect(body.version).toBe(1);
  });

  test('native status unsupported returns error', async () => {
    await seedCredentialId();
    nativeMock.__setResult('getRestoreCredential', { status: 'unsupported' });
    mockFetch.mockResolvedValueOnce(fakeRes(RESTORE_OPTIONS_BODY));

    const { ref } = renderAuthHook();
    await flush();

    let result;
    await act(async () => { result = await ref.current.androidRestoreSession(); });

    expect(result.ok).toBe(false);
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  test.each(['unavailable', 'cancelled', 'malformed', 'error'])(
    'native status %s returns error without session',
    async (status) => {
      await seedCredentialId();
      nativeMock.__setResult('getRestoreCredential', { status });
      mockFetch.mockResolvedValueOnce(fakeRes(RESTORE_OPTIONS_BODY));

      const { ref } = renderAuthHook();
      await flush();

      let result;
      await act(async () => { result = await ref.current.androidRestoreSession(); });

      expect(result.ok).toBe(false);
      expect(mockSetSession).not.toHaveBeenCalled();
    },
  );

  test('restore-options server failure returns error without native call', async () => {
    await seedCredentialId();
    mockFetch.mockResolvedValueOnce(fakeRes({ error: 'Service Unavailable' }, 503));

    const { ref } = renderAuthHook();
    await flush();

    let result;
    await act(async () => { result = await ref.current.androidRestoreSession(); });

    expect(result.ok).toBe(false);
    expect(nativeMock.getRestoreCredential).not.toHaveBeenCalled();
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  test('restore-verification failure returns error without persisting session', async () => {
    await seedCredentialId();
    nativeMock.__setResult('getRestoreCredential', { status: 'success', credentialJson: ASSERTION_CREDENTIAL_JSON });
    mockFetch
      .mockResolvedValueOnce(fakeRes(RESTORE_OPTIONS_BODY))
      .mockResolvedValueOnce(fakeRes({ error: 'Restore failed' }, 401));

    const { ref } = renderAuthHook();
    await flush();

    let result;
    await act(async () => { result = await ref.current.androidRestoreSession(); });

    expect(result.ok).toBe(false);
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  test('restore-verification with wrong version is rejected', async () => {
    await seedCredentialId();
    nativeMock.__setResult('getRestoreCredential', { status: 'success', credentialJson: ASSERTION_CREDENTIAL_JSON });
    mockFetch
      .mockResolvedValueOnce(fakeRes(RESTORE_OPTIONS_BODY))
      .mockResolvedValueOnce(fakeRes({ version: 2, access_token: 'new-tok', refresh_token: 'new-ref' }));

    const { ref } = renderAuthHook();
    await flush();

    let result;
    await act(async () => { result = await ref.current.androidRestoreSession(); });

    expect(result.ok).toBe(false);
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  test('partial server response (missing refresh_token) returns error', async () => {
    await seedCredentialId();
    nativeMock.__setResult('getRestoreCredential', { status: 'success', credentialJson: ASSERTION_CREDENTIAL_JSON });
    mockFetch
      .mockResolvedValueOnce(fakeRes(RESTORE_OPTIONS_BODY))
      .mockResolvedValueOnce(fakeRes({ version: 1, access_token: 'new-tok' })); // no refresh_token

    const { ref } = renderAuthHook();
    await flush();

    let result;
    await act(async () => { result = await ref.current.androidRestoreSession(); });

    expect(result.ok).toBe(false);
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  test('setSession failure returns error', async () => {
    await seedCredentialId();
    nativeMock.__setResult('getRestoreCredential', { status: 'success', credentialJson: ASSERTION_CREDENTIAL_JSON });
    mockSetSession.mockResolvedValueOnce({ error: { message: 'Invalid session' } });
    mockFetch
      .mockResolvedValueOnce(fakeRes(RESTORE_OPTIONS_BODY))
      .mockResolvedValueOnce(fakeRes({ version: 1, access_token: 'new-tok', refresh_token: 'new-ref' }));

    const { ref } = renderAuthHook();
    await flush();

    let result;
    await act(async () => { result = await ref.current.androidRestoreSession(); });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Invalid session');
  });

  test('not available on non-Android', async () => {
    Platform.OS = 'ios';
    await seedCredentialId();

    const { ref } = renderAuthHook();
    await flush();

    let result;
    await act(async () => { result = await ref.current.androidRestoreSession(); });

    expect(result.ok).toBe(false);
    expect(nativeMock.getRestoreCredential).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Sign-out: revoke before local signOut
// ---------------------------------------------------------------------------

describe('signOut with Android revocation', () => {
  async function seedCredentialId(id = 'cred-id-123') {
    const AS = require('@react-native-async-storage/async-storage');
    await AS.setItem('kilo.auth.androidRestoreCredentialId', id);
  }

  test('calls revoke with bearer before signOut, then clears device credential', async () => {
    await seedCredentialId();
    const callOrder = [];
    mockFetch.mockImplementation((url) => {
      callOrder.push(`fetch:${url.includes('revoke') ? 'revoke' : url}`);
      return fakeRes({ version: 1, revoked: true });
    });
    mockAuth.signOut.mockImplementation(() => {
      callOrder.push('signOut');
      return Promise.resolve({ error: null });
    });

    const { ref } = renderAuthHook();
    await flush();

    let result;
    await act(async () => { result = await ref.current.signOut(); });

    expect(result.ok).toBe(true);
    const revokeIdx = callOrder.findIndex((c) => c === 'fetch:revoke');
    const signOutIdx = callOrder.findIndex((c) => c === 'signOut');
    expect(revokeIdx).toBeGreaterThanOrEqual(0);
    expect(revokeIdx).toBeLessThan(signOutIdx);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/revoke'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${FAKE_SESSION.access_token}` }) }),
    );
    expect(nativeMock.clearRestoreCredential).toHaveBeenCalled();
    const AS = require('@react-native-async-storage/async-storage');
    expect(await AS.getItem('kilo.auth.androidRestoreCredentialId')).toBeNull();
  });

  test('getSession failure surfaces revoke error and prevents signOut', async () => {
    await seedCredentialId();
    mockAuth.getSession = jest.fn().mockRejectedValue(new Error('network error'));

    const { ref } = renderAuthHook();
    await flush();

    let result;
    await act(async () => { result = await ref.current.signOut(); });

    expect(result.ok).toBe(false);
    expect(result.error).toBe(NEUTRAL_RETRY_ERROR);
    expect(mockAuth.signOut).not.toHaveBeenCalled();
  });

  test('revoke failure surfaces error and prevents signOut', async () => {
    await seedCredentialId();
    mockFetch.mockResolvedValueOnce(fakeRes({ error: 'Revocation failed' }, 500));

    const { ref } = renderAuthHook();
    await flush();

    let result;
    await act(async () => { result = await ref.current.signOut(); });

    expect(result.ok).toBe(false);
    expect(result.error).toBe(NEUTRAL_RETRY_ERROR);
    expect(mockAuth.signOut).not.toHaveBeenCalled();
  });

  // Revoke runs on every platform, so its retryable failure copy must not
  // name an Android key or imply the server revoked anything (#1558).
  describe.each([
    ['web', 'web', null],
    ['ios', 'ios', null],
    ['android without native restore support', 'android', 'unavailable'],
  ])('retryable failure copy on %s', (_label, os, nativeStatus) => {
    beforeEach(() => {
      Platform.OS = os;
      if (nativeStatus) {
        ['createRestoreCredential', 'getRestoreCredential', 'clearRestoreCredential']
          .forEach((m) => nativeMock.__setResult(m, { status: nativeStatus }));
      }
    });

    test.each([
      ['server error', () => mockFetch.mockResolvedValueOnce(fakeRes({ error: 'Revocation failed' }, 500))],
      ['rejected fetch', () => mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))],
    ])('%s: neutral copy, ok false, no local signOut', async (_kind, failRevoke) => {
      failRevoke();
      const { ref } = renderAuthHook();
      await flush();

      let result;
      await act(async () => { result = await ref.current.signOut(); });

      expect(result).toEqual({ ok: false, error: NEUTRAL_RETRY_ERROR });
      expect(result.error).not.toMatch(/android|restore key|revoked|signed out/i);
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/v1/revoke'), expect.anything());
      expect(mockAuth.signOut).not.toHaveBeenCalled();
      expect(nativeMock.clearRestoreCredential).not.toHaveBeenCalled();
      expect(ref.current.signedIn).toBe(true);
    });
  });

  test('native clear unavailable/unsupported surfaces as incomplete-cleanup message', async () => {
    await seedCredentialId();
    mockFetch.mockResolvedValueOnce(fakeRes({ version: 1, revoked: true }));
    nativeMock.__setResult('clearRestoreCredential', { status: 'unavailable' });

    const { ref } = renderAuthHook();
    await flush();

    let result;
    await act(async () => { result = await ref.current.signOut(); });

    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/could not be cleared/i);
  });

  test('device-clear failure surfaces as incomplete-cleanup message (server revocation is authoritative)', async () => {
    await seedCredentialId();
    mockFetch.mockResolvedValueOnce(fakeRes({ version: 1, revoked: true }));
    nativeMock.__setResult('clearRestoreCredential', { status: 'error', message: 'device clear failed' });

    const { ref } = renderAuthHook();
    await flush();

    let result;
    await act(async () => { result = await ref.current.signOut(); });

    // sign-out completes because server revocation is authoritative
    expect(result.ok).toBe(true);
    expect(mockAuth.signOut).toHaveBeenCalled();
    // incomplete local cleanup is exposed via message, not silently discarded
    expect(result.message).toMatch(/could not be cleared/i);
  });

  test('non-Android calls revoke but skips device clear', async () => {
    Platform.OS = 'ios';
    mockFetch.mockResolvedValueOnce(fakeRes({ version: 1, revoked: true }));

    const { ref } = renderAuthHook();
    await flush();

    let result;
    await act(async () => { result = await ref.current.signOut(); });

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/v1/revoke'), expect.anything());
    expect(nativeMock.clearRestoreCredential).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Web sign-out (#1552): the browser reaches revoke only through CORS, and a
// CORS or network rejection makes fetch throw before any response exists.
// ---------------------------------------------------------------------------

describe('web signOut revocation', () => {
  beforeEach(() => {
    Platform.OS = 'web';
  });

  test('revokes with the current session bearer and no credential id, then signs out', async () => {
    mockFetch.mockResolvedValueOnce(fakeRes({ version: 1, revoked: true }));
    const { ref } = renderAuthHook();
    await flush();

    let result;
    await act(async () => { result = await ref.current.signOut(); });

    expect(result).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`${SUPABASE_URL}/functions/v1/android-restore-credentials/v1/revoke`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${FAKE_SESSION.access_token}`);
    expect(JSON.parse(init.body)).toEqual({});
    expect(mockAuth.signOut).toHaveBeenCalledTimes(1);
    expect(nativeMock.clearRestoreCredential).not.toHaveBeenCalled();
  });

  test('a rejected fetch fails closed: no local sign-out, session kept, retry succeeds', async () => {
    mockFetch
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(fakeRes({ version: 1, revoked: true }));
    const { ref } = renderAuthHook();
    await act(async () => { mockAuth._emit('SIGNED_IN', FAKE_SESSION); });
    await flush();

    let result;
    await act(async () => { result = await ref.current.signOut(); });
    expect(result.ok).toBe(false);
    expect(result.error).toBe(NEUTRAL_RETRY_ERROR);
    expect(mockAuth.signOut).not.toHaveBeenCalled();
    expect(ref.current.signedIn).toBe(true);

    await act(async () => { result = await ref.current.signOut(); });
    expect(result).toEqual({ ok: true });
    expect(mockAuth.signOut).toHaveBeenCalledTimes(1);
    expect(ref.current.signedIn).toBe(false);
  });

  test('a server refusal (401) fails closed without local sign-out', async () => {
    mockFetch.mockResolvedValueOnce(fakeRes({ error: 'Unauthorized' }, 401));
    const { ref } = renderAuthHook();
    await flush();

    let result;
    await act(async () => { result = await ref.current.signOut(); });
    expect(result.ok).toBe(false);
    expect(mockAuth.signOut).not.toHaveBeenCalled();
  });

  test('a rejected session lookup fails closed without calling revoke or signing out', async () => {
    const { ref } = renderAuthHook();
    await flush();
    mockAuth.getSession.mockRejectedValueOnce(new Error('network error'));

    let result;
    await act(async () => { result = await ref.current.signOut(); });
    expect(result.ok).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockAuth.signOut).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Sign-out without a usable revocation bearer (#1557): /v1/revoke authorizes
// only with the session's access token, so a lookup that cannot supply one
// must fail truthfully with no local sign-out, device clear, ID deletion, or
// wipe — on every platform.
// ---------------------------------------------------------------------------

describe('signOut when session lookup cannot supply a bearer', () => {
  const CRED_KEY = 'kilo.auth.androidRestoreCredentialId';
  const { NO_BEARER_ERROR, REVOKE_FAILED_ERROR } = require('../lib/signOutRevocation');
  const { wipeSensitiveDeviceData } = require('../storage/secureStorage');
  const revokeCalls = () => mockFetch.mock.calls.filter(([url]) => String(url).includes('/v1/revoke'));

  const NO_BEARER_LOOKUPS = [
    ['resolved { session: null, error }', { data: { session: null }, error: { message: 'invalid refresh' } }],
    ['null session without an error', { data: { session: null }, error: null }],
    ['session missing access_token', { data: { session: { refresh_token: 'ref', user: { id: 'uid-1' } } }, error: null }],
    ['session with an empty access_token', { data: { session: { ...FAKE_SESSION, access_token: '' } }, error: null }],
    ['resolved auth error alongside a session', { data: { session: FAKE_SESSION }, error: { message: 'refresh failed' } }],
  ];

  beforeEach(async () => {
    wipeSensitiveDeviceData.mockClear();
    const AS = require('@react-native-async-storage/async-storage');
    await AS.setItem(CRED_KEY, 'cred-id-123');
  });

  // Mounts signed in with a valid session, then applies `setLookup` so only
  // the sign-out lookup sees the failure fixture.
  async function signOutSignedIn(setLookup, options) {
    const { ref } = renderAuthHook();
    await flush();
    expect(ref.current.signedIn).toBe(true);
    setLookup();
    let result;
    await act(async () => { result = await ref.current.signOut(options); });
    return { ref, result };
  }

  async function expectNothingCleared(ref) {
    expect(revokeCalls()).toHaveLength(0);
    expect(mockAuth.signOut).not.toHaveBeenCalled();
    expect(nativeMock.clearRestoreCredential).not.toHaveBeenCalled();
    expect(wipeSensitiveDeviceData).not.toHaveBeenCalled();
    const AS = require('@react-native-async-storage/async-storage');
    expect(await AS.getItem(CRED_KEY)).toBe('cred-id-123');
    // The hook does not fabricate a signed-out state either; the SDK's own
    // SIGNED_OUT event is what moves the UI to sign-in when it drops a session.
    expect(ref.current.signedIn).toBe(true);
  }

  describe.each(['android', 'ios', 'web'])('on %s', (os) => {
    beforeEach(() => { Platform.OS = os; });

    test.each(NO_BEARER_LOOKUPS)('%s fails truthfully and clears nothing', async (_label, lookup) => {
      const { ref, result } = await signOutSignedIn(
        () => mockAuth.getSession.mockResolvedValue(lookup), { wipeLocalData: true });

      expect(result).toEqual({ ok: false, error: NO_BEARER_ERROR });
      expect(result.error).toMatch(/sign in again/i);
      expect(result.error).not.toMatch(/signed out|revoked/i);
      await expectNothingCleared(ref);
    });

    test('a rejected lookup fails closed with the transient retry error', async () => {
      const { ref, result } = await signOutSignedIn(
        () => mockAuth.getSession.mockRejectedValue(new Error('network error')), { wipeLocalData: true });

      expect(result).toEqual({ ok: false, error: REVOKE_FAILED_ERROR });
      await expectNothingCleared(ref);
    });

    test('a second null lookup after the SDK removed the session still fails', async () => {
      const { ref, result } = await signOutSignedIn(() => mockAuth.getSession
        .mockResolvedValueOnce({ data: { session: null }, error: { message: 'invalid refresh' } })
        .mockResolvedValue({ data: { session: null }, error: null }));
      expect(result).toEqual({ ok: false, error: NO_BEARER_ERROR });

      let retry;
      await act(async () => { retry = await ref.current.signOut(); });
      expect(retry).toEqual({ ok: false, error: NO_BEARER_ERROR });
      await expectNothingCleared(ref);
    });

    test('after interactive re-authentication the retry revokes with the new bearer, then signs out', async () => {
      const callOrder = [];
      mockFetch.mockImplementation((url) => {
        if (String(url).includes('/v1/revoke')) callOrder.push('revoke');
        return fakeRes({ version: 1, revoked: true });
      });
      mockAuth.signOut.mockImplementation(() => { callOrder.push('signOut'); return Promise.resolve({ error: null }); });

      const { ref, result } = await signOutSignedIn(
        () => mockAuth.getSession.mockResolvedValue({ data: { session: null }, error: null }));
      expect(result).toEqual({ ok: false, error: NO_BEARER_ERROR });

      const fresh = { ...FAKE_SESSION, access_token: 'tok-fresh' };
      mockAuth.signInWithPassword.mockResolvedValue({ data: { session: fresh }, error: null });
      mockAuth.getSession.mockResolvedValue({ data: { session: fresh }, error: null });
      await act(async () => { await ref.current.signInWithPassword('a@b.com', 'pw'); });
      await act(async () => { mockAuth._emit('SIGNED_IN', fresh); });
      await flush();

      let retry;
      await act(async () => { retry = await ref.current.signOut(); });
      expect(retry.ok).toBe(true);
      expect(callOrder).toEqual(['revoke', 'signOut']);
      expect(revokeCalls()[0][1].headers.Authorization).toBe('Bearer tok-fresh');
      expect(ref.current.signedIn).toBe(false);
      expect(nativeMock.clearRestoreCredential).toHaveBeenCalledTimes(os === 'android' ? 1 : 0);
    });
  });
});

// ---------------------------------------------------------------------------
// Account delete: device clear, no extra revoke call
// ---------------------------------------------------------------------------

describe('deleteAccount device clear', () => {
  const SUPABASE_FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

  async function seedCredentialId(id = 'cred-id-123') {
    const AS = require('@react-native-async-storage/async-storage');
    await AS.setItem('kilo.auth.androidRestoreCredentialId', id);
  }

  test('clears device credential after server deletion, no /v1/revoke call', async () => {
    await seedCredentialId();
    mockFetch.mockResolvedValueOnce(fakeRes({ deleted: true })); // account-delete

    const { ref } = renderAuthHook();
    await flush();

    let result;
    await act(async () => { result = await ref.current.deleteAccount(); });

    expect(result.ok).toBe(true);
    // Only the account-delete call; no revoke
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('account-delete'),
      expect.anything(),
    );
    expect(nativeMock.clearRestoreCredential).toHaveBeenCalled();
    const AS = require('@react-native-async-storage/async-storage');
    expect(await AS.getItem('kilo.auth.androidRestoreCredentialId')).toBeNull();
  });

  test('device-clear failure during deleteAccount surfaces as incomplete-cleanup message', async () => {
    await seedCredentialId();
    nativeMock.__setResult('clearRestoreCredential', { status: 'error', message: 'device error' });
    mockFetch.mockResolvedValueOnce(fakeRes({ deleted: true }));

    const { ref } = renderAuthHook();
    await flush();

    let result;
    await act(async () => { result = await ref.current.deleteAccount(); });

    expect(result.ok).toBe(true);
    expect(mockAuth.signOut).toHaveBeenCalled();
    // incomplete local cleanup exposed via message so callers can report it
    expect(result.message).toMatch(/could not be cleared/i);
  });

  test('server deletion failure does not clear device credential', async () => {
    await seedCredentialId();
    mockFetch.mockResolvedValueOnce(fakeRes({ error: 'Account deletion failed.' }, 500));

    const { ref } = renderAuthHook();
    await flush();

    let result;
    await act(async () => { result = await ref.current.deleteAccount(); });

    expect(result.ok).toBe(false);
    expect(nativeMock.clearRestoreCredential).not.toHaveBeenCalled();
    const AS = require('@react-native-async-storage/async-storage');
    expect(await AS.getItem('kilo.auth.androidRestoreCredentialId')).toBe('cred-id-123');
  });

  test('non-Android skips device clear on deleteAccount', async () => {
    Platform.OS = 'ios';
    await seedCredentialId();
    mockFetch.mockResolvedValueOnce(fakeRes({ deleted: true }));

    const { ref } = renderAuthHook();
    await flush();

    let result;
    await act(async () => { result = await ref.current.deleteAccount(); });

    expect(result.ok).toBe(true);
    expect(nativeMock.clearRestoreCredential).not.toHaveBeenCalled();
  });
});

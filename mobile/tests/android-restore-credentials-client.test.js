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
    expect(result.error).toMatch(/revoke/i);
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
    expect(result.error).toContain('revoke');
    expect(mockAuth.signOut).not.toHaveBeenCalled();
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

  test('non-Android skips revoke entirely', async () => {
    Platform.OS = 'ios';
    const { ref } = renderAuthHook();
    await flush();

    let result;
    await act(async () => { result = await ref.current.signOut(); });

    expect(result.ok).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(nativeMock.clearRestoreCredential).not.toHaveBeenCalled();
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

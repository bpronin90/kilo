// Client-side consent gate: a denial must stop the upload, not just annotate it (#487).
//
// The server is the real boundary — RLS refuses these reads and writes regardless.
// What is proved here is the thing RLS cannot prove: that the app does not TRY. A
// client that optimistically bootstraps a user's entire training history and only
// then discovers it has no grant has already sent the data; the rejection arrives
// after the request. So the check has to come first, and the phase must not be
// driven at all when it fails.

import React from 'react';
import renderer, { act } from 'react-test-renderer';

import { cloudAdapter } from '../storage/cloudAdapter';
import * as Storage from '../storage/entries';
import {
  SYNC_PHASE,
  SYNC_STATUS,
  getSyncState,
  __resetSyncQueue,
} from '../storage/syncRecovery';
import { useSyncRecovery } from '../hooks/useEntries';
import { DENIAL_CODES } from '../storage/cloud/consent';

jest.mock('../storage/cloud/consent', () => {
  const actual = jest.requireActual('../storage/cloud/consent');
  return { ...actual, fetchConsentStatus: jest.fn() };
});

const { fetchConsentStatus } = require('../storage/cloud/consent');

const USER = { id: 'u-1', email: 'a@b.c' };

// Same Probe harness the other hook suites use.
function renderHook(useHook) {
  const ref = { current: null };
  function Probe() {
    ref.current = useHook();
    return null;
  }
  act(() => {
    renderer.create(React.createElement(Probe));
  });
  return { result: ref };
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetSyncQueue();
  jest.spyOn(cloudAdapter, 'bootstrapFromLocal').mockResolvedValue({ ok: true });
  jest
    .spyOn(Storage, 'getStorageAdapter')
    .mockReturnValue({ sync: jest.fn().mockResolvedValue([{ table: 'weight_entries' }]) });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each([
  ['a user who has never consented', DENIAL_CODES.CONSENT_REQUIRED],
  ['a user whose grant is for an older material version', DENIAL_CODES.CONSENT_VERSION_STALE],
  ['a client below the protocol floor', DENIAL_CODES.CLIENT_UPDATE_REQUIRED],
  ['a user whose cloud purge is still running', DENIAL_CODES.HEALTH_DATA_DELETION_PENDING],
])('%s', (_label, code) => {
  beforeEach(() => {
    fetchConsentStatus.mockResolvedValue({ allowed: false, code });
  });

  it('uploads nothing on bootstrap and reports the denial code', async () => {
    const { result } = renderHook(() => useSyncRecovery(USER));

    let outcome;
    await act(async () => {
      outcome = await result.current.runBootstrap();
    });

    // The decisive assertion: the history was never sent.
    expect(cloudAdapter.bootstrapFromLocal).not.toHaveBeenCalled();
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe(code);
    // Not a failure the user should "retry" — retrying without consenting would
    // just be refused again. The phase stays idle.
    expect(getSyncState()[SYNC_PHASE.BOOTSTRAP].status).toBe(SYNC_STATUS.IDLE);
  });

  it('runs no sync pass and reports the denial code', async () => {
    const adapter = Storage.getStorageAdapter();
    const { result } = renderHook(() => useSyncRecovery(USER));

    let outcome;
    await act(async () => {
      outcome = await result.current.runSync();
    });

    expect(adapter.sync).not.toHaveBeenCalled();
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe(code);
    expect(getSyncState()[SYNC_PHASE.SYNC].status).toBe(SYNC_STATUS.IDLE);
  });
});

describe('a user with an active grant', () => {
  beforeEach(() => {
    fetchConsentStatus.mockResolvedValue({ allowed: true, code: 'OK' });
  });

  it('bootstraps and syncs normally', async () => {
    const adapter = Storage.getStorageAdapter();
    const { result } = renderHook(() => useSyncRecovery(USER));

    await act(async () => {
      await result.current.runBootstrap();
    });
    await act(async () => {
      await result.current.runSync();
    });

    expect(cloudAdapter.bootstrapFromLocal).toHaveBeenCalledWith(USER.id);
    expect(adapter.sync).toHaveBeenCalled();
  });
});

describe('a server that cannot be reached', () => {
  it('treats an unreachable preflight as a denial, never as permission', async () => {
    // Fail-closed. "We could not confirm you have a grant" and "you have a grant"
    // must not lead to the same behavior, or a network blip would upload special-
    // category data with no lawful basis.
    fetchConsentStatus.mockResolvedValue({ allowed: false, code: 'PREFLIGHT_FAILED' });

    const { result } = renderHook(() => useSyncRecovery(USER));

    let outcome;
    await act(async () => {
      outcome = await result.current.runBootstrap();
    });

    expect(cloudAdapter.bootstrapFromLocal).not.toHaveBeenCalled();
    expect(outcome.ok).toBe(false);
  });
});

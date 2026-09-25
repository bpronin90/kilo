import { Platform } from 'react-native';

import {
  createRestoreCredential,
  getRestoreCredential,
  clearRestoreCredential,
} from '../modules/android-restore-credentials/src/index';
import nativeMock from './mocks/androidRestoreCredentials';

describe('android-restore-credentials', () => {
  let originalOS;

  beforeEach(() => {
    originalOS = Platform.OS;
    Platform.OS = 'android';
    nativeMock.__reset();
  });

  afterEach(() => {
    Platform.OS = originalOS;
  });

  it('creates a restore credential on success', async () => {
    nativeMock.__setResult('createRestoreCredential', {
      status: 'success',
      responseJson: '{"id":"cred-1"}',
    });

    const result = await createRestoreCredential('{"request":"payload"}');

    expect(result).toEqual({ status: 'success', responseJson: '{"id":"cred-1"}' });
    expect(nativeMock.createRestoreCredential).toHaveBeenCalledWith('{"request":"payload"}');
  });

  it('retrieves a restore credential on success', async () => {
    nativeMock.__setResult('getRestoreCredential', {
      status: 'success',
      credentialJson: '{"id":"cred-1"}',
      type: 'androidx.credentials.TYPE_RESTORE_CREDENTIAL',
    });

    const result = await getRestoreCredential('{"options":"payload"}');

    expect(result).toEqual({
      status: 'success',
      credentialJson: '{"id":"cred-1"}',
      type: 'androidx.credentials.TYPE_RESTORE_CREDENTIAL',
    });
  });

  it('clears the restore credential on success', async () => {
    nativeMock.__setResult('clearRestoreCredential', { status: 'success' });

    const result = await clearRestoreCredential();

    expect(result).toEqual({ status: 'success' });
    expect(nativeMock.clearRestoreCredential).toHaveBeenCalledTimes(1);
  });

  it('returns an unsupported result on a non-Android platform without calling native code', async () => {
    Platform.OS = 'ios';

    const result = await createRestoreCredential('{"request":"payload"}');

    expect(result).toEqual({ status: 'unsupported' });
    expect(nativeMock.createRestoreCredential).not.toHaveBeenCalled();
  });

  it('surfaces an unavailable-provider result without creating a session', async () => {
    nativeMock.__setResult('getRestoreCredential', {
      status: 'unavailable',
      message: 'No credential provider is registered.',
    });

    const result = await getRestoreCredential('{"options":"payload"}');

    expect(result.status).toBe('unavailable');
    expect(result.credentialJson).toBeUndefined();
  });

  it('passes through an Android provider that does not support Restore Credentials as unsupported', async () => {
    nativeMock.__setResult('createRestoreCredential', {
      status: 'unsupported',
      message: 'Restore Credentials is not supported by the provider.',
    });

    const result = await createRestoreCredential('{"request":"payload"}');

    expect(result.status).toBe('unsupported');
    expect(result.responseJson).toBeUndefined();
  });

  it('surfaces a cancellation result distinct from failure', async () => {
    nativeMock.__setResult('getRestoreCredential', { status: 'cancelled' });

    const result = await getRestoreCredential('{"options":"payload"}');

    expect(result).toEqual({ status: 'cancelled' });
  });

  it('classifies an unrecognized native response as malformed instead of trusting it', async () => {
    nativeMock.__setResult('createRestoreCredential', { unexpected: 'shape' });

    const result = await createRestoreCredential('{"request":"payload"}');

    expect(result).toEqual({ status: 'malformed' });
  });

  it('classifies a partial success without its credential payload as malformed', async () => {
    nativeMock.__setResult('getRestoreCredential', { status: 'success' });

    const result = await getRestoreCredential('{"options":"payload"}');

    expect(result).toEqual({ status: 'malformed' });
  });

  it('reports clear failures instead of silently claiming success', async () => {
    nativeMock.__setRejection('clearRestoreCredential', new Error('clear failed'));

    const result = await clearRestoreCredential();

    expect(result).toEqual({ status: 'error', message: 'clear failed' });
  });
});

import { Platform } from 'react-native';

import NativeModule from './AndroidRestoreCredentialsModule';

// Discriminated result statuses shared by create/get/clear so callers can
// fail closed on anything other than 'success'. See the issue #1158
// state-transition matrix: Create only stores server-approved enrollment
// state in the Android Credential Manager (never locally); Get never
// fabricates a session from an unavailable/cancelled/malformed result; Clear
// reports failure rather than silently claiming success.
const VALID_STATUSES = new Set([
  'success',
  'unsupported',
  'unavailable',
  'cancelled',
  'malformed',
  'error',
]);

function unsupportedResult() {
  return { status: 'unsupported' };
}

function errorResult(error) {
  return {
    status: 'error',
    message: error instanceof Error ? error.message : String(error),
  };
}

// Native results cross a bridge/JSI boundary; treat anything that isn't a
// recognized, well-shaped status as malformed rather than trusting it. A
// 'success' missing its required payload field is a partial result and is
// also malformed, so no caller builds a session from it.
function normalizeResult(result, payloadKey) {
  if (!result || typeof result !== 'object' || !VALID_STATUSES.has(result.status)) {
    return { status: 'malformed' };
  }
  if (
    result.status === 'success' &&
    payloadKey &&
    (typeof result[payloadKey] !== 'string' || result[payloadKey] === '')
  ) {
    return { status: 'malformed' };
  }
  return result;
}

function isAvailable() {
  return Platform.OS === 'android' && NativeModule != null;
}

/**
 * Creates the Android Restore Credential for the current app install from a
 * server-approved public-key enrollment payload. The credential-private
 * material stays inside AndroidX Credential Manager; no token is persisted
 * locally by this module.
 *
 * @param {string} requestJson JSON payload for `CreateRestoreCredentialRequest`.
 * @returns {Promise<{status: string, responseJson?: string, message?: string}>}
 */
export async function createRestoreCredential(requestJson) {
  if (!isAvailable()) return unsupportedResult();
  try {
    return normalizeResult(await NativeModule.createRestoreCredential(requestJson), 'responseJson');
  } catch (error) {
    return errorResult(error);
  }
}

/**
 * Retrieves the Android Restore Credential via `GetRestoreCredentialOption`.
 * Never fabricates a result: provider-unavailable, user-cancelled, and
 * malformed native responses are all returned as distinct non-success
 * statuses so the caller does not create a session from them.
 *
 * @param {string} requestJson JSON payload for `GetCredentialRequest`.
 * @returns {Promise<{status: string, credentialJson?: string, type?: string, message?: string}>}
 */
export async function getRestoreCredential(requestJson) {
  if (!isAvailable()) return unsupportedResult();
  try {
    return normalizeResult(await NativeModule.getRestoreCredential(requestJson), 'credentialJson');
  } catch (error) {
    return errorResult(error);
  }
}

/**
 * Clears the app's Restore Credential state (e.g. on sign-out, account
 * deletion, or server-side revocation). Failure is reported explicitly so
 * the caller can fail closed instead of assuming the credential is gone.
 *
 * @returns {Promise<{status: string, message?: string}>}
 */
export async function clearRestoreCredential() {
  if (!isAvailable()) return unsupportedResult();
  try {
    return normalizeResult(await NativeModule.clearRestoreCredential());
  } catch (error) {
    return errorResult(error);
  }
}

export const isAndroidRestoreCredentialsAvailable = isAvailable;

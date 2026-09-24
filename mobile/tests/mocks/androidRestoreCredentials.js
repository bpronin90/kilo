// Jest mock for the native side of `modules/android-restore-credentials`.
// Mapped over `AndroidRestoreCredentialsModule` via the jest moduleNameMapper
// entry in mobile/package.json so tests can drive create/get/clear results
// without a real AndroidX Credential Manager provider.
//
// Usage:
//   const nativeMock = require('./mocks/androidRestoreCredentials');
//   nativeMock.__setResult('createRestoreCredential', { status: 'success', responseJson: '{}' });
//   nativeMock.__setRejection('clearRestoreCredential', new Error('clear failed'));
//   nativeMock.__reset();

const METHODS = ['createRestoreCredential', 'getRestoreCredential', 'clearRestoreCredential'];

const nextResult = {};

function invoke(method) {
  const next = nextResult[method];
  if (next && next.rejects) {
    return Promise.reject(next.rejects);
  }
  return Promise.resolve(next ? next.value : { status: 'success' });
}

const nativeModuleMock = {};

METHODS.forEach((method) => {
  nativeModuleMock[method] = jest.fn(() => invoke(method));
});

nativeModuleMock.__setResult = (method, value) => {
  nextResult[method] = { value };
};

nativeModuleMock.__setRejection = (method, error) => {
  nextResult[method] = { rejects: error };
};

nativeModuleMock.__reset = () => {
  METHODS.forEach((method) => {
    delete nextResult[method];
    nativeModuleMock[method].mockClear();
  });
};

module.exports = nativeModuleMock;
module.exports.default = nativeModuleMock;

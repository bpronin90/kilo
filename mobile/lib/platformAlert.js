// react-native-web has no native dialog to back Alert.alert, so it silently
// no-ops for multi-button alerts (single-button calls sometimes fall through
// to window.alert, but anything with a Cancel/Confirm pair — the common case
// in the Log tab's confirmation flows — does nothing at all: no dialog, no
// callback, the action is just dropped). This module is a drop-in
// replacement for `import { Alert } from 'react-native'` that keeps the
// native behavior unchanged and, on web, renders through WebAlertHost instead
// (#721: "Set as current routine" and other confirmations were
// completely dead on web).
import { Alert as RNAlert, Platform } from 'react-native';

let webHandler = null;

// Exported for WebAlertHost only.
export function setWebAlertHandler(handler) {
  webHandler = handler;
}

export const Alert = {
  // Forwarded to the real RN Alert with exactly the arity the caller used
  // (not padded with trailing `undefined`s) so existing
  // `toHaveBeenCalledWith(title, message)` / `(title, message, buttons)` test
  // assertions against the underlying RN Alert still match.
  alert(...args) {
    if (Platform.OS !== 'web') {
      return RNAlert.alert(...args);
    }
    if (!webHandler) {
      console.warn('[platformAlert] WebAlertHost is not mounted; dropping alert:', args[0]);
      return undefined;
    }
    const [title, message, buttons] = args;
    return webHandler(title, message, buttons);
  },
};

// Copy plain text to the system clipboard on every platform Kilo targets.
//
// Web goes straight to the async `navigator.clipboard.writeText` instead of
// react-native-web's `Clipboard` shim: that shim is the legacy
// `document.execCommand('copy')` path, which needs a live DOM selection and
// cannot report a rejected permission — a denied copy there would look like a
// success. This mirrors platformAlert.js routing web through its own
// implementation rather than react-native-web's no-op. Native uses React
// Native's core `Clipboard`, still exported from `react-native` in 0.81, so no
// dependency is added.
import { Clipboard, Platform } from 'react-native';

// Resolves only on a completed write and rejects on any failure, including a
// rejected web permission promise or a browser with no async clipboard. On
// native, `Clipboard.setString` is synchronous and returns nothing, so a
// resolved promise there means "handed to the OS" — the strongest signal that
// API gives.
//
// `deps` follows routineShare.js: the app always uses the real platform
// modules; tests inject substitutes.
export async function copyTextToClipboard(text, deps = {}) {
  const value = text == null ? '' : String(text);
  const platform = deps.platform ?? Platform.OS;
  if (platform === 'web') {
    const clipboard = deps.clipboard ?? globalThis.navigator?.clipboard;
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      throw new Error('The clipboard is not available in this browser.');
    }
    await clipboard.writeText(value);
    return;
  }
  const setString = deps.setString ?? Clipboard.setString;
  setString(value);
}

// Android 13+ (API level 33) shows its own system popup whenever an app writes
// to the clipboard; an in-app confirmation on top of it doubles the feedback.
// `Platform.Version` on Android is the integer API level — a stable, documented
// value, not a string parse — so this check is safe to rely on. Every other
// platform Kilo runs on shows nothing, so the app supplies the confirmation
// there.
export function systemConfirmsClipboardWrite(deps = {}) {
  const platform = deps.platform ?? Platform.OS;
  const version = deps.version ?? Platform.Version;
  return platform === 'android' && Number(version) >= 33;
}

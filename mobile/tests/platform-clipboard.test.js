// Platform clipboard wrapper (#956).
//
// Two properties are pinned here: web writes through the async
// `navigator.clipboard.writeText` (never react-native-web's execCommand shim)
// and surfaces a rejection as a rejection; native writes through React
// Native's core `Clipboard.setString` with no added dependency. Plus the
// Android 13+ system-popup detection that decides whether the app shows its
// own confirmation.
import { Clipboard, Platform } from 'react-native';
import { copyTextToClipboard, systemConfirmsClipboardWrite } from '../lib/platformClipboard';

describe('copyTextToClipboard — web', () => {
  test('writes the exact string through navigator.clipboard.writeText and resolves', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    await expect(
      copyTextToClipboard('routine body', { platform: 'web', clipboard: { writeText } }),
    ).resolves.toBeUndefined();
    expect(writeText).toHaveBeenCalledWith('routine body');
  });

  test('a rejected writeText promise rejects the helper', async () => {
    const writeText = jest.fn().mockRejectedValue(new Error('NotAllowedError'));
    await expect(
      copyTextToClipboard('x', { platform: 'web', clipboard: { writeText } }),
    ).rejects.toThrow('NotAllowedError');
  });

  test('rejects when the browser exposes no async clipboard', async () => {
    await expect(
      copyTextToClipboard('x', { platform: 'web', clipboard: null }),
    ).rejects.toThrow(/not available/i);
    await expect(
      copyTextToClipboard('x', { platform: 'web', clipboard: {} }),
    ).rejects.toThrow(/not available/i);
  });

  test('null/undefined text is coerced to an empty string, not the literal', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    await copyTextToClipboard(null, { platform: 'web', clipboard: { writeText } });
    await copyTextToClipboard(undefined, { platform: 'web', clipboard: { writeText } });
    expect(writeText).toHaveBeenNthCalledWith(1, '');
    expect(writeText).toHaveBeenNthCalledWith(2, '');
  });
});

describe('copyTextToClipboard — native', () => {
  test('uses the injected setString and never navigator.clipboard', async () => {
    const setString = jest.fn();
    await expect(
      copyTextToClipboard('routine body', { platform: 'ios', setString }),
    ).resolves.toBeUndefined();
    expect(setString).toHaveBeenCalledWith('routine body');
  });

  test('default path is React Native core Clipboard.setString', async () => {
    const spy = jest.spyOn(Clipboard, 'setString').mockImplementation(() => {});
    await copyTextToClipboard('body', { platform: 'android' });
    expect(spy).toHaveBeenCalledWith('body');
    spy.mockRestore();
  });
});

describe('systemConfirmsClipboardWrite', () => {
  test('true only on Android API 33 or newer', () => {
    expect(systemConfirmsClipboardWrite({ platform: 'android', version: 33 })).toBe(true);
    expect(systemConfirmsClipboardWrite({ platform: 'android', version: 34 })).toBe(true);
    expect(systemConfirmsClipboardWrite({ platform: 'android', version: 32 })).toBe(false);
    expect(systemConfirmsClipboardWrite({ platform: 'ios', version: 33 })).toBe(false);
    expect(systemConfirmsClipboardWrite({ platform: 'web', version: 33 })).toBe(false);
  });

  test('a missing Platform.Version is treated as pre-13, not a match', () => {
    const realOS = Platform.OS;
    const realVersion = Platform.Version;
    Platform.OS = 'android';
    Platform.Version = undefined;
    try {
      expect(systemConfirmsClipboardWrite()).toBe(false);
    } finally {
      Platform.OS = realOS;
      Platform.Version = realVersion;
    }
  });
});

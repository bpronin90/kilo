import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  APPEARANCE_PREFERENCE_KEY,
  DEFAULT_APPEARANCE_PREFERENCE,
  __resetAppearancePreferenceForTests,
  getAppearancePreference,
  normalizeAppearancePreference,
  setAppearancePreference,
  subscribeAppearancePreference,
  useAppearancePreference,
} from '../lib/themePreference';
import { resolveThemeMode } from '../theme/ThemeContext';

// #689: the appearance preference store. Three values only, default 'system',
// persisted locally, and every subscriber updates on the same tick a selection
// lands.

function Probe() {
  const preference = useAppearancePreference();
  return <Text>{preference}</Text>;
}

function renderedText(component) {
  return component.root.findByType(Text).props.children;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('appearance preference validation', () => {
  beforeEach(() => {
    __resetAppearancePreferenceForTests();
    AsyncStorage.clear();
  });

  test('accepts exactly light, dark, and system', () => {
    expect(normalizeAppearancePreference('light')).toBe('light');
    expect(normalizeAppearancePreference('dark')).toBe('dark');
    expect(normalizeAppearancePreference('system')).toBe('system');
  });

  test('missing or invalid values fall back to system', () => {
    expect(DEFAULT_APPEARANCE_PREFERENCE).toBe('system');
    for (const bad of [null, undefined, '', 'SYSTEM', 'indigo', 'auto', 0, {}, []]) {
      expect(normalizeAppearancePreference(bad)).toBe('system');
    }
  });

  test('a fresh install with no stored value resolves to system', async () => {
    let component;
    await act(async () => {
      component = renderer.create(<Probe />);
    });
    await flush();
    expect(renderedText(component)).toBe('system');
  });
});

describe('appearance preference hydration and persistence', () => {
  beforeEach(() => {
    __resetAppearancePreferenceForTests();
    AsyncStorage.clear();
  });

  test('a stored selection hydrates on the first subscriber (survives restart)', async () => {
    await AsyncStorage.setItem(APPEARANCE_PREFERENCE_KEY, 'dark');

    let component;
    await act(async () => {
      component = renderer.create(<Probe />);
    });
    await flush();

    expect(renderedText(component)).toBe('dark');
  });

  test('an invalid stored value hydrates to system rather than rendering it', async () => {
    await AsyncStorage.setItem(APPEARANCE_PREFERENCE_KEY, 'neon');

    let component;
    await act(async () => {
      component = renderer.create(<Probe />);
    });
    await flush();

    expect(renderedText(component)).toBe('system');
  });

  test('a selection is written to the Kilo-owned key', async () => {
    await act(async () => {
      await setAppearancePreference('light');
    });
    expect(await AsyncStorage.getItem(APPEARANCE_PREFERENCE_KEY)).toBe('light');
  });

  test('an invalid selection persists the normalized value, not the raw input', async () => {
    await act(async () => {
      await setAppearancePreference('chartreuse');
    });
    expect(getAppearancePreference()).toBe('system');
    expect(await AsyncStorage.getItem(APPEARANCE_PREFERENCE_KEY)).toBe('system');
  });

  test('an explicit selection wins over an in-flight hydration', async () => {
    await AsyncStorage.setItem(APPEARANCE_PREFERENCE_KEY, 'dark');

    let component;
    await act(async () => {
      component = renderer.create(<Probe />);
      // Selected before the pending read resolves.
      setAppearancePreference('light');
    });
    await flush();

    expect(renderedText(component)).toBe('light');
  });
});

describe('appearance preference failure handling', () => {
  beforeEach(() => {
    __resetAppearancePreferenceForTests();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('a rejected read leaves the default in place without throwing', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValue(new Error('storage down'));

    let component;
    await act(async () => {
      component = renderer.create(<Probe />);
    });
    await flush();

    expect(renderedText(component)).toBe('system');
  });

  test('a read that throws synchronously does not break the subscribing render', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockImplementation(() => {
      throw new Error('adapter exploded');
    });

    let component;
    await act(async () => {
      component = renderer.create(<Probe />);
    });
    await flush();

    expect(renderedText(component)).toBe('system');
  });

  test('a failed write still applies the selection for the session', async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValue(new Error('disk full'));

    await act(async () => {
      await expect(setAppearancePreference('dark')).resolves.toBeUndefined();
    });

    expect(getAppearancePreference()).toBe('dark');
  });
});

describe('appearance preference subscribers', () => {
  beforeEach(() => {
    __resetAppearancePreferenceForTests();
    AsyncStorage.clear();
  });

  test('a selection notifies subscribers immediately', () => {
    const listener = jest.fn();
    subscribeAppearancePreference(listener);
    listener.mockClear();

    setAppearancePreference('dark');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getAppearancePreference()).toBe('dark');
  });

  test('re-selecting the current value does not notify', () => {
    setAppearancePreference('dark');
    const listener = jest.fn();
    subscribeAppearancePreference(listener);
    listener.mockClear();

    setAppearancePreference('dark');

    expect(listener).not.toHaveBeenCalled();
  });

  test('unsubscribing stops notifications', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeAppearancePreference(listener);
    unsubscribe();
    listener.mockClear();

    setAppearancePreference('light');

    expect(listener).not.toHaveBeenCalled();
  });

  test('a mounted subscriber re-renders on the tick the selection lands', async () => {
    let component;
    await act(async () => {
      component = renderer.create(<Probe />);
    });
    await flush();
    expect(renderedText(component)).toBe('system');

    await act(async () => {
      setAppearancePreference('dark');
    });

    expect(renderedText(component)).toBe('dark');
  });
});

describe('system mode resolution', () => {
  test('explicit preferences ignore the OS scheme entirely', () => {
    expect(resolveThemeMode('light', 'dark')).toBe('light');
    expect(resolveThemeMode('dark', 'light')).toBe('dark');
    expect(resolveThemeMode('light', null)).toBe('light');
    expect(resolveThemeMode('dark', undefined)).toBe('dark');
  });

  test('system follows the reported OS scheme', () => {
    expect(resolveThemeMode('system', 'dark')).toBe('dark');
    expect(resolveThemeMode('system', 'light')).toBe('light');
  });

  test('system defaults to light when the platform reports no scheme', () => {
    expect(resolveThemeMode('system', null)).toBe('light');
    expect(resolveThemeMode('system', undefined)).toBe('light');
  });
});

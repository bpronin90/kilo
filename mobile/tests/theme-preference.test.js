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
  THEME_SELECTION_KEY,
  DEFAULT_THEME_SELECTION,
  __resetThemeSelectionForTests,
  getThemeSelection,
  normalizeThemeSelection,
  setThemeSelection,
  subscribeThemeSelection,
  useThemeSelection,
} from '../lib/themePreference';
import { resolveThemeMode } from '../theme/ThemeContext';

// Capture original AsyncStorage implementations before any test can spy on them.
// jest.spyOn on an already-mocked jest.fn() can modify the original mock in-place;
// capturing the implementation early lets us fully restore it in affected describes.
const _originalSetItemImpl = AsyncStorage.setItem.getMockImplementation();
const _originalGetItemImpl = AsyncStorage.getItem.getMockImplementation();

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

// ---------------------------------------------------------------------------
// Theme selection (#1105)
// ---------------------------------------------------------------------------

function ThemeProbe() {
  const theme = useThemeSelection();
  return <Text>{theme}</Text>;
}

function renderedTheme(component) {
  return component.root.findByType(Text).props.children;
}

describe('theme selection validation', () => {
  beforeEach(() => {
    __resetThemeSelectionForTests();
    AsyncStorage.clear();
  });

  test('accepts exactly hard-court, clay-court, and grass-court', () => {
    expect(normalizeThemeSelection('hard-court')).toBe('hard-court');
    expect(normalizeThemeSelection('clay-court')).toBe('clay-court');
    expect(normalizeThemeSelection('grass-court')).toBe('grass-court');
  });

  test('missing or invalid values fall back to hard-court', () => {
    expect(DEFAULT_THEME_SELECTION).toBe('hard-court');
    for (const bad of [null, undefined, '', 'Hard Court', 'system', 'hard_court', 0, {}, []]) {
      expect(normalizeThemeSelection(bad)).toBe('hard-court');
    }
  });

  test('a fresh install with no stored value resolves to hard-court', async () => {
    let component;
    await act(async () => {
      component = renderer.create(<ThemeProbe />);
    });
    await flush();
    expect(renderedTheme(component)).toBe('hard-court');
  });

  test('stale or foreign identity values (e.g. appearance preference) normalize to hard-court', () => {
    for (const foreign of ['system', 'light', 'dark', 'kilo_appearance_preference']) {
      expect(normalizeThemeSelection(foreign)).toBe('hard-court');
    }
  });
});

describe('theme selection hydration and persistence', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    // Hard-reset in case jest.spyOn modified the mock's implementation in place.
    if (_originalSetItemImpl) AsyncStorage.setItem.mockImplementation(_originalSetItemImpl);
    if (_originalGetItemImpl) AsyncStorage.getItem.mockImplementation(_originalGetItemImpl);
    __resetThemeSelectionForTests();
    AsyncStorage.clear();
  });

  test('a stored selection hydrates on the first subscriber (survives restart)', async () => {
    await AsyncStorage.setItem(THEME_SELECTION_KEY, 'clay-court');

    let component;
    await act(async () => {
      component = renderer.create(<ThemeProbe />);
    });
    await flush();

    expect(renderedTheme(component)).toBe('clay-court');
  });

  test('an invalid stored value hydrates to hard-court rather than rendering it', async () => {
    await AsyncStorage.setItem(THEME_SELECTION_KEY, 'astroturf');

    let component;
    await act(async () => {
      component = renderer.create(<ThemeProbe />);
    });
    await flush();

    expect(renderedTheme(component)).toBe('hard-court');
  });

  test('a selection is written to the Kilo-owned key', async () => {
    await act(async () => {
      await setThemeSelection('grass-court');
    });
    expect(await AsyncStorage.getItem(THEME_SELECTION_KEY)).toBe('grass-court');
  });

  test('an invalid selection persists the normalized value, not the raw input', async () => {
    await act(async () => {
      await setThemeSelection('turfgrass');
    });
    expect(getThemeSelection()).toBe('hard-court');
    expect(await AsyncStorage.getItem(THEME_SELECTION_KEY)).toBe('hard-court');
  });

  test('an explicit selection wins over an in-flight hydration', async () => {
    await AsyncStorage.setItem(THEME_SELECTION_KEY, 'clay-court');

    let component;
    await act(async () => {
      component = renderer.create(<ThemeProbe />);
      setThemeSelection('grass-court');
    });
    await flush();

    expect(renderedTheme(component)).toBe('grass-court');
  });

  test('theme_selection and appearance_preference use separate storage keys', () => {
    expect(THEME_SELECTION_KEY).toBe('kilo.theme_selection');
    expect(THEME_SELECTION_KEY).not.toBe(APPEARANCE_PREFERENCE_KEY);
  });

  test('appearance preference data cannot be interpreted as theme identity', async () => {
    await AsyncStorage.setItem(THEME_SELECTION_KEY, 'system');

    let component;
    await act(async () => {
      component = renderer.create(<ThemeProbe />);
    });
    await flush();

    expect(renderedTheme(component)).toBe('hard-court');
  });
});

describe('theme selection failure handling', () => {
  beforeEach(() => {
    __resetThemeSelectionForTests();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('a rejected read leaves the default in place without throwing', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValue(new Error('storage down'));

    let component;
    await act(async () => {
      component = renderer.create(<ThemeProbe />);
    });
    await flush();

    expect(renderedTheme(component)).toBe('hard-court');
  });

  test('a read that throws synchronously does not break the subscribing render', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockImplementation(() => {
      throw new Error('adapter exploded');
    });

    let component;
    await act(async () => {
      component = renderer.create(<ThemeProbe />);
    });
    await flush();

    expect(renderedTheme(component)).toBe('hard-court');
  });

  test('a failed write still applies the selection for the session', async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValue(new Error('disk full'));

    await act(async () => {
      await expect(setThemeSelection('clay-court')).resolves.toBeUndefined();
    });

    expect(getThemeSelection()).toBe('clay-court');
  });

  test('a failed write does not corrupt the in-memory selection', async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValue(new Error('disk full'));

    await act(async () => {
      await setThemeSelection('grass-court');
    });

    expect(getThemeSelection()).toBe('grass-court');
    // Subsequent change still works
    await act(async () => {
      await setThemeSelection('clay-court');
    });
    expect(getThemeSelection()).toBe('clay-court');
  });
});

describe('theme selection subscribers', () => {
  beforeEach(() => {
    __resetThemeSelectionForTests();
    AsyncStorage.clear();
  });

  test('a selection notifies subscribers immediately', () => {
    const listener = jest.fn();
    subscribeThemeSelection(listener);
    listener.mockClear();

    setThemeSelection('clay-court');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getThemeSelection()).toBe('clay-court');
  });

  test('re-selecting the current value does not notify', () => {
    setThemeSelection('grass-court');
    const listener = jest.fn();
    subscribeThemeSelection(listener);
    listener.mockClear();

    setThemeSelection('grass-court');

    expect(listener).not.toHaveBeenCalled();
  });

  test('unsubscribing stops notifications', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeThemeSelection(listener);
    unsubscribe();
    listener.mockClear();

    setThemeSelection('clay-court');

    expect(listener).not.toHaveBeenCalled();
  });

  test('a mounted subscriber re-renders on the tick the selection lands', async () => {
    let component;
    await act(async () => {
      component = renderer.create(<ThemeProbe />);
    });
    await flush();
    expect(renderedTheme(component)).toBe('hard-court');

    await act(async () => {
      setThemeSelection('grass-court');
    });

    expect(renderedTheme(component)).toBe('grass-court');
  });
});

describe('theme and appearance independence', () => {
  beforeEach(() => {
    __resetThemeSelectionForTests();
    __resetAppearancePreferenceForTests();
    AsyncStorage.clear();
  });

  test('setting a theme does not change the appearance preference', () => {
    setThemeSelection('clay-court');
    expect(getAppearancePreference()).toBe('system');
  });

  test('setting an appearance does not change the theme selection', () => {
    setAppearancePreference('dark');
    expect(getThemeSelection()).toBe('hard-court');
  });

  test('the two stores use separate listener sets', () => {
    const themeListener = jest.fn();
    const appearanceListener = jest.fn();
    subscribeThemeSelection(themeListener);
    subscribeAppearancePreference(appearanceListener);
    themeListener.mockClear();
    appearanceListener.mockClear();

    setThemeSelection('clay-court');
    expect(themeListener).toHaveBeenCalledTimes(1);
    expect(appearanceListener).not.toHaveBeenCalled();

    setAppearancePreference('dark');
    expect(appearanceListener).toHaveBeenCalledTimes(1);
    expect(themeListener).toHaveBeenCalledTimes(1);
  });
});

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { ThemeProvider, useTheme } from '../theme/ThemeContext';
import { SettingsScreen } from '../components/SettingsScreen';
import {
  __resetAppearancePreferenceForTests,
  __resetThemeSelectionForTests,
  setAppearancePreference,
  setThemeSelection,
  getThemeSelection,
  getAppearancePreference,
} from '../lib/themePreference';
import {
  KUA_PALETTES,
  HardCourtLightColors,
  HardCourtDarkColors,
  ClayCourtLightColors,
  ClayCourtDarkColors,
  GrassCourtLightColors,
  GrassCourtDarkColors,
} from '../theme/colors';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: jest.fn(() => 'light'),
}));

jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: () => null }), { virtual: true });

jest.mock('../hooks/useEntries', () => ({
  useFeatureToggles: () => ({
    fatigueTrackingEnabled: false,
    deloadModeEnabled: false,
    setFatigueTrackingEnabled: jest.fn(),
    setDeloadModeEnabled: jest.fn(),
  }),
  useUserProfile: () => ({ profile: {}, save: jest.fn(), loading: false }),
}));

jest.mock('../components/ReminderSettingsCard', () => ({
  ReminderSettingsCard: () => null,
}));

beforeEach(() => {
  __resetThemeSelectionForTests();
  __resetAppearancePreferenceForTests();
  AsyncStorage.clear();
});

describe('all six theme+appearance combinations', () => {
  const COMBINATIONS = [
    ['hard-court', 'Light', HardCourtLightColors],
    ['hard-court', 'Dark', HardCourtDarkColors],
    ['clay-court', 'Light', ClayCourtLightColors],
    ['clay-court', 'Dark', ClayCourtDarkColors],
    ['grass-court', 'Light', GrassCourtLightColors],
    ['grass-court', 'Dark', GrassCourtDarkColors],
  ];

  function KuaProbe() {
    const { kuaPalette } = useTheme();
    return <Text testID="kua-bg">{kuaPalette.background}</Text>;
  }

  function kuaBg(component) {
    return component.root.findByProps({ testID: 'kua-bg' }).props.children;
  }

  test.each(COMBINATIONS)('%s/%s: kuaPalette resolves to the correct palette', (theme, appLabel, expectedPalette) => {
    const themeSlug = theme;
    const appValue = appLabel.toLowerCase();

    let component;
    act(() => {
      component = renderer.create(
        <ThemeProvider>
          <KuaProbe />
        </ThemeProvider>
      );
    });

    act(() => {
      setThemeSelection(themeSlug);
      setAppearancePreference(appValue);
    });

    expect(kuaBg(component)).toBe(expectedPalette.background);
  });
});

describe('theme/appearance independence in context', () => {
  function ContextProbe() {
    const { themeSelection, preference } = useTheme();
    return <Text testID="probe">{`${themeSelection}/${preference}`}</Text>;
  }

  function reading(component) {
    return component.root.findByProps({ testID: 'probe' }).props.children;
  }

  test('theme and appearance are independently readable from context', () => {
    let component;
    act(() => {
      component = renderer.create(
        <ThemeProvider>
          <ContextProbe />
        </ThemeProvider>
      );
    });

    act(() => {
      setThemeSelection('grass-court');
      setAppearancePreference('dark');
    });

    expect(reading(component)).toBe('grass-court/dark');
  });

  test('changing theme does not change appearance', () => {
    let component;
    act(() => {
      component = renderer.create(
        <ThemeProvider>
          <ContextProbe />
        </ThemeProvider>
      );
    });

    act(() => {
      setAppearancePreference('light');
      setThemeSelection('clay-court');
    });

    expect(reading(component)).toBe('clay-court/light');
  });

  test('changing appearance does not change theme', () => {
    let component;
    act(() => {
      component = renderer.create(
        <ThemeProvider>
          <ContextProbe />
        </ThemeProvider>
      );
    });

    act(() => {
      setThemeSelection('grass-court');
      setAppearancePreference('dark');
    });

    act(() => {
      setAppearancePreference('system');
    });

    expect(reading(component)).toBe('grass-court/system');
  });
});

describe('OTA update scripts carry EXPO_PUBLIC_APP_ENV for preview', () => {
  const pkg = require('../package.json');

  test('update:android:preview includes EXPO_PUBLIC_APP_ENV=preview', () => {
    expect(pkg.scripts['update:android:preview']).toContain('EXPO_PUBLIC_APP_ENV=preview');
  });

  test('update:ios:preview includes EXPO_PUBLIC_APP_ENV=preview', () => {
    expect(pkg.scripts['update:ios:preview']).toContain('EXPO_PUBLIC_APP_ENV=preview');
  });

  test('update:android:production does not include EXPO_PUBLIC_APP_ENV', () => {
    expect(pkg.scripts['update:android:production']).not.toContain('EXPO_PUBLIC_APP_ENV');
  });
});

describe('DEV PREVIEW section removed: Settings never exposes the dev-only picker', () => {
  // The temporary ThemePreviewControl / DEV PREVIEW section was removed in
  // #1136. SettingsScreen no longer gates on EXPO_PUBLIC_APP_ENV for a preview
  // picker — the production court-theme control (ThemeSelectionControl) is shown
  // in all builds instead.
  const _originalPublicAppEnv = process.env.EXPO_PUBLIC_APP_ENV;

  afterEach(() => {
    if (_originalPublicAppEnv === undefined) {
      delete process.env.EXPO_PUBLIC_APP_ENV;
    } else {
      process.env.EXPO_PUBLIC_APP_ENV = _originalPublicAppEnv;
    }
  });

  function renderSettings() {
    let root;
    act(() => {
      root = renderer.create(
        <SettingsScreen onBack={() => {}} multiplier={1.07} onUpdate={() => {}} />
      );
    });
    return root;
  }

  function hasDevPreviewSection(root) {
    return root.root
      .findAllByType(Text)
      .some((n) => n.props.children === 'DEV PREVIEW');
  }

  test('Dev Preview section is absent in preview builds', () => {
    process.env.EXPO_PUBLIC_APP_ENV = 'preview';
    expect(hasDevPreviewSection(renderSettings())).toBe(false);
  });

  test('Dev Preview section is absent in development builds', () => {
    process.env.EXPO_PUBLIC_APP_ENV = 'development';
    expect(hasDevPreviewSection(renderSettings())).toBe(false);
  });

  test('Dev Preview section is absent in production builds', () => {
    process.env.EXPO_PUBLIC_APP_ENV = 'production';
    expect(hasDevPreviewSection(renderSettings())).toBe(false);
  });

  test('Dev Preview section is absent when EXPO_PUBLIC_APP_ENV is unset', () => {
    delete process.env.EXPO_PUBLIC_APP_ENV;
    expect(hasDevPreviewSection(renderSettings())).toBe(false);
  });
});

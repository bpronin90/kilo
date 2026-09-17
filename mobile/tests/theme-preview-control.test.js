import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { ThemeProvider, useTheme } from '../theme/ThemeContext';
import { ThemePreviewControl } from '../components/ThemePreviewControl';
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

function renderControl() {
  let component;
  act(() => {
    component = renderer.create(
      <ThemeProvider>
        <ThemePreviewControl />
      </ThemeProvider>
    );
  });
  return component;
}

function themeButton(component, label) {
  return component.root.findByProps({ accessibilityLabel: `Select ${label} court theme` });
}

function appearanceButton(component, label) {
  return component.root.findByProps({ accessibilityLabel: `Select ${label} appearance` });
}

beforeEach(() => {
  __resetThemeSelectionForTests();
  __resetAppearancePreferenceForTests();
  AsyncStorage.clear();
});

describe('ThemePreviewControl renders all six combinations', () => {
  test('renders theme buttons for Hard, Clay, and Grass', () => {
    const component = renderControl();
    expect(() => themeButton(component, 'Hard')).not.toThrow();
    expect(() => themeButton(component, 'Clay')).not.toThrow();
    expect(() => themeButton(component, 'Grass')).not.toThrow();
  });

  test('renders appearance buttons for Light, Dark, and System', () => {
    const component = renderControl();
    expect(() => appearanceButton(component, 'Light')).not.toThrow();
    expect(() => appearanceButton(component, 'Dark')).not.toThrow();
    expect(() => appearanceButton(component, 'System')).not.toThrow();
  });

  test('Hard Court is selected by default', () => {
    const component = renderControl();
    expect(themeButton(component, 'Hard').props.accessibilityState.selected).toBe(true);
    expect(themeButton(component, 'Clay').props.accessibilityState.selected).toBe(false);
    expect(themeButton(component, 'Grass').props.accessibilityState.selected).toBe(false);
  });

  test('System appearance is selected by default', () => {
    const component = renderControl();
    expect(appearanceButton(component, 'System').props.accessibilityState.selected).toBe(true);
    expect(appearanceButton(component, 'Light').props.accessibilityState.selected).toBe(false);
    expect(appearanceButton(component, 'Dark').props.accessibilityState.selected).toBe(false);
  });

  test('pressing Clay Court switches the theme selection', () => {
    const component = renderControl();

    act(() => {
      themeButton(component, 'Clay').props.onPress();
    });

    expect(themeButton(component, 'Clay').props.accessibilityState.selected).toBe(true);
    expect(themeButton(component, 'Hard').props.accessibilityState.selected).toBe(false);
    expect(getThemeSelection()).toBe('clay-court');
  });

  test('pressing Grass Court switches the theme selection', () => {
    const component = renderControl();

    act(() => {
      themeButton(component, 'Grass').props.onPress();
    });

    expect(themeButton(component, 'Grass').props.accessibilityState.selected).toBe(true);
    expect(getThemeSelection()).toBe('grass-court');
  });

  test('pressing Dark switches the appearance', () => {
    const component = renderControl();

    act(() => {
      appearanceButton(component, 'Dark').props.onPress();
    });

    expect(appearanceButton(component, 'Dark').props.accessibilityState.selected).toBe(true);
    expect(appearanceButton(component, 'System').props.accessibilityState.selected).toBe(false);
    expect(getAppearancePreference()).toBe('dark');
  });

  test('pressing Light switches the appearance', () => {
    const component = renderControl();

    act(() => {
      appearanceButton(component, 'Light').props.onPress();
    });

    expect(appearanceButton(component, 'Light').props.accessibilityState.selected).toBe(true);
    expect(getAppearancePreference()).toBe('light');
  });

  test('pressing System restores system appearance', () => {
    const component = renderControl();

    act(() => {
      appearanceButton(component, 'Dark').props.onPress();
    });
    act(() => {
      appearanceButton(component, 'System').props.onPress();
    });

    expect(appearanceButton(component, 'System').props.accessibilityState.selected).toBe(true);
    expect(getAppearancePreference()).toBe('system');
  });
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

describe('DEV label is present', () => {
  test('the control renders a dev-only label', () => {
    const component = renderControl();
    const texts = component.root
      .findAllByType(require('react-native').Text)
      .map((n) => n.props.children);
    const hasDevLabel = texts.some((t) => typeof t === 'string' && t.includes('DEV'));
    expect(hasDevLabel).toBe(true);
  });
});

describe('EXPO_PUBLIC_APP_ENV gate: SettingsScreen shows Dev Preview only in non-production builds', () => {
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
      .some((n) => n.props.children === 'Dev Preview');
  }

  test('Dev Preview section renders in EAS preview builds', () => {
    process.env.EXPO_PUBLIC_APP_ENV = 'preview';
    expect(hasDevPreviewSection(renderSettings())).toBe(true);
  });

  test('Dev Preview section renders in EAS development builds', () => {
    process.env.EXPO_PUBLIC_APP_ENV = 'development';
    expect(hasDevPreviewSection(renderSettings())).toBe(true);
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

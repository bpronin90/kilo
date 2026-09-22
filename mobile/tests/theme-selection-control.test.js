import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { ThemeProvider } from '../theme/ThemeContext';
import { ThemeSelectionControl } from '../components/ThemeSelectionControl';
import {
  __resetThemeSelectionForTests,
  __resetAppearancePreferenceForTests,
  setAppearancePreference,
  getThemeSelection,
} from '../lib/themePreference';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: jest.fn(() => 'light'),
}));

jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: () => null }), { virtual: true });

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => {}),
  removeItem: jest.fn(async () => {}),
  clear: jest.fn(async () => {}),
}));

function renderControl() {
  let component;
  act(() => {
    component = renderer.create(
      <ThemeProvider>
        <ThemeSelectionControl />
      </ThemeProvider>
    );
  });
  return component;
}

function tabByLabel(component, label) {
  return component.root.findByProps({ accessibilityLabel: label });
}

const MIN_TARGET = 44;

function resolvedStyle(node) {
  const raw = StyleSheet.flatten(node.props.style);
  return raw ?? {};
}

function effectiveSize(node) {
  const s = resolvedStyle(node);
  return {
    minHeight: s.minHeight ?? 0,
    minWidth: s.minWidth ?? 0,
  };
}

beforeEach(() => {
  __resetThemeSelectionForTests();
  __resetAppearancePreferenceForTests();
  AsyncStorage.clear();
});

describe('ThemeSelectionControl renders all court options', () => {
  test('renders Hard Court, Clay Court, and Grass Court options', () => {
    const component = renderControl();
    expect(() => tabByLabel(component, 'Use Hard Court')).not.toThrow();
    expect(() => tabByLabel(component, 'Use Clay Court')).not.toThrow();
    expect(() => tabByLabel(component, 'Use Grass Court')).not.toThrow();
  });

  test('displays full names as visible labels', () => {
    const component = renderControl();
    const texts = component.root
      .findAllByType(require('react-native').Text)
      .map((n) => n.props.children);
    expect(texts).toContain('Hard Court');
    expect(texts).toContain('Clay Court');
    expect(texts).toContain('Grass Court');
  });
});

describe('ThemeSelectionControl default selection', () => {
  test('Hard Court is selected by default', () => {
    const component = renderControl();
    expect(tabByLabel(component, 'Use Hard Court').props.accessibilityState.selected).toBe(true);
    expect(tabByLabel(component, 'Use Clay Court').props.accessibilityState.selected).toBe(false);
    expect(tabByLabel(component, 'Use Grass Court').props.accessibilityState.selected).toBe(false);
  });
});

describe('ThemeSelectionControl selection interaction', () => {
  test('pressing Clay Court selects it and deselects others', () => {
    const component = renderControl();

    act(() => {
      tabByLabel(component, 'Use Clay Court').props.onPress();
    });

    expect(tabByLabel(component, 'Use Clay Court').props.accessibilityState.selected).toBe(true);
    expect(tabByLabel(component, 'Use Hard Court').props.accessibilityState.selected).toBe(false);
    expect(tabByLabel(component, 'Use Grass Court').props.accessibilityState.selected).toBe(false);
    expect(getThemeSelection()).toBe('clay-court');
  });

  test('pressing Grass Court selects it', () => {
    const component = renderControl();

    act(() => {
      tabByLabel(component, 'Use Grass Court').props.onPress();
    });

    expect(tabByLabel(component, 'Use Grass Court').props.accessibilityState.selected).toBe(true);
    expect(getThemeSelection()).toBe('grass-court');
  });

  test('pressing Hard Court after another selection restores Hard Court', () => {
    const component = renderControl();

    act(() => {
      tabByLabel(component, 'Use Clay Court').props.onPress();
    });
    act(() => {
      tabByLabel(component, 'Use Hard Court').props.onPress();
    });

    expect(tabByLabel(component, 'Use Hard Court').props.accessibilityState.selected).toBe(true);
    expect(getThemeSelection()).toBe('hard-court');
  });
});

describe('ThemeSelectionControl accessibility contract', () => {
  test.each(['Use Hard Court', 'Use Clay Court', 'Use Grass Court'])(
    'option "%s" has button role and selected state',
    (label) => {
      const component = renderControl();
      const tab = tabByLabel(component, label);
      expect(tab.props.accessibilityRole).toBe('button');
      expect(tab.props.accessibilityState).toHaveProperty('selected');
    }
  );

  test.each(['Use Hard Court', 'Use Clay Court', 'Use Grass Court'])(
    'option "%s" meets the 44x44dp minimum target',
    (label) => {
      const component = renderControl();
      const tab = tabByLabel(component, label);
      const { minHeight, minWidth } = effectiveSize(tab);
      expect(minHeight).toBeGreaterThanOrEqual(MIN_TARGET);
      expect(minWidth).toBeGreaterThanOrEqual(MIN_TARGET);
    }
  );
});

describe('ThemeSelectionControl does not alter appearance', () => {
  test('changing court theme does not change the appearance preference', () => {
    const component = renderControl();

    act(() => {
      setAppearancePreference('dark');
    });
    act(() => {
      tabByLabel(component, 'Use Clay Court').props.onPress();
    });

    const { getAppearancePreference } = require('../lib/themePreference');
    expect(getAppearancePreference()).toBe('dark');
  });
});

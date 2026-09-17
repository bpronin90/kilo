import React from 'react';
import renderer, { act } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PRMomentBanner } from '../components/PRMomentBanner';
import { ThemeProvider } from '../theme/ThemeContext';
import { KUA_PALETTES } from '../theme/colors';
import {
  setAppearancePreference,
  setThemeSelection,
  __resetAppearancePreferenceForTests,
  __resetThemeSelectionForTests,
} from '../lib/themePreference';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: jest.fn(() => 'light'),
}));

jest.mock('../lib/unitPreference', () => ({
  useWeightUnit: () => 'lb',
}));

test('applies shell clearance to the rendered PR banner', async () => {
  let tree;
  await act(async () => {
    tree = renderer.create(
      <ThemeProvider>
        <PRMomentBanner
          moment={{ weight_value: 225, rep_count: 5 }}
          onDismiss={() => {}}
          style={{ marginBottom: 88 }}
        />
      </ThemeProvider>
    );
  });

  const json = tree.toJSON();
  const style = Object.assign({}, ...json.props.style);
  expect(style.marginBottom).toBe(88);
  act(() => { tree.unmount(); });
});

function flattenStyle(style) {
  if (Array.isArray(style)) return Object.assign({}, ...style.filter(Boolean).map(flattenStyle));
  return style || {};
}

describe('PRMomentBanner KUA token application (#1100)', () => {
  const PALETTE_CASES = [
    ['hard-court', 'light', KUA_PALETTES.hardCourt.light],
    ['hard-court', 'dark', KUA_PALETTES.hardCourt.dark],
    ['clay-court', 'light', KUA_PALETTES.clayCourt.light],
    ['clay-court', 'dark', KUA_PALETTES.clayCourt.dark],
    ['grass-court', 'light', KUA_PALETTES.grassCourt.light],
    ['grass-court', 'dark', KUA_PALETTES.grassCourt.dark],
  ];

  beforeEach(() => {
    __resetThemeSelectionForTests();
    __resetAppearancePreferenceForTests();
    AsyncStorage.clear();
  });

  test.each(PALETTE_CASES)(
    '%s/%s: banner surfaceCard background and success text color',
    (theme, appearance, kua) => {
      let tree;
      act(() => {
        tree = renderer.create(
          <ThemeProvider>
            <PRMomentBanner moment={{ weight_value: 225, rep_count: 5 }} onDismiss={() => {}} />
          </ThemeProvider>
        );
      });
      act(() => {
        setThemeSelection(theme);
        setAppearancePreference(appearance);
      });

      const json = tree.toJSON();
      const bannerStyle = flattenStyle(json.props.style);
      expect(bannerStyle.backgroundColor).toBe(kua.surfaceCard);

      const prText = json.children[0];
      const textStyle = flattenStyle(prText.props.style);
      expect(textStyle.color).toBe(kua.success);

      act(() => { tree.unmount(); });
    }
  );

  test('dismiss callback is preserved (unchanged callbacks)', () => {
    const onDismiss = jest.fn();
    let tree;
    act(() => {
      tree = renderer.create(
        <ThemeProvider>
          <PRMomentBanner moment={{ weight_value: 100, rep_count: 3 }} onDismiss={onDismiss} />
        </ThemeProvider>
      );
    });
    const dismissBtn = tree.root.findAll(n => n.props?.accessibilityLabel === 'Dismiss PR celebration')[0];
    act(() => { dismissBtn.props.onPress(); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    act(() => { tree.unmount(); });
  });
});

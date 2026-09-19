import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Appearance, Text, View, useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  DarkColors,
  LightColors,
  paletteForMode,
  KUA_PALETTES,
  HardCourtLightColors,
  HardCourtDarkColors,
  ClayCourtLightColors,
  ClayCourtDarkColors,
  GrassCourtLightColors,
  GrassCourtDarkColors,
} from '../theme/colors';
import {
  ThemeProvider,
  switchColors,
  useTheme,
  useThemedStyles,
} from '../theme/ThemeContext';
import { Button, Card, LineChart, StatCard } from '../components/UI';
import { SettingsScreen } from '../components/SettingsScreen';
import {
  __resetAppearancePreferenceForTests,
  setAppearancePreference,
} from '../lib/themePreference';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: jest.fn(() => 'light'),
}));

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

const mockUseColorScheme = useColorScheme;

// ---------------------------------------------------------------------------
// WCAG 2.1 relative-luminance contrast. Every token pair asserted here is an
// opaque hex on purpose: filled surfaces and their labels must be measurable
// without compositing assumptions.
// ---------------------------------------------------------------------------
function channel(value) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex) {
  const raw = hex.replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(full.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// `subtleBg` is the one surface role that ships as `rgba(...)`, so text drawn
// on it can only be measured against the composite it actually paints. It is
// always laid over `card`, which is the deepest surface any of these rows sit
// on, so that is the base used here (#908).
// A hex re-expressed as the same color at `alpha`, so a whole-control opacity
// fade can be composited with the same helper as a translucent surface role.
export function withAlpha(hex, alpha) {
  const raw = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(raw.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${alpha})`;
}

export function compositeOver(rgba, baseHex) {
  const parts = rgba.match(/rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/);
  if (!parts) return rgba;
  const alpha = Number(parts[4]);
  const base = baseHex.replace('#', '');
  const channels = [0, 2, 4].map((i) => parseInt(base.slice(i, i + 2), 16));
  return `#${[1, 2, 3]
    .map((i) => Math.round(Number(parts[i]) * alpha + channels[i - 1] * (1 - alpha)))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

function renderInTheme(element) {
  let component;
  act(() => {
    component = renderer.create(<ThemeProvider>{element}</ThemeProvider>);
  });
  return component;
}

function flatten(style) {
  if (Array.isArray(style)) return Object.assign({}, ...style.filter(Boolean).map(flatten));
  return style || {};
}

beforeEach(() => {
  __resetAppearancePreferenceForTests();
  // Cleared so a previous test's persisted selection cannot hydrate into the
  // next render after its act() block has already closed.
  AsyncStorage.clear();
  mockUseColorScheme.mockReturnValue('light');
});

describe('contrast helper sanity', () => {
  test('matches the WCAG reference extremes', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
  });
});

describe('palette token contract', () => {
  test('both palettes keep the brand accent', () => {
    expect(LightColors.accent).toBe('#d98d42');
    expect(DarkColors.accent).toBe('#d98d42');
  });

  test('approved light values are exact', () => {
    expect(LightColors).toMatchObject({
      background: '#f7f2ea',
      card: '#ffffff',
      cardBorder: 'rgba(34,28,23,0.1)',
      text: '#221c17',
      textMuted: '#6b6259',
      textLight: '#faf6f0',
      tabBarBackground: '#201914',
      tabInactive: '#8a8177',
      inputBackground: '#fbf8f3',
      inputBorder: 'rgba(34,28,23,0.16)',
      chipBackground: '#f3ddc0',
      chipText: '#96571c',
      success: '#4a7c44',
      error: '#b03a2e',
      caution: '#c98f1a',
      divider: 'rgba(31,26,23,0.05)',
      subtleBg: 'rgba(34,28,23,0.04)',
      panelBackground: '#ffffff',
    });
  });

  test('approved dark values are exact', () => {
    expect(DarkColors).toMatchObject({
      background: '#100f1a',
      card: '#1e1c2c',
      cardBorder: 'rgba(217,141,66,0.28)',
      text: '#f2f0f7',
      textMuted: '#a29fb3',
      textLight: '#f2f0f7',
      tabBarBackground: '#1e1c2c',
      tabInactive: '#6a6780',
      inputBackground: '#242235',
      inputBorder: 'rgba(217,141,66,0.28)',
      chipBackground: 'rgba(217,141,66,0.32)',
      chipText: '#ffc98a',
      success: '#7ed968',
      error: '#f2705c',
      caution: '#f2b94a',
      divider: 'rgba(255,255,255,0.08)',
      subtleBg: 'rgba(255,255,255,0.06)',
      panelBackground: '#1e1c2c',
    });
  });

  test('both palettes define the same role names', () => {
    expect(Object.keys(DarkColors).sort()).toEqual(Object.keys(LightColors).sort());
  });

  test('dark preserves the deliberate background-to-card elevation jump', () => {
    expect(DarkColors.card).not.toBe(DarkColors.background);
    expect(relativeLuminance(DarkColors.card)).toBeGreaterThan(
      relativeLuminance(DarkColors.background)
    );
  });

  test('dark keeps the supplied brighter direct status colors', () => {
    for (const role of ['success', 'caution', 'error']) {
      expect(relativeLuminance(DarkColors[role])).toBeGreaterThan(
        relativeLuminance(LightColors[role])
      );
    }
  });

  test('dark filled tone surfaces are not the light filled tone values', () => {
    for (const role of ['cardAccentBg', 'cardSuccessBg', 'cardCautionBg', 'cardErrorBg']) {
      expect(DarkColors[role]).not.toBe(LightColors[role]);
    }
  });

  test('paletteForMode maps modes and falls back to light', () => {
    expect(paletteForMode('light')).toBe(LightColors);
    expect(paletteForMode('dark')).toBe(DarkColors);
    expect(paletteForMode('nonsense')).toBe(LightColors);
    expect(paletteForMode(undefined)).toBe(LightColors);
  });
});

describe('accessible contrast of themed pairs', () => {
  const modes = [
    ['light', LightColors],
    ['dark', DarkColors],
  ];

  test.each(modes)('%s: filled tone surfaces carry textLight at 4.5:1', (_mode, colors) => {
    for (const surface of ['cardAccentBg', 'cardSuccessBg', 'cardCautionBg', 'cardErrorBg']) {
      expect(contrastRatio(colors[surface], colors.textLight)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test.each(modes)('%s: the shared Button label clears 4.5:1 on its pill', (_mode, colors) => {
    expect(contrastRatio(colors.text, colors.buttonLabel)).toBeGreaterThanOrEqual(4.5);
  });

  test('the Button inverts between modes rather than repeating one pairing', () => {
    // Light: dark pill / light label. Dark: light pill / dark label.
    expect(relativeLuminance(LightColors.text)).toBeLessThan(relativeLuminance(LightColors.buttonLabel));
    expect(relativeLuminance(DarkColors.text)).toBeGreaterThan(relativeLuminance(DarkColors.buttonLabel));
  });

  test.each(modes)('%s: tinted status surfaces clear 4.5:1 with their ink', (_mode, colors) => {
    expect(contrastRatio(colors.errorSurface, colors.error)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.cautionSurface, colors.cautionSurfaceText)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.roughBackground, colors.chipText)).toBeGreaterThanOrEqual(4.5);
  });

  test.each(modes)('%s: body and muted text clear 4.5:1 on background and card', (_mode, colors) => {
    expect(contrastRatio(colors.background, colors.text)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.card, colors.text)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.card, colors.textMuted)).toBeGreaterThanOrEqual(4.5);
  });

  test('dark direct status colors stay legible on the dark card', () => {
    for (const role of ['success', 'caution', 'error', 'accent']) {
      expect(contrastRatio(DarkColors.card, DarkColors[role])).toBeGreaterThanOrEqual(4.5);
    }
  });

  test.each(modes)('%s: on-accent ink clears 4.5:1 against the accent fill', (_mode, colors) => {
    expect(contrastRatio(colors.accent, colors.onAccent)).toBeGreaterThanOrEqual(4.5);
  });

  // #908: `accent`/`caution` are mark colors and fail AA as light-mode copy
  // (2.68:1 and 2.83:1 on `card`). `accentText`/`cautionText` are the inks any
  // readable accent or caution string uses instead.
  //
  // These are every surface accent or caution copy actually lands on. Pressed
  // states count: the weight history row, its `Load more` row, and the delete
  // affordance all swap to `chipBackground` while held (#915 review).
  function textSurfaces(colors) {
    return {
      card: colors.card,
      background: colors.background,
      subtleBg: compositeOver(colors.subtleBg, colors.card),
      chipBackground: compositeOver(colors.chipBackground, colors.card),
    };
  }

  test.each(modes)('%s: caution text ink clears 4.5:1 on every surface it lands on', (_mode, colors) => {
    for (const [name, surface] of Object.entries(textSurfaces(colors))) {
      expect({ name, ok: contrastRatio(surface, colors.cautionText) >= 4.5 })
        .toEqual({ name, ok: true });
    }
  });

  test('light: accent text ink clears 4.5:1 on every surface it lands on', () => {
    for (const [name, surface] of Object.entries(textSurfaces(LightColors))) {
      expect({ name, ok: contrastRatio(surface, LightColors.accentText) >= 4.5 })
        .toEqual({ name, ok: true });
    }
  });

  // `chipBackground` is excluded on purpose: since #918 and #923 no shipping
  // surface puts `accentText` on a chip fill in any state, so the pairing is
  // unused rather than tolerated. `chipAccentText` is the ink there.
  test('dark: accent text ink clears 4.5:1 on card, background, and subtleBg', () => {
    const { chipBackground, ...surfaces } = textSurfaces(DarkColors);
    for (const [name, surface] of Object.entries(surfaces)) {
      expect({ name, ok: contrastRatio(surface, DarkColors.accentText) >= 4.5 })
        .toEqual({ name, ok: true });
    }
  });

  // #915 review: a whole-control `opacity` composites the label *and* its fill
  // over what is behind them, so a pressed row can fade an ink that clears AA
  // at rest below it. This pins the arithmetic that removed the 0.8 fade from
  // `historyRowPressed`/`loadMorePressed` — reintroducing one is not a small
  // visual tweak. It still holds for `loadMoreText` after #923 moved it to
  // `chipAccentText`: light mode's `chipAccentText` is `accentText`'s own value,
  // so the faded light pairing measured here is that label's exactly.
  test.each(modes)('%s: an 0.8 pressed fade would drop accent copy under AA', (_mode, colors) => {
    const chip = compositeOver(colors.chipBackground, colors.card);
    const fade = (hex) => compositeOver(withAlpha(hex, 0.8), colors.card);
    const atRest = contrastRatio(chip, colors.accentText);
    const pressed = contrastRatio(fade(chip), fade(colors.accentText));
    expect(pressed).toBeLessThan(atRest);
    expect(pressed).toBeLessThan(4.5);
  });

  test('light accent copy on a chip clears AA at rest, which the fade undid', () => {
    const chip = LightColors.chipBackground;
    const fade = (hex) => compositeOver(withAlpha(hex, 0.8), LightColors.card);
    expect(contrastRatio(chip, LightColors.accentText)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(fade(chip), fade(LightColors.accentText))).toBeCloseTo(3.4, 1);
  });

  // Repurposed from the retired #908 gap note (#923). Dark `chipBackground` is
  // the accent itself at 32% over `card`, so `accentText` on it is inherently
  // low-contrast. That is no longer a tolerated gap — it is the reason
  // `chipAccentText` exists and the reason no shipping surface pairs the two.
  // The number stays pinned so the shortfall cannot quietly widen, and so a
  // future author reaching for `accentText` on a chip sees why not.
  test('accentText is measurably unfit for the dark chip fill', () => {
    const chip = compositeOver(DarkColors.chipBackground, DarkColors.card);
    expect(contrastRatio(chip, DarkColors.accentText)).toBeCloseTo(3.54, 2);
    expect(contrastRatio(chip, DarkColors.chipAccentText)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(chip, DarkColors.chipText)).toBeGreaterThanOrEqual(4.5);
  });

  // #918: Log, its modals, and `WorkoutSubheading` moved every accent-colored
  // string off the mark value. Strings that stay clear of the chip fill take
  // `accentText`; the seven that can land on `chipBackground` in some state
  // take `chipAccentText`, which is the ink that clears AA on that fill in
  // *both* modes — the gap pinned directly above is why `accentText` cannot.
  test.each(modes)('%s: chip accent text ink clears 4.5:1 on every surface, chip fill included', (_mode, colors) => {
    for (const [name, surface] of Object.entries(textSurfaces(colors))) {
      expect({ name, ok: contrastRatio(surface, colors.chipAccentText) >= 4.5 })
        .toEqual({ name, ok: true });
    }
  });

  test('chipAccentText clears the chip fill by a recorded margin in both modes', () => {
    expect(contrastRatio(LightColors.chipBackground, LightColors.chipAccentText))
      .toBeCloseTo(5.00, 2);
    expect(contrastRatio(
      compositeOver(DarkColors.chipBackground, DarkColors.card),
      DarkColors.chipAccentText,
    )).toBeCloseTo(6.31, 2);
  });

  // No new color was invented: each half is an already-approved #689/#908
  // value, recombined so one role name clears AA on the chip in both modes.
  test('chipAccentText recombines approved values rather than adding one', () => {
    expect(LightColors.chipAccentText).toBe(LightColors.accentText);
    expect(DarkColors.chipAccentText).toBe(DarkColors.chipText);
  });

  // The two dual-surface strings (#918): `modeToggleText` renders on the
  // `modeToggle` chip fill and, as `modeToggleOutline`, transparent over
  // `background`; `optionCurrent` renders on `optionRow`'s `background` and on
  // `optionRowSelected`'s `chipBackground`. Both must clear AA on both.
  test.each(modes)('%s: the dual-surface accent strings clear AA on both of their surfaces', (_mode, colors) => {
    const chip = compositeOver(colors.chipBackground, colors.card);
    expect(contrastRatio(chip, colors.chipAccentText)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.background, colors.chipAccentText)).toBeGreaterThanOrEqual(4.5);
  });

  // #923: the five surfaces outside the Log tab that still put accent copy on a
  // chip fill — Settings' stepper glyphs and Recovery's `Retry recovery` always,
  // the Big 3 slot picker's selected row and the weight history `Load more` row
  // only in their triggering state, and Home's sync-notice actions. All five now
  // take `chipAccentText`, which clears the composited chip fill in both modes.
  test.each(modes)('%s: chip-filled accent copy clears AA on the composited chip fill', (_mode, colors) => {
    const chip = compositeOver(colors.chipBackground, colors.card);
    expect(contrastRatio(chip, colors.chipAccentText)).toBeGreaterThanOrEqual(4.5);
  });

  // Home's sync notice is the one dual-fill site: `syncNoticeCard` is
  // `chipBackground` while a sync is pending and `syncNoticeCardFailed` swaps to
  // `errorSurface`, with the same action label on both. One ink covers both —
  // measured rather than assumed, since `errorSurface` is paired with `error`.
  test('the sync-notice action ink clears AA on both of its fills, in both modes', () => {
    expect(contrastRatio(LightColors.chipBackground, LightColors.chipAccentText))
      .toBeCloseTo(5.00, 2);
    expect(contrastRatio(LightColors.errorSurface, LightColors.chipAccentText))
      .toBeCloseTo(5.78, 2);
    expect(contrastRatio(
      compositeOver(DarkColors.chipBackground, DarkColors.card),
      DarkColors.chipAccentText,
    )).toBeCloseTo(6.31, 2);
    expect(contrastRatio(DarkColors.errorSurface, DarkColors.chipAccentText))
      .toBeCloseTo(10.03, 2);
  });

  test('the light text inks are darker than the mark colors they replace', () => {
    expect(relativeLuminance(LightColors.accentText))
      .toBeLessThan(relativeLuminance(LightColors.accent));
    expect(relativeLuminance(LightColors.cautionText))
      .toBeLessThan(relativeLuminance(LightColors.caution));
  });

  test('dark already cleared AA, so its text inks keep the direct mark values', () => {
    expect(DarkColors.accentText).toBe(DarkColors.accent);
    expect(DarkColors.cautionText).toBe(DarkColors.caution);
  });
});

describe('provider resolution', () => {
  function ModeProbe() {
    const { mode, preference, colors } = useTheme();
    return <Text>{`${preference}/${mode}/${colors.background}`}</Text>;
  }

  function readProbe(component) {
    return component.root.findByType(Text).props.children;
  }

  test('system mode follows the initial OS scheme', () => {
    mockUseColorScheme.mockReturnValue('dark');
    const component = renderInTheme(<ModeProbe />);
    expect(readProbe(component)).toBe(`system/dark/${DarkColors.background}`);
  });

  test('system mode reacts to a live OS scheme change without a reload', () => {
    const component = renderInTheme(<ModeProbe />);
    expect(readProbe(component)).toBe(`system/light/${LightColors.background}`);

    act(() => {
      mockUseColorScheme.mockReturnValue('dark');
      component.update(
        <ThemeProvider>
          <ModeProbe />
        </ThemeProvider>
      );
    });

    expect(readProbe(component)).toBe(`system/dark/${DarkColors.background}`);
  });

  test('an explicit dark selection overrides a light OS scheme immediately', () => {
    const component = renderInTheme(<ModeProbe />);
    expect(readProbe(component)).toBe(`system/light/${LightColors.background}`);

    act(() => {
      setAppearancePreference('dark');
    });

    expect(readProbe(component)).toBe(`dark/dark/${DarkColors.background}`);
  });

  test('an explicit light selection overrides a dark OS scheme', () => {
    mockUseColorScheme.mockReturnValue('dark');
    const component = renderInTheme(<ModeProbe />);
    expect(readProbe(component)).toBe(`system/dark/${DarkColors.background}`);

    act(() => {
      setAppearancePreference('light');
    });

    expect(readProbe(component)).toBe(`light/light/${LightColors.background}`);
  });
});

describe('themed styles repaint without a reload', () => {
  const createStyles = (colors) => ({
    box: { backgroundColor: colors.background, color: colors.text },
  });

  function StyledProbe() {
    const styles = useThemedStyles(createStyles);
    return <View testID="box" style={styles.box} />;
  }

  function boxStyle(component) {
    return flatten(component.root.findByProps({ testID: 'box' }).props.style);
  }

  test('a preference change re-renders every mounted style consumer', () => {
    const component = renderInTheme(<StyledProbe />);
    expect(boxStyle(component).backgroundColor).toBe(LightColors.background);

    act(() => {
      setAppearancePreference('dark');
    });

    expect(boxStyle(component).backgroundColor).toBe(DarkColors.background);
  });

  test('the same factory and palette reuse one registered sheet', () => {
    const factory = jest.fn((colors) => ({ box: { color: colors.text } }));
    function CountingProbe() {
      useThemedStyles(factory);
      return null;
    }
    act(() => {
      renderer.create(
        <ThemeProvider>
          <CountingProbe />
          <CountingProbe />
          <CountingProbe />
        </ThemeProvider>
      );
    });
    expect(factory).toHaveBeenCalledTimes(1);
  });
});

describe('shared primitives switch palettes', () => {
  test('Button background and label track the active palette', () => {
    let component;
    act(() => {
      component = renderer.create(
        <ThemeProvider>
          <Button title="Save" onPress={() => {}} />
        </ThemeProvider>
      );
    });

    const readPair = () => {
      const pressable = component.root.find(
        (n) => n.props && n.props.accessibilityRole === 'button'
      );
      const label = component.root.findByType(Text);
      return {
        background: flatten(pressable.props.style).backgroundColor,
        color: flatten(label.props.style).color,
      };
    };

    expect(readPair()).toEqual({
      background: LightColors.text,
      color: LightColors.buttonLabel,
    });

    act(() => {
      setAppearancePreference('dark');
    });

    expect(readPair()).toEqual({
      background: DarkColors.text,
      color: DarkColors.buttonLabel,
    });
  });

  test('ordinary Cards keep a uniform 1px cardBorder in both modes', () => {
    let component;
    act(() => {
      component = renderer.create(
        <ThemeProvider>
          <Card>
            <Text>body</Text>
          </Card>
        </ThemeProvider>
      );
    });

    const cardStyle = () => flatten(component.root.findByType(View).props.style);

    expect(cardStyle()).toMatchObject({
      borderWidth: 1,
      borderColor: LightColors.cardBorder,
    });

    act(() => {
      setAppearancePreference('dark');
    });

    // Dark's cardBorder is the accent-tinted value, applied uniformly.
    expect(cardStyle()).toMatchObject({
      borderWidth: 1,
      borderColor: DarkColors.cardBorder,
    });
    expect(DarkColors.cardBorder).toContain('217,141,66');
  });

  test('filled StatCard tones use the mode-specific surface, not the direct status color', () => {
    let component;
    act(() => {
      component = renderer.create(
        <ThemeProvider>
          <StatCard label="Sessions" value="9" tone="warn" />
        </ThemeProvider>
      );
    });

    const surface = () => flatten(component.root.findByType(View).props.style).backgroundColor;

    expect(surface()).toBe(LightColors.cardCautionBg);

    act(() => {
      setAppearancePreference('dark');
    });

    expect(surface()).toBe(DarkColors.cardCautionBg);
    expect(surface()).not.toBe(DarkColors.caution);
  });
});

// Regression: a themed default must never be written as a parameter default.
// Parameter initializers evaluate before the function body, so `colors.accent`
// in a signature resolves the body-scoped `colors` binding inside its temporal
// dead zone and throws for every caller that omits the prop — which is the
// common case for both Analytics charts.
describe('themed prop defaults resolve after the theme is read', () => {
  const series = [
    { value: 180, label: 'Mon' },
    { value: 181, label: 'Tue' },
    { value: 179, label: 'Wed' },
  ];

  function strokes(component) {
    return component.root
      .findAll((n) => n.props && n.props.stroke !== undefined)
      .map((n) => n.props.stroke);
  }

  // The chart gates its SVG children on a measured width, which onLayout only
  // supplies on a real host. Feed it one so the marks actually render.
  function mountChart(props = {}) {
    let component;
    act(() => {
      component = renderer.create(
        <ThemeProvider>
          <LineChart data={series} {...props} />
        </ThemeProvider>
      );
    });
    act(() => {
      component.root
        .findAll((n) => n.props && typeof n.props.onLayout === 'function')[0]
        .props.onLayout({ nativeEvent: { layout: { width: 300 } } });
    });
    return component;
  }

  test('LineChart renders with no color prop and falls back to kua.primary', () => {
    let component;
    expect(() => {
      component = mountChart();
    }).not.toThrow();

    expect(strokes(component)).toContain(HardCourtLightColors.primary);
    expect(strokes(component).every((s) => s !== undefined)).toBe(true);
  });

  test('an omitted color follows a palette change instead of freezing', () => {
    const component = mountChart();

    act(() => {
      setAppearancePreference('dark');
    });

    expect(strokes(component)).toContain(HardCourtDarkColors.primary);
    expect(strokes(component).every((s) => s !== undefined)).toBe(true);
  });

  test('an explicit color still wins over the accent fallback', () => {
    const component = mountChart({ color: '#123456' });

    expect(strokes(component)).toContain('#123456');
    expect(strokes(component)).not.toContain(LightColors.accent);
  });

  test('no component declares a themed parameter default anywhere', () => {
    const fs = require('fs');
    const path = require('path');
    const parser = require('@babel/parser');
    const traverseMod = require('@babel/traverse');
    const traverse = traverseMod.default || traverseMod;

    const root = path.join(__dirname, '..');
    function walk(dir, acc = []) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, acc);
        else if (entry.name.endsWith('.js')) acc.push(full);
      }
      return acc;
    }

    const files = [
      path.join(root, 'App.js'),
      ...walk(path.join(root, 'components')),
      ...walk(path.join(root, 'screens')),
    ];

    const hazards = [];
    for (const file of files) {
      const ast = parser.parse(fs.readFileSync(file, 'utf8'), {
        sourceType: 'module',
        plugins: ['jsx'],
      });
      traverse(ast, {
        Function(p) {
          const bodyStart = p.node.body.start;
          p.get('params').forEach((param) => {
            param.traverse({
              ReferencedIdentifier(ref) {
                const binding = p.scope.getBinding(ref.node.name);
                // Referenced in the signature, declared in the body: TDZ.
                if (binding && binding.path.node.start > bodyStart) {
                  hazards.push(
                    `${path.relative(root, file)}:${ref.node.loc.start.line} ${ref.node.name}`
                  );
                }
              },
            });
          });
        },
      });
    }

    expect(hazards).toEqual([]);
  });
});

// Structural guard. A screen can only get stranded on a stale palette in two
// ways: by importing a static palette object, or by holding a module-scope
// StyleSheet.create() that captured colors at import time. Asserting neither
// exists proves "no surface requires a reload" for every production file at
// once, including ones with no render test of their own.
describe('no production surface can hold a stale palette', () => {
  const fs = require('fs');
  const path = require('path');

  function sources(dir, acc = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) sources(full, acc);
      else if (entry.name.endsWith('.js')) acc.push(full);
    }
    return acc;
  }

  const root = path.join(__dirname, '..');
  const files = [
    path.join(root, 'App.js'),
    ...sources(path.join(root, 'components')),
    ...sources(path.join(root, 'screens')),
  ];

  test('covers the whole production UI tree', () => {
    expect(files.length).toBeGreaterThan(40);
  });

  test('no production file imports a static Colors object', () => {
    const offenders = files.filter((f) =>
      /import\s*\{[^}]*\bColors\b[^}]*\}\s*from/.test(fs.readFileSync(f, 'utf8'))
    );
    expect(offenders.map((f) => path.relative(root, f))).toEqual([]);
  });

  test('no production file builds a StyleSheet at module scope', () => {
    const offenders = files.filter((f) =>
      /^const\s+\w+\s*=\s*StyleSheet\.create\(/m.test(fs.readFileSync(f, 'utf8'))
    );
    expect(offenders.map((f) => path.relative(root, f))).toEqual([]);
  });

  // #915 review: a `Pressed` style that sets a whole-control `opacity` fades
  // the control's own label along with its fill, so a label that clears AA
  // unpressed can drop under it while held. Press feedback belongs in the fill
  // alone. Allowlisted offenders must have no accent/caution ink inside them.
  test('no pressed style fades its own label except the allowlisted one', () => {
    const offenders = [];
    for (const f of files) {
      const source = fs.readFileSync(f, 'utf8');
      for (const [, name, body] of source.matchAll(/(\w*[Pp]ressed)\s*:\s*\{([^}]*)\}/g)) {
        if (/\bopacity\s*:/.test(body)) offenders.push(`${path.relative(root, f)} ${name}`);
      }
    }
    // Its only child is a muted glyph already drawn at 0.5 opacity by design —
    // no accent or caution ink is inside it, so the fade cannot cross AA.
    expect(offenders).toEqual(['components/WeightHistoryList.js deleteAffordancePressed']);
  });

  test('the Kilo wordmark accent is the only hardcoded color left', () => {
    const leaks = [];
    for (const f of files) {
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const matches = line.match(/'#[0-9a-fA-F]{3,8}'|"#[0-9a-fA-F]{3,8}"|rgba?\([\d.,\s]+\)/g);
        if (matches) leaks.push(`${path.relative(root, f)}:${i + 1} ${matches.join(' ')}`);
      });
    }
    // Sanctioned exceptions:
    // - The two brand-orange wordmark accents (HomeScreen) and the dev-only
    //   ThemePreviewControl use the Kilo brand color that has no palette token.
    // - The four `scrim()` helper lines are the KUA-spec overlay backdrop values
    //   (rgba(0,0,0,0.5) light / rgba(0,0,0,0.7) dark per components.md). They
    //   cannot be routed through the KUA palette without modifying colors.js, and
    //   each appears only inside its own component's createStyles factory rather
    //   than as a top-level constant, which keeps the values co-located with the
    //   overlay they style.
    expect(leaks).toEqual([
      "components/RecoveryBlockEndModal.js:243 rgba(0,0,0,0.7) rgba(0,0,0,0.5)",
      "components/RecoveryBlockStartModal.js:326 rgba(0,0,0,0.7) rgba(0,0,0,0.5)",
      "components/RecoveryBlockWeekModal.js:209 rgba(0,0,0,0.7) rgba(0,0,0,0.5)",
      "components/SessionCheckInModal.js:374 rgba(0,0,0,0.7) rgba(0,0,0,0.5)",
      "components/ThemePreviewControl.js:70 '#FF5C00'",
      'screens/HomeScreen.js:42 "#FF5C00"',
      'screens/HomeScreen.js:46 "#FF5C00"',
    ]);
  });
});

describe('Settings Appearance control', () => {
  function renderSettings() {
    let component;
    act(() => {
      component = renderer.create(
        <ThemeProvider>
          <SettingsScreen
            onBack={() => {}}
            multiplier={1.07}
            onUpdate={() => {}}
            weightDateEditEnabled={false}
            onUpdateWeightDateEditEnabled={() => {}}
            deloadDateEditEnabled={false}
            onUpdateDeloadDateEditEnabled={() => {}}
          />
        </ThemeProvider>
      );
    });
    return component;
  }

  const LABELS = {
    light: 'Use the light appearance',
    dark: 'Use the dark appearance',
    system: 'Follow the device appearance',
  };

  function option(component, key) {
    return component.root.findByProps({ accessibilityLabel: LABELS[key] });
  }

  test('exposes exactly three options with an Appearance section', () => {
    const component = renderSettings();
    const headings = component.root
      .findAllByType(Text)
      .map((n) => n.props.children)
      .filter((c) => typeof c === 'string');
    expect(headings).toContain('Appearance');
    expect(headings).toContain('Light');
    expect(headings).toContain('Dark');
    expect(headings).toContain('System');
  });

  test('reports selected and disabled accessibility state truthfully', () => {
    const component = renderSettings();

    expect(option(component, 'system').props.accessibilityState).toEqual({
      selected: true,
      disabled: false,
    });
    expect(option(component, 'light').props.accessibilityState.selected).toBe(false);
    expect(option(component, 'dark').props.accessibilityState.selected).toBe(false);
    for (const key of ['light', 'dark', 'system']) {
      expect(option(component, key).props.accessibilityRole).toBe('button');
    }
  });

  test('selecting Dark persists the preference and moves the selected state', () => {
    const component = renderSettings();

    act(() => {
      option(component, 'dark').props.onPress();
    });

    expect(option(component, 'dark').props.accessibilityState.selected).toBe(true);
    expect(option(component, 'system').props.accessibilityState.selected).toBe(false);
  });

  test('selecting Dark repaints the Settings surface itself', () => {
    const component = renderSettings();
    const labelColor = () => {
      const themeLabel = component.root
        .findAllByType(Text)
        .find((n) => n.props.children === 'Theme');
      return flatten(themeLabel.props.style).color;
    };

    expect(labelColor()).toBe(LightColors.text);

    act(() => {
      option(component, 'dark').props.onPress();
    });

    expect(labelColor()).toBe(DarkColors.text);
  });

  test('selecting Light after Dark returns the app to the light palette', () => {
    const component = renderSettings();

    act(() => {
      option(component, 'dark').props.onPress();
    });
    act(() => {
      option(component, 'light').props.onPress();
    });

    expect(option(component, 'light').props.accessibilityState.selected).toBe(true);
  });

  // #934 — Fatigue tracking and Deload mode default OFF, but both stay
  // discoverable as ordinary Settings switches with no nag or prompt.
  test('keeps the Fatigue tracking and Deload mode switches discoverable and off by default', () => {
    const component = renderSettings();

    const fatigue = component.root.findByProps({ accessibilityLabel: 'Fatigue tracking' });
    const deload = component.root.findByProps({ accessibilityLabel: 'Deload mode' });

    expect(fatigue.props.value).toBe(false);
    expect(deload.props.value).toBe(false);
    expect(typeof fatigue.props.onValueChange).toBe('function');
    expect(typeof deload.props.onValueChange).toBe('function');
  });
});

describe('native appearance reconciliation (#985)', () => {
  let setColorScheme;

  beforeEach(() => {
    setColorScheme = jest
      .spyOn(Appearance, 'setColorScheme')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    setColorScheme.mockRestore();
  });

  test('an explicit selection pins the native scheme', () => {
    renderInTheme(<Text>probe</Text>);
    // System default on mount hands control back to the OS.
    expect(setColorScheme).toHaveBeenLastCalledWith(null);

    act(() => {
      setAppearancePreference('dark');
    });
    expect(setColorScheme).toHaveBeenLastCalledWith('dark');

    act(() => {
      setAppearancePreference('light');
    });
    expect(setColorScheme).toHaveBeenLastCalledWith('light');
  });

  test('returning to System unpins the native scheme', () => {
    renderInTheme(<Text>probe</Text>);
    act(() => {
      setAppearancePreference('dark');
    });
    expect(setColorScheme).toHaveBeenLastCalledWith('dark');

    act(() => {
      setAppearancePreference('system');
    });
    expect(setColorScheme).toHaveBeenLastCalledWith(null);
  });

  test('a live OS scheme change under System does not re-pin', () => {
    renderInTheme(<Text>probe</Text>);
    setColorScheme.mockClear();

    act(() => {
      mockUseColorScheme.mockReturnValue('dark');
      renderInTheme(<Text>probe</Text>);
    });

    // The effect only depends on the preference, so an OS-driven repaint under
    // System never calls setColorScheme again with a concrete value.
    for (const call of setColorScheme.mock.calls) {
      expect(call[0]).toBe(null);
    }
  });
});

describe('switchColors token mapping (#985)', () => {
  test('an idle switch uses the accent for the on track', () => {
    const c = switchColors(LightColors);
    expect(c.trackColor.true).toBe(LightColors.accent);
    expect(c.trackColor.false).toBe(LightColors.tabInactive);
    expect(c.thumbColor).toBe(LightColors.textLight);
    expect(c.ios_backgroundColor).toBe(LightColors.tabInactive);
  });

  test('disabled or busy mutes the on track off the accent', () => {
    expect(switchColors(DarkColors, { disabled: true }).trackColor.true).toBe(
      DarkColors.textMuted
    );
    expect(switchColors(DarkColors, { busy: true }).trackColor.true).toBe(
      DarkColors.textMuted
    );
    expect(switchColors(DarkColors).trackColor.true).toBe(DarkColors.accent);
  });

  test('every returned value is a real palette token', () => {
    for (const palette of [LightColors, DarkColors]) {
      const values = Object.values(palette);
      const c = switchColors(palette, { disabled: true });
      for (const v of [
        c.trackColor.true,
        c.trackColor.false,
        c.thumbColor,
        c.ios_backgroundColor,
      ]) {
        expect(values).toContain(v);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// KUA typography token contract (#1097)
// Source: docs/design/kinetic-utilitarian-athletic/foundation.md
// ---------------------------------------------------------------------------

import {
  TYPOGRAPHY,
  TYPOGRAPHY_FALLBACK,
  FONT_ASSETS,
  FONT_SPACE_GROTESK,
  FONT_JETBRAINS_MONO,
  useKuaTypography,
} from '../theme/typography';

const SG_ROLES = [
  'headline-xl',
  'headline-xl-mobile',
  'headline-lg',
  'headline-md',
  'headline-sm',
  'body-lg',
  'body-md',
  'body-sm',
];

const JBM_ROLES = [
  'metric-display',
  'metric-display-mobile',
  'label-lg',
  'label-md',
  'label-sm',
];

describe('KUA typography token contract', () => {
  test('exports all 13 role tokens', () => {
    const roles = Object.keys(TYPOGRAPHY);
    expect(roles).toHaveLength(13);
    for (const role of [...SG_ROLES, ...JBM_ROLES]) {
      expect(roles).toContain(role);
    }
  });

  test('Space Grotesk roles carry exact sizes from foundation.md', () => {
    expect(TYPOGRAPHY['headline-xl'].fontSize).toBe(40);
    expect(TYPOGRAPHY['headline-xl-mobile'].fontSize).toBe(32);
    expect(TYPOGRAPHY['headline-lg'].fontSize).toBe(28);
    expect(TYPOGRAPHY['headline-md'].fontSize).toBe(22);
    expect(TYPOGRAPHY['headline-sm'].fontSize).toBe(18);
    expect(TYPOGRAPHY['body-lg'].fontSize).toBe(16);
    expect(TYPOGRAPHY['body-md'].fontSize).toBe(14);
    expect(TYPOGRAPHY['body-sm'].fontSize).toBe(13);
  });

  test('Space Grotesk roles carry exact line heights from foundation.md', () => {
    expect(TYPOGRAPHY['headline-xl'].lineHeight).toBe(44);
    expect(TYPOGRAPHY['headline-xl-mobile'].lineHeight).toBe(36);
    expect(TYPOGRAPHY['headline-lg'].lineHeight).toBe(32);
    expect(TYPOGRAPHY['headline-md'].lineHeight).toBe(28);
    expect(TYPOGRAPHY['headline-sm'].lineHeight).toBe(24);
    expect(TYPOGRAPHY['body-lg'].lineHeight).toBe(24);
    expect(TYPOGRAPHY['body-md'].lineHeight).toBe(20);
    expect(TYPOGRAPHY['body-sm'].lineHeight).toBe(18);
  });

  test('Space Grotesk roles use weight-specific family names matching foundation.md', () => {
    // fontWeight is omitted to prevent web synthesis; the family name encodes weight.
    expect(TYPOGRAPHY['headline-xl'].fontFamily).toBe('SpaceGrotesk-Bold');
    expect(TYPOGRAPHY['headline-xl-mobile'].fontFamily).toBe('SpaceGrotesk-Bold');
    expect(TYPOGRAPHY['headline-lg'].fontFamily).toBe('SpaceGrotesk-SemiBold');
    expect(TYPOGRAPHY['headline-md'].fontFamily).toBe('SpaceGrotesk-SemiBold');
    expect(TYPOGRAPHY['headline-sm'].fontFamily).toBe('SpaceGrotesk-SemiBold');
    expect(TYPOGRAPHY['body-lg'].fontFamily).toBe('SpaceGrotesk-Regular');
    expect(TYPOGRAPHY['body-md'].fontFamily).toBe('SpaceGrotesk-Regular');
    expect(TYPOGRAPHY['body-sm'].fontFamily).toBe('SpaceGrotesk-Regular');
    for (const role of SG_ROLES) {
      expect(TYPOGRAPHY[role].fontWeight).toBeUndefined();
    }
  });

  test('JetBrains Mono roles carry exact sizes from foundation.md', () => {
    expect(TYPOGRAPHY['metric-display'].fontSize).toBe(36);
    expect(TYPOGRAPHY['metric-display-mobile'].fontSize).toBe(28);
    expect(TYPOGRAPHY['label-lg'].fontSize).toBe(14);
    expect(TYPOGRAPHY['label-md'].fontSize).toBe(12);
    expect(TYPOGRAPHY['label-sm'].fontSize).toBe(11);
  });

  test('JetBrains Mono roles carry exact line heights from foundation.md', () => {
    expect(TYPOGRAPHY['metric-display'].lineHeight).toBe(40);
    expect(TYPOGRAPHY['metric-display-mobile'].lineHeight).toBe(32);
    expect(TYPOGRAPHY['label-lg'].lineHeight).toBe(20);
    expect(TYPOGRAPHY['label-md'].lineHeight).toBe(16);
    expect(TYPOGRAPHY['label-sm'].lineHeight).toBe(14);
  });

  test('JetBrains Mono roles use weight-specific family names matching foundation.md', () => {
    // fontWeight is omitted to prevent web synthesis; the family name encodes weight.
    expect(TYPOGRAPHY['metric-display'].fontFamily).toBe('JetBrainsMono-Bold');
    expect(TYPOGRAPHY['metric-display-mobile'].fontFamily).toBe('JetBrainsMono-Bold');
    expect(TYPOGRAPHY['label-lg'].fontFamily).toBe('JetBrainsMono-SemiBold');
    expect(TYPOGRAPHY['label-md'].fontFamily).toBe('JetBrainsMono-Medium');
    expect(TYPOGRAPHY['label-sm'].fontFamily).toBe('JetBrainsMono-Medium');
    for (const role of JBM_ROLES) {
      expect(TYPOGRAPHY[role].fontWeight).toBeUndefined();
    }
  });

  test('metric and label roles carry tabular-nums for stable layout during live logging', () => {
    for (const role of JBM_ROLES) {
      expect(TYPOGRAPHY[role].fontVariant).toEqual(['tabular-nums']);
    }
  });

  test('linguistic roles do not carry tabular-nums', () => {
    for (const role of SG_ROLES) {
      expect(TYPOGRAPHY[role].fontVariant).toBeUndefined();
    }
  });

  test('no token sets maxFontSizeMultiplier — dynamic type must remain uncapped', () => {
    for (const spec of Object.values(TYPOGRAPHY)) {
      expect(spec.maxFontSizeMultiplier).toBeUndefined();
    }
  });

  test('Space Grotesk roles reference bundled font family names, not system-ui', () => {
    for (const role of SG_ROLES) {
      expect(TYPOGRAPHY[role].fontFamily).not.toContain('system-ui');
      expect(TYPOGRAPHY[role].fontFamily).not.toContain('sans-serif');
      expect(TYPOGRAPHY[role].fontFamily).toMatch(/^SpaceGrotesk-/);
    }
  });

  test('JetBrains Mono roles reference bundled font family names, not monospace', () => {
    for (const role of JBM_ROLES) {
      expect(TYPOGRAPHY[role].fontFamily).not.toContain('monospace');
      expect(TYPOGRAPHY[role].fontFamily).not.toContain('Menlo');
      expect(TYPOGRAPHY[role].fontFamily).toMatch(/^JetBrainsMono-/);
    }
  });

  test('FONT_ASSETS registers all seven required weight variants', () => {
    expect(FONT_ASSETS).toMatchObject({
      'SpaceGrotesk-Regular': expect.anything(),
      'SpaceGrotesk-Medium': expect.anything(),
      'SpaceGrotesk-SemiBold': expect.anything(),
      'SpaceGrotesk-Bold': expect.anything(),
      'JetBrainsMono-SemiBold': expect.anything(),
      'JetBrainsMono-Medium': expect.anything(),
      'JetBrainsMono-Bold': expect.anything(),
    });
    expect(Object.keys(FONT_ASSETS)).toHaveLength(7);
  });

  test('TYPOGRAPHY_FALLBACK uses platform-appropriate monospace fallbacks', () => {
    const { Platform } = require('react-native');
    const expectedMonospace = {
      android: 'monospace',
      ios: 'Courier New',
      web: 'Courier New, Courier, monospace',
    }[Platform.OS] ?? 'Courier New';

    for (const [role, spec] of Object.entries(TYPOGRAPHY_FALLBACK)) {
      const isMonospace = JBM_ROLES.includes(role);
      if (isMonospace) {
        expect(spec.fontFamily).toBe(expectedMonospace);
      } else {
        // Sans-serif: omit fontFamily so the OS/browser uses its default.
        expect(spec.fontFamily).toBeUndefined();
      }
    }
  });

  test('TYPOGRAPHY_FALLBACK preserves sizes, line heights, and restores fontWeight', () => {
    const EXPECTED_WEIGHTS = {
      'headline-xl': '700', 'headline-xl-mobile': '700',
      'headline-lg': '600', 'headline-md': '600', 'headline-sm': '600',
      'body-lg': '400', 'body-md': '400', 'body-sm': '400',
      'metric-display': '700', 'metric-display-mobile': '700',
      'label-lg': '600', 'label-md': '500', 'label-sm': '500',
    };
    for (const role of Object.keys(TYPOGRAPHY)) {
      expect(TYPOGRAPHY_FALLBACK[role].fontSize).toBe(TYPOGRAPHY[role].fontSize);
      expect(TYPOGRAPHY_FALLBACK[role].lineHeight).toBe(TYPOGRAPHY[role].lineHeight);
      expect(TYPOGRAPHY_FALLBACK[role].fontWeight).toBe(EXPECTED_WEIGHTS[role]);
    }
  });

  test('label-lg uses the SemiBold asset (600), not Medium', () => {
    expect(TYPOGRAPHY['label-lg'].fontFamily).toBe('JetBrainsMono-SemiBold');
    // fontWeight is omitted — weight is encoded in the family name to avoid web synthesis
    expect(TYPOGRAPHY['label-lg'].fontWeight).toBeUndefined();
  });

  test('useKuaTypography returns TYPOGRAPHY_FALLBACK when fonts are not loaded', () => {
    // jest-expo mocks expo-font's useFonts to return [false, null] by default,
    // so useKuaTypography must return TYPOGRAPHY_FALLBACK on the first render.
    const React = require('react');
    let captured;
    function Probe() {
      captured = useKuaTypography();
      return null;
    }
    act(() => {
      renderer.create(React.createElement(Probe));
    });
    expect(captured).toBe(TYPOGRAPHY_FALLBACK);
  });

  test('offline startup: typography module loads without throwing', () => {
    // Asset require() paths resolve to numeric IDs in Jest — confirm the
    // module initialises cleanly without a live bundler or network.
    expect(() => {
      const { TYPOGRAPHY: T } = require('../theme/typography');
      Object.values(T).forEach((spec) => {
        expect(typeof spec.fontSize).toBe('number');
      });
    }).not.toThrow();
  });
});

// KUA six-palette semantic token contract (#1096)
// ---------------------------------------------------------------------------

// Cross-palette required roles (all six palettes must define these).
const KUA_REQUIRED_ROLES = [
  'background', 'surface', 'surfaceCard', 'surfaceBorder',
  'surfaceCardHeader', 'surfaceSection',
  'primary', 'primaryContainer', 'primaryContainerBorder', 'primaryOnContainer',
  'onSurface', 'onSurfaceVariant', 'completion', 'onPrimary',
  'tabBarBg', 'headerBg', 'error',
  'success', 'warning', 'selection',
  'chartSeries1', 'chartSeries2', 'chartSeries3',
];

// Per-palette complete approved token tables from the spec.
// Every role listed in the authority doc for that palette must be present
// and match the approved hex value exactly.
const KUA_APPROVED_VALUES = {
  hardCourtLight: {
    background: '#EEF3F9',
    surface: '#EEF3F9',
    surfaceCard: '#FFFFFF',
    surfaceSubtle: '#EEF3F9',
    surfaceBorder: '#DDE6F2',
    surfaceCardHeader: '#EEF3F9',
    surfaceSection: '#EEF3F9',
    primary: '#0A4ABF',
    primaryContainer: '#E1ECFB',
    primaryContainerBorder: '#9BC1F5',
    primaryOnContainer: '#083B9A',
    onSurface: '#0E1726',
    onSurfaceVariant: '#5A687A',
    completion: '#006C4A',
    onPrimary: '#FFFFFF',
    tabBarBg: '#FFFFFF',
    headerBg: '#EEF3F9',
    error: '#BA1A1A',
    selection: '#E1ECFB',
    success: '#006C4A',
    warning: '#B45309',
    chartSeries1: '#0C7489',
    chartSeries2: '#C2410C',
    chartSeries3: '#7C3AED',
  },
  hardCourtDark: {
    background: '#080D18',
    surface: '#080D18',
    surfaceCard: '#101728',
    surfaceCardHeader: '#131D32',
    surfaceSection: '#0E1524',
    surfaceBorder: '#1C2742',
    primary: '#3B82F6',
    primaryLight: '#60A5FA',
    primaryContainer: '#17233D',
    primaryContainerBorder: '#2A3F6D',
    primaryOnContainer: '#60A5FA',
    onSurface: '#F0F4FC',
    onSurfaceVariant: '#8C9BB3',
    completion: '#10B981',
    onPrimary: '#080D18',
    tabBarBg: '#080D18',
    headerBg: '#080D18',
    error: '#BA1A1A',
    selection: '#17233D',
    success: '#10B981',
    warning: '#FBBF24',
    chartSeries1: '#22D3EE',
    chartSeries2: '#F59E0B',
    chartSeries3: '#A78BFA',
  },
  clayCourtLight: {
    background: '#F8F5EE',
    surface: '#F8F5EE',
    surfaceCard: '#FFFDF9',
    surfaceElevated: '#F2EDE4',
    surfaceCardHeader: '#F2EDE4',
    surfaceSection: '#F2EDE4',
    surfaceBorder: '#E5DFD3',
    primary: '#A23E19',
    primaryDark: '#7E2E0F',
    primaryContainer: '#FBECE5',
    primaryContainerBorder: '#E89A7A',
    primaryOnContainer: '#7E2E0F',
    onSurface: '#1A1918',
    onSurfaceVariant: '#585550',
    onSurfaceMuted: '#736D65',
    completion: '#1E5B3A',
    onPrimary: '#FFFFFF',
    tabBarBg: '#F8F5EE',
    headerBg: '#F8F5EE',
    error: '#BA1A1A',
    selection: '#FBECE5',
    success: '#006C4A',
    warning: '#B45309',
    chartSeries1: '#0C7489',
    chartSeries2: '#C2410C',
    chartSeries3: '#7C3AED',
  },
  clayCourtDark: {
    background: '#141211',
    surface: '#141211',
    surfaceCard: '#1F1C1A',
    surfaceCardHeader: '#181513',
    surfaceLow: '#1A1816',
    surfaceBorder: '#2C2723',
    surfaceSection: '#1A1816',
    primary: '#D86538',
    primaryLight: '#F08B62',
    primaryContainer: '#341B13',
    primaryContainerBorder: '#5C2E1E',
    primaryOnContainer: '#F08B62',
    onSurface: '#F5F3F0',
    onSurfaceVariant: '#A89F96',
    completion: '#2CA864',
    onPrimary: '#141211',
    tabBarBg: '#141211',
    headerBg: '#141211',
    error: '#BA1A1A',
    selection: '#341B13',
    success: '#10B981',
    warning: '#FBBF24',
    chartSeries1: '#22D3EE',
    chartSeries2: '#F59E0B',
    chartSeries3: '#A78BFA',
  },
  grassCourtLight: {
    background: '#F4F8F5',
    surface: '#F4F8F5',
    surfaceCard: '#FFFFFF',
    surfaceSubtle: '#F2F7F4',
    surfaceCardHeader: '#F4F8F5',
    surfaceSection: '#F2F7F4',
    surfaceBorder: '#E0EAE3',
    surfaceSeg: '#E8EFEA',
    surfaceSegBorder: '#DEE7E1',
    primary: '#1E5B3A',
    primaryDark: '#14452B',
    primaryContainer: '#E8F4EC',
    primaryContainerBorder: '#A3D4B3',
    primaryOnContainer: '#14452B',
    onSurface: '#111813',
    onSurfaceVariant: '#556B5C',
    completion: '#1E5B3A',
    onPrimary: '#FFFFFF',
    tabBarBg: '#F4F8F5',
    headerBg: '#F4F8F5',
    error: '#BA1A1A',
    selection: '#E8F4EC',
    success: '#006C4A',
    warning: '#B45309',
    chartSeries1: '#0C7489',
    chartSeries2: '#C2410C',
    chartSeries3: '#7C3AED',
  },
  grassCourtDark: {
    background: '#0C130F',
    surface: '#0C130F',
    surfaceCard: '#15201A',
    surfaceCardHeader: '#0C130F',
    surfaceLow: '#111A15',
    surfaceSection: '#111A15',
    surfaceBorder: '#1F3025',
    surfaceSurface2: '#1C2B22',
    primary: '#2CA864',
    primaryNeon: '#4ADE80',
    primaryContainer: '#132B1C',
    primaryContainerBorder: '#235235',
    primaryOnContainer: '#4ADE80',
    onSurface: '#F0F5F2',
    onSurfaceVariant: '#91A398',
    completion: '#2CA864',
    onPrimary: '#0C130F',
    tabBarBg: '#0C130F',
    headerBg: '#0C130F',
    error: '#BA1A1A',
    selection: '#132B1C',
    success: '#10B981',
    warning: '#FBBF24',
    chartSeries1: '#22D3EE',
    chartSeries2: '#F59E0B',
    chartSeries3: '#A78BFA',
  },
};

const KUA_ALL_PALETTES = [
  ['hardCourt/light', HardCourtLightColors, KUA_APPROVED_VALUES.hardCourtLight],
  ['hardCourt/dark', HardCourtDarkColors, KUA_APPROVED_VALUES.hardCourtDark],
  ['clayCourt/light', ClayCourtLightColors, KUA_APPROVED_VALUES.clayCourtLight],
  ['clayCourt/dark', ClayCourtDarkColors, KUA_APPROVED_VALUES.clayCourtDark],
  ['grassCourt/light', GrassCourtLightColors, KUA_APPROVED_VALUES.grassCourtLight],
  ['grassCourt/dark', GrassCourtDarkColors, KUA_APPROVED_VALUES.grassCourtDark],
];

const KUA_LIGHT_PALETTES = [
  ['hardCourt/light', HardCourtLightColors, KUA_APPROVED_VALUES.hardCourtLight],
  ['clayCourt/light', ClayCourtLightColors, KUA_APPROVED_VALUES.clayCourtLight],
  ['grassCourt/light', GrassCourtLightColors, KUA_APPROVED_VALUES.grassCourtLight],
];

const KUA_DARK_PALETTES = [
  ['hardCourt/dark', HardCourtDarkColors, KUA_APPROVED_VALUES.hardCourtDark],
  ['clayCourt/dark', ClayCourtDarkColors, KUA_APPROVED_VALUES.clayCourtDark],
  ['grassCourt/dark', GrassCourtDarkColors, KUA_APPROVED_VALUES.grassCourtDark],
];

describe('KUA palette structure', () => {
  test('KUA_PALETTES exports all six palettes', () => {
    expect(Object.keys(KUA_PALETTES)).toEqual(['hardCourt', 'clayCourt', 'grassCourt']);
    for (const theme of Object.values(KUA_PALETTES)) {
      expect(theme.light).toBeDefined();
      expect(theme.dark).toBeDefined();
    }
  });

  test.each(KUA_ALL_PALETTES)('%s: all required roles are present and not undefined', (_name, palette) => {
    for (const role of KUA_REQUIRED_ROLES) {
      expect({ role, value: palette[role] }).not.toEqual({ role, value: undefined });
      expect({ role, value: palette[role] }).not.toEqual({ role, value: null });
    }
  });

  test.each(KUA_ALL_PALETTES)('%s: no required role has an empty value', (_name, palette) => {
    for (const role of KUA_REQUIRED_ROLES) {
      expect({ role, empty: palette[role] === '' }).toEqual({ role, empty: false });
    }
  });

  test('selection equals primaryContainer for every palette', () => {
    for (const [name, palette] of KUA_ALL_PALETTES) {
      expect({ name, match: palette.selection === palette.primaryContainer })
        .toEqual({ name, match: true });
    }
  });
});

describe('KUA per-palette complete approved token values', () => {
  // Every role in the authority doc for each palette must be present with its
  // exact approved hex value — including palette-specific tokens such as
  // surfaceSubtle, primaryLight, surfaceElevated, onSurfaceMuted,
  // surfaceSeg/surfaceSegBorder, and primaryNeon.
  test.each(KUA_ALL_PALETTES)('%s: every approved role has the exact specified value', (_name, palette, approved) => {
    for (const [role, value] of Object.entries(approved)) {
      expect({ role, value: palette[role] }).toEqual({ role, value });
    }
  });

  test.each(KUA_ALL_PALETTES)('%s: no approved role is missing from the palette', (_name, palette, approved) => {
    for (const role of Object.keys(approved)) {
      expect({ role, defined: palette[role] !== undefined }).toEqual({ role, defined: true });
    }
  });
});

describe('KUA shared roles are identical across themes within a mode', () => {
  const SHARED_ROLES = ['success', 'warning', 'chartSeries1', 'chartSeries2', 'chartSeries3'];

  const SHARED_LIGHT_VALUES = {
    success: '#006C4A',
    warning: '#B45309',
    chartSeries1: '#0C7489',
    chartSeries2: '#C2410C',
    chartSeries3: '#7C3AED',
  };

  const SHARED_DARK_VALUES = {
    success: '#10B981',
    warning: '#FBBF24',
    chartSeries1: '#22D3EE',
    chartSeries2: '#F59E0B',
    chartSeries3: '#A78BFA',
  };

  test.each(KUA_LIGHT_PALETTES)('%s: shared roles match approved light values exactly', (_name, palette) => {
    for (const role of SHARED_ROLES) {
      expect({ role, value: palette[role] }).toEqual({ role, value: SHARED_LIGHT_VALUES[role] });
    }
  });

  test.each(KUA_DARK_PALETTES)('%s: shared roles match approved dark values exactly', (_name, palette) => {
    for (const role of SHARED_ROLES) {
      expect({ role, value: palette[role] }).toEqual({ role, value: SHARED_DARK_VALUES[role] });
    }
  });

  test('error is the same across all six palettes', () => {
    for (const [name, palette] of KUA_ALL_PALETTES) {
      expect({ name, error: palette.error }).toEqual({ name, error: '#BA1A1A' });
    }
  });
});

describe('KUA WCAG contrast: required text/non-text pairs', () => {
  // Light: body and muted text on canvas and card must be AA (≥4.5:1)
  test.each(KUA_LIGHT_PALETTES)('%s: onSurface clears AA on background and surfaceCard', (_name, palette) => {
    expect(contrastRatio(palette.onSurface, palette.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.onSurface, palette.surfaceCard)).toBeGreaterThanOrEqual(4.5);
  });

  test.each(KUA_DARK_PALETTES)('%s: onSurface clears AA on background and surfaceCard', (_name, palette) => {
    expect(contrastRatio(palette.onSurface, palette.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.onSurface, palette.surfaceCard)).toBeGreaterThanOrEqual(4.5);
  });

  test.each(KUA_LIGHT_PALETTES)('%s: onSurfaceVariant clears AA on background and surfaceCard', (_name, palette) => {
    expect(contrastRatio(palette.onSurfaceVariant, palette.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.onSurfaceVariant, palette.surfaceCard)).toBeGreaterThanOrEqual(4.5);
  });

  test.each(KUA_DARK_PALETTES)('%s: onSurfaceVariant clears AA on background and surfaceCard', (_name, palette) => {
    expect(contrastRatio(palette.onSurfaceVariant, palette.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.onSurfaceVariant, palette.surfaceCard)).toBeGreaterThanOrEqual(4.5);
  });

  test.each(KUA_ALL_PALETTES)('%s: onPrimary clears AA on primary', (_name, palette) => {
    expect(contrastRatio(palette.onPrimary, palette.primary)).toBeGreaterThanOrEqual(4.5);
  });

  test.each(KUA_ALL_PALETTES)('%s: primaryOnContainer clears AA on primaryContainer', (_name, palette) => {
    expect(contrastRatio(palette.primaryOnContainer, palette.primaryContainer)).toBeGreaterThanOrEqual(4.5);
  });

  // Shared light tokens: AA on all six surfaces in their mode
  test('shared light success clears AA on all light surfaces', () => {
    for (const [name, palette] of KUA_LIGHT_PALETTES) {
      for (const surface of [palette.background, palette.surfaceCard]) {
        expect({ name, ok: contrastRatio(palette.success, surface) >= 4.5 })
          .toEqual({ name, ok: true });
      }
    }
  });

  test('shared light warning clears AA on all light surfaces', () => {
    for (const [name, palette] of KUA_LIGHT_PALETTES) {
      for (const surface of [palette.background, palette.surfaceCard]) {
        expect({ name, ok: contrastRatio(palette.warning, surface) >= 4.5 })
          .toEqual({ name, ok: true });
      }
    }
  });

  test('shared light chart series clear AA on all light surfaces', () => {
    for (const [name, palette] of KUA_LIGHT_PALETTES) {
      for (const series of ['chartSeries1', 'chartSeries2', 'chartSeries3']) {
        for (const surface of [palette.background, palette.surfaceCard]) {
          expect({ name, series, ok: contrastRatio(palette[series], surface) >= 4.5 })
            .toEqual({ name, series, ok: true });
        }
      }
    }
  });

  test('shared dark success clears AA on all dark surfaces', () => {
    for (const [name, palette] of KUA_DARK_PALETTES) {
      for (const surface of [palette.background, palette.surfaceCard]) {
        expect({ name, ok: contrastRatio(palette.success, surface) >= 4.5 })
          .toEqual({ name, ok: true });
      }
    }
  });

  test('shared dark warning clears AA on all dark surfaces', () => {
    for (const [name, palette] of KUA_DARK_PALETTES) {
      for (const surface of [palette.background, palette.surfaceCard]) {
        expect({ name, ok: contrastRatio(palette.warning, surface) >= 4.5 })
          .toEqual({ name, ok: true });
      }
    }
  });

  test('shared dark chart series clear AA on all dark surfaces', () => {
    for (const [name, palette] of KUA_DARK_PALETTES) {
      for (const series of ['chartSeries1', 'chartSeries2', 'chartSeries3']) {
        for (const surface of [palette.background, palette.surfaceCard]) {
          expect({ name, series, ok: contrastRatio(palette[series], surface) >= 4.5 })
            .toEqual({ name, series, ok: true });
        }
      }
    }
  });

  // Spot-check key documented pairs from the spec
  test('Hard Court Light: documented pairs match spec ratios', () => {
    const p = HardCourtLightColors;
    // #0E1726 / #EEF3F9 → 16.1:1 AAA
    expect(contrastRatio(p.onSurface, p.background)).toBeGreaterThanOrEqual(15.0);
    // #0A4ABF / #EEF3F9 → 6.9:1 AA
    expect(contrastRatio(p.primary, p.background)).toBeGreaterThanOrEqual(6.5);
    // #FFFFFF / #0A4ABF → 7.7:1 AAA
    expect(contrastRatio(p.onPrimary, p.primary)).toBeGreaterThanOrEqual(7.5);
  });

  test('Hard Court Dark: documented pairs match spec ratios', () => {
    const p = HardCourtDarkColors;
    // #F0F4FC / #080D18 → 17.6:1 AAA
    expect(contrastRatio(p.onSurface, p.background)).toBeGreaterThanOrEqual(17.0);
    // #60A5FA / #17233D → 6.1:1 AA
    expect(contrastRatio(p.primaryOnContainer, p.primaryContainer)).toBeGreaterThanOrEqual(6.0);
  });

  test('Clay Court Light: documented pairs match spec ratios', () => {
    const p = ClayCourtLightColors;
    // #1A1918 / #FFFDF9 → 17.3:1 AAA
    expect(contrastRatio(p.onSurface, p.surfaceCard)).toBeGreaterThanOrEqual(17.0);
    // #A23E19 / #F8F5EE → 6.0:1 AA
    expect(contrastRatio(p.primary, p.background)).toBeGreaterThanOrEqual(5.8);
    // #7E2E0F / #FBECE5 → 8.0:1 AAA
    expect(contrastRatio(p.primaryOnContainer, p.primaryContainer)).toBeGreaterThanOrEqual(7.8);
  });

  test('Clay Court Dark: documented pairs match spec ratios', () => {
    const p = ClayCourtDarkColors;
    // #F5F3F0 / #141211 → 16.9:1 AAA
    expect(contrastRatio(p.onSurface, p.background)).toBeGreaterThanOrEqual(16.5);
    // #F08B62 / #341B13 → 6.5:1 AA
    expect(contrastRatio(p.primaryOnContainer, p.primaryContainer)).toBeGreaterThanOrEqual(6.0);
  });

  test('Grass Court Light: documented pairs match spec ratios', () => {
    const p = GrassCourtLightColors;
    // #111813 / #FFFFFF → 18.0:1 AAA
    expect(contrastRatio(p.onSurface, p.surfaceCard)).toBeGreaterThanOrEqual(17.5);
    // #1E5B3A / #F4F8F5 → 7.5:1 AAA
    expect(contrastRatio(p.primary, p.background)).toBeGreaterThanOrEqual(7.0);
    // #14452B / #E8F4EC → 9.7:1 AAA
    expect(contrastRatio(p.primaryOnContainer, p.primaryContainer)).toBeGreaterThanOrEqual(9.5);
  });

  test('Grass Court Dark: documented pairs match spec ratios', () => {
    const p = GrassCourtDarkColors;
    // #F0F5F2 / #0C130F → 17.1:1 AAA
    expect(contrastRatio(p.onSurface, p.background)).toBeGreaterThanOrEqual(17.0);
    // #4ADE80 / #132B1C → 8.7:1 AAA
    expect(contrastRatio(p.primaryOnContainer, p.primaryContainer)).toBeGreaterThanOrEqual(8.5);
  });
});

// ---------------------------------------------------------------------------
// KUA spacing token contract (#1098)
// Source: docs/design/kinetic-utilitarian-athletic/foundation.md
// ---------------------------------------------------------------------------

import { SPACING, GEOMETRY } from '../theme/spacing';
import { BORDERS, ELEVATION } from '../theme/elevation';

describe('KUA spacing token contract', () => {
  test('exports all nine spacing roles', () => {
    const roles = Object.keys(SPACING);
    expect(roles).toHaveLength(9);
  });

  test('every spacing role has the exact value from foundation.md', () => {
    expect(SPACING['space-xs']).toBe(4);
    expect(SPACING['space-sm']).toBe(8);
    expect(SPACING['gutter']).toBe(12);
    expect(SPACING['space-md']).toBe(12);
    expect(SPACING['margin']).toBe(16);
    expect(SPACING['space-lg']).toBe(20);
    expect(SPACING['gutter-desktop']).toBe(20);
    expect(SPACING['space-xl']).toBe(32);
    expect(SPACING['margin-desktop']).toBe(32);
  });

  test('all spacing values are numbers', () => {
    for (const [role, value] of Object.entries(SPACING)) {
      expect({ role, type: typeof value }).toEqual({ role, type: 'number' });
    }
  });

  test('SPACING is frozen — consumers cannot mutate tokens', () => {
    expect(Object.isFrozen(SPACING)).toBe(true);
  });
});

describe('KUA geometry token contract', () => {
  test('exports all seven radius roles', () => {
    const roles = Object.keys(GEOMETRY);
    expect(roles).toHaveLength(7);
  });

  test('every radius role has the exact value from foundation.md', () => {
    expect(GEOMETRY['radius-xs']).toBe(2);
    expect(GEOMETRY['radius-sm']).toBe(4);
    expect(GEOMETRY['radius-md']).toBe(6);
    expect(GEOMETRY['radius-lg']).toBe(8);
    expect(GEOMETRY['radius-xl']).toBe(12);
    expect(GEOMETRY['radius-2xl']).toBe(16);
    // radius-full uses '50%' as specified in foundation.md; React Native 0.81+
    // accepts percentage strings for borderRadius.
    expect(GEOMETRY['radius-full']).toBe('50%');
  });

  test('numeric radius values are numbers; radius-full is the documented percentage string', () => {
    for (const [role, value] of Object.entries(GEOMETRY)) {
      if (role === 'radius-full') {
        expect({ role, value }).toEqual({ role, value: '50%' });
      } else {
        expect({ role, type: typeof value }).toEqual({ role, type: 'number' });
      }
    }
  });

  test('GEOMETRY is frozen — consumers cannot mutate tokens', () => {
    expect(Object.isFrozen(GEOMETRY)).toBe(true);
  });
});

describe('KUA border token contract', () => {
  test('exports exactly the five structural levels', () => {
    expect(Object.keys(BORDERS)).toEqual(['canvas', 'card', 'activeCard', 'elevatedCard', 'overlay']);
  });

  test('canvas carries no border', () => {
    expect(BORDERS.canvas).toEqual({});
  });

  test('card uses 1px structural border', () => {
    expect(BORDERS.card.borderWidth).toBe(1);
  });

  test('activeCard uses 2px border (primary color applied by consumer)', () => {
    expect(BORDERS.activeCard.borderWidth).toBe(2);
    expect(BORDERS.activeCard.borderColor).toBeUndefined();
  });

  test('elevatedCard uses 2px border (primary color applied by consumer)', () => {
    expect(BORDERS.elevatedCard.borderWidth).toBe(2);
    expect(BORDERS.elevatedCard.borderColor).toBeUndefined();
  });

  test('overlay uses 1px border', () => {
    expect(BORDERS.overlay.borderWidth).toBe(1);
  });

  test('BORDERS is frozen — consumers cannot mutate tokens', () => {
    expect(Object.isFrozen(BORDERS)).toBe(true);
  });
});

describe('KUA elevation token contract', () => {
  test('exports exactly the five named roles from foundation.md', () => {
    expect(Object.keys(ELEVATION).sort()).toEqual(
      ['activeCard', 'canvas', 'card', 'elevatedCard', 'overlay'].sort()
    );
  });

  test('every role has the exact level number from foundation.md §Borders and elevation', () => {
    expect(ELEVATION.canvas).toBe(0);
    expect(ELEVATION.card).toBe(1);
    expect(ELEVATION.activeCard).toBe(2);
    expect(ELEVATION.elevatedCard).toBe(3);
    expect(ELEVATION.overlay).toBe(4);
  });

  test('all level values are numbers (usable as Android elevation style prop)', () => {
    for (const [role, value] of Object.entries(ELEVATION)) {
      expect({ role, type: typeof value }).toEqual({ role, type: 'number' });
    }
  });

  test('ELEVATION is frozen — consumers cannot mutate tokens', () => {
    expect(Object.isFrozen(ELEVATION)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// KUA Log screen segmented control (#1109)
// tabToggle background must resolve to a KUA token for all six palettes.
// Hard Court light/dark and Clay Court light define neither surfaceLow nor
// surfaceSeg, so the fallback must be surfaceSection (present in all palettes).
// ---------------------------------------------------------------------------

import { createStyles as createLogStyles } from '../screens/log/logScreenStyles';

describe('KUA Log screen segmented control: tabToggle background uses KUA tokens in all palettes', () => {
  const LEGACY_SUBTLEBG_RE = /rgba/i;

  test.each([
    ['hardCourt/light', HardCourtLightColors],
    ['hardCourt/dark', HardCourtDarkColors],
    ['clayCourt/light', ClayCourtLightColors],
    ['clayCourt/dark', ClayCourtDarkColors],
    ['grassCourt/light', GrassCourtLightColors],
    ['grassCourt/dark', GrassCourtDarkColors],
  ])('%s: tabToggle background is a KUA token, not legacy subtleBg', (_name, kua) => {
    const styles = createLogStyles(LightColors, kua);
    const bg = styles.tabToggle.backgroundColor;
    // Must be a string (hex), not the legacy rgba scrim
    expect(typeof bg).toBe('string');
    expect(LEGACY_SUBTLEBG_RE.test(bg)).toBe(false);
    // Must match one of the three candidate KUA tokens
    const expected = kua.surfaceLow ?? kua.surfaceSeg ?? kua.surfaceSection;
    expect(bg).toBe(expected);
  });

  test('tabToggle background falls back to legacy subtleBg when kua is null', () => {
    const styles = createLogStyles(LightColors, null);
    expect(styles.tabToggle.backgroundColor).toBe(LightColors.subtleBg);
  });
});

// ---------------------------------------------------------------------------
// KUA Analytics surface (#1116)
// Card backgrounds and key color tokens must resolve to KUA values in all six
// palettes; legacy colors must be used when kua is null.
// ---------------------------------------------------------------------------

import { createStyles as createAnalyticsStyles } from '../screens/analytics/analyticsStyles';
import { createStyles as createWeightTrendsStyles } from '../components/AnalyticsWeightTrendsCard';
import { createStyles as createStrengthStyles } from '../components/AnalyticsStrengthSection';

describe('KUA Analytics surface: createStyles uses KUA tokens in all palettes', () => {
  test.each([
    ['hardCourt/light', HardCourtLightColors],
    ['hardCourt/dark', HardCourtDarkColors],
    ['clayCourt/light', ClayCourtLightColors],
    ['clayCourt/dark', ClayCourtDarkColors],
    ['grassCourt/light', GrassCourtLightColors],
    ['grassCourt/dark', GrassCourtDarkColors],
  ])('%s: analyticsStyles stickyHeader background is kua.background', (_name, kua) => {
    const styles = createAnalyticsStyles(LightColors, kua);
    expect(styles.signalStickyHeader.backgroundColor).toBe(kua.background);
  });

  test.each([
    ['hardCourt/light', HardCourtLightColors],
    ['hardCourt/dark', HardCourtDarkColors],
    ['clayCourt/light', ClayCourtLightColors],
    ['clayCourt/dark', ClayCourtDarkColors],
    ['grassCourt/light', GrassCourtLightColors],
    ['grassCourt/dark', GrassCourtDarkColors],
  ])('%s: analyticsStyles searchInput uses kua.surfaceCard background', (_name, kua) => {
    const styles = createAnalyticsStyles(LightColors, kua);
    expect(styles.searchInput.backgroundColor).toBe(kua.surfaceCard);
    expect(styles.searchInput.borderColor).toBe(kua.surfaceBorder);
    expect(styles.searchInput.color).toBe(kua.onSurface);
  });

  test('analyticsStyles falls back to legacy colors when kua is null', () => {
    const styles = createAnalyticsStyles(LightColors, null);
    expect(styles.signalStickyHeader.backgroundColor).toBe(LightColors.background);
    expect(styles.searchInput.backgroundColor).toBe(LightColors.inputBackground);
  });

  test.each([
    ['hardCourt/light', HardCourtLightColors],
    ['hardCourt/dark', HardCourtDarkColors],
    ['clayCourt/light', ClayCourtLightColors],
    ['clayCourt/dark', ClayCourtDarkColors],
    ['grassCourt/light', GrassCourtLightColors],
    ['grassCourt/dark', GrassCourtDarkColors],
  ])('%s: weight trends card uses kua.surfaceCard for card background', (_name, kua) => {
    const styles = createWeightTrendsStyles(LightColors, kua, TYPOGRAPHY);
    expect(styles.weightCard.backgroundColor).toBe(kua.surfaceCard);
    expect(styles.weightFooter.borderTopColor).toBe(kua.surfaceBorder);
    expect(styles.weightStatValue.color).toBe(kua.onSurface);
    expect(styles.weightStatLabel.color).toBe(kua.onSurfaceVariant);
  });

  test.each([
    ['hardCourt/light', HardCourtLightColors],
    ['hardCourt/dark', HardCourtDarkColors],
    ['clayCourt/light', ClayCourtLightColors],
    ['clayCourt/dark', ClayCourtDarkColors],
    ['grassCourt/light', GrassCourtLightColors],
    ['grassCourt/dark', GrassCourtDarkColors],
  ])('%s: weight trends card applies metric-display-mobile font for main weight value', (_name, kua) => {
    const styles = createWeightTrendsStyles(LightColors, kua, TYPOGRAPHY);
    const spec = TYPOGRAPHY['metric-display-mobile'];
    expect(styles.weightValueLarge.fontFamily).toBe(spec.fontFamily);
    expect(styles.weightValueLarge.color).toBe(kua.onSurface);
  });

  test('weight trends card falls back to legacy styles when kua is null', () => {
    const styles = createWeightTrendsStyles(LightColors, null, null);
    expect(styles.weightCard.backgroundColor).toBe(LightColors.panelBackground);
    expect(styles.weightStatValue.color).toBe(LightColors.text);
    expect(styles.weightValueLarge.fontSize).toBe(36);
  });

  test.each([
    ['hardCourt/light', HardCourtLightColors],
    ['hardCourt/dark', HardCourtDarkColors],
    ['clayCourt/light', ClayCourtLightColors],
    ['clayCourt/dark', ClayCourtDarkColors],
    ['grassCourt/light', GrassCourtLightColors],
    ['grassCourt/dark', GrassCourtDarkColors],
  ])('%s: strength section uses kua.surfaceCard for 1K card background', (_name, kua) => {
    const styles = createStrengthStyles(LightColors, kua, TYPOGRAPHY);
    expect(styles.oneKCard.backgroundColor).toBe(kua.surfaceCard);
    expect(styles.oneKProgressBar.backgroundColor).toBe(kua.primary);
    expect(styles.slotOptionSelected.backgroundColor).toBe(kua.primaryContainer);
  });

  test.each([
    ['hardCourt/light', HardCourtLightColors],
    ['hardCourt/dark', HardCourtDarkColors],
    ['clayCourt/light', ClayCourtLightColors],
    ['clayCourt/dark', ClayCourtDarkColors],
    ['grassCourt/light', GrassCourtLightColors],
    ['grassCourt/dark', GrassCourtDarkColors],
  ])('%s: strength section applies metric-display-mobile font for 1K value', (_name, kua) => {
    const styles = createStrengthStyles(LightColors, kua, TYPOGRAPHY);
    const spec = TYPOGRAPHY['metric-display-mobile'];
    expect(styles.oneKValue.fontFamily).toBe(spec.fontFamily);
    expect(styles.oneKValue.fontSize).toBe(34);
  });

  test('strength section falls back to legacy styles when kua is null', () => {
    const styles = createStrengthStyles(LightColors, null, null);
    expect(styles.oneKCard.backgroundColor).toBe(LightColors.panelBackground);
    expect(styles.oneKProgressBar.backgroundColor).toBe(LightColors.accent);
  });
});

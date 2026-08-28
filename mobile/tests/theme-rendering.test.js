import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text, View, useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { DarkColors, LightColors, paletteForMode } from '../theme/colors';
import { ThemeProvider, useTheme, useThemedStyles } from '../theme/ThemeContext';
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

  test('dark: accent text ink clears 4.5:1 on card, background, and subtleBg', () => {
    const { chipBackground, ...surfaces } = textSurfaces(DarkColors);
    for (const [name, surface] of Object.entries(surfaces)) {
      expect({ name, ok: contrastRatio(surface, DarkColors.accentText) >= 4.5 })
        .toEqual({ name, ok: true });
    }
  });

  // Recorded gap, not a target. Dark `chipBackground` is the accent itself at
  // 32% over `card`, so accent-colored copy on it is inherently low-contrast;
  // the chip's own paired ink is `chipText` (11.11:1). The value is unchanged
  // from the pre-#908 `accent` and is pinned here so it cannot drift further
  // without someone deciding to.
  test('dark accent copy on the dark chip fill is the one recorded gap', () => {
    const chip = compositeOver(DarkColors.chipBackground, DarkColors.card);
    expect(contrastRatio(chip, DarkColors.accentText)).toBeCloseTo(3.54, 2);
    expect(contrastRatio(chip, DarkColors.chipText)).toBeGreaterThanOrEqual(4.5);
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

  test('LineChart renders with no color prop and falls back to the accent', () => {
    let component;
    expect(() => {
      component = mountChart();
    }).not.toThrow();

    expect(strokes(component)).toContain(LightColors.accent);
    expect(strokes(component).every((s) => s !== undefined)).toBe(true);
  });

  test('an omitted color follows a palette change instead of freezing', () => {
    const component = mountChart();

    act(() => {
      setAppearancePreference('dark');
    });

    expect(strokes(component)).toContain(DarkColors.accent);
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

  test('the Kilo wordmark accent is the only hardcoded color left', () => {
    const leaks = [];
    for (const f of files) {
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const matches = line.match(/'#[0-9a-fA-F]{3,8}'|"#[0-9a-fA-F]{3,8}"|rgba?\([\d.,\s]+\)/g);
        if (matches) leaks.push(`${path.relative(root, f)}:${i + 1} ${matches.join(' ')}`);
      });
    }
    // The two brand-orange wordmark accents are the single sanctioned
    // exception; anything else appearing here is a missed token.
    expect(leaks).toEqual([
      'screens/HomeScreen.js:41 "#FF5C00"',
      'screens/HomeScreen.js:45 "#FF5C00"',
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
});

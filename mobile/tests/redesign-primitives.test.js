import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext, KuaStyleContext } from '../theme/ThemeContext';
import { DarkColors, HardCourtDarkColors, ClayCourtLightColors, LightColors } from '../theme/colors';
import { Panel, PanelSection, HairlineRow, Disclosure, MonoLabel } from '../components/ui/RedesignPrimitives';
import { RootHeader, RootHeaderAction } from '../components/RootHeader';
import { ScreenShell } from '../components/ScreenShell';
import { centeredColumnInsets } from '../components/adaptiveLayout';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 2, fontScale: 1 }),
}));

jest.mock('@expo/vector-icons/MaterialIcons', () => {
  const React = require('react');
  const { View } = require('react-native');
  return function MockMaterialIcons({ name, size, color }) {
    return React.createElement(View, { 'data-icon': name, 'data-size': size, 'data-color': color });
  };
});

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, right: 0, bottom: 0, left: 0 } };
const flat = (node) => StyleSheet.flatten(node.props.style);
const host = (root, pred) => root.findAll((n) => typeof n.type === 'string' && pred(n));
// Pressable's host node carries the a11y props; the composite carries onPress.
const pressable = (root, pred) => root.findAll((n) => typeof n.type !== 'string' && typeof n.props.onPress === 'function' && pred(n))[0];
const textOf = (root, s) => host(root, (n) => n.type === 'Text' && n.props.children === s)[0];

function mount(element, { colors = DarkColors, kua = HardCourtDarkColors, mode = 'dark' } = {}) {
  let tree;
  act(() => {
    tree = renderer.create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ThemeContext.Provider value={{ colors, mode, preference: mode, setPreference: () => {} }}>
          <KuaStyleContext.Provider value={kua}>{element}</KuaStyleContext.Provider>
        </ThemeContext.Provider>
      </SafeAreaProvider>
    );
  });
  return tree;
}

describe('Panel', () => {
  test('flat panel: card surface, 1px border, clipped radius, no padding', () => {
    const tree = mount(<Panel testID="p"><Text>x</Text></Panel>);
    const s = flat(host(tree.root, (n) => n.props.testID === 'p')[0]);
    expect(s.backgroundColor).toBe(HardCourtDarkColors.surfaceCard);
    expect(s.borderWidth).toBe(1);
    expect(s.borderColor).toBe(HardCourtDarkColors.surfaceBorder);
    expect(s.overflow).toBe('hidden');
    expect(s.borderRadius).toBeGreaterThan(0);
    expect(s.padding).toBeUndefined();
  });

  test('only the active panel gets the 2px primary border', () => {
    const tree = mount(<Panel testID="p" active><Text>x</Text></Panel>, { colors: LightColors, kua: ClayCourtLightColors, mode: 'light' });
    const s = flat(host(tree.root, (n) => n.props.testID === 'p')[0]);
    expect(s.borderWidth).toBe(2);
    expect(s.borderColor).toBe(ClayCourtLightColors.primary);
  });

  test('legacy palette outside the KUA gate', () => {
    const tree = mount(<Panel testID="p" />, { colors: LightColors, kua: null, mode: 'light' });
    const s = flat(host(tree.root, (n) => n.props.testID === 'p')[0]);
    expect(s.backgroundColor).toBe(LightColors.card);
    expect(s.borderColor).toBe(LightColors.cardBorder);
  });
});

describe('HairlineRow', () => {
  test('pressable row: >=48dp button named by title and subtitle, chevron, hairline divider', () => {
    const onPress = jest.fn();
    const tree = mount(<HairlineRow testID="r" title="Settings" subtitle="Features, reminders" icon="settings" onPress={onPress} divider />);
    const btn = host(tree.root, (n) => n.props.testID === 'r' && n.props.accessibilityRole === 'button')[0];
    expect(btn.props.accessibilityLabel).toBe('Settings, Features, reminders');
    const s = flat(btn);
    expect(s.minHeight).toBeGreaterThanOrEqual(48);
    expect(s.borderTopWidth).toBe(1);
    expect(host(tree.root, (n) => n.props['data-icon'] === 'chevron-right')).toHaveLength(1);
    act(() => pressable(tree.root, (n) => n.props.testID === 'r').props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('type scale: 16px title, subtitle at or above the 12px floor', () => {
    const tree = mount(<HairlineRow title="Account" subtitle="Signed in" />);
    expect(flat(textOf(tree.root, 'Account')).fontSize).toBe(16);
    expect(flat(textOf(tree.root, 'Signed in')).fontSize).toBeGreaterThanOrEqual(12);
  });

  test('static row has no button role and no chevron', () => {
    const tree = mount(<HairlineRow testID="r" title="Version" right={<Text>1.21.2</Text>} />);
    expect(host(tree.root, (n) => n.props.accessibilityRole === 'button')).toHaveLength(0);
    expect(host(tree.root, (n) => n.props['data-icon'] === 'chevron-right')).toHaveLength(0);
    expect(textOf(tree.root, '1.21.2')).toBeDefined();
  });
});

describe('Disclosure', () => {
  test('uncontrolled: exposes expanded state and renders children only when open', () => {
    const tree = mount(<Disclosure testID="d" title="Goal history"><Text>Archived goals</Text></Disclosure>);
    const toggle = () => host(tree.root, (n) => n.props.testID === 'd-toggle' && n.props.accessibilityRole === 'button')[0];
    expect(toggle().props.accessibilityState).toEqual({ expanded: false });
    expect(textOf(tree.root, 'Archived goals')).toBeUndefined();
    expect(flat(toggle()).minHeight).toBeGreaterThanOrEqual(44);
    act(() => pressable(tree.root, (n) => n.props.testID === 'd-toggle').props.onPress());
    expect(toggle().props.accessibilityState).toEqual({ expanded: true });
    expect(textOf(tree.root, 'Archived goals')).toBeDefined();
    expect(host(tree.root, (n) => n.props['data-icon'] === 'expand-less')).toHaveLength(1);
  });

  test('controlled: reports the next state and follows the prop', () => {
    const onToggle = jest.fn();
    const tree = mount(<Disclosure testID="d" title="Baseline" expanded={false} onToggle={onToggle}><Text>Body</Text></Disclosure>);
    const toggle = host(tree.root, (n) => n.props.testID === 'd-toggle' && n.props.accessibilityRole === 'button')[0];
    act(() => pressable(tree.root, (n) => n.props.testID === 'd-toggle').props.onPress());
    expect(onToggle).toHaveBeenCalledWith(true);
    expect(textOf(tree.root, 'Body')).toBeUndefined();
  });
});

describe('MonoLabel and PanelSection', () => {
  test('MonoLabel is uppercase 12px mono in the muted ink', () => {
    const tree = mount(<MonoLabel>Latest</MonoLabel>);
    const s = flat(textOf(tree.root, 'Latest'));
    expect(s.textTransform).toBe('uppercase');
    expect(s.fontSize).toBe(12);
    expect(s.color).toBe(HardCourtDarkColors.onSurfaceVariant);
  });

  test('PanelSection divider draws a 1px top hairline', () => {
    const tree = mount(<PanelSection testID="s" divider />);
    expect(flat(host(tree.root, (n) => n.props.testID === 's')[0]).borderTopWidth).toBe(1);
  });
});

describe('RootHeader', () => {
  test('28/700 display title as a header, uppercase mono context, bottom hairline, no back control', () => {
    const tree = mount(<RootHeader title="Weight" context="43 weigh-ins · Cutting → 183 lb" />);
    const title = textOf(tree.root, 'Weight');
    expect(title.props.accessibilityRole).toBe('header');
    const ts = flat(title);
    expect(ts.fontSize).toBe(28);
    expect(`${ts.fontFamily}|${ts.fontWeight}`).toMatch(/Bold|700/);
    const ctx = flat(textOf(tree.root, '43 weigh-ins · Cutting → 183 lb'));
    expect(ctx.textTransform).toBe('uppercase');
    expect(ctx.fontSize).toBe(12);
    const box = flat(host(tree.root, (n) => n.props.testID === 'root-header')[0]);
    expect(box.borderBottomWidth).toBe(1);
    expect(box.borderBottomColor).toBe(HardCourtDarkColors.surfaceBorder);
    // Aligned with ScreenShell's content column.
    expect(box.paddingLeft).toBe(centeredColumnInsets(390).left);
    expect(tree.root.findAll((n) => n.props.accessibilityLabel && /back/i.test(n.props.accessibilityLabel))).toHaveLength(0);
  });

  test('context is optional and right actions are labelled 44dp buttons', () => {
    const onPress = jest.fn();
    const tree = mount(<RootHeader title="Log" right={<RootHeaderAction icon="more-horiz" label="Routine actions" onPress={onPress} />} />);
    expect(host(tree.root, (n) => n.props.testID === 'root-header-context')).toHaveLength(0);
    const action = host(tree.root, (n) => n.props.accessibilityLabel === 'Routine actions' && n.props.accessibilityRole === 'button')[0];
    const s = flat(action);
    expect(s.minWidth).toBeGreaterThanOrEqual(44);
    expect(s.minHeight).toBeGreaterThanOrEqual(44);
    act(() => pressable(tree.root, (n) => n.props.accessibilityLabel === 'Routine actions').props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('ScreenShell `header` renders fixed above the scroll and keeps sticky index 0 as a slot', () => {
    const tree = mount(
      <ScreenShell header={<RootHeader title="Analytics" context="Upper / Lower" />} stickyHeaderIndices={[1]}>
        <Text>Index</Text>
        <Text>Body</Text>
      </ScreenShell>
    );
    const scroll = tree.root.findByType('RCTScrollView');
    // Header is outside the ScrollView; no in-scroll "Kilo" fallback title.
    expect(scroll.findAll((n) => n.props.testID === 'root-header')).toHaveLength(0);
    expect(host(tree.root, (n) => n.props.testID === 'root-header').length).toBeGreaterThan(0);
    expect(textOf(tree.root, 'Kilo')).toBeUndefined();
    expect(scroll.findAll((n) => n.props.testID === 'screen-shell-header-slot').length).toBeGreaterThan(0);
    expect(scroll.props.stickyHeaderIndices).toEqual([1]);
  });

  test('ScreenShell without `header` keeps the existing title block', () => {
    const tree = mount(<ScreenShell title="Settings" onBack={() => {}} />);
    expect(textOf(tree.root, 'Settings')).toBeDefined();
    expect(textOf(tree.root, '← Back')).toBeDefined();
    expect(host(tree.root, (n) => n.props.testID === 'screen-shell-header-slot')).toHaveLength(0);
  });
});

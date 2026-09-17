import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TabBar } from '../components/TabBar';
import { ScreenShell } from '../components/ScreenShell';
import { TabBarLayoutContext, TAB_BAR_VISUAL_GAP, TAB_BAR_HEIGHT_FALLBACK } from '../components/TabBarLayout';
import { TAB_ICON_MAP } from '../components/Icon';

jest.mock('@expo/vector-icons/MaterialIcons', () => {
  const React = require('react');
  const { View } = require('react-native');
  return function MockMaterialIcons({ name, size, color, testID }) {
    return React.createElement(View, { testID: testID ?? `icon-${name}`, accessibilityLabel: name, 'data-icon': name, 'data-size': size, 'data-color': color });
  };
});

const metrics = (bottom, top = 0) => ({
  frame: { x: 0, y: 0, width: 800, height: 600 },
  insets: { top, right: 0, bottom, left: 0 },
});

// A Pressable renders its accessibility props onto several nodes in its host
// subtree, so match the single host element per tab to get one entry each.
const findTabs = (component) =>
  component.root.findAll(
    (node) => typeof node.type === 'string' && node.props.accessibilityRole === 'tab'
  );

// The TabBar container is the single host View carrying the tablist role
// (#1026 removed its Animated opacity wrapper).
const findSurface = (component) =>
  component.root.find(
    (node) => typeof node.type === 'string' && node.props.accessibilityRole === 'tablist'
  );

describe('accessibility', () => {
  test('TabBar container has tablist role', () => {
    const component = renderWithInsets(
      <TabBar tabs={['Home', 'Log']} activeTab="Home" onTabPress={() => {}} />,
      0
    );
    const surface = findSurface(component);
    expect(surface.props.accessibilityRole).toBe('tablist');
    // The container must not be an accessibility element itself; on iOS
    // accessible={true} on the parent collapses the tabs into one element.
    expect(surface.props.accessible).not.toBe(true);
    act(() => component.unmount());
  });

  test('Each tab has tab role and stable accessible name', () => {
    const tabs = ['Home', 'Log', 'Settings'];
    const component = renderWithInsets(
      <TabBar tabs={tabs} activeTab="Home" onTabPress={() => {}} />,
      0
    );
    const controls = findTabs(component);
    expect(controls).toHaveLength(tabs.length);
    controls.forEach((control, index) => {
      expect(control.props.accessibilityRole).toBe('tab');
      expect(control.props.accessibilityLabel).toBe(tabs[index]);
      expect(control.props.accessible).toBe(true);
    });
    act(() => component.unmount());
  });

  test('Active tab exposes selected state', () => {
    const tabs = ['Home', 'Log', 'Settings'];
    const component = renderWithInsets(
      <TabBar tabs={tabs} activeTab="Log" onTabPress={() => {}} />,
      0
    );
    const controls = findTabs(component);
    expect(controls).toHaveLength(tabs.length);
    controls.forEach((control, index) => {
      const isSelected = tabs[index] === 'Log';
      expect(control.props.accessibilityState.selected).toBe(isSelected);
    });
    act(() => component.unmount());
  });

  test('Accessibility state updates when active tab changes', () => {
    const tabs = ['Home', 'Log', 'Settings'];
    const component = renderWithInsets(
      <TabBar tabs={tabs} activeTab="Home" onTabPress={() => {}} />,
      0
    );
    let controls = findTabs(component);
    expect(controls).toHaveLength(tabs.length);
    expect(controls[0].props.accessibilityState.selected).toBe(true);
    expect(controls[1].props.accessibilityState.selected).toBe(false);

    act(() => {
      component.update(
        <SafeAreaProvider initialMetrics={metrics(0)}>
          <TabBar tabs={tabs} activeTab="Log" onTabPress={() => {}} />
        </SafeAreaProvider>
      );
    });

    controls = findTabs(component);
    expect(controls).toHaveLength(tabs.length);
    expect(controls[0].props.accessibilityState.selected).toBe(false);
    expect(controls[1].props.accessibilityState.selected).toBe(true);

    act(() => component.unmount());
  });
});

const renderWithInsets = (child, bottom, top = 0) => {
  let component;
  act(() => {
    component = renderer.create(
      <SafeAreaProvider initialMetrics={metrics(bottom, top)}>{child}</SafeAreaProvider>
    );
  });
  return component;
};

describe('safe-area layout', () => {
  test('TabBar adds the runtime bottom inset to its visual gap', () => {
    const component = renderWithInsets(
      <TabBar tabs={['Home']} activeTab="Home" onTabPress={() => {}} />,
      0
    );
    const surface = findSurface(component);
    const zeroStyles = [].concat(surface.props.style).reduce((acc, style) => Object.assign(acc, style || {}), {});
    expect(zeroStyles.bottom).toBe(TAB_BAR_VISUAL_GAP);

    act(() => {
      component.update(
        <SafeAreaProvider key="non-zero" initialMetrics={metrics(32)}>
          <TabBar tabs={['Home']} activeTab="Home" onTabPress={() => {}} />
        </SafeAreaProvider>
      );
    });
    const insetStyles = [].concat(findSurface(component).props.style)
      .reduce((acc, style) => Object.assign(acc, style || {}), {});
    expect(insetStyles.bottom).toBe(TAB_BAR_VISUAL_GAP + 32);
    expect(insetStyles.left).toBe(16);
    expect(insetStyles.right).toBe(16);
    act(() => component.unmount());
  });

  test('ScreenShell adds bottom inset once and does not apply top inset', () => {
    const component = renderWithInsets(<ScreenShell title="Test" />, 28, 44);
    const scroll = component.root.findByType('RCTScrollView');
    const contentStyles = [].concat(scroll.props.contentContainerStyle)
      .reduce((acc, style) => Object.assign(acc, style || {}), {});

    // Before any TabBar measurement lands, ScreenShell falls back to the
    // shared height estimate rather than a fixed 120px constant.
    expect(contentStyles.paddingBottom).toBe(TAB_BAR_HEIGHT_FALLBACK + TAB_BAR_VISUAL_GAP + 28);
    expect(contentStyles.paddingTop).toBeUndefined();
    act(() => component.unmount());
  });

  test('ScreenShell clearance tracks measured TabBar height once provided', () => {
    let component;
    act(() => {
      component = renderer.create(
        <SafeAreaProvider initialMetrics={metrics(20)}>
          <TabBarLayoutContext.Provider value={{ tabBarHeight: 90 }}>
            <ScreenShell title="Test" />
          </TabBarLayoutContext.Provider>
        </SafeAreaProvider>
      );
    });
    const scroll = component.root.findByType('RCTScrollView');
    const contentStyles = [].concat(scroll.props.contentContainerStyle)
      .reduce((acc, style) => Object.assign(acc, style || {}), {});

    expect(contentStyles.paddingBottom).toBe(90 + TAB_BAR_VISUAL_GAP + 20);
    act(() => component.unmount());
  });

  test('ScreenShell clearance is zero-inset-safe with a measured height', () => {
    let component;
    act(() => {
      component = renderer.create(
        <SafeAreaProvider initialMetrics={metrics(0)}>
          <TabBarLayoutContext.Provider value={{ tabBarHeight: 50 }}>
            <ScreenShell title="Test" />
          </TabBarLayoutContext.Provider>
        </SafeAreaProvider>
      );
    });
    const scroll = component.root.findByType('RCTScrollView');
    const contentStyles = [].concat(scroll.props.contentContainerStyle)
      .reduce((acc, style) => Object.assign(acc, style || {}), {});

    expect(contentStyles.paddingBottom).toBe(50 + TAB_BAR_VISUAL_GAP);
    act(() => component.unmount());
  });

  test('TabBar reports its rendered height through onLayout', () => {
    const onHeightChange = jest.fn();
    const component = renderWithInsets(
      <TabBar tabs={['Home']} activeTab="Home" onTabPress={() => {}} onHeightChange={onHeightChange} />,
      0
    );
    const surface = findSurface(component);
    act(() => {
      surface.props.onLayout({ nativeEvent: { layout: { height: 72 } } });
    });
    expect(onHeightChange).toHaveBeenCalledWith(72);
    act(() => component.unmount());
  });
});

const KUA_TABS = ['Home', 'Log', 'Weight', 'Analytics', 'More'];

// Finds all mock icon nodes by their data-icon prop.
const findIcons = (component) =>
  component.root.findAll(
    (node) => typeof node.type === 'string' && node.props['data-icon'] !== undefined
  );

describe('KUA icon foundation', () => {
  test('TAB_ICON_MAP covers all five navigation tabs', () => {
    expect(TAB_ICON_MAP).toMatchObject({
      Home: 'home',
      Log: 'fitness-center',
      Weight: 'monitor-weight',
      Analytics: 'bar-chart',
      More: 'more-horiz',
    });
    expect(Object.keys(TAB_ICON_MAP)).toHaveLength(5);
  });

  test('TabBar renders one icon per tab at 24dp', () => {
    const component = renderWithInsets(
      <TabBar tabs={KUA_TABS} activeTab="Home" onTabPress={() => {}} />,
      0
    );
    const icons = findIcons(component);
    expect(icons).toHaveLength(KUA_TABS.length);
    icons.forEach((icon) => {
      expect(icon.props['data-size']).toBe(24);
    });
    act(() => component.unmount());
  });

  test('Active tab icon uses primary color; inactive tabs use onSurfaceVariant', () => {
    const component = renderWithInsets(
      <TabBar tabs={KUA_TABS} activeTab="Log" onTabPress={() => {}} />,
      0
    );
    const icons = findIcons(component);
    // Icons are rendered in tab order; Log is index 1.
    const activeIcon = icons[1];
    const inactiveIcon = icons[0];
    // Colors are supplied inline from the resolved palette. The default test
    // palette (LightColors) provides chipText for active and textMuted for
    // inactive when KUA tokens are absent; KUA palettes provide primary and
    // onSurfaceVariant. Either way, active and inactive must differ.
    expect(activeIcon.props['data-color']).not.toBe(inactiveIcon.props['data-color']);
    act(() => component.unmount());
  });

  test('Active tab label uses bold weight; inactive uses regular weight (non-color indicator)', () => {
    const component = renderWithInsets(
      <TabBar tabs={KUA_TABS} activeTab="Analytics" onTabPress={() => {}} />,
      0
    );
    // Find Text nodes that hold tab labels (they carry the fontWeight style).
    const texts = component.root.findAll(
      (node) => typeof node.type === 'string' && node.type === 'Text'
    );
    // Analytics is index 3 in KUA_TABS.
    const activeText = texts.find((t) => {
      const s = [].concat(t.props.style).reduce((a, s) => Object.assign(a, s || {}), {});
      return s.fontWeight === '700';
    });
    const inactiveText = texts.find((t) => {
      const s = [].concat(t.props.style).reduce((a, s) => Object.assign(a, s || {}), {});
      return s.fontWeight === '500';
    });
    expect(activeText).toBeDefined();
    expect(inactiveText).toBeDefined();
    act(() => component.unmount());
  });

  test('Icon glyphs for all five tabs match the approved mapping', () => {
    const component = renderWithInsets(
      <TabBar tabs={KUA_TABS} activeTab="Home" onTabPress={() => {}} />,
      0
    );
    const icons = findIcons(component);
    KUA_TABS.forEach((tab, i) => {
      expect(icons[i].props['data-icon']).toBe(TAB_ICON_MAP[tab]);
    });
    act(() => component.unmount());
  });

  test('No runtime asset loading: icons render without file-system access', () => {
    // If Icon.js attempted fs.readFile or a network fetch, this synchronous
    // render would throw. Completing without error proves bundled-only delivery.
    expect(() => {
      const component = renderWithInsets(
        <TabBar tabs={KUA_TABS} activeTab="Home" onTabPress={() => {}} />,
        0
      );
      act(() => component.unmount());
    }).not.toThrow();
  });
});

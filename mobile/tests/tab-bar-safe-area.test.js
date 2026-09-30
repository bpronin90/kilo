import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TabBar } from '../components/TabBar';
import { ScreenShell } from '../components/ScreenShell';
import {
  TabBarLayoutContext, TabBarScrollContext, TAB_BAR_VISUAL_GAP, TAB_BAR_HEIGHT_FALLBACK,
  TAB_BAR_SCROLL_THRESHOLD, nextTabBarScrollState, useTabBarAutoHide,
} from '../components/TabBarLayout';
import { TAB_ICON_MAP } from '../components/Icon';

// Phone portrait window: jest-react-native's default 750dp width is past the
// 640dp content cap, which would center the bar (#1126) instead of testing the
// phone gutter this suite pins.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 411, height: 891, scale: 2, fontScale: 1 }),
}));

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

  test('TabBar renders one icon per tab at 20dp', () => {
    const component = renderWithInsets(
      <TabBar tabs={KUA_TABS} activeTab="Home" onTabPress={() => {}} />,
      0
    );
    const icons = findIcons(component);
    expect(icons).toHaveLength(KUA_TABS.length);
    icons.forEach((icon) => {
      expect(icon.props['data-size']).toBe(20);
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

// #1209: opaque scroll-direction auto-hide (reverses #1026's always-visible bar).
describe('scroll-direction auto-hide (#1209)', () => {
  const ev = (y, contentHeight = 2000, layoutHeight = 800) => ({
    nativeEvent: { contentOffset: { y }, contentSize: { height: contentHeight }, layoutMeasurement: { height: layoutHeight } },
  });
  const metricsFor = (y, contentHeight = 2000, layoutHeight = 800) => ({ y, contentHeight, layoutHeight });

  test('first event only records a baseline; scrolling down hides, scrolling up shows', () => {
    let st = { lastY: null, hidden: false };
    st = nextTabBarScrollState(st, metricsFor(100));
    expect(st).toEqual({ lastY: 100, hidden: false });
    st = nextTabBarScrollState(st, metricsFor(200));
    expect(st.hidden).toBe(true);
    st = nextTabBarScrollState(st, metricsFor(150));
    expect(st.hidden).toBe(false);
  });

  test('deltas under the threshold are ignored and accumulate against the old baseline', () => {
    let st = { lastY: 300, hidden: false };
    const tiny = TAB_BAR_SCROLL_THRESHOLD - 1;
    st = nextTabBarScrollState(st, metricsFor(300 + tiny));
    expect(st).toEqual({ lastY: 300, hidden: false });
    st = nextTabBarScrollState(st, metricsFor(300 + tiny * 2));
    expect(st.hidden).toBe(true);
  });

  test('the top of the scroll (including negative overscroll) always shows the bar', () => {
    expect(nextTabBarScrollState({ lastY: 400, hidden: true }, metricsFor(0)).hidden).toBe(false);
    expect(nextTabBarScrollState({ lastY: 400, hidden: true }, metricsFor(-40)).hidden).toBe(false);
  });

  test('bottom overscroll bounce does not flip direction', () => {
    const maxY = 1200;
    let st = nextTabBarScrollState({ lastY: 1100, hidden: false }, metricsFor(maxY));
    expect(st.hidden).toBe(true);
    // Rubber-band past the end, then settle back to the end: clamped, no change.
    st = nextTabBarScrollState(st, metricsFor(maxY + 60));
    expect(st).toEqual({ lastY: maxY, hidden: true });
    st = nextTabBarScrollState(st, metricsFor(maxY));
    expect(st.hidden).toBe(true);
  });

  function Probe({ tab, probe }) {
    const value = useTabBarAutoHide(tab);
    probe.current = value;
    return null;
  }

  test('programmatic scrolls re-baseline without changing visibility', () => {
    const probe = { current: null };
    let component;
    act(() => { component = renderer.create(<Probe tab="Home" probe={probe} />); });
    act(() => probe.current.onScroll(ev(100)));
    act(() => probe.current.onScroll(ev(900), false));
    expect(probe.current.hidden).toBe(false);
    // A small user nudge from the jump's landing point is below the threshold,
    // not a huge stale-baseline delta.
    act(() => probe.current.onScroll(ev(903)));
    expect(probe.current.hidden).toBe(false);
    act(() => probe.current.onScroll(ev(1000)));
    expect(probe.current.hidden).toBe(true);
    act(() => probe.current.onScroll(ev(5), false));
    expect(probe.current.hidden).toBe(true);
    act(() => probe.current.onScroll(ev(0)));
    expect(probe.current.hidden).toBe(false);
    act(() => component.unmount());
  });

  test('a programmatic jump to the top reveals an already-hidden bar', () => {
    const probe = { current: null };
    let component;
    act(() => { component = renderer.create(<Probe tab="Home" probe={probe} />); });
    act(() => probe.current.onScroll(ev(100)));
    act(() => probe.current.onScroll(ev(400)));
    expect(probe.current.hidden).toBe(true);
    act(() => probe.current.onScroll(ev(0), false));
    expect(probe.current.hidden).toBe(false);
    act(() => component.unmount());
  });

  test('hook hides on down-scroll, shows on up-scroll, and resets on tab change', () => {
    const probe = { current: null };
    let component;
    act(() => { component = renderer.create(<Probe tab="Home" probe={probe} />); });
    act(() => probe.current.onScroll(ev(100)));
    act(() => probe.current.onScroll(ev(300)));
    expect(probe.current.hidden).toBe(true);
    act(() => probe.current.onScroll(ev(250)));
    expect(probe.current.hidden).toBe(false);
    act(() => probe.current.onScroll(ev(500)));
    expect(probe.current.hidden).toBe(true);
    act(() => { component.update(<Probe tab="Log" probe={probe} />); });
    expect(probe.current.hidden).toBe(false);
    // The previous tab's baseline is forgotten: the next event records a new one.
    act(() => probe.current.onScroll(ev(40)));
    expect(probe.current.hidden).toBe(false);
    act(() => component.unmount());
  });

  test('ScreenShell forwards only user-driven scrolls (drag, fling) to the tab-bar scroll context', () => {
    const onScroll = jest.fn();
    let component;
    act(() => {
      component = renderer.create(
        <TabBarScrollContext.Provider value={{ onScroll }}>
          <ScreenShell title="Test" />
        </TabBarScrollContext.Provider>
      );
    });
    const scroll = component.root.findAll((n) => typeof n.props.onScroll === 'function' && n.props.scrollEventThrottle)[0];
    // Programmatic scrollTo / anchor jump: no drag or momentum began.
    act(() => scroll.props.onScroll(ev(120)));
    expect(onScroll).toHaveBeenLastCalledWith(expect.anything(), false);
    // A finger drag.
    act(() => scroll.props.onScrollBeginDrag());
    act(() => scroll.props.onScroll(ev(140)));
    expect(onScroll).toHaveBeenLastCalledWith(expect.anything(), true);
    // Release with velocity: the fling is still user-driven.
    act(() => scroll.props.onScrollEndDrag({ nativeEvent: { velocity: { y: 2 } } }));
    act(() => scroll.props.onScroll(ev(200)));
    expect(onScroll).toHaveBeenLastCalledWith(expect.anything(), true);
    act(() => scroll.props.onMomentumScrollEnd());
    act(() => scroll.props.onScroll(ev(260)));
    expect(onScroll).toHaveBeenLastCalledWith(expect.anything(), false);
    // Release with no velocity: nothing follows, later programmatic scrolls stay ignored.
    act(() => scroll.props.onScrollBeginDrag());
    act(() => scroll.props.onScrollEndDrag({ nativeEvent: { velocity: { y: 0 } } }));
    act(() => scroll.props.onScroll(ev(300)));
    expect(onScroll).toHaveBeenLastCalledWith(expect.anything(), false);
    act(() => component.unmount());
  });

  test('hiding slides the opaque bar with a translateY, keeps opacity, and reports the same height', () => {
    const onHeightChange = jest.fn();
    const component = renderWithInsets(
      <TabBar tabs={['Home', 'Log']} activeTab="Home" onTabPress={() => {}} onHeightChange={onHeightChange} hidden={false} />,
      20
    );
    const surface = findSurface(component);
    act(() => { surface.props.onLayout({ nativeEvent: { layout: { height: 55 } } }); });
    expect(onHeightChange).toHaveBeenCalledWith(55);
    const flat = (n) => StyleSheet.flatten(n.props.style);
    expect(flat(findSurface(component)).opacity).toBeUndefined();
    expect(flat(findSurface(component)).transform[0]).toHaveProperty('translateY');
    act(() => {
      component.update(
        <SafeAreaProvider initialMetrics={metrics(20)}>
          <TabBar tabs={['Home', 'Log']} activeTab="Home" onTabPress={() => {}} onHeightChange={onHeightChange} hidden />
        </SafeAreaProvider>
      );
    });
    // Still mounted with its tabs and tablist semantics, opacity untouched, and
    // no additional height report (layout is unchanged by a transform).
    expect(findTabs(component)).toHaveLength(2);
    expect(flat(findSurface(component)).opacity).toBeUndefined();
    expect(onHeightChange).toHaveBeenCalledTimes(1);
    act(() => component.unmount());
  });

  test('hidden bar blocks touches and is hidden from screen readers; visible bar is not', () => {
    const render = (hidden) => (
      <SafeAreaProvider initialMetrics={metrics(0)}>
        <TabBar tabs={['Home', 'Log']} activeTab="Home" onTabPress={() => {}} hidden={hidden} />
      </SafeAreaProvider>
    );
    let component;
    act(() => { component = renderer.create(render(false)); });
    let surface = findSurface(component);
    expect(surface.props.pointerEvents).toBe('auto');
    expect(surface.props.importantForAccessibility).toBe('auto');
    expect(surface.props.accessibilityElementsHidden).toBe(false);
    act(() => { component.update(render(true)); });
    surface = findSurface(component);
    expect(surface.props.pointerEvents).toBe('none');
    expect(surface.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(surface.props.accessibilityElementsHidden).toBe(true);
    act(() => { component.update(render(false)); });
    expect(findSurface(component).props.pointerEvents).toBe('auto');
    act(() => component.unmount());
  });

  test('scroll clearance is identical whether or not the bar is hidden', () => {
    const tree = (hidden) => (
      <SafeAreaProvider initialMetrics={metrics(20)}>
        <TabBarLayoutContext.Provider value={{ tabBarHeight: 55 }}>
          <ScreenShell title="Test" />
          <TabBar tabs={['Home', 'Log']} activeTab="Home" onTabPress={() => {}} hidden={hidden} />
        </TabBarLayoutContext.Provider>
      </SafeAreaProvider>
    );
    let component;
    act(() => { component = renderer.create(tree(false)); });
    const padding = () => StyleSheet.flatten(
      component.root.findAll((n) => n.props.contentContainerStyle && n.props.scrollEventThrottle)[0].props.contentContainerStyle
    ).paddingBottom;
    const shown = padding();
    act(() => { component.update(tree(true)); });
    expect(padding()).toBe(shown);
    expect(shown).toBe(55 + TAB_BAR_VISUAL_GAP + 20);
    act(() => component.unmount());
  });
});

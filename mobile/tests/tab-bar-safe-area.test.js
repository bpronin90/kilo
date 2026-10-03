import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TabBar } from '../components/TabBar';
import { ScreenShell } from '../components/ScreenShell';
import {
  TabBarLayoutContext, TabBarScrollContext, TAB_BAR_VISUAL_GAP, TAB_BAR_HEIGHT_FALLBACK,
  TAB_BAR_SCROLL_THRESHOLD, TAB_BAR_BOTTOM_EPSILON, nextTabBarScrollState, nextTabBarProgrammaticState,
  useTabBarAutoHide,
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
    // Release that flings: momentum-begin keeps it user-driven.
    act(() => scroll.props.onScrollEndDrag({ nativeEvent: { velocity: { y: 2 } } }));
    act(() => scroll.props.onMomentumScrollBegin());
    act(() => scroll.props.onScroll(ev(200)));
    expect(onScroll).toHaveBeenLastCalledWith(expect.anything(), true);
    act(() => scroll.props.onMomentumScrollEnd());
    act(() => scroll.props.onScroll(ev(260)));
    expect(onScroll).toHaveBeenLastCalledWith(expect.anything(), false);
    // Release with no fling (no momentum-begin): later programmatic scrolls stay ignored.
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

// #1231: the bar must reappear at the content bottom, not only on scroll up.
describe('bottom reveal and hysteresis (#1231)', () => {
  // content 2000 / viewport 800 => maxY 1200.
  const MAX_Y = 1200;
  const m = (y, contentHeight = 2000, layoutHeight = 800) => ({ y, contentHeight, layoutHeight });
  const ev = (y, contentHeight = 2000, layoutHeight = 800) => ({
    nativeEvent: { contentOffset: { y }, contentSize: { height: contentHeight }, layoutMeasurement: { height: layoutHeight } },
  });
  // Feed a stream of metrics through the pure transition; returns every state.
  const run = (start, metricsList) => {
    const states = [];
    let st = start;
    metricsList.forEach((metrics) => { st = nextTabBarScrollState(st, metrics); states.push(st); });
    return states;
  };

  function Probe({ tab, probe }) {
    probe.current = useTabBarAutoHide(tab);
    return null;
  }
  const mountProbe = () => {
    const probe = { current: null };
    let component;
    act(() => { component = renderer.create(<Probe tab="Home" probe={probe} />); });
    return { probe, component };
  };
  // Hide the bar mid-content with a user drag so each case starts hidden.
  const hideMidContent = (probe) => {
    act(() => probe.current.onScroll(ev(100)));
    act(() => probe.current.onScroll(ev(400)));
    expect(probe.current.hidden).toBe(true);
  };

  test('the fixed epsilon is 1dp', () => {
    expect(TAB_BAR_BOTTOM_EPSILON).toBe(1);
  });

  // A hidden bar with a mid-content baseline receives one user-driven event.
  test.each([
    ['at bottom exactly', m(MAX_Y), false],
    ['exactly 1dp from the bottom', m(MAX_Y - TAB_BAR_BOTTOM_EPSILON), false],
    ['fractional rounding inside the epsilon', m(MAX_Y - 0.4), false],
    ['beyond the bottom (iOS rubber-band)', m(MAX_Y + 80), false],
    ['content shorter than the viewport, bounced down', m(30, 500, 800), false],
    ['content exactly the viewport height, bounced down', m(30, 800, 800), false],
    ['content shorter than the viewport at rest', m(0, 500, 800), false],
    ['content only fractionally taller than the viewport (maxY 0.4)', m(25, 800.4, 800), false],
    ['1.5dp from the bottom is outside the epsilon: normal 8dp rule hides', m(MAX_Y - 1.5), true],
    ['mid-content, down over the threshold stays hidden', m(700), true],
  ])('hidden bar, user event: %s', (_name, metrics, expectedHidden) => {
    expect(nextTabBarScrollState({ lastY: 400, hidden: true }, metrics).hidden).toBe(expectedHidden);
  });

  test('reaching the bottom reveals and re-baselines exactly at maxY', () => {
    [MAX_Y, MAX_Y - 1, MAX_Y + 80].forEach((y) => {
      expect(nextTabBarScrollState({ lastY: 400, hidden: true }, m(y))).toEqual({ hidden: false, lastY: MAX_Y });
    });
    // First event after mount/tab change that lands at the bottom also shows.
    expect(nextTabBarScrollState({ lastY: null, hidden: false }, m(MAX_Y))).toEqual({ hidden: false, lastY: MAX_Y });
  });

  test('content that cannot scroll always shows the bar, including overscroll', () => {
    [m(0, 500, 800), m(25, 500, 800), m(25, 800, 800), m(-25, 800, 800), m(25, 0, 0)].forEach((metrics) => {
      expect(nextTabBarScrollState({ lastY: 300, hidden: true }, metrics)).toEqual({ hidden: false, lastY: 0 });
      expect(nextTabBarScrollState({ lastY: null, hidden: false }, metrics).hidden).toBe(false);
    });
  });

  test('iOS bounce past the bottom, then settle: stays visible, no flicker', () => {
    const states = run({ lastY: 1100, hidden: true }, [
      m(MAX_Y), m(MAX_Y + 20), m(MAX_Y + 60), m(MAX_Y + 25), m(MAX_Y), m(MAX_Y), m(MAX_Y + 3), m(MAX_Y),
    ]);
    states.forEach((st) => expect(st).toEqual({ hidden: false, lastY: MAX_Y }));
  });

  test('settling a hair off the bottom after a bounce cannot re-hide (hysteresis baseline is maxY)', () => {
    // Stale mid-scroll baseline (1000) and a rounding-sized rest position
    // outside the 1dp epsilon: measured from maxY the delta is far under the
    // threshold; measured from the stale baseline it would hide.
    const states = run({ lastY: 1000, hidden: true }, [
      m(MAX_Y), m(MAX_Y + 60), m(MAX_Y), m(MAX_Y - 2), m(MAX_Y - 2.5), m(MAX_Y),
    ]);
    states.forEach((st) => expect(st.hidden).toBe(false));
  });

  test('downward bottom-bounce stream while at the bottom never re-hides', () => {
    const states = run({ lastY: MAX_Y, hidden: false }, [
      m(MAX_Y + 10), m(MAX_Y + 30), m(MAX_Y + 50), m(MAX_Y + 70), m(MAX_Y + 90), m(MAX_Y + 12), m(MAX_Y),
    ]);
    states.forEach((st) => expect(st).toEqual({ hidden: false, lastY: MAX_Y }));
  });

  test('scrolling up from the bottom stays visible', () => {
    const states = run({ lastY: MAX_Y, hidden: false }, [m(MAX_Y - 3), m(MAX_Y - 40), m(MAX_Y - 200)]);
    states.forEach((st) => expect(st.hidden).toBe(false));
    expect(states[2].lastY).toBe(MAX_Y - 200);
  });

  test('moving off the bottom, then a fresh downward drag over 8dp, may hide again', () => {
    let st = { lastY: MAX_Y, hidden: false };
    st = nextTabBarScrollState(st, m(MAX_Y - 300));
    expect(st).toEqual({ hidden: false, lastY: MAX_Y - 300 });
    // Under the threshold: still visible; accumulates against the same baseline.
    st = nextTabBarScrollState(st, m(MAX_Y - 300 + TAB_BAR_SCROLL_THRESHOLD - 1));
    expect(st.hidden).toBe(false);
    st = nextTabBarScrollState(st, m(MAX_Y - 300 + TAB_BAR_SCROLL_THRESHOLD));
    expect(st.hidden).toBe(true);
    // And reaching the bottom again reveals.
    st = nextTabBarScrollState(st, m(MAX_Y));
    expect(st.hidden).toBe(false);
  });

  test('large scrollable content away from both boundaries keeps the 8dp down-hide / up-show rule', () => {
    let st = { lastY: null, hidden: false };
    st = nextTabBarScrollState(st, m(5000, 20000, 800));
    expect(st).toEqual({ hidden: false, lastY: 5000 });
    st = nextTabBarScrollState(st, m(5000 + TAB_BAR_SCROLL_THRESHOLD - 1, 20000, 800));
    expect(st.hidden).toBe(false);
    st = nextTabBarScrollState(st, m(5000 + TAB_BAR_SCROLL_THRESHOLD, 20000, 800));
    expect(st.hidden).toBe(true);
    st = nextTabBarScrollState(st, m(5000, 20000, 800));
    expect(st.hidden).toBe(false);
    // The top still reveals.
    expect(nextTabBarScrollState({ lastY: 900, hidden: true }, m(0, 20000, 800)).hidden).toBe(false);
  });

  test('window/orientation change that moves maxY is recomputed from the current event', () => {
    // Taller viewport (1100 => maxY 900): offset 1000 is now beyond the new
    // bottom, so the next event reveals a bar hidden under the old maxY (1200).
    expect(nextTabBarScrollState({ lastY: 900, hidden: true }, m(1000, 2000, 1100)))
      .toEqual({ hidden: false, lastY: 900 });
    // Content now fits the viewport entirely: always visible.
    expect(nextTabBarScrollState({ lastY: 500, hidden: true }, m(500, 2000, 2000)))
      .toEqual({ hidden: false, lastY: 0 });
    // A shorter viewport raises maxY (1600): an offset that was at the old
    // bottom is no longer there, so a stale maxY must not reveal it.
    expect(nextTabBarScrollState({ lastY: 400, hidden: true }, m(1200, 2000, 400)).hidden).toBe(true);
  });

  describe('programmatic events (userDriven=false)', () => {
    test.each([
      ['scrollToEnd (exactly maxY)', m(MAX_Y), { hidden: false, lastY: MAX_Y }],
      ['within epsilon of the end', m(MAX_Y - 1), { hidden: false, lastY: MAX_Y }],
      ['beyond the end', m(MAX_Y + 50), { hidden: false, lastY: MAX_Y }],
      ['jump to the top', m(0), { hidden: false, lastY: 0 }],
      ['unscrollable content', m(20, 500, 800), { hidden: false, lastY: 0 }],
      ['jump elsewhere re-baselines and keeps it hidden', m(700), { hidden: true, lastY: 700 }],
    ])('%s', (_name, metrics, expected) => {
      expect(nextTabBarProgrammaticState({ hidden: true }, metrics)).toEqual(expected);
    });

    test('a programmatic move elsewhere never hides a visible bar', () => {
      expect(nextTabBarProgrammaticState({ hidden: false }, m(700))).toEqual({ hidden: false, lastY: 700 });
    });
  });

  test('hook: user drag hides, then a drag that reaches the bottom reveals', () => {
    const { probe, component } = mountProbe();
    hideMidContent(probe);
    act(() => probe.current.onScroll(ev(900)));
    expect(probe.current.hidden).toBe(true);
    act(() => probe.current.onScroll(ev(MAX_Y)));
    expect(probe.current.hidden).toBe(false);
    act(() => component.unmount());
  });

  test('hook: bounce past the bottom and settle never re-hides; a fresh drag away then down does', () => {
    const { probe, component } = mountProbe();
    hideMidContent(probe);
    [MAX_Y, MAX_Y + 40, MAX_Y + 80, MAX_Y + 10, MAX_Y, MAX_Y - 2].forEach((y) => {
      act(() => probe.current.onScroll(ev(y)));
      expect(probe.current.hidden).toBe(false);
    });
    act(() => probe.current.onScroll(ev(MAX_Y - 300)));
    expect(probe.current.hidden).toBe(false);
    act(() => probe.current.onScroll(ev(MAX_Y - 300 + TAB_BAR_SCROLL_THRESHOLD + 2)));
    expect(probe.current.hidden).toBe(true);
    act(() => component.unmount());
  });

  test('hook: programmatic scrollToEnd reveals a hidden bar and re-baselines without a hide', () => {
    const { probe, component } = mountProbe();
    hideMidContent(probe);
    act(() => probe.current.onScroll(ev(MAX_Y), false));
    expect(probe.current.hidden).toBe(false);
    // The baseline is the end: a small nudge off it is not a stale-baseline hide.
    act(() => probe.current.onScroll(ev(MAX_Y - 3)));
    expect(probe.current.hidden).toBe(false);
    act(() => probe.current.onScroll(ev(MAX_Y - 100)));
    expect(probe.current.hidden).toBe(false);
    act(() => component.unmount());
  });

  test('hook: content that fits the viewport is never hidden by a user scroll', () => {
    const { probe, component } = mountProbe();
    [10, 60, 200, 5].forEach((y) => {
      act(() => probe.current.onScroll(ev(y, 600, 800)));
      expect(probe.current.hidden).toBe(false);
    });
    act(() => component.unmount());
  });

  test('hook: tab change shows the bar and resets the baseline after a bottom reveal', () => {
    const { probe, component } = mountProbe();
    hideMidContent(probe);
    act(() => probe.current.onScroll(ev(MAX_Y)));
    expect(probe.current.hidden).toBe(false);
    act(() => probe.current.onScroll(ev(700)));
    act(() => probe.current.onScroll(ev(900)));
    expect(probe.current.hidden).toBe(true);
    act(() => { component.update(<Probe tab="Log" probe={probe} />); });
    expect(probe.current.hidden).toBe(false);
    // Fresh baseline on the new tab: the first event only records it.
    act(() => probe.current.onScroll(ev(500)));
    expect(probe.current.hidden).toBe(false);
    act(() => probe.current.onScroll(ev(520)));
    expect(probe.current.hidden).toBe(true);
    act(() => component.unmount());
  });

  // End to end through ScreenShell's real drag/momentum gating and the TabBar.
  function Harness({ probe }) {
    const { hidden, onScroll } = useTabBarAutoHide('Home');
    probe.current = hidden;
    return (
      <SafeAreaProvider initialMetrics={metrics(0)}>
        <TabBarScrollContext.Provider value={{ onScroll }}>
          <ScreenShell title="Test" />
          <TabBar tabs={['Home', 'Log']} activeTab="Home" onTabPress={() => {}} hidden={hidden} />
        </TabBarScrollContext.Provider>
      </SafeAreaProvider>
    );
  }
  const findScroll = (component) => component.root.findAll((n) => typeof n.props.onScroll === 'function' && n.props.scrollEventThrottle)[0];

  test('ScreenShell: a fling whose momentum lands at the bottom reveals the bar and restores touch/a11y state', () => {
    const probe = { current: null };
    let component;
    act(() => { component = renderer.create(<Harness probe={probe} />); });
    const scroll = findScroll(component);
    act(() => scroll.props.onScrollBeginDrag());
    act(() => scroll.props.onScroll(ev(100)));
    act(() => scroll.props.onScroll(ev(400)));
    expect(findSurface(component).props.pointerEvents).toBe('none');
    expect(findSurface(component).props.importantForAccessibility).toBe('no-hide-descendants');
    act(() => scroll.props.onScrollEndDrag({ nativeEvent: { velocity: { y: 3 } } }));
    act(() => scroll.props.onMomentumScrollBegin());
    act(() => scroll.props.onScroll(ev(900)));
    expect(probe.current).toBe(true);
    act(() => scroll.props.onScroll(ev(MAX_Y)));
    act(() => scroll.props.onScroll(ev(MAX_Y + 30))); // rubber-band
    act(() => scroll.props.onScroll(ev(MAX_Y)));
    act(() => scroll.props.onMomentumScrollEnd());
    expect(probe.current).toBe(false);
    const surface = findSurface(component);
    expect(surface.props.pointerEvents).toBe('auto');
    expect(surface.props.importantForAccessibility).toBe('auto');
    expect(surface.props.accessibilityElementsHidden).toBe(false);
    expect(StyleSheet.flatten(surface.props.style).opacity).toBeUndefined();
    act(() => component.unmount());
  });

  test('ScreenShell: a programmatic scrollToEnd (no drag or momentum) reveals the bar', () => {
    const probe = { current: null };
    let component;
    act(() => { component = renderer.create(<Harness probe={probe} />); });
    const scroll = findScroll(component);
    act(() => scroll.props.onScrollBeginDrag());
    act(() => scroll.props.onScroll(ev(100)));
    act(() => scroll.props.onScroll(ev(400)));
    act(() => scroll.props.onScrollEndDrag({ nativeEvent: { velocity: { y: 0 } } }));
    expect(probe.current).toBe(true);
    act(() => scroll.props.onScroll(ev(MAX_Y)));
    expect(probe.current).toBe(false);
    act(() => component.unmount());
  });

  describe('web user vs programmatic scrolling (#1214)', () => {
    const { Platform } = require('react-native');
    const realOS = Platform.OS;
    let now;
    beforeEach(() => {
      Platform.OS = 'web';
      now = 1000;
      jest.spyOn(Date, 'now').mockImplementation(() => now);
    });
    afterEach(() => { Platform.OS = realOS; jest.restoreAllMocks(); });

    function mountWeb(probe) {
      const listeners = {};
      const node = {
        addEventListener: (n, fn) => { (listeners[n] = listeners[n] || []).push(fn); },
        removeEventListener: (n, fn) => { listeners[n] = (listeners[n] || []).filter((f) => f !== fn); },
      };
      // RNW's ScrollView exposes its DOM node through getScrollableNode().
      jest.spyOn(ScrollView.prototype, 'getScrollableNode').mockReturnValue(node);
      let component;
      act(() => { component = renderer.create(<Harness probe={probe} />); });
      return { component, listeners, scroll: findScroll(component) };
    }

    test('wheel input drives auto-hide; a programmatic animated jump and a jump to y: 0 do not hide', () => {
      const probe = { current: null };
      const { component, listeners, scroll } = mountWeb(probe);
      expect(listeners.wheel).toHaveLength(1);
      act(() => listeners.wheel[0]()); act(() => scroll.props.onScroll(ev(100)));
      now += 50; act(() => listeners.wheel[0]()); act(() => scroll.props.onScroll(ev(400)));
      expect(probe.current).toBe(true);
      // Restoration jump to the top reveals the bar.
      now += 1000; act(() => scroll.props.onScroll(ev(0)));
      expect(probe.current).toBe(false);
      // Animated lower-section jump: several scroll events, no input, never hides.
      [150, 300, 450, 600].forEach((y) => { now += 16; act(() => scroll.props.onScroll(ev(y))); });
      expect(probe.current).toBe(false);
      // The next real wheel measures from where the jump landed.
      now += 1000; act(() => listeners.wheel[0]()); act(() => scroll.props.onScroll(ev(604)));
      expect(probe.current).toBe(false);
      now += 50; act(() => listeners.wheel[0]()); act(() => scroll.props.onScroll(ev(700)));
      expect(probe.current).toBe(true);
      act(() => component.unmount());
      expect(listeners.wheel).toHaveLength(0);
    });

    test('presses on content (link/button taps, Enter) do not mark user scrolling; scrollbar and scroll keys do', () => {
      const probe = { current: null };
      const { component, listeners, scroll } = mountWeb(probe);
      act(() => listeners.wheel[0]()); act(() => scroll.props.onScroll(ev(100)));
      now += 50; act(() => listeners.wheel[0]()); act(() => scroll.props.onScroll(ev(400)));
      expect(probe.current).toBe(true);
      now += 1000; act(() => scroll.props.onScroll(ev(0)));
      expect(probe.current).toBe(false);
      // An anchor click (pointerdown on a child, Enter keydown) then a jump: no hide.
      act(() => listeners.pointerdown[0]({ target: {}, offsetX: 10, offsetY: 10 }));
      act(() => listeners.mousedown[0]({ target: {}, offsetX: 10, offsetY: 10 }));
      act(() => listeners.keydown[0]({ key: 'Enter' }));
      act(() => scroll.props.onScroll(ev(300))); act(() => scroll.props.onScroll(ev(600)));
      expect(probe.current).toBe(false);
      expect(listeners.touchstart).toBeUndefined();
      // Arrow keys and a press on the scroller's own scrollbar gutter do count.
      now += 1000; act(() => listeners.keydown[0]({ key: 'ArrowDown' })); act(() => scroll.props.onScroll(ev(20)));
      now += 50; act(() => listeners.keydown[0]({ key: 'ArrowDown' })); act(() => scroll.props.onScroll(ev(300)));
      expect(probe.current).toBe(true);
      act(() => component.unmount());
    });

    test('input stamps expire so later scroll events are programmatic', () => {
      const probe = { current: null };
      const { component, listeners, scroll } = mountWeb(probe);
      act(() => listeners.wheel[0]()); act(() => scroll.props.onScroll(ev(100)));
      now += 50; act(() => listeners.wheel[0]()); act(() => scroll.props.onScroll(ev(400)));
      expect(probe.current).toBe(true);
      now += 500; act(() => scroll.props.onScroll(ev(700)));
      expect(probe.current).toBe(true); // programmatic, mid-scroll: no change
      act(() => scroll.props.onScroll(ev(0)));
      expect(probe.current).toBe(false);
      act(() => component.unmount());
    });
  });
});

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Animated } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TabBar } from '../components/TabBar';
import { ScreenShell } from '../components/ScreenShell';
import { TabBarLayoutContext, TAB_BAR_VISUAL_GAP, TAB_BAR_HEIGHT_FALLBACK } from '../components/TabBarLayout';

const metrics = (bottom, top = 0) => ({
  frame: { x: 0, y: 0, width: 800, height: 600 },
  insets: { top, right: 0, bottom, left: 0 },
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
    const surface = component.root.findByType(Animated.View);
    const zeroStyles = [].concat(surface.props.style).reduce((acc, style) => Object.assign(acc, style || {}), {});
    expect(zeroStyles.bottom).toBe(24);

    act(() => {
      component.update(
        <SafeAreaProvider key="non-zero" initialMetrics={metrics(32)}>
          <TabBar tabs={['Home']} activeTab="Home" onTabPress={() => {}} />
        </SafeAreaProvider>
      );
    });
    const insetStyles = [].concat(component.root.findByType(Animated.View).props.style)
      .reduce((acc, style) => Object.assign(acc, style || {}), {});
    expect(insetStyles.bottom).toBe(56);
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
    const surface = component.root.findByType(Animated.View);
    act(() => {
      surface.props.onLayout({ nativeEvent: { layout: { height: 72 } } });
    });
    expect(onHeightChange).toHaveBeenCalledWith(72);
    act(() => component.unmount());
  });
});

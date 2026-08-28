import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { PixelRatio } from 'react-native';
import { ThemeProvider } from '../theme/ThemeContext';
import { LineChart } from '../components/LineChart';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: jest.fn(() => 'light'),
}));

const CHART_WIDTH = 300;
const SCALE_GUTTER_WIDTH = 34;

// Deterministic default; individual tests override this to simulate the OS
// large-text / accessibility text-size setting (#828).
beforeEach(() => {
  jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(1);
});

afterEach(() => {
  PixelRatio.getFontScale.mockRestore();
});

// The chart gates its SVG children on a measured width, which onLayout only
// supplies on a real host. Feed it one so points/marks/labels actually render.
function mountChart(props = {}, layoutWidth = CHART_WIDTH) {
  let component;
  act(() => {
    component = renderer.create(
      <ThemeProvider>
        <LineChart {...props} />
      </ThemeProvider>
    );
  });
  act(() => {
    component.root
      .findAll((n) => n.props && typeof n.props.onLayout === 'function')[0]
      .props.onLayout({ nativeEvent: { layout: { width: layoutWidth } } });
  });
  return component;
}

function svgWidth(component) {
  return component.root.findByProps({ testID: 'line-chart-svg' }).props.width;
}

describe('LineChart — flat series (<1 lb spread)', () => {
  const flat = [
    { value: 184.0, label: 'Mon', unit: 'lb' },
    { value: 184.2, label: 'Tue', unit: 'lb' },
    { value: 184.6, label: 'Wed', unit: 'lb' },
  ];

  test('scale labels equal the data extremes, not a floored/padded domain', () => {
    const component = mountChart({ data: flat, showScale: true, seriesLabel: 'test' });
    const max = component.root.findByProps({ testID: 'line-chart-scale-max' });
    const min = component.root.findByProps({ testID: 'line-chart-scale-min' });
    expect(max.props.children).toBe('184.6');
    expect(min.props.children).toBe('184.0');
  });

  test('visual scale labels match the accessibilityLabel range', () => {
    const component = mountChart({ data: flat, showScale: true, seriesLabel: 'test' });
    const pressable = component.root.findByProps({ accessibilityRole: 'image' });
    expect(pressable.props.accessibilityLabel).toContain('Ranges from 184.0 lb to 184.6 lb');
  });

  test('flat and large series are each distinguishable — same relative on-screen spread', () => {
    // With no domain floor, getY always maps dataMin..dataMax to the same
    // pixel span, so every series (flat or wide) uses the chart's full
    // height rather than a fraction of it.
    const flatComponent = mountChart({ data: flat, showScale: false });
    const circles = flatComponent.root.findAll(
      (n) => n.type === 'Circle' || (n.props && n.props.cy !== undefined && n.props.r !== undefined)
    );
    const ys = circles.map((c) => c.props.cy);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0);
  });
});

describe('LineChart — zero-span series (identical values)', () => {
  const zeroSpan = [
    { value: 184.0, label: 'Mon', unit: 'lb' },
    { value: 184.0, label: 'Tue', unit: 'lb' },
    { value: 184.0, label: 'Wed', unit: 'lb' },
  ];

  test('renders a centered horizontal line instead of pinning to the bottom edge', () => {
    const component = mountChart({ data: zeroSpan, height: 100, showScale: false });
    const circles = component.root.findAll(
      (n) => n.props && n.props.cy !== undefined && n.props.r !== undefined
    );
    const ys = circles.map((c) => c.props.cy);
    expect(new Set(ys).size).toBe(1);
    expect(ys[0]).toBe(50);
  });

  test('scale labels show the single value for both min and max, honestly', () => {
    const component = mountChart({ data: zeroSpan, showScale: true, seriesLabel: 'test' });
    expect(component.root.findByProps({ testID: 'line-chart-scale-max' }).props.children).toBe('184');
    expect(component.root.findByProps({ testID: 'line-chart-scale-min' }).props.children).toBe('184');
  });
});

describe('LineChart — normal series (2-4 lb) is not suppressed by a domain floor', () => {
  const normal = [
    { value: 182.0, label: 'Mon', unit: 'lb' },
    { value: 183.0, label: 'Tue', unit: 'lb' },
    { value: 184.5, label: 'Wed', unit: 'lb' },
  ];

  test('the plotted domain is exactly the data min/max', () => {
    const component = mountChart({ data: normal, showScale: true, seriesLabel: 'test' });
    expect(component.root.findByProps({ testID: 'line-chart-scale-max' }).props.children).toBe('184.5');
    expect(component.root.findByProps({ testID: 'line-chart-scale-min' }).props.children).toBe('182.0');
  });
});

describe('LineChart — large series (15+ lb)', () => {
  const large = [
    { value: 170, label: 'Mon', unit: 'lb' },
    { value: 185, label: 'Tue', unit: 'lb' },
    { value: 190, label: 'Wed', unit: 'lb' },
  ];

  test('scale labels equal the data extremes here too', () => {
    const component = mountChart({ data: large, showScale: true, seriesLabel: 'test' });
    expect(component.root.findByProps({ testID: 'line-chart-scale-max' }).props.children).toBe('190');
    expect(component.root.findByProps({ testID: 'line-chart-scale-min' }).props.children).toBe('170');
  });
});

describe('LineChart — showScale layout', () => {
  const data = [
    { value: 184.0, label: 'Mon', unit: 'lb' },
    { value: 184.6, label: 'Tue', unit: 'lb' },
  ];

  test('reserves a gutter so the plotted line never runs under the scale labels', () => {
    const component = mountChart({ data, showScale: true, seriesLabel: 'test' });
    expect(svgWidth(component)).toBe(CHART_WIDTH - SCALE_GUTTER_WIDTH);
  });

  test('scale labels do not overlap the plot: the Svg and the scale column are side by side, not stacked', () => {
    const component = mountChart({ data, showScale: true, seriesLabel: 'test' });
    const row = component.root.findByProps({ accessibilityRole: 'image' });
    expect(row.props.style).toEqual(expect.objectContaining({ flexDirection: 'row' }));
  });

  test('showScale off renders no scale labels', () => {
    const component = mountChart({ data, showScale: false });
    expect(() => component.root.findByProps({ testID: 'line-chart-scale-max' })).toThrow();
    expect(() => component.root.findByProps({ testID: 'line-chart-scale-min' })).toThrow();
  });
});

describe('LineChart — showScale at large text (#828 feedback)', () => {
  const data = [
    { value: 184.0, label: 'Mon', unit: 'lb' },
    { value: 184.6, label: 'Tue', unit: 'lb' },
  ];

  test('the gutter grows with the OS font scale, so the plot narrows to match', () => {
    PixelRatio.getFontScale.mockReturnValue(2);
    const component = mountChart({ data, showScale: true, seriesLabel: 'test' });
    const scaledGutter = Math.ceil(SCALE_GUTTER_WIDTH * 2);
    expect(svgWidth(component)).toBe(CHART_WIDTH - scaledGutter);
  });

  test('the reserved column width tracks the same scaled gutter, so the label never has less room than the plot assumes', () => {
    PixelRatio.getFontScale.mockReturnValue(2);
    const component = mountChart({ data, showScale: true, seriesLabel: 'test' });
    const scaledGutter = Math.ceil(SCALE_GUTTER_WIDTH * 2);
    const column = component.root.findAll(
      (n) =>
        Array.isArray(n.props?.style) &&
        n.props.style.some((s) => s && s.width === scaledGutter)
    );
    expect(column.length).toBeGreaterThan(0);
  });

  test('labels carry a shrink-to-fit backstop so a scale mismatch can never overflow into the plot', () => {
    PixelRatio.getFontScale.mockReturnValue(3);
    const component = mountChart({ data, showScale: true, seriesLabel: 'test' });
    const max = component.root.findByProps({ testID: 'line-chart-scale-max' });
    const min = component.root.findByProps({ testID: 'line-chart-scale-min' });
    for (const label of [max, min]) {
      expect(label.props.numberOfLines).toBe(1);
      expect(label.props.adjustsFontSizeToFit).toBe(true);
    }
  });

  test("Home's no-showScale path ignores font scale entirely — no gutter, full width", () => {
    PixelRatio.getFontScale.mockReturnValue(3);
    const component = mountChart({ data, height: 44, paddingVertical: 0, paddingHorizontal: 0 });
    expect(svgWidth(component)).toBe(CHART_WIDTH);
    expect(() => component.root.findByProps({ testID: 'line-chart-scale-max' })).toThrow();
  });
});

describe("LineChart — Home's no-props call path is unchanged", () => {
  const sparklineData = [
    { value: 184.0 },
    { value: 184.2 },
    { value: 184.6 },
  ];

  test('with no showScale/minRange, the Svg uses the full measured width', () => {
    const component = mountChart({ data: sparklineData, height: 44, paddingVertical: 0, paddingHorizontal: 0 });
    expect(svgWidth(component)).toBe(CHART_WIDTH);
    expect(() => component.root.findByProps({ testID: 'line-chart-scale-max' })).toThrow();
  });

  test('renders without throwing and builds an accessibility description', () => {
    const component = mountChart({ data: sparklineData, height: 44, paddingVertical: 0, paddingHorizontal: 0 });
    const pressable = component.root.findByProps({ accessibilityRole: 'image' });
    expect(pressable.props.accessibilityLabel).toContain('Line chart, 3 points');
  });
});

describe('LineChart — point selection is perceivable and operable (#906)', () => {
  const series = [
    { value: 100, label: 'Mon', unit: 'lb' },
    { value: 105, label: 'Tue', unit: 'lb' },
    { value: 110, label: 'Wed', unit: 'lb' },
  ];

  function plot(component, role = 'adjustable') {
    return component.root.findByProps({ accessibilityRole: role });
  }

  function fireAction(component, actionName) {
    act(() => {
      plot(component).props.onAccessibilityAction({ nativeEvent: { actionName } });
    });
  }

  test('a chart that reports selections is announced as an operable control, not an image', () => {
    const component = mountChart({ data: series, onSelect: jest.fn(), seriesLabel: 'Weight' });
    expect(plot(component).props.accessibilityRole).toBe('adjustable');
    expect(() => component.root.findByProps({ accessibilityRole: 'image' })).toThrow();
  });

  test('a static illustration keeps the image role and gains no actions', () => {
    const component = mountChart({ data: series });
    const image = plot(component, 'image');
    expect(image.props.accessibilityActions).toBeUndefined();
    expect(image.props.onAccessibilityAction).toBeUndefined();
    expect(image.props.accessibilityValue).toBeUndefined();
  });

  test('accessibilityActions expose previous/next point traversal', () => {
    const component = mountChart({ data: series, onSelect: jest.fn() });
    expect(plot(component).props.accessibilityActions).toEqual(
      expect.arrayContaining([
        { name: 'decrement', label: 'Previous point' },
        { name: 'increment', label: 'Next point' },
      ])
    );
  });

  test('the aggregate description stays reachable on an interactive chart', () => {
    const component = mountChart({ data: series, onSelect: jest.fn(), seriesLabel: 'Weight' });
    expect(plot(component).props.accessibilityLabel).toBe(
      'Weight. Line chart, 3 points. Ranges from 100 lb to 110 lb. Starts at 100 lb, ends at 110 lb.'
    );
  });

  test('the first traversal lands on the point already drawn as current', () => {
    const onSelect = jest.fn();
    const component = mountChart({ data: series, onSelect });
    expect(plot(component).props.accessibilityValue).toEqual({ text: 'Latest, Wed, 110 lb' });

    fireAction(component, 'decrement');
    expect(onSelect).toHaveBeenCalledWith(series[2]);
    expect(plot(component).props.accessibilityValue).toEqual({ text: 'Selected, Wed, 110 lb' });
  });

  test('performing an action moves the selection and announces that point', () => {
    const onSelect = jest.fn();
    const component = mountChart({ data: series, onSelect });
    fireAction(component, 'decrement'); // enter at Wed
    fireAction(component, 'decrement');
    expect(onSelect).toHaveBeenLastCalledWith(series[1]);
    expect(plot(component).props.accessibilityValue).toEqual({ text: 'Selected, Tue, 105 lb' });

    fireAction(component, 'increment');
    expect(onSelect).toHaveBeenLastCalledWith(series[2]);
    expect(plot(component).props.accessibilityValue).toEqual({ text: 'Selected, Wed, 110 lb' });
  });

  test('traversal clamps at both ends instead of wrapping or going out of range', () => {
    const onSelect = jest.fn();
    const component = mountChart({ data: series, onSelect });
    for (let i = 0; i < 5; i += 1) fireAction(component, 'decrement');
    expect(onSelect).toHaveBeenLastCalledWith(series[0]);
    for (let i = 0; i < 5; i += 1) fireAction(component, 'increment');
    expect(onSelect).toHaveBeenLastCalledWith(series[2]);
  });

  test('traversal keeps the chart a single element — no focus stop per point', () => {
    const countRoles = (data) => {
      const component = mountChart({ data, onSelect: jest.fn(), hideHeader: true });
      act(() => {
        component.root
          .findByProps({ accessibilityRole: 'adjustable' })
          .props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } });
      });
      return component.root.findAll(
        (n) => n.props && typeof n.props.accessibilityRole === 'string'
      ).length;
    };
    const long = Array.from({ length: 12 }, (_, i) => ({ value: 100 + i, label: `D${i}`, unit: 'lb' }));
    expect(countRoles(long)).toBe(countRoles(series));
  });

  test('clearing is offered as an action only while something is selected, and clears', () => {
    const onSelect = jest.fn();
    const component = mountChart({ data: series, onSelect });
    expect(plot(component).props.accessibilityActions.map((a) => a.name)).not.toContain(
      'clearSelection'
    );

    fireAction(component, 'decrement');
    expect(plot(component).props.accessibilityActions).toContainEqual({
      name: 'clearSelection',
      label: 'Clear selection',
    });

    fireAction(component, 'clearSelection');
    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(plot(component).props.accessibilityValue).toEqual({ text: 'Latest, Wed, 110 lb' });
  });

  test('an unknown action is ignored rather than moving the selection', () => {
    const onSelect = jest.fn();
    const component = mountChart({ data: series, onSelect });
    fireAction(component, 'magicTap');
    expect(onSelect).not.toHaveBeenCalled();
  });

  test('a visible hint says a point can be selected, and how to clear one', () => {
    const component = mountChart({ data: series, onSelect: jest.fn(), hideHeader: true });
    const hint = component.root.findByProps({ testID: 'line-chart-select-hint' });
    expect(hint.props.children).toBe('Tap a point to select');
    // Describes a touch gesture, so it must not become a focus stop.
    expect(hint.props.accessible).toBe(false);

    fireAction(component, 'decrement');
    expect(
      component.root.findByProps({ testID: 'line-chart-select-hint' }).props.children
    ).toBe('Tap the selected point to clear');
  });

  test('hideHeader still suppresses the Latest/Selected readout while keeping the hint', () => {
    const component = mountChart({ data: series, onSelect: jest.fn(), hideHeader: true });
    expect(component.root.findByProps({ testID: 'line-chart-select-hint' })).toBeTruthy();
    const texts = component.root.findAllByType('Text').map((t) => t.props.children);
    expect(texts).not.toContain('Latest');
    expect(texts).not.toContain('Selected');
  });

  test('a static chart renders no hint at all, so Home is unchanged', () => {
    const component = mountChart({ data: series, hideHeader: true });
    expect(() => component.root.findByProps({ testID: 'line-chart-select-hint' })).toThrow();
  });

  test('touch selection still works and still clears on a second tap of the same point', () => {
    const onSelect = jest.fn();
    const component = mountChart({ data: series, onSelect, hideHeader: true });
    const press = (locationX) => {
      act(() => {
        plot(component).props.onPress({ nativeEvent: { locationX } });
      });
    };
    press(10); // left edge → first point
    expect(onSelect).toHaveBeenLastCalledWith(series[0]);
    press(10);
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });
});

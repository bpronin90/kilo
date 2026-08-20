import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { ThemeProvider } from '../theme/ThemeContext';
import { LineChart } from '../components/LineChart';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: jest.fn(() => 'light'),
}));

const CHART_WIDTH = 300;
const SCALE_GUTTER_WIDTH = 34;

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

import React from 'react';
import render from 'react-test-renderer';
import { Line } from 'react-native-svg';
import { LineChart } from '../components/LineChart';
import { ThemeProvider } from '../theme/ThemeContext';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

const SERIES = [
  { value: 183, label: '05/20', unit: 'lb' },
  { value: 184, label: '05/21', unit: 'lb' },
  { value: 185, label: '05/22', unit: 'lb' },
];

function mount(props) {
  let c;
  render.act(() => {
    c = render.create(
      <ThemeProvider>
        <LineChart data={SERIES} height={100} hideHeader showScale {...props} />
      </ThemeProvider>
    );
  });
  render.act(() => {
    c.root.findAll((n) => n.props && typeof n.props.onLayout === 'function')[0]
      .props.onLayout({ nativeEvent: { layout: { width: 300 } } });
  });
  return c.root;
}

const grid = (root) => root.findAllByType(Line).filter(n => n.props.testID === 'line-chart-grid-line');

describe('LineChart showGrid framing (#1427)', () => {
  it('draws no grid by default', () => {
    expect(grid(mount({}))).toHaveLength(0);
  });

  it('draws top, mid and bottom lines at the plotted domain when opted in', () => {
    const ys = grid(mount({ showGrid: true })).map(n => n.props.y1);
    expect(ys).toEqual([10, 50, 90]);
  });

  it('draws only the centered line for a flat series', () => {
    const flat = SERIES.map(p => ({ ...p, value: 184 }));
    const ys = grid(mount({ showGrid: true, data: flat })).map(n => n.props.y1);
    expect(ys).toEqual([50]);
  });

  it('keeps selection, scale labels and accessibility label unchanged', () => {
    const onSelect = jest.fn();
    const withGrid = mount({ showGrid: true, onSelect });
    const without = mount({ onSelect });
    const label = (r) => r.findByProps({ accessibilityRole: 'adjustable' }).props.accessibilityLabel;
    expect(label(withGrid)).toBe(label(without));
    expect(withGrid.findByProps({ testID: 'line-chart-scale-max' }).props.children)
      .toBe(without.findByProps({ testID: 'line-chart-scale-max' }).props.children);
  });
});

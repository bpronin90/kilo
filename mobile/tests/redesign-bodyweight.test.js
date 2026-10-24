import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { PixelRatio } from 'react-native';
import { Circle, Line } from 'react-native-svg';
import { ThemeProvider } from '../theme/ThemeContext';
import { LineChart } from '../components/LineChart';
import {
  buildWeighInPoints, weightBounds, timeFraction, nearestPointIndex, describeWeightPlot, dateTicks, entryTime,
} from '../components/lineChart/weightChartPresentation';

// Redesign v3 Bodyweight plot (#1603): the opt-in `weightPlot` of LineChart and
// its presentation helpers. The panel/header/goal assembly is covered by
// analytics-weight-trends-card.test.js and analytics-screen.test.js.

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: jest.fn(() => 'light'),
}));

beforeEach(() => { jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(1); });
afterEach(() => { PixelRatio.getFontScale.mockRestore(); });

const WIDTH = 300;
const DATES = ['2026-05-20', '2026-05-21', '2026-05-23', '2026-05-26'];
// Newest first, as the screen passes them; 05-23 has two weigh-ins that day.
const ENTRIES = [
  { id: 'e4', date: '2026-05-26', weight_value: 185, note: 'Fasted' },
  { id: 'e3b', date: '2026-05-23', weight_value: 186.4, note: '' },
  { id: 'e3a', date: '2026-05-23', weight_value: 186.8 },
  { id: 'e2', date: '2026-05-21', weight_value: 187, note: 'Late' },
  { id: 'e1', date: '2026-05-20', weight_value: 188 },
];
const SERIES = [
  { value: 188, label: '05/20', unit: 'lb' },
  { value: 187.5, label: '05/21', unit: 'lb' },
  { value: 186.7, label: '05/23', unit: 'lb' },
  { value: 186.1, label: '05/26', unit: 'lb' },
];

const plotFor = (patch = {}) => ({
  ...buildWeighInPoints({ entries: ENTRIES, series: SERIES, windowDays: 7, unit: 'lb' }),
  goal: null,
  windowLabel: '7-day rolling average',
  ...patch,
});

function mount(props = {}) {
  let c;
  act(() => { c = renderer.create(<ThemeProvider><LineChart data={SERIES} height={150} hideHeader showScale seriesLabel="7-day rolling average bodyweight" onSelect={() => {}} weightPlot={plotFor()} {...props} /></ThemeProvider>); });
  act(() => {
    c.root.findAll((n) => n.props && typeof n.props.onLayout === 'function')[0].props.onLayout({ nativeEvent: { layout: { width: WIDTH } } });
  });
  return c;
}
const rerender = (c, props) => act(() => {
  c.update(<ThemeProvider><LineChart data={SERIES} height={150} hideHeader showScale seriesLabel="7-day rolling average bodyweight" onSelect={() => {}} weightPlot={plotFor()} {...props} /></ThemeProvider>);
});
const dots = (c) => c.root.findAllByType(Circle).filter((n) => n.props.testID === 'weigh-in-point');
const control = (c) => c.root.findByProps({ accessibilityRole: 'adjustable' });
const keyDown = (c, key) => act(() => { control(c).props.onKeyDown({ nativeEvent: { key }, preventDefault() {} }); });
const press = (c, locationX) => act(() => { control(c).props.onPress({ nativeEvent: { locationX } }); });
const press2 = (c, locationX, locationY) => act(() => { control(c).props.onPress({ nativeEvent: { locationX, locationY } }); });
const callout = (c) => c.root.findAllByProps({ testID: 'weight-point-callout' }).filter((n) => typeof n.type === 'string');

describe('weightChartPresentation', () => {
  test('buildWeighInPoints keeps every usable weigh-in, ascending by recorded date, each with identity', () => {
    const { points, line } = buildWeighInPoints({ entries: [...ENTRIES, { id: 'bad', date: '2026-05-22', weight_value: null }, null], series: SERIES, windowDays: 7, unit: 'lb' });
    expect(points.map((p) => p.id)).toEqual(['e1', 'e2', 'e3a', 'e3b', 'e4']);
    expect(points.map((p) => p.date)).toEqual(['2026-05-20', '2026-05-21', '2026-05-23', '2026-05-23', '2026-05-26']);
    expect(line.map((p) => p.value)).toEqual(SERIES.map((p) => p.value));
    expect(line.map((p) => p.t)).toEqual(DATES.map(entryTime));
  });

  test('points carry value, MM-DD-YYYY date, note and the N-day average for their date', () => {
    const { points } = buildWeighInPoints({ entries: ENTRIES, series: SERIES, windowDays: 7, unit: 'lb' });
    const late = points.find((p) => p.id === 'e2');
    expect(late).toMatchObject({ value: 187, label: '05-21-2026', note: 'Late', avg: 187.5, avgText: '7-day avg 187.5' });
    expect(late.announce).toBe('Selected weigh-in, 05-21-2026, 187 lb, 7-day average 187.5, note: Late');
    expect(points.find((p) => p.id === 'e1').note).toBe('');
  });

  test('kg values are converted to one decimal; the average is already display space', () => {
    const { points } = buildWeighInPoints({ entries: ENTRIES, series: SERIES.map((p) => ({ ...p, value: 80, unit: 'kg' })), windowDays: 30, unit: 'kg' });
    expect(points[points.length - 1]).toMatchObject({ value: 83.9, unit: 'kg', avgText: '30-day avg 80.0' });
  });

  test('a series that does not line up with the recorded dates never attaches a wrong-day average', () => {
    const { points, line } = buildWeighInPoints({ entries: ENTRIES, series: SERIES.slice(1), windowDays: 7, unit: 'lb' });
    expect(points.every((p) => p.avg === null && p.avgText === null)).toBe(true);
    expect(line).toEqual([]);
  });

  test('bounds, time fraction and nearest point follow recorded dates, not indexes', () => {
    const plot = plotFor({ goal: { value: 183, text: '183' } });
    const b = weightBounds(plot);
    expect(b.t0).toBe(entryTime('2026-05-20'));
    expect(b.t1).toBe(entryTime('2026-05-26'));
    expect(Math.min(...b.values)).toBe(183);
    expect(timeFraction(b, entryTime('2026-05-23'))).toBeCloseTo(0.5, 2);
    expect(timeFraction({ t0: 5, t1: 5 }, 5)).toBe(0);
    // x = 6 + 0.5 * 288 = 150 is 05-23 (two weigh-ins that day: the first wins a tie).
    expect(plot.points[nearestPointIndex(plot, b, 150, 6, 288)].date).toBe('2026-05-23');
    expect(plot.points[nearestPointIndex(plot, b, 0, 6, 288)].id).toBe('e1');
    expect(nearestPointIndex({ points: [] }, b, 10, 6, 288)).toBe(-1);
  });

  test('the text description names count, dates, line, ring and goal', () => {
    const text = describeWeightPlot(plotFor({ goal: { value: 183, text: '183' } }), 'Series');
    expect(text).toContain('Chart of 5 weigh-ins at their recorded dates, 05-20-2026 to 05-26-2026');
    expect(text).toContain('7-day rolling average line');
    expect(text).toContain('Latest weigh-in 185 lb on 05-26-2026, marked with a ring');
    expect(text).toContain('Goal target 183 lb, drawn as a dashed line');
    expect(describeWeightPlot(plotFor(), 'Series')).not.toContain('Goal target');
  });

  test('dateTicks are evenly spaced MM-DD labels without repeats', () => {
    expect(dateTicks({ t0: entryTime('2026-08-21'), t1: entryTime('2026-10-23') }).map((t) => t.text)).toEqual(['08-21', '09-11', '10-02', '10-23']);
    expect(dateTicks({ t0: entryTime('2026-05-20'), t1: entryTime('2026-05-21') }).map((t) => t.text)).toEqual(['05-20', '05-21']);
  });
});

describe('LineChart weightPlot — recorded dates, ring and goal line', () => {
  test('draws one dot per weigh-in at its recorded date (two same-day weigh-ins share an x)', () => {
    const c = mount();
    const xs = dots(c).map((d) => d.props.cx);
    expect(xs).toHaveLength(5);
    // Index spacing would put 05-23 at 2/4; recorded-date spacing puts it at 3/6.
    expect(xs[2]).toBeCloseTo(6 + 0.5 * (WIDTH - 46 - 12), 1);
    expect(xs[2]).toBe(xs[3]);
    expect(xs[0]).toBeLessThan(xs[1]);
  });

  test('the latest recorded weigh-in carries a hollow ring, also while another point is selected', () => {
    const c = mount();
    const ring = () => c.root.findAllByType(Circle).filter((n) => n.props.testID === 'latest-weigh-in-ring');
    expect(ring()).toHaveLength(1);
    expect(ring()[0].props.fill).toBe('none');
    const last = dots(c)[4].props;
    expect(ring()[0].props.cx).toBe(last.cx);
    expect(ring()[0].props.cy).toBe(last.cy);
    keyDown(c, 'ArrowLeft');
    keyDown(c, 'ArrowLeft');
    expect(callout(c)).toHaveLength(1);
    expect(ring()).toHaveLength(1);
  });

  test('a goal draws a dashed labelled target line inside the domain; no goal draws neither', () => {
    const none = mount();
    expect(none.root.findAllByType(Line).filter((n) => n.props.testID === 'weight-goal-line')).toHaveLength(0);
    expect(none.root.findAllByProps({ testID: 'weight-goal-label' })).toHaveLength(0);
    const c = mount({ weightPlot: plotFor({ goal: { value: 183, text: '183' } }) });
    const line = c.root.findAllByType(Line).find((n) => n.props.testID === 'weight-goal-line');
    expect(line.props.strokeDasharray).toBeTruthy();
    expect(line.props.y1).toBe(line.props.y2);
    // The goal is below every weigh-in, so it sets the bottom of the scale.
    expect(c.root.findByProps({ testID: 'line-chart-scale-min' }).props.children).toBe('183.0');
    expect(c.root.findByProps({ testID: 'weight-goal-label' }).props.children).toBe('Goal 183');
  });

  test('the accessibility label is the text equivalent, including ring and goal', () => {
    const c = mount({ weightPlot: plotFor({ goal: { value: 183, text: '183' } }) });
    const label = control(c).props.accessibilityLabel;
    expect(label).toContain('5 weigh-ins at their recorded dates');
    expect(label).toContain('marked with a ring');
    expect(label).toContain('Goal target 183 lb');
  });

  test('draws the recorded-date axis', () => {
    const axis = mount().root.findByProps({ testID: 'weight-date-axis' });
    expect(axis).toBeTruthy();
  });
});

describe('LineChart weightPlot — selection by recorded entry', () => {
  test('touch selects the nearest weigh-in and shows value, date, average and note in an accessible callout', () => {
    const onSelect = jest.fn();
    const c = mount({ onSelect });
    press(c, 6 + 1 / 6 * (WIDTH - 46 - 12)); // 05-21
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'e2' }));
    const [box] = callout(c);
    expect(box.props.accessibilityLiveRegion).toBe('polite');
    expect(box.props.accessibilityLabel).toBe('Selected weigh-in, 05-21-2026, 187 lb, 7-day average 187.5, note: Late');
    const texts = c.root.findAllByType('Text').map((t) => [].concat(t.props.children).join(''));
    expect(texts).toEqual(expect.arrayContaining(['187 lb · 05-21-2026', '7-day avg 187.5', 'Late']));
    expect(control(c).props.accessibilityValue.text).toContain('note: Late');
    press(c, 6 + 1 / 6 * (WIDTH - 46 - 12));
    expect(callout(c)).toHaveLength(0);
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  test('two weigh-ins on one date are each reachable by touch height', () => {
    const entries = [
      { id: 'c', date: '2026-05-24', weight_value: 185 },
      { id: 'b', date: '2026-05-23', weight_value: 180 },
      { id: 'a', date: '2026-05-23', weight_value: 190 },
    ];
    const series = [{ value: 185, label: '05/23', unit: 'lb' }, { value: 185, label: '05/24', unit: 'lb' }];
    const plot = { ...buildWeighInPoints({ entries, series, windowDays: 7, unit: 'lb' }), goal: null, windowLabel: 'x' };
    const onSelect = jest.fn();
    const c = mount({ data: series, weightPlot: plot, onSelect });
    const [first, second] = dots(c).filter((d) => d.props.cx === dots(c)[0].props.cx);
    expect(first.props.cy).not.toBe(second.props.cy);
    press2(c, first.props.cx, first.props.cy);
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a' }));
    press2(c, second.props.cx, second.props.cy);
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'b' }));
  });

  test('keyboard and rotor traversal walk the weigh-ins; Escape clears', () => {
    const onSelect = jest.fn();
    const c = mount({ onSelect });
    keyDown(c, 'ArrowLeft'); // enters at the latest
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'e4' }));
    keyDown(c, 'ArrowLeft');
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'e3b' }));
    act(() => { control(c).props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } }); });
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'e3a' }));
    keyDown(c, 'Escape');
    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(callout(c)).toHaveLength(0);
  });

  test('a selection follows its entry when others are added, and clears when its entry is removed', () => {
    const onSelect = jest.fn();
    const c = mount({ onSelect });
    keyDown(c, 'ArrowLeft');
    keyDown(c, 'ArrowLeft'); // e3b
    onSelect.mockClear();
    const withNew = buildWeighInPoints({ entries: [{ id: 'e5', date: '2026-05-27', weight_value: 184.5 }, ...ENTRIES], series: [...SERIES, { value: 185.5, label: '05/27', unit: 'lb' }], windowDays: 7, unit: 'lb' });
    rerender(c, { onSelect, weightPlot: { ...withNew, goal: null, windowLabel: 'x' } });
    // Position moved (a newer point exists) but the entry is the same one.
    expect(callout(c)[0].props.accessibilityLabel).toContain('05-23-2026, 186.4 lb');
    expect(onSelect).not.toHaveBeenCalled();

    const without = buildWeighInPoints({ entries: ENTRIES.filter((e) => e.id !== 'e3b'), series: SERIES, windowDays: 7, unit: 'lb' });
    rerender(c, { onSelect, weightPlot: { ...without, goal: null, windowLabel: 'x' } });
    expect(callout(c)).toHaveLength(0);
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  test('a selection never survives the dataset shrinking below a chart', () => {
    const onSelect = jest.fn();
    const c = mount({ onSelect });
    keyDown(c, 'ArrowLeft');
    onSelect.mockClear();
    rerender(c, { onSelect, data: SERIES.slice(0, 1), weightPlot: null });
    expect(callout(c)).toHaveLength(0);
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });
});

describe('LineChart without weightPlot is unchanged (Home sparkline, 1K session chart)', () => {
  test('no ring, goal line, callout or date axis; index spacing and selection label as before', () => {
    const c = mount({ weightPlot: undefined, hideHeader: false, showScale: false, onSelect: undefined });
    expect(c.root.findAllByType(Circle).filter((n) => ['latest-weigh-in-ring', 'weigh-in-point'].includes(n.props.testID))).toHaveLength(0);
    expect(c.root.findAllByType(Line).filter((n) => n.props.testID === 'weight-goal-line')).toHaveLength(0);
    expect(c.root.findAllByProps({ testID: 'weight-date-axis' })).toHaveLength(0);
    const circles = c.root.findAllByType(Circle);
    const xs = circles.map((n) => n.props.cx);
    expect(xs).toHaveLength(4);
    // Index spacing: equal gaps despite uneven dates.
    expect(xs[1] - xs[0]).toBeCloseTo(xs[3] - xs[2], 5);
    expect(c.root.findByProps({ accessibilityRole: 'image' }).props.accessibilityLabel).toContain('Line chart, 4 points');
  });

  test('a weightPlot with fewer than two weigh-ins falls back to the plain series chart', () => {
    const c = mount({ weightPlot: { points: [plotFor().points[0]], line: [], goal: null } });
    expect(c.root.findAllByType(Circle).filter((n) => n.props.testID === 'latest-weigh-in-ring')).toHaveLength(0);
    expect(control(c).props.accessibilityLabel).toContain('Line chart, 4 points');
  });
});

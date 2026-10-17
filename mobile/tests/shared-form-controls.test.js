import React from 'react';
import { Platform, StyleSheet, Text, TextInput } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import { ThemeProvider } from '../theme/ThemeContext';
import { TextField, DateField, ActionChip, TextAction } from '../components/UI';

// #1440: standard form controls and inline actions are shared app primitives.
// These pin their behavior and accessibility contracts (visible labels,
// accessible names, date bounds and value format, touch targets), not their
// style constants.

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: jest.fn(() => 'light'),
}));

jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  const { View } = require('react-native');
  return function MockDateTimePicker(props) {
    return React.createElement(View, { testID: 'mock-datetimepicker', ...props });
  };
});

function render(element) {
  let tree;
  act(() => {
    tree = renderer.create(<ThemeProvider>{element}</ThemeProvider>);
  });
  return tree;
}

const textsOf = (root) => root.findAllByType(Text).map((t) => [].concat(t.props.children).join(''));
const picker = (root) => root.findAll((n) => n.props?.testID === 'mock-datetimepicker' && typeof n.type !== 'string');
// The outermost named element that owns the press handler (the Pressable
// itself, not the wrapping primitive whose `label` prop names it).
const pressable = (root, name) => root.findAll(
  (n) => typeof n.props?.onPress === 'function'
    && n.props.accessibilityLabel !== undefined
    && (name === undefined || n.props.accessibilityLabel === name),
)[0];
const todayYMD = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

describe('TextField', () => {
  test('keeps a visible label and names the input by it whether empty or populated', () => {
    const onChangeText = jest.fn();
    const tree = render(<TextField label="Note" value="" onChangeText={onChangeText} placeholder="Morning" />);
    expect(textsOf(tree.root)).toContain('Note');
    const input = tree.root.findByType(TextInput);
    expect(input.props.accessibilityLabel).toBe('Note');
    act(() => input.props.onChangeText('fasted'));
    expect(onChangeText).toHaveBeenCalledWith('fasted');
    act(() => tree.update(<ThemeProvider><TextField label="Note" value="fasted" onChangeText={onChangeText} /></ThemeProvider>));
    expect(textsOf(tree.root)).toContain('Note');
  });

  test('numeric fields use the decimal keypad; an explicit name wins over the label', () => {
    const tree = render(<TextField label="Target (lb)" numeric accessibilityLabel="Goal target" value="" onChangeText={() => {}} />);
    const input = tree.root.findByType(TextInput);
    expect(input.props.keyboardType).toBe('decimal-pad');
    expect(input.props.accessibilityLabel).toBe('Goal target');
  });

  test('the field keeps a 48dp minimum height for large text and touch', () => {
    const tree = render(<TextField label="Note" value="" onChangeText={() => {}} />);
    expect(StyleSheet.flatten(tree.root.findByType(TextInput).props.style).minHeight).toBeGreaterThanOrEqual(48);
  });
});

describe('DateField (native)', () => {
  test('is a named button that opens the picker and reports YYYY-MM-DD', () => {
    const onChangeDate = jest.fn();
    const tree = render(<DateField label="Date" value="2026-05-20" onChangeDate={onChangeDate} accessibilityLabel="Weigh-in date" />);
    expect(textsOf(tree.root)).toEqual(expect.arrayContaining(['Date', '2026-05-20']));
    const field = pressable(tree.root, 'Weigh-in date');
    expect(field.props.accessibilityRole).toBe('button');
    expect(picker(tree.root)).toHaveLength(0);
    act(() => field.props.onPress());
    const [open] = picker(tree.root);
    expect(open.props.maximumDate).toBeInstanceOf(Date);
    expect(open.props.minimumDate).toBeUndefined();
    act(() => open.props.onChange({ type: 'set' }, new Date(2026, 0, 7)));
    expect(onChangeDate).toHaveBeenCalledWith('2026-01-07');
    expect(picker(tree.root)).toHaveLength(0);
  });

  test('dismissing without a date closes the picker and keeps the value', () => {
    const onChangeDate = jest.fn();
    const tree = render(<DateField label="Date" value="2026-05-20" onChangeDate={onChangeDate} />);
    act(() => pressable(tree.root, 'Date').props.onPress());
    act(() => picker(tree.root)[0].props.onChange({ type: 'dismissed' }, undefined));
    expect(onChangeDate).not.toHaveBeenCalled();
    expect(picker(tree.root)).toHaveLength(0);
  });

  test('future range bounds from today, shows the placeholder and formatted value', () => {
    const onVisible = jest.fn();
    const empty = render(
      <DateField label="Target Date" value="" onChangeDate={() => {}} range="future" placeholder="Select date"
        pickerVisible onPickerVisibleChange={onVisible} />
    );
    expect(textsOf(empty.root)).toContain('Select date');
    const [open] = picker(empty.root);
    expect(open.props.minimumDate).toBeInstanceOf(Date);
    expect(open.props.maximumDate).toBeUndefined();
    act(() => open.props.onDismiss());
    expect(onVisible).toHaveBeenCalledWith(false);

    const filled = render(
      <DateField label="Target Date" value="2026-09-01" onChangeDate={() => {}} range="future"
        placeholder="Select date" formatValue={(v) => `formatted ${v}`} />
    );
    expect(textsOf(filled.root)).toContain('formatted 2026-09-01');
    expect(textsOf(filled.root)).not.toContain('Select date');
  });
});

describe('DateField (web)', () => {
  let originalOS;
  beforeAll(() => { originalOS = Platform.OS; Platform.OS = 'web'; });
  afterAll(() => { Platform.OS = originalOS; });

  const domInput = (root) => root.find((n) => n.type === 'input');

  test('renders a labelled DOM date input bounded to today for each range', () => {
    const onChangeDate = jest.fn();
    const past = render(<DateField label="Date" value="2026-05-20" onChangeDate={onChangeDate} accessibilityLabel="Weigh-in date" />);
    const input = domInput(past.root);
    expect(input.props.type).toBe('date');
    expect(input.props['aria-label']).toBe('Weigh-in date');
    expect(input.props.max).toBe(todayYMD());
    expect(input.props.min).toBeUndefined();
    expect(textsOf(past.root)).toContain('Date');
    expect(picker(past.root)).toHaveLength(0);

    act(() => input.props.onChange({ target: { value: '2026-05-21' } }));
    act(() => input.props.onChange({ target: { value: '' } }));
    expect(onChangeDate).toHaveBeenCalledTimes(1);
    expect(onChangeDate).toHaveBeenCalledWith('2026-05-21');

    const future = render(<DateField label="Target Date" value="" onChangeDate={() => {}} range="future" />);
    expect(domInput(future.root).props.min).toBe(todayYMD());
    expect(domInput(future.root).props.max).toBeUndefined();
  });
});

describe('inline actions', () => {
  test.each([
    ['ActionChip default', <ActionChip key="a" label="Edit" onPress={() => {}} />, 'Edit'],
    ['ActionChip positive', <ActionChip key="b" label="Archive" tone="positive" onPress={() => {}} />, 'Archive'],
    ['ActionChip danger', <ActionChip key="c" label="Clear" tone="danger" onPress={() => {}} />, 'Clear'],
    ['TextAction', <TextAction key="d" label="Cancel" onPress={() => {}} />, 'Cancel'],
  ])('%s is a named button with its own 44dp box and a silenced label', (_name, element, label) => {
    const tree = render(element);
    const button = pressable(tree.root);
    expect(button.props.accessibilityRole).toBe('button');
    expect(button.props.accessibilityLabel).toBe(label);
    expect(button.props.hitSlop).toBeUndefined();
    const style = StyleSheet.flatten(typeof button.props.style === 'function' ? button.props.style({}) : button.props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    expect(style.minWidth).toBeGreaterThanOrEqual(44);
    const visible = tree.root.findAllByType(Text).find((t) => [].concat(t.props.children).join('') === label);
    expect(visible.props.accessible).toBe(false);
  });

  test('pressing an action invokes its handler', () => {
    const onPress = jest.fn();
    const tree = render(<TextAction label="Cancel" onPress={onPress} />);
    act(() => pressable(tree.root).props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

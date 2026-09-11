import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { HelpScreen } from '../components/HelpScreen';

jest.mock('../lib/unitPreference', () => ({ useWeightUnit: () => 'lb' }));

const TOPIC_TITLES = [
  'Logging workouts',
  'Recovery & deloads',
  'Progress & analytics',
  'Weight tracking',
  'Backup, sync & moving phones',
  'Settings & privacy',
];

function render() {
  let tree;
  act(() => {
    tree = renderer.create(<HelpScreen onBack={() => {}} />);
  });
  return tree;
}

function topicRow(tree, title) {
  return tree.root.findByProps({ accessibilityRole: 'button', accessibilityLabel: title });
}

function press(tree, title) {
  act(() => {
    topicRow(tree, title).props.onPress();
  });
}

function renderedText(tree) {
  return tree.root
    .findAllByType('Text')
    .map((t) => {
      const child = t.props.children;
      return Array.isArray(child) ? child.join('') : String(child ?? '');
    })
    .join('\n');
}

test('shows all six topic rows as accessible buttons on first render', () => {
  const tree = render();
  for (const title of TOPIC_TITLES) {
    const row = topicRow(tree, title);
    expect(row).toBeTruthy();
    expect(row.props.accessibilityState).toEqual({ expanded: false });
  }
  act(() => tree.unmount());
});

test('renders no expanded topic detail before any row is tapped', () => {
  const tree = render();
  const text = renderedText(tree);
  // Detail-only copy from several topics must be absent until expanded.
  expect(text).not.toContain('Logging does not track an exercise');
  expect(text).not.toContain('Progressive Overload shows Est. Max');
  expect(text).not.toContain('Data & Backup exports a local backup file');
  act(() => tree.unmount());
});

test('expanding a topic reveals its detail and marks it expanded', () => {
  const tree = render();
  press(tree, 'Logging workouts');
  expect(topicRow(tree, 'Logging workouts').props.accessibilityState).toEqual({ expanded: true });
  expect(renderedText(tree)).toContain('Logging does not track an exercise');
  act(() => tree.unmount());
});

test('tapping an open topic collapses it', () => {
  const tree = render();
  press(tree, 'Logging workouts');
  press(tree, 'Logging workouts');
  expect(topicRow(tree, 'Logging workouts').props.accessibilityState).toEqual({ expanded: false });
  expect(renderedText(tree)).not.toContain('Logging does not track an exercise');
  act(() => tree.unmount());
});

test('opening a second topic closes the first (one open at a time)', () => {
  const tree = render();
  press(tree, 'Logging workouts');
  press(tree, 'Weight tracking');
  expect(topicRow(tree, 'Logging workouts').props.accessibilityState).toEqual({ expanded: false });
  expect(topicRow(tree, 'Weight tracking').props.accessibilityState).toEqual({ expanded: true });
  const text = renderedText(tree);
  expect(text).not.toContain('Logging does not track an exercise');
  expect(text).toContain('Enter body weight in the Weight tab');
  act(() => tree.unmount());
});

test('workout syntax reference appears only when Logging is expanded', () => {
  const tree = render();
  expect(renderedText(tree)).not.toContain('135 5,5,5');
  press(tree, 'Logging workouts');
  expect(renderedText(tree)).toContain('135 5,5,5');
  act(() => tree.unmount());
});

test('exposes no chip, table-of-contents, or scroll-to navigation controls', () => {
  const tree = render();
  const readAffordances = tree.root.findAll(
    (n) =>
      n.props &&
      typeof n.props.accessibilityLabel === 'string' &&
      n.props.accessibilityLabel.startsWith('Read '),
  );
  expect(readAffordances).toHaveLength(0);
  // Only the six topic buttons are present — no extra jump/index buttons.
  const buttons = tree.root.findAll(
    (n) => n.props && n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function',
  );
  expect(buttons.length).toBe(TOPIC_TITLES.length + 1); // topics + the shell "← Back"
  act(() => tree.unmount());
});

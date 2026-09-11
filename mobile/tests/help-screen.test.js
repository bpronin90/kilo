import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { HelpScreen } from '../components/HelpScreen';

jest.mock('../lib/unitPreference', () => ({ useWeightUnit: () => 'lb' }));

function renderGuide() {
  let tree;
  act(() => { tree = renderer.create(<HelpScreen onBack={() => {}} />); });
  return tree;
}

test('starts with a compact topic index and no detail heading', () => {
  const tree = renderGuide();
  expect(tree.root.findByProps({ accessibilityLabel: 'Read Log workouts' })).toBeTruthy();
  expect(tree.root.findAllByProps({ accessibilityLabel: 'Back to guide topics' })).toHaveLength(0);
  act(() => { tree.unmount(); });
});

test('opens a topic and provides an obvious return to the index', () => {
  const tree = renderGuide();
  const logging = tree.root.findByProps({ accessibilityLabel: 'Read Log workouts' });
  act(() => { logging.props.onPress(); });
  expect(tree.root.findByProps({ accessibilityLabel: 'Back to guide topics' })).toBeTruthy();
  expect(tree.root.findAllByProps({ accessibilityLabel: 'Read Log workouts' })).toHaveLength(0);
  act(() => { tree.root.findByProps({ accessibilityLabel: 'Back to guide topics' }).props.onPress(); });
  expect(tree.root.findByProps({ accessibilityLabel: 'Read Log workouts' })).toBeTruthy();
  act(() => { tree.unmount(); });
});

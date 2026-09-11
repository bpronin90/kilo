import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { HelpScreen } from '../components/HelpScreen';

jest.mock('../lib/unitPreference', () => ({ useWeightUnit: () => 'lb' }));

function renderGuide() {
  let tree;
  act(() => {
    tree = renderer.create(<HelpScreen onBack={() => {}} />);
  });
  return tree;
}

test('starts with a compact topic index and continuous sections below', () => {
  const tree = renderGuide();
  expect(tree.root.findByProps({ accessibilityLabel: 'Read Log workouts' })).toBeTruthy();
  expect(tree.root.findByProps({ accessibilityLabel: 'Read Start here' })).toBeTruthy();
  act(() => {
    tree.unmount();
  });
});

test('index item scrolls to its in-page section', () => {
  const tree = renderGuide();
  const logging = tree.root.findByProps({ accessibilityLabel: 'Read Log workouts' });
  expect(logging.props.onPress).toEqual(expect.any(Function));
  act(() => {
    logging.props.onPress();
  });
  act(() => {
    tree.unmount();
  });
});


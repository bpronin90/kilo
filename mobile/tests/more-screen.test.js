import React from 'react';
import render, { act } from 'react-test-renderer';
import { MoreScreen } from '../screens/MoreScreen';

function button(root, label) {
  return root.findAll(node => node.props?.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
}

test('More groups all routine prompt tools under the Prompts section', () => {
  let tree;
  act(() => { tree = render.create(<MoreScreen isActive />); });
  expect(tree.root.findAllByType('Text').some(node => node.children.join('') === 'Prompts')).toBe(true);
  act(() => { button(tree.root, 'Routine prompt tools').props.onPress(); });
  expect(button(tree.root, 'Plan or update routine')).toBeTruthy();
  expect(button(tree.root, 'Normalize exercise names')).toBeTruthy();
  expect(button(tree.root, 'Kilo routine format')).toBeTruthy();
  act(() => { tree.unmount(); });
});

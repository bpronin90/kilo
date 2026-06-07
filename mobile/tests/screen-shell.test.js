import React from 'react';
import renderer from 'react-test-renderer';
import { ScreenShell } from '../components/ScreenShell';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

// Regression test for issue 292 layout bug:
// ScreenShell wraps ScrollView in an outerContainer View. The caller's `style` prop
// must be applied to the outerContainer, not just the inner ScrollView, so that
// `display: 'none'` removes the entire shell from layout (not just hides the ScrollView
// while the outerContainer keeps its flex: 1 space).
describe('ScreenShell layout contract', () => {
  test('style prop lands on the root outerContainer View, not only the inner ScrollView', () => {
    let component;
    renderer.act(() => {
      component = renderer.create(
        <ScreenShell style={{ display: 'none' }} title="Test" />
      );
    });

    const root = component.toJSON();
    // Root must be a View (the outerContainer), not a ScrollView.
    expect(root.type).toBe('View');

    // The outerContainer must carry display: 'none' so it takes no layout space.
    const rootStyles = [].concat(root.props.style).reduce(
      (acc, s) => (s ? Object.assign(acc, s) : acc),
      {}
    );
    expect(rootStyles.display).toBe('none');
  });

  test('active shell (style flex: 1) keeps outerContainer in layout', () => {
    let component;
    renderer.act(() => {
      component = renderer.create(
        <ScreenShell style={{ flex: 1 }} title="Test" />
      );
    });

    const root = component.toJSON();
    expect(root.type).toBe('View');

    const rootStyles = [].concat(root.props.style).reduce(
      (acc, s) => (s ? Object.assign(acc, s) : acc),
      {}
    );
    // display must not be 'none' — shell participates in layout.
    expect(rootStyles.display).not.toBe('none');
  });
});

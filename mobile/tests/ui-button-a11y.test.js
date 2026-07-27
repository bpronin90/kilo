import React from 'react';
import renderer from 'react-test-renderer';
import { Button } from '../components/UI';
import { DarkColors, LightColors } from '../theme/colors';

// Issue 594: the shared Button primitive must consistently announce its control
// role and a truthful disabled/busy accessibility state. Titles remain the
// accessible name unless an explicit label is supplied.
function findPressable(root) {
  return root.find(
    node => node.props && node.props.accessibilityRole === 'button'
  );
}

describe('shared Button accessibility contract', () => {
  test('normal button exposes button role, no disabled/busy state, and title name', () => {
    let component;
    renderer.act(() => {
      component = renderer.create(<Button title="Save" onPress={() => {}} />);
    });
    const pressable = findPressable(component.root);
    expect(pressable.props.accessibilityRole).toBe('button');
    expect(pressable.props.accessibilityState).toEqual({ disabled: false, busy: false });
    expect(pressable.props.accessibilityLabel).toBeUndefined();

    const rendered = component.root.findAllByType('Text').map(t => t.props.children);
    expect(rendered).toContain('Save');
  });

  test('disabled button exposes disabled state', () => {
    let component;
    renderer.act(() => {
      component = renderer.create(<Button title="Save" disabled onPress={() => {}} />);
    });
    const pressable = findPressable(component.root);
    expect(pressable.props.accessibilityState.disabled).toBe(true);
    expect(pressable.props.accessibilityState.busy).toBe(false);
  });

  test('loading button exposes busy state', () => {
    let component;
    renderer.act(() => {
      component = renderer.create(
        <Button title="Save" loading loadingTitle="Saving…" onPress={() => {}} />
      );
    });
    const pressable = findPressable(component.root);
    expect(pressable.props.accessibilityState.busy).toBe(true);
  });

  test('disabled+loadingTitle shorthand reports busy', () => {
    let component;
    renderer.act(() => {
      component = renderer.create(
        <Button title="Save" disabled loadingTitle="Saving…" onPress={() => {}} />
      );
    });
    const pressable = findPressable(component.root);
    expect(pressable.props.accessibilityState.disabled).toBe(true);
    expect(pressable.props.accessibilityState.busy).toBe(true);
  });

  test('explicit accessibilityLabel overrides the title as accessible name', () => {
    let component;
    renderer.act(() => {
      component = renderer.create(
        <Button title="Save" accessibilityLabel="Save workout" onPress={() => {}} />
      );
    });
    const pressable = findPressable(component.root);
    expect(pressable.props.accessibilityLabel).toBe('Save workout');
  });
});

// Issue 689: the Button pill is the active palette's `text`, so its label must
// be the semantic contrasting ink in both appearances — light mode dark pill /
// light label, dark mode light pill / dark label — each at WCAG AA 4.5:1.
describe('shared Button label contrast in both appearances', () => {
  function luminance(hex) {
    const raw = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4]
      .map((i) => parseInt(raw.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrast(a, b) {
    const [la, lb] = [luminance(a), luminance(b)];
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  test.each([
    ['light', LightColors],
    ['dark', DarkColors],
  ])('%s: pill background and label clear 4.5:1', (_mode, colors) => {
    expect(contrast(colors.text, colors.buttonLabel)).toBeGreaterThanOrEqual(4.5);
  });

  test('the pairing inverts between modes instead of repeating', () => {
    expect(luminance(LightColors.text)).toBeLessThan(luminance(LightColors.buttonLabel));
    expect(luminance(DarkColors.text)).toBeGreaterThan(luminance(DarkColors.buttonLabel));
  });
});

import React from 'react';
import renderer from 'react-test-renderer';
import { Button } from '../components/UI';

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

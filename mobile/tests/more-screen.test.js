import React from 'react';
import render, { act } from 'react-test-renderer';
import { MoreScreen, sendFeedback, FEEDBACK_URL } from '../screens/MoreScreen';

function button(root, label) {
  return root.findAll(node => node.props?.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
}

test('More groups routine prompt tools under Tools & help', () => {
  let tree;
  act(() => { tree = render.create(<MoreScreen isActive />); });
  expect(tree.root.findAllByType('Text').some(node => node.children.join('') === 'Tools & help')).toBe(true);
  act(() => { button(tree.root, 'Routine prompt tools').props.onPress(); });
  expect(button(tree.root, 'Plan or update routine')).toBeTruthy();
  expect(button(tree.root, 'Normalize exercise names')).toBeTruthy();
  expect(button(tree.root, 'Kilo routine format')).toBeTruthy();
  act(() => { tree.unmount(); });
});

describe('Send Feedback email action (#1658)', () => {
  function makeDeps(overrides = {}) {
    return {
      linking: { canOpenURL: jest.fn().mockResolvedValue(true), openURL: jest.fn().mockResolvedValue(undefined) },
      alert: jest.fn(),
      copy: jest.fn().mockResolvedValue(undefined),
      systemConfirms: jest.fn().mockReturnValue(false),
      ...overrides,
    };
  }

  test('URL targets only the address with the fixed subject and no body', () => {
    const url = new URL(FEEDBACK_URL);
    expect(url.protocol).toBe('mailto:');
    expect(decodeURIComponent(url.pathname)).toBe('bpronin90@gmail.com');
    expect([...url.searchParams.keys()]).toEqual(['subject']);
    expect(url.searchParams.get('subject')).toBe('Kilo feedback');
    expect(FEEDBACK_URL).toContain('subject=Kilo%20feedback');
  });

  test('launches the email app without showing a fallback', async () => {
    const deps = makeDeps();
    await sendFeedback(deps);
    expect(deps.linking.openURL).toHaveBeenCalledWith(FEEDBACK_URL);
    expect(deps.alert).not.toHaveBeenCalled();
  });

  test.each([
    ['no handler', { canOpenURL: jest.fn().mockResolvedValue(false), openURL: jest.fn() }],
    ['rejected capability check', { canOpenURL: jest.fn().mockRejectedValue(new Error('x')), openURL: jest.fn() }],
    ['rejected launch', { canOpenURL: jest.fn().mockResolvedValue(true), openURL: jest.fn().mockRejectedValue(new Error('x')) }],
  ])('shows the address fallback on %s', async (_name, linking) => {
    const deps = makeDeps({ linking });
    await sendFeedback(deps);
    expect(deps.alert).toHaveBeenCalledTimes(1);
    const [, message, buttons] = deps.alert.mock.calls[0];
    expect(message).toContain('bpronin90@gmail.com');
    expect(buttons.map(b => b.text)).toEqual(['Copy address', 'Dismiss']);
  });

  test('copy copies only the address and confirms after it resolves', async () => {
    let resolveCopy;
    const deps = makeDeps({
      linking: { canOpenURL: jest.fn().mockResolvedValue(false), openURL: jest.fn() },
      copy: jest.fn(() => new Promise(r => { resolveCopy = r; })),
    });
    await sendFeedback(deps);
    const press = deps.alert.mock.calls[0][2][0].onPress();
    expect(deps.copy).toHaveBeenCalledWith('bpronin90@gmail.com');
    expect(deps.alert).toHaveBeenCalledTimes(1);
    resolveCopy();
    await press;
    expect(deps.alert).toHaveBeenCalledTimes(2);
    expect(deps.alert.mock.calls[1][0]).toBe('Address copied');
  });

  test('skips the in-app confirmation where the system shows its own', async () => {
    const deps = makeDeps({
      linking: { canOpenURL: jest.fn().mockResolvedValue(false), openURL: jest.fn() },
      systemConfirms: jest.fn().mockReturnValue(true),
    });
    await sendFeedback(deps);
    await deps.alert.mock.calls[0][2][0].onPress();
    expect(deps.alert).toHaveBeenCalledTimes(1);
  });

  test('a rejected copy reports failure and keeps the address visible', async () => {
    const deps = makeDeps({
      linking: { canOpenURL: jest.fn().mockResolvedValue(false), openURL: jest.fn() },
      copy: jest.fn().mockRejectedValue(new Error('denied')),
    });
    await sendFeedback(deps);
    await deps.alert.mock.calls[0][2][0].onPress();
    expect(deps.alert).toHaveBeenCalledTimes(2);
    const [title, message] = deps.alert.mock.calls[1];
    expect(title).toBe('Could not copy');
    expect(title).not.toMatch(/copied/i);
    expect(message).toContain('bpronin90@gmail.com');
  });
});

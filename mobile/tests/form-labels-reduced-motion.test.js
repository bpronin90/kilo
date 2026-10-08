import React from 'react';
import { AccessibilityInfo, Modal, StyleSheet, Text, TextInput } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import { WeightHistoryFilters } from '../components/weight/WeightHistoryFilters';
import { ThemeProvider } from '../theme/ThemeContext';
import { SetNewPasswordScreen } from '../screens/more/SetNewPasswordScreen';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: jest.fn(() => 'light'),
}));

const flush = () => act(async () => { await Promise.resolve(); });

function textsOf(root) {
  return root.findAllByType(Text).map((t) => [].concat(t.props.children).join(''));
}

let listeners;
let removeSpy;
let lookup;
let throwOnSubscribe;

// The hook caches the OS preference at module load, so each scenario installs
// its AccessibilityInfo mocks first and then loads a fresh copy of the module.
// React and react-native stay shared with the renderer; everything else is fresh.
function loadFresh(...paths) {
  const sharedReact = require('react');
  const sharedRN = require('react-native');
  let mods;
  jest.isolateModules(() => {
    jest.doMock('react', () => sharedReact);
    jest.doMock('react-native', () => sharedRN);
    mods = paths.map((path) => require(path));
  });
  return mods;
}

function loadHook() {
  return loadFresh('../lib/useReducedMotion')[0].useReducedMotion;
}

beforeEach(() => {
  listeners = [];
  removeSpy = jest.fn();
  lookup = jest.fn(() => Promise.resolve(false));
  throwOnSubscribe = false;
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => lookup());
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((name, cb) => {
    if (throwOnSubscribe) throw new Error('boom');
    listeners.push({ name, cb });
    return { remove: removeSpy };
  });
});

afterEach(() => jest.restoreAllMocks());

function mountProbe(useHook) {
  const seen = [];
  function Probe() { seen.push(useHook()); return null; }
  let tree;
  act(() => { tree = renderer.create(<Probe />); });
  return { seen, tree, last: () => seen[seen.length - 1] };
}

describe('useReducedMotion', () => {
  test('an unresolved lookup counts as reduced motion (animated: !reduce is false)', async () => {
    lookup.mockImplementation(() => new Promise(() => {}));
    const hook = loadHook();
    const p = mountProbe(hook);
    expect(p.seen[0]).toBe(true);
    await flush();
    expect(p.last()).toBe(true);
    expect(!p.last()).toBe(false);
  });

  test('a pending lookup that resolves true stays reduced', async () => {
    lookup.mockResolvedValue(true);
    const hook = loadHook();
    const p = mountProbe(hook);
    expect(p.seen[0]).toBe(true);
    await flush();
    expect(p.last()).toBe(true);
  });

  test('a pending lookup that resolves false switches to normal motion', async () => {
    const hook = loadHook();
    const p = mountProbe(hook);
    expect(p.seen[0]).toBe(true);
    await flush();
    expect(p.last()).toBe(false);
  });

  test('a pending lookup that rejects switches to normal motion', async () => {
    lookup.mockRejectedValue(new Error('unavailable'));
    const hook = loadHook();
    const p = mountProbe(hook);
    expect(p.seen[0]).toBe(true);
    await flush();
    expect(p.last()).toBe(false);
  });

  test('a cached true value makes the very first render reduced motion', async () => {
    lookup.mockResolvedValue(true);
    const hook = loadHook();
    await flush();
    const p = mountProbe(hook);
    expect(p.seen[0]).toBe(true);
  });

  test('stays false when the OS preference is disabled', async () => {
    const hook = loadHook();
    await flush();
    const p = mountProbe(hook);
    expect(p.seen[0]).toBe(false);
    expect(p.last()).toBe(false);
  });

  test('follows live reduceMotionChanged updates in both directions', async () => {
    const hook = loadHook();
    await flush();
    const p = mountProbe(hook);
    expect(listeners).toHaveLength(1);
    const sub = listeners.find((l) => l.name === 'reduceMotionChanged');
    act(() => sub.cb(true));
    expect(p.last()).toBe(true);
    act(() => sub.cb(false));
    expect(p.last()).toBe(false);
  });

  test('a rejected lookup falls back to normal motion without an unhandled rejection', async () => {
    lookup.mockRejectedValue(new Error('unavailable'));
    const hook = loadHook();
    await flush();
    const p = mountProbe(hook);
    expect(p.seen[0]).toBe(false);
    expect(p.last()).toBe(false);
  });

  test('a synchronously throwing lookup or subscription also falls back safely', async () => {
    lookup.mockImplementation(() => { throw new Error('boom'); });
    throwOnSubscribe = true;
    const hook = loadHook();
    await flush();
    const p = mountProbe(hook);
    expect(p.last()).toBe(false);
    expect(() => act(() => p.tree.unmount())).not.toThrow();
  });

  test('after unmount a later change or late lookup result no longer reaches the component', async () => {
    let resolve;
    lookup.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const hook = loadHook();
    const p = mountProbe(hook);
    const count = p.seen.length;
    act(() => p.tree.unmount());
    await act(async () => { resolve(true); await Promise.resolve(); });
    act(() => listeners[0].cb(false));
    expect(p.seen.length).toBe(count);
  });
});

describe('fade modals honor reduced motion', () => {
  function mount() {
    const [theme, modal] = loadFresh('../theme/ThemeContext', '../components/WorkoutSyntaxModal');
    let tree;
    act(() => {
      tree = renderer.create(
        <theme.ThemeProvider><modal.WorkoutSyntaxModal visible onClose={() => {}} /></theme.ThemeProvider>
      );
    });
    return tree;
  }

  test('keeps the fade when reduced motion is off', async () => {
    const tree = mount();
    await flush();
    expect(tree.root.findByType(Modal).props.animationType).toBe('fade');
  });

  test('uses no animation on first render while the lookup is still pending', () => {
    lookup.mockImplementation(() => new Promise(() => {}));
    const tree = mount();
    expect(tree.root.findByType(Modal).props.animationType).toBe('none');
  });

  test('uses no animation when reduced motion is on, and keeps the content visible', async () => {
    lookup.mockResolvedValue(true);
    const warm = loadFresh('../lib/useReducedMotion');
    await flush();
    expect(warm).toBeTruthy();
    const tree = mount();
    await flush();
    expect(tree.root.findByType(Modal).props.animationType).toBe('none');
    expect(textsOf(tree.root)).toContain('Workout syntax help');
  });

  test('switching the preference while mounted updates the open modal', async () => {
    const tree = mount();
    await flush();
    const sub = listeners.find((l) => l.name === 'reduceMotionChanged');
    act(() => sub.cb(true));
    expect(tree.root.findByType(Modal).props.animationType).toBe('none');
    act(() => sub.cb(false));
    expect(tree.root.findByType(Modal).props.animationType).toBe('fade');
  });
});

describe('persistent visible field labels', () => {
  function renderPassword(props = {}) {
    const auth = {
      passwordRecovery: true,
      recoveryError: '',
      updatePassword: jest.fn(),
      ...props,
    };
    let tree;
    act(() => {
      tree = renderer.create(
        <ThemeProvider><SetNewPasswordScreen auth={auth} onDone={() => {}} onBack={() => {}} /></ThemeProvider>
      );
    });
    return tree;
  }

  test('set-new-password inputs keep visible labels when empty and populated', () => {
    const tree = renderPassword();
    expect(textsOf(tree.root)).toEqual(expect.arrayContaining(['New password', 'Confirm new password']));
    const inputs = tree.root.findAllByType(TextInput);
    act(() => inputs[0].props.onChangeText('hunter22hunter'));
    act(() => inputs[1].props.onChangeText('hunter22hunter'));
    expect(textsOf(tree.root)).toEqual(expect.arrayContaining(['New password', 'Confirm new password']));
    const populated = tree.root.findAllByType(TextInput);
    expect(populated[0].props.accessibilityLabel).toBe('New Password');
    expect(populated[1].props.accessibilityLabel).toBe('Confirm New Password');
  });

  test('field labels use the bold Space Grotesk face without a literal fontWeight', () => {
    const tree = renderPassword();
    const label = tree.root.findAllByType(Text).find((t) => [].concat(t.props.children).join('') === 'New password');
    const style = StyleSheet.flatten(label.props.style);
    expect(style.fontFamily).toBeTruthy();
    expect(style.fontWeight).toBeUndefined();
  });

  test('set-new-password shows no field labels without a recovery session', () => {
    const tree = renderPassword({ passwordRecovery: false, recoveryError: 'expired' });
    expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
    expect(textsOf(tree.root)).not.toContain('New password');
  });

  function renderFilters(props) {
    let tree;
    act(() => {
      tree = renderer.create(
        <ThemeProvider>
          <WeightHistoryFilters
            visible
            fromDate=""
            setFromDate={() => {}}
            toDate=""
            setToDate={() => {}}
            showFromPicker={false}
            setShowFromPicker={() => {}}
            showToPicker={false}
            setShowToPicker={() => {}}
            {...props}
          />
        </ThemeProvider>
      );
    });
    return tree;
  }

  test('date range filter keeps From and To labels whether empty or populated', async () => {
    const emptyTree = renderFilters();
    await flush();
    const empty = textsOf(emptyTree.root);
    expect(empty).toEqual(expect.arrayContaining(['From', 'To', 'Any date']));
    const filledTree = renderFilters({ fromDate: '2026-01-02', toDate: '2026-02-03' });
    await flush();
    const filled = textsOf(filledTree.root);
    expect(filled).toEqual(expect.arrayContaining(['From', 'To']));
    expect(filled).not.toContain('Any date');
  });
});

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { AboutScreen } from '../components/AboutScreen';
import * as Updates from 'expo-updates';

jest.mock('expo-updates', () => ({
  useUpdates: jest.fn(),
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
  reloadAsync: jest.fn(),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

function findButton(tree, title) {
  return tree.root.findAll(
    (node) =>
      typeof node.props.title === 'string' &&
      node.props.title === title &&
      typeof node.props.onPress === 'function'
  )[0];
}

function hasText(tree, text) {
  return JSON.stringify(tree.toJSON()).includes(text);
}

describe('AboutScreen OTA update flows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Updates.useUpdates.mockReturnValue({
      currentlyRunning: {
        isEmbeddedLaunch: true,
        channel: 'production',
        runtimeVersion: '1.0.0',
        updateId: '123456789',
      },
      isUpdateAvailable: false,
      isUpdatePending: false,
      isChecking: false,
    });
  });

  test('renders correctly with default state', () => {
    let tree;
    act(() => {
      tree = renderer.create(<AboutScreen onBack={jest.fn()} />);
    });

    expect(hasText(tree, 'About')).toBe(true);
    expect(hasText(tree, 'OTA Diagnostics')).toBe(true);
    expect(hasText(tree, 'production')).toBe(true);
    expect(hasText(tree, 'embedded bundle')).toBe(true);

    const checkBtn = findButton(tree, 'Check for Update');
    const restartBtn = findButton(tree, 'Restart to Apply');

    expect(checkBtn).toBeDefined();
    expect(restartBtn).toBeUndefined();
  });

  test('already up to date flow', async () => {
    Updates.checkForUpdateAsync.mockResolvedValue({ isAvailable: false });

    let tree;
    act(() => {
      tree = renderer.create(<AboutScreen onBack={jest.fn()} />);
    });

    const checkBtn = findButton(tree, 'Check for Update');
    await act(async () => {
      await checkBtn.props.onPress();
    });

    expect(Updates.checkForUpdateAsync).toHaveBeenCalledTimes(1);
    expect(Updates.fetchUpdateAsync).not.toHaveBeenCalled();
    expect(hasText(tree, 'Already up to date.')).toBe(true);

    const restartBtn = findButton(tree, 'Restart to Apply');
    expect(restartBtn).toBeUndefined();
  });

  test('update available and successful fetch flow', async () => {
    Updates.checkForUpdateAsync.mockResolvedValue({ isAvailable: true });
    Updates.fetchUpdateAsync.mockResolvedValue({ isNew: true });

    let tree;
    act(() => {
      tree = renderer.create(<AboutScreen onBack={jest.fn()} />);
    });

    const checkBtn = findButton(tree, 'Check for Update');
    await act(async () => {
      await checkBtn.props.onPress();
    });

    expect(Updates.checkForUpdateAsync).toHaveBeenCalledTimes(1);
    expect(Updates.fetchUpdateAsync).toHaveBeenCalledTimes(1);
    expect(hasText(tree, 'Update downloaded — restart to apply.')).toBe(true);

    // Lag-fallback: the hook's isUpdatePending is still false here, so the
    // panel must offer its own restart button — the user should never be
    // left with a downloaded update and no restart affordance. Once the
    // hook flips isUpdatePending true, the global banner takes over and
    // this panel button disappears (covered by the pending-state test).
    const restartBtn = findButton(tree, 'Restart to Apply');
    expect(restartBtn).toBeDefined();

    act(() => {
      restartBtn.props.onPress();
    });
    expect(Updates.reloadAsync).toHaveBeenCalledTimes(1);
  });

  test('update available but fetch result is not new', async () => {
    Updates.checkForUpdateAsync.mockResolvedValue({ isAvailable: true });
    Updates.fetchUpdateAsync.mockResolvedValue({ isNew: false });

    let tree;
    act(() => {
      tree = renderer.create(<AboutScreen onBack={jest.fn()} />);
    });

    const checkBtn = findButton(tree, 'Check for Update');
    await act(async () => {
      await checkBtn.props.onPress();
    });

    expect(Updates.checkForUpdateAsync).toHaveBeenCalledTimes(1);
    expect(Updates.fetchUpdateAsync).toHaveBeenCalledTimes(1);
    expect(hasText(tree, 'Already up to date.')).toBe(true);

    const restartBtn = findButton(tree, 'Restart to Apply');
    expect(restartBtn).toBeUndefined();
  });

  test('error during update check flow', async () => {
    Updates.checkForUpdateAsync.mockRejectedValue(new Error('Network error'));

    let tree;
    act(() => {
      tree = renderer.create(<AboutScreen onBack={jest.fn()} />);
    });

    const checkBtn = findButton(tree, 'Check for Update');
    await act(async () => {
      await checkBtn.props.onPress();
    });

    expect(Updates.checkForUpdateAsync).toHaveBeenCalledTimes(1);
    expect(Updates.fetchUpdateAsync).not.toHaveBeenCalled();
    expect(hasText(tree, 'Check failed (run from a built binary to test OTA).')).toBe(true);

    const restartBtn = findButton(tree, 'Restart to Apply');
    expect(restartBtn).toBeUndefined();
  });

  test('suppresses its own restart prompt when an update is already pending (global banner owns it)', () => {
    Updates.useUpdates.mockReturnValue({
      currentlyRunning: {
        isEmbeddedLaunch: false,
        channel: 'production',
        runtimeVersion: '1.0.0',
        updateId: '123456789',
      },
      isUpdateAvailable: false,
      isUpdatePending: true,
      isChecking: false,
    });

    let tree;
    act(() => {
      tree = renderer.create(<AboutScreen onBack={jest.fn()} />);
    });

    // Diagnostics rows stay intact.
    expect(hasText(tree, 'production')).toBe(true);
    expect(hasText(tree, '1.0.0')).toBe(true);

    // Duplicate pending alert row and restart button are suppressed; the
    // global app-shell banner is the only restart affordance now.
    expect(hasText(tree, 'Update downloaded — restart to apply.')).toBe(false);

    const checkBtn = findButton(tree, 'Check for Update');
    const restartBtn = findButton(tree, 'Restart to Apply');

    expect(checkBtn).toBeUndefined();
    expect(restartBtn).toBeUndefined();
  });

  test('keeps the isUpdateAvailable alert text when an update is available but not yet pending', () => {
    Updates.useUpdates.mockReturnValue({
      currentlyRunning: {
        isEmbeddedLaunch: true,
        channel: 'production',
        runtimeVersion: '1.0.0',
        updateId: '123456789',
      },
      isUpdateAvailable: true,
      isUpdatePending: false,
      isChecking: false,
    });

    let tree;
    act(() => {
      tree = renderer.create(<AboutScreen onBack={jest.fn()} />);
    });

    expect(hasText(tree, 'Update available.')).toBe(true);

    const checkBtn = findButton(tree, 'Check for Update');
    const restartBtn = findButton(tree, 'Restart to Apply');

    expect(checkBtn).toBeDefined();
    expect(restartBtn).toBeUndefined();
  });
});

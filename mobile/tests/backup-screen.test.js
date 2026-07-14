// Backup import-confirm tests (issue #361, follow-up to #356).
//
// #356 added a destructive-style confirmation Alert before the BackupScreen
// import actually replaces all local data. handleImport now:
//   - rejects empty/whitespace paste with guidance WITHOUT firing the Alert,
//   - otherwise fires a "Replace all data?" Alert and only calls onImport when
//     the destructive "Replace data" option is confirmed,
//   - surfaces "Data restored successfully." on a successful import.
//
// These tests render the real BackupScreen, drive the Import button's onPress,
// mock Alert.alert to capture the button array (mirroring the pattern in
// account-lifecycle-ui.test.js), and invoke the relevant button's onPress.
//
// Issue #479: export failure paths must preserve the underlying error message.
// Tests for both the onExport rejection path and the Share.share() throw path
// are in the "BackupScreen export error propagation" describe block below.

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Alert, Share } from 'react-native';
import { BackupScreen } from '../components/BackupScreen';

// Capture the most recent Alert.alert invocation so tests can inspect/trigger
// the confirm/cancel buttons it was given.
let lastAlert;
beforeEach(() => {
  lastAlert = null;
  jest.spyOn(Alert, 'alert').mockImplementation((title, message, buttons) => {
    lastAlert = { title, message, buttons };
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function findButton(tree, title) {
  return tree.root
    .findAll(
      (node) =>
        typeof node.props.title === 'string' &&
        node.props.title === title &&
        typeof node.props.onPress === 'function',
    )[0];
}

function alertButton(label) {
  return lastAlert.buttons.find((b) => b.text === label);
}

function renderScreen(props = {}) {
  let tree;
  act(() => {
    tree = renderer.create(
      React.createElement(BackupScreen, {
        onBack: jest.fn(),
        onExport: jest.fn(),
        onImport: jest.fn().mockResolvedValue({ ok: true }),
        ...props,
      }),
    );
  });
  return tree;
}

function statusMatches(tree, pattern) {
  return pattern.test(JSON.stringify(tree.toJSON()));
}

const VALID_JSON = JSON.stringify({ version: 1, entries: [] });

describe('BackupScreen import confirmation', () => {
  test('valid paste fires confirmation Alert and does NOT call onImport before confirm', () => {
    const onImport = jest.fn().mockResolvedValue({ ok: true });
    const tree = renderScreen({ onImport });

    const input = tree.root.findByType('TextInput');
    act(() => {
      input.props.onChangeText(VALID_JSON);
    });

    const importBtn = findButton(tree, 'Import Data');
    act(() => {
      importBtn.props.onPress();
    });

    // A destructive confirmation Alert is shown, and nothing is imported yet.
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(lastAlert.title).toBe('Replace all data?');
    expect(alertButton('Replace data').style).toBe('destructive');
    expect(onImport).not.toHaveBeenCalled();
  });

  test('Cancel is a safe no-op — onImport is never called', () => {
    const onImport = jest.fn().mockResolvedValue({ ok: true });
    const tree = renderScreen({ onImport });

    const input = tree.root.findByType('TextInput');
    act(() => {
      input.props.onChangeText(VALID_JSON);
    });

    const importBtn = findButton(tree, 'Import Data');
    act(() => {
      importBtn.props.onPress();
    });

    const cancel = alertButton('Cancel');
    expect(cancel.style).toBe('cancel');
    // Cancel has no onPress (dismiss only); invoking it if present must not import.
    act(() => {
      if (typeof cancel.onPress === 'function') cancel.onPress();
    });

    expect(onImport).not.toHaveBeenCalled();
    expect(statusMatches(tree, /Data restored successfully/)).toBe(false);
  });

  test('confirming the destructive option calls onImport and surfaces success', async () => {
    const onImport = jest.fn().mockResolvedValue({ ok: true });
    const tree = renderScreen({ onImport });

    const input = tree.root.findByType('TextInput');
    act(() => {
      input.props.onChangeText(VALID_JSON);
    });

    const importBtn = findButton(tree, 'Import Data');
    act(() => {
      importBtn.props.onPress();
    });

    await act(async () => {
      await alertButton('Replace data').onPress();
    });

    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onImport).toHaveBeenCalledWith(JSON.parse(VALID_JSON));
    expect(statusMatches(tree, /Data restored successfully\./)).toBe(true);
  });

  test('empty/whitespace paste shows guidance WITHOUT firing the Alert', () => {
    const onImport = jest.fn().mockResolvedValue({ ok: true });
    const tree = renderScreen({ onImport });

    const input = tree.root.findByType('TextInput');
    act(() => {
      input.props.onChangeText('   \n\t  ');
    });

    const importBtn = findButton(tree, 'Import Data');
    act(() => {
      importBtn.props.onPress();
    });

    expect(Alert.alert).not.toHaveBeenCalled();
    expect(onImport).not.toHaveBeenCalled();
    expect(statusMatches(tree, /Paste your backup JSON first\./)).toBe(true);
  });
});

// Issue #479: export failure paths must preserve the underlying error message.
describe('BackupScreen export error propagation', () => {
  function alertButton(label) {
    return lastAlert.buttons.find((b) => b.text === label);
  }

  test('onExport returning { ok: false } surfaces the error message', async () => {
    const onExport = jest.fn().mockResolvedValue({ ok: false, error: 'Storage read failed.' });
    const tree = renderScreen({ onExport });

    const exportBtn = findButton(tree, 'Export Local Backup');
    act(() => {
      exportBtn.props.onPress();
    });

    await act(async () => {
      await alertButton('Export anyway').onPress();
    });

    expect(onExport).toHaveBeenCalledTimes(1);
    expect(statusMatches(tree, /Storage read failed\./)).toBe(true);
  });

  test('onExport returning { ok: false } with no error falls back to generic message', async () => {
    const onExport = jest.fn().mockResolvedValue({ ok: false });
    const tree = renderScreen({ onExport });

    const exportBtn = findButton(tree, 'Export Local Backup');
    act(() => {
      exportBtn.props.onPress();
    });

    await act(async () => {
      await alertButton('Export anyway').onPress();
    });

    expect(statusMatches(tree, /Export failed\./)).toBe(true);
  });

  test('Share.share() throwing preserves the underlying error message', async () => {
    const onExport = jest.fn().mockResolvedValue({ ok: true, json: '{"version":"3"}' });
    jest.spyOn(Share, 'share').mockRejectedValue(new Error('Sharing unavailable'));
    const tree = renderScreen({ onExport });

    const exportBtn = findButton(tree, 'Export Local Backup');
    act(() => {
      exportBtn.props.onPress();
    });

    await act(async () => {
      await alertButton('Export anyway').onPress();
    });

    expect(statusMatches(tree, /Sharing unavailable/)).toBe(true);
  });

  test('Share.share() throwing with no message falls back to generic message', async () => {
    const onExport = jest.fn().mockResolvedValue({ ok: true, json: '{"version":"3"}' });
    jest.spyOn(Share, 'share').mockRejectedValue(new Error());
    const tree = renderScreen({ onExport });

    const exportBtn = findButton(tree, 'Export Local Backup');
    act(() => {
      exportBtn.props.onPress();
    });

    await act(async () => {
      await alertButton('Export anyway').onPress();
    });

    expect(statusMatches(tree, /Export failed\./)).toBe(true);
  });
});

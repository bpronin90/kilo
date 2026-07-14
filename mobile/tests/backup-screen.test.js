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
import { Alert, Platform, Share } from 'react-native';
import { BackupScreen } from '../components/BackupScreen';

// BackupScreen requires this lazily (a static import that failed to resolve
// would break the bundle and leave the app unopenable), so a module-scope mock
// is what the require() inside the component picks up.
jest.mock('expo-file-system/legacy', () => ({
  StorageAccessFramework: {
    requestDirectoryPermissionsAsync: jest.fn(),
    createFileAsync: jest.fn(),
    writeAsStringAsync: jest.fn(),
    readDirectoryAsync: jest.fn(),
    readAsStringAsync: jest.fn(),
  },
}));

// eslint-disable-next-line import/first
import { StorageAccessFramework as SAF } from 'expo-file-system/legacy';

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
    expect(statusMatches(tree, /Load a backup file or paste your backup JSON first\./)).toBe(true);
  });
});

// Issue #488: the Android file export/import path.
//
// Share.share({ message }) pushes the payload through a share intent, which
// crosses Binder and caps out near 1MB — so large backups threw instead of
// exporting. The file path exists to keep the payload out of the intent, and it
// is the ONLY artifact that can carry device-local profile fields
// (date_of_birth, sex, height_cm, activity_level) across an uninstall.
//
// The safety contract: the user must never be left with no export route. A
// cancelled folder picker or a failed write falls back to the share sheet.
describe('BackupScreen file export/import (Android)', () => {
  const originalOS = Platform.OS;
  // Comfortably past the Binder transaction limit that broke Share.share.
  const LARGE_JSON = JSON.stringify({ version: '3', blob: 'x'.repeat(2 * 1024 * 1024) });

  beforeEach(() => {
    Platform.OS = 'android';
    SAF.requestDirectoryPermissionsAsync.mockReset();
    SAF.createFileAsync.mockReset();
    SAF.writeAsStringAsync.mockReset();
    SAF.readDirectoryAsync.mockReset();
    SAF.readAsStringAsync.mockReset();
    jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
  });

  afterEach(() => {
    Platform.OS = originalOS;
  });

  // Drives Export through the unencrypted-data confirmation the user must ack.
  async function confirmExport(tree) {
    const exportBtn = findButton(tree, 'Export Local Backup');
    act(() => {
      exportBtn.props.onPress();
    });
    await act(async () => {
      await alertButton('Export anyway').onPress();
    });
  }

  test('writes a large payload to a file and never touches the share intent', async () => {
    SAF.requestDirectoryPermissionsAsync.mockResolvedValue({ granted: true, directoryUri: 'content://tree/downloads' });
    SAF.createFileAsync.mockResolvedValue('content://tree/downloads/kilo-backup-2026-07-14');
    SAF.writeAsStringAsync.mockResolvedValue(undefined);

    const tree = renderScreen({ onExport: jest.fn().mockResolvedValue({ ok: true, json: LARGE_JSON }) });
    await confirmExport(tree);

    expect(SAF.createFileAsync).toHaveBeenCalledWith(
      'content://tree/downloads',
      expect.stringContaining('kilo-backup-'),
      'application/json',
    );
    expect(SAF.writeAsStringAsync).toHaveBeenCalledWith(
      'content://tree/downloads/kilo-backup-2026-07-14',
      LARGE_JSON,
    );
    // The whole point: the payload must not go through the intent.
    expect(Share.share).not.toHaveBeenCalled();
    expect(statusMatches(tree, /Backup saved to the folder you chose\./)).toBe(true);
  });

  test('cancelling the folder picker falls back to the share sheet, not an error', async () => {
    SAF.requestDirectoryPermissionsAsync.mockResolvedValue({ granted: false });

    const tree = renderScreen({ onExport: jest.fn().mockResolvedValue({ ok: true, json: VALID_JSON }) });
    await confirmExport(tree);

    // The user must never be left with no way to get their data out.
    expect(Share.share).toHaveBeenCalledWith({ message: VALID_JSON });
    expect(SAF.writeAsStringAsync).not.toHaveBeenCalled();
  });

  test('a failed file write falls back to the share sheet', async () => {
    SAF.requestDirectoryPermissionsAsync.mockResolvedValue({ granted: true, directoryUri: 'content://tree/x' });
    SAF.createFileAsync.mockRejectedValue(new Error('SAF unavailable'));

    const tree = renderScreen({ onExport: jest.fn().mockResolvedValue({ ok: true, json: VALID_JSON }) });
    await confirmExport(tree);

    expect(Share.share).toHaveBeenCalledWith({ message: VALID_JSON });
  });

  test('Load Backup File reads the newest kilo backup into the import box', async () => {
    SAF.requestDirectoryPermissionsAsync.mockResolvedValue({ granted: true, directoryUri: 'content://tree/dl' });
    SAF.readDirectoryAsync.mockResolvedValue([
      'content://tree/dl/unrelated.txt',
      'content://tree/dl/kilo-backup-2026-07-01',
      'content://tree/dl/kilo-backup-2026-07-14',
    ]);
    SAF.readAsStringAsync.mockResolvedValue(VALID_JSON);

    const tree = renderScreen();
    const loadBtn = findButton(tree, 'Load Backup File');
    await act(async () => {
      await loadBtn.props.onPress();
    });

    // Newest wins, and non-Kilo files in the folder are ignored.
    expect(SAF.readAsStringAsync).toHaveBeenCalledWith('content://tree/dl/kilo-backup-2026-07-14');
    expect(tree.root.findByType('TextInput').props.value).toBe(VALID_JSON);
    expect(statusMatches(tree, /Loaded kilo-backup-2026-07-14/)).toBe(true);
  });

  test('loading a file does NOT restore until the destructive confirm is accepted', async () => {
    SAF.requestDirectoryPermissionsAsync.mockResolvedValue({ granted: true, directoryUri: 'content://tree/dl' });
    SAF.readDirectoryAsync.mockResolvedValue(['content://tree/dl/kilo-backup-2026-07-14']);
    SAF.readAsStringAsync.mockResolvedValue(VALID_JSON);
    const onImport = jest.fn().mockResolvedValue({ ok: true });

    const tree = renderScreen({ onImport });
    await act(async () => {
      await findButton(tree, 'Load Backup File').props.onPress();
    });

    // Loading a file must not itself replace data.
    expect(onImport).not.toHaveBeenCalled();

    act(() => {
      findButton(tree, 'Import Data').props.onPress();
    });
    expect(lastAlert.title).toBe('Replace all data?');
    await act(async () => {
      await alertButton('Replace data').onPress();
    });
    expect(onImport).toHaveBeenCalledWith(JSON.parse(VALID_JSON));
  });

  test('reports when the chosen folder holds no Kilo backup', async () => {
    SAF.requestDirectoryPermissionsAsync.mockResolvedValue({ granted: true, directoryUri: 'content://tree/dl' });
    SAF.readDirectoryAsync.mockResolvedValue(['content://tree/dl/holiday-photo.jpg']);

    const tree = renderScreen();
    await act(async () => {
      await findButton(tree, 'Load Backup File').props.onPress();
    });

    expect(SAF.readAsStringAsync).not.toHaveBeenCalled();
    expect(statusMatches(tree, /No Kilo backup found in that folder\./)).toBe(true);
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

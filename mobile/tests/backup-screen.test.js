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
import { AccessibilityInfo, Alert, Platform, Share } from 'react-native';
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

// Issue #578: BackupScreen reads CSV export data directly from storage
// (rather than through a prop, see the comment on `csvFileName` in
// BackupScreen.js), so these tests control what that read returns without
// touching real AsyncStorage.
const mockLoadWorkoutNotes = jest.fn();
const mockLoadWeightEntriesRaw = jest.fn();
jest.mock('../storage/entries', () => ({
  loadWorkoutNotes: (...args) => mockLoadWorkoutNotes(...args),
  loadWeightEntriesRaw: (...args) => mockLoadWeightEntriesRaw(...args),
}));

// The Cloud section (#822) mounts the real CloudSyncRecovery when signed in;
// these mirror the mocks account-lifecycle-ui.test.js uses so it mounts
// deterministically without hitting a real Supabase client.
jest.mock('../storage/cloud/consent', () => {
  const actual = jest.requireActual('../storage/cloud/consent');
  return {
    ...actual,
    fetchConsentStatus: jest.fn().mockResolvedValue({ allowed: true, code: 'OK' }),
    withdrawConsent: jest.fn().mockResolvedValue({ ok: true, status: 'deletion_pending' }),
    requestHealthDataDeletion: jest.fn().mockResolvedValue({ ok: true }),
    fetchActiveConsentRevision: jest.fn().mockResolvedValue({
      catalog_revision: 1,
      material_version: 1,
      privacy_policy_url: 'https://example.invalid/privacy.html',
    }),
  };
});

jest.mock('../hooks/useEntries', () => ({
  useSyncRecovery: () => mockSyncRecovery,
  useCloudExport: () => ({ exportCloud: jest.fn() }),
}));

jest.mock('../storage/cloud/syncAdapter', () => ({
  getPendingSyncIntent: () => mockPendingSyncIntent(),
}));

const mockScreenScrollTo = jest.fn();
jest.mock('../components/ScreenShell', () => {
  const RN = require('react-native');
  const ReactActual = require('react');
  return {
    ScreenShell: ReactActual.forwardRef(({ children, onBack }, ref) => {
      ReactActual.useImperativeHandle(ref, () => ({ scrollTo: mockScreenScrollTo }));
      return ReactActual.createElement(
        RN.View,
        null,
        onBack ? ReactActual.createElement(RN.Text, { onPress: onBack }, '← Back') : null,
        children,
      );
    }),
  };
});

// eslint-disable-next-line import/first
import { StorageAccessFramework as SAF } from 'expo-file-system/legacy';
// eslint-disable-next-line import/first
import { CloudSyncRecovery } from '../screens/more/CloudSyncRecovery';
// The other half of #903's path: MoreScreen forwards the intent's anchor into
// the real BackupScreen below. Imported after the mocks above, like the rest.
// eslint-disable-next-line import/first
import { MoreScreen } from '../screens/MoreScreen';

let mockSyncRecovery;
let mockPendingSyncIntent;

function makeSyncRecovery({ bootstrapStatus = 'idle', syncStatus = 'idle' } = {}) {
  return {
    bootstrap: { status: bootstrapStatus, retryable: false },
    sync: { status: syncStatus, retryable: false },
    runBootstrap: jest.fn(),
    runSync: jest.fn(),
    retryBootstrap: jest.fn(),
    retrySync: jest.fn(),
  };
}

// Default `auth` shape for tests that don't care about the Cloud section: a
// signed-out, unconfigured build, so the Cloud section renders its plain
// "not configured" note and the Danger Zone's Wipe button works with no auth
// call at all wired up.
const DEFAULT_AUTH = { configured: false, signedIn: false, loading: false };

// Capture the most recent Alert.alert invocation so tests can inspect/trigger
// the confirm/cancel buttons it was given.
let lastAlert;
beforeEach(() => {
  lastAlert = null;
  jest.spyOn(Alert, 'alert').mockImplementation((title, message, buttons) => {
    lastAlert = { title, message, buttons };
  });
  mockSyncRecovery = makeSyncRecovery();
  mockPendingSyncIntent = jest.fn().mockResolvedValue({ hasPending: false });
  mockScreenScrollTo.mockClear();
  mockLoadWorkoutNotes.mockReset().mockResolvedValue([]);
  mockLoadWeightEntriesRaw.mockReset().mockResolvedValue([]);
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
        auth: DEFAULT_AUTH,
        ...props,
      }),
    );
  });
  return tree;
}

function statusMatches(tree, pattern) {
  return pattern.test(JSON.stringify(tree.toJSON()));
}

// Lets a mounted CloudSyncRecovery's consent-fetch effect resolve before a
// test interacts further, avoiding act() warnings from the async setConsent.
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
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

// Issue #578: CSV export buttons. CSV is interoperability, never backup — a
// separate confirmation ("CSV is not a backup") gates it, distinct from the
// JSON export's "Export is unencrypted" Alert, and it reuses the same
// Android-file/Share-fallback mechanics `shareExport` already established.
describe('BackupScreen CSV export (#578)', () => {
  const originalOS = Platform.OS;

  beforeEach(() => {
    Platform.OS = 'android';
    SAF.requestDirectoryPermissionsAsync.mockReset();
    SAF.createFileAsync.mockReset();
    SAF.writeAsStringAsync.mockReset();
    jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
  });

  afterEach(() => {
    Platform.OS = originalOS;
  });

  async function confirmCsvExport(tree, buttonTitle) {
    const btn = findButton(tree, buttonTitle);
    act(() => {
      btn.props.onPress();
    });
    expect(lastAlert.title).toBe('CSV is not a backup');
    await act(async () => {
      await alertButton('Export anyway').onPress();
    });
  }

  test('Export Workouts CSV requires the not-a-backup confirmation before reading storage', () => {
    const tree = renderScreen();
    const btn = findButton(tree, 'Export Workouts CSV');
    act(() => {
      btn.props.onPress();
    });
    expect(lastAlert.title).toBe('CSV is not a backup');
    expect(mockLoadWorkoutNotes).not.toHaveBeenCalled();
  });

  test('confirming Export Workouts CSV writes a file built from live notes', async () => {
    mockLoadWorkoutNotes.mockResolvedValue([
      { id: 'n1', title: 'Push Day', isCurrent: true, raw_text: 'Monday\n-Bench\n- 100 5' },
    ]);
    SAF.requestDirectoryPermissionsAsync.mockResolvedValue({ granted: true, directoryUri: 'content://tree/dl' });
    SAF.createFileAsync.mockResolvedValue('content://tree/dl/kilo-workouts-2026-09-03');
    SAF.writeAsStringAsync.mockResolvedValue(undefined);

    const tree = renderScreen();
    await confirmCsvExport(tree, 'Export Workouts CSV');

    expect(mockLoadWorkoutNotes).toHaveBeenCalled();
    expect(SAF.createFileAsync).toHaveBeenCalledWith(
      'content://tree/dl',
      expect.stringContaining('kilo-workouts-'),
      'text/csv',
    );
    const written = SAF.writeAsStringAsync.mock.calls[0][1];
    expect(written).toContain('routine_title');
    expect(written).toContain('Push Day');
    expect(Share.share).not.toHaveBeenCalled();
    expect(statusMatches(tree, /CSV saved to the folder you chose\./)).toBe(true);
  });

  test('confirming Export Weight CSV writes a file built from weight entries', async () => {
    mockLoadWeightEntriesRaw.mockResolvedValue([
      { id: 'w1', entry_type: 'weight', date: '2026-01-01', logged_at: '2026-01-01T08:00:00.000Z', weight_value: 180, note: '' },
    ]);
    SAF.requestDirectoryPermissionsAsync.mockResolvedValue({ granted: true, directoryUri: 'content://tree/dl' });
    SAF.createFileAsync.mockResolvedValue('content://tree/dl/kilo-weight-2026-09-03');
    SAF.writeAsStringAsync.mockResolvedValue(undefined);

    const tree = renderScreen();
    await confirmCsvExport(tree, 'Export Weight CSV');

    expect(mockLoadWeightEntriesRaw).toHaveBeenCalled();
    expect(mockLoadWorkoutNotes).not.toHaveBeenCalled();
    expect(SAF.createFileAsync).toHaveBeenCalledWith(
      'content://tree/dl',
      expect.stringContaining('kilo-weight-'),
      'text/csv',
    );
    const written = SAF.writeAsStringAsync.mock.calls[0][1];
    expect(written).toContain('weight_value_lb');
    expect(written).toContain('180');
  });

  test('cancelling the folder picker falls back to the share sheet for CSV too', async () => {
    mockLoadWorkoutNotes.mockResolvedValue([]);
    SAF.requestDirectoryPermissionsAsync.mockResolvedValue({ granted: false });

    const tree = renderScreen();
    await confirmCsvExport(tree, 'Export Workouts CSV');

    expect(Share.share).toHaveBeenCalledWith({ message: expect.stringContaining('routine_title') });
    expect(SAF.writeAsStringAsync).not.toHaveBeenCalled();
  });

  test('Cancel on the CSV disclosure Alert never reads storage', () => {
    const tree = renderScreen();
    const btn = findButton(tree, 'Export Weight CSV');
    act(() => {
      btn.props.onPress();
    });
    act(() => {
      alertButton('Cancel').onPress?.();
    });
    expect(mockLoadWeightEntriesRaw).not.toHaveBeenCalled();
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

// ---------------------------------------------------------------------------
// Cloud section and Danger Zone (#822). Account is identity-only now;
// CloudSyncRecovery, the server-held "Export Account Data" export, and the
// device-wipe actions all consolidated into Data & Backup, split into a
// clearly-labeled Cloud section and a Danger Zone.
// ---------------------------------------------------------------------------

describe('BackupScreen Cloud section', () => {
  test('shows a plain note when cloud accounts are not configured', () => {
    const tree = renderScreen({ auth: { configured: false } });

    expect(statusMatches(tree, /Cloud accounts are not configured in this build\./)).toBe(true);
    expect(tree.root.findAllByType(CloudSyncRecovery).length).toBe(0);
  });

  test('shows a sign-in CTA when configured but signed out, and it calls onGoToAccount', () => {
    const onGoToAccount = jest.fn();
    const tree = renderScreen({
      auth: { configured: true, loading: false, signedIn: false },
      onGoToAccount,
    });

    expect(statusMatches(tree, /Cloud backup is off\./)).toBe(true);
    const cta = findButton(tree, 'Sign In / Create Account');
    act(() => { cta.props.onPress(); });
    expect(onGoToAccount).toHaveBeenCalledTimes(1);
  });

  test('renders nothing extra while the shell session is still loading', () => {
    const tree = renderScreen({ auth: { configured: true, loading: true, signedIn: false } });

    expect(statusMatches(tree, /Cloud backup is off\./)).toBe(false);
    expect(statusMatches(tree, /Cloud accounts are not configured/)).toBe(false);
  });

  test('signed in: mounts CloudSyncRecovery and offers Export Account Data', async () => {
    jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    const serverExport = jest.fn().mockResolvedValue({ ok: true, json: '{}' });
    const tree = renderScreen({
      auth: { configured: true, loading: false, signedIn: true, user: { id: 'u1', email: 'a@test.com' }, serverExport },
    });

    expect(tree.root.findByType(CloudSyncRecovery)).toBeTruthy();
    await flush();

    const exportBtn = findButton(tree, 'Export Account Data');
    await act(async () => { await exportBtn.props.onPress(); });
    expect(serverExport).toHaveBeenCalledTimes(1);
    expect(statusMatches(tree, /Account data exported\./)).toBe(true);
  });

  test('signed in: CloudSyncRecovery consent-dismiss scrolls to the top through the shared ScreenShell ref', async () => {
    const tree = renderScreen({
      auth: { configured: true, loading: false, signedIn: true, user: { id: 'u1', email: 'a@test.com' } },
    });
    await flush();

    const recovery = tree.root.findByType(CloudSyncRecovery);
    act(() => { recovery.props.onConsentDismiss(); });

    expect(mockScreenScrollTo).toHaveBeenCalledWith({ y: 0, animated: true });
  });
});

describe('BackupScreen Danger Zone', () => {
  test('Wipe Device Data works with no auth prop at all', async () => {
    let tree;
    act(() => {
      tree = renderer.create(
        React.createElement(BackupScreen, { onBack: jest.fn(), onExport: jest.fn(), onImport: jest.fn() }),
      );
    });

    const wipeBtn = findButton(tree, 'Wipe Device Data');
    act(() => { wipeBtn.props.onPress(); });
    expect(lastAlert.title).toBe('Wipe Device Data');
    // No auth.wipeDeviceData exists; confirming must not throw.
    await act(async () => { await alertButton('Wipe Device Data').onPress(); });
  });

  test('shows the retry label and warning when a prior wipe failed', () => {
    const wipeDeviceData = jest.fn().mockResolvedValue({ ok: true });
    const tree = renderScreen({ auth: { configured: false, deviceWipeRequired: true, wipeDeviceData } });

    expect(tree.root.findByProps({ accessibilityLabel: 'Device wipe required' })).toBeTruthy();
    const retryBtn = findButton(tree, 'Retry Device Data Wipe');
    act(() => { retryBtn.props.onPress(); });
    return act(async () => { await alertButton('Wipe Device Data').onPress(); }).then(() => {
      expect(wipeDeviceData).toHaveBeenCalledTimes(1);
    });
  });

  test('Sign Out & Wipe Device Data only renders when signed in', () => {
    const signedOut = renderScreen({ auth: { configured: true, loading: false, signedIn: false } });
    expect(signedOut.root.findAllByProps({ accessibilityLabel: 'Sign out and wipe device data' }).length).toBe(0);

    const signOut = jest.fn().mockResolvedValue({ ok: true });
    const signedIn = renderScreen({
      auth: { configured: true, loading: false, signedIn: true, user: { id: 'u1', email: 'a@test.com' }, signOut },
    });
    const wipeBtn = signedIn.root.findByProps({ accessibilityLabel: 'Sign out and wipe device data' });
    act(() => { wipeBtn.props.onPress(); });
    expect(lastAlert.title).toBe('Sign Out and Wipe Device Data');
  });
});

// Cloud Sync anchored arrival (#903). A `{ kind: 'subview', view: 'backup',
// anchor: 'cloud-sync' }` intent has to land the user on the Cloud Sync
// Recovery panel, which sits below Export and Import and is therefore off
// screen on a plain arrival. BackupScreen records the request and fulfills it
// from the panel's own layout; MoreScreen is what forwards the anchor to it.
describe('BackupScreen Cloud Sync anchor (#903)', () => {
  const SIGNED_IN = {
    configured: true, loading: false, signedIn: true, user: { id: 'u1', email: 'a@test.com' },
  };
  const CLOUD_SYNC_Y = 812;

  let announce;
  beforeEach(() => {
    // Already a jest.fn() in the react-native preset, so spyOn hands back that
    // shared mock rather than a fresh one — clear it or calls accumulate
    // across tests.
    announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    announce.mockClear();
  });

  // The wrapper that measures the panel's position in the scroll column.
  function layoutCloudSyncPanel(tree, y = CLOUD_SYNC_Y) {
    const wrapper = tree.root.findByType(CloudSyncRecovery).parent;
    act(() => { wrapper.props.onLayout({ nativeEvent: { layout: { y } } }); });
  }

  test('an anchored intent scrolls to the panel once it has been measured', async () => {
    const tree = renderScreen({ auth: SIGNED_IN, navAnchor: 'cloud-sync', navAnchorKey: 1 });
    await flush();

    // Nothing is measured on a fresh mount, so the request is still pending and
    // must not have guessed at an offset.
    expect(mockScreenScrollTo).not.toHaveBeenCalled();

    layoutCloudSyncPanel(tree);

    expect(mockScreenScrollTo).toHaveBeenCalledWith({ y: CLOUD_SYNC_Y, animated: true });
    // Announced, not focused: an interaction already in progress keeps focus.
    expect(announce).toHaveBeenCalledWith('Cloud Sync');
  });

  test('a later reflow of the same panel does not yank the user back to it', async () => {
    const tree = renderScreen({ auth: SIGNED_IN, navAnchor: 'cloud-sync', navAnchorKey: 1 });
    await flush();
    layoutCloudSyncPanel(tree);
    mockScreenScrollTo.mockClear();

    layoutCloudSyncPanel(tree, CLOUD_SYNC_Y + 120);

    expect(mockScreenScrollTo).not.toHaveBeenCalled();
  });

  test('an anchorless intent, and ordinary manual navigation, do not scroll', async () => {
    const anchorless = renderScreen({ auth: SIGNED_IN, navAnchor: null, navAnchorKey: 4 });
    await flush();
    layoutCloudSyncPanel(anchorless);
    expect(mockScreenScrollTo).not.toHaveBeenCalled();

    // Manual navigation carries no intent at all: key 0 is "never requested".
    const manual = renderScreen({ auth: SIGNED_IN });
    await flush();
    layoutCloudSyncPanel(manual);
    expect(mockScreenScrollTo).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
  });

  test('a repeated identical intent re-applies under its later key', async () => {
    const tree = renderScreen({ auth: SIGNED_IN, navAnchor: 'cloud-sync', navAnchorKey: 1 });
    await flush();
    layoutCloudSyncPanel(tree);
    expect(mockScreenScrollTo).toHaveBeenCalledTimes(1);

    // Same logical target, so only the shell's monotonic key can carry the
    // second request — and the panel's offset is already known, so it lands
    // without waiting for another layout.
    act(() => {
      tree.update(
        React.createElement(BackupScreen, {
          onBack: jest.fn(),
          onExport: jest.fn(),
          onImport: jest.fn(),
          auth: SIGNED_IN,
          navAnchor: 'cloud-sync',
          navAnchorKey: 2,
        }),
      );
    });

    expect(mockScreenScrollTo).toHaveBeenCalledTimes(2);
    expect(mockScreenScrollTo).toHaveBeenLastCalledWith({ y: CLOUD_SYNC_Y, animated: true });
  });

  test('signed out there is no panel, so the intent is a safe no-op', async () => {
    const tree = renderScreen({
      auth: { configured: true, loading: false, signedIn: false },
      navAnchor: 'cloud-sync',
      navAnchorKey: 1,
    });
    await flush();

    expect(tree.root.findAllByType(CloudSyncRecovery).length).toBe(0);
    expect(mockScreenScrollTo).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
  });
});

// MoreScreen is the half of #903 that forwards the anchor: App.js's typed
// intent reaches it, and Data & Backup is the sub-view that owns the anchor.
// Rendered here with the real BackupScreen so the whole path — intent in,
// viewport moved — is exercised end to end.
describe('MoreScreen forwards the Cloud Sync anchor (#903)', () => {
  const SIGNED_IN = {
    configured: true, loading: false, signedIn: true, user: { id: 'u1', email: 'a@test.com' },
  };

  function renderMore(props = {}) {
    let tree;
    act(() => {
      tree = renderer.create(React.createElement(MoreScreen, { auth: SIGNED_IN, ...props }));
    });
    return tree;
  }

  function layoutCloudSyncPanel(tree, y = 812) {
    const wrapper = tree.root.findByType(CloudSyncRecovery).parent;
    act(() => { wrapper.props.onLayout({ nativeEvent: { layout: { y } } }); });
  }

  function pressMenuRow(tree, label) {
    act(() => { tree.root.findByProps({ accessibilityLabel: label }).props.onPress(); });
  }

  test('an anchored intent opens Data & Backup and lands on the Cloud Sync panel', async () => {
    const tree = renderMore({ navSubviewView: 'backup', navSubviewAnchor: 'cloud-sync', navSubviewKey: 1 });
    await flush();

    layoutCloudSyncPanel(tree);

    expect(mockScreenScrollTo).toHaveBeenCalledWith({ y: 812, animated: true });
  });

  test('the anchor is consumed once per key: walking back in by hand does not replay it', async () => {
    const tree = renderMore({ navSubviewView: 'backup', navSubviewAnchor: 'cloud-sync', navSubviewKey: 1 });
    await flush();
    layoutCloudSyncPanel(tree);
    expect(mockScreenScrollTo).toHaveBeenCalledTimes(1);
    mockScreenScrollTo.mockClear();

    // Back to the menu and into Data & Backup again, with the shell's key
    // unchanged — this is ordinary manual navigation and must not scroll.
    act(() => { tree.root.findByProps({ children: '← Back' }).props.onPress(); });
    pressMenuRow(tree, 'Data and Backup');
    await flush();
    layoutCloudSyncPanel(tree);

    expect(mockScreenScrollTo).not.toHaveBeenCalled();
  });

  test('an anchor minted for another sub-view is never applied here', async () => {
    // Account is a legitimate anchored destination in the contract; its anchor
    // must not travel to Data & Backup when the user opens it themselves.
    const tree = renderMore({ navSubviewView: 'account', navSubviewAnchor: 'cloud-sync', navSubviewKey: 3 });
    await flush();

    act(() => { tree.root.findByProps({ children: '← Back' }).props.onPress(); });
    pressMenuRow(tree, 'Data and Backup');
    await flush();
    layoutCloudSyncPanel(tree);

    expect(mockScreenScrollTo).not.toHaveBeenCalled();
  });
});

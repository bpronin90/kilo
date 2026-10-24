// Redesign v3 More and Settings grouped panels (#1608).
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { MoreScreen } from '../screens/MoreScreen';
import { accountSummary } from '../screens/more/MoreMenuPanels';
import { CloudSyncContext } from '../hooks/useEntries';
import pkg from '../package.json';

jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: () => null }), { virtual: true });
jest.mock('@react-native-community/datetimepicker', () => () => null, { virtual: true });

function texts(root) {
  return root.findAllByType(Text).map((n) => [].concat(n.props.children).join(''));
}

function pressable(root, label) {
  return root.findAll((n) => n.props?.accessibilityLabel === label && typeof n.props?.onPress === 'function')[0];
}

const SIGNED_IN = { configured: true, signedIn: true, loading: false, user: { email: 'you@example.com' } };

describe('accountSummary', () => {
  test('unconfigured builds say cloud is unavailable', () => {
    expect(accountSummary(null, null).status).toMatch(/Not available/);
    expect(accountSummary({ configured: false }, null).status).toMatch(/Not available/);
  });

  test('signed out and loading never claim a session', () => {
    expect(accountSummary({ configured: true, signedIn: false, loading: false }, null)).toMatchObject({ title: 'Not signed in', tone: 'muted' });
    expect(accountSummary({ configured: true, signedIn: false, loading: true }, null).status).toBe('Checking sign-in…');
  });

  test('signed in without a shell summary shows no sync claim', () => {
    expect(accountSummary(SIGNED_IN, null)).toMatchObject({ title: 'you@example.com', status: 'Signed in', tone: 'muted' });
  });

  test.each([
    [{ isRunning: true, statusLabel: 'Syncing…' }, 'muted', 'sync'],
    [{ hasFailed: true, statusLabel: 'Sync failed' }, 'error', 'sync-problem'],
    [{ hasDirty: true, statusLabel: 'Changes pending' }, 'warning', 'cloud-upload'],
    [{ hasLastSuccess: true, statusLabel: 'Synced' }, 'done', 'cloud-done'],
    [{ statusLabel: 'Not synced yet' }, 'muted', 'cloud-queue'],
  ])('reflects the shell summary %o honestly', (summary, tone, icon) => {
    const result = accountSummary(SIGNED_IN, { summary });
    expect(result).toMatchObject({ tone, icon, status: `Signed in · ${summary.statusLabel}` });
  });

  test('a failure wins over an older success', () => {
    expect(accountSummary(SIGNED_IN, { summary: { hasFailed: true, hasLastSuccess: true, statusLabel: 'Sync failed' } }).tone).toBe('error');
  });
});

describe('More menu', () => {
  function renderMore(auth, summary = null) {
    let tree;
    act(() => {
      tree = renderer.create(
        <CloudSyncContext.Provider value={summary ? { summary } : null}>
          <MoreScreen isActive auth={auth} fatigueMultiplier={1.07} onUpdateFatigueMultiplier={() => {}} />
        </CloudSyncContext.Provider>
      );
    });
    return tree;
  }

  test('renders the three groups in order with all eight destinations', () => {
    const tree = renderMore(SIGNED_IN, { hasLastSuccess: true, statusLabel: 'Synced' });
    const all = texts(tree.root);
    const order = ['Preferences', 'Settings', 'User profile', 'Account & data', 'Account', 'Data and backup', 'Import routine', 'Tools & help', 'Routine prompt tools', 'App guide', 'About Kilo'];
    const positions = order.map((t) => all.indexOf(t));
    positions.forEach((p) => expect(p).toBeGreaterThanOrEqual(0));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(all).toContain(`Version ${pkg.version}`);
    ['Settings', 'User Profile', 'Account', 'Data and Backup', 'Import Routine', 'Routine prompt tools', 'App Guide', 'About Kilo'].forEach((label) => {
      expect(pressable(tree.root, label)).toBeTruthy();
    });
    act(() => tree.unmount());
  });

  test('account row shows the real email and shell sync status, and opens Account', () => {
    const tree = renderMore(SIGNED_IN, { hasFailed: true, statusLabel: 'Sync failed' });
    const all = texts(tree.root);
    expect(all).toContain('you@example.com');
    expect(all).toContain('Signed in · Sync failed');
    const row = tree.root.findAll((n) => n.props?.testID === 'more-account-summary' && n.props?.accessibilityRole)[0];
    expect(row.props.accessibilityRole).toBe('button');
    act(() => row.props.onPress());
    expect(pressable(tree.root, 'Account')).toBeFalsy();
    act(() => tree.unmount());
  });

  test('signed out keeps the Account destination and claims no sync', () => {
    const tree = renderMore({ configured: true, signedIn: false, loading: false });
    const all = texts(tree.root);
    expect(all).toContain('Not signed in');
    expect(all.some((t) => /Synced/.test(t))).toBe(false);
    expect(pressable(tree.root, 'Account')).toBeTruthy();
    act(() => tree.unmount());
  });

  test('Settings row opens Settings with production section order', () => {
    const tree = renderMore(SIGNED_IN);
    act(() => pressable(tree.root, 'Settings').props.onPress());
    const all = texts(tree.root);
    const sections = ['FEATURES', 'REMINDERS', 'APPEARANCE', 'UNITS', 'ADVANCED'].map((t) => all.indexOf(t));
    sections.forEach((p) => expect(p).toBeGreaterThanOrEqual(0));
    expect([...sections].sort((a, b) => a - b)).toEqual(sections);
    expect(all).toContain('Reset to default (1.07)');
    act(() => tree.unmount());
  });
});

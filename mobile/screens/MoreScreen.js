import React, { useState, useEffect } from 'react';
import { Platform, Pressable, BackHandler, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { ScreenShell } from '../components/ScreenShell';
import { Button, InputStyle, SectionTitle } from '../components/UI';
import { Colors } from '../theme/colors';

import { HelpScreen } from '../components/HelpScreen';
import { AboutScreen } from '../components/AboutScreen';
import { BackupScreen } from '../components/BackupScreen';
import { SettingsScreen } from '../components/SettingsScreen';
import { ProfileScreen } from '../components/ProfileScreen';
import { useAuthSession } from '../hooks/useAuthSession';
import { useSyncRecovery, useCloudExport } from '../hooks/useEntries';
import { SYNC_STATUS } from '../storage/syncRecovery';

// User-facing cloud bootstrap/sync recovery panel (Phase 4 / Task 12).
//
// Shows whether each phase is idle/running/failed/complete and offers a
// non-destructive retry only when a phase has failed. There are deliberately no
// admin/support controls here — only the signed-in user's own retry/export.
function CloudSyncRecovery({ user }) {
  const { bootstrap, sync, runBootstrap, runSync, retryBootstrap, retrySync } =
    useSyncRecovery(user);
  const { exportCloud } = useCloudExport();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const phaseLabel = (s) => {
    switch (s.status) {
      case SYNC_STATUS.RUNNING:
        return 'Running…';
      case SYNC_STATUS.FAILED:
        return `Failed${s.error ? `: ${s.error}` : ''}`;
      case SYNC_STATUS.COMPLETE:
        return 'Complete';
      default:
        return 'Idle';
    }
  };

  // Run a phase against its bound runner. Used both for the initial action
  // (drives idle → running → complete/failed for normal, first-time work) and
  // for retry after a failure. The hook binds bootstrap to
  // cloudAdapter.bootstrapFromLocal(userId) and sync to the active adapter's
  // sync() (feature-detected). The store drives the status transitions and
  // leaves local data untouched on failure.
  const handleRun = async (kind, runner) => {
    setBusy(true);
    setStatus('');
    try {
      const result = await runner();
      setStatus(
        result?.ok
          ? `${kind === 'bootstrap' ? 'Bootstrap' : 'Sync'} complete.`
          : result?.error || 'Could not start.'
      );
    } finally {
      setBusy(false);
    }
  };

  const isRunning = (s) => s.status === SYNC_STATUS.RUNNING;
  // The initial action is offered while a phase has never run (idle) and is not
  // already running. Once it fails it becomes retryable and the retry button
  // takes over.
  const canStart = (s) => s.status === SYNC_STATUS.IDLE;

  const handleCloudExport = async () => {
    setBusy(true);
    setStatus('');
    try {
      // Pass the signed-in identity so the export carries cloud.account.
      // buildCloudExport reduces this to non-sensitive { id, email }.
      const account = user ? { id: user.id, email: user.email } : null;
      const result = await exportCloud(account);
      if (!result.ok) {
        setStatus(result.error || 'Cloud export failed.');
        return;
      }
      await Share.share({ message: result.json });
      setStatus('Cloud export ready.');
    } catch {
      setStatus('Cloud export failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.accountBlock}>
      <SectionTitle>Cloud Sync</SectionTitle>

      <View style={styles.syncRow}>
        <Text style={styles.syncLabel}>Bootstrap</Text>
        <Text style={styles.syncValue} accessibilityLabel={`Bootstrap status ${bootstrap.status}`}>
          {phaseLabel(bootstrap)}
        </Text>
      </View>
      {canStart(bootstrap) ? (
        <Button
          title={busy ? 'Working…' : 'Run Bootstrap'}
          disabled={busy || isRunning(bootstrap)}
          onPress={() => handleRun('bootstrap', runBootstrap)}
        />
      ) : null}
      {bootstrap.retryable ? (
        <Button
          title={busy ? 'Working…' : 'Retry Bootstrap'}
          disabled={busy}
          onPress={() => handleRun('bootstrap', retryBootstrap)}
        />
      ) : null}

      <View style={styles.syncRow}>
        <Text style={styles.syncLabel}>Sync</Text>
        <Text style={styles.syncValue} accessibilityLabel={`Sync status ${sync.status}`}>
          {phaseLabel(sync)}
        </Text>
      </View>
      {canStart(sync) ? (
        <Button
          title={busy ? 'Working…' : 'Run Sync'}
          disabled={busy || isRunning(sync)}
          onPress={() => handleRun('sync', runSync)}
        />
      ) : null}
      {sync.retryable ? (
        <Button
          title={busy ? 'Working…' : 'Retry Sync'}
          disabled={busy}
          onPress={() => handleRun('sync', retrySync)}
        />
      ) : null}

      <Text style={styles.accountNote}>
        Retrying is safe and never overwrites your local data.
      </Text>

      <Button
        title={busy ? 'Working…' : 'Export Cloud Data'}
        disabled={busy}
        onPress={handleCloudExport}
      />

      {status ? (
        <Text style={styles.accountStatus} accessibilityLabel="Cloud sync status">
          {status}
        </Text>
      ) : null}
    </View>
  );
}

// Minimal account surface to exercise sign in / sign out / session restore /
// password reset against the auth/session hook. This is intentionally narrow:
// it does not gate any local-only app behavior. When cloud accounts are not
// configured in the build, it explains that local data still works without an
// account.
function AccountScreen({ onBack }) {
  const auth = useAuthSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn) => {
    setBusy(true);
    setStatus('');
    try {
      const result = await fn();
      if (result?.ok) {
        setStatus(result.message || 'Done.');
      } else {
        setStatus(result?.error || 'Something went wrong.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenShell
      title="Account"
      subtitle="Cloud sign in is optional. Your data works locally without an account."
      onBack={onBack}
    >
      {!auth.configured ? (
        <Text style={styles.accountNote} accessibilityLabel="Cloud accounts unavailable">
          Cloud accounts are not configured in this build. The app continues to
          work fully offline with your local data.
        </Text>
      ) : auth.signedIn ? (
        <View style={styles.accountBlock}>
          <Text style={styles.accountNote}>
            Signed in as {auth.user?.email || 'your account'}.
          </Text>
          <Button
            title={busy ? 'Working…' : 'Sign Out'}
            disabled={busy}
            onPress={() => run(() => auth.signOut().then((r) => (r.ok ? { ok: true, message: 'Signed out.' } : r)))}
          />
          <CloudSyncRecovery user={auth.user} />
        </View>
      ) : (
        <View style={styles.accountBlock}>
          <TextInput
            style={InputStyle}
            placeholder="Email"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            accessibilityLabel="Email"
          />
          <TextInput
            style={InputStyle}
            placeholder="Password"
            placeholderTextColor={Colors.textMuted}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            accessibilityLabel="Password"
          />
          <Button
            title={busy ? 'Working…' : 'Sign In'}
            disabled={busy}
            onPress={() => run(() => auth.signInWithPassword(email, password).then((r) => (r.ok ? { ok: true, message: 'Signed in.' } : r)))}
          />
          <Button
            title="Create Account"
            disabled={busy}
            onPress={() => run(() => auth.signUpWithPassword(email, password).then((r) => (r.ok ? { ok: true, message: 'Account created. Check your email if confirmation is required.' } : r)))}
          />
          <Button
            title="Reset Password"
            disabled={busy}
            onPress={() => run(() => auth.resetPasswordForEmail(email).then((r) => (r.ok ? { ok: true, message: 'Password reset email sent if the address exists.' } : r)))}
          />
        </View>
      )}
      {status ? (
        <Text style={styles.accountStatus} accessibilityLabel="Account status">
          {status}
        </Text>
      ) : null}
    </ScreenShell>
  );
}

export function MoreScreen({
  onNavigate,
  onExport,
  onImport,
  fatigueMultiplier,
  onUpdateFatigueMultiplier,
  weightDateEditEnabled,
  onUpdateWeightDateEditEnabled,
  deloadDateEditEnabled,
  onUpdateDeloadDateEditEnabled,
}) {
  const [activeView, setActiveView] = useState('menu');

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const backAction = () => {
      if (activeView !== 'menu') {
        setActiveView('menu');
        return true;
      }
      return false;
    };

    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      backAction,
    );

    return () => backHandler.remove();
  }, [activeView]);

  if (activeView === 'help') {
    return <HelpScreen onBack={() => setActiveView('menu')} />;
  }

  if (activeView === 'about') {
    return <AboutScreen onBack={() => setActiveView('menu')} />;
  }

  if (activeView === 'backup') {
    return (
      <BackupScreen
        onBack={() => setActiveView('menu')}
        onExport={onExport}
        onImport={onImport}
      />
    );
  }

  if (activeView === 'settings') {
    return (
      <SettingsScreen
        onBack={() => setActiveView('menu')}
        multiplier={fatigueMultiplier}
        onUpdate={onUpdateFatigueMultiplier}
        weightDateEditEnabled={weightDateEditEnabled}
        onUpdateWeightDateEditEnabled={onUpdateWeightDateEditEnabled}
        deloadDateEditEnabled={deloadDateEditEnabled}
        onUpdateDeloadDateEditEnabled={onUpdateDeloadDateEditEnabled}
      />
    );
  }

  if (activeView === 'profile') {
    return <ProfileScreen onBack={() => setActiveView('menu')} />;
  }

  if (activeView === 'account') {
    return <AccountScreen onBack={() => setActiveView('menu')} />;
  }

  return (
    <ScreenShell title="More" subtitle="Settings, help, and your data.">
      <View style={styles.list}>
        <Pressable style={styles.menuItem} onPress={() => setActiveView('help')} accessibilityRole="button" accessibilityLabel="App Guide">
          <Text style={styles.menuItemText}>App Guide</Text>
          <Text style={styles.menuItemChevron} accessible={false}>→</Text>
        </Pressable>
        <Pressable style={styles.menuItem} onPress={() => setActiveView('profile')} accessibilityRole="button" accessibilityLabel="User Profile">
          <Text style={styles.menuItemText}>User Profile</Text>
          <Text style={styles.menuItemChevron} accessible={false}>→</Text>
        </Pressable>
        <Pressable style={styles.menuItem} onPress={() => setActiveView('account')} accessibilityRole="button" accessibilityLabel="Account">
          <Text style={styles.menuItemText}>Account</Text>
          <Text style={styles.menuItemChevron} accessible={false}>→</Text>
        </Pressable>
        <Pressable style={styles.menuItem} onPress={() => setActiveView('settings')} accessibilityRole="button" accessibilityLabel="Settings and Algorithm">
          <Text style={styles.menuItemText}>Settings & Algorithm</Text>
          <Text style={styles.menuItemChevron} accessible={false}>→</Text>
        </Pressable>
        <Pressable style={styles.menuItem} onPress={() => setActiveView('backup')} accessibilityRole="button" accessibilityLabel="Data and Backup">
          <Text style={styles.menuItemText}>Data & Backup</Text>
          <Text style={styles.menuItemChevron} accessible={false}>→</Text>
        </Pressable>
        <Pressable style={styles.menuItem} onPress={() => setActiveView('about')} accessibilityRole="button" accessibilityLabel="About Kilo">
          <Text style={styles.menuItemText}>About Kilo</Text>
          <Text style={styles.menuItemChevron} accessible={false}>→</Text>
        </Pressable>
      </View>

      <SectionTitle>Quick Actions</SectionTitle>
      <View style={styles.grid}>
        <Button title="Log Workout" onPress={() => onNavigate('Log')} style={{ flex: 1 }} />
        <Button title="Log Weight" onPress={() => onNavigate('Weight')} style={{ flex: 1 }} />
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    gap: 12,
  },
  list: {
    gap: 12,
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.card,
    padding: 20,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  menuItemText: {
    fontSize: 17,
    fontWeight: '600',
    color: Colors.text,
  },
  menuItemChevron: {
    fontSize: 18,
    color: Colors.textMuted,
    fontWeight: '700',
  },
  accountBlock: {
    gap: 12,
  },
  accountNote: {
    fontSize: 15,
    color: Colors.text,
    lineHeight: 22,
    marginBottom: 12,
  },
  accountStatus: {
    fontSize: 14,
    color: Colors.textMuted,
    marginTop: 16,
  },
  syncRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  syncLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  syncValue: {
    fontSize: 14,
    color: Colors.textMuted,
    flexShrink: 1,
    textAlign: 'right',
    marginLeft: 12,
  },
});

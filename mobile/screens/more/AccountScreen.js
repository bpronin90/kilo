import React, { useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { ScreenShell } from '../../components/ScreenShell';
import { Button, InputStyle, SectionTitle } from '../../components/UI';
import { Colors } from '../../theme/colors';
import { CloudSyncRecovery } from './CloudSyncRecovery';
import { AccountLifecycle } from './AccountLifecycle';
import { LegalLinks } from './LegalLinks';

const KILO_AUTH_REDIRECT = 'kilo://auth/callback';

// Minimal account surface to exercise sign in / sign out / session restore /
// password reset against the auth/session hook. This is intentionally narrow:
// it does not gate any local-only app behavior. When cloud accounts are not
// configured in the build, it explains that local data still works without an
// account.
// `auth` is the app-shell useAuthSession() instance threaded down from App.js
// via MoreScreen. Consuming the shared instance (instead of calling the hook
// here) means the session is already resolved when this screen mounts, so the
// Signed-In view renders immediately with no per-mount re-probe (#366).
export function AccountScreen({ onBack, auth }) {
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

  const handleGitHubSignIn = async () => {
    if (Platform.OS !== 'web') return;
    setBusy(true);
    setStatus('');
    try {
      const redirectTo = typeof window !== 'undefined' ? window.location.origin : undefined;
      const result = await auth.signInWithOAuth('github', redirectTo ? { redirectTo } : undefined);
      if (result.ok && result.url) {
        window.location.href = result.url;
      } else if (!result.ok) {
        setStatus(result.error || 'GitHub sign in failed.');
      }
    } catch (e) {
      setStatus(e.message || 'GitHub sign in failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleGitHubSignInNative = async () => {
    setBusy(true);
    setStatus('');
    try {
      const oauthResult = await auth.signInWithOAuth('github', {
        redirectTo: KILO_AUTH_REDIRECT,
        skipBrowserRedirect: true,
      });
      if (!oauthResult.ok) {
        setStatus(oauthResult.error || 'GitHub sign in failed.');
        return;
      }
      if (!oauthResult.url) {
        setStatus('Could not get GitHub sign in URL.');
        return;
      }
      const browserResult = await WebBrowser.openAuthSessionAsync(oauthResult.url, KILO_AUTH_REDIRECT);
      if (browserResult.type === 'cancel' || browserResult.type === 'dismiss') {
        setStatus('Sign in cancelled.');
        return;
      }
      if (browserResult.type !== 'success' || !browserResult.url) {
        setStatus('GitHub sign in failed.');
        return;
      }
      const exchangeResult = await auth.handleAuthCallbackUrl(browserResult.url);
      if (exchangeResult.ok) {
        setStatus('Signed in.');
      } else {
        setStatus(exchangeResult.error || 'GitHub sign in failed.');
      }
    } catch (e) {
      setStatus(e.message || 'GitHub sign in failed.');
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
        <View style={styles.accountBlock}>
          <SectionTitle>Cloud Account</SectionTitle>
          <Text style={styles.accountNote} accessibilityLabel="Cloud accounts unavailable">
            Cloud accounts are not configured in this build. The app continues to
            work fully offline with your local data.
          </Text>
          <LegalLinks />
        </View>
      ) : auth.signedIn ? (
        <View style={styles.accountBlock}>
          <SectionTitle>Signed In</SectionTitle>
          <Text style={styles.accountNote}>
            Signed in as {auth.user?.email || 'your account'}. Your training
            history is the offline working copy on this device. An account keeps a
            cloud copy in sync with it so you can continue on another device. Use
            Cloud Sync below to keep this device and your account matched.
          </Text>
          <Button
            title="Sign Out"
            loadingTitle="Working…"
            disabled={busy}
            onPress={() => run(() => auth.signOut().then((r) => (r.ok ? { ok: true, message: 'Signed out.' } : r)))}
          />
          <CloudSyncRecovery user={auth.user} />
          <AccountLifecycle auth={auth} />
        </View>
      ) : auth.loading ? (
        // Configured but the initial session-restore probe is still in flight.
        // Suppress the Sign In form during this window so a restored/persisted
        // session does not flash the signed-out view before it resolves
        // (mirrors the #307 Home first-paint gate). When unconfigured, loading
        // is already false, so the local-only message above is unaffected.
        <View style={styles.accountBlock} accessibilityLabel="Account loading" />
      ) : (
        <View style={styles.accountBlock}>
          <SectionTitle>Sign In</SectionTitle>
          <Text style={styles.accountNote}>
            Your training history is saved on this device and works without an
            account. Signing in lets you keep it synced to the cloud and continue
            on another device. Signing in by itself does not change or erase your
            local data.
          </Text>
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
            title="Sign In"
            loadingTitle="Working…"
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
          {(Platform.OS === 'web' || Platform.OS === 'android') && (
            <Button
              title="Continue with GitHub"
              loadingTitle="Working…"
              disabled={busy}
              onPress={Platform.OS === 'web' ? handleGitHubSignIn : handleGitHubSignInNative}
              accessibilityLabel="Continue with GitHub"
            />
          )}
          <LegalLinks />
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

const styles = StyleSheet.create({
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
});

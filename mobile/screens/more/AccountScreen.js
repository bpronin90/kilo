import React, { useCallback, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { CaptchaChallenge } from '../../components/CaptchaChallenge';
import { ScreenShell } from '../../components/ScreenShell';
import { Button, SectionTitle, useInputStyle } from '../../components/UI';
import { Alert } from '../../lib/platformAlert';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';
import { KILO_AUTH_REDIRECT } from '../../hooks/useAuthSession';
import { CloudSyncRecovery } from './CloudSyncRecovery';
import { AccountLifecycle } from './AccountLifecycle';
import { LegalLinks } from './LegalLinks';
import { SetNewPasswordScreen } from './SetNewPasswordScreen';

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
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const inputStyle = useInputStyle();
  const scrollRef = useRef(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [captchaFailed, setCaptchaFailed] = useState(false);
  // Persistent post-signup / unconfirmed-sign-in state (#799): set to a
  // non-empty email address whenever the account needs confirmation before
  // it can be used. '' means this surface is not shown. `confirmationContext`
  // distinguishes the two entry points only for copy ('signup' says an email
  // was just sent; 'signin' says the account is awaiting confirmation).
  const [confirmationEmail, setConfirmationEmail] = useState('');
  const [confirmationContext, setConfirmationContext] = useState('signup');

  const run = async (fn) => {
    setBusy(true);
    setStatus('');
    try {
      const result = await fn();
      if (result?.ok) {
        // A caller passing an explicit empty message (the confirmation-pending
        // transitions below) suppresses the status line entirely, since the
        // dedicated confirmation panel already carries the message.
        setStatus(result.message != null ? result.message : 'Done.');
      } else {
        setStatus(result?.error || 'Something went wrong.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleCaptchaToken = useCallback((token) => {
    setCaptchaToken(token);
    setCaptchaFailed(false);
  }, []);

  const handleCaptchaExpired = useCallback(() => {
    setCaptchaToken('');
    setCaptchaFailed(false);
    setCaptchaResetKey((value) => value + 1);
    setStatus('Security verification expired. Complete the new challenge and try again.');
  }, []);

  const handleCaptchaError = useCallback(() => {
    setCaptchaToken('');
    setCaptchaFailed(true);
    setStatus('Security verification failed to load. Check your connection and try again.');
  }, []);

  const retryCaptcha = useCallback(() => {
    setCaptchaToken('');
    setCaptchaFailed(false);
    setStatus('');
    setCaptchaResetKey((value) => value + 1);
  }, []);

  // A provider token is single-use. Reset immediately after every attempted
  // Supabase password-auth call, whether the request succeeds or fails.
  const runPasswordFlow = (fn) => run(async () => {
    const token = captchaToken || null;
    try {
      return await fn(token);
    } finally {
      if (token) {
        setCaptchaToken('');
        setCaptchaResetKey((value) => value + 1);
      }
    }
  });

  const handleSignOutAndWipe = () => {
    Alert.alert(
      'Sign Out and Wipe Device Data',
      'This signs out and permanently removes the training and health history stored on this device. The cloud copy is kept. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out & Wipe',
          style: 'destructive',
          onPress: () => run(() => auth.signOut({ wipeLocalData: true }).then((result) => (
            result.ok ? { ok: true, message: 'Signed out and device data wiped.' } : result
          ))),
        },
      ],
    );
  };

  const handleDeviceWipe = () => {
    Alert.alert(
      'Wipe Device Data',
      'This permanently removes the training and health history stored on this device. It does not require a cloud account and cannot be undone. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Wipe Device Data',
          style: 'destructive',
          onPress: () => run(() => auth.wipeDeviceData().then((result) => (
            result.ok ? { ok: true, message: 'Device data wiped.' } : result
          ))),
        },
      ],
    );
  };

  const handleResendConfirmation = () => runPasswordFlow(async (token) => {
    const result = await auth.resendSignupConfirmation(confirmationEmail, token);
    return result.ok
      ? { ok: true, message: `Confirmation email sent to ${confirmationEmail}. Check your inbox and spam folder.` }
      : result;
  });

  const handleBackToSignIn = () => {
    setConfirmationEmail('');
    setConfirmationContext('signup');
    setStatus('');
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

  // Explicit redirectTo (#497): without one, the reset link falls back to the
  // project's default Site URL and the app never sees the callback. Mirrors
  // the redirectTo split already used for GitHub sign-in above — web targets
  // its own origin (handled by App.js's web callback effect), native targets
  // the kilo:// deep link (handled by useAuthSession's native listener).
  const handleResetPassword = () => runPasswordFlow(async (token) => {
    const redirectTo = Platform.OS === 'web'
      ? (typeof window !== 'undefined' ? window.location.origin : undefined)
      : KILO_AUTH_REDIRECT;
    const result = await auth.resetPasswordForEmail(email, {
      ...(redirectTo ? { redirectTo } : {}),
      ...(token ? { captchaToken: token } : {}),
    });
    return result.ok ? { ok: true, message: 'Password reset email sent if the address exists.' } : result;
  });

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

  // Recovery link handling (#497): once useAuthSession's native deep-link
  // listener (or, on web, App.js's callback effect) has processed a
  // password-reset link, show the set-new-password surface instead of the
  // normal Sign In / Signed In views — both for a successfully established
  // recovery session (auth.passwordRecovery) and for a link that failed to
  // establish one (auth.recoveryError: expired or already-used).
  if (auth.configured && (auth.passwordRecovery || auth.recoveryError)) {
    return <SetNewPasswordScreen auth={auth} onDone={() => {}} />;
  }

  return (
    <ScreenShell
      ref={scrollRef}
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
          <Button
            title="Wipe Device Data"
            disabled={busy}
            onPress={handleDeviceWipe}
            accessibilityLabel="Wipe device data without an account"
          />
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
          <Button
            title="Sign Out & Wipe Device Data"
            disabled={busy}
            onPress={handleSignOutAndWipe}
            accessibilityLabel="Sign out and wipe device data"
          />
          <CloudSyncRecovery
            user={auth.user}
            onConsentDismiss={() => scrollRef.current?.scrollTo({ y: 0, animated: true })}
          />
          <AccountLifecycle auth={auth} />
        </View>
      ) : auth.loading ? (
        // Configured but the initial session-restore probe is still in flight.
        // Suppress the Sign In form during this window so a restored/persisted
        // session does not flash the signed-out view before it resolves
        // (mirrors the #307 Home first-paint gate). When unconfigured, loading
        // is already false, so the local-only message above is unaffected.
        <View style={styles.accountBlock} accessibilityLabel="Account loading" />
      ) : confirmationEmail ? (
        <View style={styles.accountBlock}>
          <SectionTitle>Confirm Your Email</SectionTitle>
          <Text style={styles.accountNote} accessibilityLabel="Confirmation pending">
            {confirmationContext === 'signup'
              ? `We sent a confirmation email to ${confirmationEmail}. Check your inbox — and your spam folder — to finish creating your account.`
              : `${confirmationEmail} is awaiting confirmation. Check your inbox and spam folder for the confirmation email, or resend it below.`}
          </Text>
          <CaptchaChallenge
            resetKey={captchaResetKey}
            onToken={handleCaptchaToken}
            onExpired={handleCaptchaExpired}
            onError={handleCaptchaError}
          />
          {captchaFailed ? (
            <Button
              title="Retry Security Verification"
              disabled={busy}
              onPress={retryCaptcha}
              accessibilityLabel="Retry security verification"
            />
          ) : null}
          <Button
            title="Resend Confirmation Email"
            loadingTitle="Working…"
            disabled={busy}
            onPress={handleResendConfirmation}
            accessibilityLabel="Resend confirmation email"
          />
          <Button
            title="Back to Sign In"
            disabled={busy}
            onPress={handleBackToSignIn}
            accessibilityLabel="Back to Sign In"
          />
        </View>
      ) : (
        <View style={styles.accountBlock}>
          <SectionTitle>Sign In</SectionTitle>
          <Text style={styles.accountNote}>
            Your training history is saved on this device and works without an
            account. Signing in lets you keep it synced to the cloud and continue
            on another device. Signing in by itself does not change or erase your
            local data.
          </Text>
          {auth.deviceWipeRequired ? (
            <Text style={styles.accountError} accessibilityLabel="Device wipe required">
              Your account session ended, but device data could not be wiped. Retry before sharing this device.
            </Text>
          ) : null}
          <Button
            title={auth.deviceWipeRequired ? 'Retry Device Data Wipe' : 'Wipe Device Data'}
            disabled={busy}
            onPress={handleDeviceWipe}
            accessibilityLabel="Wipe device data while signed out"
          />
          <TextInput
            style={inputStyle}
            placeholder="Email"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            accessibilityLabel="Email"
          />
          <TextInput
            style={inputStyle}
            placeholder="Password"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            accessibilityLabel="Password"
          />
          <CaptchaChallenge
            resetKey={captchaResetKey}
            onToken={handleCaptchaToken}
            onExpired={handleCaptchaExpired}
            onError={handleCaptchaError}
          />
          {captchaFailed ? (
            <Button
              title="Retry Security Verification"
              disabled={busy}
              onPress={retryCaptcha}
              accessibilityLabel="Retry security verification"
            />
          ) : null}
          <Button
            title="Sign In"
            loadingTitle="Working…"
            disabled={busy}
            // On any failed password sign-in, append the GitHub hint
            // unconditionally (#496). It is shown for every failure and does not
            // branch on whether the address exists, so it adds no enumeration
            // oracle: a GitHub-only account and a wrong password produce the same
            // generic `Invalid login credentials`, and both now point at the
            // other sign-in method. An unconfirmed account is the one failure
            // that gets its own surface instead (#799): it names a real,
            // just-typed address and offers to resend the confirmation email
            // rather than a dead-end credentials error.
            onPress={() => runPasswordFlow((token) => auth.signInWithPassword(email, password, token).then((r) => {
              if (r.ok) return { ok: true, message: 'Signed in.' };
              if (r.unconfirmed) {
                setConfirmationEmail(email);
                setConfirmationContext('signin');
                return { ok: true, message: '' };
              }
              return { ...r, ok: false, error: `${r.error || 'Invalid login credentials.'} If you signed up with GitHub, use Continue with GitHub.` };
            }))}
          />
          <Button
            title="Create Account"
            disabled={busy}
            // Honest, enumeration-safe signup copy (#496) is preserved: Supabase
            // returns the same 200 whether the address is new or already
            // registered, and this handler behaves identically either way — it
            // always shows the confirmation-pending panel for the typed address
            // rather than branching on existence. A signup that returns an
            // immediate session (confirmation disabled) still just signs in.
            onPress={() => runPasswordFlow((token) => auth.signUpWithPassword(email, password, token).then((r) => {
              if (!r.ok) return r;
              if (!r.session) {
                setConfirmationEmail(email);
                setConfirmationContext('signup');
                return { ok: true, message: '' };
              }
              return { ok: true, message: 'Signed in.' };
            }))}
          />
          <Button
            title="Reset Password"
            disabled={busy}
            onPress={handleResetPassword}
            accessibilityLabel="Reset Password"
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

const createStyles = (colors) => StyleSheet.create({
  accountBlock: {
    gap: 12,
  },
  accountNote: {
    fontSize: 15,
    color: colors.text,
    lineHeight: 22,
    marginBottom: 12,
  },
  accountError: {
    fontSize: 14,
    color: colors.error,
    lineHeight: 20,
  },
  accountStatus: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 16,
  },
});

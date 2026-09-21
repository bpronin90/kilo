import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { CaptchaChallenge } from '../../components/CaptchaChallenge';
import { ScreenShell } from '../../components/ScreenShell';
import { Button, SectionTitle, useInputStyle } from '../../components/UI';
import { Alert } from '../../lib/platformAlert';
import { useTheme } from '../../theme/ThemeContext';
import { useKuaTypography } from '../../theme/typography';
import { GEOMETRY } from '../../theme/spacing';
import { KILO_AUTH_REDIRECT } from '../../hooks/useAuthSession';
import { AccountLifecycle } from './AccountLifecycle';
import { LegalLinks } from './LegalLinks';
import { SetNewPasswordScreen } from './SetNewPasswordScreen';

// KUA has no tinted error-surface role (unlike the legacy palette's
// `errorSurface`) — only a solid `error` fill and an `errorText` ink. Derive
// a low-alpha red-family tint from `error` for the Danger Zone container so
// it keeps reading as danger-coded on its own background rather than falling
// back to a neutral surface (#1114 review). Same technique and 12% figure as
// LogRecoveryWeeks.js's `withAlpha(colors.success, 0.12)`.
function withAlpha(hex, alpha) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

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
  const { colors, kuaPalette: kua } = useTheme();
  const typography = useKuaTypography();
  const styles = useMemo(() => createStyles(colors, kua, typography), [colors, kua, typography]);
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
  // Presentation-only focus tracking for the KUA input focus-border contract
  // (2px `primary` border on focus, #1114 review). Purely local UI state —
  // it does not gate or alter any auth behavior.
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

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
    return <SetNewPasswordScreen auth={auth} onDone={() => {}} onBack={onBack} />;
  }

  return (
    <ScreenShell
      ref={scrollRef}
      title="Account"
      subtitle="Cloud sign in is optional. Your data works locally without an account."
      onBack={onBack}
      style={kua ? { backgroundColor: kua.background } : undefined}
    >
      {!auth.configured ? (
        <View style={styles.accountBlock}>
          {kua ? <Text style={styles.sectionHeader}>CLOUD ACCOUNT</Text> : <SectionTitle>Cloud Account</SectionTitle>}
          <Text style={styles.accountNote} accessibilityLabel="Cloud accounts unavailable">
            Cloud accounts are not configured in this build. The app continues to
            work fully offline with your local data.
          </Text>
          <LegalLinks />
        </View>
      ) : auth.signedIn ? (
        <View style={styles.accountBlock}>
          {kua ? <Text style={styles.sectionHeader}>SIGNED IN</Text> : <SectionTitle>Signed In</SectionTitle>}
          <Text style={styles.accountNote}>
            Signed in as {auth.user?.email || 'your account'}. Your training
            history is the offline working copy on this device. An account keeps a
            cloud copy in sync with it so you can continue on another device.
          </Text>
          <Button
            title="Sign Out"
            loadingTitle="Working…"
            disabled={busy}
            style={styles.actionButton}
            textStyle={styles.actionButtonText}
            onPress={() => run(() => auth.signOut().then((r) => (r.ok ? { ok: true, message: 'Signed out.' } : r)))}
          />
          <View style={styles.dangerZone}>
            <View style={styles.dangerZoneHeading}>
              <Text style={styles.dangerZoneHeadingText}>⚠ Danger Zone</Text>
            </View>
            <AccountLifecycle auth={auth} />
          </View>
          <LegalLinks />
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
          {kua ? <Text style={styles.sectionHeader}>CONFIRM YOUR EMAIL</Text> : <SectionTitle>Confirm Your Email</SectionTitle>}
          <Text style={styles.accountNote} accessibilityLabel="Confirmation pending">
            {confirmationContext === 'signup'
              // Enumeration-safe (#496): Supabase returns this same no-session
              // response whether the address is new or already registered, and
              // sends no email in the already-registered case, so the copy must
              // stay conditional rather than asserting delivery. The GitHub hint
              // covers the already-registered-via-GitHub case, same as before.
              ? `If ${confirmationEmail} is new, we've sent a confirmation email to it — check your inbox and spam folder to finish creating your account. If you already signed up with GitHub, use Continue with GitHub instead.`
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
              style={styles.actionButton}
              textStyle={styles.actionButtonText}
              onPress={retryCaptcha}
              accessibilityLabel="Retry security verification"
            />
          ) : null}
          <Button
            title="Resend Confirmation Email"
            loadingTitle="Working…"
            disabled={busy}
            style={styles.actionButton}
            textStyle={styles.actionButtonText}
            onPress={handleResendConfirmation}
            accessibilityLabel="Resend confirmation email"
          />
          <Button
            title="Back to Sign In"
            disabled={busy}
            style={styles.actionButton}
            textStyle={styles.actionButtonText}
            onPress={handleBackToSignIn}
            accessibilityLabel="Back to Sign In"
          />
        </View>
      ) : (
        <View style={styles.accountBlock}>
          {kua ? <Text style={styles.sectionHeader}>SIGN IN</Text> : <SectionTitle>Sign In</SectionTitle>}
          <Text style={styles.accountNote}>
            Your training history is saved on this device and works without an
            account. Signing in lets you keep it synced to the cloud and continue
            on another device. Signing in by itself does not change or erase your
            local data.
          </Text>
          <TextInput
            keyboardAppearance={colors.scheme}
            style={[inputStyle, styles.kuaInput, kua && emailFocused ? styles.kuaInputFocused : null]}
            placeholder="Email"
            placeholderTextColor={kua ? kua.onSurfaceVariant : colors.textMuted}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            onFocus={() => setEmailFocused(true)}
            onBlur={() => setEmailFocused(false)}
            accessibilityLabel="Email"
          />
          <TextInput
            keyboardAppearance={colors.scheme}
            style={[inputStyle, styles.kuaInput, kua && passwordFocused ? styles.kuaInputFocused : null]}
            placeholder="Password"
            placeholderTextColor={kua ? kua.onSurfaceVariant : colors.textMuted}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            onFocus={() => setPasswordFocused(true)}
            onBlur={() => setPasswordFocused(false)}
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
              style={styles.actionButton}
              textStyle={styles.actionButtonText}
              onPress={retryCaptcha}
              accessibilityLabel="Retry security verification"
            />
          ) : null}
          <Button
            title="Sign In"
            loadingTitle="Working…"
            disabled={busy}
            style={styles.actionButton}
            textStyle={styles.actionButtonText}
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
            style={styles.actionButton}
            textStyle={styles.actionButtonText}
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
            style={styles.actionButton}
            textStyle={styles.actionButtonText}
            onPress={handleResetPassword}
            accessibilityLabel="Reset Password"
          />
          {(Platform.OS === 'web' || Platform.OS === 'android') && (
            <Button
              title="Continue with GitHub"
              loadingTitle="Working…"
              disabled={busy}
              style={styles.actionButton}
              textStyle={styles.actionButtonText}
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

const createStyles = (colors, kua = null, typography = {}) => StyleSheet.create({
  accountBlock: {
    gap: 12,
  },
  // KUA section headers replace SectionTitle in kua mode (#1114), matching
  // the label-sm/uppercase treatment already used by Settings and More.
  sectionHeader: {
    ...(typography['label-sm'] ?? { fontSize: 11, fontWeight: '500' }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    textTransform: 'uppercase',
    marginTop: 6,
  },
  accountNote: {
    fontSize: 15,
    color: kua ? kua.onSurface : colors.text,
    lineHeight: 22,
    marginBottom: 12,
  },
  accountStatus: {
    fontSize: 14,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    marginTop: 16,
  },
  // Overrides applied to every auth-flow Button's style/textStyle props
  // (Sign In, Sign Out, Create Account, Reset Password, GitHub, CAPTCHA
  // retry, confirmation resend/back). `null` in legacy mode leaves the
  // shared Button component's own default styling untouched.
  //
  // Matches the KUA Primary action button contract
  // (docs/design/kinetic-utilitarian-athletic/components.md): `primary` fill,
  // `radius-sm` (4px) — overriding the shared Button's legacy 18px pill — and
  // a 44dp minimum height (the shared Button's own padding already clears
  // this, but it's asserted explicitly since the KUA contract calls it out).
  // The shared Button component has no pressed-style callback to override at
  // the call site, so the contract's "darken 10% / scale 0.97 on press" is
  // NOT applied here — see PR notes; out of scope without editing Button.
  actionButton: kua ? {
    backgroundColor: kua.primary,
    borderRadius: GEOMETRY['radius-sm'],
    minHeight: 44,
  } : null,
  // `on-primary`, `label-md` (JetBrains Mono, uppercase) per the same
  // contract. `typography['label-md']` already carries the font family,
  // size, line height, and tracked letter-spacing; textTransform is added
  // here since no typography token encodes case.
  actionButtonText: kua ? {
    color: kua.onPrimary,
    ...(typography['label-md'] ?? { fontSize: 12, fontWeight: '600' }),
    textTransform: 'uppercase',
  } : null,
  // Composed onto the shared `useInputStyle()` result at the TextInput call
  // site (#1114) rather than editing the shared hook, which Allowed Files
  // excludes. Matches the KUA Inputs contract: 44dp height, `radius-sm`
  // (4px), `surface-card` background, 1px `surface-border`, `on-surface`
  // text in `body-md` (Space Grotesk — these are plain text fields, not
  // numeric/metric, so JetBrains Mono does not apply).
  kuaInput: kua ? {
    height: 44,
    borderRadius: GEOMETRY['radius-sm'],
    backgroundColor: kua.surfaceCard,
    borderColor: kua.surfaceBorder,
    color: kua.onSurface,
    ...(typography['body-md'] ?? { fontSize: 14, lineHeight: 20 }),
  } : null,
  // Focus state per the same contract: border becomes 2px `primary`, no glow
  // spread. Applied conditionally via local onFocus/onBlur state tracked in
  // the component (not in the shared hook).
  kuaInputFocused: kua ? {
    borderWidth: 2,
    borderColor: kua.primary,
  } : null,
  // Irreversible-action container: error-tinted surface groups Delete Account
  // apart from the routine Sign Out above it. See ui-design-rules.md #14. The
  // KUA branch derives its tint from `error` (see withAlpha above) so the
  // container reads as danger-coded on its own fill, not just via its border.
  dangerZone: {
    backgroundColor: kua ? withAlpha(kua.error, 0.12) : colors.errorSurface,
    borderWidth: 1,
    borderColor: kua ? kua.error : colors.error,
    borderRadius: 24,
    padding: 18,
    gap: 12,
  },
  dangerZoneHeading: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dangerZoneHeadingText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: kua ? kua.errorText : colors.error,
  },
});

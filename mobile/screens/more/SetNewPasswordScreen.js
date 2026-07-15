import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { ScreenShell } from '../../components/ScreenShell';
import { Button, InputStyle, SectionTitle } from '../../components/UI';
import { Colors } from '../../theme/colors';

// Set-new-password surface (#497). AccountScreen renders this in place of its
// normal Sign In / Signed In views whenever the shared `auth` instance
// reports an active password-recovery session (auth.passwordRecovery) or a
// recovery-link callback that failed to establish one (auth.recoveryError —
// expired or already-used link). See useAuthSession.js for how both states
// are populated: the PASSWORD_RECOVERY auth-state event and the native
// cold/warm-start deep-link listener.
//
// docs/ui-design-rules.md #1 (top-of-tab content alignment): every screen
// renders inside ScreenShell, which owns the 16px horizontal padding, 16px
// inter-child gap, and single 34/700 title — this screen does not hand-roll
// its own outer padding or title size.
// docs/ui-design-rules.md #2 (title-to-panel spacing): the form is one
// logical block (title, note, inputs, button, status), so it is wrapped in a
// single ScreenShell child with its own `gap: 12`, matching AccountScreen's
// `accountBlock` convention, rather than adding ad-hoc margins between
// elements.
export function SetNewPasswordScreen({ auth, onDone }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState(auth.recoveryError || '');
  const [busy, setBusy] = useState(false);

  // A recovery callback that resolves after this screen has already mounted
  // (e.g. the app was cold-started straight into this view) still needs to
  // surface its error here.
  useEffect(() => {
    if (auth.recoveryError) setStatus(auth.recoveryError);
  }, [auth.recoveryError]);

  const hasSession = Boolean(auth.passwordRecovery);

  const handleSubmit = async () => {
    if (busy) return;
    if (!password || password.length < 6) {
      setStatus('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setStatus('Passwords do not match.');
      return;
    }
    setBusy(true);
    setStatus('');
    try {
      const result = await auth.updatePassword(password);
      if (result.ok) {
        setStatus('Password updated. You are signed in with your new password.');
      } else {
        setStatus(result.error || 'Could not update password.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleBackToSignIn = () => {
    auth.clearPasswordRecovery();
    onDone?.();
  };

  return (
    <ScreenShell
      title="Set New Password"
      subtitle="Choose a new password to finish resetting your account."
    >
      <View style={styles.block}>
        <SectionTitle>New Password</SectionTitle>
        {hasSession ? (
          <Text style={styles.note}>
            This reset link signed you in for password recovery only. Set a
            new password below, then use it next time you sign in.
          </Text>
        ) : (
          <Text style={styles.note}>
            This reset link could not be used to sign you in. It may have
            expired or already been used. Request a new reset email and try
            again.
          </Text>
        )}
        {hasSession ? (
          <>
            <TextInput
              style={InputStyle}
              placeholder="New password"
              placeholderTextColor={Colors.textMuted}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              accessibilityLabel="New Password"
            />
            <TextInput
              style={InputStyle}
              placeholder="Confirm new password"
              placeholderTextColor={Colors.textMuted}
              secureTextEntry
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              accessibilityLabel="Confirm New Password"
            />
            <Button
              title="Set New Password"
              loadingTitle="Working…"
              disabled={busy}
              onPress={handleSubmit}
              accessibilityLabel="Set New Password"
            />
          </>
        ) : (
          <Button
            title="Back to Sign In"
            disabled={busy}
            onPress={handleBackToSignIn}
            accessibilityLabel="Back to Sign In"
          />
        )}
        {status ? (
          <Text style={styles.status} accessibilityLabel="Set password status">
            {status}
          </Text>
        ) : null}
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: 12,
  },
  note: {
    fontSize: 15,
    color: Colors.text,
    lineHeight: 22,
    marginBottom: 12,
  },
  status: {
    fontSize: 14,
    color: Colors.textMuted,
    marginTop: 16,
  },
});

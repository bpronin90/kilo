import React, { useState } from 'react';
import { Alert, Share, StyleSheet, Text, View } from 'react-native';
import { Button, SectionTitle } from '../../components/UI';
import { Colors } from '../../theme/colors';
import { LegalLinks } from './LegalLinks';

// Server-side export and account deletion panel (Phase 5 / Task 13).
//
// Both actions call Edge Functions with the user's JWT. The Edge Functions hold
// the service-role key server-side; no privileged credential is exposed here.
// Deletion uses a two-step confirmation: the user must tap once to arm, then
// confirm, reducing accidental destructive actions.
export function AccountLifecycle({ auth }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [deleteArmed, setDeleteArmed] = useState(false);

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

  const handleServerExport = async () => {
    setBusy(true);
    setStatus('');
    try {
      const result = await auth.serverExport();
      if (!result.ok) {
        setStatus(result.error || 'Export failed.');
        return;
      }
      await Share.share({ message: result.json });
      setStatus('Account data exported.');
    } catch {
      setStatus('Export failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteArm = () => {
    setDeleteArmed(true);
    setStatus('Tap "Confirm Delete Account" to permanently delete your cloud account and sign out. The training history on this device is kept.');
  };

  const handleDeleteConfirm = () => {
    Alert.alert(
      'Delete Account',
      'This permanently deletes your cloud account and the cloud copy stored in it, and cannot be undone. The training history on this device is kept. Continue?',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => { setDeleteArmed(false); setStatus(''); } },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => run(async () => {
            const result = await auth.deleteAccount();
            if (result.ok) return { ok: true, message: 'Account deleted.' };
            setDeleteArmed(false);
            return result;
          }),
        },
      ],
    );
  };

  return (
    <View style={styles.accountBlock}>
      <SectionTitle>Account Data</SectionTitle>

      <Text style={styles.accountNote}>
        Export Account Data fetches what the server currently holds for your
        account — not what is on this device. It may differ from your local
        data if you have not recently synced. Deleting your account removes the
        cloud copy only; the training history on this device is always kept.
      </Text>

      <Button
        title="Export Account Data"
        loadingTitle="Working…"
        disabled={busy}
        onPress={handleServerExport}
        accessibilityLabel="Export account data"
      />

      {!deleteArmed ? (
        <Button
          title="Delete Account"
          disabled={busy}
          onPress={handleDeleteArm}
          accessibilityLabel="Delete account"
        />
      ) : (
        <Button
          title="Confirm Delete Account"
          loadingTitle="Working…"
          disabled={busy}
          onPress={handleDeleteConfirm}
          accessibilityLabel="Confirm delete account"
        />
      )}

      {status ? (
        <Text style={styles.accountStatus} accessibilityLabel="Account lifecycle status">
          {status}
        </Text>
      ) : null}
      <LegalLinks />
    </View>
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
  },
  accountStatus: {
    fontSize: 14,
    color: Colors.textMuted,
    marginTop: 16,
  },
});

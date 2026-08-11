import React, { useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import { Alert } from '../../lib/platformAlert';
import { Button, SectionTitle } from '../../components/UI';
import { useThemedStyles } from '../../theme/ThemeContext';
import { LegalLinks } from './LegalLinks';

// Server-side export and account deletion panel (Phase 5 / Task 13).
//
// Both actions call Edge Functions with the user's JWT. The Edge Functions hold
// the service-role key server-side; no privileged credential is exposed here.
// Deletion uses a two-step confirmation: the user must tap once to arm, then
// confirm, reducing accidental destructive actions.
export function AccountLifecycle({ auth }) {
  const styles = useThemedStyles(createStyles);
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
    setStatus('Choose whether to keep or permanently wipe the training history on this device when deleting the cloud account.');
  };

  const handleDeleteConfirm = (wipeLocalData = false) => {
    Alert.alert(
      'Delete Account',
      wipeLocalData
        ? 'This permanently deletes your cloud account, its cloud copy, and the training and health history on this device. This cannot be undone. Continue?'
        : 'This permanently deletes your cloud account and the cloud copy stored in it, and cannot be undone. The training history on this device is kept. Continue?',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => { setDeleteArmed(false); setStatus(''); } },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => run(async () => {
            const result = await auth.deleteAccount(wipeLocalData ? { wipeLocalData: true } : undefined);
            if (result.ok) {
              return {
                ok: true,
                message: wipeLocalData ? 'Account deleted and device data wiped.' : 'Account deleted.',
              };
            }
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
        cloud copy. By default, the training history on this device is kept;
        the confirmed wipe option below removes it too.
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
        <>
          <Button
            title="Confirm Delete Account — Keep Device Data"
            loadingTitle="Working…"
            disabled={busy}
            onPress={() => handleDeleteConfirm(false)}
            accessibilityLabel="Confirm delete account and keep device data"
          />
          <Button
            title="Confirm Delete & Wipe Device Data"
            loadingTitle="Working…"
            disabled={busy}
            onPress={() => handleDeleteConfirm(true)}
            accessibilityLabel="Confirm delete account and wipe device data"
          />
        </>
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

const createStyles = (colors) => StyleSheet.create({
  accountBlock: {
    gap: 12,
  },
  accountNote: {
    fontSize: 15,
    color: colors.text,
    lineHeight: 22,
  },
  accountStatus: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 16,
  },
});

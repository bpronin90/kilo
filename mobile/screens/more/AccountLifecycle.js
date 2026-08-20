import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Alert } from '../../lib/platformAlert';
import { Button } from '../../components/UI';
import { useThemedStyles } from '../../theme/ThemeContext';

// Account deletion panel (Phase 5 / Task 13; server export moved to Data &
// Backup's Cloud section, issue #822 — Account is identity-only).
//
// Calls the account-delete Edge Function with the user's JWT; the Edge
// Function holds the service-role key server-side, so no privileged
// credential is exposed here. Deletion uses a two-step confirmation: the user
// must tap once to arm, then confirm, reducing accidental destructive
// actions. Only ever rendered inside AccountScreen's Danger Zone container,
// which supplies the heading.
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
      <Text style={styles.accountNote}>
        Deleting your account removes the cloud copy. By default, the training
        history on this device is kept; the confirmed wipe option below
        removes it too.
      </Text>

      {!deleteArmed ? (
        <Button
          title="Delete Account"
          tone="danger"
          disabled={busy}
          onPress={handleDeleteArm}
          accessibilityLabel="Delete account"
        />
      ) : (
        <>
          <Button
            title="Confirm Delete Account — Keep Device Data"
            tone="danger"
            loadingTitle="Working…"
            disabled={busy}
            onPress={() => handleDeleteConfirm(false)}
            accessibilityLabel="Confirm delete account and keep device data"
          />
          <Button
            title="Confirm Delete & Wipe Device Data"
            tone="danger"
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

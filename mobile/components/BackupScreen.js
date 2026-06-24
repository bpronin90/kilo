import React, { useState } from 'react';
import { Alert, Share, StyleSheet, Text, TextInput } from 'react-native';
import { ScreenShell } from './ScreenShell';
import { Card, SectionTitle, Button } from './UI';
import { Colors } from '../theme/colors';

export function BackupScreen({ onBack, onExport, onImport }) {
  const [importText, setImportText] = useState('');
  const [status, setStatus] = useState(null); // { ok: bool, message: string }
  const [busy, setBusy] = useState(false);

  // Actually produces and shares the export. Only reached after the user has
  // acknowledged that the artifact is unencrypted (see handleExport).
  const shareExport = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await onExport();
      if (!result.ok) {
        setStatus({ ok: false, message: result.error || 'Export failed.' });
        return;
      }
      // No expo-sharing in this app, so the payload is shared as a raw message
      // string. The pre-share warning below makes the unencrypted, readable
      // nature of that payload explicit before it leaves the device.
      await Share.share({ message: result.json });
    } catch (e) {
      setStatus({ ok: false, message: 'Export failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleExport = () => {
    if (busy) return;
    // Security: the export is plaintext and unencrypted. Make that explicit and
    // require an acknowledgement before the data can leave the device.
    Alert.alert(
      'Export is unencrypted',
      'Your backup is plain, unencrypted text. Anyone you share or save it with — clipboard, notes, messengers — can read all of your weight and workout data. Only share it somewhere you trust.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Export anyway', style: 'destructive', onPress: shareExport },
      ],
    );
  };

  // Actually parses and applies the import, replacing all local data. Only
  // reached after the user has confirmed the irreversible replace (see
  // handleImport).
  const runImport = async () => {
    setBusy(true);
    setStatus(null);
    try {
      let payload;
      try {
        payload = JSON.parse(importText.trim());
      } catch {
        setStatus({ ok: false, message: 'Invalid JSON — check your backup text.' });
        return;
      }
      const result = await onImport(payload);
      if (result.ok) {
        setImportText('');
        setStatus({ ok: true, message: 'Data restored successfully.' });
      } else {
        setStatus({ ok: false, message: result.error || 'Import failed.' });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleImport = () => {
    if (busy) return;
    // Keep the empty-input guard before the Alert so an empty paste gives
    // direct feedback without prompting a destructive confirmation.
    if (!importText.trim()) {
      setStatus({ ok: false, message: 'Paste your backup JSON first.' });
      return;
    }
    // Data-safety: importing replaces all current local data and cannot be
    // undone. Require an explicit acknowledgement before anything is replaced.
    Alert.alert(
      'Replace all data?',
      'Importing this backup will permanently replace all of your current weight and workout data on this device. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Replace data', style: 'destructive', onPress: runImport },
      ],
    );
  };

  return (
    <ScreenShell title="Data & Backup" subtitle="Export or restore your training data." onBack={onBack}>

      {status ? (
        <Card tone={status.ok ? 'success' : 'error'}>
          <Text style={styles.statusText}>{status.message}</Text>
        </Card>
      ) : null}

      <SectionTitle>Export</SectionTitle>
      <Card>
        <Text style={styles.helpText}>
          Exports all your weight entries and workout notes as a JSON file you can save or share.
        </Text>
        <Text style={styles.warnText}>
          This file is unencrypted. Anyone you share or save it with can read your data.
        </Text>
        <Button title="Export Data" onPress={handleExport} disabled={busy} style={styles.actionButton} />
      </Card>

      <SectionTitle>Import</SectionTitle>
      <Card>
        <Text style={styles.helpText}>
          Paste a previously exported backup below, then tap Import. This will replace all current data.
        </Text>
        <TextInput
          style={styles.importInput}
          multiline
          numberOfLines={6}
          placeholder="Paste backup JSON here…"
          placeholderTextColor={Colors.textMuted}
          value={importText}
          onChangeText={setImportText}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Button title="Import Data" onPress={handleImport} disabled={busy} style={styles.actionButton} />
      </Card>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  statusText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textLight,
    textAlign: 'center',
  },
  helpText: {
    fontSize: 15,
    lineHeight: 22,
    color: Colors.textMuted,
  },
  warnText: {
    marginTop: 10,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    color: Colors.caution ?? Colors.error ?? Colors.textMuted,
  },
  actionButton: {
    marginTop: 12,
  },
  importInput: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    borderRadius: 12,
    padding: 12,
    fontSize: 13,
    color: Colors.text,
    fontFamily: 'monospace',
    minHeight: 100,
    textAlignVertical: 'top',
  },
});

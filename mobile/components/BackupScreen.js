import React, { useState } from 'react';
import { Share, StyleSheet, Text, TextInput } from 'react-native';
import { ScreenShell } from './ScreenShell';
import { Card, SectionTitle, Button, InputStyle } from './UI';
import { Colors } from '../theme/colors';

export function BackupScreen({ onBack, onExport, onImport }) {
  const [importText, setImportText] = useState('');
  const [status, setStatus] = useState(null); // { ok: bool, message: string }
  const [busy, setBusy] = useState(false);

  const handleExport = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await onExport();
      if (!result.ok) {
        setStatus({ ok: false, message: result.error || 'Export failed.' });
        return;
      }
      await Share.share({ message: result.json });
    } catch (e) {
      setStatus({ ok: false, message: 'Export failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    if (!importText.trim()) {
      setStatus({ ok: false, message: 'Paste your backup JSON first.' });
      return;
    }
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

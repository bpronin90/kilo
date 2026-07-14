import React, { useState } from 'react';
import { Alert, Platform, Share, StyleSheet, Text, TextInput } from 'react-native';
import { ScreenShell } from './ScreenShell';
import { Card, SectionTitle, Button } from './UI';
import { Colors } from '../theme/colors';

function backupFileName() {
  return `kilo-backup-${new Date().toISOString().slice(0, 10)}`;
}

// Write the export to a user-chosen folder via the Storage Access Framework.
//
// Android moves share intents over Binder, which has a hard ~1MB transaction
// limit. Share.share({ message }) puts the whole payload in the intent, so once
// a user's history grows the export throws instead of exporting (#488). Writing
// a file keeps the payload out of the intent entirely, and the resulting file
// survives an uninstall — which is the only way device-local profile fields
// (date_of_birth, sex, height_cm, activity_level) can outlive a reinstall.
//
// The module is required lazily rather than imported at the top of the file. A
// static import that fails to resolve takes down the whole JS bundle, which
// would leave the user unable to open the app at all — strictly worse than a
// failing export, and unacceptable for the OTA whose entire job is rescuing
// their data. Lazily, a missing module degrades to the Share fallback instead.
function loadStorageAccessFramework() {
  // eslint-disable-next-line global-require
  return require('expo-file-system/legacy').StorageAccessFramework;
}

// Returns { written: true, uri } on success, { written: false, reason } when the
// user declines the folder picker, and throws only on a genuine write failure.
async function writeExportFile(json) {
  const StorageAccessFramework = loadStorageAccessFramework();
  const permission = await StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) return { written: false, reason: 'cancelled' };
  const uri = await StorageAccessFramework.createFileAsync(
    permission.directoryUri,
    backupFileName(),
    'application/json',
  );
  await StorageAccessFramework.writeAsStringAsync(uri, json);
  return { written: true, uri };
}

// Read the newest Kilo backup out of a folder the user picks.
//
// Without this the round trip does not close: the export writes a file, but the
// only way back in was pasting the JSON into a TextInput — impractical for
// exactly the large backups that forced the move to files in the first place. A
// user could hold a perfectly good backup and have no way to restore it.
//
// expo-file-system's SAF can enumerate a directory, so this needs no document
// picker and no new native module — it still ships over EAS Update.
//
// Returns { read: true, json, name } , or { read: false, reason }.
async function readNewestBackupFile() {
  const StorageAccessFramework = loadStorageAccessFramework();
  const permission = await StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) return { read: false, reason: 'cancelled' };

  const uris = await StorageAccessFramework.readDirectoryAsync(permission.directoryUri);
  // SAF returns opaque content:// URIs; the file name is the last path segment.
  const backups = uris
    .map((uri) => ({ uri, name: decodeURIComponent(uri).split('/').pop() || '' }))
    .filter((f) => f.name.includes('kilo-backup'));

  if (backups.length === 0) return { read: false, reason: 'none-found' };

  // Names are kilo-backup-YYYY-MM-DD, so lexical descending is newest-first.
  backups.sort((a, b) => b.name.localeCompare(a.name));
  const newest = backups[0];
  const json = await StorageAccessFramework.readAsStringAsync(newest.uri);
  return { read: true, json, name: newest.name };
}

export function BackupScreen({ onBack, onExport, onImport }) {
  const [importText, setImportText] = useState('');
  const [status, setStatus] = useState(null); // { ok: bool, message: string }
  const [busy, setBusy] = useState(false);

  // Actually produces and saves the export. Only reached after the user has
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

      if (Platform.OS === 'android') {
        try {
          const saved = await writeExportFile(result.json);
          if (saved.written) {
            setStatus({ ok: true, message: 'Backup saved to the folder you chose.' });
            return;
          }
          if (saved.reason === 'cancelled') {
            setStatus({ ok: false, message: 'Export cancelled — no folder chosen.' });
            return;
          }
        } catch (e) {
          // Never let a file-write failure cost the user their only backup route.
          // Fall through to the share sheet, which still works for small payloads.
          console.error('[BackupScreen] file export failed, falling back to share:', e);
        }
      }

      // Fallback (and the iOS/web path). The pre-share warning in handleExport
      // makes the unencrypted, readable nature of this payload explicit before
      // it leaves the device.
      await Share.share({ message: result.json });
    } catch (e) {
      console.error('[BackupScreen] export threw:', e);
      setStatus({ ok: false, message: e?.message ? `Export failed: ${e.message}` : 'Export failed.' });
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

  // Loads the newest backup file from a folder the user picks into the import
  // box, so the destructive confirmation below still gates the actual replace.
  const handleImportFromFile = async () => {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const found = await readNewestBackupFile();
      if (!found.read) {
        setStatus({
          ok: false,
          message:
            found.reason === 'none-found'
              ? 'No Kilo backup found in that folder.'
              : 'Import cancelled — no folder chosen.',
        });
        return;
      }
      setImportText(found.json);
      setStatus({ ok: true, message: `Loaded ${found.name}. Tap Import Data to restore it.` });
    } catch (e) {
      console.error('[BackupScreen] file import failed:', e);
      setStatus({ ok: false, message: e?.message ? `Import failed: ${e.message}` : 'Import failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleImport = () => {
    if (busy) return;
    // Keep the empty-input guard before the Alert so an empty paste gives
    // direct feedback without prompting a destructive confirmation.
    if (!importText.trim()) {
      setStatus({ ok: false, message: 'Load a backup file or paste your backup JSON first.' });
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
          Exports all locally saved weight entries and workout notes as a JSON snapshot you can save or share.
        </Text>
        <Text style={styles.warnText}>
          This file is unencrypted. Anyone you share or save it with can read your data.
        </Text>
        <Button title="Export Local Backup" onPress={handleExport} disabled={busy} style={styles.actionButton} />
      </Card>

      <SectionTitle>Import</SectionTitle>
      <Card>
        <Text style={styles.helpText}>
          Load a previously exported backup file, or paste one below, then tap Import. This will replace all current data.
        </Text>
        {Platform.OS === 'android' ? (
          <Button
            title="Load Backup File"
            onPress={handleImportFromFile}
            disabled={busy}
            style={styles.actionButton}
          />
        ) : null}
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

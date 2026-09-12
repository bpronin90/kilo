import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, Share, Text, TextInput, View } from 'react-native';
import { Alert } from '../lib/platformAlert';
import { ScreenShell } from './ScreenShell';
import { Card, SectionTitle, Button } from './UI';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';
import { CloudSyncRecovery } from '../screens/more/CloudSyncRecovery';
import { loadWorkoutNotes, loadWeightEntriesRaw } from '../storage/entries';
import { exportWorkoutsCsv, exportWeightCsv } from '../lib/interoperability/kiloCsv';
import { createStyles } from './backup/backupStyles';
import { writeExportFile, writeCsvExportFile, readNewestBackupFile } from './backup/BackupActions';

// The one section of Data & Backup a typed navigation intent can land on
// (#903), named here rather than in the shell: App.js validates an intent's
// shape, and this screen owns which of its own sections are addressable.
const CLOUD_SYNC_ANCHOR = 'cloud-sync';

export function BackupScreen({ onBack, onExport, onImport, auth, onGoToAccount, navAnchor = null, navAnchorKey = 0 }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const scrollRef = useRef(null);
  const [importText, setImportText] = useState('');
  const [status, setStatus] = useState(null); // { ok: bool, message: string }
  const [busy, setBusy] = useState(false);
  const [cloudExportBusy, setCloudExportBusy] = useState(false);
  const [cloudExportStatus, setCloudExportStatus] = useState('');
  const [dangerBusy, setDangerBusy] = useState(false);
  const [dangerStatus, setDangerStatus] = useState('');

  // Anchored arrival (#903). Cloud Sync Recovery is the last section before the
  // Danger Zone, so an intent that names it lands below the fold — the user is
  // shown Export and Import instead of the panel they asked for. The request is
  // recorded here and fulfilled by the panel's own layout: on a fresh mount
  // nothing has measured the panel yet, so scrolling immediately would either
  // no-op or use a stale offset.
  const cloudSyncOffsetRef = useRef(null);
  const pendingAnchorRef = useRef(null);
  const appliedAnchorKeyRef = useRef(0);

  function scrollToCloudSync(y) {
    pendingAnchorRef.current = null;
    scrollRef.current?.scrollTo({ y, animated: true });
    // Announced, never focused. The user may already be part-way through
    // something on this screen — a paste in the Import field, a screen-reader
    // cursor resting on a control — and moving accessibility focus would take
    // that over. A polite announcement says where the screen has moved and
    // leaves the interaction in progress alone.
    AccessibilityInfo.announceForAccessibility?.('Cloud Sync');
  }

  // Keyed off the shell's monotonic intent key (#718), so asking for Cloud Sync
  // twice in a row re-applies both times, while an ordinary re-render never
  // re-scrolls. An anchorless intent, and manual navigation here (which carries
  // no key at all), clear any pending request rather than moving the viewport.
  useEffect(() => {
    if (navAnchorKey === appliedAnchorKeyRef.current) return;
    appliedAnchorKeyRef.current = navAnchorKey;
    if (navAnchor !== CLOUD_SYNC_ANCHOR) {
      pendingAnchorRef.current = null;
      return;
    }
    pendingAnchorRef.current = CLOUD_SYNC_ANCHOR;
    // A repeat request already knows where the panel is and lands at once.
    const y = cloudSyncOffsetRef.current;
    if (y != null) scrollToCloudSync(y);
  }, [navAnchor, navAnchorKey]);

  // Signed out, or in a build without cloud accounts, the panel is not rendered
  // and this never fires: the request simply stays pending and the intent is a
  // no-op, which is the correct outcome — there is no Cloud Sync to show.
  function handleCloudSyncLayout(e) {
    const { y } = e.nativeEvent.layout;
    const known = cloudSyncOffsetRef.current;
    if (known != null && Math.abs(known - y) < 1) return;
    cloudSyncOffsetRef.current = y;
    // Only a still-pending request scrolls: once the user has landed, a later
    // reflow of the same panel must not yank them back to it.
    if (pendingAnchorRef.current === CLOUD_SYNC_ANCHOR) scrollToCloudSync(y);
  }

  // Server-held account data export (moved from AccountLifecycle, #822 —
  // Account is identity-only now). Distinct from CloudSyncRecovery's own
  // "Export Cloud Copy" below, which exports the local device snapshot with
  // the signed-in identity attached; this fetches what the server currently
  // holds for the account instead.
  const handleServerExport = async () => {
    setCloudExportBusy(true);
    setCloudExportStatus('');
    try {
      const result = await auth.serverExport();
      if (!result.ok) {
        setCloudExportStatus(result.error || 'Export failed.');
        return;
      }
      await Share.share({ message: result.json });
      setCloudExportStatus('Account data exported.');
    } catch {
      setCloudExportStatus('Export failed.');
    } finally {
      setCloudExportBusy(false);
    }
  };

  const runDanger = async (fn) => {
    setDangerBusy(true);
    setDangerStatus('');
    try {
      const result = await fn();
      if (result?.ok) {
        setDangerStatus(result.message || 'Done.');
      } else {
        setDangerStatus(result?.error || 'Something went wrong.');
      }
    } finally {
      setDangerBusy(false);
    }
  };

  // Moved from AccountScreen (#822): wiping local data never required a
  // cloud account, so it belongs with the rest of Data & Backup, not Account.
  const handleDeviceWipe = () => {
    Alert.alert(
      'Wipe Device Data',
      'This permanently removes the training and health history stored on this device. It does not require a cloud account and cannot be undone. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Wipe Device Data',
          style: 'destructive',
          onPress: () => runDanger(() => auth?.wipeDeviceData?.().then((result) => (
            result.ok ? { ok: true, message: 'Device data wiped.' } : result
          ))),
        },
      ],
    );
  };

  const handleSignOutAndWipe = () => {
    Alert.alert(
      'Sign Out and Wipe Device Data',
      'This signs out and permanently removes the training and health history stored on this device. The cloud copy is kept. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out & Wipe',
          style: 'destructive',
          onPress: () => runDanger(() => auth.signOut({ wipeLocalData: true }).then((result) => (
            result.ok ? { ok: true, message: 'Signed out and device data wiped.' } : result
          ))),
        },
      ],
    );
  };

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
          // Declining the folder picker must NOT end the export. The user came
          // here to get their data out; leaving them with no artifact is the
          // failure mode this whole change exists to prevent. Fall through to
          // the share sheet, which is still a real export route.
        } catch (e) {
          // Never let a file-write failure cost the user their only backup route.
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

  // Issue #578: builds one CSV artifact (workouts or weight) and writes/shares
  // it via the same Android-file/Share fallback pattern shareExport already
  // uses. Reads storage directly rather than through onExport — see the
  // `csvFileName` comment above for why. Never throws to the caller; a build
  // or write failure lands in `status` like every other action on this screen.
  const shareCsvExport = async (kind) => {
    setBusy(true);
    setStatus(null);
    try {
      const csvText = kind === 'workouts'
        ? exportWorkoutsCsv(await loadWorkoutNotes())
        : exportWeightCsv(await loadWeightEntriesRaw());

      if (Platform.OS === 'android') {
        try {
          const saved = await writeCsvExportFile(csvText, kind);
          if (saved.written) {
            setStatus({ ok: true, message: 'CSV saved to the folder you chose.' });
            return;
          }
          // Same reasoning as shareExport: declining the folder picker must
          // not end the export — fall through to the share sheet.
        } catch (e) {
          console.error('[BackupScreen] CSV file export failed, falling back to share:', e);
        }
      }

      await Share.share({ message: csvText });
    } catch (e) {
      console.error('[BackupScreen] CSV export threw:', e);
      setStatus({ ok: false, message: e?.message ? `Export failed: ${e.message}` : 'Export failed.' });
    } finally {
      setBusy(false);
    }
  };

  // Issue #578 "Goal": CSV is interoperability, never backup or sync, and the
  // export must disclose loss, that files are unencrypted, and that
  // processing stays on-device before anything leaves the device.
  const handleExportCsv = (kind) => {
    if (busy) return;
    Alert.alert(
      'CSV is not a backup',
      'CSV export is for moving your data into other tools — it drops recovery history, deload/fatigue data, tracked-lift activation state, and deleted-record history, and most sessions have no recoverable calendar date. Use Export Local Backup to preserve everything. This file is also unencrypted and processed entirely on this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Export anyway', style: 'destructive', onPress: () => shareCsvExport(kind) },
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
    <ScreenShell
      ref={scrollRef}
      title="Data & Backup"
      subtitle="Export or restore your training data — on this device or in the cloud."
      onBack={onBack}
    >

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
        <Text style={styles.helpText}>
          Export your data as CSV to use it in other tools. This is not a backup — it loses recovery,
          deload/fatigue, and deleted-record history, and most dates.
        </Text>
        <Button
          title="Export Workouts CSV"
          onPress={() => handleExportCsv('workouts')}
          disabled={busy}
          style={styles.actionButton}
        />
        <Button
          title="Export Weight CSV"
          onPress={() => handleExportCsv('weight')}
          disabled={busy}
          style={styles.actionButton}
        />
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
          placeholderTextColor={colors.textMuted}
          value={importText}
          onChangeText={setImportText}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Button title="Import Data" onPress={handleImport} disabled={busy} style={styles.actionButton} />
      </Card>

      <SectionTitle>Cloud</SectionTitle>
      {!auth?.configured ? (
        <Card>
          <Text style={styles.helpText}>
            Cloud accounts are not configured in this build. The app continues to
            work fully offline with your local data.
          </Text>
        </Card>
      ) : auth?.loading ? null : !auth?.signedIn ? (
        <Card tone="accent">
          <Text style={[styles.helpText, styles.textLight]}>
            Cloud backup is off. Create an account to keep a synced copy of your
            data across devices.
          </Text>
          <Button
            title="Sign In / Create Account"
            onPress={onGoToAccount}
            accessibilityLabel="Go to Account to sign in"
            style={styles.actionButton}
          />
        </Card>
      ) : (
        <>
          <Card>
            <Text style={styles.helpText}>
              Export Account Data fetches what the server currently holds for
              your account — not what is on this device. It may differ from
              your local data if you have not recently synced.
            </Text>
            <Button
              title="Export Account Data"
              loadingTitle="Working…"
              disabled={cloudExportBusy}
              onPress={handleServerExport}
              accessibilityLabel="Export account data"
              style={styles.actionButton}
            />
            {cloudExportStatus ? (
              <Text style={styles.helpText} accessibilityLabel="Account export status">
                {cloudExportStatus}
              </Text>
            ) : null}
          </Card>
          {/* Wrapped only to give the panel a measurable position for #903's
              anchored arrival. Section order and spacing are unchanged: the
              wrapper takes the panel's place as a direct child of the shell's
              content column. */}
          <View onLayout={handleCloudSyncLayout}>
            <CloudSyncRecovery
              user={auth.user}
              onConsentDismiss={() => scrollRef.current?.scrollTo({ y: 0, animated: true })}
            />
          </View>
        </>
      )}

      <View style={styles.dangerZone}>
        <View style={styles.dangerZoneHeading}>
          <Text style={styles.dangerZoneHeadingText}>⚠ Danger Zone</Text>
        </View>
        {auth?.deviceWipeRequired ? (
          <Text style={styles.warnText} accessibilityLabel="Device wipe required">
            Your account session ended, but device data could not be wiped. Retry before sharing this device.
          </Text>
        ) : null}
        <Button
          title={auth?.deviceWipeRequired ? 'Retry Device Data Wipe' : 'Wipe Device Data'}
          tone="danger"
          disabled={dangerBusy}
          onPress={handleDeviceWipe}
          accessibilityLabel="Wipe device data"
          style={styles.actionButton}
        />
        {auth?.signedIn ? (
          <Button
            title="Sign Out & Wipe Device Data"
            tone="danger"
            disabled={dangerBusy}
            onPress={handleSignOutAndWipe}
            accessibilityLabel="Sign out and wipe device data"
            style={styles.actionButton}
          />
        ) : null}
        {dangerStatus ? (
          <Text style={styles.helpText} accessibilityLabel="Danger zone status">
            {dangerStatus}
          </Text>
        ) : null}
      </View>
    </ScreenShell>
  );
}

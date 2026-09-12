// Backup file I/O actions (issue #1060 split of BackupScreen.js).
//
// The Storage Access Framework read/write helpers behind the Export and Import
// buttons, kept out of the screen component so the presentational file stays
// under the 600-line cap. Behavior, file names ('kilo-backup-', 'kilo-workouts-',
// 'kilo-weight-'), the lazy require of expo-file-system/legacy (a static import
// that failed to resolve would break the bundle and leave the app unopenable),
// and the folder-picker/write/read contracts are unchanged. writeExportFile,
// writeCsvExportFile and readNewestBackupFile are the seams BackupScreen uses;
// backupFileName, csvFileName and loadStorageAccessFramework stay module-local.

function backupFileName() {
  return `kilo-backup-${new Date().toISOString().slice(0, 10)}`;
}

// Issue #578 (comment 5530857840, "Kilo exports"): CSV is interoperability,
// never backup — a separate file per collection, never combined with the
// JSON backup's single-file shape. BackupScreen reads storage directly
// (loadWorkoutNotes/loadWeightEntriesRaw) rather than receiving CSV data
// through a prop, unlike the JSON `onExport` prop: threading a new prop
// through App.js -> MoreScreen.js -> BackupScreen would touch
// mobile/screens/MoreScreen.js, which is outside this stage's Allowed Files.
function csvFileName(kind) {
  const date = new Date().toISOString().slice(0, 10);
  return `kilo-${kind}-${date}`;
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
export async function writeExportFile(json) {
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

// Same Android SAF write path as writeExportFile, for a CSV artifact rather
// than the JSON backup. `kind` is 'workouts' or 'weight'.
export async function writeCsvExportFile(csvText, kind) {
  const StorageAccessFramework = loadStorageAccessFramework();
  const permission = await StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) return { written: false, reason: 'cancelled' };
  const uri = await StorageAccessFramework.createFileAsync(
    permission.directoryUri,
    csvFileName(kind),
    'text/csv',
  );
  await StorageAccessFramework.writeAsStringAsync(uri, csvText);
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
export async function readNewestBackupFile() {
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

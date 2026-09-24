const { createRunOncePlugin, withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

const pkg = require('../modules/android-restore-credentials/package.json');

// The androidx.credentials Gradle dependencies the module needs
// (androidx.credentials:credentials, androidx.credentials:credentials-play-
// services-auth) are declared on the local module itself in
// modules/android-restore-credentials/android/build.gradle and pulled in by
// Expo autolinking; this plugin does not duplicate them. Its job is the
// manifest-level guarantee: Restore Credentials must never become a reason
// to turn on Android Auto Backup, since that would let Android capture
// credential-adjacent app data outside AndroidX Credential Manager's own
// managed storage. `mobile/app.json` already sets `android.allowBackup` to
// `false`; this plugin asserts that stays true at prebuild time instead of
// silently tolerating a future accidental flip to `true`.
function withAndroidRestoreCredentials(config) {
  return withAndroidManifest(config, (modConfig) => {
    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(modConfig.modResults);
    const allowBackup = mainApplication.$['android:allowBackup'];

    if (allowBackup === 'true') {
      throw new Error(
        'withAndroidRestoreCredentials: android.allowBackup must stay false. ' +
          'Restore Credentials keeps credential-private material inside AndroidX ' +
          'Credential Manager; enabling Android Auto Backup is not supported by this module.'
      );
    }

    mainApplication.$['android:allowBackup'] = 'false';
    return modConfig;
  });
}

module.exports = createRunOncePlugin(withAndroidRestoreCredentials, pkg.name, pkg.version);

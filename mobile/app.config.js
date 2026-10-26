// Dynamic Expo config. Overrides runtimeVersion so that preview builds use a
// stable manual string rather than tracking expo.version. Bump PREVIEW_RUNTIME
// only when a native-affecting change requires a fresh preview build. Bump in
// the same PR for new or updated native modules, Expo SDK/native dependency
// changes, and native config or plugin changes.
// preview-2: SDK 54 → SDK 56 native runtime change (issue #369).
// preview-3: reverted SDK 56 → SDK 54 (commit f5558f3, issue #375). This is a
//   native runtime change, so bump the runtime: old preview-2 (SDK 56) installs
//   must NOT receive SDK 54 OTA bundles and instead require a fresh build.
// preview-4: #434 added @sentry/react-native and its Expo config plugin; #484
//   upgraded react-native-safe-area-context. Old preview-3 binaries lack the
//   required native code and must be replaced with a fresh preview-4 build.
// preview-5: #796 adds native encrypted-storage/CAPTCHA dependencies and disables
//   unsigned OTA acceptance. Old preview-4 binaries must not receive bundles
//   built for this native runtime and must be replaced with a fresh build.
// preview-6: #811 intentionally restores unsigned EAS Update delivery. The
//   update-client security posture is native configuration, so preview-5
//   installs remain isolated and require one replacement build.
// preview-7: #980 adds expo-dev-client for the on-device development loop. It is
//   a new native module, so preview-6 binaries lack the required native code and
//   must be replaced with a fresh preview-7 build.
// preview-8: #985 adds expo-system-ui so the Light/Dark/System setting applies at
//   the native layer (Android especially). It is a new native module and flips
//   userInterfaceStyle from "light" to "automatic", so preview-7 binaries lack
//   the required native code and must be replaced with a fresh preview-8 build.
// preview-9: #1126 drops the portrait lock and adds smallestScreenSize to the
//   MainActivity configChanges. Both are native manifest changes, so preview-8
//   installs stay isolated and need one replacement build.
// preview-10: #1158 adds the android-restore-credentials local native module
//   and its config plugin, so preview-9 installs lack the native side.
// preview-11: #1167 adds withAndroidR8Optimization, a local config plugin that
//   patches the generated app module's release buildType Gradle config
//   (proguard-android.txt -> proguard-android-optimize.txt). The "preview" EAS
//   build profile shares that release buildType, so preview-10 installs lack
//   the R8-optimized native config and must be replaced with a fresh build.
// preview-12: #1176 (2026-09-28) adds an expo-build-properties keep rule for
//   Expo annotation types. preview-11's R8 optimization rewrote Expo Record
//   conversion to throw, so every SecureStore call failed and the encrypted
//   notebook could not be read. The rule changes the generated release
//   proguard-rules.pro, so preview-11 installs need this rebuilt APK (installed
//   over preview-11; no data is cleared).
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// preview-13: #1455 (2026-10-19) adds an R8 keep rule for expo.modules.notifications.
//   R8 stripped the library's private writeObject/readObject serialization hooks,
//   so scheduling any notification threw NotSerializableException. The rule
//   changes the generated release proguard-rules.pro, so preview-12 installs
//   need this rebuilt APK (installed over preview-12; no data is cleared).
// preview-14: #1546 (2026-10-21) upgrades Expo SDK 54 -> 58 (React Native
//   0.88, AGP 9). Every native module changes, so preview-13 installs must not
//   receive SDK 58 bundles and need a fresh preview build (installed over
//   preview-13; no data is cleared).
// preview-15: #1651 adds expo-audio (new native module) for the rest-timer
//   completion cue and a dedicated rest-timer notification channel, so
//   preview-14 installs lack the native audio code and need a fresh build.
const PREVIEW_RUNTIME = 'preview-15';

// Large-screen resizing (#1126). The SDK 54 template's MainActivity already
// handles orientation|screenSize|screenLayout itself, but not
// smallestScreenSize, so unfolding a foldable or crossing the 600dp split-screen
// boundary would recreate the activity and remount React, dropping the active
// tab, navigation depth, and any open modal. Handling it in-process keeps the
// tree mounted; React Native re-lays out from the new window dimensions.
const MAIN_ACTIVITY_CONFIG_CHANGES = ['smallestScreenSize'];

function mergeConfigChanges(existing, required = MAIN_ACTIVITY_CONFIG_CHANGES) {
  const tokens = String(existing || '').split('|').filter(Boolean);
  for (const token of required) {
    if (!tokens.includes(token)) tokens.push(token);
  }
  return tokens.join('|');
}

// The repo-root security-delivery test resolves this config without mobile/
// dependencies installed, so `expo` may be absent there. Any Expo CLI or EAS
// evaluation runs inside mobile/ with expo installed and always gets the mod.
function loadConfigPlugins() {
  try {
    return require('expo/config-plugins');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND') return null;
    throw error;
  }
}

function withResizableMainActivity(config) {
  const plugins = loadConfigPlugins();
  if (!plugins) return config;
  const { withAndroidManifest, AndroidConfig } = plugins;
  return withAndroidManifest(config, (modConfig) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(modConfig.modResults);
    activity.$['android:configChanges'] = mergeConfigChanges(activity.$['android:configChanges']);
    return modConfig;
  });
}

// Development builds install alongside preview/production rather than replacing
// them (#980). Preview and production share com.benpronin.kilo, so a development
// build under that identifier would overwrite the owner's working preview
// install. Only APP_ENV=development gets the suffix; every other environment
// keeps the shipping identifiers byte-for-byte.
const DEV_IDENTIFIER_SUFFIX = '.dev';
const DEV_NAME_SUFFIX = ' Dev';

function applyDevelopmentIdentity(config) {
  return {
    ...config,
    name: `${config.name}${DEV_NAME_SUFFIX}`,
    ios: {
      ...config.ios,
      bundleIdentifier: `${config.ios?.bundleIdentifier}${DEV_IDENTIFIER_SUFFIX}`,
    },
    android: {
      ...config.android,
      package: `${config.android?.package}${DEV_IDENTIFIER_SUFFIX}`,
    },
  };
}

// Production-only signed OTA updates (#1233). A production binary embeds the
// Kilo code-signing certificate, so expo-updates rejects any manifest that is
// unsigned or signed by another key: Expo account access alone cannot replace
// production JavaScript. Preview, simulator, development, and unset APP_ENV
// (local `expo start`, Jest, web export) stay unsigned and byte-for-byte
// unchanged. The certificate is public but is supplied from outside Git (EAS
// file variable or local path); the private key never reaches EAS or the
// binary. Errors name variables and paths only, never file contents.
const OTA_CERTIFICATE_ENV = 'KILO_OTA_CODE_SIGNING_CERTIFICATE';
const OTA_PRIVATE_KEY_ENV = 'KILO_OTA_CODE_SIGNING_PRIVATE_KEY';
const OTA_CODE_SIGNING_METADATA = { keyid: 'main', alg: 'rsa-v1_5-sha256' };
const CODE_SIGNING_EKU = '1.3.6.1.5.5.7.3.3';

function requiresOtaSigning(env = process.env) {
  return env.APP_ENV === 'production' || env.EAS_BUILD_PROFILE === 'production';
}

function signingError(message) {
  return new Error(`Production OTA signing: ${message} See mobile/certs/KEYS.md.`);
}

function readSigningFile(envName, env) {
  const filePath = env[envName];
  if (!filePath || !String(filePath).trim()) {
    throw signingError(`${envName} is not set; production builds and updates fail closed without it.`);
  }
  const absolute = path.resolve(__dirname, filePath);
  try {
    return { absolute, pem: fs.readFileSync(absolute, 'utf8') };
  } catch {
    throw signingError(`${envName} does not point at a readable file.`);
  }
}

function loadOtaCertificate(env = process.env) {
  const { absolute, pem } = readSigningFile(OTA_CERTIFICATE_ENV, env);
  if (/PRIVATE KEY/.test(pem)) {
    throw signingError(`${OTA_CERTIFICATE_ENV} contains private key material; it must hold only the public certificate.`);
  }
  let certificate;
  try {
    certificate = new crypto.X509Certificate(pem);
  } catch {
    throw signingError(`${OTA_CERTIFICATE_ENV} is not a valid PEM X.509 certificate.`);
  }
  if (certificate.publicKey.asymmetricKeyType !== 'rsa') {
    throw signingError(`${OTA_CERTIFICATE_ENV} must carry an RSA key (${OTA_CODE_SIGNING_METADATA.alg}).`);
  }
  const now = Date.now();
  if (now < Date.parse(certificate.validFrom) || now > Date.parse(certificate.validTo)) {
    throw signingError(`${OTA_CERTIFICATE_ENV} is outside its validity period; rotate it.`);
  }
  if (!(certificate.keyUsage || []).includes(CODE_SIGNING_EKU)) {
    throw signingError(`${OTA_CERTIFICATE_ENV} lacks the codeSigning extended key usage.`);
  }
  return { absolute, certificate };
}

// Signed production gets its own runtime, `<version>-sdk<N>-signed`, rather
// than the plain appVersion runtime. expo-updates does not re-verify cached
// updates, so sharing the unsigned runtime would let an unsigned OTA cached by
// an older install launch after an in-place upgrade to the signed binary. Each
// version still gets a distinct runtime, as with the appVersion policy. The
// Expo SDK major (#1546) is part of the runtime so JavaScript built against a
// new SDK can never be published to an older SDK's binary of the same version.
function expoSdkMajor() {
  const match = /(\d+)/.exec(require('./package.json').dependencies?.expo || '');
  if (!match) throw signingError('mobile/package.json must declare the expo dependency to derive the signed runtime.');
  return match[1];
}

function signedProductionRuntime(config) {
  if (!config.version) throw signingError('expo.version is required to derive the signed runtime.');
  return `${config.version}-sdk${expoSdkMajor()}-signed`;
}

// expo-updates joins updates.codeSigningCertificate onto the project root, so
// an absolute EAS file-variable path must be expressed relative to mobile/.
function withProductionOtaSigning(config, env = process.env) {
  const { absolute } = loadOtaCertificate(env);
  return {
    ...config,
    runtimeVersion: signedProductionRuntime(config),
    updates: {
      ...config.updates,
      codeSigningCertificate: path.relative(__dirname, absolute),
      codeSigningMetadata: { ...OTA_CODE_SIGNING_METADATA },
    },
  };
}

// Preflight for `update:*:production`: the private key must parse and match the
// certificate before eas update signs anything with it.
function assertProductionUpdateSigning(env = process.env) {
  const { certificate } = loadOtaCertificate(env);
  const { pem } = readSigningFile(OTA_PRIVATE_KEY_ENV, env);
  let publicFromKey;
  try {
    publicFromKey = crypto.createPublicKey(crypto.createPrivateKey(pem));
  } catch {
    throw signingError(`${OTA_PRIVATE_KEY_ENV} is not a valid unencrypted PEM private key.`);
  }
  const spki = (key) => key.export({ type: 'spki', format: 'der' });
  if (!spki(publicFromKey).equals(spki(certificate.publicKey))) {
    throw signingError(`${OTA_PRIVATE_KEY_ENV} does not match ${OTA_CERTIFICATE_ENV}.`);
  }
}

function appendPlugin(existingPlugins, nextPlugin) {
  const plugins = Array.isArray(existingPlugins) ? existingPlugins : [];
  const pluginName = Array.isArray(nextPlugin) ? nextPlugin[0] : nextPlugin;
  if (plugins.some((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === pluginName)) {
    return plugins;
  }
  return [...plugins, nextPlugin];
}

module.exports = ({ config }) => {
  const isPreview = process.env.APP_ENV === 'preview';
  const isDevelopment = process.env.APP_ENV === 'development';
  const sentryDsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  const sentryOrg = process.env.SENTRY_ORG;
  const sentryProject = process.env.SENTRY_PROJECT;
  const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;
  const sentryPlugin =
    sentryDsn && sentryOrg && sentryProject && sentryAuthToken
      ? [
          '@sentry/react-native/expo',
          {
            organization: sentryOrg,
            project: sentryProject,
            url: process.env.SENTRY_URL || 'https://sentry.io/',
          },
        ]
      : null;
  const identity = isDevelopment ? applyDevelopmentIdentity(config) : config;
  const base = requiresOtaSigning() ? withProductionOtaSigning(identity) : identity;
  return withResizableMainActivity({
    ...base,
    plugins: sentryPlugin ? appendPlugin(base.plugins, sentryPlugin) : base.plugins,
    runtimeVersion: isPreview ? PREVIEW_RUNTIME : base.runtimeVersion ?? { policy: 'appVersion' },
  });
};

module.exports.mergeConfigChanges = mergeConfigChanges;
module.exports.requiresOtaSigning = requiresOtaSigning;
module.exports.assertProductionUpdateSigning = assertProductionUpdateSigning;

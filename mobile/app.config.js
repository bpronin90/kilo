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
const PREVIEW_RUNTIME = 'preview-7';

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
  const base = isDevelopment ? applyDevelopmentIdentity(config) : config;
  return {
    ...base,
    plugins: sentryPlugin ? appendPlugin(base.plugins, sentryPlugin) : base.plugins,
    runtimeVersion: isPreview ? PREVIEW_RUNTIME : { policy: 'appVersion' },
  };
};

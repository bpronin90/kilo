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
const PREVIEW_RUNTIME = 'preview-4';

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
  return {
    ...config,
    plugins: sentryPlugin ? appendPlugin(config.plugins, sentryPlugin) : config.plugins,
    runtimeVersion: isPreview ? PREVIEW_RUNTIME : { policy: 'appVersion' },
  };
};

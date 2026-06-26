// Dynamic Expo config. Overrides runtimeVersion so that preview builds use a
// stable manual string rather than tracking expo.version. Bump PREVIEW_RUNTIME
// only when a native-affecting change requires a fresh preview build.
// preview-2: SDK 54 → SDK 56 native runtime change (issue #369).
// preview-3: reverted SDK 56 → SDK 54 (commit f5558f3, issue #375). This is a
//   native runtime change, so bump the runtime: old preview-2 (SDK 56) installs
//   must NOT receive SDK 54 OTA bundles and instead require a fresh build.
const PREVIEW_RUNTIME = 'preview-3';

module.exports = ({ config }) => {
  const isPreview = process.env.APP_ENV === 'preview';
  return {
    ...config,
    runtimeVersion: isPreview ? PREVIEW_RUNTIME : { policy: 'appVersion' },
  };
};

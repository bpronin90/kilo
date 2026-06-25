// Dynamic Expo config. Overrides runtimeVersion so that preview builds use a
// stable manual string rather than tracking expo.version. Bump PREVIEW_RUNTIME
// only when a native-affecting change requires a fresh preview build.
// preview-2: SDK 54 → SDK 56 native runtime change (issue #369).
const PREVIEW_RUNTIME = 'preview-2';

module.exports = ({ config }) => {
  const isPreview = process.env.APP_ENV === 'preview';
  return {
    ...config,
    runtimeVersion: isPreview ? PREVIEW_RUNTIME : { policy: 'appVersion' },
  };
};

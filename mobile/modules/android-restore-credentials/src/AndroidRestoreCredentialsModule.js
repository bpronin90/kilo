import { requireOptionalNativeModule } from 'expo-modules-core';

// `requireOptionalNativeModule` resolves to `null` on platforms/builds where
// the native `AndroidRestoreCredentials` module isn't linked (iOS, web, or an
// Android build that hasn't run prebuild with the config plugin applied)
// instead of throwing, so callers in src/index.js can fail closed to an
// "unsupported" result rather than crashing.
export default requireOptionalNativeModule('AndroidRestoreCredentials');

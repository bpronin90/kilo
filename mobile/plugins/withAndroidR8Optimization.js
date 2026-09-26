const { createRunOncePlugin, withAppBuildGradle } = require('expo/config-plugins');

const pkg = require('../package.json');

// Expo SDK 54 prebuild emits the app module's release buildType with
// getDefaultProguardFile("proguard-android.txt"), which ships R8's -dontoptimize
// rule and disables optimization entirely (see #1134/#1167: production AAB
// versionCode 17 measured isOptimizationsEnabled=false, noOptimizationPercentage
// 100.0). Google Play requires >=25% optimization/shrinking/obfuscation coverage
// for applicable app versions from February 2027. Swapping in
// "proguard-android-optimize.txt" keeps minification/shrinking (already enabled
// via expo-build-properties) but drops -dontoptimize so R8 actually optimizes.
const NON_OPTIMIZING_PROGUARD_FILE = 'getDefaultProguardFile("proguard-android.txt")';
const OPTIMIZING_PROGUARD_FILE = 'getDefaultProguardFile("proguard-android-optimize.txt")';

function withAndroidR8Optimization(config) {
  return withAppBuildGradle(config, (modConfig) => {
    if (modConfig.modResults.language !== 'groovy') {
      throw new Error(
        'withAndroidR8Optimization: expected the generated app build.gradle to be Groovy; ' +
          'Expo prebuild output format may have changed.'
      );
    }

    const contents = modConfig.modResults.contents;

    if (contents.includes(OPTIMIZING_PROGUARD_FILE)) {
      // Already patched (idempotent re-run, e.g. a second prebuild pass).
      return modConfig;
    }

    if (!contents.includes(NON_OPTIMIZING_PROGUARD_FILE)) {
      throw new Error(
        'withAndroidR8Optimization: expected to find ' +
          `${NON_OPTIMIZING_PROGUARD_FILE} in the generated app build.gradle release ` +
          'buildType, but it was not present. Expo prebuild\'s generated Gradle form ' +
          'may have changed; refusing to produce a build that silently stays non-optimized.'
      );
    }

    modConfig.modResults.contents = contents.replace(
      NON_OPTIMIZING_PROGUARD_FILE,
      OPTIMIZING_PROGUARD_FILE
    );

    return modConfig;
  });
}

module.exports = createRunOncePlugin(withAndroidR8Optimization, pkg.name, pkg.version);

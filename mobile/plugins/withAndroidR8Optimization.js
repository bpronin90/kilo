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

// Locates the `release { ... }` buildType block by brace-counting from the
// `release {` marker, so the proguard-file swap below only ever inspects and
// edits the release build's settings — never a `debug` (or other) block that
// happens to contain a similar-looking proguard line. Returns null if no such
// block is found, or if its braces never balance (an unexpected Gradle shape).
function findReleaseBuildTypeBlock(contents) {
  const marker = /\brelease\s*\{/.exec(contents);
  if (!marker) {
    return null;
  }

  const blockStart = marker.index;
  let depth = 0;
  for (let i = blockStart + marker[0].length - 1; i < contents.length; i += 1) {
    const char = contents[i];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return { start: blockStart, end: i + 1 };
      }
    }
  }

  return null;
}

function withAndroidR8Optimization(config) {
  return withAppBuildGradle(config, (modConfig) => {
    if (modConfig.modResults.language !== 'groovy') {
      throw new Error(
        'withAndroidR8Optimization: expected the generated app build.gradle to be Groovy; ' +
          'Expo prebuild output format may have changed.'
      );
    }

    const contents = modConfig.modResults.contents;
    const releaseBlock = findReleaseBuildTypeBlock(contents);

    if (!releaseBlock) {
      throw new Error(
        'withAndroidR8Optimization: expected to find a release buildType block ' +
          '(`release { ... }`) with balanced braces in the generated app build.gradle, ' +
          'but it was not present. Expo prebuild\'s generated Gradle form may have ' +
          'changed; refusing to produce a build that silently stays non-optimized.'
      );
    }

    const releaseContents = contents.slice(releaseBlock.start, releaseBlock.end);

    if (releaseContents.includes(OPTIMIZING_PROGUARD_FILE)) {
      // Already patched (idempotent re-run, e.g. a second prebuild pass).
      return modConfig;
    }

    if (!releaseContents.includes(NON_OPTIMIZING_PROGUARD_FILE)) {
      throw new Error(
        'withAndroidR8Optimization: expected to find ' +
          `${NON_OPTIMIZING_PROGUARD_FILE} in the generated app build.gradle release ` +
          'buildType, but it was not present. Expo prebuild\'s generated Gradle form ' +
          'may have changed; refusing to produce a build that silently stays non-optimized.'
      );
    }

    const patchedReleaseContents = releaseContents.replace(
      NON_OPTIMIZING_PROGUARD_FILE,
      OPTIMIZING_PROGUARD_FILE
    );

    modConfig.modResults.contents =
      contents.slice(0, releaseBlock.start) +
      patchedReleaseContents +
      contents.slice(releaseBlock.end);

    return modConfig;
  });
}

module.exports = createRunOncePlugin(withAndroidR8Optimization, pkg.name, pkg.version);

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

// Replaces every character inside a `//` line comment or `/* ... */` block
// comment with a space, preserving length and newlines so the result's
// character offsets still line up with the original `contents`. Used so the
// block/marker lookups below never match inside a comment (e.g. a commented-
// out example `release { ... }` block, or a proguard-file mention in a
// comment) and mistake it for real, active Gradle structure.
function blankOutComments(contents) {
  let result = '';
  for (let i = 0; i < contents.length; i += 1) {
    const twoChars = contents.slice(i, i + 2);
    if (twoChars === '//') {
      let end = contents.indexOf('\n', i);
      if (end === -1) {
        end = contents.length;
      }
      result += contents.slice(i, end).replace(/[^\n]/g, ' ');
      i = end - 1;
    } else if (twoChars === '/*') {
      let end = contents.indexOf('*/', i + 2);
      end = end === -1 ? contents.length : end + 2;
      result += contents.slice(i, end).replace(/[^\n]/g, ' ');
      i = end - 1;
    } else {
      result += contents[i];
    }
  }
  return result;
}

// Brace-counts forward from just after `marker`'s opening `{` to find the
// matching closing `}`. Returns null if the braces never balance.
function findBalancedBlockEnd(contents, openBraceIndex) {
  let depth = 0;
  for (let i = openBraceIndex; i < contents.length; i += 1) {
    const char = contents[i];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return i + 1;
      }
    }
  }

  return null;
}

// Locates the `release { ... }` buildType block *inside* `buildTypes { ... }`
// specifically — not the first textual `release {` anywhere in the file — so
// the proguard-file swap below only ever inspects and edits the production
// release build's settings. This guards against both a `debug` block that
// happens to contain a similar-looking proguard line, and an unrelated
// `release`-named block elsewhere (e.g. under `signingConfigs`) that could
// otherwise be mistaken for the buildType and short-circuit the idempotency
// check while the real release buildType stays unpatched. Returns null if
// `buildTypes { ... }`, or a `release { ... }` nested directly inside it, is
// not found, or if either block's braces never balance (an unexpected shape).
function findReleaseBuildTypeBlock(contents) {
  const buildTypesMarker = /\bbuildTypes\s*\{/.exec(contents);
  if (!buildTypesMarker) {
    return null;
  }

  const buildTypesOpenBrace = buildTypesMarker.index + buildTypesMarker[0].length - 1;
  const buildTypesEnd = findBalancedBlockEnd(contents, buildTypesOpenBrace);
  if (buildTypesEnd === null) {
    return null;
  }

  const buildTypesContents = contents.slice(buildTypesOpenBrace, buildTypesEnd);
  const releaseMarker = /\brelease\s*\{/.exec(buildTypesContents);
  if (!releaseMarker) {
    return null;
  }

  const releaseStart = buildTypesOpenBrace + releaseMarker.index;
  const releaseOpenBrace = releaseStart + releaseMarker[0].length - 1;
  const releaseEnd = findBalancedBlockEnd(contents, releaseOpenBrace);
  if (releaseEnd === null || releaseEnd > buildTypesEnd) {
    return null;
  }

  return { start: releaseStart, end: releaseEnd };
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
    // Locate block boundaries against a comment-blanked copy (same length/
    // offsets as `contents`) so a commented-out example block or mention
    // can't be mistaken for the real, active Gradle structure.
    const releaseBlock = findReleaseBuildTypeBlock(blankOutComments(contents));

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

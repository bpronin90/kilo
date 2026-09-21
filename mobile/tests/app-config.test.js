describe('app config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.APP_ENV;
    delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    delete process.env.SENTRY_ORG;
    delete process.env.SENTRY_PROJECT;
    delete process.env.SENTRY_AUTH_TOKEN;
    delete process.env.SENTRY_URL;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('keeps preview runtime override for preview builds', () => {
    process.env.APP_ENV = 'preview';
    const configFactory = require('../app.config.js');

    const result = configFactory({ config: { plugins: [] } });

    expect(result.runtimeVersion).toBe('preview-8');
  });

  test('uses the appVersion runtime policy for production builds', () => {
    const configFactory = require('../app.config.js');

    const result = configFactory({ config: { plugins: [] } });

    expect(result.runtimeVersion).toEqual({ policy: 'appVersion' });
  });

  // #980: the development client installs alongside preview/production instead of
  // replacing it, so only APP_ENV=development may carry the suffixed identifiers.
  const SHIPPING_CONFIG = {
    name: 'Kilo',
    plugins: [],
    ios: { bundleIdentifier: 'com.benpronin.kilo', supportsTablet: true },
    android: { package: 'com.benpronin.kilo', allowBackup: false },
  };

  test('suffixes the app identity for development builds', () => {
    process.env.APP_ENV = 'development';
    const configFactory = require('../app.config.js');

    const result = configFactory({ config: SHIPPING_CONFIG });

    expect(result.name).toBe('Kilo Dev');
    expect(result.ios.bundleIdentifier).toBe('com.benpronin.kilo.dev');
    expect(result.android.package).toBe('com.benpronin.kilo.dev');
  });

  test('preserves unrelated ios and android config when suffixing development identity', () => {
    process.env.APP_ENV = 'development';
    const configFactory = require('../app.config.js');

    const result = configFactory({ config: SHIPPING_CONFIG });

    expect(result.ios.supportsTablet).toBe(true);
    expect(result.android.allowBackup).toBe(false);
  });

  test('leaves preview identity untouched', () => {
    process.env.APP_ENV = 'preview';
    const configFactory = require('../app.config.js');

    const result = configFactory({ config: SHIPPING_CONFIG });

    expect(result.name).toBe('Kilo');
    expect(result.ios.bundleIdentifier).toBe('com.benpronin.kilo');
    expect(result.android.package).toBe('com.benpronin.kilo');
  });

  test('leaves production identity untouched', () => {
    const configFactory = require('../app.config.js');

    const result = configFactory({ config: SHIPPING_CONFIG });

    expect(result.name).toBe('Kilo');
    expect(result.ios.bundleIdentifier).toBe('com.benpronin.kilo');
    expect(result.android.package).toBe('com.benpronin.kilo');
  });

  test('does not apply the preview runtime override to development builds', () => {
    process.env.APP_ENV = 'development';
    const configFactory = require('../app.config.js');

    const result = configFactory({ config: SHIPPING_CONFIG });

    expect(result.runtimeVersion).toEqual({ policy: 'appVersion' });
  });

  test('adds the Sentry plugin only when the full build env is present', () => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://public@example.ingest.sentry.io/1';
    process.env.SENTRY_ORG = 'org';
    process.env.SENTRY_PROJECT = 'project';
    process.env.SENTRY_AUTH_TOKEN = 'token';
    const configFactory = require('../app.config.js');

    const result = configFactory({ config: { plugins: ['expo-secure-store'] } });

    expect(result.plugins).toContain('expo-secure-store');
    expect(result.plugins).toContainEqual([
      '@sentry/react-native/expo',
      {
        organization: 'org',
        project: 'project',
        url: 'https://sentry.io/',
      },
    ]);
  });

  test('does not add the Sentry plugin when the runtime DSN is missing', () => {
    process.env.SENTRY_ORG = 'org';
    process.env.SENTRY_PROJECT = 'project';
    process.env.SENTRY_AUTH_TOKEN = 'token';
    const configFactory = require('../app.config.js');

    const result = configFactory({ config: { plugins: ['expo-secure-store'] } });

    expect(result.plugins).toEqual(['expo-secure-store']);
  });

  test('does not add the Sentry plugin when the auth token is missing', () => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://public@example.ingest.sentry.io/1';
    process.env.SENTRY_ORG = 'org';
    process.env.SENTRY_PROJECT = 'project';
    const configFactory = require('../app.config.js');

    const result = configFactory({ config: { plugins: ['expo-secure-store'] } });

    expect(result.plugins).toEqual(['expo-secure-store']);
  });

  // #985: dark mode is wired at the native layer. `userInterfaceStyle` must let
  // the OS drive on a cold start (System mode) and `expo-system-ui` must be a
  // real dependency so the setting actually applies on Android.
  test('static config lets the OS drive native appearance', () => {
    const appJson = require('../app.json');
    expect(appJson.expo.userInterfaceStyle).toBe('automatic');
  });

  test('expo-system-ui is pinned at an SDK-compatible version', () => {
    const pkg = require('../package.json');
    expect(pkg.dependencies['expo-system-ui']).toMatch(/^~6\.0\./);
  });

  // #1097: KUA typography requires expo-font for offline-safe bundled font loading.
  test('expo-font is declared as a direct dependency at an SDK-compatible version', () => {
    const pkg = require('../package.json');
    expect(pkg.dependencies['expo-font']).toMatch(/^~14\./);
  });

  // #1127: expo-dev-client is a direct runtime dependency and ships in all builds including production.
  // expo-dev-launcher (its native dependency) unconditionally includes play-services-code-scanner and
  // mlkit:barcode-scanning on SDK 54; there is no per-profile autolinking exclusion available.
  test('expo-dev-client is declared as a direct dependency at an SDK-54-compatible version', () => {
    const pkg = require('../package.json');
    expect(pkg.dependencies['expo-dev-client']).toMatch(/^~6\.0\./);
  });

  // #1124: R8 optimization for production AABs.
  test('expo-build-properties is declared as a direct dependency at an SDK-compatible version', () => {
    const pkg = require('../package.json');
    expect(pkg.dependencies['expo-build-properties']).toMatch(/^~1\.0\./);
  });

  test('static config registers expo-build-properties with R8 enabled for release builds', () => {
    const appJson = require('../app.json');
    const buildPropsPlugin = appJson.expo.plugins.find(
      (p) => Array.isArray(p) && p[0] === 'expo-build-properties',
    );
    expect(buildPropsPlugin).toBeDefined();
    expect(buildPropsPlugin[1].android.enableMinifyInReleaseBuilds).toBe(true);
    expect(buildPropsPlugin[1].android.enableShrinkResourcesInReleaseBuilds).toBe(true);
  });
});

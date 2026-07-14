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

    expect(result.runtimeVersion).toBe('preview-3');
  });

  test('uses the appVersion runtime policy for production builds', () => {
    const configFactory = require('../app.config.js');

    const result = configFactory({ config: { plugins: [] } });

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
});

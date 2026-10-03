describe('error reporting bootstrap', () => {
  const originalDev = global.__DEV__;
  const originalDsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://public@example.ingest.sentry.io/1';
    global.__DEV__ = false;
  });

  afterAll(() => {
    global.__DEV__ = originalDev;
    process.env.EXPO_PUBLIC_SENTRY_DSN = originalDsn;
  });

  test('skips Sentry init in development', () => {
    global.__DEV__ = true;
    const Sentry = require('@sentry/react-native');
    const { initErrorReporting } = require('../lib/errorReporting');

    expect(initErrorReporting()).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  test('skips Sentry init without a DSN', () => {
    delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    const Sentry = require('@sentry/react-native');
    const { initErrorReporting } = require('../lib/errorReporting');

    expect(initErrorReporting()).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  test('initializes Sentry without default PII and tags the Expo update context', () => {
    const Sentry = require('@sentry/react-native');
    const { initErrorReporting } = require('../lib/errorReporting');

    expect(initErrorReporting()).toBe(true);
    expect(Sentry.init).toHaveBeenCalledWith(expect.objectContaining({
      dsn: 'https://public@example.ingest.sentry.io/1',
      release: 'com.benpronin.kilo@1.8.6',
      sendDefaultPii: false,
      enableNative: false,
      enableAutoSessionTracking: false,
      tracesSampleRate: 0,
      enableLogs: false,
      beforeSend: expect.any(Function),
      beforeBreadcrumb: expect.any(Function),
    }));
    expect(Sentry.getGlobalScope().setTag).toHaveBeenCalledWith('expo-update-id', 'update-123');
    expect(Sentry.getGlobalScope().setTag).toHaveBeenCalledWith('expo-is-embedded-update', 'true');
    expect(Sentry.getGlobalScope().setTag).toHaveBeenCalledWith('expo-runtime-version', '0.88.0');
    expect(Sentry.getGlobalScope().setTag).toHaveBeenCalledWith('expo-channel', 'production');
  });

  test('disables the native event pipeline that bypasses JavaScript redaction', () => {
    const Sentry = require('@sentry/react-native');
    const { initErrorReporting } = require('../lib/errorReporting');

    initErrorReporting();

    expect(Sentry.init.mock.calls[0][0]).toEqual(expect.objectContaining({
      enableNative: false,
      release: 'com.benpronin.kilo@1.8.6',
      beforeSend: expect.any(Function),
      beforeBreadcrumb: expect.any(Function),
    }));
  });

  test('removes user-authored health data and identity from error events', () => {
    const Sentry = require('@sentry/react-native');
    const { initErrorReporting } = require('../lib/errorReporting');
    initErrorReporting();
    const { beforeSend } = Sentry.init.mock.calls[0][0];
    const sensitiveValues = [
      'Bench press felt painful today',
      '225 lb',
      '94.6 kg',
      'alice@example.com',
      'Bearer eyJhbGciOiJIUzI1NiJ9.private',
      'refresh_token=private-token',
      'cookie=session_id%3Dprivate-session',
      'https://alice:private@example.test/workout?token=private#credential',
      '/Users/alice/Library/Application Support/Kilo/private.js',
    ];

    const redacted = beforeSend({
      event_id: '0123456789abcdef0123456789abcdef',
      timestamp: 42,
      platform: 'javascript',
      level: 'error',
      release: 'com.benpronin.kilo@1.8.6+12',
      message: sensitiveValues[0],
      transaction: sensitiveValues[1],
      logger: sensitiveValues[2],
      user: { id: sensitiveValues[6], email: sensitiveValues[3] },
      request: {
        url: sensitiveValues[7],
        headers: { Authorization: sensitiveValues[4], Cookie: sensitiveValues[6] },
        cookies: { refresh_token: sensitiveValues[5] },
        data: sensitiveValues[0],
      },
      contexts: { workout: { weight: sensitiveValues[1], measurement: sensitiveValues[2] } },
      extra: { health: sensitiveValues[0], token: sensitiveValues[5] },
      fingerprint: [sensitiveValues[3]],
      tags: {
        workout: sensitiveValues[0],
        'expo-channel': 'production',
        'expo-update-id': 'update-123',
        'expo-runtime-version': 'production-12',
      },
      exception: {
        values: [{
          type: 'TypeError',
          value: sensitiveValues[0],
          mechanism: { type: 'generic', handled: true, data: { note: sensitiveValues[0] } },
          stacktrace: {
            frames: [{
              filename: sensitiveValues[8],
              abs_path: sensitiveValues[8],
              context_line: sensitiveValues[0],
              vars: { note: sensitiveValues[0] },
              function: 'saveWorkout',
              lineno: 81,
              colno: 7,
              in_app: true,
            }],
          },
        }],
      },
      breadcrumbs: [{
        type: 'http',
        category: 'fetch',
        level: 'info',
        timestamp: 41,
        message: sensitiveValues[0],
        data: { url: sensitiveValues[7], requestBody: sensitiveValues[0] },
      }],
    });

    for (const sensitiveValue of sensitiveValues) {
      expect(JSON.stringify(redacted)).not.toContain(sensitiveValue);
    }
    expect(redacted).toEqual({
      event_id: '0123456789abcdef0123456789abcdef',
      timestamp: 42,
      platform: 'javascript',
      level: 'error',
      release: 'com.benpronin.kilo@1.8.6+12',
      exception: {
        values: [{
          type: 'TypeError',
          value: '[redacted]',
          mechanism: { type: 'generic', handled: true },
          stacktrace: {
            frames: [{ function: 'saveWorkout', lineno: 81, colno: 7, in_app: true }],
          },
        }],
      },
      breadcrumbs: [{ type: 'http', category: 'fetch', level: 'info', timestamp: 41 }],
      tags: {
        'expo-update-id': 'update-123',
        'expo-runtime-version': 'production-12',
        'expo-channel': 'production',
      },
    });
  });

  test('drops unrecognized breadcrumbs and strips breadcrumb free text and data', () => {
    const Sentry = require('@sentry/react-native');
    const { initErrorReporting } = require('../lib/errorReporting');
    initErrorReporting();
    const { beforeBreadcrumb } = Sentry.init.mock.calls[0][0];

    expect(beforeBreadcrumb({
      type: 'http',
      category: 'fetch',
      level: 'info',
      timestamp: 12,
      message: 'Workout note',
      data: { url: 'https://example.test/private' },
    })).toEqual({ type: 'http', category: 'fetch', level: 'info', timestamp: 12 });
    expect(beforeBreadcrumb({ type: 'custom', category: 'workout', message: 'Workout note' })).toBeNull();
  });

  test('wrapRootComponent delegates to Sentry.wrap', () => {
    const Sentry = require('@sentry/react-native');
    const { wrapRootComponent } = require('../lib/errorReporting');
    const App = () => null;

    expect(wrapRootComponent(App)).toBe(Sentry.wrap.mock.results[0].value);
    expect(Sentry.wrap).toHaveBeenCalledWith(App);
  });
});

jest.mock('@sentry/react-native', () => {
  const setTag = jest.fn();
  return {
    init: jest.fn(),
    wrap: jest.fn((Component) => Component),
    getGlobalScope: jest.fn(() => ({ setTag })),
  };
});

jest.mock('expo-updates', () => ({
  updateId: 'update-123',
  isEmbeddedLaunch: true,
  runtimeVersion: '0.88.0',
  channel: 'production',
}));

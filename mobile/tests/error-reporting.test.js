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
    expect(Sentry.init).toHaveBeenCalledWith({
      dsn: 'https://public@example.ingest.sentry.io/1',
      sendDefaultPii: false,
      enableAutoSessionTracking: false,
    });
    expect(Sentry.getGlobalScope().setTag).toHaveBeenCalledWith('expo-update-id', 'update-123');
    expect(Sentry.getGlobalScope().setTag).toHaveBeenCalledWith('expo-is-embedded-update', 'true');
    expect(Sentry.getGlobalScope().setTag).toHaveBeenCalledWith('expo-runtime-version', '0.88.0');
    expect(Sentry.getGlobalScope().setTag).toHaveBeenCalledWith('expo-channel', 'production');
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

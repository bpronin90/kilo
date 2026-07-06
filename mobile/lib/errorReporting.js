import * as Sentry from '@sentry/react-native';
import * as Updates from 'expo-updates';

const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

function applyExpoUpdateTags() {
  const scope = Sentry.getGlobalScope();
  if (Updates.updateId) {
    scope.setTag('expo-update-id', Updates.updateId);
  }
  scope.setTag('expo-is-embedded-update', String(Boolean(Updates.isEmbeddedLaunch)));
  if (Updates.runtimeVersion) {
    scope.setTag('expo-runtime-version', String(Updates.runtimeVersion));
  }
  if (typeof Updates.channel === 'string' && Updates.channel) {
    scope.setTag('expo-channel', Updates.channel);
  }
}

export function initErrorReporting() {
  if (__DEV__ || !SENTRY_DSN) {
    return false;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    sendDefaultPii: false,
    enableAutoSessionTracking: false,
  });
  applyExpoUpdateTags();
  return true;
}

export function wrapRootComponent(Component) {
  return Sentry.wrap(Component);
}

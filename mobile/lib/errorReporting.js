import * as Sentry from '@sentry/react-native';
import * as Updates from 'expo-updates';
import appConfig from '../app.json';

const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
const APP_RELEASE = `${appConfig.expo.android.package}@${appConfig.expo.version}`;
const REDACTED = '[redacted]';
const SAFE_LEVELS = new Set(['fatal', 'error', 'warning', 'log', 'info', 'debug']);
const SAFE_ERROR_TYPES = new Set([
  'AggregateError',
  'Error',
  'EvalError',
  'InternalError',
  'JavaScriptError',
  'NSException',
  'NSError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
  'UnhandledRejection',
]);
const SAFE_MECHANISM_TYPES = new Set([
  'generic',
  'handled',
  'instrument',
  'native',
  'onerror',
  'onunhandledrejection',
  'react',
]);
const SAFE_BREADCRUMB_TYPES = new Set([
  'default',
  'debug',
  'error',
  'info',
  'navigation',
  'http',
  'query',
  'transaction',
  'ui',
  'user',
]);
const SAFE_BREADCRUMB_CATEGORIES = new Set([
  'app.lifecycle',
  'console',
  'device.event',
  'fetch',
  'http',
  'navigation',
  'sentry.event',
  'sentry.transaction',
  'ui.click',
  'xhr',
]);
const SAFE_EXPO_TAGS = new Set([
  'expo-update-id',
  'expo-is-embedded-update',
  'expo-runtime-version',
  'expo-channel',
]);

function boundedString(value, pattern, maxLength) {
  if (typeof value !== 'string' || value.length > maxLength || !pattern.test(value)) {
    return undefined;
  }
  return value;
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function safeRelease(value) {
  return boundedString(
    value,
    /^[A-Za-z][A-Za-z0-9_.-]{0,79}@[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9_.-]+)?$/,
    128,
  );
}

function redactStacktrace(stacktrace) {
  if (!stacktrace || !Array.isArray(stacktrace.frames)) {
    return undefined;
  }

  return {
    frames: stacktrace.frames.slice(-50).map((frame) => ({
      function: boundedString(frame.function, /^[A-Za-z0-9_$.[\]<> -]+$/, 160),
      lineno: finiteNumber(frame.lineno),
      colno: finiteNumber(frame.colno),
      in_app: typeof frame.in_app === 'boolean' ? frame.in_app : undefined,
    })),
  };
}

function redactExceptions(exception) {
  if (!exception || !Array.isArray(exception.values)) {
    return undefined;
  }

  return {
    values: exception.values.slice(0, 10).map((value) => ({
      type: SAFE_ERROR_TYPES.has(value.type) ? value.type : 'Error',
      value: REDACTED,
      mechanism: value.mechanism
        ? {
            type: SAFE_MECHANISM_TYPES.has(value.mechanism.type) ? value.mechanism.type : undefined,
            handled: typeof value.mechanism.handled === 'boolean' ? value.mechanism.handled : undefined,
          }
        : undefined,
      stacktrace: redactStacktrace(value.stacktrace),
    })),
  };
}

function redactTags(tags) {
  if (!tags || typeof tags !== 'object') {
    return undefined;
  }

  const safeTags = {};
  for (const key of SAFE_EXPO_TAGS) {
    const value = boundedString(tags[key], /^[A-Za-z0-9_.:@/-]+$/, 128);
    if (value !== undefined) {
      safeTags[key] = value;
    }
  }
  return Object.keys(safeTags).length > 0 ? safeTags : undefined;
}

function redactBreadcrumb(breadcrumb) {
  if (!breadcrumb || typeof breadcrumb !== 'object') {
    return null;
  }

  const type = SAFE_BREADCRUMB_TYPES.has(breadcrumb.type) ? breadcrumb.type : undefined;
  const category = SAFE_BREADCRUMB_CATEGORIES.has(breadcrumb.category) ? breadcrumb.category : undefined;
  const level = SAFE_LEVELS.has(breadcrumb.level) ? breadcrumb.level : undefined;
  const timestamp = finiteNumber(breadcrumb.timestamp);

  if (!type && !category && !level && timestamp === undefined) {
    return null;
  }

  return { type, category, level, timestamp };
}

function redactEvent(event) {
  const breadcrumbs = Array.isArray(event.breadcrumbs)
    ? event.breadcrumbs.map(redactBreadcrumb).filter(Boolean).slice(-50)
    : undefined;

  return {
    event_id: boundedString(event.event_id, /^[a-fA-F0-9]{32}$/, 32),
    timestamp: finiteNumber(event.timestamp),
    platform: boundedString(event.platform, /^[A-Za-z0-9_.-]+$/, 32),
    level: SAFE_LEVELS.has(event.level) ? event.level : undefined,
    release: safeRelease(event.release),
    exception: redactExceptions(event.exception),
    breadcrumbs: breadcrumbs && breadcrumbs.length > 0 ? breadcrumbs : undefined,
    tags: redactTags(event.tags),
  };
}

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
    release: APP_RELEASE,
    sendDefaultPii: false,
    // Native events do not pass through the JavaScript redaction hooks below.
    // Keep the native SDK disabled until equivalent native filtering exists.
    enableNative: false,
    enableAutoSessionTracking: false,
    tracesSampleRate: 0,
    enableLogs: false,
    beforeSend: redactEvent,
    beforeBreadcrumb: redactBreadcrumb,
  });
  applyExpoUpdateTags();
  return true;
}

export function wrapRootComponent(Component) {
  return Sentry.wrap(Component);
}

import AsyncStorage from '@react-native-async-storage/async-storage';

const CONSENT_KEY = 'kilo.productMeasurement.consent.v1';
const EVENTS_KEY = 'kilo.productMeasurement.events.v1';
const MAX_BUFFERED_EVENTS = 500;

export const PRODUCT_MEASUREMENT_EVENTS = Object.freeze({
  TAB_VIEWED: 'tab_viewed',
  WORKOUT_SAVE_ATTEMPTED: 'workout_save_attempted',
  WORKOUT_SAVE_COMPLETED: 'workout_save_completed',
  WEIGHT_SAVE_ATTEMPTED: 'weight_save_attempted',
  WEIGHT_SAVE_COMPLETED: 'weight_save_completed',
  PARSE_WARNING_SUMMARY: 'parse_warning_summary',
  ANALYTICS_VIEWED: 'analytics_viewed',
});

const EVENT_SCHEMAS = Object.freeze({
  tab_viewed: { tab: ['Home', 'Log', 'Weight', 'Analytics', 'More'] },
  workout_save_attempted: {},
  workout_save_completed: { ok: 'boolean', duration_ms: 'duration', warning_count: 'count' },
  weight_save_attempted: {},
  weight_save_completed: { ok: 'boolean', duration_ms: 'duration' },
  parse_warning_summary: { warning_count: 'count' },
  analytics_viewed: { section: ['overview', 'strength', 'weight', 'other'] },
});

function sanitizeValue(rule, value) {
  if (Array.isArray(rule)) return rule.includes(value) ? value : undefined;
  if (rule === 'boolean') return typeof value === 'boolean' ? value : undefined;
  if (rule === 'count') {
    return Number.isInteger(value) && value >= 0 && value <= 10000 ? value : undefined;
  }
  if (rule === 'duration') {
    return Number.isFinite(value) && value >= 0 && value <= 3600000 ? Math.round(value) : undefined;
  }
  return undefined;
}

export function sanitizeMeasurementEvent(name, properties = {}) {
  if (!Object.prototype.hasOwnProperty.call(EVENT_SCHEMAS, name)) {
    return null;
  }
  const schema = EVENT_SCHEMAS[name];
  if (!schema || !properties || Array.isArray(properties) || typeof properties !== 'object') {
    return null;
  }

  const sanitized = {};
  for (const [key, rule] of Object.entries(schema)) {
    const value = sanitizeValue(rule, properties[key]);
    if (value !== undefined) sanitized[key] = value;
  }

  return { name, properties: sanitized };
}

export async function getProductMeasurementConsent() {
  return (await AsyncStorage.getItem(CONSENT_KEY)) === 'granted';
}

export async function setProductMeasurementConsent(enabled) {
  if (!enabled) {
    await AsyncStorage.multiRemove([CONSENT_KEY, EVENTS_KEY]);
    return false;
  }
  await AsyncStorage.setItem(CONSENT_KEY, 'granted');
  return true;
}

export async function recordProductMeasurement(name, properties = {}, now = Date.now()) {
  if (!(await getProductMeasurementConsent())) return false;

  const sanitized = sanitizeMeasurementEvent(name, properties);
  if (!sanitized) return false;

  const raw = await AsyncStorage.getItem(EVENTS_KEY);
  let events = [];
  try {
    events = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(events)) events = [];
  } catch {
    events = [];
  }

  events.push({ ...sanitized, recorded_at_ms: Math.round(now) });
  if (events.length > MAX_BUFFERED_EVENTS) {
    events = events.slice(events.length - MAX_BUFFERED_EVENTS);
  }
  await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify(events));
  return true;
}

export async function readBufferedProductMeasurements() {
  const raw = await AsyncStorage.getItem(EVENTS_KEY);
  if (!raw) return [];
  try {
    const events = JSON.parse(raw);
    return Array.isArray(events) ? events : [];
  } catch {
    return [];
  }
}

export async function clearBufferedProductMeasurements() {
  await AsyncStorage.removeItem(EVENTS_KEY);
}

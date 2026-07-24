import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabaseClient } from './supabaseClient';

const CONSENT_KEY = 'kilo.productMeasurement.consent.v1';
const EVENTS_KEY = 'kilo.productMeasurement.events.v1';
const INSTALL_ID_KEY = 'kilo.productMeasurement.installId.v1';
const DELETION_TOKEN_KEY = 'kilo.productMeasurement.deletionToken.v1';
const MAX_BUFFERED_EVENTS = 500;
const IDENTIFIER_BYTES = 16;

// Transport tuning for flushBufferedProductMeasurements. One flush call sends
// at most MAX_FLUSH_BATCH events (oldest first) so a huge backlog cannot block
// the caller for long; anything beyond the batch, plus anything that could not
// be sent, stays buffered for the next flush.
const MAX_FLUSH_BATCH = 50;
const MAX_SEND_ATTEMPTS = 5;
const BASE_RETRY_DELAY_MS = 500;

// kilo.record_product_measurement_event (supabase/migrations/20260724120000_
// product_measurement_events.sql) re-validates event name, install id, and
// every property server-side. A network/5xx failure is transient and worth
// retrying; a validation error raised by the RPC (unknown event name, bad
// install id, bad recorded_at) can never succeed no matter how many times it
// is retried, so those events are dropped rather than retried forever. This
// should not happen in practice since the client sanitizer already enforces
// the same allow-list before an event is ever buffered, but it is defense in
// depth against a stale client or a future server allow-list change.
const PERMANENT_REJECTION_MESSAGES = ['unknown event name', 'invalid install id', 'invalid recorded_at'];

function isPermanentRejection(error) {
  if (!error || typeof error.message !== 'string') return false;
  const message = error.message.toLowerCase();
  return PERMANENT_REJECTION_MESSAGES.some((needle) => message.includes(needle));
}

function defaultSleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// Emit a random, PII-free hex identifier. It is never derived from any
// account, device, or health data. Strong randomness is used when the runtime
// exposes a Web Crypto source; otherwise a Math.random fallback keeps the value
// random and unlinkable, which is sufficient for an attribution id and a
// deletion token that carry no personal data.
function randomHex(byteLength = IDENTIFIER_BYTES) {
  const bytes = new Uint8Array(byteLength);
  const cryptoSource = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoSource && typeof cryptoSource.getRandomValues === 'function') {
    cryptoSource.getRandomValues(bytes);
  } else {
    for (let i = 0; i < byteLength; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

async function ensurePersistedIdentifier(key) {
  const existing = await AsyncStorage.getItem(key);
  if (typeof existing === 'string' && existing.length > 0) {
    return existing;
  }
  const value = randomHex();
  await AsyncStorage.setItem(key, value);
  return value;
}

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
    // Clear the install id and deletion token alongside consent and the buffer.
    // The next accessor call regenerates fresh, unlinkable values, so a later
    // opt-in cannot be tied back to the previous install.
    await AsyncStorage.multiRemove([CONSENT_KEY, EVENTS_KEY, INSTALL_ID_KEY, DELETION_TOKEN_KEY]);
    return false;
  }
  await AsyncStorage.setItem(CONSENT_KEY, 'granted');
  return true;
}

// Random, persisted identifier used to attribute aggregate events to an install
// without any PII. Generated on first use. Never derived from account, device,
// or health data, and never included in event payloads.
export async function getProductMeasurementInstallId() {
  return ensurePersistedIdentifier(INSTALL_ID_KEY);
}

// Random, persisted deletion token, independent of the install id, that a later
// transport/erasure follow-up can present to erase this install's aggregate
// events. Generated on first use and never included in event payloads.
export async function getProductMeasurementDeletionToken() {
  return ensurePersistedIdentifier(DELETION_TOKEN_KEY);
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

// Sends one buffered event via the validated RPC, retrying transient failures
// with exponential backoff. Returns:
//   'sent'    - the server persisted the event
//   'dropped' - the server permanently rejected it (never retried)
//   'kept'    - throttled by the server's per-install rate limit, or every
//               retry attempt failed transiently; left buffered for a later
//               flush call
async function sendBufferedEventWithRetry(client, installId, event, sleepFn) {
  for (let attempt = 0; attempt < MAX_SEND_ATTEMPTS; attempt += 1) {
    let data;
    let error;
    try {
      // eslint-disable-next-line no-await-in-loop
      ({ data, error } = await client.rpc('record_product_measurement_event', {
        p_install_id: installId,
        p_event_name: event.name,
        p_properties: event.properties,
        p_client_recorded_at_ms: event.recorded_at_ms,
      }));
    } catch (networkError) {
      error = networkError;
    }

    if (!error) {
      // data === true: persisted. data === false: the server's per-install
      // rate limit throttled this request — not an error, but retrying it
      // immediately within the same window would just be throttled again, so
      // it is left buffered for a later flush instead.
      return data === true ? 'sent' : 'kept';
    }

    if (isPermanentRejection(error)) {
      return 'dropped';
    }

    if (attempt < MAX_SEND_ATTEMPTS - 1) {
      // eslint-disable-next-line no-await-in-loop
      await sleepFn(BASE_RETRY_DELAY_MS * 2 ** attempt);
    }
  }
  return 'kept';
}

// Flushes buffered measurement events to Supabase, oldest first, up to
// MAX_FLUSH_BATCH per call. Requires consent AND Supabase configuration:
//   - No consent: nothing is sent, buffer is untouched (mirrors
//     recordProductMeasurement's own consent gate).
//   - Consent granted but Supabase is not configured (signed-out/local-only
//     use, or no EXPO_PUBLIC_SUPABASE_URL/ANON_KEY): returns immediately with
//     no network call of any kind, so local-only use keeps working exactly as
//     documented in docs/product-measurement.md.
// Successfully sent and permanently rejected events are removed from the
// buffer; throttled or transiently-failed events remain buffered for the next
// call. Returns { flushed, dropped, kept } counts.
export async function flushBufferedProductMeasurements({ sleepFn = defaultSleep } = {}) {
  if (!(await getProductMeasurementConsent())) {
    return { flushed: 0, dropped: 0, kept: 0 };
  }

  const client = getSupabaseClient();
  if (!client) {
    return { flushed: 0, dropped: 0, kept: 0 };
  }

  const events = await readBufferedProductMeasurements();
  if (events.length === 0) {
    return { flushed: 0, dropped: 0, kept: 0 };
  }

  const batch = events.slice(0, MAX_FLUSH_BATCH);
  const overflow = events.slice(MAX_FLUSH_BATCH);
  const installId = await getProductMeasurementInstallId();

  let flushed = 0;
  let dropped = 0;
  const remaining = [];

  for (const event of batch) {
    // eslint-disable-next-line no-await-in-loop
    const outcome = await sendBufferedEventWithRetry(client, installId, event, sleepFn);
    if (outcome === 'sent') {
      flushed += 1;
    } else if (outcome === 'dropped') {
      dropped += 1;
    } else {
      remaining.push(event);
    }
  }

  const nextBuffer = [...remaining, ...overflow];
  if (nextBuffer.length > 0) {
    await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify(nextBuffer));
  } else {
    await AsyncStorage.removeItem(EVENTS_KEY);
  }

  return { flushed, dropped, kept: remaining.length };
}

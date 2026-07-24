import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PRODUCT_MEASUREMENT_EVENTS,
  clearBufferedProductMeasurements,
  getProductMeasurementConsent,
  readBufferedProductMeasurements,
  recordProductMeasurement,
  sanitizeMeasurementEvent,
  setProductMeasurementConsent,
} from '../lib/productMeasurement';

describe('product measurement', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  test('is disabled by default', async () => {
    expect(await getProductMeasurementConsent()).toBe(false);
    expect(await recordProductMeasurement(PRODUCT_MEASUREMENT_EVENTS.TAB_VIEWED, { tab: 'Log' })).toBe(false);
    expect(await readBufferedProductMeasurements()).toEqual([]);
  });

  test('accepts only allow-listed names and bounded fields', () => {
    expect(sanitizeMeasurementEvent('unknown', {})).toBeNull();
    expect(sanitizeMeasurementEvent(PRODUCT_MEASUREMENT_EVENTS.WORKOUT_SAVE_COMPLETED, {
      ok: true,
      duration_ms: 1234.4,
      warning_count: 2,
      raw_text: 'bench 225x5',
      weight: 190,
      email: 'person@example.com',
    })).toEqual({
      name: PRODUCT_MEASUREMENT_EVENTS.WORKOUT_SAVE_COMPLETED,
      properties: { ok: true, duration_ms: 1234, warning_count: 2 },
    });
  });

  test('rejects inherited prototype names', async () => {
    expect(sanitizeMeasurementEvent('__proto__', {})).toBeNull();
    expect(sanitizeMeasurementEvent('toString', {})).toBeNull();
    expect(sanitizeMeasurementEvent('constructor', {})).toBeNull();
    expect(sanitizeMeasurementEvent('hasOwnProperty', {})).toBeNull();

    await setProductMeasurementConsent(true);
    expect(await recordProductMeasurement('__proto__', {})).toBe(false);
    expect(await readBufferedProductMeasurements()).toEqual([]);
  });

  test('drops invalid and unbounded values', () => {
    expect(sanitizeMeasurementEvent(PRODUCT_MEASUREMENT_EVENTS.WORKOUT_SAVE_COMPLETED, {
      ok: 'yes',
      duration_ms: 99999999,
      warning_count: -1,
    })).toEqual({
      name: PRODUCT_MEASUREMENT_EVENTS.WORKOUT_SAVE_COMPLETED,
      properties: {},
    });
  });

  test('buffers sanitized events only after opt-in', async () => {
    await setProductMeasurementConsent(true);
    expect(await recordProductMeasurement(PRODUCT_MEASUREMENT_EVENTS.TAB_VIEWED, {
      tab: 'Analytics',
      arbitrary: 'discard me',
    }, 12345)).toBe(true);

    expect(await readBufferedProductMeasurements()).toEqual([{
      name: PRODUCT_MEASUREMENT_EVENTS.TAB_VIEWED,
      properties: { tab: 'Analytics' },
      recorded_at_ms: 12345,
    }]);
  });

  test('revoking consent clears consent and buffered events', async () => {
    await setProductMeasurementConsent(true);
    await recordProductMeasurement(PRODUCT_MEASUREMENT_EVENTS.ANALYTICS_VIEWED, { section: 'strength' });

    await setProductMeasurementConsent(false);

    expect(await getProductMeasurementConsent()).toBe(false);
    expect(await readBufferedProductMeasurements()).toEqual([]);
  });

  test('buffer can be cleared without changing consent', async () => {
    await setProductMeasurementConsent(true);
    await recordProductMeasurement(PRODUCT_MEASUREMENT_EVENTS.WEIGHT_SAVE_ATTEMPTED);
    await clearBufferedProductMeasurements();

    expect(await getProductMeasurementConsent()).toBe(true);
    expect(await readBufferedProductMeasurements()).toEqual([]);
  });
});

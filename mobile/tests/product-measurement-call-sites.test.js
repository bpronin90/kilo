import AsyncStorage from '@react-native-async-storage/async-storage';
import { emitMeasurement, analyticsSectionVariant } from '../App';
import {
  PRODUCT_MEASUREMENT_EVENTS,
  getProductMeasurementConsent,
  readBufferedProductMeasurements,
  setProductMeasurementConsent,
} from '../lib/productMeasurement';

// Flush the microtask queue so the fire-and-forget emit helper's chained
// promise resolves before assertions run.
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('product measurement call sites', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  test('emitMeasurement is non-blocking and no-ops when consent is off', async () => {
    expect(await getProductMeasurementConsent()).toBe(false);
    // Returns undefined synchronously (fire-and-forget), never throws.
    expect(emitMeasurement(PRODUCT_MEASUREMENT_EVENTS.TAB_VIEWED, { tab: 'Log' })).toBeUndefined();
    await flush();
    expect(await readBufferedProductMeasurements()).toEqual([]);
  });

  test('emitMeasurement routes tab views through the sanitizer after opt-in', async () => {
    await setProductMeasurementConsent(true);
    emitMeasurement(PRODUCT_MEASUREMENT_EVENTS.TAB_VIEWED, { tab: 'Weight', pii: 'drop me' });
    await flush();
    const events = await readBufferedProductMeasurements();
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe(PRODUCT_MEASUREMENT_EVENTS.TAB_VIEWED);
    // Unknown fields are stripped by the sanitizer, not passed through.
    expect(events[0].properties).toEqual({ tab: 'Weight' });
  });

  test('emitMeasurement drops off-list tab values via the sanitizer', async () => {
    await setProductMeasurementConsent(true);
    emitMeasurement(PRODUCT_MEASUREMENT_EVENTS.TAB_VIEWED, { tab: 'NotARealTab' });
    await flush();
    const events = await readBufferedProductMeasurements();
    expect(events).toHaveLength(1);
    expect(events[0].properties).toEqual({});
  });

  test('emitMeasurement records bounded workout save outcome fields', async () => {
    await setProductMeasurementConsent(true);
    emitMeasurement(PRODUCT_MEASUREMENT_EVENTS.WORKOUT_SAVE_COMPLETED, {
      ok: true,
      duration_ms: 42.7,
      warning_count: 3,
      raw_text: 'bench 225x5',
    });
    await flush();
    const events = await readBufferedProductMeasurements();
    expect(events).toHaveLength(1);
    expect(events[0].properties).toEqual({ ok: true, duration_ms: 43, warning_count: 3 });
  });

  test('analyticsSectionVariant maps navigation sections to the allow-listed variants', () => {
    expect(analyticsSectionVariant(null)).toBe('overview');
    expect(analyticsSectionVariant(undefined)).toBe('overview');
    expect(analyticsSectionVariant('strength')).toBe('strength');
    expect(analyticsSectionVariant('weight')).toBe('weight');
    expect(analyticsSectionVariant('mystery')).toBe('other');
  });

  test('mapped analytics_viewed sections survive the sanitizer', async () => {
    await setProductMeasurementConsent(true);
    // Space the emits (each is an independent async read-modify-write of the
    // buffer) the way distinct navigation events arrive at runtime.
    for (const section of [null, 'strength', 'weight', 'mystery']) {
      emitMeasurement(PRODUCT_MEASUREMENT_EVENTS.ANALYTICS_VIEWED, {
        section: analyticsSectionVariant(section),
      });
      await flush();
    }
    const events = await readBufferedProductMeasurements();
    expect(events.map((e) => e.properties.section)).toEqual([
      'overview',
      'strength',
      'weight',
      'other',
    ]);
  });
});

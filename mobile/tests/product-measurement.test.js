import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PRODUCT_MEASUREMENT_EVENTS,
  clearBufferedProductMeasurements,
  flushBufferedProductMeasurements,
  getProductMeasurementConsent,
  getProductMeasurementDeletionToken,
  getProductMeasurementInstallId,
  readBufferedProductMeasurements,
  recordProductMeasurement,
  sanitizeMeasurementEvent,
  setProductMeasurementConsent,
} from '../lib/productMeasurement';
import { getSupabaseClient } from '../lib/supabaseClient';

jest.mock('../lib/supabaseClient', () => ({ getSupabaseClient: jest.fn() }));

const noopSleep = () => Promise.resolve();

describe('product measurement', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    getSupabaseClient.mockReset();
    getSupabaseClient.mockReturnValue(null);
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

  test('install id and deletion token are random, distinct, and persisted', async () => {
    const installId = await getProductMeasurementInstallId();
    const deletionToken = await getProductMeasurementDeletionToken();

    expect(installId).toMatch(/^[0-9a-f]{32}$/);
    expect(deletionToken).toMatch(/^[0-9a-f]{32}$/);
    expect(installId).not.toBe(deletionToken);

    // Stable across reads (persisted, not regenerated per call).
    expect(await getProductMeasurementInstallId()).toBe(installId);
    expect(await getProductMeasurementDeletionToken()).toBe(deletionToken);
  });

  test('identifiers never appear in buffered event payloads', async () => {
    await setProductMeasurementConsent(true);
    const installId = await getProductMeasurementInstallId();
    const deletionToken = await getProductMeasurementDeletionToken();

    await recordProductMeasurement(PRODUCT_MEASUREMENT_EVENTS.TAB_VIEWED, {
      tab: 'Home',
      install_id: installId,
      deletion_token: deletionToken,
    });

    const buffered = await readBufferedProductMeasurements();
    const serialized = JSON.stringify(buffered);
    expect(serialized).not.toContain(installId);
    expect(serialized).not.toContain(deletionToken);
    expect(buffered).toEqual([{
      name: PRODUCT_MEASUREMENT_EVENTS.TAB_VIEWED,
      properties: { tab: 'Home' },
      recorded_at_ms: expect.any(Number),
    }]);
  });

  test('revoking consent clears and regenerates both identifiers', async () => {
    await setProductMeasurementConsent(true);
    const installId = await getProductMeasurementInstallId();
    const deletionToken = await getProductMeasurementDeletionToken();

    await setProductMeasurementConsent(false);

    expect(await AsyncStorage.getItem('kilo.productMeasurement.installId.v1')).toBeNull();
    expect(await AsyncStorage.getItem('kilo.productMeasurement.deletionToken.v1')).toBeNull();

    const nextInstallId = await getProductMeasurementInstallId();
    const nextDeletionToken = await getProductMeasurementDeletionToken();
    expect(nextInstallId).not.toBe(installId);
    expect(nextDeletionToken).not.toBe(deletionToken);
  });

  describe('flushBufferedProductMeasurements', () => {
    test('does not send anything without consent, even if Supabase is configured', async () => {
      const rpc = jest.fn();
      getSupabaseClient.mockReturnValue({ rpc });

      await AsyncStorage.setItem('kilo.productMeasurement.events.v1', JSON.stringify([
        { name: PRODUCT_MEASUREMENT_EVENTS.TAB_VIEWED, properties: { tab: 'Home' }, recorded_at_ms: 1 },
      ]));

      const result = await flushBufferedProductMeasurements({ sleepFn: noopSleep });

      expect(result).toEqual({ flushed: 0, dropped: 0, kept: 0 });
      expect(rpc).not.toHaveBeenCalled();
    });

    test('signed-out/local-only use requires no network: consent granted but Supabase unconfigured', async () => {
      await setProductMeasurementConsent(true);
      await recordProductMeasurement(PRODUCT_MEASUREMENT_EVENTS.TAB_VIEWED, { tab: 'Home' });
      getSupabaseClient.mockReturnValue(null);

      const result = await flushBufferedProductMeasurements({ sleepFn: noopSleep });

      expect(result).toEqual({ flushed: 0, dropped: 0, kept: 0 });
      expect(await readBufferedProductMeasurements()).toHaveLength(1);
    });

    test('flushes buffered events and clears them once sent', async () => {
      await setProductMeasurementConsent(true);
      await recordProductMeasurement(PRODUCT_MEASUREMENT_EVENTS.TAB_VIEWED, { tab: 'Home' }, 1);
      await recordProductMeasurement(PRODUCT_MEASUREMENT_EVENTS.WEIGHT_SAVE_ATTEMPTED, {}, 2);
      const installId = await getProductMeasurementInstallId();

      const rpc = jest.fn().mockResolvedValue({ data: true, error: null });
      getSupabaseClient.mockReturnValue({ rpc });

      const result = await flushBufferedProductMeasurements({ sleepFn: noopSleep });

      expect(result).toEqual({ flushed: 2, dropped: 0, kept: 0 });
      expect(await readBufferedProductMeasurements()).toEqual([]);
      expect(rpc).toHaveBeenCalledTimes(2);
      expect(rpc).toHaveBeenNthCalledWith(1, 'record_product_measurement_event', {
        p_install_id: installId,
        p_event_name: PRODUCT_MEASUREMENT_EVENTS.TAB_VIEWED,
        p_properties: { tab: 'Home' },
        p_client_recorded_at_ms: 1,
      });
    });

    test('retries a transient failure with backoff, then succeeds', async () => {
      await setProductMeasurementConsent(true);
      await recordProductMeasurement(PRODUCT_MEASUREMENT_EVENTS.WEIGHT_SAVE_ATTEMPTED, {}, 5);

      const rpc = jest.fn()
        .mockResolvedValueOnce({ data: null, error: new Error('network error') })
        .mockResolvedValueOnce({ data: null, error: new Error('network error') })
        .mockResolvedValueOnce({ data: true, error: null });
      getSupabaseClient.mockReturnValue({ rpc });

      const sleepFn = jest.fn().mockResolvedValue(undefined);
      const result = await flushBufferedProductMeasurements({ sleepFn });

      expect(result).toEqual({ flushed: 1, dropped: 0, kept: 0 });
      expect(rpc).toHaveBeenCalledTimes(3);
      expect(sleepFn).toHaveBeenCalledTimes(2);
      expect(await readBufferedProductMeasurements()).toEqual([]);
    });

    test('keeps an event buffered after every retry attempt fails transiently', async () => {
      await setProductMeasurementConsent(true);
      await recordProductMeasurement(PRODUCT_MEASUREMENT_EVENTS.WEIGHT_SAVE_ATTEMPTED, {}, 9);

      const rpc = jest.fn().mockResolvedValue({ data: null, error: new Error('service unavailable') });
      getSupabaseClient.mockReturnValue({ rpc });

      const result = await flushBufferedProductMeasurements({ sleepFn: noopSleep });

      expect(result).toEqual({ flushed: 0, dropped: 0, kept: 1 });
      expect(rpc).toHaveBeenCalledTimes(5);
      expect(await readBufferedProductMeasurements()).toHaveLength(1);
    });

    test('drops an event on permanent server rejection instead of retrying', async () => {
      await setProductMeasurementConsent(true);
      await recordProductMeasurement(PRODUCT_MEASUREMENT_EVENTS.WEIGHT_SAVE_ATTEMPTED, {}, 3);

      const rpc = jest.fn().mockResolvedValue({ data: null, error: new Error('unknown event name') });
      getSupabaseClient.mockReturnValue({ rpc });

      const result = await flushBufferedProductMeasurements({ sleepFn: noopSleep });

      expect(result).toEqual({ flushed: 0, dropped: 1, kept: 0 });
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(await readBufferedProductMeasurements()).toEqual([]);
    });

    test('keeps a throttled event buffered without retrying immediately', async () => {
      await setProductMeasurementConsent(true);
      await recordProductMeasurement(PRODUCT_MEASUREMENT_EVENTS.WEIGHT_SAVE_ATTEMPTED, {}, 7);

      const rpc = jest.fn().mockResolvedValue({ data: false, error: null });
      getSupabaseClient.mockReturnValue({ rpc });

      const result = await flushBufferedProductMeasurements({ sleepFn: noopSleep });

      expect(result).toEqual({ flushed: 0, dropped: 0, kept: 1 });
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(await readBufferedProductMeasurements()).toHaveLength(1);
    });
  });
});

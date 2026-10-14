import {
  createDeviceStorage,
  DEVICE_DATA_ENVELOPE_PREFIX,
  DEVICE_DATA_KEY_NAME,
  EncryptedStorageError,
  DeviceKeyUnavailableError,
  DEVICE_DATA_KEY_CHECK_NAME,
} from '../storage/secureStorage';
import { RECOVERY_JOURNAL_KEY, sealEnvelope } from '../storage/deviceKeyRecovery';
import { hexToBytes } from '@noble/ciphers/utils';

function makeBackingStore(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    values,
    getItem: jest.fn(async (key) => (values.has(key) ? values.get(key) : null)),
    setItem: jest.fn(async (key, value) => { values.set(key, value); }),
    removeItem: jest.fn(async (key) => { values.delete(key); }),
    getAllKeys: jest.fn(async () => [...values.keys()]),
    multiSet: jest.fn(async (pairs) => pairs.forEach(([key, value]) => values.set(key, value))),
    multiRemove: jest.fn(async (keys) => keys.forEach((key) => values.delete(key))),
  };
}

function makeNativePrimitives() {
  const secureValues = new Map();
  let randomSeed = 0;
  return {
    secureValues,
    secureStore: {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
      getItemAsync: jest.fn(async (key) => secureValues.get(key) ?? null),
      setItemAsync: jest.fn(async (key, value) => { secureValues.set(key, value); }),
      deleteItemAsync: jest.fn(async (key) => { secureValues.delete(key); }),
    },
    crypto: {
      getRandomBytesAsync: jest.fn(async (length) => {
        randomSeed += 1;
        return Uint8Array.from({ length }, (_, index) => (randomSeed + index) % 256);
      }),
    },
  };
}

function makeStorage(seed) {
  const backingStore = makeBackingStore(seed);
  const primitives = makeNativePrimitives();
  const storage = createDeviceStorage({
    backingStore,
    ...primitives,
    platformOS: 'android',
    forceEncryption: true,
  });
  return { storage, backingStore, ...primitives };
}

describe('encrypted native device persistence', () => {
  test('stores AES-GCM envelopes while the device key stays in platform secure storage', async () => {
    const { storage, backingStore, secureValues } = makeStorage();
    const privateValue = JSON.stringify([{ weight: 180, note: 'private health note' }]);

    await storage.setItem('kilo_weight_entries', privateValue);

    const raw = backingStore.values.get('kilo_weight_entries');
    expect(raw.startsWith(DEVICE_DATA_ENVELOPE_PREFIX)).toBe(true);
    expect(raw).not.toContain('private health note');
    expect(secureValues.has(DEVICE_DATA_KEY_NAME)).toBe(true);
    await expect(storage.getItem('kilo_weight_entries')).resolves.toBe(privateValue);
  });

  test('migrates a plaintext value in place without changing the returned data', async () => {
    const plaintext = '[{"id":"legacy"}]';
    const { storage, backingStore } = makeStorage({ kilo_weight_entries: plaintext });

    await expect(storage.getItem('kilo_weight_entries')).resolves.toBe(plaintext);
    expect(backingStore.values.get('kilo_weight_entries')).toMatch(/^kilo\.enc\.v1:/);
    expect(backingStore.values.get('kilo_weight_entries')).not.toContain('legacy');
  });

  test('startup migration encrypts dormant Kilo keys but leaves unrelated settings untouched', async () => {
    const { storage, backingStore } = makeStorage({
      kilo_weight_entries: '[{"id":"legacy-weight"}]',
      kilo_workout_notes: '[{"id":"legacy-note"}]',
      'kilo.appearance_preference': 'dark',
    });

    await expect(storage.migrateKiloData()).resolves.toEqual({ migrated: 2 });
    expect(backingStore.values.get('kilo_weight_entries')).toMatch(/^kilo\.enc\.v1:/);
    expect(backingStore.values.get('kilo_workout_notes')).toMatch(/^kilo\.enc\.v1:/);
    expect(backingStore.values.get('kilo.appearance_preference')).toBe('dark');
    await expect(storage.getItem('kilo_weight_entries')).resolves.toContain('legacy-weight');
  });

  test('leaves recoverable plaintext untouched when migration cannot be persisted', async () => {
    const plaintext = '[{"id":"legacy"}]';
    const { storage, backingStore } = makeStorage({ kilo_weight_entries: plaintext });
    backingStore.setItem.mockRejectedValueOnce(new Error('disk full'));

    await expect(storage.getItem('kilo_weight_entries')).rejects.toThrow('disk full');
    expect(backingStore.values.get('kilo_weight_entries')).toBe(plaintext);
  });

  test('fails closed on ciphertext tampering and does not delete or overwrite it', async () => {
    const { storage, backingStore } = makeStorage();
    await storage.setItem('kilo_workout_notes', '[{"id":"a"}]');
    const original = backingStore.values.get('kilo_workout_notes');
    const tampered = `${original.slice(0, -1)}${original.endsWith('0') ? '1' : '0'}`;
    backingStore.values.set('kilo_workout_notes', tampered);

    const error = await storage.getItem('kilo_workout_notes').catch((value) => value);
    expect(error).toBeInstanceOf(EncryptedStorageError);
    expect(error.key).toBe('kilo_workout_notes');
    expect(backingStore.values.get('kilo_workout_notes')).toBe(tampered);
  });

  test('does not silently fall back to plaintext when secure storage is unavailable', async () => {
    const backingStore = makeBackingStore();
    const storage = createDeviceStorage({
      backingStore,
      secureStore: null,
      crypto: makeNativePrimitives().crypto,
      platformOS: 'android',
      forceEncryption: true,
    });

    await expect(storage.setItem('kilo_weight_entries', 'private')).rejects.toThrow(/secure storage is unavailable/i);
    expect(backingStore.values.has('kilo_weight_entries')).toBe(false);
  });

  test('uses a fresh nonce for repeated writes of the same value', async () => {
    const { storage, backingStore } = makeStorage();
    await storage.setItem('kilo_weight_entries', 'same');
    const first = backingStore.values.get('kilo_weight_entries');
    await storage.setItem('kilo_weight_entries', 'same');
    const second = backingStore.values.get('kilo_weight_entries');
    expect(second).not.toBe(first);
    await expect(storage.getItem('kilo_weight_entries')).resolves.toBe('same');
  });

  test('confirmed wipe removes Kilo data, rotates the key, and resets encrypted ownership', async () => {
    const { storage, backingStore, secureValues } = makeStorage();
    await storage.setItem('kilo_weight_entries', 'private');
    const oldKey = secureValues.get(DEVICE_DATA_KEY_NAME);
    backingStore.values.set('unrelated_key', 'kept');

    await storage.wipeKiloData();

    expect(backingStore.values.has('kilo_weight_entries')).toBe(false);
    expect(backingStore.values.get('unrelated_key')).toBe('kept');
    expect(backingStore.values.get('kilo_local_data_owner')).toMatch(/^kilo\.enc\.v1:/);
    await expect(storage.getItem('kilo_local_data_owner')).resolves.toBe('unclaimed');
    expect(secureValues.get(DEVICE_DATA_KEY_NAME)).not.toBe(oldKey);
  });

  test('drops a stale autosave queued behind a confirmed wipe', async () => {
    const { storage, backingStore } = makeStorage();
    await storage.setItem('kilo_workout_notes', 'before wipe');

    const wipe = storage.wipeKiloData();
    const staleAutosave = storage.setItem('kilo_workout_notes', 'stale mounted value');
    await Promise.all([wipe, staleAutosave]);

    expect(backingStore.values.has('kilo_workout_notes')).toBe(false);
    await expect(storage.getItem('kilo_local_data_owner')).resolves.toBe('unclaimed');
  });
});

// issue #813: updateItem rewrites one value as a single serialized operation.
describe('updateItem: atomic read-transform-write under the operation lock', () => {
  test('transforms the decrypted value and stores a fresh envelope', async () => {
    const { storage, backingStore } = makeStorage();
    await storage.setItem('kilo_workout_notes', '[{"id":"a","derived_sections":[1]}]');
    const before = backingStore.values.get('kilo_workout_notes');

    await expect(
      storage.updateItem('kilo_workout_notes', (raw) => JSON.stringify(
        JSON.parse(raw).map(({ derived_sections: _d, ...note }) => note), // eslint-disable-line no-unused-vars
      )),
    ).resolves.toEqual({ changed: true });

    const after = backingStore.values.get('kilo_workout_notes');
    expect(after).toMatch(/^kilo\.enc\.v1:/);
    expect(after).not.toBe(before);
    await expect(storage.getItem('kilo_workout_notes')).resolves.toBe('[{"id":"a"}]');
  });

  test('passes null for an absent key and writes nothing when the transform declines', async () => {
    const { storage, backingStore } = makeStorage();
    const seen = [];
    await expect(storage.updateItem('kilo_workout_notes', (raw) => { seen.push(raw); return null; }))
      .resolves.toEqual({ changed: false });
    expect(seen).toEqual([null]);
    expect(backingStore.values.has('kilo_workout_notes')).toBe(false);

    await storage.setItem('kilo_workout_notes', 'same');
    backingStore.setItem.mockClear();
    await expect(storage.updateItem('kilo_workout_notes', (raw) => raw)).resolves.toEqual({ changed: false });
    await expect(storage.updateItem('kilo_workout_notes', () => undefined)).resolves.toEqual({ changed: false });
    expect(backingStore.setItem).not.toHaveBeenCalled();
  });

  test('a write queued while the rewrite runs cannot be overwritten by it', async () => {
    const { storage } = makeStorage();
    await storage.setItem('kilo_workout_notes', 'v1');
    let release;
    const rewrite = storage.updateItem('kilo_workout_notes', (raw) => new Promise((resolve) => {
      release = () => resolve(`${raw}+rewritten`);
    }));
    // Queued behind the rewrite: it must land AFTER the rewrite's write, never
    // between the rewrite's read and write.
    const later = storage.setItem('kilo_workout_notes', 'v2');
    await new Promise((resolve) => setImmediate(resolve));
    release();
    await Promise.all([rewrite, later]);
    await expect(storage.getItem('kilo_workout_notes')).resolves.toBe('v2');
  });

  test('is discarded when a confirmed wipe advances the data generation first', async () => {
    const { storage, backingStore } = makeStorage();
    await storage.setItem('kilo_workout_notes', 'before wipe');
    const wipe = storage.wipeKiloData();
    const stale = storage.updateItem('kilo_workout_notes', () => 'resurrected');
    await expect(Promise.all([wipe, stale])).resolves.toEqual([undefined, { changed: false }]);
    expect(backingStore.values.has('kilo_workout_notes')).toBe(false);
  });

  test('migrates a plaintext value in place before handing it to the transform', async () => {
    const { storage, backingStore } = makeStorage({ kilo_workout_notes: '[{"id":"legacy"}]' });
    await expect(storage.updateItem('kilo_workout_notes', (raw) => raw.replace('legacy', 'kept')))
      .resolves.toEqual({ changed: true });
    expect(backingStore.values.get('kilo_workout_notes')).toMatch(/^kilo\.enc\.v1:/);
    await expect(storage.getItem('kilo_workout_notes')).resolves.toBe('[{"id":"kept"}]');
  });
});

// issue #1177: a missing device key must never be replaced while encrypted
// local data exists.
describe('device key fails closed when encrypted local data exists', () => {
  async function withEnvelope() {
    const first = makeStorage();
    await first.storage.setItem('kilo_weight_entries', 'private');
    return first.backingStore.values.get('kilo_weight_entries');
  }

  test('first use with no encrypted data still provisions a key', async () => {
    const { storage, secureValues } = makeStorage({ kilo_other: 'plain', 'unrelated.enc': 'kilo.enc.v1:aa:bb' });
    await storage.setItem('kilo_weight_entries', 'x');
    expect(secureValues.has(DEVICE_DATA_KEY_NAME)).toBe(true);
    expect(storage.isKeyUnavailable()).toBe(false);
  });

  test('missing/stale key: does not mint or store a replacement and keeps the envelope', async () => {
    const envelope = await withEnvelope();
    const { storage, backingStore, secureStore, secureValues, crypto } = makeStorage({ kilo_weight_entries: envelope });

    const error = await storage.getItem('kilo_weight_entries').catch((e) => e);
    expect(error).toBeInstanceOf(EncryptedStorageError);
    expect(error.cause).toBeInstanceOf(DeviceKeyUnavailableError);
    await expect(storage.setItem('kilo_weight_entries', 'overwrite')).rejects.toBeInstanceOf(DeviceKeyUnavailableError);
    expect(secureStore.setItemAsync).not.toHaveBeenCalled();
    expect(crypto.getRandomBytesAsync).not.toHaveBeenCalled();
    expect(secureValues.has(DEVICE_DATA_KEY_NAME)).toBe(false);
    expect(backingStore.values.get('kilo_weight_entries')).toBe(envelope);
    expect(storage.isKeyUnavailable()).toBe(true);
  });

  test('malformed/partial envelope also blocks a new key and is left untouched', async () => {
    const partial = 'kilo.enc.v1:deadbeef';
    const { storage, backingStore, secureValues } = makeStorage({ kilo_workout_notes: partial });
    await expect(storage.setItem('kilo_weight_entries', 'x')).rejects.toBeInstanceOf(DeviceKeyUnavailableError);
    expect(secureValues.size).toBe(0);
    expect(backingStore.values.get('kilo_workout_notes')).toBe(partial);
    expect(backingStore.values.has('kilo_weight_entries')).toBe(false);
  });

  test('backup restore cannot mint a key over orphaned data; confirmed wipe recovers cleanly', async () => {
    const envelope = await withEnvelope();
    const { storage, backingStore, secureValues } = makeStorage({ kilo_weight_entries: envelope });
    await expect(storage.multiSet([['kilo_weight_entries', 'restored']])).rejects.toBeInstanceOf(DeviceKeyUnavailableError);
    expect(backingStore.values.get('kilo_weight_entries')).toBe(envelope);

    await storage.wipeKiloData();
    await storage.setItem('kilo_weight_entries', 'restored');
    expect(secureValues.has(DEVICE_DATA_KEY_NAME)).toBe(true);
    await expect(storage.getItem('kilo_weight_entries')).resolves.toBe('restored');
    expect(storage.isKeyUnavailable()).toBe(false);
  });

  test('probeDeviceKey latches key loss without any read of the orphaned key', async () => {
    const envelope = await withEnvelope();
    const { storage, secureValues } = makeStorage({ kilo_archived_weight_goals: envelope });
    await expect(storage.probeDeviceKey()).resolves.toBeUndefined();
    expect(storage.isKeyUnavailable()).toBe(true);
    expect(secureValues.size).toBe(0);
  });

  test('a present but stale key latches key loss on authentication failure and probe', async () => {
    const envelope = await withEnvelope();
    const { storage, backingStore, secureValues } = makeStorage({ kilo_weight_entries: envelope });
    secureValues.set(DEVICE_DATA_KEY_NAME, '11'.repeat(32));
    await storage.probeDeviceKey();
    expect(storage.isKeyUnavailable()).toBe(true);
    expect(backingStore.values.get('kilo_weight_entries')).toBe(envelope);
    expect(secureValues.get(DEVICE_DATA_KEY_NAME)).toBe('11'.repeat(32));
  });

  test('latch is order-independent and only cleared by explicit wipe', async () => {
    const good = makeStorage();
    await good.storage.setItem('kilo_weight_entries', 'ok');
    const okEnvelope = good.backingStore.values.get('kilo_weight_entries');
    const other = await withEnvelope();
    const { storage, secureValues } = makeStorage({ kilo_weight_entries: okEnvelope, kilo_workout_notes: other, kilo_archived_weight_goals: okEnvelope });
    secureValues.set(DEVICE_DATA_KEY_NAME, good.secureValues.get(DEVICE_DATA_KEY_NAME));
    await storage.probeDeviceKey();
    expect(storage.isKeyUnavailable()).toBe(true);
    await expect(storage.getItem('kilo_weight_entries').catch((e) => e)).resolves.toBeDefined();
    expect(storage.isKeyUnavailable()).toBe(true);
    await storage.wipeKiloData();
    expect(storage.isKeyUnavailable()).toBe(false);
  });

  test('latched state rejects every encrypting write but still allows removal', async () => {
    const envelope = await withEnvelope();
    const { storage, backingStore, secureValues } = makeStorage({ kilo_weight_entries: envelope });
    secureValues.set(DEVICE_DATA_KEY_NAME, '11'.repeat(32));
    await storage.probeDeviceKey();
    await expect(storage.setItem('kilo_weight_entries', 'x')).rejects.toBeInstanceOf(DeviceKeyUnavailableError);
    await expect(storage.multiSet([['kilo_weight_entries', 'x']])).rejects.toBeInstanceOf(DeviceKeyUnavailableError);
    await expect(storage.updateItem('kilo_weight_entries', () => 'x')).rejects.toBeDefined();
    expect(backingStore.values.get('kilo_weight_entries')).toBe(envelope);
    await storage.removeItem('kilo_weight_entries');
    expect(backingStore.values.has('kilo_weight_entries')).toBe(false);
  });

  test('a malformed stored key with an envelope under a dormant key latches recovery', async () => {
    const envelope = await withEnvelope();
    const { storage, secureValues } = makeStorage({ kilo_archived_weight_goals: envelope });
    secureValues.set(DEVICE_DATA_KEY_NAME, '00');
    await storage.probeDeviceKey();
    expect(storage.isKeyUnavailable()).toBe(true);
  });

  test('a partial envelope is recovery-required and a wipe-then-write recovers', async () => {
    const { storage } = makeStorage({ kilo_workout_notes: 'kilo.enc.v1:deadbeef' });
    await storage.probeDeviceKey();
    expect(storage.isKeyUnavailable()).toBe(true);
    await storage.wipeKiloData();
    await storage.setItem('kilo_weight_entries', 'fresh');
    await expect(storage.getItem('kilo_weight_entries')).resolves.toBe('fresh');
    expect(storage.isKeyUnavailable()).toBe(false);
  });

  test('a malformed stored key with no encrypted data is safely replaced', async () => {
    const { storage, secureValues } = makeStorage();
    secureValues.set(DEVICE_DATA_KEY_NAME, '00');
    await storage.setItem('kilo_weight_entries', 'fresh');
    expect(secureValues.get(DEVICE_DATA_KEY_NAME)).toHaveLength(64);
    await expect(storage.getItem('kilo_weight_entries')).resolves.toBe('fresh');
    expect(storage.isKeyUnavailable()).toBe(false);
  });

  test('a transient SecureStore failure stays retryable and never latches recovery', async () => {
    const envelope = await withEnvelope();
    const seeded = makeStorage();
    await seeded.storage.setItem('kilo_weight_entries', 'private');
    const { storage, backingStore, secureStore, secureValues } = makeStorage({
      kilo_weight_entries: seeded.backingStore.values.get('kilo_weight_entries'),
    });
    secureValues.set(DEVICE_DATA_KEY_NAME, seeded.secureValues.get(DEVICE_DATA_KEY_NAME));
    secureStore.getItemAsync.mockRejectedValueOnce(new Error('keystore busy'));
    await storage.probeDeviceKey();
    expect(storage.isKeyUnavailable()).toBe(false);
    await expect(storage.getItem('kilo_weight_entries')).resolves.toBe('private');
    expect(backingStore.values.get('kilo_weight_entries')).toBeDefined();
    expect(envelope).toBeDefined();
  });

  test.each(['kilo.enc.v1', 'kilo.enc', 'kilo.en', 'k', 'kilo.enc.v1:'])('truncated marker %j is encrypted data: never minted over or overwritten', async (marker) => {
    const { storage, backingStore, secureValues } = makeStorage({ kilo_workout_notes: marker });
    await expect(storage.getItem('kilo_workout_notes')).rejects.toBeInstanceOf(EncryptedStorageError);
    await expect(storage.setItem('kilo_weight_entries', 'x')).rejects.toBeInstanceOf(DeviceKeyUnavailableError);
    expect(secureValues.size).toBe(0);
    expect(backingStore.values.get('kilo_workout_notes')).toBe(marker);
  });

  test('a transient probe failure cannot let a stale valid key overwrite a dormant orphan', async () => {
    const envelope = await withEnvelope();
    const { storage, backingStore, secureStore, secureValues } = makeStorage({ kilo_archived_weight_goals: envelope });
    secureValues.set(DEVICE_DATA_KEY_NAME, '11'.repeat(32));
    secureStore.getItemAsync.mockRejectedValueOnce(new Error('keystore busy'));
    await storage.probeDeviceKey();
    expect(storage.isKeyUnavailable()).toBe(false);
    await expect(storage.setItem('kilo_weight_entries', 'x')).rejects.toBeInstanceOf(DeviceKeyUnavailableError);
    expect(backingStore.values.has('kilo_weight_entries')).toBe(false);
    expect(backingStore.values.get('kilo_archived_weight_goals')).toBe(envelope);
  });

  test('subscribers are told when a later write latches key loss after a transient probe failure', async () => {
    const envelope = await withEnvelope();
    const { storage, secureStore, secureValues } = makeStorage({ kilo_archived_weight_goals: envelope });
    secureValues.set(DEVICE_DATA_KEY_NAME, '11'.repeat(32));
    const seen = [];
    const unsubscribe = storage.subscribeKeyUnavailable((lost) => seen.push(lost));
    secureStore.getItemAsync.mockRejectedValueOnce(new Error('keystore busy'));
    await storage.probeDeviceKey();
    expect(seen).toEqual([]);
    await expect(storage.setItem('kilo_weight_entries', 'x')).rejects.toBeInstanceOf(DeviceKeyUnavailableError);
    expect(seen).toEqual([true]);
    unsubscribe();
    await storage.wipeKiloData();
    expect(seen).toEqual([true]);
  });
});

// #1364: the device key is proven by one encrypted canary instead of a scan that
// decrypts every stored envelope on every launch.
describe('constant-time device-key canary', () => {
  const CHECK = DEVICE_DATA_KEY_CHECK_NAME;

  // A populated device whose first process already established the canary.
  async function populatedDevice() {
    const { storage, backingStore, secureStore, crypto, secureValues } = makeStorage();
    await storage.setItem('kilo_weight_entries', '[{"id":"w"}]');
    await storage.setItem('kilo_workout_notes', '[{"id":"n"}]');
    await storage.setItem('kilo_sync_dirty', '{"queue":[1,2,3]}');
    expect(backingStore.values.get(CHECK)).toMatch(/^kilo\.enc\.v1:/);
    return { backingStore, secureStore, crypto, secureValues };
  }

  function relaunch({ backingStore, secureStore, crypto }) {
    backingStore.getItem.mockClear();
    backingStore.getAllKeys.mockClear();
    backingStore.setItem.mockClear();
    secureStore.setItemAsync.mockClear();
    return createDeviceStorage({ backingStore, secureStore, crypto, platformOS: 'android', forceEncryption: true });
  }

  // Key-validation reads only: the recovery journal check is gate reconciliation.
  const validationReads = (backingStore) => backingStore.getItem.mock.calls
    .map(([key]) => key).filter((key) => key !== RECOVERY_JOURNAL_KEY);

  async function expectLatchedAndPreserved(storage, backingStore, secureValues, keyBefore) {
    const before = new Map(backingStore.values);
    await storage.probeDeviceKey();
    expect(storage.isKeyUnavailable()).toBe(true);
    await expect(storage.setItem('kilo_weight_goal', '{}')).rejects.toBeInstanceOf(DeviceKeyUnavailableError);
    expect(backingStore.values).toEqual(before);
    expect(secureValues.get(DEVICE_DATA_KEY_NAME)).toBe(keyBefore);
  }

  test('a valid canary proves the key with one read and no enumeration', async () => {
    const device = await populatedDevice();
    const storage = relaunch(device);
    await storage.probeDeviceKey();
    expect(storage.isKeyUnavailable()).toBe(false);
    expect(device.backingStore.getAllKeys).not.toHaveBeenCalled();
    expect(validationReads(device.backingStore)).toEqual([CHECK]);
    await storage.setItem('kilo_weight_goal', '{"t":1}');
    expect(device.backingStore.getAllKeys).not.toHaveBeenCalled();
    expect(await storage.getItem('kilo_weight_goal')).toBe('{"t":1}');
  });

  test('legacy encrypted data without a canary is scanned once, then never again', async () => {
    const device = await populatedDevice();
    device.backingStore.values.delete(CHECK);
    const first = relaunch(device);
    await first.probeDeviceKey();
    expect(first.isKeyUnavailable()).toBe(false);
    expect(device.backingStore.getAllKeys).toHaveBeenCalledTimes(1);
    expect(validationReads(device.backingStore)).toEqual(expect.arrayContaining(
      ['kilo_weight_entries', 'kilo_workout_notes', 'kilo_sync_dirty'],
    ));
    expect(device.backingStore.values.get(CHECK)).toMatch(/^kilo\.enc\.v1:/);

    const second = relaunch(device);
    await second.probeDeviceKey();
    expect(second.isKeyUnavailable()).toBe(false);
    expect(device.backingStore.getAllKeys).not.toHaveBeenCalled();
    expect(validationReads(device.backingStore)).toEqual([CHECK]);
  });

  test('legacy data with one envelope the key cannot open never gets a canary', async () => {
    const device = await populatedDevice();
    device.backingStore.values.delete(CHECK);
    const raw = device.backingStore.values.get('kilo_workout_notes');
    device.backingStore.values.set('kilo_workout_notes', `${raw.slice(0, -2)}${raw.endsWith('00') ? '11' : '00'}`);
    const storage = relaunch(device);
    await storage.probeDeviceKey();
    expect(storage.isKeyUnavailable()).toBe(true);
    expect(device.backingStore.values.has(CHECK)).toBe(false);
  });

  test('a missing key with a canary never mints a replacement and keeps all data', async () => {
    const device = await populatedDevice();
    device.secureValues.delete(DEVICE_DATA_KEY_NAME);
    const storage = relaunch(device);
    await expectLatchedAndPreserved(storage, device.backingStore, device.secureValues, undefined);
    expect(device.secureStore.setItemAsync).not.toHaveBeenCalledWith(DEVICE_DATA_KEY_NAME, expect.anything(), expect.anything());
  });

  test('a stale valid-length key fails closed on the canary', async () => {
    const device = await populatedDevice();
    device.secureValues.set(DEVICE_DATA_KEY_NAME, 'ab'.repeat(32));
    const storage = relaunch(device);
    await expectLatchedAndPreserved(storage, device.backingStore, device.secureValues, 'ab'.repeat(32));
    expect(device.backingStore.getAllKeys).not.toHaveBeenCalled();
  });

  test.each([
    ['malformed (not an envelope)', () => 'garbage'],
    ['truncated envelope', () => 'kilo.enc.v1:abc'],
    ['tampered ciphertext', (raw) => `${raw.slice(0, -2)}${raw.endsWith('00') ? '11' : '00'}`],
    ['authentic but unexpected plaintext', (_raw, keyHex) => sealEnvelope(
      DEVICE_DATA_ENVELOPE_PREFIX, hexToBytes(keyHex), new Uint8Array(12).fill(9), CHECK, 'something else',
    )],
  ])('a %s canary fails closed and is never replaced or treated as absent', async (_label, corrupt) => {
    const device = await populatedDevice();
    const keyHex = device.secureValues.get(DEVICE_DATA_KEY_NAME);
    device.backingStore.values.set(CHECK, corrupt(device.backingStore.values.get(CHECK), keyHex));
    const storage = relaunch(device);
    await expectLatchedAndPreserved(storage, device.backingStore, device.secureValues, keyHex);
    expect(device.backingStore.getAllKeys).not.toHaveBeenCalled();
  });

  test('a fresh empty install provisions a key and a matching canary', async () => {
    const { storage, ...device } = makeStorage();
    await storage.probeDeviceKey();
    expect(device.secureValues.get(DEVICE_DATA_KEY_NAME)).toMatch(/^[0-9a-f]{64}$/);
    expect(device.backingStore.values.get(CHECK)).toMatch(/^kilo\.enc\.v1:/);
    const relaunched = relaunch(device);
    await relaunched.probeDeviceKey();
    expect(relaunched.isKeyUnavailable()).toBe(false);
    expect(device.backingStore.getAllKeys).not.toHaveBeenCalled();
  });

  test('a canary persistence failure blocks the write, is not durable, and is retried', async () => {
    const { storage, backingStore } = makeStorage({ kilo_weight_entries: '[]' });
    const real = backingStore.setItem.getMockImplementation();
    backingStore.setItem.mockImplementation(async (key, value) => {
      if (key === CHECK) throw new Error('disk full');
      return real(key, value);
    });
    await expect(storage.setItem('kilo_weight_goal', '{}')).rejects.toThrow('disk full');
    expect(backingStore.values.has(CHECK)).toBe(false);
    expect(backingStore.values.has('kilo_weight_goal')).toBe(false);
    expect(storage.isKeyUnavailable()).toBe(false);

    backingStore.setItem.mockImplementation(real);
    await storage.setItem('kilo_weight_goal', '{}');
    expect(backingStore.values.get(CHECK)).toMatch(/^kilo\.enc\.v1:/);
  });

  test('a transient canary read failure stays retryable and authorizes nothing', async () => {
    const device = await populatedDevice();
    const storage = relaunch(device);
    const real = device.backingStore.getItem.getMockImplementation();
    device.backingStore.getItem.mockImplementation(async (key) => {
      if (key === CHECK) throw new Error('io');
      return real(key);
    });
    await storage.probeDeviceKey();
    expect(storage.isKeyUnavailable()).toBe(false);
    await expect(storage.setItem('kilo_weight_goal', '{}')).rejects.toThrow('io');
    expect(device.backingStore.values.has('kilo_weight_goal')).toBe(false);
    device.backingStore.getItem.mockImplementation(real);
    await storage.setItem('kilo_weight_goal', '{}');
    expect(device.backingStore.getAllKeys).not.toHaveBeenCalled();
  });

  test('a migration pending on the canary cannot write after a concurrent read latches', async () => {
    const device = await populatedDevice();
    const raw = device.backingStore.values.get('kilo_workout_notes');
    device.backingStore.values.set('kilo_bad', raw);
    device.backingStore.values.set('kilo_plain', 'legacy plaintext');
    const storage = relaunch(device);
    const real = device.backingStore.getItem.getMockImplementation();
    let releaseCanary;
    const canaryGate = new Promise((resolve) => { releaseCanary = resolve; });
    device.backingStore.getItem.mockImplementation(async (key) => {
      if (key === CHECK) await canaryGate;
      return real(key);
    });
    const migration = storage.getItem('kilo_plain');
    await new Promise((resolve) => setImmediate(resolve));
    await expect(storage.getItem('kilo_bad')).rejects.toBeInstanceOf(EncryptedStorageError);
    expect(storage.isKeyUnavailable()).toBe(true);
    releaseCanary();
    await expect(migration).rejects.toBeInstanceOf(DeviceKeyUnavailableError);
    expect(device.backingStore.values.get('kilo_plain')).toBe('legacy plaintext');
  });

  test('wipe resets the canary under the new key; clearing the key removes it', async () => {
    const device = await populatedDevice();
    const storage = relaunch(device);
    const oldCheck = device.backingStore.values.get(CHECK);
    await storage.wipeKiloData();
    expect(device.backingStore.values.get(CHECK)).toMatch(/^kilo\.enc\.v1:/);
    expect(device.backingStore.values.get(CHECK)).not.toBe(oldCheck);
    const relaunched = relaunch(device);
    await relaunched.probeDeviceKey();
    expect(relaunched.isKeyUnavailable()).toBe(false);
    expect(device.backingStore.getAllKeys).not.toHaveBeenCalled();

    await relaunched.clearDeviceKey();
    expect(device.backingStore.values.has(CHECK)).toBe(false);
    expect(device.secureValues.has(DEVICE_DATA_KEY_NAME)).toBe(false);
  });
});


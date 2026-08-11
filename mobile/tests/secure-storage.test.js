import {
  createDeviceStorage,
  DEVICE_DATA_ENVELOPE_PREFIX,
  DEVICE_DATA_KEY_NAME,
  EncryptedStorageError,
} from '../storage/secureStorage';

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
});

// #1186: validated, non-destructive recovery from a lost or stale device key.
import {
  createDeviceStorage,
  DEVICE_DATA_ENVELOPE_PREFIX,
  DEVICE_DATA_KEY_NAME,
  EncryptedStorageError,
} from '../storage/secureStorage';
import {
  RECOVERY_JOURNAL_KEY,
  RECOVERY_KEY_NAME,
  RECOVERY_STAGE_PREFIX,
  createRecoveryJournal,
} from '../storage/deviceKeyRecovery';

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

function makePrimitives(secureValues = new Map()) {
  let seed = 0;
  return {
    secureValues,
    secureStore: {
      getItemAsync: jest.fn(async (key) => secureValues.get(key) ?? null),
      setItemAsync: jest.fn(async (key, value) => { secureValues.set(key, value); }),
      deleteItemAsync: jest.fn(async (key) => { secureValues.delete(key); }),
    },
    crypto: {
      getRandomBytesAsync: jest.fn(async (length) => {
        seed += 7;
        return Uint8Array.from({ length }, (_, index) => (seed + index * 3) % 256);
      }),
    },
  };
}

function open(backingStore, primitives) {
  return createDeviceStorage({ backingStore, ...primitives, platformOS: 'android', forceEncryption: true });
}

// A device that wrote real envelopes, then lost (or corrupted) its key.
async function orphanedDevice({ stale = false } = {}) {
  const backingStore = makeBackingStore();
  const primitives = makePrimitives();
  const original = open(backingStore, primitives);
  await original.setItem('kilo_weight_entries', '[{"id":"old"}]');
  await original.setItem('kilo_workout_notes', '[{"id":"old-note"}]');
  if (stale) primitives.secureValues.set(DEVICE_DATA_KEY_NAME, 'ab'.repeat(32));
  else primitives.secureValues.delete(DEVICE_DATA_KEY_NAME);
  const storage = open(backingStore, primitives);
  await storage.probeDeviceKey();
  expect(storage.isKeyUnavailable()).toBe(true);
  return { backingStore, primitives, storage, orphans: new Map(backingStore.values) };
}

const restored = async (storage) => {
  await storage.setItem('kilo_weight_entries', '[{"id":"restored"}]');
  return { ok: true };
};

function expectOrphansUntouched(backingStore, orphans, primitives, keyBefore) {
  for (const [key, value] of orphans) expect(backingStore.values.get(key)).toBe(value);
  expect([...backingStore.values.keys()].some((key) => key.startsWith(RECOVERY_STAGE_PREFIX))).toBe(false);
  expect(backingStore.values.has(RECOVERY_JOURNAL_KEY)).toBe(false);
  expect(primitives.secureValues.has(RECOVERY_KEY_NAME)).toBe(false);
  expect(primitives.secureValues.get(DEVICE_DATA_KEY_NAME)).toBe(keyBefore);
}

describe.each([['missing', false], ['stale', true]])('recovery from a %s device key', (_label, stale) => {
  test('replaces the orphans with verified data under a fresh key, without a reset first', async () => {
    const { backingStore, primitives, storage } = await orphanedDevice({ stale });
    const keyBefore = primitives.secureValues.get(DEVICE_DATA_KEY_NAME);
    const wipe = jest.spyOn(storage, 'wipeKiloData');

    await expect(storage.recoverDeviceData(() => restored(storage))).resolves.toEqual({ ok: true });

    expect(wipe).not.toHaveBeenCalled();
    const freshKey = primitives.secureValues.get(DEVICE_DATA_KEY_NAME);
    expect(freshKey).toMatch(/^[0-9a-f]{64}$/);
    expect(freshKey).not.toBe(keyBefore);
    expect(storage.isKeyUnavailable()).toBe(false);
    expect(await storage.getItem('kilo_weight_entries')).toBe('[{"id":"restored"}]');
    // Orphans the restore did not rewrite are gone, exactly as after a reset.
    expect(backingStore.values.has('kilo_workout_notes')).toBe(false);
    expect(await storage.getItem('kilo_local_data_owner')).toBe('unclaimed');
    expect(backingStore.values.get('kilo_weight_entries').startsWith(DEVICE_DATA_ENVELOPE_PREFIX)).toBe(true);
    // Recovery scaffolding is cleaned up after the verified commit.
    expect(primitives.secureValues.has(RECOVERY_KEY_NAME)).toBe(false);
    expect([...backingStore.values.keys()].some((key) => key.startsWith('kilorecovery'))).toBe(false);
    // Ordinary writes work again, and a fresh launch reads the restored data.
    await storage.setItem('kilo_weight_goal', '{"target_weight":170}');
    const relaunched = open(backingStore, primitives);
    expect(await relaunched.getItem('kilo_weight_goal')).toBe('{"target_weight":170}');
    expect(await relaunched.getItem('kilo_weight_entries')).toBe('[{"id":"restored"}]');
  });
});

describe('recovery refuses and preserves orphaned data', () => {
  test('is unreachable while the key is healthy, and never mints a key', async () => {
    const backingStore = makeBackingStore();
    const primitives = makePrimitives();
    const storage = open(backingStore, primitives);
    await storage.setItem('kilo_weight_entries', '[]');
    const key = primitives.secureValues.get(DEVICE_DATA_KEY_NAME);
    const populate = jest.fn();
    await expect(storage.recoverDeviceData(populate)).rejects.toThrow('only available');
    expect(populate).not.toHaveBeenCalled();
    expect(primitives.secureValues.get(DEVICE_DATA_KEY_NAME)).toBe(key);
  });

  test('ordinary writes still cannot mint a replacement key while latched', async () => {
    const { backingStore, primitives, storage, orphans } = await orphanedDevice();
    await expect(storage.setItem('kilo_weight_entries', '[]')).rejects.toBeInstanceOf(EncryptedStorageError);
    expectOrphansUntouched(backingStore, orphans, primitives, undefined);
  });

  test.each([
    ['populate throws', async () => { throw new Error('restore failed'); }],
    ['populate reports failure', async () => ({ ok: false, error: 'bad' })],
  ])('%s: orphans unchanged, nothing staged, still latched', async (_label, populate) => {
    const { backingStore, primitives, storage, orphans } = await orphanedDevice();
    const outcome = storage.recoverDeviceData(populate);
    if (_label === 'populate throws') await expect(outcome).rejects.toThrow('restore failed');
    else await expect(outcome).resolves.toEqual({ ok: false, error: 'bad' });
    expectOrphansUntouched(backingStore, orphans, primitives, undefined);
    expect(storage.isKeyUnavailable()).toBe(true);
  });

  test('restore writes never reach the device before the commit', async () => {
    const { backingStore, primitives, storage, orphans } = await orphanedDevice();
    await expect(storage.recoverDeviceData(async () => {
      await storage.setItem('kilo_weight_entries', '[{"id":"half"}]');
      expect(await storage.getItem('kilo_workout_notes')).toBeNull();
      expectOrphansUntouched(backingStore, orphans, primitives, undefined);
      throw new Error('interrupted');
    })).rejects.toThrow('interrupted');
    expectOrphansUntouched(backingStore, orphans, primitives, undefined);
  });

  test('a stage write failure discards the stage and leaves the orphans', async () => {
    const { backingStore, primitives, storage, orphans } = await orphanedDevice();
    backingStore.multiSet.mockImplementationOnce(async ([[key, value]]) => {
      backingStore.values.set(key, value);
      throw new Error('disk full');
    });
    await expect(storage.recoverDeviceData(() => restored(storage))).rejects.toThrow('disk full');
    expectOrphansUntouched(backingStore, orphans, primitives, undefined);
    expect(storage.isKeyUnavailable()).toBe(true);
  });

  test('a stage that fails verification is never committed', async () => {
    const { backingStore, primitives, storage, orphans } = await orphanedDevice();
    backingStore.multiSet.mockImplementationOnce(async (pairs) => {
      pairs.forEach(([key, value]) => backingStore.values.set(key, `${value.slice(0, -2)}00`));
    });
    await expect(storage.recoverDeviceData(() => restored(storage))).rejects.toThrow();
    expectOrphansUntouched(backingStore, orphans, primitives, undefined);
  });
});

describe('interrupted recovery on the next launch', () => {
  test.each([
    ['staging journal with a partial stage', 'staging'],
    ['torn (malformed) journal', '{"state":"commit'],
    ['committed journal naming a non-kilo key', JSON.stringify({ state: 'committed', keys: ['evil'] })],
  ])('%s is discarded before any read; orphans stay intact', async (_label, journal) => {
    const { backingStore, primitives, orphans } = await orphanedDevice();
    backingStore.values.set(RECOVERY_JOURNAL_KEY, journal);
    backingStore.values.set(`${RECOVERY_STAGE_PREFIX}kilo_weight_entries`, 'kilo.enc.v1:partial');
    primitives.secureValues.set(RECOVERY_KEY_NAME, 'cd'.repeat(32));

    const relaunched = open(backingStore, primitives);
    await expect(relaunched.getItem('kilo_weight_entries')).rejects.toBeInstanceOf(EncryptedStorageError);
    expectOrphansUntouched(backingStore, orphans, primitives, undefined);
    expect(relaunched.isKeyUnavailable()).toBe(true);
  });

  test('a committed journal over a corrupt stage never promotes the key or removes orphans', async () => {
    const { backingStore, primitives, orphans } = await orphanedDevice();
    backingStore.values.set(RECOVERY_JOURNAL_KEY, JSON.stringify({ state: 'committed', keys: ['kilo_weight_entries'] }));
    backingStore.values.set(`${RECOVERY_STAGE_PREFIX}kilo_weight_entries`, `kilo.enc.v1:${'00'.repeat(12)}:${'00'.repeat(32)}`);
    primitives.secureValues.set(RECOVERY_KEY_NAME, 'cd'.repeat(32));

    const relaunched = open(backingStore, primitives);
    await relaunched.probeDeviceKey();
    for (const [key, value] of orphans) expect(backingStore.values.get(key)).toBe(value);
    expect(primitives.secureValues.has(DEVICE_DATA_KEY_NAME)).toBe(false);
    expect(relaunched.isKeyUnavailable()).toBe(true);
  });

  test.each([
    ['after the key was promoted, before orphans were removed', 'multiRemove'],
    ['mid-placement of the restored values', 'multiSet'],
  ])('a crash %s rolls forward from the verified stage', async (_label, failing) => {
    const { backingStore, primitives, storage } = await orphanedDevice();
    let calls = 0;
    const real = backingStore[failing].getMockImplementation();
    backingStore[failing].mockImplementation(async (arg) => {
      calls += 1;
      // The stage write is multiSet call 1; the live placement is call 2.
      if (failing === 'multiSet' && calls === 2) {
        await real(arg.slice(0, 1));
        throw new Error('app killed');
      }
      if (failing === 'multiRemove' && arg.some((key) => key.startsWith('kilo_'))) {
        await real(arg.slice(0, 1));
        throw new Error('app killed');
      }
      return real(arg);
    });
    await expect(storage.recoverDeviceData(async () => {
      await storage.setItem('kilo_weight_entries', '[{"id":"restored"}]');
      await storage.setItem('kilo_workout_notes', '[{"id":"restored-note"}]');
      return { ok: true };
    })).rejects.toThrow('app killed');
    backingStore[failing].mockImplementation(real);

    const relaunched = open(backingStore, primitives);
    expect(await relaunched.getItem('kilo_weight_entries')).toBe('[{"id":"restored"}]');
    expect(await relaunched.getItem('kilo_workout_notes')).toBe('[{"id":"restored-note"}]');
    expect(relaunched.isKeyUnavailable()).toBe(false);
    expect([...backingStore.values.keys()].some((key) => key.startsWith('kilorecovery'))).toBe(false);
    expect(primitives.secureValues.has(RECOVERY_KEY_NAME)).toBe(false);
  });

  test('a completed commit whose cleanup was interrupted only discards leftovers', async () => {
    const { backingStore, primitives, storage } = await orphanedDevice();
    await storage.recoverDeviceData(() => restored(storage));
    backingStore.values.set(`${RECOVERY_STAGE_PREFIX}kilo_weight_entries`, 'leftover');
    backingStore.values.set(RECOVERY_JOURNAL_KEY, 'staging');
    const key = primitives.secureValues.get(DEVICE_DATA_KEY_NAME);
    const relaunched = open(backingStore, primitives);
    expect(await relaunched.getItem('kilo_weight_entries')).toBe('[{"id":"restored"}]');
    expect(primitives.secureValues.get(DEVICE_DATA_KEY_NAME)).toBe(key);
    expect(backingStore.values.has(`${RECOVERY_STAGE_PREFIX}kilo_weight_entries`)).toBe(false);
  });

  test('launch reconciliation never mints a key', async () => {
    const backingStore = makeBackingStore({ [RECOVERY_JOURNAL_KEY]: 'staging' });
    const primitives = makePrimitives();
    const journal = createRecoveryJournal({ backingStore, ...primitives, keyOptions: {}, deviceKeyName: DEVICE_DATA_KEY_NAME, envelopePrefix: DEVICE_DATA_ENVELOPE_PREFIX });
    await expect(journal.reconcile()).resolves.toEqual({ state: 'discarded' });
    expect(primitives.crypto.getRandomBytesAsync).not.toHaveBeenCalled();
    expect(primitives.secureStore.setItemAsync).not.toHaveBeenCalled();
  });
});

// The app seam: More > Data and Backup calls importBackup. With the key lost it
// must validate first, then recover through the staged commit above.
describe('importBackup as the recovery path', () => {
  async function loadImporter({ stale = false } = {}) {
    const device = await orphanedDevice({ stale });
    const encrypted = open(device.backingStore, device.primitives);
    await encrypted.probeDeviceKey();
    let mod;
    jest.isolateModules(() => {
      jest.doMock('../storage/secureStorage', () => ({
        ...jest.requireActual('../storage/secureStorage'),
        secureStorage: encrypted,
      }));
      mod = require('../storage/entries/backupRestore');
    });
    return { ...device, encrypted, importBackup: mod.importBackup, IMPORT_MODES: mod.IMPORT_MODES };
  }

  const backup = (overrides = {}) => ({
    version: '4',
    exported_at: '2026-07-10T00:00:00.000Z',
    weight_entries: [{ id: 'w1', entry_type: 'weight', weight_value: 180, date: '2026-07-01', logged_at: '2026-07-01T08:00:00.000Z' }],
    workout_notes: [{ id: 'n1', title: 'Routine A', raw_text: 'Squat 100x5', saved_at: '2026-07-01T08:00:00.000Z' }],
    current_workout_id: 'n1',
    weight_goal: null,
    deload_history: [],
    recovery_blocks: [],
    recovery_block_weeks: [],
    ...overrides,
  });

  afterEach(() => { jest.dontMock('../storage/secureStorage'); });

  test('a valid backup recovers the device without a reset and under a fresh key', async () => {
    const { importBackup, encrypted, primitives } = await loadImporter({ stale: true });
    const staleKey = primitives.secureValues.get(DEVICE_DATA_KEY_NAME);
    await expect(importBackup(backup())).resolves.toMatchObject({ ok: true });
    expect(encrypted.isKeyUnavailable()).toBe(false);
    expect(primitives.secureValues.get(DEVICE_DATA_KEY_NAME)).not.toBe(staleKey);
    expect(JSON.parse(await encrypted.getItem('kilo_weight_entries'))[0].id).toBe('w1');
    expect(JSON.parse(await encrypted.getItem('kilo_workout_notes'))[0].id).toBe('n1');
  });

  test('a cloud export restores through the cloud contract', async () => {
    const { importBackup, IMPORT_MODES, encrypted } = await loadImporter();
    const payload = backup({ cloud: { tracked_lifts: { squat: true } } });
    await expect(importBackup(payload, 'replace', { mode: IMPORT_MODES.CLOUD })).resolves.toMatchObject({ ok: true, mode: 'cloud' });
    expect(encrypted.isKeyUnavailable()).toBe(false);
    expect(JSON.parse(await encrypted.getItem('kilo_weight_entries'))[0].id).toBe('w1');
  });

  test.each([
    ['unsupported version', { version: '999' }],
    ['malformed notes', { workout_notes: 'nope' }],
    ['half a recovery payload', { recovery_block_weeks: undefined }],
  ])('an invalid backup (%s) is rejected before any key is minted', async (_label, overrides) => {
    const { importBackup, backingStore, primitives, orphans } = await loadImporter();
    const payload = backup(overrides);
    if (overrides.recovery_block_weeks === undefined && 'recovery_block_weeks' in overrides) delete payload.recovery_block_weeks;
    const mintsBefore = primitives.crypto.getRandomBytesAsync.mock.calls.length;
    await expect(importBackup(payload)).resolves.toMatchObject({ ok: false });
    expect(primitives.crypto.getRandomBytesAsync.mock.calls.length).toBe(mintsBefore);
    expectOrphansUntouched(backingStore, orphans, primitives, undefined);
  });

  test('a non-replace strategy cannot recover (it would only wipe)', async () => {
    const { importBackup, backingStore, primitives, orphans } = await loadImporter();
    await expect(importBackup(backup(), 'merge')).resolves.toMatchObject({ ok: false });
    expectOrphansUntouched(backingStore, orphans, primitives, undefined);
  });
});

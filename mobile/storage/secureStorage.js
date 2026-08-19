import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { gcm } from '@noble/ciphers/aes';
import {
  bytesToHex,
  bytesToUtf8,
  hexToBytes,
  utf8ToBytes,
} from '@noble/ciphers/utils';
import { markStartupPhase, recordStartupStorageRead } from './entries/startupTiming';

const ENVELOPE_PREFIX = 'kilo.enc.v1:';
const DEVICE_KEY_NAME = 'kilo.device-data-key.v1';
const DEVICE_KEY_BYTES = 32;
const NONCE_BYTES = 12;
// Startup migration completion marker (#809). Every ordinary getItem() already
// lazily migrates its OWN key in place (see getItemUnlocked below), so the
// proactive full-table scan in migrateKiloData() only earns its keep once per
// device: it catches a legacy plaintext key that first-launch startup never
// happens to read on its own. Once that one pass confirms every kilo_* key is
// encrypted, no future write can ever reintroduce plaintext (setItem always
// encrypts), so re-scanning every key on every later cold start is redundant
// work blocking every other storage read behind it via the shared operation
// queue. The marker is plain text on purpose: it carries no sensitive data,
// and checking it must not itself depend on the device encryption key.
const MIGRATION_COMPLETE_KEY = 'kilo_plaintext_migration_v1_complete';
const MIGRATION_COMPLETE_VALUE = '1';

// Encryption failures are deliberately distinct from JSON/domain corruption.
// Callers must never interpret an unreadable encrypted value as absent data.
export class EncryptedStorageError extends Error {
  constructor(key, cause) {
    super(`Encrypted device data at "${key}" could not be read`);
    this.name = 'EncryptedStorageError';
    this.key = key;
    if (cause !== undefined) this.cause = cause;
  }
}

function loadSecureStore() {
  try {
    // eslint-disable-next-line global-require
    return require('expo-secure-store');
  } catch {
    return null;
  }
}

function loadCrypto() {
  try {
    // eslint-disable-next-line global-require
    return require('expo-crypto');
  } catch {
    return null;
  }
}

function secureStoreOptions(secureStore) {
  const accessibility = secureStore?.WHEN_UNLOCKED_THIS_DEVICE_ONLY;
  return accessibility == null ? {} : { keychainAccessible: accessibility };
}

// Factory is exported so the authenticated-encryption and migration contract
// can be tested with deterministic native fakes. Production native storage
// always takes the encrypted path; web keeps the browser's ordinary storage.
export function createDeviceStorage({
  backingStore = AsyncStorage,
  secureStore = loadSecureStore(),
  crypto = loadCrypto(),
  platformOS = Platform.OS,
  // Existing storage/domain tests intentionally keep using AsyncStorage's Jest
  // mock. Dedicated security tests pass forceEncryption=true and exercise the
  // exact native implementation with injected platform primitives.
  forceEncryption = false,
} = {}) {
  const encryptValues = platformOS !== 'web'
    && (forceEncryption || process.env.NODE_ENV !== 'test');
  let keyPromise = null;
  let operationTail = Promise.resolve();
  let dataGeneration = 0;
  // In-flight reads, keyed by storage key (#818). See coalescedRead below.
  const pendingReads = new Map();

  function requireNativePrimitives() {
    if (!secureStore?.getItemAsync || !secureStore?.setItemAsync || !secureStore?.deleteItemAsync) {
      throw new Error('Platform secure storage is unavailable; device data persistence is disabled.');
    }
    if (!crypto?.getRandomBytesAsync) {
      throw new Error('Platform cryptographic randomness is unavailable; device data persistence is disabled.');
    }
  }

  async function deviceKey() {
    requireNativePrimitives();
    if (!keyPromise) {
      keyPromise = (async () => {
        const stored = await secureStore.getItemAsync(DEVICE_KEY_NAME);
        if (stored != null) {
          const parsed = hexToBytes(stored);
          if (parsed.length !== DEVICE_KEY_BYTES) throw new Error('Stored device encryption key is invalid.');
          return parsed;
        }
        const created = await crypto.getRandomBytesAsync(DEVICE_KEY_BYTES);
        if (!(created instanceof Uint8Array) || created.length !== DEVICE_KEY_BYTES) {
          throw new Error('Platform cryptographic randomness returned an invalid key.');
        }
        await secureStore.setItemAsync(
          DEVICE_KEY_NAME,
          bytesToHex(created),
          secureStoreOptions(secureStore),
        );
        return created;
      })().catch((error) => {
        keyPromise = null;
        throw error;
      });
    }
    return keyPromise;
  }

  async function encrypt(key, value) {
    const encryptionKey = await deviceKey();
    const nonce = await crypto.getRandomBytesAsync(NONCE_BYTES);
    if (!(nonce instanceof Uint8Array) || nonce.length !== NONCE_BYTES) {
      throw new Error('Platform cryptographic randomness returned an invalid nonce.');
    }
    const ciphertext = gcm(encryptionKey, nonce, utf8ToBytes(key)).encrypt(utf8ToBytes(String(value)));
    return `${ENVELOPE_PREFIX}${bytesToHex(nonce)}:${bytesToHex(ciphertext)}`;
  }

  async function decrypt(key, envelope) {
    try {
      const encoded = envelope.slice(ENVELOPE_PREFIX.length);
      const parts = encoded.split(':');
      if (parts.length !== 2 || parts[0].length !== NONCE_BYTES * 2 || parts[1].length < 32) {
        throw new Error('Malformed encrypted envelope.');
      }
      const nonce = hexToBytes(parts[0]);
      const ciphertext = hexToBytes(parts[1]);
      const plaintext = gcm(await deviceKey(), nonce, utf8ToBytes(key)).decrypt(ciphertext);
      return bytesToUtf8(plaintext);
    } catch (error) {
      throw new EncryptedStorageError(key, error);
    }
  }

  // Serialize persistence operations so a lazy migration cannot overwrite a
  // newer write, and an explicit wipe cannot race an autosave/sync write that
  // would otherwise recreate sensitive data after the confirmation completes.
  function withStorageLock(operation) {
    const next = operationTail.catch(() => {}).then(operation);
    operationTail = next;
    return next;
  }

  // A mutation can be scheduled while a slower wipe already owns the lock.
  // Capture the generation at call time and discard that stale operation if a
  // wipe advances the generation before it reaches the front of the queue.
  // This prevents an autosave from recreating deleted health data immediately
  // after the destructive operation completes.
  function withMutationLock(operation, invalidatedResult) {
    const scheduledGeneration = dataGeneration;
    return withStorageLock(() => (
      scheduledGeneration === dataGeneration ? operation() : invalidatedResult
    ));
  }

  // A pending read may only be shared with callers that asked for the key
  // BEFORE any operation that could change it was enqueued. Invalidating at
  // enqueue time (not at execution time) is what makes that exact: the queue is
  // FIFO, so a read already enqueued still runs — and still resolves the
  // pre-mutation value, which is precisely what an uncoalesced caller would
  // have received in the same queue position. Any caller arriving after the
  // mutation is enqueued finds no entry and gets its own read, queued behind
  // that mutation.
  function invalidatePendingRead(key) {
    pendingReads.delete(key);
  }

  function invalidateAllPendingReads() {
    pendingReads.clear();
  }

  // Cold-start read coalescing (#818).
  //
  // All five tabs stay mounted (#527) and each one hydrates from the same
  // device keys, so a cold start issued the SAME encrypted read several times
  // over: the notebook, the weight table, the current-routine pointer and the
  // tracked lifts were each read three times, the weight goal twice. Every one
  // of those is a native round trip plus a full AES-GCM decrypt of the whole
  // payload, and withStorageLock serializes them, so they do not overlap — they
  // queue. Worse, child effects run before the parent's, so the shell's own
  // note/weight reads (the two that gate Home's first paint) were enqueued
  // LAST, behind every duplicate the four hidden tabs had already queued.
  //
  // Sharing one in-flight read per key removes the duplicate decrypt and moves
  // the shell's reads to the front of that queue at the same time, because they
  // land on the read a tab already started rather than on a new one behind it.
  // The user-visible answer is unchanged: a coalesced caller gets exactly the
  // value its own read would have returned from the same queue position.
  function coalescedRead(key) {
    const inFlight = pendingReads.get(key);
    if (inFlight) {
      recordStartupStorageRead(true);
      return inFlight;
    }
    recordStartupStorageRead(false);
    const read = withStorageLock(() => getItemUnlocked(key));
    pendingReads.set(key, read);
    // Only clear the entry if it is still this read's: an intervening mutation
    // may already have dropped it, and a later caller may already have started
    // a fresh read for the same key behind that mutation.
    const settle = () => {
      if (pendingReads.get(key) === read) pendingReads.delete(key);
    };
    read.then(settle, settle);
    return read;
  }

  async function getItemUnlocked(key) {
    const raw = await backingStore.getItem(key);
    if (raw == null || !encryptValues) return raw;
    if (raw.startsWith(ENVELOPE_PREFIX)) return decrypt(key, raw);

    // One-time, fail-closed plaintext migration. The original value is not
    // removed first, so an encryption/write failure leaves the recoverable
    // plaintext in place and propagates to the caller rather than pretending
    // the key was empty.
    const migrated = await encrypt(key, raw);
    await backingStore.setItem(key, migrated);
    return raw;
  }

  const storage = {
    getItem(key) {
      return coalescedRead(key);
    },
    setItem(key, value) {
      invalidatePendingRead(key);
      return withMutationLock(async () => {
        const next = encryptValues ? await encrypt(key, value) : String(value);
        await backingStore.setItem(key, next);
      });
    },
    removeItem(key) {
      invalidatePendingRead(key);
      return withMutationLock(() => backingStore.removeItem(key));
    },
    getAllKeys() {
      return withStorageLock(() => backingStore.getAllKeys());
    },
    multiSet(pairs) {
      for (const [key] of pairs) invalidatePendingRead(key);
      return withMutationLock(async () => {
        const encoded = [];
        for (const [key, value] of pairs) {
          // eslint-disable-next-line no-await-in-loop
          encoded.push([key, encryptValues ? await encrypt(key, value) : String(value)]);
        }
        await backingStore.multiSet(encoded);
      });
    },
    multiRemove(keys) {
      for (const key of keys) invalidatePendingRead(key);
      // Removing encrypted blobs does not require the encryption key.
      return withMutationLock(() => backingStore.multiRemove(keys));
    },
    // Rewrite one stored value as a single serialized operation (issue #813).
    // `transform` receives the current decrypted value (`null` when the key is
    // absent) and returns the string to store; returning the same string, or
    // `null`/`undefined`, stores nothing. Read, transform, and write all happen
    // under the operation lock, so no other read or write can land between the
    // read and the write - the guarantee a getItem() followed by a setItem()
    // cannot give, because another writer may be queued between the two. The
    // mutation lock also discards the rewrite when a wipe advances the data
    // generation first, exactly like setItem.
    updateItem(key, transform) {
      invalidatePendingRead(key);
      return withMutationLock(async () => {
        const current = await getItemUnlocked(key);
        const next = await transform(current);
        if (next == null || next === current) return { changed: false };
        const encoded = encryptValues ? await encrypt(key, next) : String(next);
        await backingStore.setItem(key, encoded);
        return { changed: true };
      }, { changed: false });
    },
    clearDeviceKey() {
      // Discarding the key changes what every stored envelope decrypts to (it
      // stops decrypting at all), so no pending read may be shared across it.
      invalidateAllPendingReads();
      return withStorageLock(async () => {
        if (!encryptValues) return;
        requireNativePrimitives();
        await secureStore.deleteItemAsync(DEVICE_KEY_NAME);
        keyPromise = null;
      });
    },
    wipeKiloData() {
      invalidateAllPendingReads();
      return withStorageLock(async () => {
        dataGeneration += 1;
        const keys = await backingStore.getAllKeys();
        const kiloKeys = keys.filter((key) => key.startsWith('kilo_'));
        if (kiloKeys.length > 0) await backingStore.multiRemove(kiloKeys);
        if (encryptValues) {
          requireNativePrimitives();
          await secureStore.deleteItemAsync(DEVICE_KEY_NAME);
          keyPromise = null;
        }
        const owner = encryptValues
          ? await encrypt('kilo_local_data_owner', 'unclaimed')
          : 'unclaimed';
        await backingStore.setItem('kilo_local_data_owner', owner);
      });
    },
    // Deliberately does NOT invalidate pending reads (#818), unlike every other
    // mutating method above. This pass only ever re-ENCODES a value that is
    // already there — plaintext in, the same string back out as an envelope —
    // and getItemUnlocked returns that same string either way, so no key's
    // decrypted value can differ across it. That matters because App queues this
    // between the mounted tabs' hydration reads and the shell's own, so
    // invalidating here would put the two reads that gate Home's first paint
    // back at the end of the queue, which is the exact cost #818 removes. The
    // marker key it writes is read through backingStore directly, never through
    // the coalesced getItem path.
    migrateKiloData() {
      return withMutationLock(async () => {
        if (!encryptValues) return { migrated: 0 };
        // Skip the full scan once a prior pass on this device already
        // confirmed every kilo_* key is encrypted (see MIGRATION_COMPLETE_KEY
        // above). This one extra getItem is the entire cost of every cold
        // start after the first.
        const alreadyMigrated = await backingStore.getItem(MIGRATION_COMPLETE_KEY);
        if (alreadyMigrated === MIGRATION_COMPLETE_VALUE) {
          markStartupPhase('migration:skipped');
          return { migrated: 0 };
        }
        markStartupPhase('migration:scan:start');
        const keys = await backingStore.getAllKeys();
        const kiloKeys = keys.filter((key) => key.startsWith('kilo_') && key !== MIGRATION_COMPLETE_KEY);
        let migrated = 0;
        for (const key of kiloKeys) {
          // eslint-disable-next-line no-await-in-loop
          const raw = await backingStore.getItem(key);
          if (raw == null || raw.startsWith(ENVELOPE_PREFIX)) continue;
          // Encrypt first and replace only after encryption succeeds. A failed
          // migration leaves this and every not-yet-visited plaintext value
          // recoverable for the next startup attempt.
          // eslint-disable-next-line no-await-in-loop
          const envelope = await encrypt(key, raw);
          // eslint-disable-next-line no-await-in-loop
          await backingStore.setItem(key, envelope);
          migrated += 1;
        }
        await backingStore.setItem(MIGRATION_COMPLETE_KEY, MIGRATION_COMPLETE_VALUE);
        markStartupPhase('migration:scan:done');
        return { migrated };
      }, { migrated: 0 });
    },
  };

  return storage;
}

export const secureStorage = createDeviceStorage();

// Explicit destructive device-data path used only after a user confirmation.
// Remove all Kilo values, cryptographically discard the old key, then create a
// fresh encrypted ownership marker so the next account starts unclaimed.
export async function wipeSensitiveDeviceData() {
  await secureStorage.wipeKiloData();
}

export async function migrateSensitiveDeviceData() {
  return secureStorage.migrateKiloData();
}

export const DEVICE_DATA_ENVELOPE_PREFIX = ENVELOPE_PREFIX;
export const DEVICE_DATA_KEY_NAME = DEVICE_KEY_NAME;

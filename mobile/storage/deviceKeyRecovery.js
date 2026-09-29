// Validated, non-destructive recovery from a lost device key (#1186).
//
// #1177 made a missing or stale device key fail closed: the orphaned `kilo_*`
// envelopes are kept and every encrypting write is refused. This module is the
// only way back out without a reset first. The caller has already validated the
// restore source; the restored dataset is then staged under a FRESH key, verified,
// and only after that committed over the orphans.
//
// Persistence boundaries and what a crash at each one leaves behind:
//
//   journal = 'staging'   -> fresh key + staged envelopes being written. Next
//                            launch discards the stage; orphans never touched.
//   journal = committed   -> the stage was fully verified. Next launch rolls
//                            FORWARD from the stage (idempotent), because the key
//                            slot or the live keys may already be half-replaced.
//   journal = 'cleanup'   -> commit done and verified; the leftover stage and
//                            recovery key are discarded, journal removed last.
//
// Staged values and the journal live outside the `kilo_` namespace on purpose:
// the key probe, wipe, and plaintext migration only ever scan `kilo_*`, so a stage
// can never be mistaken for live data or for an orphan.
import { gcm } from '@noble/ciphers/aes';
import { bytesToHex, bytesToUtf8, hexToBytes, utf8ToBytes } from '@noble/ciphers/utils';

export const RECOVERY_KEY_NAME = 'kilo.device-data-key.recovery.v1';
export const RECOVERY_JOURNAL_KEY = 'kilorecovery.journal';
export const RECOVERY_STAGE_PREFIX = 'kilorecovery.stage:';
const STAGING = 'staging';
const COMMITTED = 'committed';
const CLEANUP = 'cleanup';
const KEY_BYTES = 32;
const NONCE_BYTES = 12;

export function sealEnvelope(prefix, keyBytes, nonce, name, value) {
  const ciphertext = gcm(keyBytes, nonce, utf8ToBytes(name)).encrypt(utf8ToBytes(String(value)));
  return `${prefix}${bytesToHex(nonce)}:${bytesToHex(ciphertext)}`;
}

export function openEnvelope(prefix, keyBytes, name, envelope) {
  if (typeof envelope !== 'string' || !envelope.startsWith(prefix)) throw new Error('Not an encrypted envelope.');
  const parts = envelope.slice(prefix.length).split(':');
  if (parts.length !== 2 || parts[0].length !== NONCE_BYTES * 2 || parts[1].length < 32) {
    throw new Error('Malformed encrypted envelope.');
  }
  return bytesToUtf8(gcm(keyBytes, hexToBytes(parts[0]), utf8ToBytes(name)).decrypt(hexToBytes(parts[1])));
}

function parseKey(hex) {
  let bytes = null;
  try { bytes = hex == null ? null : hexToBytes(hex); } catch { bytes = null; }
  if (bytes?.length !== KEY_BYTES) throw new Error('Recovery key is missing or malformed.');
  return bytes;
}

// A failure after the committed journal landed: the key may already be promoted
// and the restore half-placed, so the store must refuse all traffic until a
// roll-forward succeeds (see `interruptedCommit` in secureStorage.js).
function committedFailure(error) {
  const failure = error instanceof Error ? error : new Error(String(error));
  failure.recoveryCommitted = true;
  return failure;
}

function parseCommittedJournal(raw) {
  try {
    const journal = JSON.parse(raw);
    if (journal?.state === COMMITTED && Array.isArray(journal.keys) && journal.keys.length > 0
      && journal.keys.every((name) => typeof name === 'string' && name.startsWith('kilo_'))) {
      return journal;
    }
  } catch { /* not a committed journal */ }
  return null;
}

// While recovery populates the restored dataset, every storage call is served
// from this map instead of the device. It starts as a freshly reset device (an
// unclaimed owner and nothing else), so the restore writes exactly what it would
// after a reset and reads nothing from the unreadable orphans.
export function createRecoveryOverlay(initial) {
  const values = new Map(initial);
  return {
    values,
    async getItem(key) { return values.has(key) ? values.get(key) : null; },
    async setItem(key, value) { values.set(key, String(value)); },
    async removeItem(key) { values.delete(key); },
    async getAllKeys() { return [...values.keys()]; },
    async multiSet(pairs) { pairs.forEach(([key, value]) => values.set(key, String(value))); },
    async multiRemove(keys) { keys.forEach((key) => values.delete(key)); },
    async updateItem(key, transform) {
      const current = values.has(key) ? values.get(key) : null;
      const next = await transform(current);
      if (next == null || next === current) return { changed: false };
      values.set(key, String(next));
      return { changed: true };
    },
  };
}

// Admission control for the shared store. Reconciles the journal before the
// first operation of a launch, and after a failed commit keeps every operation
// failing closed (retrying the roll-forward first) until the commit completes.
export function createRecoveryGate(journal, UnavailableError, onInterrupted) {
  let reconciled = false;
  let interrupted = null;
  const gate = {
    noteFailure(error) {
      if (!error?.recoveryCommitted) return;
      interrupted = error;
      reconciled = false;
      onInterrupted();
    },
    reconcileIfNeeded(tail) {
      if (reconciled) return tail;
      reconciled = true;
      return tail.then(() => journal.reconcile()).then(() => { interrupted = null; }, gate.noteFailure);
    },
    admit(operation) {
      return () => {
        if (interrupted) throw new UnavailableError(interrupted);
        return operation();
      };
    },
    clear() { interrupted = null; },
  };
  return gate;
}

export function createRecoveryJournal({ backingStore, secureStore, crypto, keyOptions, deviceKeyName, envelopePrefix }) {
  const stageName = (name) => `${RECOVERY_STAGE_PREFIX}${name}`;

  async function readStagedKey() {
    return parseKey(await secureStore.getItemAsync(RECOVERY_KEY_NAME));
  }

  // Authenticates every staged envelope under the staged key. Any missing or
  // unreadable value rejects: an unverified stage must never replace anything.
  async function readVerifiedStage(names) {
    const keyBytes = await readStagedKey();
    const staged = [];
    for (const name of names) {
      // eslint-disable-next-line no-await-in-loop
      const envelope = await backingStore.getItem(stageName(name));
      staged.push({ name, envelope, plaintext: openEnvelope(envelopePrefix, keyBytes, name, envelope) });
    }
    return { keyBytes, staged };
  }

  // Never touches `kilo_*` or the live key slot. The journal goes last so an
  // interrupted discard is retried on the next launch.
  async function discardStage() {
    const keys = await backingStore.getAllKeys();
    const stageKeys = keys.filter((key) => key.startsWith(RECOVERY_STAGE_PREFIX));
    if (stageKeys.length > 0) await backingStore.multiRemove(stageKeys);
    await secureStore.deleteItemAsync(RECOVERY_KEY_NAME);
    await backingStore.removeItem(RECOVERY_JOURNAL_KEY);
  }

  // Idempotent: the stage is only removed after the live copy is verified, so a
  // crash anywhere in here is rolled forward again from an intact stage.
  async function rollForward(journal) {
    const { keyBytes, staged } = await readVerifiedStage(journal.keys);
    const keyHex = bytesToHex(keyBytes);
    await secureStore.setItemAsync(deviceKeyName, keyHex, keyOptions);
    if (await secureStore.getItemAsync(deviceKeyName) !== keyHex) {
      throw new Error('The recovered device key could not be persisted.');
    }
    // Replace-by-reset: every orphan goes, exactly as a confirmed wipe would
    // remove it, but only now that its replacement is verified and in hand.
    const live = (await backingStore.getAllKeys()).filter((key) => key.startsWith('kilo_'));
    if (live.length > 0) await backingStore.multiRemove(live);
    await backingStore.multiSet(staged.map(({ name, envelope }) => [name, envelope]));
    for (const { name, plaintext } of staged) {
      // eslint-disable-next-line no-await-in-loop
      if (openEnvelope(envelopePrefix, keyBytes, name, await backingStore.getItem(name)) !== plaintext) {
        throw new Error('Recovered device data failed verification.');
      }
    }
    // Downgrade, never remove, the journal: the commit is done, but the stage
    // must stay tracked until discardStage() removes the journal last, so an
    // interrupted cleanup is retried on the next launch rather than leaving a
    // copy of the data behind that no reset would ever reach.
    await backingStore.setItem(RECOVERY_JOURNAL_KEY, CLEANUP);
    await discardStage().catch(() => {});
  }

  // Launch-time reconciliation. Never mints a key: it either finishes a commit
  // whose stage was already verified, or discards an uncommitted stage.
  async function reconcile() {
    const raw = await backingStore.getItem(RECOVERY_JOURNAL_KEY);
    if (raw == null) return { state: 'idle' };
    const journal = parseCommittedJournal(raw);
    if (journal) {
      await rollForward(journal).catch((error) => { throw committedFailure(error); });
      return { state: 'committed' };
    }
    // 'staging', 'cleanup', or a journal torn mid-write: never (re)committed.
    await discardStage();
    return { state: 'discarded' };
  }

  // The explicit recovery commit. `entries` is the complete restored dataset as
  // [name, plaintext] pairs. A failure before the committed journal lands
  // discards the stage and leaves every orphan exactly as it was.
  async function commit(entries) {
    await reconcile();
    const names = entries.map(([name]) => name);
    if (names.length === 0 || names.some((name) => !name.startsWith('kilo_'))) {
      throw new Error('Recovery data must be a non-empty set of kilo_ values.');
    }
    await backingStore.setItem(RECOVERY_JOURNAL_KEY, STAGING);
    try {
      const keyBytes = await crypto.getRandomBytesAsync(KEY_BYTES);
      if (!(keyBytes instanceof Uint8Array) || keyBytes.length !== KEY_BYTES) {
        throw new Error('Platform cryptographic randomness returned an invalid key.');
      }
      await secureStore.setItemAsync(RECOVERY_KEY_NAME, bytesToHex(keyBytes), keyOptions);
      const staged = [];
      for (const [name, value] of entries) {
        // eslint-disable-next-line no-await-in-loop
        const nonce = await crypto.getRandomBytesAsync(NONCE_BYTES);
        if (!(nonce instanceof Uint8Array) || nonce.length !== NONCE_BYTES) {
          throw new Error('Platform cryptographic randomness returned an invalid nonce.');
        }
        staged.push([stageName(name), sealEnvelope(envelopePrefix, keyBytes, nonce, name, value)]);
      }
      await backingStore.multiSet(staged);
      const verified = await readVerifiedStage(names);
      verified.staged.forEach(({ plaintext }, index) => {
        if (plaintext !== String(entries[index][1])) throw new Error('Staged recovery data failed verification.');
      });
    } catch (error) {
      await discardStage().catch(() => {});
      throw error;
    }
    await backingStore.setItem(RECOVERY_JOURNAL_KEY, JSON.stringify({ state: COMMITTED, keys: names }));
    await rollForward({ keys: names }).catch((error) => { throw committedFailure(error); });
  }

  return { reconcile, commit, discard: discardStage };
}

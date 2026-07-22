import AsyncStorage from '@react-native-async-storage/async-storage';

// Thrown by readList when a key holds data that cannot be interpreted as the
// documented list shape (malformed JSON or a non-array payload). It is distinct
// from the empty-default path so callers — and the hook error surfaces that
// render the recoverable ErrorBanner — can tell "no data yet" apart from "data
// present but unreadable" (#607). The originating key and any parse cause are
// attached for logging/recovery without leaking the raw bytes.
export class CorruptStorageError extends Error {
  constructor(key, cause) {
    super(`Corrupt list data at "${key}"`);
    this.name = 'CorruptStorageError';
    this.key = key;
    if (cause !== undefined) this.cause = cause;
  }
}

export function isCorruptStorageError(err) {
  return err instanceof CorruptStorageError;
}

export function localDateToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Read a persisted list. Only a genuinely absent key (null) returns the
// documented empty default. Any present payload that fails to yield an array —
// malformed JSON (including an empty string, which JSON.parse rejects), or a
// non-array value — fails closed with CorruptStorageError instead of
// masquerading as an empty dataset. This matters because every mutation path
// reads before it writes: returning [] for corrupt bytes would let the next
// write silently overwrite salvageable data as though it were empty (#607). A
// raw storage read failure is likewise propagated rather than swallowed, so the
// same fail-closed guarantee holds when the backing store is unavailable.
export async function readList(key) {
  const raw = await AsyncStorage.getItem(key);
  if (raw == null) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new CorruptStorageError(key, e);
  }
  if (!Array.isArray(parsed)) {
    throw new CorruptStorageError(key);
  }
  return parsed;
}

export async function writeList(key, list) {
  await AsyncStorage.setItem(key, JSON.stringify(list));
}

// Supabase auth/session client boundary.
//
// This module is the single authorized place the app constructs a Supabase
// client. Screens and hooks must never import `@supabase/supabase-js` directly;
// auth flows reach it through `useAuthSession`, and cloud storage reaches it
// through the storage adapter seam. It wires platform-appropriate, secure
// session persistence:
//
//   - Native (iOS/Android): token material is stored in `expo-secure-store`
//     (Keychain / Keystore), never in plain AsyncStorage. Secure store has a
//     ~2KB per-value limit, so values are chunked across keys when needed.
//   - Web: the browser-safe localStorage path is used, matching the default
//     supabase-js web behavior.
//
// The client is created lazily and only when Supabase env config is present, so
// signed-out, local-only users never trigger any network/auth setup. Existing
// app behavior is unchanged when `EXPO_PUBLIC_SUPABASE_URL` /
// `EXPO_PUBLIC_SUPABASE_ANON_KEY` are not configured.
//
// Reconciliation note (issues #317 + #318): #317 created the auth/session
// client and #318 created a storage-seam shell, each adding this file. They are
// merged here into one module: #317's auth-aware client + secure-store
// persistence is canonical, and #318's explicit config probes
// (`getSupabaseConfig` / `isSupabaseConfigured`) are kept so the cloud storage
// adapter can decide whether cloud is viable without constructing a client.
// `getSupabaseClient()` returns null (does not throw) when unconfigured.

import { Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
// Kept in sync with the canonical repo version by scripts/sync-version.mjs, so the
// client version reported to the server is the one that actually shipped.
import { version as APP_VERSION } from '../package.json';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// expo-secure-store rejects values larger than 2048 bytes. Supabase session
// payloads (JWT + refresh token + user) routinely exceed that, so we
// transparently split values into fixed-size chunks and track the chunk count
// under a sentinel key.
const SECURE_STORE_CHUNK_SIZE = 2000;

// Lazily require expo-secure-store so web bundles and signed-out flows do not
// pull native-only code paths unless secure storage is actually used.
function loadSecureStore() {
  try {
    // eslint-disable-next-line global-require
    return require('expo-secure-store');
  } catch (e) {
    return null;
  }
}

// Native session storage backed by expo-secure-store with chunking. Implements
// the get/set/remove contract supabase-js expects for `auth.storage`.
export function makeSecureStoreAdapter(secureStore = loadSecureStore()) {
  const SecureStore = secureStore;
  if (!SecureStore || typeof SecureStore.getItemAsync !== 'function') {
    return null;
  }

  const chunkKey = (key, index) => `${key}.chunk.${index}`;
  const countKey = (key) => `${key}.chunks`;
  // High-water mark: the maximum chunk count ever written for this key. This
  // is the authoritative cleanup bound. Write ordering keeps it from ever
  // understating reality: it is raised (and persisted) BEFORE new chunks are
  // written, and lowered only AFTER all cleanup deletions have completed. An
  // interrupted write or removal therefore always leaves the HWM at or above
  // the highest chunk index that can still exist.
  const hwmKey = (key) => `${key}.chunks.hwm`;

  // Cleanup bound for keys carrying legacy or corrupt metadata (a count key
  // or single-value key exists but no valid HWM does): no recorded bound can
  // be trusted, so sweep up to a generous fixed cap. Supabase session payloads
  // are a few KB; 64 chunks (~128KB) is far beyond anything this adapter will
  // ever write for auth storage. Once a key has been written through this
  // adapter, its HWM is authoritative and this fallback is no longer used.
  //
  // Accepted limitation: a legacy chunk at index >= 64 (i.e. beyond
  // LEGACY_SWEEP_BOUND) is outside the fallback sweep and survives. Such a
  // chunk can only exist if something other than this adapter wrote it.
  const LEGACY_SWEEP_BOUND = 64;

  const parseCount = (raw) => {
    if (raw == null) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  // How far cleanup must sweep to cover every chunk that could exist for the
  // key.
  //
  // - Valid HWM: it is authoritative (write ordering keeps it from ever
  //   understating reality), so sweep max(hwm, recorded count).
  // - No HWM, no count key, no single-value key: a fresh key with no prior
  //   representation written by this adapter. Nothing to clean; bound 0, so
  //   fresh/routine writes never pay the legacy fallback sweep.
  // - Anything else (count or single value present without a valid HWM, or a
  //   malformed HWM): legacy/corrupt state whose recorded bound cannot be
  //   trusted; sweep up to LEGACY_SWEEP_BOUND.
  async function cleanupBound(key) {
    const hwmRaw = await SecureStore.getItemAsync(hwmKey(key));
    const countRaw = await SecureStore.getItemAsync(countKey(key));
    const hwm = parseCount(hwmRaw);
    const count = parseCount(countRaw) ?? 0;
    if (hwm != null) return Math.max(hwm, count);
    if (hwmRaw == null && countRaw == null) {
      const single = await SecureStore.getItemAsync(key);
      if (single == null) return 0;
    }
    return Math.max(count, LEGACY_SWEEP_BOUND);
  }

  // Delete chunk indices [from, to) unconditionally. Deleting an absent key is
  // a no-op, so gaps (e.g. from an interrupted earlier removal) cannot stop
  // the sweep before surviving chunks behind them.
  async function purgeChunkRange(key, from, to) {
    for (let i = from; i < to; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await SecureStore.deleteItemAsync(chunkKey(key, i));
    }
  }

  return {
    async getItem(key) {
      const countRaw = await SecureStore.getItemAsync(countKey(key));
      if (countRaw == null) {
        // Not chunked (or absent): fall back to a single-value read.
        return SecureStore.getItemAsync(key);
      }
      const count = parseInt(countRaw, 10);
      if (!Number.isFinite(count) || count <= 0) return null;
      let value = '';
      for (let i = 0; i < count; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const part = await SecureStore.getItemAsync(chunkKey(key, i));
        if (part == null) return null;
        value += part;
      }
      return value;
    },
    async setItem(key, value) {
      // Bound covering every chunk a prior (possibly larger, interrupted, or
      // inconsistently recorded) value may have left behind.
      const prevBound = await cleanupBound(key);

      const str = String(value);
      if (str.length <= SECURE_STORE_CHUNK_SIZE) {
        if (prevBound > 0) {
          // Persist the raised bound before mutating anything, so an
          // interruption mid-cleanup cannot leave the HWM understating the
          // chunks that still exist.
          await SecureStore.setItemAsync(hwmKey(key), String(prevBound));
          await purgeChunkRange(key, 0, prevBound);
        }
        await SecureStore.deleteItemAsync(countKey(key));
        // All chunks are gone; record that no chunk can exist, then store the
        // single value. The stored representation is exactly this value.
        await SecureStore.setItemAsync(hwmKey(key), '0');
        await SecureStore.setItemAsync(key, str);
        return;
      }
      const count = Math.ceil(str.length / SECURE_STORE_CHUNK_SIZE);
      // Raise the HWM before writing chunks so it never understates reality,
      // even if this write is interrupted at any point below.
      const raisedBound = Math.max(count, prevBound);
      await SecureStore.setItemAsync(hwmKey(key), String(raisedBound));
      for (let i = 0; i < count; i += 1) {
        const slice = str.slice(i * SECURE_STORE_CHUNK_SIZE, (i + 1) * SECURE_STORE_CHUNK_SIZE);
        // eslint-disable-next-line no-await-in-loop
        await SecureStore.setItemAsync(chunkKey(key, i), slice);
      }
      await SecureStore.setItemAsync(countKey(key), String(count));
      // Remove any stale single-value copy from a prior small write.
      await SecureStore.deleteItemAsync(key);
      // Purge every chunk beyond the new count that could remain from any
      // earlier state, then lower the HWM only after cleanup has completed.
      if (raisedBound > count) {
        await purgeChunkRange(key, count, raisedBound);
        await SecureStore.setItemAsync(hwmKey(key), String(count));
      }
    },
    async removeItem(key) {
      // Sweep the full authoritative bound unconditionally: gaps from an
      // interrupted earlier removal cannot hide surviving chunks, and an
      // absent, malformed, or understated count key is never trusted.
      const bound = await cleanupBound(key);
      await purgeChunkRange(key, 0, bound);
      await SecureStore.deleteItemAsync(countKey(key));
      await SecureStore.deleteItemAsync(key);
      // Drop the HWM only after every chunk deletion has completed.
      await SecureStore.deleteItemAsync(hwmKey(key));
    },
  };
}

// Resolve the platform-appropriate session storage. Web returns null so
// supabase-js uses its built-in browser localStorage path. Native uses the
// secure-store adapter; if secure store is somehow unavailable we return null
// rather than silently downgrading token material into plain AsyncStorage.
export function resolveAuthStorage(platformOS = Platform.OS) {
  if (platformOS === 'web') {
    return null;
  }
  return makeSecureStoreAdapter();
}

// Reads Supabase connection config from the environment. Returns null when the
// app is not configured for cloud mode, which keeps local-only the safe default.
// Used by the storage adapter seam to decide whether cloud is viable without
// constructing a client.
export function getSupabaseConfig() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  return { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY };
}

export function hasSupabaseConfig() {
  return getSupabaseConfig() != null;
}

// Alias retained from #318's seam contract; same meaning as hasSupabaseConfig().
export function isSupabaseConfigured() {
  return getSupabaseConfig() != null;
}

// Consent wire-protocol version, sent on every request (issue #487).
//
// The server owns a `minimum_consent_protocol_version`. At the enforcement cutover
// it is raised, and any client below the floor is denied with CLIENT_UPDATE_REQUIRED
// instead of being allowed to sync — because a client built before the health-column
// split still reads and writes the six legacy `user_profile` columns, and the
// contract migration drops them. Letting such a client through would silently lose
// the user's deload notes, tracked lifts, and fatigue data.
//
// This is a COMPATIBILITY signal, not a security one: a tampered client can claim
// any version it likes. That buys it nothing. Authorization is the consent gate,
// which no header can satisfy.
//
// Declared here rather than in storage/cloud/consent.js so the client factory does
// not have to import the consent module (which imports this one). consent.js
// re-exports it, and health-consent.test.js asserts the header the client actually
// sends matches the version consent.js advertises.
export const CONSENT_PROTOCOL_VERSION = 1;

export const CONSENT_PROTOCOL_HEADER = 'X-Kilo-Consent-Protocol';
export const CLIENT_VERSION_HEADER = 'X-Kilo-Client-Version';

let cachedClient;

// Build the Supabase client. Returns null (without throwing) when env config is
// absent so the app stays in local-only mode. The result is cached so repeated
// calls reuse a single auth/session instance.
export function getSupabaseClient() {
  if (cachedClient !== undefined) {
    return cachedClient;
  }
  if (!hasSupabaseConfig()) {
    cachedClient = null;
    return cachedClient;
  }

  const storage = resolveAuthStorage();
  const isWeb = Platform.OS === 'web';

  cachedClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    // Sent on every PostgREST and RPC call so the server can tell a consent-capable
    // client apart from one that predates the health-column split. kilo.health_gate_ok()
    // reads the protocol header out of request.headers.
    global: {
      headers: {
        [CONSENT_PROTOCOL_HEADER]: String(CONSENT_PROTOCOL_VERSION),
        [CLIENT_VERSION_HEADER]: APP_VERSION,
      },
    },
    auth: {
      ...(storage ? { storage } : {}),
      autoRefreshToken: true,
      persistSession: true,
      // PKCE is required for native Android so the OAuth callback carries
      // ?code= rather than an implicit #access_token= fragment. detectSessionInUrl
      // is kept true only on web so supabase-js can auto-exchange the code after
      // the provider redirects back; native delivers the callback via deep link
      // and we call exchangeCodeForSession explicitly.
      flowType: 'pkce',
      detectSessionInUrl: isWeb,
    },
  });
  return cachedClient;
}

// Test/maintenance hook: drop the cached client so a fresh config can be picked
// up. Not used by app runtime code.
export function resetSupabaseClientForTests() {
  cachedClient = undefined;
}

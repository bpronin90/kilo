// Supabase auth/session client boundary.
//
// This module is the single place the app constructs a Supabase client. It
// wires platform-appropriate, secure session persistence:
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

import { Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';

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
      const str = String(value);
      if (str.length <= SECURE_STORE_CHUNK_SIZE) {
        await SecureStore.deleteItemAsync(countKey(key));
        await SecureStore.setItemAsync(key, str);
        return;
      }
      const count = Math.ceil(str.length / SECURE_STORE_CHUNK_SIZE);
      for (let i = 0; i < count; i += 1) {
        const slice = str.slice(i * SECURE_STORE_CHUNK_SIZE, (i + 1) * SECURE_STORE_CHUNK_SIZE);
        // eslint-disable-next-line no-await-in-loop
        await SecureStore.setItemAsync(chunkKey(key, i), slice);
      }
      await SecureStore.setItemAsync(countKey(key), String(count));
      // Remove any stale single-value copy from a prior small write.
      await SecureStore.deleteItemAsync(key);
    },
    async removeItem(key) {
      const countRaw = await SecureStore.getItemAsync(countKey(key));
      if (countRaw != null) {
        const count = parseInt(countRaw, 10);
        if (Number.isFinite(count)) {
          for (let i = 0; i < count; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await SecureStore.deleteItemAsync(chunkKey(key, i));
          }
        }
        await SecureStore.deleteItemAsync(countKey(key));
      }
      await SecureStore.deleteItemAsync(key);
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

export function hasSupabaseConfig() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

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
    auth: {
      ...(storage ? { storage } : {}),
      autoRefreshToken: true,
      persistSession: true,
      // Native apps deliver OAuth/reset redirects via deep links, not URL hash,
      // so only the web build should auto-detect the session in the URL.
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

// Supabase client seam (shell only).
//
// This module is the single authorized place in the app where a Supabase client
// may be constructed. Screens and hooks must never import `@supabase/supabase-js`
// directly; they reach cloud behavior only through the storage adapter seam,
// which in turn reaches Supabase through this module.
//
// Scope note (Phase 3 / Task 9): this is an adapter shell. No bootstrap or sync
// behavior is implemented here. The Supabase SDK is intentionally *not* imported
// at module load. Local-only mode (the default) never touches this module, so
// the absence of the `@supabase/supabase-js` dependency cannot break local use.
//
// The client is created lazily and only when explicitly requested by a
// cloud-backed adapter in a future phase.

let cachedClient = null;

// Reads Supabase connection config from the environment. Returns null when the
// app is not configured for cloud mode, which keeps local-only the safe default.
export function getSupabaseConfig() {
  const url =
    (typeof process !== 'undefined' && process.env && process.env.EXPO_PUBLIC_SUPABASE_URL) ||
    null;
  const anonKey =
    (typeof process !== 'undefined' && process.env && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) ||
    null;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

// True when cloud config is present. Local-only mode does not require any of
// this; it exists so a future cloud adapter can decide whether cloud is viable.
export function isSupabaseConfigured() {
  return getSupabaseConfig() != null;
}

// Lazily constructs (and memoizes) the Supabase client.
//
// The SDK is required only inside this function so that importing this module —
// or the cloud adapter shell — never forces the `@supabase/supabase-js`
// dependency to be present. Callers in local mode never invoke this.
//
// Throws when cloud is not configured or the SDK is unavailable; callers must
// treat a thrown error as "cloud unavailable, stay local".
export function getSupabaseClient() {
  if (cachedClient) return cachedClient;

  const config = getSupabaseConfig();
  if (!config) {
    throw new Error('Supabase is not configured; cloud mode is unavailable.');
  }

  // Deferred require: keeps the SDK out of the module-load graph so the storage
  // seam and local mode work without the dependency installed.
  // eslint-disable-next-line global-require
  const { createClient } = require('@supabase/supabase-js');
  cachedClient = createClient(config.url, config.anonKey);
  return cachedClient;
}

// Test/seam hook to reset memoized client state.
export function __resetSupabaseClient() {
  cachedClient = null;
}

export default { getSupabaseClient, getSupabaseConfig, isSupabaseConfigured };

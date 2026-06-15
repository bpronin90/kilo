// Cloud-backed storage adapter (shell only).
//
// Scope note (Phase 3 / Task 9): this is the adapter *shell*. It defines the
// cloud adapter's method surface so the storage seam can select it, but it does
// NOT implement bootstrap, sync, or any read/write against Supabase. Every
// domain method throws `CloudNotImplementedError` until a later phase wires the
// real cloud-backed behavior.
//
// The shell deliberately mirrors the local adapter's method names exactly (via
// ADAPTER_METHODS) so the two adapters stay contract-compatible and a future
// implementation cannot silently drop a method.
//
// This module does not import the Supabase SDK or construct a client at load
// time. It only reaches the supabaseClient seam lazily, and only once real
// behavior is implemented.

import { ADAPTER_METHODS } from './localAdapter';

export class CloudNotImplementedError extends Error {
  constructor(method) {
    super(
      `Cloud storage adapter is not implemented yet (method: ${method}). ` +
        'Bootstrap and sync land in a later phase; use local mode.'
    );
    this.name = 'CloudNotImplementedError';
    this.method = method;
  }
}

// Build the shell by declaring every local adapter method as a not-implemented
// stub. This guarantees the cloud surface matches the local surface 1:1.
function buildCloudAdapterShell() {
  const adapter = { mode: 'cloud' };
  for (const method of ADAPTER_METHODS) {
    adapter[method] = () => {
      throw new CloudNotImplementedError(method);
    };
  }
  return adapter;
}

export const cloudAdapter = buildCloudAdapterShell();

export default cloudAdapter;

// R9 (#1608) issue-local fixture overlays for the shared harness
// (../fixtures.cjs is frozen). Each overlay is (storage, helpers) => storage.
// Keys and record shapes are production's (mobile/storage/sync/records.js).

// One queued local weigh-in change: the shell's dirty-queue scan reports it as
// a pending local change (no network outcome is faked).
function pendingChange(storage, { now, J, dateAgo }) {
  const id = 'r9-pending-weigh-in';
  return {
    ...storage,
    kilo_sync_dirty_weight_entries: J({ [id]: { id, date: dateAgo(0), weight: 187.6, updated_at: new Date(now).toISOString() } }),
  };
}

// The web recovery-link flag, as requestPasswordReset leaves it; paired with
// an #error= callback URL it routes to the set-new-password surface.
function recoveryPending(storage, { now }) {
  return { ...storage, 'kilo.auth.recoveryPending': String(now) };
}

module.exports = { pendingChange, recoveryPending };

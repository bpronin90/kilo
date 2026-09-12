// Per-table pull cursors and the cursor-trust logic.
//
// Split out of storage/syncQueue.js (issue #1061). A cursor is the server
// snapshot-xmin transaction boundary a completed pull returned; the engine
// advances it only from commit-safe, server-authored evidence. This module owns
// cursor persistence, pull-result normalization (extracting the cursor and the
// per-row xids the RPC supplies), the trust assessment that guards inference
// against a poisoned cursor, and the post-push advancement rule.

import { secureStorage as AsyncStorage } from '../secureStorage';
import { PULL_META_FIELD, ROW_XID_FIELD } from './records';

// AsyncStorage key prefix for the per-table pull cursor. Kept separate from
// domain data so clearing/inspecting sync state never touches the user's records.
const CURSOR_KEY_PREFIX = 'kilo_sync_cursor_';

function cursorKey(table) {
  return `${CURSOR_KEY_PREFIX}${table}`;
}

export async function getCursor(table) {
  try {
    return (await AsyncStorage.getItem(cursorKey(table))) || null;
  } catch {
    return null;
  }
}

export async function setCursor(table, cursor) {
  if (!cursor) return;
  await AsyncStorage.setItem(cursorKey(table), cursor);
}

// Exported for the reconsent cloud-rebuild rearm (issue #538): a full rebuild
// discards any cursor left over from before a withdrawal purge, so the next
// pull cannot be short-circuited by a stale boundary.
export async function clearCursor(table) {
  await AsyncStorage.removeItem(cursorKey(table));
}

// Compute the highest `updated_at` across a set of records. Sync loops pass only
// rows returned by the server (pull results and push acknowledgements); local
// dirty timestamps are device-owned and must never become pull cursors.
export function maxUpdatedAt(records, current = null) {
  let max = current || '';
  for (const rec of records || []) {
    const u = (rec && rec.updated_at) || '';
    if (u > max) max = u;
  }
  return max || null;
}

export function parseCommitSafeCursor(cursor) {
  const match = typeof cursor === 'string' ? /^xid:([0-9]+)$/.exec(cursor) : null;
  if (!match) return null;
  try {
    return BigInt(match[1]);
  } catch {
    return null;
  }
}

export function normalizePullResult(result) {
  const input = Array.isArray(result) ? result : [];
  let meta = null;
  const rows = [];

  for (const row of input) {
    if (row && row[PULL_META_FIELD]) {
      meta = row[PULL_META_FIELD];
      continue;
    }
    rows.push(row);
  }

  const rowXids = meta?.row_xids || {};
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const key = row.id ?? row.user_id;
    const xid = key == null ? null : rowXids[String(key)];
    if (xid != null) {
      Object.defineProperty(row, ROW_XID_FIELD, {
        configurable: true,
        enumerable: false,
        value: String(xid),
      });
    }
  }

  return { rows, cursor: meta?.cursor || null };
}

// ── cursor trust (issue #525, grounded in #523) ────────────────────────────────
//
// Current `xid:<n>` cursors are server-verified snapshot-xmin boundaries. A
// completed pull at C delivered every row version whose internal sync_xid is
// below C; the RPC supplies that per-row evidence for first-pass reconciliation.
// The timestamp rules below apply only to pre-#620 devices during their one-time
// full replay onto the commit-safe cursor format.
//
// The cursor CANNOT be trusted unconditionally, and this repo has the receipts.
// Issue #523 ("Keep pull cursors server-authoritative after local pushes")
// validated that `syncTable`/`syncDiffTable` used to compute the next cursor
// from `[...remote, ...dirty]`. Dirty rows carry DEVICE-clock `updated_at`,
// while `transport.push` strips the column so Postgres stamps the authoritative
// time — so a device whose clock ran ahead stored a FUTURE cursor, and every
// later server row was filtered out by `gte('updated_at', cursor)` and never
// downloaded. On such a device `updated_at <= cursor` does NOT imply "was
// delivered", and synthesising a tombstone from it would delete cloud rows this
// device never saw. That fix shipped in 0.98.2 (2026-07-19); a device upgrading
// into THIS build from any earlier release can still carry a poisoned cursor.
//
// The existing repair (`advanceCursorFromServerEvidence`, commit e05d15c) is
// REACTIVE and runs too late to help here: it clears the cursor only when a push
// acknowledgement's max `updated_at` is older than the stored cursor, which
// requires a push to have happened AND the transport to have returned
// acknowledgements, and it runs at step 5 of the pass — after the pull, and so
// after the reconciliation at step 1b that needs the answer.
//
// The cursor is therefore VALIDATED here, before any inference, against the full
// remote row set the unbaselined pass already holds. Two independent tests:
//
//   1. `cursor > max(remote.updated_at)` — provably poisoned. Cursor advancement
//      only ever takes the max `updated_at` of SERVER-AUTHORED rows, so an honest
//      cursor is always <= the newest row the server holds. This is exactly
//      #523's future-clock signature.
//   2. no remote row has `updated_at === cursor` — uncorroborated. An honest
//      cursor is never synthesised: it is always literally some server row's
//      `updated_at`. A device-clock value colliding with a server timestamp at
//      millisecond resolution is not a realistic outcome, so an exact match is
//      strong positive evidence that the value came from a real completed pull
//      rather than from a local write. (Test 2 subsumes test 1; both are kept so
//      the reported reason distinguishes #523's signature from the general case.)
//      Honest cursors DO fail this when the anchor row was changed elsewhere
//      afterwards. That is safe by design: a false "untrusted" costs one conflict
//      pass, a false "trusted" costs cloud data.
//
// KNOWN RESIDUAL, stated plainly: a cursor that was poisoned and then
// RE-ANCHORED by a later honest pull passes both tests while still hiding the
// rows skipped inside the poison window. That information was never written to
// the device and cannot be reconstructed from anything it holds. It is why the
// unresolved case below fails the pass rather than guessing.
//
// `absent` reports a MISSING cursor, which — unlike the other reasons — is not on
// its own trustworthy or untrustworthy: a device with no cursor for this table
// simply has no completed pull to contradict. What that means depends on WHICH
// device it is, and only the caller knows that (see reconcileAgainstRemote's
// `ownedDevice`). On a genuine clean device it is the ordinary first-download
// state (empty local table, full remote one) and must infer nothing and block
// nothing, or every fresh install and every #538 post-purge rebuild would wedge.
// On an OWNED device with real prior sync history whose cursor was intentionally
// cleared (#523 healing, #538 rearm) it is instead the one state in which an
// absent-local remote row can neither be classified as a signed-out delete nor
// explained as never-downloaded — so it must surface an honest conflict rather
// than silently restore the row and report success. assessCursorTrust reports the
// fact; reconcileAgainstRemote applies the device-specific policy.
export function assessCursorTrust({ cursor, remote }) {
  if (!cursor) return { trusted: false, reason: 'absent' };
  if (parseCommitSafeCursor(cursor) != null) {
    return { trusted: true, reason: 'commit-safe-boundary' };
  }
  if (Number.isNaN(Date.parse(cursor))) return { trusted: false, reason: 'malformed' };
  const rows = remote || [];
  const max = maxUpdatedAt(rows);
  if (!max || cursor > max) return { trusted: false, reason: 'ahead-of-server' };
  for (const rec of rows) {
    if (rec && rec.updated_at === cursor) return { trusted: true, reason: 'corroborated' };
  }
  return { trusted: false, reason: 'uncorroborated' };
}

export async function advanceCursorFromServerEvidence(
  table,
  cursor,
  remote,
  acknowledged,
  pullCursor = null
) {
  // A commit-safe boundary is produced by the server snapshot that bounded the
  // complete keyset pull. It is authoritative even when the page is empty and
  // must never be replaced by a row timestamp or a client wall clock.
  if (parseCommitSafeCursor(pullCursor) != null) {
    if (pullCursor !== cursor) await setCursor(table, pullCursor);
    return pullCursor;
  }

  const acknowledgementMax = maxUpdatedAt(acknowledged);

  // A successful write is stamped at the server's current time. If that
  // authoritative acknowledgement is older than our stored cursor, the cursor
  // came from the old device-clock path (or is otherwise invalid). Lowering it
  // merely to the acknowledgement would still skip rows hidden between the two
  // timestamps, so remove it and let the next pass perform a complete pull.
  if (cursor && acknowledgementMax && acknowledgementMax < cursor) {
    await clearCursor(table);
    return null;
  }

  const advanced = maxUpdatedAt([...remote, ...acknowledged], cursor);
  if (advanced && advanced !== cursor) await setCursor(table, advanced);
  return advanced;
}

// A fake sync transport that reproduces the commit-safe xid window of
// kilo.pull_sync_changes (issue #813): a pull returns rows with
// `sync_xid >= cursor AND sync_xid < boundary`, the boundary is the snapshot at
// pull time, and each push commits under one new xid at or past the boundary
// of any earlier pull. So the rows a device pushes in one pass come back to it
// on its next pull, exactly as the real server behaves. Tests that reason about
// what a device sees of its own writes must use this rather than a
// timestamp-cursor fake.
import { SYNC_TABLES } from '../../storage/syncQueue';

const SINGLETON = new Set([
  SYNC_TABLES.USER_PROFILE,
  SYNC_TABLES.USER_HEALTH_PROFILE,
  SYNC_TABLES.FEATURE_TOGGLES,
  SYNC_TABLES.WEIGHT_GOAL,
]);

export function makeXidFakeCloud() {
  const tables = {};
  for (const table of Object.values(SYNC_TABLES)) tables[table] = new Map();
  let nextXid = 1000;
  let serverMs = Date.parse('2026-08-18T00:00:00Z');
  const calls = { pull: 0, push: 0 };
  return {
    tables,
    calls,
    remoteRow: (table, id) => tables[table].get(id),
    transport: {
      async pull(table, cursor) {
        calls.pull += 1;
        const from = /^xid:(\d+)$/.test(cursor || '') ? Number(cursor.slice(4)) : 0;
        const boundary = nextXid;
        const rowXids = {};
        const rows = [...tables[table].values()]
          .filter((row) => row.__xid >= from && row.__xid < boundary)
          .sort((a, b) => (a.updated_at || '').localeCompare(b.updated_at || ''))
          .map(({ __xid, client_id: _clientId, ...row }) => { // eslint-disable-line no-unused-vars
            rowXids[String(row.id ?? row.user_id)] = String(__xid);
            if (!SINGLETON.has(table)) return row;
            const { id: _id, ...noId } = row; // eslint-disable-line no-unused-vars
            return noId;
          });
        rows.push({ __kilo_pull_meta: { cursor: `xid:${boundary}`, row_xids: rowXids } });
        return rows;
      },
      async push(table, records) {
        calls.push += 1;
        const xid = nextXid++;
        const acks = [];
        for (const rec of records) {
          const { client_id: _clientId, ...row } = rec; // eslint-disable-line no-unused-vars
          serverMs += 1;
          const stored = { ...row, updated_at: new Date(serverMs).toISOString(), __xid: xid };
          tables[table].set(rec.id, stored);
          const { __xid: _xid, ...ack } = stored; // eslint-disable-line no-unused-vars
          acks.push(ack);
        }
        return acks;
      },
    },
  };
}

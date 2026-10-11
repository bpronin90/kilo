// Omission-sensitive batching for bulk upserts (#872, #1306). PostgREST sends the
// UNION of columns in one bulk upsert, so a row that deliberately OMITS an
// optional column (absent, not null) would overwrite the server value with NULL
// if batched with a row that names it. Rows are grouped by exact key set so each
// request is uniform and an omitting row never travels in a request naming the
// column. Fixed-shape tables yield exactly one batch.
export function groupRowsByKeyShape(rows) {
  const groups = new Map();
  for (const row of rows) {
    const shape = JSON.stringify(Object.keys(row).sort());
    const existing = groups.get(shape);
    if (existing) existing.push(row);
    else groups.set(shape, [row]);
  }
  return [...groups.values()];
}

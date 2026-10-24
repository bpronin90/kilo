// Redesign v3 per-exercise history sheet (#1607): a pure presentation over the
// ONE parsed exercise occurrence the Log renderer already holds. Nothing here
// re-parses, matches by name, merges history across occurrences, converts
// units or classifies sets — it only regroups `session_entries` / `rows` in
// note order (the same walk WorkoutContentRenderer uses) and reads the
// existing parsed `weight_value` for the top-set line.

// The top-set load of one logged session, or null when the parse carries no
// numeric load to plot: bodyweight (no weight_value), timed and skipped sets
// are omitted, never charted as zero.
export function topSetLoad(sets) {
  let top = null;
  for (const set of sets || []) {
    if (set.skipped || set.duration_seconds != null) continue;
    const w = set.weight_value;
    if (typeof w !== 'number' || !Number.isFinite(w) || w <= 0) continue;
    if (top == null || w > top) top = w;
  }
  return top;
}

// Items in note order, walked exactly like WorkoutContentRenderer's units:
// kind 'logged' (sets + mark/tail/comments as parsed) and 'skipped' are
// sessions and get a 1-based `index` (the chart's x; no dates are invented);
// 'unparsed' rows (positional, inline and trailing) keep their raw text
// verbatim with `index: null`, so they are listed but never numbered/charted.
export function buildExerciseHistory(ex) {
  const sessions = [];
  if (!ex) return { sessions, points: [], sessionCount: 0 };
  let count = 0;
  const session = (s) => sessions.push({ ...s, index: ++count });
  const unparsed = (raw, error) => sessions.push({ kind: 'unparsed', raw, error, index: null });
  const entries = ex.session_entries || [];
  const positions = ex.unparsed_positions || [];
  const inline = new Set();
  let posIdx = 0;
  let loggedIdx = 0;
  entries.forEach((entry, eni) => {
    while (posIdx < positions.length && positions[posIdx].pos === eni) { unparsed(positions[posIdx].raw, positions[posIdx].error); posIdx++; }
    if (entry.skipped) session({ kind: 'skipped' });
    else if (entry.unparsed) { unparsed(entry.raw, entry.error); inline.add(entry.raw); }
    else {
      const row = ex.rows ? ex.rows[loggedIdx++] : null;
      const a = entry.annotation || null;
      session({ kind: 'logged', sets: row ? row.sets : [], mark: a ? a.mark : null, tail: a ? a.tail : null, comments: a ? a.comments || [] : [] });
    }
  });
  while (posIdx < positions.length) { unparsed(positions[posIdx].raw, positions[posIdx].error); posIdx++; }
  const loggedCount = entries.filter(e => !e.skipped && !e.unparsed).length;
  (ex.rows || []).slice(loggedCount).forEach((row) => session({ kind: 'logged', sets: row.sets, mark: null, tail: null, comments: [] }));
  const positional = new Set(positions.map(p => p.raw));
  (ex.unparsed_rows || []).forEach((u) => {
    if (!positional.has(u) && !inline.has(u) && !inline.has(u.replace(/^-\s+/, ''))) unparsed(u, null);
  });
  const points = [];
  sessions.forEach((s) => {
    const load = s.kind === 'logged' ? topSetLoad(s.sets) : null;
    s.load = load;
    if (load != null) points.push({ index: s.index, load });
  });
  return { sessions, points, sessionCount: count };
}

// Text equivalent of the chart for screen readers.
export function describeLoadPoints(points, unit, format = String) {
  if (points.length === 0) return 'No numeric load history to chart';
  return `Top-set load by session: ${points.map(p => `session ${p.index}, ${format(p.load)} ${unit}`).join('; ')}`;
}

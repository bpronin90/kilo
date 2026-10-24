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

// Sessions in note order. kind: 'logged' (sets + mark/tail/comments as
// parsed), 'skipped', or 'unparsed' (raw line kept verbatim). `index` is the
// 1-based session index — the chart's x — and only counts sessions, so a
// session-index note never gains an invented date.
export function buildExerciseHistory(ex) {
  const sessions = [];
  if (!ex) return { sessions, points: [] };
  const push = (s) => sessions.push({ ...s, index: sessions.length + 1 });
  let loggedIdx = 0;
  (ex.session_entries || []).forEach((entry) => {
    if (entry.skipped) push({ kind: 'skipped' });
    else if (entry.unparsed) push({ kind: 'unparsed', raw: entry.raw });
    else {
      const row = ex.rows ? ex.rows[loggedIdx++] : null;
      const a = entry.annotation || null;
      push({ kind: 'logged', sets: row ? row.sets : [], mark: a ? a.mark : null, tail: a ? a.tail : null, comments: a ? a.comments || [] : [] });
    }
  });
  const loggedCount = (ex.session_entries || []).filter(e => !e.skipped && !e.unparsed).length;
  (ex.rows || []).slice(loggedCount).forEach((row) => push({ kind: 'logged', sets: row.sets, mark: null, tail: null, comments: [] }));
  const points = [];
  sessions.forEach((s) => {
    const load = s.kind === 'logged' ? topSetLoad(s.sets) : null;
    s.load = load;
    if (load != null) points.push({ index: s.index, load });
  });
  return { sessions, points };
}

// Text equivalent of the chart for screen readers.
export function describeLoadPoints(points, unit, format = String) {
  if (points.length === 0) return 'No numeric load history to chart';
  return `Top-set load by session: ${points.map(p => `session ${p.index}, ${format(p.load)} ${unit}`).join('; ')}`;
}

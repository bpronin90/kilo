const _DAY_MS = 24 * 60 * 60 * 1000;
const _WEEK_MS = 7 * _DAY_MS;

function _utcDayFromIso(iso) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function _latestDeload(deloadHistory) {
  if (!deloadHistory || deloadHistory.length === 0) return null;
  return deloadHistory.reduce((best, r) =>
    !best || r.completed_at > best.completed_at ? r : best, null);
}

export function sessionDateMapFromNote(note) {
  const out = new Map();
  const checkins = note?.session_checkins;
  if (!checkins) return out;
  for (const [key, ci] of Object.entries(checkins)) {
    if (!ci || !ci.responded_at) continue;
    const idx = Number(key);
    if (!Number.isInteger(idx) || idx < 0) continue;
    out.set(idx, ci.responded_at.slice(0, 10));
  }
  return out;
}

export function sessionsSinceLastDeload(totalSessions, deloadHistory, dateMap) {
  const latest = _latestDeload(deloadHistory);
  if (!latest) return totalSessions;
  if (dateMap && dateMap.size > 0 && latest.completed_at) {
    const boundary = latest.completed_at.slice(0, 10);
    let boundaryIndex = -1;
    for (const [idx, day] of dateMap) {
      if (day <= boundary && idx > boundaryIndex) boundaryIndex = idx;
    }
    return Math.max(0, totalSessions - (boundaryIndex + 1));
  }
  return Math.max(0, totalSessions - latest.session_count);
}

export function weeksSinceLastDeload(deloadHistory) {
  const latest = _latestDeload(deloadHistory);
  if (!latest) return null;
  const deloadDay = _utcDayFromIso(latest.completed_at);
  const now = new Date(Date.now());
  const todayDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const diffMs = todayDay - deloadDay;
  if (diffMs < 0) return 0;
  return Math.floor(diffMs / _WEEK_MS);
}

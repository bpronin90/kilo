import { deriveWorkoutAnalytics, loggedSessionUnits } from './analytics';
import { normalizeExerciseKey } from './exerciseNames';

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

function sessionWitness(entry) {
  return JSON.stringify((entry?.sets || []).map(set => [
    set.weight_value ?? null, set.rep_count ?? null, set.weight_unit ?? null,
    set.duration_seconds ?? null, set.distance_meters ?? null,
  ]));
}

function workingWeight(entry) {
  const counts = new Map();
  for (const set of entry?.sets || []) {
    if (!Number.isFinite(set.weight_value) || set.weight_value <= 0 || !(set.rep_count > 0)) continue;
    counts.set(set.weight_value, (counts.get(set.weight_value) || 0) + 1);
  }
  const weights = [...counts.keys()].sort((a, b) => b - a);
  // Match the generator's working-weight choice: highest weight represented
  // by at least two sets, falling back to the highest single working set.
  return weights.find(weight => counts.get(weight) >= 2) ?? weights[0] ?? null;
}

// Pure builder for NEW records. Existing history is never retrofitted, and
// rounded generated deload loads are never inverted to invent a baseline.
// The writer must capture against the source routine before its deload starts.
export function captureDeloadWorkingContext(sections, sourceNoteId) {
  const exercises = {};
  for (const exercise of deriveWorkoutAnalytics(sections || []).exercises) {
    const units = loggedSessionUnits(exercise.occurrences.filter(occ => occ.kind !== 'warmup'));
    const latest = units[units.length - 1];
    const weight = workingWeight(latest);
    if (weight == null) continue;
    exercises[normalizeExerciseKey(exercise.name)] = {
      working_weight_lb: weight,
      logged_session_count: units.length,
      boundary_witness: sessionWitness(latest),
    };
  }
  return { version: 1, source_note_id: sourceNoteId ?? null, exercises };
}

// The completion boundary is distinct from the captured working weight. Work
// appended while the deload was active must not become a "first session back".
// Call at completion with the frozen generation context and current ordinary
// source-routine sections. Returns a new record; neither input is modified.
export function buildDeloadReentryRecord(record, capturedContext, completionSections) {
  if (!capturedContext || capturedContext.version !== 1 || !capturedContext.source_note_id) return { ...record };
  const completion = captureDeloadWorkingContext(completionSections, capturedContext.source_note_id);
  const exercises = {};
  for (const [key, baseline] of Object.entries(capturedContext.exercises || {})) {
    const boundary = completion.exercises[key];
    if (!boundary) continue;
    exercises[key] = { ...boundary, working_weight_lb: baseline.working_weight_lb };
  }
  return {
    ...record,
    pre_deload_context: { ...completion, exercises },
  };
}

// A source id and a witnessed positional boundary are required because parsed
// session rows have no timestamps. A legacy record's global session_count does
// not establish a per-exercise boundary and cannot support this label.
export function deriveDeloadReentry(sections, history, sourceNoteId) {
  if (!sourceNoteId) return {};
  const completed = (history || []).filter(record => record && !record.deleted_at && Number.isFinite(Date.parse(record.completed_at)));
  const latest = completed.reduce((best, record) => !best || Date.parse(record.completed_at) > Date.parse(best.completed_at) ? record : best, null);
  const context = latest?.pre_deload_context;
  if (!context || context.version !== 1 || context.source_note_id !== sourceNoteId) return {};
  const result = {};
  for (const exercise of deriveWorkoutAnalytics(sections || []).exercises) {
    const key = normalizeExerciseKey(exercise.name);
    const baseline = context.exercises?.[key];
    if (!baseline || !Number.isFinite(baseline.working_weight_lb) || baseline.working_weight_lb <= 0
      || !Number.isInteger(baseline.logged_session_count) || baseline.logged_session_count < 1) continue;
    const units = loggedSessionUnits(exercise.occurrences.filter(occ => occ.kind !== 'warmup'));
    const anchor = baseline.logged_session_count;
    if (units.length !== anchor + 1 || sessionWitness(units[anchor - 1]) !== baseline.boundary_witness) continue;
    const weight = workingWeight(units[anchor]);
    if (weight == null) continue;
    result[key] = {
      status: 're_entry',
      deload_id: latest.id,
      completed_at: latest.completed_at,
      pre_deload_working_weight_lb: baseline.working_weight_lb,
      current_working_weight_lb: weight,
      logged_session_ordinal: anchor,
      explanation: weight === baseline.working_weight_lb
        ? `First working session back at your pre-deload working weight (${weight} lb). This is re-entry context, not a progression trend.`
        : `First working session after deload: ${weight} lb; your recorded pre-deload working weight was ${baseline.working_weight_lb} lb. This is re-entry context, not a progression trend.`,
    };
  }
  return result;
}

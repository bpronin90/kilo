import { secureStorage as AsyncStorage } from '../secureStorage';
import { WEIGHT_GOAL_KEY } from './keys';
import { withLocalWriteLock } from '../sync/localWriteLock';

const ARCHIVED_WEIGHT_GOALS_KEY = 'kilo_archived_weight_goals';

// Read the active goal, distinguishing "no goal is stored" from "the goal could
// not be read" (#737 review).
//
// `loadWeightGoal()` below collapses both into `null`, so a UI consumer reading
// through it cannot tell an unreadable or corrupt record from a user who never
// set a goal — and would render the failure as a verified "no goal set". This
// variant is ADDITIVE and deliberately so: `loadWeightGoal()` keeps its
// swallow-and-return-null contract because the sync pass, bootstrap, export,
// and local adapter all rely on it never throwing, and turning a corrupt goal
// record into a failed sync or export would be a sync-semantic change. So the
// honest signal is offered as a separate result-shaped read that only callers
// equipped to act on a failure use.
//
// Never rejects. `{ ok: false, goal: null, error }` is the failure; `ok: true`
// with `goal: null` is a verified absence.
export async function loadWeightGoalResult() {
  try {
    const raw = await AsyncStorage.getItem(WEIGHT_GOAL_KEY);
    return { ok: true, goal: raw ? JSON.parse(raw) : null, error: null };
  } catch (error) {
    return { ok: false, goal: null, error };
  }
}

// Unchanged contract: resolves the goal or `null`, and never rejects. Every
// sync/bootstrap/export caller depends on that. New UI reads that need to tell
// failure from absence should use loadWeightGoalResult() above.
export async function loadWeightGoal() {
  const { goal } = await loadWeightGoalResult();
  return goal;
}

// The active-goal writers run under the shared local-write lock (#1399; see
// settings.js). clearWeightGoalUnlocked and replaceWeightGoalRaw are for a sync
// applyMerged that already holds it.
export function saveWeightGoal(goal) {
  return withLocalWriteLock(async () => {
    const record = { ...goal, saved_at: new Date().toISOString() };
    await AsyncStorage.setItem(WEIGHT_GOAL_KEY, JSON.stringify(record));
    return record;
  });
}

export async function clearWeightGoalUnlocked() {
  await AsyncStorage.removeItem(WEIGHT_GOAL_KEY);
}

export function clearWeightGoal() {
  return withLocalWriteLock(clearWeightGoalUnlocked);
}

// Write the active weight goal verbatim, WITHOUT re-stamping `saved_at`
// (issue #489).
//
// saveWeightGoal always overwrites `saved_at` with `now`. The cloud sync path
// compares the local goal against the last-synced snapshot to detect local
// edits, so re-stamping `saved_at` every time a pulled cloud goal is applied
// would make the goal look permanently dirty and ping-pong between devices
// forever. The sync engine applies merged goals through this raw writer instead.
// UNLOCKED by design: only a write-back that already holds the lock calls it.
export async function replaceWeightGoalRaw(goal) {
  await AsyncStorage.setItem(WEIGHT_GOAL_KEY, JSON.stringify(goal));
}

export async function loadArchivedWeightGoals() {
  try {
    const raw = await AsyncStorage.getItem(ARCHIVED_WEIGHT_GOALS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function saveArchivedWeightGoal(archivedGoal) {
  const list = await loadArchivedWeightGoals();
  list.push(archivedGoal);
  await AsyncStorage.setItem(ARCHIVED_WEIGHT_GOALS_KEY, JSON.stringify(list));
  return archivedGoal;
}

// Archive idempotency (#1477). Archiving is three durable boundaries — persist
// the archived record, enqueue it for push, clear the active goal — and any of
// them can fail after an earlier one landed. The archive id is therefore derived
// from the SOURCE goal's durable identity rather than minted per attempt, so a
// retry (same session, or after a remount/reload re-reads the same stored goal)
// resumes the same archive instead of creating a second one. saveWeightGoal
// re-stamps `saved_at` on every save, so an edited or replacement goal gets a
// different identity and is archived as its own record.
export function weightGoalIdentity(goal) {
  return JSON.stringify([
    goal?.saved_at ?? null,
    goal?.target_weight ?? null,
    goal?.target_date ?? null,
    goal?.start_weight ?? null,
    goal?.start_date ?? null,
  ]);
}

// Two FNV-1a passes with different offsets -> 64 bits of a stable, sync-safe id.
function fnv1a(str, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function archivedWeightGoalIdFor(goal) {
  const key = weightGoalIdentity(goal);
  return `ag_${fnv1a(key, 0x811c9dc5)}${fnv1a(key, 0x050c5d1f)}`;
}

// Append `record` unless an archive with its id is already durable; either way
// resolve the stored record, so a retry re-enqueues exactly what was persisted.
export function saveArchivedWeightGoalOnce(record) {
  return withLocalWriteLock(async () => {
    const list = await loadArchivedWeightGoalsRaw();
    const existing = list.find((r) => r?.id === record.id);
    if (existing) return existing;
    list.push(record);
    await replaceArchivedWeightGoalsRaw(list);
    return record;
  });
}

// Clear the active goal only if it is still the goal that was archived, so a
// replacement saved in the meantime survives. Resolves whether it cleared.
// An unreadable goal record rejects rather than being treated as a match.
export function clearWeightGoalIfMatches(goal) {
  return withLocalWriteLock(async () => {
    const raw = await AsyncStorage.getItem(WEIGHT_GOAL_KEY);
    if (!raw) return false;
    if (weightGoalIdentity(JSON.parse(raw)) !== weightGoalIdentity(goal)) return false;
    await clearWeightGoalUnlocked();
    return true;
  });
}

export async function clearArchivedWeightGoals() {
  await AsyncStorage.removeItem(ARCHIVED_WEIGHT_GOALS_KEY);
}

// Raw list access for the sync engine (mirrors weight-entries pattern).
// loadArchivedWeightGoalsRaw returns all records including sync-stamped fields.
// replaceArchivedWeightGoalsRaw overwrites the full list (used by syncTable
// writeLocal after a pull+merge).
export async function loadArchivedWeightGoalsRaw() {
  try {
    const raw = await AsyncStorage.getItem(ARCHIVED_WEIGHT_GOALS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function replaceArchivedWeightGoalsRaw(list) {
  await AsyncStorage.setItem(ARCHIVED_WEIGHT_GOALS_KEY, JSON.stringify(list));
}

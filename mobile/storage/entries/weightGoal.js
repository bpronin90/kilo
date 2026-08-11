import { secureStorage as AsyncStorage } from '../secureStorage';
import { WEIGHT_GOAL_KEY } from './keys';

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

export async function saveWeightGoal(goal) {
  const record = { ...goal, saved_at: new Date().toISOString() };
  await AsyncStorage.setItem(WEIGHT_GOAL_KEY, JSON.stringify(record));
  return record;
}

export async function clearWeightGoal() {
  await AsyncStorage.removeItem(WEIGHT_GOAL_KEY);
}

// Write the active weight goal verbatim, WITHOUT re-stamping `saved_at`
// (issue #489).
//
// saveWeightGoal always overwrites `saved_at` with `now`. The cloud sync path
// compares the local goal against the last-synced snapshot to detect local
// edits, so re-stamping `saved_at` every time a pulled cloud goal is applied
// would make the goal look permanently dirty and ping-pong between devices
// forever. The sync engine applies merged goals through this raw writer instead.
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

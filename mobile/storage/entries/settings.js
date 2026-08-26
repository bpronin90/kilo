import { secureStorage as AsyncStorage } from '../secureStorage';
import {
  FATIGUE_MULTIPLIER_KEY,
  WEIGHT_DATE_EDIT_KEY,
  DELOAD_DATE_EDIT_KEY,
  FATIGUE_TRACKING_KEY,
  DELOAD_MODE_KEY,
  TRACKED_LIFTS_KEY,
  TRACKED_LIFT_ACTIVATIONS_KEY,
  COLLAPSED_STATE_KEY,
  WEIGH_IN_REMINDER_KEY,
  WORKOUT_REMINDER_KEY,
} from './keys';
import {
  normalizeWeighInReminder,
  normalizeWorkoutReminder,
} from '../../lib/reminders';

export async function loadTrackedLifts() {
  try {
    const raw = await AsyncStorage.getItem(TRACKED_LIFTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function saveTrackedLifts(map) {
  await AsyncStorage.setItem(TRACKED_LIFTS_KEY, JSON.stringify(map));
}

// ── tracked-span activation records (#893) ──────────────────────────────────
//
// `tracked_lifts` above stays byte-identical to what it has always been: a
// name-keyed boolean map. The activation record for a key lives here instead,
// and exists ONLY while that key is currently tracked — untrack deletes the flag
// and the record together. A flag with no record is legacy boolean-only state
// and keeps full-history behavior until that exercise's next toggle.
//
// Validated on read rather than trusted: this value round-trips through cloud
// sync and backup import, and a malformed anchor would move a real progression
// boundary. Anything that does not match the shape is dropped, which degrades to
// legacy behavior — never to a wrong comparison.
function _normalizeActivationRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const anchor = value.anchor;
  if (!Number.isInteger(anchor) || anchor < 0) return null;
  const at = typeof value.at === 'string' ? value.at : null;

  let witness = null;
  const w = value.witness;
  if (w && typeof w === 'object' && !Array.isArray(w)) {
    const headings = Array.isArray(w.headings)
      ? w.headings.filter(h => h === null || typeof h === 'string')
      : null;
    const sessions = typeof w.sessions === 'string' ? w.sessions : null;
    if (headings && headings.length === (w.headings || []).length && sessions !== null) {
      witness = { headings, sessions };
    } else {
      // A partially-readable witness cannot verify anything, and an anchor
      // without a verifiable witness must not be honored.
      return null;
    }
  }
  if (anchor > 0 && witness === null) return null;
  return { anchor, at, witness };
}

export function normalizeTrackedLiftActivations(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    const record = _normalizeActivationRecord(value);
    if (record) out[key] = record;
  }
  return out;
}

// The pairing invariant: a record exists ONLY for a currently tracked key.
//
// A watermark-aware client maintains this by construction — untrack deletes the
// flag and the record in one write — so this is a no-op for anything it wrote.
// It exists for the writers that CANNOT maintain it: an older build upserts
// `tracked_lifts` without naming the activations column, so the stored records
// survive its untrack untouched. Left alone, a later retrack would find that
// stale record still matching an unchanged opening history and silently resume
// the abandoned span, pulling every session logged during the gap back into the
// trend.
//
// Enforced wherever flags arrive from outside this device (cloud pull, backup
// restore, bootstrap hydrate), and mirrored authoritatively by a trigger on the
// health table so a legacy write is invalidated at the moment it lands rather
// than only on the next device that happens to read it.
export function pruneTrackedLiftActivations(trackedLifts, activations) {
  const flags = trackedLifts || {};
  const out = {};
  for (const [key, record] of Object.entries(activations || {})) {
    if (flags[key]) out[key] = record;
  }
  return out;
}

export async function loadTrackedLiftActivations() {
  try {
    const raw = await AsyncStorage.getItem(TRACKED_LIFT_ACTIVATIONS_KEY);
    return normalizeTrackedLiftActivations(raw ? JSON.parse(raw) : {});
  } catch {
    return {};
  }
}

export async function saveTrackedLiftActivations(map) {
  await AsyncStorage.setItem(
    TRACKED_LIFT_ACTIVATIONS_KEY,
    JSON.stringify(normalizeTrackedLiftActivations(map)),
  );
}

export async function loadWorkoutCollapsed() {
  try {
    const raw = await AsyncStorage.getItem(COLLAPSED_STATE_KEY);
    return raw ? JSON.parse(raw) : false;
  } catch {
    return false;
  }
}

export async function saveWorkoutCollapsed(isCollapsed) {
  await AsyncStorage.setItem(COLLAPSED_STATE_KEY, JSON.stringify(isCollapsed));
}

export async function loadFatigueMultiplier() {
  try {
    const raw = await AsyncStorage.getItem(FATIGUE_MULTIPLIER_KEY);
    return raw ? JSON.parse(raw) : 1.07;
  } catch {
    return 1.07;
  }
}

export async function saveFatigueMultiplier(multiplier) {
  await AsyncStorage.setItem(FATIGUE_MULTIPLIER_KEY, JSON.stringify(multiplier));
}

export async function loadWeightDateEditEnabled() {
  try {
    const raw = await AsyncStorage.getItem(WEIGHT_DATE_EDIT_KEY);
    return raw ? JSON.parse(raw) : false;
  } catch {
    return false;
  }
}

export async function saveWeightDateEditEnabled(enabled) {
  await AsyncStorage.setItem(WEIGHT_DATE_EDIT_KEY, JSON.stringify(enabled));
}

export async function loadDeloadDateEditEnabled() {
  try {
    const raw = await AsyncStorage.getItem(DELOAD_DATE_EDIT_KEY);
    return raw ? JSON.parse(raw) : false;
  } catch {
    return false;
  }
}

export async function saveDeloadDateEditEnabled(enabled) {
  await AsyncStorage.setItem(DELOAD_DATE_EDIT_KEY, JSON.stringify(enabled));
}

export async function loadFatigueTrackingEnabled() {
  try {
    const raw = await AsyncStorage.getItem(FATIGUE_TRACKING_KEY);
    return raw == null ? true : JSON.parse(raw);
  } catch {
    return true;
  }
}

export async function saveFatigueTrackingEnabled(enabled) {
  await AsyncStorage.setItem(FATIGUE_TRACKING_KEY, JSON.stringify(enabled));
}

// Local reminder settings (issue #440). Persisted locally like the other
// feature toggles; both reminders default OFF via the normalizers.

export async function loadWeighInReminder() {
  try {
    const raw = await AsyncStorage.getItem(WEIGH_IN_REMINDER_KEY);
    return normalizeWeighInReminder(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeWeighInReminder(null);
  }
}

export async function saveWeighInReminder(settings) {
  await AsyncStorage.setItem(WEIGH_IN_REMINDER_KEY, JSON.stringify(normalizeWeighInReminder(settings)));
}

export async function loadWorkoutReminder() {
  try {
    const raw = await AsyncStorage.getItem(WORKOUT_REMINDER_KEY);
    return normalizeWorkoutReminder(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeWorkoutReminder(null);
  }
}

export async function saveWorkoutReminder(settings) {
  await AsyncStorage.setItem(WORKOUT_REMINDER_KEY, JSON.stringify(normalizeWorkoutReminder(settings)));
}

export async function loadDeloadModeEnabled() {
  try {
    const raw = await AsyncStorage.getItem(DELOAD_MODE_KEY);
    return raw == null ? true : JSON.parse(raw);
  } catch {
    return true;
  }
}

export async function saveDeloadModeEnabled(enabled) {
  await AsyncStorage.setItem(DELOAD_MODE_KEY, JSON.stringify(enabled));
}

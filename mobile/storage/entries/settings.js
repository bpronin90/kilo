import { secureStorage as AsyncStorage } from '../secureStorage';
import {
  FATIGUE_MULTIPLIER_KEY,
  WEIGHT_DATE_EDIT_KEY,
  DELOAD_DATE_EDIT_KEY,
  FATIGUE_TRACKING_KEY,
  DELOAD_MODE_KEY,
  PROGRESSION_SUGGESTIONS_KEY,
  TRACKED_LIFTS_KEY,
  TRACKED_LIFT_ACTIVATIONS_KEY,
  COLLAPSED_STATE_KEY,
  WEIGH_IN_REMINDER_KEY,
  WORKOUT_REMINDER_KEY,
  PLATE_CALCULATOR_PROFILE_KEY,
  REST_TIMER_KEY,
} from './keys';
import {
  normalizeWeighInReminder,
  normalizeWorkoutReminder,
} from '../../lib/reminders';
import { normalizePlateCalculatorProfile } from '../../lib/plateMath';
import { normalizeRestTimerRecord } from '../../lib/restTimer';

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
    return raw == null ? false : JSON.parse(raw);
  } catch {
    return false;
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
    return raw == null ? false : JSON.parse(raw);
  } catch {
    return false;
  }
}

export async function saveDeloadModeEnabled(enabled) {
  await AsyncStorage.setItem(DELOAD_MODE_KEY, JSON.stringify(enabled));
}

// ── Synchronous cache + subscription for the progression-suggestion UI ──────
//
// Log, Analytics and Settings all read the global flag (#958) and the
// per-exercise mute set (#960), and a change on one surface has to be visible
// on the others without a full app restart. All five tabs stay mounted (App.js
// #527), so a plain per-screen `useEffect` read would go stale the moment the
// user toggled the setting on the More tab. featureToggleHooks.js keeps
// module-level state for the other feature toggles for the same reason; #960's
// Allowed Files put the wiring in this module rather than a hook, so the shared
// state lives here.
//
// `_progressionHydrated` guards a one-time read; screens call
// `hydrateProgressionSuggestionSettings()` on mount and re-render through
// `subscribeProgressionSuggestionSettings`.
let _progressionCache = { enabled: false, mutedKeys: [] };
let _progressionHydrated = false;
const _progressionSubscribers = new Set();

function _progressionCacheEquals(next) {
  if (next.enabled !== _progressionCache.enabled) return false;
  const a = _progressionCache.mutedKeys;
  const b = next.mutedKeys;
  if (a.length !== b.length) return false;
  return a.every((k, i) => k === b[i]);
}

// Replace the cache and notify subscribers ONLY when the value actually
// changed. A no-op hydrate (the common case: an untouched store reads back the
// same default) must not push a state update into a mounted screen — that would
// fire outside the caller's `act(...)` in tests and repaint for nothing in the
// app.
function _setProgressionCache(next) {
  if (_progressionCacheEquals(next)) return _progressionCache;
  _progressionCache = next;
  for (const fn of _progressionSubscribers) {
    try { fn(_progressionCache); } catch { /* a bad listener never blocks a save */ }
  }
  return _progressionCache;
}

export function getProgressionSuggestionSettings() {
  return _progressionCache;
}

export async function hydrateProgressionSuggestionSettings({ force = false } = {}) {
  if (_progressionHydrated && !force) return _progressionCache;
  _progressionHydrated = true;
  const [enabled, mutedKeys] = await Promise.all([
    loadProgressionSuggestionsEnabled(),
    loadProgressionSuggestionMutes(),
  ]);
  return _setProgressionCache({ enabled: !!enabled, mutedKeys });
}

export function subscribeProgressionSuggestionSettings(fn) {
  _progressionSubscribers.add(fn);
  return () => _progressionSubscribers.delete(fn);
}

// Test-only reset so a suite starting from a known-empty store does not see a
// cache populated by an earlier test in the same worker.
export function __resetProgressionSuggestionSettingsForTests() {
  _progressionCache = { enabled: false, mutedKeys: [] };
  _progressionHydrated = false;
  _progressionSubscribers.clear();
}

// Progression suggestions (#958). Same shape and default-off posture as
// fatigue tracking and deload mode: an unset key, a null value, or unreadable
// storage all read as `false`, so a suggestion surface can never appear for a
// user who has not deliberately turned it on.
export async function loadProgressionSuggestionsEnabled() {
  try {
    const raw = await AsyncStorage.getItem(PROGRESSION_SUGGESTIONS_KEY);
    return raw == null ? false : JSON.parse(raw);
  } catch {
    return false;
  }
}

export async function saveProgressionSuggestionsEnabled(enabled) {
  const next = !!enabled;
  await AsyncStorage.setItem(PROGRESSION_SUGGESTIONS_KEY, JSON.stringify(next));
  _setProgressionCache({ ..._progressionCache, enabled: next });
}

// Per-exercise progression-suggestion mutes (#960). A muted exercise is
// suppressed in BOTH the Log current-routine surface and the Analytics
// strength surface; the global opt-out (above) and this set are independent,
// so turning the feature off and back on leaves the mute set untouched.
//
// The stored value is an array of normalized exercise keys — the same
// `normalizeExerciseKey` identity the rule/analytics layer consumes, never a
// display label. Anything malformed degrades to an empty set: a bad value
// never silently suppresses a suggestion the user did not mute.
//
// The key string lives here rather than in `storage/entries/keys.js` because
// #960's Allowed Files scope the settings work to this module. It is
// device-local like `PROGRESSION_SUGGESTIONS_KEY`: not synced, not part of a
// JSON backup, not written into any workout note.
const PROGRESSION_SUGGESTION_MUTES_KEY = 'kilo_progression_suggestion_mutes';

function _normalizeMuteKeys(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const key = entry.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export async function loadProgressionSuggestionMutes() {
  try {
    const raw = await AsyncStorage.getItem(PROGRESSION_SUGGESTION_MUTES_KEY);
    return _normalizeMuteKeys(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

export async function saveProgressionSuggestionMutes(keys) {
  const normalized = _normalizeMuteKeys(keys);
  await AsyncStorage.setItem(PROGRESSION_SUGGESTION_MUTES_KEY, JSON.stringify(normalized));
  _setProgressionCache({ ..._progressionCache, mutedKeys: normalized });
  return normalized;
}

export async function setProgressionSuggestionMuted(exerciseKey, muted) {
  const key = typeof exerciseKey === 'string' ? exerciseKey.trim() : '';
  if (!key) return _progressionCache.mutedKeys;
  const current = new Set(await loadProgressionSuggestionMutes());
  if (muted) current.add(key);
  else current.delete(key);
  return saveProgressionSuggestionMutes([...current]);
}

// Plate-calculator equipment profile (#577): bar weight + finite per-side
// plate inventory, kept independently per unit. See lib/plateMath.js for
// normalization/defaults.
export async function loadPlateCalculatorProfile() {
  try {
    const raw = await AsyncStorage.getItem(PLATE_CALCULATOR_PROFILE_KEY);
    return normalizePlateCalculatorProfile(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizePlateCalculatorProfile(null);
  }
}

export async function savePlateCalculatorProfile(profile) {
  await AsyncStorage.setItem(
    PLATE_CALCULATOR_PROFILE_KEY,
    JSON.stringify(normalizePlateCalculatorProfile(profile))
  );
}

// Rest timer (#577): the single active timer, or null when none is running.
// See lib/restTimer.js for normalization/validation.
export async function loadRestTimerState() {
  try {
    const raw = await AsyncStorage.getItem(REST_TIMER_KEY);
    return raw ? normalizeRestTimerRecord(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export async function saveRestTimerState(record) {
  if (record == null) {
    await AsyncStorage.removeItem(REST_TIMER_KEY);
    return;
  }
  const normalized = normalizeRestTimerRecord(record);
  if (normalized == null) {
    await AsyncStorage.removeItem(REST_TIMER_KEY);
    return;
  }
  await AsyncStorage.setItem(REST_TIMER_KEY, JSON.stringify(normalized));
}

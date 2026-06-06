import AsyncStorage from '@react-native-async-storage/async-storage';

const WEIGHT_KEY = 'kilo_weight_entries';
const WEIGHT_GOAL_KEY = 'kilo_weight_goal';
const WORKOUT_KEY = 'kilo_workout_sessions';
const WORKOUT_NOTE_KEY = 'kilo_workout_note';
const WORKOUT_NOTES_KEY = 'kilo_workout_notes';
const CURRENT_WORKOUT_ID_KEY = 'kilo_current_workout_id';
const FATIGUE_MULTIPLIER_KEY = 'kilo_fatigue_multiplier';
const WEIGHT_DATE_EDIT_KEY = 'kilo_weight_date_edit_enabled';
const WORKOUT_DELOAD_NOTE_KEY = 'kilo_workout_deload_note';
const WORKOUT_DELOAD_HISTORY_KEY = 'kilo_workout_deload_history';
const TRACKED_LIFTS_KEY = 'kilo_tracked_lifts';
const COLLAPSED_STATE_KEY = 'kilo_log_current_collapsed';
const USER_PROFILE_KEY = 'kilo_user_profile';
const DELOAD_DATE_EDIT_KEY = 'kilo_deload_date_edit_enabled';
const FATIGUE_TRACKING_KEY = 'kilo_fatigue_tracking_enabled';
const DELOAD_MODE_KEY = 'kilo_deload_mode_enabled';

function localDateToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function readList(key) {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function writeList(key, list) {
  await AsyncStorage.setItem(key, JSON.stringify(list));
}

// ── tracked lifts ─────────────────────────────────────────────────────────────

// Returns { [normalizedName]: true } for all tracked lifts.
export async function loadTrackedLifts() {
  try {
    const raw = await AsyncStorage.getItem(TRACKED_LIFTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// Write the full tracked-lifts map atomically.
// Callers must derive the next map from their own in-memory state rather than
// re-reading storage, so that rapid consecutive toggles don't race.
export async function saveTrackedLifts(map) {
  await AsyncStorage.setItem(TRACKED_LIFTS_KEY, JSON.stringify(map));
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

// ── settings ─────────────────────────────────────────────────────────────────

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

// Feature toggles. Default to enabled so existing users keep the shipped flows
// unless they explicitly turn a feature off. Disabling only hides UI/prompts;
// stored fatigue and deload data is left intact.

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

// Weight entries

export async function loadWeightEntries() {
  const list = await readList(WEIGHT_KEY);
  return list.sort((a, b) => b.logged_at.localeCompare(a.logged_at));
}

export async function saveWeightEntry(entry) {
  const list = await readList(WEIGHT_KEY);
  list.push(entry);
  await writeList(WEIGHT_KEY, list);
}

export async function deleteWeightEntry(id) {
  const list = await readList(WEIGHT_KEY);
  await writeList(WEIGHT_KEY, list.filter(e => e.id !== id));
}

export async function updateWeightEntry(id, weight_value, note, date) {
  const list = await readList(WEIGHT_KEY);
  const entry = list.find(e => e.id === id);
  if (!entry) return false;
  entry.weight_value = weight_value;
  entry.note = note;
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    if (date <= localDateToday()) {
      entry.logged_at = date + entry.logged_at.slice(10);
      entry.date = date;
    }
  }
  await writeList(WEIGHT_KEY, list);
  return true;
}

// Weight goal

export async function loadWeightGoal() {
  try {
    const raw = await AsyncStorage.getItem(WEIGHT_GOAL_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function saveWeightGoal(goal) {
  const record = { ...goal, saved_at: new Date().toISOString() };
  await AsyncStorage.setItem(WEIGHT_GOAL_KEY, JSON.stringify(record));
  return record;
}

export async function clearWeightGoal() {
  await AsyncStorage.removeItem(WEIGHT_GOAL_KEY);
}

// Workout sessions

export async function loadWorkoutSessions() {
  const list = await readList(WORKOUT_KEY);
  return list.sort((a, b) => b.date.localeCompare(a.date));
}

export async function saveWorkoutSession(session) {
  const list = await readList(WORKOUT_KEY);
  list.push(session);
  await writeList(WORKOUT_KEY, list);
}

export async function deleteWorkoutSession(id) {
  const list = await readList(WORKOUT_KEY);
  await writeList(WORKOUT_KEY, list.filter(e => e.id !== id));
}

// Workout routine note (single canonical document)

export async function loadWorkoutNote() {
  try {
    const raw = await AsyncStorage.getItem(WORKOUT_NOTE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function saveWorkoutNote(raw_text) {
  const now = new Date().toISOString();
  const existing = await loadWorkoutNote();
  const note = {
    ...existing,
    raw_text,
    saved_at: existing ? existing.saved_at : now,
    updated_at: now,
    tracked_exercises: existing?.tracked_exercises || [],
  };
  await AsyncStorage.setItem(WORKOUT_NOTE_KEY, JSON.stringify(note));
  return note;
}

export async function saveTrackedExercises(tracked_exercises) {
  const now = new Date().toISOString();
  const existing = await loadWorkoutNote();
  const note = {
    ...existing,
    tracked_exercises,
    updated_at: now,
  };
  await AsyncStorage.setItem(WORKOUT_NOTE_KEY, JSON.stringify(note));
  return note;
}

export async function saveOneKExercises(one_k_exercises) {
  const now = new Date().toISOString();
  const existing = await loadWorkoutNote();
  const note = {
    ...existing,
    one_k_exercises,
    updated_at: now,
  };
  await AsyncStorage.setItem(WORKOUT_NOTE_KEY, JSON.stringify(note));
  return note;
}

export async function clearWorkoutNote() {
  await AsyncStorage.removeItem(WORKOUT_NOTE_KEY);
}

// ── deload note (independent of routine note) ─────────────────────────────────

export async function loadDeloadNote() {
  try {
    const raw = await AsyncStorage.getItem(WORKOUT_DELOAD_NOTE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function saveDeloadNote(raw_text) {
  const now = new Date().toISOString();
  const existing = await loadDeloadNote();
  const note = {
    raw_text,
    saved_at: existing ? existing.saved_at : now,
    updated_at: now,
  };
  await AsyncStorage.setItem(WORKOUT_DELOAD_NOTE_KEY, JSON.stringify(note));
  return note;
}

export async function clearDeloadNote() {
  await AsyncStorage.removeItem(WORKOUT_DELOAD_NOTE_KEY);
}

// ── deload history ────────────────────────────────────────────────────────────

export async function loadDeloadHistory() {
  return readList(WORKOUT_DELOAD_HISTORY_KEY);
}

export async function appendDeloadHistory(record) {
  const list = await readList(WORKOUT_DELOAD_HISTORY_KEY);
  list.push(record);
  await writeList(WORKOUT_DELOAD_HISTORY_KEY, list);
}

export async function deleteDeloadHistory(id) {
  const list = await readList(WORKOUT_DELOAD_HISTORY_KEY);
  const filtered = list.filter(r => r.id !== id);
  await writeList(WORKOUT_DELOAD_HISTORY_KEY, filtered);
  return filtered;
}

export async function updateDeloadHistory(id, patch) {
  const list = await readList(WORKOUT_DELOAD_HISTORY_KEY);
  const idx = list.findIndex(r => r.id === id);
  if (idx < 0) return false;
  list[idx] = { ...list[idx], ...patch };
  await writeList(WORKOUT_DELOAD_HISTORY_KEY, list);
  return list[idx];
}

// ── multi-note workout storage ────────────────────────────────────────────────

export async function loadWorkoutNotes() {
  return readList(WORKOUT_NOTES_KEY);
}

export async function saveWorkoutNoteItem(note) {
  const list = await readList(WORKOUT_NOTES_KEY);
  const idx = list.findIndex(n => n.id === note.id);
  if (idx >= 0) {
    list[idx] = note;
  } else {
    list.push(note);
  }
  await writeList(WORKOUT_NOTES_KEY, list);
}

export async function deleteWorkoutNoteItem(id) {
  const list = await readList(WORKOUT_NOTES_KEY);
  await writeList(WORKOUT_NOTES_KEY, list.filter(n => n.id !== id));
  const currentId = await loadCurrentWorkoutId();
  if (currentId === id) {
    await clearCurrentWorkoutId();
  }
}

export async function loadCurrentWorkoutId() {
  try {
    const raw = await AsyncStorage.getItem(CURRENT_WORKOUT_ID_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function saveCurrentWorkoutId(id) {
  await AsyncStorage.setItem(CURRENT_WORKOUT_ID_KEY, JSON.stringify(id));
}

export async function clearCurrentWorkoutId() {
  await AsyncStorage.removeItem(CURRENT_WORKOUT_ID_KEY);
}

// ── user profile ─────────────────────────────────────────────────────────────

export async function loadUserProfile() {
  try {
    const raw = await AsyncStorage.getItem(USER_PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function saveUserProfile(profile) {
  const record = { ...profile, saved_at: new Date().toISOString() };
  await AsyncStorage.setItem(USER_PROFILE_KEY, JSON.stringify(record));
  return record;
}

export async function clearUserProfile() {
  await AsyncStorage.removeItem(USER_PROFILE_KEY);
}

// ── backup / restore ──────────────────────────────────────────────────────────

const BACKUP_VERSION = '3';

export async function exportBackup() {
  const weight_entries = await readList(WEIGHT_KEY);
  const workout_notes = await readList(WORKOUT_NOTES_KEY);
  const current_workout_id = await loadCurrentWorkoutId();
  const weight_goal = await loadWeightGoal();
  const fatigue_multiplier = await loadFatigueMultiplier();
  const deload_history = await readList(WORKOUT_DELOAD_HISTORY_KEY);
  return {
    version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    weight_entries,
    workout_notes,
    current_workout_id,
    weight_goal,
    fatigue_multiplier,
    deload_history,
  };
}

const SUPPORTED_VERSIONS = new Set(['1', '2', BACKUP_VERSION]);

function validateWeightEntries(entries) {
  if (!Array.isArray(entries))
    return { ok: false, error: 'Invalid backup: weight_entries must be an array' };
  for (const e of entries) {
    if (!e || typeof e !== 'object')
      return { ok: false, error: 'Invalid backup: weight entry is not an object' };
    if (typeof e.id !== 'string')
      return { ok: false, error: 'Invalid backup: weight entry missing id' };
    if (e.entry_type !== 'weight')
      return { ok: false, error: 'Invalid backup: weight entry has wrong entry_type' };
    if (typeof e.date !== 'string')
      return { ok: false, error: 'Invalid backup: weight entry missing date' };
    if (typeof e.weight_value !== 'number')
      return { ok: false, error: 'Invalid backup: weight entry missing weight_value' };
    if (typeof e.logged_at !== 'string')
      return { ok: false, error: 'Invalid backup: weight entry missing logged_at' };
  }
  return { ok: true };
}

function validateBackup(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return { ok: false, error: 'Invalid backup: not an object' };
  if (!SUPPORTED_VERSIONS.has(payload.version))
    return { ok: false, error: `Unsupported backup version: ${payload.version}` };

  const weightCheck = validateWeightEntries(payload.weight_entries);
  if (!weightCheck.ok) return weightCheck;

  if (payload.version === '2' || payload.version === BACKUP_VERSION) {
    if (!Array.isArray(payload.workout_notes))
      return { ok: false, error: 'Invalid backup: workout_notes must be an array' };
    for (const n of payload.workout_notes) {
      if (!n || typeof n !== 'object' || Array.isArray(n))
        return { ok: false, error: 'Invalid backup: workout note is not an object' };
      if (typeof n.id !== 'string')
        return { ok: false, error: 'Invalid backup: workout note missing id' };
      if (typeof n.title !== 'string')
        return { ok: false, error: 'Invalid backup: workout note missing title' };
      if (typeof n.raw_text !== 'string')
        return { ok: false, error: 'Invalid backup: workout note missing raw_text' };
    }
    if (payload.current_workout_id !== null && typeof payload.current_workout_id !== 'string')
      return { ok: false, error: 'Invalid backup: current_workout_id must be a string or null' };
    if ('weight_goal' in payload && payload.weight_goal !== null) {
      const g = payload.weight_goal;
      if (!g || typeof g !== 'object' || Array.isArray(g))
        return { ok: false, error: 'Invalid backup: weight_goal must be an object or null' };
      if (typeof g.target_weight !== 'number')
        return { ok: false, error: 'Invalid backup: weight_goal missing target_weight' };
      if (typeof g.target_date !== 'string')
        return { ok: false, error: 'Invalid backup: weight_goal missing target_date' };
    }
    if (payload.version === BACKUP_VERSION && 'deload_history' in payload) {
      if (!Array.isArray(payload.deload_history))
        return { ok: false, error: 'Invalid backup: deload_history must be an array' };
    }
  }

  return { ok: true };
}

// Restores a backup. strategy 'replace' overwrites all local data atomically.
// Returns { ok: true } or { ok: false, error: string }.
// Validation runs before any write; storage is not mutated on failure.
// v1 backups restore weight entries only; workout notes state is left untouched.
export async function importBackup(payload, strategy = 'replace') {
  const check = validateBackup(payload);
  if (!check.ok) return check;

  if (strategy === 'replace') {
    // WORKOUT_KEY (legacy sessions) is not part of the backup scope and is not touched.
    const pairs = [[WEIGHT_KEY, JSON.stringify(payload.weight_entries)]];

    if (payload.version === '2' || payload.version === BACKUP_VERSION) {
      pairs.push([WORKOUT_NOTES_KEY, JSON.stringify(payload.workout_notes)]);
      await AsyncStorage.multiSet(pairs);
      if (payload.current_workout_id != null) {
        await AsyncStorage.setItem(CURRENT_WORKOUT_ID_KEY, JSON.stringify(payload.current_workout_id));
      } else {
        await AsyncStorage.removeItem(CURRENT_WORKOUT_ID_KEY);
      }
      // weight_goal is optional in older v2 backups; only touch it when the key is present
      if ('weight_goal' in payload) {
        if (payload.weight_goal != null) {
          await AsyncStorage.setItem(WEIGHT_GOAL_KEY, JSON.stringify(payload.weight_goal));
        } else {
          await AsyncStorage.removeItem(WEIGHT_GOAL_KEY);
        }
      }
      if ('fatigue_multiplier' in payload && payload.fatigue_multiplier != null) {
        await saveFatigueMultiplier(payload.fatigue_multiplier);
      }
      if (payload.version === BACKUP_VERSION && 'deload_history' in payload) {
        await writeList(WORKOUT_DELOAD_HISTORY_KEY, payload.deload_history);
      }
    } else {
      // v1: restore weight entries only; workout notes model was not part of the v1 contract
      await AsyncStorage.multiSet(pairs);
    }
  }

  return { ok: true };
}

// One-time migration: convert the legacy single workout note (kilo_workout_note) into
// the first entry in the multi-note notebook (kilo_workout_notes), marked as current.
// No-op if the notebook already contains entries.
// Returns the notebook list after migration (empty array if nothing to migrate).
export async function migrateToNotebook() {
  const existing = await readList(WORKOUT_NOTES_KEY);

  if (existing.length > 0) {
    // Normalize pre-existing entries that are missing the new required fields.
    const needsNormalization = existing.some(n => !('isCurrent' in n));
    if (!needsNormalization) return existing;

    const currentId = await loadCurrentWorkoutId();
    const normalized = existing.map(n => {
      const base = { isCurrent: false, ...n };
      // If isCurrent was absent and this note is the stored current, promote it.
      if (!('isCurrent' in n) && currentId != null && n.id === currentId) {
        base.isCurrent = true;
      }
      return base;
    });
    await writeList(WORKOUT_NOTES_KEY, normalized);
    return normalized;
  }

  const legacyNote = await loadWorkoutNote();
  if (!legacyNote) return [];

  const now = new Date().toISOString();
  const item = {
    id: `wn_${now.slice(0, 10)}_${Date.now()}`,
    title: 'Routine 1',
    raw_text: legacyNote.raw_text || '',
    saved_at: legacyNote.saved_at || now,
    updated_at: legacyNote.updated_at || now,
    tracked_exercises: legacyNote.tracked_exercises || [],
    one_k_exercises: legacyNote.one_k_exercises || null,
    isCurrent: true,
  };

  await writeList(WORKOUT_NOTES_KEY, [item]);
  await AsyncStorage.setItem(CURRENT_WORKOUT_ID_KEY, JSON.stringify(item.id));

  return [item];
}

// Mark a note as the current routine.
// All other notes in the list are marked isCurrent: false.
// Also updates CURRENT_WORKOUT_ID_KEY for backward compatibility.
export async function setCurrentWorkoutNote(id) {
  const list = await readList(WORKOUT_NOTES_KEY);
  const updated = list.map(n => {
    if (n.id === id) {
      return { ...n, isCurrent: true };
    }
    return { ...n, isCurrent: false };
  });
  await writeList(WORKOUT_NOTES_KEY, updated);
  await AsyncStorage.setItem(CURRENT_WORKOUT_ID_KEY, JSON.stringify(id));
}

// One-time migration: synthesize a raw note from legacy structured sessions.
// No-op if the note already exists or there are no sessions to migrate.
//
// Output format uses cross-session "- entry" alignment so buildSessionsFromNote
// correctly counts sessions and HomeScreen/StatsScreen volume is accurate:
//
//   -- date1, date2      (date comment — preserved in raw_text, dropped by parser)
//   -ExerciseName
//   - 225 5,5,5          (parseable session entry for session 1)
//   - 230 5,5,5          (parseable session entry for session 2)
//   -OtherExercise
//   -                    (skip slot: exercise absent from session 1)
//   - 135 8,8,8
//
// Non-weight set fields (assistance, duration, notes) are emitted as -- comment
// lines inside the exercise block so raw_text retains the original data.
export async function migrateWorkoutNote() {
  const existing = await loadWorkoutNote();
  if (existing) return existing;
  const sessions = await readList(WORKOUT_KEY);
  if (!sessions.length) return null;

  const sorted = sessions.slice().sort((a, b) => a.date.localeCompare(b.date));

  // Collect exercise names in first-appearance order across all sessions.
  const exerciseOrder = [];
  const seen = new Set();
  for (const session of sorted) {
    for (const item of (session.items || [])) {
      if (!seen.has(item.exercise_name)) {
        seen.add(item.exercise_name);
        exerciseOrder.push(item.exercise_name);
      }
    }
  }

  // For each exercise, build one entry descriptor per session.
  // kind='weight'    → parseable "- weight reps,..." session entry
  // kind='nonweight' → unparseable but non-skip "- text" entry (assistance/duration/notes)
  // kind='skip'      → exercise absent from that session or truly empty
  const entriesByExercise = new Map();
  for (const name of exerciseOrder) {
    entriesByExercise.set(name, sorted.map(session => {
      const item = (session.items || []).find(i => i.exercise_name === name);
      if (!item) return { kind: 'skip' };

      const weightGroups = [];
      const extraParts = [];

      for (const s of (item.sets || [])) {
        if (s.weight_value != null && s.rep_count != null) {
          const prev = weightGroups[weightGroups.length - 1];
          if (prev && prev.weight === s.weight_value) {
            prev.reps.push(s.rep_count);
          } else {
            weightGroups.push({ weight: s.weight_value, reps: [s.rep_count] });
          }
          if (s.note_text) extraParts.push(`[${s.note_text}]`);
        } else {
          const parts = [];
          if (s.assistance_value != null) {
            parts.push(s.assistance_unit
              ? `assist:${s.assistance_value} ${s.assistance_unit}`
              : `assist:${s.assistance_value}`);
          }
          if (s.rep_count != null) parts.push(`×${s.rep_count}`);
          if (s.duration_seconds != null) parts.push(`${s.duration_seconds}s`);
          if (s.note_text) parts.push(`[${s.note_text}]`);
          if (parts.length) extraParts.push(parts.join(' '));
        }
      }
      if (item.note_text) extraParts.push(item.note_text);

      if (weightGroups.length > 0) {
        const row = weightGroups
          .map(({ weight, reps }) => `${weight} ${reps.join(',')}`)
          .join(' ');
        const comments = extraParts.length > 0 ? [`-- ${extraParts.join(', ')}`] : [];
        return { kind: 'weight', row, comments };
      }
      if (extraParts.length > 0) {
        return { kind: 'nonweight', text: extraParts.join(', ') };
      }
      return { kind: 'skip' };
    }));
  }

  const lines = [`-- ${sorted.map(s => s.date).join(', ')}`];
  for (const name of exerciseOrder) {
    lines.push(`-${name}`);
    for (const entry of entriesByExercise.get(name)) {
      if (entry.kind === 'weight') {
        lines.push(`- ${entry.row}`);
        for (const c of entry.comments) lines.push(c);
      } else if (entry.kind === 'nonweight') {
        lines.push(`- ${entry.text}`);
      } else {
        lines.push('-');
      }
    }
  }

  return saveWorkoutNote(lines.join('\n'));
}

// R6 (#1605) Home fixture overlays. Each starts from a shared scenario's storage
// and changes only production storage keys/records; the shared fixtures.cjs
// stays untouched.
const shared = require('../fixtures.cjs');

const MAIN = shared.MAIN_NOTE_ID;
const mapMain = (storage, fn) => ({
  ...storage,
  kilo_workout_notes: JSON.stringify(JSON.parse(storage.kilo_workout_notes).map(n => (n.id === MAIN ? fn(n) : n))),
});

// The routine's own Big 3 picked for 1K (the note-level `one_k_exercises`
// selection production stores), so a complete cycle yields a total.
function oneKSelected(storage) {
  return mapMain(storage, n => ({ ...n, one_k_exercises: { bench: 'Bench Press', squat: 'Back Squat', deadlift: 'Deadlift' } }));
}

// An active goal whose pace production flags (goalAttentionText -> Review goal).
function aggressiveGoal(storage, { now, J }) {
  return { ...oneKSelected(storage), kilo_weight_goal: J(shared.goal(now, { targetDays: 14, target: 170 })) };
}

// No current routine selected, saved routines still present ("Choose routine").
function noCurrentRoutine(storage) {
  return { ...oneKSelected(storage), kilo_current_workout_id: null };
}

// The current routine exists but has nothing written in it.
function emptyRoutine(storage) {
  return mapMain(storage, n => ({ ...n, raw_text: '' }));
}

// Recovery between weeks: week 1 completed, no week open.
function recoveryBetweenWeeks(storage, { now }) {
  const weeks = JSON.parse(storage.kilo_recovery_block_weeks).map(w => ({ ...w, completed_at: shared.isoAgo(1, now), updated_at: shared.isoAgo(1, now) }));
  return { ...storage, kilo_recovery_block_weeks: JSON.stringify(weeks) };
}

// Recovery whose open week's note is gone (production "no longer available").
function recoveryNoteMissing(storage) {
  const notes = JSON.parse(storage.kilo_workout_notes).filter(n => n.id !== shared.RECOVERY_NOTE_ID);
  return { ...storage, kilo_workout_notes: JSON.stringify(notes), kilo_current_workout_id: JSON.stringify(MAIN) };
}

// Active Recovery whose block record cannot be parsed: production's unverified
// read ("Recovery data could not be read" + Retry recovery), hero and 1K held.
function recoveryUnreadable(storage) {
  return { ...storage, kilo_recovery_blocks: '{not json' };
}

// A queued local change waiting for Cloud Sync (the dirty-queue record shape).
function pendingSync(storage, { now }) {
  const date = shared.dateAgo(0, now);
  return {
    ...oneKSelected(storage),
    kilo_sync_dirty_weight_entries: JSON.stringify({ 'w-0': { id: 'w-0', weight_value: 187.8, date, logged_at: `${date}T07:30:00.000Z`, note: '', updated_at: shared.FIXED_NOW_ISO } }),
  };
}

// Running rest timer on top of the 1K-selected account.
function timerWithOneK(storage) {
  return oneKSelected(storage);
}

module.exports = { oneKSelected, aggressiveGoal, noCurrentRoutine, emptyRoutine, recoveryBetweenWeeks, recoveryNoteMissing, recoveryUnreadable, pendingSync, timerWithOneK };

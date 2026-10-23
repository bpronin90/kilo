// R3 (#1602) fixture overlays: start from shared scenarios and change only the
// storage keys the Analytics chapter states need. Production keys and record
// shapes only (mobile/storage/entries/keys.js, recovery/check-in records).
const { MAIN_NOTE_ID, RECOVERY_BASELINE } = require('../fixtures.cjs');

// Deload mode + Session Check-ins on, with ten answered check-ins on the
// current routine (two flagged "Poor sleep"), as in the reference.
function routineHealthOn(storage, { J, isoAgo }) {
  const notes = JSON.parse(storage.kilo_workout_notes);
  const checkins = {};
  for (let i = 0; i < 10; i += 1) {
    const flagged = i === 2 || i === 6;
    checkins[String(i + 1)] = {
      responded_at: isoAgo(20 - i * 2),
      status: flagged ? 'rough' : 'ok',
      reasons: flagged ? ['Poor sleep'] : [],
    };
  }
  const next = notes.map((n) => (n.id === MAIN_NOTE_ID ? { ...n, session_checkins: checkins } : n));
  return {
    ...storage,
    kilo_workout_notes: J(next),
    kilo_fatigue_tracking_enabled: J(true),
    kilo_deload_mode_enabled: J(true),
  };
}

// Normal training with one completed Recovery block in history.
function completedRecovery(storage, { J, isoAgo }) {
  const done = isoAgo(30);
  const started = isoAgo(44);
  return {
    ...routineHealthOn(storage, { J, isoAgo }),
    kilo_recovery_blocks: J([{ id: 'rb_r3_done', baseline_note_id: MAIN_NOTE_ID, baseline_note_title: 'Upper / Lower — Block 3', baseline: RECOVERY_BASELINE, include_in_normal_analytics: false, reason: 'Travel', started_at: started, completed_at: done, saved_at: started, updated_at: done, deleted_at: null }]),
    kilo_recovery_block_weeks: J([]),
  };
}

// Active Recovery between weeks: the block is open but its only week is done.
function recoveryBetweenWeeks(storage, { J }) {
  const weeks = JSON.parse(storage.kilo_recovery_block_weeks).map((w) => ({ ...w, completed_at: w.saved_at }));
  return { ...storage, kilo_recovery_block_weeks: J(weeks) };
}

// Unreadable Recovery store: Analytics must state the condition and offer retry.
function recoveryUnreadable(storage) {
  return { ...storage, kilo_recovery_blocks: '{not json' };
}

module.exports = { routineHealthOn, completedRecovery, recoveryBetweenWeeks, recoveryUnreadable };

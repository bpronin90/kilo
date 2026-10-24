// R7 (#1606) issue-local fixture overlays for the shared harness
// (../fixtures.cjs is frozen). Each overlay is (storage, helpers) => storage.
const { J, MAIN_NOTE_ID, RECOVERY_BASELINE } = require('../fixtures.cjs');

// A short current routine that exercises the rows the Log presentation must
// keep visible: a skipped session, bodyweight, kg-converted load, timed sets
// under a duration header, an annotation, and an unparsed (warning) row.
const EDGE_ROUTINE = [
  'Monday — Full Body', '+Strength',
  '-Goblet Squat', '24kg 10,10', '26kg 10,10', '-', '28kg 10,8',
  '-Pull Up', 'BW 8,8,7', 'BW 9,8,8',
  '-Bench Press', '185 5,5,5', 'not a set line ???', '190 5,5,4 -- grindy last rep',
  '+Conditioning',
  '-Plank 3×45s', '45,45,45', '60,60,45',
  'Wednesday — Full Body',
  '-Deadlift', '315 3,3,3', '325 3,3,3',
].join('\n');

function edgeRows(storage) {
  const notes = JSON.parse(storage.kilo_workout_notes);
  const main = notes.find((n) => n.id === MAIN_NOTE_ID);
  main.raw_text = EDGE_ROUTINE;
  storage.kilo_workout_notes = J(notes);
  return storage;
}

// Settings > Deload mode on: production shows the Routine / Deload control
// only when this setting is enabled (and no recovery block owns the tab).
function deloadOn(storage) {
  storage.kilo_deload_mode_enabled = 'true';
  return storage;
}

// Valid timed-set declaration per the production parser: the header declares
// duration, and each bare integer row is therefore rendered in seconds.
function timedRows(storage) {
  const notes = JSON.parse(storage.kilo_workout_notes);
  const main = notes.find((n) => n.id === MAIN_NOTE_ID);
  main.raw_text = [
    'Monday — Full Body', '+Strength',
    '-Plank 3x30 sec', '30', '30', '45',
    '-Pull Up', 'BW 8,8,7', 'BW 9,8,8',
  ].join('\n');
  storage.kilo_workout_notes = J(notes);
  return storage;
}

// No active block, with one valid completed block and completed linked week.
// This reaches the compact Recovery entry and its completed-history manager.
function completedRecovery(storage, { isoAgo }) {
  const started = isoAgo(44);
  const completed = isoAgo(30);
  const noteId = 'wn_2026-09-21_recovery-w1';
  const notes = JSON.parse(storage.kilo_workout_notes);
  notes.push({
    id: noteId, title: 'Recovery — Week 1',
    raw_text: 'Monday — Upper\n-Bench Press\n135 8,8,8',
    saved_at: started, created_at: started, updated_at: completed,
  });
  storage.kilo_workout_notes = J(notes);
  storage.kilo_recovery_blocks = J([{
    id: 'rb_r7_done', baseline_note_id: MAIN_NOTE_ID,
    baseline_note_title: 'Upper / Lower — Block 3', baseline: RECOVERY_BASELINE,
    include_in_normal_analytics: false, reason: 'Shoulder strain',
    started_at: started, completed_at: completed, saved_at: started,
    updated_at: completed, deleted_at: null,
  }]);
  storage.kilo_recovery_block_weeks = J([{
    id: 'rw_r7_done', block_id: 'rb_r7_done', note_id: noteId,
    week_number: 1, completed_at: completed, saved_at: started,
    updated_at: completed, deleted_at: null,
  }]);
  return storage;
}

function notesUnreadable(storage) {
  storage.kilo_workout_notes = '{not json';
  return storage;
}

module.exports = {
  EDGE_ROUTINE, edgeRows, deloadOn, timedRows,
  completedRecovery, notesUnreadable,
};

// R7 (#1606) issue-local fixture overlays for the shared harness
// (../fixtures.cjs is frozen). Each overlay is (storage, helpers) => storage.
const { J, MAIN_NOTE_ID } = require('../fixtures.cjs');

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

module.exports = { EDGE_ROUTINE, edgeRows, deloadOn };

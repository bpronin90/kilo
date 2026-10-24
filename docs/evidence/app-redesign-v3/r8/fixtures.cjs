// R8 (#1607) issue-local fixture overlays for the shared harness
// (../fixtures.cjs is frozen). Each overlay is (storage, helpers) => storage.
const { J, MAIN_NOTE_ID } = require('../fixtures.cjs');

function withMainNote(raw) {
  return (storage) => {
    const notes = JSON.parse(storage.kilo_workout_notes);
    notes.find((n) => n.id === MAIN_NOTE_ID).raw_text = raw;
    storage.kilo_workout_notes = J(notes);
    return storage;
  };
}

// The same exercise name on two days (and two blocks): each history icon must
// open only its own occurrence.
const repeatedNames = withMainNote([
  'Monday — Upper', '+Strength',
  '-Bench Press', '205 5,5,5', '210 5,5,5', '215 5,5,5', '220 5,5,5', '225 5,5,5 *PR',
  'Thursday — Upper', '+Strength',
  '-Bench Press', '155 8,8,8', '160 8,8,8', '165 8,8,7',
  '+Accessories',
  '-Bench Press', 'BW 12,12', '-', '135 10,10',
].join('\n'));

// History sheet degradation: bodyweight-only, timed-only, skipped/unparsed and
// mixed rows; non-numeric sessions are listed but never charted.
const degradedRows = withMainNote([
  'Monday — Full Body', '+Strength',
  '-Pull Up', 'BW 8,8,7', 'BW 9,8,8', '-',
  '-Bench Press', '185 5,5,5', 'not a set line ???', '-', '190 5,5,4 -- grindy last rep',
  '+Conditioning',
  '-Plank 3x45 sec', '45', '60', '50',
].join('\n'));

module.exports = { repeatedNames, degradedRows };

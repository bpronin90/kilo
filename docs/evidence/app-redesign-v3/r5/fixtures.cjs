// R5 (#1604) fixture overlays: start from the shared scenarios and change only
// the storage keys the Analytics Progress states need. Production keys and
// record shapes only (kilo_workout_notes, kilo_tracked_lifts,
// kilo_tracked_lift_activations, kilo_progression_suggestions_enabled,
// kilo_progression_suggestion_mutes). The shared fixtures.cjs is not edited.
const MAIN_NOTE_ID = 'wn_2026-08-24_upper-lower';
const parse = (s, key) => JSON.parse(s[key]);

function editMain(storage, { J }, edit) {
  const notes = parse(storage, 'kilo_workout_notes').map((n) => (n.id === MAIN_NOTE_ID ? edit(n) : n));
  return { ...storage, kilo_workout_notes: J(notes) };
}

// Big 3 mapped to the routine's own lifts, so a complete cycle exists and the
// 1K panel has a total, three lifts and a session series.
function bigThree(storage, h) {
  return editMain(storage, h, (n) => ({ ...n, one_k_exercises: { bench: 'Bench Press', squat: 'Back Squat', deadlift: 'Deadlift' } }));
}

// Bench Press also on Thursday, so it is a multi-day exercise: the Monday row
// carries the cross-day comparison.
function crossDay(storage, h) {
  const withBench = editMain(storage, h, (n) => ({
    ...n,
    raw_text: n.raw_text.replace('Thursday — Upper\n+Strength\n', 'Thursday — Upper\n+Strength\n-Bench Press\n135 5,5,5\n140 5,5,5\n145 5,5,5\n150 5,5,5\n'),
  }));
  return bigThree(withBench, h);
}

// Suggestions on, and Incline Dumbbell Press declares a 3x8-10 rep range, so
// its last session (10, 10, 9 at 75 lb) yields a suggestion.
function suggestion(storage, h) {
  const edited = editMain(storage, h, (n) => ({ ...n, raw_text: n.raw_text.replace(/-Incline Dumbbell Press\n(?:[^\n]*\n){8}/, '-Incline Dumbbell Press: 3x8-10\n70 10,10,10\n70 10,10,10\n75 10,10,10\n75 10,10,10\n') }));
  return bigThree({ ...edited, kilo_progression_suggestions_enabled: 'true' }, h);
}

// Same, with the exercise muted: the muted row replaces the suggestion card.
function muted(storage, h) {
  return { ...suggestion(storage, h), kilo_progression_suggestion_mutes: h.J(['incline dumbbell press']) };
}

// Leg Press loses load session over session: a Regressing exercise.
function regressing(storage, h) {
  const down = ['-Leg Press', '460 10,10,10', '460 10,10,10', '440 10,10,10', '440 10,10,10', '420 10,10,10', '420 10,10,10', '400 10,10,10', '400 10,10,10'].join('\n');
  const edited = editMain(storage, h, (n) => ({
    ...n,
    raw_text: n.raw_text.replace(/-Leg Press\n(?:[^\n]*\n){8}/, `${down}\n`),
  }));
  return bigThree(edited, h);
}

// No exercise is tracked: the "No tracked exercises yet" state.
function untracked(storage, { J }) {
  return { ...storage, kilo_tracked_lifts: J({}), kilo_tracked_lift_activations: J({}) };
}

// Two exercises, each with one logged session after an explicit Track tap (an
// activation record at anchor 0): every tracked exercise is establishing a
// baseline.
function baseline(storage, h) {
  const { J, isoAgo } = h;
  // Only the current routine: earlier notes would give these lifts a history.
  const only = editMain(storage, h, (n) => ({
    ...n,
    raw_text: 'Monday — Upper\n+Strength\n-Bench Press\n205 5,5,5\n-Barbell Row\n165 8,8,8',
  }));
  const edited = { ...only, kilo_workout_notes: J(parse(only, 'kilo_workout_notes').filter((n) => n.id === MAIN_NOTE_ID)) };
  const rec = { anchor: 0, at: isoAgo(2), witness: null };
  return {
    ...edited,
    kilo_tracked_lifts: J({ 'bench press': true, 'barbell row': true }),
    kilo_tracked_lift_activations: J({ 'bench press': rec, 'barbell row': rec }),
  };
}

module.exports = { bigThree, crossDay, suggestion, muted, regressing, untracked, baseline };

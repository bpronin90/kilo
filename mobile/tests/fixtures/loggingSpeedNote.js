// Fixtures for the gym-logging speed benchmark (issue #940, parent #575 §8).
//
// Two canonical-text workout notes that stand in for an established user's
// real data when walking the three representative logging tasks:
//
//   PPL_CUMULATIVE_NOTE  - a 3-day Push/Pull/Legs cumulative note, one exercise
//                          block per lift with ~11 prior logged sessions each,
//                          ~180 lines. Drives T1 (full push session) and
//                          T2 (single-lift touch-up).
//   AB_ROUTINE_NOTE      - a 2-day A/B routine (Upper/Lower, alternating weeks)
//                          with a `---` week separator. Drives T3 (A/B Week B
//                          day).
//
// Both are built programmatically from small lift tables so the row values
// carry a believable progressive-overload trend and the line count stays
// stable across edits. Both parse cleanly under `parseWorkoutNote`
// (`ok: true`, `problems: []`); the benchmark's fixture-sanity test asserts
// that, so a grammar change that breaks the fixture is caught here rather
// than silently skewing the action counts.

// [name, startingWeight, repsPerSet, setsPerSession]
const PUSH_LIFTS = [
  ['Bench Press', 185, 5, 3],
  ['Overhead Press', 95, 5, 3],
  ['Incline DB Press', 60, 8, 3],
  ['Triceps Pushdown', 50, 12, 3],
  ['Lateral Raise', 15, 15, 3],
];

const PULL_LIFTS = [
  ['Deadlift', 275, 5, 1],
  ['Barbell Row', 155, 8, 3],
  ['Lat Pulldown', 130, 10, 3],
  ['Face Pull', 40, 15, 3],
  ['Barbell Curl', 65, 10, 3],
];

const LEG_LIFTS = [
  ['Squat', 225, 5, 3],
  ['Romanian Deadlift', 185, 8, 3],
  ['Leg Press', 320, 10, 3],
  ['Leg Curl', 90, 12, 3],
  ['Standing Calf Raise', 110, 15, 3],
];

const AB_UPPER_LIFTS = [
  ['Bench Press', 185, 5, 3],
  ['Weighted Pull-Up', 25, 6, 3],
  ['Seated DB Press', 55, 8, 3],
  ['Cable Row', 140, 10, 3],
];

const AB_LOWER_LIFTS = [
  ['Squat', 225, 5, 3],
  ['Romanian Deadlift', 185, 8, 3],
  ['Leg Press', 320, 10, 3],
  ['Standing Calf Raise', 110, 15, 3],
];

// One logged set row for session index `i` (0-based). Weight steps up 5 lb
// every second session so the block reads like a real progression history.
function sessionRow(startingWeight, reps, sets, i) {
  const weight = startingWeight + 5 * Math.floor(i / 2);
  const repList = Array.from({ length: sets }, () => reps).join(',');
  return `${weight} ${repList}`;
}

function exerciseBlock([name, startingWeight, reps, sets], priorSessions) {
  const lines = [`-${name}`];
  for (let i = 0; i < priorSessions; i++) {
    lines.push(sessionRow(startingWeight, reps, sets, i));
  }
  return lines.join('\n');
}

function dayBlock(heading, lifts, priorSessions) {
  return [heading, ...lifts.map((l) => exerciseBlock(l, priorSessions))].join('\n');
}

// ── PPL cumulative note ──────────────────────────────────────────────────────

export const PPL_PRIOR_SESSIONS_PER_LIFT = 11;

export const PPL_CUMULATIVE_NOTE = [
  dayBlock('Monday', PUSH_LIFTS, PPL_PRIOR_SESSIONS_PER_LIFT),
  '',
  dayBlock('Wednesday', PULL_LIFTS, PPL_PRIOR_SESSIONS_PER_LIFT),
  '',
  dayBlock('Friday', LEG_LIFTS, PPL_PRIOR_SESSIONS_PER_LIFT),
  '',
].join('\n');

// ── A/B routine note ────────────────────────────────────────────────────────

export const AB_PRIOR_SESSIONS_PER_LIFT = 6;

export const AB_ROUTINE_NOTE = [
  dayBlock('Monday', AB_UPPER_LIFTS, AB_PRIOR_SESSIONS_PER_LIFT),
  '',
  dayBlock('Thursday', AB_LOWER_LIFTS, AB_PRIOR_SESSIONS_PER_LIFT),
  '',
  '---',
  '',
  dayBlock('Monday', AB_UPPER_LIFTS, AB_PRIOR_SESSIONS_PER_LIFT),
  '',
  dayBlock('Thursday', AB_LOWER_LIFTS, AB_PRIOR_SESSIONS_PER_LIFT),
  '',
].join('\n');

// ── Today's working sets (what each task types) ─────────────────────────────
//
// The row each task appends per exercise. Kept verbatim here so the benchmark
// and the living doc agree on exactly what is being typed.

// T1 - full push session: one working row per Monday/Push lift.
export const T1_PUSH_ROWS = [
  '225 5,5,5', // Bench Press
  '105 5,5,5', // Overhead Press
  '70 8,8,8', // Incline DB Press
  '55 12,12,12', // Triceps Pushdown
  '20 15,15,15', // Lateral Raise
];

// T2 - single-lift touch-up: one row added to a single lift ~two-thirds down
// the note (Friday / Romanian Deadlift).
export const T2_TOUCHUP_LIFT = 'Romanian Deadlift';
export const T2_TOUCHUP_ROW = '205 8,8,8';

// T3 - A/B Week B day: one working row per Week B Monday/Upper lift.
export const T3_WEEK_B_DAY = 'Monday';
export const T3_WEEK_B_ROWS = [
  '205 5,5,5', // Bench Press
  '35 6,6,6', // Weighted Pull-Up
  '60 8,8,8', // Seated DB Press
  '150 10,10,10', // Cable Row
];

export const FIXTURE_META = {
  pplLineCount: PPL_CUMULATIVE_NOTE.split('\n').length,
  pplLiftCount: PUSH_LIFTS.length + PULL_LIFTS.length + LEG_LIFTS.length,
  abLineCount: AB_ROUTINE_NOTE.split('\n').length,
};

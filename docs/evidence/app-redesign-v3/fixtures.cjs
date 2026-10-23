// Shared seeded scenarios for the app-redesign-v3 real-app capture harness (#1600).
//
// FROZEN SHARED API: downstream redesign issues import this module read-only and
// put their own overlays in docs/evidence/app-redesign-v3/<rid>/fixtures.cjs.
// Never edit this file from a downstream issue.
//
// Every scenario is a pure function of the fixed fixture clock (FIXED_NOW), so two
// runs seed byte-identical storage. Values are written verbatim into the web
// export's localStorage (web storage is plain, not encrypted) using the app's own
// production keys and record shapes; nothing here changes production storage.
// Illustrative numbers only: they are not product data.

const FIXED_NOW_ISO = '2026-10-23T12:00:00.000Z';
const FIXED_NOW = Date.parse(FIXED_NOW_ISO);
const DAY = 86400000;

const isoAgo = (days, now = FIXED_NOW) => new Date(now - days * DAY).toISOString();
const dateAgo = (days, now = FIXED_NOW) => isoAgo(days, now).slice(0, 10);

// Session-based routine: each line under an exercise is one logged session.
const prog = (start, step, n, reps) => Array.from({ length: n }, (_, i) => `${start + step * Math.floor(i / 2)} ${reps}`);
const ROUTINE_LINES = [
  'Monday — Upper', '+Strength',
  '-Bench Press', ...prog(205, 5, 10, '5,5,5'),
  '-Barbell Row', ...prog(165, 5, 10, '8,8,8'),
  '+Accessories',
  '-Incline Dumbbell Press', ...prog(60, 5, 8, '10,10,9'),
  '-Lateral Raise', ...prog(20, 0, 8, '15,15,12'),
  '-Triceps Pushdown', ...prog(55, 5, 8, '12,12,10'),
  'Tuesday — Lower', '+Strength',
  '-Back Squat', ...prog(275, 5, 10, '5,5,5'),
  '-Romanian Deadlift', ...prog(205, 10, 8, '8,8,8'),
  '+Accessories',
  '-Leg Press', ...prog(360, 20, 8, '10,10,10'),
  '-Standing Calf Raise', ...prog(180, 0, 8, '15,15,15'),
  'Thursday — Upper', '+Strength',
  '-Overhead Press', ...prog(115, 5, 9, '6,6,6'),
  '-Pull Up', 'BW 8,8,7', 'BW 8,8,8', 'BW 9,8,8', 'BW 9,9,8', 'BW 10,9,8', 'BW 10,9,9', 'BW 10,10,9', 'BW 10,10,10',
  '+Accessories',
  '-Face Pull', ...prog(50, 0, 8, '15,15,15'),
  '-EZ Bar Curl', ...prog(65, 5, 8, '10,10,8'),
  'Friday — Lower', '+Strength',
  '-Deadlift', ...prog(365, 10, 9, '3,3,3'),
  '-Walking Lunge', ...prog(40, 5, 8, '10,10'),
  '-Cable Crunch', '12,12,12', '12,12,12', '15,12,12', '15,15,12', '15,15,15', '15,15,15',
];
const ROUTINE = ROUTINE_LINES.join('\n');
// Week A / Week B routine: production's `---` separator splits the two weeks.
const ROUTINE_AB = [
  ROUTINE,
  '---',
  'Monday — Upper B', '+Strength',
  '-Incline Bench Press', ...prog(165, 5, 6, '6,6,6'),
  '-Chest Supported Row', ...prog(135, 5, 6, '10,10,10'),
  'Tuesday — Lower B', '+Strength',
  '-Front Squat', ...prog(185, 5, 6, '5,5,5'),
  '-Hip Thrust', ...prog(225, 10, 6, '10,10,10'),
].join('\n');
const PREV = 'Monday — Push\n-Bench Press\n185 5,5,5\n190 5,5,5\n195 5,5,4\nTuesday — Pull\n-Deadlift\n335 3,3,3\n345 3,3,3\nWednesday — Legs\n-Back Squat\n245 5,5,5\n255 5,5,5';
const RECOVERY_WEEK = 'Monday — Upper\n-Bench Press\n135 8,8,8\n145 8,8,8\n-Barbell Row\n115 10,10,10\nTuesday — Lower\n-Back Squat\n185 8,8,8\n-Romanian Deadlift\n135 10,10,10\nThursday — Upper\n-Overhead Press\n75 10,10,10\nFriday — Lower\n-Deadlift\n225 5,5,5';

const MAIN_NOTE_ID = 'wn_2026-08-24_upper-lower';
const RECOVERY_NOTE_ID = 'wn_2026-10-19_recovery-w1';

function notes(now, { raw = ROUTINE, extra = [] } = {}) {
  return [
    { id: MAIN_NOTE_ID, title: 'Upper / Lower — Block 3', raw_text: raw, saved_at: isoAgo(59, now), created_at: isoAgo(59, now), updated_at: isoAgo(1, now) },
    { id: 'wn_2026-05-11_ppl', title: 'Push Pull Legs', raw_text: PREV, saved_at: isoAgo(164, now), created_at: isoAgo(164, now), updated_at: isoAgo(60, now) },
    { id: 'wn_2026-02-02_5x5', title: 'Strength 5×5', raw_text: 'Monday\n-Back Squat\n225 5,5,5,5,5\n235 5,5,5,5,5', saved_at: isoAgo(262, now), created_at: isoAgo(262, now), updated_at: isoAgo(165, now) },
    ...extra,
  ];
}

const TRACKED_NAMES = ['Bench Press', 'Barbell Row', 'Back Squat', 'Romanian Deadlift', 'Overhead Press', 'Pull Up', 'Deadlift', 'Incline Dumbbell Press', 'Leg Press'];
function tracked() {
  const out = {};
  for (const n of TRACKED_NAMES) { out[n.toLowerCase()] = true; out[n] = true; }
  return out;
}

// ~43 weigh-ins over 62 days, trending down with a deterministic wobble.
function weights(now, { days = 62, count = null } = {}) {
  const out = [];
  for (let d = days; d >= 0; d -= (d % 3 === 0 ? 2 : 1)) {
    const w = 192.4 - (days - d) * 0.075 + Math.sin(d * 1.7) * 0.6;
    const date = dateAgo(d, now);
    out.push({ id: `w-${d}`, weight_value: Math.round(w * 10) / 10, date, logged_at: `${date}T07:30:00.000Z`, note: d % 9 === 0 ? 'Morning, fasted' : '' });
  }
  return count == null ? out : out.slice(-count);
}

function goal(now, { startWeight = 192.4, targetDays = 70, target = 183 } = {}) {
  const g = { target_weight: target, target_date: dateAgo(-targetDays, now), saved_at: isoAgo(40, now) };
  if (startWeight != null) g.start_weight = startWeight;
  return g;
}

// Frozen v2 baseline captured from the main routine's strength lifts by
// production's captureRecoveryBaselineFromText (lib/data/recoveryBlocks.js).
const RECOVERY_BASELINE = { version: 2, exercises: [
  ['bench press', 'Bench Press', 225, 5, 3375, 0], ['barbell row', 'Barbell Row', 185, 8, 4440, 1],
  ['squat', 'Squat', 295, 5, 4425, 2], ['rdl', 'RDL', 235, 8, 5640, 3],
  ['overhead press', 'Overhead Press', 135, 6, 2430, 4], ['deadlift', 'Deadlift', 405, 3, 3645, 5],
].map(([key, name, w, reps, volume, order]) => ({
  key, name, exercise_class: 'weighted', best_e1rm_weight: w, best_e1rm_reps: reps, top_weight: w,
  volume, sets_completed: 3, routine_order: order, basis: 'no_declaration',
})) };

function recovery(now) {
  const started = isoAgo(5, now);
  return {
    blocks: [{ id: 'rb_fixture_1', baseline_note_id: MAIN_NOTE_ID, baseline_note_title: 'Upper / Lower — Block 3', baseline: RECOVERY_BASELINE, include_in_normal_analytics: false, reason: 'Shoulder strain', started_at: started, completed_at: null, saved_at: started, updated_at: started, deleted_at: null }],
    weeks: [{ id: 'rw_fixture_1', block_id: 'rb_fixture_1', note_id: RECOVERY_NOTE_ID, week_number: 1, completed_at: null, saved_at: started, updated_at: started, deleted_at: null }],
    note: { id: RECOVERY_NOTE_ID, title: 'Recovery — Week 1', raw_text: RECOVERY_WEEK, saved_at: started, created_at: started, updated_at: isoAgo(1, now) },
  };
}

const WALKTHROUGH_DISMISSED = '{"version":1,"dismissed":true}';
const J = (v) => JSON.stringify(v);

// Base storage shared by every scenario: walkthrough dismissed so it never covers
// a capture (use the `first-use` scenario to see it).
function base() {
  return { 'kilo:welcome-walkthrough:v1': WALKTHROUGH_DISMISSED };
}

function populated(now, opts = {}) {
  return {
    ...base(),
    kilo_workout_notes: J(notes(now, opts)),
    kilo_current_workout_id: J(opts.currentId || MAIN_NOTE_ID),
    kilo_tracked_lifts: J(tracked()),
    kilo_weight_entries: J(weights(now)),
    kilo_weight_goal: J(goal(now)),
  };
}

// name -> { description, marker, build(now) -> storage map }. `marker` is the smoke
// check that proves the state was reached: { tab, text } must be visible on that tab's
// first screen, or { tab, absent } must not be.
// A `null` storage value removes that key.
const SCENARIOS = {
  populated: { description: 'Upper/Lower routine (current, week 9), 3 notes, 43 weigh-ins, active cutting goal with start_weight', marker: { tab: 'Home', text: 'Cutting' }, build: (now) => populated(now) },
  'routine-ab': { description: 'populated, but the current routine has Week A / Week B halves (--- separator)', marker: { tab: 'Log', text: 'Week B' }, build: (now) => populated(now, { raw: ROUTINE_AB }) },
  'no-goal': { description: 'populated without any weight goal', marker: { tab: 'Home', absent: 'Cutting' }, build: (now) => ({ ...populated(now), kilo_weight_goal: null }) },
  'goal-no-start': { description: 'populated; active goal has no stored start_weight (no progress bar may be invented)', marker: { tab: 'Home', text: 'Cutting' }, build: (now) => ({ ...populated(now), kilo_weight_goal: J(goal(now, { startWeight: null })) }) },
  'goal-ended': { description: 'populated; goal target date already passed (production "Goal ended" / review state)', marker: { tab: 'Home', text: 'Goal ended' }, build: (now) => ({ ...populated(now), kilo_weight_goal: J(goal(now, { targetDays: -3 })) }) },
  'goal-unreadable': { description: 'populated; stored goal record is corrupt JSON (goal read-failure state)', marker: { tab: 'Weight', text: 'Could not load your weight goal' }, build: (now) => ({ ...populated(now), kilo_weight_goal: '{not json' }) },
  'weigh-in-empty': { description: 'routine present, no weigh-ins, no goal', marker: { tab: 'Home', absent: '187.8' }, build: (now) => ({ ...populated(now), kilo_weight_entries: J([]), kilo_weight_goal: null }) },
  'weigh-in-one': { description: 'routine present, exactly one weigh-in (insufficient-data copy), no goal', marker: { tab: 'Home', text: '187.8' }, build: (now) => ({ ...populated(now), kilo_weight_entries: J(weights(now, { count: 1 })), kilo_weight_goal: null }) },
  'recovery-active': { description: 'populated plus an active Recovery block (week 1 note is current, baseline = main routine)', marker: { tab: 'Log', text: 'Recovery' }, build: (now) => {
    const r = recovery(now);
    return { ...populated(now, { extra: [r.note], currentId: RECOVERY_NOTE_ID }), kilo_recovery_blocks: J(r.blocks), kilo_recovery_block_weeks: J(r.weeks) };
  } },
  'timer-running': { description: 'populated plus a 3:00 rest timer started 30 s before FIXED_NOW', marker: { tab: 'Home', text: 'Cancel' }, build: (now) => {
    const startedAtMs = now - 30000;
    return { ...populated(now), kilo_rest_timer: J({ version: 1, timerId: 'rt_fixture', startedAtMs, durationSec: 180, endsAtMs: startedAtMs + 180000, exerciseLabel: 'Bench Press', notificationId: null, notificationScheduled: false }) };
  } },
  empty: { description: 'signed-in account with no routine, weigh-ins or goal; walkthrough dismissed', marker: { tab: 'Home', text: 'Welcome to Kilo' }, build: () => base() },
  'first-use': { description: 'empty account and the welcome walkthrough not yet dismissed', marker: { tab: 'Home', text: '1 of 5' }, build: () => ({ 'kilo:welcome-walkthrough:v1': null }) },
};

// Resolve a scenario (name or { build }) plus optional overlay into a storage map.
// overlay: (storage, { now, J, isoAgo, dateAgo }) => storage. Returning a new map
// or mutating the given one both work.
function scenarioStorage(scenario, { overlay = null, now = FIXED_NOW } = {}) {
  const def = typeof scenario === 'string' ? SCENARIOS[scenario] : scenario;
  if (!def || typeof def.build !== 'function') throw new Error(`Unknown scenario: ${scenario}. Known: ${Object.keys(SCENARIOS).join(', ')}`);
  const storage = def.build(now);
  const helpers = { now, J, isoAgo: (d) => isoAgo(d, now), dateAgo: (d) => dateAgo(d, now) };
  return overlay ? (overlay(storage, helpers) || storage) : storage;
}

module.exports = {
  FIXED_NOW, FIXED_NOW_ISO, DAY, SCENARIOS, scenarioStorage,
  // Building blocks for downstream overlays.
  isoAgo, dateAgo, prog, J, ROUTINE, ROUTINE_AB, PREV, RECOVERY_WEEK, MAIN_NOTE_ID, RECOVERY_NOTE_ID,
  RECOVERY_BASELINE, WALKTHROUGH_DISMISSED, notes, tracked, weights, goal, recovery, populated, base,
};

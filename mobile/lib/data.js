// Native entry model factories and exercise catalog
import { deriveTrackedPRs } from './parser.js';
import { classifyWeightPace } from './format.js';

export const KILO_SPLIT = {
  monday:    { label: 'Push',       sub: 'Chest · Shoulders · Tris' },
  tuesday:   { label: 'Squat',      sub: 'Legs' },
  wednesday: { label: 'Pull',       sub: 'Back · Bis' },
  thursday:  { label: 'Push Upper', sub: 'Incline · Accessories' },
  friday:    { label: 'Deadlift',   sub: 'Posterior · Legs' },
};

// Exercise catalog — metadata only, no history
// cat: warmup | core | primary_compound | secondary_compound | accessory
export const KILO_EXERCISES = [
  // MONDAY
  { id: 'mon_bike',         day: 'monday',    name: 'Bike',                      cat: 'warmup',             po: false, target: '5 min' },
  { id: 'mon_pec_stretch',  day: 'monday',    name: 'Pec stretch — roller',      cat: 'warmup',             po: false, target: '2×60s' },
  { id: 'mon_band_pa',      day: 'monday',    name: 'Band pull-aparts',           cat: 'warmup',             po: false, target: '2×15 light' },
  { id: 'mon_cuff',         day: 'monday',    name: 'Rotator cuff cable',         cat: 'warmup',             po: false, target: '1×12–15 ea, 12.5 lb' },
  { id: 'db_bench',         day: 'monday',    name: 'DB Bench Press',             cat: 'primary_compound',   po: true,  target: '4×6–8' },
  { id: 'cable_fly',        day: 'monday',    name: 'Low-to-High Cable Fly',      cat: 'accessory',          po: false, target: '2×12' },
  { id: 'lateral',          day: 'monday',    name: 'Lateral Raise',              cat: 'accessory',          po: false, target: '2×12' },
  { id: 'hammer_curl_mon',  day: 'monday',    name: 'Hammer Curl',                cat: 'accessory',          po: true,  target: '2×8–10' },
  { id: 'sa_pushdown_mon',  day: 'monday',    name: 'Single-Arm Pushdown',        cat: 'accessory',          po: false, target: '2×10–12' },
  { id: 'inout',            day: 'monday',    name: 'In-and-outs (bench)',        cat: 'core',               po: false, target: '2×10–12' },

  // TUESDAY
  { id: 'tue_bike',         day: 'tuesday',   name: 'Bike',                       cat: 'warmup',             po: false, target: '5 min' },
  { id: 'hip9090',          day: 'tuesday',   name: '90/90 hip stretch',          cat: 'warmup',             po: false, target: '60s ea side' },
  { id: 'hipflex',          day: 'tuesday',   name: 'Hip flexor stretch',         cat: 'warmup',             po: false, target: '60s ea side' },
  { id: 'leg_swing',        day: 'tuesday',   name: 'Leg swings · forward+lat',  cat: 'warmup',             po: false, target: '12–15 ea' },
  { id: 'bw_squat',         day: 'tuesday',   name: 'Bodyweight squats',          cat: 'warmup',             po: false, target: '10' },
  { id: 'squat',            day: 'tuesday',   name: 'Squat',                      cat: 'primary_compound',   po: true,  target: '4×6–8' },
  { id: 'sl_ext',           day: 'tuesday',   name: 'Single-Leg Extension',       cat: 'accessory',          po: true,  target: '3×10–12' },
  { id: 'leg_press',        day: 'tuesday',   name: 'Leg Press',                  cat: 'secondary_compound', po: true,  target: '2×12 (calf SS)' },
  { id: 'calf_raise',       day: 'tuesday',   name: 'Calf Raises',                cat: 'accessory',          po: true,  target: '2×12' },
  { id: 'plank',            day: 'tuesday',   name: 'Plank',                      cat: 'core',               po: false, target: '2×30–45s' },

  // WEDNESDAY
  { id: 'wed_bike',         day: 'wednesday', name: 'Bike',                       cat: 'warmup',             po: false, target: '5 min' },
  { id: 'trx_row',          day: 'wednesday', name: 'TRX Rows',                   cat: 'warmup',             po: false, target: '10' },
  { id: 'wed_band',         day: 'wednesday', name: 'Band pull-aparts',           cat: 'warmup',             po: false, target: '2×15' },
  { id: 'sleeper',          day: 'wednesday', name: 'Sleeper stretch',            cat: 'warmup',             po: false, target: '60s ea' },
  { id: 'cat_cow',          day: 'wednesday', name: 'Cat-cow',                    cat: 'warmup',             po: false, target: '2×10' },
  { id: 'iso_row',          day: 'wednesday', name: 'Hammer Strength Iso Row',    cat: 'primary_compound',   po: true,  target: '3×6–8' },
  { id: 'lat_pd',           day: 'wednesday', name: 'Lat Pulldown',               cat: 'secondary_compound', po: true,  target: '2×10–12' },
  { id: 'face_pull',        day: 'wednesday', name: 'Face Pulls',                 cat: 'accessory',          po: false, target: '2×15' },
  { id: 'rev_pec',          day: 'wednesday', name: 'Reverse Pec Deck',           cat: 'accessory',          po: true,  target: '2×10–12' },
  { id: 'hammer_curl_wed',  day: 'wednesday', name: 'Hammer Curl',                cat: 'accessory',          po: true,  target: '2×8–10' },
  { id: 'deadbug',          day: 'wednesday', name: 'Dead bugs',                  cat: 'core',               po: false, target: '2×8 ea' },

  // THURSDAY
  { id: 'thu_bike',         day: 'thursday',  name: 'Bike',                       cat: 'warmup',             po: false, target: '5 min' },
  { id: 'wall_slide',       day: 'thursday',  name: 'Scapular wall slides',       cat: 'warmup',             po: false, target: '10–20' },
  { id: 'thu_pec',          day: 'thursday',  name: 'Pec stretch · roller',       cat: 'warmup',             po: false, target: '60s' },
  { id: 'thu_cuff',         day: 'thursday',  name: 'Rotator cuff cable',         cat: 'warmup',             po: false, target: '1×12–15 ea' },
  { id: 'incline_db',       day: 'thursday',  name: 'Incline DB Press',           cat: 'primary_compound',   po: true,  target: '3×8–10' },
  { id: 'pec_deck',         day: 'thursday',  name: 'Pec Deck',                   cat: 'accessory',          po: true,  target: '2×10–12' },
  { id: 'hs_press',         day: 'thursday',  name: 'HS Shoulder Press',          cat: 'secondary_compound', po: false, target: '2×8–10' },
  { id: 'cable_row',        day: 'thursday',  name: 'Seated Cable Row',           cat: 'secondary_compound', po: true,  target: '2×10–12' },
  { id: 'skull',            day: 'thursday',  name: 'Skull Crushers',             cat: 'accessory',          po: true,  target: '2×8–10' },
  { id: 'sa_pushdown_thu',  day: 'thursday',  name: 'Single-Arm Pushdown',        cat: 'accessory',          po: false, target: '2×10–12' },

  // FRIDAY
  { id: 'fri_bike',         day: 'friday',    name: 'Bike',                       cat: 'warmup',             po: false, target: '5 min' },
  { id: 'banded_legs',      day: 'friday',    name: 'Banded leg raises',          cat: 'warmup',             po: false, target: '10 ea' },
  { id: 'hams_band',        day: 'friday',    name: 'Hamstring stretch (band)',   cat: 'warmup',             po: false, target: '60–90s ea' },
  { id: 'fri_9090',         day: 'friday',    name: '90/90 hip stretch',          cat: 'warmup',             po: false, target: '60s ea' },
  { id: 'bar_dl',           day: 'friday',    name: 'Light deadlift · bar',       cat: 'warmup',             po: false, target: '10' },
  { id: 'deadlift',         day: 'friday',    name: 'Deadlift',                   cat: 'primary_compound',   po: true,  target: '4×4–6' },
  { id: 'rdl',              day: 'friday',    name: 'RDL',                        cat: 'secondary_compound', po: true,  target: '2×8–10' },
  { id: 'sl_rdl',           day: 'friday',    name: 'Single-Leg RDL',             cat: 'accessory',          po: false, target: '2×8 ea' },
  { id: 'goblet_calf',      day: 'friday',    name: 'Goblet Calf Raise',          cat: 'accessory',          po: true,  target: '3×12–15' },
  { id: 'pallof',           day: 'friday',    name: 'Pallof Press',               cat: 'core',               po: true,  target: '2×10 ea' },
];

// Return exercises for a given day name (monday–friday)
export function exercisesForDay(day) {
  return KILO_EXERCISES.filter(e => e.day === day);
}

const _WARMUP_NAMES = new Set(KILO_EXERCISES.filter(e => e.cat === 'warmup').map(e => e.name.toLowerCase()));
const _NON_LIFT_RE = /\b(treadmill|bike|bicycle|cycling|elliptical|run|walk|swim|cardio|rowing machine|ski erg)\b/i;

// Returns true when an exercise name is likely a strength lift rather than warmup or cardio.
export function isStrengthExerciseName(name) {
  if (!name) return false;
  if (_WARMUP_NAMES.has(name.toLowerCase())) return false;
  if (_NON_LIFT_RE.test(name)) return false;
  return true;
}

// Return the default set of tracked exercise names (those with po: true)
export function getDefaultTrackedNames() {
  return [...new Set(KILO_EXERCISES.filter(e => e.po).map(e => e.name))];
}

// Factory for a new weight entry
export function makeWeightEntry({ weight_value, logged_at, note }) {
  const ts = logged_at || new Date().toISOString();
  return {
    id: `w_${ts.slice(0, 10)}_${Date.now()}`,
    entry_type: 'weight',
    date: ts.slice(0, 10),
    weight_value,
    weight_unit: 'lb',
    note: note || null,
    logged_at: ts,
    saved_at: new Date().toISOString(),
  };
}

// Factory for a new workout session from parseWorkoutEntry result
// fields: { workout_date: string, items: array }
export function makeWorkoutSession({ workout_date, items }) {
  return {
    id: `s_${workout_date}_${Date.now()}`,
    entry_type: 'workout',
    date: workout_date,
    saved_at: new Date().toISOString(),
    items,
  };
}

// Compute 7-day and 30-day rolling weight averages and a pace flag.
// entries must be sorted newest-first with { date: 'YYYY-MM-DD', weight_value: number }.
// referenceDate defaults to today; pass a fixed date for tests.
export function computeWeightTrends(entries, referenceDate = new Date()) {
  const MS_DAY = 86400000;
  // Use local calendar date to avoid UTC-offset mismatches for non-UTC users.
  const pad = (n) => String(n).padStart(2, '0');
  const localStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const refStr = localStr(referenceDate);
  // Subtract 6 / 29 days so the inclusive range spans exactly 7 / 30 calendar days.
  const cut7  = localStr(new Date(referenceDate - 6  * MS_DAY));
  const cut30 = localStr(new Date(referenceDate - 29 * MS_DAY));

  const w7  = entries.filter(e => e.date >= cut7  && e.date <= refStr);
  const w30 = entries.filter(e => e.date >= cut30 && e.date <= refStr);

  const mean = (arr) =>
    arr.length === 0 ? null : arr.reduce((s, e) => s + e.weight_value, 0) / arr.length;

  const avg7  = mean(w7);
  const avg30 = mean(w30);

  let paceFlag = null;
  if (entries.length >= 2) {
    // Sort by date so backdated entries logged out of order don't flip the delta.
    const byDate = [...entries].sort((a, b) => b.date.localeCompare(a.date));
    const delta = byDate[0].weight_value - byDate[1].weight_value;
    const classified = classifyWeightPace(delta);
    paceFlag = classified ? classified.direction : null;
  }

  return { avg7, avg30, paceFlag };
}

// Return the severity level of the pace flag for the two most recent entries.
// entries must contain { date: 'YYYY-MM-DD', weight_value: number }; order does not matter.
// Returns 'notable' | 'spike' | null.
export function computeWeightPaceLevel(entries) {
  if (!entries || entries.length < 2) return null;
  const byDate = [...entries].sort((a, b) => b.date.localeCompare(a.date));
  const delta = byDate[0].weight_value - byDate[1].weight_value;
  const classified = classifyWeightPace(delta);
  return classified ? classified.level : null;
}

// Derive direction, required weekly pace, and advisory warnings from a weight goal.
// currentWeight: number (lb); targetWeight: number (lb); targetDate: 'YYYY-MM-DD' string
// referenceDate: Date (defaults to today)
// Returns { direction, weeks_remaining, required_weekly_pace, warnings }
//   direction: 'gain' | 'loss' | 'maintain'
//   required_weekly_pace: lb/week (null if targetDate is not in the future)
//   warnings: array of 'unrealistic' | 'unhealthy' (advisory only, never block save)
export function computeWeightGoal({ currentWeight, targetWeight, targetDate, referenceDate = new Date() }) {
  const MS_DAY = 86400000;
  const pad = (n) => String(n).padStart(2, '0');
  const localStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const refStr = localStr(referenceDate);

  if (!targetDate || targetDate <= refStr) {
    return { direction: null, weeks_remaining: 0, required_weekly_pace: null, warnings: ['unrealistic'] };
  }

  const delta = targetWeight - currentWeight;

  let direction;
  if (Math.abs(delta) < 0.5) {
    direction = 'maintain';
  } else {
    direction = delta > 0 ? 'gain' : 'loss';
  }

  const refMidnight = new Date(refStr + 'T00:00:00');
  // Round-trip component check: JS normalizes impossible dates (e.g. Sep 31 → Oct 1)
  // instead of returning Invalid Date, so isNaN alone is insufficient.
  const [tYear, tMonth, tDay] = targetDate.split('-').map(Number);
  const targetMidnight = new Date(tYear, tMonth - 1, tDay);
  if (
    targetMidnight.getFullYear() !== tYear ||
    targetMidnight.getMonth() !== tMonth - 1 ||
    targetMidnight.getDate() !== tDay
  ) {
    return { direction: null, weeks_remaining: 0, required_weekly_pace: null, warnings: ['unrealistic'] };
  }
  const days_remaining = Math.round((targetMidnight - refMidnight) / MS_DAY);
  const weeks_remaining = days_remaining / 7;
  const required_weekly_pace = delta / weeks_remaining;

  const warnings = [];
  const abs_pace = Math.abs(required_weekly_pace);
  if (abs_pace > 2) {
    warnings.push('unrealistic');
  } else if (abs_pace > 1) {
    warnings.push('unhealthy');
  }

  return { direction, weeks_remaining, required_weekly_pace, warnings };
}

// Estimate the daily calorie adjustment needed to hit a weight goal.
// Uses the 3500 cal/lb convention (1 lb ≈ 3500 kcal).
// required_weekly_pace: lb/week from computeWeightGoal (negative = loss, positive = gain).
// direction: 'gain'|'loss'|'maintain'|null from computeWeightGoal — maintain goals return no estimate.
// Returns { calories_per_day: number|null, label: 'deficit'|'surplus'|'maintain'|null }.
export function computeCalorieEstimate(required_weekly_pace, direction) {
  if (required_weekly_pace === null || required_weekly_pace === undefined) {
    return { calories_per_day: null, label: null };
  }
  if (direction === 'maintain') {
    return { calories_per_day: 0, label: 'maintain' };
  }
  const raw = Math.round((required_weekly_pace * 3500) / 7);
  if (Math.abs(raw) < 10) {
    return { calories_per_day: 0, label: 'maintain' };
  }
  return { calories_per_day: Math.abs(raw), label: raw > 0 ? 'surplus' : 'deficit' };
}

// Compute a series of 7-day rolling averages for the last N weigh-in dates.
// entries must be sorted newest-first.
export function computeWeightRollingAverageSeries(entries, limit = 7) {
  if (entries.length === 0) return [];

  // We want the last 'limit' dates that have entries.
  // Sort ascending by date to pick the last 'limit' dates.
  const allDates = [...new Set(entries.map(e => e.date))].sort();
  const targetDates = allDates.slice(-limit);

  return targetDates.map(dateStr => {
    const refDate = new Date(dateStr + 'T12:00:00');
    const { avg7 } = computeWeightTrends(entries, refDate);
    return {
      value: avg7 !== null ? Number(avg7.toFixed(1)) : null,
      label: dateStr.split('-').slice(1).join('/'), // MM/DD
      unit: 'lb'
    };
  }).filter(d => d.value !== null);
}

// Default exercise selections for the 1k total slots.
// Mirrors the primary compounds in KILO_EXERCISES for this program.
export const DEFAULT_1K_EXERCISES = {
  bench: 'DB Bench Press',
  squat: 'Squat',
  deadlift: 'Deadlift',
};

// derive1kTotal: sum latest estimated PRs for the selected bench, squat, and deadlift exercises.
// sections: output of parseWorkoutNote(noteText).sections
// selections: { bench: string, squat: string, deadlift: string } — exercise name for each slot
// Returns: { total: number|null, bench: number|null, squat: number|null, deadlift: number|null }
// total is null when any selected exercise has no latest PR in the note.
export function derive1kTotal(sections, { bench, squat, deadlift }) {
  const { exercises } = deriveTrackedPRs(sections, [bench, squat, deadlift]);
  const byName = new Map(exercises.map(e => [e.name, e.latest_pr]));
  const benchPR = byName.get(bench) ?? null;
  const squatPR = byName.get(squat) ?? null;
  const deadliftPR = byName.get(deadlift) ?? null;
  const total = (benchPR !== null && squatPR !== null && deadliftPR !== null)
    ? benchPR + squatPR + deadliftPR
    : null;
  return { total, bench: benchPR, squat: squatPR, deadlift: deadliftPR };
}

// Factory for the canonical workout routine note
export function makeWorkoutNote({ raw_text }) {
  const now = new Date().toISOString();
  return {
    raw_text,
    saved_at: now,
    updated_at: now,
  };
}

// Factory for a named workout note in the multi-note model
export function makeWorkoutNoteItem({ title, raw_text = '' }) {
  const now = new Date().toISOString();
  return {
    id: `wn_${now.slice(0, 10)}_${Date.now()}`,
    title,
    raw_text,
    saved_at: now,
    updated_at: now,
    tracked_exercises: [],
    one_k_exercises: null,
  };
}

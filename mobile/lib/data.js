// Native entry model factories and exercise catalog
import { deriveWorkoutAnalytics, deriveProgressionSignals, derivePerDaySignals, epleyPR, normalizeExerciseKey, countWorkoutSessions, countWorkoutSessionsFromSections, sessionDateMapFromNote, sessionsSinceLastDeload, weeksSinceLastDeload } from './parser.js';

// Canonical thresholds for weight-pace classification.
// All weight-pace helpers in this module derive direction and severity from these values.
export const WEIGHT_PACE_NOTABLE_THRESHOLD = 1.5; // lb — delta at or above this triggers a notable flag
export const WEIGHT_PACE_SPIKE_THRESHOLD   = 2.3; // lb — delta at or above this upgrades to spike

function _classifyWeightPaceDelta(delta) {
  if (delta === null || delta === undefined) return null;
  const abs = Math.abs(delta);
  if (abs < WEIGHT_PACE_NOTABLE_THRESHOLD) return null;
  return { direction: delta > 0 ? 'gain' : 'loss', level: abs >= WEIGHT_PACE_SPIKE_THRESHOLD ? 'spike' : 'notable' };
}

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

// Normalize a lift name: lowercase, trim, collapse internal whitespace.
export function normalizeLiftName(name) {
  if (!name) return '';
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

// Return normalized lift names that are marked as tracked in the given map.
// trackedMap: { [normalizedName]: true }
export function listTrackedLifts(trackedMap) {
  if (!trackedMap) return [];
  return Object.keys(trackedMap).filter(k => trackedMap[k]);
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
    const classified = _classifyWeightPaceDelta(delta);
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
  const classified = _classifyWeightPaceDelta(delta);
  return classified ? classified.level : null;
}

// Compute full trend summary including prior-window averages for comparison.
// Extends computeWeightTrends with priorAvg7, priorAvg30, currentWeight, and priorDayWeight.
// entries must be sorted newest-first with { date: 'YYYY-MM-DD', weight_value: number }.
export function computeWeightTrendSummary(entries, referenceDate = new Date()) {
  const base = computeWeightTrends(entries, referenceDate);
  const MS_DAY = 86400000;
  const pad = n => String(n).padStart(2, '0');
  const localStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const prior7Start  = localStr(new Date(referenceDate - 13 * MS_DAY));
  const prior7End    = localStr(new Date(referenceDate -  7 * MS_DAY));
  const prior30Start = localStr(new Date(referenceDate - 59 * MS_DAY));
  const prior30End   = localStr(new Date(referenceDate - 30 * MS_DAY));

  const mean = arr =>
    arr.length === 0 ? null : arr.reduce((s, e) => s + e.weight_value, 0) / arr.length;

  const prior7Entries  = entries.filter(e => e.date >= prior7Start  && e.date <= prior7End);
  const prior30Entries = entries.filter(e => e.date >= prior30Start && e.date <= prior30End);
  const byDate = [...entries].sort((a, b) => b.date.localeCompare(a.date));

  return {
    ...base,
    priorAvg7:      mean(prior7Entries),
    priorAvg30:     mean(prior30Entries),
    currentWeight:  byDate[0]?.weight_value ?? null,
    priorDayWeight: byDate[1]?.weight_value ?? null,
  };
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

// Activity level multipliers for TDEE calculation (Mifflin-St Jeor).
export const ACTIVITY_MULTIPLIERS = {
  sedentary:         1.2,
  lightly_active:    1.375,
  moderately_active: 1.55,
  very_active:       1.725,
  extra_active:      1.9,
};

// Compute Mifflin-St Jeor BMR.
// weight_lb: current weight in pounds, height_cm: height in centimeters,
// age: integer years, sex: 'male'|'female'.
// Returns BMR in kcal/day, or null if inputs are invalid.
export function computeBMR({ weight_lb, height_cm, age, sex }) {
  if (weight_lb == null || height_cm == null || age == null || !sex) return null;
  const weight_kg = weight_lb * 0.453592;
  const base = 10 * weight_kg + 6.25 * height_cm - 5 * age;
  return sex === 'male' ? base + 5 : base - 161;
}

// Compute TDEE from BMR and activity level.
// Returns kcal/day, or null if BMR is null or activity_level is unrecognized.
export function computeTDEE(bmr, activity_level) {
  if (bmr == null) return null;
  const multiplier = ACTIVITY_MULTIPLIERS[activity_level];
  if (multiplier == null) return null;
  return bmr * multiplier;
}

// Derive age in whole years from a YYYY-MM-DD date string and reference date.
export function ageFromDateOfBirth(date_of_birth, referenceDate = new Date()) {
  if (!date_of_birth) return null;
  const [y, m, d] = date_of_birth.split('-').map(Number);
  if (!y || !m || !d) return null;
  const ref = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  let age = ref.getFullYear() - y;
  const hasBirthdayPassed =
    ref.getMonth() + 1 > m || (ref.getMonth() + 1 === m && ref.getDate() >= d);
  if (!hasBirthdayPassed) age -= 1;
  return age;
}

// Returns true when a user profile has all fields needed for TDEE calculation.
export function isProfileComplete(profile) {
  if (!profile) return false;
  return (
    typeof profile.height_cm === 'number' &&
    typeof profile.date_of_birth === 'string' &&
    (profile.sex === 'male' || profile.sex === 'female') &&
    typeof profile.activity_level === 'string' &&
    ACTIVITY_MULTIPLIERS[profile.activity_level] != null
  );
}

// Estimate the daily calorie adjustment needed to hit a weight goal.
//
// When profile is complete, returns a TDEE-anchored absolute daily calorie target.
// When profile is incomplete or absent, falls back to the 3500 cal/lb deficit/surplus display.
//
// required_weekly_pace: lb/week from computeWeightGoal (negative = loss, positive = gain).
// direction: 'gain'|'loss'|'maintain'|null from computeWeightGoal.
// profile: optional user profile object ({ height_cm, date_of_birth, sex, activity_level }).
// weight_lb: current weight in lb (needed for BMR when profile is present).
// referenceDate: used to compute age from date_of_birth.
//
// Returns {
//   calories_per_day: number|null,
//   label: 'deficit'|'surplus'|'maintain'|null,
//   tdee_based: boolean  — true when anchored to TDEE; false for legacy 3500 mode
// }.
export function computeCalorieEstimate(required_weekly_pace, direction, profile = null, weight_lb = null, referenceDate = new Date()) {
  if (required_weekly_pace === null || required_weekly_pace === undefined) {
    return { calories_per_day: null, label: null, tdee_based: false };
  }

  const dailyAdjustment = direction === 'maintain' ? 0 : Math.round((required_weekly_pace * 3500) / 7);
  const isMaintainByAdjustment = direction === 'maintain' || Math.abs(dailyAdjustment) < 10;

  if (isProfileComplete(profile) && weight_lb != null) {
    const age = ageFromDateOfBirth(profile.date_of_birth, referenceDate);
    if (age != null && age > 0) {
      const bmr = computeBMR({ weight_lb, height_cm: profile.height_cm, age, sex: profile.sex });
      const tdee = computeTDEE(bmr, profile.activity_level);
      if (tdee != null) {
        const target = Math.round(tdee + dailyAdjustment);
        const label = isMaintainByAdjustment ? 'maintain' : (dailyAdjustment > 0 ? 'surplus' : 'deficit');
        return { calories_per_day: target, label, tdee_based: true };
      }
    }
  }

  if (isMaintainByAdjustment) {
    return { calories_per_day: 0, label: 'maintain', tdee_based: false };
  }
  return { calories_per_day: Math.abs(dailyAdjustment), label: dailyAdjustment > 0 ? 'surplus' : 'deficit', tdee_based: false };
}

// Resolve the current-weight input for goal-guidance calculations.
// Prefers the most recent weigh-in when entries exist.
// Falls back to the saved goal start_weight when no entries are present and the goal
// is not actively being edited by the user (goalEditing: false).
// When the goal is being edited and no entries exist, uses the user-typed goalStartWeight string.
// Returns a number (lb) or null when no weight can be determined.
export function resolveGoalCurrentWeight(entries, goal, { goalEditing = false, goalStartWeight = '' } = {}) {
  const byDate = entries && entries.length > 0
    ? [...entries].sort((a, b) => b.date.localeCompare(a.date))
    : [];
  const latest = byDate.length > 0 ? byDate[0].weight_value : null;
  if (latest !== null) return latest;
  if (!goalEditing && goal && goal.start_weight != null) return goal.start_weight;
  const parsed = parseFloat(goalStartWeight);
  return (!isNaN(parsed) && parsed > 0) ? parsed : null;
}

// ── Canonical temporal helpers ────────────────────────────────────────────────

// Returns the start of a rolling N-day window ending on referenceDate, as 'YYYY-MM-DD'.
// Inclusive on both ends: rollingWindowStart(ref, 30) covers ref-date minus 29 days.
export function rollingWindowStart(referenceDate = new Date(), days = 30) {
  const pad = n => String(n).padStart(2, '0');
  const start = new Date(referenceDate);
  start.setDate(start.getDate() - (days - 1)); // setDate handles DST correctly
  return `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
}

// Session-depth window for repeated_weekday_skip detection.
// Counts only skips within the last N session cycles for each day slot.
export const REPEATED_WEEKDAY_SKIP_SESSION_WINDOW = 8;

// ── Routine depth ─────────────────────────────────────────────────────────────

// Returns the longest session chain across all exercises in sections.
// Per exercise: rows.length (plain rows + non-skipped session entries) plus the count
// of skipped session_entries (which appear in session_entries but not in rows). This
// handles mixed-format history and correctly counts skipped sessions in the depth total.
// Returns null when sections is absent (no routine loaded). Returns 0 when no entries logged.
export function computeWeeksIn(sections) {
  if (!sections) return null;
  let max = 0;
  for (const section of sections) {
    for (const ex of section.exercises) {
      const skippedCount = (ex.session_entries || []).filter(se => se.skipped).length;
      const depth = Math.max(ex.session_entries.length, (ex.rows || []).length + skippedCount);
      if (depth > max) max = depth;
    }
  }
  return max;
}

// ── Routine status (issue #282) ───────────────────────────────────────────────
// Canonical routine-status derivation for the Analytics surface. Built on the
// session chain (computeWeeksIn / countWorkoutSessionsFromSections) so the
// week metrics work for any routine — including legacy history and chains with
// no fatigue/check-in coverage. The deload-relative metrics reuse the parser
// primitives, where sessions-since-deload is recomputed from the session-date
// chronology relative to the latest deload boundary (so editing a past deload
// date moves it together with weeks-since-deload).

// Total deload sessions logged across archived deload notes. Each completed
// deload is archived separately in deloadHistory with its own raw_text, so its
// logged session passes are added back to total routine exposure. Records
// without raw_text (legacy) contribute 0.
export function deloadSessionsLogged(deloadHistory) {
  if (!deloadHistory || deloadHistory.length === 0) return 0;
  return deloadHistory.reduce((sum, r) => sum + countWorkoutSessions(r?.raw_text || ''), 0);
}

// elapsedWeeks is a genuine calendar-week metric (Monday-anchored), not a
// session-pass count. It uses the routine's saved_at start, which is always
// present. (`active weeks` — calendar weeks containing a logged session — is
// intentionally NOT derived here: the only per-session calendar anchor in the
// model is session_checkins[idx].responded_at, so it cannot be both calendar-
// true and check-in-independent within this card's derivation-first scope. It
// is deferred to a separate storage/model follow-up per #282 review.)
const _DAY_MS = 24 * 60 * 60 * 1000;
const _WEEK_MS = 7 * _DAY_MS;

// Monday-of-week UTC epoch for a 'YYYY-MM-DD...' ISO string.
function _mondayEpochFromIso(iso) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const dow = new Date(ms).getUTCDay();   // 0=Sun..6=Sat
  return ms - (((dow + 6) % 7) * _DAY_MS); // back up to Monday
}

// Monday-of-week UTC epoch for "now" (optionally injected for tests).
function _mondayEpochNow(nowMs) {
  const now = new Date(nowMs != null ? nowMs : Date.now());
  const ms = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dow = new Date(ms).getUTCDay();
  return ms - (((dow + 6) % 7) * _DAY_MS);
}

// Elapsed weeks: calendar weeks the routine has spanned since it began
// (note.saved_at), including inactive gaps. Monday-anchored and 1-based: the
// routine's first calendar week reads 1. Returns null without a start date, 0
// for a future start.
export function elapsedWeeksOnRoutine(note, nowMs) {
  const start = note?.saved_at;
  if (!start) return null;
  const startMon = _mondayEpochFromIso(start);
  const nowMon = _mondayEpochNow(nowMs);
  if (nowMon < startMon) return 0;
  return Math.round((nowMon - startMon) / _WEEK_MS) + 1;
}

// Single canonical entry point for the Analytics routine-status surface.
//
// Returns:
//   sessionsLogged:      total sessions on the routine, INCLUDING archived
//                        deload sessions (never reduced by deloads)
//   elapsedWeeks:        calendar weeks since the routine began, incl. gaps
//   sessionsSinceDeload: sessions after the latest deload boundary (excludes it)
//   weeksSinceDeload:    full weeks since the latest deload (null if no deload)
export function deriveRoutineStatus(currentSections, note, deloadHistory) {
  const routineSessions = countWorkoutSessionsFromSections(currentSections || []);
  const dateMap = sessionDateMapFromNote(note);
  return {
    sessionsLogged: routineSessions + deloadSessionsLogged(deloadHistory),
    elapsedWeeks: elapsedWeeksOnRoutine(note),
    sessionsSinceDeload: sessionsSinceLastDeload(routineSessions, deloadHistory, dateMap),
    weeksSinceDeload: weeksSinceLastDeload(deloadHistory),
  };
}

// Compute a series of rolling averages for the last N weigh-in dates.
// entries must be sorted newest-first.
// windowDays selects which rolling window each point reports: 7 (default) or 30.
export function computeWeightRollingAverageSeries(entries, limit = 7, windowDays = 7) {
  if (entries.length === 0) return [];

  // We want the last 'limit' dates that have entries.
  // Sort ascending by date to pick the last 'limit' dates.
  const allDates = [...new Set(entries.map(e => e.date))].sort();
  const targetDates = allDates.slice(-limit);

  return targetDates.map(dateStr => {
    const refDate = new Date(dateStr + 'T12:00:00');
    const trends = computeWeightTrends(entries, refDate);
    const avg = windowDays === 30 ? trends.avg30 : trends.avg7;
    return {
      value: avg !== null ? Number(avg.toFixed(1)) : null,
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

// Most recent non-null entry in an ordinal-indexed per-session PR list.
function _latestNonNull(prs) {
  for (let i = prs.length - 1; i >= 0; i--) {
    if (prs[i] != null) return prs[i];
  }
  return null;
}

// derive1kTotal: the Big-3 1RM total for the most recent COMPLETE session cycle.
//
// SEMANTIC: current-performance tracker, not a sticky all-time milestone. This is
// exactly the last point of derive1kTotalSeries — the latest session ordinal at
// which all three lifts have a real (non-skipped) PR. So a lighter recent cycle
// lowers the 1K, a per-occurrence max can no longer pin an old higher value, and
// the total is never a sum of PRs from different cycles.
//
// Deriving the headline straight from the series is intentional: it guarantees
// the Home 1K and the historical chart are always consistent and share one
// alignment rule (oldest-first ordinal zip, since the parsed model carries no
// per-session date to key on). Any uneven-history shape — a lift skipped in the
// latest cycle, or a lift with an extra newer cycle the others lack — resolves
// to the same single complete cycle the series emits, with no mixed-cycle sum in
// either direction.
//
// Fallback: when no complete aligned Big-3 cycle exists (a selected lift never
// appears in the note), total is null but each present lift still reports its
// most recent logged session PR for context. _exercisePerSessionPRs walks
// _occurrenceEntries, so this stays robust to how sessions are separated (day
// headings, `- entry` lines, bare rows, blank lines).
//
// sections: output of parseWorkoutNote(noteText).sections
// selections: { bench: string, squat: string, deadlift: string } — exercise name for each slot
// Returns: { total: number|null, bench: number|null, squat: number|null, deadlift: number|null }
export function derive1kTotal(sections, { bench, squat, deadlift }) {
  const series = derive1kTotalSeries(sections, { bench, squat, deadlift });
  if (series.length > 0) {
    const last = series[series.length - 1];
    return { total: last.total, bench: last.bench, squat: last.squat, deadlift: last.deadlift };
  }
  // No complete Big-3 cycle: show each present lift's latest session, total null.
  const { exercises } = deriveWorkoutAnalytics(sections);
  const byKey = new Map(exercises.map(e => [normalizeExerciseKey(e.name), e]));
  const latestFor = (name) => {
    const ex = byKey.get(normalizeExerciseKey(name));
    return ex ? _latestNonNull(_exercisePerSessionPRs(ex)) : null;
  };
  return { total: null, bench: latestFor(bench), squat: latestFor(squat), deadlift: latestFor(deadlift) };
}

// Best Epley PR across one logged session's sets. Returns null when no valid set.
function _sessionEntryPR(entry) {
  let best = null;
  for (const s of entry.sets || []) {
    const e = epleyPR(s.weight_value, s.rep_count);
    if (e !== null && (best === null || e > best)) best = e;
  }
  return best;
}

// Ordered (oldest-first) per-session best-Epley PRs for one derived exercise,
// indexed by session ordinal. The ordinal position is preserved: skipped/unparsed
// sessions and sessions with no valid weighted set are kept as null placeholders
// so a given index refers to the same session-cycle slot across every lift. This
// is what lets the three lifts be aligned by ordinal without a skip in one lift
// silently shifting later sessions out of alignment.
function _exercisePerSessionPRs(ex) {
  const prs = [];
  for (const occ of ex.occurrences) {
    for (const entry of _occurrenceEntries(occ)) {
      prs.push(entry.skipped || entry.unparsed ? null : _sessionEntryPR(entry));
    }
  }
  return prs;
}

// derive1kTotalSeries: Big-3 1RM total per historical workout session.
// Builds each lift's ordinal-indexed per-session PR list once (single
// deriveWorkoutAnalytics pass, then one linear pass per lift) and aligns them by
// session ordinal. A point is emitted only when all three lifts have a real PR at
// the SAME ordinal; ordinals where any lift was skipped/unlogged are dropped
// without shifting later ordinals, so a point never sums PRs from sessions that
// did not occur in the same cycle. `session` is the 1-based ordinal, so dropped
// cycles leave gaps in the numbering rather than collapsing the series.
//
// sections: output of parseWorkoutNote(noteText).sections
// selections: { bench: string, squat: string, deadlift: string } — exercise name per slot
// Returns: { session, total, bench, squat, deadlift }[]
//
// Note: alignment is by session ordinal within each lift's history (the routine's
// week cadence), since the parsed model carries no per-session date to key on.
//
// Complexity: O(total sessions across the three lifts); no per-session re-scan of notes.
export function derive1kTotalSeries(sections, { bench, squat, deadlift }) {
  const { exercises } = deriveWorkoutAnalytics(sections);
  const byKey = new Map(exercises.map(e => [normalizeExerciseKey(e.name), e]));
  const prsFor = (name) => {
    const ex = byKey.get(normalizeExerciseKey(name));
    return ex ? _exercisePerSessionPRs(ex) : [];
  };

  const benchPRs = prsFor(bench);
  const squatPRs = prsFor(squat);
  const deadliftPRs = prsFor(deadlift);

  const n = Math.min(benchPRs.length, squatPRs.length, deadliftPRs.length);
  const series = [];
  for (let i = 0; i < n; i++) {
    const b = benchPRs[i], s = squatPRs[i], d = deadliftPRs[i];
    // Only emit when all three lifts have a real PR at this same session ordinal.
    if (b == null || s == null || d == null) continue;
    series.push({
      session: i + 1,
      total: b + s + d,
      bench: b,
      squat: s,
      deadlift: d,
    });
  }
  return series;
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
export function makeWorkoutNoteItem({ title = 'Untitled Routine', raw_text = '', isCurrent = false }) {
  const now = new Date().toISOString();
  return {
    id: `wn_${now.slice(0, 10)}_${Date.now()}`,
    title,
    raw_text,
    saved_at: now,
    updated_at: now,
    tracked_exercises: [],
    one_k_exercises: null,
    isCurrent,
    skip_markers: null,
    attendance_flags: null,
    session_checkins: null,
    dismissed_nudges: null,
    exercise_classifications: null,
  };
}

// ── Kilo max ─────────────────────────────────────────────────────────────────

export function getKiloFatigueMultiplier() {
  return 1.07;
}

// Compute the Kilo max for one exercise given its occurrences.
// Excludes warmup occurrences (kind === 'warmup') and sets without valid weight/reps.
// Returns { kilo_max_adjusted: number|null }.
// kilo_max_adjusted = Math.round(avgEpley * multiplier)
export function computeKiloMax(occurrences, multiplier = getKiloFatigueMultiplier()) {
  const epleyValues = [];
  for (const occ of occurrences) {
    if (occ.kind === 'warmup') continue;
    for (const s of occ.sets) {
      const e = epleyPR(s.weight_value, s.rep_count);
      if (e !== null) epleyValues.push(e);
    }
  }
  if (epleyValues.length === 0) return { kilo_max_adjusted: null };
  const rawAvg = epleyValues.reduce((sum, v) => sum + v, 0) / epleyValues.length;
  return {
    kilo_max_adjusted: Math.round(rawAvg * multiplier),
  };
}

// ── Skip detection and attendance flags ───────────────────────────────────────

const _DAY_LABELS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Returns { weekday: string|null, date: 'YYYY-MM-DD'|null } from a section heading.
function _headingInfo(heading) {
  if (!heading) return { weekday: null, date: null };
  const lower = heading.toLowerCase();
  let weekday = null;
  for (const day of _DAY_LABELS) {
    if (lower.includes(day)) { weekday = day; break; }
  }

  let date = null;
  // Try ISO YYYY-MM-DD
  const isoMatch = /(\d{4}-\d{2}-\d{2})/.exec(heading);
  if (isoMatch) {
    date = isoMatch[1];
  } else {
    // Try MM-DD-YYYY or MM/DD/YYYY
    const commonMatch = /(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(heading);
    if (commonMatch) {
      const m = commonMatch[1].padStart(2, '0');
      const d = commonMatch[2].padStart(2, '0');
      const y = commonMatch[3];
      date = `${y}-${m}-${d}`;
    }
  }

  if (date && !weekday) {
    const d = new Date(date + 'T12:00:00');
    if (!isNaN(d.getTime())) weekday = _DAY_LABELS[d.getDay()];
  }
  return { weekday, date };
}

function _exerciseIdForName(name) {
  const norm = normalizeExerciseKey(name);
  const found = KILO_EXERCISES.find(e => normalizeExerciseKey(e.name) === norm);
  return found ? found.id : null;
}

// Scan parsed sections for exercise-level and day-level skip markers plus
// derived attendance flags.
//
// exercise_skips: { exercise_name, exercise_id, session_index }[]
//   One entry per skipped session_entry position.
//
// day_skips: { session_index, weekday: string|null, date: 'YYYY-MM-DD'|null }[]
//   Session positions where all exercises present at that index in the same
//   section are skipped. Missing history at an index is not treated as a skip.
//   weekday and date are inferred from the section heading when possible.
//
// attendance_flags:
//   { type: 'consecutive_exercise_skips', exercise_name, exercise_id, consecutive_count }
//     — 2+ consecutive skipped session entries for one exercise
//   { type: 'repeated_weekday_skip', weekday, skip_count }
//     — 2+ fully-skipped sessions on the same weekday within the last
//       REPEATED_WEEKDAY_SKIP_SESSION_WINDOW session cycles for that day slot.
//       Weekday is inferred from section heading (day name or ISO date); no
//       calendar date required — detection is purely session-order based.
export function deriveSkipData(sections) {
  const exercise_skips = [];
  const day_skips = [];
  const attendance_flags = [];

  // weekday → session_index[] of fully-skipped day slots
  const weekdaySkipIndices = {};
  // weekday → max session_entries.length seen across sections for that day slot
  const weekdayMaxDepth = {};
  // Keyed by exercise identity (catalog id, or canonical name for non-catalog exercises).
  // Accumulates session_entries in section order for cross-section consecutive detection.
  const exerciseHistories = new Map();

  for (const section of sections) {
    const eligible = section.exercises.filter(ex =>
      ex.session_entries.length > 0
    );
    if (eligible.length === 0) continue;

    const { weekday, date: headingDate } = _headingInfo(section.heading);
    const maxLen = Math.max(...eligible.map(ex => ex.session_entries.length));

    if (weekday) {
      weekdayMaxDepth[weekday] = Math.max(weekdayMaxDepth[weekday] || 0, maxLen);
    }

    for (const ex of eligible) {
      const exId = _exerciseIdForName(ex.name);
      const histKey = exId ?? normalizeExerciseKey(ex.name);

      if (!exerciseHistories.has(histKey)) {
        exerciseHistories.set(histKey, { exercise_name: ex.name, exercise_id: exId, entries: [] });
      }
      exerciseHistories.get(histKey).entries.push(...ex.session_entries);

      ex.session_entries.forEach((entry, idx) => {
        if (entry.skipped) {
          exercise_skips.push({ exercise_name: ex.name, exercise_id: exId, session_index: idx });
        }
      });
    }

    for (let i = 0; i < maxLen; i++) {
      // All eligible exercises must have an entry at this position.
      // Missing history is not evidence of a skip.
      if (!eligible.every(ex => i < ex.session_entries.length)) continue;
      if (!eligible.every(ex => ex.session_entries[i].skipped)) continue;

      day_skips.push({ session_index: i, weekday, date: headingDate });

      if (weekday) {
        if (!weekdaySkipIndices[weekday]) weekdaySkipIndices[weekday] = [];
        weekdaySkipIndices[weekday].push(i);
      }
    }
  }

  // Cross-section consecutive skip detection: evaluate each exercise's full history.
  for (const { exercise_name, exercise_id, entries } of exerciseHistories.values()) {
    let consecutive = 0;
    let maxConsecutive = 0;
    for (const entry of entries) {
      if (entry.skipped) {
        consecutive++;
        if (consecutive > maxConsecutive) maxConsecutive = consecutive;
      } else {
        consecutive = 0;
      }
    }
    if (maxConsecutive >= 2) {
      attendance_flags.push({
        type: 'consecutive_exercise_skips',
        exercise_name,
        exercise_id,
        consecutive_count: maxConsecutive,
      });
    }
  }

  // Repeated weekday skip: session-depth window (no calendar dates required).
  for (const [weekday, skipIndices] of Object.entries(weekdaySkipIndices)) {
    const maxDepth = weekdayMaxDepth[weekday] || 0;
    const windowStart = Math.max(0, maxDepth - REPEATED_WEEKDAY_SKIP_SESSION_WINDOW);
    const recentSkips = skipIndices.filter(idx => idx >= windowStart);
    if (recentSkips.length >= 2) {
      attendance_flags.push({ type: 'repeated_weekday_skip', weekday, skip_count: recentSkips.length });
    }
  }

  return { exercise_skips, day_skips, attendance_flags };
}

// ── Per-exercise session classification ───────────────────────────────────────

function _totalRepsAtWeight(sets, weight) {
  return sets.filter(s => s.weight_value === weight).reduce((sum, s) => sum + s.rep_count, 0);
}

// Extract all session entries for an occurrence.
// When session_entries are present, each plain row after the logged history
// is treated as its own session unit (not merged into one blob).
// When no session_entries exist, each row is one session unit; falls back
// to occ.sets as one unit only when rows is empty (test/legacy path).
function _occurrenceEntries(occ) {
  const rows = occ.rows || [];
  if ((occ.session_entries || []).length > 0) {
    const loggedCount = occ.session_entries.filter(e => !e.skipped && !e.unparsed).length;
    const extra = rows
      .slice(loggedCount)
      .filter(r => r.sets && r.sets.length > 0)
      .map(r => ({ skipped: false, sets: r.sets }));
    return [...occ.session_entries, ...extra];
  }
  if (rows.length > 0) {
    return rows
      .filter(r => r.sets && r.sets.length > 0)
      .map(r => ({ skipped: false, sets: r.sets }));
  }
  return occ.sets.length > 0 ? [{ skipped: false, sets: occ.sets }] : [];
}

function _topWeight(sets) {
  const weighted = sets.filter(s => s.weight_value != null && s.weight_value > 0 && s.rep_count != null && s.rep_count > 0);
  if (weighted.length === 0) return null;
  return Math.max(...weighted.map(s => s.weight_value));
}

// Classify one exercise given its full session_entries list (newest last).
// Returns 'progressing' | 'stalled' | 'regressing' | 'inconsistent' | null
function _classifyEntries(allEntries) {
  const window = allEntries.slice(-3);
  const logged = window.filter(se => !se.skipped && !se.unparsed && se.sets && _topWeight(se.sets) !== null);
  if (logged.length === 0) return null;
  if (logged.length === 1) {
    return window.some(se => se.skipped) ? 'inconsistent' : 'initial';
  }

  const latest = logged[logged.length - 1];
  const prior = logged[logged.length - 2];
  const latestTop = _topWeight(latest.sets);
  const priorTop = _topWeight(prior.sets);

  if (latestTop < priorTop) return 'regressing';
  if (latestTop > priorTop) return 'progressing';

  // Same top weight: compare total reps at top weight
  const latestTotal = _totalRepsAtWeight(latest.sets, latestTop);
  const priorTotal = _totalRepsAtWeight(prior.sets, priorTop);
  if (latestTotal > priorTotal) return 'progressing';
  if (latestTotal < priorTotal) return 'regressing';

  // Same top weight and same total reps: check distribution
  const latestReps = latest.sets.filter(s => s.weight_value === latestTop).map(s => s.rep_count).sort((a, b) => a - b);
  const priorReps = prior.sets.filter(s => s.weight_value === priorTop).map(s => s.rep_count).sort((a, b) => a - b);
  if (JSON.stringify(latestReps) === JSON.stringify(priorReps)) return 'stalled';

  return null;
}

// Classify session trends for all tracked exercises.
// sections: output of parseWorkoutNote(noteText).sections
// trackedNames: string[] of exercise names to classify
// Returns { [normalizedName]: 'progressing'|'stalled'|'regressing'|'inconsistent'|null }
export function classifyExerciseSessions(sections, trackedNames) {
  const { exercises } = deriveWorkoutAnalytics(sections);
  const byKey = new Map(exercises.map(ex => [normalizeExerciseKey(ex.name), ex]));
  const result = {};
  for (const name of trackedNames) {
    const normName = normalizeLiftName(name);
    const key = normalizeExerciseKey(name);
    const ex = byKey.get(key);
    if (!ex) { result[normName] = null; continue; }
    const allEntries = ex.occurrences.flatMap(occ => _occurrenceEntries(occ));
    const classification = _classifyEntries(allEntries);
    result[normName] = classification;
  }
  return result;
}

// ── Rep drop-off flag ─────────────────────────────────────────────────────────

// Compute the intra-session rep drop-off flag for one session's sets.
// Uses working sets (weight_value > 0, rep_count > 0) only.
// Mixed-weight: uses the heaviest-weight sets to compute first/last reps.
// Returns 'hit_wall' | null.
export function computeRepDropOff(sets) {
  const working = (sets || []).filter(s => s.weight_value > 0 && s.rep_count > 0);
  if (working.length < 2) return null;
  const maxWeight = Math.max(...working.map(s => s.weight_value));
  const atMax = working.filter(s => s.weight_value === maxWeight);
  if (atMax.length < 2) return null; // only 1 set at heaviest weight → ambiguous
  const dropOff = atMax[0].rep_count - atMax[atMax.length - 1].rep_count;
  if (dropOff >= 3) return 'hit_wall';
  return null;
}

// Derive rep drop-off flags for all tracked exercises, per session.
// Returns { [normalizedName]: { [sessionIndex]: 'hit_wall' | null } }
// Only logged (non-skipped) sessions are included; skipped sessions are omitted.
// sessionIndex is the positional index in the exercise's full entry history (oldest = 0).
export function deriveRepDropOffFlags(sections, trackedNames) {
  const { exercises } = deriveWorkoutAnalytics(sections);
  const byKey = new Map(exercises.map(ex => [normalizeExerciseKey(ex.name), ex]));
  const result = {};
  for (const name of trackedNames) {
    const normName = normalizeLiftName(name);
    const key = normalizeExerciseKey(name);
    const ex = byKey.get(key);
    if (!ex) { result[normName] = {}; continue; }
    const allEntries = ex.occurrences.flatMap(occ => _occurrenceEntries(occ));
    const sessionFlags = {};
    allEntries.forEach((entry, idx) => {
      if (!entry.skipped && !entry.unparsed && entry.sets && entry.sets.length > 0) {
        sessionFlags[String(idx)] = computeRepDropOff(entry.sets);
      }
    });
    result[normName] = sessionFlags;
  }
  return result;
}

// Return the flag for the most recent logged session from a per-session flags map.
// ── Session check-in detection ────────────────────────────────────────────────
//
// Flags when the latest logged session looks "rough" so the UI can ask
// "you okay?" and highlight the offending exercises. Four detectors:
//   - skipped:     more exercises skipped at the latest column than the
//                  historical per-column average + margin (deriveSkipData),
//                  with an absolute floor
//   - volume_drop: reps collapsed >REP_DROP_THRESHOLD on ≥MIN_COLLAPSED_SETS
//                  sets vs the exercise's baseline at that weight (a within-row
//                  skipped set, rep_count 0, counts as a full collapse)
//   - collapse:    reps fell apart within the latest session (computeRepDropOff)
//   - day_skip:    a whole day was skipped at the latest column
//                  (deriveSkipData().day_skips); independent of the skip trigger
//
// The latest session is the deepest column, lastIdx = computeWeeksIn(sections) - 1,
// matching the suppression key used by the persistence layer. Multi-day routines
// share the existing positional-alignment limitation (see classifyExerciseSessions).
// Pure; operates on parsed sections. Returns:
//   { sessionIndex, isRough, detectors: string[],
//     flagged: [{ normName, name, reasons: ('skip'|'volume_drop'|'collapse'|'day_skip')[] }],
//     metrics: { exercises_skipped: number, volume_decline_pct: number|null } }
export const SESSION_CHECKIN_REP_DROP_THRESHOLD = 2; // reps lost vs baseline to call a set "collapsed"
export const SESSION_CHECKIN_MIN_COLLAPSED_SETS = 2; // collapsed sets needed to flag a volume drop
export const SESSION_CHECKIN_SKIP_FLOOR = 2;         // min skipped exercises before a skip trigger fires
export const SESSION_CHECKIN_SKIP_MARGIN = 1;        // skips above the historical average to count as "more than usual"

function _checkinTonnage(sets) {
  return (sets || []).reduce(
    (sum, s) => (s.weight_value > 0 && s.rep_count > 0 ? sum + s.weight_value * s.rep_count : sum),
    0
  );
}

// Best (max) reps recorded at a given working weight within one entry's sets.
function _maxRepsAtWeight(sets, weight) {
  let max = 0;
  for (const s of sets || []) {
    if (s.weight_value === weight && s.rep_count > max) max = s.rep_count;
  }
  return max;
}

export function deriveSessionCheckIn(sections, trackedNames) {
  const empty = {
    sessionIndex: null,
    isRough: false,
    detectors: [],
    flagged: [],
    metrics: { exercises_skipped: 0, volume_decline_pct: null },
  };
  if (!sections || !trackedNames || trackedNames.length === 0) return empty;

  // Latest session index per the contract: the routine's deepest session column.
  const sessionIndex = computeWeeksIn(sections) - 1;
  if (sessionIndex < 0) return empty;

  const { exercises } = deriveWorkoutAnalytics(sections);
  const byKey = new Map(exercises.map(ex => [normalizeExerciseKey(ex.name), ex]));

  // Build the positional entry history for each tracked exercise that exists.
  const assessments = [];
  for (const name of trackedNames) {
    const ex = byKey.get(normalizeExerciseKey(name));
    if (!ex) continue;
    const allEntries = ex.occurrences.flatMap(occ => _occurrenceEntries(occ));
    if (allEntries.length === 0) continue;
    assessments.push({ normName: normalizeLiftName(name), name: ex.name, allEntries });
  }
  if (assessments.length === 0) return empty;

  // ── Skip (detector 1) and whole-day skip (detector 4), via deriveSkipData ──
  // Detector 1 fires when more exercises were skipped at the latest column than
  // the historical per-column average by a margin (with an absolute floor).
  // Detector 4 is independent: a whole day skipped at the latest column.
  const skipData = deriveSkipData(sections);
  const skipByIndex = {};
  for (const s of skipData.exercise_skips) {
    skipByIndex[s.session_index] = (skipByIndex[s.session_index] || 0) + 1;
  }
  const latestSkipCount = skipByIndex[sessionIndex] || 0;
  let baselineAvgSkips = 0;
  if (sessionIndex > 0) {
    let sum = 0;
    for (let i = 0; i < sessionIndex; i++) sum += skipByIndex[i] || 0;
    baselineAvgSkips = sum / sessionIndex;
  }
  const skipFired = latestSkipCount >= SESSION_CHECKIN_SKIP_FLOOR
    && latestSkipCount > baselineAvgSkips + SESSION_CHECKIN_SKIP_MARGIN;
  const dayFired = skipData.day_skips.some(d => d.session_index === sessionIndex);

  // ── Per-exercise volume_drop / collapse on the latest entry ──
  const detectorSet = new Set();
  const flaggedMap = new Map(); // normName -> { normName, name, reasons:Set }
  let sumBaseTon = 0;
  let sumLatestTon = 0;
  let anyVolumeDrop = false;

  const addReason = (a, reason) => {
    if (!flaggedMap.has(a.normName)) flaggedMap.set(a.normName, { normName: a.normName, name: a.name, reasons: new Set() });
    flaggedMap.get(a.normName).reasons.add(reason);
  };

  for (const a of assessments) {
    const latest = a.allEntries[sessionIndex];
    if (!latest) continue; // exercise shorter than the latest column — not part of this session
    const priorLogged = a.allEntries
      .slice(0, sessionIndex)
      .filter(e => !e.skipped && !e.unparsed && e.sets && e.sets.length > 0);
    // Need a baseline to judge "rough": skip brand-new exercises with no history.
    if (priorLogged.length === 0) continue;

    if (latest.skipped) {
      if (skipFired) addReason(a, 'skip');
      if (dayFired) addReason(a, 'day_skip');
      continue;
    }
    const latestSets = latest.sets || [];
    // Distinct working weights in the latest entry.
    const weights = [...new Set(latestSets.filter(s => s.weight_value > 0).map(s => s.weight_value))];
    let collapsedSets = 0;
    for (const w of weights) {
      // Baseline reps at this weight: most recent prior logged entry that used it.
      let baseReps = 0;
      for (let i = priorLogged.length - 1; i >= 0; i--) {
        const m = _maxRepsAtWeight(priorLogged[i].sets, w);
        if (m > 0) { baseReps = m; break; }
      }
      if (baseReps <= 0) continue; // new weight, nothing to compare against
      for (const s of latestSets) {
        if (s.weight_value !== w) continue;
        if (baseReps - s.rep_count > SESSION_CHECKIN_REP_DROP_THRESHOLD) collapsedSets++;
      }
    }
    if (collapsedSets >= SESSION_CHECKIN_MIN_COLLAPSED_SETS) {
      addReason(a, 'volume_drop');
      anyVolumeDrop = true;
      sumBaseTon += _checkinTonnage(priorLogged[priorLogged.length - 1].sets);
      sumLatestTon += _checkinTonnage(latestSets);
    }
    if (computeRepDropOff(latestSets) === 'hit_wall') {
      addReason(a, 'collapse');
    }
  }

  // Roll up detectors from flagged reasons + session-level skip triggers.
  for (const f of flaggedMap.values()) {
    for (const r of f.reasons) detectorSet.add(r === 'skip' ? 'skipped' : r);
  }
  if (skipFired) detectorSet.add('skipped');
  if (dayFired) detectorSet.add('day_skip');

  const flagged = [...flaggedMap.values()].map(f => ({ normName: f.normName, name: f.name, reasons: [...f.reasons] }));
  const detectorOrder = ['skipped', 'volume_drop', 'collapse', 'day_skip'];
  const detectors = detectorOrder.filter(d => detectorSet.has(d));
  const volume_decline_pct = anyVolumeDrop && sumBaseTon > 0
    ? Math.round(((sumBaseTon - sumLatestTon) / sumBaseTon) * 100)
    : null;

  return {
    sessionIndex,
    isRough: detectors.length > 0,
    detectors,
    flagged,
    metrics: { exercises_skipped: latestSkipCount, volume_decline_pct },
  };
}

// ── Non-weighted tracked-exercise card metrics ────────────────────────────────

// Classify a set of sets as 'weighted' | 'time_based' | 'reps_only' | null.
// Loaded bodyweight (weight_value > 0 or non-zero assistance) → 'weighted'.
function _detectExerciseClass(sets) {
  if (!sets || sets.length === 0) return null;
  if (sets.some(s => (s.weight_value != null && s.weight_value > 0) ||
                     (s.assistance_value != null && s.assistance_value !== 0))) return 'weighted';
  if (sets.some(s => s.duration_seconds != null && s.duration_seconds > 0)) return 'time_based';
  if (sets.some(s => s.rep_count != null && s.rep_count > 0)) return 'reps_only';
  return null;
}

// Derive card metrics for non-weighted tracked exercises.
// sections: output of parseWorkoutNote(noteText).sections
// exerciseNames: string[] of exercise names
// Returns { [normalizedName]: one of two shapes keyed by exercise_class:
//
//   exercise_class === 'reps_only':
//     { exercise_class: 'reps_only',
//       avg_reps: number | null,
//       best_set_reps: number | null,
//       reps_arrow: 'up'|'down'|'flat'|'dash'|null }
//
//   exercise_class === 'time_based':
//     { exercise_class: 'time_based',
//       avg_hold: number | null,            // seconds
//       best_hold: number | null,           // seconds
//       hold_arrow: 'up'|'down'|'flat'|'dash'|null }
//
// Consumers must branch on exercise_class; only the fields for the detected
// class are present. Weighted exercises (any added/assisting load) are excluded.
// }
export function deriveNonWeightedTrackedExerciseMetrics(sections, exerciseNames) {
  if (!sections || !exerciseNames || exerciseNames.length === 0) return {};

  const { exercises } = deriveWorkoutAnalytics(sections);
  const byKey = new Map(exercises.map(ex => [normalizeExerciseKey(ex.name), ex]));
  const result = {};

  for (const name of exerciseNames) {
    const normName = normalizeLiftName(name);
    const key = normalizeExerciseKey(name);
    const ex = byKey.get(key);
    if (!ex) continue;

    const loggedSessions = ex.occurrences
      .flatMap(occ => _occurrenceEntries(occ))
      .filter(se => !se.skipped && !se.unparsed && se.sets && se.sets.length > 0);

    if (loggedSessions.length === 0) continue;

    const latestSets = loggedSessions[loggedSessions.length - 1].sets;
    const exerciseClass = _detectExerciseClass(latestSets);
    if (!exerciseClass || exerciseClass === 'weighted') continue;

    if (exerciseClass === 'reps_only') {
      const sessionAvgs = loggedSessions.map(se => {
        const validSets = se.sets.filter(s => s.rep_count != null && s.rep_count > 0);
        return validSets.length > 0 ? (validSets.reduce((sum, s) => sum + s.rep_count, 0) / validSets.length) : 0;
      });
      const latestAvg = sessionAvgs[sessionAvgs.length - 1];
      const avg_reps = latestAvg > 0 ? Math.round(latestAvg) : null;
      const best_set_reps = Math.max(...latestSets.map(s => s.rep_count || 0)) || null;

      let priorAvg = null;
      for (let i = sessionAvgs.length - 2; i >= 0; i--) {
        if (sessionAvgs[i] > 0) { priorAvg = sessionAvgs[i]; break; }
      }

      const reps_arrow = avg_reps === null ? null
        : loggedSessions.length === 1 || priorAvg === null ? 'dash'
        : latestAvg > priorAvg ? 'up'
        : latestAvg < priorAvg ? 'down'
        : 'flat';

      result[normName] = { exercise_class: 'reps_only', avg_reps, best_set_reps, reps_arrow };
    } else {
      const sessionAvgs = loggedSessions.map(se => {
        const validSets = se.sets.filter(s => s.duration_seconds != null && s.duration_seconds > 0);
        return validSets.length > 0 ? (validSets.reduce((sum, s) => sum + s.duration_seconds, 0) / validSets.length) : 0;
      });
      const latestAvg = sessionAvgs[sessionAvgs.length - 1];
      const avg_hold = latestAvg > 0 ? latestAvg : null;
      const best_hold = Math.max(...latestSets.map(s => s.duration_seconds || 0)) || null;

      let priorAvg = null;
      for (let i = sessionAvgs.length - 2; i >= 0; i--) {
        if (sessionAvgs[i] > 0) { priorAvg = sessionAvgs[i]; break; }
      }

      const hold_arrow = avg_hold === null ? null
        : loggedSessions.length === 1 || priorAvg === null ? 'dash'
        : latestAvg > priorAvg ? 'up'
        : latestAvg < priorAvg ? 'down'
        : 'flat';

      result[normName] = { exercise_class: 'time_based', avg_hold, best_hold, hold_arrow };
    }
  }

  return result;
}

// Wrap deriveProgressionSignals and replace kilo_max with the Epley-average x
// fatigue formula (adjusted, rounded).
export function deriveSignals(sections, trackedNames, multiplier = getKiloFatigueMultiplier()) {
  const { exercises: signals } = deriveProgressionSignals(sections, trackedNames);
  const { exercises: analyticsExercises } = deriveWorkoutAnalytics(sections);

  const byName = new Map(analyticsExercises.map(ex => [normalizeExerciseKey(ex.name), ex]));

  return {
    exercises: signals.map(sig => {
      const ex = byName.get(normalizeExerciseKey(sig.name));
      if (!ex) return sig;
      const { kilo_max_adjusted } = computeKiloMax(ex.occurrences, multiplier);
      return { ...sig, kilo_max: kilo_max_adjusted };
    }),
  };
}

// ── Canonical weight and goal derivation layer ────────────────────────────────

// Derives the full set of shared weight and goal analytics from raw entries and persisted goal state.
// This is the single canonical entry point for all weight/goal consumers (Weight, Home, Stats).
//
// entries:      weight entries sorted newest-first with { date: 'YYYY-MM-DD', weight_value: number }
// goal:         persisted goal state { target_weight, target_date, start_weight } or null
// editState:    optional { goalEditing: bool, goalTargetWeight: string, goalTargetDate: string, goalStartWeight: string }
// referenceDate: optional Date for testability (defaults to today)
// profile: optional user profile object for TDEE-based calorie estimate
//
// Returns:
//   trendSummary:    { avg7, avg30, paceFlag, priorAvg7, priorAvg30, currentWeight, priorDayWeight }
//   paceLevel:       'notable' | 'spike' | null
//   rollingSeries:   { value, label, unit }[] — 7-day rolling average per weigh-in date
//   rollingSeries30: { value, label, unit }[] — 30-day rolling average per weigh-in date
//   goalInfo:        { direction, weeks_remaining, required_weekly_pace, warnings } | null
//   calorieEstimate: { calories_per_day, label, tdee_based } | null
export function deriveWeightGoalAnalytics(entries, goal, editState = {}, referenceDate = new Date(), profile = null) {
  const {
    goalEditing = false,
    goalTargetWeight = '',
    goalTargetDate = '',
    goalStartWeight = '',
  } = editState;

  const safeEntries = entries || [];
  const trendSummary = computeWeightTrendSummary(safeEntries, referenceDate);
  const paceLevel = computeWeightPaceLevel(safeEntries);
  const rollingSeries = computeWeightRollingAverageSeries(safeEntries, 7);
  const rollingSeries30 = computeWeightRollingAverageSeries(safeEntries, 30, 30);

  const resolvedCurrentWeight = resolveGoalCurrentWeight(safeEntries, goal, { goalEditing, goalStartWeight });
  const tw = !goalEditing && goal ? goal.target_weight : parseFloat(goalTargetWeight);
  const td = !goalEditing && goal ? goal.target_date : goalTargetDate;

  let goalInfo = null;
  let calorieEstimate = null;
  if (resolvedCurrentWeight !== null && !isNaN(tw) && td) {
    try {
      goalInfo = computeWeightGoal({ currentWeight: resolvedCurrentWeight, targetWeight: tw, targetDate: td, referenceDate });
      calorieEstimate = computeCalorieEstimate(goalInfo.required_weekly_pace, goalInfo.direction, profile, resolvedCurrentWeight, referenceDate);
    } catch {
      goalInfo = null;
      calorieEstimate = null;
    }
  }

  return { trendSummary, paceLevel, rollingSeries, rollingSeries30, goalInfo, calorieEstimate };
}

// ── Canonical workout analytics derivation layer ──────────────────────────────

// Derives the full set of shared workout analytics from parsed sections.
// This is the single canonical entry point for all workout analytics consumers.
//
// sections:      output of parseWorkoutNote(noteText).sections
// trackedNames:  string[] of exercise names to classify, track, and derive signals for
// multiplier:    optional fatigue multiplier for signal derivation (defaults to getKiloFatigueMultiplier())
//
// Returns:
//   weeksIn:         session depth (routine depth) — max session_entries.length
//   classifications: { [normalizedName]: 'progressing'|'stalled'|'regressing'|'inconsistent'|null }
//   skipData:        { exercise_skips, day_skips, attendance_flags }
//   signals:         exercise[] — progression signals for trackedNames
//   nameDisplayMap:  Map<normalizedName, displayName> — last-seen user-typed casing
export function deriveWorkoutNoteAnalytics(sections, trackedNames, multiplier) {
  const _multiplier = multiplier !== undefined ? multiplier : getKiloFatigueMultiplier();
  if (!sections) {
    const emptyClassif = Object.fromEntries((trackedNames || []).map(n => [normalizeLiftName(n), null]));
    return {
      weeksIn: null,
      classifications: emptyClassif,
      skipData: { exercise_skips: [], day_skips: [], attendance_flags: [] },
      signals: [],
      nameDisplayMap: new Map(),
      perDaySignals: {},
    };
  }
  const nameDisplayMap = new Map();
  sections.forEach(s => s.exercises.forEach(e => {
    nameDisplayMap.set(normalizeExerciseKey(e.name), e.name);
  }));
  return {
    weeksIn: computeWeeksIn(sections),
    classifications: classifyExerciseSessions(sections, trackedNames),
    skipData: deriveSkipData(sections),
    signals: deriveSignals(sections, trackedNames, _multiplier).exercises,
    nameDisplayMap,
    perDaySignals: derivePerDaySignals(sections, trackedNames),
  };
}

// Count progressing/stalled/regressing rows exactly as the analytics panel renders.
// Iterates each exercise-per-section appearance; multi-day exercises contribute once
// per day using the per-day trend (falling back to global signal trend).
export function deriveOverloadCounts(sections, signals, perDaySignals) {
  const sigMap = new Map(
    signals.map(s => [normalizeExerciseKey(s.name), s])
  );
  const counts = { progressing: 0, stalled: 0, regressing: 0 };
  (sections || []).forEach(sec => {
    sec.exercises.forEach(ex => {
      const key = normalizeExerciseKey(ex.name);
      const sig = sigMap.get(key);
      if (!sig) return;
      const dayRow = perDaySignals?.[key]?.[sec.heading];
      const rowTrend = dayRow?.overload_trend ?? sig.overload_trend;
      if (rowTrend === 'up')   counts.progressing++;
      if (rowTrend === 'flat') counts.stalled++;
      if (rowTrend === 'down') counts.regressing++;
    });
  });
  return counts;
}

// ── Weekly Assessment Summary ────────────────────────────────────────────────

/**
 * Shapes stored weekly inputs for the assessment summary panel.
 *
 * sections: parsed sections from current routine note
 * workoutNote: current routine object (notebook item)
 */
export function computeWeeklySummary(sections, workoutNote) {
  // A session exists if there are any non-skipped entries or sets in the sections
  const hasActivity = (sections || []).some(section =>
    section.exercises.some(ex => {
      if ((ex.session_entries || []).length > 0) {
        return ex.session_entries.some(se => !se.skipped);
      }
      return (ex.sets || []).length > 0;
    })
  );

  // 1. Classification counts (tracked exercises only)
  let classifications = null;
  const sourceClassifs = workoutNote?.exercise_classifications;
  
  if (sourceClassifs) {
    classifications = { progressing: 0, stalled: 0, regressing: 0, inconsistent: 0, initial: 0 };
    Object.values(sourceClassifs).forEach(val => {
      if (classifications[val] !== undefined) {
        classifications[val]++;
      }
    });
  }

  const DISPLAYABLE = new Set(['progressing', 'stalled', 'regressing']);
  let sessionStatusRows = null;
  if (sourceClassifs) {
    const rows = Object.entries(sourceClassifs)
      .filter(([, cls]) => DISPLAYABLE.has(cls))
      .map(([name, classification]) => ({ name, classification }));
    sessionStatusRows = rows.length > 0 ? rows : null;
  }

  if (!hasActivity) {
    return {
      hasActivity: false,
      sessionStatusRows,
    };
  }

  return {
    hasActivity: true,
    classifications,
    sessionStatusRows,
  };
}

// ── Check-in history ──────────────────────────────────────────────────────────

export function deriveCheckInHistory(notes) {
  const empty = { list: [], rough: [], ok: [], pending: [], summary: { roughTotal: 0, okTotal: 0, pendingTotal: 0, top_reason: null } };
  if (!notes || notes.length === 0) return empty;

  const list = [];
  for (const note of notes) {
    const checkins = note?.session_checkins;
    if (!checkins) continue;
    for (const [key, checkin] of Object.entries(checkins)) {
      if (!checkin || !checkin.responded_at) continue;
      list.push({
        noteId: note.id,
        sessionIndex: Number(key),
        responded_at: checkin.responded_at,
        status: checkin.status ?? null,
        reasons: checkin.reasons ?? [],
        note: checkin.note ?? null,
        exercises_skipped: checkin.exercises_skipped ?? 0,
        volume_decline_pct: checkin.volume_decline_pct ?? null,
        flagged: checkin.flagged ?? [],
        detectors: checkin.detectors ?? [],
      });
    }
  }

  list.sort((a, b) => (a.responded_at < b.responded_at ? 1 : a.responded_at > b.responded_at ? -1 : 0));

  const rough = list.filter(c => c.status === 'rough');
  const ok = list.filter(c => c.status === 'ok');
  const pending = list.filter(c => c.status == null);

  let top_reason = null;
  if (rough.length > 0) {
    const counts = new Map();
    for (const c of rough) {
      for (const r of c.reasons) {
        counts.set(r, (counts.get(r) ?? 0) + 1);
      }
    }
    let max = 0;
    for (const [reason, count] of counts) {
      if (count > max) { max = count; top_reason = reason; }
    }
  }

  return { list, rough, ok, pending, summary: { roughTotal: rough.length, okTotal: ok.length, pendingTotal: pending.length, top_reason } };
}

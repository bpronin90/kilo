// Native entry model factories and exercise catalog
import { deriveTrackedPRs, deriveWorkoutAnalytics, deriveProgressionSignals, epleyPR, canonicalizeName, parseWorkoutNote } from './parser.js';
import { classifyWeightPace, formatAsymmetryNote } from './format.js';

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

// Returns the longest session_entries chain across all exercises in sections.
// Depth = total entry count (including skipped entries) for the deepest exercise line.
// Returns null when sections is absent (no routine loaded). Returns 0 when no entries logged.
export function computeWeeksIn(sections) {
  if (!sections) return null;
  let max = 0;
  for (const section of sections) {
    for (const ex of section.exercises) {
      if (ex.session_entries.length > max) max = ex.session_entries.length;
    }
  }
  return max;
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
    rep_drop_off_flags: null,
    dismissed_nudges: null,
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
  const m = /(\d{4}-\d{2}-\d{2})/.exec(heading);
  if (m) {
    date = m[1];
    if (!weekday) {
      const d = new Date(m[1] + 'T12:00:00');
      if (!isNaN(d.getTime())) weekday = _DAY_LABELS[d.getDay()];
    }
  }
  return { weekday, date };
}

function _isAsterisked(ex) {
  return (ex.raw_header || '').includes('*') || (ex.name || '').includes('*');
}

function _exerciseIdForName(name) {
  const norm = normalizeLiftName(canonicalizeName(name));
  const found = KILO_EXERCISES.find(e => normalizeLiftName(canonicalizeName(e.name)) === norm);
  return found ? found.id : null;
}

// Scan parsed sections for exercise-level and day-level skip markers plus
// derived attendance flags.
//
// referenceDate: used as the upper bound of the 30-day rolling window for
//   weekday attendance flags (defaults to today).
//
// exercise_skips: { exercise_name, exercise_id, session_index }[]
//   One entry per skipped session_entry position, excluding asterisked exercises.
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
//     — 2+ fully-skipped sessions on the same weekday within the 30-day window;
//       only counted when the day_skip carries a parseable ISO date
export function deriveSkipData(sections, { referenceDate = new Date() } = {}) {
  const exercise_skips = [];
  const day_skips = [];
  const attendance_flags = [];

  const MS_DAY = 86400000;
  const pad = n => String(n).padStart(2, '0');
  const localStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const refStr = localStr(referenceDate);
  const cutStr = localStr(new Date(+referenceDate - 29 * MS_DAY));

  const weekdayCounts = {};
  // Keyed by exercise identity (catalog id, or canonical name for non-catalog exercises).
  // Accumulates session_entries in section order for cross-section consecutive detection.
  const exerciseHistories = new Map();

  for (const section of sections) {
    const eligible = section.exercises.filter(ex =>
      ex.session_entries.length > 0 && !_isAsterisked(ex)
    );
    if (eligible.length === 0) continue;

    const { weekday, date: headingDate } = _headingInfo(section.heading);
    const maxLen = Math.max(...eligible.map(ex => ex.session_entries.length));

    for (const ex of eligible) {
      const exId = _exerciseIdForName(ex.name);
      const histKey = exId ?? normalizeLiftName(canonicalizeName(ex.name));

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

      // Count toward weekday flag only when date is known and within the 30-day window.
      if (weekday && headingDate && headingDate >= cutStr && headingDate <= refStr) {
        weekdayCounts[weekday] = (weekdayCounts[weekday] || 0) + 1;
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

  for (const [weekday, count] of Object.entries(weekdayCounts)) {
    if (count >= 2) {
      attendance_flags.push({ type: 'repeated_weekday_skip', weekday, skip_count: count });
    }
  }

  return { exercise_skips, day_skips, attendance_flags };
}

// ── Per-exercise session classification ───────────────────────────────────────

function _avgRepsAtWeight(sets, weight) {
  const matching = sets.filter(s => s.weight_value === weight);
  if (matching.length === 0) return 0;
  return matching.reduce((sum, s) => sum + s.rep_count, 0) / matching.length;
}

// Returns true when a majority of sets at the given weight improved vs the prior session.
// Compares sorted rep counts positionally so set-recording order doesn't matter.
function _majorityOfSetsImproved(latestSets, priorSets, weight) {
  const latest = latestSets.filter(s => s.weight_value === weight).map(s => s.rep_count).sort((a, b) => a - b);
  const prior = priorSets.filter(s => s.weight_value === weight).map(s => s.rep_count).sort((a, b) => a - b);
  const pairs = Math.min(latest.length, prior.length);
  if (pairs === 0) return false;
  let improved = 0;
  for (let i = 0; i < pairs; i++) {
    if (latest[i] > prior[i]) improved++;
  }
  return improved > pairs / 2;
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
  if (logged.length === 1) return 'initial';

  const hasSkip = window.some(se => se.skipped);
  const latest = logged[logged.length - 1];
  const prior = logged[logged.length - 2];
  const latestTop = _topWeight(latest.sets);
  const priorTop = _topWeight(prior.sets);

  // regressing: top weight dropped, or same weight but avg reps dropped > 2
  if (latestTop < priorTop) return 'regressing';
  if (latestTop === priorTop) {
    const latestAvg = _avgRepsAtWeight(latest.sets, latestTop);
    const priorAvg = _avgRepsAtWeight(prior.sets, priorTop);
    if (priorAvg - latestAvg > 2) return 'regressing';
  }

  // progressing: top weight increased, or same weight with majority of sets showing higher reps
  if (latestTop > priorTop) return 'progressing';
  if (latestTop === priorTop && _majorityOfSetsImproved(latest.sets, prior.sets, latestTop)) return 'progressing';

  // stalled: same top weight, same rep distribution at top weight
  if (latestTop === priorTop) {
    const latestReps = latest.sets.filter(s => s.weight_value === latestTop).map(s => s.rep_count).sort((a, b) => a - b);
    const priorReps = prior.sets.filter(s => s.weight_value === priorTop).map(s => s.rep_count).sort((a, b) => a - b);
    if (JSON.stringify(latestReps) === JSON.stringify(priorReps)) return 'stalled';
  }

  // inconsistent: skipped sessions mixed with logged in window
  if (hasSkip) return 'inconsistent';

  return null;
}

// Classify session trends for all tracked exercises.
// sections: output of parseWorkoutNote(noteText).sections
// trackedNames: string[] of exercise names to classify
// Returns { [normalizedName]: 'progressing'|'stalled'|'regressing'|'inconsistent'|null }
export function classifyExerciseSessions(sections, trackedNames) {
  const { exercises } = deriveWorkoutAnalytics(sections);
  const result = {};
  for (const name of trackedNames) {
    const normName = normalizeLiftName(name);
    const lookupKey = normalizeLiftName(canonicalizeName(name));
    const ex = exercises.find(e => normalizeLiftName(e.name) === lookupKey);
    if (!ex) { result[normName] = null; continue; }
    // Mirror deriveProgressionSignals dual-path: occurrences with session_entries
    // expand per-entry (preserving skips for the window); plain-row occurrences
    // (inline sets, no session_entries) each count as one session unit.
    const allEntries = ex.occurrences.flatMap(occ => {
      if ((occ.session_entries || []).length > 0) return occ.session_entries;
      return occ.sets.length > 0 ? [{ skipped: false, sets: occ.sets }] : [];
    });
    result[normName] = _classifyEntries(allEntries);
  }
  return result;
}

// ── Rep drop-off flag ─────────────────────────────────────────────────────────

// Compute the intra-session rep drop-off flag for one session's sets.
// Uses working sets (weight_value > 0, rep_count > 0) only.
// Mixed-weight: uses the heaviest-weight sets to compute first/last reps.
// Returns 'hit_wall' | 'in_reserve' | null.
export function computeRepDropOff(sets) {
  const working = (sets || []).filter(s => s.weight_value > 0 && s.rep_count > 0);
  if (working.length < 2) return null;
  const maxWeight = Math.max(...working.map(s => s.weight_value));
  const atMax = working.filter(s => s.weight_value === maxWeight);
  if (atMax.length < 2) return null; // only 1 set at heaviest weight → ambiguous
  const dropOff = atMax[0].rep_count - atMax[atMax.length - 1].rep_count;
  if (dropOff >= 3) return 'hit_wall';
  if (dropOff <= 1) return 'in_reserve';
  return null; // drop_off === 2
}

// Derive rep drop-off flags for all tracked exercises, per session.
// Returns { [normalizedName]: { [sessionIndex]: 'hit_wall' | 'in_reserve' | null } }
// Only logged (non-skipped) sessions are included; skipped sessions are omitted.
// sessionIndex is the positional index in the exercise's full entry history (oldest = 0).
export function deriveRepDropOffFlags(sections, trackedNames) {
  const { exercises } = deriveWorkoutAnalytics(sections);
  const result = {};
  for (const name of trackedNames) {
    const normName = normalizeLiftName(name);
    const lookupKey = normalizeLiftName(canonicalizeName(name));
    const ex = exercises.find(e => normalizeLiftName(e.name) === lookupKey);
    if (!ex) { result[normName] = {}; continue; }
    const allEntries = ex.occurrences.flatMap(occ => {
      if ((occ.session_entries || []).length > 0) return occ.session_entries;
      return occ.sets.length > 0 ? [{ skipped: false, sets: occ.sets }] : [];
    });
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
// sessionFlags: { [sessionIndex]: 'hit_wall' | 'in_reserve' | null }
// Returns 'hit_wall' | 'in_reserve' | null
export function getLatestRepDropOff(sessionFlags) {
  if (!sessionFlags || typeof sessionFlags !== 'object') return null;
  const keys = Object.keys(sessionFlags);
  if (keys.length === 0) return null;
  const maxIdx = Math.max(...keys.map(Number));
  return sessionFlags[String(maxIdx)] ?? null;
}

// ── Cross-lift asymmetry detection (Big 3) ────────────────────────────────────

const _BIG3_NAMES = { squat: 'Squat', bench: 'DB Bench Press', deadlift: 'Deadlift' };
const _BIG3_SLOTS = ['squat', 'bench', 'deadlift'];
const _BIG3_PAIRS = [['squat', 'bench'], ['squat', 'deadlift'], ['bench', 'deadlift']];

// Monday of the week containing dateStr, as 'YYYY-MM-DD'.
function _weekKey(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay(); // 0=Sun
  const daysToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(+d + daysToMon * 86400000);
  const pad = n => String(n).padStart(2, '0');
  return `${mon.getFullYear()}-${pad(mon.getMonth() + 1)}-${pad(mon.getDate())}`;
}

// Returns { squat: [{date, entry}], bench: [...], deadlift: [...] }, oldest first.
function _big3DateEntries(sections) {
  const { exercises } = deriveWorkoutAnalytics(sections);
  const out = { squat: [], bench: [], deadlift: [] };
  for (const slot of _BIG3_SLOTS) {
    const normTarget = normalizeLiftName(canonicalizeName(_BIG3_NAMES[slot]));
    const ex = exercises.find(e => normalizeLiftName(e.name) === normTarget);
    if (!ex) continue;
    for (const occ of ex.occurrences) {
      const { date } = _headingInfo(occ.heading);
      if (!date) continue;
      const entries = (occ.session_entries || []).length > 0
        ? occ.session_entries
        : occ.sets.length > 0 ? [{ skipped: false, sets: occ.sets }] : [];
      for (const entry of entries) out[slot].push({ date, entry });
    }
  }
  return out;
}

// Returns sorted array of { week, squat, bench, deadlift } classification objects.
function _classifyBig3ByWeek(sections) {
  const dateEntries = _big3DateEntries(sections);

  // Group entries by week for each slot.
  const weekMap = {}; // slot → { weekKey: entry[] }
  const allWeeks = new Set();
  for (const slot of _BIG3_SLOTS) {
    weekMap[slot] = {};
    for (const { date, entry } of dateEntries[slot]) {
      const wk = _weekKey(date);
      allWeeks.add(wk);
      if (!weekMap[slot][wk]) weekMap[slot][wk] = [];
      weekMap[slot][wk].push(entry);
    }
  }

  const sortedWeeks = [...allWeeks].sort();
  return sortedWeeks.map(week => {
    const row = { week };
    for (const slot of _BIG3_SLOTS) {
      // Only classify when the lift has a session this week; weeks with no
      // session for this slot produce null so the forward-walk skips them.
      if (!weekMap[slot][week]?.length) {
        row[slot] = null;
        continue;
      }
      const entriesUpTo = sortedWeeks
        .filter(wk => wk <= week)
        .flatMap(wk => weekMap[slot][wk] || []);
      row[slot] = _classifyEntries(entriesUpTo);
    }
    return row;
  });
}

function _isAsymmetric(clA, clB) {
  if (clA === 'progressing' && (clB === 'stalled' || clB === 'regressing')) return true;
  if (clB === 'progressing' && (clA === 'stalled' || clA === 'regressing')) return true;
  return false;
}

// Returns true only when both lifts have the same concrete classification.
// null, 'initial', and 'inconsistent' are not concrete and cannot constitute a break.
function _sharedConcreteClassification(clA, clB) {
  const concrete = ['progressing', 'stalled', 'regressing'];
  return concrete.includes(clA) && clA === clB;
}

// Detect active cross-lift asymmetry notes for the Big 3.
//
// A note fires when one Big 3 lift is progressing while another is stalled or
// regressing for 2+ asymmetric weeks within a single run. A run resets only
// when both lifts share the same concrete classification (the issue-specified
// break condition). Weeks where either lift is null/initial/inconsistent are
// ignored: they neither count toward the run nor break it.
//
// dismissedAsymmetries: { [dismissKey]: true }
//   dismissKey encodes the pair and the week the current asymmetric run started,
//   so a dismissed note re-fires automatically after the relationship breaks and
//   then re-emerges (the runStart week changes, making the old key stale).
//
// Returns: Array<{ copy: string, dismissKey: string }>
export function detectBig3Asymmetry(sections, dismissedAsymmetries = {}) {
  const weekSeries = _classifyBig3ByWeek(sections);
  if (weekSeries.length < 2) return [];

  const notes = [];
  for (const [slotA, slotB] of _BIG3_PAIRS) {
    // Forward walk: accumulate the current run.
    // Reset only on a shared concrete classification (the break condition).
    // Skip null/initial/inconsistent weeks without counting or resetting.
    let runStart = null;
    let runCount = 0;
    for (const { [slotA]: clA, [slotB]: clB, week } of weekSeries) {
      if (_sharedConcreteClassification(clA, clB)) {
        runStart = null;
        runCount = 0;
      } else if (_isAsymmetric(clA, clB)) {
        if (runStart === null) runStart = week;
        runCount++;
      }
      // null/initial/inconsistent on either side: ignored
    }

    if (runCount < 2) continue;

    const last = weekSeries[weekSeries.length - 1];
    const clA = last[slotA];
    const clB = last[slotB];
    const [progressingSlot, laggingSlot, laggingClass] = clA === 'progressing'
      ? [slotA, slotB, clB]
      : [slotB, slotA, clA];

    const dismissKey = `asymmetry:${slotA}_${slotB}:${runStart}`;
    if (dismissedAsymmetries[dismissKey]) continue;

    notes.push({ copy: formatAsymmetryNote(progressingSlot, laggingSlot, laggingClass), dismissKey });
  }
  return notes;
}

// Wrap deriveProgressionSignals and replace kilo_max with the Epley-average x
// fatigue formula (adjusted, rounded).
export function deriveSignals(sections, trackedNames, multiplier = getKiloFatigueMultiplier()) {
  const { exercises: signals } = deriveProgressionSignals(sections, trackedNames);
  const { exercises: analyticsExercises } = deriveWorkoutAnalytics(sections);

  const byName = new Map(analyticsExercises.map(ex => [ex.name.toLowerCase(), ex]));

  return {
    exercises: signals.map(sig => {
      const ex = byName.get(sig.name.toLowerCase());
      if (!ex) return sig;
      const { kilo_max_adjusted } = computeKiloMax(ex.occurrences, multiplier);
      return { ...sig, kilo_max: kilo_max_adjusted };
    }),
  };
}

// ── Weekly Assessment Summary ────────────────────────────────────────────────

function _sundayWeekKey(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay(); // 0=Sun
  const sun = new Date(+d - day * 86400000);
  const pad = n => String(n).padStart(2, '0');
  return `${sun.getFullYear()}-${pad(sun.getMonth() + 1)}-${pad(sun.getDate())}`;
}

/**
 * Shapes stored weekly inputs for the assessment summary panel.
 *
 * sections: parsed sections from current routine note
 * workoutNote: current routine object (notebook item)
 * options: { referenceDate: Date, dismissedAsymmetries: object }
 */
export function computeWeeklySummary(sections, workoutNote, { referenceDate = new Date(), dismissedAsymmetries = {} } = {}) {
  const pad = n => String(n).padStart(2, '0');
  const localStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const weekKey = _sundayWeekKey(localStr(referenceDate));

  // Extract dates for all non-skipped sessions in sections
  const sessionDates = new Set();
  (sections || []).forEach(section => {
    const { date } = _headingInfo(section.heading);
    if (!date) return;
    const hasLogged = section.exercises.some(ex =>
      (ex.session_entries || []).some(se => !se.skipped)
    );
    if (hasLogged) sessionDates.add(date);
  });

  // A session is in the current week if its Sunday-based weekKey matches the reference's.
  const hasActivity = [...sessionDates].some(date => _sundayWeekKey(date) === weekKey);

  if (!hasActivity) {
    return { hasActivity: false };
  }

  // 1. Classification counts (tracked exercises only)
  const classifications = { progressing: 0, stalled: 0, regressing: 0, inconsistent: 0 };
  const storedClassifs = workoutNote?.exercise_classifications || {};
  Object.values(storedClassifs).forEach(val => {
    if (classifications[val] !== undefined) {
      classifications[val]++;
    }
  });

  // 2. Big 3 strength delta (consume upstream-stored data)
  const deltas = workoutNote?.big_3_deltas || null;

  // 3. Flags
  const flags = {
    hit_wall: false,
    in_reserve: false,
    attendance: (workoutNote?.attendance_flags || []).length > 0,
    asymmetry: false,
  };

  // Check rep_drop_off_flags for any tracked exercise
  const dropOff = workoutNote?.rep_drop_off_flags || {};
  Object.values(dropOff).forEach(sessionFlags => {
    const latest = getLatestRepDropOff(sessionFlags);
    if (latest === 'hit_wall') flags.hit_wall = true;
    if (latest === 'in_reserve') flags.in_reserve = true;
  });

  // Check asymmetry via existing helper (respects dismissals)
  const asymmetryNotes = detectBig3Asymmetry(sections || [], dismissedAsymmetries);
  flags.asymmetry = asymmetryNotes.length > 0;

  return {
    hasActivity: true,
    classifications,
    deltas,
    flags,
  };
}

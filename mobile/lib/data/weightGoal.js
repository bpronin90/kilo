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

// Determine whether the active weight goal's weight threshold has been reached,
// independent of the goal's target_date. A loss goal's threshold is reached when
// currentWeight ≤ target_weight. A gain goal's threshold is reached when
// currentWeight ≥ target_weight. A maintain-style goal (delta < 0.5 lb from start)
// is reached when within 0.5 lb of target. Returns false when goal or
// currentWeight is missing.
export function isWeightThresholdMet(goal, currentWeight) {
  if (!goal || currentWeight == null || goal.target_weight == null) return false;
  const { target_weight, start_weight } = goal;
  const refWeight = start_weight ?? currentWeight;
  const goalDelta = target_weight - refWeight;
  if (Math.abs(goalDelta) < 0.5) {
    return Math.abs(target_weight - currentWeight) < 0.5;
  }
  if (goalDelta < 0) {
    return currentWeight <= target_weight;
  }
  return currentWeight >= target_weight;
}

// Determine whether the active weight goal has been met: the weight threshold is
// reached (see isWeightThresholdMet) AND the local calendar date is on or after
// the goal's target_date. Reaching the threshold before target_date is progress,
// not completion — a target date is part of the goal contract.
// referenceDate: Date used as "today" for the calendar-date comparison (defaults
// to now; pass a fixed date for tests, or an archived goal's archived_at so
// history judgments are stable regardless of when they're later viewed).
// A missing or malformed target_date cannot be proven to have arrived, so it
// does NOT count as met even when the weight threshold is reached — this avoids
// a false completed state for goals recorded without a valid target date.
// Returns false when goal or currentWeight is missing.
export function isGoalMet(goal, currentWeight, referenceDate = new Date()) {
  if (!isWeightThresholdMet(goal, currentWeight)) return false;

  const target_date = goal.target_date;
  if (!target_date) return false;

  // Round-trip component check: JS normalizes impossible dates (e.g. Sep 31 → Oct 1)
  // instead of returning Invalid Date, so isNaN alone is insufficient.
  const [tYear, tMonth, tDay] = target_date.split('-').map(Number);
  const targetMidnight = new Date(tYear, tMonth - 1, tDay);
  const isValidTargetDate =
    tYear && tMonth && tDay &&
    targetMidnight.getFullYear() === tYear &&
    targetMidnight.getMonth() === tMonth - 1 &&
    targetMidnight.getDate() === tDay;
  if (!isValidTargetDate) return false;

  const pad = (n) => String(n).padStart(2, '0');
  const today = `${referenceDate.getFullYear()}-${pad(referenceDate.getMonth() + 1)}-${pad(referenceDate.getDate())}`;
  return target_date <= today;
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

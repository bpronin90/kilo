// Native entry model factories and exercise catalog

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

// Return the default set of tracked exercise names (those with po: true)
export function getDefaultTrackedNames() {
  return KILO_EXERCISES.filter(e => e.po).map(e => e.name);
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

// Factory for the canonical workout routine note
export function makeWorkoutNote({ raw_text }) {
  const now = new Date().toISOString();
  return {
    raw_text,
    saved_at: now,
    updated_at: now,
  };
}

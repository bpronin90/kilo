// data.jsx — Kilo seed data, populated from Ben's real export
// Each exercise has an array of past session logs (raw text), most recent last.
// We rebuild sessions by zipping per-day exercises across history rows.

const KILO_SPLIT = {
  monday:    { label: 'Push',       sub: 'Chest · Shoulders · Tris' },
  tuesday:   { label: 'Squat',      sub: 'Legs' },
  wednesday: { label: 'Pull',       sub: 'Back · Bis' },
  thursday:  { label: 'Push Upper', sub: 'Incline · Accessories' },
  friday:    { label: 'Deadlift',   sub: 'Posterior · Legs' },
};

// Exercises with embedded history (oldest → newest). '-' = skipped session.
// Tagged: warmup vs lifting; po=true means progressive overload tracked.
const RAW_EXERCISES = [
  // ───── MONDAY ─────
  { id: 'mon_bike',         day: 'monday', name: 'Bike',                 cat: 'warmup', po: false, target: '5 min',
    history: ['9','10','6','7','7','7','7','7 3'] },
  { id: 'mon_pec_stretch',  day: 'monday', name: 'Pec stretch — roller',  cat: 'warmup', po: false, target: '2×60s' },
  { id: 'mon_band_pa',      day: 'monday', name: 'Band pull-aparts',      cat: 'warmup', po: false, target: '2×15 light' },
  { id: 'mon_cuff',         day: 'monday', name: 'Rotator cuff cable',    cat: 'warmup', po: false, target: '1×12–15 ea, 12.5 lb' },

  { id: 'db_bench', day: 'monday', name: 'DB Bench Press', cat: 'primary_compound', po: true, target: '4×6–8',
    history: [
      '80 8,8,8,8',
      '85 8 80 8,8,8',
      '85 8,8 80 8,8',
      '85 8,8,8,6',
      '90 7,7 85 8,8',
      '90 8,8,7 85 8',
      '90 8,8,8,5',
      '95 4,4 90 8,8',
      '95 6,6,6 90 8',
      '95 7,7,7,7',
    ] },
  { id: 'cable_fly', day: 'monday', name: 'Low-to-High Cable Fly', cat: 'accessory', po: false, target: '2×12',
    history: [
      '17.5 10 12.5 12',
      '12.5 12,12',
      '12.5 12,12',
      '12.5 12,12',
      '12.5 12,12',
      '12.5 12,12',
      '17.5 10 12.5 12',
      '17.5 10 12.5 12',
      '17.5 10 12.5 12',
      '17.5 12 12.5 12',
    ] },
  { id: 'lateral', day: 'monday', name: 'Lateral Raise', cat: 'accessory', po: false, target: '2×12',
    history: [
      '15 12,12',
      '17.5 12 15 12',
      '17.5 12,12',
      '20 10 17.5 12',
      '20 12 17.5 12',
      '20 12,10',
      '20 12,12',
      '22.5 10 20 12',
      '22.5 12 20 12',
      '22.5 10 20 12',
    ] },
  { id: 'hammer_curl_mon', day: 'monday', name: 'Hammer Curl', cat: 'accessory', po: true, target: '2×8–10',
    history: [
      '20 10,10',
      '22.5 12,12',
      '25 12,10',
      '27.5 10,10',
      '30 10 27.5 10',
      '30 10,10',
      '35 10 30 10',
      '35 10,10',
      '40 10 35 12',
      '40 10,10',
    ] },
  { id: 'sa_pushdown_mon', day: 'monday', name: 'Single-Arm Pushdown', cat: 'accessory', po: false, target: '2×10–12',
    history: [
      '15 12,12',
      '17.5 12,12',
      '19 12,10',
      '19 12,12',
      '20.5 12 19 12',
      '20.5 12,10',
      '20.5 12,12',
      '22.5 8 20.5 12',
      '22.5 12 20.5 12',
      '22.5 12,12',
    ] },
  { id: 'inout', day: 'monday', name: 'In-and-outs (bench)', cat: 'core', po: false, target: '2×10–12',
    history: ['12,12,12','12,12','12,12','12,12,12','12,12,12','12,12,12','15,12,12','12,12,12','12,12,12'] },

  // ───── TUESDAY ─────
  { id: 'tue_bike', day: 'tuesday', name: 'Bike', cat: 'warmup', po: false, target: '5 min',
    history: ['10','4','6','3 7 2 4','6 5','7','5','7','7','7'] },
  { id: 'hip9090',  day: 'tuesday', name: '90/90 hip stretch',         cat: 'warmup', po: false, target: '60s ea side' },
  { id: 'hipflex',  day: 'tuesday', name: 'Hip flexor stretch',        cat: 'warmup', po: false, target: '60s ea side' },
  { id: 'leg_swing',day: 'tuesday', name: 'Leg swings · forward+lat',  cat: 'warmup', po: false, target: '12–15 ea' },
  { id: 'bw_squat', day: 'tuesday', name: 'Bodyweight squats',          cat: 'warmup', po: false, target: '10' },

  { id: 'squat', day: 'tuesday', name: 'Squat', cat: 'primary_compound', po: true, target: '4×6–8',
    history: [
      '205 8,8,8,8',
      '215 8,6 205 8,8',
      '-',
      '215 8,8,6 205 8',
      '215 8,8,8,8',
      '225 5,5 215 8,8',
      '225 8,8,8,8',
      '235 6,6 225 8,8',
      '235 8,8,6 225 8',
      '245 4 235 8,8,8',
    ] },
  { id: 'sl_ext', day: 'tuesday', name: 'Single-Leg Extension', cat: 'accessory', po: true, target: '3×10–12',
    history: [
      '20 12,12,12',
      '20 12,12,12',
      '22.5 12 20 12,12',
      '22.5 12,12 20 12',
      '22.5 12,12,12',
      '25 12,12,12',
      '27.5 12 25 12 22.5 12',
      '27.5 12,12,12',
      '30 12,10 27.5 12',
      '30 12,12,12',
    ] },
  { id: 'leg_press', day: 'tuesday', name: 'Leg Press', cat: 'secondary_compound', po: true, target: '2×12 (calf SS)',
    history: [
      '240 12,12',
      '250 12,12',
      '260 12,12,12',
      '270 10,10',
      '270 12,12',
      '280 12,12',
      '290 12,10',
      '290 12,12',
      '300 8 290 12',
      '300 10,10',
    ] },
  { id: 'calf_raise', day: 'tuesday', name: 'Calf Raises', cat: 'accessory', po: true, target: '2×12',
    history: [
      '160 12,12',
      '170 12,12',
      '180 12,12,12',
      '190 10,12',
      '190 12,12',
      '200 12,12',
      '210 12,10',
      '210 12,12',
      '220 12,12',
      '230 10,10',
    ] },
  { id: 'plank', day: 'tuesday', name: 'Plank', cat: 'core', po: false, target: '2×30–45s',
    history: ['30,30','32,32','-','34,34','-','36,36','38,38','-','-'] },

  // ───── WEDNESDAY — Pull ─────
  { id: 'wed_bike', day: 'wednesday', name: 'Bike', cat: 'warmup', po: false, target: '5 min',
    history: ['7 2 6 3','6','7','7','7','7','7'] },
  { id: 'trx_row',   day: 'wednesday', name: 'TRX Rows',           cat: 'warmup', po: false, target: '10' },
  { id: 'wed_band',  day: 'wednesday', name: 'Band pull-aparts',   cat: 'warmup', po: false, target: '2×15' },
  { id: 'sleeper',   day: 'wednesday', name: 'Sleeper stretch',    cat: 'warmup', po: false, target: '60s ea' },
  { id: 'cat_cow',   day: 'wednesday', name: 'Cat-cow',            cat: 'warmup', po: false, target: '2×10' },

  { id: 'iso_row', day: 'wednesday', name: 'Hammer Strength Iso Row', cat: 'primary_compound', po: true, target: '3×6–8',
    history: [
      '80 8,8 85 8',
      '85 8,8,8',
      '90 8,8,8',
      '95 8,8,8',
      '100 8,8,8',
      '105 8,8,8',
      '110 8,8,8',
      '115 8,8,8',
    ] },
  { id: 'lat_pd', day: 'wednesday', name: 'Lat Pulldown', cat: 'secondary_compound', po: true, target: '2×10–12',
    history: [
      '120 12,12',
      '125 12,10',
      '125 12,12',
      '130 12,12',
      '135 12,12',
      '140 12,10',
      '140 12,12',
      '145 12,12',
    ] },
  { id: 'face_pull', day: 'wednesday', name: 'Face Pulls', cat: 'accessory', po: false, target: '2×15',
    history: [
      '22.5 15,15',
      '24 15,15',
      '26.5 15,15',
      '27.5 12,12',
      '27.5 15,15',
      '29 12,12',
      '29 15,15',
      '30.5 12,12',
    ] },
  { id: 'rev_pec', day: 'wednesday', name: 'Reverse Pec Deck', cat: 'accessory', po: true, target: '2×10–12',
    history: [
      '60 12,12',
      '60 12,12',
      '65 10,12',
      '65 12,12',
      '70 12,12',
      '75 10,10',
      '75 12,10',
      '75 12,12',
    ] },
  { id: 'hammer_curl_wed', day: 'wednesday', name: 'Hammer Curl', cat: 'accessory', po: true, target: '2×8–10',
    history: [
      '25 10 27.5 10',
      '27.5 10,10',
      '22.5 10,10',
      '25 10,10',
      '27.5 10,10',
      '30 10,10',
      '35 10,10',
    ] },
  { id: 'deadbug', day: 'wednesday', name: 'Dead bugs', cat: 'core', po: false, target: '2×8 ea',
    history: ['8,8','8,8','8,8','8,8','-','8,8','-','-'] },

  // ───── THURSDAY — Push Upper ─────
  { id: 'thu_bike', day: 'thursday', name: 'Bike', cat: 'warmup', po: false, target: '5 min',
    history: ['5','6','6','7 3','7','7'] },
  { id: 'wall_slide', day: 'thursday', name: 'Scapular wall slides', cat: 'warmup', po: false, target: '10–20' },
  { id: 'thu_pec',    day: 'thursday', name: 'Pec stretch · roller',  cat: 'warmup', po: false, target: '60s' },
  { id: 'thu_cuff',   day: 'thursday', name: 'Rotator cuff cable',    cat: 'warmup', po: false, target: '1×12–15 ea' },

  { id: 'incline_db', day: 'thursday', name: 'Incline DB Press', cat: 'primary_compound', po: true, target: '3×8–10',
    history: [
      '65 10,10,10',
      '70 10,10 65 10',
      '75 8 70 10,8',
      '75 10,10,10',
      '80 8,8 70 10',
      '80 9,9,9',
      '80 10,10,10',
    ] },
  { id: 'pec_deck', day: 'thursday', name: 'Pec Deck', cat: 'accessory', po: true, target: '2×10–12',
    history: [
      '90 12,12,5',
      '95 12,12',
      '100 12,12',
      '100 12,12',
      '105 12,12',
      '107.5 12,12',
      '120 12,10',
    ] },
  { id: 'hs_press', day: 'thursday', name: 'HS Shoulder Press', cat: 'secondary_compound', po: false, target: '2×8–10',
    history: [
      '45 10,10',
      '50 10,10',
      '55 10,10',
      '60 10,10',
      '65 10,8',
      '65 10,10',
      '70 8,8',
    ] },
  { id: 'cable_row', day: 'thursday', name: 'Seated Cable Row', cat: 'secondary_compound', po: true, target: '2×10–12',
    history: [
      '100 12,12',
      '105 12,12',
      '110 12,12',
      '115 12,12',
      '120 12,12',
      '125 12,12',
      '130 12,12',
    ] },
  { id: 'skull', day: 'thursday', name: 'Skull Crushers', cat: 'accessory', po: true, target: '2×8–10',
    history: [
      '50 10,10',
      '45 10 55 10',
      '55 10,10',
      '60 10,10',
      '65 10,8',
      '65 10,10',
      '70 8,8',
    ] },
  { id: 'sa_pushdown_thu', day: 'thursday', name: 'Single-Arm Pushdown', cat: 'accessory', po: false, target: '2×10–12',
    history: [
      '12.5 12,12',
      '15 12,12',
      '17.5 12,12',
      '19 10,10',
      '19 12,12',
      '20.5 10,8',
      '20.5 10,10',
    ] },

  // ───── FRIDAY — Deadlift ─────
  { id: 'fri_bike', day: 'friday', name: 'Bike', cat: 'warmup', po: false, target: '5 min',
    history: ['5','6','6','6','7','7','7','7','7'] },
  { id: 'banded_legs', day: 'friday', name: 'Banded leg raises',     cat: 'warmup', po: false, target: '10 ea' },
  { id: 'hams_band',   day: 'friday', name: 'Hamstring stretch (band)', cat: 'warmup', po: false, target: '60–90s ea' },
  { id: 'fri_9090',    day: 'friday', name: '90/90 hip stretch',     cat: 'warmup', po: false, target: '60s ea' },
  { id: 'bar_dl',      day: 'friday', name: 'Light deadlift · bar',   cat: 'warmup', po: false, target: '10' },

  { id: 'deadlift', day: 'friday', name: 'Deadlift', cat: 'primary_compound', po: true, target: '4×4–6',
    history: [
      '275 6,6 265 6,6',
      '275 6,6,6,6',
      '285 6,6,6,6',
      '295 6,6,4,4',
      '295 6,6,6,6',
      '305 5,5 295 6,6',
      '305 6,6,4 295 6',
      '305 6,6,6,6',
      '315 4,4,4,4',
    ] },
  { id: 'rdl', day: 'friday', name: 'RDL', cat: 'secondary_compound', po: true, target: '2×8–10',
    history: [
      '195 8 185 10',
      '195 10,8',
      '195 10,10',
      '205 8,8',
      '205 8,8',
      '205 10,10',
      '210 8,8',
      '210 8,8',
      '210 8,8',
    ] },
  { id: 'sl_rdl', day: 'friday', name: 'Single-Leg RDL', cat: 'accessory', po: false, target: '2×8 ea',
    history: ['5 8,8','-','5 8,8','-','5 8,8','5 10,10','-','5 10,10','-'] },
  { id: 'goblet_calf', day: 'friday', name: 'Goblet Calf Raise', cat: 'accessory', po: true, target: '3×12–15',
    history: [
      '17.5 15,12 15 15',
      '17.5 15,15,15',
      '20 12,15,15',
      '20 15 22.5 15 25 15',
      '25 12,12,12',
      '25 15,15,15',
      '27.5 15,15,15',
      '30 15,15,15',
      '35 12,12,12',
    ] },
  { id: 'pallof', day: 'friday', name: 'Pallof Press', cat: 'core', po: true, target: '2×10 ea',
    history: [
      '22.5 10 17.5 10',
      '22.5 12,12',
      '24 12,12',
      '26.5 12,12',
      '27.5 10,10',
      '29 10,10',
      '30.5 10,8',
      '30.5 10,10',
      '32.5 10,10',
    ] },
];

// Build a normalized exercise list (no history field) + rep range from target
function parseRepRange(target) {
  // e.g. "4×6–8" → {sets: 4, repMin: 6, repMax: 8}
  if (!target) return { sets: 0, repMin: 0, repMax: 0 };
  const m = target.match(/(\d+)[×x](\d+)(?:[–-](\d+))?/);
  if (!m) return { sets: 0, repMin: 0, repMax: 0 };
  return {
    sets: parseInt(m[1]),
    repMin: parseInt(m[2]),
    repMax: m[3] ? parseInt(m[3]) : parseInt(m[2]),
  };
}

const KILO_EXERCISES = RAW_EXERCISES.map(e => {
  const rr = parseRepRange(e.target);
  return {
    id: e.id, name: e.name, day: e.day, cat: e.cat, po: e.po,
    repMin: rr.repMin, repMax: rr.repMax, sets: rr.sets,
    target: e.target,
    isWarmup: e.cat === 'warmup' || e.cat === 'core',
  };
});

// PT exercises (daily checklist — separate from lifting)
const KILO_PT = [
  { id: 'serratus',   name: 'Serratus Punches' },
  { id: 'wall_slides', name: 'Floor Wall Slides' },
  { id: 'sleeper',    name: 'Sleeper Stretch' },
  { id: 'cross_body', name: 'Cross-body Stretch' },
  { id: 'pull_apart', name: 'Band Pull-aparts' },
];

// Build sessions: take the HISTORY arrays per day and zip them.
// For Monday we have ~10 rows of DB Bench history → that means ~10 sessions back.
// We compute, for each day, the max history length, and create that many sessions.
// Each session = the i'th entry from each exercise on that day (most-recent at end).
function buildSessions() {
  const today = new Date('2026-05-05T12:00:00'); // Tuesday
  const dayMap = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const days = ['monday','tuesday','wednesday','thursday','friday'];

  const sessions = [];

  // For each day, find lifting (non-warmup) exercises with history.
  // The MAX history length determines how many sessions back we have for that day.
  for (const day of days) {
    const exes = RAW_EXERCISES.filter(e => e.day === day && e.history && e.cat !== 'warmup');
    if (!exes.length) continue;
    // max history length across lifting exercises (use main lift as primary)
    const maxLen = Math.max(...exes.map(e => e.history.length));

    // For each "i sessions ago" (i=0 is most-recent)
    for (let i = 0; i < maxLen; i++) {
      // Compute the date for this day, i weeks ago (most-recent occurrence first)
      // Find the most-recent occurrence of `day` <= today
      const todayDow = today.getDay();
      const targetDow = dayMap.indexOf(day);
      let daysBack = (todayDow - targetDow + 7) % 7;
      if (daysBack === 0 && day !== dayMap[todayDow]) daysBack = 7;
      // For 'tuesday' (today), daysBack=0 means today — but we haven't logged today yet.
      // So treat i=0 as last-week if it would equal today.
      if (daysBack === 0) daysBack = 7;
      const d = new Date(today);
      d.setDate(d.getDate() - daysBack - i * 7);
      if (d > today) continue;
      const iso = d.toISOString().slice(0, 10);

      const sessionExercises = [];
      let allSkipped = true;
      for (const e of exes) {
        const histIdx = e.history.length - 1 - i; // most-recent at end
        if (histIdx < 0) continue;
        const raw = e.history[histIdx];
        if (raw && raw !== '-') allSkipped = false;
        sessionExercises.push({ exerciseId: e.id, raw: raw || '-' });
      }
      if (sessionExercises.length === 0) continue;
      sessions.push({
        id: `s_${iso}_${day}`,
        entry_type: 'workout',
        date: iso,
        saved_at: iso + 'T23:00:00Z',
        day,
        duration: 50 + Math.floor(Math.random() * 20),
        exercises: sessionExercises,
      });
    }
  }
  // Sort newest first
  sessions.sort((a, b) => b.date.localeCompare(a.date));
  return sessions;
}

// Weight log: 6 weeks of daily weigh-ins, ~193 trending down (Ben is on a cut)
function buildWeightLog() {
  const today = new Date('2026-05-05T12:00:00');
  const out = [];
  for (let daysBack = 41; daysBack >= 0; daysBack--) {
    const d = new Date(today);
    d.setDate(d.getDate() - daysBack);
    const iso = d.toISOString().slice(0, 10);
    const trend = 193.5 - (41 - daysBack) * 0.11;
    const dow = d.getDay();
    let bump = 0;
    if (dow === 0 || dow === 6) bump = 1.4 + Math.random() * 0.8;
    if (dow === 5) bump = 0.8 + Math.random() * 0.5;
    if (dow === 1) bump = 0.6;
    const noise = (Math.random() - 0.5) * 1.6;
    const spike = (daysBack === 18 || daysBack === 19) ? 2.1 : 0;
    const w = trend + bump + noise + spike;
    if (daysBack === 28 || daysBack === 14) continue; // missed days
    out.push({
      id: `w_${iso}`,
      entry_type: 'weight',
      date: iso,
      weight: Math.round(w * 10) / 10,
      weight_value: Math.round(w * 10) / 10,
      weight_unit: 'lb',
      logged_at: iso + 'T08:00:00Z',
      saved_at: iso + 'T08:00:05Z'
    });
  }
  return out;
}

// Goals — 1000 lb club is the headline; squat 315 obvious next; cut to 185
const KILO_GOALS = [
  { id: 'g_total', type: 'total_lb',    label: '1000 lb Club',  target: 1000, current: 0,    featured: true,  active: true, startDate: '2026-01-01' },
  { id: 'g_squat', type: 'lift',        label: 'Squat 315',     target: 315,  current: 245,  lift: 'squat',   featured: false, active: true },
  { id: 'g_dl',    type: 'lift',        label: 'Deadlift 365',  target: 365,  current: 315,  lift: 'deadlift', featured: false, active: true },
  { id: 'g_cut',   type: 'body_weight', label: 'Cut to 185',    target: 185,  current: 191.2, direction: 'cut', featured: false, active: true, targetDate: '2026-07-01' },
];

window.KILO_SPLIT = KILO_SPLIT;
window.KILO_EXERCISES = KILO_EXERCISES;
window.KILO_PT = KILO_PT;
window.KILO_GOALS = KILO_GOALS;
window.KILO_SESSIONS = buildSessions();
window.KILO_WEIGHTS = buildWeightLog();
window.KILO_TODAY = '2026-05-05';
window.KILO_VERSION = '0.1.0';
window.dayOfWeek = function(iso) {
  const d = new Date(iso + 'T12:00:00');
  return ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][d.getDay()];
};

// Compute total for goal current value (most-recent 1RM estimates)
(function computeTotal() {
  const big3 = ['squat', 'db_bench', 'deadlift']; // db_bench stands in for bench in this split
  let total = 0;
  for (const id of big3) {
    const sess = KILO_SESSIONS.find(s => s.exercises.find(x => x.exerciseId === id));
    if (!sess) continue;
    const e = sess.exercises.find(x => x.exerciseId === id);
    if (!e || e.raw === '-') continue;
    const adj = window.adjusted1RM(window.parseKiloInput(e.raw));
    if (adj) total += adj.adjusted;
  }
  KILO_GOALS[0].current = Math.round(total);
})();

// Minimum correction flow helpers (Phase 5, Task 1)
window.deleteWeightEntry = function(id) {
  const STORAGE_KEY = 'kilo_weight_entries';
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const filtered = stored.filter(e => e.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    window.KILO_WEIGHTS = window.KILO_WEIGHTS.filter(e => e.id !== id);
    return true;
  } catch (e) {
    console.error('Delete weight failed', e);
    return false;
  }
};

window.updateWeightEntry = function(id, weightValue) {
  const STORAGE_KEY = 'kilo_weight_entries';
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const entry = stored.find(e => e.id === id);
    if (entry) {
      entry.weight_value = weightValue;
      entry.weight = weightValue; // legacy compatibility
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
      const gEntry = window.KILO_WEIGHTS.find(e => e.id === id);
      if (gEntry) {
        gEntry.weight_value = weightValue;
        gEntry.weight = weightValue;
      }
      return true;
    }
    return false;
  } catch (e) {
    console.error('Update weight failed', e);
    return false;
  }
};

window.deleteWorkoutSession = function(id) {
  const STORAGE_KEY = 'kilo_workout_sessions';
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const filtered = stored.filter(e => e.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    window.KILO_SESSIONS = window.KILO_SESSIONS.filter(e => e.id !== id);
    return true;
  } catch (e) {
    console.error('Delete workout failed', e);
    return false;
  }
};

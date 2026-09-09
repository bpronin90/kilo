// data.jsx — synthetic seed data for the retired browser prototype
// These fictional values keep the archived UI usable without retaining personal exports.

const KILO_SPLIT = {
  monday: { label: 'Push', sub: 'Chest · Shoulders' }, tuesday: { label: 'Squat', sub: 'Legs' },
  wednesday: { label: 'Pull', sub: 'Back · Bis' }, thursday: { label: 'Push Upper', sub: 'Incline · Accessories' },
  friday: { label: 'Deadlift', sub: 'Posterior · Legs' },
};
const RAW_EXERCISES = [
  { id: 'mon_bike', day: 'monday', name: 'Bike', cat: 'warmup', po: false, target: '5 min', history: ['5','6','5'] },
  { id: 'db_bench', day: 'monday', name: 'DB Bench Press', cat: 'primary_compound', po: true, target: '3×6–8', history: ['40 8,8,8','42.5 7,7,6','45 6,6,6'] },
  { id: 'cable_fly', day: 'monday', name: 'Cable Fly', cat: 'accessory', po: false, target: '2×10–12', history: ['20 12,12','22.5 10,10','22.5 12,10'] },
  { id: 'lateral', day: 'monday', name: 'Lateral Raise', cat: 'accessory', po: false, target: '2×12', history: ['8 12,12','9 12,12','10 10,10'] },
  { id: 'inout', day: 'monday', name: 'In-and-outs', cat: 'core', po: false, target: '2×10', history: ['10,10','12,10','12,12'] },
  { id: 'tue_bike', day: 'tuesday', name: 'Bike', cat: 'warmup', po: false, target: '5 min', history: ['5','5','6'] },
  { id: 'squat', day: 'tuesday', name: 'Squat', cat: 'primary_compound', po: true, target: '3×6–8', history: ['60 8,8,8','65 7,7,6','70 6,6,6'] },
  { id: 'sl_ext', day: 'tuesday', name: 'Leg Extension', cat: 'accessory', po: true, target: '2×10–12', history: ['20 12,12','25 10,10','25 12,10'] },
  { id: 'leg_press', day: 'tuesday', name: 'Leg Press', cat: 'secondary_compound', po: true, target: '2×10–12', history: ['80 12,12','90 10,10','90 12,12'] },
  { id: 'plank', day: 'tuesday', name: 'Plank', cat: 'core', po: false, target: '2×30–45s', history: ['30,30','35,30','40,35'] },
  { id: 'wed_bike', day: 'wednesday', name: 'Bike', cat: 'warmup', po: false, target: '5 min', history: ['5','6','5'] },
  { id: 'iso_row', day: 'wednesday', name: 'Machine Row', cat: 'primary_compound', po: true, target: '3×6–8', history: ['45 8,8,8','50 7,7,7','55 6,6,6'] },
  { id: 'lat_pd', day: 'wednesday', name: 'Lat Pulldown', cat: 'secondary_compound', po: true, target: '2×10–12', history: ['45 12,12','50 10,10','50 12,10'] },
  { id: 'face_pull', day: 'wednesday', name: 'Face Pulls', cat: 'accessory', po: false, target: '2×12–15', history: ['15 15,15','17.5 12,12','17.5 15,12'] },
  { id: 'deadbug', day: 'wednesday', name: 'Dead bugs', cat: 'core', po: false, target: '2×8', history: ['8,8','10,8','10,10'] },
  { id: 'thu_bike', day: 'thursday', name: 'Bike', cat: 'warmup', po: false, target: '5 min', history: ['5','5','6'] },
  { id: 'incline_db', day: 'thursday', name: 'Incline DB Press', cat: 'primary_compound', po: true, target: '3×8–10', history: ['30 10,10,10','32.5 9,9,8','35 8,8,8'] },
  { id: 'pec_deck', day: 'thursday', name: 'Pec Deck', cat: 'accessory', po: true, target: '2×10–12', history: ['35 12,12','40 10,10','40 12,10'] },
  { id: 'hs_press', day: 'thursday', name: 'Shoulder Press', cat: 'secondary_compound', po: false, target: '2×8–10', history: ['25 10,10','30 8,8','30 10,8'] },
  { id: 'cable_row', day: 'thursday', name: 'Cable Row', cat: 'secondary_compound', po: true, target: '2×10–12', history: ['40 12,12','45 10,10','45 12,10'] },
  { id: 'fri_bike', day: 'friday', name: 'Bike', cat: 'warmup', po: false, target: '5 min', history: ['5','6','5'] },
  { id: 'deadlift', day: 'friday', name: 'Deadlift', cat: 'primary_compound', po: true, target: '3×4–6', history: ['80 6,6,6','85 5,5,5','90 4,4,4'] },
  { id: 'rdl', day: 'friday', name: 'RDL', cat: 'secondary_compound', po: true, target: '2×8–10', history: ['50 10,10','55 8,8','55 10,8'] },
  { id: 'sl_rdl', day: 'friday', name: 'Single-Leg RDL', cat: 'accessory', po: false, target: '2×8', history: ['8,8','10,8','10,10'] },
  { id: 'pallof', day: 'friday', name: 'Pallof Press', cat: 'core', po: true, target: '2×10', history: ['15 10,10','17.5 10,10','17.5 12,10'] },
];
function parseRepRange(target) { const m = (target || '').match(/(\d+)[×x](\d+)(?:[–-](\d+))?/); return m ? { sets: +m[1], repMin: +m[2], repMax: +(m[3] || m[2]) } : { sets: 0, repMin: 0, repMax: 0 }; }
const KILO_EXERCISES = RAW_EXERCISES.map(e => ({ ...e, ...parseRepRange(e.target), isWarmup: e.cat === 'warmup' || e.cat === 'core' }));
const KILO_PT = [{ id: 'serratus', name: 'Serratus Punches' }, { id: 'wall_slides', name: 'Floor Wall Slides' }, { id: 'sleeper', name: 'Sleeper Stretch' }, { id: 'cross_body', name: 'Cross-body Stretch' }, { id: 'pull_apart', name: 'Band Pull-aparts' }];
function buildSessions() {
  const today = new Date('2026-05-05T12:00:00'); const dayMap = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  return ['monday','tuesday','wednesday','thursday','friday'].flatMap(day => { const exes = RAW_EXERCISES.filter(e => e.day === day && e.history && e.cat !== 'warmup'); return Array.from({ length: Math.max(...exes.map(e => e.history.length)) }, (_, i) => { const back = ((today.getDay() - dayMap.indexOf(day) + 7) % 7 || 7) + i * 7; const d = new Date(today); d.setDate(d.getDate() - back); const iso = d.toISOString().slice(0, 10); return { id: `synthetic_${iso}_${day}`, entry_type: 'workout', date: iso, saved_at: `${iso}T23:00:00Z`, day, duration: 45 + i, exercises: exes.map(e => ({ exerciseId: e.id, raw: e.history[e.history.length - 1 - i] || '-' })) }; }); }).sort((a, b) => b.date.localeCompare(a.date));
}
function buildWeightLog() { const today = new Date('2026-05-05T12:00:00'); return Array.from({ length: 14 }, (_, i) => { const d = new Date(today); d.setDate(d.getDate() - (13 - i)); const iso = d.toISOString().slice(0, 10); const w = 150 + i * 0.1; return { id: `synthetic_weight_${iso}`, entry_type: 'weight', date: iso, weight: w, weight_value: w, weight_unit: 'lb', logged_at: `${iso}T08:00:00Z`, saved_at: `${iso}T08:00:05Z` }; }); }
const KILO_GOALS = [{ id: 'g_total', type: 'total_lb', label: '500 lb Club', target: 500, current: 0, featured: true, active: true, startDate: '2026-01-01' }, { id: 'g_squat', type: 'lift', label: 'Squat 100', target: 100, current: 70, lift: 'squat', featured: false, active: true }, { id: 'g_dl', type: 'lift', label: 'Deadlift 125', target: 125, current: 90, lift: 'deadlift', featured: false, active: true }, { id: 'g_cut', type: 'body_weight', label: 'Reach 150', target: 150, current: 151.3, direction: 'cut', featured: false, active: true, targetDate: '2026-07-01' }];
window.KILO_SPLIT = KILO_SPLIT; window.KILO_EXERCISES = KILO_EXERCISES; window.KILO_PT = KILO_PT; window.KILO_GOALS = KILO_GOALS; window.KILO_SESSIONS = buildSessions(); window.KILO_WEIGHTS = buildWeightLog(); window.KILO_TODAY = '2026-05-05'; window.KILO_VERSION = '0.1.0';
window.dayOfWeek = iso => ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][new Date(`${iso}T12:00:00`).getDay()];
(function computeTotal() { const ids = ['squat', 'db_bench', 'deadlift']; let total = 0; for (const id of ids) { const sess = window.KILO_SESSIONS.find(s => s.exercises.some(x => x.exerciseId === id)); const e = sess && sess.exercises.find(x => x.exerciseId === id); const row = e && window.parseWorkoutRow(e.raw); let best = 0; if (row && row.ok) for (const s of row.sets) best = Math.max(best, window.epleyPR(s.weight_value, s.rep_count) || 0); total += best; } KILO_GOALS[0].current = Math.round(total); })();
window.deleteWeightEntry = function(id) { try { const key = 'kilo_weight_entries'; const stored = JSON.parse(localStorage.getItem(key) || '[]').filter(e => e.id !== id); localStorage.setItem(key, JSON.stringify(stored)); window.KILO_WEIGHTS = window.KILO_WEIGHTS.filter(e => e.id !== id); return true; } catch { return false; } };
window.updateWeightEntry = function(id, weightValue) { try { const key = 'kilo_weight_entries'; const stored = JSON.parse(localStorage.getItem(key) || '[]'); const entry = stored.find(x => x.id === id); if (!entry) return false; entry.weight = entry.weight_value = weightValue; localStorage.setItem(key, JSON.stringify(stored)); const e = window.KILO_WEIGHTS.find(x => x.id === id); if (e) e.weight = e.weight_value = weightValue; return true; } catch { return false; } };
window.deleteWorkoutSession = function(id) { try { const key = 'kilo_workout_sessions'; const stored = JSON.parse(localStorage.getItem(key) || '[]').filter(e => e.id !== id); localStorage.setItem(key, JSON.stringify(stored)); window.KILO_SESSIONS = window.KILO_SESSIONS.filter(e => e.id !== id); return true; } catch { return false; } };

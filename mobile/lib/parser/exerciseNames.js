const _EXERCISE_ALIASES = new Map([
  ['DB Bench Press',           ['db bench', 'dumbbell bench press', 'dumbbell bench', 'db bench press']],
  ['Bench Press',              ['bb bench press', 'barbell bench press', 'barbell bench']],
  ['Incline DB Press',         ['incline dumbbell press', 'incline db', 'incline press', 'incline db bench', 'incline bench']],
  ['Squat',                    ['back squat', 'barbell squat', 'bb squat', 'low bar squat', 'high bar squat', 'low-bar squat', 'high-bar squat']],
  ['Deadlift',                 ['deadlifts', 'dl', 'conventional deadlift', 'barbell deadlift', 'bb deadlift', 'conv deadlift', 'conv. deadlift']],
  ['RDL',                      ['romanian deadlift', 'romanian dl', 'rdls']],
  ['Hammer Strength Iso Row',  ['hs iso row', 'iso row', 'hs row']],
  ['Lat Pulldown',             ['lat pd', 'lat pulldowns', 'pulldowns']],
]);

function _canonicalizeName(name) {
  const lower = name.toLowerCase().trim();
  for (const [canonical, aliases] of _EXERCISE_ALIASES) {
    if (canonical.toLowerCase() === lower) return canonical;
    if (aliases.includes(lower)) return canonical;
  }
  return name;
}

export function normalizeExerciseKey(name) {
  if (!name) return '';
  return _canonicalizeName(name).trim().replace(/\s+/g, ' ').toLowerCase();
}

export { _canonicalizeName };

// R4 (#1603) fixture overlays: start from the shared scenarios and change only
// the storage keys the Bodyweight states need. Production keys and record
// shapes only (kilo_weight_entries, kilo_weight_goal, kilo_user_profile,
// kilo_workout_notes). The shared fixtures.cjs is not edited.
const parse = (s, key) => JSON.parse(s[key]);
const byDate = (entries) => [...entries].sort((a, b) => (a.date < b.date ? -1 : 1));

// Metric display: the profile's unit_system is what the unit preference reads.
function metric(storage, { J }) {
  return { ...storage, kilo_user_profile: J({ unit_system: 'metric' }) };
}

// Latest weigh-in a given number of lb above the previous one, one day apart
// (>= 1.5 lb is a notable pace flag, >= 2.3 lb a spike).
function paceJump(delta) {
  return (storage, { J }) => {
    const sorted = byDate(parse(storage, 'kilo_weight_entries'));
    const last = sorted[sorted.length - 1];
    const prev = sorted[sorted.length - 2];
    const next = sorted.map((e) => (e === last ? { ...e, weight_value: Math.round((prev.weight_value + delta) * 10) / 10 } : e));
    return { ...storage, kilo_weight_entries: J(next) };
  };
}
const spike = paceJump(2.6);
const notable = paceJump(1.8);

// Every weigh-in of the last 14 days at one value: both averages and the
// latest-vs-previous change read exactly zero.
function zeroChange(storage, { J, dateAgo }) {
  const cutoff = dateAgo(14);
  const next = parse(storage, 'kilo_weight_entries').map((e) => (e.date >= cutoff ? { ...e, weight_value: 188 } : e));
  return { ...storage, kilo_weight_entries: J(next) };
}

// A bulking goal (target above the current weight): the falling weights move
// away from it, so the goal-aware change reads negative.
function bulking(storage, { J, dateAgo, isoAgo }) {
  return { ...storage, kilo_weight_goal: J({ target_weight: 198, target_date: dateAgo(-70), start_weight: 185, saved_at: isoAgo(40) }) };
}

// A maintain goal: target within a pound of the current weight.
function maintain(storage, { J, dateAgo, isoAgo }) {
  return { ...storage, kilo_weight_goal: J({ target_weight: 188, target_date: dateAgo(-70), start_weight: 188, saved_at: isoAgo(40) }) };
}

// Two weigh-ins on the same date and none on any other: one date is not a chart.
function oneDate(storage, { J, dateAgo }) {
  const date = dateAgo(0);
  const entries = [
    { id: 'w-a', weight_value: 187.8, date, logged_at: `${date}T07:30:00.000Z`, note: '' },
    { id: 'w-b', weight_value: 188.2, date, logged_at: `${date}T18:00:00.000Z`, note: 'Evening' },
  ];
  return { ...storage, kilo_weight_entries: J(entries), kilo_weight_goal: null };
}

// A first long-history account: 400 daily weigh-ins, to prove every one plots.
function longHistory(storage, { J, dateAgo }) {
  const out = [];
  for (let d = 399; d >= 0; d -= 1) {
    const date = dateAgo(d);
    out.push({ id: `lh-${d}`, weight_value: Math.round((205 - (399 - d) * 0.045 + Math.sin(d * 0.9) * 0.7) * 10) / 10, date, logged_at: `${date}T07:30:00.000Z`, note: '' });
  }
  return { ...storage, kilo_weight_entries: J(out) };
}

module.exports = { metric, spike, notable, zeroChange, bulking, maintain, oneDate, longHistory };

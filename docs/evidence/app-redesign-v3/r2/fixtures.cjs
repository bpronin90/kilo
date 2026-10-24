// R2 (#1601) fixture overlays on the shared scenarios (shared fixtures.cjs is
// frozen). Production storage keys and record shapes only.
const shared = require('../fixtures.cjs');

// Two archived goals so the Goal history disclosure renders: one met (ended
// under target) and one missed (ended above target).
function withGoalHistory(storage, { J, dateAgo, isoAgo }) {
  return {
    ...storage,
    kilo_archived_weight_goals: J([
      { id: 'ag_r2_met', target_weight: 195, target_date: dateAgo(120), start_weight: 205, completed_weight: 194.6, archived_at: isoAgo(118) },
      { id: 'ag_r2_missed', target_weight: 190, target_date: dateAgo(75), start_weight: 196, completed_weight: 192.2, archived_at: isoAgo(70) },
    ]),
  };
}

module.exports = { withGoalHistory, shared };

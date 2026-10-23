// R1 (#1600) fixture overlays. Example of the downstream overlay pattern: start
// from a shared scenario and add/replace storage keys without editing the
// shared fixtures.cjs.
const shared = require('../fixtures.cjs');

// Empty account with a running rest timer: the pill must clear the docked bar
// even when there is no content to scroll.
function timerOnEmpty(storage, { now, J }) {
  const startedAtMs = now - 30000;
  return {
    ...storage,
    kilo_rest_timer: J({ version: 1, timerId: 'rt_r1', startedAtMs, durationSec: 180, endsAtMs: startedAtMs + 180000, exerciseLabel: null, notificationId: null, notificationScheduled: false }),
  };
}

module.exports = { timerOnEmpty, shared };

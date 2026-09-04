// Side-effect layer for the rest timer (#577): the only place besides
// reminderScheduler.js that talks to expo-notifications. Reuses
// reminderScheduler.js's existing scheduleRequests/cancelReminders/
// requestReminderPermission/remindersSupported instead of duplicating that
// call path — the rest timer is its own notification "kind"
// (REST_TIMER_KIND), so cancellation never touches weigh-in/workout
// reminders and vice versa.

import * as Storage from '../storage/entries';
import {
  REST_TIMER_KIND,
  cancelReminders,
  scheduleRequests,
  requestReminderPermission,
  remindersSupported,
} from './reminderScheduler';
import { startTimerRecord, normalizeRestTimerRecord, isElapsed, elapsedRecently } from './restTimer';

export { remindersSupported, requestReminderPermission };

function buildNotificationRequest(record) {
  return [{
    content: {
      title: 'Rest over',
      body: record.exerciseLabel ? `Back to ${record.exerciseLabel}.` : 'Time to get back to it.',
      data: { kind: REST_TIMER_KIND, timerId: record.timerId },
    },
    // Wall-clock date trigger (not relative seconds) so backgrounding or an
    // app kill never resets it — it is anchored to the same endsAtMs the
    // in-app countdown uses.
    trigger: { type: 'date', date: new Date(record.endsAtMs) },
  }];
}

// Serialized start/replace/cancel (#577): every mutating call awaits the
// previous one, so a late-resolving cancel from a replaced timer can never
// race ahead of the newer start it was replaced by.
let queue = Promise.resolve();
function serialize(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

// Starts a new timer, invalidating any prior one by generation: persists the
// new record BEFORE scheduling (so a crash mid-schedule still leaves durable
// intent), cancels any existing rest-timer notification, then schedules the
// new one only if the record just persisted is still the current one — a
// caller that raced a cancel/replace in the meantime is silently dropped.
export async function startRestTimer({ durationSec, exerciseLabel = null }) {
  return serialize(async () => {
    const record = startTimerRecord({ durationSec, exerciseLabel });
    await Storage.saveRestTimerState(record);
    if (!remindersSupported()) return record;
    await cancelReminders(REST_TIMER_KIND);
    const granted = await requestReminderPermission();
    if (!granted) return record;
    const current = await Storage.loadRestTimerState();
    if (!current || current.timerId !== record.timerId) return record; // superseded while awaiting permission
    await scheduleRequests(buildNotificationRequest(record));
    // #950 review (P2): only NOW — after permission was actually granted and
    // the schedule call actually ran — is a background alert genuinely
    // available for this timer. Persist that truth with the record so
    // RestTimerBanner's "Background alert unavailable" warning reflects
    // reality (permission denied, not-askable, or a rejected schedule call)
    // rather than merely "this platform generally supports notifications."
    const scheduled = { ...record, notificationScheduled: true };
    await Storage.saveRestTimerState(scheduled);
    return scheduled;
  });
}

// Cancels the current timer (if any): clears persisted state and any
// scheduled rest-timer notification.
export async function cancelRestTimer() {
  return serialize(async () => {
    await Storage.saveRestTimerState(null);
    if (remindersSupported()) await cancelReminders(REST_TIMER_KIND);
  });
}

// Reconciliation pass (#577): called once from App.js on cold start and on
// every background/inactive → active transition. Reads persisted state
// fresh, decides elapsed vs. still-running, and returns the record the UI
// should reflect (or null). Never replays an in-app banner for something
// that elapsed while the process was away — the OS notification already
// owned that; only a foreground-suppressed completion (elapsed while active,
// under 2x its own duration ago) gets an in-app "done" surface.
export async function reconcileRestTimer({ wasActiveWhenElapsed = false } = {}) {
  return serialize(async () => {
    const raw = await Storage.loadRestTimerState();
    const record = normalizeRestTimerRecord(raw);
    if (!record) {
      if (raw) await Storage.saveRestTimerState(null); // clear an invalid/stale record
      return { record: null, justElapsed: false };
    }
    if (!isElapsed(record)) return { record, justElapsed: false };
    // Elapsed. Clear persisted state either way (a matching stale native
    // schedule, if any, is cleaned up by cancelReminders below) — but only
    // report justElapsed (surface an in-app banner) when it elapsed
    // recently AND the caller says it was suppressed-while-active; a cold
    // start finding an already-long-elapsed record never replays anything.
    await Storage.saveRestTimerState(null);
    if (remindersSupported()) await cancelReminders(REST_TIMER_KIND);
    return { record, justElapsed: wasActiveWhenElapsed && elapsedRecently(record) };
  });
}

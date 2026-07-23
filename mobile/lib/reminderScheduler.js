// Side-effect layer for the optional local reminders (issue #440). This is the
// only module that talks to expo-notifications. It is imported lazily via
// require() inside each function so that merely shipping the dependency dark
// (both toggles off, nothing calling these functions at startup) never touches
// the native module or changes app behavior.
//
// Local scheduling only: no push tokens, no server, no Supabase.

import { Platform } from 'react-native';
import * as Storage from '../storage/entries';
import { parseWorkoutNote } from './parser';
import {
  REMINDER_KIND,
  buildWeighInNotificationRequests,
  buildWorkoutNotificationRequests,
  inferWorkoutWeekdays,
  resolveWorkoutWeekdays,
  selectReminderIdsToCancel,
} from './reminders';

const ANDROID_CHANNEL_ID = 'kilo-reminders';

function getNotificationsModule() {
  // Lazy require keeps expo-notifications out of the app's startup import
  // graph; it is only loaded when a reminder toggle is actually used.
  // eslint-disable-next-line global-require
  return require('expo-notifications');
}

// Local notification scheduling is not supported on the web build; callers
// use this to degrade gracefully (toggle reverts with a message, no crash).
export function remindersSupported() {
  return Platform.OS !== 'web';
}

let prepared = false;
async function prepareNotifications(Notifications) {
  if (prepared) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'Reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  prepared = true;
}

// Ask for the OS notification permission. Called only when a reminder toggle
// is first enabled — never at startup. Returns true when granted.
export async function requestReminderPermission() {
  if (!remindersSupported()) return false;
  const Notifications = getNotificationsModule();
  const existing = await Notifications.getPermissionsAsync();
  if (existing?.granted) return true;
  if (existing?.canAskAgain === false) return false;
  const asked = await Notifications.requestPermissionsAsync();
  return !!asked?.granted;
}

// Cancel every scheduled notification belonging to one reminder kind.
export async function cancelReminders(kind) {
  if (!remindersSupported()) return;
  const Notifications = getNotificationsModule();
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const ids = selectReminderIdsToCancel(scheduled, kind);
  await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id)));
}

async function scheduleRequests(requests) {
  if (requests.length === 0) return;
  const Notifications = getNotificationsModule();
  await prepareNotifications(Notifications);
  for (const request of requests) {
    const trigger = Platform.OS === 'android'
      ? { ...request.trigger, channelId: ANDROID_CHANNEL_ID }
      : request.trigger;
    // Sequential on purpose: at most 8 requests (7 weekdays + 1 daily), and
    // some platforms misbehave with concurrent schedule calls.
    // eslint-disable-next-line no-await-in-loop
    await Notifications.scheduleNotificationAsync({ content: request.content, trigger });
  }
}

// Reconcile the daily weigh-in reminder with its persisted settings:
// always cancel the existing schedule, then reschedule only when enabled.
export async function applyWeighInReminder(settings) {
  if (!remindersSupported()) return;
  await cancelReminders(REMINDER_KIND.WEIGH_IN);
  await scheduleRequests(buildWeighInNotificationRequests(settings));
}

// Reconcile the workout-day nudge. `weekdays` is the already-resolved weekday
// list (inferred from the active routine note, or the user-selected fallback).
export async function applyWorkoutReminder(settings, weekdays) {
  if (!remindersSupported()) return;
  await cancelReminders(REMINDER_KIND.WORKOUT);
  await scheduleRequests(buildWorkoutNotificationRequests(settings, weekdays));
}

// Read the active routine and reschedule the workout reminder when its
// inferred weekdays changed (issue #590). This is the single reconciliation
// entry point, safe to call from several places without double-scheduling:
// an always-mounted subscriber on the workout-note change broadcast (so it
// fires for routine edits/switches made from any screen, not only while
// Settings is mounted), once at app startup (so a stale native schedule from
// before the last app close/restart still gets corrected), and
// ReminderSettingsCard's own display refresh. A module-level cache, keyed on
// both the enabled flag and the inferred weekdays, dedupes repeated calls so
// only the first caller to observe a real change actually reschedules;
// later calls with the same key are no-ops. Never touches OS permission —
// only applyWorkoutReminder's existing cancel-then-reschedule.
let lastReconciledKey = null;

// Concurrency guard: the always-on subscriber (workoutNoteHooks.js) and a
// mounted ReminderSettingsCard's own display refresh can both react to the
// same notifyWorkoutNotes() broadcast and call reconcileWorkoutReminder()
// around the same time. Since lastReconciledKey is only committed after
// applyWorkoutReminder resolves (so a failure doesn't poison the cache —
// see below), two concurrent callers that both read the old key before
// either finishes would otherwise both run applyWorkoutReminder for the
// same resolved key, racing duplicate cancel/reschedule calls against each
// other. inFlightKey/inFlightPromise track a single in-progress apply so a
// second caller for the *same* key awaits the first caller's promise
// instead of starting its own. Cleared in `finally` regardless of outcome,
// so a rejection still allows the next call — concurrent or not — to
// re-attempt rather than leaving the guard permanently stuck.
let inFlightKey = null;
let inFlightPromise = null;

export function __resetWorkoutReminderReconciliationForTests() {
  lastReconciledKey = null;
  inFlightKey = null;
  inFlightPromise = null;
}

export async function reconcileWorkoutReminder() {
  const [workout, notes, currentId] = await Promise.all([
    Storage.loadWorkoutReminder(),
    Storage.loadWorkoutNotes(),
    Storage.loadCurrentWorkoutId(),
  ]);
  const activeNote = (Array.isArray(notes) ? notes : []).find(
    (n) => n.id === currentId || n.isCurrent === true
  );
  const { sections } = activeNote?.raw_text ? parseWorkoutNote(activeNote.raw_text) : { sections: [] };
  const inferredWeekdays = inferWorkoutWeekdays(sections);

  const key = `${workout.enabled ? '1' : '0'}:${inferredWeekdays.join(',')}`;
  if (key !== lastReconciledKey) {
    if (inFlightKey === key) {
      // Another concurrent call is already applying this exact resolved
      // state — coalesce onto it rather than racing a duplicate
      // cancel/reschedule. Everything from this check through the `else`
      // branch's assignment below runs synchronously (no await in between),
      // so this read can never race the write.
      await inFlightPromise;
    } else {
      // Always go through applyWorkoutReminder, even when disabled: it
      // cancels any existing workout notification unconditionally and only
      // rebuilds a schedule when enabled (buildWorkoutNotificationRequests
      // returns [] for a disabled reminder). Reconciling straight to
      // "disabled" without this left a stale native notification from a
      // previous enabled state uncancelled — e.g. at app startup, before
      // any explicit user toggle.
      const resolved = resolveWorkoutWeekdays(inferredWeekdays, workout.fallbackWeekdays);
      inFlightKey = key;
      inFlightPromise = applyWorkoutReminder(workout, resolved)
        .then(() => {
          // Only cache the key once applyWorkoutReminder actually succeeded.
          // Caching it beforehand meant one transient cancel/schedule
          // failure would permanently poison every later identical call for
          // the rest of the process — the dedup cache would believe that
          // state was already applied and skip retrying it forever.
          lastReconciledKey = key;
        })
        .finally(() => {
          if (inFlightKey === key) {
            inFlightKey = null;
            inFlightPromise = null;
          }
        });
      await inFlightPromise;
    }
  }
  return { workout, inferredWeekdays };
}

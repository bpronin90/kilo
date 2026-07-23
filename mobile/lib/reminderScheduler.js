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

// Install the foreground notification handler on app startup. This handler
// runs when a notification arrives while the app is in the foreground, and should
// be installed once during app initialization, independent of whether reminders
// are scheduled or permissions are granted. The handler always displays the banner
// and list, but does not play sound or set badge.
export async function installForegroundHandler() {
  if (!remindersSupported()) return;
  const Notifications = getNotificationsModule();
  await prepareNotifications(Notifications);
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

async function readActiveRoutine() {
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
  return { workout, inferredWeekdays };
}

// One reconciliation pass: read persisted state fresh, and only touch the
// native schedule when the resolved key changed since the last successful
// apply.
async function reconcileOnce() {
  const { workout, inferredWeekdays } = await readActiveRoutine();
  const key = `${workout.enabled ? '1' : '0'}:${inferredWeekdays.join(',')}`;
  if (key !== lastReconciledKey) {
    // Always go through applyWorkoutReminder, even when disabled: it cancels
    // any existing workout notification unconditionally and only rebuilds a
    // schedule when enabled (buildWorkoutNotificationRequests returns [] for
    // a disabled reminder). Reconciling straight to "disabled" without this
    // left a stale native notification from a previous enabled state
    // uncancelled — e.g. at app startup, before any explicit user toggle.
    const resolved = resolveWorkoutWeekdays(inferredWeekdays, workout.fallbackWeekdays);
    await applyWorkoutReminder(workout, resolved);
    // Only cache the key once applyWorkoutReminder actually succeeded.
    // Caching it beforehand meant one transient cancel/schedule failure
    // would permanently poison every later identical call for the rest of
    // the process — the dedup cache would believe that state was already
    // applied and skip retrying it forever.
    lastReconciledKey = key;
  }
  return { workout, inferredWeekdays };
}

// Serialized reconciliation queue (issue #590 review). The always-on
// subscriber (workoutNoteHooks.js), the App-startup call, and a mounted
// ReminderSettingsCard's own display refresh can all call
// reconcileWorkoutReminder() around the same time. A per-key in-flight guard
// (an earlier version of this fix) only coalesced callers that happened to
// resolve to the *same* key; two callers for *different* keys — e.g. the
// routine changes again while the first apply is still cancelling/
// rescheduling — could still run applyWorkoutReminder concurrently, and
// nothing then guaranteed the newer one settled last: a slower older apply
// could resolve after a faster newer one and leave the native schedule (and
// lastReconciledKey) on stale state.
//
// This replaces that guard with a single serialized queue: at most one
// reconcileOnce() ever runs at a time (`runningPromise`), and at most one
// more is coalesced to run immediately after it (`pendingPromise`). Every
// additional caller that arrives while something is already queued just
// awaits that same pending run rather than adding a third slot. Crucially,
// the queued run does not carry over any state captured at its own call
// time — it re-reads persisted state fresh from readActiveRoutine() only
// once its turn actually arrives, at which point it is, by construction,
// the newest read possible. Combined with reconcileOnce() never starting a
// second apply while one is in flight, an older apply can never resolve
// last and clobber a newer one.
let runningPromise = null;
let pendingPromise = null;

export function __resetWorkoutReminderReconciliationForTests() {
  lastReconciledKey = null;
  runningPromise = null;
  pendingPromise = null;
}

export function reconcileWorkoutReminder() {
  if (runningPromise) {
    if (!pendingPromise) {
      // `current` captures the in-flight promise by value here, not a live
      // reference to the `runningPromise` binding, so this chain still
      // fires correctly for the right run even after `runningPromise` is
      // later reassigned. `.catch(() => {})` swallows a failed in-flight
      // run so the queued run behind it still starts — a failed apply must
      // never strand whatever was coalesced behind it.
      const current = runningPromise;
      pendingPromise = current.catch(() => {}).then(() => {
        const next = reconcileOnce();
        runningPromise = next;
        pendingPromise = null;
        // Detached cleanup: `.finally()` returns a new promise that would
        // otherwise be an unobserved rejection when `next` fails, since
        // nothing else consumes it (the function already returns `next`
        // itself below). The trailing `.catch(() => {})` sinks that
        // specific derived promise only — it does not affect `next`, which
        // callers still see reject normally.
        next.finally(() => {
          if (runningPromise === next) runningPromise = null;
        }).catch(() => {});
        return next;
      });
    }
    return pendingPromise;
  }
  const current = reconcileOnce();
  runningPromise = current;
  current.finally(() => {
    if (runningPromise === current) runningPromise = null;
  }).catch(() => {});
  return current;
}

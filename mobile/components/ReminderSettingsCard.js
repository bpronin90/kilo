import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Card } from './UI';
import { switchColors, useTheme, useThemedStyles } from '../theme/ThemeContext';
import * as Storage from '../storage/entries';
// Imported directly from the hook module (not the `hooks/useEntries` barrel)
// so this card's display refresh subscribes to the same add/update/remove/
// selectCurrent broadcast every `useWorkoutNotes()` screen already relies on,
// without depending on that barrel's public hook contract or its mocks.
import { workoutNotesListeners } from '../hooks/entries/workoutNoteHooks';
import {
  WEEKDAYS,
  DEFAULT_WEIGH_IN_REMINDER,
  DEFAULT_WORKOUT_REMINDER,
  resolveWorkoutWeekdays,
  formatReminderTime,
} from '../lib/reminders';
import {
  remindersSupported,
  requestReminderPermission,
  applyWeighInReminder,
  applyWorkoutReminder,
  reconcileWorkoutReminder,
} from '../lib/reminderScheduler';
import { TYPOGRAPHY, useKuaTypography } from '../theme/typography';
import { GEOMETRY } from '../theme/spacing';

const WEEKDAY_NAMES = { 1: 'Sun', 2: 'Mon', 3: 'Tue', 4: 'Wed', 5: 'Thu', 6: 'Fri', 7: 'Sat' };

const PERMISSION_MESSAGE = 'Notifications are blocked. Allow notifications for Kilo in system settings, then try again.';
const UNSUPPORTED_MESSAGE = 'Reminders need the mobile app; they are not available on web.';
const SCHEDULE_ERROR_MESSAGE = 'Could not schedule the reminder. Please try again.';
// #1455: append the failing step and native error code so a device report
// identifies the cause instead of a bare "try again".
function scheduleFailureMessage(e) {
  const detail = e?.message ? ` (${String(e.message).slice(0, 160)})` : '';
  return `${SCHEDULE_ERROR_MESSAGE}${detail}`;
}
// A storage-write rejection is a different boundary from an OS scheduling
// failure (#1486): the setting did not persist, so the control reverts to the
// last durable value instead of showing an unsaved draft as if it were saved.
const SAVE_ERROR_MESSAGE = 'Could not save the reminder setting. Your last saved setting was kept. Please try again.';
const LOAD_ERROR_MESSAGE = 'Could not load your saved reminder settings, so changes are disabled. Reopen Settings to try again.';
const WORKOUT_DAYS_REQUIRED_MESSAGE = 'Pick at least one workout day before enabling the nudge.';

// Reminders settings card (issue #440): two independent opt-in local
// reminders, both default OFF, persisted locally like the other feature
// toggles. The OS notification permission is requested only when a toggle is
// first enabled; on denial the toggle stays off and an inline message explains
// why. Disabling a toggle cancels its scheduled notifications.
//
// Reconciling the schedule against the active routine (#590) is NOT this
// card's job: an always-on subscriber in hooks/entries/workoutNoteHooks.js
// (plus one call at app startup in App.js) already keeps the workout
// reminder aligned regardless of whether this card is mounted — a card-local
// listener only existed while Settings happened to be rendered. This card
// still displays inferredWeekdays, so it calls the same
// reconcileWorkoutReminder() for its own read of the active routine; its
// dedup cache means that call is a no-op for scheduling whenever the
// always-on subscriber already reconciled the same change.
// Per-reminder write channel (#1486). `latest` is the optimistic value the
// controls show (and the base for the next edit, so rapid edits compose);
// `durable` is the last value whose storage write succeeded; `rev` identifies
// the newest request so a stale failure/completion cannot overwrite newer
// state; `chain` serializes writes so they land in request order;
// `scheduleError` is the unresolved scheduling failure (if any) of the DURABLE
// config, so it survives a newer request that never became durable.
function createChannel(initial) {
  return { latest: initial, durable: initial, rev: 0, chain: Promise.resolve(), scheduleError: null, hydrated: false, nativeChain: Promise.resolve() };
}

// One ordering mechanism for every native schedule operation a channel issues
// (initial reconcile, display-refresh reconcile, explicit applies, revert-off,
// durable retries): each runs after its predecessor settles, so the last
// native operation always reflects the latest saved config and a late
// schedule from an earlier operation can never outlive a later cancel. A
// predecessor's failure does not block the queue; each caller still gets its
// own operation's outcome.
function runNative(ch, fn) {
  const run = ch.nativeChain.catch(() => {}).then(fn);
  ch.nativeChain = run;
  return run;
}

export function ReminderSettingsCard() {
  const styles = useThemedStyles(createStyles);
  const typography = useKuaTypography();
  const { colors } = useTheme();
  const [weighIn, setWeighIn] = useState({ ...DEFAULT_WEIGH_IN_REMINDER });
  const [workout, setWorkout] = useState({ ...DEFAULT_WORKOUT_REMINDER, fallbackWeekdays: [] });
  const [inferredWeekdays, setInferredWeekdays] = useState([]);
  const [weighInError, setWeighInError] = useState(null);
  const [workoutError, setWorkoutError] = useState(null);
  const [showWeighInPicker, setShowWeighInPicker] = useState(false);
  const [showWorkoutPicker, setShowWorkoutPicker] = useState(false);

  const weighInChannel = useRef(null);
  if (!weighInChannel.current) weighInChannel.current = createChannel({ ...DEFAULT_WEIGH_IN_REMINDER });
  const workoutChannel = useRef(null);
  if (!workoutChannel.current) {
    workoutChannel.current = createChannel({ ...DEFAULT_WORKOUT_REMINDER, fallbackWeekdays: [] });
  }
  const inferredRef = useRef([]);
  // Inferred days are known only after a successful reconcile (or note
  // broadcast). While unknown, [] is not an input: applying with it would
  // cancel the schedule and build nothing, and look like success.
  const inferredKnownRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Each channel hydrates independently, and reading the durable config is a
  // separate step from the initial schedule reconcile. A channel's edits are
  // ignored until its stored settings have loaded (`hydrated`): defaults are
  // not a durable baseline, so a failed early edit must never roll back to
  // them. A read failure leaves that channel read-only; a reconcile failure
  // after a successful read keeps the durable value editable and surfaces the
  // scheduling error instead.
  useEffect(() => {
    let cancelled = false;
    const install = (ch, value, setState) => {
      ch.latest = value;
      ch.durable = value;
      ch.hydrated = true;
      setState(value);
    };
    Storage.loadWeighInReminder().then((value) => {
      if (!cancelled) install(weighInChannel.current, value, setWeighIn);
    }).catch(() => {
      if (!cancelled) setWeighInError(LOAD_ERROR_MESSAGE);
    });
    Storage.loadWorkoutReminder().then((value) => {
      if (!cancelled) install(workoutChannel.current, value, setWorkout);
      else return null;
      return runNative(workoutChannel.current, () => reconcileWorkoutReminder()).then((reconciled) => {
        if (cancelled) return;
        inferredRef.current = reconciled.inferredWeekdays;
        inferredKnownRef.current = true;
        setInferredWeekdays(reconciled.inferredWeekdays);
      }, (e) => {
        const ch = workoutChannel.current;
        ch.scheduleError = scheduleFailureMessage(e);
        if (!cancelled && ch.rev === 0) setWorkoutError(ch.scheduleError);
      });
    }, () => {
      if (!cancelled) setWorkoutError(LOAD_ERROR_MESSAGE);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the displayed inferred weekdays live while this card stays mounted
  // (#590): re-reads after the same notifyWorkoutNotes() broadcast the
  // always-on reconciliation subscriber responds to. Scheduling itself
  // already happened (or was a no-op) via that subscriber; this only updates
  // what the card shows.
  useEffect(() => {
    const onNoteChange = () => {
      runNative(workoutChannel.current, () => reconcileWorkoutReminder())
        .then((reconciled) => {
          inferredRef.current = reconciled.inferredWeekdays;
          inferredKnownRef.current = true;
          setInferredWeekdays(reconciled.inferredWeekdays);
        })
        .catch(() => {});
    };
    workoutNotesListeners.push(onNoteChange);
    return () => {
      const index = workoutNotesListeners.indexOf(onNoteChange);
      if (index !== -1) workoutNotesListeners.splice(index, 1);
    };
  }, []);

  const ensurePermission = useCallback(async (setError) => {
    if (!remindersSupported()) {
      setError(UNSUPPORTED_MESSAGE);
      return false;
    }
    let granted = false;
    try {
      granted = await requestReminderPermission();
    } catch {
      granted = false;
    }
    if (!granted) setError(PERMISSION_MESSAGE);
    return granted;
  }, []);

  // Optimistically show `build(latest)`, then write it. Storage rejection
  // restores the last durable value (only if this is still the newest request);
  // a scheduling failure after a successful write keeps the saved setting and
  // reports the schedule problem separately. `revertOnScheduleFailure` turns an
  // enable back off (its own durable write) when it could not be scheduled.
  const commit = useCallback((channelRef, setState, setError, apply, save, build, revertOnScheduleFailure = false) => {
    const ch = channelRef.current;
    if (!ch.hydrated) return Promise.resolve();
    const next = build(ch.latest);
    let rev = ++ch.rev;
    ch.latest = next;
    setState(next);
    setError(null);
    const restore = () => {
      ch.latest = ch.durable;
      if (mountedRef.current) setState(ch.durable);
    };
    // Only the newest request reports, and its message is derived from the
    // final state: the save outcome plus the schedule outcome of the config
    // that is durable now (never an apply result a newer request discarded).
    const finish = (message) => {
      if (ch.rev !== rev || !mountedRef.current) return;
      const parts = [message, ch.scheduleError].filter(Boolean);
      setError(parts.length ? parts.join(' ') : null);
    };
    const applyDurable = async (value) => {
      try {
        await runNative(ch, () => apply(value));
        ch.scheduleError = null;
        return true;
      } catch (e) {
        ch.scheduleError = scheduleFailureMessage(e);
        return false;
      }
    };
    const step = async () => {
      try {
        await save(next);
      } catch {
        // A newer queued request owns the draft and will save/apply itself.
        if (ch.rev !== rev) return;
        restore();
        // The durable config stays effective; a failed or discarded apply
        // for it may have left no schedule, so reconcile it again.
        if (ch.scheduleError) await applyDurable(ch.durable);
        finish(SAVE_ERROR_MESSAGE);
        return;
      }
      ch.durable = next;
      if (await applyDurable(next) || !revertOnScheduleFailure || ch.rev !== rev) {
        finish(null);
        return;
      }
      const failure = ch.scheduleError;
      const off = { ...next, enabled: false };
      rev = ++ch.rev;
      const offRev = rev;
      ch.latest = off;
      if (mountedRef.current) setState(off);
      try {
        await save(off);
      } catch {
        if (ch.rev === offRev) {
          restore();
          // The enabled value is the durable one and has no schedule: say both.
          finish('The reminder is still on because turning it off could not be saved.');
        }
        return;
      }
      ch.durable = off;
      // Cancelling the failed enable: a failure here is its own schedule error.
      await applyDurable(off);
      finish(ch.scheduleError ? null : failure);
    };
    const run = ch.chain.then(step);
    ch.chain = run.catch(() => {});
    return run;
  }, []);

  const commitWeighIn = useCallback((build, revert) => commit(
    weighInChannel, setWeighIn, setWeighInError, applyWeighInReminder, Storage.saveWeighInReminder, build, revert,
  ), [commit]);

  // An explicit edit is always applied directly (reconcile dedupes on
  // enabled+days only, so it can skip an edited time or fallback days). While
  // the inferred days are unknown, reconcile is used solely to learn them; if
  // that fails the days stay unknown and nothing is applied with a guessed [].
  const applyWorkout = useCallback(async (value) => {
    // Cancelling needs no inference; never gate it on a reconcile that can fail.
    if (!value.enabled) {
      await applyWorkoutReminder(value, []);
      return;
    }
    if (!inferredKnownRef.current) {
      const reconciled = await reconcileWorkoutReminder();
      inferredRef.current = reconciled.inferredWeekdays;
      inferredKnownRef.current = true;
      if (mountedRef.current) setInferredWeekdays(reconciled.inferredWeekdays);
    }
    await applyWorkoutReminder(value, resolveWorkoutWeekdays(inferredRef.current, value.fallbackWeekdays));
  }, []);

  const commitWorkout = useCallback((build, revert) => commit(
    workoutChannel, setWorkout, setWorkoutError,
    applyWorkout,
    Storage.saveWorkoutReminder, build, revert,
  ), [commit, applyWorkout]);

  const handleWeighInToggle = useCallback(async (enabled) => {
    if (!weighInChannel.current.hydrated) return;
    setWeighInError(null);
    if (enabled && !(await ensurePermission(setWeighInError))) return;
    await commitWeighIn((base) => ({ ...base, enabled }), enabled);
  }, [ensurePermission, commitWeighIn]);

  const handleWorkoutToggle = useCallback(async (enabled) => {
    if (!workoutChannel.current.hydrated) return;
    setWorkoutError(null);
    const days = workoutChannel.current.latest.fallbackWeekdays;
    if (enabled && !inferredKnownRef.current) {
      // Try to learn the routine's days before judging "no days".
      try {
        const reconciled = await runNative(workoutChannel.current, () => reconcileWorkoutReminder());
        inferredRef.current = reconciled.inferredWeekdays;
        inferredKnownRef.current = true;
        setInferredWeekdays(reconciled.inferredWeekdays);
      } catch {
        // Still unknown: let the commit path reconcile and report.
      }
    }
    if (enabled && inferredKnownRef.current && resolveWorkoutWeekdays(inferredRef.current, days).length === 0) {
      setWorkoutError(WORKOUT_DAYS_REQUIRED_MESSAGE);
      return;
    }
    if (enabled && !(await ensurePermission(setWorkoutError))) return;
    await commitWorkout((base) => ({ ...base, enabled }), enabled);
  }, [ensurePermission, commitWorkout]);

  const handleWeighInTime = useCallback((event, date) => {
    setShowWeighInPicker(false);
    if (event?.type === 'dismissed' || !date) return;
    commitWeighIn((base) => ({ ...base, hour: date.getHours(), minute: date.getMinutes() })).catch(() => {});
  }, [commitWeighIn]);

  const handleWorkoutTime = useCallback((event, date) => {
    setShowWorkoutPicker(false);
    if (event?.type === 'dismissed' || !date) return;
    commitWorkout((base) => ({ ...base, hour: date.getHours(), minute: date.getMinutes() })).catch(() => {});
  }, [commitWorkout]);

  const handleToggleWeekday = useCallback((value) => {
    commitWorkout((base) => {
      const selected = base.fallbackWeekdays.includes(value)
        ? base.fallbackWeekdays.filter((day) => day !== value)
        : [...base.fallbackWeekdays, value].sort((x, y) => x - y);
      return { ...base, fallbackWeekdays: selected };
    }).catch(() => {});
  }, [commitWorkout]);

  const usesInference = inferredWeekdays.length > 0;
  const workoutHelp = usesInference
    ? `On your routine’s training days: ${inferredWeekdays.map((day) => WEEKDAY_NAMES[day]).join(', ')}`
    : 'Your routine doesn’t name weekdays, so pick the days to be nudged';

  const pickerValue = (hour, minute) => {
    const d = new Date();
    d.setHours(hour, minute, 0, 0);
    return d;
  };

  return (
    <Card>
      {/* Each reminder is one group: the label/switch row and its sub-elements
          (inline error, weekday grid, time row) sit a uniform 8dp apart via the
          group's own gap, and the two groups are separated by Card's 10dp child
          gap. No row carries a bottom margin, so an enabled reminder's time row
          is spaced identically to the workout weekday grid (#1018). */}
      <View style={styles.reminderGroup}>
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Daily weigh-in reminder</Text>
            <Text style={styles.settingHelp}>A daily notification at your chosen time to log your weight</Text>
          </View>
          <Switch
            {...switchColors(colors)}
            value={!!weighIn.enabled}
            onValueChange={handleWeighInToggle}
            accessibilityLabel="Daily weigh-in reminder"
            accessibilityRole="switch"
          />
        </View>
        {weighInError ? <Text style={styles.errorText}>{weighInError}</Text> : null}
        {weighIn.enabled ? (
          <View style={styles.subRow}>
            <Text style={styles.subRowLabel}>Reminder time</Text>
            <Pressable
              style={styles.timeButton}
              onPress={() => setShowWeighInPicker(true)}
              accessibilityRole="button"
              accessibilityLabel="Weigh-in reminder time"
            >
              <Text style={[styles.timeButtonText, typography['label-lg']]}>{formatReminderTime(weighIn.hour, weighIn.minute)}</Text>
            </Pressable>
            {showWeighInPicker && Platform.OS !== 'web' && (
              <DateTimePicker
                themeVariant={colors.scheme}
                value={pickerValue(weighIn.hour, weighIn.minute)}
                mode="time"
                display="default"
                onChange={handleWeighInTime}
              />
            )}
          </View>
        ) : null}
      </View>

      <View style={styles.reminderGroup}>
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Workout day nudge</Text>
            <Text style={styles.settingHelp}>{workoutHelp}</Text>
          </View>
          <Switch
            {...switchColors(colors)}
            value={!!workout.enabled}
            onValueChange={handleWorkoutToggle}
            accessibilityLabel="Workout day nudge"
            accessibilityRole="switch"
          />
        </View>
        {workoutError ? <Text style={styles.errorText}>{workoutError}</Text> : null}
        {!usesInference && (
          <View style={styles.weekdayRow}>
            {WEEKDAYS.map((day) => {
              const selected = workout.fallbackWeekdays.includes(day.value);
              return (
                <Pressable
                  key={day.value}
                  style={styles.weekdayTarget}
                  onPress={() => handleToggleWeekday(day.value)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={`Nudge on ${day.label}`}
                >
                  <View style={[styles.weekdayChip, selected && styles.weekdayChipSelected]}>
                    <Text style={[styles.weekdayChipText, selected && styles.weekdayChipTextSelected]} accessible={false}>
                      {day.short}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
        {workout.enabled ? (
          <View style={styles.subRow}>
            <Text style={styles.subRowLabel}>Nudge time</Text>
            <Pressable
              style={styles.timeButton}
              onPress={() => setShowWorkoutPicker(true)}
              accessibilityRole="button"
              accessibilityLabel="Workout nudge time"
            >
              <Text style={[styles.timeButtonText, typography['label-lg']]}>{formatReminderTime(workout.hour, workout.minute)}</Text>
            </Pressable>
            {showWorkoutPicker && Platform.OS !== 'web' && (
              <DateTimePicker
                themeVariant={colors.scheme}
                value={pickerValue(workout.hour, workout.minute)}
                mode="time"
                display="default"
                onChange={handleWorkoutTime}
              />
            )}
          </View>
        ) : null}
      </View>
    </Card>
  );
}

// Under the production KUA gate (`kua` supplied) the reminder labels, help copy,
// inline errors, time buttons, and weekday chips resolve through the selected
// court palette; outside the gate (`kua` null — isolated reminder-card tests)
// they keep the legacy palette. The native <Switch> tint is intentionally left
// on the legacy accent via `switchColors(colors)`, matching the migrated
// SettingsScreen — an OS control keeps its own light/dark boundary.
export const createStyles = (colors, kua = null) => StyleSheet.create({
  // One reminder = one group. The group's gap sets a uniform distance between
  // the label/switch row and every sub-element under it (#1018); the two groups
  // are held apart by Card's own 10dp child gap.
  reminderGroup: {
    gap: 8,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  settingInfo: {
    flex: 1,
    gap: 2,
  },
  settingLabel: {
    fontSize: TYPOGRAPHY['body-lg'].fontSize,
    fontWeight: '700',
    color: kua ? kua.onSurface : colors.text,
  },
  settingHelp: {
    fontSize: TYPOGRAPHY['label-md'].fontSize,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  errorText: {
    fontSize: TYPOGRAPHY['label-md'].fontSize,
    color: kua ? kua.errorText : colors.error,
  },
  subRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  subRowLabel: {
    fontSize: TYPOGRAPHY['label-sm'].fontSize,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  timeButton: {
    backgroundColor: kua ? kua.surfaceSection : colors.inputBackground,
    borderRadius: GEOMETRY['radius-xl'],
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
    paddingVertical: 10,
    paddingHorizontal: 16,
    minHeight: 44,
    justifyContent: 'center',
  },
  timeButtonText: {
    color: kua ? kua.onSurface : colors.text,
  },
  weekdayRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 4,
  },
  // The press target is a real box, not a hitSlop — React Native clips a slop
  // at the parent's bounds, so it cannot claim height this one-circle-tall row
  // never had. Seven 44dp-wide targets need 308dp and the card's inner width
  // is 252dp at 320dp, so the row is a four-column grid that wraps 4 + 3
  // instead of shrinking below the minimum: every target is a quarter of the
  // inner width (63dp at 320dp, 77dp at 375dp) by 44dp tall, at every
  // supported viewport. Targets tile the grid, so they touch without
  // overlapping and no press between two circles is lost (#904).
  weekdayTarget: {
    width: '25%',
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekdayChip: {
    width: 36,
    height: 36,
    borderRadius: GEOMETRY['radius-full'],
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: kua ? kua.surfaceSection : colors.inputBackground,
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
  },
  weekdayChipSelected: {
    backgroundColor: kua ? kua.primaryContainer : colors.chipBackground,
    borderColor: kua ? kua.primaryOnContainer : colors.chipText,
  },
  weekdayChipText: {
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
    fontWeight: '700',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  weekdayChipTextSelected: {
    color: kua ? kua.primaryOnContainer : colors.chipText,
  },
});

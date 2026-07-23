import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Card } from './UI';
import { Colors } from '../theme/colors';
import * as Storage from '../storage/entries';
// Imported directly from the hook module (not the `hooks/useEntries` barrel)
// so this card's reconciliation subscribes to the same add/update/remove/
// selectCurrent broadcast every `useWorkoutNotes()` screen already relies on,
// without depending on that barrel's public hook contract or its mocks.
import { workoutNotesListeners } from '../hooks/entries/workoutNoteHooks';
import { parseWorkoutNote } from '../lib/parser';
import {
  WEEKDAYS,
  DEFAULT_WEIGH_IN_REMINDER,
  DEFAULT_WORKOUT_REMINDER,
  inferWorkoutWeekdays,
  resolveWorkoutWeekdays,
  formatReminderTime,
} from '../lib/reminders';
import {
  remindersSupported,
  requestReminderPermission,
  applyWeighInReminder,
  applyWorkoutReminder,
} from '../lib/reminderScheduler';

const WEEKDAY_NAMES = { 1: 'Sun', 2: 'Mon', 3: 'Tue', 4: 'Wed', 5: 'Thu', 6: 'Fri', 7: 'Sat' };

const PERMISSION_MESSAGE = 'Notifications are blocked. Allow notifications for Kilo in system settings, then try again.';
const UNSUPPORTED_MESSAGE = 'Reminders need the mobile app; they are not available on web.';
const SCHEDULE_ERROR_MESSAGE = 'Could not schedule the reminder. Please try again.';
const WORKOUT_DAYS_REQUIRED_MESSAGE = 'Pick at least one workout day before enabling the nudge.';

// Reminders settings card (issue #440): two independent opt-in local
// reminders, both default OFF, persisted locally like the other feature
// toggles. The OS notification permission is requested only when a toggle is
// first enabled; on denial the toggle stays off and an inline message explains
// why. Disabling a toggle cancels its scheduled notifications.
async function loadInferredWeekdays() {
  const [notes, currentId] = await Promise.all([
    Storage.loadWorkoutNotes(),
    Storage.loadCurrentWorkoutId(),
  ]);
  const activeNote = (Array.isArray(notes) ? notes : []).find(
    (n) => n.id === currentId || n.isCurrent === true
  );
  const { sections } = activeNote?.raw_text ? parseWorkoutNote(activeNote.raw_text) : { sections: [] };
  return inferWorkoutWeekdays(sections);
}

export function ReminderSettingsCard() {
  const [weighIn, setWeighIn] = useState({ ...DEFAULT_WEIGH_IN_REMINDER });
  const [workout, setWorkout] = useState({ ...DEFAULT_WORKOUT_REMINDER, fallbackWeekdays: [] });
  const [inferredWeekdays, setInferredWeekdays] = useState([]);
  const [weighInError, setWeighInError] = useState(null);
  const [workoutError, setWorkoutError] = useState(null);
  const [showWeighInPicker, setShowWeighInPicker] = useState(false);
  const [showWorkoutPicker, setShowWorkoutPicker] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [weighInSettings, workoutSettings, inferred] = await Promise.all([
        Storage.loadWeighInReminder(),
        Storage.loadWorkoutReminder(),
        loadInferredWeekdays(),
      ]);
      if (cancelled) return;
      setWeighIn(weighInSettings);
      setWorkout(workoutSettings);
      setInferredWeekdays(inferred);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Reconcile the enabled workout reminder when the active routine changes
  // while this card stays mounted (#590): the routine's text is edited, or a
  // different routine becomes current. Both paths call `notifyWorkoutNotes()`
  // (add/update/remove/selectCurrent), so re-reading here after that broadcast
  // catches both. Reschedules silently — no permission prompt — and only when
  // the inferred weekdays actually changed; explicit fallback weekdays are
  // untouched here, they are already persisted through handleToggleWeekday.
  const workoutRef = useRef(workout);
  useEffect(() => {
    workoutRef.current = workout;
  }, [workout]);

  const inferredRef = useRef(inferredWeekdays);
  useEffect(() => {
    inferredRef.current = inferredWeekdays;
  }, [inferredWeekdays]);

  useEffect(() => {
    const onNoteChange = () => {
      loadInferredWeekdays()
        .then((inferred) => {
          const prevKey = inferredRef.current.join(',');
          const nextKey = inferred.join(',');
          setInferredWeekdays(inferred);
          if (nextKey === prevKey) return;
          const current = workoutRef.current;
          if (!current.enabled) return;
          const resolved = resolveWorkoutWeekdays(inferred, current.fallbackWeekdays);
          applyWorkoutReminder(current, resolved).catch(() => {});
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

  const persistWeighIn = useCallback(async (next) => {
    setWeighIn(next);
    await Storage.saveWeighInReminder(next);
    try {
      await applyWeighInReminder(next);
      return true;
    } catch {
      return false;
    }
  }, []);

  const persistWorkout = useCallback(async (next, inferred) => {
    setWorkout(next);
    await Storage.saveWorkoutReminder(next);
    try {
      await applyWorkoutReminder(next, resolveWorkoutWeekdays(inferred, next.fallbackWeekdays));
      return true;
    } catch {
      return false;
    }
  }, []);

  const handleWeighInToggle = useCallback(async (enabled) => {
    setWeighInError(null);
    if (enabled && !(await ensurePermission(setWeighInError))) return;
    const ok = await persistWeighIn({ ...weighIn, enabled });
    if (!ok && enabled) {
      setWeighInError(SCHEDULE_ERROR_MESSAGE);
      await persistWeighIn({ ...weighIn, enabled: false });
    }
  }, [weighIn, ensurePermission, persistWeighIn]);

  const handleWorkoutToggle = useCallback(async (enabled) => {
    setWorkoutError(null);
    if (enabled && resolveWorkoutWeekdays(inferredWeekdays, workout.fallbackWeekdays).length === 0) {
      setWorkoutError(WORKOUT_DAYS_REQUIRED_MESSAGE);
      return;
    }
    if (enabled && !(await ensurePermission(setWorkoutError))) return;
    const ok = await persistWorkout({ ...workout, enabled }, inferredWeekdays);
    if (!ok && enabled) {
      setWorkoutError(SCHEDULE_ERROR_MESSAGE);
      await persistWorkout({ ...workout, enabled: false }, inferredWeekdays);
    }
  }, [workout, inferredWeekdays, ensurePermission, persistWorkout]);

  const handleWeighInTime = useCallback((event, date) => {
    setShowWeighInPicker(false);
    if (event?.type === 'dismissed' || !date) return;
    persistWeighIn({ ...weighIn, hour: date.getHours(), minute: date.getMinutes() }).catch(() => {});
  }, [weighIn, persistWeighIn]);

  const handleWorkoutTime = useCallback((event, date) => {
    setShowWorkoutPicker(false);
    if (event?.type === 'dismissed' || !date) return;
    persistWorkout({ ...workout, hour: date.getHours(), minute: date.getMinutes() }, inferredWeekdays).catch(() => {});
  }, [workout, inferredWeekdays, persistWorkout]);

  const handleToggleWeekday = useCallback((value) => {
    const selected = workout.fallbackWeekdays.includes(value)
      ? workout.fallbackWeekdays.filter((day) => day !== value)
      : [...workout.fallbackWeekdays, value].sort((a, b) => a - b);
    persistWorkout({ ...workout, fallbackWeekdays: selected }, inferredWeekdays).catch(() => {});
  }, [workout, inferredWeekdays, persistWorkout]);

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
      <View style={styles.settingRow}>
        <View style={styles.settingInfo}>
          <Text style={styles.settingLabel}>Daily weigh-in reminder</Text>
          <Text style={styles.settingHelp}>A daily notification at your chosen time to log your weight</Text>
        </View>
        <Switch
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
            <Text style={styles.timeButtonText}>{formatReminderTime(weighIn.hour, weighIn.minute)}</Text>
          </Pressable>
          {showWeighInPicker && Platform.OS !== 'web' && (
            <DateTimePicker
              value={pickerValue(weighIn.hour, weighIn.minute)}
              mode="time"
              display="default"
              onChange={handleWeighInTime}
            />
          )}
        </View>
      ) : null}

      <View style={[styles.settingRow, { marginBottom: 0 }]}>
        <View style={styles.settingInfo}>
          <Text style={styles.settingLabel}>Workout day nudge</Text>
          <Text style={styles.settingHelp}>{workoutHelp}</Text>
        </View>
        <Switch
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
                style={[styles.weekdayChip, selected && styles.weekdayChipSelected]}
                onPress={() => handleToggleWeekday(day.value)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`Nudge on ${day.label}`}
              >
                <Text style={[styles.weekdayChipText, selected && styles.weekdayChipTextSelected]} accessible={false}>
                  {day.short}
                </Text>
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
            <Text style={styles.timeButtonText}>{formatReminderTime(workout.hour, workout.minute)}</Text>
          </Pressable>
          {showWorkoutPicker && Platform.OS !== 'web' && (
            <DateTimePicker
              value={pickerValue(workout.hour, workout.minute)}
              mode="time"
              display="default"
              onChange={handleWorkoutTime}
            />
          )}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  settingInfo: {
    flex: 1,
    gap: 2,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
  },
  settingHelp: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  errorText: {
    fontSize: 12,
    color: Colors.error,
  },
  subRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  subRowLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: Colors.textMuted,
  },
  timeButton: {
    backgroundColor: Colors.inputBackground,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  timeButtonText: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.text,
  },
  weekdayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  weekdayChip: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.inputBackground,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  weekdayChipSelected: {
    backgroundColor: Colors.chipBackground,
    borderColor: Colors.chipText,
  },
  weekdayChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textMuted,
  },
  weekdayChipTextSelected: {
    color: Colors.chipText,
  },
});

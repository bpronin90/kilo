import { useState, useEffect, useMemo, useRef } from 'react';
import { Alert } from '../lib/platformAlert';
import { convertWeightDraft, retainedDraftLb, parseStrictWeightText } from '../lib/parser/weightEntry';

// One month out, local calendar day (not UTC) so the pre-filled date never
// lands a day off near midnight.
function defaultTargetDate() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function useWeightGoalForm(goal, saveGoal, clearGoal, archiveGoal, isActive = true, registerBackConsumer, unit = 'lb', canonicalGoal = null) {
  const [goalEditing, setGoalEditing] = useState(false);
  const [goalTargetWeight, setGoalTargetWeight] = useState('');
  const [goalTargetDate, setGoalTargetDate] = useState(defaultTargetDate);
  const [goalStartWeight, setGoalStartWeight] = useState('');
  const [goalError, setGoalError] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Unit-change bridge (#1476): form text is typed in the selected unit. While
  // editing, a preference change converts the dirty text once (never discards
  // it). Provenance refs keep the original lb value for text we seeded or
  // converted, so repeated switches and unchanged drafts do not drift.
  const prevUnitRef = useRef(unit);
  const targetProvRef = useRef(null);
  const startProvRef = useRef(null);
  // Provenance lives only as long as the exact draft it describes (#1476): any
  // user keystroke drops it, and so does the form closing, saving, clearing or
  // archiving, so a later draft reusing the same text never inherits a stale lb.
  const dropProvenance = () => {
    targetProvRef.current = null;
    startProvRef.current = null;
  };
  const onTargetChange = (text) => {
    targetProvRef.current = null;
    setGoalTargetWeight(text);
  };
  const onStartChange = (text) => {
    startProvRef.current = null;
    setGoalStartWeight(text);
  };
  useEffect(() => {
    if (!goalEditing && goal) dropProvenance();
  }, [goalEditing, goal]);
  useEffect(() => {
    const from = prevUnitRef.current;
    if (from === unit) return;
    prevUnitRef.current = unit;
    // With no saved goal the form is shown directly (goalEditing stays false).
    if (!goalEditing && goal) return;
    const t = convertWeightDraft(goalTargetWeight, from, unit, targetProvRef.current);
    if (t) {
      targetProvRef.current = t;
      setGoalTargetWeight(t.text);
    }
    const s = convertWeightDraft(goalStartWeight, from, unit, startProvRef.current);
    if (s) {
      startProvRef.current = s;
      setGoalStartWeight(s.text);
    }
  }, [unit]);

  // Baseline = the values the form was last seeded or reset to. Fields that
  // still equal it are pristine and follow the persisted goal, including an
  // external replacement or deletion (sync/import, #1480); if any field differs
  // the whole draft is kept, in creation and edit mode alike. `null` forces a
  // re-seed (after save or cancel).
  const baselineRef = useRef({ t: '', d: goalTargetDate, s: '' });
  const reseed = (t, d, s) => {
    baselineRef.current = { t, d, s };
    setGoalTargetWeight(t);
    setGoalTargetDate(d);
    setGoalStartWeight(s);
  };
  useEffect(() => {
    const base = baselineRef.current;
    const pristine = base === null
      || (goalTargetWeight === base.t && goalTargetDate === base.d && goalStartWeight === base.s);
    if (!pristine) return;
    if (goal && (!goalEditing || base !== null)) {
      reseed(String(goal.target_weight), goal.target_date, goal.start_weight ? String(goal.start_weight) : '');
    } else if (!goal) {
      reseed('', defaultTargetDate(), '');
      dropProvenance();
    }
  }, [goal, goalEditing]);

  // Register with the app shell instead of BackHandler directly (#527): all tab
  // screens stay mounted under display:none, so a direct BackHandler listener here
  // would keep cancelling the goal edit even while another tab is active. Gating on
  // isActive ensures only the visible Weight tab can intercept Back while editing.
  useEffect(() => {
    if (!isActive || !goalEditing) return undefined;
    return registerBackConsumer?.(() => {
      cancelEditGoal();
      return true;
    });
  }, [isActive, goalEditing, registerBackConsumer]);

  const handleSaveGoal = async (currentWeight) => {
    setGoalError('');
    const tw = parseStrictWeightText(goalTargetWeight) ?? NaN;
    if (isNaN(tw) || tw <= 0) {
      setGoalError('Enter a valid target weight.');
      return;
    }
    const startW = currentWeight ?? (parseStrictWeightText(goalStartWeight) ?? NaN);
    if (!currentWeight && (isNaN(startW) || startW <= 0)) {
      setGoalError('Enter your current weight.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(goalTargetDate)) {
      setGoalError('Enter target date.');
      return;
    }
    const [tYear, tMonth, tDay] = goalTargetDate.split('-').map(Number);
    const parsedDate = new Date(tYear, tMonth - 1, tDay);
    if (parsedDate.getFullYear() !== tYear || parsedDate.getMonth() !== tMonth - 1 || parsedDate.getDate() !== tDay) {
      setGoalError('Enter a valid calendar date.');
      return;
    }
    try {
      // Retained lb provenance (#1476): untouched seeded/converted text saves its
      // exact lb value instead of re-rounding the display text.
      const lbOverrides = {
        target_weight: retainedDraftLb(goalTargetWeight, unit, targetProvRef.current),
        start_weight: currentWeight ? null : retainedDraftLb(goalStartWeight, unit, startProvRef.current),
      };
      await saveGoal({
        target_weight: tw,
        target_date: goalTargetDate,
        start_weight: !isNaN(startW) && startW > 0 ? startW : null,
      }, lbOverrides);
    } catch {
      // Keep the draft open so the user can retry; never imply success.
      setGoalError('Could not save your goal. Try again.');
      return;
    }
    dropProvenance();
    baselineRef.current = null;
    setGoalEditing(false);
  };

  const handleClearGoal = () => {
    Alert.alert('Clear Goal', 'Remove your weight goal?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: async () => {
        await clearGoal();
        reseed('', defaultTargetDate(), '');
        dropProvenance();
        setGoalEditing(false);
      }},
    ]);
  };

  const handleArchiveGoal = (completedWeight) => {
    Alert.alert('Archive Goal', 'Save this completed goal to history and set a new target?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Archive', style: 'default', onPress: async () => {
        try {
          await archiveGoal(completedWeight);
        } catch {
          // The goal stays on screen and the archive is safely retryable
          // (#1477); never reset the form or imply it was archived.
          Alert.alert('Archive failed', 'Could not archive your goal. Try again.');
          return;
        }
        reseed('', defaultTargetDate(), '');
        dropProvenance();
        setGoalEditing(false);
      }},
    ]);
  };

  const startEditGoal = () => {
    const lbGoal = canonicalGoal ?? null;
    targetProvRef.current = goal && lbGoal?.target_weight != null
      ? { text: String(goal.target_weight), unit, lb: lbGoal.target_weight } : null;
    startProvRef.current = goal && lbGoal?.start_weight
      ? { text: String(goal.start_weight), unit, lb: lbGoal.start_weight } : null;
    if (goal) {
      reseed(String(goal.target_weight), goal.target_date, goal.start_weight ? String(goal.start_weight) : '');
    } else {
      reseed('', defaultTargetDate(), '');
    }
    setGoalError('');
    setGoalEditing(true);
  };

  const cancelEditGoal = () => {
    targetProvRef.current = null;
    startProvRef.current = null;
    setGoalError('');
    setGoalStartWeight('');
    baselineRef.current = null;
    setGoalEditing(false);
  };

  const onDateChange = (event, selectedDate) => {
    setShowDatePicker(false);
    if (selectedDate) {
      const y = selectedDate.getFullYear();
      const m = String(selectedDate.getMonth() + 1).padStart(2, '0');
      const d = String(selectedDate.getDate()).padStart(2, '0');
      setGoalTargetDate(`${y}-${m}-${d}`);
    }
  };

  const pickerDate = useMemo(() => {
    if (goalTargetDate) {
      const [y, m, d] = goalTargetDate.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    return new Date();
  }, [goalTargetDate]);

  return {
    goalEditing,
    setGoalEditing,
    goalTargetWeight,
    setGoalTargetWeight: onTargetChange,
    goalTargetDate,
    setGoalTargetDate,
    goalStartWeight,
    setGoalStartWeight: onStartChange,
    goalError,
    setGoalError,
    showDatePicker,
    setShowDatePicker,
    handleSaveGoal,
    handleClearGoal,
    handleArchiveGoal,
    startEditGoal,
    cancelEditGoal,
    onDateChange,
    pickerDate,
  };
}

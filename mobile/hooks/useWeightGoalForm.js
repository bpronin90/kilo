import { useState, useEffect, useMemo } from 'react';
import { Alert } from 'react-native';

export function useWeightGoalForm(goal, saveGoal, clearGoal, archiveGoal, isActive = true, registerBackConsumer) {
  const [goalEditing, setGoalEditing] = useState(false);
  const [goalTargetWeight, setGoalTargetWeight] = useState('');
  const [goalTargetDate, setGoalTargetDate] = useState('');
  const [goalStartWeight, setGoalStartWeight] = useState('');
  const [goalError, setGoalError] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);

  useEffect(() => {
    if (goal && !goalEditing) {
      setGoalTargetWeight(String(goal.target_weight));
      setGoalTargetDate(goal.target_date);
      setGoalStartWeight(goal.start_weight ? String(goal.start_weight) : '');
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
    const tw = parseFloat(goalTargetWeight);
    if (isNaN(tw) || tw <= 0) {
      setGoalError('Enter a valid target weight.');
      return;
    }
    const startW = currentWeight ?? parseFloat(goalStartWeight);
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
    await saveGoal({
      target_weight: tw,
      target_date: goalTargetDate,
      start_weight: !isNaN(startW) && startW > 0 ? startW : null,
    });
    setGoalEditing(false);
  };

  const handleClearGoal = () => {
    Alert.alert('Clear Goal', 'Remove your weight goal?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: async () => {
        await clearGoal();
        setGoalTargetWeight('');
        setGoalTargetDate('');
        setGoalStartWeight('');
        setGoalEditing(false);
      }},
    ]);
  };

  const handleArchiveGoal = (completedWeight) => {
    Alert.alert('Archive Goal', 'Save this completed goal to history and set a new target?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Archive', style: 'default', onPress: async () => {
        await archiveGoal(completedWeight);
        setGoalTargetWeight('');
        setGoalTargetDate('');
        setGoalStartWeight('');
        setGoalEditing(false);
      }},
    ]);
  };

  const startEditGoal = () => {
    if (goal) {
      setGoalTargetWeight(String(goal.target_weight));
      setGoalTargetDate(goal.target_date);
      setGoalStartWeight(goal.start_weight ? String(goal.start_weight) : '');
    } else {
      const d = new Date();
      d.setMonth(d.getMonth() + 1);
      setGoalTargetDate(d.toISOString().slice(0, 10));
      setGoalStartWeight('');
    }
    setGoalError('');
    setGoalEditing(true);
  };

  const cancelEditGoal = () => {
    setGoalError('');
    setGoalStartWeight('');
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
    setGoalTargetWeight,
    goalTargetDate,
    setGoalTargetDate,
    goalStartWeight,
    setGoalStartWeight,
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

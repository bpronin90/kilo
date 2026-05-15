import { StatusBar } from 'expo-status-bar';
import React, { useMemo, useState } from 'react';
import { SafeAreaView, StyleSheet, View } from 'react-native';

import { Colors } from './theme/colors';
import { TabBar } from './components/TabBar';

import { HomeScreen } from './screens/HomeScreen';
import { LogScreen } from './screens/LogScreen';
import { WeightScreen } from './screens/WeightScreen';
import { StatsScreen } from './screens/StatsScreen';

import { useWeightEntries, useWorkoutSessions } from './hooks/useEntries';
import { parseWeightEntry, parseWorkoutEntry } from './lib/parser';
import { makeWeightEntry, makeWorkoutSession } from './lib/data';

const TABS = ['Home', 'Log', 'Weight', 'Stats'];

export default function App() {
  const [activeTab, setActiveTab] = useState('Home');

  const weightHook = useWeightEntries();
  const workoutHook = useWorkoutSessions();

  const [weightValue, setWeightValue] = useState('');
  const [weightNote, setWeightNote] = useState('');
  const [workoutTitle, setWorkoutTitle] = useState('');
  const [workoutDetail, setWorkoutDetail] = useState('');

  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');

  const handleTabPress = (tab) => {
    setSaveError('');
    setSaveSuccess('');
    setActiveTab(tab);
  };

  // Adapt persistent store entries to the shape screens expect
  const entries = useMemo(() => {
    const weightEntries = weightHook.entries.map(e => ({
      id: e.id,
      type: 'weight',
      value: String(e.weight_value),
      unit: e.weight_unit,
      note: e.note || 'No note',
      createdAt: new Date(e.logged_at).getTime(),
    }));
    const workoutEntries = workoutHook.sessions.map(s => {
      const item = s.items[0];
      let detail = '';
      if (item?.result_kind === 'sets' && item.sets?.length) {
        const totalSets = item.sets.length;
        const volume = item.sets.reduce((sum, set) => sum + (set.weight_value || 0) * set.rep_count, 0);
        detail = `${totalSets} set${totalSets !== 1 ? 's' : ''} · ${volume} lb total`;
      }
      return {
        id: s.id,
        type: 'workout',
        title: item?.exercise_name || 'Workout',
        detail,
        createdAt: new Date(s.saved_at).getTime(),
      };
    });
    return [...weightEntries, ...workoutEntries].sort((a, b) => b.createdAt - a.createdAt);
  }, [weightHook.entries, workoutHook.sessions]);

  async function saveWeight() {
    setSaveError('');
    const parsed = parseWeightEntry(weightValue);
    if (!parsed.ok) {
      setSaveError(parsed.error);
      return;
    }
    const entry = makeWeightEntry({
      weight_value: parsed.weight_value,
      logged_at: parsed.logged_at,
      note: weightNote.trim() || undefined,
    });
    await weightHook.add(entry);
    setWeightValue('');
    setWeightNote('');
    setSaveSuccess('Weight entry saved!');
    setActiveTab('Home');
  }

  async function saveWorkout() {
    setSaveError('');
    if (!workoutTitle.trim()) {
      setSaveError('Workout name is required');
      return;
    }
    if (!workoutDetail.trim()) {
      setSaveError('Session details are required');
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const parsed = parseWorkoutEntry(
      [{ exerciseName: workoutTitle.trim(), raw: workoutDetail.trim() }],
      today,
    );
    if (!parsed.ok) {
      setSaveError(parsed.error);
      return;
    }
    const session = makeWorkoutSession({ workout_date: parsed.workout_date, items: parsed.items });
    await workoutHook.add(session);
    setWorkoutTitle('');
    setWorkoutDetail('');
    setSaveSuccess('Workout session saved!');
    setActiveTab('Home');
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'Home':
        return <HomeScreen entries={entries} successMessage={saveSuccess} />;
      case 'Log':
        return (
          <LogScreen
            workoutTitle={workoutTitle}
            setWorkoutTitle={setWorkoutTitle}
            workoutDetail={workoutDetail}
            setWorkoutDetail={setWorkoutDetail}
            onSaveWorkout={saveWorkout}
            errorMessage={saveError}
          />
        );
      case 'Weight':
        return (
          <WeightScreen
            weightValue={weightValue}
            setWeightValue={setWeightValue}
            weightNote={weightNote}
            setWeightNote={setWeightNote}
            onSaveWeight={saveWeight}
            errorMessage={saveError}
          />
        );
      case 'Stats':
        return <StatsScreen entries={entries} />;
      default:
        return null;
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.container}>
        <View style={styles.content}>{renderContent()}</View>
        <TabBar
          tabs={TABS}
          activeTab={activeTab}
          onTabPress={handleTabPress}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
});

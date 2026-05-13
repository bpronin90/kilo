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
import { parseWeightEntry } from './lib/parser';
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
    const workoutEntries = workoutHook.sessions.map(s => ({
      id: s.id,
      type: 'workout',
      title: s.items[0]?.exercise_name || 'Workout',
      detail: s.items[0]?.note_text || '',
      createdAt: new Date(s.saved_at).getTime(),
    }));
    return [...weightEntries, ...workoutEntries].sort((a, b) => b.createdAt - a.createdAt);
  }, [weightHook.entries, workoutHook.sessions]);

  async function saveWeight() {
    const parsed = parseWeightEntry(weightValue);
    if (!parsed.ok) return;
    const entry = makeWeightEntry({
      weight_value: parsed.weight_value,
      logged_at: parsed.logged_at,
      note: weightNote.trim() || undefined,
    });
    await weightHook.add(entry);
    setWeightValue('');
    setWeightNote('');
    setActiveTab('Home');
  }

  async function saveWorkout() {
    if (!workoutTitle.trim()) return;
    const today = new Date().toISOString().slice(0, 10);
    const session = makeWorkoutSession({
      workout_date: today,
      items: [{
        exercise_name: workoutTitle.trim(),
        result_kind: 'note',
        note_text: workoutDetail.trim() || null,
        position: 1,
        sets: [],
      }],
    });
    await workoutHook.add(session);
    setWorkoutTitle('');
    setWorkoutDetail('');
    setActiveTab('Home');
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'Home':
        return <HomeScreen entries={entries} />;
      case 'Log':
        return (
          <LogScreen
            workoutTitle={workoutTitle}
            setWorkoutTitle={setWorkoutTitle}
            workoutDetail={workoutDetail}
            setWorkoutDetail={setWorkoutDetail}
            onSaveWorkout={saveWorkout}
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
          onTabPress={setActiveTab}
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

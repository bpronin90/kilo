import { StatusBar } from 'expo-status-bar';
import React, { useMemo, useState } from 'react';
import { SafeAreaView, StyleSheet, View } from 'react-native';

import { Colors } from './theme/colors';
import { TabBar } from './components/TabBar';

import { HomeScreen } from './screens/HomeScreen';
import { LogScreen } from './screens/LogScreen';
import { WeightScreen } from './screens/WeightScreen';
import { StatsScreen } from './screens/StatsScreen';

const TABS = ['Home', 'Log', 'Weight', 'Stats'];

function createSeedEntries() {
  const now = Date.now();
  return [
    {
      id: 'weight-seed-1',
      type: 'weight',
      value: '186.4',
      unit: 'lb',
      note: 'Morning weigh-in',
      createdAt: now - 1000 * 60 * 60 * 18,
    },
    {
      id: 'workout-seed-1',
      type: 'workout',
      title: 'Push Day',
      detail: 'Bench 3x5, incline DB 3x8, dips 3x10',
      createdAt: now - 1000 * 60 * 60 * 42,
    },
  ];
}

export default function App() {
  const [activeTab, setActiveTab] = useState('Home');
  const [entries, setEntries] = useState(createSeedEntries);
  
  // Input states
  const [weightValue, setWeightValue] = useState('');
  const [weightNote, setWeightNote] = useState('');
  const [workoutTitle, setWorkoutTitle] = useState('');
  const [workoutDetail, setWorkoutDetail] = useState('');

  const sortedEntries = useMemo(
    () => [...entries].sort((left, right) => right.createdAt - left.createdAt),
    [entries]
  );

  function saveWeight() {
    if (!weightValue.trim()) return;

    setEntries((current) => [
      {
        id: `weight-${Date.now()}`,
        type: 'weight',
        value: weightValue.trim(),
        unit: 'lb',
        note: weightNote.trim() || 'No note',
        createdAt: Date.now(),
      },
      ...current,
    ]);
    setWeightValue('');
    setWeightNote('');
    setActiveTab('Home');
  }

  function saveWorkout() {
    if (!workoutTitle.trim() || !workoutDetail.trim()) return;

    setEntries((current) => [
      {
        id: `workout-${Date.now()}`,
        type: 'workout',
        title: workoutTitle.trim(),
        detail: workoutDetail.trim(),
        createdAt: Date.now(),
      },
      ...current,
    ]);
    setWorkoutTitle('');
    setWorkoutDetail('');
    setActiveTab('Home');
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'Home':
        return <HomeScreen entries={sortedEntries} />;
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
        return <StatsScreen entries={sortedEntries} />;
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

import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useMemo, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, SafeAreaView, StyleSheet, View } from 'react-native';

import { Colors } from './theme/colors';
import { TabBar } from './components/TabBar';

import { HomeScreen, MoreScreen } from './screens/HomeScreen';
import { LogScreen } from './screens/LogScreen';
import { WeightScreen } from './screens/WeightScreen';
import { StatsScreen } from './screens/StatsScreen';

import { useWeightEntries, useWorkoutNote } from './hooks/useEntries';
import { parseWeightEntry } from './lib/parser';
import { makeWeightEntry } from './lib/data';

const TABS = ['Home', 'Log', 'Weight', 'Analytics', 'More'];

export default function App() {
  const [activeTab, setActiveTab] = useState('Home');

  const weightHook = useWeightEntries();
  const noteHook = useWorkoutNote();

  const [weightValue, setWeightValue] = useState('');
  const [weightNote, setWeightNote] = useState('');
  const [workoutNoteText, setWorkoutNoteText] = useState('');

  React.useEffect(() => {
    if (noteHook.note && !workoutNoteText) {
      setWorkoutNoteText(noteHook.note.raw_text);
    }
  }, [noteHook.note]);

  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');
  const [weightSaving, setWeightSaving] = useState(false);
  const [workoutSaving, setWorkoutSaving] = useState(false);

  const handleTabPress = useCallback((tab) => {
    Keyboard.dismiss();
    setSaveError('');
    setSaveSuccess('');
    setActiveTab(tab);
  }, []);

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
    const workoutEntries = noteHook.note
      ? [{
          id: `note_${noteHook.note.updated_at}`,
          type: 'workout',
          title: 'Workout note',
          detail: noteHook.note.raw_text?.split('\n').find(l => l.trim()) || '',
          createdAt: new Date(noteHook.note.updated_at).getTime(),
        }]
      : [];
    return [...weightEntries, ...workoutEntries].sort((a, b) => b.createdAt - a.createdAt);
  }, [weightHook.entries, noteHook.note]);

  const saveWeight = useCallback(async () => {
    if (weightSaving) return;
    Keyboard.dismiss();
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
    setWeightSaving(true);
    try {
      await weightHook.add(entry);
      setWeightValue('');
      setWeightNote('');
      setSaveSuccess('Weight entry saved!');
    } finally {
      setWeightSaving(false);
    }
  }, [weightSaving, weightValue, weightNote, weightHook]);

  const saveWorkout = useCallback(async () => {
    if (workoutSaving) return { ok: false, error: 'Save already in progress' };

    if (!workoutNoteText.trim()) {
      return { ok: false, error: 'Workout note is required' };
    }
    setWorkoutSaving(true);
    try {
      await noteHook.save(workoutNoteText.trim());
      return { ok: true };
    } catch (e) {
      return { ok: false, error: 'Failed to save workout note' };
    } finally {
      setWorkoutSaving(false);
    }
  }, [workoutSaving, workoutNoteText, noteHook]);

  const renderContent = () => {
    switch (activeTab) {
      case 'Home':
        return (
          <HomeScreen
            entries={entries}
            weightEntries={weightHook.entries}
            workoutNote={noteHook.note}
            successMessage={saveSuccess}
          />
        );
      case 'Log':
        return (
          <LogScreen
            workoutNoteText={workoutNoteText}
            setWorkoutNoteText={setWorkoutNoteText}
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
            errorMessage={saveError}
            saving={weightSaving}
          />
        );
      case 'Analytics':
        return <StatsScreen entries={entries} />;
      case 'More':
        return <MoreScreen onNavigate={handleTabPress} />;
      default:
        return null;
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'height' : undefined}
      >
        <View style={styles.content}>{renderContent()}</View>
        <TabBar
          tabs={TABS}
          activeTab={activeTab}
          onTabPress={handleTabPress}
        />
      </KeyboardAvoidingView>
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

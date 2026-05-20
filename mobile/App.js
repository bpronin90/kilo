import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useMemo, useState, useRef } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, SafeAreaView, StyleSheet, View, BackHandler, Alert } from 'react-native';

import { Colors } from './theme/colors';
import { TabBar } from './components/TabBar';

import { HomeScreen, MoreScreen } from './screens/HomeScreen';
import { LogScreen } from './screens/LogScreen';
import { WeightScreen } from './screens/WeightScreen';
import { StatsScreen } from './screens/StatsScreen';

import { useWeightEntries, useWorkoutNotes } from './hooks/useEntries';
import { parseWeightEntry } from './lib/parser';
import { makeWeightEntry } from './lib/data';
import { exportBackup, importBackup, loadFatigueMultiplier, saveFatigueMultiplier } from './storage/entries';

const TABS = ['Home', 'Log', 'Weight', 'Analytics', 'More'];

export default function App() {
  const [activeTab, setActiveTab] = useState('Home');

  const weightHook = useWeightEntries();
  const noteHook = useWorkoutNotes();

  const [weightValue, setWeightValue] = useState('');
  const [weightNote, setWeightNote] = useState('');
  const [workoutNoteText, setWorkoutNoteText] = useState('');
  const [fatigueMultiplier, setFatigueMultiplier] = useState(1.07);

  React.useEffect(() => {
    loadFatigueMultiplier().then(setFatigueMultiplier);
  }, []);

  const prevCurrentId = useRef(noteHook.currentId);
  React.useEffect(() => {
    if (noteHook.currentId !== prevCurrentId.current) {
      setWorkoutNoteText(noteHook.currentNote?.raw_text || '');
      prevCurrentId.current = noteHook.currentId;
    } else if (noteHook.currentNote && !workoutNoteText) {
      setWorkoutNoteText(noteHook.currentNote.raw_text);
    }
  }, [noteHook.currentId, noteHook.currentNote]);

  React.useEffect(() => {
    if (Platform.OS !== 'android') return;

    const backAction = () => {
      if (activeTab !== 'Home') {
        setActiveTab('Home');
        return true;
      }
      
      Alert.alert('Hold on!', 'Are you sure you want to exit?', [
        {
          text: 'Cancel',
          onPress: () => null,
          style: 'cancel',
        },
        { text: 'YES', onPress: () => BackHandler.exitApp() },
      ]);
      return true;
    };

    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      backAction,
    );

    return () => backHandler.remove();
  }, [activeTab]);

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
    const workoutEntries = noteHook.currentNote
      ? [{
          id: `note_${noteHook.currentNote.updated_at}`,
          type: 'workout',
          title: noteHook.currentNote.title || 'Workout note',
          detail: noteHook.currentNote.raw_text?.split('\n').find(l => l.trim()) || '',
          createdAt: new Date(noteHook.currentNote.updated_at).getTime(),
        }]
      : [];
    return [...weightEntries, ...workoutEntries].sort((a, b) => b.createdAt - a.createdAt);
  }, [weightHook.entries, noteHook.currentNote]);

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

  const handleExport = useCallback(async () => {
    try {
      const backup = await exportBackup();
      return { ok: true, json: JSON.stringify(backup, null, 2) };
    } catch {
      return { ok: false, error: 'Failed to export data.' };
    }
  }, []);

  const handleImport = useCallback(async (payload) => {
    const result = await importBackup(payload, 'replace');
    if (result.ok) {
      weightHook.refresh();
      noteHook.refresh();
    }
    return result;
  }, [weightHook, noteHook]);

  const saveWorkout = useCallback(async () => {
    if (workoutSaving) return { ok: false, error: 'Save already in progress' };

    if (!workoutNoteText.trim()) {
      return { ok: false, error: 'Workout note is required' };
    }
    setWorkoutSaving(true);
    try {
      if (noteHook.currentId) {
        await noteHook.update(noteHook.currentId, { raw_text: workoutNoteText.trim() });
      } else {
        const note = await noteHook.add('My Workout', workoutNoteText.trim());
        await noteHook.selectCurrent(note.id);
      }
      return { ok: true };
    } catch {
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
            weightEntries={weightHook.entries}
            workoutNote={noteHook.currentNote}
            successMessage={saveSuccess}
            onNavigate={handleTabPress}
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
      case 'Stats':
      case 'Analytics':
        return <StatsScreen entries={entries} multiplier={fatigueMultiplier} />;
      case 'More':
        return (
          <MoreScreen 
            onNavigate={handleTabPress} 
            onExport={handleExport} 
            onImport={handleImport} 
            fatigueMultiplier={fatigueMultiplier}
            onUpdateFatigueMultiplier={async (val) => {
              setFatigueMultiplier(val);
              await saveFatigueMultiplier(val);
            }}
          />
        );
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

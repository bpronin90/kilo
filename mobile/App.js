import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import React, { useCallback, useState, useRef } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, SafeAreaView, StyleSheet, View, BackHandler, Alert, StatusBar } from 'react-native';

import { Colors } from './theme/colors';
import { TabBar } from './components/TabBar';
import { ScrollContext } from './components/ScreenShell';

import { HomeScreen } from './screens/HomeScreen';
import { MoreScreen } from './screens/MoreScreen';
import { LogScreen } from './screens/LogScreen';
import { WeightScreen } from './screens/WeightScreen';
import { AnalyticsScreen } from './screens/AnalyticsScreen';

import { useWeightEntries, useWorkoutNotes } from './hooks/useEntries';
import { parseWeightEntry } from './lib/parser';
import { makeWeightEntry } from './lib/data';
import { exportBackup, importBackup, loadFatigueMultiplier, saveFatigueMultiplier, loadWorkoutCollapsed, saveWorkoutCollapsed, loadWeightDateEditEnabled, saveWeightDateEditEnabled } from './storage/entries';

const TABS = ['Home', 'Log', 'Weight', 'Analytics', 'More'];

export default function App() {
  const [activeTab, setActiveTab] = useState('Home');
  const [analyticsSection, setAnalyticsSection] = useState(null);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimeout = useRef(null);

  const handleScroll = useCallback(() => {
    setIsScrolling(true);
    if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
    scrollTimeout.current = setTimeout(() => {
      setIsScrolling(false);
    }, 150);
  }, []);

  React.useEffect(() => {
    return () => {
      if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
    };
  }, []);

  const weightHook = useWeightEntries();
  const noteHook = useWorkoutNotes();

  const [weightValue, setWeightValue] = useState('');
  const [weightNote, setWeightNote] = useState('');
  const [workoutNoteText, setWorkoutNoteText] = useState('');
  const [workoutNoteTitle, setWorkoutNoteTitle] = useState('');
  const [isWorkoutCollapsed, setIsWorkoutCollapsed] = useState(false);
  const [fatigueMultiplier, setFatigueMultiplier] = useState(1.07);
  const [weightDateEditEnabled, setWeightDateEditEnabled] = useState(false);

  React.useEffect(() => {
    loadFatigueMultiplier().then(setFatigueMultiplier);
    loadWorkoutCollapsed().then(setIsWorkoutCollapsed);
    loadWeightDateEditEnabled().then(setWeightDateEditEnabled);
  }, []);

  const toggleWorkoutCollapsed = useCallback(async () => {
    const next = !isWorkoutCollapsed;
    setIsWorkoutCollapsed(next);
    await saveWorkoutCollapsed(next);
  }, [isWorkoutCollapsed]);

  const prevCurrentId = useRef(noteHook.currentId);
  React.useEffect(() => {
    if (noteHook.currentId !== prevCurrentId.current) {
      setWorkoutNoteText(noteHook.currentNote?.raw_text || '');
      setWorkoutNoteTitle(noteHook.currentNote?.title || '');
      prevCurrentId.current = noteHook.currentId;
    } else if (noteHook.currentNote && !workoutNoteText) {
      setWorkoutNoteText(noteHook.currentNote.raw_text);
      setWorkoutNoteTitle(noteHook.currentNote.title || '');
    }
  }, [noteHook.currentId, noteHook.currentNote]);

  React.useEffect(() => {
    if (Platform.OS !== 'android') return;

    const backAction = () => {
      if (activeTab !== 'Home') {
        setActiveTab('Home');
        return true;
      }
      
      Alert.alert('Exit app?', 'Are you sure you want to exit?', [
        {
          text: 'Cancel',
          onPress: () => null,
          style: 'cancel',
        },
        { text: 'Exit', onPress: () => BackHandler.exitApp() },
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

  const handleTabPress = useCallback((tab, section = null) => {
    Keyboard.dismiss();
    setSaveError('');
    setSaveSuccess('');
    setAnalyticsSection(section);
    setActiveTab(tab);
  }, []);

  const saveWeight = useCallback(async (date) => {
    if (weightSaving) return;
    Keyboard.dismiss();
    setSaveError('');
    const parsed = parseWeightEntry(weightValue);
    if (!parsed.ok) {
      setSaveError(parsed.error);
      return;
    }
    let loggedAt = parsed.logged_at || new Date().toISOString();
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const today = new Date().toISOString().slice(0, 10);
      if (date <= today) {
        loggedAt = date + loggedAt.slice(10);
      }
    }
    const entry = makeWeightEntry({
      weight_value: parsed.weight_value,
      logged_at: loggedAt,
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
      return { ok: false, error: 'Workout notes are required' };
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
      return { ok: false, error: 'Failed to save workout notes' };
    } finally {
      setWorkoutSaving(false);
    }
  }, [workoutSaving, workoutNoteText, noteHook]);

  const renderContent = () => {
    return (
      <>
        <View style={[styles.tabContent, activeTab === 'Home' && styles.activeTabContent]}>
          <HomeScreen
            weightEntries={weightHook.entries}
            workoutNote={noteHook.currentNote}
            notes={noteHook.notes}
            successMessage={saveSuccess}
            onNavigate={handleTabPress}
          />
        </View>
        <View style={[styles.tabContent, activeTab === 'Log' && styles.activeTabContent]}>
          <LogScreen
            workoutNoteText={workoutNoteText}
            setWorkoutNoteText={setWorkoutNoteText}
            workoutNoteTitle={workoutNoteTitle}
            setWorkoutNoteTitle={setWorkoutNoteTitle}
            isCollapsed={isWorkoutCollapsed}
            toggleCollapsed={toggleWorkoutCollapsed}
            onSaveWorkout={saveWorkout}
          />
        </View>
        <View style={[styles.tabContent, activeTab === 'Weight' && styles.activeTabContent]}>
          <WeightScreen
            weightValue={weightValue}
            setWeightValue={setWeightValue}
            weightNote={weightNote}
            setWeightNote={setWeightNote}
            onSaveWeight={saveWeight}
            errorMessage={saveError}
            saving={weightSaving}
            weightDateEditEnabled={weightDateEditEnabled}
          />
        </View>
        <View style={[styles.tabContent, activeTab === 'Analytics' && styles.activeTabContent]}>
          <AnalyticsScreen multiplier={fatigueMultiplier} section={analyticsSection} />
        </View>
        <View style={[styles.tabContent, activeTab === 'More' && styles.activeTabContent]}>
          <MoreScreen
            onNavigate={handleTabPress}
            onExport={handleExport}
            onImport={handleImport}
            fatigueMultiplier={fatigueMultiplier}
            onUpdateFatigueMultiplier={async (val) => {
              setFatigueMultiplier(val);
              await saveFatigueMultiplier(val);
            }}
            weightDateEditEnabled={weightDateEditEnabled}
            onUpdateWeightDateEditEnabled={async (val) => {
              setWeightDateEditEnabled(val);
              await saveWeightDateEditEnabled(val);
            }}
          />
        </View>
      </>
    );
  };

  return (
    <ScrollContext.Provider value={{ onScroll: handleScroll }}>
      <View style={styles.appContainer}>
        <SafeAreaView style={styles.topSafeArea} />
        <ExpoStatusBar style="dark" />
        <KeyboardAvoidingView
          style={styles.container}
          behavior={Platform.OS === 'ios' ? 'height' : undefined}
        >
          <View style={styles.content}>{renderContent()}</View>
        </KeyboardAvoidingView>
        <SafeAreaView style={styles.tabBarSafeArea} pointerEvents="box-none">
          <TabBar
            tabs={TABS}
            activeTab={activeTab}
            onTabPress={handleTabPress}
            isScrolling={isScrolling}
          />
        </SafeAreaView>
      </View>
    </ScrollContext.Provider>
  );
}

const styles = StyleSheet.create({
  appContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  topSafeArea: {
    flex: 0,
    backgroundColor: Colors.background,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 30) : 0,
  },
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  tabContent: {
    display: 'none',
  },
  activeTabContent: {
    display: 'flex',
    flex: 1,
  },
  tabBarSafeArea: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
});

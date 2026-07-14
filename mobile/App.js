import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import React, { useCallback, useState, useRef } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, StyleSheet, Text, View, BackHandler, Alert, StatusBar } from 'react-native';
import * as Updates from 'expo-updates';
import { useUpdates } from 'expo-updates';

import { Colors } from './theme/colors';
import { TabBar } from './components/TabBar';
import { Button } from './components/UI';
import { ScrollContext } from './components/ScreenShell';

import { HomeScreen } from './screens/HomeScreen';
import { MoreScreen } from './screens/MoreScreen';
import { LogScreen } from './screens/LogScreen';
import { WeightScreen } from './screens/WeightScreen';
import { AnalyticsScreen } from './screens/AnalyticsScreen';

import { useWeightEntries, useWorkoutNotes, useAutoSync, reloadWeightEntries, reloadWorkoutNotes } from './hooks/useEntries';
import { useAuthSession } from './hooks/useAuthSession';
import { parseWeightEntry } from './lib/parser';
import { makeWeightEntry } from './lib/data';
import { exportBackup, importBackup, loadFatigueMultiplier, saveFatigueMultiplier, loadWorkoutCollapsed, saveWorkoutCollapsed, loadWeightDateEditEnabled, saveWeightDateEditEnabled, loadDeloadDateEditEnabled, saveDeloadDateEditEnabled } from './storage/entries';

const TABS = ['Home', 'Log', 'Weight', 'Analytics', 'More'];

// Exported for testing. Encapsulates the ok/error envelope BackupScreen expects
// so the failure path can be exercised without rendering the full App component.
// exportFn defaults to the real exportBackup; tests inject a mock.
export async function buildExportPayload(exportFn = exportBackup) {
  try {
    const backup = await exportFn();
    return { ok: true, json: JSON.stringify(backup, null, 2) };
  } catch (e) {
    console.error('[handleExport] exportBackup threw unexpectedly:', e);
    return { ok: false, error: e?.message ? `Export failed: ${e.message}` : 'Export failed.' };
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState('Home');
  const [analyticsSection, setAnalyticsSection] = useState(null);
  const scrollListeners = useRef(new Set());
  const isScrollingRef = useRef(false);
  const scrollTimeout = useRef(null);

  // Back consumer registered by the active tab. Returns true if it handled the
  // back event (e.g. popped a sub-view), false to let the shell fall back to Home.
  const backConsumerRef = useRef(null);
  const registerBackConsumer = useCallback((consumer) => {
    backConsumerRef.current = consumer;
    return () => {
      if (backConsumerRef.current === consumer) backConsumerRef.current = null;
    };
  }, []);
  // True when the active tab's sub-screen renders its own back affordance; used to
  // suppress the web "← Home" bar so two back controls do not stack.
  const [tabOwnsBack, setTabOwnsBack] = useState(false);

  const addScrollListener = useCallback((listener) => {
    scrollListeners.current.add(listener);
    return () => {
      scrollListeners.current.delete(listener);
    };
  }, []);

  const handleScroll = useCallback(() => {
    if (!isScrollingRef.current) {
      isScrollingRef.current = true;
      scrollListeners.current.forEach((listener) => listener(true));
    }
    if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
    scrollTimeout.current = setTimeout(() => {
      isScrollingRef.current = false;
      scrollListeners.current.forEach((listener) => listener(false));
    }, 150);
  }, []);

  React.useEffect(() => {
    return () => {
      if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
    };
  }, []);

  const { isUpdatePending } = useUpdates();

  const weightHook = useWeightEntries();
  const noteHook = useWorkoutNotes();
  const auth = useAuthSession();
  const {
    ownershipPrompt,
    confirmOwnershipUpload,
    startFreshOnDevice,
    dismissOwnershipPrompt,
  } = useAutoSync(auth, {
    onSyncComplete() {
      // Broadcast, not instance-local: Analytics, Log and Weight each hold their
      // own useWorkoutNotes()/useWeightEntries() state, and reloading only App's
      // instances left them rendering the pre-sync data (#459).
      reloadWeightEntries();
      reloadWorkoutNotes();
    },
  }) || {};

  // Web OAuth / password-reset callback handling. After a provider redirect or
  // a reset link, the app reloads at its web URL carrying the auth payload; this
  // exchanges it into a persisted session once on mount. Native delivers these
  // via deep links, so this is web-only and does not affect signed-out users.
  React.useEffect(() => {
    if (Platform.OS !== 'web' || !auth.configured) return;
    if (typeof window === 'undefined') return;
    const href = window.location?.href || '';
    if (!/[?#&](code|access_token|error)=/.test(href)) return;
    auth.handleAuthCallbackUrl(href).catch(() => {});
  }, [auth.configured]);

  const [weightValue, setWeightValue] = useState('');
  const [weightNote, setWeightNote] = useState('');
  const [workoutNoteText, setWorkoutNoteText] = useState('');
  const [workoutNoteTitle, setWorkoutNoteTitle] = useState('');
  const [isWorkoutCollapsed, setIsWorkoutCollapsed] = useState(false);
  const [fatigueMultiplier, setFatigueMultiplier] = useState(1.07);
  const [weightDateEditEnabled, setWeightDateEditEnabled] = useState(false);
  const [deloadDateEditEnabled, setDeloadDateEditEnabled] = useState(false);

  React.useEffect(() => {
    loadFatigueMultiplier().then(setFatigueMultiplier);
    loadWorkoutCollapsed().then(setIsWorkoutCollapsed);
    loadWeightDateEditEnabled().then(setWeightDateEditEnabled);
    loadDeloadDateEditEnabled().then(setDeloadDateEditEnabled);
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
      // Defer to the active tab's in-tab back first (e.g. More sub-view → menu).
      // Only fall back to Home/exit when the tab does not consume the event.
      if (backConsumerRef.current && backConsumerRef.current()) {
        return true;
      }

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

  // Browser-safe back affordance: web has no Android hardware back button, so a
  // non-Home tab would otherwise have no on-screen way to return to Home short
  // of the tab bar. Render an explicit back control on web when off Home, unless
  // the current sub-screen already renders its own back (avoids stacked controls).
  const showWebBack = Platform.OS === 'web' && activeTab !== 'Home' && !tabOwnsBack;

  const saveWeight = useCallback(async (date) => {
    if (weightSaving) return false;
    Keyboard.dismiss();
    setSaveError('');
    const parsed = parseWeightEntry(weightValue);
    if (!parsed.ok) {
      setSaveError(parsed.error);
      return false;
    }
    let loggedAt = parsed.logged_at || new Date().toISOString();
    const d = new Date();
    const localToday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      if (date <= localToday) {
        loggedAt = date + loggedAt.slice(10);
      }
    } else {
      loggedAt = localToday + loggedAt.slice(10);
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
      return true;
    } finally {
      setWeightSaving(false);
    }
  }, [weightSaving, weightValue, weightNote, weightHook]);

  const handleExport = useCallback(() => buildExportPayload(exportBackup), []);

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
        <View testID="tab-content-Home" style={[styles.tabContent, activeTab === 'Home' && styles.activeTabContent]}>
          <HomeScreen
            weightEntries={weightHook.entries}
            workoutNote={noteHook.currentNote}
            notes={noteHook.notes}
            successMessage={saveSuccess}
            onNavigate={handleTabPress}
            loading={weightHook.loading || noteHook.loading}
          />
        </View>
        <View testID="tab-content-Log" style={[styles.tabContent, activeTab === 'Log' && styles.activeTabContent]}>
          <LogScreen
            workoutNoteText={workoutNoteText}
            setWorkoutNoteText={setWorkoutNoteText}
            workoutNoteTitle={workoutNoteTitle}
            setWorkoutNoteTitle={setWorkoutNoteTitle}
            isCollapsed={isWorkoutCollapsed}
            toggleCollapsed={toggleWorkoutCollapsed}
            onSaveWorkout={saveWorkout}
            deloadDateEditEnabled={deloadDateEditEnabled}
            isActive={activeTab === 'Log'}
          />
        </View>
        <View testID="tab-content-Weight" style={[styles.tabContent, activeTab === 'Weight' && styles.activeTabContent]}>
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
        <View testID="tab-content-Analytics" style={[styles.tabContent, activeTab === 'Analytics' && styles.activeTabContent]}>
          <AnalyticsScreen multiplier={fatigueMultiplier} section={analyticsSection} />
        </View>
        <View testID="tab-content-More" style={[styles.tabContent, activeTab === 'More' && styles.activeTabContent]}>
          <MoreScreen
            isActive={activeTab === 'More'}
            auth={auth}
            registerBackConsumer={registerBackConsumer}
            onOwnsBackChange={setTabOwnsBack}
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
            deloadDateEditEnabled={deloadDateEditEnabled}
            onUpdateDeloadDateEditEnabled={async (val) => {
              setDeloadDateEditEnabled(val);
              await saveDeloadDateEditEnabled(val);
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
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          {showWebBack && (
            <View style={styles.webBackBar}>
              <Pressable
                onPress={() => handleTabPress('Home')}
                style={styles.webBackButton}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Back to Home"
              >
                <Text style={styles.webBackButtonText}>← Home</Text>
              </Pressable>
            </View>
          )}
          {isUpdatePending && (
            <View style={styles.updateBanner} testID="update-pending-banner">
              <Text style={styles.updateBannerText}>Update ready</Text>
              <Pressable
                onPress={() => Updates.reloadAsync()}
                style={styles.updateBannerButton}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Restart to apply update"
              >
                <Text style={styles.updateBannerButtonText}>Restart to apply</Text>
              </Pressable>
            </View>
          )}
          <View style={styles.content}>{renderContent()}</View>
        </KeyboardAvoidingView>
        <SafeAreaView style={styles.tabBarSafeArea} pointerEvents="box-none">
          <TabBar
            tabs={TABS}
            activeTab={activeTab}
            onTabPress={handleTabPress}
            addScrollListener={addScrollListener}
          />
        </SafeAreaView>
        {ownershipPrompt ? (
          <View style={styles.ownershipOverlay} testID="ownership-prompt">
            <View style={styles.ownershipCard}>
              {ownershipPrompt.type === 'first-upload' ? (
                <>
                  <Text style={styles.ownershipTitle}>
                    Upload your local history?
                  </Text>
                  <Text style={styles.ownershipBody}>
                    This is your first sign-in on this device. Kilo can upload
                    the training history saved here into your account so it
                    stays in sync across your devices.
                  </Text>
                  <Button
                    title="Upload My History"
                    loadingTitle="Working…"
                    onPress={() => confirmOwnershipUpload()}
                  />
                  <Button title="Not Now" onPress={dismissOwnershipPrompt} />
                </>
              ) : (
                <>
                  <Text style={styles.ownershipTitle}>
                    This device holds another account's history
                  </Text>
                  <Text style={styles.ownershipBody}>
                    The training history saved on this device belongs to a
                    different account. Choose what to do before cloud sync
                    starts. Nothing is uploaded until you decide.
                  </Text>
                  <Button
                    title="Start Fresh on This Device"
                    loadingTitle="Working…"
                    onPress={() => startFreshOnDevice()}
                  />
                  <Text style={styles.ownershipHint}>
                    Recommended. Removes the history stored on this device,
                    then downloads your account's own data. The other
                    account's cloud copy is not affected.
                  </Text>
                  <Button
                    title="Upload It Into My Account"
                    loadingTitle="Working…"
                    onPress={() => confirmOwnershipUpload()}
                  />
                  <Text style={styles.ownershipHint}>
                    Only choose this if the history on this device is really
                    yours.
                  </Text>
                  <Button title="Decide Later" onPress={dismissOwnershipPrompt} />
                </>
              )}
            </View>
          </View>
        ) : null}
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
  webBackBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    backgroundColor: Colors.background,
  },
  updateBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.chipBackground,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  updateBannerText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.chipText,
  },
  updateBannerButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.chipText,
    minHeight: 32,
    justifyContent: 'center',
  },
  updateBannerButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.chipText,
  },
  webBackButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    backgroundColor: 'transparent',
    // WCAG 2.5.5 / mobile a11y: guarantee a >=44x44 tappable area.
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
  },
  webBackButtonText: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  ownershipOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  ownershipCard: {
    alignSelf: 'stretch',
    backgroundColor: Colors.background,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    padding: 20,
    gap: 12,
  },
  ownershipTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text,
  },
  ownershipBody: {
    fontSize: 15,
    color: Colors.text,
    lineHeight: 22,
  },
  ownershipHint: {
    fontSize: 13,
    color: Colors.textMuted,
    lineHeight: 18,
    marginTop: -6,
  },
});

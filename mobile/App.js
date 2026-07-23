import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import React, { useCallback, useState, useRef } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, StyleSheet, Text, View, BackHandler, Alert, StatusBar } from 'react-native';
import * as Updates from 'expo-updates';
import { useUpdates } from 'expo-updates';

import { Colors } from './theme/colors';
import { TabBar } from './components/TabBar';
import { Button } from './components/UI';
import { ScrollContext } from './components/ScreenShell';
import { TabBarLayoutContext, TAB_BAR_HEIGHT_FALLBACK } from './components/TabBarLayout';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';

import { HomeScreen } from './screens/HomeScreen';
import { MoreScreen } from './screens/MoreScreen';
import { LogScreen } from './screens/LogScreen';
import { WeightScreen } from './screens/WeightScreen';
import { AnalyticsScreen } from './screens/AnalyticsScreen';

// Memoized per-tab wrappers (#592): all five tabs stay mounted under
// display:none (#527), and App owns shell-level input state (weightValue,
// weightNote, workoutNoteText, workoutNoteTitle, etc.) at the top level. Every
// keystroke in one tab's field re-runs App's render and renderContent(), which
// previously re-created every tab's element and re-rendered every mounted
// screen — including the four tabs that keystroke had nothing to do with.
// React.memo shallow-compares each screen's own props and bails out of
// re-rendering (and reconciling that screen's subtree) when they are
// unchanged, so a Weight/Log keystroke only re-renders the tab that owns it.
// This relies on the callbacks/values passed to the OTHER tabs staying
// referentially stable across that keystroke (useCallback/useState already
// guarantee this below), not on any change to the child screens themselves.
const MemoHomeScreen = React.memo(HomeScreen);
const MemoMoreScreen = React.memo(MoreScreen);
const MemoLogScreen = React.memo(LogScreen);
const MemoWeightScreen = React.memo(WeightScreen);
const MemoAnalyticsScreen = React.memo(AnalyticsScreen);

import { useWeightEntries, useWorkoutNotes, useAutoSync, reloadWeightEntries, reloadWorkoutNotes } from './hooks/useEntries';
import { useAuthSession } from './hooks/useAuthSession';
import { parseWeightEntry } from './lib/parser';
import { makeWeightEntry } from './lib/data';
import { buildCloudExport, importBackup, getStorageMode, loadFatigueMultiplier, saveFatigueMultiplier, loadWorkoutCollapsed, saveWorkoutCollapsed, loadWeightDateEditEnabled, saveWeightDateEditEnabled, loadDeloadDateEditEnabled, saveDeloadDateEditEnabled } from './storage/entries';

const TABS = ['Home', 'Log', 'Weight', 'Analytics', 'More'];
const ZERO_SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 0, height: 0 },
  insets: { top: 0, right: 0, bottom: 0, left: 0 },
};

// Exported for testing. Encapsulates the ok/error envelope BackupScreen expects
// so the failure path can be exercised without rendering the full App component.
// exportFn defaults to buildCloudExport; tests inject a mock.
//
// buildCloudExport, not exportBackup (#488): the v3 payload omits user_profile,
// tracked_lifts, and feature_toggles. date_of_birth, sex, height_cm, and
// activity_level live only on the device — no cloud table holds them — so a v3
// export cannot survive a reinstall. buildCloudExport is a strict superset and
// stays v3-importable. Account email remains excluded (#350).
export async function buildExportPayload(exportFn = buildCloudExport) {
  try {
    const backup = await exportFn();
    return { ok: true, json: JSON.stringify(backup, null, 2) };
  } catch (e) {
    console.error('[handleExport] export threw unexpectedly:', e);
    return { ok: false, error: e?.message ? `Export failed: ${e.message}` : 'Export failed.' };
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState('Home');
  const [analyticsSection, setAnalyticsSection] = useState(null);
  const [tabBarHeight, setTabBarHeight] = useState(TAB_BAR_HEIGHT_FALLBACK);
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

  // Stable auth object for MemoMoreScreen (#592 review follow-up):
  // useAuthSession() returns a fresh object literal on every App render, so
  // `auth={auth}` gave MemoMoreScreen a changed prop on every keystroke
  // anywhere in the shell, defeating its memoization. Every field
  // useAuthSession returns is either a primitive/session value that only
  // changes when the auth state itself changes, or a function already
  // useCallback-memoized inside the hook — so rebuilding the object with
  // useMemo keyed on those fields yields a reference that only changes when
  // auth actually changes, not on every render.
  const stableAuth = React.useMemo(() => auth, [
    auth.configured,
    auth.loading,
    auth.session,
    auth.user,
    auth.signedIn,
    auth.passwordRecovery,
    auth.recoveryError,
    auth.clearPasswordRecovery,
    auth.signInWithPassword,
    auth.signUpWithPassword,
    auth.signOut,
    auth.resetPasswordForEmail,
    auth.signInWithOAuth,
    auth.handleAuthCallbackUrl,
    auth.updatePassword,
    auth.serverExport,
    auth.deleteAccount,
  ]);
  const {
    ownershipPrompt,
    canRestore,
    confirmOwnershipUpload,
    downloadAccountData,
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

  // Password recovery (#497): a recovery link can be opened while the user is
  // on any tab (or the app is cold-started straight into one). When the shell
  // detects a recovery session or a failed recovery link — via the native
  // deep-link listener or the web callback effect above — switch to the More
  // tab so its Account screen can present the set-new-password surface, rather
  // than leaving the user on an unrelated tab with nothing happening. Keyed on
  // the recovery signals only, so it fires once when recovery begins and does
  // not otherwise fight the user's tab navigation. MoreScreen makes the
  // matching switch to its Account sub-view.
  React.useEffect(() => {
    if (auth.passwordRecovery || auth.recoveryError) {
      setActiveTab('More');
    }
  }, [auth.passwordRecovery, auth.recoveryError]);

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

  // Hydration authority (#614, follow-up to #572 claim 30): whether the editor
  // has ever loaded stored text for the *current* note id is tracked explicitly
  // via hydratedNoteIdRef, never inferred from `!workoutNoteText`. Emptiness is
  // ambiguous — it's indistinguishable from a deliberate clear-to-empty edit —
  // so it cannot be trusted as an "unhydrated" signal. A routine switch (id
  // change) or the initial async load of currentNote for the still-current id
  // hydrates from storage; any later refresh of currentNote for an id already
  // marked hydrated (e.g. a background/remote note-list reload) leaves local
  // text/title untouched, so a deliberate clear stays empty.
  //
  // id and note resolution are not atomic: a routine switch can update
  // currentId a render before the matching currentNote resolves (#644
  // review). hydratedNoteIdRef is therefore only stamped with the new id once
  // a non-null currentNote for it has actually been applied — an id change
  // that arrives with currentNote still null clears the editor but leaves the
  // new id eligible for hydration so the real text/title load in once the
  // note resolves, instead of being permanently skipped.
  const prevCurrentId = useRef(noteHook.currentId);
  const hydratedNoteIdRef = useRef(null);
  React.useEffect(() => {
    const idChanged = noteHook.currentId !== prevCurrentId.current;
    const needsInitialHydration = hydratedNoteIdRef.current !== noteHook.currentId;
    if (idChanged || (needsInitialHydration && noteHook.currentNote)) {
      setWorkoutNoteText(noteHook.currentNote?.raw_text || '');
      setWorkoutNoteTitle(noteHook.currentNote?.title || '');
      prevCurrentId.current = noteHook.currentId;
      if (noteHook.currentNote) {
        hydratedNoteIdRef.current = noteHook.currentId;
      }
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

  // Pending-entry identity for a failed add (#596 review follow-up): the cloud
  // adapter writes the raw row before enqueueDirty(), so a thrown/false result
  // can follow a write that already partially landed. A naive retry that calls
  // makeWeightEntry() again mints a new id/logged_at/saved_at, so the retry
  // adds a second, duplicate row instead of completing the first. Stashing the
  // failed attempt's id here and reusing it on the next attempt keeps the
  // retry idempotent — same logical row, still reflecting any value/note the
  // user corrected before retrying. Cleared only on success.
  const pendingWeightEntryIdRef = useRef(null);

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
    // Reuse the id from a prior failed attempt instead of the freshly minted
    // one, so a retry after a partial write (raw row persisted, enqueue
    // rejected) targets the same logical row rather than creating a second.
    if (pendingWeightEntryIdRef.current) {
      entry.id = pendingWeightEntryIdRef.current;
    }
    pendingWeightEntryIdRef.current = entry.id;
    setWeightSaving(true);
    try {
      const result = await weightHook.add(entry);
      if (result === false) {
        // False-returning write (e.g. a rejected mutation): keep the entered
        // values so the user can retry instead of silently losing the entry.
        // pendingWeightEntryIdRef stays set so the retry reuses this id.
        setSaveError('Could not save weight entry. Please try again.');
        return false;
      }
      pendingWeightEntryIdRef.current = null;
      setWeightValue('');
      setWeightNote('');
      setSaveSuccess('Weight entry saved!');
      return true;
    } catch {
      // Rejected write (e.g. a thrown storage failure, possibly after a
      // partial persist): keep the entered values and the pending id so the
      // user can retry instead of silently losing the entry or duplicating
      // the partially-written row.
      setSaveError('Could not save weight entry. Please try again.');
      return false;
    } finally {
      setWeightSaving(false);
    }
  // Depend on weightHook.add itself, not the whole weightHook object (#592
  // review follow-up): useWeightEntries() returns a fresh object literal on
  // every App render, but its add/remove/update/refresh functions are each
  // useCallback-memoized inside the hook and stay referentially stable across
  // renders that don't change their own internals. Depending on the whole
  // object recreated saveWeight (and, through it, MemoWeightScreen's onSaveWeight
  // prop) on every keystroke anywhere in App, defeating the tab-memoization
  // above for the very tab it was meant to isolate.
  }, [weightSaving, weightValue, weightNote, weightHook.add]);

  const handleExport = useCallback(() => buildExportPayload(buildCloudExport), []);

  const handleImport = useCallback(async (payload) => {
    // Import has a local contract and a cloud contract (#526), and this is the
    // seam that knows which one applies. Passing the active storage mode through
    // is what makes a signed-in user's "replace" stamp and queue the imported
    // rows and tombstone the records the backup dropped; before #526 every
    // import silently took the local path, so a cloud restore reported success
    // while the account kept the old data (#522 claim 5).
    //
    // Resolved defensively for the same reason useAutoSync is destructured with
    // `|| {}` above: app-shell tests mock './storage/entries' with a partial
    // object. An unresolvable mode falls back to the local contract, which never
    // fabricates sync intent.
    const mode = typeof getStorageMode === 'function' ? getStorageMode() : undefined;
    const result = await importBackup(payload, 'replace', { mode });
    if (result.ok) {
      weightHook.refresh();
      noteHook.refresh();
    }
    return result;
  // weightHook.refresh/noteHook.refresh, not the whole hook objects (#592
  // review follow-up) — see the comment on saveWeight's dependency list.
  }, [weightHook.refresh, noteHook.refresh]);

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
  // noteHook.currentId/update/add/selectCurrent individually, not the whole
  // noteHook object (#592 review follow-up) — see the comment on saveWeight's
  // dependency list. currentId is a plain value (fine to depend on directly);
  // update/add/selectCurrent are each useCallback-memoized inside the hook.
  }, [workoutSaving, workoutNoteText, noteHook.currentId, noteHook.update, noteHook.add, noteHook.selectCurrent]);

  // Stable callbacks for MoreScreen's toggle props (#592): these were
  // previously passed as fresh inline arrow functions on every App render, so
  // MemoMoreScreen's shallow prop comparison never matched — defeating the
  // memoization above for any keystroke on any tab, not just the intended
  // unrelated ones. useCallback keeps their identity stable across renders
  // that do not change the values each closes over.
  const handleUpdateFatigueMultiplier = useCallback(async (val) => {
    setFatigueMultiplier(val);
    await saveFatigueMultiplier(val);
  }, []);

  const handleUpdateWeightDateEditEnabled = useCallback(async (val) => {
    setWeightDateEditEnabled(val);
    await saveWeightDateEditEnabled(val);
  }, []);

  const handleUpdateDeloadDateEditEnabled = useCallback(async (val) => {
    setDeloadDateEditEnabled(val);
    await saveDeloadDateEditEnabled(val);
  }, []);

  const renderContent = () => {
    return (
      <>
        <View testID="tab-content-Home" style={[styles.tabContent, activeTab === 'Home' && styles.activeTabContent]}>
          <MemoHomeScreen
            weightEntries={weightHook.entries}
            workoutNote={noteHook.currentNote}
            notes={noteHook.notes}
            successMessage={saveSuccess}
            onNavigate={handleTabPress}
            loading={weightHook.loading || noteHook.loading}
          />
        </View>
        <View testID="tab-content-Log" style={[styles.tabContent, activeTab === 'Log' && styles.activeTabContent]}>
          <MemoLogScreen
            workoutNoteText={workoutNoteText}
            setWorkoutNoteText={setWorkoutNoteText}
            workoutNoteTitle={workoutNoteTitle}
            setWorkoutNoteTitle={setWorkoutNoteTitle}
            isCollapsed={isWorkoutCollapsed}
            toggleCollapsed={toggleWorkoutCollapsed}
            onSaveWorkout={saveWorkout}
            deloadDateEditEnabled={deloadDateEditEnabled}
            isActive={activeTab === 'Log'}
            registerBackConsumer={registerBackConsumer}
          />
        </View>
        <View testID="tab-content-Weight" style={[styles.tabContent, activeTab === 'Weight' && styles.activeTabContent]}>
          <MemoWeightScreen
            weightValue={weightValue}
            setWeightValue={setWeightValue}
            weightNote={weightNote}
            setWeightNote={setWeightNote}
            onSaveWeight={saveWeight}
            errorMessage={saveError}
            saving={weightSaving}
            weightDateEditEnabled={weightDateEditEnabled}
            isActive={activeTab === 'Weight'}
            registerBackConsumer={registerBackConsumer}
          />
        </View>
        <View testID="tab-content-Analytics" style={[styles.tabContent, activeTab === 'Analytics' && styles.activeTabContent]}>
          <MemoAnalyticsScreen multiplier={fatigueMultiplier} section={analyticsSection} />
        </View>
        <View testID="tab-content-More" style={[styles.tabContent, activeTab === 'More' && styles.activeTabContent]}>
          <MemoMoreScreen
            isActive={activeTab === 'More'}
            auth={stableAuth}
            registerBackConsumer={registerBackConsumer}
            onOwnsBackChange={setTabOwnsBack}
            onNavigate={handleTabPress}
            onExport={handleExport}
            onImport={handleImport}
            fatigueMultiplier={fatigueMultiplier}
            onUpdateFatigueMultiplier={handleUpdateFatigueMultiplier}
            weightDateEditEnabled={weightDateEditEnabled}
            onUpdateWeightDateEditEnabled={handleUpdateWeightDateEditEnabled}
            deloadDateEditEnabled={deloadDateEditEnabled}
            onUpdateDeloadDateEditEnabled={handleUpdateDeloadDateEditEnabled}
          />
        </View>
      </>
    );
  };

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics || ZERO_SAFE_AREA_METRICS}>
    <TabBarLayoutContext.Provider value={{ tabBarHeight }}>
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
        <TabBar
          tabs={TABS}
          activeTab={activeTab}
          onTabPress={handleTabPress}
          addScrollListener={addScrollListener}
          onHeightChange={(height) => setTabBarHeight((prev) => (prev === height ? prev : height))}
        />
        {ownershipPrompt && !auth.passwordRecovery && !auth.recoveryError ? (
          <View style={styles.ownershipOverlay} testID="ownership-prompt">
            <View style={styles.ownershipCard}>
              {ownershipPrompt.type === 'first-upload' ? (
                <>
                  <Text style={styles.ownershipTitle}>
                    Upload your local history?
                  </Text>
                  <Text style={styles.ownershipBody}>
                    This is your first sign-in on this device. Kilo can upload
                    the training history saved here into your account
                    {canRestore
                      ? ', or download the data already in your account onto this device.'
                      : ' so it stays in sync across your devices.'}
                  </Text>
                  <Button
                    title="Upload My History"
                    loadingTitle="Working…"
                    onPress={() => confirmOwnershipUpload()}
                  />
                  {canRestore ? (
                    <>
                      <Button
                        title="Download My Account's Data"
                        loadingTitle="Working…"
                        onPress={() => downloadAccountData()}
                      />
                      <Text style={styles.ownershipHint}>
                        This device is empty. Pull the data already in your
                        account down onto it — nothing is uploaded.
                      </Text>
                    </>
                  ) : null}
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
    </TabBarLayoutContext.Provider>
    </SafeAreaProvider>
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

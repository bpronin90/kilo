import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import React, { useCallback, useContext, useState, useRef, useEffect } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, SafeAreaView, StyleSheet, Text, View, StatusBar } from 'react-native';
import { WebAlertHost } from './components/WebAlertHost';
import * as Updates from 'expo-updates';

import { ThemeProvider, useTheme, useThemedStyles } from './theme/ThemeContext';
import { TabBar } from './components/TabBar';
import { Button } from './components/UI';
import { TabBarLayoutContext, TAB_BAR_VISUAL_GAP } from './components/TabBarLayout';
import { SafeAreaProvider, SafeAreaInsetsContext, initialWindowMetrics } from 'react-native-safe-area-context';

import { HomeScreen } from './screens/HomeScreen';
import { MoreScreen } from './screens/MoreScreen';
import { LogScreen } from './screens/LogScreen';
import { WeightScreen } from './screens/WeightScreen';
import { AnalyticsScreen } from './screens/AnalyticsScreen';

import { CloudSyncContext } from './hooks/useEntries';
import { reloadRecoveryBlocks } from './hooks/entries/recoveryBlockHooks';
import { importBackup, getStorageMode } from './storage/entries';
import { RestTimerBanner } from './components/RestTimerBanner';
import { useAppShell } from './app/AppShell';

// The module's public surface is preserved by re-exporting the pure helpers
// that moved to ./app/navigation and ./app/export (#1047). Tests and screens
// import these from '../App' unchanged.
export { buildExportPayload } from './app/export';
export {
  emitMeasurement,
  analyticsSectionVariant,
  normalizeNavTarget,
  CLOUD_SYNC_NAV_TARGET,
} from './app/navigation';

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

const TABS = ['Home', 'Log', 'Weight', 'Analytics', 'More'];
const ZERO_SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 0, height: 0 },
  insets: { top: 0, right: 0, bottom: 0, left: 0 },
};

// ThemeProvider wraps the entire shell (#689). It must sit above AppShell, not
// inside it: AppShell's own container/safe-area/status-bar styling resolves
// through useTheme, so a provider mounted alongside that markup would leave the
// outermost chrome on the default palette.
export default function App() {
  return (
    <ThemeProvider>
      <WipeAwareAppShell />
    </ThemeProvider>
  );
}


// A confirmed device wipe must discard more than persisted values. Every tab
// stays mounted for navigation performance, and those trees own hydrated
// health data plus editor input state. Advancing this key remounts the entire
// stateful shell only after the storage/key wipe succeeds, so no deleted value
// remains visible or can be written back by a stale mounted effect.
function WipeAwareAppShell() {
  const [deviceDataGeneration, setDeviceDataGeneration] = useState(0);
  const remountResolversRef = useRef([]);

  useEffect(() => {
    const resolvers = remountResolversRef.current.splice(0);
    resolvers.forEach((resolve) => resolve());
  }, [deviceDataGeneration]);

  useEffect(() => () => {
    const resolvers = remountResolversRef.current.splice(0);
    resolvers.forEach((resolve) => resolve());
  }, []);

  const handleDeviceDataWiped = useCallback(() => new Promise((resolve) => {
    remountResolversRef.current.push(resolve);
    setDeviceDataGeneration((generation) => generation + 1);
  }), []);

  return (
    <ShellView
      key={deviceDataGeneration}
      onDeviceDataWiped={handleDeviceDataWiped}
    />
  );
}

// The presentational shell (#1047): it reads the theme and safe-area insets,
// pulls the shell's entire orchestrated state from useAppShell, derives the two
// view-only values (rest-timer banner clearance and the web back affordance),
// and renders the same tree App.js always rendered. Kept above useAppShell so a
// wipe remount (WipeAwareAppShell's key) rebuilds hooks and view together.
function ShellView({ onDeviceDataWiped }) {
  const { mode } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { bottom: bottomSafeAreaInset = 0 } = useContext(SafeAreaInsetsContext) || {};
  const {
    activeTab, tabOwnsBack, tabBarHeight, setTabBarHeight, weightHook, noteHook, stableAuth,
    auth, restTimer, cloudSync, isUpdatePending, registerBackConsumer, setTabOwnsBack,
    weightValue, setWeightValue, weightNote, setWeightNote, workoutNoteText,
    setWorkoutNoteText, workoutNoteTitle, setWorkoutNoteTitle, isWorkoutCollapsed,
    toggleWorkoutCollapsed, fatigueMultiplier, saveError, saveSuccess, weightSaving,
    homeLoadError, saveWeight, saveWorkout, handleTabPress, handleExport,
    handleUpdateFatigueMultiplier, handleRetryHomeData, ownershipPrompt, canRestore,
    confirmOwnershipUpload, downloadAccountData, startFreshOnDevice, dismissOwnershipPrompt,
    analyticsTarget, analyticsTargetKey, logNoteTarget, logNoteTargetKey, logRecoveryTarget,
    logRecoveryTargetKey, moreSubviewTarget, moreSubviewTargetKey,
  } = useAppShell({ onDeviceDataWiped });

  // #577 review: the floating TabBar is `position: absolute`, so a normal-
  // flow sibling rendered near the bottom of the screen (the rest-timer
  // banner) does not automatically get pushed above it. Reuse the EXACT
  // clearance ScreenShell reserves for scrollable content (measured
  // tabBarHeight + the shared visual gap + the bottom safe-area inset).
  const restTimerBannerClearance = tabBarHeight + TAB_BAR_VISUAL_GAP + bottomSafeAreaInset;

  // Browser-safe back affordance: web has no Android hardware back button, so a
  // non-Home tab would otherwise have no on-screen way to return to Home short
  // of the tab bar. Render an explicit back control on web when off Home, unless
  // the current sub-screen already renders its own back (avoids stacked controls).
  const showWebBack = Platform.OS === 'web' && activeTab !== 'Home' && !tabOwnsBack;

  // Routine import (#955): exactly one write, `add`, which creates a note and
  // never touches the current-routine pointer. Deliberately NOT routed through
  // `update`/`selectCurrent` — a pasted routine can therefore neither overwrite
  // an existing note (by id or by a colliding title) nor become the routine the
  // user is training on. Adoption stays the Log tab's existing post-save prompt
  // (#748). Memoized so MemoMoreScreen's prop identity is stable across
  // unrelated shell renders, like the callbacks above it.
  //
  // The third argument is passed straight through (#997): it carries the import
  // screen's durable per-attempt creation token, which is what lets a retry
  // after a failed cloud enqueue complete THAT import's routine under its
  // original id instead of creating a second one. This wiring only forwards it —
  // the token's lifecycle (mint, retain on failure, restore after a restart,
  // clear on success) belongs to RoutineImportScreen.
  const handleCreateRoutineFromImport = useCallback(
    (title, rawText, options) => noteHook.add(title, rawText, options),
    [noteHook.add],
  );

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
      // A restored backup replaces the recovery blocks and week memberships
      // wholesale without going through any recovery lifecycle action, so
      // nothing else broadcasts the change (#699). Without this, a mounted Home
      // or Analytics keeps filtering ordinary analytics by the PRE-import
      // memberships and inclusion preferences until an unrelated recovery
      // mutation, a cloud sync, or a restart — indefinitely for a local-only
      // user.
      reloadRecoveryBlocks();
    }
    return result;
  // weightHook.refresh/noteHook.refresh, not the whole hook objects (#592
  // review follow-up) — see the comment on saveWeight's dependency list.
  }, [weightHook.refresh, noteHook.refresh]);

  const renderContent = () => {
    return (
      <>
        <View
          testID="tab-content-Home"
          style={[styles.tabContent, activeTab === 'Home' && styles.activeTabContent]}
          accessibilityElementsHidden={activeTab !== 'Home'}
          importantForAccessibility={activeTab === 'Home' ? 'auto' : 'no-hide-descendants'}
        >
          <MemoHomeScreen
            weightEntries={weightHook.entries}
            workoutNote={noteHook.currentNote}
            currentId={noteHook.currentId}
            notes={noteHook.notes}
            successMessage={saveSuccess}
            onNavigate={handleTabPress}
            loading={weightHook.loading || noteHook.loading}
            loadError={homeLoadError}
            onRetryLoad={handleRetryHomeData}
          />
        </View>
        <View
          testID="tab-content-Log"
          style={[styles.tabContent, activeTab === 'Log' && styles.activeTabContent]}
          accessibilityElementsHidden={activeTab !== 'Log'}
          importantForAccessibility={activeTab === 'Log' ? 'auto' : 'no-hide-descendants'}
        >
          <MemoLogScreen
            workoutNoteText={workoutNoteText}
            setWorkoutNoteText={setWorkoutNoteText}
            workoutNoteTitle={workoutNoteTitle}
            setWorkoutNoteTitle={setWorkoutNoteTitle}
            isCollapsed={isWorkoutCollapsed}
            toggleCollapsed={toggleWorkoutCollapsed}
            onSaveWorkout={saveWorkout}
            isActive={activeTab === 'Log'}
            registerBackConsumer={registerBackConsumer}
            // Flattened to primitives, not the target object (#718): a fresh
            // object literal would change MemoLogScreen's prop identity on
            // every shell render, defeating its memoization.
            navNoteId={logNoteTarget ? logNoteTarget.noteId : null}
            navNoteKey={logNoteTargetKey}
            navRecoveryNoteId={logRecoveryTarget ? logRecoveryTarget.noteId : null}
            navRecoveryKey={logRecoveryTargetKey}
            restTimerIsRunning={restTimer.isRunning}
            restTimerRemainingMs={restTimer.remainingMs}
            restTimerJustElapsed={restTimer.justElapsed}
            restTimerBackgroundAlertAvailable={restTimer.backgroundAlertAvailable}
            onStartRestTimer={restTimer.start}
            onCancelRestTimer={restTimer.cancel}
            onDismissRestTimerDone={restTimer.dismissDone}
          />
        </View>
        <View
          testID="tab-content-Weight"
          style={[styles.tabContent, activeTab === 'Weight' && styles.activeTabContent]}
          accessibilityElementsHidden={activeTab !== 'Weight'}
          importantForAccessibility={activeTab === 'Weight' ? 'auto' : 'no-hide-descendants'}
        >
          <MemoWeightScreen
            weightValue={weightValue}
            setWeightValue={setWeightValue}
            weightNote={weightNote}
            setWeightNote={setWeightNote}
            onSaveWeight={saveWeight}
            errorMessage={saveError}
            saving={weightSaving}
            isActive={activeTab === 'Weight'}
            onNavigate={handleTabPress}
            registerBackConsumer={registerBackConsumer}
          />
        </View>
        <View
          testID="tab-content-Analytics"
          style={[styles.tabContent, activeTab === 'Analytics' && styles.activeTabContent]}
          accessibilityElementsHidden={activeTab !== 'Analytics'}
          importantForAccessibility={activeTab === 'Analytics' ? 'auto' : 'no-hide-descendants'}
        >
          <MemoAnalyticsScreen
            multiplier={fatigueMultiplier}
            // Unchanged external shape (#718): AnalyticsScreen still consumes a
            // flat section + monotonic nonce, so the typed-intent generalization
            // is invisible to it and to every existing #717 call site.
            section={analyticsTarget ? analyticsTarget.id : null}
            sectionNonce={analyticsTargetKey}
            onNavigate={handleTabPress}
          />
        </View>
        <View
          testID="tab-content-More"
          style={[styles.tabContent, activeTab === 'More' && styles.activeTabContent]}
          accessibilityElementsHidden={activeTab !== 'More'}
          importantForAccessibility={activeTab === 'More' ? 'auto' : 'no-hide-descendants'}
        >
          <MemoMoreScreen
            isActive={activeTab === 'More'}
            auth={stableAuth}
            registerBackConsumer={registerBackConsumer}
            onOwnsBackChange={setTabOwnsBack}
            onNavigate={handleTabPress}
            onExport={handleExport}
            onImport={handleImport}
            onCreateRoutineFromImport={handleCreateRoutineFromImport}
            fatigueMultiplier={fatigueMultiplier}
            onUpdateFatigueMultiplier={handleUpdateFatigueMultiplier}
            // Flattened for the same memoization reason as MemoLogScreen above.
            navSubviewView={moreSubviewTarget ? moreSubviewTarget.view : null}
            navSubviewAnchor={moreSubviewTarget ? moreSubviewTarget.anchor : null}
            navSubviewKey={moreSubviewTargetKey}
          />
        </View>
      </>
    );
  };

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics || ZERO_SAFE_AREA_METRICS}>
    <TabBarLayoutContext.Provider value={{ tabBarHeight }}>
    <CloudSyncContext.Provider value={cloudSync}>
      <View style={styles.appContainer}>
        {/* Mounted at the app root, not per-screen: Alert.alert is called
            imperatively from hooks all over the app, so the single host has
            to outlive any one screen. */}
        <WebAlertHost />
        <SafeAreaView style={styles.topSafeArea} />
        {/* Dark chrome needs light status-bar glyphs and vice versa. */}
        <ExpoStatusBar style={mode === 'dark' ? 'light' : 'dark'} />
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
        {/* #950 review (P1): mounted at the app-shell level, NOT inside
            MemoLogScreen, so timer completion is visible regardless of which
            tab is active — the per-tab View wrappers hide MemoLogScreen's
            entire subtree (including anything it renders) whenever another
            tab is active, and the OS notification is deliberately suppressed
            while the app is foregrounded on ANY tab, so this in-app surface
            is the only alert the user gets in that case.
            #577 / #1026: the running countdown and completion render as a
            compact centered pill, not a full-width banner. It carries the
            same tab-bar/safe-area clearance ScreenShell reserves so the
            floating (position: absolute) TabBar — or the bottom safe area /
            home indicator on inset devices — can never cover it or its
            Cancel/Dismiss action. */}
        <RestTimerBanner
          isRunning={restTimer.isRunning}
          remainingMs={restTimer.remainingMs}
          justElapsed={restTimer.justElapsed}
          backgroundAlertAvailable={restTimer.backgroundAlertAvailable}
          onCancel={restTimer.cancel}
          onDismissDone={restTimer.dismissDone}
          onStart={restTimer.start}
          showStart={false}
          style={{ marginBottom: restTimerBannerClearance }}
        />
        <TabBar
          tabs={TABS}
          activeTab={activeTab}
          onTabPress={handleTabPress}
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
    </CloudSyncContext.Provider>
    </TabBarLayoutContext.Provider>
    </SafeAreaProvider>
  );
}

const createStyles = (colors) => StyleSheet.create({
  appContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topSafeArea: {
    flex: 0,
    backgroundColor: colors.background,
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
    backgroundColor: colors.background,
  },
  updateBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.chipBackground,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  updateBannerText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.chipText,
  },
  updateBannerButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.chipText,
    minHeight: 32,
    justifyContent: 'center',
  },
  updateBannerButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.chipText,
  },
  webBackButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: 'transparent',
    // WCAG 2.5.5 / mobile a11y: guarantee a >=44x44 tappable area.
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
  },
  webBackButtonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  ownershipOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  ownershipCard: {
    alignSelf: 'stretch',
    backgroundColor: colors.background,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 20,
    gap: 12,
  },
  ownershipTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  ownershipBody: {
    fontSize: 15,
    color: colors.text,
    lineHeight: 22,
  },
  ownershipHint: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
    marginTop: -6,
  },
});

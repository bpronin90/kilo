// Hook-owning shell composition extracted from App.js (#1047).
//
// useAppShell owns every shell-level hook: the startup/migration effects, the
// domain data hooks (weight/note entries, auto-sync, cloud-sync summary), the
// auth/wipe wiring, the single rest-timer controller, the typed cross-screen
// navigation state, and the save/import/export handlers. It returns them to the
// presentational shell rendered by App.js. Pure helpers live in ./navigation
// and ./export; keeping them out of this module is what lets those helpers and
// App.js share the surface without a circular import, while this module stays
// the single owner of the shell's stateful orchestration. Nothing here renders
// JSX or reads the theme/insets — those are view concerns handled in App.js.

import React, { useCallback, useState, useRef, useEffect } from 'react';
import { Keyboard, Platform, BackHandler } from 'react-native';
import { Alert } from '../lib/platformAlert';
import { useUpdates } from 'expo-updates';

import { TAB_BAR_HEIGHT_FALLBACK } from '../components/TabBarLayout';
import { useCloudSyncStatus, useSyncRecovery, useWeightEntries, useWorkoutNotes, useAutoSync, reloadWeightEntries, reloadWorkoutNotes } from '../hooks/useEntries';
import { useAuthSession } from '../hooks/useAuthSession';
import { parseWeightEntry, buildSessionsFromNote } from '../lib/parser';
import { PRODUCT_MEASUREMENT_EVENTS } from '../lib/productMeasurement';
import { migrateSensitiveDeviceData } from '../storage/secureStorage';
import { makeWeightEntry } from '../lib/data';
import { reconcileWorkoutReminder, installForegroundHandler } from '../lib/reminderScheduler';
import { useRestTimer } from '../hooks/useRestTimer';
import { buildCloudExport, loadFatigueMultiplier, saveFatigueMultiplier, loadWorkoutCollapsed, saveWorkoutCollapsed } from '../storage/entries';
import { markStartupPhase } from '../storage/entries/startupTiming';
import { purgePersistedDerivedSections } from '../storage/entries/derivedCachePurge';
import { normalizeNavTarget, analyticsSectionVariant, CLOUD_SYNC_NAV_TARGET, emitMeasurement } from './navigation';
import { buildExportPayload } from './export';

// Routine/backup import wiring (handleImport, handleCreateRoutineFromImport, and
// the reloadRecoveryBlocks + importBackup/getStorageMode imports it needs) lives
// in ShellView (App.js) instead of this hook: source-scan tests assert that
// wiring is textually present in App.js. Everything else — startup, migration,
// hydration, auth callbacks, the Android hardware-back precedence, saves and
// navigation — stays inside this hook and is returned to the view.
export function useAppShell({ onDeviceDataWiped }) {
  const [activeTab, setActiveTab] = useState('Home');
  // One (target, key) pair per destination that can receive a typed navigation
  // intent (#718). They are deliberately independent rather than one shared
  // `navTarget` object: every mounted screen is memoized (see the note above
  // MemoHomeScreen), so a single shared object would change identity on every
  // targeted navigation and force every destination to reconcile for an intent
  // addressed to one of them. Each destination only ever sees its own kind.
  //
  // Targeting must re-fire even when the same target is requested twice in a
  // row (#717, generalized in #718). The target value alone is a stable prop,
  // so a second "Analytics → weight" handoff would not re-run Analytics' scroll
  // effect. The monotonic key makes every navigation request distinct without
  // changing tab behavior.
  const [analyticsTarget, setAnalyticsTarget] = useState(null); // { kind: 'section', id } | null
  const [analyticsTargetKey, setAnalyticsTargetKey] = useState(0);
  const [logNoteTarget, setLogNoteTarget] = useState(null); // { kind: 'note', noteId } | null
  const [logNoteTargetKey, setLogNoteTargetKey] = useState(0);
  const [logRecoveryTarget, setLogRecoveryTarget] = useState(null); // { kind: 'recovery-note', noteId } | null
  const [logRecoveryTargetKey, setLogRecoveryTargetKey] = useState(0);
  const [moreSubviewTarget, setMoreSubviewTarget] = useState(null); // { kind: 'subview', view, anchor } | null
  const [moreSubviewTargetKey, setMoreSubviewTargetKey] = useState(0);
  const [tabBarHeight, setTabBarHeight] = useState(TAB_BAR_HEIGHT_FALLBACK);
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

  // Install the foreground notification handler once on app startup. This ensures
  // the handler is in place before any persisted OS notification can arrive in
  // the foreground, independent of whether reminders are scheduled or permissions
  // are granted.
  useEffect(() => {
    installForegroundHandler().catch((e) => {
      console.error('[App] Failed to install foreground handler:', e);
    });
  }, []);

  // Queue the one-time legacy plaintext migration before domain hooks below
  // begin their own storage reads. The storage boundary serializes this with
  // every read/write, but the full getAllKeys() scan itself only ever runs
  // once per device (#809) — every later launch resolves this to a single
  // marker check — and every read retains its own lazy migration fallback
  // regardless.
  useEffect(() => {
    markStartupPhase('migration:requested');
    migrateSensitiveDeviceData().catch((e) => {
      console.error('[App] Failed to migrate protected device data:', e);
    });
    // Queued right behind it, for the same reason and with the same shape
    // (issue #813): a one-time rewrite that strips the parser-output cache an
    // older build persisted onto every synced workout note, which made each
    // notebook read and write, every sync pass, and every backup carry ~100x
    // the note text. Later launches resolve this to a single marker read.
    purgePersistedDerivedSections().catch((e) => {
      console.error('[App] Failed to purge persisted derived note caches:', e);
    });
  }, []);

  // App.js owns the single mounted rest-timer controller and its sole
  // AppState subscription (#577) — hydration, cold-start/foreground
  // reconciliation, and the tick all live inside this one hook instance so
  // no screen/editor component can create a competing listener.
  const restTimer = useRestTimer();

  const { isUpdatePending } = useUpdates();

  const weightHook = useWeightEntries();
  const noteHook = useWorkoutNotes();
  const auth = useAuthSession({ onDeviceDataWiped });

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
    auth.deviceWipeRequired,
    auth.wipeDeviceData,
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

  React.useEffect(() => {
    loadFatigueMultiplier().then(setFatigueMultiplier);
    loadWorkoutCollapsed().then(setIsWorkoutCollapsed);
  }, []);

  // Reconcile the workout reminder once at app startup (#590): the active
  // routine can change while the app is closed (e.g. restored from a cloud
  // sync, or edited on another device), which would otherwise leave a
  // previously-scheduled native reminder pinned to whatever routine was
  // current when the app last closed. Idempotent — reconcileWorkoutReminder's
  // own dedup cache skips this if the workout-note broadcast listener in
  // workoutNoteHooks.js already reconciled the same schedule first.
  React.useEffect(() => {
    reconcileWorkoutReminder().catch(() => {});
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

  // `targetInput` is the intent's `target` (or the legacy bare Analytics
  // section string); the shell owns the monotonic `key` of the
  // `{ tab, target, key }` contract, so callers never mint one (#718).
  const handleTabPress = useCallback((tab, targetInput = null) => {
    Keyboard.dismiss();
    setSaveError('');
    setSaveSuccess('');

    const target = normalizeNavTarget(tab, targetInput);
    const sectionTarget = target?.kind === 'section' ? target : null;
    const noteTarget = target?.kind === 'note' ? target : null;
    const recoveryTarget = target?.kind === 'recovery-note' ? target : null;
    const subviewTarget = target?.kind === 'subview' ? target : null;

    // The target itself is cleared unconditionally so a plain tab press to any
    // OTHER tab drops a stale pending intent, but only a request that actually
    // addresses a destination bumps that destination's key. Bumping a key on
    // every tab press would change a prop on that always-mounted memoized tree
    // during unrelated navigation (Home → Weight, Log → More), forcing hidden
    // and comparatively expensive subtrees to reconcile and defeating the
    // render isolation the memoized screens exist to provide. Clearing to null
    // is value-stable once cleared, so it costs nothing after the first press.
    setAnalyticsTarget(sectionTarget);
    if (sectionTarget) setAnalyticsTargetKey((n) => n + 1);
    setLogNoteTarget(noteTarget);
    if (noteTarget) setLogNoteTargetKey((n) => n + 1);
    setLogRecoveryTarget(recoveryTarget);
    if (recoveryTarget) setLogRecoveryTargetKey((n) => n + 1);
    setMoreSubviewTarget(subviewTarget);
    if (subviewTarget) setMoreSubviewTargetKey((n) => n + 1);

    setActiveTab(tab);
    emitMeasurement(PRODUCT_MEASUREMENT_EVENTS.TAB_VIEWED, { tab });
    if (tab === 'Analytics') {
      // The NORMALIZED section, not the raw request: an ignored/malformed
      // target is treated exactly like a plain tab press, which leaves
      // Analytics on the view it was already showing, so 'overview' is the
      // honest report of an unsectioned visit. analyticsSectionVariant keeps
      // its own 'other' branch for direct callers and the sanitizer allow-list.
      emitMeasurement(PRODUCT_MEASUREMENT_EVENTS.ANALYTICS_VIEWED, {
        section: analyticsSectionVariant(sectionTarget ? sectionTarget.id : null),
      });
    }
  }, []);

  // ── Shell-owned cloud sync summary (#737) ────────────────────────────────
  //
  // Subscribed here, once, and published through CloudSyncContext. Every tab
  // stays mounted (#527), so a per-screen useCloudSyncStatus() would mean five
  // permanent subscriptions and five duplicate dirty-queue scans on every
  // broadcast. Screens read the context instead.
  const cloudSyncSummary = useCloudSyncStatus();
  // The same runner CloudSyncRecovery's own Retry uses — bound here rather than
  // reimplemented, so the retry offered next to the failure copy has exactly
  // the existing sync semantics (consent check, adapter selection, phase
  // transitions) and adds none of its own.
  const { retrySync } = useSyncRecovery(auth.user) || {};

  const openCloudSync = useCallback(() => {
    handleTabPress('More', CLOUD_SYNC_NAV_TARGET);
  }, [handleTabPress]);

  const handleRetrySync = useCallback(async () => {
    if (typeof retrySync !== 'function') {
      return { ok: false, error: 'Cloud Sync is not available in this build yet.' };
    }
    const result = await retrySync();
    // Generic, like CloudSyncRecovery's own handleRun: a raw runner/Supabase
    // message is not user-facing copy, and the Cloud Sync panel is where the
    // detail belongs.
    if (result?.ok) return { ok: true };
    return { ok: false, error: 'Could not sync. Open Cloud Sync for details.' };
  }, [retrySync]);

  // Memoized as one object: it is the context value for a subtree of memoized
  // screens, so a fresh literal per render would re-render every consumer on
  // every keystroke anywhere in the shell.
  const cloudSync = React.useMemo(
    () => ({ summary: cloudSyncSummary, retrySync: handleRetrySync, openCloudSync }),
    [cloudSyncSummary, handleRetrySync, openCloudSync]
  );

  const saveWeight = useCallback(async (date) => {
    if (weightSaving) return false;
    const startedAt = Date.now();
    emitMeasurement(PRODUCT_MEASUREMENT_EVENTS.WEIGHT_SAVE_ATTEMPTED, {});
    Keyboard.dismiss();
    setSaveError('');
    const parsed = parseWeightEntry(weightValue);
    if (!parsed.ok) {
      setSaveError(parsed.error);
      emitMeasurement(PRODUCT_MEASUREMENT_EVENTS.WEIGHT_SAVE_COMPLETED, {
        ok: false,
        duration_ms: Date.now() - startedAt,
      });
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
        emitMeasurement(PRODUCT_MEASUREMENT_EVENTS.WEIGHT_SAVE_COMPLETED, {
          ok: false,
          duration_ms: Date.now() - startedAt,
        });
        return false;
      }
      pendingWeightEntryIdRef.current = null;
      setWeightValue('');
      setWeightNote('');
      setSaveSuccess('Weight entry saved!');
      emitMeasurement(PRODUCT_MEASUREMENT_EVENTS.WEIGHT_SAVE_COMPLETED, {
        ok: true,
        duration_ms: Date.now() - startedAt,
      });
      return true;
    } catch {
      // Rejected write (e.g. a thrown storage failure, possibly after a
      // partial persist): keep the entered values and the pending id so the
      // user can retry instead of silently losing the entry or duplicating
      // the partially-written row.
      setSaveError('Could not save weight entry. Please try again.');
      emitMeasurement(PRODUCT_MEASUREMENT_EVENTS.WEIGHT_SAVE_COMPLETED, {
        ok: false,
        duration_ms: Date.now() - startedAt,
      });
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

  const saveWorkout = useCallback(async () => {
    if (workoutSaving) return { ok: false, error: 'Save already in progress' };

    const startedAt = Date.now();
    // Warning count from the same parse that governs logging; emitted both as a
    // standalone parse_warning_summary and folded into the save outcome (#672).
    let warningCount = 0;
    try {
      warningCount = buildSessionsFromNote(workoutNoteText).warnings.length;
    } catch {
      warningCount = 0;
    }
    emitMeasurement(PRODUCT_MEASUREMENT_EVENTS.WORKOUT_SAVE_ATTEMPTED, {});
    emitMeasurement(PRODUCT_MEASUREMENT_EVENTS.PARSE_WARNING_SUMMARY, {
      warning_count: warningCount,
    });

    if (!workoutNoteText.trim()) {
      emitMeasurement(PRODUCT_MEASUREMENT_EVENTS.WORKOUT_SAVE_COMPLETED, {
        ok: false,
        duration_ms: Date.now() - startedAt,
        warning_count: warningCount,
      });
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
      emitMeasurement(PRODUCT_MEASUREMENT_EVENTS.WORKOUT_SAVE_COMPLETED, {
        ok: true,
        duration_ms: Date.now() - startedAt,
        warning_count: warningCount,
      });
      return { ok: true };
    } catch {
      emitMeasurement(PRODUCT_MEASUREMENT_EVENTS.WORKOUT_SAVE_COMPLETED, {
        ok: false,
        duration_ms: Date.now() - startedAt,
        warning_count: warningCount,
      });
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

  // Home renders off the shell's own weight/note hooks, so it cannot see their
  // failures on its own (#737). A failed read leaves both hooks with `loading`
  // false and an empty collection, which is indistinguishable from a genuinely
  // empty account — exactly the "blank screen that silently lost context" this
  // is meant to end. The shell forwards the error flag and one retry that
  // re-runs both reads.
  const homeLoadError = !!(weightHook.error || noteHook.error);
  const handleRetryHomeData = useCallback(() => {
    weightHook.refresh();
    noteHook.refresh();
  // Individual refresh functions, not the hook objects (#592) — see saveWeight.
  }, [weightHook.refresh, noteHook.refresh]);

  return {
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
  };
}

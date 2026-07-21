// LOG TAB STYLE LOCK — DO NOT TOUCH.
// The fonts, font sizes, colors, spacing, and overall visual style of the Log
// tab are intentionally fixed. Do NOT change any styling here, in the `styles`
// block below, or in the Log-tab typography of `components/UI.js`
// (`WorkoutHeading` / `WorkoutSubheading`). No "creative" or opportunistic
// visual tweaks. Change Log-tab styling ONLY when the repo owner explicitly
// asks for that specific change.

import React, { useState, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LogEmptyState } from '../components/LogEmptyState';
import { ScreenShell } from '../components/ScreenShell';
import { ErrorBanner } from '../components/UI';
import { SessionCheckInModal } from '../components/SessionCheckInModal';
import { Colors } from '../theme/colors';
import { normalizeLiftName, listTrackedLifts } from '../lib/data';
import { useTrackedLifts, useWorkoutNotes, useDeloadNote, useDeloadHistory, useFeatureToggles } from '../hooks/useEntries';

import { LogDeloadSection } from '../components/LogDeloadSection';
import { LogPreviousRoutines } from '../components/LogPreviousRoutines';
import { LogActiveRoutineCard } from '../components/LogActiveRoutineCard';
import { LogScreenEditorCard } from '../components/LogScreenEditorCard';

import { useLogCurrentRoutineEditor } from './log/useLogCurrentRoutineEditor';
import { useLogOtherRoutineEditor } from './log/useLogOtherRoutineEditor';
import { useLogDeloadEditor } from './log/useLogDeloadEditor';

export function LogScreen({
  workoutNoteText,
  setWorkoutNoteText,
  workoutNoteTitle,
  setWorkoutNoteTitle,
  isCollapsed,
  toggleCollapsed,
  onSaveWorkout,
  deloadDateEditEnabled,
  onCheckInPrompt,
  isActive,
  registerBackConsumer,
}) {
  const { notes, currentId, currentNote, deloadNotes, loading: notesLoading, error: notesError, refresh: refreshNotes, selectCurrent, update, add, remove } = useWorkoutNotes();
  const { trackedLifts, toggle: toggleTrackedLift } = useTrackedLifts();
  const { note: deloadNote, loading: deloadLoading, save: saveDeloadNote, clear: clearDeloadNote } = useDeloadNote();
  const { history: deloadHistory, completeDeload, deleteDeload, deleteDeloadNote, updateDeload } = useDeloadHistory();
  const { fatigueTrackingEnabled, deloadModeEnabled } = useFeatureToggles();

  const [tabView, setTabView] = useState('routine'); // 'routine' | 'deload'

  const editorScrollRef = useRef(null);
  const readScrollRef = useRef(null);

  const currentEditor = useLogCurrentRoutineEditor({
    workoutNoteText,
    setWorkoutNoteText,
    workoutNoteTitle,
    setWorkoutNoteTitle,
    currentId,
    currentNote,
    notes,
    trackedLifts,
    update,
    add,
    selectCurrent,
    fatigueTrackingEnabled,
    onCheckInPrompt,
    isActive,
    editorScrollRef,
    readScrollRef,
  });

  const deloadEditor = useLogDeloadEditor({
    deloadNote,
    saveDeloadNote,
    workoutNoteText,
    editorScrollRef,
  });

  const otherEditor = useLogOtherRoutineEditor({
    notes,
    currentId,
    currentNote,
    deloadHistory,
    update,
    add,
    remove,
    selectCurrent,
    updateDeload,
    deleteDeloadNote,
    deloadDateEditEnabled,
    autosaveCurrentTimerRef: currentEditor.autosaveCurrentTimerRef,
    handleSave: currentEditor.handleSave,
    currentEditorMode: currentEditor.mode,
    hasUnsavedCurrent: currentEditor.hasUnsavedCurrent,
    editorScrollRef,
  });

  const handleAndroidBack = () => {
    if (deloadEditor.deloadMode === 'edit') {
      deloadEditor.handleDoneDeload();
      return true;
    }
    if (otherEditor.editingNoteId) {
      otherEditor.handleDoneOther();
      return true;
    }
    if (otherEditor.viewingNoteId) {
      otherEditor.setViewingNoteId(null);
      return true;
    }
    if (currentEditor.mode === 'edit') {
      currentEditor.handleDoneCurrent();
      return true;
    }
    return false;
  };
  const handleAndroidBackRef = useRef(handleAndroidBack);
  handleAndroidBackRef.current = handleAndroidBack;

  // Register with the app shell instead of BackHandler directly (#527): all tab
  // screens stay mounted under display:none, so a direct BackHandler listener here
  // would keep consuming Back even while another tab is active. Gating on isActive
  // ensures only the visible tab's editor/viewer state can intercept Back, and the
  // shell falls back to Home when handleAndroidBack finds nothing to consume.
  useEffect(() => {
    if (!isActive) return undefined;
    return registerBackConsumer?.(() => handleAndroidBackRef.current());
  }, [isActive, otherEditor.editingNoteId, otherEditor.viewingNoteId, currentEditor.mode, deloadEditor.deloadMode, registerBackConsumer]);

  const otherNotes = notes.filter(n => n.id !== currentId && !n.title?.startsWith('Deload · '));

  const hasContent = workoutNoteText.trim().length > 0;

  const handleToggleTrack = async (name) => {
    const key = normalizeLiftName(name);
    await toggleTrackedLift(key);
  };

  const headerRight = !otherEditor.editingNoteId && hasContent && currentEditor.mode === 'edit' && (
    <Pressable
      onPress={currentEditor.handleDoneCurrent}
      style={styles.modeToggle}
    >
      <Text style={styles.modeToggleText}>
        Done
      </Text>
    </Pressable>
  );

  const isEmpty = !notesLoading && notes.length === 0;
  const isEditing = !!otherEditor.editingNoteId || currentEditor.mode === 'edit' || deloadEditor.deloadMode === 'edit';

  const effectiveTabView = deloadModeEnabled ? tabView : 'routine';

  const activeSaveError = deloadEditor.deloadMode === 'edit'
    ? deloadEditor.saveError
    : otherEditor.editingNoteId
      ? otherEditor.saveError
      : currentEditor.saveError;

  const activeSaveSuccess = deloadEditor.deloadMode === 'edit'
    ? deloadEditor.saveSuccess
    : otherEditor.editingNoteId
      ? otherEditor.saveSuccess
      : currentEditor.saveSuccess;

  const activeIsSaving = deloadEditor.deloadMode === 'edit'
    ? deloadEditor.isSaving
    : currentEditor.isSaving;

  return (
    <>
      <ScreenShell
        ref={readScrollRef}
        onScroll={currentEditor.handleReadScroll}
        style={isEditing ? { display: 'none' } : { flex: 1 }}
        title="Workout Notes"
        subtitle={isEmpty ? "Track your active training routine." : "Your active training routine. Update it as you go."}
        headerRight={headerRight}
        keyboardShouldPersistTaps="handled"
      >
        {notesError ? (
          <ErrorBanner message="Could not load workout notes." onRetry={refreshNotes} />
        ) : null}
        {isEmpty ? (
          <LogEmptyState onCreateRoutine={otherEditor.handleCreateRoutine} />
        ) : (
          <>
            {deloadModeEnabled && (
              <View style={styles.tabToggle}>
                <Pressable
                  onPress={() => setTabView('routine')}
                  style={[styles.tabToggleItem, effectiveTabView === 'routine' && styles.tabToggleItemActive]}
                >
                  <Text style={[styles.tabToggleText, effectiveTabView === 'routine' && styles.tabToggleTextActive]}>Routine</Text>
                </Pressable>
                <Pressable
                  onPress={() => setTabView('deload')}
                  style={[styles.tabToggleItem, effectiveTabView === 'deload' && styles.tabToggleItemActive]}
                >
                  <Text style={[styles.tabToggleText, effectiveTabView === 'deload' && styles.tabToggleTextActive]}>Deload</Text>
                </Pressable>
              </View>
            )}

            {effectiveTabView === 'deload' && (
              <LogDeloadSection
                deloadNote={deloadNote}
                deloadLoading={deloadLoading}
                deloadDayGroups={deloadEditor.deloadDayGroups}
                enterDeloadEditor={deloadEditor.enterDeloadEditor}
                handleDeloadBodyPress={deloadEditor.handleDeloadBodyPress}
                deloadMode={deloadEditor.deloadMode}
                completeDeload={completeDeload}
                clearDeloadNote={clearDeloadNote}
                handleGenerateDeload={deloadEditor.handleGenerateDeload}
                isGenerating={deloadEditor.isGenerating}
                workoutNoteText={workoutNoteText}
                saveError={activeSaveError}
                deloadNotes={deloadNotes}
                deloadHistory={deloadHistory}
                deleteDeloadNote={deleteDeloadNote}
                deleteDeload={deleteDeload}
                viewingNoteId={otherEditor.viewingNoteId}
                handleViewOtherNote={otherEditor.handleViewOtherNote}
                viewingNote={otherEditor.viewingNote}
                viewingNoteDayGroups={otherEditor.viewingNoteDayGroups}
                handleOpenOtherNote={otherEditor.handleOpenOtherNote}
                logSessionCount={currentEditor.logSessionCount}
              />
            )}

            {effectiveTabView === 'routine' && currentEditor.mode === 'read' && hasContent && (
              <LogActiveRoutineCard
                workoutNoteTitle={workoutNoteTitle}
                hasABWeeks={currentEditor.hasABWeeks}
                effectiveActiveWeek={currentEditor.effectiveActiveWeek}
                handleToggleWeek={currentEditor.handleToggleWeek}
                enterCurrentEditor={currentEditor.enterCurrentEditor}
                handleNoteBodyPress={currentEditor.handleNoteBodyPress}
                handleSkipWeek={currentEditor.handleSkipWeek}
                handleUnskipWeek={currentEditor.handleUnskipWeek}
                canUnskipWeek={currentEditor.canUnskipWeek}
                skipWeekStatus={currentEditor.skipWeekStatus}
                toggleCollapsed={toggleCollapsed}
                isCollapsed={isCollapsed}
                dayGroups={currentEditor.dayGroups}
                trackedLifts={trackedLifts}
                handleToggleTrack={handleToggleTrack}
                roughNoteId={currentEditor.roughNoteId}
                currentId={currentId}
                roughFlaggedNames={currentEditor.roughFlaggedNames}
                activeEditText={currentEditor.activeEditText}
              />
            )}

            {effectiveTabView === 'routine' && (
              <LogPreviousRoutines
                otherNotes={otherNotes}
                handleViewOtherNote={otherEditor.handleViewOtherNote}
                viewingNoteId={otherEditor.viewingNoteId}
                viewingNote={otherEditor.viewingNote}
                viewingNoteDayGroups={otherEditor.viewingNoteDayGroups}
                handleSwitchCurrent={otherEditor.handleSwitchCurrent}
                handleEditViewedNote={otherEditor.handleEditViewedNote}
                handleDeleteRoutine={otherEditor.handleDeleteRoutine}
                handleCreateRoutine={otherEditor.handleCreateRoutine}
              />
            )}
          </>
        )}
      </ScreenShell>

      <ScreenShell
        ref={editorScrollRef}
        style={isEditing ? { flex: 1 } : { display: 'none' }}
        title={
          deloadEditor.deloadMode === 'edit' ? 'Deload Week' :
          (otherEditor.editingNoteId && otherEditor.isEditingDeloadNote) ? 'Deload record' :
          otherEditor.editingNoteId ? (otherEditor.editingTitle || 'Untitled Routine') :
          (workoutNoteTitle || 'Untitled Routine')
        }
        subtitle={
          deloadEditor.deloadMode === 'edit' ? 'Edit deload' :
          (otherEditor.editingNoteId && otherEditor.isEditingDeloadNote) ? 'Edit deload record' :
          'Edit routine'
        }
        headerRight={
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Pressable
              onPress={
                deloadEditor.deloadMode === 'edit' ? deloadEditor.handleUndoDeload :
                otherEditor.editingNoteId ? otherEditor.handleUndoOther :
                currentEditor.handleUndoCurrent
              }
              style={[styles.modeToggle, { backgroundColor: 'transparent', marginRight: 8 }]}
              accessibilityLabel="Undo"
              accessibilityRole="button"
            >
              <Text style={[styles.modeToggleText, { color: Colors.textMuted, fontWeight: '500' }]}>Undo</Text>
            </Pressable>
            <Pressable
              onPress={
                deloadEditor.deloadMode === 'edit' ? deloadEditor.handleDoneDeload :
                otherEditor.editingNoteId ? otherEditor.handleDoneOther :
                currentEditor.handleDoneCurrent
              }
              style={styles.modeToggle}
              accessibilityLabel="Done"
              accessibilityRole="button"
            >
              <Text style={styles.modeToggleText}>Done</Text>
            </Pressable>
          </View>
        }
        keyboardShouldPersistTaps="handled"
      >
        <LogScreenEditorCard
          deloadMode={deloadEditor.deloadMode}
          deloadEditText={deloadEditor.deloadEditText}
          setDeloadEditText={deloadEditor.setDeloadEditText}
          handleSaveDeload={deloadEditor.handleSaveDeload}
          isSaving={activeIsSaving}
          saveSuccess={activeSaveSuccess}
          editingNoteId={otherEditor.editingNoteId}
          isEditingDeloadNote={otherEditor.isEditingDeloadNote}
          editingTitle={otherEditor.editingTitle}
          setEditingTitle={otherEditor.setEditingTitle}
          workoutNoteTitle={workoutNoteTitle}
          setWorkoutNoteTitle={setWorkoutNoteTitle}
          deloadDateEditEnabled={deloadDateEditEnabled}
          editingDeloadHasLinkedRecord={otherEditor.editingDeloadHasLinkedRecord}
          setShowDeloadDatePicker={otherEditor.setShowDeloadDatePicker}
          deloadEditDate={otherEditor.deloadEditDate}
          deloadEditOrdinal={otherEditor.deloadEditOrdinal}
          setDeloadEditOrdinal={otherEditor.setDeloadEditOrdinal}
          showDeloadDatePicker={otherEditor.showDeloadDatePicker}
          editingNote={otherEditor.editingNote}
          setDeloadEditDate={otherEditor.setDeloadEditDate}
          editingText={otherEditor.editingText}
          setEditingText={otherEditor.setEditingText}
          activeEditText={currentEditor.activeEditText}
          handleCurrentTextChange={currentEditor.handleCurrentTextChange}
          handleSaveOtherNote={otherEditor.handleSaveOtherNote}
          handleSave={currentEditor.handleSave}
          noteIsSaving={otherEditor.noteIsSaving}
          handleSwitchCurrent={otherEditor.handleSwitchCurrent}
          handleDeleteDeloadNoteFromEditor={otherEditor.handleDeleteDeloadNoteFromEditor}
          handleDeleteRoutine={otherEditor.handleDeleteRoutine}
          currentId={currentId}
        />
      </ScreenShell>
      <SessionCheckInModal
        visible={currentEditor.showCheckInModal}
        checkInData={currentEditor.roughCheckInData}
        currentId={currentEditor.roughNoteId}
        currentNote={currentNote}
        update={update}
        onClose={() => currentEditor.setShowCheckInModal(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  modeToggle: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: Colors.chipBackground,
  },
  modeToggleText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.accent,
  },
  tabToggle: {
    flexDirection: 'row',
    borderRadius: 12,
    backgroundColor: Colors.chipBackground,
    marginBottom: 12,
    padding: 2,
  },
  tabToggleItem: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 10,
    alignItems: 'center',
  },
  tabToggleItemActive: {
    backgroundColor: Colors.accent,
  },
  tabToggleText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.chipText,
  },
  tabToggleTextActive: {
    color: '#fff',
  },
});
